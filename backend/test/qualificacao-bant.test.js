'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const {
  mesclarQualificacaoBant,
  avaliarQualificacaoBant,
  resumoQualificacaoBant,
} = require('../src/services/qualificacao-bant')

test('BANT aproveita budget informado junto da resposta sobre necessidade', () => {
  const estado = mesclarQualificacaoBant({}, {
    necessidade: { status: 'confirmada', evidencia: 'Perde contatos porque anota tudo no WhatsApp.' },
    budget: { status: 'sem_caixa_agora', evidencia: 'Este mês não consigo investir.', precisa_esclarecer: true },
  })
  assert.strictEqual(estado.necessidade.status, 'confirmada')
  assert.strictEqual(estado.budget.status, 'sem_caixa_agora')
  assert.strictEqual(estado.proxima_dimensao, 'timing')
  assert.ok(!estado.campos_pendentes.includes('necessidade'))
})

test('BANT preserva uma resposta confirmada quando o turno seguinte não traz esse eixo', () => {
  const anterior = {
    necessidade: { status: 'confirmada', evidencia: 'Quer organizar os leads.' },
    timing: { status: 'agora', evidencia: 'Quer resolver ainda este mês.' },
  }
  const estado = mesclarQualificacaoBant(anterior, {
    autoridade: { status: 'decisor', evidencia: 'Eu mesmo decido isso.' },
  })
  assert.strictEqual(estado.necessidade.status, 'confirmada')
  assert.strictEqual(estado.timing.status, 'agora')
  assert.strictEqual(estado.autoridade.status, 'decisor')
  assert.strictEqual(estado.proxima_dimensao, 'budget')
})

test('BANT só fica pronto para assunção com os quatro eixos positivos e conhecidos', () => {
  const estado = avaliarQualificacaoBant({
    necessidade: { status: 'confirmada', evidencia: 'Precisa de CRM para não perder oportunidades.' },
    timing: { status: 'curto_prazo', evidencia: 'Quer implantar nas próximas semanas.' },
    autoridade: { status: 'decisor', evidencia: 'É o dono e decide a compra.' },
    budget: { status: 'aberto_a_avaliar', evidencia: 'Tem verba se fizer sentido.', precisa_esclarecer: false },
  })
  assert.strictEqual(estado.status, 'pronto_para_assuncao')
  assert.strictEqual(estado.proxima_dimensao, null)
  assert.match(resumoQualificacaoBant(estado), /Orçamento: Tem verba/i)
})

test('BANT não transforma falta de caixa em qualificação; pede esclarecimento antes', () => {
  const estado = avaliarQualificacaoBant({
    necessidade: { status: 'confirmada' },
    timing: { status: 'agora' },
    autoridade: { status: 'decisor' },
    budget: { status: 'sem_caixa_agora', evidencia: 'Agora não tenho dinheiro.', precisa_esclarecer: true },
  })
  assert.strictEqual(estado.status, 'em_qualificacao')
  assert.strictEqual(estado.proxima_dimensao, 'budget')
})
