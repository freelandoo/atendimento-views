# LEGACY_REVIEW.md

Fila de **revisão manual**. Nada aqui foi removido, alterado ou corrigido.

Regra que governa este arquivo: quando a dúvida é entre **apagar** e **manter temporariamente**, mantém-se e registra-se aqui. Só sai desta fila por decisão explícita do operador.

- **Origem das classificações:** `ARCHITECTURE_AUDIT.md` (auditoria de 2026-09-21)
- **Última atualização:** 2026-09-23 — **fila zerada.** Todos os itens de §1 e §2 foram decididos pelo operador e executados.

---

## 1. Pendências de SCHEMA

### 1.1 `DEFAULT '<uuid da PJ>'` sobrou em 3 tabelas — ✅ RESOLVIDO (migration `099`, 2026-09-23)

- **Onde estava:** `prospectador.captacao_campanhas`, `prospectador.captacao_snapshots`, `prospectador.email_outreach` — criadas na migration `012_captacao_social.sql` (linhas 80, 106 e 135) com `empresa_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'`.
- **Por que era problema:** a migration `078` removeu esse DEFAULT de 6 tabelas e não alcançou estas 3. Pela regra do `AGENTS.md`, um DEFAULT assim *"autorizaria silenciosamente qualquer INSERT futuro que esquecesse a coluna"* — foi exatamente assim que todo lead de toda empresa nasceu marcado como PJ (migrations 005/006).
- **A varredura obrigatória foi feita** (2026-09-23, repositório inteiro). São **7 INSERTs** e os **7 nomeiam `empresa_id`**: `captacao_campanhas` 1 (`social-capture.js:176`), `captacao_snapshots` 3 (`social-capture.js:267/456/512`), `email_outreach` 3 (`email-outreach.js:81/91/99`). As demais referências são SELECT/UPDATE ou comentário; nenhum script, teste ou migration insere.
- **Consequência que a varredura revelou:** o DEFAULT **já era código morto** para todos os caminhos de hoje — ele só dispara quando a coluna é OMITIDA. A migration não muda o comportamento de nenhum INSERT existente; fecha a porta para o INSERT de amanhã.
- **Corrigido por:** `sql/migrations/099_remover_default_pj_captacao.sql`, no mesmo padrão da `078` (bloco `DO $$`, condicional à existência da coluna, idempotente, **sem mutar dado**), + `COMMENT ON COLUMN` nas três.
- ⚠️ **Numeração:** o registro original previa "migration 091". Aquele número foi usado pelos leads da Meta em 2026-09-21; a correção saiu como **099**.
- **Continua protegido:** `test/migrations-integridade.test.js` impede que uma migration nova nasça com esse DEFAULT.

---

## 2. Código que parecia morto — ✅ TODOS DECIDIDOS E REMOVIDOS (2026-09-23)

Decisão do operador em 2026-09-23: **remover os quatro**. Cada remoção foi **reconferida no
momento de executar** (import estático, import dinâmico, referência por string e menção em
documento), e o portão inteiro rodou depois.

### 2.1 `backend/whisper-service/` — ✅ REMOVIDO

- **Reconferência (2026-09-23):** nenhuma referência em código, teste, script, `.env.example` ou
  `docker-compose.yml`. Só menções em documentação. A transcrição real continua sendo a API
  hospedada da OpenAI (`whisper-1`, `src/media-processing.js`).
- **O que saiu junto:** a linha de `AGENTS.md` que listava o diretório, a seção de
  `docs/project-map.md`, o "deploy separado" de `docs/project-architecture.md`, a linha de
  `ARCHITECTURE.md` e a variável fantasma `WHISPER_SERVICE_URL` do catálogo
  `docs/VLAEG_ENVIRONMENT.md` — que nenhum código jamais leu.
- **Não foram tocados** os registros datados (`ARCHITECTURE_AUDIT.md`, `REFACTOR_REPORT.md`,
  `docs/VLAEG_*_LOG.md`): eles descrevem o que era verdade na data, e não se reescrevem.

### 2.2 `project-handoff-build.js` + `-docx.js` + `-types.ts` — ✅ REMOVIDOS (+ dependência `docx`)

- ⚠️ **A reconferência achou uma distinção que o registro original não tinha, e ela importa:**
  o **campo** `project_handoff` é parte VIVA do contrato com a LLM — `agent.js:3149` o preserva
  quando a IA o emite, `core-funnel.js:248` o inicializa e `public-message-guard.js:21` impede
  que ele vaze na mensagem ao cliente. **Só os construtores** é que não tinham consumidor.
- **O que saiu:** os 3 módulos, a dependência `docx` (`package.json` + lockfile), 6 blocos de
  teste em `test/core.test.js` e as 3 linhas de `docs/IMPLEMENTATION_SLICES.md`.
- **O que FICOU, de propósito:** todo o tratamento do campo `project_handoff` nos 3 arquivos de
  produção acima, e o teste `createHandoffAlerts ... não chama gerarBriefingDocx`, que usa
  espiões (não importava os módulos) e hoje é uma guarda ainda mais forte.

### 2.3 Ramo do Playwright em `src/preview-site.js` — ✅ REMOVIDO

- **Decisão:** SVG basta. O ramo PNG **nunca executou** — `require('playwright')` sempre falhava
  porque o pacote nunca esteve no `package.json`, então toda prévia já saía como `svg-fallback`.
- **Efeito no comportamento: ZERO.** `renderizarPreviewSiteImagem` passou a devolver diretamente
  o que já devolvia; saíram `carregarPlaywrightOpcional`, o `launch`/`screenshot` e a entrada nos
  exports.
- **Ficou uma lápide** de 5 linhas explicando por que o ramo saiu e como voltar, no mesmo padrão
  das variáveis aposentadas do `.env.example` — uma remoção sem explicação é uma remoção que
  alguém refaz em seis meses.

