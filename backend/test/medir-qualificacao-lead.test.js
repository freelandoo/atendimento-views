'use strict'
// Testes do script de MEDICAO read-only da qualificacao do lead (Etapa 3.0).
//
// O teste mais importante aqui NAO e' de comportamento: e' a GUARDA DE REGRESSAO que le o fonte
// do script e falha se qualquer verbo de escrita aparecer nele. O script promete "read-only" no
// cabecalho e roda contra PRODUCAO com autorizacao explicita do operador; uma promessa dessas
// precisa de algo que quebre o build quando alguem a violar, e nao de um revisor atento.
//
// Nao ha conexao com banco em nenhum destes testes.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const CAMINHO = path.join(__dirname, '..', 'scripts', 'medir-qualificacao-lead.js')
const FONTE = fs.readFileSync(CAMINHO, 'utf8')

const {
  mascarar, tabela, destinoNaCarencia, impactoDiario, montarAchados,
  STATUS_RODAVEL, STATUS_TRIAGEM_PENDENTE,
} = require('../scripts/medir-qualificacao-lead')

/**
 * Remove comentarios de linha e de bloco.
 * Necessario porque o proprio cabecalho do script CITA os verbos proibidos ao declarar que nao
 * os usa. Sem tirar comentario, a guarda acusaria a documentacao dela mesma.
 */
function semComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
}

// ─── Guardas de seguranca ──────────────────────────────────────────────────────────────────

