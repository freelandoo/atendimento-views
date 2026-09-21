'use strict'
// Aprovar e distribuir lote da Aquisicao.
//
// Este modulo costura duas decisoes que ja existiam separadas:
//   1. triagem humana do prospect (aprovar);
//   2. distribuicao conservadora por equipe.
//
// A busca continua sem gatilho automatico. Aqui so existe acao explicita, com previa e
// confirmacao, para um lote escolhido pelo operador.

const { pool } = require('../db')
const D = require('../services/lead-distribuicao')
const Q = require('../services/lead-qualificacao')
const { ACOES } = require('../services/lead-responsavel')
const { registrarMudancasEmLote } = require('./lead-responsavel')
const { logger } = require('../logger')

const MOTIVO = Object.freeze({
  ELEGIVEL: 'elegivel',
  NAO_ENCONTRADO: 'nao_encontrado',
  SEM_NICHO: 'sem_nicho',
  FORA_DO_NICHO: 'fora_do_nicho',
  JA_TEM_RESPONSAVEL: 'ja_tem_responsavel',
  NAO_ABORDAVEL: 'nao_abordavel',
  STATUS_AVANCADO: 'status_avancado',
  BLOQUEADO: 'bloqueado',
  JA_TRABALHADO: 'ja_trabalhado',
  FOLLOW_UP_ABERTO: 'follow_up_aberto',
  REUNIAO_MARCADA: 'reuniao_marcada',
  CONVERSA_ABERTA: 'conversa_aberta',
})

const ORIGEM_APROVAR_DISTRIBUIR = 'aprovar_e_distribuir_aquisicao'
const STATUS_APROVAVEIS = Object.freeze(['coletado', 'contato_encontrado', 'aguardando', 'rejeitado'])
const STATUS_ANALISAVEIS = Object.freeze([...STATUS_APROVAVEIS, 'aprovado'])

function erro(mensagem, statusCode = 400, code = 'BAD_REQUEST') {
  const e = new Error(mensagem)
  e.statusCode = statusCode
  e.code = code
  return e
}

function normalizarIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean))].slice(0, D.QUANTIDADE_MAX)
}

function contarPorMotivo(linhas, naoEncontrados = 0) {
  const mapa = new Map()
  for (const linha of linhas || []) {
    const motivo = linha.motivo || MOTIVO.NAO_ENCONTRADO
    mapa.set(motivo, (mapa.get(motivo) || 0) + 1)
  }
  if (naoEncontrados > 0) mapa.set(MOTIVO.NAO_ENCONTRADO, (mapa.get(MOTIVO.NAO_ENCONTRADO) || 0) + naoEncontrados)
  return [...mapa.entries()].map(([motivo, total]) => ({ motivo, total }))
}

