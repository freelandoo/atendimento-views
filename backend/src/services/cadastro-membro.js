// @ts-check
'use strict'
// Cadastro de MEMBRO da empresa — regras PURAS (sem banco, HTTP, IA ou rede).
//
// Serve as DUAS portas por onde uma pessoa entra numa empresa, e é o que as mantém iguais:
//  1. o cadastro DIRETO, em Configurações › Contas da empresa (`POST .../membros`);
//  2. o LINK DE CONVITE (`/convite/<token>`), que a própria pessoa preenche.
// Duas regras de senha ou de idade fariam o mesmo papel nascer com exigências diferentes
// dependendo de quem digitou.
//
// ─── AS REGRAS (operador, 2026-09-23) ─────────────────────────────────────────────────────
//  - Senha: no mínimo 8 caracteres, com pelo menos UMA LETRA e UM NÚMERO. Vale nas duas portas.
//  - Data de nascimento é obrigatória, e quem tem menos de 18 anos é RECUSADO. É a mesma régua
//    da declaração de maioridade do termo do programa (migration 084) — que continua sendo pedida
//    depois, porque ela é a assinatura das regras, não um dado de cadastro.
//  - O convite vale 24 horas e é de USO ÚNICO. Ele NÃO é preso a um e-mail: quem abrir o link
//    se cadastra com o e-mail que quiser. Por isso ele morre no primeiro uso e pode ser revogado.
//  - E-mail que já tem conta no sistema é RECUSADO pelo convite (409). A tela orienta a usar o
//    "Adicionar pessoa" direto, que reaproveita a conta sem mexer na senha dela.
//
// ─── O TOKEN ──────────────────────────────────────────────────────────────────────────────
// 32 bytes aleatórios em base64url. O banco guarda só o SHA-256 dele: quem ler a tabela não
// consegue montar um link válido. Consequência declarada: o link só pode ser COPIADO no momento
// em que é gerado — depois, a tela mostra o convite, mas não o link.

const crypto = require('node:crypto')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SENHA_MIN = 8
const IDADE_MINIMA = 18
const IDADE_MAXIMA = 120 // acima disso é erro de digitação, não uma pessoa
const CONVITE_VALIDADE_HORAS = 24
const ROTULO_MAX = 120

/** Situação de um convite. Vocabulário FECHADO — a tela traduz, não deduz. */
const SITUACAO_CONVITE = Object.freeze({
  PENDENTE: 'pendente',
  USADO: 'usado',
  REVOGADO: 'revogado',
  EXPIRADO: 'expirado',
})

function erro(mensagem, statusCode = 400, code = 'BAD_REQUEST') {
  const e = /** @type {Error & {statusCode?: number, code?: string}} */ (new Error(mensagem))
  e.statusCode = statusCode
  e.code = code
  return e
}

function normalizarEmail(v) {
  return String(v == null ? '' : v).trim().toLowerCase()
}

/** Texto da regra, para a tela escrever EXATAMENTE o que o servidor cobra. */
const REGRA_SENHA = `Mínimo de ${SENHA_MIN} caracteres, com pelo menos uma letra e um número.`

/** @returns {string|null} o motivo da recusa, ou null quando a senha serve */
function problemaDaSenha(senha) {
  const s = String(senha == null ? '' : senha)
  if (s.length < SENHA_MIN) return `A senha precisa ter no mínimo ${SENHA_MIN} caracteres.`
  if (!/\p{L}/u.test(s)) return 'A senha precisa ter pelo menos uma letra.'
  if (!/\d/.test(s)) return 'A senha precisa ter pelo menos um número.'
  return null
}

function validarSenha(senha) {
  const problema = problemaDaSenha(senha)
  if (problema) throw erro(problema, 400, 'SENHA_FRACA')
  return String(senha)
}

/**
 * Idade em anos completos numa data de referência. Tudo em UTC e por componentes, para o fuso
 * do servidor nunca mudar o aniversário de dia.
 */
function idadeEm(nascimentoIso, hojeIso) {
  const [an, mn, dn] = nascimentoIso.split('-').map(Number)
  const [ah, mh, dh] = hojeIso.split('-').map(Number)
  let idade = ah - an
  if (mh < mn || (mh === mn && dh < dn)) idade -= 1
  return idade
}

/**
 * Valida a data de nascimento (`AAAA-MM-DD`) e a maioridade.
 *
 * Data impossível é RECUSADA, nunca normalizada: `new Date('2000-02-31')` vira 2 de março em
 * silêncio, e a pessoa ficaria cadastrada com um aniversário que não é o dela.
 *
 * @param {unknown} valor
 * @param {string} hojeIso  a data de hoje, `AAAA-MM-DD` (injetada: o módulo não lê relógio)
 * @returns {{ data: string, idade: number }}
 */
function validarDataNascimento(valor, hojeIso) {
  const s = String(valor == null ? '' : valor).trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) throw erro('Informe a data de nascimento.', 400, 'NASCIMENTO_INVALIDO')
  const [a, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const d = new Date(Date.UTC(a, mes - 1, dia))
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    throw erro('Data de nascimento inválida.', 400, 'NASCIMENTO_INVALIDO')
  }
  if (s > hojeIso) throw erro('A data de nascimento não pode estar no futuro.', 400, 'NASCIMENTO_INVALIDO')
  const idade = idadeEm(s, hojeIso)
  if (idade > IDADE_MAXIMA) throw erro('Data de nascimento inválida.', 400, 'NASCIMENTO_INVALIDO')
  if (idade < IDADE_MINIMA) {
    throw erro(`O cadastro é só para maiores de ${IDADE_MINIMA} anos.`, 400, 'MENOR_DE_IDADE')
  }
  return { data: s, idade }
}

