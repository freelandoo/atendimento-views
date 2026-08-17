-- 068_ligacao_sessao_origem.sql
-- Central de Ligacoes — de QUAL SESSAO/APARELHO partiu a ultima transicao de ciclo de vida
-- da ligacao (inicio, fim da chamada, encerramento, descarte).
--
-- POR QUE: a mesma conta e' usada em dois aparelhos ao mesmo tempo (liga pelo celular, olha a
-- fila no computador). `usuario_id` responde QUEM e so'. Sem isto, "voce ja esta nesta
-- ligacao" nao consegue dizer se e' nesta tela ou no outro aparelho, e a tela que descobre um
-- encerramento remoto nao consegue explicar de onde ele veio.
--
-- ADITIVA E SEGURA POR CONSTRUCAO:
--   * duas colunas NULLABLE, SEM DEFAULT, e NENHUM UPDATE em linha existente;
--   * nenhuma coluna, CHECK, indice ou constraint pre-existente e' alterada;
--   * `NULL` = origem NAO REGISTRADA (ligacao anterior a esta entrega, ou cliente que nao
--     manda o cabecalho). Terceiro estado legitimo — nao e' "computador" por omissao. Um
--     DEFAULT aqui faria o banco afirmar um aparelho que ninguem observou.
--
-- O QUE ENTRA NA COLUNA: a IMPRESSAO (prefixo de SHA-256, 12 hex) da chave opaca de sessao
-- gerada pelo cliente — NUNCA a chave. Ver src/services/sessao-origem.js. A impressao nao e'
-- credencial (nao autentica nada; quem autentica e' o Bearer token) e nao e' reversivel.
-- Nenhuma rota a devolve: a API publica apenas o booleano `mesma_sessao` e o aparelho.
--
-- SEMANTICA: as colunas guardam a ULTIMA transicao de ciclo de vida, nao so' o inicio. E' o
-- que a tela ao vivo precisa dizer ("encerrada no celular"), e o historico completo por acao
-- continua em app.auditoria_eventos (contexto JSONB — sem migration).

ALTER TABLE app.ligacoes
  ADD COLUMN IF NOT EXISTS sessao_origem      TEXT,
  ADD COLUMN IF NOT EXISTS sessao_dispositivo TEXT;

-- Lista FECHADA de aparelhos (mesma disciplina de `origem_vinculo`, migration 061): admitir
-- texto livre aqui deixaria a coluna virar campo de observacao. NOT VALID nao e' preciso —
-- todas as linhas existentes tem NULL, que a CHECK aceita.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ligacoes_sessao_dispositivo_chk'
       AND conrelid = 'app.ligacoes'::regclass
  ) THEN
    ALTER TABLE app.ligacoes
      ADD CONSTRAINT ligacoes_sessao_dispositivo_chk
      CHECK (sessao_dispositivo IS NULL OR sessao_dispositivo IN ('computador', 'celular'));
  END IF;
END $$;

COMMENT ON COLUMN app.ligacoes.sessao_origem IS
  'Impressao (SHA-256 truncado) da sessao que fez a ULTIMA transicao de ciclo de vida. NUNCA a chave crua. NULL = nao registrada.';
COMMENT ON COLUMN app.ligacoes.sessao_dispositivo IS
  'Classe de aparelho declarada pelo cliente na ultima transicao: computador | celular. NULL = nao registrada.';
