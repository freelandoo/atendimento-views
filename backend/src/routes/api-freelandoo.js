'use strict'

// Onboarding e gestão da INSTÂNCIA Freelandoo. A instância vive na mesma tabela
// do WhatsApp (app.empresa_whatsapp_instances) — por isso ganha contexto 1:1,
// "usa agenda?" e o flag ativo de graça, e responde com o MESMO motor (Contexto 2).
// A diferença é o onboarding: em vez de QR Code, o vendedor cola o token da API.
//
// Toggles (ativo/usa_agenda) e o link de contexto usam os endpoints /whatsapp
// existentes (mesma tabela) — aqui só tratamos conectar/listar/remover/reconectar.

const { Router } = require('express')
const crypto = require('crypto')
const { pool } = require('../db')
const { logger } = require('../logger')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const { removerContextoSeOrfao } = require('../db/whatsapp-instances')
const { criarCliente, FreelandooError, BASE_URL_PADRAO } = require('../freelandoo/client')
const {
  salvarConexao, atualizarWebhook, listarConexoesPorEmpresa, buscarConexaoDescriptografada,
} = require('../db/freelandoo')

const router = Router({ mergeParams: true })

function publicBackendUrl() {
  const explicit = process.env.PUBLIC_BACKEND_URL || process.env.BACKEND_URL
  if (explicit) return explicit.replace(/\/+$/, '')
  const rw = process.env.RAILWAY_PUBLIC_DOMAIN
  if (rw) return `https://${rw.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`
  return ''
}

function slugInstance(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 28)
}

function urlWebhookDaInstancia(instanceId) {
  const base = publicBackendUrl()
  if (!base) return null
  return `${base}/freelandoo/webhook/${instanceId}`
}

// Registra (ou re-registra) o webhook na Freelandoo e persiste o segredo cifrado.
async function registrarWebhook(instanceId, cliente) {
  const url = urlWebhookDaInstancia(instanceId)
  if (!url) {
    return { ok: false, motivo: 'sem_url_publica' }
  }
  if (!/^https:\/\//i.test(url)) {
    return { ok: false, motivo: 'url_nao_https' }
  }
  const r = await cliente.setWebhook(url)
  await atualizarWebhook(instanceId, { webhookSecret: r?.webhook_secret, webhookUrl: r?.webhook_url || url })
  return { ok: true, webhook_url: r?.webhook_url || url }
}

// GET — lista as instâncias Freelandoo da empresa (sem segredos).
router.get('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  const rows = await listarConexoesPorEmpresa(req.empresa.id)
  return res.json({ ok: true, data: rows })
})

