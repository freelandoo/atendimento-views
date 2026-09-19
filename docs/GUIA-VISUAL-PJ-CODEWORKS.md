# Guia visual PJ Codeworks

> **Fonte canônica do padrão visual.** Atualizado em **2026-09-18** a partir de **medição do
> código**, não de intenção: os valores abaixo são os que as telas realmente usam hoje.
> A versão anterior declarava `#0f66f5` e fundo `#f5f7fb` — nenhum dos dois existia no produto.
> Checklist de verificação e log de divergências aprovadas: [ui-visual-standard.md](ui-visual-standard.md).

## As duas superfícies (não confunda)

Este repositório tem **dois front-ends**, e o padrão não é o mesmo nos dois:

| Superfície | Onde | Estrutura |
| --- | --- | --- |
| **App SaaS (é o produto)** | `frontend/` (Next.js) | **Coluna lateral** (`Sidebar`) + área de conteúdo. Sem header com navegação horizontal. |
| **Dashboard legado** | `backend/public/dashboard/` | Header com logo + navegação horizontal. Em manutenção; **não é referência para tela nova**. |

Tela nova nasce no app SaaS. A estrutura de página do dashboard legado (header + nav horizontal
+ logo no topo) **não se aplica** ao Next — lá a identidade fica na coluna lateral.

## Os dois temas, e onde cada um vale

Decisão do operador em **2026-09-18**:

- **Tema CLARO — toda a área de trabalho.** É onde o operador passa o dia (22 das 25 telas já
  eram claras). `app/dashboard/layout.tsx` força isso no `<main>`: `[color-scheme:light]`.
- **Tema NEON (escuro) — só a porta de entrada e a coluna.** `login`, `signup` e a `Sidebar`.
  O contraste entre coluna escura e conteúdo claro é proposital.

**Não leve o neon para dentro da área de trabalho** e não clareie a Sidebar. Se uma tela de
trabalho estiver escura, ela está fora do padrão (é o caso de `dashboard/contas`, pendente).

## Tokens

### Tema claro — use o token, não o literal

Definidos em `frontend/tailwind.config.ts`. São **semânticos**: dizem o papel, não a cor.

| Token | Valor | Papel |
| --- | --- | --- |
| `surface` | `#ffffff` | card, modal, linha de tabela |
| `surface-2` | `#f8fafc` | fundo de página, zebra, cabeçalho de tabela |
| `surface-3` | `#f1f5f9` | hover, input, faixa neutra |
| `line` | `#e2e8f0` | borda padrão |
| `line-strong` | `#cbd5e1` | divisor com ênfase |
| `ink` | `#0f172a` | texto principal |
| `ink-2` | `#475569` | texto secundário |
| `ink-3` | `#64748b` | texto de apoio, rótulo |
| `brand` | `#2563eb` | **ação, foco e destaque real** — nada mais |
| `brand-dark` | `#1d4ed8` | hover da ação primária |
| `estado-ok` | `#059669` | positivo |
| `estado-warn` | `#d97706` | alerta |
| `estado-danger` | `#dc2626` | erro, ação destrutiva |
| `estado-info` | `#2563eb` | informação (= brand) |

> Os valores são exatamente os literais `slate-*` que as telas já usavam, então adotar o token
> **não muda um pixel**. Literal `slate-*`/`gray-*` em tela nova é legado — use o token.
> As telas antigas migram na etapa de repaginação de cada uma, nunca num varredor global.

### Tema neon (login, signup, Sidebar)

`void`, `panel`, `panel-2`, `neon-{cyan,magenta,lime,amber,red,violet}`, `hi`, `mid`, `lo`,
`shadow-glow-*` e a classe `.glass` — todos já em `tailwind.config.ts` e `app/globals.css`.

## Escalas fechadas

- **Raio:** `rounded-md` (6px) e `rounded-lg` (8px) para superfície; `rounded-full` só para
  pill, avatar e bolinha. **`rounded-xl`/`2xl` estão fora do padrão** (222 ocorrências legadas,
  que saem junto com a repaginação de cada tela — não num passe global).
- **Sombra:** `shadow-card` para card/superfície (mesmo valor de `shadow-sm`). Sombra forte
  (`shadow-xl`/`2xl`) só em modal e popover, que flutuam sobre o conteúdo.
- **Espaçamento:** múltiplos de 4. Padding de card `p-4`, de página `p-5`/`sm:p-8` (já no
  layout). Densidade de tabela: `py-2` por linha — a tabela é para varrer, não para respirar.

## Princípios

- Priorize **clareza operacional**: dashboards, filtros, tabelas e ações densos, escaneáveis e
  previsíveis.
- **Cor nunca é o único sinal.** Todo estado tem rótulo em texto junto — regra já cumprida por
  `BolinhaPontuacao` e `AlternadorModoIa`, e ela vale para tudo que nascer daqui em diante.
- Azul é **ação, foco e destaque real**. Verde/âmbar/vermelho são estado, nunca decoração.
- Evite tela com cara de landing page dentro do app. A primeira dobra mostra a ferramenta
  funcionando.
- Cards só para blocos funcionais, listas repetidas e modais. **Card dentro de card, não.**
- Texto curto, útil e orientado a decisão. Não explique a interface dentro da interface quando
  o próprio controle já comunica a ação.
- **Controle que a pessoa não pode usar:** se há decisão de produto a explicar, deixe visível e
  desabilitado **com o motivo em texto**; se não há, não renderize — botão inerte só convida ao
  clique.

## Componentes

Antes de criar, procure em `frontend/components/ui/`. Existem hoje: `Abas`, `BalaoAjuda`,
`BolinhaPontuacao`, `DataTableFrame`, `InterruptorAtivacao`, `MenuRadialAcoes`, `ModalConfirmar`,
`ModalAgenda`, `NeonProgress`, `NichoCidade`, `TextoTruncado`, `JsonLeadModal`, `icons`.

- **Botões:** primária (`bg-brand`, texto branco), secundária (`bg-surface` + `border-line`),
  perigosa (`estado-danger`) e neutra (fantasma). **Ainda não existe componente** — cada tela
  escreve à mão. É a Etapa 2 da repaginação.
- **Badges:** pill, cor semântica + rótulo em texto.
- **Campos:** `bg-surface`, `border-line`, foco com outline visível em `brand`.
- **Tabelas:** cabeçalho fixo quando houver rolagem, linhas finas, `DataTableFrame` como moldura.
- **Modais:** `bg-surface`, backdrop escuro translúcido, ações no fim. Confirmação destrutiva
  usa `ModalConfirmar` — **`window.confirm` é proibido**.

## Checklist antes de criar ou alterar uma tela

- A ação principal aparece sem rolagem desnecessária?
- Usei **token** (`surface`/`line`/`ink`/`brand`/`estado-*`) em vez de literal `slate-*`?
- O azul está reservado para ação, foco ou destaque real?
- Todo estado tem rótulo em texto, e não só cor?
- O raio é `md`/`lg`, e a sombra é `shadow-card`?
- Existe componente em `components/ui/` que já faz isso?
- Os controles cabem no mobile sem quebrar texto de forma estranha?
- A tela parece parte do app, e não uma peça isolada?
