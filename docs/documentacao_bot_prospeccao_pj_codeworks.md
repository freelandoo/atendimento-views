# Documentação Funcional — Bot de Prospecção PJ Codeworks

## 1. Visão geral

O Bot de Prospecção da PJ Codeworks será um sistema de prospecção ativa com IA, integrado à busca de leads no Google Maps, geração automática de mensagens personalizadas, agendamento diário de envios e acompanhamento de resultados por dashboard.

A proposta é transformar a prospecção em uma operação controlada, configurável e orientada por dados, evitando disparos aleatórios e permitindo que a IA aprenda quais categorias, cidades, horários e abordagens geram melhores resultados comerciais.

O fluxo principal do bot será:

**prospecção → primeira resposta → qualificação → reunião/proposta → atendimento humano**

O bot de prospecção será responsável principalmente por encontrar leads, montar a fila diária, gerar mensagens personalizadas e iniciar o contato. Quando o lead responder, ele sai do fluxo de prospecção e entra no fluxo do bot de vendas/qualificação.

---

## 2. Objetivo principal do bot

O objetivo do bot é criar uma operação automatizada de aquisição de oportunidades comerciais para a PJ Codeworks.

### Objetivos operacionais

- Buscar leads no Google Maps.
- Selecionar leads com potencial comercial.
- Gerar mensagens personalizadas com IA.
- Agendar envios ao longo do dia.
- Enviar mensagens dentro dos horários permitidos.
- Registrar respostas.
- Encaminhar leads respondidos para o bot de vendas.
- Medir resultados por categoria, cidade, horário, modo e estágio do funil.

### Objetivo comercial

O bot não deve ser medido apenas por quantidade de mensagens enviadas. A métrica mais importante será a geração de oportunidades reais.

As principais métricas de sucesso serão:

1. Quantidade de reuniões geradas.
2. Quantidade de clientes fechados.
3. Custo por oportunidade.

---

## 3. Modos de operação

O sistema terá três modos principais:

1. Manual.
2. Semiautomático.
3. Automático.

Cada modo deverá ter uma explicação rápida dentro da interface para facilitar o entendimento do operador.

---

## 4. Modo Manual

O modo manual será usado quando o operador quiser controlar todas as etapas da prospecção.

### Funcionamento

No modo manual, o operador poderá:

- Pesquisar leads manualmente.
- Escolher categoria/nicho.
- Escolher cidade, estado ou região.
- Visualizar os leads encontrados.
- Solicitar que a IA gere uma mensagem para cada lead.
- Editar a mensagem antes do envio.
- Enviar manualmente.
- Usar a opção “gerar e enviar mensagem”.

### Regras do modo manual

- A IA pode gerar mensagens, mas o operador terá controle para editar.
- O envio pode ser feito manualmente pelo operador.
- O modo manual não exige aprovação de fila automática, porque a fila automatizada não será o foco desse modo.
- Ao ativar o modo manual, o sistema deve sair do modo automático, mantendo controle sobre o que já foi programado.

### Explicação para interface

**Modo Manual:** você pesquisa os leads, revisa as mensagens e decide quando enviar. Ideal para testes, abordagens específicas ou prospecções com controle total.

---

## 5. Modo Semiautomático

O modo semiautomático será usado quando o operador quiser definir a categoria/nicho, mas deixar o sistema cuidar do restante.

### Funcionamento

O operador escolhe:

- Categoria ou tag.
- Cidade, estado, região ou raio, se desejar.
- Horário permitido de envio.
- Dias da semana permitidos.
- Intervalo entre mensagens.

Depois disso, o bot:

- Busca leads no Google Maps.
- Avalia os leads encontrados.
- Monta a fila diária.
- Gera mensagens personalizadas somente para os leads realmente agendados.
- Agenda os envios nos horários disponíveis.
- Envia automaticamente.
- Registra resultados.

### Explicação para interface

**Modo Semiautomático:** você escolhe o nicho ou categoria, e o bot pesquisa, organiza, agenda e envia as mensagens respeitando os limites definidos.

---

## 6. Modo Automático

O modo automático será o modo mais inteligente e autônomo do sistema.

### Funcionamento

No modo automático, a IA poderá decidir:

- Qual nicho prospectar.
- Qual cidade ou região pesquisar.
- Qual combinação de categoria + local tem mais potencial.
- Quantos leads serão necessários para preencher a agenda diária.
- Quais leads devem ser priorizados.
- Quais mensagens serão geradas.
- Quando cada mensagem será enviada, respeitando horário, intervalo e limite diário.

### Limites do modo automático

Mesmo no modo automático, a IA deverá respeitar:

- Horário permitido de envio.
- Dias permitidos da semana.
- Limite diário de mensagens.
- Intervalo fixo entre mensagens.
- Lista de bloqueio.
- Regras de duplicidade.
- Estágios do funil.
- Leads que já estão em atendimento.

### Lógica de aprendizado

O modo automático deve trabalhar com aprendizado por resultado.

A IA deve priorizar categorias, cidades e horários com base em:

- Maior chance de resposta.
- Maior ticket médio provável.
- Maior necessidade de site, sistema, automação ou solução digital.
- Cidades com maior potencial.
- Histórico de conversão.
- Categorias que avançam mais no funil.
- Categorias que geram mais reuniões.
- Categorias que geram mais clientes fechados.
- Testes de novas categorias e cidades.

### Exploração e histórico

O automático não deve apenas repetir o que já funcionou. Ele deve equilibrar:

- **Exploração:** testar novos nichos, cidades e abordagens.
- **Aproveitamento:** priorizar o que já demonstrou boa performance.

Essa lógica evita que o sistema fique preso sempre nos mesmos nichos e permite evolução com o tempo.

### Explicação para interface

**Modo Automático:** a IA escolhe o melhor nicho, cidade e estratégia com base no histórico de resultados, monta a fila do dia e envia as mensagens automaticamente dentro dos limites configurados.

---

## 7. Configuração de horário de envio

O sistema deverá permitir que o operador configure uma janela diária de envio.

Exemplo:

- Início: 08:00.
- Fim: 17:00.
- Intervalo: 15 minutos.

Com essa configuração, o sistema cria slots como:

- 08:00.
- 08:15.
- 08:30.
- 08:45.
- 09:00.
- E assim por diante.

Cada slot poderá receber uma mensagem agendada.

### Regras

- O intervalo será fixo.
- Não haverá variação aleatória de horário.
- O bot só pode enviar mensagens dentro do período permitido.
- Fora do horário, nenhuma nova mensagem de prospecção deve ser enviada.
- O sistema deve preencher a agenda diária conforme o intervalo configurado.

---

## 8. Dias permitidos da semana

O sistema deverá permitir que o operador escolha em quais dias o bot pode enviar mensagens.

Exemplo:

- Segunda-feira: ativo.
- Terça-feira: ativo.
- Quarta-feira: ativo.
- Quinta-feira: ativo.
- Sexta-feira: ativo.
- Sábado: inativo.
- Domingo: inativo.

### Regras

- O operador pode ativar ou desativar qualquer dia da semana.
- O bot não deve agendar mensagens para dias desativados.
- Se houver leads excedentes, eles devem ser reagendados para o próximo dia permitido.

---

## 9. Limite diário de mensagens

O limite diário inicial será de:

**80 mensagens por dia.**

### Regras

- O bot não pode ultrapassar 80 mensagens no mesmo dia.
- Se a quantidade de slots disponíveis for maior que 80, o limite diário prevalece.
- Se a quantidade de slots disponíveis for menor que 80, o horário e intervalo prevalecem.
- O sistema deve considerar o menor valor entre:
  - limite diário configurado;
  - quantidade de slots disponíveis no período;
  - quantidade de leads válidos encontrados.

### Exemplo

Se o horário permitido for das 08:00 às 17:00 com intervalo de 15 minutos, existem aproximadamente 37 slots.

Mesmo com limite diário de 80 mensagens, nesse caso o sistema só poderá agendar a quantidade de mensagens que cabe dentro da janela configurada.

---

## 10. Criação da fila diária

A fila diária deverá ser criada de uma vez, no começo do dia.

### Processo

1. O sistema verifica se o dia atual está permitido para envio.
2. O sistema lê a configuração ativa.
3. O sistema identifica o modo ativo: manual, semiautomático ou automático.
4. O sistema define categoria, cidade, estado ou região conforme o modo.
5. O sistema pesquisa leads no Google Maps.
6. O sistema filtra leads inválidos, duplicados ou bloqueados.
7. O sistema calcula os slots disponíveis no dia.
8. O sistema seleciona a quantidade necessária de leads.
9. O sistema gera mensagens apenas para os leads que serão realmente agendados.
10. O sistema agenda cada mensagem em um slot.
11. A fila fica pronta para envio ao longo do dia.

### Regra importante

A mensagem só deve ser gerada para o lead se ele estiver realmente agendado para envio.

