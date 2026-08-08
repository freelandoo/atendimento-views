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
- `docs/ai-workflow.md`: **Workflow Padrão de IA (Fase 0 → 11)** — obrigatório em toda tarefa.
  Índice dos demais documentos de governança: `ai-task-start-log.md`, `ai-decision-log.md`,
  `project-change-map.md`, `ui-visual-standard.md`, `project-architecture.md`.

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
- `AI_AUX_MODEL`: modelo das chamadas AUXILIARES/leves (ex.: `classificar_intencao` em `agent.js`). Sem ela, usa um modelo PEQUENO do provider ATIVO (`AI_PROVIDER`): `openai`→`gpt-4o-mini`, `anthropic`→`claude-haiku-4-5-20251001`. Antes o modelo era fixo em Haiku, que o `generateAIResponse` roteia sempre p/ Anthropic — então com `AI_PROVIDER=openai` toda chamada auxiliar tomava 400/timeout na Anthropic e caía no fallback heurístico. Defina só para forçar um modelo específico (o valor precisa começar com o prefixo do provider ativo: `gpt-`/`claude-`).
- `AI_AUX_CAPABLE_MODEL`: modelo das chamadas auxiliares que exigem um modelo CAPAZ/grande (ex.: `aplicar_overlay_aprendizado` — reescrita de prompt). Sem ela, usa o modelo GRANDE do provider ATIVO: `openai`→`gpt-4o`, `anthropic`→`claude-sonnet-4-6`. Mesma motivação do `AI_AUX_MODEL` (antes fixava Sonnet e tomava 400 na Anthropic com `AI_PROVIDER=openai`).
- `AI_REPAIR_MAX_RETRIES`: nº máximo de retries de reparo quando a IA não emite `reuniao_escolha` em turno de agenda (default `1`; `0` desliga). Cada retry é +1 chamada LLM e é logado como `[ai-repair]`.
- `REUNIAO_BUFFER_MIN`: folga em minutos exigida ENTRE reuniões (default `30`; `0` desliga). Reflete em 3 pontos da agenda: oferta de horários (`slotsLivresDoDia`), validação da escolha (`validarSlotReuniao`) e criação do evento (`criarEventoAgenda`, só tipo `reuniao`). A reunião gravada mantém a duração real (15 min); o buffer só afeta o espaçamento.
- Seletor autônomo de mercado da **Busca IA** (`selecionarMercadoDiarioIA` em `prospecting.js`): só roda quando `modo_busca='ia'`. A IA recebe o raio-x dos mercados já prospectados e as preferências simples do operador, então escolhe um `{nicho, cidade}` fresco (gpt-4o-mini); a busca no Maps segue programática. **Sem fallback para rotação heurística**: tem RETRY (`PROSPEC_MERCADO_IA_RETRIES`, default 3); se todas as tentativas falharem, o erro é registrado com `logger.error`, o estado vira `sem_mercados`/`erro` e o ciclo fica pausado até o operador ajustar ou tentar novamente.
- `PROSPEC_MERCADO_IA_RETRIES`: nº de tentativas da IA ao escolher o mercado do dia (default `3`).
- Atribuição Meta Ads (CTWA) em `src/services/meta-attribution.js`, chamada a cada ~10 min pelo worker (`sincronizarAtribuicaoMetaAds`): captura de qual anúncio cada lead veio (lê `public."Message".contextInfo.externalAdReply`; telefone real em `key.remoteJidAlt`) → grava `vendas.lead_profiles.origem='meta_ads'` + `origem_anuncio` jsonb `{ad_id, ctwa_clid, title, source_url}`; e recalcula `score_lead` por CRITÉRIOS (determinístico, `calcularScoreLeadDeterministico`) p/ leads ativos. **Este módulo NÃO envia nada à Meta** — quem envia é a integração por empresa (bloco abaixo).
- `META_QUALIFIED_LEAD_MIN`: score mínimo (0-100) p/ um lead contar como "qualificado" no painel de resultados por anúncio (default `60`). Não decide envio.
- `META_ENC_KEY`: 32 bytes (base64/hex) que cifram em repouso o token da Meta de CADA empresa. Cofre próprio, separado do `FREELANDOO_ENC_KEY`. Em `NODE_ENV=production`, **salvar credencial da Meta é recusado sem ela**.
- `META_CONVERSOES_PAUSADO`: `on` PAUSA o ciclo inteiro de conversões da Meta (`processarConversoesMeta` retorna antes de consultar o banco: não reconcilia e não envia). Janela de manutenção da atribuição — em especial durante o backfill de `vendas.lead_profiles.empresa_id`: se a empresa de um lead muda entre um tick e outro, o evento sairia com a atribuição antiga, e evento aceito pela Meta **não se estorna**. O ledger não é perdido: o pendente sai no primeiro ciclo depois de despausar. Lida a cada ciclo (não exige restart). Default desligado.
- **APOSENTADAS** (não são mais lidas por código nenhum): `META_DATASET_ID`, `META_CAPI_TOKEN`, `META_PAGE_ID`, `META_WABA_ID`, `META_CAPI_TEST_CODE`, `META_CAPI_PURCHASE_ENABLED`. Configuravam a integração GLOBAL; hoje tudo isso é por empresa, na tabela `app.meta_integracoes`.

### Meta Conversions — integração MULTITENANT por resultado de reunião
- **O que mudou e por quê:** a integração anterior era global. `meta-capi.js` lia dataset/token do
  `process.env` e `dispararEventosMetaPendentes` varria `vendas.lead_profiles` **sem filtro de
  `empresa_id`** — a conversão de qualquer tenant ia para o dataset de um só. Esse caminho foi
  **removido**; `vendas.meta_eventos_conversao` vira histórico read-only (nada mais escreve nela).
- **Credencial por empresa** (`app.meta_integracoes`, UNIQUE por `empresa_id`): dataset, `page_id`
  **ou** `waba_id`, token cifrado (AES-256-GCM, `services/meta-crypto.js` sobre a fábrica
  `src/segredos-crypto.js`), `test_event_code` próprio e os 3 eventos habilitáveis
  independentemente. Estados: `em_teste | ativa | precisa_atencao | desativada`
  (*não configurada* = ausência de linha). **O token NUNCA é devolvido por rota alguma** — a API
  expõe só `token_hint` (4 últimos). Ativar exige teste bem-sucedido (regra em
  `db/meta-integracoes.js`, não na tela).
