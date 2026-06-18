'use strict'

/**
 * Repro EXATO da sessao test_mpk2u15v_dm49z3 (14:54 GMT-3).
 *
 * Lead path:
 *   Oi -> Restaurante na Bahia -> Salvador -> Instagram
 * Bot regrediu com:
 *   "Oi! Sou da PJ Codeworks. Você busca site, sistema, automação ou presença no Google?"
 *
 * Verifica:
 *   1. botReGreeting detecta corretamente
 *   2. validador bloqueia
 *   3. fallback contextual substitui
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { validarRespostaPorAcao } = require('../src/action-response-validator')

test('dm49z3: bot "Oi! Sou da PJ Codeworks. Voce busca site, sistema..." e BLOQUEADO', () => {
  const bolhaSingle = 'Oi! Sou da PJ Codeworks. Você busca site, sistema, automação ou presença no Google?'

  const historico = [
    { role: 'user', content: 'Oi' },
    { role: 'assistant', content: 'Oi, Lead Teste! Aqui é o assistente da PJ Codeworks 👋 Com o que você trabalha hoje?' },
    { role: 'user', content: 'Restaurante na Bahia' },
    { role: 'assistant', content: 'Ótimo! Restaurante na Bahia — qual cidade? E hoje como vocês recebem clientes. Indicação, redes sociais, Google.' },
    { role: 'user', content: 'Salvador' },
    { role: 'assistant', content: 'Perfeito, restaurante em Salvador. Hoje seus clientes chegam mais por indicação, redes sociais ou Google?' },
    { role: 'user', content: 'Instagram' },
  ]

  const perfil = {
    negocio: 'restaurante',
    cidade: 'Salvador',
    origem_clientes: 'instagram',
    // necessidade FICA VAZIA — o lead nao disse "site" nessa sessao
  }

  const resultado = {
    mensagem_pro_lead: bolhaSingle,
    mensagens_bolhas: [bolhaSingle],
    atualizar_perfil: {},
    etapa_proxima: 'primeiro_contato',
  }

  const v = validarRespostaPorAcao(resultado, {
    decisao: { acao_decidida: 'primeiro_contato', etapa_sugerida: 'coleta_basica' },
    perfil,
    etapaAtual: 'primeiro_contato',
    historico,
    mensagemAtual: 'Instagram',
  })

  console.log('[dm49z3] bloqueado:', v.bloqueado)
  console.log('[dm49z3] erros:', v.erros.map((e) => e.erro))
  console.log('[dm49z3] fallback:', v.resultado.mensagem_pro_lead)

  assert.equal(v.bloqueado, true, 'esperava bloqueio')
  const codigos = v.erros.map((e) => e.erro)
  assert.ok(codigos.includes('regreeting_apos_apresentacao'),
    `esperava regreeting_apos_apresentacao, obtido: ${codigos.join(', ')}`)
})
