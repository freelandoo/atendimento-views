# Plano de ICP e Qualidade Comercial de Leads

Data: 2026-09-16

## Objetivo

Separar claramente tres leituras que hoje aparecem proximas demais na operacao:

1. **Cadastro**: completude e qualidade dos dados coletados automaticamente.
2. **ICP**: aderencia ao perfil de cliente ideal, validada por humano com sinais objetivos.
3. **Chance de venda**: prioridade operacional para agir agora, usando ICP, sinais comerciais e resultado real.

A meta e impedir que o operador leia "cadastro completo" como "lead bom" ou "cadastro fraco"
como "lead ruim". No modelo Tenka atual, um cadastro fraco pode ser justamente a oportunidade,
desde que o negocio tenha maturidade, ticket, lacuna digital e acesso ao decisor.

## Referencia de negocio

O ICP Tenka v1.1 define a hipotese atual como:

- PME validada e em crescimento.
- Cliente ou contrato com valor relevante.
- Preocupacao com imagem e percepcao de valor.
- Predisposicao a investir em marketing, tecnologia, IA, site, trafego ou conteudo.
- Lacuna clara na presenca digital.
- Dono ou decisor identificavel e acessivel com pouca burocracia.

A ficha rapida do ICP soma ate 13 pontos:

| Criterio | Pontos | Natureza |
| --- | ---: | --- |
| Operacao validada | +1 | Humana com apoio automatico |
| Instagram ativo | +1 | Automatico com confirmacao humana |
| Preocupacao com imagem | +1 | Humana |
| Ja investiu em marketing/tecnologia | +2 | Humana com evidencias |
| Esta em crescimento | +2 | Humana |
| Cliente/contrato de valor relevante | +2 | Humana |
| Lacuna digital clara | +2 | Automatico + humana |
| Acesso facil ao decisor | +2 | Humana |

Faixas iniciais:

- **Lead A**: 10 a 13 pontos. Vale personalizacao forte e, quando fizer sentido, mockup.
- **Lead B**: 6 a 9 pontos. Vale abordagem com personalizacao leve.
- **Lead C**: 0 a 5 pontos. Baixa prioridade ou descarte.

## Estado atual analisado

### Aquisicao

Arquivo principal: `frontend/app/dashboard/aquisicao/page.tsx`.

A pagina reune Google Places e Instagram. Ela nao decide qualidade sozinha; delega para:

- `frontend/app/dashboard/prospeccao/page.tsx`
- `frontend/app/dashboard/captacao/page.tsx`
- `frontend/components/AssistenteOportunidades.tsx`

O Assistente de Oportunidades ja tem a mecanica mais proxima do que precisamos:

- Abre uma sessao de curadoria.
- Mostra um lead por vez.
- Explica por que aquele lead parece oportunidade.
- Registra `aprovado` ou `descartado`.
- Aprende com decisoes anteriores por empresa.

Problema atual: a decisao humana e binaria. Ela nao registra por qual ICP o lead foi aprovado,
nem quais sinais explicaram a decisao.

### Banco de Leads

Arquivo principal: `frontend/app/dashboard/banco-leads/page.tsx`.

O Banco de Leads ja separa:

- `score_cadastro`: completude do cadastro.
- `qualificacao`: porta comercial, aprovada/pendente/descartada/legado.
- `faixa_trabalho`: ordem operacional da fila, calculada no backend.
- `responsavel_id`: dono do lead.
- status operacional: sem contato, conversou, fecharam, descartados, agendados.

O backend ja monta a ordem de trabalho em `backend/src/services/lead-fila-trabalho.js`.
Isso e correto e deve ser preservado.

Problema atual: nao existe uma leitura explicita de ICP/qualidade comercial na linha. A coluna
"Cadastro" e neutra de proposito e nao deve virar chance de venda.

### Detalhes do Lead

Arquivo principal: `frontend/components/LeadDetalhesModal.tsx`.

Hoje mostra:

- Pontuacao de cadastro.
- Criterios da completude.
- Presenca digital.
- Dados complementares.
- Mensagem gerada.
- JSON/prompt de apresentacao.

Problema atual: e o melhor lugar para mostrar a ficha ICP completa, mas ainda nao existe essa
aba/bloco.

### Central de Ligacoes

Arquivos principais:

- `frontend/app/dashboard/central-ligacoes/page.tsx`
- `backend/src/services/ligacao-prioridade.js`
- `backend/src/db/campanhas.js`

