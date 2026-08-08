'use strict'

// Fase A — `vendas.lead_profiles.empresa_id` deixa de nascer PJ por DEFAULT.
//
// O que estes testes garantem, na ordem em que a coisa quebra:
//   1. o fragmento SQL compartilhado deriva a empresa da CONVERSA e só cai na PJ como
//      último recurso, marcando a procedência;
//   2. o upsert nunca migra o dono de um perfil já atribuído;
//   3. nenhum caminho de escrita aceita empresa vinda do payload (IA/rotas);
//   4. o backfill é idempotente e não inventa dono quando não sabe;
//   5. a válvula de pausa da Meta realmente interrompe o ciclo antes de tocar no banco.
//
// Pool falso: exercita o SQL real dos módulos sem precisar de Postgres. A prova de
// comportamento fim-a-fim (a linha realmente gravada) exige banco e está fora daqui.

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  EMPRESA_PADRAO_PJ,
  ORIGENS_EMPRESA_ID,
  ORIGENS_CONFIAVEIS,
  sqlEmpresaDaConversa,
  insertEmpresa,
  conflitoEmpresa,
} = require('../src/db/lead-profile-empresa')
const { createDbCrud } = require('../src/db-crud')
const { alvoDaLinha, lerArgs, novoRelatorio, motivoRecusaAplicar } = require('../scripts/backfill-lead-profiles-empresa')

const EMPRESA_B = '00000000-0000-0000-0000-0000000000bb'
const SILENCIOSO = { info() {}, warn() {}, error() {} }

function poolFalso(resposta = { rows: [] }) {
  const chamadas = []
  return {
    chamadas,
    query: async (sql, params = []) => {
      chamadas.push({ sql, params })
      return resposta
    },
  }
}

// ── 1. Fragmento SQL compartilhado ────────────────────────────────────────────

test('a empresa do perfil é lida da CONVERSA, não de entrada externa', () => {
  const { colunas, valores } = insertEmpresa('$1', '$9')
  assert.equal(colunas, 'empresa_id, empresa_id_origem')
  assert.match(valores, /SELECT c\.empresa_id FROM vendas\.conversas c WHERE c\.numero = \$1/)
})

test('a PJ é o ÚLTIMO argumento do COALESCE — nunca o primeiro', () => {
  const { valores } = insertEmpresa('$1', '$9')
  const coalesce = valores.match(/COALESCE\((.+?)\), CASE/s)[1]
  const posConversa = coalesce.indexOf('vendas.conversas')
  const posPj = coalesce.indexOf('$9')
  assert.ok(posConversa >= 0 && posPj > posConversa, 'a conversa tem de ser consultada antes do fallback da PJ')
})

test('a confiança exige CONFIRMAÇÃO pela instância — "veio da conversa" não basta', () => {
  const { valores } = insertEmpresa('$1', '$9')
  // Medido em produção: das 6 conversas da PJ, só 1 é PJ de verdade. Carimbar as outras
  // como confiáveis por terem "vindo da conversa" seria inventar confiança.
  assert.match(valores, /app\.empresa_whatsapp_instances i ON i\.evolution_instance = c\.evolution_instance/)
  assert.match(valores, /i\.empresa_id = c\.empresa_id/)
  assert.match(valores, /THEN 'conversa_confirmada' ELSE 'conversa_nao_confirmada' END/)
  assert.deepEqual(ORIGENS_EMPRESA_ID, ['conversa_confirmada', 'conversa_nao_confirmada'])
  assert.deepEqual(ORIGENS_CONFIAVEIS, ['conversa_confirmada'],
    'só a atribuição confirmada pela instância é confiável — o resto a Fase B recusa')
})

test('placeholder inválido falha alto (nada de string concatenada no SQL)', () => {
  assert.throws(() => sqlEmpresaDaConversa("'; DROP TABLE x; --"), /placeholder/)
  assert.throws(() => insertEmpresa('$1', EMPRESA_PADRAO_PJ), /placeholder/)
})

test('o upsert NUNCA migra o dono de um perfil já atribuído', () => {
  const set = conflitoEmpresa()
  assert.match(set, /empresa_id = COALESCE\(vendas\.lead_profiles\.empresa_id, EXCLUDED\.empresa_id\)/)
  // a procedência só é carimbada junto com a empresa; não se reescreve sozinha
  assert.match(set, /empresa_id_origem = CASE WHEN vendas\.lead_profiles\.empresa_id IS NULL/)
})

// ── 2. Caminhos de escrita ────────────────────────────────────────────────────

