# Revisão Técnica — PJ Codeworks Agent (WhatsApp)

**Data:** 2026-04-15
**Escopo:** arquitetura, qualidade de código, confiabilidade e requisitos de um agente de IA 24/7 de vendas.

---

## Sumário executivo

O agente funciona: webhooks são processados, Claude responde, conversas são persistidas. Mas para rodar 24/7 fechando vendas, há **risco crítico de segurança** (secrets hardcoded no `docker-compose.yml` e `.env`), **fragilidade operacional** (monolito `index.js` de 3.395 linhas, sem testes, debounce em memória, sem retry, sem graceful shutdown) e **lacunas de confiabilidade** (webhook retorna 202 OK antes de gerar resposta, sem dedup, Redis declarado mas não usado). Prioridade 1 é fechar buracos de segurança e confiabilidade antes de qualquer feature nova.

---

## Inventário real

**Stack confirmado**
- Webhook: Node 20 + Express 5 (apenas 3 deps: `axios`, `express`, `form-data`)
- Postgres 15 com schema `vendas` (5 tabelas)
- Redis 7 declarado no compose — **não é usado no código** (zero referências em `index.js`)
- Evolution API v2.3.7
- Claude Sonnet 4.6 (timeout 45s, max_tokens 2048)
- 4 prompts MD (`system.md`, `empresa.md`, `followup.md`, `lead-coach.md`) carregados no boot
- Dashboard: 5 HTMLs estáticos + JS vanilla; "auth" via `sessionStorage`
- Sem migrations (um `sql/init.sql` inline), sem testes, sem CI

**`index.js` — 3.395 linhas, divisão aproximada:** imports/boot/prompts (1-400), motor de preço (400-500), helpers de BD (500-800), formatação/sanitização (800-1.200), chamadas Claude (1.200-1.400), mídia/Whisper (1.400-1.700), envio Evolution + debounce local (1.700-2.100), `POST /webhook` (2.100-2.600), rotas `/dashboard/*` (2.600-3.200), reprocessar/followup/listen (3.200-fim).

---

## Riscos CRÍTICOS (P0)

### 1. Secrets hardcoded no compose e no `.env`
- `ANTHROPIC_KEY` **ativa** em `docker-compose.yml:48`
- `AUTHENTICATION_API_KEY: "pjcodeworks123"` (fraca) em `docker-compose.yml:34`
- `OPERATOR_WHATSAPP` (PII) em claro

**Ação:** rotar as chaves hoje, mover para `.env` real (não comitado), criar `.env.example` sem valores, validar no boot com `zod`.

### 2. Debounce em memória (`index.js:196`)
`Map` em processo. Se o container morrer, respostas pendentes somem sem alerta.
**Ação:** persistir em Redis (já está no compose) com TTL e retry na inicialização.

### 3. Webhook responde 202 OK antes de processar (`index.js:2515`)
Se a geração falha depois, Evolution acha que foi sucesso — sem retry.
**Ação:** cron a cada 5 min que reenfileira conversas com `ultima_falha_resposta_em IS NOT NULL`, com backoff exponencial e teto de tentativas.

### 4. Dashboard sem autenticação uniforme
`REPROCESS_SECRET` é **opcional**. Se não definido, qualquer um lista conversas, perfis e scores.
**Ação:** tornar o secret obrigatório no boot, trocar `sessionStorage` por cookie httpOnly, adicionar CORS restrito.

### 5. Sem testes
`package.json` tem o placeholder padrão. Parsers do JSON do Claude (`index.js:1360-1463`) são frágeis — uma mudança de prompt quebra em produção silenciosamente.
**Ação:** começar por 3 testes unitários que já pagam o investimento: `normalizarNumeroParaJid`, `parsearRespostaJsonClaude`, `calcularPreco`.

---

## Débitos de arquitetura (P1)

### Decomposição sugerida do monolito

```
src/
├── routes/       webhook.js, dashboard.js, cron.js
├── services/     claude.js, evolution.js, vendas.js
├── db/           conversas.js, profiles.js, migrations/
├── middleware/   auth.js, ratelimit.js, logger.js
├── utils/        phone.js, format.js, prompts.js
├── config/       env.js (valida com zod, falha rápido)
└── index.js      apenas bootstrap + listen
```

**Benefícios:** testes unitários nos `services/` e `utils/`, reuso entre webhook e dashboard, mudanças em prompt não exigem tocar no pipeline de BD, e cada módulo cabe na cabeça.

### Outros débitos
- Prompts sem versionamento: mudança em `system.md` afeta todas as conversas ativas; sem log de qual versão gerou qual resposta.
- Sem migrations: `sql/init.sql` inline, sem `schema_version`.
- Histórico JSONB sem timestamp por mensagem — inviabiliza SLAs e cálculo de "última resposta há quanto tempo" (crítico para followup automático).
- Debounce não é idempotente: se Evolution reenvia o webhook, a resposta é gerada N vezes em paralelo.

