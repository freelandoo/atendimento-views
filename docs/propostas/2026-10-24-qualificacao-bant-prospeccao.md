# Qualificação BANT adaptativa na prospecção — proposta inicial

> Data: 2026-10-24 · Status: **base de qualificação e handoff implementada; cadência de follow-up pendente**
> Origem: conversa com o operador. A entrega abaixo não cria uma cadência nem agenda novos envios.

## Objetivo

Após a primeira abordagem por IA, conduzir cada conversa até uma qualificação comercial BANT
natural: **necessidade**, **timing**, **autoridade** e **budget**. A IA deve usar tudo o que o lead
disser em cada resposta, sem repetir perguntas já respondidas, e passar o lead qualificado para
assunção humana de forma silenciosa.

## Fluxo proposto

```text
Primeira abordagem
  ├─ sem resposta → até 2 follow-ups automáticos por mensagem → tarefa de ligação humana
  └─ resposta do lead
       └─ extrair todos os sinais BANT presentes na mesma mensagem
            ├─ ainda há campo relevante em aberto → perguntar somente o próximo melhor ponto
            ├─ não respondeu à pergunta da etapa → 1 follow-up por mensagem → tarefa de ligação humana
            └─ BANT suficiente para decisão → qualificar e sinalizar para assunção humana
                                              → IA deixa de responder e follow-ups param
```

### Ordem de conversa, não formulário rígido

A prioridade sugerida é **N → T → A → B**, mas cada mensagem pode preencher qualquer combinação.
Se uma resposta à pergunta de necessidade também disser “não tenho dinheiro agora”, a IA registra
necessidade e budget; ela não volta a perguntar “qual é o seu orçamento?”. Só pode perguntar sobre
o **motivo** do bloqueio se isso ainda for útil para decidir a próxima ação.

## Dados que cada resposta precisa interpretar

| Dimensão | O que extrair | Exemplo de consequência |
| --- | --- | --- |
| Necessidade | problema, processo atual, impacto e objetivo | orientar a próxima pergunta ao gargalo real |
| Timing | agora, depois, data/evento, urgência, prioridade | distinguir “quero resolver” de “talvez um dia” |
| Autoridade | decide, influencia, precisa de sócio/gestor | preparar assunção humana com quem participa da decisão |
| Budget | disponibilidade, faixa, objeção e motivo | separar falta de caixa, falta de prioridade e falta de urgência |

### Budget não é apenas “tem dinheiro?”

Estados iniciais sugeridos: `não mencionado`, `aberto a avaliar`, `sem caixa agora`, `não é
prioridade`, `não vê urgência`, `precisa de aprovação`, `faixa discutida` e `recusou investir`.
O motivo só é tratado como confirmado quando veio do lead; a IA não pode inferir capacidade
financeira nem insistir depois de uma recusa clara.

## Cadência desejada — interpretação a confirmar

O pedido foi entendido assim:

1. após a primeira abordagem sem resposta, enviar no máximo **dois** follow-ups automáticos por
   WhatsApp, sempre conectados ao próximo ponto de qualificação;
2. depois disso, criar uma **tarefa de ligação humana** — não uma chamada automática;
3. quando o lead responde, mas um ponto BANT importante fica sem resposta, permitir **um**
   follow-up por mensagem e depois uma nova tarefa de ligação humana para aquela etapa;
4. qualquer resposta do lead pausa imediatamente os follow-ups pendentes até a IA reavaliar o
   que já foi revelado.

Os intervalos entre os follow-ups ainda não foram definidos. Eles precisam ser uma configuração
explícita antes de qualquer envio real.

## Qualificação e handoff silencioso

Um lead não deve ser chamado de qualificado apenas porque percorreu quatro perguntas. Para passar
para a pessoa, precisa haver informação suficiente para uma decisão comercial: necessidade
confirmada, sinal de timing, mapa de autoridade e situação de budget — inclusive quando algum
item for um bloqueio explícito.

Quando o critério for atingido, o sistema deve:

1. registrar o resumo BANT com evidências da conversa e confiança;
2. mudar o lead para um estado operacional de **pronto para assunção humana**;
3. criar uma pendência/aviso interno para o responsável;
4. cancelar ou pausar follow-ups automáticos pendentes;
5. deixar a IA analisar novas mensagens para atualização do resumo, mas **não responder** ao lead;
6. não avisar o lead que houve handoff.

Uma recusa clara, opt-out ou falta de interesse não é “qualificado”: interrompe automação e segue
o tratamento de bloqueio/descarte já existente, sem tentativa de reverter a decisão.

## O que pode ser reaproveitado

