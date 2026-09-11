'use strict'
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess, requireCapacidade } = require('../middleware/tenant')
const { CAPACIDADES: CAP, podeCapacidade } = require('../services/acesso-capacidades')
const {
  listarEventos,
  obterEvento,
  criarEvento,
  atualizarEvento,
  removerEvento,
} = require('../services/agenda-multiempresa')
// REUSA a lista de `db/follow-ups.js` em vez de escrever a mesma consulta de novo: e' a mesma
// pergunta ("quem da empresa pode receber um trabalho?"), e duas consultas divergentes fariam o
// vendedor aparecer num seletor e sumir do outro.
const { listarResponsaveis } = require('../db/follow-ups')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

function tratarErro(res, err, fallbackCode, contexto) {
  const status = err.statusCode || 500
  if (status >= 500) logger.error(`${contexto}:`, err.message)
  return res.status(status).json({
    ok: false,
    error: { code: err.code || fallbackCode, message: err.message },
  })
}

// GET /responsaveis — quem pode conduzir um compromisso. So' para quem ve a agenda da equipe:
// para os demais o unico responsavel possivel e' a propria pessoa, e um seletor com os colegas
// prometeria uma marcacao que o POST recusa com 403.
//
// Declarada ANTES de `/:id` de proposito: depois dela, "responsaveis" seria lido como id de evento.
router.get('/responsaveis', requireAuth, requireEmpresaAccess, requireCapacidade(CAP.AGENDA_VER_EQUIPE), async (req, res) => {
  try {
    return res.json({ ok: true, data: { itens: await listarResponsaveis(pool, req.empresa.id) } })
  } catch (err) {
    return tratarErro(res, err, 'AGENDA_RESPONSAVEIS_FAILED', 'GET agenda/responsaveis')
  }
})

// GET /api/empresas/:empresaId/agenda?inicio=YYYY-MM-DD&fim=YYYY-MM-DD&tipo=&status=
router.get('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    // CRM em equipe, Etapa 11: a agenda CONSOLIDADA da equipe e' leitura de gestao
    // (AGENDA_VER_EQUIPE). Quem nao tem ve a PROPRIA agenda + os eventos da EMPRESA (bloqueios,
    // feriados e todo evento anterior a migration 076, que nao tem responsavel).
    //
    // `?responsavel_id=` so' e' respeitado por quem pode ver a equipe: e' o filtro "agenda do
    // vendedor X" do admin. Para os demais, o recorte e' sempre o proprio — trocar um parametro
    // de query nao pode virar acesso a agenda alheia.
    const podeVerEquipe = podeCapacidade({
      papel: req.papelEmpresa,
      permissoes: req.vinculoEmpresa ? req.vinculoEmpresa.permissoes : null,
      papelPlataforma: req.usuario?.role,
    }, CAP.AGENDA_VER_EQUIPE)
    const responsavelId = podeVerEquipe
      ? (req.query.responsavel_id || null)
      : (req.usuario?.id || null)

    const out = await listarEventos(pool, {
      empresaId: req.empresa.id,
      inicio: req.query.inicio,
      fim: req.query.fim,
      tipo: req.query.tipo || null,
      status: req.query.status || null,
      responsavelId,
    })
    return res.json({
      ok: true,
      data: out,
      // A tela precisa poder dizer "mostrando a sua agenda": recortar em silencio faria o
      // vendedor achar que a agenda da equipe sumiu.
      meta: { escopo: responsavelId ? 'responsavel' : 'equipe', pode_ver_equipe: podeVerEquipe },
    })
  } catch (err) {
    return tratarErro(res, err, 'AGENDA_LIST_FAILED', 'GET agenda')
  }
})

// GET /api/empresas/:empresaId/agenda/:id
router.get('/:id', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const evento = await obterEvento(pool, { empresaId: req.empresa.id, id: req.params.id })
    if (!evento) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Evento não encontrado.' } })
    return res.json({ ok: true, data: evento })
  } catch (err) {
    return tratarErro(res, err, 'AGENDA_GET_FAILED', 'GET agenda/:id')
  }
})

// POST /api/empresas/:empresaId/agenda
router.post('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    // `responsavel_id` no corpo = marcar PARA outra pessoa (o admin agenda para o vendedor, o SDR
    // para o closer). So' quem ve a agenda da equipe pode fazer isso — senao alguem marcaria
    // compromisso na agenda de um colega que nem consegue enxergar.
    const podeMarcarParaOutro = podeCapacidade({
      papel: req.papelEmpresa,
      permissoes: req.vinculoEmpresa ? req.vinculoEmpresa.permissoes : null,
      papelPlataforma: req.usuario?.role,
    }, CAP.AGENDA_VER_EQUIPE)
    const corpo = req.body || {}
    if (corpo.responsavel_id && !podeMarcarParaOutro && String(corpo.responsavel_id) !== String(req.usuario?.id)) {
      return res.status(403).json({
        ok: false,
        error: { code: 'FORBIDDEN', message: 'Você não pode marcar compromisso na agenda de outra pessoa.' },
      })
    }
    const evento = await criarEvento(pool, {
      empresaId: req.empresa.id,
      criadoPor: req.usuario?.id || null,
      responsavelId: corpo.responsavel_id || null,
      prospectId: corpo.prospect_id || null,
      ...corpo,
    })
    return res.status(201).json({ ok: true, data: evento })
  } catch (err) {
    return tratarErro(res, err, 'AGENDA_CREATE_FAILED', 'POST agenda')
  }
})

// PATCH /api/empresas/:empresaId/agenda/:id
router.patch('/:id', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const evento = await atualizarEvento(pool, {
      empresaId: req.empresa.id,
      id: req.params.id,
      ...(req.body || {}),
    })
    return res.json({ ok: true, data: evento })
  } catch (err) {
    return tratarErro(res, err, 'AGENDA_UPDATE_FAILED', 'PATCH agenda/:id')
  }
})

// DELETE /api/empresas/:empresaId/agenda/:id
router.delete('/:id', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const out = await removerEvento(pool, { empresaId: req.empresa.id, id: req.params.id })
    return res.json({ ok: true, data: out })
  } catch (err) {
    return tratarErro(res, err, 'AGENDA_DELETE_FAILED', 'DELETE agenda/:id')
  }
})

module.exports = router
