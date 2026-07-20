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
- `AI_REPAIR_MAX_RETRIES`: nº máximo de retries de reparo quando a IA não emite `reuniao_escolha` em turno de agenda (default `1`; `0` desliga). Cada retry é +1 chamada LLM e é logado como `[ai-repair]`.
- `REUNIAO_BUFFER_MIN`: folga em minutos exigida ENTRE reuniões (default `30`; `0` desliga). Reflete em 3 pontos da agenda: oferta de horários (`slotsLivresDoDia`), validação da escolha (`validarSlotReuniao`) e criação do evento (`criarEventoAgenda`, só tipo `reuniao`). A reunião gravada mantém a duração real (15 min); o buffer só afeta o espaçamento.
- Seletor autônomo de mercado da **Busca IA** (`selecionarMercadoDiarioIA` em `prospecting.js`): só roda quando `modo_busca='ia'`. A IA recebe o raio-x dos mercados já prospectados e as preferências simples do operador, então escolhe um `{nicho, cidade}` fresco (gpt-4o-mini); a busca no Maps segue programática. **Sem fallback para rotação heurística**: tem RETRY (`PROSPEC_MERCADO_IA_RETRIES`, default 3); se todas as tentativas falharem, o erro é registrado com `logger.error`, o estado vira `sem_mercados`/`erro` e o ciclo fica pausado até o operador ajustar ou tentar novamente.
- `PROSPEC_MERCADO_IA_RETRIES`: nº de tentativas da IA ao escolher o mercado do dia (default `3`).
- Atribuição Meta Ads (CTWA) em `src/services/meta-attribution.js`, chamada a cada ~10 min pelo worker (`sincronizarAtribuicaoMetaAds`): captura de qual anúncio cada lead veio (lê `public."Message".contextInfo.externalAdReply`; telefone real em `key.remoteJidAlt`) → grava `vendas.lead_profiles.origem='meta_ads'` + `origem_anuncio` jsonb `{ad_id, ctwa_clid, title, source_url}`; e recalcula `score_lead` por CRITÉRIOS (determinístico, `calcularScoreLeadDeterministico`) p/ leads ativos. `score_lead >= META_QUALIFIED_LEAD_MIN` (default 60) = "QualifiedLead".
- `META_QUALIFIED_LEAD_MIN`: score mínimo (0-100) p/ um lead virar "qualificado" e disparar `LeadSubmitted` à Meta (default `60`). Reunião agendada também qualifica.
- `META_DATASET_ID` / `META_CAPI_TOKEN`: conjunto de dados + token da Conversions API do Meta (envio de eventos CTWA). Secretos, só no Railway; sem eles o envio fica desligado.
- `META_PAGE_ID` (ou `META_WABA_ID`): ID da Página do Facebook dos anúncios CTWA (ou da conta WhatsApp Business). **Obrigatório p/ a CAPI funcionar** — `action_source=business_messaging` exige `page_id` OU `whatsapp_business_account_id` no `user_data` (senão a Meta rejeita com subcode 2804116). Atenção: CTWA só aceita os eventos `LeadSubmitted` (lead qualificado/com reunião) e `Purchase` (venda) — nomes de pixel (Lead/QualifiedLead/Schedule/MeetingCompleted) são rejeitados (subcode 2804066).

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
- **Aquisição é SÓ BUSCA (agora via Bright Data Maps, assíncrona):** a fonte de dados passou do **Google Places API** para o **Bright Data "Google Maps full information"** (Discover by location). `pesquisarPlaces` não busca mais na hora — **dispara o job (minutos) e ENFILEIRA em `prospectador.busca_snapshots`** (migration `024`); o worker `processarBuscasPlacesPendentes` (tick 60s em `agent.js`) acompanha o job (`progress`), e quando fica `ready` baixa os registros → adapter (`places-brightdata.js`) → `mapearPlace` → `salvarProspects`. Dedup por `place_id` (formato Google, compatível) e **teto fixo de 200 resultados importados por busca**, aplicado no backend mesmo que a Bright Data devolva mais registros. O disparo automático de ENVIO foi **removido do tick** (`agent.js` não chama `verificarAgendaDiariaProspeccao`). A página `dashboard/prospeccao` só encontra leads e alimenta o Banco de Leads — menu inline (sem modal/Agenda duplicada) e três modos explícitos: **Manual**, **Automático fixo** e **Busca IA**. Os modos automáticos usam intervalo mínimo de 6 horas, no máximo 2 buscas/dia, uma coleta ativa por empresa e estados operacionais persistidos; no IA, o operador escolhe estratégia, nichos/regiões permitidos e se aceita nichos relacionados. O worker `verificarAgendaBuscaRecorrenteProspeccao` não depende do campo legado `ativo`; depois de resultados zerados, o fixo informa mercado esgotado e a IA escolhe outro mercado. A aba Instagram segue o mesmo padrão de menu inline e reusa campanhas/worker social. **Todo envio de WhatsApp acontece no Banco de Leads.** `GOOGLE_PLACES_API_KEY` deixou de ser usada pela busca.
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
