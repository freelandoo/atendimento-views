'use strict'

// O modo de IA no CAMINHO REAL, nao so nas regras puras.
//
// Quatro frentes, porque quatro coisas diferentes podem quebrar:
//   1. WEBHOOK    — a analise nao pode ser encurtada pelo modo. O webhook nao envia nada
//                   (ele enfileira o turno); se o modo aparecesse ali, o bloqueio mataria
//                   junto a analise, que e' o que o modo Analise existe para preservar.
//   2. ENVIADOR   — a precedencia (excecao da conversa > padrao da Central) exercitada no
//                   motor de verdade, com a analise rodando nos quatro casos.
//   3. ROTA       — validacao de entrada, isolamento por empresa e auditoria so na mudanca.
//   4. MODO GLOBAL— leitura, cache e o que acontece quando o banco falha.

const test = require('node:test')
const assert = require('node:assert')

const { registerWebhookRoute } = require('../src/webhook-handler')
const { createContexto2Responder } = require('../src/services/contexto2-responder')
const { alterarModoIaConversa } = require('../src/services/conversa-manual')
const {
  MODOS_IA,
  PREFERENCIAS,
  ORIGEM_MODO,
  CAPACIDADES,
  MOTIVO_BLOQUEIO,
} = require('../src/services/conversa-modo-ia')

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
 * Monta o webhook com todas as dependencias observaveis. O ponto do teste e' o que acontece
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

const requisicao = () => ({
  body: {
    event: 'messages.upsert',
    data: { messages: [{ key: { id: 'M1', fromMe: false, remoteJid: NUMERO }, message: { conversation: 'quanto custa?' } }] },
  },
  empresaId: EMPRESA,
  empresaOrigem: 'instancia',
  whatsappInstanciaId: 'i1',
  evolutionInstance: 'inst-1',
  tenantPendencia: null,
})
const resposta = () => ({ status() { return this }, json() { return this } })

