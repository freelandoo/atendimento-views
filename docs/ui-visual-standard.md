# Padrão visual e UX do projeto

> **Fonte canônica do padrão visual:** [GUIA-VISUAL-PJ-CODEWORKS.md](GUIA-VISUAL-PJ-CODEWORKS.md).
> Este arquivo é o ponto de entrada de UX do [workflow padrão](ai-workflow.md) (Fase 5):
> ele **não duplica** os tokens/regras do guia — aponta para eles e adiciona o checklist de
> verificação e o log de divergências aprovadas.

## Objetivo

Registrar o padrão visual aprovado e evitar que cada tela pareça de um projeto diferente.
O objetivo não é travar o desenvolvimento, e sim manter consistência.

## Onde está o padrão

- **Tokens de marca, princípios, componentes e estrutura de página:** [GUIA-VISUAL-PJ-CODEWORKS.md](GUIA-VISUAL-PJ-CODEWORKS.md).
- **Dashboard estático (backend):** CSS em `backend/public/dashboard/css/dashboard.css` —
  use as variáveis existentes antes de criar novas cores. Logo em
  `/dashboard/assets/pj-codeworks-logo.png`.
- **Front-end SaaS (Next.js):** `frontend/` (App Router) — reaproveite componentes existentes
  em `frontend/components/` antes de criar novos.

## Perguntas obrigatórias antes de mexer em interface

Responda no chat (Fase 5) sempre que a tarefa envolver tela, modal, componente, formulário,
tabela, dashboard, card, sidebar, menu ou fluxo visual:

- Existe página/componente parecido que deve ser usado como referência?
- A tela usa os mesmos padrões de espaçamento, borda, sombra, tipografia, cores e hierarquia?
- Os botões seguem o padrão de ação primária, secundária, perigosa e neutra?
- Os inputs são realmente necessários, ou algum campo pode ser calculado/automatizado no back-end?
- A tela fica clara em desktop, tablet e mobile?
- A nova interface cria comportamento diferente sem motivo?
- O usuário entende o próximo passo sem explicação externa?
- O visual afeta dashboard, relatório, financeiro ou fluxo crítico?
- Existe risco de a nova tela parecer de outro sistema?
- Existe risco de duplicar ação, informação ou regra visual?

## Quando parar e perguntar ao usuário

- Quando a página nova fugir do padrão visual existente.
- Quando a IA quiser criar um novo padrão visual para uma área.
- Quando houver decisão entre simplificar a interface ou manter campos manuais.
- Quando uma tela tiver muitas ações/botões/inputs que poderiam ser automatizados.
- Quando a mudança puder impactar conversão, entendimento ou fluxo de trabalho.

Mensagem obrigatória (ver [ai-workflow.md](ai-workflow.md) → Regra nova 1).

## Divergências aprovadas

Registre aqui toda divergência visual autorizada pelo usuário.

<!-- Modelo:

### [DATA] — [Área/tela]
- Divergência aprovada:
- Motivo:
- Impacto:
- Como validar:

-->

### 2026-09-18 — Primitivos de tela (`Botao`, `Card`, `Campo`, `EstadoVazio`, `Carregando`, `CabecalhoPagina`)

- **Padrão aprovado:** tela nova **não escreve botão, card ou input à mão**. Os primitivos vivem
  em `frontend/components/ui/` e as classes deles em `frontend/lib/ui-primitivos.js` (puro e
  testado, 12 testes) — mesmo contrato de `lib/pontuacao-indicador.js`: o módulo decide as
  classes, o componente só desenha.
- **Motivo (medido em 2026-09-18):** **155 botões** escritos à mão nas telas, **nenhum igual ao
  outro**; **metade sem qualquer tratamento de `disabled`**; e quase nenhum com anel de foco.
  O guia exigia quatro variantes de botão desde sempre e não havia componente que as
  implementasse.
- **A geometria não foi inventada, foi medida:** `rounded-lg` (111 dos botões com raio),
  dois tamanhos reais (`px-3 py-1.5` / `px-4 py-2`), `font-medium`, card `p-5`. Por isso
  adotar um primitivo numa tela **tende a não mudar aparência**.
- **O que os primitivos passam a garantir de graça, e que hoje falta:** foco visível em todos
  os estados, `disabled` com opacidade e cursor, `type="button"` por padrão (o padrão do HTML
  dentro de `<form>` é `submit` — envio acidental é defeito clássico), `carregando` que
  **desabilita** (o segundo clique durante um envio é a origem do disparo em duplicidade) e o
  estado entrando no **nome acessível**, não só na cor.
