// Vocabulario de APRESENTACAO da grade de horarios e do bloqueio de agenda.
//
// Este modulo SO TRADUZ o veredito que a API ja resolveu — mesmo contrato de `lib/site-rotulos.js`
// e `lib/capacidades.js`. Ele nao decide se um horario esta livre, nao sabe o que e' conflito e
// nao conhece a agenda do bot. Regra de negocio no front quebra em silencio: o dia que o backend
// mudasse o criterio, a tela continuaria desenhando o criterio antigo sem ninguem perceber.

/** Motivos que a API devolve para um slot indisponivel. Lista FECHADA (espelha services/agenda-slots.js). */
const MOTIVO = Object.freeze({
  BLOQUEIO: 'bloqueio',
  COMPROMISSO: 'compromisso',
  AGENDA_BOT: 'agenda_bot',
  PASSADO: 'passado',
  PREPARO: 'preparo',
})

// Cor NUNCA e' o unico sinal (regra do guia visual, ja cumprida por BolinhaPontuacao e
// AlternadorModoIa): todo motivo carrega rotulo em texto, e e' o rotulo que vai para o
// `aria-label` e para o title.
const ROTULOS = Object.freeze({
  [MOTIVO.BLOQUEIO]: { curto: 'Bloqueado', descricao: 'Horário bloqueado' },
  [MOTIVO.COMPROMISSO]: { curto: 'Ocupado', descricao: 'Já há um compromisso' },
  [MOTIVO.AGENDA_BOT]: { curto: 'Ocupado', descricao: 'Reunião marcada pelo WhatsApp' },
  [MOTIVO.PASSADO]: { curto: 'Passou', descricao: 'Este horário já passou' },
  // O horário está VAZIO: o que o ocupa é a folga de uma reunião vizinha. Dizer "já há um
  // compromisso" aqui afirmaria um compromisso que não existe neste horário.
  [MOTIVO.PREPARO]: { curto: 'Preparo', descricao: 'Reservado para o preparo da reunião' },
})

const CLASSES = Object.freeze({
  livre: 'border-line bg-surface text-ink hover:border-brand hover:bg-brand/5',
  // Indisponivel NAO usa vermelho: nao e' erro nem perigo, e' so' um horario que nao esta
  // disponivel. Vermelho aqui faria uma agenda cheia parecer uma tela cheia de falhas.
  ocupado: 'border-line bg-surface-2 text-ink-3 cursor-not-allowed',
  bloqueado: 'border-estado-warn/40 bg-estado-warn/10 text-ink-2 cursor-not-allowed',
  selecionado: 'border-brand bg-brand text-white',
})

/**
 * Como desenhar um slot. Nao decide disponibilidade — le a que a API mandou.
 * @param {{horario:string, livre:boolean, motivo:string|null, titulo:string|null}} slot
 * @param {boolean} selecionado
 */
function aparenciaDoSlot(slot, selecionado = false) {
  if (!slot) return { classe: CLASSES.ocupado, rotulo: '', descricao: '', clicavel: false }
  if (selecionado) {
    return { classe: CLASSES.selecionado, rotulo: 'Selecionado', descricao: `${slot.horario} selecionado`, clicavel: true }
  }
  if (slot.livre) {
    return { classe: CLASSES.livre, rotulo: 'Livre', descricao: `${slot.horario} — disponível`, clicavel: true }
  }
  const info = ROTULOS[slot.motivo] || { curto: 'Indisponível', descricao: 'Indisponível' }
  // A folga so' se explica junto da reuniao que a criou: sem o horario, "preparo da reuniao" nao
  // diz de qual. `referencia` vem pronta do backend (o fuso e' dele), a tela nao calcula hora.
  const base = slot.motivo === MOTIVO.PREPARO && slot.referencia
    ? `${info.descricao} das ${slot.referencia}`
    : info.descricao
  // O titulo do evento explica o sumico melhor que o motivo generico ("Feriado" > "Bloqueado").
  const detalhe = slot.titulo ? `${base}: ${slot.titulo}` : base
  return {
    classe: slot.motivo === MOTIVO.BLOQUEIO ? CLASSES.bloqueado : CLASSES.ocupado,
    rotulo: info.curto,
    descricao: `${slot.horario} — ${detalhe}`,
    clicavel: false,
  }
}

/**
 * Frase do dia na lista. Distingue os tres estados que pedem acoes diferentes:
 * dia util com vaga, dia lotado, e dia que ja passou inteiro.
 */
function resumoDoDia(dia) {
  if (!dia || !Array.isArray(dia.horarios)) return { texto: 'Sem informação', vazio: true }
  const livres = dia.horarios.filter((h) => h.livre).length
  if (livres > 0) return { texto: `${livres} ${livres === 1 ? 'horário livre' : 'horários livres'}`, vazio: false }
  const soPassado = dia.horarios.every((h) => h.motivo === MOTIVO.PASSADO)
  if (soPassado) return { texto: 'Dia encerrado', vazio: true }
  const temBloqueio = dia.horarios.some((h) => h.motivo === MOTIVO.BLOQUEIO)
  return { texto: temBloqueio ? 'Agenda bloqueada' : 'Sem horários livres', vazio: true }
}

