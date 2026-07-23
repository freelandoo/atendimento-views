'use strict'
const { Router } = require('express')
const axios = require('axios')
const crypto = require('crypto')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const { marcarOnboardingCompleto } = require('../db/usuarios')
const { invalidarCacheEmpresa } = require('../services/contexto-empresa')
const { enviarMensagem, verificarStatusInstanciaEvolution } = require('../whatsapp')
const { renderSaudacao, saudacaoDaInstancia } = require('../services/rodar-leads')
const {
  invalidarCacheEmpresaInstancia,
  invalidarCacheAgendaInstancia,
  removerContextoSeOrfao,
} = require('../db/whatsapp-instances')
const mensagensSvc = require('../services/mensagens-automaticas')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

const EVOLUTION_URL = process.env.EVOLUTION_URL || 'http://evolution-api:8080'
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY
const PUBLIC_BACKEND_URL = process.env.PUBLIC_BACKEND_URL || process.env.BACKEND_URL || ''
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || ''
const CONEXAO_RESUMO_TTL_MS = 20000
const conexaoResumoCache = new Map()

async function calcularResumoConexao(instancias, verificarStatus = verificarStatusInstanciaEvolution) {
  const estados = await Promise.all(
    instancias.map(async (inst) => {
      const status = await verificarStatus(inst.evolution_instance)
      return {
        id: inst.id || null,
        evolution_instance: inst.evolution_instance,
        connected: status.connected,
        state: status.state || 'unknown',
        motivo: status.motivo || null,
        last_checked_at: status.last_checked_at || new Date().toISOString(),
        can_send: status.connected === true,
      }
    })
  )
  const desconectadas = estados.filter((st) => st.connected === false).length
  const desconhecidas = estados.filter((st) => st.connected !== true && st.connected !== false).length
  return {
    total: instancias.length,
    desconectadas,
    desconhecidas,
    alguma_desconectada: desconectadas > 0,
    alguma_indisponivel: estados.some((st) => st.connected !== true),
    instancias: estados,
  }
}

async function obterResumoConexao(empresaId, deps = {}) {
  const agora = deps.agora || Date.now
  const buscarInstancias = deps.buscarInstancias || (async () => {
    const { rows } = await pool.query(
      `SELECT id, evolution_instance FROM app.empresa_whatsapp_instances
        WHERE empresa_id = $1 AND ativo = true
          AND COALESCE(config_json->>'canal', 'whatsapp') <> 'freelandoo'`,
      [empresaId]
    )
    return rows
  })
  const verificarStatus = deps.verificarStatus || verificarStatusInstanciaEvolution
  const chave = String(empresaId)
  const existente = conexaoResumoCache.get(chave)
  if (existente?.data && existente.expiraEm > agora()) return existente.data
  if (existente?.promise) return existente.promise

  const promise = (async () => {
    const instancias = await buscarInstancias()
    return calcularResumoConexao(instancias, verificarStatus)
  })()
  conexaoResumoCache.set(chave, { promise })
  try {
    const data = await promise
    if (conexaoResumoCache.get(chave)?.promise === promise) {
      conexaoResumoCache.set(chave, { data, expiraEm: agora() + CONEXAO_RESUMO_TTL_MS })
    }
    return data
  } catch (err) {
    if (conexaoResumoCache.get(chave)?.promise === promise) conexaoResumoCache.delete(chave)
    throw err
  }
}

function invalidarResumoConexao(empresaId) {
  conexaoResumoCache.delete(String(empresaId))
}

function webhookConfigForInstance() {
  if (!PUBLIC_BACKEND_URL) return null
  return {
    enabled: true,
    url: `${PUBLIC_BACKEND_URL.replace(/\/+$/, '')}/webhook`,
    byEvents: false,
    base64: false,
    headers: WEBHOOK_SECRET ? { 'x-webhook-secret': WEBHOOK_SECRET } : undefined,
    events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
  }
}

function refInstanciaLog(instanceName) {
  return crypto.createHash('sha256').update(String(instanceName || '')).digest('hex').slice(0, 12)
}

