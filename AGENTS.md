# Guia Operacional do Agente (Cursor + Claude)

> Este projeto deve ser tratado como um **sistema em produção**. Nenhum agente deve
> fazer alterações grandes sem entender o impacto no projeto inteiro.

## Prioridades (nesta ordem)
1. estabilidade;
2. segurança;
3. clareza de arquitetura;
4. manutenção de longo prazo;
5. performance;
6. experiência do operador/lead;
7. velocidade de entrega — somente depois dos pontos acima.

## Objetivo deste repositório
- Backend Node.js (Express) para atendimento e vendas via WhatsApp.
- Integra com PostgreSQL (`vendas` e `prospectador`) e Anthropic.
- Possui dashboard estático para operação comercial e prospecção.

## Estrutura física do repositório (split backend/frontend)
- `backend/` — API Node/Express. Contém `index.js`, `src/`, `prompts/`, `knowledge/`,
  `sql/`, `scripts/`, `tools/`, `test/`, `public/` (dashboard estático), `whisper-service/`,
  `package.json`, `Dockerfile`, `tsconfig.json`. **Todos os caminhos `src/…`, `prompts/…`,
  `sql/…` etc. citados neste guia são relativos a `backend/`.** Rode `npm test`/`npm start`
  de dentro de `backend/`.
- `frontend/` — app Next.js (App Router). Deploy Vercel com **Root Directory = `frontend`**.
- Raiz — só governança e orquestração: `AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/`,
  `docker-compose.yml`, `.gitignore`.
- **Deploy:** Railway (serviço `atendimento-views`) com **Root Directory = `backend/`**
  (Dockerfile interno inalterado); Vercel com **Root Directory = `frontend`**.

## Fluxo técnico principal
1. `index.js` inicia servidor, valida variáveis obrigatórias e registra rotas.
2. `src/routes.js` conecta os módulos HTTP.
3. `src/agent.js` concentra lógica de conversa, funil e integração LLM.
4. `src/prospecting.js` + `src/services/*` cobrem endpoints e jobs de prospecção.
5. `src/db.js` inicializa/migra banco via `sql/init.sql` (com fallback inline).

## Arquivos-chave para contexto de IA
- `prompts/system-core.md` e demais `prompts/system-*.md`: regras do agente comercial por etapa.
- `prompts/empresa.md`: conhecimento autorizado e links permitidos.
- `src/agent.js`: regras de execução e parsing das respostas LLM.
- `src/prospecting.js` + `src/services/*`: automações de busca, diagnóstico e disparo.
- `src/db.js` / `sql/init.sql`: schema e migrações.
- `test/core.test.js`: cobertura base de regras de negócio.
- `docs/project-map.md`: mapa de pastas e responsabilidades.
- `docs/architecture-rules.md`: regras técnicas obrigatórias.

## Como executar e validar
- Instalar dependências: `npm install`
- Rodar testes: `npm test`
- Typecheck (há `tsconfig.json` e arquivos `.ts` pontuais): `npm run typecheck`
- Smoke de precificação: `npm run smoke:preco`
- Iniciar serviço: `npm start` (ou `node index.js`)

> Não há `lint` nem `build` configurados no `package.json`. Se uma tarefa exigir
> esses passos, informe que o script precisa ser criado antes — não invente comandos.

## Variáveis de ambiente

### Obrigatórias no boot (validadas em `index.js` → `validarSecretsBoot`; sem elas o processo aborta)
- Ao menos **uma** chave de IA: `ANTHROPIC_KEY`/`ANTHROPIC_API_KEY` **ou** `OPENAI_KEY`/`OPENAI_API_KEY`.
- `EVOLUTION_API_KEY`: integração com a Evolution API (WhatsApp).
- `REPROCESS_SECRET`: mín. 8 chars — protege `/dashboard/*` e `/webhook`.
- `DASHBOARD_ADMIN_EMAIL` e `DASHBOARD_ADMIN_PASSWORD` (mín. 12 chars): primeiro admin do dashboard.

