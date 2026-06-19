# Project Map

Mapa de pastas e responsabilidades. Consulte antes de qualquer alteração estrutural.
Stack: **Node.js + Express (JavaScript)**, PostgreSQL (`pg`), integração Anthropic,
dashboard estático e jobs de prospecção.

> **Layout físico (split 2026-06-19):** o backend vive em **`backend/`** e o frontend
> Next.js em **`frontend/`** (antigo `apps/web/`). Os caminhos abaixo (`index.js`, `src/…`,
> `prompts/…`, `sql/…`) são relativos a `backend/`. Deploy: Railway com Root Directory
> `backend/`, Vercel com Root Directory `frontend`.

## Raiz de `backend/`
- `index.js` — bootstrap: valida env obrigatórias, registra rotas, inicia servidor.
- `index.monolith.js` — versão monolítica histórica (gerada/consolidada via `tools/build-split.cjs`).
- `package.json` — scripts: `start`, `test`, `typecheck`, `smoke:preco`.
- `tsconfig.json` — usado por `npm run typecheck` (há poucos `.ts`, ex. `src/project-handoff-types.ts`).
- `docker-compose.yml`, `dockerfile`, `railway.json` — deploy (produção em Railway).
- `.env.example` — referência de variáveis de ambiente.

## `src/` — backend
### Entrada HTTP / rotas
- `routes.js` — agregador de rotas.
- `webhook-handler.js`, `whatsapp-routes.js`, `ai-routes.js`, `ai-test-routes.js`.

### Conversa / funil / orquestração (regra de negócio)
- `agent.js` — núcleo da conversa, funil e parsing das respostas LLM.
- `agent-actions.js`, `agent-orchestrator.js`, `agent-validators.js`.
- `next-action-orchestrator.js`, `goal-selector.js`, `core-funnel.js`.
- `conversation-pipeline.js`, `conversation-stage-classifier.js`.
- `intent-detector.js`, `confusion-handler.js`, `question-limiter.js`.
- `follow-up.js`, `followup-auto.js`, `followup-execution.js`.
- `operator-commands.js`, `operator-meeting-detector.js`, `meeting-invite.js`.
- `lead-profile.js`, `lead-profile-canonical.js`, `learning.js`.
- `message-buffer.js`, `message-limits.js`, `reply-delay.js`.

### Serviços de prospecção
- `prospecting.js` — endpoints/jobs de prospecção (entrada).
- `services/prospecting-*.js` — fila diária, elegibilidade, agendamento, geração de
  mensagem, worker de envio, relatórios e analytics.

### Acesso a dados
- `db.js` — pool, init/migração via `sql/init.sql` (fallback inline).
- `db-crud.js` — operações CRUD.

### Integrações externas
- `ai-provider.js`, `ai-response.js`, `ai-structured-analysis.js` — LLM (Anthropic).
- `whatsapp.js` — envio/recebimento (Evolution API).
- `agenda.js` — agendamento/eventos.
- `media-processing.js` — mídia/áudio.

### Validação, segurança e utilidades
- `domainSchemas.js`, `action-response-validator.js`, `message-validator.js`,
  `public-message-guard.js` — validação.
- `dashboardAuth.js` — autenticação do dashboard / rotas admin.
- `config.js`, `logger.js`, `guardrail-logger.js`, `handoff-alerts.js`.
- `string-utils.js`, `date-utils.js`, `institutional-language.js` — helpers.
- `pricing.js`, `preview-site.js`, `project-handoff-*.js` — proposta/precificação/handoff.

## `prompts/` — conhecimento do agente (LLM)
- `system-core.md` + `system-*.md` (primeiro-contato, diagnóstico, proposta,
  objeção, fechamento) — regras por etapa do funil.
- `empresa.md` — conhecimento autorizado e links permitidos.
- `agent-base.md`, `classificador-intencao.md`, `followup*.md`, `lead-coach.md`,
  `tom-referencia.md`.
> Alterações aqui afetam produção diretamente — justifique o impacto.

## `sql/` — schema e migrações
- `init.sql` — schema base (carregado por `src/db.js`).
- `migracao_analise_estruturada.sql`, `prospeccao_orquestracao.sql`.
- Vários `*.sql` de backup/restore na raiz são utilitários históricos, não schema vivo.

## `public/` — dashboard estático (UI)
- HTML na raiz de `public/` (login, conversas, agenda, prospecção, analytics, etc.).
- `public/dashboard/js/*` — comportamento do dashboard.
- `public/dashboard/css/*` — estilos.
> Apenas apresentação. **Nenhuma** lógica crítica ou segredo deve viver aqui.

## `test/` — testes (`node --test`)
- `core.test.js` — regras de negócio base.
- Demais `*.test.js` cobrem prospecção, funil, follow-up, agendamento, intenção, etc.
> Nem todos entram em `npm test`; ao tocar regra coberta, garanta que o teste roda.

## `scripts/` e `tools/`
- `scripts/*` — migrações pontuais, dumps de prompts, testes de integração manuais.
- `tools/build-split.cjs` — gera/divide o monolito.

## `whisper-service/` — serviço Python auxiliar (transcrição), deploy separado.

## `docs/` — documentação
- `project-map.md` (este arquivo), `architecture-rules.md`,
  `ai-implementation-checklist.md`, `change-impact-template.md`.
- Auditorias, roadmaps e revisões técnicas datadas.
