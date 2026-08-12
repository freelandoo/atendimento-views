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
- `AI_PROVIDER` / `AI_MODEL`, `EVOLUTION_URL`, `OPERATOR_WHATSAPP`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_CSE_KEY`/`GOOGLE_CSE_ID`.
- **`EVOLUTION_INSTANCE` está APOSENTADA** (Fase 2 do escopo por instância): nenhum código a lê.
  Ver "Instância de ENVIO" abaixo.
- `DASHBOARD_URL`: URL base do painel usada no link do alerta de handoff (ex.: `https://app.exemplo.com`). Sem ela, cai para `RAILWAY_PUBLIC_DOMAIN` e, por fim, para o padrão de produção (`https://atendimento-views-production.up.railway.app`). **O padrão anterior (`pjcodeworks-agent-production…`) já não existia** — o edge do Railway respondia "Application not found"; corrigido em 2026-08-08.
- `AI_STRUCTURED_OUTPUTS`: liga/desliga o Structured Outputs (json_schema strict) no caminho OpenAI do agente. Default ligado; `off` volta para `json_object`. Se a API recusar o schema, há fallback automático para `json_object`.
- `AI_AUX_MODEL`: modelo das chamadas AUXILIARES/leves (ex.: `classificar_intencao` em `agent.js`). Sem ela, usa um modelo PEQUENO do provider ATIVO (`AI_PROVIDER`): `openai`→`gpt-4o-mini`, `anthropic`→`claude-haiku-4-5-20251001`. Antes o modelo era fixo em Haiku, que o `generateAIResponse` roteia sempre p/ Anthropic — então com `AI_PROVIDER=openai` toda chamada auxiliar tomava 400/timeout na Anthropic e caía no fallback heurístico. Defina só para forçar um modelo específico (o valor precisa começar com o prefixo do provider ativo: `gpt-`/`claude-`).
- `AI_AUX_CAPABLE_MODEL`: modelo das chamadas auxiliares que exigem um modelo CAPAZ/grande (ex.: `aplicar_overlay_aprendizado` — reescrita de prompt). Sem ela, usa o modelo GRANDE do provider ATIVO: `openai`→`gpt-4o`, `anthropic`→`claude-sonnet-4-6`. Mesma motivação do `AI_AUX_MODEL` (antes fixava Sonnet e tomava 400 na Anthropic com `AI_PROVIDER=openai`).
- `AI_REPAIR_MAX_RETRIES`: nº máximo de retries de reparo quando a IA não emite `reuniao_escolha` em turno de agenda (default `1`; `0` desliga). Cada retry é +1 chamada LLM e é logado como `[ai-repair]`.
- `REUNIAO_BUFFER_MIN`: folga em minutos exigida ENTRE reuniões (default `30`; `0` desliga). Reflete em 3 pontos da agenda: oferta de horários (`slotsLivresDoDia`), validação da escolha (`validarSlotReuniao`) e criação do evento (`criarEventoAgenda`, só tipo `reuniao`). A reunião gravada mantém a duração real (15 min); o buffer só afeta o espaçamento.
- Seletor autônomo de mercado da **Busca IA** (`selecionarMercadoDiarioIA` em `prospecting.js`): só roda quando `modo_busca='ia'`. A IA recebe o raio-x dos mercados já prospectados e as preferências simples do operador, então escolhe um `{nicho, cidade}` fresco (gpt-4o-mini); a busca no Maps segue programática. **Sem fallback para rotação heurística**: tem RETRY (`PROSPEC_MERCADO_IA_RETRIES`, default 3); se todas as tentativas falharem, o erro é registrado com `logger.error`, o estado vira `sem_mercados`/`erro` e o ciclo fica pausado até o operador ajustar ou tentar novamente.
- `PROSPEC_MERCADO_IA_RETRIES`: nº de tentativas da IA ao escolher o mercado do dia (default `3`).
- `src/services/meta-attribution.js`, chamado a cada ~10 min pelo worker (`sincronizarAtribuicaoMetaAds`): hoje faz **só** o recálculo determinístico de `score_lead` (`calcularScoreLeadDeterministico`) dos leads ativos. **Não envia nada à Meta e não captura mais atribuição** (bloco abaixo).

### Quarentena de webhook — o fallback para a PJ foi REMOVIDO
- **Defeito corrigido:** `resolveEmpresaFromWebhook` devolvia o `empresa_id` da PJ nos três
  casos em que não conseguia provar a origem (payload sem instância, instância não mapeada
  ou inativa, erro de consulta). O atendimento seguia normalmente e gravava **conversa,
  perfil de lead e evento comercial de um negócio que não é a PJ dentro do tenant da PJ**.
  Medido em produção em 2026-08-08: das 6 conversas marcadas como PJ, apenas **1** era PJ.
- **Não existe empresa padrão para uma mensagem sem origem provada.** `req.empresaId` fica
  **NULO** e o middleware publica `req.tenantPendencia`. O webhook (`barrarSemDonoComprovado`
  em `webhook-handler.js`) **para o fluxo inteiro** logo após o 2xx: nada de conversa, lead,
  reunião, atribuição CTWA, follow-up, resposta automática, evento de saúde de instância ou
  evento Meta. Vale para **todo evento**, não só `messages.upsert`.
- **Nenhum resolvedor de empresa por instância tem fallback**, nem os que o webhook não usa.
  `resolverEmpresaPorInstance` (`src/db/whatsapp-instances.js`) devolvia a PJ nos três casos
  (nome ausente, instância não mapeada, erro de consulta) e hoje devolve **`null`**; falha
  técnica **não** é cacheada, para a próxima tentativa reconsultar o banco. Ela não tinha
  chamador de produção quando o fallback foi removido — o resolvedor do webhook é
  `findEmpresaEInstanciaPorEvolution` (`src/db/empresas.js`) —, mas um fallback sem chamador
  é só um fallback esperando um chamador. Guarda de regressão em `test/multitenant.test.js`
  falha se o UUID da PJ voltar ao fonte do módulo.
- **A quarentena NÃO guarda payload** (nem cifrado), nem telefone, texto, pushName,
  `ctwa_clid` ou id de mensagem em claro. Guardar a conversa de um negócio sem dono conhecido
  seria criar o mesmo dado sujo, só que em repouso e sem ninguém para responder por ele.
  **Consequência declarada e aceita: a mensagem em quarentena NÃO é reencenada** — e, desde a
  regra de origem autorizada, também não há como "religar" a instância bloqueada: o número só
  volta a ser atendido por uma instância CRIADA pelo Atendimento Views, que nasce com outro
  nome técnico. Recupera-se o atendimento, nunca o histórico.
- **Schema:** migration `060_webhook_quarentena.sql` → `app.webhook_quarentena`. Uma linha por
  **instância + motivo** (índice único PARCIAL, só entre as abertas), não uma por mensagem: um
  número mal configurado produz milhares de webhooks e a tela precisa dizer "esta instância
  está órfã". `instancia_chave` existe porque `evolution_instance` é NULLABLE e NULL não colide
  com NULL em índice único. `ocorrencias` só cresce quando `ultima_mensagem_hash` (SHA-256 do
  id da mensagem) muda — **reentrega do mesmo webhook não infla o contador**.
- **Os três motivos são distintos de propósito:** `sem_instancia` (corrigir o webhook na
  Evolution) · `instancia_desconhecida` (a instância não tem vínculo autorizado) ·
  `erro_resolucao` (falha TÉCNICA transitória). Numa consulta que falhou o vínculo chega nulo
  pelo mesmo motivo que chegaria se a instância não existisse; tratar as duas igual mandaria o
  operador procurar cadastro onde o problema é o serviço. O erro é checado **antes** do vínculo.
- **A pendência é PERMANENTE e a tela é SOMENTE LEITURA** (ver "Origem autorizada" abaixo).
  `POST /api/webhook-quarentena/:id/reprocessar`, `resolverPendencia`, `buscarPendencia` e o
  botão "Reprocessar" **foram REMOVIDOS**: fechavam a pendência assim que alguém cadastrasse a
  instância à mão, o que é regularizar por tela administrativa uma instância que não nasceu do
  fluxo autorizado. **Não reintroduza** — a ação do motivo `instancia_desconhecida` deixou de
  ser `mapear_instancia` e virou `auditar_origem_instancia` justamente para isso. As colunas
  `resolvida_*` da migration 060 continuam existindo e sendo LIDAS (há linhas fechadas pelo
  fluxo antigo, que seguem consultáveis como histórico); nada mais as escreve.
- **Rota GLOBAL** (`/api/webhook-quarentena`, admin-only, **só `GET /`**), fora de
  `/api/empresas/:empresaId`: a pendência é justamente o caso em que não se sabe a empresa;
  pendurá-la num tenant exigiria escolher um.
- **Falhar ao registrar a pendência NÃO libera o fluxo** — preferimos perder o registro a
  gravar dado sob a empresa errada.
- Código: regras PURAS em `src/services/webhook-quarentena.js` (dono do vocabulário
  `ORIGEM_EMPRESA`), SQL em `src/db/webhook-quarentena.js`, barreira em
  `src/webhook-handler.js`, resolução em `src/middleware/tenant.js`, rota em
  `src/routes/api-webhook-quarentena.js`. Front: `frontend/components/PendenciasInstancia.tsx`
  ("Instâncias bloqueadas", dentro de **Configurações › Instâncias**; a seção se esconde quando
  não há nada bloqueado e **não tem nenhum botão de ação**) +
  `frontend/lib/pendencias-instancia.js` (+ `.d.ts`/`.test.js`, só TRADUZ o veredito da API).
  Testes: `test/webhook-quarentena.test.js`, `test/webhook-quarentena-handler.test.js`,
  `test/instancia-origem.test.js`.
- **Risco operacional declarado:** um número cuja instância não foi criada pelo Atendimento
  Views **não é atendido**, e não há como liberá-lo por tela. É o comportamento correto por
  isolamento — o custo é operacional, não de dado — e é o que a tela de instâncias bloqueadas
  existe para tornar visível. O caminho é criar a instância pelo produto (nome técnico novo).
- Nenhuma variável de ambiente nova foi criada para este módulo.

### Origem AUTORIZADA do vínculo empresa↔instância (não existe adoção)
- **Regra de negócio:** uma instância só tem vínculo com uma empresa quando foi **CRIADA pelo
  Atendimento Views**, dentro daquela empresa. Instância criada direto no Evolution (API
  externa, painel da infraestrutura, script) **não pertence a empresa alguma** dentro do
  produto e **não pode ser regularizada** — nem por tela, nem por rota, nem por reprocessamento.
  Um vínculo criado DEPOIS não prova nada sobre como a instância nasceu.
- **Defeito corrigido:** `POST /api/empresas/:empresaId/whatsapp` **engolia** o 403/409
  "already in use" do Evolution (variável `alreadyExists`) e gravava o vínculo assim mesmo.
  Bastava digitar o nome de uma instância criada por fora para o produto adotá-la e passar a
  atendê-la. Agora esse caso **RECUSA** com `409 INSTANCIA_JA_EXISTE_NO_EVOLUTION`.
  **PROIBIDO** reintroduzir qualquer variação de "se já existe, segue mesmo assim".
- **Evidência persistente, na mesma transação do vínculo** (migration
  `061_instancia_origem_autorizada.sql`): `origem_vinculo` (`atendimento_views` | `legado`,
  CHECK fechado, **NOT NULL e SEM DEFAULT** — um DEFAULT autorizaria silenciosamente qualquer
  INSERT futuro que esquecesse a coluna), `origem_vinculo_em` e `origem_vinculo_usuario_id`.
- **`legado` NÃO é origem autorizada: é a ausência de prova, nomeada.** A migration marca
  assim todas as linhas que já existiam (**mutação de dado declarada**). Elas **continuam
  atendendo** — carência decidida com o operador, porque exigir prova delas pararia todos os
  números já conectados até cada um ser recriado. **Risco residual aceito:** se alguma foi
  adotada de fora pelo defeito acima, segue atendendo até ser removida à mão; por isso a tela
  de instâncias marca "vínculo legado · origem não comprovada".
