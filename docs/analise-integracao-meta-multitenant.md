# Análise estrutural — Integração Meta (Conversions API) por tenant

> **Status:** ANÁLISE. Nenhuma linha de código, schema ou configuração foi alterada.
> Data: 2026-08-06 · IA: Claude Code (Opus 5) · Fase 0 registrada em `ai-task-start-log.md`.
>
> **Convenção de leitura:** tudo marcado como **[EXISTE]** foi verificado lendo o arquivo/migration
> citado. Tudo marcado como **[PROPOSTA]** não existe hoje — é sugestão minha. Não misture os dois.

---

## 1. Resumo do funcionamento atual do Atendimento Views

O sistema é um backend Node/Express que atende leads por WhatsApp com um agente LLM e um conjunto
de módulos comerciais em volta. Em altíssimo nível existem **três grandes blocos que evoluíram em
épocas diferentes** e ainda convivem:

| Bloco | Schema PostgreSQL | Multiempresa? | Papel |
| --- | --- | --- | --- |
| **Núcleo de conversa (legado)** | `vendas.*` | Parcial (`empresa_id` aditivo) | Conversa, funil, perfil do lead, agenda do bot, follow-up automático, fila de jobs |
| **Prospecção / aquisição** | `prospectador.*` | Sim (`empresa_id NOT NULL`) | Coleta de leads (Bright Data Maps, Instagram), banco de leads, disparo de saudação |
| **Camada SaaS (novo)** | `app.*` | Sim, por design | Empresas, usuários, JWT, instâncias, contextos, campanhas, roteiros, ligações, agenda multiempresa, auditoria |

O caminho de entrada de um lead de anúncio é: **anúncio Meta CTWA → WhatsApp → Evolution API →
`POST /webhook` → `src/agent.js` → `vendas.conversas` + `vendas.lead_profiles`**. O caminho de
prospecção ativa é: **Bright Data Maps → `prospectador.prospects` → Banco de Leads → disparo →
mesma conversa**.

### Achado central (leia antes de tudo)

**Já existe uma integração com a Meta Conversions API neste repositório — e ela é inteiramente
single-tenant.** [EXISTE]

- `backend/src/services/meta-capi.js` — envia o evento. Lê `META_DATASET_ID`, `META_CAPI_TOKEN`,
  `META_PAGE_ID`/`META_WABA_ID` **do `process.env`**, ou seja, do processo inteiro. Não recebe,
  não aceita e não conhece `empresa_id`.
- `backend/src/services/meta-attribution.js` — captura o `ctwa_clid` da tabela do Evolution,
  calcula um score determinístico e dispara os eventos pendentes.
  `dispararEventosMetaPendentes` faz `SELECT ... FROM vendas.lead_profiles WHERE p.origem='meta_ads'`
  — **sem nenhum filtro por `empresa_id`**.
- `backend/src/agent.js:497` chama `sincronizarAtribuicaoMetaAds(pool, { logger })` no tick global
  do worker (~10 min), passando só o pool.

**Consequência prática:** no momento em que uma segunda empresa entrar com leads vindos de anúncio,
os eventos de conversão dela serão enviados para o dataset/token da PJ Codeworks. É exatamente o
cenário que o `important_constraint` do pedido proíbe. Isso não é um risco futuro — é o
comportamento atual do código em produção, hoje limitado apenas pelo fato de a PJ ser (na prática)
o único tenant com anúncios rodando.

---

## 2. Arquitetura e tecnologias identificadas

| Camada | O que é | Onde |
| --- | --- | --- |
| Runtime | Node.js + Express (JavaScript, CommonJS). TypeScript só pontual (`npm run typecheck`) | `backend/index.js`, `backend/src/` |
| Banco | PostgreSQL (`pg`), 3 schemas (`vendas`, `prospectador`, `app`) | `backend/sql/` |
| Migrations | Arquivos numerados aplicados no **boot** por `src/db/migrations.js` ao fim de `initDB` | `backend/sql/migrations/001…055` |
| Auth (SaaS) | JWT (scrypt + jsonwebtoken) + middlewares `requireAuth` / `requireEmpresaAccess` / `requireRole` | `src/auth.js`, `src/middleware/tenant.js` |
| Auth (legado) | Sessão de dashboard própria, `vendas.dashboard_users` | `src/dashboardAuth.js` |
| Frontend | Next.js App Router, deploy Vercel (`frontend/`) | `frontend/app/dashboard/*` |
| Dashboard legado | HTML/JS estático servido pelo backend | `backend/public/` |
| Fila assíncrona | `vendas.job_queue` (dedupe_key UNIQUE, `attempts`, `max_attempts`, `available_at`, `locked_until`) | `sql/init.sql:439` |
| Workers | Ticks `setInterval` disparados de `src/agent.js` e `index.js` (não há Redis/BullMQ/cron externo) | `src/agent.js:483-500` |
| Integrações externas | Anthropic/OpenAI, Evolution API (WhatsApp), Bright Data, Freelandoo, **Meta Graph API** | `src/ai-provider.js`, `src/whatsapp.js`, `src/services/brightdata-client.js`, `src/freelandoo/`, `src/services/meta-capi.js` |
| Cripto de credenciais | AES-256-GCM com chave de env, fallback derivado de `JWT_SECRET` via scrypt | `src/freelandoo/crypto.js` |
| Deploy | Railway (backend, Root `backend/`) + Vercel (frontend, Root `frontend`) | `docs/project-map.md` |

**Não existe** [EXISTE — verificado por busca em todo o repo]: Facebook Login, OAuth de qualquer
provedor, Meta Pixel no frontend, webhook da Meta, tabela de integrações genérica, `fbclid`, `fbp`,
`fbc` ou qualquer parâmetro `utm_*`. A única URL da Meta em todo o backend é a linha 34 de
`meta-capi.js`.

---

## 3. Como o multitenancy funciona atualmente

### 3.1 Representação do tenant

`app.empresas` (UUID) é o tenant. `app.usuarios` × `app.usuarios_empresas` (com `role`
`owner|admin|member`) define quem acessa o quê. Existe uma empresa-semente fixa,
`00000000-0000-0000-0000-000000000001` (PJ Codeworks), usada como fallback. [EXISTE — migration 001]

### 3.2 Propagação do `empresa_id`

| Caminho | Como o tenant é resolvido | Qualidade do isolamento |
| --- | --- | --- |
| API `/api/*` (frontend Next) | `requireAuth` (JWT) → `requireEmpresaAccess` lê `:empresaId` da rota e valida vínculo; `superadmin` passa em tudo | **Bom.** Todas as funções em `src/db/*.js` recebem `empresaId` explícito e filtram por ele |
| Webhook WhatsApp | `resolveEmpresaFromWebhook` resolve pela instância Evolution; **se não achar, cai para a empresa PJ** (`src/middleware/tenant.js:78`) | **Frágil por design** — um webhook de instância não mapeada grava dado dentro da PJ |
| Dashboard legado `/dashboard/*` | `dashboardAuth` (sessão single-tenant, `vendas.dashboard_users`) | **Sem noção de tenant.** Todo `/dashboard/*` vê o banco inteiro |
| Workers / ticks | Nenhum contexto de request. Alguns iteram por empresa (ex.: `banco-leads-auto`), outros varrem tudo (ex.: **`meta-attribution`**) | **Depende do worker** |

