# Análise de impacto — contexto de instância na operação

> **Tipo:** análise somente leitura. Nenhum código, schema, migration, configuração ou
> automação foi alterado nesta tarefa. Fase 0 registrada em
> [ai-task-start-log.md](ai-task-start-log.md).
>
> **Data:** 2026-08-10 · **Base:** working tree em `master` (inclui alterações não commitadas
> de `agent.js`, `prospecting.js`, `api-conversas.js`, `ConversaPainel.tsx`,
> `lead-identidade.js` e os arquivos novos de nome do lead).
>
> **Escopo:** o que precisa ser global da empresa, por instância, ou único com atribuição/
> filtro, antes de implementar um seletor de instância persistente.

---

## 1. Resumo executivo — o veredito em cinco frases

1. **A instância já existe como entidade sólida** (`app.empresa_whatsapp_instances`, com id
   UUID, `ativo`, `config_json`, `contexto_id` e evidência de origem autorizada), e o
   **webhook já resolve empresa + instância com prova** desde a quarentena (migration 060).
2. **Mas apenas 1 dos 8 fluxos operacionais é escopado por instância hoje**: "Rodar leads"
   (Banco de Leads). Central de Mensagens, Follow-ups, Ligações, Campanhas, Aquisição,
   Captação, Agenda e Relatórios têm **zero** referência a instância — verificado por grep,
   contagem zero em 12 módulos (§2.3).
3. **O risco não é teórico: já existe hoje um caminho de envio que escolhe a instância "mais
   recentemente atualizada" da empresa** (`whatsapp.js:51-60`, repetido em
   `conversa-manual.js:61-69`) e, na falta dela, cai no **env global `EVOLUTION_INSTANCE`
   (default `'PJ'`)** (`whatsapp.js:11,79`). Com uma instância isso é invisível; com duas,
   **o follow-up automático e o lembrete de reunião podem sair pelo número errado**.
4. **A identidade do contato é global por telefone** (`vendas.conversas.numero UNIQUE`
   GLOBAL, `init.sql:6`) — a mesma pendência congelada em
   [PENDENCIA_ARQUITETURAL_CENTRAL_LIGACOES_E_MENSAGENS.md](PENDENCIA_ARQUITETURAL_CENTRAL_LIGACOES_E_MENSAGENS.md).
   Duas instâncias da MESMA empresa que falem com o mesmo número **compartilham uma única
   linha de conversa e um único histórico**. Isso é decisão de produto pendente, não bug.
5. **A recomendação é não tornar a instância uma segunda chave de tenant.** A instância deve
   ser **atributo de atendimento** — obrigatório no envio, atribuído no registro, opcional no
   filtro — com **fonte única de verdade no backend** e o seletor do front como conveniência,
   nunca como barreira.

---

## 2. Mapa do que existe hoje

### 2.1 A entidade instância

`app.empresa_whatsapp_instances` — criada em [`001_multiempresa.sql:94`](../backend/sql/migrations/001_multiempresa.sql):

| Coluna | Origem | Observação |
| --- | --- | --- |
| `id UUID PK` | 001:95 | **Identificador confiável.** Já usado como FK em 3 tabelas. |
| `empresa_id UUID NOT NULL FK` | 001:96 | `ON DELETE CASCADE`. |
| `evolution_instance TEXT NOT NULL **UNIQUE GLOBAL**` | 001:97 | Nome técnico. Único no sistema inteiro, não por empresa. |
| `nome TEXT` | 001:98 | Rótulo humano — é o que o seletor mostraria. |
| `ativo BOOLEAN NOT NULL DEFAULT true` | 001:99 | |
| `config_json JSONB` | 001:100 | Guarda `saudacao`, `usa_agenda`, `canal` (`whatsapp`\|`freelandoo`). |
| `contexto_id UUID FK` | [003:8](../backend/sql/migrations/003_whatsapp_contexto_link.sql) | **Conhecimento/prompt já é por instância.** |
| `origem_vinculo` + `_em` + `_usuario_id` | [061:50](../backend/sql/migrations/061_instancia_origem_autorizada.sql) | `atendimento_views` \| `legado`, NOT NULL sem DEFAULT. |

**Consequência arquitetural já paga:** o produto já trata a instância como unidade de
*configuração de atendimento* (contexto, saudação, uso de agenda, canal). O que falta é
tratá-la como unidade de **operação** (fila, envio, métrica).

### 2.2 O que JÁ tem vínculo direto com instância

| Onde | Coluna / mecanismo | Tipo de vínculo | Evidência |
| --- | --- | --- | --- |
| `vendas.conversas` | `evolution_instance TEXT` (nullable, **sem FK**) | por NOME | `init.sql:26`, índice `003:18` |
| `prospectador.lead_disparos` | `evolution_instance TEXT NOT NULL` | por NOME | `016:29`, índice `016:41` |
| `app.banco_leads_config` | `auto_instancia_id UUID` (sem FK) | por ID | `023:6` |
| `app.atribuicao_anuncios` | `instancia_id UUID NOT NULL FK` | por ID | `059:49` |
| `app.whatsapp_instance_events` | `instance_id UUID FK` + `evolution_instance TEXT` | ambos | `037:7-8` |
| `app.webhook_quarentena` | `instancia_chave` / `evolution_instance` | por NOME | `060:53` |
| `app.freelandoo_connections` | `instance_id UUID PK FK` | por ID | `019:10` |
| `app.conversa_feedbacks` | `evolution_instance TEXT` | por NOME | `036:9` |
| Webhook (runtime) | `req.whatsappInstanciaId` + `req.evolutionInstance` + `req.empresaOrigem` | por ID | `middleware/tenant.js:102-106` |

