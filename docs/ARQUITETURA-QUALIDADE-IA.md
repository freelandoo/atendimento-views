# Arquitetura de qualidade da IA

Documento de referencia para implementar a proxima camada de confiabilidade do agente comercial. O objetivo aqui nao e mudar o comportamento do sistema ainda, e sim fechar o desenho de contrato, observabilidade, versionamento, evals e revisao humana com base no estado real do repositorio.

## Escopo e diagnostico de partida

Estado atual confirmado no codigo:

- O prompt principal exige JSON estruturado em `prompts/system.md`, com `mensagem_pro_lead`, `atualizar_perfil`, `etapa_proxima`, flags de preco, handoff, links e lacunas.
- O backend aceita saidas frouxas demais em `index.js`: tenta `JSON.parse`, tenta extrair o primeiro objeto balanceado, aceita aliases de chave e, se tudo falhar, ainda tenta extrair uma string manualmente ou enviar texto livre.
- O banco atual persiste conversa, perfil, lacunas, follow-up e um resumo textual de `aprendizado`, mas nao registra uma execucao completa da geracao nem o bundle de prompt/conhecimento usado em cada resposta.
- O dashboard ja mostra totais, handoffs, falhas pendentes e lacunas abertas, mas ainda nao possui indicadores especificos de qualidade da IA.

Consequencia pratica: hoje o sistema consegue se manter operacional, mas mascara desvios de contrato, nao mede regressao e nao permite auditar com seguranca qual prompt ou conhecimento levou a cada resposta.

---

## 1. Contrato ideal de saida da IA

### 1.1 Objeto canonico

Toda resposta do modelo deve ser validada contra um contrato unico e estrito antes de qualquer envio ao lead:

```json
{
  "schema_version": "v1",
  "mensagem_pro_lead": "string",
  "mensagens_bolhas": ["string"],
  "atualizar_perfil": {},
  "etapa_proxima": "primeiro_contato|diagnostico|proposta|objecao|fechamento",
  "solicitar_calculo_preco": false,
  "solicitar_classificacao_nicho": false,
  "handoff": false,
  "motivo_handoff": null,
  "links_sugeridos": [],
  "registrar_lacuna": false,
  "tema_lacuna": null,
  "detalhe_lacuna": null
}
```

`schema_version` deve passar a ser obrigatorio para que o backend saiba qual validador aplicar.

### 1.2 Regras obrigatorias por campo

Campos obrigatorios em toda execucao:

- `schema_version`
- `etapa_proxima`
- `solicitar_calculo_preco`
- `solicitar_classificacao_nicho`
- `handoff`
- `motivo_handoff`
- `registrar_lacuna`

Campos obrigatorios por condicao:

- `mensagem_pro_lead` e obrigatoria quando `mensagens_bolhas` vier vazio ou omitido.
- `mensagens_bolhas`, quando presente, deve conter de 1 a 4 strings nao vazias.
- `motivo_handoff` deve ser `null` quando `handoff` for `false`.
- `motivo_handoff` deve ser um enum valido quando `handoff` for `true`.
- `tema_lacuna` e `detalhe_lacuna` devem ser obrigatorios quando `registrar_lacuna` for `true`.
- `links_sugeridos` deve conter apenas URLs autorizadas.

### 1.3 Invariantes de negocio pos-modelo

O validador nao deve olhar so tipos; ele deve validar coerencia operacional:

- `etapa_proxima` nao pode retroceder sem motivo explicito de negocio. Excecao: voltar para `diagnostico` quando faltar dado essencial.
- `solicitar_calculo_preco` so pode ser `true` quando o diagnostico estiver completo ou quando o lead tiver pedido valor explicitamente.
- Se `handoff` for `true`, a mensagem ao lead nao pode continuar empurrando o funil como se fosse seguir autonomamente.
- Se `motivo_handoff` for `aceitou_proposta`, a mensagem deve estar alinhada ao horario de redirecionamento ao Victor.
- `registrar_lacuna` nao pode ser usado para encobrir falta de parse. Lacuna e gap de conhecimento, nao erro de formato.
- `links_sugeridos` nao podem duplicar URL ja presente em `mensagem_pro_lead`.
- `atualizar_perfil` deve aceitar apenas os campos permitidos pelo dominio e validar enum/range por campo.

