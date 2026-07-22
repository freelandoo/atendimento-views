# Registro de decisões técnicas da IA

Registro das decisões técnicas e arquiteturais relevantes tomadas ao longo do projeto
(Fase 8 do [workflow padrão](ai-workflow.md)). Objetivo: evitar que decisões fiquem só no
chat e se percam, e que a próxima IA redescubra tudo do zero. Entradas em ordem
cronológica inversa (mais recente no topo).

> Registre aqui: nova tabela/campo/migration, novo módulo, nova dependência, mudança de
> arquitetura de pastas/rotas/services/APIs, refatoração grande, mudança em
> financeiro/assinatura/dashboard/permissão/integração, ou criação de um novo padrão visual.

---

## 2026-07-05 — Banco de Leads: UX de disparo (cooldown, agendados, conversa, personalização)

- **Cooldown centralizado e reutilizado:** o cronômetro do Manual e do Semi consome o MESMO
  `estadoThrottle`/`COOLDOWN_MIN` via `GET /banco-leads/cooldown` — nenhuma regra nova. Bloqueio
  client-side usa o valor do servidor; o backend continua sendo a fonte da verdade (429).
- **Instância única no Automático:** removido o campo `auto_instancia_id` duplicado da UI; o seletor
  principal da barra sincroniza `auto_instancia_id`. Sem mudança de schema.
- **Telefone → conversa:** novo `ConversaHistoricoModal` (somente leitura) reusa `GET /conversas/:numero`
  (JID `<digits>@s.whatsapp.net`), sem recriar a lógica da página de Conversas.
- **Aba "Agendados":** join cross-schema por telefone (só dígitos) entre `prospectador.prospects` e
  `app.agenda_eventos` (multiempresa, migration 011). Escolhida a tabela multiempresa (tem
  `lead_telefone`+`data_inicio`+índices) em vez da legada `vendas.agenda_eventos`. Ordena por
  `data_inicio` futuro mais próximo. Subquery correlacionada (leads limitados a 300 → custo ok).
- **Personalização enxuta:** filtros client-side (nicho/mensagem gerada) + priorizar agendados sobre a
  tabela existente. Column-visibility completa ficou como melhoria futura (evitar reescrever as tabelas).
- **Como validar:** `npm test` (825 ok), typecheck front/back, smoke (`/cooldown`, aba agendados,
  resumo com badge agendados, telefone abre modal, compila HTTP 200).

---

## 2026-07-05 — Endurecimento do fluxo do Banco de Leads (IA obrigatória, descartados, correções)

- **IA obrigatória:** com `gerar_ia` ligado a mensagem é sempre da IA; se falhar (após retries
  `SAUDACAO_IA_RETRIES`), marca **erro no status** (`erro_ia` no Semi com "Gerar de novo";
  `falhou/ia_falhou` no Manual/Auto, sem enviar) — **acabou o fallback silencioso pro template**.
- **Descartados:** nova aba com `status IN ('rejeitado','nao_contatar')` OU `tem_whatsapp=false`,
  com motivo claro; sem-WhatsApp sai de "Sem contato". Contagem por aba precisa (FILTER).
- **Automático — instância configurável** (`auto_instancia_id`, migration `023`); worker recua o
  próximo disparo em erro (back-off) evitando loop de 60s.
- **Teto unificado:** disparo usa `banco_leads_config.teto_diario` (100), não mais o env 40
  (que virou fallback) — corrige o Auto que travava em 40.
- **Escopo por instância:** GET /leads recebe `instancia_id` e só mostra o rascunho da instância
  selecionada; disparo unitário dá feedback honesto quando não há nada a enviar.
- **Impacto:** migrations 021/022/023; back-end (rodar-leads, saudacao-analise, banco-leads-auto,
  api-banco-leads, config); front-end (aba, erro/retry, seletor de instância). Reversível.
- **Como validar:** `npm test` (823 ok), typecheck front/back, smoke (resumo com descartados,
  aba descartados, PUT config com auto_instancia_id).

---

## 2026-07-04 — Disparo centralizado no Banco de Leads (Aquisição vira só busca)

