'use strict'
// Lead parado (Operacao Comercial, Etapa 3) — acesso a dados.
// Regras PURAS em src/services/lead-parado.js; aqui so' ha LEITURA.
//
// ⚠️ ESTE ARQUIVO NAO ESCREVE NADA, E NAO DEVE PASSAR A ESCREVER. O operador decidiu que o
// sistema MARCA e AVISA, e que devolver o lead para a fila continua sendo ato humano
// (`db/lead-responsavel.js`). Um UPDATE aqui seria o sistema desfazendo sozinho uma atribuicao.
// Guarda de regressao em test/lead-parado.test.js falha em INSERT/UPDATE/DELETE.
//
// O recorte de leads e' o MESMO de `contagemPorResponsavel` (db/lead-responsavel.js):
// `qualificacao IN ('aprovado','legado')`. Um universo diferente faria a coluna "parados" nao
// fechar com a coluna "leads" da mesma linha da tela — e o admin passaria a ver 12 parados numa
// carteira de 8.

const P = require('../services/lead-parado')

/**
 * Quantos leads PARADOS cada pessoa tem. Uma linha por responsavel.
 *
 * Nao devolve linha para `responsavel_id IS NULL`: lead livre nao esta parado, esta na fila
 * (ver o cabecalho do modulo puro). A condicao ja garante isso; o GROUP BY so' nao teria como
 * produzir a linha.
 *
 * `mais_antigo_dias` existe porque "3 parados" e "3 parados, o mais velho ha 46 dias" pedem
 * conversas diferentes com a mesma pessoa.
 */
async function contagemPorResponsavel(pool, empresaId, prazoDias) {
  const prazo = P.normalizarPrazo(prazoDias)
  const { rows } = await pool.query(
    `SELECT p.responsavel_id, COUNT(*)::int AS parados,
            MAX(EXTRACT(DAY FROM NOW() - COALESCE(${P.sqlUltimaAcao('p')}, p.responsavel_desde)))::int AS mais_antigo_dias
       FROM prospectador.prospects p
      WHERE p.empresa_id = $1
        AND p.qualificacao IN ('aprovado', 'legado')
        AND ${P.sqlEstaParado('p', '$2')}
      GROUP BY p.responsavel_id`,
    [empresaId, prazo]
  )
  return rows.map((r) => ({
    responsavel_id: r.responsavel_id,
    parados: r.parados,
    mais_antigo_dias: r.mais_antigo_dias,
  }))
}

module.exports = { contagemPorResponsavel }
