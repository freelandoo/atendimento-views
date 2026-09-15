'use strict'
// Telefone do lead informado por uma PESSOA (o "+ telefone" da listagem do Banco de Leads).
//
// POR QUE ISTO NAO E' UM `atualizarEmailProspect` COM OUTRO NOME. E-mail e' um atributo do
// cadastro; telefone e' a IDENTIDADE do contato em todo o sistema — follow-ups e disponibilidade
// de canal sao chaveados por `empresa_id + telefone_digitos` (migrations 062/066), a agenda casa
// reuniao por telefone, o wa.me e o disparo saem dele e `vendas.conversas.numero` e' UNIQUE
// GLOBAL. Trocar o numero de um lead nao e' corrigir um campo: e' dizer que o contato e' outro.
//
// MODULO PURO: sem banco, sem HTTP, sem IA, sem rede. Ele nao escreve nada — devolve o veredito
// e as CONSEQUENCIAS que quem tem o banco na mao deve aplicar.

/** Motivos de recusa — lista FECHADA, e' o vocabulario que a rota devolve. */
const MOTIVOS = Object.freeze({
  CURTO: 'curto',
  LONGO: 'longo',
  JA_ABORDADO: 'ja_abordado',
  EM_USO: 'em_uso',
})

const MENSAGEM = Object.freeze({
  [MOTIVOS.CURTO]: 'Telefone invalido — informe DDD + numero.',
  [MOTIVOS.LONGO]: 'Telefone invalido — numero longo demais.',
  [MOTIVOS.JA_ABORDADO]: 'Este lead ja foi abordado por este numero. Nao da para apagar o telefone — corrija digitando o numero certo.',
  [MOTIVOS.EM_USO]: 'Este numero ja pertence a outro lead desta empresa.',
})

/** So' digitos. Vazio vira '' (pedido de LIMPAR), nunca null, para o chamador distinguir. */
function normalizarTelefoneLead(valor) {
  return String(valor == null ? '' : valor).replace(/\D/g, '').slice(0, 20)
}

/**
 * O numero digitado serve?
 *
 * Os limites sao os mesmos que o cadastro manual ja aplicava (`POST /leads`): 10 digitos e' DDD +
 * numero; 15 e' o teto do E.164. Repetir a regra aqui e' de proposito — as duas portas escrevem
 * a MESMA coluna, e uma porta mais frouxa que a outra deixaria entrar pelo lado o que a primeira
 * recusa.
 */
function validarTelefoneLead(digitos, { jaAbordado = false } = {}) {
  const tel = normalizarTelefoneLead(digitos)
  if (!tel) {
    // Limpar o telefone de um lead ja abordado orfaria a conversa, o follow-up e a reuniao que
    // foram criados COM aquele numero. Corrigir (digitar outro) continua permitido.
    if (jaAbordado) return { ok: false, motivo: MOTIVOS.JA_ABORDADO, mensagem: MENSAGEM[MOTIVOS.JA_ABORDADO] }
    return { ok: true, telefone: null, limpando: true }
  }
  if (tel.length < 10) return { ok: false, motivo: MOTIVOS.CURTO, mensagem: MENSAGEM[MOTIVOS.CURTO] }
  if (tel.length > 15) return { ok: false, motivo: MOTIVOS.LONGO, mensagem: MENSAGEM[MOTIVOS.LONGO] }
  return { ok: true, telefone: tel, limpando: false }
}

/**
 * O que mais muda quando o numero muda.
 *
 * `tem_whatsapp` e' cache de um veredito sobre um NUMERO, nao sobre o lead: ele nasce `false`
 * quando o Evolution respondeu `exists:false` para o numero ANTIGO (services/rodar-leads.js).
 * Carregar esse `false` para o numero novo manteria o lead em "Descartados" e fora da
 * elegibilidade — o operador corrigiria o telefone e o lead continuaria morto, sem nada na tela
 * explicando por que. Numero novo volta a ser "ninguem verificou" (NULL), que e' o terceiro
 * estado que o projeto ja usa (ver contato-canal-disponibilidade).
 *
 * O status so' PROMOVE (`coletado` → `contato_encontrado`), nunca rebaixa: e' a mesma transicao
 * que `POST /leads` aplica ao cadastrar com telefone. Rebaixar aqui apagaria trabalho humano.
 */
function efeitosDaTrocaDeTelefone({ telefoneAtual, telefoneNovo, status }) {
  const atual = normalizarTelefoneLead(telefoneAtual)
  const novo = normalizarTelefoneLead(telefoneNovo)
  const mudou = atual !== novo
  return {
    mudou,
    resetarTemWhatsapp: mudou,
    statusNovo: novo && status === 'coletado' ? 'contato_encontrado' : null,
  }
}

module.exports = {
  MOTIVOS,
  MENSAGEM,
  normalizarTelefoneLead,
  validarTelefoneLead,
  efeitosDaTrocaDeTelefone,
}