- **Decisão:** A Aquisição (Google Places) deixa de disparar mensagens; passa a apenas
  **alimentar o Banco de Leads** (busca). Todo envio de WhatsApp fica no Banco de Leads.
- **Motivo:** Evitar dois motores de disparo concorrentes (o antigo diário da prospecção e o
  novo do Banco de Leads) — um só lugar de envio, mais previsível e sem duplicar mensagens.
- **Escolha:** Remover a chamada `verificarAgendaDiariaProspeccao()` do tick (`agent.js`) e o
  bloco de disparo da UI. **Não** apagar a função nem as rotas (mantidas p/ acionamento
  manual/legado) — mudança mínima e reversível. Busca agendada mantida.
- **Impacto:** back-end (1 chamada removida do tick); front-end (bloco de disparo removido,
  "Quantidade por busca" adicionado). Sem migration.
- **Riscos:** empresas que dependiam do disparo automático da prospecção param de enviar por
  ali — passam a usar o Banco de Leads. Reversível (readicionar a chamada no tick).
- **Como validar:** `npm test` (823 ok), typecheck front, página Aquisição sem controles de
  envio, worker de busca agendada segue no tick.

---

## 2026-07-04 — Banco de Leads Fase 2 (worker Automático) + selo de WhatsApp por lead

- **Decisão:** Implementar o worker do modo Automático e um selo `tem_whatsapp` por lead.
- **Worker (reuso máximo):** `src/services/banco-leads-auto.js` **não reimplementa envio/
  throttle** — a cada tick (`BANCO_LEADS_AUTO_WORKER_MS`) escolhe empresa/janela/lead e chama
  `rodarLeads` para 1 lead, herdando elegibilidade, teto, cooldown (15 min ≤ intervalo) e
  geração IA. Próximo disparo sorteado em `intervalo_min..max` e persistido em
  `auto_proximo_disparo_em` (migration `022`). Instância = a ativa mais recente da empresa.
- **Selo WhatsApp:** coluna `prospects.tem_whatsapp` (migration `021`), aprendida do resultado
  do disparo — reusa `classificarErroEvolution` (`tipo:'numero_inexistente'` ⇒ `false`; envio
  ok ⇒ `true`). Lead `false` sai da elegibilidade (não reabordar) e ganha rótulo "sem WhatsApp";
  `true` ganha ícone verde. Evita verificação extra na Evolution (custo zero adicional).
- **Alternativas:** verificar número via `chat/whatsappNumbers` antes de enviar (descartado:
  chamada extra por lead) vs aprender do envio (escolhido, sem custo).
- **Impacto:** banco (2 colunas via migrations 021/022); back-end (worker + config estendida +
  `rodar-leads` grava `tem_whatsapp`); front-end (config do Auto, coluna telefone com selo).
- **Riscos:** worker dispara sozinho quando `auto_ativo` — kill-switch é o próprio toggle; teto
  100 + janela + intervalo limitam volume. Em teste local, manter em Manual.
- **Como validar:** `npm test` (823 ok, inclui `banco-leads-auto.test.js`), typecheck, smoke
  do PUT `/config` com campos do Auto (janela/intervalo persistem, clamp 15–30, teto fixo 100).

---

## 2026-07-04 — Banco de Leads: modos de disparo Manual / Semi / Automático (Fase 1)

- **Decisão:** Transformar o Banco de Leads em central de disparo com 3 modos, começando
  por Manual + Semiautomático (Automático fica para a Fase 2).
- **Motivo:** Dar controle de cadência ao operador (enviar na hora, ou gerar por IA e
  disparar depois) reusando o motor de saudação existente.
- **Alternativas consideradas:** (a) reusar o motor de modos da Prospecção/Places
  (`prospeccao_configuracoes`); (b) config por instância; (c) config por empresa.
- **Escolha:** **config por empresa** em `app.banco_leads_config` (migration `020`), tabela
  nova e isolada — **não** reusar o motor do Places (evita acoplar dois produtos). Geração
  por IA num serviço novo `saudacao-analise.js` (desenho da spec `2026-07-03`), sempre com
  fallback pro template. Estado novo `lead_disparos.status='aguardando_disparo'` para o Semi
  (coluna `status` é TEXT sem CHECK → sem alteração de constraint).
