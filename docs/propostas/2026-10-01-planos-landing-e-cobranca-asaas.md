# Planos comerciais, landing page e cobrança recorrente (ASAAS)

> **Status:** PROPOSTA / plano futuro. Nada implementado.
> **Data:** 2026-10-01
> **Decisão do operador:** entregar primeiro os **dois planos menores** (Mínimo e Básico).
> O plano **Pro** (time comercial) é anunciado como *"em construção"* e liberado depois.

---

## 1. O que a gente quer vender

Um **CRM integrado à captação de leads**. A pessoa paga, recebe acesso, cria a
conta, ganha **7 dias de teste** e passa a trabalhar com uma **cota de leads
qualificados** (ex.: 10 ou 50, conforme o plano). Cobrança **recorrente via
ASAAS**, tudo controlado por status de pagamento.

Três planos (nomes internos; comerciais = D5):

| Plano | Para quem | O que o define | Preço (D2) | Estado |
|------|-----------|----------------|-----------|--------|
| **Mínimo** | quem quer só o app | **sem IA, sem follow-up automático**, lead cru, **poucos** leads/puxada | **R$79** | entregar agora |
| **Básico** | 1 pessoa vendendo (o que você usa hoje) | **IA + follow-up automático** + **lead cru do Maps (sem cruzamento)** + mais leads | **R$149,90** | entregar agora |
| **Pro** | time comercial | tudo do Básico + **cruzamento completo** + **Central de Ligações + CRM de equipe** | **R$600+** | **em construção** (anunciar, não liberar) |

> **A divisão em uma frase:** Mínimo = app manual · Básico = app **inteligente**
> sobre lead cru barato · Pro = **dado completo (cruzamento)** + **equipe**. O
> cruzamento, que é a parte cara, sobe pro topo; no Básico ele é **add-on** avulso.

---

## 2. A peça que FALTA hoje (o centro da proposta)

Hoje o sistema sabe **quem é a pessoa** (`papel` + `capacidades` por vínculo em
`acesso-capacidades.js`) e tem **travas operacionais** (`teto_diario`, orçamento
Bright Data/Apify). **Não existe** nenhum conceito de:

- plano contratado por empresa;
- cota de leads como *direito* da conta (só existe teto diário anti-ban);
- período de teste;
- estado de pagamento (em dia / atrasado / cancelado) que ligue/desligue acesso.

**Sem isso não dá para vender tier.** A proposta é criar **uma camada fina de
"plano da empresa"** — não um motor de permissões novo.

### 2.1. Desenho mínimo (ponytail: o mais barato que funciona)

Uma linha por empresa em `app.empresa_plano`:

```
empresa_id        (FK, UNIQUE)
plano             'basico' | 'padrao' | 'topzera'        -- CHECK fechado
status            'trial' | 'ativo' | 'atrasado' | 'cancelado'
trial_fim         timestamptz   -- fim dos 7 dias
cota_leads_mes    int           -- direito de "puxar" leads qualificados no ciclo
leads_usados_mes  int           -- consumo no ciclo corrente
ciclo_reinicia_em date          -- quando a cota zera
asaas_customer_id text
asaas_sub_id      text
```

- **Features por plano = config, não código espalhado.** Um mapa puro
  `plano → { modulos: [...], cota_leads, max_usuarios, max_instancias }` em um
  módulo tipo `services/plano-definicao.js` (PURO, dono do vocabulário), no mesmo
  padrão de `acesso-capacidades.js`. **Uma fonte de verdade**, nunca um
  `if (plano === 'basico')` espalhado pelas rotas.
- **O gate reusa o que já existe.** Módulo liberado pelo plano **E** capacidade
  do vínculo — dois `AND`, como `modo_ia` + `agente_pausado` já fazem no envio.
  O plano diz "esta empresa contratou Central de Ligações?"; a capacidade diz
  "esta pessoa pode operar ligação?".
- **A cota de lead é um direito, separado do teto anti-ban.** `teto_diario`
  continua protegendo o número do WhatsApp; `cota_leads_mes` controla quantos
  leads qualificados a conta pode **puxar/trabalhar** no ciclo. São perguntas
  diferentes e não se misturam (mesma disciplina de "duas travas, dois motivos"
  do orçamento Bright Data).

> ⚠️ **Decisão em aberto (D1):** cota é "puxar da captação paga" (Aquisição) ou
> "leads ativos no Banco de Leads ao mesmo tempo"? As duas são defensáveis. Puxar
> da captação é mais fácil de medir e amarra direto ao custo (Bright Data/Apify).

---

## 3. O que cada plano libera

Mapeado nos módulos que **já existem** no produto. A coluna "Topzera" é o que
fica *em construção*.

| Capacidade / módulo | Trial (7d) | Mínimo | Básico | Pro |
|---|:---:|:---:|:---:|:---:|
| App: Banco de Leads, Quadro do Dia, Agenda, atendimento WhatsApp **manual** | ✅ | ✅ | ✅ | ✅ |
| Follow-up **manual** | ✅ | ✅ | ✅ | ✅ |
| **Resposta automática por IA (o bot responde sozinho)** | ❌ | **❌** | ✅ | ✅ |
| **Follow-up automático** | ❌ | **❌** | ✅ | ✅ |
| Vários chips WhatsApp com fila anti-ban (ver §5.1) | 1 | 1 | **vários** | vários |
| Captação — **lead cru do Maps** (telefone, site?, status, nota) | amostra | ✅ | ✅ | ✅ |
| **Cruzamento** de dados (Instagram confirmado + página Facebook) | — | — | **add-on** | ✅ |
| **Leads por puxada** | poucos | **poucos** | **mais** | mais |
| **Velocidade de busca** (rate limit) | — | ~10 / 10 min | ~30 / 10 min | alto (c/ cap de segurança) |
| Cota total / mês (o que protege a margem) | 1 (amostra) | menor | maior | alta/negociada |
| ICP / curadoria de oportunidades | — | ✅ | ✅ | ✅ |
| Nº de usuários | 1 | 1 | 1 | **equipe** |
| **Central de Ligações** | — | — | — | 🚧 |
| **CRM comercial em equipe** (equipes, distribuição, comissão, missão, painel do dono) | — | — | — | 🚧 |

> O que separa **Mínimo** de **Básico** é objetivo: Mínimo é o **app sem
> automação** (sem IA respondendo, sem follow-up automático) e **menos leads por
> puxada**; Básico liga a automação e aumenta o volume. O que separa **Básico** de
> **Pro** é **equipe** (Central de Ligações + CRM comercial).

### 3.1. Sem automação no Trial e no Mínimo (regra do operador)

A **resposta automática por IA** (o bot respondendo sozinho) e o **follow-up
automático** **não são liberados no período de 7 dias nem no plano Mínimo**. A
pessoa trabalha manual — vê a conversa, o lead, o follow-up, dispara ela mesma —
mas o bot não assume o WhatsApp. Automação é diferencial de **Básico pra cima**.

