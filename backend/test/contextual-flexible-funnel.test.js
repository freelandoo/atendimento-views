'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

process.env.OPENAI_API_KEY = ''
process.env.OPENAI_KEY = ''
process.env.ANTHROPIC_API_KEY = ''
process.env.ANTHROPIC_KEY = ''

const {
  decidirProximaResposta,
  extrairDadosLeadDoTexto,
  interpretarIntencaoMensagem,
  textoComoFunciona,
} = require('../src/agent')
const { extrairDadosMensagem } = require('../src/next-action-orchestrator')

test('slot-filling: "atendo em SP com barbearia" separa cidade e negocio', () => {
  const legado = extrairDadosLeadDoTexto('Atendo em SP com barbearia')
  assert.equal(legado.cidade_base, 'SP')
  assert.equal(legado.negocio, 'corte de cabelo / barbearia')
  assert.equal(legado.regiao_atendimento, undefined)

  const novo = extrairDadosMensagem('Atendo em SP com barbearia')
  assert.equal(novo.cidade, 'SP')
  assert.equal(novo.negocio, 'barbearia')
})

test('contexto: resposta sobre primeiro site vira tem_site=false', () => {
  const interpretacao = interpretarIntencaoMensagem({
    texto: 'Seria o primeiro',
    perfil: { negocio: 'barbearia', cidade: 'SP', necessidade: 'site' },
    estagio: 'conexao_valor',
    historico: [
      { role: 'assistant', content: 'Hoje voce ja tem algum site ou seria o primeiro?' },
    ],
  })

  assert.equal(interpretacao.intencao_principal, 'envio_dados_negocio')
  assert.equal(interpretacao.dados_extraidos.tem_site, false)
  assert.equal(interpretacao.dados_extraidos._slot_filling.tem_site, false)
})

test('contexto: aceite curto depois de convite consulta agenda', async () => {
  const decisao = await decidirProximaResposta({
    texto: 'Claro',
    perfil: {
      negocio: 'barbearia',
      cidade: 'SP',
      necessidade: 'site',
      eventos_conversa: { conexao_valor_realizada: true },
    },
    estagio: 'conexao_valor',
    historico: [
      { role: 'assistant', content: 'Posso verificar um horario para uma conversa rapida com a equipe?' },
    ],
  })

  assert.equal(decisao.proxima_acao, 'consultar_agenda_e_oferecer_horarios')
  assert.equal(decisao.prioridade_aplicada, 'aceite_convite_reuniao')
})

test('textoComoFunciona respeita perfil e nao pergunta negocio de novo', () => {
  const texto = textoComoFunciona({ negocio: 'barbearia', cidade: 'SP', necessidade: 'site' })
  assert.match(texto, /barbearia em SP/i)
  assert.match(texto, /Posso verificar um horario/i)
  assert.doesNotMatch(texto, /tipo do seu negocio/i)
})
