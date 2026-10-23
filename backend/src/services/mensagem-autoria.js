'use strict'

/**
 * Vocabulário do ledger de SAÍDA de mensagens (migration 117). Módulo PURO: sem banco, sem
 * HTTP, sem IA, sem rede.
 *
 * Ele existe para responder UMA pergunta e não a outra. `autoria` = **quem ESCREVEU o texto**.
 * `acionador` = **quem MANDOU enviar**. São coisas diferentes e o pedido do operador exige
 * separá-las: um disparo automático iniciado por uma pessoa não pode contar duas vezes, nem
 * virar "mensagem da pessoa" quando a IA escreveu, nem "mensagem da IA" quando ninguém
 * reconheceria a mão dela ali.
 *
 * A regra que não se negocia: **autoria é DECLARADA por quem envia, nunca deduzida.** Quem não
 * declara entra como `desconhecida` — histórico sem autoria comprovada fica desconhecido, e não
 * é atribuído a ninguém para o total fechar bonito.
 */

/** Quem escreveu o texto. Lista FECHADA — espelha o CHECK da migration 117. */
const AUTORIA = Object.freeze({
  /** A IA redigiu (saudação gerada, resposta do funil, follow-up automático). */
  IA: 'ia',
  /** Uma pessoa redigiu, e sabemos qual (`autor_usuario_id`). */
  PESSOA: 'pessoa',
  /**
   * Ninguém comprovou. É o default e NÃO é um erro: cobre o template de saudação (escrito por
   * alguém, em algum momento, sem registro de quem) e qualquer enviador que ainda não declare.
   */
  DESCONHECIDA: 'desconhecida',
})

/** De que tipo é a mensagem. Lista FECHADA — espelha o CHECK da migration 117. */
const TIPO = Object.freeze({
  /** 1ª abordagem do Banco de Leads ("Rodar leads"/pool do Automático). */
  SAUDACAO: 'saudacao',
  /** Resposta conversacional do agente, no turno do webhook. */
  RESPOSTA_IA: 'resposta_ia',
  FOLLOWUP_AUTO: 'followup_auto',
  FOLLOWUP_MANUAL: 'followup_manual',
  /** Operador escrevendo 1:1 na Central de Mensagens. */
  MANUAL_OPERADOR: 'manual_operador',
  /** Lembrete/reagendamento de reunião. */
  AGENDA: 'agenda',
  /**
   * Aviso ao OPERADOR (handoff, relatório), não ao lead. Fica registrado porque sai pela mesma
   * instância e consome o mesmo número, mas é excluído dos indicadores de atendimento — somá-lo
   * inflaria "mensagens enviadas ao lead" com conversa interna.
   */
  ALERTA_OPERADOR: 'alerta_operador',
  OUTRO: 'outro',
})

const AUTORIAS = Object.freeze(Object.values(AUTORIA))
const TIPOS = Object.freeze(Object.values(TIPO))

/** Tipos que contam como mensagem AO LEAD. `alerta_operador` fica fora, de propósito. */
const TIPOS_DE_ATENDIMENTO = Object.freeze(
  TIPOS.filter((t) => t !== TIPO.ALERTA_OPERADOR)
)

/**
 * Normaliza o que o enviador declarou. Valor fora da lista cai em `desconhecida`/`outro` em vez
 * de quebrar o envio: o ledger é registro, e perder a mensagem porque o rótulo veio torto seria
 * trocar um problema de relatório por um problema de atendimento.
 *
 * `autor_usuario_id` só sobrevive com autoria `pessoa` (é o que o CHECK da migration exige):
 * nomear um autor humano numa linha escrita por IA afirmaria algo falso sobre aquela pessoa.
 */
function normalizarAutoria({ autoria, autorUsuarioId = null, acionadorUsuarioId = null, tipo } = {}) {
  const a = AUTORIAS.includes(String(autoria || '')) ? String(autoria) : AUTORIA.DESCONHECIDA
  const t = TIPOS.includes(String(tipo || '')) ? String(tipo) : TIPO.OUTRO
  return {
    autoria: a,
    tipo: t,
    autor_usuario_id: a === AUTORIA.PESSOA && autorUsuarioId ? String(autorUsuarioId) : null,
    acionador_usuario_id: acionadorUsuarioId ? String(acionadorUsuarioId) : null,
  }
}

/**
 * O que CADA indicador conta — texto que a tela é obrigada a mostrar junto do número.
 * "Mensagem", "lead contatado" e "lead que respondeu" medem coisas diferentes, e foi a ausência
 * dessas definições que deixou o pedido do operador sem resposta verificável.
 */
const DEFINICOES = Object.freeze({
  mensagens: 'Mensagens que o provedor aceitou enviar. Não é confirmação de entrega nem de leitura.',
  ia: 'Mensagens cujo texto foi redigido pela IA (saudação gerada, resposta do funil, follow-up automático).',
  pessoa: 'Mensagens redigidas por uma pessoa identificada no envio.',
  desconhecida: 'Mensagens sem autoria comprovada — inclui o template de saudação e todo o histórico anterior a este registro.',
  leads_contatados: 'Contatos distintos que receberam ao menos uma mensagem no período (um lead com 5 mensagens conta 1).',
  alerta_operador: 'Avisos enviados ao operador, não ao lead. Ficam fora dos totais de atendimento.',
})

module.exports = {
  AUTORIA,
  AUTORIAS,
  TIPO,
  TIPOS,
  TIPOS_DE_ATENDIMENTO,
  DEFINICOES,
  normalizarAutoria,
}
