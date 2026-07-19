# Workflow Padrão de IA — PJ Codeworks

> Fluxo obrigatório que **toda IA** (Claude, Codex, Cursor, ChatGPT, etc.) deve seguir
> antes, durante e depois de qualquer alteração neste projeto. Complementa — não substitui —
> as regras de [AGENTS.md](../AGENTS.md) e [CLAUDE.md](../CLAUDE.md).
>
> Versão 2.0 (2026-07-04): inclui Fase 0 de inicialização, verificação visual/UX e
> confirmação de arquitetura.

## Documentos obrigatórios do workflow

| Arquivo | Finalidade |
| --- | --- |
| [AGENTS.md](../AGENTS.md) | Regras principais de trabalho da IA no projeto. |
| [CLAUDE.md](../CLAUDE.md) | Regras equivalentes específicas para o Claude. |
| [ai-workflow.md](ai-workflow.md) | Este arquivo — fluxo completo da Fase 0 ao relatório final. |
| [ai-task-start-log.md](ai-task-start-log.md) | Registro formal do início de cada tarefa (Fase 0). |
| [project-change-map.md](project-change-map.md) | Mapa das áreas alteradas e regras a preservar. |
| [ai-decision-log.md](ai-decision-log.md) | Registro das decisões técnicas relevantes. |
| [ui-visual-standard.md](ui-visual-standard.md) | Padrão visual/UX (aponta para `GUIA-VISUAL-PJ-CODEWORKS.md`). |
| [project-architecture.md](project-architecture.md) | Arquitetura definida (aponta para `project-map.md` + `architecture-rules.md`). |
| [project-map.md](project-map.md) | Mapa físico de pastas e responsabilidades. |
| [architecture-rules.md](architecture-rules.md) | Regras técnicas obrigatórias. |

## Fluxo obrigatório (Fase 0 → 11)

| Fase | Objetivo |
| --- | --- |
| **0 — Inicialização** | Verificar se o pedido é tarefa/projeto de alteração, registrar em [ai-task-start-log.md](ai-task-start-log.md) e confirmar no chat que está usando o workflow padrão. |
| **1 — Entendimento** | Resumir objetivo, mudanças, áreas impactadas, riscos e validações. |
| **2 — Confirmação** | Pedir confirmação quando a tarefa for grande, sensível ou ambígua. |
| **3 — Plano curto** | Listar arquivos, componentes, services, dados e validações prováveis. |
| **4 — Impacto** | Checar front-end, back-end, banco, financeiro, permissão, API e risco de duplicidade. |
| **5 — Visual/UX** | Verificar se a interface segue o padrão e perguntar se houver divergência. |
| **6 — Arquitetura** | Consultar ou propor arquitetura, listar alternativas e pedir aprovação se necessário. |
| **7 — Documentação** | Atualizar change map, visual standard e architecture quando aplicável. |
| **8 — Decisões** | Registrar decisões técnicas importantes em [ai-decision-log.md](ai-decision-log.md). |
| **9 — Implementação** | Alterar apenas o necessário, preservando padrões existentes (diff mínimo). |
| **10 — Validação final** | Rodar os scripts que existem no projeto (`npm test`, `npm run typecheck`, `npm run smoke:preco`) + validações manuais. |
| **11 — Relatório final** | Entregar o relatório padronizado (formato abaixo). |

> ⚠️ Este repositório **não tem** `npm run lint` nem `npm run build`. Rode apenas os
> scripts que existem no `package.json` (`test`, `typecheck`, `smoke:preco`). Ver AGENTS.md.

## Fase 0 — mensagem de confirmação no chat

Após registrar em `ai-task-start-log.md`, a IA responde:

> Identifiquei que este pedido é uma tarefa/projeto de alteração. Consultei o workflow
> padrão do projeto e registrei o início da tarefa em `docs/ai-task-start-log.md`.
> Vou seguir o processo obrigatório (Fase 1 a 11) e inicio agora pela Fase 1 —
> Entendimento do Pedido.

## Regra nova 1 — Padrão visual e UX

Sempre que a tarefa envolver tela, página, modal, componente, formulário, tabela,
dashboard, card, sidebar, menu, fluxo visual ou experiência do usuário, consulte
[ui-visual-standard.md](ui-visual-standard.md) **antes** de implementar e responda às
perguntas obrigatórias ali listadas. Se a tela puder fugir do padrão, **pare e pergunte**:

