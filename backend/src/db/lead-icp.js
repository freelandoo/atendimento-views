'use strict'
// Persistencia do ICP do lead.
//
// O historico e' append-only (`lead_icp_avaliacoes`), e `prospects.icp_*` e' apenas o
// snapshot atual para listagens/filtros. Chame dentro da mesma transacao da decisao.

const { MODELO_TENKA_V1 } = require('../services/icp-modelo')
const { calcularIcpLead, resumoIcp } = require('../services/lead-icp-score')

async function buscarModeloAtivo(exec) {
  const { rows } = await exec.query(
    `SELECT id, nome, slug, versao
       FROM prospectador.icp_modelos
      WHERE empresa_id IS NULL
        AND slug = $1
        AND versao = $2
        AND status = 'ativo'
      LIMIT 1`,
    [MODELO_TENKA_V1.slug, MODELO_TENKA_V1.versao]
  )
  return rows[0] || { ...MODELO_TENKA_V1 }
}

async function salvarAvaliacaoIcp(exec, {
  empresaId,
  prospect,
  decisao,
  respostas,
  observacao = null,
  usuarioId = null,
} = {}) {
  if (!empresaId || !prospect?.id) return null
  const modelo = MODELO_TENKA_V1
  const avaliacao = calcularIcpLead(prospect, respostas)
  const obs = String(observacao || '').trim().slice(0, 1000) || null

  const { rows } = await exec.query(
    `INSERT INTO prospectador.lead_icp_avaliacoes
       (empresa_id, prospect_id, modelo_id, modelo_slug, modelo_versao, score, faixa,
        decisao, respostas_json, sinais_auto_json, motivos_json, observacao, avaliado_por)
     VALUES ($1, $2::uuid, $3::uuid, $4, $5::int, $6::smallint, $7,
             $8, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13::uuid)
     RETURNING id, avaliado_em`,
    [
      empresaId,
      prospect.id,
      modelo.id,
      modelo.slug || MODELO_TENKA_V1.slug,
      modelo.versao || MODELO_TENKA_V1.versao,
      avaliacao.score,
      avaliacao.faixa,
      decisao === 'descartado' ? 'descartado' : 'aprovado',
      JSON.stringify(avaliacao.respostas),
      JSON.stringify(avaliacao.sinais_auto),
      JSON.stringify(avaliacao.motivos),
      obs,
      usuarioId,
    ]
  )

  const resumo = resumoIcp(avaliacao)
  await exec.query(
    `UPDATE prospectador.prospects
        SET icp_modelo_id = $3::uuid,
            icp_score = $4::smallint,
            icp_faixa = $5,
            icp_avaliado_em = $6,
            icp_avaliado_por = $7::uuid,
            icp_resumo_json = $8::jsonb,
            updated_at = NOW()
      WHERE empresa_id = $1 AND id = $2::uuid`,
    [
      empresaId,
      prospect.id,
      modelo.id,
      avaliacao.score,
      avaliacao.faixa,
      rows[0].avaliado_em,
      usuarioId,
      JSON.stringify(resumo),
    ]
  )

  return {
    id: rows[0].id,
    avaliado_em: rows[0].avaliado_em,
    ...resumo,
  }
}

module.exports = {
  buscarModeloAtivo,
  salvarAvaliacaoIcp,
}