- **Reuso, não código novo.** O produto já tem `modo_ia` por conversa (`conversa`
  = IA responde; `analise` = IA analisa e sugere, mas **não envia**) e o gate da
  "Etapa 9" que governa *quem pode ligar a IA*. O plano vira **mais um `AND`**: a
  resposta conversacional só sai com `status='ativo'` **E** `plano ∈ {basico,
  pro}` **E** `modo_ia='conversa'` **E** capacidade do vínculo. Já existe o ponto
  exato (os dois enviadores, `core-funnel.js` e `contexto2-responder.js`) — o gate
  entra ali, não no webhook. O **follow-up automático** (`followup-auto.js`) ganha
  o mesmo `AND` de plano.
- **Instância do Mínimo/Trial nasce sem IA automática** (`modo_ia='analise'` ou
  `ativo=false`, exatamente o que a Etapa 9 já faz quando o criador não pode ligar
  a IA). Nada no motor muda; muda só o que o plano permite.
- **Importante: trial NÃO economiza IA, ele a bloqueia.** O custo de LLM da
  análise interna continua; o que não acontece é o **envio** da resposta ao
  cliente. (É o comportamento declarado do modo Análise.)

### 3.2. Cota = "puxadas" de leads frescos, e a conta de margem

**Resolvido (D1):** a cota é a quantidade de leads **frescos** que a pessoa pode
**puxar** (coletar + cruzar). Dois limites, não um:

- **Leads por puxada** — quanto vem a cada clique de "puxar". Mínimo = poucos,
  Básico = mais. Limitar o volume por puxada é o freio que protege seu custo e
  evita o problema de "puxou 500 de uma vez".
- **Cota de puxadas / mês** — quantas vezes pode puxar no ciclo. Zera na renovação.

**Por que puxar FRESCO custa dinheiro (e por isso tem cota):** cada lead cruzado
gasta crédito pago. Ordem de grandeza, do motor atual:

- Maps (descoberta): ~1 crédito Bright Data / lead.
- Instagram (enriquecimento): ~1 consulta SERP **+** ~1 crédito de dataset / lead
  que precisa.
- Meta Ads (Apify): custo por resultado (pay-per-result).

**A fórmula da margem** (é isto que fecha os preços D2):

```
custo_por_lead ≈ (créditos_por_lead × R$/crédito_BrightData) + (R$/resultado_Apify)
custo_do_plano/mês ≈ custo_por_lead × leads_por_puxada × puxadas_no_mês
preço_do_plano     ≈ custo_do_plano / (1 − margem_alvo)
```

> ⚠️ **Preciso de você pra calcular (D11):**
> 1. **R$ por crédito** Bright Data (o que você paga hoje por crédito/pacote).
> 2. **R$ por resultado** no Apify (Meta Ads).
> 3. **Margem alvo** (ex.: 70%).
> 4. Quanto é "**poucos**" (Mínimo) e "**mais**" (Básico) por puxada — ex.: 10 e 30?
> 5. Quantas **puxadas/mês** em cada plano.
>
> Com esses 5 números eu te devolvo o custo/mês por plano e um piso de preço.
> Você acha que **10 por puxada** resolve — então uso 10 como base do Mínimo até
> você confirmar.

**Trial e abuso (liga em D9):** a amostra do trial sai de um **pool de leads já
coletados** (custo marginal ~zero) em vez de puxar fresco a cada cadastro —
senão cada signup de trial vira custo real e vira alvo de garimpo (abrir 50
trials). É a opção segura e é a recomendação.

> ⚠️ **D2 (preços):** valores em R$/mês ficam com você. Sugestão de estrutura:
> Básico isca barata, Padrão o "carro-chefe", Topzera premium. Deixar placeholder
> `R$ —` na landing até você fechar.
>
> ⚠️ **D3:** "Captação limitada" no Básico = quanto? Opção simples: Básico **não**
> tem captação paga (só trabalha leads importados/manuais) e os 10 leads vêm de
> uma amostra; Padrão puxa 50/mês da captação paga. Isso separa bem os dois e
> protege seu custo de Bright Data no plano barato.

---

## 4. Fluxo de pagamento e provisionamento (ASAAS)

ASAAS **já faz** assinatura recorrente, cobrança (Pix/boleto/cartão) e **webhooks**.
Ponytail: **não construir sistema de cobrança** — consumir o webhook do ASAAS e
refletir o estado em `empresa_plano`.

**Trial é SEM cartão (D4 resolvido) → a conta nasce no CADASTRO, não no pagamento.**
O ASAAS só entra quando a pessoa vai **continuar** (pagar).

```
CADASTRO (trial, sem ASAAS):
1. Landing → "Testar 7 dias" → formulário com CPF (obrigatório)
2. Valida CPF ÚNICO (1 trial por CPF) → cria empresa + owner +
   empresa_plano{status:'trial', trial_fim:+7d} → e-mail de acesso
3. Pessoa usa 7 dias

CONVERSÃO (quando vai pagar, aí sim ASAAS):
4. Escolhe plano → POST /v3/customers (cpfCnpj) + POST /v3/subscriptions
   (billingType=UNDEFINED → pessoa escolhe Pix/boleto/cartão no checkout)
5. Paga → webhook PAYMENT_CONFIRMED/RECEIVED → status trial→'ativo'
6. Renovações: webhook mantém 'ativo'
7. PAYMENT_OVERDUE → 'atrasado' (bloqueia) · cancelou → 'cancelado'
```

> **CPF faz dois trabalhos:** o ASAAS **já exige** `cpfCnpj` pra criar o cliente, e
> o mesmo CPF é a **trava anti-abuso** do trial (1 por CPF). Guardado como PII (não
> logar). Trava no banco: `UNIQUE` do CPF (normalizado) na tabela de trials.

### 4.1. Detalhes da API ASAAS (confirmados na doc oficial, 2026-10-01)

- **Base URL:** sandbox `https://api-sandbox.asaas.com/v3` · produção
  `https://api.asaas.com/v3`. Começar no **sandbox**.
- **Autenticação:** header **`access_token`** = a API Key da conta. A chave fica no
  painel ASAAS (Configurações → Integrações → API). Sandbox tem chave própria.
- **Criar cobrança recorrente:** `POST /v3/customers` (cria/recupera cliente) →
  `POST /v3/subscriptions` com `customer`, `billingType`, `value`, `nextDueDate`,
  `cycle` (ex.: `MONTHLY`). `billingType` = `CREDIT_CARD` (recorrência automática),
  `PIX`/`BOLETO` (gera cobrança por ciclo) ou `UNDEFINED` (cliente escolhe).
- **Webhook — validação de origem:** o ASAAS envia o header **`asaas-access-token`**
  com um token que **NÓS definimos** no cadastro do webhook (⚠️ **não** é a API Key).
  Nosso endpoint valida esse header antes de processar.
- **Entrega "at least once":** o mesmo evento pode chegar várias vezes → **persistir
  `event.id` e ser idempotente** (mesmo princípio do webhook Freelandoo e da
  quarentena). Após **15 falhas** consecutivas a fila do ASAAS pausa → o endpoint
  tem que responder 2xx rápido e processar em background.
- **Eventos que importam:** `PAYMENT_CONFIRMED` / `PAYMENT_RECEIVED` → provisiona/
  ativa · `PAYMENT_OVERDUE` → `atrasado` · cancelamento de assinatura → `cancelado`.

### 4.1.1. Regras duras (segurança — não simplificar)

