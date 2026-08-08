'use strict'

// Motor da integração Meta: reconciliação, isolamento entre empresas, idempotência
// e tratamento de falha. Pool falso roteado por SQL — exercita o SQL real dos
// módulos de banco sem precisar de Postgres.

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')

process.env.META_ENC_KEY = crypto.randomBytes(32).toString('base64')

const { encrypt } = require('../src/services/meta-crypto')
const {
  fatosDaReuniao, dentroDaJanela, reconciliarEmpresa, despacharEmpresa, processarConversoesMeta,
  JANELA_FATO_DIAS,
} = require('../src/services/meta-dispatch')

const EMPRESA_A = '00000000-0000-0000-0000-0000000000aa'
const EMPRESA_B = '00000000-0000-0000-0000-0000000000bb'
const SILENCIOSO = { info() {}, warn() {}, error() {} }

/**
 * Pool falso roteado por padrão de SQL. `estado` guarda o que cada empresa "tem".
 * Toda consulta é registrada para permitir asserções sobre isolamento.
 */
function criarPool(estado = {}) {
  const chamadas = []
  const registrados = []

  async function query(sql, params = []) {
    chamadas.push({ sql, params })

    if (/FROM app\.meta_integracoes/.test(sql) && /SELECT \*/.test(sql)) {
      const cfg = (estado.integracoes || {})[params[0]]
      return { rows: cfg ? [cfg] : [] }
    }
    if (/FROM app\.meta_integracoes/.test(sql) && /status = 'ativa'/.test(sql)) {
      return {
        rows: Object.values(estado.integracoes || {})
          .filter((i) => i.status === 'ativa')
          .map((i) => ({
            empresa_id: i.empresa_id,
            evento_agendada: i.evento_agendada,
            evento_realizada: i.evento_realizada,
            evento_venda: i.evento_venda,
          })),
      }
    }
    if (/FROM app\.agenda_eventos/.test(sql)) {
      return { rows: (estado.reunioesApp || {})[params[0]] || [] }
    }
    if (/FROM vendas\.agenda_eventos/.test(sql)) {
      return { rows: (estado.reunioesVendas || {})[params[0]] || [] }
    }
    if (/FROM vendas\.lead_profiles/.test(sql)) {
      return { rows: (estado.atribuicoes || {})[params[0]] || [] }
    }
    if (/INSERT INTO app\.conversao_eventos/.test(sql)) {
      const [empresa_id, tipo, event_id, entidade_tipo, entidade_id, telefone_norm,
        ocorrido_em, valor, moeda, status, motivo_ignorado] = params
      // Simula o índice único (empresa_id, event_id): a segunda inserção não cria linha.
      if (registrados.some((r) => r.empresa_id === empresa_id && r.event_id === event_id)) {
        return { rows: [] }
      }
      const linha = {
        id: `ev-${registrados.length + 1}`, empresa_id, tipo, event_id, entidade_tipo,
        entidade_id, telefone_norm, ocorrido_em, valor, moeda, status, motivo_ignorado,
        tentativas: 0,
      }
      registrados.push(linha)
      return { rows: [linha] }
    }
    if (/FROM app\.conversao_eventos/.test(sql) && /FOR UPDATE SKIP LOCKED/.test(sql)) {
      return { rows: (estado.pendentes || {})[params[0]] || [] }
    }
    return { rows: [], rowCount: 1 }
  }

  return {
    chamadas,
    registrados,
    query,
    connect: async () => ({ query, release() {} }),
  }
}

function integracao(empresaId, over = {}) {
  return {
    id: `int-${empresaId}`,
    empresa_id: empresaId,
    dataset_id: empresaId === EMPRESA_A ? '111111111' : '222222222',
    page_id: null,
    waba_id: empresaId === EMPRESA_A ? 'WABA-A' : 'WABA-B',
    access_token_enc: encrypt(empresaId === EMPRESA_A ? 'token-A' : 'token-B'),
    token_hint: 'xxxx',
    test_event_code: null,
    status: 'ativa',
    evento_agendada: true,
    evento_realizada: true,
    evento_venda: true,
    ...over,
  }
}