### 3.3 Padrões bons que já existem e devem ser reusados

- **Same-tenant assertion em FK cruzada:** `assertMesmaEmpresa()` em `src/db/ligacoes.js:18` valida
  que campanha, lead, roteiro e prospect pertencem à mesma empresa antes de escrever. É o padrão
  correto e deve ser copiado para a integração Meta. [EXISTE]
- **Credencial cifrada por tenant:** `app.freelandoo_connections` guarda `api_token_enc` e
  `webhook_secret_enc` (AES-256-GCM via `src/freelandoo/crypto.js`), com `empresa_id NOT NULL`.
  É exatamente o molde para as credenciais da Meta. [EXISTE — migration 019]
- **Índices únicos parciais como trava de concorrência no banco** (não na aplicação):
  `busca_snapshots_uma_ativa_por_empresa_uk`, `idx_ligacoes_uma_ativa_por_lead`. [EXISTE]
- **Idempotência por `client_event_id`** em `iniciarLigacao`, com tratamento de corrida `23505`.
  [EXISTE]
- **Auditoria append-only por empresa:** `app.auditoria_eventos` (`entidade_tipo`, `acao`,
  `estado_anterior`, `estado_novo`, `contexto`, best-effort). [EXISTE — migration 047]
- **Anti-drift de enums:** `src/domain-enums.js` + `test/domain-enums.test.js` travam código × CHECK
  do banco. Qualquer enum novo desta integração precisa entrar aí. [EXISTE]

### 3.4 A resposta honesta à pergunta "o isolamento é completo?"

**Não.** O isolamento é bom na camada `app.*`/`/api/*` e frágil no núcleo `vendas.*`. Três
limitações estruturais, todas verificadas no código:

1. **`vendas.conversas.numero` é `TEXT UNIQUE` global** e `vendas.lead_profiles.numero` também
   (`sql/init.sql:6` e `:31`). Um telefone pertence a **uma única** conversa em todo o sistema —
   dois tenants não podem ter o mesmo lead. O `empresa_id` em `vendas.*` foi adicionado depois
   (migration 001) com DEFAULT = PJ (migration 006), e o upsert usa
   `empresa_id = COALESCE(vendas.conversas.empresa_id, EXCLUDED.empresa_id)` — ou seja, a empresa
   é **fixada no primeiro contato e nunca muda** (`src/db-crud.js:148`). Isso é deliberado e
   sensato, mas significa que a chave natural do funil de conversa é o telefone, não `(empresa, telefone)`.
2. **Existem duas agendas.** `vendas.agenda_eventos` (legado, chave `usuario_id` → `dashboard_users`,
   **sem `empresa_id`**) e `app.agenda_eventos` (multiempresa, `empresa_id NOT NULL`). O bot cria
   reunião **só na legada** (`criarEventoAgenda` em `src/agenda.js:407`, chamada por
   `handoff-alerts.js:246` e `agent.js:5737`); a agenda do painel Next escreve **só na nova**.
   `api-banco-leads.js` já convive com isso lendo as duas e casando por telefone.
3. **Todo o `/dashboard/*` legado é cego a tenant** — inclusive `GET /dashboard/meta/anuncios`
   (`src/meta-routes.js:16`), que hoje devolve resultados de anúncios de **todos** os tenants para
   qualquer admin do dashboard legado.

---

## 4. Fluxo atual do lead até a venda

### 4.1 Entrada do lead (três portas)

| Porta | Origem | Atribuição capturada hoje |
| --- | --- | --- |
| **Anúncio CTWA** | Lead clica no anúncio → abre WhatsApp | **Sim** — `ctwa_clid`, `ad_id`, `title`, `source_url` |
| **Prospecção ativa** | Bright Data Maps / Instagram → `prospectador.prospects` → disparo de saudação | Não se aplica (outbound) |
| **Inbound orgânico** | Mensagem direta no WhatsApp | Nenhuma |

**Não existe** porta de formulário/landing page/importação manual com captura de `utm_*`.

### 4.2 Do primeiro contato à reunião

1. Evolution entrega `POST /webhook`; `resolveEmpresaFromWebhook` define `req.empresaId`.
2. `src/agent.js` roda o funil (`primeiro_contato → diagnostico → proposta → …`), gravando
   `vendas.conversas.historico` e `vendas.lead_profiles`.
3. Quando o lead aceita reunião, o agente emite `reuniao_escolha`; o handoff dispara
   `criarEventoAgenda({ tipo:'reuniao', origem:'handoff', metadata:{ lead_numero } })` →
   **`vendas.agenda_eventos`**. Há dedupe por `buscarEventoAgendaDuplicado`. [EXISTE —
   `src/handoff-alerts.js:207-268`]
4. Caminho paralelo humano: na **Central de Ligações**, `encerrarLigacao()` grava o resultado e,
   se o operador informar, atualiza `app.campanha_leads.status` para `reuniao_marcada` — atômico,
   dentro da mesma transação. [EXISTE — `src/db/ligacoes.js:250-265`]
5. Caminho manual: o usuário cria um evento pela agenda do painel → `app.agenda_eventos`.

### 4.3 Da reunião à venda

- **Único ponto explícito de "venda fechada" com valor:** `PATCH /dashboard/agenda/:id/vendido`
  (`src/agenda.js:1362`), que faz
  `UPDATE vendas.conversas SET venda_fechada = true, venda_valor = $2` casando por telefone.
  Rota do **dashboard legado, sem tenant**. O comentário no código já diz que ela existe para
  "alimentar o evento Purchase da Meta". [EXISTE]
- **`prospectador.prospects.status = 'fechado'`** — marcação manual no Banco de Leads.
  **Sem valor monetário.** [EXISTE — migration 013]
- **`app.campanha_leads.status = 'convertido'`** — status da oportunidade por campanha.
  **Sem valor monetário.** [EXISTE — migration 039]

Ou seja: **existem três "vendas fechadas" diferentes, em três tabelas, e só uma carrega valor.**

### 4.4 Histórico de mudança de status

| O que | Existe? | Onde |
| --- | --- | --- |
| Auditoria genérica por empresa (`estado_anterior`/`estado_novo`) | **Sim**, mas usada hoje só pelo domínio de ligações | `app.auditoria_eventos` (migration 047) |
| Eventos de prospect | **Sim** | `prospectador.prospect_events` |
| Eventos comerciais da conversa | **Sim**, enum fechado e sem `reuniao`/`venda` | `vendas.eventos_comerciais` (migration 032) |
| Histórico de `app.campanha_leads.status` | **Não** — o UPDATE sobrescreve | `src/db/ligacoes.js:262` |
| Histórico de `vendas.conversas.venda_fechada` | **Não** | `src/agenda.js:1374` |

