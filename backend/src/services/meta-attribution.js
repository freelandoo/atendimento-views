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
// A CAPTURA DE ATRIBUIÇÃO TAMBÉM SAIU DAQUI (2026-08-08).
// Ela minerava a tabela do Evolution e NUNCA produziu uma única atribuição. Medido em
// produção, três causas empilhadas: (1) procurava `public."Message"`, mas a tabela é
// `evolution."Message"` — `to_regclass` devolvia null e a rotina era um NO-OP silencioso
// a cada tick; (2) lia o telefone de `key->>'remoteJidAlt'`, campo inexistente nesta
// versão; (3) das 526 mensagens com `externalAdReply`, 100% têm `remoteJid` `@lid`, sem
// tradução para telefone — o filtro `LIKE '%@s.whatsapp.net'` descartaria todas mesmo
// com o schema certo.
//
// A captura passou para o WEBHOOK (src/webhook-handler.js + services/ctwa-atribuicao.js),
// onde telefone real, empresa resolvida pela instância e instância de origem coexistem,
// e grava em app.atribuicao_anuncios — escopada por empresa E instância. NÃO REINTRODUZA
// varredura de `Message` aqui: ela não tem como funcionar.
//
// O que sobrou neste módulo é o SCORE: pontuação 0-100 por CRITÉRIOS (não por achismo da
// IA), a partir dos campos capturados de forma confiável.

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
 * Recalcula score_lead dos leads ativos recentemente. Idempotente. Chamado
 * periodicamente pelo worker.
 *
 * A etapa de ATRIBUIÇÃO que existia aqui foi removida — ver o cabeçalho do arquivo.
 * A captura acontece no webhook e grava em app.atribuicao_anuncios.
 */
async function sincronizarAtribuicaoMetaAds(pool, deps = {}) {
  const logger = deps.logger || console
  let pontuados = 0

  // Score determinístico p/ leads ativos nos últimos 7 dias.
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

  if (pontuados) {
    logger.info?.({ operation: 'meta_attribution', pontuados })
  }

  // O envio de eventos NÃO acontece mais aqui. Quem envia é o ciclo por empresa
  // (services/meta-dispatch.js → processarConversoesMeta), com a credencial da
  // empresa dona do evento. A tabela legada vendas.meta_eventos_conversao vira
  // histórico read-only do que o motor antigo já mandou: nada é escrito nela.
  return { pontuados }
}

/**
 * Resultados por anúncio (CTWA) para o painel de Métricas. Por ad_id: leads que
 * chegaram, qualificados (score >= LIMIAR), reuniões (e concluídas), janela de
 * atividade e se ainda traz lead (leads nos últimos 7 dias → "ativo"). O gasto/CPL/
 * custo-por-reunião NÃO vem daqui (a Meta não está acessível neste serviço) — é
 * preenchido no painel. Read-only.
 *
 * FONTE: app.atribuicao_anuncios (captura do webhook). Antes este painel lia
 * `vendas.lead_profiles.origem_anuncio` — que a varredura morta nunca preencheu — e
 * datava o contato por `public."Message"`, tabela inexistente neste schema. Ou seja:
 * o painel sempre devolveu lista vazia. Agora ele lê a única fonte que existe.
 *
 * ESCOPO POR EMPRESA (obrigatório) E POR INSTÂNCIA (opcional): sem `empresaId` esta
 * consulta devolvia o resultado de anúncios de TODOS os tenants para qualquer admin do
 * dashboard legado. `instanciaId` recorta um número específico — duas instâncias da
 * mesma empresa são dois negócios e não compartilham resultado.
 *
 * NADA DE PESSOA SAI DAQUI: só contagens por anúncio. Nem telefone, nem ctwa_clid.
 */
async function obterResultadosAnunciosMeta(pool, { empresaId, instanciaId = null } = {}) {
  if (!empresaId) {
    throw new Error('obterResultadosAnunciosMeta exige empresaId (isolamento por tenant)')
  }
  const { rows } = await pool.query(
    `
    WITH atrib AS (
      SELECT DISTINCT ON (a.telefone_norm)
             a.telefone_norm, a.ad_id, a.titulo, a.capturado_em
        FROM app.atribuicao_anuncios a
       WHERE a.empresa_id = $2
         AND a.ad_id IS NOT NULL
         AND ($3::uuid IS NULL OR a.instancia_id = $3::uuid)
       ORDER BY a.telefone_norm, a.capturado_em DESC
    )
    SELECT
      atrib.ad_id,
      MAX(atrib.titulo) AS titulo,
      COUNT(*)::int AS leads,
      COUNT(*) FILTER (WHERE lp.score_lead >= $1)::int AS qualificados,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM vendas.agenda_eventos e
        WHERE e.tipo='reuniao' AND e.excluido_em IS NULL
          AND regexp_replace(COALESCE(e.metadata->>'lead_numero',''),'\\D','','g')
            = atrib.telefone_norm))::int AS reunioes,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM vendas.agenda_eventos e
        WHERE e.tipo='reuniao' AND e.excluido_em IS NULL AND e.status='concluido'
          AND regexp_replace(COALESCE(e.metadata->>'lead_numero',''),'\\D','','g')
            = atrib.telefone_norm))::int AS reunioes_concluidas,
      MIN(atrib.capturado_em)::date AS primeiro_contato,
      MAX(atrib.capturado_em)::date AS ultimo_contato,
      COUNT(*) FILTER (WHERE atrib.capturado_em > NOW() - interval '7 days')::int AS leads_7d
    FROM atrib
    -- O score do lead continua vindo do perfil, casado por telefone DENTRO da empresa.
    LEFT JOIN vendas.lead_profiles lp
           ON lp.empresa_id = $2
          AND regexp_replace(lp.numero,'\\D','','g') = atrib.telefone_norm
    GROUP BY atrib.ad_id
    ORDER BY reunioes DESC, leads DESC
    `,
    [QUALIFIED_LEAD_MIN, empresaId, instanciaId]
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
