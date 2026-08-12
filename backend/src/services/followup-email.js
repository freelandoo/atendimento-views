'use strict'
// EXECUTOR DO CANAL DE E-MAIL DO FOLLOW-UP (migration 067).
//
// Por que este arquivo existe: ate a migration 067 o canal `email` era PROIBIDO, e o motivo
// estava escrito na Decisao 4 de 2026-08-12 — "nenhuma tela sabe EXECUTAR um follow-up de
// e-mail; criar o valor sem o executor produziria itens que entram na fila e nunca saem
// dela". Este modulo e o executor que faltava. O canal e o executor nasceram no mesmo diff
// de proposito: um sem o outro e exatamente o defeito que a decisao previu.
//
// COMO ELE EXECUTA (e por que assim):
//   O item de e-mail abre um COMPOSITOR na propria Central de Follow-ups — assunto e corpo,
//   com rascunho pronto — e o operador revisa antes de enviar. E a mesma disciplina do
//   follow-up manual de WhatsApp (gerar -> revisar -> enviar), e o motivo e o mesmo: e-mail
//   e mensagem para um cliente real. NAO ha geracao por IA aqui: o rascunho e deterministico,
//   montado a partir do que ja esta no item (a proxima acao combinada e a observacao). Um
//   canal novo nao precisa estrear com custo de LLM por clique.
//
// O QUE ELE NAO FAZ, de proposito:
//   - nao roda sozinho. Nenhum worker envia e-mail de follow-up: o canal nasceu de uma
//     decisao humana ("este contato nao tem WhatsApp, mas tem este e-mail") e continua sendo
//     executado por uma pessoa. Automatizar o disparo seria outra decisao de produto;
//   - nao descobre endereco. O destinatario e SEMPRE o e-mail confirmado em
//     `app.contato_canal_disponibilidade` (origem 'operador'). O e-mail do cadastro e
//     candidato — sugerido na tela, nunca usado como destino sem confirmacao;
//   - nao inventa canal. Se o item nao e de e-mail, ou ja foi fechado, o envio e recusado.

const { pool: poolPadrao } = require('../db')
const { logger } = require('../logger')
const F = require('../db/follow-ups')
const E = require('../db/follow-up-emails')
const D = require('../db/contato-canal-disponibilidade')
const { emailConfigurado, enviarViaProvider } = require('./email-outreach')

// Status de uma tentativa de envio (CHECK follow_up_emails_status_chk, migration 067).
// REEXPORTADO do modulo puro — duplicar o array aqui criaria o drift que domain-enums existe
// para impedir.
const { FOLLOWUP_EMAIL_STATUS } = require('./follow-up-modelo')

/**
 * Por que um envio foi recusado. Vocabulario fechado: a tela precisa dizer O QUE FAZER, e
 * "nao foi possivel enviar" nao diz. Cada motivo tem uma saida diferente para o operador.
 */
const MOTIVO_BLOQUEIO = Object.freeze({
  CANAL_ERRADO: 'canal_errado',
  ITEM_FECHADO: 'item_fechado',
  SEM_EMAIL_CONFIRMADO: 'sem_email_confirmado',
  CANAL_DESATIVADO: 'canal_email_desativado',
})

const MENSAGEM_BLOQUEIO = Object.freeze({
  [MOTIVO_BLOQUEIO.CANAL_ERRADO]: 'Este follow-up nao e do canal de e-mail.',
  [MOTIVO_BLOQUEIO.ITEM_FECHADO]: 'Este follow-up nao esta mais em aberto.',
  [MOTIVO_BLOQUEIO.SEM_EMAIL_CONFIRMADO]:
    'Este contato nao tem e-mail confirmado. Confirme um endereco no reagendamento antes de enviar.',
  [MOTIVO_BLOQUEIO.CANAL_DESATIVADO]:
    'O canal de e-mail nao esta configurado neste ambiente (EMAIL_PROVIDER_API_URL, EMAIL_PROVIDER_API_KEY e EMAIL_FROM).',
})

const LIMITE_ASSUNTO = 200
const LIMITE_CORPO = 20000

function erro(message, statusCode = 400, code = null) {
  const err = new Error(message)
  err.statusCode = statusCode
  if (code) err.code = code
  return err
}

