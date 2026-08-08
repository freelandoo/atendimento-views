# Mapa de áreas alteradas e regras a preservar

Mapa das áreas do sistema tocadas pela IA e das regras que **precisam ser preservadas**
em cada uma (Fase 7 do [workflow padrão](ai-workflow.md)). Consulte antes de alterar uma
área para não quebrar regra de negócio já estabelecida. Para o mapa físico de pastas, veja
[project-map.md](project-map.md); para regras técnicas, [architecture-rules.md](architecture-rules.md).

## Áreas do sistema e regras invioláveis

### Conversa / funil / agente (LLM)
- **Arquivos:** `backend/src/agent*.js`, `core-funnel.js`, `conversation-pipeline.js`,
  `prompts/system-*.md`.
- **Regras a preservar:** parsing das respostas LLM, etapas do funil, limites de mensagens.
  Alterar `prompts/*.md` afeta produção — justifique o impacto. Cobertura em `test/core.test.js`.

### Prospecção / captação
- **Arquivos:** `backend/src/prospecting.js`, `src/services/prospecting-*.js`,
  `social-capture.js`, `rodar-leads.js`, seletor de mercado por IA.
- **Regras a preservar:** teto diário, cooldown, elegibilidade/temperatura, idempotência da
  fila (`captacao_snapshots`), trava de 15 dias (`lead-lock.js`). Não iniciar conversas fora
  das regras de disparo.

### Classificação de site próprio (transversal)
- **Arquivos:** `backend/src/services/site-classificacao.js` (**fonte de verdade única**),
  `scripts/reclassificar-sites.js`, `sql/migrations/056_site_classificacao.sql`,
  `frontend/lib/site-rotulos.js`.
- **Regras a preservar:**
  - `tem_site = true` **somente** para site próprio em domínio independente. Rede social,
    agregador, mapa, marketplace, diretório e perfil ⇒ `false`. Link duvidoso (encurtador,
    subdomínio de construtor) ⇒ `desconhecido`, **nunca** promovido a site próprio.
  - **Nunca** escrever `!!(lead.site || lead.tem_site)` de novo — foi essa equivalência,
    repetida em 7 lugares, que causou o defeito. Todo produtor e todo consumidor chama
    `classificarUrl` / `classificarLead` / `temSiteProprio` / `situacaoSiteDoLead`.
  - A coluna `site` significa **exclusivamente** site próprio; o link cru vive em
    `link_original` e nunca é apagado. `classificacao_url` guarda a categoria.
  - A autoridade é a função na **leitura**; as colunas são cache. Não inverter isso.
  - O `tem_site` **conversacional** (o que o lead declara no WhatsApp — `agent.js`,
    `turn-context-reader.js`, `prompts/*.md`, `vendas.lead_profiles`) é outro domínio e
    **não** passa pelo classificador de URL.
  - `npm run reclassificar:sites` simula por padrão; só grava com `--aplicar`. É idempotente
    e não faz nenhuma chamada externa/paga.
- **Cobertura:** `test/site-classificacao.test.js` (unitários + integração entre consumidores),
  `test/reclassificar-sites.test.js` (idempotência e preservação do link).

### Banco de dados
- **Arquivos:** `backend/src/db.js`, `db-crud.js`, `sql/init.sql`, `sql/migrations/*`.
- **Regras a preservar:** migrations aplicadas no boot; isolamento por tenant (`empresa_id`).
  Nenhuma migration/campo novo sem justificativa e confirmação.

### Autenticação / multiempresa (SaaS)
- **Arquivos:** `backend/src/auth.js`, `src/middleware/tenant.js`, `dashboardAuth.js`, rotas `api-*.js`.
- **Regras a preservar:** JWT, `requireAuth`/`requireEmpresaAccess`, isolamento de tenant.
  Nunca remover proteção de rotas internas/admin. Regra sensível não fica só no front-end.

### Integrações externas
- **Arquivos:** `ai-provider.js`, `whatsapp.js` (Evolution), `agenda.js`, canal Freelandoo
  (`src/freelandoo/*`), Meta CTWA (`meta-attribution.js`), Bright Data.
- **Regras a preservar:** segredos só no back-end; tokens nunca logados; validação HMAC do
  webhook Freelandoo; eventos CTWA restritos a `LeadSubmitted`/`Purchase`.

### Precificação
- **Arquivos:** `backend/src/pricing.js` (+ `npm run smoke:preco`).
- **Regras a preservar:** cálculo protegido no back-end. Rodar smoke ao tocar aqui.

### Front-end (Next.js) e dashboard estático
- **Arquivos:** `frontend/` (App Router) e `backend/public/` (dashboard estático).
- **Regras a preservar:** padrão visual PJ (ver [ui-visual-standard.md](ui-visual-standard.md));
  nenhuma lógica crítica/segredo no front. Reaproveitar componentes/tokens existentes.

## Histórico de áreas alteradas

<!-- Registre aqui, quando uma tarefa tocar uma área, o que foi preservado / o que mudou:

## [DATA] — [Área] — [Tarefa]
- Área(s) tocada(s):
- Regras preservadas:
- O que mudou:
- Documentos atualizados:

-->

## 2026-08-07 — Front (Aquisição) — Tela dividida em dois modos: Busca e Rotinas
- Área(s) tocada(s): Front (`app/dashboard/prospeccao/page.tsx`,
  `components/RotinasAquisicao.tsx`, `components/HistoricoColetas.tsx` — só comentário,
  `app/globals.css` — classe `.painel-troca`). **Backend: nada. Banco: nada. Env: nada.**
- Regras preservadas: **nenhuma chamada nova ao backend e nenhuma coleta paga disparada por
  alternar o modo** (nem `carregar`, nem `carregarBuscas`, nem o painel de rotinas dependem de
  `modo`); a trava de uma coleta por empresa segue no banco; "buscar não analisa, analisar não
  busca"; o `RotinasAquisicao` continua sendo o único caminho de disparo (`dispararBusca`);
  reuso do `components/ui/Abas.tsx` — nenhum toggle novo foi criado.
