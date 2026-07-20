'use strict'
// Listagem/controle da pagina de Follow-ups (Fase 1). Acesso a banco isolado.
//   - Automatico: timeline de agendamentos (agendado/executado/falhou/cancelado)
//     + reprocessar falhas + cancelar por lead. REUSA o motor de follow-up existente
//     (vendas.followup_auto_agendamentos + vendas.job_queue); nao reimplementa envio.
//   - Semi: monta a fila de Atendimento humano coletando sinais reais por lead e
//     recomendando a proxima melhor acao (ligar, assumir, revisar ou copiar prompt).
// Multi-tenant: filtra por vendas.conversas.empresa_id; eventos_comerciais e
// followup_auto_agendamentos casam por numero; agenda por empresa_id + telefone.
const { JOB_MAX_ATTEMPTS } = require('../config')
const { recomendarAcaoHumana, FOLLOWUPS_IGNORADOS_MIN } = require('./followup-call-score')

// So considera para ligacao quem ja silenciou ha pelo menos isso (nao interromper
// conversa em andamento). O call score cuida da recencia fina a partir daqui.
const CALLLIST_SILENCIO_MIN_MINUTOS = 120
// Teto de leads varridos antes de pontuar (protege a query; ordena por mais recente).
const CALLLIST_SCAN_LIMIT = 500
// Dedup: lead com ligacao registrada nas ultimas N horas sai da fila (nao ligar 2x no
// mesmo dia; cobre atendeu/nao_atendeu/ligar_depois). Fase 2.
const CALLLIST_DEDUP_HORAS = 12

const STATUS_AGENDAMENTO = new Set(['agendado', 'executado', 'cancelado', 'falhou'])

function limparNumero(numero) {
  return String(numero || '').replace(/\D/g, '')
}

// --- AUTOMATICO: timeline dos agendamentos por empresa ---------------------------
async function listarAgendamentosAuto(pool, empresaId, opts = {}) {
  const limit = Math.min(Math.max(Number.parseInt(opts.limit, 10) || 100, 1), 500)
  const params = [empresaId]
  let filtroStatus = ''
  if (opts.status && STATUS_AGENDAMENTO.has(opts.status)) {
    params.push(opts.status)
    filtroStatus = `AND fa.status = $${params.length}`
  }
  params.push(limit)
  const { rows } = await pool.query(
    `SELECT fa.id, fa.numero, fa.sequencia, fa.status, fa.agendado_para,
            fa.executado_em, fa.cancelado_em, fa.motivo_decisao, fa.detectado_em,
            c.estagio,
            COALESCE(NULLIF(p.apelido, ''), NULLIF(p.negocio, ''), fa.numero) AS nome
       FROM vendas.followup_auto_agendamentos fa
       JOIN vendas.conversas c ON c.numero = fa.numero
       LEFT JOIN vendas.lead_profiles p ON p.numero = fa.numero
      WHERE c.empresa_id = $1 ${filtroStatus}
      ORDER BY COALESCE(fa.agendado_para, fa.detectado_em) DESC
      LIMIT $${params.length}`,
    params
  )
  return rows
}

// Contagem por status (para os cards de "saude do canal").
async function resumoAgendamentosAuto(pool, empresaId) {
  const { rows } = await pool.query(
    `SELECT fa.status, COUNT(*)::int AS total
       FROM vendas.followup_auto_agendamentos fa
       JOIN vendas.conversas c ON c.numero = fa.numero
      WHERE c.empresa_id = $1
      GROUP BY fa.status`,
    [empresaId]
  )
  const resumo = { agendado: 0, executado: 0, cancelado: 0, falhou: 0 }
  for (const r of rows) resumo[r.status] = r.total
  return resumo
}

