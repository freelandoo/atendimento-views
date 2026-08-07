# Registro de início de tarefas da IA

Toda IA deve registrar aqui o início de cada tarefa/projeto de alteração **antes**
de analisar profundamente ou alterar código (Fase 0 do workflow padrão — ver
[ai-workflow.md](ai-workflow.md)). Entradas em ordem cronológica inversa (mais recente no topo).

---

## 2026-08-07 - Inicio de tarefa IA - Prioridade comercial da fila da Central de Ligacoes

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** Transformar a fila da Central de Ligacoes em ferramenta de ligacao rapida:
  (1) so lead com telefone DISCAVEL entra e conta na fila; (2) nova pontuacao **Prioridade**
  (0-100) voltada a campanha de criacao de site (sem site 40 / site nao identificado 15 /
  tem site 0; avaliacoes 20/12/5; nota ate 10; rede social sem site 10; tentativas 10/5/0),
  com pesos configuraveis e composicao explicavel; (3) circulo de pontuacao com tooltip;
  (4) alternancia Visao simplificada (padrao) / detalhada na coluna Lead; (5) filtros compactos
  (site, prioridade, avaliacoes, nota, tentativas, localizacao) com chips e limpar.
- **E projeto/tarefa de alteracao?** Sim. Escopo MEDIO: regra de negocio nova (pura) + leitura
  da fila + apresentacao. **Sem schema, sem migration, sem env nova, sem rota nova, sem prompt,
  sem autenticacao.** Nenhum dado novo e coletado: tudo ja existe em `prospectador.prospects`
  (Bright Data/Banco de Leads) e em `app.ligacoes` (tentativas).
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md: Sim |
  docs/project-map.md: Sim | docs/architecture-rules.md: Sim | docs/ui-visual-standard.md: Sim.
- **Areas mapeadas (leitura):** `src/db/campanhas.js` (`filaDeTrabalho` — unica consumidora e'
  `GET /campanhas/:id/fila`), `src/routes/api-campanhas.js`, `src/db/ligacoes.js`,
  `src/routes/api-ligacoes.js`, `src/services/followup-call-score.js` (padrao de PESOS puros),
  `sql/init.sql` + migrations 012/016/021 (colunas de prospects), `frontend/lib/ligacao-fone.js`,
  `frontend/app/dashboard/central-ligacoes/page.tsx`, `frontend/app/dashboard/banco-leads/page.tsx`
  (padrao de filtros/chips/pontos).
- **Arquivos que pretendo alterar/criar:**
  - NOVO `backend/src/services/ligacao-prioridade.js` (PURO: PESOS, situacao do site,
    telefone discavel, `calcularPrioridade`, ordenacao da fila).
  - NOVO `backend/test/ligacao-prioridade.test.js`.
  - EDIT `backend/src/db/campanhas.js` — `filaDeTrabalho` passa a trazer os sinais ja existentes
    do prospect, excluir telefone nao discavel e devolver `prioridade` (score + faixa + motivos).
  - NOVO `frontend/lib/fila-ligacoes-view.js` (+ `.d.ts` + `.test.js`) — filtros/chips PUROS.
  - EDIT `frontend/app/dashboard/central-ligacoes/page.tsx` — circulo de prioridade + tooltip,
    alternancia simplificada/detalhada, barra de filtros; coluna Lead sem nicho no padrao.
- **Fora de escopo declarado:** banco/migrations, Operacao da Ligacao (cockpit, roteiro, sinais,
  encerramento), aba Acompanhamento, aba Funil, Banco de Leads, coleta Bright Data (nenhuma
  chamada paga nova), envio de WhatsApp e qualquer variavel de ambiente.
- **Divida tecnica declarada:** a regra de "telefone discavel" passa a existir no backend
  (elegibilidade) e permanece no `frontend/lib/ligacao-fone.js` (formatacao/discagem). Os dois
  pacotes nao compartilham modulo; a duplicacao fica anotada nos dois arquivos.
- **Proxima etapa:** implementar o diff minimo, rodar `npm test` (backend e frontend) e
  `npm run typecheck` (frontend), e validar a tela com fila cheia, filtrada e vazia.

---

## 2026-08-06 - Inicio de tarefa IA - Analise estrutural: integracao Meta (CAPI) por tenant

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** Analise estrutural COMPLETA (sem implementar) de como integrar o Atendimento
  Views com a Meta para enviar **reuniao marcada** e **venda fechada**, de forma segura, rastreavel
  e **isolada por tenant** (cada empresa com sua conta/dataset/token). Saida: relatorio tecnico em
  19 secoes + plano por fases.
- **E projeto/tarefa de alteracao?** **Nao nesta etapa.** O proprio pedido proibe alterar codigo
  ("Nao altere o codigo durante a analise inicial" / "aguarde aprovacao"). Nenhum arquivo de
  `backend/`, `frontend/` ou `sql/` foi tocado. As unicas escritas sao este registro e o relatorio
  em `docs/analise-integracao-meta-multitenant.md`.
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md: Sim |
  docs/project-map.md: Sim | docs/architecture-rules.md: a consultar na fase de implementacao |
  docs/ui-visual-standard.md: a consultar se a tela de Integracoes for aprovada |
  docs/ai-decision-log.md: a registrar quando a arquitetura for aprovada.
- **Areas mapeadas (somente leitura):** `src/services/meta-capi.js`,
  `src/services/meta-attribution.js`, `src/meta-routes.js`, `src/agent.js` (tick ~L497),
  `src/middleware/tenant.js`, `src/db-crud.js` (upsert de conversa), `src/agenda.js`
  (`criarEventoAgenda`, PATCH `/vendido`), `src/services/agenda-multiempresa.js`,
  `src/handoff-alerts.js`, `src/db/ligacoes.js` (`encerrarLigacao`), `src/db/campanhas.js`,
  `src/db/auditoria.js`, `src/freelandoo/crypto.js`, `src/domain-enums.js`,
  `sql/init.sql` (vendas.*), migrations `001, 006, 011, 013, 019, 032, 039, 047`,
  `frontend/app/dashboard/*`, `.env.example`.
- **Achado central (fato verificado no codigo, nao hipotese):** JA EXISTE integracao Meta CAPI —
  e ela e **100% single-tenant e global**. `meta-capi.js` le `META_DATASET_ID`/`META_CAPI_TOKEN`/
  `META_PAGE_ID` do PROCESSO; `dispararEventosMetaPendentes` varre `vendas.lead_profiles` **sem
  filtro de empresa_id** e manda TODOS os leads de todos os tenants para o MESMO dataset. Detalhes,
  riscos e o restante dos achados no relatorio.
- **Areas possivelmente impactadas (se a implementacao for aprovada):** Banco (migrations aditivas
  novas), back-end (novo dominio de integracoes + ledger + worker), front-end (area de Integracoes),
  seguranca/segredos (credenciais por tenant cifradas), LGPD (dado pessoal enviado a terceiro),
  custos (nenhum novo alem de chamadas HTTP a Meta). Sem impacto em prompts de producao, envio de
  WhatsApp ou Bright Data.
- **Proxima etapa:** entregar o relatorio e **AGUARDAR aprovacao**. Se aprovado, abrir tarefa de
  implementacao propria (nova Fase 0) por fase, com analise de impacto e migration dedicada.

---

## 2026-08-05 - Inicio de tarefa IA - Modal guiado de entrada do Assistente de Oportunidades

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** O botao premium "Analisar oportunidades" deixa de abrir a sessao de analise
  direto. Ele passa a abrir um **modal curto e guiado** ("O que voce quer fazer agora?") com duas
  opcoes: (1) **Revisar oportunidades encontradas** — vai direto ao fluxo atual de aprovar/descartar;
  (2) **Encontrar novas oportunidades** — busca guiada perguntando o que mudar (nicho, localidade ou
  ambos). Sem configuracao manual de criterios, preservando o contexto da busca atual.
- **E projeto/tarefa de alteracao?** Sim — front-end (novo componente + fluxo) e um endpoint
  read-only novo no back-end. **Sem migration, sem env nova, sem mudanca de schema.**
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md: Sim |
  docs/ui-visual-standard.md: Sim (modal — Fase 5) | docs/ai-decision-log.md: a registrar na Fase 8.
- **Areas mapeadas (leitura antes de editar):** `frontend/components/RotinasAquisicao.tsx`
  (Busca avulsa + gatilho), `frontend/components/AssistenteOportunidades.tsx` (sessao),
  `frontend/lib/ligacao-estado.js` (padrao de logica PURA testavel em `lib/*.test.js`),
  `src/services/aquisicao-curadoria.js` (`obterEstadoAtual`, `montarEstado`, `montarFila`),
  `src/db/aquisicao-curadoria.js` (sessao unica por operador, claim, idempotencia),
  `src/routes/api-aquisicao-curadoria.js`, `src/routes/api-prospeccao.js` (POST `/buscar`),
  migration `055_aquisicao_curadoria.sql`.
