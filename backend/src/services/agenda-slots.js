'use strict'

// GRADE DE HORARIOS da agenda da TELA: quais slots estao livres, e por que os ocupados estao.
//
// Modulo PURO — sem banco, HTTP, IA ou rede. Recebe os eventos ja lidos e devolve o veredito.
// Quem le as duas agendas (a da tela e a do bot) e' a rota; aqui so' se decide.
//
// ─── A PERGUNTA QUE ESTE MODULO RESPONDE ───────────────────────────────────────────────
// Nao e' "quais horarios existem?", e sim **"este horario pode receber um compromisso, e se nao
// pode, por que?"**. A diferenca aparece na tela: um slot que some sem explicacao faz o operador
// achar que a agenda quebrou; um slot que diz "Feriado" resolve a duvida sem abrir nada.
//
// ─── POR QUE NAO REUSAR `buscarDisponibilidadeSemana` (src/agenda.js) ──────────────────
// Aquela funcao responde a pergunta do BOT: ela le so' `vendas.agenda_eventos` e usa a janela fixa
// de atendimento do funil (19:30–21:15 nos uteis). Aqui a janela e' da tela, mas a folga entre
// reunioes continua sendo regra de agenda: o operador nao deve marcar uma reuniao colada na outra.

// Grade padrao da tela: horario comercial, passo de 30 min. Sao defaults, nao regra — a rota
// aceita outros valores. O passo e' o mesmo da duracao para a grade nao ter buraco entre slots.
const GRADE_PADRAO = Object.freeze({ horaInicio: '08:00', horaFim: '18:00', duracaoMin: 30 })

// Folga operacional entre reunioes. O padrao da agenda da tela e' 2h, conforme a rotina comercial
// combinada; `REUNIAO_BUFFER_MIN=0` desliga em ambientes que precisem de agenda colada.
const REUNIAO_BUFFER_MINUTOS = (() => {
  const n = parseInt(process.env.REUNIAO_BUFFER_MIN, 10)
  return Number.isFinite(n) && n >= 0 ? n : 120
})()

// Vocabulario FECHADO do motivo de um slot indisponivel. A tela traduz estas chaves; texto livre
// aqui faria a tela ter de interpretar frase, que quebra em silencio quando a frase muda.
const MOTIVO = Object.freeze({
  BLOQUEIO: 'bloqueio',
  COMPROMISSO: 'compromisso',
  AGENDA_BOT: 'agenda_bot',
  PASSADO: 'passado',
  // O horario esta VAZIO — o que o ocupa e' a folga de uma reuniao vizinha. Motivo PROPRIO de
  // proposito: dizer "ja ha um compromisso" as 14:00 por causa de uma reuniao das 16:00 afirma um
  // compromisso que nao existe naquele horario, e o operador le isso como defeito da agenda.
  PREPARO: 'preparo',
})

function pad2(n) {
  return String(n).padStart(2, '0')
}

function minutosDeHora(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return h * 60 + min
}

