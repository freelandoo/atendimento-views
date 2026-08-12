'use strict'
// DISPONIBILIDADE DE CANAL POR CONTATO — modulo PURO. Sem banco, sem HTTP, sem IA, sem rede.
//
// O defeito que este modulo corrige:
//   No reagendamento, o canal de um follow-up ficava congelado no que a ligacao havia
//   sugerido. Um contato reagendado para WhatsApp continuava reagendado para WhatsApp mesmo
//   depois de o operador descobrir que aquele numero nao tem WhatsApp (caso observado em
//   producao: Elite Auto Renovadora). O conhecimento existia — na cabeca de quem ligou — e
//   nao tinha onde ser gravado.
//
// A REGRA CENTRAL, em uma frase: quem diz que um contato nao tem WhatsApp e uma PESSOA.
//   Falha de envio, `exists:false` do Evolution, timeout do provider e instabilidade externa
//   NAO sao verificacao — sao ruido de transporte. Este modulo nao conhece nenhum desses
//   conceitos de proposito: nao ha aqui (e nao pode passar a haver) qualquer funcao que
//   receba um erro de envio e devolva um veredito. Ha guarda de regressao lendo este fonte
//   em test/contato-canal-disponibilidade.test.js.
//
// TRES ESTADOS, nao dois:
//   true  = o operador verificou e tem WhatsApp;
//   false = o operador verificou e NAO tem;
//   null  = ninguem verificou (a ausencia de linha na tabela).
//   `null` NAO e' `false`. Tratar "nao sei" como "nao tem" mandaria todo contato novo para
//   ligacao, que e o oposto do comportamento atual e uma decisao que ninguem tomou.
//
// Este modulo e o DONO do vocabulario (migration 066 espelha estes arrays).

/**
 * Canais cuja disponibilidade e curada por pessoa. Fechado em `whatsapp` de proposito:
 *   - `ligacao` nao entra porque o telefone E a identidade do contato (`telefone_digitos`,
 *     NOT NULL na migration 062) — a resposta seria sempre "disponivel" e a linha nao diria
 *     nada;
 *   - `email` nao entra porque NAO EXISTE canal de e-mail no follow-up. Ver EMAIL_FASE_SEPARADA.
 */
const CANAIS_CURAVEIS = Object.freeze(['whatsapp'])

/**
 * Como a marcacao chegou. UM valor, fechado, sem default — no codigo e na CHECK do banco.
 * E a garantia estrutural de que nenhum caminho automatico consegue marcar disponibilidade:
 * para faze-lo seria preciso alterar o schema, o que quebra o anti-drift.
 */
const ORIGEM_MARCACAO = Object.freeze(['operador'])

/**
 * Por que "e-mail confirmado" nao esta implementado.
 *
 * O pedido define a prioridade "sem WhatsApp -> e-mail confirmado -> ligacao". O primeiro
 * salto nao tem para onde ir: `FOLLOWUP_CANAL` e a CHECK `follow_ups_canal_chk` (migration
 * 062) sao fechados em `whatsapp|ligacao`, e nenhuma tela sabe executar um follow-up por
 * e-mail. Criar o valor `email` sem o executor produziria itens que entram na fila e nunca
 * saem dela — pior que a ausencia do canal.
 *
 * Enquanto isso: o salto efetivo e para `ligacao`, e SEMPRE ha telefone (ele e' a
 * identidade). O e-mail que existe hoje em cadastro/anotacao e' CANDIDATO, nunca confirmado:
 * ninguem verificou que aquele endereco recebe, e promove-lo sozinho a canal de contato
 * repetiria, do outro lado, o mesmo erro de deduzir disponibilidade sem verificacao humana.
 */
const EMAIL_FASE_SEPARADA = Object.freeze({
  suportado: false,
  motivo: 'follow-up nao tem canal de e-mail (CHECK follow_ups_canal_chk: whatsapp|ligacao)',
})

/** Canal usado quando o WhatsApp foi descartado por uma pessoa. */
const CANAL_SEM_WHATSAPP = 'ligacao'

const CANAIS = new Set(CANAIS_CURAVEIS)
const ORIGENS = new Set(ORIGEM_MARCACAO)
const LIMITE_MOTIVO = 300

