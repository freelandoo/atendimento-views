# Workers de fundo

Este diretorio responde a pergunta operacional: **o que roda sozinho neste processo?**

- `index.js`: fachada publica usada pelo boot.
- `runtime.js`: politica de largada, falha e log.
- `registry.js`: junta os modulos e define a ordem de inicio.
- `modules/`: catalogos por area do produto.

Cada worker continua dono da sua propria regra no dominio original (`services/`, `agent.js` ou
`routes/`). O catalogo so declara nome, grupo, descricao, cadencia, risco e como iniciar.

## Regras

- Todo worker novo entra em `modules/`, nunca direto no boot.
- O `require` do service deve ficar dentro de `iniciar`, para manter importacao lazy.
- Worker essencial pode derrubar o boot. Worker nao essencial registra falha e deixa o processo
  subir degradado.
- Campo `risco` deve deixar claro se o worker envia WhatsApp, consome credito pago, usa IA ou
  apenas consulta/muta dados internos.

## Para organizar depois

Alguns processos de fundo ainda vivem dentro do motor principal porque sao ticks internos do
atendimento/prospeccao. Eles podem virar modulos proprios em outra etapa, desde que sem mudar
comportamento:

- ticks internos do `agent.js` que chamam rotinas auxiliares;
- monitoramento do pool em `db.js`;
- rotinas sob demanda que hoje sao chamadas por rotas mas podem ganhar agendamento formal.

Por enquanto, o catalogo cobre somente os workers iniciados pelo boot.
