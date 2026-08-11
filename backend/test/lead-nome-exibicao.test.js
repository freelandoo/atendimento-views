'use strict'
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const {
  FONTES,
  ORDEM_FONTES,
  MAX_NOME,
  nomeValido,
  resolverNomeExibicao,
  anexarNomeExibicao,
} = require('../src/services/lead-nome-exibicao')

// ---------------------------------------------------------------------------
// Prioridade — um teste por criterio de aceite do pedido.
// ---------------------------------------------------------------------------

test('prioridade 1: nome valido do WhatsApp e o que aparece', () => {
  const r = resolverNomeExibicao({ nome_whatsapp: 'Pizzaria do Zé', nome_maps: 'Pizzaria Central' })
  assert.deepEqual(r, { nome: 'Pizzaria do Zé', fonte: FONTES.WHATSAPP })
})

test('prioridade 2: sem nome do WhatsApp, usa o do Google Maps', () => {
  const r = resolverNomeExibicao({ nome_whatsapp: null, nome_maps: 'Barbearia Alfa' })
  assert.deepEqual(r, { nome: 'Barbearia Alfa', fonte: FONTES.GOOGLE_MAPS })
})

test('prioridade 3: sem nome valido em nenhuma fonte, o campo fica VAZIO', () => {
  assert.deepEqual(resolverNomeExibicao({ nome_whatsapp: null, nome_maps: null }), { nome: null, fonte: null })
  assert.deepEqual(resolverNomeExibicao({}), { nome: null, fonte: null })
  assert.deepEqual(resolverNomeExibicao(null), { nome: null, fonte: null })
})

test('nome invalido do WhatsApp cai para o Google Maps antes de esvaziar', () => {
  // Uma letra so, emoji e telefone sao os tres casos citados no pedido.
  for (const invalido of ['A', '😊', '🔥🔥', '5511999990001', '   ']) {
    const r = resolverNomeExibicao({ nome_whatsapp: invalido, nome_maps: 'Oficina Beta' })
    assert.deepEqual(r, { nome: 'Oficina Beta', fonte: FONTES.GOOGLE_MAPS }, `nao caiu para o Maps com ${JSON.stringify(invalido)}`)
  }
})

// ---------------------------------------------------------------------------
// Validacao de nome
// ---------------------------------------------------------------------------

test('nomeValido recusa vazio, nulo e so-espacos', () => {
  for (const v of [null, undefined, '', '   ', '\t\n']) assert.equal(nomeValido(v), null)
})

test('nomeValido recusa telefone em qualquer formatacao', () => {
  for (const v of ['5511999990001', '+55 (11) 99999-0001', '11 99999-0001', '(11) 3333.4444']) {
    assert.equal(nomeValido(v), null, `aceitou telefone: ${v}`)
  }
})

test('nomeValido recusa JID e identificador tecnico do Evolution', () => {
  assert.equal(nomeValido('5511999990001@s.whatsapp.net'), null)
  assert.equal(nomeValido('249876543210987@lid'), null)
})

test('nomeValido recusa emoji e enfeite puro, e uma letra so', () => {
  for (const v of ['😊', '⭐⭐⭐', '...', '---', 'A', 'Z ', '*']) {
    assert.equal(nomeValido(v), null, `aceitou enfeite/letra solta: ${JSON.stringify(v)}`)
  }
})

test('nomeValido recusa texto generico comparando a string INTEIRA', () => {
  for (const v of ['Cliente', 'lead', 'CONTATO', 'sem nome', 'não informado', 'undefined']) {
    assert.equal(nomeValido(v), null, `aceitou generico: ${v}`)
  }
  // A comparacao NAO pode ser por token: senao o nome de negocio abaixo seria recusado.
  assert.equal(nomeValido('Cliente Feliz Pet Shop'), 'Cliente Feliz Pet Shop')
  assert.equal(nomeValido('Vendas Diretas ME'), 'Vendas Diretas ME')
})

test('nomeValido aceita nome de pessoa e de empresa, normalizando espacos', () => {
  assert.equal(nomeValido('  Padaria   do  Zé  '), 'Padaria do Zé')
  assert.equal(nomeValido('Ana'), 'Ana')
  assert.equal(nomeValido('Studio 21'), 'Studio 21')
  assert.equal(nomeValido('J&M Advogados'), 'J&M Advogados')
})

test('nomeValido corta nome gigante sem deixar espaco na borda', () => {
  const cortado = nomeValido(`${'a'.repeat(MAX_NOME + 40)} fim`)
  assert.equal(cortado.length, MAX_NOME)
  assert.equal(cortado, cortado.trim())
})

// ---------------------------------------------------------------------------
// Acoplamento na linha da conversa
// ---------------------------------------------------------------------------

test('anexarNomeExibicao preserva a linha e acrescenta nome + fonte', () => {
  const conversa = { numero: '5511999990001@s.whatsapp.net', estagio: 'diagnostico', nome_whatsapp: 'Ana Paula' }
  const out = anexarNomeExibicao(conversa, 'Salão da Ana')
  assert.equal(out.numero, conversa.numero)
  assert.equal(out.estagio, 'diagnostico')
  assert.equal(out.nome_exibicao, 'Ana Paula')
  assert.equal(out.nome_exibicao_fonte, FONTES.WHATSAPP)
  // Nao muta a linha original.
  assert.equal(conversa.nome_exibicao, undefined)
})

test('anexarNomeExibicao devolve nome nulo quando nao ha fonte alguma', () => {
  const out = anexarNomeExibicao({ numero: '5511999990001@s.whatsapp.net' }, null)
  assert.equal(out.nome_exibicao, null)
  assert.equal(out.nome_exibicao_fonte, null)
})

// ---------------------------------------------------------------------------
// Guardas de regressao — a ordem tem UM dono
// ---------------------------------------------------------------------------

test('a ordem de prioridade e exatamente WhatsApp -> Google Maps', () => {
  assert.deepEqual(
    ORDEM_FONTES.map((o) => [o.campo, o.fonte]),
    [['nome_whatsapp', FONTES.WHATSAPP], ['nome_maps', FONTES.GOOGLE_MAPS]]
  )
})

test('o telefone NUNCA e fonte de nome neste modulo', () => {
  const fonte = fs.readFileSync(require.resolve('../src/services/lead-nome-exibicao'), 'utf8')
  const codigo = fonte.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
  assert.ok(!/\bnumero\b|\btelefone\b/.test(codigo),
    'lead-nome-exibicao.js nao pode conhecer telefone/numero: o campo de nome so guarda nome')
})

test('a tela da Central de Mensagens nao reimplementa a prioridade', () => {
  const tela = path.join(__dirname, '..', '..', 'frontend', 'app', 'dashboard', 'conversas', 'page.tsx')
  const fonte = fs.readFileSync(tela, 'utf8')
  assert.ok(!fonte.includes('nome_whatsapp') && !fonte.includes('nome_maps'),
    'a tela deve consumir `nome_exibicao` ja resolvido, nunca as fontes cruas')
})
