# Direção: "Um Cérebro" — a IA decide, o código executa

> **Documento de DIREÇÃO, não de implementação.** Descreve o norte arquitetural e o
> caminho mínimo para chegar nele. Nenhuma linha de código foi alterada por este
> documento. A implementação, quando começar, dispara a Fase 0 do
> `docs/ai-workflow.md` (registro em `ai-task-start-log.md`, análise de impacto por
> fase, `npm test`).
>
> **Escrito para:** quem for implementar isto depois (você, Codex ou Claude) — assume
> familiaridade com o funil comercial e com `core-funnel.js`/`agent.js`.
>
> **Data:** 2026-09-30 · **Status:** proposta, aguardando aval por fase.

---

## 1. O problema em uma frase

Hoje **existem dois cérebros lendo a mesma conversa**, e o burro manda no inteligente:
uma máquina de estados de **regex** decide a ação do turno e a IA só escreve o texto
que essa política mandou. O resultado é frágil (fabrica `interesse: 'site'` do nada),
preso a legado (tudo é modelado como venda de site) e duplicado (regex e IA preenchem
os mesmos campos). O norte é **um cérebro só**: a IA recebe o estado completo, decide a
direção comercial e devolve JSON; o código valida e executa.

---

## 2. Diagnóstico — onde está a bagunça (e onde NÃO está)

### 2.1 A parte que JÁ está limpa (não mexer)

A fronteira IA↔backend **existe e funciona**:

- A IA devolve JSON com schema fixo (`prompts/agent-base.md`): `mensagens_bolhas`,
  `atualizar_perfil`, `etapa_proxima`, `handoff`, etc.
- O código **trata** esse JSON: `mesclarInsightsLead` (`core-funnel.js:49-93`) mescla
  sinais sem inventar, os validators (`action-response-validator.js`,
  `agent-validators.js`) checam a resposta, e o resultado vai ao banco.
- `system-core.md:255-290` já define o cérebro de IA correto: `insights_lead` com
  `score` (0-100), `sinais_compra[]`, `objecoes[]`, `urgencia`, e `sinal_conversa`
  (`adiamento`/`desinteresse`) — **instruído a refletir SOMENTE o que o lead disse**.

Isto é o alvo funcionando. O problema não é falta de separação — é o item abaixo.

### 2.2 A parte bagunçada: o segundo cérebro de regex

`src/turn-context-reader.js` (consumido por `core-funnel.js:18` e `agent.js:3642`) não é
um leitor auxiliar. É um **motor de decisão determinístico** que:

1. Interpreta a resposta do lead por regex — `interpretarRespostaCurta` (30-108).
2. Deriva "fatos" do lead — `construirFactMemory` (118-143).
3. Classifica o estado do turno por regex na mensagem do lead — `estadoDoTurno`
   (161-174): `textoPedePreco`, `textoConfuso`, `textoRecusa`.
4. **Decide a ação e as ações proibidas** — `construirActionPolicy` (176-205):
   `acao_permitida: 'coletar_cidade'`, `acoes_bloqueadas: [...]`.
5. **Injeta isso no prompt mandando a IA obedecer** — `montarPromptBlock` (211-247):
   *"--- LEITURA DO TURNO ATUAL (obrigatorio obedecer) ---"*.

**Consequência:** a IA não é o cérebro. É a mão que redige a política que o regex
computou. É o oposto exato do que você quer.

### 2.3 O bug que prova tudo

`turn-context-reader.js:104-105`:

```js
if (categoriasUltimaPergunta.includes('interesse') && textoAceita(texto)) {
  return { respondeu: true, tipo: 'interesse', valor: 'site', ... }
```

- `categoriasUltimaPergunta` vem de regex na **pergunta do BOT** (linha 43), não do lead.
- `textoAceita` = o lead disse um "sim" genérico.
- `valor: 'site'` é **literal cravado**.

Traduzindo: o bot pergunta "procura site, sistema ou automação?", o lead diz "sim", e o
sistema grava **interesse = site** — mesmo que o lead quisesse automação, mesmo que nunca
tenha falado "site". É o vazamento que você observou em produção. A `descricao` até
mente ("interesse em solucao/site"). **Este é o legado de site, concentrado.**

### 2.4 A duplicação

`construirFactMemory` (118-143) preenche `negocio`, `cidade`, `tem_site`, `interesse` —
**os mesmos campos** que a IA preenche via `atualizar_perfil`/`insights_lead`. Dois
juízes, um por regex e um por IA, para o mesmo fato. É a duplicação que o próprio
`AGENTS.md` proíbe.

### 2.5 Evidência de produção (medida em 2026-09-30, read-only)

