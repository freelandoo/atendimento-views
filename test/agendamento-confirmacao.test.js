'use strict'

// Garante o fluxo de agendamento da IA ponta a ponta na parte deterministica:
// bot ofereceu "19:30 ou 20:00" -> lead escolhe "20:00" -> a confirmacao grava
// horario_confirmado + data_sugerida e dispara handoff com motivo
// 'agendou_reuniao_proposta' (que é o que faz alertarHandoff criar o evento na
// Agenda). Antes, com o orquestrador novo, confirmacao_reuniao caía no LLM sem
// garantia desses campos — entao o evento podia nao ser criado.

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { createCoreFunnel } = require('../src/core-funnel')
const { decidirProximaAcao } = require('../src/next-action-orchestrator')
const dateUtils = require('../src/date-utils')

function montarCoreFunnel(extra = {}) {
  return createCoreFunnel({
    logger: { info() {}, warn() {}, error() {} },
    parsearHorarioReuniao: dateUtils.parsearHorarioReuniao,
    dataInicioReuniao: dateUtils.dataInicioReuniao,
    calcularFimReuniao: dateUtils.calcularFimReuniao,
    ...extra,
  })
}

const PERFIL_COM_SLOTS = {
  numero: '5511999990000@s.whatsapp.net',
  negocio: 'topografia',
  cidade: 'Salvador',
  reuniao_proposta: {
    necessaria: true,
    data_sugerida: '2026-05-28',
    horarios_sugeridos: ['19:30', '20:00'],
    horario_confirmado: null,
  },
}

test('orquestrador roteia "as 20:00" (horario oferecido) para confirmacao_reuniao', () => {
  const d = decidirProximaAcao({
    mensagemAtual: 'as 20:00',
    historico: [
      { role: 'assistant', content: 'Tenho amanhã às 19:30 ou às 20:00 disponíveis. Qual fica melhor?' },
      { role: 'user', content: 'as 20:00' },
    ],
    perfil: PERFIL_COM_SLOTS,
    etapaAtual: 'agendamento_pendente',
  })
  assert.equal(d.acao_decidida, 'confirmacao_reuniao')
  assert.equal(d.dados_extraidos.horario, '20:00')
})

test('confirmacao_reuniao deterministica: grava horario + data e dispara handoff p/ Agenda', () => {
  const cf = montarCoreFunnel()
  const decisao = {
    acao_decidida: 'confirmacao_reuniao',
    etapa_sugerida: 'reuniao_agendada',
    rota_comercial: 'projeto_sob_medida',
    dados_extraidos: { horario: '20:00' },
  }
  const r = cf.resultadoDeterministicoPorAcao(decisao, PERFIL_COM_SLOTS, null)

  assert.ok(r, 'deve retornar um resultado deterministico (nao cair no LLM)')
  // Campos que alertarHandoff usa para criar o evento na Agenda:
  assert.equal(r.handoff, true)
  assert.equal(r.motivo_handoff, 'agendou_reuniao_proposta')
  assert.equal(r.atualizar_perfil.reuniao_proposta.horario_confirmado, '20:00')
  assert.equal(r.atualizar_perfil.reuniao_proposta.data_sugerida, '2026-05-28')
  assert.ok(r.atualizar_perfil.reuniao_proposta.data_inicio, 'data_inicio ISO calculada')
  assert.ok(r.atualizar_perfil.reuniao_proposta.data_fim, 'data_fim ISO calculada')
  assert.equal(r.etapa_proxima, 'reuniao_agendada')
  // Mensagem de confirmacao com data (28/05) e horario (20:00):
  assert.match(r.mensagem_pro_lead, /20:00/)
  assert.match(r.mensagem_pro_lead, /28\/05/)
  assert.match(r.mensagem_pro_lead, /marcad/i)
})

test('convite_reuniao deterministico: oferta baseada NOS slots consultados', () => {
  const cf = montarCoreFunnel()
  const slots = { data_sugerida: '2026-05-28', data_label: '28/05', horarios_sugeridos: ['19:30', '20:00'] }
  const decisao = {
    acao_decidida: 'convite_reuniao',
    etapa_sugerida: 'sob_medida_agenda_oferecida',
    dados_extraidos: { horarios_sugeridos: ['19:30', '20:00'], data_sugerida: '2026-05-28' },
  }
  const r = cf.resultadoDeterministicoPorAcao(decisao, { negocio: 'topografia' }, slots)
  assert.ok(r, 'deve montar a oferta deterministica a partir dos slots')
  // A mensagem reflete EXATAMENTE os slots consultados:
  assert.match(r.mensagem_pro_lead, /19:30/)
  assert.match(r.mensagem_pro_lead, /20:00/)
  assert.match(r.mensagem_pro_lead, /qual fica melhor/i)
  // E persiste os slots no perfil pra o turno de confirmacao validar a escolha:
  assert.deepEqual(r.atualizar_perfil.reuniao_proposta.horarios_sugeridos, ['19:30', '20:00'])
  assert.equal(r.atualizar_perfil.reuniao_proposta.data_sugerida, '2026-05-28')
  assert.equal(r.etapa_proxima, 'agendamento_pendente')
})