Isso evita custo desnecessário de IA, mensagens obsoletas e geração de conteúdo para leads que talvez nunca sejam contatados.

---

## 11. Slots de envio

O sistema deve gerar os horários de envio com base em:

- Hora inicial.
- Hora final.
- Intervalo fixo.
- Dias permitidos.
- Limite diário.

### Exemplo

Configuração:

- Início: 08:00.
- Fim: 17:00.
- Intervalo: 30 minutos.

Slots:

- 08:00.
- 08:30.
- 09:00.
- 09:30.
- 10:00.
- E assim por diante.

Cada slot pode receber um único envio.

---

## 12. Excedente de leads

Se o sistema encontrar mais leads do que a quantidade possível de envios no dia, os leads excedentes não devem ser descartados.

### Regra

Leads excedentes devem ficar com status:

**aguardando agendamento**

Depois, devem ser enviados para o próximo dia permitido, respeitando novamente:

- horário permitido;
- intervalo;
- limite diário;
- regras de duplicidade;
- bloqueios;
- modo ativo.

O sistema não precisa perguntar antes de reagendar.

---

## 13. Exclusão de lead da fila

O operador poderá excluir um lead da fila.

### Regra

Quando um lead for removido da fila:

1. O lead removido deixa de receber a mensagem agendada.
2. O sistema recalcula a fila.
3. O sistema busca ou seleciona outro lead válido.
4. O sistema preenche o slot que ficou disponível, se houver lead elegível.
5. O novo lead só terá mensagem gerada se for realmente agendado.

---

## 14. Categorias e tags

As categorias funcionarão como um sistema de tags.

### Categorias iniciais

- Dentistas.
- Clínicas.
- Psicólogos.
- Advogados.
- Contadores.
- Mecânicas.
- Restaurantes.
- Prestadores de serviço.
- Estética.
- Construção/reforma.
- Diaristas/limpeza.
- Taxistas/motoristas.
- Lojas locais.

### Regras do sistema de tags

- Um lead pode ter uma ou mais tags.
- Uma categoria pode ter variações de busca.
- A IA pode sugerir novas tags com base nos resultados.
- O operador pode criar, editar ou desativar tags.
- No modo semiautomático, o operador escolhe a tag principal da busca.
- No modo automático, a IA escolhe a tag com base em potencial e histórico.

### Exemplo

Tag principal:

**Construção/reforma**

Possíveis buscas relacionadas:

- azulejista;
- pedreiro;
- reformas;
- pintura residencial;
- instalação de piso;
- porcelanato;
- gesseiro.

---

## 15. Configuração de cidade, estado e região

A escolha de localização deverá ser configurável.

O sistema deve permitir:

- Uma cidade por dia.
- Várias cidades por dia.
- Cidade + estado.
- Cidade + raio próximo.
- Região personalizada.
- Prioridade por região.

### Exemplos

- Dentistas em Santo André/SP.
- Clínicas em São Bernardo do Campo/SP.
- Prestadores de serviço no Grande ABC.
- Mecânicas em Diadema/SP.
- Estética em São Caetano do Sul/SP.

### Regra

A localização pode ser definida pelo operador no modo manual e semiautomático.

No modo automático, a IA pode escolher a localização com base em:

- histórico de resposta;
- potencial comercial;
- densidade de empresas;
- resultados anteriores;
- cidades com maior avanço no funil;
- cidades com maior taxa de reunião ou fechamento.

---

## 16. Busca no Google Maps

A busca de leads será feita através do Google Maps/Google Places.

### Dados desejados por lead

Sempre que possível, o sistema deve capturar:

- Nome da empresa.
- Categoria.
- Telefone.
- WhatsApp, se identificável.
- Cidade.
- Estado.
- Endereço.
- Avaliação.
- Quantidade de avaliações.
- Site atual.
- Link do Google Maps.
- Horário de funcionamento.
- Indícios de presença digital fraca.
- Observações úteis para personalização da abordagem.

### Score do lead

Cada lead deve receber um score para orientar a decisão da IA.

Possíveis critérios:

- Tem telefone disponível.
- Não possui site.
- Possui site fraco/desatualizado.
- Tem boas avaliações.
- Tem muitas avaliações.
- Atua em nicho com bom potencial.
- Está em cidade prioritária.
- Categoria já teve bons resultados.
- Possui sinais de negócio ativo.
- Parece depender de atendimento local.

---

## 17. Geração de mensagem com IA

A mensagem inicial será sempre gerada pela IA para cada lead agendado.

### Regras

- A mensagem não deve ser fixa.
- A mensagem não deve ser apenas um template com pequenas variações.
- A IA deve gerar uma mensagem personalizada analisando o score, categoria, cidade e informações disponíveis do lead.
- A mensagem deve ser diferente por categoria.
- No modo manual, o operador poderá editar antes de enviar.
- No modo semiautomático e automático, a mensagem será enviada sem aprovação manual.

### Quando gerar a mensagem

A mensagem só deve ser gerada quando o lead estiver confirmado na fila de envio.

### Personalização por categoria

A mensagem para um dentista deve ser diferente da mensagem para:

- azulejista;
- mecânica;
- clínica;
- restaurante;
- advogado;
- contador;
- loja local;
- estética.

### Diretriz de comunicação

A abordagem deve ser consultiva, curta e natural.

A mensagem não deve parecer disparo em massa.

Ela deve conectar:

- o tipo de negócio do lead;
- a cidade/localização;
- uma possível oportunidade digital;
- um convite leve para conversa.

### Exemplo conceitual

Em vez de dizer apenas:

“Olá, fazemos sites profissionais.”

A IA deve construir algo mais contextual, como:

“Oi, tudo bem? Vi que vocês atendem na região de Santo André e queria te fazer uma pergunta rápida: hoje a maioria dos clientes chega mais por indicação ou pelo Google/WhatsApp?”

O objetivo da primeira mensagem é gerar resposta, não vender tudo de uma vez.

---

## 18. Controle de duplicidade e bloqueios

O sistema deve bloquear automaticamente leads que:

- Já receberam mensagem antes.
- Já responderam.
- Já estão em atendimento.
- Já viraram clientes.
- Já foram descartados.
- Têm telefone repetido.
- Estão em lista de bloqueio.

### Regra de recontato

Um lead só poderá ser prospectado novamente após:

**60 dias**

### Regras adicionais

- O telefone deve ser o principal identificador de duplicidade.
- O sistema deve normalizar telefones antes de comparar.
- Telefones iguais com formatos diferentes devem ser tratados como o mesmo lead.
- Leads bloqueados não devem voltar para a fila automaticamente.
- Clientes fechados nunca devem entrar novamente em prospecção fria.
- Leads em atendimento não devem receber nova mensagem de prospecção.

---

## 19. Resposta do lead

Quando o lead responder, ele deve sair do fluxo de prospecção.

### Fluxo

1. Lead responde.
2. Sistema marca como “respondeu”.
3. Sistema classifica temperatura inicial.
4. Lead é removido da fila de prospecção, se ainda houver envios pendentes.
5. Lead entra no fluxo do bot de vendas.
6. Bot de vendas assume a qualificação.

### Regras

- O bot de prospecção não continua tentando prospectar quem já respondeu.
- O bot pode responder de forma consultiva no primeiro retorno, mas a responsabilidade passa para o bot de vendas.
- A IA de vendas será responsável pela qualificação, perguntas, diagnóstico e avanço comercial.

---

## 20. Estágios oficiais do funil

Os estágios iniciais serão mantidos conforme a estrutura atual do projeto, com possibilidade de análise posterior.

### Estágios

- Novo.
- Prospectado.
- Respondeu.
- Interesse claro.
- Diagnóstico.
- Proposta.
- Reunião.
- Fechado.
- Perdido.
- Sem resposta.
- Bloqueado.

### Observação

Antes da implementação final, será necessário analisar os estágios já existentes no projeto e garantir compatibilidade com o banco de dados e telas atuais.

---

## 21. Prévia rápida da IA

A página de prospecção deverá ter uma área de prévia rápida da IA.

Essa prévia deve mostrar o que o bot está fazendo no dia.

### Informações exibidas

- Modo ativo: manual, semiautomático ou automático.
- Nicho/categoria do dia.
- Cidade/estado/região pesquisada.
- Quantidade de leads encontrados.
- Quantidade de mensagens agendadas.
- Próximo horário de envio.
- Motivo da escolha da IA.
- Status atual.

### Possíveis status

- Pesquisando.
- Agendando.
- Enviando.
- Pausado.
- Concluído.
- Erro.
- Aguardando próximo dia permitido.

### Organização visual

A prévia deve ser completa, mas simples de visualizar.

Uma boa solução é usar abas dentro da página de prospecção.

Exemplo:

- Resumo de hoje.
- Fila do dia.
- Pesquisa da IA.
- Mensagens.
- Resultados.

---

## 22. Abas da página de prospecção

A tela de prospecção poderá ser organizada em abas.

### Abas sugeridas

