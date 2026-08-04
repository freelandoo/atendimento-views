'use strict'
// Rotinas de Aquisição — CRUD + acompanhamento.
// Montada sob /api/empresas/:empresaId/prospeccao/rotinas com requireAuth +
// requireRole('admin') (index.js) e requireEmpresaAccess por rota: a autorização de
// administrador e o isolamento por empresa vivem no backend, nunca só na tela.
// Este módulo só faz HTTP: regra de tempo em services/aquisicao-rotinas-scheduler.js,
// SQL em db/aquisicao-rotinas.js.

const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const rotinasDb = require('../db/aquisicao-rotinas')
const {
  estadoRotina,
  proximaExecucao,
  localizacaoRotina,
  QUANTIDADE_MIN,
  QUANTIDADE_MAX,
  INTERVALO_MIN_HORAS,
} = require('../services/aquisicao-rotinas-scheduler')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

function falhar(res, err, code) {
  const status = err.statusCode || 500
  // Erro de validação/conflito é do operador; só 5xx vira log de erro.
  if (status >= 500) logger.error(`${code}:`, err.message)
  return res.status(status).json({ ok: false, error: { code, message: err.message } })
}

// Junta o cadastro com o momento: estado exibido, próxima execução e o resultado da
// última coleta. Nenhum detalhe de Bright Data/snapshot vaza para o cliente.
function apresentarRotina(rotina, { temColetaEmVoo, agora }) {
  const estado = estadoRotina(rotina, agora, { temColetaEmVoo })
  const proxima = proximaExecucao(rotina, agora)
  return {
    id: rotina.id,
    nicho: rotina.nicho,
    cidade: rotina.cidade,
    uf: rotina.uf,
    localizacao: localizacaoRotina(rotina.cidade, rotina.uf),
    dias_semana: rotina.dias_semana,
    janela_inicio: rotina.janela_inicio,
    janela_fim: rotina.janela_fim,
    intervalo_horas: rotina.intervalo_horas,
    quantidade: rotina.quantidade,
    ativo: rotina.ativo,
    estado: estado.chave,
    estado_label: estado.label,
    mensagem: rotina.mensagem,
    proxima_execucao_em: proxima ? proxima.toISOString() : null,
    ultima_execucao_em: rotina.ultima_execucao_em,
    ultima_conclusao_em: rotina.ultima_conclusao_em,
    total_execucoes: rotina.total_execucoes,
    ultimo_coletados: rotina.ultimo_coletados,
    ultimo_novos: rotina.ultimo_novos,
    ultimo_duplicados: rotina.ultimo_duplicados,
    falhas_consecutivas: rotina.falhas_consecutivas,
    ultimo_erro: rotina.ultimo_erro,
    criado_em: rotina.criado_em,
  }
}

async function responderLista(req, res) {
  const agora = new Date()
  const [rotinas, temColetaEmVoo, atividade] = await Promise.all([
    rotinasDb.listarRotinas(pool, req.empresa.id),
    rotinasDb.existeColetaEmVoo(pool, req.empresa.id),
    rotinasDb.listarAtividadeRecente(pool, req.empresa.id, req.query.atividade_limite),
  ])
  return res.json({
    ok: true,
    data: {
      rotinas: rotinas.map((r) => apresentarRotina(r, { temColetaEmVoo, agora })),
      atividade: atividade.map((a) => ({
        id: a.id,
        rotina_id: a.rotina_id,
        nicho: a.nicho,
        cidade: a.cidade,
        uf: a.uf,
        origem: a.origem,
        status: a.status,
        coletados: a.total_prospects,
        novos: a.novos_prospects,
        duplicados: Math.max(0, Number(a.total_prospects || 0) - Number(a.novos_prospects || 0)),
        quantidade_solicitada: a.quantidade_solicitada,
        erro: a.erro,
        created_at: a.created_at,
        updated_at: a.updated_at,
      })),
      coleta_em_andamento: temColetaEmVoo,
      limites: {
        quantidade_min: QUANTIDADE_MIN,
        quantidade_max: QUANTIDADE_MAX,
        intervalo_min_horas: INTERVALO_MIN_HORAS,
      },
    },
  })
}

// GET /api/empresas/:empresaId/prospeccao/rotinas
router.get('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    return await responderLista(req, res)
  } catch (err) {
    return falhar(res, err, 'ROTINAS_LIST_FAILED')
  }
})

// POST /api/empresas/:empresaId/prospeccao/rotinas
router.post('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    await rotinasDb.criarRotina(pool, req.empresa.id, req.body || {})
    return await responderLista(req, res)
  } catch (err) {
    return falhar(res, err, 'ROTINA_CREATE_FAILED')
  }
})

// PUT /api/empresas/:empresaId/prospeccao/rotinas/:id
router.put('/:id', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    await rotinasDb.atualizarRotina(pool, req.empresa.id, req.params.id, req.body || {})
    return await responderLista(req, res)
  } catch (err) {
    return falhar(res, err, 'ROTINA_UPDATE_FAILED')
  }
})

// POST /api/empresas/:empresaId/prospeccao/rotinas/:id/ativar  { ativo: true|false }
// Pausa/retoma preservando todo o histórico da rotina.
router.post('/:id/ativar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const rotina = await rotinasDb.alternarRotina(pool, req.empresa.id, req.params.id, (req.body || {}).ativo)
    if (!rotina) {
      return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Rotina não encontrada.' } })
    }
    return await responderLista(req, res)
  } catch (err) {
    return falhar(res, err, 'ROTINA_TOGGLE_FAILED')
  }
})

// DELETE /api/empresas/:empresaId/prospeccao/rotinas/:id
router.delete('/:id', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    await rotinasDb.removerRotina(pool, req.empresa.id, req.params.id)
    return await responderLista(req, res)
  } catch (err) {
    return falhar(res, err, 'ROTINA_DELETE_FAILED')
  }
})

module.exports = router
