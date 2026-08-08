'use strict'

// Cofre do token da Meta Conversions API, por empresa.
//
// Cofre PRÓPRIO (prefixo mt1, chave META_ENC_KEY), separado do da Freelandoo de
// propósito: rotacionar ou comprometer a chave de um domínio não pode derrubar o
// outro. O algoritmo (AES-256-GCM) vem de src/segredos-crypto.js — não é reimplementado.

const { criarCofre } = require('../segredos-crypto')

const cofre = criarCofre({
  prefixo: 'mt1',
  salt: 'meta-capi-enc-v1',
  envs: ['META_ENC_KEY'],
  // Conveniência de DESENVOLVIMENTO apenas. Em produção, exigirChaveDedicada()
  // recusa salvar credencial derivando de JWT_SECRET: rotacionar o JWT tornaria
  // ilegível o token de todos os tenants de uma vez, sem aviso.
  fallback: ['JWT_SECRET', 'REPROCESS_SECRET'],
  semente: 'meta-capi-dev-key',
})

/**
 * Guard de produção: recusa gravar credencial de terceiro sem chave dedicada.
 * Lança erro com statusCode 500 (falha de configuração do servidor, não do usuário).
 */
function exigirChaveDedicada() {
  if (cofre.temChaveDedicada()) return
  if (String(process.env.NODE_ENV || '').toLowerCase() !== 'production') return
  const e = new Error(
    'META_ENC_KEY não está configurada no servidor. Sem ela o token da Meta não pode ser guardado com segurança.'
  )
  e.code = 'META_ENC_KEY_AUSENTE'
  e.statusCode = 500
  throw e
}

/** Últimos 4 caracteres, para a tela mostrar "••••4821". Não reconstrói o token. */
function dicaDoToken(token) {
  const s = String(token || '').trim()
  return s.length >= 4 ? s.slice(-4) : null
}

module.exports = {
  encrypt: cofre.encrypt,
  decrypt: cofre.decrypt,
  temChaveDedicada: cofre.temChaveDedicada,
  exigirChaveDedicada,
  dicaDoToken,
  _resetChaveCache: cofre._resetChaveCache,
}
