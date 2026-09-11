-- 075_instancia_responsavel.sql
-- CRM em EQUIPE — Etapa 8. Responsável pela instância de WhatsApp + CONTEXTO PADRÃO da empresa.
-- Ver docs/especificacao-crm-equipe.md §2.3 e §2.5, e docs/plano-execucao-crm-equipe.md §6 (Etapa 8).
--
-- ══ PARTE 1: RESPONSÁVEL PELA INSTÂNCIA ══
--
-- O problema: as DUAS metades do "dono da instância" existem, em tabelas diferentes, sobre
-- sistemas de identidade diferentes, e nenhuma tem as duas:
--   * `app.empresa_whatsapp_instances` tem `empresa_id` e NÃO tem usuário;
--   * `vendas.whatsapp_connections` tem `user_id` (do dashboard LEGADO) e NÃO tem `empresa_id`.
-- Resultado: não existe "o número do vendedor" dentro do produto multiempresa.
--
-- `usuario_id` NULL = instância DA EMPRESA (compartilhada). É o comportamento de hoje, e
-- continua sendo o default — "compartilhada" e "exclusiva" passam a ser o mesmo modelo, com a
-- coluna nula ou preenchida. Sem isso seriam dois conceitos e duas telas.
--
-- ⚠️ O QUE ESTA COLUNA **NÃO** FAZ, E NUNCA DEVE FAZER
-- Ela **não participa da resolução de instância de ENVIO** (`services/instancia-envio.js`) nem da
-- resolução do WEBHOOK. Aquelas continuam olhando **empresa + instância provada**. Usar o usuário
-- para escolher por onde enviar seria "escolher número por quem mandou o comando" — o defeito que
-- a Fase 2 removeu e que o AGENTS.md proíbe nominalmente. Esta coluna serve a VISIBILIDADE
-- ("minhas instâncias") e à ATRIBUIÇÃO de responsabilidade, nada mais.
-- Há guarda de regressão em test/instancia-responsavel.test.js.
--
-- ══ PARTE 2: CONTEXTO PADRÃO DA EMPRESA ══
--
-- Corrige uma premissa comum sobre este produto: **o contexto NUNCA esteve preso à primeira
-- instância**. `app.empresa_contextos` já tem `empresa_id NOT NULL` — já é entidade da EMPRESA —,
-- já é compartilhável entre instâncias e já tem fluxo de transferência (`api-whatsapp.js`).
-- O que falta é um PADRÃO, para a instância nova não nascer sem conhecimento.
--
-- ⚠️ O PADRÃO É APLICADO NA **CRIAÇÃO**, NUNCA RESOLVIDO NA **RESPOSTA**.
-- `services/contexto-empresa.js` declara no próprio código: *"Atendimento é 100% por instância
-- (regra do projeto): instância informada mas SEM contexto linkado NÃO responde — nunca cai em
-- contexto da empresa 'fora da instância'."* Isso é deliberado, da mesma família da quarentena de
-- webhook: não se inventa qual conhecimento responde em nome de quem. Um fallback em tempo de
-- resposta faria a instância nova de um vendedor responder com o conhecimento de OUTRO
-- atendimento da mesma empresa, sem ninguém ter decidido isso.
-- Por isso esta coluna é lida por `api-whatsapp.js` no INSERT do vínculo, e `buscarContexto2Ativo`
-- **não é alterada** — com guarda de regressão.
--
-- ADITIVA: nenhum UPDATE de dado. Idempotente.

-- ---------------------------------------------------------------------------
-- 1. Responsável e autoria da instância
-- ---------------------------------------------------------------------------
-- Sem FK para `app.usuarios` em `usuario_id`? Não: aqui a FK CABE e é útil — a tabela já está no
-- schema `app` e já referencia `app.usuarios` em `origem_vinculo_usuario_id` (migration 061).
-- `ON DELETE SET NULL`: se a conta for removida, a instância vira da empresa — nunca some.
ALTER TABLE app.empresa_whatsapp_instances
  ADD COLUMN IF NOT EXISTS usuario_id UUID REFERENCES app.usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS criado_por UUID REFERENCES app.usuarios(id) ON DELETE SET NULL;

-- "Minhas instâncias": o caminho da tela do vendedor. Parcial porque a maioria é da empresa.
CREATE INDEX IF NOT EXISTS idx_instancias_usuario
  ON app.empresa_whatsapp_instances (empresa_id, usuario_id)
  WHERE usuario_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Contexto padrão da empresa
-- ---------------------------------------------------------------------------
-- `ON DELETE SET NULL`: apagar o contexto que era padrão não pode derrubar a empresa. A rota de
-- exclusão de contexto (`api-whatsapp.js`) já distingue "exclusivo" de "compartilhado"; um padrão
-- apagado simplesmente deixa de existir, e a instância nova nasce sem contexto — que é o
-- comportamento de hoje, e é seguro (ela não responde até alguém vincular).
ALTER TABLE app.empresas
  ADD COLUMN IF NOT EXISTS contexto_padrao_id UUID REFERENCES app.empresa_contextos(id) ON DELETE SET NULL;

COMMENT ON COLUMN app.empresa_whatsapp_instances.usuario_id IS
  'Responsavel pela instancia. NULL = instancia DA EMPRESA (compartilhada), que e o comportamento historico e o default. NAO participa da resolucao de instancia de ENVIO nem do webhook — aquelas olham empresa + instancia provada (services/instancia-envio.js). Serve a visibilidade e a responsabilidade.';
COMMENT ON COLUMN app.empresas.contexto_padrao_id IS
  'Contexto aplicado na CRIACAO de uma instancia nova, gravado explicitamente em empresa_whatsapp_instances.contexto_id. NUNCA e resolvido em tempo de RESPOSTA: "atendimento e 100% por instancia" (services/contexto-empresa.js) e um fallback ali faria a instancia de um vendedor responder com o conhecimento de outro atendimento.';
