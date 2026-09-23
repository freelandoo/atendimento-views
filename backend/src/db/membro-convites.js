'use strict'
// Convite de cadastro por LINK — acesso a dados. Migration 096.
//
// O gestor gera um link que carrega PAPEL e, para o comercial, EQUIPE. Quem abre o link cria a
// própria conta (nome, e-mail, data de nascimento, senha) e já entra na empresa, no papel e na
// equipe — tudo numa transação só.
//
// AS REGRAS QUE NÃO SE NEGOCIAM (regras puras em services/cadastro-membro.js)
//  1. **Uso único e 24 horas.** O convite é lido com `FOR UPDATE` na aceitação: dois cliques
//     simultâneos no mesmo link não criam duas contas — o segundo encontra `usado_em` preenchido.
//  2. **E-mail que já tem conta é recusado (409).** O convite nunca reaproveita conta existente:
//     reaproveitar exigiria provar que quem abriu o link é o dono daquela conta, e o link não é
//     preso a e-mail. ⚠️ Desde 2026-09-23 a TELA só cadastra por convite; a rota direta
//     `POST /membros` (que reaproveita conta) continua na API, mas sem botão. Quem já tem conta
//     em outra empresa hoje não entra por aqui — lacuna declarada ao operador.
//  3. **Falhou qualquer passo, o convite NÃO é consumido.** Equipe encerrada, e-mail repetido ou
//     menor de idade devolvem erro e o link continua valendo (até vencer).
//  4. **O banco só vê o hash do token.** Nenhuma leitura devolve `token_hash`.
//  5. **Toda escrita é auditada**, sem e-mail, nome, senha ou token.

const { pool } = require('../db')
const { hashPassword } = require('../auth')
const CM = require('../services/cadastro-membro')
const { papeisConvidaveis, papelExigeEquipe } = require('../services/acesso-capacidades')
const M = require('./membros')
const EQ = require('./equipes-comerciais')
const { logger } = require('../logger')

function erro(mensagem, statusCode = 400, code = 'BAD_REQUEST') {
  const e = new Error(mensagem)
  e.statusCode = statusCode
  e.code = code
  return e
}