async function aplicarWebhookEvolution(instanceName, meta = {}) {
  const logBase = {
    empresa_id: meta.empresaId || null,
    instance_id: meta.instanceId || null,
    instance_ref: refInstanciaLog(instanceName),
  }
  const wh = webhookConfigForInstance()
  if (!wh) {
    logger.warn(logBase, '[api-whatsapp] webhook ignorado sem PUBLIC_BACKEND_URL')
    return { configured: false, skipped: true, reason: 'PUBLIC_BACKEND_URL ausente' }
  }
  try {
    await axios.post(
      `${EVOLUTION_URL}/webhook/set/${encodeURIComponent(instanceName)}`,
      { webhook: wh },
      { headers: { apikey: EVOLUTION_KEY }, timeout: 10000 }
    )
    logger.info(logBase, '[api-whatsapp] webhook configurado')
    return { configured: true, skipped: false, expected_url: wh.url }
  } catch (err) {
    const message = err.response?.data?.message || err.message || 'Falha ao configurar webhook.'
    logger.warn({ ...logBase, err: String(message).slice(0, 300) }, '[api-whatsapp] webhook nao confirmado')
    return { configured: false, skipped: false, expected_url: wh.url, error: String(message).slice(0, 500) }
  }
}

async function carregarInstanciaEmpresa(instanceId, empresaId) {
  const { rows: [inst] } = await pool.query(
    `SELECT id, evolution_instance, nome, ativo, config_json, contexto_id
       FROM app.empresa_whatsapp_instances
      WHERE id = $1 AND empresa_id = $2
        AND COALESCE(config_json->>'canal', 'whatsapp') <> 'freelandoo'`,
    [instanceId, empresaId]
  )
  return inst || null
}

async function limparReferenciasInstanciaRemovida(client, empresaId, inst) {
  const bancoLeadsConfig = await client.query(
    `UPDATE app.banco_leads_config
        SET auto_instancia_id = NULL,
            auto_ativo = false,
            auto_proximo_disparo_em = NULL,
            atualizado_em = NOW()
      WHERE empresa_id = $1 AND auto_instancia_id = $2`,
    [empresaId, inst.id]
  )
  const rascunhos = await client.query(
    `UPDATE prospectador.lead_disparos
        SET status = 'falhou',
            erro = 'instancia_removida'
      WHERE empresa_id = $1
        AND evolution_instance = $2
        AND status IN ('gerando', 'aguardando_disparo')`,
    [empresaId, inst.evolution_instance]
  )
  const conversas = await client.query(
    `UPDATE vendas.conversas
        SET evolution_instance = NULL,
            atualizado_em = NOW()
      WHERE empresa_id = $1
        AND evolution_instance = $2`,
    [empresaId, inst.evolution_instance]
  )
  return {
    banco_leads_config: bancoLeadsConfig.rowCount || 0,
    rascunhos_cancelados: rascunhos.rowCount || 0,
    conversas_desvinculadas: conversas.rowCount || 0,
  }
}

