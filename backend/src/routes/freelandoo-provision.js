'use strict'

// Provisionamento automático do produto "Atendimento IA" da Freelandoo.
// A Freelandoo (backend) chama estes endpoints com um segredo compartilhado
// (header x-provision-secret = FREELANDOO_PROVISION_SECRET):
//
//   POST /freelandoo/provision      — upsert por external_id (id_user na Freelandoo).
//                                     Cria empresa dedicada + contexto + instância na
//                                     1ª vez; nas seguintes atualiza tokens (quando
//                                     re-cunhados), limite, ciclo e config. cycle_start
//                                     novo ZERA o contador de tokens. Tokens omitidos
//                                     = manter os atuais (re-push leve de config).
//   POST /freelandoo/deprovision    — desativa a instância (histórico preservado).
//   GET  /freelandoo/usage/:id      — uso do ciclo (a Freelandoo mostra pro vendedor).
//
// O playbook (base de conhecimento) é gerado da API de Dados (playbook-freelandoo)
// em background e vira a versão ATIVA do contexto 1:1 da instância — sem versão
// ativa a instância não responde (regra do runtime).

const { Router } = require('express')
const crypto = require('crypto')
const { pool } = require('../db')
const { logger } = require('../logger')
const { criarCliente, BASE_URL_PADRAO } = require('../freelandoo/client')
const { gerarPlaybook } = require('../services/playbook-freelandoo')
const { ativarContexto2 } = require('../services/contexto-empresa')
const {
  salvarConexao, atualizarWebhook, buscarConexaoPorExternalId,
  atualizarProvisionamento, marcarPlaybookGerado, listarProvisionadasAtivas,
  buscarConexaoDescriptografada,
} = require('../db/freelandoo')

const router = Router()

const EMPRESA_SLUG = 'freelandoo-atendimento-ia'
const EMPRESA_NOME = 'Freelandoo — Atendimento IA'
const EXTRA_INSTRUCTIONS_MAX = 2000

// ─── Auth por segredo compartilhado (timing-safe) ────────────────────────────
function requireProvisionSecret(req, res, next) {
  const expected = process.env.FREELANDOO_PROVISION_SECRET || ''
  if (!expected) {
    return res.status(503).json({ ok: false, error: { code: 'NAO_CONFIGURADO', message: 'FREELANDOO_PROVISION_SECRET não configurado no bot.' } })
  }
  const got = String(req.get('x-provision-secret') || '')
  const a = Buffer.from(got)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Segredo inválido.' } })
  }
  return next()
}

// ─── Empresa dedicada (criada 1x, lazy) ──────────────────────────────────────
async function garantirEmpresa() {
  const { rows: [found] } = await pool.query(
    `SELECT id FROM app.empresas WHERE slug = $1 LIMIT 1`,
    [EMPRESA_SLUG]
  )
  if (found) return found.id
  const { rows: [created] } = await pool.query(
    `INSERT INTO app.empresas (nome, slug, plano)
     VALUES ($1, $2, 'pro')
     ON CONFLICT (slug) DO UPDATE SET atualizado_em = NOW()
     RETURNING id`,
    [EMPRESA_NOME, EMPRESA_SLUG]
  )
  return created.id
}

function publicBackendUrl() {
  const explicit = process.env.PUBLIC_BACKEND_URL || process.env.BACKEND_URL
  if (explicit) return explicit.replace(/\/+$/, '')
  const rw = process.env.RAILWAY_PUBLIC_DOMAIN
  if (rw) return `https://${rw.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`
  return ''
}

function sanitizarConfig(config) {
  const c = config && typeof config === 'object' ? config : {}
  return {
    paused: c.paused === true,
    answer_dm: c.answer_dm !== false,
    answer_os: c.answer_os !== false,
    extra_instructions: String(c.extra_instructions || '').slice(0, EXTRA_INSTRUCTIONS_MAX),
  }
}

// Registra o webhook da instância na Freelandoo e persiste o segredo cifrado.
async function registrarWebhookDaInstancia(instanceId, token) {
  const base = publicBackendUrl()
  if (!base || !/^https:\/\//i.test(base)) {
    throw new Error('PUBLIC_BACKEND_URL precisa ser HTTPS para registrar o webhook.')
  }
  const url = `${base}/freelandoo/webhook/${instanceId}`
  const cliente = criarCliente({ baseUrl: BASE_URL_PADRAO, token })
  const r = await cliente.setWebhook(url)
  await atualizarWebhook(instanceId, { webhookSecret: r?.webhook_secret, webhookUrl: r?.webhook_url || url })
}

