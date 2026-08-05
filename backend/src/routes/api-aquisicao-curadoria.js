'use strict'
// Assistente de Oportunidades (por lead) — HTTP.
// Montada sob /api/empresas/:empresaId/prospeccao/curadoria com requireAuth +
// requireRole('admin') (index.js) e requireEmpresaAccess por rota.
//
// Só faz HTTP: as regras de fila/aprendizado vivem em
// services/aquisicao-curadoria-ranking.js, a orquestração em
// services/aquisicao-curadoria.js e o SQL em db/aquisicao-curadoria.js.

const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const {
  obterEstadoAtual,
  iniciarSessao,
  decidirOportunidade,
  ampliarSessao,
  encerrarSessao,
} = require('../services/aquisicao-curadoria')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

function falhar(res, err, code) {
  const status = err.statusCode || 500
  if (status >= 500) logger.error(`${code}:`, err.message)
  return res.status(status).json({ ok: false, error: { code, message: err.message } })
}

// Sessão pertence ao operador que a abriu, dentro da empresa. Os dois escopos são
// aplicados em TODA consulta (empresa no SQL, usuário na chave da sessão).
function contexto(req) {
  return { empresaId: req.empresa.id, usuarioId: req.usuario?.id || null }
}

// GET /api/empresas/:empresaId/prospeccao/curadoria
// Estado atual: existe sessão? qual a oportunidade da vez? Não abre sessão sozinho.
router.get('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await obterEstadoAtual(pool, contexto(req))
    return res.json({ ok: true, data })
  } catch (err) {
    return falhar(res, err, 'CURADORIA_ESTADO_FAILED')
  }
})

// POST /api/empresas/:empresaId/prospeccao/curadoria/sessao  { nicho?, cidade?, uf?, meta }
// Abre a sessão de análise. Nenhuma busca é disparada e nenhum lead é alterado aqui.
router.post('/sessao', requireAuth, requireEmpresaAccess, async (req, res) => {
  const corpo = req.body || {}
  const meta = Number.parseInt(corpo.meta, 10)
  if (!Number.isFinite(meta) || meta < 1 || meta > 200) {
    return res.status(400).json({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'Informe quantos leads novos você quer aprovar (1 a 200).' },
    })
  }
  try {
    const data = await iniciarSessao(pool, {
      ...contexto(req),
      nicho: corpo.nicho,
      cidade: corpo.cidade,
      uf: corpo.uf,
      meta,
    })
    return res.json({ ok: true, data })
  } catch (err) {
    return falhar(res, err, 'CURADORIA_SESSAO_FAILED')
  }
})

// POST /api/empresas/:empresaId/prospeccao/curadoria/decidir
// { prospect_id, decisao: 'aprovado' | 'descartado' }
// Idempotente: repetir a chamada não aprova o lead de novo nem consome a meta.
router.post('/decidir', requireAuth, requireEmpresaAccess, async (req, res) => {
  const corpo = req.body || {}
  const prospectId = String(corpo.prospect_id || '').trim()
  const decisao = String(corpo.decisao || '').trim()
  if (!prospectId || !['aprovado', 'descartado'].includes(decisao)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'Informe prospect_id e decisao (aprovado|descartado).' },
    })
  }
  try {
    const data = await decidirOportunidade(pool, { ...contexto(req), prospectId, decisao })
    return res.json({ ok: true, data })
  } catch (err) {
    return falhar(res, err, 'CURADORIA_DECIDIR_FAILED')
  }
})

// POST /api/empresas/:empresaId/prospeccao/curadoria/ampliar
// "Ampliar a busca": a fila deixa de se limitar ao mercado da sessão.
router.post('/ampliar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await ampliarSessao(pool, contexto(req))
    return res.json({ ok: true, data })
  } catch (err) {
    return falhar(res, err, 'CURADORIA_AMPLIAR_FAILED')
  }
})

// POST /api/empresas/:empresaId/prospeccao/curadoria/encerrar
router.post('/encerrar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await encerrarSessao(pool, contexto(req))
    return res.json({ ok: true, data })
  } catch (err) {
    return falhar(res, err, 'CURADORIA_ENCERRAR_FAILED')
  }
})

module.exports = router
