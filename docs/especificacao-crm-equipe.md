# Especificação — CRM de atendimento em EQUIPE

> **Status: ESPECIFICAÇÃO. Nada foi implementado.** Nenhum arquivo de `backend/` ou `frontend/`
> foi tocado. Data: 2026-09-11. Fase 0 em [ai-task-start-log.md](ai-task-start-log.md).
>
> **Documento irmão, pré-requisito:**
> [analise-qualificacao-lead-e-multiusuario.md](analise-qualificacao-lead-e-multiusuario.md) —
> a porta de qualificação do lead. As decisões D1..D8 de lá continuam abertas e são
> referenciadas aqui.
>
> **Pendência arquitetural que este documento finalmente endereça:**
> [PENDENCIA_ARQUITETURAL_CENTRAL_LIGACOES_E_MENSAGENS.md](PENDENCIA_ARQUITETURAL_CENTRAL_LIGACOES_E_MENSAGENS.md)
> — "identidade canônica", "estratégia multi-tenant" e "contrato Ligações ↔ Mensagens".

---

## Sumário executivo — as sete conclusões que mudam o plano

1. **Multi-tenant já existe e o modelo está certo.** *Shared database / shared schema* com
   `empresa_id`. **Não transformar em nada**: completar a cobertura. O schema `app.*` está 100%
   escopado; o `prospectador.*` está escopado; o legado `vendas.*` tem `empresa_id` em **5 de 28
   tabelas**.
2. **O contexto da empresa NÃO está preso à primeira instância.** `app.empresa_contextos` já é
   entidade da **empresa** (`empresa_id NOT NULL`), já é compartilhável entre instâncias e já tem
   fluxo de transferência. O que falta é um **padrão da empresa aplicado na criação da
   instância** — e **não** um fallback em tempo de resposta, que violaria uma regra deliberada
   do projeto (§2.5). Isto reduz drasticamente o escopo que você imaginava.
3. **Ownership está metade construído, e a metade que falta é sempre a mesma.**
   `app.ligacoes.usuario_id`, `app.campanha_leads.responsavel_id`, `app.follow_ups.responsavel_id`
   e `prospectador.lead_disparos.usuario_id` **já existem** — e **nenhuma listagem filtra por
   eles**. Já há até índice pronto (`follow_ups (empresa_id, responsavel_id, status)`).
4. **Conversa é o único módulo sem nenhum ownership** — e tem a pegadinha:
   `vendas.conversas.operador_assumiu_em` registra **quando** alguém assumiu e **nunca quem**.
   Aqui é campo novo de verdade.
5. **Agenda está partida em duas tabelas com modelos opostos**: `vendas.agenda_eventos` tem
   `usuario_id NOT NULL`, `lead_id`, `conversa_id`, `marcado_por` — mas **é do usuário LEGADO
   (`vendas.dashboard_users`) e não tem `empresa_id`**. `app.agenda_eventos` tem `empresa_id` mas
   só `criado_por` e o lead por **telefone em TEXT**. A agenda que tem dono não tem tenant; a que
   tem tenant não tem dono.
6. **O gating atual está invertido** (achado C5 do documento irmão): as 6 telas da operação são
   `requireRole('admin')`; um `user` toma **403** em ligações, leads e follow-ups — e ao mesmo
   tempo **pode** escrever ao cliente pela Central de Mensagens. Criar o papel comercial não é
   "abrir acesso": é **corrigir uma inversão**.
7. **`app.usuarios_empresas.role` existe, é escrito, e nunca autorizou nada.** `requireRole` lê a
   role **global** de `app.usuarios`. Logo: admin de uma empresa é admin em **toda** empresa a que
   pertença. É a fundação a consertar antes de qualquer papel novo.

---

# 1. Como o sistema funciona hoje

## 1.1 Arquitetura

```
Railway (Root = backend/)                      Vercel (Root = frontend/)
┌────────────────────────────────────┐        ┌──────────────────────────┐
│ index.js  — Express, mounts, boot  │        │ Next.js App Router       │
│  ├ /api/*        JWT Bearer  ──────┼────────┤ lib/api.ts (Bearer)      │
│  ├ /dashboard/*  cookie+CSRF ──────┼──┐     │ AuthGuard + useSession   │
│  ├ /webhook      Evolution          │  │     │ lib/navegacao.js (menu)  │
│  └ /freelandoo/* HMAC               │  │     └──────────────────────────┘
│                                     │  └──▶ backend/public/dashboard (estático, legado)
│ src/routes/api-*.js  (HTTP)         │
│ src/agent*.js, core-funnel.js       │  regra de negócio / orquestração
│ src/services/*.js                   │  regras PURAS + motores
│ src/db.js, src/db/*.js              │  acesso a dados
│ src/ai-provider.js, whatsapp.js     │  integrações
└────────────────────────────────────┘
        │
        ▼  PostgreSQL — 3 schemas
   app.*          camada SaaS multiempresa (aditiva, migrations 001-068)
   prospectador.* prospecção / leads
   vendas.*       agente single-tenant original (legado, ainda em produção)
```

**Workers em processo** (não há fila externa): `banco-leads-auto.js`, `lead-lock.js`, capture
worker, `executarRotinasAquisicao`, `processarBuscasPlacesPendentes`, `followup-auto.js`,
`meta-dispatch.js`, `sincronizarAtribuicaoMetaAds`, refresh diário de playbooks Freelandoo.

## 1.2 Autenticação — **duas, independentes**

| | SaaS (atual) | Dashboard legado |
| --- | --- | --- |
| Tabela de usuários | `app.usuarios` | `vendas.dashboard_users` |
| Credencial | scrypt (`src/auth.js`) | scrypt |
| Sessão | JWT HS256 stateless (`JWT_SECRET`, `JWT_EXPIRES_IN`) | linha em `vendas.dashboard_sessions` + cookie + CSRF |
| Middleware | `src/middleware/tenant.js` | `src/dashboardAuth.js` |
| Escopo de empresa | `requireEmpresaAccess` por rota | **nenhum** |
| Papéis | global `superadmin \| admin \| user`; por empresa `owner \| admin \| member` | só `admin` faz login |

