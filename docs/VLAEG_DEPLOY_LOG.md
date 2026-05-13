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
