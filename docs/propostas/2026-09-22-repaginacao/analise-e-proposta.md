# Proposta de reorganização da operação comercial

Data: 22/09/2026. Estado: estudo para revisão, sem implementação no produto.
Base de código inspecionada: `master`, commit `ae15d5b`. Capturas e validação visual são registradas separadamente em `capturas/manifesto.md`.

**Restrição confirmada pelo usuário durante a análise:** preservar exatamente o menu lateral atual. Somente a área de trabalho será repaginada. As laterais desenhadas nos rascunhos de IA não são propostas de alteração e devem ser ignoradas. A seção de navegação abaixo descreve finalidade/acesso das telas existentes, não renomeação ou reorganização da Sidebar.

## Quadro do dia — complemento solicitado

Dentro do Banco de Leads, alternar **Lista | Quadro do dia**, sem item novo no menu lateral. A Lista continua sendo a carteira. O Quadro mostra apenas os leads planejados para a data e o usuário selecionados, sob o mesmo escopo permitido da carteira.

| Coluna | O que significa | Efeito da movimentação |
|---|---|---|
| Para hoje | Lead que a pessoa escolheu trabalhar nessa data | Apenas planejamento; não assume lead de outra pessoa |
| Em trabalho | A pessoa iniciou a próxima ação | Apenas organização; não envia, não liga, não altera ICP |
| Aguardando retorno | A ação aconteceu e há algo a acompanhar | Pedir registro da ação e data do próximo retorno; reaproveitar Follow-ups oficial |
| Feito hoje | Objetivo diário desse lead foi tratado | Exigir atividade registrada; não significa venda fechada nem descartar o lead |

**Planejar meu dia** abre seleção compacta da carteira aprovada e permitida. Os vencidos/retornos de hoje podem ser sugeridos pelo backend, com origem e motivo explícitos. Não despejar toda a carteira no quadro. Atribuição, nicho/equipe, janela de trabalho e capacidades continuam sendo verificações do servidor.

Cards: nome, origem, objetivo/próxima ação, horário quando existir. Responsável é redundante no quadro pessoal; aparece na visão de equipe autorizada. A fonte é filtro e selo, não coluna do pipeline. Cada card tem “Mover para” como alternativa acessível ao arrastar.

Arrastar para uma coluna operacional com efeito externo abre a ação correspondente e só muda definitivamente quando ela for confirmada e persistida. Reunião exige o formulário oficial; envio exige revisão e fluxo oficial; negócio fechado exige autorização de fechamento. A coluna “Feito hoje” usa atividade do dia, nunca `status=fechado` como atalho.

O dia seguinte oferece **Replanejar pendências**, com prévia e ação explícita. Não apaga pendência nem move tarefas em massa à meia-noite sem decisão. Um lead continua na carteira quando retirado do plano do dia. Uma transferência de responsável revoga acesso no quadro antigo.

**Persistência proposta, ainda não implementada:** planejamento datado por empresa, usuário e prospect, com ordem e etapa do dia separadas do ciclo comercial. Vincular atividades e follow-up por IDs existentes, com idempotência. Validar se a estrutura atual de tarefas comporta esse planejamento antes de propor migration. Alterar banco/contratos depende de etapa própria de aprovação, não está autorizado pela aprovação de uma imagem.

A demonstração interativa usa somente dados fictícios e estado local; não é uma tela publicada nem altera o CRM.

## Recomendação

Unificar as listagens por finalidade, com a origem identificada em cada lead. Preservar Aquisição, Banco de Leads, Mensagens, Follow-ups e Equipe como contextos distintos. Compartilhar a ficha do lead, os controles de tabela e o vocabulário entre eles.

Aquisição responde **quem encontramos e vale aprovar**. Banco responde **quem vamos trabalhar**. Mensagens responde **quem precisa de conversa**. Follow-ups responde **qual ação vence agora**. Equipe responde **como o gestor distribui e acompanha o trabalho**.

Não há benefício em transformar tudo em uma tabela enorme. Há benefício em parar de reconstruir a mesma identidade, contato e ficha em várias telas.

## Diagnóstico a partir do código

