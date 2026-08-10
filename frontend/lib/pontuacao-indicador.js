// Apresentacao do INDICADOR CIRCULAR DE PONTUACAO — modulo PURO.
//
// Por que existe: o produto ja tinha a bolinha TRES vezes, com implementacoes diferentes
// (Central de Ligacoes, Central de Mensagens e Follow-ups), acessibilidade desigual e paleta
// divergente. Aqui vive a parte que NAO e' React: faixa -> classes, texto do valor, montagem
// dos fatores auditaveis e o resumo textual que vira `aria-label`. O componente
// (`components/ui/BolinhaPontuacao.tsx`) so' desenha.
//
// REGRA CENTRAL DESTE MODULO: o componente e' unico, a PONTUACAO NAO E'. A mesma bolinha em
// duas telas nunca pode sugerir que 72 significa a mesma coisa nas duas. Por isso:
//   • a VARIANTE SEMANTICA e' obrigatoria e escolhe a paleta;
//   • `oQueMede` e' obrigatorio e e' a frase que diz o que a pontuacao mede NAQUELA tela;
//   • nenhuma regra de pontuacao vive aqui. Os pesos, as faixas e os criterios sao calculados
//     no BACKEND e chegam prontos (services/ligacao-prioridade.js, lead-interest-score.js,
//     lead-score-cadastro.js). Este arquivo TRADUZ veredito, igual a `lib/site-rotulos.js`.
//
// As duas variantes existem porque as pontuacoes apontam em DIRECOES OPOSTAS sobre o mesmo
// lead: site proprio DERRUBA a prioridade comercial (peso 0 em ligacao-prioridade.js) e SOMA
// 20 na completude do cadastro. Pintar completude com a paleta de prioridade diria ao operador
// exatamente o contrario do que ele deve entender — era o defeito instalado na Aquisicao e no
// Banco de Leads, onde o melhor lead da campanha aparecia em vermelho.

/** Variantes semanticas. Cada uma responde a uma pergunta diferente sobre o lead. */
const VARIANTES = Object.freeze({
  /** "Quanto vale agir neste lead agora?" — maior = melhor. Ligacoes e Mensagens. */
  PRIORIDADE: 'prioridade_comercial',
  /** "Quanto da presenca digital deste negocio ja esta preenchida?" — NAO e' prioridade. */
  COMPLETUDE: 'completude_cadastro',
})

// Paleta de PRIORIDADE COMERCIAL: emerald = melhor. E' exatamente a da Central de Ligacoes,
// preservada classe a classe para que a extracao nao mude nada visivel naquela tela.
const PALETA_PRIORIDADE = Object.freeze({
  alta: 'border-emerald-500 text-emerald-700 bg-emerald-50',
  media: 'border-amber-400 text-amber-700 bg-amber-50',
  baixa: 'border-slate-300 text-slate-500 bg-slate-50',
})

// Paleta de COMPLETUDE: NEUTRA, de proposito. Completude nao e' prioridade comercial, entao
// nao pode reusar verde/vermelho — "cadastro fraco" costuma ser a MELHOR oportunidade nesta
// operacao. A unica coisa que a cor codifica aqui e' "mais preenchido = mais escuro", que e'
// monotonico e honesto. O que informa de verdade e' o numero + o rotulo em texto.
const PALETA_COMPLETUDE = Object.freeze({
  completo: 'border-slate-600 text-slate-800 bg-slate-100',
  parcial: 'border-slate-400 text-slate-700 bg-slate-50',
  incompleto: 'border-slate-300 text-slate-500 bg-white',
})

// Bolinha sem pontuacao calculada: vazada. Estado de primeira classe — nunca "0", que seria
// afirmar uma pontuacao que ninguem calculou.
const CLASSE_SEM_VALOR = 'border-dashed border-slate-300 text-slate-400 bg-white'

const PALETAS = Object.freeze({
  [VARIANTES.PRIORIDADE]: PALETA_PRIORIDADE,
  [VARIANTES.COMPLETUDE]: PALETA_COMPLETUDE,
})

