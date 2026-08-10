'use strict'

// O modo de IA no CAMINHO REAL, nao so nas regras puras.
//
// Tres frentes, porque tres coisas diferentes podem quebrar:
//   1. WEBHOOK  — a analise nao pode ser encurtada pelo modo. O webhook nao envia nada (ele
//                 enfileira o turno); se o modo aparecesse ali, o bloqueio mataria junto a
//                 analise, que e' exatamente o que o modo Analise existe para preservar.
//   2. ENVIADOR — o playbook (contexto2-responder) tem de ANALISAR e NAO ENVIAR em analise,
//                 e continuar identico a hoje em conversa.
//   3. ROTA     — validacao de entrada, isolamento por empresa e auditoria so na mudanca real.

const test = require('node:test')
const assert = require('node:assert')

const { registerWebhookRoute } = require('../src/webhook-handler')
const { createContexto2Responder } = require('../src/services/contexto2-responder')
const { alterarModoIaConversa } = require('../src/services/conversa-manual')
const { MODOS_IA, CAPACIDADES, MOTIVO_BLOQUEIO } = require('../src/services/conversa-modo-ia')

const EMPRESA = '11111111-1111-1111-1111-111111111111'
const OUTRA_EMPRESA = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const NUMERO = '5511988887777@s.whatsapp.net'

function stubLogger() {
  const registros = []
  const log = {
    child() { return log },
    info(o, m) { registros.push({ nivel: 'info', o, m }) },
    warn(o, m) { registros.push({ nivel: 'warn', o, m }) },
    error(o, m) { registros.push({ nivel: 'error', o, m }) },
  }
  return { log, registros }
}

// ─── 1. WEBHOOK: o modo nao pode encurtar a analise ───────────────────────────

/**
 * Monta o webhook com todas as dependencias observaveis. O ponto do teste e o que acontece
 * ANTES do turno de IA: salvar conversa, atualizar perfil, registrar eventos e enfileirar o
 * job. Nada aqui envia WhatsApp — o envio vive no turno, testado na secao 2.
 */
function montarWebhook(conversaExistente) {
  let handler
  const app = { post: (_p, cb) => { handler = cb } }
  const { log, registros } = stubLogger()
  const chamadas = {
    salvarConversa: [], atualizarPerfil: [], enfileirarJob: [],
    capturarNomeContato: [], eventosComerciais: [],
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
    extrairTextoEMidiaDoWebhook: async () => ({ texto: 'quanto custa?', visao: null }),
    buscarConversa: async () => conversaExistente,
    normalizarHistoricoMensagens: (h) => (Array.isArray(h) ? h : []),
    marcarProspectComoRespondeuPorNumero: async () => {},
    buscarContextoProspeccao: async () => null,
    textoEhAutoReplyWhatsApp: () => false,
    textoJaProcessadoRecentemente: () => false,
    atualizarPerfil: async (...a) => { chamadas.atualizarPerfil.push(a) },
    salvarConversa: async (...a) => { chamadas.salvarConversa.push(a) },
    capturarNomeContato: async (...a) => { chamadas.capturarNomeContato.push(a) },
    cancelarFollowupsAutoPendentes: async () => {},
    textoPedePreco: () => true,
    registrarEventoComercial: async (...a) => { chamadas.eventosComerciais.push(a) },
    marcarRespostaFollowupSeAplicavel: async () => {},
    registrarRespostaLembreteReuniao: async () => null,
    obterEstadoDebounceResposta: () => ({}),
    podeGerarRespostaAutomatica: () => true,
    enfileirarJobRespostaWebhook: async (...a) => { chamadas.enfileirarJob.push(a) },
    registrarAtribuicaoAnuncio: async () => ({ criado: false }),
    pool: {},
  })

  return { handler, chamadas, registros }
}

const requisicao = (modo) => ({
  body: {
    event: 'messages.upsert',
    data: { messages: [{ key: { id: 'M1', fromMe: false, remoteJid: NUMERO }, message: { conversation: 'quanto custa?' } }] },
  },
  empresaId: EMPRESA,
  empresaOrigem: 'instancia',
  whatsappInstanciaId: 'i1',
  evolutionInstance: 'inst-1',
  tenantPendencia: null,
  _modo: modo,
})
const resposta = () => ({ status() { return this }, json() { return this } })