function horaDeMinutos(total) {
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`
}

/**
 * Gera os horarios candidatos de um dia. Puro: nao sabe nada de agenda.
 * @returns {string[]} ex.: ['08:00','08:30',...]
 */
function gerarGrade({ horaInicio, horaFim, duracaoMin } = {}) {
  const ini = minutosDeHora(horaInicio || GRADE_PADRAO.horaInicio)
  const fim = minutosDeHora(horaFim || GRADE_PADRAO.horaFim)
  const passo = Number(duracaoMin) > 0 ? Math.floor(Number(duracaoMin)) : GRADE_PADRAO.duracaoMin
  if (ini == null || fim == null || fim <= ini) return []
  const out = []
  // O slot precisa CABER inteiro na janela: um slot de 30 min comecando 17:45 terminaria depois
  // das 18:00 e prometeria um horario que a janela nao tem.
  for (let t = ini; t + passo <= fim; t += passo) out.push(horaDeMinutos(t))
  return out
}

function sobrepoe(inicioA, fimA, inicioB, fimB) {
  return inicioA < fimB && fimA > inicioB
}

function janelaComBufferReuniao(inicio, fim, bufferMin = REUNIAO_BUFFER_MINUTOS) {
  const dataInicio = inicio instanceof Date ? inicio : new Date(inicio)
  const dataFim = fim instanceof Date ? fim : new Date(fim)
  if (Number.isNaN(dataInicio.getTime()) || Number.isNaN(dataFim.getTime())) {
    return { inicio, fim }
  }
  const ms = Math.max(0, Number(bufferMin) || 0) * 60 * 1000
  return {
    inicio: new Date(dataInicio.getTime() - ms),
    fim: new Date(dataFim.getTime() + ms),
  }
}

/**
 * Classifica o motivo pelo qual um evento ocupa o horario.
 * A ordem importa: BLOQUEIO vence COMPROMISSO porque e' a informacao que o operador precisa ver
 * primeiro ("e' feriado", nao "tem alguma coisa marcada").
 */
function motivoDoEvento(evento) {
  if (!evento) return MOTIVO.COMPROMISSO
  if (evento.__origem === 'bot') return MOTIVO.AGENDA_BOT
  return evento.tipo === 'bloqueio' ? MOTIVO.BLOQUEIO : MOTIVO.COMPROMISSO
}

function eventoUsaBufferReuniao(evento) {
  return evento && (evento.__origem === 'bot' || evento.tipo === 'reuniao')
}

/**
 * Marca cada horario candidato como livre ou ocupado.
 *
 * @param {object} p
 * @param {string}   p.data      dia em AAAA-MM-DD (so' para compor o retorno)
 * @param {string[]} p.candidatos horarios 'HH:MM'
 * @param {Array}    p.eventos   eventos que ocupam horario; cada um com data_inicio/data_fim
 *                               (Date ou ISO), `tipo` e, opcionalmente, `__origem: 'bot'`
 * @param {number}   p.duracaoMin duracao do slot
 * @param {(dia:string,hhmm:string)=>Date} p.paraInstante converte dia+hora no instante real
 *                               (INJETADO: fuso e' responsabilidade de quem chama, e e' o que
 *                               mantem este modulo puro e testavel sem depender de Intl)
 * @param {Date|null} p.agora    se informado, slot que ja passou vira indisponivel
 * @param {number} p.bufferReuniaoMin folga antes/depois de reunioes ja marcadas
 * @param {((d:Date)=>string)|null} p.formatarHora converte o instante do evento em 'HH:MM' local
 *                               (INJETADA, pelo mesmo motivo de `paraInstante`). Sem ela o slot de
 *                               PREPARO nao carrega o horario da reuniao — a tela diz o motivo,
 *                               so' nao diz de qual reuniao.
 * @returns {Array<{horario:string,livre:boolean,motivo:string|null,titulo:string|null,referencia:string|null}>}
 */
function marcarDisponibilidade({ data, candidatos, eventos = [], duracaoMin = 30, paraInstante, agora = null, bufferReuniaoMin = REUNIAO_BUFFER_MINUTOS, formatarHora = null }) {
  const ms = Math.max(1, Number(duracaoMin) || 30) * 60 * 1000
  const normalizados = eventos
    .map((ev) => {
      const inicio = ev.data_inicio instanceof Date ? ev.data_inicio : new Date(ev.data_inicio)
      const fim = ev.data_fim instanceof Date ? ev.data_fim : new Date(ev.data_fim)
      // As DUAS janelas sao guardadas: a real (onde o compromisso acontece) e a com folga (onde
      // ele nao acontece, mas nada pode ser marcado). As duas bloqueiam; so' a primeira permite
      // dizer que EXISTE um compromisso ali.
      const janela = eventoUsaBufferReuniao(ev)
        ? janelaComBufferReuniao(inicio, fim, bufferReuniaoMin)
        : { inicio, fim }
      return {
        inicio,
        fim,
        folgaInicio: janela.inicio,
        folgaFim: janela.fim,
        motivo: motivoDoEvento(ev),
        titulo: ev.titulo || null,
      }
    })
    .filter((ev) => !Number.isNaN(ev.inicio.getTime()) && !Number.isNaN(ev.fim.getTime()))

  return candidatos.map((horario) => {
    const inicio = paraInstante(data, horario)
    const fim = new Date(inicio.getTime() + ms)

    // Horario que ja passou nao e' oferta: marcar reuniao no passado nao existe como intencao.
    // Vem antes da ocupacao porque e' a explicacao mais util — "ja passou" encerra a duvida.
    if (agora && inicio <= agora) {
      return { horario, livre: false, motivo: MOTIVO.PASSADO, titulo: null, referencia: null }
    }

    // Entre varios eventos sobrepostos, o BLOQUEIO e' o que a tela mostra (ver motivoDoEvento).
    let escolhido = null
    for (const ev of normalizados) {
      if (!sobrepoe(inicio, fim, ev.inicio, ev.fim)) continue
      if (!escolhido || (ev.motivo === MOTIVO.BLOQUEIO && escolhido.motivo !== MOTIVO.BLOQUEIO)) {
        escolhido = ev
      }
    }
    if (escolhido) {
      return { horario, livre: false, motivo: escolhido.motivo, titulo: escolhido.titulo, referencia: null }
    }

    // Nenhum compromisso ocupa o horario — mas ele pode estar dentro da FOLGA de uma reuniao.
    // Testado DEPOIS da ocupacao real de proposito: ocupacao de verdade e' a explicacao mais forte.
    const naFolga = normalizados.find((ev) => sobrepoe(inicio, fim, ev.folgaInicio, ev.folgaFim))
    if (naFolga) {
      return {
        horario,
        livre: false,
        motivo: MOTIVO.PREPARO,
        titulo: naFolga.titulo,
        referencia: formatarHora ? formatarHora(naFolga.inicio) : null,
      }
    }
    return { horario, livre: true, motivo: null, titulo: null, referencia: null }
  })
}

// ─── RECORRENCIA ─────────────────────────────────────────────────────────────────────────
// Tipos aceitos. `nenhuma` esta na lista de proposito: e' o valor que a tela manda quando o
// operador nao quer repetir, e recusa-lo obrigaria a tela a omitir o campo.
const RECORRENCIA = Object.freeze({
  NENHUMA: 'nenhuma',
  DIARIA: 'diaria',
  SEMANAL: 'semanal',
})
const RECORRENCIAS_VALIDAS = Object.freeze([RECORRENCIA.NENHUMA, RECORRENCIA.DIARIA, RECORRENCIA.SEMANAL])

// Teto de ocorrencias por pedido. Existe para um erro de digitacao ("repetir ate 2030") nao virar
// milhares de linhas — em duas tabelas, porque cada bloqueio tambem espelha.
const MAX_OCORRENCIAS = 180

/**
 * Expande um bloqueio recorrente nas datas concretas em que ele acontece.
 *
 * Gera DATAS (AAAA-MM-DD), nao instantes: a hora do bloqueio e' a mesma em todos os dias, e
 * somar 24h em UTC atravessaria o horario de verao errado. Quem converte dia+hora em instante
 * e' o chamador, no fuso da empresa — o mesmo criterio de `marcarDisponibilidade`.
 *
 * @param {object} p
 * @param {string} p.dataInicial AAAA-MM-DD
 * @param {string} p.tipo        nenhuma | diaria | semanal
 * @param {string} p.ate         AAAA-MM-DD (inclusivo). Obrigatorio quando ha repeticao.
 * @param {number[]} p.diasSemana para `semanal`: 0=domingo..6=sabado. Vazio = o mesmo dia da semana
 *                               da data inicial.
 * @returns {{ok:boolean, datas?:string[], erro?:string}}
 */
function expandirRecorrencia({ dataInicial, tipo = RECORRENCIA.NENHUMA, ate = null, diasSemana = [] } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dataInicial || ''))) {
    return { ok: false, erro: 'data inicial invalida' }
  }
  if (!RECORRENCIAS_VALIDAS.includes(tipo)) return { ok: false, erro: 'recorrencia invalida' }
  if (tipo === RECORRENCIA.NENHUMA) return { ok: true, datas: [dataInicial] }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ate || ''))) {
    // Repeticao sem fim produziria bloqueio eterno, que so' se desfaz linha a linha.
    return { ok: false, erro: 'informe ate quando repetir' }
  }
  if (ate < dataInicial) return { ok: false, erro: 'a data final e anterior a inicial' }

  // Meio-dia UTC: o passo e' de dias inteiros e comecar ao meio-dia mantem a aritmetica longe
  // das bordas de fuso, onde somar 24h pode cair no dia anterior ou seguinte.
  const cursor = new Date(`${dataInicial}T12:00:00.000Z`)
  const limite = new Date(`${ate}T12:00:00.000Z`)
  const semana = Array.isArray(diasSemana) && diasSemana.length
    ? diasSemana.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : [cursor.getUTCDay()]
  if (tipo === RECORRENCIA.SEMANAL && !semana.length) {
    return { ok: false, erro: 'escolha ao menos um dia da semana' }
  }

  const datas = []
  while (cursor <= limite && datas.length < MAX_OCORRENCIAS) {
    const iso = cursor.toISOString().slice(0, 10)
    if (tipo === RECORRENCIA.DIARIA || semana.includes(cursor.getUTCDay())) datas.push(iso)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  if (!datas.length) return { ok: false, erro: 'a repeticao nao gerou nenhuma data' }
  return { ok: true, datas, truncado: datas.length >= MAX_OCORRENCIAS }
}

module.exports = {
  GRADE_PADRAO,
  REUNIAO_BUFFER_MINUTOS,
  MOTIVO,
  RECORRENCIA,
  RECORRENCIAS_VALIDAS,
  MAX_OCORRENCIAS,
  gerarGrade,
  marcarDisponibilidade,
  janelaComBufferReuniao,
  expandirRecorrencia,
  minutosDeHora,
  horaDeMinutos,
}
