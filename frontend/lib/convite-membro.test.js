'use strict'
// Convite de cadastro por link — tradução PURA + guardas de regressão.
// Rode com: node --test lib/convite-membro.test.js

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const C = require('./convite-membro')

const opcoes = {
  papeis: [
    { papel: 'owner', convidavel: false, exige_equipe: false },
    { papel: 'admin', convidavel: true, exige_equipe: false },
    { papel: 'comercial', convidavel: true, exige_equipe: true },
    { papel: 'member', convidavel: true, exige_equipe: false },
  ],
}

test('situacao: rotulo em texto para cada uma; desconhecida aparece como ela mesma', () => {
  assert.equal(C.rotuloSituacao('pendente').rotulo, 'Aguardando cadastro')
  assert.equal(C.rotuloSituacao('expirado').rotulo, 'Vencido')
  assert.equal(C.rotuloSituacao('outra').rotulo, 'outra')
})

test('link: monta com a origem e escapa o token', () => {
  assert.equal(C.linkDoConvite('https://app.x.com/', 'abc_DEF-1'), 'https://app.x.com/convite/abc_DEF-1')
})

test('tempo restante: horas, minutos e vencido', () => {
  const agora = new Date('2026-09-23T12:00:00Z')
  assert.equal(C.tempoRestante('2026-09-24T11:59:00Z', agora), 'vence em 23 h')
  assert.equal(C.tempoRestante('2026-09-23T12:40:00Z', agora), 'vence em 40 min')
  assert.equal(C.tempoRestante('2026-09-23T11:00:00Z', agora), 'venceu')
  assert.equal(C.tempoRestante(null, agora), '')
})

test('papeis e equipe vem do veredito da API, nunca do nome do papel', () => {
  assert.deepEqual(C.papeisDoConvite(opcoes), ['admin', 'comercial', 'member'])
  assert.equal(C.papelExigeEquipe(opcoes, 'comercial'), true)
  assert.equal(C.papelExigeEquipe(opcoes, 'member'), false)
  assert.equal(C.papelExigeEquipe(null, 'comercial'), false)
})

test('so equipe ativa recebe gente; pendentes sao contados', () => {
  assert.deepEqual(C.equipesQueRecebem([{ id: 'a', status: 'ativa' }, { id: 'b', status: 'encerrada' }]).map((e) => e.id), ['a'])
  assert.equal(C.contarPendentes([{ situacao: 'pendente' }, { situacao: 'usado' }, { situacao: 'pendente' }]), 2)
})

test('GUARDA: o modulo nao recalcula regra do backend', () => {
  const src = fs.readFileSync(path.join(__dirname, 'convite-membro.js'), 'utf8')
  // Papel literal, idade ou senha aqui seriam uma segunda regua.
  assert.ok(!/['"]comercial['"]/.test(src), 'papel nao pode ser comparado por nome')
  assert.ok(!/idade|senha|18/.test(src.replace(/\/\/[^\n]*/g, '')), 'idade e senha sao do backend')
  assert.ok(!/usado_em|revogado_em/.test(src), 'a situacao vem pronta em `situacao`')
})
