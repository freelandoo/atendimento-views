# Architecture Rules

Lei técnica do projeto. Backend Node.js/Express (JavaScript) + PostgreSQL + frontend Next.js +
integrações (Anthropic/OpenAI, WhatsApp via Evolution, Bright Data, Meta, Freelandoo).

> Estrutura e números em **`docs/project-map.md`**. Decisões e histórico em **`AGENTS.md`**
> (fonte viva). Quando esta lei divergir do `AGENTS.md`, o `AGENTS.md` vence — e este arquivo
> precisa ser corrigido no mesmo commit.

---

## Regra 0 — Existem duas gerações, e a legada só encolhe

O processo serve a geração **legada** (`/dashboard/*`, UI em `backend/public/`, auth por cookie
+ CSRF em `dashboardAuth.js`) e a **atual** (`/api/empresas/:empresaId/*`, UI em `frontend/`,
auth por JWT + capacidades). As duas estão vivas.

**Código novo nasce na geração atual. Sempre.** Rota nova em `src/routes/`, tela nova em
`frontend/`, autenticação por `requireAuth` → `requireEmpresaAccess` → `requireCapacidade`.

Isto não é recomendação: `test/legado-cercado.test.js` congela 98 rotas legadas, 15 páginas em
`public/` e 7 módulos usando `dashboardAuth`. Passar de qualquer um desses números quebra o
build. Quando algo legado for aposentado, **baixe o número no mesmo commit**.

## Regra 1 — Separação de responsabilidades

| Camada | Onde | O que pode fazer |
|---|---|---|
| Entrada HTTP | `src/routes/*.js`, `index.js` | validar entrada, autorizar, chamar service/db, responder |
| Regra de negócio | `src/services/*.js` | decidir. Preferencialmente **puro**: sem banco, HTTP, IA ou rede |
| Acesso a dados | `src/db/*.js` (um por domínio) | SQL |
| Segundo plano | `src/workers/` | registrar o que roda periodicamente (a lógica fica no domínio) |
| Integrações | `ai-provider.js`, `whatsapp.js`, `media-processing.js`, `services/brightdata-*`, `services/meta-capi.js`, `freelandoo/` | falar com terceiros |
| Validação | `domainSchemas.js`, `*-validator.js` | contrato de dados |
| Helpers | `telefone-br.js`, `string-utils.js`, `date-utils.js` | utilidade genérica, sem domínio |
| UI | `frontend/` | interface e estado de tela |

**Um módulo não deve concentrar roteamento + regra + banco + integração ao mesmo tempo.**
`agent.js` (7.475 linhas), `prospecting.js` (4.913) e `agenda.js` (2.010) violam isso — são
legado conhecido, documentado, e **não devem servir de exemplo para código novo**.

## Regra 2 — Não duplicar lógica

Antes de criar função, rota, serviço ou módulo, procure equivalente. Se existir: **reutilize**,
**refatore** ou **explique por que precisa de outra versão**.

Quando dois módulos precisarem da mesma regra, um **reexporta** do dono (padrão já usado por
`paginacao.js`, `lead-identidade.js`, `equipe-area.js`). Duas cópias divergem em silêncio.

## Regra 3 — Rotas

Toda rota precisa de: validação de entrada · tratamento de erro · resposta padronizada ·
**autorização por capacidade** (`requireCapacidade`, nunca comparando papel com literal) ·
logs sem PII · nenhum segredo na resposta.

- Rota autorizada por capacidade **tem de estar declarada** em `test/autorizacao-rotas.test.js`,
  exercitada contra os 4 papéis, com o caso negativo. Há guarda que falha se você esquecer.
- ⚠️ **Ordem dos middlewares:** `requireCapacidade` vem **depois** de `requireEmpresaAccess`.
  Antes, ele recusa com 500 e a rota cai para todo mundo.
- Mudou caminho ou método de alguma rota? `test/rotas-contrato.test.js` vai acusar. Se foi de
  propósito, atualize `test/fixtures/rotas-publicas.json` no mesmo commit — aquele diff é o
  registro do que a mudança fez com a API.

## Regra 4 — Banco de dados

