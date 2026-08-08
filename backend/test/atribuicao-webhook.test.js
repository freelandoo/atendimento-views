'use strict'

// Captura de atribuição CTWA DENTRO do webhook: prova que o isolamento por empresa e
// instância acontece no caminho real (registerWebhookRoute), não só nas regras puras.

const test = require('node:test')
const assert = require('node:assert')

const { registerWebhookRoute } = require('../src/webhook-handler')
const { ORIGEM_EMPRESA, MOTIVO } = require('../src/services/ctwa-atribuicao')

const EMPRESA_A = '11111111-1111-1111-1111-111111111111'
const EMPRESA_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const INSTANCIA_1 = '22222222-2222-2222-2222-222222222222'
const INSTANCIA_2 = '33333333-3333-3333-3333-333333333333'
const NUMERO = '5511988887777@s.whatsapp.net'

function mensagemDeAnuncio({ id = 'MSG-1', clid = 'ARBxyzCLID9999', adId = 'ad-123' } = {}) {
  return {
    key: { id, fromMe: false, remoteJid: NUMERO },
    pushName: 'Fulano',
    message: {
      extendedTextMessage: {
        text: 'oi, vi o anuncio',
        contextInfo: {
          externalAdReply: { sourceId: adId, ctwaClid: clid, title: 'Site em 7 dias', sourceUrl: 'https://fb.me/x' },
        },
      },
    },
  }
}

function mensagemComum(id = 'MSG-COMUM') {
  return { key: { id, fromMe: false, remoteJid: NUMERO }, message: { conversation: 'bom dia' } }
}

/**
 * Monta o webhook com um "banco" em memória para a atribuição e desliga tudo o que vem
 * depois da captura (a mensagem para logo após, sem tocar conversa/IA/envio).
 */
function montarWebhook() {
  let handler
  const app = { post: (_p, cb) => { handler = cb } }
  const logs = []
  const log = {
    child: () => log,
    info: (obj, msg) => logs.push({ nivel: 'info', obj, msg }),
    warn: (obj, msg) => logs.push({ nivel: 'warn', obj, msg }),
    error: (obj, msg) => logs.push({ nivel: 'error', obj, msg }),
  }
  // "Tabela" app.atribuicao_anuncios, com o índice único (empresa_id, mensagem_id).
  const tabela = []
  const registrarAtribuicaoAnuncio = async (_pool, empresaId, registro) => {
    if (!empresaId) throw new Error('sem empresa')
    const dup = tabela.some((r) => r.empresaId === empresaId && r.mensagemId === registro.mensagemId)
    if (dup) return { criado: false, id: null }
    tabela.push({ ...registro, empresaId })
    return { criado: true, id: tabela.length }
  }

  registerWebhookRoute(app, {
    webhookAutorizado: () => true,
    gerarRequestIdAnthropic: () => 'rid',
    loggerForWebhook: () => log,
    logger: log,
    serializeError: (e) => ({ message: e.message }),
    eventoSaudeDeWebhook: () => null,
    registrarEventoSaudeInstancia: async () => {},
    canonicoRemoteJidParaConversa: (key) => key?.remoteJid || null,
    isConversaLeadUmAUm: () => true,
    listarOperadoresAtivos: async () => [],
    jidIgual: () => false,
    construirChaveIdempotenciaWebhookMensagem: (m) => m.key.id,
    webhookMensagemDeveSerProcessada: async () => true,
    // Encerra o fluxo logo depois da captura: nada de conversa, IA ou envio no teste.
    extrairTextoEMidiaDoWebhook: async () => ({ texto: null, visao: null }),
    pool: { marcador: 'pool-fake' },
    registrarAtribuicaoAnuncio,
  })

  const res = { status: () => ({ json: () => {} }), json: () => {} }
  const receber = (msg, req = {}) => handler({ headers: {}, body: { event: 'messages.upsert', data: msg }, ...req }, res)
  return { receber, tabela, logs }
}

