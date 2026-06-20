'use strict'
// Canal de E-MAIL para leads sociais (Fase futura — dados já gravados desde agora).
// Os e-mails capturados ficam em prospectador.prospects.email; aqui registramos o
// outreach e, SE houver provider configurado, enviamos via API HTTP (estilo Resend).
//
// Gating (mesmo padrão do WhatsApp/Evolution): sem credencial, o canal fica DESATIVADO
// e nada é enviado — o registro entra como 'desativado' para auditoria.
//
// Env:
//   EMAIL_PROVIDER_API_URL   ex.: https://api.resend.com/emails
//   EMAIL_PROVIDER_API_KEY   token Bearer do provider
//   EMAIL_FROM               remetente verificado (ex.: contato@suaempresa.com)

const { pool } = require('../db')
const { logger } = require('../logger')

function emailConfigurado() {
  return Boolean(
    String(process.env.EMAIL_PROVIDER_API_URL || '').trim() &&
    String(process.env.EMAIL_PROVIDER_API_KEY || '').trim() &&
    String(process.env.EMAIL_FROM || '').trim()
  )
}

async function enviarViaProvider({ para, assunto, corpo }) {
  const url = String(process.env.EMAIL_PROVIDER_API_URL).trim()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Number(process.env.EMAIL_TIMEOUT_MS || 20000))
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${String(process.env.EMAIL_PROVIDER_API_KEY).trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: String(process.env.EMAIL_FROM).trim(),
        to: [para],
        subject: assunto,
        html: corpo,
      }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
  const texto = await res.text()
  let json = null
  try { json = texto ? JSON.parse(texto) : null } catch { json = null }
  if (!res.ok) throw new Error(`email_provider ${res.status}: ${String((json && (json.message || json.error)) || texto).slice(0, 200)}`)
  return (json && (json.id || json.message_id)) || null
}

/**
 * Registra (e tenta enviar) um e-mail para um prospect.
 * Se o canal estiver desativado, grava status 'desativado' e não envia.
 */
async function enviarEmailProspect(empresaId, prospectId, { assunto, corpo } = {}) {
  const { rows } = await pool.query(
    `SELECT id, email FROM prospectador.prospects WHERE empresa_id = $1 AND id = $2::uuid`,
    [empresaId, prospectId]
  )
  const prospect = rows[0]
  if (!prospect) { const e = new Error('Prospect não encontrado.'); e.statusCode = 404; throw e }
  if (!prospect.email) { const e = new Error('Prospect sem e-mail capturado.'); e.statusCode = 422; throw e }

  if (!emailConfigurado()) {
    await pool.query(
      `INSERT INTO prospectador.email_outreach (empresa_id, prospect_id, email, assunto, corpo, status, erro)
       VALUES ($1,$2,$3,$4,$5,'desativado','canal_email_desativado')`,
      [empresaId, prospectId, prospect.email, assunto || null, corpo || null]
    )
    return { ok: false, status: 'desativado', motivo: 'canal_email_desativado' }
  }

  try {
    const providerId = await enviarViaProvider({ para: prospect.email, assunto: assunto || '', corpo: corpo || '' })
    await pool.query(
      `INSERT INTO prospectador.email_outreach (empresa_id, prospect_id, email, assunto, corpo, status, provider_id, enviado_em)
       VALUES ($1,$2,$3,$4,$5,'enviado',$6,NOW())`,
      [empresaId, prospectId, prospect.email, assunto || null, corpo || null, providerId]
    )
    logger.info({ prospectId, providerId }, '[email] enviado')
    return { ok: true, status: 'enviado', provider_id: providerId }
  } catch (err) {
    await pool.query(
      `INSERT INTO prospectador.email_outreach (empresa_id, prospect_id, email, assunto, corpo, status, erro)
       VALUES ($1,$2,$3,$4,$5,'falhou',$6)`,
      [empresaId, prospectId, prospect.email, assunto || null, corpo || null, String(err.message).slice(0, 400)]
    )
    throw err
  }
}

module.exports = { emailConfigurado, enviarEmailProspect }
