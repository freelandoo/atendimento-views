'use strict'
// Banco de Leads — visão UNIFICADA do funil (Google Places + Instagram/LinkedIn),
// agrupada nos 3 estágios que o operador acompanha:
//   sem_contato → ainda não conversou (coletado/contato_encontrado/aguardando/aprovado)
//   conversou   → já houve diálogo (enviado/respondeu)
//   fecharam    → negócio fechado (status 'fechado', marcado MANUALMENTE — migration 013)
// Leads descartados (rejeitado/nao_contatar) ficam fora destas abas de propósito.
//
// Reaproveita prospectador.prospects (mesma tabela das duas origens). Read-only +
// duas transições manuais de status (fechar/reabrir) e export CSV. Isolado por tenant.
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const { atualizarEmailProspect } = require('../prospecting')
const { rodarLeads, gerarMensagensSemi, gerarPendentesSemi, dispararGerados, estadoEnvioInstancia, STATUS_RODAVEL } = require('../services/rodar-leads')
const { obterConfigBancoLeads, salvarConfigBancoLeads } = require('../db/banco-leads-config')
const {
  calcularScoreCadastroPlaces,
  montarJsonApresentacaoPlaces,
  calcularScoreCadastroInstagram,
  montarJsonApresentacaoInstagram,
} = require('../services/lead-score-cadastro')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

// Estágios expostos como abas. A ordem aqui é a ordem do funil.
const ABAS = {
  sem_contato: ['coletado', 'contato_encontrado', 'aguardando', 'aprovado'],
  conversou: ['enviado', 'respondeu'],
  fecharam: ['fechado'],
}
const ORIGENS_VALIDAS = new Set(['manual', 'automatico', 'instagram', 'linkedin'])

// Contato "agendado": tem evento FUTURO (pendente/confirmado). Le as DUAS agendas:
//  - app.agenda_eventos (migration 011): eventos criados manualmente no dashboard,
//    casados por telefone (só dígitos).
//  - vendas.agenda_eventos: reunioes marcadas pelo BOT (criarEventoAgenda). Nao tem
//    empresa_id/telefone diretos — casa via conversa/lead (mesma empresa) por telefone.
// Sem a segunda fonte, reunioes agendadas pelo bot nunca apareciam na aba "Agendados".
// normFone: so digitos, removendo o DDI 55 quando presente (length>=12) — casa o
// prospects.telefone (geralmente sem 55) com vendas.conversas.numero (JID com 55) sem
// corromper numeros de DDD 55.
const _foneDig = (col) => `regexp_replace(COALESCE(${col}, ''), '[^0-9]', '', 'g')`
const normFone = (col) => `(CASE WHEN length(${_foneDig(col)}) >= 12 AND left(${_foneDig(col)}, 2) = '55' THEN substr(${_foneDig(col)}, 3) ELSE ${_foneDig(col)} END)`
const AGENDA_VENDAS_FUTURA_EXISTS = `EXISTS (
  SELECT 1 FROM vendas.agenda_eventos ve
   WHERE ve.excluido_em IS NULL
     AND ve.tipo = 'reuniao'
     AND ve.status IN ('pendente', 'confirmado')
     AND ve.data_inicio >= NOW()
     AND NULLIF(${normFone('prospects.telefone')}, '') IS NOT NULL
     AND (
       EXISTS (SELECT 1 FROM vendas.conversas vc
                WHERE vc.id = ve.conversa_id AND vc.empresa_id = prospects.empresa_id
                  AND ${normFone('vc.numero')} = ${normFone('prospects.telefone')})
       OR EXISTS (SELECT 1 FROM vendas.lead_profiles vlp
                   WHERE vlp.id = ve.lead_id AND vlp.empresa_id = prospects.empresa_id
                     AND ${normFone('vlp.numero')} = ${normFone('prospects.telefone')})
     )
)`
const AGENDA_FUTURA_EXISTS = `(EXISTS (
  SELECT 1 FROM app.agenda_eventos ae
   WHERE ae.empresa_id = prospects.empresa_id
     AND ae.excluido_em IS NULL
     AND ae.status IN ('pendente', 'confirmado')
     AND ae.data_inicio >= NOW()
     AND NULLIF(regexp_replace(COALESCE(prospects.telefone, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
     AND regexp_replace(COALESCE(ae.lead_telefone, ''), '[^0-9]', '', 'g')
         = regexp_replace(COALESCE(prospects.telefone, ''), '[^0-9]', '', 'g')
) OR ${AGENDA_VENDAS_FUTURA_EXISTS})`
function envelopeErro(res, err, code) {
  const status = err.statusCode || 500
  logger.error(`[api-banco-leads] ${code}:`, err.message)
  return res.status(status).json({ ok: false, error: { code, message: err.message } })
}

