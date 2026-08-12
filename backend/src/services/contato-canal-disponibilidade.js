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
// A REGRA CENTRAL, em uma frase: quem diz que um contato nao tem um canal e uma PESSOA.
//   Falha de envio, `exists:false` do Evolution, timeout do provider e instabilidade externa
//   NAO sao verificacao — sao ruido de transporte. Este modulo nao conhece nenhum desses
//   conceitos de proposito: nao ha aqui (e nao pode passar a haver) qualquer funcao que
//   receba um erro de envio e devolva um veredito. Ha guarda de regressao lendo este fonte
//   em test/contato-canal-disponibilidade.test.js.
//
// TRES ESTADOS, nao dois:
//   true  = o operador verificou e o contato tem aquele canal;
//   false = o operador verificou e NAO tem;
//   null  = ninguem verificou (a ausencia de linha na tabela).
//   `null` NAO e' `false`. Tratar "nao sei" como "nao tem" mandaria todo contato novo para
//   ligacao, que e o oposto do comportamento atual e uma decisao que ninguem tomou.
//
// Este modulo e o DONO do vocabulario (migrations 066 e 067 espelham estes arrays).

/**
 * Canais cuja disponibilidade e curada por pessoa.
 *
 * `ligacao` nao entra porque o telefone E a identidade do contato (`telefone_digitos`,
 * NOT NULL na migration 062) — a resposta seria sempre "disponivel" e a linha nao diria nada.
 *
 * `email` entrou na migration 067, **junto com o executor** (services/followup-email.js + a
 * acao "Escrever e-mail" na Central de Follow-ups). Ver EMAIL_CANAL: o valor so existe
 * porque agora ha quem o execute.
 */
const CANAIS_CURAVEIS = Object.freeze(['whatsapp', 'email'])

/**
 * Como a marcacao chegou. UM valor, fechado, sem default — no codigo e na CHECK do banco.
 * E a garantia estrutural de que nenhum caminho automatico consegue marcar disponibilidade:
 * para faze-lo seria preciso alterar o schema, o que quebra o anti-drift.
 */
const ORIGEM_MARCACAO = Object.freeze(['operador'])

/**
 * O canal de e-mail — o que era `EMAIL_FASE_SEPARADA` ate a migration 067.
 *
 * Historico, porque ele explica a unica regra dura deste canal: enquanto nao havia executor,
 * o valor `email` era PROIBIDO (Decisao 4 de 2026-08-12) — criar um canal que nenhuma tela
 * sabe executar produziria itens que entram na fila e nunca saem dela, pior que a ausencia
 * do canal. O valor nasceu junto do executor, e por isso `exige_endereco` e a condicao que
 * a CHECK `contato_canal_disp_email_confirmado_chk` impoe no banco: confirmar e-mail e dizer
 * PARA ONDE. Canal sem destino nao e canal.
 */
const EMAIL_CANAL = Object.freeze({
  suportado: true,
  executor: 'central_follow_ups',
  exige_endereco: true,
  desde: '067_follow_up_canal_email.sql',
})

/**
 * O e-mail que existe hoje em cadastro (`prospectador.prospects.email`) ou numa anotacao e'
 * CANDIDATO, nunca confirmado. Ninguem verificou que aquele endereco recebe, e promove-lo
 * sozinho a canal de contato repetiria, do outro lado, o mesmo erro de deduzir
 * disponibilidade sem verificacao humana — o defeito que este modulo inteiro existe para
 * impedir. Ele e SUGERIDO na tela; quem confirma e uma pessoa, e a confirmacao vira linha
 * com `origem = 'operador'`.
 */
const EMAIL_CANDIDATO = Object.freeze({
  confirma: false,
  motivo: 'e-mail de cadastro ou anotacao nao foi verificado por ninguem',
})

/** Canal usado quando nenhum canal mais direto foi confirmado. Sempre existe telefone. */
const CANAL_SEM_WHATSAPP = 'ligacao'

/**
 * A ORDEM de preferencia declarada pelo operador: "sem WhatsApp -> e-mail confirmado ->
 * ligacao". Esta lista e documental (a decisao vive em `resolverCanalFollowUp`, que precisa
 * saber POR QUE trocou), mas mante-la aqui deixa a ordem visivel num lugar so.
 */
const ORDEM_CANAIS = Object.freeze(['whatsapp', 'email', 'ligacao'])

