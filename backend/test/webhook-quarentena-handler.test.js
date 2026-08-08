'use strict'

// Quarentena DENTRO do webhook real (registerWebhookRoute).
//
// O teste de regras puras prova que a decisão está certa. Este prova que a decisão é
// OBEDECIDA no caminho de produção: webhook sem dono comprovado não cria conversa, não
// cria perfil de lead, não cancela follow-up, não captura CTWA, não enfileira resposta
// automática e não registra evento de saúde de instância.

const test = require('node:test')
const assert = require('node:assert')

const { registerWebhookRoute } = require('../src/webhook-handler')
const { MOTIVO_QUARENTENA, resolverTenantWebhook } = require('../src/services/webhook-quarentena')

const PJ = '00000000-0000-0000-0000-000000000001'
const EMPRESA_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const INSTANCIA_B = '22222222-2222-2222-2222-222222222222'
const NUMERO = '5511988887777@s.whatsapp.net'

function mensagem(id = 'MSG-1', comAnuncio = true) {
  return {
    key: { id, fromMe: false, remoteJid: NUMERO },
    pushName: 'Fulano',
    message: {
      extendedTextMessage: {
        text: 'oi, vi o anuncio',
        ...(comAnuncio
          ? { contextInfo: { externalAdReply: { sourceId: 'ad-123', ctwaClid: 'ARBxyzCLID9999', title: 'Site em 7 dias' } } }
          : {}),
      },
    },
  }
}

/**
 * Webhook montado com espiões em TODOS os efeitos colaterais que a quarentena precisa
 * impedir. O que não for chamado é a prova.
 */
function montar() {
  let handler
  const app = { post: (_p, cb) => { handler = cb } }
  const logs = []
  const log = {
    child: () => log,
    info: (obj, msg) => logs.push({ nivel: 'info', obj, msg }),
    warn: (obj, msg) => logs.push({ nivel: 'warn', obj, msg }),
    error: (obj, msg) => logs.push({ nivel: 'error', obj, msg }),
  }

  const chamadas = {
    conversasSalvas: [],
    perfisAtualizados: [],
    atribuicoes: [],
    eventosSaude: [],
    jobsResposta: [],
    followupsCancelados: [],
    quarentena: [],
    extraiuTexto: 0,
  }

  // "Tabela" app.webhook_quarentena com o índice único parcial (instancia_chave, motivo).
  const tabelaQuarentena = []
  const registrarPendenciaQuarentena = async (_pool, pendencia, mensagemHash) => {
    chamadas.quarentena.push({ ...pendencia, mensagemHash })
    const existente = tabelaQuarentena.find(
      (r) => r.instanciaChave === pendencia.instanciaChave && r.motivo === pendencia.motivo && !r.resolvidaEm
    )
    if (existente) {
      // Reentrega da MESMA mensagem não conta de novo (regra do banco, espelhada aqui).
      const nova = mensagemHash != null && existente.ultimaMensagemHash !== mensagemHash
      if (nova) existente.ocorrencias += 1
      if (mensagemHash != null) existente.ultimaMensagemHash = mensagemHash
      return { id: existente.id, novaOcorrencia: false, aberta: true }
    }
    const linha = { ...pendencia, id: tabelaQuarentena.length + 1, ocorrencias: 1, ultimaMensagemHash: mensagemHash }
    tabelaQuarentena.push(linha)
    return { id: linha.id, novaOcorrencia: true, aberta: true }
  }

  registerWebhookRoute(app, {
    webhookAutorizado: () => true,
    gerarRequestIdAnthropic: () => 'rid',
    loggerForWebhook: () => log,
    logger: log,
    serializeError: (e) => ({ message: e.message }),
    canonicoRemoteJidParaConversa: (key) => key?.remoteJid || null,
    isConversaLeadUmAUm: () => true,
    listarOperadoresAtivos: async () => [],
    jidIgual: () => false,
    construirChaveIdempotenciaWebhookMensagem: (m) => m.key.id,
    webhookMensagemDeveSerProcessada: async () => true,
    pool: { marcador: 'pool-fake' },
    registrarPendenciaQuarentena,

    // ─── Espiões: tudo isto tem de continuar zerado na quarentena ───────────────
    eventoSaudeDeWebhook: (body) => (body?.event === 'connection.update' ? { empresa_id: null, event: 'CONNECTION.UPDATE' } : null),
    registrarEventoSaudeInstancia: async (e) => { chamadas.eventosSaude.push(e) },
    registrarAtribuicaoAnuncio: async (_p, empresaId, reg) => {
      chamadas.atribuicoes.push({ empresaId, ...reg })
      return { criado: true, id: chamadas.atribuicoes.length }
    },
    extrairTextoEMidiaDoWebhook: async (m) => {
      chamadas.extraiuTexto += 1
      return { texto: m?.message?.extendedTextMessage?.text || 'oi', visao: null }
    },
    textoEhAutoReplyWhatsApp: () => false,
    textoJaProcessadoRecentemente: () => false,
    buscarConversa: async () => null,
    normalizarHistoricoMensagens: () => [],
    marcarProspectComoRespondeuPorNumero: async () => {},
    buscarContextoProspeccao: async () => null,
    salvarConversa: async (numero, _h, _e, _s, _a, empresaId, inst) => {
      chamadas.conversasSalvas.push({ numero, empresaId, inst })
    },
    atualizarPerfil: async (numero, patch) => { chamadas.perfisAtualizados.push({ numero, patch }) },
    capturarNomeContato: async () => {},
    registrarRespostaLembreteReuniao: async () => null,
    cancelarFollowupsAutoPendentes: async (numero, motivo) => { chamadas.followupsCancelados.push({ numero, motivo }) },
    textoPedePreco: () => false,
    registrarEventoComercial: async () => {},
    marcarRespostaFollowupSeAplicavel: async () => {},
    obterEstadoDebounceResposta: () => ({}),
    podeGerarRespostaAutomatica: () => true,
    enfileirarJobRespostaWebhook: async (numero, rid) => { chamadas.jobsResposta.push({ numero, rid }) },
  })

  const res = { status: () => ({ json: () => {} }), json: () => {} }
  const receber = (msg, req = {}, event = 'messages.upsert') =>
    handler({ headers: {}, body: { event, data: msg }, ...req }, res)

  return { receber, chamadas, logs, tabelaQuarentena }
}