- **Números do Automático:** teto **100/dia é só limite de segurança**; volume real é
  limitado pelo intervalo 15–30 min × janela. Campos do Auto criados já na migration 020
  (inertes até o worker da Fase 2).
- **Cadência de disparo:** cooldown de **15 min por instância em qualquer disparo** (manual
  ou dos gerados) — antes disso a rota retorna 429 com aviso. Decisão do Alex: bloquear +
  alertar em qualquer disparo (não só em lote). `RODAR_LEADS_COOLDOWN_MIN` default 5 → **15**.
- **Impacto:** banco (1 tabela + 1 índice parcial); back-end (`rodar-leads.js`,
  `api-banco-leads.js`, `db/banco-leads-config.js`, `saudacao-analise.js`); front-end
  (`banco-leads/page.tsx`); custo (+1 chamada IA por lead gerado, com kill-switch `gerar_ia`).
- **Riscos:** custo/latência da geração por IA (mitigado por fallback + timeout
  `SAUDACAO_IA_TIMEOUT_MS`); Automático ainda não dispara nada (worker pendente).
- **Como validar:** `npm test` (815 ok, inclui `saudacao-analise.test.js` e novos casos em
  `rodar-leads.test.js`), `npm run typecheck` (back + front), smoke dos endpoints
  `/config`, `/gerar`, `/disparar-gerados`.

---

## 2026-07-04 — Adoção do Workflow Padrão de IA v2.0

- **Decisão:** Formalizar os documentos de governança de workflow no repositório
  (`ai-workflow.md`, `ai-task-start-log.md`, `ai-decision-log.md`, `project-change-map.md`,
  `ui-visual-standard.md`, `project-architecture.md`).
- **Motivo:** Garantir que toda IA siga um processo padrão (Fase 0 → 11) com registro
  formal, verificação visual/UX e confirmação de arquitetura.
- **Alternativas consideradas:** (a) manter só AGENTS.md/CLAUDE.md; (b) duplicar o conteúdo
  visual e de arquitetura nos novos arquivos.
- **Escolha:** `ui-visual-standard.md` e `project-architecture.md` **referenciam** os
  documentos canônicos já existentes (`GUIA-VISUAL-PJ-CODEWORKS.md`, `project-map.md`,
  `architecture-rules.md`) em vez de duplicar, respeitando a regra "não duplicar".
- **Impacto:** Apenas documentação; nenhum código de produção alterado.
- **Riscos:** Baixo. Manter os arquivos em sincronia quando a arquitetura/visual evoluir.
- **Como validar:** Leitura dos arquivos; próxima tarefa deve começar pela Fase 0.

---

<!-- Modelo para novas entradas:

## [DATA] — [Título curto da decisão]

- **Decisão:**
- **Motivo:**
- **Alternativas consideradas:**
- **Escolha:**
- **Impacto:** (banco / back-end / front-end / financeiro / dashboards / permissões / manutenção futura)
- **Riscos:**
- **Como validar:**

-->

---

## 2026-07-15 - Performance do Banco de Leads, Evolution e pool PostgreSQL

- **Decisao:** Consolidar os metadados do `GET /leads` em `LEFT JOIN LATERAL`, executar
  os status da Evolution em paralelo com cache de 20 segundos por empresa, criar indices
  parciais para os caminhos quentes e elevar o pool padrao de 2 para 4 conexoes.
- **Motivo:** Reduzir scans repetidos por lead, latencia serial da Sidebar e contencao entre
  dashboard, webhooks e workers sem alterar contratos HTTP ou regras de negocio.
- **Alternativas consideradas:** manter subqueries separadas; cachear status por instancia;
  apenas aumentar o pool; criar um indice completo sem predicado parcial.
- **Escolha:** tres laterais especializados (ultimo disparo, rascunho e agenda), cache curto
  com coalescencia de requisicoes simultaneas, migration `025` aditiva e telemetria de
  `pool.waitingCount`. O pool continua configuravel por `POOL_MAX` para multi-replica.
