'use strict'

const assert = require('node:assert')
const test = require('node:test')

const {
  descobrirLinksInternosRelevantes,
  extrairConteudoEstruturadoHtml,
  _ehUrlIgnoravel,
  _scoreUrl,
} = require('../src/services/knowledge-ingestion')

const baseUrl = 'https://www.freelandoo.com.br/'

test('descobrirLinksInternosRelevantes classifica links por origem e filtra ignoraveis', () => {
  const html = `
    <header><a href="/planos">Planos</a></header>
    <main>
      <a class="btn" href="/cadastro">Criar conta</a>
      <a href="/blog">Blog</a>
      <a href="/wp-admin/login">Admin</a>
    </main>
    <footer><a href="/contato">Contato</a></footer>
  `

  const { internos } = descobrirLinksInternosRelevantes(html, baseUrl)
  const porUrl = new Map(internos.map((link) => [new URL(link.url).pathname, link]))

  assert.strictEqual(porUrl.get('/planos').source, 'header')
  assert.strictEqual(porUrl.get('/contato').source, 'footer')
  assert.strictEqual(porUrl.get('/cadastro').source, 'button')
  assert.strictEqual(porUrl.has('/wp-admin/login'), false)
})

test('extrairConteudoEstruturadoHtml captura metadados, CTAs e contatos', () => {
  const html = `
    <html>
      <head>
        <title>Freelandoo</title>
        <meta name="description" content="Marketplace para freelancers">
      </head>
      <body>
        <main>
          <h1>Venda servicos online</h1>
          <h2>Como funciona</h2>
          <a class="btn" href="/cadastro">Comecar agora</a>
          <a href="tel:+5511999999999">Telefone</a>
          <a href="mailto:contato@freelandoo.com.br">Email</a>
          <a href="https://wa.me/5511988887777">WhatsApp</a>
          <a href="https://instagram.com/freelandoo">Instagram</a>
        </main>
      </body>
    </html>
  `

  const resumo = extrairConteudoEstruturadoHtml({ html, url: baseUrl })

  assert.strictEqual(resumo.title, 'Freelandoo')
  assert.strictEqual(resumo.description, 'Marketplace para freelancers')
  assert.ok(resumo.headings.includes('Venda servicos online'))
  assert.ok(resumo.buttons.includes('Comecar agora'))
  assert.ok(resumo.contacts.telefones.includes('+5511999999999'))
  assert.ok(resumo.contacts.emails.includes('contato@freelandoo.com.br'))
  assert.ok(resumo.contacts.whatsapps.includes('5511988887777'))
  assert.ok(resumo.contacts.instagrams.includes('@freelandoo'))
})

test('filtros ignoram rotas tecnicas e preservam rotas comerciais', () => {
  assert.strictEqual(_ehUrlIgnoravel('/wp-admin/login'), true)
  assert.strictEqual(_ehUrlIgnoravel('/precos'), false)
})

test('score prioriza planos e rebaixa blog', () => {
  assert.ok(_scoreUrl('https://www.freelandoo.com.br/planos', 'Planos', 'header') >= 100)
  assert.ok(_scoreUrl('https://www.freelandoo.com.br/blog', 'Blog', 'body') < 50)
})
