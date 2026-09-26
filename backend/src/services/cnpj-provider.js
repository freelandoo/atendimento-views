'use strict'

function erro(mensagem, statusCode = 400, code = 'BAD_REQUEST') {
  const e = new Error(mensagem)
  e.statusCode = statusCode
  e.code = code
  return e
}

function soDigitos(valor) {
  return String(valor || '').replace(/\D/g, '')
}

function cnpjValido(cnpj) {
  const s = soDigitos(cnpj)
  if (s.length !== 14 || /^(\d)\1{13}$/.test(s)) return false
  const calc = (base) => {
    const pesos = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const soma = base.split('').reduce((acc, n, i) => acc + Number(n) * pesos[i], 0)
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }
  return calc(s.slice(0, 12)) === Number(s[12]) && calc(s.slice(0, 13)) === Number(s[13])
}

function normalizarCnpj(valor, { exigirValido = true } = {}) {
  const s = soDigitos(valor)
  if (!s) return null
  if (s.length !== 14) throw erro('CNPJ deve ter 14 digitos.', 400, 'CNPJ_INVALIDO')
  if (exigirValido && !cnpjValido(s)) throw erro('CNPJ invalido.', 400, 'CNPJ_INVALIDO')
  return s
}

function normalizarUf(valor) {
  const uf = String(valor || '').trim().toUpperCase()
  return /^[A-Z]{2}$/.test(uf) ? uf : null
}

function limparTexto(valor) {
  return String(valor || '').trim().replace(/\s+/g, ' ')
}

function normalizarBrasilApi(json = {}) {
  const cnpj = normalizarCnpj(json.cnpj, { exigirValido: false })
  if (!cnpj) throw erro('Resposta sem CNPJ.', 502, 'CNPJ_PROVIDER_BAD_RESPONSE')
  const endereco = {
    logradouro: json.logradouro || null,
    numero: json.numero || null,
    complemento: json.complemento || null,
    bairro: json.bairro || null,
    cep: json.cep || null,
  }
  return {
    cnpj_digits: cnpj,
    razao_social: json.razao_social || json.nome || null,
    nome_fantasia: json.nome_fantasia || null,
    situacao_cadastral: json.descricao_situacao_cadastral || json.situacao_cadastral || null,
    cnae_principal: json.cnae_fiscal ? String(json.cnae_fiscal) : null,
    cnae_descricao: json.cnae_fiscal_descricao || null,
    municipio: json.municipio || null,
    uf: normalizarUf(json.uf),
    endereco,
    qsa: Array.isArray(json.qsa) ? json.qsa : null,
    fonte: 'brasilapi',
    dados: json,
  }
}

async function consultarBrasilApi(cnpjDigits) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Number(process.env.FISCAL_CNPJ_TIMEOUT_MS || 12000))
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${encodeURIComponent(cnpjDigits)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      const status = res.status === 404 ? 404 : 502
      throw erro(json.message || `Consulta CNPJ falhou (${res.status}).`, status, res.status === 404 ? 'CNPJ_NAO_ENCONTRADO' : 'CNPJ_PROVIDER_FAILED')
    }
    return normalizarBrasilApi(json)
  } catch (err) {
    if (err.name === 'AbortError') throw erro('Consulta CNPJ expirou.', 504, 'CNPJ_PROVIDER_TIMEOUT')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function consultarCnpj(cnpjDigits) {
  const provider = String(process.env.FISCAL_CNPJ_PROVIDER || 'brasilapi').trim().toLowerCase()
  if (provider === 'off' || provider === 'disabled') {
    throw erro('Fonte de CNPJ nao configurada.', 503, 'CNPJ_PROVIDER_DISABLED')
  }
  if (provider !== 'brasilapi') {
    throw erro(`Fonte de CNPJ nao suportada: ${provider}.`, 503, 'CNPJ_PROVIDER_UNSUPPORTED')
  }
  return consultarBrasilApi(cnpjDigits)
}

function calcularConfiancaPorNome(row = {}, { nome = '', cidade = '', uf = '' } = {}) {
  const alvo = limparTexto(nome).toLowerCase()
  if (!alvo) return 0
  const razao = limparTexto(row.razao_social).toLowerCase()
  const fantasia = limparTexto(row.nome_fantasia).toLowerCase()
  let score = (razao && (razao.includes(alvo) || alvo.includes(razao))) || (fantasia && (fantasia.includes(alvo) || alvo.includes(fantasia))) ? 62 : 45
  if (uf && normalizarUf(uf) === normalizarUf(row.uf)) score += 12
  if (cidade && limparTexto(cidade).toLowerCase() === limparTexto(row.municipio).toLowerCase()) score += 14
  return Math.min(88, score)
}

module.exports = {
  erro,
  cnpjValido,
  normalizarCnpj,
  normalizarUf,
  limparTexto,
  normalizarBrasilApi,
  consultarCnpj,
  calcularConfiancaPorNome,
}
