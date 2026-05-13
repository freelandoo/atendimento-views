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
  consumirJobsProspeccao,
  enfileirarJobProspeccao,
  enviarProspectsAprovados,
  gerarDiagnosticos,
  mapearPlace,
  marcarProspectComoRespondeuPorNumero,
  normalizarProspectParaPersistencia,
  obterJanelaSemanal,
  montarAgendaPainelAutoProspeccao,
  obterMetricasProspeccao,
  proximoSlotComercial,
  salvarProspect,
  substituirPlaceholderEmpresa,
  temPlaceholderResidual,
} = require('../src/prospecting')

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
      assert.equal(params[0], 77)
      assert.equal(params[3].toISOString(), '2099-05-12T23:00:00.000Z')
      return { rows: [{ id: 31, status: 'pendente', enviar_em: params[3] }] }
    }
    if (/INSERT INTO vendas\.job_queue/.test(text)) {
      assert.equal(params[0], 'agenda_lembrete_reuniao:31')
      assert.deepEqual(JSON.parse(params[1]), { lembrete_id: 31 })
      assert.equal(params[2].toISOString(), '2099-05-12T23:00:00.000Z')
      return { rows: [{ id: 1001 }] }
    }
    return { rows: [] }
  }
  try {
    const lembrete = await agenda.agendarLembretesReuniao(77)
    assert.equal(lembrete.id, 31)
    assert.ok(calls.some((c) => /agenda_lembretes/.test(c.sql)))
    assert.ok(calls.some((c) => /agenda_lembrete_reuniao:31/.test(String(c.params?.[0]))))
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
    const out = await agenda.registrarRespostaLembreteReuniao('5511999999999', 'confirmado, vou participar')
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
      assert.equal(params[0].toISOString(), '2026-05-12T23:15:00.000Z')
      assert.equal(params[1].toISOString(), '2026-05-12T23:30:00.000Z')
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

test('intencao: lead pergunta preco de primeira recebe identificacao antes de preco', () => {
  const decisao = decidirProximaResposta({
    texto: 'Quanto custa um site?',
    perfil: {},
    estagio: 'primeiro_contato',
    historico: [{ role: 'user', content: 'Quanto custa um site?' }],
  })
  assert.equal(decisao.interpretacao.intencao_principal, 'pergunta_preco')
  assert.equal(decisao.proxima_acao, 'primeiro_contato_assistente')
  assert.equal(decisao.deve_sobrescrever_modelo, true)
  assert.match(decisao.resultado.mensagem_pro_lead, /assistente virtual da PJ Codeworks/i)
  assert.match(decisao.resultado.mensagem_pro_lead, /Funciona assim/i)
  assert.match(decisao.resultado.mensagem_pro_lead, /equipe da PJ Codeworks/)
  assert.match(decisao.resultado.mensagem_pro_lead, /site, sistema, automacao, agente de IA ou uma solucao sob medida/i)
  assert.doesNotMatch(decisao.resultado.mensagem_pro_lead, /R\$|entrada|parcelas|faixa|estimativa/i)
  assert.doesNotMatch(decisao.resultado.mensagem_pro_lead, /tenho 19:30|20:15/i)
  assert.doesNotMatch(decisao.resultado.mensagem_pro_lead, /Victor|aprofundando dor|funil|score|lead quente/i)
})

test('intencao: lead pergunta preco apos diagnostico recebe valor calculado', () => {
  const decisao = decidirProximaResposta({
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
  assert.equal(decisao.proxima_acao, 'responder_preco')
  assert.equal(decisao.resultado.etapa_proxima, 'preco_apresentado')
  assert.match(decisao.resultado.mensagem_pro_lead, /R\$ 920/)
  assert.match(decisao.resultado.mensagem_pro_lead, /equipe da PJ Codeworks confirma/)
  assert.doesNotMatch(decisao.resultado.mensagem_pro_lead, /Victor/)
})

test('intencao: projeto sob medida nunca responde preco automatico ao lead', () => {
  const decisao = decidirProximaResposta({
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

test('intencao: plano personalizado pergunta valor consulta agenda sem mostrar R$', () => {
  const decisao = decidirProximaResposta({
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

test('intencao: preco de sistema automacao ou agente de IA vira reuniao de escopo', () => {
  for (const servico of ['sistema interno', 'automacao comercial', 'agente de IA']) {
    const decisao = decidirProximaResposta({
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
    chamarClaude: async () => {
      throw new Error('nao deve chamar modelo')
    },
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
  assert.match(msg, /projeto sob medida/)
  assert.match(msg, /19:30|20:15/)
  assert.match(msg, /equipe da PJ Codeworks/)
  assert.doesNotMatch(msg, /R\$|entrada|parcelas|3x|faixa|estimativa/i)
  assert.equal(atualizacoes.some((p) => p.reuniao_proposta?.necessaria === true), true)
})

test('intencao: lead pergunta como funciona recebe explicacao antes de agendar', () => {
  const decisao = decidirProximaResposta({
    texto: 'E como faço isso?',
    perfil: { negocio: 'serralheria', cidade: 'Ariquemes' },
    estagio: 'diagnostico',
  })
  assert.equal(decisao.interpretacao.intencao_principal, 'pergunta_como_funciona')
  assert.equal(decisao.proxima_acao, 'explicar_solucao')
  assert.match(decisao.resultado.mensagem_pro_lead, /assist|Entendo rapidamente|PJ Codeworks pode ajudar|equipe da PJ Codeworks/i)
  assert.doesNotMatch(decisao.resultado.mensagem_pro_lead, /tenho 19:30|20:15/i)
  assert.doesNotMatch(decisao.resultado.mensagem_pro_lead, /Victor/)
})

test('intencao: lead diz pretendo com dados minimos conduz para agenda real', () => {
  const decisao = decidirProximaResposta({
    texto: 'Pretendo fazer um site sim',
    perfil: { negocio: 'limpeza de coifas', cidade: 'São Paulo', dor_principal: 'receber mais orçamentos' },
    estagio: 'diagnostico',
  })
  assert.equal(decisao.interpretacao.intencao_principal, 'interesse_inicial')
  assert.equal(decisao.proxima_acao, 'consultar_agenda_e_oferecer_horarios')
  assert.equal(decisao.prioridade_aplicada, 'dados_minimos_coletados')
  assert.equal(decisao.deve_sobrescrever_modelo, true)
})

test('intencao: primeira resposta se identifica e explica processo antes de coletar', () => {
  const decisao = decidirProximaResposta({
    texto: 'Tenho interesse',
    perfil: {},
    estagio: 'primeiro_contato',
    historico: [{ role: 'user', content: 'Tenho interesse' }],
  })
  const msg = decisao.resultado.mensagem_pro_lead
  assert.equal(decisao.proxima_acao, 'primeiro_contato_assistente')
  assert.match(msg, /assistente virtual da PJ Codeworks/i)
  assert.match(msg, /Funciona assim/i)
  assert.match(msg, /site, sistema, automacao, agente de IA ou uma solucao sob medida/i)
  assert.doesNotMatch(msg, /aparece no Google|Victor|aprofundando dor|funil|score|lead quente/i)
})

test('intencao: dados minimos coletados conduzem para agenda real', () => {
  const decisao = decidirProximaResposta({
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

test('intencao: lead escolhe horario quando ha agendamento pendente', () => {
  const decisao = decidirProximaResposta({
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

test('intencao: pedido de reagendamento exige consulta de agenda', () => {
  const decisao = decidirProximaResposta({
    texto: 'Não consigo hoje, pode ser amanhã?',
    perfil: { reuniao_proposta: { necessaria: true, horarios_sugeridos: ['20:15'] } },
    estagio: 'reuniao_agendada',
  })
  assert.equal(decisao.interpretacao.intencao_principal, 'pedido_reagendamento')
  assert.equal(decisao.proxima_acao, 'reagendar')
  assert.equal(decisao.deve_sobrescrever_modelo, true)
})

test('intencao: anti-loop evita repetir resposta', () => {
  const historico = [
    { role: 'assistant', content: 'Os valores dependem do tipo de estrutura.\n\nSites mais simples costumam ter um investimento inicial menor, enquanto projetos com sistema, automação ou estrutura personalizada variam conforme o escopo.\n\nNa reunião, a equipe da PJ Codeworks te passa o valor certo, já com prazo e formato de pagamento.\n\nPra eu te orientar sem chute: qual é o seu negócio e em qual cidade você atende?' },
  ]
  const decisao = decidirProximaResposta({
    texto: 'quanto custa?',
    perfil: {},
    estagio: 'diagnostico',
    historico,
  })
  assert.match(decisao.resultado.mensagem_pro_lead, /reformular/i)
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
    'system.md',
    'system-core.md',
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
  assert.match(primeiroContato, /assistente virtual da PJ Codeworks/)
  assert.match(primeiroContato, /conversa rapida com a nossa equipe/)
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

test('guardrail bloqueia venda direta de projeto personalizado e oferece reuniao', async () => {
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
    // sem buscarSlots → cai no fallback síncrono sugestaoReuniaoProposta
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
      assert.ok(slots.horarios_sugeridos.includes('20:30'))
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
      assert.equal(params[0], '5511998888777')
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
  require('../src/ai-provider').invalidateCache()
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
    // step 2: getAISettings — empty, falls back to env defaults
    if (step === 2) return { rows: [] }
    // step 3: ai_logs INSERT (logs the failed/fallback AI call)
    if (step === 3) return { rows: [] }
    // step 4: salvarDiagnosticoProspect INSERT RETURNING
    if (step === 4) {
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