1. Configuração.
2. Fila do Dia.
3. Pesquisa da IA.
4. Mensagens.
5. Resultados.
6. Dashboard.
7. Histórico.
8. Bloqueios.

---

## 23. Aba Configuração

A aba Configuração será usada para definir o comportamento do bot.

### Campos principais

- Modo ativo: manual, semiautomático ou automático.
- Horário inicial de envio.
- Horário final de envio.
- Intervalo entre mensagens.
- Limite diário de mensagens.
- Dias da semana permitidos.
- Categoria/tag padrão.
- Cidade/estado/região.
- Configuração de raio, se aplicável.
- Instância de WhatsApp usada.
- Ativar/desativar prospecção.

### Botões

- Salvar configuração.
- Pausar prospecção do dia.
- Ativar modo manual.
- Forçar envio manual.

---

## 24. Aba Fila do Dia

A aba Fila do Dia mostrará todos os envios programados para o dia.

### Informações por item

- Horário agendado.
- Nome do lead.
- Telefone.
- Categoria/tag.
- Cidade/estado.
- Score.
- Status da mensagem.
- Mensagem gerada.
- Modo de origem.

### Status possíveis

- Agendado.
- Enviado.
- Falhou.
- Respondido.
- Cancelado.
- Aguardando agendamento.

### Ações

- Ver lead.
- Ver mensagem.
- Editar mensagem, quando permitido.
- Excluir da fila.
- Forçar envio manual.

### Regra ao excluir

Ao excluir um lead da fila, o sistema deve tentar preencher o horário com outro lead válido.

---

## 25. Aba Pesquisa da IA

Essa aba mostrará a lógica da IA para o dia.

### Informações

- Categoria escolhida.
- Cidade/região escolhida.
- Motivo da escolha.
- Dados usados para decisão.
- Histórico considerado.
- Quantidade de leads encontrados.
- Quantidade de leads aprovados.
- Quantidade de leads descartados.
- Principais motivos de descarte.

### Exemplo de motivo da IA

“A IA escolheu clínicas em Santo André/SP porque essa categoria teve alta taxa de resposta nos últimos 14 dias, bom avanço para diagnóstico e presença de empresas com sites fracos ou inexistentes.”

---

## 26. Aba Mensagens

Essa aba mostrará as mensagens geradas pela IA.

### Informações

- Lead.
- Categoria.
- Cidade.
- Score.
- Mensagem gerada.
- Horário de envio.
- Status.
- Possibilidade de edição no modo manual.

### Regras

- No modo manual, o operador pode gerar, editar e enviar.
- No modo semiautomático e automático, as mensagens são geradas e enviadas automaticamente.
- Mensagens de leads não agendados não devem ser geradas.

---

## 27. Aba Resultados

A aba Resultados trará o resumo operacional do dia ou do período selecionado.

### Indicadores

- Mensagens enviadas.
- Respostas recebidas.
- Taxa de resposta.
- Categoria escolhida.
- Cidade e estado.
- Leads que chegaram em diagnóstico.
- Leads que chegaram em proposta.
- Reuniões geradas.
- Clientes fechados.
- Custo por oportunidade, se houver dados de custo.

---

## 28. Dashboard de performance

O dashboard será a área estratégica para análise da prospecção.

Ele deverá permitir entender quais categorias, cidades, horários e modos geram melhores resultados.

### Filtros obrigatórios

- Período.
- Categoria.
- Cidade.
- Estado.
- Modo usado.
- Status/funil.
- Mensagens enviadas.
- Respostas recebidas.
- Taxa de resposta.
- Leads que chegaram em diagnóstico.
- Leads que chegaram em proposta.
- Leads fechados.
- Melhor categoria.
- Melhor cidade.
- Melhor horário de envio.

### Perguntas que o dashboard deve responder

- Qual categoria mais responde?
- Qual categoria gera mais diagnóstico?
- Qual categoria gera mais proposta?
- Qual categoria gera mais reunião?
- Qual categoria gera mais cliente fechado?
- Qual cidade responde melhor?
- Qual cidade avança mais no funil?
- Qual horário tem melhor taxa de resposta?
- Qual modo gera melhores oportunidades?
- Qual combinação categoria + cidade tem maior potencial?

---

## 29. Métricas principais

As métricas principais serão:

1. Reuniões geradas.
2. Clientes fechados.
3. Custo por oportunidade.

### Métricas secundárias

- Mensagens enviadas.
- Respostas recebidas.
- Taxa de resposta.
- Diagnósticos iniciados.
- Propostas enviadas.
- Taxa de avanço por estágio.
- Taxa de perda.
- Leads bloqueados.
- Falhas de envio.

---

## 30. Controles manuais

O sistema deverá ter controles para intervenção do operador.

### Controles permitidos

- Pausar prospecção do dia.
- Ativar modo manual.
- Excluir lead da fila.
- Forçar envio manual.

### Controles não previstos inicialmente

- Pausar categoria individualmente.
- Pausar cidade individualmente.
- Aprovar fila antes do envio.
- Reenviar fila amanhã manualmente.

### Regra sobre pausa geral

Ao clicar no modo manual, o sistema deixa de operar automaticamente e passa para controle manual, respeitando o que já está pronto e evitando novos agendamentos automáticos indevidos.

---

## 31. Erros e falhas de envio

Quando ocorrer erro no envio, o sistema deverá tentar reenviar automaticamente.

### Regra de tentativa

- Máximo de 2 tentativas automáticas.

### Depois das tentativas

Se continuar falhando:

- Marcar mensagem como falha.
- Registrar motivo do erro.
- Exibir alerta no dashboard.
- Manter histórico da falha.

### Regra sobre instância

O sistema não deve pausar automaticamente a instância inteira se houver muitas falhas.

Porém, deve mostrar alerta para o operador analisar.

### Exemplos de erros monitorados

- Erro 500 da Evolution API.
- Telefone inválido.
- Instância desconectada.
- Falha de autenticação.
- Timeout.
- Erro de payload.
- Bloqueio ou rejeição do envio.

---

## 32. Relatório diário

No final do dia, o sistema deverá gerar um relatório completo para os operadores.

### Conteúdo do relatório

- Total de mensagens enviadas.
- Total de falhas.
- Total de respostas.
- Taxa de resposta.
- Categoria pesquisada.
- Cidade/estado pesquisado.
- Modo utilizado.
- Leads que entraram em diagnóstico.
- Leads que avançaram para proposta.
- Reuniões geradas.
- Clientes fechados, se houver.
- Principais aprendizados do dia.
- Sugestão da IA para o próximo dia.

### Exemplo de resumo

“Hoje foram enviados 42 contatos para clínicas odontológicas em Santo André/SP. 8 responderam, 3 entraram em diagnóstico e 1 pediu proposta. A IA recomenda continuar em clínicas de Santo André amanhã, mas testar também São Bernardo do Campo por potencial semelhante.”

### Canais

O relatório deve aparecer na plataforma e também ser enviado aos operadores, preferencialmente via WhatsApp.

---

## 33. Nível de autonomia da IA

No modo automático, a IA poderá operar livremente, desde que respeite os limites configurados.

### A IA pode

- Escolher nicho.
- Escolher cidade/região.
- Definir a busca do dia.
- Selecionar leads.
- Preencher a agenda diária.
- Gerar mensagens.
- Enviar mensagens.
- Aprender com resultados.
- Sugerir melhorias.

### A IA não pode

- Ignorar limite diário.
- Enviar fora do horário permitido.
- Enviar em dia desativado.
- Enviar para lead bloqueado.
- Enviar para lead em atendimento.
- Reprospectar antes de 60 dias.
- Ultrapassar regras de duplicidade.

---

## 34. Lógica de decisão da IA no automático

A IA deverá escolher o nicho e cidade do dia com base em um sistema de pontuação.

### Critérios sugeridos

#### Performance histórica

- Taxa de resposta por categoria.
- Taxa de avanço para diagnóstico.
- Taxa de avanço para proposta.
- Taxa de reunião.
- Taxa de fechamento.

#### Potencial comercial

- Ticket médio provável.
- Necessidade provável de site/sistema/automação.
- Maturidade digital baixa.
- Mercado local ativo.

#### Qualidade dos leads encontrados

- Leads com telefone.
- Leads sem site.
- Leads com site ruim.
- Leads com muitas avaliações.
- Leads com boa reputação.

#### Aprendizado e exploração

- Nichos pouco testados.
- Cidades novas.
- Variações de abordagem.
- Comparação entre regiões.

### Resultado esperado

A IA deve conseguir justificar sua decisão de forma simples na interface.

Exemplo:

“Escolhi estética em São Caetano do Sul porque a categoria teve boa taxa de resposta nos últimos dias, possui ticket médio maior e vários leads encontrados não possuem site profissional.”

---

## 35. Regras anti-spam e segurança operacional

O sistema precisa evitar comportamento agressivo ou repetitivo.

### Regras

