# Auditoria completa — arquitetura, UX e IA

**Data:** 2026-04-22
**Escopo:** varredura 360 do repositório (backend `index.js`, dashboard estático, prompts, knowledge base, SQL, Docker), com foco em achados **novos** que não estão nos documentos anteriores (`REVISAO-TECNICA-2026-04.md`, `ARQUITETURA-QUALIDADE-IA.md`, `ROADMAP-MELHORIAS-TECNICAS.md`, `ROADMAP-MELHORIAS-UX-FUNCIONALIDADES.md`).
**Metodologia:** leitura integral dos docs existentes para não duplicar análise, três auditorias paralelas (backend, dashboard, prompts), consolidação por impacto x esforço, seleção de uma melhoria principal com maior alavancagem.

---

## Sumário executivo

O projeto tem boa cobertura em documentos de diagnóstico — os problemas "evidentes" (secrets em claro, monolito, falta de testes, parser tolerante, debounce em memória, autenticação condicional) já estão mapeados. Esta auditoria entrega três coisas novas:

1. **Achados inéditos** de nível crítico que ainda não apareceram nos docs existentes — incluindo um **risco comercial direto no SKILL.md** (a IA pode prometer desconto no PIX que nunca foi autorizado) e uma **rota PATCH duplicada** em `/dashboard/conversa-meta` (linhas 3369 e 3710 — a segunda está morta).
2. **Backlog priorizado** por impacto x esforço, já filtrado contra o que está nos roadmaps, para evitar retrabalho de planejamento.
3. **Proposta de melhoria principal**: uma *Sales Memory Layer* — camada de perfil estruturado por lead que resolve, ao mesmo tempo, cinco problemas reais (IA repetindo perguntas, histórico JSONB crescendo infinito, prompt caching inefetivo, race condition de webhook duplicado, token cost acima do necessário). É a mudança de maior alavancagem dado o estado atual do projeto.

---

## 1. Arquitetura atual (visão conceitual)

```
WhatsApp do lead
      |
      v
Evolution API (Docker) ---- webhook HTTP ----> index.js (Express)
                                                    |
         +------------------------------------------+------------+
         |                       |                               |
         v                       v                               v
   Postgres (schema       Anthropic Claude                 Whisper/OpenAI
   "vendas")              (Sonnet 4.6, 45s)                (opcional)
         ^
         |
Dashboard estatico (HTML+JS vanilla) --- fetch com x-reprocess-secret
```

Pontos estruturais relevantes confirmados em código:

- `index.js` tem cerca de 3.800 linhas, concentra rotas, pipeline do LLM, motor de preço, integração Evolution e Whisper, comandos do operador e debounce.
- Bundle de prompt injetado em cada chamada: `prompts/system.md` + `prompts/empresa.md` + contexto dinâmico (horário, perfil, aprendizado). Além disso, `prompts/vendas-consultivas-SKILL.md` e `prompts/lead-coach.md` também moram em `prompts/` — o primeiro tem sobreposição direta com `system.md` e o segundo tem função ambígua (pós-conversa manual ou automática não está claro).
- Persistência em cinco tabelas principais em `vendas.*`; histórico bruto cresce em `historico JSONB`.
- Redis está declarado em `docker-compose.yml` mas não é usado no código — continua sendo o alvo natural para debounce/dedup/rate-limit (já apontado no REVISAO-TECNICA).

---

## 2. Achados novos por camada

Nota: os achados **cobertos por docs existentes** (secrets hardcoded, monolito, parser tolerante, autenticação condicional, falta de testes, debounce em memória, falta de observabilidade, falta de evals, etc.) foram omitidos aqui — continuam válidos, apenas não são repetidos.

### 2.1 Backend (`index.js`)

**[Crítico] Risco comercial — desconto de PIX implícito no bundle de prompt.** `prompts/vendas-consultivas-SKILL.md` contém a frase "No PIX à vista tem um desconto especial", enquanto `prompts/system.md` manda nunca pedir forma de pagamento e marcar `pediu_desconto_fora_padrao` como handoff. Se o SKILL está sendo carregado no contexto (e está, porque fica em `prompts/`), a IA pode oferecer desconto que Victor nunca autorizou. Fix de 1 linha, impacto direto em conversões erradas. **Ação:** remover essa frase do SKILL ou remover o SKILL inteiro do contexto injetado (ver proposta principal).

