# Análise de 5 conversas reais e plano de melhoria do agente

**Data:** 2026-04-23
**Escopo:** 5 conversas reais ocorridas entre 22–23/04/2026 (drywall Mossoró, reformas Manaus, climatização Macaíba, pintor Fortaleza, fretes Fortaleza), cruzadas com literatura atualizada de venda consultiva e com os achados das auditorias anteriores (`REVISAO-TECNICA-2026-04.md`, `ARQUITETURA-QUALIDADE-IA.md`, `AUDITORIA-COMPLETA-2026-04-22.md`).
**Objetivo:** identificar padrões de falha que explicam por que leads engajados estão saindo sem fechar e propor mudanças concretas no prompt, no backend e no dashboard.

---

## Sumário executivo

As cinco conversas analisadas mostram um agente que conduz bem o **diagnóstico inicial**, mas falha sistematicamente a partir do momento em que o lead demonstra interesse real. Os três padrões mais caros em termos de conversão são:

1. **O agente repete o bloco "Pesquisei X cidade" até cinco vezes na mesma conversa**, com nomes de concorrentes diferentes a cada vez. Isso é percebido como falha de bot e mata a credibilidade construída no início.
2. **O agente ignora o sinal de compra mais óbvio do funil** — o lead pergunta preço e o agente desvia. Em uma conversa o lead pediu preço três vezes consecutivas sem receber resposta. Literatura atual coloca 8 minutos como janela para responder preço.
3. **O agente promete "site no Google em 30 dias"** em três das cinco conversas. Google oficialmente posiciona o prazo realista para site novo em 4 a 12 meses. É uma promessa falsa com risco de publicidade enganosa (CDC) e risco de churn agressivo 60 dias após venda.

A análise também identifica um bug silencioso de **eco da pergunta** (lead usa "citar" do WhatsApp e a pergunta volta como parte da resposta dele) que polui o contexto do LLM em pelo menos três das cinco conversas — o prompt não está tratando esse caso.

No final, um backlog priorizado de 14 mudanças (metade delas em prompt, sem deploy de código) com impacto direto esperado em conversão, risco regulatório e qualidade percebida.

---

## Método

1. Marcação timeline-por-timeline de cada conversa identificando quem falou, o que aconteceu e qual foi o efeito no turno seguinte.
2. Extração de 14 padrões recorrentes, priorizados por (a) impacto em conversão, (b) risco jurídico/regulatório, (c) frequência entre as cinco conversas.
3. Pesquisa web em português e inglês sobre venda consultiva no WhatsApp, SPIN, objeções clássicas ("vou pensar", "já tenho alguém"), LGPD de coleta de CPF antes de contrato, prazo realista de SEO para site novo, e padrões de falha em chatbots de vendas com IA.
4. Cruzamento: cada recomendação aponta o padrão que ela corrige, com citação literal da conversa.

---

## Padrões observados (com citações literais)

### 1. Loop de prova social repetida — CRÍTICO

Em todas as cinco conversas o agente reabre o bloco "Pesquisei X cidade — aparecem Y, Z, W — você não está na lista" três a cinco vezes. Na conversa do Oséias (Manaus, reformas) o bloco aparece **nove vezes**. O impacto é duplo: o lead percebe que é um bot preso em script, e a taxa de alucinação sobe (ver padrão 2).

Ocorrências:

- Drywall Mossoró: 4 repetições do mantra "drywall Mossoró RN".
- Reformas Manaus: 9 repetições de "reforma Manaus", "reforma construção Manaus".
- Climatização Macaíba: 4 repetições.
- Pintor Fortaleza: 5 repetições.
- Fretes Fortaleza: 5 repetições.

Citação (Manaus): turnos consecutivos "Pesquisei aqui 'reforma construção Manaus'", "Pesquisei agora — Reforma Manaus, Construmaxx e SSE Construção", "Pesquisei agora 'reforma Manaus' agora — aparecem Reforma Manaus, SVA Construtora e Construmaxx" em intervalo de quatro minutos.