- O que mudou: a Aquisição passou a ter um controle segmentado no topo. **Busca** = busca avulsa,
  status da coleta, tabela de leads e "Acompanhar resultados". **Rotinas** = painel de rotinas +
  histórico de coletas (que saiu da aba de "Acompanhar resultados", por ser execução de rotina e
  não revisão de lead). O `RotinasAquisicao` recebe `modo` e fica **sempre montado** — é o que
  preserva o formulário da busca ao alternar. O bloco de `erro` saiu de dentro do card de rotinas
  (no modo Busca ele ficaria invisível). Modo persistido em `sessionStorage` + `?modo=`.
- Documentos atualizados: `ai-task-start-log.md`, `ai-decision-log.md`, este arquivo, `AGENTS.md`.

## 2026-08-05 — Aquisição + Front — Menu guiado de entrada do Assistente de Oportunidades
- Área(s) tocada(s): Front (`components/AssistenteEntrada.tsx` novo,
  `lib/assistente-entrada.js`/`.d.ts`/`.test.js` novos, `components/RotinasAquisicao.tsx`),
  SaaS/rotas (`api-aquisicao-curadoria.js`: `GET /resumo`), Prospecção
  (`services/aquisicao-curadoria.js`: `resumoSessao`). **Banco: nada** — sem migration.
- Regras preservadas: pipeline de coleta intocado; `AssistenteOportunidades.tsx` e todo o motor
  de sessão/claim/aprendizado **inalterados**; a Busca avulsa e o botão "Buscar agora" continuam
  sendo um fluxo independente; rota admin-only + `requireEmpresaAccess`; a trava de uma coleta
  paga por empresa continua no banco (o modal só a espelha); nenhuma env nova.
- O que mudou: o botão premium deixou de cair direto na sessão — abre um menu curto de dois
  caminhos. "Revisar" leva ao fluxo de aprovar/descartar de sempre; "Encontrar novas
  oportunidades" pergunta o que mudar (nicho / localidade / ambos), preserva o resto do contexto e
  dispara a MESMA busca da Busca avulsa, sem criar nem alterar sessão. Havendo sessão ativa, o
  menu mostra o mercado e o progresso reais dela em vez de sugerir que o mercado digitado vale.
  Novo `GET .../curadoria/resumo` para o menu não pagar uma chamada de IA por abertura.
- Documentos atualizados: `AGENTS.md`, `docs/ai-decision-log.md`, `docs/ai-task-start-log.md`,
  este mapa.

## 2026-08-04 — Aquisição + Banco + Front — Assistente de Oportunidades por LEAD na Busca avulsa
- Área(s) tocada(s): Banco (migration ADITIVA `055` → `prospectador.curadoria_sessoes` +
  `curadoria_decisoes`), SaaS/rotas (`api-aquisicao-curadoria.js`, montada admin-only ANTES de
  `/prospeccao`), Prospecção (services `aquisicao-curadoria.js` + `aquisicao-curadoria-ranking.js`,
  db `aquisicao-curadoria.js`), Front (`AssistenteOportunidades.tsx` reescrito,
  `RotinasAquisicao.tsx`, `dashboard/prospeccao/page.tsx`, `ui/icons.tsx`).
- Regras preservadas: **o pipeline de coleta não foi tocado** — `pesquisarPlaces`,
  `processarBuscasPlacesPendentes`, `salvarProspects`, as Rotinas de Aquisição e a trava de
  "uma coleta paga por empresa" continuam idênticos. Nenhuma chamada paga à Bright Data neste
  módulo (coberto por espião nos testes). Isolamento por `empresa_id` em toda consulta; rota
  admin-only. Status de prospect segue o CHECK existente (`aprovado`/`rejeitado`) — sem
  status novo e sem coluna nova em `prospects`.
- O que mudou: a Busca avulsa ganhou o gatilho manual "Analisar oportunidades" (uma oportunidade
  por vez, com justificativa curta); a meta de leads novos conta CLAIM e não clique; decisões
  viram sinal de aprendizado da própria empresa. O campo "Máx. de leads a importar" virou
  "Máx. de leads novos" e serve aos dois botões. **Assistente por MERCADO saiu da tela** (código,
  tabela e rota preservados) e o formulário de critérios manuais deixou de ser exibido — os
  dados (`busca_estrategia`, nichos e regiões permitidos) continuam gravados.
- Documentos atualizados: `AGENTS.md`, `docs/ai-decision-log.md`, `docs/ai-task-start-log.md`,
  este mapa.

## 2026-07-05 — Banco de Leads — cooldown Manual+Semi, aba Agendados, telefone→conversa, personalização
- Área(s) tocada(s): SaaS/rotas (`api-banco-leads.js` — `/cooldown`, aba Agendados, resumo),
  Prospecção (`rodar-leads.js` — `estadoEnvioInstancia`), Front (`banco-leads/page.tsx` +
  novo `components/ConversaHistoricoModal.tsx`).
- Regras preservadas: cooldown ÚNICO em `estadoThrottle` (reusado, não duplicado); manual/auto
  intactos além do cooldown/instância; modal de conversa reusa `GET /conversas/:numero`.
- O que mudou: (1) instância única no Auto (fim do campo duplicado); (2) cronômetro/cooldown no
  Manual (antes só Semi); (3) Semi mantém cronômetro; (4) telefone clicável abre conversa; (5)
  aba "Agendados" (join por telefone com `app.agenda_eventos`, ordenado por proximidade); (6)
  "Personalizar" (filtros client-side + priorizar agendados). Sem migration nova.
- Documentos atualizados: `AGENTS.md`, [ai-decision-log.md](ai-decision-log.md).

## 2026-07-05 — Banco de Leads — IA obrigatória + Descartados + correções de fluxo
- Área(s) tocada(s): Prospecção (`rodar-leads.js`, `banco-leads-auto.js`, `saudacao-analise.js`),
  Banco (migrations `021`/`022`/`023`), SaaS/rotas (`api-banco-leads.js`, `banco-leads-config.js`),
  Front (`banco-leads/page.tsx`).
- Regras preservadas: throttle anti-ban (cooldown 15 min, jitter, teto), isolamento por tenant,
  IA/segredos no back-end.
- O que mudou: IA obrigatória com erro no status (sem fallback silencioso) + retries; aba
  Descartados com motivo (sem-WhatsApp/rejeitado/não-contatar); instância configurável no Auto;
  teto unificado no `banco_leads_config` (100); mensagem escopada por instância; back-off do worker.