for (const preferencia of [PREFERENCIAS.HERDAR, PREFERENCIAS.CONVERSA, PREFERENCIAS.ANALISE]) {
  test(`webhook (preferencia ${preferencia}): analise e registros acontecem e o turno e enfileirado`, async () => {
    const conversa = { numero: NUMERO, historico: [], estagio: 'diagnostico', status: 'ativo', modo_ia: preferencia }
    const { handler, chamadas } = montarWebhook(conversa)
    await handler(requisicao(), resposta())

    // O modo NAO pode encurtar nada disto: e' o registro interno que o modo Analise preserva.
    assert.strictEqual(chamadas.salvarConversa.length, 1, 'a mensagem do lead precisa ser gravada')
    assert.strictEqual(chamadas.capturarNomeContato.length, 1)
    assert.ok(chamadas.eventosComerciais.some(([, tipo]) => tipo === 'pediu_preco'))
    // E o turno tem de ser enfileirado nos tres casos: e' dentro dele que a IA analisa.
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

test('webhook: agente pausado continua cortando o fluxo, como sempre', async () => {
  // A pausa por intervencao humana e' OUTRO mecanismo e nao foi tocada. O envio automatico
  // exige os dois liberados; este teste protege o "sempre foi assim" do agente_pausado.
  const conversa = {
    numero: NUMERO, historico: [], estagio: 'diagnostico', status: 'ativo',
    agente_pausado: true, modo_ia: PREFERENCIAS.HERDAR,
  }
  const { handler, chamadas } = montarWebhook(conversa)
  await handler(requisicao(), resposta())
  assert.strictEqual(chamadas.enfileirarJob.length, 0, 'agente pausado nao pode gerar turno de resposta')
  assert.strictEqual(chamadas.salvarConversa.length, 1, 'mesmo pausado, a mensagem do lead e gravada')
})

// ─── 2. ENVIADOR: analisa sempre, entrega conforme a precedencia ──────────────

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

function responder(responderContexto2, { preferencia, modoGlobal, capacidade } = {}) {
  return responderContexto2({
    numero: NUMERO,
    empresaId: EMPRESA,
    historico: historicoBase,
    estagioLive: 'diagnostico',
    conversaUsada: { status: 'ativo', evolution_instance: 'inst-1', modo_ia: preferencia },
    modoGlobal,
    ...(capacidade ? { capacidade } : {}),
  })
}

// A matriz de precedencia, exercitada no ENVIADOR e nao so nas regras puras.
const CASOS_ENTREGA = [
  { preferencia: 'herdar', modoGlobal: 'conversa', envia: true, nota: 'herda a Central em Conversa' },
  { preferencia: 'herdar', modoGlobal: 'analise', envia: false, nota: 'herda a Central em Analise' },
  { preferencia: 'conversa', modoGlobal: 'analise', envia: true, nota: 'excecao Conversa resiste a Central em Analise' },
  { preferencia: 'analise', modoGlobal: 'conversa', envia: false, nota: 'excecao Analise resiste a Central em Conversa' },
]

for (const caso of CASOS_ENTREGA) {
  test(`enviador: ${caso.nota} => ${caso.envia ? 'envia' : 'NAO envia'}`, async () => {
    const { responderContexto2, calls } = montarResponder()
    const r = await responder(responderContexto2, caso)

    // A ANALISE roda nos quatro casos: o playbook e' quem grava lead_insights, e o patch de
    // perfil da decisao e' aplicado antes de qualquer decisao de entrega.
    assert.strictEqual(calls.playbook.length, 1, 'a analise foi pulada')
    assert.ok(calls.atualizarPerfil.some((a) => a[1]?.produto_sugerido === 'site'))

    if (caso.envia) {
      assert.deepStrictEqual(r, { ok: true, via: 'playbook' })
      assert.strictEqual(calls.enviarMensagem.length, 1)
      const histSalvo = calls.salvarConversa[0][1]
      assert.strictEqual(histSalvo[histSalvo.length - 1].role, 'assistant')
    } else {
      assert.strictEqual(calls.enviarMensagem.length, 0, 'a IA enviou mensagem em modo Analise')
      assert.deepStrictEqual(r, { skipped: true, reason: MOTIVO_BLOQUEIO.MODO_ANALISE, analise_registrada: true })
    }
  })
}

test('enviador: a resposta nao entregue NAO vira mensagem do assistente', async () => {
  // Se isto quebrar, o painel mostra ao operador um balao do agente que o cliente nunca
  // recebeu — e o proximo turno raciocina sobre uma fala que nao existiu.
  const { responderContexto2, calls } = montarResponder()
  await responder(responderContexto2, { preferencia: 'herdar', modoGlobal: 'analise' })
  const salvouAssistente = calls.salvarConversa.some(([, hist]) =>
    Array.isArray(hist) && hist.some((m) => m?.role === 'assistant'))
  assert.strictEqual(salvouAssistente, false)
})

test('enviador: follow-up atravessa o modo analise, venha ele da Central ou da excecao', async () => {
  // Regra de produto: follow-up nao depende deste toggle, em nenhuma das duas origens.
  for (const preferencia of ['herdar', 'analise']) {
    const { responderContexto2, calls } = montarResponder()
    const r = await responder(responderContexto2, {
      preferencia, modoGlobal: 'analise', capacidade: CAPACIDADES.FOLLOW_UP,
    })
    assert.deepStrictEqual(r, { ok: true, via: 'playbook' })
    assert.strictEqual(calls.enviarMensagem.length, 1, `follow-up barrado com preferencia ${preferencia}`)
  }
})

test('enviador: conversa e Central sem valor gravado respondem normalmente', async () => {
  // Comportamento historico: quem nunca configurou nada continua sendo atendido.
  const { responderContexto2, calls } = montarResponder()
  await responder(responderContexto2, {})
  assert.strictEqual(calls.enviarMensagem.length, 1)
})

test('enviador: o log do bloqueio diz a ORIGEM e nao carrega PII', async () => {
  const { log, registros } = stubLogger()
  const { responderContexto2 } = montarResponder({ logger: log })
  await responder(responderContexto2, { preferencia: 'herdar', modoGlobal: 'analise' })

  const bloqueio = registros.find((r) => r.o?.etapa === 'envio_bloqueado')
  assert.ok(bloqueio, 'o bloqueio precisa ser registrado')
  assert.strictEqual(bloqueio.o.origem, ORIGEM_MODO.HERDADO, 'sem a origem, o operador nao sabe onde mexer')
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
        auditoria.push({
          empresaId: params[0], usuarioId: params[1], entidadeTipo: params[2],
          acao: params[4], estadoAnterior: params[5], estadoNovo: params[6],
          contexto: JSON.parse(params[7]),
        })
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

const conversaPadrao = (modo = PREFERENCIAS.HERDAR) => ([{
  numero: NUMERO, empresa_id: EMPRESA, modo_ia: modo,
  agente_pausado: false, estagio: 'diagnostico', status: 'ativo',
}])

test('rota: preferencia fora da lista fechada e recusada com 400', async () => {
  const { pool } = montarPool(conversaPadrao())
  for (const invalido of ['pausado', '', null, 'HERDAR_TUDO', 42]) {
    await assert.rejects(
      () => alterarModoIaConversa({ pool, empresaId: EMPRESA, numero: NUMERO, modo: invalido }),
      (err) => err.statusCode === 400 && err.code === 'MODO_IA_INVALIDO'
    )
  }
})

test('rota: `herdar` E uma preferencia valida — e como se remove a excecao', async () => {
  const conversas = conversaPadrao(PREFERENCIAS.ANALISE)
  const { pool } = montarPool(conversas)
  const out = await alterarModoIaConversa({ pool, empresaId: EMPRESA, numero: NUMERO, modo: PREFERENCIAS.HERDAR })
  assert.strictEqual(out.alterado, true)
  assert.strictEqual(out.modo_ia, PREFERENCIAS.HERDAR)
  assert.strictEqual(out.modo_anterior, PREFERENCIAS.ANALISE)
  assert.strictEqual(conversas[0].modo_ia, PREFERENCIAS.HERDAR)
})

test('rota: conversa de outra empresa devolve 404, sem vazar a linha alheia', async () => {
  const { pool } = montarPool(conversaPadrao())
  await assert.rejects(
    () => alterarModoIaConversa({ pool, empresaId: OUTRA_EMPRESA, numero: NUMERO, modo: PREFERENCIAS.ANALISE }),
    (err) => err.statusCode === 404 && err.code === 'NOT_FOUND'
  )
})

test('rota: mudanca real grava UMA linha de auditoria, com anterior e novo', async () => {
  const { pool, auditoria } = montarPool(conversaPadrao())
  const out = await alterarModoIaConversa({
    pool, empresaId: EMPRESA, numero: NUMERO, modo: PREFERENCIAS.ANALISE, usuarioId: 'u1',
  })

  assert.strictEqual(out.alterado, true)
  assert.strictEqual(out.modo_ia, PREFERENCIAS.ANALISE)
  assert.strictEqual(out.modo_anterior, PREFERENCIAS.HERDAR)
  assert.strictEqual(auditoria.length, 1)
  assert.strictEqual(auditoria[0].acao, 'conversa_modo_ia_alterado')
  assert.strictEqual(auditoria[0].entidadeTipo, 'conversa')
  assert.strictEqual(auditoria[0].usuarioId, 'u1')
  assert.deepStrictEqual(auditoria[0].contexto, {
    modo_anterior: PREFERENCIAS.HERDAR,
    modo_novo: PREFERENCIAS.ANALISE,
    telefone_digitos: '5511988887777',
  })
})

test('rota: auditoria nao guarda JID nem texto de mensagem', async () => {
  const { pool, auditoria } = montarPool(conversaPadrao())
  await alterarModoIaConversa({ pool, empresaId: EMPRESA, numero: NUMERO, modo: PREFERENCIAS.ANALISE })
  assert.ok(!JSON.stringify(auditoria[0]).includes('@s.whatsapp.net'))
})

test('rota: repetir a mesma escolha nao infla a auditoria', async () => {
  const { pool, auditoria } = montarPool(conversaPadrao())
  await alterarModoIaConversa({ pool, empresaId: EMPRESA, numero: NUMERO, modo: PREFERENCIAS.ANALISE })
  const segunda = await alterarModoIaConversa({ pool, empresaId: EMPRESA, numero: NUMERO, modo: PREFERENCIAS.ANALISE })

  assert.strictEqual(segunda.alterado, false)
  assert.strictEqual(segunda.modo_ia, PREFERENCIAS.ANALISE, 'o estado devolvido continua correto')
  assert.strictEqual(auditoria.length, 1, 'clicar duas vezes na mesma opcao criou linha nova')
})

test('rota: trocar a preferencia nao mexe em agente_pausado', async () => {
  // Sao dois fatos independentes. Se um passar a escrever o outro, a pausa automatica
  // apagaria a decisao do operador (ou vice-versa).
  const conversas = conversaPadrao()
  conversas[0].agente_pausado = true
  const { pool } = montarPool(conversas)
  const out = await alterarModoIaConversa({ pool, empresaId: EMPRESA, numero: NUMERO, modo: PREFERENCIAS.ANALISE })
  assert.strictEqual(conversas[0].agente_pausado, true)
  assert.strictEqual(out.agente_pausado, true)
})

// ─── 4. MODO GLOBAL: leitura, cache e falha transitoria ───────────────────────

const dbReal = require('../src/db')
const { modoIaPadraoEmpresa, invalidarCacheModoIaPadrao } = require('../src/db/empresas')

/** Troca `pool.query` por um dublê e devolve a funcao que restaura. */
function comPoolFalso(impl) {
  const original = dbReal.pool.query
  dbReal.pool.query = impl
  return () => { dbReal.pool.query = original }
}

test('modo global: le a config da empresa e cacheia', async () => {
  invalidarCacheModoIaPadrao()
  let consultas = 0
  const restaurar = comPoolFalso(async () => {
    consultas += 1
    return { rows: [{ config: { modo_ia_padrao: 'analise' } }] }
  })
  try {
    assert.strictEqual(await modoIaPadraoEmpresa(EMPRESA), 'analise')
    assert.strictEqual(await modoIaPadraoEmpresa(EMPRESA), 'analise')
    assert.strictEqual(consultas, 1, 'o cache nao segurou a segunda leitura')
  } finally { restaurar(); invalidarCacheModoIaPadrao() }
})

test('modo global: empresa sem a chave cai no padrao de fabrica', async () => {
  invalidarCacheModoIaPadrao()
  const restaurar = comPoolFalso(async () => ({ rows: [{ config: {} }] }))
  try {
    assert.strictEqual(await modoIaPadraoEmpresa(EMPRESA), MODOS_IA.CONVERSA)
  } finally { restaurar(); invalidarCacheModoIaPadrao() }
})

test('modo global: com cache quente, a falha de leitura nem chega a acontecer', async () => {
  invalidarCacheModoIaPadrao()
  let restaurar = comPoolFalso(async () => ({ rows: [{ config: { modo_ia_padrao: 'analise' } }] }))
  await modoIaPadraoEmpresa(EMPRESA)
  restaurar()

  restaurar = comPoolFalso(async () => { throw new Error('conexao caiu') })
  try {
    assert.strictEqual(await modoIaPadraoEmpresa(EMPRESA), 'analise')
  } finally { restaurar(); invalidarCacheModoIaPadrao() }
})

test('modo global: falha SEM cache algum cai no padrao, sem lancar', async () => {
  // Contingencia final: sem nenhuma leitura bem-sucedida na vida do processo, o padrao de
  // fabrica assume. Nunca lanca — uma falha aqui nao pode derrubar o turno.
  invalidarCacheModoIaPadrao()
  const restaurar = comPoolFalso(async () => { throw new Error('conexao caiu') })
  try {
    assert.strictEqual(await modoIaPadraoEmpresa(EMPRESA), MODOS_IA.CONVERSA)
  } finally { restaurar(); invalidarCacheModoIaPadrao() }
})

test('modo global: falha nao envenena o cache — a proxima leitura boa vale', async () => {
  // Se a falha gravasse o padrao no cache, a Central ficaria em Conversa por 30s depois de
  // um soluco de banco, mesmo com o operador tendo escolhido Analise.
  invalidarCacheModoIaPadrao()
  let restaurar = comPoolFalso(async () => { throw new Error('conexao caiu') })
  assert.strictEqual(await modoIaPadraoEmpresa(EMPRESA), MODOS_IA.CONVERSA)
  restaurar()

  restaurar = comPoolFalso(async () => ({ rows: [{ config: { modo_ia_padrao: 'analise' } }] }))
  try {
    assert.strictEqual(await modoIaPadraoEmpresa(EMPRESA), 'analise')
  } finally { restaurar(); invalidarCacheModoIaPadrao() }
})

test('modo global: sem empresa (single-tenant legado) devolve o padrao sem consultar', async () => {
  const restaurar = comPoolFalso(async () => { throw new Error('nao deveria consultar') })
  try {
    assert.strictEqual(await modoIaPadraoEmpresa(null), MODOS_IA.CONVERSA)
  } finally { restaurar() }
})
