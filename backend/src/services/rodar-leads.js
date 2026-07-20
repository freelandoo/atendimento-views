'use strict'
// "Rodar leads" — disparo da saudação (primeira mensagem) a partir do Banco de Leads,
// por uma instância WhatsApp escolhida. Suporta os modos do Banco de Leads:
//   - Manual: rodarLeads() gera (opcional IA) e envia na hora.
//   - Semi:   gerarMensagensSemi() gera e deixa 'aguardando_disparo'; dispararGerados()
//             envia depois, no comando do usuário (sem re-gerar).
// A geração por IA (saudação de análise) é opcional por empresa (banco_leads_config.gerar_ia)
// e nunca envia fallback silencioso quando a IA obrigatória falha. Throttle preservado:
//   - lote de até RODAR_LEADS_MAX_LOTE por rodada (default 15)
//   - RODAR_LEADS_COOLDOWN_MIN minutos entre rodadas por instância (default 15)
//   - teto diário por instância RODAR_LEADS_TETO_DIARIO (default 40)
//   - envios espaçados com delay aleatório (não dispara em rajada)
const { enviarMensagem, numerosSemWhatsapp, verificarStatusInstanciaEvolution, numeroEnvioWhatsapp } = require('../whatsapp')

// Normaliza o telefone para o MESMO formato do envio/checagem (com código do país 55),
// para casar com o Set devolvido por numerosSemWhatsapp.
function soDigitos(t) { return numeroEnvioWhatsapp(t) }
const { registrarEnvioNoHistorico } = require('./historico-envio')
const { obterConfigBancoLeads } = require('../db/banco-leads-config')
const { gerarSaudacaoAnalise } = require('./saudacao-analise')
const { montarJsonApresentacaoPlaces, montarJsonApresentacaoInstagram } = require('./lead-score-cadastro')
const { canProspectLead } = require('./prospecting-eligibility')
const { logger } = require('../logger')

const MAX_LOTE = Math.max(1, parseInt(process.env.RODAR_LEADS_MAX_LOTE, 10) || 15)
const COOLDOWN_MIN = Math.max(0, parseInt(process.env.RODAR_LEADS_COOLDOWN_MIN, 10) || 15)
const TETO_DIARIO = Math.max(0, parseInt(process.env.RODAR_LEADS_TETO_DIARIO, 10) || 40)
const DELAY_MIN_MS = Math.max(0, parseInt(process.env.RODAR_LEADS_DELAY_MIN_MS, 10) || 12000)
const DELAY_MAX_MS = Math.max(DELAY_MIN_MS, parseInt(process.env.RODAR_LEADS_DELAY_MAX_MS, 10) || 20000)

// Status do prospect que ainda podem ser abordados (espelha a aba "sem_contato").
const STATUS_RODAVEL = new Set(['coletado', 'contato_encontrado', 'aguardando', 'aprovado'])
// Origens do Google Places (o resto é social — Instagram/LinkedIn).
const ORIGENS_PLACES = new Set(['manual', 'automatico'])
const STATUS_EVOLUTION_SUCESSO = new Set(['DELIVERY_ACK', 'READ', 'PLAYED'])

// Colunas do prospect necessárias pro throttle/render/JSON de apresentação (geração IA).
const COLS_PROSPECT = `id, nome, telefone, status, nicho, cidade, bloqueado_ate, tem_whatsapp,
  origem, email, endereco, rating, avaliacoes, tem_site, site, maps_url,
  link_bio, bio, categoria_perfil, seguidores, instagram_handle, raw_json`

function delayAleatorio() {
  return DELAY_MIN_MS + Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS + 1))
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
function dedupeIds(prospectIds) {
  return Array.from(new Set((prospectIds || []).map((x) => String(x || '').trim()).filter(Boolean)))
}

async function exigirInstanciaConectada(instancia, verificarStatus = verificarStatusInstanciaEvolution) {
  const status = await verificarStatus(instancia.evolution_instance)
  if (status?.connected === true) return status
  const e = new Error(status?.connected === false
    ? 'A instância WhatsApp está desconectada. Reconecte-a antes de enviar.'
    : 'Não foi possível confirmar a conexão da instância. Verifique o WhatsApp antes de enviar.')
  e.statusCode = 409
  e.code = 'instance_disconnected'
  throw e
}