- O runtime de conversa já extrai necessidade, dores, objeções e `orcamento_status` por mensagem.
- A primeira abordagem já guarda oferta, estratégia, sinais e versão usada no envio.
- Há mecanismos de follow-up e de criação de tarefas/ligação; a proposta deve integrá-los, não
  criar um segundo fluxo paralelo.
- A ficha e o painel de resultados já são as superfícies naturais para mostrar resumo e origem da
  qualificação, sempre como tradução do veredito do backend.

## Requisitos funcionais da primeira entrega

1. Interpretar todos os campos BANT a cada mensagem recebida, preservando fatos já confirmados.
2. Escolher a próxima pergunta por lacuna de maior valor, não por posição fixa em uma sequência.
3. Registrar bloqueio de budget com motivo conhecido ou `motivo_a_confirmar`.
4. Pausar follow-up ao receber mensagem do lead e replanejar com o novo contexto.
5. Criar tarefa de ligação humana quando a cadência se esgotar, sem discar nem enviar nada.
6. Sinalizar handoff interno ao concluir a qualificação e cessar respostas automáticas.
7. Manter histórico auditável de resposta, extração, decisão, follow-up e handoff, por empresa.

## Fora de escopo nesta etapa

- pesquisa automática na internet para declarar dores de um nicho;
- expansão do contexto de nicho para toda a conversa;
- novo dashboard analítico ou mudança no painel atual;
- ligação automática, cobrança, agendamento ou envio real sem configuração e autorização;
- deduzir poder de compra, autoridade ou urgência sem evidência textual do lead.

## Impactos e guardas obrigatórias

- A fonte de verdade do BANT deve ficar no backend e ser isolada por `empresa_id`.
- Uma resposta do lead deve vencer qualquer job pendente; nunca pode receber um follow-up depois
  de já ter respondido.
- O handoff precisa ser idempotente: não criar vários avisos/tarefas para a mesma qualificação.
- O resumo interno deve declarar fatos, inferências e lacunas separadamente.
- A tela não pode decidir se o BANT está completo nem reativar o bot por conta própria.

## Entrega implementada em 2026-10-24

- O runtime de conversa extrai BANT em toda resposta e guarda o estado em
  `app.lead_insights.dados_extraidos.qualificacao_bant`, isolado por empresa e lead.
- Uma resposta com vários sinais preenche vários eixos; dado ausente no turno atual não apaga
  um fato já confirmado. Estados de budget exigem esclarecimento quando a causa ainda não é
  conhecida.
- A IA recebe a próxima lacuna BANT como orientação e não deve repetir um eixo já confirmado.
- Quando necessidade, timing, autoridade e budget são favoráveis e conhecidos, o lead fica em
  **aguardando handoff** e passa para **modo Análise**; os follow-ups pendentes daquele
  lead/empresa são cancelados e o operador recebe handoff interno. A mensagem que fecharia a
  qualificação não é enviada ao lead.
- Em modo Análise, mensagens posteriores continuam atualizando os insights, sem nova resposta,
  oferta de agenda ou alerta duplicado.
- A Central de Mensagens mostra um bloco **Sinais BANT** ao abrir a conversa. A ficha do Banco de
  Leads mostra o mesmo bloco dentro de **Qualificação**, antes do ICP. A fonte é o veredito do
  backend; nenhuma tela recalcula quem é qualificado.
- Verde significa sinal confirmado; amarelo significa sinal pendente ou que ainda precisa de
  esclarecimento; vermelho é reservado a impedimento **explícito**. Falta de resposta, falta de
  caixa no momento ou necessidade de aprovação não descartam sozinhas o lead.

## Dores do nicho: hipótese, evidência e confirmação

Uma dor não pode virar fato só porque a IA conhece um mercado. A próxima evolução deve guardar a
procedência de cada sinal em três grupos: `declarada_pelo_lead` (única que pode confirmar BANT),
`observada_no_negocio` (fato público específico, como ausência de site próprio) e
`hipotese_de_nicho` (ideia para orientar uma pergunta). Uma hipótese de nicho só pode ser usada
para perguntar e precisa ser confirmada na conversa antes de orientar qualificação ou automação.

Pesquisa externa automática não foi habilitada nesta entrega. Se for aprovada depois, cada fonte
precisa guardar URL, data de coleta e versão, e o resultado continua sendo hipótese — não uma dor
atribuída ao lead.

## Decisão necessária antes da cadência automática

Definir a cadência dos dois follow-ups automáticos: quantas horas ou dias depois da primeira
abordagem e entre um follow-up e outro.

Também falta definir, em regra explícita, quais recusas autorizam descartar automaticamente. A
implementação atual apenas interrompe a automação quando há impedimento explícito; não muda o
status da carteira nem exclui o lead por conta própria.
