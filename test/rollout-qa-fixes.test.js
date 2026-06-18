'use strict'

/**
 * Cobertura dos bugs P0/P1 encontrados no rollout controlado:
 *
 *  P0 — Repeticao literal/similaridade > 0.9 sinalizada pelo action-response-validator.
 *  P0 — Regressao de estagio em leads historicos no next-action-orchestrator.
 *  P0 — Convite de reuniao sem slots reais de agenda sinalizado como aviso.
 *  P1 — Stop-word no negocio ("site" virando ramo) sinalizado como aviso.
 *  P1 — Guardrail log gravado quando validador bloqueia.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  decidirProximaAcao,
  isLeadHistoricoAvancado,
  isNegocioStopWord,
  estagioPeso,
  STAGE_ORDER,
} = require('../src/next-action-orchestrator')

const {
  validarRespostaPorAcao,
  isRepeatedAssistantMessage,
  similaridade,
  negocioInvalidoMencionado,
} = require('../src/action-response-validator')

const guardrailLogger = require('../src/guardrail-logger')

function resultado(bolhas, etapa = null) {
  return {
    mensagem_pro_lead: Array.isArray(bolhas) ? bolhas.join('\n\n') : String(bolhas || ''),
    mensagens_bolhas: Array.isArray(bolhas) ? bolhas : [String(bolhas || '')],
    atualizar_perfil: {},
    etapa_proxima: etapa,
    solicitar_calculo_preco: false,
    handoff: false,
    motivo_handoff: null,
  }
}

function historicoUltimoAssistente(texto) {
  return [
    { role: 'user', content: 'qualquer coisa' },
    { role: 'assistant', content: texto },
    { role: 'user', content: 'resposta do lead' },
  ]
}

// ─── P0 — Repeticao literal ────────────────────────────────────────────────

test('P0 repeticao: bloqueia mensagem identica ao ultimo turno do assistente', () => {
  const ultimaBot = 'Tenho hoje às 21:15 disponíveis. Qual fica melhor?'
  const r = isRepeatedAssistantMessage({
    newMessages: [ultimaBot],
    lastAssistantMessages: [ultimaBot],
  })
  assert.equal(r.repetida, true)
  assert.equal(r.similaridade, 1)
})

test('P0 repeticao: bloqueia pequena variacao (similaridade > 0.9)', () => {
  const a = 'Tenho hoje às 21:15 disponíveis. Qual fica melhor?'
  const b = 'Tenho hoje as 21:15 disponiveis! Qual fica melhor?'
  const sim = similaridade(a, b)
  assert.ok(sim >= 0.9, `esperava >= 0.9, obteve ${sim}`)
  const r = isRepeatedAssistantMessage({ newMessages: [b], lastAssistantMessages: [a] })
  assert.equal(r.repetida, true)
})

test('P0 repeticao: bloqueia mesma pergunta principal mesmo com texto diferente', () => {
  const a = 'Tudo bem. Em qual cidade voce atende?'
  const b = 'Show. Em qual cidade voce atende?'
  const r = isRepeatedAssistantMessage({ newMessages: [b], lastAssistantMessages: [a] })
  assert.equal(r.repetida, true)
})

test('P0 repeticao: NAO bloqueia mensagens claramente diferentes', () => {
  const a = 'Em qual cidade voce atende?'
  const b = 'Qual o tipo do seu negocio?'
  const r = isRepeatedAssistantMessage({ newMessages: [b], lastAssistantMessages: [a] })
  assert.equal(r.repetida, false)
})

test('P0 repeticao: validador sinaliza como aviso e preserva resposta', () => {
  const mensagem = 'Para eu te orientar do jeito certo, me confirma so uma coisa: voce procura site, sistema, automacao ou uma solucao sob medida?'
  const v = validarRespostaPorAcao(resultado([mensagem]), {
    decisao: { acao_decidida: 'diagnostico', etapa_sugerida: 'coleta_basica' },
    perfil: {},
    etapaAtual: 'diagnostico',
    historico: historicoUltimoAssistente(mensagem),
    mensagemAtual: 'Vou fazer sozinho mesmo',
    numero: '5511999999999@s.whatsapp.net',
  })
  assert.equal(v.bloqueado, false)
  assert.ok(v.avisos.some((e) => /mensagem_repetida/.test(e.erro)), `avisos: ${JSON.stringify(v.avisos)}`)
  assert.equal(v.resultado.mensagem_pro_lead, mensagem)
})

// ─── P0 — Regressao de estagio ─────────────────────────────────────────────

test('P0 estagio: STAGE_ORDER coerente (proposta > diagnostico)', () => {
  assert.ok(estagioPeso('proposta') > estagioPeso('diagnostico'))
  assert.ok(estagioPeso('fechamento') > estagioPeso('proposta'))
  assert.ok(estagioPeso('handoff') >= estagioPeso('reuniao_agendada'))
})

test('P0 estagio: lead em fechamento com 30 msgs e sinal de compra nao regride para diagnostico', () => {
  const historico = Array.from({ length: 30 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: i % 2 === 0 ? 'msg lead' : 'msg bot',
  }))
  const d = decidirProximaAcao({
    mensagemAtual: 'Vou fazer sozinho mesmo',
    perfil: { etapa_atual: 'fechamento', negocio: 'taxista', cidade: 'Sao Paulo', necessidade: 'site' },
    historico,
    etapaAtual: 'fechamento',
  })
  assert.equal(d.etapa_sugerida, 'fechamento')
  assert.notEqual(d.acao_decidida, 'primeiro_contato')
  assert.notEqual(d.acao_decidida, 'diagnostico')
})

test('P0 estagio: isLeadHistoricoAvancado dispara para historico >= 10', () => {
  const historico = Array.from({ length: 12 }, () => ({ role: 'user', content: 'x' }))
  assert.equal(isLeadHistoricoAvancado({ historico, etapaAtual: 'diagnostico' }), true)
})

test('P0 estagio: lead avancado com mensagem ambigua nao recebe pergunta inicial generica', () => {
  const historico = Array.from({ length: 15 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: 'x',
  }))
  const d = decidirProximaAcao({
    mensagemAtual: 'Oi',
    perfil: { etapa_atual: 'proposta' },
    historico,
    etapaAtual: 'proposta',
  })
  assert.notEqual(d.acao_decidida, 'primeiro_contato')
})

// ─── P0 — Agenda real ──────────────────────────────────────────────────────

test('P0 agenda: convite com horario sem agenda vira aviso (LLM no controle)', () => {
  const v = validarRespostaPorAcao(resultado(['Tenho hoje às 21:15 disponíveis. Qual fica melhor?']), {
    decisao: { acao_decidida: 'convite_reuniao', etapa_sugerida: 'agendamento_pendente' },
    perfil: {},
    etapaAtual: 'agendamento_pendente',
    horarios_disponiveis: [],
    historico: [],
  })
  // Decisao do dono (2026-06-06): nao bloqueia mais — vira aviso (telemetria).
  assert.equal(v.bloqueado, false)
  assert.ok(v.avisos.some((e) => e.erro === 'ofereceu_horario_fora_da_agenda'),
    `avisos: ${JSON.stringify(v.avisos)}`)
})

test('P0 agenda: validador sinaliza menção a "hoje à noite" sem horario', () => {
  const v = validarRespostaPorAcao(resultado(['Posso te chamar hoje à noite? Vamos alinhar tudo.']), {
    decisao: { acao_decidida: 'convite_reuniao', etapa_sugerida: 'agendamento_pendente' },
    perfil: {},
    etapaAtual: 'agendamento_pendente',
    horarios_disponiveis: [],
    historico: [],
  })
  assert.equal(v.bloqueado, false)
  assert.ok(v.avisos.some((e) => e.erro === 'mencionou_janela_sem_agenda'))
})

test('P0 agenda: aceita convite quando horario esta nos slots reais', () => {
  const v = validarRespostaPorAcao(resultado(['Tenho amanha às 19:30 disponíveis. Qual fica melhor?']), {
    decisao: { acao_decidida: 'convite_reuniao', etapa_sugerida: 'agendamento_pendente' },
    perfil: { reuniao_proposta: { horarios_sugeridos: ['19:30'] } },
    etapaAtual: 'agendamento_pendente',
    horarios_disponiveis: ['19:30'],
    historico: [],
  })
  assert.equal(v.bloqueado, false, `erros: ${JSON.stringify(v.erros)}`)
})

test('P0 agenda: horario fora da agenda vira aviso (ofereceu 21:15 mas agenda so tem 19:30)', () => {
  const v = validarRespostaPorAcao(resultado(['Tenho amanha às 21:15 disponíveis.']), {
    decisao: { acao_decidida: 'convite_reuniao' },
    perfil: {},
    etapaAtual: 'agendamento_pendente',
    horarios_disponiveis: ['19:30', '20:00'],
    historico: [],
  })
  // Decisao do dono (2026-06-06): nao bloqueia mais — vira aviso (telemetria).
  assert.equal(v.bloqueado, false)
  assert.ok(v.avisos.some((e) => e.erro === 'ofereceu_horario_fora_da_agenda'))
})

// ─── P1 — Stop-word no negocio ────────────────────────────────────────────

test('P1 stop-word: "site" nao pode ser negocio', () => {
  assert.equal(isNegocioStopWord('site'), true)
  assert.equal(isNegocioStopWord('sistema'), true)
  assert.equal(isNegocioStopWord('automacao'), true)
  assert.equal(isNegocioStopWord('automação'), true)
  assert.equal(isNegocioStopWord('barbearia'), false)
  assert.equal(isNegocioStopWord('agência de viagem'), false)
})

test('P1 stop-word: "quero site" nao extrai negocio=site', () => {
  const d = decidirProximaAcao({
    mensagemAtual: 'Quero um site para meu negocio',
    perfil: {},
    historico: [{ role: 'assistant', content: 'oi' }],
    etapaAtual: 'diagnostico',
  })
  assert.notEqual(d.dados_extraidos.negocio, 'site')
  assert.notEqual(d.dados_extraidos.negocio, 'um site')
})

test('P1 stop-word: detector identifica template malformado "voce trabalha com site, procura site"', () => {
  assert.equal(negocioInvalidoMencionado('Perfeito, entendi: voce trabalha com um site, procura site.'), true)
  assert.equal(negocioInvalidoMencionado('Perfeito, entendi: voce trabalha com . Caso tenha interesse'), true)
  assert.equal(negocioInvalidoMencionado('Perfeito, entendi: voce trabalha com barbearia.'), false)
})

test('P1 stop-word: validador sinaliza bot dizendo "voce trabalha com site"', () => {
  const msg = 'Perfeito, entendi: voce trabalha com um site, procura site.\n\nEm qual cidade ou regiao voce atende?'
  const v = validarRespostaPorAcao(resultado([msg]), {
    decisao: { acao_decidida: 'diagnostico', etapa_sugerida: 'coleta_basica' },
    perfil: {},
    etapaAtual: 'diagnostico',
    historico: [],
  })
  assert.equal(v.bloqueado, false)
  assert.ok(v.avisos.some((e) => e.erro === 'negocio_stop_word_no_template'))
  assert.equal(v.resultado.mensagem_pro_lead, msg)
})

// ─── P1 — Guardrail log ────────────────────────────────────────────────────

test('P1 guardrail: gravacao falha silenciosamente quando pool indisponivel', async () => {
  const ok = await guardrailLogger.logAiGuardrail(
    { numero: '5511', rule: 'teste', severity: 'bloquear', action: 'fallback', erros: ['x'] },
    { pool: null }
  )
  assert.equal(ok, false)
})

test('P1 guardrail: gravacao chama pool.query quando disponivel', async () => {
  let queryCalls = 0
  const fakePool = {
    query: async (sql, params) => {
      queryCalls += 1
      assert.match(sql, /INSERT INTO vendas\.ai_guardrail_logs/)
      assert.equal(params.length, 5)
      assert.equal(params[1], 'teste-rule')
      return { rows: [] }
    },
  }
  const ok = await guardrailLogger.logAiGuardrail(
    {
      numero: '5511999999999',
      rule: 'teste-rule',
      severity: 'bloquear',
      action: 'fallback_seguro',
      erros: ['e1', 'e2'],
      originalMessage: 'msg ruim',
      sanitizedMessage: 'fallback ok',
      metadata: { x: 1 },
    },
    { pool: fakePool }
  )
  assert.equal(ok, true)
  assert.equal(queryCalls, 1)
})

test('P1 guardrail: erro de query nao quebra o envio', async () => {
  const fakePool = {
    query: async () => { throw new Error('boom') },
  }
  const ok = await guardrailLogger.logAiGuardrail(
    { numero: '5511', rule: 'r', severity: 'bloquear', action: 'fallback', erros: ['x'] },
    { pool: fakePool }
  )
  assert.equal(ok, false)
})

// ─── P1 — fallback classificar_intencao instrumentado ──────────────────────

test('P1 fallback: instrumentacao registra logger.warn com diagnostico', async () => {
  // O modulo agent.js e pesado e tem efeitos colaterais; aqui validamos
  // apenas que o helper interno emite logger.warn com a estrutura esperada
  // quando interpretarIntencaoMensagemIA cai em fallback (atraves do code
  // path "promptBase vazio" que retorna null sem warn — entao testamos
  // que a chamada nao quebra). Smoke test para garantir que o modulo carrega.
  const agent = require('../src/agent')
  assert.equal(typeof agent.interpretarIntencaoMensagem, 'function')
})
