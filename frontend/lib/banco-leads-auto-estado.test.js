'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const {
  ESTADOS, MOTIVOS_FORA, RESSALVA_CANDIDATOS,
  leituraEstado, motivoFora, classesTom, textoEspera, textoRecorte, textoCandidatos,
} = require('./banco-leads-auto-estado')

test('todo estado tem titulo E explicacao em texto (cor nunca e o unico sinal)', () => {
  for (const [chave, v] of Object.entries(ESTADOS)) {
    assert.ok(v.titulo && v.titulo.length > 3, chave)
    assert.ok(v.detalhe && v.detalhe.length > 20, chave)
    assert.ok(['ok', 'alerta', 'info', 'neutro'].includes(v.tom), chave)
  }
})

test('estado desconhecido aparece COMO ELE MESMO, nunca escondido', () => {
  const r = leituraEstado('motivo_que_o_worker_inventou')
  assert.equal(r.chave, 'motivo_que_o_worker_inventou')
  assert.equal(r.titulo, 'motivo_que_o_worker_inventou')
  assert.match(r.detalhe, /ainda não sabe explicar/)
})

test('estado ausente nao finge que esta rodando', () => {
  const r = leituraEstado(null)
  assert.equal(r.tom, 'neutro')
  assert.ok(!/rodando/i.test(r.titulo))
})

test('pronto e o unico tom ok; pausado e modo_manual sao neutros', () => {
  assert.equal(leituraEstado('pronto').tom, 'ok')
  assert.equal(leituraEstado('pausado').tom, 'neutro')
  assert.equal(leituraEstado('modo_manual').tom, 'neutro')
})

test('motivo de estar fora do rodizio e traduzido, e desconhecido nao e omitido', () => {
  assert.equal(motivoFora('sem_saudacao'), MOTIVOS_FORA.sem_saudacao)
  assert.equal(motivoFora('desativada'), MOTIVOS_FORA.desativada)
  assert.equal(motivoFora('motivo_novo'), 'motivo_novo')
  assert.equal(motivoFora(null), null)
  assert.equal(motivoFora(''), null)
})

test('classesTom usa TOKEN de estado, nunca literal slate/red/emerald', () => {
  for (const tom of ['ok', 'alerta', 'info', 'neutro']) {
    const c = classesTom(tom)
    assert.ok(!/slate-|gray-|red-\d|emerald-\d|amber-\d|blue-\d/.test(c), tom + ' usou literal: ' + c)
  }
  assert.match(classesTom('ok'), /estado-ok/)
  assert.match(classesTom('neutro'), /surface-2/)
})

test('textoEspera: segundos abaixo de 90 em segundos, acima em minutos, 0 e null', () => {
  assert.equal(textoEspera(45), 'em 45 s')
  assert.equal(textoEspera(720), 'em 12 min')
  assert.equal(textoEspera(0), null)
  assert.equal(textoEspera(-5), null)
  assert.equal(textoEspera(null), null)
  assert.equal(textoEspera('nao e numero'), null)
})

test('recorte sem nicho e a carteira inteira, nao um campo vazio', () => {
  assert.equal(textoRecorte({ modo: 'geral', nicho: null }), 'Todos os nichos da carteira')
  assert.equal(textoRecorte(null), 'Todos os nichos da carteira')
  assert.match(textoRecorte({ modo: 'nicho', nicho: 'desentupidora' }), /desentupidora/)
})

test('a contagem fala de CANDIDATOS e carrega a ressalva dos filtros por lead', () => {
  assert.match(textoCandidatos(7), /7 leads candidatos/)
  assert.match(textoCandidatos(1), /1 lead candidato/)
  assert.match(textoCandidatos(0), /Nenhum lead candidato/)
  assert.match(RESSALVA_CANDIDATOS, /janela do país/i)
  assert.match(RESSALVA_CANDIDATOS, /opt-out/i)
  assert.match(RESSALVA_CANDIDATOS, /continuidade/i)
})

test('guarda: o modulo nao decide estado nem conta lead — so traduz', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'banco-leads-auto-estado.js'), 'utf8')
  for (const proibido of [
    'auto_proximo_disparo_em', 'lead_disparos', 'evolution_instance ===',
    'fetch(', 'ultimo_disparo_em', 'teto_diario >',
  ]) {
    assert.ok(!fonte.includes(proibido),
      'quem decide isso e o backend; traduzir aqui criaria segunda regua: ' + proibido)
  }
})
