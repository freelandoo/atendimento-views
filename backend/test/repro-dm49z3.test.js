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
 *   2. o validador REGISTRA a deteccao
 *   3. a deteccao nao se perde em silencio
 *
 * ─── POR QUE ISTO NAO BLOQUEIA MAIS ────────────────────────────────────────────
 * Ate a fusao do core na base SaaS multiempresa (d31f8b6, 2026-06-17), erro de CONTEUDO
 * barrava a mensagem e trocava por fallback. Depois dela, `ERROS_BLOQUEANTES_ACAO` passou a
 * ter so' os 3 erros TECNICOS (`json_invalido`, `acao_invalida`, `sem_mensagem_publica`) — o
 * conteudo ficou com o LLM, e todo guardrail de conteudo virou AVISO ("LLM no controle", em
 * action-response-validator.js:19).
 *
 * Este teste foi reescrito para travar o que de fato precisa continuar valendo: o detector
 * `botReGreeting` CONTINUA reconhecendo a regressao e ela CONTINUA sendo registrada. Se um dia
 * a politica voltar a bloquear, e aqui que a mudanca aparece.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { validarRespostaPorAcao } = require('../src/action-response-validator')

test('dm49z3: bot "Oi! Sou da PJ Codeworks. Voce busca site, sistema..." e DETECTADO como re-greeting', () => {
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

  const codigos = [...v.erros, ...(v.avisos || [])].map((e) => e.erro)

  assert.ok(codigos.includes('regreeting_apos_apresentacao'),
    `esperava regreeting_apos_apresentacao, obtido: ${codigos.join(', ')}`)

  // O re-greeting e' erro de CONTEUDO: hoje avisa, nao bloqueia. Travar a severidade junto da
  // deteccao e' o que torna uma mudanca de politica visivel em vez de silenciosa.
  assert.equal(v.bloqueado, false, 'guardrail de conteudo avisa, nao bloqueia (ver cabecalho)')
  assert.ok((v.avisos || []).some((a) => a.erro === 'regreeting_apos_apresentacao'),
    'a deteccao tem de chegar como aviso — se sumir, o detector parou de funcionar')
})
