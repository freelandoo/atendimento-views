// @ts-check
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
/**
 * Versao RICA do casamento: alem do nome, traz `prospect_id`, `nicho` e `tem_whatsapp` do
 * prospect mais recente daquele telefone. Mesma consulta, mesmo indice — a Central de Mensagens
 * usa isto para filtrar por nicho/tem-WhatsApp sem um segundo casamento. Numero sem prospect
 * simplesmente nao entra no mapa (ausencia, nunca objeto vazio).
 *
 * @param {import('pg').Pool} pool
 * @param {{ empresaId: string, numeros: string[] }} params
 * @returns {Promise<Map<string, {prospect_id: string|null, nome: string|null, nicho: string|null, tem_whatsapp: boolean|null, status: string|null}>>}
 */
async function buscarDadosProspectPorTelefone(pool, { empresaId, numeros }) {
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
            p.id AS prospect_id, p.nome, p.nicho, p.tem_whatsapp, p.status,
            p.updated_at
       FROM prospectador.prospects p
      WHERE p.empresa_id = $1
        AND regexp_replace(COALESCE(p.telefone, ''), '\\D', '', 'g') = ANY($2::text[])
      ORDER BY p.updated_at DESC NULLS LAST`,
    [empresaId, [...todos]]
  )

  // ORDER BY DESC + "primeiro a chegar vence" = o prospect mais recente daquele telefone.
  const dadosPorDigitos = new Map()
  for (const row of rows) {
    if (!row.telefone_digitos || dadosPorDigitos.has(row.telefone_digitos)) continue
    dadosPorDigitos.set(row.telefone_digitos, {
      prospect_id: row.prospect_id,
      nome: row.nome,
      nicho: row.nicho,
      tem_whatsapp: row.tem_whatsapp,
      status: row.status,
    })
  }

  for (const [numero, candidatos] of porNumero) {
    for (const candidato of candidatos) {
      const dados = dadosPorDigitos.get(candidato)
      if (dados) { resultado.set(numero, dados); break }
    }
  }
  return resultado
}

/**
 * So o nome — o contrato historico, mantido intacto. Deriva da consulta rica para nao existirem
 * duas implementacoes do mesmo casamento (o unico ponto que divergiria na primeira mudanca).
 * Numero cujo prospect mais recente nao tem nome nao entra no mapa (mesmo comportamento de antes).
 * @returns {Promise<Map<string, string>>} numero original -> nome do Maps.
 */
async function buscarNomesMapsPorTelefone(pool, params) {
  const dados = await buscarDadosProspectPorTelefone(pool, params)
  const nomes = new Map()
  for (const [numero, d] of dados) {
    if (d && d.nome) nomes.set(numero, d.nome)
  }
  return nomes
}

module.exports = { buscarNomesMapsPorTelefone, buscarDadosProspectPorTelefone }