### 1.4 Taxonomia minima de falhas de contrato

As falhas devem ser classificadas antes de qualquer fallback:

1. `json_invalido`
2. `json_multibloco`
3. `campo_obrigatorio_ausente`
4. `tipo_invalido`
5. `enum_invalido`
6. `invariante_negocio_invalida`
7. `mensagem_vazia`
8. `link_nao_autorizado`
9. `perfil_invalido`
10. `lacuna_invalida`
11. `handoff_incoerente`
12. `fallback_aplicado`

### 1.5 Principais desvios atuais mapeados

Desvios confirmados no comportamento atual:

- `parsearRespostaJsonClaude()` aceita cercas Markdown, tenta extrair o primeiro JSON balanceado e retorna o primeiro parse valido, o que recupera respostas quebradas mas tambem mascara contratos errados.
- `normalizarParsedRespostaVendas()` aceita aliases como `mensagem`, `texto`, `resposta` e `msg`, em vez de exigir `mensagem_pro_lead`.
- `chamarClaude()` ainda tenta `extrairMensagemProLeadStringManual()` e, em ultimo caso, `extrairTextoLivreSeguroDoModelo()`, o que permite enviar mensagem ao lead sem JSON canonico.
- `resultadoParseadoParaObjeto()` faz coercao de tipos e defaults, mas nao rejeita objeto incompleto nem valida relacoes entre campos.
- `normalizarMotivoHandoff()` converte motivo invalido para `lead_pediu_humano`, o que troca um erro de contrato por um handoff aparentemente valido.
- `solicitar_calculo_preco !== false` faz com que ausencia ou tipo invalido da flag possa resultar em calculo de preco mesmo sem intencao explicita do modelo.
- `loadCasesCatalog()` carrega `knowledge/cases.json`, mas o prompt realmente injeta `prompts/empresa.md`; hoje existe conhecimento paralelo sem garantia de consistencia.

### 1.6 Direcao de implementacao

Recomendacao minima para o proximo ciclo:

1. Introduzir `validarRespostaVendas(parsed, contexto)` antes de `resultadoParseadoParaObjeto()`.
2. Manter o parser tolerante apenas para recuperar o JSON bruto, mas nunca para aprovar o contrato.
3. Converter aliases e texto livre em evento de erro, nao em sucesso silencioso.
4. Permitir fallback para o lead apenas em modo controlado, com `fallback_reason` persistido e sem atualizar perfil, preco ou handoff.

---

## 2. Telemetria minima de qualidade da IA

### 2.1 Objetivo

Cada geracao precisa deixar rastros suficientes para responder quatro perguntas:

1. O modelo respeitou o contrato?
2. O que foi enviado ao lead e o que foi bloqueado?
3. Qual prompt e qual conhecimento estavam ativos?
4. A qualidade piorou ou melhorou depois de uma mudanca?

### 2.2 Eventos minimos

Eventos recomendados por execucao:

| Evento | Quando emitir | Uso principal |
|--------|---------------|---------------|
| `ia_execucao_iniciada` | Antes da chamada ao modelo | Volume, taxa de geracao, distribuicao por etapa |
| `ia_execucao_concluida` | Resposta valida enviada ao lead | Latencia, sucesso, custo, estagio de saida |
| `ia_execucao_falhou` | Erro fatal sem envio | Parse, modelo, historico, envio |
| `ia_contrato_invalidado` | JSON parseou, mas o contrato falhou | Qualidade do prompt e regressao |
| `ia_fallback_aplicado` | Manual string ou texto livre usado | Medir dependencia de fallback |
| `ia_preco_calculado` | Backend calculou preco | Auditar proposta e gatilhos |
| `ia_handoff_emitido` | `handoff: true` | Motivos, etapa e precoce/tardio |
| `ia_lacuna_registrada` | Lacuna persistida | Evolucao da base autorizada |
| `ia_dashboard_reprocessada` | Reenvio manual/follow-up usando o mesmo pipeline | Separar producao automatica de intervencao humana |

