'use strict'
// SEED — Campanha comercial + roteiro de cold call para o nicho "nail designer".
//
// Grava CONTEUDO (nao schema): cria o roteiro versionado (app.roteiros /
// app.roteiro_versoes / app.roteiro_etapas), publica a versao 1 e cria a campanha
// (app.campanhas) ja apontando para essa versao. Reusa a camada de dados existente
// (src/db/roteiros.js e src/db/campanhas.js) — nenhum INSERT novo foi escrito aqui,
// para as regras de tenant/imutabilidade continuarem valendo.
//
// O bloco ESTRATEGICO da campanha (publico-alvo, dores, objecoes, sinais de fit,
// analise do nicho) nao tem coluna em app.campanhas. Ele vai para
// app.nichos.criterios_json — campo JSONB livre, documentado na migration 038 como
// "criterios de selecao (regiao, porte, sinais, etc.)" — sob a chave namespaced
// `campanha_nail_designer`. A gravacao e' um MERGE (`criterios_json || $novo`):
// nenhuma chave existente do nicho e' removida ou sobrescrita fora dessa chave.
//
// Seguranca de operacao:
//   - SIMULA por padrao. Sem `--aplicar` nada e' gravado.
//   - IDEMPOTENTE por nome: se ja existir roteiro ou campanha com o mesmo nome na
//     empresa, aborta em vez de duplicar.
//   - Se algum passo posterior falhar, o roteiro recem-criado e' REMOVIDO (o
//     ON DELETE CASCADE leva versoes e etapas junto) — nao fica lixo pela metade.
//   - Nenhuma chamada externa, nenhuma chamada paga, nenhuma chamada de IA.
//
// Uso:
//   node scripts/seed-campanha-nail-designer.js                    # simulacao
//   node scripts/seed-campanha-nail-designer.js --aplicar          # grava
//   node scripts/seed-campanha-nail-designer.js --empresa=<uuid>   # desambigua o tenant
//   node scripts/seed-campanha-nail-designer.js --status=ativa     # campanha ativa (padrao: rascunho)
//   node scripts/seed-campanha-nail-designer.js --termo="<nome>"   # casa outro nome
//
// Sobre a campanha JA criada (nao recriam nada; combinaveis):
//   --vincular-leads   vincula os leads do nicho a campanha (e o que enche a fila da
//                      Central de Ligacoes: sem isso a campanha existe e a fila fica vazia)
//   --ativar           status rascunho -> ativa (a Central seleciona sozinha a campanha ativa)
//
// Sobre o nicho: `prospectador.prospects.nicho` e TEXTO LIVRE e NAO e o catalogo; a
// campanha aponta para `app.nichos` (catalogo, migration 038). Quando o nicho existe nos
// LEADS mas nao no catalogo, o script o PROMOVE automaticamente, com a mesma grafia — sem
// isso a campanha ficaria sem `nicho_id`. Ele so' para quando a escolha e ambigua (leads
// do nicho em mais de uma empresa) ou quando o nicho nao existe em lugar nenhum.

const { pool } = require('../src/db')
const { criarRoteiro, salvarEtapas, publicarVersao } = require('../src/db/roteiros')
const { criarCampanha, adicionarLeads, atualizarCampanha } = require('../src/db/campanhas')
const { criarNicho } = require('../src/db/nichos')

const NICHO_TERMO_PADRAO = 'nail designer'
// Usado so' no DIAGNOSTICO quando o nicho nao e' achado: mostra o que existe de parecido
// no catalogo e nos leads (prospectador.prospects.nicho e TEXTO livre, catalogo separado).
const TERMOS_PARECIDOS = ['%nail%', '%unha%', '%manicure%', '%esmalt%', '%pedicure%']

// --- Conteudo da campanha ------------------------------------------------------------
const CAMPANHA = {
  nome: 'Presenca Digital para Nail Designers — Quem te indica, te encontra',
  oferta: 'venda de sites profissionais',
  objetivo:
    'Transformar ligacao fria em reuniao qualificada de diagnostico de presenca digital com nail designers, ' +
    'manicures, esmalterias e studios de unhas, mostrando o que uma cliente nova encontra (ou nao encontra) ' +
    'quando procura pelo nome delas antes de chamar no WhatsApp.',
  resultado_esperado_da_ligacao:
    'Reuniao de 20 a 30 minutos agendada com dia e horario definidos, confirmada no WhatsApp, em que sera ' +
    'mostrado o que uma cliente nova encontra hoje ao procurar o nome dela e quais informacoes estao faltando ' +
    'no caminho ate o agendamento.',
  cta_principal:
    'Marcar uma conversa curta de diagnostico da presenca digital, com o cenario atual dela na tela — sem ' +
    'apresentacao generica e sem compromisso de contratar nada na reuniao.',
  hipotese_inicial:
    'A maior parte das clientes novas dela chega por indicacao, e antes de chamar no WhatsApp procura o nome ' +
    'dela no Google ou no Instagram. Se nesse momento a pessoa encontra um perfil sem preco, sem endereco claro, ' +
    'sem politica de atraso e sem portfolio organizado — ou nao encontra nada no Google — a indicacao esfria e ' +
    'ela nunca fica sabendo que perdeu essa cliente.',
  publico_alvo:
    'Nail designers autonomas, manicures com clientela propria, esmalterias e studios de unhas com 1 a 6 ' +
    'profissionais, que atendem em espaco proprio, em casa, dentro de salao parceiro ou em domicilio; captam ' +
    'clientes principalmente por indicacao, Instagram e WhatsApp; ja tem agenda com alguma recorrencia ' +
    '(manutencao a cada 15 a 21 dias) e cobram por procedimento.',
  posicionamento:
    'Nao somos agencia de marketing nem gestor de trafego. Somos quem organiza a presenca digital de quem ja ' +
    'tem indicacao chegando, para que essa indicacao nao se perca no caminho entre o "me passa o contato dela" ' +
    'e o WhatsApp.',
  proposta_de_valor:
    'Um site profissional que funciona como a vitrine e o cartao de visita permanente do trabalho dela: ' +
    'portfolio organizado por procedimento, informacoes que a cliente nova sempre pergunta (o que esta incluso, ' +
    'endereco e referencia, formas de pagamento, politica de atraso e desmarcacao, duracao de cada servico), ' +
    'tudo em um link unico que ela manda no WhatsApp ou coloca na bio — e que continua no ar mesmo quando o ' +
    'algoritmo nao entrega o post.',
  tom_de_voz:
    'Consultivo, direto e humano. Fala de gente para gente, com o vocabulario real do segmento (manutencao, ' +
    'alongamento, banho de fibra, esmaltacao em gel, blindagem, spa dos pes). Respeita o tempo dela, pergunta ' +
    'antes de continuar, nao empurra, nao promete resultado e nao usa tom de call center.',
  criterios_qualificacao: [
    'Atende clientes com alguma recorrencia e tem agenda em funcionamento hoje',
    'E ela quem decide sobre a propria divulgacao (autonoma ou dona do studio)',
    'Recebe clientes novas por indicacao com alguma frequencia',
    'Reconhece que responde as mesmas perguntas repetidas no WhatsApp todos os dias',
    'Depende apenas de Instagram e WhatsApp, sem nada proprio no Google',
    'Demonstra intencao de crescer, subir preco ou se posicionar como referencia',
    'Aceita reservar de 20 a 30 minutos para uma conversa de diagnostico',
  ],
  dores_principais: [
    'Cliente nova chega por indicacao, procura o nome dela e nao encontra nada organizado — a indicacao esfria',
    'Responde as mesmas perguntas todo dia no WhatsApp: preco, endereco, quanto tempo demora, se aceita cartao',
    'Portfolio espalhado no feed e nos stories destacados, sem separacao por tipo de trabalho',
    'Instagram vira canal de atendimento e some no meio das mensagens',
    'Concorrencia de preco com quem cobra muito abaixo, sem ter como mostrar a diferenca do proprio trabalho',
    'Buracos na agenda e desmarcacoes de ultima hora',
    'Depender de algoritmo e de postar todo dia para continuar aparecendo',
    'Ser encontrada por quem ja ouviu falar dela, mas nunca por quem procura pelo bairro ou pelo servico',
    'Perfil profissional misturado com vida pessoal, o que enfraquece a percepcao de negocio serio',
  ],
  objecoes_principais: [
    'Ja tenho Instagram, para que serve um site?',
    'Minha cliente nao entra em site, ela chama direto no WhatsApp',
    'Quanto custa? Esta apertado agora',
    'Nao tenho tempo para cuidar de mais uma coisa',
    'Minha agenda ja esta cheia, nao preciso de mais cliente',
    'Ja paguei alguem de marketing e nao deu em nada',
    'Sou pequena, atendo em casa, isso e para salao grande',
    'Nao entendo nada de tecnologia',
    'Vou pensar / preciso falar com minha socia',
  ],
  sinais_de_fit: [
    'Diz que a maior parte das clientes vem por indicacao',
    'Reclama de repetir preco e endereco no WhatsApp o dia inteiro',
    'Ja pensou em ter um site ou ja pesquisou sobre isso',
    'Fala em querer subir preco, mudar de espaco ou se posicionar melhor',
    'Tem trabalho bonito e organizado, mas presenca digital bagunçada',
    'Tem agenda com buracos em dias especificos da semana',
    'Ja perdeu cliente por nao conseguir explicar o que esta incluso no servico',
    'Pergunta espontaneamente como funcionaria ou pede exemplo',
  ],
  sinais_de_baixo_fit: [
    'Esta parando de atender ou mudando de profissao',
    'Trabalha exclusivamente dentro de um salao que controla a divulgacao e a captacao',
    'Atende so amigas e familia, sem intencao de crescer',
    'Nao decide sobre a propria divulgacao',
    'Quer resultado imediato garantido e nao aceita conversa de diagnostico',
    'Procura apenas o preco mais barato possivel, sem interesse no que o site resolve',
  ],
}

