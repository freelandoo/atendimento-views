'use strict'
// Config da pagina de Follow-ups por EMPRESA (modo + meta de ligacoes + pausa).
// Acesso a banco isolado, como manda a arquitetura. A tabela e criada pela migration
// 029; quando ainda nao ha linha, devolve o default virtual (sem persistir) para o
// GET/boot nunca falhar. Espelha src/db/banco-leads-config.js.
const MODOS = new Set(['manual', 'semi', 'automatico'])

const CAMPOS = 'empresa_id, modo, meta_ligacoes_dia, pausado'

const META_MIN = 1
const META_MAX = 100

function defaultConfig(empresaId) {
  return {
    empresa_id: empresaId,
    modo: 'automatico',
    meta_ligacoes_dia: 12,
    pausado: false,
  }
}

async function obterConfigFollowup(pool, empresaId) {
  const { rows } = await pool.query(
    `SELECT ${CAMPOS} FROM app.followup_config WHERE empresa_id = $1`,
    [empresaId]
  )
  return rows[0] || defaultConfig(empresaId)
}

function clampInt(v, def, lo, hi) {
  const n = Number.parseInt(v, 10)
  if (!Number.isFinite(n)) return def
  return Math.min(Math.max(n, lo), hi)
}

// Upsert parcial: so os campos presentes no patch mudam; o resto preserva o atual.
async function salvarConfigFollowup(pool, empresaId, patch = {}) {
  const atual = await obterConfigFollowup(pool, empresaId)
  const modo = MODOS.has(patch.modo) ? patch.modo : atual.modo
  const metaLigacoesDia = patch.meta_ligacoes_dia === undefined
    ? atual.meta_ligacoes_dia
    : clampInt(patch.meta_ligacoes_dia, atual.meta_ligacoes_dia, META_MIN, META_MAX)
  const pausado = typeof patch.pausado === 'boolean' ? patch.pausado : atual.pausado

  const { rows } = await pool.query(
    `INSERT INTO app.followup_config (empresa_id, modo, meta_ligacoes_dia, pausado)
       VALUES ($1, $2, $3, $4)
     ON CONFLICT (empresa_id) DO UPDATE
       SET modo = EXCLUDED.modo,
           meta_ligacoes_dia = EXCLUDED.meta_ligacoes_dia,
           pausado = EXCLUDED.pausado,
           atualizado_em = NOW()
     RETURNING ${CAMPOS}`,
    [empresaId, modo, metaLigacoesDia, pausado]
  )
  return rows[0]
}

module.exports = { obterConfigFollowup, salvarConfigFollowup, MODOS, defaultConfig, META_MIN, META_MAX }
