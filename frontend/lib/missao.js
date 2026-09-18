'use strict'
// Missao da Operacao Comercial (Etapa 2) — APRESENTACAO PURA.
//
// Regra de ouro, a mesma de `lib/comissao.js` e `lib/capacidades.js`: **a regra vive no BACKEND;
// aqui so' se traduz o veredito.** Este modulo nao decide se a missao esta valendo, nao calcula
// progresso e nao sabe quem alcancou — recebe tudo pronto de `GET .../missoes`.
//
// ⚠️ ELE NUNCA COMPARA DUAS PESSOAS. Nao ha funcao de ordenar, pontuar ou posicionar gente: o
// progresso e' pessoal, e ordenar por resultado e' ranking, que e' outra etapa e outra decisao.
// Guarda de regressao no teste.
//
// `formatarDinheiro` e' REEXPORTADO de `lib/comissao.js`, nao reescrito — duas formatacoes de
// dinheiro divergiriam, e a missao e a comissao falam do MESMO dinheiro na mesma tela. Mesmo
// padrao de `paginacao.js` reexportado por `followups-fila.js`.

const { formatarDinheiro } = require('./comissao')

// ─── Situação ───────────────────────────────────────────────────────────────────────────
// O backend manda o slug; aqui ele vira frase. `prazo_vencido` NAO e' `encerrada`: a janela
// acabou e ninguem fechou — dizer "encerrada" faria a tela afirmar uma decisao que nao houve.

const SITUACAO = {
  agendada: {
    rotulo: 'Começa em breve',
    tom: 'neutro',
    explicacao: 'A missão já foi publicada, mas a janela dela ainda não começou.',
  },
  vigente: {
    rotulo: 'Valendo agora',
    tom: 'positivo',
    explicacao: 'A missão está em andamento.',
  },
  prazo_vencido: {
    rotulo: 'Prazo terminou',
    tom: 'espera',
    explicacao: 'A janela da missão acabou. Ela continua aberta até alguém encerrar ou publicar a próxima.',
  },
  encerrada: {
    rotulo: 'Encerrada',
    tom: 'concluido',
    explicacao: 'Esta missão foi encerrada.',
  },
}

const SITUACAO_PADRAO = { rotulo: '—', tom: 'neutro', explicacao: '' }

/** Situação em rótulo, tom e explicação. Slug desconhecido não some da tela nem inventa história. */
function rotuloSituacao(situacao) {
  return SITUACAO[situacao] || SITUACAO_PADRAO
}

// ─── Janela e recompensa ────────────────────────────────────────────────────────────────

function dataBR(iso) {
  const s = String(iso == null ? '' : iso).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—'
  const [a, m, d] = s.split('-')
  return `${d}/${m}/${a}`
}

/** "01/09/2026 a 30/09/2026". Janela de um dia só aparece como a data única. */
function janelaTexto(missao) {
  if (!missao) return '—'
  const i = dataBR(missao.inicio)
  const f = dataBR(missao.fim)
  return i === f ? i : `${i} a ${f}`
}

/**
 * A recompensa como frase.
 * Valor e descricao sao coisas diferentes: nem toda recompensa e' dinheiro, e quando e', o valor
 * nao substitui o que foi prometido — ele qualifica.
 */
function recompensaTexto(missao) {
  if (!missao) return '—'
  const desc = String(missao.recompensa_descricao || '').trim()
  const valor = missao.recompensa_valor
  if (valor === null || valor === undefined || valor === '') return desc || '—'
  const emDinheiro = formatarDinheiro(valor)
  return desc ? `${desc} (${emDinheiro})` : emDinheiro
}

// ─── O meu progresso ────────────────────────────────────────────────────────────────────

/**
 * O que dizer para a PRÓPRIA pessoa sobre o progresso dela.
 *
 * `larguraBarra` vem do backend como fração 0..1 e sai como string de CSS. Não se recalcula a
 * fração aqui: quem decide o que conta como progresso é a consulta que soma o faturamento pago.
 *
 * Alvo ilegível devolve estado próprio — a tela precisa poder dizer "missão sem alvo legível" em
 * vez de comemorar uma conquista que ninguém definiu.
 */
