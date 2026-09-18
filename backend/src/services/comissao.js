'use strict'
// Regra de COMISSAO do comercial (SDR).
//
// Este modulo e' PURO: sem banco, HTTP, IA ou rede. Ele nao sabe quanto alguem vendeu — recebe
// os numeros e devolve o veredito.
//
// A pergunta que ele responde NAO e' "quanto o SDR ganhou?", e sim duas perguntas distintas que
// e' facil confundir:
//
//   1. `nivelAtual(acumulado)`  — "que faixa ele JA desbloqueou?" (o painel, o que falta)
//   2. `percentualDaVenda(...)` — "com que percentual ESTA venda entra?" (o credito, congelado)
//
// Elas dao respostas DIFERENTES para o mesmo SDR no mesmo instante, e isso e' a regra que o
// operador escolheu: *"a taxa alcancada vale para as PROXIMAS vendas daquele mes, sem recalcular
// para tras"*. Um SDR com R$ 4.000 acumulados fecha uma venda de R$ 3.000: a venda entra a 10%
// (a faixa que ele tinha) e o painel passa a mostrar 12% (a faixa que ele acabou de desbloquear).
// Tratar as duas como a mesma pergunta produziria, dependendo do lado escolhido, ou comissao paga
// a maior sobre venda ja creditada, ou um painel que promete uma faixa que nao vale.
//
// Ver docs/ai-decision-log.md (2026-09-18) e a migration 083_comissao_sdr.sql.

// ─── Vocabulario ─────────────────────────────────────────────────────────────────────

// Em qual pagamento a comissao integral fica liberada. UM valor so, e a CHECK do banco espelha
// esta lista: o valor nasce JUNTO do executor (licao da migration 067, canal de e-mail).
const GATILHO = Object.freeze({
  PRIMEIRO_PAGAMENTO: 'primeiro_pagamento',
})

const VENDA_STATUS = Object.freeze({
  AGUARDANDO_PAGAMENTO: 'aguardando_pagamento',
  COMISSAO_LIBERADA: 'comissao_liberada',
  COMISSAO_PAGA: 'comissao_paga',
  CANCELADA: 'cancelada',
})

// De onde saiu o originador da venda. `sem_originador` e a AUSENCIA DE PROVA, NOMEADA — o mesmo
// vocabulario de `legado` (071) e `origem_vinculo` (061). Venda sem SDR e legitima: o operador
// tambem vende, e marcar essas como se fossem de alguem inflaria a comissao de quem nao originou.
const ORIGINADOR_ORIGEM = Object.freeze({
  HISTORICO_LEAD: 'historico_lead',
  OPERADOR: 'operador',
  SEM_ORIGINADOR: 'sem_originador',
})

const MOTIVO = Object.freeze({
  SEM_PLANO: 'sem_plano_ativo',
  SEM_ORIGINADOR: 'sem_originador',
  JA_CREDITADA: 'ja_creditada',
  CANCELADA: 'venda_cancelada',
})

// ─── Faixas ──────────────────────────────────────────────────────────────────────────

function dinheiro(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  // Duas casas, sempre. Comissao e' dinheiro: meio centavo acumulado vira divergencia com o
  // extrato, e divergencia com o extrato e exatamente o que este modulo existe para evitar.
  return Math.round(n * 100) / 100
}

function normalizarFaixas(faixas) {
  if (!Array.isArray(faixas)) return []
  return faixas
    .map((f) => ({
      min: dinheiro(f?.min),
      max: f?.max === null || f?.max === undefined ? null : dinheiro(f.max),
      percentual: Number(f?.percentual),
    }))
    .filter((f) => Number.isFinite(f.percentual) && f.percentual >= 0 && (f.max === null || f.max >= f.min))
    .sort((a, b) => a.min - b.min)
}

/**
 * A faixa em que um acumulado cai. Acumulado acima do teto da ultima faixa fica na ultima —
 * "R$ 15.000+" nao tem topo, e devolver `null` ali faria o painel dizer que o melhor mes da
 * operacao esta fora do plano.
 */