const ANALISE = {
  como_consegue_clientes:
    'A base e indicacao boca a boca entre clientes, colegas de salao e vizinhanca. O Instagram funciona como ' +
    'vitrine e prova social. O WhatsApp e onde tudo se fecha: duvida, preco, agendamento, confirmacao e ' +
    'remarcacao. A localizacao pesa muito, porque manutencao e um habito quinzenal. Saloes parceiros e espacos ' +
    'compartilhados trazem fluxo de passagem. A recorrencia e o ativo mais valioso: uma cliente fiel volta a ' +
    'cada 15 a 21 dias por anos. O ponto cego e o intervalo entre a indicacao e a primeira mensagem.',
  dores_provaveis: [
    'Perder cliente indicada entre o "me passa o contato" e a primeira mensagem, sem saber que perdeu',
    'Responder manualmente preco, endereco, duracao e forma de pagamento varias vezes por dia',
    'Nao ter onde mostrar de forma organizada o que esta incluso em cada procedimento',
    'Portfolio bom, mas espalhado e cronologico',
    'Sofrer comparacao direta de preco sem ter como sustentar o proprio valor',
    'Depender de postar constantemente para continuar sendo lembrada',
    'Nao aparecer para quem procura pelo tipo de servico na regiao',
    'Conviver com desmarcacoes sem uma politica clara e visivel',
    'Sentir que o negocio parece informal, o que trava a decisao de subir preco',
  ],
  objecoes_comuns: [
    'Ja tenho Instagram e e por ali que minhas clientes me acham',
    'Minha cliente nao abre site, ela vai direto no WhatsApp',
    'Esta caro para o momento, minha prioridade agora e outra',
    'Nao tenho tempo nem cabeca para cuidar de mais um canal',
    'Minha agenda esta cheia, nao preciso de mais divulgacao agora',
    'Ja contratei marketing antes e nao voltou nada',
    'Isso e coisa para salao grande, eu atendo sozinha',
    'Nao sei mexer nessas coisas, ia ficar parado',
    'Preciso pensar e conversar com minha socia',
  ],
  processo_de_decisao:
    'Decide sozinha e rapido, porque e dona do proprio negocio, mas so depois de confiar na pessoa. A decisao e ' +
    'mais emocional e de identidade profissional do que tecnica: ela compra a ideia de ser vista como ' +
    'referencia, nao a de "ter um site". Precisa ver exemplo concreto do proprio segmento. E muito sensivel a ' +
    'compromisso longo e a mensalidade que nao entende, principalmente se ja foi queimada por agencia ou gestor ' +
    'de trafego. Prefere continuar a conversa no WhatsApp, no ritmo dela.',
  gatilhos_de_confianca: [
    'Demonstrar que conhece a rotina real dela: manutencao quinzenal, cadeira ocupada, cliente que atrasa',
    'Usar o vocabulario certo do segmento em vez de falar "seu estabelecimento"',
    'Mostrar exemplos reais de sites feitos para profissionais de unhas',
    'Nao prometer numero, resultado ou garantia de faturamento',
    'Ser transparente sobre prazo, escopo e quem cuida do que',
    'Respeitar o tempo dela e perguntar antes de seguir falando',
    'Deixar claro que ela nao vai precisar mexer em nada tecnico',
    'Aceitar "nao agora" sem insistir, deixando a porta aberta',
  ],
  motivos_para_ignorar_ligacao: [
    'Esta com cliente na cadeira e com as maos ocupadas',
    'Numero desconhecido, associado a operadora ou cobranca',
    'Ja recebe muitas ligacoes de agencia e gestor de trafego oferecendo a mesma coisa',
    'Abordagem generica que nao mostra conhecimento do trabalho dela',
    'Tom de call center, roteiro decorado e ritmo acelerado',
    'Pedir muito tempo logo no comeco, antes de dizer a que veio',
    'Experiencia anterior ruim com alguem que prometeu resultado e sumiu',
    'Sensacao de que vai ouvir uma proposta de mensalidade longa',
  ],
  insight_de_mercado:
    'O gargalo do nicho nao e falta de indicacao, e a perda silenciosa da indicacao. A cliente nova quase nunca ' +
    'chama no WhatsApp direto: primeiro ela procura o nome no Google ou no Instagram para confirmar que a pessoa ' +
    'existe, e profissional e atende no lugar certo. Se nesse instante ela nao encontra preco, endereco, o que ' +
    'esta incluso e trabalhos organizados, ela adia — e adiar, nesse segmento, significa ir na proxima indicada. ' +
    'Por isso o site nao deve ser vendido como "aparecer mais": ele segura quem ja foi indicada, sustenta o ' +
    'preco cobrado e responde sozinho as perguntas que hoje ocupam o WhatsApp dela durante o atendimento.',
}

