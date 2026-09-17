# Análise — Enriquecimento de leads (atividade do negócio + Instagram) sob restrição de créditos

> **⚠️ ATUALIZADO EM 2026-09-17 — A SONDA FOI EXECUTADA E ESTE DOCUMENTO TEM PARTES VENCIDAS.**
>
> A Fase 2 (§3.1) rodou: `npm run instagram:sonda --handle=magazineluiza --confirmar`, 1 crédito,
> snapshot `sd_mu4s0dte1kezq4wylo`. **O dataset `ig_perfis` já devolve `posts_count` e um array
> `posts` com `datetime` em cada um** — além de `external_urls`, `biography`, `followers`,
> `is_private` e `is_verified`.
>
> **O que isso vence neste documento:**
> - **A etapa 4 (posts) NÃO EXISTE e foi removida do plano.** Vale o cenário otimista da §4:
>   **~120 créditos por rodada de 200 leads, ~39 rodadas** — não os ~720/6 rodadas.
>   A decisão **D da §11 está resolvida e encerrada**: não há dataset de posts a escolher.
> - A §6.3 previa `instagram_posts_json`/`instagram_posts_em`. **Essas colunas não foram criadas:**
>   os posts vêm dentro do registro de perfil, e `instagram_perfil_json` já os guarda.
> - A §2 desenha 5 etapas; **a implementação tem 2** (`instagram_descoberta`, `instagram_perfil`).
>   As etapas 1 e 5 do desenho eram leitura pura de dado já coletado e não precisam de fila.
> - O risco **§12.1 está encerrado** (o contrato foi visto) e o **§12.6 deixou de valer**: perfil
>   confirmado agora PODE ser medido quanto a atividade.
>
> **Risco NOVO, medido no mesmo dia e não previsto aqui:** a chave `GOOGLE_CSE_KEY` está
> **inválida** (`API_KEY_INVALID`), e o helper de busca engolia o erro devolvendo `[]` — o funil
> teria marcado a carteira inteira como "não tem Instagram". Corrigido; ver Decisão 2 de
> 2026-09-17 em `ai-decision-log.md`.
>
> **Atualização posterior, ainda em 2026-09-17:** o operador decidiu que a descoberta de
> Instagram da Aquisicao/enriquecimento deve usar **somente Bright Data**. As premissas deste
> documento sobre Google CSE ficam como histórico do risco medido, mas o fluxo atual usa Bright
> Data SERP (`BRIGHTDATA_SERP_ZONE`) para descoberta e Bright Data Instagram Scraper
> (`BRIGHTDATA_DATASET_IG_PERFIS`) para perfil. Ver a decisão "Descoberta de Instagram somente
> via Bright Data SERP" em `docs/ai-decision-log.md`.
>
> As §§1, 5, 7, 8 e 9 continuam válidas e foram seguidas. **O que foi implementado está descrito
> em `AGENTS.md`, seção "Enriquecimento de Instagram por LEAD".**

> **Status: ANÁLISE. Nenhum código foi escrito.** Este documento cumpre os 10 itens pedidos
> antes da implementação. As decisões pendentes estão na §11 e precisam do operador.
>
> Restrição declarada: **4.760 créditos gratuitos** na Bright Data, sem plano pago contratado.
> Prioridade: qualificar o máximo de leads com o mínimo de requisições.

---

## 0. Duas correções de premissa que mudam toda a matemática

Antes de qualquer desenho, dois fatos medidos no código que alteram a conta de créditos.

### 0.1 — A busca do Instagram **não** consome Bright Data

A descoberta de perfil (etapa 2 do fluxo pedido) foi implementada no commit `44b8721` usando
**Google Custom Search (CSE)**, não Bright Data. São moedas diferentes:

| Etapa | Fornecedor | Unidade de custo | Cota atual |
|---|---|---|---|
| Maps (coleta) | Bright Data | 1 crédito por registro | 4.760 restantes |
| Descoberta do Instagram | **Google CSE** | 1 query | **100/dia grátis**, depois ~US$5/1.000 |
| Perfil do Instagram | Bright Data | 1 crédito por registro | 4.760 restantes |
| Posts do Instagram | Bright Data | **provavelmente 1 crédito por post** — não confirmado | 4.760 restantes |

