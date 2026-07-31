'use strict'
// Converte um erro do apiFetch em UMA mensagem operacional clara. Distingue sessão
// expirada (401), permissão (403), rede (isNetwork) e conflito (409); detalhes técnicos
// ficam no console/log, nunca no toast. Usado no Centro de Ligações.

function msgErro(e, generico) {
  const fallback = generico || 'Não foi possível concluir a ação. Tente novamente.'
  if (!e) return fallback
  if (e.isNetwork) return 'Não foi possível conectar ao servidor. Verifique se o ambiente local está em execução.'
  const s = e.status
  if (s === 401) return 'Sua sessão expirou. Entre novamente para continuar.'
  if (s === 403) return 'Você não tem permissão para esta ação.'
  if (s === 500 || s === 502 || s === 503) return fallback
  // 404/409 e demais: usa a mensagem do backend se for clara (pt), senao o fallback.
  const m = typeof e.message === 'string' ? e.message.trim() : ''
  if (!m || /^failed to fetch$/i.test(m) || /^erro \d+$/i.test(m)) return fallback
  return m
}

module.exports = { msgErro }
