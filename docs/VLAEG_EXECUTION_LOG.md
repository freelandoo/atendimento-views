# VLAEG Execution Log

---

## [2026-05-13] Slice 0 — Auditoria inicial

**Ação:** Auditoria completa do projeto via agente Explore.

**Resultado:**
- 121 arquivos commitados (54.884 linhas inseridas)
- Stack: Node.js 20 + Express 5 + PostgreSQL 15 + Evolution API v2 + Anthropic/OpenAI + Pino
- Dashboard: HTML/JS estático servido pelo próprio Express
- Banco: 2 schemas (vendas, prospectador), ~15 tabelas
- Docker Compose: 5 serviços (postgres, redis, evolution-api, whisper-service, webhook)
- Testes: `test/core.test.js` (Node test runner nativo)
- Provider IA: abstração em `src/ai-provider.js` (Anthropic primary, OpenAI fallback)
- Funil: primeiro_contato → diagnostico → proposta → objecao → fechamento
- Repositório: https://github.com/freelandoo/atendimento-views.git (branch master)

**Arquivos relevantes:**
- `src/agent.js` — núcleo do agente (~2000 linhas)
- `src/db.js` — schema PostgreSQL completo
- `sql/init.sql` — DDL inicial
- `.env.example` — variáveis de ambiente
- `docker-compose.yml` — stack completa local

**Próximo:** Criar documentação VLAEG + CLAUDE.md

---

## [2026-05-13] Slice 1 — Documentação VLAEG e CLAUDE.md

**Ação:** Criação de todos os documentos VLAEG e CLAUDE.md.

**Arquivos criados/atualizados:**
- `CLAUDE.md` — visão geral, stack, comandos, arquitetura
- `docs/VLAEG_EXECUTION_LOG.md` — este arquivo
- `docs/VLAEG_ENVIRONMENT.md` — variáveis de ambiente
- `docs/VLAEG_DECISIONS.md` — decisões arquiteturais
- `docs/VLAEG_TODO.md` — slices e status
- `docs/VLAEG_SECRETS_CHECKLIST.md` — checklist de secrets
- `docs/VLAEG_DEPLOY_LOG.md` — log de deploy

**Memória salva:**
- `memory/project_vlaeg.md`
- `memory/reference_railway.md`
- `memory/feedback_vlaeg.md`
- `memory/user_alex.md`

**Railway CLI:** v4.40.0 instalado e disponível.

---

## [2026-05-13] Slice 13 — Deploy Vercel (Frontend)

**Ações:**
- Instalado Vercel CLI v53.4.0 globalmente
- Detectado Railway backend já ativo: `https://atendimento-views-production.up.railway.app`
- Corrigido `next.config.ts` → `next.config.mjs` (Next.js 14.2 não suporta .ts)
- `output: 'standalone'` condicionado a `!process.env.VERCEL` (Docker vs Vercel)
- Route groups `(auth)`/`(dashboard)` substituídos por `app/login/` + `app/dashboard/`
- TypeScript: `apiFetch<{token,empresa_id}>` tipado no login page
- `NEXT_PUBLIC_API_URL` setado na Vercel via CLI (não via secret reference)
- Deploy realizado com sucesso: `https://web-psi-two-24.vercel.app`

**Commit:** `feat(slice13)` → master

---

## [2026-05-13] Slice 14 — Testes Finais

**Resultados:**
- `npm test` (core.test.js): **208/208 passando** ✅
- `node test/multitenant.test.js`: **9/9 passando** ✅

**Fix aplicado:**
- `src/prospecting.js`: null guard em `salvo` (segurança defensiva quando INSERT retorna vazio)
- `test/core.test.js`: mock de `pool.query` atualizado para 4 steps (prospects + ai_settings + ai_logs + diagnostico); `invalidateCache()` para determinismo

**Commit:** `fix(slice14)` → master

---

## [2026-05-13] Slice 15 — Docs Finais + Encerramento VLAEG

**Ações:**
- `docs/VLAEG_DEPLOY_LOG.md`: atualizado com URLs reais de produção
- `docs/VLAEG_EXECUTION_LOG.md`: log completo dos Slices 13–15
- Memory atualizada: `project_vlaeg.md`
- **PROTOCOLO VLAEG ENCERRADO** ✅