- **São TRÊS os pontos que criam vínculo**, todos autorizados e todos gravando a evidência:
  `routes/api-whatsapp.js` (QR Code), `routes/api-freelandoo.js` e
  `routes/freelandoo-provision.js` (nome técnico `fl-…` gerado pelo próprio produto; o
  provisionamento é máquina-a-máquina e grava `origem_vinculo_usuario_id` nulo). Um quarto
  ponto quebra `test/instancia-origem.test.js` de propósito.
- **Compensação:** se a transação do vínculo falhar depois de criar a instância no Evolution,
  a rota **apaga a instância lá**. Sem isso ela ficaria órfã e, como o produto não adota
  instância externa, o operador ficaria impedido para sempre de reusar aquele nome. A exceção
  é o `23505` (nome já usado por outro vínculo no banco): ali **não** se apaga, para não
  derrubar um número que está operando.
- Código: vocabulário PURO em `src/services/instancia-origem.js` (`origemComprovada` só aceita
  `atendimento_views`; `evidenciaDeOrigemAutorizada` **não recebe a origem como parâmetro**, de
  propósito). Front: selo de vínculo legado em `frontend/components/InstanciasWhatsApp.tsx`.
  Testes: `test/instancia-origem.test.js` (inclui guardas de regressão que leem o fonte).
- Nenhuma variável de ambiente nova foi criada para este módulo.

### Atribuição CTWA — capturada NO WEBHOOK, por empresa **e** instância
- ⚠️ **A captura antiga (mineração do banco do Evolution) nunca funcionou, e não era falta de dado.** Medido em produção (2026-08-08), em três camadas independentes:
  1. **Schema errado.** O código procurava `public."Message"`; a tabela do Evolution é `evolution."Message"` — **mesmo banco**, outro schema (`public` está vazio). `to_regclass` devolvia null e a função virava **no-op silencioso** a cada tick.
  2. **`key.remoteJidAlt` não existe** nesta versão: a coluna `key` guarda só `{fromMe, id, remoteJid}`. Era justamente o campo de onde o código tirava o telefone.
  3. **O lead de anúncio chega como `@lid`, não como telefone.** Das 526 mensagens com `externalAdReply` (509 com `ctwaClid`, 18 anúncios distintos), **100%** têm `remoteJid` `@lid`. Não há tradução `@lid` → telefone em `Contact`/`Chat`: 251 telefones de anúncio, **0** casam com `vendas.conversas`.
  A varredura foi **REMOVIDA**. Há guarda de regressão em `test/ctwa-atribuicao.test.js` que falha se `public."Message"`, `to_regclass`, `remoteJidAlt` ou `origem_anuncio` voltarem ao código de atribuição. **Não reintroduza:** não tem como funcionar.
- **A captura vive no WEBHOOK** (`src/webhook-handler.js` → `capturarAtribuicaoAnuncio`, regras puras em `src/services/ctwa-atribuicao.js`), único ponto onde coexistem o **telefone real** (`vendas.conversas.numero` é `@s.whatsapp.net` em 100% das conversas), a **empresa resolvida pela instância** e a **instância de origem**. `externalAdReply` é procurado nos DOIS formatos possíveis — `data.contextInfo` (normalizado pelo Evolution) e `data.message.<tipo>.contextInfo` (nativo do Baileys) — porque escolher um exigiria saber de antemão qual a versão emite.
- **Atribuição só é ELEGÍVEL com dono COMPROVADO.** `middleware/tenant.js` publica `req.empresaOrigem` (`instancia` | `sem_instancia` | `instancia_desconhecida` | `erro_resolucao`) e `req.whatsappInstanciaId`. Só `instancia` comprova. Empresa e instância **nunca** são inferidas pelo telefone. Os três valores não-comprovados são também os motivos da **quarentena** (bloco abaixo) — vocabulário único, definido em `src/services/webhook-quarentena.js` e reexportado por `ctwa-atribuicao.js`.
- **Sem dono comprovado, NÃO se grava nada** — o motivo (`empresa_nao_comprovada`, `instancia_nao_comprovada`, `telefone_nao_resolvido`, `sem_id_mensagem`) vai só para o log, sem PII. Escrever um telefone sob uma empresa que só o fallback resolveu produziria exatamente o dado sujo que esta captura existe para evitar. Anúncio **sem `ctwa_clid`** é gravado, mas nasce `atribuicao_confiavel=false` (motivo `sem_ctwa_clid`): fica auditável e jamais é enviado.
- **Schema:** migration `059_atribuicao_ctwa_webhook.sql` → `app.atribuicao_anuncios` (`empresa_id` e `instancia_id` **NOT NULL**). **Tabela própria, não mais uma coluna em `vendas.lead_profiles`**: aquela tabela é chaveada por telefone GLOBAL (`UNIQUE (numero)`), e atribuição de anúncio é fato **de uma instância** — o mesmo número pode falar com dois negócios.
- **Idempotência por `(empresa_id, mensagem_id)`**, nunca por telefone. A chave é o id da mensagem que trouxe o anúncio: reentrega/retry não duplicam, e um clique NOVO (mensagem nova) continua virando linha nova. Corrige o modelo antigo, que deduplicava por telefone e congelava o lead numa única atribuição para sempre.
- **`ctwa_clid` é persistido em claro** porque a Conversions API o exige no envio (mesma escolha do sistema legado), mas **NENHUMA rota o devolve**: a API expõe `ctwa_clid_hint` (4 últimos) e telefone mascarado, sanitizados na origem em `src/db/atribuicao-anuncios.js`. Payload cru do webhook **não** é guardado nem logado.
- **A Meta lê exclusivamente a fonte nova:** `meta-dispatch.js` resolve `temAtribuicao` em `marcarAtribuicao` e o `ctwa_clid` em `carregarAtribuicoes`, ambos sobre `app.atribuicao_anuncios` escopado por empresa. `obterResultadosAnunciosMeta` foi repontado para a mesma tabela (aceita `instanciaId` opcional) — antes lia `origem_anuncio`, que nunca foi preenchido, e datava por `public."Message"`: o painel **sempre devolveu lista vazia**.
- **API:** `GET /api/empresas/:empresaId/integracoes/meta/atribuicoes` (admin-only + `requireEmpresaAccess`, `?instancia_id=` opcional) devolve histórico sanitizado + resumo por anúncio.
- Código: `src/services/ctwa-atribuicao.js` (PURO), `src/db/atribuicao-anuncios.js`, `src/webhook-handler.js`, `src/middleware/tenant.js`, `src/db/empresas.js` (`findEmpresaEInstanciaPorEvolution` substituiu `findEmpresaByEvolutionInstance`, que tinha o middleware como único chamador). Testes: `test/ctwa-atribuicao.test.js`, `test/atribuicao-webhook.test.js`.
- **Pendência declarada:** falta **confirmar ao vivo** que `externalAdReply` chega no payload do webhook. É a única suposição em aberto — use `CTWA_WEBHOOK_DIAGNOSTICO=on` (abaixo) e desligue depois.
- `CTWA_WEBHOOK_DIAGNOSTICO`: **temporária.** `on` faz o webhook logar, por mensagem, um resumo **sem PII** (presença/ausência do bloco, caminho no payload, nomes de campo de lista fechada, procedência da empresa, se havia instância). Nunca telefone, texto, `ctwa_clid`, `ad_id`, URL, id de mensagem ou payload cru. Default desligado. **Remova a chamada em `webhook-handler.js` depois da confirmação.**
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

### Escopo por INSTÂNCIA de WhatsApp — só a MEDIÇÃO existe (Fase 0)
- **Nada foi implementado além do diagnóstico.** A análise de impacto completa (mapa de
  entidades/rotas/jobs, matriz global × por instância × compartilhado, riscos, proposta de
  arquitetura, plano em 10 fases e as 8 decisões pendentes) está em
  `docs/analise-contexto-instancia.md`. **Leia-a antes de escrever qualquer código deste tema.**
- **Medição read-only:** `npm run medir:escopo-instancia` (`scripts/medir-escopo-instancia.js`;
  `--nomes` revela o rótulo das instâncias, `--json` devolve a saída completa). Mesmo padrão do
  `medir:isolamento-empresa`: `BEGIN TRANSACTION READ ONLY` + `ROLLBACK`, `DATABASE_URL`
  explícita (o script **nunca** escolhe banco sozinho), só contagens agregadas, ids mascarados,
  zero chamada externa, zero dependência nova.
- **A regra que o script encarna: não se inventa dono.** Conversa sem `evolution_instance` não
  tem vínculo **provado** com instância alguma — agrupar por `c.empresa_id` é informativo, nunca
  prova (aquele `empresa_id` pode ter vindo do antigo fallback da PJ). Por isso
  `classificarAtribuibilidade` é conservadora: empresa com **1** instância ativa = `atribuivel`;
  com **2+** = **`nao_atribuivel`** (escolher uma repetiria, agora em repouso e permanente, o
  defeito do fallback "instância mais recentemente atualizada" de `whatsapp.js:51-60`); conversa
  sem empresa = `quarentena_analitica`.
- **Guarda de regressão** em `test/medir-escopo-instancia.test.js`: lê o fonte do script e falha
  se aparecer qualquer verbo de escrita (`INSERT`/`UPDATE`/`DELETE`/`ALTER`/`CREATE`/`DROP`/
  `TRUNCATE`/`SELECT … INTO`/`FOR UPDATE`), se o `READ ONLY`/`ROLLBACK` sumir, se surgir cliente
  HTTP ou envio de mensagem, ou se uma dependência nova for exigida. O script roda contra
  produção: a promessa de "somente leitura" precisa quebrar o build quando violada.
- **Defeito que a medição NÃO corrige e que continua aberto:** teto diário de disparo contado
  por instância mas configurado por empresa (`banco_leads_config`) — é a Fase 8. Os outros dois
  (envio pela instância errada e precedência divergente de escrita) foram corrigidos na **Fase 2**,
  bloco abaixo. Nenhuma variável de ambiente nova, nenhuma migration, nenhuma rota.

### Instância de ENVIO — regra ÚNICA, sem fallback (Fase 2)
- **Regra de negócio:** só sai mensagem por instância **NOMEADA por um vínculo provado**, que
  **exista**, esteja **ativa**, seja do canal **WhatsApp/Evolution** e pertença à **mesma
  empresa** da conversa e do chamador. São exatamente duas fontes de nome, nesta ordem:
  (1) `opts.instanceName`, declarado pelo chamador; (2) `vendas.conversas.evolution_instance`,
  gravado quando a conversa nasceu. **Não existe terceira etapa.** Sem nenhuma das duas, o envio
  é **BLOQUEADO de forma auditável** (`ErroInstanciaEnvio`, `code: INSTANCIA_NAO_COMPROVADA`,
  HTTP 409) — nunca por "a empresa só tem uma instância", por `atualizado_em` ou por env.
- **Defeito corrigido (o mais grave, já ativo em produção):** `whatsapp.js` resolvia em três
  passos e os dois últimos eram invenção de dono — **(2b)** `ORDER BY atualizado_em DESC LIMIT 1`
  entre as instâncias ativas da empresa (um `PATCH` de configuração em qualquer instância trocava
  o número por onde o follow-up de todos os leads sem instância gravada saía) e **(3)**
  `process.env.EVOLUTION_INSTANCE || 'PJ'`, que **ignora a empresa por completo**. É o mesmo
  defeito que a quarentena de webhook (migration 060) removeu da ENTRADA, e que seguia vivo na
  SAÍDA. **PROIBIDO reintroduzir qualquer variação.**
- **Defeito corrigido (2):** mesmo quem passava `instanceName` **não tinha o nome verificado** —
  não se checava se aquela instância existia, estava ativa, era do canal certo ou era da empresa
  daquela conversa. Hoje o nome escolhido é sempre CONFERIDO no banco.
- **Fonte de verdade: `src/services/instancia-envio.js`** (PURO — sem banco, HTTP, IA ou rede),
  dono do vocabulário (`MOTIVOS_BLOQUEIO`, `ORIGENS_NOME`, `ErroInstanciaEnvio`) e do julgamento
  (`nomeParaEnvio` + `validarInstanciaParaEnvio`). O I/O e o **único chokepoint** vivem em
  `src/whatsapp.js` → `resolverInstanciaEnvio(numero, { instanceName?, empresaId? })`. Ele não
  responde "qual instância usar?", e sim "**esta instância está provada para este envio?**" —
  a primeira pergunta admite resposta por heurística, e foi ela que produziu o defeito.
