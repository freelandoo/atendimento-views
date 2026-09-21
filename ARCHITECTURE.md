# ARCHITECTURE.md

Como o **Atendimento Views** funciona, e como estender cada parte sem quebrá-lo.

- **Setup e comandos:** `README.md`
- **Mapa de pastas com números:** `docs/project-map.md`
- **A lei técnica (o que pode e o que não pode):** `docs/architecture-rules.md`
- **Decisões, defeitos corrigidos e o porquê de cada regra:** `AGENTS.md` — **fonte viva**; quando algo divergir, ele vence.

---

## 1. Visão geral

Um agente comercial de WhatsApp com o CRM em volta dele, servindo **várias empresas** a partir
de um único processo Node.

```
Lead (WhatsApp) ──► Evolution API ──► backend (webhook) ──► agente de IA ──► resposta
                                           │
Operador (navegador) ──► frontend ─────────┘ (mesma API, mesmo banco)
```

Três características explicam quase todas as decisões do código:

1. **Multiempresa com origem provada.** A empresa dona de uma mensagem é resolvida pela
   *instância* de WhatsApp que a recebeu. Sem prova, a mensagem vai para **quarentena** — não
   existe empresa padrão. O mesmo vale na saída: só sai mensagem por instância comprovada.
2. **Duas gerações convivem.** A geração legada (`/dashboard/*`, UI estática em
   `backend/public/`, auth por cookie+CSRF) está viva e **cercada**: não pode crescer. Tudo que
   é novo nasce na geração multiempresa (`/api/empresas/:empresaId/*`, UI em `frontend/`, auth
   por JWT + capacidades).
3. **A regra de negócio é determinística; a IA redige.** Não há tool-calling. O que decide é
   código testável; o modelo produz texto dentro de um JSON validado.

## 2. Frontend

Next.js 14 (App Router), React 18, TypeScript, Tailwind. 29 rotas.

O contrato que sustenta o frontend é: **a tela traduz o veredito que a API já resolveu.**

| Camada | Papel |
|---|---|
| `app/` | rotas e composição de tela |
| `components/ui/` | design system (`Botao`, `Campo`, `ModalConfirmar`, `FolhaModal`, `BolinhaPontuacao`, `DataTableFrame`) |
| `components/` | componentes de feature |
| `lib/*.js` | **módulos puros** de tradução — rótulos, estados, agrupamentos. Cada um com par `.d.ts` e `.test.js` |
| `lib/api.ts` | cliente HTTP único: token, timeout, erro tipado, origem de sessão |

Não há store global: dois Contexts de UI (`FeedbackProvider`, `MotionProvider`) e
`localStorage` para preferências de tela. Regra de negócio em `lib/` quebra em silêncio — por
isso vários desses módulos têm guardas que falham se passarem a ler campos que não lhes cabem.

## 3. Backend

Node 20 + Express 5, CommonJS. 247 arquivos em `src/`.

```
rota (routes/) → serviço (services/) → dados (db/) → PostgreSQL
     │                  │
     │                  └── puro: recebe dados, devolve veredito
     └── requireAuth → requireEmpresaAccess → requireCapacidade
```

**Autorização é por capacidade, nunca por papel literal.** O papel vem do *vínculo* da pessoa
com a empresa (`app.usuarios_empresas`), não de um papel global, e a matriz
`papel × capacidade` vive em `services/acesso-capacidades.js`. Comparar papel com string fora
desse módulo quebra o build.

**Segundo plano:** 6 workers registrados em `src/workers/`, iniciados uma vez após o `initDB`.
O registro declara quais falhas derrubam o boot (`job-worker`, `silence-watcher`) e quais são
apenas registradas.

## 4. Agentes de IA

⚠️ **Não há tool-calling nem function-calling neste sistema.** O que o projeto chama de
"agente" é um pipeline determinístico em volta de **uma** chamada de LLM que devolve JSON
estruturado. Todas as "ferramentas" são código executado antes ou depois da chamada.

