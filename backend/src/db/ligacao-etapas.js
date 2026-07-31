'use strict'
// Etapas TEMPORAIS da ligacao (Fatia B). Cada passagem por uma etapa e' uma OCORRENCIA:
// entrou_em / saiu_em / duracao_seg (servidor). Voltar cria nova ocorrencia. So uma ativa
// por ligacao (garantido por UNIQUE parcial + fechar-antes-de-abrir na mesma transacao).
// Isolado por empresa; so abre/troca com a CHAMADA ABERTA. Idempotente por client_event_id.
// FONTE OFICIAL de duracao-por-etapa (ver migration 042).
const { assertChamadaAberta } = require('./ligacao-sessao-guard')

function erroEntrada(message, statusCode = 400) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

async function withTx(pool, fn) {
  const client = await pool.connect()
  try { await client.query('BEGIN'); const r = await fn(client); await client.query('COMMIT'); return r }
  catch (e) { try { await client.query('ROLLBACK') } catch { /* */ } throw e }
  finally { client.release() }
}

const COLS = `id, ligacao_id, roteiro_id, roteiro_versao_id, roteiro_etapa_id, tipo_etapa,
  ordem_etapa, entrou_em, saiu_em, duracao_seg, usuario_id, client_event_id, created_at, updated_at`

// Guard de chamada aberta: fonte unica em ./ligacao-sessao-guard.js. Antes era uma copia
// local que so olhava o status — e por isso aceitava TROCAR DE ETAPA depois do fim da
// chamada. Como trocarEtapa fecha a ocorrencia ativa com NOW() (nao passa `momento`), isso
// jogava todo o tempo de preenchimento do resumo dentro da duracao da ultima etapa.
// Devolve a linha, de onde este modulo usa o roteiro_versao_id.

// Deriva tipo/ordem/versao/roteiro da etapa do roteiro (NAO confia no cliente) e valida que
// ela pertence ao roteiro da ligacao.
async function deriveEtapa(db, empresaId, roteiroEtapaId, ligacaoVersaoId) {
  if (!roteiroEtapaId) throw erroEntrada('roteiro_etapa_id obrigatorio.')
  const { rows } = await db.query(
    `SELECT re.id, re.tipo, re.ordem, re.versao_id, rv.roteiro_id
       FROM app.roteiro_etapas re JOIN app.roteiro_versoes rv ON rv.id = re.versao_id
      WHERE re.id = $1 AND re.empresa_id = $2`, [roteiroEtapaId, empresaId])
  if (!rows[0]) throw erroEntrada('Etapa do roteiro nao encontrada.', 404)
  if (ligacaoVersaoId && rows[0].versao_id !== ligacaoVersaoId) {
    throw erroEntrada('Etapa nao pertence ao roteiro desta ligacao.')
  }
  return rows[0]
}

async function obterEtapaAtiva(db, empresaId, ligacaoId) {
  if (!ligacaoId) throw erroEntrada('ligacao_id obrigatorio.')
  const { rows } = await db.query(
    `SELECT ${COLS} FROM app.ligacao_etapas
      WHERE empresa_id = $1 AND ligacao_id = $2 AND saiu_em IS NULL LIMIT 1`, [empresaId, ligacaoId])
  return rows[0] || null
}

async function listarEtapas(db, empresaId, ligacaoId) {
  if (!ligacaoId) throw erroEntrada('ligacao_id obrigatorio.')
  const { rows } = await db.query(
    `SELECT ${COLS} FROM app.ligacao_etapas
      WHERE empresa_id = $1 AND ligacao_id = $2 ORDER BY entrou_em ASC`, [empresaId, ligacaoId])
  return rows
}

