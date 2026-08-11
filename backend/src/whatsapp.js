'use strict'
const axios = require('axios')
const fs = require('fs')
const path = require('path')
const { logger, redactPhone, serializeError } = require('./logger')
const { aplicarNomeEmpresa } = require('./institutional-language')
const {
  MOTIVOS_BLOQUEIO,
  ErroInstanciaEnvio,
  erroInstanciaEnvio,
  normalizarNomeInstancia,
  nomeParaEnvio,
  validarInstanciaParaEnvio,
} = require('./services/instancia-envio')
const ROOT = path.join(__dirname, '..')

const EVOLUTION_URL = process.env.EVOLUTION_URL || 'http://evolution-api:8080'
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY
// NAO existe instancia global de envio. `EVOLUTION_INSTANCE` (default literal 'PJ') era lida
// aqui e servia de ultimo fallback: sem instancia na conversa, a mensagem saia pelo numero do
// env — que pode pertencer a OUTRA empresa. Era o mesmo defeito que a quarentena de webhook
// (migration 060) removeu do lado da ENTRADA, vivo do lado da SAIDA. Ver `services/instancia-envio.js`.

const BOLHAS_ENVIO_DELAY_MS = 450
// Timeout default para chamadas Evolution. Antes ausente -> axios default = 0
// = infinito, podia pendurar worker indefinidamente quando Evolution travasse.
const EVOLUTION_DEFAULT_TIMEOUT_MS = Math.max(
  parseInt(process.env.EVOLUTION_TIMEOUT_MS, 10) || 15000,
  3000
)

/** Compatibilidade: a normalizacao vive no modulo puro (dono do vocabulario). */
const normalizarEvolutionInstanceName = normalizarNomeInstancia

/** Le a conversa. Falha TECNICA nao vira "sem vinculo" — vira `erro_resolucao`, como na quarentena. */
async function carregarVinculoDaConversa(jid) {
  if (!jid) return null
  try {
    const { pool } = require('./db')
    const { rows } = await pool.query(
      `SELECT empresa_id, evolution_instance
         FROM vendas.conversas
        WHERE numero = $1
        LIMIT 1`,
      [jid]
    )
    return rows[0] || null
  } catch (err) {
    logger.error(
      { err: serializeError(err), numero: redactPhone(jid) },
      'Falha ao ler o vinculo de instancia da conversa'
    )
    throw erroInstanciaEnvio(MOTIVOS_BLOQUEIO.ERRO_RESOLUCAO)
  }
}

/** Le a instancia PELO NOME (`evolution_instance` e UNIQUE GLOBAL — a leitura e exata). */
async function carregarInstanciaPorNome(nome) {
  try {
    const { pool } = require('./db')
    const { rows } = await pool.query(
      `SELECT id, empresa_id, evolution_instance, ativo, config_json
         FROM app.empresa_whatsapp_instances
        WHERE evolution_instance = $1
        LIMIT 1`,
      [nome]
    )
    return rows[0] || null
  } catch (err) {
    logger.error({ err: serializeError(err) }, 'Falha ao ler a instancia WhatsApp para envio')
    throw erroInstanciaEnvio(MOTIVOS_BLOQUEIO.ERRO_RESOLUCAO)
  }
}

/**
 * REGRA UNICA de resolucao da instancia de envio — o unico caminho por onde qualquer
 * mensagem sai deste sistema para a Evolution API.
 *
 * Ordem, e nao ha uma terceira etapa:
 *   1. `opts.instanceName` — o chamador declarou por qual numero quer falar;
 *   2. `vendas.conversas.evolution_instance` — o vinculo gravado quando a conversa nasceu.
 * Nenhum dos dois? **Bloqueia** (`ErroInstanciaEnvio`, 409). NAO ha escolha por empresa com
 * uma instancia so, por `atualizado_em`, nem por `process.env.EVOLUTION_INSTANCE`.
 *
 * O nome escolhido e sempre CONFERIDO no banco: precisa existir, estar `ativo`, ser do canal
 * WhatsApp/Evolution e pertencer a mesma empresa da conversa e do chamador. Antes, mesmo quem
 * passava `instanceName` nao tinha nada disso verificado.
 *
 * @param {string} numero JID/telefone do destinatario (usado so para achar a conversa)
 * @param {{instanceName?: string, empresaId?: string}|string} opts
 * @returns {Promise<{instanceName: string, origem: string, empresaId: string, instanciaId: string|null}>}
 * @throws {ErroInstanciaEnvio}
 */
