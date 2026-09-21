'use strict'
// Variacoes plausiveis de um telefone BR. Modulo PURO: sem banco, sem HTTP, sem rede.
//
// Por que existe: `candidatosTelefoneBR` nasceu dentro de `src/prospecting.js` (4.5k linhas,
// que registra rotas e workers ao ser importado). O casamento conversa<->prospect por telefone
// passou a ser necessario tambem em `src/db/lead-nome-maps.js`, e importar `prospecting.js` de
// dentro da camada de dados criaria ciclo. A funcao foi MOVIDA para ca sem alteracao de
// comportamento; `prospecting.js` a consome daqui. Nao existe segunda copia.
//
// Escopo declarado: este modulo NAO unifica a normalizacao de telefone do repositorio — ela
// segue espalhada, como registra docs/PENDENCIA_ARQUITETURAL_CENTRAL_LIGACOES_E_MENSAGENS.md.
// Aqui so' vive a geracao de candidatos, que era o unico trecho com dois donos.

function somenteDigitos(valor) {
  return String(valor == null ? '' : valor).replace(/\D/g, '')
}

/**
 * Gera as variações plausíveis de um número BR (só dígitos) para casar telefones
 * armazenados em formatos diferentes: com/sem 9º dígito móvel e com/sem prefixo 55.
 * Usado no match prospect↔webhook, onde o JID nem sempre bate exato com o telefone
 * vindo do Places. Match por igualdade em QUALQUER candidato.
 */
function candidatosTelefoneBR(numero) {
  let d = somenteDigitos(String(numero == null ? '' : numero).replace(/@s\.whatsapp\.net$/i, ''))
  if (!d) return []
  if (d.length >= 10 && d.length <= 11 && !d.startsWith('55')) d = `55${d}`
  const set = new Set([d])
  if (d.length === 13 && d.charAt(4) === '9') set.add(d.slice(0, 4) + d.slice(5)) // remove 9º dígito
  if (d.length === 12) set.add(`${d.slice(0, 4)}9${d.slice(4)}`)                   // adiciona 9º dígito
  for (const v of [...set]) if (v.startsWith('55')) set.add(v.slice(2))            // variante sem 55
  return [...set].filter(Boolean)
}

/**
 * A expressao SQL que normaliza uma coluna de telefone para COMPARACAO.
 *
 * So' digitos, removendo o DDI `55` quando presente (`length >= 12`) — e' o que casa
 * `prospectador.prospects.telefone` (em geral sem 55) com `vendas.conversas.numero` (JID com 55)
 * sem corromper numero de DDD 55.
 *
 * MOVIDA de `src/routes/api-banco-leads.js` (onde se chamava `normFone`), pelo mesmo motivo de
 * `candidatosTelefoneBR`: o casamento lead<->conversa/agenda por telefone passou a ser necessario
 * fora daquela rota (`db/lead-distribuicao.js`), e uma segunda copia da expressao divergiria em
 * silencio — a listagem continuaria certa e a distribuicao passaria a proteger o lead errado.
 * **Movida, nao duplicada**: comportamento identico, e `api-banco-leads.js` a consome daqui.
 *
 * @param {string} col  a coluna/expressao SQL (ja' qualificada pelo chamador).
 */
function sqlTelefoneNormalizado(col) {
  const digitos = `regexp_replace(COALESCE(${col}, ''), '[^0-9]', '', 'g')`
  return `(CASE WHEN length(${digitos}) >= 12 AND left(${digitos}, 2) = '55' THEN substr(${digitos}, 3) ELSE ${digitos} END)`
}

module.exports = { somenteDigitos, candidatosTelefoneBR, sqlTelefoneNormalizado }