- **A empresa é conferida contra DUAS fontes** (a da conversa e a declarada pelo chamador),
  porque conferir só uma deixaria passar a conversa órfã (`empresa_id` nulo) usada por um
  chamador de outro tenant. Conversa órfã **continua enviando** pela instância gravada nela — o
  dono efetivo passa a ser o `empresa_id` da própria instância, que é NOT NULL no schema.
- **A direção do cruzamento importa:** é "a instância nomeada pertence à empresa esperada?",
  nunca "a empresa escolhe uma instância". A segunda direção é a que inventa dono.
- **Instância explícita diferente da gravada na conversa é ACEITA** (mesma empresa) — é escolha
  humana: disparo do Banco de Leads, teste de número. Ela fica no log
  (`Envio por instancia diferente da gravada na conversa`) e **não migra a conversa**.
- **D-8 — a instância gravada na conversa é PRESERVADA.** `db-crud.js` (`salvarConversa`, o
  caminho do webhook e o mais quente) fazia `COALESCE(EXCLUDED, existente)`: a conversa **migrava
  de número sozinha** quando o lead escrevia para um segundo número da empresa, enquanto
  `historico-envio.js:71` e `conversa-manual.js` preservavam. Os três agora preservam
  (`COALESCE(NULLIF(BTRIM(existente),''), EXCLUDED)`). **Consequência declarada e aceita:** se o
  lead passar a falar com outro número da mesma empresa, as respostas continuam saindo pelo
  número ORIGINAL — a conversa é uma só (`vendas.conversas.numero` é UNIQUE GLOBAL) e trocar o
  remetente no meio confundiria o cliente. Mudar o vínculo passa a ser ato explícito.
- **Chamadores cobertos:** `followup-execution.js` (declara `empresaId`), `agenda.js` (lembrete e
  sugestão de reagendamento, com a instância do join da conversa), `prospecting.js` +
  `services/prospecting-send-worker.js` (empresa do prospect), `services/followup-manual.js`,
  `services/conversa-manual.js` (**consome** a regra única; o SQL próprio dele, que carregava o
  mesmo fallback por `atualizado_em`, foi REMOVIDO), `handoff-alerts.js` e `operator-commands.js`.
- **Alerta ao operador sai pela instância do LEAD que o originou** (`notificarVictorWhatsapp(texto,
  { conversaNumero })`): o alerta sobre o lead da empresa X tem de sair pelo número da empresa X.
  **Comandos do operador no WhatsApp são respondidos pela MESMA instância que recebeu a mensagem
  dele** (`req.evolutionInstance`, já provado pelo middleware) — `processarComandosOperadorChat`
  recebe `{ instanceName }` do webhook.
- **Download de mídia também é chamada A UMA instância:** `evolutionObterBase64Midia` recebe a
  instância provada pelo webhook (`extrairTextoEMidiaDoWebhook(msg, { instanceName })`); antes
  usava a instância do env e só funcionava enquanto existia uma.
- **Diagnósticos corrigidos:** `verificarStatusInstanciaEvolution` e `numerosSemWhatsapp` **exigem**
  o nome. Sem ele, o primeiro devolve `state: 'nao_informada'` sem consultar a Evolution e o
  segundo devolve `null` ("não deu para checar", contrato que já existia) — antes os dois mediam
  a instância do env e respondiam sobre um número que podia não ser o perguntado.
  `GET /dashboard/prospeccao/whatsapp/status` passou a aceitar `?instancia=`.
- **Rotas legadas `/dashboard/whatsapp/*`** deixaram de ler `EVOLUTION_INSTANCE`: o nome vem de
  `vendas.whatsapp_connections.instance_name` do próprio usuário; sem vínculo, **409**. O `INSERT`
  de `connect`, que criava o vínculo com o nome do env, foi **removido** (era adoção de instância
  por nome não comprovado — o mesmo que a regra de "origem autorizada" proíbe) e não substituído.
- **Consequências declaradas e aceitas (coisas que DEIXAM de sair):** (a) o **resumo diário da
  agenda** e (b) o **relatório diário de prospecção aos operadores** falam do DIA, não de um lead
  — não há instância comprovada por onde enviá-los, então são bloqueados e registrados (no caso
  do relatório, por operador, em `metadata_json.envio_operadores`, status `falhou_envio`);
  (c) o **disparo legado de prospecção** (`/dashboard/prospeccao/disparos/enviar`) não abordará
  prospect que ainda não tem conversa — a 1ª mensagem precisa de um número escolhido, e escolher
  por ele era o defeito; o caminho suportado é o "Rodar leads" do Banco de Leads, que já escolhe.
- **Funções REMOVIDAS de `src/whatsapp.js`:** a constante `INSTANCE_NAME`, `getInstanceNameForUser`
  (sem chamador, e só existia para devolver o env) e `getInstanceNameForConversation` (substituída
  por `resolverInstanciaEnvio`).
- Testes: `test/instancia-envio.test.js` — a regra pura **e** guardas de regressão que leem o
  fonte e falham se voltarem `EVOLUTION_INSTANCE`, `INSTANCE_NAME`, o literal `'PJ'`, a ordenação
  por `atualizado_em`, o `COALESCE(EXCLUDED, …)` do D-8, ou se `conversa-manual.js` voltar a
  consultar `empresa_whatsapp_instances` por conta própria. **Nenhuma variável de ambiente nova,
  nenhuma migration, nenhuma rota nova.**

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

### Central de Follow-ups — FILA ÚNICA de ações (as abas viraram filtros)
- Página admin multiempresa em `frontend/app/dashboard/follow-ups`, exposta pela rota
  `src/routes/api-follow-ups.js`.
- **A tela deixou de ter 3 abas** (Atendimento humano / Automático / Manual). Duas delas eram
  só a ORIGEM do item, e origem não é trabalho: hoje há **uma fila só**, ordenada pela próxima
  ação de cada conversa, com **filtros rápidos** (Todos · Aguardando · Próxima ação hoje ·
  Atendimento humano · Atendimento IA · Falhas · Concluídos) e um **filtro avançado**
  ("Personalizar filtros", painel flutuante no padrão do Banco de Leads).
- **A área "Automação" foi REMOVIDA da tela** (cards de saúde, editor de capacidade,
  "Reprocessar falhas" e a listagem de diagnóstico). Logs, telemetria e reprocessamento não
  pertencem a uma fila de trabalho. Do que ela tinha, sobrou o que é DECISÃO diária e não
  diagnóstico: o **toggle "Follow-up automático: ativo/desativado"** no cabeçalho, que é o
  mesmo `PUT /config {pausado}` de sempre. `components/ui/Abas.tsx` não é mais usado aqui.
  **Consequências declaradas e aceitas com o operador:**
  - `meta_ligacoes_dia` **deixou de ter editor**. A marca "na capacidade do dia" continua
    lendo o valor já salvo da empresa (`GET /config`, default 12) e o contrato `PUT /config`
    segue intacto — a edição volta quando a área nascer em **Configurações** (direção futura
    combinada). Enquanto isso o valor só muda pela API.
  - **"Reprocessar falhas" saiu da UI.** `POST /auto/reprocessar` **continua existindo** no
    backend e não foi tocado; o caso normal é a retomada silenciosa do próprio motor. O filtro
    rápido "Falhas" continua mostrando o que falhou.
- **Paginação de 25 por página**, com rodapé "Exibindo 1–25 de X follow-ups" e anterior/próxima.
  Reusa `frontend/lib/paginacao.js` — o MESMO módulo da Aquisição e da fila da Central de
  Ligações, apenas reexportado por `followups-fila.js` (a tela importa de um lugar só). Pagina
  **depois** de filtrar e ordenar, e a página é clampada: encolher o recorte nunca deixa o
  operador numa janela vazia. Mexer em qualquer filtro volta para a página 1.
- **Uma linha por CONVERSA, não por registro.** `GET /call-list` (próxima ação humana) e
  `GET /auto` (agendamentos do motor) falam do MESMO atendimento: quando os dois existem para
  o mesmo número, viram uma linha só — a ação humana é a próxima ação e o automático vira
  contexto (selo + data). Duas linhas recriariam, dentro da fila única, a fragmentação que as
  abas causavam. A linha aparece nos filtros "humano" **e** "IA": é verdade, não duplicidade.
- **"Todos" = o que está EM ABERTO** (ação humana pendente ou envio automático agendado).
  Concluídos, cancelados e falhas só entram pelos próprios filtros — falha é diagnóstico, não
  tarefa. **Falha NUNCA é "Aguardando"**: `SITUACAO_POR_STATUS_IA.falhou` = `falha`, e item
  humano com falha do automático fica `aberto` + `tem_falha` (nunca some da fila de trabalho).
- **Prioridade só existe onde o backend calculou.** Item que só tem follow-up automático não
  passa pelo call score: a bolinha aparece vazada e diz "prioridade não calculada". Não se
  inventa faixa — número errado numa fila de trabalho custa mais que número ausente.
- **`janela_quando`** (`'agora' | 'hoje' | 'proximo_dia_util'`) é publicado por
  `services/followup-call-score.js` junto da frase da janela, pela MESMA avaliação
  (`avaliarJanelaAcao`), e repassado por `montarCallList`. Existe para o filtro "próxima ação
  hoje" não depender de a tela interpretar a frase — regra de negócio no front quebraria em
  silêncio ao mudar o texto. Campo **aditivo**: nenhum consumidor anterior mudou.
- **O "Manual" NÃO virou filtro**: é um compositor de mensagem 1:1 (função distinta não vira
  filtro). Virou o botão "Follow-up manual" do cabeçalho da fila, reaproveitado pelos itens
  cuja ação recomendada é escrever manualmente. Mesma geração por IA, mesma revisão humana
  antes do envio. O que mudou é a **ENTRADA**:
  - **Busca assistida** (`GET /follow-ups/manual/leads?q=`): uma caixa só aceita nome do
    negócio **ou** telefone e sugere leads que a empresa já conhece (atraso de 300 ms, estados
    de carregando/erro/nenhum resultado). Escopada em `c.empresa_id` — **sem** o fallback para
    a PJ que `api-conversas.js` faz: sugerir contato é expor dado. Curinga de `LIKE` digitado
    pelo operador (`%`, `_`) é escapado. Mínimo de 2 caracteres, teto de 20 resultados.
  - **Número sem lead existente** (`POST /follow-ups/manual/iniciar`): abre a conversa e **não
    envia nada**. Três garantias, todas travadas em `test/followup-manual-iniciar.test.js`:
    (a) a conversa nasce com **`agente_pausado = true`** — conversa criada pela mão do operador
    não é lead que chegou pelo funil, e o bot não pode assumir sozinho um número que nunca
    escreveu; despausar continua sendo ato explícito na Central de Mensagens;
    (b) é `ON CONFLICT (numero) DO NOTHING` + releitura, **nunca `DO UPDATE`** —
    `vendas.conversas.numero` é UNIQUE **GLOBAL** (`init.sql:6`), então um upsert aqui
    reescreveria a conversa de outro tenant; número de outra empresa é **recusado com 409**,
    sem adotar e sem devolver nada da linha alheia;
    (c) a origem é registrada em **`app.auditoria_eventos`** (migration `047` — **nenhuma
    tabela nova**) com `entidade_tipo='conversa'`,
    `acao='followup_manual_conversa_iniciada'`, o usuário responsável, a data e
    `contexto={origem:'follow_up_manual', telefone_digitos}`. É o que distingue esta conversa
    de uma recebida pelo webhook, de campanha ou de automação. Só na CRIAÇÃO: repetir a ação
    não infla a auditoria. Nenhum JID e nenhum texto de mensagem entram no registro.
