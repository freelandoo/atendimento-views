const test = require('node:test')
const assert = require('node:assert/strict')
const { analisarFone, fmtFone, telHref, avisoFone } = require('./ligacao-fone')

// Os 4 formatos que convivem em prospectador.prospects.telefone (medidos na base real).
test('E.164 com DDI: 13 digitos (celular)', () => {
  assert.equal(fmtFone('+55 11 99988-7766'), '(11) 99988-7766')
  assert.equal(telHref('+55 11 99988-7766'), 'tel:+5511999887766')
})

test('E.164 com DDI: 12 digitos (fixo)', () => {
  assert.equal(fmtFone('+55 11 3200-1234'), '(11) 3200-1234')
  assert.equal(telHref('+55 11 3200-1234'), 'tel:+551132001234')
})

test('formatado sem DDI: 11 digitos', () => {
  assert.equal(fmtFone('(11) 99988-7766'), '(11) 99988-7766')
  assert.equal(telHref('(11) 99988-7766'), 'tel:+5511999887766')
})

test('so digitos sem DDI: 10 digitos (fixo)', () => {
  assert.equal(fmtFone('1132001234'), '(11) 3200-1234')
})

test('so digitos com DDI: 55 + DDD + numero', () => {
  assert.equal(fmtFone('5511999887766'), '(11) 99988-7766')
})

// --- REGRESSAO: o bug do replace(/^55/) incondicional -------------------------------
test('DDD 55 (Santa Maria/RS) sem DDI NAO e confundido com codigo de pais', () => {
  // 11 digitos: 55 e' DDD, nao DDI. A versao antiga comia o DDD e devolvia o numero cru.
  const i = analisarFone('55999887766')
  assert.equal(i.ddd, '55')
  assert.equal(i.completo, true)
  assert.equal(fmtFone('55999887766'), '(55) 99988-7766')
  assert.equal(telHref('55999887766'), 'tel:+5555999887766')
})

test('DDD 55 fixo (10 digitos) tambem preserva o DDD', () => {
  assert.equal(fmtFone('5532201234'), '(55) 3220-1234')
})

test("'+55' + 8~9 digitos = DDI declarado SEM DDD -> incompleto, nunca discavel", () => {
  // Os 7 registros reais da base. O '+' explicito e' o desempatador.
  const i = analisarFone('+55 3220-1234')
  assert.equal(i.completo, false)
  assert.equal(i.motivo, 'sem_ddd')
  assert.equal(i.e164, null)
  assert.equal(telHref('+55 3220-1234'), null)
  assert.match(avisoFone('+55 3220-1234'), /sem DDD/)
})

test('numero sem DDD (8~9 digitos) e incompleto', () => {
  assert.equal(analisarFone('99887766').completo, false)
  assert.equal(telHref('99887766'), null)
})

test('vazio/nulo nao quebra', () => {
  assert.equal(fmtFone(null), '—')
  assert.equal(fmtFone(''), '—')
  assert.equal(fmtFone(undefined), '—')
  assert.equal(telHref(null), null)
  assert.equal(avisoFone(null), 'sem telefone')
})

test('formato irreconhecivel preserva o cru para conferencia', () => {
  assert.equal(fmtFone('123'), '123')
  assert.equal(analisarFone('123').motivo, 'formato_desconhecido')
  assert.equal(telHref('123'), null)
})

test('numero completo nao gera aviso', () => {
  assert.equal(avisoFone('+55 11 99988-7766'), null)
})
