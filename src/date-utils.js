'use strict'

const REUNIAO_PROPOSTA_HORARIOS_PADRAO = [
  '19:30',
  '19:45',
  '20:00',
  '20:15',
  '20:30',
  '20:45',
  '21:00',
  '21:15',
]

// Sábado tem janela de DIA (08:00–21:00); grade de 30 min, último início 20:30 (a
// reunião de 15 min termina dentro da janela). Dias úteis mantêm a janela da noite
// (REUNIAO_PROPOSTA_HORARIOS_PADRAO). Domingo não atende.
const REUNIAO_HORARIOS_SABADO = (() => {
  const out = []
  for (let min = 8 * 60; min <= 20 * 60 + 30; min += 30) {
    out.push(`${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`)
  }
  return out
})()

// Horários-padrão de reunião conforme o dia da semana (0=domingo … 6=sábado).
function horariosPadraoParaWeekday(weekday) {
  if (weekday === 6) return REUNIAO_HORARIOS_SABADO.slice()
  if (weekday >= 1 && weekday <= 5) return REUNIAO_PROPOSTA_HORARIOS_PADRAO.slice()
  return []
}

// A PJ atende reunião de segunda a sábado (domingo não).
function diaAtendeReuniao(weekday) {
  return weekday >= 1 && weekday <= 6
}

const TIMEZONE = 'America/Sao_Paulo'

function timezoneOperacional() {
  return process.env.APP_TIMEZONE || process.env.TZ || TIMEZONE
}

function partesDataEmTimezone(date, timeZone) {
  const dt = date instanceof Date ? date : new Date(date)
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = {}
  for (const p of fmt.formatToParts(dt)) {
    if (p.type !== 'literal') parts[p.type] = p.value
  }
  const hour = parts.hour === '24' ? 0 : parseInt(parts.hour, 10)
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hour,
    minute: parseInt(parts.minute, 10),
    second: parseInt(parts.second, 10),
  }
}

function utcParaDataLocalEmTimezone({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) {
  let guess = Date.UTC(year, month - 1, day, hour, minute, second, 0)
  for (let i = 0; i < 3; i++) {
    const got = partesDataEmTimezone(new Date(guess), timeZone)
    const gotUtc = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second, 0)
    const targetUtc = Date.UTC(year, month - 1, day, hour, minute, second, 0)
    const diff = targetUtc - gotUtc
    if (diff === 0) break
    guess += diff
  }
  return new Date(guess)
}

function adicionarDiasLocalEmTimezone(partes, dias) {
  const d = new Date(Date.UTC(partes.year, partes.month - 1, partes.day + dias, 12, 0, 0, 0))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

function partesDataBrasil(dataRef = new Date()) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezoneOperacional(),
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = dtf.formatToParts(dataRef)
  const out = { weekday: 0, year: 1970, month: 1, day: 1, hour: 0, minute: 0 }
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  for (const p of parts) {
    if (p.type === 'weekday') out.weekday = map[p.value] ?? 0
    if (p.type === 'year') out.year = parseInt(p.value, 10) || out.year
    if (p.type === 'month') out.month = parseInt(p.value, 10) || out.month
    if (p.type === 'day') out.day = parseInt(p.value, 10) || out.day
    if (p.type === 'hour') out.hour = parseInt(p.value, 10) || out.hour
    if (p.type === 'minute') out.minute = parseInt(p.value, 10) || out.minute
  }
  return out
}

function agoraSaoPaulo() {
  return new Date()
}

function adicionarMinutos(data, minutos) {
  const dt = data instanceof Date ? data : new Date(data)
  return new Date(dt.getTime() + (Number(minutos) || 0) * 60 * 1000)
}

function parseDataHoraSaoPaulo(data, hora = '00:00') {
  const dataStr = String(data || '').trim()
  const horaStr = String(hora || '00:00').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataStr)) return null
  const m = horaStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  const [year, month, day] = dataStr.split('-').map(Number)
  const hour = Math.min(Math.max(parseInt(m[1], 10), 0), 23)
  const minute = Math.min(Math.max(parseInt(m[2], 10), 0), 59)
  const second = Math.min(Math.max(parseInt(m[3] || '0', 10), 0), 59)
  return utcParaDataLocalEmTimezone({ year, month, day, hour, minute, second }, timezoneOperacional())
}

function parseDateTimeSaoPaulo(value) {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const s = String(value).trim()
  const local = s.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?$/)
  if (local) return parseDataHoraSaoPaulo(local[1], local[2])
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function inicioDoDiaSaoPaulo(data) {
  const s = typeof data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data)
    ? data
    : isoDateBrasil(data instanceof Date ? data : new Date(data || Date.now()))
  return parseDataHoraSaoPaulo(s, '00:00:00')
}

function fimDoDiaSaoPaulo(data) {
  const inicio = inicioDoDiaSaoPaulo(data)
  if (!inicio) return null
  const p = partesDataEmTimezone(inicio, timezoneOperacional())
  const nextLocal = adicionarDiasLocalEmTimezone({ year: p.year, month: p.month, day: p.day }, 1)
  return utcParaDataLocalEmTimezone({ ...nextLocal, hour: 0, minute: 0, second: 0 }, timezoneOperacional())
}

