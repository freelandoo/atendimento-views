'use strict'
/**
 * Executores de ações do agente — separação documentada das responsabilidades.
 *
 * Cada ação aqui descrita é executada DETERMINISTICAMENTE pelo orquestrador
 * (src/agent-orchestrator.js) ANTES de chamar a LLM. A IA não decide essas
 * ações sozinha — ela apenas é convidada a escrever quando o orquestrador
 * cede o turno (ver fluxo em core-funnel.gerarEEnviarRespostaWhatsapp).
 *
 * As implementações estão hoje espalhadas entre src/agent.js e src/core-funnel.js
 * por questões históricas. Este arquivo documenta o mapeamento e oferece uma
 * interface única para consumidores externos.
 *
 * MAPA DE AÇÕES → IMPLEMENTAÇÃO:
 *
 *   ação                                   | implementação
 *   ---------------------------------------|--------------------------------------------
 *   primeiro_contato_assistente            | agent.textoPrimeiroContatoAssistente()
 *   explicar_ultima_pergunta               | agent.textoExplicacaoUltimaPergunta(perfil, historico)
 *   encaminhar_humano                      | inline em decidirProximaResposta
 *   confirmar_reuniao                      | core-funnel.resultadoAgendaPorDecisao('confirmar_reuniao')
 *   consultar_agenda_e_oferecer_horarios   | core-funnel.resultadoAgendaPorDecisao('consultar_agenda_...')
 *   reagendar                              | core-funnel.resultadoAgendaPorDecisao('reagendar')
 *   responder_preco                        | agent.textoPrecoCalculado(perfil)
 *   responder_preco_e_coletar_contexto     | agent.textoFaixaPrecoInicial()
 *   explicar_solucao                       | agent.textoComoFunciona / textoInteresseClaroSimples
 *   coletar_necessidade_ampla              | agent.montarPerguntaFaltante(perfil)
 *   gerar_resposta_via_LLM (fallback)      | agent.chamarClaude(historico, ...) — roteado pelo aiProvider
 *
 * REGRAS DE EXECUÇÃO (invioláveis):
 *
 * 1. Ações que envolvem AGENDA:
 *    - SEMPRE consultar agenda real via `buscarSlotsDisponiveis`
 *    - NUNCA inventar horários hardcoded
 *    - Se a agenda falhar, devolver mensagem neutra ("Posso verificar os próximos
 *      horários disponíveis?") e deixar a equipe assumir
 *
 * 2. Ações que envolvem PREÇO:
 *    - Em projeto sob medida (perfil.projeto_sob_medida === true), JAMAIS enviar
 *      R$/faixa/parcela ao lead — o validador (agent-validators) bloqueia se vazar
 *
 * 3. Ações que envolvem HANDOFF:
 *    - resumo_handoff é INTERNO. Nunca aparece em mensagem_pro_lead
 *    - O validador checa que etiquetas tipo "Estágio:" / "Intenção:" não vazam
 *
 * 4. Ações que envolvem ESTÁGIO:
 *    - Transição de estágio acontece via etapa_proxima no resultado
 *    - Apenas o orquestrador pode mudar etapa_proxima — a LLM pode SUGERIR
 *      mas o codigo decide
 *
 * Este modulo nao implementa lógica nova — é uma INTERFACE DOCUMENTAL para
 * facilitar a leitura e o roteamento entre as funções que cuidam de cada ação.
 */

// Re-exports comuns (para callers externos terem um único ponto de import)
const agent = require('./agent')

const ACOES = Object.freeze({
  PRIMEIRO_CONTATO: 'primeiro_contato_assistente',
  EXPLICAR_PERGUNTA: 'explicar_ultima_pergunta',
  ENCAMINHAR_HUMANO: 'encaminhar_humano',
  CONFIRMAR_REUNIAO: 'confirmar_reuniao',
  CONSULTAR_AGENDA: 'consultar_agenda_e_oferecer_horarios',
  REAGENDAR: 'reagendar',
  RESPONDER_PRECO: 'responder_preco',
  RESPONDER_PRECO_E_COLETAR: 'responder_preco_e_coletar_contexto',
  EXPLICAR_SOLUCAO: 'explicar_solucao',
  COLETAR_DADO_FALTANTE: 'coletar_necessidade_ampla',
  GERAR_VIA_LLM: 'avanco_comercial',
})

/**
 * Indica se uma ação é CRITICA — ações críticas DEVEM ser executadas
 * deterministicamente, nunca delegadas para a LLM.
 */
function ehAcaoCritica(acao) {
  return [
    ACOES.PRIMEIRO_CONTATO,
    ACOES.ENCAMINHAR_HUMANO,
    ACOES.CONFIRMAR_REUNIAO,
    ACOES.CONSULTAR_AGENDA,
    ACOES.REAGENDAR,
    ACOES.EXPLICAR_PERGUNTA,
  ].includes(acao)
}

module.exports = {
  ACOES,
  ehAcaoCritica,
  // textos canônicos disponiveis para callers
  textoExplicacaoUltimaPergunta: agent.textoExplicacaoUltimaPergunta,
  textoComoFunciona: agent.textoComoFunciona,
  textoFaixaPrecoInicial: agent.textoFaixaPrecoInicial,
  textoPrecoCalculado: agent.textoPrecoCalculado,
  textoNecessidadeAmpla: agent.textoNecessidadeAmpla,
  montarPerguntaFaltante: agent.montarPerguntaFaltante,
}