async function calcularImpactoRemocaoInstancia(client, empresaId, inst) {
  const [
    bancoLeads,
    rascunhos,
    envios,
    conversas,
    contextoRefs,
  ] = await Promise.all([
    client.query(
      `SELECT auto_ativo, modo
         FROM app.banco_leads_config
        WHERE empresa_id = $1 AND auto_instancia_id = $2
        LIMIT 1`,
      [empresaId, inst.id]
    ),
    client.query(
      `SELECT COUNT(*)::int AS total
         FROM prospectador.lead_disparos
        WHERE empresa_id = $1
          AND evolution_instance = $2
          AND status IN ('gerando', 'aguardando_disparo')`,
      [empresaId, inst.evolution_instance]
    ),
    client.query(
      `SELECT COUNT(*)::int AS total
         FROM prospectador.lead_disparos
        WHERE empresa_id = $1
          AND evolution_instance = $2
          AND status IN ('enviando', 'pendente_confirmacao')`,
      [empresaId, inst.evolution_instance]
    ),
    client.query(
      `SELECT COUNT(*)::int AS total
         FROM vendas.conversas
        WHERE empresa_id = $1
          AND evolution_instance = $2`,
      [empresaId, inst.evolution_instance]
    ),
    inst.contexto_id
      ? client.query(
        `SELECT COUNT(*)::int AS total
           FROM app.empresa_whatsapp_instances
          WHERE contexto_id = $1
            AND empresa_id = $2
            AND id <> $3`,
        [inst.contexto_id, empresaId, inst.id]
      )
      : Promise.resolve({ rows: [{ total: 0 }] }),
  ])
  const enviosEmAndamento = envios.rows[0]?.total || 0
  const bancoConfig = bancoLeads.rows[0] || null
  const rascunhosCancelaveis = rascunhos.rows[0]?.total || 0
  const conversasVinculadas = conversas.rows[0]?.total || 0
  const outrasRefsContexto = contextoRefs.rows[0]?.total || 0
  const avisos = []
  if (enviosEmAndamento > 0) avisos.push('Existem envios em andamento. Aguarde a confirmacao antes de remover.')
  if (bancoConfig) avisos.push('A configuracao do Banco de Leads aponta para esta instancia e sera desligada.')
  if (rascunhosCancelaveis > 0) avisos.push('Rascunhos pendentes desta instancia serao cancelados.')
  if (conversasVinculadas > 0) avisos.push('Conversas serao desvinculadas da instancia, mas o historico sera preservado.')
  if (inst.contexto_id && outrasRefsContexto === 0) avisos.push('O contexto exclusivo desta instancia tambem sera removido.')

  return {
    instance: {
      id: inst.id,
      nome: inst.nome || null,
      evolution_instance: inst.evolution_instance,
    },
    banco_leads: {
      configuracao_usando: !!bancoConfig,
      automatico_ativo: !!bancoConfig?.auto_ativo,
      modo: bancoConfig?.modo || null,
    },
    rascunhos_cancelaveis: rascunhosCancelaveis,
    envios_em_andamento: enviosEmAndamento,
    conversas_vinculadas: conversasVinculadas,
    contexto: {
      id: inst.contexto_id || null,
      sera_removido: !!inst.contexto_id && outrasRefsContexto === 0,
      compartilhado: !!inst.contexto_id && outrasRefsContexto > 0,
    },
    bloqueia_remocao: enviosEmAndamento > 0,
    avisos,
  }
}

async function montarDiagnosticoInstancia(inst) {
  const status = await verificarStatusInstanciaEvolution(inst.evolution_instance)
  const webhookCfg = webhookConfigForInstance()
  const warnings = []
  if (!inst.ativo) warnings.push('Instancia desativada no aplicativo.')
  if (status.connected === false) warnings.push(status.motivo || 'Instancia desconectada na Evolution.')
  if (status.connected == null) warnings.push('Nao foi possivel confirmar a conexao na Evolution.')
  if (!webhookCfg) warnings.push('PUBLIC_BACKEND_URL nao configurado; webhook nao pode ser validado automaticamente.')

  return {
    instance: {
      id: inst.id,
      nome: inst.nome || null,
      evolution_instance: inst.evolution_instance,
      ativo: !!inst.ativo,
    },
    connection: {
      connected: status.connected,
      state: status.state || 'unknown',
      motivo: status.motivo || null,
      last_checked_at: status.last_checked_at || new Date().toISOString(),
    },
    webhook: {
      enabled: !!webhookCfg,
      expected_url: webhookCfg?.url || null,
      configured: webhookCfg ? null : false,
      last_check: webhookCfg ? 'use revalidar_webhook' : 'skipped',
    },
    can_send: !!inst.ativo && status.connected === true,
    warnings,
  }
}

// Cada instância é dona de um Contexto 1:1. Cria um contexto vazio e devolve {id, nome}.
// Recebe um client (pode estar dentro de transação) para garantir atomicidade com a instância.
async function criarContextoParaInstancia(client, empresaId, nome) {
  const { rows: [ctx] } = await client.query(
    `INSERT INTO app.empresa_contextos (empresa_id, nome, conteudo, contexto_form_json)
     VALUES ($1, $2, '', '{}'::jsonb) RETURNING id, nome`,
    [empresaId, nome]
  )
  return ctx
}