- **Identificador técnico do Evolution NÃO aparece na interface.** As duas consultas de
  `followup-listing.js` faziam `COALESCE(NULLIF(p.apelido,''), NULLIF(p.negocio,''), c.numero)`
  — lead sem apelido/negócio aparecia na coluna "Lead" como `5511999990001@s.whatsapp.net`.
  Hoje o SQL devolve **nome NULO** e quem decide o fallback legível é a apresentação:
  `rotuloLead` (PURO) mostra o nome do negócio e, só na falta dele, o **telefone formatado**.
  `nomeDeVerdade` também **sanea linhas antigas** que ainda tragam JID ou telefone no campo
  `nome`. O desempate da ordenação e a busca usam o MESMO rótulo que está na tela — ordenar por
  um `nome` invisível daria uma ordem que o operador não consegue explicar. Guardas de
  regressão em `test/followup-listing.test.js` (lê o fonte do SQL) e em
  `lib/followups-fila.test.js`.
- **O rótulo solto "Escalado" saiu da linha.** Quem precisa de gente é dito pela própria
  próxima ação ("Ligar", "Assumir conversa") e pelo "Por que agora" — um selo ao lado do nome
  não dizia o que fazer. O campo `escalado` continua vindo do backend (`followup-listing.js`
  o calcula a partir de `followups_ignorados`) e continua alimentando a recomendação de ação.
- **`app.followup_config.modo` deixou de ser escrito pela tela.** Ele nunca foi lido por motor
  algum (`followup-auto.js` lê só `fc.pausado`); antes, clicar numa aba gravava configuração da
  empresa. Preferência de filtro é de TELA e vive no `localStorage` (`followupsFila`), como em
  Banco de Leads/Aquisição. A coluna, o CHECK da migration `031` e o contrato de `GET/PUT
  /config` continuam intactos (a config segue guardando `meta_ligacoes_dia` e `pausado`).
- Montagem da fila, filtros, contagens, chips, rótulo do lead e paginação são PUROS e testados
  em `frontend/lib/followups-fila.js` (+ `.d.ts`/`.test.js`) — a tela não decide próxima ação,
  prioridade nem estado; só junta e traduz o que as duas fontes já disseram.
- **Abrir conversa reusa `components/ConversaHistoricoModal.tsx`**, o mesmo da Central de
  Mensagens e do Banco de Leads. **Não existe um segundo modal de conversa** só para
  Follow-ups, de propósito: a fila aponta o trabalho, a Central de Mensagens contextualiza a
  conversa.
- **Lacunas declaradas (não implementadas por falta de fonte confirmada):** filtro por
  **responsável** (o item da fila não tem dono; `usuario_id` só existe em ligação já
  registrada) e por **tipo de falha** (o motor grava `motivo_decisao` em texto livre, sem
  taxonomia — o filtro possível é "motivo contém"). As duas ausências estão escritas na
  própria tela, no rodapé de cada grupo do painel de filtros.
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

### Painel de conversa — UM só, para todas as portas de entrada
- **Regra de produto:** Central de Mensagens e Central de Follow-ups são **pontos de entrada
  diferentes para a mesma conversa**. Painel, histórico, dados, permissões e ações são os
  mesmos. A origem de entrada pode mudar **apenas o destino do fechamento**.
- **Defeito corrigido:** o painel completo vivia INLINE em
  `frontend/app/dashboard/conversas/page.tsx`, e o "Abrir conversa" da fila de Follow-ups
  abria `components/ConversaHistoricoModal.tsx`, somente-leitura. Para a MESMA conversa e as
  MESMAS permissões (`GET/POST /api/empresas/:id/conversas/:numero…`, `requireAuth` +
  `requireEmpresaAccess` nos dois caminhos; `/follow-ups` é ainda mais restrito, admin-only),
  quem chegava pela fila **não tinha** compositor do operador, "Orientar resposta",
  pausar/retomar agente, reenviar WhatsApp, deletar histórico, prioridade comercial nem a aba
  de Interesses. A divergência era 100% de **apresentação** — nenhuma rota mudou.
- **Dono único: `frontend/components/ConversaPainel.tsx`.** Recebe `empresaId`, `numero`,
  `onFechar` e o opcional `onAtualizou` (avisa a lista de trás que algo mudou no servidor).
  **PROIBIDO** criar um segundo painel/modal de conversa por tela — foi exatamente isso que
  produziu duas experiências para o mesmo trabalho.
- **O painel CARREGA a conversa sozinho a partir do número.** É o que faz as três regras de
  carregamento valerem em qualquer porta de entrada: (a) estado de carregando explícito;
  (b) **token de requisição** + limpeza do estado a cada `numero` — troca rápida nunca mostra
  a conversa anterior como se fosse a nova seleção; (c) erro tem mensagem simples e
  **"Tentar de novo"**. `404` **não** é erro: é contato ainda sem conversa, e vira estado
  vazio explicativo em vez de alarme.
- **`ConversaHistoricoModal` NÃO é o painel** — sobrou para o **Banco de Leads**, por causa
  das props de gerar/enviar **saudação** (cooldown, template, "Gerar de novo"), que pertencem
  ao "Rodar leads" e não ao atendimento. Se um dia o Banco de Leads precisar do atendimento
  completo, a saída é usar `ConversaPainel` e mover a saudação — nunca inchar aquele modal.
- **Identidade humana do contato em `frontend/lib/lead-identidade.js`** (+ `.d.ts`/`.test.js`),
  módulo PURO e dono único de `nomeDeVerdade`, `formatarTelefone`, `rotuloLead` e
  `identidadeConversa`. `followups-fila.js` **reexporta** daqui (mesmo padrão de
  `paginacao.js`) — duas cópias fariam a mesma conversa aparecer com um nome na fila e outro
  no painel aberto a partir dela. O identificador técnico do Evolution nunca é a informação
  principal: o título é o **nome do negócio** e, só na falta dele, o telefone formatado. A
  listagem da Central de Mensagens passou a usar a mesma identidade (colunas "Lead" +
  "Telefone", no lugar de "Número" + "Negócio").
- **Filtros, ordenação e paginação de Follow-ups sobrevivem ao fechamento**: vivem no estado
  da página e no `localStorage`, e o painel não os toca.
- Testes: `frontend/lib/lead-identidade.test.js` (inclui guarda de regressão que lê o fonte de
  `followups-fila.js` e falha se a regra de identidade for duplicada lá).
- Nenhuma variável de ambiente nova, nenhuma rota nova, nenhuma migration.

### Modo de atuação da IA por conversa (`modo_ia`) — permissão de RESPONDER ≠ capacidade de ANALISAR
- **Regra de produto:** cada conversa tem um modo. `conversa` (default) = a IA analisa **e**
  pode responder automaticamente. `analise` = a IA analisa, registra e sugere, mas **não
  envia resposta conversacional ao cliente**. O toggle governa **uma única capacidade**; não
  é pausa global de automação.
- **`modo_ia` é coluna PRÓPRIA e NÃO se deriva de `agente_pausado`** (migration
  `063_conversa_modo_ia.sql`, aditiva, `NOT NULL DEFAULT 'conversa'`, CHECK fechado — nenhuma
  conversa existente muda de comportamento). `agente_pausado` é estado **operacional efêmero
  escrito pelo próprio sistema** (atendente respondeu, lead frio esgotado, ligação
  `sem_interesse`); `modo_ia` é **decisão persistente do operador**. Derivar um do outro faria
  a pausa automática apagar uma configuração, e a configuração sobreviver ao "Retomar agente".
  **Os dois convivem e o envio automático exige os dois liberados.** PROIBIDO fundi-los.
- **O bloqueio NÃO vive no webhook.** `webhook-handler.js` não envia nada — enfileira o job
  `webhook_resposta`, e é dentro desse turno que a IA analisa **e** redige. Um `return` no
  webhook desligaria a inteligência junto com a fala. O gate vive nos **dois enviadores**
  (`core-funnel.js` e `services/contexto2-responder.js`), depois da análise já persistida e
  imediatamente antes do `enviarMensagem`. Guarda de regressão falha se `modo_ia` reaparecer
  em `webhook-handler.js`.
- **Fonte de verdade única: `src/services/conversa-modo-ia.js`** (PURO — sem banco, HTTP, IA
  ou rede). Ele não responde "qual o modo?", e sim **"esta capacidade está liberada?"**. A
  matriz `modo × capacidade` é a regra inteira: `analise` (sempre) · `resposta_conversacional`
  (só no modo Conversa) · **`follow_up` e `agenda` (SEMPRE, nos dois modos)**. As duas últimas
  estão na matriz de propósito — é o que impede alguém de "aproveitar" o modo Análise como
  interruptor geral de automação. **PROIBIDO** comparar `modo_ia` com literal fora deste
  módulo (guarda de regressão lê o fonte de `src/**`).
- **A capacidade vem de QUEM CHAMA.** `gerarEEnviarRespostaWhatsapp` serve a resposta
  conversacional (webhook) **e** a execução de follow-up (`followup-execution.js`, que declara
  `CAPACIDADES.FOLLOW_UP`). Sem declarar, o gate barraria os dois e o toggle viraria, em
  silêncio, um interruptor de follow-up. Quem omite recebe `resposta_conversacional` — o
  default é o mais restrito.
- **Follow-up e agenda NÃO dependem do toggle.** `followup-auto.js` e `agenda.js` **não foram
  tocados** (há guarda para `agenda.js`); valem as configurações próprias
  (`app.followup_config.pausado`, pause por empresa, elegibilidade). *Consequência observada,
  não regra:* o watcher exige `historico->-1->>'role' = 'assistant'` e em Análise nada é
  anexado — conversas nesse modo raramente entram na fila dele.
- **A mensagem gerada e não entregue é DESCARTADA, nunca gravada como `assistant`** — o painel
  mostraria um balão do agente que o cliente nunca recebeu e o turno seguinte raciocinaria
  sobre uma fala inexistente. Pelo mesmo motivo `atualizarCamadaMemoriaVendasPosResposta` (que
  registra o que o agente DISSE) passou a depender de `respostaEnviadaAoLead`. Estágio,
  status, perfil, eventos e `lead_insights` continuam sendo gravados: é registro interno, que
  é justamente o que o modo Análise preserva. A **sugestão para revisão humana é o "Orientar
  resposta"** que já existe — nenhum armazenamento novo foi criado.
- **Custo declarado: o modo Análise NÃO economiza IA.** Extração e mensagem saem da MESMA
  chamada de LLM nos dois motores (`extrairEDecidirBundle`, `chamarClaudeTurno`); o turno roda
  inteiro e a mensagem é descartada.
- **Risco residual aceito:** o comando `/followup` do operador no WhatsApp cai no ramo
  "fluxo_funil" quando a última mensagem é do lead e, como follow-up é independente do modo,
  **responde o cliente mesmo em Análise**. É ação humana explícita e coerente com a regra, mas
  é a única porta por onde sai texto de IA numa conversa em Análise.
- **Rota:** `PATCH /api/empresas/:empresaId/conversas/:numero/modo-ia` (`requireAuth` +
  `requireEmpresaAccess`; modo fora da lista → 400; conversa de outra empresa → 404). **Não há
  rota de leitura**: `GET /:numero` já faz `SELECT c.*` e devolve `modo_ia` — o painel não faz
  request extra. Auditoria em `app.auditoria_eventos` (**sem tabela nova**),
  `acao='conversa_modo_ia_alterado'`, contexto `{modo_anterior, modo_novo, telefone_digitos}`
  — nunca JID nem texto. O `UPDATE` é condicionado (`IS DISTINCT FROM`) com CTE que fotografa
  o valor anterior: **repetir a ação não infla a auditoria** e o "anterior" é o real, não
  deduzido.
- **Front:** `frontend/components/ConversaPainel.tsx` (dono ÚNICO — vale para Central de
  Mensagens e Follow-ups; **não** duplicar o controle em outra tela) +
  `frontend/components/ui/AlternadorModoIa.tsx` (novo). **`Abas.tsx` não serve**: é
  `role="tablist"` com painel vinculado, e aqui não muda o que se vê, muda o comportamento com
  o cliente — por isso `role="radiogroup"` + setas + estado escrito ao lado (cor nunca é o
  único sinal) + tooltip leve em hover/foco/toque, em portal, nunca modal. Otimista com
  reversão: PATCH falhou, volta ao modo anterior. Toda tradução em
  `frontend/lib/conversa-modo-ia.js` (+ `.d.ts`/`.test.js`) — a tela só desenha.
