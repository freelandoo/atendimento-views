'use strict'
// QUADRO DO DIA — APRESENTAÇÃO PURA das colunas, dos cards e do que cada movimento significa.
//
// Quem decide se um movimento vale é o BACKEND (`services/plano-dia.js` + a rota): a entrada em
// "Feito hoje" exige evidência, e é o servidor que procura a atividade registrada. Aqui só se
// traduz o veredito e se diz, ANTES do arraste, o que a coluna vai cobrar — mesmo contrato de
// `lib/site-rotulos.js` e `lib/lead-fila-trabalho.js`.
//
// ⚠️ A REGRA QUE GOVERNA O MÓDULO: a etapa do dia NÃO é o ciclo comercial. "Feito hoje" não é
// venda fechada, "Aguardando retorno" não é lead frio e tirar um card do dia não descarta o
// lead. Os rótulos existem para que ninguém leia o quadro como se fosse o funil.
//
// Sem React, sem rede, sem DOM: testável com `node --test`.

/** As colunas, na ordem do trabalho. Espelha `ETAPAS` do backend (anti-drift no teste). */
const COLUNAS = [
  {
    chave: 'para_hoje',
    titulo: 'Para hoje',
    resumo: 'Leads que você escolheu trabalhar nesta data.',
    // O que o movimento NÃO faz. Está aqui porque é a dúvida real de quem arrasta um card pela
    // primeira vez num CRM: "isso muda alguma coisa para o cliente?".
    consequencia: 'Só planejamento — não assume lead de ninguém e não envia nada.',
    tom: 'neutro',
  },
  {
    chave: 'em_trabalho',
    titulo: 'Em trabalho',
    resumo: 'A próxima ação está sendo preparada ou executada.',
    consequencia: 'Só organização — nada é enviado e o funil do lead não muda.',
    tom: 'info',
  },
  {
    chave: 'aguardando_retorno',
    titulo: 'Aguardando retorno',
    resumo: 'A ação aconteceu e ficou algo para acompanhar.',
    consequencia: 'Para virar compromisso de verdade, registre o follow-up pelo fluxo oficial.',
    tom: 'warn',
  },
  {
    chave: 'feito',
    titulo: 'Feito hoje',
    resumo: 'A ação planejada para este lead foi registrada.',
    consequencia: 'Não significa venda fechada, e não descarta nem fecha o lead.',
    tom: 'ok',
  },
]

const CHAVES = COLUNAS.map((c) => c.chave)
const MS_DIA = 86400000
const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab']

function coluna(chave) {
  return COLUNAS.find((c) => c.chave === chave) || null
}

