# Registro de decisões técnicas da IA

Registro das decisões técnicas e arquiteturais relevantes tomadas ao longo do projeto
(Fase 8 do [workflow padrão](ai-workflow.md)). Objetivo: evitar que decisões fiquem só no
chat e se percam, e que a próxima IA redescubra tudo do zero. Entradas em ordem
cronológica inversa (mais recente no topo).

> Registre aqui: nova tabela/campo/migration, novo módulo, nova dependência, mudança de
> arquitetura de pastas/rotas/services/APIs, refatoração grande, mudança em
> financeiro/assinatura/dashboard/permissão/integração, ou criação de um novo padrão visual.

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
