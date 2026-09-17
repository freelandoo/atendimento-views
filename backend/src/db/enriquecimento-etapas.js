'use strict'
// SQL do pipeline de enriquecimento. Dono UNICO da escrita em
// `prospectador.enriquecimento_etapas` e das colunas de cache de Instagram em `prospects`.
//
// A REGRA continua morando no modulo PURO (`services/enriquecimento-pipeline.js`): aqui nao se
// decide nada, so' se le e se grava. Um `if` de negocio nesta camada viraria uma segunda regua,
// e a primeira pergunta de todo defeito passaria a ser "qual das duas valeu?".

const { pool } = require('../db')
const { ETAPA, STATUS } = require('../services/enriquecimento-pipeline')

// Campos do lead que as etapas precisam para decidir. Lista FECHADA: o worker nao deve receber a
// linha inteira de `prospects`, senao vira tentacao de decidir por campo que nao e' desta regra.
const COLS_LEAD = `
  p.id, p.empresa_id, p.nome, p.cidade, p.nicho, p.telefone, p.site, p.link_original,
  p.instagram_handle, p.instagram_candidato, p.instagram_confianca, p.instagram_origem,
  p.instagram_perfil_em`

/**
 * Enfileira uma etapa para um lote de leads.
 *
 * `ON CONFLICT DO NOTHING`, e isso e' a regra "nao repetir tentativa fracassada" vivendo no
 * banco: um lead reencontrado numa recoleta NAO volta para a fila se ja' passou por ela. Sem
 * isso, cada recoleta do mesmo mercado repagaria a busca e o perfil de todo mundo.
 *
 * Nunca lanca: enriquecimento e' trabalho DE FUNDO e nao pode derrubar a importacao de leads que
 * ja' foi paga. Falhar aqui custa um enriquecimento; falhar na importacao custa a coleta inteira.
 */
async function enfileirar(prospectIds, { empresaId = null, etapa = ETAPA.DESCOBERTA } = {}) {
  const ids = [...new Set((Array.isArray(prospectIds) ? prospectIds : []).filter(Boolean))]
  if (!ids.length) return { enfileirados: 0 }
  try {
    const { rowCount } = await pool.query(
      `INSERT INTO prospectador.enriquecimento_etapas
         (empresa_id, prospect_id, etapa, status, proxima_tentativa_em)
       SELECT $1::uuid, x.id, $3, $4, NOW()
         FROM UNNEST($2::uuid[]) AS x(id)
       ON CONFLICT (prospect_id, etapa) DO NOTHING`,
      [empresaId, ids, etapa, STATUS.PENDENTE]
    )
    return { enfileirados: rowCount || 0 }
  } catch (e) {
    return { enfileirados: 0, erro: e.message }
  }
}

/**
 * Reabre/cria a etapa de PERFIL quando a recoleta encontra lead que JA tem @ conhecido, mas a
 * atividade do Instagram ainda nao foi medida ou o cache venceu.
 *
 * Diferente de `enfileirar`, aqui o conflito pode ser atualizado: uma linha terminal antiga nao
 * pode impedir que um lead reencontrado hoje valide posts de novo. Linhas ja pendentes ou
 * processando ficam intactas para nao duplicar snapshot pago.
 */
async function enfileirarPerfisComCacheVencido(prospectIds, {
  empresaId = null, ttlDias = 30,
} = {}) {
  const ids = [...new Set((Array.isArray(prospectIds) ? prospectIds : []).filter(Boolean))]
  const ttl = Math.max(1, Math.min(365, Number.parseInt(ttlDias, 10) || 30))
  if (!ids.length) return { enfileirados: 0 }
  try {
    const { rowCount } = await pool.query(
      `INSERT INTO prospectador.enriquecimento_etapas
         (empresa_id, prospect_id, etapa, status, proxima_tentativa_em)
       SELECT COALESCE($1::uuid, p.empresa_id), p.id, $3, $4, NOW()
         FROM prospectador.prospects p
        WHERE p.id = ANY($2::uuid[])
          AND COALESCE(NULLIF(TRIM(p.instagram_handle), ''),
                       NULLIF(TRIM(p.instagram_candidato), '')) IS NOT NULL
          AND (p.instagram_perfil_em IS NULL
               OR p.instagram_perfil_em < NOW() - ($5::int * INTERVAL '1 day'))
       ON CONFLICT (prospect_id, etapa) DO UPDATE
          SET status = EXCLUDED.status,
              motivo = NULL,
              proxima_tentativa_em = NOW(),
              lease_ate = NULL,
              ultima_execucao_em = NULL,
              snapshot_id = NULL,
              atualizado_em = NOW()
        WHERE prospectador.enriquecimento_etapas.status NOT IN ($6, $7)`,
      [empresaId, ids, ETAPA.PERFIL, STATUS.PENDENTE, ttl,
        STATUS.PENDENTE, STATUS.PROCESSANDO]
    )
    return { enfileirados: rowCount || 0 }
  } catch (e) {
    return { enfileirados: 0, erro: e.message }
  }
}

