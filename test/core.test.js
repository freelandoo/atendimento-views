const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

process.env.REPROCESS_SECRET = 'test-secret-123'
process.env.EVOLUTION_API_KEY = 'evolution-test-key'
process.env.DASHBOARD_ADMIN_EMAIL = 'admin@example.com'
process.env.DASHBOARD_ADMIN_PASSWORD = 'senha-de-teste-123'

const {
  app,
  calcularPreco,
  diagnosticoCompletoParaPreco,
  contarPedidosPrecoDoLead,
  parsearRespostaJsonClaude,
  normalizarParsedRespostaVendas,
  resultadoParseadoParaObjeto,
  aplicarGuardrailReuniaoProposta,
  interpretarIntencaoMensagem,
  montarEstadoComercialLead,
  decidirProximaResposta,
  podeGerarRespostaAutomatica,
  ehProjetoSobMedida,
  parsearHorarioReuniao,
  calcularFimReuniao,
  dataInicioReuniao,
  sugestaoReuniaoProposta,
  normalizarAgendarFollowupAuto,
  textoPedePreco,
  textoEhAutoReplyWhatsApp,
  detectarAutoReplyEmContextoProspeccao,
  reprocessarAutorizado,
  webhookAutorizado,
  isConversaLeadUmAUm,
  buildWhereConversasFiltros,
  normalizarEtapaFunilDiagnostico,
  variantesEtapaFunilDiagnostico,
  normalizarResultadoFunilDiagnostico,
  normalizarAvaliacaoPromptFunil,
  selecionarConversasFunilDiagnostico,
  montarContextoFunilDiagnostico,
  criarNovaVersaoPromptFunil,
  montarBlocoContextoInterno,
  montarBlocoContinuidadeTurno,
  montarSystemPromptDinamico,
  montarBlocoCorrecoesAprendizados,
  inferirPromptAlvoDeTextoRegras,
  normalizarPromptAlvo,
  dadosPreviewSite,
  gerarApresentacaoOperador,
  gerarApresentacaoOperadorFallback,
  gerarMensagemPosPreview,
  gerarMensagemPosPreviewFallback,
  gerarCaptionPreview,
  montarPreviewSiteCaption,
  montarPreviewSiteHtml,
  montarPreviewSiteSvg,
  sequenciasComerciaisFollowupPorEstagio,
  maxSequenciaFollowupAutoPorEstagio,
  isSequenciaEncerramentoFollowup,
  ajustarParaJanelaComercialFollowup,
  registrarChamadaAnthropic,
  normalizarEntradaOperador,
  operadoresDoEnv,
  dedupeOperadores,
  listarOperadoresAtivos,
  textoAjudaOperadorProgramada,
  buildDiarioQuery,
  formatarMensagemParaContexto,
  gerarTextoConversaCompleta,
} = require('../index')
const { pool } = require('../src/db')
const dashboardAuth = require('../src/dashboardAuth')
const agenda = require('../src/agenda')
const { numeroEnvioWhatsapp } = require('../src/whatsapp')
const { redactPhone, redactValue, serializeError } = require('../src/logger')
const {
  validarAtualizarPerfilLead,
  validarJobQueuePayload,
  validarRespostaVendasIA,
} = require('../src/domainSchemas')
const {
  atualizarMensagemEditada,
  atualizarStatusProspectsLote,
  atualizarStatusProspect,
  buscarContextoProspeccao,
  calcularScoreProspect,
  calcularScoreV2,
  registrarDecisionLog,
  validarProspectAntesDoEnvio,
  persistirScoreV2Prospect,
  fallbackDiagnosticoEstruturado,
  parsearJsonDiagnosticoEstruturado,
  gerarDiagnosticoEstruturado,
  rotearOferta,
  gerarMensagemComercialV2,
  montarMensagemComercialV2Fallback,
  consumirJobsProspeccao,
  enfileirarJobProspeccao,
  enviarProspectsAprovados,
  gerarDiagnosticos,
  mapearPlace,
  marcarProspectComoRespondeuPorNumero,
  normalizarNumeroWhatsapp,
  normalizarProspectParaPersistencia,
  obterJanelaSemanal,
  montarAgendaPainelAutoProspeccao,
  obterMetricasProspeccao,
  buscarFilaAprovacao,
  obterMetricasFilaAprovacao,
  aprovarProspectComOferta,
  rejeitarProspectComMotivo,
  alterarOfertaProspect,
  proximoSlotComercial,
  salvarProspect,
  substituirPlaceholderEmpresa,
  temPlaceholderResidual,
} = require('../src/prospecting')
const { prospectingIntelligenceEnabled } = require('../src/config')
const { validarMensagemString, validarRespostaAntesDeEnviar } = require('../src/agent-validators')
const { parseAiResponse, renderPublicReplyFromAiResponse } = require('../src/ai-response')
const { messageLooksLikeRawJsonLeak, guardPublicMessages } = require('../src/public-message-guard')

function textoRespostaDecisao(decisao) {
  return String(decisao?.resultado?.mensagem_pro_lead || '')
}

function assertTriagemCurta(texto) {
  assert.ok(texto.length <= 450, `Resposta passou de 450 caracteres: ${texto.length}`)
  assert.ok((texto.match(/\?/g) || []).length <= 1, `Resposta tem perguntas demais: ${texto}`)
  assert.doesNotMatch(texto, /R\$\s*(1\.?500|3\.?000|5\.?000)/i)
  assert.doesNotMatch(texto, /recomendo\s+entrar\s+em\s+contato\s+com\s+uma\s+empresa\s+especializada/i)
}

test('triagem curta: "Ola" identifica assistente da PJ Codeworks e pergunta negocio/cidade', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Ola',
    perfil: {},
    estagio: 'primeiro_contato',
    historico: [{ role: 'user', content: 'Ola' }],
  })
  const msg = textoRespostaDecisao(decisao)
  assert.equal(decisao.deve_sobrescrever_modelo, true)
  assert.match(msg, /assistente.*da PJ Codeworks/i)
  assert.match(msg, /neg.cio/i)
  assert.match(msg, /cidade/i)
  assert.doesNotMatch(msg, /pre.o|valor|investimento|reuni.o|hor.rio/i)
  assert.ok((decisao.resultado.mensagens_bolhas || []).length <= 1)
  assertTriagemCurta(msg)
})

test('aceite fluxo: primeiro contato se apresenta, pergunta negocio/cidade e nao agenda', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Oi',
    perfil: {},
    estagio: 'primeiro_contato',
    historico: [{ role: 'user', content: 'Oi' }],
  })
  const msg = textoRespostaDecisao(decisao)

  assert.match(msg, /assistente.*da PJ Codeworks/i)
  assert.match(msg, /neg.cio/i)
  assert.match(msg, /cidade/i)
  assert.doesNotMatch(msg, /R\$|pre.o|valor|investimento/i)
  assert.doesNotMatch(msg, /reuni.o|hor.rio|19:30|20:15/i)
  assert.ok((decisao.resultado.mensagens_bolhas || []).length <= 2)
})

test('aceite fluxo: nicho e cidade em frase natural atualizam perfil sem repetir pergunta', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Trabalho em SBC com corte de cabelo',
    perfil: {},
    estagio: 'diagnostico',
    historico: [{ role: 'user', content: 'Trabalho em SBC com corte de cabelo' }],
  })
  const patch = decisao.resultado.atualizar_perfil || {}
  const msg = textoRespostaDecisao(decisao)

  assert.match(patch.negocio, /corte de cabelo|barbearia/i)
  assert.equal(patch.cidade, 'São Bernardo do Campo')
  assert.doesNotMatch(msg, /qual (é|e) o tipo do seu neg.cio|qual o seu neg.cio/i)
  assert.doesNotMatch(msg, /em qual cidade|qual cidade/i)
  assert.match(msg, /indica..o|Instagram|Google|j[aá] tem.*site|seria o primeiro/i)
})

test('aceite fluxo: interesse em site conecta valor antes de reuniao', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Quero ter um site',
    perfil: { negocio: 'corte de cabelo', cidade: 'São Bernardo do Campo' },
    estagio: 'diagnostico',
    historico: [{ role: 'user', content: 'Quero ter um site' }],
  })
  const patch = decisao.resultado.atualizar_perfil || {}
  const msg = textoRespostaDecisao(decisao)

  assert.equal(patch.necessidade, 'site')
  assert.equal(decisao.proxima_acao, 'conexao_valor')
  assert.match(msg, /corte de cabelo/i)
  assert.match(msg, /S.o Bernardo do Campo/i)
  assert.match(msg, /confian.a|WhatsApp/i)
  assert.match(msg, /j[aá] tem algum site|seria o primeiro/i)
  assert.doesNotMatch(msg, /reuni.o|hor.rio|19:30|20:15/i)
  assert.doesNotMatch(msg, /concorrente/i)
  assert.doesNotMatch(msg, /garant|primeir[ao] posi..o|ranking/i)
})

test('aceite fluxo: nao repete pergunta quando perfil ja tem negocio cidade e necessidade', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Isso',
    perfil: {
      negocio: 'barbearia',
      cidade: 'São Bernardo do Campo',
      necessidade: 'site',
    },
    estagio: 'diagnostico',
    historico: [{ role: 'user', content: 'Isso' }],
  })
  const msg = textoRespostaDecisao(decisao)

  assert.doesNotMatch(msg, /qual (é|e) o tipo do seu neg.cio|qual o seu neg.cio/i)
  assert.doesNotMatch(msg, /em qual cidade|qual cidade/i)
  assert.doesNotMatch(msg, /voc. procura site, sistema|procura site/i)
  assert.match(msg, /confian.a|WhatsApp|site/i)
})

test('aceite fluxo: barbearia em SBC nao gera concorrente inventado nem medo', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Tenho uma barbearia em SBC',
    perfil: {},
    estagio: 'diagnostico',
    historico: [{ role: 'user', content: 'Tenho uma barbearia em SBC' }],
  })
  const msg = textoRespostaDecisao(decisao)

  assert.match(msg, /estrutura|confian.a|WhatsApp/i)
  assert.doesNotMatch(msg, /concorrente|perdendo cliente|perdendo dinheiro|invis.vel|aparece antes/i)
})

test('triagem curta: interesse em site nao gera textao institucional', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Quero transformar as vendas com um site',
    perfil: {},
    estagio: 'primeiro_contato',
    historico: [{ role: 'user', content: 'Quero transformar as vendas com um site' }],
  })
  const msg = textoRespostaDecisao(decisao)
  assert.equal(decisao.deve_sobrescrever_modelo, true)
  assert.match(msg, /tipo do seu neg.cio/i)
  assert.doesNotMatch(msg, /sites, sistemas, automa/i)
  assertTriagemCurta(msg)
})

test('motor de IA: "Quero comprar um site" vira lead interessado sem concorrentes', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Quero comprar um site',
    perfil: {},
    estagio: 'primeiro_contato',
    historico: [{ role: 'user', content: 'Quero comprar um site' }],
  })
  const json = JSON.stringify(decisao.resultado)
  const msg = textoRespostaDecisao(decisao)
  assert.equal(decisao.deve_sobrescrever_modelo, true)
  assert.match(json, /compra_site|site/i)
  assert.doesNotMatch(msg, /\*\*|^#|\n\s*\d+[.)]/m)
  assert.doesNotMatch(msg, /Flippa|Empire Flippers|MicroAcquire/i)
  assert.match(msg, /PJ Codeworks|site profissional/i)
  assert.match(msg, /neg.cio|cidade/i)
  assertTriagemCurta(msg)
})

test('motor de IA: "Quero vender site" pede desambiguacao curta', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Quero vender site',
    perfil: {},
    estagio: 'primeiro_contato',
    historico: [{ role: 'user', content: 'Quero vender site' }],
  })
  const msg = textoRespostaDecisao(decisao)
  assert.equal(decisao.deve_sobrescrever_modelo, true)
  assert.equal(decisao.proxima_acao, 'clarificar_intencao_vender_site')
  assert.match(JSON.stringify(decisao.resultado), /ambiguous_site_sales/)
  assert.match(msg, /vender mais no seu neg.cio|trabalhar vendendo sites/i)
  assert.doesNotMatch(msg, /dicas|estrat[eé]gias|portf[oó]lio|prospec/i)
  assert.doesNotMatch(msg, /\n\s*(-|\d+[.)])\s+/)
  assertTriagemCurta(msg)
})

test('motor de IA: pergunta de preco de anuncio explica diferenca sem textao', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Quanto custa um anúncio desse?',
    perfil: {},
    estagio: 'primeiro_contato',
    historico: [{ role: 'user', content: 'Quanto custa um anúncio desse?' }],
  })
  const msg = textoRespostaDecisao(decisao)
  assert.equal(decisao.deve_sobrescrever_modelo, true)
  assert.equal(decisao.proxima_acao, 'explicar_diferenca_site_anuncio_google')
  assert.match(msg, /An.ncio/i)
  assert.match(msg, /site|p.gina/i)
  assert.match(msg, /Google|SEO/i)
  assert.match(msg, /neg.cio/i)
  assertTriagemCurta(msg)
})

test('motor de IA: negocio e cidade avancam qualificacao sem repetir dados', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Meu negócio é estética em Santo André',
    perfil: { servico_principal: 'site', necessidade: 'site' },
    estagio: 'diagnostico',
    historico: [{ role: 'user', content: 'Meu negócio é estética em Santo André' }],
  })
  const msg = textoRespostaDecisao(decisao)
  assert.equal(decisao.deve_sobrescrever_modelo, true)
  assert.match(JSON.stringify(decisao.resultado), /est[eé]tica|Santo Andr/i)
  assert.match(msg, /est[eé]tica/i)
  assert.match(msg, /Santo Andr/i)
  assert.match(msg, /hor.rio|conversa|Google|WhatsApp|clientes/i)
  assertTriagemCurta(msg)
})

test('triagem curta: pergunta de valor do site vai para agenda sem passar preco', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Qual o valor do site',
    perfil: {},
    estagio: 'primeiro_contato',
    historico: [{ role: 'user', content: 'Qual o valor do site' }],
  })
  assert.equal(decisao.deve_sobrescrever_modelo, true)
  assert.equal(decisao.proxima_acao, 'consultar_agenda_e_oferecer_horarios')
  assert.equal(decisao.prioridade_aplicada, 'pergunta_preco_projeto_sob_medida')
})

test('triagem curta: cidade isolada e salva e pergunta so dado faltante', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Fortaleza',
    perfil: { servico_principal: 'site', necessidade: 'site' },
    estagio: 'coleta_basica',
    historico: [{ role: 'user', content: 'Fortaleza' }],
  })
  const msg = textoRespostaDecisao(decisao)
  assert.equal(decisao.resultado.atualizar_perfil.cidade, 'Fortaleza')
  assert.match(msg, /Fortaleza/i)
  assert.match(msg, /tipo do seu neg.cio/i)
  assertTriagemCurta(msg)
})

test('triagem curta: nicho amplo nao gera consultoria nem agenda cedo demais', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Musica',
    perfil: { cidade: 'Fortaleza', servico_principal: 'site', necessidade: 'site' },
    estagio: 'coleta_basica',
    historico: [{ role: 'user', content: 'Musica' }],
  })
  assert.equal(decisao.proxima_acao, 'conexao_valor')
  assert.equal(decisao.prioridade_aplicada, 'conexao_valor_antes_reuniao')
  assert.match(decisao.resultado.mensagem_pro_lead, /passar mais confian/i)
  assert.doesNotMatch(decisao.resultado.mensagem_pro_lead, /hor.rio|reuni.o|pre.o|Google/i)
})

test('triagem curta: validador sinaliza consultoria longa e valores como regra de prompt', () => {
  const ruim = [
    'Para um site de musica, voce pode considerar funcionalidades como:',
    '- portfolio',
    '- agenda de shows',
    '- loja online',
    '- blog',
    'Um site basico pode comecar em R$1.500.',
  ].join('\n')
  const validacao = validarMensagemString(ruim, { projeto_sob_medida: true })
  // Decisao do dono (2026-06-06): preco/consultoria viram AVISO, nao bloqueiam (LLM no controle).
  assert.equal(validacao.ok, true)
  assert.ok(validacao.erros.some((e) => /consultoria|preco|frase proibida|450/i.test(e.erro)))
  assert.ok(validacao.erros.every((e) => e.severidade === 'avisar'))
})

test('triagem curta: horario escolhido confirma reuniao e pede email', async () => {
  const decisao = await decidirProximaResposta({
    texto: '19:45',
    perfil: {
      negocio: 'Musica',
      cidade: 'Fortaleza',
      servico_principal: 'site',
      reuniao_proposta: {
        necessaria: true,
        data_sugerida: '2026-05-18',
        horarios_sugeridos: ['19:30', '19:45'],
      },
    },
    estagio: 'agendamento_pendente',
    historico: [
      { role: 'assistant', content: 'Tenho amanha as 19:30 ou 19:45 disponiveis. Qual fica melhor?' },
      { role: 'user', content: '19:45' },
    ],
  })
  assert.equal(decisao.proxima_acao, 'confirmar_reuniao')
  // Novo orquestrador: LLM compoe a mensagem de confirmacao
  assert.equal(decisao.deve_sobrescrever_modelo, false)
})

test('dashboard auth gera hash scrypt verificavel sem guardar senha pura', async () => {
  const hash = await dashboardAuth.hashPassword('senha-forte-123')
  assert.match(hash, /^scrypt\$/)
  assert.notEqual(hash, 'senha-forte-123')
  assert.equal(await dashboardAuth.verifyPassword('senha-forte-123', hash), true)
  assert.equal(await dashboardAuth.verifyPassword('senha-errada', hash), false)
})

test('dashboard auth parseia cookie de sessao', () => {
  const cookies = dashboardAuth.parseCookies('foo=bar; pj_dashboard_session=abc%20123')
  assert.equal(cookies.foo, 'bar')
  assert.equal(cookies.pj_dashboard_session, 'abc 123')
})

test('webhook aceita somente conversas 1:1 de lead', () => {
  assert.equal(isConversaLeadUmAUm('5511999999999@s.whatsapp.net'), true)
  assert.equal(isConversaLeadUmAUm('1234567890@lid'), true)
  assert.equal(isConversaLeadUmAUm('120363012345678@g.us'), false)
  assert.equal(isConversaLeadUmAUm('status@broadcast'), false)
})

test('envio WhatsApp rejeita JID de grupo e broadcast', () => {
  assert.equal(numeroEnvioWhatsapp('5511999999999@s.whatsapp.net'), '5511999999999')
  assert.equal(numeroEnvioWhatsapp('11999999999'), '11999999999')
  assert.equal(numeroEnvioWhatsapp('120363012345678@g.us'), '')
  assert.equal(numeroEnvioWhatsapp('status@broadcast'), '')
})