> Identifiquei que esta alteração pode impactar o padrão visual/UX do projeto. Posso seguir por:
> 1. Manter estritamente o padrão visual atual.
> 2. Criar uma variação visual controlada, documentando como novo padrão.
> 3. Reformular o padrão da área inteira para manter consistência.
>
> Minha recomendação: [explicar]. Qual caminho você aprova?

Registre divergências aprovadas em [ui-visual-standard.md](ui-visual-standard.md) e, quando
afetarem uma área do sistema, também em [project-change-map.md](project-change-map.md).

## Regra nova 2 — Arquitetura definida e aprovada

Sempre que a tarefa envolver criação de módulo, mudança de pasta, nova camada, regra de
negócio, API, service, integração, banco, autenticação, dashboard, financeiro ou
refatoração, consulte [project-architecture.md](project-architecture.md) antes de
implementar. Nenhuma mudança arquitetural grande é implementada sem confirmação do usuário:

> Para esta tarefa, recomendo a seguinte arquitetura: [explicar].
> Por que recomendo: [explicar]. Alternativas: [listar]. Riscos/impacto (banco, back-end,
> front-end, financeiro/dashboards/permissões, manutenção futura): [listar].
> Antes de implementar, confirme se quer seguir com esta arquitetura ou outra opção.

Registre decisões arquiteturais aprovadas em [ai-decision-log.md](ai-decision-log.md) e
[project-architecture.md](project-architecture.md).

## Regras permanentes

- Não alterar banco sem explicar necessidade, impacto e pedir confirmação.
- Não adicionar dependência/framework sem justificativa e confirmação.
- Não colocar regra sensível apenas no front-end.
- Não criar dashboard com dado incerto.
- Não duplicar regra de negócio nem componente já existente.
- Não deixar página nova fugir do padrão visual sem avisar.
- Não mudar arquitetura sem registrar e confirmar quando for decisão grande.
- Não fazer refatoração gigante sem pedido.
- Sempre atualizar documentação técnica ao alterar regra relevante.
- Sempre validar antes de finalizar.

## Formato obrigatório do relatório final

```markdown
## Relatório final da alteração
### 1. Resumo do pedido
### 2. Entendimento confirmado
### 3. Arquivos criados
### 4. Arquivos alterados
### 5. Regras de negócio impactadas
### 6. Decisões técnicas
### 7. Impacto visual/UX
- Houve impacto visual? Sim/Não
- Padrão visual mantido? Sim/Não/Não aplicável
- ui-visual-standard.md consultado/atualizado? Sim/Não/Não aplicável
- Pontos de atenção visual:
### 8. Impacto arquitetural
- Houve impacto arquitetural? Sim/Não
- project-architecture.md consultado/atualizado? Sim/Não/Não aplicável
- Arquitetura aprovada pelo usuário? Sim/Não/Não necessário
- Pontos de atenção arquitetural:
### 9. Validações executadas
- Test / Typecheck / Smoke:preco / Validação manual / Visual-responsiva / Financeira-dashboard-permissão
### 10. Resultado das validações
### 11. Inconsistências encontradas
### 12. Documentações atualizadas
### 13. Pontos de atenção
### 14. Próximos passos recomendados
```

## Checklist de aceite

| Item | Pergunta |
| --- | --- |
| Fase 0 registrada? | `ai-task-start-log.md` atualizado antes da implementação? |
| Entendimento claro? | Objetivo, mudanças, áreas impactadas e riscos explicados? |
| Confirmação feita? | Usuário confirmou quando o pedido era grande/sensível/ambíguo? |
| Impacto avaliado? | Front/back/banco/financeiro/dashboards/permissões/integrações checados? |
| Visual/UX checado? | Padrão mantido ou divergência perguntada e documentada? |
| Arquitetura checada? | `project-architecture.md` consultado ou atualizado? |
| Banco protegido? | Nenhuma migration sem justificativa e confirmação? |
| Dependências protegidas? | Nenhuma dependência adicionada sem justificativa e confirmação? |
| Validações rodadas? | Scripts existentes e validações manuais executados? |
| Relatório completo? | Relatório final com arquivos, decisões, impacto visual/arquitetural, validações e pontos de atenção? |
