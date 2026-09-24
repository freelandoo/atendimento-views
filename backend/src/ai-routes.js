'use strict'

// O QUE AINDA SOBREVIVE AQUI DA GERACAO LEGADA, e por que.
//
// Este arquivo tinha 5 rotas `/dashboard/ai/*`. Duas sairam em 2026-09-24:
//   * `GET /dashboard/ai/presets` — duplicava `GET /api/llm`, que ja devolve os presets
//     JUNTO da configuracao atual;
//   * `GET /dashboard/ai/logs` — alem de ter substituto em `/api/llm/uso`, ela lia
//     `vendas.ai_logs` SEM filtro de empresa: um tenant via o log de IA dos outros.
//
// As tres que ficam NAO tem equivalente na geracao multiempresa, e apaga-las seria perder
// capacidade, nao limpar duplicata:
//   * `GET`/`POST /dashboard/ai/settings` — a UNICA superficie (leitura e escrita) de
//     `temperature`, `max_tokens` e `fallback_provider`/`fallback_model`/`fallback_enabled`.
//     `GET /api/llm` devolve provider/model/chaves/gen_*, e `PUT /geracao` e `POST /activate`
//     escrevem provider/model/chave — nenhum dos tres toca aqueles cinco campos.
//   * `POST /dashboard/ai/test` — faz uma GERACAO de verdade ponta a ponta (com
//     `disableFallback`, para provar o caminho principal). O `POST /api/llm/test` moderno e'
//     outra coisa: valida uma credencial listando modelos, sem gerar nada.
//
// Fechar essa lacuna e' trabalho da API multiempresa, com decisao de produto junto: os cinco
// campos sao GLOBAIS hoje, e a geracao atual e' por empresa. Nao e' efeito colateral de uma
// remocao — por isso as tres continuam aqui, declaradas, em vez de sumirem caladas.

const { pool } = require('./db')
const { dashboardAutorizado } = require('./dashboardAuth')
const { invalidateCache, validarProviderModel, AI_MODEL_PRESETS } = require('./ai-provider')

const VALID_PROVIDERS = ['openai', 'anthropic']
const TEMPERATURE_MIN = 0
const TEMPERATURE_MAX = 2
const MAX_TOKENS_MIN = 100
const MAX_TOKENS_MAX = 16000

/**
 * Middleware que exige usuario admin autenticado.
 * Importante: `dashboardAutorizado` em `./dashboardAuth` e um predicate `(req) => boolean`,
 * NAO um middleware Express. Antes ele era usado direto como middleware nas rotas, e
 * como nao chama `next()`, todas as rotas /dashboard/ai/* ficavam penduradas — causa raiz
 * dos bugs de "carregando infinito", "salvar nao salva" e "testar nao responde".
 *
 * A autenticacao/CSRF de sessao ja e aplicada globalmente em index.js via
 * `app.use('/dashboard', requireDashboardAuth)`. Este wrapper apenas garante que o
 * usuario chegou autenticado como admin e segue o fluxo.
 */
function exigirAdmin(req, res, next) {
  if (!dashboardAutorizado(req)) {
    return res.status(403).json({ ok: false, erro: 'Acesso restrito a administradores.' })
  }
  next()
}

function defaultSettingsRow() {
  return {
    id: null,
    provider: 'openai',
    model: 'gpt-4o-mini',
    temperature: 0.4,
    max_tokens: 1200,
    fallback_provider: 'anthropic',
    fallback_model: 'claude-sonnet-4-6',
    fallback_enabled: true,
    created_at: null,
    updated_at: null,
  }
}

function normalizarSettings(row) {
  if (!row || typeof row !== 'object') return defaultSettingsRow()
  return {
    id: row.id ?? null,
    provider: row.provider || 'openai',
    model: row.model || 'gpt-4o-mini',
    temperature: row.temperature != null ? Number(row.temperature) : 0.4,
    max_tokens: row.max_tokens != null ? Number(row.max_tokens) : 1200,
    fallback_provider: row.fallback_provider || 'anthropic',
    fallback_model: row.fallback_model || 'claude-sonnet-4-6',
    fallback_enabled: row.fallback_enabled !== false,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  }
}

