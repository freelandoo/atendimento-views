# VLAEG Secrets Checklist

> Este arquivo contém APENAS os nomes das chaves. Nunca valores reais.
> Valores ficam no Railway Variables, Vercel Env Vars ou .env local (não versionado).

---

## Backend — Railway Variables

### IA
- [ ] `OPENAI_API_KEY`
- [ ] `OPENAI_MODEL`
- [ ] `ANTHROPIC_KEY`

### WhatsApp
- [ ] `EVOLUTION_API_KEY`
- [ ] `EVOLUTION_URL`
- [ ] `EVOLUTION_INSTANCE`

### Banco
- [ ] `DATABASE_URL` ← Railway gera automaticamente ao criar PostgreSQL

### Redis
- [ ] `REDIS_URL` ← Railway gera automaticamente ao criar Redis

### Servidor
- [ ] `PORT`
- [ ] `NODE_ENV`
- [ ] `REPROCESS_SECRET`
- [ ] `JWT_SECRET`
- [ ] `SESSION_SECRET`

### Admin inicial
- [ ] `DASHBOARD_ADMIN_EMAIL`
- [ ] `DASHBOARD_ADMIN_PASSWORD`
- [ ] `DEFAULT_EMPRESA_SLUG`
- [ ] `DEFAULT_EMPRESA_NOME`

### Empresa default
- [ ] `OPERATOR_WHATSAPP`

### Opcionais
- [ ] `WHISPER_SERVICE_URL`
- [ ] `GOOGLE_PLACES_API_KEY`
- [ ] `GOOGLE_CSE_KEY`
- [ ] `GOOGLE_CSE_ID`
- [ ] `TELEGRAM_BOT_TOKEN`
- [ ] `TELEGRAM_CHAT_ID`

---

## Frontend — Vercel Env Vars

- [ ] `NEXT_PUBLIC_API_URL`
- [ ] `NEXT_PUBLIC_APP_URL`
- [ ] `NEXT_PUBLIC_EVOLUTION_PUBLIC_URL`

---

## CI/CD — GitHub Secrets

- [ ] `RAILWAY_TOKEN`
- [ ] `VERCEL_TOKEN`
- [ ] `VERCEL_ORG_ID`
- [ ] `VERCEL_PROJECT_ID`

---

## Status de Coleta

| Secret | Status | Observação |
|--------|--------|-----------|
| `RAILWAY_TOKEN` | ✅ Recebido | Na sessão atual. Setar como env var |
| `OPENAI_API_KEY` | ❌ Pendente | Solicitar ao usuário |
| `ANTHROPIC_KEY` | ❌ Pendente | Solicitar ao usuário |
| `EVOLUTION_API_KEY` | ❌ Pendente | Solicitar ao usuário |
| `EVOLUTION_URL` | ❌ Pendente | URL da Evolution em produção |
| `DATABASE_URL` | ⏳ Auto | Railway gera ao criar PostgreSQL |
| `REDIS_URL` | ⏳ Auto | Railway gera ao criar Redis |
| `JWT_SECRET` | ⏳ Auto | Gerar com crypto.randomBytes(64) |
| `SESSION_SECRET` | ⏳ Auto | Gerar com crypto.randomBytes(64) |
| `DASHBOARD_ADMIN_EMAIL` | ❌ Pendente | Email do admin PJ Codeworks |
| `DASHBOARD_ADMIN_PASSWORD` | ❌ Pendente | Senha segura ≥12 chars |
| `VERCEL_TOKEN` | ❌ Pendente | Necessário no Slice 13 |
