'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  validarRespostaAntesDeEnviar,
  validarMensagemString,
} = require('../src/agent-validators')
const { validarRespostaPorAcao } = require('../src/action-response-validator')

function resultado(mensagem, etapa = 'diagnostico') {
  return {
    mensagem_pro_lead: mensagem,
    mensagens_bolhas: [mensagem],
    atualizar_perfil: {},
    etapa_proxima: etapa,
    solicitar_calculo_preco: false,
    handoff: false,
    motivo_handoff: null,
  }
}

// Decisao do dono (2026-06-06): "LLM 100% no controle". Os guardrails de CONTEUDO
// (PII/pagamento, link, preco, horario, repeticao, menu...) NAO bloqueiam mais — viram
// AVISO (telemetria) e a resposta da IA segue para o lead. So bloqueiam as travas
// tecnicas (sem mensagem valida pra enviar / JSON cru / vazamento de handoff interno).

test('guardrail: dados sensiveis/pagamento viram aviso, nao bloqueiam mais', () => {
  const r = validarRespostaAntesDeEnviar(
    resultado('Me passa seu CPF e uma chave Pix para iniciar o pagamento por aqui?'),
    {},
    { contexto: { estagio: 'diagnostico', numero: '5511999999999@s.whatsapp.net' } }
  )
  assert.equal(r.bloqueado, false)
  assert.equal(r.alertarOperador, false)
  assert.ok(r.erros.some((e) => e.codigo === 'dados_pagamento_proibidos' && e.severidade === 'avisar'))
})

test('guardrail: link nao autorizado vira aviso, nao bloqueia mais', () => {
  const r = validarRespostaAntesDeEnviar(resultado('Pode acessar aqui: https://example.com/pagamento'), {})
  assert.equal(r.bloqueado, false)
  assert.ok(r.erros.some((e) => e.codigo === 'link_nao_autorizado' && e.severidade === 'avisar'))
})

test('guardrail: preco em contexto sob medida vira aviso, nao bloqueia mais', () => {
  const r = validarMensagemString('Fica em R$ 1.500 com entrada e 3 parcelas.', { projeto_sob_medida: true })
  assert.equal(r.ok, true)
  assert.ok(r.erros.some((e) => e.codigo === 'preco_sob_medida' && e.severidade === 'avisar'))
})

test('guardrail: regras de qualidade viram aviso, nao bloqueio', () => {
  const r = validarMensagemString('**Importante**\n1. item\n2. item\n3. item\nQual cidade? Qual objetivo?', {})
  assert.equal(r.ok, true)
  assert.ok(r.erros.length >= 2)
  assert.ok(r.erros.every((e) => e.severidade === 'avisar'))
})

test('guardrail de acao: confirma horario nao oferecido vira aviso, nao bloqueia mais', () => {
  const v = validarRespostaPorAcao(resultado('Perfeito, reunião marcada para 21:15.'), {
    decisao: { acao_decidida: 'confirmacao_reuniao', etapa_sugerida: 'agendamento_pendente' },
    perfil: { horarios_oferecidos: ['19:30'] },
    etapaAtual: 'agendamento_pendente',
    mensagemAtual: '21:15',
    historico: [],
  })
  assert.equal(v.bloqueado, false)
  assert.ok(v.avisos.some((e) => e.erro === 'confirmou_horario_nao_oferecido'))
})

test('guardrail de acao: meta linguagem vira aviso, nao bloqueio', () => {
  const v = validarRespostaPorAcao(resultado('Vou reformular sem repetir essa pergunta: em qual cidade voce atende?'), {
    decisao: { acao_decidida: 'diagnostico', etapa_sugerida: 'coleta_basica' },
    perfil: {},
    etapaAtual: 'diagnostico',
    historico: [],
  })
  assert.equal(v.bloqueado, false)
  assert.ok(v.avisos.some((e) => e.erro === 'meta_language_proibida'))
})

test('guardrail tecnico: mensagem vazia ainda bloqueia (trava tecnica)', () => {
  const r = validarRespostaAntesDeEnviar(resultado('   '), {})
  assert.equal(r.bloqueado, true)
})