- Respeitar limite diário.
- Respeitar intervalo fixo.
- Não enviar mensagens duplicadas.
- Não enviar para leads já abordados nos últimos 60 dias.
- Não enviar para clientes.
- Não enviar para leads em atendimento.
- Não enviar mensagens fora do horário.
- Não gerar várias mensagens de uma vez para o mesmo lead.
- Não tentar reenviar infinitamente em caso de erro.

---

## 36. Integração com bot de vendas

O bot de prospecção será responsável pela abertura da conversa.

Depois da resposta do lead, o fluxo passa para o bot de vendas.

### Transição

1. Lead responde.
2. Sistema marca como respondido.
3. Sistema classifica temperatura.
4. Sistema envia o contexto para o bot de vendas.
5. Bot de vendas conduz qualificação.

### Contexto enviado ao bot de vendas

- Nome do lead.
- Telefone.
- Categoria.
- Cidade.
- Mensagem inicial enviada.
- Resposta do lead.
- Score do lead.
- Fonte: Google Maps.
- Modo de origem.
- Data/hora da prospecção.

---

## 37. Estrutura de dados sugerida

### Tabela: prospecting_settings

Campos sugeridos:

- id.
- modo_ativo.
- horario_inicio.
- horario_fim.
- intervalo_minutos.
- limite_diario.
- dias_semana_ativos.
- categoria_padrao.
- cidade_padrao.
- estado_padrao.
- regiao_padrao.
- raio_km.
- ativo.
- criado_em.
- atualizado_em.

### Tabela: prospecting_daily_runs

Representa a execução diária.

Campos sugeridos:

- id.
- data.
- modo.
- categoria_escolhida.
- cidade_escolhida.
- estado_escolhido.
- motivo_escolha_ia.
- status.
- leads_encontrados.
- leads_validos.
- mensagens_agendadas.
- mensagens_enviadas.
- respostas_recebidas.
- falhas.
- criado_em.
- finalizado_em.

### Tabela: prospecting_queue

Representa os envios agendados.

Campos sugeridos:

- id.
- daily_run_id.
- lead_id.
- horario_agendado.
- status.
- mensagem_gerada.
- tentativas_envio.
- ultimo_erro.
- enviado_em.
- respondido_em.
- criado_em.
- atualizado_em.

### Tabela: prospecting_leads

Representa os leads coletados.

Campos sugeridos:

- id.
- nome.
- telefone.
- telefone_normalizado.
- categoria.
- tags.
- cidade.
- estado.
- endereco.
- google_maps_url.
- website.
- rating.
- total_avaliacoes.
- score.
- status_funil.
- ultima_prospeccao_em.
- bloqueado.
- motivo_bloqueio.
- criado_em.
- atualizado_em.

### Tabela: prospecting_messages

Representa histórico de mensagens.

Campos sugeridos:

- id.
- lead_id.
- queue_id.
- conteudo.
- modo.
- status.
- enviado_em.
- erro.
- criado_em.

### Tabela: prospecting_blocklist

Representa bloqueios manuais ou automáticos.

Campos sugeridos:

- id.
- telefone_normalizado.
- motivo.
- origem.
- criado_em.

---

## 38. Regras de status da fila

### Status da fila

- aguardando_agendamento;
- agendado;
- enviando;
- enviado;
- falhou;
- respondido;
- cancelado;
- reagendado.

### Transições principais

- aguardando_agendamento → agendado.
- agendado → enviando.
- enviando → enviado.
- enviando → falhou.
- enviado → respondido.
- agendado → cancelado.
- aguardando_agendamento → reagendado.

---

## 39. Regras de status do lead

### Status do lead

- novo;
- prospectado;
- respondeu;
- interesse_claro;
- diagnostico;
- proposta;
- reuniao;
- fechado;
- perdido;
- sem_resposta;
- bloqueado.

### Regras

- Quando a mensagem é enviada, o lead vira prospectado.
- Quando responde, vira respondeu.
- Depois disso, o bot de vendas pode atualizar para interesse claro, diagnóstico, proposta, reunião, fechado ou perdido.
- Leads bloqueados não entram mais na fila.

---

## 40. Comportamento esperado por cenário

### Cenário 1: dia permitido e modo automático ativo

1. Sistema inicia execução diária.
2. IA escolhe categoria e localização.
3. Sistema busca leads.
4. Sistema filtra duplicados e bloqueados.
5. Sistema cria slots.
6. Sistema agenda mensagens.
7. Sistema gera mensagens para leads agendados.
8. Sistema envia ao longo do dia.
9. Sistema registra resultados.
10. Sistema gera relatório diário.

### Cenário 2: dia não permitido

1. Sistema identifica que o dia está desativado.
2. Nenhuma fila nova é criada.
3. Leads aguardando continuam aguardando.
4. Sistema mostra status “aguardando próximo dia permitido”.

### Cenário 3: mais leads do que slots

1. Sistema agenda leads até o limite possível.
2. Excedentes ficam como aguardando agendamento.
3. Excedentes são usados no próximo dia permitido.

### Cenário 4: menos leads do que slots

1. Sistema agenda todos os leads válidos.
2. Se necessário, pode ampliar busca dentro da configuração.
3. Se ainda não houver leads suficientes, a fila fica parcialmente preenchida.

### Cenário 5: erro no envio

1. Sistema tenta enviar.
2. Se falhar, tenta novamente até 2 vezes.
3. Se falhar de novo, marca como falha.
4. Mostra alerta no dashboard.

### Cenário 6: lead responde

1. Sistema identifica resposta.
2. Marca lead como respondido.
3. Remove do fluxo de prospecção.
4. Envia contexto para o bot de vendas.
5. Bot de vendas assume.

---

## 41. Requisitos de interface

A interface deve ser clara, moderna e operacional.

### Direção visual

- Layout limpo.
- Cards objetivos.
- Separação por abas.
- Indicadores visuais de status.
- Botões de ação bem definidos.
- Uso de azul como destaque de ação.
- Aparência de painel inteligente e profissional.

### Componentes importantes

- Card de modo ativo.
- Card de agenda do dia.
- Card de pesquisa da IA.
- Tabela de fila.
- Tabela de leads.
- Gráficos de performance.
- Alertas de erro.
- Relatório diário.
- Filtros avançados.

---

## 42. Prioridades para implementação

### Fase 1 — Configuração e fila diária

- Criar configuração de modo.
- Criar horário inicial/final.
- Criar intervalo fixo.
- Criar limite diário.
- Criar dias permitidos.
- Criar geração de slots.
- Criar fila diária.

### Fase 2 — Google Maps e leads

- Integrar busca por categoria/local.
- Salvar leads.
- Normalizar telefones.
- Criar bloqueio de duplicidade.
- Criar score básico.

### Fase 3 — Mensagem com IA

- Gerar mensagem por lead agendado.
- Personalizar por categoria, cidade e score.
- Permitir edição no modo manual.
- Salvar histórico de mensagens.

### Fase 4 — Envio e controle

- Integrar envio pela Evolution API.
- Implementar tentativas de reenvio.
- Registrar falhas.
- Criar botões de pausa e envio manual.

### Fase 5 — Respostas e integração com vendas

- Detectar resposta do lead.
- Marcar como respondido.
- Enviar contexto para bot de vendas.
- Atualizar estágio do funil.

### Fase 6 — Dashboard e aprendizado

- Criar métricas por período.
- Criar filtros.
- Medir categoria, cidade, horário e modo.
- Criar relatório diário.
- Criar lógica de decisão automática baseada em resultados.

---

## 43. Pontos que precisam ser validados no projeto atual

Antes da implementação definitiva, será necessário analisar o projeto atual para entender:

- Quais tabelas já existem.
- Como os estágios do funil estão salvos hoje.
- Como o bot de vendas recebe contexto.
- Como a Evolution API está integrada.
- Como os jobs/workers estão estruturados.
- Como evitar múltiplos envios duplicados.
- Como os leads são identificados hoje.
- Como o dashboard atual está organizado.
- Se já existe lógica de agenda diária.
- Se já existe bloqueio por telefone.

---

## 44. Resumo final da definição

O Bot de Prospecção da PJ Codeworks será uma ferramenta inteligente de aquisição comercial, com três modos de operação, controle de horários, fila diária automática, geração personalizada de mensagens por IA, busca de leads no Google Maps e análise de performance por dashboard.

O sistema deve respeitar limites claros para evitar spam, impedir duplicidade, não abordar leads já em atendimento e priorizar resultados comerciais reais.

A IA terá autonomia no modo automático, mas sempre dentro das regras configuradas. Ela deverá aprender com os dados, identificar melhores nichos e cidades, justificar suas escolhas e ajudar a PJ Codeworks a direcionar a prospecção para onde existe maior chance de gerar reuniões, propostas e clientes fechados.

---

## 45. Definição resumida para desenvolvimento

**Nome:** Bot de Prospecção PJ Codeworks.

**Fluxo principal:** prospecção → primeira resposta → qualificação → reunião/proposta → atendimento humano.