- **Fatos confirmados no codigo (nao sao hipotese):**
  1. `GET /curadoria` chama `montarEstado`, que **remonta a fila e chama a IA** quando a sessao
     ativa esta com `fila_json` vazio. Usar esse GET so para desenhar o modal de entrada custaria
     uma chamada de IA por abertura — por isso nasce um `GET /curadoria/resumo` read-only.
  2. `iniciarSessao` devolve a sessao ATIVA existente e **ignora** o mercado pedido
     (`reaproveitada: true`). Hoje isso e' silencioso; o modal passa a mostrar a sessao em
     andamento explicitamente.
  3. Uma coleta paga por empresa por vez e' garantida no BANCO
     (`busca_snapshots_uma_ativa_por_empresa_uk`) + idempotencia por minuto; o modal so precisa
     refletir esse estado, nao reimplementa-lo.
- **Decisao de arquitetura tomada (Fase 6):** a **busca guiada NAO cria e NAO muta sessao**. Ela
  so dispara a coleta pelo mesmo `POST /prospeccao/buscar` ja existente; a sessao continua nascendo
  no `POST /curadoria/sessao`, no comando "Revisar". Retargetar uma sessao ativa corromperia
  meta/fila em andamento, e criar uma segunda sessao e' impedido pelo indice unico parcial.
- **Areas possivelmente impactadas:** Front-end (novo modal + novo modulo puro em `lib/`),
  Back-end (1 rota GET read-only), Banco: **Nao**, Custos: **reduz** (o modal nao paga IA),
  Permissoes: mantidas (admin-only + `requireEmpresaAccess`), Integracoes: nenhuma nova.
- **Proxima etapa:** Fases 3-9 — implementar o diff minimo e validar com `npm test` (back e front)
  e `npm run typecheck`.

---

## 2026-08-04 - Inicio de tarefa IA - Evolucao da Busca avulsa com Assistente de Oportunidades POR LEAD

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** Evoluir a **Busca avulsa** (nicho + cidade + max. de leads novos a importar,
  acao principal "Buscar agora" = SO encontrar candidatos) e criar um gatilho manual premium
  "Analisar oportunidades" que abre uma **sessao do assistente com UMA OPORTUNIDADE POR VEZ**:
  justificativa curta da IA, **Aprovar = importa o lead** (idempotente, so conta lead NOVO) e
  **Descartar = nao importa + vira sinal de aprendizado**. O maximo informado limita os leads
  NOVOS APROVADOS, nao os candidatos avaliados. Criterios passam a ser automaticos/invisiveis.
- **E projeto/tarefa de alteracao?** Sim — Fase 1 (analise de impacto) obrigatoria antes de codar;
  o proprio pedido define um `decision_gate`.
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md: Sim |
  docs/ui-visual-standard.md: a consultar na Fase 5 | docs/ai-decision-log.md: a registrar na Fase 8.
- **Areas mapeadas (somente leitura nesta fase):** `frontend/components/RotinasAquisicao.tsx`
  (Busca avulsa), `frontend/components/AssistenteOportunidades.tsx`,
  `frontend/app/dashboard/prospeccao/page.tsx`, `src/routes/api-prospeccao.js` (POST /buscar),
  `src/routes/api-aquisicao-oportunidades.js`, `src/services/aquisicao-assistente.js`,
  `src/services/aquisicao-sinais.js`, `src/db/aquisicao-oportunidades.js`,
  `src/services/places-brightdata.js`, `src/prospecting.js`
  (`pesquisarPlaces` 3630, `processarBuscasPlacesPendentes` 3791, `salvarProspects` 1132,
  `mapearPlace` 1016), migrations `053` e `054`, `sql/init.sql` (prospectador.prospects).
- **Conflito material encontrado (motivo do decision_gate):** o pedido descreve um assistente
  **POR LEAD** (aprovar importa o lead), mas (1) a Busca avulsa de hoje **ja importa todos** os
  leads encontrados automaticamente pelo worker — nao existe area de candidatos nao importados; e
  (2) o "Assistente de Oportunidades" ja entregue (commit 6e4beed, migration 054) e' **POR
  MERCADO/ROTINA**, com o mesmo nome, o mesmo botao "Analisar oportunidades" e o mesmo lugar na tela.
- **Decisao pendente do Victor:** onde nasce o candidato (area de espera antes da importacao x
  curadoria sobre leads ja importados) e o destino do assistente por mercado ja publicado.
- **Proxima etapa:** entregar o relatorio de impacto e AGUARDAR a decisao antes da Fase 2.

---

## 2026-08-04 - Inicio de tarefa IA - Assistente de Oportunidades (Busca IA perde autonomia de coleta paga)

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** Transformar a **Busca IA** (que hoje escolhe nicho+cidade sozinha e DISPARA
  coleta paga) em um **Assistente de Oportunidades**: analisa rotinas, resultados de coleta e
  resultado comercial por mercado, e SUGERE (criar rotina, pausar/revisar, variar mercado, ajustar
  quantidade/intervalo/dias) com motivo, evidências e confiança. O administrador **sempre aprova**;
  a IA nunca cria/edita/ativa rotina nem inicia coleta. Decisões (aprovar/editar/dispensar) ficam
  registradas para a mesma sugestão não reaparecer sem motivo novo. A Busca IA legada continua
  funcional nesta etapa (sem remoção).
- **E projeto/tarefa de alteracao?** Sim — feature GRANDE e ESTRUTURAL: migration nova, módulo de
  sinais + geração de sugestões, rotas admin novas, nova seção na tela de Aquisição.
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md: Sim |
  docs/architecture-rules.md: Sim | docs/project-map.md: Sim | docs/ui-visual-standard.md: a
  consultar na Fase 5 | docs/project-architecture.md: Sim | docs/ai-decision-log.md: a registrar
  na Fase 8.
- **Areas mapeadas (leitura, antes de qualquer edicao):**
  - `src/prospecting.js`: `selecionarMercadoDiarioIA` (2596), `resumoMercadosProspeccao` (2561),
    `verificarAgendaBuscaRecorrenteProspeccao` (2972 — é ELE que chama `pesquisarPlaces` com a
    escolha da IA), `executarRotinasAquisicao` (3039), `pesquisarPlaces` (3710).
  - `src/services/aquisicao-rotinas-scheduler.js` (lógica pura de tempo/normalização/validação),
    `src/db/aquisicao-rotinas.js` (CRUD + `listarAtividadeRecente`), `src/routes/api-aquisicao-rotinas.js`.
  - `src/services/prospecting-settings.js` (config legada da Busca IA: estratégia, nichos/regiões
    permitidos, `busca_estado`), migrations `027` e `053`.
  - `src/routes/api-prospeccao.js` (`/resultados`, `/analytics`, `/metricas`) — fonte de sinal
    comercial já existente por nicho/cidade.
  - `index.js:98-99` (montagem admin-only) e `src/agent.js:483-495` (tick de 60s dos workers).
  - Front: `frontend/app/dashboard/prospeccao/page.tsx` e `frontend/components/RotinasAquisicao.tsx`.
- **Fatos confirmados no codigo (nao sao hipotese):**
  1. A autonomia de coleta paga da Busca IA está em `verificarAgendaBuscaRecorrenteProspeccao`,
     não em `selecionarMercadoDiarioIA` (que só devolve `{nicho, cidade, motivo, confianca}`).
  2. O sinal comercial por mercado JÁ existe: `prospectador.prospects` (status
     `enviado`/`respondeu`), `prospectador.lead_disparos` e `app.agenda_eventos` (reuniões, casadas
     por telefone). O sinal de coleta está em `prospectador.busca_snapshots`
     (`total_prospects`/`novos_prospects`) e nos contadores da rotina.
  3. Isolamento por empresa já é padrão em todas as tabelas envolvidas.
- **Areas possivelmente impactadas:** Banco (migration ADITIVA nova para sugestões/decisões),
  back-end (novo service de sinais + geração, novas rotas admin), front-end (nova seção em
  Aquisição), custo de IA (1 chamada por análise — rastreada em Uso & Custo por empresa),
  visual/UX (nova seção), permissões (mantidas: `requireAuth` + `requireRole('admin')` +
  `requireEmpresaAccess`). SEM impacto em envio de WhatsApp, Banco de Leads, prompts de produção
  ou segredos. NENHUMA chamada paga à Bright Data é feita por este módulo.
- **Restricao declarada pelo usuario:** a IA não pode chamar Bright Data nem qualquer função de
  disparo; não pode alterar rotinas direto no banco; a aprovação passa por rota autenticada de
  admin com validação de backend. Nenhuma chamada paga real na validação.
- **Proxima etapa:** Fase 1-6 — entendimento, impacto e **confirmação da arquitetura com o Victor**
  antes de escrever código (feature estrutural com migration).

---

## 2026-08-04 - Inicio de tarefa IA - Reestruturar Aquisicao como rotinas continuas de coleta

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** Transformar a Aquisicao de uma CONFIGURACAO UNICA por empresa em uma
  maquina de ROTINAS independentes (nicho + cidade + UF + dias + janela + intervalo >= 6h +
  quantidade 1..200 + ativo/pausado), com CRUD e observabilidade por rotina; remover o teto de
  1-2 buscas/dia; expor dias da semana (ja suportados no backend); corrigir a UF ausente na
  busca manual; e endurecer o disparo pago (idempotencia, tentativa persistida ANTES do trigger,
  uma coleta paga por empresa por vez, politica de tentativas/expiracao).
