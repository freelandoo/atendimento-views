# Implementation Slices — PJ Codeworks → SaaS Multiempresa

## Mapa do Projeto (estado atual)

```
index.js                    ← Entry point, valida env, inicia banco, registra rotas
src/
  agent.js                  ← NÚCLEO (2000+ linhas): funil, Claude, jobs, silêncio
  webhook-handler.js        ← Recebe eventos Evolution API, enfileira jobs
  core-funnel.js            ← Máquina de estados: primeiro_contato → fechamento
  db.js                     ← Pool PostgreSQL, DDL de todas as tabelas (schema vendas)
  db-crud.js                ← CRUD estruturado com validação
  routes.js                 ← Agrega rotas dos módulos
  prompts.js                ← Carrega todos os prompts em memória no boot
  ai-provider.js            ← Abstração Anthropic/OpenAI com cache 30s
  ai-routes.js              ← GET/POST /dashboard/ai/*
  whatsapp.js               ← Evolution API: envio, download, botões
  pricing.js                ← Motor de preço determinístico
  prospecting.js            ← Google Places + disparo automático
  agenda.js                 ← Slots de reunião + lembretes
  followup-auto.js          ← Follow-up automático por sequência
  followup-execution.js     ← Follow-up manual via dashboard
  learning.js               ← Auto-aprendizado pós-conversa
  handoff-alerts.js         ← Alertas de handoff para operador
  operator-commands.js      ← Comandos operador via WhatsApp
  media-processing.js       ← Transcrição áudio + análise imagem
  preview-site.js           ← Preview de site em SVG/HTML
  dashboardAuth.js          ← Login/session/CSRF do dashboard atual
  config.js                 ← Constantes e env vars centralizados
  logger.js                 ← Pino com redaction de secrets
  date-utils.js             ← Timezone Brasil centralizado
  string-utils.js           ← Parsing JSON Claude, normalização
  institutional-language.js ← Sanitização de termos internos
  domainSchemas.js          ← Validação de schemas
  project-handoff-build.js  ← Compilação de handoff
  project-handoff-docx.js   ← Geração DOCX
  project-handoff-types.ts  ← Tipos TypeScript

prompts/                    ← Templates por etapa do funil
knowledge/cases.json        ← 7 cases de referência (PJ Codeworks)
public/                     ← Dashboard HTML/JS estático atual
sql/init.sql                ← DDL original PostgreSQL
docker-compose.yml          ← postgres + redis + evolution + whisper + backend
dockerfile                  ← Build Node.js (lowercase → renomear para Dockerfile)
.env.example                ← Template de variáveis
```

---

## Banco de Dados Atual

Schema `vendas`:
- `conversas` — registro por número WhatsApp
- `lead_profiles` — perfil enriquecido por número
- `aprendizado` — notas de vendas fechadas
- `conhecimento_lacunas` — gaps de conhecimento
- `analises_pos_conversa` — feedback pós-conversa
- `funil_prompt_versions` — versionamento de prompts
- `funil_diagnosticos` — diagnósticos de funil
- `prompt_overlays` — override de prompts
- `prompt_aprendizados` — rules aprendidas
- `followup_envios` — histórico de follow-up
- `webhook_messages_processed` — idempotência
- `dashboard_users` — usuários do dashboard
- `ai_settings` — config de provider IA
- `ai_logs` — logs de chamadas IA

Schema `prospectador`:
- `prospects`
- `diagnosticos`

---

## Riscos Identificados

| Risco | Severidade | Mitigação |
|-------|-----------|-----------|
| Migration sem rollback destrói dados | CRÍTICO | Sempre `ALTER TABLE ADD COLUMN` — nunca `DROP`. Backup antes de executar. |
| ANTHROPIC_KEY obrigatória no boot atual | ALTO | Tornar opcional após adicionar OPENAI_API_KEY no Slice 5 |
| Webhook não resolve empresa (monousuário) | ALTO | Slice 3: resolver empresa por evolution_instance |
| Queries sem empresa_id retornam dados de todos | ALTO | Slice 3: middleware injeta empresa_id, Slice 4: auditoria de queries |
| Dockerfile com nome minúsculo | MÉDIO | Slice 1: renomear via git mv |
| Sem CORS configurado | MÉDIO | Slice 1: adicionar cors middleware |
| Sem /health endpoint | MÉDIO | Slice 1: adicionar |
| Prompts fixos da PJ Codeworks no código | MÉDIO | Slice 7: carregar por empresa_id, com fallback para prompts padrão |
| sem script start no package.json | BAIXO | Slice 1: adicionar |
| Secret hardcoded no código | BAIXO | Auditoria confirmou: não há. |

---

## Decisões Técnicas

