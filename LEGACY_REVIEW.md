# LEGACY_REVIEW.md

Fila de **revisão manual**. Nada aqui foi removido, alterado ou corrigido.

Regra que governa este arquivo: quando a dúvida é entre **apagar** e **manter temporariamente**, mantém-se e registra-se aqui. Só sai desta fila por decisão explícita do operador.

- **Origem das classificações:** `ARCHITECTURE_AUDIT.md` (auditoria de 2026-09-21)
- **Última atualização:** 2026-09-23 (§1.1 e §2.5 resolvidos)

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

## 2. Código que parece morto e **não deve ser removido sem decisão**

### 2.1 `backend/whisper-service/` — **CERTEZA BAIXA para remoção**

- **Fato verificado:** microserviço Python completo (FastAPI + `faster-whisper`, modelo `medium`, CPU/int8, `POST /transcribe`, Dockerfile próprio). **Nenhum arquivo de `backend/src/` faz chamada HTTP para ele**; não existe `WHISPER_URL`; não aparece no `docker-compose.yml`. A transcrição real de áudio do WhatsApp usa a **API hospedada da OpenAI** (`whisper-1`) em `src/media-processing.js:44`.
- **Por que não remover:** está documentado como parte da arquitetura em 6 documentos (`docs/project-map.md`, `docs/project-architecture.md`, `docs/IMPLEMENTATION_SLICES.md`, `AGENTS.md`, `VLAEG_*`). Pode ser uma alternativa de custo deliberadamente guardada (transcrever local × pagar por minuto na OpenAI).
- **Pergunta para o operador:** a transcrição local ainda é um plano? Se não, sai o diretório **e** as menções nos 6 documentos, no mesmo movimento.

### 2.2 `src/project-handoff-build.js` + `project-handoff-docx.js` + `project-handoff-types.ts` — **CERTEZA MÉDIA**

- **Fato verificado:** ~570 + 246 linhas + tipos. **O único consumidor é `test/core.test.js:4762`**. Não existe rota com "handoff" no path (`agent.js` importa `handoff-alerts.js`, que é outro módulo). É a **única razão de existir da dependência `docx`** (9.6.1).
- **Por que não remover:** documentado em `docs/IMPLEMENTATION_SLICES.md:35-37` e `docs/project-map.md:68` como parte da arquitetura. Tem cara de **feature construída e nunca ligada**, não de resto de código apagado.
- **Pergunta para o operador:** o briefing em `.docx` era para ter sido ligado a alguma tela/rota? Se foi abandonado, saem os 3 arquivos, a dependência `docx` e as menções nos 2 documentos.

### 2.3 Caminho do Playwright em `src/preview-site.js:720-770` — **CERTEZA ALTA de que nunca executa**

- **Fato verificado:** `carregarPlaywrightOpcional()` faz `require('playwright')` dentro de `try/catch`. O pacote **não está no `package.json` nem em `node_modules`** — logo a função sempre devolve `null` e **todo preview de site sai como `svg-fallback`**, nunca como PNG.
- **Por que está aqui e não na remoção direta:** a decisão não é técnica, é de produto — *o preview em PNG era desejado?* Declarar a dependência custa ~300 MB de Chromium na imagem Docker; remover o ramo assume que SVG basta.
- **Pergunta para o operador:** PNG ou SVG?

### 2.4 Scripts sem entrada no `package.json` — **CERTEZA BAIXA a MÉDIA**

12 dos 24 scripts não têm entrada em `npm scripts`. A maioria é operacional legítima e **deve ficar** (`run-migration.js`, `clonar-prod-para-local.sh`, `dump-prompts.js`/`push-overlay.js`, `test-evolution-send.js`, `agendar-reuniao.js`, `update-ai-model.js`). Candidatos históricos:

| Script | Evidência | Certeza |
|---|---|---|
| `cleanup-prospeccao-legado.js` | **zero** menções em `docs/` ou `AGENTS.md`; limpava backlog do sistema antigo de prospecção | MÉDIA |
| `seed-campanha-nail-designer.js` | seed de conteúdo de um nicho específico; citado só em `docs/ai-task-start-log.md` | MÉDIA |
| `init-whatsapp.js` | setup manual de tabela; hoje a criação de instância passa por `api-whatsapp.js`; citado só em `docs/historico/` | MÉDIA |

⚠️ **`scripts/test-evolution-send.js` tem um problema à parte:** o nome casa com o padrão de descoberta de testes do Node (`test-*.js`), então `node --test` **sem argumento** o executa — e ele **envia mensagem real de WhatsApp**. O `npm test` usa o glob `test/*.test.js` justamente para não alcançá-lo. Renomeá-lo (ex.: `enviar-teste-evolution.js`) removeria a armadilha, mas muda um comando que o operador pode ter em anotação.

### 2.5 `backend/sql/migracao_analise_estruturada.sql` — ✅ RESOLVIDO (movido, 2026-09-23)

- **Fato verificado:** `src/db.js` carrega `sql/init.sql` e `sql/prospeccao_orquestracao.sql` no boot; **nunca** este arquivo. Reconferido em 2026-09-23: **nenhuma** referência a ele em código, teste, script, doc ou compose.
- **O que foi feito:** movido para `sql/historico/` (com um `README.md` explicando o critério da pasta). **Não foi apagado** — o schema que ele criou provavelmente está vivo em produção, e o arquivo é o único registro do que foi aplicado à mão via `psql`.
- **Efeito colateral bom:** a raiz de `sql/` passou a conter exatamente os dois arquivos que o boot lê.

### 2.6 `src/ai-structured-analysis.js` — **CERTEZA MÉDIA (descoberto na Fase 1)**

- **Fato verificado:** **nenhum consumidor de produção** (grep em todo o repositório: só o próprio módulo e seu teste). O teste, por sua vez, **nunca havia executado** — usava `describe`/`it` sem importar de `node:test`, corrigido no commit `a023a68`.
- **Contexto:** é remanescente da "Atividade A", iniciativa cujos documentos estão em `docs/historico/ATIVIDADE_A_*.md`.
- **Estado agora:** o módulo continua no lugar e seus 9 testes passam — ou seja, ele **funciona**, só não é chamado por ninguém.
- **Pergunta para o operador:** a análise estruturada (JSON com `analise`/`decisoes`/`restricoes`) foi substituída pelo caminho atual de Structured Outputs do `ai-provider.js`, ou ficou pendente de ligar?

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