async function auditar(client, { empresaId, usuarioId, acao, entidadeId, contexto }) {
  await client.query(
    `INSERT INTO app.auditoria_eventos
       (empresa_id, usuario_id, entidade_tipo, entidade_id, acao, contexto)
     VALUES ($1, $2, 'membro_convite', $3, $4, $5::jsonb)`,
    [empresaId, usuarioId || null, entidadeId || null, acao, JSON.stringify(contexto || {})]
  )
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Nunca seleciona `token_hash`.
const COLS_CONVITE = `
  c.id, c.empresa_id, c.role, c.equipe_id, c.rotulo, c.criado_por, c.criado_em, c.expira_em,
  c.usado_em, c.usado_por_usuario_id, c.revogado_em, c.revogado_por, c.permissoes,
  e.nome AS equipe_nome, uc.nome AS criado_por_nome, uu.nome AS usado_por_nome`

const FROM_CONVITE = `
  FROM app.membro_convites c
  LEFT JOIN app.equipes_comerciais e ON e.id = c.equipe_id AND e.empresa_id = c.empresa_id
  LEFT JOIN app.usuarios uc ON uc.id = c.criado_por
  LEFT JOIN app.usuarios uu ON uu.id = c.usado_por_usuario_id`

function comSituacao(row, agora) {
  return row ? { ...row, situacao: CM.situacaoConvite(row, agora) } : null
}

/**
 * Gera o convite. Devolve o TOKEN em claro uma única vez — é a única hora em que ele existe
 * fora do navegador de quem vai usá-lo.
 */
async function criarConvite(empresaId, dados, autorId, agora = new Date()) {
  const v = CM.validarNovoConvite(dados, { papeisConvidaveis, papelExigeEquipe })
  // Liberações além do papel (migration 098): a MESMA régua do vínculo — só `true`, só
  // capacidade conhecida e só o que o papel ainda não dá. Recusa alto em vez de ignorar.
  const permissoes = M.sanearPermissoes((dados || {}).permissoes, v.role)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (v.equipeId) {
      const { rows } = await client.query(
        `SELECT status FROM app.equipes_comerciais WHERE empresa_id = $1 AND id = $2::uuid`,
        [empresaId, v.equipeId]
      )
      if (!rows[0]) throw erro('Equipe não encontrada nesta empresa.', 404, 'EQUIPE_NAO_ENCONTRADA')
      if (rows[0].status !== 'ativa') throw erro('Esta equipe foi encerrada. Escolha uma equipe ativa.', 409, 'EQUIPE_ENCERRADA')
    }
    const token = CM.gerarTokenConvite()
    const { rows } = await client.query(
      `INSERT INTO app.membro_convites
         (empresa_id, token_hash, role, equipe_id, rotulo, criado_por, expira_em, permissoes)
       VALUES ($1, $2, $3, $4::uuid, $5, $6::uuid, $7, $8::jsonb)
       RETURNING id`,
      [empresaId, CM.hashTokenConvite(token), v.role, v.equipeId, v.rotulo, autorId || null,
        CM.expiracaoConvite(agora), JSON.stringify(permissoes)]
    )
    const id = rows[0].id
    await auditar(client, {
      empresaId, usuarioId: autorId, acao: 'membro_convite_criado', entidadeId: id,
      contexto: { papel: v.role, equipe_id: v.equipeId, permissoes_concedidas: Object.keys(permissoes) },
    })
    await client.query('COMMIT')
    const convite = await obterConvite(empresaId, id, agora)
    return { convite, token }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

async function obterConvite(empresaId, conviteId, agora = new Date()) {
  const { rows } = await pool.query(
    `SELECT ${COLS_CONVITE} ${FROM_CONVITE} WHERE c.empresa_id = $1 AND c.id = $2::uuid LIMIT 1`,
    [empresaId, conviteId]
  )
  return comSituacao(rows[0], agora)
}

/** Os 50 convites mais recentes da empresa, com a situação calculada. */
async function listarConvites(empresaId, agora = new Date()) {
  const { rows } = await pool.query(
    `SELECT ${COLS_CONVITE} ${FROM_CONVITE}
      WHERE c.empresa_id = $1
      ORDER BY c.criado_em DESC
      LIMIT 50`,
    [empresaId]
  )
  return rows.map((r) => comSituacao(r, agora))
}

/** Cancela um convite ainda PENDENTE. Usado, vencido ou já revogado → 409. */
async function revogarConvite(empresaId, conviteId, autorId, agora = new Date()) {
  if (!UUID_RE.test(String(conviteId || ''))) throw erro('Convite não encontrado.', 404, 'NOT_FOUND')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT id, usado_em, revogado_em, expira_em FROM app.membro_convites
        WHERE empresa_id = $1 AND id = $2::uuid FOR UPDATE`,
      [empresaId, conviteId]
    )
    if (!rows[0]) throw erro('Convite não encontrado.', 404, 'NOT_FOUND')
    const situacao = CM.situacaoConvite(rows[0], agora)
    if (situacao !== CM.SITUACAO_CONVITE.PENDENTE) {
      throw erro('Só um convite ainda pendente pode ser cancelado.', 409, 'CONVITE_NAO_PENDENTE')
    }
    await client.query(
      `UPDATE app.membro_convites SET revogado_em = $3, revogado_por = $4::uuid
        WHERE empresa_id = $1 AND id = $2::uuid`,
      [empresaId, conviteId, agora, autorId || null]
    )
    await auditar(client, {
      empresaId, usuarioId: autorId, acao: 'membro_convite_revogado', entidadeId: conviteId, contexto: {},
    })
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
  return obterConvite(empresaId, conviteId, agora)
}

/**
 * O que a página PÚBLICA do convite precisa mostrar. Só o mínimo: nome da empresa, papel e
 * equipe — o bastante para a pessoa saber onde está entrando. Link que não serve devolve só a
 * situação, sem dizer de qual empresa era.
 */
async function lerConvitePublico(token, agora = new Date()) {
  const hash = CM.hashTokenConvite(token)
  if (!hash) return { situacao: 'inexistente' }
  const { rows } = await pool.query(
    `SELECT c.role, c.rotulo, c.expira_em, c.usado_em, c.revogado_em,
            emp.nome AS empresa_nome, e.nome AS equipe_nome
       FROM app.membro_convites c
       JOIN app.empresas emp ON emp.id = c.empresa_id
       LEFT JOIN app.equipes_comerciais e ON e.id = c.equipe_id AND e.empresa_id = c.empresa_id
      WHERE c.token_hash = $1
      LIMIT 1`,
    [hash]
  )
  const c = rows[0]
  if (!c) return { situacao: 'inexistente' }
  const situacao = CM.situacaoConvite(c, agora)
  if (situacao !== CM.SITUACAO_CONVITE.PENDENTE) return { situacao }
  return {
    situacao,
    empresa_nome: c.empresa_nome,
    papel: c.role,
    equipe_nome: c.equipe_nome || null,
    // O nome que o gestor digitou ao gerar o link — vem PREENCHIDO no formulário, e a pessoa
    // corrige se quiser. É o nome dela, entregue a quem tem o link dela.
    nome_sugerido: c.rotulo || '',
    expira_em: c.expira_em,
  }
}

/**
 * A pessoa aceita o convite: cria a conta, o vínculo e a entrada na equipe, e consome o link.
 * Uma transação só — qualquer recusa deixa o link valendo.
 *
 * @param {string} token
 * @param {object} dados  { nome, email, senha, data_nascimento }
 * @param {{ agora?: Date, hojeIso: string }} opcoes
 * @returns {Promise<{ usuario: any, empresaId: string }>}
 */
async function aceitarConvite(token, dados, { agora = new Date(), hojeIso }) {
  const hash = CM.hashTokenConvite(token)
  if (!hash) throw erro(CM.MENSAGEM_LINK_INVALIDO.inexistente, 404, 'CONVITE_INVALIDO')
  const pessoa = CM.validarDadosPessoais(dados, hojeIso)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // FOR UPDATE: dois envios simultâneos do mesmo link serializam aqui, e o segundo encontra
    // o convite já usado.
    const { rows } = await client.query(
      `SELECT id, empresa_id, role, equipe_id, criado_por, expira_em, usado_em, revogado_em, permissoes
         FROM app.membro_convites WHERE token_hash = $1 FOR UPDATE`,
      [hash]
    )
    const convite = rows[0]
    if (!convite) throw erro(CM.MENSAGEM_LINK_INVALIDO.inexistente, 404, 'CONVITE_INVALIDO')
    const situacao = CM.situacaoConvite(convite, agora)
    if (situacao !== CM.SITUACAO_CONVITE.PENDENTE) {
      throw erro(CM.MENSAGEM_LINK_INVALIDO[situacao], 410, 'CONVITE_INDISPONIVEL')
    }

    const { rows: existe } = await client.query(
      'SELECT 1 FROM app.usuarios WHERE email = $1 LIMIT 1', [pessoa.email]
    )
    if (existe[0]) {
      throw erro(
        'Este e-mail já tem uma conta no sistema. Use outro e-mail, ou avise quem te convidou.',
        409, 'EMAIL_EXISTS'
      )
    }

    const password_hash = await hashPassword(pessoa.senha)
    let usuario
    try {
      // Papel GLOBAL sempre 'user' — o papel que vale é o do vínculo (Etapa 1).
      const r = await client.query(
        `INSERT INTO app.usuarios (email, nome, password_hash, role, data_nascimento)
         VALUES ($1, $2, $3, 'user', $4::date)
         RETURNING id, nome, email, role, ativo`,
        [pessoa.email, pessoa.nome, password_hash, pessoa.dataNascimento]
      )
      usuario = r.rows[0]
    } catch (e) {
      if (e && e.code === '23505') throw erro('Este e-mail já tem uma conta.', 409, 'EMAIL_EXISTS')
      throw e
    }

    // O autor do vínculo é quem GEROU o convite: foi a decisão dele que deu o papel e a equipe.
    await M.inserirVinculoEmTx(client, {
      empresaId: convite.empresa_id,
      usuario,
      role: convite.role,
      // Revalidadas contra o papel AGORA: a matriz pode ter mudado desde que o link foi gerado,
      // e uma concessão que o papel passou a incluir seria só ruído no vínculo.
      permissoes: M.sanearPermissoesExistentes(convite.permissoes, convite.role),
      autorId: convite.criado_por,
      reusou: false,
      contextoExtra: { origem: 'convite', convite_id: convite.id },
    })

    if (convite.equipe_id) {
      await EQ.adicionarParticipanteEmTx(client, convite.empresa_id, convite.equipe_id, usuario.id, convite.criado_por)
    }

    await client.query(
      `UPDATE app.membro_convites SET usado_em = $2, usado_por_usuario_id = $3::uuid WHERE id = $1`,
      [convite.id, agora, usuario.id]
    )
    await auditar(client, {
      empresaId: convite.empresa_id, usuarioId: usuario.id, acao: 'membro_convite_usado',
      entidadeId: convite.id, contexto: { papel: convite.role, equipe_id: convite.equipe_id },
    })

    await client.query('COMMIT')
    logger.info({ empresa_id: convite.empresa_id, papel: convite.role }, '[membro-convites] convite aceito')
    return { usuario, empresaId: convite.empresa_id }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

module.exports = {
  criarConvite,
  obterConvite,
  listarConvites,
  revogarConvite,
  lerConvitePublico,
  aceitarConvite,
}
