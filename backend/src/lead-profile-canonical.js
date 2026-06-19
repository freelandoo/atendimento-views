'use strict'

function norm(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function asBool(v) {
  if (typeof v === 'boolean') return v
  if (v == null || v === '') return null
  const s = norm(v)
  if (['sim', 'true', '1', 'tem', 'tenho'].includes(s)) return true
  if (['nao', 'não', 'false', '0', 'sem', 'nao tenho'].includes(s)) return false
  return null
}

function parseJsonObject(value) {
  if (!value) return {}
  if (typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch (_) {
      return {}
    }
  }
  return {}
}

function normalizarHorarios(value) {
  const arr = Array.isArray(value) ? value : []
  return arr.map((h) => String(h || '').trim()).filter(Boolean)
}

function canonicalizarPerfilLead(perfil = {}, etapaAtual = null) {
  const p = perfil && typeof perfil === 'object' ? perfil : {}
  const maturidade = parseJsonObject(p.maturidade_digital)
  const eventos = parseJsonObject(p.eventos_conversa)
  const reuniao = parseJsonObject(p.reuniao_proposta)

  const temSite =
    asBool(p.tem_site) ??
    asBool(p.hasWebsite) ??
    asBool(p.ja_tem_site) ??
    asBool(maturidade.tem_site) ??
    asBool(p.ja_aparece_google)

  const necessidade =
    p.necessidade ||
    p.servico_principal ||
    p.servico_foco ||
    p.produto_sugerido ||
    p.dor_principal ||
    null

  const horarios = normalizarHorarios(
    p.horarios_oferecidos ||
    reuniao.horarios_sugeridos ||
    eventos.horarios_oferecidos
  )

  return {
    nome: p.nome || p.apelido || null,
    negocio: p.negocio || p.tipo_negocio || p.businessType || null,
    cidade: p.cidade || p.cidade_base || p.regiao_atendimento || p.city || null,
    necessidade,
    objetivo_site: p.objetivo_site || eventos.objetivo_site || null,
    tem_site: temSite,
    origem_clientes: p.origem_clientes || p.canal_aquisicao || eventos.origem_clientes || null,
    rota_comercial: p.rota_comercial || inferirRotaComercial(p),
    etapa_atual: p.etapa_atual || etapaAtual || p.estagio || null,
    ultima_acao: p.ultima_acao || eventos.ultima_acao || null,
    horarios_oferecidos: horarios,
    reuniao_confirmada: Boolean(p.reuniao_confirmada || reuniao.horario_confirmado),
    email: p.email || p.contato_email || null,
    concorrentes: Array.isArray(p.concorrentes) ? p.concorrentes.filter(Boolean) : [],
    reuniao_proposta: reuniao,
    campos_coletados: parseJsonObject(p.campos_coletados),
  }
}

function inferirRotaComercial(perfil = {}) {
  const s = norm([
    perfil.rota_comercial,
    perfil.plano_sugerido,
    perfil.produto_sugerido,
    perfil.necessidade,
    perfil.servico_principal,
    perfil.servico_foco,
  ].filter(Boolean).join(' '))
  const rp = parseJsonObject(perfil.reuniao_proposta)
  if (
    perfil.projeto_sob_medida === true ||
    perfil.sob_medida === true ||
    perfil.precisa_sistema === true ||
    rp.necessaria === true ||
    /\b(sistema|automacao|automatizacao|agente de ia|integracao|painel|dashboard|sob medida|personaliz|crm|erp)\b/.test(s)
  ) {
    return 'projeto_sob_medida'
  }
  if (/\b(assinatura|iniciante_assinatura|pagina modelo|site simples|rapido|rapida)\b/.test(s)) {
    return 'projeto_sob_medida'
  }
  return null
}

function patchLegadoDoPerfilCanonico(canonico = {}) {
  const out = {}
  if (canonico.negocio) out.negocio = canonico.negocio
  if (canonico.cidade) out.cidade = canonico.cidade
  if (canonico.necessidade) {
    out.produto_sugerido = canonico.necessidade
    out.dor_principal = canonico.necessidade
  }
  if (canonico.tem_site !== null && canonico.tem_site !== undefined) {
    out.maturidade_digital = { tem_site: canonico.tem_site }
  }
  if (canonico.rota_comercial) {
    out.eventos_conversa = { rota_comercial: canonico.rota_comercial, ultima_acao: canonico.ultima_acao || null }
    if (canonico.rota_comercial === 'projeto_sob_medida') out.projeto_sob_medida = true
  }
  if (canonico.horarios_oferecidos && canonico.horarios_oferecidos.length) {
    out.reuniao_proposta = {
      necessaria: true,
      horarios_sugeridos: canonico.horarios_oferecidos,
      horario_confirmado: canonico.reuniao_confirmada ? canonico.reuniao_proposta?.horario_confirmado || null : null,
      duracao_maxima_minutos: 15,
    }
  }
  return out
}

module.exports = {
  canonicalizarPerfilLead,
  patchLegadoDoPerfilCanonico,
  inferirRotaComercial,
  norm,
}
