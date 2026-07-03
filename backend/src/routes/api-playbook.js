'use strict'

// Gera o "Playbook de Atendimento" a partir de um token da API de Dados da
// Freelandoo (flnd_data_...). O backend orquestra: valida o token, coleta os
// endpoints em paralelo, agrega e chama a LLM. O token NÃO é logado nem persistido
// — vive só no corpo da requisição.

const { Router } = require('express')
const { pool } = require('../db')
const { logger } = require('../logger')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const { FreelandooError } = require('../freelandoo/client')
const { TOKEN_PREFIXO } = require('../freelandoo/data-client')
const { gerarPlaybook } = require('../services/playbook-freelandoo')

const router = Router({ mergeParams: true })

// POST /gerar { token, base_url? } → { markdown, username, gerado_em, avisos, ... }
router.post('/gerar', requireAuth, requireEmpresaAccess, async (req, res) => {
  const token = String(req.body?.token || '').trim()
  const baseUrl = String(req.body?.base_url || '').trim() || undefined

  if (!token) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: `Cole o token da API de Dados (${TOKEN_PREFIXO}...).` } })
  }
  if (!token.startsWith(TOKEN_PREFIXO)) {
    return res.status(400).json({ ok: false, error: { code: 'TOKEN_FORMATO', message: `O token precisa começar com "${TOKEN_PREFIXO}".` } })
  }

  try {
    const resultado = await gerarPlaybook({
      token,
      baseUrl,
      empresaId: req.empresa.id,
      pool,
      log: logger,
    })
    return res.json({ ok: true, data: resultado })
  } catch (err) {
    if (err instanceof FreelandooError) {
      if (err.status === 401) {
        return res.status(401).json({ ok: false, error: { code: 'TOKEN_INVALIDO', message: 'Token inválido ou revogado.' } })
      }
      if (err.status === 403) {
        return res.status(403).json({ ok: false, error: { code: 'ESCOPO', message: err.message || 'Recurso desligado ou token do tipo errado.' } })
      }
      if (err.status === 429) {
        if (Number.isFinite(err.retryAfter)) res.set('Retry-After', String(err.retryAfter))
        return res.status(429).json({ ok: false, error: { code: 'RATE_LIMIT', message: 'Limite de requisições atingido. Tente novamente em instantes.', retry_after: err.retryAfter } })
      }
      // Sem logar o token: só a mensagem do erro.
      logger.warn({ err: err.message, code: err.code }, 'Playbook: falha ao coletar dados da Freelandoo')
      return res.status(502).json({ ok: false, error: { code: 'FREELANDOO_INDISPONIVEL', message: 'Não consegui falar com a Freelandoo agora. Tente de novo.' } })
    }
    logger.error({ err: err.message }, 'Playbook: erro inesperado ao gerar')
    return res.status(500).json({ ok: false, error: { code: 'ERRO_INTERNO', message: 'Falha ao gerar o playbook.' } })
  }
})

module.exports = router