**Nota de inconsistência já presente:** o vínculo é gravado ora por **nome** (`TEXT`,
renomeável, sem FK), ora por **id** (UUID, com FK). Os módulos mais recentes (CTWA, 059) usam
id; os mais antigos usam nome. Uma implementação nova não deve escolher "o que já existe" —
tem de escolher **id** e conviver com o nome onde ele já está.

### 2.3 O que NÃO tem nenhuma noção de instância (medido)

Contagem de ocorrências de `instancia|instance` (case-insensitive) no fonte:

| Módulo | Ocorrências |
| --- | --- |
| `src/routes/api-follow-ups.js` | **0** |
| `src/routes/api-ligacoes.js` | **0** |
| `src/routes/api-campanhas.js` | **0** |
| `src/routes/api-prospeccao.js` | **0** |
| `src/routes/api-aquisicao-rotinas.js` | **0** |
| `src/routes/api-captacao.js` | **0** |
| `src/routes/api-agenda.js` | **0** |
| `src/routes/api-relatorios.js` | **0** |
| `src/routes/api-llm-uso.js` | **0** |
| `src/services/followup-listing.js` | **0** |
| `src/services/followup-call-score.js` | **0** |
| `src/db/follow-ups.js` · `src/db/ligacoes.js` · `src/db/campanhas.js` | **0** |
| `src/followup-auto.js` · `src/services/followup-manual.js` | **0** |
| `src/prospecting.js` | 4 — **todas são `instanceof Date`**, nenhuma é instância WhatsApp |

Tabelas correspondentes, todas com `empresa_id` e **sem** instância: `app.follow_ups` (062),
`app.ligacoes` (040), `app.campanhas` / `campanha_leads` (039), `prospectador.prospects`
(init:685 + 005), `app.agenda_eventos` (011), `app.followup_config` (029),
`prospectador.aquisicao_rotinas` (053), `prospectador.captacao_campanhas` (012),
`vendas.lead_profiles`, `vendas.ai_logs`.

**Caso à parte — `vendas.followup_auto_agendamentos` (`init.sql:491`) não tem nem
`empresa_id`.** É chaveada só por `numero` (FK para `vendas.conversas`). A empresa é inferida
pela conversa na leitura. Qualquer escopo por instância aqui herda o mesmo problema de
identidade global do telefone.

### 2.4 Como a instância de ENVIO é escolhida hoje — o ponto mais crítico

`src/whatsapp.js:72` (`instanceNameParaEnvio`) resolve nesta ordem:

```
1. opts.instanceName            (quem chamou disse explicitamente)
2. getInstanceNameForConversation(numero)   → whatsapp.js:45-70
     2a. vendas.conversas.evolution_instance da linha, se preenchida
     2b. senão: SELECT ... FROM app.empresa_whatsapp_instances
                 WHERE empresa_id = c.empresa_id AND ativo = true
                 ORDER BY atualizado_em DESC, criado_em DESC LIMIT 1     ← ARBITRÁRIA
3. process.env.EVOLUTION_INSTANCE  (default literal 'PJ')                ← GLOBAL
```

O passo **2b** e o passo **3** são o defeito estrutural: com múltiplas instâncias, "a mais
recentemente atualizada" é uma escolha que **nenhuma regra de negócio tomou**, e o passo 3
ignora a empresa por completo.

**Chamadores que passam `instanceName` (seguros hoje):**

| Chamador | Linha |
| --- | --- |
| `core-funnel.js` (resposta do funil) | 1055, 1134, 2087 |
| `services/conversa-manual.js` (mensagem do operador) | 113 |
| `services/rodar-leads.js` (disparo do Banco de Leads) | 786 |
| `routes/api-conversas.js` (reprocessar) | 261 |
| `agent.js` | 7311 |

**Chamadores que NÃO passam (caem no fallback arbitrário):**

| Chamador | Linha | O que envia |
| --- | --- | --- |
| `followup-execution.js` | **386** | Follow-up automático ao lead |
| `agenda.js` | **803**, **928** | Lembrete de reunião e sugestão de reagendamento |
| `prospecting.js` | **2033** | 1ª mensagem da fila de prospecção |
| `handoff-alerts.js` | 342 | Alerta ao operador (destino é o operador, risco menor) |
| `whatsapp-routes.js` | 66, 154, 203, 288 | Rotas legadas de QR — usam `env` direto |

### 2.5 Divergência real na ESCRITA de `vendas.conversas.evolution_instance`

Três writers, **duas precedências opostas** sobre a mesma coluna:

| Writer | Regra | Efeito |
| --- | --- | --- |
| `db-crud.js:154, 170` (`salvarConversa` — caminho do webhook, o mais quente) | `COALESCE(**EXCLUDED**, existente)` | **A instância nova SOBRESCREVE** a anterior |
| `services/historico-envio.js:71` | `COALESCE(**existente**, EXCLUDED)` | Nunca migra |
| `services/conversa-manual.js:144` | `COALESCE(NULLIF(BTRIM(existente),''), $7)` | Nunca migra |

Ou seja: hoje uma conversa **muda de instância sozinha** quando o lead escreve para um segundo
número da mesma empresa, mas **não muda** quando o operador ou a saudação falam com ele. Isso
não é um detalhe cosmético — é a coluna que o seletor usaria para filtrar a Central de
Mensagens. Enquanto essa divergência existir, o filtro por instância será instável.

### 2.6 Frontend — onde o seletor se encaixaria

| Peça | Arquivo | Papel |
| --- | --- | --- |
| Escopo atual (empresa) | `frontend/lib/api.ts:8` — `localStorage.getItem('empresa_id')` | **Precedente exato** do que o seletor de instância faria |
| Layout do painel | `frontend/app/dashboard/layout.tsx` | `AuthGuard` > `FeedbackProvider` > `Sidebar` + `<main>` — **não há header global hoje** |
| Árvore de navegação | `frontend/lib/navegacao.js` (módulo PURO, testado) | Onde o seletor seria declarado se virasse item de navegação |
| Telas operacionais | 22 páginas em `frontend/app/dashboard/**/page.tsx` | 8 delas são operacionais |

O projeto já tem o padrão de **módulo puro que traduz o veredito do backend**
(`site-rotulos.js`, `pontuacao-indicador.js`, `lead-identidade.js`, `paginacao.js`). O seletor
deve seguir esse padrão: **estado e tradução no front, decisão no backend**.

---

## 3. Matriz de classificação

Legenda: **G** = global da empresa (nunca duplicar por instância) · **I** = pertence a uma
instância · **C** = existe uma vez, atribuído/filtrado por instância.

### 3.1 Deve ser GLOBAL da empresa

| Área | Onde vive | Por quê |
| --- | --- | --- |
| Usuários, papéis, vínculo empresa↔usuário | `app.usuarios`, `app.usuarios_empresas` (001) | Permissão é da pessoa na empresa. Papel por instância criaria uma segunda matriz de acesso sem fonte. |
| Cadastro de leads / carteira bruta | `prospectador.prospects` (init:685) | `UNIQUE (empresa_id, place_id)` (005:60). O mesmo estabelecimento não pode virar 2 linhas porque 2 números o abordaram. |
| Nichos, Roteiros e versões | `app.nichos` (038), `app.roteiros` (033) | Conteúdo comercial reusável. Agrupamento já é por `nicho` (texto), não por instância. |
| Integração Meta (credencial + ledger) | `app.meta_integracoes`, `app.conversao_eventos` (057) | UNIQUE por `empresa_id`. Dataset é da empresa. |
| Auditoria | `app.auditoria_eventos` (047) | Registro do que aconteceu; a instância entra como campo de `contexto`, não como partição. |
| Contas, plano, dados da empresa | `app.empresas` (001) | — |
| Relatórios consolidados | `api-relatorios.js` | Precisa **poder** somar tudo; a instância vira dimensão de recorte, não escopo obrigatório. |

### 3.2 Deve ser POR INSTÂNCIA

| Área | Estado hoje | O que falta |
| --- | --- | --- |
| **Contexto/conhecimento do agente** | ✅ já é (`contexto_id`, 003:8) | nada |
| **Saudação do disparo** | ✅ já é (`config_json->>'saudacao'`) | nada |
| **Usa agenda?** | ✅ já é (`config_json->>'usa_agenda'`) | nada |
| **Canal (WhatsApp/Freelandoo)** | ✅ já é (`config_json->>'canal'`) | nada |
| **Saúde/conexão da instância** | ✅ já é (`app.whatsapp_instance_events`, 037) | nada |
| **Cooldown e teto diário de disparo** | ⚠️ parcial — throttle conta por `evolution_instance` (`rodar-leads.js:205-213`), mas o **teto e a janela vêm de `app.banco_leads_config`, que é por EMPRESA** (020:14) | teto/janela/intervalo por instância |
| **Modo do Banco de Leads (Manual/Semi/Auto)** | ❌ por empresa (020:16) | mover para instância |
| **Instância do Automático** | ⚠️ `auto_instancia_id` escolhe **uma só** (023:6) | com N instâncias, cada uma precisa da própria agenda |
| **Modo de IA padrão da Central** | ❌ `app.empresas.config->>'modo_ia_padrao'` (064:30) | é comportamento de atendimento — deveria ser por instância |
| **Pausa do follow-up automático** | ❌ `app.followup_config.pausado` por empresa (029:10) | pausar um número não deveria calar os outros |
| **Meta de ligações/dia** | ❌ `followup_config.meta_ligacoes_dia` | decisão do operador: capacidade é da equipe ou do número? (§8, D-4) |

### 3.3 Deve ser ÚNICO, com ATRIBUIÇÃO ou FILTRO

