# Project Map

Mapa de pastas e responsabilidades. **Consulte antes de qualquer alteração estrutural.**

> **Números medidos em 2026-09-21.** Este arquivo já esteve desatualizado a ponto de citar
> arquivos que não existem (`index.monolith.js`, `railway.json`) e descrever `src/db/` como
> tendo 2 arquivos quando tem 47. Se você mexer na estrutura, atualize aqui **no mesmo commit**.
> A fonte viva e detalhada das decisões é o **`AGENTS.md`** (raiz); este mapa é o índice.

## O fato que explica o repositório inteiro

O sistema roda **duas gerações de produto no mesmo processo Node**:

| | **Geração 1 — legada** (viva, em uso, **cercada**) | **Geração 2 — atual** (o produto) |
|---|---|---|
| UI | `backend/public/*.html` — 15 páginas estáticas | `frontend/` — Next.js 14, 29 rotas |
| API | `/dashboard/*` e `/api/operador/*` — **98 rotas** | `/api/empresas/:empresaId/*` — **300 rotas** |
| Onde a rota mora | dentro de `src/agent.js`, `prospecting.js`, `agenda.js`, `whatsapp-routes.js`, `ai-routes.js`, `meta-routes.js`, `leads-quentes.js` | `src/routes/api-*.js` |
| Autenticação | `src/dashboardAuth.js` — cookie httpOnly + CSRF | `src/auth.js` (JWT) + `src/middleware/tenant.js` — papel do vínculo + capacidades |
| Escopo | single-tenant (PJ Codeworks) | multiempresa, empresa provada pela instância |

A geração 1 **não se apaga hoje** (o operador ainda a usa), mas **não pode crescer**:
`backend/test/legado-cercado.test.js` congela os três números (98 rotas, 15 páginas, 7 módulos
usando a auth legada) e falha se algum subir. Rota nova, tela nova e código novo nascem na
geração 2 — sem exceção.

---

## Layout físico

- **`backend/`** — API Node/Express. Deploy Railway com Root Directory `backend/`.
- **`frontend/`** — app Next.js (App Router). Deploy Vercel com Root Directory `frontend`.
- **raiz** — governança (`AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/`), `docker-compose.yml`
  (ambiente local: Postgres + Redis + Evolution + backend) e os relatórios da reorganização
  (`ARCHITECTURE_AUDIT.md`, `REFACTOR_BASELINE.md`, `LEGACY_REVIEW.md`).

Todos os caminhos abaixo são relativos a `backend/`, salvo onde dito.

## `backend/` — raiz

- `index.js` (368 linhas) — **só boot**: valida env obrigatórias, monta middlewares e ~35
  routers, inicia os workers e sobe o servidor.
- `package.json` — `start`, `test`, `typecheck`, `smoke:preco` + 12 comandos operacionais
  (backfills, medições, reclassificações). **Não existe `build` nem `lint`.**
- `tsconfig.json` — usado por `npm run typecheck` (o runtime é CommonJS; há 1 `.ts` de tipos).
- `Dockerfile` — imagem de produção (Node 20).
- `.env.example` — referência de variáveis. ⚠️ Descreve 39 das ~153 lidas pelo código; o
  catálogo completo em prosa está no `AGENTS.md`.

## `backend/src/` — 247 arquivos

### `routes/` (38) — camada HTTP da geração atual
Rotas `/api/empresas/:empresaId/*`, finas: validam entrada, chamam `services/` ou `db/`,
devolvem. Autorizam com `requireAuth` → `requireEmpresaAccess` → `requireCapacidade`.
**Nunca** usam `dashboardAuth` (há guarda).

### `services/` (97) — regra de negócio
Majoritariamente **puros e testados** (sem banco, HTTP, IA ou rede): recebem dados e devolvem
veredito. É onde vive o vocabulário do domínio. Maior arquivo: `contexto2-runtime.js` (1.042).

### `db/` (47) — acesso a dados, um arquivo por domínio
`comissao.js`, `missao.js`, `ligacoes.js`, `lead-icp.js`, `follow-ups.js`… Todo SQL do produto
atual nasce aqui. (A regra antiga dizia "isolado em `db.js`/`db-crud.js`" — isso descreve só o
caminho legado.)

### `workers/` (1) — registro único do que roda em segundo plano
Lista os 6 workers, com nome, descrição e política de falha na largada (`essencial: true`
derruba o boot; `false` só registra). **Não contém lógica de worker** — cada `iniciar` mora no
seu domínio.

### `middleware/` (1) — `tenant.js`
`requireAuth`, `requireEmpresaAccess`, `requireCapacidade`, `resolveEmpresaFromWebhook`.
Resolve a empresa pela instância do WhatsApp, **sem fallback**: origem não comprovada vai para
quarentena.

### `freelandoo/` (4) — canal alternativo de atendimento (token, não QR)

### Raiz de `src/` (65 arquivos) — o núcleo do agente + o legado
É a pasta mais bagunçada do repositório, e a bagunça tem nome: ali convivem o motor de IA, os
helpers genéricos e as 98 rotas da geração 1.

- **Núcleo da conversa:** `agent.js` (**7.475 linhas** — funil, parsing do LLM, precificação,
  37 endpoints e composition root do webhook), `core-funnel.js` (2.322),
  `conversation-pipeline.js`, `next-action-orchestrator.js`, `goal-selector.js`,
  `intent-detector.js`, `question-limiter.js`, `confusion-handler.js`.
- **Webhook:** `webhook-handler.js` — recebe ~40 funções injetadas por `agent.js`.
- **Validação em cadeia:** `action-response-validator.js` → `message-validator.js` →
  `public-message-guard.js` → `message-limits.js` → `reply-delay.js`.
  ⚠️ Desde 2026-06-17 **só 3 erros técnicos bloqueiam** (`json_invalido`, `acao_invalida`,
  `sem_mensagem_publica`); todo guardrail de conteúdo virou **aviso** ("LLM no controle").
