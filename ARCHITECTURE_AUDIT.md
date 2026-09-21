# ARCHITECTURE_AUDIT.md

Auditoria arquitetural read-only do repositório `atendimento-views`.

- **Data:** 2026-09-21
- **Branch auditada:** `codex/aprovar-distribuir` (HEAD `ee17f93`, 5 commits à frente de `master` + 8 arquivos modificados não commitados)
- **Escopo:** todo o repositório versionado (907 arquivos: `backend/` 602, `frontend/` 215, `docs/` 77)
- **Método:** leitura de arquivos, grep/contagem, execução de `tsc --noEmit` e `npm test`, cruzamento de dependências declaradas × usadas, cruzamento de env vars documentadas × lidas, e uma **segunda passada** específica para dependências indiretas.
- **Nenhum arquivo do projeto foi criado, alterado, movido ou removido.** Este documento é o único arquivo novo.

> ⚠️ **Aviso de método, que vale para o documento inteiro:** ausência de import **nunca** foi usada isoladamente como prova de código morto. Durante esta auditoria dois falsos positivos apareceram e foram derrubados na segunda passada: (1) `knowledge/prints/*.png` pareciam ausentes num `find -maxdepth 1` e existem; (2) três arquivos de `src/db/` pareciam órfãos e são consumidos por `require` relativo dentro da própria pasta. A mesma disciplina foi aplicada a cada item das seções 7 e 9.

---

## 1. Visão geral da arquitetura atual

O sistema **não é** "um frontend + um backend". Ele é **duas gerações completas de produto rodando ao mesmo tempo, no mesmo processo Node**, com a segunda ainda não tendo absorvido a primeira.

| | **Geração 1 — legada (single-tenant "PJ Codeworks")** | **Geração 2 — atual (SaaS multiempresa)** |
|---|---|---|
| UI | `backend/public/` — HTML/CSS/JS estático (20.389 LOC, 13 páginas) | `frontend/` — Next.js 14 App Router (49.325 LOC, 25+ rotas) |
| API | `/dashboard/*` e `/api/operador/*` | `/api/empresas/:empresaId/*` |
| Onde as rotas vivem | arquivos soltos na raiz de `src/` (`agent.js`, `prospecting.js`, `agenda.js`, `ai-routes.js`, `whatsapp-routes.js`, `meta-routes.js`, `leads-quentes.js`, `ai-test-routes.js`), registrados por `src/routes.js` | `src/routes/api-*.js` (38 arquivos) |
| Autenticação | `src/dashboardAuth.js` (308 linhas) — cookie httpOnly + CSRF + `REPROCESS_SECRET` | `src/auth.js` (JWT/scrypt) + `src/middleware/tenant.js` (275 linhas) — `requireAuth` → `requireEmpresaAccess` → `requireCapacidade` |
| Escopo de dados | schema `vendas` (e um `empresa_id` que historicamente caía na PJ por *default*) | schema `app` + `empresa_id` provado por instância |
| Estado | **vivo e em uso** (o operador ainda usa telas do dashboard legado) | **é o produto** |

Ambas compartilham o mesmo processo, o mesmo pool de Postgres e boa parte dos mesmos serviços. É isso que explica quase todos os sintomas que você suspeitava: "lógica que era do frontend virou backend", "responsabilidades misturadas", "arquitetura não representa mais o sistema".

**Outros fatos estruturais:**

- **Deploy:** Railway (Root Directory `backend/`) + Vercel (Root Directory `frontend`). **Não existe nenhum CI/CD** — `.github/` não existe. Nada roda teste, lint ou build automaticamente antes de um deploy.
- **Banco:** PostgreSQL, com **três mecanismos de schema convivendo**: `sql/init.sql` (50 KB, schema `vendas`, carregado no boot), `sql/prospeccao_orquestracao.sql` (carregado no boot) e `sql/migrations/*.sql` (**91 migrations**, aplicadas no boot e registradas em `app.schema_migrations`).
- **Superfície HTTP:** **417 endpoints** declarados. Destes, ~82 estão **fora** de `src/routes/` (37 dentro de `src/agent.js`, 29 em `src/prospecting.js`, 16 em `src/agenda.js`).
- **Agentes de IA:** **não há tool-calling / function-calling em lugar nenhum** (zero ocorrências de `tools:`, `tool_choice`, `tool_use`). O que o projeto chama de "agente" é um *pipeline determinístico* em volta de **uma** chamada LLM que devolve JSON estruturado. Todas as "ferramentas" são código determinístico executado antes/depois da chamada.
- **Governança:** `AGENTS.md` (3.352 linhas, atualizado hoje) é a **única** fonte de verdade viva. `README.md`, `docs/project-map.md` e `docs/architecture-rules.md` estão desatualizados e são citados como leitura obrigatória pelo `CLAUDE.md` (detalhes na seção 10).

---

## 2. Diagrama textual do funcionamento

### 2.1 Fluxo do produto atual (SaaS multiempresa)

```
Operador (navegador)
   │
   ▼
frontend/ (Next.js 14, Vercel)  ──── NÃO há BFF, NÃO há rewrite/proxy.
   │                                 lib/api.ts monta: NEXT_PUBLIC_API_URL || http://localhost:3000
   │                                 JWT lido de localStorage → header Authorization: Bearer
   ▼  (fetch direto navegador → Railway, CORS liberado por FRONTEND_URL)
backend/index.js
   │  cors → express.raw(/freelandoo/webhook) → express.json(20mb) → /health → express.static(public/)
   │  → dashboardAuth (só /dashboard e /api/operador) → 35 routers → src/routes.js (legado)
   ▼
src/routes/api-*.js   (camada HTTP fina)
   │  requireAuth → requireEmpresaAccess → requireCapacidade(CAP.X)
   ▼
src/services/*.js  (97 arquivos — regra de negócio PURA, sem I/O na maioria)
   │
   ▼
src/db/*.js  (47 arquivos — SQL por domínio)
   │
   ▼
PostgreSQL (schemas `app` + `vendas` + `prospectador`)
```

### 2.2 Fluxo do atendimento por IA (o "agente")

```
Lead (WhatsApp)
   │
   ▼
Evolution API  ──POST──►  /webhook   (backend/index.js:185)
   │
   ▼
src/middleware/tenant.js :: resolveEmpresaFromWebhook
   │   resolve empresa PELA INSTÂNCIA. Sem prova de dono → req.tenantPendencia
   ▼
src/webhook-handler.js :: registerWebhookRoute(app, deps)   ← recebe ~40 funções injetadas por agent.js
   │   1. barrarSemDonoComprovado()  → quarentena, PARA o fluxo (nada é gravado)
   │   2. capturarAtribuicaoAnuncio() → CTWA
   │   3. debounce + idempotência + buffer de mensagens
   │   4. enfileira job `webhook_resposta`
   ▼
Job worker (setInterval, iniciado em index.js:265)
   │
   ▼
src/agent.js (7.475 linhas)  +  src/core-funnel.js (2.322)  +  src/services/contexto2-responder.js
   │   monta prompt determinístico:
   │     prompts/system-core.md + system-<etapa>.md + empresa.md + Contexto 2 da instância
   │     + perfil do lead (vendas.lead_profiles) + histórico (vendas.conversas.historico)
   ▼
src/ai-provider.js  →  Anthropic OU OpenAI   (JSON estruturado; SEM tool-calling)
   │   AI_PROVIDER / AI_MODEL / AI_AUX_MODEL / AI_AUX_CAPABLE_MODEL
   ▼
Validação determinística em cadeia:
   action-response-validator.js → message-validator.js → public-message-guard.js
   → message-limits.js → question-limiter.js → reply-delay.js
   ▼
GATE de capacidade: services/conversa-modo-ia.js (modo `conversa` × `analise`)
   │   modo `analise` ⇒ a resposta é GERADA e DESCARTADA (não vira balão `assistant`)
   ▼
src/whatsapp.js :: resolverInstanciaEnvio()   ← instância PROVADA, sem fallback
   ▼
Evolution API  ──►  Lead
   │
   └─► efeitos colaterais: vendas.conversas, vendas.lead_profiles, app.agenda_eventos,
       followup_auto_agendamentos, app.conversao_eventos (Meta), app.auditoria_eventos
```

