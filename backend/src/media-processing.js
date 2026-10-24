'use strict'

const axios = require('axios')
const FormData = require('form-data')

const {
  OPENAI_KEY,
  MAX_IMAGEM_BYTES_CLAUDE,
  AUDIO_TRANSCRIPTION_MAX_BYTES,
  AUDIO_TRANSCRIPTION_TIMEOUT_MS,
  OPENAI_TRANSCRIPTION_MODEL,
} = require('./config')
const { stripCitacaoWhatsappTexto } = require('./string-utils')

function createMediaProcessing({
  whatsapp,
  logger,
  registrarAudioProcessamento,
  canonicoRemoteJidParaConversa,
  construirChaveIdempotenciaWebhookMensagem,
}) {
  const { evolutionObterBase64Midia } = whatsapp
  const log = logger || console

  function limparBase64String(s) {
    if (!s || typeof s !== 'string') return ''
    const u = s.trim()
    const m = u.match(/^data:[^;]+;base64,(.+)$/is)
    return (m ? m[1] : u).replace(/\s/g, '')
  }

  function extrairMensagemEncapsulada(message) {
    let atual = message && typeof message === 'object' ? message : null
    const vistos = new Set()
    while (atual && typeof atual === 'object' && !vistos.has(atual)) {
      vistos.add(atual)
      const interno =
        atual.ephemeralMessage?.message ||
        atual.viewOnceMessage?.message ||
        atual.viewOnceMessageV2?.message ||
        atual.viewOnceMessageV2Extension?.message ||
        atual.documentWithCaptionMessage?.message
      if (!interno || typeof interno !== 'object') break
      atual = interno
    }
    return atual || {}
  }

  function localizarAudioPartMensagem(msg) {
    const message = extrairMensagemEncapsulada(msg?.message)
    if (message.audioMessage && typeof message.audioMessage === 'object') {
      return { ...message.audioMessage, _tipo: 'audio' }
    }
    const documento = message.documentMessage
    if (documento && typeof documento === 'object' && /^audio\//i.test(String(documento.mimetype || ''))) {
      return { ...documento, _tipo: 'documento_audio' }
    }
    return null
  }

  function mimeAudioNormalizado(mimetype) {
    const mime = String(mimetype || '').split(';')[0].trim().toLowerCase()
    if (!mime) return 'audio/ogg'
    if (mime === 'audio/opus') return 'audio/ogg'
    return mime
  }

  function extensaoAudio(mimetype, filename = '') {
    const extArquivo = String(filename).match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase()
    if (extArquivo) return extArquivo
    const mime = mimeAudioNormalizado(mimetype)
    if (/ogg|opus/.test(mime)) return 'ogg'
    if (/mpeg|mp3/.test(mime)) return 'mp3'
    if (/mp4|m4a/.test(mime)) return 'm4a'
    if (/wav/.test(mime)) return 'wav'
    if (/webm/.test(mime)) return 'webm'
    if (/flac/.test(mime)) return 'flac'
    return 'bin'
  }

  function bufferDeBase64Valido(valor) {
    const raw = limparBase64String(valor)
    if (!raw || raw.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) {
      throw new Error('Base64 de áudio inválido retornado pela Evolution')
    }
    const buffer = Buffer.from(raw, 'base64')
    if (!buffer.length) throw new Error('Áudio vazio retornado pela Evolution')
    if (buffer.length > AUDIO_TRANSCRIPTION_MAX_BYTES) {
      throw new Error(`Áudio excede o limite de ${Math.floor(AUDIO_TRANSCRIPTION_MAX_BYTES / 1024 / 1024)} MB para transcrição`)
    }
    return buffer
  }

  function erroAudioSeguro(err, etapa) {
    const status = Number(err?.response?.status) || null
    const code = String(err?.code || '').slice(0, 80) || null
    const tipo = status === 401 || status === 403
      ? 'autenticacao'
      : status === 413
        ? 'midia_grande'
        : status === 408 || status === 429 || status >= 500 || ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET'].includes(code)
          ? 'transitorio'
          : 'permanente'
    return { etapa, status, code, tipo, mensagem: String(err?.message || 'falha desconhecida').slice(0, 300) }
  }

  function mimeImagemParaClaude(mimetype) {
    if (!mimetype || typeof mimetype !== 'string') return 'image/jpeg'
    const base = mimetype.split(';')[0].trim().toLowerCase()
    if (base === 'image/jpg') return 'image/jpeg'
    const ok = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (ok.includes(base)) return base
    return null
  }

  async function transcreverAudioLocal(buffer, filename, mimetype) {
    if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY é necessária para transcrever áudios')
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Arquivo de áudio vazio')
    if (buffer.length > AUDIO_TRANSCRIPTION_MAX_BYTES) throw new Error('Arquivo de áudio excede o limite de transcrição')
    const form = new FormData()
    form.append('file', buffer, { filename, contentType: mimetype || 'application/octet-stream' })
    form.append('model', OPENAI_TRANSCRIPTION_MODEL)
    form.append('language', 'pt')
    form.append('prompt', 'Transcrição de áudio em português brasileiro. Contexto: conversa informal sobre vendas, planos, mensalidades, clientes e serviços.')
    const { data } = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${OPENAI_KEY}` },
      timeout: AUDIO_TRANSCRIPTION_TIMEOUT_MS,
      maxContentLength: AUDIO_TRANSCRIPTION_MAX_BYTES,
      maxBodyLength: AUDIO_TRANSCRIPTION_MAX_BYTES,
    })
    return typeof data?.text === 'string' ? data.text : ''
  }

  async function baixarETranscreverAudioMensagem(msg, audioPart, instanceName = '', opts = {}) {
    if (!audioPart) throw new Error('Mensagem sem áudio compatível')
    if (typeof opts.onStage === 'function') await opts.onStage('downloading')
    const b64 = await evolutionObterBase64Midia(msg, { instanceName })
    const buf = bufferDeBase64Valido(b64)
    const mimeFull = mimeAudioNormalizado(audioPart.mimetype)
    const ext = extensaoAudio(mimeFull, audioPart.fileName)
    if (typeof opts.onStage === 'function') await opts.onStage('transcribing')
    const transcricao = await transcreverAudioLocal(buf, `audio.${ext}`, mimeFull)
    if (!transcricao || !transcricao.trim()) throw new Error('OpenAI retornou transcrição vazia')
    return { transcricao: transcricao.trim(), mimetype: mimeFull, bytes: buf.length }
  }

  async function processarImagemWebhook(msg, part, textoBase, isSticker, remetenteCliente = true, instanceName = '') {
    const caption = (part.caption || '').trim()
    const partes = [textoBase, caption].filter((s) => s && s.length)
    const fallbackSticker = remetenteCliente ? 'O cliente enviou uma figurinha.' : 'O operador enviou uma figurinha.'
    const fallbackImage = remetenteCliente ? 'O cliente enviou uma imagem.' : 'O operador enviou uma imagem.'
    let texto = partes.join('\n\n') || (isSticker ? fallbackSticker : fallbackImage)
    const mimeRaw = (part.mimetype || 'image/jpeg').split(';')[0].trim()
    const mime = mimeImagemParaClaude(mimeRaw)
    if (!mime) {
      texto += `\n\n[Imagem em formato nao suportado para analise automatica: ${mimeRaw}]`
      return { texto: texto.trim(), visao: null }
    }
    let rawB64 = ''
    try {
      const b64 = await evolutionObterBase64Midia(msg, { instanceName })
      rawB64 = limparBase64String(b64)
    } catch (e) {
      log.error('Imagem Evolution:', e.message)
      texto += '\n\n[Nao foi possivel baixar a imagem para analise.]'
      return { texto: texto.trim(), visao: null }
    }
    if (!rawB64) {
      texto += '\n\n[Midia vazia.]'
      return { texto: texto.trim(), visao: null }
    }
    let bufLen = 0
    try {
      bufLen = Buffer.from(rawB64, 'base64').length
    } catch (_) {}
    if (bufLen > MAX_IMAGEM_BYTES_CLAUDE) {
      texto += `\n\n[Imagem muito grande (${Math.round(bufLen / 1024)} KB) para analise automatica.]`
      return { texto: texto.trim(), visao: null }
    }
    return { texto: texto.trim(), visao: { media_type: mime, data: rawB64 } }
  }

  async function processarAudioWebhook(msg, audioPart, textoBase, remetenteCliente = true, instanceName = '', opts = {}) {
    const numeroAudio = canonicoRemoteJidParaConversa(msg?.key) || msg?.key?.remoteJid || null
    const messageKeyAudio = construirChaveIdempotenciaWebhookMensagem(msg)
    if (opts.deferir === true && numeroAudio) {
      const registro = await registrarAudioProcessamento(numeroAudio, messageKeyAudio, msg, audioPart, {
        status: 'pending',
        mimetype: mimeAudioNormalizado(audioPart.mimetype),
        empresaId: opts.empresaId || null,
        evolutionInstance: instanceName || null,
      })
      const marcador = `[Audio recebido — transcrição em processamento #${registro.id}]`
      return { texto: [textoBase, marcador].filter(Boolean).join('\n\n'), visao: null, audio: { id: registro.id, marcador } }
    }
    try {
      const rAudio = await baixarETranscreverAudioMensagem(msg, audioPart, instanceName)
      if (numeroAudio) {
        await registrarAudioProcessamento(numeroAudio, messageKeyAudio, msg, audioPart, {
          status: 'completed',
          transcricao: rAudio.transcricao,
          mimetype: rAudio.mimetype,
          incrementAttempt: true,
        }).catch((e) => log.warn('Audio processado nao registrado:', e.message))
      }
      const linhasAudio = []
      if (textoBase) linhasAudio.push(textoBase)
      linhasAudio.push(`[Audio transcrito] ${rAudio.transcricao}`)
      return { texto: linhasAudio.filter(Boolean).join('\n\n'), visao: null, audio: null }
    } catch (eAudio) {
      log.error({ audio: erroAudioSeguro(eAudio, 'sincrono') }, 'Falha ao transcrever áudio')
      if (numeroAudio) {
        await registrarAudioProcessamento(numeroAudio, messageKeyAudio, msg, audioPart, {
          status: 'retrying',
          erro: eAudio.message || String(eAudio),
          incrementAttempt: true,
        }).catch((e2) => log.warn('Audio pendente nao registrado:', e2.message))
      }
      return { texto: textoBase || '[Áudio recebido — transcrição indisponível.]', visao: null, audio: null }
    }
  }

  function extrairTextoInterativo(m) {
    if (!m) return null
    const rowId =
      m.listResponseMessage?.singleSelectReply?.selectedRowId ||
      m.listResponseMessage?.selectedRowId
    if (rowId) return String(rowId)
    const btnId =
      m.buttonsResponseMessage?.selectedButtonId ||
      m.templateButtonReplyMessage?.selectedId
    if (btnId) return String(btnId)
    return null
  }

  // Fase 2: `opts.instanceName` e a instancia que RECEBEU a mensagem (provada pelo webhook).
  // Baixar midia tambem e uma chamada A UMA instancia: sem esse repasse, o download caia na
  // instancia global do env e so funcionava enquanto existia uma unica instancia.
  async function extrairTextoEMidiaDoWebhook(msg, opts = {}) {
    const remetenteCliente = opts.remetenteCliente !== false
    const instanceName = String(opts.instanceName || '').trim()
    const m = extrairMensagemEncapsulada(msg?.message)
    if (!m) {
      return { texto: null, visao: null }
    }

    const textoInterativo = extrairTextoInterativo(m)
    if (textoInterativo) return { texto: textoInterativo, visao: null }

    const textoBase = stripCitacaoWhatsappTexto(
      (m.conversation || m.extendedTextMessage?.text || '').trim()
    )

    if (m.imageMessage) {
      return processarImagemWebhook(msg, m.imageMessage, textoBase, false, remetenteCliente, instanceName)
    }
    if (m.stickerMessage) {
      return processarImagemWebhook(msg, m.stickerMessage, textoBase, true, remetenteCliente, instanceName)
    }
    if (m.documentMessage?.mimetype?.startsWith('image/')) {
      return processarImagemWebhook(msg, m.documentMessage, textoBase, false, remetenteCliente, instanceName)
    }
    const audioPart = localizarAudioPartMensagem(msg)
    if (audioPart) {
      return processarAudioWebhook(msg, audioPart, textoBase, remetenteCliente, instanceName, opts)
    }

    if (textoBase) return { texto: textoBase, visao: null }
    return { texto: null, visao: null }
  }

  return {
    limparBase64String,
    extrairMensagemEncapsulada,
    mimeAudioNormalizado,
    extensaoAudio,
    bufferDeBase64Valido,
    erroAudioSeguro,
    mimeImagemParaClaude,
    transcreverAudioLocal,
    localizarAudioPartMensagem,
    baixarETranscreverAudioMensagem,
    processarImagemWebhook,
    processarAudioWebhook,
    extrairTextoInterativo,
    extrairTextoEMidiaDoWebhook,
  }
}

module.exports = { createMediaProcessing }
