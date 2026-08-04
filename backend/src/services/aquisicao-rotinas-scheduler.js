'use strict'
// Agendamento das ROTINAS de Aquisição — lógica PURA (sem I/O), testável.
//
// Substitui, para o mercado FIXO, a decisão que vivia em prospecting-search-scheduler.js
// (que lia a configuração única da empresa). Aqui cada rotina decide por si:
//   - dias da semana ativos;
//   - janela de horário (janela_inicio..janela_fim);
//   - intervalo próprio (mínimo de 6h) desde a última execução DISPARADA;
// tudo no fuso do operador (default America/Sao_Paulo).
//
// Reusa os helpers de fuso já validados da captação (horaLocal/horaParaMinutos/
// normalizarDias) em vez de reimplementar aritmética de timezone.
//
// Duas regras que o motor depende deste módulo para respeitar:
//   1. execução perdida NÃO é compensada — quem ficou fora da janela simplesmente
//      espera a próxima janela válida (não há contador de "atrasadas");
//   2. o intervalo conta a partir do DISPARO (ultima_execucao_em), não da conclusão:
//      uma coleta que trava não pode reabrir o intervalo e gerar cobrança nova.

const { horaLocal, horaParaMinutos, normalizarDias } = require('./captacao-scheduler')

const TZ = process.env.PROSPEC_SCHEDULER_TZ || process.env.CAPTACAO_SCHEDULER_TZ || 'America/Sao_Paulo'

const INTERVALO_MIN_HORAS = 6
const INTERVALO_MAX_HORAS = 168
const QUANTIDADE_MIN = 1
const QUANTIDADE_MAX = 200
// Falhas seguidas antes de a rotina parar sozinha e pedir atenção do admin. Sem isso,
// uma rotina quebrada tentaria coleta paga a cada janela, indefinidamente.
const MAX_FALHAS_CONSECUTIVAS = 3

const ESTADOS_PERSISTIDOS = ['aguardando', 'coletando', 'importando', 'concluida', 'pausada', 'precisa_atencao']
// Estados que bloqueiam um novo disparo até o admin agir.
const ESTADOS_BLOQUEADOS = ['precisa_atencao']
// Estados que indicam coleta em voo desta rotina.
const ESTADOS_EM_VOO = ['coletando', 'importando']

function inteiro(valor, padrao, min, max) {
  const n = Number.parseInt(valor, 10)
  if (!Number.isFinite(n)) return padrao
  return Math.min(Math.max(n, min), max)
}

function texto(valor, max = 120) {
  const t = String(valor == null ? '' : valor).trim()
  return t ? t.slice(0, max) : null
}