for (const modo of [MODOS_IA.CONVERSA, MODOS_IA.ANALISE]) {
  test(`webhook (modo ${modo}): analise e registros acontecem e o turno e enfileirado`, async () => {
    const conversa = { numero: NUMERO, historico: [], estagio: 'diagnostico', status: 'ativo', modo_ia: modo }
    const { handler, chamadas } = montarWebhook(conversa)
    await handler(requisicao(modo), resposta())

    // O modo NAO pode encurtar nada disto: e o registro interno que o modo Analise preserva.
    assert.strictEqual(chamadas.salvarConversa.length, 1, 'a mensagem do lead precisa ser gravada')
    assert.strictEqual(chamadas.capturarNomeContato.length, 1)
    assert.ok(chamadas.eventosComerciais.some(([, tipo]) => tipo === 'pediu_preco'))
    // E o turno tem de ser enfileirado nos DOIS modos: e dentro dele que a IA analisa.
    assert.strictEqual(chamadas.enfileirarJob.length, 1, 'o turno de analise foi encurtado pelo modo')
  })
}

test('webhook: o modo nao aparece no webhook — quem decide entrega e o enviador', () => {
  // Guarda estrutural do desenho. Se `modo_ia` voltar a este arquivo, quase certamente
  // voltou como `return` cedo — matando a analise junto com o envio.
  const fs = require('node:fs')
  const path = require('node:path')
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'webhook-handler.js'), 'utf8')
  assert.ok(!/modo_ia/.test(fonte), 'webhook-handler.js passou a decidir o modo — o bloqueio pertence ao enviador')
})

test('webhook: agente pausado continua cortando o fluxo, como sempre', () => {
  // A pausa por intervencao humana e OUTRO mecanismo e nao foi tocada. O envio automatico
  // exige os dois liberados; este teste protege o "sempre foi assim" do agente_pausado.
  const conversa = { numero: NUMERO, historico: [], estagio: 'diagnostico', status: 'ativo', agente_pausado: true, modo_ia: MODOS_IA.CONVERSA }
  const { handler, chamadas } = montarWebhook(conversa)
  return handler(requisicao(MODOS_IA.CONVERSA), resposta()).then(() => {
    assert.strictEqual(chamadas.enfileirarJob.length, 0, 'agente pausado nao pode gerar turno de resposta')
    assert.strictEqual(chamadas.salvarConversa.length, 1, 'mesmo pausado, a mensagem do lead e gravada')
  })
})

// ─── 2. ENVIADOR: analisa nos dois modos, entrega so em um ────────────────────

function montarResponder(overrides = {}) {
  const { log } = stubLogger()
  const calls = { enviarMensagem: [], salvarConversa: [], atualizarPerfil: [], playbook: [] }
  const { responderContexto2 } = createContexto2Responder({
    pool: {},
    logger: log,
    processarMensagemComPlaybook: async (...a) => {
      calls.playbook.push(a)
      return {
        extracao: { interesse: 'alto' },
        decisao: { mensagem_pro_lead: 'Custa R$ 2.000.', atualizar_perfil: { produto_sugerido: 'site' } },
      }
    },
    buscarPerfil: async () => ({}),
    atualizarPerfil: async (...a) => { calls.atualizarPerfil.push(a) },
    salvarConversa: async (...a) => { calls.salvarConversa.push(a) },
    limparFalhaResposta: async () => {},
    alertarHandoff: async () => {},
    enviarMensagem: async (...a) => { calls.enviarMensagem.push(a) },
    buscarSlotsDisponiveis: async () => null,
    validarSlotReuniao: async () => false,
    ...overrides,
  })
  return { responderContexto2, calls }
}

const historicoBase = [{ role: 'user', content: 'quanto custa?' }]

test('enviador em modo conversa: comportamento identico ao de hoje', async () => {
  const { responderContexto2, calls } = montarResponder()
  const r = await responderContexto2({
    numero: NUMERO, empresaId: EMPRESA, historico: historicoBase, estagioLive: 'diagnostico',
    conversaUsada: { status: 'ativo', evolution_instance: 'inst-1', modo_ia: MODOS_IA.CONVERSA },
  })

  assert.deepStrictEqual(r, { ok: true, via: 'playbook' })
  assert.strictEqual(calls.enviarMensagem.length, 1)
  const histSalvo = calls.salvarConversa[0][1]
  assert.strictEqual(histSalvo[histSalvo.length - 1].role, 'assistant')
})

