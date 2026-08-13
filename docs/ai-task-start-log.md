# Registro de inÃ­cio de tarefas da IA

Toda IA deve registrar aqui o inÃ­cio de cada tarefa/projeto de alteraÃ§Ã£o **antes**
de analisar profundamente ou alterar cÃ³digo (Fase 0 do workflow padrÃ£o â€” ver
[ai-workflow.md](ai-workflow.md)). Entradas em ordem cronolÃ³gica inversa (mais recente no topo).

---

## 2026-08-12 - Início de tarefa IA - Simplifica controles de modo/IA no ConversaPainel (Central de Mensagens)

- **IA/Ferramenta:** Claude Code (Sonnet 5), rodando em worktree isolado (`simplifica-modo-ia-painel`), job em background.
- **Pedido resumido:** Reduzir ruído visual do bloco "Modo desta conversa" no `ConversaPainel.tsx`:
  rótulos compactos (Padrão/Conversa/Análise), remover o texto explicativo fixo abaixo do
  controle (movendo a explicação para tooltip curto por opção) e transformar "Retomar agente"
  num botão mais compacto/visual, posicionado perto de "Prioridade comercial".
- **É projeto/tarefa de alteração?** Sim, pequena e 100% de apresentação (frontend): sem schema,
  sem migration, sem rota nova, sem chamada nova ao backend.
- **Workflow consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md: Sim.
  `docs/ui-visual-standard.md` não existe como arquivo neste repositório (mesma observação já
  registrada em entradas anteriores da série).
- **Mapeamento feito antes de editar:**
  1. `frontend/components/ConversaPainel.tsx:566-603` — bloco "Modo desta conversa": usa
     `AlternadorModoIa` (3 opções, `opcoesDePreferencia()`) + um `<p>` fixo com
     `descreverModo(...).estado` + `explicarOrigem(...)`, abaixo do controle.
  2. `frontend/components/ui/AlternadorModoIa.tsx` — já tem UM ícone `BalaoAjuda` (portal,
     hover/foco/toque, Escape) antes do grupo, mas só explica a opção ATIVA — não cada opção ao
     passar o mouse. `frontend/components/ui/MenuRadialAcoes.tsx` já usa `title={...}` nativo
     como padrão leve de tooltip por item nesta base de código (linhas 64/161/240) — é o padrão
     que darei seguimento em vez de inventar um novo componente.
  3. `frontend/lib/conversa-modo-ia.js` — `CATALOGO_PREFERENCIA` já tem `rotulo`/`curto`/`ajuda`
     por opção; `rotulo` de HERDAR é "Herdar padrão da Central" (longo demais pro botão
     compacto). Nenhuma regra de precedência/decisão de envio vive aqui — é só apresentação.
  4. `frontend/lib/conversa-modo-ia.test.js:299-319` já tem uma guarda que proíbe
     `conversas/page.tsx` e `follow-ups/page.tsx` de voltar a escrever o estado por extenso ao
     lado do controle. `ConversaPainel.tsx` não está na lista — vou adicioná-lo, já que a mudança
     pedida é exatamente remover essa mesma classe de texto fixo de lá também.
  5. **Achado que trava a Fase 2 (checkpoint):** o botão "Pausar/Retomar agente" hoje vive no
     rodapé de ações, DELIBERADAMENTE separado do bloco "Prioridade comercial" — há um comentário
     no próprio código (`ConversaPainel.tsx:549-551`) dizendo que o selo "Agente: pausado/ativo"
     foi TIRADO de perto de "Prioridade comercial" porque "dois lugares dizendo a mesma coisa se
     contradizem cedo", e o estado de atuação da IA passou a viver inteiro no bloco "Modo desta
     conversa". Além disso, o AGENTS.md documenta que `modo_ia` (persistente) e `agente_pausado`
     (efêmero) são dimensões DIFERENTES e "PROIBIDO fundi-los" — o envio automático exige os
     DOIS liberados. Renomear "Retomar/Pausar agente" para "Ativar/Desativar agente" bem ao lado
     de "Prioridade comercial" (fisicamente longe do bloco "Modo desta conversa") arrisca o
     operador entender esse botão como o controle mestre de "a IA responde ou não", quando na
     verdade ele só libera uma condição das duas exigidas. Vou perguntar ao usuário como
     prosseguir antes de implementar essa parte (rótulo real vs. rótulo pedido).
- **Arquivos que pretendo alterar:** `frontend/lib/conversa-modo-ia.js` (+ `.test.js`),
  `frontend/components/ui/AlternadorModoIa.tsx`, `frontend/components/ConversaPainel.tsx`.
  Nenhum arquivo de `backend/` tocado.
- **Validação prevista:** `npm run typecheck` (frontend), `npm test` (frontend, `lib/*.test.js`
  relevantes: `conversa-modo-ia.test.js`), `git diff --check`. Commit único + push direto para
  master **se** tudo passar — autorizado pelo pedido.

---

## 2026-08-12 - Início de tarefa IA - Anotações rápidas no radial da Central de Ligações + análise de canal E-mail em Follow-ups

- **IA/Ferramenta:** Claude Code (Sonnet 5)
- **Pedido resumido:** (1) Na Central de Ligações, aba Acompanhamento, transformar o botão
  solto "Registrar" num menu radial (reusando `MenuRadialAcoes`) com uma ação simples para
  "ver anotações rápidas" — abrindo uma visualização leve (modal) com a última anotação e
  botão Copiar, sem precisar abrir o registro completo da ligação. (2) Analisar onde e-mail
  já aparece hoje em ligações/leads/follow-ups e, **só se for seguro com dados/contratos já
  existentes**, adicionar identificação/filtro "Canal: E-mail" em Follow-ups; se exigir
  backend/migration/backfill, **parar com checkpoint** em vez de implementar.
- **É projeto/tarefa de alteração?** Sim, pequeno e de baixo risco na parte 1 (100%
  apresentação, reuso de componente/endpoint já existentes, sem rota nova, sem schema, sem
  regra de negócio nova). A parte 2 é **análise** que pode ou não virar código, conforme o
  próprio pedido condicionou.
- **Workflow padrão consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md: Sim |
  docs/ui-visual-standard.md: consultado via o padrão já registrado do radial (commits
  `1271749`/`bdec25a`/`ad29728`/`e0a8ab8`/`f6b3cab`) | docs/ai-decision-log.md: nada de novo a
  registrar — reuso de padrão já aprovado, nenhuma decisão arquitetural nova.
- **Verificação de conflito com trabalho paralelo:** `git log` mostra commits recentes de
  radial/pontuação/modo IA já mesclados na master; `git status` limpo antes de começar.
  Nenhum conflito nos arquivos alterados aqui.
- **Fatos confirmados no código ANTES de implementar:**
  1. `frontend/components/ui/MenuRadialAcoes.tsx` + `frontend/lib/menu-radial.js` **já
     existem** e já são usados em Follow-ups e Aquisição — reuso direto, sem radial paralelo.
     Com 1 ação vira botão comum; com 2+ vira o gatilho "⋯" com bolinhas.
  2. `GET /api/empresas/:id/ligacoes?campanha_lead_id=` (`backend/src/routes/api-ligacoes.js`,
     `db/ligacoes.js:listarLigacoes`) **já existe** e já devolve `notas` de ligações
     ENCERRADAS. `OperacaoLigacao` (mesmo arquivo) já consome esse endpoint para
     pré-preencher o campo de notas ao reabrir uma sessão — mas **nunca exibia** as notas de
     ligações passadas em lugar nenhum da tela. Nenhuma rota nova foi necessária.
  3. O tipo local `Ligacao` (linha ~137) não tinha o campo `notas` — adicionado como opcional
     (`notas?: string | null`), mudança aditiva sem efeito em quem já usava o tipo.
  4. `Copiar` + `navigator.clipboard.writeText` com fallback por `try/catch` e toast de erro é
     padrão já usado no repo (`components/ui/JsonLeadModal.tsx`,
     `app/dashboard/follow-ups/page.tsx`) — reaproveitado, não inventado.
  5. **E-mail em Central de Ligações:** `LeadEnriquecido.email` (linha ~105) já vem de
     `p.email` (`prospectador.prospects`, via `listarLeadsDaCampanha`/`filaDeTrabalho`) e já
     é exibido/filtrável (`EMAIL_OPCOES`, "E-mail disponível") — nada a fazer aqui, já
     cumprido antes desta tarefa.
  6. **E-mail em Follow-ups: NÃO EXISTE em lugar nenhum do payload.** Buscas por `email` em
     `backend/src/services/followup-listing.js`, `backend/src/db/follow-ups.js`,
     `frontend/app/dashboard/follow-ups/page.tsx` e `frontend/lib/followups-fila.js` não
     encontram nenhuma ocorrência (fora o e-mail do USUÁRIO responsável, que é outra coisa).
     Nenhuma das SELECTs que alimentam a fila (`montarCallList`, `listarAgendamentosAuto`,
     `GET /follow-ups/itens`) projeta e-mail de lead/prospect.
  7. **O canal do follow-up é um ENUM FECHADO no banco:** `FOLLOWUP_CANAL = ['whatsapp',
     'ligacao']` (`backend/src/services/follow-up-modelo.js`), validado por CHECK na
     migration `062_follow_ups.sql`. Adicionar `'email'` como canal real exigiria migration
     (alterar o CHECK) — mudança de schema, fora do que o pedido autoriza sem checkpoint.
  8. **Conclusão:** identificar/filtrar "Canal: E-mail" em Follow-ups **não é alcançável só
     com dados já carregados no cliente** — teria de nascer de uma mudança de backend
     (projetar e-mail na consulta, casando por telefone como `lead-nome-maps.js` já faz para
     nome) **e** de uma migration no enum de canal para ser um canal de verdade (não seria
     seguro fingir um "canal" que o banco não aceita). Por isso esta parte **PAROU em
     checkpoint** — nenhum código de Follow-ups nem de backend foi alterado.
- **Arquivos alterados:** `frontend/app/dashboard/central-ligacoes/page.tsx` (radial +ver
  anotações). Nenhum arquivo de `backend/` tocado. `docs/ai-task-start-log.md` (este registro).
- **Fora de escopo cumprido (nada disso foi feito):** backend/migration/schema/produção,
  envio real de e-mail, backfill automático, mudança na regra de seleção de canais reais de
  follow-up, redesign global de listagens.
- **Validação prevista:** `npm test` (frontend `lib/*.test.js`) e `npm run typecheck`
  (frontend). Backend não tocado ⇒ sem necessidade de rodar testes de backend.

---

## 2026-08-12 - Início de tarefa IA - Padronizar a coluna de Ações/radial (largura, centralização, cor "Conversa")

- **IA/Ferramenta:** Claude Code (Sonnet 5), rodando em worktree isolado (`padroniza-coluna-acoes-radial`), job em background.
- **Pedido resumido:** Tarefa pequena de implementaÃ§Ã£o visual: o operador validou visualmente o
  radial de Follow-ups (commit `e0a8ab8`, "Abrir conversa" virou a 4Âª bolinha), mas reportou que
  a bolinha "Concluir" (zona direita) fica apertada/encostando na bolinha central quando o radial
  abre, porque a coluna de aÃ§Ãµes nÃ£o tem largura/coluna prÃ³pria suficiente. Pedido: (1) criar/
  padronizar uma coluna "AÃ§Ã£o/AÃ§Ãµes" nas listagens com radial; (2) coluna fixa, nÃ£o removÃ­vel por
  personalizaÃ§Ã£o; (3) bolinha do radial sempre centralizada na coluna; (4) largura suficiente para
  o radial abrir sem colar na borda direita nem sobrepor a bolinha central; (5) verificar em todas
  as telas com radial (mÃ­nimo Follow-ups e AquisiÃ§Ã£o); Banco de Leads/Central de Mensagens nÃ£o tÃªm
  radial â€” sÃ³ checar alinhamento de aÃ§Ã£o/detalhes, sem inventar radial lÃ¡; (6) a bolinha "Conversa"
  do radial de Follow-ups ganha cor destacada (azul ou equivalente), para diferenciar navegaÃ§Ã£o/
  abertura de conclusÃ£o/confirmaÃ§Ã£o.
- **Ã‰ projeto/tarefa de alteraÃ§Ã£o?** Sim, pequena e 100% de apresentaÃ§Ã£o (frontend): sem schema,
  sem migration, sem rota nova, sem chamada nova ao backend, sem handler/regra de negÃ³cio tocada.
  Reaproveita `MenuRadialAcoes`/`lib/menu-radial.js` jÃ¡ existentes â€” nenhum radial novo Ã© criado.
- **Workflow consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md: Sim. `docs/ui-visual-standard.md`
  nÃ£o existe como arquivo neste repositÃ³rio (mesma observaÃ§Ã£o jÃ¡ registrada nas entradas anteriores
  da sÃ©rie de padronizaÃ§Ã£o visual). Entradas anteriores da sÃ©rie (radial em Follow-ups, AquisiÃ§Ã£o,
  Detalhes/BolinhaPontuacao) lidas para nÃ£o repetir decisÃµes jÃ¡ tomadas.
- **Causa raiz confirmada no cÃ³digo:**
  1. `frontend/components/ui/MenuRadialAcoes.tsx` posiciona as bolinhas satÃ©lite em coordenadas
     `position: fixed` (viewport), a `RAIO=56` px do centro do gatilho "â‹¯", clampadas sÃ³ nas bordas
     da VIEWPORT (`calcularGeometria`, `MARGEM=8`). A bolinha "direita" (Concluir) precisa de
     `RAIO + BOLHA/2 + MARGEM â‰ˆ 90px` livres Ã  direita do centro do gatilho; se o gatilho estÃ¡ perto
     da borda direita da tabela/pÃ¡gina, o clamp de viewport empurra a bolinha para a esquerda,
     colidindo com o prÃ³prio botÃ£o central â€” exatamente o sintoma relatado.
  2. `frontend/app/dashboard/follow-ups/page.tsx:474` â€” `<th>` da coluna de aÃ§Ãµes Ã©
     `px-4 py-3` com `<span className="sr-only">AÃ§Ãµes</span>` (sem largura prÃ³pria, sem rÃ³tulo
     visÃ­vel) e a `<td>` (:768) usa `text-right` + `flex justify-end` â€” o grupo de botÃµes (inclusive
     o gatilho do radial) fica colado na borda direita da cÃ©lula/tabela, sem margem de manobra.
  3. `frontend/app/dashboard/prospeccao/page.tsx:545` (reaproveitada por `aquisicao/page.tsx`) â€”
     mesmo padrÃ£o: `<th className="text-right px-3 py-2">AÃ§Ãµes</th>` sem largura mÃ­nima, `<td
     className="px-3 py-2 text-right whitespace-nowrap">` com o gatilho colado Ã  direita.
  4. Banco de Leads (`banco-leads/page.tsx`) e Central de Mensagens (`conversas/page.tsx`) **nÃ£o
     usam `MenuRadialAcoes`** (confirmado por grep) â€” Banco de Leads tem `CadastroDetalhesCelula`
     (bolinha + botÃ£o "Detalhes" na mesma cÃ©lula da coluna "Cadastro") e Central de Mensagens tem
     "Detalhes" ao lado do badge de Interesse + botÃµes "HistÃ³rico"/remover na coluna AÃ§Ãµes
     (`text-right` + `inline-flex gap-2`, jÃ¡ sem radial). Ambas permanecem **fora de escopo** desta
     tarefa (nenhum radial serÃ¡ criado) â€” sÃ³ uma checagem visual de que o alinhamento atual nÃ£o
     quebra, sem alteraÃ§Ã£o de cÃ³digo nelas se jÃ¡ estiver correto.
  5. `frontend/lib/menu-radial.js` (`TOM_CLASSES`) sÃ³ tem `positivo` (emerald)/`negativo` (red)/
     `neutro`. A aÃ§Ã£o "Conversa"/"LigaÃ§Ã£o" (`id: 'executar'`, zona `baixo`) e "Abrir conversa"
     (`id: 'abrir_conversa'`, zona `direita`) hoje usam `tom: 'positivo'` â€” mesma cor de "Concluir",
     que Ã© confirmaÃ§Ã£o/conclusÃ£o, nÃ£o navegaÃ§Ã£o. Ã‰ essa mistura de tom que o pedido nomeia no item 6.
- **DecisÃ£o (autocontida, baixo risco):**
  1. Nenhuma das duas tabelas (Follow-ups, AquisiÃ§Ã£o/ProspecÃ§Ã£o) tem sistema de personalizaÃ§Ã£o de
     colunas (`âš™ Personalizar`/toggle) â€” sÃ³ o Banco de Leads tem, e ele nÃ£o usa radial. Logo o
     requisito "coluna fixa, nÃ£o removÃ­vel por personalizaÃ§Ã£o" jÃ¡ vale por construÃ§Ã£o; nÃ£o crio
     nenhum mecanismo de toggle novo (evita inventar uma capacidade de remover que hoje nÃ£o existe).
  2. Dar Ã  coluna de aÃ§Ãµes um `min-width` explÃ­cito (suficiente para o(s) botÃ£o(Ãµes) primÃ¡rio(s) +
     o gatilho do radial lado a lado, com folga) e trocar o alinhamento de `text-right`/`justify-end`
     para `text-center`/`justify-center` nas duas tabelas â€” centralizar dentro de uma coluna mais
     larga aumenta a distÃ¢ncia real entre o centro do gatilho e a borda direita da tabela/pÃ¡gina,
     que Ã© a causa raiz do aperto. MantÃ©m o rÃ³tulo do cabeÃ§alho como jÃ¡ estava (sr-only em
     Follow-ups, visÃ­vel em AquisiÃ§Ã£o) â€” nÃ£o Ã© o alvo do pedido, sÃ³ largura/centralizaÃ§Ã£o/cor.
  3. Nova cor no vocabulÃ¡rio do radial: acrescento o tom `navegacao` (azul, mesmo padrÃ£o de classes
     `border-*-300 bg-*-50 text-*-700 hover:bg-*-100` dos tons existentes) em `lib/menu-radial.js` +
     `.d.ts`, e aplico nas duas aÃ§Ãµes de abrir conversa/ligaÃ§Ã£o em Follow-ups (`executar` e
     `abrir_conversa`). NÃ£o mexo em `positivo`/`negativo`/`neutro` nem nos usos existentes deles
     (Concluir continua emerald, Cancelar/Descartar continuam vermelho).
- **Arquivos que pretendo alterar:** `frontend/lib/menu-radial.js` (+ `.d.ts`/`.test.js` â€” novo tom
  `navegacao`), `frontend/app/dashboard/follow-ups/page.tsx` (largura/centralizaÃ§Ã£o da coluna AÃ§Ãµes
  + tom `navegacao` nas aÃ§Ãµes de abrir conversa/ligaÃ§Ã£o), `frontend/app/dashboard/prospeccao/page.tsx`
  (largura/centralizaÃ§Ã£o da coluna AÃ§Ãµes). Nenhum arquivo de `backend/` tocado; nenhuma regra de
  negÃ³cio, handler, rota ou dado alterado â€” sÃ³ CSS/apresentaÃ§Ã£o e um tom de cor novo no vocabulÃ¡rio
  puro jÃ¡ existente.
- **Fora de escopo (declarado pelo pedido):** backend, banco, produÃ§Ã£o/Railway, seguranÃ§a, roteiro
  SPIN; redesenhar todas as listagens; regra geral de busca/filtros/paginaÃ§Ã£o; tornar a coluna de
  aÃ§Ãµes personalizÃ¡vel/removÃ­vel; criar radial em Banco de Leads ou Central de Mensagens.
- **ValidaÃ§Ã£o prevista:** `npm run typecheck` (frontend), `npm test` (frontend, `lib/menu-radial.test.js`
  e demais `lib/*.test.js` afetados), `git diff --check`. Commit Ãºnico direto em `master` (via push do
  worktree) se tudo passar e o diff nÃ£o sair do escopo combinado acima.

---

## 2026-08-12 - InÃ­cio de tarefa IA - PadronizaÃ§Ã£o de busca/filtros/paginaÃ§Ã£o (1Âª entrega): Banco de Leads + Central de LigaÃ§Ãµes

- **IA/Ferramenta:** Claude Code (Sonnet 5), rodando em worktree isolado (`frontend-listagens-padrao`), job em background.
- **Pedido resumido:** Primeira entrega, pequena/mÃ©dia e segura, da padronizaÃ§Ã£o de
  busca/filtros/paginaÃ§Ã£o das listagens (parte irmÃ£ da sÃ©rie de padronizaÃ§Ã£o visual do radial de
  AÃ§Ãµes, que Ã© tarefa PARALELA em outra sessÃ£o â€” `3ff7e02f` â€” e nÃ£o deve ser tocada aqui). Foco:
  (1) Banco de Leads: melhorar ausÃªncia de paginaÃ§Ã£o e reforÃ§ar filtros rÃ¡pidos, sem alterar
  backend; (2) Central de LigaÃ§Ãµes: adicionar campo de busca na fila principal, se de baixo
  risco; (3) manter coerÃªncia com AquisiÃ§Ã£o/Central de Mensagens, sem redesenhar tudo.
- **Ã‰ projeto/tarefa de alteraÃ§Ã£o?** Sim, pequena/mÃ©dia e 100% frontend: sem schema, sem
  migration, sem rota nova, sem chamada nova ao backend, sem prompt de produÃ§Ã£o tocado.
- **Workflow consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md: Sim. NÃ£o havia
  artifact/relatÃ³rio de anÃ¡lise desta rodada especÃ­fica localizÃ¡vel no histÃ³rico desta sessÃ£o â€”
  o mapeamento foi refeito lendo o cÃ³digo atual (registrado abaixo), como a prÃ³pria instruÃ§Ã£o
  do pedido previa para esse caso.
- **Mapeamento feito antes de editar:**
  1. `frontend/lib/paginacao.js` (+ `.d.ts`/`.test.js`) jÃ¡ existe, Ã© PURO/testado e Ã© a fonte
     Ãºnica de paginaÃ§Ã£o client-side (`paginar`, `resumoIntervalo`, `mostrarPaginacao`,
     `POR_PAGINA_PADRAO`), reexportado por `lib/fila-ligacoes-view.js` (Central de LigaÃ§Ãµes) e
     `lib/followups-fila.js` (Follow-ups), e consumido tambÃ©m pela AquisiÃ§Ã£o
     (`prospeccao/page.tsx`, paginaÃ§Ã£o **servidor**). **NÃ£o vou criar um segundo mÃ³dulo** â€” vou
     reusar exatamente este.
  2. `frontend/app/dashboard/banco-leads/page.tsx` â€” busca a lista INTEIRA da aba de uma vez
     (`GET .../leads`, sem `limit`/`offset`), filtra/ordena 100% client-side
     (`passaFiltrosView`/`ordenarPorView`, jÃ¡ existentes) e **nunca pagina**: as duas tabelas
     (`TabelaPlacesBanco`/`TabelaInstagramBanco`, linhas ~1631/1697) fazem `leads.map(...)` sobre
     o array inteiro. Com centenas/milhares de leads (nota do AGENTS.md: "fetch Ãºnico â‰¤1000"),
     a tabela cresce sem limite visual. JÃ¡ existem "filtros rÃ¡pidos" reais: as `ABAS` do funil
     (pills com contagem, servidor) e o botÃ£o "âš™ Personalizar" (filtros ricos client-side, chips
     de filtro ativo) â€” nÃ£o hÃ¡ ausÃªncia de filtro, e sim de UMA aba a mais de acesso rÃ¡pido para
     os 2-3 filtros mais usados sem abrir o modal, e de paginaÃ§Ã£o nas tabelas.
  3. `frontend/app/dashboard/central-ligacoes/page.tsx` â€” a aba "Fila" (fila principal de
     ligaÃ§Ã£o) jÃ¡ carrega a campanha inteira de uma vez (`GET .../fila?limit=500`) e jÃ¡ tem
     paginaÃ§Ã£o client-side completa (`paginar`/`mostrarPaginacao`/`PaginacaoFila`, reexportados
     de `lib/paginacao.js` via `lib/fila-ligacoes-view.js`) e um painel de filtros rico
     (`FiltrosFila`, flutuante em portal). **O que falta Ã© busca por texto livre** (nome/
     telefone) na prÃ³pria fila â€” ela sÃ³ existe na aba "Acompanhamento" (`busca`/`statusFiltro`,
     linha ~577/839), sobre `todosLeads`, um estado independente da fila. Adicionar um campo de
     busca **client-side** na fila (sobre o array jÃ¡ carregado, aplicado depois de
     `filtrarFila(fila, view)` e antes de paginar) Ã© aditivo, nÃ£o pede rota nova e nÃ£o toca o
     mÃ³dulo puro jÃ¡ testado (`lib/fila-ligacoes-view.js`) â€” fica um estado de tela isolado
     (`buscaFila`), no mesmo padrÃ£o do `local`/`nicho` jÃ¡ existentes no painel de filtros.
  4. `frontend/app/dashboard/prospeccao/page.tsx` (AquisiÃ§Ã£o) confirmado como referÃªncia: pills
     de status com contagem embutida no rÃ³tulo (`FILTROS_STATUS`) â€” Ã© o padrÃ£o que as `ABAS` do
     Banco de Leads jÃ¡ seguem (mesma geometria conceitual). Nenhuma mudanÃ§a necessÃ¡ria lÃ¡.
- **DecisÃ£o de escopo (baixo risco, sem tocar AÃ§Ãµes/radial):**
  - Banco de Leads: (a) paginar as duas tabelas com `paginar`/`resumoIntervalo`/
    `mostrarPaginacao` do mÃ³dulo existente, reset de pÃ¡gina ao trocar aba/origem/mercado/
    cidade/busca/view (mesmo padrÃ£o de Follow-ups/Central de LigaÃ§Ãµes); footer "Anterior/
    PrÃ³xima" no mesmo componente visual jÃ¡ usado em Follow-ups; (b) adicionar 2-3 chips de
    filtro rÃ¡pido (toggle) para os campos mais Ãºteis do `ViewConfig` jÃ¡ existente (`envio`,
    `site`, `disparo`), sem criar filtro novo â€” sÃ³ um atalho de UI para valores que o modal
    "Personalizar" jÃ¡ aceita.
  - Central de LigaÃ§Ãµes: adicionar busca de texto livre na aba Fila, 100% client-side, sem tocar
    `lib/fila-ligacoes-view.js` nem seus testes.
  - **Nenhuma coluna de AÃ§Ãµes, radial, `MenuRadialAcoes` ou `lib/menu-radial.js` serÃ¡ tocada**
    (tarefa paralela em outra sessÃ£o). Nenhum arquivo de `backend/` tocado. Nenhuma API nova,
    nenhum limite/contrato de paginaÃ§Ã£o servidor alterado.
- **Arquivos que pretendo alterar:** `frontend/app/dashboard/banco-leads/page.tsx`,
  `frontend/app/dashboard/central-ligacoes/page.tsx`. Nenhum arquivo novo (reaproveita
  `lib/paginacao.js` existente).
- **ValidaÃ§Ã£o prevista:** `npm run typecheck` (frontend), `npm test` (frontend, `lib/*.test.js`
  relevantes: `paginacao.test.js`, `fila-ligacoes-view.test.js`), `git diff --check`. Commit
  Ãºnico + push direto para `master` **se** tudo passar e o diff nÃ£o sair do escopo combinado
  acima â€” autorizado pelo prÃ³prio pedido.

---

## 2026-08-12 - InÃ­cio de tarefa IA - Follow-ups: "Abrir conversa" vira 4Âª bolinha do radial (zona `baixo`)

- **IA/Ferramenta:** Claude Code (Sonnet 5)
- **Pedido resumido:** CorreÃ§Ã£o pequena e pontual: no radial de aÃ§Ãµes de Follow-ups
  (`MenuRadialAcoes`), quando a linha tem as 4 aÃ§Ãµes principais (Cancelar/Reagendar/
  Concluir/Abrir conversa), "Abrir conversa" aparecia num painel de extras
  quadrado/lista em vez de virar bolinha como as outras trÃªs. Desejado: "Abrir
  conversa" vira a 4Âª bolinha do prÃ³prio radial (abaixo/centro), rÃ³tulo curto
  ("Conversa"/"LigaÃ§Ã£o"), no mesmo padrÃ£o visual das demais â€” sem card/lista nesse caso.
- **Ã‰ projeto/tarefa de alteraÃ§Ã£o?** Sim, pequena e de escopo controlado: 100%
  apresentaÃ§Ã£o, sem schema, sem migration, sem rota, sem handler novo â€” sÃ³ a
  geometria/zona do menu radial compartilhado e o mapeamento de uma aÃ§Ã£o jÃ¡ existente
  em Follow-ups. Nenhum arquivo de `backend/` tocado.
- **Workflow padrÃ£o consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md:
  Sim | docs/ui-visual-standard.md: nÃ£o consultado Ã  parte â€” o padrÃ£o a seguir Ã© o do
  prÃ³prio componente radial jÃ¡ existente (`MenuRadialAcoes`/`menu-radial.js`), que Ã© a
  fonte de verdade visual desta tela | docs/ai-decision-log.md: nada de arquitetural
  novo a registrar â€” Ã© extensÃ£o pontual de um padrÃ£o jÃ¡ aprovado (commits `1271749`,
  `bdec25a`, `ad29738`).
- **Causa raiz confirmada no cÃ³digo:** o radial (`frontend/lib/menu-radial.js`,
  `atribuirZonas`) sÃ³ reconhece 3 zonas direcionais (`cima`/`direita`/`esquerda`); toda
  aÃ§Ã£o sem zona, ou com zona colidida, cai em `extras` (painel quadrado). Em
  `frontend/app/dashboard/follow-ups/page.tsx`, dentro do bloco `emAberto`, a aÃ§Ã£o
  `executar` ("Abrir conversa"/"Ir para a ligaÃ§Ã£o") era empurrada **sem** `zona`
  (comentÃ¡rio explÃ­cito: "Sem zona de propÃ³sito"), enquanto Concluir/Reagendar/Cancelar
  jÃ¡ ocupavam direita/cima/esquerda â€” por isso ela sempre caÃ­a sozinha no quadrado de
  extras, mesmo sendo uma das 4 aÃ§Ãµes principais da linha, nÃ£o uma aÃ§Ã£o excedente.
- **Arquivos alterados:** `frontend/lib/menu-radial.js` (+ `.d.ts`/`.test.js`) â€” nova
  zona `baixo` em `atribuirZonas`, mesma regra de colisÃ£o das demais;
  `frontend/components/ui/MenuRadialAcoes.tsx` â€” geometria/posiÃ§Ã£o da 4Âª bolinha
  (abaixo do gatilho, mesmo raio das outras trÃªs) e sua renderizaÃ§Ã£o;
  `frontend/app/dashboard/follow-ups/page.tsx` â€” a aÃ§Ã£o `executar` passa a usar
  `zona: 'baixo'` com rÃ³tulo curto ("Conversa"/"LigaÃ§Ã£o"; texto completo preservado em
  `descricao`, usado no tooltip e no `aria-label`), sem mudar `onSelecionar`/destino.