function dataDoDia(dia) {
  const v = String(dia || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(`${v}T12:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10) === v ? d : null
}

function formatarDiaISO(data) {
  return data.toISOString().slice(0, 10)
}

function formatarDataCurta(dia) {
  const partes = String(dia || '').split('-')
  if (partes.length !== 3) return ''
  return `${partes[2]}/${partes[1]}`
}

function somarDias(dia, quantidade) {
  const d = dataDoDia(dia)
  if (!d) return ''
  d.setUTCDate(d.getUTCDate() + Number(quantidade || 0))
  return formatarDiaISO(d)
}

/** Dias da semana operacional, sempre de segunda a domingo. */
function diasDaSemana(dia) {
  const base = dataDoDia(dia)
  if (!base) return []
  const diaSemana = base.getUTCDay()
  const voltaParaSegunda = diaSemana === 0 ? -6 : 1 - diaSemana
  const inicio = new Date(base.getTime() + voltaParaSegunda * MS_DIA)
  return Array.from({ length: 7 }, (_, i) => formatarDiaISO(new Date(inicio.getTime() + i * MS_DIA)))
}

function rotuloDiaCurto(dia, hoje) {
  if (!dia) return ''
  if (dia === hoje) return 'Hoje'
  if (hoje && dia === somarDias(hoje, -1)) return 'Ontem'
  if (hoje && dia === somarDias(hoje, 1)) return 'Amanhã'
  const d = dataDoDia(dia)
  if (!d) return ''
  return `${DIAS_CURTOS[d.getUTCDay()]} ${formatarDataCurta(dia)}`
}

function rotuloSemana(dias) {
  const lista = Array.isArray(dias) ? dias.filter(Boolean) : []
  if (!lista.length) return ''
  return `Semana de ${formatarDataCurta(lista[0])} a ${formatarDataCurta(lista[lista.length - 1])}`
}

/**
 * Normaliza o resumo da faixa. Dia sem linha no banco vira contagem zero, para a tela poder
 * manter a semana estável e não "sumir" botão quando não há cards.
 */
function resumoDoPeriodo(linhas, dias) {
  const porDia = new Map()
  for (const linha of Array.isArray(linhas) ? linhas : []) {
    if (linha && linha.dia) porDia.set(linha.dia, linha)
  }
  return (Array.isArray(dias) ? dias : []).map((dia) => {
    const linha = porDia.get(dia) || {}
    const total = Number(linha.total || 0)
    const feitos = Number(linha.feitos || 0)
    const abertos = Number(linha.abertos || Math.max(0, total - feitos))
    return {
      dia,
      total,
      feitos,
      abertos,
      para_hoje: Number(linha.para_hoje || 0),
      em_trabalho: Number(linha.em_trabalho || 0),
      aguardando_retorno: Number(linha.aguardando_retorno || 0),
    }
  })
}

/** Distribui os cards nas colunas, preservando a ordem que o servidor mandou. */
function montarColunas(itens) {
  const lista = Array.isArray(itens) ? itens : []
  return COLUNAS.map((c) => ({
    ...c,
    cards: lista.filter((i) => i && i.etapa === c.chave),
  }))
}

/**
 * O que a coluna de destino vai COBRAR, dito antes do arraste.
 *
 * `exigeEvidencia` é só um aviso da tela: quem verifica é o servidor, que procura a atividade
 * registrada e devolve 422 quando não há nem atividade nem nota. Repetir a checagem aqui criaria
 * uma segunda régua, mais frouxa — e seria ela que o operador acreditaria.
 */
function aoMoverPara(chave) {
  const c = coluna(chave)
  if (!c) return { ok: false, motivo: 'Coluna desconhecida.', exigeEvidencia: false }
  return {
    ok: true,
    motivo: '',
    titulo: c.titulo,
    consequencia: c.consequencia,
    exigeEvidencia: chave === 'feito',
  }
}

/**
 * Como um card concluído é LIDO. Autodeclaração nunca aparece como evidência — mesma disciplina
 * da abordagem manual (`wa.me`), onde abrir o link não prova que a mensagem saiu.
 */
function seloConclusao(item) {
  const tipo = item && item.conclusao_tipo
  if (tipo === 'atividade_registrada') {
    return { rotulo: 'Ação registrada', dica: 'O sistema encontrou ligação, reunião ou abordagem registrada hoje.', prova: true, classe: 'border-emerald-200 bg-emerald-50 text-emerald-800' }
  }
  if (tipo === 'autodeclarada') {
    return { rotulo: 'Autodeclarado', dica: 'Sem registro automático: o que consta é o que você escreveu.', prova: false, classe: 'border-amber-200 bg-amber-50 text-amber-800' }
  }
  return null
}

/** Por onde o lead entrou no dia. `escolha_manual` não vira selo: é o caso normal. */
function seloOrigemEntrada(origem) {
  if (origem === 'sugestao_vencidos') return { rotulo: 'Retorno vencido', dica: 'Sugerido: há follow-up seu com prazo vencido.' }
  if (origem === 'sugestao_agenda') return { rotulo: 'Compromisso hoje', dica: 'Sugerido: há compromisso seu na agenda de hoje.' }
  return null
}

/** Horário do card, quando existir. Sem agendamento não se inventa prazo. */
function horarioDoCard(item, formatar) {
  const quando = item && item.proximo_agendamento
  if (!quando) return ''
  return typeof formatar === 'function' ? formatar(quando) : String(quando)
}

/** O resumo do dia. Conta CARDS, nunca mistura com contagem de carteira ou de funil. */
function resumoDoDia(itens) {
  const lista = Array.isArray(itens) ? itens : []
  const porColuna = {}
  for (const c of CHAVES) porColuna[c] = 0
  for (const i of lista) if (porColuna[i?.etapa] !== undefined) porColuna[i.etapa] += 1
  const total = lista.length
  const feitos = porColuna.feito
  return {
    total,
    porColuna,
    // "3 de 8" é a única frase honesta: o quadro mede o plano do dia, não a carteira.
    texto: total === 0
      ? 'Nenhum lead no plano de hoje.'
      : `${feitos} de ${total} ${total === 1 ? 'lead trabalhado' : 'leads trabalhados'} hoje.`,
  }
}

/**
 * O aviso das pendências de dias anteriores. **Nunca move nada**: devolve o texto da prévia, e
 * o replanejamento continua sendo um clique do operador. Pendência não some à meia-noite.
 */
function avisoPendentes(pendentes) {
  const n = Array.isArray(pendentes) ? pendentes.length : 0
  if (!n) return null
  return {
    total: n,
    texto: `${n} ${n === 1 ? 'lead ficou' : 'leads ficaram'} em aberto em dias anteriores.`,
    acao: n === 1 ? 'Trazer para hoje' : `Trazer os ${n} para hoje`,
  }
}

/** Rótulo do dia exibido. Hoje é dito por extenso; outro dia mostra a data. */
function rotuloDia(dia, hoje) {
  if (!dia) return ''
  if (dia === hoje) return 'Hoje'
  const [a, m, d] = String(dia).split('-')
  return `${d}/${m}/${a}`
}

module.exports = {
  COLUNAS, CHAVES, coluna, montarColunas, aoMoverPara,
  seloConclusao, seloOrigemEntrada, horarioDoCard, resumoDoDia, avisoPendentes, rotuloDia,
  somarDias, diasDaSemana, rotuloDiaCurto, rotuloSemana, resumoDoPeriodo,
}