### 4.5 Eventos duplicados, retroativos, cancelamentos e reaberturas

Situações reais que a integração precisa tratar, todas possíveis hoje:

- **Reunião cancelada / não compareceu:** `vendas.agenda_eventos.status` aceita `cancelado` e
  `nao_compareceu`; existe `excluido_em` (soft delete) e reagendamento
  (`reagendado_de_evento_id`/`reagendado_para_evento_id`). O `eventosDevidos` atual **ignora tudo
  isso** — ele só pergunta `EXISTS(... tipo='reuniao' AND excluido_em IS NULL)`, sem olhar status.
  Uma reunião criada e cancelada 5 minutos depois já disparou `LeadSubmitted`. [EXISTE — problema real]
- **Reagendamento:** gera um segundo evento. Como o `event_id` é `numero:LeadSubmitted`, não duplica
  na Meta — correto por acidente, não por desenho.
- **Alteração retroativa do valor da venda:** `PATCH /vendido` pode ser chamado várias vezes com
  valores diferentes. O `Purchase` só é enviado uma vez (dedupe por `event_id`), então o segundo
  valor **é silenciosamente perdido**. Não há correção nem log disso.
- **Reabertura de venda:** não há caminho para desmarcar `venda_fechada`. Se houvesse, a Meta já
  teria recebido o `Purchase` e não há mecanismo de estorno.
- **Mudança de status repetida:** o ledger `vendas.meta_eventos_conversao` tem
  `event_id TEXT NOT NULL UNIQUE` e o insert usa `ON CONFLICT (event_id) DO UPDATE` — a duplicidade
  na Meta está protegida. Mas o `event_id` é `${numero}:${event_name}`, ou seja **um único
  `LeadSubmitted` e um único `Purchase` por telefone, para sempre**. Um mesmo cliente que compra
  duas vezes gera **uma** conversão. [EXISTE]

---

## 5. Pontos exatos para disparo dos eventos

Recomendação: **não disparar direto no ponto de mudança de status.** O padrão certo aqui —
e que o repositório já usa em outros lugares — é *o ponto de negócio grava um fato; um worker envia*.

### 5.1 Reunião marcada — 3 pontos de origem

| # | Ponto no código | Caminho | Recomendação |
| --- | --- | --- | --- |
| R1 | `src/handoff-alerts.js:246` (após `criarEventoAgenda` retornar evento) | Bot agenda via handoff | **Melhor ponto.** Já tem dedupe de evento duplicado e o telefone em `metadata.lead_numero` |
| R2 | `src/db/ligacoes.js:250-265` (dentro da transação de `encerrarLigacao`) | Operador humano marca `reuniao_marcada` | **Melhor ponto.** Já é atômico, já tem `empresa_id`, já valida same-tenant |
| R3 | `src/services/agenda-multiempresa.js:174` (`criarEvento`, `tipo='reuniao'`) | Reunião criada à mão no painel | Incluir — é o caminho multiempresa "puro" |

### 5.2 Venda fechada — 3 pontos de origem

| # | Ponto no código | Caminho | Recomendação |
| --- | --- | --- | --- |
| V1 | `src/agenda.js:1374` (`PATCH /dashboard/agenda/:id/vendido`) | Único com **valor** | Incluir, **mas** a rota é single-tenant — precisa de equivalente em `/api/*` |
| V2 | `prospectador.prospects.status → 'fechado'` (Banco de Leads) | Sem valor | Incluir **só se** ganhar campo de valor |
| V3 | `app.campanha_leads.status → 'convertido'` (`encerrarLigacao`) | Sem valor | Incluir **só se** ganhar campo de valor |

**Decisão que precisa ser sua:** hoje não existe um conceito único de "venda" com valor e tenant.
Ou (a) elege-se V1 como a única fonte de verdade e força-se todo fechamento a passar por lá, ou
(b) cria-se um registro de venda próprio [PROPOSTA] para o qual V1/V2/V3 convergem. Sem isso, a
métrica de ROAS por campanha não fecha.

---

## 6. Dados de atribuição já existentes

| Dado | Existe? | Onde | Observação |
| --- | --- | --- | --- |
| `ctwa_clid` | **Sim** | `vendas.lead_profiles.origem_anuncio->>'ctwa_clid'` | Vem de `public."Message".contextInfo.externalAdReply.ctwaClid` |
| `ad_id` | **Sim** | `origem_anuncio->>'ad_id'` (campo `sourceId` do Evolution) | ID do anúncio, não do conjunto/campanha |
| Título do criativo / `source_url` | **Sim** | `origem_anuncio` | |
| `origem = 'meta_ads'` | **Sim** | `vendas.lead_profiles.origem` | |
| Data do 1º contato | **Sim, indireto** | `public."Message".messageTimestamp` | A tabela do Evolution pode **não existir** neste banco — o código checa com `to_regclass` |
| `campaign_id` / `adset_id` | **Não** | — | Só o `ad_id` chega pelo CTWA |
| `fbclid` / `fbc` / `fbp` | **Não** | — | Exigiriam Pixel + landing page, que não existem |
| `utm_source/medium/campaign/content` | **Não** | — | Nenhuma ocorrência no repositório |
| Atribuição para leads de prospecção ativa | **Não se aplica** | — | Outbound não tem campanha de origem |
| Atribuição com `empresa_id` | **Não** | — | `origem_anuncio` não guarda de qual conta Meta veio |

Resumo: **a atribuição existente cobre exatamente um canal (CTWA) e não é escopada por tenant.**

---

## 7. Dados e estruturas que estão faltando

Tudo abaixo é **[PROPOSTA]** — não existe hoje.

1. **Credenciais da Meta por tenant.** Hoje são env vars globais.
2. **Vínculo tenant ↔ conta de anúncio.** Não há como saber a qual empresa um `ad_id` pertence.
3. **Registro de venda com valor, moeda, tenant e data.** Só existe `vendas.conversas.venda_valor`,
   sem tenant explícito na rota que o grava.
4. **Ledger de conversão por tenant.** `vendas.meta_eventos_conversao` não tem `empresa_id`, não tem
   contagem de tentativas, não tem `proxima_tentativa_em` nem estados de fila.
5. **Histórico de mudança de status da oportunidade.** `app.auditoria_eventos` serve, mas os pontos
   de reunião/venda não escrevem nele hoje.
6. **`event_id` que suporte múltiplas conversões do mesmo lead.** O formato atual
   (`numero:event_name`) trava em uma por telefone.