- Documentos atualizados: `AGENTS.md`, `.env.example`, [ai-decision-log.md](ai-decision-log.md).

## 2026-07-04 — Prospecção + Front — Aquisição vira SÓ BUSCA (disparo automático removido)
- Área(s) tocada(s): worker (`agent.js` tick), Front (`dashboard/prospeccao/page.tsx`).
- Regras preservadas: a busca agendada (`verificarAgendaBuscaRecorrenteProspeccao`) e as rotas
  de fila/disparo continuam existindo (acionamento manual/legado). Nada removido do banco.
- O que mudou: `agent.js` não chama mais `verificarAgendaDiariaProspeccao` no tick (sem disparo
  automático na Aquisição). Front: removido o bloco "Disparo automático" (Modo/Gerar IA/Disparo
  real/Capacidade/Intervalo/Rotina ativa); adicionado "Quantidade por busca"; a página agora só
  busca e alimenta o Banco de Leads. Todo envio migrou para o Banco de Leads.
- Documentos atualizados: `AGENTS.md`, [ai-decision-log.md](ai-decision-log.md).

## 2026-07-04 — Prospecção + Front + Banco — Banco de Leads Fase 2 (Auto) + selo WhatsApp
- Área(s) tocada(s): Prospecção (`banco-leads-auto.js`, `rodar-leads.js`), Banco (migrations
  `021` `tem_whatsapp`, `022` `auto_proximo_disparo_em`), SaaS/rotas (`api-banco-leads.js`,
  `banco-leads-config.js`), boot (`index.js` — novo worker), Front (`banco-leads/page.tsx`).
- Regras preservadas: throttle anti-ban (cooldown 15 min, teto, jitter) — o worker Auto REUSA
  `rodarLeads` em vez de reimplementar; isolamento por tenant; segredos no back-end.
- O que mudou: worker do modo Automático (janela + intervalo 15–30 + teto 100 fixo, dispara 1
  lead por vez); selo `tem_whatsapp` aprendido no disparo (ícone verde / "sem WhatsApp" + sai
  da elegibilidade). PUT `/config` passou a repassar os campos do Auto (bug corrigido).
- Documentos atualizados: [ai-decision-log.md](ai-decision-log.md), `AGENTS.md`, `.env.example`.

## 2026-07-04 — Prospecção + Front + Banco — Banco de Leads: modos Manual/Semi/Auto (Fase 1)
- Área(s) tocada(s): Prospecção/captação (`rodar-leads.js`), Banco de dados (migration `020`),
  SaaS/rotas (`api-banco-leads.js`, `db/banco-leads-config.js`), Integração IA (`saudacao-analise.js`),
  Front-end (`banco-leads/page.tsx`).
- Regras preservadas: throttle anti-ban (teto diário, jitter entre envios da mesma rodada,
  trava de 15 dias do `lead-lock.js`); isolamento por tenant (`empresa_id`, `requireEmpresaAccess`);
  segredos/IA só no back-end; padrão visual PJ (reuso dos componentes/tabelas da Aquisição).
- O que mudou: nova config por empresa (`app.banco_leads_config`) com modo de disparo;
  modo **Semi** grava mensagem gerada como `lead_disparos.status='aguardando_disparo'` e
  dispara depois; geração da saudação por IA com fallback pro template; **cooldown de disparo
  passou de 5 → 15 min** (bloqueia + alerta em qualquer disparo). Modo **Automático** ainda
  não tem worker (Fase 2).
- Documentos atualizados: [ai-decision-log.md](ai-decision-log.md), `AGENTS.md`, `.env.example`,
  `ai-task-start-log.md`.

## 2026-07-15 - Banco de Leads + Evolution + Banco - Otimizacao de performance
- Area(s) tocada(s): rotas (`api-banco-leads.js`, `api-whatsapp.js`), pool (`db.js`),
  banco (migration `025`) e testes de performance do resumo de conexao.
- Regras preservadas: isolamento por `empresa_id`, contratos HTTP, estados dos disparos,
  elegibilidade do worker e integracao Evolution existente.
- O que mudou: seis subqueries de disparo viraram dois laterais; agenda usa um lateral
  agregado; status Evolution roda com `Promise.all` e cache de 20s; indices parciais
  atendem rascunhos, agenda normalizada e proximo lead; pool padrao passou a 4 e registra fila.
- Documentos atualizados: `ai-task-start-log.md`, `ai-decision-log.md`, este change map e
  `.env.example`.

## 2026-07-15 - Banco de Leads + Evolution + Banco - Seguranca dos modos de disparo
- Area(s) tocada(s): servico de disparo (`rodar-leads.js`), elegibilidade
  (`prospecting-eligibility.js`), worker (`banco-leads-auto.js`), banco (migration `026`),
  configuracao, tela do Banco de Leads e testes.
- Regras preservadas: isolamento por `empresa_id`, IA obrigatoria sem fallback silencioso,
  cooldown/jitter, chamadas externas fora de transacoes e historico de disparos.
- O que mudou: reserva ativa unica por lead; claim atomico e curto; filtro de
  `tem_whatsapp=false`; compliance oficial no caminho produtivo; sucesso apenas apos status
  terminal da Evolution; reconciliacao de pendencias; lock entre replicas e guarda local do
  tick; janela no `APP_TIMEZONE`; teto fixo e backfill de 40.
- Documentos atualizados: `AGENTS.md`, `ai-task-start-log.md`, `ai-decision-log.md` e este mapa.

## 2026-07-15 - Banco de Leads - Rolagem operacional das tabelas
- Area(s) tocada(s): frontend (`dashboard/banco-leads/page.tsx`).
- Regras preservadas: mesmas colunas, ordenacao, selecao, filtros, dados e padrao visual.
- O que mudou: barra horizontal sincronizada no topo das tabelas Places/Instagram; area de
  registros com altura responsiva; cabecalho fixo durante a rolagem vertical.
- Documentos atualizados: `ai-task-start-log.md` e este mapa.

## 2026-07-04 — Documentação — Adoção do Workflow Padrão v2.0
- Área(s) tocada(s): apenas `docs/` (governança). Nenhum código de produção.
- Regras preservadas: todas (nenhuma regra de negócio alterada).
- O que mudou: criados os 6 documentos de workflow.
- Documentos atualizados: ver [ai-decision-log.md](ai-decision-log.md).