- **Ressalva declarada — a única adoção que MUDA aparência:** existem hoje 4 botões destrutivos
  escritos como *texto vermelho* e 1 como *sólido*. O primitivo `perigosa` é **sólido**, que é
  o padrão para ação destrutiva. Migrar aqueles 4 muda o visual deles — é mudança legítima, mas
  acontece na etapa da tela correspondente, **com verificação visual**, nunca num passe global.
- **`Campo` clona o filho de propósito:** `label`/`id`, `aria-describedby` e `aria-invalid`
  precisam casar, e casar isso à mão em cada tela é justamente o que ninguém faz — o resultado
  são rótulos que não clicam e erros que o leitor de tela nunca anuncia. Ele **não valida nada**:
  validar aqui criaria uma segunda régua, mais frouxa que a do backend.
- **`EstadoVazio` obriga quem chama a distinguir vazio por FILTRO de vazio por AUSÊNCIA.** As
  saídas são opostas: uma manda limpar o filtro, a outra manda procurar defeito.
- **Nenhuma tela foi alterada nesta etapa.** A adoção é a Etapa 3 em diante, tela a tela.
- **Como validar:** `cd frontend && npx tsc --noEmit`, `node --test lib/*.test.js`, `npm run build`.

### 2026-09-18 — Fronteira dos dois temas + tokens semânticos do tema claro (fundação)

- **Divergência aprovada:** o produto passa a declarar **dois temas com fronteira fixa** —
  **claro** em toda a área de trabalho e **neon** apenas em `login`, `signup` e na `Sidebar`.
  Não é mudança de rumo: é o reconhecimento do que já estava no código. `dashboard/contas`
  fica **pendente** de conversão para claro (é tela de trabalho e está escura).
- **Motivo:** medição de 2026-09-18 mostrou que não havia empate entre dois padrões —
  `app/dashboard/layout.tsx:14` já forçava `[color-scheme:light]` no `<main>`, **22 das 25
  telas** do dashboard já eram claras, e o token `brand` aparecia **295** vezes contra **15**
  literais `blue-600`. Quem divergia era o próprio guia visual, que declarava `#0f66f5` e fundo
  `#f5f7fb` — valores que não existiam no produto.
- **Impacto:** **nenhuma tela mudou de aparência.** Foram criados tokens SEMÂNTICOS em
  `frontend/tailwind.config.ts` (`surface`/`surface-2`/`surface-3`, `line`/`line-strong`,
  `ink`/`ink-2`/`ink-3`, `estado-{ok,warn,danger,info}` e `shadow-card`) com **exatamente os
  valores dos literais `slate-*` que as telas já usavam**, medidos um a um. Adotar o token não
  muda pixel; ele apenas passa a nomear o que existe, para a próxima tela não divergir.
  O guia visual foi reescrito a partir da medição, e o padrão passou a ser entregue a
  **Codex, Claude e Cursor** por uma fonte única (`AGENTS.md` → guia), sem duplicar conteúdo.
- **Código morto removido:** `NeonCard`, `NeonButton`, `KpiCounter` e `StatusPill` — todos com
  zero consumidores e todos escritos em neon puro (`glass`, `text-mid`, `neon-*`), portanto
  inúteis para a área clara. Isso **fecha a decisão D1** que o `AGENTS.md` deixara em aberto: o
  badge de status unificado nascerá claro, na Etapa 2, e não do aproveitamento do `StatusPill`.
- **NÃO foi feito, de propósito:** a normalização dos **222** `rounded-xl`/`2xl` e a migração
  dos literais `slate-*` para token. As duas mudam aparência, e mudança de aparência sem
  verificação visual tela a tela é exatamente o que a Fase 5 proíbe. Elas acontecem junto com a
  repaginação de cada tela. **Não faça passe global.**
- **Divergência menor registrada:** o `<main>` usa `bg-gray-50` (`#f9fafb`) enquanto as telas
  usam `bg-slate-50` (`#f8fafc`). Um tom de diferença, imperceptível, deixado como está — trocar
  agora seria mudança visual sem ganho.
- **Como validar:** `cd frontend && npx tsc --noEmit` e `node --test lib/*.test.js`; abrir
  qualquer tela do dashboard e confirmar que nada mudou; conferir que
  `grep -r "NeonCard\|NeonButton\|KpiCounter\|StatusPill" frontend/app frontend/components`
  não retorna nada.


