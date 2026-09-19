'use strict'
// Missao da Operacao Comercial (Etapa 2) — rotas.
//
// AUTORIZACAO EM DOIS NIVEIS, exatamente como `api-comissao.js`:
//   * o MOUNT exige `COMISSAO_VER_PROPRIA` — ver o proprio desafio e o proprio progresso e' parte
//     do trabalho; desafio que a pessoa nao consegue acompanhar e' promessa sem prova;
//   * cada ESCRITA exige `COMISSAO_GERENCIAR` — publicar um desafio com recompensa e' definir
//     quanto se paga, e quem define isso nao pode ser quem recebe.
//
// POR QUE NENHUMA CAPACIDADE NOVA: missao com recompensa e' politica de REMUNERACAO, a mesma
// familia de decisao da comissao. Criar `MISSAO_GERENCIAR` sem uma decisao distinta por tras
// seria acrescentar coluna a uma matriz que ninguem valida — e' como matriz de permissao
// apodrece (ver o cabecalho de services/acesso-capacidades.js).
//
// ⚠️ O PROGRESSO E' PESSOAL. Nao existe rota que devolva o progresso parcial de outra pessoa,
// nem para o dono. O que o dono recebe e' QUEM JA ALCANCOU o alvo — fato consumado, e sem ele
// nao ha como pagar a recompensa. Guarda de regressao em test/missao.test.js.

const express = require('express')
const { requireAuth, requireEmpresaAccess, requireCapacidade } = require('../middleware/tenant')
const { CAPACIDADES: CAP, podeCapacidade } = require('../services/acesso-capacidades')
const M = require('../services/missao')
const DB = require('../db/missao')
const EQ = require('../db/equipes-comerciais')
const { recorteDeNicho } = require('../services/equipes-comerciais')
const { logger } = require('../logger')

const router = express.Router({ mergeParams: true })

router.use(requireAuth, requireEmpresaAccess, requireCapacidade(CAP.COMISSAO_VER_PROPRIA))

function envelopeErro(res, err, code = 'MISSAO_FAILED') {
  const status = err?.statusCode || err?.status || 500
  logger.error({ err: err?.message, code }, '[api-missoes] falha')
  const message = status >= 500 ? 'Não foi possível concluir a operação.' : (err?.message || 'Dados inválidos.')
  return res.status(status).json({ ok: false, error: { code: err?.code || code, message } })
}

// Mesmo formato de vínculo que `requireCapacidade` monta — inclusive `papelPlataforma`, senão o
// superadmin não seria reconhecido como gestor dentro de uma empresa que ele administra.
const podeGerenciar = (req) => podeCapacidade({
  papel: req.papelEmpresa,
  permissoes: req.vinculoEmpresa ? req.vinculoEmpresa.permissoes : null,
  papelPlataforma: req.usuario?.role,
}, CAP.COMISSAO_GERENCIAR)

async function equipeDaMissao(req) {
  if (podeGerenciar(req) && req.query.equipe_id) {
    const equipe = await EQ.equipeComMembros(req.empresa.id, req.query.equipe_id)
    return equipe && equipe.status === 'ativa'
      ? {
        equipe_id: equipe.id,
        equipe_nome: equipe.nome,
        nicho_id: equipe.nicho_id,
        nicho_nome: equipe.nicho_nome,
      }
      : null
  }
  const equipe = await EQ.equipeAtivaDoUsuario(req.empresa.id, req.usuario.id)
  const recorte = recorteDeNicho(equipe)
  return recorte
    ? {
      equipe_id: recorte.equipe_id,
      equipe_nome: recorte.equipe_nome,
      nicho_id: recorte.nicho_id,
      nicho_nome: recorte.nicho_nome,
    }
    : null
}

async function assertEquipeAtiva(req, equipeId) {
  const equipe = await EQ.equipeComMembros(req.empresa.id, equipeId)
  if (!equipe || equipe.status !== 'ativa') {
    const err = new Error('Equipe não encontrada ou inativa nesta empresa.')
    err.statusCode = 400
    err.code = 'EQUIPE_INVALIDA'
    throw err
  }
  return equipe
}

