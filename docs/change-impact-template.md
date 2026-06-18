# Change Impact Template

Copie este modelo para registrar a análise de impacto de mudanças relevantes
(estruturais, de banco, de segurança, de prompts ou que toquem muitos arquivos).

## Solicitação
Descreva a tarefa.

## Arquivos analisados
Liste os arquivos lidos antes de alterar.

## Arquivos que serão alterados
Liste os arquivos previstos.

## Impacto em rotas / entrada HTTP
Endpoints, payloads e contratos públicos afetados.

## Impacto em regra de negócio
Funil, orquestração, follow-up, prospecção e serviços afetados.

## Impacto no banco
Tabelas, campos, migrations (`sql/`) e dados existentes.

## Impacto em autenticação e segredos
Risco de acesso indevido; segredos de webhook/admin envolvidos.

## Impacto em integrações externas
Anthropic, WhatsApp/Evolution, Agenda, mídia.

## Impacto em prompts de produção
Quais `prompts/*.md` mudam e por quê.

## Código antigo relacionado
Arquivos, funções ou módulos legados ligados à mudança.

## Riscos
Classifique: crítico / alto / médio / baixo.

## Plano de implementação
Ordem das mudanças (diff mínimo).

## Plano de validação
Como testar: `npm test`, `npm run typecheck`, `npm run smoke:preco`, fluxo manual.

## Critério de aceite
Quando a tarefa pode ser considerada concluída.