const REGRAS_DE_CONDUCAO = [
  'Nao vender o site diretamente na ligacao.',
  'Conduzir como conversa natural, nao como script robotico.',
  'Nunca fazer mais de duas perguntas seguidas sem comentar a resposta da cliente.',
  'Usar hipoteses antes das perguntas sempre que possivel.',
  'Fazer a cliente chegar as proprias conclusoes.',
  'Nao inventar numeros, resultados ou garantias.',
  'Nao utilizar gatilhos manipulativos.',
  'Vender o valor da reuniao, nao apenas o tempo da reuniao.',
  'Adaptar a conversa conforme as respostas da cliente.',
]

// Etapas na ordem do funil. `tipo` usa o enum de app.roteiro_etapas (migration 033 /
// src/domain-enums.js): abertura, permissao, situacao, descoberta, problema, implicacao,
// insight, qualificacao, objecoes, convite_reuniao, proxima_acao.
const ETAPAS = [
  {
    tipo: 'abertura',
    titulo: 'Abertura',
    objetivo: 'Ser reconhecida como pessoa real e nao como call center nos primeiros dez segundos, dizer a que veio com honestidade e sobreviver ao filtro inicial.',
    intencao: 'Quebrar o padrao da ligacao fria. Ela ja espera operadora ou agencia; assumir que a ligacao nao foi pedida reduz a resistencia mais rapido do que qualquer entusiasmo.',
    frase_sugerida: 'Oi, [nome]? Aqui e o [seu nome], da [empresa]. Eu vou ser honesto: voce nao estava esperando minha ligacao. Eu vi seu trabalho de unhas aqui em [cidade/bairro] e liguei por um motivo bem especifico. Voce consegue falar meio minuto ou esta com cliente agora?',
    perguntas: [
      'Voce consegue falar agora ou esta com cliente na cadeira?',
      'E voce mesma quem cuida da divulgacao do seu trabalho?',
      'Qual o melhor horario do seu dia para uma conversa rapida?',
    ],
    sinais_interesse: [
      'Pergunta de onde voce viu o trabalho dela',
      'Ri ou relaxa depois da abertura honesta',
      'Diz "pode falar" sem pressa',
      'Confirma que e ela quem cuida da divulgacao',
    ],
    sinais_resistencia: [
      'Responde monossilabico e com tom de pressa',
      'Barulho de atendimento em andamento ao fundo',
      'Pergunta imediatamente "e venda?"',
      'Diz que nao tem interesse antes de voce terminar',
    ],
    objecoes: [
      ['Estou atendendo agora, nao posso falar', 'Imaginei, desculpa cair bem na hora. Nao vou te tomar tempo agora. Qual dia da semana costuma ser mais tranquilo para voce, terca ou quinta de manha? Eu ligo nesse horario.'],
      ['E venda? Nao tenho interesse', 'E contato comercial, sim, nao vou disfarcar. Mas eu nao ligo para vender nada por telefone. Liguei por uma coisa especifica que vi na sua presenca digital. Me da trinta segundos e, se nao fizer sentido, eu mesmo encerro.'],
      ['Como voce conseguiu meu numero?', 'Seu contato esta publico na sua pagina de perfil profissional na internet, foi de la que eu tirei. Se preferir que eu nao ligue mais, me fala agora que eu removo na hora.'],
    ],
  },
  {
    tipo: 'permissao',
    titulo: 'Permissao',
    objetivo: 'Obter um sim consciente para continuar a conversa, transferindo o controle do tempo para ela.',
    intencao: 'Quem da permissao para de se defender. Pedir explicitamente e prometer um limite curto cria reciprocidade e reduz a sensacao de estar sendo empurrada.',
    frase_sugerida: 'Eu trabalho com presenca digital de profissionais de unhas, e vi uma coisa no seu caso que eu queria te comentar. Sao dois minutos, no maximo. Se no fim disso voce achar que nao e para voce, eu te agradeco e desligo, sem insistir. Posso?',
    perguntas: [
      'Posso te contar em dois minutos o que eu vi?',
      'Se nao fizer sentido para voce, tudo bem eu encerrar na hora?',
      'Prefere que eu fale agora ou te chame no WhatsApp?',
    ],
    sinais_interesse: [
      'Diz "pode falar" ou "fala ai"',
      'Pergunta o que voce viu',
      'Silencia para ouvir, sem interromper',
      'Sugere um canal ou horario melhor em vez de recusar',
    ],
    sinais_resistencia: [
      'Concede a permissao de ma vontade, com tom seco',
      'Pergunta o preco antes de ouvir qualquer coisa',
      'Interrompe dizendo que ja tem tudo resolvido',
    ],
    objecoes: [
      ['Fala logo o que voce quer vender', 'Justo. Eu ajudo nail designer a organizar o que a cliente nova ve antes de chamar no WhatsApp. Foi isso que me chamou atencao no seu caso.'],
      ['Quanto custa?', 'Eu te falo, sem enrolacao. Mas te dar um numero agora sem entender como voce atende seria chute, e eu ia acabar te falando um valor errado. Me deixa entender duas coisas antes?'],
      ['Manda no WhatsApp que eu vejo depois', 'Eu mando, sim. So que se eu mandar uma mensagem generica ela vai se perder no meio das suas clientes. Me da um minuto aqui e eu mando ja direcionado para o seu caso.'],
    ],
  },
  {
    tipo: 'situacao',
    titulo: 'Situacao',
    objetivo: 'Entender rapidamente como ela atende e de onde vem as clientes, sem soar como formulario.',
    intencao: 'Faze-la falar do proprio negocio, que e assunto confortavel, e coletar o material que vai sustentar a implicacao mais adiante. Hipotese antes de pergunta demonstra conhecimento e economiza tempo.',
    frase_sugerida: 'Pelo que eu vi do seu trabalho, meu chute e que a maior parte das suas clientes chega por indicacao, e uma parte menor pelo Instagram. Faz sentido no seu caso ou esta diferente disso?',
    perguntas: [
      'De onde vem a maior parte das suas clientes novas hoje?',
      'Voce atende em espaco proprio, em casa ou dentro de um salao?',
      'Qual procedimento puxa mais gente nova para voce: alongamento, manutencao ou esmaltacao em gel?',
      'Quando alguem te indica, o que essa pessoa costuma fazer antes de te chamar?',
    ],
    sinais_interesse: [
      'Detalha a rotina sem ser cutucada',
      'Corrige sua hipotese e explica como realmente e',
      'Fala com orgulho de um procedimento especifico',
      'Conta uma historia de cliente',
    ],
    sinais_resistencia: [
      'Responde com uma palavra so',
      'Pergunta aonde voce quer chegar',
      'Evita falar de volume ou de agenda',
    ],
    objecoes: [
      ['Por que voce quer saber isso?', 'Porque o que eu tenho para te falar muda dependendo de como voce atende. Se voce trabalha dentro de um salao parceiro, faz menos sentido do que se voce atende em espaco proprio. Nao quero te falar de uma coisa que nao e o seu caso.'],
      ['Isso e pesquisa?', 'Nao e pesquisa, nao. E para eu conseguir ser especifico com voce em vez de falar o mesmo texto para todo mundo.'],
      ['Prefiro nao falar do meu movimento', 'Sem problema, numero eu nem preciso saber. So entender por onde a cliente nova chega ate voce ja resolve.'],
    ],
  },
  {
    tipo: 'descoberta',
    titulo: 'Descoberta',
    objetivo: 'Levar a conversa ate o ponto cego: o que acontece entre a indicacao e a primeira mensagem no WhatsApp.',
    intencao: 'Abrir uma area do negocio que ela nunca observou. Curiosidade sobre o proprio ponto cego e mais forte que argumento de venda.',
    frase_sugerida: 'Deixa eu te fazer uma pergunta que quase ninguem para para pensar: quando uma cliente sua te indica para uma amiga, voce acha que essa amiga te chama direto no WhatsApp ou ela primeiro procura seu nome para dar uma olhada?',
    perguntas: [
      'O que voce imagina que essa pessoa encontra quando procura seu nome?',
      'Quais perguntas as clientes novas mais fazem antes de fechar o primeiro horario?',
      'Quantas dessas pessoas indicadas voce acha que chegam a te mandar mensagem?',
      'Onde hoje ficam as informacoes de preco, endereco e o que esta incluso em cada servico?',
    ],
    sinais_interesse: [
      'Fica em silencio pensando antes de responder',
      'Diz "nunca parei para pensar nisso"',
      'Lista espontaneamente as perguntas repetidas que recebe',
      'Reconhece que nao sabe o que a pessoa encontra',
    ],
    sinais_resistencia: [
      'Afirma que todo mundo ja chega sabendo tudo',
      'Diz que o Instagram dela ja responde tudo',
      'Desvia para falar de outro assunto',
    ],
    objecoes: [
      ['Elas ja chegam sabendo, a amiga explica tudo', 'As que chegam, chegam sabendo mesmo. Minha duvida e sobre as que nao chegam — e essas voce nao tem como contar, porque elas nunca te mandaram mensagem.'],
      ['Meu Instagram tem tudo nos destaques', 'Os destaques ajudam bastante, sim. A questao e que eles so existem para quem ja esta dentro do seu perfil. Quem ouviu seu nome e foi procurar no Google nao passa por eles.'],
      ['Isso nao e problema para mim', 'Pode ser que nao seja mesmo. Se estiver tudo redondo, otimo, ai eu nem tomo seu tempo. Posso te fazer so mais uma pergunta para eu ter certeza?'],
    ],
  },
  {
    tipo: 'problema',
    titulo: 'Problema',
    objetivo: 'Nomear com clareza o problema concreto que ela vive, usando as palavras que ela mesma acabou de dizer.',
    intencao: 'Quando o problema e dito com as palavras dela, deixa de ser argumento de vendedor e vira constatacao propria. Isso reduz a defesa e aumenta a apropriacao.',
    frase_sugerida: 'Entao, resumindo o que voce me falou: a cliente nova chega por indicacao, mas antes de te chamar ela da uma olhada em voce na internet — e o que ela encontra hoje e o feed do Instagram, que mostra os ultimos trabalhos, mas nao responde preco, o que esta incluso, endereco e politica de atraso. Ai essas mesmas perguntas caem no seu WhatsApp, no meio do atendimento, com a sua mao ocupada. E mais ou menos isso?',
    perguntas: [
      'Quantas vezes por dia voce responde as mesmas perguntas de preco e endereco?',
      'Ja aconteceu de alguem sumir depois de perguntar o valor?',
      'Como voce faz quando chega mensagem e voce esta no meio de um alongamento?',
      'Ja teve cliente que reclamou do valor por nao entender o que estava incluso?',
    ],
    sinais_interesse: [
      'Concorda e complementa com um exemplo proprio',
      'Reclama espontaneamente do WhatsApp durante o atendimento',
      'Cita um caso de cliente que sumiu depois do preco',
      'Diz que ja pensou em ter um site',
    ],
    sinais_resistencia: [
      'Minimiza dizendo que faz parte do trabalho',
      'Diz que responder mensagem nao incomoda',
      'Fica calada e sem reacao',
    ],
    objecoes: [
      ['Isso e normal, faz parte', 'E comum mesmo, quase toda profissional que eu converso vive isso. So que ser comum nao quer dizer que esteja te custando pouco.'],
      ['Eu respondo rapido, nao e problema', 'Acredito que responda. Minha questao nem e a demora, e voce estar fazendo isso com a mao ocupada, no meio de um atendimento que a cliente da cadeira pagou.'],
      ['Quem some e porque nao ia fechar mesmo', 'Pode ser que boa parte nao fosse mesmo. O complicado e que, do jeito que esta, voce nao tem como saber quem sumiu por preco e quem sumiu so por falta de informacao.'],
    ],
  },
  {
    tipo: 'implicacao',
    titulo: 'Implicacao',
    objetivo: 'Fazer ela enxergar sozinha o custo de manter tudo como esta, sem exagerar nem inventar numero.',
    intencao: 'Ampliar a percepcao da consequencia e o que move do "seria bom" para o "preciso resolver". A conclusao precisa ser dela; o vendedor so oferece a pergunta.',
    frase_sugerida: 'Deixa eu te provocar em uma coisa. Se de cada indicacao que chega ate voce uma parte desiste no meio do caminho por nao achar informacao, isso nao aparece em lugar nenhum — nao tem mensagem nao respondida, nao tem cliente reclamando. Simplesmente nao acontece. E ao mesmo tempo, sem esse lugar organizado, fica mais dificil sustentar o seu preco quando aparece alguem cobrando bem abaixo. Como voce ve isso no seu caso?',
    perguntas: [
      'O que muda no seu mes se as indicadas que hoje somem chegarem a te mandar mensagem?',
      'Quando voce pensa em subir o preco, o que te segura?',
      'Se a pessoa ja chegasse sabendo o valor e o que esta incluso, sua conversa de agendamento ficaria mais facil?',
      'O que hoje diferencia o seu trabalho de quem cobra metade e a cliente nova nao consegue ver?',
    ],
    sinais_interesse: [
      'Faz uma conta em voz alta',
      'Fala em querer subir preco ou se posicionar melhor',
      'Suspira, concorda e fica reflexiva',
      'Pergunta o que da para fazer sobre isso',
    ],
    sinais_resistencia: [
      'Diz que esta satisfeita como esta',
      'Repete que a agenda esta cheia',
      'Acha que voce esta exagerando o problema',
    ],
    objecoes: [
      ['Minha agenda ja esta cheia', 'Isso e otimo, e muda a conversa. Com agenda cheia, a questao deixa de ser volume e passa a ser escolher melhor quem entra e conseguir cobrar o que o seu trabalho vale. Isso te interessa mais?'],
      ['Nao quero crescer mais, quero e qualidade de vida', 'Faz todo sentido. Nesse caso, o ganho nao e mais cliente, e menos mensagem repetida no seu dia e uma cliente que ja chega alinhada. E menos trabalho, nao mais.'],
      ['Voce esta aumentando o problema para me vender algo', 'Justo, e eu nao tenho como te provar isso no telefone. Por isso eu prefiro te mostrar o seu caso na tela em vez de ficar te descrevendo. Se la nao tiver nada, voce mesma vai ver.'],
    ],
  },
  {
    tipo: 'insight',
    titulo: 'Insight',
    objetivo: 'Reposicionar o site: de despesa de marketing para ferramenta de autoridade e confianca que sustenta preco.',
    intencao: 'Ela ja ouviu "voce precisa de um site" e categorizou como custo. Trocar a categoria e o que abre a reuniao: nao e para aparecer mais, e para nao perder quem ja veio.',
    frase_sugerida: 'Olha, eu vou te falar uma coisa que talvez va contra o que te vendem por ai. Voce nao precisa de site para aparecer mais — voce ja tem indicacao chegando, e isso e o mais dificil. O que costuma faltar e um lugar seu, que nao depende de algoritmo, onde a pessoa que ouviu seu nome encontre o seu trabalho separado por tipo, o que esta incluso, o valor, o endereco e como voce trabalha. E menos vitrine de propaganda e mais o que sustenta voce ser vista como referencia e nao como mais uma opcao de preco.',
    perguntas: [
      'Como voce gostaria de ser vista por quem ainda nao te conhece?',
      'Voce ja mandou seu Instagram para alguem e sentiu que nao representava seu trabalho de hoje?',
      'Se voce pudesse mandar um unico link que respondesse tudo, isso ajudaria no seu dia?',
      'Faz sentido para voce essa diferenca entre aparecer mais e nao perder quem ja chegou?',
    ],
    sinais_interesse: [
      'Diz que e exatamente isso que ela sente',
      'Pergunta como ficaria no caso dela',
      'Pede para ver exemplo',
      'Comenta que ja viu site de colega e gostou',
    ],
    sinais_resistencia: [
      'Repete que Instagram basta',
      'Diz que cliente dela nao abre site',
      'Associa imediatamente a gasto',
    ],
    objecoes: [
      ['Ja tenho Instagram, isso nao resolve?', 'O Instagram continua sendo essencial e nada substitui ele. So que ele e da plataforma, e cronologico e depende de entrega. O site e o seu, fica organizado do jeito que voce quiser e continua respondendo quando voce nao esta postando. Um alimenta o outro.'],
      ['Minha cliente nao entra em site, vai direto no WhatsApp', 'A maioria realmente vai fechar no WhatsApp mesmo, e e assim que tem que ser. O site nao e para substituir isso: e para o antes, quando ela esta decidindo se te chama, e para o durante, quando voce manda um link em vez de digitar tudo de novo.'],
      ['Isso e para salao grande, eu atendo sozinha em casa', 'Entendo, mas e justamente quem atende sozinha que mais precisa transmitir que aquilo e profissional. Estrutura grande ja transmite sozinha; quem atende em casa precisa que a presenca digital faca esse trabalho.'],
    ],
  },
  {
    tipo: 'qualificacao',
    titulo: 'Qualificacao',
    objetivo: 'Confirmar decisao, intencao e encaixe antes de propor a reuniao, evitando agendar com quem nao decide ou nao quer.',
    intencao: 'Perguntar em vez de presumir protege a agenda e sinaliza que voce nao vai marcar reuniao com qualquer um — o que aumenta o valor percebido do encontro.',
    frase_sugerida: 'Antes de eu te propor qualquer coisa, deixa eu confirmar duas coisas para nao te fazer perder tempo: essa decisao de como divulgar o seu trabalho e sua mesmo, ou tem mais alguem que decide junto? E, hoje, isso e algo que voce quer resolver ou e assunto para daqui a alguns meses?',
    perguntas: [
      'E voce quem decide sobre a divulgacao do seu trabalho?',
      'Isso e uma prioridade para agora ou para mais adiante?',
      'Voce ja tentou resolver isso antes de alguma forma?',
      'Se fizesse sentido, voce teria condicao de tratar disso ainda neste mes?',
    ],
    sinais_interesse: [
      'Confirma que decide sozinha',
      'Diz que ja vinha pensando nisso',
      'Pergunta prazo ou como funciona o processo',
      'Fala em algo que quer fazer em breve, como mudar de espaco ou subir preco',
    ],
    sinais_resistencia: [
      'Diz que precisa falar com terceiros indefinidos',
      'Empurra para daqui a muitos meses sem motivo claro',
      'Evita responder se e prioridade',
    ],
    objecoes: [
      ['Preciso falar com minha socia', 'Perfeito, entao melhor ainda que ela participe. Prefere que eu marque um horario em que voces duas consigam estar juntas?'],
      ['Agora nao e o momento, quem sabe ano que vem', 'Tudo bem, sem problema. So para eu entender: e uma questao de momento financeiro, de tempo ou voce acha mesmo que nao e a hora? Dependendo, faz mais sentido eu te procurar em outro periodo do que insistir agora.'],
      ['Depende do preco', 'E uma preocupacao legitima. O valor eu te falo na conversa, com o escopo na frente, para voce comparar coisa com coisa. E se estiver fora da sua realidade, voce me fala e a gente encerra ali mesmo, sem constrangimento.'],
    ],
  },
  {
    tipo: 'objecoes',
    titulo: 'Objecoes',
    objetivo: 'Acolher as resistencias restantes sem confronto e devolve-las como motivos para a conversa acontecer.',
    intencao: 'Concordar com a parte verdadeira da objecao desarma a defesa. Objecao respondida com honestidade constroi mais confianca do que objecao que nunca apareceu.',
    frase_sugerida: 'Olha, eu prefiro que voce me fale o que esta te travando agora do que me dizer que vai pensar e a gente nao se falar mais. O que hoje mais te faz duvidar disso?',
    perguntas: [
      'O que te deixa com o pe atras nisso?',
      'Voce ja teve alguma experiencia ruim com esse tipo de servico?',
      'O que precisaria ficar claro para voce achar que vale a conversa?',
      'Se o valor nao fosse o problema, ainda assim teria alguma duvida?',
    ],
    sinais_interesse: [
      'Verbaliza a objecao real em vez de dar desculpa generica',
      'Conta uma experiencia anterior frustrada',
      'Pergunta como funciona a manutencao depois de pronto',
      'Pede exemplo de outro trabalho do segmento',
    ],
    sinais_resistencia: [
      'Repete "vou pensar" sem dar motivo',
      'Encurta as respostas e acelera o tom',
      'Pede para voce mandar tudo por escrito e nao falar mais',
    ],
    objecoes: [
      ['Ja paguei alguem de marketing e nao deu em nada', 'Escuto isso bastante, e faz sentido a desconfianca. Uma diferenca importante: aqui nao e impulsionamento, nao e anuncio, nao e algo que depende de investimento continuo para existir. E uma estrutura sua, que fica no ar independente disso. Na conversa eu te mostro exatamente o que e entregue, para voce comparar com o que te venderam antes.'],
      ['Nao tenho tempo para cuidar de mais isso', 'Esse e justamente o ponto. A ideia nao e te dar mais uma tarefa; e tirar de voce a parte de digitar preco e endereco dez vezes por dia. E do seu lado o trabalho e pontual, nao e voce quem monta nada.'],
      ['Nao entendo nada de tecnologia, ia ficar parado', 'Voce nao precisa entender. Essa parte e comigo. Voce continua fazendo unha, que e o que voce faz bem.'],
      ['Esta apertado esse mes', 'Entendo perfeitamente, e conversar nao te compromete com nada. Inclusive, se depois da conversa voce decidir fazer daqui a dois meses, tudo bem — pelo menos voce vai saber o que precisa ser feito.'],
      ['Vou pensar e te retorno', 'Claro, voce tem que pensar mesmo. So que pensar sobre uma coisa que voce ainda nao viu e dificil. Que tal a gente fazer a conversa, voce ve o seu caso na tela e ai sim decide com informacao na mao?'],
    ],
  },
  {
    tipo: 'convite_reuniao',
    titulo: 'Convite para reuniao',
    objetivo: 'Propor a reuniao como diagnostico especifico do caso dela, com valor claro e sem compromisso de compra.',
    intencao: 'O que se vende aqui e a descoberta, nao o tempo. Ela precisa querer ver o que a cliente nova ve — curiosidade sobre o proprio negocio e mais forte do que promessa de proposta comercial.',
    frase_sugerida: 'Minha proposta e a seguinte: a gente marca de vinte a trinta minutos, eu abro a tela e a gente olha juntos exatamente o que aparece hoje quando alguem procura o seu nome — o que a cliente indicada encontra e o que esta faltando no caminho ate ela te chamar. Nao e apresentacao de slide, e o seu caso. Se no fim fizer sentido, eu te falo como a gente resolveria. Se nao fizer, voce sai com o diagnostico e usa do jeito que quiser. Voce prefere quarta as dez da manha ou quinta no fim da tarde?',
    perguntas: [
      'Qual desses dois horarios encaixa melhor na sua agenda?',
      'Voce costuma ter algum intervalo entre atendimentos durante a semana?',
      'Prefere por video ou por ligacao normal?',
      'Tem mais alguem que voce gostaria que participasse?',
    ],
    sinais_interesse: [
      'Escolhe um dos horarios ou propoe outro',
      'Pergunta quanto tempo vai durar',
      'Quer saber se precisa preparar alguma coisa',
      'Pede o link ou pergunta como sera a chamada',
    ],
    sinais_resistencia: [
      'Diz que nao consegue marcar nada agora',
      'Pede para voce retornar sem definir quando',
      'Sugere resolver tudo por mensagem',
    ],
    objecoes: [
      ['Meia hora e muito para mim', 'Consigo fazer em quinze minutos, sem problema. Nesse tempo eu ja te mostro o essencial e voce decide se quer ver o resto.'],
      ['Nao consigo marcar, minha agenda muda toda hora', 'Entendo, e a realidade de quem atende. Vamos deixar marcado no seu dia mais tranquilo e, se surgir cliente, voce me avisa e a gente remarca sem cerimonia.'],
      ['Nao da para voce me mandar isso por WhatsApp?', 'Eu te mando um resumo depois, com certeza. Mas o mais util e voce ver ao vivo e poder me perguntar na hora, porque cada caso tem um detalhe diferente. Video ou ligacao, como voce preferir.'],
      ['Voce vai me empurrar proposta na reuniao?', 'Se fizer sentido, eu vou te falar como resolvo e quanto custa, sim, sem enrolar. E se nao fizer, eu falo isso tambem. Voce nao precisa decidir nada na hora.'],
    ],
  },
  {
    tipo: 'proxima_acao',
    titulo: 'Proxima acao',
    objetivo: 'Fechar com compromisso concreto, confirmar o canal e reduzir a chance de a reuniao esvaziar.',
    intencao: 'Repetir em voz alta o dia, a hora e o motivo aumenta o compromisso. Enviar a confirmacao pelo canal que ela ja usa todos os dias transforma a ligacao fria em conversa em andamento.',
    frase_sugerida: 'Fechado entao: [dia] as [hora], de vinte a trinta minutos. Vou te mandar a confirmacao agora pelo WhatsApp com o link e uma mensagem curta lembrando do que a gente vai olhar. Se acontecer alguma coisa e voce precisar remarcar, e so me responder ali mesmo, sem problema nenhum. Combinado?',
    perguntas: [
      'Este numero do WhatsApp e o melhor para eu te confirmar?',
      'Quer que eu te mande um lembrete no dia anterior?',
      'Tem alguma duvida que voce ja quer que eu leve pronta para a conversa?',
      'Prefere que eu confirme na vespera ou algumas horas antes?',
    ],
    sinais_interesse: [
      'Confirma o numero e o horario',
      'Aceita o lembrete',
      'Ja manda uma duvida para voce levar preparada',
      'Salva seu contato ou responde a mensagem de confirmacao',
    ],
    sinais_resistencia: [
      'Fica vaga sobre o horario combinado',
      'Nao confirma o WhatsApp',
      'Encerra a ligacao rapidamente sem repetir o combinado',
    ],
    objecoes: [
      ['Depois eu confirmo com voce', 'Sem problema. Eu deixo pre-marcado [dia] as [hora] e te mando a mensagem agora. Se voce responder um ok ate amanha, esta confirmado; se nao der, voce me fala e a gente escolhe outro dia.'],
      ['Nao precisa mandar lembrete', 'Tranquilo, nao mando lembrete. So a confirmacao de hoje com o link, para voce nao precisar procurar depois.'],
      ['Se eu nao puder, eu aviso', 'Perfeito, e so me chamar no mesmo numero. Prefiro remarcar do que voce se sentir presa a um horario no meio de um atendimento.'],
    ],
  },
]