// Clona um contexto da MESMA empresa (conteúdo + config + versão ativa/playbook)
// para um novo registro independente. Retorna { id, nome } ou null se origem inválida.
async function duplicarContexto(client, empresaId, origemId) {
  const { rows: [novo] } = await client.query(
    `INSERT INTO app.empresa_contextos
       (empresa_id, nome, conteudo, contexto_form_json, schema_version,
        fontes_usadas_json, estagios_json, saudacoes_json, gatilhos_agenda_json, runtime_ativo, ativo)
     SELECT empresa_id, nome || ' (cópia)', conteudo, contexto_form_json, schema_version,
            fontes_usadas_json, estagios_json, saudacoes_json, gatilhos_agenda_json, false, ativo
       FROM app.empresa_contextos
      WHERE id = $1 AND empresa_id = $2
      RETURNING id, nome`,
    [origemId, empresaId]
  )
  if (!novo) return null
  // Traz junto a versão ATIVA (playbook gerado), já ativa no novo contexto.
  await client.query(
    `INSERT INTO app.empresa_contexto_versoes
       (contexto_id, empresa_id, versao, conteudo_json, conteudo_markdown, status, gerado_por, playbook_schema_version, ativado_em)
     SELECT $1, empresa_id, versao, conteudo_json, conteudo_markdown, 'ativo', gerado_por, playbook_schema_version, NOW()
       FROM app.empresa_contexto_versoes
      WHERE contexto_id = $2 AND status = 'ativo'
      LIMIT 1`,
    [novo.id, origemId]
  ).catch(() => {})
  return novo
}

