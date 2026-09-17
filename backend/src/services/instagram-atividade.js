'use strict'
// Atividade do Instagram do lead — o negocio ainda da' sinal de vida naquele perfil?
//
// MODULO PURO: sem banco, sem HTTP, sem IA, sem rede. Recebe o registro CRU que o dataset de
// perfil devolveu e responde uma faixa, com a evidencia que a sustenta.
//
// OS NOMES DE CAMPO AQUI FORAM VISTOS, NAO CHUTADOS. Eles vem da sonda de 2026-09-17
// (`npm run instagram:sonda`, 1 credito, snapshot `sd_mu4s0dte1kezq4wylo`), cujo registro cru
// esta' preservado. Isto e' deliberado: em 2026-09-16 o adaptador do Maps chutou quatro grafias
// de `latest_review_date`, 200 coletas foram pagas e zero trouxeram data (Decisao 1 em
// `docs/ai-decision-log.md`). A regra que saiu dali e' "nao se escreve leitor de campo que
// ninguem viu", e este arquivo so' existe porque alguem viu.
//
// O QUE A SONDA MOSTROU, e que muda o custo do projeto inteiro: o dataset de PERFIL ja' devolve
// `posts_count` e um array `posts`, cada um com `datetime`. Nao ha' etapa separada de posts, e
// medir atividade nao custa credito nenhum alem do perfil que ja' seria raspado.
//
// A REGRA QUE GOVERNA O MODULO: ausencia de dado nunca vira "inativo". O sistema so' afirma que
// um negocio esta' parado quando a fonte declarou uma data; em qualquer outro caso ele diz
// `nao_verificado` e cala. Chamar um lead de inativo por falta de dado e' pior que nao saber —
// e' mandar o vendedor descartar quem talvez esteja vendendo bem.

/**
 * As faixas. Vocabulario do operador (2026-09-16), nao o da analise — `atividade_morna` e
 * `atividade_antiga` dizem o que o vendedor precisa ouvir melhor que "ativo_moderado".
 *
 * `sem_posts` e `nao_verificado` sao ESTADOS DIFERENTES e a diferenca e' cara: o primeiro e' a
 * fonte declarando `posts_count = 0` (informacao de negocio real — perfil aberto e vazio); o
 * segundo e' nao ter como saber. Colapsar os dois faria o perfil privado, o erro de rede e o
 * contrato incompleto virarem todos "nao posta nada".
 */
const ATIVIDADE = Object.freeze({
  ATIVO_RECENTE: 'ativo_recente',
  ATIVIDADE_MORNA: 'atividade_morna',
  ATIVIDADE_ANTIGA: 'atividade_antiga',
  SEM_POSTS: 'sem_posts',
  NAO_VERIFICADO: 'nao_verificado',
})
const ATIVIDADES = Object.freeze(Object.values(ATIVIDADE))

/** Por que nao deu para verificar. Vira rotulo na tela — nunca "sem atividade". */
const MOTIVO_NAO_VERIFICADO = Object.freeze({
  SEM_REGISTRO: 'sem_registro',           // nada chegou da fonte
  PERFIL_PRIVADO: 'perfil_privado',       // existe, e' fechado: nao da' para ver post
  SEM_DATA: 'sem_data',                   // vieram posts, nenhum com data legivel
  CONTRATO_DESCONHECIDO: 'contrato_desconhecido', // registro sem os campos esperados
})

/**
 * Os cortes, em dias. Defaults da §11.E da analise; o operador nao fixou outros.
 * Ficam como PARAMETRO e nao como variavel de ambiente: sao regra de negocio por operacao, e
 * uma env seria global para todos os tenants.
 */
const CORTES_PADRAO = Object.freeze({ recente: 30, morno: 90 })

/**
 * Quantos posts sao LIDOS para medir a recencia.
 *
 * O operador pediu "no maximo os 5 primeiros" quando ainda se acreditava que cada post custaria
 * um credito. A sonda derrubou essa premissa — os posts vem juntos do perfil, de graca —, entao
 * hoje este numero e' so' uma escolha de leitura, e subi-lo nao custa nada. Mantido em 5 por ser
 * o que foi pedido; o registro cru guarda todos, entao mudar de ideia nao exige recoletar.
 */
