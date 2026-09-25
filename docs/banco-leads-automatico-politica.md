# Politica do Automatico do Banco de Leads

Documento operacional para manter o modo Automatico previsivel, auditavel e pronto para evoluir
quando houver mais numeros conectados.

## Baseline atual: 3 numeros

- Com 3 instancias WhatsApp ativas, o alvo operacional e cerca de 40 primeiras abordagens por dia
  no total da empresa.
- `app.banco_leads_config.teto_diario` e limite do pool inteiro, nao limite por numero.
- A divisao por instancia e derivada do pool para evitar concentracao: com teto 40 e 3 numeros, o
  limite operacional por numero fica em `ceil(40 / 3) = 14`.
- O cooldown continua por instancia. A rotina escolhe a instancia ativa com saudacao configurada,
  abaixo do limite derivado e mais descansada.
- O intervalo do Automatico continua global: a empresa dispara no maximo 1 primeira abordagem por
  ciclo. O pool aumenta o descanso real de cada numero; nao transforma o envio em lote maior.

## Primeira mensagem

A primeira mensagem deve ser uma pergunta de permissao/interesse. Ela nao deve pedir reuniao nem
forcar venda logo na abertura.

Formato esperado:

```text
Oi, tudo bem? Sou Victor, da PJ Codeworks. Vi a Solar Alfa em Campinas e tenho uma estrutura para ajudar a controlar leads, propostas e retornos pelo WhatsApp. Posso te mostrar?
```

Regras:

- Terminar com uma pergunta direta.
- Usar no maximo 1 ou 2 sinais reais do lead.
- Focar no resultado da oferta configurada.
- Se a oferta for CRM, falar de controle de leads, funil, propostas e retornos, nao apenas
  "presenca digital".
- So dizer que existe site/previa/estrutura pronta quando a oferta selecionada permitir isso.
- Nao inventar faturamento, urgencia, desconto, campanha ativa ou resultado garantido.

## Captura de interesse

A geracao da mensagem e a captura da resposta ficam separadas:

- A decisao de mensagem registra `objetivo_resposta: "capturar_interesse"`.
- O historico JSON da fila registra `respostas_esperadas.interesse` e
  `respostas_esperadas.desinteresse`.
- A resposta real do lead continua sendo interpretada pelo contrato central da conversa.
- Quando o lead diz que nao quer, nao tem interesse ou pede para parar, a IA deve emitir
  `sinal_conversa: "desinteresse"`; o core-funnel encerra/arquiva conforme a regra existente.
- Quando o lead autoriza continuar ou demonstra curiosidade, a conversa segue o funil normal.

## Prioridade dos leads

O Automatico sempre busca os melhores leads disponiveis dentro do recorte configurado:

- Recorte por nicho: usa `auto_recorte_modo = "nicho"` e `auto_nicho`, por exemplo energia solar.
  Nesse caso, a fila busca primeiro os melhores leads daquele nicho.
- Recorte geral: usa todos os leads abordaveis da empresa e ordena os melhores de qualquer nicho.
- Ordem base do backend: aprovados primeiro, maior `score`, mais antigos e `id` como desempate.
- Depois da ordenacao, a rotina ainda respeita janela local por pais, WhatsApp valido, cooldown,
  bloqueio de lead, disparos em andamento e regras de compliance.

## Como evoluir quando houver mais numeros

Antes de aumentar volume, medir:

- primeiras abordagens enviadas por dia;
- taxa de resposta;
- taxa de interesse;
- taxa de desinteresse/opt-out;
- falhas de WhatsApp e numeros sem WhatsApp;
- tempo medio ate a primeira resposta;
- desempenho por oferta, nicho, pais e identificacao usada.

Com mais numeros, a regra preferencial e revisar o teto do pool e o cooldown com base nesses
indicadores. Nao aumentar automaticamente o limite por numero apenas porque ha mais instancias.
O objetivo e melhorar distribuicao, descanso e aprendizado comercial, nao criar disparo ilimitado.
