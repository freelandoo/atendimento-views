-- 092_meta_ads_pagina.sql
-- Cross-reference da PAGINA do Facebook do anunciante (dataset `fb_paginas` da Bright Data,
-- ja sondado em 2026-09-22 — ver docs/ai-task-start-log.md) para o lead que a Biblioteca de
-- Anuncios (migration 091) ja salvou. Confirma telefone/e-mail/endereco/site real e o
-- `is_running_ads` da PROPRIA pagina (segunda prova, independente do anuncio).
--
-- POR QUE NAO CRIA TABELA NOVA. `prospectador.enriquecimento_etapas` (migration 082) ja e' uma
-- fila generica por (lead, etapa) — retry, backoff, lease, idempotencia — e nenhuma parte do SQL
-- daquela tabela e' especifica de Instagram (so' `COLS_LEAD`, que so' precisa aprender a ler mais
-- uma coluna). Criar uma segunda fila para este canal duplicaria uma maquina que ja funciona.
-- So' os ESCRITORES do resultado sao proprios (`db/meta-ads-leads.js#gravarResultadoPagina`) —
-- Instagram escreve em colunas `instagram_*`, este canal escreve em colunas genericas que a
-- Aquisicao (Maps) ja usa (`tem_site`, `site`, `telefone`, `email`, `endereco`, `seguidores`).
--
-- ADITIVA: alarga dois CHECKs ja existentes (so' ADICIONA valor, nao remove nenhum) e acrescenta
-- UMA coluna nullable sem DEFAULT.

-- (1) Nova etapa na MESMA fila do enriquecimento (082). Continuam sendo "duas etapas" de
-- Instagram — esta e' de OUTRO canal, so' reaproveita a maquina.
ALTER TABLE prospectador.enriquecimento_etapas
  DROP CONSTRAINT IF EXISTS enriquecimento_etapas_etapa_chk;
ALTER TABLE prospectador.enriquecimento_etapas
  ADD CONSTRAINT enriquecimento_etapas_etapa_chk
    CHECK (etapa IN ('instagram_descoberta', 'instagram_perfil', 'meta_ads_pagina'));

-- (2) `fb_paginas` e' um SCRAPER novo no MESMO ledger que ja trava Aquisicao e enriquecimento
-- de Instagram (081) — sem isso ele gastaria credito sem orcamento nenhum, o mesmo defeito que
-- a 081 corrigiu.
ALTER TABLE prospectador.brightdata_consumo
  DROP CONSTRAINT IF EXISTS brightdata_consumo_scraper_chk;
ALTER TABLE prospectador.brightdata_consumo
  ADD CONSTRAINT brightdata_consumo_scraper_chk
    CHECK (scraper_type IN ('maps_descoberta', 'ig_descoberta', 'ig_perfis', 'ig_posts',
                            'li_descoberta', 'li_perfis', 'fb_paginas'));

-- (3) Quando a PAGINA foi cruzada pela ultima vez — separado de `anuncio_meta_verificado_em`
-- (091, que marca quando a evidencia do ANUNCIO foi vista) de proposito: sao dois fatos
-- diferentes, verificados em momentos diferentes, e confundir os dois faria o worker achar que
-- ja cruzou a pagina so' porque salvou o anuncio.
ALTER TABLE prospectador.prospects
  ADD COLUMN IF NOT EXISTS anuncio_meta_pagina_verificada_em TIMESTAMPTZ;

COMMENT ON COLUMN prospectador.prospects.anuncio_meta_pagina_verificada_em IS
  'Quando o cross-reference com fb_paginas rodou pela ultima vez. NULL = nunca rodou.';