### 2.3 Metadados minimos por execucao

Persistir por geracao:

- `execucao_id`
- `numero`
- `origem` (`webhook`, `dashboard_reprocessar`, `dashboard_followup`)
- `modelo`
- `duracao_ms`
- `estagio_entrada`
- `estagio_saida`
- `prompt_bundle_version`
- `system_prompt_hash`
- `knowledge_hash`
- `aprendizado_snapshot_id`
- `historico_mensagens`
- `ultima_mensagem_tem_midia`
- `parse_status` (`ok`, `json_invalido`, `contrato_invalido`, `fallback`, `erro`)
- `fallback_reason`
- `handoff`
- `motivo_handoff`
- `registrou_lacuna`
- `tema_lacuna`
- `solicitou_calculo_preco`
- `preco_calculado_no_backend`
- `erro_codigo`
- `erro_msg_resumida`

### 2.4 Persistencia recomendada no banco

Adicionar duas tabelas novas:

#### `vendas.ia_execucoes`

Uma linha por geracao do modelo.

Campos minimos sugeridos:

- `id BIGSERIAL PRIMARY KEY`
- `numero TEXT NOT NULL`
- `origem TEXT NOT NULL`
- `modelo TEXT NOT NULL`
- `duracao_ms INT`
- `estagio_entrada TEXT NOT NULL`
- `estagio_saida TEXT`
- `prompt_bundle_version TEXT NOT NULL`
- `system_prompt_hash TEXT NOT NULL`
- `knowledge_hash TEXT NOT NULL`
- `aprendizado_snapshot_id BIGINT`
- `parse_status TEXT NOT NULL`
- `fallback_reason TEXT`
- `handoff BOOLEAN NOT NULL DEFAULT false`
- `motivo_handoff TEXT`
- `registrou_lacuna BOOLEAN NOT NULL DEFAULT false`
- `tema_lacuna TEXT`
- `solicitou_calculo_preco BOOLEAN NOT NULL DEFAULT false`
- `preco_calculado_no_backend BOOLEAN NOT NULL DEFAULT false`
- `erro_codigo TEXT`
- `erro_msg TEXT`
- `criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()`

#### `vendas.ia_eventos_qualidade`

Uma linha por evento relevante dentro da execucao.

Campos minimos sugeridos:

- `id BIGSERIAL PRIMARY KEY`
- `execucao_id BIGINT NOT NULL REFERENCES vendas.ia_execucoes(id) ON DELETE CASCADE`
- `tipo_evento TEXT NOT NULL`
- `severidade TEXT NOT NULL DEFAULT 'info'`
- `payload JSONB NOT NULL DEFAULT '{}'::jsonb`
- `criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()`

Decisao de escopo: manter `vendas.conversas.ultima_falha_resposta_*` como resumo operacional rapido, mas considerar `vendas.ia_execucoes` a fonte de verdade para qualidade.

### 2.5 Metricas minimas no dashboard

Adicionar no dashboard:

#### `visao-geral.html`

- Taxa de parse invalido (7d / 30d)
- Taxa de fallback aplicado
- Taxa de handoff precoce
- Taxa de lacunas abertas
- Taxa de respostas com erro por etapa

#### `analytics.html`

- Serie diaria de `execucoes`, `contrato_invalido`, `fallback`, `lacuna`, `handoff`
- Filtro por `parse_status`, `motivo_handoff`, `origem` e `prompt_bundle_version`
- Tabela de piores motivos de falha e distribuicao por etapa

#### `conversa-detalhe`

- Timeline de execucoes da IA por conversa
- Ultimo bundle de prompt usado
- Ultimo motivo de fallback/erro de contrato
- Indicador se a resposta enviada foi normal, fallback ou reprocessada

### 2.6 Definicao de metricas

