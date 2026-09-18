'use strict'
// Apresentacao da COMISSAO do comercial.
//
// Este modulo so' TRADUZ o veredito que a API ja resolveu — o mesmo contrato de
// `lib/site-rotulos.js` e `lib/capacidades.js`. A regra (faixas, percentual congelado, gatilho,
// competencia) vive em `backend/src/services/comissao.js`. Duas reguas divergiriam, e a tela
// passaria a explicar uma comissao diferente da que foi paga.
//
// Ha guarda de regressao em `lib/comissao.test.js` que falha se este arquivo passar a calcular
// faixa, percentual ou comissao.

const STATUS_VENDA = {
  aguardando_pagamento: {
    rotulo: 'Aguardando pagamento',
    // O texto diz a CONSEQUENCIA, nao so' o estado: e' o que o operador precisa saber para agir.
    ajuda: 'A comissão ainda não conta — ela é liberada quando o cliente paga.',
    tom: 'espera',
  },
  comissao_liberada: {
    rotulo: 'Comissão liberada',
    ajuda: 'O cliente pagou. A comissão entrou no mês e está na fila do próximo pagamento.',
    tom: 'positivo',
  },
  comissao_paga: {
    rotulo: 'Comissão paga',
    ajuda: 'Comissão já repassada ao responsável.',
    tom: 'concluido',
  },
  cancelada: {
    rotulo: 'Cancelada',
    ajuda: 'Venda cancelada antes de qualquer pagamento.',
    tom: 'neutro',
  },
}

const ORIGEM_ORIGINADOR = {
  historico_lead: 'Originado pelo histórico do lead',
  operador: 'Originador informado manualmente',
  // Ausencia de prova, NOMEADA — nao e' erro nem pendencia: o operador tambem vende.
  sem_originador: 'Venda sem originador',
}

const MOEDA_PADRAO = 'BRL'

function formatarDinheiro(valor, moeda = MOEDA_PADRAO) {
  // `null`/`undefined`/'' NAO sao zero, e a diferenca importa: comissao ainda nao creditada
  // exibida como "R$ 0,00" diria ao SDR que ele ganhou zero, quando o certo e "ainda nao".
  // `Number(null)` e' 0 e passaria por `isFinite` — por isso a checagem vem antes.
  if (valor === null || valor === undefined || valor === '') return '—'
  const n = Number(valor)
  if (!Number.isFinite(n)) return '—'
  try {
    return n.toLocaleString('pt-BR', { style: 'currency', currency: moeda || MOEDA_PADRAO })
  } catch {
    return `R$ ${n.toFixed(2)}`
  }
}

function formatarPercentual(p) {
  const n = Number(p)
  return Number.isFinite(n) ? `${n.toString().replace('.', ',')}%` : '—'
}

function rotuloStatus(status) {
  return STATUS_VENDA[status] || { rotulo: status || '—', ajuda: '', tom: 'neutro' }
}

function rotuloCompetencia(competencia) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(competencia || ''))) return '—'
  const [ano, mes] = String(competencia).split('-')
  const nomes = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
  return `${nomes[Number(mes) - 1] || mes} de ${ano}`
}

/**
 * O cabecalho do painel do SDR. Nao calcula nada: le `nivel`, que o backend ja resolveu.
 *
 * Sem plano ativo NAO se inventa faixa — a tela diz que o programa nao esta configurado. Mostrar
 * "0%" afirmaria uma regra que ninguem combinou.
 */