## 2026-07-16 - Banco de Leads - Geracao Semi em segundo plano com progresso
- Area(s) tocada(s): rota de leitura (`api-banco-leads.js`), tela do Banco de Leads e
  teste do worker (`banco-leads-auto.test.js`).
- Regras preservadas: worker existente, isolamento por `empresa_id`, geracao em lotes de
  ate 15, IA obrigatoria sem fallback silencioso e disparo somente por acao do operador.
- O que mudou: a tela nao chama mais a geracao sincrona de ate 1.000 leads ao ativar o
  Semiautomatico ou trocar a instancia; o worker continua preparando a fila fora da tela e
  revisita leads novos a cada tick; um endpoint autenticado de leitura alimenta a barra de
  progresso a cada 3 segundos.
- Documentos atualizados: `ai-task-start-log.md` e este mapa.

## 2026-07-17 - Aquisição - teto 200, agenda rodável e menus inline
- Área(s) tocada(s): integração Bright Data Maps (`places-brightdata.js`), worker de busca
  (`prospecting.js`, `prospecting-search-scheduler.js`), rota SaaS e telas Google Maps/Instagram.
- Regras preservadas: Aquisição continua apenas buscando; envio de WhatsApp permanece no Banco
  de Leads; workers continuam independentes da tela; campanhas sociais existentes são reutilizadas.
- O que mudou: snapshots do Maps importam no máximo 200 resultados; a agenda usa somente seu
  próprio flag `agendamento_busca_ativo`, sem depender do campo legado de disparo; botões e modais
  duplicados de Agenda foram substituídos por uma seção operacional única em cada aba.
- Documentos atualizados: `AGENTS.md`, `ai-task-start-log.md`, `ai-decision-log.md` e este mapa.

## 2026-07-17 - Aquisição - Busca IA configurável e observável
- Área(s) tocada(s): configuração e migration (`027`), seletor de mercado, scheduler, worker de
  snapshots, rota SaaS, tela `dashboard/prospeccao` e testes de domínio.
- Regras preservadas: isolamento por `empresa_id`, teto fixo de 200 importados, execução fora da
  tela, busca separada do envio e autorização existente nas rotas.
- O que mudou: modos Manual/Automático fixo/Busca IA; estratégia e preferências simples; limite
  de 1 ou 2 buscas/dia; intervalo mínimo de 6 horas; uma coleta ativa; contagem de leads realmente
  novos e estados claros de aguardando, coletando, esgotado, sem mercados, limite e erro.
- Documentos atualizados: `AGENTS.md`, `ai-task-start-log.md`, `ai-decision-log.md`,
  `project-architecture.md` e este mapa.

## 2026-07-17 - Banco de Leads - fila do modo Automatico destravada
- Area(s) tocada(s): worker do Banco de Leads (`banco-leads-auto.js`) e teste focado.
- Regras preservadas: isolamento por `empresa_id`, janela, teto, cooldown, ordem por score,
  compliance compartilhado e envio unitario pelo motor `rodarLeads`.
- O que mudou: a selecao ignora reservas ativas e verifica os candidatos pela elegibilidade
  oficial antes de escolher um lead; telefone fixo, opt-out ou conversa ativa nao prendem mais
  todos os ticks no mesmo registro.
- Validacao operacional: o worker disparou sozinho, a Evolution confirmou a entrega, o banco
  marcou o disparo como `enviado` e persistiu o proximo horario aleatorio.
- Documentos atualizados: `ai-task-start-log.md` e este mapa.

## 2026-07-20 - Conversas - busca por numero e listagem padronizada
- Area(s) tocada(s): rota autenticada de conversas (`api-conversas.js`) e tela
  `frontend/app/dashboard/conversas/page.tsx`.
- Regras preservadas: isolamento por `empresa_id`, parametros SQL, limite da consulta,
  filtros comerciais existentes, historico e acoes de remocao/reenvio.
- O que mudou: busca por numero com normalizacao de mascara e debounce; respostas antigas
  da consulta sao ignoradas; busca, filtros, contagem, estados e tabela passaram a compor
  um unico card no padrao das demais listagens operacionais.
- Validacao: typecheck do frontend e teste focado multiempresa passaram; a inspecao visual
  no navegador parou na autenticacao, sem uso ou contorno de credenciais.
- Documentos atualizados: `ai-task-start-log.md` e este mapa.

## 2026-07-20 - Follow-ups - conclusao e hardening operacional

- Area(s) tocada(s): provedor de IA (`ai-provider.js`), executor de follow-up e job worker
  (`followup-auto.js`, `agent.js`), rota/servicos/db da Central de Follow-ups, migration `031`,
  tela `frontend/app/dashboard/follow-ups/page.tsx` e testes focados.
- Regras preservadas: isolamento por `empresa_id`, auth/admin existente, envio pela integracao
  WhatsApp atual, regra de negocio no backend e chamadas externas fora de transacao.
- O que mudou: pausa administrativa tambem adia jobs ja enfileirados sem envio nem consumo de
  tentativa; envio pos-ligacao so e aceito para `nao_atendeu`; `sem_interesse` grava ligacao e
  pausa atomicamente; erros 5xx nao vazam detalhes; logs de IA guardam tenant/tokens/custo e
  referencias camelCase; filtros/tabelas e preferencia de aba ficaram operacionais no mobile;
  o timer inicial do refresh Freelandoo deixou de manter processos de teste encerrados abertos.
- Banco: constraints de dominio para modo/meta e indice composto de historico de ligacoes por
  empresa/numero/data, todos aditivos e idempotentes.
- Validacao: 882/882 testes passaram; typechecks de backend/frontend e smoke de preco passaram;
  migration `031` aplicada e confirmada no PostgreSQL; backend 3000 e frontend 3001 responderam,
  com a rota autenticada recusando acesso sem token (401).
- Documentos atualizados: `AGENTS.md`, `ai-task-start-log.md`, `ai-decision-log.md`,
  `project-map.md`, `project-architecture.md` e este mapa.

## 2026-07-20 - Follow-ups - Ligacoes ampliada para Atendimento humano

- Area(s) tocada(s): criterios puros de priorizacao (`followup-call-score.js`), consulta da fila
  (`followup-listing.js`), rotulo de contrato da rota, tela de Follow-ups e testes focados.
