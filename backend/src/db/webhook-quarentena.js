'use strict'

// Acesso a app.webhook_quarentena — os webhooks que chegaram SEM DONO COMPROVADO.
//
// INVARIANTES DESTE MÓDULO (são o isolamento, não zelo estético):
//   1. Nenhuma função aceita `empresaId` de quem chama para ABRIR ou FECHAR pendência.
//      A empresa só entra aqui depois de provada pela instância, e quem prova é a
//      reconsulta a `app.empresa_whatsapp_instances` — nunca a escolha de um operador.
//   2. Nada de PII: este módulo não recebe telefone, texto, pushName nem payload. O id da
//      mensagem chega SEMPRE como hash (ver `hashMensagemId`).
//   3. A idempotência é do BANCO (índice único parcial), não de um SELECT antes do INSERT.

const { pool: poolPadrao } = require('../db')
const { MOTIVOS_QUARENTENA, acaoDoMotivo, motivoEhTransitorio } = require('../services/webhook-quarentena')

function erro(code, message, statusCode = 400) {
  const e = new Error(message)
  e.code = code
  e.statusCode = statusCode
  return e
}

/**
 * Abre ou atualiza a pendência desta instância+motivo. IDEMPOTENTE por construção:
 *
 *   - a corrida entre dois webhooks simultâneos é resolvida pelo índice único parcial
 *     `webhook_quarentena_instancia_uk`, não por leitura prévia;
 *   - a REENTREGA do mesmo webhook não infla o contador: `ocorrencias` só cresce quando
 *     `ultima_mensagem_hash` muda. Sem isso, um retry do Evolution faria a tela dizer que
 *     o problema é maior do que é.
 *
 * @param {object} pendencia saída de `resolverTenantWebhook().pendencia`
 * @param {string|null} mensagemHash SHA-256 do id da mensagem (nunca o id em claro)
 * @returns {Promise<{id:number, novaOcorrencia:boolean, aberta:boolean}>}
 */
async function registrarPendencia(db, pendencia, mensagemHash = null) {
  if (!pendencia?.motivo) throw erro('SEM_MOTIVO', 'Pendência de webhook sem motivo.', 400)
  if (!MOTIVOS_QUARENTENA.includes(pendencia.motivo)) {
    throw erro('MOTIVO_INVALIDO', `Motivo de quarentena desconhecido: ${pendencia.motivo}`, 400)
  }
  const conexao = db || poolPadrao

  const { rows } = await conexao.query(
    `INSERT INTO app.webhook_quarentena
       (evolution_instance, instancia_chave, motivo, ocorrencias, ultima_mensagem_hash)
     VALUES ($1, $2, $3, 1, $4)
     ON CONFLICT (instancia_chave, motivo) WHERE resolvida_em IS NULL
     DO UPDATE SET
       ultima_em = NOW(),
       -- Reentrega do MESMO webhook não conta de novo.
       ocorrencias = app.webhook_quarentena.ocorrencias
         + CASE WHEN $4::text IS NOT NULL
                 AND app.webhook_quarentena.ultima_mensagem_hash IS DISTINCT FROM $4::text
                THEN 1 ELSE 0 END,
       ultima_mensagem_hash = COALESCE($4::text, app.webhook_quarentena.ultima_mensagem_hash)
     RETURNING id, ocorrencias, (xmax = 0) AS inserida`,
    [pendencia.evolutionInstance, pendencia.instanciaChave, pendencia.motivo, mensagemHash]
  )
  const row = rows[0]
  return {
    id: Number(row.id),
    novaOcorrencia: row.inserida === true,
    aberta: true,
  }
}

/**
 * Pendências para o painel. Já sai sanitizado — o que volta daqui pode ir para a tela
 * como está (não há PII a mascarar porque não há PII armazenada).
 *
 * @param {'abertas'|'resolvidas'|'todas'} estado
 */