- **E projeto/tarefa de alteracao?** Sim — feature GRANDE e ESTRUTURAL: migration nova, troca do
  modelo de agendamento, rotas novas, reescrita do scheduler/worker de busca e da tela.
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md: Sim |
  docs/project-map.md: Sim | docs/architecture-rules.md: Sim | docs/ui-visual-standard.md: Sim |
  docs/project-architecture.md: Sim | docs/ai-decision-log.md: a registrar na Fase 8.
- **Areas mapeadas (leitura, antes de qualquer edicao):**
  - `sql/migrations/009, 018, 024, 027` (config por empresa, busca recorrente, busca_snapshots,
    modos/estado da busca IA).
  - `src/services/prospecting-settings.js` (normalizacao/persistencia da config unica),
    `src/services/prospecting-search-scheduler.js` (decisao PURA: janela, dias, intervalo, TZ),
    `src/services/captacao-scheduler.js` (helpers `horaLocal`/`normalizarDias` reusados),
    `src/services/places-brightdata.js` (trigger/progress/snapshot + `MAX_LEADS_POR_BUSCA=200`).
  - `src/prospecting.js`: `pesquisarPlaces` (dispara + enfileira), `existeBuscaEmAndamento`,
    `totalBuscasAutomaticasHoje`, `verificarAgendaBuscaRecorrenteProspeccao`,
    `processarBuscasPlacesPendentes`, `listarBuscasRecentes`, `atualizarEstadoBusca`.
  - `src/agent.js:483-487` (tick de 60s que chama scheduler + worker).
  - `src/routes/api-prospeccao.js` (rotas `/buscar`, `/buscas`, `/configuracao`).
  - `frontend/app/dashboard/prospeccao/page.tsx` (tela unica de configuracao).
- **Problemas confirmados no codigo (nao sao hipotese):**
  1. `api-prospeccao.js` POST `/buscar` envia so `{nicho, cidade}` — a UF (`estado_padrao`) NAO
     entra na geocodificacao; o automatico compoe "Cidade - UF" em `mercadoFixoDaConfig`, o
     manual nao.
  2. `pesquisarPlaces` checa `existeBuscaEmAndamento` e so DEPOIS chama a Bright Data; duas
     requisicoes simultaneas passam pela checagem juntas (TOCTOU) e geram DUAS coletas pagas.
  3. A linha em `busca_snapshots` e' inserida DEPOIS do trigger pago — se o INSERT falhar, a
     coleta paga fica orfa (sem registro, sem worker, sem cobranca rastreada).
  4. `processarBuscasPlacesPendentes` re-tenta indefinidamente em erro/estado desconhecido: nao
     ha contador de tentativas nem expiracao por idade.
- **Areas possivelmente impactadas:** Banco (migration aditiva nova), back-end (settings,
  scheduler, worker, rotas), front-end (tela Aquisicao), custos Bright Data (positivo: menos
  risco de coleta duplicada), permissoes (mantidas: `requireAuth` + `requireEmpresaAccess`),
  visual/UX (tela passa de formulario unico para lista de rotinas). Sem impacto em envio de
  WhatsApp, Banco de Leads, campanhas sociais, prompts ou segredos.
- **Restricao declarada pelo usuario:** nao fazer chamada real paga a Bright Data sem
  autorizacao explicita — a validacao sera por testes com cliente Bright Data mockado.
- **Decisoes travadas com o Victor (Fase 2/6, antes de codar):**
  1. Rotinas cobrem SO mercado fixo; a **Busca IA fica como esta** (motor global na config antiga).
  2. A config fixa atual e' convertida na 1a rotina **PAUSADA** (nada dispara cobranca no deploy).
- **Entregue:** migration `053_aquisicao_rotinas.sql`, `services/aquisicao-rotinas-scheduler.js`,
  `db/aquisicao-rotinas.js`, `routes/api-aquisicao-rotinas.js`, `executarRotinasAquisicao` em
  `prospecting.js` (+ `pesquisarPlaces` reescrito com reserva-antes-do-pagamento e UF), tick em
  `agent.js`, `components/RotinasAquisicao.tsx` e a tela `dashboard/prospeccao` reorganizada.
- **Validacao executada:** `npm test` backend 1109/1109 (46 testes novos), `npm test` frontend
  27/27, `npm run typecheck` backend e frontend limpos, `npm run smoke:preco` ok,
  `next build` ok, carga de todos os modulos novos via `require`.
- **2a etapa (mesma data) — pendencias fechadas:**
  1. Corrida entre PAUSA e disparo: `marcarDisparo` passou a exigir `ativo = true` no mesmo
     UPDATE atomico; sem linha atualizada, o motor nao chama a Bright Data. +2 testes.
  2. Quantidade comunicada como "Max. de leads a importar" (nao promete volume coletado/custo).
  3. Migration 053 APLICADA em Postgres real: banco descartavel com casos patologicos + banco de
     desenvolvimento pelo caminho de boot (`runMigrations`). A config `automatico_fixo`
     (Barbearia/SBC/SP) virou rotina PAUSADA; o modo `ia` de outra empresa ficou intacto.
  4. Validacao visual/operacional: 33 verificacoes e2e contra o backend real com Bright Data
     NEUTRALIZADA + capturas desktop/mobile; os 6 estados observados na tela.
- **Correcao de diagnostico:** a 1a etapa afirmou ter corrigido um risco de "janela invertida
  abortar o boot". Esse caso NAO e alcancavel — `prospeccao_configuracoes` ja tem
  `CHECK (horario_fim > horario_inicio)` (colunas NOT NULL) e CHECK de cardinalidade nos dias.
  O tratamento defensivo permanece como seguro barato.
- **Efeito colateral declarado no banco de DEV:** o novo worker expirou um snapshot travado em
  `processando` desde 28/07 (`sd_ms4jo59...`, 0 leads) — comportamento novo e desejado. Durante a
  limpeza eu flipei por engano um snapshot concluido (`sd_ms3h3q8...`, 200 leads) para
  `processando`; foi restaurado para `concluido` com os contadores intactos. Nada em producao.
- **Proxima etapa:** deploy; a migration roda sozinha no boot. Depois, revisar e ATIVAR a rotina
  convertida (nasce pausada de proposito).

---

## 2026-08-03 - Inicio de tarefa IA - Recriar nicho/roteiro/campanha da Central de Ligacoes em PRODUCAO

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** Recriar em PRODUCAO a campanha e os roteiros que existiam apenas no banco
  LOCAL de desenvolvimento. O deploy do commit `37c1254` levou o SCHEMA para producao, mas os
  DADOS de configuracao do modulo ficaram so no local.
- **E projeto/tarefa de alteracao?** Nao de CODIGO — nenhum arquivo de `backend/`, `frontend/` ou
  `sql/` sera alterado. E uma tarefa de DADOS: escrita em producao.
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md: Sim.
- **Estado verificado antes (somente leitura):** producao com as 17 migrations (033/038-052)
  aplicadas e `app.nichos`, `app.roteiros`, `app.roteiro_versoes`, `app.campanhas`,
  `app.campanha_leads` e `app.ligacoes` TODOS vazios. Empresa PJ Codeworks
  (`f5f47737-…`) e 2.853 prospects ja existem; os 179 prospect_ids da campanha local
  foram conferidos um a um e os 179 existem em producao no tenant correto.
- **Escopo aprovado pelo Victor:** nicho "Funilaria e pintura automotiva" + roteiro
  "Atendimento a Funileiro" (11 etapas SPIN, publicado) + campanha "Demo — Funileiros" (ativa,
  metas 20/5) + os 179 leads, todos zerados em `nao_iniciado`.
- **Fora de escopo (decisao registrada):** as 18 ligacoes locais (8 encerradas / 10 descartadas)
  NAO sao recriadas — sao artefatos de teste e contaminariam a analitica que o modulo existe para
  proteger. A versao v1 (arquivada e VAZIA no local) tambem nao e' recriada; em producao o roteiro
  nasce com v1 publicada em vez de v2.
- **Metodo:** via API REST de producao (`/api/auth/login` + rotas admin), NAO por SQL direto, para
  que as validacoes de dominio (tipos de etapa, imutabilidade da versao publicada, checagem
  same-tenant de FKs, `adicionarLeads` filtrando por empresa) sejam todas exercidas.
- **Reversibilidade:** tudo e' dado novo em tabelas hoje vazias; reverter e' apagar as linhas
  criadas. Nenhum dado pre-existente e' alterado ou apagado.
- **Proxima etapa:** executar a recriacao e conferir o resultado lendo de volta de producao.

---

## 2026-07-31 - Inicio de tarefa IA - Validacao final e publicacao (commit + push) do modulo Central de Ligacoes

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** Revisao completa das alteracoes pendentes na branch `master` (12 modificados
  + 59 novos) para garantir consistencia e prontidao, seguida de commit e push. Escopo declarado
  como EXCLUSIVAMENTE validacao/publicacao: sem nova funcionalidade, sem refatoracao, sem mudanca
  de arquitetura.
- **E projeto/tarefa de alteracao?** Nao no codigo de aplicacao — nenhum arquivo de `backend/src`,
  `frontend/` ou `sql/` foi tocado por esta tarefa. A unica escrita foi este registro de Fase 0.
  A tarefa PUBLICA trabalho ja concluido e validado em sessoes anteriores.
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md: Sim.
- **Validacoes executadas:** `npm test` backend (1061/1061), `npm test` frontend (27/27),
  `npm run typecheck` backend e frontend (limpos), `npm run smoke:preco` (ok), carga dos 16
  modulos novos via `require`, `node --check index.js`.
