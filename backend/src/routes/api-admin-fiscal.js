'use strict'

const { Router } = require('express')
const { requireAuth, requireRole } = require('../middleware/tenant')
const fiscalDb = require('../db/fiscal-cnpj')
const CNPJ = require('../services/cnpj-provider')
const { logger } = require('../logger')

const router = Router()
router.use(requireAuth, requireRole('superadmin'))

function erro(res, err, code = 'FISCAL_ADMIN_FAILED') {
  const status = err.statusCode || 500
  if (status >= 500) logger.error(`${code}:`, err.message)
  return res.status(status).json({ ok: false, error: { code: err.code || code, message: err.message } })
}

function corpoBase(req) {
  const b = req.body || {}
  return {
    empresa_id: b.empresa_id || b.empresaId || null,
    prospect_id: b.prospect_id || b.prospectId || null,
    lead_numero: b.lead_numero || b.leadNumero || null,
    origem: b.origem || 'manual',
    nome_informado: CNPJ.limparTexto(b.nome || b.nome_informado || b.nomeInformado || ''),
    cidade_informada: CNPJ.limparTexto(b.cidade || b.cidade_informada || b.cidadeInformada || ''),
    uf_informada: CNPJ.normalizarUf(b.uf || b.uf_informada || b.ufInformada),
    consultado_por: req.usuario?.id || null,
  }
}

router.get('/resumo', async (_req, res) => {
  try {
    return res.json({ ok: true, data: await fiscalDb.resumo() })
  } catch (err) {
    return erro(res, err, 'FISCAL_RESUMO_FAILED')
  }
})

router.get('/cruzamentos', async (req, res) => {
  try {
    const data = await fiscalDb.listarCruzamentos({ status: req.query.status || null, limit: req.query.limit })
    return res.json({ ok: true, data })
  } catch (err) {
    return erro(res, err, 'FISCAL_LIST_FAILED')
  }
})

router.get('/cache', async (req, res) => {
  try {
    const cnpj = req.query.cnpj ? CNPJ.normalizarCnpj(req.query.cnpj, { exigirValido: false }) : null
    if (cnpj) {
      const row = await fiscalDb.buscarCachePorCnpj(cnpj)
      return res.json({ ok: true, data: row ? [row] : [] })
    }
    const data = await fiscalDb.buscarCachePorNome({
      nome: req.query.busca || req.query.nome || '',
      cidade: req.query.cidade || null,
      uf: req.query.uf || null,
      limit: req.query.limit,
    })
    return res.json({ ok: true, data })
  } catch (err) {
    return erro(res, err, 'FISCAL_CACHE_FAILED')
  }
})

router.post('/cruzar', async (req, res) => {
  const base = corpoBase(req)
  let cnpjDigits = null
  try {
    cnpjDigits = CNPJ.normalizarCnpj(req.body?.cnpj || req.body?.cnpj_digits || req.body?.cnpjDigits || null)
    let cache = null
    let custo = 0
    let fonte = 'cache'

    if (cnpjDigits) {
      cache = await fiscalDb.buscarCachePorCnpj(cnpjDigits)
      if (!cache || req.body?.atualizar === true) {
        const consulta = await CNPJ.consultarCnpj(cnpjDigits)
        cache = await fiscalDb.salvarCache(consulta)
        custo = 1
        fonte = consulta.fonte
      }
      const cruzamento = await fiscalDb.registrarCruzamento({
        ...base,
        cnpj_digits: cnpjDigits,
        status: 'encontrado',
        fonte,
        confianca: 100,
        custo_creditos: custo,
        resultado: { cnpj: cache },
      })
      return res.status(custo ? 201 : 200).json({ ok: true, data: { cruzamento, cnpj: cache } })
    }

    if (!base.nome_informado) {
      const e = new Error('Informe CNPJ ou nome da empresa para cruzar.')
      e.statusCode = 400
      e.code = 'FISCAL_INPUT_MISSING'
      throw e
    }

    const matches = await fiscalDb.buscarCachePorNome({
      nome: base.nome_informado,
      cidade: base.cidade_informada,
      uf: base.uf_informada,
      limit: 10,
    })
    const melhor = matches[0] || null
    const confianca = melhor ? CNPJ.calcularConfiancaPorNome(melhor, {
      nome: base.nome_informado,
      cidade: base.cidade_informada,
      uf: base.uf_informada,
    }) : 0
    const cruzamento = await fiscalDb.registrarCruzamento({
      ...base,
      cnpj_digits: melhor?.cnpj_digits || null,
      status: melhor ? 'possivel' : 'sem_resultado',
      fonte: 'cache',
      confianca,
      resultado: { matches },
    })
    return res.status(201).json({ ok: true, data: { cruzamento, matches } })
  } catch (err) {
    const status = err.code === 'CNPJ_PROVIDER_DISABLED' || err.code === 'CNPJ_PROVIDER_UNSUPPORTED' ? 'fonte_indisponivel' : 'erro'
    if (cnpjDigits || base.nome_informado) {
      await fiscalDb.registrarCruzamento({
        ...base,
        cnpj_digits: cnpjDigits,
        status,
        fonte: 'brasilapi',
        confianca: 0,
        erro: err.message,
        resultado: { code: err.code || null },
      }).catch((dbErr) => logger.error({ err: dbErr.message }, '[fiscal] falha ao registrar erro de cruzamento'))
    }
    return erro(res, err, 'FISCAL_CROSS_FAILED')
  }
})

module.exports = router