// Monta WHERE + params comuns à listagem e ao export (mesmos filtros).
function montarFiltro(empresaId, query) {
  const params = [empresaId]
  const where = [`empresa_id = $1`]

  const aba = String(query.aba || '').toLowerCase()
  if (aba === 'agendados') {
    // Só contatos com agendamento futuro (ordenação por proximidade é feita no GET /leads).
    where.push(AGENDA_FUTURA_EXISTS)
  } else if (aba === 'descartados') {
    // Descartados: rejeitados/não-contatar OU sem conta WhatsApp (envio não chegou).
    where.push(`(status IN ('rejeitado', 'nao_contatar') OR tem_whatsapp = false)`)
  } else if (ABAS[aba]) {
    params.push(ABAS[aba])
    where.push(`status = ANY($${params.length})`)
    // Sem WhatsApp sai do funil ativo (vai pra Descartados) — não polui "Sem contato".
    if (aba === 'sem_contato') where.push(`(tem_whatsapp IS DISTINCT FROM false)`)
  } else {
    // Sem aba válida: mostra o funil inteiro (exclui descartados).
    params.push([...ABAS.sem_contato, ...ABAS.conversou, ...ABAS.fecharam])
    where.push(`status = ANY($${params.length})`)
  }

  const origem = String(query.origem || '').toLowerCase()
  if (ORIGENS_VALIDAS.has(origem)) {
    params.push(origem)
    where.push(`origem = $${params.length}`)
  } else if (origem === 'places') {
    where.push(`origem IN ('manual','automatico')`)
  } else if (origem === 'social') {
    where.push(`origem IN ('instagram','linkedin')`)
  }

  const busca = String(query.busca || '').trim().slice(0, 160)
  if (busca) {
    params.push(`%${busca}%`)
    const i = params.length
    where.push(`(nome ILIKE $${i} OR telefone ILIKE $${i} OR email ILIKE $${i} OR instagram_handle ILIKE $${i})`)
  }
  return { where: where.join(' AND '), params }
}

const COLUNAS = `id, origem, status, nome, telefone, email, instagram_handle,
  nicho, cidade, site, seguidores, categoria_perfil, created_at, updated_at,
  bloqueado_ate, bloqueio_motivo, endereco, rating, avaliacoes, tem_site,
  maps_url, link_bio, bio, tem_whatsapp, score`

// Origens do Google Places (inclui cadastro manual); o resto é social (IG/LinkedIn).
const ORIGENS_PLACES = new Set(['manual', 'automatico'])

// Anexa a pontuação de cadastro + JSON de apresentação conforme a origem do lead
// (mesma régua da Aquisição: Places 0-100, Instagram 0-60). Remove o raw_json do
// payload (pesado — só serve pro cálculo de fotos/horário do Places).
function anexarScoreCadastro(row) {
  const { raw_json: _rawJson, ...lead } = row
  if (ORIGENS_PLACES.has(row.origem)) {
    const cad = calcularScoreCadastroPlaces(row)
    return {
      ...lead,
      score_cadastro: cad.score,
      score_cadastro_max: cad.maximo,
      json_apresentacao: montarJsonApresentacaoPlaces(row, cad),
    }
  }
  const cad = calcularScoreCadastroInstagram(row)
  return {
    ...lead,
    score_cadastro: cad.score,
    score_cadastro_max: cad.maximo,
    json_apresentacao: montarJsonApresentacaoInstagram(row, cad),
  }
}