- **Verificacao da pendencia arquitetural:** confirmado que `src/db/ligacoes*.js` e
  `src/routes/api-ligacoes.js` NAO referenciam conversas/WhatsApp/historico-envio. A integracao
  Ligacoes ↔ Mensagens permanece apenas documentada em
  `docs/PENDENCIA_ARQUITETURAL_CENTRAL_LIGACOES_E_MENSAGENS.md`, sem codigo iniciado.
- **Risco declarado no push:** as migrations `050` (DELETE) e `052` (UPDATE + troca de CHECK)
  rodam sozinhas no boot em producao (`runMigrations`). Ambas ARQUIVAM antes de mutar
  (`app.ligacoes_legado_arquivo`, `app.ligacoes_motivo_perda_v1_arquivo`). Revisadas linha a
  linha nesta validacao.
- **Proxima etapa:** commit unico na `master` e push para `origin`.

---

## 2026-07-30 - Inicio de tarefa IA - Analise arquitetural Ligacoes -> Mensagens (WhatsApp)

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** Analise arquitetural (SEM implementacao) de como a Central de Ligacoes deve
  entregar a continuidade da negociacao para a Central de Mensagens (WhatsApp): onde termina cada
  dominio, qual o contrato entre eles, o que e compartilhado, o que fica exclusivo, e qual o fluxo
  ideal para o vendedor.
- **E projeto/tarefa de alteracao?** Nao nesta etapa — e analise/decisao de arquitetura. O pedido
  proibe explicitamente implementar, gerar codigo ou criar integracao prematura. Nenhum arquivo de
  `backend/` ou `frontend/` foi tocado.
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md: Sim (Fase 0 → 2).
- **Areas mapeadas (leitura):** `src/db/ligacoes.js`, `ligacoes-estado.js`, `routes/api-ligacoes.js`,
  `domain-enums.js`, migrations 039/047/049/051, `services/rodar-leads.js`, `conversa-manual.js`,
  `followup-manual.js`, `db/followup-ligacoes.js`, `services/historico-envio.js`,
  `frontend/app/dashboard/central-ligacoes`, `banco-leads`, `components/ConversaHistoricoModal.tsx`.
- **Confirmacao:** Analise entregue no chat; nenhuma decisao foi aplicada em codigo/banco. Achados
  estruturais (identidade prospect_id ↔ JID, duplicacao `vendas.followup_ligacoes` × `app.ligacoes`,
  `proxima_acao` como TEXT livre) precisam de decisao do usuario antes de qualquer implementacao.
- **Proxima etapa:** Aguardar escolha do usuario sobre a arquitetura recomendada; se aprovada,
  abrir tarefa de implementacao propria (nova Fase 0) com analise de impacto e migration dedicada.

---

## 2026-07-22 - Inicio de tarefa IA

- **IA/Ferramenta:** Codex
- **Pedido resumido:** Implementar feedback positivo/negativo em respostas do agente no historico de Conversas, com aprendizado supervisionado para o Playbook ativo.
- **E projeto/tarefa de alteracao?** Sim (UX, rota autenticada, service, migration, revisao de Contextos e testes).
- **Workflow padrao consultado?** AGENTS.md, docs/ai-workflow.md, docs/project-map.md, docs/architecture-rules.md, docs/ui-visual-standard.md, docs/project-architecture.md e plano aprovado pelo usuario: Sim.
- **Areas possivelmente impactadas:** Front-end da pagina Conversas e Contextos, rota SaaS de conversas, banco `app`, sugestoes de contexto e testes. Sem alteracao em prompts globais, segredos, envio WhatsApp, Contexto 1, catalogo de servicos ou mensagens automaticas.
- **Confirmacao:** O usuario pediu explicitamente para implementar o plano aprovado. A aplicacao de aprendizado sera supervisionada: feedback negativo cria sugestao pendente, mas nao chama IA nem ativa contexto automaticamente.
- **Proxima etapa:** Implementar diff minimo com auditoria por tenant, sugestao pendente opcional, UI de hover/formulario e validacao por testes/typechecks.

---

## 2026-07-22 - Inicio de tarefa IA - Preenchimento por chute no catalogo de servicos

- **IA/Ferramenta:** Claude Code (Sonnet 5)
- **Pedido resumido:** Ao gerar o catalogo de servicos (`app.contexto_servicos`) via IA, quando a
  fonte nao trouxer categoria, descricao curta, preco, prazo, beneficios, "quando recomendar" ou
  perguntas de qualificacao para um servico, a IA deve poder "chutar" (inferir com bom senso, com
  base no que ja sabe sobre o tipo de servico) em vez de deixar o campo vazio. Preco chutado deve
  vir no formato "A partir de R$ X". Dados gerais da empresa (contato, endereco, URLs) continuam
  proibidos de serem inventados.
- **E projeto/tarefa de alteracao?** Sim (prompt de extracao/consolidacao por IA embutido em
  `knowledge-ingestion.js` + ajuste de sinalizacao de revisao em `contexto-servicos.js`).
- **Workflow padrao consultado?** AGENTS.md, docs/ai-workflow.md, docs/project-map.md,
  docs/architecture-rules.md: Sim.
- **Areas possivelmente impactadas:** Prompt de extracao de fonte (`RESUMO_FONTE_SYSTEM`) e de
  consolidacao (`SUGESTAO_CTX1_SYSTEM`) em `knowledge-ingestion.js`; normalizacao/flag de revisao
  em `contexto-servicos.js`; dado exibido ao operador no editor de contexto e usado no playbook de
  atendimento (dados podem chegar a leads via WhatsApp).
- **Confirmacao:** Aguardando confirmacao do usuario sobre o desenho antes de editar (mudanca em
  prompt de producao que afeta dado mostrado a lead).
- **Proxima etapa:** Ajustar os prompts para permitir chute apenas nos campos do
  `catalogo_de_ofertas`, e marcar `confianca='baixa'`/`status_revisao='precisa_revisao'` quando a
  IA chutar, preservando a fila de revisao humana existente.

---

## 2026-07-22 - Inicio de tarefa IA

- **IA/Ferramenta:** Codex
- **Pedido resumido:** Criar catalogo estruturado de servicos no fluxo Gerar tudo, separando ofertas como SEO, criacao de site e sistemas em itens editaveis e reutilizados pelo playbook.
- **E projeto/tarefa de alteracao?** Sim (backend, banco, pipeline de IA, UI do editor de contexto e testes).
- **Workflow padrao consultado?** AGENTS.md, docs/ai-workflow.md, docs/project-map.md, docs/architecture-rules.md, docs/ui-visual-standard.md, docs/project-architecture.md, docs/project-change-map.md e docs/ai-decision-log.md: Sim.
- **Areas possivelmente impactadas:** Contexto 1/2, ingestao de fontes, pipeline Gerar tudo, migrations PostgreSQL, rotas autenticadas de contexto, editor Next.js e testes de contexto/playbook.
- **Confirmacao:** O usuario confirmou a arquitetura desejada com "Crie"; a implementacao sera aditiva, sem sobrescrever informacao revisada pelo operador e sem alterar automaticamente decisoes de oferta no runtime nesta fase.
- **Proxima etapa:** Criar a camada `contexto_servicos`, preencher via IA/fonte no Gerar tudo, mostrar/editar no editor e alimentar o playbook com o catalogo separado.

---

## 2026-07-04 - Início de tarefa IA — Modos Manual/Semi/Auto no Banco de Leads

- **IA/Ferramenta:** Claude Code (Opus 4.8)
- **Pedido resumido:** Transformar a página **Banco de Leads** em uma central de disparo
  com **Modo Manual / Semiautomático / Automático** configurável no "Rodar". A listagem se
  adapta ao modo. Unificar "Saudação — teste e edição" em **um botão** só para verificar
  envio. Regras: Manual = usuário envia (clicar = aprovação), pode escrever ou gerar por IA;
  Semi = mensagem já gerada por IA aguardando disparo do usuário (sem aprovação);
  Automático = janela horária, teto 100/dia, intervalo 15–30 min, sistema dispara sozinho
  (botão manual ainda existe, mas preferência é do sistema). Adaptar bem transições de status.
- **É projeto/tarefa de alteração?** Sim (feature grande — front + back + provável migration + worker).
- **Workflow padrão consultado?**
  - AGENTS.md: Sim
  - CLAUDE.md: Sim
  - docs/ai-workflow.md: Sim
  - docs/project-change-map.md: A consultar na Fase 7
  - docs/ai-decision-log.md: A registrar na Fase 8
  - docs/ui-visual-standard.md: Sim (tela/tabela/modal — impacta UX)
  - docs/project-architecture.md: Sim
  - Spec relacionada: docs/superpowers/specs/2026-07-03-saudacao-analise-e-estagios-design.md