7. **Consideração de cancelamento/no-show** na decisão de enviar.
8. **Captura de atribuição para canais não-CTWA** (formulário, landing, importação).
9. **Mascaramento de token em log/tela.** Hoje não há tela; se houver, precisa existir.
10. **Modo de teste por tenant.** `META_CAPI_TEST_CODE` é global — não dá para um tenant testar sem
    afetar os outros.

---

## 8. Riscos encontrados

Ordenados por severidade. **Todos os "Alto" são fatos verificados no código, não projeções.**

| # | Risco | Severidade | Evidência |
| --- | --- | --- | --- |
| R-1 | **Vazamento de conversão entre tenants.** Eventos de qualquer empresa vão para o dataset da PJ | **Alto** | `meta-attribution.js:198-213` — query sem `empresa_id` |
| R-2 | **Credencial global compartilhada.** Um token com `ads_management` no processo, acessível a todo o código | **Alto** | `meta-capi.js:32-33` |
| R-3 | **Dado pessoal de tenant A enviado à conta Meta de tenant B.** É incidente de LGPD, não só bug | **Alto** | Decorre de R-1 |
| R-4 | **Reunião cancelada/no-show conta como conversão.** `eventosDevidos` ignora `status` do evento | **Alto** | `meta-attribution.js:204-207` |
| R-5 | **`/dashboard/meta/anuncios` expõe resultados de todos os tenants** a qualquer admin legado | **Alto** | `meta-routes.js:16` |
| R-6 | **Venda só conta uma vez por telefone, para sempre** (`event_id = numero:Purchase`) | Médio | `meta-attribution.js:225` |
| R-7 | **Correção de valor da venda é perdida** silenciosamente | Médio | `ON CONFLICT DO UPDATE` não reenvia |
| R-8 | **Fallback do webhook para a empresa PJ** quando a instância não é reconhecida | Médio | `tenant.js:78` |
| R-9 | **Sem retry.** Falha de rede na Meta = evento gravado como `erro` e nunca mais tentado | Médio | Não há loop de reprocessamento |
| R-10 | **Envio serial dentro do tick.** Um lead por vez, sem paralelismo nem teto | Médio | `meta-attribution.js:214-241` |
| R-11 | **Chave de cripto derivada de `JWT_SECRET`** se a env dedicada não for setada — rotacionar o JWT quebra os segredos | Médio | `freelandoo/crypto.js:33` |
| R-12 | **Telefone unicamente global** impede dois tenants de terem o mesmo lead | Médio | `sql/init.sql:6` |
| R-13 | **Duas agendas** — qualquer regra de reunião precisa olhar as duas | Médio | Seção 3.4 |
| R-14 | **Migrations rodam no boot.** Migration ruim = deploy travado | Baixo | `src/db/migrations.js` |
| R-15 | **`resposta` da Meta gravada crua em jsonb** — pode conter eco de dados enviados | Baixo | `meta-attribution.js:236` |

---

## 9. Proposta de arquitetura da integração

Princípio único: **o tenant é parâmetro obrigatório em toda a cadeia, do fato ao envio.** Nenhuma
função da integração deve poder ser chamada sem `empresaId`.

```
  ┌─ PONTOS DE NEGÓCIO (síncronos, dentro da transação existente) ──────────┐
  │  handoff-alerts.js   ligacoes.js       agenda-multiempresa.js   agenda.js│
  │  (bot agenda)        (encerrarLigacao) (reunião manual)         (vendido)│
  └──────────────────────────────┬──────────────────────────────────────────┘
                                 │ registrarConversao(client, empresaId, {...})
                                 │ (best-effort — NUNCA quebra a ação principal)
                                 ▼
                    app.conversao_eventos   ← ledger, empresa_id NOT NULL,
                    (status: pendente…)        event_id UNIQUE por empresa
                                 │
                                 │ worker (tick, isolado por empresa)
                                 ▼
              ┌──────────────────────────────────────┐
              │ meta-dispatch (novo)                  │
              │  1. lê integração ATIVA da empresa    │
              │  2. decifra credencial (AES-256-GCM)  │
              │  3. monta payload                     │
              │  4. meta-capi.enviarEvento(cfg, evt)  │──► Graph API
              │  5. grava tentativa + status          │
              └──────────────────────────────────────┘
                                 │
                                 ▼
                    app.conversao_tentativas  ← 1 linha por tentativa
```

### Decisões de arquitetura recomendadas

| Decisão | Recomendação | Motivo | Risco | Esforço |
| --- | --- | --- | --- | --- |
| **A. Refatorar `meta-capi.js` para receber config como argumento** em vez de ler `process.env` | **Sim, primeiro passo** | É a mudança que torna tudo o resto possível. Sem ela, qualquer coisa por tenant vira gambiarra | Baixo — o módulo é pequeno, tem teste (`test/meta-attribution.test.js`) e uma só chamada | **P** (~1 dia) |
| **B. Manter env vars como fallback do tenant PJ** durante a transição | Sim | Não quebra o que já roda em produção | Baixo | **P** |
| **C. Ledger em `app.*`, não em `vendas.*`** | Sim | `app.*` já é multiempresa por design; `vendas.*` carrega a herança single-tenant | Baixo | **P** |
| **D. Manter `vendas.meta_eventos_conversao` como legado read-only**, migrando o motor para o ledger novo | Sim | Preserva o histórico já enviado (evita reenviar tudo à Meta na virada); evita duplicar o motor, que o AGENTS.md proíbe | Médio — precisa de um passo de "já enviado" na virada | **M** |
| **E. Fase 1 com token manual; OAuth só depois** | Sim | Ver seção 4 do pedido / análise abaixo | Baixo | — |
| **F. Reusar `vendas.job_queue`** para o envio | **Não** | Ela não tem `empresa_id`, o CHECK de `tipo` é travado por anti-drift, e o ledger já precisa de tabela própria com tentativas. Uma tabela com `proxima_tentativa_em` + índice é mais simples e mais auditável | Baixo | — |
| **G. Colocar o worker no tick existente** (`src/agent.js`) | Sim, no início | Não introduz infraestrutura nova (sem Redis/BullMQ). Se o volume crescer, extrair depois | Médio — ticks concorrentes se o backend escalar horizontalmente; resolver com `FOR UPDATE SKIP LOCKED` | **P** |

### Manual × OAuth

| Critério | Token manual (System User) | OAuth (Facebook Login for Business) |
| --- | --- | --- |
| Esforço | **P** — um formulário e um campo cifrado | **G** — App Review da Meta, redirect URI, refresh de token, gestão de escopos, política de privacidade pública |
| Experiência do tenant | Ruim: precisa criar System User no Business Manager e colar token | Boa: clica, autoriza, pronto |
| Risco de suporte | Alto: token errado/expirado/sem permissão é o suporte nº 1 | Menor depois de pronto |
| Risco de segurança | O tenant entrega um token de longa duração; você passa a guardá-lo | Menor: token com escopo, revogável pelo tenant |
| Dependência externa | Nenhuma | **App Review da Meta pode levar semanas e pode ser negado** |
| Escala | Não escala além de dezenas de tenants | Necessário a partir daí |