function faixaPara(acumulado, faixas) {
  const lista = normalizarFaixas(faixas)
  if (lista.length === 0) return null
  const v = dinheiro(acumulado)
  for (const f of lista) {
    if (v >= f.min && (f.max === null || v <= f.max)) return f
  }
  return v < lista[0].min ? lista[0] : lista[lista.length - 1]
}

/**
 * O que o painel do SDR mostra: a faixa JA desbloqueada e quanto falta para a proxima.
 * `proximo` e' `null` quando ele esta na ultima faixa — e ai a tela diz "faixa maxima", nunca
 * "faltam R$ 0", que pareceria um bug.
 */
function nivelAtual(acumulado, faixas) {
  const lista = normalizarFaixas(faixas)
  if (lista.length === 0) return null
  const v = dinheiro(acumulado)
  const atual = faixaPara(v, lista)
  const proxima = lista.find((f) => f.min > v) || null
  return {
    acumulado: v,
    percentual: atual.percentual,
    faixa_min: atual.min,
    faixa_max: atual.max,
    proximo: proxima
      ? { percentual: proxima.percentual, a_partir_de: proxima.min, falta: dinheiro(proxima.min - v) }
      : null,
  }
}

/**
 * O percentual com que UMA venda entra: o do acumulado ANTES dela.
 *
 * Isto e' o coracao da regra e o motivo de `comissao_percentual` ser uma coluna e nao um calculo:
 * o resultado depende da ORDEM dos creditos no mes. Recalculado na leitura, a comissao de uma
 * venda antiga MUDARIA quando outra venda fosse paga com atraso — o SDR veria o numero dele cair
 * sem ninguem ter feito nada, e a promessa de transparencia do programa morreria ali.
 */
function percentualDaVenda(acumuladoAntes, faixas) {
  const f = faixaPara(acumuladoAntes, faixas)
  return f ? f.percentual : null
}

/**
 * O credito completo de uma venda. Devolve TODOS os campos congelados juntos, porque a CHECK
 * `vendas_credito_completo_chk` exige que o credito exista inteiro ou nao exista: meio credito
 * (percentual sem valor) deixaria o painel mostrar um numero que ninguem consegue explicar.
 */
function calcularCredito({ valorVenda, acumuladoAntes = 0, plano } = {}) {
  const faixas = plano?.faixas_json || plano?.faixas
  const percentual = percentualDaVenda(acumuladoAntes, faixas)
  const base = dinheiro(valorVenda)
  if (percentual === null || !(base > 0)) return null
  return {
    plano_id: plano.id,
    plano_slug: plano.slug,
    plano_versao: plano.versao,
    comissao_percentual: percentual,
    comissao_base: base,
    comissao_valor: dinheiro((base * percentual) / 100),
  }
}

// ─── Gatilho ─────────────────────────────────────────────────────────────────────────

/**
 * "Este pagamento libera a comissao?"
 *
 * Com `primeiro_pagamento`, a resposta e' sim no primeiro recebimento — o parcelamento do cliente
 * NAO reduz o percentual prometido ao SDR (decisao do operador, 2026-09-18). O risco declarado e
 * aceito: cliente que para na 2a parcela deixa a comissao ja liberada. E' coerente com o desenho
 * do programa, em que o risco do projeto e' da operacao e o SDR nao controla inadimplencia.
 */
function liberaComissao({ gatilho, totalPagoAntes = 0, valorPagamento = 0 } = {}) {
  if (gatilho !== GATILHO.PRIMEIRO_PAGAMENTO) return false
  return dinheiro(totalPagoAntes) <= 0 && dinheiro(valorPagamento) > 0
}