Causa provável: `prompts/system.md` (Bloco 2) instrui a fazer prova visual/pesquisa, mas não há instrução de "se já citou os concorrentes nesta conversa, não repita". O prompt não recebe um resumo do que já foi dito.

### 2. Alucinação de concorrentes — CRÍTICO

Conectado ao padrão 1. Como a cada turno o agente gera uma nova "pesquisa", os nomes variam:

- Manaus: o agente cita, em turnos diferentes, Reforma Manaus, SVA Construtora, Construmaxx, Master House, SSE Construção, COMAC, Beny, Castelinho. Três conjuntos diferentes em minutos.
- Mossoró: Master House, GuiaFix, GetNinjas no primeiro turno; C'Art Ambientações entra no terceiro turno; GetNinjas some em alguns turnos.
- Macaíba: EcoClima, ABC Ar Condicionado, Barbosa Refrigeração no primeiro turno; depois fica "ABC Ar Condicionado e Ar Instalação" (EcoClima e Barbosa sumiram).
- Fortaleza pintor: Home Star Pintura, Carlos Sales, Pintores de Paredes CE com variações a cada turno.

Risco real: se qualquer lead abrir o Google e validar, a marca perde credibilidade instantaneamente. Pior: existe o risco de citar uma empresa que não existe e a IA afirmar que ela está "no topo".

Causa provável: o agente não tem acesso real ao Google. A "pesquisa" está sendo gerada pelo próprio modelo a cada chamada — é alucinação disfarçada de fato. O prompt fala em prova visual mas não instrumentaliza busca web real.

### 3. Desvio do preço quando o lead pede — CRÍTICO

O sinal de compra mais claro em uma conversa de WhatsApp é o lead pedir valor. Nas cinco conversas:

- **Fretes Fortaleza (FAG):** lead pergunta três vezes seguidas "Quanto você cobra para criar o site" / "Quanto custa para fazer o site" / "tô querendo ver exatamente isso / Quanto custa". As três respostas do agente começam com "Antes de falar em valor..." ou "O caminho natural antes de falar em valores é montar o contrato...". A conversa morre.
- **Reformas Manaus:** lead pergunta "Você cobra quanto pra mim fazer um site de anúncio?" — agente responde "Antes de falar em valor, preciso te explicar como funciona". Lead insiste "Pode me responder agora?" — agente repete "Prefere ver o processo primeiro ou já ir direto pros valores?". Lead concorda ("Pode ser") e o agente ainda empurra o "caminho natural de contrato" em vez de dar o preço.
- **Pintor Fortaleza:** lead pergunta "Valores" às 16:18, recebe resposta apenas às 16:49 com proposta confusa de três planos. A mensagem "?" às 16:49 é o lead perdendo a paciência.

Literatura (Sebrae, Mercado Pago, InfinitePay) é clara: responder preço em até 8 minutos aumenta conversão. Desviar pelo quarto turno consecutivo é padrão de perda.

Causa provável: `prompts/system.md` tem regra implícita de "não dar preço antes do diagnóstico completo". A regra é boa em princípio, mas não tem *override* para "lead pediu explicitamente N vezes, dê o preço agora".

### 4. Eco de pergunta — bug silencioso — ALTO

Em três conversas o lead usa "citar" do WhatsApp e a pergunta do agente volta inteira como início da mensagem dele:

- Manaus: `"De 0 a 10, quanto você precisa resolver isso AGORA?\n10"`
- Macaíba: `"De 0 a 10, quanto resolver isso é importante pra você AGORA?\nacho que 10"`
- Macaíba (segundo lead): `"Legal! E em qual cidade você atende?\nMacaíba rn"`

O agente trata o texto como se tudo fosse o conteúdo do lead. Nenhum reconhecimento de "você parece estar respondendo `10`, entendi". Isso polui o contexto do LLM — em conversas longas, essa poluição acumula.

