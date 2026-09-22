'use strict'
// Persistencia dos leads descobertos pela Biblioteca de Anuncios do Meta (migration 091).
//
// Mesma identidade que Instagram/LinkedIn ja usam (migration 012): `(empresa_id, origem,
// external_ref)`, com `external_ref` = page_id do Facebook. NAO usa `place_id` — este canal
// nao tem Google Place ID, e forcar um inventaria uma chave que nao existe.
//
// Depois de gravar, enfileira o MESMO enriquecimento de Instagram que qualquer outro lead
// ganha (`enriquecimento-etapas.js`) — decisao do operador, 2026-09-16: "lead e' lead", e este
// canal nao tem motivo pra ficar de fora.

const { pool } = require('../db')
const { qualificacaoInicial } = require('../services/lead-qualificacao')
const enriquecimentoDb = require('./enriquecimento-etapas')

/**
 * Grava (ou atualiza) um lead vindo de um anuncio aproveitavel — o formato que
 * `services/meta-ads-descoberta.js#montarLeadDeAnuncio` produz.
 *
 * So' PROMOVE em recoleta: um anuncio que sumiu (`isActive: false` numa busca futura) nao
 * apaga o que ja foi visto — a evidencia de que aquele negocio JA anunciou continua valendo
 * como sinal, mesmo que a campanha atual tenha acabado. `qualificacao` nunca e' tocada num
 * UPDATE, mesma disciplina de todo upsert de prospects.
 */
async function salvarLeadDeAnuncio(lead, contexto = {}) {
  if (!lead || !lead.external_ref) return null
  const empresaId = lead.empresa_id || contexto.empresaId || contexto.empresa_id || null

  const { rows } = await pool.query(
    `INSERT INTO prospectador.prospects
       (empresa_id, origem, external_ref, nome, nicho, cidade, tem_site, site,
        link_original, classificacao_url, categoria_perfil, bio, status, raw_json,
        qualificacao, anuncio_meta_ativo, anuncio_meta_inicio_em, anuncio_meta_page_id,
        anuncio_meta_verificado_em,
        instagram_handle, instagram_origem, instagram_confianca, instagram_evidencia,
        instagram_verificado_em,
        anuncio_meta_total_ativos, anuncio_meta_permalink, anuncio_meta_pagina_url)
     VALUES ($1,'meta_ads',$2,$3,$4,$5,false,$6,
             $7,$8,$9,$10,'coletado',$11::jsonb,
             $12,$13,$14,$15,
             NOW(),
             $16,$17,$18,$19::jsonb,
             CASE WHEN $16::text IS NULL THEN NULL ELSE NOW() END,
             $20,$21,$22)
     ON CONFLICT (empresa_id, origem, external_ref) WHERE external_ref IS NOT NULL
     DO UPDATE SET
        nome = EXCLUDED.nome,
        -- so' promove: recoleta sem link novo nao apaga classificacao ja conhecida (mesmo
        -- padrao de upsertProspectSocial em social-capture.js).
        classificacao_url = CASE
          WHEN EXCLUDED.classificacao_url = 'sem_link'
            THEN COALESCE(prospectador.prospects.classificacao_url, EXCLUDED.classificacao_url)
          ELSE EXCLUDED.classificacao_url
        END,
        link_original = COALESCE(EXCLUDED.link_original, prospectador.prospects.link_original),
        categoria_perfil = COALESCE(EXCLUDED.categoria_perfil, prospectador.prospects.categoria_perfil),
        bio = COALESCE(EXCLUDED.bio, prospectador.prospects.bio),
        raw_json = EXCLUDED.raw_json,
        anuncio_meta_ativo = EXCLUDED.anuncio_meta_ativo,
        -- o inicio mais ANTIGO conhecido e' o que importa (a campanha pode ter varios
        -- anuncios; o primeiro visto e' o que diz ha' quanto tempo esta anunciando).
        anuncio_meta_inicio_em = LEAST(
          COALESCE(EXCLUDED.anuncio_meta_inicio_em, prospectador.prospects.anuncio_meta_inicio_em),
          COALESCE(prospectador.prospects.anuncio_meta_inicio_em, EXCLUDED.anuncio_meta_inicio_em)
        ),
        anuncio_meta_verificado_em = NOW(),
        -- O @ so' entra quando o lead ainda nao tem nenhum: recoleta nao sobrescreve vinculo
        -- ja provado (mesma disciplina de salvarProspect).
        instagram_handle = COALESCE(prospectador.prospects.instagram_handle, EXCLUDED.instagram_handle),
        instagram_origem = CASE
          WHEN prospectador.prospects.instagram_handle IS NULL AND EXCLUDED.instagram_handle IS NOT NULL
            THEN EXCLUDED.instagram_origem ELSE prospectador.prospects.instagram_origem END,
        instagram_confianca = CASE
          WHEN prospectador.prospects.instagram_handle IS NULL AND EXCLUDED.instagram_handle IS NOT NULL
            THEN EXCLUDED.instagram_confianca ELSE prospectador.prospects.instagram_confianca END,
        instagram_evidencia = CASE
          WHEN prospectador.prospects.instagram_handle IS NULL AND EXCLUDED.instagram_handle IS NOT NULL
            THEN EXCLUDED.instagram_evidencia ELSE prospectador.prospects.instagram_evidencia END,
        -- A contagem é o RETRATO da última busca: sobrescreve, não acumula. Somar faria
        -- "3 anúncios ativos" virar 6 na segunda busca do mesmo mercado.
        anuncio_meta_total_ativos = COALESCE(EXCLUDED.anuncio_meta_total_ativos,
                                             prospectador.prospects.anuncio_meta_total_ativos),
        anuncio_meta_permalink = COALESCE(EXCLUDED.anuncio_meta_permalink,
                                          prospectador.prospects.anuncio_meta_permalink),
        anuncio_meta_pagina_url = COALESCE(EXCLUDED.anuncio_meta_pagina_url,
                                           prospectador.prospects.anuncio_meta_pagina_url),
        updated_at = NOW()
     RETURNING id, (xmax = 0) AS inserido`,
    [
      empresaId, lead.external_ref, lead.nome, lead.nicho, lead.cidade, lead.site,
      lead.link_original, lead.classificacao_url, lead.categoria_perfil, lead.bio,
      JSON.stringify(lead.raw_json || {}),
      qualificacaoInicial(),
      lead.anuncio_meta_ativo === true, lead.anuncio_meta_inicio_em || null, lead.anuncio_meta_page_id,
      lead.instagram_handle || null, lead.instagram_origem || null, lead.instagram_confianca || null,
      lead.instagram_evidencia ? JSON.stringify(lead.instagram_evidencia) : null,
      Number.isFinite(lead.anuncio_meta_total_ativos) ? lead.anuncio_meta_total_ativos : null,
      lead.anuncio_meta_permalink || null, lead.anuncio_meta_pagina_url || null,
    ]
  )
  const linha = rows[0] || null
  if (linha) {
    await enriquecimentoDb.enfileirar([linha.id], { empresaId }).catch(() => {})
    await enriquecimentoDb.enfileirarPerfisComCacheVencido([linha.id], { empresaId }).catch(() => {})
    // Reusa a MESMA fila generica (migration 092), com etapa propria — o cross-reference com
    // fb_paginas nao e' Instagram, mas e' o mesmo mecanismo de retry/backoff/lease.
    await enriquecimentoDb.enfileirar([linha.id], { empresaId, etapa: 'meta_ads_pagina' }).catch(() => {})
  }
  return linha
}