- **Impacto:** back-end e banco; sem mudanca visual, de permissao, prompts ou payloads.
- **Riscos:** cache pode refletir estado da Evolution com ate 20 segundos de atraso; em
  multi-replica, a soma de `POOL_MAX` deve respeitar o limite total do PostgreSQL.
- **Como validar:** testes unitarios de paralelismo/cache, `npm test`, `npm run typecheck`,
  migration executada no PostgreSQL local e `EXPLAIN (ANALYZE, BUFFERS)`.

---

## 2026-07-15 - Seguranca de disparo Manual, Semi e Automatico

- **Decisao:** Tornar a reserva de um lead uma invariante do PostgreSQL, serializar
  cooldown/teto por instancia e considerar entrega concluida somente em
  `DELIVERY_ACK`, `READ` ou `PLAYED`.
- **Motivo:** Impedir mensagem e chamada de IA duplicadas entre abas, ticks e replicas,
  sem manter transacao aberta durante chamadas lentas de IA ou Evolution.
- **Alternativas consideradas:** lock apenas em memoria; advisory lock durante todo o
  envio; confiar apenas no cooldown; tratar `SERVER_ACK` como sucesso.
- **Escolha:** migration `026` com indice parcial unico por `prospect_id`; transacoes
  curtas com `FOR UPDATE` da instancia; estados `gerando` e `pendente_confirmacao`;
  reconciliacao pelo `MessageUpdate`; lease renovavel em `vendas.watcher_locks` para o
  worker; reuso de `canProspectLead` no modo `complianceOnly` e fuso via `Intl`.
- **Impacto:** banco, worker, integracao Evolution, elegibilidade e texto/default do teto.
  O teto fixo volta de 100 para 40, incluindo backfill dos registros com o default antigo.
- **Riscos:** um envio sem `evolution_message_id` apos interrupcao fica pendente para
  revisao, por seguranca, em vez de ser reenviado automaticamente.
- **Como validar:** testes de reserva concorrente, opt-out, WhatsApp falso, `SERVER_ACK`,
  reconciliacao terminal, timezone e reentrancia; migration real e verificacao dos indices.

---

## 2026-07-17 - Busca automática independente e teto de 200 na Aquisição

- **Decisão:** Fazer a agenda de busca depender exclusivamente de `agendamento_busca_ativo` e
  aplicar no backend o teto fixo de 200 resultados importados por snapshot do Google Maps.
- **Motivo:** O campo `ativo` pertence à rotina legada de disparo e não existe mais na interface
  da Aquisição; reutilizá-lo deixava a tela indicar agenda ativa enquanto o worker ficava parado.
- **Alternativas consideradas:** religar `ativo=true` ocultamente no frontend; remover o gate sem
  separar responsabilidades; adicionar migration para armazenar quantidade variável por snapshot.
- **Escolha:** flag próprio da busca + constante de domínio no adapter Bright Data; sem migration.
  A UI reaproveita o padrão operacional do Banco de Leads em seções inline, sem modal ou ações duplicadas.
- **Impacto:** backend, worker, custo/volume importado e frontend Google Maps/Instagram; nenhuma
  alteração em autenticação, secrets, prompts ou envio de WhatsApp.
- **Riscos:** o modo Discover da Bright Data pode produzir mais de 200 registros antes do download;
  o aplicativo importa apenas 200, mas a cobrança externa deve ser acompanhada no painel do provedor.
- **Como validar:** testes do teto 306→200, scheduler com `ativo=false`, typecheck e inspeção visual local.

---

## 2026-07-17 - Busca IA configurável com limites de custo e estados operacionais

- **Decisão:** Substituir a automação implícita por três modos explícitos (`manual`,
  `automatico_fixo`, `ia`) e persistir preferências e estado operacional por empresa.
- **Motivo:** Tornar o comportamento compreensível para o operador, impedir buscas concorrentes
  e permitir que a IA troque de mercado sem esconder custo, limite ou motivo da decisão.
