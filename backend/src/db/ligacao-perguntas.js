'use strict'
// Perguntas do roteiro marcadas como FEITAS durante a ligacao (Fatia C). Espelha
// ligacao-sinais.js: persistencia imediata, isolamento por empresa, so em ligacao
// 'em_andamento', idempotente por client_event_id. Diferencas: (1) so vem do roteiro
// (sem criacao na hora); (2) preserva texto_no_momento (versao usada); (3) desmarcar NAO
// apaga — vira status 'desmarcada' (correcao auditavel).
const { ROTEIRO_ETAPA_TIPO } = require('../domain-enums')
const { assertMesmaEmpresa } = require('./campanhas')
const { assertChamadaAberta } = require('./ligacao-sessao-guard')

const ETP = new Set(ROTEIRO_ETAPA_TIPO)

function erroEntrada(message, statusCode = 400) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

const COLS = `id, ligacao_id, roteiro_id, roteiro_versao_id, roteiro_etapa_id, etapa_tipo,
  pergunta_indice, texto_no_momento, status, usuario_id, client_event_id, realizada_em, desmarcada_em`

// Validacao PURA (testavel sem banco).
function validarPergunta(p = {}) {
  const texto = String(p.texto == null ? '' : p.texto).trim()
  if (!texto) throw erroEntrada('texto da pergunta obrigatorio.')
  if (p.etapaTipo != null && p.etapaTipo !== '' && !ETP.has(p.etapaTipo)) throw erroEntrada('etapa_tipo invalido.')
  const idx = p.perguntaIndice
  if (idx != null && (!Number.isInteger(idx) || idx < 0)) throw erroEntrada('pergunta_indice invalido.')
  return { texto: texto.slice(0, 500), etapaTipo: p.etapaTipo || null, perguntaIndice: Number.isInteger(idx) ? idx : null }
}

// Guard de chamada aberta: fonte unica em ./ligacao-sessao-guard.js (antes era uma copia
// local que so olhava o status e por isso aceitava pergunta DEPOIS do fim da chamada).

// Marca uma pergunta como feita (status 'realizada'). Idempotente por client_event_id.
async function registrarPergunta(pool, empresaId, ligacaoId, p = {}) {
  const q = validarPergunta(p)
  await assertChamadaAberta(pool, empresaId, ligacaoId)
  await assertMesmaEmpresa(pool, { schema: 'app', table: 'roteiro_versoes', id: p.roteiroVersaoId, empresaId, rotulo: 'Versao do roteiro' })
  await assertMesmaEmpresa(pool, { schema: 'app', table: 'roteiro_etapas', id: p.roteiroEtapaId, empresaId, rotulo: 'Etapa do roteiro' })

  if (p.clientEventId) {
    const { rows } = await pool.query(
      `SELECT ${COLS} FROM app.ligacao_perguntas WHERE empresa_id = $1 AND client_event_id = $2`,
      [empresaId, p.clientEventId])
    if (rows[0]) return { ...rows[0], idempotente: true }
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO app.ligacao_perguntas
         (empresa_id, ligacao_id, roteiro_id, roteiro_versao_id, roteiro_etapa_id, etapa_tipo,
          pergunta_indice, texto_no_momento, status, usuario_id, client_event_id)
       VALUES ($1,$2,
         (SELECT roteiro_id FROM app.roteiro_versoes WHERE id = $3 AND empresa_id = $1),
         $3,$4,$5,$6,$7,'realizada',$8,$9)
       RETURNING ${COLS}`,
      [empresaId, ligacaoId, p.roteiroVersaoId || null, p.roteiroEtapaId || null, q.etapaTipo,
        q.perguntaIndice, q.texto, p.usuarioId || null, p.clientEventId || null])
    return { ...rows[0], idempotente: false }
  } catch (e) {
    if (e && e.code === '23505' && p.clientEventId) {
      const { rows } = await pool.query(
        `SELECT ${COLS} FROM app.ligacao_perguntas WHERE empresa_id = $1 AND client_event_id = $2`,
        [empresaId, p.clientEventId])
      if (rows[0]) return { ...rows[0], idempotente: true }
    }
    throw e
  }
}

// Perguntas MARCADAS (status realizada) da ligacao — reconstrucao da selecao / recuperacao.
async function listarPerguntas(pool, empresaId, ligacaoId) {
  if (!ligacaoId) throw erroEntrada('ligacao_id obrigatorio.')
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM app.ligacao_perguntas
      WHERE empresa_id = $1 AND ligacao_id = $2 AND status = 'realizada'
      ORDER BY realizada_em ASC`, [empresaId, ligacaoId])
  return rows
}

// Desmarcar = status 'desmarcada' (correcao; NAO apaga a linha). Idempotente.
async function removerPergunta(pool, empresaId, ligacaoId, perguntaId) {
  if (!perguntaId) throw erroEntrada('id da pergunta obrigatorio.')
  const { rows } = await pool.query(
    `UPDATE app.ligacao_perguntas SET status = 'desmarcada', desmarcada_em = NOW()
      WHERE id = $1 AND ligacao_id = $2 AND empresa_id = $3 AND status = 'realizada'
      RETURNING id`, [perguntaId, ligacaoId, empresaId])
  if (!rows[0]) {
    const chk = await pool.query(
      `SELECT id FROM app.ligacao_perguntas WHERE id = $1 AND ligacao_id = $2 AND empresa_id = $3`,
      [perguntaId, ligacaoId, empresaId])
    if (!chk.rows[0]) throw erroEntrada('Pergunta nao encontrada.', 404)
    return { id: perguntaId, ja_desmarcada: true }
  }
  return { id: rows[0].id, desmarcada: true }
}

module.exports = { validarPergunta, registrarPergunta, listarPerguntas, removerPergunta }