// Ultima ocorrencia (etapa final da ligacao).
async function obterEtapaFinal(db, empresaId, ligacaoId) {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM app.ligacao_etapas
      WHERE empresa_id = $1 AND ligacao_id = $2 ORDER BY entrou_em DESC LIMIT 1`, [empresaId, ligacaoId])
  return rows[0] || null
}

// Fecha a ocorrencia ativa (saiu_em + duracao no servidor). Idempotente: null se nao havia.
// Aceita pool OU client (usado dentro da transacao de encerrar/descartar/trocar).
// `momento` (opcional) = instante em que a CHAMADA terminou (ligacoes.chamada_encerrada_em).
// Sem ele, cai para NOW() — comportamento historico. Com ele, a ULTIMA etapa deixa de
// absorver o tempo de preenchimento do resumo (ver migration 049). GREATEST contra entrou_em
// protege de um momento anterior a abertura da ocorrencia (relogio/ordem de eventos).
async function fecharEtapaAtiva(db, empresaId, ligacaoId, momento = null) {
  const { rows } = await db.query(
    `UPDATE app.ligacao_etapas
        SET saiu_em = GREATEST(COALESCE($3::timestamptz, NOW()), entrou_em),
            duracao_seg = GREATEST(0, EXTRACT(EPOCH FROM (GREATEST(COALESCE($3::timestamptz, NOW()), entrou_em) - entrou_em)))::int,
            updated_at = NOW()
      WHERE ligacao_id = $1 AND empresa_id = $2 AND saiu_em IS NULL
      RETURNING ${COLS}`, [ligacaoId, empresaId, momento])
  return rows[0] || null
}

// Insere uma ocorrencia (ativa). Usado por abrir/trocar e pela primeira etapa no iniciar.
async function inserirOcorrencia(db, empresaId, ligacaoId, et, { usuarioId, clientEventId } = {}) {
  const { rows } = await db.query(
    `INSERT INTO app.ligacao_etapas
       (empresa_id, ligacao_id, roteiro_id, roteiro_versao_id, roteiro_etapa_id, tipo_etapa, ordem_etapa, usuario_id, client_event_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING ${COLS}`,
    [empresaId, ligacaoId, et.roteiro_id, et.versao_id, et.id, et.tipo, et.ordem, usuarioId || null, clientEventId || null])
  return rows[0]
}

// Abre a PRIMEIRA etapa (menor ordem) do roteiro. Roda DENTRO da transacao do iniciar.
async function abrirPrimeiraEtapaTx(client, empresaId, ligacaoId, roteiroVersaoId, usuarioId) {
  if (!roteiroVersaoId) return null
  const { rows } = await client.query(
    `SELECT re.id, re.tipo, re.ordem, re.versao_id, rv.roteiro_id
       FROM app.roteiro_etapas re JOIN app.roteiro_versoes rv ON rv.id = re.versao_id
      WHERE re.versao_id = $1 AND re.empresa_id = $2 ORDER BY re.ordem ASC LIMIT 1`,
    [roteiroVersaoId, empresaId])
  if (!rows[0]) return null
  return inserirOcorrencia(client, empresaId, ligacaoId, rows[0], { usuarioId })
}

// Abre uma etapa (idempotente). Se ja existe ocorrencia ativa, devolve-a (nao abre 2a).
async function abrirEtapa(pool, empresaId, ligacaoId, p = {}) {
  const lig = await assertChamadaAberta(pool, empresaId, ligacaoId)
  if (p.clientEventId) {
    const { rows } = await pool.query(
      `SELECT ${COLS} FROM app.ligacao_etapas WHERE empresa_id = $1 AND client_event_id = $2`,
      [empresaId, p.clientEventId])
    if (rows[0]) return { ...rows[0], idempotente: true }
  }
  const ativa = await obterEtapaAtiva(pool, empresaId, ligacaoId)
  if (ativa) return { ...ativa, ja_ativa: true }
  const et = await deriveEtapa(pool, empresaId, p.roteiroEtapaId, lig.roteiro_versao_id)
  try {
    const row = await inserirOcorrencia(pool, empresaId, ligacaoId, et, p)
    return { ...row, idempotente: false }
  } catch (e) {
    if (e && e.code === '23505') {
      if (p.clientEventId) {
        const { rows } = await pool.query(
          `SELECT ${COLS} FROM app.ligacao_etapas WHERE empresa_id = $1 AND client_event_id = $2`, [empresaId, p.clientEventId])
        if (rows[0]) return { ...rows[0], idempotente: true }
      }
      const at = await obterEtapaAtiva(pool, empresaId, ligacaoId)
      if (at) return { ...at, ja_ativa: true }
    }
    throw e
  }
}

// Troca de etapa: fecha a ativa e abre a destino na MESMA transacao. Idempotente.
async function trocarEtapa(pool, empresaId, ligacaoId, p = {}) {
  const lig = await assertChamadaAberta(pool, empresaId, ligacaoId)
  if (p.clientEventId) {
    const { rows } = await pool.query(
      `SELECT ${COLS} FROM app.ligacao_etapas WHERE empresa_id = $1 AND client_event_id = $2`,
      [empresaId, p.clientEventId])
    if (rows[0]) return { ...rows[0], idempotente: true }
  }
  const et = await deriveEtapa(pool, empresaId, p.roteiroEtapaId, lig.roteiro_versao_id)
  try {
    return await withTx(pool, async (client) => {
      const fechada = await fecharEtapaAtiva(client, empresaId, ligacaoId)
      const nova = await inserirOcorrencia(client, empresaId, ligacaoId, et, p)
      return { ...nova, fechou: fechada ? fechada.id : null, idempotente: false }
    })
  } catch (e) {
    if (e && e.code === '23505') {
      if (p.clientEventId) {
        const { rows } = await pool.query(
          `SELECT ${COLS} FROM app.ligacao_etapas WHERE empresa_id = $1 AND client_event_id = $2`, [empresaId, p.clientEventId])
        if (rows[0]) return { ...rows[0], idempotente: true }
      }
      const at = await obterEtapaAtiva(pool, empresaId, ligacaoId)
      if (at) return { ...at, idempotente: true }
    }
    throw e
  }
}

module.exports = {
  obterEtapaAtiva, listarEtapas, obterEtapaFinal, fecharEtapaAtiva,
  abrirPrimeiraEtapaTx, abrirEtapa, trocarEtapa,
}