// --- Montagem dos registros ----------------------------------------------------------
// `objetivo` da etapa carrega tambem a intencao psicologica: a coluna e TEXT e a tela do
// operador mostra esse campo inteiro — sem isso, a intencao se perderia (nao ha coluna).
function montarEtapas() {
  return ETAPAS.map((e, i) => ({
    ordem: i + 1,
    tipo: e.tipo,
    titulo: e.titulo,
    objetivo: `${e.objetivo}\n\nIntencao psicologica: ${e.intencao}`,
    frase_sugerida: e.frase_sugerida,
    perguntas: e.perguntas,
    sinais_interesse: e.sinais_interesse,
    sinais_resistencia: e.sinais_resistencia,
    objecoes: e.objecoes.map(([objecao, resposta]) => ({ objecao, resposta })),
  }))
}

// Limite real da coluna via src/db/roteiros.js: descricao e' cortada em 2000 chars.
function montarDescricaoRoteiro() {
  const d = [
    `Posicionamento: ${CAMPANHA.posicionamento}`,
    `Proposta de valor: ${CAMPANHA.proposta_de_valor}`,
    `Tom de voz: ${CAMPANHA.tom_de_voz}`,
    `Regras de conducao: ${REGRAS_DE_CONDUCAO.join(' ')}`,
  ].join('\n\n')
  return d
}

