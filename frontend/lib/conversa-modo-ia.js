// Apresentacao do modo de IA — TRADUZ o que o backend calculou, nao decide nada.
//
// Mesmo padrao de `lib/site-rotulos.js` e `lib/pontuacao-indicador.js`. A precedencia
// (excecao da conversa > padrao da Central) e a permissao de enviar vivem em
// `backend/src/services/conversa-modo-ia.js`, e o modo EFETIVO chega pronto no
// `GET /conversas/:numero` (`modo_ia_efetivo`, `modo_ia_origem`, `modo_ia_padrao`).
// Recalcular aqui criaria uma segunda implementacao da prioridade — e a tela poderia
// afirmar "Conversa" enquanto o motor cala.
//
// TRES COISAS DIFERENTES aparecem no mesmo bloco da interface, e o operador precisa
// distinguir as tres:
//   1. o modo EFETIVO (o que vale agora);
//   2. a ORIGEM (veio de uma excecao desta conversa ou do padrao da Central);
//   3. a PAUSA humana (temporaria, nao e' modo, nao muda preferencia).

export const MODOS_IA = {
  CONVERSA: 'conversa',
  ANALISE: 'analise',
}

/** A escolha da conversa. `herdar` = sem excecao. Nao e' um modo — e a ausencia de escolha. */
export const PREFERENCIAS = {
  HERDAR: 'herdar',
  CONVERSA: MODOS_IA.CONVERSA,
  ANALISE: MODOS_IA.ANALISE,
}

export const PREFERENCIAS_VALIDAS = [PREFERENCIAS.HERDAR, PREFERENCIAS.CONVERSA, PREFERENCIAS.ANALISE]
export const MODOS_IA_VALIDOS = [MODOS_IA.CONVERSA, MODOS_IA.ANALISE]

export const PREFERENCIA_PADRAO = PREFERENCIAS.HERDAR
export const MODO_GLOBAL_PADRAO = MODOS_IA.CONVERSA

export const ORIGEM_MODO = {
  EXCECAO: 'excecao',
  HERDADO: 'herdado',
}

const CATALOGO_MODO = {
  [MODOS_IA.CONVERSA]: {
    id: MODOS_IA.CONVERSA,
    rotulo: 'Conversa',
    // Fica ao lado do controle, sempre visivel: cor nunca e' o unico sinal do estado.
    estado: 'IA pode responder',
    descricao: 'A IA analisa e pode responder automaticamente às mensagens desta conversa.',
    ajuda: 'A IA pode responder as mensagens desta conversa conforme as regras atuais.',
  },
  [MODOS_IA.ANALISE]: {
    id: MODOS_IA.ANALISE,
    rotulo: 'Análise',
    estado: 'IA acompanhando, sem responder',
    descricao: 'A IA acompanha e registra, mas não envia respostas automáticas ao cliente.',
    ajuda: 'A IA acompanha e registra a conversa, mas não responde automaticamente ao cliente.',
  },
}

const CATALOGO_PREFERENCIA = {
  [PREFERENCIAS.HERDAR]: {
    id: PREFERENCIAS.HERDAR,
    rotulo: 'Herdar padrão da Central',
    curto: 'Herdar',
    ajuda: 'Esta conversa segue o Modo padrão da IA configurado na Central de Mensagens. Mudar o padrão muda esta conversa junto.',
  },
  [PREFERENCIAS.CONVERSA]: {
    id: PREFERENCIAS.CONVERSA,
    rotulo: 'Conversa',
    curto: 'Conversa',
    ajuda: 'Só nesta conversa: a IA pode responder, mesmo que a Central esteja em Análise.',
  },
  [PREFERENCIAS.ANALISE]: {
    id: PREFERENCIAS.ANALISE,
    rotulo: 'Análise',
    curto: 'Análise',
    ajuda: 'Só nesta conversa: a IA não responde ao cliente, mesmo que a Central esteja em Conversa.',
  },
}

function texto(valor) {
  return typeof valor === 'string' ? valor.trim().toLowerCase() : ''
}

export function modoValido(valor) {
  return MODOS_IA_VALIDOS.includes(texto(valor))
}

export function preferenciaValida(valor) {
  return PREFERENCIAS_VALIDAS.includes(texto(valor))
}

/** `herdar` NAO e' modo: se chegar aqui, cai no padrao. */
export function normalizarModo(valor) {
  return modoValido(valor) ? texto(valor) : MODO_GLOBAL_PADRAO
}

export function normalizarPreferencia(valor) {
  return preferenciaValida(valor) ? texto(valor) : PREFERENCIA_PADRAO
}

/** Rotulo, estado e ajuda de um MODO efetivo. Nunca devolve undefined. */
export function descreverModo(valor) {
  return CATALOGO_MODO[normalizarModo(valor)]
}

/** Rotulo e ajuda de uma PREFERENCIA (inclui `herdar`). Nunca devolve undefined. */
export function descreverPreferencia(valor) {
  return CATALOGO_PREFERENCIA[normalizarPreferencia(valor)]
}

/** As duas opcoes do controle GLOBAL da Central. `herdar` nao entra: nao ha de quem herdar. */
export function opcoesDeModo() {
  return MODOS_IA_VALIDOS.map((id) => CATALOGO_MODO[id])
}

