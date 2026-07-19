# Arquitetura do projeto

> **Fontes canônicas:** o mapa físico de pastas vive em [project-map.md](project-map.md) e
> as leis técnicas em [architecture-rules.md](architecture-rules.md). Este arquivo é o ponto
> de entrada de arquitetura do [workflow padrão](ai-workflow.md) (Fase 6): **não duplica**
> aqueles documentos — resume a stack, os fluxos e os limites, e mantém o log de decisões
> arquiteturais aprovadas.

## Objetivo

Orientar futuras alterações estruturais. Toda mudança de arquitetura precisa respeitar o que
está aqui e nos documentos canônicos; se algo não estiver claro, a IA propõe e **pede
confirmação** antes de implementar (ver [ai-workflow.md](ai-workflow.md) → Regra nova 2).

## Stack principal

- **Back-end:** Node.js + Express (JavaScript; poucos `.ts` pontuais). Diretório `backend/`.
- **Front-end:** dois consumidores — dashboard **estático** (`backend/public/`) e app
  **Next.js (App Router)** em `frontend/`.
- **Banco:** PostgreSQL via `pg` (schemas `vendas`, `prospectador`, `app`).
- **Autenticação:** JWT (SaaS multiempresa, `src/auth.js` + `src/middleware/tenant.js`) e
  segredos de admin/webhook para o dashboard estático (`src/dashboardAuth.js`).
- **Deploy:** Railway (Root Directory `backend/`) + Vercel (Root Directory `frontend`).
  Serviço auxiliar Python de transcrição (`whisper-service/`) com deploy separado.
- **Integrações:** Anthropic/OpenAI (LLM), Evolution API (WhatsApp), Freelandoo
  (canal + API de dados), Meta CTWA/CAPI, Bright Data (captação social), Google Places/CSE.

## Estrutura de pastas e camadas

Detalhe completo em [project-map.md](project-map.md). Separação obrigatória
([architecture-rules.md](architecture-rules.md), Regra 1):

- **Entrada HTTP / rotas:** `index.js`, `src/routes.js`, `src/*-routes.js`, `src/routes/api-*.js`,
  `src/webhook-handler.js` — sem regra de negócio pesada.
- **Regra de negócio / orquestração:** `src/agent*.js`, `src/*-orchestrator.js`,
  `core-funnel.js`, `conversation-pipeline.js`.
- **Serviços de prospecção/captação:** `src/services/*`.
- **Acesso a banco:** isolado em `src/db.js` / `src/db-crud.js` / `src/db/*.js`.
- **Integrações externas:** `src/ai-provider.js`, `src/whatsapp.js`, `src/agenda.js`,
  `src/freelandoo/*`, `src/services/meta-attribution.js`.
- **Validação/schemas:** `src/domainSchemas.js`, `src/*-validator.js`.
- **UI:** `backend/public/` (estático) e `frontend/` (Next.js) — apenas apresentação.

## Padrões por camada

### Front-end
Reaproveitar componentes/tokens existentes antes de criar novos; padrão visual em
[ui-visual-standard.md](ui-visual-standard.md). Toda tela do dashboard estático deve ter
estado de carregando/vazio/erro (Regra 6). Nenhuma lógica crítica/segredo no cliente.

### Back-end
Toda rota: validação de entrada, tratamento de erro, resposta padronizada, auth/autorização
quando necessário, logs seguros sem PII (Regra 3). Regras sensíveis (financeiro, pagamento,
assinatura, custo, permissão, status oficial, dados de dashboard) são protegidas no back-end.

### Banco de dados
Migrations em `sql/` aplicadas no boot (`src/db/migrations.js` ao fim de `initDB`). Nova
tabela/campo/migration só com explicação de impacto, plano de migração compatível com dados
existentes e confirmação (Regra 4). Isolamento por tenant (`empresa_id`).

## Fluxos principais

- **Atendimento/conversa:** webhook → resolve tenant → `conversation-pipeline`/`agent` → LLM → WhatsApp.
- **Prospecção/captação:** seletor de mercado por IA → Places/Bright Data → elegibilidade →
  disparo com teto/cooldown → trava de 15 dias.
- **Financeiro/atribuição:** Meta CTWA → `lead_profiles.origem` + `score_lead` → eventos CAPI
  (`LeadSubmitted`/`Purchase`).
- **SaaS multiempresa:** JWT → `requireEmpresaAccess` → rotas `/api/*` → frontend Next.js.

## Quando pedir aprovação de arquitetura

Nova tabela/campo/migration; novo módulo; nova dependência/framework; mudança de arquitetura
de pastas/rotas/services/APIs; refatoração grande; mudança em financeiro/assinatura/dashboard/
permissão/integração; alteração que cria um novo padrão para futuras telas/funcionalidades.

## Decisões arquiteturais aprovadas

Log das decisões estruturais em [ai-decision-log.md](ai-decision-log.md).

### 2026-07-17 — Aquisição com modos explícitos e estado persistido

A busca do Google Maps possui três modos por empresa: manual, automático fixo e IA. O backend é
a fonte de verdade para intervalo, limite diário, preferências, mercado atual e estado operacional.
O frontend apenas edita e apresenta essa configuração. O scheduler admite uma coleta ativa por
empresa; o worker registra quantos `place_id` eram realmente novos e decide entre continuar,
trocar de mercado ou declarar o mercado fixo esgotado. O envio permanece fora deste fluxo.

<!-- Modelo (ver também ai-decision-log.md):

### [DATA] — [Decisão]
- Motivo:
- Alternativas consideradas:
- Impacto:
- Riscos:
- Como validar:

-->