/**
 * Os dados que a PESSOA preenche (no convite) ou que o gestor preenche (cadastro direto de
 * conta nova). Devolve os valores normalizados ou lança 400 com a mensagem para o formulário.
 */
function validarDadosPessoais(dados, hojeIso) {
  const b = dados || {}
  const nome = String(b.nome == null ? '' : b.nome).trim()
  const email = normalizarEmail(b.email)
  if (nome.length < 2) throw erro('Nome obrigatório (mínimo 2 caracteres).')
  if (nome.length > 120) throw erro('Nome muito longo (máximo 120 caracteres).')
  if (!EMAIL_RE.test(email)) throw erro('E-mail inválido.')
  const senha = validarSenha(b.senha)
  const { data: dataNascimento } = validarDataNascimento(b.data_nascimento, hojeIso)
  return { nome, email, senha, dataNascimento }
}

// ─── Convite ──────────────────────────────────────────────────────────────────────────────

function gerarTokenConvite() {
  return crypto.randomBytes(32).toString('base64url')
}

/** Só o hash vai para o banco. Token malformado vira `null` — nunca uma consulta. */
function hashTokenConvite(token) {
  const t = String(token == null ? '' : token).trim()
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(t)) return null
  return crypto.createHash('sha256').update(t).digest('hex')
}

/** Quando o convite gerado agora expira. */
function expiracaoConvite(agora) {
  return new Date(agora.getTime() + CONVITE_VALIDADE_HORAS * 60 * 60 * 1000)
}

/**
 * Em que pé está o convite. A ORDEM importa: usado e revogado são fatos que não mudam com o
 * tempo, então vêm antes do relógio — um convite usado ontem não passa a "expirado" hoje.
 */
function situacaoConvite(convite, agora) {
  const c = convite || {}
  if (c.usado_em) return SITUACAO_CONVITE.USADO
  if (c.revogado_em) return SITUACAO_CONVITE.REVOGADO
  const expira = c.expira_em ? new Date(c.expira_em) : null
  if (!expira || Number.isNaN(expira.getTime()) || expira.getTime() <= agora.getTime()) {
    return SITUACAO_CONVITE.EXPIRADO
  }
  return SITUACAO_CONVITE.PENDENTE
}

/** Mensagem para quem abriu um link que não serve mais. Não diz nada sobre a empresa. */
const MENSAGEM_LINK_INVALIDO = Object.freeze({
  [SITUACAO_CONVITE.USADO]: 'Este link de cadastro já foi usado. Peça um novo link a quem te convidou.',
  [SITUACAO_CONVITE.REVOGADO]: 'Este link de cadastro foi cancelado. Peça um novo link a quem te convidou.',
  [SITUACAO_CONVITE.EXPIRADO]: `Este link de cadastro venceu (ele vale ${CONVITE_VALIDADE_HORAS} horas). Peça um novo link a quem te convidou.`,
  inexistente: 'Link de cadastro inválido. Confira se ele foi copiado inteiro.',
})

/**
 * O pedido de convite feito pelo gestor. A regra de papel vem de `acesso-capacidades.js` —
 * este módulo recebe as duas perguntas como funções para não comparar papel com literal.
 *
 * @param {object} dados  { role, equipe_id?, rotulo? }
 * @param {{ papeisConvidaveis: () => string[], papelExigeEquipe: (p: string) => boolean }} regras
 */
function validarNovoConvite(dados, regras) {
  const b = dados || {}
  const role = String(b.role == null ? '' : b.role)
  const convidaveis = regras.papeisConvidaveis()
  if (!convidaveis.includes(role)) {
    throw erro(`Papel inválido para convite. Use um de: ${convidaveis.join(', ')}.`)
  }
  const equipeId = b.equipe_id == null || b.equipe_id === '' ? null : String(b.equipe_id)
  if (equipeId && !/^[0-9a-f-]{36}$/i.test(equipeId)) throw erro('Equipe inválida.')
  if (regras.papelExigeEquipe(role) && !equipeId) {
    throw erro('Escolha a equipe: quem entra como comercial precisa começar numa equipe.', 400, 'EQUIPE_OBRIGATORIA')
  }
  const rotulo = String(b.rotulo == null ? '' : b.rotulo).trim()
  if (rotulo.length > ROTULO_MAX) throw erro(`Identificação muito longa (máximo ${ROTULO_MAX} caracteres).`)
  return { role, equipeId, rotulo: rotulo || null }
}

module.exports = {
  EMAIL_RE,
  SENHA_MIN,
  IDADE_MINIMA,
  CONVITE_VALIDADE_HORAS,
  REGRA_SENHA,
  SITUACAO_CONVITE,
  MENSAGEM_LINK_INVALIDO,
  normalizarEmail,
  problemaDaSenha,
  validarSenha,
  idadeEm,
  validarDataNascimento,
  validarDadosPessoais,
  gerarTokenConvite,
  hashTokenConvite,
  expiracaoConvite,
  situacaoConvite,
  validarNovoConvite,
}
