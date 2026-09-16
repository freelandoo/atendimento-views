'use strict'
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const {
  JANELA_MS,
  chaveFiltros,
  empacotar,
  desempacotar,
  lerFiltros,
  gravarFiltros,
  esquecerFiltros,
  aplicarRecorte,
} = require('./filtros-sessao')

// ─── Envelope e validade ────────────────────────────────────────────────────────────────

test('a janela e de 30 minutos e vence pelo relogio, nao por contagem de uso', () => {
  assert.equal(JANELA_MS, 30 * 60 * 1000)
  const t0 = 1_000_000
  const env = empacotar({ aba: 'sem_contato' }, t0)
  assert.equal(env.expira_em, t0 + JANELA_MS)

  const bruto = JSON.stringify(env)
  assert.deepEqual(desempacotar(bruto, t0 + JANELA_MS - 1), { aba: 'sem_contato' })
  // No limite exato ainda vale; um milissegundo depois, nao.
  assert.deepEqual(desempacotar(bruto, t0 + JANELA_MS), { aba: 'sem_contato' })
  assert.equal(desempacotar(bruto, t0 + JANELA_MS + 1), null)
})

test('tudo que nao da para aproveitar vira null, e nao excecao', () => {
  // A tela tem UM caminho para o caso ruim: abrir no padrao dela.
  assert.equal(desempacotar(null), null)
  assert.equal(desempacotar(''), null)
  assert.equal(desempacotar('{nao e json'), null)
  assert.equal(desempacotar(JSON.stringify({ v: 999, expira_em: Date.now() + 1000, valor: { a: 1 } })), null)
  assert.equal(desempacotar(JSON.stringify({ v: 1, valor: { a: 1 } })), null)
  assert.equal(desempacotar(JSON.stringify(empacotar([1, 2, 3]))), null, 'array nao e recorte')
  assert.equal(desempacotar(JSON.stringify({ v: 1, expira_em: Date.now() + 1000, valor: 'texto' })), null)
})

test('a chave separa tela e empresa', () => {
  const a = chaveFiltros('banco-leads', 'empresa-1')
  const b = chaveFiltros('banco-leads', 'empresa-2')
  const c = chaveFiltros('aquisicao', 'empresa-1')
  assert.notEqual(a, b, 'duas empresas nao podem compartilhar recorte')
  assert.notEqual(a, c, 'duas telas nao podem compartilhar recorte')
  // Sem empresa resolvida ainda, a chave continua deterministica em vez de virar "undefined".
  assert.ok(chaveFiltros('banco-leads', null).includes('sem-empresa'))
})

// ─── Leitura e escrita sobre um sessionStorage de mentira ───────────────────────────────

function instalarStorage(impl) {
  const anterior = global.window
  global.window = { sessionStorage: impl }
  return () => { global.window = anterior }
}

function storageFalso() {
  const dados = new Map()
  return {
    dados,
    getItem: (k) => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => { dados.set(k, String(v)) },
    removeItem: (k) => { dados.delete(k) },
  }
}

test('ler RENOVA a validade: quem continua trabalhando nao perde o recorte', () => {
  const st = storageFalso()
  const restaurar = instalarStorage(st)
  try {
    const t0 = 5_000_000
    gravarFiltros('banco-leads', 'e1', { aba: 'agendados', mercado: 'energia solar' }, t0)

    // 29 minutos depois ainda esta la — e a leitura empurra a validade para frente.
    const quase = t0 + JANELA_MS - 60_000
    assert.deepEqual(lerFiltros('banco-leads', 'e1', quase), { aba: 'agendados', mercado: 'energia solar' })

    // Passou da janela ORIGINAL, mas dentro da renovada pela leitura acima.
    const depois = t0 + JANELA_MS + 60_000
    assert.deepEqual(lerFiltros('banco-leads', 'e1', depois), { aba: 'agendados', mercado: 'energia solar' })
  } finally { restaurar() }
})