/**
 * Reserva trabalho para ESTE worker.
 *
 * `FOR UPDATE SKIP LOCKED` + lease — o mesmo padrao de `meta-dispatch.js`. Dois processos nunca
 * pegam o mesmo lead, e um worker que morra no meio devolve o trabalho quando o lease vence, sem
 * ninguem precisar destravar nada a mao.
 *
 * `tentativas` sobe AQUI, na reserva, e nao no fim: se subisse no fim, um worker que morresse no
 * meio da chamada externa deixaria o lead tentando para sempre sem nunca alcancar o teto.
 */
async function reservar(etapa, limite = 20, { agora = new Date() } = {}) {
  const n = Math.max(0, Math.min(200, Number.parseInt(limite, 10) || 0))
  if (!n) return []
  const { rows } = await pool.query(
    `WITH alvo AS (
       SELECT e.id
         FROM prospectador.enriquecimento_etapas e
        WHERE e.etapa = $1
          AND e.status = $2
          AND (e.proxima_tentativa_em IS NULL OR e.proxima_tentativa_em <= $4)
          AND (e.lease_ate IS NULL OR e.lease_ate <= $4)
        ORDER BY e.proxima_tentativa_em NULLS FIRST, e.criado_em
        FOR UPDATE SKIP LOCKED
        LIMIT $3
     )
     UPDATE prospectador.enriquecimento_etapas e
        SET status = $5, lease_ate = $6, ultima_execucao_em = $4,
            tentativas = e.tentativas + 1, atualizado_em = NOW()
       FROM alvo
      WHERE e.id = alvo.id
      RETURNING e.id AS etapa_id, e.prospect_id, e.empresa_id, e.tentativas,
                (SELECT row_to_json(l) FROM (
                   SELECT ${COLS_LEAD} FROM prospectador.prospects p WHERE p.id = e.prospect_id
                 ) l) AS lead`,
    [etapa, STATUS.PENDENTE, n, agora, STATUS.PROCESSANDO,
      new Date(agora.getTime() + 10 * 60000)]
  )
  return rows.filter((r) => r.lead)
}

/** Fecha uma etapa com um veredito terminal (`concluido`/`pulado`/`falhou`/`revisao_humana`). */
async function finalizar(etapaId, { status, motivo = null, resultado = null,
  custoCreditos = 0, custoConsultas = 0, snapshotId = null } = {}) {
  await pool.query(
    `UPDATE prospectador.enriquecimento_etapas
        SET status = $2, motivo = $3, lease_ate = NULL, proxima_tentativa_em = NULL,
            resultado_json = COALESCE($4::jsonb, resultado_json),
            custo_creditos = custo_creditos + $5,
            custo_consultas = custo_consultas + $6,
            snapshot_id = COALESCE($7, snapshot_id),
            atualizado_em = NOW()
      WHERE id = $1`,
    [etapaId, status, motivo, resultado ? JSON.stringify(resultado) : null,
      Math.max(0, custoCreditos), Math.max(0, custoConsultas), snapshotId]
  )
}

/**
 * Devolve a etapa para a fila.
 *
 * `consomeTentativa = false` DESFAZ o incremento feito na reserva. Cota esgotada e orcamento
 * barrado nao sao falhas do lead — ele nem chegou a ser consultado —, e contar tentativa ali
 * faria o lead morrer como `tentativas_esgotadas` sem nunca ter sido buscado.
 */