- **Áreas possivelmente impactadas:**
  - Front-end: Sim (banco-leads/page.tsx — barra de rodar, modal, tabelas)
  - Back-end: Sim (api-banco-leads.js, rodar-leads.js, provável novo worker/scheduler)
  - Banco de dados: Provável (novo estado "gerada/aguardando disparo" + config de modo/agenda)
  - Financeiro: Não
  - Dashboards: Não
  - Assinaturas: Não
  - Custos: Sim (geração IA por lead — já existe kill-switch por instância)
  - Permissões: Não (rota já é admin-only)
  - Integrações: WhatsApp (Evolution) — envio já existente
  - Visual/UX: Sim (listagem adapta ao modo)
  - Arquitetura: Sim (risco de duplicar o motor de modos da Prospecção — decidir reuso)
- **Confirmação:** A IA confirma que está utilizando o workflow padrão do projeto antes de alterar código.
- **Próxima etapa:** Fase 1–2 — Entendimento + Confirmação de escopo/arquitetura com o Alex (SEM tocar código ainda).

---

## 2026-07-04 - Início de tarefa IA

- **IA/Ferramenta:** Claude Code (Opus 4.8)
- **Pedido resumido:** Aplicar o "Workflow Padrão de IA para Projetos v2.0" da PJ Codeworks
  (documento `Documentacao_Workflow_Padrao_IA_PJ_Codeworks_v2.docx`) — criar/atualizar os
  arquivos de governança de workflow no repositório.
- **É projeto/tarefa de alteração?** Sim (documentação de governança).
- **Workflow padrão consultado?**
  - AGENTS.md: Sim
  - CLAUDE.md: Sim
  - docs/ai-workflow.md: Criado nesta tarefa
  - docs/project-change-map.md: Criado nesta tarefa
  - docs/ai-decision-log.md: Criado nesta tarefa
  - docs/ui-visual-standard.md: Criado nesta tarefa (referencia `GUIA-VISUAL-PJ-CODEWORKS.md`)
  - docs/project-architecture.md: Criado nesta tarefa (referencia `project-map.md` + `architecture-rules.md`)
- **Áreas possivelmente impactadas:**
  - Front-end: Não
  - Back-end: Não
  - Banco de dados: Não
  - Financeiro: Não
  - Dashboards: Não
  - Assinaturas: Não
  - Custos: Não
  - Permissões: Não
  - Integrações: Não
  - Visual/UX: Não (apenas documentação de padrão)
  - Arquitetura: Não altera código; apenas documenta a arquitetura já existente
- **Confirmação:** A IA confirma que está utilizando o workflow padrão do projeto antes de alterar código.
- **Próxima etapa:** Documentação criada; código de produção não foi tocado.

---

## 2026-07-05 - Inicio de tarefa IA

- **IA/Ferramenta:** Codex
- **Pedido resumido:** Adicionar uma coluna "Envio" no Banco de Leads para visualizar quando o envio esta previsto/status do disparo.
- **E projeto/tarefa de alteracao?** Sim (ajuste visual/operacional no frontend).
- **Workflow padrao consultado?**
  - AGENTS.md: Sim
  - CLAUDE.md: Sim
  - docs/ai-workflow.md: Sim
  - docs/project-map.md: Sim
  - docs/architecture-rules.md: Sim
  - docs/ui-visual-standard.md: Sim
  - docs/project-architecture.md: Sim
- **Areas possivelmente impactadas:**
  - Front-end: Sim (tabela do Banco de Leads)
  - Back-end: Nao previsto (reuso de dados ja retornados)
  - Banco de dados: Nao
  - Financeiro: Nao
  - Dashboards: Banco de Leads
  - Permissoes: Nao
  - Integracoes: Nao
  - Visual/UX: Sim (nova coluna informativa)
  - Arquitetura: Nao
- **Confirmacao:** A IA confirma que esta utilizando o workflow padrao do projeto antes de alterar codigo.
- **Proxima etapa:** Fase 1 - Entendimento e implementacao de diff minimo.

---

## 2026-07-06 - Inicio de tarefa IA

- **IA/Ferramenta:** Codex
- **Pedido resumido:** Continuar a investigacao da ultima conversa do Claude sobre envio real no Banco de Leads que nao saiu/ficou PENDING.
- **E projeto/tarefa de alteracao?** Sim (correcao backend em integracao WhatsApp/disparo de leads).
- **Workflow padrao consultado?**
  - AGENTS.md: Sim
  - CLAUDE.md: Sim
  - docs/ai-workflow.md: Sim
  - docs/project-map.md: Sim
  - docs/architecture-rules.md: Sim
  - docs/ui-visual-standard.md: Nao aplicavel
  - docs/project-architecture.md: Sim
- **Areas possivelmente impactadas:**
  - Front-end: Nao
  - Back-end: Sim (integracao Evolution e servico de disparo)
  - Banco de dados: Nao previsto
  - Financeiro: Nao
  - Dashboards: Banco de Leads apenas por refletir status ja gravado
  - Permissoes: Nao
  - Integracoes: Sim (Evolution API)
  - Visual/UX: Nao
  - Arquitetura: Nao
- **Confirmacao:** A IA confirma que esta utilizando o workflow padrao do projeto antes de alterar codigo.
- **Proxima etapa:** Fase 1 - Entendimento e correcao de diff minimo.

---

## 2026-07-06 - Inicio de tarefa IA

- **IA/Ferramenta:** Claude Code (Opus 4.8)
- **Pedido resumido:** Passar a coleta de dados do Google Maps (prospeccao/Aquisicao) da Places API oficial para a API da Bright Data (reduzir custo / usar fornecedor ja contratado).
- **E projeto/tarefa de alteracao?** Sim (nova integracao de fonte de dados na prospeccao — estrutural).
- **Workflow padrao consultado?**
  - AGENTS.md: Sim
  - CLAUDE.md: Sim
  - docs/ai-workflow.md: Sim
  - docs/project-map.md: Sim
  - docs/architecture-rules.md: Sim
  - docs/ui-visual-standard.md: Nao aplicavel
  - docs/project-architecture.md: Sim
- **Areas possivelmente impactadas:**
  - Front-end: Talvez (UX do botao Rodar se a fonte for assincrona)
  - Back-end: Sim (pesquisarPlaces + novo provider Bright Data)
  - Banco de dados: Nao previsto (mesmo shape de prospect)
  - Financeiro: Sim (troca de custo de coleta)
  - Dashboards: Aquisicao/Banco de Leads (alimentacao)
  - Permissoes: Nao
  - Integracoes: Sim (Bright Data — nova rota/produto)
  - Visual/UX: Talvez
  - Arquitetura: Sim (abstracao de provider de busca)
- **Confirmacao:** A IA confirma que esta utilizando o workflow padrao do projeto e vai CONFIRMAR o escopo (produto Bright Data + substituir vs adicionar) antes de alterar codigo.
- **Proxima etapa:** Fase 1 - Analise de impacto + decisao de produto/credencial com o usuario (aguardando confirmacao).

---

## 2026-07-06 - Inicio de tarefa IA

- **IA/Ferramenta:** Claude Code (Opus 4.8)
- **Pedido resumido:** Permitir REUTILIZAR o contexto de uma instancia em outra (sem recriar). Controle na pagina de contexto da instancia; duas formas: compartilhar (mesmo contexto) e duplicar (copia editavel).
- **E projeto/tarefa de alteracao?** Sim (feature front + endpoint backend de clone).
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | ai-workflow: Sim | project-map: Sim | architecture-rules: Sim | ui-visual-standard: Sim | project-architecture: Sim
- **Areas possivelmente impactadas:**
  - Front-end: Sim (instancias/[id]/contexto/page.tsx — painel de reuso)
  - Back-end: Sim (api-whatsapp.js — endpoint /contexto/duplicar + helper duplicarContexto)
  - Banco de dados: Nao (reusa app.empresa_contextos; sem migration)
  - Integracoes/Prompts/Permissoes: Nao (rota ja e requireAuth+requireEmpresaAccess)
  - Arquitetura: Baixo (reusa PATCH existente p/ compartilhar; clone isolado por transacao)
- **Confirmacao:** Workflow padrao seguido; escopo confirmado com o usuario (controle na pagina de contexto).
- **Proxima etapa:** Implementado e validado (846 testes, tsc 0, e2e compartilhar+duplicar OK).

---

## 2026-07-20 - Inicio de tarefa IA

- **IA/Ferramenta:** Claude Code (Opus 4.8)
- **Pedido resumido:** Criar a pagina de Follow-ups (`/dashboard/follow-ups`, admin) com 3 modos:
  Automatico (visao/controle do motor atual + reprocessar falhas), Semi (LISTA DE QUEM LIGAR:
  call score por criterios + roteiro de ligacao por IA + meta diaria configuravel) e Manual
  (gerar/enviar follow-up por IA). Escopo Fase 1 travado; registrar resultado da ligacao e a
  escada de escalonamento sao Fase 2; config editavel de pesos/intervalos e Fase 3. Plano
  completo em scratchpad/follow-ups-plano.md.
- **E projeto/tarefa de alteracao?** Sim (feature grande — front + back + migration + IA).
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | ai-workflow: Sim |
  project-map: Sim | architecture-rules: Sim | ui-visual-standard: Sim | project-architecture: Sim
