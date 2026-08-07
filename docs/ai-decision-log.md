# Registro de decisões técnicas da IA

Registro das decisões técnicas e arquiteturais relevantes tomadas ao longo do projeto
(Fase 8 do [workflow padrão](ai-workflow.md)). Objetivo: evitar que decisões fiquem só no
chat e se percam, e que a próxima IA redescubra tudo do zero. Entradas em ordem
cronológica inversa (mais recente no topo).

> Registre aqui: nova tabela/campo/migration, novo módulo, nova dependência, mudança de
> arquitetura de pastas/rotas/services/APIs, refatoração grande, mudança em
> financeiro/assinatura/dashboard/permissão/integração, ou criação de um novo padrão visual.

---

## 2026-08-07 — Classificação CANÔNICA de site próprio x rede social / agregador (migration 056)

Correção de causa raiz, não de tela. O defeito não era um bug isolado: era **a mesma pergunta
respondida de sete jeitos diferentes** pelo projeto. Em todos eles a regra era
`site preenchido ⇒ tem site`, então Instagram, Facebook, TikTok, wa.me, Google Maps, Linktree e
perfis de marketplace contavam como site próprio — sumindo do filtro "Sem site" e perdendo o
bônus de prioridade justamente os leads **alvo** de uma campanha de criação de site.

- **Novo módulo PURO `backend/src/services/site-classificacao.js` como fonte de verdade única.**
  Sem banco, sem HTTP, sem IA, sem rede: classifica pelo DOMÍNIO (nunca por texto solto —
  `padariax.com.br/instagram` é site próprio; `instagramdaloja.com.br` também). A busca sobe a
  hierarquia do host do mais específico para o menos, então `maps.app.goo.gl` (mapa) vence
  `goo.gl` (encurtador) e `sites.google.com` (construtor) vence `google.com`. Categorias:
  `site_proprio`, `rede_social`, `agregador`, `perfil_ou_diretorio`, `desconhecido`, `sem_link`.
- **A autoridade é a função na LEITURA; as colunas são cache.** Foi a decisão central. Se a
  verdade fosse só a coluna, as telas continuariam erradas até a correção histórica rodar, e
  qualquer produtor esquecido reintroduziria o erro em silêncio. Com o veredito na leitura, o
  deploy já corrige a exibição e a coluna desatualizada nunca engana ninguém.
- **`desconhecido` existe para não mentir nos dois sentidos.** Encurtador (`bit.ly`) esconde o
  destino; subdomínio de construtor (`lojax.wixsite.com`) não é domínio independente mas pode ser
  uma página real. Nenhum dos dois vira "tem site" nem "sem site" — vira "Verificar link".
- **Contrato de dados (migration 056, ADITIVA):** `site` passa a significar EXCLUSIVAMENTE site
  próprio; `link_original` guarda o link cru para auditoria; `classificacao_url` guarda a
  categoria (`CHECK` de vocabulário fechado; `NULL` = ainda não classificado, ≠ `'desconhecido'`,
  que é decisão tomada). A migration **não muta `tem_site` nem limpa `site`** — a regra é
  JavaScript testado, não SQL, e a correção precisa de simulação antes de gravar.
- **Correção histórica é SCRIPT com simulação por padrão**, não backfill no boot:
  `npm run reclassificar:sites` (simula) / `-- --aplicar` (grava). Idempotente (testado até a
  3ª passada), em lotes com paginação keyset, sem nenhuma chamada externa ou paga, com relatório
  de analisados/alterados/mantidos/desconhecidos. Antes de limpar `site`, copia o valor para
  `link_original` **na mesma instrução UPDATE** — nenhum link histórico se perde.
- **Decisão do operador: link social conta como SEM site (40 pts na fila), não "não
  identificado".** Um Linktree prova que aquele link não é site; o operador optou por tratar o
  lead como oportunidade confirmada. Só fica em "Verificar link" quem não tem link nenhum e nunca
  teve a ficha do Maps lida, ou cujo link é ambíguo.
- **Fora de escopo declarado:** o `tem_site` **conversacional** (o que o lead declara no WhatsApp,
  em `agent.js`, `turn-context-reader.js`, `prompts/*.md`, `vendas.lead_profiles`). Ali o valor
  nasce de fala humana, não de URL — o classificador não se aplica e mexer nisso alteraria prompt
  de produção sem necessidade. No `webhook-handler.js`, o que o lead DECLAROU continua tendo
  precedência sobre o que o cadastro diz.
- **Ajuste de escopo durante a implementação:** o link não-site chegou a entrar em
  `links_extras` do score de cadastro, mas isso lhe dava 10 pontos e **mascarava justamente a
  lacuna** que a proposta comercial deve atacar. Revertido: o Instagram aparece em
  `link_original` e numa linha dedicada do prompt, sem pontuar.
- **Frontend não replica a regra.** `frontend/lib/site-rotulos.js` só traduz o veredito que a API
  já mandou (não há lista de domínios lá, de propósito). A dívida de backend/frontend serem
  pacotes npm separados está declarada no cabeçalho do arquivo.
- Nenhuma variável de ambiente nova. Testes: `test/site-classificacao.test.js` (unitários +
  integração cruzando os consumidores) e `test/reclassificar-sites.test.js` (idempotência).

---

## 2026-08-07 — Painel de filtros da Central de Ligações vira FLUTUANTE (sem migration)

Correção de UX sobre a entrega anterior do mesmo dia. Alteração **100% de apresentação**: nenhum
arquivo de `backend/` foi tocado, nenhuma requisição nova, nenhuma regra de elegibilidade ou de
ordenação da fila mudou (quem entra e a ordem seguem decididos em `services/ligacao-prioridade.js`).

- **O painel saiu do FLUXO e foi para um PORTAL.** A versão anterior renderizava `<FiltrosFila>`
  entre os chips e a tabela: com 6 grupos e `space-y-5`, abrir os filtros empurrava a fila
  centenas de pixels para baixo — exatamente quando o operador precisa dela na tela. Agora é
  `createPortal` no `<body>` com `position:fixed` calculado do `getBoundingClientRect()` do botão
  "Filtros" (mesma técnica já usada no tooltip da Prioridade nesta tela). Em portal o painel tem
  **altura zero no fluxo**, então a tabela não muda de altura nem de posição.
- **Rascunho x aplicado.** O painel edita uma CÓPIA local da view; só "Aplicar filtros" troca o
  recorte da tela. Mexer nos controles mudaria a listagem a cada tecla, e a fila dançaria embaixo
  de quem ainda está configurando. O rodapé mostra a **prévia** (`N de M leads`) do rascunho, com
  aviso "ainda não aplicado" enquanto diverge. Fechar por qualquer via (botão, clique fora,
  Escape, Cancelar) **descarta o rascunho e preserva o que já estava aplicado**. Como o componente
  é montado/desmontado no toggle, reabrir sempre parte do aplicado — sem estado obsoleto.
- **"Limpar filtros" volta à FILA PADRÃO, não ao vazio de critério.** `filaPadrao()` (não
  iniciados), não `limparFiltros()`. Zerar tudo devolveria ao operador leads que ele já
  trabalhou — o oposto do que "limpar" significa numa fila de trabalho. `limparFiltros()` (fila
  inteira) continua existindo como saída EXPLÍCITA no estado vazio ("Ver a fila inteira") e via
  remoção do chip de tentativas.
