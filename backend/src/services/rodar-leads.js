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
const { registrarEnvioNoHistorico, jidConversaDoEnvio } = require('./historico-envio')
const { registrarAbordagemOrigem } = require('../db/abordagem-origem')
const { obterConfigBancoLeads } = require('../db/banco-leads-config')
const { gerarAbordagemAnalise } = require('./saudacao-analise')
const { montarJsonApresentacaoPlaces, montarJsonApresentacaoInstagram } = require('./lead-score-cadastro')
const { canProspectLead } = require('./prospecting-eligibility')
const { logger } = require('../logger')

// Circuit breaker da geração em massa por IA: nº de falhas CONSECUTIVAS que interrompem
// o lote (falha sistêmica — provider fora do ar, credencial inválida, quota etc — afeta
// todos os leads igualmente, então não vale marcar erro_ia em cada um). Ver gerarMensagensSemi.
const LIMITE_FALHAS_IA_CONSECUTIVAS = 3

const MAX_LOTE = Math.max(1, parseInt(process.env.RODAR_LEADS_MAX_LOTE, 10) || 15)
const COOLDOWN_MIN = Math.max(0, parseInt(process.env.RODAR_LEADS_COOLDOWN_MIN, 10) || 15)
const TETO_DIARIO = Math.max(0, parseInt(process.env.RODAR_LEADS_TETO_DIARIO, 10) || 40)
const DELAY_MIN_MS = Math.max(0, parseInt(process.env.RODAR_LEADS_DELAY_MIN_MS, 10) || 12000)
const DELAY_MAX_MS = Math.max(DELAY_MIN_MS, parseInt(process.env.RODAR_LEADS_DELAY_MAX_MS, 10) || 20000)

// A PORTA da operacao comercial (CRM em equipe, Etapa 3.4). Quem julga e' o modulo PURO —
// comparar `qualificacao` com literal aqui e' proibido e tem guarda de regressao.
const { avaliarAbordagem, rotuloMotivo, sqlAbordavel } = require('../services/lead-qualificacao')

// Status do prospect que ainda podem ser abordados (espelha a aba "sem_contato").
const STATUS_RODAVEL = new Set(['coletado', 'contato_encontrado', 'aguardando', 'aprovado'])
// Origens do Google Places (o resto é social — Instagram/LinkedIn).
const ORIGENS_PLACES = new Set(['manual', 'automatico'])
const STATUS_EVOLUTION_SUCESSO = new Set(['DELIVERY_ACK', 'READ', 'PLAYED'])

// A Evolution usa schemas diferentes entre os ambientes existentes deste projeto:
// Docker local grava em public; Railway grava em evolution. Detectamos a relação real
// e retornamos somente nomes hardcoded — nenhum identificador externo entra no SQL.
async function resolverTabelaMessageUpdate(pool) {
  const { rows } = await pool.query(
    `SELECT to_regclass('evolution."MessageUpdate"') IS NOT NULL AS evolution_disponivel,
            to_regclass('public."MessageUpdate"') IS NOT NULL AS public_disponivel`
  )
  if (rows[0]?.evolution_disponivel) return 'evolution."MessageUpdate"'
  if (rows[0]?.public_disponivel) return 'public."MessageUpdate"'
  const err = new Error('Tabela MessageUpdate da Evolution não encontrada')
  err.code = 'evolution_message_update_missing'
  throw err
}

// Colunas do prospect necessárias pro throttle/render/JSON de apresentação (geração IA).
// `qualificacao` E' OBRIGATORIA nesta lista: `avaliarAbordagem` NEGA quando a coluna nao vem
// (um SELECT que a esquece nao pode virar "pode abordar" — seria a porta aberta por omissao).
const COLS_PROSPECT = `id, nome, telefone, status, qualificacao, nicho, cidade, bloqueado_ate, tem_whatsapp,
  origem, email, endereco, rating, avaliacoes, tem_site, site, maps_url,
  place_id, link_original, link_bio, bio, categoria_perfil, seguidores, instagram_handle,
  instagram_confianca, instagram_atividade, instagram_ultimo_post_em, raw_json`