async function resolverInstanciaEnvio(numero, opts = {}) {
  const opcoes = typeof opts === 'string'
    ? { instanceName: opts }
    : (opts && typeof opts === 'object' ? opts : {})
  const jid = String(numero || '').trim()

  const conversa = await carregarVinculoDaConversa(jid)
  const nomeDaConversa = String(conversa?.evolution_instance || '').trim()

  const escolha = nomeParaEnvio({
    nomeSolicitado: opcoes.instanceName || '',
    nomeDaConversa,
  })
  if (!escolha.ok) throw erroInstanciaEnvio(escolha.motivo)

  const instancia = await carregarInstanciaPorNome(escolha.nome)
  const veredito = validarInstanciaParaEnvio({
    nome: escolha.nome,
    origem: escolha.origem,
    instancia,
    empresaIdDaConversa: conversa?.empresa_id || null,
    empresaIdDeclarada: opcoes.empresaId || null,
    nomeDaConversa,
  })
  if (!veredito.ok) throw erroInstanciaEnvio(veredito.motivo)

  if (veredito.divergeDaConversa) {
    // Escolha humana legitima (disparo do Banco de Leads, teste de numero). Fica no log
    // porque e o unico sinal de que o cliente vai receber de um numero diferente do que ja
    // falou com ele. A conversa NAO e migrada: ver D-8 em `db-crud.js`.
    logger.warn(
      { numero: redactPhone(jid), instancia_usada: veredito.instanceName, origem: veredito.origem },
      'Envio por instancia diferente da gravada na conversa'
    )
  }
  return veredito
}