/**
 * Leads que a empresa JA tem na mesma cidade — candidatos a serem o mesmo negocio do anuncio.
 *
 * Recorte barato de proposito (cidade por prefixo, poucas colunas): quem decide se e' o mesmo
 * negocio e' `meta-ads-descoberta.js#mesmoNegocio`, que e' PURO e conservador. Esta consulta so'
 * entrega o conjunto onde vale a pena procurar. Exclui o proprio canal: dois anuncios da mesma
 * pagina ja sao deduplicados pela chave `(empresa, origem, external_ref)`.
 */
async function candidatosParaFusao(empresaId, cidade, limite = 60) {
  if (!empresaId) return []
  const cid = String(cidade || '').trim()
  const prefixo = cid ? `${cid.split(/[,\-]/)[0].trim()}%` : null
  // SEM cidade a busca da aba Meta e' legitima, e antes ela desligava a dedup inteira — era
  // assim que o mesmo negocio virava duas linhas (uma do Maps, uma do anuncio). Nesse caso o
  // conjunto passa a ser quem TEM @ de Instagram, que e' a prova forte usada por `mesmoNegocio`
  // e a unica que dispensa a cidade.
  const { rows } = await pool.query(
    `SELECT id, nome, cidade, telefone, instagram_handle
       FROM prospectador.prospects
      WHERE empresa_id = $1::uuid
        AND origem <> 'meta_ads'
        AND ($2::text IS NULL OR cidade ILIKE $2)
        AND ($2::text IS NOT NULL OR NULLIF(BTRIM(instagram_handle), '') IS NOT NULL)
      ORDER BY updated_at DESC
      LIMIT $3`,
    [empresaId, prefixo, Math.max(1, Math.min(200, limite))]
  )
  return rows
}

