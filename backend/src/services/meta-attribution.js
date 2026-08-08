'use strict'

// Atribuição Meta (Click-to-WhatsApp) + score determinístico de qualidade do lead.
//
// ESTE MÓDULO NÃO ENVIA MAIS NADA À META. O disparo global que existia aqui
// (`dispararEventosMetaPendentes`) varria vendas.lead_profiles SEM filtro de
// empresa_id e mandava a conversão de todos os tenants para o dataset configurado no
// PROCESSO. Ele foi REMOVIDO — o envio agora é por empresa, com a credencial da
// empresa, e vive em services/meta-dispatch.js sobre o ledger app.conversao_eventos.
//
// O que sobrou aqui é o que continua sendo útil e é inofensivo entre tenants:
// capturar de qual anúncio o lead veio e pontuar o lead. Ambos escrevem em
// vendas.lead_profiles, cuja chave (telefone) é global — um telefone pertence a uma
// única conversa em todo o sistema, então não há mistura possível nessas escritas.
//
// 1) CAPTURA: leads de anúncio chegam na tabela do Evolution (public."Message") com
//    contextInfo.externalAdReply { ctwaClid, sourceId(=ad), title, sourceUrl } e o
//    telefone real em key.remoteJidAlt (mesmo quando remoteJid é @lid). Gravamos isso
//    no lead (vendas.lead_profiles.origem='meta_ads' + origem_anuncio jsonb) p/ depois
//    enviar eventos de conversão à Meta (Conversions API) com o ctwa_clid.
// 2) SCORE: pontuação 0-100 por CRITÉRIOS (não por achismo da IA), a partir dos campos
//    capturados de forma confiável — é a base do evento "QualifiedLead" (>= LIMIAR).

const QUALIFIED_LEAD_MIN = (() => {
  const n = parseInt(process.env.META_QUALIFIED_LEAD_MIN, 10)
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 60
})()

/**
 * Score 0-100 de qualidade do lead, determinístico e explicável.
 * Usa só campos confiáveis (perfil + estágio + engajamento) — não depende da IA emitir número.
 * @param {object} perfil  campos de vendas.lead_profiles
 * @param {object} ctx     { estagio, mensagensLead }
 */
function calcularScoreLeadDeterministico(perfil = {}, ctx = {}) {
  const tem = (v) => v != null && String(v).trim() !== ''
  let s = 0
  if (tem(perfil.negocio)) s += 15 // sabe o que ele faz
  if (tem(perfil.cidade)) s += 5
  if (tem(perfil.dor_principal)) s += 20 // intenção/necessidade real
  // Fit: precisa de site (não aparece no Google / precisa de sistema)
  if (perfil.ja_aparece_google === false || perfil.precisa_sistema === true) s += 20
  else if (tem(perfil.negocio) && perfil.ja_aparece_google == null && perfil.precisa_sistema == null) s += 8 // fit desconhecido, mas é negócio real (parcial)
  // Intenção / produto sugerido
  if (tem(perfil.produto_sugerido) || tem(perfil.intencao_principal)) s += 15
  // Temperatura
  const t = String(perfil.temperatura_lead || '').toLowerCase()
  if (t.includes('quente')) s += 10
  else if (t.includes('morn')) s += 5
  // Engajamento (nº de mensagens na conversa — proxy)
  const msgs = Number(ctx.mensagensLead || 0)
  if (msgs >= 6) s += 10
  else if (msgs >= 3) s += 5
  // Estágio do funil
  const e = String(ctx.estagio || '').toLowerCase()
  if (['proposta', 'handoff', 'reuniao_agendada', 'fechamento', 'agendamento_pendente'].includes(e)) s += 10
  else if (['diagnostico', 'qualificacao'].includes(e)) s += 5
  return Math.max(0, Math.min(100, s))
}

function leadQualificado(score) {
  return Number(score) >= QUALIFIED_LEAD_MIN
}

/**
 * A tabela do Evolution (public."Message") — fonte dos cliques CTWA — pode NÃO existir
 * neste banco (em alguns ambientes o Evolution roda em DB próprio). Checa via to_regclass
 * para pular a atribuição sem erro (evitava log "relation public.Message does not exist"
 * a cada tick do worker). Retorna false em qualquer falha.
 */
async function messageEvolutionExiste(pool) {
  try {
    const { rows } = await pool.query(`SELECT to_regclass('public."Message"') AS t`)
    return !!(rows[0] && rows[0].t)
  } catch {
    return false
  }
}