Formulas minimas:

- `taxa_parse_invalido = execucoes com parse_status em (json_invalido, contrato_invalido) / execucoes totais`
- `taxa_fallback = execucoes com parse_status = fallback / execucoes totais`
- `taxa_handoff_precoce = handoffs emitidos em primeiro_contato ou diagnostico / handoffs totais`
- `taxa_lacuna = execucoes com registrou_lacuna = true / execucoes totais`
- `taxa_reprocesso = execucoes origem dashboard_reprocessar / execucoes totais`

---

## 3. Versionamento de prompt, conhecimento e aprendizado injetado

### 3.1 Problema atual

Hoje o modelo recebe um bundle montado em tempo de execucao com:

- `prompts/system.md`
- `prompts/empresa.md`
- contexto dinamico de horario
- perfil do lead
- texto livre de `vendas.aprendizado`

O sistema tambem carrega `knowledge/cases.json`, mas esse catalogo nao e a fonte efetiva do prompt principal. Isso cria duas bases concorrentes.

### 3.2 Estrategia proposta

Versionar o bundle inteiro, nao apenas um arquivo isolado.

Conceitos:

- `prompt_bundle_version`: identificador logico legivel, por exemplo `sales-v1.3.0`
- `system_prompt_hash`: hash SHA-256 do conteudo final de `prompts/system.md`
- `knowledge_hash`: hash do conhecimento autorizado realmente injetado
- `aprendizado_snapshot_id`: referencia a qual snapshot aprovado de aprendizado entrou no prompt
- `bundle_hash`: hash final do texto completo enviado em `system`

### 3.3 Conhecimento autorizado

Definir uma unica fonte critica para o prompt:

Opcao recomendada:

1. `prompts/empresa.md` continua sendo a fonte injetada no modelo.
2. `knowledge/cases.json` passa a ser a fonte estruturada oficial para gerar um trecho deterministico de `empresa.md`.
3. Sempre que `cases.json` mudar, gerar um `knowledge_hash` novo e atualizar o trecho correspondente de forma audivel.

Se o projeto nao quiser gerar `empresa.md` a partir do JSON, a alternativa segura e declarar `cases.json` como referencia fora do caminho critico e remover a expectativa de que ele protege o modelo em producao.

### 3.4 Aprendizado injetado

`vendas.aprendizado` nao deve mais alimentar o prompt principal como texto solto sem aprovacao.

Separacao recomendada:

- `aprendizado_bruto`: insight gerado automaticamente a partir de vendas fechadas; nao entra no prompt principal
- `aprendizado_revisado`: resumo consolidado por humano
- `aprendizado_aprovado_para_prompt`: snapshot explicitamente promovido

Persistencia sugerida:

#### Ajustar `vendas.aprendizado`

Campos novos:

- `origem TEXT NOT NULL DEFAULT 'analise_vendas_fechadas'`
- `status TEXT NOT NULL DEFAULT 'rascunho'`
- `versao_logica TEXT`
- `resumo_revisado TEXT`
- `aprovado_para_prompt BOOLEAN NOT NULL DEFAULT false`
- `aprovado_por TEXT`
- `aprovado_em TIMESTAMPTZ`

Regra de operacao:

- O prompt principal so pode injetar snapshots com `aprovado_para_prompt = true`.
- O dashboard deve mostrar qual snapshot esta ativo e permitir trocar para nenhum snapshot quando houver duvida de qualidade.

### 3.5 Politica de release

Toda mudanca em `prompts/system.md`, `prompts/empresa.md`, `knowledge/cases.json` ou snapshot aprovado de aprendizado deve:

1. Gerar novo `prompt_bundle_version`
2. Salvar hashes do bundle
3. Rodar a suite minima de evals
4. Exigir anotacao curta de mudanca (`change_note`)

---

## 4. Suite minima de evals

### 4.1 Objetivo

Antes de subir mudanca de prompt ou pos-processamento, o projeto precisa conseguir provar que o agente continua:

- emitindo JSON valido
- respeitando o funil
- sem inventar preco, links ou politica
- registrando lacuna quando nao sabe

### 4.2 Corpus minimo

Criar um conjunto pequeno, estavel e revisado de transcripts reais anonimizados:

- 3 casos de `primeiro_contato`
- 4 casos de `diagnostico`
- 3 casos de `proposta`
- 2 casos de `objecao`
- 2 casos com `handoff`
- 2 casos com `lacuna`

Total alvo inicial: 16 casos.

### 4.3 Formato recomendado de fixture

Cada caso pode viver em `evals/cases/<slug>.json` com a estrutura:

```json
{
  "id": "diagnostico-dentista-sbc-01",
  "descricao": "Lead local em diagnostico com dor alta e sem pedir preco ainda",
  "tags": ["diagnostico", "dor_alta", "sem_preco"],
  "input": {
    "estagio": "diagnostico",
    "perfil": {
      "negocio": "dentista",
      "cidade": "Sao Bernardo do Campo",
      "ticket_cliente_final": "alto"
    },
    "historico": []
  },
  "expects": {
    "json_valido": true,
    "etapa_proxima_in": ["diagnostico", "proposta"],
    "handoff": false,
    "solicitar_calculo_preco": false,
    "deve_conter_pergunta": true,
    "links_sugeridos_whitelist": true
  }
}
```

### 4.4 Asserts objetivos minimos

Asserts por caso:

- JSON parseavel
- contrato valido pelo validador canonico
- `etapa_proxima` dentro do conjunto esperado
- `motivo_handoff` coerente com `handoff`
- nenhum link fora da whitelist
- sem preco inventado em texto livre quando `solicitar_calculo_preco = false`
- sem mencionar PIX/cartao/pagamento direto
- `registrar_lacuna = true` quando o transcript pergunta algo fora do conhecimento autorizado

Asserts especificos por categoria:

- `primeiro_contato`: deve pedir segmento e cidade; no maximo uma pergunta
- `diagnostico`: deve manter foco em coleta de dados/termometro; sem propor valor cedo
- `proposta passo A`: nao pode citar valores monetarios de entrada/parcela
- `proposta passo B`: pode pedir calculo de preco, mas nao pode inventar numero fora do backend
- `objecao`: deve responder a objecao verbalizada; sem reiniciar funil
- `lacuna`: deve marcar lacuna sem inventar politica ou servico
- `handoff`: deve usar um motivo do enum e parar escalada automatica

### 4.5 Anonimizacao de transcripts

Ao montar o corpus:

- substituir telefone, nomes proprios, enderecos e CNPJ por placeholders
- manter nicho, cidade e contexto comercial quando forem determinantes para o caso
- remover audios/imagens se nao forem essenciais; quando forem, usar marcador textual
- registrar quem anonimiza e quando

### 4.6 Execucao minima

Gatilhos obrigatorios para rodar evals:

- qualquer mudanca em `prompts/*.md`
- qualquer mudanca em parse/validacao/pos-processamento em `index.js`
- qualquer mudanca na whitelist de links, motivos de handoff ou logica de lacuna

Saida minima por execucao:

- resumo por caso (`pass`, `fail`, `warning`)
- contagem por classe de erro
- comparacao com ultimo `prompt_bundle_version`

### 4.7 Persistencia recomendada

Adicionar:

#### `vendas.ia_eval_execucoes`

- `id BIGSERIAL PRIMARY KEY`
- `prompt_bundle_version TEXT NOT NULL`
- `knowledge_hash TEXT NOT NULL`
- `aprendizado_snapshot_id BIGINT`
- `total_casos INT NOT NULL`
- `falhas INT NOT NULL`
- `criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()`

#### `vendas.ia_eval_resultados`

- `id BIGSERIAL PRIMARY KEY`
- `execucao_id BIGINT NOT NULL REFERENCES vendas.ia_eval_execucoes(id) ON DELETE CASCADE`
- `case_id TEXT NOT NULL`
- `status TEXT NOT NULL`
- `asserts JSONB NOT NULL`
- `saida_bruta JSONB`