**Recomendação:** manual na Fase 2, OAuth avaliado na Fase 8 — exatamente como o pedido já propõe.
A refatoração A garante que a troca depois seja só uma nova forma de preencher a mesma tabela.

---

## 10. Modelo de dados sugerido [PROPOSTA]

Quatro tabelas aditivas em `app.*`. Nenhuma toca dado existente. Nomes seguem a convenção do repo
(português, `empresa_id`, `criado_em`/`atualizado_em`).

### 10.1 `app.meta_integracoes` — credenciais por tenant

| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` | UUID PK | |
| `empresa_id` | UUID NOT NULL → `app.empresas` | **UNIQUE** (uma integração Meta por empresa na Fase 2) |
| `ativo` | BOOLEAN NOT NULL DEFAULT false | Nasce desativada; só ativa após teste bem-sucedido |
| `dataset_id` | TEXT NOT NULL | Não é segredo |
| `page_id` / `waba_id` | TEXT | Um dos dois é obrigatório para CTWA (subcode 2804116) |
| `access_token_enc` | TEXT NOT NULL | **AES-256-GCM**, reusando `freelandoo/crypto.js` |
| `token_hint` | TEXT | Últimos 4 caracteres, só para a UI |
| `test_event_code` | TEXT | Modo teste **por tenant** |
| `modo` | TEXT CHECK (`teste`,`producao`) | |
| `purchase_habilitado` | BOOLEAN DEFAULT false | Equivalente por tenant do `META_CAPI_PURCHASE_ENABLED` |
| `score_minimo_qualificado` | INT DEFAULT 60 | Equivalente por tenant do `META_QUALIFIED_LEAD_MIN` |
| `ultimo_teste_em` / `ultimo_teste_ok` / `ultimo_erro` | TIMESTAMPTZ / BOOLEAN / TEXT | Indicadores de status na UI |
| `criado_por`, `criado_em`, `atualizado_em` | | |

### 10.2 `app.lead_atribuicao` — atribuição por tenant

| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` | UUID PK | |
| `empresa_id` | UUID NOT NULL | |
| `telefone_norm` | TEXT NOT NULL | Só dígitos, sem DDI — reusar `normFone` de `api-banco-leads.js` |
| `canal` | TEXT CHECK (`ctwa`,`formulario`,`landing`,`importacao`,`prospeccao`,`organico`) | |
| `ctwa_clid`, `ad_id`, `campaign_id`, `adset_id` | TEXT | O que o canal fornecer |
| `fbc`, `fbp`, `fbclid` | TEXT | Vazios hoje; prontos para quando existir landing |
| `utm_source/medium/campaign/content/term` | TEXT | idem |
| `capturado_em` | TIMESTAMPTZ | |
| | | **UNIQUE (`empresa_id`, `telefone_norm`, `canal`)** — first-touch preservado |

Fase 3 popula essa tabela a partir do que já existe em `vendas.lead_profiles.origem_anuncio`
(backfill idempotente), sem apagar a origem antiga.

### 10.3 `app.conversao_eventos` — ledger

| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` | UUID PK | |
| `empresa_id` | UUID NOT NULL | |
| `tipo` | TEXT CHECK (`reuniao_marcada`,`venda_fechada`) | **Nome interno de negócio**, não o nome da Meta |
| `event_name` | TEXT | Nome enviado à Meta (`LeadSubmitted`/`Purchase`), resolvido no envio |
| `event_id` | TEXT NOT NULL | **UNIQUE (`empresa_id`, `event_id`)** |
| `entidade_tipo` / `entidade_id` | TEXT / TEXT | `agenda_evento_vendas` / `agenda_evento_app` / `campanha_lead` / `conversa` |
| `telefone_norm` | TEXT | Chave de junção com a atribuição |
| `ocorrido_em` | TIMESTAMPTZ NOT NULL | **Momento do fato**, não do envio (a Meta aceita até 7 dias) |
| `valor` / `moeda` | NUMERIC / TEXT DEFAULT `'BRL'` | |
| `status` | TEXT CHECK (`pendente`,`enviando`,`enviado`,`ignorado`,`falhou`) | `ignorado` = sem atribuição, integração desligada, etc. |
| `motivo_ignorado` | TEXT | Para a tela de histórico explicar |
| `tentativas` | INT DEFAULT 0 | |
| `proxima_tentativa_em` | TIMESTAMPTZ | Backoff exponencial |
| `enviado_em` | TIMESTAMPTZ | |
| `payload_resumo` | JSONB | **Sem PII e sem token** — só `{event_name, tem_ctwa_clid: true, valor}` |

Índices: `(empresa_id, status, proxima_tentativa_em)` para o worker; `(empresa_id, ocorrido_em DESC)`
para a tela.

### 10.4 `app.conversao_tentativas` — uma linha por tentativa

`id`, `evento_id` → `conversao_eventos` ON DELETE CASCADE, `empresa_id`, `numero_tentativa`,
`http_status`, `erro_codigo`, `erro_subcodigo`, `erro_mensagem`, `fbtrace_id`, `duracao_ms`,
`tentado_em`. **Sem corpo de resposta cru** (risco R-15).

### 10.5 Reuso em vez de tabela nova

Para o histórico de status de oportunidade (`opportunity_status_history` do pedido): **não crie
tabela nova.** `app.auditoria_eventos` já tem `entidade_tipo`, `entidade_id`, `estado_anterior`,
`estado_novo`, `contexto` e `empresa_id`. Basta passar a escrever nela nos pontos R1/R2/R3/V1.
Criar uma segunda tabela violaria a proibição do AGENTS.md de duplicar estrutura equivalente.

---

## 11. Fluxo de envio para a Meta

1. **Ponto de negócio** chama `registrarConversao(client, empresaId, { tipo, entidade, telefone,
   ocorridoEm, valor })` **dentro da transação existente**, best-effort (padrão de
   `registrarAuditoria`). Grava `status='pendente'`. Nunca chama a Meta aqui.
2. **Worker** (tick, `FOR UPDATE SKIP LOCKED`, lote pequeno) seleciona
   `status IN ('pendente') AND proxima_tentativa_em <= NOW()`, **agrupado por `empresa_id`**.
3. Para cada empresa: carrega **uma vez** `app.meta_integracoes` (`ativo = true`), decifra o token.
   Se não houver integração ativa → marca os eventos como `ignorado`
   (`motivo_ignorado='integracao_inativa'`) e segue. Nada de "cair para o global".
4. Busca a atribuição em `app.lead_atribuicao` por (`empresa_id`, `telefone_norm`).
   Sem `ctwa_clid` (e sem `fbc`/e-mail/telefone hasheado) → `ignorado`
   (`motivo_ignorado='sem_atribuicao'`). **Isso é normal e esperado** para leads de prospecção ativa.
5. Envia via `enviarEventoMetaCAPI(config, evento)` — assinatura nova, config explícita.
6. Grava a tentativa; sucesso → `enviado`; erro transitório (5xx, timeout, rate limit) → `pendente`
   com backoff (1min, 5min, 25min, 2h, 12h, teto ~24h, máx. 6 tentativas); erro permanente
   (token inválido, dataset errado, subcode conhecido) → `falhou` **e desativa a integração**
   marcando `ultimo_erro`, para a UI mostrar "reconecte".

**Ponto de atenção real:** a Meta aceita eventos de mensagens com até 7 dias de atraso. Se o backoff
consumir mais do que isso, o evento perde valor. Recomendo teto de 24h para reunião/venda e um
alerta na tela quando um evento passar de 6h em `pendente`.

---

## 12. Estratégia de idempotência e prevenção de duplicidade

Três camadas independentes, todas com garantia **no banco**, não na aplicação — seguindo o padrão
já usado em `busca_snapshots` e `ligacoes`:

1. **Chave natural do fato** → `UNIQUE (empresa_id, event_id)`, com `event_id` **determinístico**:
   - Reunião: `r:<empresa_id_curto>:<entidade_tipo>:<entidade_id>` — a chave é a *reunião*, não o
     telefone. Duas reuniões do mesmo lead = duas conversões, correto.
   - Venda: `v:<empresa_id_curto>:<entidade_tipo>:<entidade_id>` — mesma lógica. Corrige o R-6.
   - Registrar duas vezes o mesmo fato → `ON CONFLICT DO NOTHING` → uma linha, um envio.
2. **`event_id` na Meta.** A própria Meta deduplica por `event_id` em janela de 48h. Enviar duas
   vezes o mesmo `event_id` é seguro por construção — o que protege contra reprocessamento manual.
3. **Guard idempotente no UPDATE do worker:** `UPDATE ... WHERE status = 'pendente'` — se voltar
   zero linhas, outro tick ganhou a corrida. É o padrão de `encerrarLigacao`
   (`src/db/ligacoes.js:239`).

**Reenvio manual sem duplicar:** o botão "reenviar" da tela **não cria linha nova** — ele volta a
existente para `pendente` com `proxima_tentativa_em = NOW()`, preservando o `event_id`. A Meta
deduplica; o ledger mantém uma linha e N tentativas.

**Correção de valor da venda (R-7):** se o valor mudar depois do envio, a decisão correta é
**registrar um evento novo** com `event_id` distinto (sufixo `:v2`) apenas se a Meta ainda estiver
na janela — ou, o que recomendo, **não corrigir automaticamente** e sinalizar na tela. Correção
automática de conversão é como se cria inflação de ROAS sem perceber.

---

## 13. Segurança, credenciais e LGPD

### Credenciais

- **Cifrar em repouso** com `src/freelandoo/crypto.js` (AES-256-GCM). Recomendo **chave própria**
  (`META_ENC_KEY`) em vez de reusar a da Freelandoo — comprometer um domínio não deve comprometer o
  outro. Documentar em `AGENTS.md` + `.env.example`, como o AGENTS.md exige.
- **Nunca** devolver o token pela API, nem cifrado. A UI recebe só `token_hint` (`••••4821`).
- Token só trafega no **corpo** do POST de configuração, nunca em query string, nunca em log.
- Escrever/atualizar credencial exige `requireAuth` + `requireEmpresaAccess` + `requireRole('admin')`.
  `superadmin` passa por design (já é assim no resto do sistema) — **decida se isso é aceitável
  para credenciais de terceiros**; é uma pergunta de contrato, não técnica.
- Toda escrita/ativação/remoção vira linha em `app.auditoria_eventos`.
- **Alerta sobre R-11:** o fallback "deriva a chave de `JWT_SECRET`" é conveniente em dev e perigoso
  em produção — rotacionar o JWT torna todos os tokens ilegíveis. Recomendo que a integração Meta
  **falhe ao ativar** se `META_ENC_KEY` não estiver setada em `NODE_ENV=production`.

### LGPD e dados pessoais

- **Base legal.** Enviar telefone/e-mail de um lead para a Meta é compartilhamento com terceiro,
  em país estrangeiro. O tenant é o controlador; vocês são operadores. Isso precisa estar no
  **contrato/termo de uso** e no aviso de privacidade do tenant — não é resolvível em código.
  Não sou advogado; trate isto como um ponto a validar juridicamente, não como parecer.
- **Minimização — a boa notícia:** o caminho CTWA **não precisa de dado pessoal nenhum**. O
  `ctwa_clid` já identifica o clique. A recomendação é enviar **apenas** `ctwa_clid` + `page_id`,
  como o código já faz hoje. Não adicione `em`/`ph` hasheados a menos que exista um caso concreto
  (ex.: leads de formulário sem CTWA) — e, se adicionar, SHA-256 sobre valor normalizado
  (minúsculo, sem espaço; telefone em E.164 sem `+`).
- **Retenção.** Definir prazo para `conversao_tentativas` (sugestão: 90 dias) e para
  `lead_atribuicao` (sugestão: 24 meses, alinhado à janela de atribuição). Hoje nada expira.
- **Logs.** O código atual já loga `erro` estruturado sem token. Manter a regra:
  nunca logar `access_token`, `ctwa_clid` completo ou telefone em texto puro. `payload_resumo` no
  ledger deve guardar **booleanos e nomes**, não valores.
- **Telas administrativas.** Telefone mascarado (`+55 11 ****-4821`) no histórico de eventos, salvo
  para quem tem papel de operação do tenant.
- **Direito de eliminação.** Se um lead pedir exclusão, precisa haver caminho para apagar
  `lead_atribuicao` e anonimizar o ledger. Hoje não existe.

---

## 14. Interface de configuração por tenant [PROPOSTA]

Localização: **nova página `frontend/app/dashboard/integracoes`**, item no `Sidebar.tsx`, admin-only —
mesmo padrão de `dashboard/playbook`. Não há área de "Integrações" hoje.

**Card "Meta Ads"** com três estados visuais: *Não configurada* / *Configurada — modo teste* /
*Ativa*.

Campos: `dataset_id`, `page_id` ou `waba_id` (com explicação de que um é obrigatório),
`access_token` (write-only, exibido depois como `••••4821`), `test_event_code` (opcional),
`modo` (teste/produção), `purchase_habilitado` (toggle), `score_minimo_qualificado`.

Ações: **Testar conexão** (envia um evento com `test_event_code` e um `event_id` sintético — nunca
um evento real), **Ativar / Desativar**, **Remover** (com confirmação; apaga a credencial, preserva
o ledger).

Mensagens de erro traduzidas a partir do que a Meta devolve — o `meta-capi.js` atual **já captura**
`error_subcode`, `error_user_title` e `error_user_msg` justamente para isso:

| Subcode | Mensagem para o usuário |
| --- | --- |
| 2804116 | "Falta o ID da Página ou da conta WhatsApp Business." |
| 2804066 | "Nome de evento não aceito para Click-to-WhatsApp." |
| 190 | "Token inválido ou expirado — gere um novo no Business Manager." |

**Aba "Histórico de eventos"**: lista do ledger da empresa — data do fato, tipo, entidade de origem
(com link), status, tentativas, motivo de ignorado, e botão **Reenviar** nos que falharam.
Filtro por status. Telefone mascarado. **Nunca** exibe token, nem `ctwa_clid` completo.

Antes de implementar, `docs/ui-visual-standard.md` precisa ser consultado (Fase 5 do workflow) —
página nova é exatamente o caso que a Regra nova 1 cobre.

---

## 15. Estratégia de logs, filas e reprocessamento

- **Logs** (via `src/logger.js`, formato já usado): `{ operation: 'meta_capi', empresa_id, tipo,
  event_id, tentativa, http_status, erro_subcode, duracao_ms }`. Note que `event_id` é derivado de
  IDs internos — não é PII. **Proibido**: token, telefone, `ctwa_clid`, corpo de resposta cru.
- **Isolamento nos logs**: `empresa_id` em toda linha, como o AGENTS.md já exige para os logs de IA
  da Central de Follow-ups.
- **Fila**: `app.conversao_eventos` como fila própria (justificativa na seção 9, decisão F).
- **Dead-letter**: não é tabela separada — é `status='falhou'` após esgotar tentativas, visível na
  tela e reenviável. Simplifica e mantém uma fonte de verdade.
- **Reprocessamento em lote**: rota admin `POST /api/empresas/:id/integracoes/meta/reprocessar`
  que devolve os `falhou` para `pendente`. Como o `event_id` é preservado, **não duplica**.
- **Observabilidade mínima**: contadores por empresa (pendentes, enviados 24h, falhos) no topo da
  tela. Sem isso, uma integração quebrada fica invisível por semanas.

---

## 16. Plano de testes

**Sem tocar em campanha real.** Quatro níveis:

1. **Unitário, sem rede** (padrão do repo — `test/meta-attribution.test.js` já injeta `axios` fake):
   - `eventosDevidos` com reunião cancelada / no-show / reagendada.
   - Geração determinística de `event_id` (mesmo fato → mesma chave).
   - Backoff: sequência de `proxima_tentativa_em`.
   - Classificação de erro transitório × permanente.
   - Cripto: `encrypt`/`decrypt` round-trip; token nunca sai da API.
2. **Integração com Postgres real** (padrão já usado na migration 053):
   - Registrar o mesmo fato 2× → 1 linha (`ON CONFLICT`).
   - Dois workers concorrentes → um envio (`SKIP LOCKED` + guard no UPDATE).
   - **Teste de isolamento explícito**: empresa A e empresa B com integrações distintas; garantir
     que o evento de A jamais lê a credencial de B. Este é o teste que justifica o projeto inteiro.
3. **Contra a Meta, em modo teste**: `test_event_code` por tenant → os eventos aparecem em
   "Testar eventos" do Gerenciador e **não** entram na otimização. É o mecanismo oficial de teste
   sem afetar campanha.
4. **Piloto controlado**: ativar só na PJ Codeworks em produção por 1–2 semanas, comparando o
   ledger interno com o Gerenciador de Eventos, antes de liberar para outros tenants.

Validação do repositório em cada fase: `npm test` (backend e frontend), `npm run typecheck`.
`npm run smoke:preco` só se precificação for tocada — não deve ser.

---

## 17. Plano de implementação por fases

Mantive as 8 fases do pedido, ajustando o conteúdo ao que o código realmente exige.

| Fase | Escopo | Migration? | Esforço | Risco |
| --- | --- | --- | --- | --- |
| **1. Mapear** | Este documento | Não | — | — |
| **2. Config manual por tenant** | `app.meta_integracoes` + `src/db/meta-integracoes.js` + **refatorar `meta-capi.js` para receber config** + rota `/api/empresas/:id/integracoes/meta` + `META_ENC_KEY` | 056 (aditiva) | **M** | Baixo — nada muda no envio ainda |
| **3. Atribuição** | `app.lead_atribuicao` + backfill idempotente de `origem_anuncio` + gravação por empresa no webhook | 057 (aditiva) | **M** | Baixo |
| **4. Registro interno idempotente** | `app.conversao_eventos` + `registrarConversao()` chamado em R1/R2/R3/V1 + auditoria. **Ainda não envia nada.** | 058 (aditiva) | **M** | Médio — toca 4 pontos de negócio; mitigado por ser best-effort |
| **5. Envio assíncrono** | `app.conversao_tentativas` + worker + backoff + **desligar o disparo global antigo**, marcando o já enviado | 059 (aditiva) | **G** | **Alto** — é aqui que a Meta passa a receber. Ligar tenant a tenant, começando pela PJ em modo teste |
| **6. Painel** | `dashboard/integracoes` + histórico + teste + reenvio | Não | **M** | Baixo |
| **7. Métricas de funil** | Seção 18 abaixo | Talvez | **M** | Baixo |
| **8. OAuth** | Avaliar App Review | Não | **G** | Externo — depende da Meta |

**Correções de segurança que não deveriam esperar a Fase 5** (são pequenas e reduzem risco alto hoje):

- **R-5** — escopar `GET /dashboard/meta/anuncios` ou removê-lo. **Esforço: PP.**
- **R-4** — `eventosDevidos` passar a exigir `status NOT IN ('cancelado','nao_compareceu')`.
  **Esforço: PP.** Melhora a qualidade do sinal enviado à Meta imediatamente.

---

## 18. Mensuração do funil

O que já existe e pode ser reusado, sem construir nada novo:

- Funil por campanha: `funilEtapas()` em `src/db/campanhas.js:188` agrega `campanha_leads.status`.
- Analítica de ligações: `app.vw_ligacoes_analiticas` (migration 051).
- Resultados por anúncio: `obterResultadosAnunciosMeta` — **precisa de `empresa_id`** (R-5).

**Métricas propostas**, com a separação que o pedido pede:

| Métrica | Fonte | Origem |
| --- | --- | --- |
| Leads recebidos | `app.lead_atribuicao` | **CRM** |
| Conversas iniciadas | `vendas.conversas` | **CRM** |
| Reuniões marcadas | `app.conversao_eventos` (`tipo='reuniao_marcada'`) | **CRM** |
| Comparecimento | `agenda_eventos.status` (`concluido` × `nao_compareceu`) | **CRM** |
| Vendas fechadas + receita | `app.conversao_eventos` (`tipo='venda_fechada'`) | **CRM** |
| Taxa de agendamento / comparecimento / fechamento | Razões das linhas acima | **CRM** |
| Investimento, CPM, CTR, alcance | **Meta Marketing API** — *não integrada hoje* | **Meta** |
| CPL / custo por reunião / custo por venda / ROAS | Investimento (Meta) ÷ contagem (CRM) | **Misto** |

**Ponto crítico e não óbvio:** hoje **não existe leitura de gasto da Meta**. O comentário em
`meta-attribution.js:253` diz explicitamente que "o gasto/CPL/custo-por-reunião NÃO vem daqui" e é
preenchido manualmente no painel. **Custo por reunião e ROAS automáticos exigem uma segunda
integração — a Marketing API (leitura) —, distinta da Conversions API (escrita).** Ela não está no
escopo deste pedido e precisa de decisão separada.

Sobre "evitar concluir por CTR": a razão estrutural é que CTR e cliques medem *tráfego*, e o
funil real deste produto só se revela 3 a 15 dias depois, na reunião e na venda. A defesa correta é
o painel **sempre exibir a coluna de reuniões/vendas ao lado de qualquer métrica de clique**, e
marcar como "janela incompleta" os anúncios com menos de N dias — porque um anúncio de 2 dias com
0 reuniões não é um anúncio ruim, é um anúncio jovem.

---

## 19. Lista de arquivos que provavelmente precisarão ser alterados

**Nenhum foi alterado.** Esta é a projeção para as Fases 2–7.

### Criar

| Arquivo | Fase |
| --- | --- |
| `backend/sql/migrations/056_meta_integracoes.sql` | 2 |
| `backend/sql/migrations/057_lead_atribuicao.sql` | 3 |
| `backend/sql/migrations/058_conversao_eventos.sql` | 4 |
| `backend/sql/migrations/059_conversao_tentativas.sql` | 5 |
| `backend/src/db/meta-integracoes.js` | 2 |
| `backend/src/db/conversao-eventos.js` | 4 |
| `backend/src/services/meta-conversao.js` (regras puras: `event_id`, backoff, elegibilidade) | 4 |
| `backend/src/services/meta-dispatch.js` (worker) | 5 |
| `backend/src/routes/api-integracoes.js` | 2 |
| `backend/test/meta-conversao.test.js`, `meta-integracoes.test.js`, `meta-dispatch.test.js` | 2–5 |
| `frontend/app/dashboard/integracoes/page.tsx` (+ componentes) | 6 |

### Alterar

| Arquivo | O que muda | Risco |
| --- | --- | --- |
| `backend/src/services/meta-capi.js` | Receber config como argumento em vez de `process.env` | **Médio** — tem teste; uma só chamada |
| `backend/src/services/meta-attribution.js` | Desligar `dispararEventosMetaPendentes` global; manter score e atribuição | **Alto** — é o coração do comportamento atual |
| `backend/src/meta-routes.js` | Escopar por empresa ou remover | Médio |
| `backend/src/agent.js` (~L497) | Registrar o novo worker no tick | Baixo |
| `backend/src/handoff-alerts.js` (~L262) | Chamar `registrarConversao` após criar a reunião | Médio |
| `backend/src/db/ligacoes.js` (~L262) | Registrar conversão na transação de `encerrarLigacao` | Médio |
| `backend/src/services/agenda-multiempresa.js` (~L184) | Registrar conversão ao criar reunião | Baixo |
| `backend/src/agenda.js` (~L1374) | Registrar conversão de venda; considerar equivalente em `/api/*` | Médio |
| `backend/src/routes.js` / `index.js` | Montar a rota nova | Baixo |
| `backend/src/domain-enums.js` + `test/domain-enums.test.js` | Enums novos (obrigatório pelo anti-drift) | Baixo |
| `frontend/components/Sidebar.tsx` | Item "Integrações" | Baixo |
| `AGENTS.md` + `backend/.env.example` | `META_ENC_KEY` e o novo modelo por tenant | Baixo — **obrigatório**, o AGENTS.md proíbe env não documentada |
| `docs/project-map.md`, `ai-decision-log.md`, `project-change-map.md` | Fase 7/8 do workflow | Baixo |

---

## 20. Dúvidas e decisões que precisam ser validadas antes da implementação

Ordenadas por quanto bloqueiam o trabalho.

1. **Qual é a definição de "venda fechada" com valor, e por onde ela passa?** Hoje há três
   marcações de venda e só uma tem valor — numa rota single-tenant. **Sem essa decisão, a Fase 4
   não sai do lugar.** (Seção 4.3 / 5.2)
2. **O que fazer com a integração global que já está rodando?** Migrar os eventos já enviados para
   o ledger novo (evita reenviar tudo à Meta) ou considerar tudo "novo"? Recomendo migrar.
3. **Um dataset por empresa, ou uma empresa pode ter várias contas de anúncio?** Assumi 1:1 na
   Fase 2 (`UNIQUE (empresa_id)`). Se 1:N for necessário, o modelo muda antes de escrever a migration.
4. **`superadmin` pode ver/editar credenciais Meta de qualquer tenant?** Hoje passa em tudo por
   design. Para credencial de terceiro, isso é uma escolha de contrato — precisa da sua decisão.
5. **Reunião cancelada / no-show deve retirar ou impedir a conversão?** A Meta não aceita estorno
   de `LeadSubmitted`. Recomendo: **enviar só quando a reunião for confirmada**, ou aceitar a
   contagem no agendamento e documentar o viés. Muda a qualidade da otimização.
6. **Custo por reunião e ROAS automáticos são requisito?** Se sim, é preciso decidir sobre a
   **Marketing API** (leitura de gasto), que é uma integração separada e não está neste escopo.
7. **Existe algum tenant além da PJ com anúncios rodando hoje?** Se sim, **R-1 já está causando
   vazamento em produção** e a Fase 2 vira urgente.
8. **A tabela `public."Message"` do Evolution está no mesmo banco em produção?** O código checa com
   `to_regclass` e vira no-op silencioso se não estiver — nesse caso a atribuição CTWA **não está
   funcionando** e ninguém seria avisado. Vale confirmar antes de construir em cima.
9. **Leads de formulário/landing entram no escopo?** Modelei `lead_atribuicao` para suportar
   (`fbc`/`fbp`/`utm_*`), mas não existe nenhuma landing hoje. Se não entrarem, a tabela simplifica.
10. **Retenção de `lead_atribuicao` e `conversao_tentativas`** — prazos precisam vir de vocês/jurídico.
11. **Chave de cripto**: `META_ENC_KEY` própria (recomendo) ou reusar `FREELANDOO_ENC_KEY`?

---

**Nenhuma implementação será iniciada sem aprovação.** Aprovado o desenho, cada fase abre sua
própria Fase 0 em `ai-task-start-log.md`, com análise de impacto e migration dedicada, conforme o
workflow do projeto.