test('enviador em modo analise: analisa, registra e NAO envia', async () => {
  const { responderContexto2, calls } = montarResponder()
  const r = await responderContexto2({
    numero: NUMERO, empresaId: EMPRESA, historico: historicoBase, estagioLive: 'diagnostico',
    conversaUsada: { status: 'ativo', evolution_instance: 'inst-1', modo_ia: MODOS_IA.ANALISE },
  })

  // A analise rodou inteira: o playbook foi consultado (e' ele quem grava lead_insights) e
  // o patch de perfil da decisao foi aplicado.
  assert.strictEqual(calls.playbook.length, 1, 'a analise foi pulada')
  assert.ok(calls.atualizarPerfil.some((a) => a[1]?.produto_sugerido === 'site'))
  // E nada saiu para o cliente.
  assert.strictEqual(calls.enviarMensagem.length, 0, 'a IA enviou mensagem em modo Analise')
  assert.deepStrictEqual(r, { skipped: true, reason: MOTIVO_BLOQUEIO.MODO_ANALISE, analise_registrada: true })
})

test('enviador em modo analise: a resposta nao entregue NAO vira mensagem do assistente', async () => {
  // Se isto quebrar, o painel mostra ao operador um balao do agente que o cliente nunca
  // recebeu — e o proximo turno raciocina sobre uma fala que nao existiu.
  const { responderContexto2, calls } = montarResponder()
  await responderContexto2({
    numero: NUMERO, empresaId: EMPRESA, historico: historicoBase, estagioLive: 'diagnostico',
    conversaUsada: { status: 'ativo', evolution_instance: 'inst-1', modo_ia: MODOS_IA.ANALISE },
  })
  const salvouAssistente = calls.salvarConversa.some(([, hist]) =>
    Array.isArray(hist) && hist.some((m) => m?.role === 'assistant'))
  assert.strictEqual(salvouAssistente, false)
})

test('enviador: follow-up atravessa o modo analise (capacidade propria)', async () => {
  // Regra de produto: follow-up nao depende deste toggle.
  const { responderContexto2, calls } = montarResponder()
  const r = await responderContexto2({
    numero: NUMERO, empresaId: EMPRESA, historico: historicoBase, estagioLive: 'diagnostico',
    conversaUsada: { status: 'ativo', evolution_instance: 'inst-1', modo_ia: MODOS_IA.ANALISE },
    capacidade: CAPACIDADES.FOLLOW_UP,
  })
  assert.deepStrictEqual(r, { ok: true, via: 'playbook' })
  assert.strictEqual(calls.enviarMensagem.length, 1)
})

test('enviador: conversa sem modo gravado responde normalmente', async () => {
  const { responderContexto2, calls } = montarResponder()
  await responderContexto2({
    numero: NUMERO, empresaId: EMPRESA, historico: historicoBase, estagioLive: 'diagnostico',
    conversaUsada: { status: 'ativo', evolution_instance: 'inst-1' },
  })
  assert.strictEqual(calls.enviarMensagem.length, 1)
})

test('enviador em modo analise: o log do bloqueio nao carrega PII', async () => {
  const { log, registros } = stubLogger()
  const { responderContexto2 } = montarResponder({ logger: log })
  await responderContexto2({
    numero: NUMERO, empresaId: EMPRESA, historico: historicoBase, estagioLive: 'diagnostico',
    conversaUsada: { status: 'ativo', evolution_instance: 'inst-1', modo_ia: MODOS_IA.ANALISE },
  })
  const bloqueio = registros.find((r) => r.o?.etapa === 'envio_bloqueado')
  assert.ok(bloqueio, 'o bloqueio precisa ser registrado')
  const serializado = JSON.stringify(bloqueio)
  assert.ok(!serializado.includes('5511988887777'))
  assert.ok(!serializado.includes('Custa R$'), 'o texto nao enviado vazou para o log')
})

// ─── 3. ROTA / SERVICO: validacao, isolamento e auditoria ─────────────────────

/** "Banco" minimo: uma tabela de conversas e o log de auditoria. */
function montarPool(conversas) {
  const auditoria = []
  const pool = {
    async query(sql, params) {
      if (/INSERT INTO app\.auditoria_eventos/.test(sql)) {
        auditoria.push({ empresaId: params[0], usuarioId: params[1], entidadeTipo: params[2], acao: params[4], estadoAnterior: params[5], estadoNovo: params[6], contexto: JSON.parse(params[7]) })
        return { rows: [{ id: 'a1', ocorrido_em: new Date() }] }
      }
      const [empresaId, , numero, modoNovo] = params
      const linha = conversas.find((c) => c.numero === numero && c.empresa_id === empresaId)
      if (/^\s*WITH anterior/.test(sql)) {
        if (!linha || linha.modo_ia === modoNovo) return { rows: [] }
        const anterior = linha.modo_ia
        linha.modo_ia = modoNovo
        return { rows: [{ ...linha, modo_anterior: anterior }] }
      }
      return { rows: linha ? [linha] : [] }
    },
  }
  return { pool, auditoria }
}