function gerarIntervaloDiaSaoPaulo(data) {
  return { inicio: inicioDoDiaSaoPaulo(data), fim: fimDoDiaSaoPaulo(data) }
}

function formatarDataHoraSaoPaulo(data) {
  if (!data) return ''
  const d = data instanceof Date ? data : new Date(data)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('pt-BR', {
    timeZone: timezoneOperacional(),
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

function formatarHoraSaoPaulo(data) {
  if (!data) return ''
  const d = data instanceof Date ? data : new Date(data)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('pt-BR', {
    timeZone: timezoneOperacional(),
    hour: '2-digit',
    minute: '2-digit',
  })
}

function isoDateBrasil(dataRef = new Date()) {
  const p = partesDataBrasil(dataRef)
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

function proximoDiaUtilReuniao(dataRef = new Date()) {
  let d = new Date(dataRef.getTime() + 24 * 60 * 60 * 1000)
  for (let i = 0; i < 8; i++) {
    const p = partesDataBrasil(d)
    if (p.weekday >= 1 && p.weekday <= 5) return d
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000)
  }
  return d
}

function sugestaoReuniaoProposta(dataRef = new Date()) {
  const p = partesDataBrasil(dataRef)
  const minutos = p.hour * 60 + p.minute
  const diaUtil = p.weekday >= 1 && p.weekday <= 5
  const minMesmoDia = 18 * 60 + 30
  const slots = REUNIAO_PROPOSTA_HORARIOS_PADRAO.map((h) => {
    const [hh, mm] = h.split(':').map((x) => parseInt(x, 10))
    return { label: h, minutos: hh * 60 + mm }
  })
  const candidatosHoje =
    diaUtil && minutos >= minMesmoDia ? slots.filter((s) => s.minutos >= minutos + 15).map((s) => s.label) : []
  if (candidatosHoje.length >= 2) {
    return {
      data_sugerida: isoDateBrasil(dataRef),
      data_label: 'hoje',
      horarios_sugeridos: candidatosHoje.slice(0, 2),
    }
  }
  return {
    data_sugerida: isoDateBrasil(proximoDiaUtilReuniao(dataRef)),
    data_label: 'amanha',
    horarios_sugeridos: ['19:30', '20:15'],
  }
}

/**
 * Extrai hora e minuto de um texto como "20:15", "20h15", "às 20:15", "pode ser 20h15".
 * Retorna { hora, min } ou null se não encontrar padrão válido.
 *
 * Correção PM: se o lead digitar "7:30" quando os horários oferecidos estão na janela
 * comercial (19–21h), converte automaticamente para o equivalente PM (7→19, 8→20, 9→21).
 */
function parsearHorarioReuniao(texto) {
  const m = String(texto || '').match(/(\d{1,2})[h:](\d{2})/)
  if (!m) return null
  let hora = Math.min(Math.max(parseInt(m[1], 10), 0), 23)
  const min = Math.min(parseInt(m[2], 10), 59)
  // Se hora é AM (< 12) e hora+12 cai na janela comercial (19–21h), converte para PM
  if (hora < 12 && hora + 12 >= 19 && hora + 12 <= 21) {
    hora += 12
  }
  const out = { hora, min }
  Object.defineProperty(out, 'normalizado', {
    value: `${String(hora).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
    enumerable: false,
  })
  return out
}

/**
 * Retorna nova Date representando o fim da reunião.
 * Padrão comercial PJ Codeworks: 15 minutos.
 */
function calcularFimReuniao(dataInicio, duracaoMinutos = 15) {
  return new Date(dataInicio.getTime() + duracaoMinutos * 60 * 1000)
}

/**
 * Converte data_sugerida "YYYY-MM-DD" + hora + minuto para Date UTC
 * usando o timezone de Sao Paulo corretamente.
 * Se data_sugerida inválida, usa o próximo dia útil como fallback.
 */
function dataInicioReuniao(dataSugerida, hora, min) {
  let year, month, day
  if (dataSugerida && /^\d{4}-\d{2}-\d{2}$/.test(dataSugerida)) {
    ;[year, month, day] = dataSugerida.split('-').map(Number)
  } else {
    const p = partesDataBrasil(proximoDiaUtilReuniao())
    ;({ year, month, day } = p)
  }
  return utcParaDataLocalEmTimezone({ year, month, day, hour: hora, minute: min }, timezoneOperacional())
}

module.exports = {
  TIMEZONE,
  REUNIAO_PROPOSTA_HORARIOS_PADRAO,
  REUNIAO_HORARIOS_SABADO,
  horariosPadraoParaWeekday,
  diaAtendeReuniao,
  timezoneOperacional,
  partesDataEmTimezone,
  utcParaDataLocalEmTimezone,
  adicionarDiasLocalEmTimezone,
  agoraSaoPaulo,
  parseDataHoraSaoPaulo,
  parseDateTimeSaoPaulo,
  inicioDoDiaSaoPaulo,
  fimDoDiaSaoPaulo,
  adicionarMinutos,
  formatarDataHoraSaoPaulo,
  formatarHoraSaoPaulo,
  gerarIntervaloDiaSaoPaulo,
  partesDataBrasil,
  isoDateBrasil,
  proximoDiaUtilReuniao,
  sugestaoReuniaoProposta,
  parsearHorarioReuniao,
  calcularFimReuniao,
  dataInicioReuniao,
}
