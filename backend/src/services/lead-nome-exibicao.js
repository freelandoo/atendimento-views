'use strict'
// Nome de EXIBICAO de um lead — dono unico da ordem de prioridade entre as fontes de nome.
// Modulo PURO: sem banco, sem HTTP, sem IA, sem rede.
//
// Por que existe: a coluna "Lead" da Central de Mensagens mostrava o TELEFONE quando nao havia
// nome — o mesmo dado que ja esta na coluna "Telefone", ao lado. Era o telefone ocupando o
// campo de nome, e o campo de nome afirmando algo que nao e' nome.
//
// Regra de negocio: o campo de nome contem SOMENTE um nome identificado. Sem nome valido em
// nenhuma fonte, ele fica VAZIO — nunca um traco, nunca o telefone. Quem exibe o telefone e'
// a coluna do telefone, e so' ela.
//
// A ordem vive AQUI e em nenhum outro lugar: nem em SQL, nem em componente de tela. A rota
// devolve `nome_exibicao` + `nome_exibicao_fonte` ja resolvidos e o front apenas desenha o
// veredito — mesmo padrao de `site-classificacao.js` / `lib/site-rotulos.js`.

/** De onde saiu o nome que esta na tela. Vocabulario fechado. */
const FONTES = {
  WHATSAPP: 'whatsapp',
  GOOGLE_MAPS: 'google_maps',
}

/**
 * Ordem de prioridade, de cima para baixo. Cada item diz de qual campo do agregado o nome
 * sai e qual FONTE ele representa.
 *
 * Esta e' a coluna do nome AUTOMATICO: o que o proprio canal e a coleta ja sabem sobre o
 * contato, sem ninguem digitar nada. Decisao do operador (2026-08-10).
 *
 * 1. `nome_whatsapp` — o pushName CRU, preservado como veio (migration
 *    065_conversa_nome_whatsapp.sql). Ele NAO passa pelo filtro de `nome-contato.js`, que so'
 *    fica com o primeiro token e recusa palavras de negocio: por aquele caminho "Pizzaria do
 *    Ze" era descartado INTEIRO. E' justamente o nome comercial que interessa aqui.
 * 2. `nome_maps` — `prospectador.prospects.nome`, casado por telefone normalizado dentro da
 *    MESMA empresa (`src/db/lead-nome-maps.js`).
 *
 * `lead_profiles.negocio` e `lead_profiles.apelido` NAO estao nesta lista, de proposito: sao
 * nome CURADO (extraido da conversa pela IA / filtrado por `nome-contato.js`), e esta coluna
 * mostra o nome automatico do canal. Consequencia declarada e aceita: um lead com `negocio`
 * preenchido e pushName invalido fica com a coluna Lead vazia. Apelido e edicao manual de
 * nome estao fora do escopo desta etapa.
 */
const ORDEM_FONTES = [
  { campo: 'nome_whatsapp', fonte: FONTES.WHATSAPP },
  { campo: 'nome_maps', fonte: FONTES.GOOGLE_MAPS },
]

// Teto de tamanho do que vai para a tela. O valor cru e' preservado no banco; aqui so' se
// evita que um pushName gigante quebre a linha da tabela.
const MAX_NOME = 120

/**
 * Texto generico NAO e' nome: e' o preenchimento automatico de quem nao sabia o nome.
 * A comparacao e' com a string INTEIRA, nunca por token — senao "Pizzaria do Ze" (um nome
 * legitimo de negocio) seria recusado por causa da primeira palavra.
 */
const GENERICOS = new Set([
  'cliente', 'lead', 'contato', 'usuario', 'usuaria', 'whatsapp', 'zap',
  'atendimento', 'suporte', 'comercial', 'vendas', 'sem nome', 'nao informado',
  'desconhecido', 'anonimo', 'teste', 'test', 'null', 'undefined', 'n/a', 'na',
])

function semAcentos(raw) {
  return String(raw == null ? '' : raw)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/**
 * Devolve o nome limpo, ou `null` quando o valor nao e' um nome.
 *
 * Recusa, nesta ordem: vazio/so-espacos, identificador tecnico do Evolution
 * (`…@s.whatsapp.net`, `…@lid`), telefone em qualquer formatacao, texto sem letra nenhuma
 * (o que cobre emoji e enfeite puro: emoji nao e' `\p{L}`), uma letra so' e texto generico.
 */
function nomeValido(valor) {
  const t = String(valor == null ? '' : valor).replace(/\s+/g, ' ').trim()
  if (!t) return null
  if (t.includes('@')) return null
  // "+55 (11) 99999-0001", "5511999990001" e "11 99999-0001" sao telefone, nao nome.
  if (/^\+?[\d\s()./-]+$/.test(t)) return null
  if (!/\p{L}/u.test(t)) return null
  // Uma letra so' nao identifica ninguem — e' o "A" que sobra de um pushName decorativo.
  if (t.replace(/[^\p{L}\p{N}]/gu, '').length < 2) return null
  if (GENERICOS.has(semAcentos(t).toLowerCase())) return null
  return t.length > MAX_NOME ? t.slice(0, MAX_NOME).trim() : t
}

/**
 * Resolve o nome que a tela mostra a partir das fontes disponiveis.
 *
 * @param {{nome_whatsapp?: any, nome_maps?: any}} fontes
 * @returns {{nome: string|null, fonte: string|null}} `nome` nulo = nenhuma fonte tinha nome
 *   valido; a coluna Lead fica VAZIA (nao inventa traco e nao usa o telefone).
 */
function resolverNomeExibicao(fontes) {
  const dados = fontes || {}
  for (const { campo, fonte } of ORDEM_FONTES) {
    const nome = nomeValido(dados[campo])
    if (nome) return { nome, fonte }
  }
  return { nome: null, fonte: null }
}

/**
 * Acopla `nome_exibicao` + `nome_exibicao_fonte` a uma linha de conversa ja carregada.
 * Usado pela rota nas DUAS leituras (listagem e detalhe), para nao existirem duas montagens
 * do mesmo veredito.
 */
function anexarNomeExibicao(conversa, nomeMaps) {
  const { nome, fonte } = resolverNomeExibicao({
    nome_whatsapp: conversa && conversa.nome_whatsapp,
    nome_maps: nomeMaps,
  })
  return { ...conversa, nome_exibicao: nome, nome_exibicao_fonte: fonte }
}

module.exports = {
  FONTES,
  ORDEM_FONTES,
  MAX_NOME,
  nomeValido,
  resolverNomeExibicao,
  anexarNomeExibicao,
}
