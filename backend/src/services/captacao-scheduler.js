'use strict'
// Agendamento automático das campanhas de captação (Instagram).
// Espelha o padrão de prospecting-scheduler.js: lógica PURA (sem I/O), testável.
// Decide se uma campanha deve disparar uma NOVA coleta agora, respeitando:
//   - intervalo "a cada X horas" (vs. ultima_coleta_em);
//   - janela de horário (das HH:MM às HH:MM);
//   - dias da semana ativos;
// tudo no fuso do operador (default America/Sao_Paulo). O disparo em si fica no
// motor (social-capture.dispararCampanhasAgendadas); aqui só a decisão.

const TZ = process.env.CAPTACAO_SCHEDULER_TZ || 'America/Sao_Paulo'
const DIAS_UTEIS = [1, 2, 3, 4, 5]

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

function horaParaMinutos(hora) {
  const [h, m] = normalizarHora(hora, '00:00').split(':').map((x) => Number.parseInt(x, 10))
  return (h * 60) + m
}

function normalizarDias(dias) {
  const entrada = Array.isArray(dias)
    ? dias
    : String(dias == null ? '' : dias).split(',')
  const norm = entrada
    .map((d) => Number.parseInt(d, 10))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  const unicos = [...new Set(norm)]
  return unicos.length ? unicos.sort((a, b) => a - b) : [...DIAS_UTEIS]
}

// Normaliza o bloco de agenda da campanha (vive em captacao_campanhas.metadata_json).
// `input` tem prioridade; `base` (metadata atual) é o fallback em updates parciais.
function normalizarAgendaCampanha(input = {}, base = {}) {
  const get = (...keys) => {
    for (const k of keys) if (input[k] != null) return input[k]
    for (const k of keys) if (base[k] != null) return base[k]
    return undefined
  }
  const inicio = normalizarHora(get('janela_inicio', 'janelaInicio'), '08:00')
  let fim = normalizarHora(get('janela_fim', 'janelaFim'), '18:00')
  if (horaParaMinutos(fim) <= horaParaMinutos(inicio)) fim = '18:00'
  const ativoRaw = get('agendamento_ativo', 'agendamentoAtivo')
  return {
    agendamento_ativo: ativoRaw === true || ativoRaw === 'true',
    intervalo_horas: inteiro(get('intervalo_horas', 'intervaloHoras'), 24, 1, 168),
    janela_inicio: inicio,
    janela_fim: fim,
    dias_semana: normalizarDias(get('dias_semana', 'diasSemana')),
  }
}

// Hora/dia locais no fuso do operador, sem depender do TZ do processo (Railway = UTC).
function horaLocal(date = new Date(), tz = TZ) {
  const d = date instanceof Date ? date : new Date(date)
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit',
  })
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]))
  const diasMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const hora = Number.parseInt(parts.hour, 10) % 24
  const minuto = Number.parseInt(parts.minute, 10)
  return {
    dia_semana: diasMap[parts.weekday] ?? d.getDay(),
    minutos_do_dia: (hora * 60) + minuto,
  }
}

// Decide se a campanha deve disparar uma nova coleta AGORA.
function campanhaDevePreencher(campanha, agora = new Date(), tz = TZ) {
  if (!campanha || campanha.ativo === false) return false
  const agenda = normalizarAgendaCampanha(campanha.metadata_json || {})
  if (!agenda.agendamento_ativo) return false

  const { dia_semana, minutos_do_dia } = horaLocal(agora, tz)
  if (!agenda.dias_semana.includes(dia_semana)) return false
  if (minutos_do_dia < horaParaMinutos(agenda.janela_inicio)) return false
  if (minutos_do_dia > horaParaMinutos(agenda.janela_fim)) return false

  const ultima = campanha.ultima_coleta_em ? new Date(campanha.ultima_coleta_em) : null
  if (ultima && Number.isFinite(ultima.valueOf())) {
    const horasDesde = ((agora instanceof Date ? agora.getTime() : Date.now()) - ultima.getTime()) / 3_600_000
    if (horasDesde < agenda.intervalo_horas) return false
  }
  return true
}

module.exports = {
  DIAS_UTEIS,
  normalizarAgendaCampanha,
  normalizarDias,
  horaParaMinutos,
  horaLocal,
  campanhaDevePreencher,
}