- Testes: `test/conversa-modo-ia.test.js` (puro + guardas), `test/conversa-modo-ia-fluxo.test.js`
  (webhook nos dois modos, os dois enviadores, rota/auditoria),
  `frontend/lib/conversa-modo-ia.test.js`. Nenhuma variável de ambiente nova.

### Nome de exibição do lead — a coluna "Lead" mostra NOME, e só nome
- **Regra de produto:** a coluna Lead da Central de Mensagens exibe o melhor **nome
  automático** disponível, nesta ordem: **1. nome do WhatsApp → 2. nome do Google Maps →
  3. VAZIO**. Sem nome válido, o campo fica **vazio** — nunca um traço, **nunca o telefone**.
  O telefone tem coluna própria, ao lado.
- **Defeito corrigido (1):** a coluna mostrava o TELEFONE quando não havia nome
  (`identidadeConversa`), ou seja, o mesmo dado duas vezes na mesma linha, com o campo de nome
  afirmando algo que não é nome.
- **Defeito corrigido (2), o mais caro:** **o nome do WhatsApp era jogado fora a cada
  mensagem.** `capturarNomeContato` (`src/agent.js`) passa o `pushName` por `nomeDePushName`
  (`src/nome-contato.js`), que fica só com o **primeiro token** e recusa palavras de negócio
  (`pizzaria`, `loja`, `clinica`… na lista `NAO_NOME`) — "Pizzaria do Zé" era descartado
  INTEIRO e nada era gravado. A melhor fonte de nome do produto não existia no banco.
- **Fonte de verdade única: `src/services/lead-nome-exibicao.js`** (PURO — sem banco, HTTP, IA
  ou rede). Dono de `ORDEM_FONTES` e de `nomeValido`, que recusa vazio, JID
  (`…@s.whatsapp.net`, `…@lid`), telefone em qualquer formatação, emoji/enfeite puro (emoji
  não é `\p{L}`), uma letra só e texto genérico. **Genérico é comparado com a string INTEIRA,
  nunca por token** — senão "Cliente Feliz Pet Shop" seria recusado pela primeira palavra.
  Há guarda de regressão que lê o fonte e falha se o módulo passar a conhecer `telefone`/`numero`.
- **`lead_profiles.negocio` e `apelido` NÃO estão na ordem, de propósito.** São nome **curado**
  (extraído da conversa pela IA / filtrado por `nome-contato.js`); esta coluna mostra o nome
  **automático do canal**. **Consequência declarada e aceita (decisão do operador, 2026-08-10):**
  lead com `negocio` preenchido e pushName inválido fica com a coluna Lead **vazia**. Apelido e
  edição manual de nome estão **fora de escopo** desta etapa.
- **Schema:** migration `065_conversa_nome_whatsapp.sql` (**aditiva**, nullable, sem DEFAULT e
  sem CHECK — nenhuma linha existente é tocada) → `vendas.conversas.nome_whatsapp`, o pushName
  **cru**, preservado sem filtro. Fica na CONVERSA e não em `lead_profiles` porque o pushName é
  atributo do **canal**, chega por mensagem, e gravá-lo junto do `apelido` misturaria o valor
  bruto com o curado e mudaria o que os prompts leem.
- **A escrita NÃO toca `atualizado_em`** (`persistirNomeWhatsapp`, em `agent.js`, ao lado de
  `capturarNomeContato`): a Central ordena por ele, e um pushName repetido a cada mensagem
  reordenaria a lista sem nenhum fato novo. Só grava quando o valor **muda**
  (`IS DISTINCT FROM`). Roda **antes** do early-return do apelido, de propósito — o pushName
  pode ser um nome de negócio válido mesmo quando o filtro do apelido não aproveita nada dele.
- **O nome do Maps é UMA consulta por página, não um `LEFT JOIN LATERAL`.** O casamento
  conversa↔`prospectador.prospects` é por **telefone** (não há FK) e precisa aceitar as
  variações de formato (com/sem `55`, com/sem 9º dígito), que se geram em JS
  (`candidatosTelefoneBR`). Um LATERAL teria de reproduzir a mesma regra em SQL — duas
  implementações do mesmo casamento. `src/db/lead-nome-maps.js` manda todos os candidatos da
  página numa query só, escopada por empresa. **A expressão do `WHERE` é idêntica à expressão
  indexada** (`idx_prospects_empresa_telefone_digitos`, criado na 065): mudar uma sem a outra
  faz o índice deixar de ser usado **em silêncio** — a listagem continua correta e fica lenta.
- **Falha ao consultar o Maps não derruba a listagem:** o nome cai para o do WhatsApp, que é a
  prioridade 1 de qualquer forma.
- **`candidatosTelefoneBR` foi MOVIDO para `src/telefone-br.js`** (puro). Ele vivia dentro de
  `prospecting.js` (4.5k linhas, com rotas e workers no import); importar aquele arquivo da
  camada de dados criaria ciclo. **Movido, não duplicado** — comportamento inalterado. Isto
  **não** unifica a normalização de telefone do repo, que segue espalhada.
- **Front:** `frontend/lib/lead-identidade.js` ganhou `nomeColunaLead` (nome resolvido ou `''`).
  **A ordem de prioridade não está no front** — chega pronta em `nome_exibicao` /
  `nome_exibicao_fonte`, como em `lib/site-rotulos.js`. Guarda de regressão em
  `test/lead-nome-exibicao.test.js` falha se a tela passar a ler `nome_whatsapp`/`nome_maps`.
- **`identidadeConversa` é DELIBERADAMENTE diferente:** o título do painel de conversa e a fila
  de Follow-ups mantêm o **telefone formatado** como identificação de segurança quando não há
  nome — um cabeçalho vazio deixaria o operador sem saber que conversa abriu. A regra de "campo
  vazio" vale **especificamente para a coluna Lead**. Ali o `negocio` curado continua atrás do
  `nome_exibicao`, para o painel não perder nome que já mostrava.
- Testes: `test/lead-nome-exibicao.test.js`, `frontend/lib/lead-identidade.test.js`.
  **Nenhuma variável de ambiente nova, nenhuma rota nova.**

### Indicador de pontuação (a "bolinha") — componente ÚNICO, significado POR TELA
- **Regra que governa o módulo:** o *componente* é único; a *pontuação* não é. A mesma bolinha
  em duas telas nunca pode sugerir que 72 significa a mesma coisa nas duas.
- **Defeito corrigido (o mais grave):** na Aquisição e no Banco de Leads a completude de
  cadastro era pintada com a paleta de **prioridade comercial**
  (`score_cadastro <= 40 ? text-red-600 : … text-emerald-600`). As duas pontuações andam em
  **direções opostas** sobre o mesmo lead — site próprio **derruba** a prioridade
  (peso 0 em `ligacao-prioridade.js`) e **soma 20** na completude —, e a própria tela ordena por
  `pontos ASC`. Resultado: **o melhor lead da campanha aparecia em vermelho**. **PROIBIDO**
  reintroduzir cor de prioridade para completude; há guarda de regressão que lê o fonte das
  duas telas (`lib/pontuacao-indicador.test.js`).
- **Defeito corrigido (acessibilidade):** existiam **três** implementações da bolinha. Só a da
  Central de Ligações tinha foco por teclado, `aria-label` e tooltip em portal; a da Central de
  Mensagens tinha a geometria idêntica com `title=` apenas e **escondia os `criterios[]` que a
  API já mandava**. A unificação subiu a mais fraca para o nível da mais forte — **nunca o
  contrário**.
- **Duas variantes semânticas, e elas não compartilham cores de propósito:**
  `prioridade_comercial` (emerald = melhor; Central de Ligações e Central de Mensagens) e
  `completude_cadastro` (**paleta neutra**, mais escuro = mais preenchido; Aquisição e Banco de
  Leads). Cor nunca é o único sinal: número no círculo, rótulo em texto e o resumo inteiro no
  `aria-label`.
- **Contrato do componente** (`frontend/components/ui/BolinhaPontuacao.tsx`): `oQueMede` é
  **obrigatório** — é a única coisa que impede duas telas de parecerem medir a mesma coisa.
  `maximo` também é obrigatório e sempre exibido (`40/100`, `30/60`): **cadastro de Instagram
  vale até 60**, e "30" sozinho mentiria. `valor: null` é estado de primeira classe (bolinha
  vazada, "não calculada") — **nunca `0`**. Tooltip em **portal no `<body>`** posicionado pelo
  rect da âncora (dentro das tabelas, `overflow-hidden` cortava a versão `absolute`), somente
  leitura, fecha em `blur`/`Escape`/scroll/resize. Nunca renderiza JSON, id, UUID, `place_id`
  ou telefone.
- **A regra de pontuação NÃO vive no front.** Pesos, faixas e critérios são calculados no
  backend (`services/ligacao-prioridade.js`, `lead-interest-score.js`,
  `lead-score-cadastro.js`) e o front só **traduz o veredito**, como `lib/site-rotulos.js`.
  A tradução pura é `frontend/lib/pontuacao-indicador.js` (+ `.d.ts`/`.test.js`).
