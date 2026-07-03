# Spec — Saudação de análise por lead + simplificação de Estágios e Saudações

**Data:** 2026-07-03 · **Status:** aprovado pelo Alex (opção 3 + campo de instruções extras)

## Objetivo

1. A primeira mensagem de prospecção deixa de ser template fixo e vira uma **saudação de
   análise gerada por IA por lead**, usando as lacunas do cadastro (sem site, sem fotos,
   sem horário…) — no estilo: *"Olá, [nome], tudo bem? Estava analisando perfis no Google
   e encontrei o seu. Percebi que você não tem site — hoje ele é a maior porta de entrada
   de clientes. Analisei bastante seu perfil, posso te mandar o que encontrei?"*
2. Tela do Contexto mais simples: o card "Saudações automáticas" morre (textos hoje não
   são usados pelo runtime); Estágios ganham visão compacta com modo avançado.
3. Pipeline do Inserir mais rápido/barato: estágios em 1 passe de IA (não 2) e uma etapa
   de mensagens a menos.
4. A análise do cadastro **acompanha o lead na conversa**: o agente enxerga score+lacunas
   em todos os turnos (não só na 1ª mensagem).

Decisões do Alex: geração **na hora do disparo** (não pré-gerada); card Saudações
**removido** (não unificado); **campo de instruções extras** editável para a IA.

Constatação que motivou o desenho: das 6 chaves do grupo `saudacoes`, nenhuma é lida
pelo runtime (`resolverMensagem` só é chamado por `agenda.js` com `gatilhos_agenda`).
A abertura receptiva real é o `opener_protocolo` — que permanece intocado (lead orgânico
não tem dado de Places/IG para analisar; determinismo ali é proposital).

---

## Frente 1 — Saudação de análise no disparo (Rodar leads)

### Serviço novo `backend/src/services/saudacao-analise.js`

`async gerarSaudacaoAnalise({ pool, log, empresaId, contextoId, conhecimento, jsonApresentacao, instrucoes, nomeLead })` → `string` (texto pronto) ou `''` em falha.

- Provider: `ai-provider.generateAIResponse` padrão (modelo de atendimento), task
  `saudacaoAnaliseLead`, `maxTokens` 350, timeout `SAUDACAO_IA_TIMEOUT_MS` (default 30000).
- System prompt (fixo): consultor comercial escreve UMA mensagem de abertura de WhatsApp
  em pt-BR, tom humano; cumprimenta pelo nome; mostra que analisou o negócio (cita 1 dado
  real); aponta 1–2 lacunas como oportunidade; oferece a solução; termina com UMA pergunta;
  máximo 400 caracteres; NÃO inventa dados; segue as INSTRUÇÕES EXTRAS DA EMPRESA quando
  existirem (tom, CTA, oferta).
- User prompt composto por: `CONHECIMENTO DA EMPRESA` (do contexto da instância, quando
  houver) + `INSTRUÇÕES EXTRAS` (config da instância) + `DADOS DO LEAD` (o
  `json_apresentacao` sem o campo `.prompt`: dados agrupados + pontuação + lacunas).
- Pós-validação: saída vazia ou com **mais de 500 chars** conta como falha (cai no
  fallback). Nunca lançar para o caller — retorna `''`.

### Mudanças em `rodar-leads.js`

- Config por instância (`app.empresa_whatsapp_instances.config_json`):
  - `saudacao_ia: boolean` — **default ligado** quando ausente;
  - `saudacao_instrucoes: string` — instruções extras livres.
- Query dos prospects aceitos passa a selecionar os campos necessários pro
  `json_apresentacao`: `origem, email, endereco, rating, avaliacoes, tem_site, site,
  maps_url, link_bio, bio, categoria_perfil, seguidores, instagram_handle, raw_json`.
- Conhecimento: carregado do contexto vinculado à instância
  (`empresa_whatsapp_instances.contexto_id` → `montarConhecimentoDoContexto`); fail-open
  (sem contexto ⇒ gera só com os dados do lead).