- **Novo helper puro `viewsIguais(a, b)`** em `frontend/lib/fila-ligacoes-view.js`: normaliza os
  dois lados antes de comparar campo a campo. Serve ao "ainda não aplicado" e a esconder o
  "restaurar padrão" quando já se está nele. Nenhuma lógica de filtro migrou para o `.tsx`.
- **Campanha, telefone e ordem seguem INDICADORES, não controles** (decisão anterior mantida, e
  agora estendida à ordem): a campanha já tem seletor no topo, telefone discável é requisito de
  ENTRADA garantido no servidor (filtro seria no-op) e a ordem por prioridade é do servidor.
  Virar `<select>` criaria dois donos para o mesmo estado.
- **Defeito evitado durante a implementação:** `OperacaoLigacao` é um overlay `fixed inset-0
  z-50`; um painel `z-[80]` aberto ficaria POR CIMA da tela de atendimento e o Escape seria
  disputado pelos dois. Entrar em ligação agora fecha o painel.
- **Responsivo:** abaixo de 768px o painel vira drawer inferior com backdrop e rolagem interna
  (`aria-modal`); no desktop tem largura fixa de 620px, sem backdrop — a fila continua visível e
  clicável ao fundo, como no `PersonalizarModal` do Banco de Leads.

---

## 2026-08-07 — Correções de UX/operação da Central de Ligações (sem migration)

Ajustes sobre a entrega do mesmo dia (logo abaixo), após revisão de UX/operação.

- **Tentativa anterior deixa de valer ponto (mudança de regra):** `PESOS.uma_tentativa` (5) e
  `PESOS.duas_ou_mais_tentativas` (0) viraram um único `PESOS.com_tentativa = 0`. O desenho
  anterior colocava um lead já tocado na frente de um lead inédito de mesmo perfil, o que é o
  oposto do que a operação quer da PRIMEIRA fila. **Retentativa passou a ser uma FILA, não um
  bônus:** o filtro "Tentativas de contato" (`Não iniciados | Com tentativa | Todos`) nasce em
  "Não iniciados" e a retentativa é alcançada trocando o filtro. O motivo continua sendo exibido
  no tooltip (o operador precisa saber que o lead já foi tocado) — só não soma.
- **Tooltip da prioridade em PORTAL, não em `position:absolute`:** a versão anterior renderizava
  a bolha dentro do `<td>`, e o wrapper da tabela é `overflow-hidden` — a explicação da 1ª linha
  era cortada pela borda do container (o comentário no código afirmava o contrário). Agora
  `createPortal` para o `<body>` com `position:fixed` calculado do `getBoundingClientRect()` do
  círculo; fecha em `scroll` (capture) e `resize`, porque a âncora se moveria. Ganho colateral:
  a bolha não pode mais influenciar a altura da linha. Somente leitura (`pointer-events-none`).
- **O toggle de visão saiu da LISTAGEM e foi para a TELA DE ATENDIMENTO.** Detalhe enriquecido
  por linha engorda a tabela justamente na tela cujo trabalho é escanear e discar rápido. O
  contexto comercial só é útil com alguém na linha — então `Visão simples | detalhada` vive ao
  lado do bloco do lead depois de clicar em Ligar, em `simples` por padrão, sem persistência
  (é escolha do atendimento atual, não configuração de tela).
- **`listarLeadsDaCampanha` passou a trazer os mesmos campos enriquecidos + `situacao_site`.**
  A tela de atendimento também abre pela aba Acompanhamento ("Registrar"); sem isso a Visão
  detalhada abriria vazia por aquele caminho. `situacao_site` vem da função PURA `situacaoSite`
  do service (reuso), **nunca recalculada no front** — a regra dos três estados do site tem uma
  fonte só. Não há `prioridade` nessa lista de propósito: ela não é a fila de ligação.
- **Painel de filtros virou OPERACIONAL GERAL,** em grupos (Operação, Contato, Potencial
  comercial, Perfil do negócio, Presença digital, Qualidade do dado), no padrão do
  `PersonalizarModal` do Banco de Leads. Duas coisas que o pedido listava e que **não viraram
  controle**, por decisão explícita: (1) **Campanha** — o seletor já existe no topo da página e
  duplicar o mesmo estado em dois lugares é o que o AGENTS.md proíbe; vira indicador com a dica
  de onde trocar. (2) **Telefone disponível** — telefone discável é requisito de ENTRADA
  garantido no backend, então o filtro seria sempre no-op; vira nota fixa no grupo Contato.
- **Chips passam a ser medidos contra um estado NEUTRO, não contra o padrão.** Como a fila nasce
  filtrada ("Não iniciados"), medir os chips contra o padrão esconderia do operador o fato de a
  tela estar escondendo leads. Consequência de desenho: `limparFiltros()` vai para o NEUTRO
  (mostra a fila inteira, inclusive retentativas) e há um botão separado "Fila padrão".
- **Chave do localStorage subiu para `filaLigacoesView.v2`:** a view salva pela versão anterior
  tem `modo` (extinto) e `tentativas:'todas'` — valor ainda válido no enum novo, que sobreviveria
  à normalização e deixaria o operador antigo sem a fila padrão.
- **Nada disso cria coleta:** todos os sinais usados (site, avaliações, nota, e-mail, redes,
  endereço, origem, data de entrada) já são lidos hoje de `prospectador.prospects`.
  Sem migration, sem env nova, sem rota nova.

---

## 2026-08-07 — Prioridade comercial da fila da Central de Ligações (sem migration)

- **A prioridade NÃO reaproveita `prospects.score` (decisão central):** o `score` mede completude
  do CADASTRO (tem site, fotos, horário, links…). Usá-lo como fila de ligação inverte o sinal
  numa campanha de criação de site — quem tem site pontua ALTO no cadastro e é exatamente quem
  vale menos ligar agora. Por isso nasceu uma pontuação separada, `prioridade` (0-100), calculada
  por `src/services/ligacao-prioridade.js`. O `score` continua no payload, sem uso na fila.
- **Regra no BACK-END, apresentação no front:** quem entra na fila e em que ordem é decisão
  comercial, não de tela (AGENTS.md: regra sensível não fica só no front). O módulo é PURO e
  testável, no mesmo padrão de `followup-call-score.js`, com `PESOS`/`CORTES` agrupados no topo
  para calibração futura por reuniões marcadas e conversões. O front (`lib/fila-ligacoes-view.js`,
  também puro) só ESCOLHE o que exibir do que já veio — não recalcula prioridade nem reordena.
- **Telefone válido é requisito de ENTRADA, não peso:** somar pontos por ter telefone faria um
  lead sem telefone "quase entrar" na fila. Alternativa descartada: manter na fila com aviso —
  polui a operação de discagem e falseia o total. Sem telefone discável o lead não aparece e
  **não conta** no total; continua no Banco de Leads e na aba Acompanhamento, para enriquecimento.
- **Três estados de site, não dois:** `prospects.tem_site` é `NOT NULL DEFAULT false`, então
  `false` sozinho significa tanto "confirmado sem site" quanto "ninguém verificou". Tratar tudo
  como "sem site" daria 40 pontos a lead social nunca checado. A confirmação passou a exigir
  `place_id` (ficha do Maps efetivamente lida): com ele, `tem_site=false` vale 40; sem ele, o lead
  cai em "não identificado" (15). Alternativa descartada: criar coluna/migration para o terceiro
  estado — a informação já é derivável do que existe, e o pedido não pedia mudança de schema.
