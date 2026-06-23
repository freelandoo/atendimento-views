'use strict'

// Pure helpers for contact name capture. Persistence stays in the caller, where
// the DB pool and the FK-safe point in the webhook are available.

const NAO_NOME = new Set([
  'o', 'a', 'os', 'as', 'nao', 'sim', 'aqui', 'e', 'eh', 'sou', 'meu', 'minha',
  'nome', 'me', 'chama', 'chamo', 'pode', 'de', 'do', 'da', 'oi', 'ola',
  'bom', 'boa', 'dia', 'tarde', 'noite', 'obrigado', 'obrigada', 'sr', 'sra',
  'dr', 'dra', 'cliente', 'lead', 'usuario', 'usuaria', 'contato',
  'responsavel', 'whatsapp', 'zap', 'atendimento', 'suporte', 'vendas',
  'financeiro', 'restaurante', 'pizzaria', 'hamburgueria', 'lanchonete', 'loja',
  'comercial', 'empresa', 'negocio', 'negocios', 'oficina', 'clinica',
  'barbearia', 'academia', 'escola', 'mercado', 'padaria', 'distribuidora',
  'construtora', 'imobiliaria', 'agencia', 'escritorio', 'consultorio', 'studio',
  'estetica', 'beleza', 'salao', 'delivery',
])

function semAcentos(raw) {
  return String(raw == null ? '' : raw)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function primeiroNome(raw) {
  const limpo = String(raw == null ? '' : raw)
    .replace(/[^\p{L}\s'-]/gu, ' ')
    .trim()
  const token = limpo.split(/\s+/).filter(Boolean)[0] || ''
  if (token.length < 2 || token.length > 30) return null
  if (!/\p{L}/u.test(token)) return null
  if (NAO_NOME.has(semAcentos(token).toLowerCase())) return null
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
}

function nomeDePushName(pushName) {
  const raw = String(pushName == null ? '' : pushName).trim()
  if (!raw || !/\p{L}/u.test(raw)) return null
  return primeiroNome(raw)
}

const NAME = "([\\p{L}'-]{2,30})"
const E = '(?:e|eh|\\u00e9)'
const NAO = 'n(?:ao|\\u00e3o)'

const PADROES = [
  new RegExp(`\\bmeu\\s+nome\\s+${E}\\s+${NAME}`, 'iu'),
  new RegExp(`\\bme\\s+chamo\\s+${NAME}`, 'iu'),
  new RegExp(`\\b(?:pode\\s+)?me\\s+chama(?:r)?\\s+de\\s+${NAME}`, 'iu'),
  new RegExp(`\\b(?:aqui\\s+${E}|quem\\s+fala\\s+${E})\\s+(?:o\\s+|a\\s+)?${NAME}`, 'iu'),
  new RegExp(`\\bsou\\s+(?:o\\s+|a\\s+)${NAME}`, 'iu'),
  new RegExp(`\\b${NAO}[,.!\\s]+(?:meu\\s+nome\\s+${E}|me\\s+chamo|${E}|sou\\s+(?:o\\s+|a\\s+))\\s+${NAME}`, 'iu'),
]

function extrairNomeDeclarado(texto) {
  const t = String(texto == null ? '' : texto)
  for (const re of PADROES) {
    const m = t.match(re)
    if (m && m[1]) {
      const nome = primeiroNome(m[1])
      if (nome) return nome
    }
  }
  return null
}

module.exports = { primeiroNome, nomeDePushName, extrairNomeDeclarado }
