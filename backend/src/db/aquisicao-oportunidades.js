'use strict'
// Acesso a dados do Assistente de Oportunidades.
// Só SQL + isolamento por empresa. QUEM decide o que sugerir é
// services/aquisicao-sinais.js (puro); quem orquestra é services/aquisicao-assistente.js.
//
// Este módulo é READ-ONLY sobre os dados de aquisição (rotinas, coletas, prospects,
// agenda) e só escreve na própria tabela de sugestões. Ele não tem — e não pode ganhar —
// nenhum caminho para disparar coleta.

const COLUNAS = `
  id, empresa_id, tipo, rotina_id, nicho, cidade, uf, parametros,
  titulo, motivo, impacto, evidencias, confianca, prioridade, assinatura,
  origem_texto, status, decidido_por, decidido_em, decisao_nota,
  rotina_resultante_id, criado_em, atualizado_em
`

// Últimas execuções consideradas por rotina. Histórico antigo diluiria o sinal recente:
// o que importa é se o mercado está esgotando AGORA.
const EXECUCOES_POR_ROTINA = 5

// Telefone normalizado: só dígitos, sem o DDI 55 quando presente (length>=12), para não
// corromper DDD 55. Mesma regra usada na aba "Agendados" do Banco de Leads
// (src/routes/api-banco-leads.js) — se ela mudar lá, precisa mudar aqui.
const _dig = (col) => `regexp_replace(COALESCE(${col}, ''), '[^0-9]', '', 'g')`
const _fone = (col) => `(CASE WHEN length(${_dig(col)}) >= 12 AND left(${_dig(col)}, 2) = '55' THEN substr(${_dig(col)}, 3) ELSE ${_dig(col)} END)`

function erro(mensagem, statusCode = 400) {
  const e = new Error(mensagem)
  e.statusCode = statusCode
  return e
}

// Execuções concluídas recentes de cada rotina da empresa (sinal de saturação).
async function listarExecucoesRecentes(pool, empresaId) {
  const { rows } = await pool.query(
    `SELECT rotina_id, nicho, cidade, status, coletados, novos, created_at
       FROM (
         SELECT s.rotina_id, s.nicho, s.cidade, s.status,
                COALESCE(s.total_prospects, 0)::int AS coletados,
                COALESCE(s.novos_prospects, 0)::int AS novos,
                s.created_at,
                ROW_NUMBER() OVER (PARTITION BY s.rotina_id ORDER BY s.created_at DESC) AS rn
           FROM prospectador.busca_snapshots s
          WHERE s.empresa_id = $1
            AND s.rotina_id IS NOT NULL
            AND s.status = 'concluido'
            AND s.created_at > NOW() - INTERVAL '90 days'
       ) t
      WHERE rn <= $2
      ORDER BY created_at DESC`,
    [empresaId, EXECUCOES_POR_ROTINA]
  )
  return rows
}

// Resultado COMERCIAL por mercado (nicho × cidade) desta empresa: quantos foram
// abordados, quantos responderam e quantos viraram reunião. As reuniões vêm das duas
// agendas (dashboard e bot), casadas por telefone — mesma leitura da aba "Agendados".
async function listarDesempenhoMercados(pool, empresaId, limite = 60) {
  const { rows } = await pool.query(
    `WITH fones_reuniao AS (
       SELECT ${_fone('ae.lead_telefone')} AS fone
         FROM app.agenda_eventos ae
        WHERE ae.empresa_id = $1
          AND ae.excluido_em IS NULL
          AND ae.tipo = 'reuniao'
          AND ae.status IN ('pendente', 'confirmado', 'concluido')
          AND COALESCE(ae.lead_telefone, '') <> ''
       UNION
       SELECT ${_fone('vc.numero')} AS fone
         FROM vendas.agenda_eventos ve
         JOIN vendas.conversas vc ON vc.id = ve.conversa_id AND vc.empresa_id = $1
        WHERE ve.excluido_em IS NULL
          AND ve.tipo = 'reuniao'
          AND ve.status IN ('pendente', 'confirmado', 'concluido')
       UNION
       SELECT ${_fone('vlp.numero')} AS fone
         FROM vendas.agenda_eventos ve
         JOIN vendas.lead_profiles vlp ON vlp.id = ve.lead_id AND vlp.empresa_id = $1
        WHERE ve.excluido_em IS NULL
          AND ve.tipo = 'reuniao'
          AND ve.status IN ('pendente', 'confirmado', 'concluido')
     )
     SELECT p.nicho,
            p.cidade,
            COUNT(*)::int                                                      AS total,
            COUNT(*) FILTER (WHERE p.status IN ('enviado', 'respondeu'))::int  AS enviados,
            COUNT(*) FILTER (WHERE p.status = 'respondeu')::int                AS respostas,
            COUNT(DISTINCT p.id) FILTER (WHERE r.fone IS NOT NULL)::int        AS reunioes
       FROM prospectador.prospects p
       LEFT JOIN fones_reuniao r
              ON NULLIF(${_fone('p.telefone')}, '') IS NOT NULL
             AND r.fone = ${_fone('p.telefone')}
      WHERE p.empresa_id = $1
        AND COALESCE(p.nicho, '') <> ''
        AND COALESCE(p.cidade, '') <> ''
      GROUP BY p.nicho, p.cidade
      ORDER BY respostas DESC, total DESC
      LIMIT $2`,
    [empresaId, Math.max(1, Math.min(200, Number.parseInt(limite, 10) || 60))]
  )
  return rows
}

