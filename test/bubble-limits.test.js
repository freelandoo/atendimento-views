'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  limiteBolhasPorEtapa,
  limitarBolhasPorEtapa,
} = require('../src/message-limits')
const { validarRespostaAntesDeEnviar } = require('../src/agent-validators')
const { renderPublicReplyFromAiResponse } = require('../src/ai-response')

test('limiteBolhasPorEtapa: primeiro contato permite somente 1 bolha', () => {
  assert.equal(limiteBolhasPorEtapa('primeiro_contato'), 1)
  assert.equal(limiteBolhasPorEtapa('new_lead'), 1)
})

test('limitarBolhasPorEtapa: primeiro contato compacta excesso em 1 bolha', () => {
  const out = limitarBolhasPorEtapa({
    etapa: 'primeiro_contato',
    mensagens: ['Oi! Sou da PJ Codeworks.', 'Te ajudo por aqui.', 'Qual solucao voce busca?'],
  })
  assert.equal(out.length, 1)
  assert.match(out[0], /PJ Codeworks/)
  assert.doesNotMatch(out[0], /\n\n/)
})

test('limitarBolhasPorEtapa: diagnostico nunca passa de 2 bolhas', () => {
  const out = limitarBolhasPorEtapa({
    etapa: 'diagnostico',
    mensagens: ['Boa.', 'Entendi seu negocio.', 'Agora preciso entender a origem dos clientes.', 'Eles chegam por Instagram ou Google?'],
  })
  assert.equal(out.length, 2)
  assert.match(out[1], /origem dos clientes/)
})

test('validarRespostaAntesDeEnviar compacta mensagens_bolhas acima do limite da etapa', () => {
  const r = validarRespostaAntesDeEnviar({
    mensagem_pro_lead: 'Oi',
    mensagens_bolhas: ['Oi! Sou da PJ Codeworks.', 'Te ajudo por aqui.', 'Qual solucao voce busca?'],
    etapa_proxima: 'diagnostico',
  }, {}, { contexto: { estagio: 'primeiro_contato' } })

  assert.equal(r.bloqueado, false)
  assert.equal(r.resultado.mensagens_bolhas.length, 1)
})

test('renderPublicReplyFromAiResponse compacta bolhas do simulador por etapa', () => {
  const raw = JSON.stringify({
    mensagens_bolhas: ['Oi! Sou da PJ Codeworks.', 'Te ajudo por aqui.', 'Qual solucao voce busca?'],
    etapa_proxima: 'diagnostico',
  })
  const rendered = renderPublicReplyFromAiResponse(raw, { channel: 'test', etapa: 'primeiro_contato' })

  assert.equal(rendered.ok, true)
  assert.equal(rendered.publicMessages.length, 1)
  assert.doesNotMatch(rendered.reply, /mensagens_bolhas|```|{/)
})

test('aceite fluxo: resposta do LLM com 4 bolhas e limitada para no maximo 2', () => {
  const raw = JSON.stringify({
    mensagens_bolhas: [
      'Primeira mensagem.',
      'Segunda mensagem.',
      'Terceira mensagem.',
      'Quarta mensagem.',
    ],
    etapa_proxima: 'diagnostico',
  })
  const rendered = renderPublicReplyFromAiResponse(raw, { channel: 'test', etapa: 'diagnostico' })

  assert.equal(rendered.ok, true)
  assert.equal(rendered.publicMessages.length, 2)
  assert.doesNotMatch(rendered.reply, /Quarta mensagem\.\n\n/)
})
