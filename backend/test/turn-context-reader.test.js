'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { buildTurnContext } = require('../src/turn-context-reader')

test('Fact Memory marca negocio/cidade/site definidos e bloqueia perguntas repetidas', () => {
  const ctx = buildTurnContext({
    historico: [
      { role: 'assistant', content: 'Hoje voce ja tem algum site ou seria o primeiro?' },
      { role: 'user', content: 'Primeiro' },
    ],
    perfil: {
      negocio: 'manutencao predial',
      cidade: 'Rio de Janeiro',
      necessidade: 'site',
    },
    estagio: 'diagnostico',
  })

  assert.equal(ctx.turn_state, 'lead_resposta_curta_contextual')
  assert.equal(ctx.resposta_contextual.tipo, 'tem_site')
  assert.equal(ctx.fact_memory.negocio.definido, true)
  assert.equal(ctx.fact_memory.cidade_regiao.definido, true)
  assert.equal(ctx.fact_memory.tem_site.definido, true)
  assert.equal(ctx.fact_memory.tem_site.valor, 'nao')
  assert.ok(ctx.action_policy.acoes_bloqueadas.includes('perguntar_negocio'))
  assert.ok(ctx.action_policy.acoes_bloqueadas.includes('perguntar_cidade'))
  assert.ok(ctx.action_policy.acoes_bloqueadas.includes('perguntar_tem_site'))
})

test('Resposta curta "Claro" apos convite de reuniao vira aceite contextual', () => {
  const ctx = buildTurnContext({
    historico: [
      { role: 'assistant', content: 'Posso verificar um horario rapido com a equipe?' },
      { role: 'user', content: 'Claro' },
    ],
    perfil: {
      negocio: 'barbearia',
      cidade: 'Sao Bernardo do Campo',
      necessidade: 'site',
    },
    estagio: 'diagnostico',
  })

  assert.equal(ctx.turn_state, 'lead_aceitou_reuniao')
  assert.equal(ctx.resposta_contextual.tipo, 'aceite_reuniao')
  assert.equal(ctx.action_policy.acao_permitida, 'consultar_agenda_ou_confirmar_horario')
})

test('Lead confuso bloqueia oferta de reuniao e orienta explicar sem avancar', () => {
  const ctx = buildTurnContext({
    historico: [
      { role: 'assistant', content: 'Posso verificar um horario rapido com a equipe?' },
      { role: 'user', content: 'Parece complicado, como funciona?' },
    ],
    perfil: {
      negocio: 'construcao civil',
      cidade: 'Sao Paulo',
      necessidade: 'site',
    },
    estagio: 'diagnostico',
  })

  assert.equal(ctx.turn_state, 'lead_confuso')
  assert.equal(ctx.action_policy.acao_permitida, 'explicar_sem_avancar')
  assert.ok(ctx.action_policy.acoes_bloqueadas.includes('oferecer_reuniao'))
  assert.ok(ctx.action_policy.acoes_bloqueadas.includes('avancar_funil'))
})

test('Prompt block explicita memoria factual e regras para o LLM', () => {
  const ctx = buildTurnContext({
    historico: [
      { role: 'assistant', content: 'Em qual cidade voce atende?' },
      { role: 'user', content: 'SBC e regiao' },
    ],
    perfil: {
      negocio: 'barbearia',
      necessidade: 'site',
    },
    estagio: 'diagnostico',
  })

  assert.match(ctx.prompt_block, /LEITURA DO TURNO ATUAL/)
  assert.match(ctx.prompt_block, /MEMORIA FACTUAL DO LEAD/)
  assert.match(ctx.prompt_block, /Negocio: definido - barbearia/)
  assert.match(ctx.prompt_block, /Cidade\/regiao: definido - SBC e regiao/)
  assert.match(ctx.prompt_block, /Acoes proibidas:/)
  assert.match(ctx.prompt_block, /Use os fatos definidos como verdade; nao pergunte de novo/)
})

test('Resposta fora da pergunta pendente orienta explicar e reformular sem reuniao', () => {
  const ctx = buildTurnContext({
    historico: [
      { role: 'assistant', content: 'Hoje voce ja tem algum site ou seria o primeiro?' },
      { role: 'user', content: 'Indicacao mesmo' },
    ],
    perfil: { negocio: 'restaurantes', cidade: 'SP', necessidade: 'site' },
    estagio: 'diagnostico',
    mensagemAtual: 'Indicacao mesmo',
  })

  assert.equal(ctx.turn_state, 'lead_resposta_fora_da_pergunta')
  assert.equal(ctx.action_policy.acao_permitida, 'explicar_e_reformular_pergunta_pendente')
  assert.ok(ctx.action_policy.acoes_bloqueadas.includes('oferecer_reuniao'))
  assert.ok(ctx.action_policy.acoes_bloqueadas.includes('ignorar_pergunta_pendente'))
})
