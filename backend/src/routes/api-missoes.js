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

/**
 * GET / — a missão ativa, o MEU progresso e (para quem gerencia) quem já alcançou.
 *
 * Ausência de missão é estado legítimo — o desafio simplesmente não foi ligado nesta empresa —
 * e devolve `missao: null`, nunca uma missão vazia com alvo zero, que faria a tela prometer um
 * desafio que ninguém publicou.
 */
router.get('/', async (req, res) => {
  try {
    const missao = await DB.missaoAtiva(req.empresa.id)
    if (!missao) {
      return res.json({ ok: true, data: { missao: null }, meta: { pode_gerenciar: podeGerenciar(req) } })
    }

    const bruto = await DB.progressoDaPessoa(req.empresa.id, missao, req.usuario.id)
    const meu = M.progresso({ valor: bruto.valor, alvo: missao.alvo_valor })

    // A lista de quem alcançou só existe para quem paga o prêmio.
    const alcancaram = podeGerenciar(req) ? await DB.alcancaramOAlvo(req.empresa.id, missao) : null

    return res.json({
      ok: true,
      data: {
        missao,
        situacao: M.situacao(missao),
        meu_progresso: { ...meu, vendas: bruto.vendas },
        alcancaram,
      },
      meta: { pode_gerenciar: podeGerenciar(req), usuario_id: req.usuario.id },
    })
  } catch (err) { return envelopeErro(res, err, 'MISSAO_LOAD_FAILED') }
})

/** GET /historico — as missões já publicadas. Leitura de todos: o histórico do programa é do time. */
router.get('/historico', async (req, res) => {
  try {
    const missoes = await DB.listarMissoes(req.empresa.id, { limite: req.query.limite })
    return res.json({
      ok: true,
      data: missoes.map((m) => ({ ...m, situacao: M.situacao(m) })),
      meta: { pode_gerenciar: podeGerenciar(req) },
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

module.exports = router