// Central de Ligacoes fala 'alta/media/baixa'; Central de Mensagens fala 'alto/medio/baixo'.
// Sao a MESMA faixa dita no genero do substantivo de cada tela — normalizar aqui evita que a
// segunda tela caia silenciosamente no default e pinte tudo de cinza.
const SINONIMOS_FAIXA = Object.freeze({
  alta: 'alta', alto: 'alta', high: 'alta',
  media: 'media', medio: 'media', média: 'media', médio: 'media',
  baixa: 'baixa', baixo: 'baixa', low: 'baixa',
})

/** Faixa canonica da variante, ou null quando a chave nao pertence a ela. */
function normalizarFaixa(variante, faixa) {
  const chave = String(faixa || '').trim().toLowerCase()
  if (!chave) return null
  if (variante === VARIANTES.COMPLETUDE) {
    return Object.prototype.hasOwnProperty.call(PALETA_COMPLETUDE, chave) ? chave : null
  }
  return SINONIMOS_FAIXA[chave] || null
}

/**
 * Classes da bolinha. `valor == null` ganha o estado vazado, e faixa desconhecida cai na
 * faixa mais BAIXA da variante — nunca na mais alta: inventar prioridade alta por engano
 * mandaria o operador trabalhar o lead errado.
 */
function classesDaBolinha(variante, faixa, valor) {
  if (valor == null) return CLASSE_SEM_VALOR
  const paleta = PALETAS[variante] || PALETA_PRIORIDADE
  const canonica = normalizarFaixa(variante, faixa)
  if (canonica && paleta[canonica]) return paleta[canonica]
  return variante === VARIANTES.COMPLETUDE ? paleta.incompleto : paleta.baixa
}

/** Numero inteiro dentro de [0, maximo], ou null quando nao ha pontuacao. */
function normalizarValor(valor, maximo = 100) {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return null
  const teto = typeof maximo === 'number' && Number.isFinite(maximo) && maximo > 0 ? maximo : 100
  return Math.max(0, Math.min(teto, Math.round(valor)))
}

/**
 * Texto do valor com o MAXIMO sempre explicito ("40/100", "30/60"). O maximo nao e' opcional
 * por decisao: o cadastro de Instagram vale ate 60, e exibir "30" sozinho ao lado de um lead
 * do Places faria 30/60 parecer pior que 40/100 quando e' o contrario.
 */
function textoValor(valor, maximo = 100) {
  const v = normalizarValor(valor, maximo)
  if (v == null) return 'nao calculada'
  return `${v}/${maximo}`
}

/** Rotulo curto do peso de um fator, com sinal quando ele existe. */
function textoPeso(fator) {
  if (!fator || fator.peso == null || fator.peso === '') return ''
  return String(fator.peso)
}

/**
 * Resumo em UMA string — vira `aria-label` e `title`. E' o unico caminho pelo qual um leitor
 * de tela recebe o conteudo do tooltip, entao ele carrega titulo, valor, o que a pontuacao
 * mede ALI e os fatores. Sem isto, a bolinha seria um numero sem contexto no leitor de tela.
 */
function resumoTextual({ titulo, valor, maximo = 100, oQueMede, fatores = [], nota } = {}) {
  const partes = []
  const cabeca = [titulo, textoValor(valor, maximo)].filter(Boolean).join(' · ')
  if (cabeca) partes.push(cabeca)
  if (oQueMede) partes.push(oQueMede)
  const itens = (fatores || [])
    .map((f) => [textoPeso(f), f && f.rotulo].filter(Boolean).join(' '))
    .filter(Boolean)
  if (itens.length) partes.push(itens.join('; '))
  if (nota) partes.push(nota)
  return partes.join(' — ')
}

// ─── Tradutores de fatores ────────────────────────────────────────────────────
// Cada pontuacao do backend tem um formato proprio de criterio. Traduzir aqui (e nao na tela)
// e' o que impede quatro versoes do mesmo `if (delta > 0)` espalhadas pelas paginas.