test('atualizarPerfil grava empresa_id derivada da conversa, com a PJ só de fallback', async () => {
  const pool = poolFalso()
  const { atualizarPerfil } = createDbCrud({ pool, logger: SILENCIOSO, serializeError: (e) => e })

  await atualizarPerfil('5511999999999@s.whatsapp.net', { negocio: 'salão' })

  const insert = pool.chamadas.find((c) => /INSERT INTO vendas\.lead_profiles/.test(c.sql))
  assert.ok(insert, 'o perfil precisa continuar sendo inserido')
  assert.match(insert.sql, /empresa_id, empresa_id_origem/)
  assert.match(insert.sql, /FROM vendas\.conversas c WHERE c\.numero = \$1/)
  assert.equal(insert.params[insert.params.length - 1], EMPRESA_PADRAO_PJ,
    'a PJ entra como último parâmetro (fallback), não como valor gravado')
  assert.match(insert.sql, /ON CONFLICT \(numero\) DO UPDATE/)
  assert.match(insert.sql, /COALESCE\(vendas\.lead_profiles\.empresa_id, EXCLUDED\.empresa_id\)/)
})

test('empresa_id vinda do payload (IA/rota) é ignorada — não vira coluna nem parâmetro', async () => {
  const pool = poolFalso()
  const { atualizarPerfil } = createDbCrud({ pool, logger: SILENCIOSO, serializeError: (e) => e })

  await atualizarPerfil('5511999999999@s.whatsapp.net', {
    negocio: 'salão',
    empresa_id: EMPRESA_B,
    empresa_id_origem: 'conversa',
  })

  const insert = pool.chamadas.find((c) => /INSERT INTO vendas\.lead_profiles/.test(c.sql))
  assert.ok(!insert.params.includes(EMPRESA_B), 'empresa do payload não pode chegar ao banco')
  // A coluna só aparece na parte derivada do SQL — nunca na lista de campos do payload.
  const listaCampos = insert.sql.match(/INSERT INTO vendas\.lead_profiles \((.+?)\)/s)[1]
  assert.match(listaCampos, /negocio/)
  assert.equal((listaCampos.match(/empresa_id\b/g) || []).length, 1,
    'empresa_id só pode aparecer uma vez, e vinda do fragmento derivado da conversa')
})

test('atualizarPerfil sem campos não escreve nada (comportamento preservado)', async () => {
  const pool = poolFalso()
  const { atualizarPerfil } = createDbCrud({ pool, logger: SILENCIOSO, serializeError: (e) => e })
  const r = await atualizarPerfil('5511999999999@s.whatsapp.net', { negocio: null })
  assert.deepEqual(r, {})
  assert.equal(pool.chamadas.length, 0)
})

// ── 3. Backfill ───────────────────────────────────────────────────────────────

test('simulação é o PADRÃO do backfill', () => {
  const a = lerArgs(['node', 'x'])
  assert.equal(a.aplicar, false)
  assert.equal(a.lote, 500)
  assert.equal(a.empresa, null)
  assert.equal(lerArgs(['node', 'x', '--aplicar']).aplicar, true)
  assert.equal(lerArgs(['node', 'x', '--aplicar', '--dry-run']).aplicar, false)
  assert.equal(lerArgs(['node', 'x', '--lote=0']).lote, 1)
  assert.throws(() => lerArgs(['node', 'x', '--apagar-tudo']), /desconhecido/)
})

test('lead marcado como PJ cuja conversa é da empresa B passa a ser da B', () => {
  const alvo = alvoDaLinha({
    id: 1, empresa_id: EMPRESA_PADRAO_PJ, empresa_id_origem: null,
    tem_conversa: true, empresa_conversa: EMPRESA_B, empresa_confirmada_pela_instancia: true,
  })
  assert.equal(alvo.acao, 'corrigir')
  assert.equal(alvo.empresaId, EMPRESA_B)
  assert.equal(alvo.empresaAnterior, EMPRESA_PADRAO_PJ)
  assert.equal(alvo.origem, 'conversa_confirmada')
})

test('lead da PJ continua na PJ (a correção não é "tirar todo mundo da PJ")', () => {
  const alvo = alvoDaLinha({
    id: 2, empresa_id: EMPRESA_PADRAO_PJ, empresa_id_origem: 'conversa_confirmada',
    tem_conversa: true, empresa_conversa: EMPRESA_PADRAO_PJ, empresa_confirmada_pela_instancia: true,
  })
  assert.equal(alvo.acao, 'ja_correto')
})