/** As tres opcoes do controle DA CONVERSA, na ordem em que aparecem. */
export function opcoesDePreferencia() {
  return PREFERENCIAS_VALIDAS.map((id) => CATALOGO_PREFERENCIA[id])
}

/**
 * Frase que explica DE ONDE veio o modo que esta valendo. Sem ela, o operador nao sabe se
 * precisa mexer nesta conversa ou na configuracao da Central.
 */
export function explicarOrigem({ origem, modoEfetivo, modoPadrao } = {}) {
  const efetivo = descreverModo(modoEfetivo)
  if (origem === ORIGEM_MODO.EXCECAO) {
    return `Exceção desta conversa: ${efetivo.rotulo}. O padrão da Central não altera esta conversa.`
  }
  return `Herdando o padrão da Central: ${descreverModo(modoPadrao ?? modoEfetivo).rotulo}.`
}

/**
 * O estado de PAUSA, dito separado do modo de proposito. Pausa nao e' modo: e' temporaria,
 * nasce quando um atendente responde e nao cria nem apaga preferencia.
 * Devolve `null` quando nao ha pausa — nada a avisar.
 */
export function avisoDePausa(agentePausado) {
  if (!agentePausado) return null
  return {
    titulo: 'IA pausada por atendimento humano',
    texto: 'Pausa temporária: enquanto durar, a IA não responde, mesmo no modo Conversa. Retomar o agente devolve a conversa ao modo acima.',
  }
}

/**
 * O aviso do compositor quando a IA nao vai responder — por modo, por pausa, ou pelos dois.
 * Aponta o caminho que JA existe para o atendente obter uma sugestao ("Orientar resposta"),
 * revisar e enviar ele mesmo.
 */
export function avisoDoCompositor({ modoEfetivo, agentePausado } = {}) {
  const emAnalise = normalizarModo(modoEfetivo) === MODOS_IA.ANALISE
  if (!emAnalise && !agentePausado) return null
  return {
    titulo: emAnalise ? 'IA acompanhando, sem responder' : 'IA pausada por atendimento humano',
    texto: 'Nenhuma resposta automática sai desta conversa agora. Use "Orientar resposta" para a IA sugerir um texto, revise e envie você mesmo.',
  }
}

// ─── Controle GLOBAL da Central (o padrao da empresa) ────────────────────────
// O escopo aqui e OUTRO: nao e' "esta conversa", e' toda conversa sem excecao propria.
// Reusar `descreverModo(...).descricao` — que diz "desta conversa" de proposito — faria o
// operador acreditar que esta mexendo so na conversa aberta, que e' o oposto do efeito.

const CATALOGO_PADRAO_GLOBAL = {
  [MODOS_IA.CONVERSA]: 'Toda conversa sem exceção própria: a IA pode responder automaticamente.',
  [MODOS_IA.ANALISE]: 'Toda conversa sem exceção própria: a IA acompanha e registra, mas não responde ao cliente.',
}

/** O que o padrao global significa, no escopo certo. Nunca devolve undefined. */
export function explicarPadraoGlobal(modo) {
  return CATALOGO_PADRAO_GLOBAL[normalizarModo(modo)]
}

/**
 * O limite do controle global, dito onde ele e' usado. Sem esta frase, mudar o padrao e ver
 * uma conversa continuar como estava parece defeito — e' excecao funcionando.
 */
export const AVISO_EXCECOES_PADRAO =
  'Conversas com exceção própria (Conversa ou Análise fixados) não são alteradas.'

/** Frase completa do controle GLOBAL para leitor de tela: estado, consequencia e limite. */
export function rotuloAcessivelPadrao(modo) {
  return `Modo padrão da IA na Central de Mensagens: ${descreverModo(modo).rotulo}. ${explicarPadraoGlobal(modo)} ${AVISO_EXCECOES_PADRAO}`
}

/** Frase completa para leitor de tela: estado, consequencia e origem numa coisa so. */
export function rotuloAcessivel({ modoEfetivo, origem, modoPadrao } = {}) {
  const m = descreverModo(modoEfetivo)
  return `Modo de atuação da IA nesta conversa: ${m.rotulo}. ${m.descricao} ${explicarOrigem({ origem, modoEfetivo, modoPadrao })}`
}

/** Evita PATCH (e toast) quando o operador clica na opcao que ja esta ativa. */
export function houveMudancaDePreferencia(atual, nova) {
  return normalizarPreferencia(atual) !== normalizarPreferencia(nova)
}

export function houveMudancaDeModo(atual, novo) {
  return normalizarModo(atual) !== normalizarModo(novo)
}

/**
 * Previsao LOCAL do efeito de uma escolha, usada so' para a atualizacao otimista enquanto o
 * PATCH viaja. A resposta do servidor sobrescreve isto — o backend continua sendo a
 * autoridade sobre o modo efetivo.
 */
export function preverEfetivo({ preferencia, modoPadrao } = {}) {
  const pref = normalizarPreferencia(preferencia)
  const padrao = normalizarModo(modoPadrao)
  const herdando = pref === PREFERENCIAS.HERDAR
  return {
    modo_ia: pref,
    modo_ia_padrao: padrao,
    modo_ia_efetivo: herdando ? padrao : pref,
    modo_ia_origem: herdando ? ORIGEM_MODO.HERDADO : ORIGEM_MODO.EXCECAO,
  }
}