async function reagendar(etapaId, { proximaTentativaEm, motivo = null,
  consomeTentativa = true, custoConsultas = 0 } = {}) {
  await pool.query(
    `UPDATE prospectador.enriquecimento_etapas
        SET status = $2, motivo = $3, proxima_tentativa_em = $4, lease_ate = NULL,
            tentativas = GREATEST(0, tentativas - $5),
            custo_consultas = custo_consultas + $6,
            atualizado_em = NOW()
      WHERE id = $1`,
    [etapaId, STATUS.PENDENTE, motivo, proximaTentativaEm, consomeTentativa ? 0 : 1,
      Math.max(0, custoConsultas)]
  )
}

/** Marca as etapas de um snapshot como aguardando a coleta ficar pronta. */
async function marcarSnapshot(etapaIds, snapshotId, { leaseAte }) {
  if (!Array.isArray(etapaIds) || !etapaIds.length) return
  await pool.query(
    `UPDATE prospectador.enriquecimento_etapas
        SET snapshot_id = $2, lease_ate = $3, atualizado_em = NOW()
      WHERE id = ANY($1::uuid[])`,
    [etapaIds, snapshotId, leaseAte]
  )
}

/** As etapas que estao esperando um snapshot da Bright Data voltar, agrupadas por snapshot. */
async function aguardandoSnapshot(etapa, limite = 5) {
  const { rows } = await pool.query(
    `SELECT snapshot_id, MIN(ultima_execucao_em) AS desde, COUNT(*)::int AS leads
       FROM prospectador.enriquecimento_etapas
      WHERE etapa = $1 AND status = $2 AND snapshot_id IS NOT NULL
      GROUP BY snapshot_id
      ORDER BY MIN(ultima_execucao_em) ASC
      LIMIT $3`,
    [etapa, STATUS.PROCESSANDO, Math.max(1, Math.min(20, limite))]
  )
  return rows
}

/** As etapas de um snapshot, com o lead de cada uma. */
async function etapasDoSnapshot(snapshotId) {
  const { rows } = await pool.query(
    `SELECT e.id AS etapa_id, e.prospect_id, e.empresa_id, e.tentativas,
            (SELECT row_to_json(l) FROM (
               SELECT ${COLS_LEAD} FROM prospectador.prospects p WHERE p.id = e.prospect_id
             ) l) AS lead
       FROM prospectador.enriquecimento_etapas e
      WHERE e.snapshot_id = $1 AND e.status = $2`,
    [snapshotId, STATUS.PROCESSANDO]
  )
  return rows.filter((r) => r.lead)
}

/**
 * Quantas consultas Bright Data SERP ja' foram gastas hoje.
 *
 * Nao ha' tabela propria para isso de proposito: cada execucao gasta exatamente 1 consulta
 * (`buscarPerfisDeNegocio` e' travada em 1 SERP), entao somar `custo_consultas` das etapas
 * executadas hoje ja' responde a pergunta. Uma segunda tabela seria um segundo lugar para a
 * mesma contagem divergir.
 *
 * Nunca lanca: sem o numero, o chamador decide — e a decisao dele e' NAO gastar.
 */
