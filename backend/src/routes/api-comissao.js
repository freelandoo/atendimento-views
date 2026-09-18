'use strict'
// Comissao do comercial — rotas.
//
// AUTORIZACAO EM DOIS NIVEIS, e a separacao e' a regra de negocio:
//   * o MOUNT exige `COMISSAO_VER_PROPRIA` — ver o proprio dinheiro e' parte do trabalho;
//   * cada ESCRITA exige `COMISSAO_GERENCIAR` — quem define quanto se paga nao pode ser quem
//     recebe. Sem o gate por rota, montar o modulo com a capacidade de leitura deixaria o
//     proprio SDR registrar a venda dele e dar baixa no pagamento.
//
// O RECORTE tambem e' por capacidade: sem `COMISSAO_GERENCIAR`, toda leitura e' filtrada pelo
// proprio usuario. Nao e' filtro de tela — a carteira dos colegas nao e' recorte do SDR.
//
// Regras PURAS em `src/services/comissao.js`; SQL em `src/db/comissao.js`.

const express = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess, requireCapacidade } = require('../middleware/tenant')
const { CAPACIDADES: CAP, podeCapacidade } = require('../services/acesso-capacidades')
const { logger } = require('../logger')
const CM = require('../services/comissao')
const DB = require('../db/comissao')

const router = express.Router({ mergeParams: true })

const APP_TIMEZONE = process.env.APP_TIMEZONE || process.env.TZ || 'America/Sao_Paulo'

function envelopeErro(res, err, code = 'COMISSAO_FAILED') {
  const status = err?.status || 500
  logger.error({ err: err?.message, code }, '[api-comissao] falha')
  const message = status >= 500 ? 'Não foi possível concluir a operação.' : (err?.message || 'Dados inválidos.')
  return res.status(status).json({ ok: false, error: { code, message } })
}

const erro400 = (res, issues) =>
  res.status(400).json({ ok: false, error: { code: 'DADOS_INVALIDOS', message: issues.join(' ') } })