// GET /api/empresas/:empresaId/whatsapp
router.get('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ewi.*, c.nome AS contexto_nome
       FROM app.empresa_whatsapp_instances ewi
       LEFT JOIN app.empresa_contextos c ON c.id = ewi.contexto_id
      WHERE ewi.empresa_id = $1
        AND COALESCE(ewi.config_json->>'canal', 'whatsapp') <> 'freelandoo'
      ORDER BY ewi.criado_em DESC`,
    [req.empresa.id]
  )
  return res.json({ ok: true, data: rows })
})

// GET /api/empresas/:empresaId/whatsapp/conexao-resumo — resumo de conexão de TODAS as
// instâncias ativas (para o alerta do menu). Definido ANTES de /:instanceId para não colidir.
router.get('/conexao-resumo', requireAuth, requireEmpresaAccess, async (req, res) => {
  const data = await obterResumoConexao(req.empresa.id)
  return res.json({ ok: true, data })
})

// GET /api/empresas/:empresaId/whatsapp/:instanceId — instância única (com contexto vinculado).
// Garante o invariante 1:1: se a instância (legado) ainda não tem contexto, cria um na hora.
router.get('/:instanceId', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows: [inst] } = await pool.query(
    `SELECT ewi.*, c.nome AS contexto_nome
       FROM app.empresa_whatsapp_instances ewi
       LEFT JOIN app.empresa_contextos c ON c.id = ewi.contexto_id
      WHERE ewi.id = $1 AND ewi.empresa_id = $2`,
    [req.params.instanceId, req.empresa.id]
  )
  if (!inst) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Instância não encontrada.' } })

  if (!inst.contexto_id) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const ctx = await criarContextoParaInstancia(client, req.empresa.id, inst.nome || inst.evolution_instance)
      await client.query(
        `UPDATE app.empresa_whatsapp_instances SET contexto_id = $1, atualizado_em = NOW() WHERE id = $2`,
        [ctx.id, inst.id]
      )
      await client.query('COMMIT')
      inst.contexto_id = ctx.id
      inst.contexto_nome = ctx.nome
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }
  return res.json({ ok: true, data: inst })
})

// GET /api/empresas/:empresaId/whatsapp/:instanceId/status — estado de conexão da
// instância na Evolution (open/close). Reusa verificarStatusInstanciaEvolution; nunca lança.
router.get('/:instanceId/status', requireAuth, requireEmpresaAccess, async (req, res) => {
  const inst = await carregarInstanciaEmpresa(req.params.instanceId, req.empresa.id)
  if (!inst) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Instância não encontrada.' } })
  const st = await verificarStatusInstanciaEvolution(inst.evolution_instance)
  return res.json({
    ok: true,
    data: {
      connected: st.connected,
      state: st.state || 'unknown',
      motivo: st.motivo || null,
      last_checked_at: st.last_checked_at || new Date().toISOString(),
      ativo: inst.ativo,
      can_send: !!inst.ativo && st.connected === true,
    },
  })
})

// GET /api/empresas/:empresaId/whatsapp/:instanceId/diagnostico — diagnostico operacional.
router.get('/:instanceId/diagnostico', requireAuth, requireEmpresaAccess, async (req, res) => {
  const inst = await carregarInstanciaEmpresa(req.params.instanceId, req.empresa.id)
  if (!inst) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Instancia nao encontrada.' } })
  const data = await montarDiagnosticoInstancia(inst)
  return res.json({ ok: true, data })
})

// POST /api/empresas/:empresaId/whatsapp/:instanceId/webhook/revalidar — reaplica webhook Evolution.
router.post('/:instanceId/webhook/revalidar', requireAuth, requireEmpresaAccess, async (req, res) => {
  const inst = await carregarInstanciaEmpresa(req.params.instanceId, req.empresa.id)
  if (!inst) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Instancia nao encontrada.' } })
  const webhook = await aplicarWebhookEvolution(inst.evolution_instance, {
    empresaId: req.empresa.id,
    instanceId: inst.id,
  })
  const diagnostico = await montarDiagnosticoInstancia(inst)
  return res.json({ ok: true, data: { webhook, diagnostico } })
})

// PATCH /api/empresas/:empresaId/whatsapp/:instanceId — atualiza link de contexto (e nome opcional)
router.patch('/:instanceId', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { contexto_id, nome } = req.body || {}
  const sets = []
  const vals = []
  if (contexto_id !== undefined) {
    if (contexto_id === null || contexto_id === '') {
      sets.push(`contexto_id = NULL`)
    } else {
      // Garante que o contexto pertence à empresa
      const { rows } = await pool.query(
        'SELECT id FROM app.empresa_contextos WHERE id = $1 AND empresa_id = $2',
        [contexto_id, req.empresa.id]
      )
      if (!rows.length) {
        return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Contexto inválido.' } })
      }
      sets.push(`contexto_id = $${vals.push(contexto_id)}`)
    }
  }
  if (nome !== undefined) sets.push(`nome = $${vals.push(nome)}`)
  // Liga/desliga o número: instância inativa não resolve a empresa no webhook (db/empresas.js).
  if (typeof req.body?.ativo === 'boolean') sets.push(`ativo = $${vals.push(req.body.ativo)}`)
  // Saudação (1ª mensagem do "Rodar leads") fica em config_json.saudacao.
  if (req.body?.saudacao !== undefined) {
    sets.push(`config_json = COALESCE(config_json, '{}'::jsonb) || jsonb_build_object('saudacao', $${vals.push(String(req.body.saudacao || ''))}::text)`)
  }
  // Usa agenda? é regra POR INSTÂNCIA — fica em config_json.usa_agenda (default ligado).
  if (typeof req.body?.usa_agenda === 'boolean') {
    sets.push(`config_json = COALESCE(config_json, '{}'::jsonb) || jsonb_build_object('usa_agenda', $${vals.push(req.body.usa_agenda)}::boolean)`)
  }
  if (!sets.length) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Nada para atualizar.' } })
  }
  sets.push(`atualizado_em = NOW()`)
  vals.push(req.params.instanceId, req.empresa.id)
  const { rows: [inst] } = await pool.query(
    `UPDATE app.empresa_whatsapp_instances SET ${sets.join(', ')}
     WHERE id = $${vals.length - 1} AND empresa_id = $${vals.length}
     RETURNING *`,
    vals
  )
  if (!inst) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Instância não encontrada.' } })
  // Invalida o cache de usa_agenda da instância quando o flag muda (runtime lê por instance name).
  if (typeof req.body?.usa_agenda === 'boolean' && inst.evolution_instance) {
    invalidarCacheAgendaInstancia(inst.evolution_instance)
  }
  if (typeof req.body?.ativo === 'boolean') {
    invalidarCacheEmpresaInstancia(inst.evolution_instance)
    invalidarResumoConexao(req.empresa.id)
  }
  if (contexto_id !== undefined) {
    invalidarCacheEmpresa(req.empresa.id)
    mensagensSvc.invalidarCacheAtivo(req.empresa.id)
  }
  return res.json({ ok: true, data: inst })
})

// POST /api/empresas/:empresaId/whatsapp/:instanceId/contexto/duplicar { origem_contexto_id }
// Reutilizar contexto por CÓPIA: clona um contexto existente da empresa e vincula à instância
// (fica independente). Para reutilizar por COMPARTILHAMENTO, use o PATCH com { contexto_id }.
router.post('/:instanceId/contexto/duplicar', requireAuth, requireEmpresaAccess, async (req, res) => {
  const origemId = req.body?.origem_contexto_id
  if (!origemId) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Informe o contexto de origem.' } })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [inst] } = await client.query(
      `SELECT id FROM app.empresa_whatsapp_instances WHERE id = $1 AND empresa_id = $2`,
      [req.params.instanceId, req.empresa.id]
    )
    if (!inst) {
      await client.query('ROLLBACK')
      return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Instância não encontrada.' } })
    }
    const novo = await duplicarContexto(client, req.empresa.id, origemId)
    if (!novo) {
      await client.query('ROLLBACK')
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Contexto de origem inválido.' } })
    }
    await client.query(
      `UPDATE app.empresa_whatsapp_instances SET contexto_id = $1, atualizado_em = NOW() WHERE id = $2`,
      [novo.id, inst.id]
    )
    await client.query('COMMIT')
    invalidarCacheEmpresa(req.empresa.id)
    mensagensSvc.invalidarCacheAtivo(req.empresa.id)
    return res.json({ ok: true, data: { contexto_id: novo.id, contexto_nome: novo.nome } })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    logger.error('POST whatsapp/contexto/duplicar:', err.message)
    return res.status(500).json({ ok: false, error: { code: 'DUPLICAR_FAILED', message: err.message } })
  } finally {
    client.release()
  }
})

// POST /api/empresas/:empresaId/whatsapp
router.post('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { evolution_instance, nome, config_json = {} } = req.body || {}
  if (!evolution_instance) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'evolution_instance obrigatório.' } })
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(evolution_instance)) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'evolution_instance só aceita letras, números, _ e -.' } })
  }

  const webhookCfg = webhookConfigForInstance()
  const createPayload = {
    instanceName: evolution_instance,
    integration: 'WHATSAPP-BAILEYS',
    qrcode: true,
    ...(webhookCfg ? { webhook: webhookCfg } : {}),
  }
  try {
    await axios.post(
      `${EVOLUTION_URL}/instance/create`,
      createPayload,
      { headers: { apikey: EVOLUTION_KEY }, timeout: 15000 }
    )
  } catch (err) {
    const status = err.response?.status
    const msg = err.response?.data?.response?.message || err.response?.data?.message || err.message
    const alreadyExists = status === 403 || status === 409 ||
      (Array.isArray(msg) ? msg.some((m) => /already in use|exists/i.test(String(m))) : /already in use|exists/i.test(String(msg)))
    if (!alreadyExists) {
      return res.status(502).json({ ok: false, error: { code: 'EVOLUTION_CREATE_FAILED', message: Array.isArray(msg) ? msg.join('; ') : String(msg || 'Falha ao criar instância no Evolution.') } })
    }
  }

  // Garante webhook configurado (idempotente — funciona mesmo se a instância já existia)
  const webhook = await aplicarWebhookEvolution(evolution_instance, { empresaId: req.empresa.id })

  // Cria a instância + o contexto dela (1:1) na mesma transação — sem contexto órfão se algo falhar.
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const ctx = await criarContextoParaInstancia(client, req.empresa.id, nome || evolution_instance)
    const { rows: [inst] } = await client.query(
      `INSERT INTO app.empresa_whatsapp_instances (empresa_id, evolution_instance, nome, config_json, contexto_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.empresa.id, evolution_instance, nome || null, JSON.stringify(config_json), ctx.id]
    )
    await client.query('COMMIT')
    inst.contexto_nome = ctx.nome
    if (webhook?.configured === false) {
      inst.aviso = webhook.skipped
        ? 'Instancia criada. A verificacao automatica da conexao ficara pendente ate o backend publico estar configurado.'
        : 'Instancia criada. A verificacao automatica vai confirmar a recepcao de mensagens em instantes.'
    }
    invalidarResumoConexao(req.empresa.id)
    marcarOnboardingCompleto(req.usuario.id, req.empresa.id).catch(() => {})
    return res.status(201).json({ ok: true, data: inst })
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23505') {
      return res.status(409).json({ ok: false, error: { code: 'CONFLICT', message: 'Já existe uma instância com esse nome técnico.' } })
    }
    throw err
  } finally {
    client.release()
  }
})

