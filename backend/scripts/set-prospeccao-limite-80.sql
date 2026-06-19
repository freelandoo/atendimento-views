-- Define o limite de prospeccao para 80 mensagens/dia.
--
-- Aplica nas duas configuracoes porque o sistema ainda mantem compatibilidade
-- com a tabela legada auto_prospeccao_config enquanto a operacao diaria nova
-- usa prospeccao_configuracoes.

INSERT INTO prospectador.prospeccao_configuracoes (singleton_id, limite_diario)
VALUES (true, 80)
ON CONFLICT (singleton_id) DO UPDATE
SET limite_diario = 80,
    atualizado_em = NOW()
RETURNING singleton_id, modo, horario_inicio, horario_fim, intervalo_envio_minutos, limite_diario;

INSERT INTO prospectador.auto_prospeccao_config (singleton_id, weekly_limit)
VALUES (true, 80)
ON CONFLICT (singleton_id) DO UPDATE
SET weekly_limit = 80,
    updated_at = NOW()
RETURNING singleton_id, modo, weekday, hour, minute, weekly_limit, intervalo_envio_minutos;