- **Mapeamento adotado** (CTWA, `action_source=business_messaging`):
  `reuniao_agendada`→`LeadSubmitted` · `reuniao_realizada`→`QualifiedLead` ·
  `reuniao_realizada_com_venda`→`Purchase` (+`value`/`currency`). Três nomes DISTINTOS de
  propósito — a Meta deduplica por `event_id` e reusar nome apagaria a fase anterior do funil.
  `cancelada` e `no_show` são resultado **interno** e nunca chegam à Meta. Como o histórico deste
  repo registra `QualifiedLead` rejeitado (subcode 2804066) numa taxonomia anterior,
  **"Testar conexão" exercita todos os eventos habilitados em modo teste antes de permitir ativar**.
- **Resultado da reunião reusa o `status` que já existe** — nenhum enum novo. `concluido` = realizada;
  `concluido` + `venda_valor > 0` = realizada com venda. Migration `057` só acrescenta
  `venda_valor`/`venda_moeda`/`venda_registrada_em` em `app.agenda_eventos` (CHECK: ou venda completa,
  ou nenhuma).
- **Reconciliador, não gancho nos pontos de negócio:** `services/meta-dispatch.js` LÊ as reuniões por
  empresa e registra os fatos no ledger; nenhum caminho que cria reunião foi tocado. É idempotente por
  construção, enxerga também reuniões já existentes, e uma falha aqui não derruba a criação de reunião.
- **Duas fontes de reunião:** `app.agenda_eventos` (tem `empresa_id`) e `vendas.agenda_eventos` (a do
  BOT, que **não tem** `empresa_id` — a empresa é resolvida por `vendas.conversas.empresa_id` casando o
  telefone de `metadata->>'lead_numero'`). Conversa sem empresa resolvida **não gera evento**. Na
  agenda legada a venda vem de `vendas.conversas.venda_valor` (a mesma linha de onde a empresa saiu) e
  é creditada só à ÚLTIMA reunião concluída do lead — senão um fechamento viraria duas conversões.
- **Idempotência pela ENTIDADE, nunca pelo telefone:** `event_id = <ra|rr|rv>:<entidade_tipo>:<id>`,
  com `UNIQUE (empresa_id, event_id)`. Corrige o modelo antigo (`${telefone}:${event_name}`), que
  travava em uma venda por telefone para sempre. Duas reuniões do mesmo contato = duas conversões.
- **Ledger** `app.conversao_eventos` (`pendente|enviado|falhou|ignorado|corrigido`) +
  `app.conversao_tentativas` (1 linha por tentativa, com código/subcódigo/fbtrace — **nunca o corpo
  cru da resposta**, que pode ecoar o payload enviado). Reserva por lease de 10 min
  (`FOR UPDATE SKIP LOCKED` + `proxima_tentativa_em`), envio HTTP FORA da transação, backoff
  1/5/25/120/360/720 min e teto de 6 tentativas — tudo dentro da janela de 7 dias da Meta. Fato mais
  velho que 7 dias não entra no ledger (é o que impede a 1ª ativação de despejar meses de histórico).
- **Correção de valor depois do envio NÃO reenvia:** o primeiro envio aceito é o registro externo
  válido (a Meta não estorna). O valor novo fica em `valor_corrigido` e o evento vira `corrigido`.
- **Falha permanente** (token inválido 190, 2804066, 2804116) joga a integração inteira para
  `precisa_atencao` e interrompe o lote; transitória (5xx/429) volta para a fila com backoff.
- Código: regras PURAS em `src/services/meta-conversao.js`, transporte em `meta-capi.js`
  (**recebe config, não lê env**), motor em `meta-dispatch.js` (tick de `agent.js`, junto da
  atribuição), teste de conexão em `meta-teste-conexao.js`, SQL em `src/db/meta-integracoes.js` e
  `src/db/conversao-eventos.js`, rotas em `src/routes/api-integracoes-meta.js` (admin-only +
  `requireEmpresaAccess`; toda escrita vira linha em `app.auditoria_eventos`). Front:
  `frontend/app/dashboard/integracoes/meta` + `frontend/lib/meta-integracao.js` (+ `.d.ts`/`.test.js`).
  Testes: `test/meta-conversao.test.js`, `meta-integracoes.test.js`, `meta-dispatch.test.js`.
- `GET /dashboard/meta/anuncios` (dashboard legado) passou a ser **escopado na PJ Codeworks**;
  `obterResultadosAnunciosMeta` agora **exige** `empresaId` e lança sem ele.

### `vendas.lead_profiles.empresa_id` — dono real do lead (Fase A do isolamento)
- **Defeito corrigido:** a migration `006` pôs `DEFAULT '<PJ>'` na coluna (declarando no próprio
  cabeçalho que sairia "quando o roteamento por instância for ligado" — nunca saiu) e **nenhum**
  dos 4 caminhos de INSERT informava `empresa_id`. Todo lead de toda empresa nascia marcado como
  PJ. Efeito real: `meta-dispatch` casa `lp.empresa_id` com a empresa da reunião/conversa, o join
  não fecha, o lead conta como `sem_atribuicao` e a **conversão CTWA do tenant nunca sai**. Não é
  vazamento entre tenants (o telefone é único em `vendas.conversas`, e a reunião da empresa B não
  entra na lista da PJ) — é **perda de conversão**. O painel `obterResultadosAnunciosMeta`, esse
  sim, contava leads de outros tenants dentro da PJ.
- **Fonte da verdade: a CONVERSA, dentro do próprio SQL.** `src/db/lead-profile-empresa.js` é o
  único lugar que sabe escrever essa coluna; os 4 writers (`db-crud.js` `atualizarPerfil`,
  `learning.js` memória de vendas, `agent.js` `POST /dashboard/apelido` e `capturarNomeContato`)
  usam o mesmo fragmento. **Não é parâmetro do chamador de propósito**: é exatamente a coluna com
  que os consumidores casam (`lp.empresa_id = c.empresa_id`), então um parâmetro que discordasse
  da conversa reintroduziria o bug. `lead_profiles.numero` é `REFERENCES vendas.conversas(numero)`
  — não existe perfil sem conversa, a fonte está sempre disponível.