| Entidade | Chave hoje | Como escopar |
| --- | --- | --- |
| **Conversa** (`vendas.conversas`) | `numero` UNIQUE **GLOBAL** (init:6) | Filtrar por `evolution_instance` na leitura; **atribuir** no primeiro contato. **Não duplicar** — ver §5.1. |
| **Perfil do lead** (`vendas.lead_profiles`) | `numero` UNIQUE global | Segue a conversa. Nunca duplicar: é o dado que a IA acumula. |
| **Follow-up** (`app.follow_ups`, 062) | `(empresa_id, telefone_digitos)` | Ganhar `instancia_id` **opcional** (a origem sabe; o item derivado não). Ver §5.4. |
| **Ligação** (`app.ligacoes`, 040) | `empresa_id` + prospect | Ligação é telefone, não WhatsApp. Atribuição é de **responsável/campanha**, não de instância — a menos que o operador queira segmentar equipes (§8, D-3). |
| **Campanha** (`app.campanhas`, 039) | `empresa_id` | Ganhar `instancia_id` opcional: uma campanha que dispara WhatsApp precisa saber por qual número. |
| **Evento de agenda** (`app.agenda_eventos`, 011) | `empresa_id` + `lead_telefone` | Ganhar `instancia_id` para o lembrete sair pelo número certo (hoje `agenda.js:803` não escolhe). |
| **Disparo** (`prospectador.lead_disparos`) | ✅ já tem `evolution_instance NOT NULL` | migrar para id (ver §6.2) |
| **Log de IA / custo** (`vendas.ai_logs`) | `empresa_id` | Ganhar `instancia_id` opcional para "quanto este número custa". |

---

## 4. Fluxos que exigem escopo — leitura, escrita, automação, envio

### 4.1 Leitura (filtro; segurança baixa, correção alta)

| Fluxo | Rota | Situação |
| --- | --- | --- |
| Lista de conversas | `GET /conversas` (`api-conversas.js:98`) | Sem filtro de instância. Precisa de `?instancia_id=`. **Herda o fallback da PJ** (`api-conversas.js:26`). |
| Conversa individual | `GET /conversas/:numero` (:168) | Devolve `c.*`, então `evolution_instance` já vem — o painel pode exibir sem rota nova. |
| Fila de Follow-ups | `GET /follow-ups/call-list` e `/auto` | Zero instância. |
| Fila de Ligações | `api-ligacoes.js` / `db/campanhas.js:254` | Zero instância. |
| Banco de Leads | `GET /banco-leads/leads` | Lista global da empresa; só o join de mensagem gerada filtra (`api-banco-leads.js:204-212`). |
| Aquisição | `GET /prospeccao/prospects` | Global por empresa, por definição (§3.1). |
| Relatórios / Uso e custo | `api-relatorios.js`, `api-llm-uso.js` | Zero instância. |

### 4.2 Escrita (atribuição; segurança média)

| Fluxo | Onde | Situação |
| --- | --- | --- |
| Criação de conversa pelo webhook | `db-crud.js:147` | ✅ grava instância — mas **sobrescreve** (§2.5) |
| Espelho da saudação | `historico-envio.js:63` | ✅ grava, nunca sobrescreve |
| Mensagem do operador | `conversa-manual.js:144` | ✅ grava, nunca sobrescreve |
| Follow-up criado ao encerrar ligação | `db/ligacoes.js` → `criarFollowUp` | ❌ sem instância |
| Follow-up manual | `services/followup-manual.js` | ❌ sem instância; conversa nasce sem `evolution_instance` |
| Ligação registrada | `db/ligacoes.js` | ❌ sem instância |
| Evento de agenda | `agenda.js` / `api-agenda.js` | ❌ sem instância |

### 4.3 Automação / jobs (segurança ALTA — nenhum tem contexto de usuário)

| Job | Arquivo | Escopo hoje | Risco |
| --- | --- | --- | --- |
| Motor de follow-up automático | `followup-auto.js` + `followup-execution.js:386` | empresa | **Envia pela instância errada** |
| Worker do Banco de Leads (Auto) | `services/banco-leads-auto.js:221-276` | ✅ instância (uma só) | Só opera 1 número por empresa |
| Lembretes de agenda | `agenda.js:761-803` | nenhum | **Envia pela instância errada** |
| Fila de prospecção | `prospecting.js:1943-2033` | empresa | **Envia pela instância errada** |
| Auto-lock de leads | `services/lead-lock.js` | empresa | Baixo (não envia) |
| Rotinas de aquisição | `prospecting.js` → `executarRotinasAquisicao` | empresa | Baixo (coleta, não envia) |
| Scheduler de captação | `services/captacao-scheduler.js` | empresa | Baixo |
| Meta dispatch | `services/meta-dispatch.js` | empresa | Correto assim (§3.1) |

### 4.4 Envio (segurança MÁXIMA — é o que o cliente vê)

Todo `enviarMensagem` deveria receber `instanceName` explícito e **falhar** quando não houver
instância provada — como já faz `conversa-manual.js:97-104` (`409 INSTANCE_UNAVAILABLE`).
Hoje 5 caminhos não fazem isso (§2.4).

---

## 5. Riscos — onde uma instância pode ver, alterar ou enviar o que é de outra

### 5.1 🔴 Conversa compartilhada entre instâncias da mesma empresa (estrutural)

