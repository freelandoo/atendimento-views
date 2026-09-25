# Registro de decisões técnicas da IA

Registro das decisões técnicas e arquiteturais relevantes tomadas ao longo do projeto
(Fase 8 do [workflow padrão](ai-workflow.md)). Objetivo: evitar que decisões fiquem só no
chat e se percam, e que a próxima IA redescubra tudo do zero. Entradas em ordem
cronológica inversa (mais recente no topo).

> Registre aqui: nova tabela/campo/migration, novo módulo, nova dependência, mudança de
> arquitetura de pastas/rotas/services/APIs, refatoração grande, mudança em
> financeiro/assinatura/dashboard/permissão/integração, ou criação de um novo padrão visual.

---

## 2026-09-21 — Aprovar e distribuir lote da Aquisição

**Contexto:** a busca da Aquisição continua sendo coleta/triagem. O operador pediu uma ação
explícita para liberar um lote recém-triado, como "200 leads de energia solar", e distribuir
esses leads para a equipe certa sem criar gatilho automático em toda busca.

**Decisão 1 — sem redistribuição automática na busca.** A busca não dispara redistribuição.
A nova ação vive na tela de Aquisição como "Aprovar e distribuir", com prévia e confirmação
humana. Assim o operador decide quando um lote está pronto para entrar no Comercial.

**Decisão 2 — lote fechado por IDs, não por consulta aberta.** A execução recebe IDs
selecionados ou o recorte atual da tela. Ela não puxa qualquer lead livre do nicho no momento
da confirmação, evitando misturar leads antigos com o lote recém-liberado.

**Decisão 3 — mesmo critério conservador da distribuição existente.** A elegibilidade usa
`nicho_id` estruturado, equipe ativa, participantes ativos, lead sem responsável, sem conversa
aberta, sem reunião futura, sem follow-up aberto e sem trabalho anterior. A aprovação em lote
só altera prospects ainda em status iniciais (`coletado`, `contato_encontrado`, `aguardando` ou
`rejeitado`); status avançado não é rebaixado.

**Decisão 4 — permissão combinada.** As novas rotas exigem triagem e transferência de lead:
`LEAD_TRIAR` + `LEAD_TRANSFERIR`. Isso mantém o fluxo fora do perfil comercial operacional e
preserva o responsável no backend; a mudança visual não remove a regra de ownership.

## 2026-09-17 — Régua operacional de ICP/score não substitui a porta humana

**Contexto:** o operador quer que sinais de Google Meu Negócio, Instagram, telefone, site,
duplicidade e opt-out influenciem a qualidade do lead e digam quando a validação precisa ser
humana, automática ou mista. As mesmas pistas aparecem em Aquisição, Banco de Leads, modal de
detalhes/ICP e Central de Ligações.

**Decisão 1 — novo módulo derivado, separado da porta de abordagem.**
`backend/src/services/lead-qualificacao-score.js` calcula `score_100`, validação, bloqueios,
penalidades, revisões e sinais. Ele **não** altera `backend/src/services/lead-qualificacao.js`,
que continua sendo o módulo da porta humana/estrita usada para decidir se um lead pode ser
abordado. Isso evita confundir "lead aprovado por pessoa" com "lead parece bom/ruim pelos
sinais automáticos".

**Decisão 2 — sem migration e sem backfill.** A régua é derivada dos dados já existentes e é
anexada nas respostas (`qualificacao`/`qualificacao_resumo`) ou usada em cálculos de prioridade.
Não há coluna nova, não há mutation histórica e não há coleta paga/external call para pontuar.

**Decisão 3 — penalidade é explicável e pode exigir revisão.** Casos como Google fechado,
opt-out, bloqueio e duplicidade bloqueiam automaticamente. Casos como telefone inválido,
Instagram/Google parados juntos, oferta de site novo com site próprio identificado ou atividade
antiga forte não descartam sozinhos: baixam o score e elevam a régua para validação humana ou
automática + humana.

**Decisão 4 — front só traduz o veredito.** `frontend/lib/lead-icp.js` centraliza rótulos e
fallback visual simples, mas prefere sempre o resumo vindo do backend. As telas de Aquisição,
Banco de Leads e o modal de detalhes mostram o mesmo vocabulário, para não criar scores
paralelos por tela.

**Decisão 5 — o score existente passa a absorver a régua, sem virar filtro único.**
`prospecting.js` aplica as penalidades no `score_v2`; `ligacao-prioridade.js` reduz ou bloqueia
a prioridade de ligação quando a régua aponta risco forte. A elegibilidade final continua
preservando as travas já existentes de campanha, triagem e contato.

## 2026-09-12 — Isolamento do Comercial: ALCANCE ≠ ESCOPO (CRM em equipe, Etapa 13)

Contexto: um usuário `comercial` foi criado em produção e o Banco de Leads abriu **vazio**. A
análise achou o defeito e mais três lacunas da mesma família. Detalhe completo em
`docs/plano-execucao-crm-equipe.md` §5-bis e no bloco correspondente do `AGENTS.md`.

**Decisão 1 — separar ALCANCE de ESCOPO.** O escopo é o filtro que a TELA pediu; o alcance é o
LIMITE de quem olha. As Etapas 4 e 7 só tinham escopo, e por isso a Central de Mensagens não
isolava ninguém. As rotas aplicam os dois com `AND`; um filtro de tela nunca amplia o limite.
*Alternativa recusada:* endurecer o escopo. Ela confundiria "o operador escolheu ver só os seus"
com "o operador só pode ver os seus" — e foi essa confusão que zerou o Banco de Leads.

**Decisão 2 — o padrão do vendedor no Banco de Leads é "meus + LIVRES".** A Etapa 4
deliberadamente não faz backfill de responsável, então `meus` como padrão devolvia zero linha
para todo comercial. É a mesma regra que `conversa-responsavel.js` já aplicava.
*Alternativa recusada:* fazer backfill de responsável. Inventaria dono retroativo — exatamente o
que as migrations 058 e 060 removeram deste repositório.

**Decisão 3 — o recorte de conversa passa a usar a INSTÂNCIA.** `responsavel_id` exige claim
manual e nada o popula; o webhook, esse sim, grava a instância que recebeu a mensagem, e a
instância tem responsável desde a migration 075. Três parcelas: atribuída a mim · chegou pelo meu
número · sem dono e o número não é de mais ninguém.
*Alternativa recusada:* recorte estrito por instância. Esconderia a fila do número compartilhado
da empresa, e conversa que ninguém vê é cliente sem resposta.
⚠️ Isto **não** toca a resolução de instância de ENVIO — invariante 2, com guarda em 3 arquivos.

**Decisão 4 — as rotas por id repetem o recorte da listagem, com 404.** Esconder na lista e
liberar por id é segurança por obscuridade. 404 e não 403: dizer "existe, mas não é sua" já
entrega que aquele contato fala com a empresa.

**Decisão 5 — o conhecimento (contexto) é da administração.** Os 4 routers de contexto estavam
sem gate nenhum além de `requireAuth`. Ganharam `INSTANCIA_GERENCIAR_CONTEXTO`, e o campo
`contexto_id` do `PATCH /whatsapp/:id` também — gate condicional, para o vendedor não perder o
direito de renomear o próprio número.

**Decisão 6 (do operador) — a porta da Central de Ligações virou ESTRITA.** Só `aprovado`;
`legado` não passa mais, nem na entrada da campanha nem na fila.
⚠️ **Consequência declarada antes e reafirmada: a fila fica VAZIA até alguém triar** — os 4.268
leads do acervo nascem `legado` na migration 071. A tela explica isso em texto
(`meta.aguardando_triagem`) em vez de dizer "todos já foram trabalhados".
Os quatro pontos de **disparo** (WhatsApp/e-mail) continuam em `sqlAbordavel`: mudá-los pararia a
operação inteira e não foi o que se pediu.

**Decisão 7 (do operador) — no Banco de Leads o Comercial vê tudo MENOS o descartado.** A porta
da LEITURA é mais frouxa que a da ABORDAGEM, de propósito.

**Decisão 8 — cardinalidade empresa × usuário × instância: 1..N e 0..N, sem constraint.** "Uma
instância por comercial" é regra operacional correta e constraint errada: zero precisa ser válido
(a conta nasce antes de conectar), `usuario_id IS NULL` é o número compartilhado e é o caso
normal, e `/substituir` cria instância nova — durante a troca o vendedor legitimamente tem duas.
O isolamento vem de `usuario_id` preenchido, e funciona igual para 1 ou N.

**Dívida técnica declarada:** a fila de ligações permanece vazia até a curadoria rodar sobre o
acervo (consequência aceita da Decisão 6).


## 2026-09-11 — CRM em equipe: as TELAS das Etapas 3 a 12 (o front só traduz)

- **Gatilho:** o backend das 12 etapas estava pronto e testado, e **nenhuma tela existia**. Uma
  regra que só vive na API é uma regra que o operador não vê: a porta de qualificação, o dono do
  lead e a diferença entre entrega confirmada e declaração do vendedor não tinham como aparecer.
- **Decisão 1 — três módulos PUROS novos, e nenhuma regra no front.** `lib/lead-operacao.js`
  (Etapas 3/4/5), `lib/conversa-operacao.js` (Etapa 7) e `lib/equipe-painel.js` (Etapa 12). Eles
  ordenam, rotulam e explicam; não decidem. Cada um tem guarda de regressão que falha se SQL, a
  matriz de capacidades ou um recálculo de regra aparecer ali — o mesmo contrato de
  `lib/site-rotulos.js` e `lib/capacidades.js`.
- **Decisão 2 — o painel de conversa AVISA, nunca barra.** `avisoDeAtendimento` devolve
  `podeResponder: true` **sempre**, inclusive na conversa de outra pessoa, e o teste cobra a
  **ausência** de qualquer função de bloqueio. É a tradução fiel de `avaliarResponder`: travar a
  resposta deixaria o CLIENTE sem resposta porque o sistema decidiu que a pessoa errada estava na
  tela. O que a conversa alheia ganha é uma frase acima do compositor, com o nome de quem é.
- **Decisão 3 — `bloqueio` é prop NOVA em `AlternadorModoIa`, e não um reuso de `ocupado`.**
  `ocupado` é bloqueio temporário e mostra "Atualizando…"; `bloqueio` é permanente e mostra **o
  motivo em texto**, também no `aria-label`. Reusar `ocupado` faria o controle afirmar que está
  salvando quando, na verdade, a pessoa não tem permissão. O mesmo veredito
  (`conversa_gerenciar_ia`) governa o padrão global, a exceção por conversa e o pausar/retomar
  agente — deixar um sem gate tornaria os outros decorativos.
- **Decisão 4 — desabilitar com motivo × sumir, e quando cada um cabe.** O controle de IA fica
  **visível e desabilitado** (há uma decisão de produto que a pessoa precisa entender);
  "Deletar histórico" **some** (não há decisão a explicar no lugar, e um botão vermelho inerte só
  convida ao clique). A regra geral do projeto continua: botão sumido sem explicação é o que faz
  o operador achar que a tela quebrou — por isso todo lugar onde some há um motivo escrito ao
  lado (`motivoSemAssumir`).
- **Decisão 5 — o painel da equipe não vira placar.** As quatro contagens medem coisas
  diferentes e **não se somam**: cada coluna declara `oQueMede`, e `ligacoes` fica FORA da carga
  atual porque é acumulado — somá-lo faria quem trabalha há mais tempo parecer sobrecarregado
  hoje. A linha do tempo de auditoria aparece crua, **sem nenhum agregado**, porque a migration
  047 declara que auditoria não é fonte de dashboard. Guarda de regressão falha se `ranking`,
  `produtividade`, `media(`, `percentual` ou `score` aparecerem no módulo.
- **Decisão 6 — o trabalho SEM DONO é linha própria, e quem foi desativado continua listado.**
  Ele não é anomalia (lead livre e conversa não atribuída são filas legítimas), mas é o que o
  admin abre o painel para redistribuir; omiti-lo faria a soma das linhas não fechar com o total.
  E desativar alguém **revoga o acesso sem redistribuir nada** — sem o aviso de "ainda com X na
  mão", a carteira ficaria parada sem ninguém notar.
- **Decisão 7 — recorte do SERVIDOR é sempre DECLARADO na tela.** Conversas, ligações e agenda
  recortam no backend; a tela diz "só as suas" / "Mostrando as suas e as não atribuídas".
  Recortar em silêncio faria o vendedor achar que perdeu histórico. Já o atalho **"Meus"** da
  Central de Follow-ups é o oposto: filtro de TELA, ligado pela pessoa, porque aquela fila tem
  visibilidade GERAL por decisão de produto (decisão D da especificação).
- **Decisão 8 — duas mudanças de BACKEND nasceram da tela, e as duas reusam o que existe.**
  (a) `api-conversas.js` ganhou `LEFT JOIN app.usuarios` na listagem e no detalhe: avisar "está
  com outra pessoa" sem dizer **quem** não resolve o problema real (dois atendentes sem saber um
  do outro). (b) `GET /agenda/responsaveis` (`AGENDA_VER_EQUIPE`, declarada **antes** de `/:id`,
  senão "responsaveis" seria lido como id de evento) **reusa `listarResponsaveis` de
  `db/follow-ups.js`** — uma consulta própria faria o mesmo colega aparecer num seletor e sumir
  do outro. Guardas em `test/agenda-equipe.test.js`.
- **Decisão 9 — os dois conflitos de merge dos logs foram resolvidos MANTENDO as duas entradas.**
  `ai-decision-log.md` e `ai-task-start-log.md` tinham lados que não competiam: um trazia a Fase 2
  (2026-08-13), o outro a campanha Tenka (2026-08-18). Escolher um apagaria história de
  governança. Resultado: 772 inserções, **zero remoções**.
- **Impacto:** `frontend/lib/{lead-operacao,conversa-operacao,equipe-painel}.{js,d.ts,test.js}`
  (novos), `frontend/app/dashboard/equipe/page.tsx` (nova), `banco-leads`, `prospeccao`,
  `conversas`, `central-ligacoes`, `follow-ups`, `agenda`, `components/ConversaPainel.tsx`,
  `components/InstanciasWhatsApp.tsx`, `components/ui/AlternadorModoIa.tsx`,
  `backend/src/routes/api-conversas.js`, `backend/src/routes/api-agenda.js`,
  `backend/test/agenda-equipe.test.js`, `AGENTS.md`, `docs/plano-execucao-crm-equipe.md`.
  **Nenhuma migration, nenhuma variável de ambiente, nenhuma mudança de gate de rota.**
- **Como validar:** `npm test` no `backend/` (**1867/1869**; as 2 falhas são os testes que fazem
  chamada real ao provedor e tomam `429`), `node --test lib/*.test.js` no `frontend/`
  (**421/421**) e `npx tsc --noEmit` limpo nos dois lados. Nada foi executado contra produção.

---

## 2026-08-17 — Central de Ligações: sincronização entre sessões/dispositivos da mesma conta

- **Gatilho:** a mesma conta usada em computador e celular ao mesmo tempo. Início, fim da
  chamada, encerramento e descarte feitos num aparelho deixavam as outras sessões visualmente
  atrasadas. Continuação direta da entrega de 2026-08-14, cujas 8 decisões esta entrada
  **estende, não revoga**.
- **Decisão 1 — polling focado, não realtime.** Varredura confirmou que **não existe** infra de
  realtime no repositório (nenhum `EventSource`/`text/event-stream`/`WebSocket`/`socket.io` em
  `backend/src` ou `frontend/`; nem `ws` nem `socket.io` nos dois `package.json`). Criar um
  canal SSE/WebSocket só para este módulo seria um segundo mecanismo de atualização convivendo
  com o que já existe, e teria de sobreviver a múltiplas instâncias no Railway. Mantido o
  polling, agora **focado** por natureza do que observa e pausado com a aba oculta.
- **Decisão 2 — o vigia de ciclo de vida roda nos DOIS modos.** É a correção principal: só quem
  ACOMPANHAVA recebia propagação. Quem operava descobria o encerramento remoto como **409 na
  hora de salvar**. Alternativa descartada: reusar o tique do Acompanhar (5 GETs) também no modo
  de operação — custo alto para uma pergunta que cabe numa leitura por PK.
- **Decisão 3 — endpoint próprio (`GET /ligacoes/:id/sessao`), e não `GET /ativa`.** Aquela
  consulta filtra `status='em_andamento'`: a ligação **some** dela ao terminar. "Sumiu" não
  distingue **encerrada** de **descartada** — desfechos com consequências opostas (uma vira
  registro na analítica e no histórico do lead, a outra não fica em lugar nenhum) — e não diz
  quem fez. A leitura nova é por PK, responde depois do fim, e sai sanitizada pelo MESMO módulo
  puro da listagem. Passo de 5s porque o custo é de uma linha; o conteúdo do Acompanhar segue
  no ritmo próprio (8s).
- **Decisão 4 — "foi esta tela?" é da TELA, não de `mesma_sessao`.** A chave de origem
  identifica o **aparelho** (a unidade que o operador reconhece: "foi no celular"), então duas
  abas do mesmo computador têm a mesma origem. Uma função pura respondendo isso pelo payload
  deixaria a segunda aba **sem aviso nenhum** — exatamente o defeito a corrigir. Por isso a
  decisão vive em `fechandoLocalRef` no componente, e `terminouEmOutraSessao()` foi **removido**
  da lib pura (com teste cobrando a ausência).
- **Decisão 5 — a tela NÃO se fecha sozinha no desfecho remoto.** Ela desliga a escrita,
  congela o cronômetro no marco oficial, diz **qual** desfecho foi, de quem e de qual aparelho,
  e reconcilia a fila **atrás do overlay** — mas quem estava preenchendo o resumo precisa ler o
  que aconteceu antes de a tela sumir. Fechar automaticamente pareceria perda silenciosa.
- **Decisão 6 — reconciliar a FILA, não só o selo.** Encerrar também muda status da
  oportunidade e tentativas do lead. `saidasDaFila` (puro) diz o que saiu entre dois tiques: a
  fila recarrega **sempre**, mas o **aviso** só sai quando não foi desta sessão — senão todo
  encerramento próprio geraria ruído logo depois do clique. Por isso `carregarDadosCampanha`
  foi separado de `carregarCampanha` (evita cascata de consultas de ativas) e `ativasRef` é
  zerado ao trocar de campanha (evita aviso falso com as ativas da campanha anterior).
- **Decisão 7 — origem de sessão OPACA, com impressão não reversível.** A chave é gerada no
  cliente (128 bits, `localStorage`) e **nunca persistida**: o banco guarda um SHA-256 truncado
  em 12 hex. Ela **não é credencial** (quem autentica é o Bearer token) e **nenhuma rota a
  devolve** — sai só o booleano `mesma_sessao` e o aparelho, que é lista **fechada** de duas
  palavras derivada de `matchMedia('(pointer: coarse)')`. Descartado por invasivo: User-Agent,
  IP, fingerprint de canvas, id de hardware, geolocalização, cookie. Ausência é terceiro estado
  (`null`), e `mesmaSessao` devolve **`null`** na dúvida — nunca `false`, que faria a tela
  afirmar "foi em outro aparelho" sem prova.
- **Decisão 8 — migration 068 é ADITIVA e as colunas guardam a ÚLTIMA transição.** Duas colunas
  nullable, sem DEFAULT, CHECK fechada no aparelho, **sem mutação de linha existente**. Guardar
  só a origem do INÍCIO não serviria: o que a tela precisa dizer é de onde veio o **encerramento**.
  O histórico por ação continua em `app.auditoria_eventos` (`contexto` JSONB — **nenhuma
  migration de auditoria**). A escrita é `COALESCE($n, coluna)`: requisição sem cabeçalho não
  apaga origem já registrada. `sessao_origem` ficou **fora de `COLS_SESSAO`** de propósito —
  aquele bloco sai cru em `/ativa` e `/iniciar`.
- **Decisão 9 — `ligacao_chamada_encerrada` vira ação de auditoria.** Era a única das quatro
  transições sem registro nenhum, justamente a que muda o estado da sessão para as outras
  telas. Auditada **só na transição real** (`ja_marcada`, obtido por `SELECT ... FOR UPDATE` do
  valor anterior dentro da transação que já existia): repetir o clique, ou dois aparelhos
  clicando quase juntos, não pode inflar o log.
- **Decisão 10 — corrida mostra o VENCEDOR; nada foi afrouxado no banco.** UNIQUE parcial,
  `COALESCE` do fim da chamada, `UPDATE` guardado por status e `ja_encerrada`/`ja_descartada`
  seguem intactos. O que mudou é a leitura do perdedor: falha em `encerrar`/`chamada-encerrada`
  **confere a sessão antes de alarmar**, e `ja_encerrada` deixou de dizer "Ligação registrada" —
  o resumo daquela tela não virou registro.
- **Impacto declarado:** 1 migration aditiva, 1 rota de LEITURA nova, nenhuma rota de escrita
  nova, nenhuma env nova, nenhuma mudança de permissão de rota, nenhuma mudança em atribuição
  de campanha/lead. Assumir/transferir ligação seguem fora de escopo. O modo Acompanhar continua
  estritamente somente leitura (guarda de regressão lê o fonte da tela).
- **Risco residual (herdado, declarado de novo):** o somente leitura continua sendo da
  INTERFACE — as rotas de escrita não exigem dono (Decisão 8 de 2026-08-14). Nada nesta entrega
  amplia esse risco.

---

## 2026-08-14 — Central de Ligações: ligação em andamento visível e modo Acompanhar (somente leitura)

- **Gatilho:** duas pessoas na mesma conta (uma ligando pelo celular, outra olhando pelo
  computador). A fila não dizia que um lead já estava ao telefone, e quem clicasse "Ligar"
  **recebia a sessão da outra pessoa** — `iniciarLigacao` é idempotente e retoma a ligação ativa
  do lead. O defeito não é criado aqui: é o que esta entrega torna visível e reduz.
- **Decisão 1 — leitura em LOTE por campanha, não JOIN na fila e não N+1.**
  `GET /ligacoes/ativas?campanha_id=` devolve uma linha por ligação ativa. Alternativas
  descartadas: (a) um `GET /ativa` por linha da fila — N+1 num teto de 500 leads;
  (b) `LEFT JOIN LATERAL` dentro de `filaDeTrabalho` — teria de ser repetido em
  `listarLeadsDaCampanha` (a aba Acompanhamento abre a MESMA tela) e não serviria ao polling,
  que precisa refazer só os selos sem recarregar a fila inteira. A consulta é coberta pelo
  índice parcial `idx_ligacoes_uma_ativa_por_lead` da migration 048 — **nenhum índice novo,
  nenhuma migration**.
- **Decisão 2 — `sou_eu` é calculado no SERVIDOR.** Só ele conhece o usuário autenticado; o
  front teria de buscar `/auth/me` e comparar ids, e deduzir dono por nome seria adivinhação.
  O payload sai sanitizado na origem (`services/ligacao-acompanhamento.js`, lista FECHADA de
  campos): id, lead, desde quando e quem — **nunca** telefone, notas ou resultado. Uma listagem
  não precisa do conteúdo da conversa.
- **Decisão 3 — `aguardando_resumo` também OCUPA o lead.** No banco ele é o MESMO
  `status='em_andamento'` (ver `db/ligacoes-estado.js` e a migration 048): tratar só a chamada
  em curso deixaria o lead aparecer "livre" enquanto outra pessoa ainda grava o resumo, e o
  segundo clique cairia dentro do resumo alheio.
- **Decisão 4 — o modo Acompanhar reusa `OperacaoLigacao`, não uma tela nova.** Uma segunda
  tela duplicaria roteiro, contadores e a leitura dos mesmos GETs, e as duas divergiriam.
  O interruptor é `ativo = estado === 'em_andamento' && !somenteLeitura` — a MESMA variável de
  que os chips, a navegação de etapa e os registros já dependiam —, com early-returns em
  `iniciar`/`encerrarChamada`/`salvar`/`descartar`/`salvarNotas` como segunda camada. A coluna
  direita do modo Acompanhar vem **antes** de qualquer ramo de escrita, de propósito: se o dono
  encerrar a chamada com a tela aberta, `estado` vira `aguardando_resumo` e o formulário de
  resumo (com "Salvar ligação") apareceria sozinho.
- **Decisão 5 — polling, e os dois passos são diferentes porque o custo é diferente.** A
  listagem reconfere a cada **15s** (1 consulta minúscula); dentro do modo Acompanhar o passo é
  **8s**, porque cada tique custa ~5 GETs. Os dois pausam com a aba oculta, e o da listagem
  pausa enquanto a tela de atendimento está aberta. `GET /ligacoes/ativa` é também o detector de
  FIM: quando a ligação encerra, ela some da consulta e o acompanhamento para em vez de exibir
  para sempre um cronômetro de uma chamada que acabou.
- **Decisão 6 — "Ligar agora" PULA o lead ocupado por outra pessoa.** É um comando de TRABALHO
  e escolher o próximo é exatamente o que ele faz; abrir uma tela de observação seria um efeito
  surpreendente, e ligar para quem já está ao telefone com um colega é o único desfecho que
  chega ao CLIENTE. Ligação própria não faz pular (retomar é o esperado), o pulo é dito na tela
  ("N em ligação por outra pessoa") e o destaque âmbar da linha passou a marcar o lead que o
  botão realmente abre.
- **Decisão 7 — a corrida de dois cliques quase simultâneos é resolvida no `POST /iniciar`.**
  Entre carregar a fila e clicar, outra pessoa pode ter iniciado; a rota passou a devolver
  `sou_eu` (campo **aditivo**) e, quando ela RETOMA sessão alheia, a tela vira somente leitura
  em vez de operar por cima. Nada é criado nesse caminho — `/iniciar` só devolveu o que existia.
- **Decisão 8 — não se enforce dono nas rotas de ESCRITA, e isso está declarado.** O modo
  somente leitura é da INTERFACE. Exigir `usuario_id` igual em `encerrar`/`sinais`/`etapas`
  mudaria permissão de rota (fora do escopo pedido) e quebraria casos legítimos (ligação antiga
  com `usuario_id` nulo, admin concluindo um resumo abandonado). O risco residual é o mesmo de
  hoje, e menor: antes a tela ENTREGAVA a sessão alheia sem avisar; agora ela precisa ser
  contornada de propósito. Transferir/assumir ligação continua fora de escopo.
- **Impacto declarado:** nenhuma migration, nenhum índice, nenhuma env, nenhuma rota de escrita
  nova, nenhuma mudança em atribuição de campanha/lead. Testes:
  `test/ligacao-acompanhamento.test.js` e `frontend/lib/ligacao-ativa.test.js` (com guardas que
  leem o fonte: o módulo puro não fala com banco/rede, a listagem não devolve conteúdo da
  conversa, e a tela não decide ação a partir de `sou_eu`).

---

## 2026-08-12 — Canal de E-MAIL do follow-up: o valor nasceu JUNTO do executor (migration 067)

- **Gatilho:** a **Decisão 4** da entrada anterior (mesma data) declarou o e-mail como fase
  separada e escreveu a condição para ele existir: *"criar o valor `email` sem executor
  produziria itens que entram na fila e nunca saem dela"*. Esta entrega constrói o executor e
  alarga as duas CHECKs **no mesmo diff**. A condição foi cumprida, não contornada.
- **Decisão 1 — o canal e o executor no MESMO diff, sem exceção.** Alargar
  `follow_ups_canal_chk` primeiro e "fazer a tela depois" recriaria exatamente o defeito
  previsto. O `EMAIL_FASE_SEPARADA` do código virou `EMAIL_CANAL` (`suportado: true`,
  `executor: 'central_follow_ups'`, `exige_endereco: true`), e o teste que cobrava a proibição
  passou a cobrar a existência do executor.
- **Decisão 2 — a disponibilidade de e-mail vai na MESMA tabela da 066, não numa nova.** É o
  mesmo tipo de fato (veredito humano sobre um canal de um contato) com a mesma identidade
  (`empresa_id + telefone_digitos`). Ela só precisava de uma coluna `endereco` e de `email` na
  CHECK de canal. Tabela separada duplicaria a curadoria em dois lugares e deixaria as duas
  divergirem — o oposto do que a 066 foi criada para evitar.
- **Decisão 3 — sem endereço não há canal, e isso é CHECK no banco.**
  `contato_canal_disp_email_confirmado_chk` exige `endereco IS NOT NULL` quando
  `canal = 'email' AND disponivel = true`. Confirmar e-mail é dizer PARA ONDE. Negar continua
  permitido sem endereço: é uma negação, não um destino. E o upsert **não** faz `COALESCE` do
  endereço anterior — negar o canal apaga o destino, senão a linha se contradiria.
- **Decisão 4 — a mesma regra precisou existir do OUTRO lado, em JS.** A CHECK protege
  `contato_canal_disponibilidade`, mas não enxerga `follow_ups`, e `POST /follow-ups/itens`
  aceita `canal` do corpo — com `email` agora válido em `FOLLOWUP_CANAL`, bastaria pedir um
  follow-up de e-mail para um contato sem endereço confirmado para criar o item sem destino que
  a Decisão 4 original descreveu. `resolverCanalFollowUp` passou a **rebaixar para `ligacao`**
  todo item de e-mail sem endereço confirmado. Foi o único defeito encontrado na revisão do
  próprio desenho, e é a razão de a regra viver no módulo puro e não só no banco.
- **Decisão 5 — o executor é a PRÓPRIA Central de Follow-ups.** Não nasceu uma "Central de
  E-mails": compor mensagem 1:1 é o que o follow-up manual daquela fila já faz, e uma tela nova
  duplicaria o compositor. `TELA_EXECUTORA.email = 'central_follow_ups'` é o primeiro destino
  que aponta para a própria fila — antes ela só operava, nunca executava.
- **Decisão 6 — o destinatário NÃO é um campo, nem na tela nem na rota.** É sempre o endereço
  confirmado (`origem = 'operador'`). Aceitá-lo no corpo da requisição permitiria enviar para um
  endereço que ninguém verificou, que é o erro que este módulo inteiro existe para impedir. Há
  guarda de regressão que lê o fonte da rota. E-mail de cadastro continua **candidato**: aparece
  como sugestão, sempre rotulado como não verificado.
- **Decisão 7 — rascunho DETERMINÍSTICO, sem IA.** O texto sai da próxima ação e da observação
  já combinadas no item. Um canal novo não estreia com custo de LLM por clique; o teste que
  proíbe `generateAIResponse` no executor é onde uma mudança dessa apareceria.
- **Decisão 8 — enviar CONCLUI o item, e a ordem é envia→grava.** Neste canal enviar É a ação;
  deixar o item aberto devolveria a fila ao problema de "item que entra e não sai". Falha do
  provider vira linha `falhou` e o item **continua em aberto** — trabalho não some da fila por
  falha de transporte. Se o e-mail sair e a conclusão falhar, o erro é reportado para o operador
  concluir à mão: e-mail aceito pelo provider não se estorna (mesmo raciocínio do ledger da
  Meta).
- **Decisão 9 — transporte REUSADO, ledger PRÓPRIO.** `enviarViaProvider` foi exportado de
  `email-outreach.js` (duplicar o cliente HTTP criaria dois provedores possíveis), mas o
  registro foi para `app.follow_up_emails`: `prospectador.email_outreach` é chaveada por
  `prospect_id` (que o follow-up não tem) e mede a **primeira abordagem** — misturar as duas
  faria abordagem e acompanhamento medirem a mesma coisa. Sem status `desativado`: canal não
  configurado recusa antes de compor e **nada é gravado**.
- **Decisão 10 — nenhum worker envia e-mail sozinho.** O canal nasceu de decisão humana e
  continua executado por uma pessoa; guarda varre `src/**` e falha se `enviarEmailFollowUp`
  ganhar chamador além da rota. Automatizar o disparo seria outra decisão de produto.
- **O que NÃO mudou:** `origem` continua NOT NULL, sem DEFAULT e fechada em `'operador'` (a
  garantia de "só humano" da 066); o canal continua **fora** do formulário de encerramento de
  ligação (`CANAL_OPCOES` não oferece e-mail — ele é consequência de um fato declarado, nunca
  item de lista); `prospects.tem_whatsapp` segue intocada; o índice
  `follow_ups_um_aberto_por_canal_uk` segue valendo sem alteração.
- **Consequência declarada e aceita:** contato marcado como sem WhatsApp e **sem** e-mail
  confirmado continua indo para **ligação**. O salto do meio existe agora, mas só com
  verificação humana — e-mail conhecido no cadastro, sozinho, não muda o canal.
- **Impacto:** `sql/migrations/067_follow_up_canal_email.sql` (nova),
  `src/services/followup-email.js` (novo), `src/db/follow-up-emails.js` (novo),
  `src/services/contato-canal-disponibilidade.js`, `src/services/follow-up-modelo.js`,
  `src/services/email-outreach.js`, `src/db/contato-canal-disponibilidade.js`,
  `src/db/follow-ups.js`, `src/routes/api-follow-ups.js`, `src/domain-enums.js`,
  `test/followup-email.test.js` (novo), `test/contato-canal-disponibilidade.test.js`,
  `test/domain-enums.test.js`, `test/follow-up-modelo.test.js`, `package.json` (3 arquivos de
  teste entraram no script), `frontend/lib/follow-up-acao.js` (+ `.d.ts`/`.test.js`),
  `frontend/lib/followups-fila.js` (+ `.d.ts`),
  `frontend/app/dashboard/follow-ups/page.tsx` (`ModalEmail`), `AGENTS.md`.
  **Nenhuma variável de ambiente nova** — o canal reusa
  `EMAIL_PROVIDER_API_URL`/`EMAIL_PROVIDER_API_KEY`/`EMAIL_FROM`, que já existiam e continuam
  desligando o canal quando ausentes.
- **Como validar:** `npm test` no `backend/` (1588/1588) + `npm run typecheck` (limpo);
  `npm test` no `frontend/` (323/323) + `npm run typecheck` + `npm run build` (limpos).
  **Nenhum e-mail real foi enviado**, nada rodou contra produção e nenhum banco real foi
  escrito — o transporte só é alcançado com as três variáveis do provider configuradas, e os
  testes param antes disso.
- Ver `AGENTS.md` → "Canal de E-MAIL do follow-up" para o detalhamento técnico.

---

## 2026-08-11 — Menu radial de ações secundárias: só Follow-ups, acionado por clique (não por gesto)

- **Contexto:** relatório "Padronização visual das listagens" (artifact
  `5823a4a6-8243-4274-9449-ebda5b2a6e58`) propôs um menu radial de 4 zonas para compactar ações
  secundárias que hoje quebram linha, com duas decisões em aberto: D5 (radial em quais telas) e
  D6 (gesto de clicar-e-segurar vs. popover de clique).
- **Decisão (dada pelo próprio pedido que motivou a implementação, não inventada pela IA):**
  1. **D5 — só Follow-ups nesta entrega.** Captação também se beneficiaria (3-4 ações por
     linha), mas incluí-la ampliaria o diff além de "pequeno/médio". Fica documentada como fase
     seguinte, junto de Aquisição (que só tem 2 ações hoje — zona cinzenta do relatório).
  2. **D6 — acionamento por botão/clique, nunca por hover ou clicar-e-segurar.** O pedido exigiu
     "acionamento previsível por botão/ícone, sem depender apenas de hover frágil" para desktop.
     Consequência de design: como o gatilho já é um clique/toque explícito (não um "soltar em
     cima de uma zona"), a distinção do relatório entre "toque simples abre a lista completa" e
     "toque longo abre o leque" deixa de existir — só há UM caminho, e ele já é a lista completa
     com as zonas mais usadas destacadas espacialmente dentro dela. Menos superfície de estado,
     mesma cobertura de acessibilidade (botão focável, `aria-label`, Escape, fecha fora).
- **Por que não foi ambíguo o suficiente para virar checkpoint:** D1 (destino de
  `StatusPill.tsx`) permaneceu em aberto porque o próprio pedido citou esse componente
  nominalmente como caso de parar e perguntar. D5/D6 tinham instrução explícita no pedido
  (prioridade de tela + critério de acionamento no desktop), então resolvê-los é aplicar a
  instrução, não adivinhar uma preferência de produto.
- **Risco aceito:** a ação "Cancelar automático" (follow-up automático agendado) fica sem zona
  espacial de propósito — é a mais consequente das ações movidas para o radial, então entra só
  na lista, nunca num atalho de zona de um clique.
- **Reuso, não invenção:** o componente reaproveita o padrão de fechamento (Escape/clique fora/
  scroll/resize) e portal no `<body>` já usado por `BolinhaPontuacao.tsx`/`ModalConfirmar.tsx`;
  a lib pura `frontend/lib/menu-radial.js` segue o mesmo contrato de
  `lib/pontuacao-indicador.js` (regra fora do componente, testável sem DOM).
- **No mesmo diff:** as duas trocas de `window.confirm`/`confirm()` por `ModalConfirmar` que o
  relatório também apontou como inconsistência pequena e segura de corrigir ("Deletar histórico"
  em `ConversaPainel.tsx`, "Remover rotina" em `RotinasAquisicao.tsx`).
- Ver `AGENTS.md` → "Menu radial de ações secundárias" para o detalhamento técnico.

---

## 2026-08-10 — Controle de ativação padronizado (nome + ícone "i" + controle), e por que a Central NÃO virou toggle

**Pedido:** padronizar os controles de ativação da Central de Mensagens e do Follow-up
Automático num único padrão compacto — ícone de informação + toggle + tooltip curto —,
removendo rótulos redundantes ("Ativo", "Desativo", "Acompanhando sem responder") e descrições
longas de espaço fixo. Alteração **exclusivamente de apresentação**.

**A decisão que precisou do operador.** O controle da Central **não era booleano**: são dois
modos NOMEADOS (Conversa | Análise) num `role="radiogroup"`, escolha deliberada registrada no
`AGENTS.md`. Transformá-lo em interruptor passaria a chamar "Análise" de *desligado* — e o
mesmo `AGENTS.md` avisa que o modo Análise **não é pausa de automação** (follow-up e agenda
continuam rodando nos dois modos). Levei as duas leituras ao operador; ele escolheu **manter os
dois modos nomeados**. Portanto: **só o Follow-up Automático virou interruptor**; a Central
manteve o segmentado e perdeu apenas os textos redundantes.

**O que é "padronizado", então.** Não é a mesma *forma* de controle nos dois lugares — é a mesma
**anatomia** e a mesma disciplina: `NOME do que se controla` → `ícone "i"` → `controle`, sem
estado escrito ao lado e sem parágrafo fixo embaixo. O estado vive no próprio controle (opção
marcada, ou posição do botão no trilho) e no `aria-label`/`aria-checked`; a consequência vive no
balão, que só ocupa espaço quando alguém pergunta.

**Nada de informação foi jogado fora.** Os dois parágrafos fixos da Central (`explicarPadraoGlobal`
+ `AVISO_EXCECOES_PADRAO`) viraram `ajudaPadraoGlobal(modo)` — função **pura**, no módulo de
tradução, com teste que falha se qualquer uma das duas partes sumir. O aviso das exceções é o que
impede uma conversa que não muda junto de parecer defeito; ele continua também no
`rotuloAcessivelPadrao`. O banner de alerta do Follow-up pausado **ficou**: é alerta operacional,
não rótulo redundante.

**Dono único do balão.** `BalaoAjuda` nasceu dentro de `AlternadorModoIa.tsx` e foi **extraído**
para `components/ui/BalaoAjuda.tsx` quando o segundo controle passou a precisar dele —
`AlternadorModoIa` **reexporta** daqui (padrão de `lib/paginacao.js`), então nada que já
importava por aquele caminho quebrou. Duas cópias divergiriam justamente na parte difícil:
posicionamento em portal, foco, fechamento em Escape/scroll/resize.

**Por que um componente novo e não o switch inline das instâncias.** `InstanciasWhatsApp.tsx` e
`InstanciasFreelandoo.tsx` já tinham a geometria (`role="switch"` + knob que translada), mas
inline, com paleta do painel escuro e sem ícone de informação. `components/ui/InterruptorAtivacao.tsx`
consolida o padrão com a mesma geometria; as duas telas de instâncias **não foram tocadas** (fora
do escopo do pedido) e migram quando alguém mexer nelas.

**Estado nunca só por cor:** a posição do botão dentro do trilho é o sinal principal (forma), e
há teste de regressão que falha se `translate-x-*` sumir ou se `role="switch"`/`aria-checked`
deixarem de existir. Outro teste lê o fonte das duas telas e falha se o estado voltar a ser
escrito ao lado do controle.

**Nenhuma regra operacional mudou:** mesmo `PATCH /modo-ia-padrao`, mesmo `PUT /config {pausado}`,
mesmos payloads, mesmos bloqueios (`ocupado` na Central, `!config` no Follow-up). Zero arquivo de
`backend/` alterado.

---

## 2026-08-10 — A coluna "Site" vira um fator da pontuação de cadastro

**Decisão do operador**, contra a minha recomendação inicial — registro os dois lados porque a
próxima IA precisa saber que a §5.1 de `analise-indicador-pontuacao.md` foi superada de propósito.

**O argumento do operador:** `site` já é um dos 9 critérios da completude (20 de 100 pontos em
`lead-score-cadastro.js`). A coluna era o mesmo dado duas vezes na mesma linha.

**Minha objeção, e o que fiz com ela.** Levantei três perdas: (a) Pontos é *lossy* — de "60" não
se sabe se tem site; (b) a direção é invertida (ter site SOMA pontos, mas não ter é a
oportunidade — a tela ordena `pontos ASC` e `ligacao-prioridade` dá +40 para `sem_site`); (c) o
score tem 2 estados e `situacao_site` tem 3. O operador manteve a decisão. Em vez de só executar,
**endereçei (a) e (c) na implementação**: o balão deixou de repetir o rótulo do critério e passou
a dizer a situação por extenso — "Sem site próprio — só rede social" / "Site não verificado" —,
o que dá no balão uma informação **mais precisa** do que a coluna removida tinha. (b) já estava
coberto pela nota de rodapé da variante completude, que existe justamente para isso.

**O que NÃO foi para o balão:** o link. O tooltip é `pointer-events-none` (contrato do
componente), então um link ali seria inalcançável. Ele fica em "Detalhes" e, no Banco de Leads,
na coluna "Links". **Os filtros por site permaneceram** nas duas telas: o pedido tirou uma
exibição redundante, não o recorte de trabalho.

**Correção de posicionamento junto:** o balão abria sempre para cima. Funcionava nas tabelas
(sempre há cabeçalho acima da 1ª linha) e quebrava na Central de Mensagens, onde a bolinha fica
no cabeçalho de um modal colado no topo — o balão saía da viewport. Agora ele mede a própria
altura e vira para baixo quando não cabe, além de ser preso nas bordas laterais. Medir, e não
estimar, porque o balão de cadastro tem 9 critérios e o de prioridade tem 2.

---

## 2026-08-10 — Follow-up vira ENTIDADE: o fluxo integrado Ligações ↔ Follow-ups ↔ Mensagens

Esta tarefa disparou o gatilho formal de
[PENDENCIA_ARQUITETURAL_CENTRAL_LIGACOES_E_MENSAGENS.md](PENDENCIA_ARQUITETURAL_CENTRAL_LIGACOES_E_MENSAGENS.md),
que manda **interromper a implementação e revisar a arquitetura antes de gerar código**. A
revisão foi feita, e quatro decisões estruturais foram levadas ao operador **antes** da Fase 3.

**Achado que motivou tudo:** não existia a entidade "Follow-up". A fila era derivada a cada
request de duas fontes que não se conhecem (recomendação heurística + agenda do motor), e a
próxima ação decidida ao encerrar uma ligação era texto livre em `app.campanha_leads`, que
**nenhuma linha da Central de Follow-ups lia**. Dos 9 campos do modelo pedido, existiam 3.

1. **Criar `app.follow_ups` (migration 062), em vez de estender `app.campanha_leads`.**
   Estender amarraria todo follow-up a uma CAMPANHA — follow-up de mensagem, de automação ou
   manual não teria linha —, e o `UNIQUE (campanha_id, prospect_id)` daria **um** follow-up por
   lead, sem histórico de reagendamentos. Alternativa descartada: "só ligar o que existe, sem
   migration", que entregaria o item na fila mas sem status próprio, sem responsável e sem
   concluir/reagendar — ou seja, sem o que o pedido pede.

2. **Identidade canônica do contato = `empresa_id` + `telefone_digitos`, resolvida na leitura.**
   Alternativa descartada: FK dura para `vendas.conversas(numero)`. Aquele `numero` é `UNIQUE`
   **GLOBAL**, não `UNIQUE (empresa_id, numero)` — a FK **não provaria mesma empresa** e ainda
   exigiria criar a conversa antes, inclusive para follow-up de LIGAÇÃO, que não precisa dela.
   Precedente já existente no repo: `followup-listing.js` casa agenda × conversa por
   `regexp_replace(…, '[^0-9]', '', 'g')`. **Consequência declarada:** resolver a identidade
   canônica do projeto inteiro (normalização única de telefone e `UNIQUE (empresa_id, numero)`
   em `vendas.conversas`) **continua pendente** — é trabalho que toca o webhook em produção e
   não foi feito aqui.

3. **As três fontes CONVIVEM; nada foi desligado.** Alternativa descartada: materializar a
   call-list em follow-ups. Isso exigiria um motor novo (criar/expirar), backfill, e mudaria o
   que o operador vê hoje — risco de fila duplicada ou vazia durante a transição, em troca de
   elegância. A precedência declarada resolve o conflito sem desligar nada:
   `registrado > call score > motor`, e a recomendação heurística vira o "por que agora" do
   item registrado em vez de uma segunda linha do mesmo contato.

4. **Responsável OPCIONAL, vindo de `app.usuarios_empresas`.** Alternativa descartada:
   obrigatório com default = quem encerrou a ligação. Quem registra a chamada nem sempre é quem
   executa o follow-up, e follow-up criado por AUTOMAÇÃO não tem usuário para atribuir. `NULL`
   = "não atribuído" é estado legítimo **e filtrável** — é justamente o recorte que o operador
   procura para saber o que está sem dono.

**Decisões minhas, fora das quatro perguntas:**

- **Antiduplicidade no BANCO** (índice único parcial), não na aplicação, e **por canal**: um
  contato pode ter uma ação de WhatsApp e uma de ligação abertas ao mesmo tempo — são trabalhos
  diferentes, feitos em telas diferentes. O `ON CONFLICT` faz **DO UPDATE** (a decisão mais
  recente vence), não `DO NOTHING`: ignorar o novo faria a tela mentir sobre o que foi
  combinado na ligação que acabou de acontecer.
- **O follow-up da ligação nasce dentro da TRANSAÇÃO do encerramento.** Fora dela, sobreviveria
  a um rollback. Por isso a rota HTTP de criação **recusa** `origem: 'ligacao'`.
- **`contextoOrigem` do painel de conversa são DADOS, não uma requisição.** `ConversaPainel` é o
  mesmo componente na Central de Mensagens, que **não** é admin-only: buscar o contexto lá
  dentro faria aquela tela chamar uma rota admin-only e tomar 403.
- **A linha do tempo não devolve texto de mensagem.** O painel de conversa já mostra o histórico
  inteiro; repetir criaria duas fontes que divergem.

**Dívida declarada:** `app.campanha_leads.proxima_acao`/`data_followup` seguem existindo e
sendo escritos (a aba Acompanhamento depende deles). Hoje são um RESUMO derivado do follow-up,
não uma segunda fonte de verdade — mas continuam sendo dois lugares guardando a mesma decisão.
Unificá-los exige mexer na tela de campanha, que estava fora do escopo.

---

## 2026-08-08 — Follow-ups: fila paginada, sem identificador do Evolution, com Manual assistido

Continuação da fila única entregue em `2621db9`. Cinco decisões que valem mais que o diff:

1. **A área "Automação" virou um TOGGLE, não uma página nova.** Ela tinha três coisas de
   naturezas diferentes: uma DECISÃO diária (ligar/desligar o motor), um PARÂMETRO
   (`meta_ligacoes_dia`) e DIAGNÓSTICO (cards de saúde + reprocessar falhas). Só a primeira é
   trabalho de quem opera a fila; as outras duas são configuração e telemetria, que o pedido
   põe fora de escopo. Decisão do operador: manter apenas o toggle no cabeçalho.
   **Custo declarado e aceito:** `meta_ligacoes_dia` fica sem editor (a marca "na capacidade
   do dia" segue lendo o valor salvo, default 12) e "Reprocessar falhas" sai da UI. **Nenhuma
   rota foi removida** — `PUT /config` e `POST /auto/reprocessar` continuam intactos, para a
   área nascer em Configurações depois sem trabalho de backend. Alternativa recusada agora:
   criar a página de Configurações nesta entrega (escopo maior, e o pedido só a cita como
   direção futura).

2. **O JID do Evolution some corrigindo a ORIGEM, não escondendo na tela.** O SQL fazia
   `COALESCE(apelido, negocio, c.numero) AS nome`; bastava um lead sem cadastro para a coluna
   "Lead" virar `5511999990001@s.whatsapp.net`. O SQL passa a devolver **nome NULO** e a
   escolha do fallback legível é da apresentação (`rotuloLead`, PURO). Motivo de não fazer
   `nome || telefone` no `.tsx`: a **ordenação** e a **busca** da fila precisam enxergar
   exatamente o rótulo que está na tela — desempatar por um `nome` invisível produziria uma
   ordem que o operador não consegue explicar. `nomeDeVerdade` também saneia linhas antigas
   que ainda tragam JID (ou um telefone cru) no campo `nome`; guarda de regressão lê o fonte
   do SQL e falha se o `COALESCE` voltar.

3. **A paginação não ganhou módulo próprio.** `frontend/lib/paginacao.js` já é o dono
   compartilhado (Aquisição + Central de Ligações). Follow-ups apenas o **reexporta** via
   `followups-fila.js`, para a tela importar de um lugar só. Zero aritmética de página no
   `.tsx`. Recorte **depois** de filtrar/ordenar, página clampada, e filtro mexido volta para
   a página 1 (manter a página 7 depois de restringir mostraria uma janela vazia).

4. **Conversa criada pelo Manual nasce com o AGENTE PAUSADO.** Foi a decisão de produto do
   operador, contra as duas alternativas: recusar o número novo (mantinha o 404 de hoje e
   deixava o pedido sem atender) ou criar a conversa ativa (o bot passaria a atender
   automaticamente alguém que **nunca escreveu** — iniciar atendimento por conta própria).
   Pausado é o meio-termo honesto: o operador fala, e liberar o bot vira ato explícito na
   Central de Mensagens.
   **`ON CONFLICT (numero) DO NOTHING` + releitura, nunca `DO UPDATE`:**
   `vendas.conversas.numero` é UNIQUE **GLOBAL** (`init.sql:6`), não por empresa — um upsert
   aqui reescreveria a conversa de outro tenant. Número que já é de outra empresa é **recusado
   com 409**, sem adotar e sem devolver nada da linha alheia. Guarda de regressão lê o fonte e
   falha se o `DO UPDATE` ou um `agente_pausado = false` voltarem.

5. **A origem do Manual foi para `app.auditoria_eventos`, sem migration.** A tabela da
   migration `047` já tem empresa, usuário, entidade, ação, contexto JSONB e data — exatamente
   o que o pedido exige. `vendas.eventos_comerciais` foi **recusada**: tem CHECK fechado de
   `tipo` (`init.sql:311`), o que exigiria alterar a constraint, e não carrega `empresa_id`.
   No registro entram só `origem` e `telefone_digitos`; nenhum JID e nenhum texto de mensagem.

**Filtros não implementados, por decisão e não por esquecimento:** "responsável" (o item da
fila não tem dono — `usuario_id` só existe em ligação já registrada) e "tipo de falha" (o motor
grava `motivo_decisao` em texto livre, sem taxonomia). Inventar qualquer um dos dois daria um
filtro que mente. As duas ausências estão escritas na própria tela.

---

## 2026-08-08 — Atribuição CTWA capturada no WEBHOOK, escopada por empresa **e** instância

Implementação da saída apontada pela medição do mesmo dia (entrada abaixo). Quatro decisões
que valem mais que o diff:

- **Tabela própria (`app.atribuicao_anuncios`), não mais uma coluna em `vendas.lead_profiles`.**
  `lead_profiles` é chaveada por telefone GLOBAL (`UNIQUE (numero)`): um telefone, uma linha em
  todo o sistema. Atribuição de anúncio é fato **de uma instância** — o mesmo número pode falar
  com dois negócios, e guardar a atribuição lá obrigaria a escolher qual anúncio "vence".
  `empresa_id` e `instancia_id` são NOT NULL: não existe linha sem dono provado.
- **Idempotência por `(empresa_id, mensagem_id)`, nunca por telefone.** A chave é o id da
  mensagem que trouxe o anúncio. Reentrega do webhook não duplica; clique NOVO (mensagem nova)
  vira linha nova. É a correção direta do modelo antigo (`${telefone}:${event_name}`), que
  congelava o lead numa única atribuição para sempre. A instância fica FORA da chave de
  propósito — uma mensagem chega por exatamente uma instância, e incluí-la permitiria que a
  mesma mensagem virasse duas linhas se fosse reprocessada com a instância resolvida de outro
  jeito. O isolamento por instância é garantido na LEITURA, onde toda consulta filtra por ela.
- **Ausência é melhor que dado sujo.** Quando a empresa vem do fallback da PJ, ou a instância
  não está mapeada, **nada é gravado** — só o motivo, em log sem PII. Gravar um telefone sob uma
  empresa que só o fallback resolveu recriaria, com nome novo, o defeito da Fase A. Para isso
  `middleware/tenant.js` passou a publicar `req.empresaOrigem` e `req.whatsappInstanciaId`:
  antes os três caminhos de fallback produziam o mesmo `req.empresaId` e eram indistinguíveis
  do caso bom. O comportamento do ATENDIMENTO não mudou — mudou só o que dá para saber sobre ele.
- **`ctwa_clid` em claro no banco, nunca em rota nem em log.** A Conversions API o exige no
  envio (mesma escolha do sistema legado em `origem_anuncio`); cifrá-lo criaria dependência de
  env num caminho de leitura do worker. A proteção é de SAÍDA: `src/db/atribuicao-anuncios.js`
  sanitiza na origem (`ctwa_clid_hint` de 4 caracteres + telefone mascarado) e a rota devolve o
  que ele já sanitizou. Dívida declarada: se a política mudar, o lugar de cifrar é o cofre já
  existente (`src/segredos-crypto.js`), e só o `carregarCtwaPorTelefone` decifraria.

**Alternativa descartada:** continuar em `vendas.lead_profiles.origem_anuncio` e só consertar o
schema da varredura. Descartada pela medição: mesmo com `evolution."Message"` o telefone não
existe naquela tabela (100% `@lid`, sem tradução). Não era um bug de qualificador — era a
estratégia inteira.

**Fora de escopo desta entrega (declarado):** nenhum evento real foi enviado à Meta, nenhuma
integração foi ativada, nenhum backfill histórico foi feito (backfill de CTWA por telefone é
justamente a inferência que este desenho recusa).

---

## 2026-08-08 — Onde a atribuição CTWA realmente quebra (medição, sem código novo)

Investigação read-only em produção, feita para decidir se valia trabalho de infraestrutura
(FDW/réplica) para alcançar a tabela do Evolution. **Não vale: o diagnóstico anterior estava
errado.** Registrado aqui porque o custo de redescobrir isso é alto e o caminho errado é caro.

- **A tabela do Evolution está no MESMO banco**, no schema `evolution` (38 tabelas). `public`
  está vazio. O código consulta `public."Message"`, `to_regclass` devolve null e
  `sincronizarAtribuicaoMetaAds` é um no-op silencioso desde sempre. Nenhuma obra de infra
  era necessária — era um qualificador de schema.
- **Corrigir o schema não resolve.** `key` só tem `{fromMe, id, remoteJid}`: `remoteJidAlt`,
  de onde o código tira o telefone, não existe nesta versão.
- **O lead de anúncio chega como `@lid`.** 526 mensagens com `externalAdReply` (509 com
  `ctwaClid`, 18 anúncios), **100%** com `remoteJid` `@lid`. O filtro `LIKE '%@s.whatsapp.net'`
  descarta tudo. E não há tradução `@lid`→telefone em `Contact`/`Chat`: 251 telefones de
  anúncio, **0** casam com `vendas.conversas`.
- **A saída é o WEBHOOK, não o banco.** `vendas.conversas.numero` é `@s.whatsapp.net` em 100%
  das 62 conversas: o payload carrega o telefone que o Evolution não persiste. Capturar
  `externalAdReply` na chegada da mensagem — onde telefone e anúncio estão na mesma requisição
  — mata as três camadas de uma vez e dispensa `messageEvolutionExiste`.
- **Suposição pendente, declarada:** não confirmei o payload ao vivo. Inferi de o Evolution
  persistir `externalAdReply` + o CRM ter os telefones. Uma linha de log no webhook resolve,
  e isso deve ser o primeiro passo de qualquer retomada.
- **Dívida corrigida na mesma leva:** `scripts/medir-isolamento-empresa.js` carregava a mesma
  premissa errada e por isso respondia "a tabela não existe neste banco" — um zero que parecia
  resposta e era artefato. Agora ele RESOLVE a relação (`evolution` → `public`) e mede também
  por que a atribuição não casa (medição 5b). `meta-attribution.js` **não** foi tocado de
  propósito: corrigir só o schema faria a consulta rodar para achar zero, gastando banco a cada
  tick sem entregar nada. A correção de verdade é a captura no webhook, que é feature nova e
  merece Fase 0 própria.

---

## 2026-08-07 — `vendas.lead_profiles.empresa_id` real (migration 058, Fase A)

Fase A do isolamento por empresa da Meta. A migration `006` pôs `DEFAULT '<PJ>'` na coluna —
declarando no próprio cabeçalho que o default sairia "quando o roteamento por instância for
ligado" — e nenhum dos 4 caminhos de INSERT informava `empresa_id`. Todo lead de toda empresa
nasceu marcado como PJ. Decisões, com o porquê:

- **O dono do perfil vem da CONVERSA, dentro do próprio SQL — não de um parâmetro dos ~20
  chamadores.** É exatamente a coluna com que os consumidores casam
  (`lp.empresa_id = c.empresa_id` em `meta-dispatch.js`): um parâmetro que discordasse da
  conversa reintroduziria o bug que a correção existe para fechar. Como `lead_profiles.numero`
  é `REFERENCES vendas.conversas(numero)`, não existe perfil sem conversa e a fonte está sempre
  disponível no INSERT. Bônus: nem a IA nem as rotas alcançam o campo (não está na whitelist e o
  valor nasce de subconsulta), e o diff em caminho de produção é mínimo — nenhuma assinatura
  mudou. Fonte única: `src/db/lead-profile-empresa.js`.
- **O upsert nunca migra o dono**, replicando o contrato de `salvarConversa`: `ON CONFLICT` só
  preenche a empresa quando a linha ainda está sem dono. Corrigir linha antiga no meio do
  atendimento seria um UPDATE silencioso e não auditável — é trabalho do backfill, com
  simulação, lote e rollback.
- **O fallback da PJ FICA, mas passa a ser rastreável.** Removê-lo agora quebraria conversas de
  instância não mapeada. Em vez disso, `empresa_id_origem` grava **a confiança** da atribuição
  (`conversa_confirmada` | `conversa_nao_confirmada` | `NULL` = legado), permitindo à Fase B
  recusar o que é frouxo sem que o fallback precise sumir hoje.
- **A confiança exige confirmação pela INSTÂNCIA — "veio da conversa" não basta.** Esta decisão
  foi corrigida *depois* da medição, e a medição é o motivo: das 6 conversas marcadas como PJ em
  produção, apenas **1** é PJ de verdade (2 sem instância, 3 com instância não mapeada). O
  desenho original carimbaria as outras 5 como "veio da conversa", entregando à Fase B uma
  confiança inventada — 3 dos 4 perfis pendurados nessas conversas. O carimbo passou a testar
  `i.empresa_id = c.empresa_id` via `app.empresa_whatsapp_instances`. Custo: dois lookups por
  índice único no caminho quente do atendimento. Simulação em produção depois da correção: 18
  confiáveis, 3 não confiáveis — casando exatamente com a medição.
- **A coluna não registra QUEM escreveu** (atendimento vs. backfill), só o quanto se confia.
  Misturar autoria com semântica obrigaria a duplicar cada valor; a autoria já está em
  `vendas.lead_profiles_empresa_backfill`, com `execucao_id`.
- **O que mediu o tamanho real do defeito:** ele NÃO vaza entre tenants. O telefone é único em
  `vendas.conversas`, então a reunião da empresa B não entra na lista da PJ; o que acontece é o
  join de atribuição não fechar, o lead cair em `sem_atribuicao` e a **conversão do tenant nunca
  sair**. O prejuízo é perda de conversão, não mistura. (O painel legado
  `obterResultadosAnunciosMeta`, esse sim, contava leads de outros tenants dentro da PJ.)
- **Backfill é script separado, nunca migration.** Migration que muta base inteira roda no boot
  do Railway e trava o start. O script simula por padrão, corre por keyset com **um COMMIT por
  lote**, guarda o valor anterior em `vendas.lead_profiles_empresa_backfill` na MESMA transação e
  imprime o SQL de rollback. Perfil sem conversa ou conversa sem empresa: **nada é alterado** —
  inventar dono é pior do que deixar visível que ninguém sabe.
- **Válvula `META_CONVERSOES_PAUSADO`.** Se a empresa de um lead muda entre um tick e o outro, o
  motor mandaria a conversão com a atribuição antiga — e evento aceito pela Meta não se estorna.
  A pausa interrompe o ciclo INTEIRO (reconciliação inclusive) antes de tocar no banco; o ledger
  não é perdido. Alternativa descartada: pausar só o envio — a reconciliação já grava o fato com
  a empresa lida naquele instante.
- **Dívida técnica declarada:** `UNIQUE (numero)` continua GLOBAL em `vendas.lead_profiles` (e em
  `vendas.conversas`). Enquanto for assim, o mesmo telefone não pode existir em duas empresas —
  é o que torna "a conversa é o dono" uma regra segura hoje, e é exatamente o que a Fase C
  (dimensão instância) terá de enfrentar. Migrar para `UNIQUE (empresa_id, numero)` está fora
  desta fase por decisão explícita do pedido.

---

## 2026-08-07 — Meta Conversions multitenant por resultado de reunião (migration 057)

Substituição da integração Meta CAPI **global** (que já rodava em produção) por uma integração
**isolada por empresa**. O caminho antigo lia dataset/token do `process.env` e varria
`vendas.lead_profiles` sem filtro de `empresa_id`: a conversão de qualquer tenant ia para o
dataset de um só. Decisões, com o porquê:

- **Resultado da reunião reusa o `status` que já existe** (aprovada pelo Victor entre 3 opções).
  `concluido` = realizada; `concluido` + `venda_valor > 0` = realizada com venda; `cancelado` e
  `nao_compareceu` continuam internos. A alternativa (coluna `resultado` própria) criaria um
  segundo enum sobre o MESMO fato — duas verdades para a mesma reunião, que é a duplicação que o
  AGENTS.md proíbe. A migration `057` só acrescenta `venda_valor`/`venda_moeda`/
  `venda_registrada_em` em `app.agenda_eventos`, com CHECK de "venda completa ou nenhuma": venda
  pela metade viraria `Purchase` de receita zero, corrompendo o ROAS do anunciante em silêncio.
- **Reunião do BOT resolve empresa por `vendas.conversas.empresa_id`** (aprovada). A tabela
  `vendas.agenda_eventos` não tem `empresa_id` — e é por ela que passa o lead de anúncio. Cobrir só
  `app.agenda_eventos` daria isolamento perfeito e uma integração que quase nunca dispara. Conversa
  sem empresa resolvida não gera evento. **Risco residual declarado:** instância Evolution não
  mapeada cai no fallback da PJ (`middleware/tenant.js:78`) e isso é indistinguível depois do fato.
- **Mapeamento em 3 eventos padrão distintos** (aprovada): `LeadSubmitted` / `QualifiedLead` /
  `Purchase`. A documentação vigente da Meta lista os três na taxonomia `business_messaging`, mas
  o AGENTS.md registra `QualifiedLead` REJEITADO em produção (subcode 2804066) numa versão
  anterior. Por isso **"Testar conexão" exercita cada evento habilitado em modo teste e a ativação
  fica bloqueada até o teste passar** — a divergência é descoberta no teste, não em produção.
- **Superadmin continua passando** (aprovada), como em todo o resto do sistema. Mitigação: o token
  não é devolvido nem para ele, e toda escrita/ativação/remoção vira linha em
  `app.auditoria_eventos`.
- **Reconciliador, não gancho nos pontos de negócio.** A análise prévia propunha chamar
  `registrarConversao` dentro de `handoff-alerts.js`, `ligacoes.js`, `agenda-multiempresa.js` e
  `agenda.js`. Preferi um worker que LÊ as reuniões: zero código novo dentro de transações que
  criam reunião em produção (um bug ali viraria reunião não criada), idempotente por construção, e
  enxerga o que já existia. Custo aceito: o fato vira evento no próximo tick, irrelevante para uma
  janela de atribuição de 7 dias.
- **Idempotência pela ENTIDADE + tipo, nunca pelo telefone.**
  `event_id = <ra|rr|rv>:<entidade_tipo>:<id>` com `UNIQUE (empresa_id, event_id)`. O modelo antigo
  (`${telefone}:${event_name}`) permitia **uma venda por telefone, para sempre**.
- **Correção de valor pós-envio não reenvia.** O primeiro envio aceito é o registro externo válido
  (a Meta não estorna); o valor novo vai para `valor_corrigido` e o evento vira `corrigido`.
  Reenviar valor corrigido é como se infla ROAS sem ninguém perceber.
- **Janela de 7 dias no reconciliador.** Fato mais velho não entra no ledger. Além de ser o limite
  da Meta, é o que impede a PRIMEIRA ativação de despejar meses de reuniões antigas no Gerenciador.
- **Cofres de segredo separados, sem duplicar código.** `src/segredos-crypto.js` virou fábrica
  genérica; `freelandoo/crypto.js` passou a usá-la mantendo prefixo (`fl1`), salt e ordem de envs
  IDÊNTICOS (o que já está cifrado segue legível), e a Meta ganhou `mt1` + `META_ENC_KEY`. Em
  produção, salvar credencial da Meta sem `META_ENC_KEY` é **recusado**: derivar de `JWT_SECRET`
  faria uma rotação de JWT tornar ilegível o token de todos os tenants de uma vez.
- **Dívida técnica declarada:** na agenda legada a venda não tem moeda nem carimbo de tempo
  próprio (`vendas.conversas.venda_valor` é do painel single-tenant). Assumimos `BRL` e usamos
  `COALESCE(concluido_em, data_fim)` como momento do fato. A saída, quando incomodar, é migrar
  esse fechamento para `app.agenda_eventos.venda_valor`, que já existe.

---

## 2026-08-07 — Navegação do painel por seções (grupos + drawer mobile + Integrações)

Mudança de APRESENTAÇÃO: nenhum arquivo de `backend/`, nenhuma migration, nenhuma env, nenhuma
rota de API. O menu principal crescia um item por funcionalidade nova e já estava em 16.

- **Dois grupos, não um.** O pedido original previa só "Configurações", mas 7 páginas de hoje
  (Visão Geral, Aquisição, Banco de Leads, Follow-ups, Roteiros, Agenda, Contas) não cabiam nem
  nos 5 itens de topo nem na lista de filhos administrativos. Enfiá-las em Configurações
  contradiria a própria regra de produto ("Configurações = administrativo/parametrização") e
  omiti-las contradiria o requisito de não esconder funcionalidade. Decisão do Victor:
  **grupo "Operação"** para as operacionais + **"Configurações"** para as administrativas.
  Contas ficou em Configurações (é `superadmin`, não operação).
- **NENHUMA rota foi renomeada.** Só o rótulo muda (`/conversas` → "Central de Mensagens",
  `/contextos` → "Instâncias", `/llm` → "Modelo e IA", `/uso` → "Uso e custos",
  `/prompts` → "Prompts e Saudações"). Isso zera a superfície de compatibilidade: nenhum link
  interno, bookmark, doc ou redirect novo entra na conta. `/dashboard/empresa` segue sendo o
  único redirect do projeto. O teste `nenhuma rota foi renomeada nesta reorganizacao` congela
  essa decisão contra regressão.
- **A árvore e as regras viraram módulo PURO** (`frontend/lib/navegacao.js` + `.d.ts` +
  `.test.js`, 22 testes). Motivo determinante: a mesma navegação agora é desenhada em DOIS
  lugares (coluna do desktop e drawer do mobile). Regra em módulo único é o que impede as duas
  apresentações de divergirem — duplicá-la em dois `.tsx` é exatamente o que o AGENTS.md proíbe.
- **`podePapel`/`NIVEL_ROLE` MIGRARAM de `lib/useSession.ts` para `lib/navegacao.js`**, com
  reexport em `useSession.ts` para não quebrar quem já importava de lá (`dashboard/contas`).
  Motivo: a escada de papéis decide o que aparece no menu e precisa ser testável com
  `node --test`, que não lê `.ts`. Continua existindo em UM lugar. Endurecimento aproveitado:
  exigência de papel desconhecida agora **nega** em vez de deixar passar.
- **Comparação de rota por SEGMENTO**, não por prefixo de texto. O código antigo usava
  `pathname.startsWith(href)` cru: uma rota futura `/dashboard/conversas-arquivadas` acenderia
  "Conversas". Agora é `igual || começa com href + '/'`, com `exato: true` em `/dashboard`.
- **`aliases` por item.** `/dashboard/prospeccao` e `/dashboard/captacao` existem como rota E
  são renderizadas como abas dentro de `/dashboard/aquisicao`; `/dashboard/instancias/:id/contexto`
  é filha de Instâncias. Sem alias, entrar por esses caminhos não acenderia item nenhum — e,
  com grupos, também não abriria o grupo, ficando pior que a lista plana anterior.
- **O grupo da página atual abre sozinho e nunca pode ser fechado pelo estado salvo**
  (`normalizarGruposAbertos` força o grupo ativo). Chegar numa tela e não ver onde se está é o
  principal risco de qualquer agrupamento.
- **O alerta de instância desconectada SOBE para o cabeçalho do grupo** quando Configurações
  está fechada (e para o botão de menu no mobile). Sem isso, a reorganização apagaria um aviso
  operacional que existe hoje — foi o único efeito colateral funcional identificado.
- **No modo retraído (76px), clicar num grupo expande a barra e abre o grupo** em vez de só
  alternar: no trilho estreito não há espaço para os filhos, e sem isso eles ficariam
  inalcançáveis por ali.
- **`Configurações › Integrações` nasce estática de propósito** — card "Meta Conversions —
  Em breve", sem `apiFetch`, sem campo de credencial, sem token. O backend multitenant da Meta
  CAPI está fora de escopo (a tela completa está especificada em
  `docs/analise-integracao-meta-multitenant.md`, seção 14). O ponto de entrada existe para que a
  próxima integração entre como card, não como item de menu.
- **Dívida técnica declarada:** a verificação visual desta entrega foi feita por revisão de
  código e pelos testes puros — **não houve captura de tela**, pois o MCP de navegador não estava
  disponível na sessão. O drawer mobile, o comportamento do trilho retraído e o alerta no
  cabeçalho do grupo precisam de uma passada visual em desktop/tablet/mobile antes do deploy.

---

## 2026-08-07 — Aquisição em dois modos (Busca / Rotinas): padrão de troca de modo em página

Mudança 100% de apresentação — sem backend, banco, env ou regra de negócio. A tela empilhava
duas operações de natureza diferente (operar uma busca agora × administrar automações), e o
custo era densidade, não funcionalidade.

- **O componente não é desmontado por modo.** `RotinasAquisicao` recebe `modo` e renderiza só o
  card correspondente, mas fica **sempre montado, na mesma posição da árvore**. Foi a decisão
  central: o formulário da busca avulsa, o polling de 20s e o `coleta_em_andamento` vivem no
  estado desse componente — desmontá-lo ao ir em Rotinas reiniciaria o formulário, exatamente o
  que a separação não pode causar. Os filtros da tabela de leads já viviam na página, que
  permanece montada.
- **Nenhum toggle novo.** Reuso do `components/ui/Abas.tsx`, que já é usado NESTA tela e já
  resolve teclado (setas/Home/End), `aria-selected`, foco visível e trilho rolável no mobile.
  Criar um segmentado próprio duplicaria um padrão visual e um contrato de acessibilidade.
- **Um painel só, com os ids do modo ativo**, em vez de dois painéis no DOM: manter os dois
  montados contradiria "não renderizar os dois conteúdos ao mesmo tempo", e é o `PainelAba` que
  desmontaria o `RotinasAquisicao`.
- **O bloco de `erro` saiu de dentro do card de rotinas.** Correção necessária, não estética: o
  mesmo estado é escrito por "Buscar agora" e pelas rotinas, e dentro do card de rotinas a falha
  da busca ficaria invisível no modo Busca. Um bloco só, fora dos dois cards.
- **Histórico de coletas migrou para o modo Rotinas** (saiu da aba de "Acompanhar resultados"):
  é histórico de execução de rotina, não revisão de lead. "Acompanhar resultados" ficou com
  Desempenho por mercado e Respostas recentes.
- **Persistência sem `useSearchParams`:** o projeto não usa parâmetro de rota em lugar nenhum, e
  `useSearchParams` exigiria Suspense e mudaria o padrão de roteamento por causa de um toggle.
  Modo restaurado em `useEffect` (nunca no render, para não quebrar a hidratação) a partir da URL
  (`?modo=`, prioridade — é o que um link compartilhado carrega) e, na falta dela, do
  `sessionStorage`. Gravação com `history.replaceState`: alternar modo não é navegação e não
  deve poluir o histórico do navegador.
- **Transição:** nova classe `.painel-troca` no `globals.css` (fade + 4px, 0.16s). Curta e sem
  deslocamento grande, para a página não "pular"; o bloco `prefers-reduced-motion` já existente
  a neutraliza automaticamente.

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

---

## 2026-08-07 - Paginacao no servidor da listagem de leads da Aquisicao

- **Decisao:** a listagem de "Leads encontrados" (`dashboard/prospeccao`, modo Busca) passa a ser
  paginada NO SERVIDOR (`?limit=&offset=&ordenar=&direcao=`), com a ordenacao aplicada ao conjunto
  completo antes do recorte. Os cards de resumo sairam: as contagens foram para dentro dos filtros
  de status e a taxa de resposta, para o rodape.
- **Motivo:** a tela pedia no maximo 100 leads e paginava so o que tinha vindo. Com 2223 leads na
  carteira, 2123 eram inalcancaveis por qualquer caminho da tela. Um aviso ("refine a busca") foi
  a primeira tentativa e o operador recusou, com razao: o limite nao era pedido dele.
- **Escolha tecnica:** o total de cada pagina NAO e contado de novo — vem de `/metricas`, que
  passou a aceitar os mesmos filtros da lista. Para garantir que os dois numeros nunca divirjam,
  ha UM construtor de WHERE (`montarFiltrosProspects`, com `alias`/`comStatus`), usado pela lista
  e pela contagem. A contagem de proposito NAO filtra por status: la o status escolhe qual coluna
  do resultado olhar, nao o universo.
- **Ordenacao em duas familias:** as colunas do banco (entrou, nome, telefone, email, endereco,
  nicho, aval, nota, site, status) entram num mapa FECHADO chave→SQL e viram `ORDER BY` + `OFFSET`
  normais — o valor vem da URL, entao nada do cliente e concatenado no SQL. `pontos` e `horario`
  NAO estao nesse mapa: os dois saem de `calcularScoreCadastroPlaces`/`dadosPlaces`, calculados na
  LEITURA a partir das colunas + `raw_json`. Traduzi-los para SQL duplicaria a regra de pontuacao,
  e bastaria alguem acrescentar um criterio para a ordem da tela divergir do numero que ela mostra.
  Eles usam `idsPorOrdemCalculada`, que le o conjunto filtrado, pontua com a MESMA funcao, ordena,
  recorta e devolve so os ids; a hidratacao (`json_apresentacao`, diagnostico) roda apenas para os
  25 da pagina — a resposta ficou MENOR do que era com 100 leads hidratados.
- **DIVIDA TECNICA declarada:** `idsPorOrdemCalculada` rele o conjunto filtrado a cada pagina, e
  `pontos` e a ordenacao PADRAO da tabela. E barato na ordem de grandeza atual (milhares) e cresce
  linear. A saida, quando incomodar, e persistir a pontuacao numa coluna mantida na escrita
  (precedente: `tem_site`, que ja e cache de uma funcao de leitura) — NAO traduzir a regra p/ SQL.
- **Impacto:** `src/prospecting.js` (`listarProspects` reestruturado; `montarFiltrosProspects`,
  `normalizarOrdemProspects`, `recortarIdsCalculados` novos e exportados; `normalizarOrigemFiltro`
  mudou-se para `services/prospect-filters.js`), `src/routes/api-prospeccao.js` (`/prospects` e
  `/metricas`), `frontend/app/dashboard/prospeccao/page.tsx`, `frontend/lib/paginacao.js` (extraida
  de `fila-ligacoes-view.js`, que so reexporta) e `frontend/lib/prospeccao-listagem.js`. Sem
  migration, sem env, sem prompt, sem escrita em lead.
- **Riscos:** `listarProspects` e caminho de listagem em producao e tambem serve a rota interna de
  dashboard (`prospecting.js`); sem `ordenar` na query ele mantem a ordem de negocio historica, e
  esse caller nao muda. A ordem calculada depende de desempate estavel (`updated_at` DESC) para o
  mesmo lead nao pular de pagina — coberto por teste.
- **Como validar:** `npm test` (backend, inclui `test/prospects-paginacao.test.js`) e
  `npm test` + `npm run typecheck` no `frontend/`; na tela, virar paginas ate o fim, trocar a
  ordenacao por cada coluna (com atencao a Pontos e Horario) e conferir que o rodape e o numero do
  filtro de status contam a mesma coisa.

## 2026-08-08 - Quarentena de webhook: o fallback para a PJ foi REMOVIDO

- **Problema:** `resolveEmpresaFromWebhook` devolvia o `empresa_id` da PJ Codeworks nos TRES
  casos em que nao conseguia provar a origem (payload sem instancia, instancia nao mapeada ou
  inativa, erro de consulta). Nao era um default inofensivo: o atendimento seguia e gravava
  conversa, perfil de lead e evento comercial de um negocio que NAO e a PJ dentro do tenant da
  PJ. Medido em producao em 2026-08-08, das 6 conversas marcadas como PJ apenas 1 era PJ.
- **Decisao:** nao existe empresa padrao para mensagem sem origem provada. `req.empresaId` fica
  NULO, o middleware publica `req.tenantPendencia` e o webhook PARA o fluxo inteiro logo apos o
  2xx (nada de conversa, lead, reuniao, CTWA, follow-up, resposta automatica, evento de saude
  de instancia ou Meta), em TODO evento — nao so `messages.upsert`.
- **Corte direto, sem flag de observacao** (decisao do usuario). Uma flag `observar|bloquear`
  manteria vivo o caminho de fallback e contrariaria o criterio "nao existe mais nenhum caminho
  que grave PJ_EMPRESA_ID como fallback". O custo aceito e operacional: numero legitimo nao
  mapeado para de ser atendido ate ser cadastrado — e para isso existe a tela de pendencias.
- **A quarentena NAO guarda payload** (decisao do usuario), nem cifrado, nem telefone, texto,
  pushName, ctwa_clid ou id de mensagem em claro. Guardar a conversa de um negocio sem dono
  conhecido seria criar o mesmo dado sujo, so que em repouso e sem ninguem para responder por
  ele. CONSEQUENCIA DECLARADA: a mensagem em quarentena nao e reencenada. Mapeada a instancia,
  o lead volta a ser atendido na PROXIMA mensagem — recupera-se o VINCULO, nao o historico.
- **Uma linha por instancia+motivo, nao por mensagem** (indice unico PARCIAL, so entre as
  abertas): um numero mal configurado produz milhares de webhooks e a tela precisa dizer "esta
  instancia esta orfa", nao listar dez mil eventos identicos. `ocorrencias` so cresce quando o
  `ultima_mensagem_hash` (SHA-256 do id) muda, entao reentrega do mesmo webhook nao infla a
  contagem. `instancia_chave` (string vazia quando nao ha nome) existe porque NULL nao colide
  com NULL em indice unico — sem ela cada webhook sem instancia abriria uma linha nova.
- **Os tres motivos ficam distintos, e o erro e checado ANTES do vinculo:** numa consulta que
  falhou o vinculo chega nulo pelo mesmo motivo que chegaria se a instancia nao existisse.
  Tratar as duas igual mandaria o operador cadastrar uma instancia que ja esta cadastrada.
- **Resolucao sem inventar dono:** `POST /api/webhook-quarentena/:id/reprocessar` RECONSULTA
  `findEmpresaEInstanciaPorEvolution` pelo mesmo caminho do webhook e so fecha se a instancia
  agora resolver; o corpo da requisicao nao carrega empresa. Deixar o operador apontar a
  empresa a mao reintroduziria o fallback com aparencia de decisao humana informada. Um CHECK
  no banco garante que pendencia fechada tem empresa E instancia, e aberta nao tem nenhuma.
- **Rota GLOBAL, fora de `/api/empresas/:empresaId`:** a pendencia e justamente o caso em que
  nao se sabe a empresa; pendura-la num tenant exigiria escolher um.
- **Vocabulario unico:** `ORIGEM_EMPRESA` mudou-se para `services/webhook-quarentena.js` e
  perdeu o prefixo `fallback_` (`sem_instancia`, `instancia_desconhecida`, `erro_resolucao`) —
  os mesmos valores gravados em `webhook_quarentena.motivo`. `ctwa-atribuicao.js` reexporta,
  para nao existir uma segunda definicao a manter em sincronia. Os testes antigos citavam
  `ORIGEM_EMPRESA.FALLBACK_*`, que passariam a ser `undefined` e continuariam VERDES por
  acidente — foram renomeados para voltar a asserir de verdade.
- **Impacto:** `sql/migrations/060_webhook_quarentena.sql` (aditiva, rollback no cabecalho),
  `src/services/webhook-quarentena.js` e `src/db/webhook-quarentena.js` (novos),
  `src/routes/api-webhook-quarentena.js` (nova), `src/middleware/tenant.js`,
  `src/webhook-handler.js`, `src/services/ctwa-atribuicao.js`, `index.js`, `package.json`
  (os testes novos precisavam entrar na lista explicita do script `test`, senao nunca
  rodariam), `frontend/components/PendenciasInstancia.tsx`, `frontend/lib/pendencias-instancia.js`
  e `frontend/app/dashboard/contextos/page.tsx`. Sem env nova, sem prompt, sem Meta.
- **Riscos:** (1) numero legitimo nao mapeado deixa de ser atendido ate o cadastro — visivel na
  tela de pendencias, resolvido por reprocessar; (2) `salvarConversa` mantem o COALESCE para a
  PJ, que continua servindo os OUTROS chamadores (dashboard/manual) e nao e mais alcancavel
  pelo webhook sem dono provado; (3) a migration 060 aplica sozinha no proximo boot.
- **Como validar:** `npm test` no `backend/` (1377, inclui `webhook-quarentena.test.js` e
  `webhook-quarentena-handler.test.js`) e `npm test` + `npm run typecheck` no `frontend/`; na
  tela, Configuracoes > Instancias mostra a secao so quando ha pendencia, e "Reprocessar"
  recusa enquanto a instancia nao estiver cadastrada.

---

## 2026-08-08 - Origem AUTORIZADA da instancia: fim da adocao e do reprocessamento

- **Decisao:** um vinculo empresa<->instancia so nasce do fluxo de criacao DENTRO do
  Atendimento Views. Instancia criada direto no Evolution nao pertence a empresa alguma e nao
  pode ser regularizada por tela administrativa. A evidencia de origem passa a ser PERSISTIDA
  junto do vinculo, na mesma transacao que o cria.
- **O defeito real nao estava na quarentena, estava na CRIACAO.** `POST /api/empresas/:id/whatsapp`
  engolia o 403/409 "already in use" do Evolution (variavel `alreadyExists`) e gravava o vinculo
  assim mesmo. Bastava digitar o nome de uma instancia criada por fora para o produto adota-la.
  Agora esse caso RECUSA com `409 INSTANCIA_JA_EXISTE_NO_EVOLUTION`. A quarentena (060) ja
  bloqueava corretamente o webhook; o que sobrava dela era o caminho de regularizacao.
- **Reprocessamento REMOVIDO** (`POST /api/webhook-quarentena/:id/reprocessar`,
  `resolverPendencia`, `buscarPendencia`, botao da tela): fechava a pendencia assim que alguem
  cadastrasse a instancia a mao. Vinculo criado depois nao prova como a instancia nasceu — era
  a adocao com aparencia de decisao humana informada. Consequencia assumida: **pendencia aberta
  e PERMANENTE**. Como a tabela guarda uma linha por instancia+motivo (nao uma por mensagem),
  ela nao cresce com o trafego. As colunas `resolvida_*` continuam LIDAS (historico do fluxo
  antigo); nada mais as escreve.
- **NOT NULL e SEM DEFAULT** em `origem_vinculo` (migration 061): um DEFAULT autorizaria
  silenciosamente qualquer INSERT futuro que esquecesse a coluna. Sem ele, o INSERT falha alto,
  na hora de escrever, e nao meses depois numa auditoria. `evidenciaDeOrigemAutorizada` NAO
  recebe a origem como parametro pelo mesmo motivo — so existe um valor que codigo novo tem o
  direito de escrever.
- **Carencia para o legado (decidida com o operador):** a migration marca as linhas existentes
  como `legado` (MUTACAO DE DADO declarada no cabecalho) e elas continuam atendendo. Exigir
  prova delas pararia todos os numeros ja conectados ate cada um ser recriado (nome tecnico
  novo, QR novo, reconexao). `legado` NAO e uma terceira origem autorizada: e a ausencia de
  prova, nomeada — e a tela de instancias marca "vinculo legado - origem nao comprovada".
- **Compensacao no Evolution:** se a transacao do vinculo falhar depois da criacao no Evolution,
  a rota apaga a instancia la. Sem isso ela ficaria orfa e, como o produto nao adota instancia
  externa, o operador ficaria impedido para sempre de reusar aquele nome. Excecao: `23505`
  (nome ja usado por outro vinculo no banco) NAO apaga, para nao derrubar numero em operacao.
- **A acao do motivo `instancia_desconhecida` mudou** de `mapear_instancia` para
  `auditar_origem_instancia`. O texto era o ultimo lugar por onde a regra vazava: mandar
  "cadastre e reprocesse" recria na cabeca do operador a adocao que o produto removeu.
- **Guardas de regressao lendo o FONTE** (`test/instancia-origem.test.js`): o defeito original
  nao era uma regra errada, era um `catch` que engolia o erro — teste de unidade nao pegaria
  isso de volta. As guardas verificam que `alreadyExists` nao voltou, que os TRES INSERTs de
  vinculo gravam a origem (um quarto ponto quebra o teste de proposito), que a rota nao tem
  verbo de escrita e que a tela nao chama escrita nenhuma.
- **O ULTIMO fallback para a PJ tambem saiu, no mesmo commit.**
  `resolverEmpresaPorInstance` (`src/db/whatsapp-instances.js`) devolvia o UUID da PJ nos tres
  casos em que nao provava a origem (nome ausente, instancia nao mapeada, erro de consulta) —
  o mesmo defeito que a quarentena fechou no webhook, sobrevivendo num segundo resolvedor.
  Auditoria antes de remover: **nenhum chamador de producao** (o unico import no repositorio
  inteiro era `test/multitenant.test.js`; o resolvedor do webhook e
  `findEmpresaEInstanciaPorEvolution`, em `src/db/empresas.js`). Removido de todo modo — um
  fallback sem chamador e so um fallback esperando um chamador, e este ja tinha a forma exata
  do bug que acabou de custar uma migration para corrigir. Agora devolve `null`; falha TECNICA
  nao e cacheada, para a proxima tentativa reconsultar o banco (ausencia por erro transitorio
  nao pode virar veredito por 2 minutos). Os tres testes que exigiam a PJ passaram a exigir a
  ausencia, e uma guarda le o fonte do modulo para falhar se o UUID voltar.
- **Nao mexemos nos outros `PJ_EMPRESA_ID` do repo**, de proposito: eles nao resolvem tenant
  por instancia — sao o escopo do dashboard legado single-tenant e defaults de ESCRITA
  (`db-crud.js`, `db/lead-profile-empresa.js`, ja tratados na Fase A). Junta-los aqui
  misturaria dois problemas num diff.
- **Impacto:** `sql/migrations/061_instancia_origem_autorizada.sql` (nova),
  `src/services/instancia-origem.js` (novo), `src/db/whatsapp-instances.js`,
  `test/multitenant.test.js`, `src/routes/api-whatsapp.js`,
  `src/routes/api-freelandoo.js`, `src/routes/freelandoo-provision.js`,
  `src/routes/api-webhook-quarentena.js`, `src/db/webhook-quarentena.js`,
  `src/services/webhook-quarentena.js`, `package.json` (o teste novo precisava entrar na lista
  explicita do script `test`, senao nunca rodaria — mesma armadilha da tarefa anterior),
  `frontend/components/PendenciasInstancia.tsx`, `frontend/components/InstanciasWhatsApp.tsx`,
  `frontend/lib/pendencias-instancia.js` (+ `.d.ts`/`.test.js`). Sem env nova, sem prompt, sem
  Meta, sem credencial.
- **Riscos:** (1) numero cujo vinculo nao veio do produto nao e atendido e NAO ha como liberar
  por tela — e o comportamento pedido, o custo e operacional; (2) o legado segue atendendo, e
  se algum foi adotado de fora pelo defeito antigo, so sai sendo removido a mao; (3) nome
  tecnico ja existente no Evolution passa a recusar a criacao — operador que reusava nomes vai
  bater nisso e precisa escolher outro; (4) a migration 061 aplica sozinha no proximo boot e
  muta dado (backfill `legado`).
- **Como validar:** `npm test` no `backend/` (1388) + `npm run typecheck`, e `npm test` (151) +
  `npm run typecheck` no `frontend/`; na tela, criar instancia com nome ja existente no
  Evolution deve devolver a recusa, e Configuracoes > Instancias mostra "Instancias
  bloqueadas" sem nenhum botao.
- **Limpeza colateral no mesmo commit:** `test/webhook-quarentena.test.js` tinha um byte NUL
  CRU numa string de teste (o caso "controle vira espaco"), o que fazia o git tratar o arquivo
  como BINARIO — diff e revisao cegos num arquivo de teste de isolamento. Trocado pelo escape
  `\u0000`, mesmo comportamento. O `Bin` ainda aparece neste commit porque o lado do HEAD e
  binario; a partir do proximo, o diff volta a ser texto.

---

## 2026-08-08 — Follow-ups: fila unica de acoes (abas viram filtros)

- **Decisao:** a pagina de Follow-ups passa a ter UMA fila operacional, ordenada pela proxima
  acao de cada conversa, com filtros rapidos (Todos, Aguardando, Proxima acao hoje, Atendimento
  humano, Atendimento IA, Falhas, Concluidos) e filtro avancado num painel flutuante. As abas
  "Atendimento humano" e "Automatico" viraram FILTROS; "Automacao" (configurar/pausar/capacidade/
  reprocessar/diagnosticar) virou area separada.
- **Por que:** as abas organizavam pela ORIGEM do item (quem produziu), nao pelo trabalho. O
  operador decide por conversa e por proxima acao; a origem e atributo, e continua visivel e
  filtravel.
- **Uma linha por CONVERSA, nao por registro:** `call-list` e `auto` descrevem o mesmo
  atendimento. Quando os dois existem para o mesmo numero, a acao HUMANA e a proxima acao da
  linha e o automatico vira contexto. Duas linhas recriariam a fragmentacao dentro da fila unica.
  A linha aparece nos filtros "humano" e "IA" — verdade, nao duplicidade.
- **"Todos" = em aberto.** Concluido/cancelado/falha so entram pelos proprios filtros. Falha e
  diagnostico, nao tarefa; o reprocessamento continua exclusivamente em Automacao.
- **Prioridade nao e inventada:** agendamento automatico nao passa pelo call score, entao a
  bolinha e vazada e diz "prioridade nao calculada", com opcao propria no filtro. Numero errado
  numa fila de trabalho custa mais caro que numero ausente (AGENTS.md: nao criar painel com dado
  incerto).
- **Contrato ADITIVO no backend:** `services/followup-call-score.js` passa a publicar
  `janela_quando` ('agora'|'hoje'|'proximo_dia_util') junto da frase, calculados pela MESMA
  funcao (`avaliarJanelaAcao`) — dois calculos independentes divergiriam e a tela mostraria
  "Hoje" num item que o filtro de hoje ignora. Alternativa recusada: o front interpretar o
  prefixo da frase, o que poria regra de negocio no front e quebraria em silencio.
- **`app.followup_config.modo` deixou de ser escrito pela tela.** Auditoria: nenhum motor le
  essa coluna (`followup-auto.js` le so `fc.pausado`); antes, clicar numa aba gravava
  configuracao da empresa. Filtro e preferencia de TELA e foi para o `localStorage`
  (`followupsFila`). Coluna, CHECK da migration 031 e contrato de `/config` intactos.
- **"Manual" nao virou filtro:** e um compositor 1:1 (funcao distinta nao vira filtro). Virou
  botao do cabecalho da fila + acao dos itens com recomendacao "mensagem manual". Mesmos
  endpoints (`/manual/gerar`, `/manual/enviar`), mesma revisao humana antes do envio.
- **Lacunas declaradas (nao implementadas por falta de fonte):** filtro por RESPONSAVEL (item
  nao tem dono; `usuario_id` so existe em ligacao ja registrada) e por TIPO DE FALHA (o motor
  grava `motivo_decisao` em texto livre, sem taxonomia — o filtro oferecido e "motivo contem").
  O filtro de PERIODO alcanca so item com data real (agendado/enviado): acao humana tem janela
  recomendada, nao data, e entra em "hoje" pelo `janela_quando`, nao pelo periodo.
- **Impacto:** `frontend/app/dashboard/follow-ups/page.tsx` (reescrita da tela),
  `frontend/lib/followups-fila.js` (novo, PURO) + `.d.ts` + `.test.js`,
  `backend/src/services/followup-call-score.js`, `backend/src/services/followup-listing.js`,
  `backend/test/followup-call-score.test.js`. Sem migration, sem env nova, sem rota nova, sem
  mudanca em envio, elegibilidade, permissao ou historico.
- **Riscos:** (1) a fila agora depende de `GET /auto?limit=300`; empresa com historico muito
  grande ve so os 300 registros mais recentes do automatico (a fila de trabalho em aberto nao e
  afetada na pratica, mas "Concluidos" e um recorte, nao o historico completo); (2) `modo`
  fica congelado no valor atual no banco, sem UI para altera-lo — proposital, mas se alguem
  voltar a ler a coluna vai ler um valor parado; (3) a marca "na capacidade do dia" usa a fila
  inteira, entao muda quando a fila muda, nao quando o filtro muda.
- **Como validar:** `npm test` no `backend/` (1390) + `npm run typecheck`; `npm test` (168) +
  `npm run typecheck` no `frontend/`. Na tela: filtro rapido nao pode disparar requisicao de
  escrita; "Personalizar filtros" abre/fecha por teclado (Escape) e devolve o foco ao botao;
  cada bolinha de prioridade tem nome acessivel.

## 2026-08-10 - Modo de atuacao da IA por conversa (Conversa / Analise)

- **Decisao central: `modo_ia` e uma COLUNA NOVA, separada de `agente_pausado`.** Nao se
  deriva um do outro e nenhum dos dois escreve o outro. Sao dois fatos independentes sobre a
  mesma conversa, com donos e tempos de vida diferentes:
  `agente_pausado` e estado OPERACIONAL efemero, escrito pelo PROPRIO SISTEMA (o
  `conversa-manual.js` liga sozinho quando um atendente envia mensagem; `followup-auto.js`
  liga quando o lead frio esgota tentativas; encerrar ligacao com `sem_interesse` tambem
  liga). `modo_ia` e DECISAO do operador sobre o atendimento, persistente, so muda por acao
  explicita dele. Alternativa recusada: um terceiro valor em `agente_pausado`. Ela faria a
  pausa automatica (um atendente respondeu uma vez) APAGAR uma decisao de configuracao, e
  faria a decisao de configuracao sobreviver ao "Retomar agente" — dois bugs simetricos.
  O envio automatico exige os DOIS liberados; a checagem da pausa continua onde sempre
  esteve e nao foi tocada.
- **O bloqueio NAO vive no webhook, e isso e o ponto do desenho.** `webhook-handler.js` nao
  envia nada: ele enfileira o job `webhook_resposta`. E dentro desse turno que a IA analisa
  (extracao, lead_insights, perfil, interesse, objecoes) E redige. Um `return` no webhook
  desligaria a inteligencia junto com a fala — exatamente o oposto do pedido. O gate vive nos
  DOIS enviadores (`core-funnel.js` e `services/contexto2-responder.js`), depois da analise
  ja persistida e imediatamente antes do `enviarMensagem`. Guarda de regressao em
  `test/conversa-modo-ia.test.js` falha se `modo_ia` reaparecer em `webhook-handler.js`.
- **Modulo de POLITICA em vez de condicionais espalhadas** (`src/services/conversa-modo-ia.js`,
  PURO). Ele nao pergunta "qual o modo?" e sim "esta capacidade esta liberada?". A matriz
  `modo x capacidade` e a regra inteira: `analise` (sempre) · `resposta_conversacional` (so
  no modo Conversa) · `follow_up` e `agenda` (SEMPRE, nos dois modos). Follow-up e agenda
  aparecem na matriz de proposito: e o que impede alguem, depois, de "aproveitar" o modo
  Analise como pausa global de automacao.
- **A capacidade vem de QUEM CHAMA, nao do modo.** `gerarEEnviarRespostaWhatsapp` serve dois
  clientes: a resposta conversacional (webhook) e a execucao de follow-up
  (`followup-execution.js`). Sem declarar a capacidade, o gate barraria os dois e o toggle
  viraria, em silencio, um interruptor de follow-up. Quem omite recebe
  `resposta_conversacional` (o caminho governado) — o default e o mais restrito.
- **A mensagem gerada e nao entregue e DESCARTADA, nunca gravada como `assistant`.** Grava-la
  faria o painel exibir ao operador um balao do agente que o cliente nunca recebeu, e o turno
  seguinte raciocinaria sobre uma fala que nao existiu. Pelo mesmo motivo,
  `atualizarCamadaMemoriaVendasPosResposta` (que registra O QUE O AGENTE DISSE) passou a
  depender de `respostaEnviadaAoLead` — que ja existia e sempre foi `true` neste ponto, entao
  o modo Conversa nao muda. A sugestao para revisao humana e o "Orientar resposta" que ja
  existe: gera, o atendente edita e envia. Nenhum armazenamento novo foi criado para isso.
- **O flag morto `reterMensagemParaAprovacao` (fixo em `false` desde 2026-06-06) virou o
  seam da mudanca.** Reusar a retencao que ja estava plumbada evitou espalhar `if` pelos 7
  pontos de envio do funil legado: hoje e um booleano so, calculado uma vez por turno.
- **Custo de IA declarado: o modo Analise NAO economiza.** Extracao e mensagem saem da MESMA
  chamada de LLM nos dois motores (`extrairEDecidirBundle` no playbook, `chamarClaudeTurno`
  no legado). O turno roda inteiro e a mensagem e descartada. Separar analise de redacao
  seria refatorar o motor — fora do escopo declarado.
- **Risco residual aceito:** o comando `/followup` do operador no WhatsApp cai no ramo
  "fluxo_funil" quando a ultima mensagem e do lead, e como follow-up e independente do modo,
  ele RESPONDE o cliente mesmo em Analise. E acao humana explicita e coerente com a regra de
  produto ("follow-up nao depende do toggle"), mas e a unica porta pela qual sai texto de IA
  numa conversa em Analise. Fechar exigiria distinguir follow-up agendado de follow-up
  comandado — uma linha, se o operador quiser.
- **Consequencia observada (nao e regra):** o watcher de follow-up automatico exige
  `historico->-1->>'role' = 'assistant'`. Como em Analise nada e anexado, conversas nesse modo
  raramente entram na fila do watcher. Nenhuma condicional de modo foi adicionada ao
  follow-up — o efeito vem de nao haver mensagem do bot, igual a qualquer turno sem resposta.
- **Impacto:** migration `063_conversa_modo_ia.sql` (aditiva, `NOT NULL DEFAULT 'conversa'`,
  CHECK fechado, nenhum dado mutado), `src/services/conversa-modo-ia.js` (novo, PURO),
  `core-funnel.js`, `services/contexto2-responder.js`, `followup-execution.js`,
  `services/conversa-manual.js` (`alterarModoIaConversa`), `routes/api-conversas.js`
  (`PATCH /:numero/modo-ia`), `frontend/lib/conversa-modo-ia.js` (+ `.d.ts`/`.test.js`),
  `frontend/components/ui/AlternadorModoIa.tsx` (novo), `frontend/components/ConversaPainel.tsx`.
  Sem tabela nova (auditoria em `app.auditoria_eventos`), sem variavel de ambiente nova,
  sem alteracao em `webhook-handler.js`, `followup-auto.js` ou `agenda.js`.
- **Como validar:** `npm test` no `backend/` (1444; 2 falhas conhecidas de rede 429 em
  `core.test.js`) + `npm run typecheck`; `npm test` (274) + `npm run typecheck` no `frontend/`.
  Na tela: alternar o modo com o teclado (setas dentro do radiogroup), tooltip abrindo no
  FOCO e nao so no hover, e o modo persistindo ao fechar e reabrir a conversa.

---

## 2026-08-11 — Instancia de ENVIO: regra unica, sem fallback (Fase 2)

- **Decisao 1 — a correcao e a CADEIA, nao os chamadores.** O plano (§9 de
  `analise-contexto-instancia.md`) pedia "passar `instanceName` nos 4 caminhos de §2.4".
  Divergimos de proposito: mesmo quem ja passava `instanceName` nao tinha o nome verificado, e
  os passos 2b (`ORDER BY atualizado_em DESC LIMIT 1`) e 3 (`process.env.EVOLUTION_INSTANCE ||
  'PJ'`) continuariam vivos para todo o resto. A regra virou UMA, em `src/whatsapp.js`
  (`resolverInstanciaEnvio`), sobre vocabulario PURO em `src/services/instancia-envio.js`.
- **Decisao 2 — o gate pergunta "esta instancia esta PROVADA?", nao "qual instancia usar?".**
  A segunda pergunta admite resposta por heuristica, e foi ela que produziu o defeito. Mesmo
  molde de `services/conversa-modo-ia.js` (matriz fechada) e da quarentena de webhook.
- **Decisao 3 — a direcao do cruzamento e "a instancia nomeada pertence a empresa esperada?"**,
  nunca "a empresa escolhe uma instancia". A empresa e conferida contra DUAS fontes (a da
  conversa e a declarada pelo chamador): conferir so uma deixaria a conversa orfa
  (`empresa_id` nulo) virar porta para o numero de outro tenant. Conversa orfa continua
  enviando pela instancia gravada nela — o dono efetivo passa a ser o `empresa_id` da propria
  instancia, que e NOT NULL.
- **Decisao 4 — instancia explicita diferente da gravada na conversa e ACEITA** (mesma
  empresa) e apenas LOGADA. Bloquear quebraria o disparo do Banco de Leads e o teste de
  numero, que sao escolhas humanas. Quem garante que a conversa nao migra e a precedencia de
  ESCRITA (D-8), nao o julgamento do envio.
- **Decisao 5 — D-8 aplicado agora, junto.** `db-crud.js` fazia `COALESCE(EXCLUDED, existente)`
  e a conversa MIGRAVA de numero sozinha; os outros dois writers ja preservavam. Sem alinhar,
  o vinculo em que a Fase 2 se apoia seria instavel. **Consequencia aceita:** lead que passa a
  falar com outro numero da mesma empresa continua recebendo pelo numero ORIGINAL.
- **Decisao 6 — D-7 antecipada.** O plano dizia remover `EVOLUTION_INSTANCE` "so depois da
  Fase 2". Como esta entrega fechou TODOS os chamadores de uma vez, manter o env seria manter
  o proprio defeito de pe. Ele esta aposentado, com guarda de regressao.
- **Decisao 7 — alertas e comandos do operador tambem tem vinculo provado.** O alerta sai pela
  instancia do LEAD que o originou; o comando do operador e respondido pela instancia que
  RECEBEU a mensagem dele (`req.evolutionInstance`). Antes, os dois saiam pelo numero do env —
  o operador de um tenant podia ser avisado pelo numero de outro.
- **Consequencias declaradas e aceitas (coisas que DEIXAM de sair):** resumo diario da agenda,
  relatorio diario de prospeccao aos operadores e o disparo LEGADO de prospeccao para prospect
  sem conversa. Os tres nao tem vinculo provado com instancia alguma. Todos bloqueiam com
  registro (o relatorio, por operador, em `metadata_json.envio_operadores`). Preferimos um
  aviso que nao sai a um aviso que sai pelo numero errado — e o mesmo criterio da quarentena.
- **Divida tecnica declarada:** `backend/tools/build-split.cjs` (ferramenta de migracao de um
  monolito antigo, sem chamador e fora do `package.json`) ainda gera um `src/whatsapp.js` com
  `INSTANCE_NAME`. Se alguem a rodar, destroi o repo inteiro — nao so este modulo. Nao foi
  tocada por estar fora do escopo; a guarda de regressao de `test/instancia-envio.test.js`
  quebra se o resultado dela for commitado.
- **Impacto:** `src/services/instancia-envio.js` (novo, PURO), `src/whatsapp.js`,
  `src/services/conversa-manual.js`, `src/db-crud.js`, `src/followup-execution.js`,
  `src/agenda.js`, `src/prospecting.js`, `src/services/prospecting-send-worker.js`,
  `src/services/prospecting-daily-report.js`, `src/services/followup-manual.js`,
  `src/handoff-alerts.js`, `src/core-funnel.js`, `src/agent.js`, `src/operator-commands.js`,
  `src/webhook-handler.js`, `src/media-processing.js`, `src/whatsapp-routes.js`,
  `test/instancia-envio.test.js` (novo), `test/conversa-manual.test.js`, `package.json`,
  `.env.example`, `AGENTS.md`, `docs/analise-contexto-instancia.md`.
  **Sem migration, sem rota nova, sem variavel de ambiente nova** (uma foi aposentada).
- **Como validar:** `npm test` no `backend/` (1503/1503) + `npm run typecheck` (limpo).
  Nenhuma mensagem real foi enviada e nada foi executado contra producao.

## 2026-08-12 - Disponibilidade de canal por CONTATO: quem diz que nao tem WhatsApp e uma PESSOA

- **Caso que motivou:** Elite Auto Renovadora foi reagendada para WhatsApp depois de o
  operador ja saber que aquele contato nao tem WhatsApp. O conhecimento existia — na cabeca
  de quem ligou — e nao tinha onde ser gravado: o reagendamento move prazo/prioridade/texto e
  o canal ficava congelado no que a ligacao havia sugerido.
- **Decisao 1 — tabela NOVA, e nao `prospectador.prospects.tem_whatsapp`.** Aquela coluna e
  escrita AUTOMATICAMENTE (`rodar-leads.js` chama `marcarDisparoFalhou(..., semWhatsapp=true)`
  quando o Evolution responde `exists:false`): uma FALHA TECNICA vira, sozinha, veredito sobre
  o contato. Guardar as duas coisas na mesma coluna tornaria impossivel distinguir "o operador
  verificou" de "o provider errou uma vez". Alem disso ela e por PROSPECT, e follow-up nao tem
  prospect obrigatorio. `tem_whatsapp` NAO foi tocada e continua governando o Banco de Leads.
- **Decisao 2 — a garantia de "so humano" vive no BANCO.** `origem` e NOT NULL, **sem DEFAULT**
  e com CHECK fechada em `'operador'` (mesmo motivo de `origem_vinculo`, migration 061). Para
  um job marcar disponibilidade seria preciso alterar o schema, o que quebra o anti-drift de
  `test/domain-enums.test.js`. Ha guardas que leem o fonte e falham se o modulo passar a
  conhecer Evolution, `exists:`, timeout ou provider.
- **Decisao 3 — TRES estados, e `null` nao e `false`.** Ausencia de linha = "ninguem
  verificou" e MANTEM o comportamento historico (WhatsApp). Tratar "nao sei" como "nao tem"
  mandaria todo contato novo para ligacao — o oposto do que o sistema faz hoje, e uma decisao
  que ninguem tomou.
- **Decisao 4 — e-mail fica para FASE SEPARADA, declarada e nao silenciosa.** A prioridade
  pedida era "sem WhatsApp -> e-mail confirmado -> ligacao". O primeiro salto nao tem para
  onde ir: `follow_ups_canal_chk` (migration 062) e fechada em `whatsapp|ligacao` e **nenhuma
  tela sabe EXECUTAR um follow-up de e-mail**. Criar o valor `email` sem executor produziria
  itens que entram na fila e nunca saem dela — pior que a ausencia do canal. O salto efetivo e
  `ligacao`, e sempre ha telefone porque o telefone E a identidade do contato. E-mail de
  cadastro/anotacao e CANDIDATO, nunca confirmado: promove-lo sozinho repetiria, do outro
  lado, o erro de deduzir disponibilidade sem verificacao humana. `EMAIL_FASE_SEPARADA`
  registra isso no codigo, com o motivo escrito e teste que o cobra.
- **Decisao 5 — "sem e-mail nem telefone" NAO virou regra nova.** Nao existe contato assim
  neste modelo: `telefone_digitos` e NOT NULL (8..15 digitos) na migration 062. Uma regra para
  um estado inalcancavel seria codigo morto nascendo pronto.
- **Decisao 6 — marcacao e troca de canal na MESMA transacao.** Trocar o canal de um item
  aberto pode colidir com o indice unico parcial `follow_ups_um_aberto_por_canal_uk` (ja
  existe uma ligacao aguardando para o contato). Nesse caso a transacao INTEIRA volta atras e
  a rota responde **409 explicativo**: nunca fica o contato marcado com o trabalho no canal
  errado. Nao se funde nem se sobrescreve o item existente — cada um carrega origem e contexto
  proprios.
- **Decisao 7 — DESFAZER reescreve a mesma linha, mas NAO devolve o item ao WhatsApp.**
  "Tem WhatsApp" torna o canal possivel de novo; quem moveu o trabalho para ligacao foi uma
  decisao registrada, e revoga-la automaticamente mandaria o trabalho de volta a um canal que
  talvez ninguem queira mais usar naquele contato.
- **Decisao 8 — o canal continua FORA do formulario de reagendamento.** Trocar de canal a mao
  segue sendo outra decisao, tomada onde a acao e executada. O que existe agora e a troca como
  CONSEQUENCIA de um fato declarado sobre o contato. `validarReagendamento` ganhou apenas
  `permitirPatchVazio`: marcar disponibilidade sem mexer em prazo nem prioridade e mudanca
  legitima, e recusa-la com "Nada para reagendar" obrigaria o operador a inventar uma
  alteracao para salvar o que ele sabe.
- **Decisao 9 — a tela nao regrava veredito que nao mudou.** `patchDisponibilidade` so envia
  `whatsapp_disponivel` quando o operador MUDOU o valor no modal; reenviar o mesmo veredito
  gravaria `marcado_por`/`marcado_em` novos e uma linha de auditoria a cada mexida na data,
  fazendo parecer que alguem reverificou o contato toda vez.
- **Consequencia declarada e aceita:** enquanto o canal de e-mail nao existir, todo contato
  marcado como sem WhatsApp vai para LIGACAO — inclusive quando ha e-mail conhecido no
  cadastro. E o unico canal que o produto sabe executar hoje.
- **Impacto:** `sql/migrations/066_contato_canal_disponibilidade.sql` (nova, ADITIVA),
  `src/services/contato-canal-disponibilidade.js` (novo, PURO),
  `src/db/contato-canal-disponibilidade.js` (novo), `src/db/follow-ups.js`,
  `src/services/follow-up-modelo.js`, `src/routes/api-follow-ups.js`, `src/domain-enums.js`,
  `test/contato-canal-disponibilidade.test.js` (novo), `test/domain-enums.test.js`,
  `test/follow-up-modelo.test.js`, `frontend/lib/follow-up-acao.js` (+ `.d.ts`/`.test.js`),
  `frontend/lib/followups-fila.js` (+ `.d.ts`),
  `frontend/app/dashboard/follow-ups/page.tsx`, `AGENTS.md`.
  **Nenhuma variavel de ambiente nova, nenhuma rota nova** (o `POST /itens/:id/reagendar`
  ganhou dois campos OPCIONAIS; quem nao os envia mantem o comportamento anterior).
- **Como validar:** `npm test` no `backend/` (1505/1505) + `npm run typecheck` (limpo);
  `npm test` no `frontend/` (316/316) + `npm run typecheck` + `npm run build` (limpos).
  Nada foi executado contra producao, nenhum banco real foi escrito e nenhuma mensagem foi
  enviada.

---

## 2026-08-13 — Fase 2 (fechamento): as rotas que enviam a pedido de uma PESSOA

Complemento da entrega de 2026-08-11 (acima), feito depois de reler o repo inteiro atras de
envio que ainda escapasse da regra unica.

- **Decisao 8 — bloqueio de instancia e 409, nunca 502, em TODAS as rotas que enviam a pedido
  de uma pessoa.** Eram tres e so uma cumpria o contrato: envio manual do operador
  (`services/conversa-manual.js`, ja com `409 INSTANCE_UNAVAILABLE`), reenvio da conversa
  (`POST /api/empresas/:id/conversas/:numero/reprocessar`) e teste de saudacao
  (`POST .../whatsapp/:id/saudacao/testar`) — as duas ultimas devolviam 502. A diferenca nao e
  cosmetica: 502 diz "a Evolution falhou" e manda o operador procurar defeito no transporte,
  quando o problema esta no CADASTRO (instancia inativa, de outra empresa, de outro canal) e a
  acao que resolve e dele.
- **Decisao 9 — as rotas de API declaram `empresaId` mesmo quando ja passam `instanceName`.**
  A regra unica confere a instancia contra DUAS empresas (a da conversa e a do chamador). Numa
  conversa ORFA (`empresa_id IS NULL`, alcancavel pela PJ em `conversaEmpresaScope`) a empresa
  da conversa e nula e sozinha nao prova nada: sem declarar a do chamador, a unica conferencia
  possivel some e a instancia de outro tenant gravada na conversa passaria. No teste de
  saudacao a instancia ja vem escopada pelo `SELECT`, mas declarar mantem a conferencia
  explicita no chamador em vez de implicita numa clausula de SQL que alguem pode afrouxar.
- **Decisao 10 — `scripts/test-evolution-send.js` exige a instancia como ARGUMENTO, sem
  default e sem env nova.** Ele manda mensagem REAL e lia `process.env.EVOLUTION_INSTANCE ||
  'PJ'` — o mesmo fallback global que a Fase 2 removeu do produto, sobrevivendo numa
  ferramenta que dispara para numero de verdade. Criar `EVOLUTION_TEST_INSTANCE` seria
  reintroduzir o default por outro nome.
- **Consequencia (d) declarada, que faltava:** o comando `APRESENTACAO` do operador no
  WhatsApp "nao requer conversa previa" e, por isso, deixa de funcionar para lead que ainda
  nao tem conversa. Mantivemos o bloqueio de proposito: usar ali a instancia do OPERADOR
  escolheria o numero por quem mandou o comando, e nao por quem e dono do lead — a mesma
  invencao de dono que a fase remove. **Se o operador quiser o comportamento antigo, isso e
  decisao de produto (esta na pergunta (b) do checkpoint), nao ajuste tecnico.**
- **Verificacao de que nada novo escapou:** master avancou ate `c80dd91` (canal de e-mail de
  follow-up) sem criar nenhum envio novo de WhatsApp; os unicos `EVOLUTION_INSTANCE` que
  restam no repo sao comentarios; todo envio/diagnostico Evolution passa por
  `instanceNameParaEnvio`, e as unicas chamadas diretas a Evolution fora de `whatsapp.js` sao
  de ciclo de vida da instancia (create/connect/delete/logout/webhook), nunca de mensagem.
- **Impacto:** `src/routes/api-conversas.js`, `src/routes/api-whatsapp.js`,
  `scripts/test-evolution-send.js`, `test/instancia-envio.test.js`, `AGENTS.md`.
  **Sem migration, sem rota nova, sem variavel de ambiente nova.**
- **Como validar:** `npm test` no `backend/` + `npm run typecheck`. Nenhuma mensagem real foi
  enviada e nada foi executado contra producao.
- **Consequencia (e) descoberta nesta releitura, NAO corrigida de proposito:** o banner
  "WhatsApp desconectado" do dashboard LEGADO parou de aparecer. `public/dashboard/js/
  prospeccao.js` e `js/sistema-alertas.js` chamam `GET /dashboard/prospeccao/whatsapp/status`
  sem `?instancia=`, e os dois so mostram o aviso quando `connected === false`; com
  `state: 'nao_informada'` o valor e `null` e o alerta nunca dispara. Corrigir exige decidir de
  QUAL instancia aquele painel fala — ele nao tem vinculo provado com nenhuma (o unico vinculo
  disponivel ali seria `vendas.whatsapp_connections` do usuario, a mesma fonte que as rotas
  legadas de QR passaram a usar). E decisao de produto, ligada a pergunta (d) do checkpoint, e
  nao ajuste tecnico: por isso ficou documentada como pendencia em vez de resolvida sozinha.
  **RESOLVIDA na entrada seguinte** (decisao (d)): o operador respondeu e o banner foi religado
  pelo vinculo do proprio usuario.

---

## 2026-08-13 — Fase 2 (fechamento): as 4 decisoes de produto e o banner religado

- **Contexto:** o checkpoint da Fase 2 tinha 4 perguntas de produto em aberto. O operador
  respondeu as 4 seguindo a recomendacao. Tres delas **confirmam o codigo como esta** e nao
  geraram nenhuma linha nova; a quarta e implementacao.
- **Decisao (a) — empresa com exatamente 1 instancia ativa NAO conta como vinculo comprovado.**
  Sem nome vindo do chamador ou da conversa, o envio segue bloqueado (409
  `INSTANCIA_NAO_COMPROVADA`). "So tem uma" e um fato de HOJE: a segunda instancia chega sem
  aviso e transformaria, em silencio, uma regra em heuristica. **Nenhuma mudanca de codigo.**
- **Decisao (b) — alertas e comandos do operador mantidos como estao.** Alerta sai pela
  instancia do LEAD que o originou; resposta a comando do operador sai pela instancia que
  RECEBEU a mensagem dele (`req.evolutionInstance`); `APRESENTACAO` continua exigindo conversa
  ja existente. **Nenhuma mudanca de codigo.** Nota do operador para o futuro, **nao
  implementada agora**: se a limitacao do `APRESENTACAO` para lead novo incomodar no dia a dia,
  a saida sera permitir a instancia do OPERADOR **apenas** quando o lead ainda nao tem conversa.
- **Decisao (c) — D-8 confirmado:** a instancia ja gravada numa conversa nunca migra sozinha
  (`COALESCE(NULLIF(BTRIM(existente),''), EXCLUDED)` nos tres writers). **Nenhuma mudanca de
  codigo.**
- **Decisao (d) — o banner do painel legado foi RELIGADO pelo vinculo do proprio usuario**
  (`vendas.whatsapp_connections.instance_name`), a mesma fonte que as rotas de QR
  `/dashboard/whatsapp/*` ja usam. Alternativas descartadas: (1) voltar ao env — e o defeito da
  fase; (2) escolher a instancia ativa da empresa — inventa dono; (3) aposentar as rotas
  legadas agora — e o destino certo, mas e fase propria, e ate la o operador fica sem aviso de
  desconexao.
- **A resolucao ficou no BACKEND, na propria rota**, e nao nos dois consumidores. O painel
  legado nao conhece o nome tecnico da instancia, e passa-lo ao front so para ele devolver na
  query string exporia um identificador sem necessidade e colocaria regra de negocio no
  dashboard estatico (proibido pelo `AGENTS.md`). `?instancia=` mantem precedencia; sem ele,
  vale o vinculo. **`instanciaVinculadaAoUsuario` virou exportada em `src/whatsapp-routes.js` e
  e reusada** por `prospecting.js` — nao foi copiada: duas consultas ao mesmo vinculo poderiam
  divergir e o banner falaria de um numero enquanto o botao "Reconectar" mexe em outro.
- **Consequencia declarada:** sem vinculo (usuario legado sem linha em
  `vendas.whatsapp_connections`, ou acesso por `x-reprocess-secret`, que nao tem usuario) o
  diagnostico continua devolvendo `nao_informada` e o banner segue calado. Como o `INSERT` de
  `connect` foi removido nesta fase, esse vinculo so nasce pelo fluxo autorizado. Calar e
  melhor que alertar sobre a saude do numero de outra pessoa.
- **Divida tecnica registrada:** as rotas legadas `/dashboard/whatsapp/*` seguem vivas. O
  destino combinado e aposenta-las, em fase propria.
- **Impacto:** `src/prospecting.js` (rota de status), `src/whatsapp-routes.js` (export +
  guarda `if (!userId) return ''`), `public/dashboard/js/prospeccao.js` (saiu o nome fixo
  `pj-dashboard-1` do aviso), `test/instancia-envio.test.js` (2 guardas novas), `AGENTS.md`.
  `js/sistema-alertas.js` **nao precisou mudar**: ele ja lia `connected === false` e volta a
  receber `false` sozinho. **Sem migration, sem rota nova, sem variavel de ambiente nova.**
- **Como validar:** `npm test` no `backend/` + `npm run typecheck`. Nenhuma mensagem real foi
  enviada e nada foi executado contra producao.

---

## 2026-08-18 — Campanha de validacao da oferta de entrada Tenka Tech (DADOS, nao codigo)

> **Natureza desta entrada:** nenhuma linha de codigo, prompt, migration, rota ou tela foi
> alterada. O que mudou foi **DADO DE PRODUCAO**, criado pela API do proprio produto (nunca
> por SQL direto), dentro da empresa **PJ Codeworks** (`f5f47737-3f48-44fd-a09a-f09e66f7ed85`).
> Diagnostico que fundamenta tudo: `docs/analise-processo-comercial-tenka.md`.

- **Decisao 1 — a oferta vive so na Central de Ligacoes, dentro da PJ.** Decisao do operador.
  Nenhum tenant novo, nenhuma instancia de WhatsApp, nenhum contexto/playbook de bot, nenhum
  prompt de producao tocado. **Consequencia direta e importante:** o bloqueio de pagamento dos
  validadores (`agent-validators.js:189`, `action-response-validator.js:223`) **nao se aplica**
  — ele governa mensagem gerada por IA, e aqui quem fala e um vendedor humano ao telefone.
  Nada a afrouxar, nada a condicionar por empresa.

- **Decisao 2 — escrever pela API, nunca por SQL direto.** As regras deste dominio moram na
  camada de dados (`src/db/roteiros.js`, `src/db/campanhas.js`, `prospecting.js`): imutabilidade
  da versao publicada, `assertMesmaEmpresa`, `assertRoteiroVersaoUtilizavel`, e a reserva
  `busca_snapshots` ANTES da chamada paga a Bright Data. Um `INSERT` a mao pularia todas elas e
  produziria estrutura que a aplicacao considera invalida.

- **Decisao 3 — roteiro de 6 etapas, com o peso na ABERTURA.** `abertura` → `situacao` →
  `insight` → `qualificacao` → `objecoes` → `proxima_acao`. Justificativa medida em producao,
  nao preferencia: das 130 ligacoes encerradas, **119 (92%) pararam na `abertura`**, a duracao
  media e **37s**, e as etapas 4+ dos roteiros existentes somam 39 ocorrencias historicas.
  A oferta inteira (site, ate 24h, R$300, 12 meses de hospedagem) e dita **na abertura**, nao
  depois de descoberta.

- **Decisao 4 — `convite_reuniao` fica FORA da sequencia padrao.** `app.agenda_eventos` esta
  vazia: a etapa existe nos 5 roteiros anteriores e **nunca produziu uma reuniao** em 145
  ligacoes. Ela vira orientacao textual dentro de `proxima_acao`, para os tres casos do
  briefing (duvida importante, escopo fora do padrao, decisor pede demonstracao). O tipo de
  etapa continua existindo no enum e nos roteiros antigos — nada foi removido.

- **Decisao 5 — UM roteiro com ramificacoes internas, nao nove roteiros.** O schema tem uma
  `frase_sugerida` por etapa. As 4 variantes por situacao de site entram no corpo da etapa 1
  e as 5 por comportamento entram como objecoes/ramos nas etapas 1 e 5. Com 145 ligacoes de
  historico TOTAL, dividir a amostra em dois roteiros atrasaria o aprendizado.

- **Decisao 6 — nada de escassez, urgencia fabricada ou garantia inventada.** O gerador
  `src/services/geracao-frameworks.js` (que manda "criar escassez e urgencia... inclusive
  fabricadas", decisao de 2026-06-19) **NAO foi usado**: o roteiro foi escrito a mao. As quatro
  respostas factuais obrigatorias (Google, clientes, mensalidade, pos-12-meses) estao literais
  na etapa `objecoes`, incluindo o "Nao" explicito para garantia de posicao e de clientes.

- **Decisao 7 — nome do vendedor fica como marcador `[vendedor]`.** O operador ainda nao
  definiu quem liga. O texto do roteiro e lido por uma pessoa na tela; marcador e honesto e
  trocavel numa versao 2. Mesmo criterio para `[nome]`, `[clinica]` e `[procedimento]`.

- **Decisao 8 — a observacao real da clinica e OPCIONAL e vem em duas versoes.** A etapa 1
  traz a abertura COM observacao e a abertura SEM observacao, com a instrucao explicita de
  nao inventar. O briefing exige remover a parte quando nao houver dado confiavel.

- **Decisao 9 — registro de venda sem reuniao fica para depois.** Decisao do operador: rodar a
  campanha primeiro e medir pagamento, prazo de entrega e adesao a Base Tecnica fora do
  sistema. **Divida tecnica declarada:** `venda_valor` so existe atrelado a reuniao concluida
  (migration 057) e o ledger da Meta so nasce de reuniao — enquanto isso valer, a receita
  desta campanha e invisivel para o produto e nao gera `Purchase`.

- **Dados criados em producao (PJ Codeworks):**
  - nicho `Clinica de estetica` — `517eb58b-880f-48eb-8ae8-aa5830703686`
  - roteiro `TENKA | Vitrine Google Essencial | Clinicas de estetica` —
    `98ae97b9-8eb5-4ac4-a578-29ac641d75ac`, versao 1 **publicada**
    (`ea9d8ae8-bc3b-441b-b93d-3df9dee31471`), 6 etapas
  - campanha `TENKA | SITE 24H R$300 | CLINICAS DE ESTETICA | VALIDACAO 01` —
    `cb7e7c1c-a709-47ed-9467-ccd35cc63a45`, status `ativa`
  - coleta paga Bright Data Maps: `clinica de estetica em Sao Bernardo do Campo - SP`,
    busca `08f9d4ae-afc8-4af9-93dc-6fe7204fedb3`, snapshot `sd_mszhjupgxuav4f2pd` —
    **concluida**: 200 prospects importados, 192 com telefone, 127 sem site proprio (64%)
  - **192 leads vinculados a campanha** (`nao_iniciado`); os 8 sem telefone ficaram fora de
    proposito — a campanha e de ligacao — e seguem no Banco de Leads
- **NENHUMA campanha ou roteiro existente foi alterado, arquivado ou excluido.**
- **Como validar:** abrir `dashboard/roteiros` (roteiro novo, versao 1 publicada),
  `dashboard/aquisicao` (coleta em andamento/concluida) e a Central de Ligacoes com a campanha
  nova selecionada. `npm test` nao se aplica: nenhum arquivo de codigo mudou.

### Revisao no mesmo dia — versao 2 do roteiro (ancoragem de valor + SPIN antes da oferta)

Mudanca de direcao do operador. A v1 abria com a oferta na primeira frase; a v2 ancora VALOR,
percorre o SPIN e so entao apresenta a Vitrine.

- **Decisao 10 — 8 etapas, oferta na quinta.** `abertura` (ancoragem de valor + permissao) →
  `situacao` (S) → `problema` (P) → `implicacao` (I) → `insight` (N + **a oferta**) →
  `qualificacao` → `objecoes` (15) → `proxima_acao`. **Reverte parcialmente a Decisao 3**: o
  peso deixa de estar so na abertura. **Tensao declarada e aceita:** a media historica e de 37s
  e 92% das ligacoes terminam na abertura; a mitigacao e a instrucao, no proprio texto lido
  pelo vendedor, de que a ancoragem tem de caber em UMA respiracao. Primeiro numero a vigiar
  depois de ~30 ligacoes atendidas: `etapa_alcancada` em `app.vw_ligacoes_analiticas`.
- **Decisao 11 — a etapa `implicacao` proibe explicitamente numero inventado.** E a etapa onde
  um vendedor escorrega para medo e estatistica fabricada. O objetivo dela veda citar quantas
  pessoas procuram por mes, afirmar quanto a clinica perde, usar porcentagem, comparar com
  concorrente nominalmente ou dizer que ela esta "perdendo dinheiro". O movimento autorizado e
  PERGUNTAR e deixar a pessoa fazer a propria conta. A etapa `problema` autoriza DESISTIR: se a
  pessoa diz que esta tudo bem, seguir para qualificacao sem forcar dor.
- **Decisao 12 — a oferta vem com a negativa explicita, dita em voz alta.** "Eu nao vou
  prometer cliente nem primeiro lugar no Google, porque ninguem consegue garantir isso. O que a
  vitrine faz e ser a porta de entrada." O enquadramento PORTA DE ENTRADA e o que o operador
  pediu (a pessoa visualizar o caminho) sem virar promessa de resultado.
- **Decisao 13 — o plano de evolucao (R$150/mes) e SEMENTE, nao venda desta ligacao.** Plantado
  na etapa 8; o valor so e dito se a pessoa PERGUNTAR, sempre com a frase que separa os planos
  (o R$150 e opcional e NAO e necessario para manter o site no ar — para isso basta a Base
  Tecnica de R$60). Segue o briefing: oferecer depois da entrega ou quando a clinica ja perceber
  valor. Vender os dois na mesma ligacao seria outra decisao, e virou candidata a v3.
- **Decisao 14 — `[link do modelo de exemplo]` fica como MARCADOR.** A etapa 5 oferece mandar um
  modelo para a pessoa visualizar a propria pagina, mas **nao existe modelo da Tenka publicado**.
  O roteiro instrui a so enviar link REAL e a nunca inventar link ou case; sem modelo, o vendedor
  descreve a estrutura em uma frase. Inventar URL de portfolio seria prova social falsa.
- **Dados alterados em producao:** versao 2 do roteiro
  `205f9195-82c4-4ad5-bc42-869cb34437ef` (**publicada**, 8 etapas); versao 1
  (`ea9d8ae8…`) **arquivada automaticamente** por `publicarVersao`; campanha
  `cb7e7c1c…` repontada para a v2 (`assertRoteiroVersaoUtilizavel` so barra roteiro arquivado,
  nao versao). **Os 192 vinculos de lead nao foram tocados.** Nenhuma ligacao havia sido feita,
  entao a v1 nao deixou historico orfao.

### 2026-08-20 — versao 3: a narrativa do anuncio ("fachada digital") entra na ligacao

O operador definiu a logica do anuncio em 5 passos (dor -> causa -> solucao -> valor percebido
-> proximo passo) e pediu o roteiro alinhado a ela, para anuncio e ligacao contarem a MESMA
historia.

- **Decisao 15 — "fachada digital" vira o vocabulario, e a CAUSA vira DUPLA.** A v2 so tratava
  "nao te encontram"; o anuncio acrescenta "**ou nao entendem seus servicos**". A etapa
  `problema` ganhou pergunta propria pra segunda metade ("quem cai no perfil consegue entender
  rapido, ou precisa perguntar no direct?"). Nao e troca de palavra: e uma causa que o roteiro
  anterior nao cobria.
- **Decisao 16 — a copy do anuncio cabe na promessa POR CAUSA DE UMA PALAVRA.** "PODE estar
  perdendo clientes" e hipotese; "voce esta perdendo" e afirmacao nao verificavel e
  "voce vai ganhar" e promessa. A etapa 1 traz essa regra escrita no texto que o vendedor le.
  As proibicoes da Decisao 11 (nada de numero, porcentagem ou "perdendo dinheiro") continuam
  valendo integralmente na `implicacao`, agora reenquadrada como "oportunidade que passa batido"
  + a instrucao de perguntar e FICAR QUIETO.
- **Decisao 17 — objecao nova "o que e fachada digital?".** O termo e forte no anuncio mas nao
  e autoexplicativo ao telefone. Resposta ancorada no concreto: "o mesmo que a fachada da
  clinica na rua, so que na internet". Tambem entrou o ramo "ja viu o anuncio" -> nao repetir a
  ancoragem, pular para `situacao`.
- **Decisao 18 — o WhatsApp NAO foi tocado, e o risco fica declarado.** Decisao do operador. O
  anuncio termina em "envie uma mensagem", e hoje quem escreve cai no agente da PJ Codeworks:
  instancia `pj` ativa, contexto `pj-codeworks` com `runtime_ativo`, **agenda ligada**, catalogo
  Iniciante/Padrao/Premium (R$200-3.000) e reuniao de 15 min como destino — o agente **nao
  conhece** a oferta de R$300 em 24h. Some-se: `app.atribuicao_anuncios` tem **0 linhas** (a
  pendencia do AGENTS.md sobre `externalAdReply` no webhook nunca foi fechada) e nao ha registro
  de venda sem reuniao (Decisao 9). **Consequencia aceita: custo por venda de trafego pago e
  hoje impossivel de fechar dentro do produto.** Saidas registradas para quando for a hora:
  (a) instancia + contexto proprios da Tenka com agenda desligada; (b) trocar o CTA do anuncio
  para telefone/formulario. **Trocar o contexto da instancia `pj` NAO e saida** — mudaria o
  atendimento de todos os leads da PJ.
- **Dados alterados em producao:** versao 3 `6439d439-f1b5-4862-82a9-b70946467a60`
  (**publicada**, 8 etapas); versao 2 arquivada automaticamente; campanha repontada para a v3.
  **Os 192 vinculos de lead seguem intactos.** Nenhuma ligacao foi feita ate aqui, entao nenhuma
  versao deixou historico orfao. Marcadores ainda pendentes: `[vendedor]` e
  `[link do modelo de exemplo]`.

### 2026-08-24 — versao 4: revisao SPIN sobre 52 ligacoes REAIS

- **Decisao 19 — CORRECAO de um numero que orientou as decisoes 3 e 10.** "92% das ligacoes
  terminam na abertura" e ENGANOSO: `etapa_alcancada='abertura'` inclui quem nunca atendeu.
  Medido na campanha: 52 ligacoes, **6 atenderam (11,5%)**, 25 caixa postal (48%), e quem
  atendeu falou **125s em media** (nao 37s). Das 6, uma chegou na implicacao e outra na oferta;
  ha 1 lead em `negociacao` e 1 `qualificado`. **O gargalo e o contato, nao o roteiro** — a
  justificativa do roteiro curto da v1 nao se sustentava.
- **Decisao 20 — a pergunta de necessidade passa a ser ABERTA.** "Isso ajudaria voces?" e
  fechada e indutora: produz concordancia sem compromisso e soa manipulativa (Rackham e
  explicito sobre need-payoff indutora). Vira "o QUE mudaria no atendimento se...". Era o erro
  mais caro do roteiro anterior.
- **Decisao 21 — perguntas de situacao cortadas de 4 para 2.** Vendedor de sucesso faz MENOS
  perguntas de situacao porque pesquisa antes. Evidencia local: numa ligacao real o vendedor
  perguntou o nome da clinica, que estava na tela. A etapa agora manda LER a ficha (nome,
  cidade, endereco, nota, avaliacoes, situacao do site) e CONFIRMAR o que foi pesquisado, em vez
  de perguntar do zero — confirmar constroi credibilidade, perguntar do zero destroi.
- **Decisao 22 — implicacao passa a ser sobre CUSTO INTERNO.** Quantas duvidas repetidas por
  dia, quem responde, quanto tempo a pessoa espera. E verificavel pela propria cliente e **nao
  exige nenhuma estatistica de mercado** — resolve elegantemente a trava da Decisao 11, que
  continua valendo integralmente.
- **Decisao 23 — resumo antes da oferta + oferta AMARRADA.** Demonstrar capacidade comeca
  resumindo as necessidades explicitas. E a oferta deixa de recitar 6 caracteristicas: apresenta
  2-3 elementos que respondem ao que ELA disse, amarrando cada um a fala dela.
- **Decisao 24 — a abertura NAO afirma mais a dor. REVERTE PARCIALMENTE a Decisao 16.**
  Necessidade dita pelo vendedor pesa menos que a dita pela compradora, e afirmar a dor de saida
  convida defesa (a objecao "minha agenda ja e cheia" existe por isso). Divisao adotada: **o
  anuncio cria a dor; a ligacao deixa a pessoa dize-la.** O vocabulario "fachada digital"
  permanece. Aprovado pelo operador em bloco; o texto anterior esta preservado na v3 arquivada.
- **Decisao 25 — nomear AVANCO vs CONTINUACAO.** Toda ligacao atendida termina com acao
  DATADA. "Vou pensar" / "me liga depois" e continuacao: a ligacao terminou cordial e fracassou.
  Sequencia do fechamento passa a ser checar preocupacoes -> resumir -> propor o avanco.
- **Decisao 26 — roteiro de CAIXA POSTAL, o resultado mais frequente (48%) e que nao tinha uma
  linha sequer.** Mensagem de ate 15s, **sem preco e sem pitch**: existe so para o numero nao
  ser desconhecido na proxima tentativa.
- **Decisao 27 — a escada vira CONDICIONAL.** Rackham: a vantagem do SPIN cresce com o TAMANHO
  da venda; em venda pequena, feature-benefit funciona. R$300/uma ligacao/uma decisora e venda
  pequena. Etapas 3 e 4 sao explicitamente pulaveis quando a pessoa ja demonstra interesse —
  forcar a escada com quem ja quer comprar so cria objecao.
- **Decisao 28 — qualificar por NECESSIDADE EXPLICITA.** Criterio zero: ela ENUNCIOU a
  necessidade com as palavras dela, ou so concordou? Concordancia nao e necessidade; se so
  concordou, voltar uma etapa antes de tentar fechar.
- **Achado tecnico (nao e decisao):** `validarEtapas` (`src/db/roteiros.js:29`) corta `objetivo`
  e `frase_sugerida` em **2000 chars SEM AVISAR** — o `PUT` responde 200 e o texto some. A v4 foi
  gravada com validacao de tamanho ANTES do envio. **v2 e v3 foram conferidas: nao houve corte.**
  Quem editar roteiro pela tela precisa saber disso.
- **Dados alterados em producao:** versao 4 `74a2a702-cdaa-422d-8cfc-ae31d7b5d047`
  (**publicada**, 8 etapas); v3 arquivada; campanha repontada. **192 vinculos intactos.**
  As 52 ligacoes ja feitas apontam para as versoes que estavam publicadas na epoca — historico
  preservado, que e exatamente para isso que o versionamento existe.
- **Fora do roteiro, e o que mais pesa agora (nao implementado — e operacao, nao dado):**
  44 dos 48 leads discados tiveram UMA tentativa; 72 dos 81 follow-ups de ligacao estao
  VENCIDOS; so 3 faixas de horario testadas (10h = 17% de atendimento, 15h = 7%, 16h = 0%);
  e ZERO objecoes e ZERO motivos de perda registrados em 52 ligacoes — sem esse dado, a v5 vira
  opiniao.

### 2026-08-24 — versao 5: "fachada digital" nunca aparece sozinha

- **Decisao 29 — o enquadramento fica, a palavra SITE anda junto.** "Fachada digital" da a
  imagem certa e conecta com o anuncio; "site" e a palavra que a pessoa entende. As duas juntas
  na primeira mencao de cada bloco ("o site de voces, a fachada digital da clinica"). A regra
  esta escrita no objetivo da etapa 1, valendo para o roteiro inteiro. **Motivo declarado:**
  termo novo ao telefone custa atencao, e a cliente precisa saber com todas as letras o que esta
  comprando — o risco fechado aqui e alguem aceitar uma "fachada digital" e descobrir depois que
  era um site, que e reclamacao de EXPECTATIVA, nao de entrega.
- **Decisao 30 — conferencia explicita antes do fechamento.** A qualificacao ganhou um item:
  se a conversa inteira falou so em "fachada digital", dizer uma vez "so pra deixar claro, e um
  site mesmo, no ar, com endereco proprio". Barato, e elimina a duvida no unico momento em que
  ela ainda custa pouco.
- **Guarda automatica:** o script de publicacao **aborta** se alguma etapa mencionar "fachada"
  sem conter "site". Verificado sobre o que ficou GRAVADO na API: "fachada" 12x, "site" 46x.
- **Estrutura SPIN da v4 inalterada** — as decisoes 19 a 28 continuam valendo integralmente;
  esta versao mexeu SO em vocabulario (abertura, caixa postal, oferta, negativa explicita,
  mensagem de WhatsApp e as 15 objecoes, revisadas uma a uma).
- **Dados alterados em producao:** versao 5 `a8a2d006-dea9-42d5-9336-1c9a23dd8e4e`
  (**publicada**); v4 arquivada; campanha repontada. **192 vinculos intactos.**

### 2026-08-24 — versao 6: correcao do PROCESSO (sem modelo, WhatsApp na hora, pagamento no final)

Correcao de fato comercial trazida pelo operador. Estrutura SPIN e vocabulario da v5 preservados.

- **Decisao 31 — NAO existe modelo, e o roteiro parou de prometer um.** O marcador
  `[link do modelo de exemplo]` foi **REMOVIDO** (nao ficou pendente — foi apagado). Instrucao
  explicita nas etapas 1 e 5: nao prometer exemplo, portfolio, print ou link de demonstracao em
  momento nenhum. **Motivo:** prometer o que nao existe queima a confianca no primeiro
  follow-up, e inventar link/case seria prova social falsa. Entrou a objecao "Tem algum exemplo/
  me manda um site que voces fizeram", que ADMITE a ausencia e pivota para o pagamento no final.
- **Decisao 32 — o proximo passo e o WHATSAPP, durante a ligacao.** Nao ha link de pagamento no
  fechamento. A etapa 8 virou: checar duvida -> resumir -> **confirmar o WhatsApp e mandar a
  mensagem com a pessoa AINDA NA LINHA** ("acabei de te mandar, chegou?") -> combinar quando o
  material chega. A mensagem de formalizacao deixa por escrito escopo, valor, prazo, condicao de
  pagamento e a lista de materiais.
- **Decisao 33 — pagamento no FINAL, e isso substitui o modelo como argumento central.** Sem
  pagamento adiantado a cliente nao arrisca nada para comecar. Reescreveu 4 objecoes ("caro",
  "barato demais", "ja tentei antes", "preciso pensar") e criou duas ("Como funciona o
  pagamento?", "E se eu nao gostar?"). A frase-sintese autorizada e "a aposta e nossa, nao sua".
- **Decisao 34 — MUDOU O QUE QUALIFICA: o compromisso real e o MATERIAL, nao o "sim".** Como
  nao ha pagamento adiantado, dizer sim nao custa nada — todo mundo aceita. O unico sinal de
  compromisso que sobra e a chegada de logo, fotos, procedimentos e texto, porque da trabalho.
  O marco de conversao passa a ser o MATERIAL; o avanco e "material com data combinada", e
  "depois eu mando" sem dia e continuacao. Isto ALTERA o criterio 6 da Decisao 28.
- **Guardas automaticas de publicacao** (o script aborta): "fachada" sem "site"; marcador
  `[link do modelo` remanescente; etapa que INSTRUA envio de link de pagamento — distinguindo a
  instrucao da proibicao, para a frase "nao existe link de pagamento" continuar permitida
  (a guarda ingenua deu falso positivo nela e foi refinada). Conferido no gravado: modelo 0x,
  "paga no final" 16x, WhatsApp 19x.
- **Risco declarado e aceito:** produzir antes de receber, em venda de R$300 vinda de ligacao
  fria, transfere risco de inadimplencia para a Tenka. Decisao comercial do operador. Se
  aparecer calote em volume, a alavanca menos custosa e exigir material COMPLETO antes de
  produzir (o roteiro ja reforca) — **nao** voltar a cobrar adiantado, que devolveria a barreira
  de entrada que esta versao acabou de remover.
- **Em aberto:** o MOMENTO exato do pagamento. O roteiro diz "no final, quando estiver pronto e
  voce tiver visto" — verdadeiro tanto para "na entrega" quanto para "apos aprovacao". Se houver
  regra mais precisa, e uma linha numa v7.
- **Dados alterados em producao:** versao 6 `fd946b4a-8b77-4332-8dd3-1557ceefdcf7`
  (**publicada**); v5 arquivada; campanha repontada. **192 vinculos intactos.**

### 2026-08-24 — versao 7: a PREVIA ja existe (demonstracao antes de explicacao)

Reposicionamento pedido pelo operador: a conversa parte de uma previa visual JA MONTADA para
aquela clinica e conduz para uma REUNIAO curta de apresentacao e fechamento.

- **Decisao 35 — DOIS roteiros, nao um.** A Central de Ligacoes percorre etapas DURANTE a
  chamada e mede `etapa_alcancada`/`ligacao_etapas`. Etapas de reuniao dentro do roteiro da
  abordagem fariam nenhuma ligacao passar da 5a etapa e o funil viraria ruido — o mesmo defeito
  de leitura que a Decisao 19 corrigiu. Criado o roteiro
  `TENKA | Reuniao de apresentacao e fechamento` (`1a1117da-b9a7-4649-8517-04a0f5631b00`,
  versao `9672a30f-17b3-490f-a7a2-6d83b931becb`, 4 etapas). A campanha continua apontando para
  a ABORDAGEM.
- **Decisao 36 — a REUNIAO volta ao caminho padrao. REVERTE as Decisoes 4 e 24.** Justificativa
  do operador: com previa em maos, a reuniao e o mecanismo de demonstracao de valor.
  **Efeito colateral positivo e nao-obvio:** com reuniao de volta, `app.agenda_eventos` volta a
  ser usada e o mapeamento existente da Meta passa a funcionar sozinho (`reuniao_agendada ->
  LeadSubmitted`, `reuniao_realizada -> QualifiedLead`, `reuniao_realizada_com_venda ->
  Purchase`). **O buraco da Decisao 9 — venda sem reuniao nao tem onde ser registrada — deixa de
  ser bloqueante, sem migration nova.**
- **Decisao 37 — TRES verdades que o roteiro nao pode quebrar**, escritas no objetivo da etapa 1:
  (1) a previa e conceito/mockup, NAO site publicado ou contratado; (2) ela NAO pediu nada;
  (3) foi feita SEM COMPROMISSO. Quebrar qualquer uma transforma um gesto de atencao em golpe
  aos olhos dela. Dai nasceram tres objecoes obrigatorias: "Eu nao pedi isso / de onde tiraram
  meus dados?", "Isso ja esta publicado?" e "Voces usaram minhas fotos/minha marca?" — esta
  ultima responde OFERECENDO A SAIDA ("se preferir, eu apago agora"). Quem oferece a saida nao
  parece golpe. **Guarda automatica** na publicacao rejeita afirmacao de site publicado.
  **REVERTE a Decisao 31** (que proibia prometer exemplo) — agora o exemplo existe; a proibicao
  vira o pre-requisito abaixo.
- **Decisao 38 — pre-requisito absoluto: so usar o roteiro A com lead que JA TEM previa.** Sem
  previa, usar a variante honesta ("posso preparar e te mandar ainda hoje?") e preparar de
  verdade. **Custo declarado:** a previa e trabalho ANTES da venda, por lead; com 11,5% de
  atendimento, montar previa para os 192 significa produzir ~170 pecas para quem nunca vai
  atender. **Mitigacao recomendada:** produzir em lote pequeno, priorizando quem ja atendeu e os
  de melhor pontuacao — nao a carteira inteira.
- **Decisao 39 — o fechamento da CONVERSA passa a ser a REUNIAO, nao o material.** Isto ajusta a
  Decisao 34: o material continua sendo o compromisso real, mas ele e pedido na REUNIAO
  (roteiro B, etapa 4), nao na abordagem. Na abordagem, o sinal de compromisso e aceitar DIA E
  HORA — "depois a gente marca" nao e aceite.
- **Preservado do material anterior** (a instrucao mandava preservar o que ainda serve):
  vocabulario site+fachada, promessa autorizada e negativas explicitas, pagamento no final,
  disciplina enxuta de perguntas, ficha lida antes, registro obrigatorio, avanco x continuacao,
  roteiro de caixa postal e as objecoes de mensalidade/pos-12-meses/escopo/"ja tentei antes".
- **Dados alterados em producao:** roteiro A versao 7 `cfdd3b9a-cc5f-417b-acf1-08fcc24ee130`
  (**publicada**, 7 etapas), v6 arquivada, campanha repontada; roteiro B criado e publicado
  (4 etapas). **192 vinculos intactos.**

### 2026-08-24 — versao 8: o roteiro vira MAPA DE DECISAO

- **Decisao 40 — a queixa tinha causa na TELA, nao so no texto.** `frase_sugerida` e renderizado
  na Central de Ligacoes entre aspas e em italico (`central-ligacoes/page.tsx:1564`): a interface
  o trata como A FALA. As versoes anteriores empilhavam ali roteiro de caixa postal, avisos e
  notas de conduta — a tela exibia ESTRATEGIA COMO SCRIPT. Corrigido: `frase_sugerida` volta a
  ser so a fala; a orientacao migra para `objetivo`, que a tela renderiza como guia (🎯).
- **Decisao 41 — a estrutura de 9 campos pedida NAO cabe no schema, e isso fica declarado.**
  Restricoes reais lidas no codigo: (a) `perguntas_json` e `sinais_*_json` passam por
  `.map(String)` — nao aceitam objeto — e sao gravados LITERALMENTE em
  `ligacao_perguntas.texto_no_momento` / `ligacao_sinais.texto`, entao meta-informacao dentro
  deles poluiria a analitica; (b) `objecoes_json` aceita objeto mas a tela le so
  `{objecao, resposta}` — chave extra seria invisivel; (c) `objetivo`/`frase_sugerida` cortam em
  2000 chars em silencio. **Encaixe adotado:** `objetivo` = mapa em blocos rotulados
  (OBJETIVO · CONDUCAO · OBSERVE · SE..ENTAO · PROXIMO PASSO); `frase_sugerida` = so a fala;
  perguntas/sinais curtos; camadas da objecao dentro do texto da `resposta`
  (SIGNIFICA · OBJETIVO · FALA · DEPOIS). **Campos de verdade exigem migration + mudanca de
  tela** — trabalho separado, nao feito aqui.
- **Decisao 42 — sinal de interesse deixa de ser rotulo e vira INSTRUCAO.** "Pergunta o preco"
  virou "Pergunta o preco — responda o numero e volte pro 'posso mostrar?'", com o erro a evitar
  explicito (continuar perguntando quando o lead ja quer avancar). Vale para os dois roteiros.
- **Decisao 43 — perguntas sem consequencia foram REMOVIDAS**, conforme a instrucao ("remover
  perguntas que nao alterem a estrategia"): sairam "Voces atendem so em Sao Bernardo?" e
  "Faz sentido pra voces?". As que ficaram ganharam proposito e criterio de interpretacao dentro
  do `objetivo`.
- **Decisao 44 — redundancia consolidada.** Objecoes repetidas em varias etapas foram reunidas na
  etapa 6; ficaram nas etapas de origem apenas as que precisam ser respondidas no instante em
  que surgem ("eu nao pedi isso", "ja esta publicado?", "usaram minhas fotos?").
- **Guardas automaticas novas** (o script aborta): etapa sem `OBJETIVO:` ou `PROXIMO PASSO:`;
  etapa sem nenhum caminho `SE …`; objecao sem as camadas `SIGNIFICA:`/`DEPOIS:`; pergunta com
  mais de 90 chars (vai literalmente para a analitica); "fachada" sem "site".
  **Quatro violacoes reais foram pegas na 1a execucao** e corrigidas antes de publicar.
- **Dados alterados em producao:** A v8 `9a6b508b-3013-4c5e-b65a-bbd24e27e64b` (**publicada**,
  7 etapas, campanha repontada); B v2 `51a8f27e-f416-413e-a809-65b8c4074228` (**publicada**,
  4 etapas). **192 vinculos intactos.**

### 2026-08-24 — versao 9: LIGACAO PURA + diagnostico das outras campanhas

- **Decisao 45 — a previa e COMUNICADA na ligacao e MOSTRADA na reuniao.** O pedido queria a
  previa como mecanismo central E canal exclusivo de voz — nao se exibe imagem por telefone.
  A propria estrutura pedida resolvia ("comunicar que uma estrutura visual ja foi preparada").
  Isso da a previa um papel MAIS forte: ela deixa de ser o argumento e vira o MOTIVO, porque
  curiosidade nao satisfeita e o que faz aceitar os 15 minutos. Saiu tudo que dependia de ela
  ver algo durante a abordagem; guarda de publicacao rejeita `WHATSAPP:`, `LEGENDA DA IMAGEM`,
  `TOQUE n`, `MENSAGEM n`. **Roteiro B (reuniao) NAO foi tocado** — e reuniao, nao ligacao.
- **Decisao 46 — 9 etapas com `AVANCAR QUANDO` obrigatorio.** abertura · permissao (contexto) ·
  insight (a previa) · descoberta (reacao) · situacao (exploracao, CONDICIONAL) · implicacao
  (valor em 2 frases) · convite_reuniao · objecoes · proxima_acao. Cada etapa declara o criterio
  objetivo de avanco — sem isso o atendente nao sabe quando parou de qualificar e comecou a
  enrolar.
- **Decisao 47 — perguntas sem consequencia PROIBIDAS por escrito.** A etapa 5 lista o que NAO
  perguntar: quantos clientes, faturamento, numero de funcionarios, tempo de existencia. Nenhuma
  muda o proximo passo. E incorporada a tecnica do roteiro de Nail Designers (o melhor da casa):
  **hipotese em vez de pergunta seca**.
- **Decisao 48 — diagnostico das outras 4 campanhas (nenhuma alterada).** ALTA: Nail Designers
  (200 leads; o CTA ja promete "abro a tela e a gente olha juntos" — hoje mostra o VAZIO, com
  previa mostraria o CHEIO; previa indicada: ANTES E DEPOIS conceitual) e Academias-Site
  (200 leads; o roteiro **ja promete** mostrar "como ficaria uma estrutura adaptada" — a previa
  so cumpre o que ele diz). MEDIA: Funileiros (179, nicho visual, mas campanha "Demo").
  **NAO MIGRAR: Academias-Conversao (CRM)** — um "CRM ja montado" sugere que DADOS DELA foram
  importados, risco maior que o da previa de site, e print de CRM nao gera curiosidade por
  telefone. Alternativa registrada: desenho do funil tipico do nicho como HIPOTESE, que provoca
  sem simular posse.
- **Decisao 49 — critica registrada: a conta nao fecha com previa antes da PRIMEIRA ligacao.**
  Com 11,5% de atendimento, 192 previas rendem ~22 conversas (~48h de trabalho, a maior parte
  para quem nunca atende). **Recomendacao: previa para a SEGUNDA conversa** — a 1a ligacao pede
  permissao ("posso montar uma previa e te mostrar?"), o que ainda e motivo forte, GERA
  MICRO-COMPROMISSO e corta ~90% do custo. O roteiro v9 suporta as duas rotas (variante na
  etapa 3). Outros riscos declarados: personalizacao falsa inverte o efeito; expectativa de
  customizacao vs escopo padronizado; e a previa desloca o gargalo (contato) sem resolve-lo.
- **Decisao 50 — o que decide a escala e a AUTOMACAO.** `prospectador.prospects.raw_json` ja
  guarda nome, fotos, avaliacoes, endereco, categoria e horario do Maps. Um gerador de mockup
  por nicho alimentado por esse JSON transformaria a previa de artesanato em etapa de pipeline.
  Sem isso, a estrategia nao passa de algumas dezenas de leads. **Nao implementado.**
- **Metodologia replicavel registrada** (7 regras) em
  `docs/analise-processo-comercial-tenka.md` §16.5.
- **Dados alterados em producao:** A v9 `132cb8f5-2fba-4c1c-8501-4356df1c3c84` (**publicada**,
  9 etapas), v8 arquivada, campanha repontada. **192 vinculos intactos. Nenhuma outra campanha
  ou roteiro foi alterado** — o diagnostico foi so leitura, como pedido.

## 2026-08-26 — Campanhas de ligacao Pousadas e Advocacia (previa de site)

**Pedido:** criar duas campanhas de prospeccao por LIGACAO (pousadas e advocacia), cada uma com
roteiro proprio em SPIN Selling, cujo objetivo unico e agendar reuniao para apresentar uma
**previa de site ja preparada** — o modelo "previa antes da ligacao" que a v9 da TENKA ja usa.

**Decisao 1 — reusar a arquitetura existente, sem nada novo.** Nenhuma migration, rota, tela,
env ou arquivo de backend. Tudo criado **pela API do proprio produto** (`/api/empresas/:id/
nichos`, `/roteiros`, `/roteiros/versoes/:id/etapas`, `/publicar`, `/campanhas`), nunca por SQL
direto — e o que garante `assertMesmaEmpresa`, `assertRoteiroVersaoUtilizavel` e a imutabilidade
da versao publicada.

**Decisao 2 — estruturas NOVAS, nada reaproveitado.** Roteiro e campanha novos por nicho, como
manda a secao "SEPARAR" de `analise-processo-comercial-tenka.md`: reusar cabecalho existente
misturaria duas ofertas na mesma serie analitica. As 5 campanhas e 7 roteiros anteriores nao
foram tocados (conferido por leitura: `atualizado_em` inalterado).

**Decisao 3 — 10 etapas com ATALHO explicito, e nao um SPIN obrigatorio.** O briefing pede S-P-I-N
como raciocinio, nao como questionario. A etapa 4 (`descoberta`) classifica o lead em quente /
morno / frio e manda **pular as etapas 5, 6 e 7** quando ha interesse, indo direto ao convite
(etapa 8). Isso concilia o pedido com o dado historico da operacao (92% das ligacoes morriam na
abertura, media de 37s): quem esquenta cedo nao e investigado.

**Decisao 4 — a previa e o ativo de curiosidade, e ela precisa EXISTIR.** A etapa 3 traz o
pre-requisito escrito e uma variante "posso montar" para quando nao houver previa pronta.
Prometer previa inexistente queima o lead na reuniao — e a reuniao e o unico fechamento da
ligacao.

**Decisao 5 — nenhuma condicao comercial foi inventada.** O briefing nao definiu preco, prazo
nem escopo, entao o texto usa o marcador `[condicoes comerciais]` e manda responder preco
**direto, sem desviar**, conforme a politica da campanha. Marcadores pendentes, no mesmo padrao
da TENKA: `[vendedor]`, `[empresa]`, `[pousada]` / `[escritorio]`, `[cidade]`,
`[observacao real]`, `[condicoes comerciais]`.

**Decisao 6 — travas de honestidade na etapa `implicacao`, nos dois nichos.** E a etapa onde
vendedor inventa numero. O objetivo proibe, por escrito: estimar busca mensal, afirmar quanto o
negocio perde, afirmar a comissao que a pousada paga a plataforma (manda PERGUNTAR), comparar
com concorrente nominal e dizer "esta perdendo dinheiro". Em advocacia soma-se a proibicao de
prometer resultado de qualquer especie.

**Decisao 7 — compliance de advocacia e parte da OFERTA, nao um aviso legal.** Regras vigentes
confirmadas por consulta: **Provimento 205/2021 do Conselho Federal da OAB** segue em vigor
(substituiu o 94/2000; nada o revogou ate 2026). Publicidade da advocacia e informativa e
moderada; vedadas promessa de resultado, mercantilizacao e captacao de clientela. Isso governa
duas coisas no roteiro: (a) o **vocabulario proibido** do vendedor — "captar clientes", "trazer
causas", "gerar demanda", urgencia artificial e desconto por decisao imediata; e (b) o que a
pagina entregue **nao pode conter** — tabela de honorarios, promocao, caso de exito, depoimento
de cliente, promessa. A etapa 2 da reuniao diz isso EM VOZ ALTA como diferencial. O roteiro
tambem PROIBE o vendedor de dar parecer sobre a norma ou garantir ausencia de risco: quem
responde perante a OAB e o escritorio, e a revisao dele e parte declarada do processo.

**Decisao 8 — roteiro de REUNIAO separado por nicho (4 etapas).** Mesma escolha da TENKA: a
campanha aponta para o roteiro de LIGACAO; o de reuniao existe como cabecalho proprio e e
apontado no texto da etapa 10. Fundir os dois num roteiro so poluiria a analitica de etapa
alcancada da ligacao.

**Decisao 9 — campanhas nasceram em `rascunho`, e nao `ativa`.** **Nao ha um unico lead de
pousada nem de advocacia na carteira** (medido: 3.359 prospects, zero em ambos os nichos).
Campanha ativa com fila vazia mentiria sobre o estado da operacao. Ativar e uma chamada
(`PUT /campanhas/:id {status:'ativa'}`) depois que a coleta trouxer leads.

**Decisao 10 — NENHUMA coleta paga foi disparada.** A Bright Data cobra por registro e o banco
so admite **uma coleta ativa por empresa** (indice unico parcial). Escolher cidade por conta
propria gastaria dinheiro do operador num mercado que ele nao escolheu. Fica pendente e
declarado. Conferido apos a execucao: nenhum `busca_snapshots` pendente/em andamento.

**Dados criados em producao** (empresa PJ Codeworks `f5f47737-3f48-44fd-a09a-f09e66f7ed85`):

| Estrutura | Id |
| --- | --- |
| Nicho `Pousada` | `5dfcceb8-9622-40bb-8566-4f1a30e59900` |
| Nicho `Advocacia` | `2843a207-498f-4ea0-821a-d576ebbe8956` |
| Roteiro ligacao Pousadas / versao 1 publicada (10 etapas) | `5cf5a95e-8476-4fc0-9d4b-53d0c4a4cb94` / `8e3703ce-8880-42dc-ab39-8cd69d6a6657` |
| Roteiro reuniao Pousadas / versao 1 publicada (4 etapas) | `7e6d7e1d-f13d-48c5-8b87-bfc31cf75ae4` / `b489deaf-5a67-439c-858b-0eff1a385a6d` |
| Roteiro ligacao Advocacia / versao 1 publicada (10 etapas) | `a16b95a3-5a1a-41dd-aa0e-e0438b34d43c` / `e10dde9f-a36f-4740-bbf9-625d4d8504e8` |
| Roteiro reuniao Advocacia / versao 1 publicada (4 etapas) | `c1f51921-7ba7-415f-be46-153518b43263` / `a7580059-5a8d-46dd-baf4-89cb4c5a658a` |
| Campanha `PREVIA DE SITE \| POUSADAS \| LIGACAO` (rascunho) | `a1d1a18c-b1d0-4b6a-afeb-4947c319c389` |
| Campanha `PREVIA DE SITE \| ADVOCACIA \| LIGACAO` (rascunho) | `a2cf9ad4-bd67-40d4-9081-511eff8785ed` |

**Nota de acesso:** o admin `alex.rodriguus@gmail.com` e `superadmin` mas **nao tem vinculo em
`app.usuarios_empresas` com a PJ Codeworks** — `POST /api/auth/login` e `GET /api/empresas` so
devolvem a empresa seed. `requireEmpresaAccess` deixa superadmin passar
(`middleware/tenant.js:46`), entao a empresa alvo foi informada explicitamente e **conferida
pelo nome** antes de qualquer escrita. Vale criar o vinculo — hoje o painel provavelmente nao
lista a PJ para esse usuario.

**Pendencias declaradas:** (a) coleta de leads dos dois nichos, com cidade a definir;
(b) preencher os marcadores; (c) ativar as campanhas; (d) nenhum responsavel atribuido
(`campanha_responsaveis` vazio); (e) `meta_ligacoes`/`meta_reunioes` nulas de proposito —
inventar meta em campanha de validacao contamina a leitura.

### Adendo (mesma data) — coleta em SBC-SP e vinculo dos leads

- **Coleta feita pelo operador** (nao por mim), pela Busca avulsa da Aquisicao: `POUSADA | SBC - SP`
  (duas buscas: 200 + 71 novos = **271**) e `ADVOCACIA | SBC - SP` (**200**). Todas `concluido`,
  sem erro, na PJ Codeworks. Isso encerra a pendencia (a) e revoga a Decisao 10 pelo lado do
  operador — nenhuma coleta paga partiu deste agente.
- **Vinculo feito pela API** (`POST /campanhas/:id/leads`), que ja e idempotente: o INSERT filtra
  `p.empresa_id` (same-tenant) e tem `ON CONFLICT (campanha_id, prospect_id) DO NOTHING`.
  Simulacao antes de aplicar; duas guardas no script abortavam a execucao se a campanha nao
  batesse com o nicho alvo ou se a listagem trouxesse prospect de outro nicho (o filtro da rota
  e `ILIKE %...%`). Vincular pousada na campanha de advocacia e irreversivel na pratica — o
  operador ligaria com o roteiro errado.

| Campanha | Coletados | **Vinculados** | Fora |
| --- | --- | --- | --- |
| `PREVIA DE SITE \| POUSADAS \| LIGACAO` | 271 | **254** (`nao_iniciado`) | 17 sem telefone |
| `PREVIA DE SITE \| ADVOCACIA \| LIGACAO` | 200 | **192** (`nao_iniciado`) | 8 sem telefone |

- **Lead sem telefone fica de fora de proposito** — e campanha de LIGACAO. Eles continuam no
  Banco de Leads. Mesmo criterio da campanha TENKA (192 de 200).
- **A fila da Central de Ligacoes ja prioriza certo:** o topo das duas e ocupado por
  `situacao_site = sem_site`, que e o publico exato da oferta (`ligacao-prioridade.js` da +40 a
  quem nao tem site). Sao 114 pousadas e 84 escritorios sem site proprio.
- **As campanhas seguem em `rascunho`, e isso NAO impede o trabalho:** a Central de Ligacoes
  lista todas as campanhas no seletor. Nao ativei porque `listarCampanhas` ordena
  `(status='ativa') DESC, criado_em DESC` e a tela pre-seleciona a PRIMEIRA ativa
  (`central-ligacoes/page.tsx:641`) — ativar estas duas trocaria, sem aviso, a campanha que abre
  por padrao na tela de quem liga todo dia. E decisao do operador, nao efeito colateral.
- **Pendencias que continuam:** preencher os marcadores (`[vendedor]`, `[empresa]`,
  `[condicoes comerciais]`, `[observacao real]`), **preparar as previas** antes de ligar (a
  etapa 3 exige que a previa exista), atribuir responsaveis e ativar as campanhas.

## 2026-09-12 — Comercial restrito ao próprio trabalho marcado

- **Decisão:** o cargo Comercial passa a operar apenas o próprio recorte: conversas atribuídas a ele ou vindas da instância dele, follow-ups dele e instâncias vinculadas ao próprio usuário. A antiga leitura de "minhas + não atribuídas" deixa de existir para esse papel.
- **Lead neutro não entra no trabalho comercial.** No Banco de Leads, quem não tem permissão de base bruta vê somente lead `qualificacao = 'aprovado'`. O lead coletado/neutro continua existindo para triagem/admin, mas não vira lista operacional do Comercial até ser marcado.
- **Instância do Comercial é pessoal.** Rotas de WhatsApp não expõem nem permitem operar instância compartilhada/da empresa para usuário sem `instancia_gerenciar_empresa`; a tela mostra só a instância própria e remove seletor de instância do Banco de Leads para esse recorte.
- **Disparo automático fica administrativo.** O Comercial recebe no máximo `lead_disparar_semi`; modo automático, limpeza e operação em lote continuam atrás de `lead_disparar_lote`.
- **Roteiros para Comercial são leitura.** Copiar conteúdo para IA, criar, editar, publicar ou arquivar continuam restritos a quem gerencia roteiros.
- **Sem migration e sem env nova.** A mudança é de autorização, filtros SQL e apresentação de interface.

## 2026-09-15 — Banco de Leads: ordem de trabalho e telefone editável

- **A ordem passou a ser calculada no BACKEND, sobre o recorte inteiro** (opção A, aprovada pelo
  operador). Ordenar só no cliente daria uma ordem correta de um recorte errado: a tela recebia
  os 300 leads escritos mais recentemente e reordenava dentro deles.
- **A ordem de trabalho é o padrão de TODO MUNDO** (não só do Comercial). As 12 ordenações
  antigas continuam em "⚙ Personalizar" — ninguém perde capacidade, muda o que aparece primeiro.
  Duas telas diferentes para o mesmo dado fariam quem gerencia deixar de ver a fila como o
  vendedor vê.
- **A classificação vive no SQL, gerada pelo módulo puro** (`sqlFaixaTrabalho`), em vez de uma
  função JS aplicada depois. Motivo: a ordem precisa valer para a carteira inteira e sobreviver
  à janela/paginação. O módulo continua sendo o dono da regra — é ele que emite o SQL —, então
  não existe uma segunda régua. É o mesmo contrato de `ORDEM_SQL_PROSPECTS` (mapa fechado
  chave→SQL) da Aquisição.
- **Dívida declarada:** a listagem do Banco de Leads continua devolvendo uma JANELA (300) e
  paginando no cliente. Com a ordem de trabalho a janela deixou de esconder o urgente, e
  `meta.total_carteira` passou a declarar o tamanho real. **Paginação de servidor (decisão D4)
  segue pendente** e não foi feita aqui de propósito: os ~15 filtros do "⚙ Personalizar" são
  client-side e `score_cadastro` é calculado na LEITURA (o mesmo muro já documentado para
  `pontos`/`horario` na Aquisição). Movê-los é projeto próprio, e misturá-lo a esta entrega
  quebraria a regra de não juntar refatoração grande com feature.
- **Telefone digitado por uma pessoa vence a recoleta** (`raw_json.telefone_origem = 'operador'`).
  Antes o número do Google Maps sobrescrevia, sem aviso, a correção que o vendedor tinha acabado
  de fazer — mesma classe do defeito D-8 (a instância gravada na conversa migrando sozinha).
- **Trocar o telefone ZERA `tem_whatsapp`.** Aquele `false` é veredito sobre o número ANTIGO;
  carregá-lo faria o lead corrigido continuar em "Descartados" e fora da elegibilidade. É a mesma
  distinção de `contato_canal_disponibilidade`: "não sei" (NULL) não é "não tem" (false).
- **`PATCH /leads/:id/email` ganhou o recorte que não tinha.** Estava escopado só por
  `empresa_id`: bastava trocar o id na URL para escrever num lead fora do escopo de quem pediu.
  Corrigido junto, por ser a mesma classe e o mesmo helper (404, nunca 403).

## 2026-09-16 — ICP Tenka v1.1 separado de cadastro e prioridade

- **Decisao:** implementar a Fase 1 com um modelo ICP fixo (`Tenka v1.1`) e versionado em
  codigo/schema, sem tela de configuracao ainda. A configuracao de outros ICPs fica para uma fase
  propria, depois de validar o fluxo comercial.
- **Tres leituras separadas:** `score_cadastro` continua completude neutra; `icp_score/icp_faixa`
  vira fit comercial humano com sinais automaticos; prioridade de ligacao continua calculada pela
  Central, agora com bonus explicavel para Lead A/B.
- **Transacao unica na curadoria:** aprovar/descartar no Assistente salva `qualificacao`,
  `curadoria_decisoes`, historico ICP append-only e snapshot em `prospects.icp_*` no mesmo COMMIT.
- **Lead C nao bloqueia aprovacao:** fica aprovado se o operador decidir, mas com selo `Lead C`
  e sem bonus de prioridade. Isso evita travar excecoes sem fingir alta qualidade.
- **Visual:** Banco de Leads ganhou coluna/filtro `Qualidade`; `Cadastro` permanece separado e
  neutro. Detalhes mostra a ficha ICP completa. A Central de Ligacoes recebe `icp_faixa` para
  explicar o bonus na prioridade.

### Adendo - ICP geral e cadastro como evidencia

- **Decisao:** o nome publico deixa de ser `ICP Tenka v1.1` e passa a ser `ICP geral v1.1`.
  `tenka-v1-1` continua como slug tecnico do modelo ja persistido.
- **Motivo:** o modelo e uma regua geral de fit comercial, nao um ICP especifico de energia
  solar. O cadastro/coleta deve validar o ICP e nao competir visualmente com ele.
- **Impacto:** Banco de Leads e Aquisicao concentram a leitura em `ICP + cadastro`; a coluna
  extra de resumo ICP fica fora do padrao visual, e o modal de Detalhes consolida cadastro como
  evidencia da ficha ICP.

### Adendo - atividade do Google como penalidade auditavel

- **Decisao:** atividade recente do Perfil Google entra como dimensao de score, nao como filtro
  duro. A fila fica mais inteligente, mas o operador ainda pode aprovar excecoes.
- **Por que:** perfil marcado como fechado ou sem sinal recente tende a consumir energia comercial
  sem retorno. Ao mesmo tempo, ausencia de data confiavel nao prova fechamento; por isso so reduz
  prioridade quando nao ha status fechado.
- **Regra:** `CLOSED_PERMANENTLY` e `CLOSED_TEMPORARILY` geram penalidade forte; review/foto
  recente aquece; mais de 1 ano esfria; sinais sem data somam pouco; falta total de sinal tira
  ponto moderado.
- **Limite assumido:** a regra usa campos publicos ja trazidos pelo provedor de busca. Nao faz
  scraping extra nem promete confirmar operacao em tempo real.

### Adendo - ICP em Detalhes salva automaticamente

- **Decisao:** remover a etapa mental de "Salvar ICP" no modal de Detalhes. O checklist e a
  observacao passam a ser autosave, porque a decisao operacional real e marcar/descartar o lead.
- **Por que:** o operador estava revisando fit comercial enquanto decidia o lead; exigir outro
  botao criava risco de perder a avaliacao e confundia ICP com uma acao separada.
- **Regra preservada:** a rota continua sendo `PATCH /leads/:id/icp` com `LEAD_TRIAR`; apenas
  Lead A autoqualifica. B/C continuam como avaliacao registrada sem promover status.
- **Snapshot:** a ultima observacao entra em `icp_resumo_json`; o historico append-only segue
  completo em `lead_icp_avaliacoes`.

### Adendo - Correcao dos defeitos do autosave do ICP

- **Defeito 1 (o central):** o efeito que semeia o checklist dependia de `lead.icp_avaliado_em` e
  `lead.icp_score`. Como `aplicarLeadAtualizado` devolve o lead salvo para dentro do proprio modal,
  cada salvamento disparava o reset. Efeitos: o aviso "ICP salvo" era apagado no ciclo seguinte ao
  que aparecia (o operador perdeu o botao e ficou sem confirmacao nenhuma) e o que estivesse sendo
  digitado na observacao durante a ida e volta da requisicao voltava ao valor do servidor. O
  controle de corrida por sequencia nao cobria isso, porque a sobrescrita vinha do pai, nao de uma
  resposta atrasada. **O efeito passou a depender so de `lead.id`.**
- **Defeito 2:** fechar o modal dentro da janela do debounce descartava a alteracao pendente, porque
  a limpeza do efeito cancelava o timer. Autosave que perde a ultima edicao ao fechar e pior que o
  botao que ele substituiu. Agora existe um envio de saida: o pendente e gravado na desmontagem e o
  pai e avisado, porque ele continua montado.
- **Defeito 3:** o indicador dizia "Salvando ICP..." durante a espera do debounce, quando ainda nao
  havia requisicao alguma. Como ele e a unica coisa que substituiu o botao, afirmar o que nao
  aconteceu corroi justamente a confianca que o operador passou a depositar nele. Estado proprio:
  "Alteracoes pendentes...".
- **Espera do autosave: 1200 ms, e a razao nao e conforto de digitacao.** `PATCH /leads/:id/icp`
  grava uma linha no historico append-only e outra em `app.auditoria_eventos` a CADA chamada.
  Sem agrupar, marcar os criterios um a um encheria a auditoria de rascunho - e auditoria neste
  repositorio existe para registrar decisao, nao digitacao.
- **Consequencia declarada, NAO resolvida nesta leva:** com autosave, a porta da triagem e cruzada
  por estado intermediario. Marcando os criterios um a um, o score cruza o corte de Lead A no meio
  do preenchimento; a rota grava `qualificacao='aprovado'` e, como nada rebaixa (regra do repo: o
  status so PROMOVE), o lead permanece aprovado mesmo que o operador termine em B. Com o botao isso
  era impossivel, porque so o estado final era submetido. Decisao de produto pendente.
- **Teste que nao rodava:** `test/google-business-activity.test.js` foi commitado em 7cd99c8 fora da
  lista do `npm test`. Teste fora da suite para de proteger em silencio; foi ligado.

### Recorte de trabalho na SESSAO - o que sobrevive ao F5 por 30 min

- **Decisao:** o recorte de trabalho (aba, status, mercado, cidade, busca, ordenacao e, onde faz
  sentido, a pagina) passa a sobreviver ao F5 por 30 minutos, em `sessionStorage`, escopado por
  EMPRESA. Nada vai a banco.
- **Fonte de verdade unica:** `frontend/lib/filtros-sessao.js` (+ `.d.ts`/`.test.js`). As telas nao
  decidem validade nem formato; so declaram o proprio padrao e chamam `aplicarRecorte`.
- **`sessionStorage`, nunca `localStorage`, e isto e a decisao central.** O recorte descreve uma
  sessao de trabalho, nao um gosto do operador: morre com a aba. Reabrir o sistema amanha e
  reencontrar a busca por "energia solar" de ontem seria o defeito oposto - trabalhar dentro de
  um recorte que ninguem escolheu hoje. Guarda de regressao no teste falha se o modulo passar a
  usar localStorage.
- **Validade RENOVADA a cada uso** (leitura ou escrita). Enquanto a pessoa esta ali, o recorte
  acompanha; parada alem da janela, ele some sozinho.
- **Escopo por EMPRESA.** Filtro de uma empresa reaparecendo em outra faria o operador olhar uma
  lista recortada por um criterio que ele nao escolheu - e achar que e a lista inteira.
- **Dois eixos que NAO foram fundidos:** PREFERENCIA (colunas, filtros do "Personalizar", itens
  por pagina) continua permanente em localStorage, como ja estava documentado; RECORTE de
  trabalho e efemero. Juntar os dois faria a preferencia evaporar em 30 min ou o recorte de hoje
  voltar amanha.
- **Hidratacao em EFEITO, nunca no valor inicial do estado:** as telas tambem renderizam no
  servidor, onde nao existe sessionStorage, e semear ali faria o HTML do servidor divergir do
  cliente. O preco e um ciclo de espera, controlado por `recortePronto` - que existe para a tela
  nao buscar com o filtro padrao e logo depois buscar de novo com o restaurado.
- **`aplicarRecorte` so aceita campo que a tela DECLARA, com o tipo que ela declara.** Recorte
  antigo, de outra versao ou editado a mao no storage nao injeta estado que a tela nao espera.
- **Telas cobertas:** Banco de Leads, Aquisicao, Captacao e Central de Ligacoes.
- **Follow-ups NAO foi alterada, de proposito:** os filtros dela (inclusive a busca) ja vivem em
  `view`, persistida em localStorage por decisao registrada. A tela ja nao perde nada no F5.
- **Ausencias declaradas na Central de Ligacoes:** a CAMPANHA nao e restaurada (tem precedencia de
  URL vinda de Follow-ups e exigiria tratar campanha inexistente) e a PAGINA tambem nao (um efeito
  ja existente volta para a pagina 1 quando filtro, busca ou aba mudam - restaura-la seria
  desfeito no ciclo seguinte).

## 2026-09-16 - Atividade do lead: guardar o registro CRU em vez de adivinhar o campo

- **Fato medido, nao hipotese.** Medicao read-only em producao (4.631 prospects, 200 de
  `Energia Solar` coletados em 11/09 em Goiania-GO): **ZERO leads** tem data de atividade no
  `raw_json` - nem `reviews` com data, nem `latest_review_date`, nem `permanently_closed`.
  As chaves gravadas sao so as 14 do shape Places antigo. Consequencia direta: a regra de 6
  meses de `calcularAtividadeGoogle` **nunca e avaliada** (`dias_desde_atividade = null`), e
  196 dos 200 solares caem em `ativo_sem_data`.
- **Decisao 1 - o adaptador PAROU de chutar nome de campo.** Ate hoje `places-brightdata.js`
  fazia `latestReviewDate: r.latest_review_date || r.last_review_date || r.reviews_last_updated
  || r.last_review_at`. Quatro grafias para o mesmo campo e o formato de um chute, e o chute
  saia caro: a coleta e PAGA, o campo nao mapeado era descartado na hora, e o snapshot de 11/09
  (`sd_mtx7x5wu1kp1gxpw5f`) **ja havia expirado** na Bright Data - ou seja, nao havia mais como
  conferir o contrato sem pagar tudo de novo. O adaptador agora preserva o registro cru inteiro
  em `fonte_bruta`, sem interpretar.
- **Decisao 2 - quem sabe o que e data de atividade e o CLASSIFICADOR.** As listas de nomes
  (`CAMPOS_DATA_RAIZ`, `CAMPOS_COLECAO_REVIEWS`, `CAMPOS_COLECAO_FOTOS`) e a chave
  `CHAVE_FONTE_BRUTA` vivem em `services/google-business-activity.js`, que e o dono do
  vocabulario; o adaptador importa a chave em vez de repetir o literal. Espalhar a lista pelos
  dois faria os dois divergirem - o mesmo padrao de defeito de `!!(lead.site || lead.tem_site)`
  espalhado por 7 pontos antes da migration 056.
- **Decisao 3 - fotos como URL em texto NAO viram data.** O registro real da Bright Data traz
  `photos_and_videos` como array de STRINGS. Se a varredura passasse a extrair data dali, todo
  lead com foto viraria `ativo_recente` sem nenhuma prova de recencia - um falso positivo que
  contamina justamente a decisao de descarte. Ha teste cobrando isso.
- **Decisao 4 - descartar so por FATO DECLARADO, nunca por ausencia de dado.**
  `scripts/descartar-leads-fechados.js` age exclusivamente sobre `permanently_closed` /
  `temporarily_closed` / `businessStatus`. Concluir "inativo" a partir de "sem data" repetiria a
  classe de defeito que este repositorio ja removeu duas vezes (o fallback da PJ no webhook, a
  escolha de instancia por `atualizado_em`): inventar veredito onde nao ha prova.
- **Decisao 5 - decisao humana nao e sobreposta em lote.** Lead `aprovado` por uma pessoa e
  PULADO e apenas relatado (`--incluir-aprovados` existe, mas nao e o padrao). Na execucao de
  2026-09-16, 1 lead caiu nesse caso. Pelo mesmo motivo `--temporarios` nao e padrao: negocio
  fechado temporariamente pode reabrir e a recoleta **nunca promove um descartado de volta**
  (`qualificacaoAoRecoletar`). O operador decidiu incluir os temporarios nesta execucao.
- **Decisao 6 - o descarte em lote e auditavel.** Cada linha alterada gera um evento em
  `app.auditoria_eventos` (`lead_descartado_fechado_no_google`) com o estado anterior, dentro da
  MESMA transacao. Sem migration nova (o `contexto` e JSONB livre) e sem PII. `qualificado_por`
  fica NULO: nao houve usuario, foi manutencao - inventar um autor seria mentir sobre quem
  decidiu. **Resultado da execucao:** 40 leads descartados (25 permanentes + 15 temporarios).
- **Pendencia declarada:** continua sem prova de que a Bright Data devolve data de review. A
  recoleta paga de Goiania foi autorizada pelo operador; `fonte_bruta` e o que garante que ela
  respondera a pergunta **mesmo se os nomes de campo forem outros**, sem uma segunda coleta.

## 2026-09-16 - Perfil de Instagram do lead: PROVA de vinculo, nao semelhanca (migration 080)

- **Contexto:** o operador pediu que o sistema soubesse se o Instagram do lead esta ATIVO, em tres
  etapas: usar o Instagram declarado no Google Meu Negocio; quando nao houver, procurar pelo nicho
  e PROVAR que o perfil e daquele negocio; e entao checar postagem ha menos de 6 meses.
- **Escopo decidido com o operador:** etapas 1 e 2 apenas, **sem coleta paga**. Candidato nao
  provado vai para revisao humana.
- **Descoberta que mudou a conversa:** o criterio `instagram_ativo` do ICP ja existia e **nunca
  ligou**. `temInstagramAtivo` devolvia `true` para qualquer presenca social (bio, link_bio,
  seguidores), e o caminho do Maps nao grava `instagram_handle` - entao o sinal era falso para a
  base inteira. Um criterio `tipo: 'automatico'` sem nenhum efeito desde que nasceu.
- **Decisao 1 - a etapa 1 nao precisava de coleta: o dado ja estava pago e guardado.** O Instagram
  declarado no Perfil da Empresa chega em `link_original` desde a migration 056, classificado como
  `rede_social` e ignorado. `npm run instagram:handles` o transforma em handle confirmado, sem
  nenhuma chamada externa. Foi a parte mais barata e a de maior alcance.
- **Decisao 2 - nicho e cidade NAO contam como nome.** E a regra que impede o vinculo errado:
  "Energia Solar Goiania" tem tres tokens e nenhum distingue um lead do outro dentro de uma busca
  por energia solar em Goiania. Casar por eles faria todo concorrente virar o mesmo negocio.
  `tokensDistintivos` subtrai nicho, cidade e forma juridica; sobrando zero, o nome perde o direito
  de sustentar candidato. Ha teste cobrando esse caso exato.
- **Decisao 3 - so telefone e site PROVAM.** Nome e cidade sustentam candidato e nada mais. Por
  isso `google_meu_negocio` e `operador` (declaracoes de gente) nascem confirmados e `busca`
  (inferencia de maquina) nasce candidato, virando confirmado apenas com sinal forte. Mesma
  disciplina de "nao se inventa dono" que removeu o fallback da PJ no webhook.
- **Decisao 4 - o script em lote NUNCA grava `nao_encontrado`.** Ele nao procura nada: so le o link
  que a ficha trouxe. Afirmar uma busca que nao houve faria a tela dizer ao operador que o lead nao
  tem Instagram sem ninguem ter olhado - a mesma classe da Decisao 4 de 2026-09-16 (descartar so
  por fato declarado, nunca por ausencia de dado). Guarda de regressao le o fonte do script.
- **Decisao 5 - campo de LINK nao aceita handle solto.** Encontrado ao escrever o teste: uma palavra
  solta em `site` (nome de fantasia, cadastro mal preenchido) virava um `@` inventado e o lead
  ganhava um "Instagram confirmado" que nunca existiu. `handleDeLinkConhecido` passou a exigir URL
  do Instagram; handle digitado a mao continua valendo na revisao humana, onde ha uma pessoa
  respondendo.
- **Decisao 6 - a busca e UMA POR CLIQUE, nao worker.** O Google CSE tem cota diaria (100/dia no
  gratuito) e varrer a carteira de ~4.600 leads a esgotaria num dia, sem ninguem ter pedido.
- **Decisao 7 - o sinal do ICP mudou, o MODELO nao.** `instagram_ativo` passou a exigir perfil
  confirmado; `lacuna_digital_clara` continua lendo a presenca AMPLA, de proposito (ali a pergunta
  e se ha algum sinal de vida digital contrastando com a falta de site). Ninguem perde
  pre-marcacao: lead de captacao social ja tem handle, lead do Maps passa a ter. Avaliacoes ja
  salvas nao mudam - `lead_icp_avaliacoes` e append-only + snapshot.
- **Consequencia declarada: perfil CONFIRMADO nao e perfil ATIVO**, e o sistema nunca afirma que
  seja (`situacaoAtividade` devolve `atividade_nao_verificada` e a tela diz isso em texto). A
  etapa 3 continua **pendente e sem contrato de dados confirmado**: nenhum codigo deste repo le
  campo de post com data, e os campos de perfil IG conhecidos em `social-capture.js` sao
  account/followers/biography/category/related_accounts. O caminho e a sonda de 1 perfil guardando
  o registro bruto, como `fonte_bruta` fez para o Maps - nunca chutar nomes de campo antes.
- **Nenhuma variavel de ambiente nova** (reusa `GOOGLE_CSE_KEY`/`GOOGLE_CSE_ID`). Migration 080
  aditiva, sem DEFAULT e sem UPDATE em linha existente.
- **Validacao:** `npm test` 1966/1968 - as 2 falhas (`motor de IA: generateAIResponse...`) sao
  ambientais e **pre-existentes**, confirmadas rodando a suite com a arvore limpa via stash.
  Frontend: `tsc --noEmit` limpo e 474/474 em `lib/*.test.js`.

## 2026-09-16 - Fase 0: teto de creditos na Aquisicao + ledger (migration 081)

- **Contexto:** a analise de `docs/analise-enriquecimento-instagram.md` apontou que o maior
  consumidor de creditos nao era o pipeline novo, e sim a Aquisicao — que rodava SEM teto. O
  operador decidiu (Decisao A) tratar isso antes de qualquer etapa do enriquecimento.
- **Defeito corrigido:** `pesquisarPlaces` nao consultava orcamento nenhum. 800 creditos/dia por
  rotina ativa, contra 4.760 gratuitos: ~6 dias ate zerar. O teto so' existia na captacao social.
- **Decisao 1 - sao DUAS travas, nao uma.** Teto diario controla VELOCIDADE; reserva protege
  SALDO. Um teto diario sozinho nao resolve o problema real (400/dia ainda zera a conta em 12
  dias) e nao impede a coleta automatica de comer o credito do enriquecimento, que depende de
  decisao humana e por isso gasta depois.
- **Decisao 2 - saldo desconhecido PULA a reserva.** Bloquear por saldo nao informado pararia a
  operacao por falta de cadastro; chutar um saldo seria pior. Mesma disciplina de "ausencia de
  prova nao e' prova de ausencia" ja aplicada em situacao_site e contato_canal_disponibilidade.
- **Decisao 3 - o custo estimado e a quantidade SOLICITADA.** Orcamento pelo pior caso: o custo
  real so' e' conhecido quando o snapshot volta, e ai' ja' foi pago.
- **Decisao 4 - o ledger grava o REAL, e e' idempotente por snapshot.** O worker reprocessa
  snapshots; sem `ON CONFLICT DO NOTHING` + indice unico parcial, o mesmo lote seria somado a cada
  passagem e o teto travaria a operacao por consumo que nao existiu.
- **Decisao 5 - `registrarConsumo` nunca lanca.** Contabilidade quebrada nao pode derrubar o
  processamento de um lote JA PAGO: perderia leads comprados. O custo aceito e' o teto ficar mais
  frouxo do que deveria.
- **Decisao 6 - a soma e GLOBAL.** Os creditos sao de UMA conta compartilhada; somar por empresa
  deixaria N empresas gastarem N x o mesmo teto. `empresa_id` fica na linha so' para auditoria.
  Ha guarda de regressao lendo o fonte de `consumidoHoje`.
- **Decisao 7 - o saldo e INFORMADO, nunca lido.** A Dataset API v3 expoe apenas
  /trigger, /progress e /snapshot; nenhum devolve saldo (item 9 do pedido: nao presumir). A tabela
  e append-only e o corrente e' aritmetica sobre o valor digitado — e quem exibe e' obrigado a
  dizer que e' estimativa.
- **Decisao 8 - gestao por script, nao por rota.** Nao existe "saldo da empresa X", entao a
  operacao nao pertence a nenhuma rota de /api/empresas/:id.
- **Risco declarado e aceito:** corrida entre coletas simultaneas de empresas diferentes pode
  estourar o teto em no maximo um lote. O indice unico de coleta ativa ja serializa por empresa, e
  a alternativa (segurar transacao durante a chamada externa) e' pior.
- **Consequencia operacional:** com os defaults (400/dia, reserva 1000), a coleta automatica passa
  a parar quando o saldo estimado chegar a ~1.200. E' o comportamento pedido — preservar credito
  para o enriquecimento —, mas REDUZ o volume de coleta atual, o que o operador aprovou.
- **Validacao:** `npm test` 1984/1986 (as 2 falhas de motor de IA sao ambientais e pre-existentes).
  18 testes novos, incluindo anti-drift entre a lista de scrapers do modulo e o CHECK da migration.

## 2026-09-16 - Instagram do GMN entra na coleta normal, busca nao repete, ICP pede registro

- **Contexto:** depois de aplicar `npm run instagram:handles --aplicar` no acervo, restava fazer
  lead novo nascer certo e evitar que a interface gastasse CSE repetindo uma busca que ja retornou
  `nao_encontrado`.
- **Decisao 1 - a coleta normal tambem extrai o Instagram declarado no GMN.** O script em lote
  corrigiu o acervo, mas sem alterar `salvarProspect` todo lead novo voltaria a nascer sem
  `instagram_handle`. A regra foi colocada na normalizacao da persistencia e reusa
  `services/instagram-perfil.js`, que exige URL do Instagram e devolve o handle.
- **Decisao 2 - recoleta nao sobrepoe handle existente.** Se o registro ja tinha
  `instagram_handle`, a coleta preserva o valor atual. Se ainda nao tinha e o GMN trouxe um link
  comprovado, a recoleta pode preencher, inclusive sobre `nao_encontrado`/candidato sem handle.
- **Decisao 3 - busca CSE e oferecida uma vez por estado do cadastro.** Depois de
  `nao_encontrado`, repetir a mesma busca so consome cota e tende a devolver o mesmo nada. O proximo
  caminho e informacao nova: registrar manualmente o Instagram ou mudar o cadastro.
- **Decisao 4 - ICP humano nao e bloqueado, mas fica sem ambiguidade.** O operador pode marcar
  `instagram_ativo` por julgamento proprio; a tela apenas avisa que o sistema so consegue verificar
  um perfil registrado e oferece o atalho para registrar. Regra critica continua no backend: o sinal
  automatico do ICP le `perfilConfirmado`, nao o aviso visual.
- **Validacao:** testes focados de Instagram/backend e front, `npm run typecheck` em backend e
  frontend. `core.test.js` completo continua com as 2 falhas ambientais conhecidas de OpenAI 429.

## 2026-09-16 — O filtro de recencia deixou de ser incalculavel; descarte por inatividade

**Contexto.** Em 2026-09-16 de manha a medicao concluiu que o filtro de 6 meses era
incalculavel: dos 4.631 prospects, ZERO tinham data de atividade. A conclusao estava certa
sobre o BANCO e errada sobre a FONTE. A Bright Data devolve a data em
`top_reviews[].review_date`; o adaptador lia `reviews`. Confirmado contra os 262 registros
reais da coleta de `Energia Solar`/Goiania: **205 tem data**, e o classificador
`calcularAtividadeGoogle` produz o mesmo veredito pelos tres caminhos (registro cru, lead
adaptado e linha de banco).

**Decisao 1 — perguntar o estado da coleta ANTES de desistir dela.** O worker encerrava o
snapshot por idade/tentativas antes de consultar o job. `BUSCA_MAX_TENTATIVAS = 40` (40 ticks
de 60s) cortava aos ~40 min, muito antes dos `BUSCA_MAX_IDADE_MIN = 180` que o proprio
comentario declarava como limite — dois limites para a mesma decisao, e quem cortava nao era o
que estava escrito. A coleta ficou pronta em 40,4 min com 262 registros e 0 erros, e foi
marcada `falhou`. Agora a desistencia e' DECIDIDA antes e APLICADA depois da consulta: snapshot
`ready` e' materializado por mais velho que seja. Ela passou a valer tambem no ramo de estado
desconhecido e no `catch` — sem isso, um snapshot cuja consulta falha sempre nunca alcancaria
o ramo de desistencia e seguraria a trava de "uma coleta por empresa" para sempre.
*Alternativa recusada:* so' aumentar o teto de tentativas. Trataria o sintoma; a coleta seguinte
que passasse do novo teto seria descartada do mesmo jeito, ja pronta.

**Decisao 2 — recuperar o snapshot em vez de recoletar.** O job continuava `ready` na Bright
Data. Reabrir a linha (`status='processando'`, `tentativas=0`) devolveu 200 leads pelo caminho
normal do worker, com `custo_registros=262` no ledger. *Alternativa recusada:* disparar busca
nova — custaria outros 262 registros para obter o dado ja pago. O registro foi baixado para
disco ANTES de qualquer mudanca, porque o snapshot anterior desta mesma carteira ja havia
expirado (404).

**Decisao 3 — o script de descarte foi GENERALIZADO, nao duplicado.**
`descartar-leads-fechados.js` virou `descartar-leads-inativos.js` (`git mv`, historico
preservado) com a flag `--recencia[=dias]`. Mecanica, auditoria, lotes e preservacao de decisao
humana sao as mesmas; o criterio continua vindo de `services/google-business-activity.js`.
*Alternativa recusada:* um segundo script. Duplicaria ~150 linhas e criaria dois lugares para
corrigir a mesma mecanica.

**Decisao 4 — ausencia de data NUNCA vira descarte.** `ativo_sem_data` e
`possivelmente_inativo` sao MANTIDOS mesmo com `--recencia`. Um lead sem review pode ser um
negocio novo. Concluir veredito onde nao ha prova e' o defeito que este repositorio ja removeu
duas vezes (fallback da PJ no webhook; instancia por `atualizado_em`). Ha teste que falha se
isso mudar.

**Decisao 5 — a acao de auditoria separa os dois fatos.**
`lead_descartado_fechado_no_google` (o Google declarou) e `lead_descartado_por_inatividade`
(inferencia nossa, a partir de um corte que uma pessoa escolheu) tem forcas diferentes; somar
as duas faria uma reversao futura nao saber o que esta revertendo. O nome antigo e' preservado
para o fechamento porque ja existem 40 linhas gravadas com ele.

**Decisao 6 — `--recencia` nao e' o padrao.** O corte e' decisao COMERCIAL, nao fato tecnico.
O default de 365 dias e' conservador; 183 (os "6 meses") descarta tambem `atividade_morna`,
que e' zona cinzenta. Corte invalido ABORTA em vez de cair no default — `--recencia=abc`
virando 365 dias descartaria leads por um numero que ninguem escolheu.

**Divida declarada.** O teto de 200 por busca cortou 62 dos 262 registros coletados e pagos, e
48 leads solares antigos seguem sem classificacao de atividade por nao terem entrado no
recorte. A coleta e' sequencial a partir de UM input (`avg_duration_per_input` = duracao
total): dividir a cidade em varias coordenadas paralelizaria, mas muda disparo e dedup — fica
para decisao propria.

---

## 2026-09-17 — Enriquecimento de Instagram por lead + relogio da busca avulsa

Contexto: o pedido do operador (funil de Instagram para todo lead novo ou reencontrado, leitura
de ate' 5 posts, e busca avulsa que nao bloqueie a operacao). Plano de origem:
`docs/analise-enriquecimento-instagram.md` (Fases 2 a 5; as Fases 0 e 1 ja estavam em producao
nos commits `2c8a394` e `44b8721`).

**Decisao 1 — a SONDA veio antes do codigo, e cancelou uma etapa inteira.** Autorizada pelo
operador, custou **1 credito** (`npm run instagram:sonda --handle=magazineluiza --confirmar`,
snapshot `sd_mu4s0dte1kezq4wylo`, 2026-09-17). Resultado: o dataset `ig_perfis` **ja devolve
`posts_count` e um array `posts` com `datetime` em cada um**, alem de `external_urls`,
`biography`, `followers`, `is_private` e `is_verified`.

*Consequencia:* a **etapa 4 (dataset separado de posts) NAO EXISTE**. Ela custaria ~5 creditos
por lead para buscar o que a chamada de perfil ja traz — ~720 creditos por rodada de 200 leads
contra **~120**. Com o saldo informado, ~39 rodadas em vez de 6. A migration 082 nasceu com
DUAS etapas, nao tres, e ha guarda de regressao que falha se `ig_posts` ou uma coluna
`instagram_posts_json` reaparecerem.

*Por que a sonda e nao o codigo direto:* e' literalmente a Decisao 1 de 2026-09-16 (quatro
grafias chutadas de `latest_review_date`, 200 coletas pagas, zero datas, snapshot ja expirado).
Um credito para nao repetir aquilo foi o melhor investimento desta entrega.

*Achado que so a sonda daria:* **o array `posts` NAO vem ordenado** — no perfil sondado o indice
8 era `2026-08-14` enquanto o 9 era `2026-09-11` (post fixado no topo). Por isso a data lida e' o
**MAXIMO** dos posts analisados, nunca `posts[0]`. Confiar na ordem daria a data errada
justamente nos perfis de negocio, que sao os que fixam post.

**Decisao 2 — falha da fonte NUNCA vira veredito sobre o lead.** Medido em 2026-09-17: a chave
do `GOOGLE_CSE_KEY` local estava **invalida** (`API_KEY_INVALID`) e `consultarCseInstagram`
**engolia o erro devolvendo `[]`**. Ligar o funil sobre isso marcaria a carteira inteira como
"nao tem Instagram" sem ninguem ter olhado — e depois ninguem saberia distinguir esse veredito
falso de uma busca honesta que nao achou nada.

`buscarPerfisDeNegocio` passou a devolver `{ok, resultados, consultas, erro, statusCode}` em vez
de uma lista solta; `nao_encontrado` so' e' gravado quando a fonte RESPONDEU. **A rota manual
`POST /leads/:id/instagram/procurar` tinha exatamente o mesmo defeito** (o comentario dela dizia
"e' honesto: uma busca realmente aconteceu" — com a chave quebrada, nao acontecia) e hoje
responde 503 sem alterar uma linha do lead. Guardas de regressao nos dois pontos.

*Alternativa recusada:* criar `buscarPerfisDeNegocioDetalhado` ao lado da antiga. Duas funcoes
para a mesma coisa e' a duplicacao que o `AGENTS.md` proibe; a antiga tinha **um** chamador, e
refatorar era mais barato que conviver.

**Decisao 3 — duas moedas, dois tetos, contados separados.** Descoberta gasta **cota do Google
CSE** (100/dia no gratuito); perfil gasta **credito da Bright Data**. Um teto unico faria o
esgotamento de um travar o outro. Decisao do operador: teto diario (default 90 consultas) e o
**excedente ESPERA o dia seguinte**, nunca vira veredito. `buscarPerfisDeNegocio` foi travada em
**1 pagina** de CSE para o custo por lead ser previsivel em exatamente 1 consulta — e' sobre
isso que o teto e' calculado.

*Numero que sustenta a decisao:* medido em 2026-09-16, apenas **11,9%** dos leads trazem o
Instagram de graca no Google Meu Negocio. Os outros 88% dependem do CSE — **o gargalo deixou de
ser credito e passou a ser cota**.

**Decisao 4 — o perfil roda TAMBEM para candidato.** Contra-intuitivo de proposito: o registro
traz `biography` e `external_urls`, ou seja telefone e site, as duas provas FORTES que a busca
por texto nao tinha. Um credito que converte "incerto" em "confirmado" ou "descartado" sem
ocupar uma pessoa e' bom negocio. A revisao humana passa a ser o ULTIMO recurso, nao o primeiro.

*Alternativa recusada:* revisar antes, raspar depois. Gasta o recurso mais caro que existe —
atencao humana — para economizar o mais barato.

**Decisao 5 — `NULL`, `nao_verificado` e `sem_posts` sao TRES estados.** `NULL` = a etapa nunca
rodou; `nao_verificado` = rodou e a fonte nao deu como saber (**perfil privado**, sem data
legivel, contrato diferente do sondado); `sem_posts` = a fonte **declarou `posts_count = 0`**,
que e' informacao comercial legitima. Colapsar os dois primeiros faria perfil privado, erro de
rede e contrato incompleto virarem todos "nao posta nada". **Perfil privado pode ser muito
ativo — so nao da para ver.**

**Decisao 6 — o sinal do ICP e' ASSIMETRICO, e o modelo nao mudou.** Atividade medida e PARADA
(`atividade_antiga`/`sem_posts`) deixa de sugerir `instagram_ativo`: agora se SABE que nao esta
ativo, e continuar sugerindo faria o sistema contrariar o que mediu. Atividade **nao medida**
continua sugerindo — ausencia de medida nunca vira negativa, senao toda a base perderia
pre-marcacao enquanto o worker nao a alcanca (e' a promessa explicita da entrega anterior). O
modelo **Tenka v1.1 permanece intacto**: mesmos 8 criterios, 13 pontos e cortes.

Atividade de perfil apenas CANDIDATO **nunca pontua** — `perfilConfirmado` ja a barra —, e a
tela e' obrigada a carregar a ressalva **em texto**, nunca so numa cor. Regra do operador.

**Decisao 7 — enriquecimento em SEGUNDO PLANO, e a importacao so enfileira.** Pendurar ~176
consultas ao CSE e um job pago dentro de `salvarProspects` seguraria leads **JA PAGOS** fora do
Banco de Leads enquanto o funil trabalha. Ha guarda de regressao que falha se `salvarProspects`
passar a chamar busca, trigger ou o worker. O enfileiramento e' `ON CONFLICT DO NOTHING`: lead
reencontrado numa recoleta **nao repaga** busca nem perfil.

**Decisao 8 — o relogio da coleta vem do BACKEND.** `BUSCA_MAX_IDADE_MIN` (180) e
`RESERVA_ORFA_MAX_MIN` (10) passaram a ser exportados de `prospecting.js` e sao lidos pela rota
de status. Repetir os numeros no front viraria duas politicas de desistencia divergindo em
silencio — a tela promete exatamente o prazo que o worker aplica. `existeColetaEmVoo` (booleano)
virou `coletaEmVoo` (com mercado, `desde`, `idade_min` e se ja foi disparada); o campo
`data.coleta` e' **aditivo** e `coleta_em_andamento` continua igual.

*Por que isto importa:* uma coleta de 40 min e' legitima e o worker so desiste com 3h. Sem
inicio e sem fim na tela, toda espera longa parece travamento.

**Divida declarada 1 — `MAX_POSTS_ANALISADOS = 5`.** O operador pediu "no maximo os 5 primeiros"
quando ainda se acreditava que cada post custaria um credito. A sonda derrubou a premissa: os
posts vem juntos do perfil, de graca. Manter 5 foi respeitar o pedido, mas o registro cru guarda
**todos** os devolvidos (12 no perfil sondado), entao subir o numero e' uma constante e nao exige
recoletar. Ler todos seria marginalmente mais robusto contra perfis com varios posts fixados.

**Divida declarada 2 — a chave do Google CSE esta invalida.** Enquanto nao for trocada, a etapa
de descoberta **nao produz nada** (fica `pendente`, reagendada a cada 2h, sem gravar veredito) e
so os 11,9% que vem do Google Meu Negocio chegam ao perfil. O comportamento e' o correto; o
custo e' operacional.

**Divida declarada 3 — o credito da sonda nao entrou no ledger.** O banco de producao nao e'
alcancavel do ambiente local (`DATABASE_URL` aponta para o host interno do Railway). Um credito
real foi gasto sem linha em `prospectador.brightdata_consumo`. Reancorar com
`npm run brightdata:creditos -- --informar=<saldo>`.

---

## 2026-09-17 — Descoberta de Instagram somente via Bright Data SERP

Contexto: o operador confirmou a regra de produto para a Aquisicao/enriquecimento de Instagram:
**nao usar Google CSE direto; usar somente Bright Data**. A descoberta continua semanticamente
uma busca `site:instagram.com <nome/nicho> <cidade>`, mas o fornecedor passa a ser a SERP API da
Bright Data (`POST https://api.brightdata.com/request`) com `BRIGHTDATA_API_TOKEN` e
`BRIGHTDATA_SERP_ZONE`.

**Decisao 1 — `social-discovery` e o ponto unico de descoberta SERP.** O endpoint direto
`https://www.googleapis.com/customsearch/v1` saiu do modulo. `buscarPerfisDeNegocio` e
`descobrirPerfisPorNicho` agora chamam Bright Data SERP com `format: "raw"` e
`data_format: "parsed_light"`, normalizando `organic[].link/title/description` para o mesmo
contrato `{ok, resultados, consultas, erro, statusCode}`. Os aliases `consultarCseInstagram*` e
`cseConfigurado` ficaram apenas para compatibilidade de chamadores antigos; eles apontam para
Bright Data SERP e nao consultam Google CSE.

**Decisao 2 — falha da SERP continua nao sendo veredito.** A regra da entrega anterior foi
mantida: se a SERP falha, o worker reagenda sem consumir tentativa e a rota manual responde 503
sem alterar o lead. `nao_encontrado` so e gravado quando a Bright Data SERP respondeu com sucesso
e nenhum candidato passou pelo julgamento de `instagram-perfil.js`.

**Decisao 3 — env nova e teto renomeado.** A zona SERP fica em `BRIGHTDATA_SERP_ZONE`, sem valor
inventado no repositorio. O teto diario da descoberta passa a ser `INSTAGRAM_SERP_TETO_DIARIO`
(default 90). `INSTAGRAM_CSE_TETO_DIARIO` ainda e lido como fallback para nao quebrar ambiente
antigo, mas nao e a configuracao recomendada.

**Impacto:** nenhuma migration. A coluna `custo_consultas` permanece porque ja representa a moeda
generica "consultas da descoberta"; renomear banco agora seria destrutivo e sem ganho operacional.
Documentacao e testes foram atualizados para impedir volta do endpoint `customsearch/v1` nesse
fluxo.

---

## 2026-09-17 — Modal de detalhes do lead como ficha operacional

Contexto: Banco de Leads e Aquisicao usam o mesmo `LeadDetalhesModal.tsx` para abrir a ficha do
lead. Depois da regua de qualificacao, o modal passou a acumular checklist ICP, score de
cadastro, sinais automaticos, penalidades, contexto e mensagem gerada.

**Decisao 1 — a primeira dobra responde "qual decisao tomar?".** O modal agora abre com nome,
mercado, selos de ICP/validacao, resumo do checklist, regua operacional e completude de cadastro.
Detalhes extensos ficam abaixo ou na lateral. Isto segue o guia visual: tela operacional, densa e
escaneavel, sem hero/marketing.

**Decisao 2 — checklist humano e sinais automaticos continuam separados.** O checklist e a area
principal editavel; sinais automaticos, penalidades e cadastro ficam em blocos de apoio. O
frontend nao calcula nova regra critica: apenas apresenta `qualificacao_resumo`, `icp_resumo_json`
e tradutores puros ja existentes.

**Decisao 3 — sem novo padrao estrutural fora do componente.** A mudanca e local ao modal
compartilhado. Nao houve rota, schema, dependencia, env ou fluxo paralelo. O autosave e o envio
`finalizar` ao desmontar o modal foram preservados.

---

## 2026-09-17 — Ordenacao `ICP + cadastro` por prioridade comercial

Contexto: o cabecalho `ICP + cadastro` podia parecer uma ordenacao dos melhores leads para
fechar, mas Banco de Leads usava apenas ICP e Aquisicao usava `score_cadastro`. Isso misturava
fit comercial com completude de dados.

**Decisao 1 — a chave `prioridade` ordena por fit, nao por completude.** A coluna passa a usar
uma prioridade comercial composta por faixa ICP, score ICP, `qualificacao_resumo.score_100` e
cadastro apenas como desempate. Assim `score_cadastro` continua sendo evidencia/completude, nao
probabilidade de venda.

**Decisao 2 — Aquisicao ordena no servidor.** Como a tabela mostra uma pagina do conjunto, a
chave `prioridade` entrou em `ORDEM_CALCULADA_PROSPECTS` e usa o mesmo recorte por ids ja
existente para `pontos`/`horario`. Clicar no cabecalho ordena a carteira inteira antes da
paginacao.

**Decisao 3 — sem migration e sem dependencia nova.** A prioridade e calculada na leitura, com as
colunas ja existentes (`icp_*`, `raw_json`, cadastro e qualificacao). `▼` mostra melhores leads
primeiro; `▲` mostra piores/menos prioritarios primeiro.

---

## 2026-09-18 — Camada de COMISSAO do comercial (SDR) — migration 083

Contexto: o pedido e' sustentar um programa de SDR com comissao escalonada (10/12/15/18% por
faturamento originado no mes), gatilho no PAGAMENTO real do cliente, painel de progresso e
ranking mensal. A ATRIBUICAO ja existia (`lead_responsavel_historico`, 072; `agenda_eventos.
responsavel_id`, 076; papel `comercial`, 070). A camada financeira NAO existia: grep por
`comiss|commission|remunera` em `src/` e `sql/` nao devolvia nada.

**Reversao declarada.** `docs/analise-processo-comercial-tenka.md` §1.5 registrou em 2026-08-18
que nao ha estado de pagamento e que vendas/receita seriam MEDIDAS FORA do sistema. Esta entrega
reverte aquela decisao, a pedido do operador.

**Decisao 1 (D1) — a venda e' entidade PROPRIA, e a Meta continua com UMA fonte.** `app.vendas`
tem `agenda_evento_id` OPCIONAL, porque muita venda nao vem de reuniao (fechamento por WhatsApp,
semanas depois). Quando vem, a MESMA transacao grava `agenda_eventos.venda_valor` — que e' o que
`meta-dispatch` le para emitir o `Purchase`. Um unico caminho de escrita, dois consumidores, sem
divergencia. Evento aceito pela Meta nao se estorna, entao duplicar a fonte era o risco maior do
diff. Alternativa descartada: usar so' a agenda, que amarraria a comissao a alguem ter marcado a
reuniao no lugar certo.

**Decisao 2 (D2) — a comissao integral e' liberada no PRIMEIRO pagamento.** O parcelamento do
cliente nao reduz o percentual prometido ao SDR. **Risco declarado e aceito:** cliente que para na
2a parcela deixa a comissao ja liberada. E' coerente com o desenho do programa — o risco do
projeto e' da operacao e o SDR nao controla inadimplencia. `proporcional` e `acumulado_50` foram
discutidos e NAO existem: a CHECK `comissao_planos_gatilho_chk` e' fechada em `primeiro_pagamento`,
porque o valor nasce junto do executor (licao da migration 067).

**Decisao 3 (D3) — o ranking nasce em modulo PROPRIO; a guarda do painel da equipe fica intacta.**
`frontend/lib/equipe-painel.test.js:119` proibe placar por ATIVIDADE (`ranking`, `produtividade`,
`percentual`, `score`) e NAO foi tocada. O ranking novo e' por FATURAMENTO PAGO ORIGINADO —
resultado de negocio verificavel, nao vigilancia de esforco — e vive em `lib/comissao.js`. Por
faturamento e nao por numero de reunioes, de proposito: ranquear volume de reuniao paga para
marcar reuniao ruim.

**Decisao 4 (D4) — cada um ve so' o proprio dinheiro.** O ranking devolve nome e faturamento
originado; NUNCA a comissao de ninguem. Ha teste no backend (`montarRanking` nao emite `comissao`)
e guarda no front.

**Decisao 5 — o percentual e' CONGELADO na linha da venda, nunca recalculado na leitura.** A regra
escolhida ("a taxa alcancada vale para as PROXIMAS vendas do mes, sem recalcular para tras")
depende da ORDEM dos creditos no mes. Recalculado na leitura, a comissao de uma venda antiga
mudaria quando outra venda fosse paga com atraso — o SDR veria o numero dele cair sem ninguem ter
feito nada. Guarda de regressao le a camada de leitura de `db/comissao.js`.

**Decisao 6 — o plano e' VERSIONADO** (`slug + versao`, padrao de `prospectador.icp_modelos`), com
UM ativo por empresa (indice unico parcial). Publicar plano novo arquiva o anterior; venda ja
creditada continua apontando para a versao sob a qual foi creditada. Editar plano vigente
reescreveria o que a empresa ja pagou.

**Decisao 7 — competencia = mes do RECEBIMENTO, nao do fechamento.** E' a leitura honesta de
"faturamento pago no mes": venda fechada em agosto e paga em setembro conta em setembro.

**Decisao 8 — autorizacao em DOIS niveis.** O mount exige `COMISSAO_VER_PROPRIA` (ver o proprio
dinheiro e' parte do trabalho; programa que a pessoa nao pode auditar e' promessa sem prova); cada
ESCRITA exige `COMISSAO_GERENCIAR` por rota — quem define quanto se paga nao pode ser quem recebe.
As duas capacidades entraram em `ROTAS_POR_CAPACIDADE` e `ESCRITAS_COM_CAPACIDADE_PROPRIA`.

**Decisao 9 — nao ha exclusao de venda nem de pagamento.** `venda_pagamentos` e' append-only;
cancelar venda so' vale ANTES do credito. Depois de liberada, a comissao e' um fato que o SDR ja
viu no painel. Mesma disciplina de Roteiros (arquivar) e Membros (desativar).

**Divida tecnica declarada:** o acumulado do mes e' recalculado por `SUM` a cada leitura do painel.
Com o volume atual (dezenas de vendas/mes) e' irrelevante; se incomodar, a saida e' materializar o
acumulado por (originador, competencia) na escrita — nunca cachear no front.

## 2026-09-18 — Operacao Comercial, Etapa 1: a PORTA do programa (aceite) — migration 084

Contexto: o pedido e' implementar por ETAPAS um programa de "Operacao Comercial". A Etapa 1 e' a
entrada: o dono cria o login do comercial e, no primeiro acesso, antes de ver lead, missao,
comissao ou ranking, a pessoa passa por uma tela de aceite (termo, rolagem ate o fim, maioridade,
leitura das regras), com registro de data, usuario e VERSAO do termo. Nada de aceite/termo existia
no repositorio.

**Decisao 1 (D1) — o gate vive em `requireEmpresaAccess`, nao nos mounts e nao em
`requireCapacidade`.** `/conversas`, `/whatsapp` e `/agenda` autorizam POR ROTA, entao um gate por
mount deixaria buracos e uma rota nova nasceria fora dele — e uma LISTA de mounts bloqueados e'
exatamente o tipo de coisa que apodrece no primeiro modulo novo. `requireEmpresaAccess` roda em
TODO request com escopo de empresa: e' o unico ponto onde "antes do aceite, nada da empresa
responde" e' uma afirmacao verdadeira. Alternativa descartada: middleware aplicado mount a mount.

**Decisao 2 (D2) — UMA excecao, nomeada e contada: `requireEmpresaAccessSemAceite`.** A tela do
termo precisa ser alcancavel enquanto todo o resto esta barrado; um bloqueio sem macaneta e'
lockout, nao gate. A variante continua exigindo `requireAuth` e vinculo ativo — dispensar o ACEITE
nao dispensa a AUTENTICACAO. Guarda de regressao varre `src/routes/**` e falha no SEGUNDO uso.

**Decisao 3 (D3) — sujeitos sao `comercial` e `member`; `owner` e `admin` nao.** Escolha do
operador. O termo e' o contrato de quem TRABALHA no programa, e quem responde pela empresa e' a
outra parte do acordo. Torna-los sujeitos trancaria o dono fora do proprio produto no primeiro
boot depois do deploy, sem ninguem acima dele para destravar.

**Decisao 4 (D4) — aceite NAO e' capacidade.** Sao duas perguntas diferentes: capacidade responde
"o papel alcanca esta acao?", aceite responde "esta pessoa entrou no programa?". Fundi-las
deixaria um admin conceder "dispensa de termo" pela concessao ADITIVA de
`usuarios_empresas.permissoes` — dispensar por tela o consentimento que o programa existe para
colher. Guarda de regressao falha se `acesso-capacidades.js` ganhar capacidade de aceite/termo.
Consequencia: o modulo puro do programa NAO barra papel desconhecido (devolve `nao_sujeito`) — ele
nao autoriza nada, e quem nao tem papel conhecido ja nao alcanca capacidade alguma.

**Decisao 5 (D5) — registro APPEND-ONLY com VERSAO e HASH, nao uma coluna em
`usuarios_empresas`.** O aceite e' um fato datado sobre um TEXTO. Uma coluna guardaria so' o ultimo
estado e seria sobrescrita quando o termo mudasse de versao, apagando a prova de que a pessoa
aceitou a v1 em setembro. A VERSAO diz QUAL termo; o HASH prova que aquele texto nao mudou depois.
Mesma disciplina do percentual congelado no credito de comissao (083). O hash gravado e' sempre o
do SERVIDOR: aceitar um hash vindo do corpo faria o registro afirmar que a pessoa concordou com um
texto que o sistema nunca viu.

**Decisao 6 (D6) — o termo vive VERSIONADO no fonte, nao numa tabela editavel.** Termo editavel por
tela exige tela de edicao, revisao e publicacao, e nada disso existe nesta etapa; pior, texto que
muda sem versao faz o registro mentir. Editar o texto passa a exigir subir a VERSAO no mesmo diff,
e versao nova volta a exigir o aceite de quem ja tinha aceitado. O texto v1.0 e' RASCUNHO redigido
para ser simples e honesto — nao substitui revisao juridica.

**Decisao 7 (D7) — SEM BACKFILL, consequencia declarada e aceita.** No primeiro boot depois do
deploy, toda pessoa com vinculo `comercial` ou `member` fica parada na tela de aceite ate assinar.
Inserir aceite por migration seria o sistema afirmando que alguem leu um texto que nunca viu —
mesmo raciocinio de `legado`/`origem_vinculo` (061) e de `qualificacao` (071).

**Decisao 8 (D8) — custo de I/O zero: o aceite vem no MESMO SELECT do vinculo.** O gate roda em
todo request autenticado com escopo de empresa; uma segunda consulta ali dobraria a ida ao banco
para ler um dado que esta a um `LEFT JOIN LATERAL` de distancia. A camada de dados NAO conhece a
versao vigente de proposito — comparar e' do modulo puro, senao a regra existiria em dois lugares.

**Decisao 9 (D9) — `403 ACEITE_PENDENTE`, nunca o `FORBIDDEN` generico.** 403 e nao 401 porque a
sessao e' valida: o que falta e' um ato da pessoa. Codigo PROPRIO porque a tela precisa distinguir
"voce nao tem permissao" (que nao se resolve sozinho) de "falta aceitar o termo" (que se resolve
numa tela).

**Decisao 10 (D10) — o front REDIRECIONA, nunca bloqueia.** `AuthGuard` usa o campo aditivo
`programa_aceite` que `/api/auth/me` passou a devolver (sem request novo). Apagar o modulo do front
deixa o sistema bloqueado, so' que ilegivel. Veredito AUSENTE nao redireciona: errar para esse lado
custa um erro visivel; errar para o outro tranca quem podia entrar.

**Impacto:** banco (1 tabela nova, aditiva), autorizacao (1 gate novo em ponto unico), 2 rotas
novas sem capacidade, 1 tela nova, 2 campos aditivos em respostas existentes (`/me` e o vinculo).
Nenhuma variavel de ambiente nova, nenhuma capacidade nova, nenhum mount trocou de gate, nenhum
prompt de producao alterado. Validado: `npm test` 2051/2053 (as 2 falhas sao as conhecidas de 429
em chamada real de IA, `core.test.js`), `npm run typecheck` limpo, `tsc --noEmit` do frontend limpo,
`node --test lib/*.test.js` 509/509.

## 2026-09-18 — Operacao Comercial, Etapa 2: MISSAO (desafio com recompensa) — migration 085

Contexto: a Etapa 1 criou a PORTA do programa (aceite do termo) e a camada de comissao (083) ja
responde "quanto esta pessoa originou de faturamento pago". Faltava o DESAFIO. Decisoes do
operador nesta data: missao = desafio com recompensa; o DONO cria UMA e ela vale para a equipe;
so' a propria pessoa ve o progresso dela.

**Decisao 1 (D1) — a missao mede RESULTADO PAGO, com UMA metrica e CHECK fechada.** Premiar
atividade paga por atividade: recompensar "numero de reunioes" paga para marcar reuniao ruim. E' a
mesma razao pela qual a Decisao 3 de 2026-09-18 recusou ranking por atividade e pela qual
`frontend/lib/equipe-painel.test.js` quebra o build se o painel da equipe virar placar — guarda que
NAO foi tocada. A CHECK fechada em `faturamento_pago_originado` e' a licao da 067 e do gatilho da
comissao: valor de vocabulario nasce junto do executor, senao nasce missao que entra na tela e
nunca pode ser cumprida. Alargar a CHECK e implementar o medidor tem de ser o MESMO diff.

**Decisao 2 (D2) — publicada, a missao e' IMUTAVEL.** Alvo, recompensa, metrica e janela nunca sao
editados. Mudar o alvo em outubro reescreveria o desafio que alguem cumpriu em setembro, e "quem
alcancou" deixaria de ser fato para virar uma conta que depende do estado atual da tabela. Para
mudar: encerra e publica outra (padrao de `comissao_planos` e `roteiro_versoes`). Sem trigger: a
garantia e' que nenhum caminho escreve essas colunas, com guarda de regressao lendo o fonte.

**Decisao 3 (D3) — NAO existe tabela de conquista; quem alcancou e' DERIVADO.** A fonte e' a mesma
que a comissao ja reconcilia (`app.vendas.comissao_base`, vendas com comissao liberada dentro da
janela). Persistir a conquista criaria uma SEGUNDA definicao de "resultado", que divergiria da
primeira no dia em que uma venda fosse cancelada. Como a missao e' imutavel e as vendas nao somem,
a lista continua reconstruivel para sempre. Alternativa descartada: registrar a conquista dentro da
transacao do pagamento — acoplaria a missao ao caminho do dinheiro e nao premiaria quem ja tivesse
batido o alvo antes de a missao ser publicada.

**Decisao 4 (D4) — progresso PESSOAL; o dono ve quem ALCANCOU, nao o extrato de todo mundo.**
A escolha do operador foi "so' a propria pessoa ve o progresso". Mas uma recompensa que ninguem
sabe a quem pagar nao e' recompensa: a linha honesta e' FATO CONSUMADO (quem bateu o alvo) para
quem paga, e progresso parcial so' para a propria pessoa. A consulta do dono filtra com
`HAVING SUM(...) >= alvo` e ordena por NOME — ordenar por valor seria ranking, que e' outra etapa.

**Decisao 5 (D5) — janela de DATAS, nao competencia mensal.** `vendas.competencia` e' sempre o dia
1 do mes (083); amarrar a missao a ela proibiria desafio semanal ou quinzenal. O SQL usa
`comissao_liberada_em >= inicio AND < fim + 1 dia`, porque a coluna e' TIMESTAMPTZ e `fim` e' DATE.

**Decisao 6 (D6) — publicar encerra a anterior VENCIDA, mas nunca a que esta valendo.** Exigir dois
cliques para uma consequencia inevitavel travaria a empresa numa missao vencida que ninguem fechou.
Ja encerrar um desafio EM ANDAMENTO e' uma decisao (tem gente contando com a recompensa) e tem de
ser ato explicito — 409. A unicidade real e' do BANCO (indice unico parcial).

**Decisao 7 (D7) — NENHUMA capacidade nova.** Missao com recompensa e' politica de REMUNERACAO, a
mesma familia de decisao da comissao: o mount reusa `COMISSAO_VER_PROPRIA` e cada escrita exige
`COMISSAO_GERENCIAR`. Criar `MISSAO_GERENCIAR` sem uma decisao distinta por tras seria acrescentar
coluna a uma matriz que ninguem valida — e' assim que matriz de permissao apodrece.

**Decisao 8 (D8) — o sistema NAO paga a recompensa.** Ele publica, mede e diz quem alcancou.
Marcar a recompensa como entregue exigiria um ledger proprio e fica declarado como etapa seguinte,
junto de ranking. Preferivel a inventar um estado de pagamento sem quem o alimente.

**Correcao de processo encontrada no caminho:** o script `test` do `package.json` lista os arquivos
um a um, e `test/comissao.test.js` (da entrega anterior), `test/programa-aceite.test.js` (Etapa 1) e
`test/missao.test.js` NAO estavam nele — as tres suites nao rodavam no comando oficial. Incluidas
neste diff: `npm test` foi de 2053 para 2149 testes.

**Impacto:** banco (1 tabela nova, aditiva), 4 rotas novas sem capacidade nova, 1 secao na tela de
Comissao (sem item de menu novo). Nenhuma variavel de ambiente nova, nenhum prompt alterado, nenhum
mount existente trocou de gate. Validado: `npm test` 2147/2149 (as 2 falhas sao as conhecidas de 429
em chamada real de IA, `core.test.js`), `npm run typecheck` limpo, `tsc --noEmit` do frontend limpo,
`node --test lib/*.test.js` 527/527.

## 2026-09-18 — Operacao Comercial, Etapa 3: LEAD PARADO + painel do dono (sem migration)

Contexto: continuar o programa. Das etapas adiadas restavam ranking, lead parado e painel do dono.
**Ranking JA ESTAVA ENTREGUE** dentro da comissao (083) — `rankingDoMes`, `GET /comissao/ranking` e
a secao na tela — e nao foi reconstruido. Decisoes do operador nesta data: lead parado = **sem acao
do VENDEDOR**; o sistema **marca e avisa** (devolver e' humano); e quer o painel do dono
consolidando missao, ranking, carga e parados.

**Decisao 1 (D1) — "parado" e' falta do VENDEDOR, nao do cliente.** O repositorio ja responde a
outra pergunta em dois lugares (`lead-lock.js`, cliente que nao respondeu, bloqueia disparo;
`lead-fila-trabalho.js`, faixa `abordado_sem_resposta`, ordena a fila). Unificar os tres juntaria
problemas com donos diferentes. Alternativa descartada: um estado unico de "lead frio".

**Decisao 2 (D2) — o sistema MARCA, nao devolve — e e' por isso que NAO HA MIGRATION.** Como o
efeito e' so' apresentar, o estado e' DERIVADO na leitura: sem coluna, sem worker, sem nada para
ficar desatualizado. Devolucao automatica foi recusada pelo operador e tem custo declarado (o lead
so' volta a circular quando alguem olhar); o contrario seria o sistema desfazendo sozinho uma
atribuicao, a classe de automatismo que este repo ja removeu (fallback da PJ, instancia por
`atualizado_em`). Guardas de regressao falham em qualquer INSERT/UPDATE/DELETE nos dois modulos e
se um worker passar a importa-los.

**Decisao 3 (D3) — lead SEM responsavel nunca esta parado.** Ele esta na fila (migration 072,
`responsavel_id = NULL` e' estado de primeira classe). A condicao SQL exige o responsavel ANTES de
olhar a data, e a linha "Sem responsavel" do painel recebe `leads_parados: 0` explicitamente.

**Decisao 4 (D4) — o prazo vem da QUERY, nao de configuracao.** `?parado_dias=` (1..90, default 7).
O admin olha com 7 e, na conversa seguinte, com 15; criar coluna de config para um recorte de
leitura pediria uma decisao permanente para responder uma pergunta passageira. `0` nunca e' aceito.

**Decisao 5 (D5) — limite declarado na REDACAO, nao escondido.** `app.follow_ups.prospect_id` e'
nullable (a identidade la' e' telefone), entao follow-up de contato avulso nao e' visto. O texto da
tela diz "sem acao REGISTRADA" e nunca "nao trabalhou" — a marca afirma o que o sistema viu. Ha
teste cobrando a redacao. Alternativa descartada: casar por telefone, que exigiria as variacoes de
formato e deixaria a medida cara e imprecisa.

**Decisao 6 (D6) — `leads_parados` e' SUBCONJUNTO de `leads` e fica FORA de `cargaAtual`.** Soma-lo
contaria o mesmo lead duas vezes e faria quem tem carteira parada parecer sobrecarregado. A guarda
anti-placar de `equipe-painel.test.js` continua intacta.

**Decisao 7 (D7) — o painel do dono e' a tela `/dashboard/equipe` que ja existia.** Missao e ranking
vem dos MESMOS endpoints da tela de Comissao, carregados separado e em silencio (falha na
consolidacao nao derruba o painel de carga). Uma quarta tela mostrando os mesmos numeros criaria
mais um lugar para divergir — e `GET /equipe` continua sem SQL proprio de contagem, por principio.

**Impacto:** nenhuma migration, nenhuma rota nova, nenhuma capacidade nova, nenhuma env nova.
Dois campos ADITIVOS e um `meta` em `GET /equipe`; uma coluna nova no painel. Validado: `npm test`
2163/2165 (as 2 falhas sao as conhecidas de 429 em chamada real de IA), `npm run typecheck` limpo,
`tsc --noEmit` do frontend limpo, `node --test lib/*.test.js` 537/537.

## 2026-09-18 — Operacao Comercial, Etapa 4: a BAIXA da recompensa da missao — migration 086

Contexto: a Etapa 2 publicava o desafio, media o progresso e dizia QUEM alcancou, mas nao havia
onde registrar que o PREMIO FOI ENTREGUE — buraco que a comissao nao tem (083). Sem a baixa, o dono
pagava e o sistema seguia dizendo "3 alcancaram", sem distinguir quem ja recebeu.

**Decisao 1 (D1) — tabela nova, porque a conquista e' DERIVADA e nao tem linha.** `alcancaramOAlvo`
calcula das vendas pagas; nao existe registro de "fulano alcancou" onde pendurar a baixa. Persistir
a conquista para ganhar essa linha criaria a segunda definicao de resultado que a 085 recusou. O
que se persiste e' um fato NOVO e independente: o premio saiu.

**Decisao 2 (D2) — a conquista e' RECONFERIDA na transacao, com a soma lida do banco.**
`validarBaixa` NAO recebe a conquista como parametro, de proposito: aceitar `alcancou: true` do
corpo deixaria qualquer requisicao pagar premio a quem quisesse. A missao tambem vem do banco, nao
do corpo — o alvo e a janela precisam ser os da missao real, e ela e' imutavel justamente para esse
numero nao mudar. Quem nao alcancou recebe 409 e NADA e' gravado.

**Decisao 3 (D3) — o RETRATO e' congelado.** `originado_no_pagamento` e `alvo_no_pagamento` ficam na
linha pelo mesmo motivo do `comissao_percentual` (083): a conquista continua sendo recalculada, e
sem o retrato "por que paguei este valor?" deixaria de ser respondivel se uma venda fosse cancelada
depois da baixa.

**Decisao 4 (D4) — `valor_pago` e' o que REALMENTE saiu, nullable, e ZERO e' recusado.** Nem todo
premio e' dinheiro (NULL = "saiu e nao era dinheiro"); zero seria "paguei nada" com aparencia de
pagamento. Divergir do declarado na missao e' PERMITIDO e proposital (arredondamento, entrega
parcial): a divergencia fica auditavel na linha em vez de sumir atras do numero da missao, que
continua consultavel porque a missao e' imutavel.

**Decisao 5 (D5) — NAO existe desfazer.** Append-only, como `app.venda_pagamentos`. Dizer "paguei"
e' fato sobre dinheiro que saiu, e um UPDATE apagaria a unica prova da entrega. **Consequencia
declarada e aceita: baixa errada nao se corrige por tela nesta etapa** — por isso o modal avisa
antes, em vez de a acao sair no primeiro clique. Alternativa descartada: estorno explicito, que
exigiria um segundo tipo de linha e uma regra de reconciliacao sem nenhum caso real ainda.

**Decisao 6 (D6) — a PROPRIA pessoa ve a baixa dela.** As baixas sao lidas SEMPRE, nao so' para
quem gerencia: programa de recompensa que o beneficiario nao consegue conferir e' promessa sem
prova — a mesma razao pela qual `COMISSAO_VER_PROPRIA` existe e pela qual o plano de comissao fica
visivel ao SDR. `recompensa_paga` e' `false` e nunca `null`: quem alcancou sempre tem resposta.
Guarda de regressao falha se a leitura das baixas ficar atras do gate de gestao.

**Decisao 7 (D7) — `COMISSAO_GERENCIAR` POR ROTA, sem capacidade nova.** Com o gate do mount (que
e' de LEITURA), o proprio comercial marcaria o premio dele como pago. Sao 3 escritas no router
agora, e `ESCRITAS_COM_CAPACIDADE_PROPRIA` subiu de 2 para 3.

**Impacto:** banco (1 tabela nova, aditiva), 1 rota nova, campos ADITIVOS em `GET /missoes`, um
modal. Nenhuma env nova, nenhuma capacidade nova, nenhum mount trocou de gate. Validado: `npm test`
2176/2178 (as 2 falhas sao as conhecidas de 429 em chamada real de IA), `npm run typecheck` limpo,
`tsc --noEmit` do frontend limpo, `node --test lib/*.test.js` 543/543.

## 2026-09-18 — "Minha Operacao": a Visao Geral do COMERCIAL (sem migration)

Contexto: decisao de produto do operador — o comercial nao deve cair numa Visao Geral
administrativa, e sim numa visao do trabalho dele. **A investigacao mostrou que o problema era
maior:** `/dashboard` chamava `/relatorios/resumo`, montada com `requireCapacidade(RELATORIOS_VER)`,
capacidade que nem `comercial` nem `member` possuem. A PRIMEIRA tela depois do login — e, desde a
Etapa 1, logo apos aceitar o termo — era **um erro 403**. Deixou de ser melhoria e virou correcao.

**Decisao 1 (D1) — a escolha da tela e' por CAPACIDADE, e a capacidade nao e' arbitraria.** O
criterio e' `relatorios_ver`, que e' EXATAMENTE o que a tela administrativa precisa para carregar.
Quem nao a tem nao esta vendo uma tela "menor": veria um 403. Comparar papel com literal aqui
repetiria o defeito que a Etapa 1 do CRM em equipe corrigiu. Enquanto a sessao carrega, NAO se
escolhe tela — decidir no escuro mostraria a visao errada por um instante a cada carregamento.

**Decisao 2 (D2) — o MENU muda junto.** O item `/dashboard` vira "Minha Operacao" pela MESMA
capacidade. Sem isso o menu diria "Visao Geral" e a tela diria outra coisa — o menu mentiria sobre
o proprio destino. A substituicao vive no modulo puro de navegacao, nao no Sidebar, para a regra
existir num lugar so'.

**Decisao 3 (D3) — as tres regras da mensagem de proximidade.** E' a unica coisa da tela que pode
soar falsa, entao virou regra testada: (a) nunca inventar numero — sem meta legivel nao ha barra,
marco nem frase; (b) nunca soar de deboche — com 8% do alvo, "falta pouco!" e' piada de mau gosto,
e o tom sobe junto com o progresso; (c) janela encerrada muda o tempo verbal e tira o selo, porque
"voce consegue" num desafio que acabou ontem e' mentira. Marcos em 50/75/90/100, selo so' a partir
de 90%, e cor nunca e' a unica informacao.

**Decisao 4 (D4) — o fluxo operacional e' ordenado por CONSEQUENCIA, nao por volume.** Prazo
vencido → reuniao de hoje → lead parado → follow-up de hoje → lead livre. Ordenar por quantidade
poria "40 leads livres" acima de "1 follow-up vencido". Contagem zero NAO vira linha: uma lista que
sempre mostra "0 vencidos" treina a pessoa a ignorar a lista inteira.

**Decisao 5 (D5) — `GET /banco-leads/meu-resumo`, rota propria e sempre sobre quem pede.** Nao
aceita `usuario_id` da query: a carteira do colega nao e' recorte de ninguem, e um id na URL
transformaria esta leitura no relatorio de equipe, que ja existe em `/equipe` e e' admin-only. Rota
propria em vez de campo no `meta` da listagem porque contar parados no caminho quente custaria a
subconsulta de ultima acao em toda paginacao. Recorte e condicao de "parado" vem dos MESMOS modulos
do painel da equipe — numeros diferentes para a mesma pergunta em duas telas seriam pior que nao
ter a tela.

**Decisao 6 (D6) — cada bloco carrega e falha sozinho.** O `member` nao alcanca comissao, missao
nem leads; a tela degrada bloco a bloco e, sem nada, DIZ o que houve em vez de ficar em branco.
Alternativa descartada: uma rota agregadora no backend, que criaria SQL proprio para numeros que
cada modulo ja sabe contar — o mesmo principio que mantem `/equipe` sem SQL de contagem.

**Impacto:** nenhuma migration, nenhuma env, nenhuma capacidade nova, nenhuma tela removida. Uma
rota de leitura nova, um modulo puro novo, uma tela nova e o roteamento de `/dashboard`. A visao
administrativa NAO foi alterada. Validado: `npm test` 2176/2178 (as 2 falhas sao as conhecidas de
429 em chamada real de IA), `npm run typecheck` limpo, `tsc --noEmit` do frontend limpo,
`node --test lib/*.test.js` 563/563.

---

## 2026-09-18 — Equipes por Nicho: as 4 decisoes estruturais (ANTES do codigo)

**Contexto:** o operador registrou a camada de **Equipes por Nicho** (uma pessoa em uma equipe
ativa; uma equipe com um nicho; recorte OBRIGATORIO em Banco de Leads, Central de Ligacoes,
Follow-ups e Minha Operacao; missao por equipe; ranking exibido continua GERAL; remover pessoa
devolve os leads dela para livres com aviso). Analise completa em
`docs/analise-equipes-por-nicho.md`. **Nenhuma linha de codigo escrita** — e' mudanca estrutural
e o `CLAUDE.md` exige confirmacao.

**Achado que enquadrou tudo:** `app.nichos` JA EXISTE (038), mas `prospectador.prospects` nao tem
`nicho_id` — guarda `nicho` como TEXTO LIVRE, vindo do termo de busca da Aquisicao
(`prospecting.js:1108`) e SOBRESCRITO pela recoleta (linha 1190). A 038 ja declarava `nicho_id`
nos leads como "migracao futura"; o recorte obrigatorio a torna pre-requisito.

**Decisao 1 — `prospects.nicho_id` + backfill; o recorte casa por ID, nunca por nome.**
Variacao de grafia ("Energia Solar" x "energia solar residencial") tiraria o lead do recorte EM
SILENCIO, e o vendedor veria menos carteira do que tem sem nada explicando por que. `nicho`
continua como texto de auditoria (contrato de `site` x `link_original`, 056). Backfill SIMULA por
padrao; lead que nao casar fica NULL e VISIVEL para revisao — nunca adivinhado. A recoleta nao
pode sobrescrever `nicho_id` (disciplina de `telefone_origem` e `qualificacao`).

**Decisao 2 — quem nao esta em equipe NAO e' recortado.** Mantem o comportamento de hoje (meus +
livres). O recorte so existe onde alguem o definiu — mesma disciplina de "nao se inventa dono"
que governa instancia de envio, quarentena de webhook e ownership. Bloquear criaria um segundo
lockout como o aceite do termo (084), parando todo comercial no dia do deploy.

**Decisao 3 — o nicho da missao e' ROTULO; a metrica NAO e' recortada.** A missao pertence a
equipe e usa os participantes dela, mas mede todo o faturamento pago originado por eles no
periodo. `app.vendas` NAO ganha nicho, e a metrica unica de `app.missoes` (CHECK fechada, 085)
fica intacta. Recortar exigiria rastrear o nicho do lead ate a venda.

**Decisao 4 — lead com compromisso marcado NAO e' devolvido.** Devolve-lo deixaria a reuniao com
responsavel que saiu da equipe. A tela separa os dois numeros no aviso ("X voltam para livres, Y
ficam por terem compromisso marcado"): prometer um numero e devolver outro e' pior que a friccao.
A devolucao e' ACAO EXPLICITA do dono/admin — nunca um worker —, transacional, com uma linha em
`app.lead_responsavel_historico` por lead.

**Risco declarado que a implementacao tem de tratar:** recorte obrigatorio reintroduz, por outro
caminho, o defeito de 2026-09-12 (Banco de Leads abrindo VAZIO para todo comercial). Equipe de
Energia Solar sem lead aprovado desse nicho = tela vazia. O **estado vazio explicativo e'
REQUISITO**, nao polimento, nos quatro modulos — e a Central de Ligacoes ja parte de uma fila
estreita (`qualificacao = 'aprovado'`).

**Fora de escopo:** Agenda ("quando fizer sentido" — vago demais para virar codigo), ranking DA
missao (o operador escolheu destacar o geral), equipe multi-nicho, pessoa em mais de uma equipe.

---

## 2026-09-18 — Equipes Comerciais: equipe e entidade operacional, nao papel

**Contexto:** depois do pre-requisito `prospectador.prospects.nicho_id`, a implementacao precisava
criar onde o dono/admin define "quem trabalha qual nicho". O sistema ja tem
`app.usuarios_empresas` para papel/capacidade; misturar equipe com papel faria permissao e
distribuicao de carteira virarem a mesma coisa.

**Decisao 1 — equipe comercial e tabela propria.** Criada `app.equipes_comerciais`, com
`empresa_id`, `nicho_id`, nome, status e autoria. Equipe organiza trabalho; nao autoriza acesso.
A autorizacao continua em `app.usuarios_empresas` + `services/acesso-capacidades.js`.

**Decisao 2 — nicho sempre por ID composto com empresa.** A FK e `(nicho_id, empresa_id)` →
`app.nichos(id, empresa_id)`. Match por nome continua proibido para recorte obrigatorio, porque
grafia divergente tiraria leads da carteira em silencio.

**Decisao 3 — uma pessoa em uma equipe ativa.** `app.equipe_comercial_membros` guarda historico de
entrada/saida e o indice parcial `equipe_membros_um_ativo_por_usuario_uk` garante uma ativa por
`(empresa_id, usuario_id)`. A pessoa pode ter historico em varias equipes, mas uma ativa por vez.
Remocao de participante fica bloqueada nesta etapa, porque a regra aprovada exige devolver leads
para livres com aviso e preservacao de compromissos marcados.

**Decisao 4 — uma equipe ativa por nicho por enquanto.** O indice parcial
`equipes_comerciais_um_nicho_ativo_uk` evita duas equipes ativas disputando a mesma carteira de
nicho. Se houver squad A/B no mesmo nicho no futuro, isso precisa virar uma decisao explicita.

**Fora de escopo nesta etapa:** aplicar recorte em Banco de Leads/Central/Follow-ups/Minha
Operacao, devolver leads ao remover pessoa da equipe e converter missoes para `equipe_id`.

---

## 2026-09-18 — Missao por EQUIPE: a carencia da missao legada e o recorte nos dois lados

**Contexto:** a entrega de Equipes Comerciais fechou declarando "converter missoes para
`equipe_id`" como fora de escopo. A 085 tinha **uma missao ativa por EMPRESA**, o que ficou
insuficiente depois que cada equipe passou a trabalhar um nicho: o desafio precisa apontar para a
equipe que o executa.

**Decisao 1 — a unicidade muda de dono, e a migration e aditiva.**
`missoes_uma_ativa_por_empresa_uk` da lugar a `missoes_uma_ativa_por_equipe_uk` (parcial,
`equipe_id IS NOT NULL`). Equipes diferentes podem operar desafios diferentes ao mesmo tempo; duas
ativas na MESMA equipe continuariam tornando "a missao ativa" ambigua. Nenhum dado e mutado.

**Decisao 2 — `equipe_id` e NULLABLE, e isso e CARENCIA, nao "ausencia de prova".**
Ao contrario de `origem_vinculo` (061) ou `qualificacao` (071), aqui o nulo nao nomeia uma duvida:
ele preserva um desafio que **ja estava valendo**, com gente contando com a recompensa. Tornar a
coluna `NOT NULL` faria a missao publicada pela 085 sumir da tela no deploy. A obrigatoriedade vive
na APLICACAO — missao NOVA exige equipe, e a rota confere que ela existe e esta **ativa**.
Um segundo indice parcial (`missoes_uma_ativa_geral_por_empresa_uk`) impede duas gerais ativas.

**Decisao 3 — precedencia declarada: missao da EQUIPE vence a GERAL legada.** So uma das duas
aparece. O **historico** de quem esta numa equipe inclui os desafios gerais
(`m.equipe_id = $n OR m.equipe_id IS NULL`): eles valiam para a empresa inteira, e apaga-los
reescreveria o programa que aquela pessoa viveu.

**Decisao 4 — quem gerencia ve o programa INTEIRO e so recorta quando PEDE.** Filtrar o historico
pela equipe a que o proprio admin pertence esconderia dele o resto — e admin tambem pode ser membro
de uma equipe.

**Decisao 5 (corrigida no mesmo dia, `7f4005e`) — o recorte da equipe vale nos DOIS lados.**
Na primeira versao so `alcancaramOAlvo` (a lista do dono) filtrava por membro ativo; a baixa
continuava validando apenas `originou >= alvo`. Como a rota recebe `usuario_id` no corpo, o premio
da missao da equipe A sairia para alguem da equipe B que tambem bateu o alvo — pessoa que nem
aparece na lista. A conferencia de vinculo passou a rodar **antes do INSERT, dentro da transacao**
(`409 MISSAO_PESSOA_FORA_DA_EQUIPE`). E o mesmo principio de `validarBaixa`, que de proposito nao
aceita a conquista como parametro: **quem paga nao pode ser quem afirma o direito**. Missao legada,
sem equipe, segue sem filtro — com ele ficaria impagavel.

**Decisao 6 — a tela DECLARA o recorte que recebeu.** `meta.equipe` vem do servidor e o seletor
emite o **padrao do servidor como 1a opcao**, rotulado com a equipe realmente devolvida. Um
`<select>` com `value=''` sem opcao correspondente exibiria uma equipe enquanto consultava outra,
sem caminho de volta ao padrao — o defeito ja corrigido no Banco de Leads. A lista de equipes so e
buscada por quem gerencia, para nao produzir 403 a cada carregamento de pagina.

**Fora de escopo:** ranking da missao, equipe multi-nicho, pessoa em mais de uma equipe e qualquer
alteracao na comissao (083), de onde a missao empresta a medida.

**Divida tecnica registrada (regressao propria, corrigida em `edb1636`):** ao montar o `WHERE` em
array para aplicar o recorte por nicho em Follow-ups (`1d5958d`), `f.empresa_id` saiu do template
literal. O escopo seguia correto em execucao, mas a guarda de `follow-up-modelo.test.js` deixou de
poder prova-lo pelo fonte. **Licao:** filtro de tenant nao e "mais uma condicao" — fica FIXO no
`WHERE` do template, e so o que e opcional entra no array.

## 2026-09-19 — Bloqueio de agenda que alcanca o BOT + grade de horarios (migration 090)

**Pedido do operador:** poder bloquear a agenda (feriado, reuniao interna, intervalo de almoco,
com repeticao diaria e semanal) e, em todo lugar onde se marca reuniao, mostrar apenas os
horarios disponiveis, em slots clicaveis.

**ACHADO QUE MUDOU O ENQUADRAMENTO (antes de qualquer codigo).** O pedido supunha que bloquear na
tela ja tivesse algum efeito. Nao tinha. Existem **duas agendas que nao se enxergam**:
`app.agenda_eventos` (tela) e `vendas.agenda_eventos` (bot). O bot oferece horario em
`eventosDoDia` e valida a escolha em `validarSlotReuniao` — **as duas lendo so `vendas`**. A tela
grava em `app`. Ou seja: **o bloqueio da tela nunca teve efeito sobre quem marca pelo WhatsApp**,
e a reuniao marcada pelo bot nunca contou como conflito na tela. O pedido nao era uma tela nova:
era um defeito de integridade entre dois calendarios.

**Decisao 1 — ESPELHAR o bloqueio, nao unificar as agendas.** Unificar continua sendo projeto
proprio (ja declarado no `AGENTS.md`) e **nao foi feito**. A alternativa considerada era fazer o
bot ler as duas tabelas (UNION em `eventosDoDia`/`slotEstaOcupado`): mais limpa em teoria, porque
nao duplica dado, e recusada porque mexeria no caminho que decide **todo horario oferecido a
cliente** — o mais quente do funil de vendas. O espelho deixa aquela leitura intacta: para o bot,
o bloqueio simplesmente passa a existir. **Custo aceito e declarado:** o mesmo fato vive em dois
lugares, ligados por `espelho_vendas_id`.

**Decisao 2 — o bloqueio e da EMPRESA INTEIRA.** Nao e preferencia de produto: `vendas` identifica
dono por BIGINT (`dashboard_users`) e `app` por UUID (`usuarios`), e **nao existe traducao entre
os dois**. Bloqueio por pessoa nao atravessaria o espelho — valeria so na tela, reintroduzindo
exatamente o descompasso que esta entrega remove. Os tres casos pedidos (feriado, almoco, reuniao
interna) sao naturalmente da empresa toda. Ele nasce **sem `responsavel_id`**, que e a condicao
que ja fazia um evento conflitar com a agenda de todos (`existeConflito`).

**Decisao 3 — so BLOQUEIO e espelhado.** Espelhar reuniao criaria a MESMA reuniao em duas tabelas,
e a linha de `vendas` carrega lembrete ao cliente, follow-up e conversao da Meta. Duplicar isso
mandaria **mensagem repetida ao lead** e **conversao repetida a Meta, que nao se estorna**. A
reuniao da tela ficou protegida pela direcao inversa: `existeConflito` passou a consultar tambem
a agenda do bot (`ocupacaoDoBot`), que **exclui o proprio espelho** — sem isso todo bloqueio
conflitaria consigo mesmo pelo reflexo e nao poderia ser editado.

**Decisao 4 — compensacao, nao transacao entre schemas.** O espelho nasce ANTES do evento e o
evento ja nasce apontando para ele; se o INSERT falhar, o espelho e desfeito. E o padrao que o
repo ja usa quando duas fontes precisam concordar fora de uma transacao (vinculo de instancia do
Evolution). A ordem e deliberada: criar o evento primeiro deixaria uma janela em que o bloqueio
existe na tela e nao existe para o bot — e e nela que o bot ofereceria o horario recem-bloqueado.
A remocao tambem propaga: sem isso, apagar o bloqueio na tela deixaria o bot recusando para sempre
um horario que ninguem mais ve — bloqueio fantasma, sem macaneta.

**Decisao 5 — grade PROPRIA, sem reusar `buscarDisponibilidadeSemana`.** Aquela funcao responde a
pergunta do BOT: le so `vendas`, usa a janela do funil (19:30–21:15) e aplica buffer de 30 min.
Tres decisoes certas para oferecer horario a um cliente no WhatsApp e erradas para o operador, que
trabalha em horario comercial e precisa enxergar slot colado numa reuniao existente. Reusa-la
obrigaria a parametrizar as tres coisas e faria uma funcao servir a dois donos com regras opostas.
As duas coexistem, cada uma com o seu dono.

**Decisao 6 — o horario ocupado NAO some da grade.** Aparece apagado, com o motivo em texto
(vocabulario fechado: `bloqueio | compromisso | agenda_bot | passado`). Um slot que desaparece faz
o operador achar que a agenda quebrou; um que diz "Feriado" encerra a duvida sem abrir nada.
E **indisponivel nunca e vermelho** — agenda cheia nao e tela cheia de erro (guarda no teste).

**Decisao 7 — `repetir_ate` e OBRIGATORIO.** Repeticao sem fim produz bloqueio eterno, que so se
desfaz dia a dia, e cada dia tem um espelho na outra agenda. Teto de 180 ocorrencias para um erro
de digitacao ("repetir ate 2030") nao virar milhares de linhas em duas tabelas; a resposta traz
`truncado`. Um dia que falha por conflito **nao derruba os outros** — senao um feriado prolongado
viraria "nenhum dia bloqueado" por causa de um unico choque.

**Decisao 8 — a resposta diz `vale_para_bot`, e `false` e informacao de verdade.** Quando nao ha
usuario ativo em `vendas.dashboard_users` para ancorar o espelho, o bloqueio vale na tela e o
WhatsApp **continua oferecendo** o horario. A tela avisa isso em texto. Fingir sucesso total
deixaria a pessoa achar que bloqueou quando nao bloqueou — que e o defeito de origem desta
entrega, so que silencioso.

**Decisao 9 — `AGENDA_VER_EQUIPE` por ROTA no `POST /bloqueios`.** O mount de `/agenda` e
`AGENDA_OPERAR_PROPRIA`, que todo membro tem; sem gate por rota, qualquer pessoa bloquearia o dia
da equipe inteira. Rota propria (e nao `POST /` com `tipo: 'bloqueio'`) porque o bloqueio nasce sem
responsavel, repete, e exige outra capacidade.

**Fora de escopo, declarado:** unificar as duas agendas, recorrencia mensal, feriado nacional
automatico, sincronizacao com Google Calendar e bloqueio por pessoa.

**Risco residual aceito:** o espelho vive em `vendas.agenda_eventos`, cujo `empresa_id` e NULLABLE
(a 077 nao fez backfill) e cuja leitura pelo bot **nao filtra por empresa**. Na pratica o bot e
single-tenant hoje (`dashboard_users`), entao o bloqueio de uma empresa vale para o bot inteiro.
O `empresa_id` e gravado no espelho para que o dia em que aquela leitura passar a recortar por
empresa o dado ja esteja la.

---

## 2026-09-19 — Liberar um NICHO inteiro: aprovacao em lote, por script

**Contexto:** o operador pediu para "deixar todos marcados" os leads de **energia solar**, para a
equipe com foco nesse nicho ter acesso rapido a eles. Decidido no chat: **vincular ao nicho +
aprovar**, como **execucao unica por script** — nao virou botao de tela.

**O achado que enquadrou o pedido: sao DOIS cadeados, e so' um estava faltando.** `nicho_id` abre o
**Banco de Leads** para quem esta em equipe (o recorte de `services/equipes-comerciais.js` exclui
`nicho_id IS NULL` de proposito) e ja foi aplicado em producao pelo backfill de 2026-09-18.
`qualificacao = 'aprovado'` abre a **Central de Ligacoes**, que e' ESTRITA (`sqlAprovado`: `legado`
nao passa) — e para isso **nao existia acao em lote em lugar nenhum**: so' "Marcar lead" 1 a 1 no
Assistente de Oportunidades. E' exatamente o risco que o decision log de 2026-09-18 declarou:
"Equipe de Energia Solar sem lead aprovado desse nicho = tela vazia".

**Decisao 1 — script, nao rota nem botao.** Escolha do operador. Consequencia aceita: liberar o
proximo nicho depende de alguem com acesso ao banco. Se isso repetir, a saida e' uma rota com
`LEAD_TRIAR`, nao copiar o script.

**Decisao 2 — o script SO' PROMOVE: `pendente` e `legado`.** Lead `descartado` NUNCA e'
ressuscitado — alguem o recusou, e decidir de novo o que uma pessoa ja decidiu e' o defeito R9
("lead descartado volta por nova importacao"). Lead ja `aprovado` nao e' tocado: `qualificado_em`
e `qualificado_por` sao `COALESCE`-ados, porque sao a prova de quem triou PRIMEIRO. `status` so'
sobe, pela MESMA lista fechada de `PATCH /leads/:id/icp` — e ha' guarda que le o fonte da rota e
falha se as duas divergirem.

**Decisao 3 — aprovar e' ATO HUMANO: `--usuario` e' obrigatorio para gravar.** O script confere
vinculo ATIVO na empresa e a capacidade `LEAD_TRIAR`, a mesma que a rota de ICP exige por rota.
Sem isso ele seria uma porta lateral para aprovar em lote o que a tela recusa. Gravar
`qualificado_por = NULL` afirmaria que ninguem aprovou; inventar um id seria pior.

**Decisao 4 — a auditoria e' gravada DENTRO da transacao do lote**, e nao best-effort como a
telemetria. Aqui a linha nao e' metrica: e' a prova de quem aprovou e de qual era o estado
anterior de cada lead — e e' dela que sai o **rollback exato**, que o script imprime. Acao
propria (`lead_qualificacao_aprovada_em_lote`), distinta de `lead_icp_avaliado`: uma e' decisao
sobre um lead, a outra sobre um nicho inteiro, e um nome so' as fundiria no historico.

**Consequencia declarada e aceita:** a aprovacao em lote **pula a triagem 1 a 1** daqueles leads e
abre para eles o disparo e a fila de ligacoes. O aviso aparece no relatorio **inclusive em
simulacao** — quem simula esta justamente decidindo se vai aplicar.

**Nenhuma migration, nenhuma rota, nenhuma variavel de ambiente, nenhum arquivo de `src/`
alterado.** Codigo: `scripts/aprovar-leads-por-nicho.js` (+ npm `aprovar:leads-nicho`). Testes:
`test/aprovar-leads-por-nicho.test.js` (16, sendo 9 guardas que leem o fonte).


## 2026-09-19 — "Equipe" e "Equipes comerciais" viraram UMA area

**Contexto.** Eram duas paginas para o MESMO fluxo de trabalho — montar a equipe
(`/dashboard/equipes-comerciais`, em Configuracoes) e depois olhar o resultado
(`/dashboard/equipe`, em Operacao) —, com a MESMA capacidade (`MEMBROS_GERENCIAR`). O gestor
trocava de pagina no meio do proprio trabalho. Unificadas em `/dashboard/equipe`, com tres abas:
Visao geral, Equipes (lista + detalhe, sem trocar de pagina) e Pessoas.

**Decisao 1 — a unificacao e' de APRESENTACAO.** Nenhuma rota de leitura mudou, nenhuma regra de
negocio migrou para o front e **nenhuma permissao foi alterada**: as duas telas ja exigiam
`MEMBROS_GERENCIAR`, entao ninguem ganhou nem perdeu acesso. A juncao das fontes
(`/equipe` + `/equipes-comerciais` + `/elegiveis` + `/comissao/ranking`) acontece num modulo PURO
novo, `frontend/lib/equipe-area.js`, que **so junta e traduz**.

**Decisao 2 — a tela NAO promete o que o backend recusa.** Foram tres conflitos entre a
referencia visual e o produto real, e os tres foram resolvidos a favor do produto:

  1. **Remover membro.** `db/equipes-comerciais.js` lanca 409 `REMOCAO_EXIGE_DEVOLUCAO` porque a
     devolucao de leads nao existe. A referencia desenhava caixas que se desmarcam para remover;
     aqui quem ja e' membro aparece **marcado e BLOQUEADO, com o motivo em texto** (a regra do
     guia visual para controle que a pessoa nao pode usar). Desenhar a remocao faria o gestor
     descobrir no erro.
  2. **Encerrar equipe.** `encerrarEquipe` recusa equipe com gente (409 `EQUIPE_COM_MEMBROS`).
     `podeEncerrar` antecipa isso: o botao fica visivel e desabilitado COM o motivo, em vez de
     oferecer um clique que vira erro e manda o gestor procurar defeito onde ha uma etapa do
     produto que ainda nao nasceu.
  3. **Metrica de "Reunioes" por pessoa.** Nao existe em rota alguma. Nao foi inventada — ha
     guarda de regressao em `lib/equipe-area.test.js` que falha se ela aparecer. As metricas sao
     as REAIS: leads, parados, conversas, follow-ups, vencidos, ligacoes, contatos/fechados do
     dia e faturamento originado.

**Decisao 3 — renomear equipe passou a existir; trocar o NICHO, nao.** Nasceu
`PATCH /api/empresas/:empresaId/equipes-comerciais/:equipeId`, aceitando **so nome e descricao**.
O `nicho_id` e' **recusado com 400 `NICHO_NAO_EDITAVEL`, nunca ignorado em silencio**: e' ele que
recorta o Banco de Leads de todos os membros (`sqlNichoDaEquipe`), e troca-lo por um PATCH moveria
a carteira de varias pessoas de uma vez, sem devolver nada — a mesma classe de problema que fez a
remocao de participante exigir a etapa de devolucao. Ignorar faria a tela achar que salvou.
Trocar de nicho continua sendo encerrar e criar outra, que e' o caminho que deixa rastro.
**Equipe ENCERRADA nao se renomeia**: e' historico, e as decisoes tomadas sob aquele nome estao na
auditoria. O UPDATE e' condicionado (`IS DISTINCT FROM`) e a auditoria so' e' gravada quando algo
mudou — repetir a acao nao infla `app.auditoria_eventos`.

**Decisao 4 — a rota antiga foi APAGADA, nao redirecionada** (escolha do operador). Diff menor e
nenhum codigo morto; o custo aceito e' que link salvo para `/dashboard/equipes-comerciais` passa a
dar 404. Guarda em `lib/navegacao.test.js` falha se o item voltar ao menu.

**Decisao 5 — a area continua NAO sendo placar.** As contagens medem coisas diferentes e nao se
somam num total: `metricasDaEquipe` soma a MESMA metrica entre pessoas (o total de leads da
equipe) e jamais metricas diferentes entre si. A guarda anti-placar de `lib/equipe-painel.js`
**nao foi tocada**, e o modulo novo ganhou a sua: nada de `score`, `produtividade`, `media(`,
`percentual`, `posicao` ou `medalha`, e **ninguem e' ordenado por faturamento** — a ordem das
pessoas continua sendo a carga de trabalho, que e' o que o gestor veio redistribuir. A palavra
`ranking` e' permitida no fonte porque e' o NOME do payload de `/comissao/ranking`, um endpoint
que ja existia e mede faturamento PAGO originado (resultado verificavel, nao esforco).

**Decisao 6 — `membros_ocultos` e' declarado, nao escondido.** `total_membros` vem do banco e
conta todo vinculo com `saiu_em IS NULL`; `/elegiveis` so devolve quem tem vinculo ATIVO. Quem foi
desativado continua na equipe e some da tabela. Sem esse numero a tela diria "4 membros" e
mostraria 3, e ninguem saberia por que.

**Validacao:** `npm test` no backend (2258/2260 — as 2 falhas sao os flaky conhecidos de
`core.test.js`, que fazem chamada REAL ao provedor de IA e tomam 429, sem relacao com esta
mudanca), `npx tsc --noEmit` limpo e `node --test lib/*.test.js` (663) no frontend.


## 2026-09-20 — Reorganizacao do Banco de Leads (2ª rodada) e o que a tela NAO pode prometer

Pedido do operador: JSON de especificacao + 6 telas conceito para reconstruir o conteudo
principal do Banco de Leads. Tres decisoes foram tomadas NO CHAT, antes de qualquer codigo,
porque as referencias visuais descreviam comportamento que o produto nao tem.

**Decisao 1 — reorganizacao DENTRO da arquitetura atual, nao quebra em ~20 componentes.** A
`suggested_component_architecture` do JSON (LeadBankHeader, LeadMetrics, DeliveryModeSelector…
cada um em arquivo proprio) foi **recusada pelo operador** em favor do padrao que o repositorio
ja usa nesta tela: pagina grande + subcomponentes locais + modulos PUROS em `lib/`. Razao
declarada: a mesma tela foi repaginada em **2026-09-19 (commit `723a3af`)** e **ainda nao foi
vista rodando** — uma segunda reescrita ampla por cima de trabalho nao verificado troca risco
por arrumacao de arquivo. O proprio JSON marcava aquela lista como referencia, nao requisito.

**Decisao 2 — "Limpar leads" MANTEVE a regra atual; so a UI mudou.** O modal-conceito descrevia
**exclusao em massa real** (leads filtrados / selecionados / todos, com "digite LIMPAR"). O
backend de hoje (`POST /limpar`) apaga **apenas os leads sem e-mail E sem telefone**, preservando
negocio fechado. Construir o conceito exigiria uma rota de exclusao em massa NOVA, contra o
padrao do produto inteiro (Roteiros arquiva, Membros desativa, Missao/Venda nao apagam). O que
mudou foi o que estava errado de verdade: o `window.confirm` — **proibido pelo `AGENTS.md`** —
virou `ModalConfirmar` com tom `perigo`. O texto vive em `LIMPEZA`, no modulo puro, com guarda de
regressao que **falha se a tela passar a dizer "todos os leads", "leads filtrados" ou "leads
selecionados"**: a frase e' o que impede a interface de prometer o que o backend nao executa.

**Decisao 3 — "Exportar CSV" ganhou COLUNAS e nome de arquivo; nao ganhou escopo por selecao.**
As quatro opcoes do conceito (selecionados / filtrados / pagina atual / todos) exigiriam o
endpoint aceitar lista de ids, que ele nao aceita. O escopo continua sendo o **conjunto
FILTRADO**, e agora a tela **declara isso em texto** dentro do modal, com o numero de leads.
Para a escolha de colunas nao ser decorativa, o backend recebeu **um parametro OPCIONAL e
ADITIVO** (`?colunas=`) sobre a MESMA rota, a MESMA capacidade e o MESMO `WHERE`: sem ele, o
arquivo sai exatamente como sempre saiu. O campo SQL vem de um catalogo FECHADO
(`services/banco-leads-export.js`), nunca da requisicao — ha guarda que falha se
`SELECT ${req.query…}` aparecer, e outra que falha se o `WHERE` deixar de ser o da listagem.

**Decisao 4 — "Visao por status" e "Mapa" NAO foram implementadas.** As abas aparecem na tela
conceito e nao tem fonte: nenhuma rota devolve lead agrupado por status para essa visao, e nao ha
coordenada para mapa. E' a propria regra do JSON ("so implementar visualizacao alternativa se ja
existir suporte") e a mesma disciplina de "Reunioes por pessoa" de 2026-09-19: metrica sem fonte
real nao entra.

**Decisao 5 — permissao continua sendo CAPACIDADE, nao "dono".** O conceito marca Exportar e
Limpar com um selo "Somente Dono". O produto nao tem esse conceito: quem autoriza e'
`lead_ver_brutos` (exportar) e `lead_disparar_lote` (limpar), resolvidas pelo backend e ja
aplicadas nas rotas. `itensMaisAcoes` apenas TRADUZ esses vereditos, e quem nao tem nenhuma das
duas **nao recebe o menu** — a regra do guia para controle sem decisao de produto a explicar.

**O que mudou de aparencia** (e por que): o cabecalho passou a ter **uma** acao primaria, com
Exportar/Limpar recolhidas em "Mais acoes" (as tres soltas davam o mesmo peso a cadastrar,
exportar e APAGAR); as pilulas do funil viraram **cartoes** com contagem e participacao, e
continuam sendo o seletor de aba (`aria-pressed` + "Em exibicao" em texto — cor nunca e' o unico
sinal); o `<select>` de modo de disparo virou **tres cartoes** em `radiogroup` (a escolha muda
quem envia, quando e com que aprovacao, e a lista fechada escondia as outras duas); e
"Personalizar" saiu da barra de filtros para uma **barra da lista**, junto de "Ordenar por" —
recorte da CARTEIRA e aparencia da TABELA sao decisoes diferentes.

**Validacao:** backend `npm test` **2270/2272** (as 2 falhas sao os flaky conhecidos de
`core.test.js`, que fazem chamada REAL ao provedor e tomam 429 — confirmadas identicas em
`master` limpo, 2258/2260); frontend `npx tsc --noEmit` limpo, `node --test lib/*.test.js` 679 e
`npm run build` OK. **Verificacao visual ao vivo NAO foi feita** (exige backend + banco + login;
o dev server sobe e a pagina compila, mas a area logada nao abre sem sessao) — a mesma pendencia
declarada na repaginacao de 2026-09-19.

---

## 2026-09-21 — Distribuicao automatica e balanceada de leads por EQUIPE

**Contexto:** o operador pediu um modelo HIBRIDO: rebalanceamento automatico da carteira quando
alguem entra numa equipe, visao da carteira por pessoa dentro da area de Equipe, e uma acao
manual ("Puxar mais leads") para o gestor aumentar volume. As quatro decisoes abaixo foram
levadas ao chat ANTES de qualquer linha de codigo, com os conflitos a vista, e aprovadas.

**O achado que enquadrou o pedido: NENHUMA MIGRATION E NECESSARIA.** Tudo ja existia —
`prospects.responsavel_id`/`responsavel_desde`/`nicho_id`/`qualificacao`/`status`/`bloqueado_ate`
(migrations 071/072/087), `app.lead_responsavel_historico` com a CHECK de acao ja cobrindo
`atribuiu`/`transferiu`, e `app.auditoria_eventos` com `contexto` JSONB livre. O que faltava era
a REGRA de quando mover, nao lugar para guardar.

**Decisao 1 — o rebalanceamento PODE tirar lead de quem esta acima da meta, mas SO' intocado.**
E' a unica escrita do produto que tira trabalho da mao de alguem sem essa pessoa pedir, e ela
contraria a disciplina que `services/lead-parado.js` declara no cabecalho ("o sistema MARCA, nao
devolve"). A diferenca que a torna aceitavel: la' o lead ja tem trabalho comecado; aqui ninguem
encostou nele. Sem isso, "balanceado" nao significaria nada — pessoa nova entrando numa equipe
onde tudo ja esta distribuido ficaria com carteira zerada. A guarda de `lead-parado.js` NAO foi
tocada.

**Decisao 2 — dois gatilhos, e NENHUM worker.** Entrada de gente na equipe (na mesma transacao
que grava o participante) e o botao do gestor. A terceira opcao do pedido ("quando leads novos
forem liberados, se houver politica ativa") exigiria um job que muda dono de lead sozinho e uma
politica que nao existe no banco — foi recusada. Ha guarda de regressao que varre
`src/services/*worker*|*auto*|*scheduler*` e falha se algum importar o modulo.

**Decisao 3 — a carteira da tela e recortada pelo NICHO da equipe, e a tela declara isso.**
`GET /equipe` (`contagemPorResponsavel`) conta a carteira da pessoa na EMPRESA INTEIRA, sem
filtro de nicho — e continua contando. Sao dois numeros verdadeiros com o mesmo nome na mesma
tela, entao cada coluna carrega `oQueMede`, pelo mesmo motivo da `BolinhaPontuacao`. A alternativa
(duas colunas, "no nicho" e "total") foi recusada por exigir que a pessoa leia o rotulo para nao
confundir.

**Decisao 4 — "Com reuniao" entra como recorte da CARTEIRA, e a guarda foi ATUALIZADA, nao
contornada.** `lib/equipe-area.test.js` proibia a palavra `reunio` com a justificativa "nenhuma
metrica de reuniao tem fonte real hoje". Isso continua verdade para "quantas reunioes a pessoa
conduziu" (`agenda_eventos.responsavel_id` existe desde a 076 e NUNCA teve backfill: viria quase
tudo zero) e continua proibido la'. "Quantos leads desta pessoa tem reuniao marcada" tem fonte
real — a mesma subconsulta por telefone do Banco de Leads, que a distribuicao calcula de qualquer
forma para PROTEGER o lead —, e vive em `lib/equipe-carteira.js` com o rotulo declarando a
diferenca. Rotear em volta da guarda em silencio teria sido o caminho errado.

**Decisao 5 — na duvida, PROTEGIDO.** Os dois erros possiveis nao custam a mesma coisa: nao mover
um lead intocado deixa a carteira um pouco desigual (visivel e corrigivel com um clique); mover um
lead com reuniao marcada deixa um cliente falando com uma pessoa e um compromisso na agenda de
outra. Por isso `sqlConversaAberta` protege QUALQUER conversa nao arquivada, e nao so' "atendimento
humano": distinguir exigiria ler `responsavel_id`/`operador_assumiu_em`/`agente_pausado`, tres
sinais que mudam por conta propria durante o atendimento.

**Decisao 6 — o predicado e MAIS ESTRITO que o de "lead parado", de proposito.** Ele reusa
`LP.sqlUltimaAcao` (dono unico das tres fontes de acao) e ACRESCENTA follow-up casado por
TELEFONE, porque `app.follow_ups.prospect_id` e' nullable (migration 062). Para MARCAR um lead
como parado, nao ver aquele follow-up custa um rotulo errado; para MOVER o lead de dono, custa
tira-lo da mao de quem combinou o retorno com o cliente.

**Decisao 7 — `LEAD_TRANSFERIR` por ROTA, nao o mount.** `/equipes-comerciais` e' montado com
`MEMBROS_GERENCIAR`. Mexer em quem e' dono de lead e' outra decisao que administrar contas, e
`LEAD_TRANSFERIR` e' exatamente a capacidade que o papel `comercial` nao tem. Sem o gate por rota,
quem administra contas passaria a redistribuir carteira sem ninguem ter decidido isso.

**Decisao 8 — o historico e' gravado pelo DONO da tabela, em lote.** `registrarMudancasEmLote`
nasceu em `db/lead-responsavel.js` (nao no modulo de distribuicao) porque
`app.lead_responsavel_historico` tem um dono so'. Em lote (duas instrucoes) porque a operacao roda
dentro da transacao que adiciona o participante — mil idas ao banco a segurariam aberta. Uma linha
por LEAD, mais UMA linha agregada por operacao em `app.auditoria_eventos`.

**Decisao 9 — `sqlTelefoneNormalizado` ganhou um dono (`src/telefone-br.js`).** A expressao era
identica, caractere a caractere, em `routes/api-banco-leads.js` (`normFone`) e `db/follow-ups.js`
(`telefoneCanonicoSql`). MOVIDA, nao duplicada — mesmo precedente de `candidatosTelefoneBR`. Uma
terceira copia faria a distribuicao proteger o lead errado enquanto a listagem continuaria certa.

**Decisao 10 — o criterio "Sem contato" NAO e' "nunca abordado".** No universo redistribuivel todo
lead e' intocado por construcao, entao esse criterio seria um controle que nao muda nada — um
controle que mente. Ele virou a faixa `falta_contato` de `lead-fila-trabalho.js` (sem telefone nem
e-mail, trabalho de completar cadastro), e a tela rotula exatamente isso. Ha teste cobrando que os
tres criterios produzam ordens DIFERENTES.

**Consequencia declarada e aceita:** um lead intocado pode mudar de responsavel sem a pessoa
pedir, e ela so' descobre pela carteira. O rastro existe (historico por lead + auditoria agregada),
e o motivo gravado e' vocabulario fechado (`rebalanceamento_automatico_equipe`), justamente para
"por que este lead saiu de mim?" ter resposta.

**Fora de escopo, declarado:** devolucao de leads na REMOCAO de participante (segue recusada com
409 `REMOCAO_EXIGE_DEVOLUCAO`), rebalanceamento sob demanda sem entrada de gente, worker de
distribuicao ao aprovar lead novo, e qualquer mudanca em envio de WhatsApp, follow-up, agenda ou
coleta paga.

**Nenhuma migration, nenhuma variavel de ambiente, nenhuma capacidade nova.** Codigo:
`src/services/lead-distribuicao.js` (PURO), `src/db/lead-distribuicao.js`,
`src/db/equipes-comerciais.js`, `src/db/lead-responsavel.js`, `src/routes/api-equipes-comerciais.js`,
`src/telefone-br.js`; front `frontend/lib/equipe-carteira.js` (+ `.d.ts`/`.test.js`),
`components/ModalPuxarLeads.tsx`, `app/dashboard/equipe/page.tsx`. Testes:
`test/lead-distribuicao.test.js` (28, sendo 8 guardas que leem o fonte) e
`frontend/lib/equipe-carteira.test.js` (25).


## 2026-09-20 (2) — Repaginação de LeadDetalhesModal e ConversaHistoricoModal

Continuação da reorganização do Banco de Leads, a pedido do operador: "estrutura melhor
parecida com o que você fez" aplicada nas duas telas que abrem de lá — a ficha do lead
(ICP, `components/LeadDetalhesModal.tsx`) e a conversa (`components/ConversaHistoricoModal.tsx`,
aberta ao clicar no nome). Sem fotos de referência desta vez; escopo confirmado em texto pelo
operador ("Nos modais").

**Zero mudança de regra de negócio.** Nenhum endpoint, payload, validação ou efeito colateral
foi tocado — nem o autosave do ICP (debounce, `finalizarIcpRef` no unmount), nem o envio dos
sub-modais de reunião/ligação/descarte. A mudança é inteiramente de apresentação.

**Migração mecânica para os tokens do guia visual** (`slate-*`/`white` → `surface`/`line`/
`ink*`) nos dois arquivos — mapeamento por correspondência EXATA de hex (`900→ink`, `600→ink-2`,
`500→ink-3`, `200→line`, `300→line-strong`, `50→surface-2`, `white→surface`), então "não muda
um pixel" como o próprio guia garante. `slate-800`/`700`/`400`/`950`, que não têm correspondência
exata, foram dobrados no vizinho mais próximo (`800/700→ink-2` ou `ink`, `400→ink-3`) — a única
mudança real é texto muito claro (`slate-400`) ficando um tom mais escuro, o que soma para
legibilidade em vez de tirar.

**Botões escritos à mão viraram o componente `Botao`** nos pontos de ação clara (cabeçalhos,
rodapés, Enviar/Gerar, os três sub-modais de status) — ganham foco visível, `disabled` real e
`carregando` que desabilita contra duplo clique, que os `<button>` originais não tinham de forma
consistente. Os micro-botões de contexto (ações do bloco de Instagram, chips de reação) foram
**deixados como estavam**: são ações pequenas dentro de um fluxo com lógica própria, e
convertê-los não trazia ganho que justificasse o risco de mexer perto daquele código.

**Os 3 sub-modais de ação do `ConversaHistoricoModal` (reunião/ligação/descarte) eram a MESMA
moldura copiada três vezes** (~90 linhas de overlay+cartão+cabeçalho+rodapé repetidas). Viraram
um wrapper único, `PainelAcaoConversa` — extração pura, cada chamador continua com seu próprio
formulário e sua própria função de salvar; nada do que cada um valida ou envia mudou.

**O botão "Concluir" da ficha do lead ganhou rodapé PRESO**, fora da área que rola. Antes ele
vivia solto no fim do corpo — numa ficha com grade de 2-3 colunas, "rolar até o fim" era o
próprio trabalho de avaliar o ICP. A regra já estava documentada no cabeçalho do `FolhaModal`
("a ação primária não pode depender de rolar até o fim"); esta tela só passou a segui-la. O
rodapé também passou a mostrar o texto de autosave ao lado do botão, reaproveitando o estado que
já existia (`autosaveTexto`) — nenhum estado novo foi criado.

**Validação:** `npx tsc --noEmit` limpo, `node --test lib/*.test.js` (704, nenhum novo teste —
mudança é só de apresentação em componentes `.tsx`, sem módulo `lib/` tocado) e `npm run build`
OK. **Verificação visual ao vivo não foi feita** — mesma pendência das duas rodadas anteriores.

## 2026-09-22 — Banco de Leads: uma lista, com a origem como dado da linha (Etapa 1 da repaginação)

**Contexto.** Pedido de repaginação da área de trabalho, com o menu lateral PRESERVADO. Estudo
documental em `docs/propostas/2026-09-22-repaginacao/`, revalidado contra o código antes de
qualquer edição.

**O defeito principal não era estético.** `banco-leads/page.tsx` dividia a carteira com
`ORIGENS_PLACES.has(l.origem)` e mandava **todo o resto** para uma tabela de título fixo
"Instagram". Lead de anúncio (`origem='meta_ads'`, migration 091) era apresentado ao operador
como lead de Instagram. Em paralelo, `ORIGENS_VALIDAS` (`api-banco-leads.js:83`) não conhecia
`meta_ads`: o filtro `?origem=meta_ads` não casava com nada e era **ignorado em silêncio**,
devolvendo a carteira inteira como se o filtro não existisse.

**Decisão 1 — o vocabulário de origem ganhou DONO, nos dois lados.**
`backend/src/services/lead-origem.js` (PURO) é a fonte única: `ORIGENS` espelha a CHECK
`prospects_origem_chk` e há teste anti-drift que lê a migration 091 e falha se as duas
divergirem. A rota deixou de guardar `ORIGENS_VALIDAS` e `ORIGENS_PLACES` (guarda de regressão
lê o fonte). `frontend/lib/lead-origem.js` só TRADUZ — mesmo contrato de `lib/site-rotulos.js`.
**Alternativa descartada:** acrescentar `'meta_ads'` ao `Set` existente. Resolveria o sintoma e
deixaria a lista em quatro lugares que não se conhecem — foi exatamente isso que produziu o bug.

**Decisão 2 — ausência de filtro é `null`, nunca lista vazia.** `origensDoFiltro` devolve `null`
para valor desconhecido, e o `WHERE` simplesmente não recebe a cláusula. Uma lista vazia viraria
`origem = ANY('{}')`, que não casa com lead nenhum: um valor errado na URL esvaziaria a carteira
em vez de ser ignorado.

**Decisão 3 — origem desconhecida aparece COMO ELA MESMA.** Nunca escondida e nunca trocada por
outra fonte (mesma disciplina de `lib/capacidades.js` com capacidade desconhecida). Foi o `else`
silencioso que produziu o defeito; trocar de `else` só mudaria a fonte errada.

**Decisão 4 — `linkedin` é ROTULADO mas não tem opção no seletor.** O motor existe e nenhuma
coleta o usa; um filtro que devolve zero sempre treina o operador a desconfiar do filtro. Se um
lead `linkedin` aparecer, a coluna Origem o nomeia corretamente.

**Decisão 5 — a régua de cadastro do lead de anúncio NÃO foi alterada.** `meta_ads` continua
pontuando pela régua de Instagram (0–60), como já fazia. Mudar isso é criar uma terceira régua —
decisão de produto própria, e trocá-la dentro de um diff de apresentação alteraria a ordenação
da carteira sem ninguém pedir. **Dívida declarada.** A bolinha já exibe o máximo (`30/60` ×
`50/100`), então as duas réguas continuam distinguíveis na mesma lista.

**Decisão 6 — a paginação e a ordenação viraram uma só.** Já eram uma só no servidor: `GET
/leads` ordena pela fila de trabalho e devolve `meta.total_carteira`. Duas paginações no cliente
partiam essa fila ao meio, e o 1º lead de cada metade disputava o topo sem nada dizer qual era o
mais urgente. **Nenhuma rota mudou** — a unificação é de apresentação.

**Decisão 7 — o escopo da seleção passou a ser DITO.** "Selecionar todos os filtrados"
selecionava o conjunto **carregado** (janela de 300 sobre carteira maior). O texto agora vem de
`escopoDaSelecao` (puro, testado), que declara a diferença quando ela existe e tem guarda de
regressão contra as frases "todos os resultados" / "toda a carteira" / "todos os filtrados".

**Decisão 8 — o painel de disparo foi RECOLHIDO, não simplificado.** Os três cartões de modo
continuam sendo `radiogroup` com a descrição de cada modo — a decisão de 2026-09 de não voltar
ao `<select>` segue valendo. O que mudou é que a CONFIGURAÇÃO nasce fechada e o ESTADO fica numa
faixa de uma linha. O motivo de um bloqueio nunca entra no que se recolhe (`faixaDeEnvio`, puro,
com teste de que todo estado tem rótulo em texto).

**O que NÃO foi tocado, de propósito:** `services/rodar-leads.js` (tem a sua própria cópia de
`ORIGENS_PLACES`, no caminho de disparo em produção — o drift é impedido por teste, não por
refatoração), regra de envio, teto, cooldown, capacidades, recorte por responsável/equipe e
qualquer rota.

**Validação:** `npx tsc --noEmit` limpo, `node --test lib/*.test.js` 747/747, `npx next build` OK,
e no backend `node --test` nas 5 suítes afetadas (85/85). ⚠️ **Verificação visual ao vivo não foi
feita** — sem navegador na sessão, e subir o backend local apontaria para o banco de produção.

## 2026-09-22 — Ficha do lead: uma superfície com quatro seções (Etapa 2 da repaginação)

**O defeito.** Eram DOIS modais para o MESMO lead, abertos por gatilhos diferentes da MESMA
linha: `ConversaHistoricoModal` (conversa, status, registro de reunião/ligação/descarte) e
`LeadDetalhesModal` (ICP, cadastro, evidências). Cada um repetia o resumo do lead no topo, e
quem estava na conversa e precisava do ICP fechava um para abrir o outro — perdendo o que estava
lendo e a posição na lista.

**Decisão 1 — NADA foi reimplementado.** Os dois componentes continuam donos do que fazem e
viraram o conteúdo de duas seções, por uma prop `variante="embutido"` que só tira a moldura.
`FichaLead.tsx` é a moldura e o vocabulário; ele não sabe enviar mensagem nem marcar ICP.
Reescrever a conversa dentro da ficha seria a duplicação que `ConversaPainel` já proíbe na
Central de Mensagens.

**Decisão 2 — as seções NÃO DESMONTAM ao trocar de aba, e isto não é otimização.**
`LeadDetalhesModal` submete o veredito FINAL do ICP (`finalizar: true`) na limpeza do efeito de
saída — é assim que Lead A atravessa a porta da triagem. Desmontá-lo a cada clique numa aba
mandaria um `finalizar` **por clique**. As duas seções pesadas ficam montadas enquanto a ficha
está aberta e apenas mudam de visibilidade, pelo mesmo motivo que `RotinasAquisicao` fica sempre
montado ao alternar Busca/Rotinas. **O autosave, a proteção contra resposta atrasada
(`autosaveSeqRef`) e o envio de saída não foram tocados.**

**Decisão 3 — `LeadDetalhesModal` continua servindo a Aquisição sem mudar.** `variante` e `secao`
têm default (`'modal'`, `'tudo'`), então `ProspeccaoPainel` renderiza exatamente o que
renderizava. A alternativa (extrair um `LeadDetalhesConteudo` novo) obrigaria a hoistar o estado
do autosave para fora do componente que o criou — mais diff, no arquivo mais delicado dos dois.

**Decisão 4 — o lead da ficha é VIVO, com fotografia de segurança.** Ele sai de `leads` (para
acompanhar o autosave e a edição de telefone), com fallback para a cópia do instante da abertura.
Sem o fallback, marcar "respondeu" ou "descartado" move o lead para outra aba, ele sai de `leads`
no `carregarLeads` seguinte e **a ficha sumiria da tela logo depois da ação que o operador acabou
de registrar**.

**Decisão 5 — clicar no NOME passa a abrir o Resumo.** É mudança de comportamento numa
interação muito frequente, e foi tomada a pedido: o nome é a leitura de decisão, não o atalho da
conversa. O que compensa: a conversa é a 2ª aba, e o **botão de ação da linha** (Enviar /
Responder / Revisar) e a fila do Semiautomático abrem **direto nela** — quem quer falar com o
lead continua a um clique. O mapa gatilho→seção vive em `lib/ficha-lead.js`, não espalhado na
tela.

**Decisão 6 — diálogo aninhado passou a ser anunciado.** `PainelAcaoConversa` e `JsonLeadModal`
não tinham `role="dialog"`. Ganharam, e a ficha usa isso para não fechar no Escape quando há um
formulário aberto dentro dela. Corrige de passagem uma lacuna de acessibilidade que já existia.

**Decisão 7 — o painel lateral usa o PRIMITIVO.** `classesFolha`/`classesFundoFolha` ganharam
`lateral`. Largura fixa (560px): variar com o tamanho da tela faria a ficha cobrir a lista que
ela existe para preservar.

**Validação:** `npx tsc --noEmit` limpo, `node --test lib/*.test.js` 759/759 (12 novos em
`ficha-lead.test.js`), `npx next build` OK. ⚠️ **Verificação visual ao vivo não foi feita.**

## 2026-09-22 — Quadro do Dia (Etapa 3 da repaginação, migration 095)

**Aprovação.** O operador aprovou a migration 095 como proposta, e a regra de conclusão
"exigir evidência, com saída honesta" (AskUserQuestion de 2026-09-22).

**Decisão 1 — tabela própria, não `app.follow_ups`.** Aquela tabela é compromisso com um
CONTATO e alimenta a fila oficial de toda a equipe. O planejamento pessoal do dia ali dentro
encheria a fila dos outros e exigiria um valor de `canal` que nenhuma tela executa — a Decisão 4
de 2026-08-12. Descartado também JSONB em `usuarios_empresas`: sem unicidade (dois arrastes
simultâneos se sobrescrevem), sem ordem por item e sem como consultar o que foi fechado ontem.

**Decisão 2 — `etapa` é o estado do DIA e não escreve no funil.** Nenhuma instrução da camada
de dados sai de `plano_dia_itens`; há guarda de regressão que lê o fonte. Cada coluna carrega a
frase do que o movimento NÃO faz, porque "Feito" ao lado de um CRM é lido como venda fechada.

**Decisão 3 — não existe máquina de estados entre colunas.** Proibir "voltar" transformaria um
erro de arraste num estado sem saída. A única transição com consequência é a entrada em `feito`.

**Decisão 4 — "Feito hoje" exige evidência, e a evidência é EMPRESTADA.** O servidor consulta
`LP.sqlUltimaAcao` (`services/lead-parado.js`), dono único de "o que conta como ação". Sem
evidência, 422 + nota → `autodeclarada`, rotulada como tal no card. Duas réguas de "trabalhou o
lead" fariam o Quadro e o painel da equipe discordarem sobre a mesma pessoa.

**Decisão 5 — o plano é pessoal, e isso é enforcement, não preferência.** Nenhuma rota aceita
`usuario_id`; o escopo sai sempre de `req.usuario.id`. Guarda de regressão lê o bloco das rotas.

**Decisão 6 — nenhuma capacidade nova.** Pôr um lead no próprio dia não assume, não transfere e
não dispara. Criar `PLANO_DIA_*` acrescentaria coluna a uma matriz que ninguém valida.

**Decisão 7 — replanejar é ato humano.** Pendência que se move à meia-noite some do dia em que
foi planejada sem ninguém decidir. Guarda varre `src/**` e falha se algo com `setInterval`
importar o módulo. (Mesma disciplina de `lead-parado.js`, que proíbe devolução automática.)

**Decisão 8 — arrastar é atalho, "Mover para" é o caminho.** O arrastar nativo do HTML não
existe em leitor de tela e é ruim em toque. Todo card tem um `<select>` de verdade.

**Decisão 9 — `GET /leads/:id` nasceu por necessidade, não por simetria.** Um lead planejado
ontem pode ter mudado de aba e sair da janela da Lista; sem a rota, o card seria um beco sem
saída ou abriria uma ficha com pontuação parcial. Ela repete o recorte (404, nunca 403) e usa a
MESMA hidratação da listagem.

**Validação:** backend `npm test` **2443/2445** (as 2 falhas são as de IA que fazem chamada real
e tomam 429 — ambientais e pré-existentes, registradas na memória do projeto) e
`npm run typecheck` limpo; frontend `npx tsc --noEmit` limpo, `node --test lib/*.test.js`
**777/777**, `npx next build` OK. ⚠️ **A migration 095 NÃO foi aplicada** (ela roda no boot) e
**nenhuma verificação visual ao vivo foi feita.**

## 2026-09-22 — Leads de Pousada invisíveis para o Time Pousada

**Contexto:** o operador relatou que o time de Pousada "não recebeu os leads dividido certinho".
Diagnóstico somente-leitura em produção mostrou que a distribuição tinha funcionado (131/132 na
mão dos dois membros) e que o problema era de **visibilidade**.

**Decisão 1 — a causa é a PORTA, não a distribuição.** Os 268 leads do nicho estavam em
`qualificacao = 'legado'`. O Banco de Leads aplica `sqlAprovado('')` para quem não tem
`LEAD_VER_BRUTOS` (`__somenteAprovados`, `routes/api-banco-leads.js`), e `sqlAprovado` é ESTRITO —
`legado` não passa. Vínculo `comercial` com `permissoes = {}` ⇒ zero leads na tela apesar de 131
atribuídos. **Nenhum defeito de código novo:** é a consequência declarada da migration 071, e o
caminho de correção (`scripts/aprovar-leads-por-nicho.js`) já existia.

**Decisão 2 — aprovar em lote, com a consequência declarada ao operador ANTES.** A aprovação abre
também o disparo e a fila de ligações para os 268. A escolha foi confirmada no chat antes de
gravar; a simulação (padrão do script) rodou primeiro. **Os 3 descartados não foram tocados** —
reaprová-los desfaria decisão humana.

**Decisão 3 — NÃO forçar a distribuição dos 5 leads que sobraram livres.** `sqlRedistribuivel` os
protege (4 `follow_up_aberto`, 1 `ja_trabalhado`). A regra "na dúvida, protegido" vale também
quando o resultado é uma carteira com sobra: mover lead de quem combinou retorno com o cliente
custa mais que 5 leads na fila.

**Regra que esta sessão confirma, para a próxima:** quando um operador disser "a equipe não
recebeu os leads", são DUAS perguntas distintas e a ordem importa — (1) os leads têm
`nicho_id` do nicho da equipe? (2) eles estão `qualificacao='aprovado'`? A primeira foi a causa em
2026-09-21 (Energia Solar); **esta foi a segunda**. Atribuição sem aprovação é carteira invisível.

## 2026-09-22 — Aquisição: a fonte virou filtro, não tela (Etapa 4 da repaginação)

**Decisão 1 — corrigir o backend ANTES de unificar a tela.** `normalizarOrigemFiltro` mandava
todo valor desconhecido para `'manual'`: `?origem=instagram` devolvia leads do Google Places, em
silêncio. Uma lista unificada com filtro de origem sobre esse normalizador mentiria a cada
recorte. O normalizador passou a delegar ao dono do vocabulário (`services/lead-origem.js`), e o
`WHERE` virou `origem = ANY($n)`.

**Decisão 2 — dois testes que afirmavam o defeito foram reescritos.**
`test/prospect-filters.test.js` cobrava literalmente "desconhecido cai em manual". Mantê-los
seria preservar o bug por ter teste. O arquivo registra, no lugar, por que a regra mudou.

**Decisão 3 — unificar Resultados é legítimo porque a paginação é do servidor.** Todas as
origens vivem em `prospectador.prospects` e a rota pagina e ordena lá. Se fossem endpoints
diferentes, juntar uma página de cada no navegador produziria um recorte que ninguém consegue
explicar — e o pedido proíbe isso explicitamente.

**Decisão 4 — fonte do formulário ≠ recorte da lista.** Era `fonteBusca === 'meta_ads'` cravado
na consulta; foi isso que produziu três telas. `metaAds` passou a significar "recortou por Meta".

**Decisão 5 — Meta continua sem rotina, e a tela diz isso.** O seletor do modo Rotinas só oferece
Places e Instagram, com a frase que explica onde a Meta fica. Criar uma rotina Meta por analogia
visual prometeria automação que o backend não executa.

**Decisão 6 — Instagram entra por SLOT, não reimplementado.** Campanhas, cotas e sementes têm
endpoints próprios; duplicá-los criaria duas regras de cota sobre a mesma conta paga.

**Decisão 7 — o id do modo de busca continua `busca`.** Renomear para `buscas` só para casar com
o rótulo invalidaria `sessionStorage` e links já compartilhados.

**Decisão 8 — "Google CSE" saiu por estar ERRADO, não por ser técnico.** A descoberta de
Instagram migrou para a busca da Bright Data; a tela nomeava um provedor que o fluxo não usa.

**Validação:** backend `npm test` **2444/2446** (as 2 de sempre, IA com 429) e `npm run typecheck`
limpo; frontend `npx tsc --noEmit` limpo, `node --test lib/*.test.js` **777/777**,
`npx next build` OK. ⚠️ **Verificação visual ao vivo não foi feita.**

## 2026-09-22 — Follow-ups, Minha Operação e a avaliação da Central de Mensagens (Etapa 5)

**Decisão 1 — a instrução longa saiu da varredura, não do produto.** A coluna "Por que agora"
mostrava `motivo` + `orientacao` em toda linha. `motivoDaLinha` recorta a PRIMEIRA FRASE e o
texto inteiro vai para o tooltip (`TextoTruncado`, que só mostra a dica quando há transbordo).
O `curto` é sempre um **prefixo literal** do que o backend mandou — resumir com outras palavras
seria a tela reescrevendo o veredito do servidor.

**Decisão 2 — a falha continua fora do recorte.** `tem_falha` é linha própria e visível.
Bloqueio não se recolhe, e o módulo puro nem conhece `falha_motivo` (há guarda).

**Decisão 3 — "Origem" virou "Origem da tarefa".** Com a coluna Origem (fonte de aquisição)
nascendo no Banco de Leads e na Aquisição nesta mesma rodada, o rótulo antigo passou a nomear
duas coisas diferentes em telas vizinhas.

**Decisão 4 — o plano do dia entra em Minha Operação como bloco PRÓPRIO.** Pô-lo dentro da lista
"precisa da sua ação agora" contaria o mesmo trabalho duas vezes: aquela lista cobra, o plano é
escolha, e os follow-ups da pessoa provavelmente já estão dentro do plano. É o "integrar o
Quadro do Dia sem duplicar retornos".

**Decisão 5 — a contagem do plano é reexportada, não recontada.** Duas contas fariam a home e o
Quadro discordarem sobre o que a pessoa planejou.

**Decisão 6 (a que NÃO foi implementada) — a Central de Mensagens fica como está.** A listagem
tem 9 colunas, e quatro delas são julgamentos sobre o MESMO lead lado a lado (Temperatura,
Interesse, Estágio, Status) — o mesmo padrão que a `BolinhaPontuacao` corrigiu em outras telas,
onde pontuações diferentes na mesma linha sugeriam medir a mesma coisa. **Não reduzi as colunas**
por três razões: (a) o pedido desta área era *preservar* o modelo de atendimento e as permissões;
(b) reduzir coluna de uma tela de atendimento sem verificação visual é exatamente o que a Fase 5
do workflow proíbe; (c) o caminho correto já existe no repositório e é uma **preferência de
colunas** (o "⚙ Personalizar" do Banco de Leads), que é feature própria, não repaginação.
**Fica como decisão aberta para o operador.**

**Validação:** frontend `npx tsc --noEmit` limpo, `node --test lib/*.test.js` **783/783**,
`npx next build` OK. Nenhum arquivo de backend foi tocado nesta etapa.
⚠️ **Verificação visual ao vivo não foi feita.**

## 2026-09-22 — Desativar membro devolve o trabalho dele

**Gatilho:** o operador, ao resolver o resíduo de Energia Solar, declarou: *"Desativei alguns
membros, o aplicativo precisa estar preparado para esse tipo de situação."*

**Decisão 1 — desativar DEVOLVE, e isso REVERTE uma regra declarada.** A Etapa 12 do CRM em equipe
afirmava que desativar "revoga acesso e não redistribui". A medição mostrou o custo: 184 leads
trabalháveis e 7 follow-ups em aberto presos em contas desativadas, invisíveis para toda a equipe
(o recorte do comercial é "meus + livres", e lead de um desativado não é nem um nem outro).
`AGENTS.md` foi corrigido nos dois pontos — a regra antiga está marcada como SUPERADA, não apagada.

**Decisão 2 — devolve para a FILA, nunca redistribui.** Escolher um substituto seria inventar dono,
o mesmo erro que a quarentena de webhook (060) e a instância de envio (Fase 2) removeram. A fila é
estado legítimo em leads (072), conversas (074) e follow-ups (062).

**Decisão 3 — histórico não se mexe.** Só o trabalho PENDENTE volta: follow-up concluído,
cancelado e falhado continua com a autoria de quem o executou. Reescrever o responsável ali apagaria
a autoria de um trabalho que aconteceu de verdade.

**Decisão 4 — `liberarLeadsDoMembro` deixou de filtrar por `qualificacao`.** Era ela que produzia o
resíduo relatado: lead `descartado` ficava grudado para sempre em quem saiu da equipe (43 leads
medidos). Descartado não aparece na tela de ninguém, então o dono errado nunca é visto — e continua
contando na carteira dela.

**Decisão 5 — a reativação NÃO desfaz.** Não há como saber quais itens eram dela sem recriar o
estado de um instante passado, e devolver o lote errado é pior: a carteira pode já ter sido
trabalhada por outra pessoa. Reatribuir é ato humano, e o histórico de cada item diz de quem era.

**Decisão 6 — a ordem é: sai das equipes ANTES de devolver a carteira.** Com o vínculo de equipe
ainda aberto, a pessoa conta como membro ativo e um rebalanceamento concorrente devolveria para ela
exatamente o que se acabou de tirar.

## 2026-09-23 — Qualificação separa oportunidade de site da categoria de URL

**Decisão 1 — `classificacao_url` continua com o vocabulário da migration 056.** `site_construtor`
não virou valor persistido: a coluna tem CHECK fechado e `desconhecido` segue sendo a categoria
segura para link que não prova domínio próprio. O refinamento nasce como `site_oportunidade`,
derivado na leitura por `services/site-classificacao.js`.

**Decisão 2 — verificado vale mais que presumido.** A régua operacional agora pontua o bloco de
site por evidência: sem site confirmado (+14), perfil/diretório (+10), site de construtor (+8),
link duvidoso (+2), domínio próprio ainda pendente (+2) e não identificado (+0). Pontos pendentes
sempre carregam revisão de site, mas essa revisão sozinha mantém o lead em revisão rápida, não em
validação humana obrigatória.

**Decisão 3 — o front só exibe o veredito.** `LeadDetalhesModal` mostra um bloco “Site / presença
digital” com tipo, verificação e pontos, lendo `site_oportunidade` do backend. O fallback de
`frontend/lib/lead-icp.js` existe para snapshots antigos, mas não reimplementa lista de domínios.

**Fora de escopo:** migration para salvar status manual de verificação do site, automação que abre
URLs, e qualquer mudança na distribuição de leads.


## 2026-09-23 — Transferência de leads ENTRE membros + pontos de atenção no topo

**Decisão 1 (operador) — padrão só INTOCADO, com caixa explícita para os em andamento.** A caixa
AMPLIA o conjunto e nunca o prefere: os intocados saem primeiro. Cobre férias/desligamento sem
tornar o uso diário um jeito fácil de tirar negociação da mão de alguém. Só o booleano `true`
liga a caixa.

**Decisão 2 — validação por diagnóstico SOMENTE LEITURA, com os predicados da produção
importados** (`npm run medir:distribuicao-equipes`), em vez de uma cópia do SQL — copiar mediria
uma regra parecida e não provaria nada.

**Decisão 3 — visibilidade decidida no backend e só o booleano sai.** `membrosDaEquipe` não foi
alargada porque alimenta respostas de API e vazaria `permissoes`.

**Defeitos encontrados:** lead com `nicho_id` nulo e lead `pendente` não apareciam de forma útil
na tela; `fora_do_nicho` era ramo morto em `resumoProtegidos` (a consulta já filtra pelo nicho) —
este último registrado, não alterado.

**Incidente de processo:** outra sessão commitou estas mudanças (`20d9345`, `ab0ef19`) e deu push
antes da validação final. A validação foi refeita numa worktree isolada do `HEAD`: backend
3154/3154, typecheck limpo, frontend 824/824.

## 2026-09-24 — Verificação automática de WhatsApp sem envio

**Decisão 1 — a fila é implícita, sem tabela nova.** Leads com telefone e `tem_whatsapp IS NULL`
são a fila de verificação. `true` e `false` continuam sendo o veredito persistido sobre o número;
erro técnico da Evolution não vira veredito e deixa o lead em `NULL` para tentar de novo.

**Decisão 2 — a verificação usa `/chat/whatsappNumbers`, nunca envio.** O worker consulta a
Evolution em lote pequeno e só atualiza quando recebe `exists:true/false`. Não envia mensagem,
não abre `wa.me` e não usa foto de perfil como negativa, porque foto ausente pode ser privacidade.

**Decisão 3 — instância não é inventada.** Se a empresa tem uma única instância ativa, ela é usada;
se tem várias, só a `auto_instancia_id` configurada no Banco de Leads é usada. Sem isso, a checagem
fica pendente, para não escolher um número arbitrário.

**Impacto visual:** o Banco de Leads ganha o filtro `Não verificado` dentro de `Envio (WhatsApp)`
e nos chips rápidos, reutilizando o padrão existente de filtros.

## 2026-09-24 — Primeira abordagem por contrato JSON validado

**Decisão 1 — IA escreve contrato, aplicativo executa regra.** A camada de IA da primeira
abordagem agora deve devolver `abordagem_inicial_v1` em JSON. O app monta os sinais do lead,
calcula o ângulo, valida a mensagem e só então salva/envia o texto. Fila, elegibilidade,
cooldown de 15 minutos, teto diário e compliance continuam na camada do aplicativo.

**Decisão 2 — os sinais são evidência, não probabilidade de venda.** Site, Instagram, avaliações,
cidade, nicho e lacunas de cadastro entram como contexto para gerar interesse. A porta operacional
continua usando `lead-qualificacao` (`sqlAbordavel`/`avaliarAbordagem`) e a prioridade de envio
passa a ordenar `aprovado` antes dos demais abordáveis.

**Decisão 3 — SPIN antes de BANT.** A mensagem fria usa situação real, oportunidade/implicação leve
e uma pergunta de ganho. Budget, autoridade e prazo ficam fora da primeira abordagem, porque nessa
fase geram atrito e não ajudam a obter resposta inicial.

## 2026-09-24 — Catalogo modular de workers

**Decisão 1 — worker novo entra por modulo operacional.** O boot continua chamando apenas
`iniciarWorkers`, mas o catalogo foi dividido em `workers/modules/*` por area do produto:
`atendimento`, `captacao`, `banco-leads` e `freelandoo`. Isso torna visivel o que roda sozinho
sem misturar logica de dominio no registro.

**Decisão 2 — runtime separado do catalogo.** A politica de largada/falha fica em
`workers/runtime.js`; o catalogo e a ordem de inicio ficam em `workers/registry.js`. Assim testes
podem validar a lista sem carregar rotas, pool ou clientes HTTP.

**Decisão 3 — metadados obrigatorios.** Cada worker declara `grupo`, `descricao`, `cadencia` e
`risco`, alem de `essencial` e `iniciar`. O campo `risco` explicita se a rotina envia WhatsApp,
consome credito pago, usa IA ou altera leads.

**Fora de escopo:** formalizar ticks internos do `agent.js`, monitoramento do pool em `db.js` ou
rotinas sob demanda como workers. Esses candidatos ficam planejados no README da pasta.

## 2026-09-24 — Variante auditavel da primeira abordagem: site pronto ou diagnostico

**Decisão 1 — a variante vive no contrato JSON da abordagem, sem migration.** A escolha
`sitePronto` passa a existir em cada oferta do modal de Abordagem IA (oferta geral e secoes por
nicho), dentro de `app.banco_leads_config.instrucoes_ia`. O default continua `true` para preservar
o comportamento anterior, que sempre obrigava a IA a abrir dizendo que havia uma previa/estrutura
de site pronta.

**Decisão 2 — o backend valida os dois caminhos.** Quando `sitePronto=true`, o contrato da IA deve
conter o aviso de site/previa/estrutura pronta; quando `sitePronto=false`, a mensagem e rejeitada
se prometer material pronto e cai para a abordagem consultiva/fallback. A tela so configura; a
honestidade da mensagem fica no servico `abordagem-inicial-contrato`.

**Decisão 3 — auditoria por mensagem, nao por lead.** A variante aplicada (`site_pronto`) e a
`oferta_abordagem` selecionada sao gravadas em `prospeccao_fila_diaria.metadata_json.mensagem_ia`
e no `input_json` de `prospeccao_decisoes_ia`. Isso permite comparar retorno por oferta/variante
sem reescrever o historico do lead quando o operador muda a configuracao depois.

**Impacto analitico:** `prospecting-performance-analytics` passa a rankear `abordagens`, agrupando
oferta + variante (`site pronto` ou `diagnostico`). A tela de Aquisição exibe "Melhor abordagem"
junto dos melhores nicho/cidade/horario.

## 2026-09-24 — Identificacao do remetente e oferta como resultado operacional

**Decisão 1 — identificacao editavel no mesmo contrato.** O JSON de `instrucoes_ia` passa a aceitar
`identificacao`, configurada no modal de Abordagem IA. Ela substitui o fallback generico "sou da
nossa empresa" no prompt e no fallback deterministico. O valor usado tambem fica registrado em
`metadata_json.mensagem_ia.identificacao` e no `input_json` da decisao de IA.

**Decisão 2 — descricao da oferta vira resultado, nao so tema.** O backend resume a oferta
selecionada em resultado pratico: CRM/funil/leads/propostas/WhatsApp viram controle de leads,
acompanhamento do funil e organizacao de propostas/retornos; site/captacao vira captura de
contatos qualificados. Isso orienta a IA e o fallback a vender o ganho operacional da estrutura,
sem reduzir uma oferta de CRM a "presenca digital".

**Sem migration:** segue tudo em `app.banco_leads_config.instrucoes_ia` e no historico JSON da
mensagem gerada.

## 2026-09-24 — Aquisicao internacional com termo separado do nicho da equipe

**Contexto:** a equipe de Energia Solar nao conseguia enxergar leads de outro pais quando a busca
precisava usar termo local/idioma estrangeiro. O recorte da equipe e correto por
`prospectador.prospects.nicho_id`; trocar isso por texto parecido reabriria o problema que o
catalogo estruturado resolveu.

**Decisao 1 — `nicho` continua sendo o canônico da carteira.** Em buscas Maps, `nicho` permanece
o que o lead e e o que casa com `app.nichos`/equipe. O campo opcional `termo` agora e apenas o
texto enviado para a Bright Data, como ja acontecia na Biblioteca de Anuncios da Meta.

**Decisao 2 — lead novo ja tenta gravar `nicho_id`.** `salvarProspect` resolve `nicho_id` no
INSERT usando o nicho canonico do contexto, preservando o texto observado em `prospects.nicho`.
Na recoleta, `COALESCE(prospects.nicho_id, EXCLUDED.nicho_id)` impede mover lead entre equipes em
silencio.

**Decisao 3 — snapshot guarda o canônico; disparo pago usa o termo.** `busca_snapshots.nicho`
continua guardando o nicho que vai orientar a materializacao e a equipe. O trigger do Maps recebe
`termo || nicho`; quando diferentes, `decisao_json` registra `termo_busca` e `nicho_canonico`.

**Sem migration:** o ajuste usa colunas existentes (`nicho`, `nicho_id`, `decisao_json`) e apenas
altera contrato de rota/UI para aceitar `termo` em Maps.

## 2026-09-24 — Automatico do Banco de Leads usa pool de instancias da empresa

**Contexto:** a empresa pode operar com varios numeros WhatsApp e precisa que o Automatico do
Banco de Leads distribua os disparos sem concentrar a carga em uma unica instancia.

**Decisao 1 — sem migration na V1.** O pool usa somente dados existentes: instancias ativas em
`app.empresa_whatsapp_instances`, saudacao em `config_json`, e auditoria/cooldown/teto em
`prospectador.lead_disparos.evolution_instance`.

**Decisao 2 — o intervalo continua global, o descanso e por instancia.** A rotina ainda dispara
no maximo 1 lead por ciclo (`auto_proximo_disparo_em` + janela/intervalo). Em cada ciclo ela
escolhe a instancia ativa com saudacao configurada, abaixo do teto diario e com menor atividade
recente. Com mais numeros, o mesmo intervalo global se espalha e aumenta o descanso real de cada
numero.

**Decisao 3 — perfil comercial nao ganha Automatico.** A primeira entrega fica no perfil com
`LEAD_DISPARAR_LOTE`/dono. Comerciais continuam no alcance ja existente de instancias proprias
para Semiautomatico/manual; aviso formal/termo de ciencia e modo analise ficam para etapa futura.

**Limite consciente:** a V1 nao aumenta lote por quantidade de instancias e nao tenta contornar
politicas de canal. O objetivo e controle operacional, auditoria, opt-out/compliance e reducao de
concentracao de risco.

## 2026-09-24 — Janela local por pais no Automatico do Banco de Leads

**Decisao 1 — a janela e avaliada no lead, nao na empresa inteira.** O Automatico deixa de parar
a empresa quando o horario do app esta fora da janela. Em cada tick, a fila percorre candidatos e
so libera aquele cujo pais/cidade estejam dentro da janela configurada no horario local estimado.

**Decisao 2 — resolucao conservadora sem migration.** `services/lead-timezone.js` resolve um
timezone por pais usando dados ja existentes (`pais`, `cidade`, `endereco`). Paises com varios
fusos usam cidade quando ha sinal conhecido; sem sinal suficiente, caem no fuso padrao do pais.
Pais desconhecido nao envia e vira motivo auditavel.

**Decisao 3 — auditoria no resultado do ciclo.** Quando dispara, o worker inclui `pais`,
`timezone`, `hora_local`, `janela_inicio` e `janela_fim` no log estruturado e no resultado da
rodada. Quando ha candidatos mas todos estao fechados, retorna `fora_janela_local` com contagem
dos motivos.

**Limite consciente:** a rotina continua em 1 lead por ciclo e nao aumenta volume por pool. A
mudanca amplia a flexibilidade internacional sem criar envio fora do turno local do lead.

## 2026-09-24 — Teto do Automatico e contrato de interesse na primeira abordagem

**Decisao 1 — teto diario e do POOL, nao de cada numero.** Com 3 numeros, o baseline operacional
fica em cerca de 40 primeiras abordagens por dia no total da empresa. O limite por instancia e
derivado (`ceil(teto_diario / total_instancias)`) apenas para evitar concentracao; o corte real do
dia acontece quando a soma do pool bate `teto_diario`.

**Decisao 2 — primeira mensagem pede permissao/interesse.** O contrato JSON da abordagem inicial
rejeita mensagem que nao termine em pergunta direta. O objetivo nao e pedir reuniao na abertura,
mas obter um primeiro sinal: autorizou continuar ou recusou.

**Decisao 3 — geracao e captura ficam separadas.** A decisao de mensagem e o
`metadata_json.mensagem_ia` registram `objetivo_resposta: "capturar_interesse"` e as respostas
esperadas. A resposta real do lead continua no contrato central da conversa:
`sinal_conversa="desinteresse"` encerra; interesse/permissao segue pelo funil normal.

**Documentacao operacional:** ver `docs/banco-leads-automatico-politica.md` para a regra de 3
numeros, prioridade dos melhores leads por recorte e pontos de medicao antes de escalar.

## 2026-09-24 — Abordagem IA sem identificacao padrao e oferta como carro-chefe

**Decisao 1 — sem identificacao programatica.** O aplicativo nao injeta mais "Sou da nossa
empresa" nem uma identificacao padrao no inicio da primeira mensagem. Se o operador preencher
"Como se identificar", esse texto vai para o prompt como orientacao de interpretacao da IA e fica
auditado em JSON; o fallback deterministico tambem nao encaixa a frase no comeco.

**Decisao 2 — oferta vazia e ausencia real de oferta.** Quando nao ha oferta cadastrada no modal
de Abordagem IA, o backend passa `oferta_abordagem=null` e `site_pronto=false`; a IA recebe a
instrucao de nao assumir qual e o carro-chefe. No modo Automatico com IA, a tela exige pelo menos
uma oferta ativa antes de salvar a abordagem.

**Decisao 3 — `sitePronto` virou compatibilidade tecnica.** O campo salvo continua com esse nome
para evitar migration, mas a semantica operacional e "oferta/estrutura pronta". A IA so pode dizer
"site pronto" quando a oferta selecionada for de site; para CRM/sistema/estrutura comercial, deve
falar da oferta pronta/disponivel correspondente.

**Decisao 4 — oferta especifica por nicho isola a oferta geral.** Quando uma oferta especifica
casa com o nicho do lead, o prompt expõe somente aquela oferta como carro-chefe selecionado. A
oferta geral nao entra como contexto de oferta para evitar mistura de proposta.