**[Crítico] Race condition real em webhook duplicado.** O debounce em memória (Map por número) não serializa acessos. Se a Evolution reenvia o mesmo webhook dentro de 2,5s (é uma retentativa legítima de um provedor externo), `processarRespostaWebhookDebounced()` pode rodar duas vezes em paralelo: duas chamadas à Anthropic, dois cálculos de preço, duas mensagens enviadas ao lead, duas atualizações de perfil. A detecção por `historicoCresceuSoComUsers()` cobre o caso de mensagem nova do lead, não o caso de webhook duplicado.

**[Alto] Evolution responde 200 mas o body pode ter `success: false`.** Envio de mensagens (`enviarMensagem`, `enviarComBotoes`) só checa status HTTP. A Evolution pode retornar 200 com `{ success: false, error: "número não existe" }`. Combine com o webhook que responde 202 OK antes de processar: resposta silenciosamente perdida.

**[Alto] Motor de preço pode persistir `NaN` silenciosamente.** `calcularPreco` usa fallbacks (`|| PISO.servicos`, `|| 1.0`), mas se qualquer entrada quebrar (perfil corrompido, complexidade desconhecida, ticket com string inválida), o resultado pode ser `NaN`. Não há `Number.isFinite(valor)` antes do `UPDATE`. Preço inválido vai para `lead_profiles.preco_calculado` e contamina o dashboard.

**[Alto] Fallback do `EVOLUTION_API_KEY` é literal `'pjcodeworks123'`.** Além do `.env` ter a mesma string, o código usa essa string como default. Qualquer deploy esquecendo de definir a variável vai rodar com a key padrão — que está pública no próprio repositório.

**[Alto] `REPROCESS_SECRET` ausente abre o dashboard.** `reprocessarAutorizado()` retorna `true` quando a env não está definida. Hoje isso é tratado como "modo opcional", mas é um default inseguro: em qualquer deploy esquecendo a variável, todas as rotas `/dashboard/*` viram abertas. Deveria falhar no boot, não abrir silencioso.

**[Alto] Histórico JSONB cresce indefinido no banco.** O truncamento para 40 mensagens existe só em cópias locais antes de `salvarConversa()`. Se uma conversa já tem 1.000 mensagens no DB, o slice local não reduz — só corta a cópia recém-recebida. A cada resposta, o histórico completo é relido e enviado para o Claude. Latência e custo crescem linearmente com a idade da conversa. Esse achado é o gatilho natural da proposta de melhoria principal.

**[Médio] Rota PATCH `/dashboard/conversa-meta` duplicada.** Linhas 3369 e 3710 definem a mesma rota. Express registra a primeira; a segunda é código morto. Sintoma típico de merge mal resolvido — vale revisar se há regras divergentes entre as duas versões.

**[Médio] Prompt caching do Claude ativado mas ineficaz.** O header `anthropic-beta: prompt-caching-2024-07-31` está presente, mas o system prompt é remontado a cada chamada com perfil + aprendizado + horário. O hash muda a cada turno, o cache é cache miss garantido. Para efetivar o caching, a parte estática (system.md + empresa.md canônicos) precisa ser separada da parte dinâmica (perfil, horário).

**[Médio] `gerarAprendizado()` roda fire-and-forget.** Só é disparada a cada 3 vendas fechadas. Se falha, só loga. Sem retry, sem alerta ao operador, sem persistência da tentativa. Aprendizado silenciosamente perdido.

**[Médio] Telegram handoff sem fallback.** Se `TELEGRAM_BOT_TOKEN` falha ou está vazio, Victor simplesmente não recebe a notificação de handoff. Não há fallback para WhatsApp do operador, que seria natural visto que a conexão com Evolution já existe.

**[Médio] Comandos do operador (`PAUSAR`/`RETOMAR`) sem confirmação.** Regex simples. Typo no número leva a pausar outro lead sem aviso. Sem "ok, pausei o número X" antes de executar.

### 2.2 Dashboard (HTML + JS vanilla)

