'use strict'

// Constantes do motor central. Antes este modulo chamava Anthropic diretamente;
// agora usa aiProvider.generateAIResponse para respeitar a configuracao do Motor de IA.

const LEAD_COACH_MAX_TRANSCRIPT_CHARS = 14000

function createLearning(deps = {}) {
  const {
    pool,
    logger,
    axios,
    prompts,
    aiProvider,
    normalizarHistoricoMensagens,
    textoDeContent,
    parsearRespostaJsonClaude,
    chamarClaudeAuxiliar,
    contarVendasFechadas,
    buscarVendasFechadas,
    buscarUltimoAprendizado,
    gerarRequestIdAnthropic,
    registrarChamadaAnthropic,
    statusHttpDeErroAnthropic,
    codigoErroAnthropic,
    mensagemErroAnthropic,
  } = deps

  function normalizarListaCoachAnalise(val) {
    if (!Array.isArray(val)) return []
    return val
      .map((item) => {
        if (item == null) return ''
        if (typeof item === 'string') return item.trim()
        if (typeof item === 'number' || typeof item === 'boolean') return String(item).trim()
        return ''
      })
      .filter(Boolean)
  }
  
  function normalizarSinaisCoach(val) {
    if (!val || typeof val !== 'object' || Array.isArray(val)) return {}
    const out = {}
    for (const [k, v] of Object.entries(val)) {
      const key = String(k || '').trim()
      if (!key) continue
      out[key] = v === true
    }
    return out
  }
  
  function normalizarScoreCoach(v) {
    const n = Number(v)
    if (!Number.isFinite(n)) return null
    return Math.max(0, Math.min(100, Math.round(n)))
  }

  function normalizarPreviaValorCoach(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null
    const clamp = (x) => {
      const n = Number(x)
      if (!Number.isFinite(n) || n <= 0) return null
      return Math.min(2000, Math.max(200, Math.round(n)))
    }
    const plano = ['iniciante', 'padrao', 'premium', 'sob_medida'].includes(v.plano) ? v.plano : null
    const out = {
      faixa_min: clamp(v.faixa_min),
      faixa_max: clamp(v.faixa_max),
      valor_alvo: clamp(v.valor_alvo),
      plano,
      justificativa: v.justificativa != null ? String(v.justificativa).trim().slice(0, 240) : '',
    }
    if (out.faixa_min && out.faixa_max && out.faixa_min > out.faixa_max) {
      const t = out.faixa_min; out.faixa_min = out.faixa_max; out.faixa_max = t
    }
    if (!out.faixa_min && !out.valor_alvo && plano !== 'sob_medida') return null
    return out
  }

  function normalizarAnaliseDetalhadaCoach(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null
    const out = {
      valor_percebido: normalizarListaCoachAnalise(v.valor_percebido),
      dores: normalizarListaCoachAnalise(v.dores),
      razoes_compra: normalizarListaCoachAnalise(v.razoes_compra),
      objecoes: normalizarListaCoachAnalise(v.objecoes),
    }
    if (!out.valor_percebido.length && !out.dores.length && !out.razoes_compra.length && !out.objecoes.length) return null
    return out
  }

  function normalizarLeadCoachPayload(payload) {
    const base = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
    const confianca = base.confianca != null ? String(base.confianca).trim() : ''
    const confiancaAnalise = base.confianca_analise != null ? String(base.confianca_analise).trim() : ''
    const etapa = base.etapa != null ? String(base.etapa).trim() : ''
    const statusConversa = base.status_conversa != null ? String(base.status_conversa).trim() : ''
    return {
      ...base,
      etapa: etapa || null,
      status_conversa: statusConversa || null,
      decisao_recomendada: base.decisao_recomendada != null ? String(base.decisao_recomendada).trim() : '',
      confianca: confianca || null,
      raciocinio: base.raciocinio != null ? String(base.raciocinio).trim() : '',
      proximos_passos: normalizarListaCoachAnalise(base.proximos_passos),
      riscos: normalizarListaCoachAnalise(base.riscos),
      sinais: normalizarSinaisCoach(base.sinais),
      perguntas_em_aberto: normalizarListaCoachAnalise(base.perguntas_em_aberto),
      resumo_problema: base.resumo_problema != null ? String(base.resumo_problema).trim() : '',
      o_que_faltou_para_vender: normalizarListaCoachAnalise(base.o_que_faltou_para_vender),
      melhorias_para_ia: normalizarListaCoachAnalise(base.melhorias_para_ia),
      sinais_melhoria_ia: normalizarListaCoachAnalise(base.sinais_melhoria_ia),
      acoes_de_preparo: normalizarListaCoachAnalise(base.acoes_de_preparo),
      confianca_analise: confiancaAnalise || confianca || null,
      prompt_gamma_apresentacao: base.prompt_gamma_apresentacao != null ? String(base.prompt_gamma_apresentacao).trim() : '',
      // Campos novos (IA analisa, código captura): score 0-100, prévia de valor e
      // análise detalhada. Ficam null quando o modelo não os fornece — sem inventar.
      score: normalizarScoreCoach(base.score),
      previa_valor: normalizarPreviaValorCoach(base.previa_valor),
      analise_detalhada: normalizarAnaliseDetalhadaCoach(base.analise_detalhada),
    }
  }
  
  function hidratarAnalisePosConversa(row) {
    if (!row) return null
    const payload = row.payload_coach && typeof row.payload_coach === 'object' ? row.payload_coach : {}
    return {
      ...row,
      etapa: row.etapa != null ? String(row.etapa).trim() : null,
      status_conversa: row.status_conversa != null ? String(row.status_conversa).trim() : null,
      o_que_faltou_para_vender: Array.isArray(row.o_que_faltou_para_vender) ? row.o_que_faltou_para_vender : [],
      melhorias_para_ia: Array.isArray(row.melhorias_para_ia) ? row.melhorias_para_ia : [],
      sinais_melhoria_ia: Array.isArray(row.sinais_melhoria_ia) ? row.sinais_melhoria_ia : [],
      acoes_de_preparo: Array.isArray(row.acoes_de_preparo) ? row.acoes_de_preparo : [],
      payload_coach: payload,
      coach: normalizarLeadCoachPayload(payload),
    }
  }
  
  async function salvarAnalisePosConversa(numero, coachPayload, conversa = null) {
    const coach = normalizarLeadCoachPayload(coachPayload)
    const payload =
      coachPayload && typeof coachPayload === 'object' && !Array.isArray(coachPayload) ? coachPayload : {}
    const etapa = coach.etapa || conversa?.estagio || 'primeiro_contato'
    const statusConversa = coach.status_conversa || conversa?.status || null
    const { rows } = await pool.query(
      `
      INSERT INTO vendas.analises_pos_conversa
        (numero, etapa, status_conversa, resumo_problema, o_que_faltou_para_vender, melhorias_para_ia, sinais_melhoria_ia, acoes_de_preparo, confianca_analise, payload_coach)
      VALUES ($1::text, $2::text, $3::text, $4::text, $5::text[], $6::text[], $7::text[], $8::text[], $9::text, $10::jsonb)
      RETURNING
        id, numero, etapa, status_conversa, resumo_problema, o_que_faltou_para_vender,
        melhorias_para_ia, sinais_melhoria_ia, acoes_de_preparo, confianca_analise,
        payload_coach, criado_em, atualizado_em
      `,
      [
        numero,
        etapa,
        statusConversa,
        coach.resumo_problema || null,
        coach.o_que_faltou_para_vender,
        coach.melhorias_para_ia,
        coach.sinais_melhoria_ia,
        coach.acoes_de_preparo,
        coach.confianca_analise,
        JSON.stringify(payload),
      ]
    )
    const salva = hidratarAnalisePosConversa(rows[0] || null)
  
    tentarConsolidacaoAutomatica().catch((e) =>
      logger.error('⚠️ consolidacao automatica (background):', e.message)
    )
  
    return salva
  }
  
  const CONSOLIDACAO_AUTO_THRESHOLD = 10
  
  async function tentarConsolidacaoAutomatica() {
    try {
      const n = await contarAnalisesDesdaUltimaConsolidacao()
      if (n < CONSOLIDACAO_AUTO_THRESHOLD) return
      const r = await consolidarAprendizadoAnalises()
      if (r.ok) {
        logger.info(`✅ consolidacao automatica: regra gerada (id ${r.aprendizado?.id}), aguardando aprovacao`)
      }
    } catch (_) { /* silencioso em background */ }
  }
  
  async function buscarUltimaAnalisePosConversa(numero, etapa = null) {
    const hasEtapa = etapa != null && String(etapa).trim() !== ''
    const { rows } = await pool.query(
      `
      SELECT
        id, numero, etapa, status_conversa, resumo_problema, o_que_faltou_para_vender,
        melhorias_para_ia, sinais_melhoria_ia, acoes_de_preparo, confianca_analise,
        payload_coach, criado_em, atualizado_em
      FROM vendas.analises_pos_conversa
      WHERE numero = $1
        ${hasEtapa ? 'AND etapa = $2' : ''}
      ORDER BY criado_em DESC
      LIMIT 1
      `,
      hasEtapa ? [numero, etapa] : [numero]
    )
    return hidratarAnalisePosConversa(rows[0] || null)
  }
  
  async function buscarHistoricoAnalisesPosConversa(numero, limit = 6) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 6, 1), 30)
    const { rows } = await pool.query(
      `
      SELECT
        id, numero, etapa, status_conversa, resumo_problema, o_que_faltou_para_vender,
        melhorias_para_ia, sinais_melhoria_ia, acoes_de_preparo, confianca_analise,
        payload_coach, criado_em, atualizado_em
      FROM vendas.analises_pos_conversa
      WHERE numero = $1
      ORDER BY criado_em DESC
      LIMIT $2
      `,
      [numero, safeLimit]
    )
    return rows.map((row) => hidratarAnalisePosConversa(row)).filter(Boolean)
  }
  
  async function salvarAprendizado(resumo) {
    await pool.query('INSERT INTO vendas.aprendizado (resumo) VALUES ($1)', [resumo])
  }
  
  // ─── AUTO-MELHORIA: CONSOLIDACAO DE APRENDIZADOS ─────────────────────────────
  
  const PROMPT_APRENDIZADOS_MAX_CHARS = 2000
  const PROMPT_ALVOS_VALIDOS = new Set(['system', 'followup', 'followup_timing'])
  
  function normalizarPromptAlvo(raw) {
    const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
    if (s === 'timing') return 'followup_timing'
    if (PROMPT_ALVOS_VALIDOS.has(s)) return s
    return 'system'
  }
  
  /** Heurística para diagnóstico de funil: classifica onde as regras devem atuar. */
  function inferirPromptAlvoDeTextoRegras(texto, etapa) {
    const t = `${texto || ''}`.toLowerCase()
    const et = `${etapa || ''}`.toLowerCase()
    const timingHints =
      /\b(timing|intervalo|horas?\s+(de|ate|entre)|sil[eê]ncio\s+(de|min|em)|override|janela\s+comercial|aguardar\s+\d|esperar\s+\d\s*(h|horas?))\b/i.test(
        t
      ) && /\b(follow|reengaj|mensagem|sequ[eê]ncia|auto)\b/i.test(t)
    if (timingHints) return 'followup_timing'
    const followHints =
      /\b(follow[-\s]?up|reengaj|p[oó]s[-\s]sil[eê]ncio|n[aã]o\s+respondeu|mensagem\s+de\s+retomada|lembrar\s+o\s+lead|reengajamento)\b/i.test(
        t
      ) || /\b(follow[-\s]?up|followup)\b/i.test(et)
    if (followHints) return 'followup'
    return 'system'
  }
  
  function montarBlocoCorrecoesAprendizados(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return ''
    const joined = rows
      .map((a) => (a && typeof a.regras === 'string' ? a.regras : ''))
      .filter(Boolean)
      .join('\n---\n')
      .slice(0, PROMPT_APRENDIZADOS_MAX_CHARS)
    if (!joined) return ''
    return `\n--- CORRECOES APRENDIDAS (baseadas em analises reais de conversas — obedeca) ---\n${joined}\n`
  }
  
  async function buscarAprendizadosAtivos(promptAlvo = 'system') {
    const alvo = normalizarPromptAlvo(promptAlvo)
    const { rows } = await pool.query(
      `SELECT id, etapa, tipo, regras, impacto, COALESCE(prompt_alvo, 'system') AS prompt_alvo FROM vendas.prompt_aprendizados
       WHERE ativo = true AND aprovado = true AND (aplicado_como IS NULL OR aplicado_como != 'overlay')
       AND COALESCE(prompt_alvo, 'system') = $1
       ORDER BY criado_em DESC LIMIT 10`,
      [alvo]
    )
    return rows
  }
  
  async function buscarAprendizadosPendentes() {
    const { rows } = await pool.query(
      `SELECT id, etapa, tipo, regras, total_analises, fonte_ids,
              COALESCE(prompt_alvo, 'system') AS prompt_alvo, criado_em
       FROM vendas.prompt_aprendizados
       WHERE ativo = true AND aprovado = false
       ORDER BY criado_em DESC LIMIT 20`
    )
    return rows
  }
  
  async function listarPromptAprendizados({ apenas_ativos } = {}) {
    const where = apenas_ativos ? 'WHERE ativo = true' : ''
    const { rows } = await pool.query(
      `SELECT id, etapa, tipo, regras, total_analises, fonte_ids, ativo, aprovado, impacto, aplicado_como,
              COALESCE(prompt_alvo, 'system') AS prompt_alvo, criado_em
       FROM vendas.prompt_aprendizados
       ${where}
       ORDER BY criado_em DESC LIMIT 50`
    )
    return rows
  }
  
  async function aprovarAprendizado(id) {
    const { rows } = await pool.query(
      `UPDATE vendas.prompt_aprendizados SET aprovado = true WHERE id = $1 AND ativo = true RETURNING id`,
      [id]
    )
    return rows[0] || null
  }
  
  async function desativarAprendizado(id) {
    const { rows } = await pool.query(
      `UPDATE vendas.prompt_aprendizados SET ativo = false WHERE id = $1 RETURNING id`,
      [id]
    )
    return rows[0] || null
  }
  
  async function contarAnalisesDesdaUltimaConsolidacao() {
    const { rows: ultRows } = await pool.query(
      `SELECT criado_em FROM vendas.prompt_aprendizados ORDER BY criado_em DESC LIMIT 1`
    )
    const desde = ultRows.length ? ultRows[0].criado_em : new Date(0)
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM vendas.analises_pos_conversa WHERE criado_em > $1`,
      [desde]
    )
    return rows[0]?.n || 0
  }
  
  async function consolidarAprendizadoAnalises({ etapa } = {}) {
    const { rows: ultConsolidacao } = await pool.query(
      `SELECT criado_em FROM vendas.prompt_aprendizados ORDER BY criado_em DESC LIMIT 1`
    )
    const desde = ultConsolidacao.length ? ultConsolidacao[0].criado_em : new Date(0)
  
    const etapaFilter = etapa ? 'AND etapa = $2' : ''
    const params = [desde]
    if (etapa) params.push(etapa)
  
    const { rows: analises } = await pool.query(
      `SELECT id, etapa, melhorias_para_ia, sinais_melhoria_ia, acoes_de_preparo, resumo_problema
       FROM vendas.analises_pos_conversa
       WHERE criado_em > $1 ${etapaFilter}
       ORDER BY criado_em DESC LIMIT 100`,
      params
    )
    if (analises.length < 3) {
      return { ok: false, motivo: `Apenas ${analises.length} analise(s) desde a ultima consolidacao (minimo 3).` }
    }
  
    const sinaisContagem = {}
    const melhoriasLista = []
    const fonteIds = []
    for (const a of analises) {
      fonteIds.push(a.id)
      if (Array.isArray(a.sinais_melhoria_ia)) {
        for (const s of a.sinais_melhoria_ia) {
          const key = String(s).trim().toLowerCase()
          if (key) sinaisContagem[key] = (sinaisContagem[key] || 0) + 1
        }
      }
      if (Array.isArray(a.melhorias_para_ia)) {
        for (const m of a.melhorias_para_ia) {
          if (m && typeof m === 'string') melhoriasLista.push(m.trim())
        }
      }
    }
  
    const sinaisRecorrentes = Object.entries(sinaisContagem)
      .filter(([, n]) => n >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
  
    if (sinaisRecorrentes.length === 0 && melhoriasLista.length < 3) {
      return { ok: false, motivo: 'Nenhum sinal recorrente (freq >= 3) identificado nas analises.' }
    }
  
    const etapasDominantes = {}
    for (const a of analises) {
      const e = a.etapa || 'geral'
      etapasDominantes[e] = (etapasDominantes[e] || 0) + 1
    }
    const etapaDominante = Object.entries(etapasDominantes).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  
    const systemConsolidacao =
      `Voce e engenheiro de prompts especializado em vendas consultivas via WhatsApp para PMEs no Brasil.\n\n` +
      `Voce recebe sinais recorrentes e sugestoes de melhoria extraidas de analises reais de conversas de vendas.\n\n` +
      `Sua tarefa: gerar um bloco CURTO de regras corretivas (maximo ${PROMPT_APRENDIZADOS_MAX_CHARS} caracteres) que sera injetado no system prompt do agente de vendas.\n\n` +
      `FORMATO OBRIGATORIO:\n` +
      `- PRIMEIRA LINHA: exatamente "ALVO: system" ou "ALVO: followup" ou "ALVO: followup_timing"\n` +
      `  - system: regras para o agente principal de vendas no funil (conversa ativa)\n` +
      `  - followup: regras para mensagens de reengajamento apos silencio do lead (follow-up)\n` +
      `  - followup_timing: regras sobre quando enviar follow-up, intervalos, sequencia ou silencio\n` +
      `- SEGUNDA LINHA: exatamente "IMPACTO: leve" ou "IMPACTO: estrutural"\n` +
      `  - leve: correcoes de comportamento, anti-patterns, lembretes pontuais\n` +
      `  - estrutural: protocolo novo, mudanca de fluxo do funil, regra que afeta todas as conversas de uma etapa\n` +
      `- Depois da linha de impacto: as regras numeradas\n` +
      `- Cada regra deve ser uma instrucao direta e acionavel para o agente de vendas\n` +
      `- Use numeracao (1, 2, 3...)\n` +
      `- Maximo 7 regras\n` +
      `- Sem explicacoes longas, sem introducao, sem conclusao\n` +
      `- Tom: instrucao operacional direta (como uma regra do system prompt)\n` +
      `- Nao repita regras que ja existem no prompt principal (objecao basica, micro-oferta, anti-textao)\n` +
      `- Foque em CORRECOES de comportamentos errados identificados nas analises\n` +
      `- Responda APENAS com as duas linhas iniciais (ALVO + IMPACTO) + bloco de regras, sem JSON, sem markdown`
  
    const userMessage =
      `SINAIS RECORRENTES (frequencia nas analises):\n` +
      sinaisRecorrentes.map(([s, n]) => `- ${s}: ${n}x`).join('\n') +
      `\n\nMELHORIAS SUGERIDAS PELAS ANALISES (amostra):\n` +
      melhoriasLista.slice(0, 20).map((m, i) => `${i + 1}. ${m}`).join('\n') +
      `\n\nETAPA DOMINANTE: ${etapaDominante || 'varias'}\nTOTAL DE ANALISES: ${analises.length}`
  
    const r = await chamarClaudeAuxiliar({
      tipo: 'consolidar_aprendizados',
      estagio: etapaDominante,
      system: systemConsolidacao,
      userMessage,
      // sem model hardcoded — usa o provider/modelo configurado no Motor de IA
      max_tokens: 800,
      temperature: 0.3,
      metadata: { total_analises: analises.length, sinais_top: sinaisRecorrentes.slice(0, 5).map(([s]) => s) },
    })
  
    if (!r.ok || !r.texto) {
      return { ok: false, motivo: r.errorCode || 'Erro ao gerar regras corretivas via Claude.' }
    }
  
    let textoCompleto = r.texto.trim()
    let impacto = 'leve'
    let promptAlvo = 'system'
    const matchAlvo = textoCompleto.match(/^ALVO:\s*(system|followup|followup_timing)\s*\n/i)
    if (matchAlvo) {
      promptAlvo = normalizarPromptAlvo(matchAlvo[1])
      textoCompleto = textoCompleto.slice(matchAlvo[0].length)
    }
    const matchImpacto = textoCompleto.match(/^IMPACTO:\s*(leve|estrutural)\s*\n/i)
    if (matchImpacto) {
      impacto = matchImpacto[1].toLowerCase()
      textoCompleto = textoCompleto.slice(matchImpacto[0].length)
    }
    const regras = textoCompleto.slice(0, PROMPT_APRENDIZADOS_MAX_CHARS)
  
    let rows
    try {
      ;({ rows } = await pool.query(
        `INSERT INTO vendas.prompt_aprendizados (etapa, tipo, regras, fonte_ids, total_analises, impacto, prompt_alvo)
         VALUES ($1, 'correcao', $2, $3, $4, $5, $6)
         RETURNING id, etapa, tipo, regras, total_analises, ativo, aprovado, impacto, prompt_alvo, criado_em`,
        [etapaDominante, regras, fonteIds.slice(0, 100), analises.length, impacto, promptAlvo]
      ))
    } catch (e) {
      if (e && e.code === '42703') {
        ;({ rows } = await pool.query(
          `INSERT INTO vendas.prompt_aprendizados (etapa, tipo, regras, fonte_ids, total_analises, impacto)
           VALUES ($1, 'correcao', $2, $3, $4, $5)
           RETURNING id, etapa, tipo, regras, total_analises, ativo, aprovado, impacto, criado_em`,
          [etapaDominante, regras, fonteIds.slice(0, 100), analises.length, impacto]
        ))
      } else {
        throw e
      }
    }
  
    return { ok: true, aprendizado: rows[0], sinais_top: sinaisRecorrentes.slice(0, 5) }
  }
  
  async function gerarAprendizadoDeFunilDiagnostico(diagnostico) {
    if (!diagnostico || !diagnostico.resultado) return null
    const { resultado, avaliacao_prompt, etapa } = diagnostico
    const problemas = resultado.problemas_por_gravidade || {}
    const alta = Array.isArray(problemas.alta) ? problemas.alta : []
    const media = Array.isArray(problemas.media) ? problemas.media : []
    const baixa = Array.isArray(problemas.baixa) ? problemas.baixa : []
    const padroes = Array.isArray(resultado.padroes_identificados) ? resultado.padroes_identificados : []
    const diagnosticos = Array.isArray(resultado.diagnostico_dos_leads) ? resultado.diagnostico_dos_leads : []
    const mensagensProntas = Array.isArray(resultado.mensagens_prontas) ? resultado.mensagens_prontas : []
    const mudancas = avaliacao_prompt && Array.isArray(avaliacao_prompt.principais_mudancas)
      ? avaliacao_prompt.principais_mudancas
      : []
    const fracos = avaliacao_prompt && Array.isArray(avaliacao_prompt.pontos_fracos_do_prompt)
      ? avaliacao_prompt.pontos_fracos_do_prompt
      : []
  
    const toStr = (x) => (typeof x === 'string' ? x.trim() : String(x || '').trim())
  
    let itens = [
      ...alta.map(toStr),
      ...media.map(toStr),
      ...baixa.map(toStr),
      ...mudancas.map(toStr),
      ...fracos.map(toStr),
      ...padroes.map(toStr),
      ...diagnosticos.map(toStr),
    ].filter(Boolean)
  
    const seen = new Set()
    itens = itens.filter((x) => {
      const k = x.slice(0, 160)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  
    if (itens.length < 2) {
      const resumo = toStr(resultado.resumo_geral)
      const proximo = toStr(resultado.proximo_passo_recomendado)
      if (resumo) itens.push(resumo)
      if (proximo) itens.push(proximo)
      for (const m of mensagensProntas) {
        const t = toStr(m)
        if (t) itens.push(t)
      }
    }
  
    if (itens.length === 0) return null
  
    if (itens.length === 1) {
      itens.push(
        `Revisar conducao da etapa "${etapa || 'primeiro_contato'}" com base no diagnostico de funil (id ${diagnostico.id || '?'}).`
      )
    }
  
    const prefix =
      `[Diagnostico de funil — etapa ${etapa || 'geral'} — ${diagnostico.total_conversas || 0} conversa(s) no contexto]\n\n`
    const regrasTexto = (prefix + itens.slice(0, 7).map((item, i) => `${i + 1}. ${item}`).join('\n')).slice(
      0,
      PROMPT_APRENDIZADOS_MAX_CHARS
    )
  
    const impacto = alta.length >= 3 || mudancas.length >= 2 ? 'estrutural' : 'leve'
    const etapaIns = etapa || 'primeiro_contato'
    const totalConv = diagnostico.total_conversas || 0
    const fonteIds = Number.isFinite(Number(diagnostico.id)) ? [Number(diagnostico.id)] : []
    const promptAlvoIns = inferirPromptAlvoDeTextoRegras(regrasTexto, etapaIns)
  
    try {
      const { rows } = await pool.query(
        `INSERT INTO vendas.prompt_aprendizados (etapa, tipo, regras, fonte_ids, total_analises, impacto, prompt_alvo)
         VALUES ($1, 'correcao_funil', $2, $3::bigint[], $4, $5, $6)
         RETURNING id, etapa, tipo, regras, total_analises, ativo, aprovado, impacto, prompt_alvo, criado_em`,
        [etapaIns, regrasTexto, fonteIds, totalConv, impacto, promptAlvoIns]
      )
      return rows[0] || null
    } catch (e) {
      if (e && e.code === '42703') {
        try {
          const { rows } = await pool.query(
            `INSERT INTO vendas.prompt_aprendizados (etapa, tipo, regras, fonte_ids, total_analises, impacto)
             VALUES ($1, 'correcao_funil', $2, $3::bigint[], $4, $5)
             RETURNING id, etapa, tipo, regras, total_analises, ativo, aprovado, impacto, criado_em`,
            [etapaIns, regrasTexto, fonteIds, totalConv, impacto]
          )
          return rows[0] || null
        } catch (e2) {
          if (e2 && e2.code === '42703') {
            const { rows } = await pool.query(
              `INSERT INTO vendas.prompt_aprendizados (etapa, tipo, regras, total_analises)
               VALUES ($1, 'correcao_funil', $2, $3)
               RETURNING id, etapa, tipo, regras, total_analises, ativo, aprovado, criado_em`,
              [etapaIns, regrasTexto, totalConv]
            )
            return rows[0] || null
          }
          throw e2
        }
      }
      throw e
    }
  }
  
  async function gerarAprendizado() {
    const total = await contarVendasFechadas()
    if (total < 3 || total % 3 !== 0) return
  
    const todasVendas = await buscarVendasFechadas()
    const vendas = todasVendas.slice(-5)
    const historicos = vendas
      .map(v => JSON.stringify(v.historico))
      .join('\n\n---\n\n')
      .slice(0, 8000)
  
    // Roteado via motor central: respeita provider/model configurado no Motor de IA.
    const requestId = gerarRequestIdAnthropic()
    const inicio = Date.now()
    let aprendizadoTexto
    try {
      const result = await aiProvider.generateAIResponse(
        {
          systemPrompt: 'Analise conversas de vendas fechadas e extraia padrões de sucesso em até 200 palavras.',
          userPrompt: `Analise ${vendas.length} vendas fechadas:\n\n${historicos}`,
          task: 'aprendizado',
          maxTokens: 500,
        },
        pool,
        logger
      )
      aprendizadoTexto = String(result?.text || '')
      if (result?.provider === 'anthropic') {
        await registrarChamadaAnthropic({
          request_id: requestId,
          tipo: 'aprendizado',
          model: result.model,
          duration_ms: Date.now() - inicio,
          http_ok: true,
          http_status: result.httpStatus || 200,
          stop_reason: result.stopReason || null,
          usage: result.usage,
          metadata: { vendas_analisadas: vendas.length, fallback_used: result.fallback_used === true },
        })
      }
    } catch (e) {
      await registrarChamadaAnthropic({
        request_id: requestId,
        tipo: 'aprendizado',
        model: 'desconhecido',
        duration_ms: Date.now() - inicio,
        http_ok: false,
        http_status: statusHttpDeErroAnthropic(e),
        erro_codigo: codigoErroAnthropic(e),
        erro_msg: mensagemErroAnthropic(e),
        metadata: { vendas_analisadas: vendas.length },
      })
      throw e
    }

    await salvarAprendizado(aprendizadoTexto)
    logger.info('✅ Aprendizado gerado.')
  }
  
  // ─── CLAUDE (resposta JSON estruturada) ───────────────────────────────────────

  function sanitizarContentMensagemDashboard(content) {
    if (content == null) return ''
    if (typeof content === 'string') {
      let s = content
      if (s.length > 6000 && /^[\sA-Za-z0-9+/=]+$/.test(s.slice(0, 400))) return '(possível mídia base64 omitida)'
      s = s.replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[\sA-Za-z0-9+/=]{80,}/gi, '(imagem base64 omitida)')
      if (s.length > 16000) s = `${s.slice(0, 16000)}…`
      return s
    }
    if (Array.isArray(content)) {
      const parts = []
      for (const b of content) {
        if (!b || typeof b !== 'object') continue
        if (b.type === 'image' || (b.source && typeof b.source === 'object' && b.source.type === 'base64')) {
          parts.push('(imagem)')
          continue
        }
        if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
        else if (typeof b.text === 'string') parts.push(b.text)
      }
      const t = parts.join('\n').trim()
      return t || '(conteúdo não textual)'
    }
    return String(content)
  }
  
  /** Histórico seguro para o browser (sem vazar base64). */
  function sanitizarHistoricoParaRespostaDashboard(historico) {
    const msgs = normalizarHistoricoMensagens(historico)
    const out = []
    for (const m of msgs) {
      if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'operator') continue
      out.push({
        role: m.role,
        content: sanitizarContentMensagemDashboard(m.content),
      })
    }
    return out
  }
  
  /** Trecho linear do histórico para o prompt do coach (últimos caracteres se exceder limite). */
  function historicoParaTextoCoach(historico) {
    const rows = sanitizarHistoricoParaRespostaDashboard(historico)
    const labels = { user: 'Cliente', assistant: 'Agente', operator: 'Operador' }
    const lines = rows.map((r) => `[${labels[r.role] || r.role}]\n${r.content}`)
    let full = lines.join('\n\n---\n\n')
    if (full.length > LEAD_COACH_MAX_TRANSCRIPT_CHARS) {
      full = `…(trecho inicial omitido — últimos ${LEAD_COACH_MAX_TRANSCRIPT_CHARS} caracteres)\n\n${full.slice(-LEAD_COACH_MAX_TRANSCRIPT_CHARS)}`
    }
    return full
  }
  
  /**
   * Anthropic exige alternância user/assistant. Webhooks duplicados ou falhas geram dois "user" seguidos e a API falha.
   * @param {null|{ media_type: string, data: string }} visaoUltimaMensagem — imagem (base64 cru) só na última mensagem user.
   */

  function perfilJsonParaPromptSemDuplicarMemoria(perfil) {
    if (!perfil || typeof perfil !== 'object') return {}
    // Remove campos operacionais/internos que não devem aparecer no JSON do perfil
    // enviado ao modelo: resumo de memória (tem bloco próprio) e campos_coletados
    // (tem bloco próprio via montarBlocoColetados).
    const { resumo_memoria_vendas: _r, campos_coletados: _c, ...rest } = perfil
    return rest
  }
  
  function montarResumoMemoriaVendas(historico, perfil, estagio) {
    const msgs = normalizarHistoricoMensagens(historico).slice(-8)
    const linhas = []
    for (const m of msgs) {
      if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'operator') continue
      const label = m.role === 'assistant' ? 'IA' : m.role === 'operator' ? 'Op' : 'Lead'
      let t =
        typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
            ? m.content.map((b) => (b && typeof b === 'object' && b.text ? b.text : '')).join(' ')
            : ''
      t = t.replace(/\s+/g, ' ').trim().slice(0, 160)
      if (t) linhas.push(`${label}: ${t}`)
    }
    const bits = [
      estagio && `Etapa: ${estagio}`,
      perfil.negocio && `Negocio: ${perfil.negocio}`,
      perfil.cidade && `Cidade: ${perfil.cidade}`,
      perfil.preco_calculado != null && `V_motor: R$ ${perfil.preco_calculado}`,
      perfil.termometro_dor != null && `Termometro: ${perfil.termometro_dor}`,
      perfil.temperatura_lead && `Temperatura: ${perfil.temperatura_lead}`,
    ].filter(Boolean)
    const body = [...bits, '---', ...linhas].join('\n')
    return body.length > 2400 ? `${body.slice(0, 2399)}…` : body
  }
  
  function montarBlocoContinuidadeTurno(historico, perfil) {
    const msgs = normalizarHistoricoMensagens(historico).slice(-10)
    if (msgs.length < 2) return ''
    let ultimaLead = ''
    let ultimaIa = ''
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (!ultimaLead && m.role === 'user') ultimaLead = textoDeContent(m.content).replace(/\s+/g, ' ').trim().slice(0, 180)
      if (!ultimaIa && m.role === 'assistant') ultimaIa = textoDeContent(m.content).replace(/\s+/g, ' ').trim().slice(0, 180)
      if (ultimaLead && ultimaIa) break
    }
    const campos = []
    if (perfil && typeof perfil === 'object') {
      if (perfil.negocio) campos.push(`negocio=${perfil.negocio}`)
      if (perfil.cidade) campos.push(`cidade=${perfil.cidade}`)
      if (perfil.servico_foco) campos.push(`servico_foco=${perfil.servico_foco}`)
      if (perfil.ticket_cliente_final) campos.push(`ticket=${perfil.ticket_cliente_final}`)
      if (perfil.termometro_dor != null) campos.push(`termometro=${perfil.termometro_dor}`)
    }
    if (!ultimaLead && campos.length === 0) return ''
    const linhas = ['\n\n--- CONTINUIDADE OBRIGATORIA DO TURNO ---']
    if (ultimaIa) linhas.push(`Ultima resposta enviada pela IA: ${ultimaIa}`)
    if (ultimaLead) linhas.push(`Ultima fala do lead (base da proxima resposta): ${ultimaLead}`)
    if (campos.length > 0) linhas.push(`Contexto ja confirmado: ${campos.join(' | ')}`)
    linhas.push('INSTRUCAO CRITICA: continue a conversa do ponto atual; nao reinicie abertura; nao volte para script generico; nao repita pergunta ja respondida.')
    return `${linhas.join('\n')}\n`
  }
  
  function extrairValoresReaisDoTextoBrasil(texto) {
    if (!texto || typeof texto !== 'string') return []
    const re = /R\$\s*([\d]{1,3}(?:\.\d{3})*(?:,\d{2})?)\b/gi
    const out = []
    let m
    while ((m = re.exec(texto)) !== null) {
      const raw = m[1].replace(/\./g, '').replace(',', '.')
      const v = parseFloat(raw)
      if (Number.isFinite(v) && v > 0) out.push(v)
    }
    return out
  }
  
  /**
   * Compara valores monetários citados na última resposta da IA com o motor (preco_calculado).
   * Ignora faixas típicas de plano mensal e valores próximos de entrada/parcela.
   */
  function avaliarDivergenciaPrecoIaNoTexto(perfil, textoEnviado) {
    const V = Number(perfil && perfil.preco_calculado)
    if (!Number.isFinite(V) || V <= 0) {
      return { totalDetectado: null, divergente: false }
    }
    const mensalTipicos = new Set([60, 100, 150, 300, 600])
    const ent = Number(perfil.entrada)
    const par = Number(perfil.parcela)
    const amounts = extrairValoresReaisDoTextoBrasil(textoEnviado)
    let candidato = null
    for (const n of amounts) {
      const arred = Math.round(n)
      if (mensalTipicos.has(arred)) continue
      if (Number.isFinite(ent) && ent > 0 && Math.abs(n - ent) / V <= 0.07) continue
      if (Number.isFinite(par) && par > 0 && Math.abs(n - par) / V <= 0.07) continue
      if (n < 250) continue
      if (n >= V * 0.35 && n <= V * 1.25) {
        if (candidato == null || Math.abs(n - V) < Math.abs(candidato - V)) candidato = n
      }
    }
    if (candidato == null) return { totalDetectado: null, divergente: false }
    const divergente = Math.abs(candidato - V) / V > 0.06
    return { totalDetectado: Math.round(candidato), divergente }
  }
  
  async function atualizarCamadaMemoriaVendasPosResposta(numero, historico, perfil, estagio, textoEnviado) {
    const resumo = montarResumoMemoriaVendas(historico, perfil, estagio)
    const { totalDetectado, divergente } = avaliarDivergenciaPrecoIaNoTexto(perfil, textoEnviado)
    await pool.query(
      `
      INSERT INTO vendas.lead_profiles (numero, resumo_memoria_vendas, memoria_vendas_versao, ia_total_projeto_detectado_ultima_resposta, preco_ia_divergente_motor)
      VALUES ($1, $2, 1, $3, $4)
      ON CONFLICT (numero) DO UPDATE SET
        resumo_memoria_vendas = EXCLUDED.resumo_memoria_vendas,
        memoria_vendas_versao = COALESCE(vendas.lead_profiles.memoria_vendas_versao, 0) + 1,
        ia_total_projeto_detectado_ultima_resposta = EXCLUDED.ia_total_projeto_detectado_ultima_resposta,
        preco_ia_divergente_motor = EXCLUDED.preco_ia_divergente_motor,
        atualizado_em = NOW()
      `,
      [numero, resumo, totalDetectado, divergente]
    )
  }

  async function chamarClaudeLeadCoach({ numero, conversa, perfil }) {
    const aprendizado = await buscarUltimoAprendizado()
    const historicoTexto = historicoParaTextoCoach(conversa.historico)
    const coachBase =
      prompts.LEAD_COACH_PROMPT_BASE.trim() ||
      `Voce e coach interno da {{empresa}} (uso exclusivo do operador). Responda APENAS com JSON valido, sem markdown, com as chaves:
  etapa (string), status_conversa (string),
  decisao_recomendada (string), confianca (string: baixa|media|alta), raciocinio (string),
  proximos_passos (array de strings), riscos (array de strings),
  sinais (objeto com flags booleanas opcionais: handoff, fechar_negocio, coletar_mais_dados),
  perguntas_em_aberto (array de strings),
  resumo_problema (string curta), o_que_faltou_para_vender (array de strings),
  melhorias_para_ia (array de strings), sinais_melhoria_ia (array de strings), acoes_de_preparo (array de strings),
  confianca_analise (string: baixa|media|alta),
  prompt_gamma_apresentacao (string longa em portugues, pronta para colar no Gamma para gerar slides da proposta; estrutura de slides; sem inventar precos ou promessas que nao estejam no contexto; use placeholders se faltar dado).`

    const userPayload = {
      numero_lead: numero,
      estagio: conversa.estagio,
      status: conversa.status,
      venda_fechada: conversa.venda_fechada,
      agente_pausado: conversa.agente_pausado,
      perfil_lead: perfil && typeof perfil === 'object' && Object.keys(perfil).length ? perfil : {},
      aprendizado_vendas_fechadas: aprendizado || null,
      historico_conversa: historicoTexto || '(historico vazio apos sanitizacao)',
    }

    // Roteado via motor central: respeita provider/model configurado no Motor de IA.
    const requestId = gerarRequestIdAnthropic()
    const inicio = Date.now()
    let result
    try {
      result = await aiProvider.generateAIResponse(
        {
          systemPrompt: coachBase,
          userPrompt:
            'Analise o contexto JSON abaixo e responda APENAS com o objeto JSON solicitado no system. ' +
            'O objeto deve comecar com { e terminar com }; sem markdown, sem texto antes ou depois.\n\n' +
            JSON.stringify(userPayload),
          task: 'lead_coach',
          maxTokens: 4096,
          extraHeaders: { 'anthropic-beta': 'prompt-caching-2024-07-31' },
          responseFormatJson: true,
        },
        pool,
        logger
      )
      if (result?.provider === 'anthropic') {
        await registrarChamadaAnthropic({
          request_id: requestId,
          tipo: 'lead_coach',
          numero,
          model: result.model,
          estagio: conversa.estagio,
          duration_ms: Date.now() - inicio,
          http_ok: true,
          http_status: result.httpStatus || 200,
          stop_reason: result.stopReason || null,
          usage: result.usage,
          metadata: { fallback_used: result.fallback_used === true },
        })
      }
    } catch (e) {
      await registrarChamadaAnthropic({
        request_id: requestId,
        tipo: 'lead_coach',
        numero,
        model: 'desconhecido',
        estagio: conversa.estagio,
        duration_ms: Date.now() - inicio,
        http_ok: false,
        http_status: statusHttpDeErroAnthropic(e),
        erro_codigo: codigoErroAnthropic(e),
        erro_msg: mensagemErroAnthropic(e),
      })
      throw e
    }

    if (result.stopReason === 'max_tokens') {
      throw new Error(
        'Resposta do modelo foi cortada (max_tokens atingido) — JSON incompleto; tente reduzir o histórico da conversa'
      )
    }
    const bruto = String(result.text || '').trim()
    if (!bruto) {
      throw new Error('Resposta vazia do motor de IA no coach')
    }
    const parsed = parsearRespostaJsonClaude(bruto)
    if (!parsed || typeof parsed !== 'object') {
      logger.error('❌ coach — texto bruto não parseável (primeiros 600 chars):', bruto.slice(0, 600))
      throw new Error('Modelo não retornou JSON parseável para o coach')
    }
    return {
      ...parsed,
      etapa: parsed.etapa != null && String(parsed.etapa).trim() ? String(parsed.etapa).trim() : conversa.estagio || 'primeiro_contato',
      status_conversa:
        parsed.status_conversa != null && String(parsed.status_conversa).trim()
          ? String(parsed.status_conversa).trim()
          : conversa.status || 'ativo',
    }
  }
  
  // ─── PREVIA VISUAL DE SITE (HTML TEMPORARIO -> IMAGEM) ───────────────────────

  return {
    normalizarListaCoachAnalise,
    normalizarSinaisCoach,
    normalizarLeadCoachPayload,
    hidratarAnalisePosConversa,
    salvarAnalisePosConversa,
    tentarConsolidacaoAutomatica,
    buscarUltimaAnalisePosConversa,
    buscarHistoricoAnalisesPosConversa,
    salvarAprendizado,
    normalizarPromptAlvo,
    inferirPromptAlvoDeTextoRegras,
    montarBlocoCorrecoesAprendizados,
    buscarAprendizadosAtivos,
    buscarAprendizadosPendentes,
    listarPromptAprendizados,
    aprovarAprendizado,
    desativarAprendizado,
    contarAnalisesDesdaUltimaConsolidacao,
    consolidarAprendizadoAnalises,
    gerarAprendizadoDeFunilDiagnostico,
    gerarAprendizado,
    sanitizarContentMensagemDashboard,
    sanitizarHistoricoParaRespostaDashboard,
    historicoParaTextoCoach,
    perfilJsonParaPromptSemDuplicarMemoria,
    montarResumoMemoriaVendas,
    montarBlocoContinuidadeTurno,
    extrairValoresReaisDoTextoBrasil,
    avaliarDivergenciaPrecoIaNoTexto,
    atualizarCamadaMemoriaVendasPosResposta,
    chamarClaudeLeadCoach,
  }
}

module.exports = { createLearning }