const CANAIS = new Set(CANAIS_CURAVEIS)
const LIMITE_MOTIVO = 300
const LIMITE_EMAIL = 254

function erroEntrada(message) {
  const err = new Error(message)
  err.statusCode = 400
  return err
}

/**
 * Endereco de e-mail normalizado (aparado e em minusculas) ou erro.
 *
 * Validacao deliberadamente simples e conservadora: um caractere de arroba, algo antes,
 * dominio com ponto, sem espaco e sem quebra de linha (que seria injecao de cabecalho no
 * envio). Nao existe regex que decida se um endereco RECEBE — e por isso que quem confirma
 * e uma pessoa, e nao esta funcao.
 */
function normalizarEmail(valor) {
  const t = String(valor == null ? '' : valor).trim().toLowerCase()
  if (!t) throw erroEntrada('endereco de e-mail e obrigatorio para confirmar o canal.')
  if (t.length > LIMITE_EMAIL) throw erroEntrada(`e-mail excede o limite de ${LIMITE_EMAIL} caracteres.`)
  if (/[\s<>",;\\]/.test(t)) throw erroEntrada('e-mail invalido.')
  if (!/^[^@]+@[^@.]+(\.[^@.]+)+$/.test(t)) throw erroEntrada('e-mail invalido.')
  return t
}

/** Igual a normalizarEmail, mas devolve null em vez de lancar. */
function emailOuNulo(valor) {
  try { return normalizarEmail(valor) } catch { return null }
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
 *
 * `endereco` so' existe no canal que tem endereco, e so' quando o veredito e' POSITIVO:
 *   - `whatsapp` com endereco e' recusado — o "endereco" do WhatsApp e' o proprio telefone,
 *     que ja e' a identidade do contato; aceitar outro campo ali criaria um segundo lugar
 *     dizendo com quem se fala;
 *   - `email` confirmado EXIGE endereco (mesma condicao da CHECK no banco);
 *   - `email` negado descarta o endereco: a negacao e' sobre o contato receber e-mail, nao
 *     sobre um endereco especifico. Guardar um destino junto de "nao tem e-mail" deixaria a
 *     linha se contradizendo.
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

  let endereco = null
  const enderecoInformado = p.endereco != null && String(p.endereco).trim() !== ''
  if (p.canal === 'email') {
    if (p.disponivel) endereco = normalizarEmail(p.endereco)
  } else if (enderecoInformado) {
    throw erroEntrada(`o canal ${p.canal} nao tem endereco proprio: a identidade do contato e o telefone.`)
  }

  return { canal: p.canal, disponivel: p.disponivel, motivo, endereco, origem: 'operador' }
}

/**
 * Aceita o tri-estado vindo da API: true, false ou "nao informado". Nunca coage.
 * `campo` so' existe para a mensagem de erro apontar o campo certo — sao dois hoje
 * (`whatsapp_disponivel` e `email_disponivel`), e um erro generico faria o operador procurar
 * o problema no campo errado.
 */
function disponibilidadeInformada(valor, campo = 'whatsapp_disponivel') {
  if (valor === undefined || valor === null) return undefined
  if (typeof valor !== 'boolean') {
    throw erroEntrada(`${campo} deve ser booleano ou ausente.`)
  }
  return valor
}

/**
 * Endereco de e-mail CONFIRMADO a partir da linha de disponibilidade (ou `null`).
 *
 * Uma linha de e-mail com `disponivel = false` nao confirma nada, e uma linha sem endereco
 * tambem nao — as duas devolvem `null`. E o unico lugar que traduz "linha do banco" em
 * "para onde da para enviar", e ele nunca olha cadastro (ver EMAIL_CANDIDATO).
 */
function enderecoEmailConfirmado(linha) {
  if (!linha || linha.canal !== 'email') return null
  if (linha.disponivel !== true) return null
  return emailOuNulo(linha.endereco)
}

/**
 * A REGRA DE PRIORIDADE DE CANAL, num lugar so.
 *
 * @param {string} canalAtual  canal do follow-up hoje.
 * @param {boolean|null} whatsappDisponivel  true | false | null ("ninguem verificou").
 * @param {string|null} emailConfirmado  endereco confirmado por PESSOA, ou null. Nao e' um
 *   booleano de proposito: sem endereco nao ha canal, entao "tem e-mail" e "para onde" sao a
 *   mesma informacao.
 * @param {boolean|null} emailDisponivel  veredito humano sobre o e-mail (para o caso de o
 *   item JA ser de e-mail e o operador declarar que aquele contato nao recebe e-mail).
 * @returns {{canal: string, trocou: boolean, motivo: string|null}}
 *
 * Ordem, exatamente como decidida com o operador (ORDEM_CANAIS):
 *   1. canal que nao e' WhatsApp nem e-mail (ou seja, ligacao) -> nao mexe. Ligacao e' o
 *      ultimo recurso e sempre possivel: o telefone e' a identidade do contato.
 *   2. WhatsApp disponivel ou nao verificado -> mantem WhatsApp. `null` mantem o
 *      comportamento historico: ausencia de verificacao nunca vira veredito.
 *   3. WhatsApp marcado indisponivel -> e-mail CONFIRMADO, se houver -> ligacao.
 *   4. item ja de e-mail: so' sai de la se uma pessoa declarar que o contato nao recebe
 *      e-mail; nesse caso vai para ligacao, NUNCA de volta para WhatsApp — quem tirou o item
 *      do WhatsApp foi uma decisao registrada, e desfaze-la aqui seria decidir por ela.
 *
 * A funcao NAO recebe "tem telefone?": o contato deste dominio E um telefone
 * (`telefone_digitos` NOT NULL, 8..15 digitos, migration 062). Um parametro que pudesse
 * dizer "nao tem telefone" descreveria um contato que nao existe neste modelo.
 */
function resolverCanalFollowUp(canalAtual, whatsappDisponivel, emailConfirmado = null, emailDisponivel = null) {
  const email = emailOuNulo(emailConfirmado)

  if (canalAtual === 'email') {
    if (emailDisponivel === false) {
      return {
        canal: CANAL_SEM_WHATSAPP,
        trocou: true,
        motivo: 'contato marcado como sem e-mail',
      }
    }
    if (email) return { canal: 'email', trocou: false, motivo: null }
    // Item de e-mail SEM endereco confirmado e' exatamente o defeito que a Decisao 4
    // descreveu: entra na fila e nunca sai, porque nao ha para onde enviar. O banco impede
    // isso dentro de `contato_canal_disponibilidade` (CHECK
    // contato_canal_disp_email_confirmado_chk), mas nao consegue impedir do outro lado — a
    // CHECK de `follow_ups.canal` nao enxerga outra tabela. A regra vive aqui.
    //
    // Alcanca o caso real: `POST /follow-ups/itens` aceita `canal` do corpo, e `email` passou
    // a ser um valor valido em FOLLOWUP_CANAL. Sem esta guarda, bastaria pedir um follow-up
    // de e-mail para um contato sem endereco confirmado para criar um item sem destino.
    return {
      canal: CANAL_SEM_WHATSAPP,
      trocou: true,
      motivo: 'e-mail sem endereco confirmado por uma pessoa',
    }
  }

  if (canalAtual !== 'whatsapp') return { canal: canalAtual, trocou: false, motivo: null }
  if (whatsappDisponivel !== false) return { canal: 'whatsapp', trocou: false, motivo: null }

  if (email) {
    return {
      canal: 'email',
      trocou: true,
      motivo: 'contato marcado como sem WhatsApp, com e-mail confirmado',
    }
  }
  return {
    canal: CANAL_SEM_WHATSAPP,
    trocou: true,
    motivo: 'contato marcado como sem WhatsApp',
  }
}

/** Atalho de leitura: "este follow-up esta num canal que o operador descartou?" */
function canalDescartadoPeloOperador(canal, whatsappDisponivel, emailDisponivel = null) {
  if (canal === 'whatsapp') return whatsappDisponivel === false
  if (canal === 'email') return emailDisponivel === false
  return false
}

module.exports = {
  CANAIS_CURAVEIS,
  ORIGEM_MARCACAO,
  CANAL_SEM_WHATSAPP,
  ORDEM_CANAIS,
  EMAIL_CANAL,
  EMAIL_CANDIDATO,
  LIMITE_MOTIVO,
  LIMITE_EMAIL,
  normalizarEmail,
  emailOuNulo,
  validarMarcacao,
  disponibilidadeInformada,
  enderecoEmailConfirmado,
  resolverCanalFollowUp,
  canalDescartadoPeloOperador,
}