/**
 * Criterios de COMPLETUDE DE CADASTRO (`services/lead-score-cadastro.js`):
 * `{ chave, label, ok, pontos, pontos_possiveis }`. O que falta aparece com o quanto valeria —
 * e' a lacuna que a proposta comercial ataca, entao ela e' informacao, nao ausencia.
 *
 * O criterio `site` recebe tratamento PROPRIO porque a coluna "Site" saiu da tabela e este
 * balao passou a ser onde a tese comercial da operacao e' lida. O criterio do backend e'
 * booleano (tem/nao tem), mas o negocio distingue TRES situacoes, e confundir duas delas foi
 * um defeito real deste projeto: "nao tem site" (a oportunidade) nao e' "ninguem verificou"
 * (um link duvidoso que ainda pode ser site). O `contexto` traz `situacao_site` — o mesmo
 * veredito de 3 estados que o backend ja publica — e o rotulo passa a dize-lo por extenso.
 * Sem contexto, cai no comportamento antigo: nada quebra em quem nao passa o 2o argumento.
 */
const ROTULO_SITE_POR_SITUACAO = Object.freeze({
  tem_site: 'Tem site próprio',
  sem_site: 'Sem site próprio',
  nao_identificado: 'Site não verificado',
})

function rotuloDoCriterioSite(criterio, contexto) {
  const situacao = contexto && contexto.situacaoSite
  const base = ROTULO_SITE_POR_SITUACAO[situacao] || String(criterio.label)
  // Qualifica o que existe no lugar do site ("só rede social", "só agregador"). E' o que
  // explica, dentro do balao, por que um lead COM link aparece como sem site.
  // Só em `sem_site`: em `nao_identificado` o rótulo do link é literalmente "verificar", que
  // repetiria o que a frase já diz.
  const tipoLink = contexto && contexto.rotuloLink
  if (situacao === 'sem_site' && tipoLink && tipoLink !== 'site') return `${base} — só ${tipoLink}`
  return base
}

function fatoresDeCadastro(criterios, contexto = null) {
  return (Array.isArray(criterios) ? criterios : [])
    .filter((c) => c && c.label)
    .map((c) => {
      const rotulo = c.chave === 'site' ? rotuloDoCriterioSite(c, contexto) : String(c.label)
      return c.ok
        ? { rotulo, peso: '✓', sinal: 'positivo' }
        : { rotulo, peso: `✗ (+${Number(c.pontos_possiveis) || 0})`, sinal: 'ausente' }
    })
}

/**
 * Criterios de INTERESSE COMERCIAL (`services/lead-interest-score.js`):
 * `{ delta, titulo, detalhe, tipo }`. O delta NEGATIVO e' a informacao mais valiosa da lista —
 * e' o que separa "38 porque nunca engajou" de "38 porque engajou e depois recusou".
 */
function fatoresDeInteresse(criterios) {
  return (Array.isArray(criterios) ? criterios : [])
    .filter((c) => c && c.titulo)
    .map((c) => {
      const delta = Number(c.delta) || 0
      return {
        rotulo: String(c.titulo),
        // Menos tipografico (−, U+2212), nao hifen: alinha com os digitos e o leitor de tela
        // anuncia "menos".
        peso: delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : '0',
        sinal: delta > 0 ? 'positivo' : delta < 0 ? 'negativo' : 'neutro',
        detalhe: c.detalhe ? String(c.detalhe) : undefined,
      }
    })
}

/**
 * Motivos de PRIORIDADE DE LIGACAO (`services/ligacao-prioridade.js`): lista de frases prontas,
 * sem peso separado. Preservado como esta' — a Central de Ligacoes nao pode mudar.
 */
function fatoresDeMotivos(motivos) {
  return (Array.isArray(motivos) ? motivos : [])
    .filter((m) => m != null && String(m).trim())
    .map((m) => ({ rotulo: String(m).trim(), sinal: 'neutro' }))
}

// ─── Leitura de completude ────────────────────────────────────────────────────

