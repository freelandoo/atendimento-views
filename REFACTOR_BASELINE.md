# REFACTOR_BASELINE.md

Estado **medido** do projeto ANTES de qualquer mudança arquitetural.

- **Data da medição:** 2026-09-21
- **Branch:** `codex/aprovar-distribuir` · HEAD `ee17f93` (5 commits à frente de `master`)
- **Máquina:** Windows 11 · Node **v22.19.0** · npm **10.9.3**
- **Base de decisão:** `ARCHITECTURE_AUDIT.md`
- **Propósito deste arquivo:** qualquer falha listada aqui **já existia**. Se reaparecer durante a refatoração, **não é regressão** — é herança. E o contrário também vale: o que está PASS aqui é contrato; se quebrar depois, a culpa é da mudança.

> **Nenhum arquivo de código foi alterado nesta fase.** As únicas escritas foram
> `docs/ai-task-start-log.md` (registro de início exigido pelo `CLAUDE.md`) e este arquivo.
> Os dois `package-lock.json` foram verificados após a fase e estão **intactos**.

---

## 1. Resumo — o placar do baseline

| Verificação | Backend | Frontend |
|---|---|---|
| Instalação (`npm ls --depth=0`) | ✅ **PASS** — 13 pacotes, sem faltantes nem extras | ✅ **PASS** — 14 pacotes, sem faltantes nem extras |
| Typecheck (`tsc --noEmit`) | ✅ **PASS** (exit 0) | ✅ **PASS** (exit 0) |
| Testes | ⚠️ **FAIL (exit 1)** — 2307/2309 · **2 falhas ambientais** | ✅ **PASS** — 704/704 |
| Build | ⛔ **NÃO EXISTE** (sem script) | ✅ **PASS** — 30 rotas, 0 warnings |
| Lint | ⛔ **NÃO EXISTE** (sem script) | ⛔ **NÃO EXECUTÁVEL** (script existe, trava) |
| Smoke de precificação | ✅ **PASS** | — |
| Testes fora do `npm test` | ⚠️ **3 falhas reais** em 604/608 | — |

**Leitura em uma frase:** o projeto está saudável nos dois typechecks e no build; tem **2 falhas ambientais** na suíte oficial e **3 falhas reais escondidas** em testes que o `npm test` não roda.

---

## 2. Backend

### 2.1 Instalação

`npm ls --depth=0` — sem `UNMET DEPENDENCY`, sem `extraneous`:

```
pjcodeworks-agent@1.0.0
+-- @types/node@25.6.2      +-- form-data@4.0.5     +-- pdf-parse@2.4.5
+-- axios@1.15.0            +-- jsonwebtoken@9.0.3  +-- pg@8.20.0
+-- cheerio@1.2.0           +-- multer@2.2.0        +-- pino@10.3.1
+-- cors@2.8.6              +-- docx@9.6.1          `-- typescript@6.0.3
+-- express@5.2.1
```

⚠️ **Divergência de runtime registrada:** o baseline foi medido em **Node 22**, o `package.json` declara `engines.node >= 20` e o `Dockerfile` usa **`node:20-alpine`**. Produção roda numa versão diferente da que valida aqui. Não é falha; é uma variável a não esquecer.

### 2.2 Typecheck — ✅ PASS

`npm run typecheck` → `tsc --noEmit`, exit **0**, saída vazia.

### 2.3 Testes — ⚠️ FAIL (exit 1), 2 falhas **ambientais**

```
# tests 2309   # pass 2307   # fail 2   # skipped 0   # duration_ms 7367
```

| # | Teste | Local | Causa |
|---|---|---|---|
| 912 | `motor de IA: generateAIResponse usa provedor configurado no banco` | `test/core.test.js:5575` | `Request failed with status code 429` |
| 913 | `motor de IA: disableFallback impede fallback mesmo quando habilitado` | `test/core.test.js:5618` | `Request failed with status code 429` |

**Diagnóstico:** os dois fazem **chamada HTTP real à API da OpenAI** e tomaram *rate limit / quota*. Não testam código deste repositório no momento da falha — testam a disponibilidade de um serviço pago.

**Consequência para a refatoração:** `npm test` **sai com exit 1 mesmo com o código intacto**. Enquanto isso não mudar, "os testes falharam" não é sinal utilizável, e nenhum CI pode simplesmente exigir exit 0.

**Registrado como dívida, não corrigido nesta fase:** teste de unidade não deveria depender de rede nem gastar crédito. A correção (mock do provider, ou marcar como teste de integração opcional) é candidata à Fase 1.

### 2.4 Smoke de precificação — ✅ PASS

```
npm run smoke:preco
✅ smoke precificacao ok — plano=padrao roi=0.73 valor=R$892
```

Verificado antes de rodar: `index.js:189-192` executa o smoke e faz `process.exit(0)` **antes** de `validarSecretsBoot()` e de `initDB` — **não conecta no banco e não aplica migration**. Seguro de rodar a cada etapa.

### 2.5 Build — ⛔ NÃO EXISTE

Não há `npm run build` no backend, e isso está **correto** para um projeto CommonJS sem transpilação: o que roda é o fonte. O `AGENTS.md` proíbe explicitamente inventar esse comando.

**O substituto honesto de "build do backend" é:** `npm run typecheck` + `npm test` + `npm run smoke:preco`. É esse trio que usarei como portão de cada etapa.

### 2.6 Lint — ⛔ NÃO EXISTE

Sem script `lint` no `package.json` e sem nenhum `.eslintrc*` / `eslint.config.*` no repositório (verificado). **Não é possível "executar lint" como o plano pede** — registro a lacuna em vez de inventar o comando.

### 2.7 ⚠️ Os testes que o `npm test` NÃO roda — 3 falhas REAIS

A auditoria apontou que `npm test` é uma lista manual de 141 arquivos e que **24 dos 165 ficaram de fora**. Executei os 24 (sem alterar o `package.json`):

```
# tests 608   # pass 604   # fail 4   # duration_ms 548
```

(4 linhas `not ok`, sendo uma o rollup do arquivo — **3 falhas distintas**.)

| Teste | Local | Erro | Hipótese |
|---|---|---|---|
| `tipo desconhecido retorna texto genérico` | `test/confusion-handler.test.js:174` | `assert.ok(text.includes('PJ Codeworks'))` → falso | **Teste provavelmente desatualizado**: o produto virou multiempresa e o texto genérico deixou de citar a PJ |
| `dm49z3: bot "Oi! Sou da PJ Codeworks…" é BLOQUEADO` | `test/repro-dm49z3.test.js:22` | `esperava bloqueio` — `false !== true` | Guarda de mensagem pública não bloqueia mais o que o teste espera |
| `controle: mesma re-oferta repetida SEM preferência de dia é barrada` | `test/reuniao-preferencia-dia.test.js:108` | `false !== true` | Regra de re-oferta de reunião mudou, ou é regressão antiga não percebida |

⚠️ **Este é o achado mais importante do baseline.** Se eu tivesse ligado os 24 testes no meio da refatoração, estas 3 falhas pareceriam causadas por mim. **Elas são anteriores.** Diagnosticar cada uma (teste obsoleto × regressão real) é a **primeira tarefa da Fase 1** — e é trabalho de investigação, não de refatoração.

Os outros 21 arquivos passam limpos e podem entrar no `npm test` assim que as 3 forem resolvidas.

---

## 3. Frontend

### 3.1 Instalação — ✅ PASS

`npm ls --depth=0` sem faltantes/extras: `next@14.2.35`, `react@18.3.1`, `react-dom@18.3.1`, `typescript@5.9.3`, `tailwindcss@3.4.19`, `postcss@8.5.15`, `autoprefixer@10.5.0`, `gsap@3.15.0`, `three@0.160.1`, `@react-three/fiber@8.18.0`, `@react-three/drei@9.122.0`, `@types/*`.

### 3.2 Typecheck — ✅ PASS

`npx tsc --noEmit`, exit **0**, saída vazia.

### 3.3 Testes — ✅ PASS

`npm test` (`node --test lib/*.test.js`):

```
# tests 704   # pass 704   # fail 0   # duration_ms 609
```

### 3.4 Build — ✅ PASS

`npm run build` (`next build`), exit **0**, **`✓ Compiled successfully`**, **0 warnings**, **30 rotas**, JS compartilhado **87,3 kB**.

Rotas mais pesadas (referência para não piorar): `/dashboard/banco-leads` 42,9 kB (207 kB first load) · `/dashboard/equipe` 26,4 kB (162 kB) · `/dashboard/central-ligacoes` 24 kB (173 kB) · `/dashboard/contextos` 15,1 kB (162 kB).

Só uma rota é dinâmica (`ƒ /dashboard/instancias/[id]/contexto`); as outras 29 são estáticas.

### 3.5 Lint — ⛔ NÃO EXECUTÁVEL

O script `"lint": "next lint"` **existe** no `package.json`, mas **não há configuração de ESLint** no repositório. Nesse estado o `next lint` abre um **prompt interativo** e trava a sessão — documentado no `AGENTS.md` ("Não existe ESLint aqui — `npm run lint` abre prompt interativo e trava").

**Não executei, de propósito.** Um script que existe e não pode ser executado é pior que a ausência dele: promete um portão que não existe. Registrado como lacuna a decidir (configurar ESLint **ou** remover o script).

---

## 4. Portão de validação que será usado em cada etapa

Como não há lint nem build de backend, o portão real deste repositório é:

```bash
# backend/
npm run typecheck      # deve continuar exit 0
npm test               # deve continuar 2307 pass / 2 fail (as duas do 429)
npm run smoke:preco    # deve continuar ok — plano=padrao roi=0.73 valor=R$892

# frontend/
npx tsc --noEmit       # deve continuar exit 0
npm test               # deve continuar 704/704
npm run build          # deve continuar Compiled successfully, 30 rotas, 0 warnings
```

**Critério de regressão:** qualquer número diferente dos acima. As 2 falhas do 429 são toleradas **apenas** enquanto forem exatamente aquelas duas, em `core.test.js:5575` e `:5618`, com erro 429.

### 4.1 ⚠️ Portão ATUALIZADO na Fase 1 (2026-09-21, commit `a023a68`)

As seções acima continuam valendo como **registro histórico** do que foi medido antes de qualquer mudança. O portão em vigor, porém, mudou — e ficou mais forte:

| Comando | Baseline (Fase 0) | **Em vigor (desde a Fase 1)** |
|---|---|---|
| backend `npm test` | 2309 testes · 141 arquivos · **exit 1** (2 falhas) | **2925 testes · 165 arquivos · 2925 pass · exit 0** |
| backend `npm run typecheck` | exit 0 | exit 0 |
| backend `npm run smoke:preco` | ok | ok |
| frontend `npx tsc --noEmit` | exit 0 | exit 0 |
| frontend `npm test` | 704/704 | 704/704 |
| frontend `npm run build` | Compiled successfully, 30 rotas | Compiled successfully, 30 rotas |

**A partir daqui, `npm test` do backend DEVE sair com exit 0.** As 2 falhas de 429 não eram ambientais: eram bug de teste (ver commit `a023a68`). Nenhuma falha é mais tolerada.

⚠️ **Nunca rode `node --test` sem argumento neste repositório.** O padrão de descoberta do Node inclui `test-*.js`. Em 2026-09-24 o script que **envia mensagem real de WhatsApp** foi renomeado para `scripts/enviar-teste-evolution.js`, fora desse padrão. O `npm test` usa o glob `test/*.test.js` justamente para não alcançá-lo.

⚠️ **O `npm test` depende do globbing do próprio Node** (o script passa o padrão entre aspas). Isso exige **Node ≥ 22** — que é o que a máquina de desenvolvimento usa. O `Dockerfile` (Node 20) **não roda testes**, então produção não é afetada.

---

## 5. Riscos e condições do ambiente registrados agora

| # | Observação | Por que importa para a refatoração |
|---|---|---|
| B1 | `npm test` do backend **sai com exit 1** por falha ambiental | Nenhum automatismo pode usar "exit 0" como critério enquanto isso valer |
| B2 | 2 testes fazem **chamada real e paga** a um provedor de IA | A suíte não é hermética; roda diferente conforme rede/quota/hora |
| B3 | **3 falhas reais** em testes fora do `npm test` | Precisam de diagnóstico ANTES de serem ligados, senão contaminam o sinal |
| B4 | ⚠️ **`backend/.env` aponta `DATABASE_URL` para `postgres.railway.internal` (produção)** | O boot do backend **aplica as 91 migrations** no banco apontado. Esse host não resolve fora da Railway (por isso não houve dano), mas **não se deve rodar `npm start` local com esse `.env`**. O `smoke:preco` é seguro porque sai antes do `initDB` |
| B5 | Baseline medido em **Node 22**, produção em **Node 20** | Diferença de runtime entre validação e execução |
| B6 | 8 arquivos modificados não commitados (trabalho de agenda) + 5 commits à frente de `master` | Misturados com a refatoração, ficaria impossível saber o que quebrou o quê. **Decisão do operador** |
| B7 | Sem CI/CD | Todo portão desta refatoração é executado à mão; nada impede um deploy com teste quebrado |
| B8 | Lint inexistente nos dois lados | O plano pede "executar lint" em cada etapa; não há o que executar |

---

## 6. Artefatos da medição

Logs completos ficaram fora do repositório, no diretório temporário da sessão (não versionados):

| Arquivo | Conteúdo |
|---|---|
| `baseline-backend-test.log` | saída completa do `npm test` do backend (14.112 linhas) |
| `baseline-orfaos.log` | saída dos 24 testes fora do `npm test` |
| `baseline-frontend-build.log` | saída completa do `next build` |

O `next build` gerou `frontend/.next/` e `tsconfig.tsbuildinfo` — ambos **gitignorados**, portanto a árvore de trabalho não foi suja.

---

## CHECKPOINT — FASE 0

**FASE EXECUTADA:** Fase 0 — Criar baseline

**Arquivos alterados:**
- `docs/ai-task-start-log.md` (registro de início — exigido pelo `CLAUDE.md`)

**Arquivos criados:**
- `REFACTOR_BASELINE.md` (este arquivo)
- `ARCHITECTURE_AUDIT.md` (etapa anterior)

**Arquivos movidos:** nenhum
**Arquivos removidos:** nenhum
**Dependências removidas:** nenhuma
**Código alterado:** **nenhum**

**Testes executados:**
- backend `npm test` → 2309 testes, 2307 pass, **2 fail (ambientais, 429)**
- backend 24 testes órfãos → 608 testes, 604 pass, **3 falhas reais distintas**
- backend `npm run smoke:preco` → ok
- frontend `npm test` → 704/704

**Build frontend:** ✅ **PASS**
**Build backend:** ⛔ **N/A — não existe script de build** (substituído por typecheck + test + smoke)
**Typecheck:** ✅ **PASS** (backend e frontend)
**Testes:** ⚠️ **FAIL herdado** — backend exit 1 por 2 falhas ambientais; frontend PASS
**Lint:** ⛔ **N/A** — não existe no backend; no frontend existe o script mas não é executável

**Possíveis riscos:** B1–B8 da seção 5. Os que bloqueiam avanço seguro:
1. **B6** — trabalho não commitado do operador misturado à árvore;
2. **B3** — 3 falhas reais escondidas precisam de diagnóstico antes de qualquer mudança estrutural;
3. **B2** — suíte não hermética torna o portão instável.

**Próxima etapa recomendada:** **Fase 1 — proteger fluxos críticos**, começando por:
1. diagnosticar as 3 falhas dos testes órfãos (teste obsoleto × regressão real) — **sem corrigir código de produção ainda**;
2. tornar herméticos os 2 testes que chamam a OpenAI de verdade;
3. só então ligar os 24 arquivos no `npm test` e fixar o portão;
4. depois, escrever os testes mínimos dos fluxos CRÍTICOS C1/C2/C3/C8 do `ARCHITECTURE_AUDIT.md`.