- Regras preservadas: isolamento por `empresa_id`, rota autenticada existente, IA apenas no roteiro
  de ligacao, nenhuma geracao/envio de imagem e nenhuma mudanca de banco, worker ou permissao.
- O que mudou: a fila recomenda uma unica acao entre assumir conversa, ligar, revisar proposta,
  mensagem manual e copiar prompt de preview; mostra motivo, orientacao e melhor janela. Handoff
  tem prioridade imediata, tentativas ignoradas favorecem ligacao e preview exige contexto suficiente.
- Restricao de preview: o botao apenas copia um prompt seguro; a imagem e gerada e revisada fora
  do projeto, sem chamada a gerador, persistencia ou envio automatico.
- Validacao: consulta read-only retornou 8 acoes reais sem expor PII; 890/890 testes e os
  typechecks de backend/frontend passaram; backend 3000 e frontend 3001 responderam, e a rota
  autenticada recusou acesso sem token (401).
- Documentos atualizados: `AGENTS.md`, `ai-task-start-log.md`, `ai-decision-log.md`,
  `project-map.md`, `project-architecture.md` e este mapa.

## 2026-07-20 - Banco de Leads - MessageUpdate compativel entre Railway e Docker

- Area(s) tocada(s): servico de disparo/reconciliacao (`rodar-leads.js`) e testes.
- Regras preservadas: sucesso somente em estado terminal da Evolution, isolamento por empresa,
  lock do worker, elegibilidade, janela, teto, cooldown e envio unitario pelo motor existente.
- O que mudou: antes de consultar confirmacoes, o backend verifica com `to_regclass` se
  `MessageUpdate` vive em `evolution` (Railway) ou `public` (Docker local) e usa apenas um
  dos dois nomes hardcoded; se nenhum existir, falha com codigo operacional explicito.
- Impacto: corrige tanto a checagem logo apos o envio quanto a reconciliacao do worker, sem
  migration, variavel de ambiente, segredo, endpoint, frontend ou alteracao de schema.
- Validacao: testes focados 39/39, suite completa 896/896 e typecheck do backend passaram;
  a validacao final exige deploy e observacao de tick real no Railway.
- Documentos atualizados: `ai-task-start-log.md`, `ai-decision-log.md` e este mapa.

## 2026-07-22 - Contextos - catalogo estruturado de servicos no Gerar tudo

- Area(s) tocada(s): migration `033`, servico de catalogo (`contexto-servicos.js`), ingestao
  de conhecimento, pipeline `gerarTudo`, geracao do Contexto 2, rota autenticada de contexto,
  editor `ContextoEditor.tsx` e testes de playbook.
- Regras preservadas: `servicos_produtos` continua existindo como resumo editavel; itens
  revisados pelo operador nao sao sobrescritos por nova leitura de fonte; playbook ativo recebe
  snapshot do catalogo; a decisao automatica de oferta agora fica rastreavel no runtime, sem criar
  envio automatico nem alterar permissao.
- O que mudou: o fluxo Gerar tudo separa ofertas como SEO, criacao de site e sistemas em
  registros individuais de `app.contexto_servicos`, marca lacunas como `precisa_revisao`,
  permite editar/ativar/desativar cada servico no editor e injeta esses itens em `playbook.servicos`.
- Banco: tabela aditiva por `empresa_id`/`contexto_id`, com `slug` unico por contexto, status de
  revisao, confianca, fontes e conflitos em JSONB.
- Validacao: suite completa do backend passou com 909 testes; typechecks de backend e frontend passaram.
- Documentos atualizados: `ai-task-start-log.md`, `ai-decision-log.md`, `project-architecture.md`,
  `project-map.md` e este mapa.

## 2026-07-22 - Contextos - rastreio de decisao de servico no runtime

- Area(s) tocada(s): migration `034`, runtime do Contexto 2 (`contexto2-runtime.js`), responder
  multiempresa (`contexto2-responder.js`) e testes de playbook/responder.
- Regras preservadas: tracking e snapshot sao aditivos; erro ao registrar decisao de servico nao
  bloqueia a resposta ao lead; prompts de producao legados nao foram alterados.
- O que mudou: a IA recebe catalogo canonico de servicos, normaliza slugs mesmo quando responde por
  nome/texto, grava `servicos_interesse_slugs`, ultimo recomendado/oferecido e historico em
  `app.lead_servico_decisoes`.
- Banco: campos aditivos em `app.lead_insights` e tabela append-only para auditoria por
  `empresa_id`, `numero`, `servico_slug` e tipo de decisao.
- Validacao: testes focados de Contexto 2 passaram; suite completa do backend passou com 909
  testes; typechecks de backend e frontend passaram.

## 2026-07-22 - Conversas - feedback supervisionado de respostas do agente

- Area(s) tocada(s): migration `036`, service `conversa-feedback.js`, rota autenticada de
  Conversas, fluxo de sugestoes de Contexto 2 e telas Next.js de Conversas/Contextos.
- Regras preservadas: feedback negativo nao chama IA, nao altera Playbook ativo e nao toca
  prompts globais, Contexto 1, catalogo de servicos, mensagens automaticas ou envio WhatsApp.
- O que mudou: respostas do agente podem receber `gostei` ou `nao gostei` no historico; feedback
  negativo exige observacao, registra snapshot auditavel e cria sugestao pendente quando ha
  Playbook ativo. Aplicar sugestao continua gerando apenas rascunho revisavel.
- Banco: tabela append-only `app.conversa_feedbacks` por `empresa_id`, com vinculo opcional
  `feedback_id` em `app.empresa_contexto_sugestoes`.
- Validacao: testes focados de feedback e Contexto 2 passaram; typecheck do frontend passou.

## 2026-08-04 - Aquisicao - reorganizacao de UI/UX da pagina (sem mudanca de comportamento)

- Area(s) tocada(s): apenas frontend — `app/dashboard/prospeccao/page.tsx`,
  `components/RotinasAquisicao.tsx`, `components/AssistenteOportunidades.tsx` e dois
  componentes novos de apresentacao (`components/ui/Abas.tsx`, `components/HistoricoColetas.tsx`).
