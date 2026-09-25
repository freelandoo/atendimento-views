'use strict'

const { normalizarPais } = require('./paises')
const { horaLocal } = require('./captacao-scheduler')

const TIMEZONE_PADRAO_POR_PAIS = Object.freeze({
  BR: 'America/Sao_Paulo',
  US: 'America/New_York',
  PT: 'Europe/Lisbon',
  MX: 'America/Mexico_City',
  AR: 'America/Argentina/Buenos_Aires',
  CL: 'America/Santiago',
  CO: 'America/Bogota',
  PE: 'America/Lima',
  UY: 'America/Montevideo',
  PY: 'America/Asuncion',
  BO: 'America/La_Paz',
  ES: 'Europe/Madrid',
})

const CIDADE_TIMEZONE = Object.freeze({
  BR: [
    [['RIO BRANCO', 'CRUZEIRO DO SUL'], 'America/Rio_Branco'],
    [['MANAUS', 'BOA VISTA', 'PORTO VELHO'], 'America/Manaus'],
    [['CUIABA', 'CUIABÁ', 'CAMPO GRANDE'], 'America/Cuiaba'],
  ],
  US: [
    [['LOS ANGELES', 'SAN FRANCISCO', 'SAN DIEGO', 'SEATTLE', 'PORTLAND', 'LAS VEGAS'], 'America/Los_Angeles'],
    [['DENVER', 'PHOENIX', 'SALT LAKE CITY'], 'America/Denver'],
    [['CHICAGO', 'DALLAS', 'HOUSTON', 'AUSTIN', 'MINNEAPOLIS'], 'America/Chicago'],
    [['NEW YORK', 'MIAMI', 'ORLANDO', 'BOSTON', 'ATLANTA', 'WASHINGTON'], 'America/New_York'],
  ],
  MX: [
    [['TIJUANA'], 'America/Tijuana'],
    [['CANCUN', 'CANCÚN'], 'America/Cancun'],
  ],
  PT: [
    [['AZORES', 'AÇORES', 'PONTA DELGADA'], 'Atlantic/Azores'],
    [['MADEIRA', 'FUNCHAL'], 'Atlantic/Madeira'],
  ],
  ES: [
    [['CANARIAS', 'CANARY', 'LAS PALMAS', 'SANTA CRUZ DE TENERIFE'], 'Atlantic/Canary'],
  ],
})

function semAcento(valor) {
  return String(valor == null ? '' : valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function textoBuscaLocalidade(lead = {}) {
  return semAcento([lead.cidade, lead.endereco].filter(Boolean).join(' ')).toUpperCase()
}

function timezoneDoLead(lead = {}) {
  const pais = normalizarPais(lead.pais || lead.country || 'BR')
  const texto = textoBuscaLocalidade(lead)
  const regras = CIDADE_TIMEZONE[pais] || []
  for (const [termos, timezone] of regras) {
    if (termos.some((termo) => texto.includes(semAcento(termo).toUpperCase()))) return timezone
  }
  return TIMEZONE_PADRAO_POR_PAIS[pais] || null
}

function minutosDoDia(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

function horaLocalTexto(now, timezone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]))
  return `${String(Number(parts.hour) % 24).padStart(2, '0')}:${parts.minute}`
}

function avaliarJanelaLocalLead(lead = {}, now = new Date(), inicio = '08:00', fim = '18:00') {
  const pais = normalizarPais(lead.pais || 'BR')
  const timezone = timezoneDoLead(lead)
  if (!timezone) {
    return { permitido: false, motivo: 'sem_fuso_resolvido', pais, timezone: null, hora_local: null }
  }
  const ini = minutosDoDia(inicio)
  const f = minutosDoDia(fim)
  if (ini == null || f == null || f < ini) {
    return { permitido: false, motivo: 'janela_invalida', pais, timezone, hora_local: null }
  }
  const local = horaLocal(now, timezone)
  const permitido = local.minutos_do_dia >= ini && local.minutos_do_dia <= f
  return {
    permitido,
    motivo: permitido ? 'janela_local_aberta' : 'fora_janela_local',
    pais,
    timezone,
    hora_local: horaLocalTexto(now, timezone),
    minutos_do_dia: local.minutos_do_dia,
  }
}

module.exports = {
  TIMEZONE_PADRAO_POR_PAIS,
  timezoneDoLead,
  avaliarJanelaLocalLead,
}