**URLs de Produção:**
- Backend: `https://atendimento-views-production.up.railway.app`
- Frontend: `https://web-psi-two-24.vercel.app`

**Repositório:** `https://github.com/freelandoo/atendimento-views.git` branch `master`

---

## [2026-05-13] Slices 16–23 — Re-abertura VLAEG (pós-encerramento)

VLAEG reaberto autonomamente após relatos do usuário de bugs em produção. Total 8 slices novos.

### Slice 16 — Setup Vercel correto (novo projeto)
**Problema:** `https://atendimento-views.vercel.app` retornava `FUNCTION_INVOCATION_FAILED`. O projeto Vercel detectou o `package.json` da raiz (Express backend) e tentou rodar `index.js` como serverless function.

**Fix:** Via Vercel API, PATCH no projeto `prj_lwT6vj8Jc1p5Z9RiNUGQSnyY2CyA`:
- `rootDirectory: "apps/web"`
- `framework: "nextjs"`
- Adicionado env var `NEXT_PUBLIC_API_URL` apontando pro Railway backend

**Resultado:** Frontend Next.js builda e serve a partir de `apps/web/`.

### Slice 17 — Setup Railway completo
**Problema:** Backend Railway retornava 502 — healthcheck falhava. Logs mostravam que faltavam todas as env vars obrigatórias. Postgres não estava provisionado, Evolution não existia.

**Ações via Railway GraphQL:**
- Provisionado **Postgres** (`c443623a-2724-49d9-8a9b-fa8baa75bf05`)
- Criado service **evolution-api** (`8eab84eb-...`) com imagem (após correção) `evoapicloud/evolution-api:v2.3.7`
- Gerado domínio público para Evolution
- Setado 25 env vars no backend via `variableCollectionUpsert`:
  - `DATABASE_URL=${{Postgres.DATABASE_URL}}`
  - `EVOLUTION_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE=PJ`
  - `OPENAI_API_KEY`
  - Secrets gerados (REPROCESS_SECRET, JWT_SECRET, WEBHOOK_SECRET, SESSION_SECRET, EVOLUTION_API_KEY)
  - Admin credentials, DEFAULT_COMPANY_*, FRONTEND_URL, etc.

### Slice 18 — Fix login bug (frontend ↔ backend)
**Problema:** Frontend `apps/web/app/login/page.tsx` enviava `{ email, senha }`, mas backend `/api/auth/login` espera `{ email, password }`. Login retornava 400 BAD_REQUEST.

**Fix:** Atualizado body para `{ email, password: senha }` + lê `data.empresas[0].id` (não `data.empresa_id`).

**Commit:** `97e9a9d fix(login): envia password (não senha) e lê empresa_id de empresas[0]`

### Slice 19 — WhatsApp sync com Evolution
**Necessidade do usuário:** Criação/remoção de instância na UI deveria sincronizar com Evolution sem ele precisar mexer no Manager.

**Implementação:**
- `POST /api/empresas/:id/whatsapp` agora chama `POST /instance/create` no Evolution antes de salvar; swallow "already exists"
- `DELETE` virou hard-delete: remove no Evolution + DB
- `GET /api/empresas/:id/whatsapp/:instanceId/qrcode` proxy pra `/instance/connect/{name}` → retorna `{ connected, base64, pairingCode }`
- Frontend: botão "Gerar QR Code" + modal com QR + instruções de pareamento; botão "Remover"; ID técnico **auto-derivado** do nome amigável (slug NFD + lowercase + hyphen)

**Commits:** `19a3caf`, `0caa2e9`, `abbb508`

### Slice 20 — Tela Modelo LLM
**Necessidade:** Tela administrativa para colar API key, listar modelos do provider, ativar.

**Backend:**
- Migration: `vendas.ai_settings` ganha `openai_api_key`, `anthropic_api_key`, `status`, `last_error`, `tested_at`
- `ai-provider`: lê chave do DB primeiro, env como fallback
- Nova rota `src/routes/api-llm.js`:
  - `GET /api/llm` → config atual (chaves mascaradas)
  - `POST /api/llm/test` → `GET /v1/models` do provider; lista modelos
  - `POST /api/llm/activate` → valida key + salva no DB + invalida cache

