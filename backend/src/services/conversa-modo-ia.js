'use strict'
// Politica de resposta da conversa — FONTE DE VERDADE UNICA do modo de IA.
//
// Modulo PURO: sem banco, sem HTTP, sem IA, sem rede. Ele nao sabe enviar mensagem, nao
// sabe o que e' um webhook e nao le `process.env`. Responde a duas perguntas:
//
//     "qual o modo EFETIVO desta conversa, e de onde ele veio?"
//     "neste modo, esta capacidade pode ser executada?"
//
// TRES CONCEITOS QUE NAO PODEM SER CONFUNDIDOS
//   modo GLOBAL      — padrao da Central de Mensagens, por empresa
//                      (`app.empresas.config.modo_ia_padrao`). Vale para toda conversa que
//                      nao tenha excecao. Valores: conversa | analise.
//   PREFERENCIA      — a escolha da conversa (`vendas.conversas.modo_ia`). Valores:
//                      herdar | conversa | analise. `herdar` e' a AUSENCIA de excecao, e
//                      precisa ser um valor de primeira classe: representa-la como
//                      "conversa" faria toda a base virar excecao explicita e o modo global
//                      nunca alcancaria ninguem.
//   modo EFETIVO     — o que vale AGORA. CALCULADO, nunca persistido: uma copia gravada
//                      envelheceria no instante em que o global mudasse.
//
// A coluna se chama `modo_ia` mas guarda a PREFERENCIA (o nome honesto seria
// `modo_ia_preferencia`). Renomear abriria janela de erro durante o deploy — o container
// antigo consultaria uma coluna que nao existe mais. Divida declarada na migration 064 e em
// AGENTS.md; no codigo os nomes sao explicitos (`preferenciaDaConversa`, `modoEfetivo`).
//
// QUARTO CONCEITO, SEPARADO DE PROPOSITO: `agente_pausado`. Pausa TEMPORARIA por
// intervencao humana, escrita pelo proprio sistema. Nao cria, nao remove e nao altera
// preferencia; nao e' lida por este modulo. O envio automatico exige o modo efetivo
// `conversa` E o agente nao pausado — duas verificacoes, em dois lugares.
//
// POR QUE UM MODULO DE POLITICA, E NAO UM `if` EM CADA FLUXO
// Sao QUATRO capacidades que nascem entrelacadas no mesmo turno de LLM, e so uma delas e'
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
// global de automacao. Quem quiser desligar follow-up desliga follow-up.

/** Modos EFETIVOS possiveis. `herdar` NAO entra aqui: herdar nao e' um modo. */
const MODOS_IA = Object.freeze({
  CONVERSA: 'conversa',
  ANALISE: 'analise',
})

const MODOS_IA_VALIDOS = Object.freeze([MODOS_IA.CONVERSA, MODOS_IA.ANALISE])

/** O padrao global de fabrica e o comportamento historico do produto. */
const MODO_GLOBAL_PADRAO = MODOS_IA.CONVERSA

/** Preferencia da conversa. `HERDAR` = sem excecao. */
const PREFERENCIAS = Object.freeze({
  HERDAR: 'herdar',
  CONVERSA: MODOS_IA.CONVERSA,
  ANALISE: MODOS_IA.ANALISE,
})

const PREFERENCIAS_VALIDAS = Object.freeze([
  PREFERENCIAS.HERDAR,
  PREFERENCIAS.CONVERSA,
  PREFERENCIAS.ANALISE,
])

/** Ausencia de excecao e' o default: conversa nova segue a Central. */
const PREFERENCIA_PADRAO = PREFERENCIAS.HERDAR

/** De onde veio o modo efetivo. A tela MOSTRA isto; nao o recalcula. */
const ORIGEM_MODO = Object.freeze({
  EXCECAO: 'excecao',
  HERDADO: 'herdado',
})

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

// ─── Vocabulario ──────────────────────────────────────────────────────────────

function _texto(valor) {
  return typeof valor === 'string' ? valor.trim().toLowerCase() : ''
}

/** O valor e' um MODO conhecido? `herdar` nao e — e' preferencia, nao modo. */
function modoValido(valor) {
  return MODOS_IA_VALIDOS.includes(_texto(valor))
}

/** O valor e' uma PREFERENCIA conhecida? Usado pela rota para recusar entrada fora da lista. */
function preferenciaValida(valor) {
  return PREFERENCIAS_VALIDAS.includes(_texto(valor))
}

/**
 * Traz qualquer valor para um MODO. Desconhecido cai no padrao global de fabrica — nunca em
 * "bloqueado": um dado ausente jamais pode calar uma conversa que ninguem configurou.
 * `herdar` aqui e' entrada invalida (herdar nao e' modo) e tambem cai no padrao.
 */
function normalizarModo(valor) {
  return modoValido(valor) ? _texto(valor) : MODO_GLOBAL_PADRAO
}

/** Traz qualquer valor para uma PREFERENCIA. Desconhecido = sem excecao. */
function normalizarPreferencia(valor) {
  return preferenciaValida(valor) ? _texto(valor) : PREFERENCIA_PADRAO
}

