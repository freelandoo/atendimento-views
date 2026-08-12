'use strict'
// Registro de EXECUCAO do canal de e-mail do follow-up (migration 067).
// Isolado por empresa: TODA query filtra `empresa_id`.
//
// As REGRAS vivem em services/followup-email.js. Aqui so' ha SQL.
//
// Uma linha por ENVIO (tentado), nunca por item: um follow-up pode ter sido tentado, ter
// falhado no provider e ter sido reenviado — e as duas coisas aconteceram. Nao ha status
// 'desativado' aqui: quando o canal nao esta configurado, o envio e recusado ANTES de
// compor e nada e gravado (gravar um "envio" que nunca saiu faria a linha do tempo do
// contato mentir).

const { candidatosTelefoneBR } = require('../telefone-br')

const COLS = `id, empresa_id, follow_up_id, telefone_digitos, destinatario, assunto,
  status, provider_id, erro, enviado_por, enviado_em, criado_em`

/**
 * Grava a tentativa de envio.
 *
 * `corpo` e gravado (e' o que foi realmente enviado ao cliente), mas NAO volta em nenhuma
 * leitura deste modulo: a fila e a linha do tempo precisam saber que houve e-mail e qual o
 * assunto, nao reproduzir o texto.
 */
async function registrarEnvio(exec, empresaId, entrada = {}) {
  const { rows } = await exec.query(
    `INSERT INTO app.follow_up_emails
       (empresa_id, follow_up_id, telefone_digitos, destinatario, assunto, corpo,
        status, provider_id, erro, enviado_por, enviado_em)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $7 = 'enviado' THEN NOW() END)
     RETURNING ${COLS}`,
    [empresaId, entrada.follow_up_id || null, entrada.telefone_digitos, entrada.destinatario,
      entrada.assunto, entrada.corpo, entrada.status, entrada.provider_id || null,
      entrada.erro || null, entrada.usuarioId || null]
  )
  return rows[0]
}

/** Envios de um contato, do mais recente para o mais antigo. Sem o corpo (ver cabecalho). */
async function listarEnviosDoContato(pool, empresaId, telefoneDigitos, { limit = 20 } = {}) {
  const lim = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 100)
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM app.follow_up_emails
      WHERE empresa_id = $1 AND telefone_digitos = $2
      ORDER BY criado_em DESC
      LIMIT $3`,
    [empresaId, telefoneDigitos, lim]
  )
  return rows
}

/**
 * E-mails CANDIDATOS de um contato: o que o cadastro do lead conhece
 * (`prospectador.prospects.email`, capturado na aquisicao/captacao).
 *
 * CANDIDATO, e nunca confirmado: ninguem verificou que aquele endereco recebe. Ele e
 * SUGERIDO na tela para o operador nao redigitar, e so vira canal quando uma pessoa confirma
 * (`app.contato_canal_disponibilidade`, canal 'email', origem 'operador'). Promove-lo sozinho
 * repetiria, do outro lado, o erro de deduzir disponibilidade sem verificacao humana.
 *
 * O casamento por telefone segue o padrao de `db/lead-nome-maps.js`: as variacoes de formato
 * (com/sem 55, com/sem 9o digito) sao geradas em JS por `candidatosTelefoneBR`, e a expressao
 * do WHERE e IDENTICA a expressao indexada por `idx_prospects_empresa_telefone_digitos`
 * (migration 065) — mudar uma sem a outra faz o indice deixar de ser usado em silencio.
 */
async function listarCandidatosDeEmail(pool, empresaId, telefoneDigitos) {
  const candidatos = candidatosTelefoneBR(telefoneDigitos)
  if (!candidatos.length) return []
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (lower(btrim(p.email)))
            btrim(p.email) AS endereco, p.nome, p.updated_at
       FROM prospectador.prospects p
      WHERE p.empresa_id = $1
        AND p.email IS NOT NULL AND btrim(p.email) <> ''
        AND regexp_replace(COALESCE(p.telefone, ''), '\\D', '', 'g') = ANY($2::text[])
      ORDER BY lower(btrim(p.email)), p.updated_at DESC NULLS LAST`,
    [empresaId, candidatos]
  )
  return rows.map((r) => ({ endereco: r.endereco, nome: r.nome || null, fonte: 'cadastro_lead' }))
}

module.exports = { registrarEnvio, listarEnviosDoContato, listarCandidatosDeEmail }
