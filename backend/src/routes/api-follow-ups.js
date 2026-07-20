'use strict'
// Pagina de Follow-ups (Fase 1) — API multi-tenant. Admin-only (o mount em index.js
// aplica requireAuth + requireRole('admin')). Aqui cada rota reforca requireEmpresaAccess.
//   Config:   GET/PUT /config
//   Auto:     GET /auto (timeline + resumo), POST /auto/reprocessar, POST /auto/cancelar
//   Semi:     GET /call-list (fila de Atendimento humano), POST /roteiro de ligacao
//   Manual:   POST /manual/gerar (preview, nao envia), POST /manual/enviar
// REUSA os servicos: nenhuma regra de negocio nova mora aqui.
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const {
  obterConfigFollowup,
  salvarConfigFollowup,
  MODOS,
  META_MIN,
  META_MAX,
} = require('../db/followup-config')
const {
  listarAgendamentosAuto,
  resumoAgendamentosAuto,
  reprocessarFalhas,
  cancelarPorLead,
  montarCallList,
} = require('../services/followup-listing')
const {
  gerarRoteiroLigacao,
  gerarPreviewFollowup,
  enviarFollowupTexto,
} = require('../services/followup-manual')
const {
  registrarLigacao,
  listarLigacoesLead,
  metricasLigacoes,
  validarEnvioAposLigacao,
} = require('../db/followup-ligacoes')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

function erro(res, err, code = 'FOLLOWUP_FAILED', status = err?.statusCode || 500) {
  logger.error({ err: err?.message, code }, '[api-follow-ups] falha')
  const message = status >= 500
    ? 'Nao foi possivel concluir a operacao de follow-up.'
    : (err?.message || 'Dados invalidos.')
  return res.status(status).json({ ok: false, error: { code, message } })
}

function erroValidacao(message) {
  const err = new Error(message)
  err.statusCode = 400
  return err
}

function validarNumeroEntrada(value) {
  const numero = String(value || '').trim()
  if (!numero) throw erroValidacao('numero e obrigatorio.')
  if (numero.length > 80 || /[\r\n\t]/.test(numero)) throw erroValidacao('numero invalido.')
  if (/@g\.us$|@broadcast$/i.test(numero)) throw erroValidacao('numero invalido para contato individual.')
  if (/@/.test(numero) && !/@(?:s\.whatsapp\.net|lid)$/i.test(numero)) throw erroValidacao('numero invalido.')
  const digitos = numero.replace(/\D/g, '')
  if (digitos.length < 8 || digitos.length > 15) throw erroValidacao('numero invalido.')
  return numero
}

function validarTextoEntrada(value, campo, max, obrigatorio = false) {
  const texto = String(value ?? '').trim()
  if (obrigatorio && !texto) throw erroValidacao(`${campo} e obrigatorio.`)
  if (texto.length > max) throw erroValidacao(`${campo} excede o limite de ${max} caracteres.`)
  return texto
}

function validarPatchConfig(body = {}) {
  if (body.modo !== undefined && !MODOS.has(body.modo)) throw erroValidacao('modo invalido.')
  if (body.meta_ligacoes_dia !== undefined) {
    const meta = Number(body.meta_ligacoes_dia)
    if (!Number.isInteger(meta) || meta < META_MIN || meta > META_MAX) {
      throw erroValidacao(`meta_ligacoes_dia deve estar entre ${META_MIN} e ${META_MAX}.`)
    }
  }
  if (body.pausado !== undefined && typeof body.pausado !== 'boolean') throw erroValidacao('pausado deve ser booleano.')
}

// --- CONFIG ----------------------------------------------------------------------
router.get('/config', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await obterConfigFollowup(pool, req.empresa.id)
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'CONFIG_FAILED') }
})

// PUT /config — upsert parcial: { modo, meta_ligacoes_dia, pausado }.
router.put('/config', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const b = req.body || {}
    validarPatchConfig(b)
    const patch = {}
    for (const campo of ['modo', 'meta_ligacoes_dia', 'pausado']) {
      if (b[campo] !== undefined) patch[campo] = b[campo]
    }
    const data = await salvarConfigFollowup(pool, req.empresa.id, patch)
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'CONFIG_UPDATE_FAILED') }
})

// --- AUTOMATICO ------------------------------------------------------------------
router.get('/auto', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const [itens, resumo] = await Promise.all([
      listarAgendamentosAuto(pool, req.empresa.id, { status: req.query.status, limit: req.query.limit }),
      resumoAgendamentosAuto(pool, req.empresa.id),
    ])
    return res.json({ ok: true, data: { itens, resumo } })
  } catch (err) { return erro(res, err, 'AUTO_LIST_FAILED') }
})