test('conversa da PJ SEM instância que a confirme não vira atribuição confiável', () => {
  // Este é o caso real: 5 das 6 conversas da PJ em produção. A empresa fica (não há
  // outra), mas o carimbo diz "não confirmada" e a Fase B recusa.
  const alvo = alvoDaLinha({
    id: 7, empresa_id: EMPRESA_PADRAO_PJ, empresa_id_origem: null,
    tem_conversa: true, empresa_conversa: EMPRESA_PADRAO_PJ, empresa_confirmada_pela_instancia: false,
  })
  assert.equal(alvo.acao, 'so_procedencia')
  assert.equal(alvo.empresaId, EMPRESA_PADRAO_PJ, 'o dono não muda — só a confiança é registrada')
  assert.equal(alvo.origem, 'conversa_nao_confirmada')
})

test('o backfill é idempotente: a linha corrigida não é tocada de novo', () => {
  const jaCorrigida = {
    id: 3, empresa_id: EMPRESA_B, empresa_id_origem: 'conversa_confirmada',
    tem_conversa: true, empresa_conversa: EMPRESA_B, empresa_confirmada_pela_instancia: true,
  }
  assert.equal(alvoDaLinha(jaCorrigida).acao, 'ja_correto')
  assert.equal(alvoDaLinha(jaCorrigida).acao, 'ja_correto')
})

test('empresa certa mas confiança em branco: só carimba, não muda dono', () => {
  const alvo = alvoDaLinha({
    id: 4, empresa_id: EMPRESA_B, empresa_id_origem: null,
    tem_conversa: true, empresa_conversa: EMPRESA_B, empresa_confirmada_pela_instancia: true,
  })
  assert.equal(alvo.acao, 'so_procedencia')
  assert.equal(alvo.empresaId, EMPRESA_B)
  assert.equal(alvo.origem, 'conversa_confirmada')
})

test('sem conversa ou sem empresa na conversa, o backfill NÃO inventa dono', () => {
  assert.equal(alvoDaLinha({ id: 5, empresa_id: EMPRESA_PADRAO_PJ, tem_conversa: false, empresa_conversa: null }).acao,
    'sem_conversa')
  assert.equal(alvoDaLinha({ id: 6, empresa_id: EMPRESA_PADRAO_PJ, tem_conversa: true, empresa_conversa: null }).acao,
    'conversa_sem_empresa')
})

test('sem a migration 058, o backfill SIMULA mas se recusa a aplicar (não haveria rollback)', () => {
  assert.equal(motivoRecusaAplicar({ temColuna: true, temBackup: true }), null, 'com a migration, aplicar é liberado')
  assert.match(motivoRecusaAplicar({ temColuna: false, temBackup: false }), /migration 058 ainda nao rodou/)
  assert.match(motivoRecusaAplicar({ temColuna: false, temBackup: false }), /SIMULACAO funciona normalmente/)
  // Faltar só o rollback já basta para recusar: gravar sem "antes" é irreversível.
  assert.match(motivoRecusaAplicar({ temColuna: true, temBackup: false }), /rollback/)
})

test('o relatório do backfill separa o que foi corrigido do que é impossível', () => {
  const rel = novoRelatorio()
  for (const chave of ['analisados', 'corrigidos', 'ja_corretos', 'sem_conversa', 'conversa_sem_empresa', 'so_procedencia', 'saiu_da_pj', 'confiaveis', 'nao_confiaveis']) {
    assert.equal(rel[chave], 0, `o relatório precisa contar ${chave}`)
  }
})

// ── 4. Válvula de pausa da Meta ───────────────────────────────────────────────

test('META_CONVERSOES_PAUSADO interrompe o ciclo ANTES de qualquer consulta', async () => {
  const { conversoesPausadas, processarConversoesMeta } = require('../src/services/meta-dispatch')
  const anterior = process.env.META_CONVERSOES_PAUSADO
  try {
    process.env.META_CONVERSOES_PAUSADO = 'on'
    assert.equal(conversoesPausadas(), true)
    const pool = poolFalso()
    const r = await processarConversoesMeta(pool, { logger: SILENCIOSO })
    assert.equal(r.pausado, true)
    assert.equal(r.enviados, 0)
    assert.equal(pool.chamadas.length, 0, 'pausado significa nem consultar o banco')

    process.env.META_CONVERSOES_PAUSADO = 'off'
    assert.equal(conversoesPausadas(), false)
  } finally {
    if (anterior === undefined) delete process.env.META_CONVERSOES_PAUSADO
    else process.env.META_CONVERSOES_PAUSADO = anterior
  }
})