### 2026-08-10 — Controle de ativação padronizado (Central de Mensagens + Follow-up Automático)

- **Padrão aprovado:** todo controle de ativação da área superior de uma tela tem a mesma
  anatomia — **`NOME do que se controla` → `ícone "i"` → `controle`**, dentro de uma pílula
  `rounded-lg border border-slate-200 bg-white px-3 py-1.5 shadow-sm`. **Não se escreve o estado
  ao lado** ("Ativo", "Desativo", "Acompanhando sem responder") e **não há parágrafo fixo
  embaixo**: o estado vive no próprio controle e no `aria-label`; a consequência de ligar/desligar
  vive no balão do ícone.
- **Motivo:** os dois controles eram visualmente diferentes e ambos repetiam por extenso o que já
  mostravam. A Central gastava três linhas fixas no topo (estado + 2 parágrafos) e o Follow-up era
  um botão colorido com o estado escrito dentro. Texto que só repete o controle rouba altura da
  área mais disputada da tela.
- **Componentes (reuso obrigatório, não recriar):**
  - `frontend/components/ui/BalaoAjuda.tsx` — **dono único** do ícone "i" e do balão (portal no
    `<body>`, abre abaixo da âncora e preso às bordas, hover + foco + toque, fecha em
    Escape/scroll/resize). `AlternadorModoIa` apenas **reexporta**.
  - `frontend/components/ui/InterruptorAtivacao.tsx` — o liga/desliga padrão (`role="switch"` +
    `aria-checked`, trilho `h-6 w-11`, knob branco `h-4 w-4` com `translate-x-1`/`translate-x-6`,
    `bg-emerald-600` ligado / `bg-slate-300` desligado).
  - `frontend/components/ui/AlternadorModoIa.tsx` — quando o controle tem **modos nomeados** em
    vez de liga/desliga (é o caso do "Modo padrão da IA"). O ícone "i" vem antes do grupo, como
    no interruptor.
- **Divergência deliberada:** a Central **não** virou interruptor. Conversa e Análise são dois
  modos nomeados, e chamar "Análise" de *desligado* mentiria — nesse modo a IA continua
  analisando, e follow-up e agenda continuam rodando. Decisão do operador (2026-08-10), registrada
  em [ai-decision-log.md](ai-decision-log.md). **Padronizada é a anatomia, não a forma do
  controle.**
- **Acessibilidade obrigatória:** estado nunca só por cor (opção marcada ou posição do knob),
  `aria-label` que diz a ação **e** o estado, balão alcançável por mouse, teclado e toque,
  bloqueio (`disabled`) preservado enquanto o valor real não chegou.
- **O que NÃO sai:** alertas, erros e bloqueios com impacto operacional. O banner do Follow-up
  pausado continua; "Atualizando…" continua enquanto o PATCH viaja.
- **Como validar:** desktop e mobile (a pílula quebra linha no `flex-wrap` do cabeçalho, sem
  aumentar a altura); balão por hover, por Tab e por toque; leitor de tela anunciando estado ao
  alternar; Follow-up com `config` ainda carregando (controle desabilitado).
- **Fora desta padronização (ainda):** os switches inline de `InstanciasWhatsApp.tsx` e
  `InstanciasFreelandoo.tsx` — mesma geometria, mas paleta do painel escuro e sem ícone "i".
  Migram quando alguém mexer naquelas telas.

### 2026-08-11 — Menu radial de ações secundárias (`⋯`), primeira entrega só em Follow-ups

- **Padrão aprovado:** quando a coluna Ações de uma listagem tem 3+ ações e já quebra linha
  (`flex-wrap`), a ação PRIMÁRIA continua um botão comum e as secundárias vão para um gatilho
  "⋯" (`frontend/components/ui/MenuRadialAcoes.tsx`) que abre um popover com 3 zonas espaciais —
  **cima** (mais frequente/reversível), **direita** (positiva), **esquerda** (negativa) — e o
  que sobra numa lista logo abaixo. Zero ações secundárias: nada some no lugar do gatilho.
  Exatamente uma: vira um botão comum, sem o gatilho (menu para 1 opção é fricção pura).
- **Motivo:** relatório "Padronização visual das listagens" mediu Follow-ups com até 5 botões
  simultâneos na coluna Ações — a mais densa das 6 telas de listagem do produto.