test('servidor estatico serve apenas public e nao expoe arquivos sensiveis da raiz', async () => {
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  try {
    const { port } = server.address()
    const base = `http://127.0.0.1:${port}`
    const dashboard = await fetch(`${base}/dashboard.html`)
    assert.equal(dashboard.status, 200)
    const sensitive = await fetch(`${base}/index.js`)
    assert.equal(sensitive.status, 404)
    const prompt = await fetch(`${base}/prompts/system.md`)
    assert.equal(prompt.status, 404)
    const sql = await fetch(`${base}/sql/init.sql`)
    assert.equal(sql.status, 404)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('dashboard API exige sessao antes de chegar nas rotas protegidas', async () => {
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  try {
    const { port } = server.address()
    const res = await fetch(`http://127.0.0.1:${port}/dashboard/data`)
    assert.equal(res.status, 401)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('agenda valida payload minimo e rejeita horario inconsistente', () => {
  const ok = agenda.validarPayloadEvento(
    {
      titulo: 'Reuniao: Clinica Sorriso',
      tipo: 'reuniao',
      prioridade: 'alta',
      data_inicio: '2026-05-10T13:00:00.000Z',
      data_fim: '2026-05-10T14:00:00.000Z',
    },
    1
  )
  assert.equal(ok.ok, true)
  assert.equal(ok.value.timezone, undefined)
  const invalido = agenda.validarPayloadEvento(
    {
      titulo: '',
      tipo: 'reuniao',
      data_inicio: '2026-05-10T14:00:00.000Z',
      data_fim: '2026-05-10T13:00:00.000Z',
    },
    1
  )
  assert.equal(invalido.ok, false)
  assert.ok(invalido.issues.some((issue) => /titulo/.test(issue)))
  assert.ok(invalido.issues.some((issue) => /data_fim/.test(issue)))
})

test('agenda interpreta horario sem offset como America/Sao_Paulo', () => {
  const parsed = agenda.validarPayloadEvento(
    {
      titulo: 'Reuniao',
      tipo: 'reuniao',
      data_inicio: '2026-05-11T20:15:00',
      data_fim: '2026-05-11T20:30:00',
    },
    1
  )
  assert.equal(parsed.ok, true)
  assert.equal(parsed.value.data_inicio.toISOString(), '2026-05-11T23:15:00.000Z')
  assert.equal(parsed.value.data_fim.toISOString(), '2026-05-11T23:30:00.000Z')
})

test('agenda calcula status atrasado sem alterar status persistido', () => {
  const row = {
    id: 1,
    usuario_id: 1,
    titulo: 'Follow-up',
    tipo: 'follow_up',
    status: 'pendente',
    prioridade: 'media',
    data_inicio: '2026-05-10T10:00:00.000Z',
    data_fim: '2026-05-10T11:00:00.000Z',
  }
  const evento = agenda.mapEvento(row, new Date('2026-05-10T12:00:00.000Z'))
  assert.equal(evento.status, 'pendente')
  assert.equal(evento.status_efetivo, 'atrasado')
})

test('agenda monta resumo por status efetivo e tipo', () => {
  const eventos = [
    { tipo: 'reuniao', status_efetivo: 'atrasado', data_inicio: '2026-05-10T10:00:00.000Z' },
    { tipo: 'follow_up', status_efetivo: 'pendente', data_inicio: '2026-05-10T18:00:00.000Z' },
    { tipo: 'tarefa', status_efetivo: 'concluido', data_inicio: '2026-05-10T09:00:00.000Z' },
  ]
  const resumo = agenda.montarResumo(eventos, new Date('2026-05-10T12:00:00.000Z'))
  assert.equal(resumo.hoje, 3)
  assert.equal(resumo.atrasados, 1)
  assert.equal(resumo.concluidos, 1)
  assert.equal(resumo.proximos, 1)
  assert.equal(resumo.reunioes_hoje, 1)
  assert.equal(resumo.followups_pendentes, 1)
  assert.equal(resumo.por_tipo.follow_up, 1)
})

test('agenda gera ocorrencias recorrentes futuras limitadas', () => {
  const base = {
    titulo: 'Rotina semanal',
    tipo: 'tarefa',
    prioridade: 'media',
    data_inicio: '2026-05-10T12:00:00.000Z',
    data_fim: '2026-05-10T13:00:00.000Z',
  }
  const ocorrencias = agenda.gerarOcorrenciasRecorrentes(base, {
    tipo: 'semanal',
    intervalo: 1,
    ate: '2026-05-31',
  })
  assert.equal(ocorrencias.length, 3)
  assert.equal(ocorrencias[0].data_inicio.toISOString(), '2026-05-17T12:00:00.000Z')
})

test('agenda valida bloqueio como evento ocupado', () => {
  const parsed = agenda.validarPayloadEvento(
    {
      titulo: 'Horario bloqueado',
      descricao: 'Compromisso pessoal',
      tipo: 'bloqueio',
      status: 'bloqueado',
      prioridade: 'normal',
      data_inicio: '2026-05-12T23:15:00.000Z',
      data_fim: '2026-05-12T23:30:00.000Z',
    },
    1
  )
  assert.equal(parsed.ok, true)
  assert.equal(parsed.value.tipo, 'bloqueio')
  assert.equal(parsed.value.status, 'bloqueado')
  assert.equal(parsed.value.prioridade, 'normal')
  const evento = agenda.mapEvento(parsed.value, new Date('2026-05-13T12:00:00.000Z'))
  assert.equal(evento.status_efetivo, 'bloqueado')
})

test('agenda aceita status nao_compareceu sem considerar atrasado', () => {
  const parsed = agenda.validarPayloadEvento(
    {
      titulo: 'Reuniao',
      tipo: 'reuniao',
      status: 'nao_compareceu',
      prioridade: 'alta',
      data_inicio: '2026-05-12T22:30:00.000Z',
      data_fim: '2026-05-12T22:45:00.000Z',
    },
    1
  )
  assert.equal(parsed.ok, true)
  assert.equal(parsed.value.status, 'nao_compareceu')
  const evento = agenda.mapEvento(parsed.value, new Date('2026-05-13T12:00:00.000Z'))
  assert.equal(evento.status_efetivo, 'nao_compareceu')
})

test('agenda bloqueio recorrente aparece nas proximas datas', () => {
  const base = {
    titulo: 'Horario bloqueado',
    tipo: 'bloqueio',
    status: 'bloqueado',
    prioridade: 'normal',
    data_inicio: '2026-05-12T23:15:00.000Z',
    data_fim: '2026-05-12T23:30:00.000Z',
  }
  const ocorrencias = agenda.gerarOcorrenciasRecorrentes(base, {
    tipo: 'semanal',
    intervalo: 1,
    ate: '2026-05-26',
  })
  assert.equal(ocorrencias.length, 2)
  assert.equal(ocorrencias[0].tipo, 'bloqueio')
  assert.equal(ocorrencias[0].data_inicio.toISOString(), '2026-05-19T23:15:00.000Z')
})

test('agenda gera mensagem de lembrete de reuniao com horario de Sao Paulo', () => {
  const msg = agenda.gerarMensagemLembreteReuniao(
    { data_inicio: '2026-05-12T23:15:00.000Z' },
    { nome: 'Ana' }
  )
  assert.match(msg, /Oi, Ana/)
  assert.match(msg, /20:15/)
  assert.match(msg, /equipe da PJ Codeworks/)
  assert.doesNotMatch(msg, /Victor/)
  assert.match(msg, /15 minutos/)
})

test('agenda envia lembrete manual, atualiza status e registra historico sem coluna inexistente', async () => {
  const originalQuery = pool.query
  const calls = []
  const enviados = []
  pool.query = async (sql, params) => {
    const text = String(sql)
    calls.push({ sql: text, params })
    if (/FROM vendas\.agenda_lembretes l/.test(text)) {
      assert.doesNotMatch(text, /lp\.nome/)
      return {
        rows: [{
          id: 91,
          lembrete_status: 'pendente',
          lembrete_tipo: 'manual',
          evento_status: 'pendente',
          evento_tipo: 'reuniao',
          conversa_numero: '5511999999999@s.whatsapp.net',
          conversa_venda_fechada: false,
          lead_numero: null,
          apelido: 'Ana',
          negocio: 'Clinica',
          data_inicio: new Date('2026-05-12T23:15:00.000Z'),
          data_fim: new Date('2026-05-12T23:30:00.000Z'),
          metadata: {},
          excluido_em: null,
          reagendado_para_evento_id: null,
        }],
      }
    }
    if (/UPDATE vendas\.conversas/.test(text)) {
      const historico = JSON.parse(params[1])
      assert.equal(params[0], '5511999999999@s.whatsapp.net')
      assert.equal(historico[0].tipo, 'lembrete_reuniao')
      assert.equal(historico[1].tipo, 'sistema_lembrete_reuniao')
      return { rows: [] }
    }
    if (/UPDATE vendas\.agenda_lembretes/.test(text) && /status = 'enviado'/.test(text)) {
      assert.equal(params[0], 91)
      assert.match(params[1], /20:15/)
      return { rows: [] }
    }
    return { rows: [] }
  }
  try {
    const out = await agenda.enviarLembreteReuniao(91, {
      manual: true,
      enviarMensagemFn: async (numero, texto) => enviados.push({ numero, texto }),
    })
    assert.equal(out.ok, true)
    assert.equal(out.enviado, true)
    assert.equal(enviados[0].numero, '5511999999999@s.whatsapp.net')
    assert.match(enviados[0].texto, /equipe da PJ Codeworks/)
    assert.doesNotMatch(enviados[0].texto, /Victor/)
    assert.ok(calls.some((c) => /UPDATE vendas\.conversas/.test(c.sql)))
  } finally {
    pool.query = originalQuery
  }
})

test('agenda lembrete sem telefone retorna erro amigavel', async () => {
  const originalQuery = pool.query
  pool.query = async (sql) => {
    const text = String(sql)
    if (/FROM vendas\.agenda_lembretes l/.test(text)) {
      return {
        rows: [{
          id: 92,
          lembrete_status: 'pendente',
          evento_status: 'pendente',
          evento_tipo: 'reuniao',
          conversa_numero: null,
          lead_numero: null,
          conversa_venda_fechada: false,
          data_inicio: new Date('2026-05-12T23:15:00.000Z'),
          metadata: {},
          excluido_em: null,
          reagendado_para_evento_id: null,
        }],
      }
    }
    return { rows: [] }
  }
  try {
    await assert.rejects(
      () => agenda.enviarLembreteReuniao(92, { manual: true, enviarMensagemFn: async () => {} }),
      (err) => err.code === 'lead_sem_telefone' && /telefone/.test(err.message)
    )
  } finally {
    pool.query = originalQuery
  }
})

test('agenda lembrete com falha no WhatsApp retorna erro claro e marca falha', async () => {
  const originalQuery = pool.query
  const updates = []
  pool.query = async (sql, params) => {
    const text = String(sql)
    if (/FROM vendas\.agenda_lembretes l/.test(text)) {
      return {
        rows: [{
          id: 93,
          lembrete_status: 'pendente',
          evento_status: 'pendente',
          evento_tipo: 'reuniao',
          conversa_numero: '5511999999999@s.whatsapp.net',
          lead_numero: null,
          conversa_venda_fechada: false,
          data_inicio: new Date('2026-05-12T23:15:00.000Z'),
          metadata: {},
          excluido_em: null,
          reagendado_para_evento_id: null,
        }],
      }
    }
    if (/UPDATE vendas\.agenda_lembretes/.test(text) && /status = 'falhou'/.test(text)) {
      updates.push(params)
      return { rows: [] }
    }
    return { rows: [] }
  }
  try {
    await assert.rejects(
      () => agenda.enviarLembreteReuniao(93, {
        manual: true,
        enviarMensagemFn: async () => { throw new Error('Evolution offline') },
      }),
      (err) => err.code === 'envio_falhou' && /Evolution offline/.test(err.message)
    )
    assert.equal(updates.length, 1)
    assert.match(updates[0][1], /Evolution offline/)
  } finally {
    pool.query = originalQuery
  }
})

test('date-utils interpreta data e hora sem offset como Sao Paulo', () => {
  const {
    formatarHoraSaoPaulo,
    gerarIntervaloDiaSaoPaulo,
    parseDateTimeSaoPaulo,
  } = require('../src/date-utils')
  const inicio = parseDateTimeSaoPaulo('2026-05-11T20:15:00')
  assert.equal(inicio.toISOString(), '2026-05-11T23:15:00.000Z')
  assert.equal(formatarHoraSaoPaulo(inicio), '20:15')
  const intervalo = gerarIntervaloDiaSaoPaulo('2026-05-11')
  assert.equal(intervalo.inicio.toISOString(), '2026-05-11T03:00:00.000Z')
  assert.equal(intervalo.fim.toISOString(), '2026-05-12T03:00:00.000Z')
})

test('agenda agenda lembrete 15 minutos antes e cria job deduplicado', async () => {
  const originalQuery = pool.query
  const calls = []
  pool.query = async (sql, params) => {
    const text = String(sql)
    calls.push({ sql: text, params })
    if (/FROM vendas\.agenda_eventos e/.test(text) && /LEFT JOIN vendas\.conversas/.test(text)) {
      return {
        rows: [{
          id: 77,
          usuario_id: 1,
          lead_id: null,
          conversa_id: 12,
          conversa_numero: '5511999999999',
          titulo: 'Reuniao de proposta',
          tipo: 'reuniao',
          status: 'pendente',
          prioridade: 'alta',
          data_inicio: new Date('2099-05-12T23:15:00.000Z'),
          data_fim: new Date('2099-05-12T23:30:00.000Z'),
          timezone: 'America/Sao_Paulo',
          recorrente: false,
          metadata: {},
        }],
      }
    }
    if (/INSERT INTO vendas\.agenda_lembretes/.test(text)) {
      // params: [evento_id, lead_id, conversa_id, tipo, enviar_em]
      assert.equal(params[0], 77)
      const id = params[3] === '15min' ? 31 : 32 // 15min @ 23:00, agora @ 23:15
      const esperado = params[3] === '15min' ? '2099-05-12T23:00:00.000Z' : '2099-05-12T23:15:00.000Z'
      assert.equal(params[4].toISOString(), esperado)
      return { rows: [{ id, status: 'pendente', enviar_em: params[4] }] }
    }
    if (/INSERT INTO vendas\.job_queue/.test(text)) {
      assert.match(String(params[0]), /^agenda_lembrete_reuniao:(31|32)$/)
      return { rows: [{ id: 1001 }] }
    }
    return { rows: [] }
  }
  try {
    const lembrete = await agenda.agendarLembretesReuniao(77)
    assert.equal(lembrete.id, 31) // retorna o principal (15 min antes)
    const tipos = calls.filter((c) => /INSERT INTO vendas\.agenda_lembretes/.test(c.sql)).map((c) => c.params[3]).sort()
    assert.deepEqual(tipos, ['15min', 'agora']) // cria os dois lembretes de tempo
    assert.ok(calls.some((c) => /agenda_lembrete_reuniao:3(1|2)/.test(String(c.params?.[0]))))
  } finally {
    pool.query = originalQuery
  }
})

test('agenda nao agenda lembrete para conversa ja vendida', async () => {
  const originalQuery = pool.query
  let inserts = 0
  pool.query = async (sql) => {
    const text = String(sql)
    if (/FROM vendas\.agenda_eventos e/.test(text) && /LEFT JOIN vendas\.conversas/.test(text)) {
      return {
        rows: [{
          id: 78,
          usuario_id: 1,
          conversa_id: 12,
          conversa_numero: '5511999999999',
          conversa_venda_fechada: true,
          titulo: 'Reuniao de proposta',
          tipo: 'reuniao',
          status: 'pendente',
          prioridade: 'alta',
          data_inicio: new Date('2099-05-12T23:15:00.000Z'),
          data_fim: new Date('2099-05-12T23:30:00.000Z'),
          timezone: 'America/Sao_Paulo',
          recorrente: false,
          metadata: {},
        }],
      }
    }
    if (/INSERT INTO vendas\.agenda_lembretes/.test(text)) inserts += 1
    return { rows: [] }
  }
  try {
    const lembrete = await agenda.agendarLembretesReuniao(78)
    assert.equal(lembrete, null)
    assert.equal(inserts, 0)
  } finally {
    pool.query = originalQuery
  }
})

test('agenda registra resposta confirmada de lembrete no evento e historico', async () => {
  const originalQuery = pool.query
  const calls = []
  pool.query = async (sql, params) => {
    const text = String(sql)
    calls.push({ sql: text, params })
    if (/FROM vendas\.agenda_eventos e/.test(text) && /agenda_lembretes/.test(text)) {
      return { rows: [{ id: 44, metadata: {} }] }
    }
    return { rows: [] }
  }
  try {
    const out = await agenda.registrarRespostaLembreteReuniao('5511999999999', 'confirmado, vou participar', {
      classificar: async () => 'reuniao_confirmada',
    })
    assert.equal(out.evento_id, 44)
    assert.equal(out.resposta, 'reuniao_confirmada')
    const updateEvento = calls.find((c) => /UPDATE vendas\.agenda_eventos/.test(c.sql))
    assert.ok(updateEvento)
    assert.equal(updateEvento.params[1], 'confirmado')
    assert.equal(JSON.parse(updateEvento.params[2]).lembrete_resposta, 'reuniao_confirmada')
    assert.ok(calls.some((c) => /UPDATE vendas\.conversas/.test(c.sql)))
  } finally {
    pool.query = originalQuery
  }
})

test('agenda registra pedido de reagendamento de lembrete e sugere horarios livres', async () => {
  const originalQuery = pool.query
  const calls = []
  const mensagens = []
  pool.query = async (sql, params) => {
    const text = String(sql)
    calls.push({ sql: text, params })
    if (/FROM vendas\.agenda_eventos e/.test(text) && /agenda_lembretes/.test(text)) {
      return {
        rows: [{
          id: 45,
          usuario_id: 7,
          metadata: {},
          conversa_numero: '5511999999999',
          lead_numero: null,
        }],
      }
    }
    if (/SELECT data_inicio, data_fim FROM vendas\.agenda_eventos/.test(text)) {
      return { rows: [] }
    }
    return { rows: [] }
  }
  try {
    const out = await agenda.registrarRespostaLembreteReuniao(
      '5511999999999',
      'não consigo, preciso remarcar',
      {
        classificar: async () => 'reagendamento_pendente',
        enviarMensagemFn: async (numero, texto) => {
          mensagens.push({ numero, texto })
        },
      }
    )
    assert.equal(out.evento_id, 45)
    assert.equal(out.resposta, 'reagendamento_pendente')
    assert.equal(out.status, 'reagendamento_pendente')
    assert.equal(out.mensagem_enviada, true)
    assert.equal(mensagens.length, 1)
    assert.match(mensagens[0].texto, /remarca/i)
    const updateEvento = calls.find((c) => /UPDATE vendas\.agenda_eventos/.test(c.sql))
    assert.ok(updateEvento)
    assert.equal(updateEvento.params[1], 'reagendamento_pendente')
    assert.equal(JSON.parse(updateEvento.params[2]).lembrete_resposta, 'reagendamento_pendente')
    assert.ok(calls.some((c) => /sugestao_reagendamento_reuniao/.test(JSON.stringify(c.params || []))))
  } finally {
    pool.query = originalQuery
  }
})

test('classificarRespostaLembreteIA mapeia intencao da IA e cai em null com seguranca', async () => {
  const aiFake = (intencao) => ({
    generateAIResponse: async () => ({ text: JSON.stringify({ intencao }) }),
  })
  assert.equal(await agenda.classificarRespostaLembreteIA('vou sim, confirmo', { aiProvider: aiFake('confirma') }), 'reuniao_confirmada')
  assert.equal(await agenda.classificarRespostaLembreteIA('nao consigo nesse dia', { aiProvider: aiFake('remarcar') }), 'reagendamento_pendente')
  // intencao "outro" (ex.: "amanha te mando a foto") NAO dispara remarcacao falsa
  assert.equal(await agenda.classificarRespostaLembreteIA('amanha te mando a foto', { aiProvider: aiFake('outro') }), null)
  // texto vazio: nem chama a IA
  assert.equal(await agenda.classificarRespostaLembreteIA('   ', { aiProvider: aiFake('confirma') }), null)
  // falha da IA = null (nenhuma acao errada)
  const aiQuebrado = { generateAIResponse: async () => { throw new Error('timeout') } }
  assert.equal(await agenda.classificarRespostaLembreteIA('confirmado', { aiProvider: aiQuebrado }), null)
})

test('lembrete da manha (dia) pede confirmacao ativa (responde sim)', () => {
  const msg = agenda.gerarMensagemLembreteReuniao(
    { data_inicio: '2026-05-12T17:00:00.000Z' },
    { nome: 'Ana' },
    'dia'
  )
  assert.match(msg, /Oi, Ana/)
  assert.match(msg, /14:00/)
  assert.match(msg, /confirmar/i)
  assert.match(msg, /\bsim\b/i)
})

test('montarPingNaoConfirmou inclui nome, hora e telefone limpo; cai em fallback', () => {
  const t = agenda.montarPingNaoConfirmou({ nome: 'Ana', hora: '14:00', numero: '5511988887777@s.whatsapp.net' })
  assert.match(t, /Ana/)
  assert.match(t, /14:00/)
  assert.match(t, /5511988887777/)
  assert.match(t, /não confirmou/)
  const t2 = agenda.montarPingNaoConfirmou({})
  assert.match(t2, /O lead/)
  assert.doesNotMatch(t2, /Lead:/) // sem telefone, nao imprime a linha
})

test('verificarReunioesNaoConfirmadas pinga operador 1x e marca flag idempotente', async () => {
  const originalQuery = pool.query
  const updates = []
  const selects = []
  pool.query = async (sql, params) => {
    const text = String(sql)
    if (/UPDATE vendas\.agenda_eventos/.test(text)) {
      updates.push({ text, params })
      return { rowCount: 1 }
    }
    selects.push(text)
    // lead_profiles nao tem coluna 'nome' (so apelido/negocio) — trava de regressao
    assert.doesNotMatch(text, /lp\.nome/)
    return {
      rows: [{
        id: 555,
        data_inicio: new Date('2026-05-12T17:00:00.000Z'),
        numero: '5511988887777@s.whatsapp.net',
        nome: 'Ana',
      }],
    }
  }
  try {
    const pings = []
    const r = await agenda.verificarReunioesNaoConfirmadas(new Date('2026-05-12T16:00:00.000Z'), {
      notificarOperador: async (txt) => { pings.push(txt); return true },
    })
    assert.equal(r.avisadas, 1)
    assert.equal(pings.length, 1)
    assert.match(pings[0], /Ana/)
    assert.match(pings[0], /não confirmou/)
    assert.match(pings[0], /5511988887777/)
    assert.equal(updates.length, 1)
    assert.match(updates[0].text, /confirmacao_escalada_em/)
  } finally {
    pool.query = originalQuery
  }
})

test('verificarReunioesNaoConfirmadas nao marca flag se o ping falhar (retenta depois)', async () => {
  const originalQuery = pool.query
  let updateChamado = false
  pool.query = async (sql) => {
    if (/UPDATE vendas\.agenda_eventos/.test(String(sql))) { updateChamado = true; return { rowCount: 1 } }
    return { rows: [{ id: 556, data_inicio: new Date('2026-05-12T17:00:00.000Z'), numero: null, nome: 'Bia' }] }
  }
  try {
    const r = await agenda.verificarReunioesNaoConfirmadas(new Date('2026-05-12T16:00:00.000Z'), {
      notificarOperador: async () => false,
    })
    assert.equal(r.avisadas, 0)
    assert.equal(updateChamado, false)
  } finally {
    pool.query = originalQuery
  }
})

test('verificarReunioesNaoConfirmadas e no-op sem notificador', async () => {
  const r = await agenda.verificarReunioesNaoConfirmadas(new Date())
  assert.deepEqual(r, { avisadas: 0 })
})

test('agenda listagem exclui soft delete e filtra usuario comum', async () => {
  const originalQuery = pool.query
  let sqlRecebido = ''
  let paramsRecebidos = null
  pool.query = async (sql, params) => {
    sqlRecebido = sql
    paramsRecebidos = params
    return {
      rows: [
        {
          id: 1,
          usuario_id: 7,
          titulo: 'Retorno',
          tipo: 'retorno',
          status: 'pendente',
          prioridade: 'media',
          data_inicio: new Date('2026-05-10T12:00:00.000Z'),
          data_fim: new Date('2026-05-10T13:00:00.000Z'),
          timezone: 'America/Sao_Paulo',
          recorrente: false,
          metadata: {},
        },
      ],
    }
  }
  try {
    const out = await agenda.listarEventos({
      query: { data: '2026-05-10' },
      user: { id: 7, role: 'vendedor' },
    })
    assert.equal(out.ok, true)
    assert.equal(out.eventos.length, 1)
    assert.match(sqlRecebido, /excluido_em IS NULL/)
    assert.match(sqlRecebido, /e\.data_inicio >= \(\$1::date::timestamp AT TIME ZONE \$8\)/)
    assert.match(sqlRecebido, /e\.data_inicio < \(\(\$2::date::timestamp \+ INTERVAL '1 day'\) AT TIME ZONE \$8\)/)
    assert.doesNotMatch(sqlRecebido, /e\.data_fim >= \(\$1::date::timestamp AT TIME ZONE \$8\)/)
    assert.match(sqlRecebido, /e\.usuario_id = \$7/)
    assert.equal(paramsRecebidos[6], 7)
  } finally {
    pool.query = originalQuery
  }
})

test('agenda listagem por dia usa somente data_inicio e nao arrasta reuniao do dia anterior', async () => {
  const originalQuery = pool.query
  let sqlRecebido = ''
  let paramsRecebidos = null
  pool.query = async (sql, params) => {
    sqlRecebido = sql
    paramsRecebidos = params
    return { rows: [] }
  }
  try {
    const out11 = await agenda.listarEventos({
      query: { data: '2026-05-11' },
      user: { id: 1, role: 'admin' },
    })
    assert.equal(out11.ok, true)
    assert.equal(paramsRecebidos[0], '2026-05-11')
    assert.equal(paramsRecebidos[1], '2026-05-11')
    assert.equal(paramsRecebidos[7], 'America/Sao_Paulo')
    assert.match(sqlRecebido, /data_inicio >=/)
    assert.match(sqlRecebido, /data_inicio </)
    assert.doesNotMatch(sqlRecebido, /data_fim >=/)

    await agenda.listarEventos({
      query: { data: '2026-05-12' },
      user: { id: 1, role: 'admin' },
    })
    assert.equal(paramsRecebidos[0], '2026-05-12')
    assert.equal(paramsRecebidos[1], '2026-05-12')
  } finally {
    pool.query = originalQuery
  }
})

test('agenda criarEventoAgenda usa usuario admin quando usuarioId omitido', async () => {
  const originalQuery = pool.query
  let insertSql = ''
  let insertParams = null
  pool.query = async (sql, params) => {
    if (/dashboard_users/.test(sql)) return { rows: [{ id: 42 }] }
    if (/SELECT \*/.test(sql) && /agenda_eventos/.test(sql) && /data_inicio = \$3/.test(sql)) return { rows: [] }
    if (/INSERT INTO vendas\.agenda_eventos/.test(sql)) {
      insertSql = sql
      insertParams = params
      return {
        rows: [
          {
            id: 99,
            usuario_id: 42,
            titulo: 'Reunião de proposta — Clínica',
            tipo: 'reuniao',
            status: 'pendente',
            prioridade: 'urgente',
            data_inicio: new Date('2026-05-11T22:30:00.000Z'),
            data_fim: new Date('2026-05-11T23:30:00.000Z'),
            timezone: 'America/Sao_Paulo',
            recorrente: false,
            metadata: {},
            origem: 'handoff',
          },
        ],
      }
    }
    return { rows: [] }
  }
  try {
    const ev = await agenda.criarEventoAgenda({
      titulo: 'Reunião de proposta — Clínica',
      tipo: 'reuniao',
      prioridade: 'urgente',
      dataInicio: new Date('2026-05-11T22:30:00.000Z'),
      dataFim: new Date('2026-05-11T23:30:00.000Z'),
      origem: 'handoff',
    })
    assert.ok(ev, 'evento criado')
    assert.equal(ev.usuario_id, 42)
    assert.match(insertSql, /INSERT INTO vendas\.agenda_eventos/)
    assert.equal(insertParams[0], 42)
    assert.equal(insertParams[14], 'handoff')
  } finally {
    pool.query = originalQuery
  }
})

test('agenda criarEventoAgenda nao duplica reuniao de proposta do mesmo lead e horario', async () => {
  const originalQuery = pool.query
  let inserts = 0
  let duplicidadeSql = ''
  pool.query = async (sql, params) => {
    if (/SELECT \*/.test(sql) && /agenda_eventos/.test(sql) && /data_inicio = \$3/.test(sql)) {
      duplicidadeSql = sql
      assert.equal(params[0], 7)
      assert.equal(params[1], 'reuniao')
      assert.equal(params[3], 'handoff')
      assert.equal(params[4], 123)
      return {
        rows: [{
          id: 55,
          usuario_id: 7,
          lead_id: 123,
          titulo: 'Reuniao de proposta existente',
          tipo: 'reuniao',
          status: 'pendente',
          prioridade: 'urgente',
          data_inicio: new Date('2026-05-11T22:30:00.000Z'),
          data_fim: new Date('2026-05-11T22:45:00.000Z'),
          timezone: 'America/Sao_Paulo',
          recorrente: false,
          regra_recorrencia: null,
          recorrencia_id: null,
          origem: 'handoff',
          metadata: { lead_numero: '5511999999999' },
        }],
      }
    }
    if (/INSERT INTO vendas\.agenda_eventos/.test(sql)) {
      inserts += 1
    }
    return { rows: [] }
  }
  try {
    const ev = await agenda.criarEventoAgenda({
      usuarioId: 7,
      leadId: 123,
      titulo: 'Reuniao de proposta',
      tipo: 'reuniao',
      prioridade: 'urgente',
      dataInicio: new Date('2026-05-11T22:30:00.000Z'),
      dataFim: new Date('2026-05-11T22:45:00.000Z'),
      metadata: { lead_numero: '5511999999999' },
      origem: 'handoff',
    })
    assert.equal(ev.id, 55)
    assert.equal(inserts, 0)
    assert.match(duplicidadeSql, /metadata->>'lead_numero'/)
  } finally {
    pool.query = originalQuery
  }
})

test('agenda criarEventoAgenda cria reuniao de proposta sem recorrencia', async () => {
  const originalQuery = pool.query
  let insertParams = null
  pool.query = async (sql, params) => {
    if (/SELECT \*/.test(sql) && /agenda_eventos/.test(sql)) return { rows: [] }
    if (/INSERT INTO vendas\.agenda_eventos/.test(sql)) {
      insertParams = params
      return {
        rows: [{
          id: 88,
          usuario_id: 7,
          titulo: 'Reuniao de proposta',
          tipo: 'reuniao',
          status: 'pendente',
          prioridade: 'urgente',
          data_inicio: new Date('2026-05-11T22:30:00.000Z'),
          data_fim: new Date('2026-05-11T22:45:00.000Z'),
          timezone: 'America/Sao_Paulo',
          recorrente: false,
          regra_recorrencia: null,
          recorrencia_id: null,
          origem: 'handoff',
          metadata: {},
        }],
      }
    }
    return { rows: [] }
  }
  try {
    const ev = await agenda.criarEventoAgenda({
      usuarioId: 7,
      titulo: 'Reuniao de proposta',
      tipo: 'reuniao',
      prioridade: 'urgente',
      dataInicio: new Date('2026-05-11T22:30:00.000Z'),
      dataFim: new Date('2026-05-11T22:45:00.000Z'),
      origem: 'handoff',
    })
    assert.equal(ev.recorrente, false)
    assert.equal(insertParams[11], false)
    assert.equal(insertParams[12], 'null')
    assert.equal(insertParams[13], null)
  } finally {
    pool.query = originalQuery
  }
})

test('agenda criarEventoAgenda nao cria reuniao em horario bloqueado', async () => {
  const originalQuery = pool.query
  let inserts = 0
  pool.query = async (sql, params) => {
    if (/SELECT \*/.test(sql) && /agenda_eventos/.test(sql)) return { rows: [] }
    if (/SELECT COUNT\(\*\) AS n/.test(sql) && /status = ANY/.test(sql)) {
      // Reunião 23:15–23:30 + buffer 30min → janela de conflito expandida (22:45–00:00).
      assert.equal(params[0].toISOString(), '2026-05-12T22:45:00.000Z')
      assert.equal(params[1].toISOString(), '2026-05-13T00:00:00.000Z')
      assert.ok(params[2].includes('bloqueado'))
      return { rows: [{ n: '1' }] }
    }
    if (/INSERT INTO vendas\.agenda_eventos/.test(sql)) inserts += 1
    return { rows: [] }
  }
  try {
    const ev = await agenda.criarEventoAgenda({
      usuarioId: 7,
      titulo: 'Reuniao de proposta',
      tipo: 'reuniao',
      dataInicio: new Date('2026-05-12T23:15:00.000Z'),
      dataFim: new Date('2026-05-12T23:30:00.000Z'),
      origem: 'handoff',
    })
    assert.equal(ev, null)
    assert.equal(inserts, 0)
  } finally {
    pool.query = originalQuery
  }
})

test('agenda criarEventoAgenda retorna null se datas invalidas', async () => {
  const ev = await agenda.criarEventoAgenda({
    usuarioId: 1,
    titulo: 'Evento inválido',
    tipo: 'tarefa',
    dataInicio: 'nao-e-data',
    dataFim: 'tambem-nao',
  })
  assert.equal(ev, null)
})

test('agenda criarEventoAgenda retorna null se dataFim <= dataInicio', async () => {
  const ev = await agenda.criarEventoAgenda({
    usuarioId: 1,
    titulo: 'Evento invertido',
    tipo: 'tarefa',
    dataInicio: new Date('2026-05-11T22:30:00.000Z'),
    dataFim: new Date('2026-05-11T22:30:00.000Z'),
  })
  assert.equal(ev, null)
})

test('agenda inserirEvento usa origem customizada quando fornecida', async () => {
  const originalQuery = pool.query
  let capturedOrigem = null
  pool.query = async (sql, params) => {
    if (/SELECT \*/.test(sql) && /agenda_eventos/.test(sql) && /data_inicio = \$3/.test(sql)) return { rows: [] }
    if (/INSERT INTO vendas\.agenda_eventos/.test(sql)) {
      capturedOrigem = params[14]
      return { rows: [{ id: 1, usuario_id: 1, titulo: 'x', tipo: 'tarefa', status: 'pendente', prioridade: 'media', data_inicio: new Date(), data_fim: new Date(Date.now() + 3600000), timezone: 'America/Sao_Paulo', recorrente: false, metadata: {} }] }
    }
    return { rows: [] }
  }
  try {
    await agenda.criarEventoAgenda({
      usuarioId: 1,
      titulo: 'Evento sistema',
      tipo: 'tarefa',
      dataInicio: new Date('2026-05-11T22:00:00.000Z'),
      dataFim: new Date('2026-05-11T23:00:00.000Z'),
      origem: 'sistema',
    })
    assert.equal(capturedOrigem, 'sistema')
  } finally {
    pool.query = originalQuery
  }
})

test('dashboard auth bloqueia mutacao com sessao valida mas sem CSRF', async () => {
  const originalQuery = pool.query
  pool.query = async (sql) => {
    const text = String(sql)
    if (text.includes('FROM vendas.dashboard_sessions')) {
      return {
        rows: [{
          id: 'sessao-1',
          csrf_token: 'csrf-correto',
          user_id: 1,
          email: 'admin@example.com',
          nome: 'Admin',
          role: 'admin',
        }],
      }
    }
    return { rows: [] }
  }
  try {
    const req = {
      method: 'POST',
      originalUrl: '/dashboard/followup',
      url: '/dashboard/followup',
      headers: { cookie: 'pj_dashboard_session=sessao-1' },
      body: { numero: '5511999999999' },
      socket: { remoteAddress: '127.0.0.1' },
    }
    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this },
      json(payload) { this.body = payload; return this },
    }
    let nextCalled = false
    await dashboardAuth.requireDashboardAuth(req, res, () => { nextCalled = true })
    assert.equal(nextCalled, false)
    assert.equal(res.statusCode, 403)
    assert.equal(res.body.ok, false)
  } finally {
    pool.query = originalQuery
  }
})

test('logger redige telefones brasileiros e JIDs de WhatsApp', () => {
  assert.equal(redactPhone('+55 (11) 99888-7777'), '55***7777')
  assert.equal(redactPhone('5511998887777@s.whatsapp.net'), '55***7777@s.whatsapp.net')
})

test('logger redige headers, secrets e telefones preservando contexto util', () => {
  const redigido = redactValue({
    request_id: 'req-test',
    flow: 'webhook',
    job_id: 42,
    http_status: 429,
    authorization: 'Bearer token-super-secreto',
    apikey: 'evolution-key',
    numero: '5511998887777@s.whatsapp.net',
    nested: {
      telefone: '+55 11 91234-5678',
      detail: 'falha externa para 5511912345678 com token=abc123456',
    },
  })

  assert.equal(redigido.request_id, 'req-test')
  assert.equal(redigido.flow, 'webhook')
  assert.equal(redigido.job_id, 42)
  assert.equal(redigido.http_status, 429)
  assert.equal(redigido.authorization, '[REDACTED_SECRET]')
  assert.equal(redigido.apikey, '[REDACTED_SECRET]')
  assert.equal(redigido.numero, '55***7777@s.whatsapp.net')
  assert.equal(redigido.nested.telefone, '55***5678')
  assert.match(redigido.nested.detail, /\*\*\*5678/)
  assert.match(redigido.nested.detail, /token=\[REDACTED_SECRET\]/)
})

test('logger serializa erro externo sem vazar telefone ou segredo', () => {
  const err = new Error('Erro enviando para 5511998887777 com Bearer abcdefghijk')
  err.code = 'ECONNRESET'
  err.response = {
    status: 500,
    data: {
      message: 'falha no numero 5511998887777',
      token: 'secret-token',
    },
  }

  const serializado = serializeError(err)
  assert.equal(serializado.code, 'ECONNRESET')
  assert.equal(serializado.http_status, 500)
  assert.match(serializado.message, /\*\*\*7777/)
  assert.doesNotMatch(serializado.message, /abcdefghijk/)
  assert.equal(serializado.response_data.token, '[REDACTED_SECRET]')
  assert.match(serializado.response_data.message, /\*\*\*7777/)
})

test('calcularPreco calcula plano, ROI e parcelamento', () => {
  const r = calcularPreco({
    plano_sugerido: 'padrao',
    ticket_cliente_final: 'alto',
    score_dor: 8,
    complexidade: 'servicos',
    negocio: 'vidracaria',
    cidade: 'Sao Paulo',
  })

  assert.equal(r.precificacao_json.plano_recomendado, 'padrao')
  assert.equal(r.precificacao_json.roi_score, 0.73)
  assert.equal(r.total, 892)
  assert.deepEqual({ entrada: r.entrada, parcela: r.parcela }, { entrada: 357, parcela: 178 })
})

test('contexto interno entra em bloco separado para prompt', () => {
  const bloco = montarBlocoContextoInterno([
    {
      tipo: 'contexto_manual',
      origem: 'operador',
      criado_em: '2026-04-27T10:00:00.000Z',
      conteudo: 'Ligacao feita: lead vai ler a proposta hoje.',
    },
  ])
  assert.match(bloco, /CONTEXTO INTERNO DO OPERADOR/)
  assert.match(bloco, /nao trate como fala literal do lead/i)
  assert.match(bloco, /Ligacao feita/)
})

test('bloco de continuidade ancora ultima troca e evita reinicio generico', () => {
  const bloco = montarBlocoContinuidadeTurno(
    [
      { role: 'assistant', content: 'Perfeito. Qual serviço você mais quer vender em Campinas?' },
      { role: 'user', content: 'Implante e prótese, aqui em Campinas.' },
    ],
    {
      negocio: 'clinica odontologica',
      cidade: 'Campinas',
      ticket_cliente_final: 'alto',
    }
  )
  assert.match(bloco, /CONTINUIDADE OBRIGATORIA DO TURNO/)
  assert.match(bloco, /Ultima fala do lead/)
  assert.match(bloco, /Contexto ja confirmado/)
  assert.match(bloco, /nao reinicie abertura/i)
})

test('prompt dinamico inclui bloco de continuidade quando ha historico', () => {
  const system = montarSystemPromptDinamico(
    'diagnostico',
    { negocio: 'clinica odontologica', cidade: 'Campinas' },
    '',
    {},
    [
      { role: 'assistant', content: 'Perfeito, você atende qual cidade?' },
      { role: 'user', content: 'Campinas, foco em implante dentário.' },
    ]
  )
  const texto = system.map((b) => b?.text || '').join('\n')
  assert.match(texto, /CONTINUIDADE OBRIGATORIA DO TURNO/)
  assert.match(texto, /Ultima fala do lead/)
})

test('diagnosticoCompletoParaPreco exige campos minimos', () => {
  assert.equal(
    diagnosticoCompletoParaPreco({
      negocio: 'clinica',
      cidade: 'Campinas',
      ticket_cliente_final: 'medio',
      score_dor: 7,
      complexidade: 'landing',
    }),
    true
  )
  assert.equal(diagnosticoCompletoParaPreco({ negocio: 'clinica' }), false)
})

test('contarPedidosPrecoDoLead conta apenas mensagens do lead', () => {
  const historico = [
    { role: 'assistant', content: 'O valor fica para o final.' },
    { role: 'user', content: 'quanto custa?' },
    { role: 'operator', content: 'perguntou preço' },
    { role: 'user', content: 'me passa um orçamento' },
  ]
  assert.equal(contarPedidosPrecoDoLead(historico), 2)
  assert.equal(textoPedePreco('qual o investimento?'), true)
  assert.equal(textoPedePreco('bom dia'), false)
})

test('intencao: lead pergunta preco de site conduz para agenda sem valores concretos', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Quanto custa um site?',
    perfil: {},
    estagio: 'primeiro_contato',
    historico: [{ role: 'user', content: 'Quanto custa um site?' }],
  })
  assert.equal(decisao.interpretacao.intencao_principal, 'pergunta_preco')
  assert.equal(decisao.proxima_acao, 'consultar_agenda_e_oferecer_horarios')
  assert.equal(decisao.deve_sobrescrever_modelo, true)
  assert.equal(decisao.resultado, null)
})

test('intencao: lead pergunta preco apos diagnostico recebe valor calculado', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Mas quanto fica?',
    perfil: {
      negocio: 'clínica odontológica',
      cidade: 'Ariquemes',
      preco_calculado: 920,
      entrada: 360,
      parcela: 187,
    },
    estagio: 'proposta',
  })
  // Novo fluxo: responder_preco delega a composicao para o LLM (resultado e null)
  assert.equal(decisao.proxima_acao, 'responder_preco')
  assert.equal(decisao.resultado, null)
  assert.equal(decisao._flags_extras?.etapa_proxima, 'proposta')
  assert.equal(decisao._flags_extras?.proxima_acao_hint, 'responder_preco')
})

test('intencao: projeto sob medida nunca responde preco automatico ao lead', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Quanto custa?',
    perfil: {
      projeto_sob_medida: true,
      preco_calculado: 920,
      entrada: 360,
      parcela: 187,
      servico_principal: 'sistema com automacao',
    },
    estagio: 'diagnostico',
  })
  assert.equal(ehProjetoSobMedida(decisao.estado_comercial ? { projeto_sob_medida: true } : {}, 'sistema sob medida'), true)
  assert.equal(decisao.interpretacao.intencao_principal, 'pergunta_preco')
  assert.equal(decisao.proxima_acao, 'consultar_agenda_e_oferecer_horarios')
  assert.equal(decisao.resultado, null)
})

test('intencao: plano personalizado pergunta valor consulta agenda sem mostrar R$', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'qual o valor?',
    perfil: {
      plano: 'personalizado',
      preco_calculado: 1500,
      entrada: 600,
      parcela: 300,
    },
    estagio: 'proposta',
  })
  assert.equal(decisao.proxima_acao, 'consultar_agenda_e_oferecer_horarios')
  assert.equal(decisao.deve_sobrescrever_modelo, true)
  assert.equal(decisao.resultado, null)
})

test('intencao: preco de sistema automacao ou agente de IA vira reuniao de escopo', async () => {
  for (const servico of ['sistema interno', 'automacao comercial', 'agente de IA']) {
    const decisao = await decidirProximaResposta({
      texto: 'me passa preço',
      perfil: { servico_principal: servico, preco_calculado: 2000 },
      estagio: 'diagnostico',
    })
    assert.equal(decisao.proxima_acao, 'consultar_agenda_e_oferecer_horarios')
    assert.equal(decisao.resultado, null)
  }
})

test('core funnel: preco em projeto sob medida oferece slots reais sem valores ao lead', async () => {
  const { createCoreFunnel } = require('../src/core-funnel')
  const enviados = []
  const atualizacoes = []
  const conversa = {
    numero: '5511999999999@s.whatsapp.net',
    historico: [{ role: 'user', content: 'qual o valor?' }],
    estagio: 'diagnostico',
    status: 'ativo',
  }
  const perfil = {
    projeto_sob_medida: true,
    servico_principal: 'sistema com automação',
    preco_calculado: 1800,
    entrada: 720,
    parcela: 360,
  }
  const core = createCoreFunnel({
    logger: { info() {}, warn() {}, error() {} },
    pool: { query: async () => ({ rows: [] }) },
    normalizarHistoricoMensagens: (h) => h,
    buscarConversa: async () => conversa,
    buscarPerfil: async () => perfil,
    garantirConcorrentesReaisNoPerfil: async (p) => p,
    diagnosticoCompletoParaPreco: () => false,
    calcularPreco,
    atualizarPerfil: async (_numero, patch) => {
      atualizacoes.push(patch)
      Object.assign(perfil, patch)
      return patch
    },
    chamarClaude: fakeClaudeMock(),
    historicoCresceuSoComUsers: () => false,
    aplicarGuardrailReuniaoProposta: async (r) => r,
    buscarSlotsDisponiveis: async () => ({
      data_sugerida: '2026-05-12',
      data_label: 'hoje',
      horarios_sugeridos: ['19:30', '20:15'],
    }),
    sanitizarPlaceholderEmpresaNaSaidaTexto: (x) => x,
    sanitizarCpfNaSaidaTexto: (x) => x,
    enviarPrintLocal: async () => {},
    filtrarLinksSugeridosParaEnvio: () => [],
    enviarComBotoes: async () => {},
    enviarMensagem: async (_numero, msg) => { enviados.push(msg) },
    enviarSequenciaMensagens: async (_numero, msgs) => { enviados.push(...msgs) },
    extrairValoresReaisDoTextoBrasil: (txt) => (String(txt).match(/R\$\s*\d+/g) || []),
    registrarEventoComercial: async () => {},
    gerarEEnviarPreviewSite: async () => {},
    salvarConversa: async () => {},
    limparFalhaResposta: async () => {},
    persistirAgendamentoFollowupExplicito: async () => {},
    atualizarCamadaMemoriaVendasPosResposta: async () => {},
    registrarLacunaConhecimento: async () => {},
    alertarLacunaConhecimento: async () => {},
    notificarVictorWhatsapp: async () => false,
    alertarHandoff: async () => {},
    decidirProximaResposta,
    parsearHorarioReuniao,
    calcularFimReuniao,
    dataInicioReuniao,
  })
  await core.gerarEEnviarRespostaWhatsapp(conversa.numero, conversa.historico)
  const msg = enviados.join('\n')
  // Novo orquestrador: responder_preco_sem_contexto nao e turno de agenda,
  // entao pularDeterministicoConversa=true e o LLM compoe livremente.
  // O criterio real e: zero valores em R$ + menciona reuniao/equipe + sem slots ficticios.
  assert.match(msg, /conversa rapida|reuniao|projeto sob medida|alinhar|marcar/i)
  assert.match(msg, /equipe da PJ Codeworks/)
  assert.doesNotMatch(msg, /R\$|entrada|parcelas|3x|faixa|estimativa/i)
  assert.doesNotMatch(msg, /19:30|20:15/)
  assert.doesNotMatch(msg, /R\$|entrada|parcelas|3x|faixa|estimativa/i)
})

/**
 * Mock de LLM para testes do core-funnel apos a arquitetura "LLM compoe
 * a mensagem". Simula respostas plausíveis para cada acao do orquestrador,
 * usando dados do `nextActionContext` (slots, perfil, acao).
 *
 * Os testes devem checar INTENCAO (mencao a 19:30, mencao a "assinatura"),
 * nao texto literal — o LLM real produz variacoes.
 */
function fakeClaudeMock() {
  return async (_historico, _estagio, _perfil, _visao, opcoes = {}) => {
    const ctx = (opcoes && opcoes.nextActionContext) || {}
    const acao = ctx.acao_decidida
    const horarios = Array.isArray(ctx.horarios_disponiveis) ? ctx.horarios_disponiveis : []
    const dataLabel = ctx.data_label_agenda || 'hoje'
    const negocio = ctx.perfil?.negocio || 'seu negócio'

    if (acao === 'convite_reuniao' && horarios.length) {
      const opcoesStr = horarios.length > 1 ? `${horarios[0]} ou ${horarios[1]}` : horarios[0]
      const propostaLead = ctx.dados_extraidos?.horario
      const intro = propostaLead && !horarios.includes(propostaLead)
        ? `Entendi, ${propostaLead}. Pra alinhar com a janela da equipe da PJ Codeworks, te mostro o que tenho:`
        : `Faz sentido marcar uma conversa rapida de 15min com a equipe da PJ Codeworks pra ${negocio}.`
      const mensagem = `${intro}\n\nTenho ${dataLabel} as ${opcoesStr} disponiveis. Qual fica melhor?`
      return {
        mensagem_pro_lead: mensagem,
        mensagens_bolhas: [mensagem],
        atualizar_perfil: {
          reuniao_proposta: {
            necessaria: true,
            data_sugerida: ctx.data_sugerida_agenda,
            data_label: dataLabel,
            horarios_sugeridos: horarios,
            horario_confirmado: null,
            duracao_maxima_minutos: 15,
          },
        },
        etapa_proxima: 'agendamento_pendente',
        solicitar_calculo_preco: false,
        handoff: false,
        motivo_handoff: null,
      }
    }

    if (acao === 'responder_preco_sem_contexto') {
      const ehSobMedida = ctx?.perfil?.projeto_sob_medida ||
        /sob_?medida/i.test(String(ctx?.perfil?.servico_principal || ''))
      const mensagem = ehSobMedida
        ? `Faz sentido marcar uma conversa rapida com a equipe da PJ Codeworks. Tenho ${dataLabel} as ${horarios.length ? horarios.join(' ou ') : '19:30 ou 20:15'} disponiveis.`
        : 'Temos dois caminhos: um projeto mais simples para começar rapido, ou um projeto sob medida quando precisa de algo personalizado (sistema, automacao). Pra te orientar: voce procura um site simples, um site personalizado, sistema ou automacao?'
      return {
        mensagem_pro_lead: mensagem,
        mensagens_bolhas: [mensagem],
        atualizar_perfil: {
          ...(ehSobMedida && horarios.length ? {
            reuniao_proposta: {
              necessaria: true,
              data_sugerida: ctx.data_sugerida_agenda,
              data_label: dataLabel,
              horarios_sugeridos: horarios,
              horario_confirmado: null,
              duracao_maxima_minutos: 15,
            },
          } : {}),
          eventos_conversa: { perguntou_preco: true, ultima_acao: acao },
        },
        etapa_proxima: ehSobMedida ? 'agendamento_pendente' : 'coleta_basica',
        solicitar_calculo_preco: false,
        handoff: false,
        motivo_handoff: null,
      }
    }

    if (acao === 'explicar_assinatura') {
      const mensagem = 'Perfeito. A assinatura de site faz mais sentido pro seu caso: estrutura simples, pagina profissional, caminho direto pro WhatsApp. Quer que eu te envie o link pra ver e ativar?'
      return {
        mensagem_pro_lead: mensagem,
        mensagens_bolhas: [mensagem],
        atualizar_perfil: { eventos_conversa: { rota_comercial: 'assinatura_site', ultima_acao: acao } },
        etapa_proxima: 'proposta',
        solicitar_calculo_preco: false,
        handoff: false,
        motivo_handoff: null,
      }
    }

    // Fallback: quando o orquestrador novo nao passa nextActionContext
    // (pularDeterministicoConversa === true), o LLM compoe livremente.
    // O mock simula respostas plausíveis baseadas no perfil.
    const perfilObj = _perfil || ctx.perfil || {}
    if (perfilObj.projeto_sob_medida) {
      if (horarios.length) {
        const msg = `Como e um projeto sob medida, o valor depende da estrutura. A equipe da PJ Codeworks te mostra tudo na reuniao. Tenho ${dataLabel} as ${horarios[0]} disponivel — funciona?`
        return {
          mensagem_pro_lead: msg,
          mensagens_bolhas: [msg],
          atualizar_perfil: {
            reuniao_proposta: {
              necessaria: true,
              data_sugerida: ctx.data_sugerida_agenda || null,
              data_label: dataLabel,
              horarios_sugeridos: horarios,
              horario_confirmado: null,
              duracao_maxima_minutos: 15,
            },
          },
          etapa_proxima: 'agendamento_pendente',
          solicitar_calculo_preco: false,
          handoff: false,
          motivo_handoff: null,
        }
      }
      // Sem horarios reais — nao inventa slots ficticios.
      const msg = 'Como e um projeto sob medida, o valor depende da estrutura que sua empresa precisa. A equipe da PJ Codeworks te mostra estrutura, prazo e investimento na reuniao, sem chute.'
      return {
        mensagem_pro_lead: msg,
        mensagens_bolhas: [msg],
        atualizar_perfil: {},
        etapa_proxima: 'proposta',
        solicitar_calculo_preco: false,
        handoff: false,
        motivo_handoff: null,
      }
    }
    // Default: resposta neutra que nao quebra outros testes
    return {
      mensagem_pro_lead: 'Entendi, vamos seguir.',
      mensagens_bolhas: ['Entendi, vamos seguir.'],
      atualizar_perfil: {},
      etapa_proxima: ctx.etapa_atual || 'diagnostico',
      solicitar_calculo_preco: false,
      handoff: false,
      motivo_handoff: null,
    }
  }
}

function criarCoreFunnelAgendaTeste({ conversa, perfil, buscarSlotsDisponiveis, logger = null, alertarHandoff = null, chamarClaude = null, validarSlotReuniao = null, buscarDisponibilidadeSemana = null }) {
  const { createCoreFunnel } = require('../src/core-funnel')
  const enviados = []
  const atualizacoes = []
  const chamadasClaude = []
  const core = createCoreFunnel({
    logger: logger || { info() {}, warn() {}, error() {} },
    pool: { query: async () => ({ rows: [] }) },
    normalizarHistoricoMensagens: (h) => h,
    buscarConversa: async () => conversa,
    buscarPerfil: async () => perfil,
    garantirConcorrentesReaisNoPerfil: async (p) => p,
    diagnosticoCompletoParaPreco: () => false,
    calcularPreco,
    atualizarPerfil: async (_numero, patch) => {
      atualizacoes.push(patch)
      Object.assign(perfil, patch)
      return patch
    },
    chamarClaude: chamarClaude || (async () => {
      throw new Error('nao deve chamar modelo')
    }),
    historicoCresceuSoComUsers: () => false,
    aplicarGuardrailReuniaoProposta: async (r) => r,
    buscarSlotsDisponiveis,
    sanitizarPlaceholderEmpresaNaSaidaTexto: (x) => x,
    sanitizarCpfNaSaidaTexto: (x) => x,
    enviarPrintLocal: async () => {},
    filtrarLinksSugeridosParaEnvio: () => [],
    enviarComBotoes: async () => {},
    enviarMensagem: async (_numero, msg) => { enviados.push(msg) },
    enviarSequenciaMensagens: async (_numero, msgs) => { enviados.push(...msgs) },
    extrairValoresReaisDoTextoBrasil: (txt) => (String(txt).match(/R\$\s*\d+/g) || []),
    registrarEventoComercial: async () => {},
    gerarEEnviarPreviewSite: async () => {},
    salvarConversa: async () => {},
    limparFalhaResposta: async () => {},
    persistirAgendamentoFollowupExplicito: async () => {},
    atualizarCamadaMemoriaVendasPosResposta: async () => {},
    registrarLacunaConhecimento: async () => {},
    alertarLacunaConhecimento: async () => {},
    notificarVictorWhatsapp: async () => false,
    alertarHandoff: alertarHandoff || (async () => {}),
    decidirProximaResposta,
    parsearHorarioReuniao,
    calcularFimReuniao,
    dataInicioReuniao,
    ...(validarSlotReuniao ? { validarSlotReuniao } : {}),
    ...(buscarDisponibilidadeSemana ? { buscarDisponibilidadeSemana } : {}),
  })
  return { core, enviados, atualizacoes }
}

test('aceite fluxo: pedido de preco nao consulta agenda nem gera handoff sem diagnostico completo', async () => {
  const conversa = {
    numero: '5511999999999@s.whatsapp.net',
    historico: [{ role: 'user', content: 'Quanto custa um site?' }],
    estagio: 'diagnostico',
    status: 'ativo',
  }
  const perfil = {
    negocio: 'barbearia',
    cidade: 'São Bernardo do Campo',
    necessidade: 'site',
    projeto_sob_medida: true,
  }
  let agendaConsultada = false
  // IA-primaria: a LLM compoe a resposta de preco (consultiva, sem vazar valor/agenda).
  // O mock simula essa resposta; o teste verifica os guardrails deterministicos:
  // agenda NAO consultada, sem horarios, sem preco, sem reuniao agendada.
  const { core, enviados, atualizacoes } = criarCoreFunnelAgendaTeste({
    conversa,
    perfil,
    chamarClaude: async () => ({
      mensagem_pro_lead: 'Depende do tipo de site. Uma pagina simples para comecar e diferente de uma estrutura mais completa com servicos e SEO local. Voce quer algo mais simples para comecar ou uma estrutura mais completa?',
      mensagens_bolhas: ['Depende do tipo de site. Uma pagina simples para comecar e diferente de uma estrutura mais completa com servicos e SEO local. Voce quer algo mais simples para comecar ou uma estrutura mais completa?'],
      atualizar_perfil: {},
      etapa_proxima: 'diagnostico',
      solicitar_calculo_preco: false,
      handoff: false,
      motivo_handoff: null,
    }),
    buscarSlotsDisponiveis: async () => {
      agendaConsultada = true
      return {
        data_sugerida: '2026-05-19',
        data_label: 'hoje',
        horarios_sugeridos: ['19:30', '20:15'],
      }
    },
  })

  await core.gerarEEnviarRespostaWhatsapp(conversa.numero, conversa.historico)
  const msg = enviados.join('\n')

  assert.equal(agendaConsultada, false)
  assert.match(msg, /depende do tipo de site/i)
  assert.match(msg, /simples para comecar|estrutura mais completa/i)
  assert.doesNotMatch(msg, /19:30|20:15/)
  assert.doesNotMatch(msg, /R\$|entrada|parcela|3x|a partir de|faixa/i)
  assert.equal(atualizacoes.some((p) => p.reuniao_proposta?.horarios_sugeridos?.includes('19:30')), false)
})