// GET /leads?aba=sem_contato|conversou|fecharam&origem=&busca=
// Inclui o último disparo (quem rodou / quando) e o estado da trava (bloqueado_ate).
router.get('/leads', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { where, params } = montarFiltro(req.empresa.id, req.query)
    // Aba "Agendados" ordena pelos horários mais próximos; demais por atividade recente.
    const ordemLeads = String(req.query.aba || '').toLowerCase() === 'agendados'
      ? 'proximo_agendamento ASC NULLS LAST'
      : 'updated_at DESC'
    // Escopo da mensagem gerada (Semi): só mostra o rascunho que SERÁ disparado pela
    // instância selecionada — evita mostrar rascunho de outra instância (que ao disparar
    // pela instância atual não seria encontrado). Sem instancia_id, mostra qualquer um.
    let filtroInstMsg = ''
    const instId = String(req.query.instancia_id || '').trim()
    if (instId) {
      const { rows: ir } = await pool.query(
        `SELECT evolution_instance FROM app.empresa_whatsapp_instances WHERE id = $1 AND empresa_id = $2`,
        [instId, req.empresa.id]
      )
      if (ir[0]?.evolution_instance) {
        params.push(ir[0].evolution_instance)
        filtroInstMsg = ` AND d.evolution_instance = $${params.length}`
      }
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 300, 1), 1000)
    params.push(limit)
    const { rows } = await pool.query(
      `SELECT ${COLUNAS}, raw_json,
          ultimo.rodado_em, ultimo.rodado_por, ultimo.ultimo_status, ultimo.ultimo_erro,
          rascunho.mensagem_gerada, rascunho.gerada_em,
          agenda.proximo_agendamento
        FROM prospectador.prospects
        LEFT JOIN LATERAL (
          SELECT d.criado_em AS rodado_em,
                 COALESCE(u.nome, u.email) AS rodado_por,
                 d.status AS ultimo_status,
                 d.erro AS ultimo_erro
            FROM prospectador.lead_disparos d
            LEFT JOIN app.usuarios u ON u.id = d.usuario_id
           WHERE d.prospect_id = prospects.id
           ORDER BY d.criado_em DESC
           LIMIT 1
        ) ultimo ON TRUE
        LEFT JOIN LATERAL (
          SELECT d.mensagem AS mensagem_gerada, d.criado_em AS gerada_em
            FROM prospectador.lead_disparos d
           WHERE d.prospect_id = prospects.id
             AND d.status = 'aguardando_disparo'${filtroInstMsg}
           ORDER BY d.criado_em DESC
           LIMIT 1
        ) rascunho ON TRUE
        LEFT JOIN LATERAL (
          SELECT MIN(di) AS proximo_agendamento FROM (
            SELECT ae.data_inicio AS di
              FROM app.agenda_eventos ae
             WHERE ae.empresa_id = prospects.empresa_id
               AND ae.excluido_em IS NULL
               AND ae.status IN ('pendente', 'confirmado')
               AND ae.data_inicio >= NOW()
               AND NULLIF(regexp_replace(COALESCE(prospects.telefone, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
               AND regexp_replace(COALESCE(ae.lead_telefone, ''), '[^0-9]', '', 'g')
                   = regexp_replace(COALESCE(prospects.telefone, ''), '[^0-9]', '', 'g')
            UNION ALL
            SELECT ve.data_inicio AS di
              FROM vendas.agenda_eventos ve
             WHERE ve.excluido_em IS NULL
               AND ve.tipo = 'reuniao'
               AND ve.status IN ('pendente', 'confirmado')
               AND ve.data_inicio >= NOW()
               AND NULLIF(${normFone('prospects.telefone')}, '') IS NOT NULL
               AND (
                 EXISTS (SELECT 1 FROM vendas.conversas vc
                          WHERE vc.id = ve.conversa_id AND vc.empresa_id = prospects.empresa_id
                            AND ${normFone('vc.numero')} = ${normFone('prospects.telefone')})
                 OR EXISTS (SELECT 1 FROM vendas.lead_profiles vlp
                             WHERE vlp.id = ve.lead_id AND vlp.empresa_id = prospects.empresa_id
                               AND ${normFone('vlp.numero')} = ${normFone('prospects.telefone')})
               )
          ) u
        ) agenda ON TRUE
        WHERE ${where} ORDER BY ${ordemLeads} LIMIT $${params.length}`,
      params
    )
    const data = rows.map(anexarScoreCadastro)
    return res.json({ ok: true, data, meta: { total: data.length } })
  } catch (err) { return envelopeErro(res, err, 'LEADS_FAILED') }
})