### Schema de Banco
- Novo schema `app.` para tabelas SaaS (sem misturar com `vendas` atual)
- Tabelas `vendas.*` recebem coluna `empresa_id` via `ALTER TABLE ADD COLUMN`
- Empresa padrão = PJ Codeworks, todos os registros antigos associados a ela
- UUID como PK nas novas tabelas
- NUNCA dropar tabelas existentes

### Auth
- JWT para as novas rotas `/api/*`
- Session do dashboard atual (`dashboardAuth.js`) mantida e compatível
- Admin inicial via env: ADMIN_EMAIL + ADMIN_PASSWORD
- Middleware: requireAuth → getCurrentUser → getActiveEmpresaId → requireEmpresaAccess

### Provider IA
- OpenAI como principal (OPENAI_API_KEY, OPENAI_MODEL)
- Anthropic como fallback/alternativo
- ANTHROPIC_KEY ainda suportada, mas não mais obrigatória no boot
- ai-provider.js refatorado para suportar ambos via config por empresa

### Frontend
- Manter dashboard atual em `public/` (sem quebrar)
- Novo frontend SaaS em `apps/web/` (Next.js App Router)
- Deploy: backend Railway, frontend Vercel
- API base via NEXT_PUBLIC_API_URL

### Isolamento
- Toda query de dados usa `WHERE empresa_id = $n`
- Webhook resolve empresa por `evolution_instance` → `app.empresa_whatsapp_instances`
- Fallback: PJ Codeworks (com warning em log)
- Middleware `resolveEmpresaFromRequest` centraliza a lógica

---

## Sequência de Implementação

### ✅ Slice 0 — Auditoria
**Status:** Concluído
**Entregável:** Este documento + CLAUDE.md + VLAEG docs

---

### 🔄 Slice 1 — Higiene de Deploy
**Status:** Em andamento
**Objetivo:** Projeto deployável no Railway sem quebrar nada

Mudanças:
- `package.json`: adicionar script `start`
- `package.json`: adicionar dependência `cors`
- `Dockerfile`: renomear de `dockerfile` (lowercase) → `Dockerfile`
- `index.js`: CORS configurável + endpoint `/health`
- `.env.example`: adicionar todas as novas vars
- `.env.production.example`: criar
- `docs/IMPLEMENTATION_SLICES.md`: este arquivo

Validação:
- `npm test` passa
- servidor inicia localmente
- `GET /health` retorna 200

Risco: nenhum. Mudanças aditivas.

---

### ⬜ Slice 2 — Banco Multiempresa
**Status:** Pendente
**Objetivo:** Schema `app.*` + empresa_id nas tabelas existentes

Migrations (em ordem):
1. `CREATE SCHEMA IF NOT EXISTS app`
2. `CREATE TABLE app.usuarios`
3. `CREATE TABLE app.empresas`
4. `CREATE TABLE app.usuarios_empresas`
5. `CREATE TABLE app.empresa_contextos`
6. `CREATE TABLE app.empresa_contexto_versoes`
7. `CREATE TABLE app.empresa_fluxos`
8. `CREATE TABLE app.empresa_whatsapp_instances`
9. `CREATE TABLE app.conversa_resumos`
10. `CREATE TABLE app.lead_insights`
11. `ALTER TABLE vendas.conversas ADD COLUMN empresa_id UUID`
12. `ALTER TABLE vendas.lead_profiles ADD COLUMN empresa_id UUID`
13. `ALTER TABLE vendas.followup_envios ADD COLUMN empresa_id UUID`
14. `ALTER TABLE vendas.analises_pos_conversa ADD COLUMN empresa_id UUID`
15. `ALTER TABLE vendas.ai_logs ADD COLUMN empresa_id UUID`
16. `INSERT INTO app.empresas (nome, slug) VALUES ('PJ Codeworks', 'pj-codeworks')`
17. `UPDATE vendas.conversas SET empresa_id = (SELECT id FROM app.empresas WHERE slug='pj-codeworks') WHERE empresa_id IS NULL`
18. (idem para outras tabelas)
19. Criar índices empresa_id

Validação:
- Migration executa sem erros
- Dados existentes preservados
- Empresa padrão criada
- Registros associados

---

### ⬜ Slice 3 — Auth e Tenant Isolation
**Status:** Pendente
**Objetivo:** JWT, usuário admin, middleware de isolamento

Arquivos novos:
- `src/auth.js` — JWT sign/verify, hash senha
- `src/middleware/tenant.js` — resolveEmpresa, requireEmpresaAccess
- `src/db/usuarios.js` — CRUD de usuários
- `src/db/empresas.js` — CRUD de empresas