- Regras preservadas: nenhuma regra de coleta, Bright Data, idempotencia, worker, migration,
  permissao ou Banco de Leads foi tocada; Rotinas de coleta e Busca avulsa mantiveram
  comportamento, campos e endpoints; as regras de sugestao/aprovacao do Assistente de
  Oportunidades continuam iguais (so o lugar das Preferencias mudou); tabela de leads manteve
  colunas, ordenacao, filtros, busca e acoes de marcar/descartar.
- O que mudou: hierarquia da tela passou a ser coleta -> leads -> consulta. A lista de leads
  virou o conteudo principal (secao "Leads encontrados"); os blocos analiticos foram reunidos
  numa secao "Acompanhar resultados" com 3 abas acessiveis (Desempenho por mercado, que agora
  concentra a tabela por mercado + os sinais comerciais que antes eram um card solto; Respostas
  recentes; Historico de coletas, que e a antiga "Atividade recente" movida das Rotinas). As
  "Preferencias do assistente" sairam de card proprio e vivem recolhidas dentro do card do
  assistente, sob "Configurar criterios". Nenhuma requisicao nova, removida ou reordenada.
- Validacao: `npm run typecheck` e `npm run build` do frontend passaram; validacao no navegador
  (build de producao servido localmente com API simulada) cobriu desktop 1440x900 e mobile
  390x844, as tres abas com e sem dados, teclado nas abas (setas/roving tabindex/aria), ausencia
  de rolagem horizontal do body e a preservacao de ordenacao/filtros/busca ao trocar de aba;
  o log de rede confirmou que nenhuma requisicao de coleta e disparada pela mudanca.
- Documentos atualizados: `ai-task-start-log.md`, `ai-decision-log.md` e este mapa.

## 2026-08-05 - Roteiros - "Copiar contexto para IA" (export manual da versao publicada)

- Area(s) tocada(s): apenas frontend — `app/dashboard/roteiros/page.tsx` (cabecalho da versao),
  `components/ui/icons.tsx` (icone novo `IconCopySparkle`) e o modulo PURO novo
  `lib/roteiro-contexto-ia.js` (+ `.d.ts` + `.test.js`).
- Regras preservadas: publicacao/versionamento intactos (nenhuma escrita, nenhum endpoint novo,
  nenhuma migration); imutabilidade da versao publicada; a acao NAO integra com Claude/OpenAI nem
  com qualquer provedor, NAO envia dado para servico externo e NAO importa resposta de IA — e um
  copiar/colar manual feito pelo operador. Campanhas, fila de ligacoes, leads e automacoes nao
  foram tocadas.
- O que mudou: com uma versao PUBLICADA aberta, aparece ao lado do selo de status um botao
  discreto (borda laranja + icone copiar com brilho de IA) que serializa a versao exibida em JSON
  indentado e copia para a area de transferencia, com feedback "Contexto copiado". O JSON so usa
  campos reais de `app.roteiros`/`roteiro_versoes`/`roteiro_etapas` (migration 033): nome,
  versao, status/publicada_em, objetivo (= descricao do roteiro), publico-alvo (= nicho), etapas
  na ORDEM EXIBIDA, falas/instrucoes e perguntas por etapa, sinais e objecoes por etapa,
  restricoes e a instrucao de analise. Nao exporta `empresa_id`, `roteiro_id`, `versao_id` nem
  dado de lead. Se o navegador bloquear a area de transferencia (contexto nao seguro), ha
  fallback `execCommand` e, em ultimo caso, um painel inline com o JSON para copia manual — o
  conteudo nunca se perde.
- Ponto de atencao (divida declarada): `RESULTADOS_POSSIVEIS_LIGACAO` em
  `lib/roteiro-contexto-ia.js` espelha `LIGACAO_RESULTADO` de `backend/src/domain-enums.js`
  (mesma duplicacao ja existente em `app/dashboard/central-ligacoes/page.tsx`). Um teste trava a
  lista no frontend, mas o anti-drift com o backend continua manual.
- Validacao: `npm test` do frontend 55/55 (11 testes novos do modulo puro), `npm run typecheck`
  do frontend e `npm test` do backend 1166/1166 passaram; a rota `/dashboard/roteiros` compilou
  e respondeu 200 no dev server. `npm run build` do frontend NAO foi executado para nao corromper
  o `.next` do `next dev` em uso.
- Documentos atualizados: `ai-task-start-log.md` e este mapa.

## 2026-08-07 - Central de Ligacoes - Painel de filtros FLUTUANTE (sem migration)

Correcao de UX sobre a entrega imediatamente abaixo. **Somente apresentacao**: nenhum arquivo de
`backend/` tocado, nenhuma requisicao nova, nenhuma migration/env/rota/permissao criada.

- Area(s) tocada(s): `frontend/app/dashboard/central-ligacoes/page.tsx`,
  `frontend/lib/fila-ligacoes-view.js` (+ `.d.ts` + `.test.js`).
- Regras preservadas: elegibilidade (telefone discavel) e ordenacao por prioridade continuam
  decididas no BACKEND — o front nunca reordena nem inclui quem o servidor excluiu; a semantica
  dos filtros (`passaNosFiltros`) nao mudou uma linha; chips continuam medidos contra o estado
  NEUTRO; `filaLigacoesView.v2` mantido (a forma da view nao mudou, so o helper novo).