/**
 * Sincroniza atribuição (Message → origem_anuncio) e recalcula score_lead dos leads
 * ativos recentemente. Idempotente. Chamado periodicamente pelo worker.
 */
async function sincronizarAtribuicaoMetaAds(pool, deps = {}) {
  const logger = deps.logger || console
  let atribuidos = 0
  let pontuados = 0

  // 1) Atribuição CTWA: primeira mensagem de anúncio de cada telefone → grava no lead.
  // Só roda se a tabela do Evolution existir aqui (senão, no-op silencioso por tick).
  try {
    if (await messageEvolutionExiste(pool)) {
    const { rows: ads } = await pool.query(
      `
      SELECT DISTINCT ON (telefone) telefone, ad_id, ctwa_clid, title, source_url
      FROM (
        SELECT m.key->>'remoteJidAlt' AS telefone,
               m."contextInfo"->'externalAdReply'->>'sourceId' AS ad_id,
               m."contextInfo"->'externalAdReply'->>'ctwaClid' AS ctwa_clid,
               m."contextInfo"->'externalAdReply'->>'title' AS title,
               m."contextInfo"->'externalAdReply'->>'sourceUrl' AS source_url,
               m."messageTimestamp" AS ts
        FROM public."Message" m
        WHERE m."contextInfo"->'externalAdReply'->>'sourceId' IS NOT NULL
          AND m.key->>'fromMe' = 'false'
          AND m.key->>'remoteJidAlt' LIKE '%@s.whatsapp.net'
          AND m."messageTimestamp" > extract(epoch from now() - interval '60 days')
      ) t
      WHERE telefone IS NOT NULL
      ORDER BY telefone, ts ASC
      `
    )
    for (const a of ads) {
      const payload = JSON.stringify({
        ad_id: a.ad_id,
        ctwa_clid: a.ctwa_clid || null,
        title: a.title || null,
        source_url: a.source_url || null,
        fonte: 'ctwa',
      })
      const r = await pool.query(
        `UPDATE vendas.lead_profiles
         SET origem = 'meta_ads',
             origem_anuncio = COALESCE(origem_anuncio, '{}'::jsonb) || $2::jsonb,
             atualizado_em = NOW()
         WHERE numero = $1
           AND (origem_anuncio IS NULL OR origem_anuncio->>'ad_id' IS DISTINCT FROM $3)`,
        [a.telefone, payload, a.ad_id]
      )
      atribuidos += r.rowCount || 0
    }
    }
  } catch (e) {
    logger.warn?.({ operation: 'meta_attribution', etapa: 'atribuicao_erro', erro: e.message })
  }

  // 2) Score determinístico p/ leads ativos nos últimos 7 dias.
  try {
    const { rows: leads } = await pool.query(
      `
      SELECT p.numero, p.negocio, p.cidade, p.dor_principal, p.ja_aparece_google,
             p.precisa_sistema, p.produto_sugerido, p.intencao_principal, p.temperatura_lead,
             c.estagio,
             COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(c.historico) = 'array' THEN c.historico ELSE '[]'::jsonb END), 0) AS msgs
      FROM vendas.lead_profiles p
      JOIN vendas.conversas c USING (numero)
      WHERE c.atualizado_em > now() - interval '7 days'
      `
    )
    for (const l of leads) {
      const score = calcularScoreLeadDeterministico(l, { estagio: l.estagio, mensagensLead: l.msgs })
      const r = await pool.query(
        `UPDATE vendas.lead_profiles SET score_lead = $2 WHERE numero = $1 AND score_lead IS DISTINCT FROM $2`,
        [l.numero, score]
      )
      pontuados += r.rowCount || 0
    }
  } catch (e) {
    logger.warn?.({ operation: 'meta_attribution', etapa: 'score_erro', erro: e.message })
  }

  if (atribuidos || pontuados) {
    logger.info?.({ operation: 'meta_attribution', atribuidos, pontuados })
  }

  // O envio de eventos NÃO acontece mais aqui. Quem envia é o ciclo por empresa
  // (services/meta-dispatch.js → processarConversoesMeta), com a credencial da
  // empresa dona do evento. A tabela legada vendas.meta_eventos_conversao vira
  // histórico read-only do que o motor antigo já mandou: nada é escrito nela.
  return { atribuidos, pontuados }
}

