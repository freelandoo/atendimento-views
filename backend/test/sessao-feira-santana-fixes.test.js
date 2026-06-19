'use strict'

/**
 * Cobertura dos 4 fixes derivados da sessao test_mpjz7bwd_6tph45
 * (restaurante em Feira de Santana — bot regrediu para primeiro contato).
 *
 *   Fix 1 (P1): typos de "site" ("saite", "saiti", "page", "paginha")
 *               sao reconhecidos como necessidade=site.
 *   Fix 2 (P0): validator sinaliza re-pergunta de menu "site, sistema,
 *               automacao" quando perfil.necessidade ja esta setado.
 *   Fix 3 (P0): validator sinaliza re-greeting do bot (saudacao +
 *               auto-apresentacao) quando ha 2+ turnos do assistant.
 *   Fix 4 (P1): orquestrador forca convite_reuniao quando perfil esta
 *               completo e a conversa ja tem 8+ mensagens.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { decidirProximaAcao, extrairDadosMensagem } = require('../src/next-action-orchestrator')
const { validarRespostaPorAcao } = require('../src/action-response-validator')

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

function fakeHistorico(turnos) {
  return turnos.map((t, i) => ({ role: t.role, content: t.content }))
}

// ─── Fix 1 — Typos de "site" ───────────────────────────────────────────────

test('Fix 1: "Saite" e reconhecido como necessidade=site', () => {
  const d = extrairDadosMensagem('Saite')
  assert.equal(d.necessidade, 'site')
})

test('Fix 1: "Quero um saite para minha empresa" extrai necessidade=site', () => {
  const d = extrairDadosMensagem('Quero um saite para minha empresa')
  assert.equal(d.necessidade, 'site')
})

test('Fix 1: "paginha" e "page" tambem viram site', () => {
  assert.equal(extrairDadosMensagem('preciso de uma paginha').necessidade, 'site')
  assert.equal(extrairDadosMensagem('quero uma page').necessidade, 'site')
})

// ─── Fix 2 — Re-pergunta de menu de necessidade ────────────────────────────

test('Fix 2: "Voce busca site, sistema, automacao ou IA?" e sinalizado quando perfil.necessidade ja existe', () => {
  const msg = 'Voce busca site, sistema, automacao ou presenca no Google?'
  const v = validarRespostaPorAcao(resultado([msg]), {
    decisao: { acao_decidida: 'diagnostico', etapa_sugerida: 'coleta_basica' },
    perfil: { negocio: 'restaurante', cidade: 'Feira de Santana', necessidade: 'site' },
    etapaAtual: 'diagnostico',
    historico: [],
  })
  assert.equal(v.bloqueado, false)
  assert.ok(v.avisos.some((e) => e.erro === 'repetiu_pergunta_necessidade'),
    `esperava repetiu_pergunta_necessidade, obteve ${JSON.stringify(v.avisos)}`)
})

test('Fix 2: "voce procura site ou sistema?" tambem e sinalizado', () => {
  const v = validarRespostaPorAcao(resultado(['Voce procura site, sistema, automacao ou solucao?']), {
    decisao: { acao_decidida: 'diagnostico', etapa_sugerida: 'coleta_basica' },
    perfil: { negocio: 'restaurante', cidade: 'Feira de Santana', necessidade: 'site' },
    etapaAtual: 'diagnostico',
    historico: [],
  })
  assert.equal(v.bloqueado, false)
  assert.ok(v.avisos.some((e) => e.erro === 'repetiu_pergunta_necessidade'))
})

test('Fix 2: pergunta legitima de necessidade NAO e bloqueada quando perfil.necessidade vazio', () => {
  const v = validarRespostaPorAcao(resultado(['Voce procura site, sistema, automacao ou solucao?']), {
    decisao: { acao_decidida: 'diagnostico', etapa_sugerida: 'coleta_basica' },
    perfil: { negocio: 'restaurante', cidade: 'Feira de Santana' /* sem necessidade */ },
    etapaAtual: 'diagnostico',
    historico: [],
  })
  // Esse caso pode ter outros erros, mas NAO repetiu_pergunta_necessidade
  assert.ok(!v.erros.some((e) => e.erro === 'repetiu_pergunta_necessidade'))
})

// ─── Fix 3 — Re-greeting ───────────────────────────────────────────────────

