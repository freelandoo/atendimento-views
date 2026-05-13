'use strict'

const {
  ANTHROPIC_KEY,
  ANTHROPIC_MESSAGES_URL,
  CLAUDE_TIMEOUT_MS,
  FOLLOWUP_INSTRUCAO_MAX_CHARS,
  JOB_MAX_ATTEMPTS,
  SILENCE_WATCHER_INTERVAL_MS,
  SILENCE_TRIGGER_MINUTES,
  FOLLOWUP_AUTO_SEQUENCIAS_COMERCIAIS_PADRAO,
  FOLLOWUP_AUTO_SEQUENCIAS_POR_ESTAGIO,
  FOLLOWUP_AUTO_ENCERRAMENTO_EXTRA,
  FOLLOWUP_AUTO_BUSINESS_TZ,
  FOLLOWUP_AUTO_DELAY_HORAS,
} = require('./config')

const FOLLOWUP_JANELAS_OTIMIZADAS = [
  { start: [8, 30], end: [10, 30] },
  { start: [11, 40], end: [13, 15] },
  { start: [14, 30], end: [17, 0] },
  { start: [18, 30], end: [20, 0] },
]

function createFollowupAuto(deps = {}) {
  const {
    pool,
    logger,
    axios,
    prompts,
    partesDataEmTimezone,
    utcParaDataLocalEmTimezone,
    adicionarDiasLocalEmTimezone,
    buscarAprendizadosAtivos,
    montarBlocoCorrecoesAprendizados,
    perfilResumidoParaFollowup,
    gerarRequestIdAnthropic,
    registrarChamadaAnthropic,
    statusHttpDeErroAnthropic,
    codigoErroAnthropic,
    mensagemErroAnthropic,
    parsearRespostaJsonClaude,
    normalizarHistoricoMensagens,
    executarFollowupUmNumero,
  } = deps

  function sequenciasComerciaisFollowupPorEstagio(estagio) {
    const key = String(estagio || '').trim().toLowerCase()
    return FOLLOWUP_AUTO_SEQUENCIAS_POR_ESTAGIO[key] || FOLLOWUP_AUTO_SEQUENCIAS_COMERCIAIS_PADRAO
  }
  
  function maxSequenciaFollowupAutoPorEstagio(estagio) {
    return sequenciasComerciaisFollowupPorEstagio(estagio) + FOLLOWUP_AUTO_ENCERRAMENTO_EXTRA
  }
  
  function isSequenciaEncerramentoFollowup(estagio, sequencia) {
    const seq = Math.max(1, parseInt(sequencia, 10) || 1)
    return seq > sequenciasComerciaisFollowupPorEstagio(estagio)
  }
  
  function horasPadraoFollowupAuto(sequencia) {
    const seq = Math.max(1, parseInt(sequencia, 10) || 1)
    return FOLLOWUP_AUTO_DELAY_HORAS[seq] || FOLLOWUP_AUTO_DELAY_HORAS[1]
  }
  
  function normalizarTimingOverrideHoras(raw) {
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) return null
    return Math.min(Math.max(n, 0.05), 168)
  }
  
  const FOLLOWUP_JANELAS_OTIMIZADAS = [
    { start: [8, 30], end: [10, 30] },
    { start: [11, 40], end: [13, 15] },
    { start: [14, 30], end: [17, 0] },
    { start: [18, 30], end: [20, 0] },
  ]
  
  function ajustarParaJanelaComercialFollowup(date, timeZone = FOLLOWUP_AUTO_BUSINESS_TZ) {
    const dt = date instanceof Date ? date : new Date(date)
    if (Number.isNaN(dt.getTime())) return dt
    
    function snapParaInicio(partes, h, m) {
      return utcParaDataLocalEmTimezone(
        { year: partes.year, month: partes.month, day: partes.day, hour: h, minute: m, second: 0 },
        timeZone
      )
    }
  
    let p
    try {
      p = partesDataEmTimezone(dt, timeZone)
    } catch (e) {
      logger.warn(`Timezone invalido para follow-up (${timeZone}); usando horario do servidor:`, e.message)
      const local = new Date(dt)
      const decLocal = local.getHours() + local.getMinutes() / 60
      for (const janela of FOLLOWUP_JANELAS_OTIMIZADAS) {
        const jStart = janela.start[0] + janela.start[1] / 60
        const jEnd = janela.end[0] + janela.end[1] / 60
        if (decLocal < jStart) {
          local.setHours(janela.start[0], janela.start[1], 0, 0)
          return local
        }
        if (decLocal < jEnd) return dt
      }
      const out = new Date(dt)
      out.setDate(out.getDate() + 1)
      out.setHours(FOLLOWUP_JANELAS_OTIMIZADAS[0].start[0], FOLLOWUP_JANELAS_OTIMIZADAS[0].start[1], 0, 0)
      return out
    }
  
    const decLocal = p.hour + p.minute / 60
    for (const janela of FOLLOWUP_JANELAS_OTIMIZADAS) {
      const jStart = janela.start[0] + janela.start[1] / 60
      const jEnd = janela.end[0] + janela.end[1] / 60
      if (decLocal < jStart) return snapParaInicio(p, janela.start[0], janela.start[1])
      if (decLocal < jEnd) return dt
    }
    const prox = adicionarDiasLocalEmTimezone(p, 1)
    return utcParaDataLocalEmTimezone(
      { ...prox, hour: FOLLOWUP_JANELAS_OTIMIZADAS[0].start[0], minute: FOLLOWUP_JANELAS_OTIMIZADAS[0].start[1], second: 0 },
      timeZone
    )
  }
  
  async function enfileirarJobFollowupAuto(agendamentoId, numero, agendadoPara) {
    const id = parseInt(agendamentoId, 10)
    const jid = typeof numero === 'string' ? numero.trim() : ''
    if (!id || !jid) return null
    const dedupe = `followup_auto:${id}`
    const payload = JSON.stringify({ agendamento_id: id, numero: jid })
    const { rows } = await pool.query(
      `
      INSERT INTO vendas.job_queue (tipo, dedupe_key, payload, status, attempts, max_attempts, available_at)
      VALUES ('followup_auto', $1, $2::jsonb, 'pending', 0, $3, $4::timestamptz)
      ON CONFLICT (dedupe_key) DO UPDATE SET
        payload = EXCLUDED.payload,
        status = CASE WHEN vendas.job_queue.status = 'processing' THEN vendas.job_queue.status ELSE 'pending' END,
        attempts = CASE WHEN vendas.job_queue.status = 'processing' THEN vendas.job_queue.attempts ELSE 0 END,
        available_at = EXCLUDED.available_at,
        atualizado_em = NOW()
      RETURNING id
      `,
      [dedupe, payload, JOB_MAX_ATTEMPTS, agendadoPara]
    )
    return rows[0]?.id || null
  }
  
  async function cancelarFollowupsAutoPendentes(numero, motivo = 'lead_respondeu') {
    const jid = typeof numero === 'string' ? numero.trim() : ''
    if (!jid) return 0
    const { rows } = await pool.query(
      `
      UPDATE vendas.followup_auto_agendamentos
      SET status = 'cancelado',
          cancelado_em = NOW(),
          motivo_decisao = LEFT(CONCAT(COALESCE(motivo_decisao, ''), CASE WHEN motivo_decisao IS NULL OR motivo_decisao = '' THEN '' ELSE ' | ' END, $2::text), 1000)
      WHERE numero = $1
        AND status = 'agendado'
      RETURNING job_id
      `,
      [jid, motivo]
    )
    const jobIds = rows.map((r) => r.job_id).filter((x) => x != null)
    if (jobIds.length) {
      await pool.query(
        `
        UPDATE vendas.job_queue
        SET status = 'completed',
            last_error = $2,
            locked_at = NULL,
            locked_until = NULL,
            atualizado_em = NOW()
        WHERE id = ANY($1::bigint[])
          AND status = 'pending'
        `,
        [jobIds, `cancelado: ${motivo}`]
      )
    }
    return rows.length
  }
  
  async function resumoEventosComerciaisFollowup(numero) {
    const jid = typeof numero === 'string' ? numero.trim() : ''
    const base = {
      pediu_preco: { ocorreu: false, quantidade: 0, ultimo_em: null },
      recebeu_proposta: { ocorreu: false, quantidade: 0, ultimo_em: null },
      respondeu_followup: { ocorreu: false, quantidade: 0, ultimo_em: null },
      recebeu_preview: { ocorreu: false, quantidade: 0, ultimo_em: null },
    }
    if (!jid) return base
    try {
      const { rows } = await pool.query(
        `
        SELECT tipo, COUNT(*)::int AS quantidade, MAX(criado_em) AS ultimo_em
        FROM vendas.eventos_comerciais
        WHERE numero = $1::text
          AND tipo IN ('pediu_preco', 'recebeu_proposta', 'respondeu_followup', 'recebeu_preview')
        GROUP BY tipo
        `,
        [jid]
      )
      for (const row of rows) {
        if (!Object.prototype.hasOwnProperty.call(base, row.tipo)) continue
        base[row.tipo] = {
          ocorreu: (parseInt(row.quantidade, 10) || 0) > 0,
          quantidade: parseInt(row.quantidade, 10) || 0,
          ultimo_em: row.ultimo_em ? new Date(row.ultimo_em).toISOString() : null,
        }
      }
    } catch (e) {
      logger.error('Erro ao resumir eventos comerciais para follow-up:', e.message)
    }
    return base
  }
  
  async function analisarTimingEInstrucao({ conversa, perfil, sequencia, silencioMin, ultimaMensagemIa }) {
    const timingPadraoHoras = horasPadraoFollowupAuto(sequencia)
    const encerramentoGentil = isSequenciaEncerramentoFollowup(conversa?.estagio, sequencia)
    const motivosFollowupPermitidos = new Set([
      'pediu_preco_sumiu',
      'proposta_enviada',
      'preview_sem_resposta',
      'demonstrou_interesse',
      'momento_comercial',
      'dor_nao_resolvida',
      'angulo_novo',
      'medo_de_investir',
      'sem_motivo_claro',
    ])
    const fallback = {
      horas: timingPadraoHoras,
      instrucao: encerramentoGentil
        ? 'Encerramento gentil: avise que fica a disposicao, sem pressao, e deixe a porta aberta para retomada futura. Nao tente reabrir com nova pergunta forte.'
        : null,
      motivo: encerramentoGentil
        ? `Fallback por regra fixa: encerramento gentil da sequencia ${sequencia}, ${timingPadraoHoras}h.`
        : `Fallback por regra fixa: sequencia ${sequencia}, ${timingPadraoHoras}h.`,
      motivoFollowup: 'sem_motivo_claro',
      origem: 'regra',
    }
    if (!ANTHROPIC_KEY) return fallback
  
    let prompt = prompts.FOLLOWUP_TIMING_PROMPT_BASE.trim() ||
      'Decida timing e instrucao de follow-up automatico. Responda apenas JSON valido.'
    const aprendTiming = await buscarAprendizadosAtivos('followup_timing')
    const blocoAprendTiming = montarBlocoCorrecoesAprendizados(aprendTiming)
    if (blocoAprendTiming) prompt = `${prompt}\n${blocoAprendTiming.trim()}`
    const eventosComerciais = await resumoEventosComerciaisFollowup(conversa?.numero)
    const payload = {
      sequencia,
      encerramento_gentil: encerramentoGentil,
      timing_padrao_horas: timingPadraoHoras,
      silencio_min: silencioMin,
      temperatura_lead: perfil?.temperatura_lead || null,
      termometro_dor: perfil?.termometro_dor ?? perfil?.score_dor ?? null,
      ultima_mensagem_ia: String(ultimaMensagemIa || '').slice(0, 1200),
      estagio: conversa?.estagio || 'primeiro_contato',
      eventos_comerciais: eventosComerciais,
      perfil: perfilResumidoParaFollowup(perfil),
      hora_atual_sp: (() => {
        try {
          const sp = partesDataEmTimezone(new Date(), FOLLOWUP_AUTO_BUSINESS_TZ)
          return sp.hour + sp.minute / 60
        } catch {
          return null
        }
      })(),
    }
  
    const model = 'claude-haiku-4-5-20251001'
    const requestId = gerarRequestIdAnthropic()
    const inicio = Date.now()
    try {
      const resp = await axios.post(
        ANTHROPIC_MESSAGES_URL,
        {
          model,
          max_tokens: 700,
          system: prompt,
          messages: [{ role: 'user', content: JSON.stringify(payload, null, 2) }],
        },
        {
          headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          timeout: Math.min(CLAUDE_TIMEOUT_MS, 30000),
        }
      )
      await registrarChamadaAnthropic({
        request_id: requestId,
        tipo: 'followup_timing',
        numero: conversa?.numero || null,
        model,
        estagio: conversa?.estagio || 'primeiro_contato',
        duration_ms: Date.now() - inicio,
        http_ok: true,
        http_status: resp.status,
        stop_reason: resp.data?.stop_reason || null,
        usage: resp.data?.usage,
        metadata: { sequencia, silencio_min: silencioMin, encerramento_gentil: encerramentoGentil },
      })
      const bruto = resp.data?.content?.[0]?.text || ''
      const parsed = parsearRespostaJsonClaude(bruto)
      if (!parsed || typeof parsed !== 'object') return fallback
      const manter = parsed.manter_timing_padrao !== false
      const override = normalizarTimingOverrideHoras(parsed.timing_override_horas)
      const horas = !manter && override != null ? override : timingPadraoHoras
      const instrucao =
        typeof parsed.instrucao_followup === 'string' && parsed.instrucao_followup.trim()
          ? parsed.instrucao_followup.trim().slice(0, FOLLOWUP_INSTRUCAO_MAX_CHARS)
          : fallback.instrucao
      const motivo =
        typeof parsed.motivo === 'string' && parsed.motivo.trim()
          ? parsed.motivo.trim().slice(0, 1000)
          : fallback.motivo
      const motivoFollowupRaw =
        typeof parsed.motivo_followup === 'string' && parsed.motivo_followup.trim()
          ? parsed.motivo_followup.trim()
          : fallback.motivoFollowup
      const motivoFollowup = motivosFollowupPermitidos.has(motivoFollowupRaw)
        ? motivoFollowupRaw
        : fallback.motivoFollowup
      return {
        horas,
        instrucao,
        motivo,
        motivoFollowup,
        origem: horas !== timingPadraoHoras ? 'claude_override' : 'regra',
      }
    } catch (e) {
      await registrarChamadaAnthropic({
        request_id: requestId,
        tipo: 'followup_timing',
        numero: conversa?.numero || null,
        model,
        estagio: conversa?.estagio || 'primeiro_contato',
        duration_ms: Date.now() - inicio,
        http_ok: false,
        http_status: statusHttpDeErroAnthropic(e),
        erro_codigo: codigoErroAnthropic(e),
        erro_msg: mensagemErroAnthropic(e),
        metadata: { sequencia, silencio_min: silencioMin, encerramento_gentil: encerramentoGentil },
      })
      logger.error('Erro ao analisar timing de follow-up automatico:', e.response?.data || e.message)
      return fallback
    }
  }
  
  async function agendarFollowupAutoParaConversa(row) {
    const numero = row.numero
    const maxSequencia = maxSequenciaFollowupAutoPorEstagio(row.estagio)
    const sequencia = Math.min(maxSequencia, Math.max(1, parseInt(row.sequencia, 10) || 1))
    const silencioMin = Math.max(0, parseInt(row.silencio_min, 10) || SILENCE_TRIGGER_MINUTES)
    const conversa = {
      numero,
      estagio: row.estagio,
      status: row.status,
      historico: row.historico,
    }
    const perfil = {
      numero,
      negocio: row.negocio,
      cidade: row.cidade,
      temperatura_lead: row.temperatura_lead,
      termometro_dor: row.termometro_dor,
      score_dor: row.score_dor,
      plano_sugerido: row.plano_sugerido,
      preco_calculado: row.preco_calculado,
      precificacao_json: row.precificacao_json,
    }
    const analise = await analisarTimingEInstrucao({
      conversa,
      perfil,
      sequencia,
      silencioMin,
      ultimaMensagemIa: row.ultima_mensagem_ia,
    })
    const agendadoPara = ajustarParaJanelaComercialFollowup(
      new Date(Date.now() + analise.horas * 60 * 60 * 1000)
    )
    const horasAjustadas = Math.max(0, (agendadoPara.getTime() - Date.now()) / 3600000)
    const motivoAjustado =
      Math.abs(horasAjustadas - analise.horas) > 0.01
        ? `${analise.motivo} | motivo_followup=${analise.motivoFollowup || 'sem_motivo_claro'} | Ajustado para janela otimizada (${FOLLOWUP_AUTO_BUSINESS_TZ}).`
        : `${analise.motivo} | motivo_followup=${analise.motivoFollowup || 'sem_motivo_claro'}`
    const { rows } = await pool.query(
      `
      INSERT INTO vendas.followup_auto_agendamentos
        (numero, sequencia, silencio_min, agendado_para, instrucao_ia, motivo_decisao, timing_origem)
      VALUES (
        $1::text,
        $2::int,
        $3::int,
        $4::timestamptz,
        $5::text,
        $6::text,
        $7::text
      )
      RETURNING id, agendado_para
      `,
      [numero, sequencia, silencioMin, agendadoPara.toISOString(), analise.instrucao, motivoAjustado, analise.origem]
    )
    const ag = rows[0]
    const jobId = await enfileirarJobFollowupAuto(ag.id, numero, ag.agendado_para)
    await pool.query('UPDATE vendas.followup_auto_agendamentos SET job_id = $2 WHERE id = $1', [ag.id, jobId])
    logger.info(`Follow-up automatico agendado para ${numero} seq=${sequencia} em ${horasAjustadas.toFixed(2)}h`)
    return ag.id
  }
  
  /**
   * Grava follow-up automático em data/hora explícita (campo `agendar_followup_auto` do modelo).
   * @returns {Promise<number|null>} id do agendamento ou null
   */
  async function persistirAgendamentoFollowupExplicito(numero, agendarNorm, estagio) {
    if (!agendarNorm || !numero) return null
    const jid = typeof numero === 'string' ? numero.trim() : ''
    if (!jid) return null
    await cancelarFollowupsAutoPendentes(jid, 'substituido_agendamento_explicito')
    const agendadoPara = new Date(agendarNorm.agendar_para)
    if (Number.isNaN(agendadoPara.getTime())) return null
    const silencioMin = Math.max(0, Math.floor((agendadoPara.getTime() - Date.now()) / 60000))
    const { rows: cntRows } = await pool.query(
      `
      SELECT COUNT(*)::int AS n
      FROM vendas.followup_auto_agendamentos
      WHERE numero = $1::text AND status IN ('agendado', 'executado')
      `,
      [jid]
    )
    const totalAuto = parseInt(cntRows[0]?.n, 10) || 0
    const seqCap = maxSequenciaFollowupAutoPorEstagio(estagio || 'default')
    const sequencia = Math.min(seqCap, Math.max(1, totalAuto + 1))
    const instrTrim = String(agendarNorm.instrucao_followup || '').trim().slice(0, FOLLOWUP_INSTRUCAO_MAX_CHARS)
    const motivoDecisao = `Agendamento explicito pelo agente | ${instrTrim}`.slice(0, 1000)
    const { rows } = await pool.query(
      `
      INSERT INTO vendas.followup_auto_agendamentos
        (numero, sequencia, silencio_min, agendado_para, instrucao_ia, motivo_decisao, timing_origem)
      VALUES ($1::text, $2::int, $3::int, $4::timestamptz, $5::text, $6::text, $7::text)
      RETURNING id, agendado_para
      `,
      [jid, sequencia, silencioMin, agendadoPara.toISOString(), instrTrim, motivoDecisao, 'regra']
    )
    const ag = rows[0]
    if (!ag) return null
    const jobId = await enfileirarJobFollowupAuto(ag.id, jid, ag.agendado_para)
    await pool.query('UPDATE vendas.followup_auto_agendamentos SET job_id = $2 WHERE id = $1', [ag.id, jobId])
    logger.info(`Follow-up explicito agendado para ${jid} em ${ag.agendado_para}`)
    return ag.id
  }
  
  let silenceWatcherRodando = false
  let silenceWatcherTimer = null
  
  async function silenceWatcherTick() {
    if (silenceWatcherRodando) return
    silenceWatcherRodando = true
    try {
      await pool.query(
        `
        UPDATE vendas.conversas c
        SET status = 'aguardando_handoff',
            atualizado_em = NOW()
        WHERE c.status = 'ativo'
          AND COALESCE(c.agente_pausado, false) = false
          AND COALESCE(c.venda_fechada, false) = false
          AND COALESCE(jsonb_array_length(c.historico), 0) > 0
          AND (c.historico->-1->>'role') = 'assistant'
          AND c.atualizado_em <= NOW() - ($1::int * INTERVAL '1 minute')
          AND (
            SELECT COUNT(*)::int
            FROM vendas.followup_auto_agendamentos fa
            WHERE fa.numero = c.numero
              AND fa.status = 'executado'
          ) >= CASE
            WHEN c.estagio = 'primeiro_contato' THEN $2::int
            WHEN c.estagio IN ('proposta_enviada', 'negociacao') THEN $3::int
            ELSE $4::int
          END
          AND NOT EXISTS (
            SELECT 1
            FROM vendas.followup_auto_agendamentos fa
            WHERE fa.numero = c.numero
              AND fa.status = 'agendado'
          )
        `,
        [
          SILENCE_TRIGGER_MINUTES,
          maxSequenciaFollowupAutoPorEstagio('primeiro_contato'),
          maxSequenciaFollowupAutoPorEstagio('proposta_enviada'),
          maxSequenciaFollowupAutoPorEstagio('default'),
        ]
      )
      const { rows } = await pool.query(
        `
        WITH elegiveis AS (
          SELECT c.numero,
                 c.historico,
                 c.estagio,
                 c.status,
                 c.atualizado_em,
                 p.negocio,
                 p.cidade,
                 p.temperatura_lead,
                 p.termometro_dor,
                 p.score_dor,
                 p.plano_sugerido,
                 p.preco_calculado,
                 p.precificacao_json,
                 LEFT(COALESCE(c.historico->-1->>'content', ''), 1200) AS ultima_mensagem_ia,
                 GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - c.atualizado_em)) / 60))::int AS silencio_min,
                 (
                   SELECT COUNT(*)::int
                   FROM vendas.followup_auto_agendamentos fa
                   WHERE fa.numero = c.numero
                     AND fa.status IN ('agendado', 'executado')
                 ) AS total_auto
          FROM vendas.conversas c
          LEFT JOIN vendas.lead_profiles p ON p.numero = c.numero
          WHERE c.status = 'ativo'
            AND COALESCE(c.agente_pausado, false) = false
            AND COALESCE(c.venda_fechada, false) = false
            AND COALESCE(jsonb_array_length(c.historico), 0) > 0
            AND (c.historico->-1->>'role') = 'assistant'
            AND c.atualizado_em <= NOW() - ($1::int * INTERVAL '1 minute')
            AND NOT EXISTS (
              SELECT 1
              FROM vendas.followup_auto_agendamentos fa
              WHERE fa.numero = c.numero
                AND fa.status = 'agendado'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM vendas.job_queue q
              WHERE q.tipo = 'followup_auto'
                AND q.status IN ('pending', 'processing')
                AND q.payload->>'numero' = c.numero
            )
          ORDER BY c.atualizado_em ASC
          LIMIT 20
        )
        SELECT *, total_auto + 1 AS sequencia
        FROM elegiveis
        WHERE total_auto < CASE
          WHEN estagio = 'primeiro_contato' THEN $2::int
          WHEN estagio IN ('proposta_enviada', 'negociacao') THEN $3::int
          ELSE $4::int
        END
        `,
        [
          SILENCE_TRIGGER_MINUTES,
          maxSequenciaFollowupAutoPorEstagio('primeiro_contato'),
          maxSequenciaFollowupAutoPorEstagio('proposta_enviada'),
          maxSequenciaFollowupAutoPorEstagio('default'),
        ]
      )
      for (const row of rows) {
        try {
          await agendarFollowupAutoParaConversa(row)
        } catch (e) {
          logger.error('Erro ao agendar follow-up automatico:', e.response?.data || e.message)
        }
      }
    } catch (err) {
      logger.error('Erro no watcher de silencio:', err.message)
    } finally {
      silenceWatcherRodando = false
    }
  }
  
  function iniciarSilenceWatcher() {
    if (silenceWatcherTimer) return
    silenceWatcherTimer = setInterval(() => {
      silenceWatcherTick().catch((e) => logger.error('Erro no tick watcher silencio:', e.message))
    }, SILENCE_WATCHER_INTERVAL_MS)
    silenceWatcherTick().catch((e) => logger.error('Erro no primeiro tick watcher silencio:', e.message))
  }
  
  async function processarFollowupAutoJob(job) {
    const payload = job.payload && typeof job.payload === 'object' ? job.payload : {}
    const agendamentoId = parseInt(payload.agendamento_id, 10)
    const numero = typeof payload.numero === 'string' ? payload.numero : null
    if (!agendamentoId || !numero) throw new Error('Job followup_auto sem agendamento_id/numero')
  
    const { rows } = await pool.query(
      `
      SELECT fa.*, c.historico, c.status AS conversa_status, c.venda_fechada, c.agente_pausado
      FROM vendas.followup_auto_agendamentos fa
      JOIN vendas.conversas c ON c.numero = fa.numero
      WHERE fa.id = $1
      `,
      [agendamentoId]
    )
    const ag = rows[0]
    if (!ag || ag.status !== 'agendado') return
    const historico = normalizarHistoricoMensagens(ag.historico)
    const ultima = historico[historico.length - 1]
    const deveCancelar =
      ag.conversa_status !== 'ativo' ||
      ag.venda_fechada === true ||
      ag.agente_pausado === true ||
      !ultima ||
      ultima.role !== 'assistant'
  
    if (deveCancelar) {
      await pool.query(
        `
        UPDATE vendas.followup_auto_agendamentos
        SET status = 'cancelado',
            cancelado_em = NOW(),
            motivo_decisao = LEFT(CONCAT(COALESCE(motivo_decisao, ''), CASE WHEN motivo_decisao IS NULL OR motivo_decisao = '' THEN '' ELSE ' | ' END, 'cancelado antes da execucao: conversa mudou'), 1000)
        WHERE id = $1
        `,
        [agendamentoId]
      )
      return
    }
  
    try {
      await executarFollowupUmNumero(numero, ag.instrucao_ia)
      await pool.query(
        `UPDATE vendas.followup_auto_agendamentos SET status = 'executado', executado_em = NOW() WHERE id = $1`,
        [agendamentoId]
      )
    } catch (e) {
      const attempts = (parseInt(job.attempts, 10) || 0) + 1
      const final = attempts >= (parseInt(job.max_attempts, 10) || JOB_MAX_ATTEMPTS)
      await pool.query(
        `
        UPDATE vendas.followup_auto_agendamentos
        SET status = CASE WHEN $3::boolean THEN 'falhou' ELSE status END,
            motivo_decisao = LEFT(CONCAT(COALESCE(motivo_decisao, ''), CASE WHEN motivo_decisao IS NULL OR motivo_decisao = '' THEN '' ELSE ' | ' END, $2::text), 1000)
        WHERE id = $1
        `,
        [agendamentoId, `falha ao executar: ${e.message || e}`, final]
      )
      throw e
    }
  }

  return {
    sequenciasComerciaisFollowupPorEstagio,
    maxSequenciaFollowupAutoPorEstagio,
    isSequenciaEncerramentoFollowup,
    horasPadraoFollowupAuto,
    normalizarTimingOverrideHoras,
    ajustarParaJanelaComercialFollowup,
    enfileirarJobFollowupAuto,
    cancelarFollowupsAutoPendentes,
    resumoEventosComerciaisFollowup,
    analisarTimingEInstrucao,
    agendarFollowupAutoParaConversa,
    persistirAgendamentoFollowupExplicito,
    silenceWatcherTick,
    iniciarSilenceWatcher,
    processarFollowupAutoJob,
  }
}

module.exports = { createFollowupAuto }
