'use strict'
/**
 * ORIGEM do lead — fonte ÚNICA do vocabulário, e do que cada valor significa para quem filtra.
 *
 * O QUE ESTE MÓDULO RESOLVE
 * A origem é a PORTA DE ENTRADA do lead na carteira, e ela estava escrita em quatro lugares que
 * não se conheciam:
 *   - a CHECK `prospects_origem_chk` (migration 091) — a única que o banco respeita;
 *   - `ORIGENS_VALIDAS` em routes/api-banco-leads.js, que **não conhecia `meta_ads`**: o filtro
 *     `?origem=meta_ads` não casava com nada e era ignorado em silêncio (devolvia a carteira
 *     inteira, como se o filtro não existisse);
 *   - `ORIGENS_PLACES` na mesma rota e em services/rodar-leads.js;
 *   - `ORIGENS_PLACES` de novo no fonte da tela, onde `!ORIGENS_PLACES.has(origem)` mandava
 *     **todo o resto** para uma tabela rotulada "Instagram" — então o lead de anúncio da Meta
 *     aparecia para o operador sob o título de outra fonte.
 *
 * ELE NÃO CLASSIFICA NADA. A origem já está gravada na coluna `prospects.origem`, escrita por
 * quem coletou o lead. Deduzi-la de `instagram_handle`, de `place_id` ou da URL do site seria
 * inventar procedência — e é justamente o que `site-classificacao.js` existe para NÃO fazer com
 * link. Aqui só se traduz e se agrupa o que o coletor já afirmou.
 *
 * GRUPO ≠ ORIGEM, de propósito. `places` reúne `manual` e `automatico` porque as duas entram
 * pela MESMA ficha do Google Maps (o cadastro manual copia os campos de lá) e por isso dividem a
 * régua de cadastro 0-100. `social` é ALIAS LEGADO de instagram+linkedin: ele já estava no
 * contrato da rota antes de a tela oferecer as fontes separadas, e removê-lo quebraria link
 * salvo e filtro guardado em sessão.
 *
 * Anti-drift: test/lead-origem.test.js lê a CHECK da migration 091 e falha se esta lista
 * divergir dela. Acrescentar origem nova exige os dois lados no MESMO diff.
 */

// Ordem espelha a CHECK `prospects_origem_chk` (sql/migrations/091_leads_meta_ads.sql).
const ORIGENS = Object.freeze(['manual', 'automatico', 'instagram', 'linkedin', 'meta_ads'])

// O que um valor de filtro alcança. Chave = o que a tela/URL manda; valor = as origens reais.
const GRUPOS = Object.freeze({
  places: Object.freeze(['manual', 'automatico']),
  // Alias legado: era a única forma de pedir "não-Places" antes de a Meta existir.
  social: Object.freeze(['instagram', 'linkedin']),
  instagram: Object.freeze(['instagram']),
  linkedin: Object.freeze(['linkedin']),
  meta_ads: Object.freeze(['meta_ads']),
})

// As origens que pontuam pela régua do Google Places (0-100). O resto usa a de Instagram (0-60).
const ORIGENS_PLACES = Object.freeze(new Set(GRUPOS.places))

/**
 * Traduz um valor de filtro (grupo OU origem isolada) na lista de origens que ele alcança.
 * Devolve `null` quando o valor não significa nada — e `null` é "sem filtro de origem", nunca
 * uma lista vazia: lista vazia produziria `origem = ANY('{}')`, que não casa com lead nenhum e
 * esvaziaria a carteira em vez de ignorar o filtro.
 */
function origensDoFiltro(valor) {
  const v = String(valor || '').trim().toLowerCase()
  if (!v) return null
  if (GRUPOS[v]) return [...GRUPOS[v]]
  if (ORIGENS.includes(v)) return [v]
  return null
}

/** A qual grupo de APRESENTAÇÃO uma origem pertence. Origem desconhecida não vira Instagram. */
function grupoDaOrigem(origem) {
  const v = String(origem || '').trim().toLowerCase()
  if (ORIGENS_PLACES.has(v)) return 'places'
  if (v === 'instagram') return 'instagram'
  if (v === 'linkedin') return 'linkedin'
  if (v === 'meta_ads') return 'meta_ads'
  return 'desconhecida'
}

/** `true` quando o lead pontua pela régua de cadastro do Google Places (0-100). */
function usaReguaPlaces(origem) {
  return ORIGENS_PLACES.has(String(origem || '').trim().toLowerCase())
}

module.exports = { ORIGENS, GRUPOS, ORIGENS_PLACES, origensDoFiltro, grupoDaOrigem, usaReguaPlaces }
