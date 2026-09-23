'use strict'

const PAISES = Object.freeze([
  { codigo: 'BR', nome: 'Brasil', nominatim: 'br', meta: 'BR' },
  { codigo: 'US', nome: 'Estados Unidos', nominatim: 'us', meta: 'US' },
  { codigo: 'PT', nome: 'Portugal', nominatim: 'pt', meta: 'PT' },
  { codigo: 'MX', nome: 'Mexico', nominatim: 'mx', meta: 'MX' },
  { codigo: 'AR', nome: 'Argentina', nominatim: 'ar', meta: 'AR' },
  { codigo: 'CL', nome: 'Chile', nominatim: 'cl', meta: 'CL' },
  { codigo: 'CO', nome: 'Colombia', nominatim: 'co', meta: 'CO' },
  { codigo: 'PE', nome: 'Peru', nominatim: 'pe', meta: 'PE' },
  { codigo: 'UY', nome: 'Uruguai', nominatim: 'uy', meta: 'UY' },
  { codigo: 'PY', nome: 'Paraguai', nominatim: 'py', meta: 'PY' },
  { codigo: 'BO', nome: 'Bolivia', nominatim: 'bo', meta: 'BO' },
  { codigo: 'ES', nome: 'Espanha', nominatim: 'es', meta: 'ES' },
])

const POR_CODIGO = new Map(PAISES.map((p) => [p.codigo, p]))
const ALIASES = new Map([
  ['BRASIL', 'BR'],
  ['BRAZIL', 'BR'],
  ['EUA', 'US'],
  ['USA', 'US'],
  ['UNITED STATES', 'US'],
  ['ESTADOS UNIDOS', 'US'],
  ['PORTUGAL', 'PT'],
  ['MEXICO', 'MX'],
  ['ARGENTINA', 'AR'],
  ['CHILE', 'CL'],
  ['COLOMBIA', 'CO'],
  ['PERU', 'PE'],
  ['URUGUAI', 'UY'],
  ['URUGUAY', 'UY'],
  ['PARAGUAI', 'PY'],
  ['PARAGUAY', 'PY'],
  ['BOLIVIA', 'BO'],
  ['ESPANHA', 'ES'],
  ['SPAIN', 'ES'],
])

function semAcento(valor) {
  return String(valor == null ? '' : valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function normalizarPais(valor, padrao = 'BR') {
  const raw = semAcento(valor).trim().toUpperCase()
  if (!raw) return padrao
  if (/^[A-Z]{2}$/.test(raw)) return POR_CODIGO.has(raw) ? raw : raw
  return ALIASES.get(raw) || padrao
}

function paisConhecido(codigo) {
  return POR_CODIGO.get(normalizarPais(codigo)) || null
}

function paisParaNominatim(codigo) {
  const pais = paisConhecido(codigo)
  return (pais?.nominatim || normalizarPais(codigo)).toLowerCase()
}

function paisParaMeta(codigo) {
  const pais = paisConhecido(codigo)
  return pais?.meta || normalizarPais(codigo)
}

function rotuloPais(codigo) {
  const pais = paisConhecido(codigo)
  return pais?.nome || normalizarPais(codigo)
}

module.exports = {
  PAISES,
  normalizarPais,
  paisConhecido,
  paisParaNominatim,
  paisParaMeta,
  rotuloPais,
}