`vendas.conversas.numero` é `UNIQUE` **GLOBAL** (`init.sql:6`). Se dois números da mesma
empresa (ex.: "Vendas" e "Suporte") falam com o mesmo cliente, existe **uma linha só**: um
histórico, um `estagio`, um `agente_pausado`, um `modo_ia`, um perfil de lead.

Ao filtrar a Central de Mensagens por instância, essa conversa **aparece em uma instância e
desaparece da outra** — conforme quem falou por último, por causa do sobrescrito em
`db-crud.js:154`. É o risco mais grave e **não se resolve com filtro**: exige decisão de
produto (§8, D-1).

### 5.2 🔴 Envio pelo número errado (já existe, hoje)

`whatsapp.js:51-60` escolhe "a instância ativa mais recentemente atualizada". Um `PATCH` de
configuração numa instância muda `atualizado_em` e **troca o número por onde o follow-up
automático de todos os leads sem instância gravada vai sair**. O cliente recebe de um número
que nunca o contatou.

### 5.3 🟠 Fallback global para `EVOLUTION_INSTANCE` / `'PJ'`

`whatsapp.js:11,79`: se a empresa não tem instância ativa, o envio vai pela instância do env —
**que pode pertencer a outra empresa**. É o mesmo tipo de defeito que a quarentena de webhook
(migration 060) removeu do lado da entrada, e que continua vivo do lado da saída.

### 5.4 🟠 Follow-up e ligação sem instância = ação sem número

`app.follow_ups` tem `canal` (`whatsapp`|`ligacao`) mas não tem por qual número executar. Ao
clicar "executar" num item de WhatsApp, o painel abre a conversa e o envio cai no §5.2.

### 5.5 🟠 Contadores e limites por empresa, throttle por instância

`rodar-leads.js:205-213` conta disparos por `evolution_instance`, mas lê `teto_diario` de
`app.banco_leads_config`, que é **por empresa** (020:23). Com 3 instâncias, o teto de 40 é
aplicado 3 vezes = 120 disparos/dia. **O limite de segurança já está furado hoje**, sem
seletor nenhum.

### 5.6 🟠 Fallback da PJ nas leituras de conversa

`api-conversas.js:26` — `($1::uuid = $2::uuid AND c.empresa_id IS NULL)`. Conversas órfãs
aparecem para a PJ. Não foi criado por este tema, mas **um filtro por instância sobre um
universo que já mistura tenants não conserta a mistura** — apenas a esconde.

### 5.7 🟡 Vínculo por NOME, sem FK

`vendas.conversas.evolution_instance` é `TEXT` sem FK. Se uma instância for removida e o nome
reusado (o produto permite recriar), conversas antigas passam a "pertencer" à instância nova.
`api-whatsapp.js` tem `/:instanceId/substituicao-impacto` e `/remocao-impacto`, o que mostra
que o problema já é conhecido — mas o vínculo continua textual.

### 5.8 🟡 Desempenho

Não há índice composto `(evolution_instance, atualizado_em)` em `vendas.conversas` — só
`(evolution_instance)` (003:18) e `(empresa_id)` (001:165). A listagem ordena por
`c.atualizado_em DESC` (`api-conversas.js:127`); filtrar por instância sem índice composto
força varredura + sort na empresa inteira.

### 5.9 🟡 "Todas as instâncias" como porta de ação em massa

Nenhuma rota de escrita hoje aceita "todas". Se a visão consolidada for implementada, o risco
é o botão de ação em massa herdar o escopo do seletor. **A regra tem de ser do backend:
recusar escrita quando `instancia_id` estiver ausente** — não desabilitar o botão no front.

---

## 6. Onde um filtro apenas visual é insuficiente ou perigoso

| Ponto | Por quê |
| --- | --- |
| **Qualquer `enviarMensagem`** | O front não escolhe a instância de envio; `whatsapp.js` escolhe. Filtrar a tela não muda por onde a mensagem sai. |
| **Jobs e workers** | `followup-auto`, `agenda`, `banco-leads-auto`, `prospecting` rodam sem request, sem usuário e sem `localStorage`. |
| **Webhook** | A entrada é decidida pela Evolution, não pelo painel. |
| **Cooldown / teto diário** | Limite conferido no front é limite inexistente (§5.5). |
| **Ações em massa** | "Disparar gerados", "Rodar leads", "Reprocessar" — o escopo tem de ser parâmetro validado no servidor. |
| **Contagens e rodapés** | Se a contagem vier de um WHERE e a lista de outro, a tela se contradiz (mesma lição de `montarFiltrosProspects`, AGENTS.md). |

**Regra a adotar:** o seletor do front só pode **acrescentar** `?instancia_id=` a requisições
de leitura. Toda escrita e todo envio precisam receber a instância como **parâmetro
obrigatório validado contra `empresa_id`** — o padrão que `rodar-leads.js:158-164`
(`carregarInstancia` com `WHERE id = $1 AND empresa_id = $2`) já usa e que deve ser copiado.

---

## 7. Proposta de arquitetura

### 7.1 Fonte única de verdade

Três camadas, uma responsabilidade cada:

```
┌─ BANCO ────────────────────────────────────────────────────────────┐
│ app.empresa_whatsapp_instances.id  =  a identidade da instância    │
│ (UUID, com FK onde for atribuição real; nome TEXT só como legado)  │
└────────────────────────────────────────────────────────────────────┘
              ▲                                    ▲
┌─ BACKEND ───┴────────────────────────────────────┴─────────────────┐
│ src/services/instancia-escopo.js   (NOVO, PURO — sem banco/rede)   │
│   • vocabulário: 'instancia' | 'todas' | 'nao_definida'            │
│   • escopoDeLeitura(param)      → filtro ou "todas"                │
│   • exigirInstanciaParaEscrita(param) → id, ou LANÇA               │
│   • capacidadePermitida(escopo, capacidade)  ← matriz fechada,     │
│     no molde de src/services/conversa-modo-ia.js                   │
│                                                                    │
│ src/middleware/instancia.js        (NOVO)                          │
│   • resolve ?instancia_id= / body.instancia_id                     │
│   • valida contra empresa_id (SELECT ... WHERE id=$1 AND empresa=$2)│
│   • publica req.instancia / req.instanciaEscopo                    │
└────────────────────────────────────────────────────────────────────┘
              ▲
┌─ FRONTEND ──┴──────────────────────────────────────────────────────┐
│ frontend/lib/instancia-ativa.js  (NOVO, PURO — padrão paginacao.js)│
│   • lê/grava localStorage 'instancia_id' (precedente: api.ts:8)    │
│   • traduz o veredito do backend; NÃO decide nada                  │
│ frontend/components/ui/SeletorInstancia.tsx  (dono ÚNICO)          │
└────────────────────────────────────────────────────────────────────┘
```

**Por que uma matriz `escopo × capacidade` (e não um booleano "está filtrado"):** é
exatamente a lição registrada no AGENTS.md sobre `modo_ia` — o gate não responde "qual é o
escopo?", responde "**esta capacidade está liberada neste escopo?**". Isso é o que impede
alguém de "aproveitar" a visão *Todas* como interruptor geral e o que torna explícito, no
código, que leitura consolidada é permitida e envio em massa não.

### 7.2 Contrato do escopo

| Escopo | Leitura | Escrita não-destrutiva | Envio / ação em massa |
| --- | --- | --- | --- |
| `instancia` (uma escolhida) | ✅ filtrada | ✅ atribuída a ela | ✅ |
| `todas` | ✅ consolidada, com coluna "Instância" visível | ❌ **recusa 400** | ❌ **recusa 400** |
| `nao_definida` (itens sem instância) | ✅ como filtro explícito | ✅ (é o ato de atribuir) | ❌ |

`nao_definida` é estado de primeira classe, não "erro" — é o que o histórico existente vai
produzir (§7.4). O mesmo princípio de `valor: null` na bolinha de pontuação e de
`responsavel_id NULL` em `app.follow_ups`.

### 7.3 Schema proposto (NÃO implementado nesta tarefa)

Tudo **aditivo**, nullable, sem DEFAULT que invente dono:

| Tabela | Coluna proposta | Nota |
| --- | --- | --- |
| `vendas.conversas` | `instancia_id UUID` (+ índice `(instancia_id, atualizado_em DESC)`) | Convive com `evolution_instance` TEXT; a coluna nova é a autoridade |
| `app.follow_ups` | `instancia_id UUID FK ON DELETE SET NULL` | Opcional; item derivado fica NULL |
| `app.agenda_eventos` | `instancia_id UUID FK ON DELETE SET NULL` | Para o lembrete sair pelo número certo |
| `app.campanhas` | `instancia_id UUID FK ON DELETE SET NULL` | Campanha de WhatsApp precisa de número |
| `app.banco_leads_config` | **repensar a PK**: hoje `empresa_id PK` (020:15) | Modo/teto/janela por instância exigem `(empresa_id, instancia_id)` |
| `app.followup_config` | idem — `empresa_id PK` (029:7) | Pausa por instância exige a mesma mudança |
| `vendas.ai_logs` | `instancia_id UUID` | Custo por número |
| `prospectador.lead_disparos` | `instancia_id UUID` ao lado do `evolution_instance` | Migração de nome → id |

**Índices necessários** (o filtro sem eles degrada as telas quentes):
`vendas.conversas (instancia_id, atualizado_em DESC)` ·
`app.follow_ups (empresa_id, instancia_id, status, agendado_para)` ·
`app.agenda_eventos (empresa_id, instancia_id, data_inicio) WHERE excluido_em IS NULL`.

**Constraint que NÃO deve ser criada agora:** `UNIQUE (instancia_id, numero)` em
`vendas.conversas`. Isso é a decisão D-1 (§8) e mexe no `UNIQUE` global que a pendência
arquitetural congelou.

### 7.4 Migração dos dados existentes

Princípio: **nunca inventar dono** — o mesmo do backfill de `lead_profiles.empresa_id` e da
quarentena de webhook.

