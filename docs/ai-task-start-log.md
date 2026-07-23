# Registro de início de tarefas da IA

Toda IA deve registrar aqui o início de cada tarefa/projeto de alteração **antes**
de analisar profundamente ou alterar código (Fase 0 do workflow padrão — ver
[ai-workflow.md](ai-workflow.md)). Entradas em ordem cronológica inversa (mais recente no topo).

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