**Limite inicial:** 80 mensagens por dia.

**Fila:** criada no começo do dia.

**Intervalo:** fixo.

**Fonte dos leads:** Google Maps/Google Places.

**Mensagem:** gerada por IA somente para leads agendados.

**Modos:** manual, semiautomático e automático.

**Duplicidade:** bloquear recontato por 60 dias.

**Resposta do lead:** transfere para bot de vendas.

**Métricas principais:** reuniões, clientes fechados e custo por oportunidade.

**Dashboard:** análise por período, categoria, cidade, estado, modo, estágio, resposta, proposta, reunião e fechamento.

**Relatório diário:** enviado de forma completa aos operadores.

**Autonomia da IA:** alta, mas limitada por regras operacionais configuradas.



---

# 46. Análise de implementação sem quebrar o sistema atual

Esta seção serve como ponte entre a documentação funcional desejada e o sistema atual do bot da PJ Codeworks.

A implementação não deve substituir o fluxo atual de vendas, follow-up, webhook, filas, estágios e integração com Evolution API de uma vez. A nova prospecção deve entrar como uma camada nova e controlada antes do fluxo comercial existente.

## 46.1. Princípio principal da implementação

A nova arquitetura deve seguir este princípio:

**O Bot de Prospecção gera oportunidades. O Bot de Vendas continua responsável por qualificar e conduzir a conversa depois da resposta do lead.**

Isso evita que a nova lógica de prospecção quebre o atendimento atual.

O fluxo correto será:

1. Prospecção pesquisa leads.
2. Prospecção cria fila diária.
3. Prospecção gera mensagem inicial.
4. Prospecção envia mensagem.
5. Lead responde.
6. Sistema marca como respondido.
7. Lead entra no fluxo atual do bot de vendas.
8. Bot de vendas assume diagnóstico, qualificação, proposta e reunião.

## 46.2. O que deve ser preservado do sistema atual

Antes de implementar a nova estrutura, estes blocos não devem ser apagados nem reescritos sem validação:

- Webhook de recebimento de mensagens.
- Deduplicação de mensagens recebidas.
- Pipeline atual de conversa.
- Classificador de estágio do funil.
- Bot de vendas.
- Regras de handoff humano.
- Follow-up automático.
- Jobs/workers existentes.
- Integração atual com Evolution API.
- Histórico de conversas.
- Estrutura atual de leads/conversas.
- Dashboard atual.
- Regras já existentes de estágio, temperatura e status.

A prospecção nova deve conversar com esses blocos, não substituí-los diretamente.

## 46.3. Áreas de maior risco

### 1. Risco de envio duplicado

Esse é o maior risco operacional.

A nova fila diária pode acabar enviando mensagem para leads que já receberam mensagem, já responderam, já estão em atendimento, já estão em follow-up, já foram marcados como perdidos, já viraram clientes ou já existem no banco com telefone em outro formato.

### Proteção necessária

Antes de qualquer envio, o sistema precisa consultar uma camada única de elegibilidade do lead.

Essa camada deve responder:

- pode prospectar este telefone agora?
- já existe conversa ativa?
- já respondeu antes?
- está bloqueado?
- foi prospectado nos últimos 60 dias?
- é cliente?
- está em atendimento humano?

A fila só pode agendar ou enviar se essa validação retornar positivo.

### 2. Risco de conflito com o bot de vendas

Quando o lead responder, o bot de prospecção não deve continuar agindo como se ainda fosse prospecção fria.

### Proteção necessária

A resposta do lead deve mudar a propriedade do fluxo:

**prospecção → vendas**

Depois disso, a conversa deve ser tratada pelo bot de vendas atual.

A prospecção deve parar de enviar novas mensagens para aquele lead.

### 3. Risco de conflito com follow-up automático

Se o lead respondeu e entrou no fluxo de vendas, o follow-up atual pode começar a agir.

Isso é correto, mas precisa ser controlado para evitar sobreposição entre follow-up comercial, nova prospecção, mensagem de abertura e resposta automática do bot de vendas.

### Proteção necessária

A prospecção deve criar apenas a primeira abordagem.

Depois que o lead responde, quem controla reativação, follow-up e continuidade é o módulo atual de vendas/follow-up.

### 4. Risco na Evolution API

O sistema já tem envio via Evolution API e já houve sinais de falha temporária, como erro HTTP 500 ou conexão fechada.

### Proteção necessária

A nova fila não deve marcar mensagem como enviada antes de confirmação real do envio.

Fluxo correto:

1. status = agendado;
2. worker pega item no horário;
3. status = enviando;
4. chama Evolution API;
5. se sucesso, status = enviado;
6. se falha, status = falhou ou pendente_retry;
7. tentar no máximo 2 vezes;
8. depois disso registrar erro e alertar no dashboard.

### 5. Risco de IA gerar mensagem sem necessidade

A documentação definiu que a mensagem só deve ser gerada se o lead estiver realmente agendado.

### Proteção necessária

Não gerar mensagem na etapa de busca.

A ordem correta é:

1. buscar lead;
2. validar elegibilidade;
3. calcular slot;
4. agendar lead;
5. gerar mensagem;
6. salvar mensagem na fila;
7. enviar no horário.

## 46.4. Arquitetura recomendada para não quebrar o atual

A implementação deve ser feita com módulos novos e pontos de integração pequenos.

### Módulos novos sugeridos

- prospecting-settings.service
- prospecting-daily-run.service
- prospecting-lead-search.service
- prospecting-eligibility.service
- prospecting-scheduler.service
- prospecting-message-generator.service
- prospecting-sender-worker.service
- prospecting-analytics.service
- prospecting-report.service

### Módulos atuais que devem ser reaproveitados

- envio via WhatsApp/Evolution API;
- banco PostgreSQL;
- worker/job system;
- webhook de respostas;
- pipeline do bot de vendas;
- classificação de estágio;
- dashboard atual, quando fizer sentido;
- histórico de conversas.

### Regra de ouro

Não colocar toda a lógica nova dentro do webhook ou dentro do agente de vendas.

A prospecção deve ser um domínio separado.

## 46.5. Modelo de integração com o fluxo atual

### Antes da resposta do lead

O lead fica sob domínio da prospecção.

Status possíveis:

- novo;
- encontrado;
- elegivel;
- aguardando_agendamento;
- agendado;
- enviando;
- enviado;
- falhou;
- sem_resposta.

### Depois da resposta do lead

O lead passa para o domínio de vendas.

Status possíveis:

- respondeu;
- interesse_claro;
- diagnostico;
- proposta;
- reuniao;
- fechado;
- perdido;
- bloqueado.

### Evento de transição

A transição deve acontecer através de um evento claro, por exemplo:

**lead_replied_from_prospecting**

Esse evento deve carregar:

- lead_id;
- telefone;
- nome;
- categoria;
- cidade;
- mensagem inicial enviada;
- resposta recebida;
- score;
- modo de origem;
- daily_run_id;
- data/hora.

## 46.6. Camada de elegibilidade obrigatória

Antes de agendar ou enviar qualquer mensagem, o sistema deve chamar uma função central.

### Função conceitual

`canProspectLead(phone, leadId)`

### Essa função deve verificar

- Telefone válido.
- Telefone normalizado.
- Não está em blocklist.
- Não é cliente fechado.
- Não está em atendimento.
- Não respondeu anteriormente.
- Não recebeu prospecção nos últimos 60 dias.
- Não existe envio pendente para o mesmo telefone.
- Não existe conversa ativa para o mesmo telefone.

### Resultado esperado

A função deve retornar:

- allowed: true/false;
- reason: motivo;
- existing_lead_id, se existir;
- current_stage, se existir;
- last_contact_at, se existir.

Isso evita duplicidade e facilita auditoria no dashboard.

## 46.7. Implementação segura por fases

### Fase 0 — Auditoria do sistema atual

Antes de criar qualquer lógica nova, mapear:

- tabelas atuais de leads;
- tabelas atuais de conversas;
- tabelas de mensagens;
- jobs existentes;
- worker de envio;
- integração com Evolution API;
- webhook de entrada;
- classificação de estágio;
- follow-up automático;
- funções de envio existentes;
- regras de deduplicação já existentes.

Resultado esperado da fase 0:

- mapa do que já existe;
- lista do que será reaproveitado;
- lista do que precisa ser criado;
- riscos de quebra.

### Fase 1 — Banco e configurações sem ativar envio

Criar as tabelas novas de prospecção, mas sem disparar mensagens reais.

Criar:

- configurações de prospecção;
- modos;
- horários;
- dias permitidos;
- limite diário;
- tags/categorias;
- regiões/cidades;
- daily_runs;
- queue.

Nesta fase, o sistema pode montar fila simulada, mas não envia.

Objetivo:

Validar se a agenda diária está sendo criada corretamente sem risco operacional.

### Fase 2 — Busca e deduplicação

Implementar busca no Google Maps/Places e salvar leads encontrados.