/** Acucar: so o nome tecnico. Mesma regra, mesmo bloqueio. */
async function instanceNameParaEnvio(numero, opts = {}) {
  const { instanceName } = await resolverInstanciaEnvio(numero, opts)
  return instanceName
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function extrairBase64DaRespostaEvolution(data) {
  if (data == null) return null
  if (typeof data === 'string') return data
  if (typeof data.base64 === 'string') return data.base64
  if (data.data != null && typeof data.data === 'string') return data.data
  return null
}

// Baixar midia tambem e uma chamada a UMA instancia: pedir a midia de uma mensagem a
// instancia global do env so funcionava enquanto existia uma instancia. O nome vem do
// webhook (que ja o resolveu com prova) ou da propria conversa da mensagem.
async function evolutionObterBase64Midia(webMessageInfo, opts = {}) {
  const jidDaMensagem = String(webMessageInfo?.key?.remoteJid || '').trim()
  const instanceName = await instanceNameParaEnvio(jidDaMensagem, opts)
  const url = `${EVOLUTION_URL}/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`
  const { data } = await axios.post(
    url,
    { message: webMessageInfo, convertToMp4: false },
    { headers: { apikey: EVOLUTION_KEY }, timeout: 120000 }
  )
  assertEvolutionEnvioOk(data, 'getBase64FromMediaMessage')
  const b64 = extrairBase64DaRespostaEvolution(data)
  if (!b64 || typeof b64 !== 'string') {
    throw new Error('Resposta Evolution sem base64')
  }
  return b64
}

async function enviarImagemBase64(numero, b64, mimetype, legenda, rotulo = 'imagem', opts = {}) {
  const phone = numeroEnvioWhatsapp(numero)
  if (!phone || !b64) throw new Error(`Imagem invalida para envio (${rotulo})`)
  const instanceName = await instanceNameParaEnvio(numero, opts)
  const { data } = await axios.post(
    `${EVOLUTION_URL}/message/sendMedia/${encodeURIComponent(instanceName)}`,
    {
      number: phone,
      mediatype: 'image',
      mimetype: mimetype || 'image/png',
      media: b64,
      caption: legenda || '',
    },
    { headers: { apikey: EVOLUTION_KEY }, timeout: EVOLUTION_DEFAULT_TIMEOUT_MS }
  )
  assertEvolutionEnvioOk(data, `sendMedia(${rotulo})`)
  return true
}

// ─── EVOLUTION API ────────────────────────────────────────────────────────────

/** Quando `exists: false`, o WhatsApp não reconhece o número (inválido, sem app ou checagem falhou). */
function evolutionDetalheNumeroInexistente(data) {
  if (!data || typeof data !== 'object') return null
  const arr = data.response?.message
  if (!Array.isArray(arr)) return null
  return arr.find((x) => x && x.exists === false) || null
}

/** Evolution costuma responder HTTP 200 com `{ success: false }` no corpo — tratar como falha. */
function evolutionCorpoIndicaFalha(data) {
  return data != null && typeof data === 'object' && data.success === false
}

function evolutionMensagemErroDoCorpo(data) {
  if (!data || typeof data !== 'object') return 'success:false'
  const m = data.message || data.error || data.msg
  if (typeof m === 'string' && m.trim()) return m.trim().slice(0, 400)
  try {
    return JSON.stringify(data).slice(0, 500)
  } catch (_) {
    return 'success:false'
  }
}

function evolutionStatusMensagem(data) {
  if (!data || typeof data !== 'object') return ''
  const candidatos = [
    data.status,
    data.message?.status,
    data.data?.status,
    data.data?.message?.status,
    data.instance?.status,
  ]
  return String(candidatos.find((v) => typeof v === 'string' && v.trim()) || '').trim().toUpperCase()
}

function evolutionEnvioPendente(data) {
  return evolutionStatusMensagem(data) === 'PENDING'
}

function evolutionEnvioErro(data) {
  return evolutionStatusMensagem(data) === 'ERROR'
}

function assertEvolutionEnvioOk(data, rotulo) {
  if (evolutionEnvioErro(data)) {
    const err = new Error(`${rotulo}: Evolution retornou status ERROR`)
    err.evolutionClassificacao = {
      tipo: 'message_error',
      retryable: false,
      motivo: 'Evolution retornou status ERROR para o envio',
      status: 'ERROR',
    }
    throw err
  }
  if (evolutionCorpoIndicaFalha(data)) {
    throw new Error(`${rotulo}: Evolution retornou success:false — ${evolutionMensagemErroDoCorpo(data)}`)
  }
}

function evolutionErrorContext(e, operation, numero) {
  return {
    err: serializeError(e),
    operation,
    http_status: e.response?.status || null,
    numero: redactPhone(numero),
  }
}

/**
 * Classifica erros da Evolution API em tipos com flag retryable.
 * Retorna { tipo, retryable, motivo }.
 */
function classificarErroEvolution(err) {
  const status = err.response?.status
  const msgRaw = err.response?.data?.response?.message || err.response?.data?.message || err.message || ''
  const msg = String(Array.isArray(msgRaw) ? msgRaw.join(' ') : msgRaw).toLowerCase()
  const code = String(err.code || '')

  if (msg.includes('connection closed') || msg.includes('conexão fechada')) {
    return { tipo: 'instance_disconnected', retryable: true, motivo: 'Evolution instance connection closed' }
  }
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNABORTED') {
    return { tipo: 'transient', retryable: true, motivo: `Network error: ${code}` }
  }
  if (status === 502 || status === 503 || status === 504) {
    return { tipo: 'transient', retryable: true, motivo: `HTTP ${status} gateway error` }
  }
  if (status === 400 || status === 422) {
    // Antes de classificar como invalid_payload generico, checa se o WhatsApp
    // respondeu exists:false (numero nao tem conta WhatsApp). Visto em producao
    // como ~95% das falhas: numeros fixos sem WhatsApp Business.
    const detalheNumeroInexistente = evolutionDetalheNumeroInexistente(err.response?.data)
    if (detalheNumeroInexistente) {
      return {
        tipo: 'numero_inexistente',
        retryable: false,
        motivo: 'Numero nao tem conta WhatsApp (Evolution exists:false)',
        jid: detalheNumeroInexistente.jid || null,
        number: detalheNumeroInexistente.number || null,
      }
    }
    return { tipo: 'invalid_payload', retryable: false, motivo: `HTTP ${status} invalid payload` }
  }
  if (status === 401 || status === 403) {
    return { tipo: 'auth_error', retryable: false, motivo: `HTTP ${status} authentication error` }
  }
  if (status === 500) {
    return { tipo: 'transient', retryable: true, motivo: 'HTTP 500 internal server error' }
  }
  return { tipo: 'unknown', retryable: false, motivo: `Unexpected error: ${String(err.message || 'unknown').slice(0, 200)}` }
}

/**
 * Verifica se UMA instância nomeada está conectada na Evolution API.
 * Retorna { ok, instance, connected, state } ou erro estruturado. Nunca lança.
 *
 * O nome e OBRIGATORIO. Sem ele, este diagnostico media a instancia do env e reportava a
 * saude de um numero que podia nao ser o da empresa que perguntou — um painel que responde
 * sobre outro numero e pior que um painel que diz "nao sei".
 */