- O que mudou:
  1. **O painel nao ocupa mais espaco no fluxo.** `<FiltrosFila>` renderiza em `createPortal` no
     `<body>` com `position:fixed` ancorado no `getBoundingClientRect()` do botao "Filtros".
     **Regra a preservar:** nao voltar a renderizar o painel no fluxo entre os chips e a tabela —
     era isso que empurrava a fila para baixo ao abrir os filtros.
  2. **Rascunho x aplicado.** O painel edita uma copia local; so "Aplicar filtros" muda a
     listagem. **Regra a preservar:** fechar por botao/clique fora/Escape/Cancelar DESCARTA o
     rascunho e MANTEM o aplicado. O rodape mostra a previa `N de M` do rascunho.
  3. **"Limpar filtros" restaura a FILA PADRAO** (`filaPadrao()`, nao iniciados), nao o estado
     neutro. **Regra a preservar:** limpar nunca devolve uma lista sem criterio. A fila inteira
     (`limparFiltros()`) segue alcancavel de forma explicita: "Ver a fila inteira" no estado
     vazio e a remocao do chip de tentativas.
  4. **Ordem da fila** entrou como INDICADOR no grupo Operacao (junto de campanha e telefone).
     **Regra a preservar:** esses tres nao viram `<select>` — teriam dois donos do mesmo estado.
  5. **Entrar em ligacao fecha o painel** (`useEffect` em `operando`). **Regra a preservar:**
     `OperacaoLigacao` e overlay `fixed inset-0 z-50` e o painel e `z-[80]` — sem isso o painel
     flutua por cima da tela de atendimento e o Escape e disputado pelos dois.
  6. **Responsivo:** `< 768px` vira drawer inferior com backdrop + `aria-modal` e rolagem
     interna; desktop tem 620px fixos e **sem** backdrop (a fila fica visivel ao fundo, padrao do
     `PersonalizarModal` do Banco de Leads).
  7. Novo helper PURO `viewsIguais(a, b)` em `fila-ligacoes-view.js`. **Regra a preservar:**
     logica de filtro/comparacao fica no `lib/` testavel, nunca no `.tsx`.
- Validacao: `npm test` frontend 75/75 (2 testes novos), `npm test` backend 1182/1182 (inalterado),
  `npm run typecheck` frontend limpo, `next build` OK.
- Nao validado: verificacao visual em navegador com dados reais (exige backend + banco + login).
  A conferencia foi por tipos, testes e leitura do layout.
- Documentos atualizados: `ai-task-start-log.md`, `ai-decision-log.md` e este mapa.

## 2026-08-07 - Central de Ligacoes - Correcoes de UX/operacao da fila (sem migration)

Ajuste sobre a entrega imediatamente abaixo, apos revisao de UX/operacao.

- Area(s) tocada(s): `backend/src/services/ligacao-prioridade.js` (PESOS de tentativa),
  `backend/src/db/campanhas.js` (`filaDeTrabalho` + `listarLeadsDaCampanha`),
  `backend/test/ligacao-prioridade.test.js`, `frontend/lib/fila-ligacoes-view.js` (+ `.d.ts` +
  `.test.js`, reescritos) e `frontend/app/dashboard/central-ligacoes/page.tsx`.
- Regras preservadas: Operacao da Ligacao inteira (iniciar/chamada-encerrada/encerrar/descartar,
  sinais, objecoes, perguntas, etapas temporais, autosave de notas, cronometro do servidor)
  intacta; aba Funil intacta; telefone discavel continua sendo requisito de ENTRADA decidido no
  BACKEND; ordem da fila continua vindo do servidor (o front nunca reordena); nenhuma migration,
  env, rota, permissao ou chamada paga (Bright Data/IA) criada.
- O que mudou:
  1. **Pontuacao**: `uma_tentativa` (5) + `duas_ou_mais_tentativas` (0) viraram
     `PESOS.com_tentativa = 0`. **Regra a preservar:** tentativa anterior NAO e bonus na fila
     inicial — retentativa e' fila propria (filtro), nao lead mais quente. O motivo segue
     aparecendo no tooltip; so nao soma.
  2. **Fila padrao**: telefone valido (backend) + **nenhuma tentativa** + maior prioridade.
     Filtro `Tentativas de contato`: `Nao iniciados | Com tentativa | Todos`.
  3. **Listagem**: sem toggle de visao e sem detalhe enriquecido por linha. Colunas fixas:
     Prioridade, Lead (nome + localizacao, **sem nicho**), Telefone, Status, Tentativas, Ligar.
  4. **Tela de atendimento**: ganhou `Visao simples | detalhada` ao lado do bloco do lead
     (padrao `simples`, sem persistencia). A detalhada mostra os sinais do Bright Data.
  5. **Tooltip de Prioridade**: renderizado em PORTAL no `<body>` (`position:fixed` a partir do
     `getBoundingClientRect()` do circulo). **Regra a preservar:** nao voltar para
     `position:absolute` dentro do `<td>` — o wrapper da tabela e `overflow-hidden` e corta a
     bolha da 1a linha. Fecha em scroll/resize; somente leitura.
  6. **Filtros**: painel operacional geral em grupos (Operacao, Contato, Potencial comercial,
     Perfil do negocio, Presenca digital, Qualidade do dado). Campanha e "telefone disponivel"
     NAO viraram controle (ver `ai-decision-log.md`). Chips medidos contra o estado NEUTRO;
     `limparFiltros()` mostra a fila inteira e ha um botao separado "Fila padrao".
  7. **`listarLeadsDaCampanha`** passou a devolver os campos enriquecidos + `situacao_site`
     (funcao PURA do service). **Regra a preservar:** a situacao do site nunca e recalculada no
     frontend.
  8. `localStorage` da view subiu para `filaLigacoesView.v2`.
- Divida tecnica: a duplicacao de "telefone discavel" (backend `ligacao-prioridade.js` x
  frontend `lib/ligacao-fone.js`) declarada na entrega anterior **continua valendo**.
- Validacao: `npm test` backend 1182/1182, `npm test` frontend 73/73, `npm run typecheck`
  backend e frontend limpos, `npm run build` do frontend OK.
- Documentos atualizados: `ai-task-start-log.md`, `ai-decision-log.md` e este mapa.

## 2026-08-07 - Central de Ligacoes - Prioridade comercial da fila (sem migration)

- Area(s) tocada(s): `backend/src/services/ligacao-prioridade.js` (NOVO, puro),
  `backend/src/db/campanhas.js` (`filaDeTrabalho`), `backend/test/ligacao-prioridade.test.js`
  (NOVO, registrado no `npm test`), `frontend/lib/fila-ligacoes-view.js` (NOVO, puro, + `.d.ts`
  + `.test.js`) e `frontend/app/dashboard/central-ligacoes/page.tsx` (aba Fila).
- Regras preservadas: Operacao da Ligacao inteira (iniciar/chamada-encerrada/encerrar/descartar,
  sinais, objecoes, perguntas, etapas temporais, autosave de notas, cronometro do servidor)
  intacta; abas Acompanhamento e Funil intactas; nenhuma migration, env, rota, permissao ou
  chamada paga (Bright Data/IA) criada; `requireAuth`/`requireEmpresaAccess` e o filtro por
  `empresa_id` de `filaDeTrabalho` inalterados.