function montarObjetivoCampanha() {
  return [
    CAMPANHA.objetivo,
    `Publico-alvo: ${CAMPANHA.publico_alvo}`,
    `Resultado esperado da ligacao: ${CAMPANHA.resultado_esperado_da_ligacao}`,
    `CTA principal: ${CAMPANHA.cta_principal}`,
  ].join('\n\n')
}

function montarHipoteseCampanha() {
  return [
    CAMPANHA.hipotese_inicial,
    `Insight de mercado: ${ANALISE.insight_de_mercado}`,
    `Como consegue clientes: ${ANALISE.como_consegue_clientes}`,
    `Processo de decisao: ${ANALISE.processo_de_decisao}`,
  ].join('\n\n')
}

function montarBlocoEstrategico() {
  return {
    oferta: CAMPANHA.oferta,
    publico_alvo: CAMPANHA.publico_alvo,
    posicionamento: CAMPANHA.posicionamento,
    proposta_de_valor: CAMPANHA.proposta_de_valor,
    tom_de_voz: CAMPANHA.tom_de_voz,
    criterios_qualificacao: CAMPANHA.criterios_qualificacao,
    dores_principais: CAMPANHA.dores_principais,
    objecoes_principais: CAMPANHA.objecoes_principais,
    sinais_de_fit: CAMPANHA.sinais_de_fit,
    sinais_de_baixo_fit: CAMPANHA.sinais_de_baixo_fit,
    resultado_esperado_da_ligacao: CAMPANHA.resultado_esperado_da_ligacao,
    cta_principal: CAMPANHA.cta_principal,
    regras_de_conducao: REGRAS_DE_CONDUCAO,
    analise_estrategica: ANALISE,
    origem: 'scripts/seed-campanha-nail-designer.js',
  }
}

