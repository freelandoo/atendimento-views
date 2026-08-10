# Análise — indicador reutilizável de pontuação (bolinha + explicação)

> **Status: ANÁLISE. Nada foi implementado.** Nenhum arquivo de código, schema, rota ou dado
> foi alterado. Fase 0 registrada em [ai-task-start-log.md](ai-task-start-log.md).
> Data: 2026-08-08 · Escopo: Central de Ligações, Central de Mensagens, Aquisição, Banco de Leads.

**Princípio que guia tudo abaixo:** o *componente* é único; a *pontuação* não é. A mesma
bolinha em duas telas nunca pode sugerir que 72 significa a mesma coisa nas duas.

---

## 1. Resumo executivo

O produto **já tem** o indicador — três vezes, com implementações diferentes, e uma delas com
a paleta invertida. Também já tem, no backend, os **fatores auditáveis** de todas as quatro
pontuações envolvidas. Portanto isto não é "criar um indicador": é **consolidar um que se
fragmentou** e estendê-lo a duas telas que exibem pontuação sem explicá-la.

O achado que mais muda o desenho pedido: **na Aquisição e no Banco de Leads a pontuação
visível hoje ("Pontos") é COMPLETUDE DE CADASTRO, e ela anda ao contrário do potencial
comercial** — cadastro fraco é oportunidade forte. A própria tela já assume isso: a Aquisição
ordena por `pontos ASC` por padrão (`prospeccao/page.tsx:166`). Uma bolinha verde/vermelha
igual à da Central de Ligações nessas telas diria exatamente o oposto do que o operador deve
entender.

### Tabela de decisão

| Área | Decisão | O que a bolinha mede ali | Por quê |
|---|---|---|---|
| **Central de Ligações** | **Aplicar agora** — extrair o que já existe, sem mudar comportamento | Prioridade de ligação nesta campanha (0–100) | É a única implementação completa e acessível. Vira a referência; o resto passa a consumi-la. |
| **Central de Mensagens** | **Aplicar agora** — trocar `InteresseBadge compact` pelo componente | Interesse comercial do lead (0–100) | Score, faixa, rótulo, resumo **e critérios** já existem e já viajam na API. Hoje a bolinha existe mas é inacessível (só `title`) e esconde os critérios. |
| **Aquisição** | **Aplicar agora, com escala e cor PRÓPRIAS** (não a de prioridade) | Completude do cadastro (0–100) | Os critérios já vêm prontos do backend. Mas exige resolver dois conflitos reais: as **duas** pontuações na mesma linha e a **direção invertida** da leitura. |
| **Banco de Leads** | **Parcial: aplicar agora para "Pontos"; NÃO aplicar para "potencial de abordagem"** | Completude do cadastro (0–100 / 0–60) | Mesma fonte da Aquisição, reuso direto. Já "potencial de abordagem" **não tem fonte** nesta tela — exigiria decisão de negócio (§7.1). |

---

## 2. Inventário: o indicador que já existe (3 variantes)