**Frontend:** `/dashboard/llm/page.tsx` com tabs OpenAI/Anthropic + Rodar + Conectar + badge ativo/erro/pendente + erro completo.

**Commit:** `0ff9ff8`

### Slice 21 — Fix Contexto 2 (temperature string)
**Problema:** Mesmo com OpenAI ativo, geração de Contexto 2 falhava com `OpenAI 400 Invalid type for 'temperature': expected a decimal, but got a string instead`.

**Causa raiz:** Coluna `vendas.ai_settings.temperature` é `NUMERIC`. Driver `pg` retorna NUMERIC como string para preservar precisão. Passado direto pro axios pra OpenAI → rejeitado.

**Fix:** `Number(input.temperature ?? settings.temperature ?? 0.4)` em `generateAIResponse`. Idem `max_tokens`.

**Commit:** `19f431b fix(ai-provider): coage temperature/max_tokens da DB para Number`

### Slice 22 — Tela Uso & Custo
**Necessidade:** Aba mostrando tokens consumidos, custo USD, dividido por entrada/saída, por uso (contexto/reply/relatório), por cliente, por modelo.

**Backend:**
- Migration: `vendas.ai_logs` ganha `empresa_id, ref_type, ref_id, client_numero, input_tokens, output_tokens, cost_usd`
- `ai-provider`: tabela `MODEL_PRICES` (gpt-4o-mini, gpt-4o, gpt-4-turbo, gpt-3.5-turbo, sonnet-4-6, haiku-4-5, opus-4-7); captura `usage.prompt_tokens/completion_tokens` (OpenAI) e `usage.input_tokens/output_tokens` (Anthropic); calcula custo no log
- Todas as funções de domínio (`generateContextPlan`, `generateAgentReply`, `summarizeConversation`, `generateReport`) propagam ctx (empresaId, refType, refId, clientNumero)
- `api-contextos` passa `empresa_id + ref_id` ao gerar plano
- Nova rota `src/routes/api-llm-uso.js`: `GET /api/empresas/:id/llm/uso?from=&to=` retorna `{ totais, por_tipo, por_cliente, por_contexto, por_modelo, recentes }`

**Frontend:** `/dashboard/uso/page.tsx` com filtro de data + 4 cards (chamadas, tokens entrada, tokens saída, custo) + 5 tabelas.

**Commit:** `e224514`

### Slice 23 — Dropdown versões de Contexto 2
**Necessidade:** Visualizar as versões do Contexto 2 geradas direto na linha do Contexto 1.

**Implementação:** Linha do Contexto 1 vira expansível (chevron). Ao expandir, `GET /versoes` é carregado. Cada versão mostra:
- Versão N + badge (rascunho âmbar / ativo verde / arquivado cinza)
- Data + gerado_por
- Botão "Ver conteúdo" → JSON formatado em bloco escuro
- Botão "Ativar" → arquiva atual + ativa essa

**Commit:** `b26603d`

---

## Gotchas descobertos (memorizados)

1. **Imagem Evolution mudou de namespace:** `atendai/evolution-api` está congelado em v2.2.3; usar `evoapicloud/evolution-api` para v2.3.x+
2. **Railway redeploy não pega nova source.image:** `serviceInstanceRedeploy` rebuilda config cacheada; usar `serviceInstanceDeployV2` para deploy novo com config atual
3. **Postgres NUMERIC → string no pg driver:** coagir `Number()` antes de enviar pra APIs que esperam decimal
4. **Vercel monorepo precisa rootDirectory:** sem ele, Vercel detecta o backend Express na raiz e crasha como FUNCTION_INVOCATION_FAILED

## URLs de Produção (atualizadas 2026-05-13)
- Backend Railway: `https://atendimento-views-production.up.railway.app`
- Frontend Vercel: `https://atendimento-views.vercel.app` (projeto `atendimento-views`)
- Evolution API: `https://evolution-api-production-fae5f.up.railway.app`