const reqOk = (extra = {}) => ({
  empresaId: EMPRESA_A,
  empresaOrigem: ORIGEM_EMPRESA.INSTANCIA,
  whatsappInstanciaId: INSTANCIA_1,
  evolutionInstance: 'inst-a',
  ...extra,
})

// ─── Caminho feliz ────────────────────────────────────────────────────────────

test('mensagem de anúncio com empresa e instância válidas cria atribuição escopada', async () => {
  const { receber, tabela } = montarWebhook()
  await receber(mensagemDeAnuncio(), reqOk())

  assert.equal(tabela.length, 1)
  assert.equal(tabela[0].empresaId, EMPRESA_A)
  assert.equal(tabela[0].instanciaId, INSTANCIA_1)
  assert.equal(tabela[0].evolutionInstance, 'inst-a')
  assert.equal(tabela[0].telefoneNorm, '5511988887777')
  assert.equal(tabela[0].elegivel, true)
  assert.equal(tabela[0].adId, 'ad-123')
})

test('mensagem sem externalAdReply não cria atribuição', async () => {
  const { receber, tabela } = montarWebhook()
  await receber(mensagemComum(), reqOk())
  assert.equal(tabela.length, 0)
})

// ─── Dono não comprovado ──────────────────────────────────────────────────────

test('instância desconhecida não cria atribuição elegível', async () => {
  const { receber, tabela, logs } = montarWebhook()
  await receber(mensagemDeAnuncio(), reqOk({
    empresaOrigem: ORIGEM_EMPRESA.FALLBACK_INSTANCIA_DESCONHECIDA,
    whatsappInstanciaId: null,
  }))
  assert.equal(tabela.length, 0)
  const descarte = logs.find((l) => l.obj?.etapa === 'descartada')
  assert.ok(descarte, 'o descarte precisa ficar auditável')
  assert.equal(descarte.obj.motivo, MOTIVO.EMPRESA_NAO_COMPROVADA)
})

test('webhook sem instância não cria atribuição elegível', async () => {
  const { receber, tabela, logs } = montarWebhook()
  await receber(mensagemDeAnuncio(), reqOk({
    empresaOrigem: ORIGEM_EMPRESA.FALLBACK_SEM_INSTANCIA,
    whatsappInstanciaId: null,
    evolutionInstance: null,
  }))
  assert.equal(tabela.length, 0)
  assert.ok(logs.some((l) => l.obj?.motivo === MOTIVO.EMPRESA_NAO_COMPROVADA))
})

test('empresa resolvida por fallback não cria atribuição elegível', async () => {
  const { receber, tabela } = montarWebhook()
  await receber(mensagemDeAnuncio(), reqOk({ empresaOrigem: ORIGEM_EMPRESA.FALLBACK_ERRO }))
  assert.equal(tabela.length, 0)
})

test('empresa comprovada mas SEM id de instância também é recusada', async () => {
  const { receber, tabela, logs } = montarWebhook()
  await receber(mensagemDeAnuncio(), reqOk({ whatsappInstanciaId: null }))
  assert.equal(tabela.length, 0)
  assert.ok(logs.some((l) => l.obj?.motivo === MOTIVO.INSTANCIA_NAO_COMPROVADA))
})

// ─── Idempotência e isolamento ────────────────────────────────────────────────

test('a mesma atribuição recebida mais de uma vez não duplica registro', async () => {
  const { receber, tabela } = montarWebhook()
  await receber(mensagemDeAnuncio({ id: 'MSG-REPETIDA' }), reqOk())
  await receber(mensagemDeAnuncio({ id: 'MSG-REPETIDA' }), reqOk())
  await receber(mensagemDeAnuncio({ id: 'MSG-REPETIDA' }), reqOk())
  assert.equal(tabela.length, 1)
})