### 2.3 Workers/jobs em processo (todos `setInterval`, no mesmo container)

| Worker | Origem |
|---|---|
| Job worker do agente | `agent.iniciarJobWorker()` — `index.js:265` |
| Silence watcher | `agent.iniciarSilenceWatcher()` — `index.js:266` |
| Captação social (Bright Data) | `services/social-capture.js` — `index.js:268` |
| Lock de lead (15 dias) | `services/lead-lock.js` — `index.js:273` |
| Banco de Leads automático | `services/banco-leads-auto.js` — `index.js:278` |
| Refresh diário de playbooks Freelandoo | `routes/freelandoo-provision.js:181` — **disparado no `require`, antes do banco estar pronto** |
| Migrations / enriquecimento / rotinas de aquisição | `src/db.js`, `services/enriquecimento-worker.js`, tick em `agent.js` |

---

## 3. Tecnologias encontradas

Versões **resolvidas** (lidas dos lockfiles, não dos ranges `^`).

### Backend — `backend/package.json`

| Tecnologia | Versão | Onde é usada | Para que serve | Necessária? | Confiança |
|---|---|---|---|---|---|
| Node.js | engine `>=20`; Docker `node:20-alpine`; local `v22.19.0` | runtime | — | **ATIVA** | Alta |
| express | 5.2.1 | `index.js` + 40 arquivos | servidor HTTP, 417 endpoints | **ATIVA** | Alta |
| pg | 8.20.0 | `src/db.js` + 11 arquivos | PostgreSQL | **ATIVA** | Alta |
| axios | 1.15.0 | 16 arquivos (Evolution, IA, Bright Data, Freelandoo) | cliente HTTP | **ATIVA** | Alta |
| pino | 10.3.1 | `src/logger.js` (único) | logging estruturado com redação de segredos | **ATIVA** | Alta |
| jsonwebtoken | 9.0.3 | `src/auth.js` (único) | JWT do SaaS | **ATIVA** | Alta |
| cors | 2.8.6 | `index.js` (único) | liberar o frontend Vercel | **ATIVA** | Alta |
| cheerio | 1.2.0 | `services/knowledge-ingestion.js` (único) | parse de HTML na ingestão de conhecimento | **ATIVA** | Alta |
| pdf-parse | 2.4.5 | `services/knowledge-ingestion.js` (único) | extrair texto de PDF enviado como fonte | **ATIVA** | Alta |
| multer | 2.2.0 | `routes/api-contextos-fontes.js` (único) | upload de fonte de conhecimento | **ATIVA** | Alta |
| form-data | 4.0.5 | `src/media-processing.js` | multipart p/ transcrição de áudio (OpenAI) | **ATIVA** | Alta |
| **docx** | 9.6.1 | **só `src/project-handoff-docx.js`**, que só é chamado por `test/core.test.js` | gerar .docx de briefing de projeto | **DÚVIDA / PROVAVELMENTE LEGADA** | Média-Alta |
| **playwright** | **não declarada, não instalada** | `src/preview-site.js:724` (`require` lazy com fallback) | renderizar preview de site em PNG | **SEM USO IDENTIFICADO (caminho morto)** | Alta |
| typescript (dev) | 6.0.3 | `npm run typecheck` | typecheck de 1 arquivo `.ts` + JSDoc | **ATIVA** | Alta |
| @types/node (dev) | ^25.6.2 | typecheck | — | **ATIVA** | Alta |

### Frontend — `frontend/package.json`

| Tecnologia | Versão | Onde é usada | Para que serve | Necessária? | Confiança |
|---|---|---|---|---|---|
| next | 14.2.35 | app inteiro | App Router, build, deploy Vercel | **ATIVA** | Alta |
| react / react-dom | 18.3.1 | app inteiro | UI | **ATIVA** | Alta |
| tailwindcss | 3.4.19 | `tailwind.config.ts` | design system (tokens `surface`/`ink`/`estado` + tema neon) | **ATIVA** | Alta |
| postcss / autoprefixer | 8.5.15 / 10.5.0 | `postcss.config.js` | pipeline CSS do Tailwind | **ATIVA** | Alta |
| typescript (dev) | 5.9.3 | `tsc --noEmit` (passa limpo) | tipos | **ATIVA** | Alta |
| **gsap** | 3.15.0 | `components/motion/MotionProvider.tsx` (montado em `app/layout.tsx`) e `components/ui/NeonProgress.tsx` (login, signup, captacao, `FeedbackProvider`) | barra de progresso/transição de rota | **ATIVA** (mais espalhada do que a doc afirma) | Alta |
| **three** | 0.160.1 | só `components/charts/Bars3DScene.tsx` | gráfico de barras 3D | **SEM USO IDENTIFICADO** | Alta |
| **@react-three/fiber** | 8.18.0 | idem | idem | **SEM USO IDENTIFICADO** | Alta |
| **@react-three/drei** | 9.122.0 | idem | idem | **SEM USO IDENTIFICADO** | Alta |

### Infra e ferramentas

| Item | Estado | Observação |
|---|---|---|
| `backend/Dockerfile` | **ATIVO** (Railway) | `npm install` (não `npm ci`), `RUN npm install pg` redundante (pg já está em deps), sem `--omit=dev` (TypeScript vai para a imagem de produção), sem `NODE_ENV=production` |
| `backend/whisper-service/` | **ÓRFÃO** — FastAPI + `faster-whisper`, Dockerfile próprio | Nenhum código em `src/` o chama. A transcrição real usa a API hospedada da OpenAI (`whisper-1`) em `src/media-processing.js:44` |
| `docker-compose.yml` (raiz) | **PARCIALMENTE LEGADO** | Sobe Postgres + Redis + Evolution + backend. **Não inclui o frontend**, define `EVOLUTION_INSTANCE: "PJ"` (variável aposentada) e `GOOGLE_PLACES_API_KEY` (não lida por código nenhum) |
| `docker-compose.override.yml` | **ATIVO** (dev local) | Publica Postgres em 5433; gitignorado |
| `package-lock.json` (raiz) | **SEM USO** | 6 linhas, `"packages": {}` — lockfile vazio de um workspace que não existe |
| CI/CD | **INEXISTENTE** | Sem `.github/`, sem pipeline. Deploy manual |
| `vercel.json` | **ATIVO** | config mínima |
| `.cursor/rules/*.mdc` + `.claude/` | **ATIVOS** | regras de agentes de IA de desenvolvimento |
| `docs/agente/claude-agent.yaml` | **LEGADO** | "Gerado a partir de `prompts/system.md`" — arquivo que **não existe mais**; nenhum código o lê; modelo congelado em `claude-sonnet-4-6` |