1. **Medir primeiro, read-only.** ✅ **Entregue:** `npm run medir:escopo-instancia`
   ([`backend/scripts/medir-escopo-instancia.js`](../backend/scripts/medir-escopo-instancia.js)),
   no molde de `medir:isolamento-empresa` (`BEGIN TRANSACTION READ ONLY` + `ROLLBACK`, só
   contagens agregadas, ids mascarados, sem PII). Ele responde: quantas empresas têm >1
   instância ativa; quantas conversas têm `evolution_instance` nulo; a distribuição por empresa
   e por instância; instâncias sem uso; e a **atribuibilidade** de cada conversa sem instância.
   **Sem esse número, o resto do plano é chute.**
2. **Backfill derivável (seguro):** `conversas.instancia_id` a partir de
   `evolution_instance` + `empresa_id`, quando o par casar exatamente com uma linha de
   `app.empresa_whatsapp_instances`. Simulação por padrão, `--aplicar` para gravar, keyset,
   um COMMIT por lote, rollback impresso — padrão de `backfill-lead-profiles-empresa.js`.
3. **Empresa com exatamente UMA instância:** atribuir tudo a ela é seguro e resolve a maior
   parte da base. **Deve ser um passo separado e explícito**, nunca junto do passo 2.
4. **Empresa com MAIS de uma instância e conversa sem instância:** **não atribuir**. Fica
   `nao_definida`, visível e filtrável. Atribuir por "a mais recente" repetiria o defeito
   §5.2, agora em repouso e permanente.
5. **Nada de backfill retroativo em follow-up, ligação, agenda e campanha antigos.** São
   fatos passados; inventar a instância deles corromperia relatório histórico.

---

## 8. Decisões que dependem de confirmação (antes de qualquer edição)

| # | Decisão | Por que só o operador decide | Recomendação |
| --- | --- | --- | --- |
| **D-1** | **Um cliente que fala com dois números da mesma empresa: uma conversa ou duas?** | Muda `UNIQUE (numero)` global (`init.sql:6`), o perfil de lead, o histórico que a IA lê e a pendência arquitetural congelada. É a decisão que governa todas as outras. | **Uma conversa, com atribuição à instância que a iniciou** — menor mudança, preserva o histórico que a IA usa. Custo aceito: a conversa aparece só na instância dona. |
| **D-2** | **Teto/janela/intervalo de disparo: por empresa ou por instância?** | Hoje é por empresa e **já está furado** (§5.5). Por instância multiplica o volume de propósito; por empresa exige dividir o teto entre números. | **Por instância**, com o teto da empresa como limite superior. É o que o operador já acredita que existe. |
| **D-3** | **Central de Ligações entra no escopo por instância?** | Ligação é telefone, não WhatsApp. Só faz sentido se "instância" for lida como "equipe/operação", não como "número". | **Não escopar agora.** Segmentar por campanha/responsável, que já existem. |
| **D-4** | **Pausa do follow-up e meta de ligações/dia: empresa ou instância?** | `followup_config` é PK por empresa. Pausar um número calaria os outros hoje. | **Pausa por instância; meta de ligações permanece por empresa** (capacidade é da equipe). |
| **D-5** | **A visão "Todas as instâncias" existe já na Fase 1?** | Ela dobra a superfície de teste e é onde mora o risco de ação em massa. | **Sim, mas somente leitura e com coluna "Instância" obrigatória** na tabela. Escrita recusada no backend. |
| **D-6** | **O modo de IA padrão passa a ser por instância?** | Hoje é `app.empresas.config.modo_ia_padrao` (064:30), entregue há dois commits. Mudar agora reabre um módulo recém-fechado. | **Adiar.** Não bloqueia o seletor. |
| **D-7** | **Remover o fallback global `EVOLUTION_INSTANCE` do envio?** | É rede de segurança de produção; removê-lo faz envios falharem alto em vez de saírem pelo número errado. | **Remover, mas só depois da Fase 2**, quando todos os chamadores passarem instância explícita. |
| **D-8** | **Corrigir a divergência de escrita de `evolution_instance` (§2.5)?** | `db-crud.js:154` sobrescreve; os outros dois não. É pré-requisito de um filtro estável. | **Sim, alinhar para "nunca migra"** — mas é mudança em caminho de escrita de produção e precisa de aprovação isolada. |

---

## 9. Plano de implementação em fases pequenas e reversíveis

Cada fase é independentemente entregável e reversível. **Nenhuma altera comportamento
observável até a Fase 4.**