function pendente(empresaId, over = {}) {
  return {
    id: `ev-${over.event_id || '1'}`,
    empresa_id: empresaId,
    tipo: 'reuniao_agendada',
    event_id: 'ra:agenda_app:r1',
    entidade_tipo: 'agenda_app',
    entidade_id: 'r1',
    telefone_norm: '5571999994821',
    ocorrido_em: new Date().toISOString(),
    valor: null,
    moeda: null,
    status: 'pendente',
    tentativas: 0,
    ...over,
  }
}

// ─── Fatos de uma reunião ─────────────────────────────────────────────────────

test('fatos: reunião só agendada gera apenas o fato de agendamento', () => {
  const fatos = fatosDaReuniao({ status: 'pendente', agendadoEm: '2026-08-01', realizadoEm: '2026-08-05' })
  const elegiveis = fatos.filter((f) => f.elegivel).map((f) => f.tipo)
  assert.deepEqual(elegiveis, ['reuniao_agendada'])
})

test('fatos: reunião concluída COM venda gera realizada E realizada_com_venda', () => {
  const fatos = fatosDaReuniao({
    status: 'concluido', agendadoEm: '2026-08-01', realizadoEm: '2026-08-05',
    vendaValor: 2500, vendaMoeda: 'BRL', vendaEm: '2026-08-05',
  })
  const elegiveis = fatos.filter((f) => f.elegivel).map((f) => f.tipo)
  // Uma reunião que vendeu também aconteceu: os dois eventos existem e são ligados
  // de forma independente na configuração.
  assert.deepEqual(elegiveis, ['reuniao_agendada', 'reuniao_realizada', 'reuniao_realizada_com_venda'])
})

test('fatos: reunião concluída SEM venda não gera o fato de venda', () => {
  const fatos = fatosDaReuniao({ status: 'concluido', agendadoEm: '2026-08-01', realizadoEm: '2026-08-05', vendaValor: null })
  assert.equal(fatos.find((f) => f.tipo === 'reuniao_realizada_com_venda').elegivel, false)
})

test('janela: fato mais velho que a janela da Meta não entra no ledger', () => {
  const agora = new Date('2026-08-07T12:00:00Z')
  const ontem = new Date('2026-08-06T12:00:00Z')
  const antigo = new Date('2026-06-01T12:00:00Z')
  assert.equal(dentroDaJanela(ontem, agora), true)
  assert.equal(dentroDaJanela(antigo, agora), false)
  assert.equal(dentroDaJanela(null, agora), false)
  assert.equal(JANELA_FATO_DIAS, 7)
})

// ─── Reconciliação ────────────────────────────────────────────────────────────

const agoraIso = () => new Date().toISOString()

function reuniaoApp(over = {}) {
  return {
    entidade_id: 'r1',
    status: 'pendente',
    criado_em: agoraIso(),
    data_fim: agoraIso(),
    venda_valor: null,
    venda_moeda: null,
    venda_registrada_em: null,
    telefone_norm: '5571999994821',
    ctwa_clid: 'CLID-1',
    ...over,
  }
}

test('reconcilia: registra o fato uma vez; rodar de novo NÃO duplica', async () => {
  const estado = {
    integracoes: { [EMPRESA_A]: integracao(EMPRESA_A) },
    reunioesApp: { [EMPRESA_A]: [reuniaoApp()] },
  }
  const pool = criarPool(estado)
  const cfg = integracao(EMPRESA_A)
  const r1 = await reconciliarEmpresa(pool, EMPRESA_A, cfg)
  const r2 = await reconciliarEmpresa(pool, EMPRESA_A, cfg)
  assert.equal(r1.registrados, 1)
  assert.equal(r2.registrados, 0, 'o segundo ciclo não pode criar linha nova')
  assert.equal(pool.registrados.length, 1)
  assert.equal(pool.registrados[0].event_id, 'ra:agenda_app:r1')
})