### Opcionais usadas com frequência
- `WEBHOOK_SECRET`: se definida, `POST /webhook` também aceita `x-webhook-secret` ou `Authorization: Bearer <valor>`.
- `DATABASE_URL` (default local no código), `PORT` (default `3000`), `NODE_ENV` (`production` ativa cookie Secure e SSL do banco).
- `AI_PROVIDER` / `AI_MODEL`, `EVOLUTION_URL`, `EVOLUTION_INSTANCE`, `OPERATOR_WHATSAPP`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_CSE_KEY`/`GOOGLE_CSE_ID`.
- `DASHBOARD_URL`: URL base do painel usada no link do alerta de handoff (ex.: `https://app.exemplo.com`). Sem ela, cai para `RAILWAY_PUBLIC_DOMAIN` e, por fim, para o padrão de produção (`https://pjcodeworks-agent-production.up.railway.app`).
- `AI_STRUCTURED_OUTPUTS`: liga/desliga o Structured Outputs (json_schema strict) no caminho OpenAI do agente. Default ligado; `off` volta para `json_object`. Se a API recusar o schema, há fallback automático para `json_object`.
- `AI_REPAIR_MAX_RETRIES`: nº máximo de retries de reparo quando a IA não emite `reuniao_escolha` em turno de agenda (default `1`; `0` desliga). Cada retry é +1 chamada LLM e é logado como `[ai-repair]`.
- `REUNIAO_BUFFER_MIN`: folga em minutos exigida ENTRE reuniões (default `30`; `0` desliga). Reflete em 3 pontos da agenda: oferta de horários (`slotsLivresDoDia`), validação da escolha (`validarSlotReuniao`) e criação do evento (`criarEventoAgenda`, só tipo `reuniao`). A reunião gravada mantém a duração real (15 min); o buffer só afeta o espaçamento.
- Seletor autônomo de mercado por IA na prospecção diária (`selecionarMercadoDiarioIA` em `prospecting.js`): **sempre ligado, sem kill-switch**. A IA recebe o raio-x dos mercados já prospectados e escolhe um `{nicho, cidade}` fresco (gpt-4o-mini); a busca no Places segue programática. **Sem fallback para a rotação antiga**: tem RETRY (`PROSPEC_MERCADO_IA_RETRIES`, default 3); se todas as tentativas falharem, o erro é registrado com `logger.error` no Railway e a rodada do dia é **abortada** (execução marcada `falhou`, não re-tenta a cada tick — re-tenta no dia seguinte).
- `PROSPEC_MERCADO_IA_RETRIES`: nº de tentativas da IA ao escolher o mercado do dia (default `3`).
- Atribuição Meta Ads (CTWA) em `src/services/meta-attribution.js`, chamada a cada ~10 min pelo worker (`sincronizarAtribuicaoMetaAds`): captura de qual anúncio cada lead veio (lê `public."Message".contextInfo.externalAdReply`; telefone real em `key.remoteJidAlt`) → grava `vendas.lead_profiles.origem='meta_ads'` + `origem_anuncio` jsonb `{ad_id, ctwa_clid, title, source_url}`; e recalcula `score_lead` por CRITÉRIOS (determinístico, `calcularScoreLeadDeterministico`) p/ leads ativos. `score_lead >= META_QUALIFIED_LEAD_MIN` (default 60) = "QualifiedLead".
- `META_QUALIFIED_LEAD_MIN`: score mínimo (0-100) p/ um lead virar "qualificado" e disparar `LeadSubmitted` à Meta (default `60`). Reunião agendada também qualifica.
- `META_DATASET_ID` / `META_CAPI_TOKEN`: conjunto de dados + token da Conversions API do Meta (envio de eventos CTWA). Secretos, só no Railway; sem eles o envio fica desligado.
- `META_PAGE_ID` (ou `META_WABA_ID`): ID da Página do Facebook dos anúncios CTWA (ou da conta WhatsApp Business). **Obrigatório p/ a CAPI funcionar** — `action_source=business_messaging` exige `page_id` OU `whatsapp_business_account_id` no `user_data` (senão a Meta rejeita com subcode 2804116). Atenção: CTWA só aceita os eventos `LeadSubmitted` (lead qualificado/com reunião) e `Purchase` (venda) — nomes de pixel (Lead/QualifiedLead/Schedule/MeetingCompleted) são rejeitados (subcode 2804066).

