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

const inteiroPositivo = (v) => {
  const n = Math.trunc(Number(v))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Normaliza a config vinda de fora. `null` quando não há meta utilizável — a tela então mostra
 * "Definir meta" e nenhuma barra (o mesmo contrato do `proximidade` sem alvo).
 *
 * `modo='separado'`: exige alvo de ligação E de mensagem (> 0); `alvo_semanal` é a SOMA (o total
 * de contatos, mantido para a CHECK > 0 da migration 111 seguir valendo). `modo='geral'` (default):
 * um alvo só, e os alvos por canal ficam nulos.
 */
function normalizarConfig(entrada) {
  const dias = [...new Set(
    (Array.isArray(entrada && entrada.dias_semana) ? entrada.dias_semana : [])
      .map((n) => Math.trunc(Number(n)))
      .filter((n) => n >= 1 && n <= 7)
  )].sort((a, b) => a - b)
  if (!dias.length) return null

  if (entrada && entrada.modo === 'separado') {
    const lig = inteiroPositivo(entrada.alvo_ligacoes)
    const msg = inteiroPositivo(entrada.alvo_mensagens)
    if (!lig || !msg) return null
    return { modo: 'separado', alvo_semanal: lig + msg, alvo_ligacoes: lig, alvo_mensagens: msg, dias_semana: dias }
  }

  const alvo = inteiroPositivo(entrada && entrada.alvo_semanal)
  if (!alvo) return null
  return { modo: 'geral', alvo_semanal: alvo, alvo_ligacoes: null, alvo_mensagens: null, dias_semana: dias }
}

/**
 * Alvo do dia para um alvo SEMANAL de canal = semanal / dias atendidos, se `dia` for um deles.
 * ponytail: divisão arredondada (Math.round), então a soma dos alvos diários pode não bater
 * exatamente o semanal — de propósito: o alvo/dia é um guia, e a barra da SEMANA usa o total
 * real contra o alvo semanal, então nada mente. Refinar a distribuição do resto se incomodar.
 */
function alvoDiaDe(alvoSemanal, config, dia) {
  if (!config || !alvoSemanal) return 0
  if (!config.dias_semana.includes(diaIso(dia))) return 0
  return Math.max(1, Math.round(alvoSemanal / config.dias_semana.length))
}

/** Alvo do dia do total de contatos (compat: usa `alvo_semanal`). */
function alvoDoDia(config, dia) {
  return alvoDiaDe(config ? config.alvo_semanal : 0, config, dia)
}

/**
 * As barras de um período, já no formato que a tela desenha: `[{ chave, prog }]`.
 * `escopo`: 'dia' divide o alvo semanal pelos dias; 'semana' usa o alvo semanal cheio.
 * `feitos`: `{ ligacoes, mensagens }` já contados no período (eventos reais).
 * Geral ⇒ uma barra 'contatos' (ligação + mensagem); Separado ⇒ 'ligacoes' e 'mensagens'.
 */
function medidasDoPeriodo(config, feitos, escopo, dia) {
  if (!config) return []
  const lig = Math.max(0, Math.trunc(Number(feitos && feitos.ligacoes) || 0))
  const msg = Math.max(0, Math.trunc(Number(feitos && feitos.mensagens) || 0))
  const alvoCanal = (semanal) => (escopo === 'dia' ? alvoDiaDe(semanal, config, dia) : semanal)
  if (config.modo === 'separado') {
    return [
      { chave: 'ligacoes', prog: progresso(lig, alvoCanal(config.alvo_ligacoes)) },
      { chave: 'mensagens', prog: progresso(msg, alvoCanal(config.alvo_mensagens)) },
    ]
  }
  return [{ chave: 'contatos', prog: progresso(lig + msg, alvoCanal(config.alvo_semanal)) }]
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
  alvoDiaDe,
  alvoDoDia,
  medidasDoPeriodo,
  progresso,
}