const MAX_POSTS_ANALISADOS = 5

function texto(valor) {
  return String(valor == null ? '' : valor).trim()
}

/**
 * Le uma data de um valor. Aceita ISO, epoch em segundos e epoch em milissegundos — as tres
 * formas que a sonda poderia ter encontrado. O dataset usa ISO (`2026-09-16T00:00:00.000Z`); as
 * outras duas ficam por tolerancia, nao por suposicao, e nenhuma delas INVENTA data: valor
 * ilegivel devolve null e o chamador trata como "nao sei".
 */
function lerData(valor) {
  if (valor == null || valor === '') return null
  if (typeof valor === 'number') {
    const ms = valor > 1e12 ? valor : valor > 1e9 ? valor * 1000 : NaN
    if (!Number.isFinite(ms)) return null
    const d = new Date(ms)
    return Number.isFinite(d.getTime()) ? d : null
  }
  const t = Date.parse(texto(valor))
  if (!Number.isFinite(t)) return null
  const d = new Date(t)
  const ano = d.getUTCFullYear()
  return ano >= 2005 && ano <= 2100 ? d : null
}

/**
 * A data do post mais recente entre os que foram lidos.
 *
 * MAXIMO, e nao `posts[0]`, e isso nao e' preciosismo: a sonda mostrou o array FORA DE ORDEM —
 * no perfil sondado, o indice 8 era 2026-08-14 enquanto o 9 era 2026-09-11 (post fixado no
 * topo). Confiar na ordem daria a data errada exatamente nos perfis que fixam post, que sao os
 * perfis de negocio.
 */
function dataDoPostMaisRecente(posts, limite = MAX_POSTS_ANALISADOS) {
  const lista = Array.isArray(posts) ? posts.slice(0, Math.max(0, limite)) : []
  let maior = null
  let lidos = 0
  for (const post of lista) {
    lidos += 1
    const d = lerData(post && post.datetime)
    if (d && (!maior || d > maior)) maior = d
  }
  return { data: maior, lidos }
}

function diasEntre(inicio, fim) {
  return Math.floor((fim.getTime() - inicio.getTime()) / 86400000)
}

function naoVerificado(motivo, extra = {}) {
  return {
    atividade: ATIVIDADE.NAO_VERIFICADO,
    motivo,
    ultimo_post_em: null,
    dias_desde_ultimo_post: null,
    posts_analisados: 0,
    posts_count: null,
    ...extra,
  }
}

/**
 * Classifica a atividade a partir do registro CRU do perfil.
 *
 * Nunca lanca: registro estranho vira `nao_verificado` com motivo. Um classificador que quebra
 * derrubaria o worker inteiro por causa de um perfil malformado, e o preco de um perfil
 * malformado deve ser "nao sei sobre ESTE lead", nunca "a fila parou".
 */
