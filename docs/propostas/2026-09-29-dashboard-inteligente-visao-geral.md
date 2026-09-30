# Dashboard inteligente na Visão Geral — plano/estruturação

> Data: 2026-09-29 · Status: **proposta (nada implementado)** · Autor: operador (ditado) + análise Claude
> Escopo: estruturar o painel de acompanhamento comercial pedido em ditado. Este documento é
> **planejamento**, não código. Nada foi alterado.

## 1. O que o operador pediu (destilado)

Um painel na Visão Geral que responda, **rápido e por filtro**, "o que está dando resultado?":

1. **Séries no tempo** (dia/semana/mês): quantas **ligações**, quantos **contatos por mensagem**
   (WhatsApp/wa.me) e quantas **reuniões**, ao longo do período.
2. **Distinção clara entre CONTATO por mensagem × CONTATO por ligação** — são coisas diferentes.
3. **Filtro por nicho** (ex.: "energia solar nesta semana") que reescreve todos os gráficos.
4. **Ranking de quem trouxe mais resultado** por canal, no nicho, na semana ("quem você ligou/
   contatou mais teve mais resultado").
5. **Taxas de conversão como número de topo**: "a cada 100 contatos → 7 reuniões", e mais fino:
   "a cada 7 ligações → 3 reuniões", "a cada 50 mensagens → 2 reuniões".
6. **Cruzamento por nicho + cidade**: "energia solar em Goiânia converte mais".
7. **Qual FONTE/CANAL converte mais**: Instagram × Anúncios Meta × Biblioteca Meta × WhatsApp.
8. **Visão por PESSOA e por EQUIPE**, com os mesmos números.
9. Camadas: **Visão mínima** logo de cara + aba **Detalhada** (abas trocando a área, no padrão
   `components/ui/Abas.tsx`). Não precisa tudo numa tela só; a leitura é o usuário quem faz — o
   painel só mostra o gráfico certo com o filtro certo.

## 2. O que JÁ existe para alimentar isso (mapa de viabilidade)

A boa notícia: **quase tudo já é dado capturado.** O trabalho é de **agregação e recorte**, não
de coleta nova. As fontes:

| Métrica | Fonte | Data p/ série | Dimensões disponíveis |
|---|---|---|---|
| **Ligações** (e resultado) | `app.vw_ligacoes_analiticas` (view já feita p/ "Painel de Gestão Comercial") | `encerrada_em` | `usuario_id`/`usuario_nome`, `campanha`, `prospect_id`, `resultado`, objeções, sinais |
| **Contato por mensagem** (WhatsApp + wa.me manual) | `prospectador.lead_disparos` | `rodado_em` | `prospect_id`, `status` (enviado/erro/sem_whatsapp) |
| **Reuniões (tela)** | `app.agenda_eventos` tipo `reuniao` | data do evento | `responsavel_id`, `venda_valor`, `prospect_id` |
| **Reuniões (bot/WhatsApp)** | `vendas.agenda_eventos` | data do evento | casa por **telefone** (não tem `empresa_id`/`prospect_id`) |
| **Nicho / cidade / canal** | `prospectador.prospects` via `prospect_id` | — | `nicho_id` (mig. 087), `cidade`/`uf`, `origem` (`google_places`/`instagram`/`meta_ads`/`linkedin`) |
| **Quem originou o lead** | `app.lead_responsavel_historico` (append-only, mig. 072) | — | atribuição estável mesmo após troca de dono |
| **Equipe** | `app.equipes_comerciais` por `nicho_id` (mig. 088) | — | agrupa pessoas por nicho |
| **Vendas / faturamento** | `app.vendas` (mig. 083) | `comissao_liberada_em` | valor, originador, competência |
| **Atribuição de anúncio (CTWA)** | `app.atribuicao_anuncios` (mig. 059) | — | `empresa_id`+`instancia`, `ctwa_clid` |

O **funil por nicho/cidade/canal** sai unindo os eventos (contato/ligação/reunião) ao **lead**
(que carrega nicho, cidade, origem) por `prospect_id`; a reunião do **bot** casa por telefone.

## 3. Lacunas e cuidados honestos (ler antes de prometer número)

Estes não são detalhes — mudam o que o painel pode afirmar sem mentir:

- **Duas agendas não unificadas — e o operador QUER que sejam dados SEPARADOS.** (2026-09-29)
  Reunião marcada na tela (`app.agenda_eventos`) e pelo bot (`vendas.agenda_eventos`) vivem em
  schemas diferentes; a do bot não tem `empresa_id` nem `prospect_id` (casa por telefone). O
  painel conta as duas mas as mostra **rotuladas** ("reunião humana" × "reunião pelo bot") — não
  soma cega. **Unificá-las continua projeto próprio** — aqui a agregação apenas lê e segmenta.
- **Reunião por PESSOA — o operador QUER, e são DUAS pessoas.** (2026-09-29) Ele quer ver "quem
  está **tratando** o lead" e "quem **marcou** a reunião". Feasibilidade:
  - **Quem trata** = dono do lead (`prospects.responsavel_id`, mig. 072) / dono da conversa
    (mig. 074). Existe hoje. ✅
  - **Quem marcou** = `agenda_eventos.criado_por` / `responsavel_id`. Limpo **daqui pra frente**
    (evento novo grava quem criou); **fraco pra trás** (`responsavel_id` nunca teve backfill,
    mig. 076). A do **bot** não tem pessoa.
  - Recomendação: painel por pessoa cruza **dono do lead** (tratando) + **criador do evento**
    (marcou), declarando que o histórico antigo é incompleto. `app.vendas` por **originador** dá
    o resultado financeiro por pessoa, que é o número mais firme.
- **"Contato" ≠ "atendeu".** Ligação registrada tem `resultado` (`nao_atendeu`, `sem_interesse`,
  …). "Contatou por ligação" deve contar só ligação que **falou com alguém**, senão a taxa de
  conversão mente. Mensagem enviada (`lead_disparos.status='enviado'`) é "contato tentado", não
  "conversou" — o painel deve rotular a diferença.
- **Decisão do operador (2026-09-29): "contato" é ADAPTATIVO pela instância.** Com a instância
  **ativada** (recebendo webhook), "contato" = **o lead respondeu de verdade** (mensagem inbound
  na conversa). Sem instância ativa (disparo/wa.me sem número recebendo), cai para **mensagem
  enviada**. O painel precisa **diferenciar visualmente** os dois ("conversou" × "só enviado").
  ✅ **Verificado (2026-09-29):** `vendas.conversas` tem `historico` (JSONB) e `atualizado_em`, mas
  **NÃO existe coluna de "primeira resposta"**. `vendas.followup_envios.resposta_lead_em` só cobre
  resposta a follow-up. Logo, "conversou" exige uma de duas coisas: (a) **derivar do `historico`**
  (checar mensagem inbound — scan, e só dá pra bucketizar por dia se as mensagens carregarem
  timestamp), ou (b) **adicionar `primeira_resposta_em`** preenchido pelo webhook daqui pra frente.
  **Decisão: v1 conta "enviado"** (`lead_disparos.criado_em`, limpo e indexado); "conversou" (G12)
  entra na **Fase 2** com uma dessas duas fontes.
- **Cruza schemas por telefone/`prospect_id`.** A normalização de telefone já tem dono
  (`sqlTelefoneNormalizado` em `src/telefone-br.js`); reusar, nunca reescrever.
- **Custo das agregações.** São `GROUP BY` sobre semanas × dimensões, com joins entre `app`,
  `prospectador` e `vendas`. Para v1, com o volume atual, roda direto. Se incomodar, o caminho é
  uma **materialized view** por (empresa, semana, nicho, cidade, canal, pessoa) — **não** cachear
  no front.

## 4. Estrutura proposta da tela

**Filtros globais** no topo (reescrevem tudo abaixo, no padrão do "Personalizar" do Banco de
Leads): **período** (semana/mês/intervalo) · **nicho** · **cidade** · **canal/origem** ·
**pessoa/equipe**. Estado em `sessionStorage` + querystring (padrão já usado na Aquisição).

Duas camadas via `components/ui/Abas.tsx`:

- **Visão mínima** (logo de cara): as 3~4 taxas de topo + a série da semana + o ranking curto.
- **Visão detalhada**: catálogo completo de gráficos abaixo.

## 5. Catálogo de gráficos (cada um com fonte e se é viável já)

| # | Pergunta | Gráfico | Fonte | Viável já? |
|---|---|---|---|---|
| G1 | Ligações/mensagens/reuniões ao longo da semana | Linhas ou barras por dia | ligações + disparos + agenda | ✅ |
| G2 | Contato por **mensagem** × por **ligação** | Barras lado a lado no tempo | disparos × ligações-atendidas | ✅ |
| G3 | **Taxa de topo**: a cada 100 contatos → N reuniões | Cartão de razão (número grande) | contatos ÷ reuniões no filtro | ✅ |
| G4 | Taxas finas: 7 ligações→3 reuniões · 50 msgs→2 reuniões | Cartões de razão por canal | por canal, no filtro | ✅ |
| G5 | **Nicho × cidade** que mais converte | Tabela/heatmap ordenável | leads(nicho,cidade) × reuniões | ✅ |
| G6 | Qual **canal/fonte** converte mais (IG/Meta/Biblioteca/WhatsApp) | Barras por `origem` c/ taxa | `prospects.origem` × reuniões | ✅ |
| G7 | **Ranking de pessoas** por resultado no nicho/semana | Barras horizontais | por originador (ver §3) | ⚠️ por originador, não por condutor |
| G8 | **Equipe**: mesmos números por pessoa da equipe | G1–G7 filtrados por equipe | equipes_comerciais + acima | ✅ |
| G9 | **Follow-ups → reunião** ("a cada 3 follow-ups marca reunião") | Cartão de razão | `app.follow_ups` × reuniões | ✅ |
| G10 | Faturamento originado no período por nicho/canal | Barras | `app.vendas` por originador | ✅ |
| G11 | Conversão por **tipo de abordagem** (ex.: mockup por IA × texto simples) | Barras c/ taxa por variante | **captura nova** (§6.1) | ❌ precisa capturar antes |
| G12 | "Conversou" × "só enviado" no tempo | Barras empilhadas | conversa inbound × disparo | ⚠️ depende do sinal de resposta (§3) |
| G13 | Reunião **humana** × reunião **pelo bot** | Barras segmentadas | `app` × `vendas` agenda | ✅ (rótulos separados) |

Reuso obrigatório: **G1, G2, G7 leem de `app.vw_ligacoes_analiticas`** — a view foi criada
exatamente para este painel ("o futuro Painel de Gestão Comercial lê SÓ daqui"). Não escrever SQL
de ligação por fora dela.

### 6.1. Captura NOVA necessária — tipo de abordagem (A/B de conversão)

O operador quer testar **abordagens** e medir qual converte mais (ex.: "esta semana mandei um
**mockup do site gerado por IA** para uns leads; converteu mais que os que receberam só texto?").

⚠️ **Isso não é capturável hoje.** `prospectador.lead_disparos` guarda `mensagem`, `status`,
`usuario_id`, `criado_em` — **não** guarda "que tipo de abordagem foi", nem se houve imagem/mockup.
**Não dá para reconstruir o passado**: só passa a existir a partir do dia em que for capturado.

**Decisão do operador (2026-09-29): PREPARAR, não RECEBER ainda.** O modelo de dados e o
vocabulário ficam prontos para receber a tag, mas **o sistema não vai capturá-la nesta rodada** —
o foco agora é o dashboard. G11 (A/B) nasce **prescrito, não ligado**: aparece no plano e no
layout, alimentado só quando a captura for ligada. Sem tag = "não marcado", nunca inventado.

- **Vocabulário inicial (operador):** `mockup` (mockup do site gerado por IA), `texto` (texto
  simples), `imagem` (imagem pronta). Lista aberta — o operador acrescenta (`email`, …) quando a
  captura entrar.
- Caminho lazy quando ligar: **uma coluna nullable `abordagem_tag TEXT`** (ou
  `metadata_json->>'variante'`) em `lead_disparos` / na abordagem manual (mig. 073), preenchida no
  disparo pelo seletor do "Rodar leads". O painel agrupa a conversão por `abordagem_tag`.
- ponytail: **não** criar tabela de "experimentos A/B". Um rótulo no disparo + `GROUP BY` cobre
  "essa variante converteu mais?". Motor de experimento (split automático, significância) só se um
  dia for pedido — não é o caso.
- A tag é **autodeclarada** (intenção do operador), como a abordagem manual da mig. 073. Medir
  "imagem realmente enviada" depende do produto enviar a imagem — ver §6.2.

### 6.2. PRESCRITO (não implementar) — mockup como última cartada + envio

Fluxo futuro descrito pelo operador (2026-09-29), **registrado para não se perder; NÃO construir
agora**: depois de N follow-ups + ligações sem retorno, a "última cartada" é **gerar um mockup do
site** e mostrar como ficaria, para acender interesse. O sistema juntaria informações do lead
(fotos/Instagram, dados do negócio), montaria rápido uma estrutura, e deixaria **para aprovação**;
aprovado → envia a imagem **+ uma mensagem de retorno**. Só depois disso a `abordagem_tag=mockup`
viraria "enviado de verdade" (não autodeclarado). **Escopo de uma fase própria, ao retomar o
assunto** — o dashboard não depende disso.

## 6. Ideias extras (registradas a pedido)

- **Regra de negócio no número, não na cor.** Toda taxa vem com o **denominador** ("7 reuniões /
  312 contatos"), nunca só "2,2%". Padrão que o projeto já exige (`BolinhaPontuacao`, `oQueMede`).
- **Comparação com o período anterior** (semana vs. semana passada): seta ↑/↓ com o número, não
  só cor. É o que transforma "acompanhar" em "está melhorando?".
- **"Onde o funil vaza"**: por nicho, mostrar contato→resposta→reunião→venda em barras que
  encolhem (funil). Diz em qual etapa perde, que é a pergunta seguinte a "quanto converte".
- **Custo por reunião por canal** (quando houver custo de anúncio Meta via `atribuicao_anuncios`):
  "reunião de Instagram custa X, de Meta Ads custa Y". Fica para quando o custo estiver ligado.
- **Objeção mais comum por nicho** — a view já traz `objecoes_texto`/`sinais_*`. "Energia solar
  objeta preço; estética objeta agenda." Ajuda o roteiro, não só o placar.
- **Cuidado anti-placar** (regra já firmada no projeto): ranquear por **resultado/faturamento
  pago**, nunca por "número de ligações/dia" — ranquear volume paga para ligar mal. A guarda de
  `equipe-painel.js` continua valendo.

## 7. Arquitetura mínima (lazy)

- **UM endpoint agregador**, não uma dúzia. `GET /api/empresas/:id/painel-comercial?periodo=&nicho=&cidade=&canal=&pessoa=&equipe=`
  devolve **um payload** com as séries e os agregados; o front alimenta todos os gráficos dele.
  Admin/gestor por capacidade (provável `RELATORIOS_VER`), no padrão das rotas existentes.
- **Regras puras** em `src/services/painel-comercial.js` (montagem das expressões de agregação e
  das razões), SQL em `src/db/painel-comercial.js`. Front só traduz (`frontend/lib/painel-comercial.js`).
- **Gráficos SEM dependência nova no v1.** KPIs, cartões de razão, funil e barras horizontais são
  CSS/`div`/SVG — o design system já tem tokens e escalas. A **única** coisa que justifica lib é
  linha temporal com muitas séries + tooltip rico; se chegar lá, adicionar **Recharts** (padrão
  React, uma dep) — e só então. `gsap` já está instalado para microanimação, se quiser.
  Consultar o skill `dataviz` antes de escolher cores/tipos.

> ponytail: v1 hand-rolled (tiles + CSS bars + funil + 1 SVG de linha). Recharts só quando a
> linha temporal multi-série com tooltip realmente doer — não antes.

## 8. Fases de entrega sugeridas

- **Fase 0 — NÃO ligar agora** (decisão do operador): a captura da `abordagem_tag` fica
  **preparada em modelo/vocabulário** (§6.1), não implementada. O foco é o dashboard.
- **Fase 1 (o foco — entrega valor sozinha):** filtros globais + G1, G2, G3, G4, G6, G13. Um
  endpoint, zero dep de chart. Responde "o que deu resultado esta semana, por nicho e por canal",
  já separando reunião humana × bot. G11 aparece no layout como **"aguardando captura"**.
- **Fase 2:** sinal de "conversou" + G12; G5 (nicho×cidade), G7/G8 (pessoa: trata + marcou),
  G9 (follow-up→reunião), comparação com período anterior.
- **Fase 3:** G11 (A/B por abordagem, quando a tag tiver acumulado dados), funil que vaza,
  objeções por nicho, faturamento (G10), custo por reunião por canal.
- **Fase 4 (só se a agregação doer):** materialized view por (empresa, semana, dimensões).

## 9. Decisões — respondidas pelo operador (2026-09-29)

1. ✅ **"Contato" é adaptativo pela instância** (respondeu × só enviado). Ver §3 e G12. **Abre 1
   verificação técnica**: definir o sinal de "primeira resposta" na conversa antes de prometer a
   taxa "conversou" (senão v1 usa "enviado" e "conversou" vai pra Fase 2).
2. ✅ **Reunião do bot conta, como dado SEPARADO** (rótulo próprio, sem soma cega). Ver §3 e G13.
3. ✅ **Resultado por pessoa: quem TRATA + quem MARCOU** — ambos. Ver §3. Limpo daqui pra frente,
   incompleto no histórico; declarar na tela.
4. ✅ **A/B por tipo de abordagem** — vocabulário inicial `mockup`/`texto`/`imagem`; sistema fica
   **preparado mas NÃO recebe ainda** (§6.1). G11 prescrito, não ligado.
5. ✅ **Mockup como última cartada + envio** — **prescrito, não construir** (§6.2). Fase futura.
6. ✅ **Foco agora = dashboard** (Fase 1).

### Ainda em aberto
- **Período padrão da Visão mínima:** assumo **semana corrente** (o resto vem por filtro).
- **"Conversou" (G12)** fica Fase 2; a fonte (derivar do `historico` × carimbo novo no webhook)
  se decide lá.