---

## 4. Dependências

### 4.1 Conclusão geral

**Não há gordura significativa de dependências.** O backend tem 11 pacotes de produção e **todos** aparecem no código. O frontend tem 7 e **3 estão mortos** (o trio 3D). O verdadeiro problema não é dependência instalada demais — é **configuração** (env) e **código** legado.

### 4.2 Itens que merecem decisão

| Item | Classificação | Evidência | Risco de remover |
|---|---|---|---|
| `three` + `@react-three/fiber` + `@react-three/drei` | **SEM USO IDENTIFICADO** | `Bars3DScene.tsx` é importado só por `Chart3D.tsx`, e `Chart3D` não é importado por nenhum arquivo de `app/` ou `components/`. Segunda passada: zero menções em `docs/`, `AGENTS.md` ou qualquer `.tsx`/`.ts` fora do próprio par | **Baixo** |
| `docx` | **PROVAVELMENTE LEGADA** | Único consumidor é `src/project-handoff-docx.js`; único consumidor *dele* é `test/core.test.js:4763`. Não existe rota com "handoff" no path; `agent.js` importa `handoff-alerts.js` (outro módulo) | **Médio** (pode ser feature pausada — ver 7.4) |
| `playwright` | **SEM USO IDENTIFICADO / DEPENDÊNCIA FANTASMA** | `require('playwright')` em `preview-site.js:724` dentro de `carregarPlaywrightOpcional()` com `try/catch`. Não está no `package.json` nem em `node_modules`. Consequência: **o renderizador PNG nunca executa**; todo preview cai no `svg-fallback` | **Baixo** para remover o caminho; **decisão de produto** se o PNG era desejado |
| `gsap` | **ATIVA** | Usada globalmente via `MotionProvider` em `app/layout.tsx` | — |
| `pg` instalado duas vezes no Dockerfile | **redundância** | `Dockerfile:5` (`RUN npm install pg`) | Baixo |

### 4.3 Dependência **indireta** que a segunda passada encontrou

O `.env.example` declara `FREELANDOO_ENC_KEY` e um grep por `process.env.FREELANDOO_ENC_KEY` **não encontra nada** — parece morta. **Não é.** Ela é lida indiretamente por `src/freelandoo/crypto.js:22` (`envs: ['FREELANDOO_ENC_KEY']`), consumida pela fábrica `src/segredos-crypto.js`. Qualquer varredura futura de "env não usada" precisa considerar esse padrão.

---

## 5. Estrutura do frontend

`frontend/` — 49.325 LOC · 32 arquivos em `app/` · 47 em `components/` · 129 em `lib/` (43 módulos + 42 testes + `.d.ts`).

**Saúde geral: boa.** `tsc --noEmit` passa limpo; `npm test` roda **704 testes, 100% passando**; não há Redux/Zustand/Recoil/Jotai; só 2 Contexts, ambos de infraestrutura de UI (`FeedbackProvider` de toasts, `MotionProvider` de animação). O padrão "a tela só traduz o veredito da API" está genuinamente sendo cumprido: a lógica de apresentação vive em `lib/*.js` puros e testados.

### 5.1 Rotas (App Router)

| Grupo | Rotas |
|---|---|
| Entrada | `/` (redirect p/ login), `/login`, `/signup` |
| Home | `/dashboard` (rótulo dinâmico: "Visão Geral" ou "Minha Operação" conforme capacidade) |
| Operação | `/conversas`, `/central-ligacoes`, `/banco-leads`, `/follow-ups`, `/agenda`, `/roteiros`, `/comissao`, `/equipe` |
| Aquisição | `/aquisicao` (abas), `/prospeccao`, `/captacao` |
| Config | `/contextos` (+ aliases `/instancias`, `/empresa`), `/instancias/[id]/contexto`, `/playbook`, `/llm`, `/prompts`, `/uso`, `/integracoes`, `/integracoes/meta`, `/contas-empresa`, `/contas`, `/perfil`, `/relatorios` |
| Fora do menu, **de propósito** | `/dashboard/aceite` — alcançada só por `router.replace` em `AuthGuard.tsx:44` |

**Nenhuma rota órfã.** `/prospeccao` e `/captacao` existem como rota própria **e** são reaproveitadas como abas dentro de `/aquisicao` por import literal do `page.tsx` — é reuso intencional e documentado, não duplicação.

### 5.2 Componentes e `lib/`

- **Nenhum componente 100% morto**, exceto o par `charts/Chart3D.tsx` + `charts/Bars3DScene.tsx`.
- **Nenhum módulo de `lib/` órfão.** Alguns só aparecem via *facade* (`lib/equipe-area.js` reexporta `equipe-painel`, `equipes-comerciais`, `lead-parado`, `equipe-carteira`) — outro caso em que o grep ingênuo daria falso positivo.
- Componentes compartilhados centrais: `ui/Carregando` (28 usos), `FeedbackProvider` (27), `ui/icons` (20), `ui/Botao` (18), `ui/Campo` (14), `ui/BolinhaPontuacao` (10), `ui/ModalConfirmar` (8), `ui/DataTableFrame` (8). **Não há dois sistemas de modal nem duas tabelas concorrentes.**

### 5.3 O que **deveria estar no backend** (mas está no frontend)

| Item | Onde | Por quê |
|---|---|---|
| Filtros, ordenação e paginação do Banco de Leads | `app/dashboard/banco-leads/page.tsx:1031` — "fetch é único, ≤1000" | Com carteira maior que 1.000, o operador **não alcança** o resto. Já é dívida declarada (D4) no `AGENTS.md` |
| Mesma classe de problema | `app/dashboard/captacao/page.tsx` | idem |

Fora isso, **não encontrei regra de negócio indevida no frontend** — o que é notável para um projeto deste tamanho.

### 5.4 O que **deve permanecer** no frontend

Tudo em `lib/*.js`: tradução de veredito, rótulos, estados de UI, paginação client-side de listas pequenas, preferências em `localStorage`. Esses módulos são puros, testados e têm guardas de regressão que impedem que virem regra de negócio.

---

## 6. Estrutura do backend

`backend/src/` — 82.082 LOC · 247 arquivos.

| Camada | Arquivos | Estado |
|---|---|---|
| `routes/` | 38 | Camada HTTP fina e consistente — **exceto** `api-banco-leads.js` (1.847 linhas) e `api-whatsapp.js` (1.381) |
| `services/` | 97 | Regra de negócio, majoritariamente **pura e testada**. Maior: `contexto2-runtime.js` (1.042) |
| `db/` | 47 | 1:1 por domínio (`comissao.js`, `missao.js`, `ligacoes.js`, `lead-icp.js`…). Nenhum órfão |
| `middleware/` | 1 | `tenant.js` (275) — `requireAuth`/`requireEmpresaAccess`/`requireCapacidade` |
| `freelandoo/` | 4 | canal alternativo (token, não QR) |
| **raiz de `src/`** | **65** | **É aqui que mora o problema** — mistura núcleo do agente, rotas legadas, integrações e helpers |

### 6.1 God files confirmados