- **Acionamento:** clique/toque no "⋯", nunca hover nem clicar-e-segurar — mesmo caminho em
  desktop e mobile. Fecha em Escape, clique fora e scroll/resize; portal no `<body>`.
- **Divergência aceita do desenho original do relatório:** o relatório descrevia um gesto de
  arrastar (toque simples = lista completa, toque longo = leque). Como o gatilho aqui já é
  sempre um clique explícito, as duas coisas viraram uma só: o popover É a lista completa, com
  as ações mais usadas destacadas espacialmente dentro dela. Decisão registrada em
  [ai-decision-log.md](ai-decision-log.md) (2026-08-11).
- **Escopo desta entrega:** só a Central de Follow-ups. Captação (3-4 ações) e Aquisição (2
  ações, zona cinzenta) ficam para uma fase seguinte — não avaliadas aqui para não ampliar o
  diff.
- **Como validar:** abrir Follow-ups com um item de follow-up em aberto (3 ações secundárias:
  Concluir/Reagendar/Cancelar) e testar teclado (Tab até o "⋯", Enter abre, Escape fecha),
  clique fora, e a mesma linha num item com follow-up automático agendado (ação extra "Cancelar
  automático" sem zona, só na lista).

### 2026-08-07 — Navegação do painel (Sidebar + drawer mobile)

- **Divergência aprovada:** a navegação lateral deixou de ser uma lista PLANA de 16 itens e
  passou a ter **grupos expansíveis** (Operação e Configurações). Além disso, ganhou uma
  **navegação mobile** que antes não existia: barra superior com botão de menu + drawer lateral
  com overlay (`< md`), enquanto a coluna retrátil de sempre continua valendo em `≥ md`.
- **Motivo:** o menu principal crescia a cada funcionalidade nova. Agrupar por contexto de uso
  mantém o topo curto (7 linhas fechadas contra 16 itens soltos) e abre espaço para
  Configurações › Integrações crescer sem virar item solto. O mobile era um vazio real — a
  coluna de 76px é a única navegação existente até hoje em telas pequenas.
- **Impacto:** dois padrões visuais novos, ambos reusando os tokens já existentes (`bg-panel`,
  `--border-soft`, `neon-cyan`, `shadow-glow-cyan`) — nenhuma cor, sombra ou tipografia nova
  foi criada.
  1. **Cabeçalho de grupo:** mesma altura (`h-11`), mesmo raio e mesmos estados de hover dos
     itens; difere por um chevron à direita e, quando contém a página atual, uma borda ciano
     discreta (`neon-cyan/25`) em vez do destaque cheio — o destaque cheio continua exclusivo
     do ITEM ativo, para não haver dois "ativos" na tela.
  2. **Filhos:** recuados com uma guia vertical de 1px (`white/10`), ícone menor (`h-4`) e
     altura `h-10`, deixando a hierarquia legível sem inventar cor de fundo.
  3. **Drawer mobile:** `bg-panel` sólido, overlay `black/60` com blur, largura
     `min(18rem, 85vw)`, `role="dialog"` + `aria-modal`, foco preso, Escape fecha, trava a
     rolagem do body e fecha ao navegar.
- **Como validar:** com a coluna expandida e retraída; em `user`, `admin` e `superadmin`
  (grupo sem filho visível some inteiro); entrando direto numa URL de dentro de um grupo (o
  grupo abre sozinho e destaca a seção); com a instância de WhatsApp desconectada e o grupo
  Configurações FECHADO (o alerta vermelho tem de aparecer no cabeçalho do grupo e no botão
  de menu do mobile); e no drawer via teclado (Tab não escapa, Escape fecha).
- **Regra que ficou protegida:** a árvore e as regras de visibilidade vivem em
  `frontend/lib/navegacao.js` (puro, testado). O desktop e o mobile desenham a MESMA árvore —
  não existe segunda lista de itens que possa divergir.

### 2026-09-19 — Banco de Leads: repaginação (celular + computador)

- **Decisão do operador:** repaginação **completa** da tela, **mantendo o modal centrado** no
  computador (o painel lateral foi proposto e **recusado**). Desenho aprovado antes do código,
  em artboards de celular e desktop.
- **Motivo (medido em 2026-09-19, não estimado):** `app/dashboard/banco-leads/page.tsx` tinha
  **7 `sm:`, 5 `md:` e 5 `lg:` em 2.881 linhas** — sete decisões responsivas na tela mais usada
  do produto. **Zero** uso dos primitivos, **131** literais `slate-*`, **10** `rounded-xl/2xl`
  e **33** usos de `text-[10px]`/`text-[11px]`. O shell (`Sidebar` + drawer, `layout.tsx`) **já
  era responsivo**: quem não acompanhou foi o conteúdo.
- **O que mudou, e o que NÃO mudou:**
  - **Celular (`< md`): a fila vira CARTÃO.** A tabela tem até 15 colunas com `min-w-max` e
    nenhuma congelada — no telefone vira rolagem lateral sem fim e o nome do lead sai da tela.
    O cartão mostra o que decide a próxima ação (faixa, nome, mercado, as duas pontuações,
    telefone) e o resto continua em "Detalhes", a mesma porta do computador.
  - **A ação principal deixou de ser um GESTO.** Era clicar no telefone dentro da célula, e a
    própria tela precisava ensiná-lo por escrito. Virou botão com nome, decidido por
    `lib/banco-leads-acao.js` (PURO, 10 testes), que **recebe** os vereditos (`isRodavel`,
    `isLocked`) em vez de recalculá-los — guarda de regressão falha se um campo cru do lead
    aparecer no módulo.
  - **Computador: a tabela continua sendo a tabela**, com a **coluna de identidade congelada**
    (`sticky left-0`). "Entrou em" saiu da frente do nome: a coluna fixa tem de ser a que diz
    de quem é a linha. O fundo da célula fixa é a versão **opaca** da tinta do ICP
    (`fundoCelulaFixa`) — a tinta da linha é semitransparente e deixaria o conteúdo passar por
    baixo ao rolar.
  - **Os três modais passaram a ser folha inferior no celular e modal centrado a partir de
    `sm`**, pela MESMA geometria: `classesFundoFolha`/`classesFolha` em `lib/ui-primitivos.js`
    (+ 5 testes). Altura em **`dvh`, nunca `vh`** — com `vh` a barra do navegador do celular
    corta o rodapé, que é onde mora a ação principal. `ConversaHistoricoModal` era `max-w-lg`
    (estreito demais para uma conversa) e passou a `sm:max-w-2xl`; `LeadDetalhesModal` trocou
    `max-h-[calc(92vh-108px)]` (altura de cabeçalho chutada) por `flex-1 min-h-0`.
  - **`components/ui/FolhaModal.tsx` (novo):** shell acessível — `role="dialog"`, Escape, trava
    de rolagem, **foco preso e devolvido a quem abriu**, fecha no `mousedown` do fundo (com
    `click`, arrastar seleção de dentro para fora fechava e perdia o texto). Usado hoje pela
    folha de filtros; os três modais reusam só as CLASSES porque têm submodais internos.
  - **Filtros:** no celular, busca visível + o resto atrás de "Filtros" (folha, com a ação
    presa no rodapé). **No computador a barra continua inteira, como sempre foi** — não se
    criou um segundo painel de filtros ao lado do "⚙ Personalizar".
  - **Tokens e raio:** só as substituições de **valor idêntico** medidas no guia
    (`slate-50`→`surface-2`, `slate-100`→`surface-3`, `slate-200`→`line`, `slate-300`→
    `line-strong`, `slate-500`→`ink-3`, `slate-600`→`ink-2`, `slate-900`→`ink`,
    `white`→`surface`) — **não muda pixel**. `rounded-xl/2xl` → `rounded-lg` **muda** aparência
    e é parte declarada da repaginação. **Nenhuma outra tela foi tocada.**
- **Resíduo declarado:** sobraram **24** literais sem token de valor equivalente
  (`text-slate-400`, `-700`, `-800`). Convertê-los mudaria a cor, então ficam para quando o
  guia tiver o token correspondente.
- **Nenhuma regra de negócio migrou para o front.** Faixa, ICP, cadastro, elegibilidade,
  responsável e situação do site continuam vindo dos mesmos módulos de sempre.
- **Como validar:** `cd frontend && npx tsc --noEmit` (limpo), `node --test lib/*.test.js`
  (631 testes) e `npm run build` (passou). Nenhum arquivo de backend foi alterado.


## 2026-09-19 — Area de Equipe unificada (nova tela, padrao seguido)

- **Fase 5 do workflow: nao houve divergencia a aprovar.** A tela nasceu dentro do guia —
  primitivos (`CabecalhoPagina`, `Botao`, `Card`, `Campo`, `EstadoVazio`, `Carregando`, `Abas`,
  `ModalConfirmar`, `FolhaModal`), tokens semanticos (`surface`/`line`/`ink`/`brand`/`estado-*`,
  **nenhum literal `slate-*`**), raio `lg`, sombra `shadow-card` e um `<h1>` por pagina.
- **As referencias visuais foram ADAPTADAS, nao copiadas.** O layout (mestre-detalhe na aba
  Equipes, modal amplo de membros, cartoes compactos no topo) veio delas; cor, tipografia,
  geometria e componentes vieram do produto. Nenhuma identidade paralela foi criada e a Sidebar
  nao foi tocada.
- **Cor nunca e o unico sinal, e isso decidiu tres detalhes:** o selo de estado da equipe carrega
  o rotulo em texto ao lado da bolinha; a celula de uma metrica so ganha cor quando o valor e'
  maior que zero (`tomDaColuna`); e **vencido (vermelho) e parado (ambar) usam tons diferentes de
  proposito** — sao problemas diferentes, e o `title` de cada cabecalho diz o que a coluna mede.
- **Controle que a pessoa nao pode usar fica VISIVEL e desabilitado COM o motivo** (a regra do
  guia): "Encerrar" quando a equipe tem gente, a caixa de quem ja e' membro no modal, e o campo
  Nicho no modo edicao. Em nenhum dos tres o controle some — sumir mandaria o gestor procurar
  onde se faz aquilo.
- **Vazio por FILTRO e vazio por AUSENCIA tem saidas diferentes** em todas as listagens
  (`EstadoVazio` + `resumoDoRecorte`), como o componente exige de quem o chama.
- **Responsivo:** a coluna dupla da aba Equipes vira uma coluna abaixo de `lg`; a tabela rola na
  horizontal com largura minima; os dois modais sao folha inferior no celular e modal centrado a
  partir de `sm` (geometria do `FolhaModal`, ja padronizada em 2026-09-19).
- **Pendente de verificacao visual com o operador:** a aparencia da area mudou de proposito
  (duas paginas viraram uma, com abas e mestre-detalhe). Typecheck, testes e compilacao passaram,
  mas **ninguem olhou a tela rodando ainda**.

### 2026-09-22 — Banco de Leads: lista unificada, funil compacto e barra contextual de seleção

- **Divergência aprovada pelo operador (2026-09-22, opção 2 da Fase 5):** variação visual
  controlada na ÁREA DE TRABALHO, documentada tela a tela. Reusa tokens e primitivos do guia
  canônico; nenhum passe global de estilo. **O menu lateral (`components/Sidebar.tsx`) não foi
  tocado** — restrição principal do pedido, verificada por `git status`.
- **Três padrões novos, todos nesta tela primeiro:**
  1. **Coluna "Origem" com pílula neutra.** Texto + `title`, nunca só cor, e as quatro fontes
     usam o MESMO tom: origem não é qualidade nem estado. Pintar cada fonte de uma cor faria a
     linha sugerir que uma delas é melhor — e essa linha já tem três pontuações disputando
     significado (ICP, cadastro, prioridade). A pílula é um BOTÃO que abre os detalhes do lead.
  2. **Faixa de envio (36px) + painel de configuração recolhido.** O que é decisão do dia fica
     na faixa; o que é ajuste fica atrás de "Configurar envio". **Nada que bloqueie o envio foi
     recolhido:** motivo do bloqueio e aviso de saudação faltando continuam fora do painel, em
     texto, sem depender de hover.
  3. **Barra contextual de seleção.** Aparece só quando há seleção, a partir do checkbox do
     cabeçalho da tabela (padrão de data table). Substitui o bloco permanente "Seleção em massa".
- **Estágios do funil: cartão alto → aba compacta.** Os cinco cartões de ~110px somavam com o
  cabeçalho e a barra de envio e empurravam o primeiro lead para fora da primeira dobra em
  1366×768. A contagem continua no próprio botão; a participação do estágio foi para o `title`,
  porque é leitura, não decisão.
- **`rounded-xl`/`2xl`:** nenhum foi introduzido; os blocos novos usam `rounded-lg` + `shadow-card`
  e tokens (`surface`, `line`, `ink*`, `brand`, `estado-*`).
- **Como validar:** `cd frontend && npx tsc --noEmit`, `node --test lib/*.test.js`, `npx next build`.
- ⚠️ **Verificação visual ao vivo NÃO foi feita nesta rodada** — a sessão não tem ferramenta de
  navegador, e subir o backend local apontaria para o banco de PRODUÇÃO e ligaria os workers
  (coleta paga, disparo automático), o que os limites operacionais do pedido proíbem.

### 2026-09-22 — Banco de Leads: origem em Colunas e ICP compacto

- **Ajuste aprovado pelo operador:** o filtro de **Origem** deixa de ser acionável na célula da
  tabela e passa a viver dentro do modal **Colunas e filtros**. A pílula da linha continua neutra
  e informativa; clicar nela abre as evidências da fonte na ficha lateral, sem recortar a lista.
- **A moldura da lista concentra o trabalho de varredura no desktop:** filtros de carteira
  (carteira, busca, nicho/categoria e cidade), ordenação, Colunas e a tabela ficam no mesmo bloco.
  Os atalhos rápidos (`Com WhatsApp`, `Sem site próprio`, `Com rede social`, `Sem rede social`,
  `Falha no envio`) descem para o rodapé desse bloco.
- **A coluna `ICP + cadastro` vira `ICP`:** a tabela mostra apenas a bolinha de ICP e o comando
  `Detalhes`; cadastro/coleta, score, evidências e dados completos ficam no drawer lateral. Isso
  preserva a distinção entre ICP comercial e completude de cadastro.
- **Telefone é atalho compacto para WhatsApp:** quando há número, ele aparece verde e sublinhado
  na própria coluna. Sem ícone e sem segunda linha de instrução; o `title`/rótulo acessível
  explica a ação e o link externo não envia nada sozinho.
- **Controles da lista ficam em uma faixa só:** carteira, busca, nicho/categoria, cidade,
  `Ordenar por` e `Colunas` vivem na mesma linha desktop. O total da visualização sai do topo e
  aparece no canto inferior direito do rodapé da tabela.
- **Vazio continua operável:** a moldura da lista aparece mesmo quando o recorte não retorna
  leads, para que o operador ainda consiga trocar filtros e abrir Colunas sem procurar controles
  fora do bloco.
- **Como validar:** `cd frontend && npx tsc --noEmit`, `node --test lib/*.test.js` e verificação
  visual desktop/mobile da tela.

### 2026-09-22 — Ficha do lead: UMA superfície lateral, quatro seções (Etapa 2)

- **Divergência aprovada (mesma decisão de 2026-09-22, opção 2):** a ficha do lead deixa de ser
  dois modais centrados e passa a ser **um painel lateral** no computador, com abas
  Resumo · Conversa · Qualificação · Fontes. No celular continua folha inferior — ali não existe
  "ao lado".
- **A geometria vem do PRIMITIVO, não de classe escrita à mão:** `classesFolha`/
  `classesFundoFolha` (`lib/ui-primitivos.js`) ganharam a opção `lateral`. Escrever o painel à
  mão criaria a segunda régua que aquele módulo existe para impedir.
  - `tamanho` é **ignorado** no modo lateral, de propósito: variar de 448px a 1024px conforme a
    tela faria a ficha cobrir justamente a lista que ela existe para preservar. Largura fixa de
    560px (`max-w-[92vw]`).
  - **Sem raio** no lateral: ele encosta em três bordas da janela, e arredondar ali deixa cantos
    de fundo escuro que parecem defeito.
- **Um cabeçalho só.** Cada modal tinha o seu resumo do lead no topo — era ele que aparecia
  duplicado. Agora: nome + pílula de origem + a **ação principal**, que fica no cabeçalho e não
  no fim do corpo (mesma regra que o `FolhaModal` já documenta).
- **Aba indisponível fica VISÍVEL, desabilitada e com o motivo em texto** (hoje só a Conversa,
  num lead sem telefone). Escondê-la faria a ficha ter três abas num lead e quatro em outro.
- **`role="tablist"` de verdade:** setas do teclado, `aria-selected`, foco devolvido ao gatilho e
  Escape. A aba ativa carrega peso de fonte além da cor.
- **Escape respeita diálogo aninhado.** `PainelAcaoConversa` (agendar reunião, registrar ligação,
  descartar) e `JsonLeadModal` ganharam `role="dialog"` + `aria-modal` + `aria-label` — eles não
  tinham. Sem isso, um Escape fecharia o formulário e a ficha juntos, perdendo o que estava
  sendo preenchido.
- **Mudança de comportamento declarada:** clicar no **nome** do lead passa a abrir o **Resumo**,
  não a conversa. A conversa continua a um clique (é a 2ª aba) e o **botão de ação da linha**
  (Enviar / Responder / Revisar) e a fila do Semiautomático abrem **direto nela**.
- **Como validar:** `cd frontend && npx tsc --noEmit`, `node --test lib/*.test.js`, `npx next build`.
- ⚠️ **Verificação visual ao vivo ainda NÃO foi feita** (mesma limitação da Etapa 1).

### 2026-09-22 — Quadro do Dia: colunas que declaram a consequência (Etapa 3)

- **Divergência aprovada (mesma decisão de 2026-09-22, opção 2):** o Banco de Leads passa a ter
  **duas vistas da mesma carteira** — `Lista | Quadro do dia` —, num `radiogroup` (e não
  `tablist`: não se troca um painel equivalente, escolhe-se entre o acervo e o recorte de hoje).
  **Nenhum item novo no menu lateral.**
- **Toda coluna carrega a CONSEQUÊNCIA em texto**, abaixo do título: "Só planejamento — não
  assume lead de ninguém e não envia nada", "Não significa venda fechada…". Sem isso, um quadro
  ao lado de um CRM é lido como funil. Cor é reforço (`neutro`/`info`/`warn`/`ok` na borda), o
  rótulo é a informação.
- **"Mover para" é um `<select>` de verdade em todo card**, além do arrastar. O arrastar nativo
  não existe em leitor de tela e é ruim em toque — oferecer só ele deixaria parte da equipe sem
  o Quadro.
- **A conclusão sem evidência tem modal próprio**, que explica por que está pedindo e avisa que
  o card ficará **autodeclarado**. Negar sem oferecer saída seria travar o trabalho; aceitar sem
  rotular seria mentir.
- **Colunas em `md:grid-cols-2` e `xl:grid-cols-4`**: quatro colunas em 1366px espremem o card a
  ponto de o nome do lead truncar sempre.
- ⚠️ **Verificação visual ao vivo ainda NÃO foi feita** (mesma limitação das Etapas 1 e 2).

### 2026-09-22 — Aquisição: três modos no lugar de três telas por fonte (Etapa 4)

- **Divergência aprovada (mesma decisão de 2026-09-22, opção 2):** a Aquisição deixa de ter uma
  sessão por FONTE e passa a ter **Resultados · Buscas · Rotinas**. A fonte vira **filtro** e
  **coluna** (pílula neutra, o mesmo tratamento do Banco de Leads — origem não é qualidade).
- **Atualização aprovada pelo operador:** o filtro de **Origem** também passa a viver dentro do
  modal **Colunas e filtros**, espelhando o Banco de Leads. O recorte ativo aparece nos chips de
  filtros ativos da listagem, junto de busca, nicho/cidade e filtros rápidos.
- **A coluna `ICP + cadastro` vira `ICP`:** a tabela mostra só a bolinha e o comando
  `Detalhes`; cadastro/coleta, evidências, endereço, nota e links ficam na ficha do lead.
- **O nome do lead abre a mesma ficha lateral do Banco de Leads**, não mais a fonte externa nem
  um modal centrado. Google Maps/Facebook/Biblioteca da Meta ficam como atalhos no cabeçalho da
  ficha, preservando acesso à fonte sem poluir a linha da tabela.
- **Telefone usa o mesmo atalho compacto do Banco de Leads:** número verde sublinhado abre
  WhatsApp em nova aba; sem telefone continua como ausência, não como botão falso.
- **`Status` e `Envio` são pílulas de uma linha na tabela do Banco de Leads:** textos auxiliares
  rotineiros como `Fila: ...` ou detalhe de geração automática não devem ficar abaixo do selo.
  Alertas de exceção (falha, trava, descarte, erro de IA, agendamento) podem continuar em texto,
  porque explicam impedimento ou consequência operacional.
- **Ações da linha usam linguagem operacional:** `Marcar` e `Descartar`; restaurar continua
  disponível para leads já descartados.
- **O seletor de fonte vive DENTRO de Buscas** (e de Rotinas, só com as fontes que têm rotina),
  como `radiogroup` — não como abas de página, que é o que fazia cada fonte parecer um produto.
- **A ausência da rotina da Meta é texto**, não lacuna: sem a frase, o operador procuraria um
  botão que não existe.
- ⚠️ **Verificação visual ao vivo ainda NÃO foi feita** (mesma limitação das Etapas 1-3).
