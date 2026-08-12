'use strict'
// Acesso a banco da DISPONIBILIDADE DE CANAL por contato (migration 066).
// Isolado por empresa: TODA query filtra `empresa_id`.
//
// As REGRAS vivem em services/contato-canal-disponibilidade.js (modulo PURO). Aqui so' ha SQL.
//
// Este modulo NAO tem, e nao pode ganhar, nenhuma funcao que receba um erro de envio, um
// codigo do Evolution ou um resultado de provider. A unica escrita e' `marcarDisponibilidade`,
// que exige `usuarioId` do chamador — uma pessoa autenticada. Guarda de regressao em
// test/contato-canal-disponibilidade.test.js le este fonte.
const {
  validarMarcacao,
} = require('../services/contato-canal-disponibilidade')
const { normalizarTelefoneDigitos } = require('../services/follow-up-modelo')

const COLS = `id, empresa_id, telefone_digitos, canal, disponivel, motivo, origem,
  marcado_por, marcado_em, criado_em, atualizado_em`

/**
 * Grava (ou reescreve) o veredito do operador sobre um canal deste contato.
 *
 * `exec` aceita pool OU client de transacao — e' o que permite marcar "sem WhatsApp" e mover
 * o follow-up de canal na MESMA transacao. Se a troca de canal colidir com o indice unico
 * parcial de follow-ups, a marcacao volta atras junto: nao existe meio-estado em que o
 * contato ficou marcado e o trabalho ficou no canal errado.
 *
 * UPSERT com DO UPDATE — a decisao MAIS RECENTE vence, e e exatamente isso que torna a
 * marcacao REVERSIVEL: "Tem WhatsApp" reescreve a mesma linha em vez de empilhar um segundo
 * veredito que contradiz o primeiro. `marcado_por`/`marcado_em` acompanham, entao a linha
 * sempre diz quem decidiu por ultimo e quando.
 */
async function marcarDisponibilidade(exec, empresaId, entrada = {}, { usuarioId = null } = {}) {
  const p = validarMarcacao(entrada)
  const telefone = normalizarTelefoneDigitos(entrada.telefone)
  const { rows } = await exec.query(
    `INSERT INTO app.contato_canal_disponibilidade
       (empresa_id, telefone_digitos, canal, disponivel, motivo, origem, marcado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (empresa_id, telefone_digitos, canal)
     DO UPDATE SET
       disponivel    = EXCLUDED.disponivel,
       motivo        = EXCLUDED.motivo,
       origem        = EXCLUDED.origem,
       marcado_por   = EXCLUDED.marcado_por,
       marcado_em    = NOW(),
       atualizado_em = NOW()
     RETURNING ${COLS}`,
    [empresaId, telefone, p.canal, p.disponivel, p.motivo, p.origem, usuarioId]
  )
  return rows[0]
}

/**
 * Veredito de WhatsApp de UM contato.
 * Devolve `null` quando nao ha linha — "ninguem verificou", que nao e' `false`.
 */
async function whatsappDisponivelDoContato(exec, empresaId, telefoneDigitos) {
  const { rows } = await exec.query(
    `SELECT disponivel FROM app.contato_canal_disponibilidade
      WHERE empresa_id = $1 AND telefone_digitos = $2 AND canal = 'whatsapp'`,
    [empresaId, telefoneDigitos]
  )
  return rows[0] ? rows[0].disponivel : null
}

/** Linha completa (para a tela dizer QUANDO e POR QUEM foi marcado). `null` se nao houver. */
async function obterDisponibilidade(exec, empresaId, telefoneDigitos, canal = 'whatsapp') {
  const { rows } = await exec.query(
    `SELECT ${COLS} FROM app.contato_canal_disponibilidade
      WHERE empresa_id = $1 AND telefone_digitos = $2 AND canal = $3`,
    [empresaId, telefoneDigitos, canal]
  )
  return rows[0] || null
}

module.exports = {
  marcarDisponibilidade,
  whatsappDisponivelDoContato,
  obterDisponibilidade,
}
