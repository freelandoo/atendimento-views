'use strict'
// Apresentacao PURA da ligacao ATIVA de outra pessoa (modo Acompanhar) na Central de
// Ligacoes. Como `lib/site-rotulos.js` e `lib/pontuacao-indicador.js`, aqui so' se TRADUZ o
// veredito que a API mandou: quem decide se a ligacao existe, em que estado esta e se e' do
// usuario logado (`sou_eu`) e' o backend — o front nao compara id de usuario, nao deduz dono
// por nome e nao re-deriva `estado_sessao`.
//
// Regra de produto que este modulo encarna:
//   sem ligacao ativa                      -> "Ligar"       (comportamento de sempre)
//   ligacao ativa e ela e' MINHA           -> "Retomar"     (mesmo comportamento: POST /iniciar
//                                                            e' idempotente e devolve a minha)
//   ligacao ativa de OUTRA pessoa          -> "Acompanhar"  (visao SOMENTE LEITURA)
//
// `aguardando_resumo` (chamada encerrada, resumo pendente) tambem ocupa o lead: no banco ele
// e' o MESMO status 'em_andamento' e ainda impede uma segunda sessao.

/** @typedef {{ id: string, campanha_lead_id: string|null, prospect_id: string|null,
 *   estado_sessao: 'em_andamento'|'aguardando_resumo', iniciada_em: string|null,
 *   chamada_encerrada_em: string|null, usuario_id: string|null, usuario_nome: string|null,
 *   sou_eu: boolean }} LigacaoAtiva */

const ACAO = Object.freeze({ LIGAR: 'ligar', RETOMAR: 'retomar', ACOMPANHAR: 'acompanhar' })

/** Indexa a resposta de `GET /ligacoes/ativas` por lead da campanha. */
function indexarAtivasPorLead(itens) {
  const mapa = {}
  for (const it of Array.isArray(itens) ? itens : []) {
    if (it && it.campanha_lead_id) mapa[String(it.campanha_lead_id)] = it
  }
  return mapa
}

/** Quem esta na ligacao, em texto. Nome so' quando o backend mandou um. */
function rotuloOperador(ativa) {
  if (!ativa) return ''
  if (ativa.sou_eu) return 'você'
  const nome = String(ativa.usuario_nome || '').trim()
  return nome || 'outro operador'
}

/**
 * Acao que a linha oferece. `somenteLeitura` e' o que a tela usa para abrir a operacao em
 * modo Acompanhar — nunca uma comparacao de id feita aqui.
 */
function acaoDoLead(ativa) {
  if (!ativa) {
    return { acao: ACAO.LIGAR, rotulo: 'Ligar', somenteLeitura: false, titulo: 'Abrir a operação e ligar para este lead.' }
  }
  if (ativa.sou_eu) {
    return {
      acao: ACAO.RETOMAR,
      rotulo: 'Retomar',
      somenteLeitura: false,
      titulo: ativa.estado_sessao === 'aguardando_resumo'
        ? 'Você tem um resumo pendente desta ligação. Abrir para concluir.'
        : 'Você já está nesta ligação (em outra aba ou aparelho). Abrir para continuar.',
    }
  }
  return {
    acao: ACAO.ACOMPANHAR,
    rotulo: 'Acompanhar',
    somenteLeitura: true,
    titulo: `${rotuloOperador(ativa)} está nesta ligação. Abrir em modo somente leitura — você não pode registrar nem encerrar.`,
  }
}

/**
 * Selo "Em ligação agora" da listagem. Texto explicito (cor nunca e' o unico sinal) e com
 * QUEM esta na ligacao, que e' a informacao que faltava para duas pessoas na mesma conta.
 */
function seloLigacaoAtiva(ativa) {
  if (!ativa) return null
  const quem = rotuloOperador(ativa)
  if (ativa.estado_sessao === 'aguardando_resumo') {
    return {
      texto: `Resumo pendente · ${quem}`,
      titulo: `A chamada terminou e ${ativa.sou_eu ? 'você ainda não salvou' : `${quem} ainda não salvou`} o resumo. O lead segue ocupado até isso acontecer.`,
      proprio: !!ativa.sou_eu,
    }
  }
  return {
    texto: `Em ligação agora · ${quem}`,
    titulo: ativa.sou_eu
      ? 'Você iniciou esta ligação (em outra aba ou aparelho).'
      : `${quem} está falando com este lead agora.`,
    proprio: !!ativa.sou_eu,
  }
}

/**
 * Proximo lead a quem o botao global "Ligar agora" deve levar: o primeiro da fila que NAO
 * esta em ligacao de outra pessoa. Ligacao PROPRIA nao faz pular — retomar a minha e' o
 * comportamento esperado.
 *
 * Pular (em vez de abrir em modo Acompanhar) e' deliberado: "Ligar agora" e' um comando de
 * TRABALHO, e escolher o proximo e' exatamente o que ele faz. Abrir uma tela de observacao
 * seria um efeito surpreendente; e comecar a falar com um lead que ja esta ao telefone com um
 * colega e' o unico desfecho que atinge o CLIENTE.
 */
function proximoLigavel(lista, ativasPorLead) {
  const mapa = ativasPorLead || {}
  for (const item of Array.isArray(lista) ? lista : []) {
    const ativa = item && mapa[String(item.campanha_lead_id)]
    if (!ativa || ativa.sou_eu) return item
  }
  return null
}

/** Quantos leads da fila visivel estao ocupados por OUTRA pessoa (aviso do botao global). */
function contarOcupadosPorOutros(lista, ativasPorLead) {
  const mapa = ativasPorLead || {}
  let n = 0
  for (const item of Array.isArray(lista) ? lista : []) {
    const ativa = item && mapa[String(item.campanha_lead_id)]
    if (ativa && !ativa.sou_eu) n += 1
  }
  return n
}

module.exports = {
  ACAO,
  indexarAtivasPorLead, rotuloOperador, acaoDoLead, seloLigacaoAtiva,
  proximoLigavel, contarOcupadosPorOutros,
}