- **Alternativas consideradas:** manter um único toggle; guardar preferências apenas no frontend;
  deixar a IA escolher sem listas; criar campanhas separadas para cada mercado.
- **Escolha:** migration `027`; intervalo mínimo de 6 horas; máximo configurável de 1 ou 2
  buscas/dia; uma coleta ativa; estratégias conservadora/equilibrada/exploratória; listas
  opcionais de nichos e regiões; dois resultados sem leads novos esgotam o modo fixo e fazem
  a IA escolher outro mercado. Falha do seletor pausa o ciclo e expõe uma mensagem acionável.
- **Impacto:** banco, seletor LLM, scheduler, worker de snapshots, API e menu inline da Aquisição.
  Sem mudança em autenticação, segredos, prompts de produção ou envio de WhatsApp.
- **Riscos:** o controle de concorrência consulta snapshots ativos e pressupõe uma réplica do
  worker; um provedor pode cobrar registros além dos 200 importados pelo aplicativo.
- **Como validar:** migration real, testes puros de agenda/resultado, suíte completa, typecheck,
  contrato HTTP autenticado e inspeção visual desktop/mobile sem disparar coleta.

---

## 2026-07-20 - Central de Follow-ups com pausa forte e registro consistente

- **Decisao:** Tratar `app.followup_config.pausado` como bloqueio efetivo do modo Automatico tanto no watcher quanto no executor de jobs ja enfileirados; restringir o envio complementar pos-ligacao ao resultado `nao_atendeu`; registrar `sem_interesse` e a pausa do lead em uma unica operacao SQL.
- **Motivo:** Evitar envio depois de uma pausa administrativa, combinacoes comerciais contraditorias e estado parcial entre historico da ligacao e opt-out do lead.
- **Alternativas consideradas:** cancelar definitivamente todos os jobs ao pausar; validar apenas no frontend; manter INSERT e UPDATE em queries separadas; abrir transacao explicita na rota.
- **Escolha:** O job pausado volta para `pending` com atraso de cinco minutos e sem consumir tentativa; backend e banco protegem as invariantes; uma CTE modificadora mantem o registro atomico sem transacao longa.
- **Impacto:** back-end, worker, banco, tela de Follow-ups e metricas de IA por tenant; sem nova dependencia, segredo ou prompt.
- **Riscos:** jobs pausados continuam visiveis como pendentes e sao revisitados periodicamente; a migration `031` exige que `029/030` tenham sido executadas antes, como ja ocorre pela ordem do migrador.
- **Como validar:** testes focados de rotas, ligacoes, watcher e ai-provider; `npm test`; typecheck de backend/frontend; aplicacao das migrations e boot local.

---

## 2026-07-20 - Atendimento humano com proxima acao deterministica

- **Decisao:** Renomear o modo Semi para Atendimento humano e recomendar uma unica proxima acao por lead: assumir handoff, ligar, revisar proposta, escrever manualmente ou copiar um prompt de preview para uso externo.
- **Motivo:** Ligacao e apenas um dos caminhos humanos. Handoff, contexto comercial, tentativas ignoradas, proposta e oportunidade visual pedem orientacoes diferentes e uma janela adequada.
- **Alternativas consideradas:** manter apenas score de ligacao; deixar a IA escolher toda acao; gerar o preview dentro do produto.
- **Escolha:** Regras deterministicas e auditaveis no backend, com prioridade explicita. A IA permanece no roteiro de ligacao. Preview nao e gerado nem enviado: o operador apenas copia um prompt contextualizado, gera fora do projeto e revisa o resultado.
- **Impacto:** servicos `followup-call-score`/`followup-listing`, contrato de leitura da rota existente, tela e testes; sem banco, auth, segredo, integracao externa ou prompt de producao.
- **Riscos:** a qualidade da recomendacao depende dos sinais ja coletados no perfil; por seguranca, o prompt proibe inventar dados comerciais e exige contexto minimo antes de aparecer.
- **Como validar:** testes unitarios das prioridades e janelas, teste da listagem/SQL, consulta read-only ao banco, suite completa, typechecks e verificacao das rotas em execucao.