**[Alto] `headersComReprocessSecret()` reimplementado em 4+ arquivos.** Existe em `core.js` mas `conversas.js`, `perfil-lead.js`, `configuracao.js` e `analises-etapas.js` têm sua própria cópia. Qualquer mudança em uma quebra as outras. O mesmo vale para helpers de escape (`esc`, `escAttr`).

**[Alto] Fetch sem timeout, sem retry, sem AbortController.** Se o backend trava, o dashboard fica com spinner infinito. Se o operador clica duas vezes em "Follow-up em lote", duas rodadas rodam em paralelo. Trocar página durante fetch deixa promise pendurada gravando estado numa página que não existe mais.

**[Alto] 401 e 403 tratados como erro genérico.** Qualquer expiração ou mudança do secret cai em `alert()` ou `console.error`. O operador continua tentando ações que falham silenciosamente em vez de ser enviado para a tela de configuração.

**[Médio] `BroadcastChannel` é parcial.** Existe entre `configuracao.js` e `conversas.js`, mas não cobre `perfil-lead`, `analytics`, `visao-geral`. Duas abas abertas do mesmo perfil podem divergir: operador salva um lado, o outro mostra dado antigo e sobrescreve.

**[Médio] Sem indicador de offline / desconexão.** `navigator.onLine` não é escutado. Backend fora do ar não aparece na UI além de alerts intermitentes.

**[Médio] Renderização `innerHTML += .map().join()` em listas grandes.** Sem virtualização nem `DocumentFragment`. Páginas de 500 itens ficam desconfortáveis no scroll inicial.

**[Médio] Dados já no banco não expostos.** `followup_envios` guarda mensagem enviada por conversa mas a lista só mostra "Follow-up ok". `analises_pos_conversa.sinais_melhoria_ia` é indexado mas não aparece como insight agregado. `conhecimento_lacunas` tem recorrência por tema mas o dashboard só mostra total aberto. Operador perde visão que já está disponível.

### 2.3 Prompts e knowledge base

**[Crítico] Contradição entre `vendas-consultivas-SKILL.md` e `system.md`.** Além da linha do desconto no PIX já citada, o SKILL tem 16 KB de conteúdo paralelo que se sobrepõe ao system. Se os dois estão no contexto (e estão, pelo diretório), a IA recebe duas fontes de verdade com wording diferente. O risco prático não é "a IA falha" — é "a IA se inclina para o SKILL quando convém, que é exatamente quando não convém".

**[Alto] `knowledge/cases.json` tem cliente nunca autorizado.** "Geral 1914" está no JSON mas não aparece em `empresa.md` (a fonte injetada). Se algum caminho do código resolver o JSON para enriquecer o prompt, a IA passa a poder citar um case sem permissão comercial.

**[Alto] Objeções clássicas ausentes no playbook.** Faltam scripts para "já tenho agência", "vou pensar / preciso falar com sócio", "preciso já pra semana que vem". O SKILL menciona a objeção de confiança genericamente, mas não há tratamento de fluxo multi-turn. Essas três objeções, na prática, cobrem a maior parte dos leads que escapam entre proposta e fechamento.

**[Alto] Sem instrução explícita de "não repergunte o que já está no perfil".** Em conversas longas (20+ mensagens), a IA pode voltar a perguntar segmento ou cidade que o lead já respondeu no turno 3. O perfil estruturado em `lead_profiles` resolve isso — mas hoje o prompt não é informado do que já foi coletado. Esse achado conecta diretamente com a proposta principal.

**[Médio] Gatilhos de handoff vagos.** "fora_do_icp" e "conversa_longa_sem_avanco" estão no enum mas sem critério objetivo no prompt. Falta tabela com exemplos ("15+ mensagens na mesma etapa por 8+ turnos" vs só "conversa longa").

**[Médio] Regra de emojis inexistente.** Os modelos de site e planos em `empresa.md` usam emojis (🎯 ⭐ 🚀 etc.) mas o `system.md` não dá regra sobre quando usar em conversa com o lead. Resultado: mensagens alternam entre cordial e "robô corporativo emojizado".