Hoje a Central de Ligacoes:

- So trabalha leads aprovados pela porta estrita (`qualificacao = 'aprovado'`).
- Exige telefone discavel.
- Ordena por prioridade comercial da campanha, nao por cadastro.
- Explica a prioridade por motivos.

Problema atual: a prioridade comercial ainda e muito voltada para campanha de criacao de site
e nao sabe se o lead passou bem no ICP humano.

### Conversas

Arquivos principais:

- `frontend/components/ConversaPainel.tsx`
- `backend/src/routes/api-conversas.js`
- `backend/src/services/lead-interest-score.js`

Hoje Conversas calcula:

- Interesse comercial baseado nas mensagens do lead.
- Fit do lead (`score_lead`) vindo de perfil/conversa.
- Temperatura.

Problema atual: o fit da conversa nao esta conectado de forma clara com o ICP aprovado na
Aquisicao/Banco de Leads.

### Follow-ups

Arquivos principais:

- `frontend/app/dashboard/follow-ups/page.tsx`
- `backend/src/services/followup-call-score.js`
- `backend/src/services/followup-listing.js`

Hoje Follow-ups calcula prioridade por comportamento pos-contato:

- Pediu preco e sumiu.
- Proposta/negociacao parada.
- Follow-ups ignorados.
- Reuniao pendente.
- `score_lead`.

Problema atual: ICP pode entrar como contexto, mas nao deve dominar a fila de follow-up. Depois
que o lead conversa, comportamento real vale mais que hipotese.

## Arquitetura recomendada

### Principio central

Nao criar um "score geral". Criar indicadores semanticamente separados:

| Indicador | Pergunta | Dono | Cor |
| --- | --- | --- | --- |
| Cadastro | Quanto dos dados digitais esta preenchido? | Sistema | Neutra |
| ICP | Este lead parece o cliente certo para a Tenka? | Humano + sinais automaticos | Comercial |
| Prioridade | O que vale fazer agora? | Sistema, baseado em contexto | Comercial/operacional |

### Banco proposto

Nova migration futura, somente apos aprovacao:

1. `prospectador.icp_modelos`

   Guarda modelos de ICP por empresa, com versao.

   Campos sugeridos:

   - `id`
   - `empresa_id`
   - `nome`
   - `slug`
   - `versao`
   - `status`: `rascunho | ativo | arquivado`
   - `criterios_json`: lista de criterios, pesos, tipo e opcoes
   - `cortes_json`: faixas A/B/C
   - `criado_por`
   - `criado_em`
   - `atualizado_em`

2. `prospectador.lead_icp_avaliacoes`

   Historico append-only da avaliacao humana.

   Campos sugeridos:

   - `id`
   - `empresa_id`
   - `prospect_id`
   - `modelo_id`
   - `modelo_versao`
   - `score`
   - `faixa`: `A | B | C | fora`
   - `decisao`: `aprovado | descartado | revisar`
   - `respostas_json`: criterios marcados pelo operador
   - `sinais_auto_json`: sinais que o sistema preencheu/sugeriu
   - `observacao`
   - `avaliado_por`
   - `avaliado_em`

3. Snapshot em `prospectador.prospects`

   Para listagem rapida e filtros sem lateral pesado:

   - `icp_modelo_id`
   - `icp_score`
   - `icp_faixa`
   - `icp_avaliado_em`
   - `icp_avaliado_por`

O historico fica na tabela de avaliacoes; o snapshot e a leitura atual.

### Services propostos

1. `backend/src/services/icp-modelo.js`

   Dono do vocabulario e validacao de modelos:

   - validar criterio
   - validar cortes
   - normalizar respostas
   - calcular score a partir de respostas

2. `backend/src/services/lead-icp-score.js`

   Funcao pura que recebe lead + modelo + respostas:

   - preenche sinais automaticos seguros
   - calcula pontos
   - devolve faixa, motivos e pendencias

3. `backend/src/db/lead-icp.js`

   Acesso a dados:

   - buscar modelo ativo
   - salvar avaliacao em transacao
   - atualizar snapshot do prospect
   - listar historico do lead

4. Integracao com curadoria atual

   A decisao do Assistente de Oportunidades deve salvar:

   - avaliacao ICP
   - `prospects.qualificacao`
   - `curadoria_decisoes`
   - auditoria

   Tudo na mesma transacao quando o operador confirma.

## Fluxo ponta a ponta recomendado

### 1. Coleta

Google Places/Instagram coletam leads normalmente.