// POST — conecta uma conta: valida o token (GET /me), cria a instância + contexto,
// salva a conexão cifrada e registra o webhook.
router.post('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  const token = String(req.body?.token || '').trim()
  const nomeAmigavel = String(req.body?.nome || '').trim()
  if (!token) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Cole o token da Freelandoo (flnd_atd_...).' } })
  }

  // 1) Valida o token no /me
  const baseUrl = BASE_URL_PADRAO
  let me
  try {
    const cliente = criarCliente({ baseUrl, token })
    me = await cliente.me()
  } catch (err) {
    if (err instanceof FreelandooError && err.status === 401) {
      return res.status(401).json({ ok: false, error: { code: 'TOKEN_INVALIDO', message: 'Token inválido ou revogado. Gere um novo em freelandoo.com/mensagens.' } })
    }
    logger.warn({ err: err.message }, 'Freelandoo: falha ao validar token no /me')
    return res.status(502).json({ ok: false, error: { code: 'FREELANDOO_INDISPONIVEL', message: 'Não consegui validar o token com a Freelandoo agora. Tente de novo.' } })
  }

  const connectionName = me?.connection?.name || nomeAmigavel || 'Freelandoo'
  const username = me?.user?.username || null
  const nomeInstancia = nomeAmigavel || connectionName || 'Freelandoo'
  // Nome técnico único e válido ([a-z0-9_-]). Sufixo aleatório evita colisão.
  const evolutionInstance = `fl-${slugInstance(nomeInstancia) || 'conta'}-${crypto.randomBytes(3).toString('hex')}`

  // 2) Cria instância + contexto 1:1 + conexão (transação — sem órfãos)
  const client = await pool.connect()
  let inst
  try {
    await client.query('BEGIN')
    const { rows: [ctx] } = await client.query(
      `INSERT INTO app.empresa_contextos (empresa_id, nome, conteudo, contexto_form_json)
       VALUES ($1, $2, '', '{}'::jsonb) RETURNING id, nome`,
      [req.empresa.id, nomeInstancia]
    )
    const { rows: [row] } = await client.query(
      `INSERT INTO app.empresa_whatsapp_instances (empresa_id, evolution_instance, nome, config_json, contexto_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.empresa.id, evolutionInstance, nomeInstancia, JSON.stringify({ canal: 'freelandoo' }), ctx.id]
    )
    inst = row
    inst.contexto_nome = ctx.nome
    await salvarConexao(client, {
      instanceId: inst.id,
      empresaId: req.empresa.id,
      baseUrl,
      token,
      connectionId: me?.connection?.id_connection || null,
      connectionName,
      username,
      scopePersonal: !!me?.connection?.scope_personal,
      webhookUrl: null,
      meta: { id_user: me?.user?.id_user || null },
    })
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    logger.error({ err: err.message }, 'Freelandoo: falha ao criar instância/conexão')
    return res.status(500).json({ ok: false, error: { code: 'ERRO_INTERNO', message: 'Falha ao salvar a conexão.' } })
  } finally {
    client.release()
  }

  // 3) Registra o webhook (fora da transação — token já está salvo; dá pra reconectar depois)
  let webhookAviso = null
  try {
    const cliente = criarCliente({ baseUrl, token })
    const r = await registrarWebhook(inst.id, cliente)
    if (!r.ok) {
      webhookAviso = r.motivo === 'url_nao_https' || r.motivo === 'sem_url_publica'
        ? 'Conta conectada, mas o webhook não pôde ser registrado: a URL pública do backend (PUBLIC_BACKEND_URL) precisa ser HTTPS. Configure e clique em "Reconectar".'
        : 'Conta conectada, mas o webhook falhou. Clique em "Reconectar".'
    }
  } catch (err) {
    logger.warn({ err: err.message, instanceId: inst.id }, 'Freelandoo: falha ao registrar webhook')
    webhookAviso = 'Conta conectada, mas não consegui registrar o webhook agora. Clique em "Reconectar".'
  }

  return res.status(201).json({
    ok: true,
    data: {
      id: inst.id,
      evolution_instance: inst.evolution_instance,
      nome: inst.nome,
      ativo: inst.ativo,
      contexto_id: inst.contexto_id,
      contexto_nome: inst.contexto_nome,
      config_json: inst.config_json,
      connection_name: connectionName,
      username,
      scope_personal: !!me?.connection?.scope_personal,
    },
    aviso: webhookAviso,
  })
})

// POST /:instanceId/reconectar — re-registra o webhook (após configurar a URL pública).
router.post('/:instanceId/reconectar', requireAuth, requireEmpresaAccess, async (req, res) => {
  const conexao = await buscarConexaoDescriptografada(req.params.instanceId)
  if (!conexao || conexao.empresaId !== req.empresa.id) {
    return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Conexão Freelandoo não encontrada.' } })
  }
  try {
    const cliente = criarCliente({ baseUrl: conexao.baseUrl, token: conexao.token })
    await cliente.me() // revalida o token
    const r = await registrarWebhook(req.params.instanceId, cliente)
    if (!r.ok) {
      return res.status(400).json({ ok: false, error: { code: 'WEBHOOK_FALHOU', message: r.motivo === 'url_nao_https' || r.motivo === 'sem_url_publica'
        ? 'A URL pública do backend precisa ser HTTPS (configure PUBLIC_BACKEND_URL).'
        : 'Não foi possível registrar o webhook.' } })
    }
    return res.json({ ok: true, data: { webhook_url: r.webhook_url } })
  } catch (err) {
    if (err instanceof FreelandooError && err.status === 401) {
      return res.status(401).json({ ok: false, error: { code: 'TOKEN_INVALIDO', message: 'Token revogado. Reconecte colando um novo token.' } })
    }
    return res.status(502).json({ ok: false, error: { code: 'FREELANDOO_INDISPONIVEL', message: 'Freelandoo indisponível agora.' } })
  }
})

// DELETE /:instanceId — remove a instância (CASCADE apaga a conexão) e o contexto 1:1.
router.delete('/:instanceId', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows: [inst] } = await pool.query(
    `SELECT ewi.id, ewi.contexto_id
       FROM app.empresa_whatsapp_instances ewi
       JOIN app.freelandoo_connections fc ON fc.instance_id = ewi.id
      WHERE ewi.id = $1 AND ewi.empresa_id = $2`,
    [req.params.instanceId, req.empresa.id]
  )
  if (!inst) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Instância Freelandoo não encontrada.' } })

  // Apaga a instância (CASCADE remove a conexão). O contexto só é removido se
  // não estiver compartilhado com outra instância.
  await pool.query('DELETE FROM app.empresa_whatsapp_instances WHERE id = $1 AND empresa_id = $2', [inst.id, req.empresa.id])
  if (inst.contexto_id) {
    await removerContextoSeOrfao(pool, req.empresa.id, inst.contexto_id)
  }
  return res.json({ ok: true, data: { id: inst.id, deleted: true } })
})

module.exports = router