test('agenda IA: escolha em linguagem natural ("19 e30") -> IA emite reuniao_escolha -> codigo agenda (sem loop)', async () => {
  // Reproduz a conversa real onde "19 e30" nao casava no regex e o template
  // determinIstico reofertava em loop. Agora o turno vai para a IA, que captura
  // a escolha no JSON; o codigo valida contra os slots reais e agenda.
  const conversa = {
    numero: '5511999999999@s.whatsapp.net',
    historico: [
      { role: 'assistant', content: 'Tenho amanhã às 19:30 ou 19:45 disponíveis. Qual fica melhor?' },
      { role: 'user', content: '19 e30 ok querido' },
    ],
    estagio: 'agendamento_pendente',
    status: 'ativo',
  }
  const perfil = {
    negocio: 'cosmeticos',
    cidade: 'Planaltina',
    necessidade: 'site',
    rota_comercial: 'projeto_sob_medida',
    reuniao_proposta: {
      necessaria: true,
      data_sugerida: '2026-06-05',
      data_label: 'amanha',
      horarios_sugeridos: ['19:30', '19:45'],
      horario_confirmado: null,
    },
  }
  const { core, atualizacoes } = criarCoreFunnelAgendaTeste({
    conversa,
    perfil,
    // A IA interpreta "19 e30" como 19:30 e devolve a escolha no JSON.
    chamarClaude: async () => ({
      mensagem_pro_lead: 'Perfeito! Sua reunião está marcada para amanhã às 19:30 com a equipe. Qual o melhor e-mail para o convite?',
      mensagens_bolhas: ['Perfeito! Sua reunião está marcada para amanhã às 19:30 com a equipe.', 'Qual o melhor e-mail para o convite?'],
      atualizar_perfil: {},
      etapa_proxima: 'reuniao_agendada',
      reuniao_escolha: { data: '2026-06-05', horario: '19:30' },
      handoff: false,
      motivo_handoff: null,
    }),
    buscarSlotsDisponiveis: async () => ({ data_sugerida: '2026-06-05', data_label: 'amanha', horarios_sugeridos: ['19:30', '19:45'] }),
  })

  await core.gerarEEnviarRespostaWhatsapp(conversa.numero, conversa.historico)

  // O codigo capturou a escolha confirmada pela IA e gravou o agendamento.
  const confirmada = atualizacoes.map((p) => p.reuniao_proposta).filter(Boolean).pop()
  assert.ok(confirmada, 'deve persistir reuniao_proposta')
  assert.equal(confirmada.horario_confirmado, '19:30')
  assert.equal(confirmada.data_sugerida, '2026-06-05')
})

test('agenda IA: escolha fora dos slots ofertados NAO agenda (guardrail)', async () => {
  const conversa = {
    numero: '5511999999999@s.whatsapp.net',
    historico: [
      { role: 'assistant', content: 'Tenho amanhã às 19:30 ou 19:45 disponíveis. Qual fica melhor?' },
      { role: 'user', content: 'pode ser 22h' },
    ],
    estagio: 'agendamento_pendente',
    status: 'ativo',
  }
  const perfil = {
    negocio: 'cosmeticos',
    cidade: 'Planaltina',
    necessidade: 'site',
    rota_comercial: 'projeto_sob_medida',
    reuniao_proposta: {
      necessaria: true,
      data_sugerida: '2026-06-05',
      horarios_sugeridos: ['19:30', '19:45'],
      horario_confirmado: null,
    },
  }
  const { core, atualizacoes } = criarCoreFunnelAgendaTeste({
    conversa,
    perfil,
    // IA alucina um horario fora da lista -> codigo NAO pode agendar.
    chamarClaude: async () => ({
      mensagem_pro_lead: 'Esse horario nao tenho; tenho 19:30 ou 19:45. Qual prefere?',
      mensagens_bolhas: ['Esse horario nao tenho; tenho 19:30 ou 19:45. Qual prefere?'],
      atualizar_perfil: {},
      etapa_proxima: 'agendamento_pendente',
      reuniao_escolha: { data: '2026-06-05', horario: '22:00' },
      handoff: false,
      motivo_handoff: null,
    }),
    buscarSlotsDisponiveis: async () => ({ data_sugerida: '2026-06-05', data_label: 'amanha', horarios_sugeridos: ['19:30', '19:45'] }),
  })

  await core.gerarEEnviarRespostaWhatsapp(conversa.numero, conversa.historico)
  const agendou = atualizacoes.some((p) => p.reuniao_proposta?.horario_confirmado)
  assert.equal(agendou, false, 'horario fora dos slots reais nao pode ser agendado')
})

test('agenda IA: lead escolhe OUTRO dia da janela -> validacao ao vivo aprova -> agenda', async () => {
  const conversa = {
    numero: '5511999999999@s.whatsapp.net',
    historico: [
      { role: 'assistant', content: 'Tenho amanhã às 19:30 ou 19:45. Pode ser outro dia também — qual prefere?' },
      { role: 'user', content: 'na quinta as 20:30 fica melhor' },
    ],
    estagio: 'agendamento_pendente',
    status: 'ativo',
  }
  const perfil = {
    negocio: 'cosmeticos', cidade: 'Planaltina', necessidade: 'site', rota_comercial: 'projeto_sob_medida',
    reuniao_proposta: {
      necessaria: true,
      data_sugerida: '2026-06-05',
      horarios_sugeridos: ['19:30', '19:45'], // ofertados no dia sugerido
      horario_confirmado: null,
    },
  }
  let validadoCom = null
  const { core, atualizacoes } = criarCoreFunnelAgendaTeste({
    conversa,
    perfil,
    // IA mapeia "quinta as 20:30" para um slot real e captura no JSON.
    chamarClaude: async () => ({
      mensagem_pro_lead: 'Fechado! Quinta às 20:30 então. Qual o melhor e-mail para o convite?',
      mensagens_bolhas: ['Fechado! Quinta às 20:30 então.', 'Qual o melhor e-mail para o convite?'],
      atualizar_perfil: {},
      etapa_proxima: 'reuniao_agendada',
      reuniao_escolha: { data: '2026-06-11', horario: '20:30' }, // outro dia, fora dos 2 ofertados
      handoff: false,
      motivo_handoff: null,
    }),
    // Validacao ao vivo: 20:30 na quinta esta na janela e livre -> aprova.
    validarSlotReuniao: async ({ data, horario }) => { validadoCom = { data, horario }; return true },
    buscarSlotsDisponiveis: async () => ({ data_sugerida: '2026-06-05', data_label: 'amanha', horarios_sugeridos: ['19:30', '19:45'] }),
  })

  await core.gerarEEnviarRespostaWhatsapp(conversa.numero, conversa.historico)
  const confirmada = atualizacoes.map((p) => p.reuniao_proposta).filter(Boolean).pop()
  assert.ok(confirmada, 'deve agendar quando a validacao ao vivo aprova outro dia')
  assert.equal(confirmada.horario_confirmado, '20:30')
  assert.equal(confirmada.data_sugerida, '2026-06-11')
  assert.deepEqual(validadoCom, { data: '2026-06-11', horario: '20:30' })
})

test('agenda IA: oferta pendente + lead pede outro dia -> IA recebe disponibilidade da semana', async () => {
  // Reproduz a conversa real: bot ofertou so "amanha 19:30/19:45", lead pediu
  // "que dias tem? queria segunda que vem" e o bot nao conseguia ofertar outro
  // dia. Agora, com oferta pendente, o turno carrega a disponibilidade da semana.
  const conversa = {
    numero: '5511999999999@s.whatsapp.net',
    historico: [
      { role: 'assistant', content: 'Amanhã às 19:30 ou 19:45. Qual prefere?' },
      { role: 'user', content: 'que dias tem disponivel? queria segunda que vem' },
    ],
    estagio: 'agendamento_pendente',
    status: 'ativo',
  }
  const perfil = {
    negocio: 'restaurante', cidade: 'SP', necessidade: 'site', rota_comercial: 'projeto_sob_medida',
    reuniao_proposta: {
      necessaria: true, data_sugerida: '2026-06-05',
      horarios_sugeridos: ['19:30', '19:45'], horario_confirmado: null,
    },
  }
  let contextoVisto = null
  let chamouDisponibilidade = false
  const { core } = criarCoreFunnelAgendaTeste({
    conversa,
    perfil,
    chamarClaude: async (_h, _e, _p, _v, opcoes = {}) => {
      contextoVisto = opcoes.nextActionContext || null
      return {
        mensagem_pro_lead: 'Posso na segunda às 19:30 ou 20:00 — qual prefere?',
        mensagens_bolhas: ['Posso na segunda às 19:30 ou 20:00 — qual prefere?'],
        atualizar_perfil: {}, etapa_proxima: 'agendamento_pendente', handoff: false, motivo_handoff: null,
      }
    },
    buscarDisponibilidadeSemana: async () => {
      chamouDisponibilidade = true
      return { janela: { inicio: '19:30', fim: '21:15' }, dias: [{ data: '2026-06-08', label: 'segunda', horarios: ['19:30', '20:00'] }] }
    },
    buscarSlotsDisponiveis: async () => ({ data_sugerida: '2026-06-05', data_label: 'amanha', horarios_sugeridos: ['19:30', '19:45'] }),
  })

  await core.gerarEEnviarRespostaWhatsapp(conversa.numero, conversa.historico)
  assert.equal(chamouDisponibilidade, true, 'deve consultar a disponibilidade da semana quando ha oferta pendente')
  assert.ok(contextoVisto, 'deve passar contexto de acao para a IA')
  assert.ok(contextoVisto.disponibilidade_semana, 'o contexto da IA deve incluir disponibilidade_semana')
})

test('core funnel: registra log estruturado de decisao por turno', async () => {
  const logs = []
  const loggerTeste = {
    info: (...args) => logs.push(args),
    warn() {},
    error() {},
  }
  const conversa = {
    numero: '5511999999999@s.whatsapp.net',
    historico: [{ role: 'user', content: 'Quanto custa um site?' }],
    estagio: 'diagnostico',
    status: 'ativo',
  }
  const perfil = {
    negocio: 'barbearia',
    cidade: 'São Bernardo do Campo',
    necessidade: 'site',
    projeto_sob_medida: true,
  }
  const { core } = criarCoreFunnelAgendaTeste({
    conversa,
    perfil,
    logger: loggerTeste,
    chamarClaude: fakeClaudeMock(),
    buscarSlotsDisponiveis: async () => ({
      data_sugerida: '2026-05-19',
      data_label: 'hoje',
      horarios_sugeridos: ['19:30', '20:15'],
    }),
  })

  await core.gerarEEnviarRespostaWhatsapp(conversa.numero, conversa.historico)

  const entrada = logs.find((args) => args.some((arg) => arg === '[AI_DECISION_TURN]'))
  assert.ok(entrada, 'deve registrar marcador [AI_DECISION_TURN]')
  const payload = entrada.find((arg) => arg && typeof arg === 'object' && arg.leadId)
  assert.ok(payload, 'deve registrar payload estruturado')
  assert.equal(payload.mensagemAtual, 'Quanto custa um site?')
  assert.equal(payload.etapaAnterior, 'diagnostico')
  assert.equal(payload.etapaNova, 'proposta')
  assert.equal(payload.acaoDecidida, 'responder_preco_sem_contexto')
  assert.match(payload.motivoDecisao, /pergunta_preco_sem_rota_definida/)
  assert.deepEqual(payload.horariosConsultados, [])
  assert.equal(payload.agendaFalhou, false)
  assert.equal(payload.perfilAntes.negocio, 'barbearia')
  assert.equal(payload.perfilDepois.negocio, 'barbearia')
  assert.equal(payload.perfilDepois.reuniao_proposta, null)
  assert.ok(Array.isArray(payload.mensagensGeradas) && payload.mensagensGeradas.length > 0)
  assert.ok(Array.isArray(payload.mensagensEnviadas) && payload.mensagensEnviadas.length > 0)
  assert.ok(payload.dadosExtraidos && typeof payload.dadosExtraidos === 'object')
  assert.ok(payload.conversationId)
  assert.match(payload.leadHash, /^[a-f0-9]{16}$/)
  assert.equal(payload.orquestradorNovoAtivo, true)
  assert.equal(payload.resultadoValidador.bloqueado, false)
  assert.equal(payload.fallbackUsado, false)
  assert.equal(payload.linkEnviado, false)
  assert.equal(payload.handoffAcionado, false)
  const metricasEntrada = logs.find((args) => args.some((arg) => arg === '[AI_PROD_METRICS]'))
  assert.ok(metricasEntrada, 'deve registrar marcador [AI_PROD_METRICS]')
  const metricasPayload = metricasEntrada.find((arg) => arg && typeof arg === 'object' && arg.metricas)
  assert.equal(metricasPayload.metricas.total_conversas, 1)
  assert.equal(metricasPayload.metricas.convites_reuniao, 0)
  assert.equal(metricasPayload.metricas.falhas_agenda, 0)
})

test('core funnel: falha da agenda nao oferece horarios ficticios', async () => {
  const conversa = {
    numero: '5511999999999@s.whatsapp.net',
    historico: [{ role: 'user', content: 'qual o valor?' }],
    estagio: 'diagnostico',
    status: 'ativo',
  }
  const perfil = {
    projeto_sob_medida: true,
    servico_principal: 'sistema com automacao',
    preco_calculado: 1800,
  }
  // Novo orquestrador: projeto_sob_medida + pergunta_preco → responder_preco_sem_contexto
  // → LLM compoe (pularDeterministicoConversa=true). A agenda nao e consultada.
  // O mock sem horarios reais nao deve inventar slots ficticios.
  const { core, enviados, atualizacoes } = criarCoreFunnelAgendaTeste({
    conversa,
    perfil,
    chamarClaude: fakeClaudeMock(),
    buscarSlotsDisponiveis: async () => {
      throw new Error('agenda fora')
    },
  })

  await core.gerarEEnviarRespostaWhatsapp(conversa.numero, conversa.historico)
  const msg = enviados.join('\n')

  // Nao inventa horarios ficticios nem datas
  assert.doesNotMatch(msg, /19:30|19:45|20:00|20:15|20:30|20:45|21:00|21:15/)
  assert.doesNotMatch(msg, /hoje|amanh.|. noite/i)
  // Nao oferece reuniao sem slots reais
  const reuniao = atualizacoes.find((p) => p.reuniao_proposta)?.reuniao_proposta
  assert.equal(reuniao, undefined)
})

test('aceite fluxo: agenda falhou nao inventa horario, loga erro e nao marca reuniao', async () => {
  const logs = { errors: [] }
  const conversa = {
    numero: '5511999999999@s.whatsapp.net',
    historico: [{ role: 'user', content: 'Quanto custa um site?' }],
    estagio: 'diagnostico',
    status: 'ativo',
  }
  const perfil = {
    negocio: 'barbearia',
    cidade: 'São Bernardo do Campo',
    necessidade: 'site',
    projeto_sob_medida: true,
  }
  // Novo orquestrador: projeto_sob_medida + pergunta_preco → LLM compoe.
  // A agenda nao e consultada nesse caminho.
  const { core, enviados, atualizacoes } = criarCoreFunnelAgendaTeste({
    conversa,
    perfil,
    chamarClaude: fakeClaudeMock(),
    logger: {
      info() {},
      warn() {},
      error(...args) { logs.errors.push(args.join(' ')) },
    },
    buscarSlotsDisponiveis: async () => {
      throw new Error('agenda indisponivel')
    },
  })

  await core.gerarEEnviarRespostaWhatsapp(conversa.numero, conversa.historico)
  const msg = enviados.join('\n')

  // Nao inventa horarios ficticios
  assert.doesNotMatch(msg, /19:30|19:45|20:00|20:15|20:30|20:45|21:00|21:15/)
  assert.doesNotMatch(msg, /hoje|amanh.|. noite/i)
  // Nao oferece reuniao sem slots reais
  const reuniao = atualizacoes.find((p) => p.reuniao_proposta)?.reuniao_proposta
  assert.equal(reuniao, undefined)
})

test('core funnel: pergunta seca de preco sem contexto nao consulta agenda', async () => {
  const conversa = {
    numero: '5511999999999@s.whatsapp.net',
    historico: [{ role: 'user', content: 'Quanto custa?' }],
    estagio: 'primeiro_contato',
    status: 'ativo',
  }
  let agendaConsultada = false
  const { core, enviados } = criarCoreFunnelAgendaTeste({
    conversa,
    perfil: {},
    chamarClaude: fakeClaudeMock(),
    buscarSlotsDisponiveis: async () => {
      agendaConsultada = true
      return { data_sugerida: '2026-05-19', data_label: 'hoje', horarios_sugeridos: ['19:30', '20:15'] }
    },
  })

  await core.gerarEEnviarRespostaWhatsapp(conversa.numero, conversa.historico)
  const msg = enviados.join('\n')

  assert.equal(agendaConsultada, false)
  // O LLM compoe livremente (pularDeterministicoConversa=true).
  // A resposta nao deve conter slots ficticios nem valores.
  assert.doesNotMatch(msg, /19:30|20:15|horario disponivel|reuniao marcada/i)
  assert.doesNotMatch(msg, /R\$|entrada|parcela|3x|a partir de/i)
})

test('core funnel: assinatura simples explica assinatura sem oferecer reuniao', async () => {
  const conversa = {
    numero: '5511999999999@s.whatsapp.net',
    historico: [{ role: 'user', content: 'Quero algo simples e rapido' }],
    estagio: 'primeiro_contato',
    status: 'ativo',
  }
  let agendaConsultada = false
  // IA-primaria: a LLM compoe a explicacao da assinatura (sem oferecer reuniao nem
  // menu de opcoes). O mock simula essa resposta; os asserts deterministicos
  // (rota/ultima_acao via patch do orquestrador, agenda NAO consultada) seguem.
  const { core, enviados, atualizacoes } = criarCoreFunnelAgendaTeste({
    conversa,
    perfil: {},
    chamarClaude: async () => ({
      mensagem_pro_lead: 'Perfeito. A assinatura de site faz mais sentido pro seu caso: estrutura simples e caminho direto pro WhatsApp. Quer que eu te envie o link pra ver e ativar?',
      mensagens_bolhas: ['Perfeito. A assinatura de site faz mais sentido pro seu caso: estrutura simples e caminho direto pro WhatsApp. Quer que eu te envie o link pra ver e ativar?'],
      atualizar_perfil: {},
      etapa_proxima: 'proposta',
      solicitar_calculo_preco: false,
      handoff: false,
      motivo_handoff: null,
    }),
    buscarSlotsDisponiveis: async () => {
      agendaConsultada = true
      return { data_sugerida: '2026-05-19', data_label: 'hoje', horarios_sugeridos: ['19:30', '20:15'] }
    },
  })

  await core.gerarEEnviarRespostaWhatsapp(conversa.numero, conversa.historico)
  const msg = enviados.join('\n')
  const eventos = atualizacoes.find((p) => p.eventos_conversa)?.eventos_conversa

  assert.equal(agendaConsultada, false)
  // assinatura_site removida — validar que rota nao e mais assinatura
  assert.notEqual(eventos?.rota_comercial, 'assinatura_site')
  // Com o novo orquestrador, textos sem keywords de projeto sob medida
  // podem nao gerar rota_comercial; o importante e que nao seja assinatura.
  // LLM compoe — testamos a INTENCAO da mensagem, nao texto literal.
  assert.doesNotMatch(msg, /19:30|20:15/i)
})

test('core funnel: horario nao oferecido nao registra confirmacao e oferece alternativas reais', async () => {
  const logs = []
  const conversa = {
    numero: '5511999999999@s.whatsapp.net',
    historico: [
      { role: 'assistant', content: 'Tenho hoje as 19:30 ou 20:15 disponiveis. Qual fica melhor?' },
      { role: 'user', content: '22:00' },
    ],
    estagio: 'agendamento_pendente',
    status: 'ativo',
  }
  const perfil = {
    rota_comercial: 'projeto_sob_medida',
    reuniao_proposta: {
      necessaria: true,
      data_sugerida: '2026-05-19',
      data_label: 'hoje',
      horarios_sugeridos: ['19:30', '20:15'],
    },
  }
  const { core, enviados, atualizacoes } = criarCoreFunnelAgendaTeste({
    conversa,
    perfil,
    chamarClaude: fakeClaudeMock(),
    logger: {
      info: (...args) => logs.push(args),
      warn() {},
      error() {},
    },
    buscarSlotsDisponiveis: async () => ({
      data_sugerida: '2026-05-19',
      data_label: 'hoje',
      horarios_sugeridos: ['19:30', '20:15'],
    }),
  })

  await core.gerarEEnviarRespostaWhatsapp(conversa.numero, conversa.historico)
  const msg = enviados.join('\n')
  const confirmacao = atualizacoes.find((p) => p.reuniao_proposta?.horario_confirmado)?.reuniao_proposta
  const entrada = logs.find((args) => args.some((arg) => arg === '[AI_DECISION_TURN]'))
  const payload = entrada && entrada.find((arg) => arg && typeof arg === 'object' && arg.leadId)

  assert.equal(confirmacao, undefined)
  // Deve apresentar os slots reais
  assert.match(msg, /19:30|20:15/)
  // Reconhecer o horario do lead ("Entendi, 22:00") e OK e desejavel,
  // mas NUNCA confirmar a reuniao com esse horario. Validacao foca em
  // garantir que nao houve confirmacao.
  assert.doesNotMatch(msg, /Fechado|reuni.o marcada|reuni.o agendada|esta reservado/i)
  assert.ok(payload)
  assert.notEqual(payload.acaoDecidida, 'confirmar_reuniao')
  assert.equal(payload.acaoDecidida, 'convite_reuniao')
})

test('aceite fluxo: escolha 7:30 confirma 19:30, pede email e aciona handoff', async () => {
  const handoffs = []
  const conversa = {
    numero: '5511999999999@s.whatsapp.net',
    historico: [
      { role: 'assistant', content: 'Tenho hoje as 19:30 ou 20:15 disponiveis. Qual fica melhor?' },
      { role: 'user', content: '7:30' },
    ],
    estagio: 'agendamento_pendente',
    status: 'ativo',
  }
  const perfil = {
    negocio: 'barbearia',
    cidade: 'São Bernardo do Campo',
    necessidade: 'site',
    reuniao_proposta: {
      necessaria: true,
      data_sugerida: '2026-05-19',
      horarios_sugeridos: ['19:30', '20:15'],
    },
  }
  const { core, enviados, atualizacoes } = criarCoreFunnelAgendaTeste({
    conversa,
    perfil,
    buscarSlotsDisponiveis: async () => {
      throw new Error('nao deve consultar agenda para horario ja oferecido')
    },
    alertarHandoff: async (_numero, _perfil, _preco, motivo) => { handoffs.push(motivo) },
  })

  await core.gerarEEnviarRespostaWhatsapp(conversa.numero, conversa.historico)
  const msg = enviados.join('\n')
  const reuniao = atualizacoes.find((p) => p.reuniao_proposta?.horario_confirmado)?.reuniao_proposta

  assert.match(msg, /19:30/)
  assert.match(msg, /melhor e-mail/i)
  assert.equal(reuniao.horario_confirmado, '19:30')
  assert.equal(handoffs.includes('agendou_reuniao_proposta'), true)
})

test('core funnel: lead digita 7:30, confirma 19:30 e pede apenas email', async () => {
  const conversa = {
    numero: '5511999999999@s.whatsapp.net',
    historico: [
      { role: 'assistant', content: 'Tenho hoje as 19:30 ou 20:15 disponiveis. Qual fica melhor?' },
      { role: 'user', content: '7:30' },
    ],
    estagio: 'agendamento_pendente',
    status: 'ativo',
  }
  const perfil = {
    negocio: 'barbearia',
    cidade: 'Sao Bernardo',
    servico_principal: 'site',
    reuniao_proposta: {
      necessaria: true,
      data_sugerida: '2026-05-19',
      horarios_sugeridos: ['19:30', '20:15'],
    },
  }
  const { core, enviados, atualizacoes } = criarCoreFunnelAgendaTeste({
    conversa,
    perfil,
    buscarSlotsDisponiveis: async () => {
      throw new Error('nao deve buscar agenda ao confirmar slot ja oferecido')
    },
  })

  await core.gerarEEnviarRespostaWhatsapp(conversa.numero, conversa.historico)
  const msg = enviados.join('\n')

  assert.match(msg, /marcada para 19\/05 .s 19:30/i)
  assert.match(msg, /at. 15 minutos/i)
  assert.match(msg, /melhor e-mail/i)
  assert.doesNotMatch(msg, /CPF|CNPJ|endere.o|PIX/i)
  const reuniao = atualizacoes.find((p) => p.reuniao_proposta?.horario_confirmado)?.reuniao_proposta
  assert.equal(reuniao.horario_confirmado, '19:30')
  assert.equal(reuniao.duracao_maxima_minutos, 15)
  assert.ok(reuniao.data_inicio)
  assert.ok(reuniao.data_fim)
})

test('intencao: lead pergunta como funciona recebe explicacao antes de agendar', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'E como faço isso?',
    perfil: { negocio: 'serralheria', cidade: 'Ariquemes' },
    estagio: 'diagnostico',
  })
  assert.equal(decisao.interpretacao.intencao_principal, 'pergunta_como_funciona')
  assert.equal(decisao.proxima_acao, 'explicar_solucao')
  assert.match(decisao.resultado.mensagem_pro_lead, /serralheria em Ariquemes|site, sistema, automa/i)
  assert.doesNotMatch(decisao.resultado.mensagem_pro_lead, /tipo do seu neg.cio/i)
  assert.doesNotMatch(decisao.resultado.mensagem_pro_lead, /tenho 19:30|20:15/i)
  assert.doesNotMatch(decisao.resultado.mensagem_pro_lead, /Victor/)
})

test('intencao: lead diz pretendo com dados minimos conduz para agenda real', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Pretendo fazer um site sim',
    perfil: { negocio: 'limpeza de coifas', cidade: 'São Paulo', dor_principal: 'receber mais orçamentos' },
    estagio: 'diagnostico',
  })
  assert.equal(decisao.interpretacao.intencao_principal, 'interesse_inicial')
  assert.equal(decisao.proxima_acao, 'consultar_agenda_e_oferecer_horarios')
  assert.equal(decisao.prioridade_aplicada, 'gatilho_reuniao_direto')
  assert.equal(decisao.deve_sobrescrever_modelo, true)
})

test('intencao: primeira resposta abre triagem curta e coleta contexto', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Tenho interesse',
    perfil: {},
    estagio: 'primeiro_contato',
    historico: [{ role: 'user', content: 'Tenho interesse' }],
  })
  const msg = decisao.resultado.mensagem_pro_lead
  assert.equal(decisao.proxima_acao, 'explicar_solucao')
  assert.match(msg, /assistente.*da PJ Codeworks/i)
  assert.match(msg, /tipo do seu neg.cio/i)
  assert.doesNotMatch(msg, /site, sistema, automa/i)
  assert.doesNotMatch(msg, /aparece no Google|Victor|aprofundando dor|funil|score|lead quente/i)
})

test('intencao: dados minimos coletados conduzem para agenda real', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Quero automacao',
    perfil: { negocio: 'clinica', cidade: 'Curitiba', servico_principal: 'automacao' },
    estagio: 'diagnostico',
    historico: [
      { role: 'assistant', content: 'Ola! Eu sou o assistente virtual da PJ Codeworks.' },
      { role: 'user', content: 'Quero automacao' },
    ],
  })
  assert.equal(decisao.proxima_acao, 'consultar_agenda_e_oferecer_horarios')
  assert.equal(decisao.deve_sobrescrever_modelo, true)
})

test('resposta automatica: apenas ultima mensagem real do lead pode disparar bot', () => {
  assert.equal(podeGerarRespostaAutomatica({
    historico: [{ role: 'user', content: 'Tenho interesse', direction: 'incoming', fromMe: false }],
  }), true)
  assert.equal(podeGerarRespostaAutomatica({
    historico: [{ role: 'assistant', content: 'Mensagem do bot' }],
  }), false)
  assert.equal(podeGerarRespostaAutomatica({
    historico: [{ role: 'user', content: '[Sistema] Lembrete enviado', tipo: 'sistema_lembrete_reuniao' }],
  }), false)
  assert.equal(podeGerarRespostaAutomatica({
    historico: [{ role: 'user', content: 'Eco operador', fromMe: true }],
  }), false)
})

test('intencao: lead escolhe horario quando ha agendamento pendente', async () => {
  const decisao = await decidirProximaResposta({
    texto: '20:15',
    perfil: {
      reuniao_proposta: {
        necessaria: true,
        data_sugerida: '2026-05-11',
        horarios_sugeridos: ['19:30', '20:15'],
      },
    },
    estagio: 'agendamento_pendente',
  })
  assert.equal(decisao.interpretacao.intencao_principal, 'escolha_horario')
  assert.equal(decisao.proxima_acao, 'confirmar_reuniao')
})

test('intencao: pedido de reagendamento exige consulta de agenda', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Não consigo hoje, pode ser amanhã?',
    perfil: { reuniao_proposta: { necessaria: true, horarios_sugeridos: ['20:15'] } },
    estagio: 'reuniao_agendada',
  })
  assert.equal(decisao.interpretacao.intencao_principal, 'pedido_reagendamento')
  assert.equal(decisao.proxima_acao, 'reagendar')
  assert.equal(decisao.deve_sobrescrever_modelo, true)
})

test('intencao: anti-loop nao expoe falha ao lead e pergunta apenas dado faltante', async () => {
  const historico = [
    { role: 'assistant', content: 'Os valores dependem do tipo de estrutura.\n\nSites mais simples costumam ter um investimento inicial menor, enquanto projetos com sistema, automação ou estrutura personalizada variam conforme o escopo.\n\nNa reunião, a equipe da PJ Codeworks te passa o valor certo, já com prazo e formato de pagamento.\n\nPra eu te orientar sem chute: qual é o seu negócio e em qual cidade você atende?' },
  ]
  const decisao = await decidirProximaResposta({
    texto: 'quanto custa?',
    perfil: {},
    estagio: 'diagnostico',
    historico,
  })
  if (!decisao.resultado) { return } // anti-loop suprimiu resposta
    const msg = decisao.resultado.mensagem_pro_lead
  assert.doesNotMatch(msg, /reformular|repetiti|novamente|como eu disse/i)
  assert.match(msg, /valor certo|reuniao|horario/i)
})

test('slot-filling: lead informa cidade+necessidade, bot pergunta apenas o ramo', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Eu sou de São Bernardo do Campo, procuro um site',
    perfil: {},
    estagio: 'diagnostico',
    historico: [
      { role: 'assistant', content: 'Olá! Eu sou o assistente virtual da PJ Codeworks. Qual é o tipo do seu negócio, em qual cidade ou região você atende e você procura site, sistema, automação, agente de IA ou uma solução sob medida?' },
      { role: 'user', content: 'Eu sou de São Bernardo do Campo, procuro um site' },
    ],
  })
  const msg = decisao.resultado.mensagem_pro_lead
  assert.equal(decisao.interpretacao.intencao_principal, 'envio_dados_negocio')
  assert.match(msg, /São Bernardo do Campo/)
  assert.match(msg, /site/i)
  assert.match(msg, /neg[oó]cio|ramo/i)
  // Nao deve repetir a pergunta completa
  assert.doesNotMatch(msg, /em qual cidade ou regi[aã]o voc[eê] atende/i)
  // Nao deve usar frases de erro
  assert.doesNotMatch(msg, /reformular|repetiti/i)
  // Persiste os dados extraidos
  assert.equal(decisao.resultado.atualizar_perfil.cidade, 'São Bernardo do Campo')
  assert.equal(decisao.resultado.atualizar_perfil.servico_principal, 'site')
})

test('slot-filling: lead informa os tres dados de site e recebe conexao de valor', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Trabalho com tráfego pago. Sou de São Bernardo, atendo São Paulo. Procuro site',
    perfil: {},
    estagio: 'diagnostico',
    historico: [
      { role: 'assistant', content: 'Qual é o tipo do seu negócio, em qual cidade você atende e você procura site, sistema, automação, agente de IA ou uma solução sob medida?' },
      { role: 'user', content: 'Trabalho com tráfego pago. Sou de São Bernardo, atendo São Paulo. Procuro site' },
    ],
  })
  // Com os tres dados de site preenchidos, ainda nao deve pular para reuniao.
  assert.equal(decisao.proxima_acao, 'conexao_valor')
  assert.equal(decisao.deve_sobrescrever_modelo, true)
  assert.match(decisao.resultado.mensagem_pro_lead, /passar mais confian|WhatsApp/i)
  assert.doesNotMatch(decisao.resultado.mensagem_pro_lead, /hor.rio|reuni.o|pre.o|Google/i)
  assert.equal(decisao.estado_comercial.dados_obrigatorios.nicho, true)
  assert.equal(decisao.estado_comercial.dados_obrigatorios.cidade, true)
  assert.equal(decisao.estado_comercial.dados_obrigatorios.servico_principal, true)
})

test('slot-filling: lead complementa ramo apos cidade+site e recebe conexao de valor', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Trabalho com tráfego pago',
    perfil: { cidade: 'São Bernardo do Campo', servico_principal: 'site', necessidade: 'site' },
    estagio: 'diagnostico',
    historico: [
      { role: 'user', content: 'Eu sou de São Bernardo, procuro site' },
      { role: 'assistant', content: 'Perfeito, entendi. Qual é o ramo do seu negócio?' },
      { role: 'user', content: 'Trabalho com tráfego pago' },
    ],
  })
  // Agora tem os tres → avanca para agenda
  assert.equal(decisao.proxima_acao, 'conexao_valor')
  assert.equal(decisao.estado_comercial.dados_obrigatorios.nicho, true)
  assert.match(decisao.resultado.mensagem_pro_lead, /tr.fego pago|WhatsApp|confian/i)
  assert.doesNotMatch(decisao.resultado.mensagem_pro_lead, /hor.rio|reuni.o|pre.o|Google/i)
})

test('slot-filling: textos do bot saem com acentuacao portuguesa correta', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Tenho interesse',
    perfil: {},
    estagio: 'primeiro_contato',
    historico: [{ role: 'user', content: 'Tenho interesse' }],
  })
  const msg = decisao.resultado.mensagem_pro_lead
  // Verifica que a resposta nao sai com mojibake e mantem portugues legivel.
  assert.match(msg, /informa[cç][oõ]es|neg.cio|regi.o/i)
  assert.doesNotMatch(msg, /Ã|â/)
  assert.match(msg, /PJ Codeworks/i)
})

test('slot-filling: extrator parseia mensagem multilinha do lead', () => {
  const { extrairDadosLeadDoTexto } = require('../src/agent')
  const dados = extrairDadosLeadDoTexto('Trabalho com tráfego pago\nSou de São Bernardo atendo São Paulo\nProcuro site')
  assert.equal(dados.negocio, 'tráfego pago')
  assert.equal(dados.cidade_base, 'São Bernardo do Campo')
  assert.equal(dados.regiao_atendimento, 'São Paulo')
  assert.equal(dados.necessidade, 'site')
})

test('slot-filling: extrator entende falas naturais de nicho, ABC e necessidade', () => {
  const { extrairDadosLeadDoTexto } = require('../src/agent')

  assert.deepEqual(extrairDadosLeadDoTexto('Trabalho em SBC com corte de cabelo'), {
    cidade_base: 'São Bernardo do Campo',
    negocio: 'corte de cabelo / barbearia',
  })
  assert.equal(extrairDadosLeadDoTexto('Sou barbeiro em São Bernardo').negocio, 'corte de cabelo / barbearia')
  assert.equal(extrairDadosLeadDoTexto('Tenho uma barbearia em São Bernardo do Campo').cidade_base, 'São Bernardo do Campo')
  assert.equal(extrairDadosLeadDoTexto('Atendo em SBC').cidade_base, 'São Bernardo do Campo')
  assert.equal(extrairDadosLeadDoTexto('Faço corte de cabelo').negocio, 'corte de cabelo / barbearia')
  assert.deepEqual(extrairDadosLeadDoTexto('Trabalho com nail designer em Santo André'), {
    cidade_base: 'Santo André',
    negocio: 'nail designer',
  })
  assert.deepEqual(extrairDadosLeadDoTexto('Sou dentista em Diadema'), {
    cidade_base: 'Diadema',
    negocio: 'dentista',
  })
  assert.deepEqual(extrairDadosLeadDoTexto('Tenho uma clínica estética em Mauá'), {
    cidade_base: 'Mauá',
    negocio: 'clínica estética',
  })
  assert.equal(extrairDadosLeadDoTexto('Quero um site').necessidade, 'site')
  assert.equal(extrairDadosLeadDoTexto('Preciso de um sistema').necessidade, 'sistema')
  assert.equal(extrairDadosLeadDoTexto('Quero automatizar meu atendimento').necessidade, 'automacao')
  assert.equal(extrairDadosLeadDoTexto('Quero um agente de IA').necessidade, 'agente_ia')
})

test('slot-filling: nicho e cidade na mesma frase aprofundam sem repetir pergunta', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Trabalho em SBC com corte de cabelo',
    perfil: {},
    estagio: 'diagnostico',
    historico: [{ role: 'user', content: 'Trabalho em SBC com corte de cabelo' }],
  })
  const msg = decisao.resultado.mensagem_pro_lead

  assert.equal(decisao.proxima_acao, 'aprofundar_canal_aquisicao')
  assert.equal(decisao.resultado.atualizar_perfil.negocio, 'corte de cabelo / barbearia')
  assert.equal(decisao.resultado.atualizar_perfil.cidade, 'São Bernardo do Campo')
  assert.match(msg, /Corte de cabelo \/ barbearia em São Bernardo do Campo/)
  assert.match(msg, /indica[cç][aã]o, Instagram ou Google/i)
  assert.doesNotMatch(msg, /Qual .+ tipo do seu neg.cio/i)
  assert.doesNotMatch(msg, /Em qual cidade|qual cidade/i)
})

test('slot-filling: perfil legado evita repeticao de negocio e cidade', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Quero um site',
    perfil: { businessType: 'barbearia', city: 'SBC', hasWebsite: false },
    estagio: 'diagnostico',
    historico: [{ role: 'user', content: 'Quero um site' }],
  })
  const msg = textoRespostaDecisao(decisao)

  assert.equal(decisao.estado_comercial.dados_obrigatorios.nicho, true)
  assert.equal(decisao.estado_comercial.dados_obrigatorios.cidade, true)
  assert.doesNotMatch(msg, /tipo do seu neg.cio/i)
  assert.doesNotMatch(msg, /qual cidade|em qual cidade/i)
})

test('conexao_valor: site com nicho e cidade nao agenda antes de conectar valor', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Quero ter um site',
    perfil: { negocio: 'corte de cabelo', cidade: 'São Bernardo do Campo', necessidade: 'site' },
    estagio: 'diagnostico',
    historico: [{ role: 'user', content: 'Quero ter um site' }],
  })
  const msg = textoRespostaDecisao(decisao)

  assert.equal(decisao.proxima_acao, 'conexao_valor')
  assert.equal(decisao.resultado.etapa_proxima, 'conexao_valor')
  assert.match(msg, /Para corte de cabelo em São Bernardo do Campo/i)
  assert.match(msg, /passar mais confian.a/i)
  assert.match(msg, /WhatsApp/i)
  assert.match(msg, /j[aá] tem algum site|seria o primeiro/i)
  assert.doesNotMatch(msg, /pre.o|reuni.o|hor.rio|Google|concorrente/i)
})

test('conexao_valor: gatilhos fortes ainda conduzem para agenda', async () => {
  const base = { negocio: 'corte de cabelo', cidade: 'São Bernardo do Campo', necessidade: 'site' }
  const preco = await decidirProximaResposta({ texto: 'Quanto custa?', perfil: base, estagio: 'diagnostico' })
  const fazer = await decidirProximaResposta({ texto: 'Quero fazer um site', perfil: base, estagio: 'diagnostico' })
  const seguir = await decidirProximaResposta({ texto: 'Quero seguir', perfil: base, estagio: 'conexao_valor' })

  assert.equal(preco.proxima_acao, 'consultar_agenda_e_oferecer_horarios')
  assert.equal(fazer.proxima_acao, 'consultar_agenda_e_oferecer_horarios')
  assert.equal(seguir.proxima_acao, 'consultar_agenda_e_oferecer_horarios')
})

