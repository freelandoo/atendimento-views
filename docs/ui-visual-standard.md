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