| Arquivo | Linhas | O que concentra |
|---|---|---|
| `src/agent.js` | **7.475** | Núcleo do funil + parsing de LLM + precificação + **37 endpoints HTTP** + composition root (injeta ~40 funções no `webhook-handler`) + 2 workers + ~65 reexports consumidos pelos testes |
| `src/prospecting.js` | **4.913** | Motor de prospecção legado: rotas (29 endpoints), workers, SQL e regra |
| `src/core-funnel.js` | 2.322 | Funil determinístico |
| `src/agenda.js` | **2.010** | Agenda legada + 16 endpoints |
| `src/routes/api-banco-leads.js` | 1.847 | Router que virou módulo de domínio |
| `src/routes/api-whatsapp.js` | 1.381 | idem |
| `src/preview-site.js` | 1.034 | Geração de preview (inclui o caminho morto do Playwright) |
| `services/contexto2-runtime.js` | 1.042 | Resolução de contexto + geração + runtime, juntos |

Os 4 primeiros somam ~16.700 linhas — quase metade das 35.868 linhas da raiz de `src/`.

### 6.2 Responsabilidades espalhadas que deveriam ser agrupadas

1. **Rotas fora de `routes/`:** 82 endpoints em `agent.js`, `prospecting.js` e `agenda.js` violam a própria Regra 1 do `docs/architecture-rules.md`.
2. **Workers dentro de módulos de negócio:** `social-capture.js` e `banco-leads-auto.js` são, cada um, serviço **e** scheduler. Não há uma camada `workers/`.
3. **Dois sistemas de autenticação** (seção 8.2).
4. **Um `setInterval` fora do ciclo de boot:** `freelandoo-provision.js:181` dispara no `require`, **antes** de `initDB` — possível corrida na inicialização (não reproduzida nesta auditoria; ver seção 16).

---

## 7. Arquivos provavelmente legados

> Nada abaixo deve ser removido sem a sua decisão. Cada item traz evidência, o que a **segunda passada** encontrou, e o risco.

### 7.1 `backend/tools/build-split.cjs` — **CERTEZA ALTA**

- **Evidência:** gera `src/*.js` a partir de `index.monolith.js` usando **ranges de linha hardcoded** (`slice(106,116)`, `slice(229,334)`…). O `index.monolith.js` **não existe** e não está no git. `index.js` hoje tem 368 linhas — os ranges apontam para um arquivo que não existe mais.
- **Segunda passada:** citado apenas em `docs/project-map.md:14,96` e em `docs/ai-decision-log.md:1979`, onde **já está declarado como dívida técnica**.
- **Risco de remoção:** **Baixo** — mas exige atualizar os dois docs no mesmo movimento.

### 7.2 `frontend/components/charts/Chart3D.tsx` + `Bars3DScene.tsx` (+ 3 deps) — **CERTEZA ALTA**

- **Evidência:** os dois arquivos só referenciam um ao outro. Zero imports em `app/` e `components/`.
- **Segunda passada:** zero menções em `docs/`, `AGENTS.md`, `.md`, `.json` (exceto as linhas do `package.json`).
- **Risco:** **Baixo**.

### 7.3 `backend/whisper-service/` — **CERTEZA ALTA de que está desconectado; CERTEZA BAIXA de que deva sumir**

- **Evidência:** FastAPI + `faster-whisper` (modelo `medium`, CPU, int8) com `POST /transcribe`. Nenhum arquivo de `src/` faz HTTP para ele; não há `WHISPER_URL`; não aparece no `docker-compose.yml`. A transcrição real é a API hospedada da OpenAI (`whisper-1`) em `media-processing.js:44`.
- **Segunda passada:** citado em `docs/project-map.md`, `docs/project-architecture.md`, `docs/IMPLEMENTATION_SLICES.md`, `AGENTS.md` e 3 docs `VLAEG_*` — ou seja, **é documentado como parte da arquitetura**. Pode ser uma alternativa de custo deliberadamente guardada.
- **Risco:** **Médio** — é uma decisão de produto (custo de transcrição OpenAI × rodar local), não de limpeza.

### 7.4 `src/project-handoff-build.js` + `project-handoff-docx.js` + `project-handoff-types.ts` — **CERTEZA MÉDIA**

- **Evidência:** único consumidor é `test/core.test.js:4762-4763`. Não existe rota com "handoff" no path. `agent.js` importa `handoff-alerts.js`, que é outra coisa. São ~570 + 246 linhas + a dependência `docx`.
- **Segunda passada:** documentado em `docs/IMPLEMENTATION_SLICES.md:35-37` e `docs/project-map.md:68` como parte da arquitetura — cheira a **feature construída e nunca plugada**, não a resto de código apagado.
- **Risco:** **Médio** — precisa da sua confirmação: o briefing .docx era para ter sido ligado?

### 7.5 Caminho Playwright em `src/preview-site.js:720-770` — **CERTEZA ALTA (de que nunca executa)**

- **Evidência:** `require('playwright')` opcional, pacote não declarado e não instalado ⇒ `carregarPlaywrightOpcional()` sempre devolve `null` ⇒ todo preview sai como `svg-fallback`.
- **Risco:** **Baixo** — mas a decisão é: declarar a dependência (e pagar ~300 MB de Chromium na imagem) **ou** remover o ramo.

### 7.6 `backend/sql/migracao_analise_estruturada.sql` — **CERTEZA ALTA de que é histórico**

- **Evidência:** `src/db.js` carrega `init.sql` e `prospeccao_orquestracao.sql`; **nunca** este. `docs/historico/*` mostra que era aplicado à mão via `psql`.
- **Risco:** **Baixo para reclassificar, Alto para apagar** — o schema que ele criou provavelmente está vivo em produção. Mover para `sql/historico/` é seguro; apagar não muda nada tecnicamente, mas perde o registro.

### 7.7 Documentação desatualizada — **CERTEZA ALTA**

| Arquivo | Evidência concreta |
|---|---|
| `README.md` (último toque 2026-06-17) | Descreve `prompts/system.md` (**não existe**; hoje são `system-core.md` + `system-*.md`), Google Places como fonte da prospecção (migrou para Bright Data), `dashboard.html` como a UI, e **não menciona** nem o frontend Next.js nem o modelo multiempresa |
| `docs/project-map.md` (2026-07-22) | Cita `index.monolith.js` (não existe), `railway.json` em `backend/` (**não existe**), descreve `db/` como tendo 2 arquivos (tem 47), e `public/` como "a UI" |
| `docs/architecture-rules.md` (2026-06-17) | Regra 1: "acesso a banco isolado em `src/db.js`/`db-crud.js`" (são 47 arquivos hoje); Regra 6 trata `public/` como a UI do produto; Regra 3 cita só `dashboardAuth.js` como autenticação |
| `docs/agente/claude-agent.yaml` | Gerado de um arquivo que não existe; nenhum código o lê |

**Isto é o achado de governança mais importante:** o `CLAUDE.md` manda **obrigatoriamente** consultar `docs/project-map.md` e `docs/architecture-rules.md` antes de mudanças estruturais — ou seja, a instrução oficial do projeto aponta para dois mapas desatualizados.

### 7.8 Scripts sem entrada no `package.json` — **CERTEZA BAIXA a MÉDIA**

12 dos 24 scripts não têm entrada em `npm scripts`. A maioria é operacional legítima (`run-migration.js`, `clonar-prod-para-local.sh`, `dump-prompts.js`/`push-overlay.js`, `test-evolution-send.js`, `agendar-reuniao.js`, `update-ai-model.js`). Candidatos históricos:

| Script | Situação |
|---|---|
| `cleanup-prospeccao-legado.js` | **zero** referências em docs — limpeza de backlog do sistema antigo, papel provavelmente cumprido |
| `seed-campanha-nail-designer.js` | seed de conteúdo de um nicho específico; citado só em `docs/ai-task-start-log.md` |
| `init-whatsapp.js` | setup manual de tabela; hoje a criação de instância passa por `api-whatsapp.js`; citado só em `docs/historico/` |

### 7.9 Configuração legada ainda presente — **CERTEZA ALTA**

- `GOOGLE_PLACES_API_KEY`: documentada no `.env.example` e setada no `docker-compose.yml`, mas **o código não a lê** — só aparece em `src/logger.js:15`, numa lista de chaves a redigir em log.
- `EVOLUTION_INSTANCE: "PJ"` no `docker-compose.yml`: a variável foi **aposentada** (confirmado: só aparece em comentários e em testes de guarda de regressão que **falham** se ela voltar ao código).
- `package-lock.json` da raiz: lockfile vazio (`"packages": {}`) de um workspace inexistente.
- `backend-test-last.log` (436 KB) e `backend/sonda-ig-perfil-*.json`: artefatos locais de execução, corretamente gitignorados, apenas esquecidos no disco.

---

## 8. Código duplicado

### 8.1 Duplicação confirmada, de baixo risco: normalização de telefone

`src/telefone-br.js` é o dono declarado (`somenteDigitos`, `candidatosTelefoneBR`, `sqlTelefoneNormalizado`). Mesmo assim há **5 reimplementações** de `replace(/\D/g,'')`:

| Arquivo | Função |
|---|---|
| `src/prospecting.js:197` | `normalizarTelefone` |
| `src/services/ctwa-atribuicao.js:156` | `normalizarTelefone` |
| `src/services/follow-up-modelo.js:110` | `normalizarTelefoneDigitos` |
| `src/services/lead-telefone.js:29` | `normalizarTelefoneLead` |
| `src/services/meta-conversao.js:111` | `normalizarTelefone` |

Implementação atual correta: **`src/telefone-br.js`**. (O próprio `AGENTS.md` já reconhece: "a normalização de telefone do repo segue espalhada".)

### 8.2 Duplicação estrutural, de alto impacto: **dois sistemas de autenticação**

| | Legado | Atual |
|---|---|---|
| Módulo | `src/dashboardAuth.js` (308 linhas) | `src/auth.js` (90) + `src/middleware/tenant.js` (275) |
| Mecanismo | cookie httpOnly + CSRF + `REPROCESS_SECRET` | JWT Bearer + papel do vínculo + capacidades |
| Consumidores | `agent.js`, `ai-routes.js`, `leads-quentes.js`, `meta-routes.js`, `prospecting.js`, `whatsapp-routes.js`, `index.js` | `routes/api-*.js` (38), `db/membros.js` |
| Escopo | single-tenant (PJ) | multiempresa |

Implementação atual: **JWT + capacidades**. O legado continua protegendo todo o `/dashboard/*`, que ainda é usado.

### 8.3 Duas UIs para o mesmo trabalho

`backend/public/` (13 páginas, 20.389 LOC) e `frontend/` cobrem áreas sobrepostas: conversas, agenda, prospecção, analytics, WhatsApp, configuração. O `AGENTS.md` já declara: *"o dashboard legado não é referência para tela nova"*. Implementação atual: **`frontend/`**.

### 8.4 Dois clientes Bright Data — **não é duplicação indevida**

- `services/brightdata-client.js:19` → **Datasets API** (`/datasets/v3`)
- `services/social-discovery.js:12,93` → **Request/SERP API** (`/request`)

São produtos diferentes. O que se duplica é apenas a leitura do token e o padrão de chamada HTTP (candidato a um wrapper comum de auth/retry, não a fusão).

### 8.5 Dois padrões de cliente HTTP no frontend

`lib/api.ts` (`apiFetch`, com timeout/AbortController, erro tipado e `cabecalhosOrigem`) é usado por **40 arquivos**. Duas páginas fazem `fetch()` cru remontando `BASE_URL` e `Authorization` à mão: `app/dashboard/llm/page.tsx:86,113` e `app/dashboard/playbook/page.tsx:61`. Implementação atual: **`apiFetch`**.

### 8.6 Não é duplicação (verificado e descartado)

- `public/prospecacao.html` **não** é um duplicado morto: é um stub de 12 linhas com `<meta http-equiv="refresh">` para `prospeccao.html`, corrigindo um link antigo com typo.
- `public/dashboard/` **não** é uma segunda geração: as 13 páginas HTML da raiz de `public/` carregam todas os mesmos assets de `public/dashboard/{css,js,assets}`. É **um** dashboard.
- `/dashboard/aquisicao` importando `../prospeccao/page` e `../captacao/page`: reuso literal e documentado.
- Os 7 workers com `setInterval` atendem domínios distintos; não encontrei dois fazendo a mesma coisa.

---

## 9. Dependências possivelmente desnecessárias

Consolidado (detalhe na seção 4):

| Item | Classificação | Certeza para remoção |
|---|---|---|
| `three`, `@react-three/fiber`, `@react-three/drei` | SEM USO IDENTIFICADO | **CERTEZA ALTA** |
| `docx` (junto com o subsistema `project-handoff-*`) | PROVAVELMENTE LEGADA | **CERTEZA MÉDIA** |
| `playwright` (caminho de código, não pacote) | SEM USO IDENTIFICADO | **CERTEZA ALTA** de que não executa |
| `RUN npm install pg` no Dockerfile | redundante | **CERTEZA ALTA** |
| `package-lock.json` da raiz | vazio | **CERTEZA ALTA** |
| `GOOGLE_PLACES_API_KEY`, `EVOLUTION_INSTANCE` em `.env.example`/`docker-compose.yml` | configuração legada | **CERTEZA ALTA** |
| `gsap` | **ATIVA** — não remover | — |
| Todo o resto do backend | **ATIVA** | — |

---

## 10. Problemas arquiteturais

Ordenados por impacto.

### P1 — Duas gerações vivas no mesmo processo
Dois sistemas de auth, duas UIs, duas superfícies de API, dois modelos de escopo de dados. Custo real: toda feature nova exige decidir "em qual mundo isso vive?", e toda correção de segurança precisa ser aplicada duas vezes.

### P2 — God files com responsabilidades misturadas
`agent.js` (7.475 linhas) é simultaneamente: núcleo de domínio, camada HTTP (37 endpoints), composition root do webhook (~40 funções injetadas), worker e superfície de teste (~65 reexports via `index.js`). Isso viola diretamente a Regra 1 do próprio `docs/architecture-rules.md`.

### P3 — `npm test` é uma lista manual, e 24 testes ficaram de fora
**165 arquivos de teste no disco, 141 no script `npm test`.** Os 24 que não rodam incluem testes que o `AGENTS.md` cita como **guardas de regressão**:

- `lead-nome-exibicao.test.js` — citado **3×** no `AGENTS.md` (uma delas: *"Guarda de regressão… falha se a tela passar a ler `nome_whatsapp`/`nome_maps`"*)
- `followup-manual-iniciar.test.js` — citado como *"Três garantias, todas travadas em `test/followup-manual-iniciar.test.js`"*
- `require-role.test.js`, `auth-signup.test.js` — **autorização e cadastro**
- `conversation-pipeline`, `intent-detector`, `goal-selector`, `message-buffer`, `message-limits`, `message-validator`, `question-limiter`, `reply-delay`, `follow-up`, `turn-context-reader`, `lead-profile`, `whatsapp-evolution`, e outros

**Uma guarda que não roda não guarda nada.** Este é o problema mais barato de corrigir e um dos mais perigosos de ignorar.

### P4 — Nenhum CI/CD
Sem `.github/`, nada impede um deploy com teste quebrado. Combinado com P3, o "teste passou" é um ato de disciplina individual, não uma propriedade do repositório.

### P5 — Configuração espalhada e fora de sincronia
**153 `process.env` distintos no código × 39 chaves no `.env.example`** — 114 variáveis sem documentação no arquivo que o próprio `AGENTS.md` chama de "fonte de verdade". Muitas estão documentadas em prosa no `AGENTS.md` (3.352 linhas), o que não é o mesmo que estarem no `.env.example`.

### P6 — Documentação de governança desatualizada apontada como obrigatória
Detalhado em 7.7. O `CLAUDE.md` manda ler dois mapas que descrevem um sistema que não existe mais.

### P7 — Migrations aplicadas no boot, sem CI e sem *dry-run*
91 migrations rodam automaticamente quando o container sobe. Não há passo de verificação prévia. Há pelo menos 3 backfills que "simulam por padrão" — bom padrão —, mas a aplicação do schema em si é automática no deploy.

### P8 — `express.static(public/)` antes de qualquer gate
`index.js:69` serve `backend/public/` inteiro sem autenticação HTTP; `requireDashboardAuth` só cobre `/dashboard/*` e `/api/operador/*`. **Severidade baixa** (os HTMLs são cascas; os dados vêm de APIs protegidas), mas é defesa em profundidade ausente.

### P9 — JWT em `localStorage`
`lib/api.ts:7`. Escolha comum e consciente, mas expõe o token a XSS — e o frontend renderiza conteúdo vindo de leads. Vale ser uma decisão registrada, não um default herdado.

### P10 — Paginação e filtros client-side sobre teto de 1.000 registros
`banco-leads` e `captacao` (seção 5.3). Já é dívida declarada (D4).

### P11 — Dockerfile não reprodutível
`npm install` em vez de `npm ci`, sem `--omit=dev`, sem `NODE_ENV=production`.

### P12 — Um `setInterval` iniciado no `require`
`freelandoo-provision.js:181` roda antes de `initDB`.

### P13 — Catálogo de modelos de IA defasado
`src/ai-provider.js` oferece e precifica `claude-opus-4-5…4-8`, `claude-sonnet-4-5/4-6`, `gpt-4-turbo` e `gpt-3.5-turbo`. **A geração Claude 5 (Opus 5, Sonnet 5, Haiku 4.5) não está no catálogo**, e a tabela de preços é hardcoded e envelhece sozinha.

### P14 — Higiene de workspace
23 worktrees em `.claude/worktrees/` (cada uma com uma cópia do backend) e **40 branches**, ~20 delas `worktree-*`. Isso polui grep, busca da IDE e futuras auditorias.

---

## 11. Pontos críticos

Os lugares onde um erro custa dinheiro, cliente ou dado — e que, por isso, governam a ordem da refatoração.

| # | Ponto crítico | Por quê | Onde |
|---|---|---|---|
| C1 | **Webhook → resposta ao lead** | É o produto. Uma falha aqui é um cliente sem resposta | `webhook-handler.js`, `agent.js`, `core-funnel.js`, `contexto2-responder.js` |
| C2 | **Resolução de empresa por instância (entrada e saída)** | Errar aqui grava dado de um negócio dentro de outro tenant, ou manda mensagem pelo número errado | `middleware/tenant.js`, `services/instancia-envio.js`, `whatsapp.js` |
| C3 | **Autorização por capacidade** | Separa o que o comercial vê do que o dono decide | `services/acesso-capacidades.js`, `middleware/tenant.js`, `test/autorizacao-rotas.test.js` |
| C4 | **Coleta paga Bright Data** | Gasta crédito real de uma conta compartilhada entre tenants | `prospecting.js`, `services/brightdata-orcamento.js`, `enriquecimento-worker.js` |
| C5 | **Envio em lote (Banco de Leads / rodar-leads)** | Teto anti-ban; estourar custa o número | `services/rodar-leads.js`, `banco-leads-auto.js` |
| C6 | **Conversões Meta (CAPI)** | Evento aceito pela Meta **não se estorna** | `services/meta-dispatch.js`, `meta-capi.js`, `meta-conversao.js` |
| C7 | **Comissão e missão** | É dinheiro de pessoa; o percentual é congelado no crédito | `services/comissao.js`, `db/comissao.js`, `services/missao.js` |
| C8 | **Migrations no boot** | Um erro derruba o serviço inteiro na subida | `src/db.js`, `src/db/migrations.js`, `sql/migrations/*` |
| C9 | **Agenda × espelho da agenda do bot** | Duas agendas que não se enxergam, ligadas por compensação | `services/agenda-slots.js`, `agenda-multiempresa.js`, `agenda.js` |
| C10 | **Criptografia de segredos de terceiros** | Tokens Meta/Freelandoo cifrados em repouso | `segredos-crypto.js`, `meta-crypto.js`, `freelandoo/crypto.js` |

---

## 12. Testes necessários antes de refatorar

### 12.1 O que já existe

| Camada | Situação |
|---|---|
| Backend | 165 arquivos, 40.155 LOC. **141 rodam** em `npm test`. Cobertura conceitual forte: regras puras + dezenas de *guardas de regressão que leem o próprio fonte* (padrão maduro e incomum — preservar) |
| Frontend | 42 arquivos, **704 testes, 100% passando**. 42 de 43 módulos de `lib/` cobertos |
| Typecheck | `tsc --noEmit` passa limpo nos dois lados |
| Integração / E2E | **Inexistente** — não há teste que suba o Express, nem que toque um Postgres real |

### 12.2 Lacunas por criticidade

| Fluxo | Classificação | O que falta |
|---|---|---|
| Webhook → resposta (C1) | **CRÍTICO** | Teste de integração do caminho completo com Evolution e LLM *mockados*; hoje só há testes unitários das partes |
| Autorização por rota (C3) | **CRÍTICO** | `test/autorizacao-rotas.test.js` existe e é excelente — mas `require-role.test.js` e `auth-signup.test.js` **não rodam** em `npm test` |
| Migrations (C8) | **CRÍTICO** | Nenhum teste sobe as 91 migrations contra um Postgres limpo. Um smoke test em container resolveria |
| Instância de envio (C2) | **CRÍTICO** | Bem coberto por `instancia-envio.test.js` (unitário + guardas). Falta o caminho de ponta a ponta |
| Coleta paga / orçamento (C4) | **IMPORTANTE** | Coberto por `brightdata-orcamento.test.js`. Falta teste do gancho real em `pesquisarPlaces` |
| Envio em lote (C5) | **IMPORTANTE** | `rodar-leads.test.js` existe; falta cenário de concorrência (duas rodadas simultâneas) |
| Meta CAPI (C6) | **IMPORTANTE** | Bem coberto em regra pura; falta contrato do payload |
| Comissão/missão (C7) | **IMPORTANTE** | `comissao.test.js` e `missao.test.js` **passaram a rodar** recentemente — confirmar que continuam na lista |
| Frontend `lib/api.ts` e `useSession.ts` | **IMPORTANTE** | Únicos módulos de `lib/` sem teste (dependem de `fetch`/`localStorage`) |
| `lib/site-rotulos.js` | **SECUNDÁRIO** | Único módulo de `lib/` sem `.test.js` par |
| Dashboard legado (`public/`) | **SECUNDÁRIO** | Zero testes — aceitável **se** a decisão for aposentá-lo |