- Fluxo por lead no background (mantém TODO o throttle atual — lote 15, cooldown, teto
  diário, jitter):
  1. Reserva continua gravando em `lead_disparos.mensagem` o **template renderizado**
     (fallback garantido).
  2. Se `saudacao_ia` ativa: monta `json_apresentacao` pela origem
     (`montarJsonApresentacaoPlaces`/`Instagram` de `lead-score-cadastro.js`), chama
     `gerarSaudacaoAnalise`. Sucesso ⇒ `UPDATE lead_disparos.mensagem = textoIA` e envia
     o textoIA. Falha ⇒ envia o template (mensagem do disparo já é ele).
  3. Histórico da conversa (`registrarEnvioNoHistorico`, já existente) recebe o texto
     realmente enviado, com `meta.gerada_por_ia: true|false`.

### Rota de prévia

`POST /api/empresas/:empresaId/banco-leads/saudacao-ia/preview`
body `{ instancia_id, prospect_id }` → `{ mensagem, gerada_por_ia }`.
Gera sem enviar (mesmo caminho do disparo, sem persistir nada). Auth + escopo empresa.
Erros de IA caem no template (`gerada_por_ia: false`) — a prévia nunca dá 5xx por IA.

### Front (Banco de Leads → modal "Saudação — teste e edição")

- Toggle **"Gerar por IA com análise do lead"** (`saudacao_ia`).
- Textarea **"Instruções extras para a IA"** (`saudacao_instrucoes`) com placeholder
  explicativo (tom, CTA, oferta).
- Botão **"Gerar exemplo"**: usa o primeiro lead selecionado (ou o primeiro rodável da
  lista) e mostra a mensagem devolvida pela prévia, com aviso quando caiu no template.