test('reconcilia: reunião CANCELADA vira ledger "ignorado" e nunca fica pendente', async () => {
  const pool = criarPool({
    integracoes: { [EMPRESA_A]: integracao(EMPRESA_A) },
    reunioesApp: { [EMPRESA_A]: [reuniaoApp({ status: 'cancelado' })] },
  })
  await reconciliarEmpresa(pool, EMPRESA_A, integracao(EMPRESA_A))
  assert.equal(pool.registrados.length, 1)
  assert.equal(pool.registrados[0].status, 'ignorado')
  assert.equal(pool.registrados[0].motivo_ignorado, 'reuniao_cancelada_ou_no_show')
})

test('reconcilia: reunião NO-SHOW também fica só interna', async () => {
  const pool = criarPool({
    integracoes: { [EMPRESA_A]: integracao(EMPRESA_A) },
    reunioesApp: { [EMPRESA_A]: [reuniaoApp({ status: 'nao_compareceu' })] },
  })
  await reconciliarEmpresa(pool, EMPRESA_A, integracao(EMPRESA_A))
  assert.equal(pool.registrados.every((r) => r.status === 'ignorado'), true)
})

test('reconcilia: lead SEM anúncio não polui o histórico (nenhuma linha criada)', async () => {
  const pool = criarPool({
    integracoes: { [EMPRESA_A]: integracao(EMPRESA_A) },
    reunioesApp: { [EMPRESA_A]: [reuniaoApp({ ctwa_clid: null })] },
  })
  const r = await reconciliarEmpresa(pool, EMPRESA_A, integracao(EMPRESA_A))
  assert.equal(pool.registrados.length, 0)
  assert.equal(r.registrados, 0)
  assert.equal(r.ignorados, 0)
})

test('reconcilia: venda SEM valor não vira evento de venda, e o motivo fica visível', async () => {
  const pool = criarPool({
    integracoes: { [EMPRESA_A]: integracao(EMPRESA_A) },
    reunioesApp: { [EMPRESA_A]: [reuniaoApp({ status: 'concluido', venda_valor: 0 })] },
  })
  await reconciliarEmpresa(pool, EMPRESA_A, integracao(EMPRESA_A))
  const venda = pool.registrados.find((r) => r.tipo === 'reuniao_realizada_com_venda')
  assert.equal(venda, undefined, 'venda sem valor não gera nem fato elegível')
  assert.deepEqual(
    pool.registrados.map((r) => r.tipo).sort(),
    ['reuniao_agendada', 'reuniao_realizada']
  )
})

test('reconcilia: duas reuniões do MESMO telefone geram duas vendas legítimas', async () => {
  const pool = criarPool({
    integracoes: { [EMPRESA_A]: integracao(EMPRESA_A) },
    reunioesApp: {
      [EMPRESA_A]: [
        reuniaoApp({ entidade_id: 'r1', status: 'concluido', venda_valor: 1000, venda_moeda: 'BRL', venda_registrada_em: agoraIso() }),
        reuniaoApp({ entidade_id: 'r2', status: 'concluido', venda_valor: 3000, venda_moeda: 'BRL', venda_registrada_em: agoraIso() }),
      ],
    },
  })
  await reconciliarEmpresa(pool, EMPRESA_A, integracao(EMPRESA_A))
  const vendas = pool.registrados.filter((r) => r.tipo === 'reuniao_realizada_com_venda')
  assert.equal(vendas.length, 2, 'o motor antigo travava em uma venda por telefone')
  assert.deepEqual(vendas.map((v) => v.event_id).sort(), ['rv:agenda_app:r1', 'rv:agenda_app:r2'])
  assert.deepEqual(vendas.map((v) => Number(v.valor)).sort((a, b) => a - b), [1000, 3000])
})

test('reconcilia: evento desligado na empresa fica registrado como ignorado', async () => {
  const cfg = integracao(EMPRESA_A, { evento_agendada: false })
  const pool = criarPool({ integracoes: { [EMPRESA_A]: cfg }, reunioesApp: { [EMPRESA_A]: [reuniaoApp()] } })
  await reconciliarEmpresa(pool, EMPRESA_A, cfg)
  assert.equal(pool.registrados[0].status, 'ignorado')
  assert.equal(pool.registrados[0].motivo_ignorado, 'evento_desabilitado')
})

