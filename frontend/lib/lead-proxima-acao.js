'use strict'
// "Próxima ação" da ficha do lead — APRESENTAÇÃO PURA.
//
// Quem decide O QUE vem primeiro é o backend (`backend/src/services/lead-proxima-acao.js`): ele
// junta follow-up em aberto, compromisso da agenda e última ligação, ordena por prazo e diz a
// situação de cada um (`atrasado | em_curso | futuro | sem_prazo`). Aqui só se traduz para texto —
// mesmo contrato de `lib/site-rotulos.js` e `lib/lead-origem.js`. A tela não compara datas para
// decidir atraso: a única conta local é "é hoje / amanhã?", que é só como ESCREVER a data.

const TZ = 'America/Sao_Paulo'

const ROTULO_CANAL = Object.freeze({
  whatsapp: 'WhatsApp',
  ligacao: 'ligação',
  email: 'e-mail',
})

const ROTULO_AGENDA = Object.freeze({
  reuniao: 'Reunião',
  retorno: 'Retorno na agenda',
  follow_up: 'Follow-up na agenda',
  tarefa: 'Tarefa na agenda',
})

const ROTULO_RESULTADO = Object.freeze({
  atendeu: 'Atendeu',
  nao_atendeu: 'Não atendeu',
  caixa_postal: 'Caixa postal',
  ocupado: 'Ocupado',
  numero_invalido: 'Número inválido',
  reagendou: 'Pediu para ligar depois',
})

// Cor é reforço: todo tom vem com `selo` em texto.
const TOM = Object.freeze({
  atrasado: { selo: 'Atrasado', classe: 'bg-red-50 text-red-700 border-red-200' },
  em_curso: { selo: 'Agora', classe: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  hoje: { selo: 'Hoje', classe: 'bg-amber-50 text-amber-800 border-amber-200' },
  futuro: { selo: '', classe: 'bg-surface-2 text-ink-2 border-line' },
  sem_prazo: { selo: 'Sem data', classe: 'bg-surface-2 text-ink-3 border-line' },
})

function diaLocal(d) {
  // YYYY-MM-DD no fuso da operação — só para comparar "mesmo dia".
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

function hora(d) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(d)
}

function diaCurto(d) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit' })
    .format(d).replace('.', '')
}

/** "Hoje, 14:30" · "Amanhã, 09:00" · "Ontem, 10:00" · "qua, 24/09, 14:30". Data ilegível → ''. */
function quandoEmTexto(iso, agora = new Date()) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const dia = diaLocal(d)
  const hoje = diaLocal(agora)
  const amanha = diaLocal(new Date(agora.getTime() + 86400000))
  const ontem = diaLocal(new Date(agora.getTime() - 86400000))
  const prefixo = dia === hoje ? 'Hoje' : dia === amanha ? 'Amanhã' : dia === ontem ? 'Ontem' : diaCurto(d)
  return `${prefixo}, ${hora(d)}`
}

function ehHoje(iso, agora) {
  if (!iso) return false
  const d = new Date(iso)
  return !Number.isNaN(d.getTime()) && diaLocal(d) === diaLocal(agora)
}

function rotuloTipo(c) {
  if (c.tipo === 'follow_up') {
    const canal = ROTULO_CANAL[c.canal]
    return canal ? `Follow-up por ${canal}` : 'Follow-up'
  }
  return ROTULO_AGENDA[c.tipo_agenda] || (c.tipo === 'reuniao' ? 'Reunião' : 'Compromisso na agenda')
}

/**
 * Um compromisso pronto para desenhar. A situação vem do servidor; "hoje" só refina o futuro.
 * @param {object} c item de `compromissos` da API
 * @param {Date} [agora]
 */
function cartaoCompromisso(c, agora = new Date()) {
  const situacao = c.situacao === 'futuro' && ehHoje(c.quando, agora) ? 'hoje' : (c.situacao || 'sem_prazo')
  const tom = TOM[situacao] || TOM.futuro
  const quando = quandoEmTexto(c.quando, agora)
  const detalhes = []
  if (c.responsavel_nome) detalhes.push(`Responsável: ${c.responsavel_nome}`)
  if (c.origem === 'bot') detalhes.push('Marcada pelo atendimento automático')
  return {
    chave: `${c.tipo}:${c.id}`,
    tipo: rotuloTipo(c),
    titulo: c.titulo || rotuloTipo(c),
    quando: quando || 'Sem data definida',
    situacao,
    selo: tom.selo,
    classe: tom.classe,
    observacao: c.observacao || '',
    detalhe: detalhes.join(' · '),
  }
}

/** "Não atendeu · Ontem, 10:00 · por Ana" — ou null quando nunca houve ligação encerrada. */
function resumoUltimaLigacao(l, agora = new Date()) {
  if (!l) return null
  const partes = [ROTULO_RESULTADO[l.resultado] || l.resultado || 'Ligação registrada']
  const quando = quandoEmTexto(l.quando, agora)
  if (quando) partes.push(quando)
  if (l.usuario_nome) partes.push(`por ${l.usuario_nome}`)
  return { texto: partes.join(' · '), notas: l.notas || '' }
}

module.exports = { quandoEmTexto, cartaoCompromisso, resumoUltimaLigacao, ROTULO_RESULTADO }
