-- 056_site_classificacao.sql
-- Classificação canônica de "site próprio" x rede social / agregador / diretório.
--
-- PROBLEMA QUE ESTA MIGRATION HABILITA CORRIGIR
-- Até aqui, `prospectador.prospects.site` guardava QUALQUER link e `tem_site` era
-- literalmente `site IS NOT NULL`. Um lead cujo único link é o Instagram (ou o Linktree
-- da bio, gravado pela captação social) contava como "já tem site" — justamente o lead
-- mais qualificado de uma campanha de CRIAÇÃO de site. Ele sumia do filtro "Sem site" e
-- perdia o bônus de prioridade na fila da Central de Ligações.
--
-- O QUE ESTA MIGRATION FAZ (ADITIVA — nenhum dado é mutado aqui)
--   1. `link_original`     — o link CRU recebido na coleta/importação, preservado para
--                            auditoria e rastreabilidade. `site` passa a significar
--                            exclusivamente "site próprio confirmado".
--   2. `classificacao_url` — a categoria decidida pelo classificador central
--                            (src/services/site-classificacao.js).
--   3. Preenche `link_original` a partir de `site` onde ainda estiver vazio. Isto é
--            CÓPIA, não mutação: nenhum valor existente é sobrescrito ou apagado.
--
-- O QUE ESTA MIGRATION *NÃO* FAZ, DE PROPÓSITO
-- Ela NÃO reclassifica `tem_site` nem limpa `site`. A regra de classificação vive em
-- JavaScript (é lógica de negócio testada, não SQL) e a correção histórica precisa de
-- simulação, lotes e relatório antes de gravar. Isso é trabalho do script:
--
--     npm run reclassificar:sites              # simulação (padrão), não grava nada
--     npm run reclassificar:sites -- --aplicar # grava
--
-- Enquanto o script não roda, as telas já mostram o resultado correto: os consumidores
-- derivam a situação do lead pelo classificador na LEITURA. As colunas abaixo são cache
-- e auditoria, nunca a autoridade.

ALTER TABLE prospectador.prospects
  ADD COLUMN IF NOT EXISTS link_original     TEXT,
  ADD COLUMN IF NOT EXISTS classificacao_url TEXT;

-- Vocabulário fechado do classificador. NULL = ainda não classificado (lead antigo,
-- antes do script rodar) — não confundir com 'desconhecido', que é uma decisão tomada.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'prospects_classificacao_url_chk'
       AND conrelid = 'prospectador.prospects'::regclass
  ) THEN
    ALTER TABLE prospectador.prospects
      ADD CONSTRAINT prospects_classificacao_url_chk
      CHECK (classificacao_url IS NULL OR classificacao_url IN (
        'site_proprio', 'rede_social', 'agregador',
        'perfil_ou_diretorio', 'desconhecido', 'sem_link'
      ));
  END IF;
END $$;

-- Preserva o link cru antes que o script passe a limpar `site` nos casos não-site.
-- Idempotente: só toca linhas cujo `link_original` ainda está vazio.
UPDATE prospectador.prospects
   SET link_original = site
 WHERE link_original IS NULL
   AND site IS NOT NULL
   AND btrim(site) <> '';

-- A correção histórica varre os leads ainda não classificados; o índice parcial mantém
-- essa varredura barata mesmo com a tabela grande.
CREATE INDEX IF NOT EXISTS idx_prospects_classificacao_url_pendente
  ON prospectador.prospects (empresa_id)
  WHERE classificacao_url IS NULL;