- **Fora de escopo (declarado pelo pedido):** backend, banco, produÃ§Ã£o/Railway,
  seguranÃ§a, roteiro SPIN, regra de negÃ³cio das aÃ§Ãµes, e as demais telas
  (AquisiÃ§Ã£o/Banco de Leads/Central de Mensagens) â€” sÃ³ verificadas quanto a nÃ£o quebrar
  com a zona nova (o componente radial Ã© compartilhado).
- **ValidaÃ§Ã£o prevista:** `npm test` (frontend/lib) e `npm run typecheck` (frontend);
  verificaÃ§Ã£o de escopo do diff (`git diff --check`); commit Ãºnico direto em `master`.

---

## 2026-08-12 - InÃ­cio de tarefa IA - PadrÃ£o radial na AquisiÃ§Ã£o + Detalhes ao lado da pontuaÃ§Ã£o (Banco de Leads) + radial completo em Follow-ups + Detalhes ao lado do interesse (Central de Mensagens)

- **IA/Ferramenta:** Claude Code (Sonnet 5), rodando em worktree isolado (`radial-padrao-listagens`), job em background.
- **Pedido resumido:** ContinuaÃ§Ã£o da sÃ©rie de padronizaÃ§Ã£o visual das listagens (radial de
  `MenuRadialAcoes.tsx`/`lib/menu-radial.js`, jÃ¡ validado em Follow-ups) em 4 frentes, 100%
  frontend: (1) aplicar o radial na AquisiÃ§Ã£o para as aÃ§Ãµes Marcar/Descartar da tabela de
  prospecÃ§Ã£o; (2) no Banco de Leads, unificar a coluna "Detalhes" isolada com a coluna
  "Cadastro" (bolinha + botÃ£o pequeno), igual ao padrÃ£o jÃ¡ usado na AquisiÃ§Ã£o; (3) em
  Follow-ups, dobrar o botÃ£o "Abrir conversa"/"Ir para a ligaÃ§Ã£o" para dentro do radial quando
  isso nÃ£o quebrar o fluxo, deixando a linha sÃ³ com o radial como aÃ§Ã£o compacta; (4) na Central
  de Mensagens, colocar um botÃ£o pequeno de Detalhes ao lado do badge de Interesse, abrindo o
  painel da conversa jÃ¡ na aba Interesses, se houver suporte tÃ©cnico claro para o deep-link.
- **Ã‰ projeto/tarefa de alteraÃ§Ã£o?** Sim, pequena e 100% de apresentaÃ§Ã£o (frontend): sem
  schema, sem migration, sem rota nova, sem chamada nova ao backend, sem prompt de produÃ§Ã£o
  tocado. Reaproveita `MenuRadialAcoes`/`lib/menu-radial.js` jÃ¡ existentes â€” nenhum radial
  paralelo serÃ¡ criado.
- **Workflow consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md: Sim. `docs/ui-visual-standard.md`
  nÃ£o existe como arquivo neste repositÃ³rio (mesma observaÃ§Ã£o jÃ¡ registrada nas entradas
  anteriores da sÃ©rie). Entradas anteriores da sÃ©rie (radial em Follow-ups, polimento das
  bolinhas, Detalhes/BolinhaPontuacao) lidas por completo para nÃ£o repetir decisÃµes jÃ¡ tomadas.
- **Mapeamento feito antes de editar:**
  1. `frontend/app/dashboard/prospeccao/page.tsx:558-581` (reutilizado por
     `aquisicao/page.tsx`, que nÃ£o tem JSX prÃ³prio para a tabela) â€” coluna AÃ§Ãµes da tabela
     "Leads encontrados": para `status==='rejeitado'` mostra sÃ³ "Restaurar" (Ã­cone
     `IconUndo`, aÃ§Ã£o Ãºnica de desfazer); para os demais status mostra "Marcar" (sÃ³ quando
     `aguardando`, Ã­cone `IconStar`) e "Descartar" (sempre, Ã­cone `IconTrash`) â€” o par
     Marcar/Descartar Ã© exatamente o par de 2 aÃ§Ãµes que o prÃ³prio pedido cita como candidato
     natural ao radial (mesma cardinalidade do Concluir/Cancelar do Follow-ups).
  2. A coluna "Cadastro" desta MESMA tabela (linhas 540-551) jÃ¡ Ã© o padrÃ£o-alvo pedido para o
     Banco de Leads: `BolinhaCadastro` + botÃ£o texto pequeno "Detalhes"
     (`text-[11px] text-slate-500 underline-offset-2 hover:text-brand hover:underline`) na
     mesma cÃ©lula. NÃ£o precisa mudar nada aqui â€” Ã© a referÃªncia a copiar.
  3. `frontend/app/dashboard/banco-leads/page.tsx` â€” `TabelaPlacesBanco` (:1625-1689) e
     `TabelaInstagramBanco` (:1691-1764) tÃªm a coluna "Cadastro" (`cols.pontos`, TOGGLE do
     "âš™ Personalizar") separada da coluna "Detalhes" (`DetalhesCelula`, SEMPRE renderizada,
     fora do sistema de toggle). **Risco identificado:** se eu simplesmente mover o botÃ£o
     Detalhes para dentro do `{cols.pontos && ...}`, quem desligar a coluna "Pontos" no
     Personalizar perde o acesso a Detalhes â€” violaria "nÃ£o remover aÃ§Ã£o sem garantir caminho
     equivalente" do AGENTS.md. DecisÃ£o: tirar o `<th>`/`<td>` de Detalhes do sistema de
     toggle (tornÃ¡-lo permanente, como a coluna Nome jÃ¡ Ã©) e colocar `{cols.pontos &&
     <BolinhaCadastro .../>}` + o botÃ£o Detalhes SEMPRE dentro da mesma cÃ©lula â€” a bolinha
     some quando o operador desliga "Pontos", o acesso a Detalhes nunca some. `DetalhesCelula`
     (funÃ§Ã£o) fica sem uso depois disso nas duas tabelas â€” serÃ¡ removida (evitar cÃ³digo morto).
  4. `frontend/lib/pontuacao-indicador.test.js:205-217,269-277` â€” guardas de regressÃ£o que leem
     o fonte de `prospeccao/page.tsx` e `banco-leads/page.tsx` procurando `score_cadastro...
     text-(red|emerald)` e a coluna "Site" reintroduzida. Nenhuma das duas mudanÃ§as mexe nisso;
     sÃ³ preciso nÃ£o reintroduzir esses padrÃµes.
  5. `frontend/app/dashboard/follow-ups/page.tsx:614-786` (`LinhaFila`) â€” hoje `emAberto` (3
     aÃ§Ãµes jÃ¡ zoneadas: Concluir=direita, Reagendar=cima, Cancelar=esquerda) e
     `assumir_conversa`/`revisar_proposta` (0 aÃ§Ãµes no radial) tÃªm CADA UM seu prÃ³prio botÃ£o
     separado "Abrir conversa"/"Ir para a ligaÃ§Ã£o" (`bg-brand`, chamando `onExecutar`/
     `onAbrirHistorico`), fora do `MenuRadialAcoes`. `item.acao` Ã© um campo Ãºnico (string), entÃ£o
     `ligar`/`mensagem_manual`/`copiar_prompt_preview`/`assumir_conversa`/`revisar_proposta` sÃ£o
     mutuamente exclusivos entre si â€” sÃ³ `emAberto` (que depende de `followup_status`, campo
     independente) pode coexistir com qualquer um deles num item de fila mesclado (linha Ãºnica
     por conversa, conforme regra jÃ¡ documentada no AGENTS.md). Isso jÃ¡ podia produzir dois
     botÃµes "Abrir conversa" simultÃ¢neos hoje (comportamento prÃ©-existente, nÃ£o introduzido por
     esta mudanÃ§a) â€” decisÃ£o: dobrar CADA UM dos dois blocos para dentro do respectivo
     `acoesSecundarias`, preservando os handlers (`onExecutar`/`onAbrirHistorico`) e o rÃ³tulo
     condicional por `item.destino`, sem reordenar as zonas jÃ¡ validadas (Concluir/Reagendar/
     Cancelar) â€” a aÃ§Ã£o dobrada de `emAberto` entra SEM zona (vai para "extras", nÃ£o disputa
     zona com as 3 jÃ¡ estabelecidas); a de `assumir_conversa`/`revisar_proposta` entra com
     zona `direita`/tom `positivo` (Ã© a Ãºnica aÃ§Ã£o daquele estado na maioria dos casos, entÃ£o
     vira o prÃ³prio botÃ£o do fallback de 1 aÃ§Ã£o do `MenuRadialAcoes` â€” exatamente "linha sÃ³ com
     o radial"). Nenhuma outra aÃ§Ã£o primÃ¡ria (Registrar/Escrever/Copiar prompt) Ã© tocada â€” o
     pedido nomeia literalmente sÃ³ "Abrir conversa".
  6. `frontend/components/ConversaPainel.tsx:222-292` â€” jÃ¡ existe uma aba interna
     `abaModal: 'chat' | 'interesses'` (useState), resetada para `'chat'` a cada
     `carregarConversa()` (troca de `numero`). **Suporte claro para deep-link existe**: vou
     acrescentar uma prop opcional `abaInicial?: 'chat' | 'interesses'` (default `'chat'`,
     aditiva, nÃ£o quebra o uso em `follow-ups/page.tsx`, que nÃ£o passa a prop) e usar
     `abaInicial` no lugar do literal `'chat'` na linha que reseta a aba â€” colocando
     `abaInicial` nas dependÃªncias do `useCallback` de `carregarConversa`, para reabrir a MESMA
     conversa jÃ¡ focando Interesses funcionar mesmo sem trocar de nÃºmero.
  7. `frontend/app/dashboard/conversas/page.tsx:296-345` â€” coluna "Interesse" sÃ³ tem
     `<InteresseBadge compact />`; o botÃ£o "HistÃ³rico" (coluna AÃ§Ãµes) chama
     `setNumeroAberto(c.numero)`. Vou acrescentar um estado local `abaAberta` (`'chat' |
     'interesses'`), setado para `'chat'` no clique de "HistÃ³rico" e para `'interesses'` no
     clique do novo botÃ£o "Detalhes" ao lado do badge de Interesse â€” e passar
     `abaInicial={abaAberta}` para `<ConversaPainel>`. Sem rota nova, sem query string, sem
     estado no servidor.
- **Fora de escopo declarado (para nÃ£o repetir depois):** `RotinasAquisicao.tsx` (cards de
  rotina com Editar/Pausar/Remover) â€” o pedido nomeia literalmente "marcar e descartar" como o
  alvo do radial na AquisiÃ§Ã£o, que Ã© a tabela de prospecÃ§Ã£o, nÃ£o o card de rotina; redesenhar
  os cards de rotina seria alÃ©m do escopo pedido. `AssistenteOportunidades.tsx` (Aprovar/
  Descartar de UM lead por vez, fora de tabela) tambÃ©m fica fora â€” nÃ£o Ã© uma listagem com
  linhas, Ã© um fluxo de decisÃ£o sequencial. Nenhum arquivo de `backend/` serÃ¡ tocado.
- **Arquivos que pretendo alterar:** `frontend/app/dashboard/prospeccao/page.tsx`,
  `frontend/app/dashboard/banco-leads/page.tsx`, `frontend/app/dashboard/follow-ups/page.tsx`,
  `frontend/components/ConversaPainel.tsx`, `frontend/app/dashboard/conversas/page.tsx`.
  Nenhum arquivo novo (reaproveita `MenuRadialAcoes`/`lib/menu-radial.js` existentes).
- **ValidaÃ§Ã£o prevista:** `npm run typecheck` (frontend), `npm test` (frontend, `lib/*.test.js`
  relevantes: `menu-radial.test.js`, `pontuacao-indicador.test.js`, `conversa-modo-ia.test.js`),
  `git diff --check`. Commit Ãºnico + push para master **sÃ³ se** tudo passar e o diff nÃ£o sair
  do escopo combinado acima.

---

## 2026-08-11 - Inicio de tarefa IA - Radial de verdade em Follow-ups + linha sem duplicidade (2a entrega)

- **IA/Ferramenta:** Claude Code (Sonnet 5), rodando em worktree isolado (`followups-radial-polish`).
- **Pedido resumido:** A 1a entrega do radial (commit `1271749`) foi validada visualmente pelo
  operador e **reprovada**: o menu ainda parece um popover quadrado com uma grade 3x3 de botoes
  retangulares, nao um radial de verdade. Pedido: bolinhas de verdade posicionadas em torno do
  gatilho "â‹¯" nas direcoes literais (cima=agendar/remarcar, esquerda=cancelar/descartar,
  direita=concluir/resolver, centro/fora=fechar), acionamento por clique/toque (sem depender de
  hover), hover pode reforcar/explicar mas nao executar, foco/teclado minimo, Escape/click fora
  fecha. Junto, corrigir a linha do Follow-ups onde a linha secundaria repete o mesmo texto que
  ja aparece como nome/servico na linha principal (mais cidade colada) â€” a linha secundaria deve
  mostrar so a localizacao, sem repetir nicho/descricao.
- **E projeto/tarefa de alteracao?** Sim, pequena e 100% de apresentacao (frontend): sem schema,
  sem migration, sem rota nova, sem chamada nova ao backend. Reaproveita os mesmos dois arquivos
  criados na entrega anterior (`MenuRadialAcoes.tsx`, `lib/followups-fila.js`) em vez de criar
  componente novo.
- **Workflow consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md: Sim.
  `docs/ui-visual-standard.md` nao existe como arquivo neste repositorio (mesma observacao ja
  registrada nas entradas anteriores da serie de padronizacao visual).
- **Mapeamento feito antes de editar:**
  1. `frontend/components/ui/MenuRadialAcoes.tsx` â€” o "leque" hoje e' um `<div className="grid
     grid-cols-3 ...">` com botoes `rounded-lg border` (cantos levemente arredondados, NAO
     circulos) dentro de uma caixa retangular com sombra â€” daÃ­ o "parece caixa quadrada". A
     geometria pura (`lib/menu-radial.js`: `atribuirZonas`, cima/direita/esquerda/extras) esta
     correta e **nao precisa mudar**; so o componente visual precisa ser refeito.
  2. `frontend/app/dashboard/follow-ups/page.tsx:638-657` â€” o caso mais comum (`emAberto`) ja
     manda EXATAMENTE 3 acoes zoneadas (Concluir=direita, Reagendar=cima, Cancelar=esquerda),
     sem extras â€” ou seja, na maioria das linhas o menu pode ser 100% circular, sem nenhuma caixa
     retangular. Extras (ex.: "Cancelar automatico") so aparecem quando `item.ia_agendada`.
  3. `frontend/lib/followups-fila.js:167-168` (`contextoDoLead`) junta `negocio` + `cidade` com
     `Â·`. Nos itens de follow-up registrado (linha ~299/308), `nome` (que vira `rotulo`, a linha
     principal) e `contexto.negocio` usam a **mesma fonte** (`f.nome`) quando
     `nomeDeVerdade(f.nome)` da certo â€” por isso a linha secundaria repete o texto que ja esta
     em cima, com a cidade colada no fim. Mesmo padrao no bloco humano (linha ~346/354): `h.nome`
     (que e' `COALESCE(apelido, negocio)` no backend) vira `rotulo`, e `contexto` usa `h.negocio`
     de novo.
  4. `item.contexto` tambem alimenta a BUSCA da fila (`followups-fila.js:547`,
     `${rotuloLead(i)} ${i.nome||''} ${i.contexto||''}`) â€” nao posso simplesmente apagar negocio
     dali sem perder capacidade de busca por nome de negocio.
- **Decisao (baixo risco, aditiva):** criar um campo NOVO `localizacao` (so' a cidade, sem
  negocio) para a APRESENTACAO da linha secundaria; o campo `contexto` existente continua intacto
  e continua alimentando a busca â€” nenhum dado e' removido, so' o que a LINHA mostra muda. Sem
  coluna de UF no backend (`lead_profiles`/`prospects` so tem `cidade` texto livre), a
  localizacao mostrada e' a cidade como esta cadastrada â€” nao inveto abreviacao tipo "SBC" sem
  fonte de dado para isso.
- **Decisao de arquitetura do radial (autocontida, baixo risco):** manter o MESMO componente
  (`MenuRadialAcoes.tsx`) e a MESMA API (`AcaoRadial[]`, `atribuirZonas`), so' trocar o
  posicionamento de grid-3x3 para bolinhas (`rounded-full`) fixadas em coordenadas de tela ao
  redor do CENTRO do proprio botao "â‹¯" (cima/esquerda/direita a uma distancia fixa do centro,
  com clamp nas bordas da viewport), com um anel tracejado decorativo (`aria-hidden`) reforcando
  a leitura radial. Extras (quando existem) continuam num paines retangular pequeno abaixo do
  anel â€” nao da' pra encaixar lista de tamanho variavel num circulo. Sem gesto de arrastar nesta
  entrega (decisao ja registrada na entrega anterior: acionamento por clique/toque previsivel);
  fica documentado como fase seguinte no proprio componente, como ja estava.
- **Arquivos que pretendo alterar:** `frontend/components/ui/MenuRadialAcoes.tsx` (redesenho
  visual, mesma API), `frontend/lib/followups-fila.js` (+ `.d.ts`/`.test.js`, campo `localizacao`
  novo), `frontend/app/dashboard/follow-ups/page.tsx` (troca `item.contexto` por
  `item.localizacao` na linha secundaria da coluna Lead). Nenhum arquivo de `backend/` tocado.
- **Fora de escopo declarado (pelo proprio pedido):** backend, banco, Railway, producao,
  workers, seguranca de instancia, roteiro SPIN, credenciais; redesenhar outras listagens; mudar
  regra de negocio das acoes; remover acoes existentes; criar dependencia nova (CSS/React
  proprio, sem biblioteca de gestos).
- **Validacao prevista:** `npm run typecheck` (frontend), `npm test` (frontend, `lib/*.test.js`),
  `git diff --check`, conferencia visual manual do dev server. Commit unico + push para master
  **so' se** tudo passar e o diff nao sair do escopo combinado.

---

## 2026-08-11 - Inicio de tarefa IA - Primeira entrega da padronizacao visual: radial em Follow-ups + confirmacoes acessiveis

- **IA/Ferramenta:** Claude Code (Sonnet 5)
- **Pedido resumido:** Implementar a primeira entrega, pequena e incremental, da
  padronizacao visual descrita no relatorio "Padronizacao visual das listagens â€”
  Atendimento Views" (artifact `5823a4a6-8243-4274-9449-ebda5b2a6e58`, gerado apos os
  commits `33bdfbd`/`b019b0b`/`06563f9`/`6b3fff9`), incluindo o prototipo funcional do
  menu radial onde o relatorio recomenda maior ganho e menor risco.
