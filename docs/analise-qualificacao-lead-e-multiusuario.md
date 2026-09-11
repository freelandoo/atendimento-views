# Análise — Qualificação do lead como porta da operação comercial + multiusuário

> **Status: ANÁLISE. Nada foi implementado.** Sem migration, sem rota, sem tela, sem alteração
> de comportamento de produção. Data: 2026-09-11. Fase 0 registrada em
> [ai-task-start-log.md](ai-task-start-log.md).
>
> **Princípio que o pedido estabelece:** *encontrar um lead não significa que ele está
> autorizado a ser trabalhado.* O lead só entra na operação comercial depois de triagem e
> aprovação.

## Resumo em cinco frases

1. **A triagem já existe e está construída** — `prospectador.prospects.status` tem
   `aguardando | aprovado | rejeitado`, e há uma camada de curadoria por lead completa
   (migration `055`, Assistente de Oportunidades) que grava decisão, autor, justificativa e
   características.
2. **O que não existe é a PORTA.** Nenhum consumidor comercial exige `aprovado`: a fila da
   Central de Ligações não lê `prospects.status`, e o disparo de WhatsApp aceita `aguardando`
   explicitamente.
3. A própria interface diz isso ao operador hoje, com estas palavras, em
   [prospeccao/page.tsx:460](../frontend/app/dashboard/prospeccao/page.tsx#L460): *"Marca como
   lead bom **(opcional — ele já pode ser disparado sem isso)**"*.
4. **Status de qualificação e status comercial já estão separados no schema** — qualificação em
   `prospects.status`, comercial em `app.campanha_leads.status` (12 valores, por campanha). O
   problema é que `prospects.status` **mistura** os dois eixos (`enviado`, `respondeu`, `fechado`
   são fatos comerciais dentro da coluna de qualificação).
5. **Multiusuário comercial é impossível hoje**, e não por falta de role: as 6 telas da operação
   são `requireRole('admin')`, o papel por empresa (`app.usuarios_empresas.role`) **nunca é lido
   por nenhuma autorização**, e não há fluxo no produto para adicionar uma segunda pessoa a uma
   empresa existente.

---

## 1. Arquitetura atual

### 1.1 Duas camadas que convivem

| Camada | Schema | Auth | Consumidor |
| --- | --- | --- | --- |
| **SaaS multiempresa** (atual) | `app.*` + `prospectador.*` | JWT Bearer (`src/auth.js`), `requireAuth` + `requireRole` + `requireEmpresaAccess` | `frontend/` (Next.js) |
| **Dashboard legado** | `vendas.*` | Cookie de sessão em `vendas.dashboard_users` (`src/dashboardAuth.js`), CSRF | `backend/public/dashboard/` (estático) |

As duas mexem **na mesma tabela de leads** (`prospectador.prospects`). São dois sistemas de
identidade independentes: `app.usuarios` e `vendas.dashboard_users` não se conhecem.

### 1.2 Tabelas relevantes

**`prospectador.prospects`** — a tabela de leads, única para Google Maps (Bright Data) e
Instagram/LinkedIn. [init.sql:685-721](../backend/sql/init.sql#L685-L721).

| Campo | Tipo | Papel |
| --- | --- | --- |
| `id` | UUID PK | |
| `empresa_id` | UUID FK `app.empresas` | **tem `DEFAULT` = PJ Codeworks** (migration `005`, linha 45) |
| `status` | TEXT NOT NULL DEFAULT `'aguardando'` | **o campo do pedido** — ver §4 |
| `place_id` | TEXT | dedup; `UNIQUE (empresa_id, place_id)` |
| `origem` | TEXT | `manual` \| `automatico` \| `instagram` \| `linkedin` |
| `telefone`, `email`, `nome`, `nicho`, `cidade`, `endereco` | | contato e mercado |
| `tem_site` / `site` / `link_original` / `classificacao_url` | | classificação canônica de site (migration `056`) |
| `score`, `motivo_score` | | temperatura congelada na coleta (legado) |
| `score_v2`, `score_dimensoes`, `oferta_recomendada` | | esteira antiga; colunas criadas em [db.js:133-137](../backend/src/db.js#L133-L137) |
| `decision_log` | JSONB NOT NULL `[]` | **log append-only por lead** ([db.js:138](../backend/src/db.js#L138)) |
| `bloqueado_ate`, `bloqueio_motivo` | | trava de 15 dias (migration `016`) |
| `tem_whatsapp` | BOOLEAN NULL | aprendido no disparo (migration `021`) |

**Triagem (já existe):** `prospectador.curadoria_sessoes` + `prospectador.curadoria_decisoes`
(migration `055`). A decisão grava `decisao`, `contou_meta`, `justificativa`,
`caracteristicas` (sem PII), `usuario_id`, `criado_em`.

**Operação comercial:**

| Tabela | Migration | O que guarda |
| --- | --- | --- |
| `app.campanhas` | `039` | campanha, nicho, roteiro/versão, metas, status |
| `app.campanha_responsaveis` | `039` | N:N campanha ↔ usuário |
| `app.campanha_leads` | `039` | **a oportunidade**: `status` (12 valores), `responsavel_id`, `proxima_acao`, `data_followup` |
| `app.ligacoes` (+ `ligacao_etapas/sinais/objecoes/perguntas`) | `040-049`, `068` | a ligação e seu detalhe |
| `app.follow_ups` | `062`, `067` | próxima ação por contato + canal, com `responsavel_id` e `prospect_id` nullable |
| `app.contato_canal_disponibilidade` | `066` | veredito humano sobre canal do contato |
| `prospectador.lead_disparos` | `016` | disparos de saudação do Banco de Leads |
| `prospectador.email_outreach` | `012` | e-mail de primeira abordagem |
| `vendas.conversas` / `vendas.lead_profiles` | init | o atendimento por WhatsApp |
| `app.auditoria_eventos` | `047` | **log genérico append-only** (`entidade_tipo`/`acao`/`contexto` JSONB, sem CHECK) |

**Identidade e acesso:**

| Tabela | Campos de acesso |
| --- | --- |
| `app.usuarios` | `role` CHECK `superadmin \| admin \| user` |
| `app.usuarios_empresas` | `role` CHECK `owner \| admin \| member`, `ativo` |
| `vendas.dashboard_users` | `role` (só `'admin'` é aceito no login) |

### 1.3 Serviços, rotas e telas por área

| Área | Rota | Service / DB | Tela |
| --- | --- | --- | --- |
| Busca (Aquisição) | `POST /prospeccao/buscar`, `GET /prospeccao/prospects` | `prospecting.js` (`pesquisarPlaces`, `salvarProspect`), `places-brightdata.js` | `dashboard/aquisicao` (+ `prospeccao`, `captacao` como abas) |
| Rotinas de coleta | `/prospeccao/rotinas` | `aquisicao-rotinas-scheduler.js`, `db/aquisicao-rotinas.js` | `RotinasAquisicao.tsx` |
| **Triagem** | `/prospeccao/curadoria/*` | `aquisicao-curadoria.js`, `aquisicao-curadoria-ranking.js`, `db/aquisicao-curadoria.js` | `AssistenteOportunidades.tsx`, `AssistenteEntrada.tsx` |
| Aprovar/descartar direto | `POST /prospeccao/prospects/:id/aprovar` \| `/rejeitar` \| `/lote` | `prospecting.js` `atualizarStatusProspect(sLote)` | menu radial da linha na Aquisição |
| Captação social | `/captacao/*` | `social-capture.js`, `brightdata-client.js` | `dashboard/captacao` |
| Banco de Leads | `/banco-leads/*` | `rodar-leads.js`, `banco-leads-auto.js`, `saudacao-analise.js` | `dashboard/banco-leads` |
| Central de Ligações | `/campanhas/:id/fila`, `/ligacoes/*` | `db/campanhas.js`, `db/ligacoes.js`, `ligacao-prioridade.js` | `dashboard/central-ligacoes` |
| Follow-ups | `/follow-ups/*` | `followup-listing.js`, `followup-call-score.js`, `db/follow-ups.js` | `dashboard/follow-ups` |
| Central de Mensagens | `/conversas/*` | `db-crud.js`, `conversa-manual.js` | `dashboard/conversas`, `ConversaPainel.tsx` |
| E-mail | `POST /captacao/leads/:id/email/enviar`, `POST /follow-ups/itens/:id/email/enviar` | `email-outreach.js`, `followup-email.js` | `captacao`, `follow-ups` |

### 1.4 Automações (workers) que tocam leads

| Worker | Onde nasce | O que faz |
| --- | --- | --- |
| `banco-leads-auto.js` | `index.js`, tick `BANCO_LEADS_AUTO_WORKER_MS` | **dispara WhatsApp sozinho** ao lead elegível |
| `executarRotinasAquisicao` | tick de `agent.js` | dispara coletas pagas |
| `processarBuscasPlacesPendentes` | tick de `agent.js` (60s) | importa o resultado da coleta |
| `capture worker` + `dispararCampanhasAgendadas` | `social-capture.js` | coleta Instagram |
| `followup-auto.js` | job `followup_auto` | follow-up automático por conversa |
| `lead-lock.js` | `index.js` | trava de 15 dias |
| `prospecting-send-worker.js` | job `prospeccao_envio_agendado` | envio legado agendado |
| `meta-dispatch.js` | tick de `agent.js` | conversões Meta |

---

## 2. Fluxo atual do lead (extraído do código, não suposto)

```
COLETA (Bright Data Maps / Instagram)
  └─ pesquisarPlaces()  → prospectador.busca_snapshots (reserva + job pago)
       └─ worker: processarBuscasPlacesPendentes()
            └─ salvarProspect()  [prospecting.js:1100]
                 └─ INSERT prospects (status = DEFAULT 'aguardando')
                    ON CONFLICT (empresa_id, place_id) DO UPDATE  ← status NÃO é atualizado

AQUISIÇÃO (tela)  ── lista TODOS os status, inclusive rejeitado
  ├─ [opcional] Assistente de Oportunidades  →  status = aprovado | rejeitado
  └─ [opcional] menu radial "Marcar" / "Descartar"  →  mesmos dois status

               ╔══════════════════════════════════════════════════════╗
               ║   NÃO EXISTE PORTA AQUI. Os três caminhos abaixo      ║
               ║   partem de prospects sem exigir aprovação.           ║
               ╚══════════════════════════════════════════════════════╝

(A) BANCO DE LEADS → "Rodar leads"
      aba "sem_contato" = ['coletado','contato_encontrado','aguardando','aprovado']
      rodarLeads() aceita STATUS_RODAVEL = os mesmos 4          [rodar-leads.js:37]
      → enviarMensagem() WhatsApp  → status = 'enviado'
      → worker banco-leads-auto.js faz isso SOZINHO, em janela horária

(B) CENTRAL DE LIGAÇÕES
      adicionarLeads(campanha, prospect_ids)  ← filtra SÓ empresa_id   [campanhas.js:177]
      → app.campanha_leads (status 'nao_iniciado')
      → filaDeTrabalho() filtra SÓ cl.status NOT IN (convertido, descartado)
        + telefone discável (elegivelParaFila)                        [campanhas.js:233]
      → iniciarLigacao() — nenhuma verificação de prospects.status    [ligacoes.js:203]

(C) E-MAIL
      enviarEmailProspect(empresaId, prospectId)  ← nenhum filtro de status
                                                    [email-outreach.js:59]

DEPOIS DO PRIMEIRO CONTATO
  WhatsApp → vendas.conversas → Central de Mensagens → followup-listing → Follow-ups
  Ligação  → app.ligacoes → encerrarLigacao() → app.follow_ups (transacional) + campanha_leads
```

**Leitura:** o pipeline tem **quatro** portas de entrada na operação (WhatsApp manual, WhatsApp
automático, ligação, e-mail) e **zero** verificações de aprovação. A triagem é um adorno
opcional no meio do caminho.

---

## 3. Problemas encontrados

### CRÍTICO

**C1 — A fila da Central de Ligações não conhece o status de qualificação.**
[`db/campanhas.js:233-258`](../backend/src/db/campanhas.js#L233-L258) faz `JOIN
prospectador.prospects p` e lê 20 colunas de `p` — **`p.status` não está entre elas**. O único
recorte é `cl.status NOT IN ('convertido','descartado')` + telefone discável. Lead `aguardando`
e lead `rejeitado` entram na fila indistinguíveis de um `aprovado`.

**C2 — A porta de entrada da campanha não filtra nada além do tenant.**
[`adicionarLeads`, campanhas.js:177-189](../backend/src/db/campanhas.js#L177-L189):
`WHERE p.empresa_id = $2 AND p.id = ANY($3)`. Qualquer id de prospect da empresa entra na
campanha, em qualquer status. É aqui que o defeito nasce; C1 só o propaga.

**C3 — O disparo de WhatsApp aceita `aguardando` por decisão explícita.**
[`STATUS_RODAVEL`, rodar-leads.js:37](../backend/src/services/rodar-leads.js#L37) =
`{coletado, contato_encontrado, aguardando, aprovado}`. Vale para os três modos (Manual, Semi e
**Automático**) — o worker `banco-leads-auto.js` usa a mesma constante
([banco-leads-auto.js:267](../backend/src/services/banco-leads-auto.js#L267)). Ou seja: **um
lead que ninguém olhou recebe mensagem sozinho**, dentro da janela configurada.

**C4 — A interface ensina que aprovar é decorativo.** O texto da ação na Aquisição é
literalmente *"Marca como lead bom (opcional — ele já pode ser disparado sem isso)"*
([prospeccao/page.tsx:460](../frontend/app/dashboard/prospeccao/page.tsx#L460)). O rótulo é
"Marcar", não "Aprovar". Isso explica por que o conceito existe e não governa nada.

**C5 — Não existe papel comercial possível.** As 6 telas da operação (`prospeccao`,
`banco-leads`, `campanhas`, `ligacoes`, `follow-ups`, `roteiros`) são montadas com
`requireRole('admin')` em [index.js:98-111](../backend/index.js#L98-L111). Um usuário `user`
recebe **403 em tudo**: não pode ligar, não pode ver fila, não pode registrar resultado.
Simultaneamente, `user` **pode** entrar na Central de Mensagens e escrever para qualquer
contato (`api-conversas` é só `requireAuth` + `requireEmpresaAccess`,
[index.js:94](../backend/index.js#L94)). O gating atual é o **oposto** do desenho pretendido.

**C6 — O papel por empresa existe no schema e não autoriza nada.**
`app.usuarios_empresas.role` (`owner|admin|member`) é escrito em 3 lugares e **nunca lido por
autorização**: `requireRole` lê `req.usuario.role`, a role **global** de `app.usuarios`
([tenant.js:113-124](../backend/src/middleware/tenant.js#L113-L124)). `usuarios_empresas` só é
consultado para responder "pertence?" (`usuarioPertenceAEmpresa`) e para validar responsável
(`campanhas.js:148`, `follow-ups.js:146`). Consequência: **`admin` de uma empresa é `admin` em
toda empresa a que pertencer.**

### IMPORTANTE

**I1 — Não há como adicionar uma segunda pessoa a uma empresa pelo produto.**
`createUsuarioPorAdmin` ([db/usuarios.js:98](../backend/src/db/usuarios.js#L98)) cria o usuário
e **não cria vínculo em `usuarios_empresas`** — o usuário nasce sem acesso a empresa alguma. Os
únicos caminhos que criam vínculo são `signupUsuario` (cria empresa **própria** como `owner`) e
`POST /api/empresas` (idem). Não existe convite/adição de membro. Hoje isso só se faz com
`INSERT` manual.

**I2 — `prospects.status` mistura dois eixos.** Os 9 valores atuais
(`aguardando, aprovado, rejeitado, enviado, respondeu, coletado, contato_encontrado,
nao_contatar, fechado` — migration `013`) contêm qualificação (`aguardando/aprovado/rejeitado`),
estado de coleta (`coletado/contato_encontrado`), fato comercial (`enviado/respondeu/fechado`) e
compliance (`nao_contatar`). **Um lead que já foi disparado não tem mais qualificação
registrada** — `enviado` apagou `aprovado`. Isso impede qualquer regra de "só aprovado", porque
a informação é destruída na primeira ação.

**I3 — Auto-aprovação latente no fluxo legado.** `processarFluxoCompleto`
([prospecting.js:2202-2211](../backend/src/prospecting.js#L2202-L2211)) faz
`atualizarStatusProspectsLote(idsDiagnosticados, 'aprovado')` e agenda envio, sem intervenção
humana. Chamado pelo job `prospeccao_completo`, enfileirado por
`POST /dashboard/prospeccao/places-search-completo` ([prospecting.js:4164](../backend/src/prospecting.js#L4164)).
**Hoje é inofensivo por acidente:** desde a migração para Bright Data, `pesquisarPlaces` devolve
`prospects: []` ([prospecting.js:3941-3948](../backend/src/prospecting.js#L3941-L3948)), então o
job recebe lista vazia. O código de auto-aprovação continua vivo e funcional.

**I4 — O dashboard legado aprova/rejeita prospect de qualquer tenant.**
`POST /dashboard/prospeccao/prospects/:id/aprovar|rejeitar` e as versões `/lote` chamam
`atualizarStatusProspect(id, status)` **sem `empresaId`**
([prospecting.js:4183-4232](../backend/src/prospecting.js#L4183-L4232)); o filtro por empresa é
opcional na função ([prospecting.js:1487](../backend/src/prospecting.js#L1487)). Um admin do
dashboard legado muda o status de lead de qualquer empresa. Requer sessão `vendas.dashboard_users`
com role `admin` — não é acesso anônimo, mas é ausência total de escopo de tenant.
*(O fallback `x-reprocess-secret` de `dashboardAutorizado` em
[prospecting.js:76-82](../backend/src/prospecting.js#L76-L82) é **inalcançável** nessas rotas:
`app.use('/dashboard', requireDashboardAuth)` em [index.js:79](../backend/index.js#L79) já
responde 401 antes. É código morto, não um bypass ativo.)*

**I5 — E-mail sem nenhuma qualificação.** `enviarEmailProspect`
([email-outreach.js:59-66](../backend/src/services/email-outreach.js#L59-L66)) valida só
existência do prospect e presença de e-mail. Um `rejeitado` com e-mail é abordável.

**I6 — `prospects.empresa_id` tem `DEFAULT` = PJ Codeworks** (migration `005`, linha 45). É
exatamente o defeito que a migration `058` corrigiu em `vendas.lead_profiles.empresa_id`. Hoje
todos os `INSERT` informam a coluna, então não há dado sujo conhecido — mas o `DEFAULT`
autoriza em silêncio qualquer escrita futura que a esqueça.

**I7 — Não existe enum canônico para `prospects.status`.** Ele é redeclarado em 7 lugares, com
conjuntos **diferentes**: `init.sql:713` (5 valores), migration `013` (9), `normalizarStatusProspect`
([prospecting.js:105-110](../backend/src/prospecting.js#L105-L110) — **só 5**), `STATUS_RODAVEL`
(4), `ABAS` do Banco de Leads (7 em 3 grupos), `STATUS_VALIDOS` da Captação (8), e o `CASE` do
upsert de `social-capture.js:335`. `src/domain-enums.js` — que tem anti-drift para
`OPORTUNIDADE_STATUS`, `LIGACAO_STATUS`, `FOLLOWUP_*` — **não conhece este status**. Efeito
lateral já presente: `GET /prospeccao/prospects?status=coletado` **ignora o filtro em silêncio**,
porque `normalizarStatusProspect` devolve `''` para `coletado`, `contato_encontrado`, `fechado`
e `nao_contatar`.

**I8 — Aprovação não é auditada; rejeição é (parcialmente).**
`POST /prospeccao/prospects/:id/rejeitar` grava `decision_log` via `rejeitarProspectComMotivo`
somente no caminho com motivo; a rota `/rejeitar` simples e a `/aprovar`
([api-prospeccao.js:229-250](../backend/src/routes/api-prospeccao.js#L229-L250)) chamam
`atualizarStatusProspect` direto — **sem `decision_log`, sem `prospect_events`, sem
`auditoria_eventos`, sem `usuario_id`**. O caminho da curadoria (migration `055`) **grava tudo**.
Duas portas para a mesma decisão, com rastros diferentes.

**I9 — Dois vendedores na mesma ligação: a trava existe, e o comportamento é entregar a sessão.**
Há índice único parcial `idx_ligacoes_uma_ativa_por_lead` (migration `048`) — nunca há duas
ligações ativas. Mas `iniciarLigacao` é idempotente e **retoma a ligação ativa alheia**
([ligacoes.js:216-218](../backend/src/db/ligacoes.js#L216-L218)). O modo Acompanhar (somente
leitura) e o `sou_eu` calculado no servidor mitigam isso na tela, e o AGENTS.md já declara o
enforcement como sendo **de interface**: as rotas de escrita não exigem dono.

### MELHORIA FUTURA

- **M1** — `prospects.score` (temperatura congelada na coleta) e `score_v2` (esteira legada)
  coexistem com a prioridade comercial calculada na leitura (`ligacao-prioridade.js`) e a
  completude de cadastro (`lead-score-cadastro.js`). Quatro réguas.
- **M2** — `app.campanha_leads.responsavel_id` e `app.follow_ups.responsavel_id` existem, são
  validados contra `usuarios_empresas`, e **nenhuma listagem filtra por eles**. Já há índice
  `(empresa_id, responsavel_id, status)` na migration `062`.
- **M3** — Não há tela de campanhas. `POST /campanhas/:id/leads` **não tem nenhum chamador no
  frontend** (confirmado por varredura em `app/`, `components/`, `lib/`); campanha e leads são
  criados por chamada direta à API. Isso é uma **oportunidade**: a porta C2 pode ser fechada com
  risco de regressão de UI igual a zero.
- **M4** — A tela do Banco de Leads não distingue `aguardando` de `aprovado` em lugar nenhum: os
  dois vivem na aba "Sem contato". Mesmo que a regra entre em vigor, o operador não vê o estado.

---

## 4. Estrutura existente de "marcado" e "descartado" (o que o pedido manda investigar)

### 4.1 O campo real

| Pergunta | Resposta |
| --- | --- |
| **Nome real** | `status` |
| **Tabela** | `prospectador.prospects` |
| **Tipo** | `TEXT NOT NULL DEFAULT 'aguardando'`, com `CHECK` fechado |
| **Valores possíveis** | `aguardando`, `aprovado`, `rejeitado`, `enviado`, `respondeu`, `coletado`, `contato_encontrado`, `nao_contatar`, `fechado` (migration `013`, `NOT VALID`) |
| **"Marcado" na UI** | = `status = 'aprovado'`. O botão se chama **"Marcar"** |
| **"Descartado" na UI** | = `status IN ('rejeitado','nao_contatar')` **OU** `tem_whatsapp = false` ([api-banco-leads.js:95](../backend/src/routes/api-banco-leads.js#L95)) |
| **Enum canônico?** | **Não.** Ver I7 |

### 4.2 Quem escreve

| Escritor | Para | Auditoria |
| --- | --- | --- |
| `db/aquisicao-curadoria.js:199-220` (curadoria) | `aprovado` \| `rejeitado`, **só a partir de `aguardando`** | `curadoria_decisoes` (usuário, justificativa, características) ✅ |
| `api-prospeccao.js:229/241/265` → `atualizarStatusProspect(sLote)` | `aprovado` \| `rejeitado` | ❌ nenhuma |
| `prospecting.js:4183-4232` (dashboard legado) | idem, **sem escopo de empresa** | `prospect_events` ✅ (sem usuário) |
| `prospecting.js:3699` `aprovarProspectComOferta` | `aprovado` | `decision_log` ✅ |
| `prospecting.js:3769` `rejeitarProspectComMotivo` | `rejeitado` | `decision_log` ✅ |
| `prospecting.js:2211` `processarFluxoCompleto` | `aprovado` **automático** | `prospect_events` |
| `prospecting.js:2113`, `prospecting-send-worker.js:209` | `enviado` (após envio) | — |
| `prospecting.js:2433/2458` | `respondeu` | — |
| `api-banco-leads.js:615/629` | `fechado` / volta a `respondeu` | ❌ nenhuma |
| `api-captacao.js:188-200` | qualquer um dos 8, só `origem IN (instagram, linkedin)` | ❌ nenhuma |
| `social-capture.js:335-340` (recoleta) | promove a `contato_encontrado`, **preserva** terminais | — |
| `lead-lock.js` | escreve `bloqueado_ate`, **não** `status` | — |

### 4.3 Quem lê, e o que o status realmente causa hoje

| Leitor | Efeito real |
| --- | --- |
| `api-banco-leads.js:34-37` (`ABAS`) | agrupa o funil. `aguardando` e `aprovado` **na mesma aba** |
| `rodar-leads.js:37,263,666` | permite disparo — **`aguardando` incluído** |
| `banco-leads-auto.js:267` | idem, sem humano |
| `api-captacao.js:22-27` | abas da Captação |
| `prospecting.js:2030,2356` | pipeline legado: **exige `aprovado`** ✅ (único lugar que trata como porta) |
| `prospecting.js:3593` | fila de aprovação legada: `aguardando AND score_v2 >= 40` |
| `prospecting.js:1387-1391` | ordenação da listagem |
| `db/aquisicao-curadoria.js:114,146` | monta a fila de triagem (`aguardando`) |
| **`db/campanhas.js`** | **não lê** |
| **`db/ligacoes.js`** | **não lê** |
| **`email-outreach.js`** | **não lê** |
| **`followup-*`** | **não lê** (opera sobre conversa/telefone) |

### 4.4 Veredito sobre reaproveitar o campo

**Reaproveitar `aprovado`/`rejeitado` como semântica: sim.** Criar um segundo campo de
qualificação seria duplicação — os valores existem, a triagem existe, a fila de triagem existe,
o registro de decisão existe.

**Reaproveitar a COLUNA `status` como a única fonte: não.** O motivo é factual, não estético:
`enviado` **sobrescreve** `aprovado` (rodar-leads.js e send-worker gravam `status='enviado'`).
Qualquer regra da forma "só entra quem está `aprovado`" **expulsaria da operação todo lead já
contatado** — que é justamente quem mais precisa de follow-up. Um eixo de qualificação
persistente não pode viver na mesma coluna que muda a cada ação comercial.

---

## 5. Arquitetura recomendada

```
                    ┌──────────── COLETA ────────────┐
 Bright Data Maps ──▶  prospects                      │  qualificacao = 'pendente'
 Instagram/LinkedIn ─▶  (status de coleta preservado)  │  (nasce assim, sempre)
                    └───────────────┬─────────────────┘
                                    │
                    ┌───────────────▼─────────────────┐
                    │  TRIAGEM  (admin | qualificador) │  Assistente de Oportunidades
                    │  já existe: migration 055        │  + "Marcar"/"Descartar"
                    └───────┬───────────┬─────────────┘
                   aprovado │           │ descartado
                            │           └──▶ fora da operação, histórico preservado,
                            │                imune a nova coleta (§14/R9)
        ╔═══════════════════▼════════════════════════════════════════╗
        ║  PORTA ÚNICA — src/services/lead-qualificacao.js (PURO)    ║
        ║  "este lead está liberado para abordagem comercial?"        ║
        ║  chamada pelos 4 pontos de entrada, no BACKEND              ║
        ╚═══════════════════╤════════════════════════════════════════╝
                            │
   ┌────────────────┬───────┴────────┬──────────────────┐
   ▼                ▼                ▼                  ▼
 campanha_leads   rodar-leads     email-outreach     (futuro)
 (ligação)        (WhatsApp)      (e-mail)
   │                │                │
   └────────────────┴────────────────┴──▶ status COMERCIAL (campanha_leads.status)
                                          + responsavel_id
                                          + app.follow_ups
                                          + app.ligacoes / vendas.conversas
```

### Cinco decisões de arquitetura

**D1 — Dois eixos, duas colunas.** `qualificacao` (novo, na `prospects`) responde *"pode ser
trabalhado?"*. `campanha_leads.status` (existente) responde *"em que etapa está?"*. `status`
atual permanece **intocado** como estado de coleta/contato. Nenhum dado migra de coluna.

**D2 — A porta é um módulo PURO com dono único.** `src/services/lead-qualificacao.js`, no padrão
já consagrado de `instancia-envio.js` / `site-classificacao.js` / `conversa-modo-ia.js`: sem
banco, sem HTTP, sem IA. Ele **não** responde "qual a qualificação?", e sim **"esta abordagem
está liberada?"** — a primeira pergunta admite heurística, e foi heurística que produziu todos
os defeitos desta família neste repositório. Comparar `qualificacao` com literal fora do módulo
fica **proibido**, com guarda de regressão lendo `src/**` (padrão de `conversa-modo-ia`).

**D3 — A porta vive no BACKEND, nos 4 pontos de entrada, nunca na tela.** Esconder o lead bruto
do vendedor não é controle de acesso: `GET /prospeccao/prospects` devolveria a lista inteira a
um `curl`. Os pontos são `adicionarLeads`, `rodarLeads`+`gerarMensagensSemi`, `banco-leads-auto`
e `enviarEmailProspect`.

**D4 — Carência declarada para o acervo existente.** Precisa existir um estado que signifique
*"lead que já estava aqui antes da regra"*, e ele **não pode ser `pendente`** — senão a regra
nova congela a operação inteira no dia do deploy. É o mesmo raciocínio de `origem_vinculo =
'legado'` (migration `061`): **a ausência de prova, nomeada**, que continua operando e aparece
rotulada na tela.

**D5 — Autorização por CAPACIDADE, não por nível.** O papel comercial **não cabe** na hierarquia
atual `user(1) < admin(2) < superadmin(3)` ([navegacao.js:18](../frontend/lib/navegacao.js#L18)):
ele precisa de **mais** que `user` (Central de Ligações) e **menos** que `admin` (Aquisição,
Roteiros, Integrações). Toda tentativa de encaixá-lo num nível intermediário abre acesso a
coleta paga ou fecha acesso à fila.

---

## 6. Modelagem recomendada (alteração mínima)

### 6.1 O que criar

| Tabela | Campo | Tipo | Objetivo | Já existe equivalente? | Migração |
| --- | --- | --- | --- | --- | --- |
| `prospectador.prospects` | `qualificacao` | `TEXT NOT NULL DEFAULT 'legado'`, CHECK `pendente\|aprovado\|descartado\|legado` | eixo de qualificação que **sobrevive** à ação comercial | Não. `status` é o eixo de coleta/contato e é sobrescrito por `enviado` | **Aditiva.** `DEFAULT 'legado'` marca o acervo (D4); o código passa a inserir `'pendente'` explicitamente nos coletores |
| `prospectador.prospects` | `qualificado_em` | `TIMESTAMPTZ NULL` | quando | Não | aditiva |
| `prospectador.prospects` | `qualificado_por` | `UUID NULL` | quem | `curadoria_decisoes.usuario_id` (só no caminho da curadoria) | aditiva |
| — índice | `(empresa_id, qualificacao)` parcial `WHERE qualificacao = 'aprovado'` | | fila comercial | `idx_prospects_empresa_telefone_digitos` existe p/ outro fim | aditiva |

**Por que `DEFAULT 'legado'` e não `'pendente'`:** um `DEFAULT 'pendente'` marcaria os ~800+
leads existentes como não triados e **pararia a operação no boot**. O inverso (`DEFAULT
'aprovado'`) mentiria: ninguém os aprovou. `legado` = "operava antes da regra, ninguém provou
nada", visível na tela com selo próprio, e reduzível por triagem retroativa quando o operador
quiser.

**Risco declarado do `DEFAULT`:** o próprio repositório trata `DEFAULT` em coluna de prova como
defeito (migrations `061`/`066`: `origem` é `NOT NULL SEM DEFAULT` justamente para não autorizar
INSERT esquecido). Aqui o `DEFAULT` é necessário para a carência. **Mitigação:** os 2 coletores
(`salvarProspect`, `salvarProspectSocial`) passam a informar `'pendente'` explicitamente, e uma
guarda de regressão lê o fonte e falha se um coletor novo omitir a coluna.

### 6.2 O que reaproveitar (e NÃO criar)

| Necessidade do pedido | O que já existe | Veredito |
| --- | --- | --- |
| `qualified_by` / `qualified_at` | `curadoria_decisoes` (completo) + `decision_log` + `prospect_events` + `app.auditoria_eventos` | **Não criar tabela.** Padronizar as 2 rotas soltas (`/aprovar`, `/rejeitar`) para gravar em `app.auditoria_eventos` (`entidade_tipo='prospect'`, `acao='prospect_qualificado'`), como as demais escritas do projeto já fazem |
| `assigned_user_id` | `app.campanha_leads.responsavel_id` + `app.follow_ups.responsavel_id`, ambos validados contra `usuarios_empresas`, com índices prontos | **Não criar campo.** Falta apenas **filtrar** por eles |
| Status comercial | `app.campanha_leads.status` (12 valores) + `OPORTUNIDADE_STATUS` com anti-drift | **Não criar.** Cobre `NOVO`→`CLIENTE` do pedido |
| Histórico de descartado | `status='rejeitado'` + `curadoria_decisoes` + `decision_log` | **Não criar** |
| Trava lead já trabalhado | `bloqueado_ate`/`bloqueio_motivo` + `lead_disparos` + `canProspectLead` (opt-out, janela de reprospecção) | **Não criar** |

### 6.3 Onde a porta é aplicada (nenhum campo novo)

| Ponto | Arquivo | Mudança |
| --- | --- | --- |
| Entrada da campanha | `db/campanhas.js:177` | `AND p.qualificacao IN ('aprovado','legado')` no `SELECT` do `INSERT` |
| Fila (2ª barreira) | `db/campanhas.js:233` | `AND p.qualificacao <> 'descartado'` (defesa em profundidade para leads já vinculados) |
| WhatsApp | `rodar-leads.js:263,666` | novo motivo de `pulados`: `nao_qualificado` |
| WhatsApp automático | `banco-leads-auto.js:138` | idem, no `WHERE` do candidato |
| E-mail | `email-outreach.js:59` | recusa `422` com motivo próprio |

`prospects.status`, `STATUS_RODAVEL`, `ABAS`, `OPORTUNIDADE_STATUS`, `followup_*` e os CHECKs
existentes **não são alterados**.

---

## 7. Autenticação e usuários

### Situação atual

| Item | Estado |
| --- | --- |
| Existe autenticação? | **Sim, duas.** JWT (`app.usuarios`) e sessão por cookie (`vendas.dashboard_users`) |
| Tecnologia | `jsonwebtoken` HS256 + `scrypt` (`src/auth.js`); sessão em tabela + CSRF (`src/dashboardAuth.js`) |
| Armazenamento | `app.usuarios` (`password_hash` scrypt) |
| Roles | **Sim, duas escalas independentes**: global `superadmin\|admin\|user`; por empresa `owner\|admin\|member` |
| RBAC por recurso? | **Não.** `requireRole(...roles)` é lista de papéis, aplicada por **mount de router** |
| Permissões por recurso? | **Não existem** |
| Sessão | JWT stateless (`JWT_EXPIRES_IN`); `requireAuth` **relê o usuário do banco** a cada request — mudança de role vale na hora, e usuário inativo perde acesso imediatamente ✅ |
| Rotas protegidas | `requireAuth` → `requireRole` (no mount) → `requireEmpresaAccess` (por rota) |
| APIs protegidas | Sim, mesma cadeia. `empresa_id` é reforçado no SQL de cada módulo de dados |
| Ligação registro↔usuário | `criado_por`, `usuario_id`, `responsavel_id` em várias tabelas |
| Middleware de auth | `src/middleware/tenant.js` |
| Policies no banco / RLS | **Não existem.** Zero `CREATE POLICY` / `ENABLE ROW LEVEL SECURITY` no repositório |
| Autorização só no frontend? | **Não** — o backend é a autoridade. O frontend (`lib/navegacao.js`) declara isso explicitamente: *"esta árvore é APRESENTAÇÃO"* |

### O que falta

1. **Adicionar membro a uma empresa existente** (I1). Hoje: `INSERT` manual.
2. **O papel por empresa autorizar algo** (C6). Hoje `admin` global = admin em toda empresa.
3. **Um papel entre `user` e `admin`** (C5/D5).
4. **Unificar ou aposentar o dashboard legado** (I4) — segunda identidade, sem escopo de tenant.

### Arquitetura recomendada

**Ler o papel POR EMPRESA, não o global, nas rotas de empresa.** O papel efetivo passa a ser
`app.usuarios_empresas.role` (já existe, já é escrito), com `superadmin` global mantido como
escada de emergência. Isso resolve C6 sem tabela nova.

**Um `requireCapacidade(...)` ao lado de `requireRole`, não em vez dele.** Capacidade é um
vocabulário fechado em módulo PURO (`src/services/acesso-capacidades.js`), com a matriz
papel×capacidade sendo a regra inteira — mesmo formato de `conversa-modo-ia.js`. `requireRole`
continua existindo para o que é genuinamente hierárquico (`/api/admin`, superadmin).

**`usuarios_empresas.role` ganha `comercial`** (CHECK alargado: `owner|admin|member|comercial`).
**Um** valor novo, não quatro: `owner`/`admin` já cobrem o administrador, `member` já existe. O
qualificador **não precisa de papel próprio na v1** — na prática é o `admin`/`owner`; criar
`qualificador` agora seria criar papel sem ocupante (o pedido pede explicitamente para não criar
role sem necessidade comprovada).

**Adicionar membro:** `POST /api/empresas/:empresaId/membros` (owner/admin da empresa), gravando
`usuarios_empresas` + linha em `app.auditoria_eventos`. Sem tabela nova, sem convite por e-mail
na v1.

---

## 8. Permissões — matriz proposta

Papel = `app.usuarios_empresas.role` na empresa em contexto. `superadmin` global passa em tudo.

| Capacidade | Rota / mount | `owner`/`admin` | `comercial` | `member` | Hoje (`user`) |
| --- | --- | :-: | :-: | :-: | :-: |
| Buscar / importar leads (coleta paga) | `POST /prospeccao/buscar`, `/prospeccao/rotinas` | ✅ | ❌ | ❌ | ❌ |
| **Ver leads brutos** (`pendente`/`legado`) | `GET /prospeccao/prospects`, `GET /banco-leads/leads` | ✅ | ❌ | ❌ | ❌ |
| **Triar (aprovar / descartar)** | `/prospeccao/curadoria/*`, `/prospects/:id/aprovar\|rejeitar` | ✅ | ❌ | ❌ | ❌ |
| Ver leads **aprovados** | `GET /campanhas/:id/fila`, `/follow-ups` | ✅ | ✅ | ❌ | ❌ |
| **Central de Ligações** (ligar, registrar) | `/ligacoes/*` | ✅ | ✅ | ❌ | ❌ |
| Alterar status comercial | `PUT /campanhas/leads/:id` | ✅ | ✅ | ❌ | ❌ |
| Criar / concluir follow-up | `/follow-ups/itens*` | ✅ | ✅ | ❌ | ❌ |
| Disparar WhatsApp em lote | `POST /banco-leads/rodar` | ✅ | ❌¹ | ❌ | ❌ |
| Central de Mensagens (responder) | `/conversas/*` | ✅ | ✅ | ✅ | **✅** |
| Enviar e-mail ao lead | `/captacao/leads/:id/email`, `/follow-ups/.../email` | ✅ | ✅ | ❌ | ❌ |
| Criar / editar campanha e roteiro | `/campanhas`, `/roteiros` | ✅ | ❌ | ❌ | ❌ |
| Ver relatórios da empresa | `/relatorios` | ✅ | parcial² | ❌ | ❌ |
| **Gerenciar membros** | `POST /empresas/:id/membros` | ✅ | ❌ | ❌ | ❌ |
| Integrações / credenciais (Meta, instâncias) | `/integracoes/*`, `/whatsapp` | ✅ | ❌ | ❌ | ❌ |
| Uso e custo de IA | `/llm/uso` | ✅ | ❌ | ❌ | ❌ |

¹ Disparo em lote consome teto diário da empresa e reputação do número — fica com o admin na v1.
² "parcial" = só as próprias ligações/follow-ups. **Não implementar na v1**: exige recorte por
`usuario_id` em `vw_ligacoes_analiticas`, que hoje não filtra por usuário.

**Três leituras dessa tabela:**

1. A coluna "Hoje" mostra o defeito C5 inteiro: a **única** capacidade liberada a não-admin é a
   mais sensível da lista (escrever ao cliente pela Central de Mensagens).
2. `member` fica mais restrito que hoje na prática, porque hoje `user` tem acesso total a
   `/conversas`. **Decisão para o operador** (§14/R11): manter `member` com acesso a Mensagens
   (compatibilidade) ou fechar.
3. Nada nesta matriz é enforçável só escondendo item de menu — cada linha corresponde a um
   mount/rota no backend.

---

## 9. Central de Ligações — mudanças necessárias

### Como a fila é formada hoje (resposta ponto a ponto)

| Pergunta | Resposta |
| --- | --- |
| Qual tabela alimenta | `app.campanha_leads` ⋈ `prospectador.prospects` |
| Qual endpoint | `GET /api/empresas/:id/campanhas/:campanhaId/fila?limit=` |
| Qual service | `db/campanhas.js` `filaDeTrabalho` → `ligacao-prioridade.js` `montarFilaPriorizada` |
| Qual tela | `dashboard/central-ligacoes/page.tsx` (linhas 700-721: 4 GETs em paralelo) |
| Quais queries | 1 `SELECT` com `LIMIT 500` (`TETO_LEITURA_FILA`) + subquery de tentativas |
| Filtros existentes | **backend:** `campanha_id`, `empresa_id`, `cl.status NOT IN ('convertido','descartado')`, telefone discável. **frontend:** filtros client-side (`lib/fila-ligacoes-view.js`), padrão "não iniciados" |
| Como o próximo é escolhido | `montarFilaPriorizada`: filtra por telefone discável, pontua 0-100 (`ligacao-prioridade.js`), ordena por score; SQL é só desempate (`nao_iniciado` → `tentativa_contato` → `nao_atendeu` → `follow_up`, depois `atualizado_em ASC`). `proximoLigavel` (front) **pula** lead ocupado por outra pessoa |
| Lead não marcado aparece? | **Sim.** `p.status` não é lido |
| Lead descartado aparece? | **Sim**, se estiver em `campanha_leads` |
| Controle de já trabalhados | Sim: `cl.status`, contagem de `ligacoes` encerradas (`tentativas`), `CALLLIST_DEDUP_HORAS` na fila de follow-up |
| Tentativas de contato | Sim (subquery `COUNT` de `ligacoes` encerradas) |
| Distribuição entre usuários | **Não.** `responsavel_id` existe e não é filtrado |
| Trava contra dois usuários | Sim no banco (`idx_ligacoes_uma_ativa_por_lead`) — mas `iniciarLigacao` **retoma** a sessão alheia; a proteção real é de interface (modo Acompanhar) |

### Mudanças

1. **Fechar a entrada** (`adicionarLeads`) — a mudança principal, 1 linha de `WHERE`. Sem
   impacto de UI: nenhuma tela chama essa rota (M3).
2. **Segunda barreira na fila** (`filaDeTrabalho`) — `AND p.qualificacao <> 'descartado'`.
   Necessária porque leads já vinculados antes da regra permanecem em `campanha_leads`.
3. **Dizer ao operador**, na tela, quantos leads a campanha tem fora da fila por qualificação —
   uma fila que encolhe sem explicação vira chamado de suporte.
4. **Não** mexer em `iniciarLigacao`, prioridade, roteiro, etapas, sinais, objeções, encerramento
   ou sincronização entre sessões. A qualificação é filtro de **entrada**, não de execução: uma
   ligação em andamento não pode ser interrompida por reclassificação do lead.

---

## 10. Mensagens e WhatsApp — mudanças necessárias

| Caminho | Arquivo | Hoje | Mudança |
| --- | --- | --- | --- |
| **Envio individual/lote (saudação)** | `rodar-leads.js:263` | aceita `aguardando` | motivo `nao_qualificado` em `pulados` (o mecanismo de recusa por lead **já existe**) |
| **Geração Semi** | `rodar-leads.js:666` | idem | idem — impede gastar IA em lead não triado |
| **Automático (worker)** | `banco-leads-auto.js:138` | idem, **sem humano** | `WHERE` do candidato. **A correção mais urgente** |
| **Campanhas (captação social)** | `social-capture.js` + `api-captacao.js` | aprovação p/ WhatsApp já é manual | nenhuma. A coleta social já separa coleta de abordagem |
| **E-mail (1ª abordagem)** | `email-outreach.js:59` | nenhum filtro | recusa `422` com motivo |
| **E-mail (follow-up)** | `followup-email.js` | exige endereço confirmado por pessoa | nenhuma — já é pós-contato |
| **Envio manual do operador** | `conversa-manual.js` | opera sobre `vendas.conversas` | **nenhuma.** Já existe conversa: o contato já aconteceu |
| **Follow-up manual / iniciar conversa** | `followup-manual.js` | cria conversa por número digitado | **nenhuma na v1** (ver R8) |
| **Follow-up automático** | `followup-auto.js` | por conversa existente | nenhuma |
| **Templates / filas de envio** | `prospecting-send-worker.js:212` | `IN ('aguardando','aprovado')` | alinhar ao módulo |
| **Cron / jobs** | `job_queue` (`prospeccao_completo`) | **auto-aprova** (I3) | remover a auto-aprovação de `processarFluxoCompleto` |

**Ponto que o pedido pede para verificar e que precisa ser dito com clareza:** o WhatsApp **é
hoje o pior vazamento**, não a Central de Ligações. A ligação exige um humano clicando; o modo
Automático do Banco de Leads **manda mensagem sozinho para lead que ninguém olhou**, com teto de
40/dia. É o único ponto onde a ausência da porta produz efeito externo sem intervenção humana.

---

## 11. Multiusuário — recomendação

**Recomendação: MODELO HÍBRIDO, e ele já está quase todo construído.**

### Comparação

| Modelo | Adequação aqui |
| --- | --- |
| **Fila compartilhada** | É o que existe. Simples, mas a corrida pelo mesmo lead termina com uma pessoa **recebendo a sessão da outra** (`iniciarLigacao` retoma). Já foi identificado como problema real em produção (entrada de 2026-08-17 do log) |
| **Atribuição individual** | `campanha_leads.responsavel_id` existe, é validado, tem índice — mas exige **decidir e operar a distribuição** de 60 leads entre 3 pessoas. Trabalho de gestão que não existe hoje e que o pedido não pede para a v1 |
| **Híbrido** | Fila compartilhada + trava ao começar a trabalhar. **É exatamente o que o banco já garante** (`idx_ligacoes_uma_ativa_por_lead`, migration `048`) e o que a tela já mostra (modo Acompanhar somente leitura, `sou_eu` calculado no servidor, `proximoLigavel` pulando ocupado) |

### Justificativa técnica

1. **Custo marginal quase zero.** A trava, a detecção em lote (`GET /ligacoes/ativas`) e a
   sincronização entre sessões foram entregues em 2026-08-14/17. Falta **uma** correção: quando
   `iniciarLigacao` retoma sessão alheia, devolver somente leitura em vez de entregar a operação
   — e `POST /iniciar` **já devolve `sou_eu`** para isso.
2. **Atribuição individual sem necessidade comprovada seria campo morto** — é o que o próprio
   pedido pede para evitar. `responsavel_id` continua disponível para quando a operação pedir.
3. **`app.follow_ups` já é por responsável** (`responsavel_id` + índice
   `(empresa_id, responsavel_id, status)`): "minha fila" é um `WHERE`, não um modelo novo.
4. **Rastreabilidade já existe:** `ligacoes.usuario_id`, `sessao_origem`/`sessao_dispositivo`
   (migration `068`) e `app.auditoria_eventos` nas 4 transições.

### O que fica fora da v1 (declarado)

Distribuição automática, round-robin, transferência de ligação, metas por vendedor, e o filtro
de relatórios por usuário. **Assumir e transferir ligação** já estão declarados fora de escopo
no AGENTS.md e continuam.

---

## 12. Plano de implementação (fases)

| Fase | Objetivo | Entrega | Toca produção? |
| --- | --- | --- | --- |
| **0** (feito) | Diagnóstico | este documento | não |
| **1** | Formalizar a qualificação | migration aditiva (`qualificacao`, `qualificado_em`, `qualificado_por`, índice parcial) + `services/lead-qualificacao.js` PURO + testes + `domain-enums` com anti-drift. **Ninguém consome ainda** | schema sim, comportamento **não** |
| **2** | Coletores passam a marcar `pendente` | `salvarProspect`, `salvarProspectSocial` informam a coluna. Recoleta **nunca** rebaixa (o upsert do Places já não toca `status`; replicar para `qualificacao`) | leads novos nascem `pendente` |
| **3** | **Fechar as 4 portas** | `adicionarLeads`, `filaDeTrabalho`, `rodar-leads`, `banco-leads-auto`, `email-outreach`. Remover a auto-aprovação de `processarFluxoCompleto` (I3) | **sim — a regra entra em vigor** |
| **4** | Telas honestas | Banco de Leads e Aquisição mostram o estado de qualificação (selo `legado`); Central de Ligações explica quantos leads ficaram fora; "Marcar" vira "Aprovar" e a UI para de dizer "opcional" | sim (apresentação) |
| **5** | Triagem retroativa | ferramenta para reduzir o acervo `legado` (a curadoria existente já serve; falta o recorte) | não (uso humano) |
| **6** | Papel por empresa | `requireEmpresaAccess` publica o papel efetivo; `requireCapacidade` + matriz PURA; valor `comercial`. **Sem mudar nenhum comportamento**: a matriz reproduz o gating atual | não (comportamento idêntico) |
| **7** | Abrir o papel comercial | trocar os mounts de `requireRole('admin')` por capacidade nas rotas da matriz §8 + `POST /empresas/:id/membros` + `navegacao.js` por capacidade | sim |
| **8** | Híbrido completo | `iniciarLigacao` que retoma sessão alheia devolve somente leitura; "minha fila" em Follow-ups por `responsavel_id` | sim |
| **9** | Auditoria e métricas | padronizar `/aprovar`+`/rejeitar` em `app.auditoria_eventos`; taxa de aprovação por mercado/usuário | não |

**Fase 3 é o marco irreversível.** Só deve rodar depois da Fase 2 estar em produção há tempo
suficiente para que os leads novos já nasçam `pendente` — senão a coleta continua produzindo
leads que a porta recusa sem que ninguém os tenha triado.

---

## 13. Arquivos que precisariam ser alterados

### Fases 1-3 (a regra)

| Arquivo | Motivo | Alteração | Risco |
| --- | --- | --- | --- |
| `backend/sql/migrations/069_lead_qualificacao.sql` *(novo)* | eixo de qualificação | 3 colunas + índice parcial, aditiva, **sem mutar dado** | **baixo.** Aplica no boot (`db/migrations.js`); rollback = ignorar as colunas |
| `backend/src/services/lead-qualificacao.js` *(novo)* | dono do vocabulário e do julgamento | módulo PURO | baixo (sem I/O) |
| `backend/src/domain-enums.js` | anti-drift | reexporta o enum do service (**não copia**) | baixo |
| `backend/src/db/campanhas.js` | **C1/C2** | `WHERE` em `adicionarLeads` (L177) e `filaDeTrabalho` (L233) | **médio.** A fila pode encolher. Mitigação: `legado` é aceito |
| `backend/src/services/rodar-leads.js` | **C3** | novo motivo em `pulados` (L263, L666) | baixo (o mecanismo existe) |
| `backend/src/services/banco-leads-auto.js` | **C3 automático** | `WHERE` do candidato (L138) | **médio.** Pode zerar o volume diário se o acervo não estiver marcado `legado` |
| `backend/src/services/email-outreach.js` | **I5** | recusa `422` | baixo |
| `backend/src/services/prospecting-send-worker.js` | coerência (L212) | alinhar | baixo (pipeline legado) |
| `backend/src/prospecting.js` | **I3**; coletor (L1100); `normalizarStatusProspect` (L105) | remover auto-aprovação; informar `qualificacao`; opcionalmente corrigir o normalizador | **médio-alto.** 4.5k linhas, com rotas e workers no import |
| `backend/src/services/social-capture.js` | coletor social (L300-350) | informar `qualificacao`; preservar terminal na recoleta | médio (SQL grande) |
| `backend/test/lead-qualificacao.test.js` *(novo)* | regra + guardas de regressão lendo o fonte | — | — |
| `backend/test/campanhas.test.js`, `rodar-leads*.test.js` | cobrir a porta | — | — |
| `AGENTS.md` + `.env.example` | governança | seção própria. **Nenhuma env nova prevista** | — |

### Fase 4 (telas)

`frontend/lib/lead-qualificacao.js` (+ `.d.ts`/`.test.js`) traduzindo o veredito — padrão de
`lib/site-rotulos.js`, **sem regra no front**; `app/dashboard/banco-leads/page.tsx`;
`app/dashboard/prospeccao/page.tsx` (rótulo e texto de C4);
`app/dashboard/central-ligacoes/page.tsx` (explicação da fila);
`components/AssistenteOportunidades.tsx`; `components/LeadDetalhesModal.tsx`.

### Fases 6-7 (acesso)

| Arquivo | Alteração | Risco |
| --- | --- | --- |
| `backend/sql/migrations/070_papel_comercial.sql` *(novo)* | alarga `app_usuarios_empresas_role_chk` com `comercial` | baixo (só alarga) |
| `backend/src/services/acesso-capacidades.js` *(novo)* | matriz papel×capacidade, PURO | baixo |
| `backend/src/middleware/tenant.js` | `requireEmpresaAccess` publica `req.papelEmpresa`; novo `requireCapacidade` | **alto.** É o middleware de toda a API. Mitigação: Fase 6 reproduz o gating atual, sem mudar comportamento |
| `backend/index.js` | mounts das 6 rotas | **alto.** Errar aqui abre ou fecha módulo inteiro |
| `backend/src/routes/api-empresas.js` | `POST /:empresaId/membros` | médio |
| `frontend/lib/navegacao.js` | `minRole` → capacidade | baixo (apresentação) |
| `frontend/lib/session*` / `AuthGuard.tsx` | expor papel por empresa | baixo |

### Deliberadamente NÃO alterados

`db/ligacoes.js` (execução da ligação), `ligacao-prioridade.js`, `followup-auto.js`,
`followup-listing.js`, `agenda.js`, `conversa-manual.js`, `whatsapp.js` /
`instancia-envio.js`, `meta-*`, todos os `prompts/*.md`, `public/dashboard/*`.

---

## 14. Riscos

| # | Risco | Gravidade | Mitigação |
| --- | --- | --- | --- |
| R1 | **Operação para no dia do deploy** — acervo sem qualificação recusado pelas 4 portas | **alta** | `DEFAULT 'legado'` (D4) + `legado` aceito nas portas. **Fase 3 não pode ir sem isso** |
| R2 | Modo Automático do Banco de Leads zera o volume diário | média | `legado` aceito; medir antes com script somente-leitura (padrão `medir:isolamento-empresa`) |
| R3 | **Leads antigos sem status de qualificação** | alta (é R1) | `legado` é um estado nomeado, com selo na tela e caminho de redução (Fase 5) |
| R4 | Duplicidade de conceito: `status` e `qualificacao` conviverem e divergirem | média | `qualificacao` tem **dono único** (módulo PURO) e comparação com literal proibida fora dele, com guarda de regressão |
| R5 | **APIs sem filtro** — `GET /prospeccao/prospects` devolve tudo | alta | é o motivo de D3. A Fase 7 fecha a rota por capacidade; a Fase 3 fecha as portas de **ação** |
| R6 | **Permissão só no frontend** | alta | `lib/navegacao.js` já declara que é apresentação; toda linha da matriz §8 tem mount/rota correspondente |
| R7 | Conflito entre vendedores | média | trava do banco já existe; Fase 8 corrige a retomada de sessão alheia |
| R8 | **Rota que escapa da porta:** `POST /follow-ups/manual/iniciar` cria conversa por número digitado, sem passar por prospect | média | **declarado, não fechado na v1.** É ação humana explícita, com `agente_pausado=true` e auditoria. Fechá-la exigiria decidir se digitar um número é abordagem nova — decisão de produto (§15/D4) |
| R9 | **Lead descartado volta por nova coleta** | média | **Places já está protegido**: o `ON CONFLICT` de `salvarProspect` **não** atualiza `status` (L1115-1136). **Social também**: o `CASE` de `social-capture.js:335` preserva terminais. **Brechas reais:** (a) mesmo negócio com `place_id` novo; (b) mesmo negócio coletado por **outra origem** (Instagram gera `external_ref` diferente) → linha nova, `pendente`. Fechar exigiria identidade canônica por telefone/domínio — é a `PENDENCIA_ARQUITETURAL` e está **fora desta v1** |
| R10 | Queries antigas ignorando a regra | média | 4 portas fechadas no **backend**, não na tela; 2 barreiras na Central de Ligações; guardas de regressão lendo o fonte |
| R11 | **Fechar `/conversas` para `member` quebra quem usa hoje** | média | decisão do operador (§15/D5); default recomendado = manter |
| R12 | `requireEmpresaAccess`/`index.js` são caminho crítico de toda a API | alta | Fase 6 **não muda comportamento** (a matriz reproduz o gating atual); só a Fase 7 abre |
| R13 | Performance | **baixa** | índice parcial `(empresa_id, qualificacao) WHERE qualificacao='aprovado'`; as portas acrescentam 1 predicado a queries já filtradas por `empresa_id` |
| R14 | **Perda de histórico** | **nenhuma** | tudo aditivo; `status`, `curadoria_decisoes`, `decision_log`, `prospect_events`, `ligacoes`, `campanha_leads` intocados |
| R15 | Dashboard legado continua aprovando lead de qualquer tenant (I4) | média | **não resolvido nesta v1.** Aposentar `/dashboard/prospeccao/*` é fase própria |
| R16 | `prospects.empresa_id` com `DEFAULT` PJ (I6) | baixa | não é criado por esta mudança; registrar como dívida |

---

## 15. Critérios de aceite

| # | Critério do pedido | Como fica verificável |
| --- | --- | --- |
| 1 | Busca de 200 leads roda normalmente | rotina/busca avulsa inalteradas; teto de 200 por coleta continua |
| 2 | Os 200 podem ficar como leads brutos | nascem `qualificacao='pendente'`, visíveis na Aquisição e no Banco de Leads |
| 3 | **Nenhum lead bruto entra na Central de Ligações automaticamente** | `adicionarLeads` recusa `pendente`/`descartado`; `filaDeTrabalho` tem 2ª barreira; teste cobre as duas |
| 4 | Podem ser analisados individualmente | Assistente de Oportunidades (já existe) + ações da linha |
| 5 | É possível aprovar/marcar | rotas existentes, agora com efeito real e auditadas |
| 6 | Aprovado fica elegível | as 4 portas aceitam `aprovado` |
| 7 | Não aprovado não aparece para vendedor | `comercial` não alcança `/prospeccao`, `/banco-leads`; a fila que ele vê já é filtrada |
| 8 | Descartado não aparece para vendedor | idem + `descartado` recusado nas 4 portas |
| 9 | **Comercial não obtém lead bruto pela API** | `GET /prospeccao/prospects` e `/banco-leads/leads` exigem capacidade `ver_leads_brutos`; teste com token `comercial` esperando **403** |
| 10 | Qualificação independente do status comercial | colunas distintas em tabelas distintas; `enviado` **não** apaga `aprovado` |
| 11 | Identificar quem trabalha um lead | `ligacoes.usuario_id` + `GET /ligacoes/ativas` com `sou_eu` (já existe); `responsavel_id` disponível |
| 12 | Compatível com o que existe | migrations aditivas; `npm test` verde; nenhum enum/CHECK existente estreitado |

**Aceite adicional que este diagnóstico acrescenta** (defeitos medidos, não pedidos):

| # | Critério |
| --- | --- |
| 13 | O **modo Automático** do Banco de Leads não dispara para lead `pendente` |
| 14 | `processarFluxoCompleto` **não aprova** lead sozinho |
| 15 | A Aquisição deixa de dizer que marcar é "opcional" (C4) |
| 16 | Toda aprovação/descarte grava **quem e quando**, pelos dois caminhos (I8) |
| 17 | A Central de Ligações **explica** quantos leads da campanha ficaram fora da fila |

---

## Decisões que dependem do operador (não decididas aqui)

| # | Decisão | Recomendação |
| --- | --- | --- |
| **D1** | O acervo existente entra como `legado` (opera, sem prova) ou como `pendente` (para até ser triado)? | **`legado`.** `pendente` para a operação no boot |
| **D2** | `legado` tem prazo de validade? | **Não na v1.** Prazo sem ferramenta de redução vira parada programada |
| **D3** | Lead `descartado` já vinculado a campanha: sai da fila ou fica com selo? | **Sai da fila, permanece em Acompanhamento** (não se apaga histórico) |
| **D4** | `POST /follow-ups/manual/iniciar` (número digitado à mão) passa pela porta? | **Não na v1** (R8) — é ato humano explícito e auditado |
| **D5** | `member` mantém acesso total à Central de Mensagens? | **Sim** (compatibilidade). Fechar é mudança de comportamento para quem já usa |
| **D6** | Criar papel `qualificador` agora? | **Não.** Papel sem ocupante; `owner`/`admin` cobrem |
| **D7** | Aposentar o dashboard legado `/dashboard/prospeccao/*`? | **Fase própria.** Enquanto existir, I4/R15 continuam |
| **D8** | Medir produção antes da Fase 3? | **Sim.** Script somente-leitura (`BEGIN TRANSACTION READ ONLY` + `ROLLBACK`, sem PII), no padrão de `medir:isolamento-empresa`, para saber quantos leads por status/qualificação existem antes de a regra valer |

---

## Validação desta fase

Nada a validar: **nenhum arquivo de código foi alterado**. Quando a Fase 1 começar:
`npm test` (de dentro de `backend/`) e `npm run typecheck` se tocar `.ts`. Não existem
`npm run lint` nem `npm run build` neste repositório.

## Pendência do repositório encontrada durante a análise

`docs/ai-decision-log.md` (linhas 1888-2506) e `docs/ai-task-start-log.md` (linhas 3166-3406,
antes desta entrada) estão com **conflito de merge não resolvido** (`git stash pop`
interrompido). **Não foram resolvidos** — resolver o log de decisões é escolha do operador.