// GET /api/empresas/:empresaId/whatsapp/:instanceId/qrcode
router.get('/:instanceId/qrcode', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows: [inst] } = await pool.query(
    'SELECT evolution_instance FROM app.empresa_whatsapp_instances WHERE id = $1 AND empresa_id = $2',
    [req.params.instanceId, req.empresa.id]
  )
  if (!inst) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Instância não encontrada.' } })

  try {
    const { data } = await axios.get(
      `${EVOLUTION_URL}/instance/connect/${encodeURIComponent(inst.evolution_instance)}`,
      { headers: { apikey: EVOLUTION_KEY }, timeout: 15000 }
    )
    if (data?.instance?.state === 'open') {
      return res.json({ ok: true, data: { connected: true, instance: inst.evolution_instance } })
    }
    const base64 = data?.base64 || (data?.qrcode?.base64) || null
    const pairingCode = data?.pairingCode || data?.code || null
    if (!base64 && !pairingCode) {
      return res.status(502).json({ ok: false, error: { code: 'EVOLUTION_NO_QR', message: 'Evolution não retornou QR Code.' } })
    }
    return res.json({ ok: true, data: { connected: false, instance: inst.evolution_instance, base64, pairingCode } })
  } catch (err) {
    const status = err.response?.status || 502
    const message = err.response?.data?.message || err.message || 'Falha ao conectar com Evolution.'
    return res.status(status === 404 ? 404 : 502).json({ ok: false, error: { code: 'EVOLUTION_ERROR', message } })
  }
})