- O template atual continua editável, rotulado como **fallback** ("usado se a IA falhar
  ou se o toggle estiver desligado").
- `PATCH /api/empresas/:id/whatsapp/:instId` passa a aceitar/persistir os dois campos
  novos de config (validação: boolean e string ≤ 2000 chars).

---

## Frente 2 — Card "Saudações automáticas" morre

- `mensagens-automaticas.js`: remove o catálogo `SAUDACOES` e o grupo `saudacoes` de
  `GRUPOS`. Fica só `gatilhos_agenda` (lembretes/remarcação — já funcionam via
  `agenda.js`). `renderTemplate`/placeholders permanecem.
- Colunas `saudacoes_json` no banco ficam como estão (dado inerte; sem migration).
- `gerarTudo` itera `CHAVES_GRUPO` ⇒ automaticamente perde a etapa `mensagens_saudacoes`
  (1 chamada de IA e 1 passo do overlay a menos). `ETAPAS_GERAR_TUDO` acompanha.
- Front (`ContextoEditor`): card renomeado para **"Gatilhos da agenda"**; entrada
  `mensagens_saudacoes` sai de `ETAPAS_PIPELINE`; `GRUPO_LABEL` sem `saudacoes`.
- Rotas `/mensagens*` continuam; `grupo=saudacoes` passa a ser rejeitado como inválido
  (front não envia mais).

## Frente 3 — Estágios: 1 passe de IA + tela compacta

### Backend

- Novo prompt único **adaptar+refinar** (em `geracao-frameworks.js`): recebe template
  genérico da etapa + conhecimento da empresa + técnica da etapa (`MAPA_POR_ETAPA`) e
  devolve o estágio final (adaptado ao negócio E denso em técnica de venda).
- `geracao-completa.gerarTudo`: os passos 3 (adaptar) e 4 (refinar) viram UM passo
  `estagios` (6 chamadas em paralelo; genérico continua cacheado). Falha por etapa ⇒
  mantém o texto anterior (mesma degradação de hoje). `ETAPAS_GERAR_TUDO`:
  `estagios_base` + `estagios_refinados` → `estagios`.
- `refinarEstagiosComFrameworks` só é removido se nada mais o usar (verificar
  `geracao-simulacao`); rotas manuais `/estagios/gerar|adaptar` não mudam.

### Front (`CardEstagios`)

- Visão padrão **compacta**: uma linha por estágio (label + tamanho + primeira linha do
  texto), sem textarea.
- Botão **"Editar prompts (avançado)"** alterna para os acordeões/textareas atuais.
- **"Informações da empresa"** vira somente-leitura (bloco auto-gerado do Contexto 1),
  com nota explicando a origem.
- "Simular e melhorar" e "Salvar edições" permanecem (Salvar só visível no avançado).
- `ETAPAS_PIPELINE` (overlay do Inserir) atualizado: uma etapa "Gerando e refinando os
  estágios do funil".

## Frente 4 — Análise segue o lead na conversa

- `prospecting.js buscarContextoProspeccao`: calcula `analise_cadastro` do prospect pela
  origem (`calcularScoreCadastroPlaces`/`Instagram`) e devolve
  `{ score, maximo, lacunas: [chaves], pontos_fortes: [chaves] }` dentro de
  `contexto_vendas`.
- `webhook-handler.js`: `contextoPerfilProspeccao` ganha `analise_cadastro` (persistido
  em `lead_profiles.contexto_prospeccao`, como os demais campos).
- `agent.js` (bloco que injeta `contexto_prospeccao` no prompt, ~linha 2716): nova linha
  "ANÁLISE DO CADASTRO: score X/YY; lacunas: … — use como argumento de venda quando fizer
  sentido, sem repetir a saudação inicial."

---

## Variáveis de ambiente novas

- `SAUDACAO_IA_TIMEOUT_MS` (default `30000`) — timeout da geração da saudação de análise.
Documentar em `.env.example` + `AGENTS.md` (regra do repo).

## O que NÃO muda

- `opener_protocolo` (abertura receptiva determinística) — intocado.
- Gatilhos da agenda (textos + `resolverMensagem`) — intocados.
- Fila diária automática do Places (já gera mensagem personalizada via diagnóstico).
- Throttle anti-ban do Rodar leads.
- Schema do banco (zero migration).

## Testes

1. `saudacao-analise.test.js`: gera com dados+instruções (instruções entram no prompt);
   saída vazia/longa ⇒ `''`; provider lança ⇒ `''` (nunca propaga).
2. `rodar-leads.test.js` (ampliar): com `saudacao_ia` ligado envia texto da IA e atualiza
   `lead_disparos.mensagem`; IA falha ⇒ envia template; toggle desligado ⇒ template direto.
3. `mensagens-automaticas.test.js` (ajustar): grupo único `gatilhos_agenda`;
   `grupo=saudacoes` inválido.
4. `geracao-completa.test.js` (ajustar): `ETAPAS_GERAR_TUDO` nova ordem
   (`analisar_fontes, contexto1, estagios, playbook, mensagens_gatilhos_agenda`);
   onEtapa continua rodando→ok por etapa.
5. `prospecting-response.test.js` (ampliar): `buscarContextoProspeccao` devolve
   `analise_cadastro` coerente com o prospect.
6. Front: typecheck + fluxo manual (modal saudação, prévia, card estágios compacto).

## Riscos

- **Custo/latência por disparo**: +1 chamada de IA por lead rodado (máx. 40/dia por
  instância) com timeout de 30s dentro de um fluxo que já espaça envios em 12–20s;
  aceitável. Kill switch por instância (toggle).
- **Qualidade da 1ª mensagem**: mitigada pelas regras fixas (≤400 chars, 1 pergunta, não
  inventar) + instruções extras + botão "Gerar exemplo".
- **Remoção do grupo saudacoes**: risco de referência esquecida — varrer `grupo:
  'saudacoes'` no código e testes antes de finalizar.
- **Fusão adaptar+refinar**: qualidade do estágio pode variar levemente; "Simular e
  melhorar" continua disponível como segundo passe opcional.
