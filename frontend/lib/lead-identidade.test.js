'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const {
  nomeDeVerdade,
  formatarTelefone,
  rotuloLead,
  nomeColunaLead,
  identidadeConversa,
} = require('./lead-identidade')

// --- Coluna "Lead" da Central de Mensagens: SO nome, nunca telefone --------------------

test('nomeColunaLead mostra o nome ja resolvido pelo backend', () => {
  assert.equal(nomeColunaLead({ nome_exibicao: 'Pizzaria do Zé' }), 'Pizzaria do Zé')
})

test('nomeColunaLead fica VAZIO quando nao ha nome — nunca traco, nunca telefone', () => {
  const semNome = { numero: '5511999990001@s.whatsapp.net', nome_exibicao: null, negocio: 'Padaria do Zé' }
  assert.equal(nomeColunaLead(semNome), '')
  assert.equal(nomeColunaLead({}), '')
  assert.equal(nomeColunaLead(null), '')
})

test('nomeColunaLead nao aceita telefone nem JID vindos de linha antiga', () => {
  assert.equal(nomeColunaLead({ nome_exibicao: '5511999990001' }), '')
  assert.equal(nomeColunaLead({ nome_exibicao: '5511999990001@s.whatsapp.net' }), '')
})

test('nomeDeVerdade recusa identificador tecnico do Evolution', () => {
  assert.equal(nomeDeVerdade('5511999990001@s.whatsapp.net'), null)
  assert.equal(nomeDeVerdade('249876543210987@lid'), null)
  assert.equal(nomeDeVerdade('5511999990001'), null)
  assert.equal(nomeDeVerdade('+55 (11) 99999-0001'), null)
  assert.equal(nomeDeVerdade('   '), null)
  assert.equal(nomeDeVerdade(null), null)
  assert.equal(nomeDeVerdade('  Padaria do Zé  '), 'Padaria do Zé')
})

test('formatarTelefone aceita JID, com e sem o 55 do pais', () => {
  assert.equal(formatarTelefone('5511999990001@s.whatsapp.net'), '(11) 99999-0001')
  assert.equal(formatarTelefone('11999990001'), '(11) 99999-0001')
  assert.equal(formatarTelefone('551133334444'), '(11) 3333-4444')
  // Numero fora do formato brasileiro: devolve os digitos, nunca o JID inteiro.
  assert.equal(formatarTelefone('123@s.whatsapp.net'), '123')
  assert.equal(formatarTelefone(''), '')
})

test('rotuloLead prefere o nome e cai no telefone formatado', () => {
  assert.equal(rotuloLead({ nome: 'Padaria do Zé', telefone_digitos: '5511999990001' }), 'Padaria do Zé')
  assert.equal(rotuloLead({ nome: '', telefone_digitos: '5511999990001' }), '(11) 99999-0001')
  assert.equal(rotuloLead({ nome: '5511999990001@s.whatsapp.net', telefone_digitos: '5511999990001' }), '(11) 99999-0001')
  assert.equal(rotuloLead(null), '')
})

test('identidadeConversa mostra o negocio como informacao principal', () => {
  const id = identidadeConversa({ numero: '5511999990001@s.whatsapp.net', negocio: 'Padaria do Zé' })
  assert.deepEqual(id, { titulo: 'Padaria do Zé', telefone: '(11) 99999-0001', temNome: true })
})

test('identidadeConversa prefere o nome resolvido ao negocio curado', () => {
  const id = identidadeConversa({
    numero: '5511999990001@s.whatsapp.net',
    nome_exibicao: 'Pizzaria do Zé',
    negocio: 'Pizzaria',
  })
  assert.equal(id.titulo, 'Pizzaria do Zé')
  assert.equal(id.temNome, true)
})

// O painel e um CABECALHO: titulo vazio deixaria o operador sem saber que conversa abriu.
// A regra de "campo vazio" vale so para a coluna Lead (decisao do operador, 2026-08-10).
test('identidadeConversa mantem o telefone como identificacao de seguranca no painel', () => {
  const id = identidadeConversa({ numero: '5511999990001@s.whatsapp.net', nome_exibicao: null, negocio: null })
  assert.equal(id.titulo, '(11) 99999-0001')
  assert.equal(id.temNome, false)
})

test('identidadeConversa sem nome usa o telefone e avisa que nao ha nome', () => {
  const id = identidadeConversa({ numero: '5511999990001@s.whatsapp.net', negocio: null })
  assert.deepEqual(id, { titulo: '(11) 99999-0001', telefone: '(11) 99999-0001', temNome: false })
})

test('identidadeConversa NUNCA devolve o JID como titulo', () => {
  // Numero irreconhecivel: sobram os digitos, nunca o sufixo tecnico do Evolution.
  const id = identidadeConversa({ numero: '249876543210987@lid', negocio: '249876543210987@lid' })
  assert.equal(id.temNome, false)
  assert.ok(!id.titulo.includes('@'), `titulo vazou o JID: ${id.titulo}`)
  assert.equal(identidadeConversa({}).titulo, 'Contato sem identificação')
})

// Guarda de regressao: a fila de Follow-ups e o painel de conversa precisam concordar sobre
// como o lead se chama. Se `followups-fila.js` voltar a ter copia propria destas regras, a
// mesma conversa passa a aparecer com um nome na fila e outro no painel aberto dela.
test('followups-fila reexporta a identidade em vez de duplicar a regra', () => {
  const fila = require('./followups-fila')
  const identidade = require('./lead-identidade')
  assert.equal(fila.nomeDeVerdade, identidade.nomeDeVerdade)
  assert.equal(fila.formatarTelefone, identidade.formatarTelefone)
  assert.equal(fila.rotuloLead, identidade.rotuloLead)

  const fonte = fs.readFileSync(path.join(__dirname, 'followups-fila.js'), 'utf8')
  assert.ok(
    !/function\s+(nomeDeVerdade|formatarTelefone|rotuloLead)\s*\(/.test(fonte),
    'followups-fila.js redefiniu localmente uma regra de identidade que pertence a lead-identidade.js'
  )
})