/** Ha excecao explicita nesta conversa? */
function temExcecao(preferencia) {
  return normalizarPreferencia(preferencia) !== PREFERENCIAS.HERDAR
}

// ─── Modo efetivo ─────────────────────────────────────────────────────────────

/**
 * A ordem de prioridade inteira, num lugar so.
 *   1. preferencia explicita da conversa;
 *   2. modo global da Central, quando a preferencia e' `herdar`.
 * A pausa humana NAO entra aqui de proposito: ela nao muda o modo efetivo, e' uma segunda
 * condicao aplicada sobre a permissao de responder, no ponto onde sempre esteve.
 *
 * @returns {{ modo: string, origem: string, preferencia: string, modo_global: string }}
 */
function modoEfetivo({ preferencia, modoGlobal } = {}) {
  const pref = normalizarPreferencia(preferencia)
  const global = normalizarModo(modoGlobal)
  const herdando = pref === PREFERENCIAS.HERDAR
  return {
    modo: herdando ? global : pref,
    origem: herdando ? ORIGEM_MODO.HERDADO : ORIGEM_MODO.EXCECAO,
    preferencia: pref,
    modo_global: global,
  }
}

/**
 * Precedencia de leitura do modo GLOBAL quando o banco falha. Politica pura; quem faz I/O
 * (db/empresas.js) so aplica.
 *
 * Decisao do operador (2026-08-10): leitura fresca > ultimo valor conhecido, ainda que o
 * cache esteja vencido > padrao de fabrica. Um erro transitorio de banco nao pode fazer a
 * Central inteira trocar de modo — nem para calar o bot, nem para solta-lo. Cair direto no
 * padrao apagaria, por alguns segundos, uma decisao que o operador tomou.
 */
function resolverModoGlobal({ lido, ultimoConhecido } = {}) {
  if (modoValido(lido)) return { modo: normalizarModo(lido), fonte: 'leitura' }
  if (modoValido(ultimoConhecido)) return { modo: normalizarModo(ultimoConhecido), fonte: 'cache_vencido' }
  return { modo: MODO_GLOBAL_PADRAO, fonte: 'padrao' }
}

// ─── Politica de envio ────────────────────────────────────────────────────────

/** A capacidade esta liberada neste MODO EFETIVO? */
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
 * @param {{ preferencia?: string|null, modoGlobal?: string|null, capacidade?: string }} entrada
 * @returns {{ permitido: boolean, modo: string, origem: string, preferencia: string,
 *             modo_global: string, capacidade: string, motivo: string|null }}
 */
function avaliarEnvio({ preferencia, modoGlobal, capacidade = CAPACIDADES.RESPOSTA_CONVERSACIONAL } = {}) {
  const efetivo = modoEfetivo({ preferencia, modoGlobal })
  const permitido = permite(efetivo.modo, capacidade)
  return {
    ...efetivo,
    permitido,
    capacidade,
    motivo: permitido ? null : MOTIVO_BLOQUEIO.MODO_ANALISE,
  }
}

// ─── Log sem PII ──────────────────────────────────────────────────────────────

/** Ultimos 4 digitos, para o log dizer QUAL conversa sem escrever o telefone. */
function mascararNumero(numero) {
  const digitos = String(numero || '').replace(/\D/g, '')
  return digitos ? `***${digitos.slice(-4)}` : null
}

/**
 * Resumo do bloqueio para o `logger`. SEM PII: nada de JID, texto de mensagem, telefone em
 * claro ou trecho da resposta que deixou de ser enviada. Leva a ORIGEM porque "bloqueou
 * porque a Central esta em Analise" e "bloqueou porque esta conversa tem excecao" pedem
 * acoes diferentes de quem investiga.
 */
function resumoBloqueio({ empresaId = null, numero = null, modo = null, origem = null, capacidade = null } = {}) {
  return {
    operation: 'conversa_modo_ia',
    etapa: 'envio_bloqueado',
    motivo: MOTIVO_BLOQUEIO.MODO_ANALISE,
    modo: normalizarModo(modo),
    origem: origem || null,
    capacidade: capacidade || CAPACIDADES.RESPOSTA_CONVERSACIONAL,
    empresa_id: empresaId,
    numero_mascarado: mascararNumero(numero),
  }
}

module.exports = {
  MODOS_IA,
  MODOS_IA_VALIDOS,
  MODO_GLOBAL_PADRAO,
  PREFERENCIAS,
  PREFERENCIAS_VALIDAS,
  PREFERENCIA_PADRAO,
  ORIGEM_MODO,
  CAPACIDADES,
  MOTIVO_BLOQUEIO,
  PERMISSOES,
  modoValido,
  preferenciaValida,
  normalizarModo,
  normalizarPreferencia,
  temExcecao,
  modoEfetivo,
  resolverModoGlobal,
  permite,
  avaliarEnvio,
  mascararNumero,
  resumoBloqueio,
}