Causa provável: `normalizarHistoricoMensagens()` em `index.js` não remove prefixo citado pelo WhatsApp (formato `"> texto original\nnova mensagem"` ou, como nos exemplos, duas quebras de linha). Fix é pequeno e dá efeito imediato na qualidade do contexto.

### 5. Termômetro ignorado ou manipulado — ALTO

Lead dá nota no termômetro de dor e o agente não respeita:

- Drywall Mossoró: lead dá 5, agente responde "Isso muda o termômetro um pouco?". É pressão para mudar a resposta — tonalidade manipulativa.
- Macaíba e Fortaleza pintor: lead dá 10, agente em vez de acelerar o fechamento pede mais um round de diagnóstico ou propõe agendamento.

O termômetro deveria ter efeito real no funil. Um 10 claro deveria levar direto para proposta; um 3 ou 4 deveria levar para cenário de dor/oportunidade, não para "isso muda o termômetro?".

### 6. Empatia ausente em momento frágil — ALTO

Drywall Mossoró, linha 17:22: lead diz "E pq eu estava trabalhando fichado aí estava afastado". É um lead vulnerável, recomeçando. Resposta do agente: "Entendi, tá recomeçando agora — faz todo sentido querer estruturar isso direito desde o início. 💪 Quantos orçamentos você tá conseguindo por semana hoje em dia?"

Técnicamente não é errado, mas salta imediatamente para métrica. Um vendedor humano pausaria — "puxa, que bom que tá voltando, qualquer coisa começando bem já ajuda" — antes de ir para número. O custo disso é confiança não-construída quando mais importava.

### 7. Handoff prematuro como substituto de fechamento — ALTO

Reformas Manaus, depois de lead dizer "Ta" a uma proposta mal explicada: agente responde "Vou chamar o Victor aqui na conversa — ele cuida pessoalmente disso e te responde em instantes". Cinco minutos depois o lead escreve: "Obrigado mas não precisa mas não". Desistiu.

"Ta" não é consentimento para handoff. É reconhecimento de que ouviu. O agente confundiu handoff com fechamento e queimou a lead.

### 8. Coleta de CPF pelo WhatsApp antes de qualquer acordo — CRÍTICO (regulatório)

Drywall Mossoró, 17:52: agente envia "Me envia seu Nome CPF Endereço Email Para criação de contrato de desenvolvimento e hospedagem".

Problemas: (a) LGPD exige base legal e consentimento informado — enviar CPF em WhatsApp aberto, sem aviso de privacidade, sem canal seguro, é base legal frágil; (b) WhatsApp não é canal seguro de PII; (c) o lead ainda não comprou, portanto "execução de contrato" como base legal é antecipada.

Fonte: Serpro LGPD, guias Sebrae e RD Station citam que coleta de dado pessoal exige base legal explícita e coleta minimizada.

### 9. Promessa de SEO em 30 dias — CRÍTICO (regulatório e churn)

Três das cinco conversas afirmam "site no ar em até 7 dias e aparecendo no Google em até 30". O prompt `empresa.md` e `system.md` usam essa frase.

Realidade (Google oficial, via Maile Ohye): SEO para site novo leva 4 a 12 meses para mostrar resultado completo. Primeiras impressões em ~30 dias são possíveis mas não ranqueamento em posição útil.

Risco: cliente fecha, paga, 60 dias depois procura o próprio nicho e não acha. Conclui que foi enganado, pede reembolso ou reclama no Reclame Aqui / ANPD / Procon. Além do risco de publicidade enganosa (CDC art. 37), o agente está criando uma bomba-relógio em cada venda.

### 10. Proposta de três planos de upgrade simultâneos — MÉDIO

Reformas Manaus, 16:59: agente manda Aceleração (R$ 600), Crescimento (R$ 300), Essencial (R$ 150) e Infra Básica (R$ 60) em um bloco só. Lead já tinha dito "Diga os valores" e recebeu três valores paralelos, sem tempo de processar o valor do projeto principal.

