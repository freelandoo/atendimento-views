const test = require('node:test')
const assert = require('node:assert/strict')
const { msgErro } = require('./erro-msg')

test('erro de rede => mensagem de conexão (nao "Failed to fetch")', () => {
  const m = msgErro({ isNetwork: true, message: 'Failed to fetch' })
  assert.match(m, /conectar ao servidor/)
  assert.doesNotMatch(m, /Failed to fetch/)
})

test('401 => sessão expirada (uma frase clara)', () => {
  assert.match(msgErro({ status: 401, message: 'Token inválido ou expirado.' }), /sess[aã]o expirou/i)
})

test('403 => permissão', () => {
  assert.match(msgErro({ status: 403 }), /permiss[aã]o/i)
})

test('409 => usa a mensagem clara do backend', () => {
  assert.equal(msgErro({ status: 409, message: 'Ligacao nao esta em andamento.' }), 'Ligacao nao esta em andamento.')
})

test('500 => genérico (nao vaza detalhe técnico)', () => {
  assert.equal(msgErro({ status: 500, message: 'boom stack' }, 'Não foi possível iniciar a ligação. Tente novamente.'), 'Não foi possível iniciar a ligação. Tente novamente.')
})

test('mensagem tecnica "Failed to fetch" sem status => fallback', () => {
  assert.equal(msgErro({ message: 'Failed to fetch' }, 'gen'), 'gen')
})

test('sem erro => fallback', () => {
  assert.equal(msgErro(null, 'gen'), 'gen')
  assert.match(msgErro(undefined), /Tente novamente/)
})
