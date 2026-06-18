'use strict'

const assert = require('assert')
const {
  criarPromptComAnaliseEstruturada,
  validarSchemaAnaliseEstruturada,
  extrairRespostaFinal,
} = require('../src/ai-structured-analysis')

describe('AI Structured Analysis (Atividade A)', () => {
  describe('criarPromptComAnaliseEstruturada', () => {
    it('deve criar prompt modificado para JSON estruturado', () => {
      const basePrompt = 'Você é assistente de vendas'
      const resultado = criarPromptComAnaliseEstruturada(basePrompt)

      assert(resultado.includes('analise'), 'Deve incluir bloco de análise')
      assert(resultado.includes('decisoes'), 'Deve incluir bloco de decisões')
      assert(resultado.includes('restricoes'), 'Deve incluir bloco de restrições')
      assert(resultado.includes('resposta'), 'Deve incluir bloco de resposta')
      assert(resultado.includes('metadata'), 'Deve incluir bloco de metadata')
      assert(resultado.includes('JSON valido'), 'Deve enfatizar JSON válido')
    })
  })

  describe('validarSchemaAnaliseEstruturada', () => {
    it('deve aceitar schema válido completo', () => {
      const schema = {
        analise: {
          intencao: 'pergunta_preco',
          sentimento: 'neutro',
          confianca_analise: 85,
          dados_extraidos: {
            tipo_projeto: 'site',
            necessidade_principal: 'e-commerce',
            orçamento_mencionado: 5000,
            localização: 'São Paulo',
            empresa_nicho: 'moda'
          },
          estágio_recomendado: 'diagnostico',
          bloqueios_detectados: []
        },
        decisoes: {
          ação_principal: 'aprofundar_escopo',
          tom_resposta: 'consultivo',
          inclui_oferta_horario: false,
          coleta_dados: ['orçamento_total', 'timeline'],
          recomendação_handoff: false,
          motivo_handoff: null
        },
        restricoes: {
          palavras_proibidas: ['victor'],
          termos_internos: ['funil', 'lead quente'],
          promessas_proibidas: [],
          contexto_obedecido: true
        },
        resposta: 'Olá! Entendi que você quer um e-commerce para sua marca de moda. Qual é o seu objetivo principal com essa loja?',
        metadata: {
          versao_schema: '1.0',
          tempo_analise_ms: 1234,
          confianca_resposta: 90,
          validação_interna: 'ok'
        }
      }

      const resultado = validarSchemaAnaliseEstruturada(schema)
      assert.equal(resultado.valido, true, 'Schema deve ser válido')
      assert.equal(resultado.erros.length, 0, 'Não deve ter erros')
      assert.deepEqual(resultado.resultado, schema, 'Deve retornar o schema validado')
    })

    it('deve rejeitar schema com campos obrigatórios ausentes', () => {
      const schema = {
        analise: { intencao: 'pergunta_preco' },
        // Faltam: decisoes, restricoes, resposta, metadata
      }

      const resultado = validarSchemaAnaliseEstruturada(schema)
      assert.equal(resultado.valido, false, 'Schema deve ser inválido')
      assert(resultado.erros.length > 0, 'Deve ter erros')
      assert(resultado.erros[0].includes('obrigatório'), 'Deve mencionar campo obrigatório')
    })

    it('deve avisar se oferece horário em primeiro contato', () => {
      const schema = {
        analise: {
          intencao: 'novo',
          sentimento: 'positivo',
          confianca_analise: 70,
          dados_extraidos: {},
          estágio_recomendado: 'primeiro_contato',
          bloqueios_detectados: []
        },
        decisoes: {
          ação_principal: 'oferecer_horario',
          tom_resposta: 'acolhedor',
          inclui_oferta_horario: true,  // ⚠️ Incomum em primeiro contato
          coleta_dados: [],
          recomendação_handoff: false,
          motivo_handoff: null
        },
        restricoes: {
          palavras_proibidas: [],
          termos_internos: [],
          promessas_proibidas: [],
          contexto_obedecido: true
        },
        resposta: 'Ótimo! Temos disponibilidade amanhã às 14h',
        metadata: {
          versao_schema: '1.0',
          tempo_analise_ms: 1000,
          confianca_resposta: 60,
          validação_interna: 'ok'
        }
      }

      const resultado = validarSchemaAnaliseEstruturada(schema, { stage: 'primeiro_contato' })
      assert.equal(resultado.valido, true, 'Schema pode ser tecnicamente válido')
      assert(resultado.avisos.length > 0, 'Deve ter avisos')
      assert(resultado.avisos[0].includes('primeiro contato'), 'Deve avisar sobre primeiro contato')
    })

    it('deve bloquear resposta com palavras proibidas', () => {
      const schema = {
        analise: {
          intencao: 'pergunta_preco',
          sentimento: 'neutro',
          confianca_analise: 80,
          dados_extraidos: {},
          estágio_recomendado: 'diagnostico',
          bloqueios_detectados: []
        },
        decisoes: {
          ação_principal: 'oferecer_preco',
          tom_resposta: 'consultivo',
          inclui_oferta_horario: false,
          coleta_dados: [],
          recomendação_handoff: false,
          motivo_handoff: null
        },
        restricoes: {
          palavras_proibidas: ['victor'],
          termos_internos: [],
          promessas_proibidas: [],
          contexto_obedecido: true
        },
        resposta: 'Deixa eu chamar o Victor para te explicar melhor',  // ❌ Victor mencionado
        metadata: {
          versao_schema: '1.0',
          tempo_analise_ms: 1000,
          confianca_resposta: 50,
          validação_interna: 'ok'
        }
      }

      const resultado = validarSchemaAnaliseEstruturada(schema)
      assert.equal(resultado.valido, false, 'Schema deve ser inválido por palavra proibida')
      assert(resultado.erros.some(e => e.includes('Victor')), 'Deve mencionar a palavra proibida')
    })

    it('deve validar handoff sem motivo', () => {
      const schema = {
        analise: {
          intencao: 'pedido_humano',
          sentimento: 'negativo',
          confianca_analise: 95,
          dados_extraidos: {},
          estágio_recomendado: 'fechamento',
          bloqueios_detectados: []
        },
        decisoes: {
          ação_principal: 'fazer_handoff',
          tom_resposta: 'profissional',
          inclui_oferta_horario: false,
          coleta_dados: [],
          recomendação_handoff: true,
          motivo_handoff: null  // ❌ Falta motivo
        },
        restricoes: {
          palavras_proibidas: [],
          termos_internos: [],
          promessas_proibidas: [],
          contexto_obedecido: true
        },
        resposta: 'Vou conectar você com um operador',
        metadata: {
          versao_schema: '1.0',
          tempo_analise_ms: 1000,
          confianca_resposta: 95,
          validação_interna: 'ok'
        }
      }

      const resultado = validarSchemaAnaliseEstruturada(schema)
      assert.equal(resultado.valido, false, 'Schema deve ser inválido')
      assert(resultado.erros.some(e => e.includes('motivo_handoff')), 'Deve mencionar motivo_handoff ausente')
    })
  })

  describe('extrairRespostaFinal', () => {
    it('deve extrair apenas o texto da resposta', () => {
      const analise = {
        analise: { intencao: 'pergunta_preco' },
        decisoes: { ação_principal: 'oferecer_preco' },
        restricoes: { contexto_obedecido: true },
        resposta: '  Olá! Qual é seu orçamento?  ',
        metadata: { versao_schema: '1.0' }
      }

      const resultado = extrairRespostaFinal(analise)
      assert.equal(resultado, 'Olá! Qual é seu orçamento?', 'Deve extrair resposta sem espaços extras')
    })

    it('deve retornar mensagem padrão se resposta ausente', () => {
      const resultado1 = extrairRespostaFinal(null)
      assert.equal(resultado1, '[Sem resposta disponível]')

      const resultado2 = extrairRespostaFinal({})
      assert.equal(resultado2, '[Sem resposta disponível]')

      const resultado3 = extrairRespostaFinal({ resposta: null })
      assert.equal(resultado3, '[Sem resposta disponível]')
    })
  })

  describe('Integração: Fluxo Completo', () => {
    it('deve validar resposta típica bem-formada', () => {
      // Simula resposta real que Claude retornaria
      const respostaDoClaudeVerdadeira = {
        analise: {
          intencao: 'expressa_necessidade',
          sentimento: 'positivo',
          confianca_analise: 88,
          dados_extraidos: {
            tipo_projeto: 'site',
            necessidade_principal: 'presença digital',
            orçamento_mencionado: null,
            localização: 'São Paulo',
            empresa_nicho: 'consultoria'
          },
          estágio_recomendado: 'diagnostico',
          bloqueios_detectados: []
        },
        decisoes: {
          ação_principal: 'aprofundar_dor',
          tom_resposta: 'consultivo',
          inclui_oferta_horario: false,
          coleta_dados: ['segmento_mercado', 'concorrentes_diretos'],
          recomendação_handoff: false,
          motivo_handoff: null
        },
        restricoes: {
          palavras_proibidas: ['victor'],
          termos_internos: ['funil', 'lead quente'],
          promessas_proibidas: ['primeira página google'],
          contexto_obedecido: true
        },
        resposta: 'Que legal você quer criar um site! Me conta mais: qual é o principal objetivo? Gerar leads, vender, ou apenas apresentar a empresa?',
        metadata: {
          versao_schema: '1.0',
          tempo_analise_ms: 2341,
          confianca_resposta: 92,
          validação_interna: 'ok'
        }
      }

      const validacao = validarSchemaAnaliseEstruturada(respostaDoClaudeVerdadeira)
      assert.equal(validacao.valido, true, 'Resposta bem-formada deve ser válida')
      assert.equal(validacao.erros.length, 0, 'Não deve ter erros')

      const respostaFinal = extrairRespostaFinal(respostaDoClaudeVerdadeira)
      assert(respostaFinal.includes('objetivo'), 'Resposta deve conter o texto esperado')
      assert(!respostaFinal.includes('[Sem resposta'), 'Não deve ser mensagem de fallback')
    })
  })
})

console.log('\n✅ Testes da Atividade A (JSON Estruturado) prontos para rodar')
console.log('   Execute: npm test -- test/ai-structured-analysis.test.js\n')
