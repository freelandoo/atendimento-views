'use strict'
// Equipes Comerciais — gestao operacional por nicho.
// Autorizacao: MEMBROS_GERENCIAR. Equipe nao e papel; e organizacao de carteira.

const { Router } = require('express')
const { requireAuth, requireEmpresaAccess, requireCapacidade } = require('../middleware/tenant')
const { CAPACIDADES: CAP } = require('../services/acesso-capacidades')
const DB = require('../db/equipes-comerciais')
const LP = require('../services/lead-parado')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

function envelopeErro(res, err, code = 'EQUIPES_COMERCIAIS_FAILED') {
  const status = err?.statusCode || 500
  logger.error({ err: err?.message, code }, '[api-equipes-comerciais] falha')
  const message = status >= 500 ? 'Não foi possível concluir a operação.' : (err?.message || 'Dados inválidos.')
  return res.status(status).json({ ok: false, error: { code: err?.code || code, message } })
}

router.use(requireAuth, requireEmpresaAccess, requireCapacidade(CAP.MEMBROS_GERENCIAR))

router.get('/', async (req, res) => {
  try {
    return res.json({ ok: true, data: await DB.listarEquipes(req.empresa.id) })
  } catch (err) { return envelopeErro(res, err, 'EQUIPES_LIST_FAILED') }
})

// ⚠️ DECLARADA ANTES de `/:equipeId`, senao "elegiveis" viraria um id de equipe — o mesmo cuidado
// de `GET /agenda/responsaveis`.
//
// Somente leitura: nao cria equipe, nao move ninguem e nao chama IA. Serve o seletor de membros,
// que precisa avisar "esta pessoa ja' esta no Time Solar" ANTES de submeter. Sem isso o gestor so'
// descobre no 409, cuja mensagem fala de "uma das pessoas" sem dizer qual.
router.get('/elegiveis', async (req, res) => {
  try {
    return res.json({ ok: true, data: await DB.membrosElegiveis(req.empresa.id) })
  } catch (err) { return envelopeErro(res, err, 'EQUIPES_ELEGIVEIS_FAILED') }
})

router.get('/:equipeId', async (req, res) => {
  try {
    const equipe = await DB.equipeComMembros(req.empresa.id, req.params.equipeId)
    if (!equipe) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Equipe não encontrada.' } })
    return res.json({ ok: true, data: equipe })
  } catch (err) { return envelopeErro(res, err, 'EQUIPE_GET_FAILED') }
})

// GET /:equipeId/carteira — a carteira do NICHO desta equipe, pessoa por pessoa.
//
// SOMENTE LEITURA: nao distribui, nao move lead, nao grava e nao chama IA. Abrir o painel nao
// pode mudar de quem e' nada — distribuir e' sempre um clique explicito.
//
// ⚠️ Recortada pelo nicho da equipe. `GET /equipe` continua contando a carteira de cada pessoa na
// EMPRESA INTEIRA; sao perguntas diferentes, e cada tela declara qual esta mostrando.
router.get('/:equipeId/carteira', async (req, res) => {
  try {
    // O prazo do "parado" vem da QUERY, nao de configuracao — mesma razao de `GET /equipe`: e'
    // um recorte de leitura passageiro, nao uma decisao permanente da empresa.
    const prazoParado = LP.normalizarPrazo(req.query.parado_dias)
    const data = await DB.carteiraDaEquipe(req.empresa.id, req.params.equipeId, { prazoParado })
    if (!data) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Equipe não encontrada.' } })
    return res.json({ ok: true, data, meta: { parado_dias: prazoParado } })
  } catch (err) { return envelopeErro(res, err, 'EQUIPE_CARTEIRA_FAILED') }
})

// POST /:equipeId/distribuicao — "Puxar mais leads": entrega leads LIVRES do nicho a equipe.
//
// ⚠️ EXIGE `LEAD_TRANSFERIR` POR ROTA — o mount NAO basta. `MEMBROS_GERENCIAR` autoriza montar
// equipe; mexer em quem e' dono de lead e' outra decisao, e e' a capacidade que o `comercial`
// nao tem. Sem o gate por rota, quem administra contas passaria a distribuir carteira sem
// ninguem ter decidido isso.
//
// So' mexe em lead LIVRE e INTOCADO. Lead com reuniao, conversa, follow-up, ligacao ou disparo
// registrado nunca e' tocado — ver `services/lead-distribuicao.js`.
router.post('/:equipeId/distribuicao', requireAuth, requireEmpresaAccess, requireCapacidade(CAP.LEAD_TRANSFERIR), async (req, res) => {
  try {
    const b = req.body || {}
    const data = await DB.puxarLeadsParaEquipe(req.empresa.id, req.params.equipeId, {
      quantidade: b.quantidade,
      criterio: b.criterio,
      entre: b.entre,
      usuario_ids: b.usuario_ids,
    }, req.usuario.id)
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'EQUIPE_DISTRIBUICAO_FAILED') }
})

router.post('/', async (req, res) => {
  try {
    const b = req.body || {}
    const data = await DB.criarEquipe(req.empresa.id, {
      nome: b.nome,
      nicho_id: b.nicho_id,
      descricao: b.descricao,
      usuario_ids: b.usuario_ids,
    }, req.usuario.id)
    return res.status(201).json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'EQUIPE_CREATE_FAILED') }
})

// PATCH /:equipeId — renomear a equipe. SO' nome e descricao.
//
// ⚠️ `nicho_id` e' RECUSADO explicitamente, nao ignorado em silencio: e' o nicho que recorta o
// Banco de Leads dos membros, entao trocá-lo aqui moveria a carteira de varias pessoas de uma
// vez. Recusar diz ao chamador o que aconteceu; ignorar faria a tela achar que salvou.
// Trocar de nicho e' encerrar a equipe e criar outra — o caminho que deixa rastro.
router.patch('/:equipeId', async (req, res) => {
  try {
    const b = req.body || {}
    if (b.nicho_id !== undefined) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'NICHO_NAO_EDITAVEL',
          message: 'O nicho de uma equipe não pode ser trocado: ele recorta a carteira de todos os membros. Encerre esta equipe e crie outra.',
        },
      })
    }
    const data = await DB.atualizarEquipe(req.empresa.id, req.params.equipeId, {
      nome: b.nome,
      descricao: b.descricao,
    }, req.usuario.id)
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'EQUIPE_UPDATE_FAILED') }
})

router.put('/:equipeId/participantes', async (req, res) => {
  try {
    const data = await DB.definirParticipantes(req.empresa.id, req.params.equipeId, {
      usuario_ids: req.body?.usuario_ids,
    }, req.usuario.id)
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'EQUIPE_PARTICIPANTES_FAILED') }
})

router.post('/:equipeId/encerrar', async (req, res) => {
  try {
    const data = await DB.encerrarEquipe(req.empresa.id, req.params.equipeId, {
      motivo: req.body?.motivo,
    }, req.usuario.id)
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'EQUIPE_ENCERRAR_FAILED') }
})

module.exports = router