Consulta agregada ao banco de produção (42 perfis, 131 conversas):

- **`insights_lead` NULO em 100% dos 42 perfis, mas `score_lead` gravado em 36.** A
  fiação funciona e o schema está completo (`agent.js:3249`, OpenAI strict, com
  `sinais_compra`/`objecoes`/`observacao_curta` todos `required`). A causa é
  **comportamental**: o modelo devolve `insights_lead` com `score` preenchido e os campos
  qualitativos **vazios** (`[]`/`null`). `mesclarInsightsLead` (`core-funnel.js:88`) só
  grava o objeto se sobrar algo além do score → com qualitativos vazios, grava só
  `score_lead` e deixa o objeto nulo. **O modelo não está RECONHECENDO os sinais** — que
  existem nos dados (*"quero contratar profissional"*, *"não temos interesse"*). Não é
  bug de pipe nem schema faltando. Fix = exemplos + calibração no prompt (Fase 1).
- **O `score_lead` que sobra está descalibrado.** Casos reais (telefone mascarado):
  lead que disse *"quero comprar serviço / quero contratar profissional"* → **score 30**;
  lead que disse *"no momento não estamos interessado"* → **score 73**. O único sinal
  persistido hoje não é confiável para priorizar nada.
- **Muitas "falas do lead" são o BOT do próprio prospect** (fluxo de prospecção
  bot-a-bot: o agente da {{empresa}} aborda outra empresa, que tem seu próprio
  atendente automático). Contexto relevante para calibrar exemplos e score — parte do
  histórico não é fala humana.

### 2.6 Qual cérebro está VIVO (rastreado e verificado em 2026-09-30)

`gerarEEnviarRespostaWhatsapp` tem **três caminhos**, nesta ordem
(`core-funnel.js:1197-1245`):

1. **Legado + estágios do contexto** — se a empresa tem contexto ativo COM `estagios_json`
   (`getContextoAtivoComEstagios`), roda o funil legado (`system-core.md`/`agent-base.md`)
   com Núcleo + estágios + conhecimento do contexto injetados via `chamarClaudeTurno`.
   Grava `insights_lead`/`score_lead` em `vendas.lead_profiles`.
2. **Playbook (Contexto 2 sem estágios)** — `processarMensagemComPlaybook`, grava
   `app.lead_insights`. Só roda quando **não** há estágios (`!ctxEstagiosTurno`).
3. **Legado puro** (PJ sem contexto).

**Verificado no banco (2026-09-30):**
- **Provider = OpenAI** (`AI_PROVIDER=openai`) → Structured Outputs strict ativo; o schema
  de `agent.js:3249` (com todos os campos de `insights_lead`) é o que governa.
- As **2 únicas empresas** com contexto têm `runtime_ativo = true` **E `estagios_json`
  preenchido** → ambas caem no **CAMINHO 1**. O playbook (caminho 2) **não é usado**.
- Confere com os dados: `score_lead` **atual** em `lead_profiles` (19 nos últimos 30 dias,
  hoje) vs `app.lead_insights` **parado em 2026-07-18** (8 linhas). Tráfego atual: 131
  conversas, 103 em 30 dias.
- As conversas recentes são **prospecção outbound** (operador confirmou) — mas as
  respostas dos prospects contêm interesse/objeção reais.

**Conclusão (corrige versões anteriores desta seção):** o cérebro vivo é o **funil legado
com estágios (caminho 1)**, em OpenAI. **`system-core.md`/`agent-base.md` SÃO o prompt de
produção — editá-los AFETA os tenants.** A Fase 1 original (exemplos + calibração no
`system-core.md`) é o fix correto e suficiente para o sintoma medido; **não** precisa
mudar schema (já completo) nem persistência (já funciona). O playbook e a consolidação
"um cérebro" continuam sendo o norte de longo prazo, mas **não** são o que está no ar
hoje.

---

## 3. A definição do alvo (o nome "legal")

O padrão que você quer tem nome estabelecido e não precisa de framework:

- **Single-brain / LLM-as-router com Structured Outputs.** O LLM recebe todo o estado
  como contexto, decide a próxima ação/direção e devolve **JSON com schema fixo**; o
  código determinístico apenas **executa e valida** o JSON (agenda, envio, handoff,
  preço). O LLM é o roteador; o código é o efetuador.
- O anti-padrão atual é o inverso: **uma máquina de estados dirige o LLM como
  renderizador de texto** — o regex decide, o LLM redige.

Você já implementa Structured Outputs (`AI_STRUCTURED_OUTPUTS`, json_schema strict no
caminho OpenAI; no Claude o equivalente é tool-use forçado). Não falta biblioteca. Falta
**tirar o segundo cérebro** e **tornar explícito o que o cérebro que fica recebe**.