**Consequência prática:** a etapa 2 é gratuita em créditos Bright Data e **não precisa entrar na
cascata de economia deles**. Ela tem um teto próprio, mais apertado (100/dia), e por isso precisa
da sua própria trava — mas nunca compete com os 4.760.

Melhor ainda: para o lead que **já tem o Instagram no Google Meu Negócio**, a descoberta custa
**zero nas duas moedas** — é leitura de um link que já veio na coleta e está guardado em
`link_original` desde a migration 056. Essa é a otimização de maior alcance do projeto inteiro e
não depende de contratar nada.

### 0.2 — O maior risco de crédito hoje não é o enriquecimento: é a Aquisição, que não tem teto

Medido no código (§1.3): `pesquisarPlaces` **não consulta orçamento nenhum**. Uma rotina de
aquisição roda a cada 6h (mínimo) e importa até 200 leads por execução — **800 créditos/dia por
rotina ativa**, sem trava.

**Os 4.760 créditos se esgotam em ~6 dias com uma única rotina ativa**, antes de o enriquecimento
gastar o primeiro crédito. Qualquer orçamento para o pipeline novo é irrelevante enquanto essa
porta estiver aberta. **Tratar isto é pré-requisito, não melhoria** (§10, Fase 0).

---

## 1. Análise da estrutura atual

### 1.1 O que já existe e deve ser reusado

| Peça | Arquivo | O que já resolve |
|---|---|---|
| Cliente Bright Data | `services/brightdata-client.js` | trigger → progress → snapshot, timeout, erro tipado. **Agnóstico a dataset** (id vem por env). Serve os 3 scrapers sem alteração. |
| Fila assíncrona + custo | `prospectador.captacao_snapshots` (migration 012) | máquina de estados por snapshot, `custo_registros`, erro. |
| Fila da Aquisição | `prospectador.busca_snapshots` (024/053) | idem, + trava de **uma coleta paga ativa por empresa** (índice único parcial) e expiração por idade/tentativas. |
| Orçamento diário | `social-capture.js` (`tetoDiarioGlobal`, `consumidoHoje`, `orcamentoRestante`) | teto global + por campanha, já medindo em registros. **Só a captação social usa.** |
| Classificação de atividade no Maps | `services/google-business-activity.js` | etapa 1 do fluxo pedido **já está pronta**: status fechado/aberto, recência, faixas, pontos. |
| Registro cru da fonte | `fonte_bruta` em `places-brightdata.js` | preserva o payload inteiro da coleta — permite descobrir nome de campo depois, sem recoletar. |
| Veredito de perfil | `services/instagram-perfil.js` (commit `44b8721`) | etapa 2 **já está pronta**: prova de vínculo, 3 estados, revisão humana. |
| Descarte de fechados | `scripts/descartar-leads-fechados.js` | filtro da etapa 1 já implementado e executado. |
| Ledger com lease/backoff | `app.conversao_eventos` + `conversao_tentativas` (Meta) | **o padrão de retry a copiar** (§8). |

**Conclusão: ~70% da infraestrutura pedida já existe.** O que falta é o pipeline por lead, os dois
scrapers de Instagram e a contabilidade unificada de créditos.

### 1.2 O que NÃO existe

- **Pipeline por lead com status por etapa.** Hoje o estado é por *snapshot* (um lote), não por
  lead. Não há como dizer "o lead X está em `instagram_profile/failed`".
- **Contabilidade unificada de créditos.** O custo é contado em duas tabelas separadas
  (`busca_snapshots` e `captacao_snapshots`) e **não há saldo, nem consumo por tipo de scraper,
  nem por lead**.
- **Cache de perfil.** Nada impede re-raspar o mesmo `@` duas vezes.
- **Qualquer leitura de posts.** Nenhum código deste repositório lê `posts`, `posts_count` ou data
  de publicação do Instagram (verificado por varredura). A etapa 4 é terreno virgem.

### 1.3 Onde o dinheiro vaza hoje

| Ponto | Teto? | Risco |
|---|---|---|
| Aquisição / Maps (`pesquisarPlaces`) | **NÃO** | 800 créditos/dia por rotina. **O vazamento principal.** |
| Captação social | Sim (`BRIGHTDATA_CAPTACAO_TETO_DIARIO`, default 166) | controlado |
| Descoberta de Instagram (CSE) | **NÃO** | estoura 100/dia grátis em silêncio |

