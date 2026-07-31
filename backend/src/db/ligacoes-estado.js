'use strict'
// Estado de NEGOCIO da sessao de ligacao — logica PURA, sem banco e sem dependencias.
// Modulo folha de proposito: e' consumido por src/db/ligacoes.js E por
// src/db/ligacao-sessao-guard.js (que por sua vez e' usado pelos submodulos que ligacoes.js
// importa). Manter isto separado evita o ciclo de require
// ligacoes -> ligacao-etapas -> guard -> ligacoes.
//
// Sao 4 estados operacionais para 3 status no banco:
//
//   status='em_andamento' + chamada_encerrada_em IS NULL      -> 'em_andamento'
//     A conversa telefonica esta acontecendo. Cronometro corre; evento temporal e' aceito.
//
//   status='em_andamento' + chamada_encerrada_em preenchido    -> 'aguardando_resumo'
//     A chamada ACABOU, o resumo comercial ainda nao foi salvo. Cronometro congelado no
//     fim da chamada; nenhum evento temporal novo; o registro ainda nao entra na analitica.
//
//   status='encerrada'                                         -> 'encerrada'   (terminal)
//   status='descartada'                                        -> 'descartada'  (terminal)
//
// 'aguardando_resumo' e' DERIVADO, nao um status proprio: chamada_encerrada_em (migration 049)
// ja e' o marco oficial do fim da chamada (alimenta duracao_seg e o fechamento da etapa), e
// idx_ligacoes_uma_ativa_por_lead (migration 048) e' um UNIQUE parcial sobre
// status='em_andamento' — um status novo tiraria a sessao desse indice e permitiria abrir uma
// SEGUNDA ligacao para o mesmo lead com o resumo pendente.

/** @typedef {'em_andamento'|'aguardando_resumo'|'encerrada'|'descartada'} EstadoSessao */

/** Estado de negocio a partir da linha de app.ligacoes. null se nao houver linha/status. */
function estadoSessao(lig) {
  if (!lig || !lig.status) return null
  if (lig.status !== 'em_andamento') return lig.status // encerrada | descartada
  return lig.chamada_encerrada_em ? 'aguardando_resumo' : 'em_andamento'
}

/** A conversa telefonica ainda esta acontecendo? So entao evento temporal e' aceito. */
function chamadaAberta(lig) {
  return estadoSessao(lig) === 'em_andamento'
}

/** Anexa o estado derivado ao payload devolvido ao cockpit (o front NUNCA re-deriva). */
function comEstado(lig) {
  return lig ? { ...lig, estado_sessao: estadoSessao(lig) } : lig
}

module.exports = { estadoSessao, chamadaAberta, comEstado }