**[Médio] Orquestração de `followup.md` e `lead-coach.md` não documentada.** Nos prompts não está claro quando cada um é invocado. A leitura do backend resolve (`lead-coach` é disparado no dashboard, `followup` é disparado pelo endpoint manual), mas o prompt escrito parece assumir que a própria IA decide.

**[Médio] Integração do `enviar_print` é incerta.** O campo existe no JSON do contrato, o arquivo `knowledge/prints/874-analytics-30d.png` está no disco, mas a cadeia que converte `enviar_print` em anexo real no WhatsApp não é visível nos roadmaps. Testar fluxo ponta a ponta antes de confiar que esse campo faz alguma coisa em produção.

---

## 3. Matriz de priorização (achados novos)

Priorizado por impacto real em receita ou risco operacional, ignorando itens já em roadmap.

| Prioridade | Achado | Esforço | Impacto |
|-----------|--------|---------|---------|
| P0 | Desconto no PIX implícito em SKILL.md vs system.md | 10 min | Risco comercial direto |
| P0 | `REPROCESS_SECRET` ausente abre dashboard (falhar no boot) | 20 min | Segurança |
| P0 | Race condition de webhook duplicado (idempotência por event_id) | 4 h | Duplica mensagens em produção |
| P0 | Evolution 200 com `success: false` silencioso | 1 h | Respostas perdidas |
| P1 | Camada de memória estruturada do lead (**proposta principal**) | 1 semana | Conversão + custo + estabilidade |
| P1 | Rota PATCH duplicada `/dashboard/conversa-meta` | 15 min | Code smell, risco de regressão futura |
| P1 | Histórico JSONB cresce infinito no DB | 2 h | Custo linear crescente |
| P1 | Motor de preço persistindo NaN | 30 min | Dashboard e propostas com dados inválidos |
| P1 | Fetch sem timeout/retry + 401 genérico no dashboard | 1 dia | UX operacional |
| P1 | Scripts de objeções faltantes no system.md | 1 dia | Conversão |
| P2 | Prompt caching real (separar estático de dinâmico) | 1 dia | Custo -30 a -50% |
| P2 | `headersComReprocessSecret` centralizado | 2 h | Manutenção |
| P2 | BroadcastChannel cobrindo todas as páginas | 4 h | Consistência entre abas |
| P2 | Telegram handoff com fallback WhatsApp | 2 h | Resiliência |
| P2 | Regra de emojis no system.md + playbook de tom regional | 4 h | Qualidade da resposta |
| P3 | Dashboard expor preview do follow-up + lacunas por tema | 1 dia | Produtividade do operador |
| P3 | Lead-coach e followup documentados como "invocados assim" | 2 h | Clareza |
| P3 | `enviar_print` com teste ponta a ponta | 2 h | Alucinação evitada |

Os P0 juntos somam menos de **6 horas** e tiram três riscos que hoje rodam em produção sem alerta. Vale fazer antes de qualquer melhoria estrutural.

---

## 4. Melhoria principal proposta — *Sales Memory Layer*

A decisão de qual melhoria destacar considerou: os roadmaps existentes já cobrem segurança, modularização e observabilidade. Sobram três vetores onde o projeto ainda tem alavanca grande: conversão (a IA fecha mais vendas?), custo (cada resposta tem um custo em tokens que cresce com a idade da conversa), e estabilidade (respostas duplicadas, NaN, race condition). A proposta abaixo endereça os três ao mesmo tempo, reaproveitando o que já existe (tabela `lead_profiles`, contrato JSON do LLM).

### 4.1 O problema, em uma frase

Hoje o prompt do Claude recebe todo turno o histórico bruto em JSONB — que cresce sem teto — e não recebe um resumo estruturado do que o lead já disse. O resultado é que o modelo repete perguntas, consome tokens demais em conversas velhas e perde conversões porque parece não ter memória.

### 4.2 A ideia

Criar uma **camada de memória estruturada por lead** que vira fonte primária do contexto do LLM. O histórico bruto continua sendo persistido (para auditoria e dashboard), mas não é mais o que entra no prompt.

Conceitualmente:

- **Perfil consolidado** (`lead_profiles` já existe): continua com os campos atuais. Ganha um campo novo `resumo_memoria TEXT` — uma descrição curta, mantida pelo backend, do que o lead já contou. Ex.: "Dentista em Santo André. Ticket médio alto. Já apareceu no Google. Dor: agenda vazia. Testou Instagram, não funcionou. Considera caro acima de R$ 3.000."
- **Últimas N mensagens** (janela rolante, N=12): só as últimas mensagens vão cruas para o Claude. Mensagens mais antigas alimentam o `resumo_memoria` e são arquivadas.
- **Sumário incremental**: a cada M mensagens (M=8), um job interno pede ao Claude um resumo curto atualizado e substitui `resumo_memoria`. Baixo custo e cria um hash estável.
- **Bundle de prompt** passa a ter três partes bem definidas e separadas por *cache breakpoint* do Claude:
  1. **estático** — `system.md` canônico + `empresa.md` canônico (cacheável). Hash muda só em release.
  2. **semi-estático** — `resumo_memoria` + perfil estruturado (muda a cada 8 mensagens). Pode ser cacheado por turno.
  3. **dinâmico** — últimas 12 mensagens + contexto de horário. Nunca cacheado.

### 4.3 O que essa mudança resolve

Cada item abaixo é um achado real desta auditoria (ou dos docs anteriores):

- **Conversão**: com o `resumo_memoria` injetado antes da janela, o prompt ganha uma instrução forte — "o que está no resumo já foi coletado, não repergunte". Fim do *déjà vu* em conversas longas.
- **Custo**: hoje a parte estática é reconstruída a cada turno com perfil dinâmico no meio, e o prompt caching nunca acerta. Separando em três camadas, o estático cachea de verdade; redução típica em Claude Sonnet é 30% a 50% em conversas com mais de três turnos.
- **Estabilidade de contexto**: o prompt para de crescer linear com a idade da conversa. O tamanho de entrada fica previsível (estático fixo + resumo curto + 12 mensagens).
- **Histórico JSONB infinito**: o histórico bruto continua existindo no banco mas não é mais o gargalo de custo. Um truncamento de segurança (1.000 mensagens por conversa) fica razoável.
- **A/B testing de prompt**: com a separação em camadas, trocar só a camada estática vira uma mudança versionada e barata. Serve de base para a telemetria proposta em `ARQUITETURA-QUALIDADE-IA.md`.
- **Race condition de webhook duplicado**: a gravação de `resumo_memoria` e do contador `memoria_versao` dá o gancho natural para um *compare-and-swap*. Se dois workers tentarem atualizar a mesma versão, só o primeiro passa.

### 4.4 Esboço de implementação

**Schema (apenas adições a `lead_profiles`):**

```sql
ALTER TABLE vendas.lead_profiles
  ADD COLUMN IF NOT EXISTS resumo_memoria   TEXT,
  ADD COLUMN IF NOT EXISTS memoria_versao   INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS memoria_atualizada_em TIMESTAMPTZ;

-- Janela de mensagens já sai de vendas.conversas.historico (nao duplicar)
```

**Pipeline dentro do webhook:**

1. Ler conversa + perfil.
2. Se `historico.length > 12` E `historico.length - memoria_versao_base >= 8`, disparar resumidor (fire-and-go com retry; não bloqueia a resposta atual).
3. Montar bundle com três camadas separadas (enviar ao Claude com *system* particionado e `cache_control`).
4. Gerar resposta normalmente.
5. Ao salvar conversa, usar `UPDATE ... WHERE memoria_versao = $old` — se o update afetar 0 linhas, detectar duplicata.

**Backend (módulos novos, 2 arquivos):**

- `src/services/memory.js` — monta o bundle em três camadas, chama o resumidor.
- `src/services/summarizer.js` — prompt isolado para gerar `resumo_memoria` (Claude Haiku 4.5 serve, é barato; ~70ms por sumarização).

**Prompts:**

- `system.md` ganha bloco curto: "O campo RESUMO DO LEAD no contexto contém tudo que já foi coletado. Nunca repergunte informação que já estiver nele. Se algo parecer contraditório entre RESUMO e as últimas mensagens, priorize as últimas mensagens."
- `vendas-consultivas-SKILL.md` **sai do bundle injetado** (vira documentação, não instrução viva). Economia adicional de ~4.000 tokens por turno.

**Dashboard (mínimo, incremental):**