Efeito paradoxo da escolha: mais opções, menos decisão. Literatura de venda consultiva (Agendor, InfinitePay, DNA de Vendas) recomenda apresentar uma recomendação principal com duas alternativas posicionadas (melhor e mais barato), não o cardápio inteiro.

### 11. Pré-fechamento defensivo injetado cedo demais — MÉDIO

Três conversas (Manaus, Macaíba, Fortaleza pintor) têm a frase "tudo vai estar num contrato simples — prazo, o que tá incluído e condições de pagamento" sendo despejada **antes** de o lead verbalizar objeção de confiança. Resolve um problema que não existe. Lê como defensivo e plantam a dúvida "espera, por que ele está se justificando antes?".

### 12. Preço inconsistente entre conversas — BUG

- Drywall: operador manualmente envia "Modelo iniciante - 200R$" mais "Essencial R$ 150 + Infra R$ 60".
- Pintor Fortaleza: agente envia "Entrada R$ 832 + 3x R$ 416" + "Profissional R$ 312" + "Premium R$ 624" no mesmo turno.
- Manaus: "entrada + 3 parcelas" sem valores + planos de R$ 600/300/150/60.
- Macaíba: promessa de proposta mas nenhum valor.

O motor de preço varia em função do perfil (legítimo), mas a apresentação varia também — em um caso é "Profissional R$ 312 / Premium R$ 624" (sem explicar que são parcelas), em outro é "Entrada + 3x" (sem o valor total). Quem compara duas propostas se confunde e o comercial perde poder de ancoragem.

### 13. Pergunta já respondida sendo repetida — ALTO

Drywall Mossoró, abertura:
- Agente: "Qual seu negócio? Sua cidade? Aparece no Google?"
- Lead: "Olá! Tenho interesse..."
- Agente (reformulando): "Qual o ramo do seu negócio e em que cidade?"
- Lead: "Mossoró RN"
- Agente: "Legal, Mossoró! E qual o ramo?"

Pergunta as três coisas de uma vez, depois volta a perguntar uma a uma. Se o lead já respondeu uma, o prompt não está fazendo a contabilidade do que falta. Esse padrão **é exatamente o que a *Sales Memory Layer* proposta em `AUDITORIA-COMPLETA-2026-04-22.md` resolve**.

### 14. Tom oscilante entre informal e corporativo — BAIXO

Mesma conversa mistura "Opa, bom dia! Que ótimo" com "O caminho natural aqui é montar o contrato" e com "tudo formalizado em contrato antes de qualquer cobrança". A persona fica esquizofrênica — ora vizinho na esquina, ora escritório de advocacia.

---

## Cruzamento com literatura (2026)

As fontes consultadas convergem em quatro princípios que o agente atual viola:

1. **Humanização > script** (Sebrae, SocialHub, SPIN): leads em 2026 esperam escuta genuína, não pitch rodado. O loop de prova social repetida e o atropelo da vulnerabilidade emocional do drywall contradizem isso frontalmente.
2. **Responder preço é sinal de respeito, não de pressa** (InfinitePay, Mercado Pago): quando o lead pergunta três vezes, desviar a quarta é tratar o lead como incapaz. A resposta correta quando o lead insiste é dar o preço com contexto, não empurrar "processo".
3. **Objeções "vou pensar" e "já tenho alguém" são códigos** (RD Station, Reev, Agendor): por trás sempre está uma das quatro raízes — dinheiro, necessidade, confiança, urgência. O caminho é substituir "por quê" por "para quê" ("Para que você precisa de mais tempo?") e descobrir a raiz real. O prompt atual não tem scripts para esses dois casos.
4. **Chatbot de IA falha quando parece bot** (WorkHub, Clint, NexusFlow): os sintomas canônicos são exatamente os vistos: repetição, resposta genérica, falha em captar intenção real, respostas que não lêem o histórico. O consenso é que o diferencial de IA real é justamente **ler o que já foi dito e adaptar**.

---

## Recomendações por camada

### 15.1 Prompt (`prompts/system.md`, `prompts/empresa.md`, `prompts/followup.md`)