/** Contexto de requisição como o middleware real o produz — nada é inventado no teste. */
function reqDe({ instanceName = null, vinculo = null, erro = false } = {}) {
  const r = resolverTenantWebhook({ instanceName, vinculo, erro })
  return {
    empresaId: r.empresaId,
    empresaOrigem: r.origem,
    whatsappInstanciaId: r.instanciaId,
    evolutionInstance: r.evolutionInstance,
    tenantPendencia: r.pendencia,
  }
}

const reqBom = () => reqDe({
  instanceName: 'inst-b',
  vinculo: { empresa: { id: EMPRESA_B, nome: 'Empresa B' }, instanciaId: INSTANCIA_B },
})

// ─── Instância válida continua operando ───────────────────────────────────────

test('instância mapeada processa normalmente e SÓ na empresa correta', async () => {
  const { receber, chamadas } = montar()
  await receber(mensagem(), reqBom())

  assert.equal(chamadas.conversasSalvas.length, 1)
  assert.equal(chamadas.conversasSalvas[0].empresaId, EMPRESA_B)
  assert.notEqual(chamadas.conversasSalvas[0].empresaId, PJ)
  assert.equal(chamadas.jobsResposta.length, 1, 'o bot continua respondendo')
  assert.equal(chamadas.atribuicoes.length, 1, 'a atribuição CTWA continua sendo capturada')
  assert.equal(chamadas.atribuicoes[0].empresaId, EMPRESA_B)
  assert.equal(chamadas.quarentena.length, 0, 'nada de pendência para instância válida')
})

// ─── Os três casos de quarentena ──────────────────────────────────────────────

const CENARIOS = [
  ['webhook SEM instância', { instanceName: null }, MOTIVO_QUARENTENA.SEM_INSTANCIA],
  ['instância DESCONHECIDA', { instanceName: 'inst-orfa', vinculo: null }, MOTIVO_QUARENTENA.INSTANCIA_DESCONHECIDA],
  ['ERRO de resolução', { instanceName: 'inst-b', erro: true }, MOTIVO_QUARENTENA.ERRO_RESOLUCAO],
]

for (const [nome, entrada, motivoEsperado] of CENARIOS) {
  test(`${nome}: entra em quarentena e NÃO grava nada sob tenant nenhum`, async () => {
    const { receber, chamadas } = montar()
    await receber(mensagem(), reqDe(entrada))

    assert.equal(chamadas.quarentena.length, 1)
    assert.equal(chamadas.quarentena[0].motivo, motivoEsperado)

    // O conjunto inteiro de efeitos colaterais tem de estar zerado.
    assert.equal(chamadas.conversasSalvas.length, 0, 'não pode criar conversa')
    assert.equal(chamadas.perfisAtualizados.length, 0, 'não pode criar/alterar perfil de lead')
    assert.equal(chamadas.atribuicoes.length, 0, 'não pode capturar atribuição CTWA')
    assert.equal(chamadas.followupsCancelados.length, 0, 'não pode mexer em follow-up')
    assert.equal(chamadas.jobsResposta.length, 0, 'não pode gerar resposta automática')
    assert.equal(chamadas.eventosSaude.length, 0, 'não pode registrar evento de saúde')
    assert.equal(chamadas.extraiuTexto, 0, 'o fluxo para antes de ler o conteúdo da mensagem')
  })

  test(`${nome}: nunca cai na PJ`, async () => {
    const { receber, chamadas, logs } = montar()
    await receber(mensagem(), reqDe(entrada))
    const tudo = JSON.stringify({ chamadas, logs })
    assert.ok(!tudo.includes(PJ), 'o id da PJ não pode aparecer em lugar nenhum do fluxo barrado')
  })
}