Ponto positivo a preservar: `requireAuth` **relê o usuário do banco** a cada request
([tenant.js:22](../backend/src/middleware/tenant.js#L22)) — mudança de papel e desativação
valem imediatamente, sem esperar o JWT expirar.

**Não existe Supabase neste projeto.** É `pg` (Pool) direto. Portanto **não há RLS e não há
policies**: zero `CREATE POLICY` / `ENABLE ROW LEVEL SECURITY` no repositório. O isolamento é
100% aplicacional, reforçado no SQL de cada módulo de dados. A pergunta do briefing sobre
`service role × RLS` não se aplica.

## 1.3 Cobertura de `empresa_id` hoje

| Schema | Situação |
| --- | --- |
| `app.*` | **completo.** Toda tabela tem `empresa_id NOT NULL` (exceto `usuarios`, `schema_migrations` e `webhook_quarentena`, por desenho) |
| `prospectador.*` | **completo**, mas `prospects.empresa_id` tem **`DEFAULT` = PJ** (migration `005`) |
| `vendas.*` | **5 de 28**: `conversas`, `lead_profiles`, `followup_envios`, `analises_pos_conversa`, `ai_logs` — e **todas com `DEFAULT` = PJ** (migration `006`). Acrescentadas depois com `empresa_id` próprio: `followup_ligacoes` (030), `analises_pos_conversa` |

**Sem `empresa_id` e relevantes para equipe:** `vendas.agenda_eventos`, `vendas.eventos_comerciais`,
`vendas.followup_auto_agendamentos`, `vendas.lead_contextos`, `vendas.job_queue`,
`vendas.ai_settings`, `vendas.aprendizado`, `vendas.prompt_overlays`, `vendas.whatsapp_connections`,
`vendas.agenda_lembretes`.

## 1.4 Entidades principais e onde está (ou não) o dono

| Entidade | Tabela | `empresa_id` | Dono / responsável |
| --- | --- | :-: | --- |
| Empresa | `app.empresas` | — | `criada_por` |
| Vínculo usuário↔empresa | `app.usuarios_empresas` | ✅ | `role`, `ativo` — **nunca lido por autorização** |
| Contexto comercial | `app.empresa_contextos` (+ `_versoes`) | ✅ | — (é da empresa) |
| Instância WhatsApp | `app.empresa_whatsapp_instances` | ✅ | **nenhum `usuario_id`**; `contexto_id`, `origem_vinculo` |
| Conexão QR legada | `vendas.whatsapp_connections` | ❌ | **`user_id` (legado)** |
| Lead | `prospectador.prospects` | ✅ (`DEFAULT` PJ) | **nenhum** |
| Oportunidade | `app.campanha_leads` | ✅ | **`responsavel_id` ✅ (não filtrado)** |
| Ligação (campanha) | `app.ligacoes` | ✅ | **`usuario_id` ✅ (não filtrado)** |
| Ligação (follow-up) | `vendas.followup_ligacoes` | ✅ | `usuario_id` ✅ |
| Conversa | `vendas.conversas` | ✅ (`DEFAULT` PJ) | **NENHUM** — só `operador_assumiu_em` (quando, sem quem) |
| Follow-up | `app.follow_ups` | ✅ | **`responsavel_id` ✅ + `criado_por` ✅ (não filtrado)** |
| Agenda (painel) | `app.agenda_eventos` | ✅ | só `criado_por` |
| Agenda (bot) | `vendas.agenda_eventos` | ❌ | `usuario_id` **NOT NULL** (legado) + `marcado_por` + `lead_id` + `conversa_id` |
| Disparo de saudação | `prospectador.lead_disparos` | ✅ | **`usuario_id` ✅** |
| Roteiro | `app.roteiros` / `_versoes` / `_etapas` | ✅ | — |
| Campanha | `app.campanhas` | ✅ | `criado_por` + `campanha_responsaveis` (N:N) |
| Auditoria | `app.auditoria_eventos` | ✅ | `usuario_id`, `contexto` JSONB livre |
| Curadoria | `prospectador.curadoria_sessoes` / `_decisoes` | ✅ | `usuario_id` ✅ |

## 1.5 Módulos e gating atual

| Tela | Rota montada em `index.js` | Gate |
| --- | --- | --- |
| Visão Geral, Perfil | — | `requireAuth` |
| **Central de Mensagens** | `/api/empresas/:id/conversas` | `requireAuth` + `requireEmpresaAccess` |
| Agenda | `/api/empresas/:id/agenda` | idem |
| Instâncias (Configurações) | `/api/empresas/:id/whatsapp`, `/contextos` | idem |
| Aquisição | `/prospeccao`, `/prospeccao/rotinas`, `/captacao` | **`requireRole('admin')`** |
| Banco de Leads | `/banco-leads` | **admin** |
| Central de Ligações | `/campanhas`, `/ligacoes` | **admin** |
| Follow-ups | `/follow-ups` | **admin** |
| Roteiros | `/roteiros`, `/nichos` | **admin** |
| Relatórios, Uso, Modelo e IA, Prompts, Integrações, Playbook | ... | **admin** |
| Contas | `/api/admin/usuarios` | **`requireRole('superadmin')`** |

## 1.6 Integrações

| Integração | Onde | Escopo |
| --- | --- | --- |
| Evolution API (WhatsApp) | `src/whatsapp.js` + `services/instancia-envio.js` | **por instância provada** — regra sem fallback, já madura |
| Webhook Evolution | `src/webhook-handler.js` + `middleware/tenant.js` | empresa resolvida pela instância; sem dono ⇒ **quarentena** |
| Anthropic / OpenAI | `src/ai-provider.js` | `empresa_id` nos logs de uso |
| Bright Data | `services/places-brightdata.js`, `brightdata-client.js` | por empresa, coleta paga com trava única |
| Meta Conversions | `services/meta-*.js` | credencial **por empresa**, cifrada |
| Freelandoo | `src/freelandoo/*` | instância por token |
| E-mail | `services/email-outreach.js`, `followup-email.js` | provider global, 3 envs |

## 1.7 Limitações encontradas (o que precisa mudar)

| # | Limitação | Evidência |
| --- | --- | --- |
| **L1** | Papel por empresa não autoriza nada; papel global vaza entre empresas | [tenant.js:113-124](../backend/src/middleware/tenant.js#L113-L124) |
| **L2** | Operação inteira é admin-only; `user` não tem papel útil | [index.js:98-111](../backend/index.js#L98-L111) |
| **L3** | Não há como adicionar membro a uma empresa existente pelo produto | `createUsuarioPorAdmin` não cria vínculo ([usuarios.js:98](../backend/src/db/usuarios.js#L98)) |
| **L4** | Conversa sem dono; `operador_assumiu_em` sem "quem" | [init.sql:19-26](../backend/sql/init.sql#L19-L26) |
| **L5** | Ownership existente em 4 tabelas nunca filtra listagem | `followup-listing.js`, `db/campanhas.js`, `db/ligacoes.js` |
| **L6** | Duas agendas com modelos incompatíveis | migration `011` vs [init.sql:565-595](../backend/sql/init.sql#L565-L595) |
| **L7** | Duas identidades de usuário; a legada sem escopo de tenant | `app.usuarios` vs `vendas.dashboard_users` |
| **L8** | Vínculo usuário↔instância só existe no schema legado, sem `empresa_id` | `vendas.whatsapp_connections` |
| **L9** | Sem feature flag por usuário; nem mecanismo genérico | só configs específicas por empresa |
| **L10** | Lead sem dono e sem porta de qualificação | documento irmão, C1-C3 |
| **L11** | Não existe abordagem manual: todo caminho de WhatsApp é envio pela Evolution | nenhum `wa.me` no CRM |
| **L12** | `lead_disparos.status` só descreve **geração de IA e entrega técnica** (7 valores) | [rodar-leads.js](../backend/src/services/rodar-leads.js) |
| **L13** | `DEFAULT` = PJ em `prospects.empresa_id` e nas 5 tabelas `vendas.*` | migrations `005`/`006` |
| **L14** | Dois registros de ligação (`app.ligacoes` e `vendas.followup_ligacoes`) | migrations `040` / `030` |

---

# 2. Como a nova versão deverá funcionar

## 2.1 Empresa como tenant — decisão

**Manter *shared database / shared schema* com `empresa_id`. Não migrar para schema/database por
tenant.**

| Modelo | Custo aqui | Veredito |
| --- | --- | --- |
| **Shared schema + `empresa_id`** (atual) | já implementado em `app.*` e `prospectador.*`; falta completar `vendas.*` | ✅ **escolhido** |
| Schema por tenant | reescrever resolução de conexão em ~70 módulos de dados, `search_path` por request, migrations × N tenants, e **quebra** `vendas.conversas.numero UNIQUE GLOBAL` | ❌ |
| Database por tenant | idem + pool por tenant + custo Railway por instância | ❌ |

**Justificativa não-óbvia:** o projeto já paga o preço mais difícil do shared schema e já
aprendeu as lições — a remoção do fallback da PJ no webhook (migration `060`), a regra de
instância de envio sem fallback (Fase 2) e a quarentena são exatamente a disciplina que esse
modelo exige. Trocar de modelo agora jogaria fora esse aprendizado.

**Regra de ouro nova:** *toda tabela alcançável por uma rota HTTP autenticada precisa de
`empresa_id` e precisa ser filtrada por ele no SQL.* Tabelas internas do motor do bot
(`vendas.job_queue`, `watcher_locks`, `webhook_messages_processed`) ficam fora — não são
alcançáveis por usuário e escopá-las seria trabalho sem ganho.

## 2.2 Papéis e permissões — decisão

**RBAC leve: papel POR EMPRESA + matriz papel×capacidade PURA + concessões pontuais por usuário
(somente aditivas).** Sem tabela `permissions`/`user_permissions` na v1.

### O papel efetivo passa a ser `app.usuarios_empresas.role`

`requireEmpresaAccess` já consulta o vínculo; passa a **publicar** `req.papelEmpresa`. Corrige
L1 **sem tabela nova**. `app.usuarios.role` continua existindo com um único propósito:
`superadmin` = operador da plataforma (escada de emergência, acesso a todas as empresas).

### Papéis propostos (CHECK alargado, **um** valor novo)

| Valor | Existe hoje? | Quem é |
| --- | :-: | --- |
| `owner` | ✅ | dono da empresa (você, na PJ Codeworks) |
| `admin` | ✅ | administrador da empresa; igual a `owner` menos excluir a empresa/trocar dono |
| **`comercial`** | ❌ **novo** | vendedor / SDR / atendente |
| `member` | ✅ | acesso mínimo (compatibilidade com o que existe hoje) |

**Por que só um valor novo, contra a lista de 7 do briefing:** `manager`, `sdr`, `closer`,
`attendant` e `viewer` não têm ocupante hoje — a operação é **uma pessoa**. Papel sem ocupante é
matriz de permissão que ninguém valida e que apodrece na primeira divergência. `super_admin` e
`company_admin` **já existem** (`superadmin` global e `owner`/`admin` por empresa). Quando houver
um gerente de verdade, `manager` é um valor no CHECK e uma coluna na matriz — não uma refatoração.

### Capacidades (o que de fato é verificado)

Módulo **PURO** `src/services/acesso-capacidades.js`, no padrão consagrado de
`conversa-modo-ia.js` / `instancia-envio.js` / `site-classificacao.js`: sem banco, sem HTTP, sem
IA; dono do vocabulário; anti-drift em `domain-enums.js`; comparação com literal **proibida**
fora do módulo, com guarda de regressão lendo `src/**`.

Ele **não** responde "qual o papel?", e sim **"esta capacidade está liberada para este vínculo?"**.
A primeira pergunta admite heurística; foi heurística que produziu os defeitos de fallback já
corrigidos neste repositório.

### Feature flags — três níveis, e cada um no lugar certo

| Nível | Onde | Exemplo | Já existe? |
| --- | --- | --- | --- |
| **Empresa — configuração de operação** | tabelas de config específicas (`app.banco_leads_config`, `app.followup_config`, `app.prospeccao_configuracoes`) | modo Manual/Semi/Auto, teto diário, janela | ✅ |
| **Instância — comportamento do atendimento** | `app.empresa_whatsapp_instances.config_json` (`usa_agenda`, `saudacao`, `canal`) + `ativo` | esta instância usa agenda? | ✅ |
| **Usuário — concessão pontual** | **`app.usuarios_empresas.permissoes JSONB`** (novo) | "este vendedor pode ligar a IA na instância dele" | ❌ novo |

**Por que JSONB e não tabela `user_permissions`:** a concessão é rara, esparsa e por vínculo. Uma
tabela produziria 0-2 linhas por usuário e um `JOIN` extra em **todo** request autenticado, para
guardar o que já cabe na linha do vínculo que o middleware **já** carrega. O projeto já usa JSONB
extensível para exatamente isso (`config_json`, `metadata`, `contexto` da auditoria).

**Regra dura: concessão por usuário é SOMENTE ADITIVA.** Nunca nega o que o papel permite. Sem
isso, nasce o estado "papel diz sim, override diz não", que é onde toda matriz de permissão
apodrece, e a resposta a "por que ele não consegue?" deixa de ser derivável. Negar = trocar o
papel.

### A capacidade sensível do briefing: IA responder automaticamente

Ela **já existe no produto**, com a granularidade certa, e por acidente felizes:

- `vendas.conversas.modo_ia` (`conversa | analise`, migration `063`): em `analise` a IA analisa
  e **não envia** resposta conversacional. Gate nos dois enviadores, com módulo PURO dono da
  matriz `modo × capacidade`.
- `app.empresa_whatsapp_instances.ativo`: a instância atende ou não.
- `vendas.conversas.agente_pausado`: pausa operacional.

**Portanto a permissão nova NÃO é "a IA pode responder"** — é **"este usuário pode LIGAR a IA"**,
isto é, quem tem o direito de mudar `modo_ia` para `conversa` e de ativar a instância. A
capacidade é `gerenciar_ia_instancia`, bloqueada por padrão para `comercial`. Nenhum motor de IA
é alterado.

## 2.3 Instâncias de WhatsApp

**Modelo: a instância é da EMPRESA; o usuário pode ser o RESPONSÁVEL por uma.** Compartilhada e
exclusiva passam a ser o mesmo modelo, com `usuario_id` nulo ou preenchido.

| Coluna nova em `app.empresa_whatsapp_instances` | Papel |
| --- | --- |
| `usuario_id UUID NULL` | responsável. **NULL = instância da empresa (compartilhada)**, o comportamento de hoje |
| `criado_por UUID NULL` | quem criou (complementa `origem_vinculo_usuario_id`, que só existe no fluxo autorizado) |

**O que NÃO muda, de propósito:** a resolução de **envio** (`services/instancia-envio.js`) e a de
**webhook** continuam olhando **empresa + instância provada**, nunca o usuário. Usar o usuário
para escolher por onde enviar seria "escolher número por quem mandou o comando" — o defeito que a
Fase 2 removeu e que o AGENTS.md proíbe nominalmente.

`vendas.whatsapp_connections` (L8) é o vínculo usuário↔instância do **mundo legado**, sem
`empresa_id`. Ele **não é a base**: é o que a coluna nova substitui. Enquanto as rotas
`/dashboard/whatsapp/*` existirem, as duas convivem — e a tabela legada continua sendo a fonte do
banner "WhatsApp desconectado" (regra documentada no AGENTS.md).

## 2.4 Ownership por módulo — o desenho alvo

| Módulo | Dono | Visibilidade do `comercial` | Visibilidade do `admin` |
| --- | --- | --- | --- |
| Lead | `prospects.responsavel_id` (novo) | **os seus** + fila de livres aprovados | todos |
| Oportunidade | `campanha_leads.responsavel_id` (existe) | as suas | todas |
| Conversa | `conversas.responsavel_id` (novo) | as suas + não atribuídas | todas |
| Ligação | `ligacoes.usuario_id` (existe) | as suas | todas |
| Follow-up | `follow_ups.responsavel_id` (existe) | **todos da empresa** (pedido explícito), com responsável visível | todos |
| Agenda | `agenda_eventos.responsavel_id` (novo) + `criado_por` (existe) | a sua + consolidada em leitura | consolidada, filtrável |
| Roteiro | — | **somente leitura** | CRUD |
| Aquisição | — | **sem acesso** | total |

**Follow-ups é a exceção deliberada** e vem do seu pedido: visibilidade geral, responsável sempre
explícito. Coerente com a tela atual, que é uma **fila única de trabalho** — recortá-la por
usuário recriaria a fragmentação que a unificação das abas removeu.

## 2.5 Contexto da empresa × instância — o achado que reduz o escopo

Sua premissa era que o contexto está preso à primeira instância. **Não está.**

- `app.empresa_contextos` tem `empresa_id NOT NULL` — **já é entidade da empresa**.
- A instância **aponta** para um contexto (`contexto_id`, migration `003`).
- Contextos **já são compartilháveis** entre instâncias: a rota de exclusão distingue "contexto
  exclusivo" de "compartilhado" ([api-whatsapp.js:272](../backend/src/routes/api-whatsapp.js#L272))
  e há **fluxo de transferência** de contexto entre instâncias
  ([api-whatsapp.js:350-425](../backend/src/routes/api-whatsapp.js#L350-L425)).

O que existe é uma **regra deliberada**, escrita no próprio código
([contexto-empresa.js:548-551](../backend/src/services/contexto-empresa.js#L548-L551)):

> *"Atendimento é 100% por instância (regra do projeto): instância informada mas SEM contexto
> linkado NÃO responde — nunca cai em contexto da empresa 'fora da instância'."*

**Isso não é um defeito e não deve ser revertido.** É a mesma família de disciplina da quarentena
de webhook e da instância de envio: não se inventa qual conhecimento responde em nome de quem. Um
fallback "usa o contexto ativo da empresa" faria a instância nova de um vendedor responder com o
conhecimento de **outro** atendimento da mesma empresa, sem ninguém ter decidido isso.

### Recomendação

**Padrão da empresa aplicado na CRIAÇÃO, nunca resolvido na RESPOSTA.**

| Mudança | Onde |
| --- | --- |
| `app.empresas.contexto_padrao_id UUID NULL` (FK `empresa_contextos`) | migration aditiva |
| Ao criar instância, `contexto_id` recebe o padrão da empresa — **explicitamente gravado**, visível e editável | `api-whatsapp.js`, `api-freelandoo.js`, `freelandoo-provision.js` |
| `buscarContexto2Ativo` **não é alterada**. Guarda de regressão falha se um fallback por empresa aparecer no caminho do atendimento | `test/` |

Assim "novo usuário/instância trabalha com o contexto da empresa" passa a valer, e continua
sendo verdade que toda instância responde por um contexto que alguém escolheu.

**Nada precisa "migrar de instância para empresa".** O que migra é uma decisão: qual dos
contextos existentes é o padrão. Uma linha de `UPDATE`, tomada por você.

---

# 3. Matriz de permissões

Papel = `app.usuarios_empresas.role`. `superadmin` global passa em tudo. ➕ = liberável por
concessão aditiva em `usuarios_empresas.permissoes`.

| Módulo / capacidade | Admin (`owner`/`admin`) | Usuário (`comercial`) | Observações |
| --- | :-: | :-: | --- |
| **Aquisição** — buscar, importar, rotinas, coleta paga | ✅ | ❌ | Custo financeiro real (Bright Data). Pedido explícito do briefing |
| **Aquisição** — triar (aprovar/descartar) | ✅ | ❌ | Porta de qualificação (doc irmão). ➕ para um qualificador dedicado |
| **Banco de Leads** — ver leads brutos (`pendente`/`legado`) | ✅ | ❌ | Enforçado no backend; sem isso um `curl` devolve a base inteira |
| **Banco de Leads** — ver leads **aprovados** | ✅ todos | ✅ seus + livres | Fila de livres = aprovados sem responsável |
| **Banco de Leads** — assumir lead livre | ✅ | ✅ | `UPDATE ... WHERE responsavel_id IS NULL` (claim atômico) |
| **Banco de Leads** — abrir WhatsApp (`wa.me`) e marcar abordagem | ✅ | ✅ | §5.4. Não envia nada pelo servidor |
| **Banco de Leads** — disparo em lote pela Evolution | ✅ | ❌ ➕ | Consome teto diário e reputação do número |
| **Banco de Leads** — transferir lead de outro vendedor | ✅ | ❌ | Devolver o próprio para a fila: ✅ |
| **Central de Mensagens** — ver conversas | ✅ todas | ✅ suas + não atribuídas | Hoje `user` vê **todas**: mudança de comportamento (§6/E9) |
| **Central de Mensagens** — responder, assumir | ✅ | ✅ | Assumir é claim atômico |
| **Central de Mensagens** — ligar/desligar IA (`modo_ia`), pausar agente | ✅ | ❌ ➕ | A capacidade sensível do briefing |
| **Central de Mensagens** — apagar histórico | ✅ | ❌ | Destrutivo e irreversível |
| **Central de Ligações** — fila e ligar | ✅ | ✅ | Fila = leads aprovados da campanha |
| **Central de Ligações** — ver ligações de outros | ✅ | ❌ | Modo Acompanhar somente leitura continua (é coordenação ao vivo, não histórico) |
| **Central de Ligações** — criar/editar campanha, adicionar leads | ✅ | ❌ | |
| **Follow-ups** — ver a fila da empresa | ✅ | ✅ | Visibilidade geral (pedido explícito) |
| **Follow-ups** — criar, concluir, reagendar os seus | ✅ | ✅ | |
| **Follow-ups** — reatribuir a outro | ✅ | ❌ | |
| **Follow-ups** — pausar follow-up automático da empresa | ✅ | ❌ | É configuração da empresa |
| **Roteiros** | ✅ CRUD | ✅ **somente leitura** | Leitura necessária para conduzir a ligação |
| **Agenda** — criar/editar os seus eventos | ✅ | ✅ | |
| **Agenda** — consolidada da equipe, filtro por vendedor | ✅ | leitura ➕ | Default: o comercial vê a própria; conflito de horário é motivo legítimo para ➕ |
| **Instâncias** — conectar/gerenciar a própria | ✅ | ✅ | `usuario_id` = ele |
| **Instâncias** — ver/gerenciar as da empresa, transferir contexto | ✅ | ❌ | |
| **Instâncias** — editar contexto/playbook | ✅ | ❌ ➕ | Conhecimento é ativo da empresa |
| **Contas da empresa** — criar/desativar membro, papel, concessões | ✅ | ❌ | `owner` não pode ser desativado pelo próprio `admin` |
| **Integrações** (Meta, e-mail), **Modelo e IA**, **Prompts**, **Uso e custos** | ✅ | ❌ | Credenciais de terceiros e custo |
| **Relatórios** da empresa | ✅ | ❌ | "Meus números" é fase posterior (exige recorte por `usuario_id` em `vw_ligacoes_analiticas`) |
| **Plataforma** (`/api/admin/usuarios`, quarentena global) | ❌ | ❌ | `superadmin` apenas |

---

# 4. Novo modelo de dados

## 4.1 Reaproveitado sem alteração

`app.empresas`, `app.usuarios`, `app.empresa_contextos` (+ `_versoes`), `app.campanhas`,
`app.campanha_responsaveis`, `app.roteiros` (+ `_versoes`/`_etapas`), `app.ligacao_*`,
`app.auditoria_eventos`, `app.contato_canal_disponibilidade`, `app.follow_up_emails`,
`app.meta_integracoes`, `app.conversao_*`, `prospectador.curadoria_*`,
`prospectador.aquisicao_rotinas`, `prospectador.busca_snapshots`, `vendas.followup_ligacoes`.

## 4.2 Campos novos (todos aditivos, nullable ou com default compatível)

| Tabela | Campo | Tipo | Objetivo | Equivalente hoje? |
| --- | --- | --- | --- | --- |
| `app.usuarios_empresas` | `permissoes` | `JSONB NOT NULL DEFAULT '{}'` | concessões **aditivas** por usuário | não |
| `app.usuarios_empresas` | `criado_por` | `UUID NULL` | quem convidou | não |
| `app.usuarios_empresas` | `ultimo_acesso_em` | `TIMESTAMPTZ NULL` | "last_access" do briefing | `usuarios.ultimo_login_em` (global, não por empresa) |
| `app.usuarios_empresas` | CHECK `role` | +`comercial` | papel comercial | alarga, não estreita |
| `app.empresas` | `contexto_padrao_id` | `UUID NULL` FK | contexto da empresa aplicado na criação (§2.5) | não |
| `app.empresa_whatsapp_instances` | `usuario_id` | `UUID NULL` | responsável. **NULL = compartilhada** | `vendas.whatsapp_connections.user_id` (legado, sem tenant) |
| `app.empresa_whatsapp_instances` | `criado_por` | `UUID NULL` | autoria | `origem_vinculo_usuario_id` (só fluxo autorizado) |
| `prospectador.prospects` | `qualificacao` | `TEXT NOT NULL DEFAULT 'legado'` CHECK | **porta** (doc irmão §6) | `status`, mas é sobrescrito por `enviado` |
| `prospectador.prospects` | `qualificado_em` / `qualificado_por` | `TIMESTAMPTZ` / `UUID` | quem triou | `curadoria_decisoes` (só um dos caminhos) |
| `prospectador.prospects` | `responsavel_id` | `UUID NULL` | dono do lead. **NULL = fila de livres** | não |
| `prospectador.prospects` | `responsavel_desde` | `TIMESTAMPTZ NULL` | desde quando | não |
| `vendas.conversas` | `responsavel_id` | `UUID NULL` | dono da conversa | **não** — só `operador_assumiu_em` |
| `app.agenda_eventos` | `responsavel_id` | `UUID NULL` | de quem é a reunião | só `criado_por` |
| `app.agenda_eventos` | `prospect_id` | `UUID NULL` FK | vínculo firme com o lead | só `lead_telefone` TEXT |
| `prospectador.lead_disparos` | `canal` | `TEXT NOT NULL DEFAULT 'evolution'` CHECK `evolution\|manual_wa_me` | distinguir envio pelo servidor de abordagem manual | não |
| `prospectador.lead_disparos` | `evolution_instance` | **relaxar `NOT NULL`** | abordagem manual não tem instância | bloqueio real hoje |
| `prospectador.lead_disparos` | `confirmado_por` | `TEXT NULL` CHECK `provider\|operador` | **fato comprovado × fato declarado** (§5.4) | `pendente_confirmacao`→`enviado` é o precedente |

## 4.3 Tabelas novas — **duas, e só duas**

### `app.lead_responsavel_historico`
```
id, empresa_id, prospect_id, responsavel_anterior_id, responsavel_novo_id,
motivo TEXT, usuario_id (quem transferiu), ocorrido_em
```
**Por quê:** `responsavel_id` guarda o estado atual; "manter histórico de responsáveis" e
"investigar conflito" precisam da **sequência**. `app.auditoria_eventos` registraria o evento,
mas ela é declaradamente *"não deve ser fonte de dashboards"* (migration `047`), e "quantos leads
o vendedor X já teve" é métrica de gestão. Mesmo raciocínio que separou
`vendas.lead_profiles_empresa_backfill` da auditoria.

### `app.conversa_responsavel_historico`
Mesma forma, para conversa. Mesma justificativa (transferência de atendimento é o evento mais
sensível da operação em equipe).

### Explicitamente NÃO criadas (contra a lista do briefing)

| Sugerido | Por que não | O que usar |
| --- | --- | --- |
| `companies`, `users`, `company_members` | já existem | `app.empresas`, `app.usuarios`, `app.usuarios_empresas` |
| `roles`, `permissions`, `user_permissions` | 4 papéis e ~25 capacidades caberiam em 3 tabelas que ninguém edita em runtime; a matriz muda **com deploy**, não com dado | matriz no módulo PURO + `permissoes JSONB` |
| `company_settings` | existiria só para agregar o que já está em tabelas de config específicas, com CHECKs próprios | as tabelas de config + `empresas.contexto_padrao_id` |
| `lead_assignments` | tabela N:N para uma relação **1:1** ("um lead tem um responsável", §6/E1) | `prospects.responsavel_id` + histórico |
| `conversation_assignments` | idem | `conversas.responsavel_id` + histórico |
| `lead_activities`, `audit_logs` | `app.auditoria_eventos` é genérica, append-only, indexada, e já recebe as escritas de 8 módulos; `prospects.decision_log` e `prospectador.prospect_events` também existem | reusar |
| `calls` | `app.ligacoes` (+ 4 tabelas de detalhe) | reusar |
| `messages` | histórico é `vendas.conversas.historico` JSONB. Normalizar é projeto próprio, alto risco, ganho zero para equipe | reusar |
| `calendar_events` | `app.agenda_eventos` | reusar + 2 campos |
| `scripts`, `acquisition_lists` | `app.roteiros*`, `prospectador.aquisicao_rotinas` | reusar |

## 4.4 Backfill de `empresa_id` nas tabelas `vendas.*` — escopo mínimo

Só as alcançáveis por rota autenticada e relevantes para equipe:

| Tabela | Por quê | Fonte do valor |
| --- | --- | --- |
| `vendas.agenda_eventos` | é a agenda do **bot**, lida pela Agenda e pelos Follow-ups | `conversa_id` → `conversas.empresa_id`; senão `lead_id` → `lead_profiles.empresa_id` |
| `vendas.eventos_comerciais` | alimenta call score e relatórios | conversa pelo número |
| `vendas.followup_auto_agendamentos` | alimenta a fila de Follow-ups | conversa pelo número |
| `vendas.lead_contextos` | contexto por lead | conversa pelo número |
| `vendas.agenda_lembretes` | lembretes enviados | evento pai |

**Sem dono resolvível: fica NULL e não é lido.** Inventar dono é exatamente o defeito que as
migrations `058`/`060` removeram deste repositório.

`vendas.job_queue`, `watcher_locks`, `webhook_messages_processed`, `ai_settings`, `aprendizado`,
`prompt_overlays`, `funil_prompt_versions`: **fora de escopo** — motor do bot, não alcançáveis
por usuário.

## 4.5 Relações (alvo)

```
app.empresas ──1:N── app.usuarios_empresas ──N:1── app.usuarios
     │                    (role, permissoes, ativo)
     ├─1:N─ app.empresa_contextos ◀── contexto_padrao_id (1:1 opcional)
     │            ▲ contexto_id
     ├─1:N─ app.empresa_whatsapp_instances ──usuario_id──▶ app.usuarios
     │
     ├─1:N─ prospectador.prospects ──responsavel_id──▶ app.usuarios
     │            │  ├─ qualificacao (porta)
     │            │  └─1:N─ app.lead_responsavel_historico
     │            ├─1:N─ app.campanha_leads ──responsavel_id──▶ usuarios
     │            │            └─1:N─ app.ligacoes ──usuario_id──▶ usuarios
     │            ├─1:N─ prospectador.lead_disparos (canal, confirmado_por)
     │            └─ (telefone) ─── vendas.conversas ──responsavel_id──▶ usuarios
     │                                   └─1:N─ app.conversa_responsavel_historico
     ├─1:N─ app.follow_ups ──responsavel_id / criado_por──▶ usuarios
     ├─1:N─ app.agenda_eventos ──responsavel_id / criado_por──▶ usuarios, prospect_id──▶ prospects
     └─1:N─ app.auditoria_eventos ──usuario_id──▶ usuarios
```

**Identidade do contato permanece `(empresa_id, telefone_digitos)`**, como as migrations `062` e
`066` já estabeleceram. **Não criar FK para `vendas.conversas`**: aquele `numero` é `UNIQUE
GLOBAL` e não prova empresa. Esta é a "identidade canônica" que a
`PENDENCIA_ARQUITETURAL` pedia — ela **já foi decidida**, em duas migrations; o que falta é
aplicá-la ao lead e à conversa.

---

# 5. Fluxos principais

## 5.1 Admin cria usuário
```
Configurações › Contas da empresa › "Adicionar pessoa"
  POST /api/empresas/:empresaId/membros  { nome, email, senha_inicial, role, permissoes? }
    requireAuth + requireEmpresaAccess + requireCapacidade('gerenciar_membros')
    TRANSAÇÃO:
      1. app.usuarios: INSERT ou reuso se o e-mail já existe (a pessoa pode servir 2 empresas)
      2. app.usuarios_empresas: INSERT (role, permissoes, criado_por, ativo=true)
      3. app.auditoria_eventos: acao='membro_adicionado'  (sem senha, sem hash)
  → login normal; requireEmpresaAccess resolve papel = 'comercial'
```
`app.usuarios.role` do novo membro = **`user`** (nunca `admin`): o papel global só existe para
`superadmin`. Se o e-mail já existe, **nunca** se altera senha nem papel global do usuário
existente — só se acrescenta o vínculo.

## 5.2 Usuário conecta o WhatsApp dele
```
Configurações › Instâncias › "Conectar meu número"
  POST /api/empresas/:id/whatsapp   (capacidade: gerenciar_instancia_propria)
    cria no Evolution (nome técnico gerado pelo produto)
    TRANSAÇÃO: INSERT instância { empresa_id, usuario_id = req.usuario.id,
                                  contexto_id = empresas.contexto_padrao_id,
                                  origem_vinculo='atendimento_views' }
    → 409 INSTANCIA_JA_EXISTE_NO_EVOLUTION se o nome já existir lá (regra intocada)
    → compensação: falha na transação ⇒ apaga a instância no Evolution
  QR code → conectado → atendimento MANUAL disponível
  modo_ia das conversas nasce 'conversa' (default da migration 063) MAS...
```
**Ponto de atenção declarado:** hoje `modo_ia` nasce `conversa` (a IA responde). Para que "IA não
liberada automaticamente" seja verdade para instância criada por `comercial`, a instância precisa
nascer com um sinal que faça as conversas dela nascerem em `analise`. Recomendação:
`config_json.modo_ia_padrao = 'analise'` quando `origem_vinculo_usuario_id` for um `comercial` sem
a capacidade `gerenciar_ia_instancia`, lido no ponto onde a conversa nasce. **Isto toca o caminho
do webhook** — é a única mudança desta especificação que mexe no motor de atendimento, e por isso
fica isolada numa fase própria (Fase 9), com a alternativa conservadora de a instância nascer
`ativo=false` até o admin liberar.

## 5.3 Lead é atribuído
```
A) Admin distribui:  PUT /banco-leads/leads/:id/responsavel { usuario_id }
B) Vendedor assume:  POST /banco-leads/leads/:id/assumir
     UPDATE prospects SET responsavel_id=$user, responsavel_desde=NOW()
      WHERE id=$1 AND empresa_id=$2 AND responsavel_id IS NULL
        AND qualificacao IN ('aprovado','legado')
     RETURNING id
     → 0 linhas = alguém assumiu primeiro → 409 "Este lead já tem responsável: <nome>"
C) Automático: NÃO na v1 (§6/E2)
Nos três: lead_responsavel_historico + auditoria_eventos
```
O claim atômico é o **mesmo padrão** que a curadoria já usa (`WHERE status='aguardando'`
devolvendo linha ou não) — consistência de projeto, não invenção.

## 5.4 Vendedor aborda o lead manualmente (`wa.me`) — e o problema da prova

```
Banco de Leads › lead com telefone › "Abrir WhatsApp"
  1. GET /banco-leads/leads/:id/abordagem-manual   (read-only, NÃO envia, NÃO chama IA)
       → { wa_me_url, mensagem_sugerida, ja_abordado_em, responsavel }
  2. front abre window.open(wa_me_url)  ← o SISTEMA NÃO ENVIA NADA
  3. POST /banco-leads/leads/:id/abordagem-manual/aberta   (registro do CLIQUE)
       lead_disparos { canal='manual_wa_me', status='aberto', confirmado_por=NULL,
                       usuario_id, evolution_instance=NULL }
  4. o vendedor volta e clica "Marcar como enviado"
       PATCH .../abordagem-manual  { enviado: true }
       → status='enviado', confirmado_por='operador', confirmado_em=NOW()
```

**A regra de negócio central desta seção: abrir `wa.me` não prova envio.** O registro do passo 3
é do **clique**, não da mensagem. Só o passo 4 afirma envio, e ele carrega
`confirmado_por='operador'` — *declarado por uma pessoa*, distinto de
`confirmado_por='provider'`, que é o que a Evolution confirma via `DELIVERY_ACK | READ | PLAYED`
(`aguardarStatusEnvioEvolution`, hoje).

**Este vocabulário já existe no projeto e será reusado, não inventado:**

| Precedente | O que separa |
| --- | --- |
| `lead_disparos`: `pendente_confirmacao` → `enviado` | entrega **confirmada pelo provider** |
| `empresa_whatsapp_instances.origem_vinculo` (`atendimento_views` \| `legado`) | prova × **ausência de prova, nomeada** |
| `contato_canal_disponibilidade.origem = 'operador'` (NOT NULL, **sem DEFAULT**, CHECK de um valor) | **fato declarado por humano**, impossível de um job gravar |
| `prospects.qualificacao = 'legado'` (doc irmão) | mesma ideia |

**`confirmado_por` segue o padrão da migration `066`: `CHECK (confirmado_por IN ('provider',
'operador'))` e, na v1, um job nunca grava `'operador'`** — guarda de regressão lendo `src/**`.

**Consequências declaradas:**
- Métricas de abordagem manual são **autodeclaradas**. Toda tela que as exibir precisa dizê-lo
  ("marcado pelo vendedor", não "entregue"). Misturar as duas num único número de "mensagens
  enviadas" seria criar um indicador que não se sustenta.
- Não há como saber se o cliente respondeu por essa via **até** ele escrever — e, quando escreve,
  a conversa entra pelo webhook da instância, que pode ser **outra** instância (ou nenhuma, se o
  vendedor usou o WhatsApp pessoal). **Risco aceito e declarado** (§6/E12).

## 5.5 Vendedor registra a abordagem (status do lead)

**Máquina de estados proposta — 6 valores, não os 14 do briefing.**

O briefing lista 14 candidatos. Adotá-los criaria um **terceiro** eixo de status, competindo com
`prospects.status` (9 valores) e `campanha_leads.status` (12 valores, `OPORTUNIDADE_STATUS`, com
anti-drift). Três máquinas de estado sobre o mesmo lead é o caminho garantido para divergência.

**Recomendação: não criar eixo novo. Distribuir os 14 nomes nos eixos que já existem.**

| Nome do briefing | Onde já vive |
| --- | --- |
| aguardando abordagem | `qualificacao='aprovado'` + sem `lead_disparos` |
| mensagem preparada | `lead_disparos.status='aguardando_disparo'` (Semi) ✅ |
| **mensagem enviada manualmente** | `lead_disparos { canal='manual_wa_me', status='enviado', confirmado_por='operador' }` — **é o único gap real** |
| contato realizado / aguardando resposta / respondeu / sem resposta | `prospects.status` (`enviado`/`respondeu`) + `campanha_leads.status` (`tentativa_contato`, `nao_atendeu`, `contato_realizado`) |
| follow-up necessário / agendado | `app.follow_ups` (é a entidade, não um status) ✅ |
| reunião marcada | `campanha_leads.status='reuniao_marcada'` + `app.agenda_eventos` ✅ |
| qualificado / desqualificado | `campanha_leads.status` (`qualificado`) e `qualificacao='descartado'` ✅ |
| convertido / perdido | `campanha_leads.status` (`convertido`/`descartado`) + `prospects.status='fechado'` ✅ |

O trabalho de verdade é de **apresentação**: uma função PURA
`frontend/lib/lead-situacao.js` que **traduz** os três eixos numa frase só para o vendedor —
exatamente o padrão de `lib/site-rotulos.js` e `lib/pontuacao-indicador.js`, onde a regra está no
backend e o front só traduz o veredito.

## 5.6 Follow-up e reunião
```
Follow-up:  POST /follow-ups/itens { canal, agendado_para, responsavel_id? }
  responsavel_id default = req.usuario.id (não o admin que olhava a tela)
  índice único parcial follow_ups_um_aberto_por_canal_uk já impede duplicidade por canal ✅

Reunião:  POST /agenda/eventos { data, prospect_id?, responsavel_id? }
  responsavel_id default = req.usuario.id; criado_por = req.usuario.id
  REUNIAO_BUFFER_MIN (30 min) hoje é por EMPRESA → precisa ser por RESPONSÁVEL (§6/E7)
```

## 5.7 Transferência
```
Lead:     PUT /banco-leads/leads/:id/responsavel { usuario_id, motivo }
            capacidade: transferir_lead (admin) — ou devolver o PRÓPRIO para a fila (comercial)
            → lead_responsavel_historico + auditoria
Conversa: PUT /conversas/:numero/responsavel { usuario_id, motivo }
            → conversa_responsavel_historico + auditoria
            NÃO mexe em modo_ia nem em agente_pausado (decisões independentes)
Ligação:  NÃO transfere — fora de escopo, como o AGENTS.md já declara
```

---

# 6. Casos extremos e problemas futuros

| # | Caso | Decisão proposta |
| --- | --- | --- |
| **E1** | Lead com mais de um responsável? | **Não.** 1:1. "Dois trabalhando o mesmo lead" é o problema a evitar, não um recurso. Por isso `responsavel_id` na linha, não tabela N:N |
| **E2** | Distribuição automática (round-robin)? | **Não na v1.** A operação tem uma pessoa; regra de distribuição sem equipe é código morto nascendo pronto |
| **E3** | Dois vendedores assumem o mesmo lead no mesmo segundo | `UPDATE ... WHERE responsavel_id IS NULL RETURNING` — 0 linhas ⇒ 409 com o nome de quem ganhou. Mesmo padrão da curadoria |
| **E4** | Dois assumem a mesma conversa | Idem, com `responsavel_id IS NULL`. **Diferença importante:** ninguém é impedido de **responder** — impedir isso no meio de um atendimento causaria dano maior que a duplicidade |
| **E5** | Dois na mesma ligação | **Já resolvido no banco** (`idx_ligacoes_uma_ativa_por_lead`, migration `048`). Falta a correção conhecida: quando `iniciarLigacao` retoma sessão alheia, devolver **somente leitura** — e `POST /iniciar` **já devolve `sou_eu`** |
| **E6** | Follow-up duplicado | **Já resolvido**: índice único parcial por `(empresa, telefone, canal)` entre os `aguardando` |
| **E7** | Reunião duplicada / choque de horário | **Gap real.** `REUNIAO_BUFFER_MIN` valida a agenda **da empresa**. Com 3 vendedores, um bloquearia os outros. Precisa passar a validar por `responsavel_id`. Duas reuniões do mesmo lead com vendedores diferentes: avisar, não bloquear |
| **E8** | Mesma pessoa abordada por dois canais (WhatsApp e ligação) | Legítimo e desejável. `follow_ups` é por canal de propósito |
| **E9** | `member` perde acesso total à Central de Mensagens | Mudança de comportamento. **Recomendação: `member` mantém o acesso atual**; só `comercial` é restrito. Decisão do operador (§D5 do doc irmão) |
| **E10** | Alterações simultâneas de status | Último a escrever vence, como hoje. Aceitável: status é conclusão de um humano, não contador. Mitigação que basta: a auditoria mostra a sequência |
| **E11** | Lead duplicado (mesmo negócio, `place_id` novo, ou coletado por outra origem) | **Não resolvido nesta v1** (= R9 do doc irmão). Exige identidade canônica por telefone/domínio. Consequência: pode haver 2 leads do mesmo negócio com responsáveis diferentes |
| **E12** | Cliente responde a uma abordagem `wa.me` feita do celular pessoal | A conversa **não entra** no sistema (não há instância). Risco declarado e aceito: é o preço da abordagem manual. Mitigação: a UI recomendar abrir pelo número conectado |
| **E13** | Instância desconectada | Já tratado: `verificarStatusInstanciaEvolution`, banner pelo vínculo do usuário, `409 INSTANCE_UNAVAILABLE` nas 3 rotas de envio humano. Com `usuario_id`, o banner passa a falar do número **dele** |
| **E14** | Dados órfãos: lead cujo responsável foi desativado | `responsavel_id` **não** é apagado (histórico). A **fila** passa a tratar "responsável inativo" como trabalho a redistribuir, com aviso ao admin |
| **E15** | Usuário desativado (§6.1) | abaixo |
| **E16** | Falha de autorização por ID manipulado | Toda rota continua `requireEmpresaAccess` + `empresa_id` no SQL; ownership conferido **no `WHERE`**, nunca só na leitura. Teste de permissão obrigatório por rota nova |
| **E17** | Papel mudado durante a sessão | **Já funciona**: `requireAuth` relê o usuário; `requireEmpresaAccess` relerá o vínculo. Sem JWT com permissão embutida — de propósito |
| **E18** | Conversa que chega sem vendedor definido | `responsavel_id IS NULL` = **fila de não atribuídas**, visível a todo `comercial`. Não se atribui por adivinhação. Quem responde primeiro assume (E4) |
| **E19** | Webhook de instância sem dono provado | **Intocado.** Quarentena (migration `060`) continua barrando o fluxo inteiro. Nada nesta especificação afrouxa isso |
| **E20** | `superadmin` operando dentro de uma empresa | Passa em tudo, mas **é gravado na auditoria como si mesmo**. Nunca herda `responsavel_id` automático |

## 6.1 Desativação de usuário — política

**Princípio: desativar é revogar ACESSO, nunca apagar HISTÓRICO.** `app.usuarios_empresas.ativo =
false` (o campo já existe).

| O que | O que acontece |
| --- | --- |
| Login | `requireAuth` já barra `usuarios.ativo=false`; `requireEmpresaAccess` passa a barrar vínculo inativo |
| **Leads atribuídos** | `responsavel_id` **permanece**. Aparecem ao admin como "responsável inativo"; redistribuição é **ação explícita**, em lote se quiser. Liberar sozinho para a fila faria 40 leads virarem "livres" sem ninguém saber |
| **Conversas** | idem. Vão para a fila de não atribuídas **apenas** por ação do admin |
| **Follow-ups futuros** | permanecem, com o dono inativo visível. Filtro "responsável inativo" no painel |
| **Reuniões futuras** | **permanecem e continuam na agenda** — o cliente foi avisado de um horário. Admin reatribui ou cancela; o sistema não cancela nada sozinho |
| **Instância WhatsApp** | **não desconecta automaticamente.** `usuario_id` permanece; a instância continua sendo da **empresa**. Desligá-la sozinha derrubaria um número em operação. Aviso ao admin + ação explícita |
| **Ligações, disparos, auditoria, curadoria** | imutáveis. `usuario_id` histórico preservado |
| Reativar | volta o acesso; nada mais muda (nada foi perdido) |

---

# 7. Estratégia de migração

## 7.1 Ponto de partida real

A empresa inicial **já existe**: PJ Codeworks, `00000000-0000-0000-0000-000000000001`, seed no
boot. Você **já é** o admin. **Não há "criar company para dados existentes"** — essa etapa está
feita desde a migration `001`. O que existe é dado legado apontando para a PJ por `DEFAULT`.

## 7.2 As migrations previstas (todas aditivas)

| # | Conteúdo | Muta dado? |
| --- | --- | --- |
| `069` | `prospects.qualificacao` + `qualificado_em/por` + índice parcial | não (`DEFAULT 'legado'`) |
| `070` | `usuarios_empresas`: CHECK +`comercial`, `permissoes`, `criado_por`, `ultimo_acesso_em` | não |
| `071` | `empresas.contexto_padrao_id` | não |
| `072` | `prospects.responsavel_id` + `responsavel_desde` + `app.lead_responsavel_historico` | não |
| `073` | `conversas.responsavel_id` + `app.conversa_responsavel_historico` | não |
| `074` | `agenda_eventos.responsavel_id` + `prospect_id` | não |
| `075` | `lead_disparos.canal` + `confirmado_por` + `confirmado_em`; **relaxa `evolution_instance NOT NULL`** | não (DEFAULT `'evolution'` preserva o passado) |
| `076` | `empresa_whatsapp_instances.usuario_id` + `criado_por` | não |
| `077` | `empresa_id` nas 5 tabelas `vendas.*` do §4.4 — **coluna + índice apenas** | não |

## 7.3 Backfills — scripts separados, nunca dentro de migration

Padrão já estabelecido por `backfill:lead-profiles-empresa`: **simula por padrão**, `-- --aplicar`
grava, idempotente, keyset, **um COMMIT por lote**, relatório sem PII, SQL de rollback impresso.

| Script | O que faz | Sem dono resolvível |
| --- | --- | --- |
| `backfill:vendas-empresa` | preenche `empresa_id` nas 5 tabelas do §4.4 | **deixa NULL** |
| `backfill:conversa-responsavel` | **nada automático.** `operador_assumiu_em` registra quando, não quem — não há de onde inferir. Só gera **relatório** de conversas com handoff sem dono, para você atribuir | — |
| `backfill:lead-responsavel` | **nada automático.** Todo lead nasce sem responsável = fila de livres, que é o estado correto na estreia | — |

**A ausência de backfill automático de ownership é a decisão, não uma limitação.** Inventar dono
retroativo é o defeito que as migrations `058` e `060` removeram deste repositório.

## 7.4 `DEFAULT` = PJ: remover ou manter?

`prospects.empresa_id` e as 5 `vendas.*` têm `DEFAULT` = PJ (L13). É o mesmo padrão que a
migration `058` tratou como defeito em `lead_profiles`. **Recomendação: remover os `DEFAULT`s na
Fase 12 (polimento), não agora** — removê-los antes de auditar cada `INSERT` transformaria um risco
latente em falha imediata de boot. Registrar como dívida declarada.

## 7.5 Sem downtime

Toda migration é aditiva e aplicada no boot (`src/db/migrations.js`). Código antigo ignora coluna
nova; coluna nova é nullable ou tem DEFAULT compatível. Não há `ALTER` bloqueante, não há `NOT
NULL` retroativo, não há `DROP`. A única fase com risco de comportamento é a que **aplica** as
regras (Fases 4 e 6), e ela vem depois dos dados estarem no lugar.

---

# 8. Plano de implementação

Formato pedido no briefing. **Regra transversal:** nenhuma fase mistura refatoração com feature
(proibição do AGENTS.md), e cada fase termina com `npm test` verde.

### Fase 1 — Fundação: papel por empresa (sem mudar comportamento)
- **Objetivo:** corrigir L1. Papel efetivo = vínculo, não global.
- **Backend:** `requireEmpresaAccess` publica `req.papelEmpresa` e `req.permissoesEmpresa`, e
  passa a **barrar vínculo inativo**. Novo `services/acesso-capacidades.js` (PURO) com a matriz
  **reproduzindo exatamente o gating de hoje**. `requireCapacidade` criado e **ainda não usado**.
- **Banco:** `070`.
- **Frontend:** nenhum.
- **Riscos:** `requireEmpresaAccess` é caminho crítico de toda a API. Mitigação: a matriz
  reproduz o gating atual — comportamento idêntico, verificável.
- **Testes:** toda rota responde igual a antes para `admin`, `user` e `superadmin`; vínculo
  inativo ⇒ 403; anti-drift da matriz.
- **Dependências:** nenhuma.

### Fase 2 — Contas da empresa
- **Objetivo:** L3. Adicionar/gerenciar membros.
- **Backend:** `POST/GET/PATCH /api/empresas/:id/membros` (capacidade `gerenciar_membros`);
  auditoria em toda escrita; e-mail já existente ⇒ só acrescenta vínculo.
- **Banco:** nenhuma (usa `070`).
- **Frontend:** Configurações › **Contas da empresa** (nova). `/dashboard/contas` continua
  existindo como tela de **plataforma** (`superadmin`) — são coisas diferentes.
- **Riscos:** criação de usuário por não-superadmin. Mitigação: papel global sempre `user`;
  `owner` não desativável por `admin`; sem auto-desativação.
- **Testes:** admin de A não adiciona membro em B; e-mail duplicado; auditoria sem senha/hash.
- **Dependências:** Fase 1.

### Fase 3 — Qualificação do lead (a porta)
- **Objetivo:** L10. Doc irmão, Fases 1-3.
- **Backend:** `services/lead-qualificacao.js` (PURO); coletores gravam `'pendente'`; as 4 portas
  passam a exigir aprovação; **remover a auto-aprovação** de `processarFluxoCompleto`.
- **Banco:** `069`.
- **Frontend:** selo de qualificação; "Marcar" → "Aprovar"; remover o texto "opcional".
- **Riscos:** **o maior de todos.** Sem `DEFAULT 'legado'`, para a operação no deploy. Medir
  produção antes (script somente-leitura).
- **Testes:** lead `pendente`/`descartado` recusado nas 4 portas; `legado` passa; guardas de
  regressão.
- **Dependências:** decisão D1 do doc irmão.

### Fase 4 — Ownership de lead
- **Objetivo:** dono explícito + fila de livres.
- **Backend:** `responsavel_id` no `montarFiltrosProspects`; `POST /leads/:id/assumir` (claim
  atômico); `PUT /leads/:id/responsavel`; histórico + auditoria.
- **Banco:** `072`.
- **Frontend:** coluna "Responsável", filtro "Meus leads / Livres / Todos", botão "Assumir".
- **Riscos:** listagem do Banco de Leads é caminho quente. Mitigação: 1 predicado sobre query já
  filtrada por `empresa_id`; índice `(empresa_id, responsavel_id)`.
- **Testes:** claim concorrente ⇒ 1 vence, outro 409; comercial não vê lead de outro; admin vê
  tudo.
- **Dependências:** Fases 1, 3.

### Fase 5 — Banco de Leads multiusuário + abordagem manual `wa.me`
- **Objetivo:** L11, L12. O item mais visível para o vendedor.
- **Backend:** `GET .../abordagem-manual` (read-only, sem IA, sem envio);
  `POST .../abordagem-manual/aberta`; `PATCH .../abordagem-manual { enviado }`. Montador de
  `wa.me` **PURO** (telefone E.164 + `encodeURIComponent`).
- **Banco:** `075`.
- **Frontend:** botão "Abrir WhatsApp", modal com mensagem editável, "Marcar como enviado".
  Toda exibição de abordagem manual **rotulada como autodeclarada**.
- **Riscos:** confundir clique com envio; alegar entrega sem prova. Mitigação: `confirmado_por` e
  o rótulo, que são o coração desta fase.
- **Testes:** abrir não marca enviado; `manual_wa_me` nunca aciona a Evolution; teto/cooldown da
  Evolution **não** se aplicam ao manual; nenhum job grava `'operador'`.
- **Dependências:** Fase 4.

### Fase 6 — Abrir o papel `comercial`
- **Objetivo:** L2. Corrigir a inversão do gating.
- **Backend:** trocar `requireRole('admin')` por `requireCapacidade(...)` nas rotas da matriz §3.
- **Banco:** nenhuma.
- **Frontend:** `lib/navegacao.js` por capacidade; `useSession` expõe papel/capacidades.
- **Riscos:** **alto.** Errar um mount abre ou fecha módulo inteiro. Mitigação: uma rota por
  commit, com teste de permissão por rota antes do merge.
- **Testes:** para cada rota, os 4 papéis; foco no negativo (`comercial` ⇒ 403 em Aquisição, em
  leads brutos, em criação de roteiro).
- **Dependências:** Fases 1, 3, 4.

### Fase 7 — Ownership de conversa
- **Objetivo:** L4. Central de Mensagens em equipe.
- **Backend:** `responsavel_id`; `POST /conversas/:numero/assumir` (claim);
  `PUT .../responsavel`; recorte por papel na listagem; histórico + auditoria. **Escrever `quem`
  junto de `operador_assumiu_em`**, que hoje só tem o quando.
- **Banco:** `073`.
- **Frontend:** `ConversaPainel.tsx` (dono único — **não criar segundo painel**): responsável,
  "Assumir", transferir (admin). Filtro "Minhas / Não atribuídas / Todas".
- **Riscos:** recortar conversa é o mais sensível — esconder atendimento em andamento causa dano
  real. Mitigação: "não atribuídas" **sempre** visível; ninguém é impedido de responder (E4).
- **Testes:** claim concorrente; comercial não lê conversa de outro; `modo_ia` e `agente_pausado`
  não mudam na transferência.
- **Dependências:** Fase 6.

### Fase 8 — Instâncias com responsável
- **Objetivo:** L8. Vendedor conecta o número dele.
- **Backend:** `usuario_id`/`criado_por` no INSERT dos 3 pontos autorizados;
  `empresas.contexto_padrao_id` aplicado na criação; listagem recortada por papel; capacidade
  `gerenciar_instancia_propria`.
- **Banco:** `071`, `076`.
- **Frontend:** `InstanciasWhatsApp.tsx`: "minhas" × "da empresa"; selo de contexto padrão.
- **Riscos:** tocar a criação de instância mexe em `origem_vinculo` e na compensação no Evolution.
  Mitigação: **não alterar** nenhuma dessas regras — só acrescentar colunas ao INSERT.
- **Testes:** as 3 rotas gravam a evidência de origem (`test/instancia-origem.test.js` intocado);
  contexto padrão aplicado; envio continua resolvendo por empresa+instância, **nunca** por usuário
  (guarda de regressão).
- **Dependências:** Fase 6.

### Fase 9 — Permissão de IA (a capacidade sensível)
- **Objetivo:** IA não liberada automaticamente para `comercial`.
- **Backend:** `PATCH /conversas/:numero/modo-ia` e ativação de instância exigem
  `gerenciar_ia_instancia`; instância criada por `comercial` sem a capacidade nasce com
  `config_json.modo_ia_padrao='analise'` (ou `ativo=false` — alternativa conservadora).
- **Banco:** nenhuma.
- **Frontend:** `AlternadorModoIa.tsx` desabilitado com explicação (nunca escondido sem motivo).
- **Riscos:** **é a única fase que toca o caminho do webhook** (onde a conversa nasce).
  Mitigação: fase isolada; a alternativa `ativo=false` não toca o webhook e pode ser escolhida.
- **Testes:** conversa de instância de comercial nasce em `analise`; comercial ⇒ 403 no PATCH;
  admin liberando por concessão funciona; nenhum motor de IA alterado.
- **Dependências:** Fases 6, 8.

### Fase 10 — Ligações e Follow-ups por responsável
- **Objetivo:** L5, L14.
- **Backend:** filtro por `usuario_id`/`responsavel_id` (campos **já existem**); `iniciarLigacao`
  que retoma sessão alheia devolve **somente leitura** (E5); `GET /responsaveis` já existe.
- **Banco:** nenhuma.
- **Frontend:** "Minhas ligações"; coluna Responsável e filtro em Follow-ups (visibilidade geral).
- **Riscos:** baixo — os campos existem e os índices estão prontos.
- **Testes:** comercial não vê ligação de outro; fila de Follow-ups continua geral; retomada de
  sessão alheia não permite escrita.
- **Dependências:** Fase 6.

### Fase 11 — Agenda em equipe
- **Objetivo:** L6, E7.
- **Backend:** `responsavel_id` + `prospect_id`; filtro por vendedor/período/tipo/status/lead;
  **`REUNIAO_BUFFER_MIN` passa a validar por responsável**; `empresa_id` em
  `vendas.agenda_eventos` (backfill).
- **Banco:** `074`, `077` (+ backfill).
- **Frontend:** filtro por vendedor; agenda consolidada (admin).
- **Riscos:** mexer no buffer toca 3 pontos da agenda do **bot** (oferta de horários, validação da
  escolha, criação do evento) — a agenda do bot é produção viva. Mitigação: a mudança é o
  `WHERE`; sem responsável, comportamento idêntico ao de hoje.
- **Testes:** buffer não bloqueia vendedores distintos; 2 reuniões do mesmo lead avisam sem
  bloquear; a agenda do bot continua respeitando o buffer dela.
- **Dependências:** Fases 6, 7.

### Fase 12 — Painel do admin, auditoria e polimento
- **Objetivo:** gestão da equipe + dívidas declaradas.
- **Backend:** leituras agregadas por vendedor (auditoria + históricos); remover os `DEFAULT` = PJ
  (§7.4); padronizar `/aprovar`+`/rejeitar` em `auditoria_eventos`.
- **Banco:** `DROP DEFAULT` (revisado um a um).
- **Frontend:** "Equipe" (quem tem o quê, o que fez), filtros por usuário.
- **Riscos:** remover `DEFAULT` pode quebrar `INSERT` que o omita. Mitigação: auditar cada
  `INSERT` antes; fase final de propósito.
- **Testes:** regressão completa; `INSERT` sem `empresa_id` falha **explicitamente**.
- **Dependências:** todas.

## 8.1 Por que esta ordem difere da hipótese do briefing

| Briefing | Aqui | Motivo |
| --- | --- | --- |
| "fundação multi-tenant" primeiro | **não é uma fase** | já existe e está correta; virou §4.4 dentro da Fase 11 |
| "migração de dados" na 4ª posição | espalhada | os dados já estão na PJ; migração é só `empresa_id` em 5 tabelas legadas |
| "ownership de leads" depois de permissões | **antes** (Fase 4 < 6) | abrir o papel comercial sem ownership entregaria a base inteira a todo vendedor |
| "central de mensagens" antes de instâncias | mantido (7 < 8) | ✅ |
| qualificação não aparece | **Fase 3, antes de tudo operacional** | sem a porta, ownership distribui lead que ninguém aprovou |

---

# 9. Estratégia de testes

Base: `node --test` em `backend/test/` e `frontend/lib/*.test.js`. `npm test`, e `npm run
typecheck` quando tocar `.ts`. **Não existem `npm run lint` nem `npm run build`.**

| Categoria | O que testar | Como |
| --- | --- | --- |
| **Permissão (por rota)** | para **cada** rota tocada, os 4 papéis + concessão | tabela de casos; **o caso negativo é obrigatório** — sem ele a Fase 6 é um "confie em mim" |
| **Multiempresa** | usuário de A não lê/escreve dado de B por ID manipulado; empresa no `WHERE`, não na leitura | fixtures com 2 empresas; sempre incluir a rota nova |
| **Multiusuário** | comercial vê só o seu; admin vê tudo; "não atribuídas" visível | fixtures com 2 comerciais + 1 admin |
| **Concorrência** | claim de lead e de conversa (E3/E4); ligação ativa (E5); follow-up duplicado (E6) | dois `UPDATE` concorrentes na mesma transação de teste; asserir 1 sucesso + 1 conflito |
| **Regras PURAS** | matriz de capacidades, `lead-qualificacao`, montador de `wa.me`, `lead-situacao` | unitário sem banco (padrão do projeto) |
| **Guardas de regressão (lendo o fonte)** | literal de papel/capacidade fora do módulo; fallback por empresa em `buscarContexto2Ativo`; `usuario_id` na resolução de instância de **envio**; job gravando `confirmado_por='operador'`; `modo_ia` no `webhook-handler.js` | o projeto já usa esse recurso em 8 testes; é ele que impede a regra de ser desfeita meses depois |
| **Regressão funcional** | as 1400+ asserções atuais | `npm test`. **2 testes de `core.test.js` fazem chamada real ao provedor de IA e falham com 429** — é ambiental, não regressão |
| **Interface** | módulos puros de `frontend/lib` (navegação por capacidade, tradução de situação, identidade) | `node --test` |
| **Migrations** | idempotência (rodar 2×), e que nenhuma muta dado | teste que lê o fonte da migration, padrão já usado em `follow-up-modelo.test.js` |

**Teste que não existe hoje e passa a ser obrigatório:** uma suíte de **autorização por rota**,
dirigida por tabela, que falhe quando uma rota nova for montada sem declarar capacidade. É o
único mecanismo que impede a matriz de §3 de virar ficção com o tempo.

---

# Decisões que dependem de você

| # | Decisão | Recomendação |
| --- | --- | --- |
| **A** | Criar só `comercial`, ou já `manager`/`viewer`? | **só `comercial`**. Papel sem ocupante apodrece |
| **B** | Concessões por usuário: JSONB aditivo no vínculo, ou tabela? | **JSONB aditivo**. Sem negações |
| **C** | `member` mantém acesso total à Central de Mensagens? | **sim** (compatibilidade). Só `comercial` é recortado |
| **D** | Follow-ups com visibilidade geral? | **sim** — foi seu pedido e casa com a fila única |
| **E** | Fase 9: instância de comercial nasce com conversas em `analise`, ou nasce `ativo=false`? | **`ativo=false`** para estrear (não toca o webhook); `analise` como evolução |
| **F** | Agenda: comercial vê a consolidada da equipe? | **não por padrão**, liberável (➕). Conflito de horário justifica |
| **G** | Aposentar `/dashboard/*` legado (L7, L14, 2ª identidade sem tenant)? | **fase própria, depois desta v1.** Enquanto existir, `vendas.dashboard_users` é um caminho paralelo sem escopo de empresa |
| **H** | Medir produção antes da Fase 3? | **sim.** Script somente-leitura (`READ ONLY` + `ROLLBACK`, sem PII), padrão `medir:isolamento-empresa` |
| **I** | Normalizar `vendas.conversas.historico` (mensagens em tabela)? | **não.** Projeto próprio, alto risco, ganho zero para equipe |
| **J** | `vendas.conversas.numero UNIQUE GLOBAL` — resolver agora? | **não.** É a última peça da `PENDENCIA_ARQUITETURAL`. Duas empresas com o mesmo contato colidem, mas isso já é verdade hoje e não piora com equipe |

---

## Resumo do que muda, em números

| | Quantidade |
| --- | --- |
| Migrations novas | **9**, todas aditivas, nenhuma mutando dado |
| Tabelas novas | **2** (históricos de responsável) |
| Campos novos | **17** |
| Papéis novos | **1** (`comercial`) |
| Variáveis de ambiente novas | **0** |
| Rotas novas | ~10 (membros, assumir/transferir lead e conversa, abordagem manual) |
| Regras de IA/atendimento alteradas | **1**, isolada na Fase 9, com alternativa que não toca o webhook |
| Regras existentes **revertidas** | **0** — quarentena de webhook, instância de envio sem fallback, origem autorizada e "atendimento 100% por instância" permanecem |

**Nada nesta especificação afrouxa uma regra de isolamento que o projeto pagou para aprender.**
Onde o briefing pedia um fallback (contexto da empresa em tempo de resposta), a recomendação é
explicitamente outra — e o motivo está em §2.5.
