'use strict'
// Nome do Google Maps de um contato — `prospectador.prospects.nome`, casado por TELEFONE.
//
// Por que por telefone: nao existe FK entre `vendas.conversas` e `prospectador.prospects`.
// Sao dois mundos com chaves incompativeis (a conversa e' chaveada pelo JID; o prospect, por
// `place_id`), e o unico fato que os dois carregam sobre a mesma pessoa e' o numero. Mesma
// identidade que `app.follow_ups` ja usa: empresa + digitos do telefone.
//
// Por que UMA consulta por pagina, e nao um LEFT JOIN LATERAL na listagem: o casamento
// precisa aceitar as variacoes de formato do numero (com/sem 55, com/sem 9o digito), e essas
// variacoes se geram em JS (`candidatosTelefoneBR`). Um LATERAL teria de reproduzir a mesma
// regra em SQL — duas implementacoes do mesmo casamento, que divergem na primeira mudanca.
// Aqui sai UMA query com todos os candidatos da pagina, servida pelo indice funcional
// `idx_prospects_empresa_telefone_digitos` (migration 065).
//
// ATENCAO: a expressao do WHERE e' identica a expressao indexada. Mudar uma sem a outra faz o
// indice deixar de ser usado EM SILENCIO — a listagem continua correta e fica lenta.

const { candidatosTelefoneBR } = require('../telefone-br')

/**
 * @param {import('pg').Pool} pool
 * @param {{ empresaId: string, numeros: string[] }} params `numeros` sao os JIDs/telefones
 *   das conversas da pagina, como vieram do banco.
 * @returns {Promise<Map<string, string>>} numero original -> nome do Maps. Numero sem
 *   prospect correspondente simplesmente nao entra no mapa (ausencia, nunca string vazia).
 */
async function buscarNomesMapsPorTelefone(pool, { empresaId, numeros }) {
  const resultado = new Map()
  if (!pool || !empresaId || !Array.isArray(numeros) || numeros.length === 0) return resultado

  // Candidatos por conversa, e o conjunto achatado que vai para a consulta.
  const porNumero = new Map()
  const todos = new Set()
  for (const numero of numeros) {
    if (!numero || porNumero.has(numero)) continue
    const candidatos = candidatosTelefoneBR(numero)
    if (candidatos.length === 0) continue
    porNumero.set(numero, candidatos)
    for (const c of candidatos) todos.add(c)
  }
  if (todos.size === 0) return resultado

  const { rows } = await pool.query(
    `SELECT regexp_replace(COALESCE(p.telefone, ''), '\\D', '', 'g') AS telefone_digitos,
            p.nome,
            p.updated_at
       FROM prospectador.prospects p
      WHERE p.empresa_id = $1
        AND regexp_replace(COALESCE(p.telefone, ''), '\\D', '', 'g') = ANY($2::text[])
      ORDER BY p.updated_at DESC NULLS LAST`,
    [empresaId, [...todos]]
  )

  // ORDER BY DESC + "primeiro a chegar vence" = o prospect mais recente daquele telefone.
  const nomePorDigitos = new Map()
  for (const row of rows) {
    if (!row.telefone_digitos || nomePorDigitos.has(row.telefone_digitos)) continue
    nomePorDigitos.set(row.telefone_digitos, row.nome)
  }

  for (const [numero, candidatos] of porNumero) {
    for (const candidato of candidatos) {
      const nome = nomePorDigitos.get(candidato)
      if (nome) { resultado.set(numero, nome); break }
    }
  }
  return resultado
}

module.exports = { buscarNomesMapsPorTelefone }
