-- =============================================================================
-- Desativa o overlay v4 do system-primeiro-contato no banco de producao.
--
-- Motivo: o overlay v4 (criado em 2026-05-12) sobrescreve o source com a
-- abertura institucional longa ("Ola! Eu sou o assistente virtual da PJ
-- Codeworks. Vou te ajudar com as primeiras informacoes..."). Esse texto
-- conflita com o tom-referencia.md e com a nova versao do source que esta
-- alinhada com o tom curto desejado pela equipe.
--
-- Apos rodar este SQL, o source no arquivo prompts/system-primeiro-contato.md
-- passa a ser a fonte unica de verdade (loadOverlaysFromDb nao encontra
-- overlay ativo e usa o que veio do disco).
--
-- Como executar:
--   - Railway CLI:  railway connect <postgres-service>  (psql interativo)
--                   ou: railway run psql -f scripts/desativar-overlay-primeiro-contato.sql
--   - Painel:       cole no Data tab do servico de Postgres
--
-- Reversivel: para reativar, basta UPDATE ... SET ativo=true onde id=<id>.
-- =============================================================================

-- 1) Mostrar o estado atual antes da mudanca
SELECT id, chave, version, autor, ativo, criado_em
FROM vendas.prompt_overlays
WHERE chave = 'system-primeiro-contato'
ORDER BY version DESC;

-- 2) Desativar o overlay v4 ativo
UPDATE vendas.prompt_overlays
SET ativo = false
WHERE chave = 'system-primeiro-contato'
  AND ativo = true
RETURNING id, version, autor, ativo;

-- 3) Confirmar que nao ha mais overlay ativo (deve retornar 0 linhas)
SELECT id, version, autor, ativo
FROM vendas.prompt_overlays
WHERE chave = 'system-primeiro-contato'
  AND ativo = true;
