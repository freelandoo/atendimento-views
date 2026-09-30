'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { telefoneCanonicoBR, sqlTelefoneNormalizado } = require('../src/telefone-br')

test('telefoneCanonicoBR: tira JID, nao-digitos e o DDI 55 quando ha 12+ digitos', () => {
  assert.equal(telefoneCanonicoBR('5511987654321@s.whatsapp.net'), '11987654321')
  assert.equal(telefoneCanonicoBR('55 11 98765-4321'), '11987654321')
  assert.equal(telefoneCanonicoBR('11987654321'), '11987654321') // sem DDI, mantem
  assert.equal(telefoneCanonicoBR('1133334444'), '1133334444')   // fixo 10 digitos, mantem
  assert.equal(telefoneCanonicoBR(''), '')
  assert.equal(telefoneCanonicoBR(null), '')
})

test('telefoneCanonicoBR espelha a regra do sqlTelefoneNormalizado (dropa 55 sse len>=12)', () => {
  assert.equal(telefoneCanonicoBR('551133334444'), '1133334444') // 12 digitos + 55 -> dropa DDI
  assert.equal(telefoneCanonicoBR('5133334444'), '5133334444')   // 10 digitos, comeca 51 -> mantem
  assert.equal(telefoneCanonicoBR('5511'), '5511')               // 4 digitos -> 55 nao e' DDI
  // a expressao SQL correspondente existe e aplica a mesma condicao (len>=12 e left 2 = '55')
  assert.match(sqlTelefoneNormalizado('telefone'), />= 12/)
  assert.match(sqlTelefoneNormalizado('telefone'), /'55'/)
})
