'use strict'

// Seleção de localidade da Aquisição.
//
// Mantemos os estados localmente (27 itens, estáveis) e buscamos as cidades sob demanda
// no serviço público do IBGE. A tela continua enviando apenas `{ cidade, uf }` para os
// endpoints existentes; este módulo só reduz erro de digitação e ambiguidade operacional.

const ESTADOS_BRASIL = [
  { uf: 'AC', nome: 'Acre' },
  { uf: 'AL', nome: 'Alagoas' },
  { uf: 'AP', nome: 'Amapá' },
  { uf: 'AM', nome: 'Amazonas' },
  { uf: 'BA', nome: 'Bahia' },
  { uf: 'CE', nome: 'Ceará' },
  { uf: 'DF', nome: 'Distrito Federal' },
  { uf: 'ES', nome: 'Espírito Santo' },
  { uf: 'GO', nome: 'Goiás' },
  { uf: 'MA', nome: 'Maranhão' },
  { uf: 'MT', nome: 'Mato Grosso' },
  { uf: 'MS', nome: 'Mato Grosso do Sul' },
  { uf: 'MG', nome: 'Minas Gerais' },
  { uf: 'PA', nome: 'Pará' },
  { uf: 'PB', nome: 'Paraíba' },
  { uf: 'PR', nome: 'Paraná' },
  { uf: 'PE', nome: 'Pernambuco' },
  { uf: 'PI', nome: 'Piauí' },
  { uf: 'RJ', nome: 'Rio de Janeiro' },
  { uf: 'RN', nome: 'Rio Grande do Norte' },
  { uf: 'RS', nome: 'Rio Grande do Sul' },
  { uf: 'RO', nome: 'Rondônia' },
  { uf: 'RR', nome: 'Roraima' },
  { uf: 'SC', nome: 'Santa Catarina' },
  { uf: 'SP', nome: 'São Paulo' },
  { uf: 'SE', nome: 'Sergipe' },
  { uf: 'TO', nome: 'Tocantins' },
]

const UFS_VALIDAS = new Set(ESTADOS_BRASIL.map((e) => e.uf))

function texto(valor) {
  return String(valor == null ? '' : valor).trim()
}

function normalizarUfBrasil(valor) {
  const uf = texto(valor).toUpperCase()
  return UFS_VALIDAS.has(uf) ? uf : ''
}

function nomeEstado(uf) {
  const normalizada = normalizarUfBrasil(uf)
  return ESTADOS_BRASIL.find((e) => e.uf === normalizada)?.nome || ''
}

function ibgeMunicipiosUrl(uf) {
  const normalizada = normalizarUfBrasil(uf)
  if (!normalizada) return ''
  return `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${normalizada}/municipios?orderBy=nome`
}

function extrairCidadesIbge(payload) {
  if (!Array.isArray(payload)) return []
  return [...new Set(payload
    .map((item) => texto(item && item.nome))
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

function cidadePertenceAoEstado(cidade, cidades) {
  const alvo = texto(cidade).toLocaleLowerCase('pt-BR')
  if (!alvo) return false
  return Array.isArray(cidades) && cidades.some((c) => texto(c).toLocaleLowerCase('pt-BR') === alvo)
}

module.exports = {
  ESTADOS_BRASIL,
  normalizarUfBrasil,
  nomeEstado,
  ibgeMunicipiosUrl,
  extrairCidadesIbge,
  cidadePertenceAoEstado,
}