async function withTx(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const r = await fn(client)
    await client.query('COMMIT')
    return r
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

async function obterEquipe(client, empresaId, equipeId, { forUpdate = false } = {}) {
  const { rows } = await client.query(
    `SELECT e.id, e.nome, e.nicho_id, e.status, n.nome AS nicho_nome
       FROM app.equipes_comerciais e
       JOIN app.nichos n ON n.id = e.nicho_id AND n.empresa_id = e.empresa_id
      WHERE e.empresa_id = $1 AND e.id = $2::uuid
      LIMIT 1
      ${forUpdate ? 'FOR UPDATE OF e' : ''}`,
    [empresaId, equipeId]
  )
  const equipe = rows[0]
  if (!equipe) throw erro('Equipe nao encontrada nesta empresa.', 404, 'EQUIPE_NOT_FOUND')
  if (equipe.status !== 'ativa') throw erro('Equipe encerrada nao recebe leads.', 409, 'EQUIPE_ENCERRADA')
  return equipe
}

async function membrosDaEquipe(exec, empresaId, equipeId) {
  const { rows } = await exec.query(
    `SELECT em.usuario_id, u.nome
       FROM app.equipe_comercial_membros em
       JOIN app.usuarios u ON u.id = em.usuario_id
       JOIN app.usuarios_empresas ue ON ue.id = em.usuario_empresa_id
      WHERE em.empresa_id = $1
        AND em.equipe_id = $2::uuid
        AND em.saiu_em IS NULL
        AND ue.ativo = true
        AND u.ativo = true
      ORDER BY u.nome ASC`,
    [empresaId, equipeId]
  )
  return rows
}

function destinosDaEquipe(membros, dados = {}) {
  const entre = D.entreValido(dados.entre)
  const todos = (membros || []).map((m) => String(m.usuario_id))
  if (!todos.length) throw erro('Esta equipe ainda nao tem participantes.', 409, 'EQUIPE_SEM_MEMBROS')
  if (entre !== D.DISTRIBUIR_ENTRE.SELECIONADOS) return { entre, destinos: todos }
  const pedidos = normalizarIds(dados.usuario_ids)
  if (!pedidos.length) throw erro('Selecione as pessoas que vao receber os leads.', 400, 'SEM_DESTINO')
  const fora = pedidos.filter((id) => !todos.includes(String(id)))
  if (fora.length) throw erro('So e possivel distribuir entre participantes desta equipe.', 400, 'DESTINO_FORA_DA_EQUIPE')
  return { entre, destinos: pedidos }
}

function planoDeDistribuicao({ carteira, usuarioIds, disponiveis, quantidade, entre }) {
  const porUsuario = new Map((carteira || []).map((c) => [String(c.responsavel_id), c]))
  const membros = (usuarioIds || []).map((id) => ({
    usuario_id: id,
    atual: porUsuario.get(String(id))?.intocados || 0,
  }))
  return D.planoPuxada({
    membros,
    disponiveis,
    quantidade: D.normalizarQuantidade(quantidade, D.QUANTIDADE_MAX),
    entre,
  })
}

async function classificarLote(exec, empresaId, equipe, ids) {
  if (!ids.length) return { linhas: [], naoEncontrados: 0 }
  const statusAprovaveisSql = STATUS_APROVAVEIS.map((s) => `'${s}'`).join(',')
  const statusAnalisaveisSql = STATUS_ANALISAVEIS.map((s) => `'${s}'`).join(',')
  const { rows } = await exec.query(
    `SELECT p.id,
            p.nome,
            p.status,
            p.qualificacao,
            p.responsavel_id,
            p.nicho_id,
            CASE
              WHEN p.nicho_id IS NULL THEN $3::text
              WHEN p.nicho_id IS DISTINCT FROM $4::uuid THEN $5::text
              WHEN p.responsavel_id IS NOT NULL THEN $6::text
              WHEN p.status NOT IN (${statusAnalisaveisSql}) THEN $7::text
              WHEN p.status NOT IN (${statusAprovaveisSql}) AND NOT (${Q.sqlAbordavel('p')}) THEN $8::text
              WHEN p.bloqueado_ate IS NOT NULL AND p.bloqueado_ate > NOW() THEN $9::text
              WHEN ${D.sqlReuniaoFutura('p')} THEN $10::text
              WHEN ${D.sqlConversaAberta('p')} THEN $11::text
              WHEN ${D.sqlFollowUpPorTelefone('p')} THEN $12::text
              WHEN ${D.sqlJaTrabalhado('p')} THEN $13::text
              ELSE $14::text
            END AS motivo
       FROM prospectador.prospects p
      WHERE p.empresa_id = $1
        AND p.id = ANY($2::uuid[])`,
    [
      empresaId, ids,
      MOTIVO.SEM_NICHO,
      equipe.nicho_id,
      MOTIVO.FORA_DO_NICHO,
      MOTIVO.JA_TEM_RESPONSAVEL,
      MOTIVO.STATUS_AVANCADO,
      MOTIVO.NAO_ABORDAVEL,
      MOTIVO.BLOQUEADO,
      MOTIVO.REUNIAO_MARCADA,
      MOTIVO.CONVERSA_ABERTA,
      MOTIVO.FOLLOW_UP_ABERTO,
      MOTIVO.JA_TRABALHADO,
      MOTIVO.ELEGIVEL,
    ]
  )
  const encontrados = new Set(rows.map((r) => String(r.id)))
  return {
    linhas: rows,
    naoEncontrados: ids.filter((id) => !encontrados.has(String(id))).length,
  }
}

async function previaAprovarEDistribuir(empresaId, dados = {}) {
  const ids = normalizarIds(dados.ids)
  if (!ids.length) throw erro('Selecione ao menos um lead.', 400, 'SEM_LEADS')
  const equipeId = String(dados.equipe_id || dados.equipeId || '').trim()
  if (!equipeId) throw erro('Selecione a equipe que recebera os leads.', 400, 'SEM_EQUIPE')

  const equipe = await obterEquipe(pool, empresaId, equipeId)
  const membros = await membrosDaEquipe(pool, empresaId, equipe.id)
  const { entre, destinos } = destinosDaEquipe(membros, dados)
  const [classificacao, carteira] = await Promise.all([
    classificarLote(pool, empresaId, equipe, ids),
    require('./lead-distribuicao').carteiraDaEquipe(pool, empresaId, equipe.nicho_id),
  ])
  const elegiveis = classificacao.linhas.filter((l) => l.motivo === MOTIVO.ELEGIVEL).length
  const plano = planoDeDistribuicao({
    carteira,
    usuarioIds: destinos,
    disponiveis: elegiveis,
    quantidade: elegiveis,
    entre,
  })
  return montarResposta({
    ids,
    equipe,
    membros,
    destinos,
    classificacao,
    plano,
    criterio: D.criterioValido(dados.criterio),
    executado: false,
  })
}

async function aprovarPendentes(client, empresaId, ids, usuarioId) {
  const { rows } = await client.query(
    `UPDATE prospectador.prospects
        SET status = 'aprovado',
            qualificacao = 'aprovado',
            qualificado_em = NOW(),
            qualificado_por = $3::uuid,
            updated_at = NOW()
      WHERE empresa_id = $1
        AND id = ANY($2::uuid[])
        AND status = ANY($4::text[])
      RETURNING id`,
    [empresaId, ids, usuarioId || null, STATUS_APROVAVEIS]
  )
  if (!rows.length) return []
  await client.query(
    `INSERT INTO app.auditoria_eventos
       (empresa_id, usuario_id, entidade_tipo, entidade_id, acao, estado_novo, contexto)
     SELECT $1::uuid, $2::uuid, 'prospect', x.id, 'prospect_aprovado', 'aprovado', $4::jsonb
       FROM UNNEST($3::uuid[]) AS x(id)`,
    [empresaId, usuarioId || null, rows.map((r) => r.id), JSON.stringify({ origem: ORIGEM_APROVAR_DISTRIBUIR })]
  )
  return rows.map((r) => r.id)
}

async function atribuirSelecionados(client, { empresaId, nichoId, ids, destinoId, limite, criterio }) {
  if (!(limite > 0)) return []
  const { rows } = await client.query(
    `WITH alvo AS (
       SELECT p.id
         FROM prospectador.prospects p
        WHERE p.empresa_id = $1
          AND p.id = ANY($2::uuid[])
          AND p.responsavel_id IS NULL
          AND ${D.sqlRedistribuivel('p', '$3')}
        ORDER BY ${D.ordemDoCriterio(criterio)}
        LIMIT $5
     )
     UPDATE prospectador.prospects t
        SET responsavel_id = $4::uuid, responsavel_desde = NOW()
       FROM alvo
      WHERE t.id = alvo.id AND t.responsavel_id IS NULL
      RETURNING t.id`,
    [empresaId, ids, nichoId, destinoId, limite]
  )
  return rows.map((r) => r.id)
}

async function executarAprovarEDistribuir(empresaId, dados = {}, autorId = null) {
  const ids = normalizarIds(dados.ids)
  if (!ids.length) throw erro('Selecione ao menos um lead.', 400, 'SEM_LEADS')
  const equipeId = String(dados.equipe_id || dados.equipeId || '').trim()
  if (!equipeId) throw erro('Selecione a equipe que recebera os leads.', 400, 'SEM_EQUIPE')

  return withTx(async (client) => {
    const equipe = await obterEquipe(client, empresaId, equipeId, { forUpdate: true })
    // Mesmo lock usado pela distribuicao original: serializa operacoes da mesma equipe.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))`, [String(empresaId), String(equipe.id)])

    const membros = await membrosDaEquipe(client, empresaId, equipe.id)
    const { entre, destinos } = destinosDaEquipe(membros, dados)

    const aprovadosAgora = await aprovarPendentes(client, empresaId, ids, autorId)
    const classificacaoAntes = await classificarLote(client, empresaId, equipe, ids)
    const elegiveis = classificacaoAntes.linhas.filter((l) => l.motivo === MOTIVO.ELEGIVEL).length
    const carteira = await require('./lead-distribuicao').carteiraDaEquipe(client, empresaId, equipe.nicho_id)
    const plano = planoDeDistribuicao({
      carteira,
      usuarioIds: destinos,
      disponiveis: elegiveis,
      quantidade: elegiveis,
      entre,
    })

    const criterio = D.criterioValido(dados.criterio)
    const porPessoa = []
    let total = 0
    for (const alvo of plano.membros) {
      if (alvo.receber <= 0) continue
      const recebidos = await atribuirSelecionados(client, {
        empresaId,
        nichoId: equipe.nicho_id,
        ids,
        destinoId: alvo.usuario_id,
        limite: alvo.receber,
        criterio,
      })
      if (!recebidos.length) continue
      await registrarMudancasEmLote(client, {
        empresaId,
        prospectIds: recebidos,
        anterior: null,
        novo: alvo.usuario_id,
        usuarioId: autorId,
        acao: ACOES.ATRIBUIU,
        motivo: ORIGEM_APROVAR_DISTRIBUIR,
      })
      porPessoa.push({ usuario_id: alvo.usuario_id, recebidos: recebidos.length })
      total += recebidos.length
    }

    await client.query(
      `INSERT INTO app.auditoria_eventos
         (empresa_id, usuario_id, entidade_tipo, entidade_id, acao, contexto)
       VALUES ($1, $2::uuid, 'equipe_comercial', $3::uuid, $4, $5::jsonb)`,
      [empresaId, autorId || null, equipe.id, 'aquisicao_lote_aprovado_distribuido',
        JSON.stringify({
          origem: ORIGEM_APROVAR_DISTRIBUIR,
          selecionados: ids.length,
          aprovados: aprovadosAgora.length,
          distribuidos: total,
          nicho_id: equipe.nicho_id,
          participantes: porPessoa.map((p) => p.usuario_id),
        })]
    )
    logger.info({ empresa_id: empresaId, equipe_id: equipe.id, distribuidos: total }, '[prospeccao-distribuicao] lote aprovado e distribuido')

    return montarResposta({
      ids,
      equipe,
      membros,
      destinos,
      classificacao: classificacaoAntes,
      plano: { ...plano, total_movimentos: total, membros: porPessoa.map((p) => ({ ...p, receber: p.recebidos })) },
      criterio,
      executado: true,
      aprovadosAgora: aprovadosAgora.length,
      distribuidos: total,
    })
  })
}

function montarResposta({ ids, equipe, membros, destinos, classificacao, plano, criterio, executado, aprovadosAgora = 0, distribuidos = 0 }) {
  const nomes = new Map((membros || []).map((m) => [String(m.usuario_id), m.nome]))
  const elegiveis = classificacao.linhas.filter((l) => l.motivo === MOTIVO.ELEGIVEL).length
  const motivos = contarPorMotivo(classificacao.linhas, classificacao.naoEncontrados)
  return {
    equipe: { id: equipe.id, nome: equipe.nome, nicho_id: equipe.nicho_id, nicho_nome: equipe.nicho_nome },
    selecionados: ids.length,
    encontrados: classificacao.linhas.length,
    nao_encontrados: classificacao.naoEncontrados,
    elegiveis,
    nao_elegiveis: Math.max(0, ids.length - elegiveis),
    motivos,
    criterio,
    destinos: destinos.map((id) => ({ usuario_id: id, nome: nomes.get(String(id)) || 'Sem nome' })),
    previsao: {
      total: plano.total_movimentos || 0,
      por_pessoa: (plano.membros || []).filter((p) => (p.receber || p.recebidos || 0) > 0).map((p) => ({
        usuario_id: p.usuario_id,
        nome: nomes.get(String(p.usuario_id)) || 'Sem nome',
        receber: p.receber || p.recebidos || 0,
      })),
    },
    executado,
    aprovados: aprovadosAgora,
    distribuidos,
  }
}

module.exports = {
  MOTIVO,
  previaAprovarEDistribuir,
  executarAprovarEDistribuir,
  normalizarIds,
}