O sistema calcula:

- `score_cadastro`
- situacao do site
- avaliacoes/nota
- telefone/email
- sinais automaticos candidatos para o ICP

Nenhum lead entra automaticamente como Lead A.

### 2. Triagem ICP

No Assistente de Oportunidades, o card deixa de ser apenas aprovar/descartar.

Passa a ter:

- Resumo do lead.
- Bloco **Cadastro**: dados coletados.
- Bloco **ICP Tenka v1.1**: checklist com pontos.
- Bloco **Decisao**: Lead A, Lead B, Lead C, Descartar, Revisar depois.

Campos automaticos sugeridos:

- Instagram ativo: quando houver perfil/bio/seguidores/conteudo coletado.
- Lacuna digital: sem site proprio, site nao identificado ou so rede social.
- Operacao validada: sugestao por avaliacoes, fotos, rating, estrutura visivel.

Campos humanos obrigatorios ou semi-obrigatorios:

- Ticket/cliente de valor relevante.
- Crescimento.
- Investimento previo em marketing/tecnologia.
- Preocupacao com imagem.
- Acesso ao decisor.

### 3. Aprovacao

Regra inicial:

- Lead A: aprova e marca como alta qualidade.
- Lead B: aprova, mas com prioridade normal.
- Lead C: pode aprovar com aviso ou mandar para revisar/descartar.
- Fora do ICP: descarta com motivo.

Ao aprovar:

- `qualificacao = 'aprovado'`
- snapshot ICP no prospect
- avaliacao historica
- curadoria_decisoes
- auditoria

### 4. Banco de Leads

Nova coluna recomendada: **Qualidade**.

Ela deve ficar proxima de Cadastro, mas nao dentro da mesma bolinha:

- Cadastro: bolinha neutra, "dados preenchidos".
- Qualidade: selo colorido, "Lead A/B/C".

Cores sugeridas:

- Lead A: verde/emerald, alta chance.
- Lead B: azul ou amber controlado, bom fit.
- Lead C: slate/amber, baixa prioridade.
- Sem ICP: cinza vazado, "Sem ICP".

Filtros novos:

- Qualidade: todos, Lead A, Lead B, Lead C, sem ICP.
- ICP avaliado por: todos, avaliados, pendentes.
- Ordenacao: maior qualidade primeiro.

Presets novos:

- "Alta chance de venda": Lead A + telefone + nao trabalhado.
- "Bom fit sem abordagem": Lead A/B + sem disparo.
- "Revisar ICP": sem ICP + com telefone + sem contato.
- "Mockup recomendado": Lead A + lacuna digital clara + acesso ao decisor.

### 5. Detalhes do Lead

Adicionar bloco/aba **ICP**:

- Score e faixa.
- Criterios marcados.
- Sinais automaticos que ajudaram.
- Quem avaliou e quando.
- Observacao.
- Botao "Reavaliar ICP" para quem tem capacidade de triagem.

### 6. Central de Ligacoes

Manter a porta atual: so entra aprovado.

Atualizar `ligacao-prioridade.js` para considerar ICP como sinal, sem substituir a campanha:

- Lead A: bonus forte.
- Lead B: bonus medio.
- Lead C: pouco ou nenhum bonus.
- Sem ICP: nao inventa prioridade alta.

Possivel peso inicial:

- Lead A: +25
- Lead B: +12
- Lead C: +0
- Fora/sem ICP: +0 ou fica fora, dependendo da decisao de produto.

A bolinha de prioridade continua respondendo:

"Quanto vale ligar para este negocio agora, nesta campanha."

O tooltip passa a incluir "Lead A no ICP Tenka" como fator quando houver.

### 7. Conversas

Mostrar o selo ICP no cabecalho da conversa, perto de "Fit do lead", mas com texto claro:

- ICP: Lead A/B/C
- Interesse: o que o lead demonstrou nas mensagens
- Fit/score_lead: leitura vinda da conversa/perfil

Nao recalcular ICP em Conversas na V1. Se o operador quiser, abre "Reavaliar ICP".

### 8. Follow-ups

Mostrar ICP como contexto, nao como criterio dominante.

No score de Follow-up, comportamento real deve continuar pesando mais:

- pediu preco e sumiu
- proposta parada
- reuniao pendente
- follow-ups ignorados

ICP pode entrar como desempate leve:

- Lead A: pequeno bonus ou selo visual.
- Lead C: nao impede follow-up se o lead ja demonstrou interesse real.