### 2.4 Scripts históricos — ✅ REMOVIDOS

`cleanup-prospeccao-legado.js`, `seed-campanha-nail-designer.js` e `init-whatsapp.js`. Nenhum
tinha entrada em `npm scripts` e nenhum era citado por código. Os scripts operacionais legítimos
(`run-migration.js`, `clonar-prod-para-local.sh`, `dump-prompts.js`, `push-overlay.js`,
`test-evolution-send.js`, `agendar-reuniao.js`, `update-ai-model.js`) **continuam**.

⚠️ **Continua valendo o aviso sobre `scripts/test-evolution-send.js`:** o nome casa com o padrão
de descoberta de testes do Node, então `node --test` **sem argumento** o executa — e ele **envia
mensagem real de WhatsApp**. O `npm test` usa o glob `test/*.test.js` justamente para não
alcançá-lo. Renomeá-lo removeria a armadilha, mas mudaria um comando que pode estar anotado; não
foi feito.

### 2.5 `backend/sql/migracao_analise_estruturada.sql` — ✅ RESOLVIDO (movido, 2026-09-23)

- **Fato verificado:** `src/db.js` carrega `sql/init.sql` e `sql/prospeccao_orquestracao.sql` no boot; **nunca** este arquivo. Reconferido em 2026-09-23: **nenhuma** referência a ele em código, teste, script, doc ou compose.
- **O que foi feito:** movido para `sql/historico/` (com um `README.md` explicando o critério da pasta). **Não foi apagado** — o schema que ele criou provavelmente está vivo em produção, e o arquivo é o único registro do que foi aplicado à mão via `psql`.
- **Efeito colateral bom:** a raiz de `sql/` passou a conter exatamente os dois arquivos que o boot lê.

### 2.6 `src/ai-structured-analysis.js` — ✅ REMOVIDO

Nenhum consumidor de produção; o único importador era o próprio teste (`test/ai-structured-analysis.test.js`,
removido junto). Era remanescente da "Atividade A" (`docs/historico/ATIVIDADE_A_*.md`) e foi
substituído na prática pelo caminho de Structured Outputs do `ai-provider.js`.

---

---

## 3. Itens de **CERTEZA ALTA** — ✅ REMOVIDOS na Fase 5 (2026-09-21)

Cada um foi **reconferido no momento da remoção** (`git grep` por import estático, import
dinâmico, referência por string e menção em docs) e o portão de validação rodou depois.

| Item | Evidência na reconferência | Situação |
|---|---|---|
| `frontend/components/charts/Chart3D.tsx` + `Bars3DScene.tsx` (158 linhas) | Só referenciavam um ao outro; nenhuma menção fora dos próprios documentos de auditoria | **removidos** |
| Dependências `three`, `@react-three/fiber`, `@react-three/drei` | Existiam exclusivamente para o par acima. O `First Load JS` do build **não mudou** (87,3 kB) — prova de que nunca estiveram em bundle nenhum; eram peso só em `node_modules` (−855 linhas de lockfile) | **removidas** |
| `backend/tools/build-split.cjs` | Gerava `src/*.js` a partir de `index.monolith.js`, que não existe, com ranges de linha fixos. Só era citado por documentos | **removido** (a pasta `tools/` ficou vazia e saiu junto; a entrada órfã de `index.monolith.js` saiu do `.gitignore`) |
| `package-lock.json` da raiz | Lockfile vazio (`"packages": {}`); nenhum `package.json` declara `workspaces` | **removido** |
| `GOOGLE_PLACES_API_KEY` | Nenhum código a lê — só aparece na lista de redação de log de `src/logger.js:15`. A Aquisição migrou para Bright Data Maps | **virou lápide** no `.env.example` e saiu do `docker-compose.yml` |
| `EVOLUTION_INSTANCE: "PJ"` no `docker-compose.yml` | Injetava no container uma variável formalmente aposentada, que nenhum código lê | **virou comentário explicativo** |

> Duas dessas remoções viraram **lápide** em vez de exclusão: uma variável de ambiente
> aposentada que some sem explicação é uma variável que alguém readiciona seis meses depois. O
> comentário custa duas linhas e impede o retrabalho — é o mesmo motivo pelo qual o
> `.env.example` já mantinha o bloco de `EVOLUTION_INSTANCE`.

**Continua fora da remoção automática**, por decisão registrada: o ramo morto do Playwright em
`preview-site.js` (§2.3) — a escolha entre PNG e SVG é de produto, não técnica.

---

## 4. O que NÃO é legado (verificado e descartado)

Registrado para ninguém reabrir a suspeita:

- **`public/prospecacao.html`** — não é duplicata morta: é um stub de 12 linhas com `<meta http-equiv="refresh">` para `prospeccao.html`, corrigindo um link antigo com typo.
- **`public/dashboard/`** — não é uma segunda geração de dashboard: as 13 páginas de `public/` carregam todas os mesmos assets de `public/dashboard/{css,js,assets}`.
- **`FREELANDOO_ENC_KEY`** — parece env morta num grep direto, mas é lida indiretamente por `src/freelandoo/crypto.js:22` → `src/segredos-crypto.js`.
- **`knowledge/prints/*.png`** — existem e são usados por `src/whatsapp.js` (`PRINTS_AUTORIZADOS`).
- **3 arquivos de `src/db/`** (`lead-distribuicao.js`, `ligacao-sessao-guard.js`, `ligacoes-estado.js`) — consumidos por `require` relativo dentro da própria pasta `db/`.
- **`gsap`** — ativo e global (`MotionProvider` em `app/layout.tsx`), mais espalhado do que a documentação sugeria.