---

## 2. Desenho do fluxo

```
                          ┌─────────────────────────────────────────┐
LEAD (prospects)  ───────►│ 1. MAPS_ANALYSIS          0 créditos    │
                          │    google-business-activity.js          │
                          │    (dado JÁ coletado — nada de rede)    │
                          └────────────┬────────────────────────────┘
                                       │  fechado / sem nome ⇒ skipped
                                       ▼
                          ┌─────────────────────────────────────────┐
                          │ 2. INSTAGRAM_DISCOVERY                  │
                          │  2a. link no Google Meu Negócio         │
                          │      → 0 créditos, 0 queries  ◄── ideal │
                          │  2b. sem link → 1 query Google CSE      │
                          │      → 0 créditos Bright Data           │
                          └────────────┬────────────────────────────┘
                     não encontrado ⇒ skipped │ encontrado / incerto
                                       ▼
                          ┌─────────────────────────────────────────┐
                          │ 3. INSTAGRAM_PROFILE      1 crédito     │
                          │    dataset ig_perfis                    │
                          │    confirma existência + re-julga o     │
                          │    candidato com bio/telefone/site      │
                          └────────────┬────────────────────────────┘
                perfil inexistente ⇒ failed │ ainda incerto ⇒ human_review
                                       ▼
                          ┌─────────────────────────────────────────┐
                          │ 4. INSTAGRAM_ACTIVITY                   │
                          │    SE a etapa 3 já trouxe data ⇒ 0      │
                          │    SENÃO 1 chamada, N posts ⇒ N créd.   │
                          └────────────┬────────────────────────────┘
                                       ▼
                          ┌─────────────────────────────────────────┐
                          │ 5. FINAL_CLASSIFICATION   0 créditos    │
                          └─────────────────────────────────────────┘
```

**Regra que governa o pipeline: cada etapa só roda para quem sobreviveu à anterior.** Etapa que
não precisa rodar recebe `skipped` (com motivo), nunca `completed` — a diferença entre "pulei" e
"fiz e deu vazio" é o que permite auditar a economia depois.

---

## 3. Pontos de integração com a Bright Data

São **três** chamadas distintas, todas pelo `brightdata-client.js` existente:

| # | Etapa | Chave do dataset | Env | Estado |
|---|---|---|---|---|
| 1 | Maps (coleta) | `maps_descoberta` | `BRIGHTDATA_DATASET_MAPS_DESCOBERTA` | ✅ em produção |
| 2 | Perfil IG | `ig_perfis` | `BRIGHTDATA_DATASET_IG_PERFIS` | ⚠️ configurado (`gd_l1vikfch901nx3by4`) mas **nunca exercitado com lead do Maps** |
| 3 | Posts IG | **não existe** | **precisa ser criada** | ❌ dataset não escolhido |

**Nenhuma variável de ambiente nova além da do dataset de posts** — e ela só nasce se a §11.D
decidir que a etapa 4 existe.

### 3.1 A dependência que NÃO pode ser presumida (item 9 do pedido)

**Não sabemos o que o dataset `ig_perfis` devolve.** Os campos que o código conhece hoje
(`social-capture.js`) são: `account`, `user_name`, `full_name`, `followers`, `biography`,
`business_category_name`, `related_accounts`, `profile_url`, `external_url`. **Nenhum deles é
`posts_count` e nenhum é data de publicação.**

Isso é exatamente a situação que custou caro há uma semana: o adaptador do Maps chutou quatro
grafias de `latest_review_date`, 200 coletas foram pagas e **zero** trouxeram data (Decisão 1 de
2026-09-16, em `ai-decision-log.md`). O snapshot já havia expirado, então nem conferir era possível.

**Portanto a Fase 1 da implementação é uma SONDA de 1 perfil**, guardando o registro cru — o mesmo
remédio que `fonte_bruta` aplicou ao Maps. Custo: **1 crédito**. Ela responde de uma vez:

