const test = require('node:test')
const assert = require('node:assert/strict')
const { podeTransicionar, segDesde, fmtCronometro } = require('./ligacao-estado')

test('podeTransicionar: visualizando so vira em_andamento ou fecha sem registro', () => {
  assert.equal(podeTransicionar('visualizando', 'em_andamento'), true)
  assert.equal(podeTransicionar('visualizando', 'fechado_sem_registro'), true)
  assert.equal(podeTransicionar('visualizando', 'encerrada'), false)
})

test('podeTransicionar: em_andamento -> encerrada|descartada; terminais nao voltam', () => {
  assert.equal(podeTransicionar('em_andamento', 'encerrada'), true)
  assert.equal(podeTransicionar('em_andamento', 'descartada'), true)
  assert.equal(podeTransicionar('encerrada', 'em_andamento'), false)
  assert.equal(podeTransicionar('descartada', 'em_andamento'), false)
  assert.equal(podeTransicionar('encerrada', 'descartada'), false)
})

test('segDesde: reconstroi o cronometro a partir de iniciada_em', () => {
  const iniciada = '2026-07-28T12:00:00.000Z'
  const agora = new Date('2026-07-28T12:01:05.000Z').getTime()
  assert.equal(segDesde(iniciada, agora), 65)
  assert.equal(segDesde(null, agora), 0)
  assert.equal(segDesde('lixo', agora), 0)
  // relogio do cliente atras do inicio nao gera negativo
  assert.equal(segDesde(iniciada, new Date('2026-07-28T11:59:00.000Z').getTime()), 0)
})

test('fmtCronometro: MM:SS e HH:MM:SS', () => {
  assert.equal(fmtCronometro(0), '00:00')
  assert.equal(fmtCronometro(65), '01:05')
  assert.equal(fmtCronometro(3661), '01:01:01')
  assert.equal(fmtCronometro(-5), '00:00')
})
