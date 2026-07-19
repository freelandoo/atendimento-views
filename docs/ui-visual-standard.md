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

_(Nenhuma divergência registrada até o momento.)_
