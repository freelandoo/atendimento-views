'use strict'
// ICP do lead — apresentacao pura.
//
// Separado de `pontuacao-indicador`: Cadastro continua sendo completude neutra; ICP e'
// qualidade comercial/fit. Este modulo nao busca dados nem decide qualificacao.

const CRITERIOS_ICP_TENKA = Object.freeze([
  { id: 'operacao_validada', rotulo: 'Operacao validada', pontos: 1, tipo: 'humano_auto' },
  { id: 'instagram_ativo', rotulo: 'Instagram ativo', pontos: 1, tipo: 'automatico' },
  { id: 'imagem_valor', rotulo: 'Preocupacao com imagem', pontos: 1, tipo: 'humano' },
  { id: 'investiu_marketing_tecnologia', rotulo: 'Ja investiu em marketing/tecnologia', pontos: 2, tipo: 'humano' },
  { id: 'crescimento', rotulo: 'Esta em crescimento', pontos: 2, tipo: 'humano' },
  { id: 'cliente_valor_relevante', rotulo: 'Cliente/contrato de valor relevante', pontos: 2, tipo: 'humano' },
  { id: 'lacuna_digital_clara', rotulo: 'Lacuna digital clara', pontos: 2, tipo: 'humano_auto' },
  { id: 'acesso_decisor', rotulo: 'Acesso facil ao decisor', pontos: 2, tipo: 'humano' },
])

const SCORE_MAXIMO_ICP = CRITERIOS_ICP_TENKA.reduce((total, c) => total + c.pontos, 0)

const FAIXAS_ICP = Object.freeze({
  A: {
    rotulo: 'Lead A',
    descricao: 'Alta aderencia ao ICP Tenka.',
    ordem: 3,
    classe: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  B: {
    rotulo: 'Lead B',
    descricao: 'Bom fit, abordagem com personalizacao leve.',
    ordem: 2,
    classe: 'border-blue-200 bg-blue-50 text-blue-700',
  },
  C: {
    rotulo: 'Lead C',
    descricao: 'Baixa prioridade ou revisar antes de investir tempo.',
    ordem: 1,
    classe: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  sem_icp: {
    rotulo: 'Sem ICP',
    descricao: 'Ainda nao avaliado pelo checklist comercial.',
    ordem: 0,
    classe: 'border-dashed border-slate-300 bg-white text-slate-500',
  },
})

function normalizarFaixaIcp(faixa) {
  const f = String(faixa || '').trim().toUpperCase()
  return FAIXAS_ICP[f] ? f : 'sem_icp'
}

function faixaPorScoreIcp(score) {
  const n = Number(score)
  if (!Number.isFinite(n) || n < 0) return 'sem_icp'
  if (n >= 10) return 'A'
  if (n >= 6) return 'B'
  return 'C'
}

function normalizarRespostasIcp(respostas) {
  const origem = respostas && typeof respostas === 'object' ? respostas : {}
  const out = {}
  for (const c of CRITERIOS_ICP_TENKA) out[c.id] = origem[c.id] === true
  return out
}

function calcularIcp(respostas) {
  const norm = normalizarRespostasIcp(respostas)
  const criterios = CRITERIOS_ICP_TENKA.map((c) => ({
    ...c,
    marcado: !!norm[c.id],
    pontos_obtidos: norm[c.id] ? c.pontos : 0,
  }))
  const score = criterios.reduce((total, c) => total + c.pontos_obtidos, 0)
  return {
    score,
    score_maximo: SCORE_MAXIMO_ICP,
    faixa: faixaPorScoreIcp(score),
    respostas: norm,
    criterios,
  }
}

function seloIcp(faixa, score) {
  const chave = normalizarFaixaIcp(faixa)
  const cfg = FAIXAS_ICP[chave]
  return {
    chave,
    ...cfg,
    score: typeof score === 'number' && Number.isFinite(score) ? Math.round(score) : null,
  }
}

function resumoIcpDoLead(lead) {
  const resumo = lead && lead.icp_resumo_json && typeof lead.icp_resumo_json === 'object'
    ? lead.icp_resumo_json
    : null
  const score = typeof lead?.icp_score === 'number' ? lead.icp_score : (typeof resumo?.score === 'number' ? resumo.score : null)
  const faixa = normalizarFaixaIcp(lead?.icp_faixa || resumo?.faixa)
  return {
    score,
    score_maximo: typeof resumo?.score_maximo === 'number' ? resumo.score_maximo : SCORE_MAXIMO_ICP,
    faixa,
    criterios: Array.isArray(resumo?.criterios) ? resumo.criterios : [],
    sinais_auto: resumo?.sinais_auto && typeof resumo.sinais_auto === 'object' ? resumo.sinais_auto : {},
    motivos: Array.isArray(resumo?.motivos) ? resumo.motivos : [],
    avaliado_em: lead?.icp_avaliado_em || null,
  }
}

function ordemIcp(lead) {
  const r = resumoIcpDoLead(lead)
  const selo = seloIcp(r.faixa, r.score)
  return selo.ordem * 100 + (r.score || 0)
}

module.exports = {
  CRITERIOS_ICP_TENKA,
  SCORE_MAXIMO_ICP,
  FAIXAS_ICP,
  normalizarFaixaIcp,
  faixaPorScoreIcp,
  normalizarRespostasIcp,
  calcularIcp,
  seloIcp,
  resumoIcpDoLead,
  ordemIcp,
}