// Reprocessa follow-ups que FALHARAM (ex.: IA sem credito). Reusa o contrato de job
// idempotente de followup-auto.js (enfileirarJobFollowupAuto): dedupe_key
// `followup_auto:<id>`, ON CONFLICT volta para 'pending'. Devolve quantos re-enfileirou.
async function reprocessarFalhas(pool, empresaId, opts = {}) {
  const params = [empresaId]
  let filtroId = ''
  if (opts.agendamentoId) {
    params.push(Number.parseInt(opts.agendamentoId, 10))
    filtroId = `AND fa.id = $${params.length}`
  }
  const { rows: falhas } = await pool.query(
    `SELECT fa.id, fa.numero
       FROM vendas.followup_auto_agendamentos fa
       JOIN vendas.conversas c ON c.numero = fa.numero
      WHERE c.empresa_id = $1 AND fa.status = 'falhou' ${filtroId}
      LIMIT 200`,
    params
  )
  let reprocessados = 0
  for (const fa of falhas) {
    const dedupe = `followup_auto:${fa.id}`
    const payload = JSON.stringify({ agendamento_id: fa.id, numero: fa.numero })
    const { rows } = await pool.query(
      `INSERT INTO vendas.job_queue (tipo, dedupe_key, payload, status, attempts, max_attempts, available_at)
         VALUES ('followup_auto', $1, $2::jsonb, 'pending', 0, $3, NOW())
       ON CONFLICT (dedupe_key) DO UPDATE SET
         payload = EXCLUDED.payload,
         status = CASE WHEN vendas.job_queue.status = 'processing' THEN vendas.job_queue.status ELSE 'pending' END,
         attempts = CASE WHEN vendas.job_queue.status = 'processing' THEN vendas.job_queue.attempts ELSE 0 END,
         available_at = EXCLUDED.available_at,
         atualizado_em = NOW()
       RETURNING id`,
      [dedupe, payload, JOB_MAX_ATTEMPTS]
    )
    const jobId = rows[0]?.id || null
    await pool.query(
      `UPDATE vendas.followup_auto_agendamentos
          SET status = 'agendado', agendado_para = NOW(), job_id = COALESCE($2, job_id),
              cancelado_em = NULL
        WHERE id = $1`,
      [fa.id, jobId]
    )
    reprocessados += 1
  }
  return { reprocessados }
}

// Cancela os follow-ups agendados de um lead (por numero), respeitando a empresa.
async function cancelarPorLead(pool, empresaId, numero, motivo = 'cancelado pelo operador') {
  const jid = String(numero || '').trim()
  if (!jid) return { cancelados: 0 }
  const { rows } = await pool.query(
    `UPDATE vendas.followup_auto_agendamentos fa
        SET status = 'cancelado', cancelado_em = NOW(),
            motivo_decisao = LEFT(CONCAT(COALESCE(fa.motivo_decisao, ''),
              CASE WHEN fa.motivo_decisao IS NULL OR fa.motivo_decisao = '' THEN '' ELSE ' | ' END, $3::text), 1000)
       FROM vendas.conversas c
      WHERE fa.numero = c.numero AND c.empresa_id = $1 AND fa.numero = $2 AND fa.status = 'agendado'
      RETURNING fa.job_id`,
    [empresaId, jid, motivo]
  )
  const jobIds = rows.map((r) => r.job_id).filter((x) => x != null)
  if (jobIds.length) {
    await pool.query(
      `UPDATE vendas.job_queue SET status = 'completed', last_error = $2, atualizado_em = NOW()
        WHERE id = ANY($1::bigint[]) AND status = 'pending'`,
      [jobIds, `cancelado: ${motivo}`]
    )
  }
  return { cancelados: rows.length }
}

