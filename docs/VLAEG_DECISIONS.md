# VLAEG Decisions — Decisões Arquiteturais

---

## [2026-05-13] Multiempresa via empresa_id (não schemas separados)

**Decisão:** Usar coluna `empresa_id` em todas as tabelas de dados, sem criar schemas PostgreSQL separados por empresa.

**Motivo:** Escalabilidade operacional — criar um schema por empresa seria complexo de migrar e manter. Com `empresa_id` temos isolamento por aplicação, queries simples e facilidade de relatórios cross-empresa para o admin.

**Alternativas descartadas:**
- Schema por empresa: mais isolamento, mas operação complexa
- Banco separado por empresa: custo alto, Railway não escala bem assim

**Impacto:** Toda query de dados precisa de `WHERE empresa_id = $n`. Middleware de auth injetará `empresa_id` no request.

**Risco:** Vazamento de dados se query esquecer o filtro. Mitigação: middleware centralizado + review manual de queries.

**Status:** Decidido ✅

---

## [2026-05-13] OpenAI como provider principal no SaaS

**Decisão:** OpenAI GPT-4o como provider principal para todas as empresas. Anthropic como fallback/alternativo configurável.

**Motivo:** OpenAI tem API mais estável para multiempresa, documentação melhor, e mais familiaridade do mercado. Anthropic continua como opção premium.

**Alternativas descartadas:** Anthropic como principal — decisão difícil de reverter sem impacto nos prompts.

**Impacto:** Camada `ai-provider.js` será atualizada para suportar OpenAI como default com Anthropic como fallback.

**Risco:** Custo por empresa precisa de monitoramento. Mitigation: `ai_logs` já existe, adicionar agrupamento por `empresa_id`.

**Status:** Decidido ✅

---

## [2026-05-13] Contexto 2 — IA gera plano estruturado editável

**Decisão:** Empresas inserem contexto bruto (texto livre). IA gera "Contexto 2" — um JSON estruturado com persona, tom, funil, objeções, cases, etc. — que o usuário pode editar e ativar.

**Motivo:** Reduz atrito no onboarding. Empresa não precisa saber montar um prompt — só descreve o negócio.

**Alternativas descartadas:** Editor de prompt raw — muito técnico para não-devs.

**Impacto:** Nova tabela `contextos_empresa` com versioning. Nova rota `POST /api/empresas/:id/contextos/:id/gerar-plano`.

**Risco:** IA pode gerar contexto inadequado. Mitigação: revisão humana obrigatória antes de ativar.

**Status:** Decidido ✅

---

## [2026-05-13] Frontend em Next.js App Router na Vercel

**Decisão:** Criar `apps/web/` com Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui.

**Motivo:** Vercel + Next.js = melhor DX para deploy de frontend. App Router permite Server Components para rotas protegidas. shadcn/ui acelera UI premium.

**Alternativas descartadas:**
- Manter HTML/JS estático: não escala para SaaS com auth
- Vite + React: mais configuração, sem SSR nativo

**Impacto:** Novo diretório `apps/web/`. Backend em `apps/api/` (atual `src/`).

**Status:** Decidido ✅

---

## [2026-05-13] PJ Codeworks como empresa seed/default

**Decisão:** PJ Codeworks é criada no seed do banco como empresa padrão com `slug: pj-codeworks`. Todos os dados atuais serão migrados com `empresa_id = 1`.

**Motivo:** Compatibilidade retroativa. Sistema atual continua funcionando durante a transição.

**Status:** Decidido ✅

---

## [2026-05-13] WhatsApp: uma instância Evolution por empresa

**Decisão:** Cada empresa configura sua própria instância na Evolution API. Evolution API centralizada (compartilhada), instâncias separadas.

**Motivo:** Isolamento de WhatsApp entre empresas. Evolution API suporta múltiplas instâncias em uma instalação.

**Alternativas descartadas:** Evolution API por empresa — custo de infra muito alto.

**Impacto:** Nova tabela `empresa_whatsapp` com `instance_name`, `status`, `qr_code`.

**Status:** Decidido ✅

---

## [2026-05-13] Auth via JWT (novo SaaS)

**Decisão:** Substituir auth de sessão do dashboard por JWT para o novo SaaS. JWT no header `Authorization: Bearer <token>`.

**Motivo:** SaaS multiempresa precisa de auth stateless. JWT facilita integração com Vercel (client-side) + Railway (API).

**Impacto:** Novo módulo `src/auth.js`. Endpoints `/api/auth/login`, `/api/auth/logout`, `/api/auth/refresh`.

**Status:** Decidido ✅

---

## [2026-06-19] Auditoria "corrigir o seguro" + split físico planejado

**Decisão:** No ciclo de auditoria, aplicar SÓ correções sem mudança de comportamento (logger, código morto, duplicação), validando com `npm test`. Não fazer hardening agressivo nem refactor grande no mesmo ciclo.

**Motivo:** Reduzir risco em sistema de produção (AGENTS.md: estabilidade > velocidade; diff mínimo; não misturar refactor grande com mudança).

**Impacto:** `whatsapp-routes.js` e `ai-structured-analysis.js` passam a usar `logger.js`; `next.config.ts` morto removido.

**Decisão estrutural pendente:** split físico `backend/` + `frontend/`. Aprovado pelo usuário, MAS como slice isolado com checkpoint — exige reconfigurar **Railway** (root/Dockerfile) e **Vercel** (root dir) nos painéis (ação do usuário), senão o deploy quebra.

**Status:** Auditoria/correções ✅ · Split físico ⬜ (checkpoint)

---

## [2026-06-18→19] Fusão Empresa + Contextos → página "Empresas"

**Decisão:** Unificar `/dashboard/empresa` e `/dashboard/contextos` numa página "Empresas" (Hero = Agente + Instâncias WhatsApp; abaixo = Contextos em cards com estágios por contexto). Remover abas "Contextos/PJ Codeworks"; prompts da PJ viram base genérica + "Importar da PJ".

**Motivo:** Pedido do usuário; backend de estágios por contexto já existia (gerar/adaptar/importar/ativar).

**Impacto:** `apps/web` (Sidebar, contextos/page, empresa→redirect, novo `InstanciasWhatsApp.tsx`); backend aditivo (`estagios/gerar` e `/adaptar` aceitam `{ etapa }`).

**Status:** Implementado ✅ (693 testes + typechecks)