```
mensagem do lead
   └─► resolve empresa pela instância ......... middleware/tenant.js
   └─► barra o que não tem dono provado ....... webhook-handler.js (quarentena)
   └─► agrupa mensagens picadas ............... message-buffer.js (debounce)
   └─► enfileira o turno ...................... job `webhook_resposta`
        └─► monta o prompt .................... prompts/system-core.md + system-<etapa>.md
        │                                       + empresa.md + Contexto 2 da instância
        │                                       + perfil do lead + histórico
        └─► decide a próxima ação ............. core-funnel.js, next-action-orchestrator.js,
        │                                       goal-selector.js, intent-detector.js
        └─► chama o modelo .................... ai-provider.js (Anthropic | OpenAI)
        └─► valida em cadeia .................. action-response-validator.js →
        │                                       message-validator.js → public-message-guard.js
        │                                       → message-limits.js → question-limiter.js
        └─► checa a capacidade da conversa .... conversa-modo-ia.js (`conversa` × `analise`)
        └─► resolve a instância de envio ...... whatsapp.js + services/instancia-envio.js
        └─► envia .............................. Evolution API
```

Dois pontos que surpreendem quem chega:

- **Guardrail de conteúdo AVISA, não bloqueia.** Desde 2026-06-17 só três erros *técnicos*
  barram a resposta (`json_invalido`, `acao_invalida`, `sem_mensagem_publica`). Re-saudação,
  menu de produtos e repetição são detectados e registrados como aviso — o conteúdo é do LLM.
- **No modo `analise`, a resposta é gerada e descartada.** Ela não vira balão do assistente nem
  entra no histórico. O modo não economiza chamada de IA: economiza *fala com o cliente*.

## 5. Banco

PostgreSQL, três schemas: **`app`** (SaaS multiempresa), **`vendas`** (conversas, perfis e a
agenda do bot) e **`prospectador`** (leads, coletas, campanhas).

O schema é aplicado **no boot**: `sql/init.sql` e `sql/prospeccao_orquestracao.sql` (base) e
`sql/migrations/*.sql` (91, versionadas em `app.schema_migrations`). Cada migration roda numa
transação com **client dedicado**; falha interrompe o boot em vez de seguir com schema pela
metade.

Invariantes que o repositório aprendeu na prática:

- **Nunca `DEFAULT` em `empresa_id`** — autoriza em silêncio todo INSERT que esquecer a coluna.
- **Migration aplicada é história**: corrige-se criando a próxima.
- Estado desconhecido é `NULL` ou ausência de linha, **nunca** um valor inventado.
- Decisão humana e inferência automática **não** compartilham coluna.

## 6. Integrações

| Integração | Onde | Observações |
|---|---|---|
| **Evolution API** (WhatsApp) | `src/whatsapp.js` | envio só por instância comprovada; sem fallback global |
| **Anthropic / OpenAI** | `src/ai-provider.js` | provider e modelo configuráveis; Structured Outputs no caminho OpenAI |
| **Bright Data** | `services/brightdata-client.js` (Datasets), `services/social-discovery.js` (SERP) | **gasta crédito real de uma conta única compartilhada** — passa por `brightdata-orcamento.js` |
| **Meta Conversions** | `services/meta-capi.js`, `meta-dispatch.js` | evento aceito **não se estorna**; ledger idempotente por entidade |
| **Freelandoo** | `src/freelandoo/` | canal por token (não QR) + API de dados para o playbook |
| **OpenAI Whisper** (áudio) | `src/media-processing.js` | API hospedada. `whisper-service/` (local) está órfão |

Segredo de terceiro é cifrado em repouso (`segredos-crypto.js`) e **nenhuma rota o devolve** —
só dica mascarada.

## 7. Fluxo de dados

**Operador → produto:**
```
navegador → frontend (JWT no header) → /api/empresas/:id/... → routes → services → db → Postgres
```
Sem BFF e sem proxy: o navegador fala direto com o backend (`NEXT_PUBLIC_API_URL`, CORS por
`FRONTEND_URL`).