// Assinaturas que o admin JÁ decidiu (aprovou ou dispensou). Enquanto a evidência não
// mudar de faixa, a assinatura é a mesma e o candidato não volta a ser sugerido.
async function assinaturasDecididas(pool, empresaId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT assinatura
       FROM prospectador.aquisicao_sugestoes
      WHERE empresa_id = $1 AND status IN ('aprovada', 'dispensada')`,
    [empresaId]
  )
  return new Set(rows.map((r) => r.assinatura))
}

async function listarSugestoes(pool, empresaId, { status = 'pendente', limite = 20 } = {}) {
  const params = [empresaId, Math.max(1, Math.min(50, Number.parseInt(limite, 10) || 20))]
  let filtro = ''
  if (status && status !== 'todas') {
    params.push(status)
    filtro = ` AND status = $${params.length}`
  }
  const { rows } = await pool.query(
    `SELECT ${COLUNAS}
       FROM prospectador.aquisicao_sugestoes
      WHERE empresa_id = $1${filtro}
      ORDER BY (status = 'pendente') DESC, prioridade DESC, criado_em DESC
      LIMIT $2`,
    params
  )
  return rows
}

async function obterSugestao(pool, empresaId, id) {
  const { rows } = await pool.query(
    `SELECT ${COLUNAS} FROM prospectador.aquisicao_sugestoes
      WHERE empresa_id = $1 AND id = $2::uuid`,
    [empresaId, id]
  )
  return rows[0] || null
}

// Grava os candidatos aprovados pela geração. O ON CONFLICT usa o índice único parcial
// (empresa_id, assinatura) WHERE status='pendente': uma segunda análise não empilha a
// mesma sugestão pendente.
async function registrarSugestoes(pool, empresaId, candidatos = []) {
  const gravadas = []
  for (const c of candidatos) {
    const { rows } = await pool.query(
      `INSERT INTO prospectador.aquisicao_sugestoes (
         empresa_id, tipo, rotina_id, nicho, cidade, uf, parametros,
         titulo, motivo, impacto, evidencias, confianca, prioridade,
         assinatura, origem_texto
       ) VALUES ($1, $2, $3::uuid, $4, $5, $6, $7::jsonb, $8, $9, $10, $11::jsonb, $12, $13, $14, $15)
       ON CONFLICT (empresa_id, assinatura) WHERE status = 'pendente' DO NOTHING
       RETURNING ${COLUNAS}`,
      [
        empresaId, c.tipo, c.rotina_id || null, c.nicho || null, c.cidade || null, c.uf || null,
        JSON.stringify(c.parametros || {}), c.titulo, c.motivo, c.impacto || null,
        JSON.stringify(c.evidencias || {}), c.confianca, c.prioridade,
        c.assinatura, c.origem_texto === 'ia' ? 'ia' : 'regra',
      ]
    )
    if (rows[0]) gravadas.push(rows[0])
  }
  return gravadas
}

// Decisão do admin. O WHERE exige `status = 'pendente'`: dois cliques (ou duas abas)
// não conseguem decidir a mesma sugestão duas vezes — a segunda não atualiza nada.
async function decidirSugestao(pool, empresaId, id, { status, usuarioId = null, nota = null, rotinaResultanteId = null }) {
  if (!['aprovada', 'dispensada'].includes(status)) throw erro('Decisão inválida.', 400)
  const { rows } = await pool.query(
    `UPDATE prospectador.aquisicao_sugestoes
        SET status = $3,
            decidido_por = $4::uuid,
            decidido_em = NOW(),
            decisao_nota = $5,
            rotina_resultante_id = COALESCE($6::uuid, rotina_resultante_id),
            atualizado_em = NOW()
      WHERE empresa_id = $1 AND id = $2::uuid AND status = 'pendente'
      RETURNING ${COLUNAS}`,
    [empresaId, id, status, usuarioId, nota ? String(nota).slice(0, 400) : null, rotinaResultanteId]
  )
  return rows[0] || null
}

// Momento da última sugestão gerada — base do cooldown entre análises.
async function ultimaGeracaoEm(pool, empresaId) {
  const { rows } = await pool.query(
    `SELECT MAX(criado_em) AS ultima FROM prospectador.aquisicao_sugestoes WHERE empresa_id = $1`,
    [empresaId]
  )
  return rows[0]?.ultima || null
}

module.exports = {
  EXECUCOES_POR_ROTINA,
  listarExecucoesRecentes,
  listarDesempenhoMercados,
  assinaturasDecididas,
  listarSugestoes,
  obterSugestao,
  registrarSugestoes,
  decidirSugestao,
  ultimaGeracaoEm,
}
