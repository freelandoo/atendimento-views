'use strict'
// Politica de resposta da conversa — FONTE DE VERDADE UNICA do modo de IA.
//
// Modulo PURO: sem banco, sem HTTP, sem IA, sem rede. Ele nao sabe enviar mensagem, nao
// sabe o que e' um webhook e nao le `process.env`. So responde a uma pergunta:
//
//     "esta conversa, neste modo, pode executar esta capacidade?"
//
// POR QUE UM MODULO DE POLITICA, E NAO UM `if` EM CADA FLUXO
// O pedido e' explicito: nao espalhar condicionais pelos fluxos existentes. O sistema tem
// QUATRO capacidades que hoje nascem entrelacadas no mesmo turno de LLM, e so uma delas e'
// governada por este toggle:
//
//   analise                → ler mensagens, extrair dados, interesse, objecoes, pendencias
//                            e proximos passos. SEMPRE disponivel; e' o que da nome ao modo.
//   resposta_conversacional→ gerar e ENTREGAR ao cliente uma resposta as mensagens desta
//                            conversa. A UNICA capacidade que o toggle governa.
//   follow_up              → cadencia propria, com ativacao, regras, prazos e canais
//                            proprios (app.followup_config + followup-auto.js).
//   agenda                 → lembretes e rotinas de reuniao, com regras proprias.
//
// Follow-up e agenda aparecem aqui de proposito, marcados como SEMPRE permitidos. Nao e'
// enfeite: e' o que impede que alguem, mais tarde, "aproveite" o modo Analise como pausa
// global. Quem quiser desligar follow-up desliga follow-up; quem quiser desligar lembrete
// desliga lembrete. O modo Analise nao e' um interruptor geral de automacao.
//
// NAO CONFUNDIR COM `agente_pausado`. Aquilo e' pausa temporaria por intervencao humana,
// escrita pelo proprio sistema quando um atendente responde. Isto e' decisao persistente do
// operador. Os dois convivem, e o envio automatico exige os DOIS liberados — a checagem da
// pausa continua onde sempre esteve, este modulo nao a substitui nem a le.

/** Modos possiveis de uma conversa. Lista fechada — o CHECK da migration 063 e' o espelho. */
const MODOS_IA = Object.freeze({
  CONVERSA: 'conversa',
  ANALISE: 'analise',
})

/** O default e' o comportamento historico: conversa existente nao muda de comportamento. */
const MODO_IA_PADRAO = MODOS_IA.CONVERSA

const MODOS_IA_VALIDOS = Object.freeze([MODOS_IA.CONVERSA, MODOS_IA.ANALISE])

/** O que um fluxo pode querer fazer. Quem chama declara a capacidade, nunca o modo. */
const CAPACIDADES = Object.freeze({
  ANALISE: 'analise',
  RESPOSTA_CONVERSACIONAL: 'resposta_conversacional',
  FOLLOW_UP: 'follow_up',
  AGENDA: 'agenda',
})

/** Motivo unico de bloqueio deste modulo. Vai para log e para o retorno dos enviadores. */
const MOTIVO_BLOQUEIO = Object.freeze({
  MODO_ANALISE: 'modo_analise',
})

// A matriz e' a regra inteira. Ler esta tabela responde qualquer duvida sobre o que cada
// modo faz — nao ha segunda lista em lugar nenhum do sistema.
const PERMISSOES = Object.freeze({
  [MODOS_IA.CONVERSA]: Object.freeze([
    CAPACIDADES.ANALISE,
    CAPACIDADES.RESPOSTA_CONVERSACIONAL,
    CAPACIDADES.FOLLOW_UP,
    CAPACIDADES.AGENDA,
  ]),
  [MODOS_IA.ANALISE]: Object.freeze([
    CAPACIDADES.ANALISE,
    // resposta_conversacional AUSENTE de proposito: e' exatamente isto que o modo faz.
    CAPACIDADES.FOLLOW_UP,
    CAPACIDADES.AGENDA,
  ]),
})

/** O valor e' um modo conhecido? Usado pela rota para recusar entrada fora da lista. */
function modoValido(valor) {
  return typeof valor === 'string' && MODOS_IA_VALIDOS.includes(valor.trim().toLowerCase())
}

/**
 * Traz qualquer valor para a lista fechada. Desconhecido, nulo ou coluna ainda nao
 * preenchida caem no padrao — nunca em "bloqueado": um dado ausente jamais pode calar
 * uma conversa que o operador nunca configurou.
 */
function normalizarModo(valor) {
  return modoValido(valor) ? valor.trim().toLowerCase() : MODO_IA_PADRAO
}

/** A capacidade esta liberada neste modo? */
function permite(modo, capacidade) {
  return PERMISSOES[normalizarModo(modo)].includes(capacidade)
}

/**
 * Veredito consultado imediatamente ANTES de entregar algo ao cliente.
 *
 * Chamado por quem envia, nunca por quem analisa: a analise ja rodou e ja foi persistida
 * quando esta funcao e' chamada. Um `return` antes da analise seria o defeito que este
 * modulo existe para evitar.
 *
 * @param {{ modo?: string|null, capacidade?: string }} entrada
 * @returns {{ permitido: boolean, modo: string, capacidade: string, motivo: string|null }}
 */
function avaliarEnvio({ modo, capacidade = CAPACIDADES.RESPOSTA_CONVERSACIONAL } = {}) {
  const modoNorm = normalizarModo(modo)
  const permitido = permite(modoNorm, capacidade)
  return {
    permitido,
    modo: modoNorm,
    capacidade,
    motivo: permitido ? null : MOTIVO_BLOQUEIO.MODO_ANALISE,
  }
}

/** Ultimos 4 digitos, para o log dizer QUAL conversa sem escrever o telefone. */
function mascararNumero(numero) {
  const digitos = String(numero || '').replace(/\D/g, '')
  return digitos ? `***${digitos.slice(-4)}` : null
}

/**
 * Resumo do bloqueio para o `logger`. SEM PII: nada de JID, texto de mensagem, telefone em
 * claro ou trecho da resposta que deixou de ser enviada.
 */
function resumoBloqueio({ empresaId = null, numero = null, modo = null, capacidade = null } = {}) {
  return {
    operation: 'conversa_modo_ia',
    etapa: 'envio_bloqueado',
    motivo: MOTIVO_BLOQUEIO.MODO_ANALISE,
    modo: normalizarModo(modo),
    capacidade: capacidade || CAPACIDADES.RESPOSTA_CONVERSACIONAL,
    empresa_id: empresaId,
    numero_mascarado: mascararNumero(numero),
  }
}

module.exports = {
  MODOS_IA,
  MODOS_IA_VALIDOS,
  MODO_IA_PADRAO,
  CAPACIDADES,
  MOTIVO_BLOQUEIO,
  PERMISSOES,
  modoValido,
  normalizarModo,
  permite,
  avaliarEnvio,
  mascararNumero,
  resumoBloqueio,
}