// ─── Playbook: gera da API de Dados e ativa como versão do contexto ─────────
// conteudo_json mínimo que o runtime consome: o markdown vira
// `informacoes_empresa` (os prompts mandam consultar esse bloco) e as
// instruções extras do vendedor entram como campo próprio.
async function gerarEAtivarPlaybook(instanceId) {
  const conexao = await buscarConexaoDescriptografada(instanceId)
  if (!conexao || !conexao.tokenData || !conexao.contextoId) return { ok: false, motivo: 'sem_token_data_ou_contexto' }

  const resultado = await gerarPlaybook({
    token: conexao.tokenData,
    empresaId: conexao.empresaId,
    pool,
    log: logger,
  })
  const markdown = resultado?.markdown || ''
  if (!markdown) return { ok: false, motivo: 'playbook_vazio' }

  const config = sanitizarConfig(conexao.config)
  const conteudoJson = {
    origem: 'freelandoo_atendimento_ia',
    canal: 'freelandoo',
    resumo_empresa: { nome: conexao.username ? `@${conexao.username} (Freelandoo)` : 'Vendedor Freelandoo' },
    informacoes_empresa: markdown,
    instrucoes_do_vendedor: config.extra_instructions || '',
    regras: [
      'Você atende COMPRADORES em nome do vendedor da Freelandoo descrito em informacoes_empresa.',
      'Responda APENAS com base nas informações do bloco informacoes_empresa (perfis, serviços, produtos, preços). Se não souber, diga que vai verificar com o vendedor.',
      'Nunca invente preço, prazo ou serviço que não esteja listado.',
      'Nunca inicie assunto de reunião externa; o fechamento acontece dentro da Freelandoo.',
      'Siga também as instrucoes_do_vendedor quando não conflitarem com as regras acima.',
    ],
  }

  const { rows: [last] } = await pool.query(
    `SELECT COALESCE(MAX(versao), 0) AS max_versao FROM app.empresa_contexto_versoes WHERE contexto_id = $1`,
    [conexao.contextoId]
  )
  const { rows: [versao] } = await pool.query(
    `INSERT INTO app.empresa_contexto_versoes (contexto_id, empresa_id, versao, conteudo_json, conteudo_markdown, gerado_por, status)
     VALUES ($1, $2, $3, $4, $5, 'ia', 'rascunho') RETURNING id`,
    [conexao.contextoId, conexao.empresaId, Number(last.max_versao) + 1, JSON.stringify(conteudoJson), markdown]
  )
  await ativarContexto2({ pool, empresaId: conexao.empresaId, versaoId: versao.id, userId: null })
  await marcarPlaybookGerado(instanceId)
  logger.info({ instanceId, versaoId: versao.id }, 'Freelandoo provision: playbook gerado e ativado')
  return { ok: true, versaoId: versao.id }
}

// Atualiza SÓ as instruções extras na versão ativa (config mudou; sem re-LLM).
async function atualizarInstrucoesNaVersaoAtiva(instanceId, extraInstructions) {
  const conexao = await buscarConexaoDescriptografada(instanceId)
  if (!conexao?.contextoId) return
  await pool.query(
    `UPDATE app.empresa_contexto_versoes
        SET conteudo_json = jsonb_set(conteudo_json, '{instrucoes_do_vendedor}', to_jsonb($2::text))
      WHERE contexto_id = $1 AND status = 'ativo'`,
    [conexao.contextoId, String(extraInstructions || '').slice(0, EXTRA_INSTRUCTIONS_MAX)]
  )
}

function dispararPlaybookEmBackground(instanceId) {
  setImmediate(async () => {
    try {
      const r = await gerarEAtivarPlaybook(instanceId)
      if (!r.ok) logger.warn({ instanceId, motivo: r.motivo }, 'Freelandoo provision: playbook não gerado')
    } catch (err) {
      logger.error({ instanceId, err: err.message }, 'Freelandoo provision: falha ao gerar playbook')
    }
  })
}

