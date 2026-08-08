'use strict'

// Acesso a app.atribuicao_anuncios — a atribuição CTWA capturada no webhook.
//
// INVARIANTES DESTE MÓDULO (não são zelo estético; são o isolamento por tenant):
//   1. NENHUMA função lê ou escreve sem `empresaId`. Faltando, lança.
//   2. `ctwa_clid` completo só sai por `carregarCtwaPorTelefone`, que existe para
//      alimentar o envio à Meta. A função de LEITURA para tela/API (`listarParaApi`)
//      devolve `ctwa_clid_hint` e telefone MASCARADO — nunca o valor completo.
//   3. Empresa e instância nunca são inferidas aqui: chegam prontas de quem provou.

const { mascararTelefone } = require('../services/meta-conversao')

function erro(code, message, statusCode = 400) {
  const e = new Error(message)
  e.code = code
  e.statusCode = statusCode
  return e
}

function exigirEmpresa(empresaId) {
  if (!empresaId) throw erro('SEM_EMPRESA', 'Atribuição de anúncio sem empresa.', 400)
  return empresaId
}

/**
 * Grava a atribuição capturada no webhook. IDEMPOTENTE por (empresa_id, mensagem_id):
 * a reentrega da mesma mensagem não cria segunda linha — a corrida é resolvida pelo
 * índice único no banco, não por um SELECT antes do INSERT.
 *
 * @returns {Promise<{criado: boolean, id: number|null}>}
 */
async function registrarAtribuicao(pool, empresaId, registro = {}) {
  exigirEmpresa(empresaId)
  const {
    instanciaId, evolutionInstance = null, telefoneNorm, mensagemId,
    adId = null, ctwaClid = null, ctwaClidHint = null, titulo = null, sourceUrl = null,
    elegivel = false, motivo = null, origemRegistro = 'webhook',
  } = registro

  // Cinto e suspensório do critério "atribuição só existe com dono provado": as colunas
  // são NOT NULL, mas falhar aqui dá erro legível em vez de violação de constraint.
  if (!instanciaId) throw erro('SEM_INSTANCIA', 'Atribuição de anúncio sem instância de origem.', 400)
  if (!telefoneNorm) throw erro('SEM_TELEFONE', 'Atribuição de anúncio sem telefone resolvido.', 400)
  if (!mensagemId) throw erro('SEM_MENSAGEM', 'Atribuição de anúncio sem id de mensagem.', 400)

  const { rows } = await pool.query(
    `INSERT INTO app.atribuicao_anuncios
       (empresa_id, instancia_id, evolution_instance, telefone_norm, mensagem_id,
        ad_id, ctwa_clid, ctwa_clid_hint, titulo, source_url,
        atribuicao_confiavel, motivo, origem_registro)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (empresa_id, mensagem_id) DO NOTHING
     RETURNING id`,
    [empresaId, instanciaId, evolutionInstance, telefoneNorm, mensagemId,
      adId, ctwaClid, ctwaClidHint, titulo, sourceUrl,
      elegivel === true, motivo, origemRegistro]
  )
  return { criado: rows.length > 0, id: rows[0]?.id ?? null }
}

/**
 * ctwa_clid dos telefones do lote, DESTA empresa e só das linhas confiáveis.
 * Substitui a leitura de `vendas.lead_profiles.origem_anuncio` no despacho da Meta.
 *
 * Quando o mesmo telefone tem mais de um clique (clicou em dois anúncios, ou no mesmo
 * duas vezes), vale o MAIS RECENTE: é o clique que a Meta espera ver associado à
 * conversa em andamento.
 *
 * @param {string[]} telefones já normalizados (só dígitos)
 * @returns {Promise<Map<string, string>>} telefone_norm → ctwa_clid
 */