function classificarAtividade(registro, { agora = new Date(), cortes = CORTES_PADRAO,
  maxPosts = MAX_POSTS_ANALISADOS } = {}) {
  if (!registro || typeof registro !== 'object') {
    return naoVerificado(MOTIVO_NAO_VERIFICADO.SEM_REGISTRO)
  }

  const temPosts = Array.isArray(registro.posts)
  const contagem = Number.isFinite(registro.posts_count) ? Number(registro.posts_count) : null

  // Registro que nao traz NENHUM dos campos que a sonda confirmou nao e' um perfil vazio: e' um
  // contrato diferente do que foi visto (dataset trocado, registro de erro, versao nova). Dizer
  // "sem posts" aqui seria afirmar sobre o negocio uma conclusao tirada de um defeito nosso.
  if (!temPosts && contagem === null) {
    return naoVerificado(MOTIVO_NAO_VERIFICADO.CONTRATO_DESCONHECIDO)
  }

  // Perfil fechado existe e pode ser muito ativo — so' nao da' para ver. E' o caso mais obvio de
  // "ausencia de prova nao e' prova de ausencia" neste modulo.
  if (registro.is_private === true) {
    return naoVerificado(MOTIVO_NAO_VERIFICADO.PERFIL_PRIVADO, { posts_count: contagem })
  }

  // A fonte DECLAROU zero. Isso e' resposta, nao lacuna — e e' informacao comercial legitima:
  // perfil aberto e sem nenhuma publicacao.
  if (contagem === 0) {
    return {
      atividade: ATIVIDADE.SEM_POSTS,
      motivo: null,
      ultimo_post_em: null,
      dias_desde_ultimo_post: null,
      posts_analisados: 0,
      posts_count: 0,
    }
  }

  const { data, lidos } = dataDoPostMaisRecente(registro.posts, maxPosts)
  if (!data) {
    return naoVerificado(MOTIVO_NAO_VERIFICADO.SEM_DATA, { posts_count: contagem })
  }

  const dias = Math.max(0, diasEntre(data, agora instanceof Date ? agora : new Date(agora)))
  const recente = Number(cortes && cortes.recente) || CORTES_PADRAO.recente
  const morno = Number(cortes && cortes.morno) || CORTES_PADRAO.morno
  const atividade = dias <= recente
    ? ATIVIDADE.ATIVO_RECENTE
    : dias <= morno
      ? ATIVIDADE.ATIVIDADE_MORNA
      : ATIVIDADE.ATIVIDADE_ANTIGA

  return {
    atividade,
    motivo: null,
    ultimo_post_em: data.toISOString(),
    dias_desde_ultimo_post: dias,
    posts_analisados: lidos,
    posts_count: contagem,
  }
}

/**
 * O que o perfil raspado prova sobre o VINCULO com o lead.
 *
 * Existe porque o credito ja' foi gasto: o mesmo registro que mede atividade traz `biography` e
 * `external_urls`, e sao eles que carregam telefone e site — as duas provas FORTES que a busca
 * por texto nao tinha (`instagram-perfil.js`). E' o que converte um `candidato` em `confirmado`
 * (ou em descartado) sem ocupar uma pessoa.
 *
 * Devolve o material no formato que `avaliarCandidato` ja' consome — titulo/resumo —, de
 * proposito: a REGRA de prova continua morando num lugar so'. Duplicar aqui a comparacao de
 * telefone e site faria duas reguas divergirem.
 */
function textoDeProva(registro) {
  if (!registro || typeof registro !== 'object') return null
  const urls = []
  for (const u of Array.isArray(registro.external_url) ? registro.external_url : []) {
    if (texto(u)) urls.push(texto(u))
  }
  for (const item of Array.isArray(registro.external_urls) ? registro.external_urls : []) {
    if (item && texto(item.url)) urls.push(texto(item.url))
  }
  const titulo = [registro.profile_name, registro.full_name, registro.account]
    .map(texto).filter(Boolean).join(' ')
  const resumo = [texto(registro.biography), ...new Set(urls)].filter(Boolean).join(' ')
  if (!titulo && !resumo) return null
  return {
    handle: texto(registro.account) || null,
    url: texto(registro.profile_url) || texto(registro.url) || null,
    titulo,
    resumo,
  }
}

/** O perfil existe de verdade? Registro sem `account` nao e' perfil — e' erro ou vazio. */
function perfilExiste(registro) {
  return !!(registro && typeof registro === 'object' && texto(registro.account))
}

/** Seguidores, quando a fonte informou. `null` = nao informado, nunca 0. */
function seguidoresDe(registro) {
  const n = registro && Number(registro.followers)
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null
}

module.exports = {
  ATIVIDADE,
  ATIVIDADES,
  MOTIVO_NAO_VERIFICADO,
  CORTES_PADRAO,
  MAX_POSTS_ANALISADOS,
  lerData,
  dataDoPostMaisRecente,
  classificarAtividade,
  textoDeProva,
  perfilExiste,
  seguidoresDe,
}