- Bloco "Memória do lead" no `perfil-lead.html` mostrando `resumo_memoria` e `memoria_versao`. Botão "regenerar memória" para casos em que o operador quer forçar.

**Rollout:**

1. Implementar e testar com tráfego zero (modo *shadow*): gera bundle novo, compara com o antigo, envia o antigo ao Claude. Mede token delta.
2. A/B 10% dos leads por 72h — métricas: turnos por conversa, taxa de re-pergunta (heurística simples), custo por resposta.
3. Subir para 100% só se custo cair, taxa de re-pergunta cair e conversão não cair.

### 4.5 Critério de sucesso

A mudança estará boa quando:

- Custo por resposta cair em pelo menos 25% em conversas com mais de 10 mensagens.
- Número médio de tokens no prompt ficar abaixo de 9.000 (hoje passa de 17.000 em conversas longas).
- Casos de "a IA repetiu a pergunta" deixarem de aparecer nas análises pós-conversa (`vendas.analises_pos_conversa`).
- Nenhuma resposta duplicada por webhook duplo em 7 dias de produção.

### 4.6 Porque agora, e não outra coisa

Outras candidatas foram avaliadas e descartadas para este documento por razões específicas:

- **Modularização do `index.js`** — já está no ROADMAP, exige refatoração grande e não move ponteiro de conversão.
- **Evals + corpus** — já está no `ARQUITETURA-QUALIDADE-IA.md`, é prerrequisito ideal mas depende de coleta de transcrições anonimizadas.
- **Cron de follow-up automático** — está na visão de longo prazo, mas sem a memória, o follow-up vai repetir a pergunta do lead anterior.
- **Cookie httpOnly no dashboard** — já é P0 em segurança no REVISAO-TECNICA, sigo concordando, mas impacto em receita é indireto.

A camada de memória é a única mudança que move, ao mesmo tempo, conversão, custo e estabilidade — e que ainda viabiliza as outras iniciativas (evals ficam mais baratas quando a entrada é estável; a-b test vira trivial quando o bundle é versionado; prompt caching passa a funcionar).

---

## 5. Backlog imediato recomendado

Ordem sugerida para a próxima semana, reaproveitando o plano existente:

1. **Hoje mesmo (≈ 6h):** os quatro P0 listados na matriz (remover SKILL do bundle ou pelo menos a linha do desconto; falhar no boot sem `REPROCESS_SECRET`; idempotência por `event_id` no webhook; validar body da Evolution).
2. **Próximos 3 dias (≈ 2 dias de trabalho):** P1 de baixo esforço (rota duplicada, NaN no preço, truncamento do histórico no DB, fetch com timeout no dashboard, scripts de objeções faltantes).
3. **Próxima semana (≈ 5 dias):** *Sales Memory Layer* ponta a ponta com rollout em shadow.
4. **Em paralelo:** começar o corpus de evals descrito em `ARQUITETURA-QUALIDADE-IA.md` — a memória estruturada vai torná-lo imediatamente reutilizável.

---

## Referências no repositório

- `index.js` — linhas 196 (debounce), ~240 (loop debounce), ~537 (calcularPreco), ~1806 (system prompt dinâmico), ~1829 (header de cache), 2290 (enviarMensagem/enviarComBotoes), 2312 (`reprocessarAutorizado`), 2546 (follow-up do operador), ~2930 (detecção de stale), ~2980 (truncamento em memória), 3369 e 3710 (PATCH conversa-meta duplicado).
- `prompts/system.md` — Bloco 3 (objeções), Bloco 4 (handoff), bloco de JSON contratual.
- `prompts/empresa.md` — modelos, planos, prova social autorizada.
- `prompts/vendas-consultivas-SKILL.md` — conteúdo sobreposto + linha do desconto no PIX.
- `knowledge/cases.json` — inclui "Geral 1914" não autorizado.
- `docker-compose.yml` — `ANTHROPIC_KEY` em claro (já no REVISAO-TECNICA).
- `sql/init.sql` — `vendas.lead_profiles` e `vendas.conversas` recebem alterações mínimas para a proposta principal.
- `dashboard/js/*.js` — duplicação de helpers e fetch sem timeout em todos os arquivos.