### 12.3 Pré-requisito inegociável antes de qualquer refatoração

**Trocar a lista manual do `npm test` por descoberta automática** (`node --test test/`) e fazer os 24 órfãos passarem. Refatorar com 14,5% da suíte silenciosamente desligada é refatorar no escuro — especialmente porque entre os órfãos estão guardas que o `AGENTS.md` afirma que protegem invariantes.

---

## 13. Arquitetura de destino recomendada

**Princípio: não trocar a arquitetura. Terminar a que já está em curso.**

O projeto já escolheu um desenho e ele é bom: rota fina → serviço puro → camada de dados por domínio, com regra de negócio testável sem banco e guardas de regressão que leem o fonte. **Isso não precisa de Clean Architecture, DDD tático, CQRS nem monorepo com packages.** Introduzir qualquer um deles aqui seria overengineering: o custo de migrar 247 arquivos para uma abstração nova é altíssimo e o ganho, nenhum.

O que falta é **terminar o *strangler*** que já começou:

1. **Uma geração só.** O dashboard legado (`public/`) e as rotas `/dashboard/*` viram um módulo em quarentena explícita, com data de aposentadoria, e depois saem.
2. **Uma autenticação só.** JWT + capacidades. `dashboardAuth.js` morre junto com as rotas que ele protege.
3. **Rotas moram em `routes/`.** Os 82 endpoints que hoje vivem em `agent.js`, `prospecting.js` e `agenda.js` migram para `routes/`, **sem mudar contrato** — só mudando de arquivo.
4. **Workers têm casa própria.** `src/workers/` com registro único no boot, em vez de `setInterval` espalhado (e nenhum disparado no `require`).
5. **God files viram domínio.** `agent.js` não precisa virar 40 arquivos; precisa parar de ser rota + worker + composition root.
6. **Fronteira frontend/backend explícita:** frontend = interface, estado de UI e tradução de veredito. Backend = regra, banco, integração, IA e automação. **Isso já é quase verdade** — só falta mover filtro/ordenação/paginação do Banco de Leads e da Captação para o servidor.

---

## 14. Estrutura de pastas recomendada

Adaptada ao que já existe — a maior parte das pastas **já está certa**; o que muda é o destino dos arquivos soltos na raiz de `src/`.

```
backend/
  index.js                     ← só boot: env, middlewares, mounts, workers
  src/
    routes/                    ← TODA rota HTTP (hoje: 38 arquivos; destino: ~46)
      api-*.js                 ← multiempresa (mantém)
      + agent-*.js             ← os 37 endpoints hoje dentro de agent.js
      + prospeccao-legado.js   ← os 29 endpoints hoje dentro de prospecting.js
      + agenda-legado.js       ← os 16 endpoints hoje dentro de agenda.js
    middleware/                ← tenant.js, rate-limit.js (mantém)
    services/                  ← regra de negócio PURA (mantém; 97 arquivos)
    db/                        ← SQL por domínio (mantém; 47 arquivos)
    integrations/              ← NOVO: o que fala com terceiros
      whatsapp/                ← whatsapp.js (Evolution)
      ia/                      ← ai-provider.js, ai-response.js
      brightdata/              ← brightdata-client.js + social-discovery.js (auth/retry comum)
      meta/                    ← meta-capi.js
      freelandoo/              ← (já existe, move pra cá)
    workers/                   ← NOVO: todo setInterval, registrado num só lugar
      job-worker.js, silence-watcher.js, lead-lock.js,
      banco-leads-auto.js, social-capture.js, enriquecimento.js
    agent/                     ← NOVO: o núcleo do agente, sem rota e sem worker
      core-funnel.js, next-action-orchestrator.js, goal-selector.js,
      conversation-pipeline.js, intent-detector.js, question-limiter.js, ...
    shared/                    ← NOVO: helpers genuinamente genéricos
      telefone-br.js, string-utils.js, date-utils.js, logger.js,
      domain-enums.js, domainSchemas.js, segredos-crypto.js
    legacy/                    ← NOVO: quarentena declarada, com data de saída
      dashboardAuth.js, leads-quentes.js, meta-routes.js,
      ai-test-routes.js, project-handoff-*.js
  public/                      ← dashboard legado: congelado, some com a quarentena
  sql/
    init.sql
    prospeccao_orquestracao.sql
    migrations/                ← 91 (mantém)
    historico/                 ← NOVO: migracao_analise_estruturada.sql
  test/                        ← descoberta automática, sem lista manual
  scripts/
    ops/                       ← backfills, medições, manutenção (referenciados no package.json)
    historico/                 ← one-offs já cumpridos

frontend/                      ← ESTRUTURA ATUAL ESTÁ CERTA, não mexer
  app/                         ← App Router
  components/
    ui/                        ← design system
    <feature>/
  lib/                         ← módulos PUROS de tradução (+ .d.ts + .test.js) ← padrão a preservar
```

---

## 15. Plano de migração incremental

Cada fase é independente, reversível e cabe num diff revisável. **Nenhuma fase mistura mudança de comportamento com mudança de estrutura.**

| Fase | O que | Muda comportamento? | Esforço |
|---|---|---|---|
| **0** | Commitar/estabilizar a branch atual; limpar 23 worktrees e ~20 branches `worktree-*` | Não | Baixo |
| **1** | `npm test` por descoberta automática + fazer os 24 órfãos passarem | Não (revela bugs) | **Baixo — maior retorno do plano** |
| **2** | CI mínimo: `npm test` + `tsc --noEmit` nos dois lados, em push/PR | Não | Baixo |
| **3** | Atualizar `README.md`, `docs/project-map.md`, `docs/architecture-rules.md` para a realidade; declarar `AGENTS.md` como fonte única e os demais como derivados | Não | Baixo |
| **4** | Sincronizar `.env.example` com as 153 env vars reais | Não | Baixo |
| **5** | Remover mortos de **certeza alta**: `Chart3D`+`Bars3DScene`+3 deps, `tools/build-split.cjs`, `package-lock.json` da raiz, `GOOGLE_PLACES_API_KEY`/`EVOLUTION_INSTANCE` do compose e do `.env.example`, ramo Playwright | Não | Baixo |
| **6** | Dockerfile: `npm ci`, `--omit=dev`, `NODE_ENV=production`, remover `RUN npm install pg` | Build | Baixo |
| **7** | Decidir (você) os **3 dormentes**: `whisper-service/`, `project-handoff-*` + `docx`, scripts históricos | Não | Baixo (é decisão) |
| **8** | Consolidar `somenteDigitos` nas 5 reimplementações; `apiFetch` nas 2 páginas com `fetch` cru | Não | Baixo |
| **9** | Criar `src/workers/`; mover os 7 `setInterval`; corrigir o disparo no `require` de `freelandoo-provision` | Ordem de boot | Médio |
| **10** | Extrair os 82 endpoints de `agent.js`/`prospecting.js`/`agenda.js` para `routes/` — **mesmos paths, mesmos payloads** | Não (se bem feito) | **Alto** |
| **11** | Criar `integrations/`, `agent/`, `shared/`; mover por lotes pequenos | Não | Médio |
| **12** | Paginação/filtro de `banco-leads` e `captacao` no servidor | **Sim** (UX) | Médio |
| **13** | Marcar `public/` + `/dashboard/*` + `dashboardAuth.js` como `legacy/` com data; migrar as telas restantes; **só então** remover | **Sim** | Alto |
| **14** | Atualizar o catálogo de modelos de IA (incluir a geração Claude 5) e revisar a tabela de preços | **Sim** (custo/qualidade) | Baixo |