test('clique NOVO do mesmo lead (mensagem nova) cria registro novo', async () => {
  const { receber, tabela } = montarWebhook()
  await receber(mensagemDeAnuncio({ id: 'MSG-1', adId: 'ad-123' }), reqOk())
  await receber(mensagemDeAnuncio({ id: 'MSG-2', adId: 'ad-999', clid: 'OUTROCLID4321' }), reqOk())
  assert.equal(tabela.length, 2, 'a idempotência não pode congelar o lead numa única atribuição')
  assert.deepEqual(tabela.map((r) => r.adId), ['ad-123', 'ad-999'])
})

test('duas instâncias da MESMA empresa não compartilham atribuição', async () => {
  const { receber, tabela } = montarWebhook()
  await receber(mensagemDeAnuncio({ id: 'M-INST1' }), reqOk({ whatsappInstanciaId: INSTANCIA_1, evolutionInstance: 'inst-a' }))
  await receber(mensagemDeAnuncio({ id: 'M-INST2' }), reqOk({ whatsappInstanciaId: INSTANCIA_2, evolutionInstance: 'inst-b' }))
  assert.equal(tabela.length, 2)
  assert.deepEqual(tabela.map((r) => r.instanciaId), [INSTANCIA_1, INSTANCIA_2])
  assert.equal(new Set(tabela.map((r) => r.instanciaId)).size, 2)
})

test('empresas diferentes gravam sob donos diferentes, mesmo com o mesmo telefone', async () => {
  const { receber, tabela } = montarWebhook()
  await receber(mensagemDeAnuncio({ id: 'M-A' }), reqOk({ empresaId: EMPRESA_A }))
  await receber(mensagemDeAnuncio({ id: 'M-B' }), reqOk({ empresaId: EMPRESA_B, whatsappInstanciaId: INSTANCIA_2 }))
  assert.deepEqual(tabela.map((r) => r.empresaId), [EMPRESA_A, EMPRESA_B])
})

// ─── Privacidade ──────────────────────────────────────────────────────────────

test('nenhum log da captura carrega telefone, ctwa_clid completo ou texto da mensagem', async () => {
  const { receber, logs } = montarWebhook()
  await receber(mensagemDeAnuncio(), reqOk())
  const serializado = JSON.stringify(logs)
  for (const proibido of ['5511988887777', 'ARBxyzCLID9999', 'oi, vi o anuncio', 'Site em 7 dias', 'fb.me']) {
    assert.ok(!serializado.includes(proibido), `log não pode conter "${proibido}"`)
  }
  const capturado = logs.find((l) => l.obj?.etapa === 'registrada')
  assert.ok(capturado)
  assert.equal(capturado.obj.ctwa_clid_hint, '…9999')
})

// ─── Isolamento do atendimento ────────────────────────────────────────────────

test('falha ao gravar a atribuição NÃO derruba o webhook', async () => {
  let handler
  const app = { post: (_p, cb) => { handler = cb } }
  const log = { child: () => log, info: () => {}, warn: () => {}, error: () => {} }
  let seguiu = false
  registerWebhookRoute(app, {
    webhookAutorizado: () => true,
    gerarRequestIdAnthropic: () => 'rid',
    loggerForWebhook: () => log,
    logger: log,
    serializeError: (e) => ({ message: e.message }),
    eventoSaudeDeWebhook: () => null,
    registrarEventoSaudeInstancia: async () => {},
    canonicoRemoteJidParaConversa: (key) => key?.remoteJid || null,
    isConversaLeadUmAUm: () => true,
    listarOperadoresAtivos: async () => [],
    jidIgual: () => false,
    construirChaveIdempotenciaWebhookMensagem: (m) => m.key.id,
    webhookMensagemDeveSerProcessada: async () => true,
    registrarAtribuicaoAnuncio: async () => { throw new Error('banco fora do ar') },
    extrairTextoEMidiaDoWebhook: async () => { seguiu = true; return { texto: null, visao: null } },
  })
  await handler(
    { headers: {}, body: { event: 'messages.upsert', data: mensagemDeAnuncio() }, ...reqOk() },
    { status: () => ({ json: () => {} }), json: () => {} }
  )
  assert.equal(seguiu, true, 'o atendimento precisa continuar mesmo se a captura falhar')
})
