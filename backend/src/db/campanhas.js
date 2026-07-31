'use strict'
// Campanhas comerciais (modulo Prospeccao & Inteligencia Comercial). Acesso a banco
// ISOLADO por tenant: toda query filtra empresa_id. Ponto critico: FKs (nicho/roteiro/
// prospect/responsavel) DEVEM ser do MESMO tenant — validado aqui antes de gravar, para
// nao referenciar dado de outra empresa.
const { CAMPANHA_STATUS, OPORTUNIDADE_STATUS } = require('../domain-enums')

const STATUS_CAMPANHA = new Set(CAMPANHA_STATUS)
const STATUS_OPORTUNIDADE = new Set(OPORTUNIDADE_STATUS)

function erroEntrada(message, statusCode = 400) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

// Valida (same-tenant) que um id existe naquela tabela E pertence a empresa. Lanca 400.
async function assertMesmaEmpresa(pool, { schema, table, id, empresaId, rotulo }) {
  if (!id) return
  const { rows } = await pool.query(
    `SELECT 1 FROM ${schema}.${table} WHERE id = $1 AND empresa_id = $2`, [id, empresaId]
  )
  if (!rows[0]) throw erroEntrada(`${rotulo} nao encontrado(a) nesta empresa.`, 400)
}

// --- CAMPANHAS ---------------------------------------------------------------------
async function listarCampanhas(pool, empresaId) {
  const { rows } = await pool.query(
    `SELECT c.id, c.nome, c.objetivo, c.status, c.data_inicio, c.data_fim,
            c.meta_ligacoes, c.meta_reunioes, c.criado_em,
            n.nome AS nicho_nome,
            (SELECT COUNT(*)::int FROM app.campanha_leads cl WHERE cl.campanha_id = c.id) AS total_leads,
            (SELECT COUNT(*)::int FROM app.campanha_leads cl WHERE cl.campanha_id = c.id AND cl.status = 'convertido') AS convertidos
       FROM app.campanhas c
       LEFT JOIN app.nichos n ON n.id = c.nicho_id
      WHERE c.empresa_id = $1
      ORDER BY (c.status = 'ativa') DESC, c.criado_em DESC`,
    [empresaId]
  )
  return rows
}

async function criarCampanha(pool, empresaId, patch = {}) {
  const nome = String(patch.nome || '').trim()
  if (!nome) throw erroEntrada('nome e obrigatorio.')
  if (patch.status !== undefined && !STATUS_CAMPANHA.has(patch.status)) throw erroEntrada('status invalido.')
  await assertMesmaEmpresa(pool, { schema: 'app', table: 'nichos', id: patch.nicho_id, empresaId, rotulo: 'Nicho' })
  await assertMesmaEmpresa(pool, { schema: 'app', table: 'roteiro_versoes', id: patch.roteiro_versao_id, empresaId, rotulo: 'Versao do roteiro' })
  const { rows } = await pool.query(
    `INSERT INTO app.campanhas
       (empresa_id, nome, objetivo, hipotese, nicho_id, roteiro_versao_id, data_inicio, data_fim,
        status, meta_ligacoes, meta_reunioes, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id, nome, status, criado_em`,
    [empresaId, nome.slice(0, 160), patch.objetivo || null, patch.hipotese || null,
      patch.nicho_id || null, patch.roteiro_versao_id || null, patch.data_inicio || null, patch.data_fim || null,
      STATUS_CAMPANHA.has(patch.status) ? patch.status : 'rascunho',
      Number.isInteger(patch.meta_ligacoes) ? patch.meta_ligacoes : null,
      Number.isInteger(patch.meta_reunioes) ? patch.meta_reunioes : null,
      patch.criadoPor || null]
  )
  return rows[0]
}

async function obterCampanha(pool, empresaId, campanhaId) {
  const { rows } = await pool.query(
    `SELECT c.*, n.nome AS nicho_nome,
            r.nome AS roteiro_nome, rv.versao AS roteiro_versao
       FROM app.campanhas c
       LEFT JOIN app.nichos n ON n.id = c.nicho_id
       LEFT JOIN app.roteiro_versoes rv ON rv.id = c.roteiro_versao_id
       LEFT JOIN app.roteiros r ON r.id = rv.roteiro_id
      WHERE c.id = $1 AND c.empresa_id = $2`,
    [campanhaId, empresaId]
  )
  if (!rows[0]) return null
  const [resp, breakdown] = await Promise.all([
    pool.query(`SELECT usuario_id FROM app.campanha_responsaveis WHERE campanha_id = $1 AND empresa_id = $2`, [campanhaId, empresaId]),
    pool.query(`SELECT status, COUNT(*)::int AS n FROM app.campanha_leads WHERE campanha_id = $1 AND empresa_id = $2 GROUP BY status`, [campanhaId, empresaId]),
  ])
  const por_status = {}
  for (const b of breakdown.rows) por_status[b.status] = b.n
  return { ...rows[0], responsaveis: resp.rows.map((r) => r.usuario_id), leads_por_status: por_status }
}

