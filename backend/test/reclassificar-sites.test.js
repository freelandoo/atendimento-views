'use strict'
// Testes da LOGICA PURA da rotina de correcao historica (scripts/reclassificar-sites.js).
// O banco nao e' tocado aqui: o que precisa de garantia e' o alvo calculado por linha —
// idempotencia, preservacao do link e "nunca promover a site proprio sem seguranca".
const test = require('node:test')
const assert = require('node:assert/strict')

const { lerArgs, alvoDaLinha, precisaAtualizar } = require('../scripts/reclassificar-sites')

// ── Argumentos: simulacao e' o PADRAO ─────────────────────────────────────────

test('sem flag, o script roda em SIMULACAO', () => {
  const a = lerArgs(['node', 'x'])
  assert.equal(a.aplicar, false)
  assert.equal(a.tudo, false)
  assert.equal(a.lote, 500)
  assert.equal(a.empresa, null)
})

test('--aplicar liga a gravacao; --dry-run desliga de novo', () => {
  assert.equal(lerArgs(['node', 'x', '--aplicar']).aplicar, true)
  assert.equal(lerArgs(['node', 'x', '--aplicar', '--dry-run']).aplicar, false)
})

test('lote e empresa sao lidos e o lote fica dentro de limites sensatos', () => {
  assert.equal(lerArgs(['node', 'x', '--lote=200']).lote, 200)
  assert.equal(lerArgs(['node', 'x', '--lote=999999']).lote, 5000)
  assert.equal(lerArgs(['node', 'x', '--lote=0']).lote, 1)
  assert.equal(lerArgs(['node', 'x', '--empresa=abc-123']).empresa, 'abc-123')
})

test('argumento desconhecido falha alto, em vez de rodar algo inesperado', () => {
  assert.throws(() => lerArgs(['node', 'x', '--apagar-tudo']), /desconhecido/)
})

// ── Alvo por linha ────────────────────────────────────────────────────────────

test('lead com Instagram: perde tem_site e o link vai para link_original', () => {
  const row = { site: 'https://instagram.com/lojax', tem_site: true, link_original: null, place_id: 'ChIJ_x' }
  const alvo = alvoDaLinha(row)
  assert.equal(alvo.tem_site, false)
  assert.equal(alvo.site, null, 'site proprio nao pode ficar preenchido com rede social')
  assert.equal(alvo.link_original, 'https://instagram.com/lojax', 'o link historico nao pode se perder')
  assert.equal(alvo.classificacao_url, 'rede_social')
  assert.equal(precisaAtualizar(row, alvo), true)
})

test('lead com site proprio: nada muda alem da classificacao registrada', () => {
  const row = { site: 'https://padariax.com.br', tem_site: true, link_original: 'https://padariax.com.br', classificacao_url: 'site_proprio', place_id: 'ChIJ_x' }
  const alvo = alvoDaLinha(row)
  assert.equal(alvo.tem_site, true)
  assert.equal(alvo.site, 'https://padariax.com.br')
  assert.equal(precisaAtualizar(row, alvo), false, 'linha ja correta nao deve ser regravada')
})

test('lead com Linktree na bio: vira sem site sem perder a bio', () => {
  const row = { site: null, link_bio: 'https://linktr.ee/lojax', tem_site: true, link_original: null }
  const alvo = alvoDaLinha(row)
  assert.equal(alvo.tem_site, false)
  assert.equal(alvo.site, null)
  assert.equal(alvo.classificacao_url, 'agregador')
})

// DECISAO DO OPERADOR (2026-08-07): na duvida, conta como COM site — o lead fica de fora
// da campanha de "sem site". O que NAO pode acontecer e' o link duvidoso virar `site`:
// essa coluna e' o contrato de "site proprio confirmado" e alimenta o resto do sistema.
test('link duvidoso conta como com site, mas nunca ocupa a coluna `site`', () => {
  for (const site of ['https://bit.ly/3x', 'https://lojax.wixsite.com/x', 'https://example.com']) {
    const alvo = alvoDaLinha({ site, tem_site: true, place_id: 'ChIJ_x' })
    assert.equal(alvo.classificacao_url, 'desconhecido', site)
    assert.equal(alvo.tem_site, true, site)
    assert.equal(alvo.site, null, `${site}: link duvidoso nao e site proprio confirmado`)
    assert.equal(alvo.link_original, site, 'link duvidoso tambem e preservado')
  }
})

// A evidencia crua tem de sobreviver, senao nao da' para revisar nem reverter a decisao.
test('link duvidoso continua distinguivel de site proprio de verdade', () => {
  const duvidoso = alvoDaLinha({ site: 'https://bit.ly/3x', tem_site: false, place_id: 'ChIJ_x' })
  const real = alvoDaLinha({ site: 'https://padariadobairro.com.br', tem_site: false, place_id: 'ChIJ_x' })
  assert.equal(duvidoso.tem_site, real.tem_site, 'ambos contam como com site')
  assert.notEqual(duvidoso.classificacao_url, real.classificacao_url, 'mas a origem do veredito difere')
  assert.equal(duvidoso.site, null)
  assert.equal(real.site, 'https://padariadobairro.com.br')
})

test('lead sem link nenhum: registrado como sem_link, sem inventar dado', () => {
  const alvo = alvoDaLinha({ site: null, tem_site: false, place_id: 'ChIJ_x' })
  assert.equal(alvo.classificacao_url, 'sem_link')
  assert.equal(alvo.tem_site, false)
  assert.equal(alvo.site, null)
  assert.equal(alvo.link_original, null)
})

test('link_original ja preenchido tem precedencia e nao e sobrescrito', () => {
  const alvo = alvoDaLinha({
    site: null,
    link_original: 'https://instagram.com/original',
    link_bio: 'https://linktr.ee/outro',
    tem_site: true,
  })
  assert.equal(alvo.link_original, 'https://instagram.com/original')
})

// ── Idempotencia: a garantia mais importante do script ────────────────────────

test('rodar de novo sobre o resultado nao altera mais nada (idempotente)', () => {
  const linhas = [
    { site: 'https://instagram.com/lojax', tem_site: true, link_original: null, place_id: 'p' },
    { site: 'https://padariax.com.br', tem_site: false, link_original: null, place_id: 'p' },
    { site: 'https://bit.ly/3x', tem_site: true, link_original: null, place_id: 'p' },
    { site: null, link_bio: 'https://linktr.ee/x', tem_site: true, link_original: null },
    { site: null, tem_site: false, link_original: null, place_id: 'p' },
  ]
  for (const original of linhas) {
    const primeira = alvoDaLinha(original)
    const depois = { ...original, ...primeira }
    const segunda = alvoDaLinha(depois)
    assert.deepEqual(segunda, primeira, `alvo instavel para ${JSON.stringify(original)}`)
    assert.equal(precisaAtualizar(depois, segunda), false, `2a passada regravaria ${JSON.stringify(original)}`)
  }
})

test('terceira passada tambem e no-op (estabilidade sob repeticao)', () => {
  let linha = { site: 'https://instagram.com/lojax', tem_site: true, link_original: null, place_id: 'p' }
  for (let i = 0; i < 3; i += 1) linha = { ...linha, ...alvoDaLinha(linha) }
  assert.equal(precisaAtualizar(linha, alvoDaLinha(linha)), false)
  assert.equal(linha.link_original, 'https://instagram.com/lojax')
  assert.equal(linha.tem_site, false)
})
