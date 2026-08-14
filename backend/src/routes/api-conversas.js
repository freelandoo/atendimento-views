'use strict'
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const { gerarESalvarResumo, buscarUltimoResumo } = require('../services/resumo-conversa')
const { logger } = require('../logger')
const { enviarMensagem } = require('../whatsapp')
const { calcularScoreInteresseLead } = require('../services/lead-interest-score')
const {
  enviarMensagemManualOperador,
  alterarPausaAgenteConversa,
  alterarModoIaConversa,
} = require('../services/conversa-manual')
const { gerarOrientacaoResposta } = require('../services/orientador-resposta')
const { registrarFeedbackConversa } = require('../services/conversa-feedback')
const { modoIaPadraoEmpresa } = require('../db/empresas')
const { modoEfetivo } = require('../services/conversa-modo-ia')
const { anexarNomeExibicao } = require('../services/lead-nome-exibicao')
const { buscarNomesMapsPorTelefone } = require('../db/lead-nome-maps')

const router = Router({ mergeParams: true })
const PJ_EMPRESA_ID = '00000000-0000-0000-0000-000000000001'

function conversaEmpresaScope(alias = 'c') {
  const prefix = alias ? `${alias}.` : ''
  return `(${prefix}empresa_id = $1 OR ($1::uuid = $2::uuid AND ${prefix}empresa_id IS NULL))`
}

const LEAD_PROFILE_JOIN = `
       LEFT JOIN LATERAL (
         SELECT lp.*
           FROM vendas.lead_profiles lp
          WHERE lp.numero = c.numero
            AND (lp.empresa_id = c.empresa_id OR lp.empresa_id IS NULL)
          ORDER BY CASE WHEN lp.empresa_id = c.empresa_id THEN 0 ELSE 1 END,
                   lp.atualizado_em DESC NULLS LAST
          LIMIT 1
       ) lp ON true`

function anexarScoreInteresse(conversa) {
  const interesse = calcularScoreInteresseLead(conversa, {
    historico: conversa?.historico,
    estagio: conversa?.estagio,
    atualizadoEm: conversa?.atualizado_em,
  })
  return {
    ...conversa,
    score_interesse: interesse.score,
    score_interesse_faixa: interesse.faixa,
    score_interesse_label: interesse.label,
    score_interesse_resumo: interesse.resumo,
    score_interesse_criterios: interesse.criterios,
    score_interesse_mensagens_lead: interesse.mensagens_lead,
  }
}

/**
 * Resolve o nome de EXIBICAO de um lote de conversas (a pagina inteira de uma vez).
 *
 * A ordem de prioridade nao esta aqui nem no SQL: ela vive em
 * `src/services/lead-nome-exibicao.js`. Esta funcao so' junta as fontes — o pushName ja vem
 * na propria linha (`c.nome_whatsapp`) e o nome do Maps sai de UMA consulta por pagina.
 *
 * Falha ao consultar o Maps NAO derruba a listagem: o nome cai para o que o WhatsApp deu, que
 * e' a prioridade 1 de qualquer forma. Uma coluna de nome incompleta e' um problema menor do
 * que uma Central de Mensagens que nao abre.
 */
async function anexarNomesExibicao(conversas, empresaId) {
  const lista = Array.isArray(conversas) ? conversas : []
  if (lista.length === 0) return lista
  let nomesMaps = new Map()
  try {
    nomesMaps = await buscarNomesMapsPorTelefone(pool, {
      empresaId,
      numeros: lista.map((c) => c && c.numero).filter(Boolean),
    })
  } catch (err) {
    logger.warn({ err: err?.message }, '[api-conversas] nome do Maps indisponivel; usando so o do WhatsApp')
  }
  return lista.map((c) => anexarNomeExibicao(c, nomesMaps.get(c && c.numero) || null))
}

function erroConversas(res, err, code = 'CONVERSAS_FAILED') {
  const status = err?.statusCode || 500
  const errorCode = err?.code || code
  if (status >= 500) {
    logger.error({ err: err?.message, code: errorCode }, '[api-conversas] falha')
  } else {
    logger.warn({ err: err?.message, code: errorCode }, '[api-conversas] operacao recusada')
  }
  const message = status >= 500
    ? 'Nao foi possivel concluir a operacao.'
    : (err?.message || 'Dados invalidos.')
  return res.status(status).json({ ok: false, error: { code: errorCode, message } })
}