// POST /leads  { origem, nome, whatsapp, instagram } — cadastro manual de um lead.
// A origem do formulário (manual/google/instagram) mapeia para a coluna `origem`:
//   manual → 'manual' · google → 'automatico' (ambos aparecem como "Places")
//   instagram → 'instagram'. Exige nome + ao menos um contato (whatsapp ou @).
const ORIGEM_CADASTRO = { manual: 'manual', google: 'automatico', instagram: 'instagram' }
router.post('/leads', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const b = req.body || {}
    const origem = ORIGEM_CADASTRO[String(b.origem || '').toLowerCase()]
    if (!origem) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Origem inválida (use manual, google ou instagram).' } })
    }
    const nome = String(b.nome || '').trim().slice(0, 200)
    if (!nome) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Informe o nome do lead.' } })
    }
    const telefone = String(b.whatsapp || '').replace(/\D/g, '').slice(0, 20)
    if (telefone && telefone.length < 10) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'WhatsApp inválido — informe DDD + número.' } })
    }
    const instagram = String(b.instagram || '').trim().replace(/^@+/, '').toLowerCase().slice(0, 100)
    if (!telefone && !instagram) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Informe ao menos WhatsApp ou Instagram.' } })
    }
    // Com telefone o lead já é "rodável" (contato_encontrado); sem, fica só coletado.
    const status = telefone ? 'contato_encontrado' : 'coletado'
    const { rows } = await pool.query(
      `INSERT INTO prospectador.prospects
         (empresa_id, origem, nome, telefone, instagram_handle, status, raw_json)
       VALUES ($1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), $6, $7::jsonb)
       RETURNING ${COLUNAS}`,
      [req.empresa.id, origem, nome, telefone, instagram, status, JSON.stringify({ fonte: 'cadastro_manual' })]
    )
    return res.status(201).json({ ok: true, data: { ...rows[0], rodado_em: null, rodado_por: null } })
  } catch (err) { return envelopeErro(res, err, 'LEAD_CREATE_FAILED') }
})

