# VLAEG Deploy Log

---

## Deploy Local (Docker Compose)

**Comando:**
```bash
docker compose up -d
```

**Serviços:**
- postgres:5432
- redis:6379
- evolution-api:8080
- whisper-service:9000
- webhook (agente):3000

**Status:** ⬜ Não testado nesta sessão (ambiente local do usuário)

---

## Deploy Railway — Backend ✅

**Projeto:** `grateful-nourishment` (Railway)

**URL pública:** `https://atendimento-views-production.up.railway.app`

**Healthcheck:** `GET /health` → 200 `{ ok: true }`

**Arquivo de config:** `railway.toml`

**Variáveis obrigatórias no Railway:**
- `DATABASE_URL` — PostgreSQL provisionado pelo Railway
- `ANTHROPIC_KEY` — Claude API
- `OPENAI_API_KEY` — OpenAI API
- `EVOLUTION_URL` — URL pública da Evolution API
- `EVOLUTION_API_KEY`
- `JWT_SECRET` — string aleatória ≥ 32 chars
- `REPROCESS_SECRET` — string ≥ 8 chars
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` — admin inicial SaaS
- `DASHBOARD_ADMIN_EMAIL`, `DASHBOARD_ADMIN_PASSWORD`
- `FRONTEND_URL` — URL Vercel (para CORS): `https://web-psi-two-24.vercel.app`

**Migrations:** executam automaticamente no boot via `src/db/migrations.js`.

**Status:** ✅ Ativo (deploy anterior ao Protocolo VLAEG)

---

## Deploy Vercel — Frontend ✅

**Projeto:** `web` (freelandoos-projects / Vercel)

**URL pública:** `https://web-psi-two-24.vercel.app`

**Framework:** Next.js 14 App Router + TypeScript + Tailwind

**Arquivo de config:** `apps/web/vercel.json`

**Root Directory:** `apps/web`

**Variáveis de ambiente (Vercel):**
- `NEXT_PUBLIC_API_URL` = `https://atendimento-views-production.up.railway.app`

**Estrutura de rotas:**
- `/` → redirect para `/login`
- `/login` → autenticação JWT
- `/dashboard` → visão geral (KPIs)
- `/dashboard/conversas` → listagem de leads
- `/dashboard/contextos` → gestão de contextos 1 + geração de Contexto 2
- `/dashboard/empresa` → config da empresa + instâncias WhatsApp
- `/dashboard/relatorios` → relatórios gerados por IA

**Como redesployar:**
```powershell
$env:VERCEL_TOKEN = "<token>"
Set-Location apps/web
vercel deploy --prod --token $env:VERCEL_TOKEN --yes --scope freelandoos-projects
```

**Status:** ✅ Ativo — deploy realizado em 2026-05-13 (Slice 13)

---

## Histórico de Deploys

| Data | Ambiente | Serviço | Resultado | Observação |
|------|----------|---------|-----------|-----------|
| 2026-05-13 | GitHub | Repositório | ✅ Push inicial (121 arquivos) | branch master |
| 2026-05-13 | Railway | Backend | ✅ Online | projeto grateful-nourishment |
| 2026-05-13 | Vercel | Frontend | ✅ Online | fix route groups + TypeScript |
