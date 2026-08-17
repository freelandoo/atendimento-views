const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  CHAVE_STORAGE, DISPOSITIVOS, HEADER_CHAVE, HEADER_DISPOSITIVO,
  novaChaveSessao, classificarDispositivo, chaveDaSessao, cabecalhosOrigem,
} = require('./sessao-origem')

// `window` falso: storage em memoria + matchMedia controlavel. Sem jsdom (o projeto roda
// `node --test` puro).
function comWindow({ storage = new Map(), toque = false, quebrado = false } = {}) {
  const anterior = global.window
  global.window = {
    localStorage: {
      getItem: (k) => { if (quebrado) throw new Error('storage bloqueado'); return storage.has(k) ? storage.get(k) : null },
      setItem: (k, v) => { if (quebrado) throw new Error('storage bloqueado'); storage.set(k, v) },
    },
    matchMedia: (q) => ({ matches: q === '(pointer: coarse)' ? toque : false }),
  }
  return { storage, restaurar: () => { if (anterior === undefined) delete global.window; else global.window = anterior } }
}

test('novaChaveSessao: opaca, do tamanho esperado e sem significado', () => {
  const chave = novaChaveSessao(() => new Uint8Array(16).fill(0xab))
  assert.equal(chave, 'ab'.repeat(16))
  assert.equal(chave.length, 32)
  // Precisa passar no formato que o backend aceita (>=16, [A-Za-z0-9_-]).
  assert.match(chave, /^[A-Za-z0-9_-]{16,128}$/)
  // Duas chamadas reais nao colidem.
  assert.notEqual(novaChaveSessao(), novaChaveSessao())
})

test('classificarDispositivo: vocabulario FECHADO, a partir de UM sinal grosseiro', () => {
  assert.equal(classificarDispositivo(true), 'celular')
  assert.equal(classificarDispositivo(false), 'computador')
  assert.deepEqual([...DISPOSITIVOS].sort(), ['celular', 'computador'])
  for (const v of [true, false]) assert.ok(DISPOSITIVOS.includes(classificarDispositivo(v)))
})

test('chaveDaSessao: cria uma vez e REUSA — a origem e do aparelho, nao da chamada', () => {
  const w = comWindow()
  try {
    const primeira = chaveDaSessao()
    assert.ok(primeira)
    assert.equal(w.storage.get(CHAVE_STORAGE), primeira)
    // Duas abas do mesmo navegador sao a MESMA origem: e o que o operador chama de "aparelho".
    assert.equal(chaveDaSessao(), primeira)
  } finally { w.restaurar() }
})

test('chaveDaSessao: sem window (SSR) ou com storage bloqueado, devolve null', () => {
  // Ausencia e' estado legitimo dos dois lados — nunca um valor inventado que faria sessoes
  // diferentes parecerem a mesma.
  const anterior = global.window
  delete global.window
  try { assert.equal(chaveDaSessao(), null) } finally { if (anterior !== undefined) global.window = anterior }

  const w = comWindow({ quebrado: true })
  try { assert.equal(chaveDaSessao(), null) } finally { w.restaurar() }
})

test('cabecalhosOrigem: manda a chave e o aparelho; nada mais', () => {
  const w = comWindow({ toque: true })
  try {
    const h = cabecalhosOrigem()
    assert.deepEqual(Object.keys(h).sort(), [HEADER_CHAVE, HEADER_DISPOSITIVO].sort())
    assert.equal(h[HEADER_DISPOSITIVO], 'celular')
    assert.match(h[HEADER_CHAVE], /^[A-Za-z0-9_-]{16,128}$/)
  } finally { w.restaurar() }

  const desktop = comWindow({ toque: false })
  try { assert.equal(cabecalhosOrigem()[HEADER_DISPOSITIVO], 'computador') } finally { desktop.restaurar() }
})

test('cabecalhosOrigem: sem storage, nao manda cabecalho nenhum (a requisicao segue igual)', () => {
  const w = comWindow({ quebrado: true })
  try { assert.deepEqual(cabecalhosOrigem(), {}) } finally { w.restaurar() }
})

// --- guardas de regressao ------------------------------------------------------------
test('guarda: NADA aqui identifica a pessoa ou o aparelho de forma invasiva', () => {
  // Le o CODIGO, sem os comentarios: o cabecalho do modulo cita justamente o que ele nao faz,
  // e a guarda precisa cobrar a implementacao, nao a prosa.
  const codigo = fs.readFileSync(path.join(__dirname, 'sessao-origem.js'), 'utf8')
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  // A tentacao obvia seria "melhorar" o dispositivo lendo o User-Agent, ou correlacionar por
  // IP / canvas / geolocalizacao. Nada disso e' necessario para responder "foi neste aparelho?".
  // E a chave nao pode virar cookie: cookie acompanha requisicao que o operador nao fez.
  for (const proibido of ['userAgent', 'navigator.', 'geolocation', 'canvas', 'document.cookie', 'screen.']) {
    assert.equal(codigo.includes(proibido), false, `${proibido} nao pode aparecer nesta coleta`)
  }
})

test('guarda: a origem sai por UM ponto so (apiFetch), nao espalhada por chamador', () => {
  const api = fs.readFileSync(path.join(__dirname, 'api.ts'), 'utf8')
  assert.match(api, /cabecalhosOrigem\(\)/,
    'a origem tem de sair do cliente HTTP: por chamador, alguem esqueceria de anexa-la')
  const tela = fs.readFileSync(
    path.join(__dirname, '..', 'app', 'dashboard', 'central-ligacoes', 'page.tsx'), 'utf8')
  assert.equal(tela.includes(HEADER_CHAVE), false, 'a tela nao monta cabecalho de origem a mao')
  assert.equal(/sessaoOrigem\.v1/.test(tela), false, 'a tela nao le a chave de sessao direto do storage')
})