/**
 * Resultados por anúncio (CTWA) para o painel de Métricas. Por ad_id: leads que
 * chegaram, qualificados (score >= LIMIAR), reuniões (e concluídas), janela de
 * atividade e se ainda traz lead (leads nos últimos 7 dias → "ativo"). O gasto/CPL/
 * custo-por-reunião NÃO vem daqui (a Meta não está acessível neste serviço) — é
 * preenchido no painel. Read-only. A datação do 1º/último contato vem da tabela do
 * Evolution (public."Message"), única fonte de quando o lead clicou no anúncio.
 *
 * ESCOPO POR EMPRESA (obrigatório): sem `empresaId` esta consulta devolvia o
 * resultado de anúncios de TODOS os tenants para qualquer admin do dashboard legado.
 * O parâmetro passou a ser exigido — quem chama precisa dizer de quem é o painel.
 */
async function obterResultadosAnunciosMeta(pool, { empresaId } = {}) {
  if (!empresaId) {
    throw new Error('obterResultadosAnunciosMeta exige empresaId (isolamento por tenant)')
  }
  // Datação do 1º/último contato vem da tabela do Evolution; se ela não existir neste
  // banco, neutraliza o CTE (datas nulas) em vez de quebrar a consulta do painel.
  const fcSql = (await messageEvolutionExiste(pool))
    ? `SELECT m.key->>'remoteJidAlt' AS telefone,
              to_timestamp(MIN((m."messageTimestamp")::bigint)) AS primeiro,
              to_timestamp(MAX((m."messageTimestamp")::bigint)) AS ultimo
       FROM public."Message" m
       WHERE m."contextInfo"->'externalAdReply'->>'sourceId' IS NOT NULL
         AND m.key->>'fromMe' = 'false'
         AND m.key->>'remoteJidAlt' LIKE '%@s.whatsapp.net'
       GROUP BY 1`
    : `SELECT NULL::text AS telefone, NULL::timestamptz AS primeiro, NULL::timestamptz AS ultimo WHERE false`
  const { rows } = await pool.query(
    `
    WITH fc AS (
      ${fcSql}
    )
    SELECT
      p.origem_anuncio->>'ad_id' AS ad_id,
      MAX(p.origem_anuncio->>'title') AS titulo,
      COUNT(*)::int AS leads,
      COUNT(*) FILTER (WHERE p.score_lead >= $1)::int AS qualificados,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM vendas.agenda_eventos e
        WHERE e.tipo='reuniao' AND e.excluido_em IS NULL
          AND regexp_replace(COALESCE(e.metadata->>'lead_numero',''),'\\D','','g')
            = regexp_replace(p.numero,'\\D','','g')))::int AS reunioes,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM vendas.agenda_eventos e
        WHERE e.tipo='reuniao' AND e.excluido_em IS NULL AND e.status='concluido'
          AND regexp_replace(COALESCE(e.metadata->>'lead_numero',''),'\\D','','g')
            = regexp_replace(p.numero,'\\D','','g')))::int AS reunioes_concluidas,
      MIN(fc.primeiro)::date AS primeiro_contato,
      MAX(fc.ultimo)::date AS ultimo_contato,
      COUNT(*) FILTER (WHERE fc.primeiro > NOW() - interval '7 days')::int AS leads_7d
    FROM vendas.lead_profiles p
    LEFT JOIN fc ON fc.telefone = p.numero
    WHERE p.origem = 'meta_ads' AND p.origem_anuncio->>'ad_id' IS NOT NULL
      AND p.empresa_id = $2
    GROUP BY 1
    ORDER BY reunioes DESC, leads DESC
    `,
    [QUALIFIED_LEAD_MIN, empresaId]
  )
  const isoDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null)
  return rows.map((r) => ({
    ad_id: r.ad_id,
    titulo: r.titulo || null,
    leads: Number(r.leads) || 0,
    qualificados: Number(r.qualificados) || 0,
    reunioes: Number(r.reunioes) || 0,
    reunioes_concluidas: Number(r.reunioes_concluidas) || 0,
    primeiro_contato: isoDate(r.primeiro_contato),
    ultimo_contato: isoDate(r.ultimo_contato),
    leads_7d: Number(r.leads_7d) || 0,
    ativo: (Number(r.leads_7d) || 0) > 0,
  }))
}

module.exports = {
  QUALIFIED_LEAD_MIN,
  calcularScoreLeadDeterministico,
  leadQualificado,
  sincronizarAtribuicaoMetaAds,
  obterResultadosAnunciosMeta,
}