Nesta fase, o sistema deve:

- buscar leads;
- salvar leads;
- normalizar telefone;
- aplicar deduplicação;
- aplicar bloqueio de 60 dias;
- impedir leads já em atendimento;
- impedir clientes fechados;
- impedir telefone repetido.

Ainda não enviar mensagem real.

Objetivo:

Garantir que o sistema não cria fila com leads que não deveriam ser abordados.

### Fase 3 — Fila diária em modo simulação

Criar a fila diária completa no começo do dia, com slots reais, mas em modo simulado.

Nesta fase:

- calcular slots;
- respeitar horário;
- respeitar intervalo fixo;
- respeitar limite de 80 mensagens;
- jogar excedentes para aguardando agendamento;
- gerar status da fila;
- exibir na tela.

Não gerar mensagem ainda para todos os leads, a menos que esteja em ambiente de teste.

Objetivo:

Conferir se o agendamento está correto antes do envio real.

### Fase 4 — Geração de mensagens com IA

Gerar mensagens apenas para leads agendados.

Nesta fase:

- gerar mensagem personalizada;
- salvar no item da fila;
- permitir edição no modo manual;
- exibir aba Mensagens;
- validar qualidade da abordagem.

Ainda pode manter envio desativado em produção.

Objetivo:

Garantir que a IA está gerando mensagens diferentes por categoria, cidade e score.

### Fase 5 — Envio real controlado

Ativar envio real primeiro com limite baixo.

Sugestão de rollout:

- dia 1: 5 mensagens;
- dia 2: 10 mensagens;
- dia 3: 20 mensagens;
- depois liberar até 80 mensagens se não houver duplicidade, erro ou reclamação.

Objetivo:

Validar Evolution API, status de envio, retry e webhook de resposta sem comprometer o número principal.

### Fase 6 — Integração com bot de vendas

Quando o lead responder:

- marcar como respondeu;
- parar prospecção para aquele telefone;
- criar/atualizar conversa no fluxo atual;
- enviar contexto para bot de vendas;
- bot de vendas assume.

Objetivo:

Garantir transição limpa entre prospecção e atendimento comercial.

### Fase 7 — Dashboard e aprendizado automático

Com dados reais, ativar análises:

- taxa de resposta por categoria;
- taxa de resposta por cidade;
- avanço para diagnóstico;
- avanço para proposta;
- reuniões geradas;
- clientes fechados;
- custo por oportunidade;
- melhor horário;
- melhor combinação categoria + cidade.

Depois disso, evoluir o modo automático para decidir com base nesses dados.

## 46.8. O que não deve ser feito na primeira versão

Para reduzir risco, não implementar tudo de uma vez.

Evitar inicialmente:

- reescrever o bot de vendas;
- alterar profundamente o webhook;
- mexer no follow-up automático sem necessidade;
- apagar estágios existentes;
- substituir tabelas atuais de conversa;
- deixar IA decidir sem logs;
- enviar 80 mensagens no primeiro dia de produção;
- gerar mensagem para leads não agendados;
- marcar envio como sucesso antes da Evolution confirmar;
- criar múltiplos workers enviando da mesma fila sem lock.

## 46.9. Checklist técnico antes de ativar em produção

Antes de ativar o modo automático real, validar:

- Existe lock para impedir dois workers processarem o mesmo item?
- Existe idempotência no envio?
- Existe dedupe por telefone normalizado?
- Existe bloqueio de 60 dias?
- Existe verificação de conversa ativa?
- Existe verificação de cliente fechado?
- Existe status agendado/enviando/enviado/falhou/respondido?
- A mensagem só é gerada para lead agendado?
- O erro da Evolution não marca como enviado?
- O retry é limitado a 2 tentativas?
- O dashboard mostra falhas?
- O webhook reconhece resposta de lead prospectado?
- O bot de vendas recebe contexto suficiente?
- O follow-up não dispara junto com a prospecção inicial?
- O modo manual realmente interrompe novas decisões automáticas?
- Excluir lead da fila recalcula corretamente?

## 46.10. Estratégia recomendada de implementação

A forma mais segura de implementar é tratar a nova prospecção como um módulo paralelo, conectado ao sistema atual por eventos.

### Não recomendado

Colocar a lógica nova diretamente dentro do bot de vendas atual.

### Recomendado

Criar um módulo de prospecção com:

- configurações próprias;
- fila própria;
- histórico próprio;
- analytics próprios;
- conexão controlada com vendas apenas quando o lead responder.

Isso reduz risco de quebrar o que já funciona hoje.

## 46.11. Resumo da decisão técnica

A documentação desejada pode ser implementada no sistema atual, mas precisa ser feita por etapas.

O maior cuidado será preservar o fluxo de vendas, follow-up, webhook e envio existente.

A nova prospecção deve entrar como uma camada anterior ao comercial, com fila própria, regras fortes de elegibilidade, logs claros, envio idempotente e transição controlada para o bot de vendas quando houver resposta.

A implementação ideal não é trocar o sistema atual, mas evoluir ele com segurança.



---

# 47. Plano de implementação em etapas

Esta seção transforma a documentação funcional e a auditoria do sistema atual em um plano prático de implementação.

O objetivo é evoluir o módulo de prospecção sem quebrar o que já existe hoje: webhook, bot de vendas, follow-up, jobs, dashboard, integração com Evolution API e histórico de conversas.

## 47.1. Estratégia geral

A implementação deve seguir três princípios:

1. **Não reescrever o sistema atual de vendas.**
2. **Evoluir a prospecção existente em `src/prospecting.js`.**
3. **Usar a `vendas.job_queue` com cuidado, mantendo locks, idempotência e status claros.**

O sistema já possui estruturas importantes que devem ser reaproveitadas:

- `src/prospecting.js`, que já busca Places, cria prospects, gera diagnóstico, aprova/rejeita e dispara WhatsApp.
- `prospectador.prospects`, `diagnosticos`, `prospect_events`, `send_attempts`, `contato_politicas`, `nichos_performantes` e `auto_prospeccao_config`.
- `vendas.job_queue`, que já processa `webhook_resposta`, `followup_auto`, `agenda_lembrete_reuniao` e jobs `prospeccao_*`.
- `src/webhook-handler.js`, que já salva histórico, cancela follow-ups pendentes e marca prospect como respondido quando aplicável.
- `src/whatsapp.js`, que já centraliza envio via Evolution API.

A nova implementação não deve criar outro sistema paralelo de WhatsApp, webhook ou worker. Ela deve criar uma camada mais organizada de agenda diária, regras, tela e IA em cima da base atual.

---

## 47.2. Ordem correta de implementação

A ordem recomendada é:

1. Congelar e proteger o que já funciona.
2. Ajustar banco e migrations.
3. Criar configuração nova de prospecção.
4. Criar motor de elegibilidade.
5. Criar agenda diária em modo simulação.
6. Integrar busca do Google Maps/Places com a nova agenda.
7. Gerar mensagens apenas para leads agendados.
8. Enviar com worker controlado.
9. Integrar resposta com bot de vendas.
10. Criar dashboard e relatório.
11. Ativar IA automática com aprendizado.

---

## 47.3. Etapa 1 — Proteção do sistema atual

### Objetivo

Garantir que a implementação nova não quebre webhook, vendas, follow-up e envio atual.

### Tarefas

- Criar branch específica para a feature.
- Mapear endpoints de prospecção atuais.
- Mapear jobs `prospeccao_*` atuais.
- Identificar todos os pontos onde `sendText` é chamado.
- Identificar todos os pontos onde `prospectador.prospects` é atualizado.
- Identificar todos os pontos onde `vendas.conversas` é atualizado.
- Identificar como o webhook marca prospect como respondido.
- Validar como o follow-up é cancelado quando o lead responde.

### Arquivos principais

- `src/prospecting.js`
- `src/agent.js`
- `src/webhook-handler.js`
- `src/whatsapp.js`
- `src/followup-auto.js`
- `src/followup-execution.js`
- `src/db.js`
- `sql/init.sql`

### Entrega da etapa

Um mapa técnico simples com:

- o que já existe;
- o que será reaproveitado;
- o que será alterado;
- o que não pode ser alterado agora.

### Critério de aceite

Nenhuma regra nova de envio deve estar ativa ainda.

---

## 47.4. Etapa 2 — Organizar banco e migrations

### Objetivo

Evitar bagunça entre `sql/init.sql` e migrations inline em `src/db.js`.

A auditoria mostrou que existe duplicação funcional entre o SQL principal e ajustes inline no `src/db.js`. Antes de criar novas tabelas, é importante definir onde a evolução do schema será feita.

### Tarefas

- Escolher uma estratégia única para novas migrations.
- Preferencialmente criar um arquivo novo de migration para a prospecção avançada.
- Não espalhar novas colunas em vários pontos sem controle.
- Garantir que a migration seja idempotente.

### Novas estruturas sugeridas

Se possível, preservar tabelas atuais e adicionar tabelas auxiliares:

- `prospectador.prospeccao_configuracoes`
- `prospectador.prospeccao_execucoes_diarias`
- `prospectador.prospeccao_fila_diaria`
- `prospectador.prospeccao_decisoes_ia`
- `prospectador.prospeccao_metricas_diarias`
- `prospectador.prospeccao_tags`
- `prospectador.prospeccao_regioes`
- `prospectador.prospeccao_bloqueios`

### Regra importante

Não substituir imediatamente `auto_prospeccao_config`. Primeiro, criar compatibilidade ou migração progressiva.

### Entrega da etapa

Migration segura com tabelas novas e índices essenciais.

### Índices essenciais

- telefone normalizado;
- data da execução;
- status da fila;
- horário agendado;
- categoria/tag;
- cidade/estado;
- lead/prospect id;
- daily_run id.

### Critério de aceite

O sistema sobe normalmente, as tabelas são criadas sem erro e nenhuma funcionalidade antiga deixa de funcionar.

---

## 47.5. Etapa 3 — Configuração da prospecção

### Objetivo

Criar a base de configuração dos modos manual, semiautomático e automático.

### Tarefas

Criar backend para salvar e ler:

- modo ativo;
- horário inicial;
- horário final;
- intervalo fixo;
- limite diário, inicialmente 80;
- dias permitidos da semana;
- cidade/estado/região;
- categoria/tag;
- raio, se aplicável;
- status ativo/inativo.

### Regras

- O modo manual deve impedir novas decisões automáticas.
- O modo semiautomático exige categoria escolhida.
- O modo automático pode escolher categoria e região.
- Nenhuma configuração deve disparar envio sozinha nesta etapa.

### Arquivos prováveis

- `src/prospecting.js`, se mantiver tudo em uma rota.
- Ou criar serviços separados, como:
  - `src/services/prospecting-settings.js`
  - `src/services/prospecting-tags.js`
  - `src/services/prospecting-regions.js`

### Entrega da etapa

APIs de configuração funcionando.

### Critério de aceite

O operador consegue salvar configurações e recarregar a página sem perder os dados.

---

## 47.6. Etapa 4 — Motor de elegibilidade

### Objetivo

Criar a trava central que decide se um lead pode ou não ser prospectado.

Esta é uma das etapas mais importantes para evitar mensagens duplicadas.

### Função principal

`canProspectLead(phone, options)`

### Verificações obrigatórias

- Telefone existe.
- Telefone é válido.
- Telefone foi normalizado.
- Não é grupo.
- Não é broadcast.
- Não está bloqueado.
- Não é cliente fechado.
- Não respondeu anteriormente.
- Não está em atendimento.
- Não está em conversa ativa.
- Não recebeu prospecção nos últimos 60 dias.
- Não existe envio agendado para o mesmo telefone.
- Não existe job pendente de prospecção para o mesmo telefone.

### Deve consultar

- `prospectador.prospects`
- `vendas.conversas`
- `prospectador.send_attempts`
- `prospectador.contato_politicas`
- nova tabela de bloqueios, se criada
- `vendas.job_queue`, se necessário

### Retorno esperado

```ts
{
  allowed: boolean,
  reason: string,
  normalizedPhone: string,
  existingProspectId?: string,
  existingConversationId?: string,
  currentStage?: string,
  lastContactAt?: string
}
```

### Entrega da etapa

Serviço de elegibilidade + testes básicos com telefones simulados.

### Critério de aceite

O sistema bloqueia corretamente:

- telefone repetido;
- lead já respondido;
- lead com conversa ativa;
- lead prospectado há menos de 60 dias;
- lead bloqueado;
- cliente fechado.

---

## 47.7. Etapa 5 — Agenda diária em modo simulação

### Objetivo

Criar a fila diária no começo do dia, mas sem enviar mensagem real.

### Tarefas

- Criar função para gerar slots de horário.
- Respeitar horário inicial e final.
- Respeitar intervalo fixo.
- Respeitar dias permitidos.
- Respeitar limite diário de 80 mensagens.
- Criar execução diária.
- Preencher fila com status simulado.
- Marcar excedentes como `aguardando_agendamento`.

### Status sugeridos da fila

- `aguardando_agendamento`
- `agendado`
- `simulado`
- `cancelado`
- `falhou`
- `enviado`
- `respondido`

### Regra importante

Nesta etapa, não gerar mensagem de IA ainda e não enviar WhatsApp.

### Arquivos prováveis

- `src/services/prospecting-scheduler.js`
- `src/services/prospecting-daily-run.js`
- `src/prospecting.js`

### Entrega da etapa

Fila do dia criada corretamente em modo simulado.

### Critério de aceite

Com configuração das 08:00 às 17:00 e intervalo de 15 minutos, o sistema cria os slots corretos e não passa do limite permitido.

---

## 47.8. Etapa 6 — Integração com Google Maps/Places

### Objetivo

Usar a busca atual de Places dentro da nova lógica de agenda diária.

O sistema já possui busca Places em `src/prospecting.js`, então a primeira opção deve ser reaproveitar essa implementação em vez de criar uma nova do zero.

### Tarefas

- Isolar a função de busca atual, se ainda estiver misturada com envio.
- Permitir busca por tag/categoria.
- Permitir busca por cidade/estado/região.
- Salvar leads encontrados.
- Aplicar score inicial.
- Aplicar elegibilidade antes de entrar na fila.
- Não gerar mensagem para leads não agendados.

### Entrega da etapa

Ao iniciar uma execução diária, o sistema busca leads, filtra e preenche a fila simulada.

### Critério de aceite

Nenhum lead inelegível entra na fila.

---

## 47.9. Etapa 7 — Geração de mensagens com IA

### Objetivo

Gerar mensagens personalizadas apenas para leads realmente agendados.

### Tarefas

- Criar função `generateProspectingMessage(lead, context)`.
- Usar score, categoria, cidade e dados do Maps.
- Salvar mensagem no item da fila.
- Permitir edição no modo manual.
- Bloquear geração em massa para leads não agendados.

### Regras

- Mensagem não deve ser template fixo.
- Mensagem deve ser curta e consultiva.
- Mensagem deve variar por nicho.
- Mensagem deve ter tom de primeira abordagem, não proposta direta.
- Mensagem deve respeitar a comunicação da PJ Codeworks.

### Entrega da etapa

Fila diária com mensagens geradas para cada lead agendado.

### Critério de aceite

Cada mensagem precisa estar vinculada a um lead, a um slot e a uma execução diária.

---

## 47.10. Etapa 8 — Worker de envio controlado

### Objetivo

Enviar mensagens agendadas usando o worker atual, sem duplicar processamento.

A auditoria mostrou que o `iniciarJobWorker()` em `src/agent.js` já usa `FOR UPDATE SKIP LOCKED` e já processa jobs `prospeccao_*`. A implementação deve aproveitar esse padrão.

### Tarefas

- Criar ou ajustar job `prospeccao_envio_agendado`.
- Garantir idempotência por item da fila.
- Validar elegibilidade novamente imediatamente antes do envio.
- Marcar status como `enviando` antes de chamar Evolution.
- Chamar `sendText` de `src/whatsapp.js`.
- Tratar HTTP 200 com `success:false` como falha.
- Registrar tentativa em `send_attempts`.
- Tentar no máximo 2 vezes.
- Marcar como `falhou` se exceder tentativas.
- Marcar como `enviado` apenas após confirmação real.

### Fluxo do envio

1. Worker pega job.
2. Carrega item da fila.
3. Confere se ainda está agendado.
4. Confere horário.
5. Revalida elegibilidade.
6. Marca como enviando.
7. Envia via Evolution.
8. Registra tentativa.
9. Atualiza status.
10. Gera evento.

### Entrega da etapa

Envio real funcionando com limite baixo.

### Critério de aceite

Uma mensagem nunca pode ser enviada duas vezes pelo mesmo item de fila, mesmo se houver retry, restart ou múltiplos workers.

---

## 47.11. Etapa 9 — Integração com resposta do lead

### Objetivo

Quando o lead responder, ele deve sair da prospecção e entrar no bot de vendas.

A auditoria mostrou que o webhook já salva histórico em `vendas.conversas`, cancela follow-ups pendentes, marca prospect como respondeu quando aplicável e enfileira `webhook_resposta` em `vendas.job_queue`.

### Tarefas

- Ajustar a marcação de prospect respondido para também atualizar a nova fila diária.
- Atualizar item da fila para `respondido`.
- Registrar evento `lead_replied_from_prospecting`.
- Enviar contexto da prospecção para o fluxo de vendas.
- Garantir que a prospecção pare para aquele telefone.
- Garantir que o bot de vendas assuma.

### Contexto enviado para vendas

- Nome do lead.
- Telefone.
- Categoria/tag.
- Cidade/estado.
- Mensagem inicial enviada.
- Resposta recebida.
- Score.
- Modo de origem.
- Execução diária.
- Origem Google Maps.

