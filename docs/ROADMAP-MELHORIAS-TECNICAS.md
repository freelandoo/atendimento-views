# Roadmap de melhorias técnicas — PJ Codeworks Agent

Documento de referência (não é estado implementado). Última revisão alinhada ao repositório: agente WhatsApp (Evolution + webhook), PostgreSQL (`vendas`), Claude, dashboard estático.

## Contexto atual

- Núcleo concentrado em `index.js` (monólito grande).
- `README.md` descreve follow-up manual e desenho futuro de cron.
- `package.json` não define suíte de testes real (`npm test` é placeholder).
- Autenticação do dashboard é **híbrida**: alguns GETs são públicos na URL; outros exigem `x-reprocess-secret` quando `REPROCESS_SECRET` está definido.

---

## 1. Segurança e exposição

| Melhoria | Motivo |
|----------|--------|
| Autenticação **uniforme** no dashboard (todos os GETs sensíveis com o mesmo critério) | Hoje `GET /dashboard/data` pode expor lista se a URL for acessível; detalhe/perfil/coach seguem outra regra. |
| Sessão com **httpOnly cookie** ou login mínimo no servidor | `sessionStorage` com segredo é prático mas vulnerável a XSS em cenários mais hostis. |
| **Rate limiting** em rotas caras (Anthropic: `lead-coach`, follow-up, reprocessar) | Reduz abuso e custo de API. |
| Revisar **CORS** e cabeçalhos de segurança | Necessário se o dashboard for servido de outro domínio. |

---

## 2. Arquitetura e manutenção

| Melhoria | Motivo |
|----------|--------|
| Particionar `index.js` em módulos (`routes/dashboard.js`, `routes/webhook.js`, `services/claude.js`, `db/conversas.js`, …) | Facilita testes, code review e onboarding. |
| JSDoc mais estrito ou pasta `server/` em TypeScript gradual | Contratos explícitos reduzem regressões. |
| Objeto `config` no boot com validação de `process.env` (ex.: `zod` ou validação manual) | Falha rápida em deploy com env incompleto. |

---

## 3. Qualidade e regressão

| Melhoria | Motivo |
|----------|--------|
| Testes de integração com `supertest` nas rotas `/dashboard/*` (401/403 com secret, fluxos 200) | Reduz regressão em auth e payloads. |
| Testes unitários em funções puras: `normalizarNumeroParaJid`, `sanitizarHistoricoParaRespostaDashboard`, `parsearRespostaJsonClaude` | Alto retorno, baixo custo. |
| CI (GitHub Actions): `npm test` + ESLint em PRs | Disciplina de merge. |

---

## 4. Observabilidade e operação

| Melhoria | Motivo |
|----------|--------|
| Logging estruturado (JSON) com `request_id`, telefone mascarado, latência Evolution/Anthropic | Debug em produção e suporte. |
| Métricas (ex.: Prometheus): webhooks, 5xx, tempo de query no pool | Capacidade e alertas. |
| `GET /health` com ping ao Postgres | Orquestração Docker/Kubernetes. |

---

## 5. Produto e dados

| Melhoria | Motivo |
|----------|--------|
| Cron de follow-up (`silencio_inicio_em`, `followup_nivel`, `POST /cron/followups`) conforme `README.md` | Automação comercial sem depender só de ações manuais. |
| Tabela de **auditoria** (`vendas.conversa_auditoria` ou similar) para `PATCH /dashboard/conversa-meta`, pausa de agente, etc. | Rastreabilidade e disputas (“quem marcou venda?”). |
| Timestamps por mensagem no `historico` (evolução de schema) | Relatórios e SLAs mais precisos. |

---

## 6. UX técnica do dashboard (cruza com roadmap UX)

| Melhoria | Motivo |
|----------|--------|
| Toasts em vez de `alert()` | Menos intrusivo; ver também `docs/ROADMAP-MELHORIAS-UX-FUNCIONALIDADES.md`. |
| Acessibilidade (foco no modal, `aria-*`, contraste) | Inclusão e uso com teclado. |
| i18n (arquivo de strings) | Segundo idioma sem espalhar literais no HTML/JS. |

---

## 7. Infra e deploy

| Melhoria | Motivo |
|----------|--------|
| Docker multi-stage, usuário não-root, `.dockerignore` | Imagem menor e mais segura. |
| `.env.example` documentado (sem segredos), alinhado ao `docker-compose.yml` | Onboarding e menos erros de configuração. |

---

## 8. Modelo e prompts

| Melhoria | Motivo |
|----------|--------|
| Evals com conversas fixas + asserts no JSON de saída | Regressão de comportamento do modelo. |
| Logar **versão/hash** do prompt em uso quando houver divergência (ex.: venda vs reunião) | Correlação com `prompts/system.md` e tuning. |

---

## Priorização sugerida

1. Segurança do dashboard + rate limit nas rotas caras.  
2. Modularizar `index.js` + testes nos helpers críticos.  
3. Observabilidade mínima (`/health` + logs estruturados).  
4. Cron de follow-up e auditoria conforme prioridade de negócio.

---

## Referências no repositório

- `index.js` — API e webhook.  
- `README.md` — follow-up e visão de cron.  
- `docker-compose.yml` / `dockerfile` — deploy.  
- `dashboard/js/*.js`, `dashboard/css/dashboard.css` — front.  
- `prompts/*.md` — comportamento do agente.
