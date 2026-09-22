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
        anuncio_meta_verificado_em)
     VALUES ($1,'meta_ads',$2,$3,$4,$5,false,$6,
             $7,$8,$9,$10,'coletado',$11::jsonb,
             $12,$13,$14,$15,
             NOW())
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
        updated_at = NOW()
     RETURNING id, (xmax = 0) AS inserido`,
    [
      empresaId, lead.external_ref, lead.nome, lead.nicho, lead.cidade, lead.site,
      lead.link_original, lead.classificacao_url, lead.categoria_perfil, lead.bio,
      JSON.stringify(lead.raw_json || {}),
      qualificacaoInicial(),
      lead.anuncio_meta_ativo === true, lead.anuncio_meta_inicio_em || null, lead.anuncio_meta_page_id,
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
  gravarResultadoPagina,
}
