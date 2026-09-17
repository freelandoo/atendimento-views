'use strict'
// ICP do lead — apresentacao pura.
//
// Cadastro e' evidencia do ICP; o score final continua sendo qualidade comercial/fit.
// Este modulo nao busca dados nem decide qualificacao.

const CRITERIOS_ICP_TENKA = Object.freeze([
  {
    id: 'operacao_validada',
    rotulo: 'Operacao validada',
    pontos: 1,
    tipo: 'humano_auto',
    explicacao: 'Marque quando houver prova de negocio real: clientes, avaliacoes, portfolio, estrutura visivel, historico ou operacao recorrente.',
    exemplo: 'Google com avaliacoes, fotos reais, trabalhos publicados ou unidade/estrutura claramente ativa.',
  },
  {
    id: 'instagram_ativo',
    rotulo: 'Instagram ativo',
    pontos: 1,
    tipo: 'automatico',
    explicacao: 'Conta quando existe presenca social com atividade recente e preocupacao em mostrar servicos, resultados, qualidade ou bastidores.',
    exemplo: 'Perfil com posts/reels recentes, antes e depois, bastidores, equipe, servicos ou provas visuais.',
  },
  {
    id: 'imagem_valor',
    rotulo: 'Preocupacao com imagem',
    pontos: 1,
    tipo: 'humano',
    explicacao: 'Marque quando o negocio tenta transmitir qualidade, profissionalismo e valor percebido.',
    exemplo: 'Fotos bem cuidadas, identidade visual, uniforme, ambiente organizado, apresentacao premium ou portfolio visual.',
  },
  {
    id: 'investiu_marketing_tecnologia',
    rotulo: 'Ja investiu em marketing/tecnologia',
    pontos: 2,
    tipo: 'humano',
    explicacao: 'Marque quando ha sinal de que ja tentou ou aceita investir para vender mais ou melhorar presenca digital.',
    exemplo: 'Trafego pago, conteudo profissional, IA/avatar, site, e-commerce, landing page, CRM, automacao ou ferramentas digitais.',
  },
  {
    id: 'crescimento',
    rotulo: 'Esta em crescimento',
    pontos: 2,
    tipo: 'humano',
    explicacao: 'Marque quando houver movimento de expansao, melhora de estrutura, novos servicos, contratacao, divulgacao frequente ou aumento de oferta.',
    exemplo: 'Novos procedimentos, nova unidade, equipe maior, agenda cheia, lancamentos, reforma, ampliacao ou publicacoes de crescimento.',
  },
  {
    id: 'cliente_valor_relevante',
    rotulo: 'Cliente/contrato de valor relevante',
    pontos: 2,
    tipo: 'humano',
    explicacao: 'Marque quando poucas vendas novas poderiam pagar a solucao digital.',
    exemplo: 'Ticket medio alto, contrato recorrente, servico especializado, procedimento caro ou venda consultiva com boa margem.',
  },
  {
    id: 'lacuna_digital_clara',
    rotulo: 'Lacuna digital clara',
    pontos: 2,
    tipo: 'humano_auto',
    explicacao: 'Marque quando existir uma diferenca clara entre a qualidade do negocio e a presenca digital: sem site, site fraco, site amador ou baixa conversao.',
    exemplo: 'Instagram melhor que o site, Google forte sem pagina propria, site antigo/quebrado, site feito pelo dono ou trafego sem estrutura de conversao.',
  },
  {
    id: 'acesso_decisor',
    rotulo: 'Acesso facil ao decisor',
    pontos: 2,
    tipo: 'humano',
    explicacao: 'Marque quando a rota ate quem decide parece curta: dono/fundador identificado e contato direto por telefone ou WhatsApp.',
    exemplo: 'WhatsApp cai no dono, fundador aparece na bio/site, operacao pequena owner-led, pouca burocracia ou so um gatekeeper simples.',
  },
])

const SCORE_MAXIMO_ICP = CRITERIOS_ICP_TENKA.reduce((total, c) => total + c.pontos, 0)