- **Filtro e ordenação client-side sobre a fila inteira (`?limit=500`, teto do servidor):** com
  filtro server-side, cada mudança de filtro custaria requisição e a contagem "X de Y" ficaria
  ambígua; a fila é pequena por natureza (leads não finalizados de UMA campanha) e o Banco de
  Leads já usa exatamente esse padrão (fetch único + view persistida em `localStorage`).
- **A explicação da pontuação é determinística e sem PII:** os `motivos` saem das próprias regras
  (nenhuma chamada de IA nesta tela) e nunca incluem nome, telefone, e-mail ou endereço — há
  teste que falha se algum desses vazar para a explicação.
- **Dívida técnica declarada:** a regra de "telefone discável" passou a existir também no backend
  (`telefoneDiscavel`), duplicando `analisarFone` de `frontend/lib/ligacao-fone.js`. `backend/` e
  `frontend/` são pacotes npm separados, sem módulo compartilhado; extrair um pacote comum seria
  mudança estrutural fora do escopo. Ambos os arquivos carregam o aviso cruzado.

---

## 2026-08-05 — Modal guiado de entrada do Assistente de Oportunidades (sem migration)

- **A busca guiada NÃO cria e NÃO muta sessão (decisão central):** o pedido deixava em aberto se
  "Encontrar novas oportunidades" deveria abrir uma sessão isolada ou retargetar a atual. As três
  saídas foram avaliadas:
  (a) *retargetar a sessão ativa* — descartada: trocaria `nicho/cidade` de uma sessão com meta
  parcialmente cumprida e fila já paga em `fila_json`, misturando dois mercados no mesmo contador
  e no mesmo aprendizado;
  (b) *abrir uma segunda sessão* — impossível por construção: o índice único parcial
  `curadoria_sessoes_uma_ativa_uk` garante uma sessão ativa por operador (e é bom que garanta);
  (c) **escolhida** — a busca guiada só dispara a COLETA (mesmo `POST /prospeccao/buscar` da
  Busca avulsa) e não toca em sessão nenhuma. A sessão continua nascendo no
  `POST /curadoria/sessao`, no comando "Revisar". Consequência: decisões anteriores nunca se
  perdem, a meta nunca é consumida por uma busca, e nada é importado duas vezes (a dedup por
  `place_id` do pipeline de coleta segue sendo a única regra de importação).
- **`GET /curadoria/resumo` nasceu para o menu não custar dinheiro:** `GET /curadoria` chama
  `montarEstado`, que **remonta a fila e chama a IA** quando `fila_json` está vazio. Usar esse
  endpoint só para desenhar o menu pagaria uma explicação por abertura de modal. O `/resumo` é
  read-only e responde apenas "existe sessão? de qual mercado? em que ponto?" — sem montar fila,
  sem varrer candidatos, sem IA. Coberto por teste que falha se alguém religar a IA nesse caminho.
- **O menu diz a verdade sobre a sessão em andamento:** `iniciarSessao` já devolvia a sessão ativa
  existente **ignorando** o mercado pedido (`reaproveitada: true`) — comportamento correto, mas até
  aqui silencioso. O menu passa a rotular a opção como "Retomar a revisão em andamento" com o
  mercado e o progresso REAIS da sessão, não o que está digitado na busca. Alternativa descartada:
  encerrar a sessão automaticamente para adotar o novo mercado (destrói progresso sem pedir).
- **Lógica do fluxo em módulo PURO (`frontend/lib/assistente-entrada.js`):** passos, campos por
  tipo de ajuste, validação e rótulos ficam fora do React, no mesmo padrão de
  `ligacao-estado.js` — é o único jeito de testá-los com `node --test`, que é o runner do
  frontend (não há runner de componente React neste repositório).
- **Contexto preservado por regra, não por sorte:** `mercadoResultante` copia o contexto atual e
  só sobrescreve os campos que a pessoa escolheu mudar; `camposVisiveis` acrescenta o que estiver
  vazio no contexto, para "mudar só o nicho" nunca virar um beco sem saída na validação.
- **Nenhuma migration, nenhuma env nova, nenhum motor de busca duplicado:** `dispararBusca` é a
  única função que fala com `POST /prospeccao/buscar`, usada pelo botão "Buscar agora" e pela
  busca guiada. A trava de uma coleta paga por empresa continua no banco; o modal só a espelha
  para o clique não virar 409.

---

## 2026-08-04 — Assistente de Oportunidades POR LEAD na Busca avulsa (migration 055)

- **Curadoria sobre o já importado, não área de espera (decisão do Victor):** o pedido descrevia
  "aprovar importa o lead", mas a Busca avulsa **já importa 100%** do que coleta (worker
  `processarBuscasPlacesPendentes` → `salvarProspects`). Duas saídas eram possíveis: (a) parar a
  importação e criar uma tabela de candidatos, ou (b) curar o que já entrou. Escolhida a **(b)**:
  o pipeline de coleta fica **intocado** e "aprovar" significa mover o lead de `aguardando` para
  `aprovado` (carteira de trabalho); "descartar" o manda para `rejeitado`. Custo aceito: o lead
  descartado já ocupou a coleta paga — o que não muda nada, porque o corte por `quantidade` já
  acontecia DEPOIS do download do snapshot (o custo é da coleta, não do registro importado).
- **A meta conta CLAIM, não clique:** `aprovados` só incrementa quando o `UPDATE ... WHERE
  status = 'aguardando'` devolve linha. Repetir a ação, recarregar a página ou decidir um lead
  que já saiu da fila devolve `contou_meta=false`. Alternativa descartada: contar no frontend
  (dois cliques simultâneos furariam a meta).
- **Idempotência em dois níveis:** o CLAIM (acima) impede importação duplicada, e o índice único
  `curadoria_decisoes_sessao_lead_uk` impede registro duplicado da mesma decisão na mesma sessão.
  Tudo em UMA transação com a atualização dos contadores — nunca sobra estado pela metade.
- **Uma sessão ativa por OPERADOR, não por empresa:** índice único parcial sobre
  `(empresa_id, COALESCE(usuario_id, uuid_nulo))`. Dois admins podem curar em paralelo; a corrida
  pelo mesmo lead é resolvida pelo CLAIM, então o segundo recebe "já decidido" em vez de duplicar.
- **A fila é persistida em `fila_json`, com a explicação junto:** recarregar a página não regera
  a explicação (não repaga a IA) e não perde o ritmo. A fila só é remontada quando esvazia.
- **A IA redige, as regras decidem:** a ordem vem de `aquisicao-curadoria-ranking.js` (puro);
  a IA só transforma faixas em frase, **uma chamada por lote de 12**, não uma por lead. IA fora
  do ar não trava a sessão — o motivo determinístico assume.
- **O prompt não recebe PII:** nome, telefone, e-mail e endereço do lead nunca entram na chamada
  de IA (só faixas: tem site, faixa de nota, faixa de avaliações, completude do cadastro). Mesma
  postura do assistente por mercado; coberto por teste.
- **Aprendizado determinístico e auditável:** taxa de aprovação por característica, suavizada
  (Laplace), comparada com a taxa geral da empresa, com amostra mínima de 3 e teto de ±25 pontos.
  Sem modelo treinado e **sem configuração visível** — era requisito do produto. Consequência
  correta e testada: histórico só de aprovações ensina ZERO (nada distingue os leads).
