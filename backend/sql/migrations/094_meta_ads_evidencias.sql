-- 094_meta_ads_evidencias.sql
-- Evidências do anúncio que o canal da Biblioteca (migrations 091-093) coletava e jogava fora,
-- mais os dois links que REALMENTE funcionam. Diagnóstico no dado real da sonda de 2026-09-22 —
-- ver docs/ai-task-start-log.md (2026-09-22 (2)).
--
-- (1) `anuncio_meta_total_ativos` — quantos anúncios ativos a última busca viu para a página.
--     O worker sempre deduplicou por página (uma linha por negócio, que é o certo), mas o NÚMERO
--     se perdia: "CMD SOLAR" apareceu 3x no mesmo lote e virava um lead sem registro de que havia
--     3 anúncios no ar. É a evidência mais direta de quanto o negócio está investindo agora.
--
-- (2) `anuncio_meta_permalink` — o anúncio na própria Biblioteca (`adArchiveID`).
-- (3) `anuncio_meta_pagina_url` — a página do anunciante (`page_profile_uri`).
--
--     POR QUE ESTES DOIS, e por que não bastava o que já havia: o destino do anúncio
--     (`snapshot.linkUrl`) vem como STUB na maioria dos casos — `http://fb.me/` (a raiz nua do
--     encurtador) em 5 dos 8 anúncios sondados, e `https://api.whatsapp.com/send` sem `phone` em
--     outro. São anúncios de clique-para-conversa: a Biblioteca não expõe o destino, e o link
--     aberto não leva a lugar nenhum. Estes dois, ao contrário, vieram em 8/8.
--
--     `page_profile_uri` NÃO é derivável do `page_id`: em 2 dos 5 casos a URL navegável aponta
--     para outro identificador. Guardá-la é o que permite o cross-reference com `fb_paginas`
--     consultar a página certa.
--
-- ADITIVA: três colunas nullable, SEM DEFAULT (um DEFAULT autorizaria em silêncio um INSERT
-- futuro que esquecesse a coluna). Nenhuma linha existente é mutada.

ALTER TABLE prospectador.prospects
  ADD COLUMN IF NOT EXISTS anuncio_meta_total_ativos INTEGER,
  ADD COLUMN IF NOT EXISTS anuncio_meta_permalink    TEXT,
  ADD COLUMN IF NOT EXISTS anuncio_meta_pagina_url   TEXT;

ALTER TABLE prospectador.prospects
  DROP CONSTRAINT IF EXISTS prospects_anuncio_meta_total_chk;
ALTER TABLE prospectador.prospects
  ADD CONSTRAINT prospects_anuncio_meta_total_chk
    CHECK (anuncio_meta_total_ativos IS NULL OR anuncio_meta_total_ativos >= 0);

COMMENT ON COLUMN prospectador.prospects.anuncio_meta_total_ativos IS
  'Anuncios ativos vistos para esta pagina na ultima busca. NULL = nunca medido (nao e zero).';
COMMENT ON COLUMN prospectador.prospects.anuncio_meta_permalink IS
  'O anuncio na Biblioteca (adArchiveID). Sempre navegavel — ao contrario do destino, que costuma vir stub.';
COMMENT ON COLUMN prospectador.prospects.anuncio_meta_pagina_url IS
  'URL navegavel da pagina do anunciante (page_profile_uri). NAO e derivavel do page_id.';
