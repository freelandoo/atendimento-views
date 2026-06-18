# Architecture Rules

Lei técnica do projeto. Backend Node.js/Express (JavaScript) + PostgreSQL +
integrações (Anthropic, WhatsApp/Evolution, Agenda) + dashboard estático.

## Regra 1 — Separação de responsabilidades
- **Rotas/entrada HTTP**: `index.js`, `src/routes.js`, `src/*-routes.js`,
  `src/webhook-handler.js`. Sem regra de negócio pesada.
- **Regra de negócio / orquestração**: `src/agent*.js`, `src/*-orchestrator.js`,
  `src/core-funnel.js`, `src/conversation-pipeline.js`.
- **Serviços de prospecção**: `src/services/*`.
- **Acesso a banco**: isolado em `src/db.js` / `src/db-crud.js`.
- **Integrações externas**: `src/ai-provider.js`, `src/whatsapp.js`, `src/agenda.js`.
- **Validação/schemas**: `src/domainSchemas.js`, `src/*-validator.js`.
- **Helpers genéricos**: `src/string-utils.js`, `src/date-utils.js`.
- **UI**: `public/` (estático) — apenas apresentação.

Um módulo não deve concentrar roteamento + regra de negócio + acesso a banco +
integração externa ao mesmo tempo.

## Regra 2 — Não duplicar lógica
Antes de criar função, rota, serviço ou módulo novo, procure equivalente.
Se existir: **reutilize**, **refatore**, ou **explique por que precisa de uma nova versão**.

## Regra 3 — Rotas / endpoints
Toda rota deve ter:
- validação de entrada (use `src/domainSchemas.js` / validadores existentes);
- tratamento de erro;
- resposta padronizada;
- autenticação/autorização quando necessário (`src/dashboardAuth.js`, segredos de admin);
- logs seguros (via `src/logger.js`), sem dados sensíveis;
- nenhum segredo/PII exposto na resposta.

## Regra 4 — Banco de dados
Alterações no banco exigem:
- explicação do impacto;
- plano de migração (`sql/`), compatível com dados existentes;
- compatibilidade com `src/db.js` (init/fallback inline);
- validação de permissões/ownership do recurso;
- plano de rollback quando necessário.

## Regra 5 — Prompts e comportamento do agente (LLM)
- `prompts/*.md` e `knowledge/*.json` afetam **produção diretamente**.
- Não alterar tom, regras de funil ou conhecimento autorizado sem justificar impacto.
- Mudança de regra coberta por teste exige atualizar `test/`.

## Regra 6 — Dashboard estático (`public/`)
Toda tela deve ter:
- estado de carregando, vazio e erro;
- feedback claro para a ação do operador;
- padrão visual consistente com `public/dashboard/css/*`.
- **Nenhuma** lógica crítica ou segredo no cliente — isso vive no backend.

## Regra 7 — Performance
Evite:
- fetch/consulta duplicada;
- consulta sem paginação/limite;
- processamento pesado desnecessário por requisição;
- jobs de prospecção que ignoram limites/cota configurados.

## Regra 8 — Segurança
Nunca confiar somente no frontend. Valide no backend:
- permissões e ownership do recurso;
- dados de entrada;
- segredos de webhook/admin (`REPROCESS_SECRET`, `WEBHOOK_SECRET`);
- tokens e ações administrativas.
Nunca registrar chaves, tokens ou PII em logs.

## Regra 9 — Disciplina de mudança
- Diff mínimo, sem refatoração colateral.
- Não misturar refatoração grande com feature nova.
- Preservar contratos públicos de rotas e payloads.
- Variável de ambiente nova só com documentação (`AGENTS.md` + `.env.example`).
