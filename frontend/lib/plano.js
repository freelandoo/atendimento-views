// Tradução do veredito de PLANO que a API já resolveu (/api/auth/me e GET .../plano). A tela NÃO
// recalcula regra — mesmo contrato de lib/site-rotulos.js e lib/programa-aceite.js. O backend
// (services/plano-definicao.js) é a autoridade; aqui só se traduz para texto/boolean de tela.

const ROTULO_STATUS = {
  trial: 'Em teste',
  ativo: 'Ativo',
  atrasado: 'Pagamento atrasado',
  cancelado: 'Cancelado',
  expirado: 'Expirado',
}

// Precisa assinar/pagar? (acesso bloqueado). `null` = sem linha de plano (grandfather) → não bloqueia.
function precisaAssinar(plano) {
  return Boolean(plano) && plano.liberado === false
}

// Liberado, mas em modo leitura (pagamento atrasado).
function somenteLeitura(plano) {
  return Boolean(plano) && plano.liberado === true && plano.somenteLeitura === true
}

// Dias restantes do trial (0 = acabou). null quando não é trial ou sem data.
function diasRestantesTrial(plano) {
  if (!plano || plano.status !== 'trial' || !plano.trial_fim) return null
  const ms = new Date(plano.trial_fim).getTime() - Date.now()
  if (Number.isNaN(ms)) return null
  return ms <= 0 ? 0 : Math.ceil(ms / 86400000)
}

function rotuloStatus(plano) {
  if (!plano || !plano.status) return '—'
  return ROTULO_STATUS[plano.status] || plano.status
}

// Preço em reais → "R$ 149,90". null/invalid → "—".
function formatarPreco(reais) {
  if (reais == null || Number.isNaN(Number(reais))) return '—'
  return Number(reais).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

module.exports = { ROTULO_STATUS, precisaAssinar, somenteLeitura, diasRestantesTrial, rotuloStatus, formatarPreco }