async function atualizarCampanha(pool, empresaId, campanhaId, patch = {}) {
  if (patch.status !== undefined && !STATUS_CAMPANHA.has(patch.status)) throw erroEntrada('status invalido.')
  await assertMesmaEmpresa(pool, { schema: 'app', table: 'nichos', id: patch.nicho_id, empresaId, rotulo: 'Nicho' })
  await assertMesmaEmpresa(pool, { schema: 'app', table: 'roteiro_versoes', id: patch.roteiro_versao_id, empresaId, rotulo: 'Versao do roteiro' })
  const campos = []
  const params = [campanhaId, empresaId]
  const set = (col, val) => { params.push(val); campos.push(`${col} = $${params.length}`) }
  for (const col of ['nome', 'objetivo', 'hipotese', 'data_inicio', 'data_fim', 'status']) {
    if (patch[col] !== undefined) set(col, patch[col] === '' ? null : patch[col])
  }
  if (patch.nicho_id !== undefined) set('nicho_id', patch.nicho_id || null)
  if (patch.roteiro_versao_id !== undefined) set('roteiro_versao_id', patch.roteiro_versao_id || null)
  if (patch.meta_ligacoes !== undefined) set('meta_ligacoes', Number.isInteger(patch.meta_ligacoes) ? patch.meta_ligacoes : null)
  if (patch.meta_reunioes !== undefined) set('meta_reunioes', Number.isInteger(patch.meta_reunioes) ? patch.meta_reunioes : null)
  if (!campos.length) throw erroEntrada('Nada para atualizar.')
  const { rows } = await pool.query(
    `UPDATE app.campanhas SET ${campos.join(', ')}, atualizado_em = NOW()
      WHERE id = $1 AND empresa_id = $2 RETURNING id, nome, status`,
    params
  )
  if (!rows[0]) throw erroEntrada('Campanha nao encontrada.', 404)
  return rows[0]
}

// Responsaveis: substitui pelo conjunto informado. So aceita usuarios MEMBROS da empresa
// (app.usuarios_empresas) — evita atribuir alguem de outro tenant.
async function definirResponsaveis(pool, empresaId, campanhaId, usuarioIds = []) {
  await assertMesmaEmpresa(pool, { schema: 'app', table: 'campanhas', id: campanhaId, empresaId, rotulo: 'Campanha' })
  const ids = [...new Set((usuarioIds || []).map(String).filter(Boolean))]
  await pool.query(`DELETE FROM app.campanha_responsaveis WHERE campanha_id = $1 AND empresa_id = $2`, [campanhaId, empresaId])
  if (ids.length) {
    await pool.query(
      `INSERT INTO app.campanha_responsaveis (campanha_id, usuario_id, empresa_id)
       SELECT $1, ue.usuario_id, $2
         FROM app.usuarios_empresas ue
        WHERE ue.empresa_id = $2 AND ue.usuario_id = ANY($3::uuid[])
       ON CONFLICT DO NOTHING`,
      [campanhaId, empresaId, ids]
    )
  }
  return { responsaveis: ids.length }
}

// --- LEADS DA CAMPANHA -------------------------------------------------------------
// Adiciona leads. So insere prospects que sao DA MESMA empresa (filtro no SELECT) —
// impossivel injetar lead de outro tenant. Dedup por (campanha, prospect).
async function adicionarLeads(pool, empresaId, campanhaId, prospectIds = []) {
  await assertMesmaEmpresa(pool, { schema: 'app', table: 'campanhas', id: campanhaId, empresaId, rotulo: 'Campanha' })
  const ids = [...new Set((prospectIds || []).map(String).filter(Boolean))]
  if (!ids.length) return { adicionados: 0 }
  const { rows } = await pool.query(
    `INSERT INTO app.campanha_leads (campanha_id, prospect_id, empresa_id)
     SELECT $1, p.id, $2 FROM prospectador.prospects p
      WHERE p.empresa_id = $2 AND p.id = ANY($3::uuid[])
     ON CONFLICT (campanha_id, prospect_id) DO NOTHING
     RETURNING id`,
    [campanhaId, empresaId, ids]
  )
  return { adicionados: rows.length }
}

async function listarLeadsDaCampanha(pool, empresaId, campanhaId, { status } = {}) {
  const params = [campanhaId, empresaId]
  let filtro = ''
  if (status && STATUS_OPORTUNIDADE.has(status)) { params.push(status); filtro = `AND cl.status = $${params.length}` }
  const { rows } = await pool.query(
    `SELECT cl.id, cl.status, cl.responsavel_id, cl.proxima_acao, cl.data_followup,
            p.id AS prospect_id, p.nome, p.telefone, p.cidade, p.nicho
       FROM app.campanha_leads cl
       JOIN prospectador.prospects p ON p.id = cl.prospect_id
      WHERE cl.campanha_id = $1 AND cl.empresa_id = $2 ${filtro}
      ORDER BY cl.atualizado_em DESC
      LIMIT 1000`,
    params
  )
  return rows
}