**[P0] Remover a promessa de "Google em 30 dias".** Substituir em `empresa.md` e nas menções em `system.md` por formulação honesta: "Site no ar em até 7 dias. Google começa a indexar em 30 dias; ranqueamento relevante em 3 a 6 meses, varia por concorrência. Canais pagos (Ads, GMN otimizado) dão presença imediata enquanto o SEO matura." É preciso também adicionar instrução explícita: "Se o lead perguntar 'em quanto tempo fico no Google', nunca dizer 30 dias — responder o prazo real e oferecer GMN/Ads como ponte."

**[P0] Regra anti-loop de prova social.** Adicionar em `system.md` Bloco 2: "A pesquisa de concorrentes locais só pode ser mencionada UMA VEZ por conversa. Depois da primeira, referenciar como 'aqueles concorrentes que te mostrei' — nunca reabrir a lista, nunca trocar os nomes." Esta é a menor mudança com maior impacto em *credibilidade percebida*.

**[P0] Regra de preço sob pressão.** Adicionar em Bloco 3 (objeções): "Quando o lead perguntar valor ou preço duas vezes, dar o valor na resposta imediata, mesmo que o diagnóstico não esteja completo. Apresentar o valor primeiro, justificativa depois. Nunca responder 'antes de falar em valor, preciso…' a partir da segunda pergunta."

**[P0] Script para 'já tenho alguém'.** Adicionar:
```
Se lead disser "já tenho agência/freelancer":
Primeira resposta: "Legal, qual o resultado que tá vindo? [pergunta curta e sincera]"
Se o lead responde vago ou negativo: "Faz sentido, muita agência entrega site mas não entrega cliente. Posso te mostrar rápido qual é a diferença?"
Nunca atacar diretamente o concorrente. Nunca dizer "eles fazem errado".
```

**[P0] Script para 'vou pensar'.** Adicionar:
```
Se lead disser "vou pensar":
"Claro. Pra eu te mandar a informação certa depois, o que mais pesa — o valor, a dúvida se vai funcionar pro seu tipo de serviço, ou o timing (tá certo começar agora)?"
Nunca seguir insistindo. Nunca mandar vários lembretes seguidos.
```

**[P0] Regra de termômetro.** Adicionar em Bloco 2: "Um termômetro 9 ou 10 leva direto para proposta de valor na próxima resposta. Um termômetro 6 a 8 convida para agendamento. Um termômetro abaixo de 6, aprofundar dor antes de propor. **Nunca** tentar 'recalibrar' o termômetro pedindo para o lead repensar a nota."

**[P1] Tabela de gatilhos de handoff com critério.** Atualizar Bloco 4 para operacionalizar os motivos:

| Motivo | Gatilho objetivo |
|---|---|
| `lead_pediu_humano` | Frase literal "quero falar com alguém" ou "falar com humano" |
| `aceitou_proposta` | Lead verbaliza "quero fechar", "bora", "pode mandar contrato". **"Ta" NÃO é aceitação.** |
| `objecao_repetida_2x` | Mesma objeção após 2 tentativas de contorno, sem mudança |
| `conversa_longa_sem_avanco` | 15+ mensagens na mesma etapa de funil por mais de 8 turnos |
| `fora_do_icp` | Lead explicitou demanda fora do ICP (ex.: integração SAP) |
| `fim_de_expediente` | Depois das 18h em dia útil, se conversa está em proposta |

**[P1] Regra de empatia em sinal emocional.** Adicionar em Bloco 1: "Quando o lead sinalizar vulnerabilidade (foi demitido, está recomeçando, perdeu cliente, saúde), a resposta seguinte deve reconhecer o contexto humano antes de voltar para métrica. Uma frase, sem invadir."

**[P1] Proposta com UMA recomendação.** Atualizar Bloco 2 para: "Ao apresentar planos, recomendar UM explicitamente como 'o que faz mais sentido pra você' e listar os outros dois (mais barato e mais completo) como alternativa. Nunca mandar os quatro planos em bloco. Nunca apresentar projeto e planos mensais na mesma mensagem — separar em duas bolhas."