- **E projeto/tarefa de alteracao?** Sim, **pequeno e 100% frontend**: sem schema, sem
  migration, sem env, sem rota nova, sem worker, sem arquivo de `backend/` tocado.
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md:
  Sim | docs/ui-visual-standard.md: a consultar na Fase 5 (a tarefa e' 100% de interface)
  | docs/ai-decision-log.md: a registrar na Fase 8 | relatorio do artifact: Sim (secoes
  1-8 lidas por completo).
- **Decisoes ja resolvidas pelo PRoprio pedido do operador (nao inventadas agora):**
  1. **Radial so' em Follow-ups nesta entrega** (D5 do relatorio) â€” Captacao tem 3-4
     acoes e tambem se beneficiaria, mas juntar as duas telas no mesmo diff excede o
     escopo "pequena/media" pedido; fica documentada como fase seguinte.
  2. **Acionamento no desktop e' por botao/icone previsivel** (nao por "clicar e
     segurar" puro) â€” o pedido exige "acionamento previsivel por botao/icone, sem
     depender apenas de hover fragil", o que resolve a D6 do relatorio a favor da
     alternativa mais conservadora (popover em leque no clique do gatilho "â‹¯", sem
     gesto de arrastar obrigatorio).
  3. **A coluna Acoes NAO e' removida** â€” o radial so' compacta o excesso de botoes
     secundarios que hoje quebra linha (`flex-wrap` em Follow-ups); a acao primaria de
     cada linha continua um botao normal, visivel, sem gesto.
- **Decisao D1 (`StatusPill.tsx`) permanece EM ABERTO nesta entrega**, por instrucao
  explicita do pedido ("Se houver duvida de produto sobre StatusPill.tsx... parar com
  checkpoint em vez de adivinhar"). R1 do relatorio (badge de status unificado) **nao
  sera implementado agora**; fica listado nas pendencias do relatorio final.
- **Decisoes D2/D3/D4 tambem ficam fora do escopo** desta entrega, por instrucao do
  pedido (nao mexer em paginacao/exportacao/limite do Banco de Leads sem checkpoint;
  D2/D3 sao fase 5 do proprio relatorio, risco medio, condicionadas a decisao de
  produto ja registrada como pendente em `docs/analise-indicador-pontuacao.md` Â§7.3).
- **Arquivos que pretendo alterar/criar:**
  - NOVOS `frontend/components/ui/MenuRadialAcoes.tsx` (componente do menu radial,
    reaproveitando o padrao de portal + Escape + medicao de `BolinhaPontuacao.tsx`) e
    `frontend/lib/menu-radial.js` (+ `.d.ts`/`.test.js`, regras puras de zona/geometria,
    no mesmo padrao PURO de `lib/pontuacao-indicador.js`).
  - ALTERADOS `frontend/app/dashboard/follow-ups/page.tsx` (adota o radial na coluna de
    Acoes da fila, mantendo a acao primaria visivel fora do menu),
    `frontend/components/ConversaPainel.tsx` (troca o `confirm()` nativo de "Deletar
    historico" por `ModalConfirmar`), `frontend/components/RotinasAquisicao.tsx` (troca
    o `window.confirm` de "Remover rotina" por `ModalConfirmar`) â€” as duas trocas de
    confirmacao sao exatamente as citadas no proprio pedido ("window.confirm
    remanescente em pontos seguros").
  - Docs: `AGENTS.md` (se necessario documentar o componente novo), `docs/ai-decision-log.md`.
- **Fora de escopo declarado (pelo proprio pedido):** backend, banco, schema,
  migrations, credenciais, producao, workers, seguranca de instancia, roteiro
  comercial; radial em qualquer tela alem de Follow-ups nesta entrega; alteracao de
  paginacao/exportacao/limite do Banco de Leads; remocao de acoes de negocio ou
  mudanca de destino funcional; badge de status unificado (D1 em aberto).
- **Validacao prevista:** `npm run typecheck` (frontend), `npm test` (frontend, se
  proporcional ao novo modulo puro), `git diff --check`, e conferencia de que nada fora
  de `frontend/`/`docs/` foi tocado. Commit unico + push para master **so' se** tudo
  passar e o diff nao sair do escopo combinado.

---

## 2026-08-11 - InÃ­cio de tarefa IA - PrÃ³xima etapa de padronizaÃ§Ã£o visual: BolinhaPontuacao, "Detalhes" e Central de Mensagens

- **IA/Ferramenta:** Claude Code (Sonnet 5), rodando em worktree isolado (`listagens-pontuacao-detalhes`).
- **Pedido resumido:** Continuar a padronizaÃ§Ã£o visual das listagens (sequÃªncia das entregas de
  truncamento de nomes e separaÃ§Ã£o nicho/cidade), com foco em: reaproveitar `BolinhaPontuacao`/
  `BolinhaCadastro` onde ainda hÃ¡ reimplementaÃ§Ã£o prÃ³pria, revisar a aÃ§Ã£o "Detalhes" onde houver
  duplicidade Ã³bvia de nome clicÃ¡vel + botÃ£o que faz a mesma coisa, e um ajuste de baixo risco na
  Central de Mensagens se algo concreto aparecer. Entrega pequena e segura, sem gesto radial, sem
  mexer em paginaÃ§Ã£o/exportaÃ§Ã£o do Banco de Leads, sem redesenhar todas as aÃ§Ãµes de linha.
- **Ã‰ projeto/tarefa de alteraÃ§Ã£o?** Sim, pequena e 100% de apresentaÃ§Ã£o (frontend): sem schema,
  sem migration, sem rota nova, sem chamada nova ao backend, sem prompt de produÃ§Ã£o tocado.
- **Workflow consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md: Sim. `docs/ui-visual-standard.md`
  nÃ£o existe como arquivo neste repositÃ³rio (mesma observaÃ§Ã£o jÃ¡ registrada em entradas anteriores).
  RelatÃ³rio de padronizaÃ§Ã£o anterior (artifact `a2d1196d-ac45-4fc6-b2ed-0ce90c1f5b95`, lido via
  WebFetch por jÃ¡ ter sido fornecido pelo operador): Sim â€” Ã© a referÃªncia principal desta etapa.
- **Mapeamento feito antes de editar:**
  1. `BolinhaPontuacao.tsx`/`BolinhaCadastro` (em `LeadDetalhesModal.tsx`) jÃ¡ sÃ£o reaproveitados em
     ProspecÃ§Ã£o, Banco de Leads (as duas tabelas), Central de LigaÃ§Ãµes (`CirculoPrioridade`) e
     Central de Mensagens (`InteresseBadge`, linha da tabela **e** painel) â€” confirmado lendo os 4
     arquivos. **NÃ£o hÃ¡ duplicidade a corrigir nesses pontos.**
  2. `frontend/app/dashboard/captacao/page.tsx:630-636` reimplementa a bolinha de pontuaÃ§Ã£o Ã  mÃ£o
     (`<span>` com semÃ¡foro vermelho/Ã¢mbar/verde), em vez de `BolinhaCadastro`. O relatÃ³rio aponta
     isso como reintroduÃ§Ã£o do antipadrÃ£o que o prÃ³prio AGENTS.md proÃ­be (paleta de prioridade
     dentro de completude de cadastro). O tipo `Lead` desta tela jÃ¡ tem `score_cadastro`,
     `score_cadastro_max` e `json_apresentacao` â€” os mesmos campos que `BolinhaCadastro` jÃ¡ lÃª com
     sucesso na tabela Instagram do Banco de Leads (`banco-leads/page.tsx:1739`, reuso confirmado,
     mesmo formato de dado). Baixo risco, sem decisÃ£o de produto pendente.
  3. `frontend/app/dashboard/follow-ups/page.tsx` (`LinhaFila`, dentro de `AÃ§Ãµes`): em trÃªs estados
     distintos e mutuamente exclusivos (item registrado nÃ£o aberto; item "assumir_conversa"/
     "revisar_proposta"; item sem aÃ§Ã£o humana/automÃ¡tica) existe um botÃ£o ("Ver conversa"/"Abrir
     conversa") que chama exatamente `onAbrirHistorico(item.numero)` â€” a MESMA funÃ§Ã£o que o nome do
     lead jÃ¡ dispara (nome Ã© sempre um botÃ£o clicÃ¡vel na coluna Lead, incondicional, linhas
     651-657). Confirmado lendo `frontend/lib/followups-fila.js:280-420` que os trÃªs estados nunca
     coexistem na mesma linha (cada item nasce de um Ãºnico laÃ§o), entÃ£o nÃ£o hÃ¡ risco de remover uma
     aÃ§Ã£o que sÃ³ *parecia* redundante por coincidÃªncia de estado.
  4. Central de LigaÃ§Ãµes, ProspecÃ§Ã£o e Banco de Leads: nome vai para o Google Maps (link externo) e
     "Detalhes" abre o modal â€” destinos DIFERENTES, sem duplicidade. Central de Mensagens: "HistÃ³rico"
     Ã© a Ãºnica aÃ§Ã£o que abre o painel, sem concorrÃªncia com o nome (que nÃ£o Ã© clicÃ¡vel na listagem).
     **Nenhuma mudanÃ§a nesses pontos.**
- **DecisÃ£o de escopo (o que fica de fora, registrado para nÃ£o repetir depois):**
  - A bolinha de prioridade do Follow-ups (`PRIORIDADE_DOT`, vermelho=urgente) **nÃ£o serÃ¡ tocada**:
    jÃ¡ estÃ¡ registrada no AGENTS.md como decisÃ£o de produto em aberto (a direÃ§Ã£o da cor diverge da
    paleta canÃ´nica de propÃ³sito, nÃ£o por descuido). CritÃ©rio de parada do prÃ³prio pedido.
  - Dentro da redundÃ¢ncia do Follow-ups, o botÃ£o "Abrir conversa" do estado
    `assumir_conversa`/`revisar_proposta` (estilo primÃ¡rio, `bg-brand`) **Ã© preservado**: ele
    funciona como sinal visual de "aÃ§Ã£o recomendada agora", distinto do nome (link de texto simples)
    â€” remover isso seria decisÃ£o de produto sobre hierarquia visual, nÃ£o limpeza Ã³bvia de
    duplicidade. SÃ³ os botÃµes secundÃ¡rios "Ver conversa" (estilo neutro, mesmo peso visual do nome)
    sÃ£o removidos, sem alterar destino funcional (o nome continua abrindo a mesma conversa).
  - Central de Mensagens: nenhuma duplicidade Ã³bvia encontrada na listagem em si; nenhuma mudanÃ§a
    visual serÃ¡ feita lÃ¡ nesta etapa alÃ©m de eventual polimento textual, se aparecer durante a
    implementaÃ§Ã£o.
- **Arquivos que pretendo alterar:** `frontend/app/dashboard/captacao/page.tsx`,
  `frontend/app/dashboard/follow-ups/page.tsx`. Nenhum arquivo de `backend/` tocado.
- **ValidaÃ§Ã£o prevista:** `npm run typecheck` (frontend) e `npm test` do frontend (`lib/*.test.js`).
  Commit Ãºnico + push para master **sÃ³ se** tudo passar e o diff nÃ£o sair do escopo acima â€”
  autorizado pelo operador neste pedido.

---

## 2026-08-11 - InÃ­cio de tarefa IA - Separar nicho e cidade nas listagens (1Âª etapa da padronizaÃ§Ã£o visual)

- **IA/Ferramenta:** Claude Code (Sonnet 5), rodando em worktree isolado (`listagens-nicho-cidade`).
- **Pedido resumido:** Primeira etapa de um relatÃ³rio de padronizaÃ§Ã£o visual das listagens jÃ¡
  concluÃ­do (planejamento externo, nÃ£o implementado ainda): separar nicho e cidade onde hoje
  aparecem mesclados/inconsistentes (concatenaÃ§Ã£o com `Â·` ou `/` no mesmo texto) no
  `LeadDetalhesModal` e nas tabelas de ProspecÃ§Ã£o/AquisiÃ§Ã£o Google Places e Banco de Leads
  Places, trocando por dois nÃ³s visuais claros; tornar cidade visÃ­vel onde sÃ³ existe em tooltip,
  se estiver no mesmo caminho e for baixo risco; mais uma varredura curta por pontos
  equivalentes de baixo risco. Fora de escopo: gesto radial, paginaÃ§Ã£o/exportaÃ§Ã£o, padronizar
  todas as aÃ§Ãµes de linha, backend/schema/prompts/produÃ§Ã£o/credenciais.
- **Ã‰ projeto/tarefa de alteraÃ§Ã£o?** Sim, pequena e 100% de apresentaÃ§Ã£o (frontend): sem schema,
  sem migration, sem rota nova, sem chamada nova ao backend, sem prompt de produÃ§Ã£o tocado.
- **Workflow consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md: Sim. `docs/ui-visual-standard.md`
  nÃ£o existe neste repositÃ³rio (mesma observaÃ§Ã£o jÃ¡ registrada na entrada anterior).
- **Mapeamento feito antes de editar:**
  1. `frontend/components/LeadDetalhesModal.tsx:136` â€” subtÃ­tulo do modal concatena
     `[lead.nicho, lead.cidade].filter(Boolean).join(' Â· ')` num texto Ãºnico.
  2. `frontend/app/dashboard/prospeccao/page.tsx:553` â€” coluna "Nicho / Cidade" da tabela Google
     Places (reaproveitada por `aquisicao/page.tsx`, que nÃ£o tem JSX prÃ³prio para isso):
     `{p.nicho} Â· {p.cidade}`, sem tratar ausÃªncia de um dos dois.
  3. Mesma tela, dois pontos equivalentes de baixo risco no MESMO arquivo jÃ¡ tocado:
     `:622` ("Desempenho por mercado", `{m.nicho} Â· {m.cidade}`) e `:664` ("Recentes",
     `{r.nicho} / {r.cidade}` â€” usa **barra**, a inconsistÃªncia de separador que o pedido cita
     explicitamente).
  4. `frontend/app/dashboard/banco-leads/page.tsx:1675` â€” coluna "Nicho / Cidade" da tabela
     Google Places do Banco de Leads: mesma concatenaÃ§Ã£o, jÃ¡ com `.filter(Boolean)` e fallback
     `'â€”'`.
- **DecisÃ£o de arquitetura (autocontida, baixo risco):** componente novo
  `frontend/components/ui/NichoCidade.tsx` (puro, sem hooks/estado) para os 4 pontos acima â€”
  evita duplicar a mesma lÃ³gica de "nicho em destaque + cidade em texto secundÃ¡rio, separados
  por um `Â·` decorativo (`aria-hidden`)" em 3 arquivos. Sem truncamento/tooltip: as cÃ©lulas
  nunca tiveram `max-w`/`truncate` nesse campo (o `<td>` quebra linha normalmente), entÃ£o nÃ£o hÃ¡
  risco de overflow a mitigar â€” `flex-wrap` no wrapper preserva esse comportamento.
- **DecisÃ£o de escopo (fora do pedido, registrada para nÃ£o repetir depois):** NÃƒO vou tocar as
  tabelas Instagram/LinkedIn (`banco-leads/page.tsx:1729` e `captacao/page.tsx:619`, onde cidade
  hoje sÃ³ existe no `title=`) nem `central-ligacoes/page.tsx` (`:817`, `:875`, mesmo padrÃ£o de
  concatenaÃ§Ã£o). O pedido nomeia literalmente "Google Places" e "Banco de Leads Places" no item
  4 do escopo permitido â€” mesmo precedente jÃ¡ registrado na entrada de truncamento (2026-08-11)
  para excluir a tabela Instagram do mesmo motivo. Fica como candidato para uma etapa futura.
- **Arquivos que pretendo criar/alterar:** NOVO `frontend/components/ui/NichoCidade.tsx`;
  ALTERADOS `frontend/components/LeadDetalhesModal.tsx`, `frontend/app/dashboard/prospeccao/page.tsx`
  (3 pontos), `frontend/app/dashboard/banco-leads/page.tsx` (1 ponto). Nenhum arquivo de
  `backend/` tocado.
- **ValidaÃ§Ã£o prevista:** `npm run typecheck` (frontend) e `npm test` do frontend (`lib/*.test.js`
  â€” nenhuma lib pura deveria ser tocada, jÃ¡ que a mudanÃ§a Ã© sÃ³ JSX/apresentaÃ§Ã£o). Commit Ãºnico +
  push para master **sÃ³ se** tudo passar e o diff nÃ£o sair do escopo acima â€” autorizado pelo
  operador neste pedido.

---

## 2026-08-11 - InÃ­cio de tarefa IA - Truncamento visual com tooltip acessÃ­vel para nomes do Google Maps

- **IA/Ferramenta:** Claude Code (Sonnet 5), rodando em worktree isolado (`truncamento-nome-maps`).
- **Pedido resumido:** Melhoria visual independente: mapear as telas que exibem nomes vindos do
  Google Maps (especialmente Central de LigaÃ§Ãµes, Central de Mensagens, AquisiÃ§Ã£o e Banco de
  Leads) e aplicar um padrÃ£o reutilizÃ¡vel e responsivo de truncamento com reticÃªncias, mantendo
  o nome completo em tooltip acessÃ­vel por mouse **e** teclado. Dado original nunca cortado â€” sÃ³
  a apresentaÃ§Ã£o. Sem alteraÃ§Ã£o de regra de negÃ³cio, produÃ§Ã£o, credenciais, commit ou push.
- **Ã‰ projeto/tarefa de alteraÃ§Ã£o?** Sim, pequena e 100% de apresentaÃ§Ã£o (frontend): sem schema,
  sem migration, sem rota nova, sem chamada nova ao backend, sem prompt de produÃ§Ã£o tocado.
  **Nota de processo:** este registro foi lanÃ§ado de forma retroativa â€” a anÃ¡lise (mapeamento das
  telas, leitura dos arquivos-alvo) foi feita antes da escrita desta entrada, mas a implementaÃ§Ã£o
  sÃ³ comeÃ§ou depois do mapeamento completo, o que preserva o espÃ­rito da Fase 0 mesmo com o
  registro fora de ordem. Fica anotado para nÃ£o repetir.
- **Workflow consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md: Sim. `docs/ui-visual-standard.md`:
  **nÃ£o existe** como arquivo neste repositÃ³rio (sÃ³ referenciado no Ã­ndice do workflow) â€” nÃ£o hÃ¡
  divergÃªncia a registrar ali. `docs/ai-decision-log.md`: decisÃ£o de arquitetura resumida abaixo,
  sem necessidade de entrada separada por ser autocontida e de baixo risco.
- **Telas/colunas mapeadas (nomes com origem no Google Maps ou resoluÃ§Ã£o de lead):**
  1. **AquisiÃ§Ã£o** (`frontend/app/dashboard/aquisicao/page.tsx` reaproveita
     `prospeccao/page.tsx`) â€” coluna "Nome" da tabela de prospecÃ§Ã£o (`p.nome`, com/sem
     `maps_url`).
  2. **Banco de Leads** (`banco-leads/page.tsx`) â€” coluna "Nome" da tabela Google Places
     (`l.nome`, com/sem `maps_url`). A tabela Instagram (nome NÃƒO vem do Maps) ficou **fora**
     de escopo, por decisÃ£o de manter o pedido literal (nomes do Google Maps).
  3. **Central de LigaÃ§Ãµes** (`central-ligacoes/page.tsx`) â€” nome na fila de trabalho, na aba
     Acompanhamento, no topo da tela de ligaÃ§Ã£o em andamento e no card "Lead" da ligaÃ§Ã£o
     (todos `l.nome`/`lead.nome`, vindos de `prospectador.prospects`, fonte Google Maps).
  4. **Central de Mensagens** (`conversas/page.tsx` + `components/ConversaPainel.tsx`) â€” coluna
     "Lead" (`nomeColunaLead`) e tÃ­tulo do painel (`identidadeConversa().titulo`): nome resolvido
     pelo backend com prioridade WhatsApp â†’ Google Maps â†’ vazio
     (`backend/src/services/lead-nome-exibicao.js`), entÃ£o uma fraÃ§Ã£o desses nomes tem origem no
     Maps.
- **Achado que mudou o desenho:** o padrÃ£o de truncamento **jÃ¡ existia**, espalhado (`max-w-[â€¦]
  truncate` + `title=`) em ~10 pontos do repo (endereÃ§o, nicho, nome do Instagram, roteiros,
  sidebar, etc.). Nenhum Ã© alcanÃ§Ã¡vel por teclado nem por leitor de tela â€” `title` nativo nÃ£o Ã©
  confiÃ¡vel nos dois casos. Reescrever TODOS esses pontos seria refatoraÃ§Ã£o grande e fora do
  pedido ("mapeie... especialmente" as 4 Ã¡reas de nomes do Maps); por isso criei um componente
  novo e apliquei **sÃ³** onde o nome vem do Maps, sem tocar o padrÃ£o antigo em outras colunas
  (endereÃ§o, nicho, Instagram) â€” decisÃ£o de escopo, nÃ£o de arquitetura.
- **DecisÃ£o de arquitetura (autocontida):** componente Ãºnico `frontend/components/ui/TextoTruncado.tsx`
  (client component), reusando a tÃ©cnica de tooltip em PORTAL jÃ¡ validada em
  `BolinhaPontuacao.tsx` (mede a prÃ³pria altura, vira para baixo quando nÃ£o cabe acima, presa
  nas bordas laterais â€” necessÃ¡rio porque estas colunas vivem dentro de `DataTableFrame`, que
  tem rolagem horizontal/`overflow-hidden`, e um tooltip `position:absolute` seria cortado). NÃ£o
  criei um hook compartilhado extraÃ­do da `BolinhaPontuacao` para nÃ£o tocar um componente jÃ¡
  testado em produÃ§Ã£o por uma tarefa que nÃ£o pediu isso â€” duplicaÃ§Ã£o pequena e isolada (~30
  linhas de posicionamento), aceita conscientemente.
- **Contrato do componente:** `texto` (nunca cortado no dado â€” sÃ³ na apresentaÃ§Ã£o), `className`
  (controla a largura mÃ¡xima, sempre fornecida pelo chamador), `href`/`dica`/`sufixo` opcionais
  para o caso de link para a ficha do Google Maps (substitui o padrÃ£o antigo
  `<a title="Ver ficha no Google Maps">{nome} â†—</a>` sem duplicar o link em elemento aninhado),
  `vazio` (default "â€”", mas a Central de Mensagens passa `vazio=""` para preservar a regra jÃ¡
  registrada no AGENTS.md â€” "coluna Lead nunca mostra traÃ§o, fica vazia sem nome"). O tooltip sÃ³
  aparece quando o texto **realmente transborda** (`ResizeObserver` compara `scrollWidth` vs
  `clientWidth`), e sÃ³ entÃ£o o elemento entra na ordem de tabulaÃ§Ã£o â€” nome curto nÃ£o ganha foco
  nem popup redundante.
- **Arquivos criados:** `frontend/components/ui/TextoTruncado.tsx`.
- **Arquivos alterados:** `frontend/app/dashboard/prospeccao/page.tsx`,
  `frontend/app/dashboard/banco-leads/page.tsx`, `frontend/app/dashboard/central-ligacoes/page.tsx`
  (4 pontos), `frontend/app/dashboard/conversas/page.tsx`, `frontend/components/ConversaPainel.tsx`.
  Nenhum arquivo de backend, prompt, schema ou config foi tocado.
- **ValidaÃ§Ã£o:** `npm run typecheck` (frontend) limpo; `npm test` (frontend, `lib/*.test.js`)
  294/294 â€” nenhum teste de lib pura foi tocado porque a mudanÃ§a Ã© sÃ³ de apresentaÃ§Ã£o/JSX.
  Iniciei o dev server (`next dev -p 3901`) e montei uma pÃ¡gina temporÃ¡ria de QA isolada
  (removida ao final) para exercitar o componente; a extensÃ£o Claude in Chrome nÃ£o estava
  conectada nesta sessÃ£o (job em background), entÃ£o **nÃ£o consegui confirmar visualmente no
  navegador** o posicionamento do balÃ£o, o comportamento de foco por Tab/Escape nem a aparÃªncia
  em telas estreitas â€” fica como pendÃªncia explÃ­cita para checagem manual do operador.
- **Fora de escopo (declarado):** os demais ~10 usos do padrÃ£o antigo `max-w truncate title=`
  (endereÃ§o, nicho, Instagram, roteiros, sidebar, etc.), qualquer regra de negÃ³cio, dados de
  produÃ§Ã£o, prompts, credenciais, commit/push.

---

## 2026-08-10 - Inicio de tarefa IA - Fase 2 do escopo por instancia: REGRA UNICA e SEGURA de selecao de instancia no envio

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** Implementar **somente a Fase 2** do plano de
  `docs/analise-contexto-instancia.md` (Â§9): criar uma **regra unica** de resolucao de
  instancia para todo envio Evolution/WhatsApp; **remover os fallbacks inseguros** (instancia
  "mais recentemente atualizada", env global `EVOLUTION_INSTANCE`/`'PJ'`, e nome de instancia
  aceito sem validacao); exigir que o envio use instancia **comprovadamente da mesma empresa,
  ativa e compativel com WhatsApp/Evolution**; **bloquear de forma auditavel** quando nao
  houver vinculo comprovado, nunca escolher outro numero em silencio. Centralizar em
  `whatsapp.js` e fazer `conversa-manual.js` consumir a MESMA regra. Cobrir follow-up, agenda,
  prospeccao, handoff, comandos de operador e rotas legadas pertinentes. Corrigir diagnostico
  que depende do fallback global. Preservar o efeito D-8 (a instancia gravada da conversa nao
  migra automaticamente) e documenta-lo.
- **E projeto/tarefa de alteracao?** Sim, e **sensivel**: mexe no caminho de ENVIO de producao
  (o que o cliente ve) em ~8 modulos. **Nao** cria migration, **nao** cria env, **nao** cria
  rota nova, **nao** faz backfill, **nao** cria seletor visual, **nao** dispara envio real.
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md: Sim |
  docs/analise-contexto-instancia.md (a analise que definiu esta fase): Sim |
  docs/ui-visual-standard.md: **nao aplicavel** (nenhuma tela) | docs/ai-decision-log.md: a
  registrar na Fase 8.
- **Estado REAL medido no codigo (nao no pedido):**
  1. `whatsapp.js:72` (`instanceNameParaEnvio`) resolve em 3 passos e **dois deles sao
     inseguros**: `getInstanceNameForConversation` (`:51-60`) cai num `LEFT JOIN LATERAL ...
     ORDER BY atualizado_em DESC LIMIT 1` â€” "a instancia ativa mais recentemente atualizada" â€”
     e, na falta dela, `:79` usa `INSTANCE_NAME` = `process.env.EVOLUTION_INSTANCE || 'PJ'`,
     que **ignora a empresa por completo**.
  2. **O mesmo fallback arbitrario esta DUPLICADO** em `services/conversa-manual.js:61-69`.
  3. **O nome explicito nunca e validado.** Todos os chamadores "seguros"
     (`core-funnel.js:1055/1134`, `contexto2-responder.js:195`, `api-conversas.js:261`,
     `agent.js:7311`) fazem `conversa.evolution_instance ? { instanceName } : {}` â€” passam o
     TEXTO da coluna sem provar que aquela instancia existe, esta ativa, e' da mesma empresa e
     nao e' Freelandoo; e quando a coluna esta vazia caem exatamente nos passos 2b/3.
  4. **Chamadores que nao passam instancia nenhuma:** `followup-execution.js:386`,
     `agenda.js:803` e `:928`, `prospecting.js:2033`, `services/prospecting-send-worker.js:252`,
     `services/prospecting-daily-report.js:325`, `services/followup-manual.js:126`,
     `handoff-alerts.js:342` (alertas ao operador) e todo o `operator-commands.js`.
  5. **Diagnostico preso ao global:** `GET /dashboard/prospeccao/whatsapp/status`
     (`prospecting.js:4195`) chama `verificarStatusInstanciaEvolution()` **sem argumento** â€”
     responde sobre a instancia do env, nao sobre a da empresa. `numerosSemWhatsapp` tem o
     mesmo default.
  6. **Rotas legadas** `/dashboard/whatsapp/connect|refresh-qr|check-status|disconnect`
     (`whatsapp-routes.js:66,154,203,288`) operam a instancia do env direto â€” inclusive um
     `DELETE /instance/logout/<env>`, que **derruba a conexao de um numero que pode nao ser de
     quem clicou**.
- **Decisoes levadas ao operador ANTES de implementar (nao decidi sozinho):** (a) empresa com
  exatamente UMA instancia ativa conta como vinculo comprovado? (b) por qual instancia saem os
  alertas ao operador e as respostas de comandos de operador, ja que `vendas.operadores` nao
  tem empresa? (c) D-8: alinhar a escrita de `db-crud.js:154` para "nunca migra" ou nao tocar
  no caminho de escrita nesta fase? (d) o que fazer com as rotas legadas de QR.
- **Fora de escopo declarado pelo pedido:** backfill, seletor visual, producao, credenciais,
  commit/push e envio real de mensagem.

---

## 2026-08-10 - Inicio de tarefa IA - Padronizacao visual dos controles de ativacao (Central de Mensagens + Follow-up Automatico)

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** Padronizar o visual dos controles de ativacao das duas telas num unico
  padrao compacto â€” **icone de informacao + toggle + tooltip curto** â€”, removendo rotulos
  textuais redundantes ("Ativo", "Desativo", "Acompanhando sem responder") e descricoes longas
  que ocupam espaco fixo. **Proibido** pelo proprio pedido: alterar regras de acompanhamento,
  logica de resposta automatica/humana, dados, endpoints, permissoes, automacoes ou o
  significado funcional de ativo/inativo.
- **E projeto/tarefa de alteracao?** Sim, **pequeno e 100% de apresentacao**: sem schema, sem
  migration, sem env, sem rota, sem payload novo, sem worker. Nenhum arquivo de `backend/` deve
  ser tocado.
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md: Sim |
  docs/ui-visual-standard.md: Sim (Fase 5 â€” o pedido e' 100% interface) |
  docs/ai-decision-log.md: a registrar na Fase 8.
- **Estado REAL dos dois controles hoje (medido no codigo, nao no pedido):**
  1. **Central de Mensagens** (`frontend/app/dashboard/conversas/page.tsx:205-224`): card
     "Modo padrao da IA" com `AlternadorModoIa` â€” um **`role="radiogroup"` de 2 opcoes**
     (Conversa | Analise), mais o `estado` por extenso (`descreverModo().estado` â†’
     "IA pode responder" / "IA acompanhando, sem responder"), mais DOIS paragrafos fixos
     (`explicarPadraoGlobal` e `AVISO_EXCECOES_PADRAO`). O balao "i" **ja existe** dentro do
     `AlternadorModoIa` (`BalaoAjuda`, em portal no `<body>`, hover/foco/toque, Escape).
  2. **Follow-up Automatico** (`frontend/app/dashboard/follow-ups/page.tsx:352-370`): um
     `<button aria-pressed>` com borda/fundo coloridos, icone, o texto
     "Follow-up automatico: **ativo/desativado**" e uma bolinha de cor. **Nao e' um switch** e
     nao tem icone de informacao â€” so' `title=`.
  3. **Ja existe padrao de switch no projeto** (`role="switch"` + `aria-checked` + knob que
     translada): `components/InstanciasWhatsApp.tsx:603-612` e
     `components/InstanciasFreelandoo.tsx:216`. E' reuso, nao componente inventado.
- **Conflito material declarado ANTES de implementar (levado ao operador):** o controle da
  Central **nao e' booleano hoje** â€” sao dois modos NOMEADOS. O AGENTS.md registra a escolha
  do `role="radiogroup"` de proposito ("aqui nada muda na tela â€” muda o COMPORTAMENTO do
  sistema com o cliente"). Transformar em toggle passa a chamar "Analise" de **desligado**, e
  a mesma secao do AGENTS.md avisa que o modo Analise **nao e' pausa de automacao** (follow-up
  e agenda continuam rodando nos dois modos). O pedido, por outro lado, e' explicito ao listar
  "Acompanhando sem responder" como rotulo a remover.
- **Guarda de regressao que restringe a implementacao:** `frontend/lib/conversa-modo-ia.test.js:288`
  falha se `conversas/page.tsx`, `ConversaPainel.tsx` ou `AlternadorModoIa.tsx` compararem o
  modo com literal (`=== 'analise'`). Logo, qualquer mapeamento modoâ†”ligado/desligado tem de
  nascer **puro**, dentro de `frontend/lib/conversa-modo-ia.js`.
- **Fora de escopo declarado:** o controle **DA CONVERSA** (`ConversaPainel.tsx:560`), que tem
  **3 opcoes** (Herdar | Conversa | Analise) e nao cabe num booleano â€” o pedido fala da "area
  superior" da Central; qualquer backend; e o banner de aviso quando o follow-up esta pausado
  (alerta com impacto operacional, que o proprio pedido manda conservar).
- **Arquivos que pretendo alterar/criar:** NOVO `frontend/components/ui/InterruptorAtivacao.tsx`
  (+ possivel extracao de `BalaoAjuda` para arquivo proprio, sem duplicar); ALTERADOS
  `frontend/app/dashboard/conversas/page.tsx`, `frontend/app/dashboard/follow-ups/page.tsx`,
  `frontend/lib/conversa-modo-ia.js` (+ `.d.ts`/`.test.js`), `frontend/components/ui/AlternadorModoIa.tsx`,
  `AGENTS.md`, `docs/ai-decision-log.md`, `docs/ui-visual-standard.md`.
- **Validacao prevista:** `npm test` (frontend + backend), `npm run typecheck`, verificacao
  visual em desktop e mobile. Commit unico + push **so' se** todas passarem e o diff nao sair
  do escopo de padronizacao.

---

## 2026-08-10 - Inicio de tarefa IA - Fase 0 do escopo por instancia: script de MEDICAO read-only

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** Criar **exclusivamente** a Fase 0 de medicao do plano registrado em
  `docs/analise-contexto-instancia.md`: um script de diagnostico **read-only**, no padrao do
  `medir:isolamento-empresa` ja existente, que responda quantas empresas tem mais de uma
  instancia WhatsApp ativa, quantas conversas estao sem `evolution_instance`, a distribuicao
  por empresa e por instancia, instancias sem uso e os sinais de risco que impedem atribuicao
  segura. Saida legivel no terminal (totais + tabela por empresa + achados).
- **E projeto/tarefa de alteracao?** Sim, **pequeno e de escopo controlado**: cria arquivo
  novo + 1 linha em `package.json` + teste de regressao. **Nao toca** schema, migration,
  rota, motor, automacao ou tela. O proprio pedido lista em `nao_fazer`: nao implementar
  filtro por instancia, nao mexer na precedencia de `evolution_instance`, nao corrigir o
  fallback de envio, nao alterar o teto diario, nao modificar dados.
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md: Sim |
  docs/analise-contexto-instancia.md (a analise que produziu esta fase): Sim |
  docs/ui-visual-standard.md: **nao aplicavel** (nenhuma tela) | docs/ai-decision-log.md:
  nada a registrar â€” a decisao arquitetural ja esta na analise e nenhuma nova foi tomada.
- **Padrao reusado (nao inventei outro):** `backend/scripts/medir-isolamento-empresa.js` â€”
  `BEGIN TRANSACTION READ ONLY` + `ROLLBACK`, `DATABASE_URL` explicita (o script nunca
  escolhe banco sozinho), ids mascarados, so contagens agregadas, zero chamada externa,
  zero dependencia nova (`pg` ja e' dependencia).
- **Regra de negocio que o script PRECISA respeitar (e o motivo de ele existir):** conversa
  **sem** `evolution_instance` nao tem, por definicao, vinculo PROVADO com instancia alguma.
  Agrupar por `c.empresa_id` e' informativo, nunca prova â€” aquele `empresa_id` pode ter vindo
  do antigo fallback da PJ (AGENTS.md, secao da quarentena de webhook). Por isso a
  classificacao de atribuibilidade e' explicita e conservadora: empresa com **1** instancia
  ativa = atribuivel; empresa com **2+** = **nao atribuivel**; conversa sem empresa =
  quarentena analitica. Nao se inventa dono.
- **Arquivos criados/alterados:** NOVOS `backend/scripts/medir-escopo-instancia.js`,
  `backend/test/medir-escopo-instancia.test.js` (guarda de regressao que le o fonte e falha
  se aparecer qualquer verbo de escrita); ALTERADO `backend/package.json` (script npm
  `medir:escopo-instancia` + o teste na lista do `npm test`).
- **Limite declarado:** a medicao **nao corrige** nenhum dos defeitos que a analise apontou
  (envio pela instancia errada, precedencia divergente de `evolution_instance`, teto diario
  por empresa) e **nao cria** o seletor por instancia. Ela so dimensiona.
- **Fora de escopo:** executar contra producao sem autorizacao explicita do operador.

---

## 2026-08-10 - Inicio de tarefa IA - ANALISE (sem implementacao): contexto de instancia na operacao (seletor persistente)

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** Mapear, **antes de implementar**, o que precisa ser global da empresa,
  o que precisa ser por instancia de WhatsApp e o que deve existir uma unica vez com
  atribuicao/filtro, para viabilizar um **seletor de instancia persistente** no topo da
  aplicacao (com atalhos sincronizados nas telas operacionais e uma visao "Todas as
  instancias" somente de acompanhamento). Entregavel: relatorio tecnico de impacto com mapa
  de entidades/rotas/jobs/componentes, matriz de classificacao, fluxos que exigem escopo,
  riscos (integridade/seguranca/desempenho/migracao), proposta de arquitetura com fonte unica
  de verdade, plano em fases reversiveis e lista de decisoes que dependem de confirmacao.
- **E projeto/tarefa de alteracao?** **Nao nesta etapa.** O proprio pedido poe em `restricoes`:
  nao implementar o seletor, nao criar migrations, nao alterar dados, nao disparar mensagens/
  follow-ups/automacoes. Registro assim mesmo porque a analise **precede** uma alteracao
  estrutural grande (schema/banco + rotas + jobs + muitas telas) e produz o desenho que sera
  implementado depois. **Nenhum arquivo de codigo, SQL, config ou automacao foi alterado.**
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md: Sim |
  docs/project-map.md e docs/architecture-rules.md: Sim |
  docs/PENDENCIA_ARQUITETURAL_CENTRAL_LIGACOES_E_MENSAGENS.md: Sim (o item 1 do checklist dele
  â€” identidade canonica / `UNIQUE` global de `vendas.conversas.numero` â€” e' pre-requisito
  direto deste tema) | docs/ui-visual-standard.md: a consultar SE e quando houver implementacao |
  docs/ai-decision-log.md: a registrar SE e quando houver implementacao.
- **Fora de escopo declarado pelo pedido:** implementar o seletor, criar migration, alterar
  dados existentes, disparar mensagens/follow-ups/automacoes, e assumir que tela filtrada
  significa backend protegido.
- **Entrega:** relatorio escrito em `docs/analise-contexto-instancia.md`. Se aprovado, a
  implementacao exige nova passada pelas Fases 3-11.

---

## 2026-08-10 - Inicio de tarefa IA - Nome do lead na Central de Mensagens (fontes alternativas, sem telefone como nome)

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** A coluna "Lead" da Central de Mensagens deve exibir **so' um nome
  identificado**, seguindo a prioridade **nome cadastrado > nome do WhatsApp > nome do Google
  Maps > campo VAZIO**. Telefone nunca no campo de nome (ele ja tem coluna propria), sem traco
  como substituto, resolucao **centralizada** num modulo reusavel (a ordem nao pode ficar
  espalhada em componente), backend devolvendo nome resolvido **ou nome + fonte**, dados
  originais preservados (nao sobrescrever nome cadastrado) e testes por prioridade.
- **E projeto/tarefa de alteracao?** Sim. As prioridades 1, 3 e 4 sao leitura/apresentacao; a
  **prioridade 2 (nome do WhatsApp) nao tem onde ser lida hoje** e so' existe com persistencia
  nova â€” o que cai nos gatilhos de confirmacao do CLAUDE.md (schema/banco + escrita no caminho
  de producao do webhook). Por isso esta entrada registra a descoberta e **para antes da Fase 3**.
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md: Sim |
  docs/ui-visual-standard.md: a consultar na Fase 5 | docs/ai-decision-log.md: a registrar na Fase 8.
- **Fatos confirmados no codigo HOJE (nao sao hipotese):**
  1. **A coluna "Lead" ja e' o `rotuloLead`/`identidadeConversa`** de
     `frontend/lib/lead-identidade.js` â€” modulo PURO que ja e' o dono unico da identidade e ja e'
     REEXPORTADO por `followups-fila.js`. O requisito "centralizar num modulo reusavel" **ja esta
     cumprido**; o que muda e' a REGRA dentro dele, nao onde ela mora.
  2. **O fallback para o telefone e' DELIBERADO hoje**, nao descuido: `lead-identidade.js:50` e
     `:70` caem em `formatarTelefone` de proposito, e o AGENTS.md registra isso na secao
     "Identificador tecnico do Evolution NAO aparece na interface". Na LISTA o pedido esta certo
     (ha coluna "Telefone" separada em `conversas/page.tsx:240`, entao e' duplicacao); no
     **cabecalho do painel** (`ConversaPainel.tsx:443,467`) nao ha duplicacao, porque a linha do
     telefone so' renderiza quando `temNome` e' true.
  3. **A prioridade 1 esta partida em DUAS colunas e as duas telas ja divergem.**
     `vendas.lead_profiles.apelido` (nome da pessoa) e `.negocio` (nome do negocio). A Central de
     Mensagens seleciona **so' `lp.negocio`** (`api-conversas.js:92`); a fila de Follow-ups usa
     `COALESCE(NULLIF(p.apelido,''), NULLIF(p.negocio,''))` (`followup-listing.js:45`). O mesmo
     lead pode aparecer com nome em Follow-ups e com telefone em Mensagens **hoje**.
  4. **A prioridade 2 (nome do WhatsApp) NAO E' PERSISTIDA em lugar nenhum.** Nao existe coluna
     `push_name` no backend (grep em `backend/`: zero ocorrencias em schema). O `msg.pushName`
     chega ao `webhook-handler.js:362`, e' consumido em memoria por `capturarNomeContato`
     (`agent.js:5820`) e **jogado fora** depois de passar por `nomeDePushName` â†’ `primeiroNome`
     (`nome-contato.js:25-40`), que (a) fica **so' com o PRIMEIRO token** e (b) **recusa** uma
     lista fechada de palavras genericas que inclui `pizzaria`, `restaurante`, `loja`,
     `barbearia`, `academia`, `clinica` (`nome-contato.js:6-17`). Consequencias medidas na regra:
     um perfil WhatsApp Business chamado "Pizzaria do Ze" e' **descartado por inteiro**; "Joao
     Silva" vira "Joao". O que sobra e' gravado em `apelido` **e so' quando `apelido` esta vazio**.
  5. **Logo, `apelido` mistura a prioridade 1 e a 2 e a origem nao e' recuperavel.**
     `capturarNomeContato` calcula `fonte` (`'mensagem'` | `'pushName'`) mas **so' loga** â€” nada
     e' persistido (`agent.js:5825,5853`). Sem coluna nova, "nome cadastrado" e "nome do WhatsApp"
     sao indistinguiveis no dado, e os leads cujo pushName foi recusado no filtro **nao tem nome
     nenhum para exibir**.
  6. **A prioridade 3 (Google Maps) e' alcancavel SEM mudanca de schema.**
     `prospectador.prospects.nome` e' `NOT NULL` (`init.sql:687`), tem `telefone`
     (`:688`) e ganhou `empresa_id` na migration `005_prospeccao_multiempresa.sql`. O casamento
     por digitos do telefone e' o padrao ja usado no repo
     (`regexp_replace(..., '[^0-9]', '', 'g')` em `db/follow-ups.js:261`, `prospecting.js:2384`).
     Custo: um LATERAL a mais na listagem â€” a rota **nao** faz esse join hoje.
  7. **A rota nao devolve fonte de nome nenhuma.** `GET /conversas` seleciona `lp.negocio` e mais
     14 campos do perfil; `GET /:numero` faz `SELECT c.*, lp.*`. O requisito "retornar o nome ja
     resolvido ou nome + fonte" exige tocar `api-conversas.js` nos dois pontos.
- **Decisoes levadas ao Victor ANTES da Fase 3 (nao decidi sozinho):** (a) criar ou nao a
  persistencia do nome CRU do WhatsApp (migration + escrita no webhook) para a prioridade 2
  existir de fato; (b) a precedencia entre `negocio` e `apelido` dentro da prioridade 1.
- **Fora de escopo (declarado pelo pedido):** sobrescrever nome cadastrado, criar/editar perfil
  de lead a partir de WhatsApp/Maps, e mexer em aquisicao, follow-up, agenda ou analise da IA.
- **Nenhum arquivo de codigo foi alterado nesta etapa.**

---

## 2026-08-10 - Inicio de tarefa IA - Site vira fator da pontuacao de cadastro (coluna removida)

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** O operador observou que a coluna "Site" repete um dado que ja esta dentro
  de "Pontos" (completude de cadastro) e pediu para **remover a coluna** e fazer o site aparecer
  **so' dentro da pontuacao de cadastro** â€” no balao que abre ao passar o mouse ou no modal de
  detalhes. Em seguida, relatou que **o balao da Central de Mensagens fica "muito pra cima"** e
  nao da' para ler.
- **E projeto/tarefa de alteracao?** Sim, pequeno e 100% de apresentacao: sem schema, sem
  migration, sem env, sem rota, sem chamada nova ao backend. Nenhuma regra de pontuacao,
  classificacao de site ou elegibilidade muda.
- **Workflow consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md, docs/ui-visual-standard.md
  (Fase 5 â€” e' tela) e docs/analise-indicador-pontuacao.md: Sim.
- **Conflito declarado ANTES de implementar:** a Â§5.1 daquela analise decidiu o CONTRARIO
  (Site "fica visivel de proposito") e a Â§8 lista "esconder dado decisivo dentro do tooltip"
  como risco. Levei as tres perdas ao operador (Pontos e' lossy; a direcao da escala e'
  invertida; `situacao_site` tem 3 estados e o criterio tem 2); ele **reafirmou a decisao**, que
  passou a valer. Duas das tres perdas foram ENDERECADAS na implementacao, nao ignoradas â€” ver
  `docs/ai-decision-log.md`.
- **Fatos confirmados no codigo:** `site` e' 1 dos 9 criterios de `calcularScoreCadastroPlaces`
  (**20 de 100**, `lead-score-cadastro.js:66`); a Aquisicao ordena `pontos ASC`
  (`prospeccao/page.tsx:183`); `ligacao-prioridade.js:19` da **+40** para
  `site_ausente_confirmado`; `situacao_site` tem 3 estados por decisao explicita
  (`site-classificacao.js:279`); `BolinhaCadastro` e' compartilhada pelas duas telas
  (`LeadDetalhesModal.tsx:71`), entao o enriquecimento foi feito em UM lugar.
- **Defeito de posicionamento encontrado a partir do relato do operador:** o balao era fixado em
  `top: rect.top - 8` com `translate(-50%,-100%)` â€” abria SEMPRE para cima. Nas tabelas sempre ha
  cabecalho acima; na Central de Mensagens a bolinha vive no cabecalho de um modal colado no topo
  da tela, e o balao (ate 9 criterios) subia para fora da viewport. Passou a MEDIR a propria
  altura e virar para baixo quando nao cabe, alem de ser preso nas bordas laterais.
- **Arquivos alterados:** `frontend/lib/pontuacao-indicador.js` (+ `.d.ts`/`.test.js`),
  `frontend/components/LeadDetalhesModal.tsx`, `frontend/components/ui/BolinhaPontuacao.tsx`,
  `frontend/app/dashboard/prospeccao/page.tsx`, `frontend/app/dashboard/banco-leads/page.tsx`,
  `AGENTS.md`, `docs/analise-indicador-pontuacao.md`, `docs/ai-decision-log.md`.
- **Validacao:** frontend 261/261 e typecheck limpo. **Verificacao visual do balao pendente** â€”
  a correcao de posicionamento e' justamente do tipo que so' a tela confirma.

---

## 2026-08-08 - Inicio de tarefa IA - Fluxo integrado de Follow-ups (Ligacoes <-> Follow-ups <-> Mensagens)

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** Fluxo integrado em que **encerrar uma ligacao cria uma proxima acao**
  (canal WhatsApp **ou** nova ligacao) com data/hora, prioridade, responsavel, status, origem e
  historico preservados; a **Central de Ligacoes** so mostra o RESUMO + link da proxima acao; a
  **Central de Follow-ups** e' a fila operacional unica (filtros por canal/status/prioridade/
  origem/responsavel/periodo, paginacao e contexto preservados); a **Central de Mensagens**
  executa o item de WhatsApp reusando o painel de conversa ja existente. Mais: historico
  unificado por contato e estados `aguardando | proxima_acao | concluido | cancelado | falha`.
- **E projeto/tarefa de alteracao?** Sim, e **ESTRUTURAL**. Cai em todos os gatilhos de
  confirmacao do CLAUDE.md (schema/banco, muitos arquivos, regra de negocio nova, rotas novas).
- **GATILHO FORMAL DISPARADO â€” `docs/PENDENCIA_ARQUITETURAL_CENTRAL_LIGACOES_E_MENSAGENS.md`:**
  aquele documento congela EXATAMENTE esta integracao e instrui, textualmente: *"Quando o projeto
  entrar na fase de integracao entre Ligacoes e Mensagens, **interrompa a implementacao
  inicialmente** e recupere esta documentacao para revisar toda a arquitetura antes de gerar
  codigo."* O checklist dele (identidade canonica, multi-tenant, normalizacao de telefones,
  contrato Ligacoes <-> Mensagens) e' pre-requisito declarado. Por isso esta entrada registra
  **descoberta + proposta de arquitetura**, sem codigo.
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md: Sim |
  docs/PENDENCIA_ARQUITETURAL_CENTRAL_LIGACOES_E_MENSAGENS.md: Sim |
  docs/ui-visual-standard.md: a consultar na Fase 5 | docs/ai-decision-log.md: a registrar na Fase 8.
- **Fatos confirmados no codigo HOJE (nao sao hipotese):**
  1. **NAO EXISTE a entidade "Follow-up".** A fila de `/dashboard/follow-ups` e' **derivada em
     tempo de request** de duas fontes que nao se conhecem: `montarCallList`
     (`services/followup-listing.js:148`, recalcula a recomendacao a cada GET, **nada e'
     persistido**) e `listarAgendamentosAuto` (`:29`, le `vendas.followup_auto_agendamentos`, a
     agenda do motor de IA). Nenhuma das duas tem **canal**, **responsavel**, **origem** ou
     **status editavel pelo operador**.
  2. **"Proxima acao" ja existe â€” mas no OUTRO mundo e sem estrutura.**
     `POST /ligacoes/:id/encerrar` (`routes/api-ligacoes.js:77`) ja aceita `proxima_acao` e
     `data_followup`, e `db/ligacoes.js:250-264` os grava em **`app.campanha_leads`**
     (`proxima_acao` TEXTO LIVRE, `data_followup` TIMESTAMPTZ, `responsavel_id` UUID, `status`
     de oportunidade). No front isso e' um `<input placeholder="Proxima acao">` +
     `<input type="date">` (`central-ligacoes/page.tsx:1466-1469`). **Nenhuma linha de codigo da
     Central de Follow-ups le `app.campanha_leads`** â€” a proxima acao criada na ligacao e' hoje
     invisivel para a fila.
  3. **Os dois mundos tem CHAVES DIFERENTES e nao ha identidade canonica.** Ligacoes:
     `prospectador.prospects.id` / `app.campanha_leads.id` (telefone em formato livre).
     Mensagens/Follow-ups: `vendas.conversas.numero`, o JID `â€¦@s.whatsapp.net`, com
     **`UNIQUE` GLOBAL** (`sql/init.sql:6`) â€” nao e' `UNIQUE (empresa_id, numero)`. E' o item 1
     do checklist da pendencia congelada, e e' o que impede casar os dois lados por FK.
  4. **Um lead so' de ligacao pode NAO TER conversa.** `montarCallList` exige
     `jsonb_array_length(c.historico) > 0`; prospect que nunca trocou WhatsApp nao tem linha em
     `vendas.conversas`. O caminho autorizado de criar uma ja existe e e' `POST
     /follow-ups/manual/iniciar` (`services/followup-manual.js`), que nasce com
     `agente_pausado = true`, usa `ON CONFLICT DO NOTHING` (nunca `DO UPDATE`, por causa do
     UNIQUE global), **recusa com 409** numero de outra empresa e audita a origem em
     `app.auditoria_eventos`.
  5. **"Concluir / reagendar / cancelar" nao tem onde ser gravado.** Hoje um item humano some da
     fila por EFEITO COLATERAL: `montarCallList` filtra `NOT EXISTS (followup_ligacoes â€¦ ultimas
     12h)` (`CALLLIST_DEDUP_HORAS`). Nao ha status, nao ha conclusao, nao ha reagendamento.
  6. **Prioridade so' existe de um lado.** `services/followup-call-score.js` pontua o item humano
     (0-100 + temperatura + `janela_quando`); o item do automatico **nao tem** call score e a tela
     ja diz "prioridade nao calculada" (`lib/followups-fila.js:285-288`). `ligacao-prioridade.js`
     pontua a fila da campanha, com OUTRA escala e outro significado.
  7. **Responsavel nao existe no item da fila** â€” e ja esta declarado como lacuna no AGENTS.md.
     `app.campanha_leads.responsavel_id` existe mas nunca e' escrito por nenhuma rota;
     `vendas.followup_ligacoes.usuario_id` so' registra quem ja ligou (fato passado).
  8. **O painel de conversa unico JA FOI ENTREGUE** no commit `38befc4`:
     `components/ConversaPainel.tsx` e o mesmo em `/dashboard/conversas` e em
     `/dashboard/follow-ups` (`follow-ups/page.tsx:424`). O requisito
     `fluxo_central_de_mensagens.requisito` do pedido **ja esta cumprido**; falta so' passar o
     CONTEXTO da ligacao de origem.
  9. **Isolamento por empresa esta OK nos tres pontos de entrada:** `/follow-ups` e `/ligacoes`
     sao `requireAuth + requireRole('admin')` no mount (`index.js:107,111`) + `requireEmpresaAccess`
     por rota; `db/ligacoes.js` e `db/campanhas.js` filtram `empresa_id` e usam
     `assertMesmaEmpresa`. **Ressalva herdada:** `api-conversas.js:18` mantem o fallback da PJ
     (`c.empresa_id IS NULL`), que nao foi criado por esta tarefa.
- **Conclusao da descoberta (respondendo ao `descoberta_obrigatoria` do pedido):** dos 9 campos
  minimos do modelo pedido, **existem hoje** apenas *proxima acao* (texto livre), *data* (sem
  hora) e *status de oportunidade* â€” e apenas dentro de `app.campanha_leads`, sem alcance da fila.
  **Nao existem:** canal, prioridade do follow-up, responsavel efetivo, status do follow-up,
  origem, referencia ao contato/conversa e referencia ao evento de origem. Portanto **o pedido
  nao pode ser cumprido sem entidade persistida nova (migration)** â€” o que o proprio pedido
  condicionou a "confirmar que os dados necessarios nao existem". Confirmado que nao existem.
- **Decisoes levadas ao Victor ANTES da Fase 3 (nao decidi sozinho):** (a) criar ou nao
  `app.follow_ups` como entidade unica; (b) qual e' a identidade canonica do contato que liga os
  dois mundos; (c) o que fazer com as duas fontes derivadas atuais (call-list e agendamentos do
  motor) quando a entidade existir; (d) de onde sai a lista de responsaveis.
- **Fora de escopo declarado (pelo proprio pedido):** credenciais, env, Meta, Evolution e
  integracoes externas; disparo real de mensagem ou chamada em desenvolvimento/validacao;
  segunda tela de conversa; transformar a Central de Ligacoes em fila de WhatsApp; logs globais,
  automacoes e telemetria fora deste fluxo.
- **Nenhum arquivo de codigo foi alterado nesta etapa.**

---

## 2026-08-08 - Inicio de tarefa IA - ANALISE (sem implementacao): indicador reusavel de pontuacao (bolinha + explicacao)

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** Analisar onde um indicador visual reusavel de pontuacao â€” bolinha com
  explicacao ao foco/clique/hover â€” pode ser aplicado, em 4 areas: **Central de Ligacoes**
  (referencia visual ja existente), **Central de Mensagens** (interesse comercial da conversa),
  **Aquisicao** (resumir colunas) e **Banco de Leads** (priorizacao). Componente unico e
  consistente; SIGNIFICADO da pontuacao contextual por pagina. Entregar mapa das areas, tabela
  de decisao (aplicar agora / depois / nao aplicar), colunas que podem sair e para onde vao,
  contrato reusavel do componente, lacunas de dados e evidencias de leitura de codigo.
- **E projeto/tarefa de alteracao?** **Nao nesta etapa** â€” o proprio pedido poe em
  `fora_de_escopo`: "Implementar o componente ou alterar paginas nesta etapa", "Criar pontuacao
  em outras areas", "Modificar regras comerciais, automacoes, dados de producao ou integracoes".
  Registro assim mesmo porque a analise PRECEDE um projeto de alteracao de UI em 4 telas e
  produz o desenho que sera implementado depois. **Nenhum arquivo de codigo foi alterado.**
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md: Sim |
  docs/ui-visual-standard.md: Sim (Fase 5 â€” o pedido e' 100% de interface) |
  docs/ai-decision-log.md: a registrar SE e quando houver implementacao.
- **Fatos confirmados no codigo HOJE (nao sao hipotese):**
  1. **A bolinha ja existe DUAS vezes, com a MESMA geometria e implementacoes diferentes.**
     `central-ligacoes/page.tsx:198` (`CirculoPrioridade`, `h-9 w-9 rounded-full border-2`,
     tooltip em portal no `<body>`, fecha em scroll/resize, `tabIndex=0` + `aria-label`) e
     `components/ConversaPainel.tsx:125` (`InteresseBadge compact`, `h-9 w-9 rounded-full
     border-2`, **so' `title=`**, sem foco por teclado e sem os criterios). Uma TERCEIRA
     variante, menor e sem numero, esta em `follow-ups/page.tsx:527` (`h-2.5 w-2.5`, cor +
     `aria-label` de `descricaoPrioridade`).
  2. **As paletas de faixa ja divergem entre as duas.** Ligacoes: `alta=emerald / media=amber /
     baixa=slate` (`FAIXA_CLS`, page.tsx:173). Mensagens: `alto=emerald / medio=amber /
     baixo=slate` (`INTERESSE_STYLE`, ConversaPainel.tsx:110) â€” coincidem. Follow-ups:
     `alta=red / media=amber / baixa=sky` (`PRIORIDADE_DOT`, page.tsx:76) â€” **conflita**: o
     vermelho ali significa "mais urgente", e nas outras duas significaria "pior".
  3. **Os quatro scores do produto sao MESMO diferentes, e nenhum e' substituivel pelo outro:**
     `ligacao-prioridade.calcularPrioridade` (0-100, "quanto vale LIGAR agora nesta campanha";
     site ausente vale 40) Â· `lead-interest-score.calcularScoreInteresseLead` (0-100, sinal de
     compra lido do TEXTO das mensagens do lead; tem deltas negativos) Â·
     `lead-score-cadastro.calcularScoreCadastroPlaces` (0-100 de COMPLETUDE do cadastro, o
     "Pontos" das tabelas; Instagram e' 0-60) Â· `prospecting.calcularScoreProspect` (0-100,
     `prospects.score`, o emoji de temperatura da Aquisicao). **Cadastro alto e' oportunidade
     BAIXA** â€” a Aquisicao ja ordena por `pontos ASC` por causa disso (`prospeccao/page.tsx:166`).
  4. **Explicacao auditavel ja existe em todos os quatro:** `prioridade.motivos[]`,
     `score_interesse_criterios[]` (com `delta`/`titulo`/`detalhe`/`tipo`),
     `score_cadastro_criterios[]` (a rota de prospects ja devolve â€” `prospecting.js:1422`) e
     `pontuacao.criterios` dentro de `json_apresentacao` (Banco de Leads,
     `api-banco-leads.js:179`). **Nenhuma regra de pontuacao nova precisa ser inventada.**
  5. **A Aquisicao exibe HOJE duas pontuacoes na mesma linha sem dizer que sao duas:** o emoji
     de temperatura de `p.score` (`page.tsx:494`) e a coluna "Pontos" de `p.score_cadastro`
     (`:521`). Sao escalas com sentidos opostos.
  6. **JSON bruto esta na tabela operacional:** coluna "JSON" com `{ }` abrindo
     `JsonLeadModal`, que renderiza `JSON.stringify(json, null, 2)` â€” na Aquisicao
     (`prospeccao/page.tsx:482,530`) e no Banco de Leads (`banco-leads/page.tsx`, colunas fixas).
  7. **Banco de Leads NAO tem prioridade comercial calculada.** A rota devolve `score`,
     `score_cadastro` e `situacao_site`, mas `montarFilaPriorizada` so' e' chamada em
     `db/campanhas.js:254` (fila de ligacoes). Aplicar a bolinha de PRIORIDADE ali exige
     decidir se a mesma funcao passa a valer fora de campanha.
  8. **Central de Mensagens esta em refatoracao NAO COMMITADA** neste working tree:
     `components/ConversaPainel.tsx` e `lib/lead-identidade.js` sao arquivos novos (untracked) e
     `conversas/page.tsx` esta modificado. Qualquer proposta para essa tela tem de partir do
     estado novo, nao do commitado.
  9. **Nao existe componente de tooltip/popover compartilhado** em `frontend/components/ui/`
     (ha `Abas`, `ModalConfirmar`, `StatusPill`, `DataTableFrame`, `JsonLeadModal`, `icons`).
     O unico tooltip acessivel e posicionado do projeto e' o inline da Central de Ligacoes.
  10. **Isolamento por empresa esta OK em todas as fontes** (`requireAuth` +
      `requireEmpresaAccess` nas 4 rotas). Ressalva: `api-conversas.js:18` mantem o fallback da
      PJ (`$1::uuid = $2::uuid AND c.empresa_id IS NULL`) â€” nao e' criado por esta analise, mas
      e' o universo de onde o score de interesse sairia.
- **Padrao de modulo PURO a reusar (nao inventar outro):** `lib/site-rotulos.js`,
  `lib/followups-fila.js`, `lib/pendencias-instancia.js` e `lib/roteiros-lista.js` â€” o front
  TRADUZ o veredito do backend e nunca recalcula a regra.
- **Nada foi alterado:** entrega e' analise escrita. Se aprovada, a implementacao exige nova
  passada pelas Fases 3-11 (e Fase 5 obrigatoria: o item 2 acima e' uma divergencia visual real
  entre telas que ja existem).

---

## 2026-08-08 - Inicio de tarefa IA - Roteiros: selecao, ciclo de vida visivel, arquivados e exclusao protegida

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** Melhorar a experiencia da tela de Roteiros (`/dashboard/roteiros`): lista
  lateral limpa no uso diario (publicados na lista principal, secao recolhivel "Arquivados (n)"
  no fim), status como ciclo de vida VISIVEL (selo + frase de consequencia + acoes coerentes),
  estado de carregamento correto ao trocar de roteiro (destaque imediato, skeleton, acoes
  desabilitadas, nunca mostrar conteudo do roteiro anterior, erro com "Tentar novamente"), acao
  de excluir com confirmacao e PROTECAO contra exclusao destrutiva, e desarquivar.
- **E projeto/tarefa de alteracao?** Sim. A maior parte e' apresentacao/UX no frontend, mas
  TRES pontos caem nos gatilhos de confirmacao do CLAUDE.md e foram levados ao usuario ANTES de
  implementar: (a) **nao existe "roteiro arquivado"** â€” hoje o status e' da VERSAO
  (`app.roteiro_versoes.status`), nao do roteiro; a secao "Arquivados" pedida exige decidir onde
  esse estado mora; (b) **nao existe rota de exclusao** de roteiro/versao em lugar nenhum â€”
  criar DELETE numa entidade referenciada por historico de ligacoes e' mudanca estrutural;
  (c) o pedido cita "Atendimento Academias > Novo roteiro", mas **nao existe vinculo entre
  roteiro e instancia/atendimento** no schema.
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md,
  docs/ui-visual-standard.md, docs/project-map.md, docs/architecture-rules.md: Sim.
- **Areas mapeadas na Fase 0:**
  - Tela: `frontend/app/dashboard/roteiros/page.tsx` (unico arquivo da pagina; lista + editor +
    `ModalNovo` inline). Modulo puro ja existente e reusavel: `frontend/lib/roteiro-contexto-ia.js`.
  - API: `backend/src/routes/api-roteiros.js` (GET `/`, POST `/`, GET `/:roteiroId`,
    POST `/:roteiroId/versoes`, GET `/versoes/:versaoId`, PUT `/versoes/:versaoId/etapas`,
    POST `/versoes/:versaoId/publicar`, POST `/versoes/:versaoId/arquivar`). **Nao ha DELETE.**
    Admin-only + `requireEmpresaAccess` em todas.
  - Dados: `backend/src/db/roteiros.js` (toda query filtra `empresa_id`) e migration
    `sql/migrations/033_roteiros.sql` (`app.roteiros` / `roteiro_versoes` / `roteiro_etapas`).
  - Enums: `backend/src/domain-enums.js` (`ROTEIRO_VERSAO_STATUS`, `ROTEIRO_ETAPA_TIPO`) com
    anti-drift em `test/domain-enums.test.js`.
  - Testes existentes: `backend/test/roteiros.test.js` (validacao pura + guardas de imutabilidade
    e isolamento), `frontend/lib/roteiro-contexto-ia.test.js`.
- **Achados da Fase 0 que mudam o desenho pedido:**
  1. **Status e' da VERSAO, nao do roteiro.** `app.roteiros` tem apenas `ativo BOOLEAN NOT NULL
     DEFAULT true` (indexado em `idx_roteiros_empresa (empresa_id, ativo)`) â€” coluna criada na
     033 e **nunca escrita nem exposta** por rota, tela ou motor. `publicarVersao` ARQUIVA
     automaticamente a versao publicada anterior, entao quase todo roteiro saudavel tem versoes
     arquivadas: derivar "roteiro arquivado" do status das versoes daria resultado errado.
  2. **Exclusao nao pode ser destrutiva por default.** As FKs de historico apontam para roteiro/
     versao/etapa com **`ON DELETE SET NULL`** (`app.ligacoes`, `ligacao_etapas`, `ligacao_sinais`,
     `ligacao_objecoes`, `ligacao_perguntas`, `campanhas.roteiro_versao_id`) e as internas com
     `ON DELETE CASCADE` (`roteiro_versoes` -> `roteiro_etapas`). Ou seja: o banco **nao barra** o
     DELETE â€” ele apaga silenciosamente o vinculo do historico de ligacoes ja realizadas. A
     protecao tem de ser na camada de aplicacao.
  3. **Nao existe vinculo roteiro <-> instancia/atendimento.** O unico consumo do roteiro em
     producao e' `app.campanhas.roteiro_versao_id`, lido pela Central de Ligacoes
     (`frontend/app/dashboard/central-ligacoes/page.tsx`). O agrupamento mais proximo de
     "Atendimento Academias" que ja existe nos dados e' `app.roteiros.nicho` (TEXTO livre).
- **Fora de escopo declarado:** motor da Central de Ligacoes, campanhas, regras de imutabilidade
  da versao publicada, conteudo/etapas dos roteiros, prompts de producao, credenciais,
  integracoes externas e qualquer operacao em dados de producao.
- **Proxima etapa:** Confirmar com o usuario as 3 decisoes acima (onde mora o "arquivado", o que
  a exclusao pode apagar e o significado de "Atendimento X > Novo roteiro") e so entao
  implementar (Fase 3 em diante).

---

## 2026-08-08 - Inicio de tarefa IA - Follow-ups como fila operacional PAGINADA e Follow-up manual assistido

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** Continuar a reestruturacao da pagina de Follow-ups como fila operacional
  unica: paginacao de 25 com rodape/controles, remocao de identificadores tecnicos do Evolution
  e do rotulo solto "Escalado", busca ASSISTIDA por nome/telefone no Follow-up manual (com
  sugestao de leads existentes), criacao de follow-up para numero SEM lead existente com evento
  de origem persistente/auditavel, e retirada da area de Automacao de dentro de Follow-ups.
- **E projeto/tarefa de alteracao?** Sim. A maior parte e' apresentacao, mas TRES pontos sao
  estruturais e caem nos gatilhos de confirmacao do CLAUDE.md: (a) remover a area de Automacao
  remove funcionalidade de PRODUCAO (pausar o motor, capacidade de ligacoes/dia, reprocessar
  falhas); (b) "criar follow-up para numero sem lead" exige criar linha em `vendas.conversas`,
  o que muda o comportamento do atendimento em producao; (c) endpoint NOVO de busca de leads.
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md: Sim |
  docs/ui-visual-standard.md: a consultar na Fase 5 | docs/ai-decision-log.md: a registrar na Fase 8.
- **Estado REAL da tela hoje (medido no codigo, nao no pedido):** o commit `2621db9`
  ("Transforma a Central de Follow-ups numa fila unica de acoes") **ja entregou** boa parte do
  escopo: fila unica (uma linha por CONVERSA, `lib/followups-fila.js`), os **7 filtros rapidos
  exatos** que o pedido lista, "Personalizar filtros" no padrao do Banco de Leads (painel
  flutuante arrastavel), `ConversaHistoricoModal` da Central de Mensagens **ja reusado** ao abrir
  conversa, bolinha de prioridade com `aria-label`+`title` e "prioridade nao calculada" quando o
  backend nao pontuou, origem discreta como selo, e rolagem horizontal (`overflow-x-auto`).
- **Lacunas confirmadas no codigo (nao sao hipotese):**
  1. **Sem paginacao.** `page.tsx:367` mapeia `visiveis` INTEIRO no `<tbody>`. O modulo PURO
     `frontend/lib/paginacao.js` ja existe e ja e' o dono compartilhado (Aquisicao + Central de
     Ligacoes) â€” e' reuso, nao codigo novo.
  2. **Identificador tecnico do Evolution NA TELA.** `followup-listing.js:152` e `:42` fazem
     `COALESCE(NULLIF(p.apelido,''), NULLIF(p.negocio,''), c.numero) AS nome`, e
     `followups-fila.js:225` faz `nome: texto(h.nome) || numero`. Lead sem apelido/negocio
     aparece na coluna "Lead" como `5511999999999@s.whatsapp.net`. E' exatamente o que o pedido
     proibe.
  3. **Rotulo solto "Escalado"** existe em `page.tsx:469-473`; o pedido manda nao exibi-lo.
  4. **Follow-up manual nao tem busca assistida:** `page.tsx:780` e um input de telefone cru.
     Nao existe endpoint de sugestao por NOME â€” `GET /conversas` (`api-conversas.js:69`) filtra
     so por digitos do numero.
  5. **Numero sem lead existente e' RECUSADO hoje:** `followup-manual.js:56,83,122` chamam
     `buscarConversaEmpresa` e lancam **404** quando nao ha conversa daquela empresa. Nao existe
     entidade "Follow-up" persistida (o Manual e' compor+enviar), entao "referencia ao Follow-up
     criado" nao tem hoje a que se referir.
  6. **A area de Automacao existe e esta em uso** (`page.tsx:387-399, 542-654`): pausar/retomar
     (`PUT /config {pausado}`), capacidade de ligacoes/dia (`meta_ligacoes_dia`, que alimenta a
     marca "na capacidade do dia" da propria fila) e reprocessar falhas
     (`POST /auto/reprocessar`). O pedido poe isso FORA DE ESCOPO e proibe implementa-lo dentro
     de Follow-ups, mas so aponta Configuracoes como "direcao futura".
  7. **Casa pronta para o evento de origem:** `app.auditoria_eventos` (migration `047`) ja tem
     `empresa_id`, `usuario_id`, `entidade_tipo`, `entidade_id`, `acao`, `contexto` JSONB e
     `ocorrido_em`, com writer em `src/db/auditoria.js`. **Nenhuma migration nova e' necessaria**
     para o registro de auditoria. Ja `vendas.eventos_comerciais` NAO serve: tem CHECK fechado de
     `tipo` (`init.sql:311`) e nao carrega `empresa_id`.
  8. **Filtros sem fonte, ja declarados no AGENTS.md:** "Responsavel" (o item da fila nao tem
     dono; `usuario_id` so existe em ligacao ja registrada) e "Tipo de falha" (o motor grava
     `motivo_decisao` em texto livre, sem taxonomia). Continuam FORA, por decisao do proprio
     pedido ("exibir somente filtros sustentados por dados reais").
- **Semantica de estados â€” ja conforme, verificado:** `SITUACAO_POR_STATUS_IA.falhou` =
  `FALHA` (`followups-fila.js:63`), nunca `AGUARDANDO`; item humano com falha do automatico fica
  `ABERTO` + `tem_falha`. "Sem resposta" ja vira proxima acao humana pelo `dias_silencio` do
  `montarCallList`. Nada a corrigir aqui.
- **Conflitos materiais levados ao Victor ANTES da Fase 3 (nao decidi sozinho):**
  - **(1) Destino da area de Automacao.** Remove-la sem destino apaga a unica forma de pausar o
    motor de follow-up de uma empresa. O pedido nao autoriza criar a area em Configuracoes agora.
  - **(2) Follow-up manual para numero sem lead.** Atender o pedido ao pe da letra exige CRIAR
    `vendas.conversas` para aquele numero na empresa â€” e a partir dai o bot passa a atender
    aquele numero. E decisao de produto, com efeito em producao, nao de implementacao.
- **Arquivos que pretendo alterar/criar (sujeito as decisoes acima):** ALTERADOS
  `frontend/app/dashboard/follow-ups/page.tsx`, `frontend/lib/followups-fila.js` (+ `.d.ts`/
  `.test.js`), `backend/src/services/followup-listing.js` (nome sem JID),
  `backend/src/routes/api-follow-ups.js` (busca assistida); NOVOS testes de regressao. Docs:
  `AGENTS.md`, `docs/ai-decision-log.md`.
- **Fora de escopo (declarado pelo pedido):** area de Automacao/logs/telemetria/reprocessamento
  dentro de Follow-ups, cadencias e regras de disparo, credenciais e integracoes externas,
  **disparo real de mensagem em teste**, e commit/push/deploy.

---

## 2026-08-08 - Inicio de tarefa IA - Captura de atribuicao CTWA no WEBHOOK (por empresa + instancia)

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** Substituir a mineracao inoperante de `public."Message"` (banco do Evolution)
  por **captura no webhook**, no unico momento em que o sistema tem ao mesmo tempo o **telefone
  real**, a **empresa resolvida** e a **instancia de origem**. Atribuicao so e' elegivel para a
  Meta quando empresa E instancia forem **comprovadas**; nunca inferir empresa/instancia pelo
  telefone; sem backfill por inferencia. **Nenhum evento real a' Meta nesta tarefa.**
- **E projeto/tarefa de alteracao?** Sim. Toca **banco** (migration nova), **caminho de escrita de
  producao** (`POST /webhook` roda em toda mensagem recebida) e **leitura da integracao Meta**.
  Cai nos gatilhos de confirmacao do CLAUDE.md â€” mas a estrategia veio **declarada no proprio
  pedido** (capturar no webhook, escopar por empresa+instancia, desligar a varredura antiga).
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md: Sim |
  docs/ai-decision-log.md: a registrar na Fase 8 | ui-visual-standard.md: **nao aplicavel**
  (nenhuma tela nova; a API existente so' passa a devolver campo sanitizado).
- **Fatos reconfirmados no codigo HOJE (nao sao hipotese):**
  1. `services/meta-attribution.js:73` â€” `to_regclass('public."Message"')`. A tabela do Evolution
     esta em `evolution."Message"`; `public` esta vazio â‡’ `messageEvolutionExiste` devolve false e
     `sincronizarAtribuicaoMetaAds` etapa 1 e' **no-op silencioso a cada tick**. O mesmo CTE
     neutralizado aparece em `obterResultadosAnunciosMeta:191`.
  2. `meta-attribution.js:97,106` â€” o SQL depende de `m.key->>'remoteJidAlt'` e de
     `LIKE '%@s.whatsapp.net'`. Medido em 2026-08-08: `key` guarda so' `{fromMe,id,remoteJid}` e
     **100%** das 526 mensagens com `externalAdReply` tem `remoteJid` `@lid` â‡’ mesmo com o schema
     certo, o filtro descartaria todas.
  3. `webhook-handler.js:80` â€” `canonicoRemoteJidParaConversa(msg.key)` ja resolve o telefone
     canonico, e `vendas.conversas.numero` e' `@s.whatsapp.net` em 100% das conversas. O telefone
     existe **no webhook**, nao no banco do Evolution.
  4. `webhook-handler.js:219` â€” `salvarConversa(..., req.empresaId, req.evolutionInstance)`: a
     empresa e a instancia ja chegam resolvidas no handler.
  5. `middleware/tenant.js:61-88` â€” `resolveEmpresaFromWebhook` **nao distingue** empresa resolvida
     pela instancia de empresa vinda do **fallback PJ**. Hoje os tres caminhos (sem instancia,
     instancia nao mapeada, erro de consulta) produzem exatamente o mesmo `req.empresaId`. Sem
     essa distincao e' impossivel cumprir "fallback nao gera atribuicao elegivel".
  6. `app.empresa_whatsapp_instances.id` (uuid) **existe** e e' identificador confiavel de
     instancia â€” a dependencia de Fase B levantada no pedido **nao bloqueia** esta tarefa.
  7. `meta-dispatch.js:295` (`carregarAtribuicoes`) e `:87,145` (joins) leem o `ctwa_clid` de
     `vendas.lead_profiles.origem_anuncio` â€” a fonte que a varredura morta deveria ter preenchido.
- **Decisao de arquitetura minha (Fase 6), declarada antes de codar:** a atribuicao ganha **tabela
  propria** (`app.atribuicao_anuncios`), escopada por `empresa_id` + `instancia_id`, e **nao** vira
  mais uma coluna de `vendas.lead_profiles` (cuja chave e' o telefone GLOBAL â€” nao comporta duas
  instancias/dois negocios). `lead_profiles.origem_anuncio` continua sendo escrito para nao quebrar
  o painel legado, mas a **fonte de verdade da Meta passa a ser a tabela nova**.
- **Arquivos que pretendo alterar/criar:** NOVOS `sql/migrations/059_atribuicao_ctwa_webhook.sql`,
  `src/services/ctwa-atribuicao.js` (extracao PURA), `src/db/atribuicao-anuncios.js`,
  `test/ctwa-atribuicao.test.js`, `test/atribuicao-webhook.test.js`; ALTERADOS
  `src/middleware/tenant.js` (procedencia da empresa), `src/webhook-handler.js` (captura),
  `src/agent.js` (fiacao das deps), `src/services/meta-attribution.js` (varredura morta removida),
  `src/services/meta-dispatch.js` (le a fonte nova), `AGENTS.md`, `.env.example`,
  `docs/ai-decision-log.md`.
- **Fora de escopo (declarado pelo pedido):** ativar Meta CAPI, enviar evento real, OAuth da Meta,
  trocar a chave global de telefone por chave composta, backfill de CTWA historico por telefone,
  agenda/vendas/reunioes, commit/push/deploy.

---

## 2026-08-07 - Inicio de tarefa IA - Fase A: empresa_id real em vendas.lead_profiles

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** Corrigir o defeito em que `vendas.lead_profiles` recebe o `empresa_id`
  PADRAO da PJ em vez da empresa real, preparando a base para a Meta Conversions isolada por
  empresa (Fase B) e, depois, por instancia (Fase C, so' apos medicao). Escopo declarado:
  codigo + migration aditiva + script de backfill SEPARADO (simulacao por padrao) + medicao
  read-only em producao, se autorizada. **Parar antes de aplicar backfill em producao, antes da
  Fase B, antes de commit/push.**
- **E projeto/tarefa de alteracao?** Sim. Toca **banco** (migration) e **caminho de escrita de
  producao** (`atualizarPerfil` roda em toda mensagem). Cai nos gatilhos de confirmacao do
  CLAUDE.md â€” mas a estrategia ja veio **aprovada no proprio pedido** (fases A/B/C, preservar
  fallback PJ, nao migrar UNIQUE(numero), backfill fora do boot).
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md: Sim |
  docs/ai-decision-log.md: a registrar na Fase 8 | ui-visual-standard.md: **nao aplicavel**
  (nenhuma tela e' tocada nesta fase).
- **Fatos reconfirmados no codigo HOJE (nao sao hipotese):**
  1. `sql/migrations/006_vendas_empresa_default.sql:28` â€” `ALTER TABLE vendas.lead_profiles
     ALTER COLUMN empresa_id SET DEFAULT 'â€¦0001'` (PJ). O proprio cabecalho da 006 declara que
     o default sairia "quando o roteamento por instancia for ligado". Ele nunca saiu.
  2. Existem **4** caminhos de INSERT em `vendas.lead_profiles` e **nenhum** informa
     `empresa_id`: `db-crud.js:370` (`atualizarPerfil`, o principal), `learning.js:806`
     (memoria de vendas), `agent.js:5552` (`POST /dashboard/apelido`) e `agent.js:5820`
     (`capturarNomeContato`). Todos caem no DEFAULT PJ.
  3. `db-crud.js:126` (`salvarConversa`) **ja** grava `empresa_id` explicito com
     `COALESCE($empresa, PJ)` e `ON CONFLICT` que NUNCA migra dono
     (`COALESCE(vendas.conversas.empresa_id, EXCLUDED.empresa_id)`). E' o molde a seguir.
  4. `vendas.lead_profiles.numero` e' `UNIQUE REFERENCES vendas.conversas(numero)`
     (`db.js:294`) â€” **nao existe perfil sem conversa**. Logo a conversa e' fonte sempre
     disponivel no momento do INSERT, e ela ja carrega a empresa resolvida pela instancia.
  5. `empresa_id` **nao** esta em `LEAD_PROFILE_CAMPOS_PERMITIDOS` (`db-crud.js:13-45`) â€” a IA
     e as rotas nunca puderam setar esse campo, e nao vao poder depois desta fase.
  6. Consumidores que ja dependem de `lead_profiles.empresa_id` e sofrem HOJE com o default:
     `meta-attribution.js:227` (`obterResultadosAnunciosMeta`), `meta-dispatch.js:74 e 132`
     (join `lp.empresa_id = e.empresa_id` / `= c.empresa_id`),
     `meta-dispatch.js:288` (`carregarAtribuicoes`), `db/aquisicao-oportunidades.js:79`.
- **Efeito REAL do defeito, medido no codigo (nao e' vazamento, e' silencio):** como
  `meta-dispatch` casa `lp.empresa_id` com a empresa da REUNIAO/CONVERSA, um lead de anuncio da
  empresa B fica com `lp.empresa_id = PJ` e o join nao casa â‡’ `temAtribuicao = false` â‡’
  `reconciliarEmpresa` faz `continue` em `sem_atribuicao` e **nem registra o fato**. Ou seja: a
  conversao CTWA da empresa B nunca sai â€” e nao ha risco de ela sair no dataset da PJ, porque o
  telefone e' unico em `vendas.conversas` e a reuniao da B nao entra na lista da PJ. O prejuizo
  e' **perda de conversao**, nao mistura entre tenants. O painel `obterResultadosAnunciosMeta`,
  esse sim, mostra leads da B dentro da PJ.
- **Decisao de arquitetura minha (Fase 6), declarada antes de codar:** a fonte de `empresa_id`
  do perfil e' **a CONVERSA, dentro do proprio SQL** (subconsulta em `vendas.conversas`), e nao
  um parametro vindo dos ~20 chamadores. Motivos: (a) e' exatamente a coluna com que os
  consumidores casam (`lp.empresa_id = c.empresa_id`) â€” um parametro que discordasse da conversa
  reintroduziria o bug; (b) nenhum chamador consegue poluir o campo (IA/API nao alcancam);
  (c) diff minimo â€” zero mudanca de assinatura em caminho de producao.
- **Marcacao de origem (preparacao da Fase B):** coluna nova `empresa_id_origem`
  (`conversa` | `fallback_pj` | `backfill_conversa`; `NULL` = legado, procedencia desconhecida).
  E' o que permitira a Meta **recusar** o fallback da PJ na Fase B sem remover o fallback agora.
- **Arquivos que pretendo alterar/criar:** NOVOS `sql/migrations/058_lead_profiles_empresa.sql`,
  `src/db/lead-profile-empresa.js` (fragmentos SQL puros, fonte unica), 
  `scripts/backfill-lead-profiles-empresa.js`, `test/lead-profile-empresa.test.js`;
  ALTERADOS `src/db-crud.js`, `src/learning.js`, `src/agent.js` (2 INSERTs + nada mais),
  `src/services/meta-dispatch.js` (valvula de pausa), `package.json` (script npm),
  `.env.example` + `AGENTS.md` (env nova documentada), `docs/ai-decision-log.md`.
- **Fora de escopo (declarado pelo pedido):** aplicar backfill em producao sem nova confirmacao,
  trocar `UNIQUE(numero)` por `UNIQUE(empresa_id, numero)`, `instancia_id` em qualquer modelo,
  reescrever CTWA por instancia, remover o fallback da PJ, commit/push/ativacao da Meta.

---

## 2026-08-07 - Inicio de tarefa IA - Meta CAPI multitenant baseada em resultado de reuniao

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** Substituir a integracao Meta CAPI **global/single-tenant** que ja existe por
  uma integracao **isolada por empresa**, configurada pelo dono/admin do tenant (token manual +
  Dataset/Pixel), baseada em **resultado de reuniao** (`reuniao_agendada`, `reuniao_realizada`,
  `reuniao_realizada_com_venda`), com **ledger de eventos por empresa** (idempotencia pela
  entidade de negocio + tipo, nunca por telefone), reenvio de falhas e tela em
  **Configuracoes > Integracoes > Meta Conversions**. `cancelada`/`no_show` ficam SO internos.
- **E projeto/tarefa de alteracao?** Sim. Escopo **GRANDE e ESTRUTURAL**: migration nova
  (credenciais + ledger + tentativas), credenciais de terceiros cifradas em repouso, novo dominio
  de servico + worker, rotas admin novas, desligamento de um caminho de envio que **hoje roda em
  producao**, e tela nova. Cai em TODOS os gatilhos de confirmacao do CLAUDE.md (schema/banco,
  segredos, rotas, muitos arquivos).
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md: Sim |
  docs/analise-integracao-meta-multitenant.md: Sim (analise de 2026-08-06, 20 secoes â€” este pedido
  e' a implementacao das Fases 2-6 daquele documento) | docs/ui-visual-standard.md: a consultar na
  Fase 5 | docs/ai-decision-log.md: a registrar na Fase 8.
- **Fatos reconfirmados no codigo HOJE (nao sao hipotese, nao vieram so do relatorio):**
  1. `src/services/meta-capi.js:32-42` le `META_DATASET_ID`/`META_CAPI_TOKEN`/`META_PAGE_ID` do
     `process.env`. A funcao `enviarEventoMetaCAPI(evt, deps)` **nao recebe e nao conhece config**.
  2. `src/services/meta-attribution.js:198-213` â€” `dispararEventosMetaPendentes` faz
     `SELECT ... FROM vendas.lead_profiles WHERE p.origem='meta_ads'` **sem filtro de empresa_id**
     e manda todos os tenants para o mesmo dataset. Chamado por `sincronizarAtribuicaoMetaAds`
     (linha 158), que roda no tick global.
  3. `meta-attribution.js:225` â€” `event_id = ${numero}:${event_name}`: **um LeadSubmitted e um
     Purchase por telefone, para sempre**. E' exatamente a dedup por telefone que o pedido proibe.
  4. `meta-attribution.js:204-207` â€” `eventosDevidos` so pergunta `EXISTS(tipo='reuniao' AND
     excluido_em IS NULL)`: **reuniao cancelada e no-show ja contam como conversao hoje**.
  5. `vendas.agenda_eventos` (`sql/init.sql:565`) â€” onde o BOT cria a reuniao â€” **nao tem
     `empresa_id`**; e' chaveada por `usuario_id` â†’ `vendas.dashboard_users`. `app.agenda_eventos`
     (migration 011) tem `empresa_id NOT NULL`. Sao duas agendas com enums diferentes
     (`src/domain-enums.js`), e as duas aceitam `cancelado`/`nao_compareceu`/`concluido`.
  6. **Nao existe campo de VALOR de venda na reuniao.** O unico valor do sistema e'
     `vendas.conversas.venda_valor`, gravado por `PATCH /dashboard/agenda/:id/vendido`
     (`src/agenda.js:1362-1384`) â€” rota do **dashboard legado, sem tenant**, que casa por telefone.
  7. `src/meta-routes.js:13` â€” `GET /dashboard/meta/anuncios` devolve resultado de anuncios de
     **todos os tenants** para qualquer admin legado.
  8. `frontend/app/dashboard/integracoes/page.tsx` ja existe (entregue ontem) como pagina
     **100% estatica**, com o card "Meta Conversions" em *Em breve* e zero chamada ao backend.
  9. `app.freelandoo_connections` + `src/freelandoo/crypto.js` (AES-256-GCM) sao o molde pronto
     de credencial de terceiro cifrada por empresa. `assertMesmaEmpresa` (`src/db/ligacoes.js:18`)
     e' o molde de same-tenant assertion.
- **Conflitos materiais do pedido x codigo (motivo de parar antes da Fase 3):**
  - **(A) Venda com valor nao tem onde morar.** O pedido exige "valor da venda e moeda antes de
    criar o evento" E declara "novo modulo independente de vendas" como fora de escopo E manda
    "usar somente dados ja existentes". As tres coisas nao fecham: o unico valor existente esta
    numa rota single-tenant casada por telefone, e a reuniao multiempresa (`app.agenda_eventos`)
    nao tem campo de valor nem de resultado.
  - **(B) Reuniao do BOT nao carrega empresa_id.** O criterio "nao existe evento Meta sem
    empresa_id" exige uma regra de resolucao declarada para as reunioes de `vendas.agenda_eventos`.
  - **(C) A Meta so aceita 2 nomes de evento no CTWA.** Com `action_source=business_messaging`,
    `LeadSubmitted` e `Purchase` passam e nomes de pixel sao rejeitados (subcode 2804066, ja
    documentado no AGENTS.md). O pedido pede **tres** eventos configuraveis independentes â€”
    o mapeamento dos tres para a taxonomia aceita e' uma decisao de produto, nao de codigo.
- **Fora de escopo declarado (pelo proprio pedido):** OAuth/Facebook Login, Marketing API/gasto/
  CPA/ROAS, envio de no-show e cancelamento, modulo de vendas independente, coleta de campos novos
  de contato/atribuicao, remocao automatica de evento ja enviado, outros provedores.
- **Decisoes travadas com o Victor (Fase 2/6, antes de codar):**
  1. **(A) Resultado da reuniao reusa o `status` que a tabela ja tem** + 2 colunas novas
     (`venda_valor`, `venda_moeda`, `venda_registrada_em`) em `app.agenda_eventos`. Sem enum novo,
     sem modulo de vendas. `concluido` = realizada; `concluido` + valor = realizada com venda.
  2. **(B) A reuniao do BOT resolve empresa por `vendas.conversas.empresa_id`** (join por telefone
     de `metadata->>'lead_numero'`). Sem resolucao â‡’ nenhum evento. Risco residual do fallback da
     PJ (`tenant.js:78`) declarado e aceito.
  3. **(C) 3 eventos padrao distintos** â€” `LeadSubmitted` / `QualifiedLead` / `Purchase` â€”, com
     "Testar conexao" exercitando TODOS os eventos habilitados em modo teste ANTES de a ativacao
     ser liberada (o AGENTS.md registra `QualifiedLead` rejeitado numa taxonomia anterior).
  4. **Superadmin continua passando**, como no resto do sistema; token nao e devolvido nem a ele e
     toda escrita vira auditoria.
- **Decisao de arquitetura minha (Fase 6), fora das 4 perguntas:** o registro dos fatos e feito por
  um **RECONCILIADOR** que LE as reunioes, e nao por ganchos dentro de `handoff-alerts.js`,
  `ligacoes.js`, `agenda-multiempresa.js` e `agenda.js` (que era a proposta da analise de 06/08).
  Motivo: zero codigo novo dentro de transacoes que criam reuniao em producao, idempotencia por
  construcao e cobertura das reunioes que ja existiam. Registrado em `ai-decision-log.md`.
- **Entregue:** migration `057_meta_conversoes.sql`; NOVOS `src/segredos-crypto.js`,
  `src/services/meta-crypto.js`, `meta-conversao.js`, `meta-dispatch.js`, `meta-teste-conexao.js`,
  `src/db/meta-integracoes.js`, `src/db/conversao-eventos.js`,
  `src/routes/api-integracoes-meta.js`; REESCRITO `src/services/meta-capi.js` (recebe config, nao
  le env); `meta-attribution.js` perdeu o disparo global; `meta-routes.js` escopado na PJ;
  `agenda-multiempresa.js` grava venda; tick em `agent.js`; montagem em `index.js`.
  Front: NOVOS `frontend/app/dashboard/integracoes/meta/page.tsx` e
  `frontend/lib/meta-integracao.js` (+ `.d.ts`/`.test.js`); card de Integracoes deixa de ser
  "Em breve". Docs: `AGENTS.md`, `.env.example`, `ai-decision-log.md`.
- **Validacao executada:** `npm test` backend **1297/1297** (57 testes novos em 3 arquivos),
  `npm test` frontend **145/145** (17 novos), `npm run typecheck` backend e frontend limpos,
  `npm run smoke:preco` ok, e carga de todos os modulos novos via `require`.
- **Pendencia declarada:** **verificacao visual nao realizada** â€” sem MCP de navegador na sessao.
  Falta uma passada visual em `dashboard/integracoes/meta` (desktop e mobile) e o **piloto em modo
  teste na PJ** antes de ativar qualquer tenant, que e o que prova o mapeamento `QualifiedLead`.

---

## 2026-08-07 - Inicio de tarefa IA - Reorganizar a navegacao do painel por secoes

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** Reorganizar a navegacao lateral para o menu principal nao crescer a cada
  funcionalidade nova: manter no topo so as areas OPERACIONAIS (Central de Mensagens, Central de
  Ligacoes, Relatorios), agrupar as paginas administrativas/de parametrizacao sob um item
  expansivel **Configuracoes** (Instancias, Playbook, Modelo e IA, Prompts, Saudacoes, Uso e
  custos, Integracoes) e criar o ponto de entrada **Configuracoes > Integracoes**, cujo primeiro
  item sera **Meta Conversions**. Rotas atuais preservadas ou redirecionadas.
- **E projeto/tarefa de alteracao?** Sim. Escopo declarado pelo pedido como **Fase 1 de
  apresentacao**: sem schema, sem migration, sem env nova, sem backend de conversoes, sem Meta
  CAPI multitenant (tudo isso esta em `out_of_scope`). O pedido exige entregar PRIMEIRO o mapa
  rotas-atuais x estrutura proposta e **so implementar apos aprovacao explicita**.
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md: Sim |
  docs/ui-visual-standard.md: Sim (Fase 5 â€” o pedido mexe em sidebar/menu, caso coberto pela
  Regra nova 1) | docs/analise-integracao-meta-multitenant.md: Sim (secao 14 ja PROPOE
  `frontend/app/dashboard/integracoes` admin-only, ainda nao implementada).
- **Fatos confirmados no codigo (nao sao hipotese):**
  1. A navegacao inteira e uma constante `NAV` de **16 itens planos** em
     `frontend/components/Sidebar.tsx:10-27`, filtrada por `minRole` via `podePapel`
     (`lib/useSession.ts:36`). Nao existe nenhuma nocao de grupo/submenu hoje.
  2. `dashboard/layout.tsx` renderiza `<Sidebar />` como coluna fixa (`sticky`), retratil
     (76px/256px, persistida em `localStorage.dashboard_toolbar_retraido`). **Nao existe
     navegacao mobile separada** â€” nao ha `md:hidden`/drawer em lugar nenhum do frontend.
  3. Ja existe precedente de redirect de rota aposentada: `app/dashboard/empresa/page.tsx` faz
     `redirect('/dashboard/contextos')`. E o padrao a reusar para links antigos.
  4. `dashboard/aquisicao` **nao e uma pagina propria**: importa e renderiza
     `ProspeccaoPage` e `CaptacaoPage` em abas. Logo `/dashboard/prospeccao` e
     `/dashboard/captacao` existem como rota E como componente de outra rota.
  5. Nao existe nada de "Integracoes" no frontend (grep vazio) â€” a area nasce nesta tarefa.
  6. Nao existe pagina "Saudacoes" separada: hoje e uma pagina so,
     `/dashboard/prompts` = "Prompts & Saudacoes".
- **Conflito material encontrado (motivo de parar e perguntar antes da Fase 3):** o criterio de
  aceite diz que o menu principal contem APENAS 5 itens, mas 8 itens de HOJE nao cabem nem nos 5
  nem na lista de filhos de Configuracoes: **Visao Geral, Aquisicao, Banco de Leads, Follow-ups,
  Roteiros, Agenda, Contas** (+ `contextos` aparece como "Instancias" nos filhos). Sao paginas
  OPERACIONAIS, nao administrativas â€” enfia-las em Configuracoes contraria a propria regra de
  produto do pedido, e omiti-las contraria o requisito de UX "nao esconder funcionalidades sem
  rota de acesso clara". Preciso da decisao do Victor antes de desenhar a hierarquia final.
- **Arquivos que pretendo alterar (se aprovado):** `frontend/components/Sidebar.tsx` (grupos),
  NOVO `frontend/app/dashboard/integracoes/page.tsx` (ponto de entrada), possivelmente NOVO
  `frontend/lib/navegacao.js` + `.d.ts` + `.test.js` (logica PURA de arvore/ativo/permissao),
  e redirects em rotas renomeadas. Documentacao: `docs/ui-visual-standard.md` e
  `docs/ai-decision-log.md`.
- **Fora de escopo declarado (pelo proprio pedido):** Meta CAPI multitenant, backend de
  conversoes, tabelas/migrations, leitura de gastos pela Marketing API. Acrescento: nenhuma
  regra de permissao e afrouxada â€” `minRole` por item continua sendo a fonte, e a UI nunca
  vira o controle de acesso (o backend ja protege as rotas).
- **Decisoes travadas com o Victor (Fase 2/6, antes de codar):**
  1. **Dois grupos expansiveis**, nao um. As paginas operacionais viram o grupo **Operacao**
     (Aquisicao, Banco de Leads, Follow-ups, Roteiros, Agenda); as administrativas viram
     **Configuracoes** (Instancias, Playbook, Modelo e IA, Prompts e Saudacoes, Uso e custos,
     Integracoes, Contas). Visao Geral, Central de Mensagens, Central de Ligacoes, Relatorios e
     Perfil ficam soltos no topo. Isso resolve o conflito do criterio de aceite sem esconder
     funcionalidade e sem chamar Banco de Leads/Agenda de "configuracao".
  2. **Navegacao mobile ENTRA nesta fase** (drawer + overlay + hamburguer), assumindo o diff
     maior. Hoje ela nao existe: e comportamento novo, nao ajuste.
  3. **Integracoes** nasce como pagina com card "Meta Conversions" em estado *Em breve*,
     admin-only, **sem nenhuma chamada ao backend e sem campo de credencial**.
  4. **Nenhuma rota e renomeada.** Muda so o ROTULO (`/conversas` â†’ "Central de Mensagens",
     `/contextos` â†’ "Instancias", `/llm` â†’ "Modelo e IA", `/uso` â†’ "Uso e custos"). Zero
     redirect novo, zero link/bookmark/doc quebrado. Consequencia: `/dashboard/empresa`
     continua sendo o unico redirect do projeto.
  5. **Saudacoes NAO vira pagina propria** nesta fase â€” continua em `/dashboard/prompts`
     ("Prompts e Saudacoes"). Separar e trabalho de conteudo, fora do escopo de navegacao.
- **Ponto de atencao herdado (achado 2 da lista acima):** o alerta de instancia WhatsApp
  desconectada hoje e uma bolinha no item "Instancia". Com esse item dentro de um grupo FECHADO,
  o alerta ficaria invisivel â€” ele precisa **propagar para o cabecalho do grupo**, senao a
  reorganizacao esconde um aviso operacional que existe hoje.
- **Entregue (apos o "pode implementar" do Victor):** NOVO `frontend/lib/navegacao.js` +
  `.d.ts` + `.test.js` (arvore + regras PURAS, 22 testes), `frontend/components/Sidebar.tsx`
  reescrito (grupos expansiveis + barra e drawer do mobile), `frontend/app/dashboard/layout.tsx`
  (eixo vertical abaixo de `md`), NOVO `frontend/app/dashboard/integracoes/page.tsx` (estatica),
  `frontend/lib/useSession.ts` (reexporta `podePapel`/`NIVEL_ROLE`, que migraram para o modulo
  puro). Docs: `ui-visual-standard.md` (1a divergencia registrada do projeto) e
  `ai-decision-log.md`.
- **Validacao executada:** `npm test` frontend 128/128 (106 antes + 22 novos), `npm test`
  backend 1241/1241 (nenhum arquivo de backend tocado), `npm run typecheck` frontend limpo,
  e as rotas `/dashboard`, `/dashboard/integracoes`, `/dashboard/conversas` e `/dashboard/uso`
  compilando 200 no `next dev`.
- **`next build` NAO foi rodado de proposito:** havia um `next dev` ativo na maquina e dois
  processos sobre o mesmo `.next` corrompem o cache (problema ja conhecido neste ambiente).
- **Pendencia declarada:** **verificacao visual nao realizada** â€” o MCP de navegador nao estava
  disponivel na sessao, entao nao houve captura de tela. Falta uma passada visual em
  desktop/tablet/mobile no drawer, no trilho retraido e no alerta de instancia no cabecalho do
  grupo antes do deploy.

---

## 2026-08-07 - Inicio de tarefa IA - Aquisicao em dois modos: Busca e Rotinas

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** Separar a tela de Aquisicao (`dashboard/prospeccao`) em dois modos via
  controle segmentado no topo do conteudo: **Busca** (parametros da busca avulsa, disparo,
  status da coleta, tabela de leads captados, filtros e acoes) e **Rotinas** (estado, agenda,
  criterios, limites, ultima/proxima execucao, resumo da ultima coleta, historico compacto e
  acoes de ativar/pausar/salvar). Default `busca`; alternar so troca o conteudo, preserva o
  estado de cada modo, nao dispara coleta nem chamada externa; modo persistido na sessao e
  restauravel pela URL.
- **E projeto/tarefa de alteracao?** Sim. Escopo PEQUENO e **100% de apresentacao**: sem schema,
  sem migration, sem env nova, sem rota nova, **sem chamada nova ao backend**, sem prompt, sem
  autenticacao. Nenhuma regra de coleta, elegibilidade, custo ou pontuacao muda.
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md: Sim |
  docs/ui-visual-standard.md: Sim (o padrao reusado e o componente `components/ui/Abas.tsx` â€”
  pilulas WAI-ARIA em trilho arredondado â€” ja usado NESTA mesma tela em "Acompanhar resultados").
- **Fatos confirmados no codigo (nao sao hipotese):**
  1. `components/RotinasAquisicao.tsx` renderiza HOJE os dois blocos no mesmo componente:
     card "Rotinas de coleta" (L228-332) e card "Busca avulsa" (L334-380). O estado do
     formulario avulso (`avulsa`, L92) e o polling de 20s (L121-124) vivem nesse componente.
  2. O historico de coletas ja e um componente proprio (`HistoricoColetas.tsx`), alimentado por
     `dadosRotinas.atividade`, que vem do `onDados` de `RotinasAquisicao` â€” nao ha requisicao
     dedicada a mover.
  3. Os filtros da tabela de leads (`filtro`, `buscaDados`, `mercado`, `cidadeFiltro`, `ordem`)
     vivem em `page.tsx`, que permanece montado â€” alternar modo nao os reinicia.
  4. `carregar()` depende de `[empresaId, filtro, buscaDados, mercado, cidadeFiltro]` e o
     `carregar` das rotinas depende de `[empresaId, base]`: **nenhum dos dois depende do modo**,
     logo trocar de modo nao gera requisicao nem coleta.
  5. O projeto NAO usa `useSearchParams` em lugar nenhum (grep) â€” nao ha padrao de parametro
     de rota estabelecido.
- **Decisoes (Fase 6/8):**
  1. `RotinasAquisicao` continua **sempre montado**, na mesma posicao da arvore, recebendo
     `modo` como prop e renderizando so o card do modo ativo. E o unico jeito de nao reiniciar
     o formulario da busca ao ir em Rotinas e voltar â€” desmontar o componente perderia o estado.
  2. **Nenhum componente novo de toggle**: reuso do `Abas`/`PainelAba` existente (teclado,
     `aria-selected`, foco visivel, trilho rolavel no mobile ja resolvidos).
  3. O bloco de `erro` do `RotinasAquisicao` sai de dentro do card de rotinas para o container:
     hoje um erro de "Buscar agora" so era exibido dentro do card de rotinas â€” no modo Busca
     ele ficaria invisivel. Correcao necessaria da separacao, sem duplicar a mensagem.
  4. A aba "Historico de coletas" sai de "Acompanhar resultados" (que fica com Desempenho e
     Respostas, no modo Busca) e vira secao propria do modo Rotinas â€” e historico operacional
     de rotina, nao revisao de leads.
  5. Persistencia do modo: `sessionStorage` (sessao) + `?modo=` via `history.replaceState`,
     lidos em `useEffect` (nunca no render, para nao quebrar a hidratacao). Sem
     `useSearchParams`, que exigiria Suspense e mudaria o padrao de rota do projeto.
- **Arquivos alterados:** `frontend/app/dashboard/prospeccao/page.tsx`,
  `frontend/components/RotinasAquisicao.tsx`, `frontend/app/globals.css` (classe
  `.painel-troca`, a transicao curta da troca de modo), `frontend/components/HistoricoColetas.tsx`
  (so o comentario de cabecalho, que apontava para o lugar antigo).
- **Fora de escopo declarado:** backend inteiro, banco/migrations, Bright Data/coleta,
  Assistente de Oportunidades (logica), Banco de Leads, Central de Ligacoes, envio de WhatsApp,
  variaveis de ambiente.
- **Proxima etapa:** implementar o diff minimo e validar com `npm test` e `npm run typecheck`
  (frontend) + verificacao visual em desktop e mobile.

---

## 2026-08-07 - Inicio de tarefa IA - Paginacao da tabela da Fila da Central de Ligacoes

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** A tabela da FILA renderiza todos os leads de uma vez. Adicionar paginacao no
  RODAPE da tabela (25 por pagina, opcoes 25/50/100), com resumo "Mostrando 1-25 de 132 leads",
  anterior/proxima, pagina atual, total de paginas e seletor de itens por pagina. Trocar de pagina
  preserva filtros, ordenacao, campanha e modo da fila; mexer nos filtros volta para a pagina 1;
  ordenar o conjunto COMPLETO antes de paginar; sem recarregar a pagina; estado de carregamento
  leve so na area da tabela; botoes desabilitados nos extremos; rodape so aparece quando ha mais
  itens que o limite. Sem rolagem infinita.
- **E projeto/tarefa de alteracao?** Sim. Escopo PEQUENO e **100% de apresentacao**: sem schema,
  sem migration, sem env nova, sem rota nova, **sem chamada nova ao backend**, sem prompt, sem
  autenticacao. Nenhuma regra de elegibilidade/prioridade muda.
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md: Sim |
  docs/ui-visual-standard.md: Sim (o padrao reusado e o rodape de paginacao ja existente na aba
  **Acompanhamento** desta mesma tela, L787-795).
- **Fatos confirmados no codigo (nao sao hipotese):**
  1. `page.tsx:640` calcula `visiveis = filtrarFila(fila, view)` e `:710` mapeia `visiveis` INTEIRO
     no `<tbody>` â€” nao ha recorte de pagina na aba Fila hoje.
  2. A fila ja chega ORDENADA por prioridade do servidor (`services/ligacao-prioridade.js`) e
     `filtrarFila` e um `.filter()` que **preserva a ordem** â€” logo, paginar depois de filtrar ja
     satisfaz "ordenar o conjunto completo antes de paginar". Nada e reordenado no cliente.
  3. Lead sem telefone discavel nao entra na fila (requisito de ENTRADA do backend) â€” o total
     paginado ja e' o de elegiveis + filtrados, sem trabalho novo.
  4. O estado `pagina`/`POR_PAGINA` que existe hoje (`:546-548`) e' **exclusivo da aba
     Acompanhamento**; reusa-lo na Fila acoplaria as duas listas.
- **Decisoes (Fase 6/8):**
  1. Paginacao **client-side**, como os filtros: a fila ja vem inteira (`fila?limit=500`) e o
     recorte e' de apresentacao. Trocar de pagina **nao faz requisicao**.
  2. Logica PURA (`paginar`, `resumoPaginacao`, `normalizarPorPagina`, `TAMANHOS_PAGINA`) vai para
     `frontend/lib/fila-ligacoes-view.js` + `.d.ts` + testes â€” nenhuma aritmetica de pagina no `.tsx`,
     mesma convencao dos filtros.
  3. Tamanho de pagina **nao entra na `FilaView`**: nao e' filtro (nao pode virar chip nem contar
     em `contarFiltrosAtivos`). Persiste em chave propria do localStorage.
  4. "Ligar agora" e o destaque ambar continuam apontando para o **1o do conjunto filtrado
     inteiro**, nao para o 1o da pagina atual â€” a fila e priorizada, o topo nao muda por navegacao.
  5. Rodape aparece quando `total > porPagina` **ou** quando o operador escolheu um tamanho
     diferente do padrao â€” senao, escolher 100 com 40 leads esconderia o seletor e prenderia a
     escolha.
- **Arquivos alterados:** `frontend/lib/fila-ligacoes-view.js` + `.d.ts` + `.test.js`,
  `frontend/app/dashboard/central-ligacoes/page.tsx`.
- **Fora de escopo declarado:** backend (nenhum arquivo tocado), banco/migrations, abas
  Acompanhamento e Funil, tela de atendimento/roteiro/encerramento, Banco de Leads, coleta Bright
  Data, envio de WhatsApp, variaveis de ambiente.
- **Proxima etapa:** implementar o diff minimo e validar com `npm test` e `npm run typecheck`
  (frontend).

---

## 2026-08-07 - Inicio de tarefa IA - Classificacao canonica de SITE PROPRIO x rede social/agregador

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** Hoje um link QUALQUER preenchido em `prospectador.prospects.site` faz o
  lead contar como "tem site". Instagram, Facebook, TikTok, WhatsApp, Google Maps, Linktree e
  perfis de marketplace/diretorio aparecem como site proprio. Corrigir a CAUSA RAIZ: criar um
  classificador central e reusavel de URL, fazer TODOS os produtores e consumidores usarem o
  mesmo resultado canonico, reclassificar os dados historicos sem perder o link original e
  garantir que novas entradas nao reintroduzam o erro.
- **E projeto/tarefa de alteracao?** Sim. Escopo MEDIO/GRANDE e **estrutural**: toca regra de
  negocio compartilhada, schema (2 colunas aditivas), rotina de correcao de dados historicos,
  backend (produtores + consumidores) e 3 telas. **Nao toca** autenticacao, segredos, prompts de
  producao, rotas publicas nem coleta paga (Bright Data). Nenhuma env nova.
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md: Sim |
  docs/project-map.md: Sim | docs/architecture-rules.md: Sim.
- **Defeito real confirmado no codigo (nao e' hipotese):**
  1. `src/prospecting.js:1031` â€” `tem_site: !!place.websiteUri` (qualquer URL do Maps).
  2. `src/prospecting.js:1065` â€” `tem_site: !!(pIn.tem_site || pIn.site)` na persistencia.
  3. `src/services/social-capture.js:284,321` â€” `site = contato.link_bio || perfil.website` e
     `tem_site = Boolean(site)`: o **link da bio do Instagram** (tipicamente Linktree/WhatsApp)
     e' gravado como site proprio. Este e' o produtor mais grave.
  4. `src/services/ligacao-prioridade.js:95-101` (`situacaoSite`) â€” `if (site || tem_site === true)
     return 'tem_site'`: qualquer URL derruba o bonus de 40 pontos da fila de ligacoes.
  5. `src/services/aquisicao-curadoria-ranking.js:54` â€” `!!(lead.tem_site || texto(lead.site))`.
  6. `src/services/lead-score-cadastro.js:29,41-42,53` â€” 20 pontos de "Tem site" por qualquer URL.
  7. Frontend: `banco-leads/page.tsx:263,358` e `prospeccao/page.tsx:136,405-407` decidem
     "tem site" localmente por `site || tem_site` (logica duplicada fora do canonico).
- **Areas mapeadas (leitura antes de editar):** `src/prospecting.js` (mapearPlace,
  normalizarProspectParaPersistencia, salvarProspect, normalizarProspectPersistido),
  `src/services/places-brightdata.js`, `src/services/social-capture.js`,
  `src/services/ligacao-prioridade.js`, `src/services/aquisicao-curadoria-ranking.js`,
  `src/services/aquisicao-curadoria.js`, `src/services/lead-score-cadastro.js`,
  `src/services/followup-call-score.js`, `src/webhook-handler.js`, `src/db/campanhas.js`,
  `src/routes/api-banco-leads.js`, `sql/init.sql` + `sql/migrations/`,
  `frontend/app/dashboard/{banco-leads,prospeccao,central-ligacoes}/page.tsx`,
  `frontend/components/AssistenteOportunidades.tsx`, `frontend/lib/fila-ligacoes-view.js`.
- **Fora de escopo declarado:** o `tem_site` **conversacional** (o que o LEAD declara no
  WhatsApp) â€” `prompts/*.md`, `src/agent.js`, `src/turn-context-reader.js`, `src/core-funnel.js`,
  `vendas.lead_profiles`. Ali `tem_site` nasce de fala humana, nao de URL; o classificador de URL
  nao se aplica e mexer nisso alteraria prompt de producao sem necessidade.
- **Proxima etapa:** Fase 1/2 â€” apresentar entendimento, impacto e as duas decisoes de
  arquitetura (onde o canonico e' persistido; como a correcao historica roda) e aguardar
  confirmacao antes de implementar, conforme CLAUDE.md (schema/banco + mutacao de dados).

---

## 2026-08-07 - Inicio de tarefa IA - Painel de filtros FLUTUANTE da Central de Ligacoes

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** Hoje o botao "Filtros" da fila EXPANDE um bloco alto no fluxo da pagina,
  empurrando a tabela para baixo. Trocar por um **painel flutuante** ancorado no botao (padrao do
  modal flutuante do Banco de Leads): tabela nao se desloca, fecha no proprio botao / clique fora /
  Escape, filtros aplicados sobrevivem ao fechamento. Painel com largura fixa, altura maxima e
  rolagem interna; cabecalho "Filtrar fila" + contagem de filtros ativos + "Limpar filtros"; corpo
  agrupado (Operacao / Contato / Potencial comercial / Perfil do negocio / Presenca digital);
  rodape com previa da quantidade de leads + "Aplicar filtros" + "Cancelar". Aplicar SO no clique
  em Aplicar; chips compactos na barra depois de aplicar, removiveis um a um; "Limpar" volta a
  **fila padrao** (nao a uma lista sem criterio). Em telas menores, drawer com rolagem interna.
- **E projeto/tarefa de alteracao?** Sim. Escopo PEQUENO/MEDIO e **100% de apresentacao**:
  **sem schema, sem migration, sem env nova, sem rota nova, sem chamada nova ao backend, sem
  prompt, sem autenticacao**. Nenhuma regra de elegibilidade/prioridade da fila muda â€” quem entra
  e a ordem continuam decididos no backend (`services/ligacao-prioridade.js`).
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md: Sim |
  docs/ui-visual-standard.md: Sim (o padrao reusado e o `PersonalizarModal` do Banco de Leads â€”
  painel flutuante sem backdrop escuro, `max-h`, rolagem interna, cabecalho/rodape fixos).
- **Areas mapeadas (leitura antes de editar):**
  `frontend/app/dashboard/central-ligacoes/page.tsx` (`FiltrosFila`, barra da aba Fila, chips),
  `frontend/lib/fila-ligacoes-view.js` (+ `.d.ts`/`.test.js`),
  `frontend/app/dashboard/banco-leads/page.tsx` (`PersonalizarModal`, L1762-1881 â€” referencia).
- **Defeito real confirmado no codigo:** `page.tsx:537` renderiza `<FiltrosFila>` **no fluxo**,
  entre os chips e a tabela; o painel tem 6 grupos e `space-y-5`, entao abrir empurra a tabela
  centenas de pixels para baixo. Nao e' hipotese â€” nao ha portal nem posicionamento fixo ali.
- **Decisoes (Fase 6/8):**
  1. Painel em `createPortal` no `<body>` com `position:fixed` calculado do
     `getBoundingClientRect()` do botao â€” mesma tecnica ja usada no tooltip da Prioridade nesta
     mesma tela. Portal â‡’ altura zero no fluxo â‡’ a tabela nao se move (criterio de aceite 1).
  2. **Rascunho x aplicado:** o painel edita uma copia local; so "Aplicar filtros" troca a view da
     tela. Fechar (botao, clique fora, Escape) DESCARTA o rascunho e mantem o aplicado.
  3. "Limpar filtros" do painel volta a **`filaPadrao()`** (nao iniciados), nao ao neutro â€” o
     pedido exige que Limpar restaure o padrao da fila. `limparFiltros()` (fila inteira) continua
     existindo, oferecida no estado vazio como saida explicita.
  4. "Campanha" e "Telefone disponivel" seguem como INDICADORES, nao controles (decisao da tarefa
     anterior, mantida): a campanha ja tem seletor no topo e telefone discavel e' requisito de
     ENTRADA garantido no backend â€” o filtro seria no-op. A ordem ("maior prioridade primeiro")
     entra como indicador pelo mesmo motivo: quem ordena e' o servidor.
  5. Novo helper PURO `viewsIguais(a, b)` em `fila-ligacoes-view.js` para saber se o rascunho
     ainda nao foi aplicado e se ja se esta na fila padrao. Nenhuma logica de filtro no `.tsx`.
- **Arquivos alterados:** `frontend/lib/fila-ligacoes-view.js` + `.d.ts` + `.test.js`,
  `frontend/app/dashboard/central-ligacoes/page.tsx`.
- **Fora de escopo declarado:** backend (nenhum arquivo tocado), banco/migrations, tela de
  atendimento/roteiro/encerramento, abas Acompanhamento e Funil, Banco de Leads, coleta Bright
  Data, envio de WhatsApp, variaveis de ambiente.
- **Proxima etapa:** implementar o diff minimo e validar com `npm test` (frontend) e
  `npm run typecheck` (frontend).

---

## 2026-08-07 - Inicio de tarefa IA - Correcoes de UX/operacao da Central de Ligacoes

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** Corrigir a entrega anterior (Prioridade comercial da fila) em 3 frentes:
  (1) TIRAR o toggle "Visao simplificada/detalhada" da LISTAGEM e move-lo para a TELA DE
  ATENDIMENTO (apos clicar em Ligar), ao lado do bloco do lead, com a visao detalhada mostrando
  os dados enriquecidos do Bright Data; (2) o hover da Prioridade deve ser um TOOLTIP FLUTUANTE
  ancorado no circulo (nao pode aumentar a altura da linha nem ser cortado pelo container);
  (3) tentativa anterior deixa de ser bonus (1+ tentativas = 0 pontos) e a fila PADRAO passa a
  ser "telefone valido + nenhuma tentativa", com filtro `Nao iniciados | Com tentativa | Todos`;
  alem disso, o painel de filtros vira OPERACIONAL GERAL (grupos Operacao / Contato / Potencial
  comercial / Perfil do negocio / Presenca digital / Qualidade do dado), nao so "site".
- **E projeto/tarefa de alteracao?** Sim. Escopo MEDIO, quase todo em apresentacao + 1 peso de
  regra pura. **Sem schema, sem migration, sem env nova, sem rota nova, sem prompt, sem
  autenticacao, sem coleta nova** â€” todos os campos usados ja sao lidos hoje do cadastro.
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md: Sim |
  docs/ui-visual-standard.md: Sim (padrao de filtros/chips do Banco de Leads reusado).
- **Areas mapeadas (leitura antes de editar):** `src/services/ligacao-prioridade.js`,
  `src/db/campanhas.js` (`filaDeTrabalho`, `listarLeadsDaCampanha`), `src/routes/api-campanhas.js`,
  `frontend/lib/fila-ligacoes-view.js` (+ `.d.ts`/`.test.js`),
  `frontend/app/dashboard/central-ligacoes/page.tsx`,
  `frontend/app/dashboard/banco-leads/page.tsx` (`PersonalizarModal` â€” padrao visual dos grupos).
- **Defeito real confirmado no codigo (nao e hipotese):** o tooltip do circulo de prioridade e
  `position:absolute` DENTRO do `<td>`, e o wrapper da tabela e `overflow-hidden` â€” a bolha da
  1a linha e cortada pela borda superior do container. O comentario no codigo afirmava o
  contrario. Correcao: renderizar em PORTAL (`createPortal`) com `position:fixed` calculado do
  `getBoundingClientRect()` do circulo; fecha em scroll/resize.
- **Arquivos alterados/criados:** `backend/src/services/ligacao-prioridade.js`,
  `backend/src/db/campanhas.js`, `backend/test/ligacao-prioridade.test.js`,
  `frontend/lib/fila-ligacoes-view.js` + `.d.ts` + `.test.js`,
  `frontend/app/dashboard/central-ligacoes/page.tsx`.
- **Decisoes tomadas (Fase 6/8):**
  1. `PESOS.uma_tentativa` (5) e `PESOS.duas_ou_mais_tentativas` (0) viram um unico
     `PESOS.com_tentativa = 0`. Retentativa passa a ser FILA (filtro), nao bonus.
  2. Chave do localStorage sobe para `filaLigacoesView.v2`: a view salva na versao anterior tem
     `modo` (extinto) e `tentativas:'todas'` (valido no enum novo), e sobreviveria a
     normalizacao â€” o operador antigo nao veria a fila padrao "nao iniciados".
  3. "Campanha" (grupo Operacao) NAO ganha um segundo seletor dentro do painel: o controle ja
     existe no topo da pagina; duplicar o mesmo estado em dois lugares e o que o AGENTS.md
     proibe. O painel mostra a campanha ativa como indicador com a dica de onde troca-la.
  4. "Telefone disponivel" (grupo Contato) tambem NAO vira controle: telefone discavel e
     requisito de ENTRADA garantido no backend â€” o filtro seria sempre no-op. Vira nota fixa.
  5. `listarLeadsDaCampanha` passa a trazer os mesmos campos enriquecidos + `situacao_site`
     (reusando a funcao PURA `situacaoSite`, sem reimplementar a regra no front), senao a visao
     detalhada abriria VAZIA quando o atendimento e aberto pela aba Acompanhamento.
- **Fora de escopo declarado:** banco/migrations, roteiro/cockpit/encerramento da ligacao, aba
  Funil, Banco de Leads, coleta Bright Data, envio de WhatsApp, variaveis de ambiente.
- **Proxima etapa:** implementar o diff minimo e validar com `npm test` (backend e frontend) e
  `npm run typecheck` (frontend).

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
- **Areas mapeadas (leitura):** `src/db/campanhas.js` (`filaDeTrabalho` â€” unica consumidora e'
  `GET /campanhas/:id/fila`), `src/routes/api-campanhas.js`, `src/db/ligacoes.js`,
  `src/routes/api-ligacoes.js`, `src/services/followup-call-score.js` (padrao de PESOS puros),
  `sql/init.sql` + migrations 012/016/021 (colunas de prospects), `frontend/lib/ligacao-fone.js`,
  `frontend/app/dashboard/central-ligacoes/page.tsx`, `frontend/app/dashboard/banco-leads/page.tsx`
  (padrao de filtros/chips/pontos).
- **Arquivos que pretendo alterar/criar:**
  - NOVO `backend/src/services/ligacao-prioridade.js` (PURO: PESOS, situacao do site,
    telefone discavel, `calcularPrioridade`, ordenacao da fila).
  - NOVO `backend/test/ligacao-prioridade.test.js`.
  - EDIT `backend/src/db/campanhas.js` â€” `filaDeTrabalho` passa a trazer os sinais ja existentes
    do prospect, excluir telefone nao discavel e devolver `prioridade` (score + faixa + motivos).
  - NOVO `frontend/lib/fila-ligacoes-view.js` (+ `.d.ts` + `.test.js`) â€” filtros/chips PUROS.
  - EDIT `frontend/app/dashboard/central-ligacoes/page.tsx` â€” circulo de prioridade + tooltip,
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
- **Achado central (fato verificado no codigo, nao hipotese):** JA EXISTE integracao Meta CAPI â€”
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
  opcoes: (1) **Revisar oportunidades encontradas** â€” vai direto ao fluxo atual de aprovar/descartar;
  (2) **Encontrar novas oportunidades** â€” busca guiada perguntando o que mudar (nicho, localidade ou
  ambos). Sem configuracao manual de criterios, preservando o contexto da busca atual.
- **E projeto/tarefa de alteracao?** Sim â€” front-end (novo componente + fluxo) e um endpoint
  read-only novo no back-end. **Sem migration, sem env nova, sem mudanca de schema.**
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md: Sim |
  docs/ui-visual-standard.md: Sim (modal â€” Fase 5) | docs/ai-decision-log.md: a registrar na Fase 8.
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
     uma chamada de IA por abertura â€” por isso nasce um `GET /curadoria/resumo` read-only.
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
- **Proxima etapa:** Fases 3-9 â€” implementar o diff minimo e validar com `npm test` (back e front)
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
- **E projeto/tarefa de alteracao?** Sim â€” Fase 1 (analise de impacto) obrigatoria antes de codar;
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
  leads encontrados automaticamente pelo worker â€” nao existe area de candidatos nao importados; e
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
  quantidade/intervalo/dias) com motivo, evidÃªncias e confianÃ§a. O administrador **sempre aprova**;
  a IA nunca cria/edita/ativa rotina nem inicia coleta. DecisÃµes (aprovar/editar/dispensar) ficam
  registradas para a mesma sugestÃ£o nÃ£o reaparecer sem motivo novo. A Busca IA legada continua
  funcional nesta etapa (sem remoÃ§Ã£o).
- **E projeto/tarefa de alteracao?** Sim â€” feature GRANDE e ESTRUTURAL: migration nova, mÃ³dulo de
  sinais + geraÃ§Ã£o de sugestÃµes, rotas admin novas, nova seÃ§Ã£o na tela de AquisiÃ§Ã£o.
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | docs/ai-workflow.md: Sim |
  docs/architecture-rules.md: Sim | docs/project-map.md: Sim | docs/ui-visual-standard.md: a
  consultar na Fase 5 | docs/project-architecture.md: Sim | docs/ai-decision-log.md: a registrar
  na Fase 8.
- **Areas mapeadas (leitura, antes de qualquer edicao):**
  - `src/prospecting.js`: `selecionarMercadoDiarioIA` (2596), `resumoMercadosProspeccao` (2561),
    `verificarAgendaBuscaRecorrenteProspeccao` (2972 â€” Ã© ELE que chama `pesquisarPlaces` com a
    escolha da IA), `executarRotinasAquisicao` (3039), `pesquisarPlaces` (3710).
  - `src/services/aquisicao-rotinas-scheduler.js` (lÃ³gica pura de tempo/normalizaÃ§Ã£o/validaÃ§Ã£o),
    `src/db/aquisicao-rotinas.js` (CRUD + `listarAtividadeRecente`), `src/routes/api-aquisicao-rotinas.js`.
  - `src/services/prospecting-settings.js` (config legada da Busca IA: estratÃ©gia, nichos/regiÃµes
    permitidos, `busca_estado`), migrations `027` e `053`.
  - `src/routes/api-prospeccao.js` (`/resultados`, `/analytics`, `/metricas`) â€” fonte de sinal
    comercial jÃ¡ existente por nicho/cidade.
  - `index.js:98-99` (montagem admin-only) e `src/agent.js:483-495` (tick de 60s dos workers).
  - Front: `frontend/app/dashboard/prospeccao/page.tsx` e `frontend/components/RotinasAquisicao.tsx`.
- **Fatos confirmados no codigo (nao sao hipotese):**
  1. A autonomia de coleta paga da Busca IA estÃ¡ em `verificarAgendaBuscaRecorrenteProspeccao`,
     nÃ£o em `selecionarMercadoDiarioIA` (que sÃ³ devolve `{nicho, cidade, motivo, confianca}`).
  2. O sinal comercial por mercado JÃ existe: `prospectador.prospects` (status
     `enviado`/`respondeu`), `prospectador.lead_disparos` e `app.agenda_eventos` (reuniÃµes, casadas
     por telefone). O sinal de coleta estÃ¡ em `prospectador.busca_snapshots`
     (`total_prospects`/`novos_prospects`) e nos contadores da rotina.
  3. Isolamento por empresa jÃ¡ Ã© padrÃ£o em todas as tabelas envolvidas.
- **Areas possivelmente impactadas:** Banco (migration ADITIVA nova para sugestÃµes/decisÃµes),
  back-end (novo service de sinais + geraÃ§Ã£o, novas rotas admin), front-end (nova seÃ§Ã£o em
  AquisiÃ§Ã£o), custo de IA (1 chamada por anÃ¡lise â€” rastreada em Uso & Custo por empresa),
  visual/UX (nova seÃ§Ã£o), permissÃµes (mantidas: `requireAuth` + `requireRole('admin')` +
  `requireEmpresaAccess`). SEM impacto em envio de WhatsApp, Banco de Leads, prompts de produÃ§Ã£o
  ou segredos. NENHUMA chamada paga Ã  Bright Data Ã© feita por este mÃ³dulo.
- **Restricao declarada pelo usuario:** a IA nÃ£o pode chamar Bright Data nem qualquer funÃ§Ã£o de
  disparo; nÃ£o pode alterar rotinas direto no banco; a aprovaÃ§Ã£o passa por rota autenticada de
  admin com validaÃ§Ã£o de backend. Nenhuma chamada paga real na validaÃ§Ã£o.
- **Proxima etapa:** Fase 1-6 â€” entendimento, impacto e **confirmaÃ§Ã£o da arquitetura com o Victor**
  antes de escrever cÃ³digo (feature estrutural com migration).

---

## 2026-08-04 - Inicio de tarefa IA - Reestruturar Aquisicao como rotinas continuas de coleta

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** Transformar a Aquisicao de uma CONFIGURACAO UNICA por empresa em uma
  maquina de ROTINAS independentes (nicho + cidade + UF + dias + janela + intervalo >= 6h +
  quantidade 1..200 + ativo/pausado), com CRUD e observabilidade por rotina; remover o teto de
  1-2 buscas/dia; expor dias da semana (ja suportados no backend); corrigir a UF ausente na
  busca manual; e endurecer o disparo pago (idempotencia, tentativa persistida ANTES do trigger,
  uma coleta paga por empresa por vez, politica de tentativas/expiracao).
- **E projeto/tarefa de alteracao?** Sim â€” feature GRANDE e ESTRUTURAL: migration nova, troca do
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
  1. `api-prospeccao.js` POST `/buscar` envia so `{nicho, cidade}` â€” a UF (`estado_padrao`) NAO
     entra na geocodificacao; o automatico compoe "Cidade - UF" em `mercadoFixoDaConfig`, o
     manual nao.
  2. `pesquisarPlaces` checa `existeBuscaEmAndamento` e so DEPOIS chama a Bright Data; duas
     requisicoes simultaneas passam pela checagem juntas (TOCTOU) e geram DUAS coletas pagas.
  3. A linha em `busca_snapshots` e' inserida DEPOIS do trigger pago â€” se o INSERT falhar, a
     coleta paga fica orfa (sem registro, sem worker, sem cobranca rastreada).
  4. `processarBuscasPlacesPendentes` re-tenta indefinidamente em erro/estado desconhecido: nao
     ha contador de tentativas nem expiracao por idade.
- **Areas possivelmente impactadas:** Banco (migration aditiva nova), back-end (settings,
  scheduler, worker, rotas), front-end (tela Aquisicao), custos Bright Data (positivo: menos
  risco de coleta duplicada), permissoes (mantidas: `requireAuth` + `requireEmpresaAccess`),
  visual/UX (tela passa de formulario unico para lista de rotinas). Sem impacto em envio de
  WhatsApp, Banco de Leads, campanhas sociais, prompts ou segredos.
- **Restricao declarada pelo usuario:** nao fazer chamada real paga a Bright Data sem
  autorizacao explicita â€” a validacao sera por testes com cliente Bright Data mockado.
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
- **2a etapa (mesma data) â€” pendencias fechadas:**
  1. Corrida entre PAUSA e disparo: `marcarDisparo` passou a exigir `ativo = true` no mesmo
     UPDATE atomico; sem linha atualizada, o motor nao chama a Bright Data. +2 testes.
  2. Quantidade comunicada como "Max. de leads a importar" (nao promete volume coletado/custo).
  3. Migration 053 APLICADA em Postgres real: banco descartavel com casos patologicos + banco de
     desenvolvimento pelo caminho de boot (`runMigrations`). A config `automatico_fixo`
     (Barbearia/SBC/SP) virou rotina PAUSADA; o modo `ia` de outra empresa ficou intacto.
  4. Validacao visual/operacional: 33 verificacoes e2e contra o backend real com Bright Data
     NEUTRALIZADA + capturas desktop/mobile; os 6 estados observados na tela.
- **Correcao de diagnostico:** a 1a etapa afirmou ter corrigido um risco de "janela invertida
  abortar o boot". Esse caso NAO e alcancavel â€” `prospeccao_configuracoes` ja tem
  `CHECK (horario_fim > horario_inicio)` (colunas NOT NULL) e CHECK de cardinalidade nos dias.
  O tratamento defensivo permanece como seguro barato.
- **Efeito colateral declarado no banco de DEV:** o novo worker expirou um snapshot travado em
  `processando` desde 28/07 (`sd_ms4jo59...`, 0 leads) â€” comportamento novo e desejado. Durante a
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
- **E projeto/tarefa de alteracao?** Nao de CODIGO â€” nenhum arquivo de `backend/`, `frontend/` ou
  `sql/` sera alterado. E uma tarefa de DADOS: escrita em producao.
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md: Sim.
- **Estado verificado antes (somente leitura):** producao com as 17 migrations (033/038-052)
  aplicadas e `app.nichos`, `app.roteiros`, `app.roteiro_versoes`, `app.campanhas`,
  `app.campanha_leads` e `app.ligacoes` TODOS vazios. Empresa PJ Codeworks
  (`f5f47737-â€¦`) e 2.853 prospects ja existem; os 179 prospect_ids da campanha local
  foram conferidos um a um e os 179 existem em producao no tenant correto.
- **Escopo aprovado pelo Victor:** nicho "Funilaria e pintura automotiva" + roteiro
  "Atendimento a Funileiro" (11 etapas SPIN, publicado) + campanha "Demo â€” Funileiros" (ativa,
  metas 20/5) + os 179 leads, todos zerados em `nao_iniciado`.
- **Fora de escopo (decisao registrada):** as 18 ligacoes locais (8 encerradas / 10 descartadas)
  NAO sao recriadas â€” sao artefatos de teste e contaminariam a analitica que o modulo existe para
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
- **E projeto/tarefa de alteracao?** Nao no codigo de aplicacao â€” nenhum arquivo de `backend/src`,
  `frontend/` ou `sql/` foi tocado por esta tarefa. A unica escrita foi este registro de Fase 0.
  A tarefa PUBLICA trabalho ja concluido e validado em sessoes anteriores.
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md: Sim.
- **Validacoes executadas:** `npm test` backend (1061/1061), `npm test` frontend (27/27),
  `npm run typecheck` backend e frontend (limpos), `npm run smoke:preco` (ok), carga dos 16
  modulos novos via `require`, `node --check index.js`.
- **Verificacao da pendencia arquitetural:** confirmado que `src/db/ligacoes*.js` e
  `src/routes/api-ligacoes.js` NAO referenciam conversas/WhatsApp/historico-envio. A integracao
  Ligacoes â†” Mensagens permanece apenas documentada em
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
- **E projeto/tarefa de alteracao?** Nao nesta etapa â€” e analise/decisao de arquitetura. O pedido
  proibe explicitamente implementar, gerar codigo ou criar integracao prematura. Nenhum arquivo de
  `backend/` ou `frontend/` foi tocado.
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md: Sim (Fase 0 â†’ 2).
- **Areas mapeadas (leitura):** `src/db/ligacoes.js`, `ligacoes-estado.js`, `routes/api-ligacoes.js`,
  `domain-enums.js`, migrations 039/047/049/051, `services/rodar-leads.js`, `conversa-manual.js`,
  `followup-manual.js`, `db/followup-ligacoes.js`, `services/historico-envio.js`,
  `frontend/app/dashboard/central-ligacoes`, `banco-leads`, `components/ConversaHistoricoModal.tsx`.
- **Confirmacao:** Analise entregue no chat; nenhuma decisao foi aplicada em codigo/banco. Achados
  estruturais (identidade prospect_id â†” JID, duplicacao `vendas.followup_ligacoes` Ã— `app.ligacoes`,
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

## 2026-07-04 - InÃ­cio de tarefa IA â€” Modos Manual/Semi/Auto no Banco de Leads

- **IA/Ferramenta:** Claude Code (Opus 4.8)
- **Pedido resumido:** Transformar a pÃ¡gina **Banco de Leads** em uma central de disparo
  com **Modo Manual / SemiautomÃ¡tico / AutomÃ¡tico** configurÃ¡vel no "Rodar". A listagem se
  adapta ao modo. Unificar "SaudaÃ§Ã£o â€” teste e ediÃ§Ã£o" em **um botÃ£o** sÃ³ para verificar
  envio. Regras: Manual = usuÃ¡rio envia (clicar = aprovaÃ§Ã£o), pode escrever ou gerar por IA;
  Semi = mensagem jÃ¡ gerada por IA aguardando disparo do usuÃ¡rio (sem aprovaÃ§Ã£o);
  AutomÃ¡tico = janela horÃ¡ria, teto 100/dia, intervalo 15â€“30 min, sistema dispara sozinho
  (botÃ£o manual ainda existe, mas preferÃªncia Ã© do sistema). Adaptar bem transiÃ§Ãµes de status.
- **Ã‰ projeto/tarefa de alteraÃ§Ã£o?** Sim (feature grande â€” front + back + provÃ¡vel migration + worker).
- **Workflow padrÃ£o consultado?**
  - AGENTS.md: Sim
  - CLAUDE.md: Sim
  - docs/ai-workflow.md: Sim
  - docs/project-change-map.md: A consultar na Fase 7
  - docs/ai-decision-log.md: A registrar na Fase 8
  - docs/ui-visual-standard.md: Sim (tela/tabela/modal â€” impacta UX)
  - docs/project-architecture.md: Sim
  - Spec relacionada: docs/superpowers/specs/2026-07-03-saudacao-analise-e-estagios-design.md
- **Ãreas possivelmente impactadas:**
  - Front-end: Sim (banco-leads/page.tsx â€” barra de rodar, modal, tabelas)
  - Back-end: Sim (api-banco-leads.js, rodar-leads.js, provÃ¡vel novo worker/scheduler)
  - Banco de dados: ProvÃ¡vel (novo estado "gerada/aguardando disparo" + config de modo/agenda)
  - Financeiro: NÃ£o
  - Dashboards: NÃ£o
  - Assinaturas: NÃ£o
  - Custos: Sim (geraÃ§Ã£o IA por lead â€” jÃ¡ existe kill-switch por instÃ¢ncia)
  - PermissÃµes: NÃ£o (rota jÃ¡ Ã© admin-only)
  - IntegraÃ§Ãµes: WhatsApp (Evolution) â€” envio jÃ¡ existente
  - Visual/UX: Sim (listagem adapta ao modo)
  - Arquitetura: Sim (risco de duplicar o motor de modos da ProspecÃ§Ã£o â€” decidir reuso)
- **ConfirmaÃ§Ã£o:** A IA confirma que estÃ¡ utilizando o workflow padrÃ£o do projeto antes de alterar cÃ³digo.
- **PrÃ³xima etapa:** Fase 1â€“2 â€” Entendimento + ConfirmaÃ§Ã£o de escopo/arquitetura com o Alex (SEM tocar cÃ³digo ainda).

---

## 2026-07-04 - InÃ­cio de tarefa IA

- **IA/Ferramenta:** Claude Code (Opus 4.8)
- **Pedido resumido:** Aplicar o "Workflow PadrÃ£o de IA para Projetos v2.0" da PJ Codeworks
  (documento `Documentacao_Workflow_Padrao_IA_PJ_Codeworks_v2.docx`) â€” criar/atualizar os
  arquivos de governanÃ§a de workflow no repositÃ³rio.
- **Ã‰ projeto/tarefa de alteraÃ§Ã£o?** Sim (documentaÃ§Ã£o de governanÃ§a).
- **Workflow padrÃ£o consultado?**
  - AGENTS.md: Sim
  - CLAUDE.md: Sim
  - docs/ai-workflow.md: Criado nesta tarefa
  - docs/project-change-map.md: Criado nesta tarefa
  - docs/ai-decision-log.md: Criado nesta tarefa
  - docs/ui-visual-standard.md: Criado nesta tarefa (referencia `GUIA-VISUAL-PJ-CODEWORKS.md`)
  - docs/project-architecture.md: Criado nesta tarefa (referencia `project-map.md` + `architecture-rules.md`)
- **Ãreas possivelmente impactadas:**
  - Front-end: NÃ£o
  - Back-end: NÃ£o
  - Banco de dados: NÃ£o
  - Financeiro: NÃ£o
  - Dashboards: NÃ£o
  - Assinaturas: NÃ£o
  - Custos: NÃ£o
  - PermissÃµes: NÃ£o
  - IntegraÃ§Ãµes: NÃ£o
  - Visual/UX: NÃ£o (apenas documentaÃ§Ã£o de padrÃ£o)
  - Arquitetura: NÃ£o altera cÃ³digo; apenas documenta a arquitetura jÃ¡ existente
- **ConfirmaÃ§Ã£o:** A IA confirma que estÃ¡ utilizando o workflow padrÃ£o do projeto antes de alterar cÃ³digo.
- **PrÃ³xima etapa:** DocumentaÃ§Ã£o criada; cÃ³digo de produÃ§Ã£o nÃ£o foi tocado.

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
- **E projeto/tarefa de alteracao?** Sim (nova integracao de fonte de dados na prospeccao â€” estrutural).
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
  - Integracoes: Sim (Bright Data â€” nova rota/produto)
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
  - Front-end: Sim (instancias/[id]/contexto/page.tsx â€” painel de reuso)
  - Back-end: Sim (api-whatsapp.js â€” endpoint /contexto/duplicar + helper duplicarContexto)
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
- **E projeto/tarefa de alteracao?** Sim (feature grande â€” front + back + migration + IA).
- **Workflow padrao consultado?** AGENTS.md: Sim | CLAUDE.md: Sim | ai-workflow: Sim |
  project-map: Sim | architecture-rules: Sim | ui-visual-standard: Sim | project-architecture: Sim
- **Areas possivelmente impactadas:**
  - Front-end: Sim (nova pagina follow-ups + item no Sidebar)
  - Back-end: Sim (nova rota api-follow-ups + servicos de score/listagem; reusa motor de followup)
  - Banco de dados: Sim (migration aditiva: followup_config; followup_ligacoes so na Fase 2)
  - Custos: Sim (roteiro de ligacao + follow-up manual usam IA â€” ja rastreado na pagina Uso & Custo)
  - Integracoes: WhatsApp (envio ja existente) + IA (generateAIResponse)
  - Permissoes: rota admin-only
  - Visual/UX: Sim (padrao do Banco de Leads)
  - Arquitetura: Media (REUSAR o motor de follow-up existente, nao recriar envio/agendamento)
- **Confirmacao:** Workflow padrao seguido; escopo Fase 1 confirmado com o usuario.
- **Proxima etapa:** Fase 1 passo 1 â€” migration followup_config + db/followup-config.js.

---

## 2026-07-20 - Inicio de tarefa IA (Follow-ups Fase 2)

- **IA/Ferramenta:** Claude Code (Opus 4.8)
- **Pedido resumido:** Fase 2 da pagina de Follow-ups: (1) REGISTRAR RESULTADO da ligacao
  (atendeu / nao_atendeu / agendou / sem_interesse / ligar_depois) com notas + quem registrou;
  (2) efeitos: sem_interesse pausa o auto follow-up do lead, opcao de disparar follow-up no
  WhatsApp quando nao_atendeu, e dedup (lead ligado nas ultimas 12h sai da call-list);
  (3) METRICAS ligaÃ§Ã£o (total, por resultado, taxa de agendamento); (4) ESCADA de escalonamento
  visivel (lead que ignorou N follow-ups ganha selo "mensagem esgotou, hora de ligar").
- **E projeto/tarefa de alteracao?** Sim (feature â€” front + back + migration).
- **Workflow padrao consultado?** AGENTS.md/CLAUDE.md/ai-workflow/project-map/architecture-rules: Sim.
- **Areas possivelmente impactadas:**
  - Front-end: Sim (aba Semi da pagina Follow-ups: modal de registro + cards de metricas + selo escalado)
  - Back-end: Sim (novo db/followup-ligacoes.js + endpoints na rota api-follow-ups; ajuste em followup-listing.montarCallList)
  - Banco de dados: Sim (migration aditiva `030_followup_ligacoes.sql` = vendas.followup_ligacoes)
  - Custos: eventual disparo de follow-up no WhatsApp reusa o Manual (IA ja rastreada)
  - Integracoes: WhatsApp (envio ja existente via followup-manual), sem novas
  - Permissoes: endpoints admin-only (mesmo mount da pagina)
  - Arquitetura: Baixa/Media â€” reusa followup-manual para o disparo; nao mexe no engine.
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

## [DATA] - InÃ­cio de tarefa IA

- **IA/Ferramenta:**
- **Pedido resumido:**
- **Ã‰ projeto/tarefa de alteraÃ§Ã£o?** Sim/NÃ£o
- **Workflow padrÃ£o consultado?**
  - AGENTS.md: Sim/NÃ£o/Inexistente
  - CLAUDE.md: Sim/NÃ£o/Inexistente
  - docs/ai-workflow.md: Sim/NÃ£o/Inexistente
  - docs/project-change-map.md: Sim/NÃ£o/Inexistente
  - docs/ai-decision-log.md: Sim/NÃ£o/Inexistente
  - docs/ui-visual-standard.md: Sim/NÃ£o/Inexistente/NÃ£o aplicÃ¡vel
  - docs/project-architecture.md: Sim/NÃ£o/Inexistente/NÃ£o aplicÃ¡vel
- **Ãreas possivelmente impactadas:**
  - Front-end / Back-end / Banco / Financeiro / Dashboards / Assinaturas / Custos / PermissÃµes / IntegraÃ§Ãµes / Visual-UX / Arquitetura
- **ConfirmaÃ§Ã£o:** A IA confirma que estÃ¡ utilizando o workflow padrÃ£o do projeto antes de alterar cÃ³digo.
- **PrÃ³xima etapa:** Fase 1 - Entendimento do Pedido.

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
- **Pedido resumido:** Fazer a AquisiÃ§Ã£o respeitar o teto efetivo de 200 leads por busca, tornar o agendamento automÃ¡tico rodÃ¡vel, substituir os botÃµes/modais de Agenda por menus operacionais inline em Google Maps e Instagram e planejar o modo Busca IA com indicaÃ§Ã£o de esgotamento de nicho/localizaÃ§Ã£o.
- **E projeto/tarefa de alteracao?** Sim (backend, worker de busca, configuraÃ§Ã£o e UX da AquisiÃ§Ã£o).
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md, docs/project-map.md, docs/architecture-rules.md e docs/project-architecture.md: Sim.
- **Areas possivelmente impactadas:** Front-end, back-end, worker, banco de dados, custos Bright Data e visual/UX; sem mudanÃ§a em autenticaÃ§Ã£o, segredos, prompts de atendimento ou envio de WhatsApp.
- **Confirmacao:** O usuÃ¡rio solicitou explicitamente as duas correÃ§Ãµes. O modo Busca IA serÃ¡ apenas planejado nesta etapa, sem ampliaÃ§Ã£o silenciosa do escopo.
- **Proxima etapa:** Mapear o contrato da agenda e do snapshot, implementar diff mÃ­nimo e validar teto, execuÃ§Ã£o em segundo plano e regressÃµes.
## 2026-07-17 â€” Modo Busca IA configurÃ¡vel na AquisiÃ§Ã£o

- Pedido: implementar o modo Busca IA aprovado, com configuraÃ§Ã£o simples, estratÃ©gia equilibrada, limite diÃ¡rio, intervalo seguro, preferÃªncias de nicho/localizaÃ§Ã£o e mensagens claras de estado/esgotamento.
- Ãreas: configuraÃ§Ã£o multiempresa de prospecÃ§Ã£o, migration PostgreSQL, scheduler/worker de busca, seletor de mercado por IA, tela `dashboard/prospeccao` e testes.
- RestriÃ§Ãµes: reutilizar `selecionarMercadoDiarioIA`; mÃ¡ximo de 200 leads importados por busca; uma busca por vez; nenhum envio de WhatsApp; sem nova dependÃªncia ou segredo.
- ValidaÃ§Ã£o prevista: testes de settings/scheduler/rotaÃ§Ã£o/worker, suÃ­te completa, typecheck, boot com migration e verificaÃ§Ã£o visual responsiva.

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
- **Pedido resumido:** Refinamento visual das colunas Telefone e Status da Central de Ligacoes â€” reduzir ruido de texto, transformar avisos de qualidade do numero em indicador + tooltip, validar leitura da coluna Status.
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

---

## 2026-08-07 - Inicio de tarefa IA

- **IA/Ferramenta:** Claude Code
- **Pedido resumido:** UX da listagem de leads da Aquisicao (modo Busca): remover os 6 cards grandes de resumo, levar as contagens para dentro dos proprios filtros de status (Todos/Aguardando/Marcados/Descartados/Enviados/Responderam), criar rodape da tabela com intervalo exibido + total + taxa de resposta e adicionar paginacao (anterior/proxima, pagina X de Y), mantendo filtros, acoes e regras atuais.
- **E projeto/tarefa de alteracao?** Sim, escopo APRESENTACAO/NAVEGACAO + 1 ajuste ADITIVO de leitura no backend (o endpoint de metricas passa a aceitar os mesmos filtros da listagem, para as contagens dos chips baterem com a busca aplicada). Sem schema, sem migration, sem regra de negocio, sem escrita, sem chamada paga.
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md, docs/ui-visual-standard.md: Sim.
- **Areas possivelmente impactadas:** frontend/app/dashboard/prospeccao/page.tsx (tela), frontend/lib/paginacao.js (+ .d.ts/.test.js â€” modulo PURO extraido de lib/fila-ligacoes-view.js para nao duplicar paginacao), frontend/lib/fila-ligacoes-view.js (passa a reexportar a paginacao, sem mudanca de comportamento) e backend/src/routes/api-prospeccao.js (GET /metricas aceita busca/mercado/cidade/origem; sem parametro o resultado e' identico ao de hoje).
- **Fora de escopo declarado:** status/dados dos leads, regras de coleta e disparo, Banco de Leads, Central de Ligacoes, modo Rotinas, secao "Acompanhar resultados", schema e permissoes.
- **Proxima etapa:** Aplicar o diff minimo, rodar `npm test` + `npm run typecheck` no frontend e `npm test` no backend, e validar desktop/mobile (foco visivel, teclado, estados vazios).

---

## 2026-08-07 - Inicio de tarefa IA

- **IA/Ferramenta:** Claude Code
- **Pedido resumido:** VERIFICAR se a integracao Meta Conversions recem-implementada isola a configuracao por INSTANCIA (uma instancia = um negocio separado), sem fallback entre instancias, entre empresas ou para credencial global. Commit/push somente se todos os criterios de aceite passarem.
- **E projeto/tarefa de alteracao?** Nesta fase, NAO: tarefa de AUDITORIA/leitura. Nenhum arquivo de codigo foi alterado. A correcao (se aprovada) sera tarefa separada, com schema/migration e mudanca de modelo â€” exige confirmacao previa (CLAUDE.md).
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md: Sim.
- **Areas inspecionadas:** sql/migrations/057_meta_conversoes.sql, src/db/meta-integracoes.js, src/db/conversao-eventos.js, src/services/meta-dispatch.js, meta-capi.js, meta-crypto.js, meta-attribution.js, src/routes/api-integracoes-meta.js, src/middleware/tenant.js, src/webhook-handler.js, src/meta-routes.js, frontend/app/dashboard/integracoes/meta, test/meta-*.test.js.
- **Resultado:** REPROVADO nos criterios de isolamento por instancia. O modelo implementado e' por EMPRESA (`app.meta_integracoes.empresa_id UNIQUE`); a dimensao instancia nao existe em schema, backend, rotas, tela nem testes. Ver relatorio no chat.
- **Efeito colateral declarado:** nenhum. Somente leitura + `npm test` (1297/1297 passaram). Unica escrita: este registro de log.
- **Proxima etapa:** NAO commitar nem dar push (stop condition acionada). Apresentar o laudo e o plano de correcao ao usuario e aguardar aprovacao antes de qualquer migration.

## 2026-08-08 - Inicio de tarefa IA

- **IA/Ferramenta:** Claude Code
- **Pedido resumido:** Remover o fallback para a PJ em `resolveEmpresaFromWebhook` (instancia ausente, desconhecida ou erro de resolucao) e substituir por QUARENTENA auditavel: o webhook sem dono comprovado nao cria conversa, lead, reuniao, atribuicao CTWA, follow-up, resposta automatica nem evento Meta. Inclui visibilidade administrativa das pendencias e caminho seguro de reprocessamento. Commit + push ao final, se os criterios de aceite passarem.
- **E projeto/tarefa de alteracao?** Sim, e ESTRUTURAL: muda o contrato de resolucao de tenant do webhook publico, adiciona migration (tabela de quarentena), rota admin nova e tela. Exige confirmacao previa (CLAUDE.md) â€” pontos ambiguos levados ao usuario antes de implementar.
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md: Sim.
- **Areas mapeadas na Fase 0:** `src/middleware/tenant.js` (unico produtor do fallback), `index.js:134` (unico ponto de montagem), `src/webhook-handler.js` (unico consumidor de `req.empresaId`/`req.empresaOrigem`/`req.whatsappInstanciaId`), `src/services/ctwa-atribuicao.js` (ORIGEM_EMPRESA), `src/db/empresas.js` (`findEmpresaEInstanciaPorEvolution`), `src/db-crud.js:134` e `src/db/lead-profile-empresa.js` (PJ como default de escrita), `src/meta-routes.js` (dashboard legado escopado na PJ).
- **Fora de escopo declarado:** ativar a Meta, configurar token/Dataset, qualquer chamada a Graph API, deploy manual e alteracao de configuracao de producao.
- **Risco de producao declarado:** AGENTS.md registra medicao de 2026-08-08 em que 3 de 6 conversas marcadas como PJ vieram de instancia NAO MAPEADA e 2 sem instancia. Com a quarentena ligada, essas conversas deixam de ser respondidas ate a instancia ser mapeada.
- **Proxima etapa:** Confirmar com o usuario a profundidade da quarentena (guarda payload para replay ou so a pendencia) e a estrategia de corte em producao; so entao implementar.

---

## 2026-08-08 - Inicio de tarefa IA

- **IA/Ferramenta:** Claude Code
- **Pedido resumido:** ORIGEM AUTORIZADA de instancia. Unica origem valida de um vinculo empresa-instancia e' o fluxo de criacao DENTRO do Atendimento Views. Instancia criada direto no Evolution (API externa, painel da infra) nao pertence a empresa alguma e NAO pode ser regularizada por tela administrativa: remover a adocao na criacao, remover o reprocessamento da quarentena, transformar a tela de pendencias em alerta tecnico/auditoria somente leitura e gravar evidencia persistente de origem autorizada junto do vinculo.
- **E projeto/tarefa de alteracao?** Sim, e ESTRUTURAL: muda o contrato da criacao de instancia (rota publica do dashboard), remove endpoint existente (`POST /api/webhook-quarentena/:id/reprocessar`), exige migration em `app.empresa_whatsapp_instances` e altera tela. Exige confirmacao previa (CLAUDE.md) â€” pontos que podem parar atendimento em producao levados ao usuario ANTES de implementar.
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md: Sim.
- **Areas mapeadas na Fase 0:** `src/routes/api-whatsapp.js:769-817` (o `alreadyExists` engolido e' HOJE o caminho de adocao de instancia externa), `src/routes/api-webhook-quarentena.js` (rota de reprocessamento a remover), `src/db/webhook-quarentena.js` (`resolverPendencia`/`buscarPendencia`), `sql/migrations/060_webhook_quarentena.sql` (colunas `resolvida_*` e CHECK), `src/services/webhook-quarentena.js` (vocabulario e acoes por motivo), `src/middleware/tenant.js` + `src/db/empresas.js` (`findEmpresaEInstanciaPorEvolution`), `src/routes/api-freelandoo.js:106` e `src/routes/freelandoo-provision.js:207` (os outros dois INSERT de vinculo, tambem autorizados), `frontend/components/PendenciasInstancia.tsx` + `frontend/lib/pendencias-instancia.js`, testes `test/webhook-quarentena*.test.js` e `frontend/lib/pendencias-instancia.test.js`.
- **Achado colateral (fora do escopo pedido, so registrado):** `src/db/whatsapp-instances.js:33` `resolverEmpresaPorInstance` ainda devolve a PJ como fallback; nao tem NENHUM chamador de producao (so `test/multitenant.test.js`).
- **Fora de escopo declarado:** credenciais, integracoes externas e configuracao da Meta; fluxos de dashboard e atendimento manual que nao dependem do webhook; qualquer heuristica de associacao por nome/numero/e-mail.
- **Risco de producao a confirmar:** instancias JA vinculadas nao tem evidencia de origem. Exigir a evidencia no webhook sem carencia pararia o atendimento de todas elas.
- **Proxima etapa:** Confirmar com o usuario (1) o tratamento das instancias legadas e (2) se a pendencia passa a ser permanente ou admite arquivamento; so entao implementar.

---

## 2026-08-08 - Inicio de tarefa IA

- **IA/Ferramenta:** Claude Code
- **Pedido resumido:** Fechar a entrega de ORIGEM AUTORIZADA removendo o ultimo fallback legado para a PJ: `resolverEmpresaPorInstance` em `src/db/whatsapp-instances.js`. A funcao passa a devolver AUSENCIA de empresa quando nao existe vinculo valido, jamais a PJ. Depois: proteger contra regressao, validar (testes + typecheck backend e frontend) e publicar TODA a entrega (origem autorizada + quarentena somente leitura + remocao do fallback) em UM commit, com push.
- **E projeto/tarefa de alteracao?** Sim, mas de escopo PEQUENO e contido: a funcao alterada nao tem NENHUM chamador de producao (auditoria confirmada nesta fase). Sem schema novo, sem migration nova, sem rota, sem chamada externa, sem escrita no banco.
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md: Sim.
- **Auditoria do fallback (Fase 1 do pedido):** `resolverEmpresaPorInstance` e' importada em UM unico lugar no repositorio inteiro â€” `test/multitenant.test.js:10`. Os demais consumidores de `src/db/whatsapp-instances.js` importam so `instanciaUsaAgenda` (`src/services/contexto2-runtime.js`), `removerContextoSeOrfao` (`src/routes/api-freelandoo.js`) e os invalidadores de cache (`src/routes/api-whatsapp.js`). O resolvedor de producao e' `findEmpresaEInstanciaPorEvolution` (`src/db/empresas.js`), chamado por `src/middleware/tenant.js`. **Nenhuma dependencia de producao: a remocao do fallback esta liberada** (stop condition do pedido NAO acionada).
- **Areas impactadas:** `src/db/whatsapp-instances.js` (fallback removido) e `test/multitenant.test.js` (os 3 testes que exigiam a PJ viram testes que exigem ausencia de empresa).
- **Fora de escopo declarado:** credenciais, variaveis de ambiente, Meta e integracoes externas; os demais `PJ_EMPRESA_ID` do repo (dashboard legado single-tenant e defaults de ESCRITA em `db-crud.js`/`lead-profile-empresa.js`), que nao resolvem tenant por instancia; qualquer operacao em dados de producao.
- **Fora do commit (WIP alheio):** `backend/scripts/seed-campanha-nail-designer.js`.
- **Proxima etapa:** Aplicar o diff minimo, rodar `npm test` no backend, `npm test` + `npm run typecheck` no frontend e `npm run typecheck` no backend, revisar o diff completo e so entao commit + push na `master`.

---

## 2026-08-08 - Inicio de tarefa IA

- **IA/Ferramenta:** Claude Code
- **Pedido resumido:** Reestruturar a pagina de Follow-ups como FILA UNICA de acoes: substituir as abas fragmentadas (Atendimento humano / Automatico / Manual) por filtros rapidos (Todos, Aguardando, Proxima acao hoje, Atendimento humano, Atendimento IA, Falhas, Concluidos) + botao "Personalizar filtros" (modal no padrao do Banco de Leads), com prioridade visual/acessivel por item e area separada de saude/configuracao da automacao. Sem alterar regras de envio, atendimento, permissoes ou historico.
- **E projeto/tarefa de alteracao?** Sim, escopo APRESENTACAO/NAVEGACAO no frontend + possivel ajuste ADITIVO de leitura no backend (campo estruturado da janela recomendada, para o filtro "Proxima acao hoje" nao depender de parsing de texto no front). Sem schema, sem migration, sem regra de envio, sem escrita nova, sem chamada paga.
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md, docs/ui-visual-standard.md: Sim.
- **Areas mapeadas na Fase 0:** `frontend/app/dashboard/follow-ups/page.tsx` (unica tela; 3 abas), `backend/src/routes/api-follow-ups.js` (config, /auto, /call-list, /roteiro, /ligacoes, /manual/*), `backend/src/services/followup-listing.js` (montarCallList + timeline do automatico), `backend/src/services/followup-call-score.js` (acao recomendada, score, temperatura, janela), `backend/src/db/followup-config.js` (modo/meta/pausado), padroes a reusar: `frontend/app/dashboard/prospeccao/page.tsx` (chips de filtro com contagem), `frontend/lib/prospeccao-listagem.js` (modulo PURO de apresentacao), `frontend/app/dashboard/banco-leads/page.tsx` (`PersonalizarModal` + persistencia em localStorage), `frontend/components/ui/Abas.tsx`.
- **Achado relevante da Fase 0:** `app.followup_config.modo` NAO e lido por nenhum motor â€” `followup-auto.js` le apenas `fc.pausado`. Hoje clicar numa aba GRAVA `modo` na empresa; como filtro de tela isso viraria escrita de configuracao a cada clique. Preferencia de filtro passa a ser local (localStorage), como no Banco de Leads/Aquisicao; o endpoint de config permanece intacto.
- **Fora de escopo declarado:** motor de follow-up automatico (`followup-auto.js`), regras de call score/elegibilidade, envio/throttle, permissoes admin, schema, Central de Ligacoes e Banco de Leads.
- **Proxima etapa:** Confirmar com o usuario 3 decisoes de produto (destino da aba Manual, universo do filtro "Todos" e o campo aditivo da janela) antes de implementar.

---

## 2026-08-08 - Inicio de tarefa IA

- **IA/Ferramenta:** Claude Code
- **Pedido resumido:** Validar de ponta a ponta se o "Abrir conversa" da Central de Follow-ups abre a MESMA experiencia de detalhe de conversa do Historico da Central de Mensagens. Havendo divergencia, corrigir reutilizando/extraindo o painel ja usado no Historico â€” sem alterar regras comerciais, sem disparar WhatsApp e sem tocar dados reais durante a validacao.
- **E projeto/tarefa de alteracao?** Sim, escopo APRESENTACAO no frontend. Nenhuma rota, schema, migration, prompt, permissao ou regra de negocio muda. Backend NAO e tocado.
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md, docs/ui-visual-standard.md: Sim.
- **Areas mapeadas na Fase 0:** `frontend/app/dashboard/conversas/page.tsx` (painel completo INLINE, ~320 linhas de JSX dentro da pagina), `frontend/components/ConversaHistoricoModal.tsx` (modal enxuto somente-leitura), `frontend/app/dashboard/follow-ups/page.tsx:419` (abre o modal enxuto), `frontend/app/dashboard/banco-leads/page.tsx:1390` (tambem usa o modal enxuto, com props de saudacao/disparo â€” OUTRA funcao), `backend/src/routes/api-conversas.js` (contrato), `backend/index.js:94,107` (montagem/permissoes), `frontend/lib/followups-fila.js` (dono de `nomeDeVerdade`/`formatarTelefone`/`rotuloLead`).
- **Achado da validacao (divergencia CONFIRMADA):** os dois pontos de entrada NAO compartilham painel. Historico usa um painel completo (abas Conversa/Interesses, prioridade comercial, feedback por mensagem, compositor do operador, orientar resposta, pausar/retomar agente, reenviar WhatsApp, deletar historico); Follow-ups usa `ConversaHistoricoModal`, que so LE o historico e nao oferece nenhuma acao. Mesmo endpoint (`GET /conversas/:numero`) e mesmas permissoes nos dois caminhos â€” a divergencia e 100% de apresentacao.
- **Fora de escopo declarado:** backend inteiro; Banco de Leads (segue com `ConversaHistoricoModal`, cujas props de gerar/enviar saudacao pertencem ao "Rodar leads", nao a este painel); regras de envio, cadencia e conteudo de mensagem; exclusao destrutiva alem da ja existente.
- **Proxima etapa:** Extrair o painel do Historico para `frontend/components/ConversaPainel.tsx` (auto-carregado por `numero`, com token de requisicao, estado de carregando e erro com "Tentar de novo"), extrair a identidade humana do lead para `frontend/lib/lead-identidade.js` (reexportada por `followups-fila.js`, sem duplicar regra) e consumir o painel nas DUAS telas. Validar com `npm test` + `npm run typecheck` no frontend e `npm test` no backend.

---

## 2026-08-08 - Inicio de tarefa IA

- **IA/Ferramenta:** Claude Code
- **Pedido resumido:** CONSOLIDAR o indicador visual de pontuacao (a "bolinha") num componente unico, reutilizavel e acessivel, preservando o SIGNIFICADO por pagina; e REDUZIR as colunas operacionais das tabelas de Aquisicao e Banco de Leads sem perder acesso aos dados. Escopo: Central de Ligacoes, Central de Mensagens, Aquisicao, Banco de Leads.
- **E projeto/tarefa de alteracao?** Sim, escopo APRESENTACAO no frontend. Nenhuma rota, schema, migration, prompt, permissao, regra de negocio ou variavel de ambiente muda. Backend NAO foi tocado (nem um arquivo).
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md, docs/ui-visual-standard.md, docs/analise-indicador-pontuacao.md: Sim.
- **Base:** a analise previa (`docs/analise-indicador-pontuacao.md`, 2026-08-08) ja mapeara as 3 implementacoes divergentes da bolinha, as 4 pontuacoes do produto e as colunas das duas tabelas. Esta tarefa IMPLEMENTA aquela analise.
- **Decisoes de negocio que estavam pendentes na analise e vieram RESOLVIDAS no pedido:** (7.1) NAO criar potencial de abordagem sem fonte -> nao criado; (7.2) manter a direcao numerica de "Pontos" e usar paleta NEUTRA -> feito; (7.4) remover o emoji de temperatura da Aquisicao -> autorizado e feito; (7.5) tirar o JSON cru da tabela preservando o modal -> autorizado e feito. (7.3) paleta de Follow-ups continua pendente: a tela esta FORA do escopo declarado.
- **Areas alteradas:** `frontend/lib/pontuacao-indicador.js` (+ `.d.ts`/`.test.js`, modulo PURO novo), `frontend/components/ui/BolinhaPontuacao.tsx` (novo), `frontend/components/LeadDetalhesModal.tsx` (novo), `frontend/components/ui/JsonLeadModal.tsx` (tipo `criterios` declarado, aditivo), `frontend/components/ConversaPainel.tsx`, `frontend/app/dashboard/central-ligacoes/page.tsx`, `frontend/app/dashboard/prospeccao/page.tsx`, `frontend/app/dashboard/banco-leads/page.tsx`.
- **Achado que mudou o desenho:** na Aquisicao e no Banco de Leads a bolinha pintava COMPLETUDE DE CADASTRO com a paleta de PRIORIDADE COMERCIAL (`<=40 vermelho ... >70 esmeralda`). As duas pontuacoes andam em direcoes OPOSTAS â€” a propria tela ordena por `pontos ASC`. Ou seja, o melhor lead da campanha aparecia em vermelho. Corrigido com uma variante semantica de paleta NEUTRA, nao reusando a de prioridade.
- **Mutacao de dado do operador declarada:** a view do Banco de Leads no `localStorage` (`bancoLeadsView`) ganhou `versao`. Na migracao v1->v2 os FILTROS e a ORDENACAO sao preservados integralmente e apenas o conjunto de COLUNAS passa a ser o novo padrao enxuto (reversivel em um clique no "Personalizar").
- **Fora de escopo declarado:** backend inteiro; Follow-ups; criacao de qualquer pontuacao nova; automacoes, campanhas, credenciais e integracoes externas.
- **Validacao:** `npm test` backend 1410/1410, `npm run typecheck` backend OK, `npm test` frontend 229/229 (19 novos), `npm run typecheck` frontend OK, e as 4 rotas alteradas compilaram e responderam 200 no dev server.
- **Pendencia declarada:** revisao VISUAL em navegador (desktop + rolagem horizontal + leitor de tela) nao foi executada por mim â€” nao tenho ferramenta de browser nesta sessao. Precisa do operador em `localhost:3001`.

---

## 2026-08-10 - Inicio de tarefa IA

- **IA/Ferramenta:** Claude Code
- **Pedido resumido:** Separar PERMISSAO DE RESPONDER de CAPACIDADE DE ANALISAR, por conversa. Novo campo `modo_ia` em `vendas.conversas` (`conversa` | `analise`), controle no painel de conversa, bloqueio REAL no backend imediatamente antes do envio (nunca um return cedo que mate a analise), follow-up automatico desligado no modo `analise` e auditoria em `app.auditoria_eventos`.
- **E projeto/tarefa de alteracao?** Sim, e ESTRUTURAL: migration nova (aditiva) + alteracao no caminho de resposta automatica (core-funnel, contexto2-responder, followup-auto) + rota nova + componente novo no frontend. Exige confirmacao antes de implementar (CLAUDE.md item 4).
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md, docs/ui-visual-standard.md, docs/project-map.md, docs/architecture-rules.md: Sim.
- **Areas mapeadas na Fase 0 (leitura antes de editar):** `src/webhook-handler.js` (nao envia nada: enfileira job `webhook_resposta`), `src/agent.js` (`processarRespostaWebhookDebounced`, `processarJob`, wiring de `createCoreFunnel`/`createContexto2Responder`), `src/core-funnel.js:1070 gerarEEnviarRespostaWhatsapp` (gera E envia no mesmo bloco; 7 pontos de envio), `src/services/contexto2-responder.js:165` (envio do playbook), `src/services/contexto2-runtime.js` (`atualizarLeadInsights` â€” a ANALISE persistida, roda ANTES do envio), `src/followup-auto.js` (elegibilidade SQL + guarda do job), `src/followup-execution.js:381` (ramo `reengajamento`), `src/agenda.js:797` (lembrete de reuniao), `src/db-crud.js` (`buscarConversa` faz `SELECT *` â€” o modo chega de graca), `src/routes/api-conversas.js` (`GET /:numero` faz `SELECT c.*` â€” idem), `src/db/auditoria.js`, `sql/migrations/` (ultima: 062), `frontend/components/ConversaPainel.tsx`, `frontend/components/ui/Abas.tsx`.
- **Achado que decide o desenho:** o webhook NAO e o ponto de envio â€” ele so enfileira o job. Bloquear o modo no webhook mataria junto a analise (que roda dentro do turno de LLM). O bloqueio precisa viver nos DOIS enviadores (`core-funnel.js` e `contexto2-responder.js`), imediatamente antes do `enviarMensagem`, depois de `atualizarLeadInsights`/`atualizarPerfil` ja terem gravado a analise.
- **Segundo achado:** extracao (analise) e mensagem saem da MESMA chamada de LLM nos dois motores (`extrairEDecidirBundle` no playbook, `chamarClaudeTurno` no legado). Logo, o modo `analise` NAO reduz custo de IA â€” ele so nao entrega a mensagem. Separar os dois seria refatoracao grande, fora do escopo declarado.
- **Fora de escopo declarado:** novas automacoes comerciais; follow-up automatico no modo Analise; mudancas no motor de inteligencia alem da separacao analisar/responder; perfil 360 do contato; `agente_pausado` (comportamento atual preservado, nao derivado nem reusado).
- **Proxima etapa:** apresentar a analise de impacto + lista de arquivos e aguardar confirmacao de 4 decisoes de produto (destino da mensagem gerada e nao enviada; comportamento com o agente pausado; envios compostos pela IA e disparados por humano; abrangencia sobre lembrete de reuniao e "Rodar leads"). So entao implementar.

---

## 2026-08-10 - Inicio de tarefa IA (2a do dia)

- **IA/Ferramenta:** Claude Code
- **Pedido resumido:** Evoluir o modo de atuacao da IA (entregue hoje, commit f2ce4c1) de POR CONVERSA para POLITICA: modo PADRAO GLOBAL da Central de Mensagens + EXCECAO explicita por conversa (`herdar` | `conversa` | `analise`). A pausa por mensagem humana continua temporaria e nao pode criar, remover ou alterar preferencia.
- **E projeto/tarefa de alteracao?** Sim, ESTRUTURAL: migration nova que MUTA DADO EXISTENTE (a semantica da coluna `vendas.conversas.modo_ia` muda), leitura nova no caminho de resposta automatica, rota nova de configuracao da empresa e mudanca no contrato de leitura da conversa. Exige confirmacao antes de implementar.
- **Workflow padrao consultado?** AGENTS.md (incluindo o bloco novo do modo de IA), CLAUDE.md, docs/ai-workflow.md, docs/ai-decision-log.md, docs/ui-visual-standard.md: Sim.
- **Areas mapeadas na Fase 0:** `src/services/conversa-modo-ia.js` (dono do vocabulario, criado hoje), `sql/migrations/063_conversa_modo_ia.sql` (CHECK e DEFAULT a alterar), `src/db/empresas.js:55-77` (padrao ESTABELECIDO de configuracao global por empresa: `app.empresas.config` JSONB + cache de 30s + invalidacao), `src/routes/api-empresas.js:69-88` (`GET/PATCH /:empresaId/agente`, o molde da rota global), `src/core-funnel.js` (gate de entrega; ja recebe `empresaAgentePausada` por injecao), `src/services/contexto2-responder.js`, `src/routes/api-conversas.js` (`GET /:numero`), `src/services/conversa-manual.js`, `frontend/app/dashboard/conversas/page.tsx` (cabecalho da Central), `frontend/components/ConversaPainel.tsx`, `frontend/components/ui/AlternadorModoIa.tsx`, `frontend/lib/conversa-modo-ia.js`.
- **Achado que decide o desenho (1):** o global cabe em `app.empresas.config` JSONB, reusando integralmente o padrao de `config.agente_pausado` â€” **nenhuma migration para o global**, so para a coluna individual.
- **Achado que decide o desenho (2):** o modo EFETIVO deve ser calculado no BACKEND e devolvido pelo `GET /conversas/:numero` (que ja faz `SELECT c.*`). Assim a fonte de verdade e unica, a tela nao recalcula prioridade e o painel continua sem requisicao extra.
- **Risco declarado que precisa de decisao do operador:** a migration precisa converter as linhas existentes de `'conversa'` para `'herdar'`. Sem isso TODA a base nasce com excecao explicita e mudar o global nao afetaria conversa alguma â€” o 1o criterio de aceite nasceria falso. Linhas em `'analise'` sao preservadas como excecao.
- **Fora de escopo declarado:** logica propria de ativacao de follow-up; regras proprias de agenda e lembretes; automacoes novas a partir dos insights; perfil 360.
- **Proxima etapa:** apresentar a analise de impacto + lista de arquivos e aguardar confirmacao de 2 decisoes (mutacao das linhas existentes e comportamento em caso de falha de leitura do modo global). So entao implementar.

---

## 2026-08-10 - Inicio de tarefa IA (3a do dia)

- **IA/Ferramenta:** Claude Code
- **Pedido resumido:** Coluna "Lead" da Central de Mensagens deve exibir o nome mais util disponivel, com prioridade fixa (1 nome cadastrado do lead -> 2 nome do WhatsApp -> 3 nome do Google Maps -> 4 VAZIO). Telefone NUNCA ocupa o campo de nome; ele fica so na coluna propria. Resolucao centralizada num modulo reutilizavel, backend devolvendo o nome ja resolvido + a fonte, e testes por prioridade.
- **E projeto/tarefa de alteracao?** Sim, e ESTRUTURAL: a prioridade 2 exige migration nova (o pushName CRU do WhatsApp NAO e persistido hoje) + escrita no caminho do webhook; a prioridade 3 exige join novo entre `vendas.conversas` e `prospectador.prospects` numa listagem paginada sem indice de telefone. Exige confirmacao antes de implementar (CLAUDE.md item 4).
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md, docs/ui-visual-standard.md: Sim.
- **Areas mapeadas na Fase 0 (leitura antes de editar):** `src/services/lead-nome-exibicao.js` (modulo PURO ja escrito por sessao anterior e AINDA NAO LIGADO a nada â€” grep confirma zero importadores), `src/routes/api-conversas.js:92` (`GET /` da listagem) e `:142` (`GET /:numero`), `src/agent.js:5820 capturarNomeContato` (unico ponto que aproveita o pushName hoje), `src/nome-contato.js` (`nomeDePushName` -> `primeiroNome`), `src/webhook-handler.js:361` (repasse do `msg.pushName`), `sql/init.sql:685` (`prospectador.prospects`: `nome` NOT NULL + `telefone` TEXT), `frontend/lib/lead-identidade.js` (dono de `identidadeConversa`/`rotuloLead`), `frontend/app/dashboard/conversas/page.tsx:236-240` (coluna Lead + coluna Telefone), `frontend/lib/followups-fila.js` (reexporta a identidade).
- **Achado que decide o desenho (1):** o nome do WhatsApp **nao existe no banco**. `capturarNomeContato` roda `nomeDePushName`, que fica so com o PRIMEIRO TOKEN e recusa palavras de negocio (`pizzaria`, `loja`, `clinica`â€¦ em `NAO_NOME`) â€” "Pizzaria do Ze" e descartado inteiro e nada e gravado. O que sobra em `lead_profiles.apelido` ja e "nome cadastrado" (prioridade 1), nao a prioridade 2. Sem migration nao existe fonte 2.
- **Achado que decide o desenho (2):** nao ha indice em `prospectador.prospects.telefone` (nem funcional sobre os digitos). O casamento conversa<->prospect e por telefone normalizado (padrao ja usado em `prospecting.js:1925`), entao o join na listagem de 50 conversas por pagina varre a tabela de prospects por linha.
- **Achado que decide o desenho (3):** hoje `identidadeConversa` usa o TELEFONE como titulo quando nao ha nome â€” exatamente o que o pedido proibe no campo de nome. A mesma funcao serve o cabecalho do painel de conversa e a fila de Follow-ups, entao mudar a regra sem recortar o escopo muda 3 telas.
- **Fora de escopo declarado (do proprio pedido):** sobrescrever nome cadastrado do lead; criar/editar perfil de lead a partir de WhatsApp ou Maps; mexer em aquisicao, follow-up, agenda ou analise da IA.
- **WIP alheio no working tree (nao entra neste diff):** modo_ia `herdar` (migration 064 + `conversa-modo-ia.js` + `ConversaPainel.tsx` + testes), ainda nao commitado.
- **Proxima etapa:** apresentar a analise de impacto + lista de arquivos e aguardar confirmacao de 3 decisoes (persistir o pushName cru via migration; custo/forma do join com o Maps; abrangencia do "campo vazio" fora da coluna Lead). So entao implementar.

---

## 2026-08-10 - Inicio de tarefa IA (4a do dia)

- **IA/Ferramenta:** Claude Code
- **Pedido resumido:** Corrigir o defeito ATIVO de selecao de instancia de envio, preservar isolamento por empresa+instancia, fazer o backfill conservador das conversas comprovadamente atribuiveis e preparar o seletor operacional por instancia. Ordem declarada pelo pedido: Fase 2 (proteger envios) -> Fase 4 (backfill) -> Fase 3 (seletor) -> documentacao/validacao. Rotacao de credencial de producao FICA FORA desta entrega.
- **E projeto/tarefa de alteracao?** Sim, e ESTRUTURAL: toca caminho de ENVIO em producao (4 chamadores), a regra unica de resolucao de instancia (`src/whatsapp.js`), backfill de dados e, na fase seguinte, leitura filtrada + frontend. Exige confirmacao antes de implementar (CLAUDE.md item 4).
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md, docs/analise-contexto-instancia.md, docs/architecture-rules.md: Sim.
- **Base:** a analise de impacto completa ja existe (`docs/analise-contexto-instancia.md`, 2026-08-10, somente leitura) e o instrumento de medicao ja foi entregue (`npm run medir:escopo-instancia`). Esta tarefa IMPLEMENTA as Fases 2, 4 e 3 daquele plano.
- **Areas mapeadas na Fase 0 (leitura antes de editar):** `src/whatsapp.js:45-81` (`getInstanceNameForConversation` + `instanceNameParaEnvio` â€” a cadeia de fallback defeituosa), `src/services/conversa-manual.js:41-104` (o UNICO caminho que ja recusa envio sem instancia provada, com `409 INSTANCE_UNAVAILABLE` â€” molde a reusar; mas ele TAMBEM carrega o fallback "mais recentemente atualizada" em :61-69), `src/services/rodar-leads.js:158-167` (`carregarInstancia` com `WHERE id=$1 AND empresa_id=$2` + exclusao do canal freelandoo â€” molde de validacao), `src/followup-execution.js:386`, `src/agenda.js:803` e `:928`, `src/prospecting.js:2033` (os 4 envios sem `instanceName`), `src/handoff-alerts.js:342` (envio ao operador, risco menor), `src/db-crud.js:154` vs `historico-envio.js:71` vs `conversa-manual.js:144` (precedencia divergente de escrita de `evolution_instance`), `scripts/medir-escopo-instancia.js` + `test/medir-escopo-instancia.test.js` (guarda de somente-leitura).
- **Achado que decide o desenho (1):** o defeito nao esta nos 4 chamadores â€” esta na CADEIA de resolucao. Mesmo passando `instanceName`, `instanceNameParaEnvio` nao valida se aquele nome existe, esta ativo, pertence a empresa da conversa e e do canal WhatsApp/Evolution. Corrigir so os chamadores deixaria o passo 2b ("instancia ativa mais recentemente atualizada") e o passo 3 (`process.env.EVOLUTION_INSTANCE`, default literal `'PJ'`) vivos para todo o resto. A correcao tem de ser a REGRA UNICA, no molde da quarentena de webhook: sem origem provada, nao envia.
- **Achado que decide o desenho (2):** `conversa-manual.js` ja resolve isso corretamente para o operador, com SQL proprio. Centralizar significa aquele arquivo passar a CONSUMIR a regra unica, nao duplica-la â€” senao o repo fica com duas implementacoes do mesmo julgamento (a licao ja paga com a bolinha de pontuacao e o painel de conversa).
- **Achado que decide o desenho (3):** o backfill so e seguro onde a atribuicao e DERIVAVEL. `classificarAtribuibilidade` (script de medicao) ja e a regra: empresa com 1 instancia ativa = `atribuivel`; com 2+ = `nao_atribuivel`; conversa sem empresa = `quarentena_analitica`. Escolher "a mais recente" repetiria, em repouso e permanente, o defeito que a Fase 2 remove.
- **Restricoes declaradas pelo pedido:** nao rotacionar credenciais nesta entrega; nao expor credencial em log/teste/doc/commit; nao atribuir conversa por heuristica; nao usar fallback por instancia mais recente; nao enviar mensagem real durante a validacao; preservar isolamento por empresa e instancia.
- **Fora de escopo declarado:** rotacao/remocao da credencial de producao exposta (etapa posterior); mudanca no `UNIQUE (numero)` global de `vendas.conversas` (decisao D-1, congelada pela pendencia arquitetural); teto/janela/pausa por instancia (Fase 8); remocao do env `EVOLUTION_INSTANCE` (D-7, so depois da Fase 2 estabilizada).
- **Bloqueio na Fase 0:** o pedido chegou TRUNCADO â€” corta em `fase_2_proteger_envios.requisitos` ("Quando evolution_inst...") e as secoes de backfill (Fase 4), seletor (Fase 3) e documentacao nao chegaram. Analise feita; implementacao aguarda o texto completo.
- **Proxima etapa:** receber o restante do pedido, apresentar a analise de impacto + lista de arquivos e aguardar confirmacao. So entao implementar.

---

## 2026-08-11 - Inicio de tarefa IA (retomada limpa da Fase 2)

- **IA/Ferramenta:** Claude Code
- **Pedido resumido:** Implementar SOMENTE a **Fase 2** do plano de escopo por instancia
  (`docs/analise-contexto-instancia.md` Â§9): centralizar em `src/whatsapp.js` uma unica regra
  SEGURA de resolucao da instancia de envio, remover os fallbacks (instancia "mais recentemente
  atualizada", `EVOLUTION_INSTANCE`, literal `'PJ'`, nome explicito sem validacao), fazer
  `services/conversa-manual.js` consumir a regra unica, cobrir os chamadores (follow-up, agenda,
  prospeccao, handoff, comandos de operador, rotas legadas), corrigir diagnosticos dependentes do
  fallback global e aplicar **D-8** (preservar a instancia ja gravada na conversa).
- **E projeto/tarefa de alteracao?** Sim, e ESTRUTURAL: toca o caminho de ENVIO em producao.
  Retomada limpa de sessao anterior bloqueada (entrada de 2026-08-10, 4a do dia, que ficou parada
  por pedido truncado). Escopo agora e menor e fechado: **so a Fase 2**.
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md,
  docs/analise-contexto-instancia.md: Sim.
- **Fora de escopo declarado pelo pedido:** backfill (Fase 4), seletor visual (Fases 5-6),
  producao, credenciais, rotacao de senha, commit, push e envio real. Os arquivos de Fase 0
  (`scripts/medir-escopo-instancia.js`, `test/medir-escopo-instancia.test.js`,
  `docs/analise-contexto-instancia.md`) sao diagnostico pre-existente e nao entram no diff,
  exceto a nota de status da Fase 2.
- **Achado que decide o desenho (1):** o defeito nao esta nos chamadores, esta na CADEIA de
  resolucao (`whatsapp.js:72-81`). Mesmo quem passa `instanceName` nao tem o nome validado
  (existe? ativo? da mesma empresa? canal WhatsApp?). Corrigir so os chamadores deixaria o passo
  2b (ordenacao por `atualizado_em`) e o passo 3 (`process.env.EVOLUTION_INSTANCE || 'PJ'`) vivos.
- **Achado que decide o desenho (2):** `conversa-manual.js` ja recusa envio sem instancia
  (`409 INSTANCE_UNAVAILABLE`) â€” mas com SQL PROPRIO, que carrega o mesmo fallback por
  `atualizado_em` (:61-69). Centralizar significa aquele arquivo CONSUMIR a regra unica, nao
  duplicar o julgamento.
- **Achado que decide o desenho (3):** a instancia carrega o `empresa_id` dela. Entao o cruzamento
  seguro e "instancia nomeada pela conversa/chamador PERTENCE a empresa esperada", nao
  "empresa -> escolhe instancia". A segunda direcao e justamente a que inventa dono.
- **Proxima etapa:** implementar o modulo puro de vocabulario, a regra unica em `whatsapp.js`,
  os chamadores, os testes e a documentacao; rodar `npm test` e `npm run typecheck`.

---

## 2026-08-12 - Inicio de tarefa IA

- **IA/Ferramenta:** Claude Code (Opus 5)
- **Pedido resumido:** Disponibilidade de canal (hoje: WhatsApp) deve virar dado CENTRAL do
  contato, HUMANO-CURADO. No reagendamento de follow-up o operador marca "Sem WhatsApp"; o
  follow-up troca de canal automaticamente (e-mail confirmado quando existir; enquanto nao
  existir, ligacao). Deve ser possivel DESFAZER ("Tem WhatsApp"). O sistema NAO pode concluir
  sozinho que um contato nao tem WhatsApp a partir de falha tecnica de envio.
- **Caso observado em producao:** Elite Auto Renovadora reagendada para WhatsApp mesmo depois
  de o operador saber que o contato nao tem WhatsApp.
- **E projeto/tarefa de alteracao?** Sim, e ESTRUTURAL: exige migration nova (nao existe hoje
  nenhuma fonte de disponibilidade de canal por CONTATO) e toca a criacao/reagendamento de
  follow-up, que e caminho de producao. Migration ADITIVA, sem mutacao de dado existente.
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md,
  docs/architecture-rules.md, docs/PENDENCIA_ARQUITETURAL_CENTRAL_LIGACOES_E_MENSAGENS.md: Sim.
- **Areas mapeadas na Fase 0 (leitura antes de editar):**
  `src/services/follow-up-modelo.js` (modelo PURO; `validarReagendamento` hoje NAO aceita canal),
  `src/db/follow-ups.js` (`criarFollowUp` com `ON CONFLICT` sobre o indice parcial
  `follow_ups_um_aberto_por_canal_uk`; `reagendarFollowUp` sem transacao),
  `src/routes/api-follow-ups.js:/itens/:id/reagendar`,
  `sql/migrations/062_follow_ups.sql` (CHECK de canal fechada em whatsapp|ligacao),
  `src/db/ligacoes.js` (`encerrarLigacao` cria o follow-up DENTRO da transacao),
  `sql/migrations/021_prospects_tem_whatsapp.sql` + `src/services/rodar-leads.js:275-283`
  (a unica marcacao de "sem WhatsApp" que existe hoje — e AUTOMATICA),
  `frontend/lib/follow-up-acao.js` (dono do vocabulario de apresentacao),
  `frontend/app/dashboard/follow-ups/page.tsx:857 ModalReagendar`,
  `src/domain-enums.js` + `test/domain-enums.test.js` (anti-drift codigo x CHECK).
- **Achado que decide o desenho (1):** a unica marcacao de "sem WhatsApp" existente e
  `prospectador.prospects.tem_whatsapp`, e ela e escrita AUTOMATICAMENTE por
  `marcarDisparoFalhou(..., semWhatsapp=true)` quando o Evolution devolve `exists:false`.
  Reusa-la como fonte central colocaria inferencia tecnica e curadoria humana na MESMA coluna
  — exatamente o que o pedido proibe. Alem disso ela e por PROSPECT, e o follow-up nao tem
  prospect obrigatorio: a identidade do contato no modulo e `(empresa_id, telefone_digitos)`.
- **Achado que decide o desenho (2):** nao existe canal `email` em lugar nenhum do follow-up —
  `FOLLOWUP_CANAL` e a CHECK `follow_ups_canal_chk` sao fechados em `whatsapp|ligacao`. Logo a
  prioridade "e-mail confirmado" NAO pode ser implementada agora: fica declarada como fase
  separada e o fallback efetivo e `ligacao` (sempre ha telefone — ele E a identidade).
- **Achado que decide o desenho (3):** trocar o canal de um follow-up aberto pode colidir com
  o indice unico parcial `follow_ups_um_aberto_por_canal_uk` (ja existe uma ligacao aguardando
  para o mesmo contato). Marcacao + troca de canal precisam ser ATOMICAS, com 409 explicativo.
- **Fora de escopo declarado:** envio real por e-mail; canal `email` no follow-up; backfill de
  anotacoes livres; mexer em `prospects.tem_whatsapp` ou no fluxo do Banco de Leads; producao;
  rotacao de credenciais.
- **Proxima etapa:** implementar migration 066 (aditiva), modulo PURO de disponibilidade,
  camada de dados, ligacao no criar/reagendar/listar, UI do reagendamento e testes; rodar
  `npm test` (backend), `npm test` (frontend) e `npm run typecheck` nos dois.

---

## 2026-08-12 - Inicio de tarefa IA (canal de E-MAIL do follow-up)

- **IA/Ferramenta:** Claude Code
- **Pedido resumido:** implementar a FASE SEPARADA declarada na Decisao 4 de
  `docs/ai-decision-log.md` (2026-08-12): hoje "sem WhatsApp" sempre cai em ligacao porque
  `follow_ups_canal_chk` e fechada em `whatsapp|ligacao` e **nenhuma tela sabe executar** um
  follow-up de e-mail. Construir o executor, liberar `email` como canal real e ligar o salto
  ja desenhado em `EMAIL_FASE_SEPARADA` (`src/services/contato-canal-disponibilidade.js`).
  E-mail de cadastro/anotacao continua CANDIDATO, nunca confirmado automaticamente.
- **E projeto/tarefa de alteracao?** Sim, ESTRUTURAL: migration nova que ALTERA duas CHECKs
  existentes (062 e 066), coluna nova em `app.contato_canal_disponibilidade`, tabela nova de
  registro de envio, rotas novas e envio real por provider externo. Segue o mesmo desenho ja
  aprovado com o operador na entrega anterior (commit 41a25de).
- **Workflow padrao consultado?** AGENTS.md, CLAUDE.md, docs/ai-workflow.md,
  docs/ai-decision-log.md (Decisoes 1..9 de 2026-08-12), docs/ui-visual-standard.md: Sim.
- **Areas mapeadas na Fase 0 (leitura antes de editar):**
  `src/services/contato-canal-disponibilidade.js` (modulo PURO, dono do vocabulario e do
  gancho `EMAIL_FASE_SEPARADA`), `src/services/follow-up-modelo.js` (`FOLLOWUP_CANAL`,
  `ACAO_PADRAO`, `TELA_EXECUTORA`), `src/db/follow-ups.js` (criar/reagendar/listar/historico),
  `src/db/contato-canal-disponibilidade.js` (unica escrita, exige `usuarioId`),
  `src/routes/api-follow-ups.js`, `src/domain-enums.js` (anti-drift),
  `sql/migrations/062_follow_ups.sql` e `066_contato_canal_disponibilidade.sql` (as duas
  CHECKs a alargar), `src/services/email-outreach.js` (**unico transporte de e-mail que
  existe no repo**, gated por `EMAIL_PROVIDER_API_URL`/`_KEY`/`EMAIL_FROM`),
  `sql/migrations/012_captacao_social.sql` (`prospectador.email_outreach`, ledger do outreach
  de prospeccao), `frontend/lib/follow-up-acao.js` + `followups-fila.js` +
  `app/dashboard/follow-ups/page.tsx`, testes `test/contato-canal-disponibilidade.test.js`,
  `test/follow-up-modelo.test.js`, `test/domain-enums.test.js`,
  `frontend/lib/follow-up-acao.test.js`.
- **Achado que decide o desenho (1):** o transporte de e-mail JA EXISTE
  (`enviarViaProvider`, em `email-outreach.js`) e e gated por env. Nao se cria cliente HTTP
  novo: ele passa a ser exportado e reusado. O ledger `prospectador.email_outreach`, porem,
  e do outreach de PROSPECCAO (chaveado por `prospect_id`, com indice unico por
  `(prospect_id, lower(email))`) — o follow-up nao tem prospect obrigatorio, entao o registro
  de execucao vira tabela propria em `app`, ao lado de `app.follow_ups`.
- **Achado que decide o desenho (2):** "e-mail confirmado" e o MESMO tipo de fato que "sem
  WhatsApp" — veredito humano sobre um canal de um contato. Ele cabe na tabela que ja existe
  (`app.contato_canal_disponibilidade`, identidade `empresa_id + telefone_digitos`), que so
  precisa de uma coluna para o ENDERECO e de `email` na CHECK de canal. Criar tabela separada
  duplicaria a curadoria em dois lugares.
- **Achado que decide o desenho (3):** sem endereco nao ha canal. Por isso a CHECK nova exige
  `endereco IS NOT NULL` quando `canal='email' AND disponivel=true` — e o que impede um item
  de entrar na fila num canal sem para onde enviar (o risco exato que a Decisao 4 apontou).
- **Fora de escopo declarado:** curadoria de WhatsApp (migration 066) permanece intacta;
  nenhum e-mail real e enviado na validacao; nenhum acesso a producao ou banco real; nenhum
  commit/push (diff fica pronto para revisao).
- **Proxima etapa:** implementar backend (migration 067 -> modulo puro -> dados -> executor ->
  rotas), depois frontend (lib pura -> tela), depois testes/typecheck/build.
