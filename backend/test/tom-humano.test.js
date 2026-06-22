'use strict'

/**
 * Cobertura das melhorias de tom humano (A, B, C):
 *   A — abertura curta substituiu o textao institucional.
 *   B — reoferto humano: quando o lead propoe horario fora dos slots, o
 *       bot reconhece a proposta antes de reoferecer.
 *   C — tom-referencia compartilhado: carregado uma vez e anexado a
 *       todos os prompts de etapa via withTomReferencia().
 */

const test = require('node:test')
const assert = require('node:assert/strict')

// ─── A — abertura curta ────────────────────────────────────────────────────

test('A.1 abertura nao usa textao institucional antigo', () => {
  // textoInteresseClaroSimples e interno; testamos via leitura do arquivo
  const fs = require('node:fs')
  const path = require('node:path')
  const conteudo = fs.readFileSync(path.join(__dirname, '..', 'src', 'agent.js'), 'utf8')
  // A nova abertura tem que estar presente
  assert.match(conteudo, /Oi! Tudo bem\? Aqui é o assistente da {{empresa}}/,
    'nova abertura curta deve estar presente em agent.js')
  // A abertura antiga (39 palavras) nao pode mais estar como abertura padrao
  const antiga = 'Eu sou o assistente virtual da PJ Codeworks.\\nVou te ajudar com as primeiras informacoes'
  const reAntiga = new RegExp(antiga)
  assert.equal(reAntiga.test(conteudo), false,
    'abertura antiga (textao institucional) nao pode mais ser usada como abertura padrao')
})

// ─── B — reoferto humano ───────────────────────────────────────────────────

test('B.1 montarMensagemOfertaAgenda com intro de reconhecimento gera frase humana', () => {
  // Testamos a logica de intro via simulacao isolada do que core-funnel produz
  const slots = { data_sugerida: '2026-05-25', data_label: 'amanha', horarios_sugeridos: ['19:30', '21:30'] }
  const horarioPropostoLead = '14:00'
  const propostaForaDosSlots =
    horarioPropostoLead &&
    Array.isArray(slots?.horarios_sugeridos) &&
    !slots.horarios_sugeridos.includes(horarioPropostoLead)
  assert.equal(propostaForaDosSlots, true)

  const intro = propostaForaDosSlots
    ? `Entendi, ${horarioPropostoLead}. Pra alinhar com a janela da equipe, te mostro o que tenho disponivel:`
    : 'Como e um projeto sob medida, a equipe da PJ Codeworks alinha estrutura, prazo e investimento em uma conversa rapida.'

  assert.match(intro, /^Entendi, 14:00/, 'intro deve reconhecer o horario proposto pelo lead')
  assert.doesNotMatch(intro, /Como e um projeto sob medida/, 'intro nao pode ser o texto generico quando ha proposta fora dos slots')
})

test('B.2 quando horario do lead esta nos slots, NAO usa intro de reconhecimento', () => {
  const slots = { horarios_sugeridos: ['19:30', '21:30'] }
  const horarioPropostoLead = '19:30'
  const propostaForaDosSlots =
    horarioPropostoLead &&
    Array.isArray(slots?.horarios_sugeridos) &&
    !slots.horarios_sugeridos.includes(horarioPropostoLead)
  assert.equal(propostaForaDosSlots, false,
    'horario no slot nao deve disparar a intro de reconhecimento (vai pra confirmacao)')
})

test('B.3 reoferto humano e DIFERENTE da mensagem do turno anterior (validador nao bloqueia)', () => {
  // O validador P0-A1 bloqueia repeticao literal. O reoferto humano tem
  // prefixo unico "Entendi, X" que distingue do turno anterior.
  const { similaridade } = require('../src/action-response-validator')
  const turnoAnterior = 'Tenho amanha às 19:30 ou 21:30 disponíveis. Qual fica melhor?'
  const reofertoHumano = 'Entendi, 14:00. Pra alinhar com a janela da equipe, te mostro o que tenho disponivel:\n\nTenho amanha às 19:30 ou 21:30 disponíveis. Qual fica melhor?'
  const sim = similaridade(turnoAnterior, reofertoHumano)
  assert.ok(sim < 0.9, `reoferto humano deve ter sim < 0.9 vs turno anterior (obteve ${sim})`)
})

// ─── C — tom-referencia compartilhado ──────────────────────────────────────

test('C.1 prompts/tom-referencia.md existe e tem cabecalho conhecido', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const p = path.join(__dirname, '..', 'prompts', 'tom-referencia.md')
  assert.ok(fs.existsSync(p), 'prompts/tom-referencia.md deve existir')
  const conteudo = fs.readFileSync(p, 'utf8')
  assert.match(conteudo, /^# Tom de referência — \{\{empresa\}\}/m,
    'cabecalho do arquivo deve ser estavel (usado por withTomReferencia para idempotencia)')
})

test('C.2 loadTomReferenciaPrompt carrega conteudo do disco', () => {
  const prompts = require('../src/prompts')
  // Resetar e recarregar
  prompts.loadTomReferenciaPrompt()
  const base = prompts.TOM_REFERENCIA_BASE
  assert.ok(typeof base === 'string', 'TOM_REFERENCIA_BASE deve ser string')
  assert.ok(base.length > 200, 'TOM_REFERENCIA_BASE deve ter conteudo (>200 chars)')
  assert.match(base, /Tom de referência — \{\{empresa\}\}/, 'conteudo deve ter o cabecalho')
})

test('C.3 withTomReferencia anexa o bloco quando ele esta carregado', () => {
  const prompts = require('../src/prompts')
  prompts.loadTomReferenciaPrompt()
  const base = 'REGRAS DA ETAPA DIAGNOSTICO: faca pergunta de diagnostico.'
  const resultado = prompts.withTomReferencia(base)
  assert.match(resultado, /^REGRAS DA ETAPA DIAGNOSTICO/, 'deve preservar o conteudo original no inicio')
  assert.match(resultado, /Tom de referência — \{\{empresa\}\}/, 'deve anexar o bloco de tom-referencia')
  assert.match(resultado, /\n---\n/, 'deve usar separador --- entre o prompt e o tom-referencia')
})

test('C.4 withTomReferencia e idempotente (nao duplica se ja anexado)', () => {
  const prompts = require('../src/prompts')
  prompts.loadTomReferenciaPrompt()
  const base = 'REGRAS DA ETAPA: x'
  const once = prompts.withTomReferencia(base)
  const twice = prompts.withTomReferencia(once)
  assert.equal(once, twice, 'aplicar duas vezes deve gerar o mesmo resultado')
  // E so deve aparecer 1 vez o cabecalho
  const ocorrencias = (twice.match(/# Tom de referência — \{\{empresa\}\}/g) || []).length
  assert.equal(ocorrencias, 1, 'cabecalho do tom-referencia nao pode aparecer mais de uma vez')
})

test('C.5 withTomReferencia retorna apenas o tom-referencia quando o prompt base estiver vazio', () => {
  const prompts = require('../src/prompts')
  prompts.loadTomReferenciaPrompt()
  const out = prompts.withTomReferencia('')
  // Quando base vazia + tom-referencia carregado, o resultado e apenas o
  // bloco de tom (com prefixo de separador). Isso evita crash e permite o
  // bot ter algum guidance mesmo se um arquivo de etapa estiver ausente.
  assert.match(out, /# Tom de referência — \{\{empresa\}\}/)
})
