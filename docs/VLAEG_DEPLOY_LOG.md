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

## Deploy Railway (Backend) — Configurado em Slice 12

**Arquivo:** `railway.toml` na raiz do projeto.

**Passos para ativar:**
```bash
$env:RAILWAY_TOKEN = "<seu-token>"
railway login --token $env:RAILWAY_TOKEN
railway link <project-id>
railway up
```

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
- `FRONTEND_URL` — URL Vercel do frontend (para CORS)

**Migrations:** executam automaticamente no boot via `src/db/migrations.js`.

**Healthcheck:** `GET /health` → 200 `{ ok: true }`.

---

## Deploy Vercel (Frontend) — Configurado em Slice 12

**Arquivo:** `apps/web/vercel.json`

**Passos:**
1. Conectar repositório no dashboard Vercel
2. Definir **Root Directory** como `apps/web`
3. Adicionar variável de ambiente: `NEXT_PUBLIC_API_URL = <URL Railway backend>`
4. Deploy automático no push para master

---

## Deploy Railway — Backend

**Projeto:** ⏳ A criar (Slice 2)

**Serviços a configurar:**
- [ ] PostgreSQL (Railway plugin)
- [ ] Redis (Railway plugin)
- [ ] Evolution API (custom service)
- [ ] Backend Node.js (deploy do repo)

**Variáveis configuradas:** Ver `VLAEG_SECRETS_CHECKLIST.md`

**URL pública:** ⏳ Pendente

**Comandos:**
```bash
$env:RAILWAY_TOKEN = "<token>"
railway login --token $env:RAILWAY_TOKEN
railway init              # cria projeto
railway add --plugin postgresql
railway add --plugin redis
railway up                # deploy backend
```

**Healthcheck:** `GET /health` → `{"status":"ok","timestamp":"..."}`

**Status:** 🔄 Em andamento (Slice 2)

---

## Deploy Vercel — Frontend

**Projeto:** ⏳ A criar (Slice 13)

**Framework:** Next.js App Router

**Variáveis configuradas:** Ver `VLAEG_SECRETS_CHECKLIST.md`

**URL pública:** ⏳ Pendente

**Comandos:**
```bash
$env:VERCEL_TOKEN = "<token>"
vercel --token $env:VERCEL_TOKEN deploy --prod
```

**Status:** ⬜ Pendente (Slice 13)

---

## Histórico de Deploys

| Data | Ambiente | Serviço | Resultado | Observação |
|------|----------|---------|-----------|-----------|
| 2026-05-13 | GitHub | Repositório | ✅ Push inicial (121 arquivos) | branch master |