Alteração de schema exige: explicação do impacto · migration em `sql/migrations/` no padrão
`NNN_nome.sql` · compatibilidade com dados existentes · plano de rollback quando fizer sentido.

- Migrations rodam **no boot**, em ordem alfabética (= numérica), **cada uma numa transação com
  client dedicado**. Falha interrompe o boot: nunca "segue em frente".
- **Migration aplicada é história: não se reescreve.** Corrigir é criar a próxima.
- ⚠️ **Nunca crie coluna `empresa_id` com `DEFAULT`.** Um DEFAULT autoriza em silêncio todo
  INSERT que esquecer a coluna — foi assim que todo lead de toda empresa nasceu marcado como
  PJ (migrations 005/006, corrigidas pela 058 e 078). Há guarda que falha se voltar.
- Coluna que representa uma decisão humana nasce **sem DEFAULT** e, quando possível, com CHECK
  fechada. Estado desconhecido é `NULL` ou ausência de linha — nunca um valor inventado.

## Regra 5 — Prompts e comportamento do agente

`prompts/*.md` e `knowledge/*.json` afetam **produção diretamente**. Não altere tom, regra de
funil ou conhecimento autorizado sem justificar o impacto. Mudança de regra coberta por teste
exige atualizar `test/`.

⚠️ O produto é multiempresa: use o placeholder **`{{empresa}}`**, nunca o nome de uma empresa
fixa no texto.

## Regra 6 — Frontend

- A tela **traduz o veredito** que a API já resolveu. Regra de negócio no front quebra em
  silêncio. Os módulos de `frontend/lib/` são puros, testados e têm par `.d.ts`.
- Toda tela precisa de estado de **carregando, vazio e erro**, e de feedback claro da ação.
- Cor **nunca** é o único sinal: todo estado carrega rótulo em texto.
- Use os componentes de `frontend/components/ui/` antes de criar outro. `window.confirm` é
  proibido — use `ModalConfirmar`.
- Chamada à API passa por `apiFetch` (`lib/api.ts`). Exceção precisa de motivo escrito no
  arquivo (hoje há uma: `playbook/page.tsx`, que lê o header `Retry-After`).
- Padrão visual obrigatório: `docs/GUIA-VISUAL-PJ-CODEWORKS.md`.
- **Nenhuma** lógica crítica ou segredo no cliente.

## Regra 7 — Performance

Evite: consulta sem paginação ou limite · fetch duplicado · processamento pesado por requisição
· job que ignora cota configurada.

⚠️ **Coleta externa custa dinheiro real.** Bright Data (Aquisição, enriquecimento, captação)
consome crédito de uma conta única compartilhada por todos os tenants: respeite
`services/brightdata-orcamento.js` e registre o consumo real no ledger.

## Regra 8 — Segurança

Nunca confie no frontend. Valide no backend: permissão e ownership do recurso · dados de
entrada · segredos de webhook/admin · tokens.

- **Nunca registre chave, token ou PII em log** (telefone, texto de mensagem, e-mail,
  `ctwa_clid`). Use `src/logger.js`, que redige as chaves conhecidas.
- Segredo de terceiro é cifrado em repouso (`segredos-crypto.js`) e **nenhuma rota o devolve** —
  só dica mascarada.
- Origem não comprovada não vira dado: webhook sem instância provada vai para **quarentena**,
  não para uma empresa padrão.

## Regra 9 — Disciplina de mudança

- Diff mínimo, sem refatoração colateral. Não misture refatoração grande com feature nova.
- Preserve contratos públicos de rotas e payloads.
- Variável de ambiente nova só com documentação (`AGENTS.md` **e** `.env.example`).
- Na dúvida entre **apagar** e **manter temporariamente**: mantenha e registre em
  `LEGACY_REVIEW.md`. Ausência de import **não é** prova de código morto.

## Regra 10 — Validação antes de concluir

Não existe `lint` nem `build` no backend. O portão real é:

```bash
# backend/
npm run typecheck && npm test && npm run smoke:preco
# frontend/
npx tsc --noEmit && npm test && npm run build
```

`npm test` do backend **tem de sair com exit 0** — não há falha tolerada. Se um teste novo não
aparecer na suíte, verifique o nome: o glob é `test/*.test.js`.