| Fase | O que faz | Reversível? | Depende de |
| --- | --- | --- | --- |
| **0 — Medição** | ✅ **ENTREGUE** — `npm run medir:escopo-instancia` (`backend/scripts/medir-escopo-instancia.js`). Nenhuma alteração de dado. | n/a | — |
| **1 — Vocabulário** | `services/instancia-escopo.js` (puro) + `lib/instancia-ativa.js` (puro) + testes. Nada os consome ainda. | Deletar 2 arquivos | — |
| **2 — Fechar o envio** | ✅ **ENTREGUE (2026-08-11)** — e mais amplo do que esta linha previa: ver a nota abaixo. | Sim (diff sem migration) | D-8 aplicado junto |
| **3 — Schema aditivo** | Migration com as colunas e índices de §7.3 (nullable, sem DEFAULT). Nada lê ainda. | Sim (colunas nullable) | D-1, D-2, D-4 |
| **4 — Backfill** | Script de simulação/`--aplicar` (§7.4.2-4). | Sim (SQL de rollback impresso) | Fase 3 |
| **5 — Leitura filtrada** | `middleware/instancia.js` + `?instancia_id=` em `GET /conversas`, `/follow-ups`, `/banco-leads`. Parâmetro **opcional**: sem ele, comportamento idêntico ao de hoje. | Sim | Fases 1, 3 |
| **6 — Seletor no front** | `SeletorInstancia.tsx` no `dashboard/layout.tsx` + `localStorage`. Atalhos nas telas operacionais lendo o mesmo módulo puro. | Sim | Fase 5 |
| **7 — Escrita atribuída** | `instancia_id` obrigatório nas escritas de follow-up, agenda, campanha; recusa 400 em `todas`. | Parcial | Fase 6 |
| **8 — Limites por instância** | Mover teto/janela/pausa (§3.2). Muda a PK de duas tabelas de config. | Difícil | D-2, D-4 |
| **9 — Endurecimento** | Remover o fallback global de envio; FK real onde couber. | Difícil | D-7, Fase 2 |

**Nota:** as Fases 2 e 8 corrigem defeitos que **já existem hoje, sem nenhum seletor**. Se o
seletor for adiado, elas continuam valendo por si.

### Nota de entrega da Fase 2 (2026-08-11)

O plano original mandava "passar `instanceName` explícito nos 4 caminhos de §2.4". **Isso teria
sido insuficiente**, e a implementação divergiu do plano de propósito: o defeito não está nos
chamadores, está na CADEIA de resolução (§2.4). Mesmo quem já passava `instanceName` não tinha
o nome verificado — e os passos 2b (`ORDER BY atualizado_em`) e 3 (`EVOLUTION_INSTANCE`)
continuariam vivos para todo o resto do sistema. O que foi entregue:

- **regra ÚNICA** em `src/whatsapp.js` (`resolverInstanciaEnvio`) sobre vocabulário PURO em
  `src/services/instancia-envio.js`; os passos 2b e 3 **não existem mais**;
- **D-8 aplicado** (`db-crud.js` deixa de sobrescrever `evolution_instance`) — §2.5 resolvida;
- `services/conversa-manual.js` passou a **consumir** a regra em vez de duplicá-la;
- chamadores cobertos além dos 4 previstos: handoff/alertas ao operador, comandos do operador
  no WhatsApp, download de mídia, rotas legadas `/dashboard/whatsapp/*` e os diagnósticos que
  dependiam do fallback global (`verificarStatusInstanciaEvolution`, `numerosSemWhatsapp`);
- **D-7 antecipada**: o env `EVOLUTION_INSTANCE` está aposentado. O plano recomendava removê-lo
  "só depois da Fase 2" — como esta entrega fechou todos os chamadores de uma vez, mantê-lo
  seria manter o próprio defeito de pé.

O contrato completo, incluindo as consequências aceitas (o que **deixa de ser enviado**), está
em `AGENTS.md` → "Instância de ENVIO — regra ÚNICA, sem fallback (Fase 2)".

---

## 10. Fora de escopo / o que NÃO recomendo

- **Duplicar leads, prospects ou perfis por instância.** `UNIQUE (empresa_id, place_id)`
  (005:60) e `lead_profiles.numero` UNIQUE existem para impedir exatamente isso.
- **Tornar `instancia_id` NOT NULL em qualquer tabela existente.** O histórico ficaria sem
  dono e o boot quebraria — a mesma razão pela qual `lead_profiles.empresa_id` não virou
  NOT NULL na migration 058.
- **Criar um segundo seletor/painel por tela.** O projeto já pagou esse preço com a bolinha de
  pontuação (3 implementações) e com o painel de conversa (2 experiências). Dono único.
- **Usar `evolution_instance` (TEXT) como chave nova.** Nome é renomeável e não tem FK (§5.7).
- **Escopar Relatórios por instância obrigatoriamente.** A empresa precisa somar tudo; a
  instância é dimensão de recorte.

---

## 11. Lacunas declaradas desta análise

1. **Não medi produção.** Não sei quantas empresas já têm >1 instância ativa, nem quantas
   conversas estão com `evolution_instance` nulo. É a Fase 0 e muda a prioridade do plano.
2. **Canal Freelandoo pouco analisado.** Vive na mesma tabela (`config_json.canal`), então
   herda o escopo — mas o transporte é outro (`freelandoo/responder.js`) e não foi auditado
   caminho a caminho.
3. **Dashboard legado (`backend/public/`)** e as rotas `/dashboard/*` não foram avaliados;
   usam `EVOLUTION_INSTANCE` direto (`whatsapp-routes.js`).
4. **Não avaliei impacto visual/UX** (Fase 5 do workflow): onde exatamente o seletor entra no
   `layout.tsx`, que hoje não tem header global. Exige consulta a
   [ui-visual-standard.md](ui-visual-standard.md) quando houver implementação.

---

## 12. Validações executadas

Nenhuma **nesta análise** — ela não alterou código. A **Fase 2**, entregue em 2026-08-11 a
partir dela, rodou `npm test` (1503/1503) e `npm run typecheck` (limpo) no `backend/`.