---

## 4. O norte

```
  ┌─────────────────────────────────────────────────────────┐
  │  CÓDIGO monta o ESTADO COMPLETO (JSON) e injeta no prompt │
  │  - perfil/fatos conhecidos: {negocio, cidade,            │
  │    tem_site, site_confirmado, email, ...}                │
  │  - perguntas já feitas: [...]  (para não repetir)        │
  │  - dor(es) do contexto do negócio (não "site")          │
  │  - disponibilidade de agenda, preço já calculado         │
  │  - dados do prospect/registro, se houver                │
  └───────────────────────────┬─────────────────────────────┘
                              │
                              ▼
  ┌─────────────────────────────────────────────────────────┐
  │  IA (UM cérebro) — recebe o estado, sabe o que tem e o   │
  │  que falta, segue a direção SPIN (Situação → Problema →  │
  │  Implicação → Necessidade → reunião) e devolve JSON:     │
  │  { mensagens_bolhas, atualizar_perfil, insights_lead,   │
  │    reuniao_escolha, direcao_proxima, handoff, ... }      │
  └───────────────────────────┬─────────────────────────────┘
                              │
                              ▼
  ┌─────────────────────────────────────────────────────────┐
  │  CÓDIGO valida o JSON e EXECUTA: agenda, envio ao         │
  │  WhatsApp, handoff, preço, persistência. Não reinterpreta.│
  └─────────────────────────────────────────────────────────┘
```

O que muda em relação a hoje: o bloco do meio deixa de **receber uma ordem de regex** e
passa a **receber o estado e decidir**. O que o regex fazia de legítimo (não repetir
pergunta) vira **dado injetado explicitamente** (fatos conhecidos + perguntas já feitas),
não dedução frágil.

---

## 5. O que MUDA e o que NÃO muda

| Área | Decisão |
|---|---|
| Fronteira IA↔código (JSON in/out, validators) | **Mantém.** Já é o alvo. |
| `insights_lead` (score, sinais, objeções, `sinal_conversa`) | **Mantém e vira a fonte única** de interesse/desinteresse. |
| `turn-context-reader` como **juiz de ação** (regex decide) | **Remove.** É o segundo cérebro. |
| Rastreio de "não repetir pergunta" | **Reimplementa** como fatos+perguntas injetados no prompt (não regex). |
| Preço, agenda, envio, handoff (código decide) | **Mantém.** São execução, não análise conversacional. |
| Modelagem "tudo é site" | **Remove.** Dor vem do contexto do negócio. |

---

## 6. Caminho mínimo — faseado, do mais barato ao mais caro

Cada fase é entregável e reversível sozinha. **Não juntar fases num diff só** (regra do
`AGENTS.md`: refatoração grande não anda com feature).

> ✅ **Confirmado (§2.6): o cérebro vivo é o funil legado + estágios (`system-core.md`/
> `agent-base.md`), em OpenAI.** Então a Fase 1 (exemplos + calibração no `system-core.md`)
> **é o fix certo e atinge produção**. A **Fase 2 (persistir) é DESNECESSÁRIA** — schema
> completo (`agent.js:3249`) e persistência (`mesclarInsightsLead`) já funcionam; o objeto
> fica nulo só porque o modelo devolve os qualitativos vazios (§2.5), o que os exemplos
> resolvem. A Fase 3 (matar o regex) segue válida. O playbook e a consolidação "um
> cérebro" são norte de longo prazo, **não** o que está no ar.

### Fase 1 — Exemplos reais + modelo barato (independente, faz primeiro) · ~baixo risco
- 5-6 exemplos **reais** (tirados de conversas do banco, não inventados) de interesse
  alto/baixo e de objeção, direto no `system-core.md` (global a todo tenant).
- Rodar tudo em modelo barato; se objeção/proposta/fechamento cair de qualidade, rotear
  **só essas etapas** para o modelo capaz (a etapa já é conhecida pelo orquestrador).
- **Medir:** o `score`/objeções melhoraram? Se sim, parte do problema já morre aqui.
- Não toca `turn-context-reader`. Puramente prompt + config.

### Fase 2 — Persistir a saída estruturada da IA (PRÉ-REQUISITO) · baixo/médio risco
- **Achado de produção (§2.5): `insights_lead` é gravado em 0% dos perfis.** A IA decide
  e o veredito some. Enquanto isso for verdade, nenhuma fase seguinte tem efeito
  observável e a medição da Fase 1 fica cega para o lado qualitativo.