/**
 * GET / — a missão ativa, o MEU progresso e (para quem gerencia) quem já alcançou.
 *
 * Ausência de missão é estado legítimo — o desafio simplesmente não foi ligado nesta empresa —
 * e devolve `missao: null`, nunca uma missão vazia com alvo zero, que faria a tela prometer um
 * desafio que ninguém publicou.
 */
router.get('/', async (req, res) => {
  try {
    const equipe = await equipeDaMissao(req)
    // A missao da EQUIPE tem precedencia. Na falta dela, cai para a missao GERAL legada (085):
    // a 089 deixou `equipe_id` nullable justamente para nao apagar da tela um desafio que ja
    // estava valendo, e ignora-lo aqui anularia esse cuidado.
    const missao = equipe
      ? (await DB.missaoAtiva(req.empresa.id, { equipeId: equipe.equipe_id })
         || await DB.missaoAtiva(req.empresa.id))
      : await DB.missaoAtiva(req.empresa.id)
    if (!missao) {
      return res.json({ ok: true, data: { missao: null }, meta: { pode_gerenciar: podeGerenciar(req), equipe } })
    }

    const bruto = await DB.progressoDaPessoa(req.empresa.id, missao, req.usuario.id)
    const meu = M.progresso({ valor: bruto.valor, alvo: missao.alvo_valor })

    // As baixas são lidas sempre: a PRÓPRIA pessoa precisa ver que o prêmio dela foi registrado
    // como entregue. Um programa de recompensa que o beneficiário não consegue conferir é
    // promessa sem prova — a mesma razão pela qual `COMISSAO_VER_PROPRIA` existe.
    const recompensas = await DB.recompensasDaMissao(req.empresa.id, missao.id)
    const minhaRecompensa = recompensas.find((r) => String(r.usuario_id) === String(req.usuario.id)) || null

    // A lista de quem alcançou só existe para quem paga o prêmio — e já vem dizendo quem recebeu.
    const alcancaram = podeGerenciar(req)
      ? M.juntarBaixas(await DB.alcancaramOAlvo(req.empresa.id, missao), recompensas)
      : null

    return res.json({
      ok: true,
      data: {
        missao,
        situacao: M.situacao(missao),
        meu_progresso: {
          ...meu,
          vendas: bruto.vendas,
          // `false` e não `null`: quem alcançou sempre tem resposta para "já recebi?".
          recompensa_paga: !!minhaRecompensa,
          recompensa_paga_em: minhaRecompensa ? minhaRecompensa.pago_em : null,
          recompensa_valor_pago: minhaRecompensa ? minhaRecompensa.valor_pago : null,
        },
        alcancaram,
      },
      meta: { pode_gerenciar: podeGerenciar(req), usuario_id: req.usuario.id, equipe },
    })
  } catch (err) { return envelopeErro(res, err, 'MISSAO_LOAD_FAILED') }
})

/** GET /historico — as missões já publicadas. Leitura de todos: o histórico do programa é do time. */
router.get('/historico', async (req, res) => {
  try {
    const gerencia = podeGerenciar(req)
    const equipe = await equipeDaMissao(req)
    // Quem gerencia enxerga o programa inteiro; so recorta quando PEDE uma equipe no seletor.
    // Filtrar pela equipe a que o proprio admin pertence esconderia dele o resto do historico.
    const recorte = gerencia ? (req.query.equipe_id ? equipe : null) : equipe
    if (!gerencia && !equipe) {
      return res.json({ ok: true, data: [], meta: { pode_gerenciar: false, equipe: null } })
    }
    const missoes = await DB.listarMissoes(req.empresa.id, {
      limite: req.query.limite,
      equipeId: recorte ? recorte.equipe_id : null,
    })
    return res.json({
      ok: true,
      data: missoes.map((m) => ({ ...m, situacao: M.situacao(m) })),
      meta: { pode_gerenciar: gerencia, equipe },
    })
  } catch (err) { return envelopeErro(res, err, 'MISSAO_LIST_FAILED') }
})

