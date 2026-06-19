'use strict'
// Estágios por contexto (cards): gerar (genérico), adaptar (ao contexto), salvar,
// ativar/desativar (só 1 ativo por empresa) e thumbnail. JWT por empresa.
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const { logger } = require('../logger')
const estagiosSvc = require('../services/contexto-estagios')
const geracaoCompleta = require('../services/geracao-completa')
const geracaoSimulacao = require('../services/geracao-simulacao')

const router = Router({ mergeParams: true })

const THUMB_MAX_CHARS = 700_000 // ~500KB em base64

router.use(requireAuth, requireEmpresaAccess)

async function carregarContexto(req, res, next) {
  try {
    const ctx = await estagiosSvc.getContextoComEstagios(pool, req.empresa.id, req.params.contextoId)
    if (!ctx) {
      return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Contexto não encontrado.' } })
    }
    req.contexto = ctx
    next()
  } catch (err) {
    logger.error({ err: err.message }, 'api-contexto-estagios: carregarContexto')
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Erro interno.' } })
  }
}

// GET .../estagios — estágios atuais + meta do card
router.get('/estagios', carregarContexto, async (req, res) => {
  // Bloco de informações: sempre reflete o formulário (mesma fonte que o runtime usa).
  const estagios = estagiosSvc.preencherInformacoesEstagio(req.contexto.estagios_json, req.contexto, { sobrescrever: true })
  return res.json({
    ok: true,
    data: {
      etapas: estagiosSvc.ETAPAS.map((e) => ({ chave: e.chave, label: e.label })),
      estagios,
      vazio: estagiosSvc.estagiosVazios(estagios),
      ativo: !!req.contexto.runtime_ativo,
      thumbnail_url: req.contexto.thumbnail_url || null,
      tem_conhecimento: !!estagiosSvc.montarConhecimentoDoContexto(req.contexto),
    },
  })
})

// POST .../gerar-tudo — fluxo ÚNICO com a LLM de geração: fontes → Contexto 1 →
// estágios (genérico → adaptar → refino com frameworks de venda + auto-crítica) →
// Contexto 2 playbook. Salva estágios e cria versão de playbook (rascunho).
router.post('/gerar-tudo', carregarContexto, async (req, res) => {
  req.setTimeout(600000)
  res.setTimeout(600000)
  try {
    const data = await geracaoCompleta.gerarTudo({
      pool,
      log: logger,
      empresaId: req.empresa.id,
      contextoId: req.contexto.id,
      userId: req.user && req.user.id,
    })
    return res.json({ ok: true, data })
  } catch (err) {
    logger.error({ err: err.message }, 'gerar-tudo')
    return res.status(502).json({ ok: false, error: { code: 'IA_FALHOU', message: err.message || 'Falha ao gerar. Tente de novo.' } })
  }
})

// POST .../simular-refinar — loop "simula lead difícil → modelo de atendimento responde →
// modelo de geração critica e reescreve o estágio". Opcional, roda depois de "Gerar tudo".
// body opcional { etapas: [...] }; default = etapas mais difíceis (diagnostico/objecao/fechamento).
router.post('/simular-refinar', carregarContexto, async (req, res) => {
  req.setTimeout(600000)
  res.setTimeout(600000)
  try {
    const etapas = Array.isArray(req.body && req.body.etapas) ? req.body.etapas : undefined
    const data = await geracaoSimulacao.simularERefinarContexto({
      pool,
      log: logger,
      empresaId: req.empresa.id,
      contextoId: req.contexto.id,
      etapas,
    })
    return res.json({ ok: true, data })
  } catch (err) {
    logger.error({ err: err.message }, 'simular-refinar')
    return res.status(502).json({ ok: false, error: { code: 'IA_FALHOU', message: err.message || 'Falha ao simular. Tente de novo.' } })
  }
})

// POST .../estagios/gerar — gera os 6 estágios GENÉRICOS (estrutura PJ, dados neutros). Não persiste.
// Com { etapa } no body, gera só aquela etapa e devolve os estágios atuais com ela mesclada.
router.post('/estagios/gerar', carregarContexto, async (req, res) => {
  try {
    const etapa = req.body?.etapa
    if (etapa != null) {
      if (!estagiosSvc.CHAVES_FUNIL.includes(etapa)) {
        return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'etapa inválida (o bloco de informações não é gerado por IA).' } })
      }
      const texto = await estagiosSvc.gerarUmaEtapaGenerica({ pool, log: logger, etapa })
      const estagios = estagiosSvc.normalizarEstagios({ ...estagiosSvc.normalizarEstagios(req.contexto.estagios_json), [etapa]: texto })
      return res.json({ ok: true, data: { estagios } })
    }
    const force = req.body?.force === true
    const estagios = await estagiosSvc.gerarEstagiosGenericos({ pool, log: logger, force })
    return res.json({ ok: true, data: { estagios } })
  } catch (err) {
    logger.error({ err: err.message }, 'gerar estágios genéricos')
    return res.status(502).json({ ok: false, error: { code: 'IA_FALHOU', message: 'Falha ao gerar estágios. Tente de novo.' } })
  }
})

// POST .../estagios/importar-pj — traz os estágios ATUAIS da PJ (system-*.md) como base. Não persiste.
// Usado para migrar a PJ (vira um card) ou partir da metodologia real da PJ num contexto novo.
router.post('/estagios/importar-pj', carregarContexto, async (_req, res) => {
  return res.json({ ok: true, data: { estagios: estagiosSvc.estagiosPjReferencia() } })
})