**[P1] Remover a linha do desconto no PIX.** Já levantado em `AUDITORIA-COMPLETA-2026-04-22.md`. Em `vendas-consultivas-SKILL.md`, a frase "No PIX à vista tem um desconto especial" contradiz `system.md`. Remover a frase ou remover o arquivo do bundle injetado.

**[P2] Uniformizar tom.** Adicionar guia mínimo: "Tom padrão é vizinho experiente que entende do assunto. Evitar 'o caminho natural é…', 'deixar formalizado', 'antes de qualquer cobrança' — soa jurídico. Usar 'a gente monta um contrato simples' em vez de 'contrato formalizado'." Emoji: máximo 1 por mensagem em conversa, nunca em proposta.

### 15.2 Backend (`index.js`, `sql/init.sql`)

**[P0] Tratar eco do WhatsApp.** No pipeline de normalização do histórico, detectar padrão `"<pergunta anterior do assistente>\n<resposta real do lead>"` e manter apenas a segunda parte no conteúdo do turno. Regex simples: se a mensagem do lead começa com uma substring ≥ 20 caracteres da última mensagem do assistente, descartar essa substring. Isso é um fix de 15 linhas com efeito imediato em três das cinco conversas.

**[P0] Busca real de concorrentes (ou remover a instrução).** A decisão é uma das duas:
- **Opção A (recomendada):** integrar uma busca real — Google Custom Search API, SerpAPI, Bing Web Search — executada uma vez por conversa, resultado cacheado em `lead_profiles.concorrentes` (coluna já existe). O prompt passa a receber **dados reais**.
- **Opção B:** remover do `system.md` qualquer instrução que leve o LLM a enunciar nomes de concorrentes. Substituir por texto genérico ("os primeiros do Google") até a opção A ser implementada.

A combinação atual — prompt manda pesquisar, LLM alucina, código não valida — é insustentável.

**[P0] Contador de "já respondido" por perfil.** Ligando com o padrão 13 e com a *Sales Memory Layer* da auditoria anterior: adicionar um campo `vendas.lead_profiles.coletado` (JSONB) que registra quando cada slot do perfil foi preenchido. Injetar no system prompt: "Já coletamos: segmento, cidade. Falta: ticket médio, dor. Não repergunte o que já está coletado."

**[P0] Detecção de "lead pediu preço N vezes".** Acrescentar no backend lógica: contar ocorrências das palavras `preço|preco|valor|custa|cobra|quanto` em turnos do lead. Se contagem ≥ 2 e não houve resposta com valor numérico do assistente desde a primeira pergunta, injetar no system prompt para este turno: `FLAG: lead pediu preço ${n} vezes — responda com valor nesta mensagem`. O prompt passa a tratar isso como override.

**[P1] Bloqueio de coleta de CPF pelo agente.** Impedir por pós-processamento que a mensagem enviada ao lead contenha a string `CPF` a partir do próprio agente. Se o modelo gerar, cortar e substituir por mensagem operador: "O Victor vai te mandar o formulário seguro de contrato em seguida — CPF e endereço ficam só lá, não aqui no chat." Coleta de CPF precisa sair do WhatsApp para um link com aviso de privacidade.

**[P1] Transcript sanitizer (quando tiver rollout de evals).** Já que o corpus de evals vai precisar de transcripts anonimizados (conforme `ARQUITETURA-QUALIDADE-IA.md`), montar um sanitizador que substitui telefones, CPFs, endereços por placeholders. Reaproveitar o mesmo pipeline para dashboard quando exportar para CSV.

**[P2] Métrica de "preço perguntado x respondido".** Adicionar evento `ia_preco_solicitado` e `ia_preco_respondido` na telemetria proposta em `ARQUITETURA-QUALIDADE-IA.md`. Dashboard mostra taxa de "preço não respondido dentro de N turnos".

### 15.3 Dashboard