- **PROIBIDO** aceitar `empresa_id`/`empresa_id_origem` vindos de payload: não estão em
  `LEAD_PROFILE_CAMPOS_PERMITIDOS` e o valor nasce de subconsulta, nunca de entrada externa.
- **O upsert nunca migra o dono** (mesmo contrato de `salvarConversa`): `ON CONFLICT` só preenche
  a empresa quando a linha ainda está sem dono. Corrigir linha antiga é trabalho do backfill.
- **Confiança da atribuição** (`empresa_id_origem`, migration `058`): `conversa_confirmada` (a
  empresa veio da conversa **e** a instância WhatsApp dela aponta para a mesma empresa) ·
  `conversa_nao_confirmada` (veio da conversa, mas nada confirmou: sem instância, instância não
  mapeada, ou fallback da PJ) · `NULL` (linha anterior à correção). É o que permitirá à Meta
  **recusar** atribuição frouxa sem remover o fallback agora. **A confirmação pela instância é
  obrigatória, "veio da conversa" não basta:** medido em produção (2026-08-08), das 6 conversas
  marcadas como PJ apenas **1** é PJ de verdade — 2 sem instância e 3 com instância não mapeada.
  **Quem** escreveu o valor (atendimento ou backfill) não entra nesta coluna: esse rastro é
  auditoria e vive em `vendas.lead_profiles_empresa_backfill`.
- **Migration `058_lead_profiles_empresa.sql`** (aditiva, não muta dado): tira o `DEFAULT` da PJ,
  cria `empresa_id_origem` (CHECK fechado), o índice `(empresa_id, numero)` e a tabela
  `vendas.lead_profiles_empresa_backfill` (o "antes" de cada linha = rollback do backfill).
  `empresa_id` **não** virou `NOT NULL` (linhas antigas com NULL derrubariam o boot) e
  `UNIQUE (numero)` **não** foi tocado.
- **Correção histórica:** `npm run backfill:lead-profiles-empresa` **simula** (padrão, não grava);
  `-- --aplicar` grava. Idempotente, keyset por `id`, **um COMMIT por lote** (nunca um UPDATE
  massivo em transação única), sem chamada externa, com relatório sem PII e SQL de rollback
  impresso ao final. Perfil sem conversa ou conversa sem empresa: **nada é alterado** — inventar
  dono seria pior. **Pause a Meta (`META_CONVERSOES_PAUSADO=on`) antes de aplicar em produção.**
- **Medição read-only:** `npm run medir:isolamento-empresa` (usa a `DATABASE_URL` do ambiente).
  Roda em `BEGIN TRANSACTION READ ONLY` + `ROLLBACK`, imprime **só contagens agregadas** e
  mascara até o id da empresa. Nenhum telefone, nome, token ou mensagem sai dele.

### Captação social (Bright Data — Instagram agora, LinkedIn no mesmo motor)
- `BRIGHTDATA_API_TOKEN`: token da Bright Data Web Scraper / Dataset API. **Sem ele o canal de captação fica desligado** (worker não roda) e a **Aquisição** (busca de leads via Maps) também. Mesmo token serve Instagram, LinkedIn e Google Maps.
- `BRIGHTDATA_DATASET_IG_DESCOBERTA` / `BRIGHTDATA_DATASET_IG_PERFIS` / `BRIGHTDATA_DATASET_LI_DESCOBERTA` / `BRIGHTDATA_DATASET_LI_PERFIS`: `dataset_id` de cada coleta (descoberta por hashtag/keyword e perfis por URL). Confirmar no painel Bright Data da conta — o formato de input depende do dataset.
- `BRIGHTDATA_DATASET_MAPS_DESCOBERTA`: `dataset_id` do "Google Maps full information" (Discover by location). **Fonte de dados da Aquisição** (substituiu o Google Places API). Sem ele, `pesquisarPlaces` lança erro (500). Input: `{country, lat, long, zoom_level, keyword}` — a cidade é geocodificada p/ coordenadas (OSM/Nominatim, grátis). Motor: `src/services/places-brightdata.js`. `BRIGHTDATA_MAPS_ZOOM` (default 12) e `GEOCODE_NOMINATIM_URL`/`GEOCODE_TIMEOUT_MS` são opcionais.
- `BRIGHTDATA_CAPTACAO_TETO_DIARIO`: teto diário de registros consumidos na conta (free tier 5000/mês ≈ 166/dia; default 166).
- `BRIGHTDATA_SEGUIR_LINK_BIO`: `on` faz o extrator seguir o link da bio atrás de email/WhatsApp (gasta mais; default `off`).
- `BRIGHTDATA_TIMEOUT_MS` / `LINK_BIO_TIMEOUT_MS` / `CAPTACAO_WORKER_POLL_MS`: timeouts e intervalo do worker.
- `CAPTACAO_SCHEDULER_INTERVAL_MS` (default `300000`, min `60000`) / `CAPTACAO_SCHEDULER_TZ` (default `America/Sao_Paulo`): agendamento automático de campanhas. Campanha com `ativo=true` + `metadata_json.agendamento_ativo=true` dispara uma nova coleta a cada `intervalo_horas` dentro da janela (`janela_inicio`/`janela_fim`) e `dias_semana` configurados na campanha. Lógica pura em `src/services/captacao-scheduler.js` (`campanhaDevePreencher`); o disparo (`dispararCampanhasAgendadas`) roda no tick do capture worker e reusa `iniciarColeta` (respeita teto diário/orçamento; só inicia a COLETA, a aprovação p/ WhatsApp segue manual).
- `EMAIL_PROVIDER_API_URL` / `EMAIL_PROVIDER_API_KEY` / `EMAIL_FROM`: canal de e-mail para leads sociais (Fase futura). Sem os três, o e-mail fica desativado (registra, não envia). `EMAIL_TIMEOUT_MS` opcional.

