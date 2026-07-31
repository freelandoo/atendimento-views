'use strict'
// Objecoes estruturadas registradas DURANTE a ligacao (Fatia E). Espelha ligacao-sinais.js:
// persistencia imediata, isolamento por empresa, so registra em ligacao 'em_andamento',
// idempotente por client_event_id, desmarcar = soft-remove. Extras: resposta_utilizada
// (editavel) e resolvida/resolvida_em (toggle via PATCH).
const { OBJECAO_ORIGEM, ROTEIRO_ETAPA_TIPO } = require('../domain-enums')
const { assertMesmaEmpresa } = require('./campanhas')
const { assertChamadaAberta } = require('./ligacao-sessao-guard')

const ORIGEM = new Set(OBJECAO_ORIGEM)
const ETP = new Set(ROTEIRO_ETAPA_TIPO)

function erroEntrada(message, statusCode = 400) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

const COLS = `id, ligacao_id, roteiro_id, roteiro_versao_id, roteiro_etapa_id, objecao_roteiro_id,
  etapa_tipo, texto_objecao, resposta_utilizada, origem, usuario_id, client_event_id,
  registrada_em, resolvida, resolvida_em`

// Validacao PURA (testavel sem banco).
function validarObjecao(p = {}) {
  const origem = p.origem == null ? 'novo_durante_ligacao' : String(p.origem)
  if (!ORIGEM.has(origem)) throw erroEntrada('origem de objecao invalida.')
  const texto = String(p.texto == null ? '' : p.texto).trim()
  if (!texto) throw erroEntrada('texto da objecao obrigatorio.')
  if (p.etapaTipo != null && p.etapaTipo !== '' && !ETP.has(p.etapaTipo)) throw erroEntrada('etapa_tipo invalido.')
  const resp = p.respostaUtilizada == null ? '' : String(p.respostaUtilizada).trim()
  return {
    origem, texto: texto.slice(0, 500), etapaTipo: p.etapaTipo || null,
    respostaUtilizada: resp ? resp.slice(0, 1000) : null,
  }
}

// Guard de chamada aberta: fonte unica em ./ligacao-sessao-guard.js (antes era uma copia
// local que so olhava o status e por isso aceitava objecao DEPOIS do fim da chamada).

async function registrarObjecao(pool, empresaId, ligacaoId, p = {}) {
  const o = validarObjecao(p)
  await assertChamadaAberta(pool, empresaId, ligacaoId)
  await assertMesmaEmpresa(pool, { schema: 'app', table: 'roteiro_versoes', id: p.roteiroVersaoId, empresaId, rotulo: 'Versao do roteiro' })
  await assertMesmaEmpresa(pool, { schema: 'app', table: 'roteiro_etapas', id: p.roteiroEtapaId, empresaId, rotulo: 'Etapa do roteiro' })

  if (p.clientEventId) {
    const { rows } = await pool.query(
      `SELECT ${COLS} FROM app.ligacao_objecoes WHERE empresa_id = $1 AND client_event_id = $2`,
      [empresaId, p.clientEventId])
    if (rows[0]) return { ...rows[0], idempotente: true }
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO app.ligacao_objecoes
         (empresa_id, ligacao_id, roteiro_id, roteiro_versao_id, roteiro_etapa_id, objecao_roteiro_id,
          etapa_tipo, texto_objecao, resposta_utilizada, origem, usuario_id, client_event_id)
       VALUES ($1,$2,
         (SELECT roteiro_id FROM app.roteiro_versoes WHERE id = $3 AND empresa_id = $1),
         $3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING ${COLS}`,
      [empresaId, ligacaoId, p.roteiroVersaoId || null, p.roteiroEtapaId || null, p.objecaoRoteiroId || null,
        o.etapaTipo, o.texto, o.respostaUtilizada, o.origem, p.usuarioId || null, p.clientEventId || null])
    return { ...rows[0], idempotente: false }
  } catch (e) {
    if (e && e.code === '23505' && p.clientEventId) {
      const { rows } = await pool.query(
        `SELECT ${COLS} FROM app.ligacao_objecoes WHERE empresa_id = $1 AND client_event_id = $2`,
        [empresaId, p.clientEventId])
      if (rows[0]) return { ...rows[0], idempotente: true }
    }
    throw e
  }
}

async function listarObjecoes(pool, empresaId, ligacaoId) {
  if (!ligacaoId) throw erroEntrada('ligacao_id obrigatorio.')
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM app.ligacao_objecoes
      WHERE empresa_id = $1 AND ligacao_id = $2 AND removida_em IS NULL
      ORDER BY registrada_em ASC`, [empresaId, ligacaoId])
  return rows
}

// Atualiza resposta_utilizada e/ou resolvida. resolvida_em acompanha a flag (idempotente:
// so seta o horario na PRIMEIRA vez que resolve; limpa ao desmarcar como resolvida).
async function atualizarObjecao(pool, empresaId, ligacaoId, objecaoId, patch = {}) {
  if (!objecaoId) throw erroEntrada('id da objecao obrigatorio.')
  const campos = []
  const params = [objecaoId, ligacaoId, empresaId]
  const set = (col, val) => { params.push(val); campos.push(`${col} = $${params.length}`) }
  if (patch.respostaUtilizada !== undefined) {
    const r = patch.respostaUtilizada == null ? '' : String(patch.respostaUtilizada).trim()
    set('resposta_utilizada', r ? r.slice(0, 1000) : null)
  }
  if (patch.resolvida !== undefined) {
    const resolvida = !!patch.resolvida
    set('resolvida', resolvida)
    campos.push(resolvida ? 'resolvida_em = COALESCE(resolvida_em, NOW())' : 'resolvida_em = NULL')
  }
  if (!campos.length) throw erroEntrada('Nada para atualizar.')
  const { rows } = await pool.query(
    `UPDATE app.ligacao_objecoes SET ${campos.join(', ')}
      WHERE id = $1 AND ligacao_id = $2 AND empresa_id = $3 AND removida_em IS NULL
      RETURNING ${COLS}`, params)
  if (!rows[0]) throw erroEntrada('Objecao nao encontrada.', 404)
  return rows[0]
}

// Desmarcar = soft-remove (correcao). Idempotente.
async function removerObjecao(pool, empresaId, ligacaoId, objecaoId) {
  if (!objecaoId) throw erroEntrada('id da objecao obrigatorio.')
  const { rows } = await pool.query(
    `UPDATE app.ligacao_objecoes SET removida_em = NOW()
      WHERE id = $1 AND ligacao_id = $2 AND empresa_id = $3 AND removida_em IS NULL
      RETURNING id`, [objecaoId, ligacaoId, empresaId])
  if (!rows[0]) {
    const chk = await pool.query(
      `SELECT id FROM app.ligacao_objecoes WHERE id = $1 AND ligacao_id = $2 AND empresa_id = $3`,
      [objecaoId, ligacaoId, empresaId])
    if (!chk.rows[0]) throw erroEntrada('Objecao nao encontrada.', 404)
    return { id: objecaoId, ja_removida: true }
  }
  return { id: rows[0].id, removida: true }
}

module.exports = { validarObjecao, registrarObjecao, listarObjecoes, atualizarObjecao, removerObjecao }
