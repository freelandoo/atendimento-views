'use strict'
// Maquina de estados PURA da Operacao da Ligacao (Fatia A). Espelha o guard do backend
// (src/db/ligacoes.js: transicaoValida) + o estado 'visualizando', que so existe no front
// (abrir a interface nao grava nada). Extraida para ser testavel (node:test).

/** @typedef {'visualizando'|'em_andamento'|'encerrada'|'descartada'} EstadoLigacao */

const TRANSICOES = {
  visualizando: ['em_andamento', 'fechado_sem_registro'],
  em_andamento: ['encerrada', 'descartada'],
  encerrada: [],
  descartada: [],
}

/** Transicao permitida? (mesmas regras do backend + visualizando so no front). */
function podeTransicionar(de, para) {
  return Array.isArray(TRANSICOES[de]) && TRANSICOES[de].includes(para)
}

/** Segundos inteiros decorridos desde iniciada_em (>= 0). O cronometro do front e VISUAL. */
function segDesde(iniciadaEmISO, agoraMs = Date.now()) {
  if (!iniciadaEmISO) return 0
  const t = new Date(iniciadaEmISO).getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((agoraMs - t) / 1000))
}

/** Formata segundos como MM:SS (ou HH:MM:SS a partir de 1h). */
function fmtCronometro(segundos) {
  const s = Math.max(0, Math.floor(Number(segundos) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`
}

module.exports = { podeTransicionar, segDesde, fmtCronometro }