// GET /api/empresas/:empresaId/conversas?page=1&limit=50&status=ativo&numero=5511
router.get('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50))
  const offset = (page - 1) * limit
  const { status, estagio } = req.query
  const numero = String(req.query.numero || '').replace(/\D/g, '').slice(0, 20)

  const conds = [conversaEmpresaScope('c')]
  const vals = [req.empresa.id, PJ_EMPRESA_ID]

  if (status) { conds.push(`c.status = $${vals.push(status)}`); }
  if (estagio) { conds.push(`c.estagio = $${vals.push(estagio)}`); }
  if (numero) {
    conds.push(`regexp_replace(c.numero, '[^0-9]', '', 'g') LIKE $${vals.push(`%${numero}%`)}`)
  }

  const where = conds.join(' AND ')

  const limitParam = vals.length + 1
  const offsetParam = vals.length + 2
  const [{ rows }, { rows: [cnt] }] = await Promise.all([
    pool.query(
      `SELECT c.*, lp.negocio, lp.cidade, lp.temperatura_lead, lp.score_dor, lp.score_lead,
              lp.dor_principal, lp.ja_aparece_google, lp.precisa_sistema,
              lp.produto_sugerido, lp.intencao_principal, lp.insights_lead,
              lp.reuniao_proposta
       FROM vendas.conversas c
       ${LEAD_PROFILE_JOIN}
       WHERE ${where}
       ORDER BY c.atualizado_em DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...vals, limit, offset]
    ),
    pool.query(
      `SELECT COUNT(*) AS total FROM vendas.conversas c WHERE ${where}`,
      vals
    ),
  ])

  return res.json({
    ok: true,
    data: await anexarNomesExibicao(rows.map(anexarScoreInteresse), req.empresa.id),
    meta: { total: parseInt(cnt.total, 10), page, limit },
  })
})

/**
 * O modo EFETIVO e a ORIGEM sao calculados AQUI, no backend, e nunca persistidos.
 *
 * Por que no backend: a precedencia (excecao da conversa > padrao da Central) e' a MESMA
 * regra que decide o envio. Se a tela recalculasse, existiriam duas implementacoes da
 * prioridade e a interface poderia afirmar "Conversa" enquanto o motor cala. A tela so
 * desenha o que vem daqui.
 *
 * Por que nao persistido: uma copia gravada envelheceria no instante em que o modo global
 * mudasse — e o requisito e' que conversas em `herdar` acompanhem o global imediatamente.
 */
async function anexarModoIa(conversa, empresaId) {
  const padrao = await modoIaPadraoEmpresa(empresaId)
  const efetivo = modoEfetivo({ preferencia: conversa?.modo_ia, modoGlobal: padrao })
  return {
    ...conversa,
    modo_ia: efetivo.preferencia,
    modo_ia_padrao: efetivo.modo_global,
    modo_ia_efetivo: efetivo.modo,
    modo_ia_origem: efetivo.origem,
  }
}

// GET /api/empresas/:empresaId/conversas/:numero
router.get('/:numero', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows: [conversa] } = await pool.query(
    `SELECT c.*, lp.*, c.numero AS numero, c.empresa_id AS empresa_id, c.atualizado_em AS atualizado_em
     FROM vendas.conversas c
     ${LEAD_PROFILE_JOIN}
     WHERE ${conversaEmpresaScope('c')} AND c.numero = $3`,
    [req.empresa.id, PJ_EMPRESA_ID, req.params.numero]
  )
  if (!conversa) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Conversa não encontrada.' } })
  const [comNome] = await anexarNomesExibicao([anexarScoreInteresse(conversa)], req.empresa.id)
  return res.json({ ok: true, data: await anexarModoIa(comNome, req.empresa.id) })
})

// DELETE /api/empresas/:empresaId/conversas/:numero
// Remove o contato inteiro (conversa + lead_profile + lead_insights).
router.delete('/:numero', requireAuth, requireEmpresaAccess, async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `DELETE FROM app.lead_insights WHERE empresa_id = $1 AND numero = $2`,
      [req.empresa.id, req.params.numero]
    )
    await client.query(
      `DELETE FROM vendas.lead_profiles WHERE numero = $1`,
      [req.params.numero]
    )
    const { rowCount } = await client.query(
      `DELETE FROM vendas.conversas WHERE ${conversaEmpresaScope('')} AND numero = $3`,
      [req.empresa.id, PJ_EMPRESA_ID, req.params.numero]
    )
    await client.query('COMMIT')
    if (rowCount === 0) {
      return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Conversa não encontrada.' } })
    }
    return res.json({ ok: true, data: { numero: req.params.numero, deleted: true } })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    return res.status(500).json({ ok: false, error: { code: 'DELETE_FAILED', message: err.message } })
  } finally {
    client.release()
  }
})

// DELETE /api/empresas/:empresaId/conversas/:numero/historico
// Limpa o histórico de mensagens da conversa (mantém a linha — reset agente_pausado e estagio).
router.delete('/:numero/historico', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows: [c] } = await pool.query(
    `UPDATE vendas.conversas
        SET historico = '[]'::jsonb,
            estagio = 'primeiro_contato',
            agente_pausado = false,
            empresa_id = COALESCE(empresa_id, $1::uuid),
            atualizado_em = NOW()
      WHERE ${conversaEmpresaScope('')} AND numero = $3
      RETURNING numero, estagio, status, agente_pausado`,
    [req.empresa.id, PJ_EMPRESA_ID, req.params.numero]
  )
  if (!c) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Conversa não encontrada.' } })
  // Limpa também lead_insights desta conversa (mensagens analíticas do playbook runtime)
  await pool.query(
    `DELETE FROM app.lead_insights
      WHERE empresa_id = $1 AND numero = $2 AND tipo = 'playbook_runtime'`,
    [req.empresa.id, req.params.numero]
  ).catch(() => {})
  return res.json({ ok: true, data: c })
})

// POST /api/empresas/:empresaId/conversas/:numero/reprocessar
// Reenvia a ultima resposta do agente quando ela ja esta no historico, mas nao chegou no WhatsApp.
router.post('/:numero/reprocessar', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows: [conversa] } = await pool.query(
    `SELECT numero, historico, evolution_instance
       FROM vendas.conversas
      WHERE ${conversaEmpresaScope('')} AND numero = $3`,
    [req.empresa.id, PJ_EMPRESA_ID, req.params.numero]
  )
  if (!conversa) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Conversa nao encontrada.' } })

  const historico = Array.isArray(conversa.historico) ? conversa.historico : []
  const ultimaResposta = historico[historico.length - 1]
  if (!ultimaResposta || ultimaResposta.role !== 'assistant') {
    return res.status(400).json({ ok: false, error: { code: 'LAST_MESSAGE_NOT_ASSISTANT', message: 'A ultima mensagem do historico nao e uma resposta do agente.' } })
  }
  const texto = String(ultimaResposta?.content || ultimaResposta?.text || '').trim()
  if (!texto) {
    return res.status(400).json({ ok: false, error: { code: 'NO_ASSISTANT_MESSAGE', message: 'Nenhuma resposta do agente para reenviar.' } })
  }

  try {
    // O `empresaId` vai junto pelo mesmo motivo do envio manual do operador
    // (`conversa-manual.js`): a regra unica confere a instancia contra as DUAS empresas que
    // podem discordar. Sem ele, uma conversa ORFA (`empresa_id IS NULL`, alcancavel pela PJ
    // em `conversaEmpresaScope`) que tenha a instancia de OUTRO tenant gravada passaria na
    // conferencia — o reenvio sairia pelo numero da outra empresa.
    await enviarMensagem(
      conversa.numero,
      texto,
      conversa.evolution_instance
        ? { instanceName: conversa.evolution_instance, empresaId: req.empresa.id }
        : { empresaId: req.empresa.id }
    )
    await pool.query(
      `UPDATE vendas.conversas
          SET ultima_falha_resposta_codigo = NULL,
              ultima_falha_resposta_msg = NULL,
              ultima_falha_resposta_em = NULL,
              empresa_id = COALESCE(empresa_id, $1::uuid),
              atualizado_em = NOW()
        WHERE ${conversaEmpresaScope('')} AND numero = $3`,
      [req.empresa.id, PJ_EMPRESA_ID, conversa.numero]
    )
    return res.json({ ok: true, data: { numero: conversa.numero, reenviado: true, trecho: texto.slice(0, 200) } })
  } catch (err) {
    // Bloqueio de instancia NAO e falha de transporte: e estado do cadastro que exige acao
    // humana. Mesmo contrato (409 `INSTANCE_UNAVAILABLE`) do envio manual do operador.
    if (err?.instanciaBloqueada) {
      logger.warn(
        { numero: conversa.numero, motivo: err.motivo, empresa_id: req.empresa.id },
        'Reenvio bloqueado por instancia nao comprovada'
      )
      return res.status(409).json({ ok: false, error: { code: 'INSTANCE_UNAVAILABLE', message: err.message } })
    }
    logger.error({ err: err.message, numero: conversa.numero }, 'Reprocessar conversa falhou')
    return res.status(502).json({ ok: false, error: { code: 'WHATSAPP_SEND_FAILED', message: err.message || 'Falha ao reenviar WhatsApp.' } })
  }
})

// POST /api/empresas/:empresaId/conversas/:numero/mensagem
// Envia uma mensagem escrita pelo operador e registra no historico como role=operator.
router.post('/:numero/mensagem', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const out = await enviarMensagemManualOperador({
      pool,
      empresaId: req.empresa.id,
      numero: req.params.numero,
      texto: req.body?.texto,
      assumir: req.body?.assumir !== false,
      operadorId: req.usuario?.id || null,
      log: logger,
    })
    return res.status(201).json({ ok: true, data: out })
  } catch (err) {
    return erroConversas(res, err, 'MANUAL_MESSAGE_FAILED')
  }
})

// POST /api/empresas/:empresaId/conversas/:numero/feedback
// Registra avaliacao humana de uma resposta do agente; negativo cria sugestao pendente.
router.post('/:numero/feedback', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const out = await registrarFeedbackConversa({
      pool,
      empresaId: req.empresa.id,
      numero: req.params.numero,
      mensagemIndex: req.body?.mensagem_index,
      tipo: req.body?.tipo,
      tags: req.body?.tags,
      observacao: req.body?.observacao,
      usuarioId: req.usuario?.id || null,
      log: logger,
    })
    return res.status(201).json({
      ok: true,
      data: {
        feedback_id: out.feedback?.id,
        tipo: out.feedback?.tipo,
        criou_sugestao: out.criou_sugestao,
        sugestao_id: out.sugestao?.id || null,
        contexto_versao_id: out.contexto_versao_id || null,
      },
    })
  } catch (err) {
    return erroConversas(res, err, 'CONVERSA_FEEDBACK_FAILED')
  }
})

// PATCH /api/empresas/:empresaId/conversas/:numero/agente
// Pausa ou retoma as respostas automaticas apenas desta conversa.
router.patch('/:numero/agente', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const out = await alterarPausaAgenteConversa({
      pool,
      empresaId: req.empresa.id,
      numero: req.params.numero,
      pausado: req.body?.pausado,
      log: logger,
    })
    return res.json({ ok: true, data: out })
  } catch (err) {
    return erroConversas(res, err, 'AGENT_PAUSE_FAILED')
  }
})

// PATCH /api/empresas/:empresaId/conversas/:numero/modo-ia
// Body: { modo: 'herdar' | 'conversa' | 'analise' } — a PREFERENCIA da conversa. `herdar`
// remove a excecao e devolve a conversa ao modo padrao da Central.
//
// O estado atual nao tem rota de leitura propria de proposito: `GET /:numero` ja devolve
// preferencia, padrao global, modo efetivo e origem — o painel nao faz requisicao extra.
// A resposta deste PATCH traz os MESMOS campos derivados, para a tela nao precisar recarregar.
router.patch('/:numero/modo-ia', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const out = await alterarModoIaConversa({
      pool,
      empresaId: req.empresa.id,
      numero: req.params.numero,
      modo: req.body?.modo,
      usuarioId: req.usuario?.id || null,
      log: logger,
    })
    return res.json({ ok: true, data: await anexarModoIa(out, req.empresa.id) })
  } catch (err) {
    return erroConversas(res, err, 'CONVERSA_MODO_IA_FAILED')
  }
})

// POST /api/empresas/:empresaId/conversas/:numero/orientador-resposta
// Gera uma sugestao editavel e uma explicacao para o operador. Nao envia mensagem.
router.post('/:numero/orientador-resposta', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const out = await gerarOrientacaoResposta({
      pool,
      empresaId: req.empresa.id,
      numero: req.params.numero,
      rascunho: req.body?.rascunho || '',
      log: logger,
    })
    return res.json({ ok: true, data: out })
  } catch (err) {
    return erroConversas(res, err, 'RESPONSE_COACH_FAILED')
  }
})

// GET /api/empresas/:empresaId/conversas/:numero/resumo
router.get('/:numero/resumo', requireAuth, requireEmpresaAccess, async (req, res) => {
  const resumo = await buscarUltimoResumo(pool, {
    empresaId: req.empresa.id,
    numero: req.params.numero,
  })
  if (!resumo) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Nenhum resumo encontrado.' } })
  return res.json({ ok: true, data: { resumo } })
})

// POST /api/empresas/:empresaId/conversas/:numero/resumo
// Body: { historico: [...] }
router.post('/:numero/resumo', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { historico } = req.body || {}
  if (!Array.isArray(historico) || historico.length === 0) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'historico obrigatório.' } })
  }
  const resumo = await gerarESalvarResumo(pool, {
    empresaId: req.empresa.id,
    numero: req.params.numero,
    historico,
    log: logger,
  })
  return res.status(201).json({ ok: true, data: { resumo } })
})

module.exports = router
