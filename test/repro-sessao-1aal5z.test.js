'use strict'

/**
 * Reproducao da sessao test_mpk16x4q_1aal5z (barbearia em SBC).
 *
 * No turno final, o bot gerou:
 *   "Oi! Sou da PJ Codeworks.
 *    Você busca site, sistema, automação ou presença no Google?"
 *
 * Esperamos que o validador sinalize por:
 *   - regreeting_apos_apresentacao (Fix 3)
 *   - repetiu_pergunta_necessidade (Fix 2)
 *
 * Se esse teste passar, o validator esta sinalizando — o problema esta
 * em outro lugar (provavelmente: codigo nao foi deployado em producao).
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { validarRespostaPorAcao } = require('../src/action-response-validator')

test('repro 1aal5z: validador sinaliza "Oi! Sou da PJ Codeworks. Voce busca site, sistema..."', () => {
  const historico = [
    { role: 'user', content: 'Oi' },
    { role: 'assistant', content: 'Oi! Tudo bem? Aqui é o assistente da PJ Codeworks 👋 Com o que você trabalha hoje.' },
    { role: 'user', content: 'Quero criar um site para minha empresa' },
    { role: 'assistant', content: 'Ótimo! Qual é o ramo da sua empresa? E em qual cidade você atende.' },
    { role: 'user', content: 'SBC' },
    { role: 'assistant', content: 'Perfeito, Sao Bernardo do Campo!\n\nE qual é o ramo da sua empresa?' },
    { role: 'user', content: 'Barbearia' },
    { role: 'assistant', content: 'Barbearia em SBC — ótimo!\n\nHoje seus clientes chegam mais por indicação, Instagram ou Google?' },
    { role: 'user', content: 'Instagram' },
    { role: 'assistant', content: 'Faz sentido, o Instagram ajuda bastante na vitrine dos trabalhos.\n\nVocê já tem um site também ou só o Instagram por enquanto?' },
    { role: 'user', content: 'so aqui no insta manooo' },
  ]

  const perfil = {
    negocio: 'barbearia',
    cidade: 'Sao Bernardo do Campo',
    produto_sugerido: 'site',
    dor_principal: 'site',
    origem_clientes: 'instagram',
  }

  const bolhas = [
    'Oi! Sou da PJ Codeworks.',
    'Você busca site, sistema, automação ou presença no Google?',
  ]

  const resultado = {
    mensagem_pro_lead: bolhas.join('\n\n'),
    mensagens_bolhas: bolhas,
    atualizar_perfil: {},
    etapa_proxima: 'diagnostico',
  }

  const v = validarRespostaPorAcao(resultado, {
    decisao: { acao_decidida: 'diagnostico', etapa_sugerida: 'coleta_basica' },
    perfil,
    etapaAtual: 'diagnostico',
    historico,
    mensagemAtual: 'so aqui no insta manooo',
  })

  console.log('[repro] bloqueado:', v.bloqueado)
  console.log('[repro] avisos:', v.avisos.map((e) => e.erro))
  console.log('[repro] fallback:', v.resultado.mensagem_pro_lead)

  assert.equal(v.bloqueado, false, 'deve apenas sinalizar')
  const codigos = v.avisos.map((e) => e.erro)
  assert.ok(codigos.includes('regreeting_apos_apresentacao'),
    `esperava regreeting_apos_apresentacao, obtido: ${codigos.join(', ')}`)
  assert.ok(codigos.includes('repetiu_pergunta_necessidade'),
    `esperava repetiu_pergunta_necessidade, obtido: ${codigos.join(', ')}`)
})
