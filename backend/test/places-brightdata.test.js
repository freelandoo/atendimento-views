'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const {
  MAX_LEADS_POR_BUSCA,
  adaptarRegistroParaPlace,
  adaptarRegistrosParaPlaces,
  normalizarCidadeParaGeocode,
} = require('../src/services/places-brightdata')

test('Aquisição fixa o teto de cada busca em 200 leads', () => {
  assert.equal(MAX_LEADS_POR_BUSCA, 200)
  const registros = Array.from({ length: 306 }, (_, i) => ({
    ...REGISTRO_SEM_SITE,
    place_id: `place-${i}`,
    name: `Empresa ${i}`,
  }))
  const places = adaptarRegistrosParaPlaces(registros)
  assert.equal(places.length, 200)
  assert.equal(places.at(-1).id, 'place-199')
})

// Registro real (recortado) devolvido pelo dataset Google Maps da Bright Data
// (Discover by location, "dentista" em São Paulo).
const REGISTRO_SEM_SITE = {
  place_id: 'ChIJ5Y6mnYFazpQRMxTJp3S3N64',
  cid: '12553704197977609267',
  name: 'Dentista 24 Horas - Dr. Julio Taira',
  address: 'Av. Santa Catarina, 443 - Vila Alexandria, São Paulo - SP, 04635-001',
  phone_number: '+55 11 5031-8607',
  open_website: null,
  url: 'https://www.google.com/maps/place/Dentista+24+Horas',
  rating: 4.8,
  reviews_count: 208,
  category: 'Dentist',
  all_categories: ['Dentist', 'Dental clinic'],
  photos_and_videos: ['https://x/1.jpg', 'https://x/2.jpg'],
  open_hours: { Sunday: 'Open 24 hours' },
  permanently_closed: false,
  temporarily_closed: false,
}
const REGISTRO_COM_SITE = {
  place_id: 'ChIJleX9TppWzp',
  name: 'MORUMBI PRONTO ODONTO',
  address: 'Rua X, 100 - São Paulo - SP',
  phone_number: '(11) 98915-0665',
  open_website: 'http://www.mpo24h.com.br/',
  url: 'https://www.google.com/maps/place/Morumbi',
  rating: 4.6,
  reviews_count: 773,
  category: 'Dentist',
  all_categories: ['Dentist'],
  permanently_closed: true,
}

test('adaptarRegistroParaPlace mapeia campos-chave para o shape do Google', () => {
  const p = adaptarRegistroParaPlace(REGISTRO_SEM_SITE)
  assert.equal(p.id, 'ChIJ5Y6mnYFazpQRMxTJp3S3N64')
  assert.equal(p.displayName.text, 'Dentista 24 Horas - Dr. Julio Taira')
  assert.equal(p.internationalPhoneNumber, '+55 11 5031-8607')
  assert.equal(p.websiteUri, '') // open_website null => sem site (lead quente)
  assert.equal(p.rating, 4.8)
  assert.equal(p.userRatingCount, 208)
  assert.equal(p.businessStatus, 'OPERATIONAL')
  assert.equal(p.primaryTypeDisplayName.text, 'Dentist')
  assert.deepEqual(p.types, ['Dentist', 'Dental clinic'])
  assert.equal(p.photos.length, 2)
  assert.ok(p.regularOpeningHours)
})

test('adaptarRegistroParaPlace: site presente e negócio fechado', () => {
  const p = adaptarRegistroParaPlace(REGISTRO_COM_SITE)
  assert.equal(p.websiteUri, 'http://www.mpo24h.com.br/')
  assert.equal(p.businessStatus, 'CLOSED_PERMANENTLY')
  assert.equal(p.id, 'ChIJleX9TppWzp')
})

test('adaptarRegistroParaPlace: entrada inválida vira null', () => {
  assert.equal(adaptarRegistroParaPlace(null), null)
  assert.equal(adaptarRegistroParaPlace('x'), null)
})

test('normalizarCidadeParaGeocode limpa "Cidade - UF"', () => {
  assert.equal(normalizarCidadeParaGeocode('São Paulo - SP'), 'São Paulo, SP')
  assert.equal(normalizarCidadeParaGeocode('Rio de Janeiro,RJ'), 'Rio de Janeiro, RJ')
})