/** Nome do dia da semana + data, para o cabecalho de cada coluna. */
function rotuloDoDia(dataIso, hojeIso) {
  if (!dataIso) return { titulo: '', subtitulo: '' }
  const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
  const d = new Date(`${dataIso}T12:00:00.000Z`)
  const subtitulo = `${dataIso.slice(8, 10)}/${dataIso.slice(5, 7)}`
  if (hojeIso && dataIso === hojeIso) return { titulo: 'Hoje', subtitulo }
  return { titulo: DIAS[d.getUTCDay()], subtitulo }
}

// ─── Bloqueio ────────────────────────────────────────────────────────────────────────────

const RECORRENCIA = Object.freeze({ NENHUMA: 'nenhuma', DIARIA: 'diaria', SEMANAL: 'semanal' })

const OPCOES_RECORRENCIA = Object.freeze([
  { valor: RECORRENCIA.NENHUMA, rotulo: 'Só neste dia' },
  { valor: RECORRENCIA.DIARIA, rotulo: 'Todos os dias' },
  { valor: RECORRENCIA.SEMANAL, rotulo: 'Toda semana' },
])

const DIAS_SEMANA = Object.freeze([
  { valor: 0, curto: 'D', nome: 'Domingo' },
  { valor: 1, curto: 'S', nome: 'Segunda' },
  { valor: 2, curto: 'T', nome: 'Terça' },
  { valor: 3, curto: 'Q', nome: 'Quarta' },
  { valor: 4, curto: 'Q', nome: 'Quinta' },
  { valor: 5, curto: 'S', nome: 'Sexta' },
  { valor: 6, curto: 'S', nome: 'Sábado' },
])

// Atalhos para os tres casos que motivaram a feature. Nao sao regra — preenchem o formulario,
// que continua editavel.
const MODELOS_BLOQUEIO = Object.freeze([
  { id: 'almoco', rotulo: 'Intervalo de almoço', titulo: 'Almoço', hora_inicio: '12:00', hora_fim: '13:00', recorrencia: RECORRENCIA.DIARIA },
  { id: 'feriado', rotulo: 'Feriado / dia inteiro', titulo: 'Feriado', hora_inicio: '00:00', hora_fim: '23:59', recorrencia: RECORRENCIA.NENHUMA },
  { id: 'interna', rotulo: 'Reunião interna', titulo: 'Reunião interna', hora_inicio: '09:00', hora_fim: '10:00', recorrencia: RECORRENCIA.SEMANAL },
])

/**
 * O que impede de salvar o bloqueio. Devolve a mensagem ou '' quando esta pronto.
 *
 * NAO e' a validacao de verdade — quem tem o banco na mao e' o backend, e validar aqui criaria
 * uma segunda regua mais frouxa. Isto so' evita uma ida ao servidor para dizer o obvio.
 */
function impedimentoDoBloqueio(form) {
  if (!form) return 'Preencha o formulário.'
  if (!form.data) return 'Escolha a data.'
  if (!form.hora_inicio || !form.hora_fim) return 'Informe o horário.'
  if (form.hora_fim <= form.hora_inicio) return 'A hora final precisa ser maior que a inicial.'
  if (form.recorrencia !== RECORRENCIA.NENHUMA && !form.repetir_ate) return 'Informe até quando repetir.'
  if (form.recorrencia !== RECORRENCIA.NENHUMA && form.repetir_ate < form.data) {
    return 'A data final da repetição é anterior à inicial.'
  }
  if (form.recorrencia === RECORRENCIA.SEMANAL && (!form.dias_semana || !form.dias_semana.length)) {
    return 'Escolha ao menos um dia da semana.'
  }
  return ''
}

/**
 * Traduz o resultado do POST /bloqueios. Tres informacoes que a tela precisa dizer
 * separadamente, porque pedem reacoes diferentes:
 *   - quantos dias foram bloqueados;
 *   - se algum dia ficou de fora (e por que);
 *   - se o bloqueio vale para o BOT do WhatsApp.
 *
 * O ultimo ponto nao e' detalhe: `vale_para_bot: false` significa que o horario continua sendo
 * OFERECIDO ao cliente no WhatsApp. Fingir sucesso total ali deixaria a pessoa achar que
 * bloqueou quando nao bloqueou — o defeito que esta entrega existe para corrigir.
 */
function resumoDoBloqueio(resposta) {
  if (!resposta) return { texto: '', alerta: '' }
  const n = resposta.criados || 0
  const texto = n === 1 ? 'Horário bloqueado.' : `${n} dias bloqueados.`
  const partes = []
  if (Array.isArray(resposta.falhas) && resposta.falhas.length) {
    const d = resposta.falhas.length
    partes.push(`${d} ${d === 1 ? 'dia ficou' : 'dias ficaram'} de fora por conflito.`)
  }
  if (resposta.truncado) partes.push('A repetição foi limitada; refaça para cobrir o resto.')
  if (resposta.vale_para_bot === false) {
    partes.push('Atenção: este bloqueio vale na tela, mas o atendimento pelo WhatsApp ainda pode oferecer o horário.')
  }
  return { texto, alerta: partes.join(' ') }
}

module.exports = {
  MOTIVO,
  RECORRENCIA,
  OPCOES_RECORRENCIA,
  DIAS_SEMANA,
  MODELOS_BLOQUEIO,
  aparenciaDoSlot,
  resumoDoDia,
  rotuloDoDia,
  impedimentoDoBloqueio,
  resumoDoBloqueio,
}