/** Competência corrente no fuso da OPERAÇÃO, não no UTC do container. */
function competenciaCorrente() {
  const agora = new Date().toLocaleString('en-CA', { timeZone: APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
  return `${String(agora).slice(0, 7)}-01`
}

function competenciaPedida(req) {
  const v = String(req.query.competencia || '').trim()
  return /^\d{4}-\d{2}-01$/.test(v) ? v : competenciaCorrente()
}

// Mesmo formato de vínculo que `requireCapacidade` monta — inclusive `papelPlataforma`, senão o
// superadmin cairia no recorte de "só as minhas vendas" dentro de uma empresa que ele administra.
const podeGerenciar = (req) => podeCapacidade({
  papel: req.papelEmpresa,
  permissoes: req.vinculoEmpresa ? req.vinculoEmpresa.permissoes : null,
  papelPlataforma: req.usuario?.role,
}, CAP.COMISSAO_GERENCIAR)

// Auditoria: registrar dinheiro sem dizer quem registrou tornaria a transparência do programa
// impossível de sustentar numa divergência. Nunca entra telefone nem texto livre do cliente.
async function auditar(req, { acao, entidadeId, estadoAnterior = null, estadoNovo = null, contexto = null }) {
  try {
    await pool.query(
      `INSERT INTO app.auditoria_eventos
         (empresa_id, usuario_id, entidade_tipo, entidade_id, acao, estado_anterior, estado_novo, contexto)
       VALUES ($1, $2::uuid, 'venda', $3::uuid, $4, $5, $6, $7::jsonb)`,
      [req.empresa.id, req.usuario?.id || null, entidadeId, acao, estadoAnterior, estadoNovo,
        contexto ? JSON.stringify(contexto) : null]
    )
  } catch (err) {
    logger.error({ err: err.message, acao }, '[api-comissao] auditoria falhou')
  }
}

// ─── Plano ───────────────────────────────────────────────────────────────────────────

// O SDR PRECISA ver as faixas: um plano de comissão que a pessoa não consegue ler não motiva
// ninguém. O que ele não pode é alterá-las.
router.get('/plano', async (req, res) => {
  try {
    const plano = await DB.planoAtivo(pool, req.empresa.id)
    return res.json({ ok: true, data: plano, meta: { pode_gerenciar: podeGerenciar(req) } })
  } catch (err) { return envelopeErro(res, err) }
})

// PUT publica uma VERSÃO NOVA — nunca edita a vigente (ver `publicarPlano`).
router.put('/plano', requireAuth, requireEmpresaAccess, requireCapacidade(CAP.COMISSAO_GERENCIAR), async (req, res) => {
  try {
    const v = CM.validarPlano(req.body || {})
    if (!v.ok) return erro400(res, v.issues)
    const plano = await DB.publicarPlano(req.empresa.id, v.valor, req.usuario?.id)
    await auditar(req, {
      acao: 'comissao_plano_publicado',
      entidadeId: null,
      estadoNovo: `v${plano.versao}`,
      contexto: { plano_slug: plano.slug, versao: plano.versao, faixas: v.valor.faixas.length },
    })
    return res.json({ ok: true, data: plano })
  } catch (err) { return envelopeErro(res, err) }
})

// ─── Painel do SDR ───────────────────────────────────────────────────────────────────

// É a tela que o programa promete: nível atual, quanto falta para o próximo, e o que já entrou.
// `usuario_id` só é aceito de quem gerencia — senão um SDR leria o painel do colega pela URL.
router.get('/painel', async (req, res) => {
  try {
    const empresaId = req.empresa.id
    const gerencia = podeGerenciar(req)
    const alvo = (gerencia && req.query.usuario_id) ? String(req.query.usuario_id) : req.usuario.id
    const competencia = competenciaPedida(req)

    const [plano, acumulado, vendas] = await Promise.all([
      DB.planoAtivo(pool, empresaId),
      DB.acumuladoDoMes(empresaId, alvo, competencia),
      DB.listarVendas(empresaId, { originadorId: alvo, competencia, limite: 100 }),
    ])

    // Sem plano ativo, o painel NÃO inventa faixa: diz que o programa não está configurado.
    // Mostrar 0% seria afirmar uma regra que ninguém combinou.
    const nivel = plano ? CM.nivelAtual(acumulado.originado, plano.faixas_json) : null

    return res.json({
      ok: true,
      data: {
        competencia,
        plano: plano ? { nome: plano.nome, slug: plano.slug, versao: plano.versao, faixas: plano.faixas_json, gatilho: plano.gatilho } : null,
        nivel,
        originado: acumulado.originado,
        comissao: acumulado.comissao,
        comissao_paga: acumulado.comissao_paga,
        vendas_creditadas: acumulado.vendas,
        vendas,
      },
      meta: { usuario_id: alvo, pode_gerenciar: gerencia },
    })
  } catch (err) { return envelopeErro(res, err) }
})

// ─── Ranking ─────────────────────────────────────────────────────────────────────────

// Por FATURAMENTO PAGO ORIGINADO, nunca por número de reuniões nem por atividade. A guarda de
// `frontend/lib/equipe-painel.js` (que proíbe placar de ATIVIDADE) continua valendo e não foi
// tocada: resultado de negócio verificável é outra coisa que vigilância de esforço.
router.get('/ranking', async (req, res) => {
  try {
    const competencia = competenciaPedida(req)
    const ranking = await DB.rankingDoMes(req.empresa.id, competencia)
    return res.json({ ok: true, data: { competencia, ranking }, meta: { usuario_id: req.usuario.id } })
  } catch (err) { return envelopeErro(res, err) }
})

// ─── Vendas ──────────────────────────────────────────────────────────────────────────

router.get('/vendas', async (req, res) => {
  try {
    const gerencia = podeGerenciar(req)
    const vendas = await DB.listarVendas(req.empresa.id, {
      originadorId: gerencia ? (req.query.usuario_id || null) : req.usuario.id,
      competencia: /^\d{4}-\d{2}-01$/.test(String(req.query.competencia || '')) ? req.query.competencia : null,
      status: req.query.status || null,
      limite: req.query.limit,
    })
    return res.json({
      ok: true,
      data: vendas,
      meta: { escopo: gerencia ? 'empresa' : 'minhas', pode_gerenciar: gerencia },
    })
  } catch (err) { return envelopeErro(res, err) }
})

router.post('/vendas', requireAuth, requireEmpresaAccess, requireCapacidade(CAP.COMISSAO_GERENCIAR), async (req, res) => {
  try {
    const v = CM.validarVenda(req.body || {})
    if (!v.ok) return erro400(res, v.issues)
    const venda = await DB.registrarVenda(req.empresa.id, v.valor, req.usuario?.id)
    await auditar(req, {
      acao: 'venda_registrada',
      entidadeId: venda.id,
      estadoNovo: venda.status,
      contexto: {
        valor: Number(venda.valor),
        originador_origem: venda.originador_origem,
        de_reuniao: Boolean(venda.agenda_evento_id),
      },
    })
    return res.status(201).json({ ok: true, data: venda })
  } catch (err) { return envelopeErro(res, err) }
})

// O detalhe carrega o ledger inteiro: é ele que responde "por que a minha comissão é essa?".
router.get('/vendas/:vendaId', async (req, res) => {
  try {
    const venda = await DB.obterVenda(req.empresa.id, req.params.vendaId)
    // 404, nunca 403: dizer "existe, mas não é sua" já entrega que houve uma venda ali.
    if (!venda) return res.status(404).json({ ok: false, error: { code: 'NAO_ENCONTRADA', message: 'Venda não encontrada.' } })
    if (!podeGerenciar(req) && venda.originador_id !== req.usuario.id) {
      return res.status(404).json({ ok: false, error: { code: 'NAO_ENCONTRADA', message: 'Venda não encontrada.' } })
    }
    const pagamentos = await DB.listarPagamentos(req.empresa.id, venda.id)
    return res.json({ ok: true, data: { ...venda, pagamentos } })
  } catch (err) { return envelopeErro(res, err) }
})

// ─── Recebimento — o gatilho da comissão ─────────────────────────────────────────────

router.post('/vendas/:vendaId/pagamentos', requireAuth, requireEmpresaAccess, requireCapacidade(CAP.COMISSAO_GERENCIAR), async (req, res) => {
  try {
    const v = CM.validarPagamento(req.body || {})
    if (!v.ok) return erro400(res, v.issues)

    const r = await DB.registrarPagamento(req.empresa.id, req.params.vendaId, v.valor, req.usuario?.id)
    if (!r.ok) {
      if (r.motivo === 'nao_encontrada') {
        return res.status(404).json({ ok: false, error: { code: 'NAO_ENCONTRADA', message: 'Venda não encontrada.' } })
      }
      // 409 e não 500: os dois casos são estado do negócio e exigem ação de uma pessoa, não
      // investigação de defeito.
      const msg = r.motivo === 'pagamento_duplicado'
        ? 'Esse recebimento já foi lançado (mesma referência).'
        : 'A venda está cancelada e não aceita recebimento.'
      return res.status(409).json({ ok: false, error: { code: r.motivo.toUpperCase(), message: msg } })
    }

    await auditar(req, {
      acao: 'venda_pagamento_registrado',
      entidadeId: req.params.vendaId,
      estadoNovo: r.credito ? 'comissao_liberada' : 'aguardando_pagamento',
      contexto: {
        valor: v.valor.valor,
        liberou_comissao: Boolean(r.credito),
        percentual: r.credito?.comissao_percentual ?? null,
        competencia: r.credito?.competencia ?? null,
      },
    })

    const venda = await DB.obterVenda(req.empresa.id, req.params.vendaId)
    return res.status(201).json({ ok: true, data: { venda, credito: r.credito } })
  } catch (err) { return envelopeErro(res, err) }
})

// ─── Baixa da comissão (o lote semanal) ──────────────────────────────────────────────

router.post('/vendas/:vendaId/comissao/pagar', requireAuth, requireEmpresaAccess, requireCapacidade(CAP.COMISSAO_GERENCIAR), async (req, res) => {
  try {
    const paga = await DB.marcarComissaoPaga(
      req.empresa.id, req.params.vendaId,
      { referencia: String(req.body?.referencia || '').trim().slice(0, 120) || null },
      req.usuario?.id
    )
    if (!paga) {
      return res.status(409).json({
        ok: false,
        error: { code: 'COMISSAO_NAO_LIBERADA', message: 'Só é possível pagar comissão já liberada pelo recebimento do cliente.' },
      })
    }
    await auditar(req, {
      acao: 'comissao_paga',
      entidadeId: req.params.vendaId,
      estadoAnterior: 'comissao_liberada',
      estadoNovo: 'comissao_paga',
    })
    return res.json({ ok: true, data: paga })
  } catch (err) { return envelopeErro(res, err) }
})

router.post('/vendas/:vendaId/cancelar', requireAuth, requireEmpresaAccess, requireCapacidade(CAP.COMISSAO_GERENCIAR), async (req, res) => {
  try {
    const r = await DB.cancelarVenda(req.empresa.id, req.params.vendaId, req.body?.motivo)
    if (!r) {
      return res.status(409).json({
        ok: false,
        error: { code: 'VENDA_NAO_CANCELAVEL', message: 'Venda com comissão já liberada não pode ser cancelada — a comissão é um fato registrado.' },
      })
    }
    await auditar(req, { acao: 'venda_cancelada', entidadeId: req.params.vendaId, estadoNovo: 'cancelada' })
    return res.json({ ok: true, data: r })
  } catch (err) { return envelopeErro(res, err) }
})

module.exports = router