// --- Execucao ------------------------------------------------------------------------
function lerArgs(argv) {
  const args = {
    aplicar: false, empresa: null, status: 'rascunho', termo: NICHO_TERMO_PADRAO,
    vincularLeads: false, ativar: false,
  }
  for (const bruto of argv.slice(2)) {
    const arg = String(bruto)
    if (arg === '--aplicar') args.aplicar = true
    else if (arg === '--dry-run' || arg === '--simular') args.aplicar = false
    else if (arg === '--vincular-leads') args.vincularLeads = true
    else if (arg === '--ativar') args.ativar = true
    // Aceito e ignorado: promover o nicho ao catalogo virou o comportamento padrao.
    else if (arg === '--criar-nicho') { /* no-op */ }
    else if (arg.startsWith('--empresa=')) args.empresa = arg.slice(10).trim() || null
    else if (arg.startsWith('--status=')) args.status = arg.slice(9).trim() || 'rascunho'
    else if (arg.startsWith('--termo=')) args.termo = arg.slice(8).trim() || NICHO_TERMO_PADRAO
    else throw new Error(`argumento desconhecido: ${arg}`)
  }
  if (!['rascunho', 'ativa'].includes(args.status)) {
    throw new Error('--status aceita apenas "rascunho" ou "ativa".')
  }
  return args
}

