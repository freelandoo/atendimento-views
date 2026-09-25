# Planejamento — Follow-ups, tentativas e avisos por instancia

Data: 2026-09-25
Status: planejamento, sem implementacao ainda.

## Objetivo

Deixar a ficha do lead mais rapida para operar follow-ups e preparar uma regra futura de limites por etapa, sem criar automacao silenciosa nem mudar o modelo atual de `app.follow_ups`.

## Pesquisa rapida de referencia

Consulta feita em 2026-09-25 sobre praticas de cadencia comercial em empresas B2B e CRMs/sales engagement.

Principios recorrentes encontrados:

- Cadencia boa mistura canais: mensagem/e-mail, ligacao e algum toque social quando fizer sentido.
- A quantidade depende do sinal do lead: sem resposta exige cadencia curta; proposta/reuniao permite persistencia maior.
- Follow-up depois de proposta deve sair com proximo passo combinado, nao apenas "viu minha proposta?".
- Operacao precisa de regra de parada: quando nao responde, arquiva/nutre em vez de insistir para sempre.
- A fila deve mostrar tarefa atual, prazo, dono e contexto; nao deixar lead parado em etapa concluida sem proximo passo.
- Medir por etapa: connect rate, reply rate, reunioes marcadas, propostas respondidas e pipeline criado.

Fontes consultadas:

- Apollo: cadencias B2B geralmente ficam em 6 a 12 toques por 2 a 4 semanas, com ajuste por segmento e sinal.
- Apollo: campanhas B2B costumam usar 3 a 6 follow-ups depois da primeira abordagem e misturar canais.
- HubSpot: sequencias devem combinar e-mail/mensagem, ligacao e tarefas, com parada automatica quando o prospect responde.
- Gong: proposta e reuniao precisam sair com proximo passo claro, nao com follow-up generico.
- SalesHive: cadencia operacional costuma intercalar canais em 8 a 12 toques ao longo de 2 a 3 semanas.
- Close: pipeline bom nao deixa lead preso para sempre; quando uma etapa termina, precisa de proximo follow-up, break-up ou nutricao.

## Regras pensadas ate agora

### Tentativas de ligacao

- Limite inicial: no maximo 3 tentativas de ligacao pelo canal WhatsApp/ligacao registrada.
- Cada tentativa precisa ser um evento real de contato, nao apenas abrir a ficha.
- Resultado precisa ficar audivel no historico: atendeu, nao atendeu, ocupado, caixa postal, numero invalido ou reagendou.
- Ao bater o limite, a tela deve sugerir outro caminho: follow-up escrito, descarte, proposta/reuniao quando ja houver contexto, ou revisao manual.

### Tentativas de follow-up

- Lead sem proposta marcada/enviada: no maximo 2 follow-ups.
- Lead com proposta marcada/enviada: no maximo 5 follow-ups.
- Lead que marcou reuniao depois da proposta: manter limite de 5 follow-ups apos a reuniao.
- Follow-up so deve contar quando for persistido em `app.follow_ups` ou finalizado como tentativa real.
- Reagendar o mesmo follow-up nao deve inflar a contagem sozinho; criar uma nova tentativa ou concluir/falhar deve contar.

## Estagios operacionais sugeridos

O limite deve depender do estagio comercial mais recente, sempre calculado no backend:

- Sem contato: pode registrar abordagem, ligacao ou primeiro follow-up.
- Contatado: permite follow-up, mas aplica limite curto se ainda nao existe proposta.
- Follow-up aberto: mostra o compromisso atual antes de sugerir outro.
- Proposta enviada: libera cadencia maior, com ate 5 follow-ups.
- Reuniao marcada ou realizada: libera cadencia maior, com ate 5 follow-ups posteriores.
- Fechado, descartado ou nao contatar: nao sugere nova tentativa.

## Opcoes prontas na ficha

Para reduzir digitacao, a ficha pode ter uma pre-selecao por estagio, em vez de sempre exigir texto livre:

- Retomar interesse.
- Confirmar recebimento da proposta.
- Tirar duvida sobre preco.
- Confirmar presenca na reuniao.
- Reagendar conversa.
- Ultima tentativa antes de arquivar.

Essas opcoes podem viver em um arquivo/configuracao de estagios, reaproveitando o vocabulario de `frontend/lib/follow-up-acao.js` para canal, prioridade e payload. A tela deve permitir editar o texto antes de salvar.

## Avisos gerais por instancia conectada

Ideia em aberto: quando houver uma instancia conectada, ela pode avisar o responsavel sobre compromissos e pendencias.

Primeira leitura mais segura:

- Aviso para o operador/responsavel, nao para o lead, ate existir configuracao explicita.
- Usar somente compromissos ja gravados: follow-ups vencidos/hoje, reunioes proximas e propostas sem retorno.
- Nao enviar aviso se a instancia estiver desconectada, inativa ou sem permissao clara.
- Ter configuracao de empresa antes de ligar: horario, destinatario, instancia, tipos de aviso e limite diario.
- Registrar auditoria do aviso, sem guardar conteudo sensivel desnecessario.