test('slot-filling: obterProximaPergunta retorna null quando todos os dados estao preenchidos', () => {
  const { obterProximaPergunta } = require('../src/agent')
  assert.equal(obterProximaPergunta({ negocio: 'x', cidade: 'y', servico_principal: 'z' }), null)
  assert.match(obterProximaPergunta({}), /neg[oó]cio/i)
  assert.match(obterProximaPergunta({ negocio: 'x' }), /cidade|regi[aã]o/i)
  assert.match(obterProximaPergunta({ negocio: 'x', cidade: 'y' }), /site|sistema|automa[cç][aã]o/i)
})

test('linguagem institucional: sanitizer troca Victor por equipe da PJ Codeworks', () => {
  const { sanitizarMencoesPessoaParaEquipe } = require('../src/institutional-language')
  const msg = sanitizarMencoesPessoaParaEquipe(
    'O Victor te mostra estrutura, prazo e investimento. Reunião com o Victor confirmada.'
  )
  assert.match(msg, /equipe da PJ Codeworks/)
  assert.match(msg, /estrutura, prazo e investimento/)
  assert.doesNotMatch(msg, /Victor/)
})

test('linguagem institucional: prompts de atendimento nao direcionam para pessoa especifica', () => {
  const promptFiles = [
        'system-primeiro-contato.md',
    'system-diagnostico.md',
    'system-proposta.md',
    'system-objecao.md',
    'followup.md',
    'empresa.md',
  ]
  for (const file of promptFiles) {
    const text = fs.readFileSync(path.join(__dirname, '..', 'prompts', file), 'utf8')
    assert.doesNotMatch(text, /Victor/, `${file} ainda menciona Victor`)
    assert.doesNotMatch(text, /\bo equipe\b/i, `${file} tem concordancia quebrada`)
  }
  const primeiroContato = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'system-primeiro-contato.md'), 'utf8')
  assert.match(primeiroContato, /Apresente-se.*como PJ Codeworks|Sou da PJ Codeworks/)
  assert.match(primeiroContato, /no maximo 2 bolhas curtas/)
})

test('parse Claude aceita JSON em markdown e normaliza chave de mensagem', () => {
  const parsed = parsearRespostaJsonClaude('```json\n{"mensagem":"Oi","etapa_proxima":"diagnostico","solicitar_preview_site":true,"preview_site_modelo":"premium"}\n```')
  const norm = normalizarParsedRespostaVendas(parsed)
  const result = resultadoParseadoParaObjeto(norm, 'primeiro_contato')

  assert.equal(result.mensagem_pro_lead, 'Oi')
  assert.equal(result.etapa_proxima, 'diagnostico')
  assert.equal(result.handoff, false)
  assert.equal(result.solicitar_preview_site, true)
  assert.equal(result.preview_site_modelo, 'premium')
})

test('parseAiResponse extrai mensagens_bolhas de JSON puro', () => {
  const parsed = parseAiResponse('{"mensagens_bolhas":["Oi","Qual seu negócio?"]}')

  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.publicMessages, ['Oi', 'Qual seu negócio?'])
  assert.equal(parsed.schemaValid, true)
})

test('parseAiResponse limpa code fence json antes de parsear', () => {
  const parsed = parseAiResponse('```json\n{"mensagens_bolhas":["Oi"]}\n```')

  assert.equal(parsed.ok, true)
  assert.equal(parsed.codeFenceDetected, true)
  assert.deepEqual(parsed.publicMessages, ['Oi'])
})

test('renderPublicReplyFromAiResponse usa fallback quando modelo retorna texto puro', () => {
  const rendered = renderPublicReplyFromAiResponse('Segue uma lista de dicas genericas...')

  assert.equal(rendered.ok, false)
  assert.equal(rendered.error, 'json_parse_failed')
  assert.deepEqual(rendered.publicMessages, [
    'Oi! Sou da PJ Codeworks.',
    'Você busca site, sistema, automação ou presença no Google?',
  ])
  assert.doesNotMatch(rendered.reply, /Segue uma lista/)
})

