'use strict'
// Agendamento automático da BUSCA do Google Places ("Agenda" da Aquisição).
// Espelha captacao-scheduler.js: lógica PURA (sem I/O), testável. Decide se a
// config de uma empresa deve disparar uma NOVA busca (pesquisarPlaces) agora,
// respeitando:
//   - intervalo "a cada X horas" (vs. ultima_busca_em);
//   - janela de horário (horario_inicio..horario_fim);
//   - dias da semana ativos (dias_semana_ativos);
// tudo no fuso do operador (default America/Sao_Paulo). O disparo em si fica no
// motor (prospecting.verificarAgendaBuscaRecorrenteProspeccao); aqui só a decisão.
// Reusa os helpers de fuso já validados do scheduler de captação.

const { horaLocal, horaParaMinutos, normalizarDias } = require('./captacao-scheduler')

const TZ = process.env.PROSPEC_SCHEDULER_TZ || process.env.CAPTACAO_SCHEDULER_TZ || 'America/Sao_Paulo'

function inteiro(valor, padrao, min, max) {
  const n = Number.parseInt(valor, 10)
  if (!Number.isFinite(n)) return padrao
  return Math.min(Math.max(n, min), max)
}

function normalizarHora(valor, padrao) {
  const m = String(valor == null ? '' : valor).trim().match(/^(\d{1,2}):(\d{2})/)
  if (!m) return padrao
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return padrao
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

// Decide se a busca recorrente da config deve rodar AGORA.
// `config` é a configuração persistida (configProspeccaoPersistida): tem
// horario_inicio/horario_fim (HH:MM), dias_semana_ativos[], agendamento_busca_ativo,
// busca_intervalo_horas e ultima_busca_em.
function buscaProspeccaoDevePreencher(config, agora = new Date(), tz = TZ) {
  if (!config) return false
  if (config.agendamento_busca_ativo !== true) return false
  const modo = String(config.modo_busca || 'ia')
  if (!['automatico_fixo', 'ia'].includes(modo)) return false
  if (['esgotado', 'sem_mercados', 'erro', 'pausado'].includes(String(config.busca_estado || ''))) return false
  // A busca tem seu próprio liga/desliga. Não reutilize `ativo`: esse campo pertence à
  // rotina legada de disparo, removida do tick automático da Aquisição.

  // Sem nicho+cidade padrão não há o que buscar (a busca do Places exige ambos).
  if (modo === 'automatico_fixo' && (!config.categoria_padrao || !config.cidade_padrao)) return false

  const dias = normalizarDias(config.dias_semana_ativos)
  const inicio = normalizarHora(config.horario_inicio, '08:00')
  let fim = normalizarHora(config.horario_fim, '17:00')
  if (horaParaMinutos(fim) <= horaParaMinutos(inicio)) fim = '17:00'

  const { dia_semana, minutos_do_dia } = horaLocal(agora, tz)
  if (!dias.includes(dia_semana)) return false
  if (minutos_do_dia < horaParaMinutos(inicio)) return false
  if (minutos_do_dia > horaParaMinutos(fim)) return false

  const intervalo = inteiro(config.busca_intervalo_horas, 6, 6, 168)
  const ultima = config.ultima_busca_em ? new Date(config.ultima_busca_em) : null
  if (ultima && Number.isFinite(ultima.valueOf())) {
    const ref = agora instanceof Date ? agora.getTime() : Date.now()
    const horasDesde = (ref - ultima.getTime()) / 3_600_000
    if (horasDesde < intervalo) return false
  }
  return true
}

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
  buscaProspeccaoDevePreencher,
  resultadoBuscaAutomatica,
}