// Quando o nicho nao esta no catalogo, o erro sozinho nao ajuda: mostra o que EXISTE em
// app.nichos e o que ha de parecido nos leads (texto livre), com a empresa de cada um.
async function diagnosticoNichos() {
  const linhas = []
  const cat = await pool.query(
    `SELECT n.nome, n.ativo, e.nome AS empresa_nome, n.empresa_id
       FROM app.nichos n JOIN app.empresas e ON e.id = n.empresa_id
      ORDER BY e.nome, n.nome LIMIT 100`
  )
  linhas.push(`\nCatalogo app.nichos (${cat.rows.length} registro(s)):`)
  if (!cat.rows.length) linhas.push('  (vazio — nenhum nicho cadastrado em nenhuma empresa)')
  for (const r of cat.rows) {
    linhas.push(`  - "${r.nome}"${r.ativo ? '' : ' [inativo]'} — empresa ${r.empresa_nome} / ${r.empresa_id}`)
  }
  const leads = await pool.query(
    `SELECT p.nicho, p.empresa_id, e.nome AS empresa_nome, COUNT(*)::int AS total
       FROM prospectador.prospects p JOIN app.empresas e ON e.id = p.empresa_id
      WHERE p.nicho ILIKE ANY($1::text[])
      GROUP BY p.nicho, p.empresa_id, e.nome
      ORDER BY total DESC LIMIT 30`,
    [TERMOS_PARECIDOS]
  )
  linhas.push(`\nNichos parecidos nos LEADS (prospectador.prospects.nicho, texto livre):`)
  if (!leads.rows.length) linhas.push('  (nenhum lead com nicho de unhas)')
  for (const r of leads.rows) {
    linhas.push(`  - "${r.nicho}" — ${r.total} lead(s) — empresa ${r.empresa_nome} / ${r.empresa_id}`)
  }
  linhas.push('\nSaida possivel: --termo="<nome como aparece acima>"')
  return linhas.join('\n')
}

// Empresas que TEM leads nesse nicho, com a grafia mais usada em cada uma. E a ponte
// entre o texto livre (prospects.nicho) e o catalogo (app.nichos): se o nicho ja e real
// na base de leads, ele e promovido ao catalogo com a MESMA grafia — assim o
// `lower(p.nicho) = lower(n.nome)` de src/db/nichos.js casa os leads de imediato.
async function empresasComNichoNosLeads(termo, empresaFiltro) {
  const params = [`%${termo}%`]
  let filtro = ''
  if (empresaFiltro) { params.push(empresaFiltro); filtro = `AND p.empresa_id = $${params.length}` }
  const { rows } = await pool.query(
    `SELECT p.empresa_id, e.nome AS empresa_nome, p.nicho AS nome, COUNT(*)::int AS total
       FROM prospectador.prospects p
       JOIN app.empresas e ON e.id = p.empresa_id
      WHERE p.nicho ILIKE $1 ${filtro}
      GROUP BY p.empresa_id, e.nome, p.nicho
      ORDER BY total DESC`,
    params
  )
  // Uma entrada por empresa: a grafia mais frequente vence (ORDER BY total DESC).
  const porEmpresa = new Map()
  for (const r of rows) {
    if (!porEmpresa.has(r.empresa_id)) {
      porEmpresa.set(r.empresa_id, { ...r, nome: String(r.nome).trim() })
    }
  }
  return [...porEmpresa.values()]
}

// Resolve o nicho no catalogo. Com --criar-nicho, cria quando nao existe (so' no modo
// --aplicar; na simulacao apenas anuncia). O empresa_id sai do proprio nicho — assim
// campanha, roteiro e nicho ficam garantidamente no mesmo tenant.
async function resolverNicho(args) {
  const params = [`%${args.termo}%`]
  let filtro = ''
  if (args.empresa) { params.push(args.empresa); filtro = `AND n.empresa_id = $${params.length}` }
  const { rows } = await pool.query(
    `SELECT n.id, n.empresa_id, n.nome, n.ativo, e.nome AS empresa_nome
       FROM app.nichos n
       JOIN app.empresas e ON e.id = n.empresa_id
      WHERE n.nome ILIKE $1 ${filtro}
      ORDER BY n.nome`,
    params
  )
  if (rows.length > 1) {
    const lista = rows.map((r) => `  - ${r.nome} (empresa ${r.empresa_nome} / ${r.empresa_id})`).join('\n')
    throw new Error(`Mais de um nicho casa com "${args.termo}". Use --empresa=<uuid>:\n${lista}`)
  }
  if (rows.length === 1) return { ...rows[0], criado: false }

  // Nao esta no catalogo. Se o nicho JA EXISTE nos leads, ele e' real e so' nao foi
  // promovido — promover e' a unica saida sensata, entao acontece sozinho (a campanha
  // exige nicho_id). So' para quando a escolha e' de fato ambigua.
  const candidatos = await empresasComNichoNosLeads(args.termo, args.empresa)
  if (!candidatos.length) {
    throw new Error(
      `Nicho "${args.termo}" nao existe nem no catalogo (app.nichos) nem nos leads ` +
      `(prospectador.prospects.nicho).${await diagnosticoNichos()}`
    )
  }
  if (candidatos.length > 1) {
    const lista = candidatos.map((c) => `  - "${c.nome}" — ${c.total} lead(s) — ${c.empresa_nome} / ${c.empresa_id}`).join('\n')
    throw new Error(`Leads desse nicho em mais de uma empresa. Escolha com --empresa=<uuid>:\n${lista}`)
  }
  const alvo = candidatos[0]
  if (!args.aplicar) {
    return {
      id: null, empresa_id: alvo.empresa_id, empresa_nome: alvo.empresa_nome,
      nome: alvo.nome, ativo: true, criado: true, leads: alvo.total,
    }
  }
  const novo = await criarNicho(pool, alvo.empresa_id, { nome: alvo.nome, descricao: CAMPANHA.publico_alvo })
  return { ...novo, empresa_id: alvo.empresa_id, empresa_nome: alvo.empresa_nome, criado: true, leads: alvo.total }
}

