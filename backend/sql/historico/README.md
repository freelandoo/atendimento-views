# SQL histórico

Arquivos que foram aplicados **à mão** (`psql`) num momento do passado e que **nenhum código
carrega**. `src/db.js` só lê `sql/init.sql` e `sql/prospeccao_orquestracao.sql`; as migrations
versionadas vivem em `sql/migrations/`.

Eles ficam aqui em vez de serem apagados porque o schema que criaram provavelmente está vivo em
produção, e o arquivo é o **único registro do que foi aplicado**. Apagar destruiria a única prova.

- `migracao_analise_estruturada.sql` — aplicado via `psql` na iniciativa "Atividade A"
  (`docs/historico/ATIVIDADE_A_*.md`). Movido para cá em 2026-09-23 (LEGACY_REVIEW §2.5).
