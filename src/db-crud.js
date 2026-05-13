'use strict'

const { validarAtualizarPerfilLead } = require('./domainSchemas')
const {
  LEAD_CONTEXTO_MAX_CHARS,
  LEAD_CONTEXTO_PROMPT_LIMIT,
  FOLLOWUP_SNIPPET_MAX_CHARS,
  FOLLOWUP_ERRO_LOG_MAX_CHARS,
  FOLLOWUP_ATRIBUICAO_RESPOSTA_DIAS,
} = require('./config')

const LEAD_PROFILE_CAMPOS_PERMITIDOS = new Set([
  'negocio',
  'cidade',
  'ticket_cliente_final',
  'ja_aparece_google',
  'concorrentes',
  'termometro_dor',
  'complexidade',
  'score_dor',
  'plano_sugerido',
  'preco_calculado',
  'entrada',
  'parcela',
  'precificacao_json',
  'pronto_handoff',
  'temperatura_lead',
  'precisa_sistema',
  'origem',
  'contexto_prospeccao',
  'maturidade_digital',
  'origem_anuncio',
  'intencao_principal',
  'produto_sugerido',
  'eventos_conversa',
  'reuniao_proposta',
  'dor_principal',
  'confusao_site_anuncio_google',
  'explicacao_teste_gratis_enviada',
  'expectativa_google_alinhada',
  'personalizacao_nicho_cidade_enviada',
])

const LEAD_PROFILE_CAMPOS_JSON = new Set([
  'precificacao_json',
  'maturidade_digital',
  'contexto_prospeccao',
  'origem_anuncio',
  'eventos_conversa',
  'reuniao_proposta',
])

const LEAD_PROFILE_FLAGS_BOOLEAN = new Set([
  'confusao_site_anuncio_google',
  'explicacao_teste_gratis_enviada',
  'expectativa_google_alinhada',
  'personalizacao_nicho_cidade_enviada',
])

const LEAD_CAMPOS_DIAGNOSTICO = new Set([
  'negocio',
  'cidade',
  'ticket_cliente_final',
  'ja_aparece_google',
  'concorrentes',
  'termometro_dor',
  'complexidade',
  'score_dor',
  'temperatura_lead',
  'precisa_sistema',
  'maturidade_digital',
  'origem_anuncio',
  'intencao_principal',
  'produto_sugerido',
  'dor_principal',
])

const MAX_TEMA_LACUNA_CHARS = 120
const MAX_DETALHE_LACUNA_CHARS = 500