function erroEntrada(message) {
  const err = new Error(message)
  err.statusCode = 400
  return err
}

/**
 * Normaliza a marcacao vinda do operador.
 *
 * `disponivel` e' aceito SO como booleano de verdade — nada de `'false'`, `0` ou `''`. Um
 * veredito sobre um contato real nao pode nascer de coercao de tipo: `Boolean('false')` e'
 * `true`, e o operador teria marcado o oposto do que quis.
 *
 * `origem` nao e' parametro: ela e' sempre `operador`, porque esta e' a unica funcao que
 * cria marcacao e ela so' e' chamada por uma acao humana explicita. Aceita-la de fora seria
 * abrir a porta para um job passar 'automatico'.
 */
function validarMarcacao(p = {}) {
  if (!CANAIS.has(p.canal)) {
    throw erroEntrada(`canal invalido para disponibilidade (use ${CANAIS_CURAVEIS.join(', ')}).`)
  }
  if (typeof p.disponivel !== 'boolean') {
    throw erroEntrada('disponivel deve ser booleano (true = tem o canal, false = nao tem).')
  }
  let motivo = null
  if (p.motivo != null && String(p.motivo).trim()) {
    motivo = String(p.motivo).trim()
    if (motivo.length > LIMITE_MOTIVO) {
      throw erroEntrada(`motivo excede o limite de ${LIMITE_MOTIVO} caracteres.`)
    }
  }
  return { canal: p.canal, disponivel: p.disponivel, motivo, origem: 'operador' }
}

/** Aceita o tri-estado vindo da API: true, false ou "nao informado". Nunca coage. */
function disponibilidadeInformada(valor) {
  if (valor === undefined || valor === null) return undefined
  if (typeof valor !== 'boolean') {
    throw erroEntrada('whatsapp_disponivel deve ser booleano ou ausente.')
  }
  return valor
}

/**
 * A REGRA DE PRIORIDADE DE CANAL, num lugar so.
 *
 * @param {string} canalAtual        canal do follow-up hoje.
 * @param {boolean|null} whatsappDisponivel  true | false | null ("ninguem verificou").
 * @returns {{canal: string, trocou: boolean, motivo: string|null}}
 *
 * Ordem, exatamente como decidida com o operador:
 *   1. canal que nao e' WhatsApp   -> nao mexe. A marcacao de WhatsApp nao diz nada sobre
 *      um item que ja e' de ligacao, e trocar seria decidir por quem escolheu.
 *   2. WhatsApp disponivel ou nao verificado -> mantem WhatsApp. `null` mantem o
 *      comportamento historico: ausencia de verificacao nunca vira veredito.
 *   3. WhatsApp marcado indisponivel -> e-mail confirmado, se existisse (ver
 *      EMAIL_FASE_SEPARADA) -> ligacao.
 *
 * A funcao NAO recebe "tem telefone?": o contato deste dominio E um telefone
 * (`telefone_digitos` NOT NULL, 8..15 digitos, migration 062). Um parametro que pudesse
 * dizer "nao tem telefone" descreveria um contato que nao existe neste modelo.
 */
function resolverCanalFollowUp(canalAtual, whatsappDisponivel) {
  if (canalAtual !== 'whatsapp') return { canal: canalAtual, trocou: false, motivo: null }
  if (whatsappDisponivel !== false) return { canal: 'whatsapp', trocou: false, motivo: null }
  return {
    canal: CANAL_SEM_WHATSAPP,
    trocou: true,
    motivo: 'contato marcado como sem WhatsApp',
  }
}

/** Atalho de leitura: "este follow-up esta num canal que o operador descartou?" */
function canalDescartadoPeloOperador(canal, whatsappDisponivel) {
  return canal === 'whatsapp' && whatsappDisponivel === false
}

module.exports = {
  CANAIS_CURAVEIS,
  ORIGEM_MARCACAO,
  CANAL_SEM_WHATSAPP,
  EMAIL_FASE_SEPARADA,
  LIMITE_MOTIVO,
  validarMarcacao,
  disponibilidadeInformada,
  resolverCanalFollowUp,
  canalDescartadoPeloOperador,
}