- O que mudou (contrato do `GET /campanhas/:id/fila`):
  1. **Elegibilidade**: so entra na fila quem tem telefone DISCAVEL. Quem nao tem nao aparece
     e **nao conta** no total (segue no Banco de Leads e na aba Acompanhamento, para
     enriquecimento de contato).
  2. **Ordem**: deixou de ser `prospects.score` (completude do CADASTRO) e passou a ser a
     PRIORIDADE COMERCIAL da campanha (0-100). O `score` continua sendo devolvido, sem uso na
     fila. A ordenacao do SQL virou desempate (sort estavel).
  3. **Payload**: cada item traz `prioridade { score, faixa, faixa_label, situacao_site,
     motivos[] }` + sinais que JA existiam no cadastro (`tem_site`, `site`, `maps_url`,
     `avaliacoes`, `rating`, `email`, `endereco`, `instagram_handle`, `link_bio`, `seguidores`,
     `categoria_perfil`). Nenhum dado novo e coletado; `raw_json` NAO e exposto.
- Regra da prioridade (pesos em `PESOS`/`CORTES`, prontos para calibracao por reunioes e
  conversoes): sem site confirmado 40 / site nao identificado 15 / tem site 0; avaliacoes
  >=50 20, 20-49 12, 5-19 5; nota >=4,5 10, >=4,0 7, >=3,5 4; rede social sem site 10;
  0 tentativas 10, 1 tentativa 5, 2+ 0. Clamp 0-100. Telefone valido e requisito de ENTRADA e
  **nao soma pontos**. Ausencia de dado nunca vira zero (sem nota != nota baixa). Lead com site
  **nao e excluido** — so perde prioridade nesta campanha.
- Interface: coluna **Prioridade** com circulo de pontuacao (cor por faixa, no mesmo padrao de
  leitura dos "Pontos" do Banco de Leads) e tooltip so-leitura com a composicao, no hover **e**
  no foco por teclado; coluna Lead sem NICHO na visao padrao (a campanha ja o define);
  alternancia **Simplificada** (padrao) / **Detalhada** no canto superior direito da fila, onde
  a detalhada expande a propria coluna Lead (situacao do site, link, avaliacoes, nota, e-mail,
  redes, endereco) sem nova pagina e sem colunas novas; botao compacto de **Filtros** ao lado de
  Atualizar (site, prioridade, avaliacoes, nota, tentativas, localizacao) com chips removiveis,
  "limpar tudo" e atalho "Recomendado da campanha (sem site)". Tudo client-side sobre a fila ja
  carregada (`?limit=500`), persistido em `localStorage` (`filaLigacoesView`). Ligar continua
  direto, sem exigir a visao detalhada.
- Ponto de atencao (divida declarada): a regra de "telefone discavel" agora existe nos DOIS
  pacotes — `backend/src/services/ligacao-prioridade.js` (elegibilidade) e
  `frontend/lib/ligacao-fone.js` (exibicao/discagem). `backend/` e `frontend/` sao pacotes npm
  separados e nao compartilham modulo; a duplicacao esta anotada nos dois arquivos e o
  anti-drift e manual.
- Validacao: `npm test` do backend 1181/1181 (15 testes novos) e do frontend 67/67 (12 novos),
  `npm run typecheck` do frontend limpo. `npm run build` do frontend NAO foi executado para nao
  corromper o `.next` do `next dev` em uso (portas 3000/3001 ativas).
- Documentos atualizados: `ai-task-start-log.md`, `ai-decision-log.md` e este mapa.

## 2026-08-08 - Follow-ups - fila unica de acoes (abas viram filtros)

- Area(s) tocada(s): tela `frontend/app/dashboard/follow-ups/page.tsx` (reescrita),
  `frontend/lib/followups-fila.js` (novo, PURO, + `.d.ts`/`.test.js`), janela estruturada em
  `backend/src/services/followup-call-score.js` e repasse em `followup-listing.js`.
- Regras preservadas: nenhuma regra de envio, elegibilidade, call score, permissao admin,
  isolamento por `empresa_id`, historico ou schema foi alterada. Endpoints inalterados
  (`/config`, `/auto`, `/auto/reprocessar`, `/auto/cancelar`, `/call-list`, `/roteiro`,
  `/ligacoes`, `/manual/gerar`, `/manual/enviar`). Sem migration, sem env nova, sem chamada paga.
- O que mudou: as 3 abas viraram UMA fila com filtros rapidos (Todos, Aguardando, Proxima acao
  hoje, Atendimento humano, Atendimento IA, Falhas, Concluidos) + filtro avancado no padrao do
  Banco de Leads; "Automacao" (pausar, capacidade de ligacoes/dia, reprocessar, diagnostico de
  falhas) virou area separada; o compositor Manual virou botao/modal da fila. Uma linha por
  CONVERSA: acao humana e a proxima acao, e o automatico do mesmo numero vira contexto da
  mesma linha.
- Regra NOVA a preservar: `app.followup_config.modo` NAO deve voltar a ser escrito por clique de
  filtro. Filtro e preferencia de tela (`localStorage: followupsFila`). A coluna e o contrato de
  `/config` continuam existindo (guardam `meta_ligacoes_dia` e `pausado`, este ultimo LIDO pelo
  motor em `followup-auto.js`).
- Regra NOVA a preservar: `janela_recomendada` (frase) e `janela_quando` (chave fechada) saem da
  MESMA avaliacao (`avaliarJanelaAcao`). Nao criar um segundo calculo, e nao interpretar a frase
  no frontend.
- Regra NOVA a preservar: item que so tem follow-up automatico NAO recebe prioridade — nao
  inventar faixa para preencher a bolinha.
- Lacunas declaradas: filtro por responsavel (sem fonte de dados) e por tipo de falha (o motor
  grava texto livre, sem taxonomia).
- Validacao: backend 1390/1390 + typecheck; frontend 169/169 + typecheck; rota
  `/dashboard/follow-ups` compilou e respondeu 200 no dev server ja em execucao (3001).
  Revisao visual autenticada em navegador fica com o operador.
- Documentos atualizados: `AGENTS.md`, `ai-task-start-log.md`, `ai-decision-log.md` e este mapa.