### Canal Freelandoo (instância por token, não por QR)
- Instância de atendimento conectada à "API de Atendimento da Freelandoo" (base `…/ext/v1`, Bearer, sem `/api`, 60 req/min). O bot **só responde** conversas existentes — nunca inicia.
- A instância vive na MESMA tabela do WhatsApp (`app.empresa_whatsapp_instances`, `config_json.canal='freelandoo'`) → herda contexto 1:1, `usa_agenda?` e `ativo`, e responde com o MESMO motor (`processarMensagemComPlaybook`). Diferença: onboarding cola o token (valida em `GET /me`) em vez de ler QR; transporte é a API da Freelandoo, não a Evolution.
- Credenciais cifradas (AES-256-GCM) em `app.freelandoo_connections`; fila/idempotência do webhook em `app.freelandoo_webhook_events` (migration `019_freelandoo_channel.sql`).
- Webhook público `POST /freelandoo/webhook/:instanceId` (montado com `express.raw` ANTES do `express.json` p/ validar HMAC byte-a-byte): valida `X-Freelandoo-Signature` = `sha256(hmac(webhook_secret, `${ts}.${raw}`))` + anti-replay 5 min, responde 2xx rápido e processa em background (idempotência por `message.id_message`).
- Código: cliente `src/freelandoo/client.js`, cripto `src/freelandoo/crypto.js`, responder `src/freelandoo/responder.js`, dados `src/db/freelandoo.js`, rotas `src/routes/api-freelandoo.js` (onboarding) e `src/routes/freelandoo-webhook.js` (webhook). Front: `frontend/components/InstanciasFreelandoo.tsx` (abaixo das instâncias WhatsApp em `dashboard/contextos`). Toggles ativo/agenda reusam os endpoints `/whatsapp` (mesma tabela).
- Envs: `FREELANDOO_ENC_KEY` (32B base64/hex — cifra em repouso; sem ela deriva de `JWT_SECRET`), `PUBLIC_BACKEND_URL` (HTTPS público p/ registrar o webhook), `FREELANDOO_BASE_URL`/`FREELANDOO_TIMEOUT_MS` (opcionais).

### Playbook de Atendimento (API de Dados da Freelandoo)
- Ferramenta que recebe um token da **API de Dados** da Freelandoo (`flnd_data_...`, prefixo `/ext/v1/data`, Bearer, 60 req/min — DIFERENTE do canal de atendimento `/ext/v1`), puxa os dados públicos/operacionais do vendedor (7 endpoints) e gera um **playbook em Markdown** (base de conhecimento p/ atendente/bot) via LLM. Read-only; não persiste nada da Freelandoo.
- O token é tratado como **segredo**: trafega só no corpo da requisição, nunca é logado nem salvo (no front tampouco vai p/ localStorage).
- Backend orquestra tudo (o LLM exige a chave, que é backend-only; evita CORS): valida o formato → coleta os 7 GETs em paralelo (`Promise.allSettled`; endpoint que falha vira "(não informado)" + aviso) → agrega/normaliza (centavos→R$, agrupa serviços/produtos/social por `id_profile`, filtra `is_active` e produtos `moderation_status='active'`) → chama `generateAIResponse` (task `playbook-freelandoo`) → anexa rodapé determinístico (data + @username).
- Código: cliente `src/freelandoo/data-client.js` (reusa `FreelandooError`), motor `src/services/playbook-freelandoo.js` (`montarAgregado` é pura/testada), rota `POST /api/empresas/:empresaId/playbook/gerar` em `src/routes/api-playbook.js` (auth + `requireEmpresaAccess`). Front: `frontend/app/dashboard/playbook` (item "Playbook", admin-only). Teste: `test/playbook-freelandoo.test.js`.
- Env: `FREELANDOO_DATA_BASE_URL` (opcional — raiz do backend; sem ela deriva de `FREELANDOO_BASE_URL`).

> Módulo de captação: rotas em `src/routes/api-captacao.js`; motor em `src/services/social-capture.js`
> (+ `brightdata-client.js`, `social-contact-extract.js`, `email-outreach.js`); schema na
> migration `sql/migrations/012_captacao_social.sql` (generaliza `prospectador.prospects` por
> `origem+external_ref`, sem job_queue — usa `captacao_snapshots` como fila assíncrona). Frontend:
> `frontend/app/dashboard/captacao`. Reusa a pipeline de disparo/elegibilidade/temperatura do Places.

### "Rodar leads" — disparo da saudação no Banco de Leads (Modo Manual / Semi / Automático)
- Feature de disparo da saudação (1ª mensagem) por instância WhatsApp escolhida, a partir do Banco de Leads (`frontend/app/dashboard/banco-leads`). Motor em `src/services/rodar-leads.js`; saudação (fallback) por instância vive em `app.empresa_whatsapp_instances.config_json->>'saudacao'` (editada/testada via `PATCH .../whatsapp/:id` + `POST .../whatsapp/:id/saudacao/testar`). Schema: migration `016_rodar_leads.sql` (colunas `bloqueado_ate`/`bloqueio_motivo` em `prospectador.prospects` + tabela `prospectador.lead_disparos`).
- **Modos de disparo por EMPRESA** (`app.banco_leads_config`, migration `020_banco_leads_modos.sql`; acesso em `src/db/banco-leads-config.js`):
  - **Manual** (`POST .../banco-leads/rodar`): gera (IA opcional) e envia na hora. Clicar em Enviar já é a aprovação.
  - **Semiautomático**: `POST .../banco-leads/gerar` gera a mensagem por IA e grava como `lead_disparos.status='aguardando_disparo'` (não envia, não consome teto); `POST .../banco-leads/disparar-gerados` envia depois, no comando do usuário (por lead ou em lote), sem re-gerar.
  - **Automático**: worker `src/services/banco-leads-auto.js` (iniciado em `index.js`, tick `BANCO_LEADS_AUTO_WORKER_MS`). Para cada empresa com `modo='automatico'`+`auto_ativo`, dentro da `janela_inicio`..`janela_fim` (fuso `APP_TIMEZONE`) e passado o `auto_proximo_disparo_em`, pega 1 lead elegível (rodável, com WhatsApp≠false) da instância ativa e **dispara reusando `rodarLeads`** (sem reimplementar envio/throttle); depois sorteia o próximo intervalo (`intervalo_min`..`intervalo_max`, 15–30). Teto `teto_diario`=**40 fixo** é limite de segurança; volume real ≈ janela ÷ intervalo. `auto_proximo_disparo_em` guarda o próximo disparo (migration `022`).
  - `GET/PUT .../banco-leads/config`: `{ modo, gerar_ia, instrucoes_ia }` + campos do Auto (`auto_ativo, janela_inicio, janela_fim, intervalo_min, intervalo_max`; `intervalo` clampado em 15–30, `teto_diario` fixo 40).