async function carregarCtwaPorTelefone(pool, empresaId, telefones = []) {
  exigirEmpresa(empresaId)
  const lista = [...new Set((telefones || []).filter(Boolean))]
  if (!lista.length) return new Map()
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (telefone_norm) telefone_norm, ctwa_clid
       FROM app.atribuicao_anuncios
      WHERE empresa_id = $1
        AND atribuicao_confiavel = true
        AND ctwa_clid IS NOT NULL
        AND telefone_norm = ANY($2::text[])
      ORDER BY telefone_norm, capturado_em DESC`,
    [empresaId, lista]
  )
  return new Map(rows.map((r) => [r.telefone_norm, r.ctwa_clid]))
}

/**
 * Os telefones DESTA empresa que têm atribuição confiável. Usado pelo reconciliador
 * para decidir `temAtribuicao` sem trazer o identificador do clique para dentro do
 * ledger (que é lido pela tela).
 * @returns {Promise<Set<string>>}
 */
async function telefonesComAtribuicao(pool, empresaId, telefones = []) {
  exigirEmpresa(empresaId)
  const lista = [...new Set((telefones || []).filter(Boolean))]
  if (!lista.length) return new Set()
  const { rows } = await pool.query(
    `SELECT DISTINCT telefone_norm
       FROM app.atribuicao_anuncios
      WHERE empresa_id = $1
        AND atribuicao_confiavel = true
        AND ctwa_clid IS NOT NULL
        AND telefone_norm = ANY($2::text[])`,
    [empresaId, lista]
  )
  return new Set(rows.map((r) => r.telefone_norm))
}

/**
 * Histórico SANITIZADO para a API/tela. O que sai daqui já pode ser devolvido ao
 * cliente como está: telefone mascarado, `ctwa_clid` reduzido à dica de 4 caracteres,
 * nenhum payload cru.
 *
 * `instanciaId` opcional recorta por instância — duas instâncias da MESMA empresa nunca
 * enxergam a atribuição uma da outra através deste filtro.
 */
async function listarParaApi(pool, empresaId, { instanciaId = null, limite = 50 } = {}) {
  exigirEmpresa(empresaId)
  const lim = Math.max(1, Math.min(200, Number(limite) || 50))
  const { rows } = await pool.query(
    `SELECT a.id, a.ad_id, a.ctwa_clid_hint, a.titulo, a.telefone_norm,
            a.atribuicao_confiavel, a.motivo, a.capturado_em,
            a.instancia_id, COALESCE(i.nome, a.evolution_instance) AS instancia_nome
       FROM app.atribuicao_anuncios a
       LEFT JOIN app.empresa_whatsapp_instances i ON i.id = a.instancia_id
      WHERE a.empresa_id = $1
        AND ($2::uuid IS NULL OR a.instancia_id = $2::uuid)
      ORDER BY a.capturado_em DESC
      LIMIT $3`,
    [empresaId, instanciaId, lim]
  )
  return rows.map((r) => ({
    id: Number(r.id),
    ad_id: r.ad_id || null,
    titulo: r.titulo || null,
    // Dica, nunca o valor. Mesmo contrato do `token_hint` da credencial da Meta.
    ctwa_clid_hint: r.ctwa_clid_hint || null,
    telefone_mascarado: mascararTelefone(r.telefone_norm),
    instancia_id: r.instancia_id,
    instancia: r.instancia_nome || null,
    // "origem disponível" x "indisponível": é o que a tela precisa dizer.
    origem_disponivel: r.atribuicao_confiavel === true,
    motivo: r.motivo || null,
    capturado_em: r.capturado_em,
  }))
}

/** Contagens por anúncio, DESTA empresa. Só agregados — nenhum dado de pessoa. */
async function resumoPorAnuncio(pool, empresaId, { instanciaId = null } = {}) {
  exigirEmpresa(empresaId)
  const { rows } = await pool.query(
    `SELECT a.ad_id,
            MAX(a.titulo)                                              AS titulo,
            COUNT(DISTINCT a.telefone_norm)::int                       AS leads,
            COUNT(*) FILTER (WHERE a.atribuicao_confiavel)::int        AS confiaveis,
            MIN(a.capturado_em)                                        AS primeiro_em,
            MAX(a.capturado_em)                                        AS ultimo_em
       FROM app.atribuicao_anuncios a
      WHERE a.empresa_id = $1
        AND ($2::uuid IS NULL OR a.instancia_id = $2::uuid)
      GROUP BY a.ad_id
      ORDER BY leads DESC, ultimo_em DESC`,
    [empresaId, instanciaId]
  )
  return rows.map((r) => ({
    ad_id: r.ad_id || null,
    titulo: r.titulo || null,
    leads: Number(r.leads) || 0,
    confiaveis: Number(r.confiaveis) || 0,
    primeiro_em: r.primeiro_em,
    ultimo_em: r.ultimo_em,
  }))
}

module.exports = {
  registrarAtribuicao,
  carregarCtwaPorTelefone,
  telefonesComAtribuicao,
  listarParaApi,
  resumoPorAnuncio,
}
