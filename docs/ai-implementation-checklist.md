# AI Implementation Checklist

## Antes de implementar
- [ ] Entendi a solicitação?
- [ ] Li os arquivos relevantes?
- [ ] Consultei `docs/project-map.md` e `docs/architecture-rules.md`?
- [ ] Verifiquei se já existe código parecido (função/rota/serviço)?
- [ ] Verifiquei impacto nas rotas/entrada HTTP?
- [ ] Verifiquei impacto na regra de negócio/orquestração (`src/agent*.js`, funil)?
- [ ] Verifiquei impacto no banco (`sql/`, `src/db*.js`)?
- [ ] Verifiquei impacto em autenticação/segredos (`src/dashboardAuth.js`, rotas admin)?
- [ ] Verifiquei impacto em integrações (Anthropic, WhatsApp, Agenda)?
- [ ] Verifiquei impacto em jobs de prospecção (`src/services/*`)?
- [ ] Verifiquei impacto nos prompts de produção (`prompts/*.md`)?
- [ ] Listei os arquivos que serão alterados?
- [ ] A mudança é pequena e controlada (diff mínimo)?

## Durante a implementação
- [ ] Não criei duplicação?
- [ ] Não criei regra de negócio dentro do dashboard estático (`public/`)?
- [ ] Não quebrei o padrão de arquitetura?
- [ ] Não deixei código morto / import quebrado?
- [ ] Não deixei logs com dados sensíveis?
- [ ] Não criei variável de ambiente sem documentar (`AGENTS.md` + `.env.example`)?
- [ ] Não misturei refatoração grande com a feature?

## Depois da implementação
- [ ] Rodei `npm test`?
- [ ] Rodei `npm run typecheck` (se toquei `.ts`/tipos)?
- [ ] Rodei `npm run smoke:preco` (se toquei precificação)?
- [ ] Atualizei/ajustei testes em `test/` para regra alterada?
- [ ] Testei o fluxo principal afetado?
- [ ] Expliquei o que mudou e os riscos restantes?

> Não há `npm run lint` nem `npm run build` neste repositório. Se forem necessários,
> avise que precisam ser criados — não invente o comando.