test('evento que não é mensagem (connection.update) também é barrado', async () => {
  const { receber, chamadas } = montar()
  await receber({}, reqDe({ instanceName: 'inst-orfa', vinculo: null }), 'connection.update')
  assert.equal(chamadas.eventosSaude.length, 0, 'saúde de um número desconhecido não tem dono')
  assert.equal(chamadas.quarentena.length, 1)
})

// ─── Idempotência ─────────────────────────────────────────────────────────────

test('reentrega do MESMO webhook não duplica pendência nem infla a contagem', async () => {
  const { receber, tabelaQuarentena } = montar()
  const req = reqDe({ instanceName: 'inst-orfa', vinculo: null })
  await receber(mensagem('MSG-REPETIDA'), req)
  await receber(mensagem('MSG-REPETIDA'), req)
  await receber(mensagem('MSG-REPETIDA'), req)

  assert.equal(tabelaQuarentena.length, 1, 'uma pendência por instância+motivo')
  assert.equal(tabelaQuarentena[0].ocorrencias, 1, 'a mesma mensagem não conta três vezes')
})

test('mensagens DIFERENTES da mesma instância somam ocorrências na mesma pendência', async () => {
  const { receber, tabelaQuarentena } = montar()
  const req = reqDe({ instanceName: 'inst-orfa', vinculo: null })
  await receber(mensagem('MSG-1'), req)
  await receber(mensagem('MSG-2'), req)

  assert.equal(tabelaQuarentena.length, 1)
  assert.equal(tabelaQuarentena[0].ocorrencias, 2)
})

test('motivos diferentes da mesma instância são pendências separadas', async () => {
  const { receber, tabelaQuarentena } = montar()
  await receber(mensagem('M1'), reqDe({ instanceName: 'inst-b', vinculo: null }))
  await receber(mensagem('M2'), reqDe({ instanceName: 'inst-b', erro: true }))
  assert.equal(tabelaQuarentena.length, 2, 'cadastro faltando e falha técnica pedem ações diferentes')
})

// ─── Robustez e privacidade ───────────────────────────────────────────────────

test('falha ao registrar a pendência mantém o webhook BARRADO', async () => {
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
    registrarPendenciaQuarentena: async () => { throw new Error('banco fora do ar') },
    extrairTextoEMidiaDoWebhook: async () => { seguiu = true; return { texto: 'oi', visao: null } },
  })
  await handler(
    { headers: {}, body: { event: 'messages.upsert', data: mensagem() }, ...reqDe({ instanceName: 'inst-orfa', vinculo: null }) },
    { status: () => ({ json: () => {} }), json: () => {} }
  )
  // Preferimos PERDER a pendência a gravar dado sob a empresa errada.
  assert.equal(seguiu, false, 'perder o registro não pode liberar o fluxo')
})

test('o log da quarentena não carrega telefone, texto, id de mensagem nem ctwa_clid', async () => {
  const { receber, logs } = montar()
  await receber(mensagem('3EB0C431C26A1916E07A'), reqDe({ instanceName: 'inst-orfa', vinculo: null }))
  const serializado = JSON.stringify(logs)
  for (const proibido of ['5511988887777', 'ARBxyzCLID9999', 'oi, vi o anuncio', '3EB0C431C26A1916E07A', 'Fulano', 'Site em 7 dias']) {
    assert.ok(!serializado.includes(proibido), `log não pode conter "${proibido}"`)
  }
  assert.ok(serializado.includes('inst-orfa'), 'o nome da instância precisa aparecer, senão o log é inútil')
})

test('o hash da mensagem chega ao registro, e o id em claro não', async () => {
  const { receber, chamadas } = montar()
  await receber(mensagem('3EB0C431C26A1916E07A'), reqDe({ instanceName: 'inst-orfa', vinculo: null }))
  const h = chamadas.quarentena[0].mensagemHash
  assert.match(h, /^[0-9a-f]{64}$/)
  assert.ok(!h.includes('3EB0C431'))
})