/**
 * Traduz a pontuacao de cadastro em faixa + titulo, RESPEITANDO O MAXIMO da origem (Places 100,
 * Instagram 60). Os cortes sao proporcionais (70% / 40%) justamente para as duas escalas serem
 * lidas do mesmo jeito.
 *
 * O titulo diz "completo/parcial/incompleto" — NUNCA "alta/baixa". Cadastro incompleto e' o
 * lead mais interessante desta operacao, e chama-lo de "baixo" empurraria o operador a
 * descarta-lo. A ordenacao padrao da Aquisicao (`pontos ASC`) ja assume isso.
 */
function leituraCadastro(valor, maximo = 100, criterios = []) {
  const teto = typeof maximo === 'number' && Number.isFinite(maximo) && maximo > 0 ? maximo : 100
  const v = normalizarValor(valor, teto)
  const lacunas = (Array.isArray(criterios) ? criterios : []).filter((c) => c && !c.ok).length
  if (v == null) {
    return { faixa: null, titulo: 'Cadastro não avaliado', lacunas: 0, maximo: teto }
  }
  const proporcao = v / teto
  const faixa = proporcao >= 0.7 ? 'completo' : proporcao >= 0.4 ? 'parcial' : 'incompleto'
  const rotulo = { completo: 'Cadastro completo', parcial: 'Cadastro parcial', incompleto: 'Cadastro incompleto' }[faixa]
  const titulo = lacunas > 0 ? `${rotulo} · ${lacunas} lacuna${lacunas > 1 ? 's' : ''}` : rotulo
  return { faixa, titulo, lacunas, maximo: teto }
}

/**
 * Frase fixa de rodape da variante completude. E' o que impede a bolinha de mentir: sem ela,
 * uma bolinha "fraca" seria lida como lead ruim, quando nesta operacao e' o oposto. Texto de
 * APRESENTACAO, nao regra — nada no backend depende dele.
 */
const NOTA_COMPLETUDE = 'Cadastro fraco costuma ser a melhor oportunidade nesta operação.'

// ─── Forma do balao ──────────────────────────────────────────────────────────

/**
 * A partir de quantos fatores o balao passa a listar em DUAS COLUNAS.
 *
 * Por que existe: a completude do Places tem 9 criterios e a do Instagram tem 6. Em coluna
 * unica isso vira um balao alto o bastante para nao caber acima da ancora — foi o que o
 * operador viu na Central de Mensagens, onde a bolinha fica no cabecalho de um modal colado
 * no topo da tela. Virar para baixo resolveu o corte; duas colunas resolvem a ALTURA.
 *
 * O corte e' 6 e nao 4: com 4 ou 5 itens a coluna dupla economiza duas linhas e custa o dobro
 * de largura, o que atrapalha mais do que ajuda. Prioridade de ligacao e interesse costumam
 * ter poucos fatores e seguem em coluna unica.
 *
 * Mora aqui, e nao no componente, pelo mesmo motivo do resto deste modulo: e' uma decisao de
 * apresentacao com regra, e regra tem teste.
 */
const MIN_FATORES_DUAS_COLUNAS = 6

function usaDuasColunas(quantidade) {
  const n = Number(quantidade)
  return Number.isFinite(n) && n >= MIN_FATORES_DUAS_COLUNAS
}

/** Frase obrigatoria de "o que esta pontuacao mede", por contexto de tela. */
const O_QUE_MEDE = Object.freeze({
  prioridade_ligacao: 'Quanto vale ligar para este negócio agora, nesta campanha.',
  interesse_conversa: 'O que o lead demonstrou nas mensagens dele.',
  cadastro_places: 'Quanto da presença digital deste negócio já está preenchida no Google.',
  cadastro_instagram: 'Quanto do cadastro deste perfil do Instagram já está preenchido.',
})

module.exports = {
  VARIANTES,
  PALETAS,
  CLASSE_SEM_VALOR,
  NOTA_COMPLETUDE,
  O_QUE_MEDE,
  MIN_FATORES_DUAS_COLUNAS,
  usaDuasColunas,
  normalizarFaixa,
  normalizarValor,
  classesDaBolinha,
  textoValor,
  resumoTextual,
  fatoresDeCadastro,
  ROTULO_SITE_POR_SITUACAO,
  fatoresDeInteresse,
  fatoresDeMotivos,
  leituraCadastro,
}