const FAIXAS_ICP = Object.freeze({
  A: {
    rotulo: 'Lead A',
    descricao: 'Alta aderencia ao ICP geral.',
    ordem: 3,
    classe: 'border-orange-300 bg-orange-50 text-orange-800',
    classeBolinha: 'border-orange-500 bg-orange-100 text-orange-800',
  },
  B: {
    rotulo: 'Lead B',
    descricao: 'Bom fit, abordagem com personalizacao leve.',
    ordem: 2,
    classe: 'border-amber-300 bg-amber-50 text-amber-800',
    classeBolinha: 'border-amber-400 bg-amber-50 text-amber-800',
  },
  C: {
    rotulo: 'Lead C',
    descricao: 'Baixa prioridade ou revisar antes de investir tempo.',
    ordem: 1,
    classe: 'border-sky-200 bg-sky-50 text-sky-700',
    classeBolinha: 'border-sky-300 bg-sky-50 text-sky-700',
  },
  sem_icp: {
    rotulo: 'Sem ICP',
    descricao: 'Ainda nao avaliado pelo checklist comercial geral.',
    ordem: 0,
    classe: 'border-dashed border-slate-300 bg-white text-slate-500',
    classeBolinha: 'border-dashed border-slate-300 bg-white text-slate-400',
  },
})

