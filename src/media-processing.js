'use strict'

const axios = require('axios')
const FormData = require('form-data')

const {
  WHISPER_SERVICE_URL,
  MAX_IMAGEM_BYTES_CLAUDE,
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

  function mimeImagemParaClaude(mimetype) {
    if (!mimetype || typeof mimetype !== 'string') return 'image/jpeg'
    const base = mimetype.split(';')[0].trim().toLowerCase()
    if (base === 'image/jpg') return 'image/jpeg'
    const ok = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (ok.includes(base)) return base
    return null
  }

  async function transcreverAudioLocal(buffer, filename, mimetype) {
    const form = new FormData()
    form.append('file', buffer, { filename, contentType: mimetype || 'application/octet-stream' })
    const { data } = await axios.post(`${WHISPER_SERVICE_URL}/transcribe`, form, {
      headers: form.getHeaders(),
      timeout: 120000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    })
    return typeof data?.text === 'string' ? data.text : ''
  }

  function localizarAudioPartMensagem(msg) {
    return msg?.message?.audioMessage || null
  }

  async function baixarETranscreverAudioMensagem(msg, audioPart, instance) {
    if (!audioPart) throw new Error('Mensagem sem audioMessage')
    const b64 = await evolutionObterBase64Midia(msg, instance)
    const rawB64 = limparBase64String(b64)
    if (!rawB64) throw new Error('Audio sem base64 retornado pela Evolution')
    const buf = Buffer.from(rawB64, 'base64')
    const mimeFull = (audioPart.mimetype || 'audio/ogg').split(';')[0].trim()
    const ext =
      /mp4|m4a/i.test(mimeFull) ? 'm4a' : /mpeg|mp3/i.test(mimeFull) ? 'mp3' : 'ogg'
    const transcricao = await transcreverAudioLocal(buf, `audio.${ext}`, mimeFull)
    if (!transcricao || !transcricao.trim()) throw new Error('Whisper retornou transcricao vazia')
    return { transcricao: transcricao.trim(), mimetype: mimeFull, bytes: buf.length }
  }

  async function processarImagemWebhook(msg, part, textoBase, isSticker, remetenteCliente = true, instance) {
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
      const b64 = await evolutionObterBase64Midia(msg, instance)
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

  async function processarAudioWebhook(msg, audioPart, textoBase, remetenteCliente = true, instance) {
    const numeroAudio = canonicoRemoteJidParaConversa(msg?.key) || msg?.key?.remoteJid || null
    const messageKeyAudio = construirChaveIdempotenciaWebhookMensagem(msg)
    const fallbackAudio =
      remetenteCliente
        ? '[Audio recebido - nao foi possivel baixar/transcrever. Peca ao cliente para repetir ou enviar em texto.]'
        : '[Audio recebido - nao foi possivel baixar/transcrever. Peca ao operador para repetir ou enviar em texto.]'
    try {
      const rAudio = await baixarETranscreverAudioMensagem(msg, audioPart, instance)
      if (numeroAudio) {
        await registrarAudioProcessamento(numeroAudio, messageKeyAudio, msg, audioPart, {
          status: 'processed',
          transcricao: rAudio.transcricao,
          mimetype: rAudio.mimetype,
          incrementAttempt: true,
        }).catch((e) => log.warn('Audio processado nao registrado:', e.message))
      }
      const linhasAudio = []
      if (textoBase) linhasAudio.push(textoBase)
      linhasAudio.push(`[Audio transcrito] ${rAudio.transcricao}`)
      return { texto: linhasAudio.filter(Boolean).join('\n\n'), visao: null }
    } catch (eAudio) {
      log.error('Audio/Whisper:', eAudio.response?.data || eAudio.message)
      if (numeroAudio) {
        await registrarAudioProcessamento(numeroAudio, messageKeyAudio, msg, audioPart, {
          status: 'pending',
          erro: eAudio.message || String(eAudio),
          incrementAttempt: true,
        }).catch((e2) => log.warn('Audio pendente nao registrado:', e2.message))
      }
      return { texto: textoBase || fallbackAudio, visao: null }
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

  async function extrairTextoEMidiaDoWebhook(msg, opts = {}) {
    const remetenteCliente = opts.remetenteCliente !== false
    const instance = opts.instance || null
    const m = msg?.message
    if (!m) {
      return { texto: null, visao: null }
    }

    const textoInterativo = extrairTextoInterativo(m)
    if (textoInterativo) return { texto: textoInterativo, visao: null }

    const textoBase = stripCitacaoWhatsappTexto(
      (m.conversation || m.extendedTextMessage?.text || '').trim()
    )

    if (m.imageMessage) {
      return processarImagemWebhook(msg, m.imageMessage, textoBase, false, remetenteCliente, instance)
    }
    if (m.stickerMessage) {
      return processarImagemWebhook(msg, m.stickerMessage, textoBase, true, remetenteCliente, instance)
    }
    if (m.documentMessage?.mimetype?.startsWith('image/')) {
      return processarImagemWebhook(msg, m.documentMessage, textoBase, false, remetenteCliente, instance)
    }
    if (m.audioMessage) {
      return processarAudioWebhook(msg, m.audioMessage, textoBase, remetenteCliente, instance)
    }

    if (textoBase) return { texto: textoBase, visao: null }
    return { texto: null, visao: null }
  }

  return {
    limparBase64String,
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