- o dataset devolve `posts_count`? → dá para detectar "perfil sem posts" sem a etapa 4
- devolve os posts recentes com timestamp? → **a etapa 4 inteira custa 0 e pode ser deletada do plano**
- devolve `is_verified`, `is_business`, cidade? → melhora a prova de vínculo de graça
- qual o nome real de cada campo? → o adaptador para de chutar

**Um crédito para decidir se a etapa 4 existe é o melhor investimento deste projeto.**

---

## 4. Estimativa de chamadas para 200 leads

**Unidade:** 1 crédito = 1 registro devolvido. É assim que o repositório já conta
(`const custo = registros.length`, `social-capture.js:405`). *Se a Bright Data cobrar por
critério diferente em algum dataset, a estimativa muda — e é por isso que o ledger da §6.2 grava
o número real devolvido, em vez de confiar nesta conta.*

Partindo de **200 leads já coletados** (o caso descrito: os leads já vieram do Maps):

| Etapa | Quantos entram | Créditos BD | Queries CSE | Observação |
|---|---|---|---|---|
| 1. Maps analysis | 200 | **0** | 0 | dado já em `raw_json`/`fonte_bruta` |
| — descarte de fechados | −2 (~0,9%) | 0 | 0 | proporção medida: 40 em 4.631 |
| 2a. IG do GMN | **≈ 24 (11,9%)** | **0** | **0** | **MEDIDO em 2026-09-16 — ver abaixo** |
| 2b. busca CSE | 198 − (2a) | **0** | 1 cada | teto de 100/dia |
| 3. Perfil | ~120 (estimado) | **~120** | 0 | 1 por perfil encontrado |
| 4. Posts | 0 **ou** ~120 | **0 ou ~600** | 0 | **depende inteiramente da sonda** |
| 5. Classificação | todos | 0 | 0 | puro |

### Os dois cenários

| | Créditos p/ 200 leads | Rodadas possíveis com 4.760 |
|---|---|---|
| **Sonda revela que o perfil já traz data de post** | **~120** | **~39 rodadas** (7.800 leads) |
| **Precisa da etapa 4, 5 posts por lead** | **~720** | **~6 rodadas** (1.200 leads) |

**A sonda de 1 crédito decide entre 39 e 6 rodadas.** É por isso que ela vem primeiro.

> **MEDIÇÃO EXECUTADA (2026-09-16, `npm run instagram:handles`, somente leitura).** De **4.604**
> leads sem handle, apenas **549 (11,9%)** trazem o Instagram no link do Google Meu Negócio —
> **cinco vezes menos** que os ~60% que este documento estimava. Os outros **4.055** dependem da
> busca por CSE.
>
> **Consequência: o gargalo deixou de ser o crédito da Bright Data e passou a ser a cota do
> Google CSE.** A 100 queries/dia no gratuito, varrer a base inteira leva **~41 dias**; uma rodada
> de 200 leads consome ~176 queries, ou **2 dias**. A decisão C (§11) deixou de ser detalhe.
>
> O número de perfis efetivamente encontrados (~120 de 198) continua sendo estimativa: depende da
> taxa de acerto do CSE, que só a primeira rodada real mede.

---

## 5. Estratégia para economizar créditos

### 5.1 Medir antes de gastar (custo zero)

Antes de qualquer chamada, um script **somente-leitura** no padrão já consagrado no repositório
(`medir:isolamento-empresa`, `medir:escopo-instancia`, `medir:qualificacao-lead`): `BEGIN
TRANSACTION READ ONLY` + `ROLLBACK`, `DATABASE_URL` explícita, só contagens agregadas, zero PII,
zero rede.

Ele responde, **de graça**, o que hoje é chute:

- quantos leads já têm Instagram no cadastro → esses saltam a etapa 2 inteira
- quantos estão fechados/inativos pelo Maps → esses nem entram
- quantos têm telefone ou site (prova forte disponível para a etapa 2)
- **quantos créditos a rodada vai custar, antes de começar**

`npm run instagram:handles` (já existe, simula por padrão) é metade dessa medição e pode rodar hoje.

### 5.2 As sete travas, em ordem de economia

1. **Aproveitar o link já pago.** Instagram no GMN ⇒ 0 créditos e 0 queries. É a maior economia e
   já está implementada — falta só rodá-la (`instagram:handles --aplicar`).