- **Estado de pagamento é a fonte da verdade do acesso**, lido no
  `requireEmpresaAccess` (onde o vínculo já é resolvido — custo de I/O zero extra,
  como o aceite do termo, migration 084). `trial` e `ativo` passam; `atrasado`
  entra em **modo leitura/aviso**; `cancelado` bloqueia com mensagem (não erro
  genérico) — vocabulário próprio tipo `403 PLANO_INATIVO`.
- **API Key ASAAS cifrada em repouso** (reusar `src/segredos-crypto.js`, como
  Meta/Freelandoo). Nunca logar a chave, o `asaas-access-token` nem PII do webhook.
- **Envs novas:** `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN` (o que vamos pôr no
  `asaas-access-token`), `ASAAS_BASE_URL` (sandbox/prod). A URL pública do webhook
  reusa `PUBLIC_BACKEND_URL` (já existe, do Freelandoo). Documentar em `AGENTS.md` +
  `.env.example`.

**Resolvido:** `billingType = UNDEFINED` (cliente escolhe Pix/boleto/cartão no
checkout). Trial **sem cartão** (D4). Cartão recorrente automático fica como
melhoria futura.

### 4.1.2. Cadastro do webhook no painel ASAAS (passo a passo)

No painel ASAAS → **Configurações → Integrações → Webhooks** (ou via API), criar 1
webhook:

- **URL:** `{PUBLIC_BACKEND_URL}/asaas/webhook` (endpoint que vamos criar; montado
  com `express.raw` **antes** do `express.json`, pra validar o corpo byte-a-byte,
  como o do Freelandoo).
- **Token de autenticação:** o valor de `ASAAS_WEBHOOK_TOKEN` (**nós geramos**, você
  cola aqui). A ASAAS devolve esse valor no header `asaas-access-token` a cada
  chamada; o endpoint recusa se não bater.
- **Eventos a marcar:** `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE` e
  os de **assinatura/cancelamento**. (Marcar só o que usamos; menos ruído.)
- **Fila:** ativa. Lembrar: "at least once" + pausa após 15 falhas → endpoint
  responde **2xx rápido** e processa em background, idempotente por `event.id`.

---

### 4.2. Termo de risco ao conectar o WhatsApp (multi-chip)

Quando a pessoa chega na tela de instância e vai conectar o WhatsApp dela
(inclusive ao conectar **vários** números), o sistema:

1. **Explica rápido** o que é a instância ("é o seu WhatsApp conectado ao
   sistema") e o diferencial da fila anti-ban (§5.1).
2. **Deixa claro o risco**, em texto honesto: *o WhatsApp não autoriza disparo
   automático; existe risco de bloqueio do número; o sistema reduz esse risco
   (fila, intervalo, teto), mas não elimina; o uso é por conta e risco de quem
   conecta.*
3. **Exige aceite explícito** antes de conectar — e **registra** que a pessoa
   aceitou, com data, usuário e **versão do termo**.

**Reuso, não invenção (resolve D10):** é o mesmo mecanismo do termo de programa já
existente (`services/programa-aceite.js` + `programa-termo.js`, tabela
append-only `app.programa_aceites`, migration 084). Entra um **novo valor de termo**
(`risco_whatsapp`) — alargando a CHECK no mesmo diff do executor, exatamente como o
projeto já faz ("valor de vocabulário nasce junto do executor"). O texto do termo
fica **versionado no fonte**; mudar o texto sobe a versão e **volta a pedir aceite**.

- **O gate vive na rota de conexão** (`routes/api-whatsapp.js`, onde o vínculo
  instância↔empresa nasce — "origem autorizada", migration 061). Sem aceite válido,
  **409/403 com o termo a exibir**, nunca conecta. Isso cobre QR e, por simetria, o
  provisionamento.
- **Append-only + auditoria:** cada aceite vira linha (sem PII), e a conexão fica
  rastreável a um aceite específico.

**Resolvido (D12):** aceite **a cada número conectado** (registro mais forte). Cada
nova conexão exige aceite próprio → a chave do aceite inclui a **instância/número**,
não só (empresa, usuário). Append-only: fica o histórico de qual número foi aceito,
quando e por quem.

### 4.3. Cadastro e trial (o desenho da #2)

**Cadastro (formulário da landing):** nome, e-mail, **CPF** (obrigatório), senha.
Regras de entrada (trust boundary — validar no backend, não só na tela):

- **CPF válido e ÚNICO** → **1 trial por CPF** (trava anti-abuso no banco, `UNIQUE`
  do CPF normalizado). CPF reutilizado → recusa com mensagem clara.
- **E-mail único** (já é regra do login hoje).
- CPF é PII: guardado, **nunca logado**; é o mesmo `cpfCnpj` que o ASAAS exige na
  conversão, então não é dado "a mais".

**O que o trial INCLUI (7 dias):** o produto manual + **busca no POOL** (não na
Bright Data → custo zero). SEM IA automática, SEM follow-up automático, SEM
cruzamento (D7). Ver §4.4 pra o mecanismo do pool.

**A "busca" do trial roda sobre a NOSSA base, não na internet:**
- A pessoa escolhe **nicho + cidade** entre os que **já temos no pool** (nichos e
  cidades reais do banco — ex.: energia solar em Goiânia). O seletor só oferece o
  que existe.
- A busca filtra o pool e devolve leads reais; ela "puxa" pro banco dela. **Zero
  chamada paga.** Sensação de uso real, custo marginal ~zero.
- Cada puxada vira **registro de auditoria por empresa** (`app.auditoria_eventos`) e
  acumula no painel dela ("o que você já buscou").
- **Após os 7 dias:** libera a **busca fresca de verdade** (Bright Data, onde
  quiser). É o gancho de conversão — "passados 7 dias, pesquise onde quiser".

**Fim do trial (dia 7, sem pagamento):** conta entra em **`expirado`** → acesso
**bloqueado com tela de "escolha um plano"**, **dados preservados** (nunca apagar —
mesma regra do `cancelado`, D6). Pagou → `ativo`, tudo volta.

```
status do empresa_plano: trial → (paga) ativo → (atrasa) atrasado → (cancela) cancelado
                         trial → (7 dias sem pagar) expirado → (paga) ativo
```

**Resolvido:** cadastro exige **telefone** (além de CPF). Trial = **10 leads/dia**
do pool (teto DIÁRIO, zera à meia-noite no `APP_TIMEZONE`).

### 4.4. Pool compartilhado — a base única (a busca do trial sai dela)

**O pool = `prospectador.prospects` acumulado de todas as empresas** (a "base
gigante"). O admin/superadmin já enxerga cross-tenant (papel de plataforma); o novo é
**expor uma visão filtrada do pool pro usuário do trial**. É o **Lever 2 do §9.8**
virando mecânica de produto: o que já foi coletado é reaproveitado a custo zero.

- **Nichos/cidades sugeridos = o que existe no pool** (`SELECT DISTINCT nicho`,
  `cidade/uf` com dados). Nada de prometer busca onde não há dado.
- **Fonte: leads PARADOS + DESCARTADOS.** O pool oferece (a) leads **nunca
  trabalhados** (sem `responsavel_id`, sem abordagem) e (b) leads **descartados**
  (`qualificacao='descartado'` / status `rejeitado`/`nao_contatar`) — o que uma
  empresa jogou fora, outra pode querer. **Nunca** um lead que um cliente pagante
  está trabalhando agora.
- **Chega "zerado", com histórico só da empresa dele.** Puxar no trial = **linha
  própria no banco da empresa dela** (dedup é por empresa), então o lead aparece sem
  trabalho nenhum de terceiros, e o histórico (disparos, ligações, follow-ups) que
  acumula é **o da empresa dela** com aquele lead. Dois usuários podem pegar o mesmo
  negócio — aceitável (cross-tenant o mesmo negócio já é trabalhável por empresas
  diferentes hoje).

**Resolvido:**
- **D19 — sem rótulo** (decisão do operador). A busca do trial não precisa de aviso.
  Único limite: a tela **não deve afirmar** "busca ao vivo/nova na internet" (claim
  falso ≠ não ter claim). Sem rótulo, sem claim → ok.
- **D20 — dado público.** São telefones comerciais públicos (Maps); só coletamos o
  que já é público. Termos de Uso + Política de Privacidade continuam **obrigatórios
  pro SaaS de qualquer forma** (conta, pagamento, ASAAS) — table-stakes, não trabalho
  extra do pool.

> ⚠️ **D21 — ISOLAMENTO: o pool é uma exceção DELIBERADA ao tenant.** Todo o
> AGENTS.md é sobre **não vazar entre empresas**, e os recortes do Banco de Leads
> filtram por `empresa_id` + responsável. Expor o pool ao trial **cruza essa
> fronteira de propósito** → tem que ser um **read dedicado** (uma função/rota de
> "pool", read-only, só leads **sem dono**), **nunca** afrouxar as consultas que já
> existem. Afrouxar o filtro atual vazaria lead trabalhado de cliente pagante. É o
> cuidado técnico nº1 desta feature.

## 5. Landing page (poucas seções, de qualidade)

Objetivo: transmitir valor e converter. Seções, em ordem:

1. **Hero** — promessa em uma frase ("CRM + captação de leads que trabalha no
   WhatsApp") + **selo "Beta — já funcional para trabalho"** + CTA "Começar" +
   prova visual (print real do Banco de Leads / Quadro do Dia).
2. **O problema → a virada** — 3 dores (lead frio, follow-up esquecido, planilha)
   viram 3 ganhos.
3. **Diferenciais** — os dois abaixo (§5.1 e §5.2), que é o que o concorrente
   genérico não tem.
4. **Como funciona** — 3 passos: capta e cruza dados → qualifica (ICP) →
   atende/agenda.
5. **Planos** — 3 cards. Topzera com selo **"Em construção / em breve"** e lista
   do que vem (Central de Ligações, CRM de equipe). Cria desejo sem prometer o que
   ainda não entrega.
6. **Resultado** — o ganho concreto que isso gera (ver §5.3).
7. **CTA final** — "7 dias para testar" + assinar.
8. **Rodapé** — contato, termos, privacidade, **aviso de beta**.

### 5.1. Diferencial: vários chips com fila anti-ban inteligente

Headline: *"Conecte quantos chips quiser — o sistema sabe disparar sem queimar
número."* A pessoa pode trabalhar **por risco próprio** com N números; o sistema
**não dispara todos ao mesmo tempo**: ele enfileira os números, respeita um
**intervalo entre disparos** e uma **janela de delay aleatório** entre mensagens,
e segue a fila (manda 1, 2, 3, 4, 5…) com teto diário por número.

- **Já existe no motor** (reuso, não feature nova): cooldown por instância
  (`RODAR_LEADS_COOLDOWN_MIN`), delay aleatório (`RODAR_LEADS_DELAY_MIN_MS` /
  `_MAX_MS`), teto diário (`RODAR_LEADS_TETO_DIARIO`), fila de disparo
  (`rodar-leads.js` / modo Automático) e a regra de **instância de envio provada**
  (sem mandar pelo número errado).
- Na landing isso vira "mais seguro", não só "mais rápido".

### 5.2. Diferencial: a ferramenta CRUZA dados, não só coleta

Headline: *"Um lead chega inteiro, não pela metade."* O sistema não para no que
achou numa fonte — ele **cruza**: pega o anúncio/página do Facebook, descobre e
confirma o **telefone**, pesquisa o perfil, checa se o **Google Places/Maps** está
ativo ou não, se tem **site próprio** ou não, monta o **ICP**, e entrega tudo
numa tela onde a pessoa trabalha em **poucos cliques** — com **IA conversando
entre os dados** (explicando por que o lead vale, qual a lacuna digital).

- **Já existe no motor** (reuso): pipeline de enriquecimento
  (`enriquecimento-worker.js`), descoberta/confirmação de Instagram (migrations
  080/082), cross-reference com a página do Facebook via Bright Data
  (`meta-ads-worker.js`, migration 092), classificação canônica de site
  (`site-classificacao.js`), situação do Maps, ICP (`lead-icp-score.js`) e o
  Assistente de Oportunidades.
- É o **"um cérebro só"** que amarra as fontes — conectar com a proposta
  `2026-09-30-um-cerebro-ia-comercial.md`.

### 5.3. Mostrar o resultado (sem inventar)

A seção de resultado deve mostrar o **ganho concreto**: lead que chega pronto,
tempo economizado por lead, follow-up que não escapa, agenda que enche.
⚠️ **Números só se forem reais** (dados seus / de clientes com permissão).
**Não fabricar prova social, depoimento ou métrica** — regra do projeto. Enquanto
não houver número real, usar **demonstração visual** (print/vídeo do fluxo) em vez
de estatística inventada.

> Stack: Next.js (já é o `frontend/`), tokens/tema do design system do projeto
> (ver skill `padrao-visual`). Nada de biblioteca nova sem necessidade.
> Motion/3D (GSAP etc.) só se agregar — opção, não obrigação.

---

## 6. Faseamento (por que os dois primeiro)

- **Fase 1 — vender já (Mínimo + Básico):** `empresa_plano`, `plano-definicao.js`,
  gate no `requireEmpresaAccess`, gate de IA/follow-up automático por plano, cota de
  puxadas, webhook ASAAS, provisionamento, trial 7d, landing. **Pro só aparece como
  "em breve".**
- **Fase 2 — Pro:** ligar os módulos de equipe (que **já existem**: Central de
  Ligações, equipes, distribuição, comissão, missão, painel do dono) ao gate de
  plano. Pouco código novo — é quase só liberar no mapa de features e permitir
  multiusuário/várias instâncias por plano.

O risco baixo da Fase 2 é justamente **porque os módulos top já estão prontos e
testados** — falta a camada de plano que a Fase 1 constrói.

---

## 7. Decisões em aberto (precisam de você)

**Resolvidas nesta conversa:**
- ~~**D1**~~ ✅ Cota = **puxar leads frescos**, com dois limites (leads/puxada +
  puxadas/mês) + rate limit por plano (§3.2, §9.10).
- ~~**D3/D8**~~ ✅ **Mínimo = sem automação** (sem IA, sem follow-up automático),
  **com captação paga limitada** (rate-limited) e lead cru. Básico é o workhorse.
- ~~**D4**~~ ✅ **Trial SEM cartão.** A conta nasce no cadastro; o ASAAS só entra na
  conversão (§4).
- ~~**D9/D16**~~ ✅ Anti-abuso = **1 trial por CPF**. Trial **não chama Bright Data**:
  a "busca" roda sobre o **pool compartilhado** (leads parados, nicho/cidade que já
  temos), custo ~zero; busca fresca só após os 7 dias (§4.4).
- ~~**D10/D12**~~ ✅ Termo de risco do WhatsApp reusa o aceite (migration 084) na
  rota de conexão, **a cada número conectado** (§4.2).
- ~~**D-cobrança**~~ ✅ `billingType = UNDEFINED` (cliente escolhe no checkout).
- ~~**D15**~~ ✅ Cruzamento = **add-on por lead no Básico**, **incluído no Pro** (§9.9).
- ~~**D17**~~ ✅ Trial = **10 leads/dia** do pool (teto diário).
- ~~**D18**~~ ✅ Cadastro exige **telefone** (além de CPF).
- ~~**D19**~~ ✅ **Sem rótulo** na busca do trial (só não afirmar "busca ao vivo").
- ~~**D20**~~ ✅ Dado público; termos/privacidade são table-stakes do SaaS.
- ~~**D14**~~ ✅ Turno = modelo barato; modelo capaz **só pra gerar contexto** (raro),
  não pesa na margem.
- ~~**D21**~~ ✅ Pool = read dedicado de leads **sem trabalho + descartados**, clean
  slate com histórico por empresa (§4.4). Operador concordou.
- ~~**D2**~~ ✅ **Mínimo R$79** · **Básico R$149,90** · **Pro R$600+**.
- ~~**D5**~~ ✅ Nomes comerciais = **placeholder** por ora; decidir depois com skill de
  copy.
- ~~**D6**~~ ✅ Cancela/expira = **bloqueia + guarda os dados**; recupera tudo ao voltar
  a pagar. Nunca apaga.
- ~~**D7**~~ ✅ IA **sempre desligada** no **trial e no Mínimo**; Básico pra cima tem IA.

**Ainda abertas (não bloqueiam a build):**
- **D11** — R$/crédito Bright Data + split Maps vs cruzamento. **Estrutura aceita**;
  falta só o número real pra trocar os ilustrativos.
- **D5-final** — nomes comerciais definitivos (copy).

---

## 8. Resumo técnico (o que é novo vs. reuso)

**Novo:** `app.empresa_plano` (1 migration), `services/plano-definicao.js` (puro),
leitura de status no `requireEmpresaAccess`, cliente + webhook ASAAS, fluxo de
provisionamento, landing.

**Reuso:** controle de acesso (`acesso-capacidades.js`), todos os módulos de
produto (captação, Banco de Leads, Central de Ligações, CRM equipe), padrão de
webhook assinado (Freelandoo), cripto de segredo (`segredos-crypto.js`),
design system do `frontend/`.

> Nenhuma linha deste plano foi implementada. Próximo passo sugerido: você fecha
> D1–D6, e a gente detalha a Fase 1 em tarefas pequenas (migration → módulo puro →
> gate → webhook → landing), cada uma com `npm test`.

---

## 9. Levantamento de custos e margem (estimativa)

> **O consumo** (quantas chamadas, quantos créditos) saiu do código e é confiável.
> **Os preços unitários** marcados `⚠️confirmar` são de lista pública / precisam da
> sua fatura real. Câmbio assumido **US$1 ≈ R$5,40** `⚠️confirmar`.

### 9.1. As quatro fontes de custo

| Fonte | Tipo | Dispara quando | Afeta planos |
|---|---|---|---|
| **LLM (IA)** | variável | cada mensagem/turno + follow-up + geração | Básico, Pro (Mínimo/Trial **não** têm IA) |
| **Captação (Bright Data + Apify)** | variável | cada lead **puxado/cruzado** | todos (pela cota) |
| **Evolution (WhatsApp)** | semi-fixo | por **instância/chip** conectado | todos (multi-chip pesa) |
| **Infra** (Railway + Vercel + Postgres) | fixo | sempre | rateado entre todos |

### 9.2. LLM — a alavanca dos 10×

Do código: o turno junta extração + resposta na **mesma** chamada
(`extrairEDecidirBundle`), modelo principal configurável, `maxTokens=1200`. Prompts
de sistema somam **~105 KB (~26K tokens)**, mas são estáveis → **prompt caching**
derruba o custo de entrada. Estimativa por turno: ~8–12K tokens de entrada
(com cache, fração disso) + ~400–600 de saída.

**Custo por 1.000 turnos de IA** (entrada 10K + saída 500, sem cache; preços de
lista `⚠️confirmar`):

| Modelo | US$ in/out por Mtok | ~US$/1k turnos | ~R$/1k turnos |
|---|---|---|---|
| `gpt-4o-mini` | 0,15 / 0,60 | ~US$1,8 | **~R$10** |
| Claude Haiku 4.5 | ~1 / 5 | ~US$12 | ~R$65 |
| `gpt-4o` | 2,5 / 10 | ~US$30 | ~R$160 |
| Claude Sonnet 4.6 | ~3 / 15 | ~US$38 | ~R$205 |

> **Recomendação:** rodar o caminho conversacional em **`gpt-4o-mini` ou Haiku** e
> reservar Sonnet/Opus só para tarefas pesadas (reescrita de prompt, playbook). Com
> prompt caching, o número cai mais. Isso mantém a IA quase irrelevante no custo.
> *Suposição de volume (D13):* quantos turnos de IA/mês um cliente Básico gera?
> Ex.: 1.500 turnos → **~R$15/mês** em `gpt-4o-mini`, ~R$300 em Sonnet.

### 9.3. Captação — o custo dominante (e por isso a cota existe)

Do código, um lead **totalmente cruzado** gasta ~**3–6 créditos** Bright Data
(Maps ~1 + Instagram SERP ~1 + dataset ~1 + página FB ~1) **+** eventual resultado
Apify (Meta Ads). Conta gratuita = **4.760 créditos**.

```
custo_lead  ≈ créditos_lead × R$/crédito(⚠️D11) + R$/resultado_Apify(⚠️D11)
custo_capt/mês ≈ custo_lead × leads_por_puxada × puxadas_mês
```

Exemplo **ilustrativo** (5 créditos/lead; **R$/crédito a confirmar** — digamos
R$0,10): custo_lead ≈ **R$0,50**. Básico com 30 leads × 10 puxadas = 300 leads/mês
→ **~R$150/mês** só de captação. **Este é o número que manda no preço** — por isso
preciso do R$/crédito real (D11).

### 9.4. Evolution + Infra

- **Evolution (WhatsApp):** auto-hospedado (`EVOLUTION_URL`). Não cobra por
  mensagem, mas **cada chip conectado consome recurso** do servidor. O diferencial
  "conecte N chips" **puxa custo de infra** conforme a base cresce — é semi-fixo,
  não zero. `⚠️confirmar` a fatura do serviço Evolution no Railway.
- **Infra fixa:** Railway (backend + Evolution + Postgres `vendas`/`prospectador`) +
  Vercel (frontend). Ordem de grandeza hoje: **~US$20–50/mês** `⚠️confirmar` (dá pra
  puxar os números reais via Railway MCP se você quiser). É **rateado**: com 10
  clientes, ~R$30/cliente; com 100, ~R$3.

### 9.5. Três cenários de uso (leve / normal / pesado)

```
custo_cliente/mês ≈ captação + LLM(se Básico+) + fatia_de_infra
```

Consumo por cenário **ilustrativo** (`⚠️calibrar` — o "normal" tem que ser o **seu
uso real de hoje**, D13):

| Cenário | Leads puxados/mês | Turnos de IA/mês | Chips |
|---|---|---|---|
| **Leve** (uso tranquilo) | ~100 | ~300 | 1 |
| **Normal** (seu uso hoje) | ~300 | ~1.500 | 1–2 |
| **Pesado** (pior caso) | ~800 | ~5.000 | 4–6 |

**Custo/mês por cenário** (preços ilustrativos: **R$0,50/lead** [5 créditos ×
R$0,10 ⚠️D11] + IA em **`gpt-4o-mini`** + infra rateada):

| Cenário | Captação | LLM | Infra | **Custo/mês** |
|---|---|---|---|---|
| **Leve** | ~R$50 | ~R$3 | ~R$10 | **~R$63** |
| **Normal** | ~R$150 | ~R$15 | ~R$10 | **~R$175** |
| **Pesado** | ~R$400 | ~R$50 | ~R$20 | **~R$470** |

> ⚠️ Se a IA rodar em **Sonnet** em vez de `gpt-4o-mini`, o LLM pula de ~R$15 para
> ~R$300 no cenário Normal (10×) — some direto no custo. É a decisão D14.

### 9.6. Dos cenários para os planos (com preços definidos)

A chave da nova divisão: **o Básico NÃO faz cruzamento** (lead cru do Maps, barato),
e o **cruzamento sobe pro Pro** (ou vira add-on). Com isso o Básico cabe em
R$149,90 com margem saudável:

| Plano | O que entrega | Custo/mês* | **Preço** | Margem |
|---|---|---|---|---|
| **Mínimo** | app manual, lead cru, sem IA | ~R$40 | **R$79** | ~49% |
| **Básico** | IA + follow-up auto, **lead cru** (sem cruzamento) | **~R$55** | **R$149,90** | **~63%** |
| **Pro** | **cruzamento completo** + equipe | ~R$200–470 | **R$600+** | ~22–67% |

\* ilustrativo, IA em `gpt-4o-mini`, R$/crédito a confirmar (D11).

> ✅ **D14 resolvido:** caminho **conversacional** do Básico = **modelo barato**
> (`gpt-4o-mini`/Haiku) → custo ~R$55 → margem **63%**. O modelo **capaz** (Sonnet)
> fica **só pra gerar contexto** (tarefa rara, ex.: reescrita de prompt/overlay),
> não pro trabalho por turno — então não pesa na margem. (Em Sonnet por turno o plano
> daria **prejuízo de ~R$190/mês** a R$149,90; por isso o gate de plano força o
> modelo barato no turno.)

> ⚠️ **Pro a R$600 precisa de disciplina de uso:** com equipe pesada (cruzamento de
> muitos leads + vários atendentes) o custo pode passar de R$470 e a margem afina.
> Por isso o Pro provavelmente é **por assento** e/ou com **cota de cruzamento
> definida**, não "ilimitado por R$600" (D-Pro, Fase 2).

### 9.7. Análise por plano

Cada plano com seu perfil de consumo e os pontos de custo que **importam nele**.
Números ilustrativos (fecham com D11/D13/D14).

#### Análise — Plano 1: MÍNIMO (cenário Leve, sem automação)

- **Perfil:** 1 pessoa, 1 chip, CRM manual, poucos leads/puxada. Sem IA
  automática, sem follow-up automático.
- **LLM:** deve ser **R$0 — mas tem pegadinha.** Pôr a instância em
  `modo_ia='analise'` **não** zera o custo: o motor ainda roda o turno e **descarta**
  a resposta ("o modo Análise NÃO economiza IA" — AGENTS.md). Pra ser R$0 de
  verdade, o plano Mínimo tem que **pular o turno inteiro** (não enfileirar
  `webhook_resposta`), não só silenciar a saída. **Ponto de implementação, não de
  preço.**
- **Captação:** existe, mas volume baixo (poucos leads/puxada). É o único custo
  variável real do Mínimo.
- **Evolution/chips:** 1 chip → mínimo.
- **Custo estimado:** ~R$60/mês (quase só captação + fatia de infra).
- **Perguntas deste plano:** quantos leads/puxada e puxadas/mês? A captação do
  Mínimo é **fresca** ou sai de **pool** (barato)? Vale ter captação paga aqui ou
  Mínimo só trabalha leads já importados?

#### Análise — Plano 2: BÁSICO (cenário Normal = seu uso hoje)

- **Perfil:** 1 pessoa, 1–2 chips, **com IA + follow-up automático**, captação
  normal. É o workhorse.
- **LLM:** o custo depende de **dois números** — turnos/mês (D13) e **modelo**
  (D14). `gpt-4o-mini` ≈ R$15/mês; Sonnet ≈ R$300/mês. **Maior alavanca do plano.**
- **Captação:** volume médio (ex.: 300 leads/mês) → **o maior custo** (~R$150 com
  R$0,50/lead). Sensível ao R$/crédito (D11).
- **Evolution/chips:** 1–2 chips → baixo.
- **Custo estimado:** ~R$175/mês (captação domina).
- **Perguntas deste plano:** D13 (seu volume real), D14 (modelo em produção),
  leads/puxada e cota de puxadas do Básico.

#### Análise — Plano 3: PRO (cenário Pesado + equipe) — em construção

- **Perfil:** **equipe** (vários usuários), vários chips, tudo do Básico +
  **Central de Ligações + CRM comercial**.
- **LLM:** escala com **nº de atendentes × conversas** — pode ser o maior custo de
  IA dos três; reforça usar modelo barato no caminho conversacional.
- **Captação:** alta/negociada (cota maior).
- **Evolution/chips:** vários chips → **infra pesa de verdade** aqui (cada chip
  consome recurso). Candidato a **limite de chips** ou cobrança por chip extra.
- **Central de Ligações:** ligação é **manual, feita pela pessoa no telefone dela**
  — **não há custo de telefonia no produto** (bom). O custo do Pro é usuários +
  chips + captação, não a ligação em si.
- **Custo estimado:** ~R$470+/mês, cresce com o tamanho do time.
- **Perguntas deste plano:** preço é **por conta** ou **por assento**? A cota de
  leads é **da empresa** ou **por usuário**? Limite de chips? (tudo isso é Fase 2.)

### 9.8. Como baixar o custo de captação (a maior despesa)

Levers reais, do código, em ordem de impacto:

1. **Enriquecer SOB DEMANDA, não em massa (o maior lever).** Hoje é **eager**:
   `prospecting.js:1333` enfileira o Instagram de **todo** lead coletado — uma busca
   traz até 200 e paga perfil nos 200, mesmo que você trabalhe 10. Se o **perfil
   Instagram** (o crédito caro de dataset) for adiado para quando o lead é
   **puxado / reivindicado / aprovado no ICP**, você paga só pelos leads que
   realmente entram na operação. Corte potencial = razão trabalhados/coletados
   (muitas vezes **80–95%**). **Encaixa exatamente no "cota = puxadas"**: o crédito
   só é gasto no ato de puxar. *(Mudança de código, Fase futura — hoje a base do
   Maps + Instagram do Google Meu Negócio, que é grátis, já cobre o lead; o perfil
   pago vira lazy.)*
2. **Pool de leads entre clientes (cache cross-tenant).** O dedup é **por empresa**
   (`ON CONFLICT (empresa_id, place_id)`): o mesmo negócio coletado por dois
   clientes é **pago duas vezes**. Um **pool da plataforma** por `place_id` serve o
   2º cliente a ~0 crédito. É dado público de negócio, então é defensável — e **é o
   mesmo pool que alimenta a amostra do trial** (D9). Grande lever à medida que a
   base cresce. *(Decisão de produto + código.)*
3. **Ficar no tier grátis no volume baixo.** 4.760 créditos/mês grátis. Cliente
   Leve/Mínimo pode custar **R$0** de captação se o total ficar abaixo — o teto
   diário já protege. No volume baixo, captação ≈ zero.
4. **Puxar perto da cota.** Se "puxar 10" coleta 200 e mostra 10, paga Maps por 200.
   Coletar perto do que será consumido corta o custo do Maps (~1 crédito/lead).
5. **Cache de perfil com TTL maior.** Já existe `enfileirarPerfisComCacheVencido` —
   alongar o TTL evita repagar o mesmo perfil.
6. **Não seguir link da bio** — já é o default (`BRIGHTDATA_SEGUIR_LINK_BIO=off`).
   Manter.

> **Resumo:** os itens **1 e 2** podem derrubar a captação de "o maior custo" para
> uma fração. O 1 é o mais barato de fazer e já combina com a cota de puxadas. Os
> dois são Fase futura (mudam código), mas **mudam a conta de margem o suficiente
> pra valer a pena antes de fixar preço** — recomendo decidir o lever 1 junto com
> D1/D11.

### 9.9. Opção: Básico "sem cruzamento" (lead cru do Maps) + cruzamento como add-on

> Terminologia: aqui **"cruzamento"** = a etapa paga de enriquecimento (perfil
> Instagram via dataset + página do Facebook). O **Maps base** (nome, telefone,
> endereço, tem site?, status/nota no Maps) é o barato. (Confirmar se é isto que
> você chamou de "contrato".)

**Ideia:** o Básico entrega o lead **cru do Maps** — já trabalhável (telefone,
site sim/não, Maps ativo) — e **não faz o cruzamento**. O cruzamento é puxado
**separado** (sob demanda por lead, ou só no Pro). Isso ataca direto a maior
despesa.

**O que o lead cru JÁ tem** (vem do registro do Maps, custo baixo): nome,
telefone, endereço, nota/avaliações, classificação de site (tem site próprio?),
status no Maps. **O que falta** (só com cruzamento): handle de Instagram
confirmado, atividade do perfil, telefone/dados da página do Facebook.

**Impacto no custo** (ilustrativo — split de crédito a confirmar em D11; assumindo
Maps ≈ 1 crédito e cruzamento ≈ +3–4 créditos, ou seja o cruzamento é ~75–80% do
custo por lead):

| Básico, 300 leads/mês | Captação | LLM | Infra | **Custo/mês** | Preço 70% |
|---|---|---|---|---|---|
| **Com** cruzamento (hoje) | ~R$150 | ~R$15 | ~R$10 | **~R$175** | ~R$580 |
| **Sem** cruzamento (lead cru) | **~R$30** | ~R$15 | ~R$10 | **~R$55** | **~R$185** |

**Leitura:** cortando o cruzamento, o custo do Básico cai de ~R$175 para ~R$55
(~70%). Você escolhe o que fazer com isso:
- **manter o preço** (~R$580) → margem vai de 70% para **~90%**; ou
- **baixar o preço** (~R$185 a 70%) → Básico fica muito mais competitivo; ou
- **vender o cruzamento como add-on** (por lead ou pacote) → vira **receita extra**
  com custo repassado, e quem quer dado completo paga por isso.

**Implementação (barata, Fase 1):** o cruzamento já é fila própria
(`enriquecimento-etapas`). Basta o gate de plano **não enfileirar** as etapas
Instagram/FB no Básico (hoje `prospecting.js:1333` enfileira pra todo lead). O
Maps base continua. Cruzamento sob demanda = um botão "cruzar este lead" que
enfileira a etapa e debita a cota/crédito. **Nenhuma migration nova; é um `if` de
plano no ponto de enfileirar.**

> ⚠️ **D15:** o cruzamento no Básico é **add-on pago por lead**, **cota separada**,
> ou **exclusivo do Pro**? (Recomendo add-on por lead no Básico + incluído no Pro —
> captura quem precisa sem inchar o custo-base do plano.)

### 9.10. Dois freios diferentes: velocidade (rate limit) × cota total

O Mínimo **tem captação paga**, mas limitada. São **dois controles**, e eles fazem
coisas diferentes — usar os dois:

- **Rate limit (velocidade):** buscas por janela de tempo. Ex.: Mínimo ~10/10min,
  Básico ~30/10min, Pro alto. **Protege contra pico** (rajada que estoura o custo
  do dia de uma vez, e carga no servidor/Bright Data). Reusa o padrão que já existe
  (cooldown por instância, "uma coleta ativa por empresa" via índice único).
- **Cota total (dia/mês):** teto de leads no ciclo. **É isto que protege a margem.**

> ⚠️ **Rate limit sozinho NÃO segura o custo.** 10 buscas/10min rodando o dia
> inteiro = ~1.440 buscas/dia. A velocidade controla **rajada**; o **teto diário/
> mensal** é o que limita o **total**. Por isso os dois: rate limit (anti-pico/
> anti-abuso) **+** cota (margem).

> ⚠️ **"Pro ilimitado" é perigoso** com captação paga em conta **compartilhada** —
> um cliente pode sozinho consumir o crédito de todos. Pro = **alto, com cap de
> segurança**, nunca literalmente infinito. (D-Pro.)

**Estudar os dados antes de cravar os limites:** os números (10/30/100) devem sair
do **uso real** — posso rodar os scripts `medir:escopo-instancia` /
`medir:*` (read-only) pra ver buscas e leads por período hoje e calibrar. (D13.)

### 9.11. O que preciso pra fechar a conta (além de D11)

- **D13** — seu **uso real de hoje** (leads puxados/mês, turnos de IA/mês, chips)
  pra calibrar a linha "Normal". Posso puxar do banco com os scripts `medir:*`
  (read-only) se você autorizar.
- **D14** — modelo de IA do caminho conversacional em produção hoje
  (`gpt-4o-mini`? Sonnet?) — define se LLM é ~R$15 ou ~R$300.
- Fatura real Railway/Vercel/Evolution (posso puxar o Railway via MCP se autorizar).

---

## 10. Detalhes que faltavam (achados na revisão)

- **Chips puxam infra, não só risco.** O "conecte N chips" é ótimo diferencial, mas
  cada instância pesa no Evolution — considerar **limite de chips por plano** ou
  cobrança por chip extra no futuro (não agora).
- **LGPD / privacidade:** o produto guarda PII de leads de terceiros (telefone,
  etc.). Um SaaS público precisa de **termos de uso + política de privacidade** na
  landing e no cadastro (além do termo de risco §4.2). Jurídico, não código.
- **Upgrade/downgrade de plano no meio do ciclo** e **reembolso/chargeback ASAAS**:
  casos de borda do `empresa_plano` — resolver na Fase 1 com regra simples (muda no
  próximo ciclo; chargeback → `atrasado`).
- **Conta provisionada nasce como `owner`** da empresa nova (papel que já existe).
- **A favor:** isolamento multiempresa, termo de aceite, webhook assinado, fila
  anti-ban e enriquecimento **já existem e testados** — o risco da Fase 1 é a
  camada de plano + ASAAS, não o produto.

---

## 11. Fase 1 — ordem de construção (pra começar)

Cada passo é pequeno e fecha com `npm test`. Ordem pensada por **bloqueio**: o que
não depende de decisão vem primeiro.

| # | Passo | Depende de | Pode começar? |
|---|---|---|---|
| 1 | **Landing page** (Next.js, seções §5 + diferenciais §5.1/5.2) | nada (preço = placeholder) | ✅ **já** |
| 2 | **Migration `empresa_plano`** + `plano-definicao.js` (puro: features/cota/rate por plano) | D1 (semântica da cota) | quase |
| 3 | **Gate no `requireEmpresaAccess`** — status de pagamento + features por plano (IA, follow-up, cruzamento) | passo 2 | — |
| 4 | **ASAAS**: cliente + criar assinatura + **webhook assinado** → provisiona empresa + owner + trial 7d | credenciais ASAAS, D4 | — |
| 5 | **E-mail de cadastro** (cria senha / primeiro acesso) no provisionamento | passo 4 | — |
| 6 | **Cota + rate limit** no ponto de busca/enriquecimento; **lead cru vs cruzamento** por plano | D11, D15 | — |
| 7 | **Termo de risco por número** conectado (§4.2) | nada | ✅ |

**Sequência recomendada:** começar **1 (landing)** e **7 (termo)** em paralelo (zero
bloqueio), enquanto você fecha **credenciais ASAAS + D2/D11/D14**. Com isso resolvido,
2→3→4→5→6 em sequência. Landing + fluxo de pagamento + cadastro + liberação por plano
= Fase 1 funcional.

**O mínimo pra eu começar o backend de plano/pagamento:**
- Credenciais **ASAAS** (sandbox serve pra começar): API key + webhook token.
- **D4** (trial com ou sem cartão) — define o fluxo do provisionamento.
- **D14** (modelo de IA barato no Básico) — trava a margem.
- **D11** (R$/crédito) — pra cota/rate saírem de número real.

---

## 12. Matriz de ACESSO por plano (menu + páginas bloqueadas) — spec do operador 2026-10-01

Três comportamentos por item de menu: **oculto** (nem aparece), **bloqueado** (aparece,
mas a página mostra estado travado + explicação + CTA de upgrade) e **usável**.

### 12.1. Ocultos para TODO cliente (ferramentas de operador/plataforma)
Só superadmin/plataforma vê. Cliente (owner) **não vê** no menu, em nenhum plano:
- **Uso e custos**, **Prompts e saudações**, **Modelo e IA**, **Playbook**.

> ⚠️ Isso muda o modelo atual: hoje o owner VÊ esses itens (capacidade
> `integracoes_gerenciar`). Passam a ser **plataforma-only**.

### 12.2. Matriz do menu do cliente
`✅ usável` · `🔒 bloqueado+explica` · `— oculto`

| Item | Trial | Mínimo (R$79) | Básico (R$149,90) | Pro (R$600) |
|---|:--:|:--:|:--:|:--:|
| Minha Operação / Visão Geral | ✅ | ✅ | ✅ | ✅ |
| Banco de Leads | ✅ | ✅ | ✅ | ✅ |
| Aquisição | ✅ **pool, sem busca real** | ✅ busca real | ✅ | ✅ |
| Follow-ups | ✅ **sem IA/auto** | ✅ sem IA/auto | ✅ com auto | ✅ |
| Agenda | ✅ | ✅ | ✅ | ✅ |
| Assinatura | ✅ | ✅ | ✅ | ✅ |
| Integrações (Meta) | ✅ | ✅ | ✅ | ✅ |
| Central de Mensagens | 🔒 | **?** | ✅ | ✅ |
| Instâncias | 🔒 | **?** | ✅ | ✅ |
| Central de Ligações | 🔒 | 🔒 | 🔒 | ✅ |
| Roteiros | 🔒 | 🔒 | 🔒 | ✅ |
| Equipe | 🔒 | 🔒 | 🔒 | ✅ |
| Comissão | 🔒 | 🔒 | 🔒 | ✅ |
| Contas da empresa | 🔒 "plano R$600" | 🔒 | 🔒 | ✅ |

### 12.3. Regras finas
- **Follow-ups:** a tela é usável, mas **follow-up automático e qualquer coisa de IA** ficam
  travados abaixo do Básico; ao tentar ligar → aviso "disponível no plano de R$149,90, assine".
  (O motor já BLOQUEIA isso; aqui é o aviso na tela.)
- **Aquisição no trial:** mostra resultados e deixa "buscar", mas a busca **roda sobre o pool**
  (base já coletada), **não** dispara Bright Data. Busca real = plano pago.
- **Bloqueado = explica:** cada página 🔒 mostra o que ela faz, o que dá pra fazer, e qual plano
  libera (ex.: Central de Ligações/Equipe/Comissão/Contas → Pro R$600).

### 12.4. ⚠️ Células a CONFIRMAR (ambíguas)
- **Mínimo — Central de Mensagens e Instâncias:** o Mínimo é "CRM manual". Ele **conecta WhatsApp**
  (instância) pra atender manual (receber/responder sem IA) — então Central de Mensagens + Instâncias
  **usáveis** no Mínimo? OU o Mínimo também é só `wa.me` manual (sem instância), deixando as duas
  **bloqueadas** até o Básico? (Recomendo: Mínimo **conecta instância** e atende manual → usáveis.)
- **Instâncias no trial:** fica 🔒 (não conecta no teste) — confirma?
- **Roteiros:** liguei a Pro (vai junto da Central de Ligações). Confirma, ou Roteiros entra antes?

### 12.5. Implementação proposta (quando a matriz fechar)
- `plano-definicao.js` ganha um mapa **MÓDULOS**: por plano, cada módulo = `usavel|bloqueado|oculto`
  + `plano_que_libera` (pro CTA). Fonte única; nada de `if plano===` espalhado.
- `frontend/lib/navegacao.js`: filtra **ocultos** e marca **bloqueados** (lê o plano do `/me`).
- Um componente **`PaginaBloqueada`** (overlay + explicação + botão "Assinar") que embrulha a tela
  quando o módulo não é liberado pelo plano. Backend continua a autoridade (as rotas já barram).
- Itens de operador (Uso/Prompts/Modelo/Playbook) → `plataforma-only` na navegação.
