'use strict'
// Sinais estruturados registrados DURANTE a ligacao (Fatia D). Persistencia imediata no
// clique. Isolado por empresa; so registra em ligacao 'em_andamento'. Idempotente por
// client_event_id. Desmarcar NAO apaga: marca removido_em (correcao auditavel).
const { SINAL_TIPO, SINAL_ORIGEM, ROTEIRO_ETAPA_TIPO } = require('../domain-enums')
const { assertMesmaEmpresa } = require('./campanhas')
const { assertChamadaAberta } = require('./ligacao-sessao-guard')

const TIPO = new Set(SINAL_TIPO)
const ORIGEM = new Set(SINAL_ORIGEM)
const ETP = new Set(ROTEIRO_ETAPA_TIPO)

function erroEntrada(message, statusCode = 400) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

const COLS = `id, ligacao_id, roteiro_id, roteiro_versao_id, roteiro_etapa_id, etapa_tipo,
  tipo, texto, origem, usuario_id, client_event_id, registrado_em`

// Validacao PURA (testavel sem banco). Normaliza os campos.
function validarSinal(p = {}) {
  if (!TIPO.has(p.tipo)) throw erroEntrada('tipo de sinal invalido.')
  const origem = p.origem == null ? 'novo_durante_ligacao' : String(p.origem)
  if (!ORIGEM.has(origem)) throw erroEntrada('origem de sinal invalida.')
  const texto = String(p.texto == null ? '' : p.texto).trim()
  if (!texto) throw erroEntrada('texto do sinal obrigatorio.')
  if (p.etapaTipo != null && p.etapaTipo !== '' && !ETP.has(p.etapaTipo)) throw erroEntrada('etapa_tipo invalido.')
  return { tipo: p.tipo, origem, texto: texto.slice(0, 300), etapaTipo: p.etapaTipo || null }
}

// Guard de chamada aberta: fonte unica em ./ligacao-sessao-guard.js (antes era uma copia
// local que so olhava o status e por isso aceitava sinal DEPOIS do fim da chamada).

async function registrarSinal(pool, empresaId, ligacaoId, p = {}) {
  const s = validarSinal(p)
  await assertChamadaAberta(pool, empresaId, ligacaoId)
  await assertMesmaEmpresa(pool, { schema: 'app', table: 'roteiro_versoes', id: p.roteiroVersaoId, empresaId, rotulo: 'Versao do roteiro' })
  await assertMesmaEmpresa(pool, { schema: 'app', table: 'roteiro_etapas', id: p.roteiroEtapaId, empresaId, rotulo: 'Etapa do roteiro' })

  // Idempotencia: mesmo client_event_id => devolve o mesmo sinal.
  if (p.clientEventId) {
    const { rows } = await pool.query(
      `SELECT ${COLS} FROM app.ligacao_sinais WHERE empresa_id = $1 AND client_event_id = $2`,
      [empresaId, p.clientEventId])
    if (rows[0]) return { ...rows[0], idempotente: true }
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO app.ligacao_sinais
         (empresa_id, ligacao_id, roteiro_id, roteiro_versao_id, roteiro_etapa_id, etapa_tipo,
          tipo, texto, origem, usuario_id, client_event_id)
       VALUES ($1,$2,
         (SELECT roteiro_id FROM app.roteiro_versoes WHERE id = $3 AND empresa_id = $1),
         $3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING ${COLS}`,
      [empresaId, ligacaoId, p.roteiroVersaoId || null, p.roteiroEtapaId || null, s.etapaTipo,
        s.tipo, s.texto, s.origem, p.usuarioId || null, p.clientEventId || null])
    return { ...rows[0], idempotente: false }
  } catch (e) {
    if (e && e.code === '23505' && p.clientEventId) {
      const { rows } = await pool.query(
        `SELECT ${COLS} FROM app.ligacao_sinais WHERE empresa_id = $1 AND client_event_id = $2`,
        [empresaId, p.clientEventId])
      if (rows[0]) return { ...rows[0], idempotente: true }
    }
    throw e
  }
}

// Sinais ATIVOS (nao removidos) de uma ligacao — reconstrucao da selecao / recuperacao.
async function listarSinais(pool, empresaId, ligacaoId) {
  if (!ligacaoId) throw erroEntrada('ligacao_id obrigatorio.')
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM app.ligacao_sinais
      WHERE empresa_id = $1 AND ligacao_id = $2 AND removido_em IS NULL
      ORDER BY registrado_em ASC`, [empresaId, ligacaoId])
  return rows
}

// Desmarcar = soft-remove (correcao). Idempotente.
async function removerSinal(pool, empresaId, ligacaoId, sinalId) {
  if (!sinalId) throw erroEntrada('id do sinal obrigatorio.')
  const { rows } = await pool.query(
    `UPDATE app.ligacao_sinais SET removido_em = NOW()
      WHERE id = $1 AND ligacao_id = $2 AND empresa_id = $3 AND removido_em IS NULL
      RETURNING id`, [sinalId, ligacaoId, empresaId])
  if (!rows[0]) {
    const chk = await pool.query(
      `SELECT id FROM app.ligacao_sinais WHERE id = $1 AND ligacao_id = $2 AND empresa_id = $3`,
      [sinalId, ligacaoId, empresaId])
    if (!chk.rows[0]) throw erroEntrada('Sinal nao encontrado.', 404)
    return { id: sinalId, ja_removido: true }
  }
  return { id: rows[0].id, removido: true }
}

module.exports = { validarSinal, registrarSinal, listarSinais, removerSinal }
