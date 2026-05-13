# PJ Codeworks — Agente Comercial WhatsApp → SaaS Multiempresa

## Visão Geral

Agente comercial IA via WhatsApp que automatiza todo o funil de vendas da PJ Codeworks.
Atualmente: monolito Node.js com um cliente (PJ Codeworks).
Destino: SaaS multiempresa onde qualquer empresa pode cadastrar-se, inserir contexto e operar seu próprio agente.

**PROTOCOLO VLAEG ATIVO** — execução autônoma em andamento. Ver `docs/VLAEG_EXECUTION_LOG.md`.

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Runtime | Node.js 20 (Alpine) |
| Framework | Express 5.2 |
| Banco | PostgreSQL 15 (schemas: `vendas`, `prospectador`) |
| IA Principal | Anthropic Claude (Sonnet/Haiku) |
| IA Fallback | OpenAI GPT-4o |
| WhatsApp | Evolution API v2.3.7 |
| Transcrição | Whisper (Python/FastAPI, porta 9000) |
| Logging | Pino (JSON estruturado, redaction de secrets) |
| Dashboard atual | HTML5 + Vanilla JS estático |
| **Frontend novo** | Next.js App Router + TypeScript + Tailwind + shadcn/ui |
| Deploy Backend | Railway |
| Deploy Frontend | Vercel |
| Containerização | Docker + Docker Compose (local) |

---

## Arquitetura Atual

```
index.js                    ← entry point, valida env, inicia BD, registra rotas
src/
  agent.js                  ← NÚCLEO: orquestra conversas, funil, Claude API (~2000 linhas)
  webhook-handler.js        ← recebe eventos Evolution API, enfileira jobs
  core-funnel.js            ← máquina de estados do funil comercial
  db.js                     ← pool PostgreSQL, cria tabelas no init
  db-crud.js                ← CRUD estruturado com validação
  routes.js                 ← agrega rotas de todos os módulos
  prompts.js                ← carrega todos os prompts em memória
  ai-provider.js            ← abstração Anthropic/OpenAI com cache 30s
  ai-routes.js              ← endpoints /dashboard/ai/*
  whatsapp.js               ← integração Evolution API (envio, download, botões)
  pricing.js                ← motor de precificação determinístico
  prospecting.js            ← prospecção automática Google Places
  agenda.js                 ← agendamento de reuniões
  followup-auto.js          ← follow-up automático por sequência
  followup-execution.js     ← follow-up manual via dashboard
  learning.js               ← auto-aprendizado pós-conversa
  handoff-alerts.js         ← alertas de handoff para operador
  operator-commands.js      ← comandos operador via WhatsApp
  media-processing.js       ← transcrição áudio + análise imagem
  preview-site.js           ← geração de preview de site (SVG/HTML)
  dashboardAuth.js          ← autenticação dashboard (scrypt + CSRF)
  config.js                 ← constantes e env vars centralizados
  logger.js                 ← Pino com redaction de secrets/telefones
  date-utils.js             ← utilitários data/hora (São Paulo)
  string-utils.js           ← parsing JSON Claude, normalização strings
  institutional-language.js ← sanitização de termos internos
  domainSchemas.js          ← validação de schemas
  project-handoff-build.js  ← compilação de handoff para projeto
  project-handoff-docx.js   ← geração de DOCX
  project-handoff-types.ts  ← tipos TypeScript

prompts/                    ← templates de prompt por etapa do funil
knowledge/cases.json        ← catálogo de 7 cases de referência
public/                     ← dashboard estático atual
sql/init.sql                ← schema PostgreSQL completo
```

---

## Funil Comercial

```
primeiro_contato → diagnostico → proposta → objecao → fechamento
                                    ↓
                              [2 portas]
                    assinatura simples | projeto sob medida
```

---

## Variáveis de Ambiente Obrigatórias

```bash
ANTHROPIC_KEY=           # Claude API
EVOLUTION_API_KEY=       # Evolution API
EVOLUTION_URL=           # http://localhost:8080 (local) ou URL Railway
EVOLUTION_INSTANCE=      # nome da instância (ex: PJ)
DATABASE_URL=            # postgresql://...
PORT=3000
REPROCESS_SECRET=        # ≥8 chars
DASHBOARD_ADMIN_EMAIL=
DASHBOARD_ADMIN_PASSWORD= # ≥12 chars
```

Ver `docs/VLAEG_ENVIRONMENT.md` para lista completa.

---

## Comandos

```bash
# Rodar local com Docker
docker compose up -d

# Apenas o servidor (com BD externo)
node index.js

# Testes unitários
npm test

# Validar tipos TypeScript
npm run typecheck

# Smoke test de precificação
npm run smoke:preco

# Dump de prompts ativos para logs/
node scripts/dump-prompts.js
```

---

## Como Rodar Local

1. Copiar `.env.example` → `.env` e preencher
2. `docker compose up -d` (sobe postgres, redis, evolution, whisper, webhook)
3. Evolution API disponível em `http://localhost:8080`
4. Servidor em `http://localhost:3000`
5. Dashboard em `http://localhost:3000/dashboard`

---

## Como Fazer Deploy (Railway)

Ver `docs/VLAEG_DEPLOY_LOG.md` para log atualizado.

```bash
# Autenticar
$env:RAILWAY_TOKEN = "<token>"
railway login --token $env:RAILWAY_TOKEN

# Linkar projeto
railway link <project-id>

# Deploy
railway up
```

---

## Decisões Arquiteturais Atuais

- **Multiempresa:** `empresa_id` em todas as tabelas de dados. Sem row-level security (RLS) por ora — validação na camada de aplicação.
- **PJ Codeworks** permanece como empresa padrão/seed.
- **Contexto 2:** IA gera plano estruturado a partir do contexto bruto da empresa. Editável e versionado.
- **Provider IA:** OpenAI como principal no SaaS (compatibilidade), Anthropic como fallback.
- **WhatsApp:** cada empresa configura sua própria instância Evolution via dashboard.
- **Frontend:** Next.js App Router na Vercel. API calls para backend Railway.

Ver `docs/VLAEG_DECISIONS.md` para histórico completo.

---

## Padrões de Código

- JavaScript (Node.js) no backend. TypeScript para tipos (noEmit, não compila).
- Sem comentários óbvios. Só quando o WHY é não-óbvio.
- Logging via `logger.js` (Pino). Nunca `console.log` em produção.
- Secrets nunca em arquivos versionados. Sempre via `process.env`.
- Queries PostgreSQL: sempre parametrizadas. Nunca interpolação direta.
- Tenant isolation: toda query com `WHERE empresa_id = $n`.

---

## Segurança

- Autenticação dashboard: scrypt + cookie httpOnly + CSRF token
- Autenticação API: JWT (a implementar no SaaS)
- Sem secrets hardcoded em código
- `.env` no `.gitignore`
- Evolution API key no header `apikey`
- Reprocess secret ≥8 chars no header `x-reprocess-secret`

---

## Próximos Passos (VLAEG)

Ver `docs/VLAEG_TODO.md` para status atualizado dos slices.