test('reconcilia: só lê reuniões DA empresa — a consulta leva empresa_id no 1º parâmetro', async () => {
  const pool = criarPool({ integracoes: { [EMPRESA_A]: integracao(EMPRESA_A) }, reunioesApp: {} })
  await reconciliarEmpresa(pool, EMPRESA_A, integracao(EMPRESA_A))
  const leituras = pool.chamadas.filter((c) => /FROM (app|vendas)\.agenda_eventos/.test(c.sql))
  assert.equal(leituras.length, 2, 'lê as duas agendas')
  for (const c of leituras) {
    assert.equal(c.params[0], EMPRESA_A)
  }
  // A agenda do bot não tem empresa_id: ela é resolvida pela conversa.
  const legada = leituras.find((c) => /FROM vendas\.agenda_eventos/.test(c.sql))
  assert.match(legada.sql, /c\.empresa_id = \$1/)
})

// ─── Despacho e isolamento ────────────────────────────────────────────────────

test('despacho: usa o dataset e o token DA EMPRESA do evento', async () => {
  const enviados = []
  const pool = criarPool({
    integracoes: { [EMPRESA_A]: integracao(EMPRESA_A), [EMPRESA_B]: integracao(EMPRESA_B) },
    pendentes: { [EMPRESA_A]: [pendente(EMPRESA_A)], [EMPRESA_B]: [pendente(EMPRESA_B, { event_id: 'ra:agenda_app:r9', entidade_id: 'r9' })] },
    atribuicoes: {
      [EMPRESA_A]: [{ telefone_norm: '5571999994821', ctwa_clid: 'CLID-A' }],
      [EMPRESA_B]: [{ telefone_norm: '5571999994821', ctwa_clid: 'CLID-B' }],
    },
  })
  const deps = {
    logger: SILENCIOSO,
    enviarEvento: async (config, evt) => { enviados.push({ config, evt }); return { ok: true, status: 200 } },
  }
  await despacharEmpresa(pool, EMPRESA_A, deps)
  await despacharEmpresa(pool, EMPRESA_B, deps)

  assert.equal(enviados.length, 2)
  assert.equal(enviados[0].config.datasetId, '111111111')
  assert.equal(enviados[0].config.token, 'token-A')
  assert.equal(enviados[0].config.wabaId, 'WABA-A')
  assert.equal(enviados[1].config.datasetId, '222222222')
  assert.equal(enviados[1].config.token, 'token-B')
  // Mesmo telefone nas duas empresas: cada uma recebe SEU ctwa_clid, nunca o da outra.
  assert.equal(enviados[0].evt.ctwaClid, 'CLID-A')
  assert.equal(enviados[1].evt.ctwaClid, 'CLID-B')
})

test('despacho: evento de outra empresa é BLOQUEADO, não enviado', async () => {
  const enviados = []
  // Cenário defensivo: uma linha do tenant B aparece na fila do tenant A.
  const pool = criarPool({
    integracoes: { [EMPRESA_A]: integracao(EMPRESA_A) },
    pendentes: { [EMPRESA_A]: [pendente(EMPRESA_B)] },
    atribuicoes: { [EMPRESA_A]: [{ telefone_norm: '5571999994821', ctwa_clid: 'CLID-A' }] },
  })
  const r = await despacharEmpresa(pool, EMPRESA_A, {
    logger: SILENCIOSO,
    enviarEvento: async (c, e) => { enviados.push(e); return { ok: true, status: 200 } },
  })
  assert.equal(enviados.length, 0, 'nada pode ser enviado com empresa inconsistente')
  assert.equal(r.ignorados, 1)
  const ignorou = pool.chamadas.find((c) => /status = 'ignorado'/.test(c.sql))
  assert.ok(ignorou, 'o evento é encerrado como ignorado')
  assert.equal(ignorou.params[2], 'empresa_nao_resolvida')
})

