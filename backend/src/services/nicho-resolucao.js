'use strict'
// Resolucao de `prospectador.prospects.nicho_id` pelo texto observado em `prospects.nicho` —
// DONO UNICO da expressao de casamento. Mesma regra de `scripts/backfill-prospects-nicho.js`
// (decisao D1, docs/analise-equipes-por-nicho.md): correspondencia EXATA por nome dentro da
// empresa, nunca aproximada. Duas copias desta regra divergiriam na primeira mudanca — foi
// exatamente essa classe de defeito que fez "funilaria e pintura automotiva" aparecer duas vezes
// no raio-x do backfill em 2026-09-18 (um TRIM() sozinho nao pega quebra de linha).
//
// Sem banco, sem HTTP, sem IA: so devolve fragmentos de SQL. Quem executa e' quem importa.

// `TRIM()` do Postgres remove SO ESPACO — nao quebra de linha, nao CR, nao tab. O termo de busca
// da Aquisicao pode chegar com um desses no fim; sem cobri-los, dois leads com o MESMO nicho para
// uma pessoa virariam dois valores diferentes para o banco.
const BRANCOS = `chr(32)||chr(9)||chr(10)||chr(13)`
const limpo = (coluna) => `BTRIM(${coluna}, ${BRANCOS})`

/** A expressao de casamento nicho<->catalogo. Identica em toda leitura/gravacao que a usa. */
function sqlCasamentoNicho(colNicho, colNomeCatalogo) {
  return `lower(${limpo(colNomeCatalogo)}) = lower(${limpo(colNicho)})`
}

/**
 * Subquery que resolve `nicho_id` pelo texto, escopada pela EMPRESA da propria linha — nunca
 * casa nicho de um tenant com catalogo de outro. Devolve NULL quando nao ha correspondencia
 * exata: isto NAO e' erro, e' a decisao D1 ("nao se adivinha nicho") sendo respeitada por quem
 * grava, do mesmo jeito que ja era respeitada por quem so lia.
 *
 * @param {string} empresaCol coluna/placeholder com o `empresa_id` da linha sendo gravada.
 * @param {string} nichoCol   coluna/placeholder com o texto livre do nicho.
 */
function sqlResolverNichoId({ empresaCol, nichoCol }) {
  return `(SELECT n.id FROM app.nichos n
            WHERE n.empresa_id = ${empresaCol}
              AND ${sqlCasamentoNicho(nichoCol, 'n.nome')}
            LIMIT 1)`
}

module.exports = { BRANCOS, limpo, sqlCasamentoNicho, sqlResolverNichoId }
