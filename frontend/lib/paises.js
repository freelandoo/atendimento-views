const PAISES_AQUISICAO = Object.freeze([
  { codigo: 'BR', nome: 'Brasil' },
  { codigo: 'US', nome: 'Estados Unidos' },
  { codigo: 'PT', nome: 'Portugal' },
  { codigo: 'MX', nome: 'Mexico' },
  { codigo: 'AR', nome: 'Argentina' },
  { codigo: 'CL', nome: 'Chile' },
  { codigo: 'CO', nome: 'Colombia' },
  { codigo: 'PE', nome: 'Peru' },
  { codigo: 'UY', nome: 'Uruguai' },
  { codigo: 'PY', nome: 'Paraguai' },
  { codigo: 'BO', nome: 'Bolivia' },
  { codigo: 'ES', nome: 'Espanha' },
])

const NOMES = new Map(PAISES_AQUISICAO.map((p) => [p.codigo, p.nome]))

function normalizarPais(valor, padrao = 'BR') {
  const codigo = String(valor || '').trim().toUpperCase()
  return /^[A-Z]{2}$/.test(codigo) ? codigo : padrao
}

function nomePais(codigo) {
  const normalizado = normalizarPais(codigo)
  return NOMES.get(normalizado) || normalizado
}

module.exports = {
  PAISES_AQUISICAO,
  normalizarPais,
  nomePais,
}