- **Selo de WhatsApp por lead** (`prospectador.prospects.tem_whatsapp`, migration `021`): aprendido no disparo — envio OK ⇒ `true` (ícone verde no painel); Evolution `exists:false`/`numero_inexistente` ⇒ `false` (registra "sem WhatsApp", sai da elegibilidade). `NULL` = ainda não disparado.
- `BANCO_LEADS_AUTO_WORKER_MS` (default `60000`, mín `30000`): intervalo do tick do worker do modo Automático.
- **Aquisição é SÓ BUSCA (agora via Bright Data Maps, assíncrona):** a fonte de dados passou do **Google Places API** para o **Bright Data "Google Maps full information"** (Discover by location). `pesquisarPlaces` não busca mais na hora — **dispara o job (minutos) e ENFILEIRA em `prospectador.busca_snapshots`** (migration `024`); o worker `processarBuscasPlacesPendentes` (tick 60s em `agent.js`) acompanha o job (`progress`), e quando fica `ready` baixa os registros → adapter (`places-brightdata.js`) → `mapearPlace` → `salvarProspects`. Dedup por `place_id` (formato Google, compatível) e **teto fixo de 200 resultados importados por busca**, aplicado no backend mesmo que a Bright Data devolva mais registros. O disparo automático de ENVIO foi **removido do tick** (`agent.js` não chama `verificarAgendaDiariaProspeccao`). A página `dashboard/prospeccao` só encontra leads e alimenta o Banco de Leads. Hoje ela tem **Rotinas de Aquisição** (ver bloco abaixo), **Busca avulsa** e **Busca IA**. O modo **Automático fixo** foi APOSENTADO (migration `053`): virou rotina, e `normalizarConfiguracaoProspeccao` mapeia o valor legado para `manual` — reaceitá-lo criaria um segundo agendador sobre o mesmo mercado, com risco de coleta paga em duplicidade. A Busca IA segue no motor global (`verificarAgendaBuscaRecorrenteProspeccao`, teto próprio de 2 buscas/dia, estratégia + nichos/regiões permitidos); ela não depende do campo legado `ativo` e, depois de resultados zerados, escolhe outro mercado. A aba Instagram segue o mesmo padrão de menu inline e reusa campanhas/worker social. **Todo envio de WhatsApp acontece no Banco de Leads.** `GOOGLE_PLACES_API_KEY` deixou de ser usada pela busca.
### Rotinas de Aquisição (coleta contínua por mercado)
- A Aquisição deixou de ser uma configuração única por empresa: agora são **rotinas
  independentes**, uma por mercado (`nicho` + `cidade` + `uf`), cada uma com seus dias ativos,
  janela, intervalo (mín. **6h**) e quantidade por execução (**1..200**), podendo ser pausada e
  retomada sem perder o histórico. **Não há teto diário** de buscas nem de leads para as rotinas.
- Schema: migration `053_aquisicao_rotinas.sql` → `prospectador.aquisicao_rotinas` +
  colunas novas em `busca_snapshots` (`rotina_id`, `quantidade_solicitada`, `tentativas`,
  `idempotency_key`). A migration converte a config fixa atual na 1ª rotina **PAUSADA** e
  desliga o `automatico_fixo` (mutação de dados declarada no cabeçalho do arquivo).
- **Uma coleta paga em andamento por empresa** é garantida no BANCO, não na aplicação:
  índice único parcial `busca_snapshots_uma_ativa_por_empresa_uk`. Vale para TODAS as origens
  (rotina, avulsa e Busca IA). `busca_snapshots_idempotency_uk` torna requisições iguais
  idempotentes (chave por minuto).
- **A tentativa é persistida ANTES do disparo pago**: `pesquisarPlaces` grava a reserva
  (`status='pendente'`, sem `snapshot_id`) e só então chama a Bright Data; se o trigger falhar,
  a reserva vira `falhou` e libera a trava. Nunca existe coleta paga órfã.
- O intervalo conta a partir do **DISPARO** (`ultima_execucao_em`), não da conclusão — uma coleta
  travada não pode reabrir o intervalo. Execução perdida fora da janela **não é compensada**.
- Desistência: o worker expira snapshots por idade (3h), por tentativas (40) e reservas sem
  disparo (10 min); a rotina para sozinha em `precisa_atencao` após 3 falhas seguidas.
- Código: lógica PURA de tempo em `src/services/aquisicao-rotinas-scheduler.js` (reusa
  `horaLocal`/`normalizarDias` da captação), SQL em `src/db/aquisicao-rotinas.js`, motor
  `executarRotinasAquisicao` em `prospecting.js` (tick de `agent.js`), rotas em
  `src/routes/api-aquisicao-rotinas.js` (montadas ANTES de `/prospeccao`, admin-only).
  Front: `frontend/components/RotinasAquisicao.tsx`. Testes:
  `test/aquisicao-rotinas-scheduler.test.js` e `test/aquisicao-rotinas-motor.test.js`.
- **A tela de Aquisição tem DOIS MODOS** (controle segmentado no topo, reusando
  `components/ui/Abas.tsx`): **Busca** (busca avulsa, status da coleta, tabela de leads
  encontrados e "Acompanhar resultados") e **Rotinas** (painel de rotinas + histórico de
  coletas). `RotinasAquisicao` recebe a prop `modo` e renderiza só o card do modo ativo, mas
  fica **sempre montado** — é o que preserva o formulário da busca avulsa e o acompanhamento da
  coleta ao alternar; desmontá-lo reiniciaria o formulário. **Trocar de modo é só apresentação:
  não dispara busca, coleta paga, salvamento de rotina nem requisição nova** (`carregar`,
  `carregarBuscas` e o painel de rotinas não dependem de `modo`). O modo persiste em
  `sessionStorage` + `?modo=busca|rotinas` (via `history.replaceState`, sem `useSearchParams`).
- **Cidade + UF** compõem a localização usada na geocodificação e na coleta, no automático **e**
  no manual (`POST /prospeccao/buscar` aceita `uf`) — sem a UF, "Santana" resolvia em qualquer estado.
