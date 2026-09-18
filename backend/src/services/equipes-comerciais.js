'use strict'
// Equipes Comerciais — regras puras de entrada.
// Sem banco, sem HTTP e sem conhecimento de telas: esta camada so normaliza e valida payload.

function erro(mensagem, statusCode = 400, code = 'BAD_REQUEST') {
  const e = new Error(mensagem)
  e.statusCode = statusCode
  e.code = code
  return e
}

function texto(v, max) {
  const s = String(v == null ? '' : v).trim()
  return s ? s.slice(0, max) : ''
}

function normalizarUsuarioIds(entrada) {
  if (entrada == null) return []
  if (!Array.isArray(entrada)) throw erro('usuario_ids deve ser uma lista.')
  return [...new Set(entrada.map((v) => String(v || '').trim()).filter(Boolean))]
}

function normalizarEquipe(dados = {}, { criar = false } = {}) {
  const out = {}
  if (criar || dados.nome !== undefined) {
    const nome = texto(dados.nome, 120)
    if (criar && nome.length < 2) throw erro('Nome da equipe obrigatório.')
    if (dados.nome !== undefined && nome.length < 2) throw erro('Nome da equipe precisa ter ao menos 2 caracteres.')
    if (nome) out.nome = nome
  }
  if (criar || dados.nicho_id !== undefined) {
    const nichoId = texto(dados.nicho_id, 80)
    if (!nichoId) throw erro('Selecione o nicho da equipe.')
    out.nicho_id = nichoId
  }
  if (dados.descricao !== undefined) {
    out.descricao = texto(dados.descricao, 1000) || null
  }
  if (dados.usuario_ids !== undefined) {
    out.usuario_ids = normalizarUsuarioIds(dados.usuario_ids)
  }
  return out
}

function normalizarParticipantes(dados = {}) {
  return { usuario_ids: normalizarUsuarioIds(dados.usuario_ids) }
}

function normalizarEncerramento(dados = {}) {
  const motivo = texto(dados.motivo, 500) || 'Equipe encerrada pelo gestor.'
  return { motivo }
}

module.exports = {
  erro,
  normalizarEquipe,
  normalizarParticipantes,
  normalizarEncerramento,
  normalizarUsuarioIds,
}
