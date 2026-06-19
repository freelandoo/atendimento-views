'use strict'

const assert = require('node:assert')
const test = require('node:test')

const {
  ehUrlFalsa,
  sanitizarUrl,
  sanitizarListaLinks,
  sanitizarUrlsEmTexto,
  sanitizarPlaybookUrls,
} = require('../src/services/url-sanitize')

test('ehUrlFalsa bloqueia URLs placeholder e permite URL real', () => {
  assert.strictEqual(ehUrlFalsa('http://example.com'), true)
  assert.strictEqual(ehUrlFalsa('http://localhost:3000'), true)
  assert.strictEqual(ehUrlFalsa('https://yoursite.com'), true)
  assert.strictEqual(ehUrlFalsa('https://www.freelandoo.com.br/'), false)
})

test('sanitizarUrl troca URL falsa pelo fallback real', () => {
  assert.strictEqual(sanitizarUrl('example.com', 'https://real.com'), 'https://real.com')
})

test('sanitizarUrlsEmTexto substitui URLs falsas no texto livre', () => {
  assert.strictEqual(
    sanitizarUrlsEmTexto('Acesse http://example.com', 'https://real.com'),
    'Acesse https://real.com'
  )
})

test('sanitizarListaLinks remove links falsos quando nao ha fallback', () => {
  const links = sanitizarListaLinks([
    { label: 'A', url: 'example.com' },
    { label: 'B', url: 'https://real.com' },
  ])
  assert.deepStrictEqual(links, [{ label: 'B', url: 'https://real.com', tipo: 'outro' }])
})

test('sanitizarPlaybookUrls troca URLs falsas pelo link real', () => {
  const playbook = sanitizarPlaybookUrls({
    links_uteis_estruturados: [{ label: 'A', url: 'example.com' }],
    cadastro_e_onboarding: { link_cadastro: 'http://example.com' },
  }, 'https://real.com')

  assert.strictEqual(playbook.links_uteis_estruturados[0].url, 'https://real.com')
  assert.strictEqual(playbook.cadastro_e_onboarding.link_cadastro, 'https://real.com')
})