---

## 2026-07-20 - Resolver MessageUpdate pelo schema real da Evolution

- **Decisao:** Detectar por `to_regclass` se a tabela `MessageUpdate` esta em `evolution`
  ou `public` antes da checagem e reconciliacao dos disparos.
- **Motivo:** O Railway usa o schema `evolution`, enquanto o Docker local existente configura
  a Evolution com `schema=public`; o nome hardcoded em `public` abortava todos os ticks.
- **Alternativas consideradas:** fixar `evolution` e quebrar o ambiente local; criar nova
  variavel de ambiente; criar view/migration de compatibilidade; consultar schemas arbitrarios.
- **Escolha:** Resolver somente os dois schemas conhecidos e retornar nomes de tabela hardcoded,
  sem interpolar entrada externa nem introduzir configuracao operacional.
- **Impacto:** leitura da integracao Evolution e worker do Banco de Leads; nenhum impacto em
  banco/schema, auth, segredos, prompts, frontend ou contratos HTTP.
- **Riscos:** se a Evolution mudar para um terceiro schema, a aplicacao falhara explicitamente
  com `evolution_message_update_missing` em vez de ignorar confirmacoes.
- **Como validar:** cobertura dos schemas `public`/`evolution`, ausencia dos dois, suite
  completa, typecheck, deploy Railway e tick real sem `tick falhou`.

---

## 2026-07-22 - Catalogo estruturado de servicos por contexto

- **Decisao:** Criar `app.contexto_servicos` como fonte estruturada e editavel de ofertas por
  contexto, preenchida pelo `Gerar tudo` antes do playbook e injetada em `playbook.servicos`.
- **Motivo:** O campo textual `servicos_produtos` e o array livre do playbook nao davam garantia
  de separacao correta entre ofertas distintas. Sites que citam SEO, criacao de site e sistemas
  precisam virar tres itens rastreaveis, preenchiveis e revisaveis.
- **Alternativas consideradas:** guardar tudo dentro de `contexto_form_json`; confiar apenas no
  prompt do playbook; adiar a decisao de oferta por lead para uma fase separada.
- **Escolha:** Tabela aditiva com `slug` unico por contexto, status de revisao, confianca,
  fontes/conflitos em JSONB e merge que preserva item revisado. O runtime tambem passa a registrar
  `servicos_interesse_slugs`, ultimo servico recomendado/oferecido e eventos em
  `app.lead_servico_decisoes`.
- **Impacto:** banco, pipeline de IA, rotas autenticadas de contexto, editor Next.js e testes.
  Sem nova dependencia, segredo, permissao ou envio automatico.
- **Riscos:** a qualidade inicial depende da extracao das fontes; lacunas ficam visiveis como
  `precisa_revisao` em vez de serem inventadas.
- **Como validar:** testes de separacao de catalogo e injecao no playbook, suite completa,
  typechecks de backend/frontend e validacao visual do editor apos login.

## 2026-07-22 - Rastreio de decisao de servico no Contexto 2 runtime

- **Decisao:** Estender o runtime do playbook para pedir slugs canonicos de servico e gravar a
  trilha de `interesse_detectado`, `recomendado` e `oferecido`.
- **Motivo:** Sem slug persistido, a IA ate poderia citar um servico na mensagem, mas o operador
  nao conseguiria auditar depois qual oferta ela escolheu nem correlacionar esse dado por lead.
- **Escolha:** Campos aditivos em `app.lead_insights` para snapshot atual e tabela append-only
  `app.lead_servico_decisoes` para historico. O responder tambem persiste `decisao.atualizar_perfil`
  geral, incluindo `produto_sugerido`.
- **Impacto:** migration `034`, `contexto2-runtime.js`, `contexto2-responder.js` e testes.
- **Riscos:** catalogos antigos sem slug/id ainda funcionam por normalizacao textual, mas a
  confianca operacional melhora quando o catalogo foi gerado/revisado pelo fluxo novo.
- **Como validar:** testes focados de normalizacao, registro de decisao e persistencia de perfil,
  depois suite completa e typecheck do backend.