test('despacho: integração desativada entre o registro e o envio não manda nada', async () => {
  const enviados = []
  const pool = criarPool({
    integracoes: { [EMPRESA_A]: integracao(EMPRESA_A, { status: 'desativada' }) },
    pendentes: { [EMPRESA_A]: [pendente(EMPRESA_A)] },
  })
  const r = await despacharEmpresa(pool, EMPRESA_A, {
    logger: SILENCIOSO,
    enviarEvento: async (c, e) => { enviados.push(e); return { ok: true } },
  })
  assert.equal(enviados.length, 0)
  assert.equal(r.ignorados, 1)
  assert.equal(r.enviados, 0)
})

test('despacho: sem empresa nenhuma configurada, nada acontece (e nada é consultado a mais)', async () => {
  const pool = criarPool({ integracoes: {} })
  const r = await processarConversoesMeta(pool, { logger: SILENCIOSO })
  assert.deepEqual(r, { empresas: 0, enviados: 0 })
  assert.equal(pool.chamadas.length, 1, 'só a consulta de integrações ativas')
})

test('despacho: o momento enviado é o do FATO, não o do envio', async () => {
  let capturado = null
  const ocorrido = '2026-08-05T14:30:00.000Z'
  const pool = criarPool({
    integracoes: { [EMPRESA_A]: integracao(EMPRESA_A) },
    pendentes: { [EMPRESA_A]: [pendente(EMPRESA_A, { ocorrido_em: ocorrido })] },
    atribuicoes: { [EMPRESA_A]: [{ telefone_norm: '5571999994821', ctwa_clid: 'CLID-A' }] },
  })
  await despacharEmpresa(pool, EMPRESA_A, {
    logger: SILENCIOSO,
    enviarEvento: async (c, evt) => { capturado = evt; return { ok: true, status: 200 } },
  })
  assert.equal(capturado.eventTime, Math.floor(new Date(ocorrido).getTime() / 1000))
})

test('despacho: o nome enviado à Meta segue o mapeamento adotado', async () => {
  const nomes = []
  const pool = criarPool({
    integracoes: { [EMPRESA_A]: integracao(EMPRESA_A) },
    pendentes: {
      [EMPRESA_A]: [
        pendente(EMPRESA_A, { id: 'e1', tipo: 'reuniao_agendada', event_id: 'ra:agenda_app:r1' }),
        pendente(EMPRESA_A, { id: 'e2', tipo: 'reuniao_realizada', event_id: 'rr:agenda_app:r1' }),
        pendente(EMPRESA_A, { id: 'e3', tipo: 'reuniao_realizada_com_venda', event_id: 'rv:agenda_app:r1', valor: 2500, moeda: 'BRL' }),
      ],
    },
    atribuicoes: { [EMPRESA_A]: [{ telefone_norm: '5571999994821', ctwa_clid: 'CLID-A' }] },
  })
  await despacharEmpresa(pool, EMPRESA_A, {
    logger: SILENCIOSO,
    enviarEvento: async (c, evt) => { nomes.push([evt.eventName, evt.value ?? null]); return { ok: true, status: 200 } },
  })
  assert.deepEqual(nomes, [['LeadSubmitted', null], ['QualifiedLead', null], ['Purchase', 2500]])
})

// ─── Falhas ───────────────────────────────────────────────────────────────────

test('falha transitória: volta para a fila com backoff, sem derrubar a integração', async () => {
  const pool = criarPool({
    integracoes: { [EMPRESA_A]: integracao(EMPRESA_A) },
    pendentes: { [EMPRESA_A]: [pendente(EMPRESA_A)] },
    atribuicoes: { [EMPRESA_A]: [{ telefone_norm: '5571999994821', ctwa_clid: 'CLID-A' }] },
  })
  const r = await despacharEmpresa(pool, EMPRESA_A, {
    logger: SILENCIOSO,
    enviarEvento: async () => ({ ok: false, status: 503, motivo: 'erro_api', erro: {} }),
  })
  assert.equal(r.falhas, 1)
  assert.equal(r.enviados, 0)
  const falha = pool.chamadas.find((c) => /UPDATE app\.conversao_eventos/.test(c.sql) && /proxima_tentativa_em/.test(c.sql) && c.params.includes('pendente'))
  assert.ok(falha, 'evento volta para pendente com nova data de tentativa')
  assert.equal(pool.chamadas.some((c) => /precisa_atencao/.test(c.sql)), false)
})

