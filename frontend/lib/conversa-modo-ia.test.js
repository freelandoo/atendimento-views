'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const {
  MODOS_IA,
  MODO_IA_PADRAO,
  MODOS_IA_VALIDOS,
  modoValido,
  normalizarModo,
  descreverModo,
  opcoesDeModo,
  rotuloAcessivel,
  avisoDoCompositor,
  houveMudanca,
} = require('./conversa-modo-ia.js')

test('o padrao e conversa e a lista fechada espelha o backend', () => {
  assert.strictEqual(MODO_IA_PADRAO, MODOS_IA.CONVERSA)
  assert.deepStrictEqual(MODOS_IA_VALIDOS, ['conversa', 'analise'])
})

test('modoValido e normalizarModo aceitam so a lista fechada', () => {
  assert.ok(modoValido('analise'))
  assert.strictEqual(modoValido('pausado'), false)
  assert.strictEqual(normalizarModo(undefined), MODOS_IA.CONVERSA)
  assert.strictEqual(normalizarModo('  ANALISE '), MODOS_IA.ANALISE)
})

test('descreverModo nunca devolve undefined, nem para lixo', () => {
  for (const valor of [null, undefined, '', 'inexistente', 7, {}]) {
    const d = descreverModo(valor)
    assert.strictEqual(d.id, MODOS_IA.CONVERSA)
    assert.ok(d.rotulo && d.estado && d.descricao && d.ajuda)
  }
})

test('cada modo tem rotulo em TEXTO alem do estado — cor nunca e o unico sinal', () => {
  const opcoes = opcoesDeModo()
  assert.strictEqual(opcoes.length, 2)
  for (const o of opcoes) {
    assert.ok(o.rotulo.length > 0)
    assert.ok(o.estado.length > 0)
  }
  assert.deepStrictEqual(opcoes.map((o) => o.id), ['conversa', 'analise'])
})

test('o estado do modo Analise diz que a IA acompanha sem responder', () => {
  const d = descreverModo(MODOS_IA.ANALISE)
  assert.match(d.estado, /acompanhando/i)
  assert.match(d.estado, /sem responder/i)
})

test('a ajuda de cada modo explica a consequencia, nao so o nome', () => {
  assert.match(descreverModo(MODOS_IA.CONVERSA).ajuda, /pode responder/i)
  const analise = descreverModo(MODOS_IA.ANALISE).ajuda
  assert.match(analise, /não responde automaticamente/i)
  assert.match(analise, /registra|acompanha/i)
})

test('rotuloAcessivel entrega estado E consequencia na mesma frase', () => {
  // Um leitor de tela que anuncie so "Análise" nao diz o que muda para o cliente.
  const frase = rotuloAcessivel(MODOS_IA.ANALISE)
  assert.match(frase, /Análise/)
  assert.match(frase, /não envia|não responde/i)
})

test('avisoDoCompositor so existe no modo Analise e aponta o caminho manual', () => {
  assert.strictEqual(avisoDoCompositor(MODOS_IA.CONVERSA), null)
  assert.strictEqual(avisoDoCompositor(null), null)
  const aviso = avisoDoCompositor(MODOS_IA.ANALISE)
  assert.ok(aviso)
  assert.match(aviso.texto, /Orientar resposta/)
  assert.match(aviso.texto, /envie você mesmo|revise/i)
})

test('houveMudanca ignora clique no modo ja ativo', () => {
  assert.strictEqual(houveMudanca('conversa', 'conversa'), false)
  assert.strictEqual(houveMudanca(null, 'conversa'), false, 'sem modo gravado ja e conversa')
  assert.ok(houveMudanca('conversa', 'analise'))
})

test('guarda: a tela nao reimplementa a decisao de enviar', () => {
  // A permissao de enviar e' do backend. O componente e o painel podem LER o modo para
  // desenhar; se aparecer ali uma comparacao decidindo envio, a regra passou a existir em
  // dois lugares — e a tela nunca e a autoridade.
  const alvos = [
    path.join(__dirname, '..', 'components', 'ui', 'AlternadorModoIa.tsx'),
    path.join(__dirname, '..', 'components', 'ConversaPainel.tsx'),
  ]
  for (const alvo of alvos) {
    const fonte = fs.readFileSync(alvo, 'utf8')
    const linhas = fonte.split('\n').filter((l) => /===\s*['"](analise|conversa)['"]|['"](analise|conversa)['"]\s*===/.test(l))
    assert.deepStrictEqual(linhas, [], `${path.basename(alvo)} comparou modo com literal; use lib/conversa-modo-ia.js`)
  }
})