// Fila de trabalho da Central de Ligacoes: leads NAO finalizados da campanha, priorizados
// (pendentes primeiro, depois por score do lead). Traz nº de tentativas ja feitas.
async function filaDeTrabalho(pool, empresaId, campanhaId, { limit = 50 } = {}) {
  const lim = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 500)
  const { rows } = await pool.query(
    `SELECT cl.id AS campanha_lead_id, cl.status, cl.proxima_acao, cl.data_followup,
            p.id AS prospect_id, p.nome, p.telefone, p.cidade, p.nicho, p.score,
            (SELECT COUNT(*)::int FROM app.ligacoes l WHERE l.campanha_lead_id = cl.id AND l.status = 'encerrada') AS tentativas
       FROM app.campanha_leads cl
       JOIN prospectador.prospects p ON p.id = cl.prospect_id
      WHERE cl.campanha_id = $1 AND cl.empresa_id = $2
        AND cl.status NOT IN ('convertido', 'descartado')
      ORDER BY CASE cl.status
                 WHEN 'nao_iniciado' THEN 0 WHEN 'tentativa_contato' THEN 1
                 WHEN 'nao_atendeu' THEN 2 WHEN 'follow_up' THEN 3 ELSE 4 END,
               p.score DESC NULLS LAST, cl.atualizado_em ASC
      LIMIT $3`,
    [campanhaId, empresaId, lim]
  )
  return rows
}

// Funil por etapa: onde as ligacoes da campanha ESTAO PARANDO (etapa alcancada ao encerrar)
// e onde perderam interesse. Alimenta o painel "onde os leads param".
async function funilEtapas(pool, empresaId, campanhaId) {
  const { rows } = await pool.query(
    `SELECT tipo, etapa,
            SUM(encerrou)::int AS encerraram,
            SUM(perdeu)::int   AS perderam_interesse
       FROM (
         SELECT 'alc' AS tipo, etapa_alcancada AS etapa, 1 AS encerrou, 0 AS perdeu
           FROM app.ligacoes
          WHERE empresa_id = $1 AND campanha_id = $2 AND status = 'encerrada' AND etapa_alcancada IS NOT NULL
         UNION ALL
         SELECT 'perda' AS tipo, etapa_perda_interesse AS etapa, 0 AS encerrou, 1 AS perdeu
           FROM app.ligacoes
          WHERE empresa_id = $1 AND campanha_id = $2 AND status = 'encerrada' AND etapa_perda_interesse IS NOT NULL
       ) t
      GROUP BY tipo, etapa`,
    [empresaId, campanhaId]
  )
  const encerraram = {}
  const perderam = {}
  let total = 0
  for (const r of rows) {
    if (r.encerraram) { encerraram[r.etapa] = r.encerraram; total += r.encerraram }
    if (r.perderam_interesse) perderam[r.etapa] = r.perderam_interesse
  }
  return { encerraram, perderam, total_ligacoes: total }
}

async function atualizarLead(pool, empresaId, campanhaLeadId, patch = {}) {
  if (patch.status !== undefined && !STATUS_OPORTUNIDADE.has(patch.status)) throw erroEntrada('status invalido.')
  const campos = []
  const params = [campanhaLeadId, empresaId]
  const set = (col, val) => { params.push(val); campos.push(`${col} = $${params.length}`) }
  if (patch.status !== undefined) set('status', patch.status)
  if (patch.proxima_acao !== undefined) set('proxima_acao', patch.proxima_acao === '' ? null : patch.proxima_acao)
  if (patch.data_followup !== undefined) set('data_followup', patch.data_followup || null)
  if (patch.responsavel_id !== undefined) set('responsavel_id', patch.responsavel_id || null)
  if (!campos.length) throw erroEntrada('Nada para atualizar.')
  const { rows } = await pool.query(
    `UPDATE app.campanha_leads SET ${campos.join(', ')}, atualizado_em = NOW()
      WHERE id = $1 AND empresa_id = $2 RETURNING id, status`,
    params
  )
  if (!rows[0]) throw erroEntrada('Lead da campanha nao encontrado.', 404)
  return rows[0]
}

async function removerLead(pool, empresaId, campanhaLeadId) {
  const { rows } = await pool.query(
    `DELETE FROM app.campanha_leads WHERE id = $1 AND empresa_id = $2 RETURNING id`,
    [campanhaLeadId, empresaId]
  )
  if (!rows[0]) throw erroEntrada('Lead da campanha nao encontrado.', 404)
  return { id: rows[0].id }
}

module.exports = {
  assertMesmaEmpresa,
  listarCampanhas, criarCampanha, obterCampanha, atualizarCampanha,
  definirResponsaveis, adicionarLeads, listarLeadsDaCampanha, filaDeTrabalho, funilEtapas, atualizarLead, removerLead,
}