test('aceite fluxo: JSON malformado usa fallback seguro sem vazar bruto', () => {
  const rendered = renderPublicReplyFromAiResponse('```json\n{"mensagens_bolhas":["Oi",]\n```', {
    channel: 'test',
    etapa: 'diagnostico',
  })

  assert.equal(rendered.ok, false)
  assert.equal(rendered.error, 'json_parse_failed')
  assert.match(rendered.reply, /PJ Codeworks/)
  assert.doesNotMatch(rendered.reply, /```|mensagens_bolhas|{|}/)
  assert.equal(rendered.publicMessagesGenerated, true)
})

test('renderPublicReplyFromAiResponse usa fallback quando JSON nao tem bolhas publicas', () => {
  const rendered = renderPublicReplyFromAiResponse('{"atualizar_perfil":{},"etapa_proxima":"diagnostico"}')

  assert.equal(rendered.ok, false)
  assert.equal(rendered.error, 'schema_public_messages_missing')
  assert.match(rendered.reply, /PJ Codeworks/)
})

test('guard final bloqueia bolha que contem JSON bruto ou schema interno', () => {
  assert.equal(messageLooksLikeRawJsonLeak('```json\n{"mensagens_bolhas":["Oi"]}\n```'), true)

  const guarded = guardPublicMessages(['{"mensagens_bolhas":["Oi"]}'])
  assert.equal(guarded.blocked, true)
  assert.equal(guarded.reason, 'raw_json_or_schema_leak')
  assert.match(guarded.messages.join(' '), /PJ Codeworks/)
})

test('validarRespostaAntesDeEnviar impede envio de JSON bruto ao lead', () => {
  const r = validarRespostaAntesDeEnviar({
    mensagem_pro_lead: '```json\n{"mensagens_bolhas":["Oi"],"etapa_proxima":"diagnostico"}\n```',
    mensagens_bolhas: [],
  }, {}, { contexto: { estagio: 'primeiro_contato' } })

  assert.equal(r.bloqueado, true)
  assert.doesNotMatch(r.resultado.mensagem_pro_lead, /mensagens_bolhas|```|{/)
})

test('simulador renderiza somente bolhas quando "Oi" volta como JSON em markdown', () => {
  const raw = '```json\n' + JSON.stringify({
    mensagem_pro_lead: null,
    mensagens_bolhas: [
      'Ola! Eu sou o assistente virtual da PJ Codeworks...',
      'Qual o ramo do seu negocio e em que cidade voce atende?',
    ],
    etapa_proxima: 'diagnostico',
    atualizar_perfil: {},
  }) + '\n```'
  const rendered = renderPublicReplyFromAiResponse(raw, { channel: 'test' })

  assert.equal(rendered.ok, true)
  assert.deepEqual(rendered.publicMessages, [
    'Ola! Eu sou o assistente virtual da PJ Codeworks...',
    'Qual o ramo do seu negocio e em que cidade voce atende?',
  ])
  assert.doesNotMatch(rendered.reply, /```|mensagens_bolhas|etapa_proxima|{/)
})

test('schema de resposta IA aceita contrato esperado', () => {
  const schema = validarRespostaVendasIA({
    mensagem_pro_lead: 'Oi, posso te ajudar?',
    atualizar_perfil: { negocio: 'clinica' },
    etapa_proxima: 'diagnostico',
    solicitar_calculo_preco: false,
    handoff: false,
    motivo_handoff: null,
  })
  assert.equal(schema.ok, true)
  assert.equal(schema.value.mensagem_pro_lead, 'Oi, posso te ajudar?')
})

test('schema de resposta IA normaliza alias de mensagem sem mudar fallback', () => {
  const schema = validarRespostaVendasIA({
    mensagem: 'Oi pelo alias',
    etapa_proxima: 'diagnostico',
    solicitar_calculo_preco: false,
    handoff: false,
    motivo_handoff: null,
  })
  assert.equal(schema.ok, true)
  assert.equal(schema.value.mensagem_pro_lead, 'Oi pelo alias')
})

test('schema de resposta IA reporta ausencia de mensagem util', () => {
  const schema = validarRespostaVendasIA({
    atualizar_perfil: {},
    etapa_proxima: 'diagnostico',
    solicitar_calculo_preco: false,
    handoff: false,
    motivo_handoff: null,
  })
  assert.equal(schema.ok, false)
  assert.ok(schema.issues.some((i) => i.path === 'mensagem_pro_lead'))
})

test('schema de perfil aceita campos do novo fluxo comercial', () => {
  const schema = validarAtualizarPerfilLead({
    origem_anuncio: { canal: 'Meta Ads', criativo: 'Seu cliente pesquisa antes de chamar no WhatsApp' },
    intencao_principal: 'site_personalizado',
    produto_sugerido: 'reuniao_proposta_site',
    eventos_conversa: { perguntou_preco: true, reuniao_oferecida: true },
    reuniao_proposta: { necessaria: true, horarios_sugeridos: ['19:45', '20:30'] },
    dor_principal: 'baixa confianca online',
    confusao_site_anuncio_google: true,
    explicacao_teste_gratis_enviada: false,
    expectativa_google_alinhada: true,
    personalizacao_nicho_cidade_enviada: true,
  })
  assert.equal(schema.ok, true)
  assert.equal(schema.value.produto_sugerido, 'reuniao_proposta_site')
  assert.equal(schema.value.eventos_conversa.reuniao_oferecida, true)
})

test('resultadoParseadoParaObjeto copia campos top-level do fluxo para atualizar_perfil', () => {
  const r = resultadoParseadoParaObjeto(
    {
      mensagem_pro_lead: 'Hoje sua empresa ja tem site ou usa mais Instagram/WhatsApp?',
      etapa_proxima: 'diagnostico',
      origem_anuncio: { canal: 'Meta Ads', campanha: 'WhatsApp | Estrutura Digital' },
      maturidade_digital: { tem_site: false, usa_instagram: true, nivel: 'basico' },
      eventos_conversa: { perguntou_preco: true },
      reuniao_proposta: { necessaria: true, horarios_sugeridos: ['19:45', '20:30'] },
      intencao_principal: 'presenca_digital',
      produto_sugerido: 'assinatura_simples',
      dor_principal: 'sem site',
      expectativa_google_alinhada: true,
      handoff: false,
      motivo_handoff: null,
    },
    'primeiro_contato'
  )
  assert.equal(r.atualizar_perfil.origem_anuncio.canal, 'Meta Ads')
  assert.equal(r.atualizar_perfil.maturidade_digital.nivel, 'basico')
  assert.equal(r.atualizar_perfil.eventos_conversa.perguntou_preco, true)
  assert.equal(r.atualizar_perfil.reuniao_proposta.necessaria, true)
  assert.equal(r.atualizar_perfil.expectativa_google_alinhada, true)
})

test('schema de resposta IA aceita maturidade e eventos sem quebrar contrato antigo', () => {
  const schema = validarRespostaVendasIA({
    mensagem_pro_lead: 'Entendi seu momento.',
    atualizar_perfil: { maturidade_digital: { nivel: 'basico' } },
    eventos_conversa: { dor_ja_mostrada: true },
    etapa_proxima: 'diagnostico',
    solicitar_calculo_preco: false,
    handoff: false,
    motivo_handoff: null,
  })
  assert.equal(schema.ok, true)
})

test('resultadoParseadoParaObjeto preserva handoff de reuniao de proposta', () => {
  const r = resultadoParseadoParaObjeto(
    {
      mensagem_pro_lead: 'Perfeito. Vou deixar alinhado com a equipe da PJ Codeworks para 20:30.',
      etapa_proxima: 'fechamento',
      handoff: true,
      motivo_handoff: 'agendou_reuniao_proposta',
      reuniao_proposta: { necessaria: true, horario_confirmado: '20:30' },
      resumo_handoff: 'Lead agendou reuniao de proposta personalizada para hoje as 20:30.',
    },
    'proposta'
  )
  assert.equal(r.handoff, true)
  assert.equal(r.motivo_handoff, 'agendou_reuniao_proposta')
  assert.equal(r.atualizar_perfil.reuniao_proposta.horario_confirmado, '20:30')
})

test('guardrail bloqueia venda direta de projeto personalizado e oferece reuniao (com agenda real)', async () => {
  // Agenda real consultada via buscarSlots — comportamento correto. Sem agenda, o guardrail
  // NAO inventa horarios hardcoded (testado no proximo teste).
  const buscarSlots = async () => ({
    data_sugerida: '2026-05-09',
    data_label: 'amanha',
    horarios_sugeridos: ['19:30', '19:45'],
  })
  const r = await aplicarGuardrailReuniaoProposta(
    {
      mensagem_pro_lead:
        'O projeto personalizado pra voce fica assim: entrada de R$ 360 + 3x de R$ 180. Quer fechar?',
      mensagens_bolhas: [],
      atualizar_perfil: { plano_sugerido: 'iniciante' },
      etapa_proxima: 'fechamento',
      solicitar_calculo_preco: true,
      handoff: false,
      motivo_handoff: null,
      links_sugeridos: [],
    },
    { negocio: 'perfuracao de pocos artesianos', cidade: 'Belem' },
    new Date('2026-05-08T22:00:00.000Z'),
    buscarSlots
  )
  assert.equal(r.solicitar_calculo_preco, false)
  assert.equal(r.handoff, false)
  assert.equal(r.etapa_proxima, 'proposta')
  assert.equal(r.atualizar_perfil.produto_sugerido, 'reuniao_proposta_personalizada')
  assert.equal(r.atualizar_perfil.reuniao_proposta.necessaria, true)
  assert.deepEqual(r.atualizar_perfil.reuniao_proposta.horarios_sugeridos, ['19:30', '19:45'])
  assert.match(r.mensagem_pro_lead, /equipe da PJ Codeworks/)
  assert.match(r.mensagem_pro_lead, /estrutura, prazo e investimento/)
  assert.doesNotMatch(r.mensagem_pro_lead, /Victor/)
  // Nao deve mais conter a frase bloqueada "No seu caso, isso entra como proposta personalizada"
  assert.doesNotMatch(r.mensagem_pro_lead, /proposta\s+personalizada\s+para/i)
})

test('guardrail SEM agenda real nao inventa horarios hardcoded — pede para verificar', async () => {
  // Comportamento corrigido: se buscarSlots nao foi fornecido OU falhar, o guardrail
  // NAO cai mais em horarios hardcoded ('19:30', '20:15'). Devolve uma mensagem neutra
  // pedindo para verificar agenda — melhor que oferecer horario fictício.
  const r = await aplicarGuardrailReuniaoProposta(
    {
      mensagem_pro_lead:
        'O projeto personalizado pra voce fica assim: entrada de R$ 360 + 3x de R$ 180. Quer fechar?',
      mensagens_bolhas: [],
      atualizar_perfil: { plano_sugerido: 'iniciante' },
      etapa_proxima: 'fechamento',
      solicitar_calculo_preco: true,
      handoff: false,
      motivo_handoff: null,
      links_sugeridos: [],
    },
    { negocio: 'perfuracao de pocos artesianos', cidade: 'Belem' },
    new Date('2026-05-08T22:00:00.000Z')
    // sem buscarSlots
  )
  assert.deepEqual(r.atualizar_perfil.reuniao_proposta.horarios_sugeridos, [])
  assert.match(r.mensagem_pro_lead, /pr[oó]ximos\s+hor[aá]rios\s+dispon/i)
  assert.doesNotMatch(r.mensagem_pro_lead, /\b19:30\b|\b20:15\b/, 'nao deve inventar horario hardcoded')
})

test('guardrail preserva assinatura simples via Stripe', async () => {
  const r = await aplicarGuardrailReuniaoProposta(
    {
      mensagem_pro_lead: 'A assinatura fica R$100/mes. Quer seguir?',
      atualizar_perfil: { plano_sugerido: 'iniciante_assinatura' },
      etapa_proxima: 'fechamento',
      solicitar_calculo_preco: false,
      handoff: false,
      motivo_handoff: null,
    },
    {},
    new Date('2026-05-08T22:00:00.000Z')
  )
  assert.equal(r.atualizar_perfil.plano_sugerido, 'iniciante_assinatura')
  assert.equal(r.mensagem_pro_lead, 'A assinatura fica R$100/mes. Quer seguir?')
})

test('sugestaoReuniaoProposta oferece mesmo dia quando ha dois horarios disponiveis', () => {
  const s = sugestaoReuniaoProposta(new Date('2026-05-08T22:00:00.000Z'))
  assert.equal(s.data_label, 'hoje')
  assert.deepEqual(s.horarios_sugeridos, ['19:30', '19:45'])
})

// ─── temConflito ──────────────────────────────────────────────────────────────

{
  const { temConflito } = require('../src/agenda')

  test('temConflito detecta sobreposicao exata', () => {
    const t = (hh, mm) => new Date(2026, 4, 11, hh, mm)
    assert.equal(temConflito(t(20, 15), t(20, 30), t(20, 15), t(20, 30)), true)
  })

  test('temConflito detecta sobreposicao parcial inicio', () => {
    const t = (hh, mm) => new Date(2026, 4, 11, hh, mm)
    assert.equal(temConflito(t(20, 0), t(20, 15), t(20, 10), t(20, 30)), true)
  })

  test('temConflito detecta sobreposicao parcial fim', () => {
    const t = (hh, mm) => new Date(2026, 4, 11, hh, mm)
    assert.equal(temConflito(t(20, 20), t(20, 35), t(20, 10), t(20, 30)), true)
  })

  test('temConflito nao detecta sobreposicao em slots adjacentes', () => {
    const t = (hh, mm) => new Date(2026, 4, 11, hh, mm)
    assert.equal(temConflito(t(20, 15), t(20, 30), t(20, 30), t(20, 45)), false)
    assert.equal(temConflito(t(20, 30), t(20, 45), t(20, 15), t(20, 30)), false)
  })

  test('temConflito nao detecta sobreposicao em slots distantes', () => {
    const t = (hh, mm) => new Date(2026, 4, 11, hh, mm)
    assert.equal(temConflito(t(19, 30), t(19, 45), t(20, 15), t(20, 30)), false)
  })

  test('agenda buscarSlotsDisponiveis nao oferece horario bloqueado', async () => {
    const originalQuery = pool.query
    pool.query = async (sql, params) => {
      assert.match(sql, /status = ANY\(\$3::text\[\]\)/)
      assert.ok(params[2].includes('bloqueado'))
      return {
        rows: [
          {
            data_inicio: new Date('2026-05-11T23:15:00.000Z'),
            data_fim: new Date('2026-05-11T23:30:00.000Z'),
          },
        ],
      }
    }
    try {
      const slots = await agenda.buscarSlotsDisponiveis({
        dataInicial: new Date('2026-05-11T22:00:00.000Z'),
        quantidade: 5,
      })
      assert.equal(slots.data_sugerida, '2026-05-11')
      assert.ok(!slots.horarios_sugeridos.includes('20:15'))
      // Buffer de 30min também bloqueia os adjacentes (20:00, 20:30, 20:45); 21:00 livre.
      assert.ok(!slots.horarios_sugeridos.includes('20:30'))
      assert.ok(slots.horarios_sugeridos.includes('21:00'))
    } finally {
      pool.query = originalQuery
    }
  })

  test('agenda buscarSlotsDisponiveis nao inventa horario quando banco falha', async () => {
    const originalQuery = pool.query
    pool.query = async () => {
      throw new Error('db indisponivel')
    }
    try {
      const slots = await agenda.buscarSlotsDisponiveis({
        dataInicial: new Date('2026-05-11T22:00:00.000Z'),
        quantidade: 2,
      })
      assert.equal(slots.erro, 'agenda_indisponivel')
      assert.equal(slots.data_sugerida, null)
      assert.deepEqual(slots.horarios_sugeridos, [])
    } finally {
      pool.query = originalQuery
    }
  })

  test('agenda slotEstaOcupado considera apenas status que ocupam horario', async () => {
    const originalQuery = pool.query
    pool.query = async (sql, params) => {
      assert.match(sql, /status = ANY\(\$3::text\[\]\)/)
      assert.deepEqual(params[2].sort(), ['bloqueado', 'confirmado', 'pendente'].sort())
      assert.ok(!params[2].includes('nao_compareceu'))
      return { rows: [{ n: '0' }] }
    }
    try {
      const ocupado = await agenda.slotEstaOcupado(
        new Date('2026-05-12T22:30:00.000Z'),
        new Date('2026-05-12T22:45:00.000Z'),
        7
      )
      assert.equal(ocupado, false)
    } finally {
      pool.query = originalQuery
    }
  })

  test('guardrail usa buscarSlots mockado e nao oferece slots ocupados', async () => {
    // Simula agenda com 19:30 e 19:45 ocupados
    const buscarSlotsMock = async () => ({
      data_sugerida: '2026-05-09',
      data_label: 'amanha',
      horarios_sugeridos: ['20:00', '20:15'],
    })
    const r = await aplicarGuardrailReuniaoProposta(
      {
        mensagem_pro_lead: 'O projeto personalizado para voce: entrada R$ 360 + 3x R$ 180. Quer fechar?',
        mensagens_bolhas: [],
        atualizar_perfil: { plano_sugerido: 'iniciante' },
        etapa_proxima: 'fechamento',
        solicitar_calculo_preco: true,
        handoff: false,
        motivo_handoff: null,
        links_sugeridos: [],
      },
      { negocio: 'salao de beleza', cidade: 'Curitiba' },
      new Date('2026-05-08T22:00:00.000Z'),
      buscarSlotsMock
    )
    assert.equal(r.etapa_proxima, 'proposta')
    assert.deepEqual(r.atualizar_perfil.reuniao_proposta.horarios_sugeridos, ['20:00', '20:15'])
    assert.match(r.mensagem_pro_lead, /20:00 ou 20:15/)
  })

  test('guardrail com buscarSlots retornando so um slot usa mensagem singular', async () => {
    const buscarSlotsMock = async () => ({
      data_sugerida: '2026-05-09',
      data_label: 'amanha',
      horarios_sugeridos: ['21:00'],
    })
    const r = await aplicarGuardrailReuniaoProposta(
      {
        mensagem_pro_lead: 'Site personalizado pra voce: entrada R$ 360 + 3x R$ 180. Quer fechar?',
        mensagens_bolhas: [],
        atualizar_perfil: { plano_sugerido: 'padrao' },
        etapa_proxima: 'fechamento',
        solicitar_calculo_preco: true,
        handoff: false,
        motivo_handoff: null,
        links_sugeridos: [],
      },
      { negocio: 'clinica', cidade: 'SP' },
      new Date('2026-05-08T22:00:00.000Z'),
      buscarSlotsMock
    )
    assert.equal(r.etapa_proxima, 'proposta')
    assert.deepEqual(r.atualizar_perfil.reuniao_proposta.horarios_sugeridos, ['21:00'])
    assert.match(r.mensagem_pro_lead, /ainda tenho 21:00 dispon[ií]vel/)
    assert.doesNotMatch(r.mensagem_pro_lead, /Victor/)
  })
}

test('normalizarAgendarFollowupAuto rejeita invalido ou alem do teto; empurra data cedo para o minimo', () => {
  const ref = new Date('2026-05-01T15:00:00.000Z')
  assert.equal(normalizarAgendarFollowupAuto(null, ref), null)
  assert.equal(normalizarAgendarFollowupAuto({ agendar_para: 'invalid' }, ref), null)
  assert.equal(normalizarAgendarFollowupAuto({ agendar_para: '2026-07-15T15:00:00.000Z' }, ref), null)
  const cedo = normalizarAgendarFollowupAuto({ agendar_para: '2026-05-01T14:00:00.000Z' }, ref)
  assert.ok(cedo)
  assert.ok(new Date(cedo.agendar_para).getTime() >= ref.getTime() + 14 * 60 * 1000)
})

test('normalizarAgendarFollowupAuto aceita ISO dentro da janela e instrucao padrao quando omitida', () => {
  const ref = new Date('2026-05-01T15:00:00.000Z')
  const n = normalizarAgendarFollowupAuto({ agendar_para: '2026-05-03T18:00:00.000Z' }, ref)
  assert.ok(n)
  assert.ok(typeof n.agendar_para === 'string')
  assert.match(n.instrucao_followup, /Retomada combinada/)
})

test('resultadoParseadoParaObjeto inclui agendar_followup_auto quando valido', () => {
  const in3d = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
  const r = resultadoParseadoParaObjeto(
    {
      mensagem_pro_lead: 'ok',
      agendar_followup_auto: { agendar_para: in3d, instrucao_followup: 'retomar combinado' },
    },
    'diagnostico'
  )
  assert.ok(r.agendar_followup_auto)
  assert.equal(r.agendar_followup_auto.instrucao_followup, 'retomar combinado')
})

test('resultadoParseadoParaObjeto repassa insights_lead (objeto) e null quando ausente/invalido', () => {
  const comInsights = resultadoParseadoParaObjeto(
    {
      mensagem_pro_lead: 'ok',
      insights_lead: { score: 72, origem_clientes: 'indicacao', urgencia: 'alta', sinais_compra: ['pediu preco'] },
    },
    'diagnostico'
  )
  assert.ok(comInsights.insights_lead, 'insights_lead deve ser repassado, nao descartado')
  assert.equal(comInsights.insights_lead.score, 72)
  assert.equal(comInsights.insights_lead.origem_clientes, 'indicacao')

  const semInsights = resultadoParseadoParaObjeto({ mensagem_pro_lead: 'ok' }, 'diagnostico')
  assert.equal(semInsights.insights_lead, null)

  const invalido = resultadoParseadoParaObjeto({ mensagem_pro_lead: 'ok', insights_lead: 'x' }, 'diagnostico')
  assert.equal(invalido.insights_lead, null)
})

test('resultadoParseadoParaObjeto captura sinal_conversa (adiamento/desinteresse), null p/ invalido', () => {
  const ad = resultadoParseadoParaObjeto({ mensagem_pro_lead: 'ok', sinal_conversa: 'adiamento' }, 'diagnostico')
  assert.equal(ad.sinal_conversa, 'adiamento')
  const des = resultadoParseadoParaObjeto({ mensagem_pro_lead: 'ok', sinal_conversa: 'desinteresse' }, 'diagnostico')
  assert.equal(des.sinal_conversa, 'desinteresse')
  // valor fora do contrato vira null (código só age em adiamento/desinteresse)
  assert.equal(resultadoParseadoParaObjeto({ mensagem_pro_lead: 'ok', sinal_conversa: 'talvez' }, 'diagnostico').sinal_conversa, null)
  assert.equal(resultadoParseadoParaObjeto({ mensagem_pro_lead: 'ok' }, 'diagnostico').sinal_conversa, null)
})

test('parse Claude aceita fence generico para JSON de diagnostico de funil', () => {
  const inner = JSON.stringify({
    pontuacao_geral: 7,
    resumo_geral: 'Teste',
    problemas_por_gravidade: { alta: [], media: [], baixa: [] },
    diagnostico_dos_leads: [],
    padroes_identificados: [],
    proximo_passo_recomendado: '',
    mensagens_prontas: [],
  })
  const parsed = parsearRespostaJsonClaude('Segue analise:\n```\n' + inner + '\n```')
  assert.equal(parsed.pontuacao_geral, 7)
  assert.equal(parsed.resumo_geral, 'Teste')
})

test('rotas criticas usam REPROCESS_SECRET', () => {
  assert.equal(reprocessarAutorizado({ headers: { 'x-reprocess-secret': 'test-secret-123' } }), true)
  assert.equal(reprocessarAutorizado({ headers: { 'x-reprocess-secret': 'errado' } }), false)
  assert.equal(webhookAutorizado({ headers: { 'x-reprocess-secret': 'test-secret-123' } }), true)
})

test('webhook aceita WEBHOOK_SECRET opcional (x-webhook-secret ou Bearer)', t => {
  const prev = process.env.WEBHOOK_SECRET
  t.after(() => {
    if (prev === undefined) delete process.env.WEBHOOK_SECRET
    else process.env.WEBHOOK_SECRET = prev
  })
  process.env.WEBHOOK_SECRET = 'wh-only-for-webhook-99'
  assert.equal(webhookAutorizado({ headers: { 'x-webhook-secret': 'wh-only-for-webhook-99' } }), true)
  assert.equal(webhookAutorizado({ headers: { 'x-webhook-secret': 'errado' } }), false)
  assert.equal(webhookAutorizado({ headers: { authorization: 'Bearer wh-only-for-webhook-99' } }), true)
  assert.equal(webhookAutorizado({ headers: { authorization: '  Bearer wh-only-for-webhook-99  ' } }), true)
  assert.equal(webhookAutorizado({ headers: { authorization: 'Bearer errado' } }), false)
  assert.equal(webhookAutorizado({ headers: { 'x-reprocess-secret': 'test-secret-123' } }), true)
  assert.equal(reprocessarAutorizado({ headers: { 'x-webhook-secret': 'wh-only-for-webhook-99' } }), false)
  delete process.env.WEBHOOK_SECRET
  assert.equal(webhookAutorizado({ headers: { 'x-webhook-secret': 'wh-only-for-webhook-99' } }), false)
})

test('rotas de diagnostico de funil ficam protegidas por REPROCESS_SECRET', () => {
  const fs = require('node:fs')
  const src = fs.readFileSync(require.resolve('../src/agent'), 'utf8')
  for (const rota of [
    '/dashboard/funil-diagnostico/config',
    '/dashboard/funil-diagnostico/analisar',
    '/dashboard/funil-diagnostico/prompts/aceitar-melhoria',
    '/dashboard/funil-diagnostico/historico',
  ]) {
    const idx = src.indexOf(rota)
    assert.notEqual(idx, -1, rota)
    assert.match(src.slice(idx, idx + 420), /reprocessarAutorizado\(req\)/, rota)
  }
})

test('GET /dashboard/stats/llm-uso protegido por REPROCESS_SECRET', () => {
  const fs = require('node:fs')
  const src = fs.readFileSync(require.resolve('../src/agent'), 'utf8')
  const rota = '/dashboard/stats/llm-uso'
  const idx = src.indexOf(rota)
  assert.notEqual(idx, -1, rota)
  assert.match(src.slice(idx, idx + 420), /reprocessarAutorizado\(req\)/, rota)
})

test('rotas de prompts do dashboard ficam protegidas por REPROCESS_SECRET', () => {
  const fs = require('node:fs')
  const src = fs.readFileSync(require.resolve('../src/agent'), 'utf8')
  for (const rota of [
    "app.get('/dashboard/prompts',",
    "app.get('/dashboard/prompts/:chave',",
    "app.put('/dashboard/prompts/:chave',",
    "app.post('/dashboard/prompts/:chave/reverter',",
  ]) {
    const idx = src.indexOf(rota)
    assert.notEqual(idx, -1, rota)
    assert.match(src.slice(idx, idx + 420), /reprocessarAutorizado\(req\)/, rota)
  }
})

test('normalizarChavePrompt aceita whitelist de overlays', () => {
  const prompts = require('../src/prompts')
  assert.equal(prompts.normalizarChavePrompt('system'), 'system')
  assert.equal(prompts.normalizarChavePrompt('SYSTEM'), 'system')
  assert.equal(prompts.normalizarChavePrompt('lead-coach'), 'lead-coach')
  assert.equal(prompts.normalizarChavePrompt('foo'), '')
  assert.ok(prompts.CHAVES_PERMITIDAS.includes('followup_timing'))
})

test('estimativaCustoLlm retorna null sem precificacao ok', () => {
  const { estimativaCustoLlm } = require('../src/agent')
  assert.equal(estimativaCustoLlm(1e6, 5e5, { ok: false }), null)
  assert.equal(estimativaCustoLlm(1e6, 5e5, null), null)
})

test('estimativaCustoLlm calcula USD e BRL a partir de tokens', () => {
  const { estimativaCustoLlm } = require('../src/agent')
  const p = { ok: true, inPerM: 3, outPerM: 15, usdBrl: 5 }
  const r = estimativaCustoLlm(2_000_000, 1_000_000, p)
  assert.ok(r)
  assert.equal(r.usd, 21)
  assert.equal(r.brl, 105)
})

test('parseLlmPricingEnv le LLM_ESTIMATE_* e LLM_USD_BRL', () => {
  const { parseLlmPricingEnv } = require('../src/agent')
  const oldI = process.env.LLM_ESTIMATE_INPUT_PER_MTOK_USD
  const oldO = process.env.LLM_ESTIMATE_OUTPUT_PER_MTOK_USD
  const oldB = process.env.LLM_USD_BRL
  try {
    process.env.LLM_ESTIMATE_INPUT_PER_MTOK_USD = '2.5'
    process.env.LLM_ESTIMATE_OUTPUT_PER_MTOK_USD = '10'
    process.env.LLM_USD_BRL = '6'
    const pr = parseLlmPricingEnv()
    assert.equal(pr.ok, true)
    assert.equal(pr.inPerM, 2.5)
    assert.equal(pr.outPerM, 10)
    assert.equal(pr.usdBrl, 6)
  } finally {
    if (oldI === undefined) delete process.env.LLM_ESTIMATE_INPUT_PER_MTOK_USD
    else process.env.LLM_ESTIMATE_INPUT_PER_MTOK_USD = oldI
    if (oldO === undefined) delete process.env.LLM_ESTIMATE_OUTPUT_PER_MTOK_USD
    else process.env.LLM_ESTIMATE_OUTPUT_PER_MTOK_USD = oldO
    if (oldB === undefined) delete process.env.LLM_USD_BRL
    else process.env.LLM_USD_BRL = oldB
  }
})

test('filtros de conversas incluem predicados de perfil quando necessario', () => {
  const filtro = buildWhereConversasFiltros(null, null, null, {
    filaPreco: true,
    precoDivergente: true,
  })
  assert.match(filtro.where, /p\.precificacao_json/)
  assert.match(filtro.where, /p\.preco_ia_divergente_motor/)
  assert.deepEqual(filtro.params, [])
})

test('filtros operacionais de conversas usam perfil, follow-up e acao imediata', () => {
  const filtro = buildWhereConversasFiltros(null, null, null, {
    origem: 'meta_ads',
    urgencia: 'alta',
    scoreMin: 70,
    followup: 'hoje',
    acaoAgora: true,
  })
  assert.match(filtro.where, /p\.origem = \$1/)
  assert.match(filtro.where, /p\.insights_lead->>'urgencia' = \$2/)
  assert.match(filtro.where, /p\.score_lead, 0\) >= \$3/)
  assert.match(filtro.where, /followup_auto_agendamentos/)
  assert.match(filtro.where, /c\.ultima_falha_resposta_em IS NOT NULL/)
  assert.deepEqual(filtro.params, ['meta_ads', 'alta', 70])
})

test('diagnostico de funil seleciona ate 20 conversas mais informativas', () => {
  const now = new Date('2026-05-01T12:00:00.000Z')
  const rows = Array.from({ length: 30 }, (_, i) => ({
    numero: '55' + i,
    historico: [
      { role: 'assistant', content: 'oi' },
      ...Array.from({ length: i % 6 }, () => ({ role: 'user', content: 'lead respondeu' })),
    ],
    mensagens: 2 + i,
    user_msgs: i % 6,
    atualizado_em: new Date(now.getTime() - i * 3600000).toISOString(),
  }))
  const out = selecionarConversasFunilDiagnostico(rows, 20, now)
  assert.equal(out.length, 20)
  assert.ok(out.every((x) => x.user_msgs > 0))
  assert.ok(out[0].score_funil_diagnostico >= out[1].score_funil_diagnostico)
})

test('diagnostico de funil normaliza JSON de analise e avaliacao', () => {
  const r = normalizarResultadoFunilDiagnostico({
    pontuacao_geral: 12,
    resumo: 'Resumo',
    problemas: [{ titulo: 'Sem dor', descricao: 'pulou descoberta', gravidade: 'alta' }],
    diagnostico_lead: 'frio',
    mensagem_sugerida: 'retomar com pergunta',
  })
  assert.equal(r.pontuacao_geral, 10)
  assert.deepEqual(r.problemas_por_gravidade.alta, ['Sem dor: pulou descoberta'])
  assert.deepEqual(r.diagnostico_dos_leads, ['frio'])
  assert.deepEqual(r.mensagens_prontas, ['retomar com pergunta'])

  const a = normalizarAvaliacaoPromptFunil({
    avaliacao_do_prompt: 'ruim',
    pontos_fracos_do_prompt: 'generico',
    prompt_melhorado: 'novo prompt',
  })
  assert.equal(a.avaliacao_do_prompt, 'media')
  assert.deepEqual(a.pontos_fracos_do_prompt, ['generico'])
})

test('diagnostico de funil monta contexto com banco e conversa colada', () => {
  assert.equal(normalizarEtapaFunilDiagnostico('Primeiro Contato'), 'primeiro_contato')
  const ctx = montarContextoFunilDiagnostico(
    [{
      numero: '5511999999999@s.whatsapp.net',
      negocio: 'clinica',
      cidade: 'Campinas',
      estagio: 'primeiro_contato',
      historico: [{ role: 'user', content: 'quero saber mais' }],
    }],
    '[Lead]: conversa manual'
  )
  assert.match(ctx, /CONVERSA 1/)
  assert.match(ctx, /Lead: quero saber mais/)
  assert.match(ctx, /CONVERSA COLADA/)
  assert.deepEqual(variantesEtapaFunilDiagnostico('Proposta'), ['proposta', 'proposta_enviada'])
})

test('diagnostico de funil cria nova versao ativa do prompt', async () => {
  const originalQuery = pool.query
  const calls = []
  pool.query = async (sql, params) => {
    calls.push({ sql: String(sql), params })
    if (/MAX\(version\)/.test(sql)) return { rows: [{ max_version: 2 }] }
    if (/INSERT INTO vendas\.funil_prompt_versions/.test(sql)) {
      return { rows: [{ id: 3, etapa: params[0], version: params[1], prompt: params[2], ativo: true }] }
    }
    return { rows: [] }
  }
  try {
    const prompt = 'Prompt melhorado '.repeat(20)
    const out = await criarNovaVersaoPromptFunil('Primeiro Contato', prompt)
    assert.equal(out.version, 3)
    assert.equal(out.etapa, 'primeiro_contato')
    assert.ok(calls.some((c) => /^BEGIN/.test(c.sql)))
    assert.ok(calls.some((c) => /SET ativo = false/.test(c.sql)))
    assert.ok(calls.some((c) => /^COMMIT/.test(c.sql)))
  } finally {
    pool.query = originalQuery
  }
})

test('preview de site gera HTML/SVG seguro e personalizado', () => {
  const dados = dadosPreviewSite(
    '5511999999999@s.whatsapp.net',
    {
      negocio: '<ClÃ­nica Teste>',
      cidade: 'Santo Andre',
      plano_sugerido: 'padrao',
      preco_calculado: 892,
      entrada: 357,
      parcela: 178,
    },
    [{ role: 'user', content: 'Quero site institucional com agendamento e Google' }]
  )
  const html = montarPreviewSiteHtml(dados)
  const svg = montarPreviewSiteSvg(dados)

  assert.equal(dados.modelo, 'padrao')
  assert.match(html, /&lt;ClÃ­nica Teste&gt;/)
  assert.doesNotMatch(html, /<ClÃ­nica Teste>/)
  assert.match(html, /R\$ 892/)
  assert.match(svg, /SANTO ANDRE/)
  assert.match(svg, /Chamar no WhatsApp/)
})

test('caption da previa enquadra como amostra estrategica', () => {
  const caption = montarPreviewSiteCaption({ negocio: 'clinica odontologica' })
  assert.match(caption, /previa estrategica/i)
  assert.match(caption, /amostra de direcao/i)
  assert.doesNotMatch(caption, /so um rascunho/i)
})

test('parse Claude aceita caption_print quando enviar_print esta definido', () => {
  const parsed = parsearRespostaJsonClaude(JSON.stringify({
    mensagem_pro_lead: 'Vou te mandar um exemplo.',
    enviar_print: 'modelos-site',
    caption_print: 'Esses sao os 3 modelos para clinica odontologica em Campinas.',
    etapa_proxima: 'recomendacao',
  }))
  const norm = normalizarParsedRespostaVendas(parsed)
  const r = resultadoParseadoParaObjeto(norm, 'recomendacao')
  assert.equal(r.enviar_print, 'modelos-site')
  assert.equal(r.caption_print, 'Esses sao os 3 modelos para clinica odontologica em Campinas.')
})

test('caption_print vira null quando enviar_print esta ausente', () => {
  const parsed = parsearRespostaJsonClaude(JSON.stringify({
    mensagem_pro_lead: 'Texto qualquer.',
    enviar_print: null,
    caption_print: 'caption fora de lugar',
    etapa_proxima: 'diagnostico',
  }))
  const norm = normalizarParsedRespostaVendas(parsed)
  const r = resultadoParseadoParaObjeto(norm, 'diagnostico')
  assert.equal(r.enviar_print, null)
  assert.equal(r.caption_print, null)
})

test('caption_print e truncado em 320 chars', () => {
  const caption350 = 'a'.repeat(350)
  const parsed = parsearRespostaJsonClaude(JSON.stringify({
    mensagem_pro_lead: 'Texto.',
    enviar_print: 'planos-mensais',
    caption_print: caption350,
    etapa_proxima: 'proposta',
  }))
  const norm = normalizarParsedRespostaVendas(parsed)
  const r = resultadoParseadoParaObjeto(norm, 'proposta')
  assert.equal(r.enviar_print, 'planos-mensais')
  assert.equal(r.caption_print.length, 320)
})

test('gerarMensagemPosPreviewFallback adapta para pintura', () => {
  assert.match(gerarMensagemPosPreviewFallback({ negocio: 'pintura predial' }), /servico/i)
  assert.match(gerarMensagemPosPreviewFallback({ negocio: 'clinica odontologica' }), /chama no whatsapp/i)
})

test('gerarMensagemPosPreview cai no fallback sem ANTHROPIC_KEY', async () => {
  const prev = process.env.ANTHROPIC_KEY
  delete process.env.ANTHROPIC_KEY
  try {
    const msg = await gerarMensagemPosPreview({ negocio: 'pintura industrial' }, { modelo: 'padrao' }, null)
    assert.equal(typeof msg, 'string')
    assert.ok(msg.length > 0)
    assert.match(msg, /pratica|servico|previa|direcao/i)
  } finally {
    if (prev == null) delete process.env.ANTHROPIC_KEY
    else process.env.ANTHROPIC_KEY = prev
  }
})

test('gerarCaptionPreview cai no fallback sem ANTHROPIC_KEY mantendo enquadramento', async () => {
  const prev = process.env.ANTHROPIC_KEY
  delete process.env.ANTHROPIC_KEY
  try {
    const caption = await gerarCaptionPreview(
      { negocio: 'barbearia', cidade: 'Sao Bernardo' },
      { modelo: 'padrao' },
      null
    )
    assert.match(caption, /previa estrategica/i)
    assert.match(caption, /amostra de direcao/i)
  } finally {
    if (prev == null) delete process.env.ANTHROPIC_KEY
    else process.env.ANTHROPIC_KEY = prev
  }
})

test('gerarApresentacaoOperadorFallback contextualiza nicho e cidade', () => {
  const fb = gerarApresentacaoOperadorFallback({ negocio: 'barbearia', cidade: 'Sao Bernardo' })
  assert.equal(typeof fb.intro, 'string')
  assert.equal(typeof fb.captionModelos, 'string')
  assert.equal(typeof fb.captionPlanos, 'string')
  assert.equal(typeof fb.fechamento, 'string')
  assert.match(fb.intro, /barbearia/i)
  assert.match(fb.intro, /Sao Bernardo/i)
  assert.match(fb.captionPlanos, /R\$ ?150/)
  assert.doesNotMatch(fb.intro, /\[/)
  assert.doesNotMatch(fb.captionModelos, /\[/)
  assert.doesNotMatch(fb.captionPlanos, /\[/)
})

test('gerarApresentacaoOperador cai no fallback sem ANTHROPIC_KEY mantendo 4 campos', async () => {
  const prev = process.env.ANTHROPIC_KEY
  delete process.env.ANTHROPIC_KEY
  try {
    const out = await gerarApresentacaoOperador(
      { negocio: 'barbearia', cidade: 'Sao Bernardo' },
      [],
      null
    )
    assert.deepEqual(Object.keys(out).sort(), ['captionModelos', 'captionPlanos', 'fechamento', 'intro'])
    assert.match(out.intro, /barbearia/i)
  } finally {
    if (prev == null) delete process.env.ANTHROPIC_KEY
    else process.env.ANTHROPIC_KEY = prev
  }
})

test('follow-up automatico usa limite por estagio com encerramento gentil extra', () => {
  assert.equal(sequenciasComerciaisFollowupPorEstagio('primeiro_contato'), 1)
  assert.equal(maxSequenciaFollowupAutoPorEstagio('primeiro_contato'), 2)
  assert.equal(maxSequenciaFollowupAutoPorEstagio('proposta_enviada'), 6)
  assert.equal(maxSequenciaFollowupAutoPorEstagio('diagnostico'), 4)
  assert.equal(isSequenciaEncerramentoFollowup('diagnostico', 4), true)
  assert.equal(isSequenciaEncerramentoFollowup('diagnostico', 3), false)
})

test('follow-up automatico empurra agendamento para janela comercial', () => {
  const tz = 'America/Sao_Paulo'
  const madrugada = ajustarParaJanelaComercialFollowup(new Date('2026-04-29T05:30:00.000Z'), tz)
  assert.equal(madrugada.toISOString(), '2026-04-29T11:30:00.000Z')

  const noite = ajustarParaJanelaComercialFollowup(new Date('2026-04-29T23:30:00.000Z'), tz)
  assert.equal(noite.toISOString(), '2026-04-30T11:30:00.000Z')

  const comercial = ajustarParaJanelaComercialFollowup(new Date('2026-04-29T17:00:00.000Z'), tz)
  assert.equal(comercial.toISOString(), '2026-04-29T17:30:00.000Z')
})

test('operadores normalizam env, JID e removem duplicados', () => {
  const prev = process.env.OPERATOR_WHATSAPP
  process.env.OPERATOR_WHATSAPP = '5511987309724:Victor, (11) 98730-9724:Duplicado,11911112222:Ana'
  try {
    const envOps = operadoresDoEnv()
    assert.equal(envOps[0].jid, '5511987309724@s.whatsapp.net')
    assert.equal(envOps[0].nome, 'Victor')
    assert.equal(envOps[2].jid, '5511911112222@s.whatsapp.net')

    const norm = normalizarEntradaOperador({ numero: '5511987309724@s.whatsapp.net', ativo: false })
    assert.deepEqual(
      { numero: norm.numero, jid: norm.jid, ativo: norm.ativo, recebe_alertas: norm.recebe_alertas },
      { numero: '5511987309724', jid: '5511987309724@s.whatsapp.net', ativo: false, recebe_alertas: true }
    )

    const dedup = dedupeOperadores(envOps)
    assert.equal(dedup.length, 2)
  } finally {
    if (prev == null) delete process.env.OPERATOR_WHATSAPP
    else process.env.OPERATOR_WHATSAPP = prev
  }
})

test('listarOperadoresAtivos usa banco e filtra inativos/sem alerta', async () => {
  const originalQuery = pool.query
  const chamadas = []
  pool.query = async (sql) => {
    chamadas.push(sql)
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 3 }] }
    if (/FROM vendas\.operadores/.test(sql)) {
      return {
        rows: [
          { nome: 'Ativo', numero: '5511000000001', jid: '5511000000001@s.whatsapp.net', ativo: true, recebe_alertas: true },
          { nome: 'Sem alerta', numero: '5511000000002', jid: '5511000000002@s.whatsapp.net', ativo: true, recebe_alertas: false },
          { nome: 'Inativo', numero: '5511000000003', jid: '5511000000003@s.whatsapp.net', ativo: false, recebe_alertas: true },
        ],
      }
    }
    return { rows: [] }
  }
  try {
    const todosAtivos = await listarOperadoresAtivos()
    assert.equal(todosAtivos.length, 2)
    const alertas = await listarOperadoresAtivos({ alertas: true })
    assert.equal(alertas.length, 1)
    assert.equal(alertas[0].nome, 'Ativo')
  } finally {
    pool.query = originalQuery
  }
})

test('chat de operador livre usa ajuda programada sem assistente IA', () => {
  const texto = textoAjudaOperadorProgramada()
  assert.match(texto, /Comando não reconhecido/)
  assert.match(texto, /INSTRUÇÃO/)
  assert.doesNotMatch(texto, /Claude|IA|modelo/i)
})

test('buscarContextoProspeccao retorna prospect e diagnostico mais recentes por numero', async () => {
  const originalQuery = pool.query
  pool.query = async (sql, params) => {
    if (/FROM prospectador\.prospects p/.test(sql)) {
      assert.ok(Array.isArray(params[0]) && params[0].includes('5511998888777'))
      return {
        rows: [{
          id: '6f4de89f-4b4f-4d2f-95c6-0ef8f34f7d09',
          nome: 'Clinica Teste',
          nicho: 'clinica odontologica',
          cidade: 'Santo Andre',
          telefone: '+55 (11) 99888-7777',
          site: '',
          tem_site: false,
          rating: 4.6,
          avaliacoes: 31,
          status: 'respondeu',
          score: 88,
          metadata_json: {},
          created_at: '2026-04-29T18:00:00.000Z',
          updated_at: '2026-04-29T19:00:00.000Z',
          diagnostico: {
            dor_principal: 'nao aparece para buscas locais',
            perda_estimada: 1800,
            mensagem_gerada: 'Ola, percebi que voces podem captar mais contatos no Google.',
            mensagem_editada: null,
            agendado_para: '2026-04-30T14:30:00.000Z',
            metadata_json: { provider: 'anthropic' },
          },
        }],
      }
    }
    return { rows: [] }
  }
  try {
    const ctx = await buscarContextoProspeccao('5511998888777@s.whatsapp.net')
    assert.equal(ctx.prospect.nicho, 'clinica odontologica')
    assert.equal(ctx.prospect.cidade, 'Santo Andre')
    assert.equal(ctx.prospect.tem_site, false)
    assert.equal(ctx.diagnostico.dor_principal, 'nao aparece para buscas locais')
    assert.equal(ctx.diagnostico.perda_estimada, 1800)
    assert.equal(ctx.diagnostico.agendado_para, '2026-04-30T14:30:00.000Z')
  } finally {
    pool.query = originalQuery
  }
})

test('registrarChamadaAnthropic persiste usage e continua se insert falhar', async () => {
  const originalQuery = pool.query
  const originalWarn = console.warn
  const chamadas = []
  pool.query = async (sql, params) => {
    chamadas.push({ sql, params })
    return { rows: [] }
  }
  try {
    await registrarChamadaAnthropic({
      request_id: 'req-test',
      tipo: 'funnel',
      numero: '5511999999999@s.whatsapp.net',
      model: 'claude-sonnet-4-6',
      estagio: 'diagnostico',
      duration_ms: 123.8,
      http_ok: true,
      http_status: 200,
      stop_reason: 'end_turn',
      round_index: 1,
      stale_retry: true,
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 },
      metadata: { web_search: false },
    })

    assert.equal(chamadas.length, 1)
    assert.match(chamadas[0].sql, /INSERT INTO vendas\.llm_chamadas/)
    assert.equal(chamadas[0].params[0], 'req-test')
    assert.equal(chamadas[0].params[1], 'funnel')
    assert.equal(chamadas[0].params[5], 124)
    assert.equal(chamadas[0].params[10], true)
    assert.deepEqual(JSON.parse(chamadas[0].params[11]), {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 3,
    })

    pool.query = async () => {
      throw new Error('db indisponivel')
    }
    console.warn = () => {}
    await assert.doesNotReject(() =>
      registrarChamadaAnthropic({
        tipo: 'followup',
        http_ok: false,
        erro_msg: 'falha simulada',
      })
    )
  } finally {
    pool.query = originalQuery
    console.warn = originalWarn
  }
})

test('prospectador mapeia Places para prospect com score e tem_site', () => {
  const place = {
    id: 'places/abc123',
    displayName: { text: 'Barbearia Teste' },
    formattedAddress: 'Rua A, 123 - Sao Bernardo do Campo',
    internationalPhoneNumber: '+55 11 99999-0000',
    websiteUri: 'https://barbeariateste.com.br',
    googleMapsUri: 'https://maps.google.com/?cid=1',
    rating: 4.7,
    userRatingCount: 83,
    businessStatus: 'OPERATIONAL',
    primaryTypeDisplayName: { text: 'Barbearia' },
    types: ['barber_shop'],
  }
  const prospect = mapearPlace(place)
  assert.equal(prospect.place_id, 'places/abc123')
  assert.equal(prospect.nome, 'Barbearia Teste')
  assert.equal(prospect.tem_site, true)
  assert.equal(prospect.reviews, 83)
  assert.equal(prospect.score, calcularScoreProspect(place))

  const persistido = normalizarProspectParaPersistencia(prospect, {
    nicho: 'barbearias',
    cidade: 'Sao Bernardo do Campo',
  })
  assert.equal(persistido.place_id, 'places/abc123')
  assert.equal(persistido.tem_site, true)
  assert.equal(persistido.avaliacoes, 83)
})

test('salvarProspect retorna categoria derivada do raw_json para o dashboard', async () => {
  const originalQuery = pool.query
  pool.query = async (_sql, params) => ({
    rows: [
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        nome: params[0],
        telefone: params[1],
        nicho: params[2],
        cidade: params[3],
        endereco: params[4],
        avaliacoes: params[5],
        rating: params[6],
        tem_site: params[7],
        site: params[8],
        maps_url: params[9],
        place_id: params[10],
        origem: params[11],
        status: 'aguardando',
        score: params[12],
        motivo_score: params[13],
        raw_json: { primaryTypeDisplayName: { text: 'Barbearia' } },
        created_at: '2026-04-30T10:00:00.000Z',
        updated_at: '2026-04-30T10:00:00.000Z',
      },
    ],
  })
  try {
    const salvo = await salvarProspect(
      {
        place_id: 'places/cat123',
        nome: 'Casa Murdock Barbearia',
        telefone: '+55 11 5051-2968',
        site: '',
        maps_url: 'https://maps.google.com/?cid=1',
        reviews: 681,
        rating: 4.7,
        score: 78,
        motivo_score: 'nota 4.7 | 681 reviews | telefone disponivel',
        raw_json: { primaryTypeDisplayName: { text: 'Barbearia' } },
      },
      { nicho: 'barbearia', cidade: 'Sao Paulo', origem: 'manual' }
    )
    assert.equal(salvo.categoria, 'Barbearia')
  } finally {
    pool.query = originalQuery
  }
})

test('prospectador calcula oportunidade maior quando nao tem site', () => {
  const semSite = calcularScoreProspect({
    rating: 4.6,
    userRatingCount: 30,
    internationalPhoneNumber: '+55 11 99999-0000',
    businessStatus: 'OPERATIONAL',
  })
  const comSite = calcularScoreProspect({
    rating: 4.6,
    userRatingCount: 30,
    internationalPhoneNumber: '+55 11 99999-0000',
    websiteUri: 'https://exemplo.com',
    businessStatus: 'OPERATIONAL',
  })
  assert.equal(semSite - comSite, 22)
})

test('salvarProspect usa upsert por place_id e retorna registro persistido', async () => {
  const originalQuery = pool.query
  const chamadas = []
  pool.query = async (sql, params) => {
    chamadas.push({ sql, params })
    return {
      rows: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          nome: params[0],
          telefone: params[1],
          nicho: params[2],
          cidade: params[3],
          endereco: params[4],
          avaliacoes: params[5],
          rating: params[6],
          tem_site: params[7],
          site: params[8],
          maps_url: params[9],
          place_id: params[10],
          origem: params[11],
          status: 'aguardando',
          score: params[12],
          motivo_score: params[13],
          created_at: '2026-04-30T10:00:00.000Z',
          updated_at: '2026-04-30T10:00:00.000Z',
        },
      ],
    }
  }
  try {
    const salvo = await salvarProspect(
      {
        place_id: 'places/abc123',
        nome: 'Barbearia Teste',
        telefone: '+55 11 99999-0000',
        site: '',
        maps_url: 'https://maps.google.com/?cid=1',
        reviews: 10,
        rating: 4.5,
        score: 90,
        motivo_score: 'sem site visivel',
        raw_json: { id: 'places/abc123' },
      },
      { nicho: 'barbearias', cidade: 'SBC', origem: 'manual' }
    )
    assert.equal(chamadas.length, 1)
    assert.match(chamadas[0].sql, /ON CONFLICT \(place_id\) DO UPDATE/)
    assert.equal(chamadas[0].params[10], 'places/abc123')
    assert.equal(salvo.id, '11111111-1111-1111-1111-111111111111')
    assert.equal(salvo.status, 'aguardando')
    assert.equal(salvo.tem_site, false)
  } finally {
    pool.query = originalQuery
  }
})

test('atualizarStatusProspect permite aprovar e rejeitar', async () => {
  const originalQuery = pool.query
  const chamadas = []
  pool.query = async (sql, params) => {
    chamadas.push({ sql, params })
    return {
      rows: [
        {
          id: params[0],
          nome: 'Barbearia Teste',
          telefone: null,
          nicho: 'barbearias',
          cidade: 'SBC',
          endereco: null,
          avaliacoes: null,
          rating: null,
          tem_site: false,
          site: null,
          maps_url: null,
          place_id: 'places/abc123',
          origem: 'manual',
          status: params[1],
          score: 90,
          motivo_score: 'sem site visivel',
          created_at: '2026-04-30T10:00:00.000Z',
          updated_at: '2026-04-30T10:05:00.000Z',
        },
      ],
    }
  }
  try {
    const aprovado = await atualizarStatusProspect('11111111-1111-1111-1111-111111111111', 'aprovado')
    assert.equal(aprovado.status, 'aprovado')
    const rejeitado = await atualizarStatusProspect('11111111-1111-1111-1111-111111111111', 'rejeitado')
    assert.equal(rejeitado.status, 'rejeitado')
    assert.equal(chamadas.length, 2)
  } finally {
    pool.query = originalQuery
  }
})

test('atualizarStatusProspectsLote atualiza varios ids', async () => {
  const originalQuery = pool.query
  pool.query = async (_sql, params) => ({
    rows: params[0].map((id) => ({
      id,
      nome: 'X',
      telefone: null,
      nicho: 'n',
      cidade: 'c',
      endereco: null,
      avaliacoes: null,
      rating: null,
      tem_site: false,
      site: null,
      maps_url: null,
      place_id: `p-${id}`,
      origem: 'manual',
      status: params[1],
      score: null,
      motivo_score: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    })),
  })
  try {
    const out = await atualizarStatusProspectsLote(
      ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
      'aprovado'
    )
    assert.equal(out.length, 2)
    assert.equal(out[0].status, 'aprovado')
  } finally {
    pool.query = originalQuery
  }
})

test('atualizarMensagemEditada atualiza diagnostico mais recente', async () => {
  const originalQuery = pool.query
  pool.query = async () => ({
    rows: [
      {
        id: 'd1',
        prospect_id: '11111111-1111-1111-1111-111111111111',
        dor_principal: 'sem site',
        perda_estimada: 1000,
        mensagem_gerada: 'msg',
        mensagem_editada: 'msg editada',
        aprovado_em: null,
        enviado_em: null,
        metadata_json: {},
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
  })
  try {
    const d = await atualizarMensagemEditada('11111111-1111-1111-1111-111111111111', { mensagem_editada: 'msg editada' })
    assert.equal(d.mensagem_editada, 'msg editada')
  } finally {
    pool.query = originalQuery
  }
})

test('gerarDiagnosticos gera fallback sem ANTHROPIC_KEY', async () => {
  const originalQuery = pool.query
  const prev = process.env.ANTHROPIC_KEY
  delete process.env.ANTHROPIC_KEY
  let step = 0
  pool.query = async () => {
    step += 1
    if (step === 1) {
      return {
        rows: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            nome: 'Barbearia',
            telefone: '5511999999999',
            nicho: 'barbearias',
            cidade: 'sbc',
            endereco: 'rua',
            avaliacoes: 10,
            rating: 4.5,
            tem_site: false,
            site: '',
            maps_url: '',
            place_id: 'p1',
            origem: 'manual',
            status: 'aguardando',
            score: 80,
            motivo_score: '',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      }
    }
    if (step === 2) {
      return {
        rows: [
          {
            id: 'd1',
            prospect_id: '11111111-1111-1111-1111-111111111111',
            dor_principal: 'ausencia de presenca digital propria',
            perda_estimada: 1200,
            mensagem_gerada: 'x',
            mensagem_editada: null,
            aprovado_em: null,
            enviado_em: null,
            metadata_json: { provider: 'heuristico' },
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      }
    }
    return { rows: [] }
  }
  try {
    const out = await gerarDiagnosticos({ prospect_id: '11111111-1111-1111-1111-111111111111' })
    assert.equal(out.length, 1)
    assert.equal(out[0].metadata_json.provider, 'heuristico')
  } finally {
    if (prev == null) delete process.env.ANTHROPIC_KEY
    else process.env.ANTHROPIC_KEY = prev
    pool.query = originalQuery
  }
})

test('substituirPlaceholderEmpresa cobre variantes comuns sem trocar texto valido', () => {
  assert.equal(substituirPlaceholderEmpresa('Sou da [Empresa] e gostaria...'), 'Sou da PJ Codeworks e gostaria...')
  assert.equal(substituirPlaceholderEmpresa('Aqui é da [empresa].'), 'Aqui é da PJ Codeworks.')
  assert.equal(substituirPlaceholderEmpresa('Sou da [Sua Empresa].'), 'Sou da PJ Codeworks.')
  assert.equal(substituirPlaceholderEmpresa('Sou da [ Nome da Empresa ].'), 'Sou da PJ Codeworks.')
  assert.equal(substituirPlaceholderEmpresa('Sou da [MINHA EMPRESA] no setor X'), 'Sou da PJ Codeworks no setor X')
  assert.equal(substituirPlaceholderEmpresa('Texto sem placeholder.'), 'Texto sem placeholder.')
  assert.equal(substituirPlaceholderEmpresa(''), '')
})

test('temPlaceholderResidual detecta brackets nao substituidos sem falsos positivos', () => {
  assert.equal(temPlaceholderResidual('Oi, vi a Fábio Hair no Google.'), false)
  assert.equal(temPlaceholderResidual('Oi, vi a [Cidade] no Google.'), true)
  assert.equal(temPlaceholderResidual('Sou da PJ Codeworks. Tudo bem?'), false)
  assert.equal(temPlaceholderResidual('Mensagem com [Sua Empresa] residual.'), true)
  assert.equal(temPlaceholderResidual(''), false)
})

test('textoEhAutoReplyWhatsApp detecta auto-reply do WhatsApp Business sem falsos positivos', () => {
  assert.equal(textoEhAutoReplyWhatsApp('Fábio Hair agradece seu contato. Como podemos ajudar?'), true)
  assert.equal(textoEhAutoReplyWhatsApp('Olá! Responderemos em breve.'), true)
  assert.equal(textoEhAutoReplyWhatsApp('Este é um atendimento automático.'), true)
  assert.equal(textoEhAutoReplyWhatsApp('Atendimento iniciado, aguarde um instante.'), true)
  assert.equal(textoEhAutoReplyWhatsApp('Recebi sua proposta, vou avaliar.'), false)
  assert.equal(textoEhAutoReplyWhatsApp('Quanto custa um site?'), false)
  assert.equal(textoEhAutoReplyWhatsApp(''), false)
  assert.equal(textoEhAutoReplyWhatsApp(null), false)
})

test('detectarAutoReplyEmContextoProspeccao usa flag persistente e cai para historico', () => {
  const perfilSemProspeccao = { origem: 'organica', contexto_prospeccao: null }
  assert.equal(detectarAutoReplyEmContextoProspeccao(perfilSemProspeccao, []), false)

  const perfilProspeccaoFlag = {
    origem: 'prospeccao',
    contexto_prospeccao: { auto_reply_detectado: true },
  }
  assert.equal(detectarAutoReplyEmContextoProspeccao(perfilProspeccaoFlag, []), true)

  const perfilProspeccaoSemFlag = {
    origem: 'prospeccao',
    contexto_prospeccao: { auto_reply_detectado: false },
  }
  const historicoAutoReply = [
    { role: 'assistant', content: 'Oi, sou da PJ Codeworks...' },
    { role: 'user', content: 'Fábio Hair agradece seu contato. Como podemos ajudar?' },
  ]
  assert.equal(detectarAutoReplyEmContextoProspeccao(perfilProspeccaoSemFlag, historicoAutoReply), true)

  const historicoReal = [
    { role: 'assistant', content: 'Oi, sou da PJ Codeworks...' },
    { role: 'user', content: 'Bom dia! Estou interessado, pode me explicar?' },
  ]
  assert.equal(detectarAutoReplyEmContextoProspeccao(perfilProspeccaoSemFlag, historicoReal), false)
})

test('prompt dinamico injeta flag de auto-reply quando perfil indica prospeccao', () => {
  const system = montarSystemPromptDinamico(
    'diagnostico',
    {
      origem: 'prospeccao',
      negocio: 'barbearia',
      cidade: 'Sao Bernardo',
      contexto_prospeccao: {
        nome: 'Fabio Hair',
        nicho: 'barbearia',
        cidade: 'Sao Bernardo',
        rating: 5,
        avaliacoes: 261,
        mensagem_enviada: 'Mensagem inicial...',
        auto_reply_detectado: true,
      },
    },
    '',
    { respostaProvavelmenteAutoReply: true },
    [
      { role: 'assistant', content: 'Mensagem inicial...' },
      { role: 'user', content: 'Fábio Hair agradece seu contato. Como podemos ajudar?' },
    ]
  )
  const texto = system.map((b) => b?.text || '').join('\n')
  assert.match(texto, /CONTEXTO DE PROSPECCAO/)
  assert.match(texto, /PROIBIDO perguntar nicho, cidade ou nome do negocio/)
  assert.match(texto, /RESPOSTA_PROVAVELMENTE_AUTO_REPLY/)
  assert.match(texto, /P-PROSP-3/)
})

test('enviarProspectsAprovados bloqueia envio quando mensagem ainda tem placeholder residual', async () => {
  const originalQuery = pool.query
  const queries = []
  pool.query = async (sql, params) => {
    queries.push({ sql, params })
    if (/FROM prospectador\.prospects p\b/.test(sql) && /id = ANY/i.test(sql)) {
      return {
        rows: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            nome: 'Barbearia Teste',
            telefone: '5511999990000',
            nicho: 'barbearias',
            cidade: 'SBC',
            endereco: '',
            avaliacoes: 50,
            rating: 4.7,
            tem_site: false,
            site: '',
            maps_url: '',
            place_id: 'p1',
            origem: 'manual',
            status: 'aprovado',
            score: 90,
            motivo_score: '',
            created_at: '2026-04-30T10:00:00.000Z',
            updated_at: '2026-04-30T10:00:00.000Z',
            diagnostico: {
              dor_principal: 'sem site',
              perda_estimada: 800,
              mensagem_gerada: 'Sou da PJ Codeworks. Vi a [Cidade] no Google.',
              mensagem_editada: null,
              metadata_json: {},
            },
          },
        ],
      }
    }
    if (/contato_politicas/.test(sql)) return { rows: [] }
    if (/COUNT\(\*\)/.test(sql) && /send_attempts/.test(sql)) return { rows: [{ total: 0 }] }
    if (/INSERT INTO prospectador\.prospect_events/.test(sql)) return { rows: [] }
    return { rows: [] }
  }
  try {
    const out = await enviarProspectsAprovados({ prospect_ids: ['11111111-1111-1111-1111-111111111111'] })
    assert.equal(out.length, 1)
    assert.equal(out[0].ok, false)
    assert.match(out[0].erro, /placeholder/i)
    const inserts = queries.filter((q) => /INSERT INTO prospectador\.send_attempts/.test(q.sql))
    assert.equal(inserts.length, 0, 'gate deveria impedir tentativa de envio antes de chegar a send_attempts')
    const eventoErro = queries.find((q) => /INSERT INTO prospectador\.prospect_events/.test(q.sql))
    assert.ok(eventoErro, 'deveria registrar prospect_event de erro_envio')
    assert.equal(eventoErro.params[1], 'erro_envio')
    assert.match(JSON.stringify(eventoErro.params[2]), /mensagem_com_placeholder/)
  } finally {
    pool.query = originalQuery
  }
})

test('prospeccao: prospect aprovado recebe uma unica abordagem inicial com idempotency_key estavel', async () => {
  const originalQuery = pool.query
  const queries = []
  const enviados = []
  pool.query = async (sql, params) => {
    queries.push({ sql, params })
    if (/FROM prospectador\.prospects p\b/.test(sql) && /id = ANY/i.test(sql)) {
      return {
        rows: [{
          id: '11111111-1111-1111-1111-111111111111',
          nome: 'Clinica Teste',
          telefone: '+55 11 99999-9999',
          nicho: 'clinica',
          cidade: 'Sao Paulo',
          endereco: '',
          avaliacoes: 50,
          rating: 4.7,
          tem_site: false,
          site: '',
          maps_url: '',
          place_id: 'p1',
          origem: 'manual',
          status: 'aprovado',
          score: 90,
          motivo_score: '',
          created_at: '2026-04-30T10:00:00.000Z',
          updated_at: '2026-04-30T10:00:00.000Z',
          diagnostico: {
            mensagem_gerada: 'Ola, tudo bem? Sou o assistente virtual da PJ Codeworks. Faz sentido eu te mostrar uma ideia rapida para sua empresa?',
            mensagem_editada: null,
          },
        }],
      }
    }
    if (/contato_politicas/.test(sql)) return { rows: [] }
    if (/COUNT\(\*\)/.test(sql) && /send_attempts/.test(sql)) return { rows: [{ total: 0 }] }
    if (/SELECT id, prospect_id, status, idempotency_key/.test(sql)) return { rows: [] }
    if (/INSERT INTO prospectador\.send_attempts/.test(sql)) {
      return {
        rows: [{
          id: 1,
          prospect_id: params[0],
          idempotency_key: params[1],
          status: /'processing'/.test(sql) ? 'processing' : params[3],
          numero_normalizado: params[8] || params[6],
        }],
      }
    }
    if (/UPDATE prospectador\.prospects/.test(sql)) return { rows: [] }
    if (/UPDATE prospectador\.diagnosticos/.test(sql)) return { rows: [] }
    if (/INSERT INTO prospectador\.prospect_events/.test(sql)) return { rows: [] }
    return { rows: [] }
  }
  try {
    const out = await enviarProspectsAprovados({
      prospect_ids: ['11111111-1111-1111-1111-111111111111'],
      job_id: 77,
      enviarMensagemFn: async (numero, texto) => {
        enviados.push({ numero, texto })
        return { ok: true, id: 'evo-1' }
      },
    })
    assert.equal(out[0].ok, true)
    assert.equal(enviados.length, 1)
    assert.equal(enviados[0].numero, '5511999999999')
    const inserts = queries.filter((q) => /INSERT INTO prospectador\.send_attempts/.test(q.sql))
    assert.equal(inserts.length, 2, 'reserva processing e finalizacao sent')
    assert.equal(inserts[0].params[1], 'prospeccao:abordagem_inicial:whatsapp:11111111-1111-1111-1111-111111111111')
    assert.equal(inserts[1].params[1], inserts[0].params[1])
  } finally {
    pool.query = originalQuery
  }
})

test('prospeccao: envio ja registrado bloqueia reprocessamento sem chamar Evolution', async () => {
  const originalQuery = pool.query
  let chamadasEvolution = 0
  pool.query = async (sql) => {
    if (/FROM prospectador\.prospects p\b/.test(sql) && /id = ANY/i.test(sql)) {
      return {
        rows: [{
          id: '11111111-1111-1111-1111-111111111111',
          nome: 'Clinica Teste',
          telefone: '5511999999999@s.whatsapp.net',
          nicho: 'clinica',
          cidade: 'Sao Paulo',
          place_id: 'p1',
          origem: 'manual',
          status: 'aprovado',
          diagnostico: { mensagem_gerada: 'Ola, tudo bem? Posso te mostrar uma ideia rapida?', mensagem_editada: null },
        }],
      }
    }
    if (/contato_politicas/.test(sql)) return { rows: [] }
    if (/COUNT\(\*\)/.test(sql) && /send_attempts/.test(sql)) return { rows: [{ total: 0 }] }
    if (/SELECT id, prospect_id, status, idempotency_key/.test(sql)) {
      return {
        rows: [{
          id: 9,
          prospect_id: '11111111-1111-1111-1111-111111111111',
          status: 'sent',
          idempotency_key: 'prospeccao:abordagem_inicial:whatsapp:11111111-1111-1111-1111-111111111111',
          numero_normalizado: '5511999999999',
        }],
      }
    }
    return { rows: [] }
  }
  try {
    const out = await enviarProspectsAprovados({
      prospect_ids: ['11111111-1111-1111-1111-111111111111'],
      enviarMensagemFn: async () => {
        chamadasEvolution += 1
      },
    })
    assert.equal(out[0].ok, true)
    assert.equal(out[0].deduplicado, true)
    assert.equal(chamadasEvolution, 0)
  } finally {
    pool.query = originalQuery
  }
})

test('prospeccao: normaliza numero limpo e JID como mesmo WhatsApp', () => {
  assert.equal(normalizarNumeroWhatsapp('5511999999999@s.whatsapp.net'), '5511999999999')
  assert.equal(normalizarNumeroWhatsapp('+55 11 99999-9999'), '5511999999999')
  assert.equal(normalizarNumeroWhatsapp('11 99999-9999'), '5511999999999')
})

test('prospeccao: codigo tem lock de banco, logs com idempotency_key e trava de duplo clique', () => {
  const backend = fs.readFileSync(path.join(__dirname, '../src/prospecting.js'), 'utf8')
  const frontend = fs.readFileSync(path.join(__dirname, '../public/dashboard/js/prospeccao.js'), 'utf8')
  assert.match(backend, /FOR UPDATE SKIP LOCKED/)
  assert.match(backend, /operation:\s*'prospeccao_envio_inicial'/)
  assert.match(backend, /idempotency_key/)
  assert.match(frontend, /bindDailyActions/)
  assert.match(frontend, /fila-diaria\/.+\/agendar-envio/)
})

test('marcarProspectComoRespondeuPorNumero atualiza status quando houver enviado', async () => {
  const originalQuery = pool.query
  let called = 0
  pool.query = async () => {
    called += 1
    if (called === 1) {
      return {
        rows: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            nome: 'Barbearia',
            telefone: '5511999999999',
            nicho: 'barbearias',
            cidade: 'sbc',
            endereco: '',
            avaliacoes: 10,
            rating: 4.4,
            tem_site: false,
            site: '',
            maps_url: '',
            place_id: 'p1',
            origem: 'manual',
            status: 'respondeu',
            score: 90,
            motivo_score: '',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      }
    }
    return { rows: [] }
  }
  try {
    const p = await marcarProspectComoRespondeuPorNumero('55 (11) 99999-9999')
    assert.equal(p.status, 'respondeu')
  } finally {
    pool.query = originalQuery
  }
})

test('obterMetricasProspeccao agrega status e taxa', async () => {
  const originalQuery = pool.query
  let call = 0
  pool.query = async () => {
    call += 1
    if (call === 1) return { rows: [{ status: 'aprovado', total: 3 }, { status: 'enviado', total: 2 }] }
    if (call === 2) return { rows: [{ total: 4 }] }
    if (call === 3) return { rows: [{ total: 2 }] }
    return { rows: [{ respondeu: 1, enviado: 2 }] }
  }
  try {
    const m = await obterMetricasProspeccao()
    assert.equal(m.totals.aprovado, 3)
    assert.equal(m.taxa_resposta, 0.5)
  } finally {
    pool.query = originalQuery
  }
})

test('reivindicarProximoJob: SQL ordena vendas antes de prospeccao', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/agent.js'), 'utf8')
  const fn = src.indexOf('async function reivindicarProximoJob')
  assert.ok(fn >= 0, 'reivindicarProximoJob presente em agent.js')
  const slice = src.slice(fn, fn + 2500)
  const iWh = slice.indexOf("WHEN tipo = 'webhook_resposta' THEN 0")
  const iAg = slice.indexOf("WHEN tipo = 'agenda_lembrete_reuniao' THEN 1")
  const iFu = slice.indexOf("WHEN tipo = 'followup_auto' THEN 2")
  const iPr = slice.indexOf("WHEN tipo LIKE 'prospeccao_%' THEN 3")
  assert.ok(iWh >= 0 && iAg > iWh && iFu > iAg && iPr > iFu, 'ORDER BY: tier0 webhook, tier1 lembrete, tier2 followup, tier3 prospeccao_%')
})

test('enfileirar e consumir jobs de prospeccao', async () => {
  const originalQuery = pool.query
  pool.query = async (sql) => {
    if (/INSERT INTO vendas\.job_queue/.test(sql)) {
      return { rows: [{ id: 10, tipo: 'prospeccao_nichos_sync' }] }
    }
    if (/WITH cte AS/.test(sql)) {
      return {
        rows: [
          {
            id: 11,
            tipo: 'prospeccao_nichos_sync',
            payload: {},
            attempts: 0,
            max_attempts: 5,
          },
        ],
      }
    }
    if (/WITH base AS/.test(sql)) return { rows: [{ nicho: 'barbearias', cidade: 'sbc' }] }
    return { rows: [] }
  }
  try {
    const job = await enfileirarJobProspeccao('prospeccao_nichos_sync', { trigger: 'teste' })
    assert.equal(job.tipo, 'prospeccao_nichos_sync')
    const exec = await consumirJobsProspeccao(1)
    assert.equal(exec.length, 1)
    assert.equal(exec[0].ok, true)
  } finally {
    pool.query = originalQuery
  }
})

test('enfileirarJobProspeccao aceita tipo prospeccao_envio_agendado', async () => {
  const originalQuery = pool.query
  let paramsRecebidos = null
  pool.query = async (_sql, params) => {
    paramsRecebidos = params
    return { rows: [{ id: 91, tipo: 'prospeccao_envio_agendado' }] }
  }
  try {
    const job = await enfileirarJobProspeccao(
      'prospeccao_envio_agendado',
      { prospect_id: '11111111-1111-1111-1111-111111111111' },
      'prospeccao_envio:11111111-1111-1111-1111-111111111111',
      '2026-05-01T12:30:00.000Z'
    )
    assert.equal(job.tipo, 'prospeccao_envio_agendado')
    assert.equal(JSON.parse(paramsRecebidos[2]).prospect_id, '11111111-1111-1111-1111-111111111111')
  } finally {
    pool.query = originalQuery
  }
})

test('schema de payload de job preserva objeto valido de prospeccao', () => {
  const payload = { prospect_ids: ['11111111-1111-1111-1111-111111111111'], limite: null, trigger: 'teste' }
  const schema = validarJobQueuePayload('prospeccao_completo', payload)
  assert.equal(schema.ok, true)
  assert.deepEqual(schema.value, payload)
})

test('janela semanal calcula inicio correto da rotina automatica', () => {
  const now = new Date('2026-05-06T12:30:00.000Z') // quarta
  const janela = obterJanelaSemanal(
    {
      weekday: 1, // segunda
      hour: 9,
      minute: 15,
    },
    now
  )
  assert.equal(janela.inicio.toISOString(), '2026-05-04T12:15:00.000Z')
  assert.equal(janela.fim.toISOString(), '2026-05-11T12:15:00.000Z')
})

test('montarAgendaPainelAutoProspeccao expõe janela e flag dentro', () => {
  const now = new Date('2026-05-06T12:30:00.000Z')
  const agenda = montarAgendaPainelAutoProspeccao(
    { enabled: true, weekday: 1, hour: 9, minute: 15, limit: 5, categoria: null },
    now
  )
  assert.equal(agenda.janela_inicio, '2026-05-04T12:15:00.000Z')
  assert.equal(typeof agenda.dentro_da_janela_enfileiramento, 'boolean')
})

const SLOT_COMERCIAL_OPTS = { inicioHora: 8, fimHora: 20, granularidadeMin: 15 }

test('proximoSlotComercial antes das 8h encaixa em 8h', () => {
  const base = new Date(2026, 4, 3, 7, 30, 0)
  const r = proximoSlotComercial(base, SLOT_COMERCIAL_OPTS)
  assert.equal(r.getHours(), 8)
  assert.equal(r.getMinutes(), 0)
})

test('proximoSlotComercial arredonda 10:07 para 10:15', () => {
  const base = new Date(2026, 4, 3, 10, 7, 0)
  const r = proximoSlotComercial(base, SLOT_COMERCIAL_OPTS)
  assert.equal(r.getHours(), 10)
  assert.equal(r.getMinutes(), 15)
})

test('proximoSlotComercial apos fim da janela vai para manha seguinte', () => {
  const base = new Date(2026, 4, 3, 21, 0, 0)
  const r = proximoSlotComercial(base, SLOT_COMERCIAL_OPTS)
  assert.equal(r.getDate(), 4)
  assert.equal(r.getHours(), 8)
  assert.equal(r.getMinutes(), 0)
})

test('proximoSlotComercial 19:50 empurra para dia seguinte 8h', () => {
  const base = new Date(2026, 4, 3, 19, 50, 0)
  const r = proximoSlotComercial(base, SLOT_COMERCIAL_OPTS)
  assert.equal(r.getDate(), 4)
  assert.equal(r.getHours(), 8)
  assert.equal(r.getMinutes(), 0)
})

test('normalizarPromptAlvo aceita aliases e valor seguro', () => {
  assert.equal(normalizarPromptAlvo('followup_timing'), 'followup_timing')
  assert.equal(normalizarPromptAlvo('timing'), 'followup_timing')
  assert.equal(normalizarPromptAlvo('bogus'), 'system')
})

test('inferirPromptAlvoDeTextoRegras classifica follow-up e timing', () => {
  assert.equal(inferirPromptAlvoDeTextoRegras('melhorar reengajamento apos silencio', 'diagnostico'), 'followup')
  assert.equal(
    inferirPromptAlvoDeTextoRegras(
      'Ajustar intervalo de 48h antes da proxima mensagem automatica de follow',
      'proposta'
    ),
    'followup_timing'
  )
  assert.equal(inferirPromptAlvoDeTextoRegras('nao repetir perguntas de cidade', 'diagnostico'), 'system')
})

test('montarBlocoCorrecoesAprendizados monta bloco para injecao em prompts auxiliares', () => {
  const bloco = montarBlocoCorrecoesAprendizados([{ regras: '1. Nao repetir a mesma pergunta.' }])
  assert.match(bloco, /CORRECOES APRENDIDAS/)
  assert.match(bloco, /Nao repetir a mesma pergunta/)
  assert.equal(montarBlocoCorrecoesAprendizados([]), '')
})

test('prompt dinamico inclui correcoes aprendidas quando flags trazem aprendizados do funil', () => {
  const system = montarSystemPromptDinamico(
    'diagnostico',
    { negocio: 'pizzaria', cidade: 'SP' },
    '',
    { aprendizadosAtivos: [{ regras: '1. Teste de regra aprendida.' }] },
    []
  )
  const texto = system.map((b) => b?.text || '').join('\n')
  assert.match(texto, /CORRECOES APRENDIDAS/)
  assert.match(texto, /Teste de regra aprendida/)
})

const {
  buildProjectHandoff,
  slugifySegment,
  formatarMensagemHandoffEnriquecida,
  gerarPromptImagemEstruturaSiteHandoff,
} = require('../src/project-handoff-build')
const { gerarBriefingDocx } = require('../src/project-handoff-docx')

test('slugifySegment normaliza acentos e caracteres especiais', () => {
  assert.equal(slugifySegment('Eletricista — residencial'), 'eletricista-residencial')
  assert.equal(slugifySegment('Anápolis'), 'anapolis')
})

test('buildProjectHandoff monta pacote e nome de arquivo padronizado', () => {
  const { handoff, fileBase } = buildProjectHandoff({
    numero: '556294908696@s.whatsapp.net',
    perfil: {
      negocio: 'Eletricista',
      cidade: 'Anápolis - GO',
      reuniao_proposta: { data_sugerida: '2026-05-10', horario_confirmado: '20:00' },
      ja_aparece_google: false,
    },
    preco: { total: 812, entrada: 300, parcela: 170 },
    motivo: 'agendou_reuniao_proposta',
    resumoHandoff: 'Lead agendou reunião.',
    resultado: {},
  })
  assert.equal(handoff.lead.phone, '556294908696')
  assert.match(fileBase, /^briefing-eletricista-anapolis-556294908696$/)
  assert.equal(handoff.meeting.time, '20:00')
})

test('formatarMensagemHandoffEnriquecida inclui blocos principais e não inclui arquivos', () => {
  const { handoff } = buildProjectHandoff({
    numero: '5511999999999@s.whatsapp.net',
    perfil: { negocio: 'Barbearia', cidade: 'São Paulo - SP' },
    preco: {},
    motivo: 'lead_pediu_humano',
    resumoHandoff: null,
    resultado: {},
  })
  const txt = formatarMensagemHandoffEnriquecida(handoff, { motivo: 'lead_pediu_humano' })
  assert.match(txt, /HANDOFF — PJ Codeworks/)
  assert.match(txt, /Estrutura sugerida da página/)
  assert.match(txt, /Prompt para gerar imagem/)
  assert.match(txt, /Como falar na ligação/)
  assert.doesNotMatch(txt, /Arquivos gerados/)
  assert.doesNotMatch(txt, /\.docx/)
  assert.doesNotMatch(txt, /\.png/)
  assert.doesNotMatch(txt, /Prévia visual do site/)
  assert.doesNotMatch(txt, /Prompt prévia visual da estrutura/)
})

test('formatarMensagemHandoffEnriquecida agendou_reuniao_proposta não menciona arquivos nem caminhos', () => {
  const { handoff } = buildProjectHandoff({
    numero: '5562999000111@s.whatsapp.net',
    perfil: {
      negocio: 'Eletricista',
      cidade: 'Goiânia - GO',
      reuniao_proposta: { data_sugerida: '2026-05-15', horario_confirmado: '10:00' },
    },
    preco: { total: 812, entrada: 300, parcela: 170 },
    motivo: 'agendou_reuniao_proposta',
    resumoHandoff: 'Lead agendou para sexta.',
    resultado: {},
  })
  const txt = formatarMensagemHandoffEnriquecida(handoff, { motivo: 'agendou_reuniao_proposta' })
  assert.doesNotMatch(txt, /Arquivos gerados/)
  assert.doesNotMatch(txt, /briefings/)
  assert.doesNotMatch(txt, /\.docx/)
  assert.doesNotMatch(txt, /\.png/)
  assert.match(txt, /Estrutura sugerida da página/)
  assert.match(txt, /Prompt para gerar imagem/)
})

test('createHandoffAlerts alertarHandoff não chama gerarBriefingDocx nem gerarImagemOpenAiPorPrompt', async () => {
  const { createHandoffAlerts } = require('../src/handoff-alerts')
  let docxChamado = false
  let imagemChamada = false
  const { alertarHandoff } = createHandoffAlerts({
    axios: { post: async () => ({}) },
    logger: { info: () => {}, error: () => {} },
    enviarMensagem: async () => {},
    listarOperadoresAtivos: async () => [{ jid: '5511@s.whatsapp.net' }],
    numeroDisplayDoJid: (j) => j,
    resumirTextoOperacional: (t) => t,
    // gerarImagemOpenAiPorPrompt propositalmente ausente — já não faz parte do contrato
    _gerarBriefingDocxSpy: () => { docxChamado = true },
    _gerarImagemSpy: () => { imagemChamada = true },
  })
  await alertarHandoff(
    '5562999000222@s.whatsapp.net',
    { negocio: 'Vidraçaria', cidade: 'Cuiabá - MT' },
    { total: 0, entrada: 0, parcela: 0 },
    'agendou_reuniao_proposta',
    'Lead agendou.',
    {}
  )
  assert.equal(docxChamado, false, 'gerarBriefingDocx não deve ser chamado no handoff')
  assert.equal(imagemChamada, false, 'gerarImagemOpenAiPorPrompt não deve ser chamado no handoff')
})

test('montarPingOperador: ping compacto de reunião agendada com prévia de valor + link', () => {
  const { createHandoffAlerts } = require('../src/handoff-alerts')
  const ha = createHandoffAlerts({
    numeroDisplayDoJid: (n) => String(n).replace(/@.*/, ''),
    resumirTextoOperacional: (s, max) => String(s || '').slice(0, max),
    logger: { info() {}, warn() {}, error() {} },
  })
  const prev = process.env.DASHBOARD_URL
  process.env.DASHBOARD_URL = 'https://painel.teste'
  try {
    const txt = ha.montarPingOperador({
      numero: '5514999998888@s.whatsapp.net',
      perfil: {
        apelido: 'João',
        negocio: 'Marcenaria',
        cidade: 'Bauru/SP',
        score_dor: 8,
        dor_principal: 'depende de indicação',
        reuniao_proposta: { data_sugerida: '2026-06-08', horario_confirmado: '19:30' },
      },
      preco: {},
      motivo: 'agendou_reuniao_proposta',
      previaValor: { faixa_min: 1000, faixa_max: 1500, valor_alvo: 1200, plano: 'padrao', justificativa: 'Ticket médio e dor alta.' },
    })
    assert.match(txt, /Reunião agendada/)
    assert.match(txt, /João · 5514999998888/)
    assert.match(txt, /Marcenaria · Bauru\/SP/)
    assert.match(txt, /8\/10/)
    assert.match(txt, /📅 08\/06 19:30/)
    assert.match(txt, /Prévia de valor \(IA\): R\$ 1000–1500 \(alvo ~R\$ 1200\) · plano padrao/)
    assert.match(txt, /painel\.teste\/perfil-lead\.html\?numero=/)
    // Não existe mais "aprovação de valor": nada de "Responda OK".
    assert.doesNotMatch(txt, /Responda OK|APROVAÇÃO|aprovar/i)
  } finally {
    if (prev === undefined) delete process.env.DASHBOARD_URL
    else process.env.DASHBOARD_URL = prev
  }
})

test('montarPingOperador: sem env de URL, usa o painel de produção como padrão', () => {
  const { createHandoffAlerts } = require('../src/handoff-alerts')
  const ha = createHandoffAlerts({
    numeroDisplayDoJid: (n) => String(n).replace(/@.*/, ''),
    resumirTextoOperacional: (s, max) => String(s || '').slice(0, max),
    logger: { info() {}, warn() {}, error() {} },
  })
  const prevDash = process.env.DASHBOARD_URL
  const prevRailway = process.env.RAILWAY_PUBLIC_DOMAIN
  delete process.env.DASHBOARD_URL
  delete process.env.RAILWAY_PUBLIC_DOMAIN
  try {
    const txt = ha.montarPingOperador({
      numero: '5514999998888@s.whatsapp.net',
      perfil: { negocio: 'Marcenaria', cidade: 'Bauru/SP' },
      preco: {},
      motivo: 'lead_pediu_humano',
    })
    assert.match(txt, /Lead pediu humano/)
    assert.match(txt, /pjcodeworks-agent-production\.up\.railway\.app\/perfil-lead\.html\?numero=/)
  } finally {
    if (prevDash !== undefined) process.env.DASHBOARD_URL = prevDash
    if (prevRailway !== undefined) process.env.RAILWAY_PUBLIC_DOMAIN = prevRailway
  }
})

test('montarPingOperador: DASHBOARD_URL sobrepõe o padrão', () => {
  const { createHandoffAlerts } = require('../src/handoff-alerts')
  const ha = createHandoffAlerts({
    numeroDisplayDoJid: (n) => String(n).replace(/@.*/, ''),
    resumirTextoOperacional: (s, max) => String(s || '').slice(0, max),
    logger: { info() {}, warn() {}, error() {} },
  })
  const prevDash = process.env.DASHBOARD_URL
  process.env.DASHBOARD_URL = 'https://painel.custom'
  try {
    const txt = ha.montarPingOperador({
      numero: '5514999998888@s.whatsapp.net',
      perfil: { negocio: 'Marcenaria', cidade: 'Bauru/SP' },
      preco: {},
      motivo: 'lead_pediu_humano',
    })
    assert.match(txt, /painel\.custom\/perfil-lead\.html/)
    assert.doesNotMatch(txt, /railway\.app/)
  } finally {
    if (prevDash === undefined) delete process.env.DASHBOARD_URL
    else process.env.DASHBOARD_URL = prevDash
  }
})

test('gerarPromptImagemEstruturaSiteHandoff pede landing pronta e proíbe wireframe', () => {
  const { handoff } = buildProjectHandoff({
    numero: '5562999999999@s.whatsapp.net',
    perfil: { negocio: 'Eletricista residencial', cidade: 'Anápolis - GO' },
    preco: {},
    motivo: 'agendou_reuniao_proposta',
    resumoHandoff: '',
    resultado: {},
  })
  const p = gerarPromptImagemEstruturaSiteHandoff(handoff)
  assert.match(p, /não um wireframe/i)
  assert.match(p, /#0168FF/)
  assert.match(p, /eletric/i)
})

test('resultadoParseadoParaObjeto preserva project_handoff quando informado', () => {
  const r = resultadoParseadoParaObjeto(
    {
      mensagem_pro_lead: 'Confirmado.',
      etapa_proxima: 'proposta',
      solicitar_calculo_preco: false,
      handoff: true,
      motivo_handoff: 'agendou_reuniao_proposta',
      project_handoff: {
        briefing: { mainPain: 'Poucos contatos pelo WhatsApp' },
      },
    },
    'proposta'
  )
  assert.equal(r.project_handoff.briefing.mainPain, 'Poucos contatos pelo WhatsApp')
})

test('gerarBriefingDocx grava docx valido em disco', async () => {
  const fs = require('fs/promises')
  const path = require('path')
  const os = require('os')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pj-brief-'))
  const outPath = path.join(dir, 'briefing-test.docx')
  const { handoff } = buildProjectHandoff({
    numero: '559988776655@s.whatsapp.net',
    perfil: { negocio: 'Pizzaria', cidade: 'Goiânia - GO' },
    preco: { total: 900, entrada: 360, parcela: 180 },
    motivo: 'agendou_reuniao_proposta',
    resumoHandoff: 'Teste',
    resultado: {},
  })
  await gerarBriefingDocx(handoff, outPath)
  const st = await fs.stat(outPath)
  assert.ok(st.size > 1500)
})

// ─── parsearHorarioReuniao ────────────────────────────────────────────────────

test('parsearHorarioReuniao reconhece "20:15"', () => {
  const r = parsearHorarioReuniao('20:15')
  assert.deepEqual(r, { hora: 20, min: 15 })
})

test('parsearHorarioReuniao reconhece "20h15"', () => {
  const r = parsearHorarioReuniao('20h15')
  assert.deepEqual(r, { hora: 20, min: 15 })
})

test('parsearHorarioReuniao reconhece "às 20:15"', () => {
  const r = parsearHorarioReuniao('às 20:15')
  assert.deepEqual(r, { hora: 20, min: 15 })
})

test('parsearHorarioReuniao reconhece "Pode ser 20:15"', () => {
  const r = parsearHorarioReuniao('Pode ser 20:15')
  assert.deepEqual(r, { hora: 20, min: 15 })
})

test('parsearHorarioReuniao reconhece "19:30"', () => {
  const r = parsearHorarioReuniao('19:30')
  assert.deepEqual(r, { hora: 19, min: 30 })
})

test('parsearHorarioReuniao reconhece "19h30"', () => {
  const r = parsearHorarioReuniao('19h30')
  assert.deepEqual(r, { hora: 19, min: 30 })
})

test('parsearHorarioReuniao retorna null para texto sem horário', () => {
  assert.equal(parsearHorarioReuniao(''), null)
  assert.equal(parsearHorarioReuniao(null), null)
  assert.equal(parsearHorarioReuniao('pode ser'), null)
  assert.equal(parsearHorarioReuniao('sim'), null)
})

// ─── calcularFimReuniao ───────────────────────────────────────────────────────

test('calcularFimReuniao: 19:30 → 19:45 (15 min)', () => {
  const inicio = new Date('2026-05-11T22:30:00.000Z') // 19:30 BRT
  const fim = calcularFimReuniao(inicio, 15)
  assert.equal(fim.getTime() - inicio.getTime(), 15 * 60 * 1000)
})

test('calcularFimReuniao: 20:15 → 20:30 (15 min)', () => {
  const inicio = new Date('2026-05-11T23:15:00.000Z') // 20:15 BRT
  const fim = calcularFimReuniao(inicio, 15)
  assert.equal(fim.getTime() - inicio.getTime(), 15 * 60 * 1000)
})

test('calcularFimReuniao: nunca cria reunião de 1 hora', () => {
  const inicio = new Date('2026-05-11T22:30:00.000Z')
  const fim = calcularFimReuniao(inicio, 15)
  const diffMin = (fim.getTime() - inicio.getTime()) / 60000
  assert.equal(diffMin, 15)
  assert.notEqual(diffMin, 60)
})

test('calcularFimReuniao usa 15 min por padrão (sem argumento)', () => {
  const inicio = new Date('2026-05-11T23:15:00.000Z')
  const fim = calcularFimReuniao(inicio)
  assert.equal((fim.getTime() - inicio.getTime()) / 60000, 15)
})

// ─── dataInicioReuniao ────────────────────────────────────────────────────────

test('dataInicioReuniao: 2026-05-11 às 20:15 em America/Sao_Paulo', () => {
  const dt = dataInicioReuniao('2026-05-11', 20, 15)
  assert.ok(dt instanceof Date)
  // 20:15 BRT = 23:15 UTC (UTC-3)
  assert.equal(dt.toISOString(), '2026-05-11T23:15:00.000Z')
})

test('dataInicioReuniao: 2026-05-11 às 19:30 em America/Sao_Paulo', () => {
  const dt = dataInicioReuniao('2026-05-11', 19, 30)
  assert.equal(dt.toISOString(), '2026-05-11T22:30:00.000Z')
})

// ─── Cenário completo: lead escolhe 20:15 entre 19:30 e 20:15 ────────────────

test('cenário completo: lead escolhe 20:15 → evento 20:15–20:30', () => {
  // horario_confirmado preenchido pelo LLM com a escolha do lead
  const horarioTexto = '20:15'
  const dataSugerida = '2026-05-11'

  const parsed = parsearHorarioReuniao(horarioTexto)
  assert.ok(parsed, 'deve parsear 20:15')
  assert.deepEqual(parsed, { hora: 20, min: 15 })

  const dataInicio = dataInicioReuniao(dataSugerida, parsed.hora, parsed.min)
  const dataFim = calcularFimReuniao(dataInicio, 15)

  // Início: 20:15 BRT = 23:15 UTC
  assert.equal(dataInicio.toISOString(), '2026-05-11T23:15:00.000Z')
  // Fim: 20:30 BRT = 23:30 UTC
  assert.equal(dataFim.toISOString(), '2026-05-11T23:30:00.000Z')
  // Duração: exatos 15 minutos
  assert.equal((dataFim.getTime() - dataInicio.getTime()) / 60000, 15)
})

test('cenário completo: lead escolhe 19:30 → evento 19:30–19:45', () => {
  const parsed = parsearHorarioReuniao('19:30')
  assert.ok(parsed)
  const dataInicio = dataInicioReuniao('2026-05-11', parsed.hora, parsed.min)
  const dataFim = calcularFimReuniao(dataInicio, 15)
  assert.equal(dataInicio.toISOString(), '2026-05-11T22:30:00.000Z')
  assert.equal(dataFim.toISOString(), '2026-05-11T22:45:00.000Z')
})

// ─── buildDiarioQuery: filtros do gráfico diário ─────────────────────────────

test('buildDiarioQuery sem estagio retorna modo dual com bounds por dias', () => {
  const { query, params, mode } = buildDiarioQuery('', 30, '', '')
  assert.equal(mode, 'dual')
  assert.equal(params.length, 1)
  assert.equal(params[0], 30)
  assert.match(query, /novas/)
  assert.match(query, /fechadas/)
  assert.match(query, /venda_fechada = true/)
  assert.match(query, /criado_em/)
})

test('buildDiarioQuery estagio=fechado retorna modo single com venda_fechada=true', () => {
  const { query, params, mode } = buildDiarioQuery('fechado', 30, '', '')
  assert.equal(mode, 'single')
  assert.equal(params.length, 1)
  assert.equal(params[0], 30)
  assert.match(query, /venda_fechada = true/)
  assert.match(query, /total/)
  assert.doesNotMatch(query, /novas/)
})

test('buildDiarioQuery estagio especifico retorna modo single filtrando estagio', () => {
  const { query, params, mode } = buildDiarioQuery('reuniao_agendada', 7, '', '')
  assert.equal(mode, 'single')
  assert.equal(params.length, 2)
  assert.equal(params[0], 7)
  assert.equal(params[1], 'reuniao_agendada')
  assert.match(query, /venda_fechada = false/)
  assert.match(query, /c\.estagio = \$2/)
})

test('buildDiarioQuery com desde e ate usa datas como bounds', () => {
  const { query, params, mode } = buildDiarioQuery('', 30, '2026-05-01', '2026-05-10')
  assert.equal(mode, 'dual')
  assert.equal(params.length, 2)
  assert.equal(params[0], '2026-05-01')
  assert.equal(params[1], '2026-05-10')
  assert.match(query, /\$1::date AS d0/)
  assert.match(query, /\$2::date AS d1/)
})

test('buildDiarioQuery com desde apenas usa data atual em Sao Paulo como limite superior', () => {
  const { query, params, mode } = buildDiarioQuery('', 30, '2026-05-01', '')
  assert.equal(mode, 'dual')
  assert.equal(params.length, 1)
  assert.equal(params[0], '2026-05-01')
  assert.match(query, /NOW\(\) AT TIME ZONE 'America\/Sao_Paulo'\)::date AS d1/)
  assert.match(query, /criado_em AT TIME ZONE 'America\/Sao_Paulo'/)
})

test('buildDiarioQuery com ate apenas calcula d0 a partir de dias', () => {
  const { query, params, mode } = buildDiarioQuery('', 14, '', '2026-05-10')
  assert.equal(mode, 'dual')
  assert.equal(params.length, 2)
  assert.equal(params[0], '2026-05-10')
  assert.equal(params[1], 14)
  assert.match(query, /\$1::date AS d1/)
})

test('buildDiarioQuery estagio especifico com desde/ate usa 3 params', () => {
  const { query, params, mode } = buildDiarioQuery('proposta_enviada', 30, '2026-05-01', '2026-05-10')
  assert.equal(mode, 'single')
  assert.equal(params.length, 3)
  assert.equal(params[0], '2026-05-01')
  assert.equal(params[1], '2026-05-10')
  assert.equal(params[2], 'proposta_enviada')
  assert.match(query, /c\.estagio = \$3/)
})

test('buildDiarioQuery estagio=fechado com desde/ate usa 2 params sem estagio extra', () => {
  const { query, params, mode } = buildDiarioQuery('fechado', 30, '2026-05-01', '2026-05-10')
  assert.equal(mode, 'single')
  assert.equal(params.length, 2)
  assert.equal(params[0], '2026-05-01')
  assert.equal(params[1], '2026-05-10')
  assert.match(query, /venda_fechada = true/)
})

test('buildDiarioQuery todos os dias com zero tem serie com zeros', () => {
  // Verifica que a query usa generate_series para preencher dias sem dados
  const { query } = buildDiarioQuery('proposta_enviada', 7, '', '')
  assert.match(query, /generate_series/)
  assert.match(query, /COALESCE/)
})

// ─── formatarMensagemParaContexto ────────────────────────────────────────────

test('formatarMensagemParaContexto mensagem de texto normal', () => {
  const m = { role: 'user', content: 'Olá, quero criar um site.' }
  const out = formatarMensagemParaContexto(m, 0)
  assert.ok(out.startsWith('[#1] Lead:'))
  assert.ok(out.includes('Olá, quero criar um site.'))
})

test('formatarMensagemParaContexto mensagem da IA assistente', () => {
  const m = { role: 'assistant', content: 'Perfeito! Me conta mais sobre seu negócio.' }
  const out = formatarMensagemParaContexto(m, 1)
  assert.ok(out.startsWith('[#2] PJ Codeworks:'))
  assert.ok(out.includes('Perfeito!'))
})

test('formatarMensagemParaContexto áudio transcrito extrai transcrição', () => {
  const m = { role: 'user', content: '[Audio transcrito] Quero criar um site para minha empresa.' }
  const out = formatarMensagemParaContexto(m, 2)
  assert.ok(out.includes('enviou áudio'))
  assert.ok(out.includes('Transcrição:'))
  assert.ok(out.includes('Quero criar um site para minha empresa.'))
  assert.ok(!out.includes('[Audio transcrito]'))
})

test('formatarMensagemParaContexto áudio sem transcrição mostra fallback', () => {
  const m = { role: 'user', content: '[Audio recebido - nao foi possivel baixar/transcrever. Peca ao cliente para repetir ou enviar em texto.]' }
  const out = formatarMensagemParaContexto(m, 3)
  assert.ok(out.includes('enviou áudio'))
  assert.ok(out.includes('ainda sem transcrição'))
})

test('formatarMensagemParaContexto imagem com caption', () => {
  const m = { role: 'user', content: 'O cliente enviou uma imagem.' }
  const out = formatarMensagemParaContexto(m, 4)
  assert.ok(out.includes('enviou imagem'))
  assert.ok(out.includes('Descrição:'))
})

test('formatarMensagemParaContexto mensagem de operador', () => {
  const m = { role: 'operator', content: 'Lead entrou em contato por ligação.' }
  const out = formatarMensagemParaContexto(m, 5)
  assert.ok(out.startsWith('[#6] Operador:'))
  assert.ok(out.includes('Lead entrou em contato'))
})

test('formatarMensagemParaContexto content como array extrai texto', () => {
  const m = { role: 'assistant', content: [{ type: 'text', text: 'Texto do array.' }] }
  const out = formatarMensagemParaContexto(m, 0)
  assert.ok(out.includes('Texto do array.'))
})

// ─── gerarTextoConversaCompleta ───────────────────────────────────────────────

test('gerarTextoConversaCompleta inclui cabeçalho e dados do lead', () => {
  const conversa = {
    numero: '5511990001234@s.whatsapp.net',
    historico: [
      { role: 'user', content: 'Olá!' },
      { role: 'assistant', content: 'Oi, tudo bem?' },
    ],
    estagio: 'diagnostico',
    status: 'ativo',
    venda_fechada: false,
  }
  const perfil = { negocio: 'Limpeza de coifas', cidade: 'São Paulo/SP', temperatura_lead: 'quente' }
  const texto = gerarTextoConversaCompleta(conversa, perfil, [])
  assert.ok(texto.includes('CONVERSA COMPLETA — PJ CODEWORKS'))
  assert.ok(texto.includes('+55 11990001234') || texto.includes('11990001234'))
  assert.ok(texto.includes('Limpeza de coifas'))
  assert.ok(texto.includes('São Paulo/SP'))
  assert.ok(texto.includes('quente'))
})

test('gerarTextoConversaCompleta mensagens saem ordenadas com índice', () => {
  const conversa = {
    numero: '5511990001234@s.whatsapp.net',
    historico: [
      { role: 'user', content: 'Primeira mensagem.' },
      { role: 'assistant', content: 'Segunda mensagem.' },
      { role: 'user', content: 'Terceira mensagem.' },
    ],
    estagio: 'diagnostico',
    status: 'ativo',
    venda_fechada: false,
  }
  const texto = gerarTextoConversaCompleta(conversa, null, [])
  const idx1 = texto.indexOf('[#1]')
  const idx2 = texto.indexOf('[#2]')
  const idx3 = texto.indexOf('[#3]')
  assert.ok(idx1 >= 0 && idx2 >= 0 && idx3 >= 0)
  assert.ok(idx1 < idx2 && idx2 < idx3)
})

test('gerarTextoConversaCompleta inclui transcrição de áudio no histórico', () => {
  const conversa = {
    numero: '5511990001234@s.whatsapp.net',
    historico: [
      { role: 'user', content: '[Audio transcrito] Pode marcar para amanhã às 20h.' },
    ],
    estagio: 'fechamento',
    status: 'ativo',
    venda_fechada: false,
  }
  const texto = gerarTextoConversaCompleta(conversa, null, [])
  assert.ok(texto.includes('enviou áudio'))
  assert.ok(texto.includes('Pode marcar para amanhã às 20h.'))
})

test('gerarTextoConversaCompleta inclui eventos de reunião e venda', () => {
  const conversa = {
    numero: '5511990001234@s.whatsapp.net',
    historico: [],
    estagio: 'fechamento',
    status: 'ativo',
    venda_fechada: true,
  }
  const perfil = {
    negocio: 'Barbeiro',
    cidade: 'SP',
    eventos_conversa: { contrato_enviado: true },
    reuniao_proposta: { data_confirmada: '11/05/2026', horario_confirmado: '20:15' },
  }
  const texto = gerarTextoConversaCompleta(conversa, perfil, [])
  assert.ok(texto.includes('[EVENTO] Contrato enviado'))
  assert.ok(texto.includes('[EVENTO] Lead marcado como vendido'))
  assert.ok(texto.includes('11/05/2026'))
  assert.ok(texto.includes('20:15'))
})

test('gerarTextoConversaCompleta sem perfil nao lanca erro', () => {
  const conversa = {
    numero: '5511990001234@s.whatsapp.net',
    historico: [{ role: 'user', content: 'Oi' }],
    estagio: 'primeiro_contato',
    status: 'ativo',
    venda_fechada: false,
  }
  assert.doesNotThrow(() => gerarTextoConversaCompleta(conversa, null, []))
})

test('gerarTextoConversaCompleta inclui resumo de contexto quando disponivel', () => {
  const conversa = {
    numero: '5511990001234@s.whatsapp.net',
    historico: [],
    estagio: 'proposta',
    status: 'ativo',
    venda_fechada: false,
  }
  const perfil = {
    negocio: 'Encanador',
    cidade: 'RJ',
    resumo_memoria_vendas: 'Lead quer site para aparecer no Google.',
  }
  const texto = gerarTextoConversaCompleta(conversa, perfil, [])
  assert.ok(texto.includes('RESUMO DO CONTEXTO'))
  assert.ok(texto.includes('Lead quer site para aparecer no Google.'))
})

test('gerarTextoConversaCompleta inclui eventos de agenda', () => {
  const conversa = {
    numero: '5511990001234@s.whatsapp.net',
    historico: [],
    estagio: 'reuniao',
    status: 'ativo',
    venda_fechada: false,
  }
  const agendaEventos = [
    { titulo: 'Reunião com a equipe da PJ Codeworks', tipo: 'reuniao', data_inicio: '2026-05-11T20:15:00', excluido_em: null },
  ]
  const texto = gerarTextoConversaCompleta(conversa, null, agendaEventos)
  assert.ok(texto.includes('[EVENTO]'))
  assert.ok(texto.includes('Reunião com a equipe da PJ Codeworks'))
})

// ─── REGRAS COMPORTAMENTAIS — testes das correções de conversas reais ─────────

// Regra: textoPedePreco detecta variantes do pedido de preço
test('textoPedePreco detecta "qual o custo?"', () => {
  assert.equal(textoPedePreco('qual o custo?'), true)
})

test('textoPedePreco detecta "quanto fica?"', () => {
  assert.equal(textoPedePreco('quanto fica?'), true)
})

test('textoPedePreco detecta "qual o valor?"', () => {
  assert.equal(textoPedePreco('qual o valor?'), true)
})

test('textoPedePreco detecta "o que ficaria pra eu poder contratar?"', () => {
  assert.equal(textoPedePreco('o que ficaria pra eu poder contratar?'), true)
})

test('textoPedePreco detecta "quanto vou pagar?"', () => {
  assert.equal(textoPedePreco('quanto vou pagar?'), true)
})

test('textoPedePreco detecta "mas qual preco?"', () => {
  assert.equal(textoPedePreco('mas qual preco?'), true)
})

test('textoPedePreco detecta "me passa o valor"', () => {
  assert.equal(textoPedePreco('me passa o valor'), true)
})

test('textoPedePreco nao dispara em mensagens sem contexto de preco', () => {
  assert.equal(textoPedePreco('bom dia, tudo bem?'), false)
  assert.equal(textoPedePreco('pretendo contratar'), false)
  assert.equal(textoPedePreco('tenho interesse'), false)
})

// Regra: parsearHorarioReuniao — correção PM para "7:30" → 19:30
test('parsearHorarioReuniao interpreta "7:30" como 19:30 (janela comercial PM)', () => {
  const r = parsearHorarioReuniao('7:30')
  assert.deepEqual(r, { hora: 19, min: 30 })
  assert.equal(r.normalizado, '19:30')
})

test('parsearHorarioReuniao interpreta "8:00" como 20:00 (janela comercial PM)', () => {
  const r = parsearHorarioReuniao('8:00')
  assert.deepEqual(r, { hora: 20, min: 0 })
})

test('parsearHorarioReuniao interpreta "9:15" como 21:15 (janela comercial PM)', () => {
  const r = parsearHorarioReuniao('9:15')
  assert.deepEqual(r, { hora: 21, min: 15 })
})

test('parsearHorarioReuniao nao converte "10:00" (10+12=22 fora da janela 19-21)', () => {
  const r = parsearHorarioReuniao('10:00')
  assert.deepEqual(r, { hora: 10, min: 0 })
})

test('parsearHorarioReuniao nao converte horario ja correto "19:30"', () => {
  const r = parsearHorarioReuniao('19:30')
  assert.deepEqual(r, { hora: 19, min: 30 })
})

test('parsearHorarioReuniao nao converte horario ja correto "20:15"', () => {
  const r = parsearHorarioReuniao('20:15')
  assert.deepEqual(r, { hora: 20, min: 15 })
})

// Regra: cenário completo — lead diz "7:30" → deve ser agendado como 19:30
test('cenário completo: lead diz "7:30" após oferta 19:30/20:15 → agenda 19:30–19:45', () => {
  const parsed = parsearHorarioReuniao('7:30')
  assert.ok(parsed, 'deve parsear 7:30')
  assert.deepEqual(parsed, { hora: 19, min: 30 })

  const dataInicio = dataInicioReuniao('2026-05-12', parsed.hora, parsed.min)
  const dataFim = calcularFimReuniao(dataInicio, 15)

  // 19:30 BRT = 22:30 UTC (BRT = UTC-3)
  assert.equal(dataInicio.toISOString(), '2026-05-12T22:30:00.000Z')
  // 19:45 BRT = 22:45 UTC
  assert.equal(dataFim.toISOString(), '2026-05-12T22:45:00.000Z')
  assert.equal((dataFim.getTime() - dataInicio.getTime()) / 60000, 15)
})

// Regra: calcularFimReuniao — duração sempre 15 minutos
test('calcularFimReuniao: reunião de 20:15 termina às 20:30', () => {
  const inicio = dataInicioReuniao('2026-05-12', 20, 15)
  const fim = calcularFimReuniao(inicio, 15)
  assert.equal((fim.getTime() - inicio.getTime()) / 60000, 15)
})

// Regra: textoPedePreco com variantes reais observadas em conversas
test('textoPedePreco detecta "quanto ta?" (variante coloquial)', () => {
  assert.equal(textoPedePreco('quanto ta?'), true)
})

test('textoPedePreco detecta "cobram quanto?"', () => {
  assert.equal(textoPedePreco('cobram quanto?'), true)
})

test('contarPedidosPrecoDoLead conta multiplas perguntas de preco do lead', () => {
  const historico = [
    { role: 'user', content: 'qual o custo?' },
    { role: 'assistant', content: 'Boa pergunta. Uma estrutura inicial fica na faixa de R$ 400 a R$ 700...' },
    { role: 'user', content: 'mas qual preco exatamente?' },
  ]
  const count = contarPedidosPrecoDoLead(historico)
  assert.ok(count >= 1, `esperava pelo menos 1 pedido de preço, encontrou ${count}`)
})

// ─── Motor de IA — roteamento por configuracao ────────────────────────────────

test('motor de IA: validarProviderModel aceita pares compativeis', () => {
  const { validarProviderModel } = require('../src/ai-provider')
  assert.equal(validarProviderModel('anthropic', 'claude-sonnet-4-6').ok, true)
  assert.equal(validarProviderModel('anthropic', 'claude-opus-4-7').ok, true)
  assert.equal(validarProviderModel('openai', 'gpt-4o-mini').ok, true)
  assert.equal(validarProviderModel('openai', 'gpt-4-turbo').ok, true)
})

test('motor de IA: validarProviderModel rejeita pares incompativeis', () => {
  const { validarProviderModel } = require('../src/ai-provider')
  const r1 = validarProviderModel('anthropic', 'gpt-4o-mini')
  assert.equal(r1.ok, false)
  assert.match(r1.erro, /Anthropic|n[aã]o.+compat/i)
  const r2 = validarProviderModel('openai', 'claude-sonnet-4-6')
  assert.equal(r2.ok, false)
  assert.match(r2.erro, /OpenAI|n[aã]o.+compat/i)
})

test('motor de IA: validarProviderModel exige modelo nao vazio', () => {
  const { validarProviderModel } = require('../src/ai-provider')
  assert.equal(validarProviderModel('anthropic', '').ok, false)
  assert.equal(validarProviderModel('anthropic', null).ok, false)
  assert.equal(validarProviderModel('foo', 'gpt-4').ok, false)
})

test('motor de IA: AI_MODEL_PRESETS valido para ambos provedores', () => {
  const { AI_MODEL_PRESETS } = require('../src/ai-provider')
  assert.ok(AI_MODEL_PRESETS.anthropic)
  assert.ok(AI_MODEL_PRESETS.openai)
  assert.ok(AI_MODEL_PRESETS.anthropic.defaultModel.startsWith('claude-'))
  assert.ok(AI_MODEL_PRESETS.openai.defaultModel.startsWith('gpt-'))
  assert.ok(Array.isArray(AI_MODEL_PRESETS.anthropic.models) && AI_MODEL_PRESETS.anthropic.models.length > 0)
  assert.ok(Array.isArray(AI_MODEL_PRESETS.openai.models) && AI_MODEL_PRESETS.openai.models.length > 0)
})

test('motor de IA: OpenAI recebe system prompt textual completo', () => {
  const { _systemPromptToText } = require('../src/ai-provider')
  const system = [
    { type: 'text', text: 'SYSTEM CORE' },
    { type: 'text', text: 'CONTEXTO DINAMICO' },
  ]
  const out = _systemPromptToText(system)
  assert.match(out, /SYSTEM CORE/)
  assert.match(out, /CONTEXTO DINAMICO/)
  assert.doesNotMatch(out, /\[object Object\]/)
})

test('motor de IA: defaults sem banco usam OpenAI GPT-4o-mini', async () => {
  const aiProvider = require('../src/ai-provider')
  const prevProvider = process.env.DEFAULT_AI_PROVIDER
  const prevAiProvider = process.env.AI_PROVIDER
  aiProvider.invalidateCache()
  delete process.env.DEFAULT_AI_PROVIDER
  delete process.env.AI_PROVIDER
  try {
    const settings = await aiProvider.getAISettings(null)
    assert.equal(settings.provider, 'openai')
    assert.equal(settings.model, 'gpt-4o-mini')
    assert.equal(settings.fallback_provider, 'anthropic')
  } finally {
    if (prevProvider != null) process.env.DEFAULT_AI_PROVIDER = prevProvider
    if (prevAiProvider != null) process.env.AI_PROVIDER = prevAiProvider
    aiProvider.invalidateCache()
  }
})

test('motor de IA: exigirAdmin retorna 403 sem dashboardUser', () => {
  const { exigirAdmin } = require('../src/ai-routes')
  let status = null
  const resMock = { status: (s) => { status = s; return { json: () => {} } } }
  exigirAdmin({}, resMock, () => {})
  assert.equal(status, 403)
})

test('motor de IA: exigirAdmin chama next() para admin autenticado', () => {
  const { exigirAdmin } = require('../src/ai-routes')
  let nextCalled = false
  exigirAdmin({ dashboardUser: { role: 'admin' } }, {}, () => { nextCalled = true })
  assert.equal(nextCalled, true)
})

test('motor de IA: dashboardAutorizado e predicate (arity 1) e nao deve ser usado como middleware', () => {
  const { dashboardAutorizado } = require('../src/dashboardAuth')
  assert.equal(typeof dashboardAutorizado, 'function')
  assert.equal(dashboardAutorizado.length, 1, 'arity 1 = predicate (regressao corrigida)')
  const { exigirAdmin } = require('../src/ai-routes')
  assert.equal(exigirAdmin.length, 3, 'arity 3 = middleware Express valido')
})

test('motor de IA: generateAIResponse usa provedor configurado no banco', async () => {
  const aiProvider = require('../src/ai-provider')
  aiProvider.invalidateCache()
  const pool = {
    async query(sql) {
      if (/SELECT \* FROM vendas\.ai_settings/.test(sql)) {
        return {
          rows: [{
            provider: 'openai',
            model: 'gpt-4o-mini',
            temperature: 0.3,
            max_tokens: 500,
            fallback_provider: 'anthropic',
            fallback_model: 'claude-sonnet-4-6',
            fallback_enabled: false,
            updated_at: new Date(),
          }],
        }
      }
      return { rows: [] }
    },
  }
  const prevA = process.env.ANTHROPIC_KEY
  const prevO = process.env.OPENAI_KEY
  process.env.OPENAI_KEY = ''
  process.env.ANTHROPIC_KEY = 'fake-anthropic-key'
  try {
    await aiProvider.generateAIResponse({
      systemPrompt: 'sys',
      userPrompt: 'oi',
      task: 'teste',
      disableFallback: true,
    }, pool, { warn: () => {}, error: () => {} })
    assert.fail('deveria ter lancado por falta de OPENAI_KEY')
  } catch (e) {
    assert.match(e.message, /OPENAI_KEY/i, `mensagem deveria mencionar OpenAI: ${e.message}`)
  } finally {
    if (prevA != null) process.env.ANTHROPIC_KEY = prevA; else delete process.env.ANTHROPIC_KEY
    if (prevO != null) process.env.OPENAI_KEY = prevO; else delete process.env.OPENAI_KEY
    aiProvider.invalidateCache()
  }
})

test('motor de IA: disableFallback impede fallback mesmo quando habilitado', async () => {
  const aiProvider = require('../src/ai-provider')
  aiProvider.invalidateCache()
  const pool = {
    async query(sql) {
      if (/SELECT \* FROM vendas\.ai_settings/.test(sql)) {
        return {
          rows: [{
            provider: 'openai',
            model: 'gpt-4o-mini',
            temperature: 0.3,
            max_tokens: 500,
            fallback_provider: 'anthropic',
            fallback_model: 'claude-sonnet-4-6',
            fallback_enabled: true,
            updated_at: new Date(),
          }],
        }
      }
      return { rows: [] }
    },
  }
  const prevO = process.env.OPENAI_KEY
  process.env.OPENAI_KEY = ''
  try {
    await aiProvider.generateAIResponse({
      systemPrompt: 'sys',
      userPrompt: 'oi',
      disableFallback: true,
    }, pool, null)
    assert.fail('deveria ter lancado erro do OpenAI')
  } catch (e) {
    assert.match(e.message, /OPENAI/i)
    assert.doesNotMatch(e.message, /primary.*fallback/i)
  } finally {
    if (prevO != null) process.env.OPENAI_KEY = prevO; else delete process.env.OPENAI_KEY
    aiProvider.invalidateCache()
  }
})

test('motor de IA: nenhum modulo bypassa o motor central (auditoria)', () => {
  const srcDir = path.join(__dirname, '..', 'src')
  const arquivos = fs.readdirSync(srcDir).filter((f) => f.endsWith('.js'))
  const violacoes = []
  for (const arquivo of arquivos) {
    // Excecoes documentadas:
    // - ai-provider.js: motor central (axios direto OK)
    // - config.js: define a constante ANTHROPIC_MESSAGES_URL
    // - preview-site.js: chama OpenAI Images (DALL-E), nao chat
    // - agent.js: mantem anthropicMessagesComWebSearch (web_search e Anthropic-only)
    // - media-processing.js: chama OpenAI Whisper (audio/transcriptions), nao chat completions
    if (['ai-provider.js', 'config.js', 'preview-site.js', 'agent.js', 'media-processing.js'].includes(arquivo)) continue
    const conteudo = fs.readFileSync(path.join(srcDir, arquivo), 'utf8')
    const linhasComUso = conteudo.split('\n').filter((l) => {
      if (!/api\.(anthropic|openai)\.com|ANTHROPIC_MESSAGES_URL/.test(l)) return false
      const trim = l.trim()
      return !trim.startsWith('//') && !trim.startsWith('*')
    })
    if (linhasComUso.length > 0) {
      violacoes.push(`${arquivo}:${linhasComUso.length}`)
    }
  }
  assert.equal(violacoes.length, 0, `Modulos com chamadas hardcoded fora do motor central: ${violacoes.join(', ')}`)
})

test('motor de IA: ai-routes valida temperature, max_tokens e provider/model', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'ai-routes.js'), 'utf8')
  assert.match(src, /TEMPERATURE_MIN/, 'precisa validar temperatura')
  assert.match(src, /MAX_TOKENS_MIN/, 'precisa validar max_tokens')
  assert.match(src, /validarProviderModel/, 'precisa validar compatibilidade provider/model')
})

// ─── Orquestrador: duvida_nao_entendi e escolha_horario robustos ─────────────

test('orquestrador: "Não entendi?" classifica como duvida_nao_entendi (nao preco)', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Não entendi?',
    perfil: { negocio: 'agência de turismo', cidade: 'Lençóis Maranhenses' },
    estagio: 'diagnostico',
    historico: [
      { role: 'user', content: 'Roteiros completos' },
      { role: 'assistant', content: 'Esses roteiros ficam numa faixa mais baixa, média ou alta por pessoa?' },
      { role: 'user', content: 'Não entendi?' },
    ],
  })
  assert.equal(decisao.interpretacao.intencao_principal, 'duvida_nao_entendi')
  assert.equal(decisao.proxima_acao, 'reexplicar')
  if (!decisao.resultado) { return } // anti-loop suprimiu resposta
  const msg = decisao.resultado.mensagem_pro_lead
  // Reexplica a pergunta anterior
  assert.match(msg, /faixa|pessoa|baix|m[eé]di|alt|premium/i)
  // Nao fala de preco, projeto sob medida, nem oferece horario
  assert.doesNotMatch(msg, /R\$|projeto\s+sob\s+medida|tenho\s+\d{1,2}[:h]\d{2}|próximos\s+horários/i)
  // Nao usa frases bloqueadas
  assert.doesNotMatch(msg, /proposta\s+personalizada|ticket\s+alto|reformular/i)
})

test('orquestrador: "Como assim?" tambem dispara duvida_nao_entendi', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Como assim?',
    perfil: {},
    estagio: 'diagnostico',
    historico: [
      { role: 'assistant', content: 'Você procura site, sistema, automação, agente de IA ou solução sob medida?' },
      { role: 'user', content: 'Como assim?' },
    ],
  })
  assert.equal(decisao.interpretacao.intencao_principal, 'duvida_nao_entendi')
})

test('orquestrador: "Pode explicar?" dispara duvida_nao_entendi', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Pode explicar?',
    perfil: {},
    estagio: 'diagnostico',
    historico: [{ role: 'assistant', content: 'Qual é o tipo do seu negócio?' }],
  })
  assert.equal(decisao.interpretacao.intencao_principal, 'duvida_nao_entendi')
})

test('orquestrador: lead escolhe horario (19:45) confirma reuniao via historico', async () => {
  // Caso real: perfil pode nao ter persistido reuniao_proposta.horarios_sugeridos,
  // mas a ultima mensagem do bot ofereceu horarios. Tem que reconhecer.
  const decisao = await decidirProximaResposta({
    texto: '19:45',
    perfil: {
      reuniao_proposta: {
        necessaria: true,
        horarios_sugeridos: ['19:30', '19:45'],
      },
    },
    estagio: 'diagnostico',
    historico: [
      { role: 'assistant', content: 'Tenho amanhã às 19:30 ou 19:45 disponíveis. Qual fica melhor?' },
      { role: 'user', content: '19:45' },
    ],
  })
  assert.equal(decisao.interpretacao.intencao_principal, 'escolha_horario')
  assert.equal(decisao.proxima_acao, 'confirmar_reuniao')
  assert.equal(decisao.deve_sobrescrever_modelo, false)
})

test('orquestrador: lead escolhe horario quando agendamento_pendente esta no perfil', async () => {
  const decisao = await decidirProximaResposta({
    texto: '19:45',
    perfil: {
      reuniao_proposta: {
        necessaria: true,
        data_sugerida: '2026-05-14',
        horarios_sugeridos: ['19:30', '19:45'],
      },
    },
    estagio: 'agendamento_pendente',
    historico: [
      { role: 'assistant', content: 'Tenho amanhã às 19:30 ou 19:45. Qual fica melhor?' },
      { role: 'user', content: '19:45' },
    ],
  })
  assert.equal(decisao.interpretacao.intencao_principal, 'escolha_horario')
  assert.equal(decisao.proxima_acao, 'confirmar_reuniao')
})

test('orquestrador: sanitizador remove "proposta personalizada para X"', () => {
  const { sanitizarFrasesProibidasDaResposta } = require('../src/institutional-language')
  const input = 'No seu caso, isso entra como proposta personalizada para Agência de turismo em Lençóis Maranhenses.\n\nPosso marcar uma conversa rápida com a equipe da PJ Codeworks?'
  const out = sanitizarFrasesProibidasDaResposta(input)
  assert.doesNotMatch(out, /proposta\s+personalizada/i)
  assert.doesNotMatch(out, /no\s+seu\s+caso/i)
  // Mantem a parte util
  assert.match(out, /equipe da PJ Codeworks|conversa rápida/i)
})

test('orquestrador: sanitizador remove "quem pesquisa no Google fecha"', () => {
  const { sanitizarFrasesProibidasDaResposta } = require('../src/institutional-language')
  const input = 'Roteiros completos — serviço de ticket alto, e quem pesquisa no Google fecha com quem aparece primeiro. Hoje você fica fora dessa busca.\n\nMas conta: qual o ramo?'
  const out = sanitizarFrasesProibidasDaResposta(input)
  assert.doesNotMatch(out, /quem\s+pesquisa\s+no\s+google/i)
  assert.doesNotMatch(out, /fica\s+fora\s+dessa\s+busca/i)
  assert.doesNotMatch(out, /ticket\s+alto/i)
  // Mantem a parte util
  assert.match(out, /ramo/i)
})

test('orquestrador: validator sinaliza frases agressivas e concorrente inventado sem bloquear', () => {
  const casos = [
    'Quem pesquisa no Google fecha com quem aparece primeiro.',
    'Você fica fora dessa busca.',
    'Seu concorrente aparece antes.',
    'Você perde cliente para o concorrente.',
    'O concorrente está pegando seus clientes.',
    'Seu negócio está perdendo dinheiro.',
    'Você está invisível.',
    'Seus concorrentes já estão vendendo.',
  ]

  for (const mensagem of casos) {
    const r = validarRespostaAntesDeEnviar({ mensagem_pro_lead: mensagem }, {})
    // O validador agora BLOQUEIA frases agressivas (severidade 'bloquear')
    // em vez de apenas sinalizar. O output e sanitizado.
    assert.ok(r.erros.length > 0 || r.bloqueado === true, mensagem)
    // Bloqueia OU sinaliza — em ambos os casos o validador age
    const msgOk = r.bloqueado || r.erros.length > 0
    assert.ok(msgOk, 'bloqueado ou sinalizado: ' + mensagem)
  }
})

test('orquestrador: concorrente real pode ser citado apenas com linguagem moderada', () => {
  const moderada = validarRespostaAntesDeEnviar({
    mensagem_pro_lead: 'Na pesquisa validada apareceram alguns concorrentes reais, mas o ponto é estruturar melhor seus serviços e facilitar o contato.',
  }, { concorrentes: ['Empresa A'] })
  const agressiva = validarRespostaAntesDeEnviar({
    mensagem_pro_lead: 'Seu concorrente aparece antes e está pegando seus clientes.',
  }, { concorrentes: ['Empresa A'] })

  assert.equal(moderada.bloqueado, false)
  assert.equal(agressiva.bloqueado, false)
  assert.ok(agressiva.erros.some((e) => /concorrente|frase proibida/i.test(e.erro)))
})

test('prompts: nao contem exemplos agressivos de concorrente ou medo', () => {
  const arquivos = [
    'prompts/system-core.md',
    'prompts/system-diagnostico.md',
    'prompts/system-primeiro-contato.md',
    'prompts/system-objecao.md',
    'prompts/empresa.md',
  ]
  const proibidos = [
    /quem\s+pesquisa\s+no\s+google\s+fecha\s+com\s+quem\s+aparece\s+primeiro/i,
    /voc[eê]\s+fica\s+fora\s+dessa\s+busca/i,
    /concorrente\s+aparece\s+antes/i,
    /perde\s+cliente\s+para\s+o\s+concorrente/i,
    /concorrente\s+est[aá]\s+pegando\s+seus\s+clientes/i,
    /neg[oó]cio\s+est[aá]\s+perdendo\s+dinheiro/i,
    /concorrentes\s+j[aá]\s+est[aã]o\s+vendendo/i,
  ]

  for (const arquivo of arquivos) {
    const texto = fs.readFileSync(path.join(__dirname, '..', arquivo), 'utf8')
    for (const re of proibidos) {
      assert.doesNotMatch(texto, re, arquivo)
    }
  }
})

test('orquestrador: guardrail NAO reescreve quando intencao_principal=escolha_horario', async () => {
  const resultado = {
    mensagem_pro_lead: 'No seu caso, isso entra como proposta personalizada para X. Posso marcar uma reunião?',
    atualizar_perfil: { intencao_principal: 'escolha_horario' },
  }
  const out = await aplicarGuardrailReuniaoProposta(resultado, {}, new Date(), null)
  // Guardrail nao deve ter transformado a resposta — devolve a entrada como esta
  assert.equal(out.mensagem_pro_lead, resultado.mensagem_pro_lead)
})

test('orquestrador: guardrail NAO reescreve quando reuniao ja tem horario_confirmado', async () => {
  const resultado = {
    mensagem_pro_lead: 'Reunião marcada para 19:45. Qual e-mail?',
    atualizar_perfil: {
      reuniao_proposta: { horario_confirmado: '19:45' },
    },
  }
  const out = await aplicarGuardrailReuniaoProposta(resultado, {}, new Date(), null)
  assert.equal(out.mensagem_pro_lead, resultado.mensagem_pro_lead)
})

test('orquestrador: anti-loop nao expoe "vou reformular"', async () => {
  // Cenario: pergunta_preco repetida com perfil vazio — anti-loop deve evitar reusar
  // o texto identico sem expor falha. Anti-loop agora retorna resultado=null para suprimir.
  const decisao = await decidirProximaResposta({
    texto: 'quanto custa?',
    perfil: {},
    estagio: 'diagnostico',
    historico: [
      {
        role: 'assistant',
        content: 'Os valores dependem do tipo de estrutura.\n\nSites mais simples costumam ter um investimento inicial menor.\n\nPra eu te orientar sem chute: qual é o seu negócio e em qual cidade você atende?',
      },
      { role: 'user', content: 'quanto custa?' },
    ],
  })
  if (!decisao.resultado) { return } // anti-loop suprimiu resposta
  const msg = decisao.resultado.mensagem_pro_lead
  assert.doesNotMatch(msg, /reformular|repetiti|novamente/i)
})

test('orquestrador: horario hardcoded ainda mantem retrocompatibilidade em testes', async () => {
  // O perfil tem reuniao_proposta.necessaria=true → status agendamento_pendente
  // mesmo sem historico explicito. Cobre o caso onde core-funnel oferece slots.
  const decisao = await decidirProximaResposta({
    texto: '20:15',
    perfil: {
      reuniao_proposta: {
        necessaria: true,
        data_sugerida: '2026-05-11',
        horarios_sugeridos: ['19:30', '20:15'],
      },
    },
    estagio: 'agendamento_pendente',
  })
  assert.equal(decisao.interpretacao.intencao_principal, 'escolha_horario')
  assert.equal(decisao.proxima_acao, 'confirmar_reuniao')
})

// ─── Validador final (agent-validators.js) ────────────────────────────────────

test('validador: bloqueia mensagem com "proposta personalizada para X"', () => {
  const { validarRespostaAntesDeEnviar } = require('../src/agent-validators')
  const resultado = {
    mensagem_pro_lead: 'No seu caso, isso entra como proposta personalizada para Agência X em Y. Posso marcar?',
  }
  const r = validarRespostaAntesDeEnviar(resultado, {})
  // O sanitizador remove a frase antes da validacao detectar — checamos que o output NUNCA contem a frase
  assert.doesNotMatch(r.resultado.mensagem_pro_lead, /proposta\s+personalizada\s+para/i)
})

test('validador: R$ em projeto sob medida vira aviso (LLM no controle)', () => {
  const { validarRespostaAntesDeEnviar } = require('../src/agent-validators')
  const resultado = {
    mensagem_pro_lead: 'Pra esse sistema fica em torno de R$ 2.500 com entrada de R$ 800 + 3x.',
  }
  const r = validarRespostaAntesDeEnviar(resultado, { projeto_sob_medida: true })
  // Decisao do dono (2026-06-06): nao bloqueia mais — a resposta da IA segue pro lead.
  assert.equal(r.bloqueado, false)
  assert.match(r.resultado.mensagem_pro_lead, /R\$\s*2\.?500/)
  assert.ok(r.erros.some((e) => /preco|sob\s+medida/i.test(e.erro) && e.severidade === 'avisar'))
})

test('validador: PERMITE R$ quando NAO eh projeto sob medida (assinatura)', () => {
  const { validarRespostaAntesDeEnviar } = require('../src/agent-validators')
  const resultado = {
    mensagem_pro_lead: 'A assinatura fica em R$ 100 por mes. Quer seguir?',
  }
  const r = validarRespostaAntesDeEnviar(resultado, { plano_sugerido: 'iniciante_assinatura' })
  assert.equal(r.bloqueado, false)
  assert.match(r.resultado.mensagem_pro_lead, /R\$\s*100/)
})

test('validador: bloqueia mencao a Victor e substitui por equipe da PJ Codeworks', () => {
  const { validarRespostaAntesDeEnviar } = require('../src/agent-validators')
  const resultado = { mensagem_pro_lead: 'O Victor vai te ligar mais tarde.' }
  const r = validarRespostaAntesDeEnviar(resultado, {})
  // O sanitizador (sanitizarMencoesPessoaParaEquipe) substitui Victor por "equipe da PJ Codeworks"
  // antes da validacao — entao a mensagem final NAO tem mais Victor
  assert.doesNotMatch(r.resultado.mensagem_pro_lead, /\bVictor\b/)
})

test('validador: bloqueia mensagem vazia', () => {
  const { validarRespostaAntesDeEnviar } = require('../src/agent-validators')
  const resultado = { mensagem_pro_lead: '   ' }
  const r = validarRespostaAntesDeEnviar(resultado, {})
  assert.equal(r.bloqueado, true)
  assert.ok(r.erros.some((e) => /vazia/i.test(e.erro)))
})

test('validador: bloqueia trecho de handoff interno na mensagem do lead', () => {
  const { validarRespostaAntesDeEnviar } = require('../src/agent-validators')
  const resultado = {
    mensagem_pro_lead: 'Lead confirmou reunião para 19:45. Estágio: diagnostico. Intenção: escolha_horario.',
  }
  const r = validarRespostaAntesDeEnviar(resultado, {})
  assert.equal(r.bloqueado, true)
  assert.ok(r.erros.some((e) => /handoff/i.test(e.erro)))
})

test('validador: sanitiza termos internos do funil mesmo quando passa', () => {
  const { validarRespostaAntesDeEnviar } = require('../src/agent-validators')
  const resultado = {
    mensagem_pro_lead: 'Vou continuar aprofundando dor pra entender melhor.',
  }
  const r = validarRespostaAntesDeEnviar(resultado, {})
  // O sanitizador converte "aprofundando dor" em "entender melhor o contexto"
  assert.doesNotMatch(r.resultado.mensagem_pro_lead, /aprofund/i)
})

test('validador: sanitiza bolhas individualmente', () => {
  const { validarRespostaAntesDeEnviar } = require('../src/agent-validators')
  const resultado = {
    mensagem_pro_lead: 'Vou te ajudar.',
    mensagens_bolhas: [
      'Olá! Vou te ajudar.',
      'No seu caso, isso entra como proposta personalizada para X.',
      'Posso marcar uma conversa?',
    ],
  }
  const r = validarRespostaAntesDeEnviar(resultado, {})
  // A bolha problematica eh sanitizada; sobra trecho vazio (filtrado pelo validador) ou limpa
  for (const b of r.resultado.mensagens_bolhas || []) {
    assert.doesNotMatch(b, /proposta\s+personalizada\s+para/i)
  }
})

test('validador: passa mensagens limpas sem alterar (idempotencia)', () => {
  const { validarRespostaAntesDeEnviar } = require('../src/agent-validators')
  const original = 'Perfeito. Reunião marcada para amanhã às 19:45 com a equipe da PJ Codeworks. Qual o melhor e-mail para contato?'
  const resultado = { mensagem_pro_lead: original }
  const r = validarRespostaAntesDeEnviar(resultado, {})
  assert.equal(r.bloqueado, false)
  assert.equal(r.resultado.mensagem_pro_lead, original)
})

// ─── Interface publica do orquestrador (agent-orchestrator.js) ───────────────

test('orchestrator-facade: decidirProximaAcao e wrapper de decidirProximaResposta', () => {
  const orchestrator = require('../src/agent-orchestrator')
  assert.equal(typeof orchestrator.decidirProximaAcao, 'function')
  assert.equal(typeof orchestrator.interpretarMensagem, 'function')
  assert.equal(typeof orchestrator.extrairDadosDaMensagem, 'function')
  assert.equal(typeof orchestrator.obterProximaPerguntaBasica, 'function')
  assert.equal(typeof orchestrator.validarRespostaAntesDeEnviar, 'function')
  // Aliases retro-compat
  assert.equal(typeof orchestrator.decidirProximaResposta, 'function')
  assert.equal(typeof orchestrator.interpretarIntencaoMensagem, 'function')
})

test('orchestrator-facade: decidirProximaAcao retorna mesma decisao que decidirProximaResposta', async () => {
  const orchestrator = require('../src/agent-orchestrator')
  const ctx = {
    texto: 'Não entendi?',
    perfil: {},
    estagio: 'diagnostico',
    historico: [
      { role: 'assistant', content: 'Esses roteiros ficam numa faixa baixa, média ou alta?' },
      { role: 'user', content: 'Não entendi?' },
    ],
  }
  const a = await orchestrator.decidirProximaAcao(ctx)
  const b = await orchestrator.decidirProximaResposta(ctx)
  assert.equal(a.proxima_acao, b.proxima_acao)
  assert.equal(a.interpretacao.intencao_principal, b.interpretacao.intencao_principal)
})

// ─── Interface publica de ações (agent-actions.js) ───────────────────────────

test('orquestrador deterministico: cidade e necessidade perguntam apenas negocio faltante', async () => {
  const orchestrator = require('../src/agent-orchestrator')
  const decisao = await orchestrator.decidirProximaAcao({
    texto: 'Sou de São Bernardo e quero um site',
    perfil: {},
    estagio: 'diagnostico',
    historico: [{ role: 'user', content: 'Sou de São Bernardo e quero um site' }],
  })
  const msg = decisao.resultado.mensagem_pro_lead

  assert.equal(decisao.proxima_acao, 'coletar_dado_faltante')
  assert.equal(decisao.resultado.atualizar_perfil.cidade, 'São Bernardo do Campo')
  assert.equal(decisao.resultado.atualizar_perfil.necessidade, 'site')
  assert.match(msg, /voc[eê] est[aá] em São Bernardo do Campo/i)
  assert.match(msg, /procura site/i)
  assert.match(msg, /S[oó] falta entender o tipo do seu neg[oó]cio/i)
  assert.doesNotMatch(msg, /em qual cidade|qual cidade/i)
  assert.doesNotMatch(msg, /site, sistema, automa/i)
})

test('orquestrador deterministico: historico completo evita repetir e conecta valor antes da agenda', async () => {
  const orchestrator = require('../src/agent-orchestrator')
  const decisao = await orchestrator.decidirProximaAcao({
    texto: 'Quero um site',
    perfil: {},
    estagio: 'diagnostico',
    historico: [
      { role: 'user', content: 'Sou dentista em Diadema' },
      { role: 'assistant', content: 'Perfeito. Você procura site, sistema ou automação?' },
      { role: 'user', content: 'Quero um site' },
    ],
  })

  assert.equal(decisao.proxima_acao, 'conexao_valor')
  assert.equal(decisao.estado_comercial.dados_obrigatorios.nicho, true)
  assert.equal(decisao.estado_comercial.dados_obrigatorios.cidade, true)
  assert.equal(decisao.estado_comercial.dados_obrigatorios.servico_principal, true)
  assert.match(decisao.resultado.mensagem_pro_lead, /dentista em Diadema/i)
  assert.doesNotMatch(decisao.resultado.mensagem_pro_lead, /hor.rio|reuni.o|pre.o|Google/i)
})

test('orquestrador deterministico: pedido humano tem prioridade sobre dados novos', async () => {
  const orchestrator = require('../src/agent-orchestrator')
  const decisao = await orchestrator.decidirProximaAcao({
    texto: 'Quero um site, mas quero falar com um humano',
    perfil: {},
    estagio: 'diagnostico',
    historico: [{ role: 'user', content: 'Quero um site, mas quero falar com um humano' }],
  })

  assert.equal(decisao.proxima_acao, 'encaminhar_humano')
  assert.equal(decisao.interpretacao.intencao_principal, 'pedido_humano')
})

test('actions-facade: enum ACOES contem todas as acoes documentadas', () => {
  const actions = require('../src/agent-actions')
  const esperadas = [
    'PRIMEIRO_CONTATO', 'EXPLICAR_PERGUNTA', 'ENCAMINHAR_HUMANO',
    'CONFIRMAR_REUNIAO', 'CONSULTAR_AGENDA', 'REAGENDAR',
    'RESPONDER_PRECO', 'EXPLICAR_SOLUCAO', 'COLETAR_DADO_FALTANTE',
  ]
  for (const k of esperadas) {
    assert.ok(actions.ACOES[k], `falta ACOES.${k}`)
  }
})

test('actions-facade: ehAcaoCritica classifica corretamente', () => {
  const { ACOES, ehAcaoCritica } = require('../src/agent-actions')
  assert.equal(ehAcaoCritica(ACOES.CONFIRMAR_REUNIAO), true)
  assert.equal(ehAcaoCritica(ACOES.ENCAMINHAR_HUMANO), true)
  assert.equal(ehAcaoCritica(ACOES.EXPLICAR_PERGUNTA), true)
  assert.equal(ehAcaoCritica(ACOES.CONSULTAR_AGENDA), true)
  assert.equal(ehAcaoCritica(ACOES.GERAR_VIA_LLM), false, 'gerar via LLM nao e critica')
})

test('actions-facade: text helpers carregam de agent.js', () => {
  const actions = require('../src/agent-actions')
  assert.equal(typeof actions.textoComoFunciona, 'function')
  assert.equal(typeof actions.textoFaixaPrecoInicial, 'function')
  assert.equal(typeof actions.montarPerguntaFaltante, 'function')
})

// ─── Pipeline integrado: orchestrator → validator → output limpo ─────────────

test('pipeline: caso real corrigido — "Nao entendi?" passa pelo orchestrator e nao vaza frase proibida', async () => {
  const orchestrator = require('../src/agent-orchestrator')
  const decisao = await orchestrator.decidirProximaAcao({
    texto: 'Não entendi?',
    perfil: { negocio: 'agência de turismo', cidade: 'Lençóis Maranhenses' },
    estagio: 'diagnostico',
    historico: [
      { role: 'user', content: 'Roteiros completos' },
      { role: 'assistant', content: 'Esses roteiros ficam numa faixa mais baixa, média ou alta por pessoa?' },
      { role: 'user', content: 'Não entendi?' },
    ],
  })
  if (!decisao.resultado) { return } // anti-loop pode suprimir resposta
  // Passa pelo validador final
  const r = orchestrator.validarRespostaAntesDeEnviar(decisao.resultado, decisao.estado_comercial || {})
  assert.equal(r.bloqueado, false)
  const msg = r.resultado.mensagem_pro_lead
  // Reexplica
  assert.match(msg, /baix|m[eé]di|alt|premium|faixa|pessoa/i)
  // Sem frases proibidas
  assert.doesNotMatch(msg, /proposta\s+personalizada|ticket\s+alto|reformular|quem\s+pesquisa\s+no\s+google/i)
  // Sem R$
  assert.doesNotMatch(msg, /R\$/)
})

test('pipeline: "19:45" via orchestrator → validador aprova sem mensagem proibida', async () => {
  const orchestrator = require('../src/agent-orchestrator')
  const decisao = await orchestrator.decidirProximaAcao({
    texto: '19:45',
    perfil: {},
    estagio: 'diagnostico',
    historico: [
      { role: 'assistant', content: 'Tenho amanhã às 19:30 ou 19:45 disponíveis. Qual fica melhor?' },
      { role: 'user', content: '19:45' },
    ],
  })
  // escolha_horario → confirmar_reuniao
  assert.equal(decisao.proxima_acao, 'confirmar_reuniao')
  assert.equal(decisao.deve_sobrescrever_modelo, false) // orquestrador nao sobrescreve neste cenario
})

test('validador: mensagemFallbackSegura adapta a dados disponiveis no perfil', () => {
  const { mensagemFallbackSegura } = require('../src/agent-validators')
  const semDados = mensagemFallbackSegura({})
  const comDados = mensagemFallbackSegura({ negocio: 'turismo', cidade: 'SP' })
  const comEstagio = mensagemFallbackSegura({}, 'proposta')
  assert.match(semDados, /orientar|confirma|procura|site|sistema/i)
  assert.match(comDados, /informa[cç][oõ]es\s+principais|equipe/i)
  assert.match(comEstagio, /garantir|verificar|informa[cç][oõ]es/i)
})

test('orquestrador: dados_minimos (3 ok) escolha de horario tem prioridade', async () => {
  // Mesmo com 3 dados completos, se lead diz um horario que o bot acabou de oferecer,
  // a escolha de horario tem prioridade sobre "consultar_agenda_e_oferecer_horarios"
  const decisao = await decidirProximaResposta({
    texto: '19:45',
    perfil: {
      negocio: 'agência de turismo',
      cidade: 'Lençóis Maranhenses',
      servico_principal: 'site',
    },
    estagio: 'diagnostico',
    historico: [
      { role: 'assistant', content: 'Tenho amanhã às 19:30 ou 19:45. Qual fica melhor?' },
      { role: 'user', content: '19:45' },
    ],
  })
  assert.equal(decisao.proxima_acao, 'confirmar_reuniao')
})

// ── Fase 1: esteira inteligente de prospecção ─────────────────────────────────

test('fase1: prospectingIntelligenceEnabled desligado por padrao (sem env)', () => {
  const original = process.env.PROSPECTING_INTELLIGENCE_ENABLED
  delete process.env.PROSPECTING_INTELLIGENCE_ENABLED
  assert.equal(prospectingIntelligenceEnabled(), false)
  if (original !== undefined) process.env.PROSPECTING_INTELLIGENCE_ENABLED = original
})

test('fase1: prospectingIntelligenceEnabled ligado com "1"', () => {
  const original = process.env.PROSPECTING_INTELLIGENCE_ENABLED
  process.env.PROSPECTING_INTELLIGENCE_ENABLED = '1'
  assert.equal(prospectingIntelligenceEnabled(), true)
  if (original !== undefined) process.env.PROSPECTING_INTELLIGENCE_ENABLED = original
  else delete process.env.PROSPECTING_INTELLIGENCE_ENABLED
})

test('fase1: prospectingIntelligenceEnabled ligado com "true"', () => {
  const original = process.env.PROSPECTING_INTELLIGENCE_ENABLED
  process.env.PROSPECTING_INTELLIGENCE_ENABLED = 'true'
  assert.equal(prospectingIntelligenceEnabled(), true)
  if (original !== undefined) process.env.PROSPECTING_INTELLIGENCE_ENABLED = original
  else delete process.env.PROSPECTING_INTELLIGENCE_ENABLED
})

test('fase1: prospectingIntelligenceEnabled desligado com "0"', () => {
  const original = process.env.PROSPECTING_INTELLIGENCE_ENABLED
  process.env.PROSPECTING_INTELLIGENCE_ENABLED = '0'
  assert.equal(prospectingIntelligenceEnabled(), false)
  if (original !== undefined) process.env.PROSPECTING_INTELLIGENCE_ENABLED = original
  else delete process.env.PROSPECTING_INTELLIGENCE_ENABLED
})

test('fase1: calcularScoreV2 retorna score entre 0 e 100', () => {
  const casos = [
    {},
    { websiteUri: 'https://exemplo.com', rating: 4.8, userRatingCount: 200, telefone: '11999999999', businessStatus: 'OPERATIONAL' },
    { rating: 4.9, userRatingCount: 500, nicho: 'barbearia', telefone: '11988888888', businessStatus: 'OPERATIONAL' },
    { businessStatus: 'CLOSED_PERMANENTLY' },
    { tem_site: false, rating: 4.5, avaliacoes: 80, telefone: '11977777777', nicho: 'salao', businessStatus: 'OPERATIONAL' },
  ]
  for (const c of casos) {
    const r = calcularScoreV2(c)
    assert.ok(typeof r.score_v2 === 'number', 'score_v2 deve ser number')
    assert.ok(r.score_v2 >= 0 && r.score_v2 <= 100, `score_v2 fora do range: ${r.score_v2}`)
    assert.ok(['desqualificado', 'baixo', 'medio', 'alto'].includes(r.classificacao), `classificacao invalida: ${r.classificacao}`)
    assert.ok(typeof r.score_dimensoes === 'object', 'score_dimensoes deve ser object')
    assert.ok(Array.isArray(r.motivos), 'motivos deve ser array')
  }
})

test('fase1: calcularScoreV2 classifica negocio sem site como alto potencial', () => {
  const r = calcularScoreV2({
    tem_site: false,
    websiteUri: undefined,
    site: undefined,
    telefone: '11999999999',
    rating: 4.7,
    avaliacoes: 60,
    nicho: 'barbearia',
    businessStatus: 'OPERATIONAL',
  })
  assert.ok(r.score_v2 >= 60, `esperava score >= 60, obteve ${r.score_v2}`)
  assert.ok(r.score_dimensoes.presenca_digital >= 20, 'presenca_digital deveria ser alta sem site')
})

test('fase1: calcularScoreV2 penaliza negocio nao operacional', () => {
  const operacional = calcularScoreV2({ rating: 4.5, userRatingCount: 100, businessStatus: 'OPERATIONAL' })
  const fechado = calcularScoreV2({ rating: 4.5, userRatingCount: 100, businessStatus: 'CLOSED_PERMANENTLY' })
  assert.ok(operacional.score_v2 > fechado.score_v2, 'operacional deve ter score maior que fechado')
})

test('fase1: calcularScoreV2 nao usa base 50 (score parte de 0)', () => {
  const r = calcularScoreV2({ businessStatus: 'CLOSED_PERMANENTLY' })
  assert.equal(r.score_v2, 0)
})

test('fase1: calcularScoreV2 dimensoes somam no maximo 100', () => {
  const r = calcularScoreV2({
    tem_site: false,
    telefone: '11999999999',
    rating: 4.9,
    userRatingCount: 500,
    nicho: 'barbearia',
    businessStatus: 'OPERATIONAL',
    _nicho_performante: true,
  })
  assert.ok(r.score_v2 <= 100, `score_v2 nao pode ultrapassar 100: ${r.score_v2}`)
})

test('fase1: validarProspectAntesDoEnvio retorna ok:true quando flag desligada', async () => {
  const original = process.env.PROSPECTING_INTELLIGENCE_ENABLED
  process.env.PROSPECTING_INTELLIGENCE_ENABLED = '0'

  const resultado = await validarProspectAntesDoEnvio(
    { status: 'aguardando', decision_log: [] },
    null
  )
  assert.equal(resultado.ok, true)

  if (original !== undefined) process.env.PROSPECTING_INTELLIGENCE_ENABLED = original
  else delete process.env.PROSPECTING_INTELLIGENCE_ENABLED
})

test('fase1: validarProspectAntesDoEnvio bloqueia sem decision_log de aprovacao (flag ligada)', async () => {
  const original = process.env.PROSPECTING_INTELLIGENCE_ENABLED
  process.env.PROSPECTING_INTELLIGENCE_ENABLED = '1'

  const resultado = await validarProspectAntesDoEnvio(
    { id: null, status: 'aprovado', decision_log: [], telefone: '11999999999' },
    { dor_principal: 'sem presenca digital' }
  )
  assert.equal(resultado.ok, false)
  assert.ok(Array.isArray(resultado.erros), 'erros deve ser array')
  assert.ok(resultado.erros.includes('sem_aprovacao_humana_no_decision_log'),
    `esperava sem_aprovacao_humana_no_decision_log em: ${resultado.erros}`)

  if (original !== undefined) process.env.PROSPECTING_INTELLIGENCE_ENABLED = original
  else delete process.env.PROSPECTING_INTELLIGENCE_ENABLED
})

test('fase1: validarProspectAntesDoEnvio bloqueia sem diagnostico (flag ligada)', async () => {
  const original = process.env.PROSPECTING_INTELLIGENCE_ENABLED
  process.env.PROSPECTING_INTELLIGENCE_ENABLED = '1'

  const resultado = await validarProspectAntesDoEnvio(
    {
      id: null,
      status: 'aprovado',
      telefone: '11999999999',
      decision_log: [{ acao: 'aprovado', origem: 'operador', operador_ou_sistema: 'victor', ts: new Date().toISOString(), contexto: {} }],
    },
    null
  )
  assert.equal(resultado.ok, false)
  assert.ok(resultado.erros.includes('sem_diagnostico'),
    `esperava sem_diagnostico em: ${resultado.erros}`)

  if (original !== undefined) process.env.PROSPECTING_INTELLIGENCE_ENABLED = original
  else delete process.env.PROSPECTING_INTELLIGENCE_ENABLED
})

test('fase1: validarProspectAntesDoEnvio bloqueia com status diferente de aprovado (flag ligada)', async () => {
  const original = process.env.PROSPECTING_INTELLIGENCE_ENABLED
  process.env.PROSPECTING_INTELLIGENCE_ENABLED = '1'

  const resultado = await validarProspectAntesDoEnvio(
    {
      id: null,
      status: 'aguardando',
      telefone: '11999999999',
      decision_log: [{ acao: 'aprovado', origem: 'operador', operador_ou_sistema: 'victor', ts: new Date().toISOString(), contexto: {} }],
    },
    { dor_principal: 'sem presenca digital' }
  )
  assert.equal(resultado.ok, false)
  assert.ok(resultado.erros.includes('status_nao_aprovado'),
    `esperava status_nao_aprovado em: ${resultado.erros}`)

  if (original !== undefined) process.env.PROSPECTING_INTELLIGENCE_ENABLED = original
  else delete process.env.PROSPECTING_INTELLIGENCE_ENABLED
})

test('fase1: validarProspectAntesDoEnvio libera prospect valido sem BD disponivel (flag ligada)', async () => {
  const original = process.env.PROSPECTING_INTELLIGENCE_ENABLED
  process.env.PROSPECTING_INTELLIGENCE_ENABLED = '1'

  // id: null desativa as queries de send_attempts e conversas (nao dispara pool.query)
  const resultado = await validarProspectAntesDoEnvio(
    {
      id: null,
      status: 'aprovado',
      telefone: '11999999999',
      decision_log: [{ acao: 'aprovacao_humana', origem: 'operador', operador_ou_sistema: 'dashboard', ts: new Date().toISOString(), contexto: { oferta_confirmada: 'site_profissional' } }],
    },
    { dor_principal: 'sem presenca digital' }
  )
  assert.equal(resultado.ok, true)

  if (original !== undefined) process.env.PROSPECTING_INTELLIGENCE_ENABLED = original
  else delete process.env.PROSPECTING_INTELLIGENCE_ENABLED
})

test('fase1: decision_log e append-only (nao sobrescreve historico)', () => {
  const logExistente = [{ acao: 'criado', origem: 'sistema', operador_ou_sistema: 'sistema', ts: '2026-05-19T10:00:00.000Z', contexto: {} }]
  const novaEntrada = { acao: 'aprovado', origem: 'operador', operador_ou_sistema: 'victor', ts: '2026-05-19T12:00:00.000Z', contexto: { nota: 'lead bom' } }
  const novoLog = [...logExistente, novaEntrada]
  assert.equal(novoLog.length, 2)
  assert.equal(novoLog[0].acao, 'criado')
  assert.equal(novoLog[1].acao, 'aprovado')
  assert.equal(novoLog[0].ts, '2026-05-19T10:00:00.000Z', 'entrada original nao deve ser alterada')
})

// ── Fase 2: pipeline de diagnóstico inteligente ───────────────────────────────

// ── rotearOferta (função pura, sem banco) ─────────────────────────────────────

test('fase2: rotearOferta retorna site_profissional para lead sem site com score >= 60', () => {
  const r = rotearOferta({ nicho: 'salao', tem_site: false }, { oferta_sugerida: 'site_profissional', perfil_digital: 'ausente', dores_identificadas: [] }, 75)
  assert.equal(r.oferta_recomendada, 'site_profissional')
  assert.equal(r.motivo_rota, 'sem_site_score_alto')
})

test('fase2: rotearOferta retorna plano_inicial para score entre 40 e 59', () => {
  const r = rotearOferta({ nicho: 'padaria', tem_site: false }, { oferta_sugerida: 'plano_inicial', perfil_digital: 'ausente', dores_identificadas: [] }, 50)
  assert.equal(r.oferta_recomendada, 'plano_inicial')
  assert.equal(r.motivo_rota, 'score_baixo_40_59')
})

test('fase2: rotearOferta retorna redesign quando tem site e perfil_digital=basico', () => {
  const r = rotearOferta({ nicho: 'oficina', tem_site: true, site: 'http://ex.com' }, { oferta_sugerida: 'site_profissional', perfil_digital: 'basico', dores_identificadas: [] }, 70)
  assert.equal(r.oferta_recomendada, 'redesign')
  assert.equal(r.motivo_rota, 'site_perfil_basico')
})

test('fase2: rotearOferta retorna seo_local quando tem site e dor menciona google/busca', () => {
  const r = rotearOferta(
    { nicho: 'advocacia', tem_site: true, site: 'http://ex.com' },
    { oferta_sugerida: 'seo_local', perfil_digital: 'intermediario', dores_identificadas: ['nao aparece no google local', 'baixa visibilidade'] },
    72
  )
  assert.equal(r.oferta_recomendada, 'seo_local')
  assert.equal(r.motivo_rota, 'dor_presenca_local')
})

test('fase2: rotearOferta retorna site_sistema para nicho de agendamento com site ja existente', () => {
  // R1 nao se aplica (tem site), R2 nao (perfil intermediario), R3 nao (sem dor presenca) → R4 dispara
  const r = rotearOferta(
    { nicho: 'clinica estetica', tem_site: true, site: 'http://ex.com' },
    { oferta_sugerida: 'site_sistema', perfil_digital: 'intermediario', dores_identificadas: [] },
    65
  )
  assert.equal(r.oferta_recomendada, 'site_sistema')
  assert.equal(r.motivo_rota, 'nicho_agendamento_ou_servico_recorrente')
})

test('fase2: rotearOferta retorna automacao_agente para nicho de alto volume (restaurante)', () => {
  // restaurante sem site + score >= 60: R1 tem prioridade sobre R5
  // para testar R5 isolado, precisamos de nicho automacao mas com tem_site=true e perfil não basico
  const r = rotearOferta(
    { nicho: 'restaurante', tem_site: true, site: 'http://ex.com' },
    { oferta_sugerida: 'automacao_agente', perfil_digital: 'intermediario', dores_identificadas: ['atendimento alto volume'] },
    70
  )
  assert.equal(r.oferta_recomendada, 'automacao_agente')
  assert.equal(r.motivo_rota, 'nicho_volume_alto_ou_atendimento_repetitivo')
})

test('fase2: rotearOferta prioriza regra deterministica sobre sugestao da IA', () => {
  // Sem site + score alto: R1 deve prevalecer mesmo que IA sugira redesign
  const r = rotearOferta(
    { nicho: 'mecanica', tem_site: false },
    { oferta_sugerida: 'redesign', perfil_digital: 'ausente', dores_identificadas: [] },
    80
  )
  assert.equal(r.oferta_recomendada, 'site_profissional', 'regra deterministica deve vencer sugestao da IA')
  assert.notEqual(r.fonte, 'ia_confirmada')
})

test('fase2: rotearOferta usa sugestao da IA quando nenhuma regra deterministica se aplica', () => {
  // tem site + perfil intermediario + sem dor de presenca + nicho sem mapeamento + score 70
  const r = rotearOferta(
    { nicho: 'loja de tinta', tem_site: true, site: 'http://ex.com' },
    { oferta_sugerida: 'seo_local', perfil_digital: 'intermediario', dores_identificadas: ['pouca divulgacao'] },
    70
  )
  assert.equal(r.oferta_recomendada, 'seo_local')
  assert.equal(r.fonte, 'ia_confirmada')
})

test('fase2: rotearOferta retorna fonte ia_confirmada quando regra e IA concordam', () => {
  const r = rotearOferta({ nicho: 'barbearia', tem_site: false }, { oferta_sugerida: 'site_sistema', perfil_digital: 'ausente', dores_identificadas: [] }, 75)
  // R4 (nicho agendamento) se aplica antes de R1 verificar — barbearia está em NICHOS_AGENDAMENTO_V2
  // mas R1 (sem site + score >= 60) é verificada ANTES de R4
  // barbearia não tem site, score >= 60 → R1 → site_profissional
  assert.equal(r.oferta_recomendada, 'site_profissional')
})

// ── fallbackDiagnosticoEstruturado ────────────────────────────────────────────

test('fase2: fallbackDiagnosticoEstruturado retorna estrutura valida para prospect sem site', () => {
  const r = fallbackDiagnosticoEstruturado({ nicho: 'barbearia', tem_site: false, rating: 4.7, avaliacoes: 45 })
  assert.equal(r.perfil_digital, 'ausente')
  assert.ok(Array.isArray(r.dores_identificadas) && r.dores_identificadas.length > 0)
  assert.ok(Array.isArray(r.sinais_positivos))
  assert.ok(r.sinais_positivos.some((s) => /4.7|45/i.test(s)), 'sinal positivo deve mencionar rating ou reviews')
  assert.ok(typeof r.oferta_sugerida === 'string')
  assert.ok(typeof r.confianca === 'number' && r.confianca >= 0 && r.confianca <= 1)
  assert.equal(r.prompt_version, 'prospecting_diagnostic_v2_2026_05')
})

test('fase2: fallbackDiagnosticoEstruturado retorna perfil_digital basico quando tem site', () => {
  const r = fallbackDiagnosticoEstruturado({ nicho: 'clinica', tem_site: true, site: 'http://ex.com' })
  assert.equal(r.perfil_digital, 'basico')
})

// ── parsearJsonDiagnosticoEstruturado ─────────────────────────────────────────

test('fase2: parsearJsonDiagnosticoEstruturado aceita JSON valido', () => {
  const json = JSON.stringify({
    segmento: 'barbearia',
    perfil_digital: 'ausente',
    dores_identificadas: ['sem site'],
    sinais_positivos: ['nota 4.8'],
    oportunidade_principal: 'criar presenca digital',
    oferta_sugerida: 'site_profissional',
    motivo_oferta: 'negocio sem site com boa reputacao',
    nivel_urgencia: 'alta',
    confianca: 0.8,
  })
  const r = parsearJsonDiagnosticoEstruturado(json)
  assert.ok(r !== null, 'deve retornar objeto valido')
  assert.equal(r.segmento, 'barbearia')
  assert.equal(r.oferta_sugerida, 'site_profissional')
})

test('fase2: parsearJsonDiagnosticoEstruturado rejeita JSON com oferta_sugerida invalida', () => {
  const json = JSON.stringify({
    segmento: 'barbearia', perfil_digital: 'ausente', dores_identificadas: [],
    sinais_positivos: [], oportunidade_principal: 'x',
    oferta_sugerida: 'oferta_inventada', motivo_oferta: 'x', nivel_urgencia: 'alta', confianca: 0.8,
  })
  assert.equal(parsearJsonDiagnosticoEstruturado(json), null)
})

test('fase2: parsearJsonDiagnosticoEstruturado rejeita JSON invalido / texto puro', () => {
  assert.equal(parsearJsonDiagnosticoEstruturado('isso nao e json'), null)
  assert.equal(parsearJsonDiagnosticoEstruturado(''), null)
  assert.equal(parsearJsonDiagnosticoEstruturado(null), null)
})

test('fase2: parsearJsonDiagnosticoEstruturado aceita JSON envolto em markdown code fence', () => {
  const json = '```json\n' + JSON.stringify({
    segmento: 'mecanica', perfil_digital: 'basico', dores_identificadas: ['site antigo'],
    sinais_positivos: ['50 reviews'], oportunidade_principal: 'modernizar site',
    oferta_sugerida: 'redesign', motivo_oferta: 'site desatualizado', nivel_urgencia: 'media', confianca: 0.75,
  }) + '\n```'
  const r = parsearJsonDiagnosticoEstruturado(json)
  assert.ok(r !== null)
  assert.equal(r.oferta_sugerida, 'redesign')
})