/**
 * POST / — publica a missão. Publicar É criar: não há rascunho e não há edição.
 * Missão publicada é IMUTÁVEL (ver services/missao.js) — para mudar, encerra e publica outra.
 */
router.post('/', requireAuth, requireEmpresaAccess, requireCapacidade(CAP.COMISSAO_GERENCIAR), async (req, res) => {
  const v = M.validarMissao(req.body || {})
  if (!v.ok) {
    return res.status(400).json({
      ok: false,
      error: { code: 'DADOS_INVALIDOS', message: v.mensagem },
      data: { recusa: v.recusa },
    })
  }
  try {
    await assertEquipeAtiva(req, v.dados.equipe_id)
    const missao = await DB.publicarMissao(req.empresa.id, v.dados, req.usuario.id)
    return res.status(201).json({ ok: true, data: { ...missao, situacao: M.situacao(missao) } })
  } catch (err) { return envelopeErro(res, err, 'MISSAO_CREATE_FAILED') }
})

/**
 * POST /:missaoId/encerrar — encerra por DECISÃO de alguém.
 *
 * Encerrar não apaga nada: a missão vira histórico e quem alcançou continua calculável, porque a
 * conquista é derivada das vendas. 409 quando já estava encerrada — repetir a ação não pode
 * sobrescrever a autoria do primeiro encerramento.
 */
router.post('/:missaoId/encerrar', requireAuth, requireEmpresaAccess, requireCapacidade(CAP.COMISSAO_GERENCIAR), async (req, res) => {
  try {
    const missao = await DB.encerrarMissao(req.empresa.id, req.params.missaoId, req.usuario.id)
    if (!missao) {
      // 404 e 409 dizem coisas diferentes ao operador: uma manda conferir o link, a outra diz
      // que o trabalho já foi feito.
      const existe = await DB.obterMissao(req.empresa.id, req.params.missaoId)
      if (!existe) {
        return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Missão não encontrada.' } })
      }
      return res.status(409).json({ ok: false, error: { code: 'MISSAO_JA_ENCERRADA', message: 'Esta missão já estava encerrada.' } })
    }
    return res.json({ ok: true, data: { ...missao, situacao: M.situacao(missao) } })
  } catch (err) { return envelopeErro(res, err, 'MISSAO_CLOSE_FAILED') }
})

/**
 * POST /:missaoId/recompensas — registra que o prêmio SAIU para uma pessoa.
 *
 * ⚠️ NÃO SE PAGA QUEM NÃO ALCANÇOU: a conquista é reconferida na transação, com a soma lida do
 * banco no ato — nunca com um "alcançou" vindo do corpo. Quem não alcançou recebe 409 e nada é
 * gravado.
 *
 * NÃO EXISTE DESFAZER (o registro é append-only, como `venda_pagamentos`): dizer "paguei" é um
 * fato sobre dinheiro que saiu, e um UPDATE apagaria a única prova de que o prêmio foi entregue.
 * Consequência declarada: baixa errada não se corrige por tela nesta etapa.
 */
router.post('/:missaoId/recompensas', requireAuth, requireEmpresaAccess, requireCapacidade(CAP.COMISSAO_GERENCIAR), async (req, res) => {
  const v = M.validarBaixa(req.body || {})
  if (!v.ok) {
    return res.status(400).json({
      ok: false,
      error: { code: 'DADOS_INVALIDOS', message: v.mensagem },
      data: { recusa: v.recusa },
    })
  }
  try {
    // A missão vem do banco, não do corpo: o alvo e a janela que validam a conquista têm de ser
    // os da missão real, e ela é imutável justamente para este número não mudar depois.
    const missao = await DB.obterMissao(req.empresa.id, req.params.missaoId)
    if (!missao) {
      return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Missão não encontrada.' } })
    }
    const baixa = await DB.registrarRecompensaPaga(req.empresa.id, missao, v.dados, req.usuario.id)
    return res.status(201).json({ ok: true, data: baixa })
  } catch (err) { return envelopeErro(res, err, 'MISSAO_RECOMPENSA_FAILED') }
})

module.exports = router