router.get('/:instanceId/remocao-impacto', requireAuth, requireEmpresaAccess, async (req, res) => {
  const inst = await carregarInstanciaEmpresa(req.params.instanceId, req.empresa.id)
  if (!inst) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Instancia nao encontrada.' } })
  const data = await calcularImpactoRemocaoInstancia(pool, req.empresa.id, inst)
  return res.json({ ok: true, data })
})

// DELETE /api/empresas/:empresaId/whatsapp/:instanceId
// Remove do Evolution e apaga do banco (hard delete — sincronia)
router.delete('/:instanceId', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows: [inst] } = await pool.query(
    'SELECT id, evolution_instance, nome, contexto_id FROM app.empresa_whatsapp_instances WHERE id = $1 AND empresa_id = $2',
    [req.params.instanceId, req.empresa.id]
  )
  if (!inst) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Instância não encontrada.' } })

  const impactoAtual = await calcularImpactoRemocaoInstancia(pool, req.empresa.id, inst)
  if (impactoAtual.bloqueia_remocao) {
    return res.status(409).json({
      ok: false,
      error: {
        code: 'INSTANCE_DELETE_BLOCKED',
        message: 'Existem envios em andamento nesta instancia. Aguarde a confirmacao antes de remover.',
      },
      data: impactoAtual,
    })
  }

  try {
    await axios.delete(
      `${EVOLUTION_URL}/instance/delete/${encodeURIComponent(inst.evolution_instance)}`,
      { headers: { apikey: EVOLUTION_KEY }, timeout: 15000 }
    )
  } catch (err) {
    if (err.response?.status !== 404) {
      const msg = err.response?.data?.message || err.message
      return res.status(502).json({ ok: false, error: { code: 'EVOLUTION_DELETE_FAILED', message: String(msg) } })
    }
  }

  let limpeza = {
    banco_leads_config: 0,
    rascunhos_cancelados: 0,
    conversas_desvinculadas: 0,
    contexto_removido: false,
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const impactoTransacao = await calcularImpactoRemocaoInstancia(client, req.empresa.id, inst)
    if (impactoTransacao.bloqueia_remocao) {
      const err = new Error('Existem envios em andamento nesta instancia. Aguarde a confirmacao antes de remover.')
      err.statusCode = 409
      err.code = 'INSTANCE_DELETE_BLOCKED'
      err.impacto = impactoTransacao
      throw err
    }
    limpeza = {
      ...limpeza,
      ...(await limparReferenciasInstanciaRemovida(client, req.empresa.id, inst)),
    }
    await client.query('DELETE FROM app.empresa_whatsapp_instances WHERE id = $1 AND empresa_id = $2', [inst.id, req.empresa.id])
    if (inst.contexto_id) {
      limpeza.contexto_removido = await removerContextoSeOrfao(client, req.empresa.id, inst.contexto_id)
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    if (err.statusCode === 409) {
      return res.status(409).json({
        ok: false,
        error: { code: err.code || 'INSTANCE_DELETE_BLOCKED', message: err.message },
        data: err.impacto || null,
      })
    }
    throw err
  } finally {
    client.release()
  }
  invalidarCacheEmpresaInstancia(inst.evolution_instance)
  invalidarCacheAgendaInstancia(inst.evolution_instance)
  invalidarResumoConexao(req.empresa.id)
  // Contextos podem ser compartilhados. Só remove quando a instância apagada era
  // a última referência; caso contrário preserva o conteúdo para as demais.
  if (limpeza.contexto_removido) {
    invalidarCacheEmpresa(req.empresa.id)
    mensagensSvc.invalidarCacheAtivo(req.empresa.id)
  }
  return res.json({ ok: true, data: { id: inst.id, deleted: true, limpeza } })
})

