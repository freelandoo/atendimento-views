'use strict'

const MODOS_VALIDOS = new Set(['manual', 'semi_automatico', 'automatico'])
const DIAS_UTEIS = [1, 2, 3, 4, 5]

function normalizarModo(modo) {
  const raw = String(modo || 'manual').trim().toLowerCase()
  const normalizado = raw
    .replace(/-/g, '_')
    .replace('semiautomatico', 'semi_automatico')
    .replace('semi_automático', 'semi_automatico')
  return MODOS_VALIDOS.has(normalizado) ? normalizado : 'manual'
}

function normalizarInteiro(valor, padrao, min, max) {
  const n = Number.parseInt(valor, 10)
  if (!Number.isFinite(n)) return padrao
  return Math.min(Math.max(n, min), max)
}

function normalizarHora(valor, padrao) {
  const texto = String(valor || padrao || '').trim()
  const match = texto.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!match) return padrao
  const h = Number(match[1])
  const m = Number(match[2])
  if (h < 0 || h > 23 || m < 0 || m > 59) return padrao
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function horaParaMinutos(hora) {
  const h = normalizarHora(hora, '00:00')
  const [hh, mm] = h.split(':').map((p) => Number.parseInt(p, 10))
  return (hh * 60) + mm
}

function minutosParaHora(minutos) {
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function normalizarDiasSemana(dias) {
  const entrada = Array.isArray(dias)
    ? dias
    : String(dias || '')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean)
  const normalizados = entrada
    .map((d) => Number.parseInt(d, 10))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  const unicos = [...new Set(normalizados)]
  return unicos.length ? unicos.sort((a, b) => a - b) : [...DIAS_UTEIS]
}

function normalizarData(data) {
  if (data instanceof Date && !Number.isNaN(data.valueOf())) {
    return data.toISOString().slice(0, 10)
  }
  const texto = String(data || '').trim()
  const match = texto.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) return `${match[1]}-${match[2]}-${match[3]}`
  return new Date().toISOString().slice(0, 10)
}

function diaSemana(data) {
  const d = normalizarData(data)
  const [ano, mes, dia] = d.split('-').map((p) => Number.parseInt(p, 10))
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()
}

function diaPermitido(data, diasSemanaAtivos = DIAS_UTEIS) {
  const dias = normalizarDiasSemana(diasSemanaAtivos)
  return dias.includes(diaSemana(data))
}

function normalizarConfigProspeccao(input = {}) {
  const horarioInicio = normalizarHora(
    input.horario_inicio ?? input.horarioInicio ?? input.startTime,
    '08:00'
  )
  let horarioFim = normalizarHora(
    input.horario_fim ?? input.horarioFim ?? input.endTime,
    '17:00'
  )
  if (horaParaMinutos(horarioFim) <= horaParaMinutos(horarioInicio)) {
    horarioFim = '17:00'
  }

  return {
    ativo: input.ativo === true || input.enabled === true,
    modo: normalizarModo(input.modo),
    horario_inicio: horarioInicio,
    horario_fim: horarioFim,
    intervalo_envio_minutos: normalizarInteiro(
      input.intervalo_envio_minutos ?? input.intervaloEnvioMinutos,
      15,
      5,
      1440
    ),
    limite_diario: normalizarInteiro(input.limite_diario ?? input.limiteDiario, 80, 1, 200),
    dias_semana_ativos: normalizarDiasSemana(input.dias_semana_ativos ?? input.diasSemanaAtivos),
    categoria_padrao: input.categoria_padrao || input.categoriaPadrao || null,
    cidade_padrao: input.cidade_padrao || input.cidadePadrao || null,
    estado_padrao: input.estado_padrao || input.estadoPadrao || null,
    regiao_padrao: input.regiao_padrao || input.regiaoPadrao || null,
    gerar_mensagem_ia: input.gerar_mensagem_ia === true,
    envio_real_habilitado: input.envio_real_habilitado === true && input.gerar_mensagem_ia === true,
  }
}

function gerarSlotsEnvio(input = {}) {
  const config = normalizarConfigProspeccao(input)
  const data = normalizarData(input.data || input.data_execucao || input.date)
  if (!diaPermitido(data, config.dias_semana_ativos)) return []

  const inicio = horaParaMinutos(config.horario_inicio)
  const fim = horaParaMinutos(config.horario_fim)
  const slots = []
  for (let minuto = inicio; minuto <= fim && slots.length < config.limite_diario; minuto += config.intervalo_envio_minutos) {
    const hora = minutosParaHora(minuto)
    slots.push({
      ordem: slots.length + 1,
      data,
      hora,
      slot_local: `${data}T${hora}:00`,
      status_sugerido: 'simulado',
    })
  }
  return slots
}

function calcularCapacidadeDiaria(input = {}) {
  return gerarSlotsEnvio(input).length
}

module.exports = {
  DIAS_UTEIS,
  normalizarConfigProspeccao,
  normalizarDiasSemana,
  diaPermitido,
  gerarSlotsEnvio,
  calcularCapacidadeDiaria,
}
