'use strict'
// Assistente de Oportunidades — HTTP.
// Montada sob /api/empresas/:empresaId/prospeccao/oportunidades com requireAuth +
// requireRole('admin') (index.js) e requireEmpresaAccess por rota.
//
// Só faz HTTP: as regras vivem em services/aquisicao-sinais.js, a orquestração em
// services/aquisicao-assistente.js e o SQL em db/aquisicao-oportunidades.js.

const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const oportunidadesDb = require('../db/aquisicao-oportunidades')
const {
  analisarOportunidades,
  aplicarSugestao,
  dispensarSugestao,
  ESTADOS,
  COOLDOWN_MINUTOS,
} = require('../services/aquisicao-assistente')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

const ACAO_LABEL = {
  criar_rotina: 'Criar rotina',
  ajustar_rotina: 'Ajustar rotina',
  pausar_rotina: 'Pausar rotina',
  revisar_rotina: 'Revisar rotina',
}

// Evidência exibida ao admin. Chave desconhecida é DESCARTADA: nada de campo interno
// vazando para a tela por acidente.
const EVIDENCIA = {
  falhas_consecutivas: { rotulo: 'Tentativas seguidas sem sucesso' },
  ultimo_erro: { rotulo: 'Último aviso do sistema' },
  execucoes_avaliadas: { rotulo: 'Execuções analisadas' },
  encontrados: { rotulo: 'Leads encontrados' },
  novos: { rotulo: 'Leads novos' },
  duplicados: { rotulo: 'Já estavam na sua base' },
  taxa_novos_pct: { rotulo: 'Proporção de leads novos', sufixo: '%' },
  respostas_no_mercado: { rotulo: 'Respostas neste mercado' },
  intervalo_atual_horas: { rotulo: 'Busca a cada (hoje)', sufixo: 'h' },
  intervalo_proposto_horas: { rotulo: 'Busca a cada (sugerido)', sufixo: 'h' },
  quantidade_atual: { rotulo: 'Máx. por execução (hoje)' },
  quantidade_proposta: { rotulo: 'Máx. por execução (sugerido)' },
  leads_no_mercado: { rotulo: 'Leads deste mercado' },
  abordados: { rotulo: 'Leads já abordados' },
  respostas: { rotulo: 'Responderam' },
  taxa_resposta_pct: { rotulo: 'Taxa de resposta', sufixo: '%' },
  reunioes: { rotulo: 'Reuniões marcadas' },
  observacao: { rotulo: 'Observação' },
}

function evidenciasVisiveis(evidencias) {
  if (!evidencias || typeof evidencias !== 'object') return []
  const saida = []
  for (const [chave, valor] of Object.entries(evidencias)) {
    const meta = EVIDENCIA[chave]
    if (!meta || valor == null || valor === '') continue
    saida.push({ rotulo: meta.rotulo, valor: `${valor}${meta.sufixo || ''}` })
  }
  return saida
}

function apresentarSugestao(s) {
  return {
    id: s.id,
    tipo: s.tipo,
    acao_label: ACAO_LABEL[s.tipo] || 'Revisar',
    rotina_id: s.rotina_id,
    nicho: s.nicho,
    cidade: s.cidade,
    uf: s.uf,
    parametros: s.parametros || {},
    titulo: s.titulo,
    motivo: s.motivo,
    impacto: s.impacto,
    evidencias: evidenciasVisiveis(s.evidencias),
    confianca: s.confianca,
    status: s.status,
    decidido_em: s.decidido_em,
    rotina_resultante_id: s.rotina_resultante_id,
    criado_em: s.criado_em,
  }
}

function falhar(res, err, code) {
  const status = err.statusCode || 500
  if (status >= 500) logger.error(`${code}:`, err.message)
  return res.status(status).json({ ok: false, error: { code, message: err.message } })
}

async function responderLista(req, res, extra = {}) {
  const [pendentes, historico, ultima] = await Promise.all([
    oportunidadesDb.listarSugestoes(pool, req.empresa.id, { status: 'pendente', limite: 10 }),
    oportunidadesDb.listarSugestoes(pool, req.empresa.id, { status: 'todas', limite: 20 }),
    oportunidadesDb.ultimaGeracaoEm(pool, req.empresa.id),
  ])
  const proximaAnalise = ultima
    ? new Date(new Date(ultima).getTime() + (COOLDOWN_MINUTOS * 60000)).toISOString()
    : null
  return res.json({
    ok: true,
    data: {
      sugestoes: pendentes.map(apresentarSugestao),
      decididas: historico.filter((s) => s.status !== 'pendente').map(apresentarSugestao),
      ultima_analise_em: ultima || null,
      proxima_analise_em: proximaAnalise,
      ...extra,
    },
  })
}

// GET /api/empresas/:empresaId/prospeccao/oportunidades
router.get('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    return await responderLista(req, res)
  } catch (err) {
    return falhar(res, err, 'OPORTUNIDADES_LIST_FAILED')
  }
})

// POST /api/empresas/:empresaId/prospeccao/oportunidades/analisar
// Roda a análise sob demanda. NÃO inicia coleta e não altera nenhuma rotina.
router.post('/analisar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const resultado = await analisarOportunidades(pool, { empresaId: req.empresa.id })
    return await responderLista(req, res, {
      estado: resultado.estado,
      mensagem: resultado.mensagem,
      novas: resultado.sugestoes.length,
    })
  } catch (err) {
    if (err.statusCode === 429) {
      return res.status(429).json({ ok: false, error: { code: 'ANALISE_EM_COOLDOWN', message: err.message } })
    }
    return falhar(res, err, 'ANALISE_FAILED')
  }
})

// POST /api/empresas/:empresaId/prospeccao/oportunidades/:id/aprovar
// { ajustes?: {...}, nota?: string } — `ajustes` é a revisão do admin no formulário.
// Rotina criada por aqui nasce PAUSADA; nenhuma coleta é iniciada.
router.post('/:id/aprovar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const corpo = req.body || {}
    const { sugestao, rotina } = await aplicarSugestao(pool, {
      empresaId: req.empresa.id,
      sugestaoId: req.params.id,
      usuarioId: req.usuario?.id || null,
      ajustes: corpo.ajustes && typeof corpo.ajustes === 'object' ? corpo.ajustes : {},
      nota: corpo.nota,
    })
    return await responderLista(req, res, {
      estado: 'aprovada',
      aprovada: apresentarSugestao(sugestao),
      rotina_id: rotina?.id || null,
      rotina_ativa: rotina?.ativo === true,
    })
  } catch (err) {
    return falhar(res, err, 'SUGESTAO_APROVAR_FAILED')
  }
})

// POST /api/empresas/:empresaId/prospeccao/oportunidades/:id/dispensar  { nota? }
router.post('/:id/dispensar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    await dispensarSugestao(pool, {
      empresaId: req.empresa.id,
      sugestaoId: req.params.id,
      usuarioId: req.usuario?.id || null,
      nota: (req.body || {}).nota,
    })
    return await responderLista(req, res, { estado: 'dispensada' })
  } catch (err) {
    return falhar(res, err, 'SUGESTAO_DISPENSAR_FAILED')
  }
})

// O router É a exportação (padrão das demais rotas, consumido direto por app.use).
// Os helpers de apresentação seguem anexados para os testes exercitarem a tradução
// das evidências sem subir um servidor.
module.exports = router
module.exports.ESTADOS = ESTADOS
module.exports.apresentarSugestao = apresentarSugestao
module.exports.evidenciasVisiveis = evidenciasVisiveis