- Incluir `insights_lead` (e o que mais a IA decidir) **no schema de saída de
  `agent-base.md`**, não só no `system-core.md` — hoje a IA copia o schema base, que não
  lista o campo, então nem chega a emitir.
- Garantir que `mesclarInsightsLead` grava o objeto (já sabe fazer; o problema é a
  entrada vir vazia).
- **Reavaliar a calibração do `score`** com os exemplos da Fase 1 — hoje ele está
  invertido em casos reais (§2.5).
- Sem isto, "um cérebro" seria um cérebro que fala no vácuo.

### Fase 3 — Matar o cérebro de regex de interesse/desinteresse · médio risco
- Parar de consumir `respostaCurta.tipo==='interesse'` e `textoRecusa`; a fonte de
  interesse/desinteresse passa a ser **só** `insights_lead`/`sinal_conversa`.
- Remove o bug do `valor:'site'`.
- **Pré-requisito de análise:** mapear todos os consumidores do fato `interesse` e do
  estado `lead_recusou` antes de deletar, para o funil **não voltar a repetir pergunta**.
- **Decisão firmada:** sem fallback. IA fora do ar → sinal fica `null`, o funil não
  chuta. (Coerente com a filosofia do repo: ausência de sinal ≠ sinal errado.)

### Fase 4 — Estado explícito no prompt (o "JSON completo entra") · médio risco
- Substituir o que o `factMemory` fazia de legítimo por **injeção explícita**: o código
  monta `{negocio, cidade, tem_site, site_confirmado, email, perguntas_ja_feitas: [...]}`
  a partir do **perfil/banco** e injeta no prompt. A IA sabe o que tem e o que falta —
  sem regex deduzir.
- É aqui que o `turn-context-reader` como motor de política é aposentado de vez.
- **Risco central:** "não repetir pergunta" agora depende do estado injetado estar
  correto e completo. Cobrir com teste (as guardas de guardrail já existem).

### Fase 5 — Dor por contexto (fim do legado de site) · médio risco
- A geração de contexto do negócio passa a descrever a **dor daquele nicho**; o prompt
  para de assumir site. A IA conecta a solução (site/sistema/automação) à dor real.
- Mudança de geração de contexto + prompt, não de arquitetura.

### Fase 6 — SPIN formalizado + direção no JSON · baixo risco
- Formalizar SPIN no prompt (Situação → Problema → Implicação → Necessidade → reunião).
- A IA passa a devolver a **direção escolhida** no JSON (ex.: `direcao_proxima`), para o
  código/telemetria enxergarem o raciocínio comercial. `system-core.md` já faz uma versão
  fraca disso (parafrasear dor → conectar valor → reunião).

---

## 7. Riscos e decisões em aberto

1. **Escopo do corte no `turn-context-reader`.** Cirúrgico (só interesse/desinteresse,
   Fase 3) vs. aposentar o arquivo inteiro (Fase 4). Recomendação: cirúrgico primeiro,
   medir, depois Fase 4. Ripar tudo de uma vez arrisca o "nunca repetir pergunta".
2. **Regressão de "repetir pergunta".** É a maior ameaça funcional. Toda fase que mexe no
   rastreio de fatos precisa de teste antes do merge.
3. **Custo do modelo capaz por etapa.** A Fase 1 decide empiricamente; não teorizar.
4. **Contrato de JSON forçado no Claude.** Se migrar mais decisão para a IA, usar
   tool-use forçado para garantir JSON válido e reduzir os `[ai-repair]` retries.

---

## 8. Como validar cada fase

- `npm test` (guardrails de funil e regras de negócio já cobrem "não repetir pergunta").
- Amostra de conversas reais reprocessadas antes/depois (a IA marcou interesse/objeção só
  a partir da fala do lead? parou de cravar "site"?).
- `npm run typecheck` quando tocar `.ts`.

---

## 9. Resumo executivo

- A separação IA↔backend **já existe**; o que existe a mais é um **cérebro de regex** que
  decide o turno e manda a IA obedecer.
- O legado de "site" está **concentrado** nesse regex (`valor:'site'` cravado), não
  espalhado pelo backend.
- Medido em produção: a IA **já decide, mas o veredito é descartado** — `insights_lead`
  gravado em 0% dos perfis, e o `score` que sobra está descalibrado (§2.5).
- Não é rewrite. É: **(1)** exemplos + modelo barato, **(2)** persistir a saída da IA
  (pré-requisito), **(3)** matar o regex de interesse/desinteresse, **(4)** injetar o
  estado explícito no prompt, **(5)** dor por contexto, **(6)** SPIN. Barato → caro, uma
  fase por vez.
- O norte tem nome: **single-brain / LLM-as-router com Structured Outputs.** A IA decide,
  o código executa.