**[P1] Visão "leads que pediram preço e não receberam".** Filtro/coluna nova na lista de conversas que destaca conversas onde o lead pediu preço nos últimos 5 turnos e o agente não respondeu com valor. Essa é a fila que mais produz venda se atuada em tempo.

**[P1] Indicador visível de preço unificado.** No perfil do lead, mostrar o preço calculado pelo motor e um alerta se a última mensagem enviada pelo agente cita um preço diferente. Evita o caso do operador mandar "R$ 200" manual e o motor ter gravado outro valor.

**[P2] Revisão humana inline de mensagem crítica.** Quando o flag `aceitou_proposta` for emitido ou quando o lead responder "Ta" após proposta, segurar o handoff 30 segundos e piscar um aviso no dashboard: "Conversa X passou para handoff — revisar". O operador pode intervir antes do envio. Evita o caso do Oséias (Manaus).

**[P2] Timeline de objeções por lead.** No perfil, bloco novo que lista objeções detectadas (valor, já tem alguém, vou pensar, timing) e quantas vezes apareceram. Serve tanto para o operador quanto para o motor de evals.

---

## Plano priorizado

**Hoje (≈ 3 horas de prompt engineering):**

1. Retirar a promessa de "Google em 30 dias" de todo o bundle de prompts.
2. Adicionar regra anti-loop de prova social.
3. Adicionar regra de "preço sob pressão" (dar preço na segunda pergunta).
4. Adicionar scripts de "vou pensar" e "já tenho alguém".
5. Corrigir regra de termômetro (não recalibrar, agir).
6. Remover linha do desconto PIX do `vendas-consultivas-SKILL.md` (já levantada).
7. Substituir coleta de CPF por link externo com aviso LGPD.

**Esta semana (≈ 1 a 2 dias de código):**

8. Fix do eco do WhatsApp no normalizador de histórico.
9. Decisão sobre busca real de concorrentes vs remover a instrução.
10. Detector de "lead pediu preço N vezes" injetando flag no prompt.
11. Campo `coletado` no perfil + instrução "não repergunte".

**Próximas duas semanas:**

12. *Sales Memory Layer* (da auditoria anterior) — resolve padrões 1, 13 estruturalmente.
13. Dashboard com visão "pediu preço e não respondeu".
14. Evals: usar essas cinco conversas (anonimizadas) como os primeiros casos. Os asserts saem direto deste documento.

---

## Ordem de experimentação recomendada

Os itens 1 a 7 são seguros de subir direto. Os itens 8 a 11 vão para shadow primeiro (geram o output novo, comparam com o antigo, mas enviam o antigo) por 48 horas, com coleta de métricas simples:

- Taxa de mensagens com "Pesquisei [cidade]" por conversa (alvo: ≤ 1).
- Taxa de "lead pediu preço e não recebeu valor em 2 turnos" (alvo: ≤ 5%).
- Taxa de "Google em 30 dias" mencionado (alvo: 0%).
- Taxa de handoff após "Ta" sem outro sinal claro de aceite (alvo: 0%).

Quando essas quatro métricas estiverem onde precisam ficar, liberar 100%.

---

## Conclusão

Os problemas encontrados **não são problemas de modelo** — são problemas de prompt e de pipeline. A qualidade do diagnóstico inicial mostra que o Claude consegue conduzir a conversa bem. O agente falha em momentos específicos e previsíveis: quando o lead pede preço, quando o lead já está pronto, quando o lead demonstra vulnerabilidade, quando a conversa se estende. A maioria das correções é de prompt e cabe em uma única sessão de revisão. As duas mudanças estruturais (busca real de concorrentes e Sales Memory Layer) são as que pagam a conta a longo prazo.

A boa notícia do ponto de vista comercial: se apenas as mudanças P0 forem aplicadas, as cinco conversas analisadas teriam tido pelo menos duas fechamentos adicionais (fretes FAG e pintor Fortaleza), e nenhuma delas teria o risco regulatório atual de promessa de SEO em 30 dias nem de coleta de CPF no chat aberto.