test('GUARDA: o script nao contem nenhuma operacao de escrita', () => {
  const codigo = semComentarios(FONTE)
  const proibidos = [
    [/\bINSERT\s+INTO\b/i, 'INSERT INTO'],
    [/\bUPDATE\s+[a-z_"]/i, 'UPDATE <tabela>'],
    [/\bDELETE\s+FROM\b/i, 'DELETE FROM'],
    [/\bALTER\s+(TABLE|SCHEMA|INDEX|SEQUENCE)\b/i, 'ALTER'],
    [/\bCREATE\s+(TABLE|INDEX|TEMP|TEMPORARY|SCHEMA|VIEW|EXTENSION)\b/i, 'CREATE'],
    [/\bDROP\s+(TABLE|INDEX|SCHEMA|VIEW|CONSTRAINT|COLUMN)\b/i, 'DROP'],
    [/\bTRUNCATE\b/i, 'TRUNCATE'],
    [/\bSELECT\b[\s\S]{0,400}?\bINTO\b/i, 'SELECT ... INTO'],
    [/\bFOR\s+UPDATE\b/i, 'FOR UPDATE'],
    [/\bFOR\s+NO\s+KEY\s+UPDATE\b/i, 'FOR NO KEY UPDATE'],
    [/\bCOMMIT\b/i, 'COMMIT'],
  ]
  for (const [re, nome] of proibidos) {
    assert.ok(!re.test(codigo), `verbo de escrita proibido encontrado no script: ${nome}`)
  }
})

test('GUARDA: a sessao e READ ONLY e termina em ROLLBACK', () => {
  assert.ok(/BEGIN TRANSACTION READ ONLY/.test(FONTE), 'perdeu o BEGIN TRANSACTION READ ONLY')
  assert.ok(/ROLLBACK/.test(FONTE), 'perdeu o ROLLBACK')
})

test('GUARDA: nenhuma chamada externa e nenhuma dependencia nova', () => {
  const codigo = semComentarios(FONTE)
  for (const proibido of ['axios', 'fetch(', 'node-fetch', 'enviarMensagem', 'generateAIResponse', 'brightdata']) {
    assert.ok(!codigo.includes(proibido), `o script nao pode falar com o mundo externo: ${proibido}`)
  }
  // `pg` ja e' dependencia do projeto; qualquer outro require de pacote seria dependencia nova.
  const requires = [...codigo.matchAll(/require\(['"]([^'".][^'"]*)['"]\)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(requires)], ['pg'])
})

test('GUARDA: o script nunca escolhe banco sozinho', () => {
  assert.ok(FONTE.includes('process.env.DATABASE_URL'), 'deve usar a DATABASE_URL explicita')
  // Nenhum default de conexao embutido — um fallback aqui mediria o banco errado em silencio.
  assert.ok(!/postgres(ql)?:\/\//.test(semComentarios(FONTE)), 'nao pode haver URL de banco embutida')
})

test('GUARDA: o script nao imprime PII — nenhuma coluna de pessoa e selecionada', () => {
  const codigo = semComentarios(FONTE)
  // `telefone` e `email` aparecem, mas SOMENTE dentro de predicados de contagem
  // (NULLIF(BTRIM(COALESCE(...)))) — nunca na lista de SELECT. Se alguem selecionar a coluna,
  // o valor vaza para o stdout e para onde a saida for colada.
  for (const proibido of [
    /SELECT[^;]{0,200}\btelefone\b(?![^;]{0,80}IS NOT NULL)/i,
    /SELECT[^;]{0,200}\bp\.nome\b/i,
    /SELECT[^;]{0,200}\bendereco\b/i,
    /SELECT[^;]{0,200}\bhistorico\b/i,
    /SELECT[^;]{0,200}\bmensagem\b/i,
    /\bctwa_clid\b/i,
    /\btoken\b/i,
  ]) {
    assert.ok(!proibido.test(codigo), `possivel PII/segredo no SELECT: ${proibido}`)
  }
})

test('GUARDA: as constantes espelhadas nao divergiram do codigo de producao', () => {
  // O script duplica STATUS_RODAVEL de proposito (importar rodar-leads.js traria pool, Evolution
  // e worker para dentro de um script que promete nao falar com nada). Duplicar exige conferir.
  const producao = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'rodar-leads.js'), 'utf8')
  const m = producao.match(/const STATUS_RODAVEL = new Set\(\[([^\]]*)\]\)/)
  assert.ok(m, 'nao achei STATUS_RODAVEL em services/rodar-leads.js')
  const doCodigo = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
  assert.deepEqual([...STATUS_RODAVEL].sort(), doCodigo.sort(),
    'STATUS_RODAVEL do script divergiu do de producao — a medicao mediria a regra errada')
  // Triagem pendente = rodavel menos 'aprovado' (o unico com semantica de triagem).
  assert.deepEqual([...STATUS_TRIAGEM_PENDENTE].sort(),
    [...STATUS_RODAVEL].filter((s) => s !== 'aprovado').sort())
})

// ─── Regras puras ──────────────────────────────────────────────────────────────────────────

test('mascarar reduz o uuid ao prefixo e nomeia a ausencia', () => {
  assert.equal(mascarar('00000000-0000-0000-0000-000000000001'), '00000000…')
  assert.equal(mascarar(null), '(sem empresa)')
  assert.equal(mascarar(''), '(sem empresa)')
  assert.equal(mascarar(undefined, '(sem id)'), '(sem id)')
  assert.equal(mascarar('curto'), 'curto')
})

test('destinoNaCarencia: so status terminal de recusa vira descartado; o resto vira legado', () => {
  assert.equal(destinoNaCarencia('rejeitado'), 'descartado')
  assert.equal(destinoNaCarencia('nao_contatar'), 'descartado')
  // Quem JA foi abordado entra como legado, nao como pendente: ja operava antes da regra.
  for (const s of ['aguardando', 'aprovado', 'coletado', 'contato_encontrado', 'enviado', 'respondeu', 'fechado']) {
    assert.equal(destinoNaCarencia(s), 'legado', `status ${s}`)
  }
  // Status desconhecido tambem cai em legado — e' a opcao que NAO para a operacao.
  assert.equal(destinoNaCarencia('valor_novo_qualquer'), 'legado')
})

test('impactoDiario traduz o risco em numero e detecta o caso "iria a zero"', () => {
  assert.deepEqual(
    impactoDiario({ disparosPorDia: 12, elegiveisSemProva: 300, elegiveisTotal: 300 }),
    { perderia_tudo: true, fracao_sem_prova: 1, disparos_dia: 12 }
  )
  assert.deepEqual(
    impactoDiario({ disparosPorDia: 5, elegiveisSemProva: 150, elegiveisTotal: 300 }),
    { perderia_tudo: false, fracao_sem_prova: 0.5, disparos_dia: 5 }
  )
  // Carteira vazia nao e' "perderia tudo" — nao ha o que perder.
  assert.deepEqual(
    impactoDiario({ disparosPorDia: 0, elegiveisSemProva: 0, elegiveisTotal: 0 }),
    { perderia_tudo: false, fracao_sem_prova: 0, disparos_dia: 0 }
  )
})

test('tabela alinha e nao quebra com celula nula', () => {
  const t = tabela(['a', 'b'], [['x', 1], ['yy', null]])
  assert.ok(t.includes('a'))
  assert.equal(t.split('\n').length, 4) // cabecalho + separador + 2 linhas
})

test('montarAchados diz a verdade quando a curadoria nunca foi usada', () => {
  const d = {
    porStatus: [{ status: 'aguardando', n: 700 }, { status: 'rejeitado', n: 41 }],
    porEmpresaStatus: [], elegiveis: [{ empresa_id: 'e', elegiveis: 500, sem_triagem: 500 }],
    disparos: { total_30d: 60, dias_com_disparo: 5 }, disparosPorStatus: [],
    configBancoLeads: [{ empresa_id: 'e', modo: 'automatico', auto_ativo: true, teto_diario: 40 }],
    emCampanha: [{ status: 'aguardando', n: 700, na_fila: 600 }, { status: 'rejeitado', n: 10, na_fila: 8 }],
    curadoria: {}, sessoes: [], comProva: {}, emailAbordavel: { com_email: 3, com_email_sem_triagem: 3 },
    empresas: { total: 2, ativas: 2 }, vinculos: [{ role: 'owner', n: 2, ativos: 2 }],
  }
  const achados = montarAchados(d).join(' | ')
  assert.ok(achados.includes('RISCO CONFIRMADO'), 'deve alertar quando 100% dos elegiveis nao tem prova')
  assert.ok(achados.includes('Curadoria NUNCA foi usada'))
  assert.ok(achados.includes('DEFEITO C1 MEDIDO'), 'deve acusar lead descartado na fila de ligacao')
  assert.ok(achados.includes('Modo Automatico LIGADO'))
  assert.ok(achados.includes('~12/dia'), 'deve calcular disparos por dia sobre dias COM disparo')
})

test('montarAchados nao alarma quando o ambiente esta limpo', () => {
  const d = {
    porStatus: [{ status: 'aprovado', n: 10 }],
    porEmpresaStatus: [], elegiveis: [{ empresa_id: 'e', elegiveis: 10, sem_triagem: 0 }],
    disparos: { total_30d: 0, dias_com_disparo: 0 }, disparosPorStatus: [],
    configBancoLeads: [{ empresa_id: 'e', modo: 'manual', auto_ativo: false, teto_diario: 40 }],
    emCampanha: [{ status: 'aprovado', n: 10, na_fila: 10 }],
    curadoria: { decisoes: 10, aprovados: 10, descartados: 0, leads_distintos: 10 },
    sessoes: [], comProva: { leads: 10 }, emailAbordavel: { com_email: 0, com_email_sem_triagem: 0 },
    empresas: { total: 1, ativas: 1 }, vinculos: [],
  }
  const achados = montarAchados(d).join(' | ')
  assert.ok(!achados.includes('RISCO CONFIRMADO'))
  assert.ok(!achados.includes('DEFEITO C1 MEDIDO'))
  assert.ok(achados.includes('Modo Automatico DESLIGADO'))
})
