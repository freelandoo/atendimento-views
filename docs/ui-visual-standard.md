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