### Entrega da etapa

Lead respondido aparece corretamente no fluxo comercial atual.

### Critério de aceite

Depois da resposta, a prospecção não envia mais nada para aquele número.

---

## 47.12. Etapa 10 — Interface em abas

### Objetivo

Criar a experiência visual da nova prospecção sem confundir com o dashboard atual.

### Abas

- Configuração.
- Fila do Dia.
- Pesquisa da IA.
- Mensagens.
- Resultados.
- Dashboard.
- Histórico.
- Bloqueios.

### Tarefas

- Criar tela ou atualizar tela atual de prospecção.
- Mostrar modo ativo.
- Mostrar status do dia.
- Mostrar nicho/categoria.
- Mostrar cidade/estado.
- Mostrar leads encontrados.
- Mostrar mensagens agendadas.
- Mostrar próximo envio.
- Mostrar motivo da IA.
- Mostrar erros/falhas.
- Permitir exclusão de lead da fila.
- Permitir forçar envio manual.
- Permitir pausar prospecção do dia.

### Entrega da etapa

Operador consegue entender o que o bot está fazendo sem olhar o banco.

### Critério de aceite

A tela responde claramente:

- o que está sendo pesquisado;
- por que foi escolhido;
- quantos leads entraram;
- quantos serão enviados;
- qual é o próximo envio;
- quais falharam;
- quais responderam.

---

## 47.13. Etapa 11 — Relatório diário

### Objetivo

Gerar resumo completo ao final do dia para operadores.

### Tarefas

- Criar job de fechamento diário.
- Consolidar execução diária.
- Calcular mensagens enviadas.
- Calcular respostas.
- Calcular falhas.
- Calcular taxa de resposta.
- Listar categoria e cidade.
- Listar avanços para diagnóstico, proposta e reunião.
- Enviar relatório aos operadores.

### Entrega da etapa

Relatório diário disponível na tela e enviado via WhatsApp para operadores.

### Critério de aceite

O relatório não pode contar envio falho como envio bem-sucedido.

---

## 47.14. Etapa 12 — Dashboard estratégico

### Objetivo

Criar visão analítica para tomada de decisão.

### Filtros

- Período.
- Categoria.
- Cidade.
- Estado.
- Modo usado.
- Status/funil.
- Mensagens enviadas.
- Respostas recebidas.
- Taxa de resposta.
- Diagnóstico.
- Proposta.
- Reunião.
- Fechamento.

### Métricas principais

- Reuniões geradas.
- Clientes fechados.
- Custo por oportunidade.

### Entrega da etapa

Dashboard mostrando performance por nicho, cidade, horário e estágio.

### Critério de aceite

O operador consegue identificar quais nichos e cidades estão performando melhor.

---

## 47.15. Etapa 13 — IA automática com aprendizado

### Objetivo

Ativar a IA para escolher nicho, cidade e estratégia com base em histórico.

Esta etapa só deve entrar depois que houver dados confiáveis no dashboard.

### Tarefas

- Criar score por categoria.
- Criar score por cidade.
- Criar score por combinação categoria + cidade.
- Considerar taxa de resposta.
- Considerar avanço no funil.
- Considerar reuniões.
- Considerar fechamentos.
- Considerar ticket provável.
- Considerar necessidade provável de solução digital.
- Misturar exploração e histórico.
- Registrar motivo da escolha.

### Entrega da etapa

Modo automático decide o que pesquisar no dia e justifica a decisão.

### Critério de aceite

Toda decisão automática precisa gerar log explicável.

Exemplo:

“A IA escolheu clínicas em Santo André porque essa combinação teve boa taxa de resposta, avanço para diagnóstico e quantidade alta de leads sem site profissional.”

---

## 47.16. Etapa 14 — Rollout de produção

### Objetivo

Liberar com segurança.

### Sugestão de ativação

- Dia 1: modo simulação.
- Dia 2: 5 envios reais.
- Dia 3: 10 envios reais.
- Dia 4: 20 envios reais.
- Dia 5: 40 envios reais.
- Depois liberar até 80 se não houver falhas críticas.

### Monitorar

- mensagens duplicadas;
- falhas Evolution;
- leads respondendo;
- bot de vendas assumindo;
- follow-up não conflitando;
- fila respeitando horário;
- mensagens não sendo geradas para leads excedentes;
- dashboard batendo com os eventos reais.

### Critério de aceite

O sistema roda por pelo menos alguns dias sem duplicidade, sem conflito com bot de vendas e com registros consistentes.

---

## 47.17. Ordem prática para pedir implementação à IA de código

A melhor forma de pedir para o Claude/Cursor implementar é dividir em pequenos blocos.

### Prompt 1 — Levantamento final antes do código

“Analise `src/prospecting.js`, `src/agent.js`, `src/webhook-handler.js`, `src/whatsapp.js`, `sql/init.sql` e `src/db.js`. Identifique exatamente onde a prospecção atual busca leads, agenda jobs, envia mensagens, registra tentativas e marca resposta. Não altere nada ainda. Retorne um mapa dos pontos de alteração mínimos para implementar agenda diária com segurança.”

### Prompt 2 — Migration

“Crie uma migration idempotente para adicionar as tabelas auxiliares da nova prospecção diária, sem remover ou substituir as tabelas atuais. Preserve `prospectador.prospects`, `send_attempts`, `contato_politicas`, `nichos_performantes` e `auto_prospeccao_config`. Inclua índices para telefone normalizado, status, data, horário agendado e daily_run_id.”

### Prompt 3 — Elegibilidade

“Implemente um serviço central `canProspectLead` que normalize telefone e bloqueie leads já respondidos, em atendimento, clientes, bloqueados, prospectados nos últimos 60 dias ou com envio pendente. Integre esse serviço sem alterar o fluxo de vendas atual.”

### Prompt 4 — Agenda diária simulada

“Implemente a criação de fila diária em modo simulação. A fila deve respeitar horário inicial/final, intervalo fixo, dias permitidos e limite diário. Não envie WhatsApp e não gere mensagem de IA nesta etapa.”

### Prompt 5 — Busca Places integrada

“Integre a busca atual de Places ao novo fluxo de fila diária, reaproveitando `src/prospecting.js`. Busque leads por categoria/tag e cidade/região, aplique elegibilidade e preencha a fila simulada.”

### Prompt 6 — Mensagem IA

“Implemente geração de mensagem de IA apenas para leads com status agendado. A mensagem deve usar categoria, cidade, score e dados do lead. No modo manual, permitir edição antes do envio.”

### Prompt 7 — Envio real controlado

“Implemente o processamento de `prospeccao_envio_agendado` usando o worker atual e `sendText` de `src/whatsapp.js`. Garanta idempotência, status enviando/enviado/falhou, retry máximo de 2 tentativas e tratamento de HTTP 200 com `success:false` como falha.”

### Prompt 8 — Resposta do lead

“Ajuste o webhook para, quando um prospect da nova fila responder, marcar o item como respondido, registrar evento, cancelar prospecção futura daquele telefone e encaminhar contexto para o fluxo atual de vendas sem alterar o bot de vendas.”

### Prompt 9 — Interface

“Crie/ajuste a tela de prospecção com abas: Configuração, Fila do Dia, Pesquisa da IA, Mensagens, Resultados, Dashboard, Histórico e Bloqueios. A tela deve mostrar modo ativo, nicho, cidade, leads encontrados, mensagens agendadas, próximo envio, motivo da IA e status atual.”

### Prompt 10 — Dashboard e relatório

“Implemente métricas e relatório diário com mensagens enviadas, falhas, respostas, taxa de resposta, categoria, cidade, diagnóstico, proposta, reunião e clientes fechados. Envie o resumo aos operadores e exiba na plataforma.”

---

## 47.18. Versão mínima viável recomendada

A primeira versão funcional não precisa ter tudo.

### MVP seguro

- Configuração de horário, dias, limite e modo.
- Tags/categorias.
- Cidade/estado configuráveis.
- Elegibilidade com bloqueio de 60 dias.
- Fila diária simulada.
- Busca Places reaproveitada.
- Geração de mensagem para agendados.
- Envio real com limite baixo.
- Marcação de respondido.
- Passagem para bot de vendas.
- Tela simples de fila e status.

### Deixar para depois

- IA escolhendo automaticamente com aprendizado avançado.
- Dashboard estratégico completo.
- Relatório sofisticado.
- Exploração automática de novos nichos.
- Score avançado por ticket e potencial.
- Otimização de horários.

---

## 47.19. Resumo final do plano de implementação

A implementação deve começar pelo que reduz risco: banco, configuração, elegibilidade e simulação.

Somente depois deve entrar geração de mensagem e envio real.

A IA automática deve ser a última etapa, porque ela depende de dados confiáveis.

A prioridade não é fazer o bot enviar mais rápido. A prioridade é garantir que ele envie certo, sem duplicar mensagens, sem conflitar com vendas, sem quebrar follow-up e sem perder rastreabilidade.

