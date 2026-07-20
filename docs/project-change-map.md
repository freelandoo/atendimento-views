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