## Arquitetura futura proposta

- Regra pura: `backend/src/services/follow-up-limites.js`.
- Leitura de fatos: `app.follow_ups`, `app.auditoria_eventos`, `app.ligacoes` e agenda.
- Endpoint de preflight para a ficha: retorna limite, tentativas usadas, opcoes sugeridas e motivo quando bloquear.
- A criacao do follow-up continua pela entidade oficial `app.follow_ups`.
- Qualquer worker de aviso deve ser idempotente, escopado por empresa e com opt-in explicito.

## Fora de escopo por enquanto

- Envio automatico de mensagem ao lead.
- Worker de aviso geral.
- Mudanca de schema ou migration.
- Bloqueio duro sem antes mostrar a regra para o operador.
- Nova central/tela separada.

## Perguntas para fechar antes de implementar

- "Tentativa de ligacao feita por WhatsApp" conta como chamada registrada, mensagem enviada, ou ambos?
- O aviso por instancia deve ir para o operador/responsavel, para o dono da empresa, ou para o lead?
- O limite de 5 apos reuniao conta a partir da reuniao marcada ou apenas depois da reuniao realizada?
- Proposta enviada manualmente e proposta registrada na ficha devem ter o mesmo peso?
- Ao bater limite, a acao deve bloquear de verdade ou apenas pedir justificativa?

## Proposta A — nossa regra simples

Esta e a regra mais direta para implementar primeiro.

### Limites

- Ate 3 tentativas de ligacao.
- Ate 2 follow-ups antes de proposta.
- Ate 5 follow-ups depois de proposta.
- Ate 5 follow-ups depois de reuniao marcada/realizada.

### Comportamento na ficha

- A ficha mostra um contador simples: "1/2 follow-ups antes da proposta" ou "3/5 follow-ups apos proposta".
- Ao bater limite, o botao continua visivel, mas pede justificativa para criar outro follow-up.
- Opcoes prontas por estagio reduzem digitacao.

### Vantagem

Rapida, clara e facil de explicar para o time.

### Risco

Pode ser rigida demais: um lead quente sem proposta ainda pode merecer mais de 2 contatos, enquanto um lead frio com proposta talvez nao mereca 5.

## Proposta B — cadencia por sinal comercial

Esta alternativa segue melhor o padrao de operacoes comerciais estruturadas: limite por estagio + nivel de sinal.

### Estagios e teto sugerido

| Estagio | Teto | Ritmo sugerido | Saida quando nao responde |
| --- | ---: | --- | --- |
| Sem contato / contatado frio | 2 follow-ups + 3 ligacoes | D0, D2, D5 | arquivar ou nutrir |
| Respondeu / demonstrou interesse | 3 follow-ups + 3 ligacoes | D0, D1, D4, D8 | pedir decisao ou reagendar |
| Proposta enviada | 5 follow-ups | D0, D1, D3, D7, D14 | break-up educado ou nutricao |
| Reuniao marcada | 5 follow-ups/lembretes operacionais | antes, no dia, depois, D3, D7 | reagendar ou marcar no-show |
| Reuniao realizada sem venda | 5 follow-ups | D0, D2, D5, D10, D21 | nova proposta, nutricao ou descarte |

### Sinais que aumentam a cadencia

- Lead respondeu recentemente.
- Proposta registrada.
- Reuniao marcada ou realizada.
- Abriu conversa com duvida concreta.
- Pediu retorno em outra data.

### Sinais que reduzem ou param

- Numero invalido.
- Nao contatar.
- Sem resposta apos cadencia completa.
- Desalinhamento claro de perfil.
- Follow-up vencido ha muito tempo sem acao do operador.

### Comportamento na ficha

- A ficha mostra o "plano recomendado" em vez de apenas campo livre.
- Exemplos: "Retomar proposta", "Confirmar reuniao", "Ultima tentativa", "Nutrir depois".
- O operador pode editar, mas a opcao padrao ja vem pronta.
- Ao bater limite, a tela sugere o proximo estado: nutrir, descartar, reagendar ou pedir aprovacao para excecao.

### Vantagem

Mais inteligente comercialmente e evita insistencia igual para lead frio e lead quente.

### Risco

Exige uma primeira camada de regra/contagem no backend e um pouco mais de UX para explicar por que a ficha sugeriu aquele limite.

## Recomendacao

Implementar em duas fases:

1. **Fase 1:** Proposta A, com contador e opcoes prontas, sem bloqueio duro.
2. **Fase 2:** Evoluir para a Proposta B, usando sinais comerciais e sugestoes por estagio.

Assim o produto ganha disciplina agora, mas nao trava a operacao enquanto a cadencia real ainda esta sendo calibrada.