async function comTransacao(pool, fn) {
  if (typeof pool.connect !== 'function') return fn(pool)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const resultado = await fn(client)
    await client.query('COMMIT')
    return resultado
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

function chaveMensagemEvolution(respostaEnvio) {
  const key = respostaEnvio?.key || respostaEnvio?.message?.key || respostaEnvio?.data?.key || null
  return {
    keyId: typeof key?.id === 'string' ? key.id.trim() : '',
    remoteJid: typeof key?.remoteJid === 'string' ? key.remoteJid.trim() : '',
  }
}

async function aguardarStatusEnvioEvolution(pool, respostaEnvio, opts = {}) {
  const { keyId } = chaveMensagemEvolution(respostaEnvio)
  if (!keyId) return null
  const timeoutMs = Math.max(0, opts.timeoutMs == null ? 12000 : Number(opts.timeoutMs) || 0)
  const intervalMs = Math.max(100, opts.intervalMs == null ? 700 : Number(opts.intervalMs) || 100)
  const fim = Date.now() + timeoutMs
  while (true) {
    const { rows } = await pool.query(
      `SELECT status
         FROM public."MessageUpdate"
        WHERE "keyId" = $1
        ORDER BY CASE status
          WHEN 'ERROR' THEN 0
          WHEN 'READ' THEN 1
          WHEN 'DELIVERY_ACK' THEN 2
          WHEN 'SERVER_ACK' THEN 3
          ELSE 4
        END
        LIMIT 1`,
      [keyId]
    )
    const status = String(rows[0]?.status || '').toUpperCase()
    if (status === 'ERROR' || STATUS_EVOLUTION_SUCESSO.has(status)) return { keyId, status }
    if (Date.now() >= fim) return { keyId, status: status || 'PENDING' }
    await sleep(intervalMs)
  }
}

async function afirmarEnvioNaoFalhouNaEvolution(pool, respostaEnvio, opts = {}) {
  const status = await aguardarStatusEnvioEvolution(pool, respostaEnvio, opts)
  if (status?.status === 'ERROR') {
    const err = new Error('Evolution confirmou erro no envio da mensagem')
    err.evolutionClassificacao = {
      tipo: 'message_error',
      retryable: false,
      motivo: 'Evolution MessageUpdate retornou ERROR para o envio',
      keyId: status.keyId,
    }
    throw err
  }
  return status
}

// Renderiza o template da saudação com os dados do lead. Variáveis: {nome} {empresa}
// {cidade} {nicho}. {empresa} é alias de {nome} (nome do negócio do lead).
function renderSaudacao(template, prospect = {}) {
  const vars = {
    nome: prospect.nome || 'tudo bem',
    empresa: prospect.nome || '',
    cidade: prospect.cidade || '',
    nicho: prospect.nicho || '',
  }
  return String(template || '')
    .replace(/\{(nome|empresa|cidade|nicho)\}/gi, (_, k) => vars[k.toLowerCase()] ?? '')
    .trim()
}

async function carregarInstancia(pool, empresaId, instanciaId) {
  const { rows } = await pool.query(
    `SELECT id, evolution_instance, nome, ativo, config_json, contexto_id
       FROM app.empresa_whatsapp_instances
      WHERE id = $1 AND empresa_id = $2
        AND COALESCE(config_json->>'canal', 'whatsapp') <> 'freelandoo'`,
    [instanciaId, empresaId]
  )
  return rows[0] || null
}

function saudacaoDaInstancia(instancia) {
  const cfg = instancia?.config_json
  const obj = typeof cfg === 'string' ? safeJson(cfg) : (cfg || {})
  return String(obj?.saudacao || '').trim()
}
function safeJson(s) { try { return JSON.parse(s) } catch { return {} } }

function montarJsonApresentacaoDoProspect(prospect) {
  return ORIGENS_PLACES.has(prospect.origem)
    ? montarJsonApresentacaoPlaces(prospect)
    : montarJsonApresentacaoInstagram(prospect)
}

// Mensagem final de um lead.
//  - gerar_ia OFF: usa o template (mensagem escolhida, não é fallback).
//  - gerar_ia ON: a mensagem DEVE ser da IA. Se a IA falhar (após retries em
//    saudacao-analise), retorna falha_ia=true — o caller marca erro no status e NÃO
//    envia template silenciosamente.
async function mensagemFinalDoLead(pool, { prospect, template, gerarIa, instrucoes, contextoId, empresaId }) {
  if (!gerarIa) {
    return { texto: renderSaudacao(template, prospect), gerada_por_ia: false, falha_ia: false }
  }
  try {
    const jsonApresentacao = montarJsonApresentacaoDoProspect(prospect)
    const textoIa = await gerarSaudacaoAnalise({
      pool, log: logger, empresaId, contextoId, jsonApresentacao,
      instrucoes, nomeLead: prospect.nome,
    })
    if (textoIa) return { texto: textoIa, gerada_por_ia: true, falha_ia: false }
  } catch (e) {
    logger.warn({ prospect: prospect.id, err: e.message }, '[rodar-leads] geração IA falhou')
  }
  return { texto: '', gerada_por_ia: false, falha_ia: true }
}

// Quanto falta do cooldown (em segundos) e quantos disparos já saíram hoje na instância.
async function estadoThrottle(pool, empresaId, evolutionInstance) {
  const { rows } = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE criado_em::date = NOW()::date
                          AND status IN ('enviando', 'pendente_confirmacao', 'enviado'))::int AS hoje,
        MAX(criado_em) FILTER (WHERE status IN ('enviando', 'pendente_confirmacao', 'enviado')) AS ultimo
       FROM prospectador.lead_disparos
      WHERE empresa_id = $1 AND evolution_instance = $2`,
    [empresaId, evolutionInstance]
  )
  const hoje = rows[0]?.hoje || 0
  const ultimo = rows[0]?.ultimo ? new Date(rows[0].ultimo) : null
  let cooldownRestanteS = 0
  if (ultimo && COOLDOWN_MIN > 0) {
    const passouMs = Date.now() - ultimo.getTime()
    const faltaMs = COOLDOWN_MIN * 60_000 - passouMs
    if (faltaMs > 0) cooldownRestanteS = Math.ceil(faltaMs / 1000)
  }
  return { hoje, cooldownRestanteS }
}

// Estado de envio da instância (reusa o MESMO cooldown/teto do disparo). Só leitura —
// serve pro cronômetro do modo Semi saber quanto falta pro próximo envio.
async function estadoEnvioInstancia(pool, { empresaId, instanciaId }) {
  const instancia = await carregarInstancia(pool, empresaId, instanciaId)
  if (!instancia) { const e = new Error('Instância não encontrada.'); e.statusCode = 404; throw e }
  const { hoje, cooldownRestanteS } = await estadoThrottle(pool, empresaId, instancia.evolution_instance)
  const config = await obterConfigBancoLeads(pool, empresaId)
  const tetoDiario = Number(config.teto_diario) > 0 ? Number(config.teto_diario) : TETO_DIARIO
  return {
    cooldown_restante_s: cooldownRestanteS,
    cooldown_min: COOLDOWN_MIN,
    teto_restante: tetoDiario > 0 ? Math.max(0, tetoDiario - hoje) : null,
    teto_diario: tetoDiario,
  }
}

// Carrega os prospects dos ids e separa elegíveis de pulados (bloqueado/status/sem telefone).
async function separarElegiveis(pool, empresaId, ids) {
  const { rows: prospects } = await pool.query(
    `SELECT ${COLS_PROSPECT}
       FROM prospectador.prospects
      WHERE empresa_id = $1 AND id = ANY($2::uuid[])`,
    [empresaId, ids]
  )
  const porId = new Map(prospects.map((p) => [p.id, p]))
  const pulados = []
  const elegiveis = []
  const agora = Date.now()
  for (const id of ids) {
    const p = porId.get(id)
    if (!p) { pulados.push({ id, motivo: 'nao_encontrado' }); continue }
    if (p.bloqueado_ate && new Date(p.bloqueado_ate).getTime() > agora) { pulados.push({ id, motivo: 'bloqueado', bloqueado_ate: p.bloqueado_ate }); continue }
    if (!STATUS_RODAVEL.has(p.status)) { pulados.push({ id, motivo: `status_${p.status}` }); continue }
    if (!String(p.telefone || '').trim()) { pulados.push({ id, motivo: 'sem_telefone' }); continue }
    if (p.tem_whatsapp === false) { pulados.push({ id, motivo: 'sem_whatsapp' }); continue }
    const compliance = await canProspectLead(pool, p.telefone, {
      prospectId: p.id,
      empresaId,
      complianceOnly: true,
    })
    if (!compliance.allowed) {
      pulados.push({ id, motivo: compliance.reason || 'compliance' })
      continue
    }
    elegiveis.push(p)
  }
  return { elegiveis, pulados }
}

async function marcarDisparoFalhou(pool, disparoId, erro, prospectId = null, semWhatsapp = false) {
  return comTransacao(pool, async (client) => {
    if (semWhatsapp && prospectId) {
      await client.query(
        `UPDATE prospectador.prospects SET tem_whatsapp = false WHERE id = $1`,
        [prospectId]
      )
    }
    await client.query(
      `UPDATE prospectador.lead_disparos
          SET status = 'falhou', erro = $2
        WHERE id = $1 AND status IN ('gerando', 'aguardando_disparo', 'enviando', 'pendente_confirmacao')`,
      [disparoId, erro]
    )
  })
}

async function reservarDisparosManuais(pool, {
  empresaId, usuarioId, instancia, prospects, saudacao, tetoDiario, pulados,
}) {
  return comTransacao(pool, async (client) => {
    await client.query(
      `SELECT id FROM app.empresa_whatsapp_instances
        WHERE id = $1 AND empresa_id = $2 FOR UPDATE`,
      [instancia.id, empresaId]
    )
    const { hoje, cooldownRestanteS } = await estadoThrottle(client, empresaId, instancia.evolution_instance)
    if (cooldownRestanteS > 0) {
      const e = new Error(`Só é possível disparar a cada ${COOLDOWN_MIN} minutos. Aguarde mais ${Math.ceil(cooldownRestanteS / 60)} min nesta instância.`)
      e.statusCode = 429
      throw e
    }
    const tetoRestante = tetoDiario > 0 ? Math.max(0, tetoDiario - hoje) : prospects.length
    if (tetoRestante <= 0) {
      const e = new Error(`Teto diário de ${tetoDiario} disparos atingido nesta instância. Tente amanhã.`)
      e.statusCode = 429
      throw e
    }

    const candidatos = prospects.slice(0, tetoRestante)
    for (const p of prospects.slice(tetoRestante)) pulados.push({ id: p.id, motivo: 'teto_diario' })
    const itens = []
    for (const p of candidatos) {
      await client.query(
        `UPDATE prospectador.lead_disparos
            SET status = 'falhou', erro = 'substituido_por_envio_manual'
          WHERE empresa_id = $1 AND prospect_id = $2 AND status = 'aguardando_disparo'`,
        [empresaId, p.id]
      )
      const mensagem = renderSaudacao(saudacao, p)
      const { rows } = await client.query(
        `INSERT INTO prospectador.lead_disparos
           (empresa_id, prospect_id, usuario_id, evolution_instance, mensagem, status)
         VALUES ($1, $2, $3, $4, $5, 'enviando')
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [empresaId, p.id, usuarioId || null, instancia.evolution_instance, mensagem]
      )
      if (!rows[0]) {
        pulados.push({ id: p.id, motivo: 'ja_em_processamento' })
        continue
      }
      itens.push({ prospect: p, disparoId: rows[0].id, mensagem })
    }
    return { itens, hoje, tetoRestante }
  })
}