function registerAIRoutes(app) {
  app.get('/dashboard/ai/settings', exigirAdmin, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM vendas.ai_settings ORDER BY updated_at DESC LIMIT 1'
      )
      const settings = rows.length ? normalizarSettings(rows[0]) : defaultSettingsRow()
      res.json({ ok: true, settings })
    } catch (e) {
      res.status(500).json({ ok: false, erro: e.message })
    }
  })

  app.post('/dashboard/ai/settings', exigirAdmin, async (req, res) => {
    try {
      const b = req.body || {}
      const provider = String(b.provider || 'openai')
      const model = String(b.model || '').trim().slice(0, 120)
      const temperature = Number.isFinite(parseFloat(b.temperature)) ? parseFloat(b.temperature) : 0.4
      const max_tokens = Number.isFinite(parseInt(b.max_tokens, 10)) ? parseInt(b.max_tokens, 10) : 1200
      const fallback_provider = String(b.fallback_provider || 'anthropic')
      const fallback_model = String(b.fallback_model || '').trim().slice(0, 120)
      const fallback_enabled = b.fallback_enabled !== false && b.fallback_enabled !== 'false'

      if (!VALID_PROVIDERS.includes(provider)) {
        return res.status(400).json({ ok: false, erro: 'Provedor principal inválido.' })
      }
      if (!model) {
        return res.status(400).json({ ok: false, erro: 'Selecione um modelo principal.' })
      }
      const compatPrincipal = validarProviderModel(provider, model)
      if (!compatPrincipal.ok) {
        return res.status(400).json({ ok: false, erro: compatPrincipal.erro })
      }
      if (temperature < TEMPERATURE_MIN || temperature > TEMPERATURE_MAX) {
        return res.status(400).json({ ok: false, erro: `Criatividade precisa estar entre ${TEMPERATURE_MIN} e ${TEMPERATURE_MAX}.` })
      }
      if (max_tokens < MAX_TOKENS_MIN || max_tokens > MAX_TOKENS_MAX) {
        return res.status(400).json({ ok: false, erro: `Máx. tokens precisa estar entre ${MAX_TOKENS_MIN} e ${MAX_TOKENS_MAX}.` })
      }
      if (fallback_enabled) {
        if (!VALID_PROVIDERS.includes(fallback_provider)) {
          return res.status(400).json({ ok: false, erro: 'Provedor de fallback inválido.' })
        }
        if (!fallback_model) {
          return res.status(400).json({ ok: false, erro: 'Selecione um modelo de fallback.' })
        }
        const compatFb = validarProviderModel(fallback_provider, fallback_model)
        if (!compatFb.ok) {
          return res.status(400).json({ ok: false, erro: `Fallback: ${compatFb.erro}` })
        }
        if (fallback_provider === provider && fallback_model === model) {
          return res.status(400).json({
            ok: false,
            erro: 'O fallback deve usar um provedor diferente do principal (ou pelo menos um modelo diferente).',
          })
        }
      }

      const { rows: existing } = await pool.query(
        'SELECT id FROM vendas.ai_settings ORDER BY updated_at DESC LIMIT 1'
      )

      let result
      if (existing.length) {
        result = await pool.query(
          `UPDATE vendas.ai_settings
             SET provider=$1, model=$2, temperature=$3, max_tokens=$4,
                 fallback_provider=$5, fallback_model=$6, fallback_enabled=$7,
                 updated_at=NOW()
           WHERE id=$8 RETURNING *`,
          [provider, model, temperature, max_tokens, fallback_provider, fallback_model || 'claude-sonnet-4-6', fallback_enabled, existing[0].id]
        )
      } else {
        result = await pool.query(
          `INSERT INTO vendas.ai_settings
             (provider, model, temperature, max_tokens, fallback_provider, fallback_model, fallback_enabled)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [provider, model, temperature, max_tokens, fallback_provider, fallback_model || 'claude-sonnet-4-6', fallback_enabled]
        )
      }

      invalidateCache()
      res.json({
        ok: true,
        mensagem: 'Configurações salvas com sucesso.',
        settings: normalizarSettings(result.rows[0]),
      })
    } catch (e) {
      res.status(500).json({ ok: false, erro: e.message })
    }
  })

  app.post('/dashboard/ai/test', exigirAdmin, async (req, res) => {
    const { provider, model, scope } = req.body || {}
    if (provider && !VALID_PROVIDERS.includes(provider)) {
      return res.status(400).json({ ok: false, erro: 'Provedor inválido.' })
    }
    const { generateAIResponse } = require('./ai-provider')
    const inicio = Date.now()
    try {
      const result = await generateAIResponse(
        {
          systemPrompt: 'Você é o motor de IA da {{empresa}} em modo de verificação de conectividade.',
          userPrompt: 'Responda apenas: "Motor de IA ativo."',
          task: scope === 'fallback' ? 'teste_fallback' : 'teste_principal',
          provider: provider || undefined,
          model: model || undefined,
          maxTokens: 40,
          temperature: 0,
          timeoutMs: 15000,
          disableFallback: true,
        },
        pool,
        null
      )
      res.json({
        ok: true,
        provider: result.provider,
        provider_label: (AI_MODEL_PRESETS[result.provider] || {}).label || result.provider,
        model: result.model,
        text: result.text,
        latency_ms: Date.now() - inicio,
        fallback_used: result.fallback_used === true,
      })
    } catch (e) {
      res.status(502).json({
        ok: false,
        provider: provider || 'desconhecido',
        model: model || 'desconhecido',
        erro: e.message,
        latency_ms: Date.now() - inicio,
      })
    }
  })
}

module.exports = { registerAIRoutes, exigirAdmin, normalizarSettings, defaultSettingsRow }
