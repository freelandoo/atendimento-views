'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { calcularScoreInteresseLead } = require('../src/services/lead-interest-score')

test('score_interesse: lead com preco, proximo passo e urgencia fica alto', () => {
  const out = calcularScoreInteresseLead(
    {
      negocio: 'Clinica estetica',
      dor_principal: 'poucos clientes pelo Google',
      produto_sugerido: 'site',
      temperatura_lead: 'quente',
      insights_lead: { urgencia: 'alta', eh_decisor: 'sim' },
    },
    {
      estagio: 'proposta',
      historico: [
        { role: 'user', content: 'Tenho uma clinica e preciso aparecer melhor no Google.' },
        { role: 'assistant', content: 'Posso te explicar.' },
        { role: 'user', content: 'Quanto fica? Quero comecar essa semana, pode mandar a proposta.' },
      ],
    }
  )
  assert.equal(out.faixa, 'alto')
  assert.ok(out.score >= 70)
  assert.ok(out.criterios.some((c) => c.titulo.includes('preco')))
  assert.ok(out.criterios.some((c) => c.titulo.includes('proximo passo')))
})

test('score_interesse: lead so pesquisando e postergando fica baixo', () => {
  const out = calcularScoreInteresseLead(
    { negocio: 'Barbearia', temperatura_lead: 'frio' },
    {
      estagio: 'primeiro_contato',
      historico: [
        { role: 'user', content: 'Oi' },
        { role: 'assistant', content: 'Como posso ajudar?' },
        { role: 'user', content: 'So pesquisando mesmo, vou ver depois.' },
      ],
    }
  )
  assert.equal(out.faixa, 'baixo')
  assert.ok(out.score < 40)
  assert.ok(out.criterios.some((c) => c.delta < 0 && c.titulo.includes('Postergou')))
})

test('score_interesse: silencio apos resposta do agente reduz interesse', () => {
  const out = calcularScoreInteresseLead(
    {
      negocio: 'Pintor',
      dor_principal: 'poucos contatos',
      produto_sugerido: 'site',
      temperatura_lead: 'morno',
    },
    {
      estagio: 'diagnostico',
      atualizadoEm: '2026-06-10T10:00:00.000Z',
      now: '2026-06-18T10:00:00.000Z',
      historico: [
        { role: 'user', content: 'Preciso de mais clientes para pintura residencial.' },
        { role: 'assistant', content: 'Perfeito, posso te mostrar o caminho.' },
      ],
    }
  )
  assert.ok(out.criterios.some((c) => c.delta < 0 && c.titulo.includes('Sem resposta')))
  assert.ok(out.score < 60)
})

