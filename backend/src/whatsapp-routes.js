const axios = require('axios')
const { pool } = require('./db')
const { logger } = require('./logger')

const EVOLUTION_URL = process.env.EVOLUTION_URL || 'http://evolution-api:8080'
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY

async function getWhatsappStatus(userId) {
  const { rows } = await pool.query(
    `SELECT id, status, phone_number, profile_name, connected_at, qr_code, qr_expires_at
     FROM vendas.whatsapp_connections
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY updated_at DESC LIMIT 1`,
    [userId]
  )

  if (rows.length === 0) {
    return { status: 'disconnected' }
  }

  const record = rows[0]
  const response = {
    status: record.status,
    phone_number: record.phone_number,
    profile_name: record.profile_name,
    connected_at: record.connected_at
  }

  if (record.status === 'qr_pending') {
    response.qr_code = record.qr_code
    response.qr_expires_at = record.qr_expires_at
  }

  return response
}

async function registerWhatsappRoutes(app) {
  const { requireDashboardAuth } = require('./dashboardAuth')

  if (!EVOLUTION_KEY) {
    logger.warn('⚠️  WhatsApp routes registered but EVOLUTION_API_KEY is not configured')
  }

  // GET /dashboard/whatsapp/status
  app.get('/dashboard/whatsapp/status', requireDashboardAuth, async (req, res) => {
    try {
      const userId = req.dashboardUser.id
      const status = await getWhatsappStatus(userId)
      res.json(status)
    } catch (err) {
      logger.error({ err: err.message }, '[whatsapp/status]')
      res.status(500).json({ error: 'Failed to fetch status' })
    }
  })

  // POST /dashboard/whatsapp/connect
  app.post('/dashboard/whatsapp/connect', requireDashboardAuth, async (req, res) => {
    const client = await pool.connect()
    let txAberta = false
    try {
      if (!EVOLUTION_KEY) {
        return res.status(500).json({ error: 'Configuração de Evolution API não encontrada. Verifique EVOLUTION_API_KEY.' })
      }

      const userId = req.dashboardUser.id
      const instanceName = process.env.EVOLUTION_INSTANCE || 'PJ'

      let qrResponse
      try {
        qrResponse = await axios.get(
          `${EVOLUTION_URL}/instance/connect/${instanceName}`,
          { headers: { 'apikey': EVOLUTION_KEY } }
        )
      } catch (err) {
        logger.error({
          status: err.response?.status,
          messages: err.response?.data?.response?.message,
          data: err.response?.data,
        }, '[whatsapp/connect] instance/connect error')
        throw err
      }

      let qrCode = null
      if (qrResponse.data?.base64) {
        qrCode = qrResponse.data.base64
      } else if (qrResponse.data?.code) {
        qrCode = qrResponse.data.code
      }

      if (!qrCode) {
        return res.status(500).json({ error: 'Failed to generate QR code' })
      }

      const qrExpiresAt = new Date(Date.now() + 90 * 1000).toISOString()

      await client.query('BEGIN')
      txAberta = true

      const existing = await client.query(
        `SELECT id FROM vendas.whatsapp_connections WHERE user_id = $1 AND deleted_at IS NULL`,
        [userId]
      )

      if (existing.rows.length > 0) {
        await client.query(
          `UPDATE vendas.whatsapp_connections
           SET status = $1, qr_code = $2, qr_expires_at = $3, updated_at = NOW()
           WHERE id = $4`,
          ['qr_pending', qrCode, qrExpiresAt, existing.rows[0].id]
        )
      } else {
        await client.query(
          `INSERT INTO vendas.whatsapp_connections
           (user_id, instance_name, status, qr_code, qr_expires_at, metadata)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [userId, instanceName, 'qr_pending', qrCode, qrExpiresAt, '{}']
        )
      }

      await client.query('COMMIT')
      txAberta = false

      res.json({
        status: 'qr_pending',
        qr_code: qrCode,
        qr_expires_at: qrExpiresAt
      })
    } catch (err) {
      if (txAberta) {
        await client.query('ROLLBACK').catch(() => {})
      }
      const messages = err.response?.data?.response?.message
      logger.error({
        message: err.message,
        status: err.response?.status,
        validationMessages: Array.isArray(messages) ? messages : [messages],
        errorResponse: err.response?.data?.error,
      }, '[whatsapp/connect] Error')
      res.status(500).json({ error: err.response?.data?.error || err.message || 'Failed to connect WhatsApp' })
    } finally {
      client.release()
    }
  })

  // POST /dashboard/whatsapp/refresh-qr
  app.post('/dashboard/whatsapp/refresh-qr', requireDashboardAuth, async (req, res) => {
    try {
      if (!EVOLUTION_KEY) {
        return res.status(500).json({ error: 'Configuração de Evolution API não encontrada.' })
      }

      const userId = req.dashboardUser.id
      // Use pre-configured instance
      const instanceName = process.env.EVOLUTION_INSTANCE || 'PJ'

      // Get new QR Code
      const qrResponse = await axios.get(
        `${EVOLUTION_URL}/instance/connect/${instanceName}`,
        { headers: { 'apikey': EVOLUTION_KEY } }
      )

      let qrCode = null
      if (qrResponse.data?.base64) {
        qrCode = qrResponse.data.base64
      } else if (qrResponse.data?.code) {
        qrCode = qrResponse.data.code
      }

      if (!qrCode) {
        return res.status(500).json({ error: 'Failed to generate QR code' })
      }

      const qrExpiresAt = new Date(Date.now() + 90 * 1000).toISOString()

      // Update record
      await pool.query(
        `UPDATE vendas.whatsapp_connections
         SET qr_code = $1, qr_expires_at = $2, updated_at = NOW()
         WHERE user_id = $3 AND deleted_at IS NULL`,
        [qrCode, qrExpiresAt, userId]
      )

      res.json({
        status: 'qr_pending',
        qr_code: qrCode,
        qr_expires_at: qrExpiresAt
      })
    } catch (err) {
      logger.error({ err: err.message }, '[whatsapp/refresh-qr]')
      res.status(500).json({ error: 'Failed to refresh QR code' })
    }
  })

  // POST /dashboard/whatsapp/check-status
  app.post('/dashboard/whatsapp/check-status', requireDashboardAuth, async (req, res) => {
    try {
      if (!EVOLUTION_KEY) {
        return res.status(500).json({ error: 'Configuração de Evolution API não encontrada.' })
      }

      const userId = req.dashboardUser.id
      // Use pre-configured instance
      const instanceName = process.env.EVOLUTION_INSTANCE || 'PJ'

      // Get connection state from Evolution
      const stateResponse = await axios.get(
        `${EVOLUTION_URL}/instance/connectionState/${instanceName}`,
        { headers: { 'apikey': EVOLUTION_KEY } }
      )

      const connectionState = stateResponse.data?.instance?.state

      // If still disconnected, return current status
      if (connectionState !== 'open') {
        const status = await getWhatsappStatus(userId)
        return res.json(status)
      }

      // Connection is open, fetch owner and profile info
      let ownerJid = null
      let profileName = null

      try {
        const instancesResponse = await axios.get(
          `${EVOLUTION_URL}/instance/fetchInstances`,
          { headers: { 'apikey': EVOLUTION_KEY } }
        )

        const instances = instancesResponse.data?.instances || []
        const instance = instances.find(i => i.instanceName === instanceName)

        if (instance) {
          ownerJid = instance.ownerJid || instance.phoneNumber
          profileName = instance.profileName || instance.ownerJid
        }
      } catch (err) {
        logger.warn({ err: err.message }, '[whatsapp/check-status] Could not fetch instances')
      }

      // Extract phone number from ownerJid (format: 5511999999999@s.whatsapp.net)
      let phoneNumber = null
      if (ownerJid && ownerJid.includes('@')) {
        phoneNumber = ownerJid.split('@')[0]
      }

      // Update database
      await pool.query(
        `UPDATE vendas.whatsapp_connections
         SET status = $1, phone_number = $2, profile_name = $3,
             connected_at = NOW(), last_sync_at = NOW(), updated_at = NOW()
         WHERE user_id = $4 AND deleted_at IS NULL`,
        ['connected', phoneNumber, profileName, userId]
      )

      res.json({
        status: 'connected',
        phone_number: phoneNumber,
        profile_name: profileName,
        connected_at: new Date().toISOString()
      })
    } catch (err) {
      logger.error({ err: err.message }, '[whatsapp/check-status]')

      if (err.response?.status === 404) {
        // Instance not found in Evolution, mark as disconnected
        await pool.query(
          `UPDATE vendas.whatsapp_connections
           SET status = $1, disconnected_at = NOW(), updated_at = NOW()
           WHERE user_id = $2 AND deleted_at IS NULL`,
          ['disconnected', req.dashboardUser.id]
        )
        return res.json({ status: 'disconnected' })
      }

      res.status(500).json({ error: 'Failed to check status' })
    }
  })

  // POST /dashboard/whatsapp/disconnect
  app.post('/dashboard/whatsapp/disconnect', requireDashboardAuth, async (req, res) => {
    try {
      if (!EVOLUTION_KEY) {
        return res.status(500).json({ error: 'Configuração de Evolution API não encontrada.' })
      }

      const userId = req.dashboardUser.id
      // Use pre-configured instance
      const instanceName = process.env.EVOLUTION_INSTANCE || 'PJ'

      // Call logout on Evolution — 404 (instância não existe) e 500 (já fechada) são esperados
      try {
        await axios.delete(
          `${EVOLUTION_URL}/instance/logout/${instanceName}`,
          { headers: { 'apikey': EVOLUTION_KEY } }
        )
      } catch (err) {
        const status = err.response?.status
        if (status !== 404 && status !== 500) {
          logger.warn({ err: err.message }, '[whatsapp/disconnect] Evolution logout failed')
        }
      }

      // Update database
      await pool.query(
        `UPDATE vendas.whatsapp_connections
         SET status = $1, disconnected_at = NOW(), updated_at = NOW()
         WHERE user_id = $2 AND deleted_at IS NULL`,
        ['disconnected', userId]
      )

      res.json({ status: 'disconnected' })
    } catch (err) {
      logger.error({ err: err.message }, '[whatsapp/disconnect]')
      res.status(500).json({ error: 'Failed to disconnect WhatsApp' })
    }
  })
}

module.exports = { registerWhatsappRoutes, getWhatsappStatus }