2. **Filtrar na etapa 1, que é grátis.** Fechado permanentemente, sem nome, sem nicho ⇒ `skipped`.
   Nunca chegam a consumir crédito.
3. **Cascata real:** etapa N+1 só vê quem a etapa N aprovou. Nada de rodar os três scrapers para
   todo mundo.
4. **Cache com TTL.** Perfil raspado há menos de N dias não é raspado de novo (§6.3). Reprocessar
   a carteira não repaga nada.
5. **Não repetir tentativa fracassada.** `nao_encontrado` não volta para a fila automática — só
   por ação humana explícita. (É o mesmo padrão de `cse_concorrentes_tentado_em` em `agent.js`.)
6. **Teto diário por etapa**, medido em créditos e conferido **antes** do trigger. Reusa
   `orcamentoRestante`, que já existe.
7. **Posts só quando indispensável**, e só os N mais recentes (N configurável, default 3). Se a
   etapa 3 já der a data, a 4 não roda.

### 5.3 O crédito que VALE gastar

Contra-intuitivo, mas importante: **raspar o perfil de um candidato "incerto" custa 1 crédito e
costuma eliminar a revisão humana.** A bio traz telefone e site — as duas provas fortes que a
busca por texto não tinha. Um crédito para converter "incerto" em "confirmado" ou "descartado"
sem ocupar uma pessoa é bom negócio.

Por isso a proposta é: **etapa 3 roda para `confirmado` E `candidato`**; só vai para revisão humana
quem continuar incerto **depois** do perfil. Isso inverte a ordem ingênua (revisar antes, raspar
depois) e reduz trabalho manual pagando pouco.

---

## 6. Estrutura de banco necessária

Três objetos novos, **todos aditivos**. Nenhuma tabela existente muda de forma.

### 6.1 Pipeline por lead e por etapa

`prospectador.enriquecimento_etapas` — **uma linha por (lead, etapa)**, não uma por lead. É o que
dá status próprio a cada etapa, retry independente e impede que a falha de um lead pare os outros.

```
id, empresa_id, prospect_id (FK → prospects ON DELETE CASCADE)
etapa      -- maps_analysis | instagram_discovery | instagram_profile
           --   | instagram_activity | final_classification   (CHECK fechado)
status     -- pending | processing | completed | failed | human_review | skipped
motivo     -- por que pulou/falhou, vocabulário fechado (não texto livre)
tentativas, proxima_tentativa_em, lease_ate
resultado_json            -- o REGISTRO CRU da fonte, sem interpretação
custo_creditos            -- o que ESTA etapa consumiu (0 nas etapas grátis)
snapshot_id               -- rastro até o lote da Bright Data
criado_em, atualizado_em
UNIQUE (prospect_id, etapa)
índice parcial (empresa_id, etapa, proxima_tentativa_em) WHERE status IN ('pending','failed')
```

`UNIQUE (prospect_id, etapa)` é a **antiduplicidade no banco**, não na aplicação — mesma disciplina
de `follow_ups_um_aberto_por_canal_uk` e da trava de coleta única por empresa.

### 6.2 Ledger de consumo (o `brightdata_requests` pedido)

`prospectador.brightdata_consumo` — **uma linha por requisição que consumiu crédito**:

```
id, empresa_id, prospect_id (nullable — coleta é de lote, não de lead)
scraper_type   -- maps_descoberta | ig_perfis | ig_posts   (CHECK fechado)
dataset_id, snapshot_id
registros      -- os créditos consumidos: o número REAL devolvido, nunca estimado
etapa_id       -- FK → enriquecimento_etapas, quando houver
criado_em
```

Com isso, `credits_used` é `SUM(registros)` por período/scraper/lead — as três perguntas do item 7
do pedido.

> **`credits_remaining` NÃO pode ser lido da API** (item 9: não presumir). O
> `brightdata-client.js` fala só com `/trigger`, `/progress` e `/snapshot`; nenhum deles devolve
> saldo, e a Bright Data não publica endpoint de saldo nesta API. **Proposta honesta:** uma tabela
> `brightdata_saldo` com o saldo que **você informa** (hoje: 4.760) e a data. O "restante" exibido
> é `saldo_informado − SUM(registros desde a data)`, e a tela **diz que é estimativa a partir do
> valor informado em tal data** — nunca apresenta como leitura oficial da Bright Data.

