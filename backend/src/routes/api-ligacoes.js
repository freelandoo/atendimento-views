'use strict'
// Ligacoes (registro rico da Operacao da Ligacao) — API multi-tenant, admin-only.
// requireEmpresaAccess por rota; o db (src/db/ligacoes.js) filtra empresa_id e valida
// FKs same-tenant.
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const L = require('../db/ligacoes')
const S = require('../db/ligacao-sinais')
const O = require('../db/ligacao-objecoes')
const E = require('../db/ligacao-etapas')
const Q = require('../db/ligacao-perguntas')
const A = require('../db/auditoria')
const AN = require('../db/ligacoes-analitica')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

function erro(res, err, code = 'LIGACAO_FAILED', status = err?.statusCode || 500) {
  logger.error({ err: err?.message, code }, '[api-ligacoes] falha')
  const message = status >= 500 ? 'Nao foi possivel concluir a operacao de ligacao.' : (err?.message || 'Dados invalidos.')
  return res.status(status).json({ ok: false, error: { code, message } })
}

// NOTA: nao existe mais `POST /` (registro direto de ligacao encerrada). Aquele caminho
// gravava status='encerrada' com duracao vinda do CLIENTE e sem nenhuma ocorrencia de etapa,
// contaminando app.vw_ligacoes_analiticas. Toda ligacao agora nasce em /iniciar e morre em
// /:id/encerrar. O passivo daquele caminho foi expurgado pela migration 050.

// POST /iniciar — inicia a SESSAO de ligacao (status em_andamento) no clique explicito.
// Idempotente por client_event_id; retoma ligacao ativa existente (nao duplica).
router.post('/iniciar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const b = req.body || {}
    const data = await L.iniciarLigacao(pool, req.empresa.id, {
      campanhaId: b.campanha_id, campanhaLeadId: b.campanha_lead_id, prospectId: b.prospect_id,
      telefone: b.telefone, roteiroVersaoId: b.roteiro_versao_id, usuarioId: req.usuario?.id,
      clientEventId: b.client_event_id,
    })
    if (data.retomada === false) { // audita so a criacao real (nao a recuperacao)
      A.registrarAuditoria(pool, req.empresa.id, { usuarioId: req.usuario?.id, entidadeTipo: 'ligacao', entidadeId: data.id, acao: 'ligacao_iniciada', estadoNovo: 'em_andamento', clientEventId: b.client_event_id })
    }
    return res.status(data.retomada ? 200 : 201).json({ ok: true, data })
  } catch (err) { return erro(res, err, 'LIGACAO_INICIAR_FAILED') }
})

// GET /ativa — recuperacao: devolve a ligacao em_andamento do lead/prospect (ou null).
router.get('/ativa', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await L.obterLigacaoAtiva(pool, req.empresa.id, {
      campanhaLeadId: req.query.campanha_lead_id, prospectId: req.query.prospect_id,
    })
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'LIGACAO_ATIVA_FAILED') }
})

// POST /:id/chamada-encerrada — marca o FIM DA CHAMADA (clique em "Encerrar ligacao"),
// antes do formulario de resumo. Sem isto, o tempo de preenchimento entra na duracao.
router.post('/:id/chamada-encerrada', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await L.marcarChamadaEncerrada(pool, req.empresa.id, req.params.id)
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'LIGACAO_CHAMADA_ENCERRADA_FAILED') }
})

// POST /:id/encerrar — encerra a sessao (idempotente): calcula duracao no servidor ate o
// fim da chamada, grava o resumo e libera a ligacao para uso analitico.
// etapa_maior_interesse / etapa_perda_interesse NAO vem do cliente: sao derivados dos
// sinais ativos no servidor (fonte unica apos a unificacao das marcas).
router.post('/:id/encerrar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const b = req.body || {}
    const data = await L.encerrarLigacao(pool, req.empresa.id, req.params.id, {
      resultado: b.resultado,
      etapaAlcancada: b.etapa_alcancada, objecaoPrincipal: b.objecao_principal,
      motivoPerda: b.motivo_perda, notas: b.notas,
      novoStatusOportunidade: b.novo_status_oportunidade, proximaAcao: b.proxima_acao, dataFollowup: b.data_followup,
      // Etapa "Proxima acao" do resumo. Ausente ou com canal vazio = "sem proxima acao", que
      // e uma resposta valida — nada e criado. A validacao e a normalizacao ficam no modulo
      // PURO (services/follow-up-modelo.js); aqui so' se repassa o bloco.
      followUp: b.follow_up || null,
      usuarioId: req.usuario?.id,
    })
    if (!data.ja_encerrada) {
      A.registrarAuditoria(pool, req.empresa.id, { usuarioId: req.usuario?.id, entidadeTipo: 'ligacao', entidadeId: data.id, acao: 'ligacao_encerrada', estadoAnterior: 'em_andamento', estadoNovo: 'encerrada', contexto: { resultado: data.resultado, duracao_seg: data.duracao_seg } })
      // Auditoria do follow-up: e o registro de "canal escolhido para continuidade" que a
      // linha do tempo do contato precisa. Sem telefone nem texto — so' o que foi decidido.
      if (data.follow_up) {
        A.registrarAuditoria(pool, req.empresa.id, {
          usuarioId: req.usuario?.id, entidadeTipo: 'follow_up', entidadeId: data.follow_up.id,
          acao: 'follow_up_criado', estadoNovo: 'aguardando',
          contexto: { origem: 'ligacao', canal: data.follow_up.canal, ligacao_id: data.id },
        })
      }
    }
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'LIGACAO_ENCERRAR_FAILED') }
})