| # | Onde | Geometria | Interação | Acessibilidade | Conteúdo da explicação |
|---|---|---|---|---|---|
| 1 | `central-ligacoes/page.tsx:198-249` — `CirculoPrioridade` | `h-9 w-9 rounded-full border-2`, número dentro | hover + **foco por teclado**; tooltip em **portal no `<body>`**, posicionado por `getBoundingClientRect`, fecha em scroll/resize, anima em 2 frames | `tabIndex=0`, `aria-label` completo, `title` de fallback, `role="tooltip"`, `pointer-events-none`, círculo interno `aria-hidden` | `faixa_label · score/100` + **lista de `motivos[]`** |
| 2 | `components/ConversaPainel.tsx:125-154` — `InteresseBadge compact` | `h-9 w-9 rounded-full border-2`, número dentro (**geometria idêntica à #1**) | **só `title=`** (hover nativo) | sem `tabIndex`, sem `aria-label`, sem `role` | `label - resumo` (uma linha). **Os `criterios[]` existem e ficam de fora** |
| 3 | `follow-ups/page.tsx:527-532` | `h-2.5 w-2.5`, **sem número** | só `title=` | `role="img"` + `aria-label` (`descricaoPrioridade`, `lib/followups-fila.js:491`) | uma frase; vazada quando não há faixa calculada |

**Divergência de cor já instalada** (isto é um defeito, não uma escolha por contexto):

| Faixa | Ligações (`FAIXA_CLS:173`) | Mensagens (`INTERESSE_STYLE:110`) | Follow-ups (`PRIORIDADE_DOT:76`) |
|---|---|---|---|
| alta / alto | emerald | emerald | **red** |
| média / médio | amber | amber | amber |
| baixa / baixo | slate | slate | **sky** |

Em Follow-ups o vermelho quer dizer "mais urgente"; nas outras duas, verde quer dizer "melhor".
Um componente único **obriga** a decidir isso — está listado como decisão pendente em §7.3.

**Não existe** tooltip/popover compartilhado em `frontend/components/ui/` (há `Abas`,
`ModalConfirmar`, `StatusPill`, `DataTableFrame`, `JsonLeadModal`, `icons`). O único tooltip
acessível e posicionado do projeto é o inline da Central de Ligações.

---

## 3. As quatro pontuações do produto — não são intercambiáveis

| Pontuação | Fonte | Escala | Pergunta que responde | Direção | Fatores (auditáveis?) |
|---|---|---|---|---|---|
| **Prioridade de ligação** | `services/ligacao-prioridade.js:137` | 0–100 | "Quanto vale ligar para este negócio **agora, nesta campanha**?" | maior = melhor | `motivos[]` ✅ |
| **Interesse comercial** | `services/lead-interest-score.js:90` | 0–100 (com deltas negativos) | "Este lead está dando sinal de compra?" | maior = melhor | `criterios[]` com `delta`/`titulo`/`detalhe`/`tipo` ✅ |
| **Cadastro (Pontos)** | `services/lead-score-cadastro.js:74` (Places) e `:166` (Instagram) | 0–100 / **0–60** | "Quão completa é a presença digital deste negócio?" | **maior = MENOS oportunidade** | `criterios[]` com `ok`/`pontos`/`pontos_possiveis` ✅ |
| **Score do prospect** | `prospecting.js:243` (`calcularScoreProspect`) | 0–100 | "Quão promissor era este lead **quando foi coletado**?" | maior = melhor | `motivo_score` (texto livre, congelado na coleta) ⚠️ |

Detalhes que importam para o desenho:

- **Prioridade ≠ cadastro.** O próprio módulo declara isso (`ligacao-prioridade.js:7-9`): "ela
  não substitui `prospects.score`… aqui a pergunta é outra". Site próprio **derruba** a
  prioridade (peso 0) e **soma 20** no cadastro. São vetores opostos sobre o mesmo lead.
- **Interesse tem sinal negativo.** `-45` por recusa, `-25` por postergar, `-25` por 7 dias sem
  resposta. Uma bolinha que só mostra o total esconde a diferença entre "38 porque nunca
  engajou" e "38 porque engajou muito e depois recusou". Os `criterios[]` resolvem isso — e é
  justamente o que a variante #2 não mostra hoje.
- **Instagram vai só até 60.** `score_cadastro_max` já vem na API; a bolinha **precisa** exibir
  `x/máx`, nunca assumir 100. A tabela de Instagram do Banco de Leads já faz isso
  (`banco-leads/page.tsx:1748`).
- **`prospects.score` é congelado na coleta.** É calculado em `mapearPlace`
  (`prospecting.js:1047`) e persistido; nunca recalculado na leitura. Um lead coletado antes da
  correção da classificação de site carrega um número de outra régua. **Não recomendo** promovê-lo
  a bolinha (§4.3).

---

## 4. Análise por área

### 4.1 Central de Ligações — a referência

**Fonte:** `db/campanhas.js:254` → `montarFilaPriorizada` → `calcularPrioridade` por lead.
Isolamento: rota admin-only + `requireEmpresaAccess`; a fila é sempre escopada na campanha da
empresa. **Ordena a fila inteira no servidor**, e a tela nunca reordena.

**O que a pontuação significa aqui, confirmado no código:** prioridade **comercial de ligação
dentro de uma campanha de criação de site** — não é qualidade do lead nem qualidade da conversa.
Pesos: sem site próprio 40 · avaliações até 20 · nota até 10 · rede social sem site 10 · nenhuma
tentativa 10. Faixas: ≥60 alta, ≥35 média (`ligacao-prioridade.js:49-50`).

**O que é reutilizável (vira o componente):**
- geometria `h-9 w-9`, borda 2px, número centralizado, `hover:scale-105`;
- tooltip em portal no `<body>` com posicionamento por rect — foi a correção de um defeito real
  (o comentário em `:193-197` registra que a versão anterior, `position:absolute` dentro do
  `<td>`, era cortada pelo wrapper `overflow-hidden` da tabela);
- fechar em scroll/resize; animação de 2 frames; `pointer-events-none`;
- contrato de acessibilidade: wrapper focável com `aria-label` + `title`, círculo `aria-hidden`,
  `role="tooltip"` no balão;
- estado vazio: `—` quando não há pontuação (`:224`).

**O que é exclusivo da Central de Ligações (NÃO vai para o componente):**
- os pesos e as faixas (60/35) — são desta campanha;
- os rótulos `Alta/Média/Baixa prioridade`;
- a paleta `emerald/amber/slate` como *significado* (a paleta pode ser um preset; o mapeamento
  faixa→cor é decisão da página);
- `situacao_site` dentro de `prioridade` — é payload desta fila.

**Decisão: aplicar agora.** Extrair sem alterar uma linha de comportamento visível. Ganho
imediato: as outras telas herdam a acessibilidade e o posicionamento que só existem aqui.

---

### 4.2 Central de Mensagens — interesse comercial

> ⚠️ **A tela está em refatoração não commitada neste working tree:**
> `components/ConversaPainel.tsx` e `lib/lead-identidade.js` são novos (untracked) e
> `conversas/page.tsx` está modificado. Toda a análise abaixo parte do estado **novo**.

**Existe dado confiável de interesse?** **Sim, e já está na tela.** `api-conversas.js:32-47`
(`anexarScoreInteresse`) anexa em **todas** as linhas da lista e no detalhe:
`score_interesse`, `_faixa`, `_label`, `_resumo`, `_criterios[]`, `_mensagens_lead`.
Calculado na leitura por `calcularScoreInteresseLead`, a partir do histórico + perfil do lead.

**Fatores que já compõem** (nada precisa ser inventado — `lead-interest-score.js:106-177`):
pediu preço/proposta (+22) · indicou próximo passo (+25) · falou de reunião (+18) · dor concreta
(+15) · intenção/produto (+10) · urgência (+15/+8) · decisor/orçamento (+8/−10) · negócio
identificado (+5) · temperatura (+10/+5/−5) · etapa comercial (+15/+6) · engajamento por volume
de mensagens (+12/+8/+2) · resposta com contexto (+8) · **recusou (−45)** · **postergou (−25)** ·
**bloqueio financeiro (−18)** · respostas muito curtas (−12) · silêncio >72h (−15) / >7d (−25).
Faixas: ≥70 alto, ≥40 médio (`:76-80`).

**O que muda com o componente:**
1. a bolinha da coluna "Interesse" (`conversas/page.tsx:247`) passa a ser **focável por teclado
   e anunciada por leitor de tela** — hoje é só `title`;
2. o tooltip passa a mostrar os **critérios com sinal** (`+25 Indicou próximo passo`,
   `−25 Postergou`), em vez do resumo genérico de uma linha. É a diferença entre "interesse 38"
   e "interesse 38 porque recusou depois de pedir preço";
3. o mesmo componente serve o cabeçalho "Prioridade comercial" do painel
   (`ConversaPainel.tsx:420`), hoje uma segunda chamada do mesmo badge.

**Tooltip proposto (conteúdo, não implementação):**
> **Interesse alto · 78/100**
> O que o lead demonstrou nas mensagens dele.
> `+25` Indicou próximo passo de compra
> `+22` Pediu preço, proposta ou condições
> `−15` Sem resposta há mais de 72h
> _12 mensagens do lead analisadas_

**Ajuda a priorizar sem substituir o essencial?** Sim — a lista já ordena por
`score_interesse` desc (`conversas/page.tsx:132`) e já filtra por temperatura. A bolinha
**explica** a ordem que a tela já usa. Temperatura, estágio, status e atualização continuam
como colunas próprias (§5.2): temperatura é classificação do perfil, interesse é leitura do
texto — não são a mesma coisa e uma não pode engolir a outra.

**Riscos declarados:**
- **Custo de leitura:** o score é recalculado a cada `GET`, sobre o histórico inteiro, para até
  100 conversas por página. Já é assim hoje — a bolinha **não piora** nada, mas não conte com ela
  para reduzir carga.
- **Escopo:** `api-conversas.js:16-19` mantém o fallback da PJ
  (`$1::uuid = $2::uuid AND c.empresa_id IS NULL`). Não é criado por esta proposta, mas é o
  universo de onde o número sai — registrado aqui porque o pedido exige confirmar isolamento.
- **É heurística de regex sobre texto do lead.** O tooltip deve dizer *o que* foi detectado
  (o `detalhe` já traz um trecho da fala), para o operador poder discordar.

**Decisão: aplicar agora.**

---

### 4.3 Aquisição — resumir colunas

**Estado atual da tabela** (`prospeccao/page.tsx:470-483`) — **14 colunas**:
Entrou em · Nome · Telefone · E-mail · Endereço · Nicho/Cidade · Aval. · Nota · Horário · Site ·
Pontos · Status · **JSON** · Ações.
Paginação de 25 no **servidor**, com ordenação no servidor por mapa fechado
(`ORDEM_SQL_PROSPECTS`, `prospecting.js:1232`); `pontos` e `horario` têm caminho calculado
próprio (`idsPorOrdemCalculada`).

**Fonte da pontuação:** `calcularScoreCadastroPlaces`. **Os critérios já vêm na resposta**
(`prospecting.js:1422`, `score_cadastro_criterios`) — o tipo do frontend nem os declara hoje.
São 9: site próprio 20 · fotos 10 · endereço 10 · telefone 10 · e-mail 10 · horário 10 · links
extras 10 · tem avaliações 10 · nota > 4 10.

**Dois conflitos reais, e é por isso que aqui não basta copiar a bolinha de Ligações:**

1. **Há DUAS pontuações na mesma linha e a tela não diz que são duas.** O emoji de temperatura
   (`:494`, vindo de `p.score`) e a coluna "Pontos" (`:521`, `score_cadastro`). Escalas
   diferentes, origens diferentes, **direções opostas**. Recomendação: **manter apenas o
   cadastro como bolinha** e **remover o emoji de temperatura** — ele deriva de um score
   congelado na coleta, cuja explicação (`motivo_score`) é texto livre de outra régua. Isso é
   remoção de informação: §5.1 registra para onde ela vai.
2. **A leitura é invertida.** Cadastro alto = menos oportunidade. A cor **não pode** ser
   verde=bom/vermelho=ruim como em Ligações. Hoje o código já faz `≤40 vermelho`,
   `≤70 âmbar`, `>70 esmeralda` (`:521`) — ou seja, **hoje a tela pinta de vermelho justamente
   o melhor lead da campanha**. O componente deve permitir uma paleta "neutra/completude"
   (§6) e o rótulo tem de ser explícito: *"Cadastro incompleto — 3 lacunas"*, não "baixa".

**Tooltip proposto:**
> **Cadastro incompleto · 40/100**
> Quanto da presença digital deste negócio já está preenchida no Google.
> ✓ Tem telefone · ✓ Tem endereço · ✓ Tem avaliações · ✓ Tem fotos
> ✗ Site próprio (+20) · ✗ E-mail (+10) · ✗ Horário (+10) · ✗ Links além do site (+10) · ✗ Nota > 4 (+10)
> _Cadastro fraco costuma ser a melhor oportunidade nesta operação._

Essa última linha é o que impede a bolinha de mentir. Ela é texto fixo da página, não regra.

**Decisão: aplicar agora**, com escala/paleta próprias, e resolvendo os dois conflitos acima.

---

### 4.4 Banco de Leads — priorização e leitura rápida

**Estado atual:** duas tabelas (Places e Instagram), **14 colunas alternáveis**
(`COLUNAS_TOGGLE:316-331`) + nome e JSON fixos, filtros client-side, presets, ordenação global,
tudo persistido em `localStorage` (`bancoLeadsView`). Fetch único ≤1000 leads, sem paginação.

**Campos que existem e apoiam priorização** (`api-banco-leads.js:140-189`):
`score` · `score_cadastro` / `score_cadastro_max` · `situacao_site` (+ `_label`) · `rating` ·
`avaliacoes` · `tem_whatsapp` · `proximo_agendamento` · `rodado_em` · `ultimo_status` ·
`bloqueado_ate` / `bloqueio_motivo` · `mensagem_gerada` · `seguidores`.

**A hipótese do pedido mistura dois conceitos — e é preciso separá-los:**

- **Completude do cadastro** → **fonte existe, é a mesma da Aquisição**, e a tela já a exibe como
  "Pontos" com o mesmo esquema de cor invertido (`:1670` Places, `:1744` Instagram).
  Os critérios chegam dentro de `json_apresentacao.pontuacao.criterios`
  (`api-banco-leads.js:179/187`). **Aplicar agora, reusando exatamente o que a Aquisição usar.**
  Atenção: aqui há **duas escalas** (100 e 60) — `score_cadastro_max` é obrigatório no contrato.
- **Potencial de abordagem** → **não há fonte nesta tela.** A única função do produto que responde
  "vale abordar agora" é `montarFilaPriorizada`, e ela só é chamada em `db/campanhas.js:254`
  (fila de ligações, dentro de uma campanha). Estendê-la ao Banco de Leads significa decidir que
  a prioridade **de ligação em campanha de site** vale como prioridade **de disparo de WhatsApp**
  fora de campanha — isso é decisão de negócio, não de UI (§7.1). **Não aplicar agora.**

**Não misturar os dois numa bolinha só.** Uma bolinha que somasse completude com potencial
produziria um número que ninguém consegue explicar em uma frase — o que reprova no próprio
critério de recomendação do pedido.

**Decisão: parcial.** Bolinha de cadastro agora; potencial de abordagem, depois da decisão §7.1.

---

## 5. Colunas: o que sai, para onde vai, e o que fica

**Regra que segui:** nada sai da tabela sem destino declarado, e nada que decide *ação* sai.

### 5.1 Aquisição

| Coluna | Proposta | Para onde a informação vai |
|---|---|---|
| **Aval.** | vira contextual | tooltip da bolinha (critério "Tem avaliações") **+ continua ordenável pelo cabeçalho** — a ordenação por `aval` é do servidor (`ORDEM_SQL_PROSPECTS`) e não depende da coluna estar visível |
| **Nota** | vira contextual | idem (critério "Nota > 4"); mesma ressalva de ordenação |
| **Horário** | vira contextual | tooltip (critério "Tem horário de funcionamento") |
| **Endereço** | vira contextual | tooltip (critério "Tem endereço"); o valor completo já está no painel de detalhes/JSON |
| **Emoji de temperatura** (dentro de Nome) | **remover** | é `p.score`, congelado na coleta, com explicação em texto livre (`motivo_score`) de outra régua. Substituído pela bolinha de cadastro, que é recalculada na leitura |
| **JSON `{ }`** | **remover da tabela operacional** | vira um botão "Ver dados completos" dentro do painel de detalhes do lead. O `JsonLeadModal` **continua existindo** — ele carrega o *prompt unificado*, que é ferramenta real; o que sai é o `JSON.stringify` cru numa coluna da tabela de trabalho |
| **Pontos** | **vira a bolinha** | permanece, com explicação |
| Entrou em · Nome · Telefone · E-mail · Nicho/Cidade · Site · Status · Ações | **ficam** | — |

Resultado: 14 → 9 colunas (Entrou em · Nome · **Pontuação** · Telefone · E-mail · Nicho/Cidade ·
Site · Status · Ações).

**Fica visível de propósito, mesmo podendo ser resumido:**
- **Telefone** — é o meio de contato e decide se o lead é acionável;
- **Nicho / Cidade** — é o mercado; o operador filtra e escaneia por ele;
- **Site** — é a *tese comercial* da operação, e o link tem rótulo próprio
  (`lib/site-rotulos.js`) que o distingue de rede social. Esconder isso reintroduziria, por UX,
  a confusão que a classificação canônica corrigiu;
- **Status** — governa quais ações aparecem na linha;
- **E-mail** — é editável in-loco (`EmailEditavel`); dentro de tooltip não seria editável.

### 5.2 Banco de Leads

O Banco de Leads **já resolve a densidade com o "⚙ Personalizar"** (toggle por coluna,
persistido). Não recomendo remover colunas aqui — recomendo **mudar o padrão**:

| Coluna | Proposta |
|---|---|
| **Pontos** | vira a bolinha (com `score_cadastro_max`, 100 ou 60) |
| Aval. · Nota · Horário · Endereço · Links | **desligadas por padrão**, continuam no "⚙ Personalizar" e no tooltip |
| Entrou em · Nome · Telefone · Envio · Nicho/Cidade · Site · Status · Seguidores (IG) | ficam ligadas |
| **JSON `{ }`** | mesma recomendação da Aquisição: sai da tabela, vai para o painel de detalhes |

Trocar o default é reversível pelo próprio operador, o que torna a mudança bem menos arriscada
que remover a coluna do código.

### 5.3 Central de Mensagens

**Nada sai.** A tabela tem 8 colunas e todas decidem algo: Lead · Telefone · Temperatura ·
Interesse · Estágio · Status · Atualizado · Ações. A mudança é **qualitativa** — a coluna
"Interesse" ganha explicação acessível.

### 5.4 Central de Ligações

**Nada sai.** A coluna de prioridade já é a bolinha; a listagem já é enxuta de propósito
(comentário em `:811-813`: os dados enriquecidos vivem na tela de atendimento).

---

## 6. Contrato proposto do componente (desenho, não implementação)

**Nome sugerido:** `components/ui/BolinhaPontuacao.tsx` + módulo PURO
`lib/pontuacao-indicador.js` (+ `.d.ts` / `.test.js`), seguindo o padrão já estabelecido por
`lib/site-rotulos.js`, `lib/followups-fila.js` e `lib/roteiros-lista.js`: **o front traduz o
veredito do backend e nunca recalcula a regra.**

```
BolinhaPontuacao({
  valor:      number | null      // null ⇒ estado "não calculado" (bolinha vazada + explicação)
  maximo:     number             // 100 | 60 — obrigatório, nunca assumido
  faixa:      string             // chave OPACA definida pela página ('alta' | 'alto' | 'fraco'…)
  titulo:     string             // 1ª linha: "Interesse alto", "Cadastro incompleto"
  oQueMede:   string             // 1 frase, obrigatória: o que esta pontuação mede AQUI
  fatores:    Fator[]            // itens auditáveis, já traduzidos pela página
  nota?:      string             // rodapé opcional ("Cadastro fraco costuma ser a melhor oportunidade")
  paleta:     'prioridade' | 'completude' | 'neutra'   // preset visual, escolhido pela página
  tamanho?:   'sm' | 'md'        // md = h-9 w-9 (padrão de hoje)
})

Fator = { rotulo: string, peso?: string, sinal?: 'positivo' | 'negativo' | 'ausente' }
```

**Regras do contrato:**

1. **A página é dona do significado.** `titulo`, `oQueMede`, `fatores`, `faixa` e `paleta` vêm
   de fora. O componente não conhece nenhuma regra de pontuação.
2. **`oQueMede` é obrigatório.** É o que impede duas telas de parecerem medir a mesma coisa.
3. **Cor nunca é a única informação.** Todo estado carrega número + rótulo em texto. A paleta
   `completude` é deliberadamente distinta da `prioridade`, para que a mesma cor não signifique
   coisas opostas.
4. **Acessibilidade herdada da variante #1, e obrigatória:** wrapper focável, `aria-label` com o
   resumo inteiro, círculo interno `aria-hidden`, `role="tooltip"` no balão, `title` de fallback,
   abre em `mouseenter`/`focus`, fecha em `mouseleave`/`blur`/`Escape`/scroll/resize.
   (A #1 não fecha com Escape hoje — é o único acréscimo ao seu comportamento.)
5. **Tooltip em portal no `<body>`**, posicionado pelo rect da âncora. Não negociável: é a
   correção de um defeito real dentro de tabelas com `overflow-hidden`.
6. **`valor: null` é um estado de primeira classe** — bolinha vazada + "não calculada", como
   Follow-ups já faz. Nunca `0`.
7. **Nunca renderiza JSON, id, UUID, `place_id`, `evolution_instance` ou telefone bruto.**
   O tooltip é operacional; auditoria vive em outro lugar.
8. **Somente leitura.** Sem controle interativo dentro do balão (`pointer-events-none`).
9. **`maximo` sempre exibido** (`40/100`, `30/60`) — sem isso o Instagram mente.

**Adoção sem big-bang:** #1 vira a implementação do componente (comportamento idêntico) → #2
passa a consumi-lo (ganha acessibilidade + critérios) → Aquisição e Banco de Leads adotam com
paleta `completude` → #3 (Follow-ups, fora do escopo desta análise) fica como está até a
decisão §7.3.

---

## 7. Lacunas de dados e decisões de negócio antes de implementar

### 7.1 — Bloqueante para "potencial de abordagem" no Banco de Leads
Não existe pontuação de potencial fora de campanha. Opções: **(a)** não ter (recomendado agora);
**(b)** rodar `calcularPrioridade` também no Banco de Leads, assumindo que a régua da campanha de
criação de site vale para todo disparo de WhatsApp; **(c)** criar uma pontuação nova — o que o
pedido proíbe sem dados verificáveis. **Decisão do Victor.**

### 7.2 — Direção da leitura de "Pontos" (Aquisição e Banco de Leads)
Hoje a cor diz que cadastro alto é bom, e a ordenação padrão diz o contrário. Precisa de uma
decisão explícita: **manter "completude" com paleta neutra** (recomendado — o número continua
sendo o mesmo, honesto, e a nota do tooltip explica a leitura) **ou** inverter para "oportunidade"
(`100 − cadastro`), que muda o número que o operador já conhece e todos os filtros salvos
(`scoreMin`/`scoreMax` no `localStorage`).

### 7.3 — Paleta única entre telas
Follow-ups usa `red = alta`. Ligações e Mensagens usam `emerald = alta`. Com um componente único
isso vira contradição visível. Recomendo padronizar `emerald/amber/slate` para "quanto maior,
melhor" e tratar urgência com um selo próprio, não com a cor da bolinha. **Fora do escopo desta
análise implementar — mas a decisão é pré-requisito.**

### 7.4 — Remoção do emoji de temperatura da Aquisição
Remove informação da tela. Justificativa em §4.3/§5.1; precisa do "pode" do Victor.

### 7.5 — Remoção do JSON bruto da tabela
`JsonLeadModal` também carrega o **prompt unificado**, que é ferramenta de trabalho. A proposta
é mover o acesso para o painel de detalhes, **não apagar** o modal. Confirmar que ninguém depende
do botão estar na linha.

### 7.6 — Sem lacuna de permissão ou isolamento
As quatro rotas exigem `requireAuth` + `requireEmpresaAccess`; nenhuma pontuação nova é criada;
nenhum dado sensível novo é exposto. Ressalva registrada: o fallback da PJ em
`api-conversas.js:18` (pré-existente, fora do escopo desta análise).

### 7.7 — Sem cobertura de teste no indicador atual
`CirculoPrioridade` e `InteresseBadge` estão inline em `.tsx` e **não têm teste**. Os backends
têm (`ligacao-prioridade.test.js`, `lead-interest-score.test.js`, `lead-score-cadastro.test.js`).
Ao extrair, a lógica pura (faixa→paleta, montagem de fatores, estado vazio) deve ir para
`lib/pontuacao-indicador.js` com teste, como o projeto já faz nos outros módulos puros.

---

## 8. Riscos

| Risco | Onde | Mitigação proposta |
|---|---|---|
| Uniformizar o visual e, com isso, sugerir significado uniforme | as 4 telas | `oQueMede` obrigatório + paletas distintas por tipo de pontuação |
| Vermelho na Aquisição continuar marcando o melhor lead | Aquisição, Banco de Leads | decisão §7.2 antes de implementar |
| Esconder dado decisivo dentro do tooltip | Aquisição | telefone/nicho/cidade/site/status **permanecem** colunas (§5.1) |
| Instagram com máximo 60 lido como 60/100 | Banco de Leads | `maximo` obrigatório no contrato |
| Regredir acessibilidade ao "unificar" pela variante mais simples | todas | a #1 é a base; a #2 sobe de nível, nunca o contrário |
| Refatoração não commitada da Central de Mensagens conflitar | `ConversaPainel.tsx` | partir do estado do working tree; commitar a refatoração antes de começar |

---

## 9. Evidências (arquivos lidos nesta análise)

**Frontend** — `app/dashboard/central-ligacoes/page.tsx` (`FAIXA_CLS:173`, `SITE_SELO:181`,
`CirculoPrioridade:198-249`, `LeadDetalhes:254`, coluna `:809`) ·
`app/dashboard/conversas/page.tsx` (integral) · `components/ConversaPainel.tsx`
(`INTERESSE_STYLE:110`, `scoreValue:116`, `TempBadge:120`, `InteresseBadge:125-154`,
cabeçalho `:415-434`, aba interesses `:494-529`) · `components/ConversaHistoricoModal.tsx`
(integral) · `app/dashboard/prospeccao/page.tsx` (integral) ·
`app/dashboard/banco-leads/page.tsx` (`:1-120`, `:255-464`, colunas `:1623-1760`, presets `:1779`)
· `app/dashboard/follow-ups/page.tsx` (`PRIORIDADE_DOT:76`, bolinha `:521-533`) ·
`components/ui/JsonLeadModal.tsx` · `lib/site-rotulos.js` · `lib/followups-fila.js` ·
`tailwind.config.ts`.

**Backend** — `services/ligacao-prioridade.js` (integral) · `services/lead-interest-score.js`
(integral) · `services/lead-score-cadastro.js` (integral) · `services/followup-call-score.js`
(integral) · `services/aquisicao-curadoria-ranking.js` (`:1-120`) · `routes/api-conversas.js`
(`:1-120`) · `routes/api-banco-leads.js` (`:140-210`) · `prospecting.js` (`:243-271`,
`:1028-1051`, `:1220-1280`, `:1400-1426`) · `services/orientador-resposta.js` (`:1-140`) ·
`db/campanhas.js` (referência `:254`) · lista de `test/` relacionada.

**Governança** — `AGENTS.md`, `CLAUDE.md`, `docs/ai-workflow.md`, `docs/ui-visual-standard.md`,
`docs/ai-task-start-log.md`.
