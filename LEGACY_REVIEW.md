# LEGACY_REVIEW.md

Fila de **revisão manual**. Nada aqui foi removido, alterado ou corrigido.

Regra que governa este arquivo: quando a dúvida é entre **apagar** e **manter temporariamente**, mantém-se e registra-se aqui. Só sai desta fila por decisão explícita do operador.

- **Origem das classificações:** `ARCHITECTURE_AUDIT.md` (auditoria de 2026-09-21)
- **Última atualização:** 2026-09-21 (Fase 1)

---

## 1. Pendências de SCHEMA

### 1.1 `DEFAULT '<uuid da PJ>'` sobrou em 3 tabelas — **decidido: registrar, não corrigir agora**

- **Onde:** `prospectador.captacao_campanhas`, `prospectador.captacao_snapshots`, `prospectador.email_outreach` — criadas na migration `012_captacao_social.sql` (linhas 80, 106 e 135) com `empresa_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'`.
- **Por que é problema:** a migration `078` removeu exatamente esse DEFAULT de **6** tabelas (`prospectador.prospects`, `vendas.conversas`, `vendas.lead_profiles`, `vendas.followup_envios`, `vendas.analises_pos_conversa`, `vendas.ai_logs`) e **não alcançou estas 3**. Pela regra do próprio `AGENTS.md`, um DEFAULT assim *"autorizaria silenciosamente qualquer INSERT futuro que esquecesse a coluna"* — foi exatamente assim que todo lead de toda empresa nasceu marcado como PJ (migrations 005/006).
- **Risco atual:** qualquer INSERT nessas 3 tabelas que omita `empresa_id` grava o dado **sob a PJ**, sem erro e sem rastro.
- **Correção quando autorizada:** migration `091`, no mesmo padrão da `078` (bloco `DO $$`, condicional à existência da coluna, idempotente, sem mutar dado) fazendo `ALTER TABLE ... ALTER COLUMN empresa_id DROP DEFAULT`.
- ⚠️ **Verificar ANTES de aplicar:** se algum caminho de código insere nessas tabelas sem informar `empresa_id`, remover o DEFAULT quebra a inserção — a coluna é `NOT NULL`. Essa varredura **não foi feita**.
- **Já protegido:** `test/migrations-integridade.test.js` impede que uma migration **nova** (> 078) nasça com esse DEFAULT. A pendência histórica não é alcançada por essa guarda, de propósito — migration aplicada é história e não se reescreve.
- **Decisão (operador, 2026-09-21):** registrar agora, corrigir em rodada própria.

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

### 2.5 `backend/sql/migracao_analise_estruturada.sql` — **histórico, CERTEZA ALTA / apagar: BAIXA**

- **Fato verificado:** `src/db.js` carrega `sql/init.sql` e `sql/prospeccao_orquestracao.sql` no boot; **nunca** este arquivo. `docs/historico/*` mostra que era aplicado à mão via `psql`.
- **Recomendação:** mover para `sql/historico/` (seguro). **Não apagar** — o schema que ele criou provavelmente está vivo em produção, e o arquivo é o único registro do que foi aplicado.

### 2.6 `src/ai-structured-analysis.js` — **CERTEZA MÉDIA (descoberto na Fase 1)**

- **Fato verificado:** **nenhum consumidor de produção** (grep em todo o repositório: só o próprio módulo e seu teste). O teste, por sua vez, **nunca havia executado** — usava `describe`/`it` sem importar de `node:test`, corrigido no commit `a023a68`.
- **Contexto:** é remanescente da "Atividade A", iniciativa cujos documentos estão em `docs/historico/ATIVIDADE_A_*.md`.
- **Estado agora:** o módulo continua no lugar e seus 9 testes passam — ou seja, ele **funciona**, só não é chamado por ninguém.
- **Pergunta para o operador:** a análise estruturada (JSON com `analise`/`decisoes`/`restricoes`) foi substituída pelo caminho atual de Structured Outputs do `ai-provider.js`, ou ficou pendente de ligar?

---

## 3. Itens de **CERTEZA ALTA** que aguardam a Fase 5 (remoção)

Listados aqui só para não se perderem. **Não foram removidos ainda** — a Fase 5 é o momento, e cada um exige reconfirmação na hora.

| Item | Evidência resumida |
|---|---|
| `frontend/components/charts/Chart3D.tsx` + `Bars3DScene.tsx` | Só referenciam um ao outro; zero imports em `app/` e `components/`; zero menções em docs |
| Dependências `three`, `@react-three/fiber`, `@react-three/drei` | Existem exclusivamente para o par acima |
| `backend/tools/build-split.cjs` | Gera `src/*.js` a partir de `index.monolith.js`, que **não existe** no repositório, usando ranges de linha fixos. Já declarado como dívida técnica em `docs/ai-decision-log.md:1979` |
| `package-lock.json` da raiz | Lockfile vazio (`"packages": {}`) de um workspace que não existe |
| `GOOGLE_PLACES_API_KEY` no `.env.example` e no `docker-compose.yml` | Nenhum código a lê (só aparece na lista de redação de log em `src/logger.js:15`); a Aquisição migrou para Bright Data |
| `EVOLUTION_INSTANCE: "PJ"` no `docker-compose.yml` | Variável **aposentada**; só sobrevive em comentários e em testes de guarda que falham se voltar ao código |

---

## 4. O que NÃO é legado (verificado e descartado)

Registrado para ninguém reabrir a suspeita:

- **`public/prospecacao.html`** — não é duplicata morta: é um stub de 12 linhas com `<meta http-equiv="refresh">` para `prospeccao.html`, corrigindo um link antigo com typo.
- **`public/dashboard/`** — não é uma segunda geração de dashboard: as 13 páginas de `public/` carregam todas os mesmos assets de `public/dashboard/{css,js,assets}`.
- **`FREELANDOO_ENC_KEY`** — parece env morta num grep direto, mas é lida indiretamente por `src/freelandoo/crypto.js:22` → `src/segredos-crypto.js`.
- **`knowledge/prints/*.png`** — existem e são usados por `src/whatsapp.js` (`PRINTS_AUTORIZADOS`).
- **3 arquivos de `src/db/`** (`lead-distribuicao.js`, `ligacao-sessao-guard.js`, `ligacoes-estado.js`) — consumidos por `require` relativo dentro da própria pasta `db/`.
- **`gsap`** — ativo e global (`MotionProvider` em `app/layout.tsx`), mais espalhado do que a documentação sugeria.