// POST /:id/descartar — descarta a operacao (idempotente): fica so para auditoria.
router.post('/:id/descartar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await L.descartarLigacao(pool, req.empresa.id, req.params.id, { motivo: (req.body || {}).motivo })
    if (!data.ja_descartada) {
      A.registrarAuditoria(pool, req.empresa.id, { usuarioId: req.usuario?.id, entidadeTipo: 'ligacao', entidadeId: data.id, acao: 'ligacao_descartada', estadoAnterior: 'em_andamento', estadoNovo: 'descartada', contexto: { motivo: (req.body || {}).motivo || null } })
    }
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'LIGACAO_DESCARTAR_FAILED') }
})

// POST /:id/sinais — registra um sinal (interesse|resistencia) na hora (persistencia imediata).
router.post('/:id/sinais', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const b = req.body || {}
    const data = await S.registrarSinal(pool, req.empresa.id, req.params.id, {
      tipo: b.tipo, texto: b.texto, origem: b.origem,
      roteiroVersaoId: b.roteiro_versao_id, roteiroEtapaId: b.roteiro_etapa_id, etapaTipo: b.etapa_tipo,
      usuarioId: req.usuario?.id, clientEventId: b.client_event_id,
    })
    return res.status(data.idempotente ? 200 : 201).json({ ok: true, data })
  } catch (err) { return erro(res, err, 'LIGACAO_SINAL_REGISTRAR_FAILED') }
})

// GET /:id/sinais — sinais ativos da ligacao (reconstrucao da selecao / recuperacao).
router.get('/:id/sinais', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await S.listarSinais(pool, req.empresa.id, req.params.id)
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'LIGACAO_SINAIS_LIST_FAILED') }
})

// DELETE /:id/sinais/:sinalId — desmarca (soft-remove) um sinal. Idempotente.
router.delete('/:id/sinais/:sinalId', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await S.removerSinal(pool, req.empresa.id, req.params.id, req.params.sinalId)
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'LIGACAO_SINAL_REMOVER_FAILED') }
})

// POST /:id/objecoes — registra uma objecao na hora (persistencia imediata).
router.post('/:id/objecoes', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const b = req.body || {}
    const data = await O.registrarObjecao(pool, req.empresa.id, req.params.id, {
      texto: b.texto, origem: b.origem, respostaUtilizada: b.resposta_utilizada,
      objecaoRoteiroId: b.objecao_roteiro_id,
      roteiroVersaoId: b.roteiro_versao_id, roteiroEtapaId: b.roteiro_etapa_id, etapaTipo: b.etapa_tipo,
      usuarioId: req.usuario?.id, clientEventId: b.client_event_id,
    })
    return res.status(data.idempotente ? 200 : 201).json({ ok: true, data })
  } catch (err) { return erro(res, err, 'LIGACAO_OBJECAO_REGISTRAR_FAILED') }
})

// GET /:id/objecoes — objecoes ativas da ligacao (reconstrucao da selecao / recuperacao).
router.get('/:id/objecoes', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await O.listarObjecoes(pool, req.empresa.id, req.params.id)
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'LIGACAO_OBJECOES_LIST_FAILED') }
})

// PATCH /:id/objecoes/:objId — resposta utilizada e/ou resolvida.
router.patch('/:id/objecoes/:objId', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const b = req.body || {}
    const data = await O.atualizarObjecao(pool, req.empresa.id, req.params.id, req.params.objId, {
      respostaUtilizada: b.resposta_utilizada, resolvida: b.resolvida,
    })
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'LIGACAO_OBJECAO_UPDATE_FAILED') }
})

// DELETE /:id/objecoes/:objId — desmarca (soft-remove) uma objecao. Idempotente.
router.delete('/:id/objecoes/:objId', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await O.removerObjecao(pool, req.empresa.id, req.params.id, req.params.objId)
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'LIGACAO_OBJECAO_REMOVER_FAILED') }
})