### Captação social (Bright Data — Instagram agora, LinkedIn no mesmo motor)
- `BRIGHTDATA_API_TOKEN`: token da Bright Data Web Scraper / Dataset API. **Sem ele o canal de captação fica desligado** (worker não roda). Mesmo token serve Instagram e LinkedIn.
- `BRIGHTDATA_DATASET_IG_DESCOBERTA` / `BRIGHTDATA_DATASET_IG_PERFIS` / `BRIGHTDATA_DATASET_LI_DESCOBERTA` / `BRIGHTDATA_DATASET_LI_PERFIS`: `dataset_id` de cada coleta (descoberta por hashtag/keyword e perfis por URL). Confirmar no painel Bright Data da conta — o formato de input depende do dataset.
- `BRIGHTDATA_CAPTACAO_TETO_DIARIO`: teto diário de registros consumidos na conta (free tier 5000/mês ≈ 166/dia; default 166).
- `BRIGHTDATA_SEGUIR_LINK_BIO`: `on` faz o extrator seguir o link da bio atrás de email/WhatsApp (gasta mais; default `off`).
- `BRIGHTDATA_TIMEOUT_MS` / `LINK_BIO_TIMEOUT_MS` / `CAPTACAO_WORKER_POLL_MS`: timeouts e intervalo do worker.
- `CAPTACAO_SCHEDULER_INTERVAL_MS` (default `300000`, min `60000`) / `CAPTACAO_SCHEDULER_TZ` (default `America/Sao_Paulo`): agendamento automático de campanhas. Campanha com `ativo=true` + `metadata_json.agendamento_ativo=true` dispara uma nova coleta a cada `intervalo_horas` dentro da janela (`janela_inicio`/`janela_fim`) e `dias_semana` configurados na campanha. Lógica pura em `src/services/captacao-scheduler.js` (`campanhaDevePreencher`); o disparo (`dispararCampanhasAgendadas`) roda no tick do capture worker e reusa `iniciarColeta` (respeita teto diário/orçamento; só inicia a COLETA, a aprovação p/ WhatsApp segue manual).
- `EMAIL_PROVIDER_API_URL` / `EMAIL_PROVIDER_API_KEY` / `EMAIL_FROM`: canal de e-mail para leads sociais (Fase futura). Sem os três, o e-mail fica desativado (registra, não envia). `EMAIL_TIMEOUT_MS` opcional.

> Módulo de captação: rotas em `src/routes/api-captacao.js`; motor em `src/services/social-capture.js`
> (+ `brightdata-client.js`, `social-contact-extract.js`, `email-outreach.js`); schema na
> migration `sql/migrations/012_captacao_social.sql` (generaliza `prospectador.prospects` por
> `origem+external_ref`, sem job_queue — usa `captacao_snapshots` como fila assíncrona). Frontend:
> `frontend/app/dashboard/captacao`. Reusa a pipeline de disparo/elegibilidade/temperatura do Places.

