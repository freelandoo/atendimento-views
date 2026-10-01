-- 115_asaas_webhook_events.sql
-- Webhook da ASAAS (cobranca recorrente) — ledger de IDEMPOTENCIA.
-- Proposta: docs/propostas/2026-10-01-planos-landing-e-cobranca-asaas.md (secao 4.1).
--
-- POR QUE: a ASAAS entrega "at least once" — o MESMO evento chega varias vezes, e a fila PAUSA
-- apos 15 falhas. O endpoint precisa ser idempotente: processa um evento uma vez so' e responde
-- 2xx rapido. Esta tabela e' a chave de dedup. O status do plano em si vive em app.empresa_plano
-- (114); aqui so' guardamos "este evento ja' foi processado".
--
-- ADITIVA: cria UMA tabela nova. Nenhuma tabela existente e' alterada. Idempotente (pode rodar 2x).
--
-- CHAVE = evento + id do pagamento/assinatura (ex.: 'PAYMENT_CONFIRMED:pay_123'). Um pagamento
-- gera varios eventos (created/confirmed/received), por isso o evento ENTRA na chave; reentrega
-- do mesmo evento para o mesmo pagamento nao reprocessa. O processamento (dedup + UPDATE do
-- status) roda numa transacao unica em db/empresa-plano.js: se o UPDATE falhar, o evento NAO fica
-- registrado e a ASAAS reenvia.

CREATE TABLE IF NOT EXISTS app.asaas_webhook_events (
  chave       TEXT PRIMARY KEY,
  tipo        TEXT NOT NULL,
  empresa_id  UUID REFERENCES app.empresas(id) ON DELETE SET NULL,  -- resolvida no processamento; NULL se desconhecida
  recebido_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