test('falha permanente (token inválido): marca a integração e para o lote', async () => {
  const pool = criarPool({
    integracoes: { [EMPRESA_A]: integracao(EMPRESA_A) },
    pendentes: {
      [EMPRESA_A]: [
        pendente(EMPRESA_A, { id: 'e1', event_id: 'ra:agenda_app:r1' }),
        pendente(EMPRESA_A, { id: 'e2', event_id: 'ra:agenda_app:r2' }),
      ],
    },
    atribuicoes: { [EMPRESA_A]: [{ telefone_norm: '5571999994821', ctwa_clid: 'CLID-A' }] },
  })
  let tentativas = 0
  await despacharEmpresa(pool, EMPRESA_A, {
    logger: SILENCIOSO,
    enviarEvento: async () => {
      tentativas += 1
      return { ok: false, status: 400, motivo: 'erro_api', erro: { codigo: 190 } }
    },
  })
  assert.equal(tentativas, 1, 'não insiste com credencial ruim')
  const atencao = pool.chamadas.find((c) => /precisa_atencao/.test(c.sql))
  assert.ok(atencao, 'a integração inteira vai para "precisa de atenção"')
  assert.equal(atencao.params[0], EMPRESA_A)
  assert.match(String(atencao.params[1]), /Token inválido ou expirado/)
})

test('falha: a tentativa é registrada com diagnóstico, sem corpo cru da Meta', async () => {
  const pool = criarPool({
    integracoes: { [EMPRESA_A]: integracao(EMPRESA_A) },
    pendentes: { [EMPRESA_A]: [pendente(EMPRESA_A)] },
    atribuicoes: { [EMPRESA_A]: [{ telefone_norm: '5571999994821', ctwa_clid: 'CLID-A' }] },
  })
  await despacharEmpresa(pool, EMPRESA_A, {
    logger: SILENCIOSO,
    enviarEvento: async () => ({
      ok: false, status: 400, duracaoMs: 42,
      erro: { codigo: 100, subcodigo: 2804116, fbtraceId: 'FB9' },
    }),
  })
  const t = pool.chamadas.find((c) => /INSERT INTO app\.conversao_tentativas/.test(c.sql))
  assert.ok(t)
  assert.equal(t.params[1], EMPRESA_A)
  assert.equal(t.params[3], false) // ok
  assert.equal(t.params[4], 400) // http_status
  assert.equal(t.params[6], 2804116) // subcódigo
  assert.equal(t.params[8], 'FB9')
  assert.match(String(t.params[7]), /Página ou da conta WhatsApp Business/)
  // Nada de ctwa_clid nem telefone no registro de tentativa.
  assert.equal(t.params.some((p) => String(p).includes('CLID-A')), false)
})

test('ciclo: erro numa empresa não impede a outra de rodar', async () => {
  const pool = criarPool({
    integracoes: { [EMPRESA_A]: integracao(EMPRESA_A), [EMPRESA_B]: integracao(EMPRESA_B) },
    pendentes: { [EMPRESA_B]: [pendente(EMPRESA_B)] },
    atribuicoes: { [EMPRESA_B]: [{ telefone_norm: '5571999994821', ctwa_clid: 'CLID-B' }] },
  })
  const queryOriginal = pool.query
  let primeira = true
  pool.query = async (sql, params) => {
    if (primeira && /FROM app\.agenda_eventos/.test(sql) && params[0] === EMPRESA_A) {
      primeira = false
      throw new Error('falha simulada na empresa A')
    }
    return queryOriginal(sql, params)
  }
  const enviados = []
  const r = await processarConversoesMeta(pool, {
    logger: SILENCIOSO,
    enviarEvento: async (c, e) => { enviados.push(e); return { ok: true, status: 200 } },
  })
  assert.equal(r.empresas, 2)
  assert.equal(enviados.length, 1, 'a empresa B continuou sendo processada')
  assert.equal(r.enviados, 1)
})