- **Ausente ≠ zero:** `Number(null)` é 0, então "sem nota" virava `nota_baixa` e "cadastro
  desconhecido" virava `cadastro_fraco` (+25 pontos). Bug encontrado pelo próprio teste de borda
  antes de existir dado real; `num()` passou a devolver `null` para ausente.
- **Assistente por MERCADO aposentado só na UI (decisão do Victor):** a seção de sugestões de
  rotina saiu da tela de Aquisição. `prospectador.aquisicao_sugestoes`, o serviço
  `aquisicao-assistente.js` e a rota `/prospeccao/oportunidades` **permanecem** — nada foi
  apagado e as decisões já tomadas seguem consultáveis. O nome "Assistente de Oportunidades"
  passou para o assistente por lead.
- **Critérios manuais saíram da tela, os dados ficaram:** `busca_estrategia`,
  `busca_nichos_permitidos` e `busca_localizacoes_permitidas` continuam em
  `prospeccao_configuracoes` (nenhuma migration os apaga); só o formulário deixou de ser exibido.

---

## 2026-08-04 — Aquisição: rotinas contínuas de coleta (migration 053)

- **Nova entidade em vez de esticar a config única:** `prospectador.aquisicao_rotinas`
  (empresa_id + nicho + cidade + uf + dias + janela + intervalo + quantidade + ativo). A
  `prospeccao_configuracoes` NÃO foi apagada — ela ainda hospeda a Busca IA e a rotina legada de
  envio. Alternativa descartada: transformar a config única em JSONB de rotinas (perderia CHECKs,
  índices e a trava de unicidade por mercado).
- **Destino do "Automático fixo" (decisão do Victor):** rotinas cobrem só mercado FIXO; a
  **Busca IA fica como está**, no motor global. Consequência aceita: dois agendadores coexistem.
  Mitigação: a trava de "uma coleta paga por empresa" é do BANCO (índice único parcial), então
  vale para os dois motores; e `normalizarConfiguracaoProspeccao` deixou de aceitar
  `automatico_fixo` (falha fechada), impedindo que o motor antigo mire um mercado de rotina.
- **Migração dos dados (decisão do Victor):** a config fixa atual vira a 1ª rotina **PAUSADA**.
  Nenhuma coleta paga dispara sozinha no primeiro tick após o deploy; o admin revisa e ativa.
- **A trava vive no banco, não na aplicação:** `busca_snapshots_uma_ativa_por_empresa_uk`
  (índice único parcial em `status IN ('pendente','processando')`). O código anterior fazia
  `SELECT` e depois `INSERT` — janela TOCTOU que permitia duas coletas pagas simultâneas.
  Idempotência por `busca_snapshots_idempotency_uk` (chave por minuto/rotina).
- **Reserva antes de pagar:** `pesquisarPlaces` grava a linha (sem `snapshot_id`) e só então
  chama a Bright Data. Antes, o INSERT vinha DEPOIS do trigger — falha ali gerava coleta paga
  órfã. Falha no trigger marca a reserva como `falhou` para não prender a trava; reservas sem
  disparo expiram em 10 min.
- **Intervalo conta do DISPARO, não da conclusão:** uma coleta travada não pode reabrir a janela
  e gerar cobrança nova. Execuções perdidas não são compensadas (sem fila de atrasadas).
- **Fila sem estado persistido:** o scheduler escolhe UMA rotina elegível por empresa por tick
  (quem esperou mais vai primeiro); as demais continuam elegíveis no tick seguinte. Evita criar
  uma tabela de fila que envelheceria sozinha.
- **Quantidade (1..200) é teto de IMPORTAÇÃO, não de cobrança:** o trigger da Bright Data não
  recebe parâmetro de limite (não dá para validar sem chamada paga real, proibida nesta tarefa);
  o corte acontece em `adaptarRegistrosParaPlaces`. Dívida técnica registrada.
- **Pausa vence a corrida do disparo:** entre a seleção da rotina pelo worker e a reserva existe
  uma janela real. `marcarDisparo` exige `ativo = true` **no mesmo UPDATE atômico** (além do
  estado não estar em voo); zero linhas atualizadas = nenhuma chamada à Bright Data. Sem isso,
  clicar em "Pausar" ainda deixaria escapar uma coleta paga.
- **Quantidade é comunicada como teto de IMPORTAÇÃO** na tela ("Máx. de leads a importar"),
  nunca como volume coletado ou custo — a fonte pode devolver/cobrar mais antes do corte.
- **Correção de um diagnóstico anterior:** o registro dizia que a migration tratava um risco de
  janela invertida abortar o boot. Isso NÃO era alcançável: `prospeccao_configuracoes` já tem
  `CHECK (horario_fim > horario_inicio)` com ambas as colunas NOT NULL, e
  `CHECK (cardinality(dias_semana_ativos) BETWEEN 1 AND 7)`. O tratamento defensivo na migration
  ficou, mas como seguro barato — não como correção de um defeito real. O que É alcançável e a
  migration trata: `estado_padrao` é texto livre (UF inválida) e `busca_intervalo_horas` pode ser
  1..5 (abaixo do mínimo da rotina).
- **Como validar:** `npm test` backend 1111 ok (48 testes novos), frontend 27 ok, typecheck
  back/front limpos, `npm run smoke:preco`, `next build` ok.
- **Migration validada em Postgres real (2026-08-04):** (a) banco descartável com casos
  patológicos — UF inválida/1 letra vira NULL sem perder a rotina, intervalo 1h→6h, nicho/cidade
  só com espaços não gera rotina fantasma, 3 coletas em voo na mesma empresa reduzidas a 1,
  snapshots com `empresa_id` NULL preservados, migration reaplicável sem duplicar; (b) banco de
  desenvolvimento pelo caminho real de boot (`runMigrations`): a config `automatico_fixo`
  (Barbearia/SBC/SP) virou rotina **pausada** preservando janela/dias/intervalo, o modo caiu para
  `manual` e o modo `ia` de outra empresa ficou intacto. Os três índices únicos foram testados
  rejeitando: 2ª coleta em voo por empresa, chave de idempotência repetida e rotina duplicada no
  mesmo mercado (inclusive com caixa diferente).
- **Validação visual/operacional:** 33 verificações end-to-end contra o backend real com a
  Bright Data NEUTRALIZADA (token/dataset vazios), cobrindo criar/editar/pausar/retomar/remover,
  validações 400/409, autorização 401/404 e um ciclo controlado do worker. Capturas em desktop
  (1440px) e mobile (390px) sem overflow horizontal; os 6 estados foram observados na tela real.

---

## 2026-07-05 — Banco de Leads: UX de disparo (cooldown, agendados, conversa, personalização)

- **Cooldown centralizado e reutilizado:** o cronômetro do Manual e do Semi consome o MESMO
  `estadoThrottle`/`COOLDOWN_MIN` via `GET /banco-leads/cooldown` — nenhuma regra nova. Bloqueio
  client-side usa o valor do servidor; o backend continua sendo a fonte da verdade (429).
- **Instância única no Automático:** removido o campo `auto_instancia_id` duplicado da UI; o seletor
  principal da barra sincroniza `auto_instancia_id`. Sem mudança de schema.
- **Telefone → conversa:** novo `ConversaHistoricoModal` (somente leitura) reusa `GET /conversas/:numero`
  (JID `<digits>@s.whatsapp.net`), sem recriar a lógica da página de Conversas.