test('Fix 3: "Oi! Sou da PJ Codeworks. Voce busca..." e sinalizado apos 2+ turnos do assistant', () => {
  const historico = [
    { role: 'user', content: 'Oi' },
    { role: 'assistant', content: 'Oi! Tudo bem? Aqui é o assistente da PJ Codeworks 👋' },
    { role: 'user', content: 'Quero site' },
    { role: 'assistant', content: 'Otimo! Qual seu negocio?' },
    { role: 'user', content: 'restaurante' },
    { role: 'assistant', content: 'Boa! E qual cidade?' },
  ]
  const v = validarRespostaPorAcao(
    resultado(['Oi! Sou da PJ Codeworks. Voce busca site, sistema, automacao ou presenca no Google?']),
    {
      decisao: { acao_decidida: 'diagnostico', etapa_sugerida: 'coleta_basica' },
      perfil: { negocio: 'restaurante', necessidade: 'site' },
      etapaAtual: 'diagnostico',
      historico,
    }
  )
  assert.equal(v.bloqueado, false)
  assert.ok(v.avisos.some((e) => e.erro === 'regreeting_apos_apresentacao'),
    `esperava regreeting_apos_apresentacao, obteve ${JSON.stringify(v.avisos)}`)
})

test('Fix 3: saudacao inicial (sem turnos previos do assistant) NAO e bloqueada', () => {
  const v = validarRespostaPorAcao(
    resultado(['Oi! Tudo bem? Aqui é o assistente da PJ Codeworks 👋 Com o que voce trabalha hoje?']),
    {
      decisao: { acao_decidida: 'primeiro_contato', etapa_sugerida: 'coleta_basica' },
      perfil: {},
      etapaAtual: 'primeiro_contato',
      historico: [{ role: 'user', content: 'Oi' }], // sem assistant antes
    }
  )
  assert.ok(!v.erros.some((e) => e.erro === 'regreeting_apos_apresentacao'),
    'saudacao inicial nunca pode ser bloqueada por regreeting')
})

test('Fix 3: resposta normal do bot (sem auto-apresentacao) NAO e bloqueada como regreeting', () => {
  const historico = [
    { role: 'user', content: 'oi' },
    { role: 'assistant', content: 'Oi! Tudo bem? Aqui é o assistente da PJ Codeworks 👋' },
    { role: 'user', content: 'restaurante' },
  ]
  const v = validarRespostaPorAcao(
    resultado(['Boa! E em qual cidade voce atende?']),
    {
      decisao: { acao_decidida: 'diagnostico', etapa_sugerida: 'coleta_basica' },
      perfil: { negocio: 'restaurante' },
      etapaAtual: 'diagnostico',
      historico,
    }
  )
  assert.ok(!v.erros.some((e) => e.erro === 'regreeting_apos_apresentacao'))
})

// ─── Fix 4 — Forcar convite quando perfil completo + historico longo ──────

test('Fix 4: perfil completo + historico 8+ msgs forca consultar_agenda', () => {
  const historico = Array.from({ length: 10 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: 'x',
  }))
  const d = decidirProximaAcao({
    mensagemAtual: 'so aqui no insta manooo',
    perfil: {
      negocio: 'restaurante',
      cidade: 'Feira de Santana',
      necessidade: 'site',
      origem_clientes: 'instagram',
    },
    historico,
    etapaAtual: 'diagnostico',
  })
  assert.equal(d.acao_decidida, 'consultar_agenda',
    `esperava consultar_agenda, obteve ${d.acao_decidida}`)
  assert.match(d.motivo_decisao, /perfil_completo_historico_longo/)
})

test('Fix 4: perfil completo mas historico curto (5 msgs) continua coletando', () => {
  const historico = Array.from({ length: 5 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: 'x',
  }))
  const d = decidirProximaAcao({
    mensagemAtual: 'instagram',
    perfil: {
      negocio: 'restaurante',
      cidade: 'Feira de Santana',
      necessidade: 'site',
      origem_clientes: 'instagram',
    },
    historico,
    etapaAtual: 'diagnostico',
  })
  // Nao forca consultar_agenda — pode ser conexao_valor ou responder_duvida
  assert.notEqual(d.motivo_decisao, 'perfil_completo_historico_longo_avancar_para_reuniao')
})

test('Fix 4: perfil incompleto + historico longo NAO forca convite (precisa coletar dado)', () => {
  const historico = Array.from({ length: 10 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: 'x',
  }))
  const d = decidirProximaAcao({
    mensagemAtual: 'oi',
    perfil: { /* sem dados */ },
    historico,
    etapaAtual: 'diagnostico',
  })
  // Lead avancado nao recebe primeiro_contato, mas tambem nao deve ser
  // forcado a consultar_agenda sem dados minimos
  assert.notEqual(d.acao_decidida, 'consultar_agenda')
})

test('Fix 4: lead ja com reuniao confirmada NAO recebe nova consultar_agenda', () => {
  const historico = Array.from({ length: 12 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: 'x',
  }))
  const d = decidirProximaAcao({
    mensagemAtual: 'tudo certo',
    perfil: {
      negocio: 'restaurante',
      cidade: 'Feira de Santana',
      necessidade: 'site',
      origem_clientes: 'instagram',
      reuniao_confirmada: true,
    },
    historico,
    etapaAtual: 'reuniao_agendada',
  })
  assert.notEqual(d.acao_decidida, 'consultar_agenda',
    'reuniao ja confirmada nao deve disparar nova consulta de agenda')
})