- **Areas possivelmente impactadas:**
  - Front-end: Sim (nova pagina follow-ups + item no Sidebar)
  - Back-end: Sim (nova rota api-follow-ups + servicos de score/listagem; reusa motor de followup)
  - Banco de dados: Sim (migration aditiva: followup_config; followup_ligacoes so na Fase 2)
  - Custos: Sim (roteiro de ligacao + follow-up manual usam IA — ja rastreado na pagina Uso & Custo)
  - Integracoes: WhatsApp (envio ja existente) + IA (generateAIResponse)
  - Permissoes: rota admin-only
  - Visual/UX: Sim (padrao do Banco de Leads)
  - Arquitetura: Media (REUSAR o motor de follow-up existente, nao recriar envio/agendamento)
- **Confirmacao:** Workflow padrao seguido; escopo Fase 1 confirmado com o usuario.
- **Proxima etapa:** Fase 1 passo 1 — migration followup_config + db/followup-config.js.

---

## 2026-07-20 - Inicio de tarefa IA (Follow-ups Fase 2)

- **IA/Ferramenta:** Claude Code (Opus 4.8)
- **Pedido resumido:** Fase 2 da pagina de Follow-ups: (1) REGISTRAR RESULTADO da ligacao
  (atendeu / nao_atendeu / agendou / sem_interesse / ligar_depois) com notas + quem registrou;
  (2) efeitos: sem_interesse pausa o auto follow-up do lead, opcao de disparar follow-up no
  WhatsApp quando nao_atendeu, e dedup (lead ligado nas ultimas 12h sai da call-list);
  (3) METRICAS ligação (total, por resultado, taxa de agendamento); (4) ESCADA de escalonamento
  visivel (lead que ignorou N follow-ups ganha selo "mensagem esgotou, hora de ligar").
- **E projeto/tarefa de alteracao?** Sim (feature — front + back + migration).
- **Workflow padrao consultado?** AGENTS.md/CLAUDE.md/ai-workflow/project-map/architecture-rules: Sim.
- **Areas possivelmente impactadas:**
  - Front-end: Sim (aba Semi da pagina Follow-ups: modal de registro + cards de metricas + selo escalado)
  - Back-end: Sim (novo db/followup-ligacoes.js + endpoints na rota api-follow-ups; ajuste em followup-listing.montarCallList)
  - Banco de dados: Sim (migration aditiva `030_followup_ligacoes.sql` = vendas.followup_ligacoes)
  - Custos: eventual disparo de follow-up no WhatsApp reusa o Manual (IA ja rastreada)
  - Integracoes: WhatsApp (envio ja existente via followup-manual), sem novas
  - Permissoes: endpoints admin-only (mesmo mount da pagina)
  - Arquitetura: Baixa/Media — reusa followup-manual para o disparo; nao mexe no engine.
- **Confirmacao:** Escopo Fase 2 escolhido pelo Victor (AskUserQuestion). Sem env nova.
- **Proxima etapa:** migration 030 + src/db/followup-ligacoes.js.

---

## 2026-07-21 - Inicio de tarefa IA (Modulo Prospeccao & Inteligencia Comercial - Fase 0)

- **IA/Ferramenta:** Claude Code (Opus 4.8)
- **Pedido resumido:** Planejamento aprovado do modulo "Prospeccao & Inteligencia Comercial"
  (nichos, campanhas, roteiros humanos versionados, central de ligacoes, operacao da ligacao,
  follow-ups redefinida, inteligencia comercial). Fase 0 = fundacao de DADOS, SEM UI. Primeira
  fatia vertical: **Roteiros versionados** (schema + enums + acesso a dados + testes).
- **E projeto/tarefa de alteracao?** Sim (feature grande, multi-fase). Fase 0 = so backend/dados.
- **Workflow padrao consultado?** AGENTS.md/CLAUDE.md/architecture-rules/project-map: Sim.
- **Areas impactadas nesta fase:**
  - Banco: migration aditiva `033_roteiros.sql` (app.roteiros / roteiro_versoes / roteiro_etapas).
  - Enums: `src/domain-enums.js` + `test/domain-enums.test.js` (ROTEIRO_VERSAO_STATUS, ROTEIRO_ETAPA_TIPO).
  - Multi-tenant: todas as tabelas com empresa_id NOT NULL + isolamento por filtro (padrao existente).
  - Front-end: NENHUM nesta fase.
- **Decisoes travadas com o Victor:** plano consolidado aprovado (opcao "a"); unificar followup_ligacoes
  em ligacoes (fase futura), catalogo de nicho + texto, gating por app.usuarios_empresas.role.
- **Reversibilidade:** LOCAL only nesta etapa (aplica no banco clonado local, roda testes, SEM push);
  schema apresentado ao Victor para revisao antes de qualquer deploy.
- **Proxima etapa:** migration 033 + enums + teste anti-drift; depois db/roteiros.js (CRUD + imutabilidade).

---

<!-- Modelo para novas entradas (copie o bloco abaixo):

## [DATA] - Início de tarefa IA

- **IA/Ferramenta:**
- **Pedido resumido:**
- **É projeto/tarefa de alteração?** Sim/Não
- **Workflow padrão consultado?**
  - AGENTS.md: Sim/Não/Inexistente
  - CLAUDE.md: Sim/Não/Inexistente
  - docs/ai-workflow.md: Sim/Não/Inexistente
  - docs/project-change-map.md: Sim/Não/Inexistente
  - docs/ai-decision-log.md: Sim/Não/Inexistente
  - docs/ui-visual-standard.md: Sim/Não/Inexistente/Não aplicável
  - docs/project-architecture.md: Sim/Não/Inexistente/Não aplicável
- **Áreas possivelmente impactadas:**
  - Front-end / Back-end / Banco / Financeiro / Dashboards / Assinaturas / Custos / Permissões / Integrações / Visual-UX / Arquitetura
- **Confirmação:** A IA confirma que está utilizando o workflow padrão do projeto antes de alterar código.
- **Próxima etapa:** Fase 1 - Entendimento do Pedido.

-->

---

## 2026-07-15 - Inicio de tarefa IA

- **IA/Ferramenta:** Codex
- **Pedido resumido:** Corrigir gargalos de performance no Banco de Leads: subqueries correlacionadas do GET /leads, chamadas seriais da Evolution no GET /conexao-resumo, indice do proximo lead automatico e pool PostgreSQL subdimensionado.
- **E projeto/tarefa de alteracao?** Sim (performance de backend, banco e integracao externa).
- **Workflow padrao consultado?**
  - AGENTS.md: Sim
  - CLAUDE.md: Sim
  - docs/ai-workflow.md: Sim
  - docs/project-map.md: Sim
  - docs/architecture-rules.md: Sim
  - docs/project-change-map.md: Sim
  - docs/ai-decision-log.md: Sim
  - docs/ui-visual-standard.md: Nao aplicavel
  - docs/project-architecture.md: Sim
- **Areas possivelmente impactadas:**
  - Front-end: Nao (contratos HTTP preservados)
  - Back-end: Sim (rotas Banco de Leads e WhatsApp, configuracao do pool)
  - Banco de dados: Sim (indices aditivos e idempotentes)
  - Financeiro: Nao
  - Dashboards: Sim (menor latencia, sem mudanca visual)
  - Permissoes: Nao
  - Integracoes: Sim (Evolution API consultada em paralelo e com cache curto)
  - Visual/UX: Nao
  - Arquitetura: Nao (otimizacao dentro das camadas existentes)
- **Confirmacao:** O usuario solicitou explicitamente as correcoes, incluindo a migration de indice. A IA confirma que esta usando o workflow padrao do projeto.
- **Proxima etapa:** Fases 1 a 9 - impacto, implementacao de diff minimo e testes.

---

## 2026-07-15 - Inicio de tarefa IA

- **IA/Ferramenta:** Codex
- **Pedido resumido:** Corrigir bugs criticos dos modos Manual, Semi e Automatico: disparo duplicado, falta de compliance, falso sucesso de entrega, filtro de WhatsApp, timezone e teto diario elevado sem revisao.
- **E projeto/tarefa de alteracao?** Sim (seguranca operacional, banco, worker e integracao Evolution).
- **Workflow padrao consultado?**
  - AGENTS.md: Sim
  - CLAUDE.md: Sim
  - docs/ai-workflow.md: Sim
  - docs/project-map.md: Sim
  - docs/architecture-rules.md: Sim
  - docs/project-change-map.md: Sim
  - docs/ai-decision-log.md: Sim
  - docs/ui-visual-standard.md: Nao aplicavel
  - docs/project-architecture.md: Sim
- **Areas possivelmente impactadas:**
  - Front-end: Sim (texto/default do teto, sem mudanca de layout)
  - Back-end: Sim (disparo, elegibilidade e worker)
  - Banco de dados: Sim (claim unico, message id e backfill 100 para 40)
  - Financeiro: Sim (evita chamadas IA duplicadas)
  - Dashboards: Sim (status de entrega mais honesto)
  - Permissoes: Nao
  - Integracoes: Sim (Evolution API)
  - Visual/UX: Nao
  - Arquitetura: Nao (reuso das camadas e locks existentes)
- **Confirmacao:** O usuario solicitou explicitamente as correcoes e identificou o backfill ausente. A IA confirma que segue o workflow padrao.
- **Proxima etapa:** Implementacao do claim atomico, compliance, entrega terminal, lock do worker e testes de concorrencia.

