'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const {
  calcularScoreCadastroPlaces,
  montarJsonApresentacaoPlaces,
  calcularScoreCadastroInstagram,
  montarJsonApresentacaoInstagram,
} = require('../src/services/lead-score-cadastro')

// ─── Places ───────────────────────────────────────────────────────────────────

const PLACES_COMPLETO = {
  nome: 'Barbearia Alfa',
  nicho: 'barbearia',
  cidade: 'São Paulo',
  endereco: 'Rua X, 100',
  telefone: '+55 11 99999-0000',
  email: 'contato@alfa.com',
  site: 'https://alfa.com',
  tem_site: true,
  maps_url: 'https://maps.google.com/?cid=1',
  avaliacoes: 37,
  rating: 4.7,
  raw_json: {
    photos: [{ name: 'p1' }, { name: 'p2' }],
    regularOpeningHours: { periods: [] },
  },
}

test('places: cadastro completo = 100 (site 20 + 8 critérios de 10)', () => {
  const r = calcularScoreCadastroPlaces(PLACES_COMPLETO)
  assert.strictEqual(r.score, 100)
  assert.strictEqual(r.maximo, 100)
  assert.ok(r.criterios.every((c) => c.ok))
})

test('places: cadastro vazio = 0 (sem meio-termo)', () => {
  const r = calcularScoreCadastroPlaces({ nome: 'X', nicho: 'y', cidade: 'z', raw_json: {} })
  assert.strictEqual(r.score, 0)
  assert.ok(r.criterios.every((c) => !c.ok && c.pontos === 0))
})

test('places: pesos individuais — site vale 20, demais 10', () => {
  const soSite = calcularScoreCadastroPlaces({ site: 'https://a.com', tem_site: true })
  assert.strictEqual(soSite.score, 20)
  const soTelefone = calcularScoreCadastroPlaces({ telefone: '11 9999' })
  assert.strictEqual(soTelefone.score, 10)
  // nota 4.0 NÃO pontua (regra: maior que 4) — mas ter avaliações pontua.
  const nota4 = calcularScoreCadastroPlaces({ rating: 4.0, avaliacoes: 10 })
  assert.strictEqual(nota4.score, 10)
  const nota41 = calcularScoreCadastroPlaces({ rating: 4.1, avaliacoes: 10 })
  assert.strictEqual(nota41.score, 20)
})

test('places: fotos e horário vêm do raw_json', () => {
  const r = calcularScoreCadastroPlaces({ raw_json: { photos: [{}], currentOpeningHours: {} } })
  assert.strictEqual(r.score, 20) // fotos 10 + horário 10
  const rStr = calcularScoreCadastroPlaces({ raw_json: JSON.stringify({ photos: [{}] }) })
  assert.strictEqual(rStr.score, 10) // raw_json string também funciona
})

test('places: json de apresentação agrupa dados, pontuação, lacunas e prompt único', () => {
  const j = montarJsonApresentacaoPlaces({ ...PLACES_COMPLETO, email: null, raw_json: {} })
  assert.strictEqual(j.fonte, 'google_places')
  assert.strictEqual(j.empresa.nome, 'Barbearia Alfa')
  assert.strictEqual(j.pontuacao.maximo, 100)
  assert.ok(j.lacunas.includes('email'))
  assert.ok(j.lacunas.includes('fotos'))
  assert.match(j.prompt, /Barbearia Alfa/)
  assert.match(j.prompt, /PONTUAÇÃO DE PRESENÇA DIGITAL: \d+\/100/)
  assert.match(j.prompt, /saudação/i)
  assert.match(j.prompt, /não invente dados/i)
})

// ─── Instagram ────────────────────────────────────────────────────────────────

const IG_COMPLETO = {
  nome: 'Studio Beta',
  instagram_handle: 'studiobeta',
  nicho: 'arquitetura',
  cidade: 'Rio de Janeiro',
  seguidores: 5400,
  telefone: '5521999990000',
  email: 'oi@beta.com',
  link_bio: 'https://linktr.ee/beta',
  site: null,
  bio: 'Projetos residenciais',
}

test('instagram: cadastro completo = 60 (10 por coluna)', () => {
  const r = calcularScoreCadastroInstagram(IG_COMPLETO)
  assert.strictEqual(r.score, 60)
  assert.strictEqual(r.maximo, 60)
})

test('instagram: vazio = 0; cada coluna vale 10', () => {
  assert.strictEqual(calcularScoreCadastroInstagram({}).score, 0)
  assert.strictEqual(calcularScoreCadastroInstagram({ instagram_handle: 'x' }).score, 10)
  assert.strictEqual(calcularScoreCadastroInstagram({ seguidores: 100, email: 'a@b.co' }).score, 20)
  // links: bio OU site contam como a mesma coluna (10, não 20)
  assert.strictEqual(calcularScoreCadastroInstagram({ link_bio: 'https://x.co', site: 'https://y.co' }).score, 10)
  // nicho OU categoria do perfil contam como nicho
  assert.strictEqual(calcularScoreCadastroInstagram({ categoria_perfil: 'Marketing Agency' }).score, 10)
})

test('instagram: json de apresentação com prompt único e lacunas', () => {
  const j = montarJsonApresentacaoInstagram({ ...IG_COMPLETO, telefone: null })
  assert.strictEqual(j.fonte, 'instagram')
  assert.strictEqual(j.perfil.username, 'studiobeta')
  assert.strictEqual(j.pontuacao.total, 50)
  assert.ok(j.lacunas.includes('telefone'))
  assert.match(j.prompt, /@username: @studiobeta/)
  assert.match(j.prompt, /PONTUAÇÃO DO CADASTRO: 50\/60/)
  assert.match(j.prompt, /Seguidores: 5400/)
})
