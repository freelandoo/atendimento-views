-- 018_prospeccao_busca_recorrente.sql
-- Habilita a "Agenda" do Google Places: re-rodar a BUSCA (pesquisarPlaces) a cada
-- X horas, dentro da janela/dias que a config já possui. Espelha o agendamento do
-- Instagram (captacao_campanhas.metadata_json), mas aqui em colunas próprias da
-- config por empresa. Apenas ADD COLUMN IF NOT EXISTS — não mexe em constraints
-- existentes nem em ON CONFLICT, então não reintroduz o hazard de boot.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'prospectador' AND table_name = 'prospeccao_configuracoes'
  ) THEN
    RETURN;
  END IF;

  -- Liga/desliga a re-busca automática (independente do disparo/rotina de envio).
  EXECUTE 'ALTER TABLE prospectador.prospeccao_configuracoes
             ADD COLUMN IF NOT EXISTS agendamento_busca_ativo BOOLEAN NOT NULL DEFAULT false';

  -- "A cada X horas" — frequência da re-busca (1..168h).
  EXECUTE 'ALTER TABLE prospectador.prospeccao_configuracoes
             ADD COLUMN IF NOT EXISTS busca_intervalo_horas SMALLINT NOT NULL DEFAULT 24';

  -- Marca quando a última re-busca automática rodou (controle de intervalo).
  EXECUTE 'ALTER TABLE prospectador.prospeccao_configuracoes
             ADD COLUMN IF NOT EXISTS ultima_busca_em TIMESTAMPTZ';

  -- Garante faixa válida do intervalo (idempotente: só cria se ainda não existe).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'prospectador.prospeccao_configuracoes'::regclass
       AND conname = 'prospeccao_config_busca_intervalo_chk'
  ) THEN
    EXECUTE 'ALTER TABLE prospectador.prospeccao_configuracoes
               ADD CONSTRAINT prospeccao_config_busca_intervalo_chk
               CHECK (busca_intervalo_horas BETWEEN 1 AND 168)';
  END IF;
END $$;
