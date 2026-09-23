// @ts-check
'use strict'
// Aceite do termo da Operacao Comercial — acesso a dados. Etapa 1.
// Regras PURAS em src/services/programa-aceite.js; texto do termo em programa-termo.js.
// Aqui so' ha I/O — mesma divisao de `instancia-envio.js` (regra) x `whatsapp.js` (I/O).
//
// APPEND-ONLY: esta camada INSERE e LE. Nao existe UPDATE nem DELETE de aceite, de proposito —
// aceite e' um fato datado sobre um texto, e um `UPDATE` transformaria "aceitou a v1 em setembro"
// em "sempre aceitou a v2". Mesma disciplina de `app.lead_responsavel_historico` (072) e de
// `prospectador.lead_icp_avaliacoes` (079).

const { pool } = require('../db')
const { logger } = require('../logger')

/**
 * O ultimo aceite desta pessoa nesta empresa, para este programa.
 *
 * ⚠️ NAO e' usado no caminho quente: la, o aceite vem no MESMO SELECT do vinculo
 * (`buscarVinculoUsuarioEmpresa`, em db/empresas.js), para o gate nao custar uma segunda ida ao
 * banco em todo request autenticado. Esta funcao serve as rotas do proprio aceite, que rodam uma
 * vez por sessao.
 *
 * @returns {Promise<{versao: string, em: Date, maioridade_confirmada: boolean, regras_confirmadas: boolean}|null>}
 */
async function obterAceiteVigente(empresaId, usuarioId, programa) {
  const { rows } = await pool.query(
    `SELECT termo_versao AS versao, termo_hash, aceito_em AS em,
            maioridade_confirmada, regras_confirmadas
       FROM app.programa_aceites
      WHERE empresa_id = $1 AND usuario_id = $2 AND programa = $3
      ORDER BY aceito_em DESC
      LIMIT 1`,
    [empresaId, usuarioId, programa]
  )
  return rows[0] || null
}

/**
 * Registra o aceite. Idempotente por (empresa, pessoa, programa, VERSAO) — o indice unico da
 * migration 084 e' quem garante, nao a aplicacao: dois cliques no botao, um retry do navegador ou
 * duas abas abertas nao viram dois consentimentos.
 *
 * A AUDITORIA vai DENTRO da transacao, e nao best-effort como a telemetria: aqui a linha E' parte
 * do fato (quem consentiu, quando, sob qual texto). Um aceite gravado sem rastro de quem o
 * registrou seria exatamente o dado que esta etapa existe para produzir. Mesmo raciocinio de
 * `db/membros.js`.
 *
 * So' a criacao REAL e' auditada (`criado`): repetir a acao nao infla o log — mesma regra do
 * `IS DISTINCT FROM` da rota de `modo_ia` (063).
 *
 * @param {object} ctx  { empresaId, usuarioId }
 * @param {object} dados { programa, termo_versao, termo_hash, maioridade_confirmada, regras_confirmadas }
 * @returns {Promise<{criado: boolean, aceite: object}>}
 */
async function registrarAceite({ empresaId, usuarioId }, dados) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const ins = await client.query(
      `INSERT INTO app.programa_aceites
         (empresa_id, usuario_id, programa, termo_versao, termo_hash,
          maioridade_confirmada, regras_confirmadas)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (empresa_id, usuario_id, programa, termo_versao) DO NOTHING
       RETURNING id, termo_versao AS versao, aceito_em AS em`,
      [empresaId, usuarioId, dados.programa, dados.termo_versao, dados.termo_hash,
        dados.maioridade_confirmada, dados.regras_confirmadas]
    )

    const criado = ins.rowCount > 0
    if (criado) {
      // Sem PII: nem e-mail, nem nome, nem telefone. `usuario_id` e' a propria coluna de autoria
      // da auditoria, e o contexto guarda so' vocabulario fechado + a versao do termo.
      await client.query(
        `INSERT INTO app.auditoria_eventos
           (empresa_id, usuario_id, entidade_tipo, entidade_id, acao, estado_anterior, estado_novo, contexto)
         VALUES ($1, $2, 'programa_aceite', $3, 'programa_aceite_registrado', NULL, $4, $5::jsonb)`,
        [empresaId, usuarioId, ins.rows[0].id, dados.termo_versao,
          JSON.stringify({
            programa: dados.programa,
            termo_versao: dados.termo_versao,
            termo_hash: dados.termo_hash,
            maioridade_confirmada: true,
            regras_confirmadas: true,
          })]
      )
    }

    await client.query('COMMIT')

    if (criado) {
      logger.info({ empresa_id: empresaId, programa: dados.programa, termo_versao: dados.termo_versao },
        '[programa-aceite] aceite registrado')
      return { criado: true, aceite: ins.rows[0] }
    }

    // Ja existia: devolve o que esta gravado, para a rota responder com o fato real e nao com o
    // que o corpo da requisicao dizia.
    const atual = await obterAceiteVigente(empresaId, usuarioId, dados.programa)
    return { criado: false, aceite: atual }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

module.exports = { obterAceiteVigente, registrarAceite }