- **Aba "Agendados":** join cross-schema por telefone (só dígitos) entre `prospectador.prospects` e
  `app.agenda_eventos` (multiempresa, migration 011). Escolhida a tabela multiempresa (tem
  `lead_telefone`+`data_inicio`+índices) em vez da legada `vendas.agenda_eventos`. Ordena por
  `data_inicio` futuro mais próximo. Subquery correlacionada (leads limitados a 300 → custo ok).
- **Personalização enxuta:** filtros client-side (nicho/mensagem gerada) + priorizar agendados sobre a
  tabela existente. Column-visibility completa ficou como melhoria futura (evitar reescrever as tabelas).
- **Como validar:** `npm test` (825 ok), typecheck front/back, smoke (`/cooldown`, aba agendados,
  resumo com badge agendados, telefone abre modal, compila HTTP 200).

---

## 2026-07-05 — Endurecimento do fluxo do Banco de Leads (IA obrigatória, descartados, correções)

- **IA obrigatória:** com `gerar_ia` ligado a mensagem é sempre da IA; se falhar (após retries
  `SAUDACAO_IA_RETRIES`), marca **erro no status** (`erro_ia` no Semi com "Gerar de novo";
  `falhou/ia_falhou` no Manual/Auto, sem enviar) — **acabou o fallback silencioso pro template**.
- **Descartados:** nova aba com `status IN ('rejeitado','nao_contatar')` OU `tem_whatsapp=false`,
  com motivo claro; sem-WhatsApp sai de "Sem contato". Contagem por aba precisa (FILTER).
- **Automático — instância configurável** (`auto_instancia_id`, migration `023`); worker recua o
  próximo disparo em erro (back-off) evitando loop de 60s.
- **Teto unificado:** disparo usa `banco_leads_config.teto_diario` (100), não mais o env 40
  (que virou fallback) — corrige o Auto que travava em 40.
- **Escopo por instância:** GET /leads recebe `instancia_id` e só mostra o rascunho da instância
  selecionada; disparo unitário dá feedback honesto quando não há nada a enviar.
- **Impacto:** migrations 021/022/023; back-end (rodar-leads, saudacao-analise, banco-leads-auto,
  api-banco-leads, config); front-end (aba, erro/retry, seletor de instância). Reversível.
- **Como validar:** `npm test` (823 ok), typecheck front/back, smoke (resumo com descartados,
  aba descartados, PUT config com auto_instancia_id).

---

## 2026-07-04 — Disparo centralizado no Banco de Leads (Aquisição vira só busca)

- **Decisão:** A Aquisição (Google Places) deixa de disparar mensagens; passa a apenas
  **alimentar o Banco de Leads** (busca). Todo envio de WhatsApp fica no Banco de Leads.
- **Motivo:** Evitar dois motores de disparo concorrentes (o antigo diário da prospecção e o
  novo do Banco de Leads) — um só lugar de envio, mais previsível e sem duplicar mensagens.
- **Escolha:** Remover a chamada `verificarAgendaDiariaProspeccao()` do tick (`agent.js`) e o
  bloco de disparo da UI. **Não** apagar a função nem as rotas (mantidas p/ acionamento
  manual/legado) — mudança mínima e reversível. Busca agendada mantida.
- **Impacto:** back-end (1 chamada removida do tick); front-end (bloco de disparo removido,
  "Quantidade por busca" adicionado). Sem migration.
- **Riscos:** empresas que dependiam do disparo automático da prospecção param de enviar por
  ali — passam a usar o Banco de Leads. Reversível (readicionar a chamada no tick).
- **Como validar:** `npm test` (823 ok), typecheck front, página Aquisição sem controles de
  envio, worker de busca agendada segue no tick.

---

## 2026-07-04 — Banco de Leads Fase 2 (worker Automático) + selo de WhatsApp por lead

- **Decisão:** Implementar o worker do modo Automático e um selo `tem_whatsapp` por lead.
- **Worker (reuso máximo):** `src/services/banco-leads-auto.js` **não reimplementa envio/
  throttle** — a cada tick (`BANCO_LEADS_AUTO_WORKER_MS`) escolhe empresa/janela/lead e chama
  `rodarLeads` para 1 lead, herdando elegibilidade, teto, cooldown (15 min ≤ intervalo) e
  geração IA. Próximo disparo sorteado em `intervalo_min..max` e persistido em
  `auto_proximo_disparo_em` (migration `022`). Instância = a ativa mais recente da empresa.
- **Selo WhatsApp:** coluna `prospects.tem_whatsapp` (migration `021`), aprendida do resultado
  do disparo — reusa `classificarErroEvolution` (`tipo:'numero_inexistente'` ⇒ `false`; envio
  ok ⇒ `true`). Lead `false` sai da elegibilidade (não reabordar) e ganha rótulo "sem WhatsApp";
  `true` ganha ícone verde. Evita verificação extra na Evolution (custo zero adicional).
- **Alternativas:** verificar número via `chat/whatsappNumbers` antes de enviar (descartado:
  chamada extra por lead) vs aprender do envio (escolhido, sem custo).
- **Impacto:** banco (2 colunas via migrations 021/022); back-end (worker + config estendida +
  `rodar-leads` grava `tem_whatsapp`); front-end (config do Auto, coluna telefone com selo).
- **Riscos:** worker dispara sozinho quando `auto_ativo` — kill-switch é o próprio toggle; teto
  100 + janela + intervalo limitam volume. Em teste local, manter em Manual.
- **Como validar:** `npm test` (823 ok, inclui `banco-leads-auto.test.js`), typecheck, smoke
  do PUT `/config` com campos do Auto (janela/intervalo persistem, clamp 15–30, teto fixo 100).

---

## 2026-07-04 — Banco de Leads: modos de disparo Manual / Semi / Automático (Fase 1)

- **Decisão:** Transformar o Banco de Leads em central de disparo com 3 modos, começando
  por Manual + Semiautomático (Automático fica para a Fase 2).
- **Motivo:** Dar controle de cadência ao operador (enviar na hora, ou gerar por IA e
  disparar depois) reusando o motor de saudação existente.
- **Alternativas consideradas:** (a) reusar o motor de modos da Prospecção/Places
  (`prospeccao_configuracoes`); (b) config por instância; (c) config por empresa.
- **Escolha:** **config por empresa** em `app.banco_leads_config` (migration `020`), tabela
  nova e isolada — **não** reusar o motor do Places (evita acoplar dois produtos). Geração
  por IA num serviço novo `saudacao-analise.js` (desenho da spec `2026-07-03`), sempre com
  fallback pro template. Estado novo `lead_disparos.status='aguardando_disparo'` para o Semi
  (coluna `status` é TEXT sem CHECK → sem alteração de constraint).
- **Números do Automático:** teto **100/dia é só limite de segurança**; volume real é
  limitado pelo intervalo 15–30 min × janela. Campos do Auto criados já na migration 020
  (inertes até o worker da Fase 2).
- **Cadência de disparo:** cooldown de **15 min por instância em qualquer disparo** (manual
  ou dos gerados) — antes disso a rota retorna 429 com aviso. Decisão do Alex: bloquear +
  alertar em qualquer disparo (não só em lote). `RODAR_LEADS_COOLDOWN_MIN` default 5 → **15**.
- **Impacto:** banco (1 tabela + 1 índice parcial); back-end (`rodar-leads.js`,
  `api-banco-leads.js`, `db/banco-leads-config.js`, `saudacao-analise.js`); front-end
  (`banco-leads/page.tsx`); custo (+1 chamada IA por lead gerado, com kill-switch `gerar_ia`).