// GET /meus-disparos — histórico de "quanto rodou" do usuário logado nesta empresa.
// Resumo (total/hoje/semana/enviados/falhou) + contagem por dia (14d) + últimos disparos.
router.get('/meus-disparos', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const usuarioId = req.usuario?.id
    if (!usuarioId) return res.json({ ok: true, data: { resumo: {}, por_dia: [], recentes: [] } })
    const args = [req.empresa.id, usuarioId]

    const resumoQ = pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE criado_em::date = NOW()::date)::int AS hoje,
         COUNT(*) FILTER (WHERE criado_em >= NOW() - INTERVAL '7 days')::int AS semana,
         COUNT(*) FILTER (WHERE status = 'enviado')::int AS enviados,
         COUNT(*) FILTER (WHERE status = 'falhou')::int AS falhou
         FROM prospectador.lead_disparos
        WHERE empresa_id = $1 AND usuario_id = $2`, args)

    const porDiaQ = pool.query(
      `SELECT to_char(criado_em::date, 'YYYY-MM-DD') AS dia, COUNT(*)::int AS total
         FROM prospectador.lead_disparos
        WHERE empresa_id = $1 AND usuario_id = $2 AND criado_em >= NOW() - INTERVAL '14 days'
        GROUP BY criado_em::date ORDER BY criado_em::date DESC`, args)

    const recentesQ = pool.query(
      `SELECT d.id, d.status, d.evolution_instance, d.criado_em, p.nome AS prospect_nome
         FROM prospectador.lead_disparos d
         LEFT JOIN prospectador.prospects p ON p.id = d.prospect_id
        WHERE d.empresa_id = $1 AND d.usuario_id = $2
        ORDER BY d.criado_em DESC LIMIT 50`, args)

    const [resumo, porDia, recentes] = await Promise.all([resumoQ, porDiaQ, recentesQ])
    return res.json({ ok: true, data: {
      resumo: resumo.rows[0] || { total: 0, hoje: 0, semana: 0, enviados: 0, falhou: 0 },
      por_dia: porDia.rows,
      recentes: recentes.rows,
    } })
  } catch (err) { return envelopeErro(res, err, 'MEUS_DISPAROS_FAILED') }
})

// POST /rodar  { instancia_id, prospect_ids: [..] } — dispara a saudação (1ª mensagem)
// pelos números selecionados via a instância escolhida. Throttle no serviço.
router.post('/rodar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { instancia_id, prospect_ids } = req.body || {}
    if (!instancia_id) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Escolha uma instância.' } })
    }
    const resumo = await rodarLeads(pool, {
      empresaId: req.empresa.id,
      usuarioId: req.usuario?.id || null,
      instanciaId: instancia_id,
      prospectIds: Array.isArray(prospect_ids) ? prospect_ids : [],
    })
    return res.json({ ok: true, data: resumo })
  } catch (err) {
    const status = err.statusCode || 500
    if (status >= 500) logger.error('[api-banco-leads] RODAR_FAILED:', err.message)
    return res.status(status).json({ ok: false, error: { code: 'RODAR_FAILED', message: err.message } })
  }
})

// GET /config — modo de disparo (manual/semi/auto) + geração por IA, por empresa.
router.get('/config', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await obterConfigBancoLeads(pool, req.empresa.id)
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'CONFIG_FAILED') }
})

// PUT /config — atualiza a config do Banco de Leads (upsert parcial: só os campos
// presentes no body mudam). Aceita: modo, gerar_ia, instrucoes_ia (Manual/Semi) +
// auto_ativo, janela_inicio, janela_fim, intervalo_min, intervalo_max (Automático).
router.put('/config', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const b = req.body || {}
    const patch = {}
    for (const campo of ['modo', 'gerar_ia', 'instrucoes_ia', 'auto_ativo', 'auto_instancia_id',
      'janela_inicio', 'janela_fim', 'intervalo_min', 'intervalo_max', 'auto_proximo_disparo_em']) {
      if (b[campo] !== undefined) patch[campo] = b[campo]
    }
    const data = await salvarConfigBancoLeads(pool, req.empresa.id, patch)
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'CONFIG_UPDATE_FAILED') }
})

// GET /cooldown?instancia_id=… — estado do cooldown/teto da instância (para o cronômetro
// do modo Semi). Só leitura; reusa o MESMO throttle do disparo (sem regra duplicada).
router.get('/cooldown', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const instId = String(req.query.instancia_id || '').trim()
    if (!instId) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'instancia_id é obrigatório.' } })
    }
    const data = await estadoEnvioInstancia(pool, { empresaId: req.empresa.id, instanciaId: instId })
    return res.json({ ok: true, data })
  } catch (err) {
    const status = err.statusCode || 500
    return res.status(status).json({ ok: false, error: { code: 'COOLDOWN_FAILED', message: err.message } })
  }
})

// GET /geracao-progresso?instancia_id= — progresso da preparação das mensagens desta
// instância. Alimenta a BARRA de progresso no painel. Independe da tela: a geração roda
// no worker de fundo (Semi) / no disparo (Auto); aqui só CONTAMOS o estado atual.
//   eligiveis = leads que ainda precisam de mensagem (rodáveis, sem disparo ativo)
//   prontas   = mensagens já geradas aguardando disparo (Semi)
//   gerando   = em geração agora
//   enviados  = já contatados (Auto/Semi)   ·   erros = falha de IA
router.get('/geracao-progresso', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const instId = String(req.query.instancia_id || '').trim()
    if (!instId) return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'instancia_id é obrigatório.' } })
    const { rows: [inst] } = await pool.query(
      `SELECT evolution_instance FROM app.empresa_whatsapp_instances WHERE id = $1 AND empresa_id = $2`,
      [instId, req.empresa.id]
    )
    if (!inst) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Instância não encontrada.' } })
    const ev = inst.evolution_instance
    const emp = req.empresa.id
    const { rows: [c] } = await pool.query(
      `WITH fila AS (
         SELECT p.id,
                (SELECT d.status
                   FROM prospectador.lead_disparos d
                  WHERE d.empresa_id = p.empresa_id
                    AND d.prospect_id = p.id
                    AND d.evolution_instance = $3
                    AND d.status IN ('gerando','aguardando_disparo','erro_ia','enviando','pendente_confirmacao','enviado')
                  ORDER BY d.criado_em DESC
                  LIMIT 1) AS status_geracao
           FROM prospectador.prospects p
          WHERE p.empresa_id = $1
            AND p.status = ANY($2)
            AND NULLIF(BTRIM(COALESCE(p.telefone, '')), '') IS NOT NULL
            AND p.tem_whatsapp IS DISTINCT FROM false
            AND (p.bloqueado_ate IS NULL OR p.bloqueado_ate <= NOW())
       )
       SELECT COUNT(*) FILTER (WHERE status_geracao IS NULL)::int AS eligiveis,
              COUNT(*) FILTER (WHERE status_geracao = 'aguardando_disparo')::int AS prontas,
              COUNT(*) FILTER (WHERE status_geracao = 'gerando')::int AS gerando,
              COUNT(*) FILTER (WHERE status_geracao IN ('enviado','enviando','pendente_confirmacao'))::int AS enviados,
              COUNT(*) FILTER (WHERE status_geracao = 'erro_ia')::int AS erros
         FROM fila`,
      [emp, [...STATUS_RODAVEL], ev]
    )
    return res.json({ ok: true, data: c })
  } catch (err) {
    return res.status(500).json({ ok: false, error: { code: 'PROGRESSO_FAILED', message: err.message } })
  }
})

// POST /gerar { instancia_id, prospect_ids } — SEMI: gera as mensagens (IA c/ fallback) e
// deixa 'aguardando_disparo' (não envia, não consome teto). Retorna as prévias geradas.
router.post('/gerar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { instancia_id, prospect_ids } = req.body || {}
    if (!instancia_id) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Escolha uma instância.' } })
    }
    const data = await gerarMensagensSemi(pool, {
      empresaId: req.empresa.id,
      usuarioId: req.usuario?.id || null,
      instanciaId: instancia_id,
      prospectIds: Array.isArray(prospect_ids) ? prospect_ids : [],
    })
    return res.json({ ok: true, data })
  } catch (err) {
    const status = err.statusCode || 500
    if (status >= 500) logger.error('[api-banco-leads] GERAR_FAILED:', err.message)
    return res.status(status).json({ ok: false, error: { code: 'GERAR_FAILED', message: err.message } })
  }
})

// POST /gerar-pendentes { instancia_id, limit? } — SEMI: gera mensagens para os
// leads elegíveis que ainda não têm rascunho/erro/envio nesta instância.
router.post('/gerar-pendentes', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { instancia_id, limit } = req.body || {}
    if (!instancia_id) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Escolha uma instância.' } })
    }
    const data = await gerarPendentesSemi(pool, {
      empresaId: req.empresa.id,
      usuarioId: req.usuario?.id || null,
      instanciaId: instancia_id,
      limit: limit || 1000,
    })
    return res.json({ ok: true, data })
  } catch (err) {
    const status = err.statusCode || 500
    if (status >= 500) logger.error('[api-banco-leads] GERAR_PENDENTES_FAILED:', err.message)
    return res.status(status).json({ ok: false, error: { code: 'GERAR_PENDENTES_FAILED', message: err.message } })
  }
})

// POST /disparar-gerados { instancia_id, prospect_ids? } — envia as mensagens já geradas
// (aguardando_disparo). Sem prospect_ids, dispara todos os pendentes da instância.
router.post('/disparar-gerados', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { instancia_id, prospect_ids } = req.body || {}
    if (!instancia_id) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Escolha uma instância.' } })
    }
    const data = await dispararGerados(pool, {
      empresaId: req.empresa.id,
      instanciaId: instancia_id,
      prospectIds: Array.isArray(prospect_ids) ? prospect_ids : [],
    })
    return res.json({ ok: true, data })
  } catch (err) {
    const status = err.statusCode || 500
    if (status >= 500) logger.error('[api-banco-leads] DISPARAR_GERADOS_FAILED:', err.message)
    return res.status(status).json({ ok: false, error: { code: 'DISPARAR_GERADOS_FAILED', message: err.message } })
  }
})

// POST /limpar — apaga os leads SEM contato (sem email E sem telefone).
// Protege negócios fechados (status 'fechado' nunca é removido). Irreversível.
router.post('/limpar', requireAuth, requireEmpresaAccess, async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const cond = `empresa_id = $1
      AND NULLIF(BTRIM(COALESCE(email, '')), '') IS NULL
      AND NULLIF(BTRIM(COALESCE(telefone, '')), '') IS NULL
      AND status <> 'fechado'`
    // Limpa disparos órfãos desses leads (caso existam) antes de removê-los.
    await client.query(
      `DELETE FROM prospectador.lead_disparos
        WHERE empresa_id = $1 AND prospect_id IN (
          SELECT id FROM prospectador.prospects WHERE ${cond})`,
      [req.empresa.id]
    )
    const del = await client.query(
      `DELETE FROM prospectador.prospects WHERE ${cond} RETURNING id`,
      [req.empresa.id]
    )
    await client.query('COMMIT')
    return res.json({ ok: true, data: { removidos: del.rowCount } })
  } catch (err) {
    await client.query('ROLLBACK')
    return envelopeErro(res, err, 'LIMPAR_FAILED')
  } finally {
    client.release()
  }
})

// GET /resumo — contagem por aba (para os badges das abas).
router.get('/resumo', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const [{ rows }, { rows: [c] }, { rows: [ag] }] = await Promise.all([
      pool.query(
        `SELECT status, COUNT(*)::int AS total
           FROM prospectador.prospects WHERE empresa_id = $1 GROUP BY status`,
        [req.empresa.id]
      ),
      // Contagem por aba consistente com os filtros (sem WhatsApp conta em Descartados,
      // não em Sem contato).
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = ANY($2) AND tem_whatsapp IS DISTINCT FROM false)::int AS sem_contato,
           COUNT(*) FILTER (WHERE status = ANY($3))::int AS conversou,
           COUNT(*) FILTER (WHERE status = ANY($4))::int AS fecharam,
           COUNT(*) FILTER (WHERE status IN ('rejeitado', 'nao_contatar') OR tem_whatsapp = false)::int AS descartados
         FROM prospectador.prospects WHERE empresa_id = $1`,
        [req.empresa.id, ABAS.sem_contato, ABAS.conversou, ABAS.fecharam]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total FROM prospectador.prospects WHERE empresa_id = $1 AND ${AGENDA_FUTURA_EXISTS}`,
        [req.empresa.id]
      ),
    ])
    const porStatus = Object.fromEntries(rows.map((r) => [r.status, r.total]))
    const abas = {
      sem_contato: c.sem_contato, conversou: c.conversou,
      fecharam: c.fecharam, descartados: c.descartados,
      agendados: ag.total,
    }
    return res.json({ ok: true, data: { abas, por_status: porStatus } })
  } catch (err) { return envelopeErro(res, err, 'RESUMO_FAILED') }
})

// POST /leads/:id/fechar — marca o lead como fechado (botão manual).
router.post('/leads/:id/fechar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE prospectador.prospects SET status = 'fechado', updated_at = NOW()
        WHERE empresa_id = $1 AND id = $2::uuid AND status <> 'fechado'
        RETURNING id, status`,
      [req.empresa.id, req.params.id]
    )
    if (!rows[0]) return res.status(404).json({ ok: false, error: { code: 'LEAD_NAO_ENCONTRADO', message: 'Lead não encontrado ou já fechado.' } })
    return res.json({ ok: true, data: rows[0] })
  } catch (err) { return envelopeErro(res, err, 'FECHAR_FAILED') }
})