// GET /:id/etapas — ocorrencias temporais da ligacao (todas). Fonte oficial de duracao/etapa.
router.get('/:id/etapas', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await E.listarEtapas(pool, req.empresa.id, req.params.id)
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'LIGACAO_ETAPAS_LIST_FAILED') }
})

// GET /:id/etapas/ativa — ocorrencia ativa (recuperacao da navegacao). null se nao houver.
router.get('/:id/etapas/ativa', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await E.obterEtapaAtiva(pool, req.empresa.id, req.params.id)
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'LIGACAO_ETAPA_ATIVA_FAILED') }
})

// POST /:id/etapas/iniciar — abre uma etapa (idempotente; devolve a ativa se ja houver).
router.post('/:id/etapas/iniciar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const b = req.body || {}
    const data = await E.abrirEtapa(pool, req.empresa.id, req.params.id, {
      roteiroEtapaId: b.roteiro_etapa_id, usuarioId: req.usuario?.id, clientEventId: b.client_event_id,
    })
    return res.status(data.idempotente || data.ja_ativa ? 200 : 201).json({ ok: true, data })
  } catch (err) { return erro(res, err, 'LIGACAO_ETAPA_INICIAR_FAILED') }
})

// POST /:id/etapas/trocar — fecha a etapa ativa e abre a destino na mesma transacao.
router.post('/:id/etapas/trocar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const b = req.body || {}
    const data = await E.trocarEtapa(pool, req.empresa.id, req.params.id, {
      roteiroEtapaId: b.roteiro_etapa_id, usuarioId: req.usuario?.id, clientEventId: b.client_event_id,
    })
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'LIGACAO_ETAPA_TROCAR_FAILED') }
})

// POST /:id/perguntas — marca uma pergunta do roteiro como feita (persistencia imediata).
router.post('/:id/perguntas', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const b = req.body || {}
    const data = await Q.registrarPergunta(pool, req.empresa.id, req.params.id, {
      texto: b.texto, perguntaIndice: b.pergunta_indice,
      roteiroVersaoId: b.roteiro_versao_id, roteiroEtapaId: b.roteiro_etapa_id, etapaTipo: b.etapa_tipo,
      usuarioId: req.usuario?.id, clientEventId: b.client_event_id,
    })
    return res.status(data.idempotente ? 200 : 201).json({ ok: true, data })
  } catch (err) { return erro(res, err, 'LIGACAO_PERGUNTA_REGISTRAR_FAILED') }
})

// GET /:id/perguntas — perguntas marcadas (reconstrucao da selecao / recuperacao).
router.get('/:id/perguntas', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await Q.listarPerguntas(pool, req.empresa.id, req.params.id)
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'LIGACAO_PERGUNTAS_LIST_FAILED') }
})

// DELETE /:id/perguntas/:pid — desmarca (status 'desmarcada'). Idempotente.
router.delete('/:id/perguntas/:pid', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await Q.removerPergunta(pool, req.empresa.id, req.params.id, req.params.pid)
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'LIGACAO_PERGUNTA_REMOVER_FAILED') }
})

// GET /analiticas — ligacoes ENCERRADAS com agregados (le a view; fonte oficial da analitica).
// Filtros: ?campanha_id | ?prospect_id | ?limit
router.get('/analiticas', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await AN.listarLigacoesEncerradas(pool, req.empresa.id, {
      campanhaId: req.query.campanha_id, prospectId: req.query.prospect_id, limit: req.query.limit,
    })
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'LIGACOES_ANALITICAS_FAILED') }
})

// GET /:id/auditoria — historico de auditoria desta ligacao (quem fez o que, quando).
router.get('/:id/auditoria', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await A.listarAuditoria(pool, req.empresa.id, { entidadeTipo: 'ligacao', entidadeId: req.params.id })
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'LIGACAO_AUDITORIA_FAILED') }
})

// PATCH /:id/notas — salva incrementalmente o registro rapido (notas livres) durante a ligacao.
router.patch('/:id/notas', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await L.atualizarNotas(pool, req.empresa.id, req.params.id, (req.body || {}).notas)
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'LIGACAO_NOTAS_UPDATE_FAILED') }
})

// GET / — historico de ligacoes. Filtros: ?campanha_lead_id | ?prospect_id | ?campanha_id
router.get('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await L.listarLigacoes(pool, req.empresa.id, {
      campanhaLeadId: req.query.campanha_lead_id, prospectId: req.query.prospect_id,
      campanhaId: req.query.campanha_id, limit: req.query.limit,
    })
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'LIGACOES_LIST_FAILED') }
})

module.exports = router