const VALIDACAO_LEAD = Object.freeze({
  apto_automatico: {
    rotulo: 'Apto',
    descricao: 'Sem alerta relevante para abordagem automatica ou triagem rapida.',
    classe: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  revisar_rapido: {
    rotulo: 'Revisar rapido',
    descricao: 'Ha alerta leve ou dado pendente, mas nada bloqueia a abordagem.',
    classe: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  validacao_humana_obrigatoria: {
    rotulo: 'Validar',
    descricao: 'Precisa de confirmacao humana antes de investir abordagem.',
    classe: 'border-orange-200 bg-orange-50 text-orange-700',
  },
  automatica_humana: {
    rotulo: 'Auto + humano',
    descricao: 'Automacao encontrou sinais, mas ha risco forte para uma pessoa validar.',
    classe: 'border-orange-200 bg-orange-50 text-orange-700',
  },
  bloqueado_automatico: {
    rotulo: 'Bloqueado',
    descricao: 'Ha bloqueio operacional ou sinal forte para segurar o lead.',
    classe: 'border-red-200 bg-red-50 text-red-700',
  },
  baixo_fit: {
    rotulo: 'Baixo fit',
    descricao: 'Pontuacao baixa para priorizar agora.',
    classe: 'border-slate-200 bg-slate-50 text-slate-600',
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
  const qualificacao = qualificacaoDoLead(lead)
  return {
    score,
    score_maximo: typeof resumo?.score_maximo === 'number' ? resumo.score_maximo : SCORE_MAXIMO_ICP,
    faixa,
    criterios: Array.isArray(resumo?.criterios) ? resumo.criterios : [],
    sinais_auto: resumo?.sinais_auto && typeof resumo.sinais_auto === 'object' ? resumo.sinais_auto : {},
    qualificacao,
    motivos: Array.isArray(resumo?.motivos) ? resumo.motivos : [],
    avaliado_em: lead?.icp_avaliado_em || null,
  }
}

function resumoIcpOperacional(lead) {
  const salvo = resumoIcpDoLead(lead)
  if (salvo.score != null) return { ...salvo, origem: 'salvo' }
  const calculado = calcularIcp(respostasIniciaisIcp(lead))
  return {
    ...salvo,
    score: calculado.score,
    score_maximo: calculado.score_maximo,
    faixa: calculado.faixa,
    criterios: calculado.criterios,
    origem: 'previsao',
  }
}

function temInstagramAtivo(lead = {}) {
  const origem = String(lead?.origem || '').toLowerCase()
  const seguidores = Number(lead?.seguidores)
  return origem === 'instagram'
    || origem === 'linkedin'
    || !!String(lead?.instagram_handle || '').trim()
    || !!String(lead?.bio || '').trim()
    || !!String(lead?.link_bio || '').trim()
    || (Number.isFinite(seguidores) && seguidores > 0)
}

function telefoneValidoSimples(valor) {
  const digitos = String(valor || '').replace(/\D/g, '')
  if (!digitos) return false
  const semDdi = digitos.startsWith('55') && (digitos.length === 12 || digitos.length === 13)
    ? digitos.slice(2)
    : digitos
  return semDdi.length === 10 || semDdi.length === 11
}

function qualificacaoFallback(lead = {}) {
  const penalidades = []
  const sinais = []
  const revisoes = []
  let score = 45
  const atividade = String(lead?.instagram_atividade || '')
  const semSite = lead?.situacao_site === 'sem_site' || lead?.tem_site === false
  const rating = Number(lead?.rating)
  const aval = Number(lead?.avaliacoes)
  if (semSite) { score += 14; sinais.push({ chave: 'sem_site_proprio', rotulo: 'Sem site proprio.', pontos: 14 }) }
  if (Number.isFinite(aval) && aval >= 20) { score += 6; sinais.push({ chave: 'avaliacoes', rotulo: 'Boa base de avaliacoes.', pontos: 6 }) }
  if (Number.isFinite(rating) && rating >= 4) { score += 4; sinais.push({ chave: 'nota_boa', rotulo: 'Boa nota no Google.', pontos: 4 }) }
  if (atividade === 'ativo_recente') { score += 14; sinais.push({ chave: 'instagram_ativo', rotulo: 'Instagram com post recente.', pontos: 14 }) }
  if (atividade === 'atividade_morna') { score += 7; sinais.push({ chave: 'instagram_morno', rotulo: 'Instagram com atividade morna.', pontos: 7 }) }
  if (atividade === 'atividade_antiga') { score -= 8; penalidades.push({ tipo: 'leve', chave: 'instagram_antigo', rotulo: 'Instagram sem atividade ha mais de 3 meses.', pontos: -8 }) }
  if (atividade === 'sem_posts') { score -= 6; penalidades.push({ tipo: 'leve', chave: 'instagram_sem_posts', rotulo: 'Instagram confirmado, mas sem posts.', pontos: -6 }) }
  if (!telefoneValidoSimples(lead?.telefone)) {
    score -= 22
    penalidades.push({ tipo: 'forte', chave: 'telefone_invalido', rotulo: 'Telefone ausente ou invalido.', pontos: -22 })
    revisoes.push({ chave: 'validar_contato', rotulo: 'Validar contato antes de abordar.' })
  }
  const scoreFinal = Math.max(0, Math.min(100, Math.round(score)))
  const validacao = penalidades.some((p) => p.tipo === 'forte')
    ? 'validacao_humana_obrigatoria'
    : penalidades.length || revisoes.length ? 'revisar_rapido' : 'apto_automatico'
  return {
    score_100: scoreFinal,
    faixa: scoreFinal >= 75 ? 'A' : scoreFinal >= 50 ? 'B' : scoreFinal >= 25 ? 'C' : 'fora',
    prioridade: scoreFinal >= 75 ? 'alta' : scoreFinal >= 50 ? 'media' : 'baixa',
    validacao,
    confianca: penalidades.length || revisoes.length ? 'media' : 'alta',
    bloqueios: [],
    penalidades,
    revisoes,
    sinais,
    motivos: [...penalidades.map((p) => p.rotulo), ...sinais.map((s) => s.rotulo)].slice(0, 6),
    dimensoes: {},
  }
}

function qualificacaoDoLead(lead = {}) {
  const resumo = lead && lead.icp_resumo_json && typeof lead.icp_resumo_json === 'object'
    ? lead.icp_resumo_json
    : null
  const q = resumo?.qualificacao || lead?.qualificacao_resumo
  if (q && typeof q === 'object' && typeof q.score_100 === 'number') return q
  return qualificacaoFallback(lead)
}

function seloValidacaoLead(validacao) {
  const chave = VALIDACAO_LEAD[validacao] ? validacao : 'revisar_rapido'
  return { chave, ...VALIDACAO_LEAD[chave] }
}

function sinaisAutomaticosDoLead(lead = {}) {
  const avaliacoes = Number(lead?.avaliacoes)
  const rating = Number(lead?.rating)
  const instagramAtivo = temInstagramAtivo(lead)
  const operacaoValidada = (Number.isFinite(avaliacoes) && avaliacoes >= 5) || (Number.isFinite(rating) && rating >= 4)
  const semSite = lead?.situacao_site === 'sem_site' || lead?.tem_site === false
  const lacunaDigital = semSite || (lead?.situacao_site === 'nao_identificado' && (instagramAtivo || !!String(lead?.link_original || '').trim()))
  return {
    operacao_validada: {
      sugerido: operacaoValidada,
      motivo: operacaoValidada ? 'Sinal automatico: reputacao/atividade publica.' : 'Sem evidencia automatica suficiente.',
    },
    instagram_ativo: {
      sugerido: instagramAtivo,
      motivo: instagramAtivo ? 'Sinal automatico: presenca social coletada.' : 'Sem sinal social coletado.',
    },
    lacuna_digital_clara: {
      sugerido: lacunaDigital,
      motivo: lacunaDigital ? 'Sinal automatico: sem site proprio claro.' : 'Lacuna digital nao confirmada automaticamente.',
    },
  }
}

function respostasIniciaisIcp(lead = {}) {
  const resumo = resumoIcpDoLead(lead)
  const respostas = {}
  for (const c of CRITERIOS_ICP_TENKA) respostas[c.id] = false
  if (Array.isArray(resumo.criterios) && resumo.criterios.length) {
    for (const c of resumo.criterios) respostas[c.id] = c.marcado === true
    return respostas
  }
  const sinais = sinaisAutomaticosDoLead(lead)
  for (const [id, sinal] of Object.entries(sinais)) respostas[id] = sinal.sugerido === true
  return respostas
}

function ordemIcp(lead) {
  const r = resumoIcpDoLead(lead)
  const selo = seloIcp(r.faixa, r.score)
  return selo.ordem * 100 + (r.score || 0)
}

function scoreCadastroNormalizado(lead = {}) {
  const score = Number(lead?.score_cadastro)
  const maximo = Number(lead?.score_cadastro_max)
  if (!Number.isFinite(score)) return 0
  if (Number.isFinite(maximo) && maximo > 0) return Math.max(0, Math.min(100, Math.round((score / maximo) * 100)))
  return Math.max(0, Math.min(100, Math.round(score)))
}

function prioridadeComercialLead(lead = {}) {
  const r = resumoIcpDoLead(lead)
  const selo = seloIcp(r.faixa, r.score)
  const qualificacao = qualificacaoDoLead(lead)
  const qualScore = Number(qualificacao?.score_100)
  const cadastro = scoreCadastroNormalizado(lead)
  const scoreIcp = typeof r.score === 'number' && Number.isFinite(r.score) ? r.score : 0

  // A ordenacao comercial privilegia ICP humano/comercial, depois a regua operacional.
  // Cadastro e' so desempate/evidencia; nao pode virar probabilidade de fechamento.
  return (selo.ordem * 1_000_000)
    + (scoreIcp * 10_000)
    + ((Number.isFinite(qualScore) ? qualScore : 0) * 100)
    + cadastro
}

module.exports = {
  CRITERIOS_ICP_TENKA,
  SCORE_MAXIMO_ICP,
  FAIXAS_ICP,
  VALIDACAO_LEAD,
  normalizarFaixaIcp,
  faixaPorScoreIcp,
  normalizarRespostasIcp,
  calcularIcp,
  seloIcp,
  qualificacaoDoLead,
  seloValidacaoLead,
  resumoIcpDoLead,
  resumoIcpOperacional,
  sinaisAutomaticosDoLead,
  respostasIniciaisIcp,
  ordemIcp,
  prioridadeComercialLead,
}