### 6.3 Cache de perfil — sem tabela nova

Colunas aditivas em `prospectador.prospects`, ao lado das que a migration 080 já criou:

```
instagram_perfil_json   JSONB   -- registro CRU do dataset ig_perfis (lição do fonte_bruta)
instagram_perfil_em     TIMESTAMPTZ
instagram_posts_json    JSONB   -- registro CRU dos posts, se a etapa 4 existir
instagram_posts_em      TIMESTAMPTZ
instagram_atividade     TEXT    -- ATIVO_RECENTE | ATIVO_MODERADO | POUCO_ATIVO
                                --   | INATIVO | SEM_POSTS | INCERTO   (CHECK fechado)
instagram_ultimo_post_em TIMESTAMPTZ
```

O cache é a regra "não raspar de novo o que foi raspado há menos de N dias", lida dessas datas.
**Tabela separada seria indireção sem ganho**: o perfil pertence ao lead e a unicidade do handle
por empresa já é garantida pela rota (409).

### 6.4 Limites configuráveis (30/90/180 dias)

Módulo **PURO** com os defaults + override por empresa. Não vira variável de ambiente: os limites
são regra de negócio por operação, e env seria global. Fica um JSONB em
`app.banco_leads_config` (tabela que já existe e já guarda config por empresa) — **sem migration
de tabela nova**.

---

## 7. Tratamento de erros

**Princípio: falha de um lead nunca para os outros.** Linhas independentes + `FOR UPDATE SKIP
LOCKED` (o padrão que `meta-dispatch.js` já usa).

| Erro | Classificação | Ação |
|---|---|---|
| Perfil não existe (404/vazio) | **permanente** | `completed` com `motivo='perfil_inexistente'`. É resposta, não falha — e é informação de negócio. |
| Dataset recusa o input | **permanente** | `failed`, para o lote inteiro da etapa, alerta. Contrato errado: insistir queima crédito. |
| Token inválido / sem crédito | **permanente e GLOBAL** | pausa o pipeline inteiro. Continuar geraria N falhas idênticas. |
| Timeout / 5xx / 429 | **transitório** | volta para `pending` com backoff (§8) |
| Snapshot preso em `running` | **transitório com teto** | expira por idade (3h, como `busca_snapshots`) |
| Prova insuficiente | **não é erro** | `human_review` |

**Regra de ouro herdada do ledger da Meta:** o trigger é registrado **antes** da chamada externa e
o custo é gravado **com o número real de registros devolvidos**. Nunca existe consumo pago sem
linha no ledger — é o que torna a contabilidade confiável quando a rede falha no meio.

---

## 8. Estratégia de retry

Cópia do padrão já validado em `app.conversao_eventos`:

- **Lease** de 10 min (`lease_ate`) + `FOR UPDATE SKIP LOCKED` — dois workers não pegam o mesmo lead
- **Backoff** 1 / 5 / 25 / 120 / 360 / 720 min
- **Teto de 6 tentativas** ⇒ `failed` definitivo, com motivo
- **Chamada externa FORA da transação** — o banco não fica preso esperando a rede
- **Só erro transitório faz retry.** Permanente não volta para a fila: seria pagar de novo pela
  mesma recusa.
- **Retry NUNCA re-raspa o que já foi pago.** Se o snapshot voltou e o erro foi ao gravar, o retry
  relê o snapshot existente (via `snapshot_id`), não dispara outro trigger.

---

## 9. Sistema de revisão humana

Reusa inteiramente o que o commit `44b8721` já entregou — `instagram_confianca = 'candidato'`,
os sinais que bateram e os que não bateram, e os botões "É este / Não é este / Informar à mão" no
modal de Detalhes.

O que o pipeline acrescenta:

1. **Revisão só DEPOIS do perfil** (§5.3): o scrape barato resolve a maioria dos incertos sozinho.
2. **`human_review` é status de etapa**, não fim de linha: decidida, a etapa vira `completed` e o
   lead **retoma o pipeline** na etapa seguinte.
3. **Fila de revisão** — filtro "Instagram a confirmar" no Banco de Leads, para despachar em lote
   em vez de abrir lead por lead. (O índice parcial da migration 080 já existe para isso.)
