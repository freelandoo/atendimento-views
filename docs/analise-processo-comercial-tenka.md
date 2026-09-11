# Diagnóstico do processo comercial atual e proposta para a oferta de entrada da Tenka Tech

> **Fase 1 do pedido — somente leitura.** Nenhum dado, prompt, migration, rota ou tela foi
> alterado. Além deste documento, só o registro de Fase 0 em
> [ai-task-start-log.md](ai-task-start-log.md) foi escrito.
>
> Data: 2026-08-18 · Autor: Claude Code · Status: **aguardando aprovação**

## Escopo confirmado com o operador (2026-08-18)

A oferta Tenka Tech será operada **exclusivamente na Central de Ligações**, com **roteiro e
campanha novos dentro da conta da própria PJ Codeworks**. Fica **fora de escopo**: criar
empresa/tenant novo, instância de WhatsApp nova, contexto de bot, playbook, alteração de
prompt de produção e qualquer mexida no funil automático de WhatsApp.

Isso descarta três preocupações levantadas na primeira leitura, e é importante registrar por
quê:

- **O bloqueio de pagamento não se aplica.** Os validadores que barram Pix/cartão
  ([agent-validators.js:189](../backend/src/agent-validators.js#L189),
  [action-response-validator.js:223](../backend/src/action-response-validator.js#L223)) governam
  **mensagens geradas pela IA**. Numa ligação humana, quem fala é o vendedor. Nada a mudar.
- **O funil legado do bot não entra.** `goal-selector.js`, `next-action-orchestrator.js`,
  `pricing.js` e `prompts/*.md` permanecem intocados.
- **A configuração por empresa não é disputada.** Criar campanha e roteiro não escreve em
  `app.banco_leads_config` nem em `app.followup_config`.

---

## 1. Retrato de produção (leitura real, sem PII)

Executado contra o banco de produção em transação `READ ONLY` com `ROLLBACK`, sem selecionar
telefone, e-mail, nome de lead ou texto de mensagem.

### 1.1 Onde a operação vive

| Item | Valor |
| --- | --- |
| Empresas | 2 — `Atendimento-Views` (seed, `…0001`) e **`PJ Codeworks`** (`f5f47737…`) |
| Roteiros | **5**, todos na PJ Codeworks |
| Campanhas | **4**, todas na PJ Codeworks, todas `ativa` |
| Prospects | 3.359 no total — 2.223 na PJ, 1.136 na empresa seed |

A empresa seed tem carteira mas **nenhuma campanha e nenhum roteiro**. A operação comercial
humana é inteiramente da PJ Codeworks — é lá que a campanha Tenka vai nascer, como você
definiu.

### 1.2 As 4 campanhas existentes

| Campanha | Leads | Status dos leads |
| --- | --- | --- |
| Academias — Conversão e captação | 200 | 200 `nao_iniciado` |
| Academias — Site e presença digital | 200 | 138 não iniciados · 37 tentativa · 7 contato · 2 descoberta · 2 não atendeu · 14 descartados |
| Demo — Funileiros | 179 | 151 não iniciados · 16 tentativa · 5 contato · 1 **qualificado** · 1 follow-up · 2 não atendeu · 2 descartados |
| Presença Digital para Nail Designers | 200 | 177 não iniciados · 18 tentativa · 2 contato · 3 descartados |

**779 leads em campanha. Zero `convertido`. Zero `reuniao_marcada`. Zero `proposta_enviada`.**
O estado mais avançado já alcançado em toda a operação é **1 lead `qualificado`**.

### 1.3 O achado que muda tudo: a ligação morre na abertura

145 ligações registradas — 130 encerradas, 15 descartadas.

| Métrica | Valor |
| --- | --- |
| Duração média da ligação encerrada | **37 segundos** (máx. 287s) |
| Etapa alcançada = `abertura` | **119 de 130** (92%) |
| Etapa alcançada além da abertura | 7 `permissao` · 2 `situacao` · 1 `problema` · 1 `qualificacao` |
| Disposição | 53 caixa postal · 30 atendeu · 27 não atendeu · 16 número inválido · 3 ocupado · 1 reagendou |
| Taxa de atendimento | **23%** (30 de 130) |

Tempo médio por etapa: `abertura` 39s em 149 ocorrências; todas as outras etapas somam
**39 ocorrências no total**. `convite_reuniao` foi cronometrada **1 vez**. `objecoes`,
**1 vez**.

> **Leitura direta:** os roteiros consultivos de 8 a 11 etapas existem, estão bem construídos
> e **nunca foram exercitados**. O gargalo real da operação não é a profundidade do SPIN — é
> chegar a uma pessoa (23% de atendimento, 16 números inválidos) e sobreviver aos primeiros
> 40 segundos. Simplificar o roteiro para a oferta Tenka não é perda de capacidade: é parar
> de manter uma estrutura que a operação nunca alcançou.

### 1.4 Objeções e sinais registrados

- **Objeções: 1 no total** — *"To sem tempo agora"*, vinda do roteiro, não resolvida.
- **Sinais: 34** — 27 de interesse, 7 de resistência, **todos vindos do roteiro** (nenhum
  criado durante a ligação).
- Top interesse: *"Responde com atenção"* (9), *"Pergunta do que se trata"* (5),
  *"Aceita ouvir rapidamente"* (4).
- **Top resistência: `"Manda no WhatsApp"` (3)** — a resistência mais frequente da operação é
  exatamente o fluxo que o briefing da Tenka já previu.
- 21 perguntas do roteiro marcadas como feitas.

O catálogo de objeções previsto para a Tenka (13 objeções) é praticamente todo **hipótese
nova**: a base histórica não tem evidência para nenhuma delas, exceto "sem tempo agora" e
"manda no WhatsApp".

### 1.5 Follow-ups

| Canal | Status | Qtd |
| --- | --- | --- |
| ligacao | aguardando | 37 |
| whatsapp | aguardando | 17 |
| whatsapp | concluído | 6 |

54 follow-ups em aberto, todos com origem `ligacao`. A entidade funciona e está em uso real.

### 1.6 O que está literalmente vazio

- `app.agenda_eventos`: **0 linhas**. Nenhuma reunião foi jamais agendada pelo módulo.
- `venda_valor`: **0 registros, R$ 0**.
- `app.conversao_eventos` (ledger da Meta): **0 linhas**.

Ou seja: a etapa `convite_reuniao`, presente em **todos** os 5 roteiros, nunca produziu uma
reunião. Tirá-la do caminho padrão da campanha Tenka não remove nada que esteja funcionando.

### 1.7 A carteira não tem clínicas de estética

Top nichos: barbearia (587), academia (306), personal trainer (259), funilaria (258),
eletricista (222), nail designer (200), marceneiro (194), chaveiro (119), encanador (113).

Busca por estética/clínica/dermato/harmonização: **zero**. O mais próximo do público-alvo:

| Nicho | Qtd |
| --- | --- |
| nail designer | 200 |
| cabeleireiro | 24 |
| designer de sobrancelha | 22 |
| salão de cabeleireira | 11 |

São 257 leads de beleza, **nenhum de clínica de estética**. Nichos cadastrados em
`app.nichos`: só 3 (Academia, Funilaria, Nail Designer).

**Consequência operacional:** a campanha Tenka precisa de uma **rotina de Aquisição nova**
para o nicho antes de existir alguém para ligar. Cidade dominante da carteira atual: SBC-SP
(1.028 leads) — é a região onde a coleta tem histórico.

Nota lateral útil: **2.273 dos 3.359 prospects (68%) não têm site próprio**
(1.420 sem link algum, 587 só rede social, 125 perfil/diretório). O argumento central da
oferta Tenka é verdadeiro para dois terços da carteira.

---

## 2. Mapa do processo atual (camada humana)

```
Aquisição (Bright Data Maps)  →  Banco de Leads  →  Campanha  →  Roteiro versionado
      →  Central de Ligações  →  Follow-up (entidade)  →  Central de Mensagens
```

| # | Etapa | Onde vive | Estado |
| --- | --- | --- | --- |
| 1 | **Entrada do lead** | Rotinas de Aquisição por mercado (`nicho`+`cidade`+`uf`), intervalo mín. 6h, teto 200/busca, dedup por `place_id` → `prospectador.prospects` | Funciona; 3.359 leads coletados |
| 2 | **Qualificação** | Duas réguas: completude de cadastro (0–100) e prioridade de ligação (não ter site vale +40). Curadoria humana lead a lead. | Funciona |
| 3 | **Oferta** | Fala do vendedor, guiada pelo roteiro: `frase_sugerida`, `perguntas_json`, `sinais_*_json`, `objecoes_json`. Versão publicada é imutável. | Estrutura pronta, pouco exercitada |
| 4 | **Reunião/proposta/pagamento** | `OPORTUNIDADE_STATUS` vai até `convertido`. **Não há estado de pagamento.** | Nunca alcançado |
| 5 | **Objeções e follow-up** | `app.ligacao_objecoes` (texto, origem, resposta usada, resolvida) + `app.follow_ups` criado na transação do encerramento | Follow-up em uso; objeções quase sem dado |
| 6 | **Métricas** | `app.vw_ligacoes_analiticas` — duração, tempo por etapa, etapa alcançada/de maior interesse/de perda, objeções em texto, sinais, perguntas, motivo de perda, vendedor, campanha | Completa e confiável |
| 7 | **Telas** | `dashboard/aquisicao`, `banco-leads`, `roteiros`, `central-ligacoes`, `follow-ups`, `conversas` | Prontas |

---

## 3. Classificação: manter · simplificar · separar

### ✅ MANTER — serve à nova operação sem alteração

| Item | Evidência de que serve |
| --- | --- |
| **Aquisição + Banco de Leads + curadoria** | Clínica de estética é um lead de Maps como qualquer outro; o motor não conhece ticket. Só falta a rotina do nicho. |
| **Roteiros versionados** (migration 033) | Publicada = imutável; arquivar em vez de excluir; cada ligação guarda a versão usada. É o que permitirá comparar v1 e v2 da abordagem Tenka. |
| **Central de Ligações inteira** (040–045, 051) | Sinais, objeções, perguntas e tempo por etapa são o instrumento da validação. "Objeções repetidas que permitam melhorar o produto" é literalmente `app.ligacao_objecoes`. |
| **Follow-up como entidade** (062, 066, 067) | 54 itens em uso. Canal, prazo, responsável e disponibilidade por contato já suportam a cadência de 3 toques pedida. |
| **Classificação canônica de site** (056) | As variantes "sem site / site antigo / só Instagram" já são campo calculado (`situacao_site`, `classificacao_url`) — a segmentação do roteiro sai de dado, não de achismo. |
| **Registro de motivo de perda** (052) | 8 valores fechados, já alinhados com o que a validação precisa medir. |

### 🔻 SIMPLIFICAR — útil, mas excessivo para R$300 (e nunca exercitado)

| Item | Hoje | Proposta | Justificativa pelos dados |
| --- | --- | --- | --- |
| **Etapas do roteiro** | 8 a 11 etapas, com `problema`→`implicacao`→`convite_reuniao` | **6 etapas**: `abertura` → `situacao` → `insight` → `qualificacao` → `objecoes` → `proxima_acao` | 92% das ligações param na abertura; etapas 4+ somam 39 ocorrências históricas |
| **Peso da abertura** | 1 etapa entre 11, com 1 a 3 perguntas | **Etapa mais trabalhada do roteiro**, com as 9 variantes de entrada do briefing e a oferta dita já nos primeiros 20 segundos | É onde 100% do funil real acontece; média de 39s |
| **Convite para reunião** | Presente em todos os 5 roteiros | **Fora do caminho padrão**; vira ramo de exceção (dúvida importante, escopo fora do padrão, decisor pede demonstração) | 0 reuniões agendadas em 145 ligações |
| **Status da oportunidade** | 12 estados disponíveis | Usar **6**: `nao_iniciado`, `tentativa_contato`, `contato_realizado`, `qualificado`, `follow_up`, `convertido` (+`descartado`) | `em_descoberta`/`negociacao`/`reuniao_marcada` nunca passaram de 2 leads somados |
| **Catálogo de objeções** | 0 a 5 por etapa, espalhadas | **13 objeções concentradas na etapa `objecoes`**, com as 4 respostas factuais obrigatórias (Google, clientes, mensalidade, expansão) | Base histórica tem 1 objeção registrada — é tudo hipótese a validar |
| **Cadência de follow-up** | Livre por item | **3 toques**: D0/D1 → D+3 → último com porta aberta | Pedido do briefing; a entidade já suporta |

### ⛔ SEPARAR — preservar intacto, não reutilizar

| Item | O que fazer |
| --- | --- |
| **As 4 campanhas existentes** (Funileiros, 2× Academias, Nail Designers) | **Nenhum `UPDATE`, nenhum `DELETE`, nenhum reuso de `campanha_id`.** Campanha Tenka é linha nova. |
| **Os 5 roteiros existentes** | Roteiro Tenka é **cabeçalho novo**, não versão 2 de um existente — versão nova misturaria duas ofertas na mesma série histórica. |
| **Prompts de produção, funil do bot, `pricing.js`, planos mensais e Operação Digital** | Fora de escopo. Intocados. |
| **Etapa `convite_reuniao` nos roteiros antigos** | Continua lá. A mudança é só no roteiro novo. |

---

## 4. Riscos

| # | Risco | Gravidade | Mitigação |
| --- | --- | --- | --- |
| R1 | Reutilizar campanha/roteiro antigo apagaria a série histórica comparativa | Alta | Estruturas novas; nada de `UPDATE` no existente |
| R2 | **Não há lead de clínica de estética na carteira** — a campanha nasceria vazia | **Alta** | Rotina de Aquisição nova para o nicho **antes** de criar a campanha |
| R3 | Venda sem reunião não tem registro (`venda_valor` só existe atrelado a reunião) | Média (adiada por decisão) | Decidido: **medir fora do sistema na validação** e revisitar depois de rodar a campanha |
| R4 | 16 números inválidos em 130 ligações (12%) e 41% de caixa postal | Média | Não é problema de roteiro; considerar filtro de qualidade de telefone na curadoria |
| R5 | O prazo "até 24h" não tem relógio no sistema (sem campo de materiais recebidos/entrega) | Média | Controlado fora do sistema durante a validação, junto com R3 |
| R6 | Catálogo de objeções é 100% hipótese | Baixa | É justamente o que a etapa `objecoes` vai medir; revisar na v2 do roteiro |
| R7 | Nicho novo não existe em `app.nichos` (só 3 cadastrados) | Baixa | Cadastrar "Clínica de estética" junto com a rotina de Aquisição |

---

## 5. Arquitetura proposta

**Tudo dentro da PJ Codeworks (`f5f47737…`), usando apenas estruturas que já existem.
Nenhuma migration, nenhuma rota nova, nenhuma tela nova, nenhum arquivo de backend alterado.**

```
app.nichos                 + "Clínica de estética"                    (cadastro)
prospectador.aquisicao_rotinas
                           + rotina "Clínica de estética | <cidade>"   (coleta)
app.roteiros               + "TENKA | Vitrine Google Essencial | Clínicas de estética"
  └ app.roteiro_versoes      versão 1, nasce RASCUNHO → revisar → publicar
      └ app.roteiro_etapas   6 etapas (abaixo)
app.campanhas              + "TENKA | SITE 24H R$300 | CLÍNICAS DE ESTÉTICA | VALIDAÇÃO 01"
                             status rascunho → ativa, apontando para a versão publicada
app.campanha_leads           leads da rotina, vinculados à campanha
```

### 5.1 As 6 etapas do roteiro

| Ordem | `tipo` | Conteúdo |
| --- | --- | --- |
| 1 | `abertura` | Identificação + poucos segundos + observação real (**só quando houver dado confiável**; sem dado, a parte sai) + **a oferta dita já aqui**: site profissional, até 24h, R$300, 12 meses de hospedagem + a pergunta de situação ("Hoje vocês já têm site ou usam mais Instagram e WhatsApp?") |
| 2 | `situacao` | Confirmação curta do contexto: nome da clínica, cidade, situação atual, procedimento principal — **no máximo 4 perguntas, uma por vez** |
| 3 | `insight` | Conexão entre a resposta e a utilidade da vitrine, sem promessa de resultado |
| 4 | `qualificacao` | Os 6 critérios do briefing: é do público · é decisor ou leva ao decisor · tem interesse · informou nome e cidade · respondeu sobre situação atual · aceita receber escopo/pagamento |
| 5 | `objecoes` | As 13 objeções + as 4 respostas factuais obrigatórias |
| 6 | `proxima_acao` | Fechamento proporcional: confirmar escopo → link de pagamento → coleta de materiais → confirmar recebimento e iniciar prazo. Ramos: WhatsApp, follow-up, encerrar. |

`convite_reuniao` **não entra na sequência padrão** — vira orientação textual dentro de
`objecoes`/`proxima_acao` para os três casos em que a reunião curta se justifica.

### 5.2 Como as 9 variantes de roteiro pedidas são atendidas

O schema tem **um** `frase_sugerida` por etapa, não nove. As variantes entram como
**ramificações dentro da etapa** — que é como as etapas atuais já usam `perguntas_json` e
`objecoes_json`:

- **Por situação da empresa** (sem site · site antigo · só Instagram/WhatsApp · já usa Google
  e Instagram): 4 variantes de abertura no corpo da etapa 1. O operador sabe qual usar porque
  a Central de Ligações já mostra a situação do site do lead na tela.
- **Por comportamento da pessoa** (interessada · desconfiada · ocupada · pede WhatsApp ·
  pergunta preço na hora): 5 ramos na etapa `objecoes`, cada um com a resposta pronta —
  incluindo o texto de recuperação de contexto no WhatsApp.

**Alternativa se você preferir separação forte:** criar 2 roteiros (um "sem site / só
Instagram", outro "com site antigo / já usa Google"). Custo: duas séries analíticas menores e
metade do volume em cada. **Recomendo um roteiro só** — com 145 ligações de histórico total,
dividir a amostra atrasaria o aprendizado.

### 5.3 Métricas: o que sai de graça e o que falta

**Sai da estrutura existente, sem construir nada:** tentativas de ligação · contatos
realizados · conversas com decisor (sinal do roteiro) · ofertas apresentadas (etapa alcançada)
· leads qualificados · taxa de passagem entre etapas · motivos de perda · objeções mais
frequentes · tempo por etapa · WhatsApps enviados (follow-up canal `whatsapp`).

**Não existe no sistema hoje** (medir fora, por decisão sua): pagamentos iniciados e aprovados
· vendas e receita · tempo entre primeira conversa e pagamento · prazo real de entrega ·
adesão à Base Técnica (R$60) e à evolução (R$150) · custo por conversa/venda vindo do Meta
Ads (o ledger de conversão está zerado e só nasce de reunião).

---

## 6. Ordem de execução proposta

1. **Cadastrar o nicho** "Clínica de estética" em `app.nichos` (PJ Codeworks).
2. **Criar a rotina de Aquisição** para o nicho na cidade escolhida — e **esperar a coleta**.
   Sem leads, campanha e roteiro ficam decorativos.
3. **Criar o roteiro** com as 6 etapas, em **rascunho**; você revisa texto por texto;
   só então **publicar**.
4. **Criar a campanha** apontando para a versão publicada, em `rascunho` → `ativa`.
5. **Vincular os leads** coletados à campanha.
6. Rodar, e revisar objeções reais depois das primeiras ~30 ligações atendidas — a v2 do
   roteiro nasce dos dados, não de hipótese.

### Decisões que ainda preciso de você

| # | Pergunta | Por que importa |
| --- | --- | --- |
| **A** | **Cidade(s)** da primeira rotina de Aquisição de clínicas de estética | A carteira atual é concentrada em SBC-SP (1.028 leads); coletar onde já há histórico é mais previsível |
| **B** | **Um roteiro só** com ramificações internas, ou **dois** por situação de site? | §5.2 — recomendo um só |
| **C** | **Nome do vendedor** que aparece na abertura, e se a "observação real" deve ser obrigatória ou opcional | O briefing diz para remover a observação quando não houver dado confiável; preciso saber se o roteiro deve trazer as duas versões da frase |
| **D** | Confirmar o **nome exato** da campanha: `TENKA | SITE 24H R$300 | CLÍNICAS DE ESTÉTICA | VALIDAÇÃO 01` | É o nome que aparece na analítica para sempre |

---

## 7. Nota de segurança (não relacionada ao pedido, mas encontrada no caminho)

- `.claude/settings.json` contém uma string de conexão do Postgres de produção **versionada no
  git**. A senha que está lá **não autentica mais** (a porta do proxy também mudou de `14878`
  para `53678`), então a credencial exposta parece ter sido rotacionada — mas a **linha
  continua no repositório e no histórico**. Vale remover.
- O acesso usado neste diagnóstico veio das variáveis do serviço Postgres no Railway, com sua
  autorização explícita, em transação `READ ONLY` + `ROLLBACK`.

---

## 8. Execução — o que foi criado em produção (2026-08-18, autorizado)

Tudo criado **pela API do próprio produto**, nunca por SQL direto — é o que garante
imutabilidade da versão publicada, `assertMesmaEmpresa`, `assertRoteiroVersaoUtilizavel` e a
reserva de coleta antes da chamada paga. Empresa: **PJ Codeworks**
(`f5f47737-3f48-44fd-a09a-f09e66f7ed85`).

| Estrutura | Id | Estado |
| --- | --- | --- |
| Nicho `Clínica de estetica` | `517eb58b-880f-48eb-8ae8-aa5830703686` | criado |
| Roteiro `TENKA \| Vitrine Google Essencial \| Clinicas de estetica` | `98ae97b9-8eb5-4ac4-a578-29ac641d75ac` | ativo |
| Versão 1 do roteiro (6 etapas) | `ea9d8ae8-bc3b-441b-b93d-3df9dee31471` | **publicada** (imutável) |
| Campanha `TENKA \| SITE 24H R$300 \| CLINICAS DE ESTETICA \| VALIDACAO 01` | `cb7e7c1c-a709-47ed-9467-ccd35cc63a45` | **ativa** |
| Coleta Bright Data Maps — `clinica de estetica em Sao Bernardo do Campo - SP` | busca `08f9d4ae-afc8-4af9-93dc-6fe7204fedb3` · snapshot `sd_mszhjupgxuav4f2pd` | assíncrona, até 200 leads |

**Nenhuma campanha ou roteiro existente foi alterado, arquivado ou excluído.**

### Conteúdo das 6 etapas

1. **`abertura`** — as duas versões da entrada (com e sem observação real, com a instrução
   explícita de não inventar), a oferta inteira dita na primeira frase, a pergunta de situação,
   5 sinais de interesse, 5 de resistência e 3 objeções de porta (preço na hora, "manda no
   WhatsApp", "sem tempo agora").
2. **`situacao`** — as 4 perguntas do briefing, uma por vez, mais a resposta para "de onde você
   tirou meu número?".
3. **`insight`** — 4 conexões prontas, uma por situação de site (só Instagram · site antigo ·
   já usa Google e Instagram · não tem nada).
4. **`qualificacao`** — os 6 critérios do briefing, com o caminho para quando a pessoa não é a
   decisora.
5. **`objecoes`** — **15 objeções** com resposta, incluindo as 4 respostas factuais
   obrigatórias literais: o "não" para posição no Google, o "não" para garantia de clientes, a
   Base Técnica de R$60 após 12 meses e a separação entre plano de evolução e projetos novos.
6. **`proxima_acao`** — fechamento em pagamento + coleta de materiais (com o prazo de 24h
   começando só depois dos materiais completos), a mensagem de recuperação de contexto no
   WhatsApp, a reunião como exceção declarada e o encerramento sem venda.

### Marcadores deixados no texto (trocáveis numa versão 2)

`[vendedor]`, `[nome]`, `[clinica]`, `[procedimento]` e `[observacao real]`. O nome do vendedor
ainda não foi definido; o roteiro é lido por uma pessoa na tela, então o marcador é honesto e
não trava a operação.

### Resultado da coleta (concluída em ~7 min)

| Métrica | Valor |
| --- | --- |
| Prospects importados | **200** |
| Com telefone | **192** |
| **Vinculados à campanha** | **192** (todos `nao_iniciado`) |
| Sem site próprio | **127 de 200 (64%)** |

Os 8 sem telefone ficaram fora da campanha de propósito — é uma campanha de ligação. Eles
continuam no Banco de Leads.

A fila da Central de Ligações já está priorizando corretamente: o topo é ocupado por leads
`situacao_site = sem_site`, que é o público exato da oferta (`ligacao-prioridade.js` dá +40
pontos a quem não tem site).

Estrutura da versão publicada, conferida na API:

| Ordem | Tipo | Perguntas | Objeções | Sinais interesse / resistência |
| --- | --- | --- | --- | --- |
| 1 | `abertura` | 3 | 3 | 5 / 5 |
| 2 | `situacao` | 4 | 1 | 5 / 4 |
| 3 | `insight` | 1 | 0 | 4 / 3 |
| 4 | `qualificacao` | 3 | 1 | 5 / 3 |
| 5 | `objecoes` | 2 | **15** | 4 / 4 |
| 6 | `proxima_acao` | 3 | 1 | 4 / 3 |

### Pendências desta execução

- **`meta_ligacoes` e `meta_reunioes` ficaram nulas** de propósito: o briefing não definiu meta
  e inventar número numa campanha de validação contaminaria a leitura.
- **Nenhum responsável foi atribuído** à campanha (`campanha_responsaveis` vazio) — depende de
  quem vai ligar.
- **Nenhum disparo de WhatsApp foi feito nem configurado.** A campanha é de ligação.

---

## 9. Versão 2 do roteiro — ancoragem de valor + SPIN antes da oferta (2026-08-18)

Mudança de direção do operador: em vez da oferta na primeira frase, o roteiro passa a
**ancorar valor na abertura, percorrer o SPIN e só então apresentar a oferta**.

| Item | Valor |
| --- | --- |
| Versão 2 | `205f9195-82c4-4ad5-bc42-869cb34437ef` — **publicada**, 8 etapas |
| Versão 1 | **arquivada automaticamente** ao publicar a v2 (histórico preservado) |
| Campanha | repontada para a v2 |
| Leads | os 192 vínculos **não foram tocados** |

Nenhuma ligação havia sido feita ainda, então a v1 não deixou histórico órfão.

### Estrutura da v2

| Ordem | Tipo | Papel | Perguntas | Objeções |
| --- | --- | --- | --- | --- |
| 1 | `abertura` | Ancoragem de valor em uma frase + permissão. **Sem preço, sem produto.** | 3 | 3 |
| 2 | `situacao` | **S** — como o cliente novo chega hoje | 4 | 2 |
| 3 | `problema` | **P** — quem não conhece não tem onde achar | 4 | 1 |
| 4 | `implicacao` | **I** — consequência, só por pergunta | 4 | 1 |
| 5 | `insight` | **N** + **a oferta** (Vitrine, R$300, 24h, 12 meses) | 3 | 3 |
| 6 | `qualificacao` | 6 critérios | 3 | 1 |
| 7 | `objecoes` | 15 objeções com resposta | 2 | 15 |
| 8 | `proxima_acao` | Fechamento + materiais + semente do plano de evolução | 3 | 2 |

### As três travas de honestidade que a v2 carrega

1. **A etapa `implicacao` é a de maior risco do roteiro** — é onde um vendedor escorrega para
   medo e número inventado. O objetivo dela diz, explicitamente: *proibido* citar quantas
   pessoas procuram por mês, afirmar quanto a clínica perde, usar porcentagem, comparar com
   concorrente nominalmente ou dizer que ela "está perdendo dinheiro". O movimento é
   **perguntar e deixar a pessoa fazer a própria conta** — e, se ela não fizer, seguir adiante.
2. **A oferta vem com o enquadramento "porta de entrada" e a negativa explícita**: *"eu não vou
   prometer cliente nem primeiro lugar no Google, porque ninguém consegue garantir isso.
   O que a vitrine faz é ser a porta de entrada."* A promessa autorizada aparece escrita no
   objetivo de cada etapa de risco: presença profissional, **poder** ser encontrada no Google,
   caminho fácil até o WhatsApp.
3. **A etapa `problema` autoriza desistir.** Se a pessoa disser que está tudo bem, o roteiro
   manda aceitar e ir para a qualificação — não forçar problema que ela não tem.

### O plano de evolução (R$150/mês) entra como SEMENTE, não como venda

Na etapa 8, com instrução explícita de **não vender na mesma ligação**: planta a ideia
("depois que estiver no ar, se você quiser manter a página sempre atualizada...") e segue.
Só informa o valor **se a pessoa perguntar**, sempre junto da frase que separa os dois planos:
o R$150 é opcional e **não é necessário para manter o site no ar** — para isso basta a Base
Técnica de R$60. Isso segue o próprio briefing ("oferecido depois da entrega ou quando a
clínica já perceber valor").

### Marcadores que continuam pendentes

`[vendedor]`, `[nome]`, `[clinica]`, `[procedimento]`, `[observacao real]` e — novo na v2 —
**`[link do modelo de exemplo]`**. A etapa 5 oferece mandar um modelo para a pessoa visualizar
como ficaria a página dela; **não existe link de modelo da Tenka publicado**, então o roteiro
traz o marcador com a instrução de só enviar link real e **nunca inventar link ou case**.
Enquanto não houver modelo, o vendedor descreve a estrutura em uma frase.

### Tensão declarada com os dados

A v1 era curta de propósito porque a média histórica de ligação nesta operação é de **37s** e
**92% das ligações terminam na abertura**. A v2 põe quatro etapas entre a abertura e a oferta.
A mitigação está escrita no objetivo da etapa 1: a ancoragem tem de **caber em uma respiração**,
e o aviso sobre os 37s está no próprio texto que o vendedor lê. Se a taxa de sobrevivência à
abertura não melhorar nas primeiras ~30 ligações atendidas, é o primeiro número a olhar —
`etapa_alcancada` em `app.vw_ligacoes_analiticas` responde isso direto.

---

## 10. Versão 3 — a narrativa do anúncio ("fachada digital") entra no roteiro (2026-08-20)

O anúncio da Tenka foi definido com uma lógica de cinco passos. A v3 alinha a ligação a ela,
para que quem vem do anúncio e quem recebe a ligação ouçam **a mesma história**.

| Item | Valor |
| --- | --- |
| Versão 3 | `6439d439-f1b5-4862-82a9-b70946467a60` — **publicada**, 8 etapas |
| Versão 2 | arquivada automaticamente |
| Campanha | repontada para a v3 |
| Leads | os **192** vínculos intactos |

### O mapeamento anúncio → etapa

| Passo do anúncio | Etapa do roteiro | Como aparece |
| --- | --- | --- |
| **1. Dor** — "sua clínica **pode** estar perdendo clientes" | `abertura` | A ancoragem passa a citar a perda, **sempre no condicional** |
| **2. Causa** — "quem procura pode não encontrar **ou não entender** seus serviços" | `problema` | A etapa ganhou a **segunda metade da causa**, que a v2 não tinha |
| **3. Solução** — "fachada digital profissional, pronta em até 24h" | `insight` | Passo 2 da fala |
| **4. Valor percebido** — apresentação clara, premium, organizada, caminho direto ao WhatsApp | `insight` | Passo 3 da fala, novo na v3 |
| **5. Próximo passo** | `proxima_acao` | Título da etapa mudou para "Próximo passo" |

### O que mudou de substancial (não é só troca de palavra)

- **A causa virou dupla.** A v2 só tratava "não te encontram". O anúncio acrescenta "não
  entendem seus serviços" — e essa metade é a mais esquecida: tem clínica que até aparece, mas
  o que a pessoa vê não explica procedimento, preço nem como chamar, e ela desiste no meio.
  A etapa `problema` ganhou pergunta própria para isso ("quem cai no perfil de vocês consegue
  entender rápido tudo que vocês fazem, ou precisa perguntar no direct?").
- **A `implicacao` foi reenquadrada como "oportunidade que passa batido"**, mantendo todas as
  proibições da v2 e acrescentando a instrução de **perguntar e ficar quieto**: *"o silêncio
  dela vale mais que qualquer número que você invente"*.
- **A etapa 1 ganhou uma regra sobre uma única palavra.** O texto que o vendedor lê diz:
  *"é sempre `PODE estar perdendo`, nunca `você está perdendo` nem `você vai ganhar`. A
  diferença entre hipótese e promessa é essa palavra."* É o que mantém a copy do anúncio dentro
  da promessa autorizada.
- **Objeção nova: "o que é fachada digital?"** — o termo é forte, mas não é autoexplicativo ao
  telefone. Resposta: *"é o mesmo que a fachada da clínica na rua, só que na internet"*.
- **Ramo para quem já viu o anúncio:** não repetir a ancoragem — pular direto para `situacao`.
- **A mensagem de WhatsApp da etapa 8 foi reescrita** com o mesmo vocabulário.

### Risco aceito e documentado: o anúncio manda para um WhatsApp que não conhece a oferta

Decisão do operador (2026-08-20): **não mexer no WhatsApp por enquanto.** Fica registrado o que
acontece hoje se o anúncio for ao ar com o CTA "envie uma mensagem":

- A instância `pj` está **ativa**, com contexto próprio (`pj-codeworks`, `runtime_ativo = true`,
  com `estagios_json`) e **agenda ligada** (`usa_agenda` não é `'false'`).
- O lead que escrever cai no **agente comercial da PJ Codeworks**: catálogo Iniciante/Padrão/
  Premium (R$200–3.000), preço calculado por ROI e reunião de 15 min como destino. Ele **não
  conhece** a fachada digital de R$300 em 24h.
- **`app.atribuicao_anuncios` tem 0 linhas** — nenhuma atribuição de anúncio foi capturada até
  hoje, e a pendência do AGENTS.md (confirmar ao vivo que o `externalAdReply` chega no webhook,
  via `CTWA_WEBHOOK_DIAGNOSTICO=on`) segue aberta. Sem isso não há como saber qual criativo
  trouxe qual conversa.
- Somado à ausência de registro de venda sem reunião (§4, R3), o **custo por venda de tráfego
  pago é hoje impossível de fechar dentro do produto**.

Saídas possíveis, quando for a hora: (a) instância + contexto próprios da Tenka, com agenda
desligada; (b) trocar o CTA do anúncio para telefone ou formulário, mantendo o WhatsApp fora.
Trocar o contexto da instância `pj` **não** é saída — mudaria o atendimento de todos os leads
da PJ, não só os do anúncio.

---

## 11. Versão 4 — revisão SPIN sobre dados reais de operação (2026-08-24)

### 11.1 Correção de um número que orientava as decisões anteriores

As seções 1.3 e 9 usaram "**92% das ligações terminam na abertura**" para justificar um roteiro
curto. **A estatística é enganosa**: `etapa_alcancada = 'abertura'` inclui todas as ligações
que ninguém atendeu. Medido nesta campanha (52 ligações):

| | |
| --- | --- |
| Atenderam | **6 (11,5%)** |
| Caixa postal | 25 (48%) |
| Ocupado · não atendeu · número inválido | 17 |
| Descartadas | 4 |
| **Duração média de quem atendeu** | **125s** (mín. 61 · máx. 192) |

Das 6 atendidas: 3 pararam na abertura, 1 em `situacao`, 1 em `implicacao`, 1 em `insight` —
com **1 lead em `negociacao` e 1 `qualificado`**. Quando alguém atende, a conversa dura dois
minutos e chega a avançar. **O gargalo é o contato, não o roteiro.**

### 11.2 O que mudou na v4

Versão `74a2a702-cdaa-422d-8cfc-ae31d7b5d047`, **publicada**, 8 etapas; v3 arquivada; campanha
repontada; **192 leads intactos**.

| # | Correção SPIN | O que era | O que é |
| --- | --- | --- | --- |
| 1 | **Need-payoff aberta** | "isso ajudaria vocês?" (fechada e indutora — gera concordância sem compromisso) | "**o que mudaria** no atendimento se a pessoa já chegasse sabendo procedimento e preço?" |
| 2 | **Menos situação** | 4 perguntas, incluindo dados que já estão na ficha | 2 perguntas + instrução de ler ficha antes e **confirmar** em vez de perguntar do zero |
| 3 | **Implicação de custo interno** | genérica e abstrata ("o que acontece com essa pessoa?") | quantas dúvidas repetidas por dia · quem responde · quanto tempo espera — **verificável por ela, sem estatística** |
| 4 | **Resumo antes da oferta** | não existia | "resumindo o que você me disse: [X] e [Y]. É isso?" |
| 5 | **Oferta amarrada** | lista de 6 características | 2-3 elementos que respondem ao que ela disse, cada um amarrado à fala dela |
| 6 | **Abertura sem afirmar a dor** | "muita clínica boa pode estar perdendo gente" | propósito + credibilidade + permissão. A dor vira **pergunta** na etapa 3 |
| 7 | **Diagnóstico de objeção** | 15 respostas | as mesmas 15 + "se 'está caro' se repete, o conserto é nas etapas 3-5, não na réplica" |
| 8 | **Avanço vs. continuação** | fechamento sem doutrina | toda ligação atendida termina com ação **datada**; "vou pensar" é continuação = ligação fracassada |
| 9 | **Roteiro de caixa postal** | não existia (48% dos resultados!) | mensagem de até 15s, sem preço e sem pitch, só para o número não ser desconhecido na 2ª tentativa |
| 10 | **Escada condicional** | 8 etapas sempre | etapas 3 e 4 explicitamente puláveis quando a pessoa já demonstra interesse |
| 11 | **Qualificação por necessidade explícita** | 6 critérios logísticos | critério 0: ela **enunciou** a necessidade, ou apenas concordou? Concordância não é necessidade |

### 11.3 A tensão do item 6, declarada

Tirar a dor da abertura contraria a narrativa do anúncio, que abre pela dor. O raciocínio SPIN:
**necessidade dita pelo vendedor pesa menos que necessidade dita pela compradora**, e afirmar a
dor de saída convida defesa — a objeção "minha agenda já é cheia" existe no roteiro exatamente
por isso. A divisão de trabalho adotada: **o anúncio cria a dor; a ligação deixa a pessoa
dizê-la.** O vocabulário "fachada digital" continua na abertura. Se preferir o contrário, é uma
v5 e o texto anterior está preservado na v3 arquivada.

### 11.4 Achado técnico: truncamento silencioso

`validarEtapas` (`src/db/roteiros.js:29`) corta `objetivo` e `frase_sugerida` em **2000
caracteres sem avisar** — o `PUT` responde 200 e o texto some. A v4 foi gravada com validação
de tamanho antes do envio; **v2 e v3 foram conferidas e não sofreram corte**. Quem editar
roteiro pela tela precisa saber disso.

### 11.5 O que o roteiro não resolve — e é o que mais dói

- **44 dos 48 leads discados tiveram UMA tentativa**; só 4 tiveram duas. Com 48% de caixa
  postal, é na 2ª e 3ª tentativa que o contato aparece. **Maior ganho disponível, custo zero.**
- **72 dos 81 follow-ups de ligação estão vencidos.** As decisões tomadas nas ligações não estão
  sendo executadas.
- **Horário:** 10h → 17% de atendimento · 15h → 7% · 16h → 0%. Só três faixas testadas; vale
  testar 8h-9h e depois das 18h.
- **Zero objeções e zero motivos de perda registrados em 52 ligações.** Sem isso, a v5 vira
  opinião — inclusive esta revisão.
- **A segmentação está certa:** as 6 que atenderam eram 100% sem site próprio (3 só rede
  social, 3 sem link algum).

---

## 12. Versão 5 — "fachada digital" nunca aparece sozinha (2026-08-24)

Versão `a8a2d006-dea9-42d5-9336-1c9a23dd8e4e`, **publicada**; v4 arquivada; campanha repontada;
**192 leads intactos**. Estrutura SPIN da v4 **inalterada** — mudou só o vocabulário.

### A regra

"Fachada digital" continua sendo o **enquadramento** (é o que dá a imagem certa e conecta com o
anúncio); **"site" é a palavra que a pessoa entende**. As duas andam juntas na primeira menção
de cada bloco: *"o site de vocês, a fachada digital da clínica"*.

Isso está escrito como regra no objetivo da etapa 1, valendo para o roteiro inteiro, com o
motivo: termo novo ao telefone custa atenção, e **a cliente precisa saber com todas as letras o
que está comprando**. O risco que isso fecha é concreto — alguém aceitar uma "fachada digital" e
descobrir depois que era um site, que é reclamação de expectativa, não de entrega.

### Onde a troca aconteceu

- **Abertura:** *"A gente faz site pra clínicas de estética aqui de São Bernardo — a fachada
  digital da clínica, a página onde..."* (antes abria só com "fachada digital").
- **Caixa postal:** passou a dizer *"sobre o site da [clínica]"*.
- **Oferta (etapa 5):** *"é exatamente pra isso que serve o site, a fachada digital da clínica"*;
  e a negativa explícita virou *"o que **o site** faz é ser a porta de entrada"*.
- **Objeção de abertura** renomeada para **"O que é fachada digital? / Isso é um site?"**, com
  resposta que começa por *"É um site, sim"*.
- **Qualificação:** critério novo de conferência — *se a conversa inteira falou só em "fachada
  digital", diga uma vez: "só pra deixar claro, é um site mesmo, no ar, com endereço próprio"*.
- **Mensagem de WhatsApp** e as 15 objeções revisadas uma a uma ("um site novo por R$300",
  "manter o site no ar", "o site não substitui o Instagram").

### Guarda automática na publicação

O script de publicação passou a **abortar** se alguma etapa mencionar "fachada" sem conter
"site". Resultado gravado e conferido na API: **"fachada" 12×, "site" 46×** — nenhuma etapa fala
de fachada sem dizer site.

---

## 13. Versão 6 — correção do processo comercial: sem modelo, WhatsApp na hora, pagamento no final (2026-08-24)

Versão `fd946b4a-8b77-4332-8dd3-1557ceefdcf7`, **publicada**; v5 arquivada; campanha repontada;
**192 leads intactos**. Estrutura SPIN e vocabulário preservados — mudou o **processo**.

### As três correções

**1. Não existe modelo, e o roteiro parou de prometer um.** O marcador
`[link do modelo de exemplo]` foi **removido** (não ficou pendente: foi apagado). A instrução
agora é explícita, na etapa 1 e na 5: *não prometa mandar exemplo, portfólio, print ou link de
demonstração em nenhum momento — não há o que enviar, e prometer isso queima a confiança no
primeiro follow-up.* Entrou uma objeção própria: **"Tem algum exemplo / me manda um site que
vocês fizeram"**, cuja resposta admite a ausência e pivota para o argumento mais forte.

**2. O próximo passo é migrar para o WhatsApp durante a ligação.** Não é enviar link de
pagamento. A etapa 8 virou: checar dúvida → resumir → **confirmar o WhatsApp e mandar a mensagem
ainda com a pessoa na linha** ("acabei de te mandar, chegou?") → combinar quando o material vem.
A mensagem de formalização foi reescrita: deixa por escrito o escopo, o valor, o prazo, a
condição de pagamento e a lista de materiais.

**3. O pagamento é no final — e isso substituiu o modelo como argumento central.** Sem
pagamento adiantado, a cliente não arrisca nada para começar. Aparece **16 vezes** no roteiro
gravado e reescreveu quatro objeções:

| Objeção | Como ficou |
| --- | --- |
| "R$300 está caro" | "você só paga no final, quando estiver pronto e você tiver visto. Não tem nada adiantado" |
| "Está barato demais, qual a pegadinha?" | "como você só paga no final, o risco de acreditar em mim é zero" |
| "Já tentei site antes e não deu em nada" | "por isso você só paga no final. **A aposta é nossa, não sua**" |
| "Preciso pensar" | "como não tem pagamento pra começar, pensar e começar acabam sendo a mesma coisa aqui" |

Também entraram **"Como funciona o pagamento?"** e **"E se eu não gostar?"** na etapa 8.

### A consequência que mudou a qualificação

Com pagamento no final, **dizer "sim" não custa nada** — todo mundo aceita um site que só se
paga depois. O título da etapa 6 virou **"o compromisso real é o MATERIAL, não o 'sim'"**: o
único sinal de compromisso que sobra é a chegada de logo, fotos, procedimentos e texto, porque
isso dá trabalho e só faz quem quer de verdade. **O marco de conversão passa a ser o material,
não o aceite verbal** — e o avanço da ligação é "material com data combinada"; *"depois eu
mando"* sem dia é continuação, não avanço.

### Guardas automáticas na publicação

O script agora aborta se: (a) alguma etapa falar em "fachada" sem "site"; (b) sobrar o marcador
`[link do modelo`; (c) alguma etapa **instruir** o envio de link de pagamento — distinguindo a
instrução da proibição, para que a frase "não existe link de pagamento" continue permitida.
Conferido no que ficou gravado: **modelo 0× · "paga no final" 16× · WhatsApp 19×**.

### Risco declarado

Produzir antes de receber, numa venda de R$300 vinda de ligação fria, transfere o risco de
inadimplência para a Tenka. É decisão comercial do operador e está tomada; o que o roteiro faz é
transformar esse risco em **argumento** ("a aposta é nossa, não sua"). Se aparecer calote em
volume, a alavanca menos custosa é exigir o material completo antes de produzir — o que o
roteiro já reforça — e não voltar a cobrar adiantado, que devolveria a barreira de entrada.

### Ponto que ficou em aberto

O **momento exato** do pagamento não foi especificado: o roteiro diz "no final, quando estiver
pronto e você tiver visto", que é verdadeiro tanto para "na entrega" quanto para "após
aprovação". Se houver uma regra mais precisa (antes de publicar? após aprovação?), é uma linha a
ajustar numa versão futura.

---

## 14. Versão 7 — a prévia já existe: demonstração antes de explicação (2026-08-24)

Reposicionamento pedido pelo operador: em vez de vender a construção futura de um site, a
conversa parte de **uma prévia visual personalizada já montada** para aquela clínica, e conduz
para uma **reunião curta** de apresentação e fechamento.

| Artefato | Id | Estado |
| --- | --- | --- |
| **A — Abordagem** (`TENKA \| Vitrine Google Essencial`) v7 | `cfdd3b9a-cc5f-417b-acf1-08fcc24ee130` | **publicada**, 7 etapas · campanha aponta para ela |
| **B — Reunião** (`TENKA \| Reuniao de apresentacao e fechamento`) | roteiro `1a1117da-b9a7-4649-8517-04a0f5631b00` · versão `9672a30f-17b3-490f-a7a2-6d83b931becb` | **publicada**, 4 etapas |
| v6 | — | arquivada |
| Leads | — | **192 intactos** |

### 14.1 Por que DOIS roteiros e não um

A Central de Ligações percorre as etapas **durante a chamada** e mede `etapa_alcancada` e
`ligacao_etapas`. Se as etapas da reunião morassem no roteiro da abordagem, **nenhuma ligação
alcançaria da 6ª em diante** e o funil viraria ruído — exatamente a métrica que hoje mostra que
92% "param na abertura". Abordagem e reunião são conversas diferentes, em momentos diferentes:
são dois roteiros.

### 14.2 O que foi PRESERVADO do material anterior

Vocabulário (`site` + `fachada digital`, sempre juntos), a promessa autorizada e as negativas
explícitas (Google, clientes), o pagamento no final, a disciplina enxuta de perguntas do SPIN
(2 perguntas de situação, ficha lida antes), o registro obrigatório de objeção e motivo de
perda, a regra de **avanço × continuação**, o roteiro de caixa postal e as objeções de
mensalidade, pós-12-meses, escopo e "já tentei site antes".

### 14.3 O que foi SUBSTITUÍDO

A lógica "vamos construir" saiu de todas as etapas de entrada e valor. A abertura não descreve
mais um produto futuro: informa que **já existe** uma prévia e pede permissão para mostrar. A
etapa de oferta virou **prova visual** (mockup + legenda curta). O fechamento da conversa deixou
de ser "manda os materiais" e passou a ser **marcar a reunião** — os materiais são pedidos na
reunião, no roteiro B.

### 14.4 As três verdades que o roteiro não pode quebrar

Escritas no objetivo da etapa 1, porque é aqui que este posicionamento pode virar golpe aos
olhos da cliente:

1. A prévia é **conceito/mockup** — não é site publicado, contratado nem no ar.
2. **Ela não pediu nada.** Nunca sugerir que solicitou, cadastrou ou contratou.
3. Foi feita **sem compromisso** — não gera obrigação de compra nem cobrança.

Daí nasceram três objeções novas e obrigatórias: **"Eu não pedi isso / de onde tiraram meus
dados?"**, **"Isso já está publicado?"** e **"Vocês usaram minhas fotos / minha marca?"** — esta
última responde com a saída oferecida (*"se você preferir, eu apago agora mesmo"*). Quem oferece
a saída não parece golpe. Há guarda automática na publicação que rejeita qualquer afirmação de
que o site está publicado.

### 14.5 Efeito colateral positivo: a medição volta a fechar

Com a reunião de volta ao caminho padrão, `app.agenda_eventos` volta a ser usada — e o
mapeamento que já existe passa a funcionar sozinho: `reuniao_agendada → LeadSubmitted`,
`reuniao_realizada → QualifiedLead`, `reuniao_realizada_com_venda → Purchase` (+`venda_valor`).
**O buraco declarado em §4/R3 — "venda sem reunião não tem onde ser registrada" — deixa de ser
bloqueante**, sem precisar de migration nova. É o ganho não-óbvio deste reposicionamento.

### 14.6 O custo que o novo modelo cria — e a mitigação

A prévia é **trabalho feito antes da venda**, por lead. Com **11,5% de taxa de atendimento**,
montar prévia para os 192 leads significa produzir ~170 peças para pessoas que nunca vão
atender. Mitigação escrita no roteiro:

- **Pré-requisito absoluto:** só use o roteiro A com lead que **já tem** a prévia montada.
- **Variante honesta** para quem não tem: *"queria montar uma prévia de como ficaria o site de
  vocês e te mostrar, sem compromisso. Posso preparar e te mandar ainda hoje?"* — e aí preparar
  de verdade. Isso dá um motivo real ao follow-up, que é justamente o elo mais quebrado da
  operação (72 de 81 vencidos).
- **Recomendação operacional:** produzir prévias em lote pequeno, priorizando os leads que já
  atenderam e os de melhor pontuação — não a carteira inteira.

### 14.7 O que continua valendo, e pesa mais que qualquer roteiro

O reposicionamento não resolve nada do que está travado na operação: 1 lead em `negociacao` com
follow-up vencido há 3 dias, 28 follow-ups vencidos há mais de uma semana, 25 caixas postais sem
segunda tentativa, 144 leads nunca discados e **zero objeções registradas em 52 ligações**.

---

## 15. Versão 8 — o roteiro vira MAPA DE DECISÃO (2026-08-24)

| Artefato | Versão | Estado |
| --- | --- | --- |
| A — Abordagem | v8 `9a6b508b-3013-4c5e-b65a-bbd24e27e64b` | **publicada**, 7 etapas · campanha aponta |
| B — Reunião | v2 `51a8f27e-f416-413e-a809-65b8c4074228` | **publicada**, 4 etapas |
| Leads | — | **192 intactos** |

### 15.1 O diagnóstico: a própria tela mostrava instrução como fala

`frase_sugerida` é renderizado na Central de Ligações **entre aspas, em itálico** — a interface
o trata como *a frase a dizer*. As versões anteriores empilhavam ali roteiro de caixa postal,
avisos, variantes e notas de conduta. Resultado: o atendente via um bloco de citação enorme e
não sabia o que era para falar e o que era para saber. **Era a interface exibindo estratégia
como script** — exatamente a queixa que originou esta revisão.

### 15.2 O limite do schema, declarado

A estrutura de nove campos pedida (`objetivo`, `orientacao`, `o_que_observar`,
`perguntas_ou_gatilhos`, `script_sugerido`, `possiveis_respostas_do_lead`, `como_reagir`,
`proximo_passo`) **não existe em `app.roteiro_etapas`**, que tem campos fixos. Três restrições
reais descobertas na leitura do código:

- `perguntas_json` e `sinais_*_json` passam por `.map(String)` — **não aceitam objetos** — e são
  gravados **literalmente** em `ligacao_perguntas.texto_no_momento` e `ligacao_sinais.texto`.
  Enfiar "por que perguntar" dentro da pergunta poluiria a analítica.
- `objecoes_json` aceita objetos, mas a tela lê só `{objecao, resposta}` — chaves extras seriam
  invisíveis.
- `objetivo` e `frase_sugerida` são cortados em 2000 caracteres, em silêncio.

**Encaixe adotado:** `objetivo` vira o mapa (blocos rotulados), `frase_sugerida` volta a ser só
a fala, perguntas e sinais ficam curtos, e a estrutura em camadas da objeção vai dentro do texto
da `resposta`. Campos de verdade exigiriam migration + mudança de tela — trabalho separado.

### 15.3 A nova estrutura de cada etapa

```
titulo          → nome da etapa, numerado
objetivo        → OBJETIVO · CONDUÇÃO · OBSERVE · SE…ENTÃO · PRÓXIMO PASSO
frase_sugerida  → só a fala, curta (a tela mostra entre aspas)
perguntas       → curtas (vão para a analítica literalmente)
sinais          → "sinal — ação": o sinal virou instrução
objeções        → SIGNIFICA · OBJETIVO · FALA · DEPOIS
```

### 15.4 O que mudou de fato, além da forma

- **Os sinais viraram instruções.** Antes: "Pergunta o preço". Agora: *"Pergunta o preço —
  responda o número e volte pro 'posso mostrar?'"*. E o erro a evitar ficou explícito:
  continuar perguntando quando o lead já quer avançar.
- **As objeções ganharam a camada que faltava:** *o que aquilo significa* e *como voltar ao
  fluxo*. "Está caro" agora começa por "com pagamento no final, quase sempre é desconfiança,
  não preço" — que muda a resposta inteira.
- **As perguntas ganharam propósito e critério de interpretação**, dentro do `objetivo`:
  *"Como chega cliente novo? → se disser indicação ou Instagram, a prévia é o argumento inteiro;
  se disser Google, pergunte se acham o site ou só o perfil."*
- **Perguntas sem consequência foram removidas** (a instrução pedia): saíram
  "Vocês atendem só em São Bernardo?" e "Faz sentido pra vocês?" — nenhuma mudava o próximo
  passo.
- **Redundância consolidada:** as objeções repetidas em várias etapas foram reunidas na etapa 6.
  Ficaram nas etapas de origem só as que precisam ser respondidas no instante em que surgem
  ("eu não pedi isso", "já está publicado?", "usaram minhas fotos?").
- **Transições explícitas:** toda etapa termina em `PRÓXIMO PASSO`, incluindo os atalhos — elogio
  na etapa 2 pula direto para o convite, sem passar por contexto e qualificação.

### 15.5 Guardas automáticas da v8

O script de publicação passou a **abortar** se: alguma etapa não tiver `OBJETIVO:` e
`PRÓXIMO PASSO:`; não tiver nenhum caminho `SE …`; alguma objeção não tiver as camadas
`SIGNIFICA:` e `DEPOIS:`; alguma pergunta passar de 90 caracteres (porque vai literalmente para
a analítica); ou "fachada" aparecer sem "site". **Quatro violações reais foram pegas** na
primeira execução e corrigidas antes de publicar.

---

## 16. Versão 9 — ligação pura, e o diagnóstico das outras campanhas (2026-08-24)

Versão `132cb8f5-2fba-4c1c-8501-4356df1c3c84`, **publicada**, **9 etapas**, campanha repontada,
192 leads intactos. O roteiro da reunião (B) **não foi tocado** — ele é de reunião, não de
ligação, e a correção de canal não se aplica a ele.

### 16.1 A contradição resolvida: não se mostra prévia por telefone

O pedido queria a prévia como mecanismo central **e** canal exclusivo de voz. Não dá para
exibir imagem numa ligação — mas a própria estrutura pedida já resolvia: a etapa diz
*"**comunicar** que uma estrutura visual personalizada já foi preparada"*. Então:

> **A prévia é COMUNICADA na ligação e MOSTRADA na reunião.** Ela deixa de ser o argumento e
> passa a ser o **motivo** — que é um papel mais forte, porque curiosidade não satisfeita é o
> que faz a pessoa aceitar os 15 minutos.

Saíram do roteiro: as mensagens de WhatsApp, a legenda do mockup, os três toques de follow-up
por escrito e tudo que dependia de ela visualizar algo durante a abordagem. A guarda de
publicação agora **rejeita** qualquer bloco iniciado por `WHATSAPP:`, `LEGENDA DA IMAGEM`,
`TOQUE n` ou `MENSAGEM n`.

### 16.2 As 9 etapas e o que cada uma precisa entregar

| # | Etapa | Objetivo | Avançar quando |
| --- | --- | --- | --- |
| 1 | `abertura` | Continuar na linha por mais 30s | Ela responder qualquer coisa que não seja "não posso falar" |
| 2 | `permissao` | Tirar a ligação da categoria telemarketing | Ela entender que a ligação é sobre **ela** |
| 3 | `insight` | Comunicar que **já existe** algo pronto | Ela perguntar algo sobre a prévia |
| 4 | `descoberta` | Ler a reação: curiosa, receosa ou indiferente | Souber em qual dos três grupos ela está |
| 5 | `situacao` | *(condicional)* Uma frase dela que você possa repetir | Tiver essa frase |
| 6 | `implicacao` | Fazer a prévia parecer pensada, não gerada | Ela reagir ao raciocínio |
| 7 | `convite_reuniao` | Aceite para os 15 minutos | Houver **dia e hora** |
| 8 | `objecoes` | Destravar e devolver ao convite | Ela responder algo que não seja outra objeção |
| 9 | `proxima_acao` | Compromisso concreto + registro | Houver data registrada |

**Perguntas removidas** (não mudavam o próximo passo): quantos clientes, faturamento, número de
funcionários, há quanto tempo existe. Está escrito na etapa 5 como proibição explícita.

**Técnica incorporada do roteiro de Nail Designers** (o melhor da casa): **hipótese em vez de
pergunta seca** — *"meu chute é que a maioria chega por indicação — é assim aí?"* rende mais
conversa que *"de onde vêm seus clientes?"*.

---

### 16.3 Diagnóstico comparativo das outras campanhas

| Campanha | Leads | Produto | Abordagem atual | CTA atual | Aderência |
| --- | --- | --- | --- | --- | --- |
| **Nail Designers** | 200 | Site / presença digital | SPIN de 11 etapas com intenção psicológica por etapa; explora o "ponto cego" entre a indicação e o WhatsApp | Reunião 20-30 min: *"eu abro a tela e a gente olha juntos o que aparece quando alguém procura seu nome"* | **ALTA** |
| **Academias — Site** | 200 | Site institucional | 8 etapas; diagnóstico de presença digital | *"demonstração de 15 min mostrando como ficaria uma estrutura adaptada para a sua academia"* | **ALTA** |
| **Demo — Funileiros** | 179 | Site | 11 etapas, campanha de teste | Reunião | **MÉDIA** |
| **Academias — Conversão** | 200 | **CRM adaptado** | 8 etapas; diagnóstico de acompanhamento de interessados | Demonstração 15 min | **BAIXA / não recomendado** |

**Nail Designers — prioridade 1.** É a campanha que está mais perto da estratégia sem saber: o
CTA já promete abrir a tela e olhar junto. A diferença é que hoje ele mostra **o vazio** (o que
a cliente indicada encontra) e com prévia mostraria **o cheio**. Prévia indicada: **antes e
depois conceitual**, que aproveita o ponto cego que aquele roteiro já constrói com maestria.
Nicho visual, material público abundante (fotos de trabalho no Instagram), custo de
personalização baixo.

**Academias — Site — prioridade 2.** O roteiro **já promete** mostrar "como ficaria uma
estrutura adaptada para a sua academia" — hoje é promessa vaga. A prévia simplesmente **cumpre
o que o script já diz**. Prévia indicada: homepage conceitual com planos, modalidades,
localização e contato.

**Funileiros — prioridade 3.** Nicho visual (antes e depois de funilaria é prova forte), mas é
campanha marcada como "Demo". Vale migrar depois que as duas primeiras provarem o modelo.

**Academias — Conversão (CRM) — não migrar.** Dois motivos concretos: (a) um "CRM já montado"
sugere que **dados foram importados**, que é exatamente o mal-entendido que a Decisão 37 existe
para evitar — o risco aqui é maior que o da prévia de site, porque envolve dados de clientes
dela; (b) print de CRM não gera curiosidade por telefone como um site gera. Alternativa
possível, se quiserem testar: **não uma prévia, mas um desenho do funil típico do nicho**
apresentado como hipótese — *"numa academia costuma ser assim; é assim aí?"* —, que provoca sem
simular posse.

---

### 16.4 Análise crítica da estratégia (o que foi pedido: não só concordar)

**Onde ela melhora, e é real:**

- **Dá motivo legítimo à ligação.** O maior defeito de cold call é não ter razão para existir.
  "Montei uma prévia da sua clínica" é razão.
- **Prova trabalho antes de pedir qualquer coisa** — reciprocidade de verdade, não técnica.
- **Dá conteúdo concreto para a reunião.** Hoje: **0 reuniões em 52 ligações**. O convite
  anterior era "vamos conversar"; agora é "tem algo pronto pra você ver".
- **Diferencia de agência genérica** num nicho saturado de abordagem.

**Onde ela pode quebrar:**

1. **A conta não fecha se a prévia vier antes da primeira ligação.** Com **11,5% de
   atendimento**, produzir 192 prévias entrega ~22 conversas. A ~15 min por prévia, são
   ~48 horas de trabalho — a maior parte para quem nunca atendeu o telefone.
2. **Personalização falsa inverte o efeito.** Se for template com o nome trocado e ela
   perceber, deixa de ser atenção e vira desrespeito. O ganho depende de a prévia ser
   verdadeiramente sobre ela.
3. **Expectativa de customização.** Quem vê algo pronto tende a achar que tudo é ajustável — e
   o escopo é padronizado. O roteiro da reunião já marca o limite, mas a tensão é estrutural.
4. **Ela desloca o gargalo, não o resolve.** O gargalo medido é **contato**, não argumento.
   A prévia melhora a conversa que já acontece; não faz mais gente atender.
5. **Risco de percepção** ("fizeram um site meu sem eu pedir") — mitigado pelas três cláusulas
   obrigatórias, mas nunca zerado.

**Recomendação crítica — inverter a ordem:** produzir a prévia para a **segunda** conversa, não
para a primeira. A primeira ligação qualifica e pede permissão: *"posso montar uma prévia da
clínica de vocês e te mostrar?"*. Isso ainda é um motivo forte, **gera micro-compromisso** (ela
autorizou) e corta ~90% do custo de produção. Só quem disse sim recebe prévia. **O roteiro v9 já
suporta as duas rotas** — a variante "posso montar" está na etapa 3.

**Critérios sugeridos antes de investir tempo numa prévia:** telefone válido · atendeu ao menos
uma vez **ou** autorizou · sem site próprio (64% da carteira) · ficha com fotos e avaliações
(prova de negócio ativo e matéria-prima para a prévia) · não bloqueado / não `nao_contatar`.

**Automação — é o que decide se a estratégia escala.** `prospectador.prospects.raw_json` já
guarda o retorno do Maps: nome, fotos, avaliações, endereço, categoria, horário. Um gerador de
mockup por nicho alimentado por esse JSON é viável e transformaria a prévia de artesanato em
etapa de pipeline. **Sem isso, a estratégia não passa de algumas dezenas de leads.**

---

### 16.5 Metodologia replicável (para virar padrão da operação)

1. **Elegibilidade antes da produção** — os critérios de 16.4, aplicados como filtro no Banco de
   Leads antes de qualquer prévia ser montada.
2. **Um template por nicho**, personalizado pelos dados públicos daquele lead. Nunca um template
   único para todos.
3. **Três cláusulas obrigatórias** em qualquer roteiro que use prévia: ela **não pediu**, **não
   está publicado**, **sem compromisso**. Sem as três, o gesto vira suspeita.
4. **A prévia é comunicada na ligação e mostrada na reunião** — nunca descrita por telefone.
5. **Dois roteiros por campanha**: abordagem e reunião. Misturar quebra `etapa_alcancada`.
6. **Métricas do modelo**: prévias produzidas → ligações atendidas → reuniões marcadas →
   reuniões realizadas → vendas. A métrica que decide a continuidade é **horas de prévia por
   reunião realizada**.
7. **Versionamento**: uma versão publicada por vez, versões anteriores arquivadas, campanha
   repontada — o que já é o comportamento do módulo.

### 16.6 Guardas acrescentadas na v9

Além das da v8, o script agora **rejeita qualquer bloco de script de WhatsApp** dentro do
roteiro de ligação (`WHATSAPP:`, `LEGENDA DA IMAGEM`, `TOQUE n`, `MENSAGEM n`) e exige o bloco
`AVANÇAR QUANDO:` em toda etapa. Conferido no gravado: sobrou **uma** menção a WhatsApp, e é
"botão de WhatsApp" — parte do produto, não script.