async function verificarStatusInstanciaEvolution(instanceNameOverride = '') {
  let instanceName = ''
  try {
    instanceName = normalizarEvolutionInstanceName(instanceNameOverride)
  } catch (_) {
    instanceName = ''
  }
  if (!instanceName) {
    return {
      ok: false,
      instance: null,
      connected: null,
      state: 'nao_informada',
      motivo: 'Instancia WhatsApp nao informada para a verificacao de status.',
      last_checked_at: new Date().toISOString(),
    }
  }
  if (!EVOLUTION_URL || !EVOLUTION_KEY) {
    return { ok: true, instance: instanceName, connected: null, state: 'unknown', motivo: 'Evolution não configurada' }
  }
  try {
    const r = await axios.get(
      `${EVOLUTION_URL}/instance/connectionState/${encodeURIComponent(instanceName)}`,
      { headers: { apikey: EVOLUTION_KEY }, timeout: 5000 }
    )
    const state = r.data?.instance?.state || r.data?.state || 'unknown'
    const stateNorm = String(state || '').toLowerCase()
    const connected = ['open', 'connected', 'connection_open'].includes(stateNorm)
    return {
      ok: connected,
      instance: instanceName,
      connected,
      state,
      last_checked_at: new Date().toISOString(),
      ...(connected ? {} : {
        tipo: 'instance_disconnected',
        retryable: true,
        motivo: `Instância WhatsApp não conectada (state: ${state})`,
      }),
    }
  } catch (e) {
    logger.warn({ err: serializeError(e), instance: instanceName }, 'verificarStatusInstanciaEvolution falhou')
    return { ok: true, instance: instanceName, connected: null, state: 'unknown', last_checked_at: new Date().toISOString() }
  }
}

// Consulta na Evolution quais números NÃO têm conta WhatsApp. Retorna um Set de dígitos
// CONFIRMADOS como inexistentes (exists:false), ou null se a checagem falhar. Só rejeita
// o que a Evolution afirma que não existe — nunca chuta (evita falso-negativo com o 9º dígito).
async function numerosSemWhatsapp(numeros, instanceNameOverride = '') {
  let instanceName = ''
  try {
    instanceName = normalizarEvolutionInstanceName(instanceNameOverride)
  } catch (_) {
    instanceName = ''
  }
  const nums = [...new Set((numeros || []).map((n) => numeroEnvioWhatsapp(n)).filter(Boolean))]
  if (!nums.length) return new Set()
  // Sem instancia nomeada a checagem NAO e feita: `null` ja significa "nao deu para checar"
  // no contrato desta funcao, e os chamadores tratam isso sem rejeitar numero nenhum.
  if (!instanceName) return null
  if (!EVOLUTION_URL || !EVOLUTION_KEY) return null
  try {
    const { data } = await axios.post(
      `${EVOLUTION_URL}/chat/whatsappNumbers/${encodeURIComponent(instanceName)}`,
      { numbers: nums },
      { headers: { apikey: EVOLUTION_KEY }, timeout: 10000 }
    )
    if (!Array.isArray(data)) return null
    const semZap = new Set()
    for (const item of data) {
      if (item && item.exists === false) semZap.add(String(item.number || '').replace(/\D/g, ''))
    }
    return semZap
  } catch (e) {
    logger.warn({ err: serializeError(e), instance: instanceName }, 'numerosSemWhatsapp falhou')
    return null
  }
}

function numeroEnvioWhatsapp(numero) {
  const raw = String(numero || '').trim()
  if (!raw) return ''
  if (/@g\.us$/i.test(raw) || /@broadcast$/i.test(raw)) return ''
  if (/@/.test(raw) && !/@s\.whatsapp\.net$/i.test(raw)) return ''
  let digitos = raw.replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
  // Números BR locais (DDD + 8/9 dígitos = 10 ou 11) chegam SEM o código do país.
  // Sem o 55 o WhatsApp rejeita (exists:false → 400 no envio). 12-13 dígitos já têm
  // código do país — não mexe. Regra por tamanho trata DDDs iniciados em 55 (RS) certo.
  if (digitos.length === 10 || digitos.length === 11) digitos = '55' + digitos
  return digitos
}