### "Rodar leads" — disparo manual da saudação no Banco de Leads
- Feature de disparo manual da saudação (1ª mensagem) por instância WhatsApp escolhida, a partir do Banco de Leads (`frontend/app/dashboard/banco-leads`). Motor em `src/services/rodar-leads.js` (rota `POST /api/empresas/:id/banco-leads/rodar`); saudação por instância vive em `app.empresa_whatsapp_instances.config_json->>'saudacao'` (editada/testada via `PATCH .../whatsapp/:id` + `POST .../whatsapp/:id/saudacao/testar`). Schema: migration `016_rodar_leads.sql` (colunas `bloqueado_ate`/`bloqueio_motivo` em `prospectador.prospects` + tabela `prospectador.lead_disparos`).
- `RODAR_LEADS_MAX_LOTE` (default `15`): máx de leads por rodada.
- `RODAR_LEADS_COOLDOWN_MIN` (default `5`): minutos exigidos entre rodadas por instância.
- `RODAR_LEADS_TETO_DIARIO` (default `40`): teto diário de disparos por instância (`0` desliga o teto).
- `RODAR_LEADS_DELAY_MIN_MS` / `RODAR_LEADS_DELAY_MAX_MS` (default `12000`/`20000`): janela de delay aleatório entre envios da mesma rodada (envios saem em background, espaçados).
- Trava automática de 15 dias (`src/services/lead-lock.js`, worker iniciado em `index.js`): lead rodado que vira `rejeitado` ou fica sem resposta há `LEAD_MORTA_DIAS` dias é bloqueado por `LEAD_LOCK_DIAS` dias (reabre sozinho quando a data passa; só afeta leads com `lead_disparos`, não o pipeline automático).
- `LEAD_LOCK_DIAS` (default `15`): dias de bloqueio após morte/rejeição.
- `LEAD_MORTA_DIAS` (default `5`): dias sem resposta para considerar a conversa morta.
- `LEAD_LOCK_WORKER_MS` (default `3600000`): intervalo do worker de auto-lock.

> O catálogo **completo** (flags, tuning de IA, follow-up automático, jobs, prospecção)
> vive em `.env.example`, que é a fonte de verdade. Mantenha os dois em sincronia.
> Variável de ambiente nova só pode ser criada se for documentada aqui (ou no `.env.example`) — nunca silenciosamente.

---

## Regra principal — análise antes de implementar

Antes de implementar qualquer alteração, o agente deve:

1. Mapear os arquivos envolvidos.
2. Verificar dependências diretas e indiretas (quem importa, quem chama).
3. Identificar riscos de quebra.
4. Verificar se existe código antigo, duplicado ou legado relacionado.
5. Explicar o impacto esperado.
6. Só então propor/implementar a menor mudança possível.

Nunca implemente direto sem análise de impacto.

## Fluxo obrigatório para qualquer alteração
1. Entender a solicitação.
2. Ler os arquivos relevantes.
3. Consultar `docs/project-map.md`.
4. Consultar `docs/architecture-rules.md`.
5. Fazer análise de impacto (ver checklist abaixo).
6. Listar os arquivos que serão alterados.
7. Implementar a menor mudança possível (diff mínimo, sem refatoração colateral).
8. Remover/ajustar código antigo relacionado, se necessário.
9. Validar com os comandos disponíveis (`npm test` e, quando fizer sentido, `npm run typecheck`).
10. Resumir o que mudou e quais riscos restam.

## Proibições
O agente não pode:
- Criar código duplicado para resolver rápido.
- Criar função/rota/módulo novo se já existe equivalente — reutilize ou refatore.
- Alterar schema, banco, autenticação, segredos ou permissões sem explicar impacto.
- Remover arquivo sem verificar imports e dependências.
- Alterar prompts de produção (`prompts/*.md`) sem justificar impacto.
- Remover proteções de segurança das rotas internas/admin.
- Misturar refatoração grande com feature nova no mesmo diff.
- Alterar muitos arquivos sem plano declarado.
- Criar endpoint sem validação de entrada.
- Criar variável de ambiente sem documentar (`AGENTS.md` + `.env.example`).
- Colocar lógica crítica apenas no frontend (dashboard estático).
- Deixar logs com dados sensíveis (chaves, tokens, telefone/PII em texto puro).
- Fazer workaround sem registrar a dívida técnica.
- Ignorar testes falhando ou erro de typecheck onde o `.ts`/`tsconfig` se aplica.

## Padrão de arquitetura (deste repositório)
- **Entrada HTTP / rotas**: `index.js`, `src/routes.js`, `src/*-routes.js`.
- **Regra de negócio / orquestração**: `src/agent*.js`, `src/*-orchestrator.js`, `src/core-funnel.js`, `src/conversation-pipeline.js`.
- **Serviços de prospecção**: `src/services/*`.
- **Acesso a banco**: isolado em `src/db.js` / `src/db-crud.js`.
- **Integrações externas**: `src/ai-provider.js`, `src/whatsapp.js`, `src/agenda.js`.
- **Validação / schemas**: `src/domainSchemas.js`, `src/*-validator.js`.
- **Helpers genéricos**: `src/string-utils.js`, `src/date-utils.js`.
- **Conhecimento do agente (LLM)**: `prompts/*.md`, `knowledge/*.json`.
- **UI**: dashboard estático em `public/` — apresentação apenas; nada de lógica crítica/segredo.

