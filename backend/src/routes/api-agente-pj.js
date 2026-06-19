'use strict'
// API JWT para editar o agente PJ Codeworks (single-tenant): contexto (empresa.md)
// e estágios de resposta (system-*.md). Ponte sobre src/prompts.js (vendas.prompt_overlays),
// que é o que o agente PJ realmente lê. Disponível APENAS para a empresa PJ —
// outras empresas usam o Contexto 2 (playbook) em /api/empresas/:id/contextos.
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const prompts = require('../prompts')
const { logger } = require('../logger')

const PJ_EMPRESA_ID = '00000000-0000-0000-0000-000000000001'

// Chaves expostas nesta tela e seus rótulos amigáveis (ordem = exibição).
const CHAVES_PJ = [
  { chave: 'empresa', label: 'Contexto — conhecimento da empresa', grupo: 'contexto' },
  { chave: 'system-core', label: 'Núcleo — regras gerais do agente', grupo: 'estagio' },
  { chave: 'system-primeiro-contato', label: 'Estágio: Primeiro contato', grupo: 'estagio' },
  { chave: 'system-diagnostico', label: 'Estágio: Diagnóstico', grupo: 'estagio' },
  { chave: 'system-proposta', label: 'Estágio: Proposta', grupo: 'estagio' },
  { chave: 'system-objecao', label: 'Estágio: Objeção', grupo: 'estagio' },
  { chave: 'system-fechamento', label: 'Estágio: Fechamento', grupo: 'estagio' },
]
const CHAVES_PERMITIDAS_PJ = new Set(CHAVES_PJ.map((c) => c.chave))

const router = Router({ mergeParams: true })

// Só a empresa PJ Codeworks acessa esta tela (prompts são single-tenant globais).
function somentePJ(req, res, next) {
  if (req.empresa?.id !== PJ_EMPRESA_ID) {
    return res.status(404).json({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Edição de prompts disponível apenas para a PJ Codeworks. Outras empresas usam Contexto 2.',
      },
    })
  }
  next()
}

function validarChavePJ(req, res, next) {
  if (!CHAVES_PERMITIDAS_PJ.has(req.params.chave)) {
    return res.status(400).json({ ok: false, error: { code: 'CHAVE_INVALIDA', message: 'Chave de prompt inválida.' } })
  }
  next()
}

function mapErroPrompt(err, res) {
  const code = err?.code
  if (['CHAVE_INVALIDA', 'CONTEUDO_VAZIO', 'CONTEUDO_GRANDE', 'VERSION_ID', 'NAO_ENCONTRADO'].includes(code)) {
    const http = code === 'NAO_ENCONTRADO' ? 404 : 400
    return res.status(http).json({ ok: false, error: { code, message: err.message } })
  }
  logger.error({ err: err?.message }, 'api-agente-pj: erro inesperado')
  return res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Erro interno.' } })
}

router.use(requireAuth, requireEmpresaAccess, somentePJ)

// GET /api/empresas/:empresaId/agente-pj/prompts — lista chaves + estado atual
router.get('/prompts', async (_req, res) => {
  try {
    const data = []
    for (const meta of CHAVES_PJ) {
      const atual = await prompts.getPromptAtual(pool, meta.chave)
      data.push({
        chave: meta.chave,
        label: meta.label,
        grupo: meta.grupo,
        origem: atual.origem,
        version: atual.version,
        criado_em: atual.criado_em,
      })
    }
    return res.json({ ok: true, data })
  } catch (err) {
    return mapErroPrompt(err, res)
  }
})

// GET /api/empresas/:empresaId/agente-pj/prompts/:chave — conteúdo + histórico
router.get('/prompts/:chave', validarChavePJ, async (req, res) => {
  try {
    const atual = await prompts.getPromptAtual(pool, req.params.chave)
    const historico = await prompts.listarHistoricoOverlay(pool, req.params.chave).catch(() => [])
    return res.json({ ok: true, data: { atual, historico } })
  } catch (err) {
    return mapErroPrompt(err, res)
  }
})

// PUT /api/empresas/:empresaId/agente-pj/prompts/:chave — salva nova versão
router.put('/prompts/:chave', validarChavePJ, async (req, res) => {
  const { conteudo, autor } = req.body || {}
  try {
    const atual = await prompts.setOverlay(pool, req.params.chave, conteudo, autor || req.usuario?.email || null)
    return res.json({ ok: true, data: atual })
  } catch (err) {
    return mapErroPrompt(err, res)
  }
})

// POST /api/empresas/:empresaId/agente-pj/prompts/:chave/reverter — { versionId }
router.post('/prompts/:chave/reverter', validarChavePJ, async (req, res) => {
  const versionId = req.body?.versionId
  try {
    const atual = await prompts.reverterOverlay(pool, req.params.chave, versionId)
    return res.json({ ok: true, data: atual })
  } catch (err) {
    return mapErroPrompt(err, res)
  }
})

module.exports = router
