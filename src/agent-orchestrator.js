'use strict'
/**
 * Interface PUBLICA do orquestrador do agente.
 *
 * Centraliza em um unico ponto de import as funcoes que decidem a proxima acao
 * do bot a partir de (mensagem atual, perfil do lead, estagio do funil, historico).
 *
 * Princípio arquitetural:
 *
 *    A IA pode INTERPRETAR e ESCREVER, mas o CODIGO decide acoes criticas.
 *
 * Ações críticas que passam pelo orquestrador (deterministico):
 *   - confirmar reuniao
 *   - oferecer horario
 *   - alterar estagio
 *   - marcar venda
 *   - gerar handoff
 *   - responder preco
 *   - acionar humano
 *   - reexplicar pergunta apos "Nao entendi?"
 *
 * Hierarquia de prioridade (documentada tambem em prompts/system.md secao
 * PRIORIDADES INVIOLAVEIS):
 *   1. Pedido humano / seguranca
 *   2. Duvida "Nao entendi?" — reexplicar
 *   3. Escolha de horario
 *   4. Pergunta direta
 *   5. Dados faltantes (slot filling)
 *   6. Agendamento
 *   7. Continuacao do fluxo (LLM)
 *
 * Pipeline tipico de uso (em core-funnel.gerarEEnviarRespostaWhatsapp):
 *
 *    1. const decisao = decidirProximaAcao({ texto, perfil, estagio, historico })
 *    2. if (decisao.deve_sobrescrever_modelo) {
 *         resultado = await resultadoAgendaPorDecisao(decisao, perfil, estagio, historico)
 *       } else {
 *         resultado = await chamarClaude(historico, estagio, perfil, ...)
 *       }
 *    3. resultado = aplicarGuardrailReuniaoProposta(resultado, perfil, dataRef, buscarSlots)
 *    4. resultado = validarRespostaAntesDeEnviar(resultado, perfil).resultado
 *    5. enviarMensagem(...)
 *
 * Notas de implementacao:
 * - As funcoes deste modulo sao REEXPORTS de src/agent.js (onde a implementacao
 *   historicamente esta). Este arquivo existe para dar um ponto de import com
 *   semantica clara — "estou usando o orquestrador, nao a soma de helpers do
 *   agente legado".
 * - Refatoracoes futuras podem mover as implementacoes para ca sem quebrar
 *   chamadores externos (eles importam pelo nome aqui).
 */

const agent = require('./agent')
const validators = require('./agent-validators')

/**
 * Decide a proxima acao do agente. Retorna `{ interpretacao, estado_comercial,
 * proxima_acao, deve_sobrescrever_modelo, resultado, ... }`.
 *
 * Esta funcao e DETERMINISTICA. Para casos em que o resultado nao deve sobrescrever
 * o modelo (`deve_sobrescrever_modelo === false`), o caller deve invocar a LLM como
 * fallback — a IA so escreve quando o orquestrador nao consegue decidir.
 *
 * @param {object} contexto
 * @param {string} contexto.texto    - ultima mensagem do lead
 * @param {object} contexto.perfil   - perfil persistido do lead
 * @param {string} contexto.estagio  - estagio do funil
 * @param {Array}  contexto.historico - historico de mensagens
 */
function decidirProximaAcao(contexto) {
  return agent.decidirProximaAcao(contexto)
}

/**
 * Classifica a intencao da mensagem atual do lead. Retorna `{ intencao_principal,
 * dados_extraidos, ... }`. Usada internamente por decidirProximaAcao mas exposta
 * para callers que precisam apenas da classificacao (ex.: telemetria).
 */
function interpretarMensagem(contexto) {
  return agent.interpretarIntencaoMensagem(contexto)
}

/**
 * Extrai dados estruturados (negocio, cidade_base, regiao_atendimento, necessidade)
 * de uma mensagem livre do lead. Idempotente, puro.
 */
function extrairDadosDaMensagem(texto) {
  return agent.extrairDadosLeadDoTexto(texto)
}

/**
 * Retorna a proxima pergunta basica que ainda falta, ou null se os tres dados
 * basicos (negocio, cidade, necessidade) ja foram coletados.
 */
function obterProximaPerguntaBasica(perfil) {
  return agent.obterProximaPergunta(perfil)
}

module.exports = {
  // Funcao central (alias semantico para decidirProximaResposta)
  decidirProximaAcao,
  // Sub-componentes do orquestrador
  interpretarMensagem,
  extrairDadosDaMensagem,
  obterProximaPerguntaBasica,
  // Validacao final (defesa em profundidade antes de enviar)
  validarRespostaAntesDeEnviar: validators.validarRespostaAntesDeEnviar,
  // Aliases para retrocompatibilidade — chamadores antigos
  decidirProximaResposta: agent.decidirProximaResposta,
  interpretarIntencaoMensagem: agent.interpretarIntencaoMensagem,
  extrairDadosLeadDoTexto: agent.extrairDadosLeadDoTexto,
  obterProximaPergunta: agent.obterProximaPergunta,
}
