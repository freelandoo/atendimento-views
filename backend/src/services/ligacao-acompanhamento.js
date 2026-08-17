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
//
// AMPLIACAO (sincronizacao entre sessoes): o modulo passou a publicar tambem o estado de UMA
// sessao (`resumirSessao`), usado por quem ESTA na ligacao — nao so' por quem observa. A mesma
// conta em dois aparelhos significa que o dono da ligacao tambem pode ser surpreendido: ele
// encerra no celular e a tela do computador segue com o cronometro correndo. Um segundo
// modulo para "a minha sessao" duplicaria a sanitizacao e o vocabulario de estado; o que muda
// entre os dois casos e' o que a TELA faz com a resposta, nao o que o servidor conta.

// A UNICA dependencia permitida aqui e' outro modulo PURO: `sessao-origem.js`, dono da
// comparacao "veio desta mesma sessao?". Reimplementar a comparacao aqui criaria uma segunda
// fonte para uma regra que ja tem dono (mesmo motivo do reexport em `domain-enums.js`).
const { mesmaSessao } = require('./sessao-origem')

/** Estados de sessao em que o lead esta OCUPADO por alguem. */
const ESTADOS_OCUPADO = Object.freeze(['em_andamento', 'aguardando_resumo'])

/**
 * DESFECHO da sessao — como ela terminou. Vocabulario proprio porque "sumiu da consulta de
 * ativa" (o unico detector que existia) nao distingue **encerrada** de **descartada**, e a
 * tela precisa dizer qual das duas aconteceu: encerrada entra na analitica e no historico do
 * lead; descartada nao entra em lugar nenhum. Sessao viva tem desfecho `null`.
 */
const DESFECHOS = Object.freeze(['encerrada', 'descartada'])

/** Campos que saem para a tela. Lista FECHADA: telefone, notas e resultado nao entram. */
const CAMPOS_PUBLICOS = Object.freeze([
  'id', 'campanha_lead_id', 'prospect_id', 'estado_sessao', 'iniciada_em',
  'chamada_encerrada_em', 'usuario_id', 'usuario_nome', 'sessao_dispositivo',
])

/**
 * Campos CALCULADOS (nao existem como coluna). Ficam nomeados para o teste conseguir cobrar a
 * forma exata do payload — e para deixar explicito que `sessao_origem` (a impressao) NAO esta
 * em lista nenhuma: ela e' persistida, mas nunca publicada.
 */
const CAMPOS_CALCULADOS = Object.freeze(['sou_eu', 'mesma_sessao'])

/** Campos a mais que so' a sincronizacao de UMA sessao devolve (a listagem nao precisa deles). */
const CAMPOS_SESSAO = Object.freeze(['status', 'encerrada_em', 'descartada_em'])

/** A ligacao ocupa o lead? (nao basta existir: precisa estar num estado de sessao vivo) */
function ocupaLead(lig) {
  return !!lig && ESTADOS_OCUPADO.includes(lig.estado_sessao)
}

/** Foi ESTE usuario que iniciou? Sem usuario em um dos lados, a resposta e' NAO. */
function ehDono(lig, usuarioId) {
  if (!lig || !lig.usuario_id || !usuarioId) return false
  return String(lig.usuario_id) === String(usuarioId)
}

/**
 * Como a sessao terminou, ou `null` se ainda esta viva. Le o `estado_sessao` (fonte unica,
 * derivada em db/ligacoes-estado.js) — nunca o par status+chamada_encerrada_em de novo.
 */
function desfechoSessao(lig) {
  if (!lig) return null
  return DESFECHOS.includes(lig.estado_sessao) ? lig.estado_sessao : null
}

// Resumo publicado para a tela. Sanitiza na ORIGEM (mesmo padrao de db/atribuicao-anuncios.js):
// a listagem so' precisa saber que existe ligacao, desde quando e de quem — nunca telefone,
// notas, resultado ou qualquer conteudo da conversa.
//
// `impressaoChamador` e' a impressao da sessao que esta PERGUNTANDO. Ela entra so' para virar
// o booleano `mesma_sessao`; a impressao em si (nem a do chamador, nem a gravada na linha)
// jamais aparece no payload.
function resumirLigacaoAtiva(lig, usuarioId, impressaoChamador = null) {
  if (!ocupaLead(lig)) return null
  const out = {
    sou_eu: ehDono(lig, usuarioId),
    mesma_sessao: mesmaSessao(lig.sessao_origem, impressaoChamador),
  }
  for (const c of CAMPOS_PUBLICOS) out[c] = lig[c] !== undefined ? lig[c] : null
  return out
}

/**
 * Lista de ligacoes ativas pronta para a tela. Descarta linha sem `campanha_lead_id`
 * (ligacao ad-hoc nao pertence a nenhuma linha da fila) e linha ja terminada.
 */
function resumirLigacoesAtivas(rows = [], usuarioId = null, impressaoChamador = null) {
  const out = []
  for (const r of rows) {
    if (!r || !r.campanha_lead_id) continue
    const resumo = resumirLigacaoAtiva(r, usuarioId, impressaoChamador)
    if (resumo) out.push(resumo)
  }
  return out
}

/**
 * Estado publicado de UMA sessao — o que a tela aberta (operando OU acompanhando) reconfere
 * no tempo para descobrir que algo mudou em outro aparelho.
 *
 * Diferente de `resumirLigacaoAtiva`, ele NAO devolve null quando a sessao terminou: e'
 * exatamente o caso interessante. Sem uma leitura que sobreviva ao fim, o unico sinal
 * disponivel era "sumiu da consulta de ativa", que nao diz se foi encerramento (registro
 * valido, entra na analitica) ou descarte (nao entra em lugar nenhum) — e nao diz quem fez.
 *
 * `viva` e' publicado pronto para a tela nao re-derivar: ela nao pode ficar decidindo sozinha
 * quando parar o cronometro.
 */
function resumirSessao(lig, usuarioId, impressaoChamador = null) {
  if (!lig || !lig.id) return null
  const out = {
    sou_eu: ehDono(lig, usuarioId),
    mesma_sessao: mesmaSessao(lig.sessao_origem, impressaoChamador),
    viva: ocupaLead(lig),
    desfecho: desfechoSessao(lig),
  }
  for (const c of CAMPOS_PUBLICOS) out[c] = lig[c] !== undefined ? lig[c] : null
  for (const c of CAMPOS_SESSAO) out[c] = lig[c] !== undefined ? lig[c] : null
  return out
}

module.exports = {
  ESTADOS_OCUPADO, DESFECHOS, CAMPOS_PUBLICOS, CAMPOS_CALCULADOS, CAMPOS_SESSAO,
  ocupaLead, ehDono, desfechoSessao,
  resumirLigacaoAtiva, resumirLigacoesAtivas, resumirSessao,
}
