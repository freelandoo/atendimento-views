'use strict'

// Cifragem em repouso de segredos de terceiros (AES-256-GCM), genérica por DOMÍNIO.
//
// Por que existe: a Freelandoo já guardava token cifrado com este exato algoritmo, e
// agora a Meta precisa do mesmo. Copiar as 30 linhas seria a duplicação que o
// AGENTS.md proíbe — e pior, duas cópias divergem com o tempo. Então o algoritmo mora
// aqui uma vez e cada domínio instancia o SEU cofre, com sua chave e seu prefixo.
//
// Cofres separados de propósito: comprometer (ou rotacionar) a chave de um domínio
// não pode tornar ilegível o segredo do outro.
//
// Formato do valor cifrado (string única, base64url por segmento):
//   <prefixo>:<iv>:<authTag>:<ciphertext>

const crypto = require('crypto')

/**
 * Cria um cofre de segredos.
 *
 * @param {object} opts
 * @param {string} opts.prefixo    Marca de versão/domínio no início do valor cifrado (ex.: 'fl1').
 *                                 Trocar o prefixo torna ilegível o que já está gravado — não troque.
 * @param {string} opts.salt       Salt do scrypt quando a chave precisa ser derivada.
 * @param {string[]} opts.envs     Envs consultadas em ordem para a chave de 32 bytes (base64 ou hex).
 * @param {string[]} opts.fallback Envs consultadas em ordem para DERIVAR a chave quando não há chave
 *                                 dedicada. É conveniência de desenvolvimento: rotacionar a env de
 *                                 fallback (ex.: JWT_SECRET) torna ilegível todo segredo cifrado com ela.
 * @param {string} opts.semente    Último recurso, só para teste local.
 */
function criarCofre({ prefixo, salt, envs = [], fallback = [], semente = 'dev-key' }) {
  let chaveCache = null

  function resolverChave() {
    if (chaveCache) return chaveCache
    const raw = envs.map((e) => String(process.env[e] || '').trim()).find(Boolean) || ''
    if (raw) {
      let buf = null
      if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, 'hex')
      else {
        try { buf = Buffer.from(raw, 'base64') } catch (_) { buf = null }
      }
      if (buf && buf.length === 32) {
        chaveCache = buf
        return chaveCache
      }
      // Chave presente mas em formato/tamanho inesperado: deriva dela por scrypt em
      // vez de recusar, para não derrubar um ambiente por causa de um base64 torto.
      chaveCache = crypto.scryptSync(raw, salt, 32)
      return chaveCache
    }
    const seed = fallback.map((e) => String(process.env[e] || '').trim()).find(Boolean) || semente
    chaveCache = crypto.scryptSync(seed, salt, 32)
    return chaveCache
  }

  // Há chave DEDICADA (não derivada de fallback)? Quem guarda credencial de terceiro
  // usa isto para se recusar a operar em produção sem chave própria.
  function temChaveDedicada() {
    return envs.some((e) => String(process.env[e] || '').trim() !== '')
  }

  function encrypt(plaintext) {
    if (plaintext == null || plaintext === '') return null
    const key = resolverChave()
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return [prefixo, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join(':')
  }

  function decrypt(value) {
    if (value == null || value === '') return null
    const parts = String(value).split(':')
    if (parts.length !== 4 || parts[0] !== prefixo) {
      throw new Error(`Valor cifrado inválido (esperado prefixo ${prefixo})`)
    }
    const key = resolverChave()
    const iv = Buffer.from(parts[1], 'base64url')
    const tag = Buffer.from(parts[2], 'base64url')
    const ct = Buffer.from(parts[3], 'base64url')
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
  }

  // Só para testes: permite trocar a chave em runtime.
  function _resetChaveCache() { chaveCache = null }

  return { encrypt, decrypt, temChaveDedicada, _resetChaveCache }
}

module.exports = { criarCofre }