async function listarPendencias(db, { estado = 'abertas', limite = 50 } = {}) {
  const conexao = db || poolPadrao
  const lim = Math.max(1, Math.min(200, Number(limite) || 50))
  const filtro =
    estado === 'resolvidas' ? 'q.resolvida_em IS NOT NULL'
      : estado === 'todas' ? 'TRUE'
        : 'q.resolvida_em IS NULL'

  const { rows } = await conexao.query(
    `SELECT q.id, q.evolution_instance, q.motivo, q.ocorrencias,
            q.primeira_em, q.ultima_em, q.resolvida_em,
            q.resolvida_empresa_id, e.nome AS resolvida_empresa_nome
       FROM app.webhook_quarentena q
       LEFT JOIN app.empresas e ON e.id = q.resolvida_empresa_id
      WHERE ${filtro}
      ORDER BY q.resolvida_em IS NOT NULL, q.ultima_em DESC
      LIMIT $1`,
    [lim]
  )

  return rows.map((r) => ({
    id: Number(r.id),
    evolution_instance: r.evolution_instance || null,
    motivo: r.motivo,
    // Traduzidos pela MESMA regra que a API e o log usam.
    acao: acaoDoMotivo(r.motivo),
    transitorio: motivoEhTransitorio(r.motivo),
    ocorrencias: Number(r.ocorrencias) || 0,
    primeira_em: r.primeira_em,
    ultima_em: r.ultima_em,
    resolvida_em: r.resolvida_em || null,
    resolvida_empresa_id: r.resolvida_empresa_id || null,
    resolvida_empresa: r.resolvida_empresa_nome || null,
  }))
}

/** Contagem de pendências ABERTAS por motivo. Só agregado. */
async function resumoPendencias(db) {
  const conexao = db || poolPadrao
  const { rows } = await conexao.query(
    `SELECT motivo, COUNT(*)::int AS pendencias, SUM(ocorrencias)::bigint AS ocorrencias
       FROM app.webhook_quarentena
      WHERE resolvida_em IS NULL
      GROUP BY motivo`
  )
  const porMotivo = {}
  let total = 0
  for (const r of rows) {
    porMotivo[r.motivo] = { pendencias: Number(r.pendencias) || 0, ocorrencias: Number(r.ocorrencias) || 0 }
    total += Number(r.pendencias) || 0
  }
  return { total, por_motivo: porMotivo }
}

/** Uma pendência pelo id, crua (uso interno da resolução). */
async function buscarPendencia(db, id) {
  const conexao = db || poolPadrao
  const { rows } = await conexao.query(
    `SELECT id, evolution_instance, instancia_chave, motivo, resolvida_em
       FROM app.webhook_quarentena WHERE id = $1`,
    [id]
  )
  return rows[0] || null
}

/**
 * Fecha a pendência com o dono PROVADO. `empresaId`/`instanciaId` chegam da reconsulta
 * feita pela rota, nunca do corpo da requisição — é o que impede o operador de apontar
 * uma mensagem para a empresa que quiser (o fallback com outro nome).
 *
 * O UPDATE é condicionado a `resolvida_em IS NULL`: dois operadores clicando ao mesmo
 * tempo não geram dois fechamentos, o segundo simplesmente não afeta linha.
 */
async function resolverPendencia(db, id, { empresaId, instanciaId }) {
  if (!empresaId || !instanciaId) {
    throw erro('SEM_DONO_PROVADO', 'Pendência só pode ser resolvida com empresa e instância provadas.', 400)
  }
  const conexao = db || poolPadrao
  const { rows } = await conexao.query(
    `UPDATE app.webhook_quarentena
        SET resolvida_em = NOW(), resolvida_empresa_id = $2, resolvida_instancia_id = $3
      WHERE id = $1 AND resolvida_em IS NULL
      RETURNING id, resolvida_em`,
    [id, empresaId, instanciaId]
  )
  return rows[0] ? { id: Number(rows[0].id), resolvida_em: rows[0].resolvida_em } : null
}

module.exports = {
  registrarPendencia,
  listarPendencias,
  resumoPendencias,
  buscarPendencia,
  resolverPendencia,
}
