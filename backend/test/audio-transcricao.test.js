'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createMediaProcessing } = require('../src/media-processing')
const { enfileirarTranscricaoAudio } = require('../src/db/audio-transcricao')

function criarMedia(registrar = async () => ({ id: 42 })) {
  return createMediaProcessing({
    whatsapp: { evolutionObterBase64Midia: async () => Buffer.from('audio').toString('base64') },
    logger: { info() {}, warn() {}, error() {} },
    registrarAudioProcessamento: registrar,
    canonicoRemoteJidParaConversa: (key) => key?.remoteJid || null,
    construirChaveIdempotenciaWebhookMensagem: (msg) => msg?.key?.id || null,
  })
}

test('localizarAudioPartMensagem reconhece áudio normal, envelope e documento de áudio', () => {
  const media = criarMedia()
  assert.equal(media.localizarAudioPartMensagem({ message: { audioMessage: { mimetype: 'audio/ogg' } } })._tipo, 'audio')
  assert.equal(media.localizarAudioPartMensagem({ message: { ephemeralMessage: { message: { audioMessage: { mimetype: 'audio/ogg' } } } } })._tipo, 'audio')
  assert.equal(media.localizarAudioPartMensagem({ message: { viewOnceMessageV2: { message: { documentMessage: { mimetype: 'audio/mpeg', fileName: 'voz.mp3' } } } } })._tipo, 'documento_audio')
  assert.equal(media.localizarAudioPartMensagem({ message: { documentMessage: { mimetype: 'application/pdf' } } }), null)
})

test('bufferDeBase64Valido rejeita mídia malformada e aplica limite antes da OpenAI', () => {
  const media = criarMedia()
  assert.throws(() => media.bufferDeBase64Valido('%%%'), /Base64/)
  assert.throws(() => media.bufferDeBase64Valido('a'), /Base64/)
  assert.deepEqual(media.bufferDeBase64Valido(Buffer.from('voz').toString('base64')), Buffer.from('voz'))
})

test('webhook de áudio em modo assíncrono registra o payload e não baixa mídia no webhook', async () => {
  let chamouDownload = false
  const media = createMediaProcessing({
    whatsapp: { evolutionObterBase64Midia: async () => { chamouDownload = true; return '' } },
    logger: { info() {}, warn() {}, error() {} },
    registrarAudioProcessamento: async (numero, key, msg, part, patch) => {
      assert.equal(numero, '5511999999999@s.whatsapp.net')
      assert.equal(key, 'abc')
      assert.equal(part._tipo, 'audio')
      assert.equal(patch.empresaId, 'empresa-a')
      assert.equal(patch.evolutionInstance, 'inst-a')
      return { id: 77 }
    },
    canonicoRemoteJidParaConversa: (key) => key.remoteJid,
    construirChaveIdempotenciaWebhookMensagem: (msg) => msg.key.id,
  })
  const msg = { key: { id: 'abc', remoteJid: '5511999999999@s.whatsapp.net' }, message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus' } } }
  const out = await media.extrairTextoEMidiaDoWebhook(msg, { deferir: true, empresaId: 'empresa-a', instanceName: 'inst-a' })
  assert.equal(chamouDownload, false)
  assert.equal(out.audio.id, 77)
  assert.match(out.texto, /processamento #77/)
})

test('mimetype e extensão preservam OGG/Opus aceito pela transcrição oficial', () => {
  const media = criarMedia()
  assert.equal(media.mimeAudioNormalizado('audio/opus; codecs=opus'), 'audio/ogg')
  assert.equal(media.extensaoAudio('audio/ogg'), 'ogg')
  assert.equal(media.extensaoAudio('audio/mpeg', 'gravacao.mp3'), 'mp3')
})

test('reprocessamento reutiliza a fila idempotente e nunca recoloca áudio concluído', async () => {
  const chamadas = []
  const pool = {
    async query(sql, params) {
      chamadas.push({ sql, params })
      return chamadas.length === 1 ? { rows: [{ id: 91 }] } : { rows: [] }
    },
  }
  const jobId = await enfileirarTranscricaoAudio(pool, 77, { maxAttempts: 4, requestId: 'req-1' })
  assert.equal(jobId, 91)
  assert.match(chamadas[0].sql, /audio_transcricao/)
  assert.deepEqual(JSON.parse(chamadas[0].params[1]), { audio_processamento_id: 77, request_id: 'req-1' })
  assert.match(chamadas[1].sql, /status <> 'completed'/)
  await assert.rejects(() => enfileirarTranscricaoAudio(pool, 0), /Áudio inválido/)
})
