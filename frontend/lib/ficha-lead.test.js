const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const { SECOES, abasDaFicha, secaoDoGatilho, normalizarSecao, secaoInicial, classesAba } = require('./ficha-lead')

const fonte = fs.readFileSync(path.join(__dirname, 'ficha-lead.js'), 'utf8')
const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('as quatro secoes existem na ordem do trabalho', () => {
  assert.deepEqual(SECOES, ['resumo', 'conversa', 'qualificacao', 'fontes'])
})

// ── Gatilhos da listagem ──────────────────────────────────────────────────────
test('cada gatilho abre a secao que ele promete', () => {
  assert.equal(secaoDoGatilho('nome'), 'resumo')
  assert.equal(secaoDoGatilho('origem'), 'fontes')
  assert.equal(secaoDoGatilho('pontuacao'), 'qualificacao')
  assert.equal(secaoDoGatilho('telefone'), 'conversa')
})

test('gatilho desconhecido cai no Resumo, que nunca depende de dado que falte', () => {
  assert.equal(secaoDoGatilho('inexistente'), 'resumo')
  assert.equal(secaoDoGatilho(''), 'resumo')
  assert.equal(secaoDoGatilho(null), 'resumo')
})

test('normalizarSecao recusa valor invalido sem quebrar', () => {
  assert.equal(normalizarSecao('QUALIFICACAO'), 'qualificacao')
  assert.equal(normalizarSecao('x'), 'resumo')
})

// ── Aba indisponivel: visivel, desabilitada, COM motivo ───────────────────────
test('sem telefone a aba Conversa some? NAO — fica desabilitada com o motivo', () => {
  const abas = abasDaFicha({ temTelefone: false })
  assert.equal(abas.length, 4, 'a ficha nao pode ter numero de abas variavel entre leads')
  const conversa = abas.find((a) => a.chave === 'conversa')
  assert.equal(conversa.disponivel, false)
  assert.ok(conversa.motivo.length > 0, 'aba desabilitada sem motivo em texto e so opacidade')
  assert.ok(conversa.motivo.toLowerCase().includes('telefone'))
})

test('com telefone todas as abas estao disponiveis', () => {
  for (const a of abasDaFicha({ temTelefone: true })) {
    assert.equal(a.disponivel, true)
    assert.equal(a.motivo, '')
  }
})

test('toda aba tem rotulo e dica em texto', () => {
  for (const a of abasDaFicha()) {
    assert.ok(a.rotulo.trim().length > 0)
    assert.ok(a.dica.trim().length > 0)
  }
})

// ── Secao inicial ─────────────────────────────────────────────────────────────
test('pedir Conversa num lead sem telefone cai no Resumo, e DIZ por que', () => {
  const r = secaoInicial('conversa', { temTelefone: false })
  assert.equal(r.secao, 'resumo')
  assert.ok(r.motivo.length > 0)
})

test('pedir uma secao disponivel abre exatamente ela, sem motivo', () => {
  assert.deepEqual(secaoInicial('fontes', { temTelefone: false }), { secao: 'fontes', motivo: '' })
  assert.deepEqual(secaoInicial('conversa', { temTelefone: true }), { secao: 'conversa', motivo: '' })
})

// ── Guardas de regressao ──────────────────────────────────────────────────────
test('o modulo nao decide permissao nem le dado de lead', () => {
  for (const proibido of ['capacidade', 'papel', 'responsavel_id', 'qualificacao_resumo', 'icp_score', 'status']) {
    assert.ok(!codigo.includes(proibido),
      `ficha-lead.js passou a ler/decidir "${proibido}" — ele so traduz o veredito que a tela ja tem`)
  }
})

test('o modulo e PURO — sem React, rede ou DOM', () => {
  for (const proibido of ['react', 'fetch(', 'document.', 'window.', 'localStorage']) {
    assert.ok(!codigo.includes(proibido), `ficha-lead.js passou a depender de "${proibido}"`)
  }
})

test('aba ativa nao depende so de cor (ha classe de peso tambem)', () => {
  assert.ok(classesAba(true, true).includes('font-semibold'))
  assert.ok(!classesAba(false, true).includes('font-semibold'))
})
