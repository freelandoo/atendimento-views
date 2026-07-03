'use strict'

const test = require('node:test')
const assert = require('node:assert')

const {
  montarAgregado,
  coletarDados,
  centavosParaBRL,
} = require('../src/services/playbook-freelandoo')

test('centavosParaBRL converte centavos em R$ com duas casas', () => {
  assert.strictEqual(centavosParaBRL(5000), 'R$ 50,00')
  assert.strictEqual(centavosParaBRL(199), 'R$ 1,99')
  assert.strictEqual(centavosParaBRL(0), 'R$ 0,00')
  assert.strictEqual(centavosParaBRL(null), null)
  assert.strictEqual(centavosParaBRL(undefined), null)
})

const RAW = {
  me: { id_user: 1, username: 'joana', level: 5, counts: { services: 2 } },
  profiles: {
    profiles: [
      { id_profile: 'p1', username: 'joana', display_name: 'Joana Silva', bio: 'Designer', profession: 'Designer', enxame_name: 'Criativos', municipio: 'Recife', estado: 'PE', is_active: true, followers: 1200, level: 5, is_user_account: true },
      { id_profile: 'p2', display_name: 'Comunidade X', is_community: true, is_active: true, followers: 300 },
      { id_profile: 'p3', display_name: 'Perfil Morto', is_active: false },
    ],
  },
  services: {
    services: [
      { id_profile_service: 's1', id_profile: 'p1', name: 'Logo', description: 'Identidade', duration_minutes: 60, price_amount: 50000, is_active: true },
      { id_profile_service: 's2', id_profile: 'p1', name: 'Inativo', price_amount: 9999, is_active: false },
    ],
  },
  products: {
    products: [
      { id_profile_product: 'pr1', id_profile: 'p1', name: 'Ebook', description: 'PDF', price_amount: 3000, stock_quantity: 10, is_active: true, moderation_status: 'active' },
      { id_profile_product: 'pr2', id_profile: 'p1', name: 'Esgotado', price_amount: 2000, stock_quantity: 0, is_active: true, moderation_status: 'active' },
      { id_profile_product: 'pr3', id_profile: 'p1', name: 'Em moderação', price_amount: 1000, stock_quantity: 5, is_active: true, moderation_status: 'pending' },
    ],
  },
  social: {
    social: [
      { id_profile: 'p1', network: 'instagram', url: 'https://ig/joana', follower_range: '1k-5k', phone_number_normalized: '5581999999999' },
    ],
  },
  courses: {
    courses: [
      { id: 'c1', profile_id: 'p1', title: 'Curso de Branding', short_description: 'Do zero', price_cents: 19900, lessons_count: 12, modules_count: 3, students_count: 40, status: 'published' },
      { id: 'c2', profile_id: 'p1', title: 'Rascunho', price_cents: 0, status: 'draft' },
    ],
  },
  metrics: {
    totals: { followers: 1500, xp_total: 999 },
    per_profile: [
      { id_profile: 'p1', display_name: 'Joana Silva', followers: 1200, level: 5 },
    ],
  },
}

test('montarAgregado correlaciona serviços/produtos/social por perfil', () => {
  const ag = montarAgregado(RAW)

  // Perfil inativo (p3) é descartado; sobram p1 e p2.
  assert.strictEqual(ag.perfis.length, 2)
  const joana = ag.perfis.find((p) => p.id_profile === 'p1')
  assert.ok(joana)
  assert.strictEqual(joana.cidade, 'Recife - PE')
  assert.strictEqual(joana.enxame, 'Criativos')

  // Só o serviço ativo entra, com preço formatado.
  assert.strictEqual(joana.servicos.length, 1)
  assert.strictEqual(joana.servicos[0].nome, 'Logo')
  assert.strictEqual(joana.servicos[0].preco, 'R$ 500,00')
})

test('montarAgregado filtra produtos por is_active + moderation_status e marca estoque', () => {
  const ag = montarAgregado(RAW)
  const joana = ag.perfis.find((p) => p.id_profile === 'p1')

  // pr3 (moderation pending) sai; ficam pr1 (em estoque) e pr2 (esgotado).
  assert.strictEqual(joana.produtos.length, 2)
  const ebook = joana.produtos.find((p) => p.nome === 'Ebook')
  const esgotado = joana.produtos.find((p) => p.nome === 'Esgotado')
  assert.strictEqual(ebook.disponibilidade, 'em estoque')
  assert.strictEqual(ebook.preco, 'R$ 30,00')
  assert.strictEqual(esgotado.disponibilidade, 'esgotado')
})

test('montarAgregado inclui social, cursos e conta', () => {
  const ag = montarAgregado(RAW)
  const joana = ag.perfis.find((p) => p.id_profile === 'p1')

  assert.strictEqual(joana.social.length, 1)
  assert.strictEqual(joana.social[0].telefone, '5581999999999')

  assert.strictEqual(ag.cursos.length, 2)
  assert.strictEqual(ag.cursos[0].preco, 'R$ 199,00')
  assert.strictEqual(ag.cursos[0].aulas, 12)

  assert.strictEqual(ag.conta.username, 'joana')
  assert.strictEqual(ag.metricas.seguidores_total, 1500)
})

test('montarAgregado sobrevive a endpoints faltantes (null)', () => {
  const ag = montarAgregado({ me: null, profiles: null, services: null, products: null, social: null, courses: null, metrics: null })
  assert.deepStrictEqual(ag.perfis, [])
  assert.deepStrictEqual(ag.cursos, [])
  assert.strictEqual(ag.conta, null)
  assert.strictEqual(ag.metricas, null)
})

test('coletarDados registra avisos e primeiroErro quando um endpoint falha', async () => {
  const clientFake = {
    me: async () => RAW.me,
    profiles: async () => RAW.profiles,
    services: async () => { throw new Error('boom serviços') },
    products: async () => RAW.products,
    social: async () => RAW.social,
    courses: async () => RAW.courses,
    metrics: async () => RAW.metrics,
  }
  const { raw, avisos, primeiroErro } = await coletarDados(clientFake)
  assert.strictEqual(raw.services, null)
  assert.ok(raw.me)
  assert.strictEqual(avisos.length, 1)
  assert.match(avisos[0], /serviços/)
  assert.strictEqual(primeiroErro.message, 'boom serviços')
})