test('parado alem da janela, o recorte some sozinho e a chave e limpa', () => {
  const st = storageFalso()
  const restaurar = instalarStorage(st)
  try {
    const t0 = 5_000_000
    gravarFiltros('banco-leads', 'e1', { aba: 'agendados' }, t0)
    assert.equal(lerFiltros('banco-leads', 'e1', t0 + JANELA_MS + 1), null)
    assert.equal(st.getItem(chaveFiltros('banco-leads', 'e1')), null, 'o vencido nao pode ficar ocupando a sessao')
  } finally { restaurar() }
})

test('o recorte de uma empresa nao vaza para outra', () => {
  const st = storageFalso()
  const restaurar = instalarStorage(st)
  try {
    gravarFiltros('banco-leads', 'e1', { mercado: 'energia solar' })
    assert.equal(lerFiltros('banco-leads', 'e2'), null)
    esquecerFiltros('banco-leads', 'e1')
    assert.equal(lerFiltros('banco-leads', 'e1'), null)
  } finally { restaurar() }
})

test('storage indisponivel (modo privado, cota) nunca derruba a tela', () => {
  const explode = {
    getItem() { throw new Error('bloqueado') },
    setItem() { throw new Error('bloqueado') },
    removeItem() { throw new Error('bloqueado') },
  }
  const restaurar = instalarStorage(explode)
  try {
    assert.equal(lerFiltros('banco-leads', 'e1'), null)
    assert.doesNotThrow(() => gravarFiltros('banco-leads', 'e1', { aba: 'x' }))
    assert.doesNotThrow(() => esquecerFiltros('banco-leads', 'e1'))
  } finally { restaurar() }
})

test('sem window (render no servidor) o modulo se cala', () => {
  const restaurar = instalarStorage(undefined)
  global.window = undefined
  try {
    assert.equal(lerFiltros('banco-leads', 'e1'), null)
    assert.doesNotThrow(() => gravarFiltros('banco-leads', 'e1', { aba: 'x' }))
  } finally { restaurar() }
})

// ─── Hidratação da tela ─────────────────────────────────────────────────────────────────

test('aplicarRecorte so aceita campo que a tela declara, com o tipo que ela declara', () => {
  const padrao = { aba: 'sem_contato', pagina: 1, apenasMeus: false }

  assert.deepEqual(aplicarRecorte(padrao, { aba: 'agendados', pagina: 3, apenasMeus: true }),
    { aba: 'agendados', pagina: 3, apenasMeus: true })

  // Chave que a tela nao conhece nao entra — recorte antigo (ou editado a mao no storage) nao
  // pode injetar estado que a tela nao espera.
  assert.deepEqual(aplicarRecorte(padrao, { aba: 'agendados', inventado: 'x' }),
    { aba: 'agendados', pagina: 1, apenasMeus: false })

  // Tipo trocado e ignorado: `pagina` precisa continuar numero.
  assert.deepEqual(aplicarRecorte(padrao, { pagina: '3' }), padrao)
  assert.deepEqual(aplicarRecorte(padrao, { aba: 7 }), padrao)

  // Ausencia e nulo mantem o padrao.
  assert.deepEqual(aplicarRecorte(padrao, null), padrao)
  assert.deepEqual(aplicarRecorte(padrao, { aba: null }), padrao)

  // Nao muta o padrao recebido.
  const p2 = { aba: 'x' }
  aplicarRecorte(p2, { aba: 'y' })
  assert.deepEqual(p2, { aba: 'x' })
})

// ─── Guarda de regressão ────────────────────────────────────────────────────────────────

test('o recorte de trabalho NAO pode migrar para localStorage', () => {
  // A escolha e' de produto: o recorte descreve uma sessao de trabalho e morre com a aba.
  // `localStorage` o faria sobreviver a dias, e o operador voltaria amanha trabalhando dentro
  // de um filtro que ninguem escolheu hoje. As telas continuam usando localStorage para
  // PREFERENCIA (colunas, itens por pagina) — o que este modulo nao toca.
  const fonte = fs.readFileSync(path.join(__dirname, 'filtros-sessao.js'), 'utf8')
  const semComentario = fonte
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n')
  assert.ok(!/localStorage/.test(semComentario), 'o recorte de trabalho vive em sessionStorage')
})
