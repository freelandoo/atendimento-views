# REFACTOR_REPORT.md

Relatório da reorganização arquitetural — **2026-09-21**, branch `codex/aprovar-distribuir`.

- **14 commits**, 40 arquivos tocados (+2.916 / −1.726)
- **Base de decisão:** `ARCHITECTURE_AUDIT.md` · **Estado inicial medido:** `REFACTOR_BASELINE.md`
- **Pendências:** `LEGACY_REVIEW.md`

> **Princípio que governou tudo:** preservar comportamento antes de melhorar arquitetura.
> **Uma única mudança de comportamento foi feita, e com autorização explícita** — a
> transacionalidade das migrations (`665bd1a`).

---

## 1. Estrutura anterior

```
backend/
  index.js            boot + 5 workers no .then() + 1 worker solto na montagem de rotas
  src/
    routes/    (38)   geração atual
    services/  (97)
    db/        (47)
    middleware/ (1)
    freelandoo/ (4)
    *.js       (65)   núcleo do agente + integrações + legado + helpers
  tools/              build-split.cjs (órfão)
  test/      (165)    141 na lista manual do `npm test`, 24 fora
  public/     (15)    dashboard legado, sem trava contra crescer

frontend/
  components/charts/  Chart3D + Bars3DScene (código morto)
  app/ components/ lib/

raiz/  package-lock.json vazio · README e mapas descrevendo um sistema que não existe
```

**Sintomas medidos:** `npm test` saindo com exit 1 mesmo com o código intacto · 24 arquivos de
teste desligados escondendo 3 falhas reais · migrations não atômicas · nenhuma trava contra a
geração legada crescer · 20 variáveis de ambiente não documentadas · documentação obrigatória
apontando para arquivos inexistentes.

## 2. Estrutura nova