Arquivos modificados:
- `index.js` — registrar middlewares JWT
- `src/webhook-handler.js` — resolver empresa por instance

Validação:
- Login retorna JWT
- Rota sem JWT retorna 401
- Rota com JWT de empresa A não acessa empresa B
- Webhook resolve empresa correta

---

### ⬜ Slice 4 — APIs REST
**Status:** Pendente
**Objetivo:** Todos os endpoints de empresas, contextos, WhatsApp

Arquivos novos:
- `src/routes/api-empresas.js`
- `src/routes/api-contextos.js`
- `src/routes/api-whatsapp.js`
- `src/routes/api-conversas.js`
- `src/routes/api-relatorios.js`
- `src/routes/api-auth.js`

Todos retornam: `{ ok: true, data }` ou `{ ok: false, error: { code, message } }`

Validação:
- Todos os endpoints testáveis via curl/Postman
- Sem cross-tenant leakage

---

### ⬜ Slice 5 — Provider OpenAI
**Status:** Pendente
**Objetivo:** OpenAI como principal, funções de IA limpas

Arquivo: `src/ai-provider.js` (refatorar existente)

Funções:
- `generateContextPlan`
- `extractLeadData`
- `generateAgentReply`
- `summarizeConversation`
- `generateReport`

Validação:
- Mock em test passa sem chamada real
- OPENAI_API_KEY e ANTHROPIC_KEY ambas suportadas

---

### ⬜ Slice 6 — Gerador de Contexto 2
**Status:** Pendente
**Objetivo:** Usuário insere Contexto 1, IA gera Contexto 2 JSON editável

Schema JSON do Contexto 2 documentado neste arquivo.

Validação:
- POST /api/empresas/:id/contextos/:cId/gerar-plano retorna JSON válido
- Versão salva como rascunho (não ativada)
- Só uma versão ativa por empresa

---

### ⬜ Slice 7 — Agente com Contexto Dinâmico
**Status:** Pendente
**Objetivo:** Agente usa contexto ativo da empresa + extrai dados mesmo incompletos

Arquivos modificados:
- `src/agent.js` — usar contexto por empresa_id
- `src/prompts.js` — suportar override por empresa

Regra: respostas incompletas devem ser aproveitadas.
Exemplo: "Barbearia no Rudge" → extrair negócio + localização + listar campos faltantes.

---

### ⬜ Slice 8 — Memória e Relatórios
**Status:** Pendente

Arquivos novos:
- `src/services/resumo-conversa.js`
- `src/services/relatorio.js`

---

### ⬜ Slice 9 — WhatsApp por Empresa
**Status:** Pendente

Arquivos novos:
- `src/db/whatsapp-instances.js`

Modificados:
- `src/webhook-handler.js` — resolver empresa por instance

---

### ⬜ Slice 10 — Frontend Next.js
**Status:** Pendente

Diretório: `apps/web/`
Stack: Next.js App Router + TypeScript + Tailwind + shadcn/ui

---

### ⬜ Slice 11 — Testes e Segurança
**Status:** Pendente

Testes de isolamento cross-tenant obrigatórios.

---

### ⬜ Slice 12 — Deploy Railway + Vercel + Docs Finais
**Status:** Pendente

---

## Schema JSON do Contexto 2

```json
{
  "empresa": { "nome": "", "nicho": "", "cidade": "", "resumo": "" },
  "oferta": {
    "principal": "",
    "produtos_servicos": [],
    "diferenciais": [],
    "precos": [],
    "restricoes": []
  },
  "publico_alvo": {
    "cliente_ideal": "",
    "segmentos": [],
    "nao_ideal": []
  },
  "tom_de_voz": {
    "estilo": "",
    "palavras_preferidas": [],
    "palavras_evitar": []
  },
  "diagnostico": {
    "campos_obrigatorios": [],
    "campos_opcionais": [],
    "perguntas": [],
    "como_lidar_com_respostas_incompletas": []
  },
  "objecoes": [
    {
      "objecao": "",
      "intencao_por_tras": "",
      "resposta_recomendada": "",
      "quando_chamar_humano": false
    }
  ],
  "lead_scoring": { "quente": [], "morno": [], "frio": [] },
  "handoff": {
    "quando_chamar_humano": [],
    "mensagem_para_operador": ""
  },
  "regras_preco": {
    "quando_enviar_preco": [],
    "quando_nao_enviar_preco": [],
    "politica_de_desconto": ""
  },
  "fluxo": [
    {
      "etapa": "",
      "objetivo": "",
      "perguntas_sugeridas": [],
      "dados_para_coletar": [],
      "criterio_para_avancar": ""
    }
  ],
  "followup": [],
  "limites": [],
  "exemplos_de_abordagem": []
}
```
