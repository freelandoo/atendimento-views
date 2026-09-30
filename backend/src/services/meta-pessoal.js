'use strict'
/**
 * META PESSOAL — regras PURAS (sem banco, HTTP, IA ou rede).
 *
 * O que ela responde: "que dias/quanto vale a meta?", "qual o alvo de HOJE?", "que semana é
 * esta?", "quão perto está o progresso?". A CONTAGEM do que foi feito vem do Quadro do Dia
 * (`db/plano-dia.resumoPeriodo`, cards em `feito`) — este módulo não conta nada, só decide alvo
 * e proximidade sobre números que já chegaram.
 *
 * A meta é PESSOAL e não é placar: mede o próprio ritmo de quem a definiu, não compara pessoas.
 */

const TIMEZONE = () => process.env.APP_TIMEZONE || process.env.TZ || 'America/Sao_Paulo'

/** Dia operacional de agora, em APP_TIMEZONE (YYYY-MM-DD). Mesmo critério do Quadro do Dia. */
function diaOperacional(agora = new Date(), tz = TIMEZONE()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(agora)
}

/** Dia da semana ISO (1=segunda .. 7=domingo) de um 'YYYY-MM-DD'. */
function diaIso(dia) {
  const d = new Date(`${dia}T12:00:00.000Z`).getUTCDay() // 0=domingo..6=sábado
  return d === 0 ? 7 : d
}

function somarDias(dia, n) {
  const d = new Date(`${dia}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * A semana (segunda a domingo) que contém `dia`. Segunda como início porque é como a operação
 * pensa a semana de trabalho; os dias atendidos podem ser um subconjunto dela.
 */
function semanaDe(dia) {
  const iso = diaIso(dia)
  const inicio = somarDias(dia, -(iso - 1))
  return { inicio, fim: somarDias(inicio, 6) }
}

/**
 * Normaliza a config vinda de fora. `null` quando não há meta utilizável — a tela então mostra
 * "Definir meta" e nenhuma barra (o mesmo contrato do `proximidade` sem alvo).
 */
function normalizarConfig(entrada) {
  const alvo = Math.trunc(Number(entrada && entrada.alvo_semanal))
  if (!Number.isFinite(alvo) || alvo <= 0) return null
  const dias = [...new Set(
    (Array.isArray(entrada && entrada.dias_semana) ? entrada.dias_semana : [])
      .map((n) => Math.trunc(Number(n)))
      .filter((n) => n >= 1 && n <= 7)
  )].sort((a, b) => a - b)
  if (!dias.length) return null
  return { alvo_semanal: alvo, dias_semana: dias }
}

/**
 * Alvo do dia = meta semanal dividida pelos dias atendidos, se `dia` for um deles; senão 0.
 * ponytail: divisão arredondada (Math.round), então a soma dos alvos diários pode não bater
 * exatamente o semanal — de propósito: o alvo/dia é um guia, e a barra da SEMANA usa o total
 * real contra o alvo semanal, então nada mente. Refinar a distribuição do resto se incomodar.
 */
function alvoDoDia(config, dia) {
  if (!config) return 0
  if (!config.dias_semana.includes(diaIso(dia))) return 0
  return Math.max(1, Math.round(config.alvo_semanal / config.dias_semana.length))
}

/**
 * O progresso no formato que `frontend/lib/minha-operacao.proximidade` espera:
 * `{ alvo, feito, fracao, faltam, alcancado }`. `alvo` 0/null ⇒ sem barra.
 */
function progresso(feito, alvo) {
  const f = Math.max(0, Math.trunc(Number(feito) || 0))
  const a = Math.trunc(Number(alvo) || 0)
  if (a <= 0) return { alvo: a > 0 ? a : (alvo == null ? null : 0), feito: f, fracao: 0, faltam: 0, alcancado: false }
  return {
    alvo: a,
    feito: f,
    fracao: f / a,
    faltam: Math.max(0, a - f),
    alcancado: f >= a,
  }
}

module.exports = {
  diaOperacional,
  diaIso,
  semanaDe,
  normalizarConfig,
  alvoDoDia,
  progresso,
}