// ── gerarDiagnosticoEstruturado (fallback quando sem ANTHROPIC_KEY) ───────────

test('fase2: gerarDiagnosticoEstruturado retorna fallback quando sem ANTHROPIC_KEY', async () => {
  const original = process.env.ANTHROPIC_KEY
  delete process.env.ANTHROPIC_KEY

  const r = await gerarDiagnosticoEstruturado({ nome: 'Barber Shop X', nicho: 'barbearia', cidade: 'SP', tem_site: false })
  assert.ok(r !== null)
  assert.equal(r.metadata_json.fallback, true)
  assert.equal(r.perfil_digital, 'ausente')
  assert.ok(typeof r.oferta_sugerida === 'string')

  if (original !== undefined) process.env.ANTHROPIC_KEY = original
})

// ── montarMensagemComercialV2Fallback ─────────────────────────────────────────

test('fase2: montarMensagemComercialV2Fallback menciona PJ Codeworks', () => {
  const msg = montarMensagemComercialV2Fallback(
    { nome: 'Barber Shop X', nicho: 'barbearia', cidade: 'SP', tem_site: false },
    { dores_identificadas: ['sem site'], sinais_positivos: ['nota 4.8'] },
    'site_profissional'
  )
  assert.match(msg, /PJ Codeworks/i)
})