// POST /leads/:id/reabrir — desfaz o fechamento (volta para 'respondeu').
router.post('/leads/:id/reabrir', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE prospectador.prospects SET status = 'respondeu', updated_at = NOW()
        WHERE empresa_id = $1 AND id = $2::uuid AND status = 'fechado'
        RETURNING id, status`,
      [req.empresa.id, req.params.id]
    )
    if (!rows[0]) return res.status(404).json({ ok: false, error: { code: 'LEAD_NAO_ENCONTRADO', message: 'Lead fechado não encontrado.' } })
    return res.json({ ok: true, data: rows[0] })
  } catch (err) { return envelopeErro(res, err, 'REABRIR_FAILED') }
})

// PATCH /leads/:id/email  { email } — define/edita/limpa o e-mail do lead.
router.patch('/leads/:id/email', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await atualizarEmailProspect(req.empresa.id, req.params.id, (req.body || {}).email)
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'EMAIL_UPDATE_FAILED') }
})

// Escapa um campo para CSV pt-BR (separador ';'). Aspas duplicadas; quebra protegida.
function csvCampo(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// GET /export.csv?aba=&origem=&busca= — baixa a aba atual em CSV (Excel pt-BR).
router.get('/export.csv', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { where, params } = montarFiltro(req.empresa.id, req.query)
    const { rows } = await pool.query(
      `SELECT origem, status, nome, telefone, email, instagram_handle,
              nicho, cidade, site, seguidores, created_at, updated_at
         FROM prospectador.prospects
        WHERE ${where} ORDER BY updated_at DESC LIMIT 5000`,
      params
    )
    const cabecalho = ['Origem', 'Status', 'Nome', 'Telefone', 'Email', 'Instagram',
      'Nicho', 'Cidade', 'Site', 'Seguidores', 'Criado em', 'Atualizado em']
    const linhas = rows.map((r) => [
      r.origem, r.status, r.nome, r.telefone, r.email, r.instagram_handle,
      r.nicho, r.cidade, r.site, r.seguidores,
      r.created_at && new Date(r.created_at).toISOString(),
      r.updated_at && new Date(r.updated_at).toISOString(),
    ].map(csvCampo).join(';'))
    // BOM (﻿) faz o Excel reconhecer UTF-8 e mostrar acentos corretamente.
    const csv = '﻿' + [cabecalho.join(';'), ...linhas].join('\r\n')
    const aba = ABAS[String(req.query.aba || '').toLowerCase()] ? String(req.query.aba).toLowerCase() : 'leads'
    const nomeArquivo = `banco-leads-${aba}-${new Date().toISOString().slice(0, 10)}.csv`
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`)
    return res.send(csv)
  } catch (err) { return envelopeErro(res, err, 'EXPORT_FAILED') }
})

module.exports = router