function resumoDoNivel(painel) {
  if (!painel?.plano) {
    return {
      configurado: false,
      titulo: 'Programa de comissão não configurado',
      detalhe: 'Nenhum plano de comissão está ativo nesta empresa.',
      progresso: null,
    }
  }
  const nivel = painel.nivel
  if (!nivel) {
    return { configurado: true, titulo: 'Sem vendas creditadas no mês', detalhe: '', progresso: null }
  }
  const base = `Seu nível atual: ${formatarPercentual(nivel.percentual)}`
  if (!nivel.proximo) {
    return {
      configurado: true,
      titulo: base,
      detalhe: 'Você está na faixa máxima do plano.',
      progresso: { percentual: 100, falta: 0, proximo: null },
    }
  }
  return {
    configurado: true,
    titulo: base,
    detalhe: `Faltam ${formatarDinheiro(nivel.proximo.falta)} para desbloquear ${formatarPercentual(nivel.proximo.percentual)}.`,
    progresso: {
      // Progresso DENTRO da faixa atual. O denominador e a distancia entre o piso da faixa e o
      // proximo degrau — uma barra sobre o total do mes nao diria nada sobre o que falta.
      percentual: barraDaFaixa(nivel),
      falta: nivel.proximo.falta,
      proximo: nivel.proximo.percentual,
    },
  }
}

function barraDaFaixa(nivel) {
  const piso = Number(nivel.faixa_min) || 0
  const teto = Number(nivel.proximo?.a_partir_de)
  const atual = Number(nivel.acumulado) || 0
  if (!Number.isFinite(teto) || teto <= piso) return 0
  const pct = ((atual - piso) / (teto - piso)) * 100
  return Math.max(0, Math.min(100, Math.round(pct)))
}

/**
 * As 3 primeiras posicoes ganham medalha; da 4a em diante, so' o numero.
 * O ranking NUNCA traz a comissao de ninguem — ele mede resultado da operacao, nao contracheque
 * alheio (decisao D4, 2026-09-18). Se um dia `comissao` aparecer no payload, ele nao e lido aqui.
 */
function medalhaDaPosicao(posicao) {
  return { 1: '🥇', 2: '🥈', 3: '🥉' }[posicao] || null
}

function destacarVoce(ranking, usuarioId) {
  return (Array.isArray(ranking) ? ranking : []).map((l) => ({
    ...l,
    voce: Boolean(usuarioId) && l.usuario_id === usuarioId,
  }))
}

/**
 * Quais acoes cabem numa venda, dado o estado dela e quem esta olhando.
 * A tela nao decide: ela desenha o que este modulo autoriza.
 */
function acoesDaVenda(venda, podeGerenciar) {
  if (!venda || !podeGerenciar) return []
  const acoes = []
  if (venda.status === 'aguardando_pagamento') {
    acoes.push({ id: 'pagamento', rotulo: 'Registrar recebimento', tom: 'primario' })
    acoes.push({ id: 'cancelar', rotulo: 'Cancelar venda', tom: 'negativo' })
  }
  if (venda.status === 'comissao_liberada') {
    acoes.push({ id: 'pagamento', rotulo: 'Registrar recebimento', tom: 'neutro' })
    acoes.push({ id: 'pagar', rotulo: 'Marcar comissão como paga', tom: 'primario' })
  }
  if (venda.status === 'comissao_paga') {
    acoes.push({ id: 'pagamento', rotulo: 'Registrar recebimento', tom: 'neutro' })
  }
  return acoes
}

/**
 * Por que uma venda nao pode ser cancelada. A frase diz a RAZAO, nao "não permitido" — o
 * operador precisa entender que comissao liberada e' um fato registrado, nao um bloqueio de tela.
 */
function motivoNaoCancelavel(venda) {
  if (!venda) return null
  if (venda.status === 'aguardando_pagamento') return null
  if (venda.status === 'cancelada') return 'Esta venda já está cancelada.'
  return 'A comissão desta venda já foi liberada pelo pagamento do cliente — e comissão liberada é um fato registrado.'
}

module.exports = {
  STATUS_VENDA,
  ORIGEM_ORIGINADOR,
  formatarDinheiro,
  formatarPercentual,
  rotuloStatus,
  rotuloCompetencia,
  resumoDoNivel,
  medalhaDaPosicao,
  destacarVoce,
  acoesDaVenda,
  motivoNaoCancelavel,
}
