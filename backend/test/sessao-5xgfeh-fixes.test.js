'use strict'

/**
 * Cobre os bugs da sessao test_mpk3djpn_5xgfeh:
 *
 * 1. `ia_alterou_etapa` bloqueava mensagens boas quando o LLM retornava
 *    `etapa_proxima: primeiro_contato` e a decisao esperava `coleta_basica`.
 *    As duas pertencem ao mesmo bloco canonico de diagnostico inicial.
 *
 * 2. O fallback default devolvia o anti-padrao:
 *    "voce procura site, sistema, automacao ou solucao sob medida?"
 *
 * 3. Em primeiro contato, fallback deve usar abertura curta, nao menu.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  validarRespostaPorAcao,
  fallbackSeguroPorAcao,
  fallbackContextual,
} = require('../src/action-response-validator')

function resultado(bolhas, etapaProxima = null) {
  return {
    mensagem_pro_lead: Array.isArray(bolhas) ? bolhas.join('\n\n') : String(bolhas || ''),
    mensagens_bolhas: Array.isArray(bolhas) ? bolhas : [String(bolhas || '')],
    atualizar_perfil: {},
    etapa_proxima: etapaProxima,
    solicitar_calculo_preco: false,
    handoff: false,
    motivo_handoff: null,
  }
}

test('Bug 1: primeiro_contato e coleta_basica sao etapas compativeis no validator', () => {
  const v = validarRespostaPorAcao(
    resultado(['Oi! Tudo bem? Aqui e o assistente da PJ Codeworks. Com o que voce trabalha hoje?'], 'primeiro_contato'),
    {
      decisao: { acao_decidida: 'primeiro_contato', etapa_sugerida: 'coleta_basica' },
      perfil: {},
      etapaAtual: 'primeiro_contato',
      historico: [{ role: 'user', content: 'Oi' }],
      mensagemAtual: 'Oi',
    }
  )

  assert.equal(v.bloqueado, false, `esperava nao-bloqueio, erros: ${JSON.stringify(v.erros)}`)
})

test('Bug 1: coleta_basica continua passando quando decisao tambem e coleta_basica', () => {
  const v = validarRespostaPorAcao(
    resultado(['Otimo. Qual e o ramo do seu negocio?'], 'coleta_basica'),
    {
      decisao: { acao_decidida: 'diagnostico', etapa_sugerida: 'coleta_basica' },
      perfil: {},
      etapaAtual: 'primeiro_contato',
      historico: [
        { role: 'user', content: 'Oi' },
        { role: 'assistant', content: 'Oi! Tudo bem?' },
        { role: 'user', content: 'Quero site' },
      ],
      mensagemAtual: 'Quero site',
    }
  )

  assert.equal(v.bloqueado, false, `erros: ${JSON.stringify(v.erros)}`)
})

test('Bug 1: salto real para fechamento sinaliza ia_alterou_etapa como aviso', () => {
  const v = validarRespostaPorAcao(
    resultado(['Fechado! Vamos marcar a reuniao.'], 'fechamento'),
    {
      decisao: { acao_decidida: 'diagnostico', etapa_sugerida: 'coleta_basica' },
      perfil: {},
      etapaAtual: 'primeiro_contato',
      historico: [{ role: 'user', content: 'Oi' }],
      mensagemAtual: 'Oi',
    }
  )

  assert.equal(v.bloqueado, false)
  assert.ok(v.avisos.some((e) => e.erro === 'ia_alterou_etapa'))
})

test('Bug 2: fallback default nao contem menu proibido', () => {
  const fb = fallbackSeguroPorAcao({ decisao: { acao_decidida: 'responder_duvida' } })
  assert.doesNotMatch(fb, /procura site,?\s*sistema,?\s*automacao/i)
})

test('Bug 2: fallback para acao desconhecida nao contem menu proibido', () => {
  const fb = fallbackSeguroPorAcao({ decisao: { acao_decidida: 'acao_inventada' } })
  assert.doesNotMatch(fb, /procura site,?\s*sistema,?\s*automacao/i)
})

test('Bug 2: fallback por necessidade faltante apresenta site, sistema ou IA (sem menu longo)', () => {
  const fb = fallbackContextual(
    {
      decisao: { acao_decidida: 'diagnostico', etapa_sugerida: 'coleta_basica' },
      perfil: { negocio: 'restaurante', cidade: 'Salvador' },
      etapaAtual: 'primeiro_contato',
    },
    ['ia_alterou_etapa']
  )

  // Continua proibido o menu LONGO antigo ("site, sistema, automacao, ...");
  // a pergunta agora apresenta exatamente as tres opcoes site/sistema/IA.
  assert.doesNotMatch(fb, /procura site,?\s*sistema,?\s*automacao/i)
  assert.match(fb, /um site, um sistema ou um agente de ia/i)
})

test('Bug 3: fallback para primeiro_contato e abertura curta', () => {
  const fb = fallbackSeguroPorAcao({ decisao: { acao_decidida: 'primeiro_contato' } })
  assert.match(fb, /Oi! Tudo bem\? Aqui e o assistente da {{empresa}}/)
  assert.doesNotMatch(fb, /procura site,?\s*sistema,?\s*automacao/i)
})

test('5xgfeh: abertura legitima nao e bloqueada', () => {
  const v = validarRespostaPorAcao(
    resultado(['Oi! Tudo bem? Aqui e o assistente da PJ Codeworks. Com o que voce trabalha hoje?'], 'primeiro_contato'),
    {
      decisao: { acao_decidida: 'primeiro_contato', etapa_sugerida: 'coleta_basica' },
      perfil: {},
      etapaAtual: 'primeiro_contato',
      historico: [{ role: 'user', content: 'Oi' }],
      mensagemAtual: 'Oi',
    }
  )

  assert.equal(v.bloqueado, false, `erros: ${JSON.stringify(v.erros)}`)
})

test('5xgfeh: follow-up normal de restaurante na Bahia nao e bloqueado', () => {
  const v = validarRespostaPorAcao(
    resultado(['Entendi, restaurante na Bahia. Hoje seus clientes chegam mais por indicacao, Instagram ou Google?'], 'coleta_basica'),
    {
      decisao: { acao_decidida: 'diagnostico', etapa_sugerida: 'coleta_basica' },
      perfil: { negocio: 'restaurante', cidade: 'Bahia', necessidade: 'site' },
      etapaAtual: 'primeiro_contato',
      historico: [
        { role: 'user', content: 'Oi' },
        { role: 'assistant', content: 'Oi! Tudo bem? Aqui e o assistente da PJ Codeworks.' },
        { role: 'user', content: 'Quero site' },
        { role: 'assistant', content: 'Perfeito. Qual seu negocio?' },
        { role: 'user', content: 'Restaurante na Bahia' },
      ],
      mensagemAtual: 'Restaurante na Bahia',
    }
  )

  assert.equal(v.bloqueado, false, `erros: ${JSON.stringify(v.erros)}`)
})
