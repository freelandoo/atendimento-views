# VLAEG Environment — Variáveis de Ambiente

> Nunca salve valores reais neste arquivo. Use apenas nomes e exemplos com placeholders.

---

## Backend (Railway)

### Obrigatórias — IA

| Variável | Exemplo | Descrição |
|----------|---------|-----------|
| `OPENAI_API_KEY` | `sk-proj-...` | Provider principal no SaaS |
| `ANTHROPIC_KEY` | `sk-ant-...` | Fallback ou provider alternativo |
| `OPENAI_MODEL` | `gpt-4o` | Modelo padrão OpenAI |

### Obrigatórias — WhatsApp

| Variável | Exemplo | Descrição |
|----------|---------|-----------|
| `EVOLUTION_API_KEY` | `sua-chave-aqui` | Chave mestra Evolution API |
| `EVOLUTION_URL` | `https://evolution.seudominio.com` | URL da Evolution API |
| `EVOLUTION_INSTANCE` | `PJ` | Instância padrão (empresa default) |

### Obrigatórias — Banco

| Variável | Exemplo | Descrição |
|----------|---------|-----------|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db` | URL completa PostgreSQL (Railway gera automaticamente) |

### Obrigatórias — Servidor

| Variável | Exemplo | Descrição |
|----------|---------|-----------|
| `PORT` | `3000` | Porta do servidor Express |
| `REPROCESS_SECRET` | `minha-chave-segura-12chars` | Protege rotas admin (≥8 chars) |
| `NODE_ENV` | `production` | Ambiente |
| `TIMEZONE` | `America/Sao_Paulo` | Timezone padrão |

### Obrigatórias — Dashboard / Auth

| Variável | Exemplo | Descrição |
|----------|---------|-----------|
| `DASHBOARD_ADMIN_EMAIL` | `admin@empresa.com` | Email do admin inicial |
| `DASHBOARD_ADMIN_PASSWORD` | `senha-super-segura-123` | Senha do admin (≥12 chars) |
| `JWT_SECRET` | `string-aleatoria-longa` | Secret para JWT (novo SaaS) |
| `SESSION_SECRET` | `string-aleatoria-longa` | Secret para sessions |

### Obrigatórias — Empresa Default

| Variável | Exemplo | Descrição |
|----------|---------|-----------|
| `DEFAULT_EMPRESA_SLUG` | `pj-codeworks` | Slug da empresa padrão |
| `DEFAULT_EMPRESA_NOME` | `PJ Codeworks` | Nome da empresa padrão |

---

## Opcionais — Backend

| Variável | Exemplo | Descrição |
|----------|---------|-----------|
| `WHISPER_SERVICE_URL` | `http://whisper-service:9000` | Transcrição de áudio |
| `GOOGLE_PLACES_API_KEY` | `AIza...` | Prospecção automática |
| `GOOGLE_CSE_KEY` | `...` | Busca de concorrentes |
| `GOOGLE_CSE_ID` | `...` | ID do Custom Search Engine |
| `TELEGRAM_BOT_TOKEN` | `123456:ABC-...` | Alertas de handoff |
| `TELEGRAM_CHAT_ID` | `-100123456789` | Chat de alertas |
| `OPERATOR_WHATSAPP` | `5511987309724:Victor` | Operadores autorizados |
| `CLAUDE_WEB_SEARCH` | `true` | Ativa busca web no Claude |
| `WEBHOOK_REPLY_DEBOUNCE_MS` | `4000` | Debounce antes de responder |
| `HISTORICO_CLAUDE_MAX_MSGS` | `20` | Limite de histórico para Claude |
| `FOLLOWUP_AUTO_ENABLED` | `true` | Ativa follow-up automático |

---

## Frontend (Vercel)

| Variável | Exemplo | Descrição |
|----------|---------|-----------|
| `NEXT_PUBLIC_API_URL` | `https://api.pjcodeworks.com` | URL do backend Railway |
| `NEXT_PUBLIC_APP_URL` | `https://app.pjcodeworks.com` | URL do frontend |
| `NEXT_PUBLIC_EVOLUTION_PUBLIC_URL` | `https://evolution.seudominio.com` | Evolution API pública (para QR Code) |

---

## CI/CD (GitHub Secrets)

| Variável | Descrição |
|----------|-----------|
| `RAILWAY_TOKEN` | Token Railway para deploy automático |
| `VERCEL_TOKEN` | Token Vercel para deploy automático |
| `VERCEL_ORG_ID` | Org ID da Vercel |
| `VERCEL_PROJECT_ID` | Project ID da Vercel |

---

## Status de Coleta

| Variável | Status |
|----------|--------|
| `RAILWAY_TOKEN` | ✅ Recebido (não armazenado) |
| `OPENAI_API_KEY` | ❌ Pendente |
| `ANTHROPIC_KEY` | ❌ Pendente |
| `EVOLUTION_API_KEY` | ❌ Pendente |
| `EVOLUTION_URL` | ❌ Pendente |
| `DATABASE_URL` | ⏳ Railway vai gerar |
| `DASHBOARD_ADMIN_EMAIL` | ❌ Pendente |
| `DASHBOARD_ADMIN_PASSWORD` | ❌ Pendente |
| `JWT_SECRET` | ⏳ Gerar automaticamente |
| `VERCEL_TOKEN` | ❌ Pendente (Slice 13) |
