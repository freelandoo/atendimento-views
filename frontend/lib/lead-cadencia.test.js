const test = require('node:test')
const assert = require('node:assert/strict')

const { resumoCadencia } = require('./lead-cadencia')

const AGORA = new Date('2026-09-23T15:00:00.000Z')

function plano(extra = {}) {
  return {
    estagio: {
      rotulo: 'Proposta enviada',
      sinal: 'quente',
      ritmo: ['D0', 'D1', 'D3', 'D7', 'D14'],
    },
    limites: {
      followUps: { usados: 2, teto: 5, restante: 3, atingido: false },
      ligacoes: { usados: 1, teto: 3, restante: 2, atingido: false },
    },
    recomendacao: {
      acao: 'follow_up',
      canal: 'whatsapp',
      proxima_acao: 'Confirmar recebimento da proposta',
      agendado_para: '2026-09-24T12:00:00Z',
      motivo: 'Proposta enviada: 2/5 follow-ups usados, sinal quente.',
    },
    avisos: [],
    ...extra,
  }
}

test('resumoCadencia traduz estagio, limites e proxima tentativa', () => {
  const r = resumoCadencia(plano(), AGORA)
  assert.equal(r.titulo, 'Proposta enviada')
  assert.equal(r.sinal, 'Quente')
  assert.equal(r.followUps.texto, '2/5 follow-ups')
  assert.equal(r.followUps.detalhe, '3 restantes')
  assert.equal(r.ligacoes.texto, '1/3 ligações')
  assert.equal(r.proxima, 'Confirmar recebimento da proposta · por whatsapp · Amanhã, 09:00')
  assert.equal(r.ritmo, 'D0 · D1 · D3 · D7 · D14')
})

test('resumoCadencia mostra aviso e limite atingido sem recalcular regra', () => {
  const r = resumoCadencia(plano({
    limites: {
      followUps: { usados: 5, teto: 5, restante: 0, atingido: true },
      ligacoes: { usados: 3, teto: 3, restante: 0, atingido: true },
    },
    avisos: ['Limite do estágio atingido.'],
  }), AGORA)
  assert.equal(r.followUps.atingido, true)
  assert.equal(r.followUps.detalhe, '0 restantes')
  assert.equal(r.aviso, 'Limite do estágio atingido.')
})

test('resumoCadencia respeita plano sem nova tentativa', () => {
  const r = resumoCadencia(plano({
    estagio: { rotulo: 'Encerrado', sinal: 'parado', ritmo: [] },
    limites: {
      followUps: { usados: 0, teto: 0, restante: 0, atingido: false },
      ligacoes: { usados: 0, teto: 0, restante: 0, atingido: false },
    },
    recomendacao: { acao: 'nenhuma', canal: 'nenhuma', proxima_acao: '', agendado_para: null, motivo: 'Lead encerrado.' },
  }), AGORA)
  assert.equal(r.proxima, 'Nenhuma nova tentativa recomendada')
  assert.equal(r.followUps.texto, 'Sem follow-ups')
  assert.equal(r.sinal, 'Parado')
})
