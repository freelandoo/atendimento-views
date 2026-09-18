'use strict'
// Equipes Comerciais — regras puras de entrada.
// Sem banco, sem HTTP e sem conhecimento de telas: esta camada so normaliza e valida payload.

function erro(mensagem, statusCode = 400, code = 'BAD_REQUEST') {
  const e = new Error(mensagem)
  e.statusCode = statusCode
  e.code = code
  return e
}

function texto(v, max) {
  const s = String(v == null ? '' : v).trim()
  return s ? s.slice(0, max) : ''
}

function normalizarUsuarioIds(entrada) {
  if (entrada == null) return []
  if (!Array.isArray(entrada)) throw erro('usuario_ids deve ser uma lista.')
  return [...new Set(entrada.map((v) => String(v || '').trim()).filter(Boolean))]
}

function normalizarEquipe(dados = {}, { criar = false } = {}) {
  const out = {}
  if (criar || dados.nome !== undefined) {
    const nome = texto(dados.nome, 120)
    if (criar && nome.length < 2) throw erro('Nome da equipe obrigatório.')
    if (dados.nome !== undefined && nome.length < 2) throw erro('Nome da equipe precisa ter ao menos 2 caracteres.')
    if (nome) out.nome = nome
  }
  if (criar || dados.nicho_id !== undefined) {
    const nichoId = texto(dados.nicho_id, 80)
    if (!nichoId) throw erro('Selecione o nicho da equipe.')
    out.nicho_id = nichoId
  }
  if (dados.descricao !== undefined) {
    out.descricao = texto(dados.descricao, 1000) || null
  }
  if (dados.usuario_ids !== undefined) {
    out.usuario_ids = normalizarUsuarioIds(dados.usuario_ids)
  }
  return out
}

function normalizarParticipantes(dados = {}) {
  return { usuario_ids: normalizarUsuarioIds(dados.usuario_ids) }
}

function normalizarEncerramento(dados = {}) {
  const motivo = texto(dados.motivo, 500) || 'Equipe encerrada pelo gestor.'
  return { motivo }
}

// ─── O RECORTE POR NICHO (Etapa 3) ───────────────────────────────────────────────────────
//
// ⚠️ SAO TRES EIXOS e confundi-los e' o erro facil deste modulo:
//   • ESCOPO    — o filtro que a TELA pediu (meus / livres / todos). `lead-responsavel.js`.
//   • ALCANCE   — o LIMITE de quem esta olhando (ownership + instancia). `lead-responsavel.js`.
//   • NICHO     — a carteira que a EQUIPE da pessoa trabalha. E' este, e e' novo.
// Os tres se aplicam com `AND`. Um filtro de tela nunca amplia o alcance, e o nicho nunca vira
// filtro opcional: por decisao do operador ele e' OBRIGATORIO para quem esta em equipe.
//
// Este modulo NAO le banco e NAO sabe qual e' a equipe de ninguem: ele devolve a EXPRESSAO, do
// mesmo jeito que `lead-fila-trabalho.js` e `lead-parado.js` fazem. Quem resolve a equipe e'
// `db/equipes-comerciais.js`; quem decide aplicar e' a rota.

/**
 * A expressao SQL do recorte por nicho.
 *
 * ⚠️ Casa por `nicho_id`, NUNCA pelo texto `prospects.nicho` — e' a decisao D1 (2026-09-18)
 * inteira: "Energia Solar" e "energia solar residencial" sao o mesmo negocio para a pessoa e
 * dois valores para o banco, e casar por nome tiraria leads do recorte EM SILENCIO.
 *
 * `nicho_id IS NULL` fica de FORA do recorte de proposito. Lead ainda nao vinculado nao e' "de
 * todos os nichos": e' "ninguem vinculou ainda" (migration 087), e incluir esses leads na
 * carteira de toda equipe faria o recorte obrigatorio vazar justamente onde o dado e' fraco.
 * A contrapartida — eles ficarem invisiveis ate o backfill rodar — e' visivel no relatorio do
 * backfill e no estado vazio da tela, que diz quantos existem.
 *
 * @param {string} alias        prefixo da tabela (`''` ou `'p.'`), como nos modulos irmaos.
 * @param {string} placeholder  o `$n` que recebera o `nicho_id`.
 */
function sqlNichoDaEquipe({ alias = '', placeholder = '$1' } = {}) {
  const a = alias ? (alias.endsWith('.') ? alias : `${alias}.`) : ''
  return `${a}nicho_id = ${placeholder}::uuid`
}

/**
 * A pessoa deve ser recortada por nicho?
 *
 * Decisao D2: SO' quem esta numa equipe ativa. Sem equipe, nada muda — e uma equipe sem nicho
 * legivel tambem nao recorta, porque recortar por um nicho que a tela nao consegue nomear
 * produziria uma carteira vazia que ninguem sabe explicar.
 */
function recorteDeNicho(equipe) {
  if (!equipe || !equipe.nicho_id) return null
  return {
    nicho_id: equipe.nicho_id,
    nicho_nome: equipe.nicho_nome || null,
    equipe_id: equipe.equipe_id || null,
    equipe_nome: equipe.equipe_nome || null,
  }
}

module.exports = {
  erro,
  sqlNichoDaEquipe,
  recorteDeNicho,
  normalizarEquipe,
  normalizarParticipantes,
  normalizarEncerramento,
  normalizarUsuarioIds,
}