**Ordem inegociável:** 1 → 2 antes de qualquer outra. Sem suíte completa e sem CI, as fases 9–13 são apostas.

---

## 16. Riscos

| # | Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|---|
| R1 | Refatorar com 24 testes desligados | **Alta** | **Alto** | Fase 1 antes de tudo |
| R2 | Mover os 82 endpoints e quebrar um path/payload usado pelo dashboard legado ou por integração externa | Média | **Alto** | Congelar a lista dos 417 endpoints antes; teste de contrato por path; mover em lotes por arquivo |
| R3 | Migrations no boot: uma migration nova derruba o serviço na subida | Média | **Alto** | Smoke de migrations em CI contra Postgres limpo (Fase 2) |
| R4 | Remover o que parece morto e é dormente por decisão (whisper, handoff .docx) | Média | Médio | Fase 7 é **decisão sua**, não limpeza automática |
| R5 | `agent.js` é superfície de teste (~65 reexports via `index.js`) — mexer nele quebra testes em massa | **Alta** | Médio | Manter os reexports durante toda a Fase 10; removê-los só depois |
| R6 | Deploy sem CI, com Railway aplicando migrations automaticamente | **Alta** | **Alto** | Fase 2 |
| R7 | Trabalho não commitado e 5 commits à frente de `master` durante a auditoria | Presente | Médio | Fase 0 |
| R8 | `docker-compose.yml` desatualizado induzir alguém a recriar o ambiente errado | Média | Médio | Fase 3/5 |
| R9 | Mexer em `whatsapp.js`/`instancia-envio.js` e reintroduzir fallback de instância | Baixa | **Muito alto** | As guardas de regressão existentes já cobrem — **desde que rodem** (Fase 1) |
| R10 | 23 worktrees com cópias do backend poluírem grep e levarem a editar o arquivo errado | Média | Médio | Fase 0 |
| R11 | Corrida no boot: `freelandoo-provision.js:181` roda antes de `initDB` | Baixa | Médio | Fase 9 (não reproduzida nesta auditoria — investigar antes) |

---

## 17. Ordem recomendada das mudanças

```
  SEGURANÇA PRIMEIRO (nada estrutural antes disto)
  1. Fase 0  — estabilizar branch, limpar worktrees/branches
  2. Fase 1  — npm test automático + 24 órfãos passando      ← MAIOR RETORNO
  3. Fase 2  — CI mínimo (test + typecheck)

  VERDADE NA DOCUMENTAÇÃO (barato, destrava todo o resto)
  4. Fase 3  — README / project-map / architecture-rules
  5. Fase 4  — .env.example com as 153 variáveis

  LIMPEZA DE CERTEZA ALTA (risco baixo, ganho imediato)
  6. Fase 5  — mortos confirmados
  7. Fase 6  — Dockerfile reprodutível
  8. Fase 7  — SUA DECISÃO sobre os 3 dormentes
  9. Fase 8  — consolidar telefone + apiFetch

  ESTRUTURA (só com 1–3 prontas)
 10. Fase 9  — workers/
 11. Fase 10 — endpoints para routes/   ← a mudança mais pesada
 12. Fase 11 — integrations/, agent/, shared/

  PRODUTO
 13. Fase 12 — paginação de servidor
 14. Fase 14 — catálogo de modelos de IA
 15. Fase 13 — aposentar o dashboard legado  ← por último, é o que tem cliente em cima
```

---

## Apêndice A — Segunda revisão (dependências indiretas)

Feita ao final, especificamente para não classificar como morto algo alcançado por caminho não óbvio.

| Verificação | Resultado |
|---|---|
| `Chart3D`/`Bars3DScene`/`react-three` em todo o repo, incluindo `.md` e `.json` | Só `package.json`. **Morto confirmado** |
| `build-split` em docs | Citado em `project-map.md` e `ai-decision-log.md` (já declarado como dívida). **Órfão confirmado, docs a ajustar junto** |
| `whisper` em `docs/` e `AGENTS.md` | Citado em 6 documentos. **Desconectado do runtime, mas documentado como parte da arquitetura** → decisão, não limpeza |
| `project-handoff` / `gerarBriefingDocx` / rota com "handoff" | Nenhuma rota; `agent.js` importa `handoff-alerts.js` (outro módulo). Citado em `IMPLEMENTATION_SLICES.md` e `project-map.md`. **Dormente** |
| `migracao_analise_estruturada.sql` | Não carregado por código; aplicado à mão via `psql` conforme `docs/historico/`. **Histórico** |
| Scripts sem `npm script` | `cleanup-prospeccao-legado.js` sem nenhuma citação; `init-whatsapp.js` e `seed-campanha-nail-designer.js` citados só em docs históricos |
| `FREELANDOO_ENC_KEY` "não usada" | **Falso positivo derrubado** — lida indiretamente via `freelandoo/crypto.js:22` → `segredos-crypto.js` |
| `knowledge/prints/*.png` "ausentes" | **Falso positivo derrubado** — existem; o `find` inicial tinha `-maxdepth 1` |
| 3 arquivos de `src/db/` "sem chamador" | **Falso positivo derrubado** — consumidos por `require` relativo dentro da própria pasta `db/` |
| `EVOLUTION_INSTANCE` "ainda no código" | **Falso positivo derrubado** — aparece só em comentários e em testes de guarda que falham se ela voltar |
| `prospecacao.html` "duplicado" | **Falso positivo derrubado** — stub de redirect de 12 linhas, intencional |

---

## Apêndice B — Números de referência

| Métrica | Valor |
|---|---|
| Arquivos versionados | 907 (backend 602, frontend 215, docs 77) |
| Backend `src/` | 82.082 LOC · 247 arquivos (65 raiz, 97 services, 47 db, 38 routes, 1 middleware, 4 freelandoo) |
| Backend testes | 40.155 LOC · **165 arquivos (141 rodam)** |
| Dashboard legado `public/` | 20.389 LOC · 13 páginas |
| Frontend | 49.325 LOC · 32 em `app/`, 47 em `components/`, 129 em `lib/` |
| Endpoints HTTP declarados | **417** (82 fora de `routes/`) |
| Migrations | 91 (`001`–`090`) |
| Prompts de produção | 13 `.md` |
| Env vars lidas pelo código | **153** (39 no `.env.example`) |
| Dependências de produção | backend 11 · frontend 7 |
| CI/CD | **nenhum** |
| Branches / worktrees | 40 / 23 |
| `tsc --noEmit` | limpo nos dois lados |
| `npm test` frontend | 704/704 |
