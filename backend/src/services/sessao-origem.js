'use strict'
// ORIGEM DA SESSAO — de qual aparelho/sessao partiu uma acao. Modulo PURO: sem banco, HTTP,
// IA ou rede (usa apenas `node:crypto`, que e' calculo local).
//
// O problema que ele resolve: a mesma conta usada em dois aparelhos ao mesmo tempo (o
// operador liga pelo celular e olha a fila no computador). `req.usuario` responde QUEM, e
// so'. O JWT deste projeto nao tem `jti` e nada distingue duas abas, dois navegadores ou dois
// aparelhos do mesmo usuario — entao "voce ja esta nesta ligacao" nao conseguia dizer se era
// nesta tela ou no outro aparelho, e a auditoria de inicio/fim/encerramento/descarte nao
// conseguia separar as duas sessoes.
//
// REGRAS QUE ESTE MODULO ENCARNA (e o motivo de cada uma):
//
// 1) A chave e' OPACA e vem do CLIENTE, e por isso NAO e' credencial. Ela nao autentica
//    nada — quem autentica e' o Bearer token. Ela so' separa sessoes de um usuario que ja'
//    passou pela autenticacao. Trata-la como segredo seria fingir uma garantia que ela nao
//    da'; trata-la como identidade seria pior ainda.
//
// 2) O que se PERSISTE nunca e' a chave, e sim uma IMPRESSAO (prefixo de SHA-256). Se o
//    registro de auditoria vazar, o que sai e' um valor curto e nao reversivel, inutil para
//    se passar por aquela sessao noutro lugar. A comparacao "mesma sessao?" continua
//    funcionando porque a impressao e' deterministica.
//
// 3) NENHUMA identificacao invasiva e' derivada. Nada de IP, User-Agent, fingerprint de
//    canvas, id de hardware ou geolocalizacao. O aparelho e' declarado pelo cliente numa
//    lista FECHADA de duas palavras (`computador` | `celular`) — e' a informacao que o
//    operador usa ("foi no celular"), e nao permite reidentificar pessoa alguma.
//
// 4) A impressao NUNCA sai numa rota. O que a API publica e' o booleano `mesma_sessao` e a
//    palavra do aparelho. Devolver a impressao criaria um identificador correlacionavel entre
//    telas sem nenhum ganho operacional.
//
// 5) Origem AUSENTE e' um terceiro estado legitimo (`null`), nunca um valor padrao. Cliente
//    antigo, requisicao de outro consumidor ou linha gravada antes desta entrega ficam com
//    "origem nao registrada" — inventar `computador` ali faria a auditoria afirmar um fato
//    que ninguem observou.

const crypto = require('node:crypto')

/** Cabecalhos em que a sessao viaja. Nomes proprios: nada aqui reusa header de autenticacao. */
const HEADER_CHAVE = 'x-sessao-origem'
const HEADER_DISPOSITIVO = 'x-sessao-dispositivo'

/**
 * Classes de aparelho aceitas. Lista FECHADA de propósito — `celular` cobre qualquer
 * aparelho de toque (inclui tablet), porque a distincao que o operador faz e' "o aparelho que
 * esta na minha mao" contra "a maquina na mesa". Ampliar isto e' mudanca de vocabulario, nao
 * detalhe de implementacao.
 */
const DISPOSITIVOS = Object.freeze(['computador', 'celular'])

/** Tamanho da impressao guardada (hex). Curto o bastante para nao virar token utilizavel. */
const TAMANHO_IMPRESSAO = 12

// A chave e' texto de cliente: limita-se charset e tamanho ANTES de qualquer uso, para nao
// carregar lixo (ou payload de outro formato) ate o hash.
const RE_CHAVE = /^[A-Za-z0-9_-]{16,128}$/

/** Normaliza a chave crua recebida do cliente. Fora do formato => null (sem origem). */
function normalizarChaveSessao(valor) {
  if (typeof valor !== 'string') return null
  const v = valor.trim()
  return RE_CHAVE.test(v) ? v : null
}

/** Normaliza a classe de aparelho. Palavra fora da lista fechada => null. */
function normalizarDispositivo(valor) {
  if (typeof valor !== 'string') return null
  const v = valor.trim().toLowerCase()
  return DISPOSITIVOS.includes(v) ? v : null
}

/**
 * Impressao NAO REVERSIVEL da sessao — o unico formato em que a origem e' persistida.
 * Chave invalida/ausente devolve null (origem nao registrada), nunca uma impressao de vazio:
 * senao todas as requisicoes sem cabecalho pareceriam a MESMA sessao.
 */
function impressaoSessao(chave) {
  const c = normalizarChaveSessao(chave)
  if (!c) return null
  return crypto.createHash('sha256').update(c).digest('hex').slice(0, TAMANHO_IMPRESSAO)
}

/**
 * Origem de uma requisicao, a partir dos cabecalhos. Devolve sempre o mesmo formato
 * ({ impressao, dispositivo }), com null onde nao houver prova — o chamador nunca precisa
 * decidir o que fazer com "meio informado".
 */
function lerOrigemSessao(headers) {
  const h = headers || {}
  return {
    impressao: impressaoSessao(h[HEADER_CHAVE]),
    dispositivo: normalizarDispositivo(h[HEADER_DISPOSITIVO]),
  }
}

/**
 * A acao partiu DESTA mesma sessao?
 *
 * Devolve `null` (nao `false`) quando falta a impressao de um dos lados. A diferenca importa:
 * `false` faz a tela dizer "isso aconteceu em outro aparelho" e ate' avisar o operador, e
 * afirmar isso sem saber seria mentira. `null` significa "nao da' para dizer", e quem consome
 * trata como duvida.
 */
function mesmaSessao(impressaoA, impressaoB) {
  if (!impressaoA || !impressaoB) return null
  return String(impressaoA) === String(impressaoB)
}

/**
 * Bloco de origem para o `contexto` de `app.auditoria_eventos` (JSONB livre — nenhuma
 * migration foi necessaria). Sai a IMPRESSAO (nunca a chave) e a palavra do aparelho.
 *
 * Sem origem alguma devolve `null`, e nao `{}`: o registro fica com o contexto NULO em vez de
 * ganhar um objeto vazio ou campos nulos que sugeririam medicao onde nao houve. `extra`
 * permite ao chamador juntar o que ja auditava (ex.: o motivo do descarte) sem montar o
 * objeto por fora e arriscar esquecer a origem.
 */
function contextoAuditoria(origem, extra = null) {
  const o = origem || {}
  const out = { ...(extra || {}) }
  if (o.impressao) out.sessao_origem = o.impressao
  if (o.dispositivo) out.sessao_dispositivo = o.dispositivo
  return Object.keys(out).length ? out : null
}

module.exports = {
  HEADER_CHAVE, HEADER_DISPOSITIVO, DISPOSITIVOS, TAMANHO_IMPRESSAO,
  normalizarChaveSessao, normalizarDispositivo, impressaoSessao,
  lerOrigemSessao, mesmaSessao, contextoAuditoria,
}