---

## 2026-07-15 - Inicio de tarefa IA

- **IA/Ferramenta:** Codex
- **Pedido resumido:** Adicionar rolagem horizontal no topo das tabelas do Banco de Leads e manter os nomes das colunas visiveis ao rolar os registros.
- **E projeto/tarefa de alteracao?** Sim (UX de tabela no frontend).
- **Workflow padrao consultado?** AGENTS.md, ai-workflow, project-map, architecture-rules, ui-visual-standard e guia visual: Sim.
- **Areas possivelmente impactadas:** Front-end e Visual/UX; sem impacto em backend, banco, permissoes, custos ou integracoes.
- **Confirmacao:** O pedido define diretamente o comportamento desejado e preserva o padrao existente de tabela operacional.
- **Proxima etapa:** Implementar wrapper de rolagem sincronizada e validar desktop/mobile.

---

## 2026-07-16 - Inicio de tarefa IA

- **IA/Ferramenta:** Codex (continuacao de tarefa iniciada no Claude)
- **Pedido resumido:** Fazer a geracao de mensagens do modo Semiautomatico continuar em segundo plano, incluir automaticamente leads novos e exibir progresso mensagem a mensagem no Banco de Leads.
- **E projeto/tarefa de alteracao?** Sim (worker existente, endpoint de leitura e UX no frontend).
- **Workflow padrao consultado?** AGENTS.md, ai-workflow, project-map, architecture-rules, ui-visual-standard e project-architecture: Sim.
- **Areas possivelmente impactadas:** Front-end e back-end; sem mudanca de banco, autenticacao, segredos, prompts ou integracoes externas.
- **Confirmacao:** O usuario pediu explicitamente para continuar a implementacao interrompida. A arquitetura preserva o worker existente e adiciona somente observabilidade por polling.
- **Proxima etapa:** Remover a geracao sincrona da tela, concluir o progresso visual e validar testes/typecheck.

---

## 2026-07-17 - Inicio de tarefa IA

- **IA/Ferramenta:** Codex
- **Pedido resumido:** Fazer a Aquisição respeitar o teto efetivo de 200 leads por busca, tornar o agendamento automático rodável, substituir os botões/modais de Agenda por menus operacionais inline em Google Maps e Instagram e planejar o modo Busca IA com indicação de esgotamento de nicho/localização.
- **E projeto/tarefa de alteracao?** Sim (backend, worker de busca, configuração e UX da Aquisição).
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md, docs/project-map.md, docs/architecture-rules.md e docs/project-architecture.md: Sim.
- **Areas possivelmente impactadas:** Front-end, back-end, worker, banco de dados, custos Bright Data e visual/UX; sem mudança em autenticação, segredos, prompts de atendimento ou envio de WhatsApp.
- **Confirmacao:** O usuário solicitou explicitamente as duas correções. O modo Busca IA será apenas planejado nesta etapa, sem ampliação silenciosa do escopo.
- **Proxima etapa:** Mapear o contrato da agenda e do snapshot, implementar diff mínimo e validar teto, execução em segundo plano e regressões.
## 2026-07-17 — Modo Busca IA configurável na Aquisição

- Pedido: implementar o modo Busca IA aprovado, com configuração simples, estratégia equilibrada, limite diário, intervalo seguro, preferências de nicho/localização e mensagens claras de estado/esgotamento.
- Áreas: configuração multiempresa de prospecção, migration PostgreSQL, scheduler/worker de busca, seletor de mercado por IA, tela `dashboard/prospeccao` e testes.
- Restrições: reutilizar `selecionarMercadoDiarioIA`; máximo de 200 leads importados por busca; uma busca por vez; nenhum envio de WhatsApp; sem nova dependência ou segredo.
- Validação prevista: testes de settings/scheduler/rotação/worker, suíte completa, typecheck, boot com migration e verificação visual responsiva.

---

## 2026-07-17 - Inicio de tarefa IA

- **IA/Ferramenta:** Codex (retomada de conversa iniciada no Claude)
- **Pedido resumido:** Verificar o modo Automatico do Banco de Leads e corrigir a fila que permanece vencida sem disparar.
- **E projeto/tarefa de alteracao?** Sim (worker existente e teste de regressao).
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md, docs/project-map.md, docs/architecture-rules.md, docs/project-change-map.md, docs/ai-decision-log.md e docs/project-architecture.md: Sim.
- **Areas possivelmente impactadas:** Back-end e worker do Banco de Leads; sem mudanca de banco, frontend, autenticacao, segredos, prompts ou integracoes.
- **Diagnostico confirmado:** O worker executa, mas seleciona repetidamente o lead de maior score mesmo quando ele possui reserva ativa; `rodarLeads` o rejeita e o ciclo retorna `nao_aceito` sem avancar para outro lead.
- **Confirmacao:** O usuario pediu para retomar a conversa do Claude e verificar o Automatico. A correcao sera um diff minimo na selecao da fila, com teste e validacao operacional real.
- **Proxima etapa:** Ignorar reservas ativas ao selecionar o proximo lead, rodar a suite e observar um ciclo real do worker.

---

## 2026-07-17 - Inicio de tarefa IA

- **IA/Ferramenta:** Codex
- **Pedido resumido:** Impedir que o modo Automatico pare quando os primeiros candidatos forem inelegiveis.
- **E projeto/tarefa de alteracao?** Sim (worker, reconciliacao operacional e testes).
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md, docs/project-map.md, docs/architecture-rules.md, docs/project-change-map.md, docs/ai-decision-log.md e docs/project-architecture.md: Sim.
- **Areas possivelmente impactadas:** Worker do Banco de Leads e observabilidade; sem migration, frontend, autenticacao, segredos, prompts ou novo endpoint.
- **Diagnostico confirmado:** A selecao limitada aos primeiros 15 candidatos encontrou 14 telefones fixos e 1 invalido; havia 139 celulares validos depois deles, com o primeiro na posicao 18.
- **Confirmacao:** O usuario aprovou explicitamente a varredura que avanca pelos inelegiveis, o reagendamento seguro, o resumo de motivos e a recuperacao de geracoes travadas.
- **Proxima etapa:** Implementar paginacao limitada por tick com cursor de continuacao, reconciliar `gerando` antigo e validar regressao/operacao real.

---

## 2026-07-20 - Inicio de tarefa IA

- **IA/Ferramenta:** Codex
- **Pedido resumido:** Adicionar uma busca simples por numero na pagina de Conversas e alinhar a listagem ao padrao visual das demais paginas operacionais.
- **E projeto/tarefa de alteracao?** Sim (UX e consulta da listagem de conversas).
- **Workflow padrao consultado?** AGENTS.md, docs/ai-workflow.md, docs/project-map.md, docs/architecture-rules.md, docs/ui-visual-standard.md, docs/GUIA-VISUAL-PJ-CODEWORKS.md e docs/project-architecture.md: Sim.
- **Areas possivelmente impactadas:** Front-end e rota autenticada de leitura de conversas; sem impacto em banco/schema, permissoes, segredos, prompts, jobs ou integracoes externas.
- **Confirmacao:** O pedido e pequeno, claro e preserva o padrao existente; nao exige confirmacao arquitetural adicional.
- **Proxima etapa:** Implementar filtro seguro por numero, reorganizar a listagem com os componentes existentes e validar testes/typecheck.

---

## 2026-07-20 - Inicio de tarefa IA

- **IA/Ferramenta:** Codex (continuacao de tarefa iniciada no Claude)
- **Pedido resumido:** Auditar o que faltava para concluir a Central de Follow-ups e finalizar os pontos pendentes apos confirmacao do usuario.
- **E projeto/tarefa de alteracao?** Sim (backend, banco, worker, UI, testes e governanca).
- **Workflow padrao consultado?** AGENTS.md, docs/ai-workflow.md, docs/project-map.md, docs/architecture-rules.md, docs/ui-visual-standard.md, docs/GUIA-VISUAL-PJ-CODEWORKS.md e docs/project-architecture.md: Sim.
- **Areas possivelmente impactadas:** Front-end, back-end, worker de jobs, banco, metricas de custo por empresa e UX; sem nova dependencia, segredo, prompt de producao ou permissao.
- **Diagnostico confirmado:** A pausa nao bloqueava jobs ja enfileirados; a API permitia envio complementar para resultados incompativeis; logs de IA perdiam referencias camelCase/empresa; validacao e cobertura HTTP estavam incompletas; tabelas precisavam de responsividade e filtros reversiveis.
- **Confirmacao:** O usuario confirmou explicitamente a execucao com "pode".
- **Proxima etapa:** Aplicar hardening de menor escopo, documentar e executar testes, typechecks, migration/boot e verificacao operacional.

---

## 2026-07-20 - Inicio de tarefa IA