// ─── POST /freelandoo/provision (upsert por external_id) ────────────────────
router.post('/provision', requireProvisionSecret, async (req, res) => {
  const body = req.body || {}
  const externalId = String(body.external_id || '').trim()
  if (!externalId) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'external_id obrigatório.' } })
  }
  const token = body.token_atendimento ? String(body.token_atendimento) : undefined
  const tokenData = body.token_data ? String(body.token_data) : undefined
  const tokenLimit = body.token_limit_monthly !== undefined ? Math.max(0, Math.round(Number(body.token_limit_monthly) || 0)) : undefined
  const cycleStart = body.cycle_start ? new Date(body.cycle_start) : undefined
  const config = body.config !== undefined ? sanitizarConfig(body.config) : undefined

  try {
    let conexao = await buscarConexaoPorExternalId(externalId)

    if (!conexao) {
      // 1ª vez: precisa dos DOIS tokens pra nascer funcional.
      if (!token || !tokenData) {
        return res.status(400).json({ ok: false, error: { code: 'TOKENS_OBRIGATORIOS', message: 'Primeira ativação exige token_atendimento e token_data.' } })
      }
      const empresaId = await garantirEmpresa()
      const label = String(body.label || '').trim() || `freelandoo-${externalId.slice(0, 8)}`
      const evolutionInstance = `fl-ia-${externalId.replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase()}-${crypto.randomBytes(2).toString('hex')}`

      const client = await pool.connect()
      let inst
      try {
        await client.query('BEGIN')
        const { rows: [ctx] } = await client.query(
          `INSERT INTO app.empresa_contextos (empresa_id, nome, conteudo, contexto_form_json)
           VALUES ($1, $2, '', '{}'::jsonb) RETURNING id`,
          [empresaId, `Atendimento IA — ${label}`]
        )
        const { rows: [row] } = await client.query(
          `INSERT INTO app.empresa_whatsapp_instances (empresa_id, evolution_instance, nome, config_json, contexto_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [empresaId, evolutionInstance, `Atendimento IA — ${label}`, JSON.stringify({ canal: 'freelandoo', origem: 'atendimento_ia' }), ctx.id]
        )
        inst = row
        await salvarConexao(client, {
          instanceId: inst.id,
          empresaId,
          baseUrl: BASE_URL_PADRAO,
          token,
          connectionName: 'Atendimento IA',
          username: label,
          scopePersonal: false,
          webhookUrl: null,
          meta: { origem: 'atendimento_ia', external_id: externalId },
        })
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }

      await atualizarProvisionamento(inst.id, {
        externalId,
        tokenData,
        tokenLimitMonthly: tokenLimit ?? null,
        cycleStart: cycleStart || new Date(),
        config: config || sanitizarConfig({}),
      })
      await registrarWebhookDaInstancia(inst.id, token)
      dispararPlaybookEmBackground(inst.id)
      logger.info({ externalId, instanceId: inst.id }, 'Freelandoo provision: instância criada')
      return res.status(201).json({ ok: true, created: true, instance_id: inst.id })
    }

    // Upsert: atualiza o que veio. Tokens novos ⇒ re-registra webhook + playbook.
    await atualizarProvisionamento(conexao.instanceId, {
      externalId,
      token,
      tokenData,
      tokenLimitMonthly: tokenLimit,
      cycleStart,
      config,
    })
    // Reativa a instância (pode ter sido desprovisionada e recomprada).
    await pool.query(`UPDATE app.empresa_whatsapp_instances SET ativo = TRUE WHERE id = $1`, [conexao.instanceId])

    if (token) await registrarWebhookDaInstancia(conexao.instanceId, token)
    if (tokenData) {
      dispararPlaybookEmBackground(conexao.instanceId)
    } else if (config !== undefined) {
      await atualizarInstrucoesNaVersaoAtiva(conexao.instanceId, config.extra_instructions)
    }
    logger.info({ externalId, instanceId: conexao.instanceId }, 'Freelandoo provision: instância atualizada')
    return res.json({ ok: true, created: false, instance_id: conexao.instanceId })
  } catch (err) {
    logger.error({ externalId, err: err.message }, 'Freelandoo provision: falha')
    return res.status(500).json({ ok: false, error: { code: 'PROVISION_FALHOU', message: err.message } })
  }
})

// ─── POST /freelandoo/deprovision ────────────────────────────────────────────
router.post('/deprovision', requireProvisionSecret, async (req, res) => {
  const externalId = String(req.body?.external_id || '').trim()
  if (!externalId) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'external_id obrigatório.' } })
  }
  const conexao = await buscarConexaoPorExternalId(externalId)
  if (!conexao) return res.json({ ok: true, already: true })
  await pool.query(`UPDATE app.empresa_whatsapp_instances SET ativo = FALSE WHERE id = $1`, [conexao.instanceId])
  logger.info({ externalId, instanceId: conexao.instanceId }, 'Freelandoo provision: instância desativada')
  return res.json({ ok: true })
})

// ─── GET /freelandoo/usage/:external_id ──────────────────────────────────────
router.get('/usage/:externalId', requireProvisionSecret, async (req, res) => {
  const conexao = await buscarConexaoPorExternalId(String(req.params.externalId || ''))
  if (!conexao) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Conexão não encontrada.' } })
  const limit = conexao.tokenLimitMonthly
  return res.json({
    cycle_start: conexao.cycleStart,
    tokens_used: conexao.tokensUsed,
    token_limit: limit,
    paused_by_limit: !!(limit && conexao.tokensUsed >= limit),
    paused_by_config: sanitizarConfig(conexao.config).paused,
    active: !!conexao.ativo,
    playbook_generated_at: conexao.playbookGeneratedAt,
  })
})

// Refresh diário do playbook (preços/serviços novos entram em <=24h).
function iniciarRefreshDiarioDePlaybooks() {
  const DAY_MS = 24 * 60 * 60 * 1000
  const tick = async () => {
    try {
      const ids = await listarProvisionadasAtivas()
      for (const instanceId of ids) {
        try {
          await gerarEAtivarPlaybook(instanceId)
        } catch (err) {
          logger.warn({ instanceId, err: err.message }, 'Freelandoo provision: refresh de playbook falhou')
        }
      }
      if (ids.length) logger.info({ count: ids.length }, 'Freelandoo provision: refresh diário de playbooks')
    } catch (err) {
      logger.error({ err: err.message }, 'Freelandoo provision: refresh diário falhou')
    }
  }
  setTimeout(tick, 10 * 60 * 1000) // 10 min após o boot
  const timer = setInterval(tick, DAY_MS)
  if (timer.unref) timer.unref()
}

module.exports = router
module.exports.iniciarRefreshDiarioDePlaybooks = iniciarRefreshDiarioDePlaybooks
module.exports.gerarEAtivarPlaybook = gerarEAtivarPlaybook