test('convite_reuniao sem slots reais nao gera oferta deterministica (cai no LLM)', () => {
  const cf = montarCoreFunnel()
  const r = cf.resultadoDeterministicoPorAcao(
    { acao_decidida: 'convite_reuniao', dados_extraidos: {} },
    { negocio: 'x' },
    { erro: 'agenda_indisponivel', data_sugerida: null, horarios_sugeridos: [] }
  )
  assert.equal(r, null)
})

// ─── Tom de IA com fatos travados (oferta/confirmacao) ──────────────────────

test('fluxo site: entrada pede negocio, cidade e objetivo sem handoff', () => {
  const cf = montarCoreFunnel()
  const decisao = decidirProximaAcao({
    mensagemAtual: 'Oi, queria fazer um site',
    historico: [{ role: 'user', content: 'Oi, queria fazer um site' }],
    perfil: {},
    etapaAtual: 'primeiro_contato',
  })
  const r = cf.resultadoDeterministicoPorAcao(decisao, {}, null)

  assert.equal(decisao.acao_decidida, 'primeiro_contato')
  assert.equal(decisao.dados_extraidos.necessidade, 'site')
  assert.equal(r.handoff, false)
  assert.equal(r.etapa_proxima, 'diagnostico')
  assert.match(r.mensagem_pro_lead, /Qual e o seu negocio/i)
  assert.match(r.mensagem_pro_lead, /cidade ou regiao/i)
  assert.match(r.mensagem_pro_lead, /objetivo do site/i)
})

test('fluxo site: negocio e cidade decidem conexao_valor sem agenda (Fase 3: texto vai pro LLM)', () => {
  const cf = montarCoreFunnel()
  const perfil = { produto_sugerido: 'site' }
  const decisao = decidirProximaAcao({
    mensagemAtual: 'Tenho uma clinica de estetica em Santo Andre',
    historico: [
      { role: 'assistant', content: 'Qual e o seu negocio? Qual cidade ou regiao voce atende? Qual o objetivo do site?' },
      { role: 'user', content: 'Tenho uma clinica de estetica em Santo Andre' },
    ],
    perfil,
    etapaAtual: 'diagnostico',
  })
  const perfilAtualizado = { ...perfil, ...decisao.dados_extraidos }
  const r = cf.resultadoDeterministicoPorAcao(decisao, perfilAtualizado, null)

  // A DECISAO segue conexao_valor (negocio+cidade, sem objetivo -> nao agenda).
  assert.equal(decisao.acao_decidida, 'conexao_valor')
  assert.notEqual(decisao.acao_decidida, 'consultar_agenda')
  // Fase 3: conexao_valor nao tem mais template fixo — resultado deterministico
  // e null e a mensagem passa a ser composta pelo LLM (lendo o contexto).
  assert.equal(r, null)
})

test('fluxo site: objetivo claro permite convite, mas nao handoff antes da escolha de horario', () => {
  const cf = montarCoreFunnel()
  const slots = { data_sugerida: '2026-05-28', data_label: 'hoje', horarios_sugeridos: ['19:30', '20:00'] }
  const perfil = {
    negocio: 'clinica de estetica',
    cidade: 'Santo Andre',
    produto_sugerido: 'site',
    eventos_conversa: { objetivo_site: 'aparecer melhor e receber chamadas no WhatsApp' },
  }
  const decisao = decidirProximaAcao({
    mensagemAtual: 'Quero aparecer mais e receber mais chamadas no WhatsApp',
    historico: [
      { role: 'assistant', content: 'Hoje seus clientes chegam mais por indicacao, Instagram ou Google?' },
      { role: 'user', content: 'Quero aparecer mais e receber mais chamadas no WhatsApp' },
    ],
    perfil,
    etapaAtual: 'diagnostico',
  })
  const r = cf.resultadoDeterministicoPorAcao({ ...decisao, acao_decidida: 'convite_reuniao' }, perfil, slots)

  assert.equal(decisao.acao_decidida, 'consultar_agenda')
  assert.equal(decisao.motivo_decisao, 'site_com_negocio_cidade_objetivo_avancar_para_reuniao')
  assert.equal(r.handoff, false)
  assert.equal(r.etapa_proxima, 'agendamento_pendente')
  assert.match(r.mensagem_pro_lead, /19:30/)
  assert.match(r.mensagem_pro_lead, /20:00/)
})