function delayAleatorio() {
  return DELAY_MIN_MS + Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS + 1))
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
function dedupeIds(prospectIds) {
  return Array.from(new Set((prospectIds || []).map((x) => String(x || '').trim()).filter(Boolean)))
}

/**
 * Só uma desconexão **PROVADA** barra o disparo. `connected === null` significa "não deu para
 * saber" — `verificarStatusInstanciaEvolution` devolve isso quando o `connectionState` responde
 * 5xx, estoura o timeout dela (5s, FIXO e mais curto que o do próprio envio) ou a Evolution
 * está reiniciando. Tratar esse "não sei" como "desconectada" bloqueava o Banco de Leads
 * inteiro (Manual, Semi e, pelo `erroDaInstancia`, todo o pool do Automático) com as instâncias
 * conectadas e respondendo — enquanto a resposta conversacional seguia saindo, porque o
 * chokepoint (`whatsapp.js`) sempre tolerou o desconhecido. Este era o ÚNICO ponto do
 * repositório que recusava ação com `connected !== true`.
 *
 * A autoridade sobre a conexão é o ENVIO, não a sonda: `enviarMensagem` classifica
 * `instance_disconnected` a partir do erro real e `assertEvolutionEnvioOk` recusa o HTTP 200
 * com `success:false`/`status:ERROR`. Na dúvida, deixa tentar e registra.
 */