async function jaExiste(empresaId) {
  const [r, c] = await Promise.all([
    pool.query(`SELECT id FROM app.roteiros WHERE empresa_id = $1 AND lower(nome) = lower($2)`, [empresaId, CAMPANHA.nome]),
    pool.query(`SELECT id FROM app.campanhas WHERE empresa_id = $1 AND lower(nome) = lower($2)`, [empresaId, CAMPANHA.nome]),
  ])
  return { roteiro: r.rows[0]?.id || null, campanha: c.rows[0]?.id || null }
}

// Vincula a campanha TODOS os leads do nicho (casados por nome, como o resto do modulo).
// Inclui os sem telefone de proposito: a FILA ja os exclui (src/db/campanhas.js), mas eles
// continuam visiveis na aba de acompanhamento para enriquecimento. `adicionarLeads` faz
// dedup por (campanha, prospect), entao repetir a operacao nao duplica.
async function vincularLeads(args, empresaId, campanhaId, nomeNicho) {
  const { rows } = await pool.query(
    `SELECT id, NULLIF(TRIM(COALESCE(telefone, '')), '') IS NOT NULL AS discavel
       FROM prospectador.prospects
      WHERE empresa_id = $1 AND lower(nicho) = lower($2)`,
    [empresaId, nomeNicho]
  )
  const comTelefone = rows.filter((r) => r.discavel).length
  console.log(`\nleads do nicho "${nomeNicho}": ${rows.length} (${comTelefone} com telefone discavel -> entram na fila; ${rows.length - comTelefone} so' no acompanhamento)`)
  if (!args.aplicar) {
    console.log('  [simulacao] nenhum vinculo criado.')
    return
  }
  const r = await adicionarLeads(pool, empresaId, campanhaId, rows.map((x) => x.id))
  console.log(`  vinculados agora: ${r.adicionados} (os ja vinculados sao ignorados)`)
}

async function ativar(args, empresaId, campanhaId) {
  console.log(`\nstatus da campanha -> ativa`)
  if (!args.aplicar) {
    console.log('  [simulacao] status nao alterado.')
    return
  }
  const c = await atualizarCampanha(pool, empresaId, campanhaId, { status: 'ativa' })
  console.log(`  campanha ${c.id} agora esta "${c.status}"`)
}

async function main() {
  const args = lerArgs(process.argv)
  const etapas = montarEtapas()
  const descricao = montarDescricaoRoteiro()

  const nicho = await resolverNicho(args)
  const empresaId = nicho.empresa_id
  const existente = await jaExiste(empresaId)

  const origemNicho = nicho.criado
    ? `${args.aplicar ? 'PROMOVIDO' : 'SERA PROMOVIDO'} ao catalogo a partir dos leads (${nicho.leads} lead(s))`
    : 'ja existia no catalogo'
  console.log('--- SEED campanha + roteiro (nail designer) ---')
  console.log(`modo:     ${args.aplicar ? 'APLICAR (grava)' : 'SIMULACAO (nao grava)'}`)
  console.log(`empresa:  ${nicho.empresa_nome} (${empresaId})`)
  console.log(`nicho:    ${nicho.nome} (${nicho.id || 'sem id — simulacao'}) — ${origemNicho}${nicho.ativo ? '' : ' [INATIVO]'}`)
  console.log(`campanha: ${CAMPANHA.nome} [status ${args.status}]`)
  console.log(`roteiro:  ${etapas.length} etapas -> ${etapas.map((e) => e.tipo).join(', ')}`)
  console.log(`descricao do roteiro: ${descricao.length} chars${descricao.length > 2000 ? ' (SERA CORTADA em 2000)' : ''}`)

  // Operacoes sobre a campanha JA CRIADA (nao recriam nada).
  if (args.vincularLeads || args.ativar) {
    if (!existente.campanha) throw new Error('Campanha ainda nao existe — rode o seed (--aplicar) antes.')
    if (args.vincularLeads) await vincularLeads(args, empresaId, existente.campanha, nicho.nome)
    if (args.ativar) await ativar(args, empresaId, existente.campanha)
    if (!args.aplicar) console.log('\nSimulacao concluida. Nada foi gravado. Rode com --aplicar para gravar.')
    return
  }

  if (existente.roteiro || existente.campanha) {
    console.log('\nABORTADO — ja existe registro com este nome nesta empresa:')
    if (existente.roteiro) console.log(`  roteiro:  ${existente.roteiro}`)
    if (existente.campanha) console.log(`  campanha: ${existente.campanha}`)
    console.log('Para completar a campanha existente use --vincular-leads e/ou --ativar.')
    return
  }

  if (!args.aplicar) {
    console.log('\nSimulacao concluida. Nada foi gravado. Rode com --aplicar para gravar.')
    return
  }

  let roteiroId = null
  try {
    const r = await criarRoteiro(pool, empresaId, {
      nome: CAMPANHA.nome,
      descricao,
      nicho: nicho.nome,
    })
    roteiroId = r.roteiro_id
    console.log(`\n[1/4] roteiro criado: ${roteiroId} (versao ${r.versao} ${r.status})`)

    const s = await salvarEtapas(pool, empresaId, r.versao_id, etapas)
    console.log(`[2/4] etapas gravadas: ${s.etapas}`)

    await publicarVersao(pool, empresaId, r.versao_id)
    console.log(`[3/4] versao publicada: ${r.versao_id}`)

    const c = await criarCampanha(pool, empresaId, {
      nome: CAMPANHA.nome,
      objetivo: montarObjetivoCampanha(),
      hipotese: montarHipoteseCampanha(),
      nicho_id: nicho.id,
      roteiro_versao_id: r.versao_id,
      status: args.status,
    })
    console.log(`[4/4] campanha criada: ${c.id} (status ${c.status})`)

    // MERGE aditivo no nicho: `||` mantem tudo que ja existia em criterios_json.
    await pool.query(
      `UPDATE app.nichos
          SET criterios_json = criterios_json || $3::jsonb, atualizado_em = NOW()
        WHERE id = $1 AND empresa_id = $2`,
      [nicho.id, empresaId, JSON.stringify({ campanha_nail_designer: montarBlocoEstrategico() })]
    )
    console.log(`[+]   bloco estrategico anexado em app.nichos.criterios_json -> chave "campanha_nail_designer"`)

    console.log('\nOK. Campanha e roteiro gravados.')
  } catch (e) {
    // Nicho criado por ESTA execucao e ainda sem dependentes: sai junto no rollback.
    if (nicho.criado && nicho.id) {
      try {
        await pool.query(`DELETE FROM app.nichos WHERE id = $1 AND empresa_id = $2`, [nicho.id, empresaId])
        console.error(`Nicho ${nicho.id} (criado nesta execucao) removido (rollback).`)
      } catch (e2) {
        console.error(`Rollback do nicho ${nicho.id} falhou: ${e2.message}`)
      }
    }
    if (roteiroId) {
      // Rollback manual: o CASCADE de app.roteiros leva versoes e etapas junto, entao
      // uma falha no meio nao deixa roteiro pela metade apontado por nada.
      try {
        await pool.query(`DELETE FROM app.roteiros WHERE id = $1 AND empresa_id = $2`, [roteiroId, empresaId])
        console.error(`\nFalhou depois de criar o roteiro — roteiro ${roteiroId} removido (rollback).`)
      } catch (e2) {
        console.error(`\nFalhou E o rollback do roteiro ${roteiroId} tambem falhou: ${e2.message}`)
      }
    }
    throw e
  }
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error(`\nERRO: ${e.message}`)
    pool.end().finally(() => process.exit(1))
  })