/**
 * O lead que JA existia absorve a evidencia do anuncio — nenhuma linha nova e' criada.
 *
 * SO' ACRESCENTA: nao toca nome, telefone, nicho, status, qualificacao nem responsavel do lead
 * existente. O anuncio e' informacao NOVA sobre um negocio que a operacao ja conhece; deixar
 * este caminho reescrever o cadastro faria uma busca de anuncios mexer em lead que alguem ja
 * estava trabalhando. O @ do Instagram entra so' se o lead ainda nao tiver nenhum.
 */
async function absorverAnuncioEmLeadExistente(prospectId, lead) {
  const { rows } = await pool.query(
    `UPDATE prospectador.prospects
        SET anuncio_meta_ativo = $2,
            anuncio_meta_inicio_em = LEAST(
              COALESCE($3::timestamptz, anuncio_meta_inicio_em),
              COALESCE(anuncio_meta_inicio_em, $3::timestamptz)
            ),
            anuncio_meta_page_id = COALESCE(anuncio_meta_page_id, $4),
            anuncio_meta_verificado_em = NOW(),
            anuncio_meta_total_ativos = COALESCE($8, anuncio_meta_total_ativos),
            anuncio_meta_permalink = COALESCE($9, anuncio_meta_permalink),
            anuncio_meta_pagina_url = COALESCE($10, anuncio_meta_pagina_url),
            instagram_handle = COALESCE(instagram_handle, $5),
            instagram_origem = CASE
              WHEN instagram_handle IS NULL AND $5::text IS NOT NULL THEN $6 ELSE instagram_origem END,
            instagram_confianca = CASE
              WHEN instagram_handle IS NULL AND $5::text IS NOT NULL THEN $7 ELSE instagram_confianca END,
            updated_at = NOW()
      WHERE id = $1::uuid
      RETURNING id, (false) AS inserido`,
    [prospectId, lead.anuncio_meta_ativo === true, lead.anuncio_meta_inicio_em || null,
      lead.anuncio_meta_page_id, lead.instagram_handle || null,
      lead.instagram_origem || null, lead.instagram_confianca || null,
      Number.isFinite(lead.anuncio_meta_total_ativos) ? lead.anuncio_meta_total_ativos : null,
      lead.anuncio_meta_permalink || null, lead.anuncio_meta_pagina_url || null]
  )
  return rows[0] || null
}

/**
 * Grava o que o cross-reference com `fb_paginas` confirmou — em colunas GENERICAS que a
 * Aquisicao (Maps) ja usa (`tem_site`, `site`, `telefone`, `email`, `endereco`, `seguidores`),
 * nao em colunas proprias deste canal. E' o que faz o resto do sistema (ICP, prioridade de
 * ligacao, filtros de site) enxergar este lead do MESMO jeito que enxerga qualquer outro, sem
 * precisar aprender uma segunda fonte de verdade.
 *
 * SO' PROMOVE: nunca apaga telefone/e-mail/endereco ja conhecidos (`COALESCE`), e telefone
 * digitado por uma PESSOA continua vencendo qualquer coleta automatica (mesma regra de
 * `salvarProspect` em prospecting.js). `tem_site`/`classificacao_url` so' viram `site_proprio`
 * quando a pagina realmente confirma — nunca voltam atras se a pagina nao trouxer nada.
 */
async function gravarResultadoPagina(prospectId, {
  temSiteProprio = false, site = null, linkOriginal = null, classificacaoUrl = null,
  telefone = null, email = null, endereco = null, anuncioAtivoConfirmado = null, seguidores = null,
} = {}) {
  const { rows } = await pool.query(
    `UPDATE prospectador.prospects
        SET tem_site = CASE WHEN $3::boolean THEN true ELSE tem_site END,
            site = CASE WHEN $3::boolean THEN COALESCE(site, $2) ELSE site END,
            link_original = COALESCE($4, link_original),
            classificacao_url = CASE WHEN $3::boolean THEN $5 ELSE classificacao_url END,
            telefone = CASE
              WHEN COALESCE(raw_json->>'telefone_origem', '') = 'operador' THEN telefone
              ELSE COALESCE(telefone, $6)
            END,
            email = COALESCE(email, $7),
            endereco = COALESCE(endereco, $8),
            anuncio_meta_ativo = COALESCE($9, anuncio_meta_ativo),
            seguidores = COALESCE(seguidores, $10),
            anuncio_meta_pagina_verificada_em = NOW(),
            updated_at = NOW()
      WHERE id = $1::uuid
      RETURNING id, tem_site, site, telefone, email`,
    [prospectId, site, temSiteProprio, linkOriginal, classificacaoUrl, telefone, email, endereco,
      anuncioAtivoConfirmado, seguidores]
  )
  return rows[0] || null
}

module.exports = {
  salvarLeadDeAnuncio,
  candidatosParaFusao,
  absorverAnuncioEmLeadExistente,
  gravarResultadoPagina,
}
