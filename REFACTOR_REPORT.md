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
| R3 | `node --test` sem argumento executa `scripts/test-evolution-send.js`, que **envia WhatsApp real** | avisado em README, ARCHITECTURE e project-map. Renomear o script removeria a armadilha |
| R4 | Migrations aplicadas no boot, sem dry-run contra banco real | agora atômicas + 12 guardas estruturais; **falta** smoke contra Postgres limpo |
| R5 | `backend/.env` aponta `DATABASE_URL` para **produção** (`postgres.railway.internal`) | não resolve fora da Railway, mas é uma arma carregada no diretório de dev |
| R6 | 82 endpoints ainda dentro de god files (`agent.js` 7.475 linhas) | decisão consciente (D1); cercados e cobertos pelo contrato de rotas |
| R7 | Paginação/filtros client-side com teto de 1.000 no Banco de Leads e Captação | não tocado — muda UX, exige sua autorização |
| R8 | Catálogo de modelos de IA defasado (`gpt-3.5-turbo`, sem a geração Claude 5) e tabela de preços hardcoded | não tocado |
| R9 | 23 worktrees e ~40 branches poluindo busca e grep | não tocado |
| R10 | Dockerfile com `npm install` (não `npm ci`), sem `--omit=dev`, com `RUN npm install pg` redundante | não tocado |

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
6. **Aposentar o dashboard legado**, tela a tela, baixando as catracas da cerca a cada uma.