async function enviarMensagem(numero, texto, opts = {}) {
  // Rede de segurança FINAL: qualquer {{empresa}} ou "PJ Codeworks" legado que tenha
  // escapado dos boundaries (alertas de operador, footer, prospecção, agenda) é
  // resolvido aqui pelo padrão neutro/marca (EMPRESA_NOME_PADRAO). Nada de marca
  // fixa nem placeholder cru sai pro WhatsApp. O nome específico por conversa já
  // foi aplicado antes (chokepoint); aqui é só o último resort.
  const t = aplicarNomeEmpresa((texto || '').trim(), process.env.EMPRESA_NOME_PADRAO || 'nossa empresa')
  if (!t) throw new Error('Texto vazio para envio ao WhatsApp')
  const phone = numeroEnvioWhatsapp(numero)
  if (!phone) throw new Error('Número/JID inválido para envio')

  // Evolution API v2.3.7: /message/sendText requires property "text"
  // Simple format: number (digits only) + text (message content)
  const payload = {
    number: phone,  // ← Apenas dígitos, sem @s.whatsapp.net
    text: t         // ← Campo text (requerido pela API Evolution)
  }

  const instanceName = await instanceNameParaEnvio(numero, opts)

  try {
    if (String(process.env.EVOLUTION_ASSERT_CONNECTED || 'on').toLowerCase() !== 'off') {
      const status = await verificarStatusInstanciaEvolution(instanceName)
      if (status.connected === false) {
        const err = new Error(status.motivo || `Instancia WhatsApp nao conectada: ${instanceName}`)
        err.evolutionClassificacao = {
          tipo: 'instance_disconnected',
          retryable: true,
          motivo: status.motivo || `Instancia WhatsApp nao conectada: ${instanceName}`,
        }
        throw err
      }
    }
    const r = await axios.post(
      `${EVOLUTION_URL}/message/sendText/${encodeURIComponent(instanceName)}`,
      payload,
      { headers: { apikey: EVOLUTION_KEY }, timeout: EVOLUTION_DEFAULT_TIMEOUT_MS }
    )
    assertEvolutionEnvioOk(r.data, 'sendText')
    logger.info(
      {
        operation: 'sendText',
        instance: instanceName,
        numero: redactPhone(phone),
        response_key_id: r.data?.key?.id || r.data?.message?.key?.id || r.data?.data?.key?.id || null,
        status: r.data?.status || r.data?.message?.status || null,
      },
      'Evolution sendText ok'
    )
    return r.data
  } catch (e) {
    const classificacao = e.evolutionClassificacao || classificarErroEvolution(e)
    const errCtx = {
      ...evolutionErrorContext(e, 'sendText', phone),
      endpoint: `/message/sendText/${instanceName}`,
      payload_keys: Object.keys(payload),
      text_length: t.length,
      instance: instanceName,
      http_status: e.response?.status,
      response_data: e.response?.data,
      response_message: e.response?.data?.response?.message,
      axios_code: e.code,
      tipo_erro: classificacao.tipo,
      retryable: classificacao.retryable,
      motivo: classificacao.motivo,
    }
    if (classificacao.retryable) {
      logger.warn(errCtx, 'Evolution sendText failed (retryable)')
    } else {
      logger.error(errCtx, 'Evolution sendText failed')
    }
    e.evolutionClassificacao = classificacao
    throw e
  }
}

/**
 * Mapa de prints autorizados para envio automático ao lead.
 * Chave = valor do campo `enviar_print` no JSON da IA.
 * Valor = caminho relativo a partir da raiz do projeto.
 */
const PRINTS_AUTORIZADOS = {
  '874-analytics': 'knowledge/prints/874-analytics-30d.png',
  'modelos-site': 'knowledge/prints/modelos-site-3-tiers.png',
  'planos-mensais': 'knowledge/prints/planos-mensais.png',
  'operacao-digital': 'knowledge/prints/operacao-digital.png',
}

/**
 * Envia uma imagem local ao lead via Evolution API (sendMedia base64).
 * Retorna true se enviou, false se o arquivo não existir (sem lançar erro).
 */
