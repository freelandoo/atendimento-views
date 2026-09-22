-- 093_meta_ads_ajustes.sql
-- Ajuste no canal da Biblioteca de Anuncios do Meta (migrations 091/092), depois da analise de
-- impacto de 2026-09-22 — ver docs/ai-task-start-log.md.
--
-- `pagina_facebook` como ORIGEM de Instagram: o registro do anuncio ja traz o `ig_username` que
-- o anunciante declarou na PROPRIA pagina dele. E' a mesma classe de evidencia de
-- `google_meu_negocio` — o dono escrevendo o proprio @ na ficha dele —, e nao uma inferencia da
-- maquina como `busca`. Sem este valor, o lead pagaria uma consulta SERP (cota diaria disputada
-- com os leads do Maps) para descobrir um @ que ja estava na mao.
--
-- NAO ha' coluna de "lead fundido" aqui de proposito: a dedup entre canais (mesma empresa achada
-- no Maps e na Biblioteca de Anuncios) resolve NAO CRIANDO a segunda linha — a evidencia do
-- anuncio e' gravada no lead que ja existia. Sem linha duplicada, nao ha' o que apontar, e uma
-- coluna sem escritor seria schema morto nascendo pronto.
--
-- ADITIVA: alarga um CHECK (so' ADICIONA valor). Nenhuma linha existente e' mutada.

ALTER TABLE prospectador.prospects
  DROP CONSTRAINT IF EXISTS prospects_instagram_origem_chk;
ALTER TABLE prospectador.prospects
  ADD CONSTRAINT prospects_instagram_origem_chk
    CHECK (instagram_origem IS NULL
           OR instagram_origem IN ('google_meu_negocio', 'busca', 'operador', 'pagina_facebook'));