function erroBloqueio(motivo, statusCode = 409) {
  return erro(MENSAGEM_BLOQUEIO[motivo] || 'Envio bloqueado.', statusCode, motivo)
}

/**
 * Valida o conteudo escrito/revisado pelo operador.
 *
 * O assunto recusa quebra de linha por seguranca, nao por estetica: `\r`/`\n` num campo que
 * vira cabecalho de e-mail e injecao de cabecalho (o provider recebe `subject` como campo
 * proprio). Corpo e assunto sao obrigatorios — um e-mail sem assunto chega como suspeito, e
 * um sem corpo nao e mensagem.
 */
function validarConteudoEmail(p = {}) {
  const assunto = String(p.assunto == null ? '' : p.assunto).trim()
  if (!assunto) throw erro('assunto e obrigatorio.')
  if (assunto.length > LIMITE_ASSUNTO) throw erro(`assunto excede o limite de ${LIMITE_ASSUNTO} caracteres.`)
  if (/[\r\n]/.test(assunto)) throw erro('assunto nao pode ter quebra de linha.')

  const corpo = String(p.corpo == null ? '' : p.corpo).trim()
  if (!corpo) throw erro('corpo do e-mail e obrigatorio.')
  if (corpo.length > LIMITE_CORPO) throw erro(`corpo excede o limite de ${LIMITE_CORPO} caracteres.`)
  return { assunto, corpo }
}

/**
 * Rascunho DETERMINISTICO do e-mail, a partir do que ja foi combinado no item.
 *
 * Nao chama IA (ver cabecalho) e nao inventa promessa comercial: usa a proxima acao, a
 * observacao do item e o nome do contato quando existe. O operador reescreve o que quiser —
 * o rascunho existe para o compositor nao abrir em branco.
 */
function montarRascunhoEmail(item = {}, { nome = null, empresa = null } = {}) {
  const acao = String(item.proxima_acao || '').trim()
  const observacao = String(item.observacao || '').trim()
  const linhas = [nome ? `Ola, ${nome}!` : 'Ola!', '']
  if (acao) linhas.push(acao, '')
  if (observacao) linhas.push(observacao, '')
  linhas.push('Fico no aguardo.')
  if (empresa) linhas.push('', empresa)
  return {
    assunto: acao ? acao.slice(0, LIMITE_ASSUNTO) : 'Retomando nosso contato',
    corpo: linhas.join('\n').trim(),
  }
}

/**
 * Corpo em texto -> HTML seguro para o provider (que recebe `html`).
 *
 * Escapa antes de converter quebras de linha: o texto vem de um campo livre, e um `<` no meio
 * de uma frase nao pode virar marcacao. E puro e testado — a alternativa (mandar o texto cru)
 * quebraria o e-mail no primeiro sinal de maior/menor que alguem digitasse.
 */
function corpoParaHtml(texto) {
  const escapado = String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  return escapado.split(/\r?\n/).join('<br>')
}

/** O item esta apto a ser executado por e-mail? Devolve o motivo, nunca um booleano mudo. */
function bloqueioDoItem(item) {
  if (!item || item.canal !== 'email') return MOTIVO_BLOQUEIO.CANAL_ERRADO
  if (item.status !== 'aguardando') return MOTIVO_BLOQUEIO.ITEM_FECHADO
  return null
}

/**
 * Tudo o que o compositor precisa para abrir: destinatario confirmado, rascunho, candidatos
 * do cadastro e o estado do canal. NAO envia nada e nao grava nada.
 */
async function prepararEnvioEmail({ pool = poolPadrao, empresaId, followUpId } = {}) {
  const item = await F.obterFollowUp(pool, empresaId, followUpId)
  const [destinatario, candidatos] = await Promise.all([
    D.emailConfirmadoDoContato(pool, empresaId, item.telefone_digitos),
    E.listarCandidatosDeEmail(pool, empresaId, item.telefone_digitos),
  ])
  const bloqueio = bloqueioDoItem(item)
    || (destinatario ? null : MOTIVO_BLOQUEIO.SEM_EMAIL_CONFIRMADO)
    || (emailConfigurado() ? null : MOTIVO_BLOQUEIO.CANAL_DESATIVADO)
  return {
    item,
    destinatario,
    // Candidatos sao SUGESTAO de endereco para confirmar — nunca destino. Ver EMAIL_CANDIDATO
    // em services/contato-canal-disponibilidade.js.
    candidatos,
    canal_configurado: emailConfigurado(),
    bloqueio,
    bloqueio_mensagem: bloqueio ? MENSAGEM_BLOQUEIO[bloqueio] : null,
    rascunho: montarRascunhoEmail(item),
  }
}