async function consultasHoje() {
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(custo_consultas), 0)::int AS total
         FROM prospectador.enriquecimento_etapas
        WHERE ultima_execucao_em >= date_trunc('day', NOW())`
    )
    return rows[0].total
  } catch {
    return null
  }
}

/**
 * Grava o resultado do perfil no lead.
 *
 * NUNCA sobrescreve decisao humana: `instagram_verificado_por IS NOT NULL` significa que uma
 * PESSOA decidiu aquele vinculo, e o worker nao passa por cima — mesma disciplina de
 * `qualificacao` e de `telefone_origem = 'operador'`. O worker so' promove `candidato` a
 * `confirmado` quando o proprio perfil trouxe prova forte.
 */
async function gravarPerfil(prospectId, {
  registro = null, atividade = null, ultimoPostEm = null, seguidores = null,
  handle = null, confianca = null, evidencia = null,
} = {}) {
  const { rows } = await pool.query(
    `UPDATE prospectador.prospects
        SET instagram_perfil_json    = COALESCE($2::jsonb, instagram_perfil_json),
            instagram_perfil_em      = NOW(),
            instagram_atividade      = $3,
            instagram_ultimo_post_em = $4,
            instagram_seguidores     = COALESCE($5, instagram_seguidores),
            instagram_handle = CASE
              WHEN instagram_verificado_por IS NOT NULL THEN instagram_handle
              WHEN $7::text IS NOT NULL AND $6::text IS NOT NULL THEN $6::text
              ELSE instagram_handle END,
            instagram_candidato = CASE
              WHEN instagram_verificado_por IS NOT NULL THEN instagram_candidato
              WHEN $7::text IS NOT NULL AND $6::text IS NOT NULL THEN NULL
              ELSE instagram_candidato END,
            instagram_confianca = CASE
              WHEN instagram_verificado_por IS NOT NULL THEN instagram_confianca
              WHEN $7::text IS NOT NULL THEN $7::text
              ELSE instagram_confianca END,
            instagram_evidencia = CASE
              WHEN instagram_verificado_por IS NOT NULL THEN instagram_evidencia
              WHEN $8::jsonb IS NOT NULL THEN $8::jsonb
              ELSE instagram_evidencia END,
            updated_at = NOW()
      WHERE id = $1::uuid
      RETURNING instagram_handle, instagram_confianca, instagram_atividade`,
    [prospectId, registro ? JSON.stringify(registro) : null, atividade, ultimoPostEm,
      seguidores, handle, confianca, evidencia ? JSON.stringify(evidencia) : null]
  )
  return rows[0] || null
}

/**
 * Grava o resultado da DESCOBERTA no lead.
 *
 * `confianca` so' pode chegar aqui quando uma busca REALMENTE aconteceu — quem garante isso e' o
 * worker, que nunca chama esta funcao em falha de fonte. E' a mesma regra que a rota manual
 * passou a respeitar: cota esgotada nao vira `nao_encontrado`.
 */
async function gravarDescoberta(prospectId, { handle = null, confirmado = false,
  confianca = null, evidencia = null } = {}) {
  const { rows } = await pool.query(
    `UPDATE prospectador.prospects
        SET instagram_handle = CASE
              WHEN instagram_verificado_por IS NOT NULL THEN instagram_handle
              WHEN $3::boolean THEN $2::text ELSE instagram_handle END,
            instagram_candidato = CASE
              WHEN instagram_verificado_por IS NOT NULL THEN instagram_candidato
              WHEN $3::boolean THEN NULL ELSE $2::text END,
            instagram_origem    = CASE
              WHEN instagram_verificado_por IS NOT NULL THEN instagram_origem
              ELSE 'busca' END,
            instagram_confianca = CASE
              WHEN instagram_verificado_por IS NOT NULL THEN instagram_confianca
              ELSE $4::text END,
            instagram_evidencia = CASE
              WHEN instagram_verificado_por IS NOT NULL THEN instagram_evidencia
              ELSE $5::jsonb END,
            instagram_verificado_em = NOW(),
            updated_at = NOW()
      WHERE id = $1::uuid
      RETURNING instagram_handle, instagram_candidato, instagram_confianca`,
    [prospectId, handle, !!confirmado, confianca,
      evidencia ? JSON.stringify(evidencia) : null]
  )
  return rows[0] || null
}

/** Panorama do enriquecimento de uma empresa — alimenta o estado mostrado na tela. */
async function resumoPorEmpresa(empresaId) {
  const { rows } = await pool.query(
    `SELECT etapa, status, COUNT(*)::int AS total
       FROM prospectador.enriquecimento_etapas
      WHERE empresa_id = $1
      GROUP BY etapa, status`,
    [empresaId]
  )
  return rows
}

module.exports = {
  enfileirar,
  enfileirarPerfisComCacheVencido,
  reservar,
  finalizar,
  reagendar,
  marcarSnapshot,
  aguardandoSnapshot,
  etapasDoSnapshot,
  consultasHoje,
  gravarPerfil,
  gravarDescoberta,
  resumoPorEmpresa,
}
