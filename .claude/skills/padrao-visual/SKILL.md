---
name: padrao-visual
description: Padrão visual e UX do app SaaS (frontend/, Next.js) — tokens, temas, escalas, componentes e o checklist obrigatório. Use SEMPRE que a tarefa envolver tela, página, modal, componente, formulário, tabela, dashboard, card, sidebar, menu, fluxo visual ou experiência do usuário, ANTES de escrever ou alterar qualquer .tsx/.css do frontend.
---

# Padrão visual do projeto

Este arquivo **não guarda o padrão** — ele diz onde ele está e o que fazer. Duplicar tokens
aqui criaria uma segunda régua que divergiria da primeira (proibição explícita do `AGENTS.md`).

## Leia, nesta ordem

1. **`docs/GUIA-VISUAL-PJ-CODEWORKS.md`** — fonte canônica: tokens, escalas, componentes, temas.
2. **`docs/ui-visual-standard.md`** — as perguntas obrigatórias da Fase 5 do workflow e o log
   de divergências já aprovadas (leia o log: a resposta pode já ter sido decidida).
3. O bloco **"Padrão visual"** do `AGENTS.md` — o resumo que Codex e Cursor também recebem.

## O que este projeto cobra, e que costuma ser esquecido

- **Dois temas com fronteira fixa:** claro na área de trabalho, neon só em `login`, `signup` e
  `Sidebar`. Levar neon para dentro do dashboard é regressão.
- **Token, não literal.** `surface`/`line`/`ink`/`brand`/`estado-*` em `tailwind.config.ts`.
- **Cor nunca é o único sinal** — rótulo em texto junto, sempre.
- **A tela só TRADUZ** o veredito que a API resolveu. Regra de negócio no front quebra calada.
- **Não faça passe global de estilo** em tela existente: muda aparência sem verificação visual.
- **Fase 5 do workflow:** se a alteração puder fugir do padrão, **pare e pergunte** ao operador
  as três opções descritas em `docs/ai-workflow.md`, e registre a divergência aprovada em
  `docs/ui-visual-standard.md`.

## Validação do frontend

```bash
cd frontend
npx tsc --noEmit          # typecheck
node --test lib/*.test.js # módulos puros de apresentação
```

**Não existe ESLint neste repositório** — `npm run lint` abre prompt interativo e trava.
Para ver a tela de verdade: backend na porta 3000, frontend **sempre** com `-p 3001`
(dois `next dev` simultâneos corrompem o `.next`).