/**
 * Envia o e-mail revisado pelo operador e CONCLUI o item.
 *
 * A ordem importa: envia primeiro (chamada externa, irreversivel), grava o registro depois.
 * Se o provider falhar, a tentativa e registrada como `falhou` e o item CONTINUA em aberto —
 * o trabalho nao pode desaparecer da fila por causa de uma falha de transporte.
 *
 * Concluir faz parte do envio porque, neste canal, enviar E a acao. Deixar o item aberto
 * depois de o e-mail sair devolveria a fila ao problema que a Decisao 4 apontou: item que
 * entra e nao sai. A conclusao usa `mudarStatusFollowUp` (o mesmo caminho do botao
 * "Concluir"), nunca um UPDATE proprio; se ela falhar, o e-mail JA saiu e o erro so' e
 * registrado — o operador conclui a mao.
 */
async function enviarEmailFollowUp({ pool = poolPadrao, empresaId, followUpId, assunto, corpo, usuarioId = null } = {}) {
  const item = await F.obterFollowUp(pool, empresaId, followUpId)
  const bloqueio = bloqueioDoItem(item)
  if (bloqueio) throw erroBloqueio(bloqueio)

  const destinatario = await D.emailConfirmadoDoContato(pool, empresaId, item.telefone_digitos)
  if (!destinatario) throw erroBloqueio(MOTIVO_BLOQUEIO.SEM_EMAIL_CONFIRMADO)
  // Recusa ANTES de compor: sem credencial nada sai, e gravar um "envio" que nao aconteceu
  // faria a linha do tempo do contato mentir. O item continua na fila.
  if (!emailConfigurado()) throw erroBloqueio(MOTIVO_BLOQUEIO.CANAL_DESATIVADO, 409)

  const conteudo = validarConteudoEmail({ assunto, corpo })

  let providerId = null
  try {
    providerId = await enviarViaProvider({
      para: destinatario, assunto: conteudo.assunto, corpo: corpoParaHtml(conteudo.corpo),
    })
  } catch (err) {
    await E.registrarEnvio(pool, empresaId, {
      follow_up_id: item.id, telefone_digitos: item.telefone_digitos, destinatario,
      assunto: conteudo.assunto, corpo: conteudo.corpo, status: 'falhou',
      erro: String(err && err.message ? err.message : err).slice(0, 400), usuarioId,
    })
    logger.error({ empresa_id: empresaId, follow_up_id: item.id }, '[followup-email] envio falhou')
    throw erro('Nao foi possivel enviar o e-mail agora. A tentativa ficou registrada e o follow-up continua em aberto.', 502, 'EMAIL_ENVIO_FALHOU')
  }

  const envio = await E.registrarEnvio(pool, empresaId, {
    follow_up_id: item.id, telefone_digitos: item.telefone_digitos, destinatario,
    assunto: conteudo.assunto, corpo: conteudo.corpo, status: 'enviado', provider_id: providerId, usuarioId,
  })

  let followUp = item
  let conclusaoErro = null
  try {
    followUp = await F.mudarStatusFollowUp(pool, empresaId, item.id, {
      status: 'concluido', nota: `E-mail enviado para ${destinatario}: ${conteudo.assunto}`,
    }, { usuarioId })
  } catch (err) {
    conclusaoErro = 'O e-mail foi enviado, mas o follow-up nao pode ser concluido automaticamente. Conclua o item na fila.'
    logger.error({ empresa_id: empresaId, follow_up_id: item.id, err: err?.message }, '[followup-email] enviado; conclusao falhou')
  }

  return { envio, follow_up: followUp, conclusao_erro: conclusaoErro }
}

module.exports = {
  FOLLOWUP_EMAIL_STATUS,
  MOTIVO_BLOQUEIO,
  MENSAGEM_BLOQUEIO,
  LIMITE_ASSUNTO,
  LIMITE_CORPO,
  validarConteudoEmail,
  montarRascunhoEmail,
  corpoParaHtml,
  bloqueioDoItem,
  prepararEnvioEmail,
  enviarEmailFollowUp,
}