/** Primeiro dia do mes de competencia (a data ja vem no fuso da operacao). */
function competenciaDe(data) {
  const d = data instanceof Date ? data : new Date(data)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

// ─── Ranking ─────────────────────────────────────────────────────────────────────────

/**
 * O ranking do mes, por FATURAMENTO PAGO ORIGINADO — nunca por numero de reunioes.
 *
 * A escolha tem consequencia de comportamento: ranquear por volume de reuniao paga para marcar
 * reuniao ruim, que e' o oposto do que a operacao precisa. E tem consequencia de arquitetura:
 * `frontend/lib/equipe-painel.js` proibe placar POR ATIVIDADE (guarda de regressao), e essa
 * proibicao continua valendo e nao foi tocada. Resultado de negocio verificavel e' outra coisa
 * que vigilancia de esforco.
 *
 * Empate mantem a ordem estavel por nome, para a tela nao trocar as posicoes a cada recarga.
 */
function montarRanking(linhas) {
  return (Array.isArray(linhas) ? linhas : [])
    .map((l) => ({
      usuario_id: l.usuario_id || null,
      nome: l.nome || null,
      originado: dinheiro(l.originado),
      vendas: Number(l.vendas) || 0,
    }))
    .filter((l) => l.usuario_id && l.originado > 0)
    .sort((a, b) => (b.originado - a.originado) || String(a.nome || '').localeCompare(String(b.nome || '')))
    .map((l, i) => ({ ...l, posicao: i + 1 }))
}

// ─── Validacao de entrada ────────────────────────────────────────────────────────────

function validarPlano(body = {}) {
  const issues = []
  const faixas = normalizarFaixas(body.faixas)
  if (faixas.length === 0) issues.push('Informe ao menos uma faixa de comissao.')
  for (let i = 1; i < faixas.length; i += 1) {
    const anterior = faixas[i - 1]
    if (anterior.max === null) { issues.push('Só a última faixa pode ficar sem teto.'); break }
    // Buraco entre faixas deixaria um acumulado sem percentual definido. Sobreposicao daria dois
    // percentuais para o mesmo valor. Nos dois casos a resposta a "qual a minha faixa?" passaria
    // a depender da ordem de avaliacao, que e' exatamente o que nao pode acontecer com dinheiro.
    if (faixas[i].min <= anterior.max) issues.push('As faixas não podem se sobrepor.')
  }
  const gatilho = String(body.gatilho || GATILHO.PRIMEIRO_PAGAMENTO)
  if (!Object.values(GATILHO).includes(gatilho)) {
    issues.push('Gatilho de comissão não suportado.')
  }
  const nome = String(body.nome || '').trim().slice(0, 120)
  if (!nome) issues.push('Informe o nome do plano.')
  return { ok: issues.length === 0, issues, valor: { nome, faixas, gatilho } }
}

function validarVenda(body = {}) {
  const issues = []
  const valor = dinheiro(body.valor)
  if (!(valor > 0)) issues.push('O valor da venda deve ser maior que zero.')
  const moeda = String(body.moeda || 'BRL').toUpperCase()
  if (!/^[A-Z]{3}$/.test(moeda)) issues.push('Moeda inválida.')
  const telefone = String(body.telefone || '').replace(/\D+/g, '') || null
  if (telefone && (telefone.length < 8 || telefone.length > 15)) issues.push('Telefone inválido.')
  return {
    ok: issues.length === 0,
    issues,
    valor: {
      valor,
      moeda,
      telefone_digitos: telefone,
      descricao: String(body.descricao || '').trim().slice(0, 500) || null,
      prospect_id: body.prospect_id || null,
      agenda_evento_id: body.agenda_evento_id || null,
      originador_id: body.originador_id || null,
      fechada_em: body.fechada_em || null,
    },
  }
}

function validarPagamento(body = {}) {
  const issues = []
  const valor = dinheiro(body.valor)
  if (!(valor > 0)) issues.push('O valor recebido deve ser maior que zero.')
  const recebidoEm = String(body.recebido_em || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recebidoEm)) issues.push('Informe a data do recebimento (AAAA-MM-DD).')
  return {
    ok: issues.length === 0,
    issues,
    valor: {
      valor,
      recebido_em: recebidoEm,
      moeda: String(body.moeda || 'BRL').toUpperCase(),
      metodo: String(body.metodo || '').trim().slice(0, 60) || null,
      referencia: String(body.referencia || '').trim().slice(0, 120) || null,
      observacao: String(body.observacao || '').trim().slice(0, 500) || null,
    },
  }
}

module.exports = {
  GATILHO,
  VENDA_STATUS,
  ORIGINADOR_ORIGEM,
  MOTIVO,
  dinheiro,
  normalizarFaixas,
  faixaPara,
  nivelAtual,
  percentualDaVenda,
  calcularCredito,
  liberaComissao,
  competenciaDe,
  montarRanking,
  validarPlano,
  validarVenda,
  validarPagamento,
}