/**
 * MANUAL — valida, reserva e envia (em background) a saudação para os leads na hora.
 * Retorna o resumo imediato { rodada, aceitos, pulados, teto_restante, total_dia }.
 */
async function rodarLeads(pool, { empresaId, usuarioId, instanciaId, prospectIds }, deps = {}) {
  const ids = dedupeIds(prospectIds)
  if (!ids.length) { const e = new Error('Selecione ao menos um lead.'); e.statusCode = 400; throw e }
  if (ids.length > MAX_LOTE) { const e = new Error(`Máximo de ${MAX_LOTE} leads por rodada.`); e.statusCode = 400; throw e }

  const instancia = await carregarInstancia(pool, empresaId, instanciaId)
  if (!instancia) { const e = new Error('Instância não encontrada.'); e.statusCode = 404; throw e }
  if (!instancia.ativo) { const e = new Error('Instância está desativada. Ative o número antes de rodar.'); e.statusCode = 409; throw e }

  const saudacao = saudacaoDaInstancia(instancia)
  if (!saudacao) { const e = new Error('Configure a saudação (fallback) desta instância antes de rodar (botão "Testar envio").'); e.statusCode = 409; throw e }
  await exigirInstanciaConectada(instancia, deps.verificarStatus)

  const config = await obterConfigBancoLeads(pool, empresaId)
  const tetoDiario = Number(config.teto_diario) > 0 ? Number(config.teto_diario) : TETO_DIARIO
  const { elegiveis, pulados } = await separarElegiveis(pool, empresaId, ids)
  if (!elegiveis.length) return { rodada: false, aceitos: [], pulados, teto_restante: null, total_dia: null }

  const reserva = await reservarDisparosManuais(pool, {
    empresaId, usuarioId, instancia, prospects: elegiveis, saudacao, tetoDiario, pulados,
  })
  let itens = reserva.itens
  if (!itens.length) {
    return { rodada: false, aceitos: [], pulados, teto_restante: reserva.tetoRestante, total_dia: reserva.hoje }
  }

  // A reserva ja existe antes da chamada externa; duas abas/replicas nao enviam o mesmo lead.
  const semZap = await numerosSemWhatsapp(itens.map((it) => it.prospect.telefone), instancia.evolution_instance)
  if (semZap && semZap.size) {
    for (const it of itens.filter((x) => semZap.has(soDigitos(x.prospect.telefone)))) {
      await marcarDisparoFalhou(pool, it.disparoId, 'sem_whatsapp', it.prospect.id, true)
      pulados.push({ id: it.prospect.id, motivo: 'sem_whatsapp' })
    }
    itens = itens.filter((it) => !semZap.has(soDigitos(it.prospect.telefone)))
  }
  if (!itens.length) {
    return { rodada: false, aceitos: [], pulados, teto_restante: reserva.tetoRestante, total_dia: reserva.hoje }
  }

  const envioArgs = {
    empresaId,
    evolutionInstance: instancia.evolution_instance,
    itens,
    gerar: { ativo: !!config.gerar_ia, instrucoes: config.instrucoes_ia, contextoId: instancia.contexto_id },
  }
  enviarLoteEmBackground(pool, envioArgs).catch((err) => logger.error({ err: err.message }, '[rodar-leads] background falhou'))

  return {
    rodada: true,
    aceitos: itens.map((it) => ({ id: it.prospect.id, nome: it.prospect.nome })),
    pulados,
    teto_restante: Math.max(0, reserva.tetoRestante - itens.length),
    total_dia: reserva.hoje + itens.length,
    envios: null,
  }
}

