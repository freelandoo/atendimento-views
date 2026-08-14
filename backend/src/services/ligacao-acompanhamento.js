'use strict'
// Ligacao ATIVA vista por QUEM NAO ESTA NELA (modo Acompanhar). Modulo PURO: sem banco,
// HTTP, IA ou rede.
//
// O problema que ele resolve: duas pessoas na mesma conta (uma ligando pelo celular, outra
// olhando pelo computador) nao enxergavam que havia ligacao em andamento para um lead. Quem
// clicasse "Ligar" recebia a SESSAO ALHEIA — `iniciarLigacao` e' idempotente e retoma a ativa
// do lead (src/db/ligacoes.js) — e podia encerra-la. Este modulo nao muda esse contrato; ele
// da' nome ao fato para a tela poder mostrar "esta ocupada, e com quem".
//
// Ele nao responde "qual acao a linha oferece?" de proposito: a linha SEM ligacao ativa nao
// produz item nenhum aqui, entao a decisao de rotulo ("Ligar" / "Retomar" / "Acompanhar")
// tem de existir do lado que enxerga a fila inteira — e ela vive UMA vez, em
// frontend/lib/ligacao-ativa.js. O que so' o servidor sabe e' `sou_eu`: o cliente nao tem o
// id do usuario autenticado em maos, e deduzi-lo por nome seria adivinhacao.
//
// Os dois estados de sessao contam como OCUPADO: `em_andamento` (a conversa esta rolando) e
// `aguardando_resumo` (a chamada acabou, o resumo nao foi salvo). No banco os dois sao o
// MESMO `status = 'em_andamento'` (ver src/db/ligacoes-estado.js e a migration 048), entao
// tratar so' o primeiro deixaria o lead "livre" enquanto outra pessoa ainda esta gravando o
// resumo dele.

/** Estados de sessao em que o lead esta OCUPADO por alguem. */
const ESTADOS_OCUPADO = Object.freeze(['em_andamento', 'aguardando_resumo'])

/** Campos que saem para a tela. Lista FECHADA: telefone, notas e resultado nao entram. */
const CAMPOS_PUBLICOS = Object.freeze([
  'id', 'campanha_lead_id', 'prospect_id', 'estado_sessao', 'iniciada_em',
  'chamada_encerrada_em', 'usuario_id', 'usuario_nome',
])

/** A ligacao ocupa o lead? (nao basta existir: precisa estar num estado de sessao vivo) */
function ocupaLead(lig) {
  return !!lig && ESTADOS_OCUPADO.includes(lig.estado_sessao)
}

/** Foi ESTE usuario que iniciou? Sem usuario em um dos lados, a resposta e' NAO. */
function ehDono(lig, usuarioId) {
  if (!lig || !lig.usuario_id || !usuarioId) return false
  return String(lig.usuario_id) === String(usuarioId)
}

// Resumo publicado para a tela. Sanitiza na ORIGEM (mesmo padrao de db/atribuicao-anuncios.js):
// a listagem so' precisa saber que existe ligacao, desde quando e de quem — nunca telefone,
// notas, resultado ou qualquer conteudo da conversa.
function resumirLigacaoAtiva(lig, usuarioId) {
  if (!ocupaLead(lig)) return null
  const out = { sou_eu: ehDono(lig, usuarioId) }
  for (const c of CAMPOS_PUBLICOS) out[c] = lig[c] !== undefined ? lig[c] : null
  return out
}

/**
 * Lista de ligacoes ativas pronta para a tela. Descarta linha sem `campanha_lead_id`
 * (ligacao ad-hoc nao pertence a nenhuma linha da fila) e linha ja terminada.
 */
function resumirLigacoesAtivas(rows = [], usuarioId = null) {
  const out = []
  for (const r of rows) {
    if (!r || !r.campanha_lead_id) continue
    const resumo = resumirLigacaoAtiva(r, usuarioId)
    if (resumo) out.push(resumo)
  }
  return out
}

module.exports = {
  ESTADOS_OCUPADO, CAMPOS_PUBLICOS,
  ocupaLead, ehDono, resumirLigacaoAtiva, resumirLigacoesAtivas,
}