function resumoDoProgresso(progresso, situacao) {
  const p = progresso || {}
  const feito = formatarDinheiro(p.valor || 0)

  if (p.alvo === null || p.alvo === undefined) {
    return {
      alcancado: false,
      titulo: feito,
      frase: 'Esta missão está sem um alvo legível — fale com quem a publicou.',
      larguraBarra: '0%',
      tom: 'neutro',
    }
  }

  const largura = `${Math.round(Math.min(1, Math.max(0, Number(p.fracao) || 0)) * 100)}%`

  if (p.alcancado) {
    // Depois do prazo, "você alcançou" continua verdadeiro — a conquista é um fato da janela,
    // não do dia em que a pessoa abriu a tela.
    return {
      alcancado: true,
      titulo: feito,
      frase: 'Você alcançou o alvo desta missão.',
      larguraBarra: '100%',
      tom: 'positivo',
    }
  }

  const faltam = formatarDinheiro(p.faltam || 0)
  const frase = situacao === 'vigente' || situacao === 'agendada'
    ? `Faltam ${faltam} para alcançar a recompensa.`
    : `Faltaram ${faltam} para o alvo desta missão.`

  return { alcancado: false, titulo: feito, frase, larguraBarra: largura, tom: 'neutro' }
}

/**
 * O que o DONO vê: quem já alcançou. Nunca o progresso parcial de ninguém.
 * `lista` vazia e `lista` ausente são coisas diferentes — a segunda é "você não vê isto".
 */
function resumoDeQuemAlcancou(lista) {
  if (!Array.isArray(lista)) return null
  if (lista.length === 0) {
    return { total: 0, frase: 'Ninguém alcançou o alvo ainda.', itens: [] }
  }
  return {
    total: lista.length,
    frase: lista.length === 1 ? '1 pessoa alcançou o alvo.' : `${lista.length} pessoas alcançaram o alvo.`,
    // Quantas pessoas ainda não receberam — é o que resta FAZER, e por isso vem separado do
    // total: "3 alcançaram" e "3 alcançaram, 1 ainda não recebeu" pedem ações diferentes.
    pendentes: lista.filter((l) => !l.pago).length,
    // A ordem vem do servidor (alfabética, de propósito). Reordenar por valor aqui criaria o
    // placar que o backend evitou.
    itens: lista.map((l) => ({
      usuario_id: l.usuario_id,
      nome: l.nome || 'Sem nome',
      valor: formatarDinheiro(l.valor),
      // `pago` chega do backend já resolvido (`juntarBaixas`). `false` e não `null`: quem
      // alcançou sempre tem resposta para "já recebeu?".
      pago: !!l.pago,
      rotuloPagamento: l.pago
        ? (l.valor_pago === null || l.valor_pago === undefined
          ? 'Prêmio entregue'
          : `Prêmio entregue · ${formatarDinheiro(l.valor_pago)}`)
        : 'Prêmio ainda não registrado',
    })),
  }
}

/**
 * O que dizer à PRÓPRIA pessoa sobre o prêmio dela.
 *
 * Existe porque um programa de recompensa que o beneficiário não consegue conferir é promessa sem
 * prova — a mesma razão pela qual a tela de Comissão mostra o plano ao SDR. Devolve `null` para
 * quem ainda não alcançou: prometer entrega a quem não bateu o alvo seria pior que não dizer nada.
 */
function minhaRecompensa(progresso) {
  const p = progresso || {}
  if (!p.alcancado) return null
  if (!p.recompensa_paga) {
    return {
      pago: false,
      frase: 'Você alcançou o alvo. A entrega do prêmio ainda não foi registrada.',
      tom: 'espera',
    }
  }
  const valor = p.recompensa_valor_pago
  return {
    pago: true,
    frase: valor === null || valor === undefined
      ? 'Prêmio registrado como entregue.'
      : `Prêmio registrado como entregue: ${formatarDinheiro(valor)}.`,
    tom: 'positivo',
  }
}

module.exports = {
  formatarDinheiro,
  rotuloSituacao,
  dataBR,
  janelaTexto,
  recompensaTexto,
  resumoDoProgresso,
  resumoDeQuemAlcancou,
  minhaRecompensa,
}
