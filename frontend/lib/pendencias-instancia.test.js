'use strict'

const test = require('node:test')
const assert = require('node:assert')

const {
  rotuloMotivo,
  explicacaoMotivo,
  acaoTexto,
  podeReprocessar,
  tomPendencia,
  resumoTexto,
} = require('./pendencias-instancia')

const pendencia = (extra = {}) => ({
  id: 1,
  evolution_instance: 'inst-orfa',
  motivo: 'instancia_desconhecida',
  acao: 'mapear_instancia',
  transitorio: false,
  ocorrencias: 12,
  primeira_em: '2026-08-08T10:00:00Z',
  ultima_em: '2026-08-08T12:00:00Z',
  resolvida_em: null,
  resolvida_empresa_id: null,
  resolvida_empresa: null,
  ...extra,
})

test('os três motivos têm rótulo, explicação e ação próprios', () => {
  const motivos = ['sem_instancia', 'instancia_desconhecida', 'erro_resolucao']
  const rotulos = motivos.map(rotuloMotivo)
  assert.equal(new Set(rotulos).size, 3, 'motivos diferentes não podem ler igual')
  for (const m of motivos) {
    assert.ok(rotuloMotivo(m).length > 3)
    assert.ok(explicacaoMotivo(m).length > 20)
  }
  const acoes = ['mapear_instancia', 'revisar_webhook_evolution', 'verificar_infraestrutura']
  assert.equal(new Set(acoes.map(acaoTexto)).size, 3)
})

test('motivo desconhecido não vira texto inventado', () => {
  assert.equal(rotuloMotivo('motivo_novo_do_futuro'), 'motivo_novo_do_futuro')
  assert.ok(explicacaoMotivo('motivo_novo_do_futuro').includes('não reconhecida'))
})

test('reprocessar só aparece quando há vínculo a reconsultar', () => {
  assert.equal(podeReprocessar(pendencia()), true)
  // Sem nome de instância não há o que reconsultar — a rota recusaria.
  assert.equal(podeReprocessar(pendencia({ motivo: 'sem_instancia', acao: 'revisar_webhook_evolution' })), false)
  assert.equal(podeReprocessar(pendencia({ resolvida_em: '2026-08-08T13:00:00Z' })), false)
  assert.equal(podeReprocessar(null), false)
})

test('o tom separa transitório de pendência que exige cadastro', () => {
  assert.equal(tomPendencia(pendencia()), 'alerta')
  assert.equal(tomPendencia(pendencia({ motivo: 'erro_resolucao', transitorio: true })), 'atencao')
  assert.equal(tomPendencia(pendencia({ resolvida_em: '2026-08-08T13:00:00Z' })), 'ok')
  assert.equal(tomPendencia(null), 'neutro')
})

test('o resumo diz explicitamente que nada foi gravado', () => {
  assert.ok(resumoTexto({ total: 0, por_motivo: {} }).includes('Nenhuma pendência'))
  const t = resumoTexto({ total: 3, por_motivo: {} })
  assert.ok(t.includes('3'))
  assert.ok(t.toLowerCase().includes('nada foi gravado'))
  // Singular e plural não podem sair errados na tela.
  assert.ok(resumoTexto({ total: 1 }).includes('número está'))
  assert.ok(resumoTexto({ total: 2 }).includes('números estão'))
})