async function exigirInstanciaConectada(instancia, verificarStatus = verificarStatusInstanciaEvolution) {
  const status = await verificarStatus(instancia.evolution_instance)
  if (status?.connected === false) {
    const e = new Error('A instância WhatsApp está desconectada. Reconecte-a antes de enviar.')
    e.statusCode = 409
    e.code = 'instance_disconnected'
    throw e
  }
  if (status?.connected !== true) {
    logger.warn(
      {
        operation: 'exigir_instancia_conectada',
        instancia: instancia.evolution_instance,
        state: status?.state || 'unknown',
        motivo: status?.motivo || null,
      },
      '[rodar-leads] conexao da instancia nao confirmada; seguindo e deixando o envio decidir'
    )
  }
  return status
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
  const tabelaMessageUpdate = await resolverTabelaMessageUpdate(pool)
  const timeoutMs = Math.max(0, opts.timeoutMs == null ? 12000 : Number(opts.timeoutMs) || 0)
  const intervalMs = Math.max(100, opts.intervalMs == null ? 700 : Number(opts.intervalMs) || 100)
  const fim = Date.now() + timeoutMs
  while (true) {
    const { rows } = await pool.query(
      `SELECT status
         FROM ${tabelaMessageUpdate}
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
async function mensagemFinalDoLead(pool, { prospect, template, gerarIa, instrucoes, contextoId, empresaId, _generate }) {
  if (!gerarIa) {
    // Template: nenhuma oferta foi SELECIONADA, então não há orientação a registrar. A origem
    // da conversa fica desconhecida, que é a verdade (ninguém escolheu oferta nenhuma).
    return { texto: renderSaudacao(template, prospect), gerada_por_ia: false, falha_ia: false, orientacao: null }
  }
  try {
    const jsonApresentacao = montarJsonApresentacaoDoProspect(prospect)
    const { texto: textoIa, orientacao } = await gerarAbordagemAnalise({
      pool, log: logger, empresaId, contextoId, jsonApresentacao,
      instrucoes, nomeLead: prospect.nome, telefone: prospect.telefone, _generate,
    })
    if (textoIa) return { texto: textoIa, gerada_por_ia: true, falha_ia: false, orientacao: orientacao || null }
  } catch (e) {
    logger.warn({ prospect: prospect.id, err: e.message }, '[rodar-leads] geração IA falhou')
  }
  return { texto: '', gerada_por_ia: false, falha_ia: true, orientacao: null }
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
/**
 * CONTINUIDADE DO LEAD — qual instancia JA fala com cada telefone, dentro desta empresa.
 *
 * O vinculo provado vive em `vendas.conversas.evolution_instance` (preservado pelo D-8). Esta
 * leitura existe porque quem ESCOLHE a instancia do disparo (o pool do Automatico, o seletor do
 * Manual) nao conhece a conversa: sem ela, o lead que ja falou com o numero A recebe a proxima
 * mensagem do numero B — e o historico continua dizendo A, porque a escrita preserva o vinculo.
 *
 * Conversa de OUTRA empresa nao e lida (isolamento). Conversa ORFA (`empresa_id IS NULL`) e,
 * porque a instancia gravada nela E a prova do vinculo — a mesma regra de
 * `validarInstanciaParaEnvio`.
 *
 * O JID vem de `jidConversaDoEnvio`, a MESMA funcao que cria a linha da conversa: duas
 * normalizacoes de telefone divergiriam e o vinculo deixaria de ser encontrado em silencio.
 */
async function instanciasVinculadasDosLeads(pool, empresaId, telefones = []) {
  const porJid = new Map()
  const jids = []
  for (const t of telefones || []) {
    const jid = jidConversaDoEnvio(null, t)
    if (jid && !jids.includes(jid)) jids.push(jid)
  }
  if (!jids.length) return porJid
  const { rows } = await pool.query(
    `SELECT numero, BTRIM(evolution_instance) AS evolution_instance
       FROM vendas.conversas
      WHERE numero = ANY($1::text[])
        AND NULLIF(BTRIM(COALESCE(evolution_instance, '')), '') IS NOT NULL
        AND (empresa_id = $2::uuid OR empresa_id IS NULL)`,
    [jids, empresaId]
  )
  for (const r of rows) porJid.set(r.numero, r.evolution_instance)
  return porJid
}

/** A instancia vinculada a ESTE telefone, ou '' quando o lead ainda nao tem conversa. */
function vinculoDoTelefone(porJid, telefone) {
  const jid = jidConversaDoEnvio(null, telefone)
  return jid ? (porJid.get(jid) || '') : ''
}

async function separarElegiveis(pool, empresaId, ids, instanceName = null) {
  const { rows: prospects } = await pool.query(
    `SELECT ${COLS_PROSPECT}
       FROM prospectador.prospects
      WHERE empresa_id = $1 AND id = ANY($2::uuid[])`,
    [empresaId, ids]
  )
  const porId = new Map(prospects.map((p) => [p.id, p]))
  const vinculos = await instanciasVinculadasDosLeads(pool, empresaId, prospects.map((p) => p.telefone))
  const pulados = []
  const elegiveis = []
  const agora = Date.now()
  for (const id of ids) {
    const p = porId.get(id)
    if (!p) { pulados.push({ id, motivo: 'nao_encontrado' }); continue }
    if (p.bloqueado_ate && new Date(p.bloqueado_ate).getTime() > agora) { pulados.push({ id, motivo: 'bloqueado', bloqueado_ate: p.bloqueado_ate }); continue }
    if (!STATUS_RODAVEL.has(p.status)) { pulados.push({ id, motivo: `status_${p.status}` }); continue }
    // A PORTA: lead nao triado ou descartado nao e' abordado, nem quando um humano clica.
    const porta = avaliarAbordagem(p)
    if (!porta.permitido) { pulados.push({ id, motivo: 'nao_qualificado', detalhe: rotuloMotivo(porta.motivo) }); continue }
    if (!String(p.telefone || '').trim()) { pulados.push({ id, motivo: 'sem_telefone' }); continue }
    if (p.tem_whatsapp === false) { pulados.push({ id, motivo: 'sem_whatsapp' }); continue }
    // CONTINUIDADE: este lead ja fala com outro numero desta empresa. Pular e' o unico desfecho
    // honesto — enviar por este numero quebraria o atendimento que ja existe e deixaria o
    // historico apontando para a instancia antiga (D-8). Nunca se troca o numero em silencio.
    const vinculada = vinculoDoTelefone(vinculos, p.telefone)
    if (instanceName && vinculada && vinculada !== instanceName) {
      pulados.push({ id, motivo: 'instancia_vinculada_outra', instancia: vinculada })
      continue
    }
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
  const { elegiveis, pulados } = await separarElegiveis(pool, empresaId, ids, instancia.evolution_instance)
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
    usuarioId: usuarioId || null,
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

// Executa a reserva + geração de UM lead (sem decidir o que fazer com o resultado —
// quem chama confirma sucesso/erro ou desfaz a reserva). Usada tanto pelo pré-teste
// quanto pelo loop principal de gerarMensagensSemi.
async function tentarGerarUmLead(pool, { prospect, instancia, saudacao, config, empresaId, usuarioId, deps }) {
  const disparoId = await reservarGeracaoSemi(pool, {
    empresaId, usuarioId, evolutionInstance: instancia.evolution_instance, prospectId: prospect.id,
  })
  if (!disparoId) return { prospect, ocupado: true }
  const { texto, gerada_por_ia, falha_ia, orientacao } = await mensagemFinalDoLead(pool, {
    prospect, template: saudacao, gerarIa: !!config.gerar_ia,
    instrucoes: config.instrucoes_ia, contextoId: instancia.contexto_id, empresaId,
    _generate: deps && deps.generateAIResponse,
  })
  return { prospect, disparoId, texto, gerada_por_ia, falha_ia, orientacao }
}

/**
 * Registra a oferta usada como ORIGEM da conversa deste contato. Best-effort e sem transação:
 * é registro de contexto, não parte do envio — uma falha aqui não pode derrubar um disparo.
 */
async function registrarOrigemDoLead(pool, { empresaId, prospect, orientacao }) {
  if (!orientacao || !orientacao.oferta) return
  const numero = jidConversaDoEnvio(null, prospect && prospect.telefone)
  if (!numero) return
  await registrarAbordagemOrigem(pool, { empresaId, numero, orientacao, log: logger })
}

async function confirmarSucessoGeracao(pool, disparoId, texto) {
  await pool.query(
    `UPDATE prospectador.lead_disparos
        SET status = 'aguardando_disparo', mensagem = $2, erro = NULL
      WHERE id = $1 AND status = 'gerando'`,
    [disparoId, texto]
  )
}

async function confirmarErroGeracao(pool, disparoId) {
  await pool.query(
    `UPDATE prospectador.lead_disparos
        SET status = 'erro_ia', erro = 'ia_falhou'
      WHERE id = $1 AND status = 'gerando'`,
    [disparoId]
  )
}

// Desfaz a reserva feita por tentarGerarUmLead sem deixar rastro de erro — usado quando
// a falha é classificada como SISTÊMICA (o lote inteiro foi abortado, então este lead
// específico não deve aparecer como "erro individual" nem para o operador nem no banco).
async function desfazerReservaGeracao(pool, disparoId) {
  await pool.query(
    `DELETE FROM prospectador.lead_disparos WHERE id = $1 AND status = 'gerando'`,
    [disparoId]
  ).catch(() => {})
}

function falhaSistemicaIA(naoProcessados, falhasConsecutivas = null) {
  return {
    motivo: 'ia_indisponivel',
    falhas_consecutivas: falhasConsecutivas,
    nao_processados: naoProcessados,
    mensagem: 'A geração de mensagens por IA está indisponível no momento (provider fora do ar, '
      + 'credencial inválida ou limite de uso atingido). A geração em massa foi interrompida — '
      + `${naoProcessados} lead(s) não foram processados. Tente novamente em alguns minutos.`,
  }
}

/**
 * SEMI/MANUAL (geração em massa) — gera a mensagem (IA com fallback) e grava como
 * 'aguardando_disparo', SEM enviar e SEM consumir cooldown/teto.
 *
 * Falha SISTÊMICA de IA (provider fora do ar, credencial inválida, quota etc) afeta TODOS
 * os leads do lote da mesma forma — por isso, quando há mais de um lead selecionado:
 *   1) PRÉ-TESTE: a 1ª tentativa do lote já esgota os retries/fallback internos de
 *      gerarSaudacaoAnalise/generateAIResponse. Se mesmo assim falhar, é sinal forte de
 *      falha sistêmica: o lote inteiro é abortado ANTES de tentar os demais leads, a
 *      reserva do 1º é desfeita (sem marcar erro_ia) e a resposta traz `falha_sistemica`
 *      em vez de um erro por lead.
 *   2) CIRCUIT BREAKER: se o pré-teste passar mas a IA voltar a falhar
 *      LIMITE_FALHAS_IA_CONSECUTIVAS vezes seguidas no meio do lote, o restante é
 *      interrompido do mesmo jeito — os leads já processados (sucesso ou erro) são
 *      preservados em `gerados`, e os que nunca chegaram a ser tentados não geram
 *      registro de erro nenhum.
 * Erros específicos de um lead (sem chegar a esse padrão) continuam contabilizados
 * individualmente em `gerados` (erro_ia: true), como antes.
 */
async function gerarMensagensSemi(pool, { empresaId, usuarioId, instanciaId, prospectIds }, deps = {}) {
  const ids = dedupeIds(prospectIds)
  if (!ids.length) { const e = new Error('Selecione ao menos um lead.'); e.statusCode = 400; throw e }
  if (ids.length > MAX_LOTE) { const e = new Error(`Máximo de ${MAX_LOTE} leads por geração.`); e.statusCode = 400; throw e }

  const instancia = await carregarInstancia(pool, empresaId, instanciaId)
  if (!instancia) { const e = new Error('Instância não encontrada.'); e.statusCode = 404; throw e }
  if (!instancia.ativo) { const e = new Error('Instância está desativada. Ative o número antes de gerar.'); e.statusCode = 409; throw e }

  const saudacao = saudacaoDaInstancia(instancia)
  if (!saudacao) { const e = new Error('Configure a saudação (fallback) desta instância antes de gerar (botão "Testar envio").'); e.statusCode = 409; throw e }

  const config = await obterConfigBancoLeads(pool, empresaId)
  const { elegiveis, pulados } = await separarElegiveis(pool, empresaId, ids, instancia.evolution_instance)
  if (!elegiveis.length) return { gerados: [], pulados, falha_sistemica: null }

  const gerarIa = !!config.gerar_ia
  const gerados = []
  let restantes = elegiveis

  if (gerarIa && elegiveis.length > 1) {
    const [primeiro, ...resto] = elegiveis
    const r = await tentarGerarUmLead(pool, { prospect: primeiro, instancia, saudacao, config, empresaId, usuarioId, deps })
    if (r.ocupado) {
      pulados.push({ id: primeiro.id, motivo: 'ja_em_processamento' })
    } else if (r.falha_ia) {
      await desfazerReservaGeracao(pool, r.disparoId)
      const falhaSistemica = falhaSistemicaIA(elegiveis.length)
      logger.error({ empresaId, instanciaId, total: elegiveis.length },
        '[rodar-leads] pre-teste de geracao por IA falhou — lote abortado (falha sistemica)')
      return { gerados, pulados, falha_sistemica: falhaSistemica }
    } else {
      await confirmarSucessoGeracao(pool, r.disparoId, r.texto)
    await registrarOrigemDoLead(pool, { empresaId, prospect: r.prospect, orientacao: r.orientacao })
      await registrarOrigemDoLead(pool, { empresaId, prospect: r.prospect, orientacao: r.orientacao })
      gerados.push({ prospect_id: primeiro.id, nome: primeiro.nome, disparo_id: r.disparoId, mensagem: r.texto, gerada_por_ia: r.gerada_por_ia })
    }
    restantes = resto
  }

  let falhasConsecutivas = 0
  for (let i = 0; i < restantes.length; i++) {
    const p = restantes[i]
    const r = await tentarGerarUmLead(pool, { prospect: p, instancia, saudacao, config, empresaId, usuarioId, deps })
    if (r.ocupado) {
      pulados.push({ id: p.id, motivo: 'ja_em_processamento' })
      continue
    }
    if (r.falha_ia) {
      falhasConsecutivas++
      await confirmarErroGeracao(pool, r.disparoId)
      gerados.push({ prospect_id: p.id, nome: p.nome, erro_ia: true })
      if (falhasConsecutivas >= LIMITE_FALHAS_IA_CONSECUTIVAS) {
        const naoProcessados = restantes.length - i - 1
        const falhaSistemica = falhaSistemicaIA(naoProcessados, falhasConsecutivas)
        logger.error({ empresaId, instanciaId, falhasConsecutivas, naoProcessados },
          '[rodar-leads] falhas consecutivas de IA — geracao em massa interrompida (falha sistemica)')
        return { gerados, pulados, falha_sistemica: falhaSistemica }
      }
      continue
    }
    falhasConsecutivas = 0
    await confirmarSucessoGeracao(pool, r.disparoId, r.texto)
    gerados.push({ prospect_id: p.id, nome: p.nome, disparo_id: r.disparoId, mensagem: r.texto, gerada_por_ia: r.gerada_por_ia })
  }

  return { gerados, pulados, falha_sistemica: null }
}

async function gerarPendentesSemi(pool, { empresaId, usuarioId = null, instanciaId, limit = 100, recorteModo = null, autoNicho = null }, deps = {}) {
  const instancia = await carregarInstancia(pool, empresaId, instanciaId)
  if (!instancia) { const e = new Error('Instância não encontrada.'); e.statusCode = 404; throw e }
  if (!instancia.ativo) { const e = new Error('Instância está desativada. Ative o número antes de gerar.'); e.statusCode = 409; throw e }

  const max = Math.min(Math.max(parseInt(limit, 10) || MAX_LOTE, 1), 1000)
  // Recorte da carteira (mesma regra do modo Automático): 'nicho' com nicho definido filtra por
  // nicho/categoria; qualquer outro caso é 'geral' (carteira inteira). O recorte é passado pelo
  // chamador — o worker vem do cfg, a rota manual busca o config antes de chamar.
  const nicho = recorteModo === 'nicho' ? String(autoNicho || '').trim() : ''
  const params = [empresaId, [...STATUS_RODAVEL], instancia.evolution_instance, max]
  let filtroNicho = ''
  if (nicho) {
    params.push(nicho)
    const n = params.length
    filtroNicho = `AND (
          LOWER(BTRIM(COALESCE(p.nicho, ''))) = LOWER(BTRIM($${n}::text))
          OR LOWER(BTRIM(COALESCE(p.categoria_perfil, ''))) = LOWER(BTRIM($${n}::text))
        )`
  }
  const { rows } = await pool.query(
    `SELECT p.id
       FROM prospectador.prospects p
      WHERE p.empresa_id = $1
        AND p.status = ANY($2)
        ${filtroNicho}
        AND ${sqlAbordavel('p')}
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
      ORDER BY (p.qualificacao = 'aprovado') DESC, p.score DESC NULLS LAST, p.created_at ASC, p.id ASC
      LIMIT $4`,
    params
  )
  const ids = rows.map((r) => r.id).filter(Boolean)
  if (!ids.length) return { gerados: [], pulados: [], candidatos: 0, falha_sistemica: null }

  const total = { gerados: [], pulados: [], candidatos: ids.length, falha_sistemica: null }
  for (let i = 0; i < ids.length; i += MAX_LOTE) {
    const parte = ids.slice(i, i + MAX_LOTE)
    const res = await gerarMensagensSemi(pool, { empresaId, usuarioId, instanciaId, prospectIds: parte }, deps)
    total.gerados.push(...res.gerados)
    total.pulados.push(...res.pulados)
    if (res.falha_sistemica) {
      // Falha sistêmica: os demais lotes tenderiam a falhar pelo mesmo motivo — para aqui
      // em vez de repetir o pré-teste (e o custo de IA) a cada bloco de MAX_LOTE.
      const restantesIds = ids.slice(i + parte.length)
      total.falha_sistemica = {
        ...res.falha_sistemica,
        nao_processados: res.falha_sistemica.nao_processados + restantesIds.length,
      }
      break
    }
  }
  return total
}

/**
 * SEMI/AUTO — dispara as mensagens já geradas ('aguardando_disparo') de uma instância,
 * respeitando cooldown/teto anti-ban. Sem re-gerar: envia o texto salvo. Se prospectIds
 * vier vazio, dispara todos os rascunhos pendentes da instância.
 */
async function dispararGerados(pool, { empresaId, instanciaId, prospectIds, usuarioId = null }, deps = {}) {
  const instancia = await carregarInstancia(pool, empresaId, instanciaId)
  if (!instancia) { const e = new Error('Instância não encontrada.'); e.statusCode = 404; throw e }
  if (!instancia.ativo) { const e = new Error('Instância está desativada. Ative o número antes de disparar.'); e.statusCode = 409; throw e }
  await exigirInstanciaConectada(instancia, deps.verificarStatus)

  const config = await obterConfigBancoLeads(pool, empresaId)
  const tetoDiario = Number(config.teto_diario) > 0 ? Number(config.teto_diario) : TETO_DIARIO

  const filtroIds = dedupeIds(prospectIds)
  const params = [empresaId, instancia.evolution_instance]
  let sql = `SELECT d.id AS disparo_id, d.mensagem, p.id AS prospect_id, p.nome,
                    p.telefone, p.status, p.qualificacao, p.bloqueado_ate, p.tem_whatsapp
               FROM prospectador.lead_disparos d
               JOIN prospectador.prospects p ON p.id = d.prospect_id
              WHERE d.empresa_id = $1 AND d.evolution_instance = $2
                AND d.status = 'aguardando_disparo'`
  if (filtroIds.length) { params.push(filtroIds); sql += ` AND d.prospect_id = ANY($3::uuid[])` }
  sql += ` ORDER BY (p.qualificacao = 'aprovado') DESC, d.criado_em ASC`
  const { rows } = await pool.query(sql, params)

  // Reavalia elegibilidade no momento do disparo (pode ter travado/mudado desde a geração).
  const vinculos = await instanciasVinculadasDosLeads(pool, empresaId, rows.map((r) => r.telefone))
  const agora = Date.now()
  const pulados = []
  const candidatos = []
  for (const r of rows) {
    if (r.bloqueado_ate && new Date(r.bloqueado_ate).getTime() > agora) { pulados.push({ id: r.prospect_id, motivo: 'bloqueado' }); continue }
    if (!STATUS_RODAVEL.has(r.status)) { pulados.push({ id: r.prospect_id, motivo: `status_${r.status}` }); continue }
    // A PORTA, de novo: a mensagem pode ter sido gerada ANTES de alguem descartar o lead. Sem
    // reavaliar aqui, o Semi enviaria um texto aprovado para um lead ja recusado.
    const portaEnvio = avaliarAbordagem(r)
    if (!portaEnvio.permitido) { pulados.push({ id: r.prospect_id, motivo: 'nao_qualificado', detalhe: rotuloMotivo(portaEnvio.motivo) }); continue }
    if (!String(r.telefone || '').trim()) { pulados.push({ id: r.prospect_id, motivo: 'sem_telefone' }); continue }
    if (r.tem_whatsapp === false) {
      await marcarDisparoFalhou(pool, r.disparo_id, 'sem_whatsapp', r.prospect_id, true)
      pulados.push({ id: r.prospect_id, motivo: 'sem_whatsapp' })
      continue
    }
    // CONTINUIDADE: o rascunho foi gerado para ESTA instancia, mas o lead pode ter passado a
    // falar com outro numero desde entao. Marcar o disparo como falho (em vez de so pular) e' o
    // que faz o caso aparecer no painel — pular em silencio o repetiria a cada rodada.
    const vinculada = vinculoDoTelefone(vinculos, r.telefone)
    if (vinculada && vinculada !== instancia.evolution_instance) {
      await marcarDisparoFalhou(pool, r.disparo_id, `instancia_vinculada_outra:${vinculada}`)
      pulados.push({ id: r.prospect_id, motivo: 'instancia_vinculada_outra', instancia: vinculada })
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
    // Quem clicou "Disparar" e' o ACIONADOR. A AUTORIA do texto fica 'desconhecida' de
    // proposito: o rascunho do Semi foi gerado antes, e `lead_disparos` nao registra se veio da
    // IA ou do template. Deduzir pelo `gerar_ia` ATUAL afirmaria algo sobre um texto escrito no
    // passado — o tipo de inferencia silenciosa que este repositorio recusa. Limitacao
    // declarada; resolver exige uma coluna em `lead_disparos`, em diff proprio.
    usuarioId: usuarioId || null,
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
  const tabelaMessageUpdate = await resolverTabelaMessageUpdate(pool)
  await pool.query(
    `UPDATE prospectador.lead_disparos
        SET status = 'pendente_confirmacao', erro = 'confirmacao_pendente:worker_interrompido'
      WHERE status = 'enviando' AND criado_em < NOW() - INTERVAL '5 minutes'`
  )
  // SEM ID DE MENSAGEM NAO HA O QUE CONFIRMAR. A consulta abaixo exige
  // `evolution_message_id IS NOT NULL` (e precisa exigir: e' a chave do LATERAL no
  // message_update). Entao a linha que chegou a 'enviando' e morreu antes de obter a chave
  // — processo reiniciado no meio do lote, redeploy, OOM — virava 'pendente_confirmacao'
  // eterna: nunca mais era seleccionada por ninguem, e `whereCandidatosAutomatico`
  // (banco-leads-auto.js) exclui 'pendente_confirmacao' do recorte, entao aquele lead saia
  // da fila do Automatico PARA SEMPRE, em silencio.
  // Resolver como 'falhou' devolve o lead a fila. A janela de 60 min e' folgada de proposito:
  // o id vem da RESPOSTA do envio, entao sem ele o round-trip nao fechou.
  // RISCO DECLARADO E ACEITO: a Evolution pode ter entregue a mensagem e a resposta ter sido
  // perdida (timeout), e ai o lead pode ser abordado de novo. E' exatamente o mesmo risco que
  // o caminho de timeout do envio ja assume hoje (`marcarDisparoFalhou` no catch de
  // `enviarLoteEmBackground`) — preferir o lead perdido para sempre seria pior. O `erro`
  // distingue este caso de uma falha do provedor, para ser auditavel.
  const { rowCount: semConfirmacao } = await pool.query(
    `UPDATE prospectador.lead_disparos
        SET status = 'falhou', erro = 'sem_confirmacao:sem_id_mensagem'
      WHERE status = 'pendente_confirmacao'
        AND evolution_message_id IS NULL
        AND criado_em < NOW() - INTERVAL '60 minutes'`
  )
  if (semConfirmacao > 0) {
    logger.warn(
      { operation: 'reconciliar_confirmacoes', liberados: semConfirmacao },
      '[rodar-leads] disparos sem id de mensagem liberados; leads voltam para a fila'
    )
  }
  const { rows } = await pool.query(
    `SELECT d.id AS disparo_id, d.prospect_id, d.evolution_message_id,
            u.status AS evolution_status
       FROM prospectador.lead_disparos d
       LEFT JOIN LATERAL (
         SELECT mu.status
           FROM ${tabelaMessageUpdate} mu
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
async function enviarLoteEmBackground(pool, { empresaId, evolutionInstance, itens, gerar, usuarioId = null }) {
  const resultados = []
  for (let i = 0; i < itens.length; i++) {
    const { prospect: p, disparoId } = itens[i]
    let mensagem = itens[i].mensagem
    let geradaPorIa = false
    let orientacao = null
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
        orientacao = r.orientacao || null
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
      const respostaEnvio = await enviarMensagem(p.telefone, mensagem, {
        instanceName: evolutionInstance,
        empresaId,
        autoria: geradaPorIa ? 'ia' : 'desconhecida',
        acionadorUsuarioId: usuarioId || null,
        tipoMensagem: 'saudacao',
      })
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
      // A oferta só vira ORIGEM da conversa depois do envio CONFIRMADO: gravar antes faria o
      // atendimento continuar numa oferta que o lead nunca recebeu.
      await registrarOrigemDoLead(pool, { empresaId, prospect: p, orientacao })
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
  resolverTabelaMessageUpdate,
  finalizarDisparoEnviado,
  renderSaudacao,
  estadoThrottle,
  carregarInstancia,
  saudacaoDaInstancia,
  separarElegiveis,
  exigirInstanciaConectada,
  instanciasVinculadasDosLeads,
  vinculoDoTelefone,
  STATUS_RODAVEL,
  MAX_LOTE,
  COOLDOWN_MIN,
  TETO_DIARIO,
  LIMITE_FALHAS_IA_CONSECUTIVAS,
}
