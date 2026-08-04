'use strict'
// Resultado da BUSCA automática legada da Aquisição — lógica PURA (sem I/O), testável.
//
// O agendamento que vivia aqui (buscaProspeccaoDevePreencher) foi REMOVIDO junto com o
// motor que ele governava: a Busca IA não dispara mais coleta paga sozinha. Sobrou a
// leitura do resultado, ainda usada pelo worker para snapshots legados que já estavam
// em voo. As rotinas de Aquisição têm o seu próprio agendador puro
// (services/aquisicao-rotinas-scheduler.js).

const TZ = process.env.PROSPEC_SCHEDULER_TZ || process.env.CAPTACAO_SCHEDULER_TZ || 'America/Sao_Paulo'

function resultadoBuscaAutomatica(config, resultado = {}) {
  const novos = Math.max(0, Number.parseInt(resultado.novos_prospects, 10) || 0)
  const zeros = novos === 0 ? Math.max(0, Number(config?.busca_zero_consecutivos || 0)) + 1 : 0
  const nicho = String(resultado.nicho || '').trim()
  const cidade = String(resultado.cidade || '').trim()
  let estado = 'aguardando'
  let mensagem = `Busca concluída: ${novos} leads novos em ${nicho} / ${cidade}.`
  if (zeros >= 2 && config?.modo_busca === 'automatico_fixo') {
    estado = 'esgotado'
    mensagem = `Não encontramos mais leads novos para ${nicho} em ${cidade}. Altere o mercado ou ative a Busca IA.`
  } else if (zeros >= 2 && config?.modo_busca === 'ia') {
    mensagem = `O mercado ${nicho} / ${cidade} se esgotou. A IA escolherá outro mercado no próximo ciclo.`
  }
  return { novos, zeros, estado, mensagem }
}


module.exports = {
  TZ,
  resultadoBuscaAutomatica,
}
