'use strict'

const test = require('node:test')
const assert = require('node:assert')

const traducoes = require('./pendencias-instancia')

const {
  ACAO_MOTIVO,
  rotuloMotivo,
  explicacaoMotivo,
  acaoTexto,
  tomPendencia,
  resumoTexto,
} = traducoes

const pendencia = (extra = {}) => ({
  id: 1,
  evolution_instance: 'inst-orfa',
  motivo: 'instancia_desconhecida',
  acao: 'auditar_origem_instancia',
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
  const acoes = ['auditar_origem_instancia', 'revisar_webhook_evolution', 'verificar_infraestrutura']
  assert.equal(new Set(acoes.map(acaoTexto)).size, 3)
})

test('a tela não oferece — nem sugere — vincular a instância bloqueada', () => {
  // A tradução é o último lugar onde a regra pode vazar: um texto que mande "cadastrar e
  // reprocessar" recria na cabeça do operador a adoção que o produto removeu.
  assert.equal(traducoes.podeReprocessar, undefined, 'podeReprocessar voltou ao módulo')
  for (const [acao, texto] of Object.entries(ACAO_MOTIVO)) {
    assert.ok(!/reprocessar/i.test(texto), `a ação "${acao}" ainda fala em reprocessar`)
  }
  // O caminho legítimo aparece por escrito: criar a instância pelo produto.
  assert.ok(/Atendimento Views/.test(acaoTexto('auditar_origem_instancia')))
  assert.ok(/não podem ser adotadas/i.test(acaoTexto('auditar_origem_instancia')))
})

test('motivo desconhecido não vira texto inventado', () => {
  assert.equal(rotuloMotivo('motivo_novo_do_futuro'), 'motivo_novo_do_futuro')
  assert.ok(explicacaoMotivo('motivo_novo_do_futuro').includes('não reconhecida'))
})

test('a explicação diz que a instância foi criada fora do produto', () => {
  const texto = explicacaoMotivo('instancia_desconhecida')
  assert.ok(/não foi criada pelo Atendimento Views/i.test(texto))
  assert.ok(/bloqueada/i.test(texto))
  assert.ok(/nada do que ela envia é gravado/i.test(texto))
  // O rótulo do selo tem de dizer a mesma coisa em três palavras.
  assert.ok(/fora do Atendimento Views/i.test(rotuloMotivo('instancia_desconhecida')))
})

test('o tom separa transitório de bloqueio que exige auditoria', () => {
  assert.equal(tomPendencia(pendencia()), 'alerta')
  assert.equal(tomPendencia(pendencia({ motivo: 'erro_resolucao', transitorio: true })), 'atencao')
  assert.equal(tomPendencia(pendencia({ resolvida_em: '2026-08-08T13:00:00Z' })), 'ok')
  assert.equal(tomPendencia(null), 'neutro')
})

test('o resumo diz explicitamente que nada foi gravado', () => {
  assert.ok(resumoTexto({ total: 0, por_motivo: {} }).includes('Nenhuma instância bloqueada'))
  const t = resumoTexto({ total: 3, por_motivo: {} })
  assert.ok(t.includes('3'))
  assert.ok(t.toLowerCase().includes('nada foi gravado'))
  // Singular e plural não podem sair errados na tela.
  assert.ok(resumoTexto({ total: 1 }).includes('número está'))
  assert.ok(resumoTexto({ total: 2 }).includes('números estão'))
})
