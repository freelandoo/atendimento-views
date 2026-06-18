@AGENTS.md

## Regras específicas para Claude Code

Sempre comece qualquer tarefa de código em **modo de análise**.

Antes de editar arquivos:
1. leia os arquivos relevantes;
2. explique o impacto;
3. diga quais arquivos pretende alterar;
4. espere confirmação quando a alteração for **grande, arriscada ou estrutural**
   (schema/banco, autenticação/segredos, prompts de produção, rotas públicas,
   muitos arquivos de uma vez).

Para mudanças pequenas e seguras, implemente no menor escopo possível.

Validação neste repositório usa os comandos reais do `package.json`:
`npm test`, `npm run typecheck` (quando tocar `.ts`/tipos) e `npm run smoke:preco`
(quando tocar precificação). **Não existem** `npm run lint` nem `npm run build` —
não invente esses comandos; se forem necessários, avise que precisam ser criados.

Nunca ignore as regras do `AGENTS.md`. Consulte também `docs/project-map.md` e
`docs/architecture-rules.md` antes de alterações estruturais, e use
`docs/change-impact-template.md` para registrar análises de impacto relevantes.
