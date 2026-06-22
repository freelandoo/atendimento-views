'use strict'

/**
 * Garante que os prompts-fonte (`prompts/*.md`) seguem o tom curto e nao
 * contem mais a abertura institucional longa.
 *
 * IMPORTANTE: o conteudo em producao tambem pode vir do banco
 * (`vendas.prompt_overlays`). Este teste cobre apenas a FONTE no
 * disco. Se houver overlay ativo no banco, ele sobrescreve — deve ser
 * desativado em paralelo (UPDATE vendas.prompt_overlays SET ativo=false).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const PROMPTS_DIR = path.join(__dirname, '..', 'prompts')

function readPrompt(name) {
  return fs.readFileSync(path.join(PROMPTS_DIR, name), 'utf8')
}

// ─── primeiro-contato ──────────────────────────────────────────────────────

test('system-primeiro-contato: nao contem mais a abertura institucional longa', () => {
  const c = readPrompt('system-primeiro-contato.md')
  assert.doesNotMatch(c, /Eu sou o assistente virtual da \{\{empresa\}\}\. Vou te ajudar com as primeiras informacoes/,
    'abertura institucional antiga (39 palavras) nao pode estar no prompt-fonte')
})

test('system-primeiro-contato: nao contem mais o exemplo "Voce busca site, sistema, automacao"', () => {
  const c = readPrompt('system-primeiro-contato.md')
  // O exemplo PROBLEMATICO era literal: "Voce busca site, sistema, automacao ou presenca no Google?"
  // Permitimos a frase em contexto NEGATIVO (ex.: "NUNCA liste 'site, sistema...' como menu").
  // Bloqueamos somente quando aparece como exemplo de bolha (entre aspas duplas dentro de [...]).
  const linhasExemplo = c.split('\n').filter((l) => /^\-\s+(Sem contexto|Via)/i.test(l))
  for (const linha of linhasExemplo) {
    assert.doesNotMatch(linha, /Voce busca site, sistema/i,
      `exemplo de bolha nao pode listar "site, sistema, automacao" como menu: ${linha}`)
  }
})

test('system-primeiro-contato: contem a abertura curta nova', () => {
  const c = readPrompt('system-primeiro-contato.md')
  assert.match(c, /Oi! Tudo bem\? Aqui é o assistente da \{\{empresa\}\}/,
    'abertura curta deve estar presente como exemplo no prompt-fonte')
})

test('system-primeiro-contato: tem regra explicita sobre interpretar "site/saite/pagina"', () => {
  const c = readPrompt('system-primeiro-contato.md')
  assert.match(c, /site.*saite.*pagina|saite.*pagina|"site", "saite"/i,
    'prompt-fonte deve instruir o LLM a aceitar variantes de "site"')
})

// ─── diagnostico ───────────────────────────────────────────────────────────

test('system-diagnostico: pergunta de necessidade (site/sistema/IA) so e permitida quando necessidade vazia', () => {
  const c = readPrompt('system-diagnostico.md')
  // A pergunta de necessidade apresenta as tres opcoes (site, sistema ou IA) e
  // segue listada como permitida, mas com restricao explicita pra nao repetir.
  const linha = c.split('\n').find((l) => /Voce procura um site, um sistema ou um agente de IA/i.test(l))
  assert.ok(linha, 'a pergunta de necessidade (site/sistema/IA) deve existir no prompt')
  assert.match(linha, /APENAS quando .*necessidade .*AINDA NAO esta definido|NAO faca essa pergunta de novo/i,
    'a pergunta-menu deve vir com restricao explicita pra nao repetir')
})

// ─── tom-referencia (anti-regressao) ───────────────────────────────────────

test('tom-referencia: continua com os anti-padroes documentados', () => {
  const c = readPrompt('tom-referencia.md')
  assert.match(c, /Eu sou o assistente virtual da \{\{empresa\}\}/,
    'tom-referencia deve manter o anti-padrao da abertura longa como exemplo do que NAO fazer')
  assert.match(c, /Voce procura site, sistema, automacao/i,
    'tom-referencia deve manter o anti-padrao da pergunta-menu como exemplo do que NAO fazer')
})