| Superfície | Evidência | Consequência | Proposta |
|---|---|---|---|
| Aquisição | `aquisicao/page.tsx` alterna Places/Meta em `ProspeccaoPainel` e Instagram em `captacao/page.tsx` | Cada fonte organiza busca, resultados e acompanhamento de maneira diferente | Resultados, Buscas e Rotinas como vistas de uma mesma área; fonte como filtro e escolha no formulário |
| Banco de Leads | `banco-leads/page.tsx:1046` separa Places de todas as outras origens; renderiza duas tabelas e duas paginações | A prioridade global se fragmenta e Meta pode acabar sob título Instagram | Uma lista e paginação, com coluna Origem e ordenação do servidor |
| Origem Meta | `meta-ads-leads.js` persiste `origem='meta_ads'`; a lista fechada de filtros do Banco ainda tem manual/automatico/instagram/linkedin | Não basta redesenhar o seletor: filtro e apresentação precisam reconhecer Meta | Tratar origem como contrato explícito; manter fallback rotulado para origens futuras |
| Banco: primeira dobra | Modo de envio, conexão, seleção e explicações precedem os resultados | O operador percorre configuração para chegar ao trabalho | Faixa de status compacta; configuração avançada sob ação contextual |
| Seleção | Há atalhos textuais separados para página e filtrados | Muito espaço permanente para ação eventual | Checkbox no cabeçalho e barra de ações ao selecionar |
| Conversa e ICP | Dois componentes extensos; conversa usa folha de até 90dvh e ICP acrescenta limite de 86dvh no desktop | Altura limitada já existe, mas a densidade precisa de inspeção e reorganização | Ficha lateral no desktop com seções e cabeçalho fixo; ações curtas em diálogo próprio |
| Mensagens | Lista tem lead, telefone, temperatura, interesse, estágio, status, atendente, atualização e ações | Metadados disputam espaço com a necessidade de responder | Explorar lista de conversas + conversa ativa + resumo opcional |
| Follow-ups | A fila já unifica origens e tem próxima ação, prazo, canal e motivo | Bom modelo operacional a preservar; identidade visual ainda diverge | Reusar fila, reduzir ruído e destacar prazo/ação |
| Equipe | Já reúne equipes e pessoas, carteira por nicho e atividade | Nova tela de gestão duplicaria funcionalidades | Consolidar a hierarquia existente; detalhe de carteira sem novos centros de gestão |
| Minha Operação | O dashboard já distingue visão administrativa e visão do participante | Não é necessário criar outro dashboard comercial | Melhorar a entrada existente com prioridades e atalhos pessoais |

Essas observações descrevem o código local. Quando não houver captura, não comprovam a aparência ou versão publicada.

## Navegação proposta

- **Minha Operação**: entrada do Comercial já existente, com próximos passos, reuniões e progresso próprio.
- **Banco de Leads**: carteira operacional; filtro de origem Todas / Google Places / Instagram / Meta.
- **Central de Mensagens**: execução de atendimento; acesso contextual a partir de qualquer lead.
- **Follow-ups**: fila de compromissos; filtros Hoje, Atrasados, Agendados, Concluídos e Falhas, conforme estados da API.
- **Agenda e Central de Ligações**: continuam sendo os locais oficiais de execução.
- **Aquisição**: apenas capacidades autorizadas; Resultados / Buscas / Rotinas. Histórico e falhas junto do acompanhamento de coleta.
- **Equipe**: apenas gestão; equipe selecionada, carteira e atividade das pessoas.

As três abas de fonte deixam de funcionar como três produtos. Continuam existindo formulários distintos: Google Places pede nicho/localidade; Instagram aceita descoberta e perfis-semente; Meta pede termos e filtros suportados. Meta não ganha rotina automática por analogia visual: expor apenas o que o backend suporta.

## Uma lista comum, detalhes específicos

Tabela de Aquisição: seleção · Empresa/perfil · Origem · Nicho/localidade · Contato disponível · Situação da triagem · Ações.

Tabela do Banco: seleção · Lead · Origem · Prioridade de trabalho · Próxima ação/estado · Responsável (gestão) · Ação contextual.

Telefone, site, perfil social e evidência completa ficam na ficha. Uma preferência de colunas permite trazer informação recorrente para a lista sem impor tudo a todos. A coluna Origem usa texto e ícone; não depende apenas da cor.

Ao clicar na origem, abrir **Fontes e evidências**, dentro da mesma ficha:

| Fonte | Conteúdo específico |
|---|---|
| Google Places | Ficha do Maps, avaliações, atividade e data das evidências disponíveis |
| Instagram | Perfil confirmado ou candidato, bio, seguidores, atividade e verificação |
| Meta | Página anunciante, link do anúncio, evidência/data de atividade e correspondências identificadas |