- **Riscos:** custo/latência da geração por IA (mitigado por fallback + timeout
  `SAUDACAO_IA_TIMEOUT_MS`); Automático ainda não dispara nada (worker pendente).
- **Como validar:** `npm test` (815 ok, inclui `saudacao-analise.test.js` e novos casos em
  `rodar-leads.test.js`), `npm run typecheck` (back + front), smoke dos endpoints
  `/config`, `/gerar`, `/disparar-gerados`.

---

## 2026-07-04 — Adoção do Workflow Padrão de IA v2.0

- **Decisão:** Formalizar os documentos de governança de workflow no repositório
  (`ai-workflow.md`, `ai-task-start-log.md`, `ai-decision-log.md`, `project-change-map.md`,
  `ui-visual-standard.md`, `project-architecture.md`).
- **Motivo:** Garantir que toda IA siga um processo padrão (Fase 0 → 11) com registro
  formal, verificação visual/UX e confirmação de arquitetura.
- **Alternativas consideradas:** (a) manter só AGENTS.md/CLAUDE.md; (b) duplicar o conteúdo
  visual e de arquitetura nos novos arquivos.
- **Escolha:** `ui-visual-standard.md` e `project-architecture.md` **referenciam** os
  documentos canônicos já existentes (`GUIA-VISUAL-PJ-CODEWORKS.md`, `project-map.md`,
  `architecture-rules.md`) em vez de duplicar, respeitando a regra "não duplicar".
- **Impacto:** Apenas documentação; nenhum código de produção alterado.
- **Riscos:** Baixo. Manter os arquivos em sincronia quando a arquitetura/visual evoluir.
- **Como validar:** Leitura dos arquivos; próxima tarefa deve começar pela Fase 0.

---

<!-- Modelo para novas entradas:

## [DATA] — [Título curto da decisão]

- **Decisão:**
- **Motivo:**
- **Alternativas consideradas:**
- **Escolha:**
- **Impacto:** (banco / back-end / front-end / financeiro / dashboards / permissões / manutenção futura)
- **Riscos:**
- **Como validar:**

-->

---

## 2026-07-15 - Performance do Banco de Leads, Evolution e pool PostgreSQL

- **Decisao:** Consolidar os metadados do `GET /leads` em `LEFT JOIN LATERAL`, executar
  os status da Evolution em paralelo com cache de 20 segundos por empresa, criar indices
  parciais para os caminhos quentes e elevar o pool padrao de 2 para 4 conexoes.
- **Motivo:** Reduzir scans repetidos por lead, latencia serial da Sidebar e contencao entre
  dashboard, webhooks e workers sem alterar contratos HTTP ou regras de negocio.
- **Alternativas consideradas:** manter subqueries separadas; cachear status por instancia;
  apenas aumentar o pool; criar um indice completo sem predicado parcial.
- **Escolha:** tres laterais especializados (ultimo disparo, rascunho e agenda), cache curto
  com coalescencia de requisicoes simultaneas, migration `025` aditiva e telemetria de
  `pool.waitingCount`. O pool continua configuravel por `POOL_MAX` para multi-replica.
- **Impacto:** back-end e banco; sem mudanca visual, de permissao, prompts ou payloads.
- **Riscos:** cache pode refletir estado da Evolution com ate 20 segundos de atraso; em
  multi-replica, a soma de `POOL_MAX` deve respeitar o limite total do PostgreSQL.
- **Como validar:** testes unitarios de paralelismo/cache, `npm test`, `npm run typecheck`,
  migration executada no PostgreSQL local e `EXPLAIN (ANALYZE, BUFFERS)`.

---

## 2026-07-15 - Seguranca de disparo Manual, Semi e Automatico

- **Decisao:** Tornar a reserva de um lead uma invariante do PostgreSQL, serializar
  cooldown/teto por instancia e considerar entrega concluida somente em
  `DELIVERY_ACK`, `READ` ou `PLAYED`.
- **Motivo:** Impedir mensagem e chamada de IA duplicadas entre abas, ticks e replicas,
  sem manter transacao aberta durante chamadas lentas de IA ou Evolution.
- **Alternativas consideradas:** lock apenas em memoria; advisory lock durante todo o
  envio; confiar apenas no cooldown; tratar `SERVER_ACK` como sucesso.
- **Escolha:** migration `026` com indice parcial unico por `prospect_id`; transacoes
  curtas com `FOR UPDATE` da instancia; estados `gerando` e `pendente_confirmacao`;
  reconciliacao pelo `MessageUpdate`; lease renovavel em `vendas.watcher_locks` para o
  worker; reuso de `canProspectLead` no modo `complianceOnly` e fuso via `Intl`.
- **Impacto:** banco, worker, integracao Evolution, elegibilidade e texto/default do teto.
  O teto fixo volta de 100 para 40, incluindo backfill dos registros com o default antigo.
- **Riscos:** um envio sem `evolution_message_id` apos interrupcao fica pendente para
  revisao, por seguranca, em vez de ser reenviado automaticamente.
- **Como validar:** testes de reserva concorrente, opt-out, WhatsApp falso, `SERVER_ACK`,
  reconciliacao terminal, timezone e reentrancia; migration real e verificacao dos indices.

---

## 2026-07-17 - Busca automática independente e teto de 200 na Aquisição

- **Decisão:** Fazer a agenda de busca depender exclusivamente de `agendamento_busca_ativo` e
  aplicar no backend o teto fixo de 200 resultados importados por snapshot do Google Maps.
- **Motivo:** O campo `ativo` pertence à rotina legada de disparo e não existe mais na interface
  da Aquisição; reutilizá-lo deixava a tela indicar agenda ativa enquanto o worker ficava parado.
- **Alternativas consideradas:** religar `ativo=true` ocultamente no frontend; remover o gate sem
  separar responsabilidades; adicionar migration para armazenar quantidade variável por snapshot.
- **Escolha:** flag próprio da busca + constante de domínio no adapter Bright Data; sem migration.
  A UI reaproveita o padrão operacional do Banco de Leads em seções inline, sem modal ou ações duplicadas.
- **Impacto:** backend, worker, custo/volume importado e frontend Google Maps/Instagram; nenhuma
  alteração em autenticação, secrets, prompts ou envio de WhatsApp.
- **Riscos:** o modo Discover da Bright Data pode produzir mais de 200 registros antes do download;
  o aplicativo importa apenas 200, mas a cobrança externa deve ser acompanhada no painel do provedor.
- **Como validar:** testes do teto 306→200, scheduler com `ativo=false`, typecheck e inspeção visual local.

---

## 2026-07-17 - Busca IA configurável com limites de custo e estados operacionais

- **Decisão:** Substituir a automação implícita por três modos explícitos (`manual`,
  `automatico_fixo`, `ia`) e persistir preferências e estado operacional por empresa.
- **Motivo:** Tornar o comportamento compreensível para o operador, impedir buscas concorrentes
  e permitir que a IA troque de mercado sem esconder custo, limite ou motivo da decisão.
- **Alternativas consideradas:** manter um único toggle; guardar preferências apenas no frontend;
  deixar a IA escolher sem listas; criar campanhas separadas para cada mercado.
- **Escolha:** migration `027`; intervalo mínimo de 6 horas; máximo configurável de 1 ou 2
  buscas/dia; uma coleta ativa; estratégias conservadora/equilibrada/exploratória; listas
  opcionais de nichos e regiões; dois resultados sem leads novos esgotam o modo fixo e fazem
  a IA escolher outro mercado. Falha do seletor pausa o ciclo e expõe uma mensagem acionável.