4. **Nenhuma decisão humana é sobreposta por worker.** Mesma disciplina de `qualificacao`: a
   recoleta nunca rebaixa o que uma pessoa decidiu.

---

## 10. Proposta de implementação (fases)

| Fase | O que | Custo | Por quê nessa ordem |
|---|---|---|---|
| **0** | **Teto de crédito na Aquisição** (§0.2) + ledger §6.2 + saldo informado | 0 | Sem isso, 800 créditos/dia vazam e o resto é decoração |
| **1** | **Medição read-only** (§5.1) + rodar `instagram:handles` | 0 | Dimensiona o funil e colhe o Instagram já pago |
| **2** | **SONDA: 1 perfil, guardando o registro cru** (§3.1) | **1 crédito** | Decide se a etapa 4 existe — entre 39 e 6 rodadas |
| **3** | Pipeline §6.1 + etapas 1, 2 e 5 (as grátis) | 0 | Estrutura completa sem gastar nada |
| **4** | Etapa 3 (perfil) com teto e cache | ~120 / rodada | Só depois da sonda |
| **5** | Etapa 4 (posts) — **só se a sonda disser que é necessária** | 0 ou ~600 | Pode ser cancelada pela Fase 2 |

**As fases 0 a 3 não gastam crédito nenhum** e já entregam: teto de segurança, contabilidade,
medição, Instagram do GMN aproveitado e o pipeline inteiro montado. A Fase 2 custa 1 crédito e
decide o desenho das duas últimas.

---

## 11. Decisões pendentes (precisam do operador)

**A. A Fase 0 entra primeiro?** A Aquisição sem teto é o maior consumidor e não faz parte do que
foi pedido. Recomendo tratá-la antes — mas ela pode **reduzir o volume de coleta** que você tem
hoje, e isso é decisão de negócio, não técnica.

**B. Qual o teto diário de créditos para o enriquecimento?** Sugestão: 150/dia (≈1 rodada de 200
leads a cada 2 dias, ~31 dias de autonomia com os 4.760).

**C. Teto diário de queries CSE? — VIROU A DECISÃO MAIS IMPORTANTE.** Com só 11,9% vindo de
graça, o CSE deixou de ser complemento e passou a ser o canal principal de descoberta. No
gratuito (100/dia): 2 dias por rodada de 200, ~41 dias para a base inteira. No pago
(~US$5/1.000): os 4.055 leads custariam ~US$20 de uma vez. **Esta decisão agora pesa mais que o
teto de créditos.**

**D. Quantos posts na etapa 4**, se ela existir? Sugestão: 3 (suficiente para a data do mais
recente, com folga para post fixado no topo).

**E. Os limites 30/90/180 estão certos** para o seu mercado, ou quer outros?

**F. O enriquecimento roda automático na coleta, ou por comando?** Automático é o que você pediu;
com teto diário, o excedente simplesmente espera o dia seguinte.

---

## 12. Riscos declarados

1. **O contrato do dataset `ig_perfis` é desconhecido.** Mitigado pela sonda (Fase 2). **Não
   escrever o classificador antes dela** — é literalmente o defeito de 2026-09-16.
2. **Créditos podem não ser 1 por registro em todo dataset.** O ledger grava o número real
   devolvido, então a contabilidade se corrige sozinha; a *estimativa* da §4 é que pode errar.
3. **O saldo restante é estimativa local**, não leitura da Bright Data (§6.2).
4. **Raspar Instagram tem risco de bloqueio/ToS** — a Bright Data absorve isso, mas um dataset
   descontinuado derruba as etapas 3 e 4. As etapas 1, 2 e 5 continuam funcionando sem elas.
5. ~~A proporção de leads com Instagram no GMN é chute (~60%).~~ **MEDIDO em 2026-09-16: 11,9%** (549 de 4.604). O risco virou outro — a taxa de acerto do CSE sobre os 4.055 restantes segue desconhecida, e é ela que define quantos perfis chegam à etapa 3.
6. **Perfil confirmado ≠ perfil ativo** enquanto a etapa 4 não existir. O sistema hoje diz isso
   explicitamente e não deve parar de dizer.