function createDbCrud({ pool, logger, serializeError }) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('createDbCrud: pool invalido')
  }
  const log = logger || console

  function resumirTextoOperacional(raw, maxLen = 240) {
    const texto = String(raw == null ? '' : raw)
      .replace(/\s+/g, ' ')
      .trim()
    if (!texto) return ''
    return texto.length > maxLen ? `${texto.slice(0, maxLen - 1)}...` : texto
  }

  function mensagemFalhaRespostaParaPersistencia(falha) {
    const resumo = resumirTextoOperacional(falha?.resumo || '', 140)
    const detalhe = resumirTextoOperacional(falha?.detalhe || '', 500)
    if (!resumo) return detalhe
    if (!detalhe || detalhe === resumo) return resumo
    return `${resumo}. ${detalhe}`
  }

  async function buscarConversa(numero) {
    const { rows } = await pool.query('SELECT * FROM vendas.conversas WHERE numero = $1', [numero])
    return rows[0] || null
  }

  async function salvarConversa(numero, historico, estagio, status = 'ativo', agentePausado = undefined) {
    const arr = Array.isArray(historico) ? historico : []
    let jsonText
    try {
      jsonText = JSON.stringify(arr)
    } catch (e) {
      throw new Error(`historico nao serializavel: ${e.message}`)
    }
    if (agentePausado === undefined) {
      await pool.query(
        `
        INSERT INTO vendas.conversas (numero, historico, estagio, status)
        VALUES ($1, $2::jsonb, $3, $4)
        ON CONFLICT (numero) DO UPDATE
        SET historico = EXCLUDED.historico,
            estagio = EXCLUDED.estagio,
            status = EXCLUDED.status,
            atualizado_em = NOW()
        `,
        [numero, jsonText, estagio, status]
      )
    } else {
      await pool.query(
        `
        INSERT INTO vendas.conversas (numero, historico, estagio, status, agente_pausado)
        VALUES ($1, $2::jsonb, $3, $4, $5)
        ON CONFLICT (numero) DO UPDATE
        SET historico = EXCLUDED.historico,
            estagio = EXCLUDED.estagio,
            status = EXCLUDED.status,
            agente_pausado = EXCLUDED.agente_pausado,
            atualizado_em = NOW()
        `,
        [numero, jsonText, estagio, status, agentePausado]
      )
    }
  }

  async function registrarFalhaResposta(numero, falha) {
    await pool.query(
      `
      UPDATE vendas.conversas
      SET ultima_falha_resposta_codigo = $2,
          ultima_falha_resposta_msg = $3,
          ultima_falha_resposta_em = NOW()
      WHERE numero = $1
      `,
      [numero, falha.codigo, mensagemFalhaRespostaParaPersistencia(falha)]
    )
  }

  async function limparFalhaResposta(numero) {
    await pool.query(
      `
      UPDATE vendas.conversas
      SET ultima_falha_resposta_codigo = NULL,
          ultima_falha_resposta_msg = NULL,
          ultima_falha_resposta_em = NULL
      WHERE numero = $1
      `,
      [numero]
    )
  }

  async function marcarFechada(numero) {
    await pool.query(
      'UPDATE vendas.conversas SET venda_fechada = true, atualizado_em = NOW() WHERE numero = $1',
      [numero]
    )
  }

  async function buscarPerfil(numero) {
    const { rows } = await pool.query('SELECT * FROM vendas.lead_profiles WHERE numero = $1', [numero])
    return rows[0] || {}
  }

  function normalizarTipoLeadContexto(tipo) {
    const t = String(tipo || '').trim().toLowerCase()
    if (['audio_reprocessado', 'audio_upload', 'ligacao', 'contexto_manual'].includes(t)) return t
    return 'contexto_manual'
  }

  function limparConteudoLeadContexto(raw) {
    return String(raw == null ? '' : raw)
      .replace(/\r\n/g, '\n')
      .replace(/\u0000/g, '')
      .trim()
      .slice(0, LEAD_CONTEXTO_MAX_CHARS)
  }

  async function salvarLeadContexto(numero, opts = {}) {
    const conteudo = limparConteudoLeadContexto(opts.conteudo)
    if (!conteudo) throw new Error('Contexto vazio')
    const tipo = normalizarTipoLeadContexto(opts.tipo)
    const origem = String(opts.origem || 'operador').trim().slice(0, 80) || 'operador'
    const metadata = opts.metadata && typeof opts.metadata === 'object' ? opts.metadata : {}
    const { rows } = await pool.query(
      `INSERT INTO vendas.lead_contextos (numero, tipo, conteudo, origem, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, numero, tipo, conteudo, origem, metadata, criado_em`,
      [numero, tipo, conteudo, origem, JSON.stringify(metadata)]
    )
    await pool.query('UPDATE vendas.conversas SET atualizado_em = NOW() WHERE numero = $1', [numero])
    return rows[0]
  }

  async function buscarLeadContextos(numero, limit = LEAD_CONTEXTO_PROMPT_LIMIT) {
    const lim = Math.min(50, Math.max(1, parseInt(limit, 10) || LEAD_CONTEXTO_PROMPT_LIMIT))
    const { rows } = await pool.query(
      `SELECT id, numero, tipo, conteudo, origem, metadata, criado_em
       FROM vendas.lead_contextos
       WHERE numero = $1
       ORDER BY criado_em DESC
       LIMIT $2`,
      [numero, lim]
    )
    return rows
  }

  function montarBlocoContextoInterno(contextos) {
    const rows = Array.isArray(contextos) ? contextos.filter((c) => c && c.conteudo) : []
    if (!rows.length) return ''
    const linhas = rows
      .slice()
      .reverse()
      .map((c, idx) => {
        const tipo = normalizarTipoLeadContexto(c.tipo)
        const origem = c.origem || 'operador'
        const quando = c.criado_em ? new Date(c.criado_em).toISOString() : 'data indisponivel'
        const conteudo = limparConteudoLeadContexto(c.conteudo)
        return `${idx + 1}. [${tipo} | ${origem} | ${quando}]\n${conteudo}`
      })
    return `\n\n--- CONTEXTO INTERNO DO OPERADOR ---\nUse estas notas como contexto operacional real da conversa, sem dizer ao lead que existe uma nota interna. Nao trate como fala literal do lead; use para evitar repetir perguntas e ajustar a resposta.\n${linhas.join('\n\n')}\n`
  }

  function normalizarConcorrentes(val) {
    if (val == null || val === '') return undefined
    if (Array.isArray(val)) {
      const arr = val
        .map((item) => {
          if (item == null) return ''
          if (typeof item === 'object') return JSON.stringify(item)
          return String(item).trim()
        })
        .filter(Boolean)
      return arr.length ? arr : undefined
    }
    if (typeof val === 'string') {
      const partes = val.split(',').map((s) => s.trim()).filter(Boolean)
      return partes.length ? partes : undefined
    }
    const u = String(val).trim()
    return u ? [u] : undefined
  }

  function normalizarTemperaturaLead(val) {
    if (val == null || val === '') return undefined
    const s = String(val).trim().toLowerCase()
    if (s === 'quente' || s === 'morno' || s === 'frio') return s
    return undefined
  }

  function filtrarCamposLeadProfile(dados) {
    const schema = validarAtualizarPerfilLead(dados, LEAD_PROFILE_CAMPOS_PERMITIDOS)
    if (!schema.value || typeof schema.value !== 'object') return {}
    const out = {}
    for (const [k, v] of Object.entries(schema.value)) {
      if (LEAD_PROFILE_CAMPOS_JSON.has(k)) {
        if (k === 'origem_anuncio' && v != null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) {
          continue
        }
        if (v != null && typeof v === 'object' && !Array.isArray(v)) out[k] = v
        continue
      }
      if (k === 'temperatura_lead') {
        const t = normalizarTemperaturaLead(v)
        if (t !== undefined) out[k] = t
        continue
      }
      if (LEAD_PROFILE_FLAGS_BOOLEAN.has(k)) {
        if (typeof v === 'boolean') out[k] = v
        continue
      }
      out[k] = v
    }
    return out
  }

  async function atualizarPerfil(numero, dados) {
    const d = filtrarCamposLeadProfile(dados)
    if (Object.prototype.hasOwnProperty.call(d, 'concorrentes')) {
      const norm = normalizarConcorrentes(d.concorrentes)
      if (norm === undefined) delete d.concorrentes
      else d.concorrentes = norm
    }

    const campos = Object.keys(d)
    if (!campos.length) return {}

    const agora = new Date().toISOString()
    const patchColetados = {}
    for (const k of campos) {
      if (!LEAD_CAMPOS_DIAGNOSTICO.has(k)) continue
      const v = d[k]
      if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue
      patchColetados[k] = agora
    }

    const sets = campos.map((k, i) => `${k} = $${i + 2}`).join(', ')
    const valores = campos.map((k) => d[k])

    await pool.query(
      `
      INSERT INTO vendas.lead_profiles (numero, ${campos.join(', ')})
      VALUES ($1, ${campos.map((_, i) => `$${i + 2}`).join(', ')})
      ON CONFLICT (numero) DO UPDATE SET ${sets}, atualizado_em = NOW()
      `,
      [numero, ...valores]
    )

    if (Object.keys(patchColetados).length > 0) {
      await pool.query(
        `
        UPDATE vendas.lead_profiles
        SET campos_coletados = (
          SELECT jsonb_object_agg(k, v)
          FROM (
            SELECT key AS k, value AS v FROM jsonb_each(COALESCE(campos_coletados, '{}'::jsonb))
            UNION ALL
            SELECT key AS k, value AS v FROM jsonb_each($2::jsonb)
            WHERE key NOT IN (
              SELECT key FROM jsonb_each(COALESCE(campos_coletados, '{}'::jsonb))
            )
          ) t
        )
        WHERE numero = $1
        `,
        [numero, JSON.stringify(patchColetados)]
      )
    }

    return d
  }

  async function registrarFollowupEnvio(numero, opts) {
    const modo = opts.modo === 'fluxo_funil' ? 'fluxo_funil' : 'reengajamento'
    const ins =
      opts.instrucao_snippet != null && String(opts.instrucao_snippet).trim()
        ? String(opts.instrucao_snippet).trim().slice(0, FOLLOWUP_SNIPPET_MAX_CHARS)
        : null
    const prev =
      opts.mensagem_preview != null && String(opts.mensagem_preview).trim()
        ? String(opts.mensagem_preview).trim().slice(0, FOLLOWUP_SNIPPET_MAX_CHARS)
        : null
    const ok = !!opts.envio_ok
    const erro =
      opts.erro != null && String(opts.erro).trim()
        ? String(opts.erro).trim().slice(0, FOLLOWUP_ERRO_LOG_MAX_CHARS)
        : null
    try {
      await pool.query(
        `
        INSERT INTO vendas.followup_envios
          (numero, modo, instrucao_snippet, mensagem_preview, envio_ok, erro)
        VALUES ($1::text, $2::text, $3::text, $4::text, $5::boolean, $6::text)
        `,
        [numero, modo, ins, prev, ok, erro]
      )
    } catch (e) {
      log.error('registrarFollowupEnvio:', e.message)
    }
  }

  async function registrarEventoComercial(numero, tipo, detalhe = {}, origem = 'sistema') {
    const tipos = new Set(['pediu_preco', 'recebeu_proposta', 'respondeu_followup', 'recebeu_preview'])
    if (!tipos.has(tipo)) return false
    const org = origem === 'operador' ? 'operador' : 'sistema'
    let json = '{}'
    try {
      json = JSON.stringify(detalhe && typeof detalhe === 'object' ? detalhe : {})
    } catch (_) {}
    try {
      await pool.query(
        `
        INSERT INTO vendas.eventos_comerciais (numero, tipo, origem, detalhe)
        VALUES ($1::text, $2::text, $3::text, $4::jsonb)
        `,
        [numero, tipo, org, json]
      )
      return true
    } catch (e) {
      log.error('Erro ao registrar evento comercial:', e.message)
      return false
    }
  }

  async function marcarRespostaFollowupSeAplicavel(numero) {
    try {
      const r = await pool.query(
        `
        UPDATE vendas.followup_envios f
        SET resposta_lead_em = NOW()
        WHERE f.id = (
          SELECT id FROM vendas.followup_envios
          WHERE numero = $1::text
            AND envio_ok = true
            AND resposta_lead_em IS NULL
            AND criado_em > NOW() - ($2::int * INTERVAL '1 day')
          ORDER BY criado_em DESC
          LIMIT 1
        )
        `,
        [numero, FOLLOWUP_ATRIBUICAO_RESPOSTA_DIAS]
      )
      if (r.rowCount > 0) {
        await registrarEventoComercial(numero, 'respondeu_followup', {
          janela_dias: FOLLOWUP_ATRIBUICAO_RESPOSTA_DIAS,
        })
      }
    } catch (e) {
      log.error('marcarRespostaFollowupSeAplicavel:', e.message)
    }
  }

  async function buscarUltimoAprendizado() {
    const { rows } = await pool.query('SELECT resumo FROM vendas.aprendizado ORDER BY criado_em DESC LIMIT 1')
    return rows[0]?.resumo || null
  }

  async function contarVendasFechadas() {
    const { rows } = await pool.query('SELECT COUNT(*) as total FROM vendas.conversas WHERE venda_fechada = true')
    return parseInt(rows[0].total)
  }

  async function buscarVendasFechadas() {
    const { rows } = await pool.query(
      'SELECT historico FROM vendas.conversas WHERE venda_fechada = true ORDER BY atualizado_em DESC LIMIT 10'
    )
    return rows
  }

  async function registrarLacunaConhecimento(numero, tema, detalhe) {
    const tRaw = String(tema || '').trim().slice(0, MAX_TEMA_LACUNA_CHARS)
    const dRaw = String(detalhe || '').trim().slice(0, MAX_DETALHE_LACUNA_CHARS)
    if (!tRaw && !dRaw) return null
    const temaF = tRaw || 'geral'
    const detalheF = dRaw || tRaw

    const { rows } = await pool.query(
      `
      INSERT INTO vendas.conhecimento_lacunas (numero, tema_lacuna, detalhe_lacuna)
      SELECT $1::text, $2::text, $3::text
      WHERE NOT EXISTS (
        SELECT 1 FROM vendas.conhecimento_lacunas x
        WHERE x.numero = $1::text
          AND x.tema_lacuna = $2::text
          AND x.criado_em > NOW() - INTERVAL '24 hours'
      )
      RETURNING id
      `,
      [numero, temaF, detalheF]
    )
    return rows[0]?.id != null ? rows[0].id : null
  }

  async function registrarAudioProcessamento(numero, messageKey, msg, audioPart, patch = {}) {
    const status = ['pending', 'processed', 'failed'].includes(patch.status) ? patch.status : 'pending'
    const erro = patch.erro ? resumirTextoOperacional(patch.erro, 800) : null
    const transcricao = typeof patch.transcricao === 'string' && patch.transcricao.trim() ? patch.transcricao.trim() : null
    const mimetype = patch.mimetype || audioPart?.mimetype || null
    const payload = msg && typeof msg === 'object' ? JSON.stringify(msg) : null
    const key = messageKey || null
    const { rows } = await pool.query(
      `INSERT INTO vendas.audio_processamentos
         (numero, message_key, web_message_info, mimetype, status, attempts, erro, transcricao, processado_em)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, CASE WHEN $5 = 'processed' THEN NOW() ELSE NULL END)
       ON CONFLICT (message_key) DO UPDATE
       SET web_message_info = COALESCE(EXCLUDED.web_message_info, vendas.audio_processamentos.web_message_info),
           mimetype = COALESCE(EXCLUDED.mimetype, vendas.audio_processamentos.mimetype),
           status = EXCLUDED.status,
           attempts = vendas.audio_processamentos.attempts + EXCLUDED.attempts,
           erro = EXCLUDED.erro,
           transcricao = COALESCE(EXCLUDED.transcricao, vendas.audio_processamentos.transcricao),
           processado_em = CASE WHEN EXCLUDED.status = 'processed' THEN NOW() ELSE vendas.audio_processamentos.processado_em END,
           atualizado_em = NOW()
       RETURNING id, numero, message_key, status, attempts, erro, transcricao, criado_em, atualizado_em, processado_em`,
      [numero, key, payload, mimetype, status, patch.incrementAttempt ? 1 : 0, erro, transcricao]
    )
    return rows[0]
  }

  async function webhookMensagemDeveSerProcessada(messageKey, numero) {
    if (!messageKey) return true
    try {
      const r = await pool.query(
        `INSERT INTO vendas.webhook_messages_processed (message_key, numero) VALUES ($1, $2)
         ON CONFLICT (message_key) DO NOTHING RETURNING message_key`,
        [messageKey, numero]
      )
      return r.rowCount > 0
    } catch (e) {
      log.warn('Idempotencia webhook (fail-open):', e.message)
      return true
    }
  }

  async function registrarChamadaAnthropic(opts = {}) {
    try {
      const usage =
        opts.usage && typeof opts.usage === 'object' && !Array.isArray(opts.usage)
          ? opts.usage
          : {}
      const metadata =
        opts.metadata && typeof opts.metadata === 'object' && !Array.isArray(opts.metadata)
          ? opts.metadata
          : {}
      await pool.query(
        `
        INSERT INTO vendas.llm_chamadas (
          request_id, tipo, numero, model, estagio, duration_ms,
          http_ok, http_status, stop_reason, round_index, stale_retry,
          usage, erro_codigo, erro_msg, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15::jsonb)
        `,
        [
          opts.request_id || null,
          opts.tipo || 'anthropic',
          opts.numero || null,
          opts.model || null,
          opts.estagio || null,
          Number.isFinite(opts.duration_ms) ? Math.max(0, Math.round(opts.duration_ms)) : null,
          opts.http_ok === false ? false : true,
          Number.isInteger(opts.http_status) ? opts.http_status : null,
          opts.stop_reason || null,
          Number.isInteger(opts.round_index) ? opts.round_index : null,
          opts.stale_retry === true,
          JSON.stringify(usage),
          opts.erro_codigo || null,
          opts.erro_msg ? String(opts.erro_msg).slice(0, 500) : null,
          JSON.stringify(metadata),
        ]
      )
    } catch (e) {
      if (typeof log.warn === 'function') {
        log.warn(
          { err: serializeError ? serializeError(e) : e, request_id: opts.request_id || null },
          'Falha ao registrar metrica Anthropic'
        )
      }
    }
  }

  return {
    buscarConversa,
    salvarConversa,
    registrarFalhaResposta,
    registrarChamadaAnthropic,
    limparFalhaResposta,
    marcarFechada,
    buscarPerfil,
    normalizarTipoLeadContexto,
    limparConteudoLeadContexto,
    salvarLeadContexto,
    buscarLeadContextos,
    montarBlocoContextoInterno,
    normalizarConcorrentes,
    normalizarTemperaturaLead,
    filtrarCamposLeadProfile,
    atualizarPerfil,
    registrarFollowupEnvio,
    registrarEventoComercial,
    marcarRespostaFollowupSeAplicavel,
    buscarUltimoAprendizado,
    contarVendasFechadas,
    buscarVendasFechadas,
    registrarLacunaConhecimento,
    registrarAudioProcessamento,
    webhookMensagemDeveSerProcessada,
  }
}

module.exports = { createDbCrud }