- **Impacto:** banco, seletor LLM, scheduler, worker de snapshots, API e menu inline da Aquisição.
  Sem mudança em autenticação, segredos, prompts de produção ou envio de WhatsApp.
- **Riscos:** o controle de concorrência consulta snapshots ativos e pressupõe uma réplica do
  worker; um provedor pode cobrar registros além dos 200 importados pelo aplicativo.
- **Como validar:** migration real, testes puros de agenda/resultado, suíte completa, typecheck,
  contrato HTTP autenticado e inspeção visual desktop/mobile sem disparar coleta.

---

## 2026-07-20 - Central de Follow-ups com pausa forte e registro consistente

- **Decisao:** Tratar `app.followup_config.pausado` como bloqueio efetivo do modo Automatico tanto no watcher quanto no executor de jobs ja enfileirados; restringir o envio complementar pos-ligacao ao resultado `nao_atendeu`; registrar `sem_interesse` e a pausa do lead em uma unica operacao SQL.
- **Motivo:** Evitar envio depois de uma pausa administrativa, combinacoes comerciais contraditorias e estado parcial entre historico da ligacao e opt-out do lead.
- **Alternativas consideradas:** cancelar definitivamente todos os jobs ao pausar; validar apenas no frontend; manter INSERT e UPDATE em queries separadas; abrir transacao explicita na rota.
- **Escolha:** O job pausado volta para `pending` com atraso de cinco minutos e sem consumir tentativa; backend e banco protegem as invariantes; uma CTE modificadora mantem o registro atomico sem transacao longa.
- **Impacto:** back-end, worker, banco, tela de Follow-ups e metricas de IA por tenant; sem nova dependencia, segredo ou prompt.
- **Riscos:** jobs pausados continuam visiveis como pendentes e sao revisitados periodicamente; a migration `031` exige que `029/030` tenham sido executadas antes, como ja ocorre pela ordem do migrador.
- **Como validar:** testes focados de rotas, ligacoes, watcher e ai-provider; `npm test`; typecheck de backend/frontend; aplicacao das migrations e boot local.

---

## 2026-07-20 - Atendimento humano com proxima acao deterministica

- **Decisao:** Renomear o modo Semi para Atendimento humano e recomendar uma unica proxima acao por lead: assumir handoff, ligar, revisar proposta, escrever manualmente ou copiar um prompt de preview para uso externo.
- **Motivo:** Ligacao e apenas um dos caminhos humanos. Handoff, contexto comercial, tentativas ignoradas, proposta e oportunidade visual pedem orientacoes diferentes e uma janela adequada.
- **Alternativas consideradas:** manter apenas score de ligacao; deixar a IA escolher toda acao; gerar o preview dentro do produto.
- **Escolha:** Regras deterministicas e auditaveis no backend, com prioridade explicita. A IA permanece no roteiro de ligacao. Preview nao e gerado nem enviado: o operador apenas copia um prompt contextualizado, gera fora do projeto e revisa o resultado.
- **Impacto:** servicos `followup-call-score`/`followup-listing`, contrato de leitura da rota existente, tela e testes; sem banco, auth, segredo, integracao externa ou prompt de producao.
- **Riscos:** a qualidade da recomendacao depende dos sinais ja coletados no perfil; por seguranca, o prompt proibe inventar dados comerciais e exige contexto minimo antes de aparecer.
- **Como validar:** testes unitarios das prioridades e janelas, teste da listagem/SQL, consulta read-only ao banco, suite completa, typechecks e verificacao das rotas em execucao.

---

## 2026-07-20 - Resolver MessageUpdate pelo schema real da Evolution

- **Decisao:** Detectar por `to_regclass` se a tabela `MessageUpdate` esta em `evolution`
  ou `public` antes da checagem e reconciliacao dos disparos.
- **Motivo:** O Railway usa o schema `evolution`, enquanto o Docker local existente configura
  a Evolution com `schema=public`; o nome hardcoded em `public` abortava todos os ticks.
- **Alternativas consideradas:** fixar `evolution` e quebrar o ambiente local; criar nova
  variavel de ambiente; criar view/migration de compatibilidade; consultar schemas arbitrarios.
- **Escolha:** Resolver somente os dois schemas conhecidos e retornar nomes de tabela hardcoded,
  sem interpolar entrada externa nem introduzir configuracao operacional.
- **Impacto:** leitura da integracao Evolution e worker do Banco de Leads; nenhum impacto em
  banco/schema, auth, segredos, prompts, frontend ou contratos HTTP.
- **Riscos:** se a Evolution mudar para um terceiro schema, a aplicacao falhara explicitamente
  com `evolution_message_update_missing` em vez de ignorar confirmacoes.
- **Como validar:** cobertura dos schemas `public`/`evolution`, ausencia dos dois, suite
  completa, typecheck, deploy Railway e tick real sem `tick falhou`.

---

## 2026-07-22 - Catalogo estruturado de servicos por contexto

- **Decisao:** Criar `app.contexto_servicos` como fonte estruturada e editavel de ofertas por
  contexto, preenchida pelo `Gerar tudo` antes do playbook e injetada em `playbook.servicos`.
- **Motivo:** O campo textual `servicos_produtos` e o array livre do playbook nao davam garantia
  de separacao correta entre ofertas distintas. Sites que citam SEO, criacao de site e sistemas
  precisam virar tres itens rastreaveis, preenchiveis e revisaveis.
- **Alternativas consideradas:** guardar tudo dentro de `contexto_form_json`; confiar apenas no
  prompt do playbook; adiar a decisao de oferta por lead para uma fase separada.
- **Escolha:** Tabela aditiva com `slug` unico por contexto, status de revisao, confianca,
  fontes/conflitos em JSONB e merge que preserva item revisado. O runtime tambem passa a registrar
  `servicos_interesse_slugs`, ultimo servico recomendado/oferecido e eventos em
  `app.lead_servico_decisoes`.
- **Impacto:** banco, pipeline de IA, rotas autenticadas de contexto, editor Next.js e testes.
  Sem nova dependencia, segredo, permissao ou envio automatico.
- **Riscos:** a qualidade inicial depende da extracao das fontes; lacunas ficam visiveis como
  `precisa_revisao` em vez de serem inventadas.
- **Como validar:** testes de separacao de catalogo e injecao no playbook, suite completa,
  typechecks de backend/frontend e validacao visual do editor apos login.

## 2026-07-22 - Rastreio de decisao de servico no Contexto 2 runtime

- **Decisao:** Estender o runtime do playbook para pedir slugs canonicos de servico e gravar a
  trilha de `interesse_detectado`, `recomendado` e `oferecido`.
- **Motivo:** Sem slug persistido, a IA ate poderia citar um servico na mensagem, mas o operador
  nao conseguiria auditar depois qual oferta ela escolheu nem correlacionar esse dado por lead.
- **Escolha:** Campos aditivos em `app.lead_insights` para snapshot atual e tabela append-only
  `app.lead_servico_decisoes` para historico. O responder tambem persiste `decisao.atualizar_perfil`
  geral, incluindo `produto_sugerido`.
- **Impacto:** migration `034`, `contexto2-runtime.js`, `contexto2-responder.js` e testes.
- **Riscos:** catalogos antigos sem slug/id ainda funcionam por normalizacao textual, mas a
  confianca operacional melhora quando o catalogo foi gerado/revisado pelo fluxo novo.