- **A tabela "Leads encontrados" é paginada NO SERVIDOR** (`GET /prospeccao/prospects` aceita
  `limit`, `offset`, `ordenar`, `direcao`; 25 por página). Antes ela puxava 100 leads e ordenava
  no cliente — com milhares na carteira, o resto era inalcançável. **A ordenação vai junto**: com
  25 de milhares na tela, ordenar só a página daria uma ordem falsa.
  - `ordenar` é um **mapa fechado** chave→SQL (`ORDEM_SQL_PROSPECTS`): o valor vem da URL e nada
    do cliente é concatenado no `ORDER BY`. Chave desconhecida é ignorada e cai na ordem de
    negócio histórica (que é o que os demais chamadores de `listarProspects` continuam recebendo,
    pois não mandam `ordenar`).
  - `pontos` e `horario` **não** estão nesse mapa: saem de `calcularScoreCadastroPlaces`/
    `dadosPlaces`, calculados na LEITURA. Traduzi-los para SQL duplicaria a regra de pontuação.
    Eles usam `idsPorOrdemCalculada`, que lê o conjunto filtrado, pontua com a MESMA função,
    ordena, recorta e devolve só ids — a hidratação pesada (`json_apresentacao`, diagnóstico) roda
    apenas para os 25 da página. **Dívida técnica declarada** em `docs/ai-decision-log.md`: essa
    varredura é linear; a saída, quando incomodar, é persistir a pontuação numa coluna mantida na
    escrita, nunca traduzir a regra para SQL.
  - **Um único construtor de WHERE** (`montarFiltrosProspects`, opções `alias`/`comStatus`) serve a
    listagem **e** `GET /prospeccao/metricas`. É de lá que vêm a contagem dentro de cada filtro de
    status e o total do rodapé; dois WHERE separados divergiriam e a tela passaria a se contradizer.
    A contagem de propósito **não** filtra por `status` — ele escolhe qual coluna do resultado
    olhar, não o universo (filtrar zeraria os outros cinco).
- Nenhuma variável de ambiente nova foi criada para este módulo.