const conversaPadrao = () => ([{ numero: NUMERO, empresa_id: EMPRESA, modo_ia: MODOS_IA.CONVERSA, agente_pausado: false, estagio: 'diagnostico', status: 'ativo' }])

test('rota: modo fora da lista fechada e recusado com 400', async () => {
  const { pool } = montarPool(conversaPadrao())
  for (const invalido of ['pausado', '', null, 'ANALISE_TOTAL', 42]) {
    await assert.rejects(
      () => alterarModoIaConversa({ pool, empresaId: EMPRESA, numero: NUMERO, modo: invalido }),
      (err) => err.statusCode === 400 && err.code === 'MODO_IA_INVALIDO'
    )
  }
})

test('rota: conversa de outra empresa devolve 404, sem vazar a linha alheia', async () => {
  const { pool } = montarPool(conversaPadrao())
  await assert.rejects(
    () => alterarModoIaConversa({ pool, empresaId: OUTRA_EMPRESA, numero: NUMERO, modo: MODOS_IA.ANALISE }),
    (err) => err.statusCode === 404 && err.code === 'NOT_FOUND'
  )
})

test('rota: mudanca real grava UMA linha de auditoria, com anterior e novo', async () => {
  const { pool, auditoria } = montarPool(conversaPadrao())
  const out = await alterarModoIaConversa({
    pool, empresaId: EMPRESA, numero: NUMERO, modo: MODOS_IA.ANALISE, usuarioId: 'u1',
  })

  assert.strictEqual(out.alterado, true)
  assert.strictEqual(out.modo_ia, MODOS_IA.ANALISE)
  assert.strictEqual(out.modo_anterior, MODOS_IA.CONVERSA)
  assert.strictEqual(auditoria.length, 1)
  assert.strictEqual(auditoria[0].acao, 'conversa_modo_ia_alterado')
  assert.strictEqual(auditoria[0].entidadeTipo, 'conversa')
  assert.strictEqual(auditoria[0].usuarioId, 'u1')
  assert.deepStrictEqual(auditoria[0].contexto, {
    modo_anterior: MODOS_IA.CONVERSA,
    modo_novo: MODOS_IA.ANALISE,
    telefone_digitos: '5511988887777',
  })
})

test('rota: auditoria nao guarda JID nem texto de mensagem', async () => {
  const { pool, auditoria } = montarPool(conversaPadrao())
  await alterarModoIaConversa({ pool, empresaId: EMPRESA, numero: NUMERO, modo: MODOS_IA.ANALISE })
  assert.ok(!JSON.stringify(auditoria[0]).includes('@s.whatsapp.net'))
})

test('rota: repetir a mesma mudanca nao infla a auditoria', async () => {
  const { pool, auditoria } = montarPool(conversaPadrao())
  await alterarModoIaConversa({ pool, empresaId: EMPRESA, numero: NUMERO, modo: MODOS_IA.ANALISE })
  const segunda = await alterarModoIaConversa({ pool, empresaId: EMPRESA, numero: NUMERO, modo: MODOS_IA.ANALISE })

  assert.strictEqual(segunda.alterado, false)
  assert.strictEqual(segunda.modo_ia, MODOS_IA.ANALISE, 'o estado devolvido continua correto')
  assert.strictEqual(auditoria.length, 1, 'clicar duas vezes no mesmo modo criou linha nova')
})

test('rota: o modo persiste e volta na leitura da conversa', async () => {
  const conversas = conversaPadrao()
  const { pool } = montarPool(conversas)
  await alterarModoIaConversa({ pool, empresaId: EMPRESA, numero: NUMERO, modo: MODOS_IA.ANALISE })
  assert.strictEqual(conversas[0].modo_ia, MODOS_IA.ANALISE)
})

test('rota: trocar o modo nao mexe em agente_pausado', async () => {
  // Sao dois fatos independentes. Se um passar a escrever o outro, a pausa automatica
  // apagaria a decisao do operador (ou vice-versa).
  const conversas = conversaPadrao()
  conversas[0].agente_pausado = true
  const { pool } = montarPool(conversas)
  const out = await alterarModoIaConversa({ pool, empresaId: EMPRESA, numero: NUMERO, modo: MODOS_IA.ANALISE })
  assert.strictEqual(conversas[0].agente_pausado, true)
  assert.strictEqual(out.agente_pausado, true)
})