// POST .../estagios/adaptar — adapta os estágios (do body ou genéricos) ao conhecimento do contexto. Não persiste.
// Com { etapa } no body, adapta só aquela etapa e devolve os estágios com ela mesclada.
router.post('/estagios/adaptar', carregarContexto, async (req, res) => {
  try {
    const etapa = req.body?.etapa
    if (etapa != null && !estagiosSvc.CHAVES_FUNIL.includes(etapa)) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'etapa inválida (o bloco de informações não é adaptado por IA).' } })
    }
    let base = estagiosSvc.normalizarEstagios(req.body?.estagios)
    if (estagiosSvc.estagiosVazios(base)) {
      base = estagiosSvc.normalizarEstagios(req.contexto.estagios_json)
    }
    if (estagiosSvc.estagiosVazios(base)) {
      base = await estagiosSvc.gerarEstagiosGenericos({ pool, log: logger })
    }
    const conhecimento = estagiosSvc.montarConhecimentoDoContexto(req.contexto)
    if (!conhecimento.trim()) {
      return res.status(400).json({ ok: false, error: { code: 'SEM_CONHECIMENTO', message: 'Este contexto não tem conhecimento ainda. Preencha o Contexto 1 / fontes antes de adaptar.' } })
    }
    if (etapa != null) {
      let generico = base[etapa]
      if (!generico.trim()) generico = await estagiosSvc.gerarUmaEtapaGenerica({ pool, log: logger, etapa })
      const texto = await estagiosSvc.adaptarUmaEtapa({
        pool, log: logger, empresaId: req.empresa.id, contextoId: req.contexto.id, etapa, generico, conhecimento,
      })
      const estagios = estagiosSvc.normalizarEstagios({ ...base, [etapa]: texto })
      return res.json({ ok: true, data: { estagios } })
    }
    const estagios = await estagiosSvc.adaptarEstagios({
      pool, log: logger, empresaId: req.empresa.id, contextoId: req.contexto.id, estagios: base, conhecimento,
    })
    return res.json({ ok: true, data: { estagios } })
  } catch (err) {
    logger.error({ err: err.message }, 'adaptar estágios')
    return res.status(502).json({ ok: false, error: { code: 'IA_FALHOU', message: 'Falha ao adaptar estágios. Tente de novo.' } })
  }
})

// PUT .../estagios — salva os 6 estágios no contexto
router.put('/estagios', carregarContexto, async (req, res) => {
  const estagios = req.body?.estagios
  if (!estagios || typeof estagios !== 'object') {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'estagios obrigatório.' } })
  }
  try {
    const saved = await estagiosSvc.salvarEstagiosNoContexto(pool, req.empresa.id, req.contexto.id, estagios)
    return res.json({ ok: true, data: { estagios: estagiosSvc.normalizarEstagios(saved.estagios_json), ativo: !!saved.ativo } })
  } catch (err) {
    logger.error({ err: err.message }, 'salvar estágios')
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Erro ao salvar.' } })
  }
})

// POST .../ativar — ativa este contexto (desativa os demais da empresa)
router.post('/ativar', carregarContexto, async (req, res) => {
  const estagios = estagiosSvc.normalizarEstagios(req.contexto.estagios_json)
  if (estagiosSvc.estagiosVazios(estagios)) {
    return res.status(400).json({ ok: false, error: { code: 'SEM_ESTAGIOS', message: 'Gere e salve os estágios deste contexto antes de ativar.' } })
  }
  try {
    const ctx = await estagiosSvc.ativarContexto(pool, req.empresa.id, req.contexto.id)
    return res.json({ ok: true, data: { ativo: !!ctx.ativo } })
  } catch (err) {
    logger.error({ err: err.message }, 'ativar contexto')
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Erro ao ativar.' } })
  }
})

// POST .../desativar
router.post('/desativar', carregarContexto, async (req, res) => {
  try {
    const ctx = await estagiosSvc.desativarContexto(pool, req.empresa.id, req.contexto.id)
    return res.json({ ok: true, data: { ativo: !!ctx.ativo } })
  } catch (err) {
    logger.error({ err: err.message }, 'desativar contexto')
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Erro ao desativar.' } })
  }
})

// PUT .../thumbnail — { thumbnail_url } (URL ou data URI base64)
router.put('/thumbnail', carregarContexto, async (req, res) => {
  const thumb = req.body?.thumbnail_url
  if (thumb != null && typeof thumb !== 'string') {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'thumbnail_url inválido.' } })
  }
  if (typeof thumb === 'string' && thumb.length > THUMB_MAX_CHARS) {
    return res.status(400).json({ ok: false, error: { code: 'THUMB_GRANDE', message: 'Imagem muito grande (máx ~500KB).' } })
  }
  try {
    const { rows: [ctx] } = await pool.query(
      `UPDATE app.empresa_contextos SET thumbnail_url = $3, atualizado_em = NOW()
        WHERE id = $1 AND empresa_id = $2 RETURNING id, thumbnail_url`,
      [req.contexto.id, req.empresa.id, thumb || null]
    )
    return res.json({ ok: true, data: { thumbnail_url: ctx.thumbnail_url } })
  } catch (err) {
    logger.error({ err: err.message }, 'salvar thumbnail')
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Erro ao salvar thumbnail.' } })
  }
})

module.exports = router