---

## Qualidade de código

**Pontos fortes**
- Normalização consistente para JID.
- Tratamento de erro granular (timeout vs parse vs Evolution fail, `index.js:560-619`).
- Prompts bem estruturados, separados por função (vendas / followup / coach / empresa).
- Motor de preço em funções puras, fora do prompt — previsível e testável.

**Pontos fracos**
- Funções longas (`chamarClaude` ~80 linhas; `gerarEEnviarRespostaWhatsapp` ~200).
- Zero validação de schema — tudo é `typeof x === 'string'`. Adotar `zod` remove classes inteiras de bug.
- Duplicação entre `enviarMensagem` e `enviarComBotoes`.
- Operações independentes sequenciadas onde `Promise.all` resolveria (`index.js:2560-2561`).
- `console.log` com emoji em vez de logs estruturados JSON (torna busca/alertas inviável em produção).

---

## Gaps específicos de um agente 24/7 de vendas

| Aspecto | Status | Gap |
|---|---|---|
| Retry automático | ❌ | Implementar cron + backoff |
| Dedup de webhook | ❌ | Hash determinístico em Redis |
| Graceful shutdown | ❌ | SIGTERM → drenar debounces e pool |
| Health check HTTP | ❌ | `GET /health` com ping Postgres/Redis/Evolution |
| Logs estruturados | ❌ | JSON com `request_id`, `conversa_id`, `duration_ms` |
| Métricas | ❌ | Prometheus: `webhooks_total`, `claude_latency_ms`, `tokens_gastos_total`, `handoff_total` |
| Caching de prompt | ❌ | Ativar `prompt caching` do Claude reduz 50-70% do custo em conversas longas |
| A/B de prompts | ❌ | Sem forma de testar variações sem derrubar produção |
| Evals | ❌ | 10-20 conversas fixas + asserts no JSON como CI check |
| Backup Postgres | ❌ | `pg_dump` diário para storage externo |

**Custo estimado hoje:** ~1M tokens/dia a Sonnet 4.6 ≈ R$ 5-10/dia. Com prompt caching e redução do `max_tokens` para 1024 (suficiente em 90% dos turnos), cai ~40%.

---

## Roadmap priorizado

### P0 — Fazer já (~7h, bloqueadores de produção segura)
1. Rotar secrets, mover para `.env`, criar `.env.example`, validar no boot — 1h
2. Persistir debounce em Redis com retry — 2h
3. Autenticação uniforme do dashboard (cookie httpOnly + secret obrigatório) — 3h
4. Rate limiting: `POST /webhook` 1 msg/s por número; `/dashboard/*` 10 req/min por IP — 1h

### P1 — Próximas 2 semanas (~33h)
1. Modularizar `index.js` em `src/` — 16h
2. Testes unitários críticos (parser, phone, preço) + 2 testes de integração no webhook — 8h
3. Graceful shutdown + `GET /health` — 2h
4. Logs estruturados (JSON com `request_id`) — 3h
5. Cron de retry de respostas falhadas — 4h

### P2 — Médio prazo (~35h)
1. Migrations versionadas + `schema_version` — 4h
2. Timestamps por mensagem no histórico — 6h
3. Dedup idempotente de webhook — 3h
4. Cron de followup automático (já tem as colunas previstas) — 8h
5. Auditoria das ações do dashboard (quem pausou, quem marcou venda) — 4h
6. Métricas Prometheus + endpoint `/metrics` — 4h
7. Evals de prompt como CI check — 6h

### Ganhos rápidos de custo (qualquer momento)
- Ativar prompt caching no Claude.
- Reduzir `max_tokens` para 1024 com fallback a 2048 quando necessário.
- Remover Redis do compose **ou** implementar os 3 usos que justificam (debounce, dedup, rate limit).

---

## Referências (arquivo:linha)

| Item | Local |
|---|---|
| Secrets hardcoded | `docker-compose.yml:34,48`; `.env:4` |
| Debounce em memória | `index.js:196`, `200-286` |
| Webhook 202 OK imediato | `index.js:2514-2598` |
| Parser frágil do Claude | `index.js:1360-1463`, `1051-1068` |
| Dashboard auth condicional | `index.js:1802-1806`, `2840-2841` |
| Motor de preço | `index.js:427-486` |
| Carregamento de prompts | `index.js:95-154` |
| Schema | `sql/init.sql:1-102` |
| Prompt sistema | `prompts/system.md:1-181` |
| Sem testes | `package.json:7` |