- **IA/Ferramenta:** Codex
- **Pedido resumido:** Ampliar a aba Ligacoes para Atendimento humano, orientando a melhor proxima acao e o momento adequado para executa-la.
- **E projeto/tarefa de alteracao?** Sim (criterios operacionais no backend, UX e testes).
- **Workflow padrao consultado?** AGENTS.md, docs/ai-workflow.md, docs/project-map.md, docs/architecture-rules.md, docs/ui-visual-standard.md, docs/ai-decision-log.md e docs/project-architecture.md: Sim.
- **Areas possivelmente impactadas:** Servicos de priorizacao, consulta autenticada e tela de Follow-ups; sem migration, nova dependencia, segredo, prompt de producao, worker ou alteracao de permissao.
- **Confirmacao:** O usuario aprovou explicitamente a implementacao e restringiu preview a copia de prompt para geracao externa, sem gerar imagem dentro do projeto.
- **Proxima etapa:** Implementar a menor extensao do contrato existente e validar criterios, consulta real, suite completa, typechecks e aplicacao local.

## 2026-07-20 - Inicio de tarefa IA

- **IA/Ferramenta:** Codex
- **Pedido resumido:** Corrigir o modo Automatico da PJ Codeworks no Railway apos confirmar que todos os ticks falham antes de avaliar a empresa.
- **E projeto/tarefa de alteracao?** Sim (servico de disparo, worker e teste de regressao).
- **Workflow padrao consultado?** AGENTS.md, docs/ai-workflow.md, docs/project-map.md, docs/architecture-rules.md, docs/project-change-map.md, docs/ai-decision-log.md e docs/project-architecture.md: Sim.
- **Areas possivelmente impactadas:** Back-end, worker do Banco de Leads e leitura da tabela Evolution; sem migration, frontend, autenticacao, segredo, prompt ou alteracao de permissao.
- **Diagnostico confirmado:** O codigo consulta `public."MessageUpdate"`, mas o Railway armazena a tabela em `evolution."MessageUpdate"`; a reconciliacao lanca erro antes de executar o modo Automatico.
- **Confirmacao:** O usuario autorizou explicitamente a correcao. A solucao detectara somente os schemas permitidos `evolution` e `public`, preservando o Docker local e sem nova configuracao.
- **Proxima etapa:** Implementar a resolucao segura da relacao, adicionar cobertura dos dois ambientes, validar e observar um tick real no Railway.

---

## 2026-07-30 - Inicio de tarefa IA

- **IA/Ferramenta:** Claude Code
- **Pedido resumido:** Validacao funcional (QA de produto) da Central de Ligacoes fatias A-G, antes de iniciar o Painel de Gestao Comercial. Objetivo: confirmar se uma ligacao comercial completa gera todos os dados necessarios para analise gerencial futura.
- **E projeto/tarefa de alteracao?** Nao. Tarefa de VALIDACAO/QA, somente leitura de codigo + execucao de um cenario real contra o banco LOCAL de desenvolvimento. Nenhum arquivo de producao alterado.
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md: Sim.
- **Areas exercitadas:** src/routes/api-ligacoes.js, src/db/ligacoes.js, ligacao-etapas.js, ligacao-perguntas.js, ligacao-sinais.js, ligacao-objecoes.js, ligacoes-analitica.js, auditoria.js, view app.vw_ligacoes_analiticas e frontend/app/dashboard/central-ligacoes/page.tsx.
- **Efeito colateral declarado:** o cenario real criou 1 ligacao encerrada de teste no banco LOCAL (evolution_api) e moveu 1 campanha_lead para status follow_up. Nada em producao.
- **Proxima etapa:** Entregar o laudo de lacunas de coleta e a recomendacao sobre iniciar (ou nao) o Painel de Gestao Comercial.

---

## 2026-07-30 - Inicio de tarefa IA

- **IA/Ferramenta:** Claude Code
- **Pedido resumido:** Refinamento visual das colunas Telefone e Status da Central de Ligacoes — reduzir ruido de texto, transformar avisos de qualidade do numero em indicador + tooltip, validar leitura da coluna Status.
- **E projeto/tarefa de alteracao?** Sim, mas de escopo pequeno e seguro (apresentacao). Sem schema, sem autenticacao, sem prompt, sem rota nova.
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md: Sim.
- **Areas possivelmente impactadas:** frontend/app/dashboard/central-ligacoes/page.tsx (componente Fone + tabelas Fila/Acompanhamento) e frontend/lib/ligacao-fone.js (apenas o texto de aviso; regra de analise do telefone inalterada).
- **Fora de escopo declarado:** backend, banco, regras de negocio, demais telas.
- **Proxima etapa:** Aplicar o diff minimo, rodar `npm test` (frontend e backend) e `npm run typecheck`.

---

## 2026-07-30 - Inicio de tarefa IA

- **IA/Ferramenta:** Claude Code
- **Pedido resumido:** Analise arquitetural de IDENTIDADE UNICA entre a Central de Ligacoes (prospect_id) e a Central de Mensagens (numero/JID do WhatsApp), antes de qualquer integracao entre ligacao, WhatsApp e canais futuros.
- **E projeto/tarefa de alteracao?** Nao. Tarefa de DIAGNOSTICO/ANALISE, somente leitura de codigo/schema + consultas SELECT no banco LOCAL de desenvolvimento. O usuario proibiu explicitamente implementar nesta etapa.
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md: Sim.
- **Areas inspecionadas:** sql/init.sql (vendas.conversas, vendas.lead_profiles, prospectador.prospects), migrations 001/005/006/012/016/039/040/047, src/db-crud.js, src/services/historico-envio.js, src/services/rodar-leads.js, src/services/prospecting-eligibility.js, src/prospecting.js, src/agent.js, src/whatsapp.js, src/middleware/tenant.js, src/routes/api-conversas.js, src/routes/api-ligacoes.js, src/db/ligacoes.js, frontend/lib/ligacao-fone.js e as paginas central-ligacoes, banco-leads, follow-ups, conversas.
- **Efeito colateral declarado:** nenhum. As unicas escritas foram um INSERT/INSERT dentro de uma transacao com ROLLBACK explicito no banco LOCAL (simulacao de colisao multi-tenant); verificado que nada persistiu (count = 0). Nenhum arquivo de codigo alterado.
- **Proxima etapa:** Entregar o laudo tecnico (identidade canonica, normalizacoes divergentes, risco multi-tenant, alternativas e ordem de implementacao) e aguardar aprovacao antes de qualquer migration.


---

## 2026-08-04 - Inicio de tarefa IA

- **IA/Ferramenta:** Claude Code
- **Pedido resumido:** Reorganizar UI/UX da pagina de Aquisicao (aba Google Places = ProspeccaoPage): manter Rotinas de coleta e Busca avulsa no topo, deixar o Assistente de Oportunidades discreto com as Preferencias recolhidas dentro dele, promover a lista de leads a conteudo principal e reunir os blocos analiticos numa secao "Acompanhar resultados" com 3 abas (Desempenho por mercado / Respostas recentes / Historico de coletas, ex-"Atividade recente").
- **E projeto/tarefa de alteracao?** Sim, mas de escopo APRESENTACAO (frontend). Sem schema, sem migration, sem rota, sem regra de coleta/Bright Data/worker/permissao.
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md, docs/ui-visual-standard.md: Sim.
- **Areas possivelmente impactadas:** frontend/app/dashboard/prospeccao/page.tsx, frontend/components/RotinasAquisicao.tsx, frontend/components/AssistenteOportunidades.tsx e dois componentes novos de apresentacao (abas acessiveis + tabela de historico de coletas movida).
- **Fora de escopo declarado:** backend, banco, Banco de Leads, regras de sugestao/aprovacao do assistente, comportamento de Busca avulsa e das Rotinas, requisicoes de coleta.
- **Proxima etapa:** Aplicar o diff minimo de apresentacao, rodar `npm run typecheck` e `npm run build` no frontend e validar desktop/mobile com as tres abas com e sem dados.

---

## 2026-08-05 - Inicio de tarefa IA

- **IA/Ferramenta:** Claude Code
- **Pedido resumido:** Adicionar uma acao "Copiar contexto para IA" ao lado do selo de status da versao PUBLICADA do roteiro: monta um JSON legivel da versao exibida e copia para a area de transferencia, para o usuario colar manualmente numa IA externa e pedir sugestoes de melhoria.
- **E projeto/tarefa de alteracao?** Sim, de escopo PEQUENO e seguro (frontend/apresentacao + logica pura). Sem schema, sem migration, sem rota, sem chamada externa, sem escrita no banco, sem alteracao em publicacao/versionamento.
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md, docs/ui-visual-standard.md: Sim.
- **Ambiguidade resolvida com o usuario:** o pedido citava "Central de Ligacao", mas o selo "Publicada" da versao do roteiro so existe em frontend/app/dashboard/roteiros/page.tsx (a Central de Ligacoes nao tem seletor de versao nem selo). Usuario confirmou: acao fica na pagina Roteiros.
- **Areas possivelmente impactadas:** frontend/app/dashboard/roteiros/page.tsx (cabecalho da versao), frontend/components/ui/icons.tsx (icone novo copiar+brilho) e frontend/lib/roteiro-contexto-ia.js (+ .d.ts e .test.js, modulo PURO novo).
- **Fora de escopo declarado:** backend, banco, API, campanhas, fila de ligacoes, leads, automacoes, integracao com qualquer provedor de IA e importacao de resposta de IA.
- **Proxima etapa:** Implementar o diff minimo, rodar `npm test` + `npm run typecheck` no frontend e `npm test` no backend (garantia de nao regressao), e validar copia/fallback/acessibilidade na tela.
