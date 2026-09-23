// @ts-check
'use strict'
// Link de cadastro — rotas PÚBLICAS (sem login). Migration 096.
//
// São as únicas rotas deste produto que criam conta dentro de uma empresa sem ninguém logado,
// e por isso fazem o mínimo:
//  - GET  /:token          → diz se o link serve e, só se servir, empresa/papel/equipe.
//  - POST /:token/aceitar  → cria a conta e devolve a sessão (mesmo formato do login).
//
// O QUE PROTEGE ESTA PORTA (e não é o login, porque ele não existe aqui)
//  - O TOKEN: 32 bytes aleatórios, uso único, 24 horas, revogável pelo gestor. O banco guarda só
//    o hash (`services/cadastro-membro.js`).
//  - O limite por IP: sem ele, a rota viraria um oráculo para testar tokens.
//  - O papel vem do CONVITE, nunca do corpo: nada que a pessoa envie muda papel, equipe ou empresa.
//
// Link que não serve responde sem dizer de qual empresa era — quem tem um link vencido não
// precisa saber mais nada sobre ele.

const { Router } = require('express')
const { signJwt } = require('../auth')
const { updateUltimoLogin, listEmpresasDoUsuario } = require('../db/usuarios')
const CONV = require('../db/membro-convites')
const CM = require('../services/cadastro-membro')
const { diaOperacional } = require('../services/plano-dia')
const { criarLimiter } = require('../rate-limit')
const { logger } = require('../logger')

const router = Router()

/** @param {any} res @param {any} err @param {string} code @param {string} padrao */
function envelopeErro(res, err, code, padrao) {
  const status = err?.statusCode || 500
  if (status >= 500) logger.error({ err: err?.message, code }, '[api-convites] falha')
  const message = status >= 500 ? padrao : (err?.message || 'Dados inválidos.')
  return res.status(status).json({ ok: false, error: { code: err?.code || code, message } })
}

// Leitura: abrir o link algumas vezes é normal (recarregar, voltar). Aceite: poucas tentativas —
// cada erro de formulário conta, e 20 por hora é folga larga para uma pessoa só.
const leituraLimiter = criarLimiter({ windowMs: 15 * 60 * 1000, max: 60 })
const aceiteLimiter = criarLimiter({ windowMs: 60 * 60 * 1000, max: 20 })

router.get('/:token', leituraLimiter, async (req, res) => {
  try {
    const data = await CONV.lerConvitePublico(req.params.token)
    if (data.situacao !== CM.SITUACAO_CONVITE.PENDENTE) {
      return res.status(data.situacao === 'inexistente' ? 404 : 410).json({
        ok: false,
        error: { code: 'CONVITE_INDISPONIVEL', message: CM.MENSAGEM_LINK_INVALIDO[data.situacao] },
      })
    }
    return res.json({
      ok: true,
      data: {
        ...data,
        senha_regra: CM.REGRA_SENHA,
        idade_minima: CM.IDADE_MINIMA,
      },
    })
  } catch (err) {
    return envelopeErro(res, err, 'INTERNAL', 'Não foi possível abrir o convite.')
  }
})

router.post('/:token/aceitar', aceiteLimiter, async (req, res) => {
  try {
    const b = req.body || {}
    const { usuario, empresaId } = await CONV.aceitarConvite(req.params.token, {
      nome: b.nome, email: b.email, senha: b.senha, data_nascimento: b.data_nascimento,
    }, { hojeIso: diaOperacional() })

    await updateUltimoLogin(usuario.id).catch(() => null)
    const token = signJwt({ sub: usuario.id, role: usuario.role })
    const empresas = await listEmpresasDoUsuario(usuario.id).catch(() => [])
    return res.status(201).json({
      ok: true,
      data: {
        token,
        usuario: { id: usuario.id, email: usuario.email, nome: usuario.nome, role: usuario.role },
        empresas,
        // A empresa do convite, para a tela abrir nela mesmo que a pessoa tenha outras.
        empresa_id: empresaId,
      },
    })
  } catch (err) {
    return envelopeErro(res, err, 'CONVITE_FAILED', 'Não foi possível concluir o cadastro.')
  }
})

module.exports = router