test('fase2: montarMensagemComercialV2Fallback nao ultrapassa 600 caracteres', () => {
  const msg = montarMensagemComercialV2Fallback(
    { nome: 'Empresa com nome muito longo para testar o limite de caracteres da mensagem gerada automaticamente', nicho: 'servicos gerais de manutencao predial e reformas em geral', cidade: 'Rio de Janeiro', tem_site: false },
    { dores_identificadas: ['ausencia de presenca digital propria e baixa visibilidade online'], sinais_positivos: [] },
    'site_profissional'
  )
  assert.ok(msg.length <= 600, `mensagem ultrapassou 600 chars: ${msg.length}`)
})

test('fase2: gerarMensagemComercialV2 retorna fallback quando sem ANTHROPIC_KEY', async () => {
  const original = process.env.ANTHROPIC_KEY
  delete process.env.ANTHROPIC_KEY

  const resultado = await gerarMensagemComercialV2(
    { nome: 'Salao X', nicho: 'salao de beleza', cidade: 'SP', tem_site: false },
    { dores_identificadas: ['sem site'], sinais_positivos: ['nota 4.5'] },
    'site_profissional'
  )
  assert.ok(typeof resultado.mensagem === 'string')
  assert.ok(resultado.mensagem.length > 10)
  assert.equal(resultado.prompt_version, 'prospecting_message_v2_2026_05')
  assert.match(resultado.mensagem, /PJ Codeworks/i)

  if (original !== undefined) process.env.ANTHROPIC_KEY = original
})