- **Como validar:** testes focados de normalizacao, registro de decisao e persistencia de perfil,
  depois suite completa e typecheck do backend.

## 2026-07-22 - Feedback de conversa como aprendizado supervisionado

- **Decisao:** Registrar feedback humano em respostas do agente como auditoria append-only e,
  no caso negativo, criar apenas sugestao pendente para o Playbook ativo.
- **Motivo:** Uma conversa isolada nao deve reescrever automaticamente o atendimento inteiro.
  O operador precisa ver evidencia, rascunho e diff antes de ativar qualquer mudanca.
- **Escolha:** Nova tabela `app.conversa_feedbacks`, vinculo opcional em
  `app.empresa_contexto_sugestoes`, UI no hover de mensagens `assistant` em Conversas e revisao
  em Contextos. A aplicacao sob demanda continua usando `aplicarSugestaoComoDraft`.
- **Impacto:** front-end, rota autenticada, service de conversa e banco `app`; sem alteracao em
  prompts globais, Contexto 1, catalogo de servicos, mensagens automaticas, segredos ou WhatsApp.
- **Riscos:** feedbacks positivos ficam como auditoria para uma fase futura; sugestoes negativas
  dependem de Playbook ativo para serem aplicaveis.
- **Como validar:** testes de feedback positivo/negativo/bloqueios, teste de Contexto 2, suite
  completa e typechecks de backend/frontend.

## 2026-07-30 - Central de Ligacoes: fonte unica de interesse e duracao honesta

- **Decisao:** Antes de iniciar a Central de Gestao Comercial, corrigir a ORIGEM dos dados:
  (1) unificar as marcas 🟢/🔴 em `app.ligacao_sinais`; (2) separar o fim da chamada do momento
  do save; (3) remover o caminho legado `POST /api/empresas/:id/ligacoes` e expurgar seu passivo;
  (4) completar `app.vw_ligacoes_analiticas` com texto e identidade.
- **Motivo:** a validacao operacional mostrou que 3 numeros que o painel exibiria estariam
  errados. As marcas viviam so na memoria do React (`ligacao_etapa_eventos` so era gravado no
  encerrar), entao um refresh zerava `etapa_maior_interesse`/`etapa_perda_interesse`. A
  `duracao_seg` era medida no instante do POST /encerrar, mas o botao "Encerrar ligacao" apenas
  ABRE o formulario — todo o tempo de preenchimento entrava na duracao da ligacao E da ultima
  etapa. E o caminho legado gravava encerradas com duracao vinda do cliente e zero etapas.
- **Escolha:** interesse/resistencia passam a ter UMA fonte (`ligacao_sinais`), ja persistida no
  clique; `etapa_maior_interesse`/`etapa_perda_interesse` viram DERIVACAO no servidor
  (`derivarEtapasDeSinais`), nao mais estado do cliente. Nova coluna `chamada_encerrada_em`
  (migration 049) alimenta `duracao_seg` e o fechamento da ultima etapa no MESMO instante.
  A tabela `ligacao_etapa_eventos` nao e' dropada (historico), so deixa de receber escrita.
- **Impacto:** migrations `049/050/051`, `src/db/ligacoes.js`, `src/db/ligacao-etapas.js`
  (`fecharEtapaAtiva` ganha `momento` opcional), `src/routes/api-ligacoes.js`,
  `frontend/app/dashboard/central-ligacoes/page.tsx`, `frontend/lib/ligacao-sinais-resumo.js`
  (substitui `ligacao-marcas`). Sem novo env, segredo, prompt de producao ou dependencia.
- **Riscos:** a migration `050` APAGA linhas e roda automatica no boot (`runMigrations`) — por
  isso arquiva antes em `app.ligacoes_legado_arquivo`. O discriminante e' `status='encerrada'
  AND duracao_seg IS NULL AND sem ocorrencia em ligacao_etapas`: os dois criterios JUNTOS, porque
  `0 etapas` isolado apagaria ligacoes legitimas de campanha sem roteiro publicado.
  `etapa_alcancada` segue vindo do cliente (redundante com `etapa_final` da view) — nao foi
  alterado para manter o diff minimo.
- **Como validar:** `npm test` (backend 1044, frontend 15), typecheck de backend e frontend, e
  cenario ponta a ponta contra o router real: 20/20, com prova de que conversa de 3s + 4s de
  preenchimento grava `duracao_seg = 3s` e ultima etapa = 3s.

## 2026-08-04 - Aquisicao: hierarquia da tela (coleta -> leads -> consulta) com abas de resultado

- **Decisao:** reorganizar a pagina de Aquisicao (aba Google Places) sem alterar comportamento:
  (1) manter Rotinas de coleta e Busca avulsa no topo; (2) deixar o Assistente de Oportunidades
  discreto, com as "Preferencias do assistente" recolhidas DENTRO do card, sob "Configurar
  criterios"; (3) promover a lista de leads a conteudo principal; (4) reunir os blocos
  analiticos numa secao "Acompanhar resultados" com tres abas (Desempenho por mercado,
  Respostas recentes, Historico de coletas).
- **Motivo:** a tela empilhava cinco blocos de peso visual parecido (rotinas, assistente,
  preferencias, leads, dois cards analiticos + "Atividade recente"), competindo pela atencao.
  A prioridade operacional e' configurar a origem, ver os leads e so entao consultar resultado.
- **Escolha tecnica:** o "Historico de coletas" (antiga "Atividade recente") saiu de
  `RotinasAquisicao` e virou `components/HistoricoColetas.tsx`, alimentado pelos MESMOS dados que
  a pagina ja recebia via `onDados` — nenhuma requisicao nova. As abas viraram
  `components/ui/Abas.tsx` (padrao WAI-ARIA tabs: `role=tablist/tab/tabpanel`, `aria-selected`,
  roving tabindex, setas/Home/End, foco visivel), com o mesmo visual do seletor de sessoes ja
  usado em `dashboard/aquisicao`. As preferencias continuam sendo estado da pagina e sao
  injetadas no assistente pela prop `criterios` (ReactNode), para nao mover regra nenhuma para
  dentro do componente do assistente. O card "Analytics da prospeccao" deixou de ser bloco solto
  e virou o sub-bloco "Sinais comerciais" da aba Desempenho, evitando metrica repetida na tela.
- **Impacto:** apenas frontend. `dashboard/prospeccao/page.tsx`, `RotinasAquisicao.tsx`,
  `AssistenteOportunidades.tsx` + os dois componentes novos. Sem backend, migration, env, rota,
  permissao, prompt ou dependencia nova. A troca de aba nao dispara fetch nem reseta filtro,
  busca, ordenacao ou estado da tabela (a aba e' estado local isolado).
- **Riscos:** a aba inicial e' sempre "Desempenho por mercado"; sem dados ela mostra estado vazio
  util em vez de sumir — decisao consciente para a secao nao "piscar" entre existir e nao existir.
  O texto do cabecalho da pagina deixou de citar "worker" (termo interno de infraestrutura).
- **Como validar:** `npm run typecheck` e `npm run build` no `frontend/`; abrir a Aquisicao,
  conferir a ordem dos blocos, abrir "Configurar criterios", trocar as tres abas com e sem dados
  e confirmar que filtros/ordenacao/busca da tabela sobrevivem a troca de aba, em desktop e mobile.