Evite módulos que misturam roteamento, regra de negócio, acesso a banco e
integração externa no mesmo arquivo.

## Camada SaaS multiempresa (`/api/*` + frontend Next.js)
Camada **aditiva** sobre o agente single-tenant. Vive no schema PostgreSQL `app`
(criado pelas migrations `sql/migrations/001-004`, aplicadas no boot por
`src/db/migrations.js` ao fim de `initDB`). PJ Codeworks permanece como empresa
padrão/seed (`empresa_id` `00000000-…-0001`).

- **Auth JWT**: `src/auth.js` (scrypt + jsonwebtoken). Seed do admin em `seedAdminUser()` no boot.
- **Isolamento de tenant**: `src/middleware/tenant.js` — `requireAuth`, `requireEmpresaAccess`
  e `resolveEmpresaFromWebhook` (resolve `empresa_id` pela instância Evolution; fallback PJ).
- **Acesso a dados multiempresa**: `src/db/empresas.js`, `src/db/usuarios.js`, `src/db/whatsapp-instances.js`.
- **Rotas REST (Bearer token)**: `src/routes/api-*.js` — empresas, contextos, fontes de
  conhecimento (contexto por link), criação de instâncias WhatsApp, conversas, relatórios, LLM.
- **Serviços**: `src/services/contexto-empresa.js`, `contexto2-runtime.js`,
  `knowledge-ingestion.js` (ingestão de URL/arquivo), `url-sanitize.js`, `relatorio.js`, `resumo-conversa.js`.
- **Frontend**: `frontend/` (Next.js App Router) — consome `/api/*`. Deploy Vercel.
- **Envs novas**: `JWT_SECRET` (defina em produção), `JWT_EXPIRES_IN`, `ADMIN_EMAIL/ADMIN_PASSWORD/ADMIN_NOME`
  (caem para `DASHBOARD_ADMIN_*`), `FRONTEND_URL` (CORS). Ver `.env.example`.

## Checklist de análise de impacto
Antes de alterar, responda:
- Quais arquivos serão afetados?
- Quem importa/depende disso (módulos, rotas, jobs)?
- Existe impacto no banco (`sql/`, `src/db*.js`)?
- Existe impacto em autenticação/segredos (`src/dashboardAuth.js`, rotas admin)?
- Existe impacto em integrações externas (Anthropic, WhatsApp, Agenda)?
- Existe impacto em jobs/cron/workers de prospecção (`src/services/*`)?
- Existe impacto nos prompts de produção (`prompts/*.md`)?
- Existe código antigo/duplicado relacionado?
- Existe risco de comportamento diferente em produção (Railway)?

## Checklist de validação
Antes de finalizar, rode/indique:

```bash
npm test            # cobertura de regras de negócio
npm run typecheck   # quando a mudança tocar arquivos .ts ou tipos
npm run smoke:preco # quando tocar precificação
```

A tarefa só pode ser considerada concluída se:
- os testes passam (`npm test`);
- não há imports quebrados;
- não há duplicação nova nem arquivo morto criado;
- a alteração respeita a arquitetura acima;
- prompts/segurança/segredos não foram alterados sem justificativa;
- existe forma clara de testar a mudança.

## Estratégia de trabalho para o Claude
1. Ler o objetivo do pedido e localizar arquivos de menor impacto.
2. Implementar somente o necessário para fechar o aceite.
3. Executar `npm test` após mudanças de regra; atualizar/ajustar teste em `test/`.
4. Reportar riscos remanescentes de forma objetiva.

## Definição de pronto
- Funcionalidade solicitada implementada com escopo controlado.
- Sem regressão em testes existentes.
- Sem alteração acidental em áreas não relacionadas.