“Origem” é o caminho de entrada. Um Instagram encontrado depois não transforma um lead de Places em lead originado no Instagram. Múltiplas evidências não autorizam fusão automática de cadastros. A chave do prospect e o isolamento por empresa permanecem.

Há uma base comum (`prospectador.prospects`) para a proposta. Instagram usa endpoints e estados próprios: uma lista geral de aquisição precisa de contrato normalizado, contagens e paginação globais. Juntar no navegador uma página de cada endpoint não produz uma lista global correta. Também não se comparam os scores de coleta de fontes diferentes como se fossem a mesma régua.

## Banco compacto

1. Título e ação principal numa linha.
2. Estágios com contagens em abas compactas.
3. Busca, Origem, filtros e ordenação numa barra.
4. Modo e conexão em faixa discreta, com controles de mesma altura (36px no desktop como especificação inicial).
5. Lista imediatamente abaixo; checkbox do cabeçalho seleciona a página e informa o escopo.

Ao selecionar: substituir a barra secundária por **N selecionados**, ação principal, ações secundárias e Limpar. Oferecer “Selecionar todos os resultados” somente quando houver contrato que inclua resultados além dos carregados. Hoje o Banco seleciona o conjunto carregado; o texto não pode prometer toda a base.

Conexão: manter texto **Conectado / Desconectado / Verificando / Indisponível**. Tooltip/popover explica motivo e próximo passo. Foco e toque também o abrem. Uma falha que bloqueia envio não fica escondida apenas em hover. Se o Comercial não puder gerenciar a instância, a orientação é procurar o responsável, sem oferecer um controle administrativo.

Gerar mensagem e enviar mensagem continuam ações diferentes. Mudança visual não ativa automação, não elimina prévia e não remove a confirmação existente de grandes lotes.

## Ficha do lead

No desktop, explorar painel lateral de aproximadamente 520–600px, sem cobrir toda a lista. Em janelas estreitas, folha/tela de detalhe com Voltar e estado preservado. Header fixo com nome, origem, estado e fechar; corpo com uma única rolagem; ação principal sempre alcançável.

Seções: **Resumo · Conversa · Qualificação · Fontes**. Abrir a seção correspondente ao gatilho: nome abre Resumo; ICP abre Qualificação; origem abre Fontes. Manter rota/estado do lead e retorno aos mesmos filtros, seleção e posição.

Resumo: próxima ação, contato, responsável e sinais úteis. Qualificação separa explicitamente **ICP humano**, **completude do cadastro** e **prioridade de trabalho**. Não mostrar score como probabilidade de fechar. Se já existe autosave, preservar Salvando/Salvo/Erro e proteção contra respostas antigas.

Reusar o modelo oficial da conversa; não criar um segundo motor de envio dentro da ficha. Registrar ligação/reunião/retorno continua usando os contratos existentes.

## Gestão e Comercial

| Informação/ação | Gestão autorizada | Comercial padrão |
|---|---|---|
| Base bruta, busca e rotinas | Sim, pela capacidade efetiva | Não |
| Leads aprovados | Recorte permitido da empresa | Recorte permitido por responsável/equipe e regras de assumir |
| ICP | Edição com `lead_triar` | Leitura operacional, sem controles de edição |
| Distribuir/transferir | Conforme capacidade e regras de proteção | Não oferecer gestão da carteira alheia |
| Conversa, ligação, reunião e retorno | Conforme acesso ao recurso | Operação permitida sobre os recursos autorizados |
| Custos, credenciais e parâmetros de coleta | Áreas administrativas autorizadas | Ausentes da experiência operacional |
| Comissão | Gestão com capacidade própria | Apenas a própria; placar só no recorte já autorizado |

A matriz real é `acesso-capacidades.js`, com concessões aditivas. “Comercial” não deve virar um novo `if(role)` espalhado pelas telas. Menus, resposta da API, acesso por ID e mutações precisam respeitar as capacidades efetivas. Esta rodada verifica a direção do contrato, não certifica todas as rotas nem uma sessão real de Comercial.

## Alternativas e ordem recomendada

**A — Compactar as telas atuais:** risco menor; resolve primeira dobra, seleção, rótulos e modais. Mantém fragmentação entre tabelas.