- **Integrações:** `ai-provider.js` (Anthropic/OpenAI), `whatsapp.js` (Evolution),
  `media-processing.js` (áudio via API da OpenAI), `agenda.js`, `segredos-crypto.js`.
- **Legado single-tenant:** `prospecting.js` (4.913), `agenda.js` (2.010), `whatsapp-routes.js`,
  `ai-routes.js`, `ai-test-routes.js`, `meta-routes.js`, `leads-quentes.js`, `dashboardAuth.js`,
  registrados por `routes.js`.
- **Compartilhados:** `telefone-br.js`, `string-utils.js`, `date-utils.js`, `logger.js`,
  `domain-enums.js`, `domainSchemas.js`, `config.js`.

## `backend/prompts/` (13) — conhecimento do agente
`system-core.md` + `system-*.md` (primeiro-contato, diagnóstico, proposta, objeção, fechamento),
`empresa.md` (conhecimento autorizado), `agent-base.md`, `classificador-intencao.md`,
`followup*.md`, `lead-coach.md`, `tom-referencia.md`.
> **Não existe `prompts/system.md`** — foi dividido nos `system-*.md`.
> Alteração aqui afeta produção diretamente: justifique o impacto.

## `backend/sql/` — schema
Três mecanismos, todos aplicados no boot por `src/db.js`:
1. `init.sql` (50 KB) — schema `vendas`;
2. `prospeccao_orquestracao.sql` — prospecção diária;
3. `migrations/` (**91**, `001`–`090`) — schema `app`, versionadas em `app.schema_migrations`
   por `src/db/migrations.js`, **cada uma numa transação com client dedicado**.

`migracao_analise_estruturada.sql` é histórico: nenhum código o carrega.

## `backend/public/` (15 páginas) — dashboard estático **legado**
HTML + `public/dashboard/{css,js,assets}` compartilhados. Servido por `express.static`.
**Não é referência para tela nova** e está cercado: não ganha página.

## `backend/test/` (169 arquivos, ~2.955 testes)
`npm test` roda `test/*.test.js` **por glob** — não existe mais lista manual (era ela que
mantinha 24 arquivos fora da suíte). Além dos testes de regra, há três guardas estruturais:

| Arquivo | O que protege |
|---|---|
| `rotas-contrato.test.js` + `fixtures/rotas-publicas.json` | as **418 rotas montadas** (método + caminho completo) |
| `legado-cercado.test.js` | a geração legada só encolhe |
| `migrations-integridade.test.js` | numeração, ordem e transacionalidade das migrations |
| `autorizacao-rotas.test.js` | toda rota com `requireCapacidade` exercitada contra os 4 papéis |

⚠️ **Nunca rode `node --test` sem argumento**: o padrão de descoberta do Node captura
`scripts/test-evolution-send.js`, que **envia mensagem real de WhatsApp**.

## `backend/scripts/` (24)
12 com entrada no `package.json` (backfills, medições, reclassificações — os de medição rodam
em `BEGIN TRANSACTION READ ONLY`). Os outros 12 são operacionais manuais; 3 são candidatos a
histórico (ver `LEGACY_REVIEW.md`).

## `backend/whisper-service/` — Python (FastAPI + faster-whisper)
⚠️ **Órfão**: nenhum código de `src/` o chama. A transcrição real usa a API hospedada da OpenAI
(`media-processing.js`). Ver `LEGACY_REVIEW.md` §2.1.

---

## `frontend/` — Next.js 14 (App Router, TypeScript, Tailwind)

- **`app/`** — 29 rotas. `login`/`signup` (tema neon) e `dashboard/*` (tema claro).
- **`components/`** (47) — `ui/` é o design system (`Botao`, `Campo`, `ModalConfirmar`,
  `BolinhaPontuacao`, `DataTableFrame`, `FolhaModal`); o resto são componentes de feature.
- **`lib/`** (43 módulos + 42 testes) — **módulos PUROS** que só **traduzem o veredito** que a
  API já resolveu. Cada um tem par `.d.ts` e `.test.js`. É o padrão mais forte do frontend:
  regra de negócio aqui quebra em silêncio.
- **`lib/api.ts`** — cliente HTTP único (`apiFetch`): token, timeout, erro tipado, origem de
  sessão. Exceção documentada: `app/dashboard/playbook/page.tsx` usa `fetch` cru porque precisa
  do header `Retry-After`.
- Sem Redux/Zustand: só 2 Contexts de UI (`FeedbackProvider`, `MotionProvider`) e
  `localStorage` para preferências de tela.
- **Validação:** `npx tsc --noEmit` + `npm test` (`node --test lib/*.test.js`) + `npm run build`.
  **Não há ESLint configurado** — `npm run lint` abre prompt interativo e trava.

---

## `docs/` — documentação

- **`AGENTS.md` (raiz) é a fonte viva.** 3.352 linhas com as decisões, os defeitos corrigidos e
  o porquê de cada regra. Quando este mapa e o `AGENTS.md` divergirem, o `AGENTS.md` vence.
- `architecture-rules.md` — a lei técnica (leia junto deste arquivo).
- `ai-workflow.md`, `ai-decision-log.md`, `ai-task-start-log.md`, `change-impact-template.md` —
  processo de trabalho com agentes de IA.
- `GUIA-VISUAL-PJ-CODEWORKS.md` + `ui-visual-standard.md` — padrão visual (obrigatório em
  qualquer tarefa de tela).
- `historico/` — documentos de iniciativas encerradas. Não descrevem o sistema atual.
