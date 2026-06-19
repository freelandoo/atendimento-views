'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

test('prompt deterministico herda o tom de referencia validado', () => {
  const prompts = require('../src/prompts')
  prompts.loadTomReferenciaPrompt()
  const { montarSystemPromptAcaoDeterministica } = require('../src/agent')
  const blocos = montarSystemPromptAcaoDeterministica({
    acao_decidida: 'diagnostico',
    instrucao_da_acao: 'Pergunte o proximo dado faltante com tom natural.',
    etapa_atual: 'diagnostico',
    etapa_sugerida: 'diagnostico',
    rota_comercial: null,
    perfil: {},
    dados_faltantes: ['negocio'],
    dados_extraidos: {},
    horarios_disponiveis: [],
    links_autorizados: [],
    acoes_proibidas: [],
    ultima_pergunta: '',
    resumo_historico: '',
  })
  const texto = blocos.map((b) => b && b.text ? b.text : '').join('\n')
  assert.match(texto, /Tom de refer.ncia.*PJ Codeworks/,
    'o caminho novo do orquestrador deve herdar o tom validado')
  assert.match(texto, /Camada relacional do padrao antigo/,
    'o prompt deterministico deve preservar espelhamento e acolhimento do tom antigo')
})

test('prompt deterministico expoe disponibilidade_semana e observacao_agenda para a IA', () => {
  const { montarSystemPromptAcaoDeterministica } = require('../src/agent')
  const blocos = montarSystemPromptAcaoDeterministica({
    acao_decidida: 'consultar_agenda',
    instrucao_da_acao: 'Ofereca um horario real.',
    etapa_atual: 'agendamento_pendente',
    etapa_sugerida: 'agendamento_pendente',
    rota_comercial: null,
    perfil: {},
    dados_faltantes: [],
    dados_extraidos: {},
    horarios_disponiveis: ['19:30'],
    disponibilidade_semana: {
      janela: { inicio: '19:30', fim: '21:15' },
      dias: [{ data: '2026-06-08', data_br: '08/06', label: 'segunda', horarios: ['19:30', '20:00'] }],
    },
    observacao_agenda: 'O cliente pediu 19:30, mas esse horario NAO esta mais disponivel. Reofereca os reais.',
    links_autorizados: [],
    acoes_proibidas: [],
    ultima_pergunta: '',
    resumo_historico: '',
  })
  const texto = blocos.map((b) => (b && b.text) ? b.text : '').join('\n')
  // A disponibilidade real de 7 dias precisa chegar ao prompt (antes ficava so no contexto).
  assert.match(texto, /disponibilidade_semana/)
  assert.match(texto, /08\/06/)
  // A instrucao corretiva de reoferta tambem (a IA escreve a mensagem, sem template).
  assert.match(texto, /observacao_agenda/)
  assert.match(texto, /NAO esta mais disponivel/)
})