test('fluxo site: preco, pesquisa e sem interesse nao disparam agenda indevida', () => {
  const base = {
    negocio: 'clinica de estetica',
    cidade: 'Santo Andre',
    produto_sugerido: 'site',
    eventos_conversa: { objetivo_site: 'receber contatos pelo WhatsApp' },
  }
  const preco = decidirProximaAcao({ mensagemAtual: 'Quanto custa?', historico: [], perfil: base, etapaAtual: 'diagnostico' })
  const pesquisa = decidirProximaAcao({ mensagemAtual: 'So estou pesquisando', historico: [], perfil: base, etapaAtual: 'diagnostico' })
  const optOut = decidirProximaAcao({ mensagemAtual: 'Nao tenho interesse', historico: [], perfil: base, etapaAtual: 'diagnostico' })

  assert.equal(preco.acao_decidida, 'responder_preco_sem_contexto')
  assert.equal(preco.etapa_sugerida, 'diagnostico')
  assert.equal(pesquisa.acao_decidida, 'lead_pesquisando')
  assert.equal(pesquisa.etapa_sugerida, 'diagnostico')
  assert.equal(optOut.acao_decidida, 'opt_out')
  assert.equal(optOut.etapa_sugerida, 'opt_out')
})

test('reformulacao IA aceita quando preserva horarios e data (oferta)', async () => {
  const cf = montarCoreFunnel({
    gerarTextoIA: async () =>
      'Show! Pra te mostrar na prática, bora marcar 15 min com a equipe? Tenho hoje às 19:30 ou 20:00 — qual fica melhor?',
  })
  const out = await cf.reformularTextoReuniaoComIA({
    acao: 'convite_reuniao',
    textoBase: 'Tenho hoje às 19:30 ou 20:00 disponíveis. Qual fica melhor?',
    horariosObrig: ['19:30', '20:00'],
    dataObrig: 'hoje',
    perfil: { negocio: 'barbearia' },
  })
  assert.match(out, /19:30/)
  assert.match(out, /20:00/)
})

test('reformulacao IA REJEITADA quando inventa horario diferente', async () => {
  const cf = montarCoreFunnel({
    gerarTextoIA: async () => 'Que tal amanhã às 18:00? Te espero!', // horario inventado
  })
  const out = await cf.reformularTextoReuniaoComIA({
    acao: 'convite_reuniao',
    textoBase: 'Tenho hoje às 19:30 ou 20:00 disponíveis. Qual fica melhor?',
    horariosObrig: ['19:30', '20:00'],
    dataObrig: 'hoje',
    perfil: {},
  })
  assert.equal(out, null) // mantem deterministico
})

test('reformulacao IA REJEITADA quando cita preco', async () => {
  const cf = montarCoreFunnel({
    gerarTextoIA: async () => 'Fechado, às 20:00 no dia 28/05. Fica R$ 1500 o projeto.',
  })
  const out = await cf.reformularTextoReuniaoComIA({
    acao: 'confirmacao_reuniao',
    textoBase: 'Sua reunião está marcada para 28/05 às 20:00. Qual o melhor e-mail?',
    horariosObrig: ['20:00'],
    dataObrig: '28/05',
    perfil: {},
  })
  assert.equal(out, null)
})

test('reformulacao IA aceita confirmacao que mantem horario + data', async () => {
  const cf = montarCoreFunnel({
    gerarTextoIA: async () => 'Perfeito! Fechei pra você dia 28/05 às 20:00. Qual o melhor e-mail pra eu te mandar o convite?',
  })
  const out = await cf.reformularTextoReuniaoComIA({
    acao: 'confirmacao_reuniao',
    textoBase: 'Sua reunião está marcada para 28/05 às 20:00. Qual o melhor e-mail?',
    horariosObrig: ['20:00'],
    dataObrig: '28/05',
    perfil: {},
  })
  assert.match(out, /20:00/)
  assert.match(out, /28\/05/)
})

test('reformulacao IA: sem gerarTextoIA, mantem deterministico (null)', async () => {
  const cf = montarCoreFunnel() // sem gerarTextoIA
  const out = await cf.reformularTextoReuniaoComIA({
    acao: 'convite_reuniao',
    textoBase: 'Tenho hoje às 19:30 ou 20:00 disponíveis. Qual fica melhor?',
    horariosObrig: ['19:30', '20:00'],
    dataObrig: 'hoje',
    perfil: {},
  })
  assert.equal(out, null)
})

test('confirmacao_reuniao NAO confirma horario que nao foi oferecido', () => {
  const cf = montarCoreFunnel()
  const decisao = {
    acao_decidida: 'confirmacao_reuniao',
    etapa_sugerida: 'reuniao_agendada',
    dados_extraidos: { horario: '21:00' }, // nao esta em ['19:30','20:00']
  }
  const r = cf.resultadoDeterministicoPorAcao(decisao, PERFIL_COM_SLOTS, null)
  // Sem confirmacao deterministica falsa: retorna null (fluxo segue/re-oferta).
  assert.equal(r, null)
})