/**
 * SEMI — gera a mensagem (IA com fallback) e grava como 'aguardando_disparo', SEM enviar
 * e SEM consumir cooldown/teto (a geração é livre; o teto conta no disparo). Substitui
 * rascunho anterior do mesmo prospect. Retorna { gerados, pulados }.
 */
async function reservarGeracaoSemi(pool, { empresaId, usuarioId, evolutionInstance, prospectId }) {
  return comTransacao(pool, async (client) => {
    await client.query(
      `UPDATE prospectador.lead_disparos
          SET status = 'erro_ia', erro = 'geracao_expirada'
        WHERE empresa_id = $1 AND prospect_id = $2
          AND status = 'gerando' AND criado_em < NOW() - INTERVAL '10 minutes'`,
      [empresaId, prospectId]
    )
    const atual = await client.query(
      `UPDATE prospectador.lead_disparos
          SET status = 'gerando', erro = NULL, mensagem = NULL,
              usuario_id = $3, evolution_instance = $4
        WHERE empresa_id = $1 AND prospect_id = $2 AND status = 'aguardando_disparo'
      RETURNING id`,
      [empresaId, prospectId, usuarioId || null, evolutionInstance]
    )
    if (atual.rows[0]) return atual.rows[0].id

    const inserido = await client.query(
      `INSERT INTO prospectador.lead_disparos
         (empresa_id, prospect_id, usuario_id, evolution_instance, mensagem, status)
       VALUES ($1, $2, $3, $4, NULL, 'gerando')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [empresaId, prospectId, usuarioId || null, evolutionInstance]
    )
    return inserido.rows[0]?.id || null
  })
}

async function gerarMensagensSemi(pool, { empresaId, usuarioId, instanciaId, prospectIds }) {
  const ids = dedupeIds(prospectIds)
  if (!ids.length) { const e = new Error('Selecione ao menos um lead.'); e.statusCode = 400; throw e }
  if (ids.length > MAX_LOTE) { const e = new Error(`Máximo de ${MAX_LOTE} leads por geração.`); e.statusCode = 400; throw e }

  const instancia = await carregarInstancia(pool, empresaId, instanciaId)
  if (!instancia) { const e = new Error('Instância não encontrada.'); e.statusCode = 404; throw e }
  if (!instancia.ativo) { const e = new Error('Instância está desativada. Ative o número antes de gerar.'); e.statusCode = 409; throw e }

  const saudacao = saudacaoDaInstancia(instancia)
  if (!saudacao) { const e = new Error('Configure a saudação (fallback) desta instância antes de gerar (botão "Testar envio").'); e.statusCode = 409; throw e }

  const config = await obterConfigBancoLeads(pool, empresaId)
  const { elegiveis, pulados } = await separarElegiveis(pool, empresaId, ids)
  if (!elegiveis.length) return { gerados: [], pulados }

  const gerados = []
  for (const p of elegiveis) {
    const disparoId = await reservarGeracaoSemi(pool, {
      empresaId,
      usuarioId,
      evolutionInstance: instancia.evolution_instance,
      prospectId: p.id,
    })
    if (!disparoId) {
      pulados.push({ id: p.id, motivo: 'ja_em_processamento' })
      continue
    }
    const { texto, gerada_por_ia, falha_ia } = await mensagemFinalDoLead(pool, {
      prospect: p, template: saudacao, gerarIa: !!config.gerar_ia,
      instrucoes: config.instrucoes_ia, contextoId: instancia.contexto_id, empresaId,
    })
    if (falha_ia) {
      await pool.query(
        `UPDATE prospectador.lead_disparos
            SET status = 'erro_ia', erro = 'ia_falhou'
          WHERE id = $1 AND status = 'gerando'`,
        [disparoId]
      )
      gerados.push({ prospect_id: p.id, nome: p.nome, erro_ia: true })
      continue
    }
    await pool.query(
      `UPDATE prospectador.lead_disparos
          SET status = 'aguardando_disparo', mensagem = $2, erro = NULL
        WHERE id = $1 AND status = 'gerando'`,
      [disparoId, texto]
    )
    gerados.push({ prospect_id: p.id, nome: p.nome, disparo_id: disparoId, mensagem: texto, gerada_por_ia })
  }
  return { gerados, pulados }
}

async function gerarPendentesSemi(pool, { empresaId, usuarioId = null, instanciaId, limit = 100 }) {
  const instancia = await carregarInstancia(pool, empresaId, instanciaId)
  if (!instancia) { const e = new Error('Instância não encontrada.'); e.statusCode = 404; throw e }
  if (!instancia.ativo) { const e = new Error('Instância está desativada. Ative o número antes de gerar.'); e.statusCode = 409; throw e }

  const max = Math.min(Math.max(parseInt(limit, 10) || MAX_LOTE, 1), 1000)
  const { rows } = await pool.query(
    `SELECT p.id
       FROM prospectador.prospects p
      WHERE p.empresa_id = $1
        AND p.status = ANY($2)
        AND NULLIF(BTRIM(COALESCE(p.telefone, '')), '') IS NOT NULL
        AND (p.tem_whatsapp IS DISTINCT FROM false)
        AND (p.bloqueado_ate IS NULL OR p.bloqueado_ate <= NOW())
        AND NOT EXISTS (
          SELECT 1 FROM prospectador.lead_disparos d
           WHERE d.empresa_id = p.empresa_id
             AND d.prospect_id = p.id
             AND d.evolution_instance = $3
             AND d.status IN ('gerando', 'aguardando_disparo', 'erro_ia', 'enviando', 'pendente_confirmacao', 'enviado')
        )
      ORDER BY p.score DESC NULLS LAST, p.created_at ASC, p.id ASC
      LIMIT $4`,
    [empresaId, [...STATUS_RODAVEL], instancia.evolution_instance, max]
  )
  const ids = rows.map((r) => r.id).filter(Boolean)
  if (!ids.length) return { gerados: [], pulados: [], candidatos: 0 }

  const total = { gerados: [], pulados: [], candidatos: ids.length }
  for (let i = 0; i < ids.length; i += MAX_LOTE) {
    const parte = ids.slice(i, i + MAX_LOTE)
    const res = await gerarMensagensSemi(pool, { empresaId, usuarioId, instanciaId, prospectIds: parte })
    total.gerados.push(...res.gerados)
    total.pulados.push(...res.pulados)
  }
  return total
}

/**
 * SEMI/AUTO — dispara as mensagens já geradas ('aguardando_disparo') de uma instância,
 * respeitando cooldown/teto anti-ban. Sem re-gerar: envia o texto salvo. Se prospectIds
 * vier vazio, dispara todos os rascunhos pendentes da instância.
 */
async function dispararGerados(pool, { empresaId, instanciaId, prospectIds }, deps = {}) {
  const instancia = await carregarInstancia(pool, empresaId, instanciaId)
  if (!instancia) { const e = new Error('Instância não encontrada.'); e.statusCode = 404; throw e }
  if (!instancia.ativo) { const e = new Error('Instância está desativada. Ative o número antes de disparar.'); e.statusCode = 409; throw e }
  await exigirInstanciaConectada(instancia, deps.verificarStatus)

  const config = await obterConfigBancoLeads(pool, empresaId)
  const tetoDiario = Number(config.teto_diario) > 0 ? Number(config.teto_diario) : TETO_DIARIO

  const filtroIds = dedupeIds(prospectIds)
  const params = [empresaId, instancia.evolution_instance]
  let sql = `SELECT d.id AS disparo_id, d.mensagem, p.id AS prospect_id, p.nome,
                    p.telefone, p.status, p.bloqueado_ate, p.tem_whatsapp
               FROM prospectador.lead_disparos d
               JOIN prospectador.prospects p ON p.id = d.prospect_id
              WHERE d.empresa_id = $1 AND d.evolution_instance = $2
                AND d.status = 'aguardando_disparo'`
  if (filtroIds.length) { params.push(filtroIds); sql += ` AND d.prospect_id = ANY($3::uuid[])` }
  sql += ` ORDER BY d.criado_em ASC`
  const { rows } = await pool.query(sql, params)

  // Reavalia elegibilidade no momento do disparo (pode ter travado/mudado desde a geração).
  const agora = Date.now()
  const pulados = []
  const candidatos = []
  for (const r of rows) {
    if (r.bloqueado_ate && new Date(r.bloqueado_ate).getTime() > agora) { pulados.push({ id: r.prospect_id, motivo: 'bloqueado' }); continue }
    if (!STATUS_RODAVEL.has(r.status)) { pulados.push({ id: r.prospect_id, motivo: `status_${r.status}` }); continue }
    if (!String(r.telefone || '').trim()) { pulados.push({ id: r.prospect_id, motivo: 'sem_telefone' }); continue }
    if (r.tem_whatsapp === false) {
      await marcarDisparoFalhou(pool, r.disparo_id, 'sem_whatsapp', r.prospect_id, true)
      pulados.push({ id: r.prospect_id, motivo: 'sem_whatsapp' })
      continue
    }
    const compliance = await canProspectLead(pool, r.telefone, {
      prospectId: r.prospect_id,
      empresaId,
      complianceOnly: true,
    })
    if (!compliance.allowed) {
      await marcarDisparoFalhou(pool, r.disparo_id, `compliance:${compliance.reason || 'bloqueado'}`)
      pulados.push({ id: r.prospect_id, motivo: compliance.reason || 'compliance' })
      continue
    }
    candidatos.push({
      prospect: { id: r.prospect_id, nome: r.nome, telefone: r.telefone },
      disparoId: r.disparo_id,
      mensagem: r.mensagem,
    })
  }

  if (!candidatos.length) return { rodada: false, aceitos: [], pulados, teto_restante: null }

  const reserva = await comTransacao(pool, async (client) => {
    await client.query(
      `SELECT id FROM app.empresa_whatsapp_instances
        WHERE id = $1 AND empresa_id = $2 FOR UPDATE`,
      [instancia.id, empresaId]
    )
    const throttle = await estadoThrottle(client, empresaId, instancia.evolution_instance)
    if (throttle.cooldownRestanteS > 0) {
      const e = new Error(`Só é possível disparar a cada ${COOLDOWN_MIN} minutos. Aguarde mais ${Math.ceil(throttle.cooldownRestanteS / 60)} min nesta instância.`)
      e.statusCode = 429
      throw e
    }
    const semTeto = tetoDiario <= 0
    const tetoRestante = semTeto ? Infinity : Math.max(0, tetoDiario - throttle.hoje)
    if (tetoRestante <= 0) {
      const e = new Error(`Teto diário de ${tetoDiario} disparos atingido nesta instância. Tente amanhã.`)
      e.statusCode = 429
      throw e
    }
    const itens = []
    for (const it of candidatos.slice(0, tetoRestante)) {
      const { rows: claimed } = await client.query(
        `UPDATE prospectador.lead_disparos d
            SET status = 'enviando', erro = NULL
          WHERE d.id = $1 AND d.status = 'aguardando_disparo'
            AND EXISTS (
              SELECT 1 FROM prospectador.prospects p
               WHERE p.id = d.prospect_id
                 AND p.tem_whatsapp IS DISTINCT FROM false
                 AND p.status = ANY($2)
            )
        RETURNING d.id`,
        [it.disparoId, [...STATUS_RODAVEL]]
      )
      if (claimed[0]) itens.push(it)
      else pulados.push({ id: it.prospect.id, motivo: 'ja_em_processamento' })
    }
    for (const it of candidatos.slice(tetoRestante)) pulados.push({ id: it.prospect.id, motivo: 'teto_diario' })
    return { itens, hoje: throttle.hoje, tetoRestante, semTeto }
  })

  let aceitos = reserva.itens
  if (!aceitos.length) return { rodada: false, aceitos: [], pulados, teto_restante: reserva.semTeto ? null : reserva.tetoRestante }

  // Pré-checa WhatsApp: descarta SÓ os números que a Evolution CONFIRMA que não existem
  // (feedback imediato, sem envio à toa). Nunca chuta — número real nunca é rejeitado aqui.
  const semZap = await numerosSemWhatsapp(aceitos.map((it) => it.prospect.telefone), instancia.evolution_instance)
  if (semZap && semZap.size) {
    for (const it of aceitos.filter((it) => semZap.has(soDigitos(it.prospect.telefone)))) {
      await marcarDisparoFalhou(pool, it.disparoId, 'sem_whatsapp', it.prospect.id, true)
      pulados.push({ id: it.prospect.id, motivo: 'sem_whatsapp' })
    }
    aceitos = aceitos.filter((it) => !semZap.has(soDigitos(it.prospect.telefone)))
    if (!aceitos.length) {
      return { rodada: false, aceitos: [], pulados, teto_restante: reserva.semTeto ? null : reserva.tetoRestante }
    }
  }

  const envioArgs = {
    empresaId,
    evolutionInstance: instancia.evolution_instance,
    itens: aceitos,
    gerar: { ativo: false },
  }
  enviarLoteEmBackground(pool, envioArgs).catch((err) => logger.error({ err: err.message }, '[rodar-leads] disparar-gerados background falhou'))

  return {
    rodada: true,
    aceitos: aceitos.map((it) => ({ id: it.prospect.id, nome: it.prospect.nome })),
    pulados,
    teto_restante: reserva.semTeto ? null : Math.max(0, reserva.tetoRestante - aceitos.length),
    total_dia: reserva.hoje + aceitos.length,
    envios: null,
  }
}

async function finalizarDisparoEnviado(pool, { disparoId, prospectId }) {
  return comTransacao(pool, async (client) => {
    await client.query(
      `UPDATE prospectador.prospects
          SET tem_whatsapp = true,
              status = CASE
                WHEN status IN ('coletado', 'contato_encontrado', 'aguardando', 'aprovado') THEN 'enviado'
                ELSE status
              END,
              updated_at = NOW()
        WHERE id = $1`,
      [prospectId]
    )
    await client.query(
      `UPDATE prospectador.lead_disparos
          SET status = 'enviado', erro = NULL
        WHERE id = $1 AND status IN ('enviando', 'pendente_confirmacao')`,
      [disparoId]
    )
  })
}

async function marcarConfirmacaoPendente(pool, disparoId, keyId, motivo) {
  await pool.query(
    `UPDATE prospectador.lead_disparos
        SET status = 'pendente_confirmacao',
            evolution_message_id = COALESCE($2, evolution_message_id),
            erro = $3
      WHERE id = $1 AND status = 'enviando'`,
    [disparoId, keyId || null, motivo]
  )
}

async function reconciliarConfirmacoesPendentes(pool, limit = 100) {
  const max = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 1000)
  await pool.query(
    `UPDATE prospectador.lead_disparos
        SET status = 'pendente_confirmacao', erro = 'confirmacao_pendente:worker_interrompido'
      WHERE status = 'enviando' AND criado_em < NOW() - INTERVAL '5 minutes'`
  )
  const { rows } = await pool.query(
    `SELECT d.id AS disparo_id, d.prospect_id, d.evolution_message_id,
            u.status AS evolution_status
       FROM prospectador.lead_disparos d
       LEFT JOIN LATERAL (
         SELECT mu.status
           FROM public."MessageUpdate" mu
          WHERE mu."keyId" = d.evolution_message_id
          ORDER BY CASE UPPER(mu.status::text)
            WHEN 'ERROR' THEN 0
            WHEN 'PLAYED' THEN 1
            WHEN 'READ' THEN 2
            WHEN 'DELIVERY_ACK' THEN 3
            ELSE 4
          END
          LIMIT 1
       ) u ON true
      WHERE d.status = 'pendente_confirmacao'
        AND d.evolution_message_id IS NOT NULL
      ORDER BY d.criado_em ASC
      LIMIT $1`,
    [max]
  )
  let enviados = 0
  let falhos = 0
  for (const row of rows) {
    const status = String(row.evolution_status || '').toUpperCase()
    if (status === 'ERROR') {
      await marcarDisparoFalhou(pool, row.disparo_id, 'message_error')
      falhos++
    } else if (STATUS_EVOLUTION_SUCESSO.has(status)) {
      await finalizarDisparoEnviado(pool, {
        disparoId: row.disparo_id,
        prospectId: row.prospect_id,
      })
      enviados++
    }
  }
  return { verificados: rows.length, enviados, falhos }
}

// Envia um lote em background com jitter. Cada item: { prospect, disparoId, mensagem }.
// Quando gerar.ativo, regenera a mensagem por IA antes de enviar.
async function enviarLoteEmBackground(pool, { empresaId, evolutionInstance, itens, gerar }) {
  const resultados = []
  for (let i = 0; i < itens.length; i++) {
    const { prospect: p, disparoId } = itens[i]
    let mensagem = itens[i].mensagem
    let geradaPorIa = false
    try {
      if (gerar && gerar.ativo) {
        const r = await mensagemFinalDoLead(pool, {
          prospect: p, template: mensagem, gerarIa: true,
          instrucoes: gerar.instrucoes, contextoId: gerar.contextoId, empresaId,
        })
        if (r.falha_ia) {
          // IA obrigatória falhou: marca erro no status e NÃO envia (sem fallback silencioso).
          await marcarDisparoFalhou(pool, disparoId, 'ia_falhou').catch(() => {})
          logger.warn({ prospect: p.id }, '[rodar-leads] IA falhou — lead não enviado')
          resultados.push({ prospect_id: p.id, disparo_id: disparoId, status: 'falhou', erro: 'ia_falhou' })
          if (i < itens.length - 1) await sleep(delayAleatorio())
          continue
        }
        if (r.gerada_por_ia && r.texto && r.texto !== mensagem) {
          mensagem = r.texto
          geradaPorIa = true
          await pool.query(
            `UPDATE prospectador.lead_disparos SET mensagem = $2 WHERE id = $1`,
            [disparoId, mensagem]
          ).catch(() => {})
        }
      }
      const complianceFinal = await canProspectLead(pool, p.telefone, {
        prospectId: p.id,
        empresaId,
        complianceOnly: true,
      })
      if (!complianceFinal.allowed) {
        throw new Error(`compliance:${complianceFinal.reason || 'bloqueado'}`)
      }
      const respostaEnvio = await enviarMensagem(p.telefone, mensagem, { instanceName: evolutionInstance })
      const { keyId } = chaveMensagemEvolution(respostaEnvio)
      if (keyId) {
        await pool.query(
          `UPDATE prospectador.lead_disparos SET evolution_message_id = $2 WHERE id = $1`,
          [disparoId, keyId]
        )
      }
      let statusEvolution
      try {
        statusEvolution = await afirmarEnvioNaoFalhouNaEvolution(pool, respostaEnvio)
      } catch (err) {
        if (err.evolutionClassificacao) throw err
        logger.warn({ prospect: p.id, err: err.message }, '[rodar-leads] checagem MessageUpdate falhou')
        await marcarConfirmacaoPendente(pool, disparoId, keyId, 'checagem_indisponivel')
        resultados.push({ prospect_id: p.id, disparo_id: disparoId, status: 'pendente_confirmacao', erro: 'checagem_indisponivel' })
        if (i < itens.length - 1) await sleep(delayAleatorio())
        continue
      }
      if (!statusEvolution || !STATUS_EVOLUTION_SUCESSO.has(statusEvolution.status)) {
        const motivo = keyId ? `confirmacao_pendente:${statusEvolution?.status || 'PENDING'}` : 'confirmacao_pendente:sem_message_id'
        await marcarConfirmacaoPendente(pool, disparoId, keyId, motivo)
        resultados.push({ prospect_id: p.id, disparo_id: disparoId, status: 'pendente_confirmacao', erro: motivo })
        if (i < itens.length - 1) await sleep(delayAleatorio())
        continue
      }
      await finalizarDisparoEnviado(pool, { disparoId, prospectId: p.id })
      // Espelha a saudação no histórico da conversa (painel Conversas). Best-effort.
      await registrarEnvioNoHistorico(pool, {
        respostaEnvio,
        numero: p.telefone,
        texto: mensagem,
        tipo: 'prospeccao_saudacao',
        empresaId,
        evolutionInstance,
        meta: { prospect_id: p.id, gerada_por_ia: geradaPorIa, evolution_status: statusEvolution?.status || null },
      }).catch((err) => logger.warn({ prospect: p.id, err: err.message }, '[rodar-leads] registrar saudação no histórico falhou'))
      resultados.push({ prospect_id: p.id, disparo_id: disparoId, status: 'enviado', erro: null })
    } catch (err) {
      // Número sem conta WhatsApp (Evolution exists:false) ⇒ registra e não reabordar.
      const tipoErroEvolution = err.evolutionClassificacao?.tipo || null
      const semWhatsapp = tipoErroEvolution === 'numero_inexistente'
      const erroDisparo = semWhatsapp
        ? 'sem_whatsapp'
        : (tipoErroEvolution || String(err.message || 'falha_envio')).slice(0, 800)
      await marcarDisparoFalhou(pool, disparoId, erroDisparo, p.id, semWhatsapp).catch(() => {})
      logger.warn({ prospect: p.id, err: err.message, sem_whatsapp: semWhatsapp }, '[rodar-leads] envio falhou')
      resultados.push({ prospect_id: p.id, disparo_id: disparoId, status: 'falhou', erro: erroDisparo })
    }
    // Espaça o próximo envio (menos no último).
    if (i < itens.length - 1) await sleep(delayAleatorio())
  }
  return resultados
}

module.exports = {
  rodarLeads,
  gerarMensagensSemi,
  gerarPendentesSemi,
  dispararGerados,
  estadoEnvioInstancia,
  mensagemFinalDoLead,
  montarJsonApresentacaoDoProspect,
  chaveMensagemEvolution,
  aguardarStatusEnvioEvolution,
  afirmarEnvioNaoFalhouNaEvolution,
  enviarLoteEmBackground,
  reconciliarConfirmacoesPendentes,
  finalizarDisparoEnviado,
  renderSaudacao,
  estadoThrottle,
  carregarInstancia,
  saudacaoDaInstancia,
  separarElegiveis,
  exigirInstanciaConectada,
  STATUS_RODAVEL,
  MAX_LOTE,
  COOLDOWN_MIN,
  TETO_DIARIO,
}
