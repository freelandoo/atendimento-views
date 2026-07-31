-- 052_ligacoes_motivo_perda_v2.sql
-- Centro de Ligacoes — Validacao Operacional: limpeza semantica dos motivos de perda.
--
-- Dois valores saem de MOTIVO_PERDA (fonte unica: src/domain-enums.js):
--
--   1) 'numero_invalido' — DUPLICADO. Ja existe em LIGACAO_RESULTADO (CHECK
--      ligacoes_resultado_chk, migration 040). Numero invalido e' uma DISPOSICAO DA CHAMADA
--      (o que aconteceu ao discar), nao um motivo pelo qual a oportunidade foi perdida.
--      Manter nos dois enums permitia combinacoes contraditorias gravaveis, do tipo
--      resultado='atendeu' + motivo_perda='numero_invalido'.
--
--   2) 'pediu_novo_contato' — NAO E' PERDA, e' adiamento. O lead que pede novo contato segue
--      vivo. O caso ja e' coberto por resultado='reagendou' + status de oportunidade
--      'follow_up' + proxima_acao/data_followup em app.campanha_leads. Como "motivo de perda"
--      ele inflava a contagem de perdas com leads que continuam no funil — distorcendo
--      qualquer leitura de app.vw_ligacoes_analiticas (que expoe motivo_perda).
--
-- ARQUIVA ANTES DE ALTERAR (mesma postura da migration 050). runMigrations roda no BOOT
-- (src/db/migrations.js), entao isto executa sozinho em producao no proximo deploy, sem
-- operador olhando. O banco local tinha 2 linhas afetadas (ambas 'numero_invalido' junto de
-- resultado='numero_invalido', i.e. redundancia pura) e nenhuma 'pediu_novo_contato' — mas
-- producao pode ter outras, e para 'pediu_novo_contato' o valor NAO e' recuperavel a partir
-- de nenhuma outra coluna. Por isso o arquivo abaixo, e nao um UPDATE direto.

CREATE TABLE IF NOT EXISTS app.ligacoes_motivo_perda_v1_arquivo (
  ligacao_id           UUID PRIMARY KEY,
  empresa_id           UUID,
  motivo_perda_antigo  TEXT NOT NULL,
  resultado_no_momento TEXT,
  arquivado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE app.ligacoes_motivo_perda_v1_arquivo IS
  'Valores de motivo_perda descontinuados pela migration 052 (numero_invalido, pediu_novo_contato). Existe so para auditoria/recuperacao; fora da analitica.';

INSERT INTO app.ligacoes_motivo_perda_v1_arquivo
      (ligacao_id, empresa_id, motivo_perda_antigo, resultado_no_momento)
SELECT l.id, l.empresa_id, l.motivo_perda, l.resultado
  FROM app.ligacoes l
 WHERE l.motivo_perda IN ('numero_invalido', 'pediu_novo_contato')
ON CONFLICT (ligacao_id) DO NOTHING;

UPDATE app.ligacoes
   SET motivo_perda = NULL
 WHERE motivo_perda IN ('numero_invalido', 'pediu_novo_contato');

-- Agora que nenhuma linha viola o novo dominio, troca a CHECK. A migration 040 permanece
-- intocada (ja aplicada); ESTE arquivo passa a ser a fonte da constraint, e o teste
-- anti-drift (test/domain-enums.test.js) aponta para ca.
ALTER TABLE app.ligacoes DROP CONSTRAINT IF EXISTS ligacoes_motivo_perda_chk;
ALTER TABLE app.ligacoes ADD CONSTRAINT ligacoes_motivo_perda_chk CHECK (motivo_perda IS NULL OR motivo_perda IN (
  'nao_era_decisor', 'sem_disponibilidade', 'sem_prioridade', 'sem_orcamento',
  'ja_tem_fornecedor', 'nao_percebeu_valor', 'sem_perfil', 'sem_interesse'
));