// POST /api/empresas/:empresaId/whatsapp/:instanceId/saudacao/testar { numero_teste }
// Envia a saudação (renderizada com um lead de exemplo) pro número de teste do operador.
router.post('/:instanceId/saudacao/testar', requireAuth, requireEmpresaAccess, async (req, res) => {
  const numeroTeste = String(req.body?.numero_teste || '').replace(/\D/g, '')
  if (numeroTeste.length < 10) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Informe um número de teste válido (com DDD).' } })
  }
  const { rows: [inst] } = await pool.query(
    `SELECT evolution_instance, ativo, config_json FROM app.empresa_whatsapp_instances WHERE id = $1 AND empresa_id = $2`,
    [req.params.instanceId, req.empresa.id]
  )
  if (!inst) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Instância não encontrada.' } })
  if (!inst.ativo) return res.status(409).json({ ok: false, error: { code: 'INSTANCIA_INATIVA', message: 'Instância desativada. Ative o número antes de testar.' } })

  // Usa a saudação enviada no corpo (pré-visualização do que está editando) ou a salva.
  const template = req.body?.saudacao !== undefined ? String(req.body.saudacao || '') : saudacaoDaInstancia(inst)
  const exemplo = { nome: 'Padaria Exemplo', cidade: 'São Paulo', nicho: 'padaria' }
  const mensagem = renderSaudacao(template, exemplo)
  if (!mensagem) return res.status(400).json({ ok: false, error: { code: 'SAUDACAO_VAZIA', message: 'A saudação está vazia.' } })

  try {
    await enviarMensagem(numeroTeste, mensagem, { instanceName: inst.evolution_instance })
    return res.json({ ok: true, data: { enviado: true, preview: mensagem } })
  } catch (err) {
    const msg = err.response?.data?.message || err.message || 'Falha ao enviar teste.'
    return res.status(502).json({ ok: false, error: { code: 'ENVIO_TESTE_FALHOU', message: String(msg) } })
  }
})

module.exports = router
module.exports.calcularResumoConexao = calcularResumoConexao
module.exports.obterResumoConexao = obterResumoConexao
module.exports.invalidarResumoConexao = invalidarResumoConexao
module.exports.duplicarContexto = duplicarContexto
module.exports.limparReferenciasInstanciaRemovida = limparReferenciasInstanciaRemovida
module.exports.calcularImpactoRemocaoInstancia = calcularImpactoRemocaoInstancia