### Assistente de Oportunidades (curadoria POR LEAD, na Busca avulsa)
- O botão premium "Analisar oportunidades" abre um **menu guiado** ("O que você quer fazer
  agora?", `frontend/components/AssistenteEntrada.tsx`) com dois caminhos: **Revisar oportunidades
  encontradas** (abre a sessão de análise de sempre) e **Encontrar novas oportunidades** (busca
  guiada: alterar nicho, localidade ou ambos). O menu lê `GET .../curadoria/resumo` — endpoint
  read-only que **não monta fila e não chama IA** (o `GET /curadoria` chama, quando `fila_json`
  está vazio; abrir um modal não pode custar chamada paga).
- **A busca guiada não cria, não encerra e não retargeta sessão.** Ela só dispara a coleta pelo
  mesmo `POST /prospeccao/buscar` da Busca avulsa (função única `dispararBusca` em
  `RotinasAquisicao.tsx`); a sessão continua nascendo em `POST .../curadoria/sessao`, no comando
  "Revisar". Retargetar misturaria dois mercados na mesma meta/fila, e uma segunda sessão é
  impedida pelo índice único. Havendo sessão ativa, o menu rotula "Retomar a revisão em andamento"
  com o mercado e o progresso REAIS dela — `iniciarSessao` sempre devolveu a sessão existente
  ignorando o mercado pedido, e a tela deixou de esconder isso. Lógica pura de passos/campos em
  `frontend/lib/assistente-entrada.js` (+ teste `lib/assistente-entrada.test.js`).
- Sessão de análise aberta **só no clique**, ao lado de "Buscar agora". **Buscar não analisa e
  analisar não busca**: este módulo não importa `pesquisarPlaces` nem qualquer função de coleta —
  nenhuma chamada paga à Bright Data parte da análise.
- Mostra **uma oportunidade por vez** com uma justificativa curta. **Aprovar** move o lead de
  `aguardando` para `aprovado` (carteira de trabalho); **Descartar** move para `rejeitado`. O
  pipeline de coleta é o de sempre — a Busca avulsa continua importando o que coleta.
- **A meta ("Máx. de leads novos") conta CLAIM, não clique:** `aprovados` só sobe quando o
  `UPDATE ... WHERE status='aguardando'` devolve linha. Repetir a ação, recarregar a página ou
  decidir um lead que já saiu da fila **não consome a meta e não duplica nada**. Descarte e
  duplicado não param a sessão: a fila continua até a meta ou o esgotamento.
- Esgotou o mercado antes da meta ⇒ oferece **Ampliar a busca** (passa a olhar toda a carteira);
  já ampliado ⇒ orienta rodar uma nova busca. Nunca encerra no vazio.
- **Aprendizado automático, sem configuração visível:** taxa de aprovação por característica
  (faixas: tem site, faixa de nota, faixa de avaliações, completude do cadastro, nicho),
  suavizada por Laplace, comparada com a taxa geral **da própria empresa**; amostra mínima 3,
  teto de ±25 pontos. Ausente ≠ zero (sem nota não é nota baixa).
- **A IA só redige:** a ordem vem das regras puras; a IA transforma faixas em frase, **uma
  chamada por lote de 12** (não uma por lead), e a fila fica persistida em `fila_json` — recarregar
  não repaga a explicação. IA fora do ar não trava a sessão (motivo determinístico assume).
  **Nome, telefone, e-mail e endereço do lead nunca entram no prompt.**
- Uma sessão ativa por **operador** (índice único parcial). Dois admins podem curar em paralelo:
  a corrida pelo mesmo lead é resolvida pelo claim, e o segundo recebe "já decidido".
- Schema: migration `055_aquisicao_curadoria.sql` → `prospectador.curadoria_sessoes` +
  `curadoria_decisoes` (aditiva; não muta dado existente). Código: regras PURAS em
  `src/services/aquisicao-curadoria-ranking.js`, orquestração em
  `src/services/aquisicao-curadoria.js`, SQL em `src/db/aquisicao-curadoria.js`, rotas em
  `src/routes/api-aquisicao-curadoria.js` (montadas ANTES de `/prospeccao`, admin-only). Front:
  `frontend/components/AssistenteOportunidades.tsx` (aberto por `RotinasAquisicao.tsx`). Testes:
  `test/aquisicao-curadoria-ranking.test.js` e `test/aquisicao-curadoria.test.js`.
- **Assistente por MERCADO (sugestões de rotina) aposentado só na UI:** saiu da tela de Aquisição,
  mas `prospectador.aquisicao_sugestoes`, `src/services/aquisicao-assistente.js`,
  `aquisicao-sinais.js` e a rota `/prospeccao/oportunidades` **continuam existindo** — as decisões
  já tomadas seguem consultáveis. Os critérios manuais (`busca_estrategia`,
  `busca_nichos_permitidos`, `busca_localizacoes_permitidas`) saíram do formulário mas **continuam
  gravados** em `prospeccao_configuracoes`.
- Nenhuma variável de ambiente nova foi criada para este módulo.

- Geração por IA da saudação de análise: `src/services/saudacao-analise.js` (spec `docs/superpowers/specs/2026-07-03-saudacao-analise-e-estagios-design.md`). Usa `json_apresentacao` (lacunas do cadastro) + conhecimento do contexto da instância + `instrucoes_ia`. Faz **retries** (`SAUDACAO_IA_RETRIES`) antes de desistir.
- **IA obrigatória quando `gerar_ia` ligado — sem fallback silencioso pro template:** se a IA falhar, o disparo é marcado com **erro no status** (Semi ⇒ `lead_disparos.status='erro_ia'`, com botão "Gerar de novo" no painel; Manual/Auto ⇒ `status='falhou', erro='ia_falhou'`, **não envia**). Com `gerar_ia` desligado, usa o template (mensagem escolhida). O template segue exigido por instância como base.
- **Aba "Descartados"** no Banco de Leads: leads com `status IN ('rejeitado','nao_contatar')` OU `tem_whatsapp=false` (envio não chegou), com o **motivo claro** no painel. Leads sem WhatsApp saem da aba "Sem contato".
- **Aba "Agendados"**: prospects com evento FUTURO (`pendente/confirmado`) na `app.agenda_eventos` (migration 011), casado por telefone (só dígitos), ordenados pelo horário mais próximo. Cada lead traz `proximo_agendamento` (subquery em `GET /leads`); badge 📅 no painel.
- **Cronômetro de cooldown** no **Manual e no Semi** (reusa `GET /banco-leads/cooldown` → `estadoThrottle`): mostra "Envio liberado"/"Próximo envio em MM:SS", bloqueia o envio antes da hora (destaca o cronômetro + toast). Regra ÚNICA em `rodar-leads.js`.
- **Instância única no Automático:** o seletor "Instância" da barra alimenta o disparo automático (`auto_instancia_id` sincronizado); sem campo duplicado.
- **Telefone clicável** na listagem abre o histórico de conversa (`components/ConversaHistoricoModal.tsx`, reusa `GET /conversas/:numero`; JID `<digits>@s.whatsapp.net`; estado vazio amigável).
- **"⚙ Personalizar" (modal completo)**: colunas visíveis (toggle), filtros client-side (site, e-mail, telefone, envio/WhatsApp, mensagem gerada, disparo, agendamento, região, faixas de pontos/nota/avaliações, data de entrada), ordenação global (pontos/nota/avaliações/entrada/agendamento/último contato) e **presets** (Oportunidades fortes, Sem presença digital, Prontos para disparo, Agendados próximos, etc.). Tudo **client-side** sobre os leads já carregados (fetch único ≤1000; sem paginação); **persistido no localStorage** (`bancoLeadsView`). Chips de filtros ativos + contagem + estado vazio. Reusa a tabela existente (colunas condicionais por `cols`), não recria a listagem. Status continua nas abas.
- **Modo Automático — instância configurável** (`banco_leads_config.auto_instancia_id`, migration `023`): escolhe qual número dispara no Auto; `NULL` = a ativa mais recente.
- Teto de disparo (Manual/Semi/Auto) vem de `banco_leads_config.teto_diario` (default 40), não mais do env `RODAR_LEADS_TETO_DIARIO` (que vira só fallback).
- `SAUDACAO_IA_TIMEOUT_MS` (default `30000`): timeout da geração da saudação de análise por IA.
- `SAUDACAO_IA_RETRIES` (default `1`, máx `3`): retentativas extras da geração por IA quando falha/vazio.
- `RODAR_LEADS_MAX_LOTE` (default `15`): máx de leads por rodada.
- `RODAR_LEADS_COOLDOWN_MIN` (default `15`): minutos exigidos entre disparos por instância (o disparo — manual ou dos gerados — só sai a cada N min; antes disso a rota retorna 429 com aviso).
- `RODAR_LEADS_TETO_DIARIO` (default `40`): teto diário de disparos por instância (`0` desliga o teto).
- `RODAR_LEADS_DELAY_MIN_MS` / `RODAR_LEADS_DELAY_MAX_MS` (default `12000`/`20000`): janela de delay aleatório entre envios da mesma rodada (envios saem em background, espaçados).
- Trava automática de 15 dias (`src/services/lead-lock.js`, worker iniciado em `index.js`): lead rodado que vira `rejeitado` ou fica sem resposta há `LEAD_MORTA_DIAS` dias é bloqueado por `LEAD_LOCK_DIAS` dias (reabre sozinho quando a data passa; só afeta leads com `lead_disparos`, não o pipeline automático).
- `LEAD_LOCK_DIAS` (default `15`): dias de bloqueio após morte/rejeição.
- `LEAD_MORTA_DIAS` (default `5`): dias sem resposta para considerar a conversa morta.
- `LEAD_LOCK_WORKER_MS` (default `3600000`): intervalo do worker de auto-lock.

### Classificação canônica de "site próprio" (transversal — Banco de Leads, Aquisição, Ligações)
- **Regra de negócio:** `tem_site = true` **somente** quando existe site próprio em **domínio
  independente**. Instagram, Facebook, TikTok, YouTube, WhatsApp/`wa.me`, Google Maps, Perfil da
  Empresa (`business.site`/`negocio.site`), Linktree/Beacons/Carrd e demais agregadores, além de
  perfis de marketplace/diretório (iFood, Mercado Livre, OLX, TripAdvisor, Apontador…) ⇒
  `tem_site=false`. **Link preenchido ≠ tem site.**
- **Fonte de verdade única:** `src/services/site-classificacao.js` — módulo **PURO** (sem banco,
  HTTP, IA ou rede). Classifica pelo **domínio/subdomínio**, nunca por texto solto, subindo a
  hierarquia do host do mais específico para o menos (`maps.app.goo.gl` vence `goo.gl`).
  API: `classificarUrl(url)`, `classificarMelhorLink([...])`, `classificarLead(lead)`,
  `temSiteProprio(lead)`, `situacaoSiteDoLead(lead)`.
  Categorias: `site_proprio | rede_social | agregador | perfil_ou_diretorio | desconhecido | sem_link`.
  `desconhecido` = encurtador ou subdomínio de construtor (`*.wixsite.com`, `*.blogspot.com`).
  **Decisão do operador (2026-08-07): link duvidoso conta como COM site** — `desconhecido`
  cai em `situacao_site='tem_site'`. Na dúvida o lead **não** entra na lista de "sem site",
  para ninguém ser abordado dizendo que não tem site quando talvez tenha; o custo aceito é o
  inverso (um lead sem site pode ficar de fora). A evidência crua não se perde:
  `classificacao_url` continua `'desconhecido'` e o rótulo do link segue "Link a verificar",
  então dá para revisar e reverter — é uma linha em `classificarLead`.
- **PROIBIDO** reintroduzir `!!(lead.site || lead.tem_site)`: foi essa equivalência, repetida em
  7 pontos, que fez o sistema inteiro chamar Instagram de site. Todo produtor e consumidor chama o
  classificador.
- **Contrato de dados** (`prospectador.prospects`, migration `056_site_classificacao.sql`,
  aditiva): `site` = **só** site próprio confirmado; `link_original` = link cru preservado para
  auditoria (nunca apagado); `classificacao_url` = categoria (`CHECK` fechado; `NULL` = ainda não
  classificado, ≠ `'desconhecido'`). `tem_site` é **cache** — a autoridade é a função na LEITURA.
  **`site` e `tem_site` deixaram de andar juntos**: link duvidoso dá `tem_site=true` com
  `site=NULL` (o link fica em `link_original`). Quem decide o que entra em `site` é a
  CLASSIFICAÇÃO (`=== 'site_proprio'`), nunca a flag.
- **Situação em 3 estados** (`situacao_site`, usada pela fila e pelas telas): `tem_site` (site
  próprio **ou** link duvidoso) · `sem_site` (ficha do Maps lida sem site **ou** único link é
  social/agregador/perfil — ganha o bônus de 40 pts em `ligacao-prioridade.js`) ·
  `nao_identificado` (ninguém verificou: sem link algum e sem ficha do Maps — 15 pts).
- **Correção histórica:** `npm run reclassificar:sites` **simula** (padrão, não grava);
  `npm run reclassificar:sites -- --aplicar` grava. Flags: `--lote=N`, `--empresa=<uuid>`,
  `--tudo`. Idempotente, em lotes (keyset), **sem chamada externa ou paga**, com relatório de
  analisados/alterados/mantidos/desconhecidos. Copia `site` → `link_original` na mesma instrução
  antes de limpar. `scripts/reclassificar-sites.js`.
- **Produtores atualizados:** `prospecting.js` (`mapearPlace`, `calcularScoreProspect`,
  `motivoScore`, `normalizarProspectParaPersistencia`, `salvarProspect`), `social-capture.js`
  (o link da bio do Instagram **não** vira mais `site`).
  **Consumidores atualizados:** `ligacao-prioridade.js` (`situacaoSite` delega),
  `aquisicao-curadoria-ranking.js`, `aquisicao-curadoria.js`, `lead-score-cadastro.js`
  (os 20 pts de "Tem site próprio"), `domainSchemas.js`, `db/campanhas.js`,
  `routes/api-banco-leads.js`, `webhook-handler.js`.
- **Fora de escopo (outro domínio):** o `tem_site` **conversacional** — o que o LEAD declara no
  WhatsApp (`agent.js`, `turn-context-reader.js`, `core-funnel.js`, `prompts/*.md`,
  `vendas.lead_profiles`). Ali a fonte é fala humana, não URL. No `webhook-handler.js` o valor
  declarado pelo lead tem precedência sobre o cadastro.
- **Frontend:** `frontend/lib/site-rotulos.js` (+ `.d.ts`) só **traduz** o veredito que a API
  mandou — não há lista de domínios no front, de propósito. Telas: `banco-leads`, `prospeccao`,
  `central-ligacoes`, `AssistenteOportunidades`. Rótulos: "Tem site próprio" / "Sem site próprio"
  / "Verificar link"; o link não-site continua clicável, rotulado pelo que é.
- Nenhuma variável de ambiente nova. Testes: `test/site-classificacao.test.js`,
  `test/reclassificar-sites.test.js`.

### Central de Follow-ups
- Página admin multiempresa em `frontend/app/dashboard/follow-ups`, exposta pela rota
  `src/routes/api-follow-ups.js`. Possui modos **Atendimento humano (Semi)**, **Automático** e
  **Manual**; a preferência fica em `app.followup_config` (migration `029`).
- Listagem/priorização e operações manuais vivem em `src/services/followup-listing.js`,
  `followup-call-score.js` e `followup-manual.js`; configuração, ligações e métricas ficam em
  `src/db/followup-config.js` e `src/db/followup-ligacoes.js` (migrations `030/031`).
- O Atendimento humano recomenda uma única próxima ação por critérios determinísticos: assumir
  handoff, ligar, revisar proposta, escrever manualmente ou copiar um prompt de preview. O prompt
  serve apenas para geração externa e revisão humana; esta tela não gera, envia ou salva imagens.
- `pausado=true` bloqueia novos agendamentos e também adia jobs `followup_auto` já enfileirados,
  sem enviar nem consumir tentativa. O envio complementar depois de uma ligação só é permitido
  quando o resultado for `nao_atendeu`; `sem_interesse` registra a ligação e pausa o lead
  atomicamente no PostgreSQL.
- Logs de IA usados pela Central devem levar `empresaId`/`empresa_id`, referência e número do
  cliente para que Uso & Custo permaneça isolado por tenant.

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