## Permissoes

Reusar capacidade existente:

- `lead_triar`: pode avaliar ICP, aprovar e descartar.

Leitura:

- `lead_ver_aprovados`: ve o selo ICP dos leads aprovados.
- `lead_ver_brutos`: ve ICP tambem em pendentes/brutos.

Escrita:

- Somente `lead_triar` salva ou reavalia ICP.

## Impacto visual

Padrao aprovado:

- Nao colorir a bolinha de Cadastro como chance de venda.
- Criar indicador proprio para Qualidade/ICP.
- Nao depender so de cor: sempre mostrar `Lead A`, `Lead B`, `Lead C`, `Sem ICP`.
- Usar tooltip com "o que mede".
- Manter tabelas compactas e horizontalmente rolaveis.

Na linha do Banco de Leads, a recomendacao e:

| Nome | Telefone | Envio | Status | Qualidade | Cadastro |
| --- | --- | --- | --- | --- | --- |
| Empresa X | ... | ... | Nao trabalhado | Lead A | 40/100 |

## Validacao planejada

### Backend

Testes novos/focados:

- `backend/test/lead-icp-score.test.js`
- `backend/test/lead-icp-modelo.test.js`
- `backend/test/aquisicao-curadoria.test.js`
- `backend/test/aquisicao-curadoria-ranking.test.js`
- `backend/test/lead-qualificacao.test.js`
- `backend/test/ligacao-prioridade.test.js`
- `backend/test/lead-fila-trabalho.test.js`
- `backend/test/autorizacao-rotas.test.js`

Validacoes gerais:

- `npm test`
- `npm run typecheck`
- `npm run smoke:preco`

### Frontend

Testes novos/focados:

- `frontend/lib/pontuacao-indicador.test.js`
- novo `frontend/lib/lead-icp.test.js`
- testes de exibicao/traducao de selo ICP
- testes de guardas para nao pintar cadastro como prioridade

Validacao manual:

1. Aquisição: abrir Assistente, avaliar Lead A, Lead B e descartar.
2. Banco de Leads: confirmar colunas Cadastro e Qualidade separadas.
3. Banco de Leads: filtrar Lead A e ordenar por maior qualidade.
4. Detalhes: ver ficha ICP completa.
5. Central de Ligacoes: confirmar que Lead A sobe na prioridade, mas so se estiver aprovado.
6. Conversas: confirmar que ICP e Interesse aparecem separados.
7. Follow-ups: confirmar que ICP nao sobrescreve comportamento real.

## Fases recomendadas

### Fase 1 - MVP Tenka v1.1 fixo

Implementar um unico modelo ativo, versionado em codigo/seed, sem tela de configuracao.

Entrega:

- Migration.
- Services puros.
- Curadoria com ficha ICP.
- Banco de Leads com coluna Qualidade.
- Detalhes com ficha ICP.
- Central de Ligacoes usando ICP como fator.

### Fase 2 - Configuracao de modelos ICP

Criar tela para administrar modelos:

- Tenka v1.1
- Energia solar
- Outros ICPs futuros

Nao fazer na Fase 1 para nao atrasar a validacao comercial.

### Fase 3 - Aprendizado por resultado

Conectar ICP com resultado real:

- resposta positiva
- reuniao
- proposta
- venda
- motivo de perda
- acesso ao decisor

Gerar relatorio por nicho/coorte:

- taxa de Lead A por nicho
- resposta por faixa ICP
- reuniao por faixa ICP
- venda por faixa ICP
- taxa de acesso ao decisor

## Decisoes que precisam de aprovacao

1. O MVP pode nascer com o modelo Tenka v1.1 fixo, sem tela de configuracao?
2. Lead C deve poder ser aprovado com aviso ou deve sempre ir para revisar/descartar?
3. O score minimo para aprovar deve ser livre ou deve pedir justificativa abaixo de 6?
4. A Central de Ligacoes deve usar ICP como bonus de prioridade ja na Fase 1?
5. O Banco de Leads deve mostrar a nova coluna como "Qualidade" ou "ICP"?

## Recomendacao

Seguir com a Fase 1.

Motivo: ela resolve o problema principal da operacao sem criar uma area de configuracao grande
antes de provar o fluxo. O Tenka v1.1 ja esta claro o bastante para uma primeira versao, e o
produto ja tem a base certa: curadoria por lead, qualificacao, fila de trabalho, prioridade de
ligacao, interesse em conversa e follow-up.
