'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const { TIPO_ACESSO, normalizarLink, marcaDoLink, rotuloGenerico, telefoneWhatsapp, acessosDoLead } = require('./lead-acessos')

test('normalizarLink aceita URL sem esquema e derruba o que nao e navegavel', () => {
  assert.equal(normalizarLink('instagram.com/loja').host, 'instagram.com')
  assert.equal(normalizarLink('https://www.exemplo.com.br/').host, 'exemplo.com.br')
  assert.equal(normalizarLink('javascript:alert(1)'), null)
  assert.equal(normalizarLink('data:text/html,<b>x'), null)
  assert.equal(normalizarLink(''), null)
  assert.equal(normalizarLink(null), null)
})

test('marcaDoLink reconhece Instagram e Facebook, e nada mais', () => {
  assert.equal(marcaDoLink('https://instagram.com/loja'), TIPO_ACESSO.INSTAGRAM)
  assert.equal(marcaDoLink('https://www.facebook.com/loja'), TIPO_ACESSO.FACEBOOK)
  assert.equal(marcaDoLink('https://fb.me/loja'), TIPO_ACESSO.FACEBOOK)
  assert.equal(marcaDoLink('https://loja.com.br'), null)
  assert.equal(marcaDoLink('https://linktr.ee/loja'), null)
})

test('o botao Site so nasce com o veredito do backend (tem_site + site)', () => {
  const comSite = acessosDoLead({ tem_site: true, site: 'https://loja.com.br' })
  assert.deepEqual(comSite.map((a) => a.tipo), [TIPO_ACESSO.SITE])

  // Link duvidoso: o backend manda tem_site=true com `site` vazio — nao ha site para abrir.
  const duvidoso = acessosDoLead({ tem_site: true, site: null, link_original: 'https://x.wixsite.com/loja', classificacao_url: 'desconhecido' })
  assert.equal(duvidoso.some((a) => a.tipo === TIPO_ACESSO.SITE), false)
  assert.deepEqual(duvidoso.map((a) => a.rotulo), ['Verificar'])
})

test('link de rede social vira botao com a marca, nunca com o rotulo "Site"', () => {
  const r = acessosDoLead({ link_original: 'https://www.facebook.com/pizzaria', classificacao_url: 'rede_social' })
  assert.deepEqual(r.map((a) => [a.tipo, a.rotulo]), [[TIPO_ACESSO.FACEBOOK, 'Facebook']])
})

test('marca nao reconhecida cai no rotulo do que o backend disse que o link e', () => {
  const r = acessosDoLead({ link_original: 'https://linktr.ee/loja', classificacao_url: 'agregador' })
  assert.deepEqual(r.map((a) => a.rotulo), ['Agregador'])
  assert.equal(rotuloGenerico('perfil_ou_diretorio'), 'Perfil')
  assert.equal(rotuloGenerico(null), 'Link')
})

test('whatsapp nasce primeiro quando ha telefone navegavel', () => {
  assert.equal(telefoneWhatsapp('+55 (11) 99999-0001'), '5511999990001')
  assert.equal(telefoneWhatsapp('(11) 99999-0001'), '5511999990001')
  assert.equal(telefoneWhatsapp('123'), null)
  const r = acessosDoLead({
    telefone: '(11) 99999-0001',
    instagram_handle: '@loja',
    maps_url: 'https://maps.google.com/?cid=1',
  })
  assert.deepEqual(r.map((a) => a.tipo), [TIPO_ACESSO.WHATSAPP, TIPO_ACESSO.INSTAGRAM, TIPO_ACESSO.MAPS])
  assert.equal(r[0].href, 'https://wa.me/5511999990001')
})

test('ordem e deduplicacao: whatsapp, rede social, site, maps — sem href repetido', () => {
  const r = acessosDoLead({
    telefone: '5511999990001',
    instagram_handle: '@loja',
    link_original: 'https://instagram.com/loja', // mesmo destino do handle
    classificacao_url: 'rede_social',
    tem_site: true, site: 'https://loja.com.br',
    maps_url: 'https://maps.google.com/?cid=1',
  })
  assert.deepEqual(r.map((a) => a.tipo), [TIPO_ACESSO.WHATSAPP, TIPO_ACESSO.INSTAGRAM, TIPO_ACESSO.SITE, TIPO_ACESSO.MAPS])
})

test('lead sem link nenhum devolve lista vazia', () => {
  assert.deepEqual(acessosDoLead({}), [])
  assert.deepEqual(acessosDoLead(null), [])
})

// GUARDA DE REGRESSAO: a classificacao de site vive no backend. Se uma lista de dominios de
// site/agregador aparecer aqui, o front voltou a decidir o que e' site — o defeito que a
// secao "Classificacao canonica de site proprio" do AGENTS.md proibe.
test('o modulo nao reimplementa a classificacao de site', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'lead-acessos.js'), 'utf8')
  for (const proibido of ['linktr.ee', 'wixsite', 'ifood', 'mercadolivre', 'tripadvisor']) {
    assert.equal(fonte.includes(proibido), false, `lead-acessos.js nao pode conhecer o dominio ${proibido}`)
  }
})