---

## Sources (literatura web consultada)

- [As 7 Melhores Técnicas de Vendas para 2026 — InfinitePay](https://www.infinitepay.io/blog/tecnicas-de-vendas)
- [Venda mais com o WhatsApp: estratégias para empresas em expansão — Sebrae](https://sebrae.com.br/sites/PortalSebrae/ufs/ba/artigos/venda-mais-com-o-whatsapp-estrategias-para-empresas-em-expansao,36ea1c09edf78910VgnVCM1000001b00320aRCRD)
- [WhatsApp para Pequenas Empresas em 2026 — SocialHub](https://www.socialhub.pro/blog/whatsapp-pequenas-empresas-2026/)
- [Venda Consultiva: 6 etapas + 5 metodologias — Agendor](https://www.agendor.com.br/blog/vendas-consultivas/)
- [Formação SPIN Selling Skills — Cegoc](https://www.cegoc.pt/curso-formacao/vendas-negociacao/spin-selling-skills)
- [Venda Consultiva: o que é, como fazer e as melhores práticas — DNA de Vendas](https://dnadevendas.com.br/blog/venda-consultiva/)
- [5 tipos de objeção mais comuns — Universo Cooperativo](https://universocooperativo5.wordpress.com/2026/04/22/5-tipos-de-objecao-mais-comuns-e-como-lidar-com-cada-uma-na-pratica/)
- [Como contornar objeções de vendas — RD Station](https://www.rdstation.com/blog/vendas/contornar-objecoes-de-vendas/)
- [Desvende a Objeção "Ainda Vou Pensar" — Full Sales System](https://fullsalessystem.com/blog/objecao-ainda-vou-pensar-high-ticket-tecnicas/)
- [Contornar Objeções: "vou pensar" — Zenivox](https://zenivox.com.br/contornar-objecoes-o-que-fazer-quando-o-cliente-diz-vou-pensar/)
- [Objeção em Vendas: passo a passo — Reev](https://reev.co/objecao-em-vendas/)
- [Objeções de vendas: 9 exemplos comuns — Moskit CRM](https://www.moskitcrm.com/blog/objecoes-de-vendas)
- [Top 7 Reasons Chatbots Fail in Customer Service — WorkHub](https://workhub.ai/chatbots-fail-in-customer-service/)
- [Agente de IA vs Chatbot no WhatsApp — Clint Digital](https://www.clint.digital/blog/agente-ia-vs-chatbot-whatsapp)
- [Chatbot WhatsApp com IA para Vendas — Nexus Flow](https://nexusflow.net.br/chatbot-whatsapp-vendas)
- [Quanto custa vender pelo WhatsApp — Mercado Pago](https://www.mercadopago.com.br/ajuda/27897)
- [Indicadores de qualidade do atendimento no WhatsApp — SegSmartWeb](https://segsmartwebplus.com.br/blog/qualidade-do-atendimento-ao-cliente-no-whatsapp-conheca-as-principais-metricas-e-indicadores/)
- [Seu consentimento é lei — LGPD, Serpro](https://www.serpro.gov.br/lgpd/cidadao/seu-consentimento-e-lei)
- [LGPD: como coletar dados pessoais sem infringir a Lei — Comunique-se](https://comunique-se.com.br/blog/lgpd-coletar-dados-pessoais/)
- [SEO: Quanto tempo leva para ranquear um site no Google — Ekyte](https://www.ekyte.com/guide/pt-br/blog/seo-quanto-tempo-leva-para-ranquear-um-site-no-google/)
- [Quanto tempo leva para um site ranquear no Google — EcoWebDesign](https://www.ecowebdesign.com.br/artigos/20914-quanto-tempo-leva-para-um-site-ranquear-no-google-veja-medias-de-tempo)
- [Quanto Tempo Leva para Ranquear — MPI Solutions](https://www.mpisolutions.com.br/blog/seo/quanto-tempo-leva-ranquear-um-site-google/)
