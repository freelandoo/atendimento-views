'use strict'
// Configuracoes -> Integracoes -> API de busca de leads.
//
// Modulo puro: a tela administrativa so traduz estado, valida formulario e monta payload.
// Autorizacao e uso real da chave continuam no backend.

const ESCOPO_MAPS = 'lead_search:maps:create'
const ESCOPO_JOBS = 'lead_search:jobs:read'
const SCOPES_PADRAO = Object.freeze([ESCOPO_MAPS, ESCOPO_JOBS])

const ESTADO_ROTULO = Object.freeze({
  active: 'Ativa',
  expired: 'Expirada',
  revoked: 'Revogada',
})

const ESTADO_TOM = Object.freeze({
  active: 'bg-estado-ok/10 text-estado-ok',
  expired: 'bg-estado-warn/10 text-estado-warn',
  revoked: 'bg-surface-3 text-ink-3',
})

function estadoChave(chave = {}, agora = new Date()) {
  if (chave.status === 'revoked' || chave.revoked_at) return 'revoked'
  if (chave.expires_at) {
    const expira = new Date(chave.expires_at)
    if (!Number.isNaN(expira.getTime()) && expira.getTime() <= agora.getTime()) return 'expired'
  }
  return 'active'
}

function rotuloEstadoChave(estado) {
  return ESTADO_ROTULO[estado] || String(estado || 'Indefinido')
}

function tomEstadoChave(estado) {
  return ESTADO_TOM[estado] || ESTADO_TOM.revoked
}

function numeroInteiro(valor, padrao) {
  if (valor == null || valor === '') return padrao
  const n = Number.parseInt(String(valor), 10)
  return Number.isFinite(n) ? n : NaN
}

function dataLocalParaIso(valor) {
  const v = String(valor || '').trim()
  if (!v) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function validarFormularioChave(form = {}, agora = new Date()) {
  const erros = {}
  const nome = String(form.nome || '').trim()
  const empresaId = String(form.empresa_id || '').trim()
  const maxLeads = numeroInteiro(form.max_leads_per_job, 100)
  const rate = numeroInteiro(form.rate_limit_per_minute, 10)
  const expRaw = String(form.expires_at || '').trim()

  if (nome.length < 2) erros.nome = 'Informe um nome com pelo menos 2 caracteres.'
  if (!empresaId) erros.empresa_id = 'Escolha a empresa que podera usar este codigo.'
  if (!Number.isFinite(maxLeads) || maxLeads < 1 || maxLeads > 100) {
    erros.max_leads_per_job = 'Use um limite entre 1 e 100 leads por busca.'
  }
  if (!Number.isFinite(rate) || rate < 1 || rate > 60) {
    erros.rate_limit_per_minute = 'Use um limite tecnico entre 1 e 60 criacoes por minuto.'
  }
  if (expRaw) {
    const d = new Date(expRaw)
    if (Number.isNaN(d.getTime())) erros.expires_at = 'Informe uma data valida.'
    else if (d.getTime() <= agora.getTime()) erros.expires_at = 'A validade precisa ficar no futuro.'
  }

  return { ok: Object.keys(erros).length === 0, erros }
}

function montarPayloadChave(form = {}) {
  return {
    nome: String(form.nome || '').trim(),
    empresa_id: String(form.empresa_id || '').trim(),
    scopes: [...SCOPES_PADRAO],
    expires_at: dataLocalParaIso(form.expires_at),
    max_leads_per_job: numeroInteiro(form.max_leads_per_job, 100),
    rate_limit_per_minute: numeroInteiro(form.rate_limit_per_minute, 10),
  }
}

function formatarDataCurta(iso) {
  if (!iso) return 'Sem validade'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Data invalida'
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function nomeEmpresa(empresas, empresaId) {
  const id = String(empresaId || '')
  const empresa = (Array.isArray(empresas) ? empresas : []).find((e) => String(e.id) === id)
  return empresa ? empresa.nome : id || 'Sem empresa'
}

module.exports = {
  ESCOPO_MAPS,
  ESCOPO_JOBS,
  SCOPES_PADRAO,
  estadoChave,
  rotuloEstadoChave,
  tomEstadoChave,
  validarFormularioChave,
  montarPayloadChave,
  formatarDataCurta,
  nomeEmpresa,
}