function normalizarHora(valor, padrao) {
  const m = String(valor == null ? '' : valor).trim().match(/^(\d{1,2}):(\d{2})/)
  if (!m) return padrao
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return padrao
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function normalizarUf(valor) {
  const t = String(valor == null ? '' : valor).trim().toUpperCase()
  return /^[A-Z]{2}$/.test(t) ? t : null
}

// "Cidade" + "UF" -> localização usada na geocodificação e na coleta.
// Sem isso, "Santana" sozinha pode geocodificar em qualquer estado — era o bug do
// fluxo manual, que mandava só a cidade.
function localizacaoRotina(cidade, uf) {
  const c = texto(cidade, 80)
  if (!c) return null
  const u = normalizarUf(uf)
  if (!u) return c
  // Não duplica a UF quando o operador já digitou "Campinas - SP".
  return new RegExp(`[-,/\\s]${u}$`, 'i').test(c) ? c : `${c} - ${u}`
}

// Normaliza o payload de uma rotina (criação ou edição). `base` é a rotina atual,
// usada como fallback em edições parciais (PATCH).
function normalizarRotina(payload = {}, base = {}) {
  const get = (...chaves) => {
    for (const k of chaves) if (payload[k] != null) return payload[k]
    for (const k of chaves) if (base[k] != null) return base[k]
    return undefined
  }

  const nicho = texto(get('nicho'), 80)
  const cidade = texto(get('cidade'), 80)
  const inicio = normalizarHora(get('janela_inicio', 'janelaInicio'), '08:00')
  let fim = normalizarHora(get('janela_fim', 'janelaFim'), '18:00')
  // Janela invertida ou vazia cairia num CHECK do banco; corrigimos aqui com um padrão
  // previsível em vez de devolver erro 500 do Postgres.
  if (horaParaMinutos(fim) <= horaParaMinutos(inicio)) fim = '18:00'
  if (horaParaMinutos(fim) <= horaParaMinutos(inicio)) fim = '23:59'

  const ativoRaw = get('ativo')
  return {
    nicho,
    cidade,
    uf: normalizarUf(get('uf', 'estado')),
    dias_semana: normalizarDias(get('dias_semana', 'diasSemana')),
    janela_inicio: inicio,
    janela_fim: fim,
    intervalo_horas: inteiro(get('intervalo_horas', 'intervaloHoras'), INTERVALO_MIN_HORAS, INTERVALO_MIN_HORAS, INTERVALO_MAX_HORAS),
    quantidade: inteiro(get('quantidade'), QUANTIDADE_MAX, QUANTIDADE_MIN, QUANTIDADE_MAX),
    ativo: ativoRaw === true || ativoRaw === 'true',
  }
}

// Valida o que a normalização não consegue inventar. Devolve lista de problemas.
function validarRotina(rotina) {
  const erros = []
  if (!rotina.nicho) erros.push('Informe o nicho.')
  if (!rotina.cidade) erros.push('Informe a cidade.')
  if (!rotina.dias_semana.length) erros.push('Selecione ao menos um dia da semana.')
  return erros
}

function paraDate(valor) {
  if (!valor) return null
  const d = valor instanceof Date ? valor : new Date(valor)
  return Number.isFinite(d.valueOf()) ? d : null
}

function agoraMs(agora) {
  return agora instanceof Date ? agora.getTime() : new Date(agora).getTime()
}

// Horas transcorridas desde o último DISPARO. null = nunca executou.
function horasDesdeUltimaExecucao(rotina, agora = new Date()) {
  const ultima = paraDate(rotina?.ultima_execucao_em)
  if (!ultima) return null
  return (agoraMs(agora) - ultima.getTime()) / 3_600_000
}

function dentroDaJanela(rotina, agora = new Date(), tz = TZ) {
  const dias = normalizarDias(rotina.dias_semana)
  const inicio = normalizarHora(rotina.janela_inicio, '08:00')
  const fim = normalizarHora(rotina.janela_fim, '18:00')
  const { dia_semana, minutos_do_dia } = horaLocal(agora, tz)
  if (!dias.includes(dia_semana)) return false
  if (minutos_do_dia < horaParaMinutos(inicio)) return false
  if (minutos_do_dia > horaParaMinutos(fim)) return false
  return true
}

function intervaloCumprido(rotina, agora = new Date()) {
  const horas = horasDesdeUltimaExecucao(rotina, agora)
  if (horas == null) return true
  const intervalo = inteiro(rotina.intervalo_horas, INTERVALO_MIN_HORAS, INTERVALO_MIN_HORAS, INTERVALO_MAX_HORAS)
  return horas >= intervalo
}

// Decide se ESTA rotina pode disparar agora. Não sabe (nem precisa saber) se a empresa
// já tem outra coleta em voo — essa trava é do banco e do motor.
function rotinaDeveExecutar(rotina, agora = new Date(), tz = TZ) {
  if (!rotina) return false
  if (rotina.ativo !== true) return false
  if (ESTADOS_BLOQUEADOS.includes(String(rotina.estado || ''))) return false
  if (ESTADOS_EM_VOO.includes(String(rotina.estado || ''))) return false
  if (!rotina.nicho || !rotina.cidade) return false
  if (!dentroDaJanela(rotina, agora, tz)) return false
  if (!intervaloCumprido(rotina, agora)) return false
  return true
}

// Escolhe UMA rotina elegível da empresa. Quem esperou mais tempo vai primeiro
// (nunca executada primeiro de todas); empate desempatado pela criação, para a ordem
// ser estável entre ticks. As demais elegíveis ficam "na fila" — sem estado extra:
// continuam elegíveis no próximo tick, quando a coleta em voo terminar.
function escolherRotinaElegivel(rotinas, agora = new Date(), tz = TZ) {
  const elegiveis = (rotinas || []).filter((r) => rotinaDeveExecutar(r, agora, tz))
  if (!elegiveis.length) return null
  return elegiveis.sort((a, b) => {
    const ua = paraDate(a.ultima_execucao_em)
    const ub = paraDate(b.ultima_execucao_em)
    if (!ua && ub) return -1
    if (ua && !ub) return 1
    if (ua && ub && ua.getTime() !== ub.getTime()) return ua.getTime() - ub.getTime()
    const ca = paraDate(a.criado_em)?.getTime() ?? 0
    const cb = paraDate(b.criado_em)?.getTime() ?? 0
    if (ca !== cb) return ca - cb
    return String(a.id || '').localeCompare(String(b.id || ''))
  })[0]
}

// Momento em que o intervalo desta rotina vence (não considera janela/dias — é só o
// piso do intervalo). null = pode agora.
function liberacaoPorIntervalo(rotina, agora = new Date()) {
  const ultima = paraDate(rotina?.ultima_execucao_em)
  if (!ultima) return null
  const intervalo = inteiro(rotina.intervalo_horas, INTERVALO_MIN_HORAS, INTERVALO_MIN_HORAS, INTERVALO_MAX_HORAS)
  const alvo = new Date(ultima.getTime() + (intervalo * 3_600_000))
  return alvo.getTime() <= agoraMs(agora) ? null : alvo
}

// Próxima execução possível: varre minuto a minuto seria caro, então avaliamos os
// próximos candidatos naturais (agora, ou o início da janela dos próximos 14 dias).
// Devolve Date ou null (rotina pausada / sem dia ativo).
function proximaExecucao(rotina, agora = new Date(), tz = TZ) {
  if (!rotina || rotina.ativo !== true) return null
  if (ESTADOS_BLOQUEADOS.includes(String(rotina.estado || ''))) return null

  const liberacao = liberacaoPorIntervalo(rotina, agora)
  const piso = liberacao && liberacao.getTime() > agoraMs(agora) ? liberacao : new Date(agoraMs(agora))
  if (dentroDaJanela(rotina, piso, tz) && intervaloCumprido(rotina, piso)) return piso

  const dias = normalizarDias(rotina.dias_semana)
  const inicio = normalizarHora(rotina.janela_inicio, '08:00')
  const minutosInicio = horaParaMinutos(inicio)

  // Caminha dia a dia a partir do piso, testando o INÍCIO da janela de cada dia.
  for (let i = 0; i <= 14; i += 1) {
    const base = new Date(piso.getTime() + (i * 86_400_000))
    const { dia_semana, minutos_do_dia } = horaLocal(base, tz)
    if (!dias.includes(dia_semana)) continue
    // Deslocamento até o início da janela daquele dia local.
    const delta = (minutosInicio - minutos_do_dia) * 60_000
    const candidato = new Date(base.getTime() + delta)
    if (candidato.getTime() < piso.getTime()) continue
    if (dentroDaJanela(rotina, candidato, tz) && intervaloCumprido(rotina, candidato)) return candidato
  }
  return null
}

// Estado exibido ao admin — junta o estado durável (banco) com o momento (janela,
// intervalo, fila). `temColetaEmVoo` = a empresa já tem uma coleta paga em andamento.
function estadoRotina(rotina, agora = new Date(), { temColetaEmVoo = false, tz = TZ } = {}) {
  if (!rotina) return { chave: 'pausada', label: 'Pausada' }
  const estado = String(rotina.estado || 'aguardando')
  if (estado === 'precisa_atencao') return { chave: 'precisa_atencao', label: 'Precisa de atenção' }
  if (estado === 'coletando') return { chave: 'coletando', label: 'Coletando' }
  if (estado === 'importando') return { chave: 'importando', label: 'Importando' }
  if (rotina.ativo !== true) return { chave: 'pausada', label: 'Pausada' }
  if (!intervaloCumprido(rotina, agora)) return { chave: 'aguardando_intervalo', label: 'Aguardando intervalo' }
  if (!dentroDaJanela(rotina, agora, tz)) return { chave: 'aguardando_horario', label: 'Aguardando horário' }
  if (temColetaEmVoo) return { chave: 'na_fila', label: 'Na fila' }
  if (estado === 'concluida') return { chave: 'concluida', label: 'Concluída' }
  return { chave: 'ativa', label: 'Ativa' }
}

module.exports = {
  TZ,
  INTERVALO_MIN_HORAS,
  INTERVALO_MAX_HORAS,
  QUANTIDADE_MIN,
  QUANTIDADE_MAX,
  MAX_FALHAS_CONSECUTIVAS,
  ESTADOS_PERSISTIDOS,
  localizacaoRotina,
  normalizarUf,
  normalizarRotina,
  validarRotina,
  dentroDaJanela,
  intervaloCumprido,
  horasDesdeUltimaExecucao,
  rotinaDeveExecutar,
  escolherRotinaElegivel,
  liberacaoPorIntervalo,
  proximaExecucao,
  estadoRotina,
}