**B — Lista unificada por contexto + ficha compartilhada (recomendada):** melhora leitura e continuidade sem apagar diferenças entre aquisição, atendimento e tarefas. Exige fechar contrato de fontes, paginação e estados antes de implementar.

**C — Uma megatela para tudo:** não recomendada. Mistura coleta paga, aprovação, contato e distribuição; aumenta risco de acesso indevido e confunde ações de entidades diferentes.

Sequência: (1) compactação e correção da apresentação de origens no Banco; (2) ficha/ICP; (3) resultados unificados da Aquisição com contrato validado; (4) alinhamento de Follow-ups e Mensagens; (5) hierarquia de Equipe e Minha Operação. Cada etapa merece revisão visual antes de prosseguir.

## Conferência em produção

Sessão administrativa disponibilizada pelo usuário em `atendimento-views.vercel.app`. A leitura da interface foi feita sem acionar coleta, processamento, envio, distribuição ou edição de lead.

- Banco de Leads em 1366×900: primeira dobra ocupada por cabeçalho, cinco cards, modo, conexão, seleção e filtros; linhas de trabalho abaixo dela. Na largura inicial estreita (~443px), os cards ocupam praticamente toda a primeira tela.
- A tela informa explicitamente uma janela de 300 leads sobre um total maior. A seleção de “todos os filtrados” deve deixar claro que se refere ao conjunto carregado, não a toda a carteira.
- Modal de conversa sem histórico: muito largo para pouco conteúdo. A ficha ICP ocupa quase toda a largura, com resumo repetido, checklist e contexto seguindo verticalmente. Separar situações de “leitura breve” e “trabalho detalhado”.
- Places: formulário de busca permanente ocupa a parte superior; lista começa no limite da primeira dobra. Instagram: dois títulos de nível 1, formulário/campanhas/cotas antes da lista e linguagem técnica “Google CSE”, “worker”, “bola de neve”. Esses rótulos são evidência da UI; não provam qual provedor está sendo chamado no backend.
- Meta: mantém filtros/ordenação genéricos de avaliações/endereço, pouco adequados à evidência de anúncios. A aba Rotinas e histórico também aparecem na sessão Meta; verificar o escopo e suporte real antes de desenhar rotinas por fonte. Não interpretar visibilidade como comprovação de execução Meta automática.
- Follow-ups já mostra a fila na primeira dobra, mas cada linha repete uma instrução longa. Manter motivo curto na tabela e explicação completa na ficha. Não confundir origem da tarefa (humana/IA) com origem de aquisição (Places/Instagram/Meta).
- Não houve login como Comercial: sua separação foi analisada no código e será ilustrada com dados fictícios. Não há certificação visual de permissões de Comercial nesta rodada.

## Referências consultadas

- [Carbon — Data table](https://v10.carbondesignsystem.com/components/data-table/usage/): seleção no cabeçalho, barra contextual de ações em lote e expansão para conteúdo secundário.
- [Nielsen Norman Group — Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/): mostrar primeiro o necessário à tarefa e revelar detalhes na interação.
- [Impeccable](https://github.com/pbakaus/impeccable): referência da skill local de crítica/polimento; aplicada com prioridade ao guia visual do projeto. Nenhum script externo instalado ou executado.

Manter tokens e componentes do guia canônico: branco/cinza claro no trabalho, lateral escura, azul para ação, texto junto dos estados, bordas de 6–8px, tabelas densas. Evitar cards decorativos, gradientes e espaço de landing page dentro da ferramenta.

## Critérios para a futura implementação

- Em 1366×768, busca e primeiras linhas visíveis sem rolar a página; medir nas capturas antes/depois, sem prometer ganho percentual não medido.
- Em 390px, acesso à identidade e ação sem rolagem horizontal interminável; detalhe acessível por toque.
- Navegação por teclado, foco devolvido ao gatilho e Escape para fechar; não abrir modais empilhados para o mesmo lead.
- Ordenação e contagem globais coerentes; falha de fonte diferente de zero resultados.
- Filtros/seleção preservados ou limpos com semântica explícita; ação em lote com escopo conhecido.
- Comercial não recebe informação administrativa por API nem por link direto.
- Nenhuma coleta, envio, pagamento, redistribuição ou automação disparada só por abrir a tela.
- Rodar typecheck e testes pertinentes na implementação; esta entrega é documental/visual.