// POST /auto/reprocessar — re-enfileira follow-ups que falharam (todos ou um id).
router.post('/auto/reprocessar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const out = await reprocessarFalhas(pool, req.empresa.id, { agendamentoId: req.body?.agendamento_id })
    return res.json({ ok: true, data: out })
  } catch (err) { return erro(res, err, 'AUTO_REPROCESS_FAILED') }
})

// POST /auto/cancelar — cancela os follow-ups agendados de um lead.
router.post('/auto/cancelar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const numero = validarNumeroEntrada(req.body?.numero)
    const out = await cancelarPorLead(pool, req.empresa.id, numero)
    return res.json({ ok: true, data: out })
  } catch (err) { return erro(res, err, 'AUTO_CANCEL_FAILED') }
})

// --- SEMI (fila de proxima acao humana) -----------------------------------------
router.get('/call-list', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const [lista, config] = await Promise.all([
      montarCallList(pool, req.empresa.id, { limit: req.query.limit }),
      obterConfigFollowup(pool, req.empresa.id),
    ])
    return res.json({ ok: true, data: { lista, meta_ligacoes_dia: config.meta_ligacoes_dia } })
  } catch (err) { return erro(res, err, 'CALLLIST_FAILED') }
})

// POST /roteiro — gera o briefing de ligacao por IA (read-only, nao envia).
router.post('/roteiro', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const numero = validarNumeroEntrada(req.body?.numero)
    const motivo = validarTextoEntrada(req.body?.motivo, 'motivo', 300)
    const out = await gerarRoteiroLigacao({ pool, empresaId: req.empresa.id, numero, motivo })
    return res.json({ ok: true, data: out })
  } catch (err) { return erro(res, err, 'ROTEIRO_FAILED') }
})

// --- LIGACOES (Fase 2) -----------------------------------------------------------
// POST /ligacoes — registra o resultado de uma ligacao. Efeitos: sem_interesse pausa
// o auto follow-up do lead (no db module); enviar_followup=true dispara um follow-up
// no WhatsApp (util quando nao_atendeu) reusando o Manual (gerar + enviar).
router.post('/ligacoes', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const b = req.body || {}
    const numero = validarNumeroEntrada(b.numero)
    const notas = validarTextoEntrada(b.notas, 'notas', 2000)
    validarEnvioAposLigacao(b.resultado, b.enviar_followup)
    const registro = await registrarLigacao(pool, {
      empresaId: req.empresa.id, numero, resultado: b.resultado, notas, usuarioId: req.usuario?.id,
    })
    let followup = null
    let followupErro = null
    if (b.enviar_followup === true) {
      try {
        const preview = await gerarPreviewFollowup({ pool, empresaId: req.empresa.id, numero })
        followup = await enviarFollowupTexto({ pool, empresaId: req.empresa.id, numero, texto: preview.texto })
      } catch (sendErr) {
        followupErro = 'Ligacao registrada, mas o follow-up no WhatsApp nao foi enviado.'
        logger.warn({ err: sendErr?.message, empresa_id: req.empresa.id }, '[api-follow-ups] ligacao salva; envio complementar falhou')
      }
    }
    return res.json({ ok: true, data: { registro, followup, followup_erro: followupErro } })
  } catch (err) { return erro(res, err, 'LIGACAO_FAILED') }
})

// GET /ligacoes?numero=… — historico de ligacoes de um lead.
router.get('/ligacoes', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const numero = validarNumeroEntrada(req.query.numero)
    const data = await listarLigacoesLead(pool, req.empresa.id, numero, req.query.limit)
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'LIGACOES_LIST_FAILED') }
})

// GET /metricas?dias=30 — metricas das ligacoes (total, por resultado, taxa de agendamento).
router.get('/metricas', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await metricasLigacoes(pool, req.empresa.id, req.query.dias)
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'METRICAS_FAILED') }
})

// --- MANUAL ----------------------------------------------------------------------
// POST /manual/gerar — gera o preview do follow-up por IA (NAO envia).
router.post('/manual/gerar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const numero = validarNumeroEntrada(req.body?.numero)
    const out = await gerarPreviewFollowup({ pool, empresaId: req.empresa.id, numero })
    return res.json({ ok: true, data: out })
  } catch (err) { return erro(res, err, 'MANUAL_GEN_FAILED') }
})

// POST /manual/enviar — envia o texto (possivelmente editado pelo operador).
router.post('/manual/enviar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const numero = validarNumeroEntrada(req.body?.numero)
    const texto = validarTextoEntrada(req.body?.texto, 'texto', 4096, true)
    const out = await enviarFollowupTexto({ pool, empresaId: req.empresa.id, numero, texto })
    return res.json({ ok: true, data: out })
  } catch (err) { return erro(res, err, 'MANUAL_SEND_FAILED') }
})

router._internals = { validarNumeroEntrada, validarTextoEntrada, validarPatchConfig }

module.exports = router
