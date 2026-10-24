-- 119_audio_transcricao_resiliente.sql
-- Processamento de áudio recebido: escopo comprovado, estado persistente e retomada por job.
-- É aditiva para as linhas legadas; nenhuma delas ganha empresa/instância inventada.

ALTER TABLE vendas.audio_processamentos
  ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES app.empresas(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS evolution_instance TEXT,
  ADD COLUMN IF NOT EXISTS job_id BIGINT REFERENCES vendas.job_queue(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tentativa_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS proxima_tentativa_em TIMESTAMPTZ;

ALTER TABLE vendas.audio_processamentos
  DROP CONSTRAINT IF EXISTS audio_processamentos_status_chk;

-- A CHECK antiga ainda aceita apenas `processed`; primeiro liberamos a transição
-- e só depois normalizamos as linhas legadas, dentro da mesma transação da migration.
UPDATE vendas.audio_processamentos
   SET status = 'completed'
 WHERE status = 'processed';

ALTER TABLE vendas.audio_processamentos
  ADD CONSTRAINT audio_processamentos_status_chk
  CHECK (status IN ('pending', 'downloading', 'transcribing', 'completed', 'retrying', 'failed'));

CREATE INDEX IF NOT EXISTS idx_audio_processamentos_empresa_numero
  ON vendas.audio_processamentos (empresa_id, numero, criado_em DESC)
  WHERE empresa_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audio_processamentos_status
  ON vendas.audio_processamentos (status, proxima_tentativa_em, criado_em DESC)
  WHERE status IN ('pending', 'retrying', 'downloading', 'transcribing');

ALTER TABLE vendas.job_queue
  DROP CONSTRAINT IF EXISTS job_queue_tipo_chk;

ALTER TABLE vendas.job_queue
  ADD CONSTRAINT job_queue_tipo_chk
  CHECK (tipo IN ('webhook_resposta', 'audio_transcricao', 'followup_auto', 'agenda_lembrete_reuniao', 'prospeccao_nichos_sync', 'prospeccao_places_auto', 'prospeccao_completo', 'prospeccao_envio_agendado', 'resumo_agenda_operador')) NOT VALID;