// --- SEMI: fila de Atendimento humano -------------------------------------------
// Coleta sinais reais por lead e recomenda a proxima acao. A recomendacao e pura;
// somente esta coleta toca o banco. Preview nunca e gerado aqui: no maximo retorna
// um prompt textual para o operador copiar e usar fora do projeto.
async function montarCallList(pool, empresaId, opts = {}) {
  const limit = Math.min(Math.max(Number.parseInt(opts.limit, 10) || 30, 1), 200)
  const { rows } = await pool.query(
    `SELECT c.numero,
            c.estagio,
            c.status,
            c.agente_pausado,
            COALESCE(NULLIF(p.apelido, ''), NULLIF(p.negocio, ''), c.numero) AS nome,
            p.negocio,
            p.cidade,
            p.score_lead,
            p.pronto_handoff,
            p.produto_sugerido,
            p.complexidade,
            p.dor_principal,
            p.contexto_prospeccao,
            GREATEST(0, EXTRACT(EPOCH FROM (NOW() - c.atualizado_em)) / 86400.0) AS dias_silencio,
            (c.estagio <> 'primeiro_contato') AS respondeu_alguma_vez,
            COALESCE((
              SELECT msg.item->>'content'
                FROM jsonb_array_elements(c.historico) WITH ORDINALITY AS msg(item, pos)
               WHERE msg.item->>'role' = 'user'
               ORDER BY msg.pos DESC
               LIMIT 1
            ), '') AS ultimo_texto_usuario,
            EXISTS (SELECT 1 FROM vendas.eventos_comerciais e
                     WHERE e.numero = c.numero AND e.tipo = 'pediu_preco') AS pediu_preco,
            EXISTS (SELECT 1 FROM vendas.eventos_comerciais e
                     WHERE e.numero = c.numero AND e.tipo = 'recebeu_proposta') AS recebeu_proposta,
            (SELECT COUNT(*)::int FROM vendas.followup_auto_agendamentos fa
               WHERE fa.numero = c.numero AND fa.status = 'executado') AS followups_ignorados,
            EXISTS (SELECT 1 FROM app.agenda_eventos ae
                     WHERE ae.empresa_id = c.empresa_id AND ae.excluido_em IS NULL
                       AND ae.status = 'pendente'
                       AND regexp_replace(COALESCE(ae.lead_telefone, ''), '[^0-9]', '', 'g')
                           = regexp_replace(c.numero, '[^0-9]', '', 'g')) AS reuniao_pendente,
            EXISTS (SELECT 1 FROM vendas.eventos_comerciais e
                     WHERE e.numero = c.numero AND e.tipo = 'recebeu_preview') AS recebeu_preview
       FROM vendas.conversas c
       LEFT JOIN vendas.lead_profiles p ON p.numero = c.numero
      WHERE c.empresa_id = $1
        AND c.status IN ('ativo', 'aguardando_handoff')
        AND (c.status = 'aguardando_handoff' OR COALESCE(c.agente_pausado, false) = false)
        AND COALESCE(c.arquivado, false) = false
        AND COALESCE(c.venda_fechada, false) = false
        AND COALESCE(jsonb_array_length(c.historico), 0) > 0
        AND (c.status = 'aguardando_handoff' OR c.atualizado_em <= NOW() - ($2::int * INTERVAL '1 minute'))
        AND NOT EXISTS (
          SELECT 1 FROM vendas.followup_ligacoes fl
           WHERE fl.numero = c.numero AND fl.empresa_id = c.empresa_id
             AND fl.criado_em >= NOW() - ($4::int * INTERVAL '1 hour')
        )
      ORDER BY c.atualizado_em DESC
      LIMIT $3`,
    [empresaId, CALLLIST_SILENCIO_MIN_MINUTOS, CALLLIST_SCAN_LIMIT, CALLLIST_DEDUP_HORAS]
  )

  const lista = []
  for (const r of rows) {
    const avaliacao = recomendarAcaoHumana({
      pediu_preco: r.pediu_preco,
      recebeu_proposta: r.recebeu_proposta,
      estagio: r.estagio,
      aguardando_handoff: r.status === 'aguardando_handoff',
      pronto_handoff: r.pronto_handoff === true,
      respondeu_alguma_vez: r.respondeu_alguma_vez,
      ultimo_texto_usuario: r.ultimo_texto_usuario,
      dias_silencio: Number(r.dias_silencio),
      followups_ignorados: r.followups_ignorados,
      reuniao_pendente: r.reuniao_pendente,
      recebeu_preview: r.recebeu_preview,
      score_lead: r.score_lead,
      negocio: r.negocio,
      cidade: r.cidade,
      produto_sugerido: r.produto_sugerido,
      complexidade: r.complexidade,
      dor_principal: r.dor_principal,
      contexto_prospeccao: r.contexto_prospeccao,
      opt_out: false, // ja filtrado no WHERE (nao arquivado/nao fechado; pausa comum nao entra)
    })
    if (!avaliacao.elegivel) continue
    lista.push({
      numero: r.numero,
      telefone_digitos: limparNumero(r.numero),
      nome: r.nome,
      negocio: r.negocio,
      cidade: r.cidade,
      estagio: r.estagio,
      dias_silencio: Math.round(Number(r.dias_silencio)),
      score: avaliacao.score,
      temperatura: avaliacao.temperatura,
      motivo: avaliacao.motivo,
      motivos: avaliacao.motivos,
      acao_recomendada: avaliacao.acao_recomendada,
      acao_label: avaliacao.acao_label,
      janela_recomendada: avaliacao.janela_recomendada,
      orientacao: avaliacao.orientacao,
      prompt_preview: avaliacao.prompt_preview,
      followups_ignorados: Number(r.followups_ignorados) || 0,
      // Escada de canais: msg esgotou (ignorou N follow-ups) -> hora de ligar.
      escalado: (Number(r.followups_ignorados) || 0) >= FOLLOWUPS_IGNORADOS_MIN,
    })
  }
  lista.sort((a, b) => b.score - a.score)
  return lista.slice(0, limit)
}

module.exports = {
  listarAgendamentosAuto,
  resumoAgendamentosAuto,
  reprocessarFalhas,
  cancelarPorLead,
  montarCallList,
  CALLLIST_SILENCIO_MIN_MINUTOS,
}