---

## 5. Loop de lacunas e revisao humana

### 5.1 Problema atual

`vendas.conhecimento_lacunas` registra o gap, permite nota de resolucao e marca `resolvido_em`, mas ainda nao separa:

- urgencia
- tipo de aprendizado
- acao aplicada
- aprovacao para a base autorizada
- validacao por eval antes de publicar

### 5.2 Fluxo alvo

Fluxo recomendado:

1. IA detecta pergunta fora do conhecimento autorizado
2. Backend grava lacuna ligada a uma `execucao_id`
3. Dashboard coloca a lacuna em fila operacional
4. Humano classifica tema, impacto e tipo de aprendizado
5. Humano decide a acao:
   - atualizar conhecimento autorizado
   - ajustar prompt
   - criar regra comercial interna
   - manter fora do escopo e sempre encaminhar ao Victor
6. Mudanca proposta gera novo bundle/versionamento
7. Evals rodam nos casos relacionados
8. So depois disso a resolucao e marcada como publicada

### 5.3 Modelo de dados recomendado

Expandir `vendas.conhecimento_lacunas` com:

- `execucao_id BIGINT`
- `status TEXT NOT NULL DEFAULT 'aberta'`
- `impacto TEXT`
- `tipo_aprendizado TEXT`
- `acao_recomendada TEXT`
- `fonte_resolucao TEXT`
- `publicado_em TIMESTAMPTZ`
- `publicado_por TEXT`
- `eval_execucao_id BIGINT`

Enums recomendados:

- `status`: `aberta`, `triagem`, `em_revisao`, `aguardando_eval`, `publicada`, `descartada`
- `impacto`: `baixo`, `medio`, `alto`, `critico`
- `tipo_aprendizado`: `conhecimento_factual`, `ajuste_prompt`, `insight_comercial`, `fora_escopo`

### 5.4 Regras operacionais

- Lacuna repetida no mesmo tema nao deve abrir itens soltos infinitamente; deve incrementar recorrencia ou anexar contexto ao item principal.
- Lacuna `fora_escopo` nao volta para o prompt como se fosse conhecimento da PJ.
- Nem todo insight comercial vira texto de prompt; muitas vezes deve virar nota operacional ou criterio de handoff.
- So itens `publicada` podem alterar a base autorizada ou snapshot de aprendizado.

### 5.5 Dashboard recomendado

Adicionar uma visao de fila com:

- volume de lacunas abertas por tema
- recorrencia por 7d e 30d
- impacto x status
- ultima conversa afetada
- acao aplicada
- link para a eval que validou a publicacao

### 5.6 Criterio de pronto para fechar a lacuna

Uma lacuna so pode sair de `aguardando_eval` para `publicada` quando:

1. existir texto de resolucao claro
2. a mudanca estiver associada a um `prompt_bundle_version`
3. houver `eval_execucao_id` com sucesso
4. um humano identificar quem aprovou a publicacao

---

## Ordem recomendada de implementacao

1. Validador estrito do contrato + persistencia de `ia_execucoes`
2. Eventos de qualidade + cards basicos no dashboard
3. Versionamento de bundle e bloqueio de aprendizado nao aprovado
4. Corpus minimo de evals e runner simples
5. Expansao do fluxo de lacunas com status, impacto e publicacao

## Arquivos diretamente impactados no proximo ciclo

- `index.js`
- `prompts/system.md`
- `prompts/empresa.md`
- `knowledge/cases.json`
- `sql/init.sql`
- `visao-geral.html`
- `analytics.html`
- `conversas.html`
- `dashboard/js/*`

## Criterio de sucesso deste desenho

Este plano estara corretamente implementado quando o time conseguir, para qualquer resposta enviada ao lead:

1. reconstruir qual bundle de prompt/conhecimento estava ativo
2. dizer se houve contrato valido, fallback ou erro
3. medir o impacto da mudanca por evals e metricas
4. promover aprendizado novo so depois de revisao humana e validacao objetiva
