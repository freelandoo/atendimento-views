'use strict'
// ORIGEM COMERCIAL da conversa — a oferta/orientação com que a 1ª abordagem foi feita.
// Dono ÚNICO da escrita e da leitura de `app.lead_insights` com `tipo = 'abordagem_origem'`
// (migration 118). Regra pura e vocabulário vivem em `services/abordagem-inicial-contrato.js`.
//
// A identidade é a MESMA do runtime do playbook: (empresa_id, numero), onde `numero` é o JID da
// conversa. Quem grava usa `jidConversaDoEnvio` — a MESMA função que cria a linha da conversa:
// duas normalizações de telefone divergiriam e a leitura deixaria de encontrar o registro.

const TIPO_ORIGEM = 'abordagem_origem'

/**
 * Grava (ou substitui) a orientação que originou a abordagem deste contato.
 *
 * ⚠️ `DO UPDATE` e não `DO NOTHING`: uma 2ª abordagem ao mesmo contato (lead redisparado meses
 * depois, com outra configuração) é um recomeço, e é a orientação MAIS RECENTE que descreve a
 * conversa em curso. O que nunca acontece é a configuração MUDAR sozinha o registro: só uma
 * abordagem nova escreve aqui.
 *
 * NUNCA LANÇA. Perder o registro é ruim; derrubar um disparo já pago por causa dele é pior —
 * e a ausência tem significado próprio ("origem desconhecida"), que o leitor trata.
 */
async function registrarAbordagemOrigem(pool, { empresaId, numero, orientacao, log } = {}) {
  if (!pool || !empresaId || !numero || !orientacao || !orientacao.oferta) return false
  try {
    await pool.query(
      `INSERT INTO app.lead_insights (empresa_id, numero, tipo, conteudo, lead_phone)
       VALUES ($1, $2, $3, $4::jsonb, $2)
       ON CONFLICT (empresa_id, numero) WHERE tipo = '${TIPO_ORIGEM}'
       DO UPDATE SET conteudo = EXCLUDED.conteudo`,
      [empresaId, numero, TIPO_ORIGEM, JSON.stringify(orientacao)]
    )
    return true
  } catch (e) {
    if (log && log.warn) log.warn({ err: e.message, empresa_id: empresaId }, '[abordagem-origem] falha ao registrar')
    return false
  }
}

/** Snapshot da origem, ou `null` quando ninguém registrou (origem DESCONHECIDA — não é erro). */
async function obterAbordagemOrigem(pool, empresaId, numero) {
  if (!pool || !empresaId || !numero) return null
  try {
    const { rows } = await pool.query(
      `SELECT conteudo FROM app.lead_insights
        WHERE empresa_id = $1 AND numero = $2 AND tipo = $3 LIMIT 1`,
      [empresaId, numero, TIPO_ORIGEM]
    )
    const c = rows[0] && rows[0].conteudo
    return c && typeof c === 'object' ? c : null
  } catch {
    return null
  }
}

module.exports = { TIPO_ORIGEM, registrarAbordagemOrigem, obterAbordagemOrigem }
