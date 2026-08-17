'use strict'
// ORIGEM DA SESSAO no cliente — a chave opaca que identifica ESTE aparelho/navegador (nunca a
// pessoa) e a classe grosseira de aparelho. E' o par que o backend transforma em auditoria e
// no booleano `mesma_sessao` (ver backend/src/services/sessao-origem.js, dono das regras).
//
// POR QUE ISTO EXISTE: a mesma conta e' usada no computador e no celular ao mesmo tempo. O
// token de autenticacao responde QUEM e nada mais — duas abas, dois navegadores e dois
// aparelhos do mesmo usuario sao indistinguiveis. Sem isso, "voce ja esta nesta ligacao" nao
// consegue dizer se e' nesta tela ou no outro aparelho, e a tela que descobre um encerramento
// remoto nao consegue explicar de onde ele veio.
//
// O QUE ESTE MODULO **NAO** FAZ, de proposito:
//   * nao coleta User-Agent, IP, fingerprint de canvas, id de hardware ou geolocalizacao;
//   * nao envia nada que identifique a PESSOA — a chave e' aleatoria e local;
//   * nao guarda a chave em cookie (nao acompanha requisicao que o operador nao fez).
//
// A chave vive no `localStorage`, e nao no `sessionStorage`, porque a unidade que o operador
// reconhece e' o APARELHO ("foi no celular"), nao a aba. Duas abas do mesmo computador sao a
// mesma origem — e e' isso que ele espera ouvir.
//
// A chave NAO e' credencial: ela nao autentica nada (quem autentica e' o Bearer token) e o
// backend nunca a guarda em claro — persiste so' uma impressao nao reversivel.

/** Chave do armazenamento local. Versionada: trocar o formato nao pode "herdar" valor velho. */
const CHAVE_STORAGE = 'sessaoOrigem.v1'

/** Classes de aparelho — lista FECHADA, espelhando a do backend. */
const DISPOSITIVOS = Object.freeze(['computador', 'celular'])

/** Cabecalhos em que a origem viaja. */
const HEADER_CHAVE = 'X-Sessao-Origem'
const HEADER_DISPOSITIVO = 'X-Sessao-Dispositivo'

/**
 * Gera uma chave opaca nova. 32 chars hex = 128 bits de aleatoriedade — colisao entre dois
 * aparelhos da mesma empresa e' irrelevante na pratica, e o valor nao carrega significado
 * nenhum (nao e' derivado de nada do aparelho nem da pessoa).
 *
 * `aleatorio` e' injetavel para o teste conseguir cobrar a FORMA sem depender do ambiente.
 */
function novaChaveSessao(aleatorio) {
  const rnd = aleatorio || ((n) => {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      return crypto.getRandomValues(new Uint8Array(n))
    }
    // Sem WebCrypto (contexto nao seguro): a chave so' precisa ser unica, nao imprevisivel —
    // ela nao protege nada. Degradar aqui e' melhor que ficar sem origem alguma.
    return Array.from({ length: n }, () => Math.floor(Math.random() * 256))
  })
  return Array.from(rnd(16), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Classe de aparelho a partir de UM sinal grosseiro: o ponteiro e' de toque?
 * `matchMedia('(pointer: coarse)')` responde sobre a forma de interagir, nao sobre modelo,
 * sistema ou identidade — e e' a distincao que o operador realmente faz. Tablet cai em
 * `celular` de proposito: "o aparelho que esta na minha mao".
 */
function classificarDispositivo(pontoDeToque) {
  return pontoDeToque ? 'celular' : 'computador'
}

/** Le a chave guardada, criando uma na primeira vez. Sem storage disponivel, devolve null. */
function chaveDaSessao() {
  if (typeof window === 'undefined') return null
  try {
    const atual = window.localStorage.getItem(CHAVE_STORAGE)
    if (atual) return atual
    const nova = novaChaveSessao()
    window.localStorage.setItem(CHAVE_STORAGE, nova)
    return nova
  } catch {
    // Modo privado / quota / storage bloqueado: a origem simplesmente nao e' registrada.
    // Ausencia e' estado legitimo dos dois lados — nunca um valor inventado.
    return null
  }
}

/**
 * Cabecalhos de origem para a requisicao. Sem storage ou fora do navegador, devolve `{}`:
 * o backend trata ausencia como "origem nao registrada" e nada quebra.
 */
function cabecalhosOrigem() {
  const chave = chaveDaSessao()
  if (!chave) return {}
  const toque = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? !!window.matchMedia('(pointer: coarse)').matches
    : false
  return { [HEADER_CHAVE]: chave, [HEADER_DISPOSITIVO]: classificarDispositivo(toque) }
}

module.exports = {
  CHAVE_STORAGE, DISPOSITIVOS, HEADER_CHAVE, HEADER_DISPOSITIVO,
  novaChaveSessao, classificarDispositivo, chaveDaSessao, cabecalhosOrigem,
}