```
backend/
  index.js            boot enxuto: monta rotas e chama iniciarWorkers({agent, pool})
  src/
    workers/          ← NOVO: registro único, com política de falha declarada
    routes/ services/ db/ middleware/ freelandoo/ *.js   (inalterados)
  test/      (170)    ← glob `test/*.test.js`, sem lista manual
    fixtures/         ← NOVO: rotas-publicas.json (418 rotas congeladas)

raiz/
  ARCHITECTURE.md ARCHITECTURE_AUDIT.md REFACTOR_BASELINE.md LEGACY_REVIEW.md REFACTOR_REPORT.md
```

A mudança estrutural foi **deliberadamente pequena**. O que mudou de verdade não foi o desenho
de pastas — foi o que o repositório **consegue provar sobre si mesmo**:

| | Antes | Depois |
|---|---|---|
| Testes rodando | 2.309 em 141 arquivos, **exit 1** | **2.957 em 170 arquivos, exit 0** |
| Rotas HTTP | não inventariadas | **418 congeladas** em contrato executável |
| Geração legada | podia crescer sem que ninguém notasse | **cercada** em 98 rotas / 15 páginas / 7 módulos |
| Migrations | "rollback efetuado" podia ser mentira | atômicas, com guarda de regressão |
| Variáveis de ambiente | 20 sem documentação | **0**, com teste cobrando |
| Workers | 2 lugares, política implícita | 1 registro, política declarada |

## 3. Arquivos removidos

| Arquivo | Por quê |
|---|---|
| `frontend/components/charts/Chart3D.tsx` | gráfico 3D construído e nunca plugado em tela |
| `frontend/components/charts/Bars3DScene.tsx` | idem — os dois só referenciavam um ao outro |
| `backend/tools/build-split.cjs` | gerava `src/*.js` a partir de `index.monolith.js`, que não existe, com ranges de linha fixos |
| `package-lock.json` (raiz) | lockfile vazio de um workspace inexistente |

Cada um foi reconferido no momento da remoção (import estático, import dinâmico, referência por
string, menção em docs). A pasta `tools/` e a `components/charts/` ficaram vazias e saíram junto.

## 4. Dependências removidas

`three@0.160.1`, `@react-three/fiber@8.18.0`, `@react-three/drei@9.122.0` — existiam
exclusivamente para os dois componentes acima (−855 linhas de lockfile).

**A prova de que eram peso morto:** o `First Load JS` do build continua **87,3 kB**, idêntico ao
baseline. Nunca estiveram em bundle algum.

O backend não tinha gordura: 11 dependências de produção, todas em uso.

## 5. Duplicações eliminadas

| Duplicação | Resolução |
|---|---|
| 2 clientes HTTP no frontend | as duas telas com `fetch` cru foram para o `apiFetch`, **menos uma** (ver §7) |
| 5 reimplementações de "só dígitos do telefone" | 4 passaram a delegar a `src/telefone-br.js`; **1 permanece** por decisão (ver §6) |
| Lista manual de testes × arquivos no disco | glob `test/*.test.js` |

## 6. Decisões arquiteturais

**D1 — Não extrair as rotas dos god files.** A auditoria pedia tirar os 82 endpoints de
`agent.js`, `prospecting.js` e `agenda.js`. Investigando: (a) os handlers dependem de dezenas
de helpers *privados* — movê-los exigiria transformar tudo isso em API pública, piorando o
encapsulamento; (b) o inventário mostrou que esses 82 endpoints **são a geração legada**, que
está sendo aposentada. Reorganizar código marcado para morrer é custo sem retorno. Em vez
disso, **cercou-se** a geração legada.

**D2 — Cercar em vez de mover.** Três catracas (98 rotas, 15 páginas, 7 módulos usando
`dashboardAuth`) que só descem. "Vamos aposentar o dashboard legado" deixou de ser intenção.

**D3 — Corrigir a transacionalidade das migrations** (única mudança de comportamento).
`pool.query('BEGIN')` não garante a mesma conexão do `COMMIT`; a migration podia rodar em
autocommit e o `ROLLBACK` não desfazer nada. Passou a usar client dedicado.

**D4 — Congelar a superfície HTTP por captura em tempo de execução**, não por leitura de fonte.
O caminho real é `prefixo de montagem + caminho relativo`, e o relativo é justamente o que muda
quando a rota troca de arquivo. Só o app montado conhece o valor que não pode mudar.

**D5 — Preservar invariantes existentes acima da própria refatoração.** `lead-telefone.js` tem
guarda que proíbe **qualquer** import. Enfraquecê-la para economizar uma linha seria trocar
segurança por estética: a cópia ficou, com a razão escrita ao lado.

**D6 — Testes desatualizados viram testes atuais, não lixo.** Os 3 que falhavam encodavam a
política *antiga* de guardrail. Foram reescritos para travar o que continua valendo — a
detecção — e a severidade atual, de forma que uma mudança de política fique visível.

**D7 — Não reorganizar o frontend por feature.** Ele já está organizado (`lib/` puro e testado,
`ui/` como design system, um cliente HTTP, zero store global). Mover 47 componentes seria
estética.

**D8 — Variável aposentada vira lápide, não linha apagada.** Some sem explicação, alguém
readiciona em seis meses.

## 7. Itens que ainda precisam de revisão

Detalhe e evidência em **`LEGACY_REVIEW.md`**.

| Item | Situação | Quem decide |
|---|---|---|
| `DEFAULT '<uuid da PJ>'` em 3 tabelas de captação | a migration 078 limpou 6 tabelas e deixou estas. ⚠️ Antes de remover: conferir se algum INSERT omite `empresa_id` — a coluna é `NOT NULL` | você |
| `backend/whisper-service/` | microserviço completo e **desconectado**; transcrição real usa a API da OpenAI | você (custo × infra) |
| `project-handoff-*` + dependência `docx` | sem consumidor de produção; só o teste o exercita | você (feature pausada?) |
| Ramo Playwright em `preview-site.js` | nunca executa (pacote não declarado); todo preview sai em SVG | você (PNG × SVG) |
| `src/ai-structured-analysis.js` | sem consumidor; o teste **nunca havia executado** | você |
| 3 scripts históricos | `cleanup-prospeccao-legado`, `seed-campanha-nail-designer`, `init-whatsapp` | você |
| `playbook/page.tsx` com `fetch` cru | **justificado**: é a única tela que lê header (`Retry-After`). Migrar exige expor headers no `apiFetch` (infra compartilhada por ~40 telas) | você |
| `REUNIAO_BUFFER_MIN` com **dois defaults** | 30 em `src/agenda.js`, 120 em `services/agenda-slots.js`. Documentado, não alterado | você |

## 8. Riscos conhecidos

| # | Risco | Mitigação atual |
|---|---|---|
| R1 | ~~Sem CI/CD~~ — **resolvido** em `.github/workflows/ci.yml` | typecheck + testes + smoke (backend), typecheck + testes + build (frontend), em todo push e PR. Sem segredo nenhum: verificado rodando a suíte com o `.env` removido. Um job extra carrega a aplicação no **Node 20** (o runtime do Docker), para incompatibilidade com produção aparecer no CI e não na subida do container |
| R2 | `npm test` depende do globbing do Node ⇒ exige **Node ≥22** | o Dockerfile (Node 20) não roda testes; documentado no README |
| R3 | ~~`node --test` sem argumento executa um script que **envia WhatsApp real**~~ — **resolvido** em 2026-09-24 | renomeado para `scripts/enviar-teste-evolution.js`, fora do padrão de descoberta do Node. `test/scripts-seguros.test.js` falha se qualquer arquivo de `scripts/` voltar a casar com `test-*.js`, `*.test.js` ou `test.js` |
| R4 | ~~Migrations aplicadas no boot, sem dry-run contra banco real~~ — **resolvido** em 2026-09-24 | job próprio no CI (`migrations em Postgres limpo`) roda `initDB` **duas vezes** contra um `postgres:15` vazio e confere que toda migration ficou registrada. Fechou também um buraco: `initDB` executa `sql/init.sql` **antes** das migrations, então a guarda de destino passou a valer ali também |
| R5 | ~~`backend/.env` aponta `DATABASE_URL` para **produção**~~ — **mitigado** em 2026-09-24 | O `.env` continua apontando para lá (é a credencial de trabalho do operador), mas o boot deixou de ser perigoso: `services/destino-migrations.js` só aplica migrations em banco **local**, a menos que o processo **prove** ser produção (`NODE_ENV=production` **ou** qualquer `RAILWAY_*`). Verificado contra o `.env` real: o boot para e **zero** consultas chegam ao banco. Não há variável de ambiente para furar a guarda |
| R6 | 82 endpoints ainda dentro de god files (`agent.js` 7.475 linhas) | decisão consciente (D1); cercados e cobertos pelo contrato de rotas. Em 2026-09-24 a cerca baixou de 98 para **84** rotas legadas, e a auditoria achou um vazamento entre tenants nas 29 de prospecção — ver §11 |
| R7 | Paginação/filtros client-side com teto de 1.000 no Banco de Leads e Captação | não tocado — muda UX, exige sua autorização |
| R8 | ~~Catálogo de modelos de IA defasado~~ — **atualizado** em 2026-09-24 | A geração 5 entrou na tabela de preços (`claude-fable-5-1`, `claude-opus-5-5`, `claude-opus-5`, `claude-sonnet-5`) e Opus 5 / Sonnet 5 passaram a ser escolhíveis. `gpt-3.5-turbo` saiu da lista **selecionável** mas **manteve o preço** — preço é contabilidade histórica, e remover a linha zeraria o custo já registrado. O `defaultModel` **não** mudou (trocá-lo mexeria no comportamento de toda empresa que nunca escolheu modelo). A tabela continua hardcoded: lê-la de uma API é projeto próprio |
| R9 | ~~23 worktrees e ~40 branches poluindo busca e grep~~ — **tratado** em 2026-09-24 | O dano real era a BUSCA: cada worktree é uma cópia completa do código, então um grep devolvia o mesmo trecho ~20 vezes (em 2026-09-23 isso produziu falso positivo numa varredura de remoção). `.ignore` na raiz tira `.claude/worktrees/` e `.codex/worktrees/` do ripgrep/fd **sem apagar nada**. Além disso, 24 worktrees que estavam **limpas E com o trabalho já fundido no master** foram removidas (de 33 para 9). As que tinham alteração pendente ou commit não fundido **ficaram** |
| R10 | ~~Dockerfile com `npm install`, sem `--omit=dev`, com `RUN npm install pg`~~ — **resolvido** em 2026-09-24 | `npm ci --omit=dev` (a imagem passa a reproduzir o lockfile que o CI testa), `RUN npm install pg` removido (instalava a versão mais nova por cima da travada, furando o lockfile no driver do banco) e `.dockerignore` novo (o contexto de build empacotava `node_modules/`, `.git/` e o `.env`). `ENV NODE_ENV=production` **não** foi declarado: nesta aplicação ela liga cookie Secure e SSL do banco |

## 9. O que eu errei nesta sessão

Registrado porque o relatório perde valor se só contar acertos:

1. **"114 variáveis sem documentação"** — errado. O grep da auditoria só via atribuição ativa e
   ignorava entradas comentadas, que são documentação legítima. O número real era 20.
2. **"O worker do Freelandoo dispara antes do banco, possível corrida"** — superestimado. O
   primeiro tick é agendado para 10 minutos após a largada; não havia corrida, havia desordem.
3. **"O `playbook/page.tsx` usa `fetch` cru sem razão técnica óbvia"** — há razão: ele lê o
   header `Retry-After`.
4. **Recomendei extrair as rotas do `agenda.js`** e tive de reverter a recomendação depois de
   investigar o custo real (D1).
5. **Quebrei o portão duas vezes** durante a sessão — um apóstrofo dentro de string e uma
   invariante de pureza que eu não havia encontrado. Nos dois casos o portão pegou antes do
   commit, que é exatamente para isso que ele existe.
6. **Escrevi o CI sem declarar o fuso, e ele nasceu vermelho** (descoberto em 2026-09-23). Eu
   verifiquei o pipeline localmente e concluí que "se o portão local passa, este aqui passa" —
   mas o runner do GitHub roda em **UTC** e a suíte assume `America/Sao_Paulo`, o fuso de
   produção. Resultado: 6 testes de backend e 2 de frontend falhando por exatamente 3 horas, em
   **todas** as execuções. A lição não é sobre fuso: eu chamei a suíte de "hermética" tendo
   verificado só a ausência de **credencial**, e generalizei para ambiente.

## 10. Ordem sugerida para continuar

1. ~~CI mínimo~~ — **feito e VERDE** em 2026-09-23. O primeiro run revelou que o workflow não
   declarava `TZ` e a suíte assume o fuso de produção; corrigido com `env: TZ: America/Sao_Paulo`
   (ver §9.6). Os três jobs passam.
2. ~~Decidir os itens de `LEGACY_REVIEW.md`~~ — **feito**: fila zerada em 2026-09-23. O schema
   saiu na migration `099` e os 4 dormentes foram removidos por decisão do operador.
3. **Smoke de migrations contra Postgres limpo** (R4).
4. **Paginação de servidor** no Banco de Leads (R7) — a última fronteira frontend/backend real.
5. **Atualizar o catálogo de modelos de IA** (R8).
6. **Aposentar o dashboard legado** — a interface saiu, a âncora da agenda foi desacoplada e as
   14 rotas que eram duplicata ou vazamento saíram. O que sobrou, e por que parou ali, está na
   **seção 11**, com dois achados: as 29 rotas de prospecção **não filtram empresa** (§11.1) e as
   16 de agenda **não são duplicatas** — operam a agenda do bot (§11.2). O próximo passo é do
   operador: matar ou escopar as 19 de prospecção que vazam e não têm equivalente.

## 11. O dashboard legado: onde a remoção parou, e o que a auditoria encontrou

A **interface** estática saiu inteira (`248464a`, −20.421 linhas) e a **âncora da agenda** foi
desacoplada (`b8c26fe`), que era o bloqueio declarado. Restavam as rotas. **14 saíram** (446 →
432 no contrato; catraca 98 → **84**), e a auditoria das restantes produziu dois achados que
valem mais que a contagem.

### 11.1 Achado: as 29 rotas de `/dashboard/prospeccao/*` NÃO filtram empresa

Medido lendo o corpo de cada uma: **nenhuma das 29** passa `empresaId`. E
`montarFiltrosProspects` só acrescenta a cláusula `empresa_id = $n` **quando o filtro é
informado** (`if (filtros.empresaId)`), então `GET /dashboard/prospeccao/prospects` devolve a
carteira de **todos os tenants**. A rota moderna irmã passa `empresaId: req.empresa.id` — a
diferença não é de estilo, é de isolamento.

É a mesma classe do `/dashboard/ai/logs`, e em duas delas o custo é maior que leitura:
`places-search` e `places-search-completo` disparam **coleta paga na Bright Data sem tenant**.

⚠️ **19 continuam no ar com esse buraco** (fila-diária, disparos, execuções, relatório diário,
diagnósticos, bloqueios, `whatsapp/status` e `places-search-completo`). Elas **não têm
equivalente moderno**, então removê-las tira capacidade — é decisão de produto, não limpeza.
Está aqui declarado porque o risco é de **isolamento**, não de arrumação.

### 11.2 Achado: `/dashboard/agenda/*` NÃO é duplicata da agenda moderna

Parecem as mesmas rotas e não são: as 16 legadas leem e escrevem **`vendas.agenda_eventos`**
(27 referências em `src/agenda.js`, **zero** para `app.`) — a agenda do **BOT**, onde caem as
reuniões marcadas pelo WhatsApp. As modernas operam **`app.agenda_eventos`**, a da tela. São as
duas agendas que o `AGENTS.md` declara não unificadas; a única ponte é o espelho de bloqueio da
migration 090. Remover as legadas apagaria a única superfície HTTP sobre a agenda do bot.

### 11.3 O que saiu (14 rotas)

| Rotas | Por que saiu |
|---|---|
| `GET /dashboard/meta/anuncios` | única do arquivo; a leitura fica em `services/meta-attribution.js`, escopada por empresa |
| `GET /dashboard/leads-quentes` | `routes/api-leads-quentes.js` já reusa a mesma função. O módulo perdeu os três `require` que só a serviam e virou leitura pura |
| `GET /dashboard/ai/presets` | duplicata: `GET /api/llm` devolve os presets com a configuração atual |
| `GET /dashboard/ai/logs` | lia `vendas.ai_logs` **sem filtro de empresa** |
| **10 de `/dashboard/prospeccao/*`** | `prospects`, `metricas`, `analytics`, `configuracao` (GET+PUT), `prospects/:id/aprovar\|rejeitar`, `prospects/lote/aprovar\|rejeitar` e `places-search` — todas com equivalente moderno **escopado** (`POST /buscar` no caso da busca) |

### 11.4 O que ficou (84), e por quê

| Grupo | Nº | Motivo |
|---|---|---|
| `/dashboard/auth/*` | 3 | ⚠️ **é a porta de todas as outras.** `dashboardAutorizado` exige `req.dashboardUser`, que só nasce do login por cookie+CSRF — `x-reprocess-secret` não o popula. Removê-la derruba ~80 rotas de uma vez, sem o registro por rota que o contrato exige |
| `/dashboard/prospeccao/*` | 19 | **vazam entre tenants (§11.1) e não têm equivalente.** Decisão de produto: matar (perde capacidade) ou escopar (trabalho real) |
| `/dashboard/agenda/*` | 16 | **não são duplicatas** (§11.2) — é a agenda do bot |
| `/dashboard/ai/settings` + `/test` | 3 | única superfície de `temperature`, `max_tokens` e dos 3 campos de fallback; e o único teste que faz **geração** ponta a ponta |
| `/dashboard/whatsapp/*` | 5 | o `AGENTS.md` **reserva** para fase própria; `instanciaVinculadaAoUsuario` é reusada por `prospecting.js` |
| resto (`prompts`, `stats`, `funil-diagnostico`, `conversa-*`, `export.csv`, …) | 38 | auditoria rota a rota ainda pendente |

O que torna o próximo passo seguro já está no lugar: `test/rotas-contrato.test.js` obriga toda
mudança de superfície a aparecer no diff do fixture, e `TETO_ROTAS_LEGADAS` trava cada patamar.
`CONSUMIDORES_DASHBOARD_AUTH` caiu de sete para **cinco** arquivos.