- **"Cadastro incompleto", nunca "pontuação baixa".** `leituraCadastro` rotula
  completo/parcial/incompleto com a contagem de lacunas, e os cortes são **proporcionais ao
  máximo** (70%/40%) para 30/60 ler igual a 50/100. O rodapé fixo do balão ("cadastro fraco
  costuma ser a melhor oportunidade") é o que impede a bolinha de mentir.
- **Tabelas reduzidas** (Aquisição 14 → 9 colunas; Banco de Leads com padrão enxuto). **Nada
  saiu sem destino:** avaliação, nota, horário e endereço viraram critério no tooltip + valor em
  **"Detalhes"** (`frontend/components/LeadDetalhesModal.tsx`); o **JSON cru deixou de ser
  coluna** e virou botão "Ver dados completos" dentro dos Detalhes — `JsonLeadModal` **continua
  existindo**, porque carrega o *prompt unificado*, que é ferramenta de trabalho.
- **O emoji de temperatura saiu da Aquisição.** Vinha de `prospects.score`, **congelado na
  coleta** e explicado por texto livre (`motivo_score`) de outra régua: eram duas pontuações na
  mesma linha, com escalas e direções opostas, sem a tela dizer que eram duas. `p.score`
  continua no payload e no banco.
- **A ordenação do servidor não foi perdida com as colunas.** `ORDEM_SQL_PROSPECTS` está
  intacto; a Aquisição ganhou um seletor "Ordenar por" com as ordens cujo cabeçalho saiu
  (avaliações, nota, horário, endereço). Reduzir a tabela não pode remover em silêncio a
  capacidade de varrer a carteira inteira por esses campos.
- **`localStorage` do Banco de Leads migrado de forma compatível:** `bancoLeadsView` ganhou
  `versao`. Na migração v1→v2 **filtros e ordenação são preservados integralmente** (são
  trabalho do operador) e só o conjunto de **colunas** passa a ser o novo padrão — layout, que
  volta em um clique no "⚙ Personalizar".
- **PROIBIDO** criar um segundo círculo de pontuação inline numa tela. Foi a duplicação em três
  telas que produziu paleta divergente e acessibilidade desigual; há guarda de regressão que lê
  o fonte das 5 telas e falha com a mensagem apontando o componente.
- **Fora de escopo declarado:** a bolinha de **Follow-ups** (`red = alta`, semântica de
  urgência) **não foi tocada** — padronizá-la com `emerald = melhor` é decisão de produto ainda
  em aberto, registrada em `docs/analise-indicador-pontuacao.md` §7.3. E **não existe** pontuação
  de "potencial de abordagem" no Banco de Leads: não há fonte fora de campanha, e criá-la seria
  inventar régua.
- **A coluna "Site" SAIU da Aquisição e do Banco de Leads (2026-08-10, decisão do operador).**
  Ela era o mesmo dado duas vezes na linha: `site` já é 1 dos 9 critérios da completude
  (**20 de 100 pontos**, `lead-score-cadastro.js`). Agora a situação do site é lida **dentro da
  bolinha de cadastro** e o link fica em **"Detalhes"**. Isto REVERTE a §5.1 de
  `docs/analise-indicador-pontuacao.md`, que mandava mantê-la — a nota de reversão está lá.
- **O critério de site no balão diz TRÊS situações, não o booleano do backend.** O critério que
  chega é `ok: true|false`, mas o negócio distingue `tem_site` · `sem_site` (a oportunidade) ·
  `nao_identificado` (ninguém verificou). Confundir os dois últimos é um defeito com histórico
  neste projeto. `fatoresDeCadastro(criterios, { situacaoSite, rotuloLink })` reescreve o rótulo
  daquele critério — e só dele; o 2º argumento é opcional, então quem não passa nada não muda de
  comportamento. Em `sem_site` o balão ainda qualifica o que existe no lugar ("— só rede
  social"), que é o que explica um lead **com** link aparecer como sem site.
- **O LINK não foi para o balão, e não deve ir:** o tooltip é `pointer-events-none`, então um
  link ali seria inalcançável. Ele vive em "Detalhes" (`LeadDetalhesModal`) e, no Banco de
  Leads, também na coluna "Links". **Os filtros por site continuam** nas duas telas — remover a
  coluna tirou uma exibição redundante, não o recorte de trabalho.
- **A lista de fatores vira DUAS COLUNAS a partir de 6 itens** (`usaDuasColunas`, no módulo
  puro — nunca um literal no componente). Altura é problema real, não estética: a completude do
  Places tem 9 critérios e, empilhados, o balão não cabe acima da âncora. O corte é 6 e não 4
  porque com 4-5 itens a coluna dupla economiza duas linhas e custa o dobro de largura. A ordem
  de leitura é por LINHA (grid), não `columns-2` do CSS, que quebraria itens no meio.
- **O balão VIRA PARA BAIXO quando não cabe acima**, e é preso nas bordas laterais. Abrir sempre
  para cima funcionava nas TABELAS (sempre há cabeçalho acima da 1ª linha) mas quebrava na
  **Central de Mensagens**: lá a bolinha fica no cabeçalho de um modal colado no topo da tela, e
  o balão subia para fora da viewport. A altura é **MEDIDA**, nunca estimada — o balão de
  cadastro tem 9 critérios e o de prioridade tem 2; um chute único não serviria para os dois.
- Testes: `frontend/lib/pontuacao-indicador.test.js` (inclui guarda de regressão que falha se a
  coluna "Site" voltar a qualquer uma das duas telas). Nenhuma variável de ambiente nova,
  nenhuma rota, nenhuma migration, nenhum arquivo de backend alterado.

### Follow-up como ENTIDADE — o fluxo integrado Ligações ↔ Follow-ups ↔ Mensagens
- **Gatilho formal:** `docs/PENDENCIA_ARQUITETURAL_CENTRAL_LIGACOES_E_MENSAGENS.md` congelava
  esta integração e mandava revisar a arquitetura **antes de gerar código**. A revisão foi
  feita e as quatro decisões estruturais foram aprovadas pelo operador (registradas em
  `docs/ai-decision-log.md`). **A pendência continua valendo para o que não foi feito aqui**:
  `vendas.conversas.numero` segue `UNIQUE` **GLOBAL** e a normalização de telefone segue
  espalhada — nada disso foi unificado.
- **Defeito corrigido:** **não existia a entidade "Follow-up"**. A fila era DERIVADA a cada
  request de duas fontes que não se conhecem — `montarCallList`
  (`services/followup-listing.js`, recomendação heurística, **nada persistido**) e
  `vendas.followup_auto_agendamentos` (agenda do motor de IA). Nenhuma das duas tem canal,
  responsável, origem ou status editável, então **"concluir", "reagendar" e "cancelar" não
  tinham onde ser gravados** (um item sumia da fila por efeito colateral do dedup de 12h em
  `CALLLIST_DEDUP_HORAS`). Em paralelo, a próxima ação decidida ao encerrar uma ligação era
  texto livre em `app.campanha_leads.proxima_acao` + `data_followup` (DATE, **sem hora**), e
  **nenhuma linha da Central de Follow-ups lia aquela tabela** — a decisão tomada na ligação
  era invisível para a fila.
- **Schema:** migration `062_follow_ups.sql` → `app.follow_ups`. **Aditiva**: não muta, não
  apaga e não move nenhum dado; `app.campanha_leads` continua intacta **e continua sendo
  escrita** por `encerrarLigacao` (é dela que vivem a aba Acompanhamento da campanha e o
  filtro "com/sem próxima ação" da fila de ligações). Quando há follow-up, ele é a FONTE do
  resumo gravado lá — as duas telas não podem divergir sobre o que foi combinado.
- **IDENTIDADE DO CONTATO = `empresa_id` + `telefone_digitos`, resolvida na LEITURA.** Os dois
  mundos têm chaves incompatíveis (Ligações: `prospectador.prospects.id`; Mensagens:
  `vendas.conversas.numero`). **PROIBIDO** criar FK para `vendas.conversas`: aquele `numero` é
  `UNIQUE` **GLOBAL** (`init.sql:6`) — a FK exigiria que a conversa já existisse **e ainda
  assim não provaria mesma empresa**. `conversa_numero` existe só como **cache** de
  conveniência. Guarda de regressão em `test/follow-up-modelo.test.js` falha se um
  `REFERENCES vendas.conversas` aparecer na migration.
- **ANTIDUPLICIDADE no banco, não na aplicação:** índice único PARCIAL
  `follow_ups_um_aberto_por_canal_uk (empresa_id, telefone_digitos, canal) WHERE status =
  'aguardando'`. **Por canal, e não por contato**, de propósito: "ligar na sexta" e "mandar
  mensagem amanhã" são dois trabalhos, feitos em duas telas — juntá-los esconderia um dos dois.
  O `ON CONFLICT` faz **DO UPDATE**, com regra explícita: **a decisão mais recente vence** —
  quem acabou de falar com o cliente sabe mais que o agendamento anterior.
- **O follow-up da ligação nasce DENTRO da transação do encerramento** (`db/ligacoes.js` →
  `criarFollowUp(client, …)`). Fora dela, sobreviveria a um rollback e mandaria o operador agir
  sobre uma ligação que não existe. Por isso `POST /follow-ups/itens` **recusa `origem:
  'ligacao'`** (`ORIGENS_DA_ROTA = {manual, mensagem}`) — **não afrouxe isso**.
- **Precedência declarada na fila:** `follow-up registrado > recomendação do call score >
  agendamento do motor`. Uma decisão de uma PESSOA vence uma recomendação CALCULADA. Quando o
  contato já tem follow-up em aberto, a recomendação heurística **não vira segunda linha**:
  vira o "por que agora" daquele item. As três fontes **convivem** — nada do que funcionava foi
  desligado.
- **`aguardando` ≠ `aberto`:** follow-up com prazo no FUTURO fica "aguardando"; com prazo
  vencido/hoje vira trabalho "aberto". Sem isso, um compromisso do mês que vem disputaria o
  topo da fila com o trabalho de hoje. **Falha NUNCA é "aguardando"** (mesma regra que a fila
  já aplicava).
- **Canal, responsável e origem só existem onde alguém escolheu.** Item derivado não recebe
  canal presumido — os filtros por canal/responsável/origem simplesmente não o alcançam, e a
  célula diz "—" em vez de inventar. Mesma disciplina de "prioridade não calculada".
- **Responsável é OPCIONAL** (`responsavel_id` NULL = "não atribuído", estado legítimo e
  filtrável). Validado contra `app.usuarios_empresas` **da própria empresa**; atribuir dono
  nunca é pré-requisito para registrar uma ligação que já aconteceu.
- **Roteamento:** `whatsapp` → executa na **Central de Mensagens** (abre `ConversaPainel`, com
  `contextoOrigem` — DADOS prontos, nunca uma requisição: o painel é o mesmo da Central de
  Mensagens, que **não** é admin-only e tomaria 403 numa rota de follow-ups). `ligacao` →
  executa na **Central de Ligações**, via `?campanha=&lead=` (mesmo padrão de `location.search`
  + `history.replaceState` da Aquisição; **sem** `useSearchParams`). **A Central de Ligações
  não vira fila de mensagens**: ela mostra só o RESUMO + link.
- **Linha do tempo do contato** (`GET /contatos/:telefone/historico`): ligações encerradas,
  ligações registradas e o ciclo de vida dos follow-ups. **NÃO devolve texto de mensagem** — as
  mensagens são do painel de conversa, que já mostra o histórico inteiro; repeti-las criaria
  duas fontes que divergem. Guarda de regressão no teste.
- Código: regras PURAS em `src/services/follow-up-modelo.js` (dono do vocabulário; reexportado
  por `domain-enums.js`, **não copiado**), SQL em `src/db/follow-ups.js`, criação transacional
  em `src/db/ligacoes.js`, rotas em `src/routes/api-follow-ups.js` (`/itens`, `/itens/:id/status`,
  `/itens/:id/reagendar`, `/responsaveis`, `/contatos/:telefone/historico` — admin-only pelo
  mount + `requireEmpresaAccess`; toda escrita vira linha em `app.auditoria_eventos`). Front:
  `frontend/lib/follow-up-acao.js` (+ `.d.ts`/`.test.js`) é o dono do vocabulário de
  apresentação e `followups-fila.js` apenas o **reexporta** (padrão de `paginacao.js` /
  `lead-identidade.js`). Testes: `test/follow-up-modelo.test.js`,
  `frontend/lib/follow-up-acao.test.js`.
- **Nenhuma variável de ambiente nova.**

### Disponibilidade de canal do CONTATO — quem diz que não tem WhatsApp é uma PESSOA
- **Regra de negócio, em uma frase:** disponibilidade de canal é dado **central do contato** e
  **humano-curado**. Falha de envio, `exists:false` do Evolution, timeout do provider e
  instabilidade externa **não são verificação** — são ruído de transporte, e o sistema **nunca**
  conclui sozinho que um contato não tem WhatsApp.
- **Defeito corrigido:** no reagendamento o canal ficava congelado no que a ligação havia
  sugerido. Um contato continuava reagendado para WhatsApp depois de o operador já saber que
  aquele número não tem WhatsApp (caso observado em produção: Elite Auto Renovadora). O
  conhecimento existia — na cabeça de quem ligou — e não tinha onde ser gravado.
- **TRÊS estados, e `null` NÃO é `false`:** `true` verificou e tem · `false` verificou e não
  tem · **ausência de linha** = ninguém verificou, que **mantém o comportamento histórico**
  (WhatsApp). Tratar "não sei" como "não tem" mandaria todo contato novo para ligação — o
  oposto do que o sistema faz hoje, e uma decisão que ninguém tomou.
- **PROIBIDO reusar `prospectador.prospects.tem_whatsapp` como fonte.** Aquela coluna é escrita
  AUTOMATICAMENTE por `rodar-leads.js` (`marcarDisparoFalhou(..., semWhatsapp=true)`) quando o
  Evolution responde `exists:false`: inferência técnica e curadoria humana na mesma coluna
  tornariam impossível distinguir "o operador verificou" de "o provider errou uma vez". Ela
  **continua existindo**, continua governando a elegibilidade do Banco de Leads, e **não é lida
  nem escrita** por este módulo (guarda de regressão lê os dois fontes).
- **Schema:** migration `066_contato_canal_disponibilidade.sql` → `app.contato_canal_disponibilidade`.
  **ADITIVA**: não muta, não apaga e não move dado existente; nenhum contato nasce com linha.
  Identidade = **`empresa_id` + `telefone_digitos`**, a mesma da migration 062, e **sem FK para
  `vendas.conversas`** (aquele `numero` é UNIQUE **GLOBAL** e não prova empresa). `disponivel` é
  NOT NULL — "não sei" é a AUSÊNCIA da linha, nunca um NULL. Unicidade por
  `(empresa_id, telefone_digitos, canal)`: o upsert reescreve a linha, e é isso que torna a
  marcação **reversível** em vez de empilhar vereditos que se contradizem.
- **A garantia de "só humano" vive no BANCO:** `origem` é NOT NULL, **SEM DEFAULT** e com CHECK
  fechada num único valor — `'operador'` (mesmo motivo de `origem_vinculo`, migration 061: um
  DEFAULT autorizaria em silêncio qualquer INSERT futuro que esquecesse a coluna). Para um job
  marcar disponibilidade seria preciso **alterar o schema**, o que quebra o anti-drift de
  `test/domain-enums.test.js`. `canal` é fechado em `whatsapp`: `ligacao` não entra porque o
  telefone É a identidade (a resposta seria sempre "disponível"), e `email` não entra pelo
  motivo abaixo.
- **E-mail era FASE SEPARADA e DEIXOU DE SER na migration 067** (seção própria abaixo). O
  histórico importa porque explica a regra dura do canal: enquanto `follow_ups_canal_chk` era
  fechada em `whatsapp|ligacao` e **nenhuma tela sabia EXECUTAR** um follow-up de e-mail, criar
  o valor `email` produziria itens que entram na fila e nunca saem dela — pior que a ausência
  do canal. O valor nasceu **junto do executor**, e `EMAIL_FASE_SEPARADA` virou `EMAIL_CANAL`.
  E-mail de cadastro ou de anotação livre continua sendo **CANDIDATO, nunca confirmado**:
  promovê-lo sozinho a canal repetiria, do outro lado, o mesmo erro de deduzir disponibilidade
  sem verificação humana (`EMAIL_CANDIDATO`, e o teste o cobra).
- **"Sem e-mail nem telefone" NÃO virou regra nova, de propósito:** não existe contato assim
  neste modelo (`telefone_digitos` é NOT NULL, 8..15 dígitos). Regra para estado inalcançável é
  código morto nascendo pronto.
- **Marcação e troca de canal são ATÔMICAS.** Mover o item pode colidir com o índice único
  parcial `follow_ups_um_aberto_por_canal_uk` (já existe uma ligação aguardando para o
  contato); nesse caso a transação **inteira** volta atrás e a rota responde **409
  explicativo**. Nunca fica o contato marcado com o trabalho no canal errado. Não se funde nem
  se sobrescreve o item existente — cada um carrega origem e contexto próprios.
- **DESFAZER reescreve a linha, mas NÃO devolve o item ao WhatsApp.** "Tem WhatsApp" torna o
  canal possível de novo; quem moveu o trabalho para ligação foi uma decisão registrada, e
  revogá-la automaticamente mandaria o trabalho de volta a um canal que talvez ninguém queira
  mais usar naquele contato. Item que **já é de ligação** nunca é tocado pela marcação.
- **`criarFollowUp` também consulta o veredito:** um follow-up novo por WhatsApp num contato
  marcado como sem WhatsApp **nasce já no canal possível** — senão a próxima ligação encerrada
  recriaria, sozinha, exatamente o item que o operador acabou de corrigir. A resposta traz
  `canal_solicitado`/`canal_ajustado_motivo` (campos calculados em JS, **nunca colunas**) para a
  tela dizer o que houve em vez de mudar o canal em silêncio.
- **O canal continua FORA do formulário de reagendamento.** Trocar de canal à mão segue sendo
  outra decisão, tomada onde a ação é executada; o que existe é a troca como **consequência** de
  um fato declarado sobre o contato. `validarReagendamento` ganhou só `permitirPatchVazio` —
  marcar disponibilidade sem mexer em prazo nem prioridade é mudança legítima, e recusá-la com
  "Nada para reagendar" obrigaria o operador a inventar uma alteração para salvar o que sabe.
- **Rota:** `POST /follow-ups/itens/:id/reagendar` ganhou **dois campos OPCIONAIS** —
  `whatsapp_disponivel` (booleano de verdade; `'false'`, `0` e `''` são **recusados**, porque
  `Boolean('false')` é `true` e o operador teria marcado o oposto do que quis) e
  `disponibilidade_motivo`. **Nenhuma rota nova**: quem não os envia mantém o comportamento
  anterior. A marcação vira linha própria em `app.auditoria_eventos`
  (`contato_canal_disponibilidade_alterada`, entidade `contato`) — é fato sobre o CONTATO, e
  precisa continuar rastreável depois de o item ser concluído. Sem JID e sem texto de mensagem.
- **Front:** a tela **só desenha**. Quem decide o canal é o backend; `frontend/lib/follow-up-acao.js`
  (+ `.d.ts`/`.test.js`) tem apenas o texto da consequência e o estado do controle, e
  `followups-fila.js` o **reexporta** (padrão de `paginacao.js` / `lead-identidade.js`). O
  controle vive no `ModalReagendar` de `frontend/app/dashboard/follow-ups/page.tsx`.
  `patchDisponibilidade` só envia o veredito quando ele **mudou** naquela tela — reenviar o
  mesmo valor gravaria `marcado_por`/`marcado_em` novos e uma linha de auditoria a cada mexida
  na data, fazendo parecer que alguém reverificou o contato toda vez. Desmarcar é **desfazer**
  quando havia marcação e **silêncio** quando não havia (`alternarSemWhatsapp`) — desmarcar não
  registra uma verificação que não houve.
- **Consequência que a migration 067 REVERTEU:** enquanto o canal de e-mail não existia, todo
  contato marcado como sem WhatsApp ia para **ligação**, inclusive quando havia e-mail conhecido
  no cadastro. Hoje o salto do meio existe — mas só com endereço **confirmado por uma pessoa**;
  sem ele, o destino continua sendo a ligação.
- Código: regras PURAS em `src/services/contato-canal-disponibilidade.js` (dono do vocabulário;
  reexportado por `domain-enums.js`, **não copiado**), SQL em
  `src/db/contato-canal-disponibilidade.js` (uma única escrita, e ela **exige `usuarioId`**),
  ligação no criar/reagendar/listar em `src/db/follow-ups.js`, rota em
  `src/routes/api-follow-ups.js`. Testes: `test/contato-canal-disponibilidade.test.js` (puro +
  guardas que leem o fonte e a migration), `test/domain-enums.test.js`,
  `test/follow-up-modelo.test.js`, `frontend/lib/follow-up-acao.test.js`.
- **Nenhuma variável de ambiente nova, nenhuma rota nova.**

### Canal de E-MAIL do follow-up — o valor nasceu JUNTO do executor (migration 067)
- **Regra de negócio, em uma frase:** e-mail só é canal quando uma **PESSOA confirmou para
  onde enviar**. A ordem completa passa a existir de fato: **sem WhatsApp → e-mail confirmado
  → ligação**.
- **O que esta entrega resolve:** a Decisão 4 de 2026-08-12 proibiu o valor `email` porque
  `follow_ups_canal_chk` era fechada em `whatsapp|ligacao` e **nenhuma tela sabia EXECUTAR** um
  follow-up de e-mail — um canal sem executor produz itens que entram na fila e nunca saem
  dela, pior que a ausência do canal. **O canal e o executor nasceram no mesmo diff, de
  propósito.** Se um dia alguém alargar a CHECK sem executor, é esse defeito que volta.
- **Schema:** migration `067_follow_up_canal_email.sql`. **Aditiva quanto a DADOS** (não muta,
  não apaga e não move linha alguma); o que ela altera são duas CHECKs, e as duas só
  **ALARGAM** o que era aceito. `origem` (a garantia de "só humano" da 066) **não é tocada**.
  - `follow_ups_canal_chk` → `whatsapp | ligacao | email`. O índice único parcial
    `follow_ups_um_aberto_por_canal_uk` **continua valendo sem alteração**: sendo por
    (empresa, telefone, CANAL), "mandar e-mail amanhã" e "ligar na sexta" seguem sendo dois
    trabalhos.
  - `contato_canal_disp_canal_chk` → `whatsapp | email`. **Mesma tabela da 066 de propósito**:
    é o MESMO tipo de fato (veredito humano sobre um canal de um contato) com a MESMA
    identidade (`empresa_id + telefone_digitos`). Tabela separada duplicaria a curadoria em
    dois lugares e deixaria as duas divergirem. `ligacao` continua fora — o telefone É a
    identidade, então a resposta seria sempre "disponível".
  - Coluna `endereco` (nullable, sem DEFAULT) + duas CHECKs: `contato_canal_disp_endereco_chk`
    (só o canal que tem endereço pode carregar um) e
    **`contato_canal_disp_email_confirmado_chk`** (`canal <> 'email' OR disponivel = false OR
    endereco IS NOT NULL`). **É esta que impede o defeito da Decisão 4 no banco:** confirmar
    e-mail é dizer PARA ONDE — canal sem destino não é canal. Negar (`disponivel = false`)
    segue permitido sem endereço: é uma negação, não um destino.
  - `app.follow_up_emails` — uma linha por envio TENTADO. Tabela própria, e **não**
    `prospectador.email_outreach`, por dois motivos concretos: aquela é chaveada por
    `prospect_id` (o follow-up não tem prospect obrigatório) e é o ledger da **primeira
    abordagem** — misturar as duas faria abordagem e acompanhamento medirem a mesma coisa.
    **Não existe status `desativado`** aqui: canal não configurado recusa ANTES de compor e
    nada é gravado, porque registrar um "envio" que nunca saiu faria a linha do tempo mentir.
- **A regra do canal vale nos DOIS sentidos, e o banco só cobre um.** A CHECK protege
  `contato_canal_disponibilidade`, mas não enxerga `follow_ups` — e `POST /follow-ups/itens`
  aceita `canal` do corpo. Por isso `resolverCanalFollowUp` **rebaixa para `ligacao` todo item
  de e-mail sem endereço confirmado** (motivo `e-mail sem endereco confirmado por uma pessoa`).
  Sem essa guarda, bastaria pedir um follow-up de e-mail para um contato sem endereço para
  criar exatamente o item sem destino que a Decisão 4 descreveu.
- **O EXECUTOR é a própria Central de Follow-ups** (`TELA_EXECUTORA.email =
  'central_follow_ups'`). **Não existe uma "Central de E-mails", e não deve nascer:** compor
  uma mensagem 1:1 é o que o follow-up manual desta fila já faz; uma tela nova duplicaria o
  compositor. O item ganha o botão primário **"Escrever e-mail"** (fora do radial — é o
  trabalho em si), que abre `ModalEmail`: destinatário, assunto e corpo, com rascunho pronto.
- **O DESTINATÁRIO não é um campo, nem na tela nem na rota.** É sempre o endereço confirmado
  em `app.contato_canal_disponibilidade` (origem `operador`). `POST /itens/:id/email/enviar`
  **não aceita destinatário no corpo** — há guarda de regressão que lê o fonte da rota. Aceitar
  um endereço ali permitiria enviar para um destino que ninguém verificou.
- **O rascunho é DETERMINÍSTICO — não há IA.** Ele é montado a partir do que já está no item
  (próxima ação + observação). Um canal novo não estreia com custo de LLM por clique; se isso
  mudar, será decisão de produto, e o teste que proíbe `generateAIResponse` no executor é onde
  ela apareceria.
- **Nenhum worker envia e-mail sozinho.** O canal nasceu de uma decisão humana e continua
  executado por uma pessoa: guarda de regressão varre `src/**` e falha se `enviarEmailFollowUp`
  ganhar qualquer chamador além da rota.
- **Enviar CONCLUI o item** (pelo mesmo `mudarStatusFollowUp` do botão "Concluir", nunca um
  UPDATE próprio) — neste canal, enviar É a ação; deixar o item aberto devolveria a fila ao
  problema de "item que entra e não sai". **Ordem declarada:** envia primeiro (chamada externa,
  irreversível), grava depois. Falha do provider vira linha `falhou` e **o item continua em
  aberto** — trabalho não some da fila por falha de transporte. Se o e-mail sair e a conclusão
  falhar, o erro é registrado e a tela pede que o operador conclua à mão (`conclusao_erro`, que
  **não** é falha de envio).
- **O transporte é REUSADO, o ledger não.** `enviarViaProvider` passou a ser exportado de
  `services/email-outreach.js` — mesma credencial, mesmo remetente verificado, mesmo timeout.
  Duplicar o cliente HTTP criaria dois lugares para ajustar provider. Sem
  `EMAIL_PROVIDER_API_URL`/`EMAIL_PROVIDER_API_KEY`/`EMAIL_FROM` o canal fica **desligado** e o
  envio é recusado com motivo próprio (a tela distingue "confirme um e-mail" de "o canal não
  está configurado" — as saídas são diferentes).
- **Candidatos ≠ confirmação.** `prospectador.prospects.email` aparece como **sugestão** no
  compositor e na rota `GET /contatos/:telefone/emails`, sempre rotulado como não verificado, e
  **nunca** vira destino sozinho. O casamento por telefone segue o padrão de
  `db/lead-nome-maps.js` (variações geradas em JS, expressão do `WHERE` idêntica à indexada em
  `idx_prospects_empresa_telefone_digitos`).
- **A linha do tempo do contato mostra os e-mails** (assunto, nunca o corpo) porque, ao
  contrário das mensagens de WhatsApp, **não há outra tela que os mostre**. O `corpo` é gravado
  (foi o que o cliente recebeu) mas **nenhuma leitura o devolve** — há teste que lê as colunas.
- **Auditoria:** `follow_up_email_enviado` (sem endereço e sem texto — o conteúdo vive em
  `app.follow_up_emails`) e **uma linha por CANAL marcado** no reagendamento, porque WhatsApp e
  e-mail são dois fatos distintos sobre o contato.
- **Rotas (as três dentro do mount admin-only + `requireEmpresaAccess`):**
  `GET /itens/:id/email` (read-only: não envia, não grava, não chama IA; diz **por que** não dá
  para enviar), `POST /itens/:id/email/enviar`, `GET /contatos/:telefone/emails`.
  `POST /itens/:id/reagendar` ganhou três campos **OPCIONAIS** (`email_disponivel`,
  `email_endereco`, `email_motivo`) — quem não os envia mantém o comportamento anterior.
- **O canal continua FORA do formulário** (Decisão 8 da 066 permanece): `CANAL_OPCOES` do
  encerramento de ligação **não** oferece e-mail. Ele é alcançado como **consequência** de um
  fato declarado sobre o contato, nunca escolhido numa lista.
- Código: regras PURAS em `src/services/contato-canal-disponibilidade.js` (`EMAIL_CANAL`,
  `EMAIL_CANDIDATO`, `ORDEM_CANAIS`, `normalizarEmail`, `enderecoEmailConfirmado`) e
  `src/services/follow-up-modelo.js` (`FOLLOWUP_CANAL`, `FOLLOWUP_EMAIL_STATUS`,
  `TELA_EXECUTORA`); executor em `src/services/followup-email.js`; SQL em
  `src/db/follow-up-emails.js` e `src/db/contato-canal-disponibilidade.js`; ligação no
  criar/reagendar/listar/histórico em `src/db/follow-ups.js`; rotas em
  `src/routes/api-follow-ups.js`. Front: `frontend/lib/follow-up-acao.js` (+ `.d.ts`/`.test.js`),
  reexportado por `followups-fila.js`, e `ModalEmail` em
  `frontend/app/dashboard/follow-ups/page.tsx`. Testes: `test/followup-email.test.js` (novo),
  `test/contato-canal-disponibilidade.test.js`, `test/domain-enums.test.js`,
  `test/follow-up-modelo.test.js`, `frontend/lib/follow-up-acao.test.js`.
- **Nenhuma variável de ambiente nova** (o canal reusa as três do provider que já existiam).

### Roteiros — ciclo de vida do ROTEIRO (arquivar) ≠ ciclo de vida da VERSÃO
- **Dois ciclos de vida convivem na tela `/dashboard/roteiros`, e confundi-los é o erro fácil
  deste módulo.** `app.roteiro_versoes.status` (`rascunho|publicada|arquivada`) descreve **uma
  versão** — publicada é **imutável**, para editar cria-se outra. O estado do **roteiro**
  (`rascunho|publicado|arquivado`) é do cabeçalho e **não é derivável do status das versões**:
  `publicarVersao` arquiva a versão publicada anterior por conta própria, então quase todo
  roteiro saudável tem versão arquivada sem estar arquivado.
- **Onde mora:** `app.roteiros.ativo` — coluna criada na migration `033`, indexada em
  `idx_roteiros_empresa (empresa_id, ativo)` e que **nunca havia sido escrita nem exposta**.
  **Nenhuma migration nova foi criada**; nenhum dado existente foi mutado (todo roteiro nasce
  e permanece `ativo = true` até alguém arquivar).
- **NÃO EXISTE EXCLUSÃO DE ROTEIRO, de propósito, e não deve ser criada.** As FKs de histórico
  (`app.ligacoes`, `ligacao_etapas/sinais/objecoes/perguntas`, `campanhas.roteiro_versao_id`)
  são **`ON DELETE SET NULL`**: o banco **não barra** um DELETE — ele desliga em silêncio as
  ligações já realizadas do roteiro que as gerou. **Arquivar é a operação segura equivalente**,
  e é reversível. Guarda de regressão em `test/roteiros.test.js` falha se o módulo passar a
  exportar qualquer função com nome de exclusão.
- **Arquivar não interrompe nada em andamento.** Nenhuma versão, etapa, ligação ou campanha é
  tocada; a campanha aponta para a **versão**, que continua existindo. O que o roteiro
  arquivado perde é o direito de ser **ADOTADO por campanha nova** (ou trocado para dentro de
  uma existente): a regra vive em `assertRoteiroVersaoUtilizavel` (`src/db/campanhas.js`,
  **409**), chamada por `criarCampanha` e `atualizarCampanha` — o único ponto onde uma campanha
  passa a apontar para uma versão. Sem essa guarda, "arquivado" seria só um rótulo de tela.
- **A tela avisa antes de confirmar:** `obterRoteiro` devolve `campanhas_usando` (contagem
  escopada na empresa) e o modal diz, com o número, que essas campanhas continuam funcionando.
- **Rotas:** `POST /:roteiroId/arquivar` e `POST /:roteiroId/desarquivar` (admin-only +
  `requireEmpresaAccess`, como todas do módulo). Idempotentes; `UPDATE` escopado por
  `empresa_id`, 404 fora do tenant. **Não há DELETE** em `src/routes/api-roteiros.js`.
- **"Atendimento X" é o NICHO.** Não existe vínculo roteiro↔instância no schema; `app.roteiros.nicho`
  (texto livre) é o agrupamento que os dados realmente têm, e é por ele que a lista lateral agrupa.
- **Apresentação é PURA e testada** em `frontend/lib/roteiros-lista.js` (+ `.d.ts`/`.test.js`):
  estado do roteiro, agrupamento por nicho, seção "Arquivados" recolhida, qual versão abrir,
  quais ações cabem em cada estado e o texto de confirmação. A tela só desenha. Cor é **reforço**,
  nunca a informação: todo selo carrega rótulo em texto + frase de consequência.
- **Trocar de roteiro nunca mostra conteúdo do anterior:** a página usa um token de requisição
  (só a resposta do último clique escreve na tela), limpa o painel no clique e **desabilita
  TODAS as ações enquanto carrega** — publicar/arquivar durante o carregamento agiria sobre o
  roteiro anterior. Nome e status aparecem na hora, vindos da lista já em memória.
- Confirmação em `frontend/components/ui/ModalConfirmar.tsx` (acessível: `role="alertdialog"`,
  foco preso, Escape, foco devolvido ao gatilho) — substitui `window.confirm` neste fluxo.
- Testes: `test/roteiros.test.js`, `test/campanhas.test.js`, `frontend/lib/roteiros-lista.test.js`.
- Nenhuma variável de ambiente nova foi criada para este módulo.

### Menu radial de ações secundárias (`⋯`) — primeira entrega, só em Follow-ups
- **Origem:** relatório de padronização visual "Padronização visual das listagens" (após os
  commits `33bdfbd`/`b019b0b`/`06563f9`/`6b3fff9`), que mapeou as 6 telas de listagem e propôs
  um menu radial para compactar ações secundárias onde a coluna Ações já está no limite do
  espaço horizontal. **Só Follow-ups recebeu o radial nesta entrega** — é a tela com mais botões
  simultâneos do produto (até 5, com `flex-wrap`); Captação e Aquisição ficaram para uma fase
  seguinte, para não ampliar o diff desta primeira entrega.
- **Compacta, nunca substitui.** A ação PRIMÁRIA de cada linha (a que resolve a maior parte dos
  cliques — "Abrir conversa", "Registrar", "Escrever"...) continua um botão comum, sempre
  visível, sem gesto nenhum. O radial só absorve o que sobra: em Follow-ups,
  Concluir/Reagendar/Cancelar (item com follow-up em aberto), Roteiro (ação `ligar`) e Cancelar
  automático (quando há follow-up automático agendado).
- **Acionamento por CLIQUE no botão "⋯", nunca por hover ou por gesto de clicar-e-segurar.**
  O relatório propunha um gesto de arrastar com zonas espaciais (decisão D6, em aberto); o
  pedido que motivou esta entrega já resolveu a favor da alternativa mais conservadora —
  "acionamento previsível por botão/ícone, sem depender apenas de hover frágil". Como resultado,
  desktop e toque usam o MESMO caminho: não existe um comportamento "escondido" que só quem
  descobriu o gesto encontra.
- **O popover É a lista completa — não existe uma segunda superfície.** As zonas espaciais
  (cima = ação mais frequente/reversível, direita = positiva, esquerda = negativa) mostram as
  ações mais usadas na posição descrita pelo relatório; o que não tem zona (ou perde a colisão
  por uma zona já ocupada) aparece logo abaixo, na mesma lista. Toda ação é alcançável por
  teclado e por toque simples — nenhuma vive só num atalho espacial. Ação rara/de maior
  consequência (Cancelar automático) fica sem zona de propósito, um nível mais fundo na lista.
- **Zero ações → nada é renderizado; UMA ação → vira botão comum** (sem o gatilho "⋯") — um
  menu para uma única opção é fricção pura, mesmo raciocínio do relatório sobre a Central de
  Ligações (1 ação por aba). A partir de duas, aparece o gatilho.
- Fecha em Escape, clique fora e scroll/resize (âncora se moveria); portal no `<body>` — mesmo
  padrão de fechamento de `BolinhaPontuacao.tsx`/`ModalConfirmar.tsx`, para não reinventar foco/
  posicionamento.
- Código: regras PURAS (atribuição de zona, rótulo acessível, classes por tom) em
  `frontend/lib/menu-radial.js` (+ `.d.ts`/`.test.js`) — o componente não decide nada, mesmo
  contrato de `lib/pontuacao-indicador.js`. Componente em
  `frontend/components/ui/MenuRadialAcoes.tsx`, usado em
  `frontend/app/dashboard/follow-ups/page.tsx` (`LinhaFila`).
- **Duas trocas de `window.confirm`/`confirm()` por `ModalConfirmar`, no mesmo diff** (mesma
  origem no relatório — "confirmação destrutiva divergente"): "Deletar histórico"
  (`frontend/components/ConversaPainel.tsx`) e "Remover rotina"
  (`frontend/components/RotinasAquisicao.tsx`). Em `ConversaPainel.tsx`, o `ModalConfirmar` virou
  IRMÃO da `<div>` de fundo do painel (não filho): aquela `<div>` tem `onClick={onFechar}` sem
  `stopPropagation`, e um `ModalConfirmar` aninhado ali dentro faria um clique no fundo do
  `ModalConfirmar` borbulhar e fechar o painel inteiro junto.
- **Fora de escopo desta entrega, declarado no relatório (seção 7 — decisões pendentes):**
  `StatusPill.tsx` (D1, sem uso hoje — adotar como badge de status unificado ou remover por
  morto é decisão de produto, não implementada aqui), bolinha de prioridade de Follow-ups
  migrar para `BolinhaPontuacao` (D2), Captação migrar para `BolinhaPontuacao`/
  `LeadDetalhesModal` (D3), paginação de servidor em Banco de Leads/Captação (D4), e o radial em
  Captação/Aquisição (D5 — resolvida a favor de "só Follow-ups agora").
- Testes: `frontend/lib/menu-radial.test.js`. Nenhuma variável de ambiente nova, nenhuma rota,
  nenhuma migration, nenhum arquivo de backend alterado.

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
  e `resolveEmpresaFromWebhook` (resolve `empresa_id` pela instância Evolution; **sem fallback** —
  origem não comprovada vai para quarentena).
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
