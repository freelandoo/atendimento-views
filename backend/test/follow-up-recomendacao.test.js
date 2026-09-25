'use strict'

const test = require('node:test')
const assert = require('node:assert')

const {
  escolherEstagio,
  montarPlanoFollowUpLead,
} = require('../src/services/follow-up-recomendacao')

const AGORA = new Date('2026-09-25T12:00:00-03:00')

test('Proposta B: lead frio usa teto curto de 2 follow-ups e 3 ligacoes', () => {
  const plano = montarPlanoFollowUpLead({
    lead: { status: 'aprovado' },
    fatos: { followUps: 0, ligacoes: 1 },
    agora: AGORA,
  })
  assert.equal(plano.estagio.chave, 'sem_contato')
  assert.equal(plano.limites.followUps.teto, 2)
  assert.equal(plano.limites.ligacoes.teto, 3)
  assert.equal(plano.recomendacao.canal, 'whatsapp')
})

test('Proposta B: proposta enviada libera cadencia maior de 5 follow-ups', () => {
  const plano = montarPlanoFollowUpLead({
    lead: { status: 'respondeu' },
    fatos: { propostas: 1, followUps: 2, ligacoes: 2 },
    agora: AGORA,
  })
  assert.equal(plano.estagio.chave, 'proposta_enviada')
  assert.equal(plano.estagio.sinal, 'quente')
  assert.equal(plano.limites.followUps.teto, 5)
  assert.equal(plano.limites.followUps.restante, 3)
  assert.equal(plano.recomendacao.modelo, 'confirmar_recebimento_proposta')
})

test('Proposta B: reuniao marcada fica acima de proposta e sugere confirmacao', () => {
  assert.equal(escolherEstagio({ status: 'respondeu' }, { propostas: 1, reunioesMarcadas: 1 }), 'reuniao_marcada')
  const plano = montarPlanoFollowUpLead({
    lead: { status: 'respondeu' },
    fatos: { propostas: 1, reunioesFuturas: 1, followUps: 1 },
    agora: AGORA,
  })
  assert.equal(plano.limites.followUps.teto, 5)
  assert.equal(plano.recomendacao.modelo, 'confirmar_presenca_reuniao')
})

test('Proposta B: ao bater o teto, recomendacao vira ultima tentativa com justificativa', () => {
  const plano = montarPlanoFollowUpLead({
    lead: { status: 'enviado' },
    fatos: { followUps: 2, ligacoes: 3 },
    agora: AGORA,
  })
  assert.equal(plano.estagio.chave, 'sem_contato')
  assert.equal(plano.limites.followUps.atingido, true)
  assert.equal(plano.limites.ligacoes.atingido, true)
  assert.equal(plano.recomendacao.modelo, 'ultima_tentativa')
  assert.equal(plano.recomendacao.exige_justificativa, true)
  assert.match(plano.avisos.join(' '), /Limite/)
})

test('Proposta B: lead encerrado ou numero invalido nao recebe nova tentativa', () => {
  const encerrado = montarPlanoFollowUpLead({
    lead: { status: 'rejeitado' },
    fatos: {},
    agora: AGORA,
  })
  assert.equal(encerrado.estagio.chave, 'encerrado')
  assert.equal(encerrado.recomendacao.acao, 'nenhuma')

  const numeroInvalido = montarPlanoFollowUpLead({
    lead: { status: 'enviado' },
    fatos: { numeroInvalido: true, followUps: 1 },
    agora: AGORA,
  })
  assert.equal(numeroInvalido.estagio.chave, 'encerrado')
  assert.equal(numeroInvalido.opcoes.length, 0)
})