**Lead → atendimento:** ver §4.

**Automações (sem ninguém pedir):** os 6 workers de `src/workers/` — fila de turnos, watcher de
silêncio, captação social, trava de lead, disparo automático do Banco de Leads e refresh de
playbooks. São eles que gastam crédito pago e disparam mensagem; por isso estão num registro
único e não espalhados.

## 8. Estrutura de diretórios

```
backend/
  index.js            boot: env, middlewares, mounts, workers
  src/
    routes/    (38)   camada HTTP da geração atual
    services/  (97)   regra de negócio (majoritariamente pura)
    db/        (47)   SQL por domínio
    workers/          registro do que roda em segundo plano
    middleware/       tenant.js (auth + empresa + capacidade)
    freelandoo/       canal alternativo
    *.js       (65)   núcleo do agente + integrações + o legado single-tenant
  prompts/     (13)   conhecimento do agente
  sql/                init.sql + migrations/ (91)
  public/      (15)   dashboard legado (cercado)
  test/       (170)   node --test, ~2.957 testes
  scripts/     (24)   backfills, medições, operação

frontend/
  app/         (29)   rotas
  components/  (47)   ui/ = design system
  lib/         (43)   módulos puros de tradução (+42 testes)
```

Detalhe por arquivo: `docs/project-map.md`.

## 9. Como adicionar uma nova feature

1. Decida onde a **regra** mora: um serviço puro em `src/services/`, testável sem banco.
2. Crie o acesso a dados em `src/db/<dominio>.js`. Migration se precisar de schema.
3. Exponha em `src/routes/api-<dominio>.js`, sob `/api/empresas/:empresaId/...`.
4. Declare a rota em `test/autorizacao-rotas.test.js` e atualize
   `test/fixtures/rotas-publicas.json`.
5. No frontend, traduza o veredito num módulo puro de `lib/` (com `.d.ts` e `.test.js`) e
   desenhe a tela com os componentes de `components/ui/`.
6. Rode o portão (§15) antes de concluir.

Nunca acrescente a feature ao dashboard legado: a cerca quebra o build.

## 10. Como adicionar uma nova API

```js
// src/routes/api-exemplo.js
const express = require('express')
const { requireAuth, requireEmpresaAccess, requireCapacidade } = require('../middleware/tenant')
const { CAPACIDADES: CAP } = require('../services/acesso-capacidades')

const router = express.Router({ mergeParams: true })
router.get('/', requireAuth, requireEmpresaAccess, requireCapacidade(CAP.X), async (req, res) => { … })
module.exports = router
```

Monte em `index.js` sob `/api/empresas/:empresaId/exemplo`. ⚠️ **`requireCapacidade` vem depois
de `requireEmpresaAccess`** — antes, ele recusa com 500 e a rota cai para todo mundo.
Escrita que exige capacidade diferente da do mount declara a sua **por rota**.

Depois: atualize o fixture de rotas e declare a rota na suíte de autorização. As duas coisas
são cobradas por teste.

## 11. Como adicionar um novo agente (ou etapa de funil)

Não existe "classe de agente" para herdar — o comportamento é a soma de prompt + regras
determinísticas.

1. **Prompt:** novo `prompts/system-<etapa>.md`, carregado por `src/prompts.js`. Use
   `{{empresa}}`, nunca um nome fixo.
2. **Decisão:** a etapa entra em `core-funnel.js` / `next-action-orchestrator.js`, e a ação em
   `ACOES_VALIDAS`.
3. **Validação:** se a etapa tem regra própria, ela vai em `action-response-validator.js` —
   lembrando que erro de conteúdo **avisa**, não bloqueia.
4. **Teste:** a regra é pura; teste sem banco e sem rede. **Não** escreva teste que chame o
   provedor de verdade (já custou 429 e dinheiro).

Para uma capacidade nova da IA por conversa, o lugar é `services/conversa-modo-ia.js` — a
matriz `modo × capacidade`, nunca um `if` espalhado.

## 12. Como adicionar uma nova integração

