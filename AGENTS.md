# Guia Operacional do Agente (Cursor + Claude)

## Objetivo deste repositório
- Backend Node.js (Express) para atendimento e vendas via WhatsApp.
- Integra com PostgreSQL (`vendas` e `prospectador`) e Anthropic.
- Possui dashboard estático para operação comercial e prospecção.

## Fluxo técnico principal
1. `index.js` inicia servidor, valida variáveis obrigatórias e registra rotas.
2. `src/routes.js` conecta os módulos HTTP.
3. `src/agent.js` concentra lógica de conversa, funil e integração LLM.
4. `src/prospecting.js` cobre endpoints e jobs de prospecção.
5. `src/db.js` inicializa/migra banco via `sql/init.sql` (com fallback inline).

## Arquivos-chave para contexto de IA
- `prompts/system.md`: regra principal do agente comercial.
- `prompts/empresa.md`: conhecimento autorizado e links permitidos.
- `src/agent.js`: regras de execução e parsing das respostas LLM.
- `src/prospecting.js`: automações de busca, diagnóstico e disparo.
- `test/core.test.js`: cobertura base de regras de negócio.

## Como executar e validar
- Instalar dependências: `npm install`
- Rodar testes: `npm test`
- Smoke de precificação: `npm run smoke:preco`
- Iniciar serviço: `node index.js`

## Variáveis de ambiente mínimas
- `ANTHROPIC_KEY`: obrigatória para respostas do agente.
- `REPROCESS_SECRET`: obrigatória para rotas administrativas protegidas.
- `WEBHOOK_SECRET`: opcional; se definida, `POST /webhook` também aceita `x-webhook-secret` ou `Authorization: Bearer <valor>` (além de `x-reprocess-secret`).
- `DATABASE_URL`: opcional (há default local no código).
- `PORT`: opcional (default `3000`).

## Disciplina de mudança (obrigatória)
- Fazer diff mínimo, sem refatoração colateral.
- Preservar contratos públicos de rotas e payloads.
- Não alterar prompts de produção sem justificar impacto.
- Não remover proteções de segurança das rotas internas.
- Ao tocar regra de negócio, atualizar/ajustar teste em `test/core.test.js`.

## Estratégia de trabalho para o Claude
1. Ler o objetivo do pedido e localizar arquivos de menor impacto.
2. Implementar somente o necessário para fechar o aceite.
3. Executar `npm test` após mudanças de regra.
4. Reportar riscos remanescentes de forma objetiva.

## Definição de pronto
- Funcionalidade solicitada implementada com escopo controlado.
- Sem regressão em testes existentes.
- Sem alteração acidental em áreas não relacionadas.
