# Modelo de cargos e acessos

> Status: modelo aprovado e implementado no codigo.
> Fonte real de autorizacao: `backend/src/services/acesso-capacidades.js`.

## Regra principal

O Atendimento Views separa duas perguntas diferentes:

1. **Cargo de plataforma**: o que a pessoa pode administrar no produto Atendimento Views como um todo.
2. **Cargo por empresa**: o que a pessoa pode fazer dentro de uma empresa/cliente.

Essas duas camadas nao devem ser misturadas. Uma pessoa pode ser `superadmin` da plataforma e, ao
mesmo tempo, `owner` da empresa PJ Codeworks. O inverso tambem vale: uma pessoa pode ser `user`
global e `owner` de uma empresa especifica.

## Cargos de plataforma

Tabela: `app.usuarios`.

CHECK: `superadmin | admin | user`.

| Cargo global | Uso |
| --- | --- |
| `superadmin` | Dono/operador da plataforma. Acessa tudo, incluindo contas globais e codigos externos da API de busca de leads. |
| `admin` | Administrador interno de plataforma. Nao e dono de uma empresa por si so. Deve ser usado apenas para funcoes globais que nao exigem superadmin. |
| `user` | Conta comum. Nao comunica permissao de empresa por si so. |

## Cargos por empresa

Tabela: `app.usuarios_empresas`.

CHECK atual, a partir da migration `101_simplificar_papeis_empresa.sql`: `owner | comercial`.

| Cargo por empresa | Uso |
| --- | --- |
| `owner` | Dono/responsavel pela empresa. Tem todas as capacidades da empresa: aquisicao, Banco de Leads, equipe, relatorios, integracoes, IA, playbook, custos e configuracoes. |
| `comercial` | Pessoa que trabalha a carteira comercial. Atende conversas, liga, agenda, trabalha leads aprovados, follow-ups, roteiros, propria instancia e propria comissao. |

`admin` e `member` nao existem mais como cargos por empresa no modelo atual.

## Conversao de legado

A migration `101_simplificar_papeis_empresa.sql` normaliza dados antigos:

- `app.usuarios_empresas.role = 'admin'` vira `owner`.
- `app.usuarios_empresas.role = 'member'` vira `comercial`.
- convites pendentes com `admin` ou `member` viram `comercial`.
- convites novos aceitam apenas `comercial`, porque `owner` nao nasce por link.

Essa decisao evita manter quatro cargos quando, no produto atual, so existem duas funcoes reais
dentro da empresa: quem responde pela empresa e quem trabalha a carteira.

## Acessos esperados

### `owner`

Ve e opera a empresa inteira:

- Visao Geral
- Central de Mensagens
- Central de Ligacoes
- Aquisicao
- Banco de Leads
- Follow-ups
- Roteiros
- Agenda
- Comissao
- Equipe
- Relatorios
- Instancias
- Playbook
- Modelo e IA
- Prompts e Saudacoes
- Uso e custos
- Integracoes
- Contas da empresa
- Perfil

### `comercial`

Ve o trabalho operacional:

- Minha Operacao
- Central de Mensagens
- Central de Ligacoes
- Banco de Leads
- Follow-ups
- Roteiros
- Agenda
- Comissao
- Instancias
- Perfil

Nao ve:

- Aquisicao
- Relatorios
- Equipe
- Contas da empresa
- Integracoes
- Configuracoes sensiveis de IA, playbook, custos e prompts

### `superadmin`

Passa por todas as capacidades e tambem acessa areas globais:

- Contas globais (`/dashboard/contas`)
- API de busca de leads em Integracoes
- rotas administrativas de plataforma, como `/api/admin/lead-search/*`

## Regras de implementacao

- Coisas de plataforma usam `app.usuarios.role`.
- Coisas de empresa usam `requireEmpresaAccess + requireCapacidade(...)`.
- Frontend nao recalcula regra de acesso; ele consome `capacidades` vindas de `/api/auth/me`.
- Concessoes em `app.usuarios_empresas.permissoes` continuam somente aditivas.
- Negar permissao significa trocar o cargo, nao gravar `false` em `permissoes`.
- `owner` e protegido na tela de Contas da empresa: nao e rebaixado/desativado por ali.
- Geracao, revogacao e rotacao de codigo externo da API de busca de leads continuam exclusivas do `superadmin`.

## Caso PJ Codeworks

O desenho correto para `pjcodeworks@gmail.com` e:

- `app.usuarios.role = 'superadmin'`, para administrar a plataforma.
- vinculo com a empresa PJ Codeworks em `app.usuarios_empresas.role = 'owner'`, para administrar a empresa PJ.

Isso deixa claro que o poder global e o poder dentro da empresa sao acumulados, mas continuam
registrados em lugares diferentes.