1. Cliente isolado, recebendo **configuração por parâmetro** — não lendo `process.env` no meio
   da lógica (é o que permite testar e o que evita credencial global num produto multiempresa).
2. Credencial por empresa, cifrada com `segredos-crypto.js`. Nenhuma rota devolve o segredo.
3. Se a chamada é **paga**, passe por orçamento e registre o consumo real no ledger
   (`brightdata-orcamento.js` é o modelo).
4. Se o efeito é **irreversível** (evento aceito, mensagem enviada, dinheiro), use ledger
   idempotente por entidade — nunca por telefone.
5. Documente cada variável nova no `.env.example` **e** no `AGENTS.md`. Há teste que cobra.

## 13. Variáveis de ambiente

`backend/.env.example` é a referência: **todas as 153 lidas pelo código estão lá**, com o
default real. `test/env-documentadas.test.js` quebra o build se alguém adicionar uma sem
documentar.

Obrigatórias no boot (sem elas o processo aborta): uma chave de IA
(`ANTHROPIC_KEY`/`ANTHROPIC_API_KEY` **ou** `OPENAI_KEY`/`OPENAI_API_KEY`), `EVOLUTION_API_KEY`,
`REPROCESS_SECRET`, `DASHBOARD_ADMIN_EMAIL`, `DASHBOARD_ADMIN_PASSWORD` e — em produção —
`JWT_SECRET`.

## 14. Como executar localmente

Passo a passo em `README.md`. Em resumo: `docker compose up -d postgres redis evolution-api`,
`cd backend && npm start` (porta 3000), `cd frontend && npm run dev -- -p 3001`.

⚠️ O boot **aplica as migrations** no banco de `DATABASE_URL`. Confira para onde seu `.env`
aponta.

## 15. Como testar

```bash
# backend/
npm run typecheck && npm test && npm run smoke:preco
# frontend/
npx tsc --noEmit && npm test && npm run build
```

`npm test` do backend roda `test/*.test.js` por glob e **tem de sair com exit 0** — não há falha
tolerada. ⚠️ **Nunca rode `node --test` sem argumento**: o padrão de descoberta do Node captura
`scripts/test-evolution-send.js`, que envia mensagem real de WhatsApp.

Quatro guardas estruturais quebram o build de propósito:

| Guarda | Protege |
|---|---|
| `rotas-contrato.test.js` | as 418 rotas montadas (método + caminho) |
| `legado-cercado.test.js` | a geração legada só encolhe |
| `migrations-integridade.test.js` | numeração, ordem e transacionalidade das migrations |
| `env-documentadas.test.js` | toda variável de ambiente documentada |
| `typecheck-cobertura.test.js` | a cobertura do typecheck só sobe (79 de 252 arquivos) |

**O typecheck do backend é opt-in por arquivo:** `// @ts-check` na primeira linha, com
`noImplicitAny` e `strictNullChecks` desligados de propósito — o alvo é propriedade inexistente
e argumento errado, não completude de anotação. Arquivo novo deve **nascer com o pragma**.

Além delas, dezenas de testes **leem o próprio fonte** para impedir que um defeito já corrigido
volte. Quando um deles falhar, leia a mensagem: ela costuma explicar o incidente que originou a
regra.

O CI (`.github/workflows/ci.yml`) executa esse mesmo portão em todo push e PR, **sem segredo
algum** — a suíte é hermética por construção. Um job adicional carrega a aplicação no Node 20,
o runtime do Docker, já que os testes rodam no 22.

## 16. Como realizar build

- **Frontend:** `npm run build` (Next). Deploy Vercel, Root Directory `frontend`.
- **Backend: não existe build** — é CommonJS, roda o fonte. A imagem Docker copia e executa;
  deploy Railway, Root Directory `backend/`. O equivalente ao "build passou" aqui é
  `typecheck + test + smoke`.
- **Não existe lint** em nenhum dos dois. O frontend tem o script `lint`, mas sem configuração
  de ESLint ele abre prompt interativo e trava — não o execute.