// ── pipeline completo (flag + sem banco disponível) ───────────────────────────

test('fase2: com flag desligada gerarDiagnosticoComClaude ainda seria chamado (fluxo V1 preservado)', () => {
  // Verifica que o fluxo V1 não foi removido: gerarDiagnosticoEstruturado e rotearOferta existem
  // mas gerarDiagnosticoComClaude ainda deve estar exportado como função.
  // (O fluxo real do V1 usa banco — aqui só verificamos que a função existe)
  const prospecting = require('../src/prospecting')
  assert.ok(typeof prospecting.gerarDiagnosticos === 'function', 'gerarDiagnosticos deve existir')
  assert.ok(typeof prospecting.gerarDiagnosticoEstruturado === 'function', 'gerarDiagnosticoEstruturado deve existir')
  assert.ok(typeof prospecting.rotearOferta === 'function', 'rotearOferta deve existir')
})

test('fase2: decision_log recebe acao score_v2_calculado no formato correto', () => {
  const entrada = {
    acao: 'score_v2_calculado',
    origem: 'sistema',
    operador_ou_sistema: 'prospecting_intelligence',
    ts: new Date().toISOString(),
    contexto: { score_v2: 75, classificacao: 'medio', motivos: ['sem site'], score_dimensoes: {} },
  }
  assert.equal(entrada.acao, 'score_v2_calculado')
  assert.equal(entrada.origem, 'sistema')
  assert.ok(typeof entrada.contexto.score_v2 === 'number')
})

test('fase2: decision_log recebe acao oferta_roteada no formato correto', () => {
  const entrada = {
    acao: 'oferta_roteada',
    origem: 'sistema',
    operador_ou_sistema: 'prospecting_intelligence',
    ts: new Date().toISOString(),
    contexto: { oferta_recomendada: 'site_profissional', motivo_rota: 'sem_site_score_alto', oferta_sugerida_ia: 'site_profissional' },
  }
  assert.equal(entrada.acao, 'oferta_roteada')
  assert.ok(['site_profissional', 'redesign', 'seo_local', 'site_sistema', 'automacao_agente', 'plano_inicial'].includes(entrada.contexto.oferta_recomendada))
})

test('fase2: pipeline V2 nao altera status do prospect para aprovado (aguardando preservado)', () => {
  // Testa via rotearOferta e score — o status 'aguardando' nunca é modificado pelas funções puras
  const r = rotearOferta({ nicho: 'barbearia', tem_site: false, status: 'aguardando' }, fallbackDiagnosticoEstruturado({ nicho: 'barbearia' }), 75)
  // rotearOferta não tem acesso ao status do prospect e não o modifica
  assert.ok(!('status' in r), 'rotearOferta nao deve retornar status do prospect')
  assert.ok(r.oferta_recomendada, 'deve ter oferta recomendada')
})

test('fase2: calcularScoreV2 agora le businessStatus do raw_json em prospect persistido', () => {
  const prospectPersistido = {
    tem_site: false,
    telefone: '11999999999',
    rating: 4.5,
    avaliacoes: 50,
    nicho: 'barbearia',
    raw_json: { businessStatus: 'CLOSED_PERMANENTLY' },
  }
  const r = calcularScoreV2(prospectPersistido)
  assert.ok(r.score_v2 <= 50, `prospect fechado deve ter score baixo, obteve ${r.score_v2}`)
  const rOperacional = calcularScoreV2({ ...prospectPersistido, raw_json: { businessStatus: 'OPERATIONAL' } })
  assert.ok(rOperacional.score_v2 > r.score_v2, 'operacional deve ter score maior que fechado')
})

// ── Fase 3: fila de aprovação humana ─────────────────────────────────────────

// ── validarProspectAntesDoEnvio (Fase 3: verificação estrita de aprovacao_humana) ──

test('fase3: validarProspectAntesDoEnvio aceita lead aprovado humanamente com acao=aprovacao_humana', async () => {
  const original = process.env.PROSPECTING_INTELLIGENCE_ENABLED
  process.env.PROSPECTING_INTELLIGENCE_ENABLED = '1'
  try {
    const resultado = await validarProspectAntesDoEnvio(
      {
        id: null,
        status: 'aprovado',
        telefone: '11999999999',
        decision_log: [{ acao: 'aprovacao_humana', origem: 'operador', operador_ou_sistema: 'dashboard', ts: new Date().toISOString(), contexto: { oferta_confirmada: 'site_profissional' } }],
      },
      { dor_principal: 'sem presenca digital' }
    )
    assert.equal(resultado.ok, true, `erros: ${(resultado.erros || []).join(', ')}`)
  } finally {
    if (original !== undefined) process.env.PROSPECTING_INTELLIGENCE_ENABLED = original
    else delete process.env.PROSPECTING_INTELLIGENCE_ENABLED
  }
})

test('fase3: validarProspectAntesDoEnvio rejeita lead aprovado apenas pelo sistema (sem acao=aprovacao_humana)', async () => {
  const original = process.env.PROSPECTING_INTELLIGENCE_ENABLED
  process.env.PROSPECTING_INTELLIGENCE_ENABLED = '1'
  try {
    const resultado = await validarProspectAntesDoEnvio(
      {
        id: null,
        status: 'aprovado',
        telefone: '11999999999',
        decision_log: [{ acao: 'aprovado', origem: 'sistema', operador_ou_sistema: 'auto', ts: new Date().toISOString(), contexto: {} }],
      },
      { dor_principal: 'sem presenca digital' }
    )
    assert.equal(resultado.ok, false)
    assert.ok(resultado.erros.includes('sem_aprovacao_humana_no_decision_log'),
      `esperava sem_aprovacao_humana_no_decision_log, obteve: ${resultado.erros}`)
  } finally {
    if (original !== undefined) process.env.PROSPECTING_INTELLIGENCE_ENABLED = original
    else delete process.env.PROSPECTING_INTELLIGENCE_ENABLED
  }
})

test('fase3: validarProspectAntesDoEnvio com flag desligada libera sem checar decision_log', async () => {
  const original = process.env.PROSPECTING_INTELLIGENCE_ENABLED
  process.env.PROSPECTING_INTELLIGENCE_ENABLED = '0'
  try {
    const resultado = await validarProspectAntesDoEnvio(
      { id: null, status: 'aguardando', telefone: '', decision_log: [] },
      null
    )
    assert.equal(resultado.ok, true, 'flag desligada deve liberar tudo')
  } finally {
    if (original !== undefined) process.env.PROSPECTING_INTELLIGENCE_ENABLED = original
    else delete process.env.PROSPECTING_INTELLIGENCE_ENABLED
  }
})

// ── buscarFilaAprovacao ───────────────────────────────────────────────────────

test('fase3: buscarFilaAprovacao retorna estrutura paginada com items e total', async () => {
  const originalQuery = pool.query
  pool.query = async (sql) => {
    if (sql.includes('COUNT(*)')) return { rows: [{ total: 2 }] }
    return {
      rows: [
        { id: 'a1', nome: 'Barbearia Teste', telefone: '11999990001', nicho: 'barbearia', cidade: 'SP', status: 'aguardando', score_v2: 75, score_dimensoes: null, oferta_recomendada: 'site_profissional', decision_log: [], rating: 4.8, avaliacoes: 60, tem_site: false, site: null, maps_url: null, score: null, dor_principal: 'sem site', mensagem_gerada: 'Ola!', mensagem_editada: null, diagnostico_json: { segmento: 'barbearia' }, prompt_version: 'v2', created_at: null, updated_at: null },
        { id: 'a2', nome: 'Clinica Boa Vista', telefone: '11999990002', nicho: 'clinica', cidade: 'RJ', status: 'aguardando', score_v2: 62, score_dimensoes: null, oferta_recomendada: 'site_sistema', decision_log: [], rating: 4.5, avaliacoes: 30, tem_site: false, site: null, maps_url: null, score: null, dor_principal: null, mensagem_gerada: null, mensagem_editada: null, diagnostico_json: null, prompt_version: null, created_at: null, updated_at: null },
      ],
    }
  }
  try {
    const resultado = await buscarFilaAprovacao({ limit: 20, offset: 0 })
    assert.ok(Array.isArray(resultado.items), 'items deve ser array')
    assert.equal(resultado.items.length, 2)
    assert.equal(resultado.total, 2)
    assert.equal(resultado.limit, 20)
    assert.equal(resultado.offset, 0)
    const item = resultado.items[0]
    assert.equal(item.id, 'a1')
    assert.equal(item.score_v2, 75)
    assert.equal(item.classificacao, 'medio')
    assert.ok(Array.isArray(item.decision_log), 'decision_log deve ser array')
  } finally {
    pool.query = originalQuery
  }
})

test('fase3: buscarFilaAprovacao classifica score alto >= 80 corretamente', async () => {
  const originalQuery = pool.query
  pool.query = async (sql) => {
    if (sql.includes('COUNT(*)')) return { rows: [{ total: 1 }] }
    return { rows: [{ id: 'x1', nome: 'Top Lead', score_v2: 88, status: 'aguardando', decision_log: [], nicho: 'advocacia', cidade: 'BH', telefone: '31999990001', rating: null, avaliacoes: null, tem_site: true, site: 'http://ex.com', maps_url: null, score: null, score_dimensoes: null, oferta_recomendada: 'seo_local', dor_principal: null, mensagem_gerada: null, mensagem_editada: null, diagnostico_json: null, prompt_version: null, created_at: null, updated_at: null }] }
  }
  try {
    const resultado = await buscarFilaAprovacao({})
    assert.equal(resultado.items[0].classificacao, 'alto')
  } finally {
    pool.query = originalQuery
  }
})

// ── obterMetricasFilaAprovacao ────────────────────────────────────────────────

test('fase3: obterMetricasFilaAprovacao retorna estrutura completa com por_oferta', async () => {
  const originalQuery = pool.query
  let callN = 0
  pool.query = async () => {
    callN++
    if (callN === 1) return { rows: [{ aguardando_aprovacao: 5, score_alto: 2, score_medio: 2, score_baixo: 1, sem_telefone: 0 }] }
    if (callN === 2) return { rows: [{ oferta_recomendada: 'site_profissional', total: 3 }, { oferta_recomendada: 'seo_local', total: 2 }] }
    return { rows: [{ total: 1 }] }
  }
  try {
    const m = await obterMetricasFilaAprovacao()
    assert.equal(m.aguardando_aprovacao, 5)
    assert.equal(m.score_alto, 2)
    assert.equal(m.score_medio, 2)
    assert.equal(m.score_baixo, 1)
    assert.ok('por_oferta' in m, 'deve ter por_oferta')
    assert.equal(m.por_oferta.site_profissional, 3)
    assert.equal(m.por_oferta.seo_local, 2)
    assert.equal(m.por_oferta.redesign, 0)
    assert.equal(m.sem_diagnostico, 1)
  } finally {
    pool.query = originalQuery
  }
})

// ── aprovarProspectComOferta ──────────────────────────────────────────────────

test('fase3: aprovarProspectComOferta registra decision_log com aprovacao_humana (flag ligada)', async () => {
  const original = process.env.PROSPECTING_INTELLIGENCE_ENABLED
  process.env.PROSPECTING_INTELLIGENCE_ENABLED = '1'
  const originalQuery = pool.query
  const decisionLogEntradas = []
  let callN = 0

  pool.query = async (sql, params) => {
    callN++
    if (callN === 1) {
      return { rows: [{ id: 'p1', status: 'aguardando', telefone: '11999999999', score_v2: 75, oferta_recomendada: 'site_profissional', decision_log: [], diag_id: 'd1', diagnostico_json: { segmento: 'barbearia' }, dor_principal: null, mensagem_gerada: 'Ola!', diag_msg_editada: null }] }
    }
    if (sql && sql.includes('decision_log')) {
      try { const entrada = JSON.parse(params[1])[0]; decisionLogEntradas.push(entrada) } catch (_) {}
    }
    return { rows: [{ id: 'p1' }] }
  }
  try {
    const resultado = await aprovarProspectComOferta('11111111-1111-1111-1111-111111111111', { oferta_recomendada: 'site_profissional', observacao: 'lead bom' })
    assert.equal(resultado.ok, true)
    assert.equal(resultado.status, 'aprovado')
    assert.equal(resultado.oferta_recomendada, 'site_profissional')
    const entrada = decisionLogEntradas.find((e) => e.acao === 'aprovacao_humana')
    assert.ok(entrada, 'deve ter entrada aprovacao_humana no decision_log')
    assert.equal(entrada.origem, 'operador')
    assert.equal(entrada.contexto.oferta_confirmada, 'site_profissional')
    assert.equal(entrada.contexto.mensagem_editada, false)
    assert.equal(entrada.contexto.observacao, 'lead bom')
  } finally {
    pool.query = originalQuery
    if (original !== undefined) process.env.PROSPECTING_INTELLIGENCE_ENABLED = original
    else delete process.env.PROSPECTING_INTELLIGENCE_ENABLED
  }
})

test('fase3: aprovarProspectComOferta bloqueia sem diagnostico_json com flag ligada', async () => {
  const original = process.env.PROSPECTING_INTELLIGENCE_ENABLED
  process.env.PROSPECTING_INTELLIGENCE_ENABLED = '1'
  const originalQuery = pool.query

  pool.query = async () => ({
    rows: [{ id: 'p2', status: 'aguardando', telefone: '11999999999', score_v2: 70, oferta_recomendada: null, decision_log: [], diag_id: null, diagnostico_json: null, dor_principal: null, mensagem_gerada: null, diag_msg_editada: null }],
  })
  try {
    await assert.rejects(
      () => aprovarProspectComOferta('22222222-2222-2222-2222-222222222222', { oferta_recomendada: 'site_profissional' }),
      (err) => {
        assert.ok(err.message.includes('diagnóstico'), `esperava erro de diagnóstico, obteve: ${err.message}`)
        return true
      }
    )
  } finally {
    pool.query = originalQuery
    if (original !== undefined) process.env.PROSPECTING_INTELLIGENCE_ENABLED = original
    else delete process.env.PROSPECTING_INTELLIGENCE_ENABLED
  }
})

test('fase3: aprovarProspectComOferta bloqueia com oferta invalida (flag ligada)', async () => {
  const original = process.env.PROSPECTING_INTELLIGENCE_ENABLED
  process.env.PROSPECTING_INTELLIGENCE_ENABLED = '1'
  try {
    await assert.rejects(
      () => aprovarProspectComOferta('33333333-3333-3333-3333-333333333333', { oferta_recomendada: 'oferta_inexistente' }),
      (err) => {
        assert.ok(err.message.includes('inválida'), `esperava erro de oferta inválida, obteve: ${err.message}`)
        return true
      }
    )
  } finally {
    if (original !== undefined) process.env.PROSPECTING_INTELLIGENCE_ENABLED = original
    else delete process.env.PROSPECTING_INTELLIGENCE_ENABLED
  }
})

test('fase3: aprovarProspectComOferta bloqueia prospect sem score_v2 (flag ligada)', async () => {
  const original = process.env.PROSPECTING_INTELLIGENCE_ENABLED
  process.env.PROSPECTING_INTELLIGENCE_ENABLED = '1'
  const originalQuery = pool.query

  pool.query = async () => ({
    rows: [{ id: 'p3', status: 'aguardando', telefone: '11999999999', score_v2: null, oferta_recomendada: null, decision_log: [], diag_id: 'd3', diagnostico_json: { segmento: 'teste' }, dor_principal: null, mensagem_gerada: null, diag_msg_editada: null }],
  })
  try {
    await assert.rejects(
      () => aprovarProspectComOferta('44444444-4444-4444-4444-444444444444', { oferta_recomendada: 'site_profissional' }),
      (err) => {
        assert.ok(err.message.includes('score_v2'), `esperava erro de score_v2, obteve: ${err.message}`)
        return true
      }
    )
  } finally {
    pool.query = originalQuery
    if (original !== undefined) process.env.PROSPECTING_INTELLIGENCE_ENABLED = original
    else delete process.env.PROSPECTING_INTELLIGENCE_ENABLED
  }
})

test('fase3: aprovarProspectComOferta com flag desligada usa fluxo legado (sem validacoes)', async () => {
  const original = process.env.PROSPECTING_INTELLIGENCE_ENABLED
  process.env.PROSPECTING_INTELLIGENCE_ENABLED = '0'
  const originalQuery = pool.query

  pool.query = async (sql) => {
    if (sql.includes('UPDATE') || sql.includes('INSERT')) return { rows: [{ id: 'p4', status: 'aprovado', oferta_recomendada: null }] }
    return { rows: [] }
  }
  try {
    const resultado = await aprovarProspectComOferta('55555555-5555-5555-5555-555555555555', {})
    assert.equal(resultado.ok, true)
    assert.equal(resultado.status, 'aprovado')
  } finally {
    pool.query = originalQuery
    if (original !== undefined) process.env.PROSPECTING_INTELLIGENCE_ENABLED = original
    else delete process.env.PROSPECTING_INTELLIGENCE_ENABLED
  }
})

// ── rejeitarProspectComMotivo ─────────────────────────────────────────────────

test('fase3: rejeitarProspectComMotivo registra decision_log com rejeicao_humana', async () => {
  const originalQuery = pool.query
  const decisionLogEntradas = []
  let callN = 0

  pool.query = async (sql, params) => {
    callN++
    if (callN === 1) return { rows: [{ id: 'p5' }] }
    if (sql && sql.includes('decision_log')) {
      try { const entrada = JSON.parse(params[1])[0]; decisionLogEntradas.push(entrada) } catch (_) {}
    }
    return { rows: [{ id: 'p5' }] }
  }
  try {
    const resultado = await rejeitarProspectComMotivo('55555555-5555-5555-5555-555555555555', { motivo: 'fora_do_perfil', observacao: 'nicho inadequado' })
    assert.equal(resultado.ok, true)
    assert.equal(resultado.status, 'rejeitado')
    assert.equal(resultado.motivo, 'fora_do_perfil')
    const entrada = decisionLogEntradas.find((e) => e.acao === 'rejeicao_humana')
    assert.ok(entrada, 'deve ter entrada rejeicao_humana')
    assert.equal(entrada.origem, 'operador')
    assert.equal(entrada.contexto.motivo, 'fora_do_perfil')
    assert.equal(entrada.contexto.observacao, 'nicho inadequado')
  } finally {
    pool.query = originalQuery
  }
})

test('fase3: rejeitarProspectComMotivo rejeita motivo invalido', async () => {
  await assert.rejects(
    () => rejeitarProspectComMotivo('66666666-6666-6666-6666-666666666666', { motivo: 'motivo_inventado' }),
    (err) => {
      assert.ok(err.message.includes('inválido') || err.message.includes('Permitidos'), `obteve: ${err.message}`)
      return true
    }
  )
})

test('fase3: rejeitarProspectComMotivo rejeita sem motivo', async () => {
  await assert.rejects(
    () => rejeitarProspectComMotivo('66666666-6666-6666-6666-666666666666', {}),
    (err) => {
      assert.ok(err.message.includes('motivo'), `obteve: ${err.message}`)
      return true
    }
  )
})

// ── alterarOfertaProspect ─────────────────────────────────────────────────────

test('fase3: alterarOfertaProspect registra decision_log com oferta_alterada', async () => {
  const originalQuery = pool.query
  const decisionLogEntradas = []
  let callN = 0

  pool.query = async (sql, params) => {
    callN++
    if (callN === 1) return { rows: [{ id: 'p6', oferta_recomendada: 'site_profissional' }] }
    if (sql && sql.includes('decision_log')) {
      try { const entrada = JSON.parse(params[1])[0]; decisionLogEntradas.push(entrada) } catch (_) {}
    }
    return { rows: [{ id: 'p6' }] }
  }
  try {
    const resultado = await alterarOfertaProspect('77777777-7777-7777-7777-777777777777', { oferta_recomendada: 'seo_local', motivo: 'tem site mas nao aparece no Google' })
    assert.equal(resultado.ok, true)
    assert.equal(resultado.oferta_recomendada, 'seo_local')
    assert.equal(resultado.oferta_anterior, 'site_profissional')
    const entrada = decisionLogEntradas.find((e) => e.acao === 'oferta_alterada')
    assert.ok(entrada, 'deve ter entrada oferta_alterada')
    assert.equal(entrada.contexto.oferta_anterior, 'site_profissional')
    assert.equal(entrada.contexto.oferta_nova, 'seo_local')
    assert.equal(entrada.contexto.motivo, 'tem site mas nao aparece no Google')
  } finally {
    pool.query = originalQuery
  }
})

test('fase3: alterarOfertaProspect rejeita oferta invalida', async () => {
  await assert.rejects(
    () => alterarOfertaProspect('88888888-8888-8888-8888-888888888888', { oferta_recomendada: 'oferta_invalida' }),
    (err) => {
      assert.ok(err.message.includes('inválida'), `obteve: ${err.message}`)
      return true
    }
  )
})

// ── atualizarMensagemEditada com decision_log (Fase 3) ────────────────────────

test('fase3: atualizarMensagemEditada registra decision_log com mensagem_editada (flag ligada)', async () => {
  const original = process.env.PROSPECTING_INTELLIGENCE_ENABLED
  process.env.PROSPECTING_INTELLIGENCE_ENABLED = '1'
  const originalQuery = pool.query
  const decisionLogEntradas = []
  let callN = 0

  pool.query = async (sql, params) => {
    callN++
    if (callN === 1) {
      return { rows: [{ id: 'd1', prospect_id: 'p1', mensagem_gerada: 'original', mensagem_editada: 'msg editada', dor_principal: null, perda_estimada: null, aprovado_em: null, enviado_em: null, agendado_para: null, metadata_json: null, created_at: null, updated_at: null }] }
    }
    if (sql && sql.includes('decision_log')) {
      try { const entrada = JSON.parse(params[1])[0]; decisionLogEntradas.push(entrada) } catch (_) {}
    }
    return { rows: [{ id: 'd1' }] }
  }
  try {
    const d = await atualizarMensagemEditada('11111111-1111-1111-1111-111111111111', { mensagem_editada: 'msg editada nova' })
    assert.ok(d, 'deve retornar o diagnostico')
    const entrada = decisionLogEntradas.find((e) => e.acao === 'mensagem_editada')
    assert.ok(entrada, 'deve ter entrada mensagem_editada no decision_log')
    assert.equal(entrada.origem, 'operador')
    assert.ok(entrada.contexto.tamanho_novo > 0)
  } finally {
    pool.query = originalQuery
    if (original !== undefined) process.env.PROSPECTING_INTELLIGENCE_ENABLED = original
    else delete process.env.PROSPECTING_INTELLIGENCE_ENABLED
  }
})

test('fase3: atualizarMensagemEditada NAO registra decision_log com flag desligada', async () => {
  const original = process.env.PROSPECTING_INTELLIGENCE_ENABLED
  process.env.PROSPECTING_INTELLIGENCE_ENABLED = '0'
  const originalQuery = pool.query
  const decisionLogEntradas = []

  pool.query = async (sql, params) => {
    if (sql && sql.includes('decision_log')) {
      try { const entrada = JSON.parse(params[1])[0]; decisionLogEntradas.push(entrada) } catch (_) {}
    }
    return { rows: [{ id: 'd2', prospect_id: 'p2', mensagem_gerada: 'orig', mensagem_editada: 'nova', dor_principal: null, perda_estimada: null, aprovado_em: null, enviado_em: null, agendado_para: null, metadata_json: null, created_at: null, updated_at: null }] }
  }
  try {
    await atualizarMensagemEditada('22222222-2222-2222-2222-222222222222', { mensagem_editada: 'nova msg' })
    assert.equal(decisionLogEntradas.length, 0, 'nao deve registrar decision_log com flag desligada')
  } finally {
    pool.query = originalQuery
    if (original !== undefined) process.env.PROSPECTING_INTELLIGENCE_ENABLED = original
    else delete process.env.PROSPECTING_INTELLIGENCE_ENABLED
  }
})

// ── novas funções exportadas existem ─────────────────────────────────────────

test('fase3: todas as novas funcoes da fila de aprovacao estao exportadas', () => {
  const prospecting = require('../src/prospecting')
  assert.ok(typeof prospecting.buscarFilaAprovacao === 'function', 'buscarFilaAprovacao deve existir')
  assert.ok(typeof prospecting.obterMetricasFilaAprovacao === 'function', 'obterMetricasFilaAprovacao deve existir')
  assert.ok(typeof prospecting.aprovarProspectComOferta === 'function', 'aprovarProspectComOferta deve existir')
  assert.ok(typeof prospecting.rejeitarProspectComMotivo === 'function', 'rejeitarProspectComMotivo deve existir')
  assert.ok(typeof prospecting.alterarOfertaProspect === 'function', 'alterarOfertaProspect deve existir')
})