async function enviarPrintLocal(numero, chave, legenda, opts = {}) {
  const caminho = PRINTS_AUTORIZADOS[chave]
  if (!caminho) {
    logger.warn({ chave }, 'enviar_print chave nao reconhecida')
    return false
  }
  const caminhoAbs = require('path').resolve(ROOT, caminho)
  const fs = require('fs')
  if (!fs.existsSync(caminhoAbs)) {
    logger.warn({ chave, caminho: caminhoAbs }, 'enviar_print arquivo nao encontrado; ignorando envio de imagem')
    return false
  }
  const b64 = fs.readFileSync(caminhoAbs).toString('base64')
  const phone = numeroEnvioWhatsapp(numero)
  if (!phone) {
    logger.warn({ chave, numero: redactPhone(numero) }, 'enviar_print numero/JID invalido; ignorando envio de imagem')
    return false
  }
  const instanceName = await instanceNameParaEnvio(numero, opts)
  try {
    const { data } = await axios.post(
      `${EVOLUTION_URL}/message/sendMedia/${encodeURIComponent(instanceName)}`,
      {
        number: phone,
        mediatype: 'image',
        mimetype: 'image/png',
        media: b64,
        caption: legenda || '',
      },
      { headers: { apikey: EVOLUTION_KEY }, timeout: EVOLUTION_DEFAULT_TIMEOUT_MS }
    )
    assertEvolutionEnvioOk(data, 'sendMedia(print)')
    logger.info({ chave, numero: redactPhone(phone) }, 'Print enviado ao lead')
    return true
  } catch (e) {
    logger.error(evolutionErrorContext(e, 'sendMedia(print)', phone), 'Evolution sendMedia print failed')
    return false
  }
}

async function enviarComBotoes(numero, texto, botoes, opts = {}) {
  const numLimpo = numeroEnvioWhatsapp(numero)
  const t = (texto || '').trim()
  if (!numLimpo || !t) throw new Error('Número ou texto inválido para envio com botões')

  const instanceName = await instanceNameParaEnvio(numero, opts)
  let textoPrincipalEnviado = false

  try {
    // Evolution API v2.3.7: sendText requires { number, text }
    const r0 = await axios.post(
      `${EVOLUTION_URL}/message/sendText/${encodeURIComponent(instanceName)}`,
      {
        number: numLimpo,  // ← Apenas dígitos
        text: t            // ← Campo requerido pela API
      },
      { headers: { apikey: EVOLUTION_KEY }, timeout: EVOLUTION_DEFAULT_TIMEOUT_MS }
    )
    assertEvolutionEnvioOk(r0.data, 'sendText(botoes)')
    textoPrincipalEnviado = true

    const r1 = await axios.post(
      `${EVOLUTION_URL}/message/sendButtons/${encodeURIComponent(instanceName)}`,
      {
        number: numLimpo,  // ← Apenas dígitos
        title: 'Escolha uma opção',
        description: 'Toque para responder',
        footer: process.env.EMPRESA_NOME_PADRAO || 'nossa empresa',
        buttons: botoes.map((b, i) => ({ type: 'reply', displayText: b, id: `opt_${i + 1}` }))
      },
      { headers: { apikey: EVOLUTION_KEY }, timeout: EVOLUTION_DEFAULT_TIMEOUT_MS }
    )
    assertEvolutionEnvioOk(r1.data, 'sendButtons')
    logger.info({ botoes }, 'Botoes enviados')
  } catch (err) {
    if (!textoPrincipalEnviado) throw err
    logger.info('Botoes nao suportados; texto ja enviado')
  }
}

async function enviarSequenciaMensagens(numero, partes, opts = {}) {
  // Resolve UMA vez e repassa o nome ja provado: as bolhas de um mesmo turno precisam sair
  // todas pelo mesmo numero, mesmo que algo mude no cadastro no meio da sequencia.
  const instanceName = await instanceNameParaEnvio(numero, opts)
  for (let i = 0; i < partes.length; i++) {
    await enviarMensagem(numero, partes[i], { instanceName })
    if (i < partes.length - 1) await sleep(BOLHAS_ENVIO_DELAY_MS)
  }
}

module.exports = {
  EVOLUTION_URL,
  EVOLUTION_KEY,
  BOLHAS_ENVIO_DELAY_MS,
  sleep,
  extrairBase64DaRespostaEvolution,
  evolutionObterBase64Midia,
  enviarImagemBase64,
  evolutionDetalheNumeroInexistente,
  evolutionCorpoIndicaFalha,
  evolutionMensagemErroDoCorpo,
  evolutionStatusMensagem,
  evolutionEnvioPendente,
  evolutionEnvioErro,
  assertEvolutionEnvioOk,
  classificarErroEvolution,
  verificarStatusInstanciaEvolution,
  numeroEnvioWhatsapp,
  numerosSemWhatsapp,
  enviarMensagem,
  enviarPrintLocal,
  enviarComBotoes,
  enviarSequenciaMensagens,
  normalizarEvolutionInstanceName,
  resolverInstanciaEnvio,
  instanceNameParaEnvio,
  ErroInstanciaEnvio,
  MOTIVOS_BLOQUEIO_INSTANCIA: MOTIVOS_BLOQUEIO,
}
