// Apresentacao do modo de IA da conversa — TRADUZ o veredito do backend, nao decide nada.
//
// Mesmo padrao de `lib/site-rotulos.js` e `lib/pontuacao-indicador.js`: a regra (o que cada
// modo permite) vive em `backend/src/services/conversa-modo-ia.js` e e' aplicada no envio.
// Aqui ficam so' rotulo, descricao, texto de ajuda e o estado visivel do controle. Se um dia
// a tela e o backend discordarem, quem manda e' o backend — a tela nunca autoriza envio.

export const MODOS_IA = {
  CONVERSA: 'conversa',
  ANALISE: 'analise',
}

export const MODO_IA_PADRAO = MODOS_IA.CONVERSA

/** Espelho do CHECK da migration 063. Valor fora daqui cai no padrao, nunca em "bloqueado". */
export const MODOS_IA_VALIDOS = [MODOS_IA.CONVERSA, MODOS_IA.ANALISE]

const CATALOGO = {
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

export function modoValido(valor) {
  return typeof valor === 'string' && MODOS_IA_VALIDOS.includes(valor.trim().toLowerCase())
}

export function normalizarModo(valor) {
  return modoValido(valor) ? valor.trim().toLowerCase() : MODO_IA_PADRAO
}

/** Rotulo, estado e textos de ajuda de um modo. Nunca devolve undefined. */
export function descreverModo(valor) {
  return CATALOGO[normalizarModo(valor)]
}

/** As duas opcoes do controle segmentado, na ordem em que aparecem. */
export function opcoesDeModo() {
  return MODOS_IA_VALIDOS.map((id) => CATALOGO[id])
}

/**
 * Frase completa para leitor de tela: o controle sozinho diria "Análise" sem dizer o que
 * isso muda. Aqui o estado e a consequencia andam juntos.
 */
export function rotuloAcessivel(valor) {
  const m = descreverModo(valor)
  return `Modo de atuação da IA: ${m.rotulo}. ${m.descricao}`
}

/**
 * O aviso que aparece no compositor quando a IA nao responde. Devolve `null` no modo
 * Conversa — nada a avisar. O texto aponta o caminho que JA existe para o atendente obter
 * uma sugestao ("Orientar resposta"), revisar e enviar ele mesmo.
 */
export function avisoDoCompositor(valor) {
  if (normalizarModo(valor) !== MODOS_IA.ANALISE) return null
  return {
    titulo: 'IA acompanhando, sem responder',
    texto: 'Nenhuma resposta automática sai desta conversa. Use "Orientar resposta" para a IA sugerir um texto, revise e envie você mesmo.',
  }
}

/**
 * O modo mudou de verdade? Evita PATCH (e toast) quando o operador clica no modo que ja
 * esta ativo — o backend tambem nao auditaria, mas o request seria desperdicio.
 */
export function houveMudanca(atual, novo) {
  return normalizarModo(atual) !== normalizarModo(novo)
}
