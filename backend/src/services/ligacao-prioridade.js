'use strict'
// Prioridade COMERCIAL da fila da Central de Ligacoes. Funcoes PURAS e testaveis: recebem
// o lead ja lido do banco (colunas de prospectador.prospects + nº de tentativas de
// app.ligacoes) e devolvem elegibilidade + pontuacao explicavel. Nenhum dado novo e'
// coletado aqui — tudo ja existe no Banco de Leads / Bright Data.
//
// O que esta pontuacao NAO e': ela nao substitui `prospects.score` (qualidade/completude do
// CADASTRO). Aqui a pergunta e' outra — "quanto vale ligar para este negocio AGORA, numa
// campanha de criacao de site?". Por isso "tem site" derruba a prioridade sem excluir o lead.
//
// Pesos ficam agrupados em PESOS/FAIXAS para calibracao futura (por reunioes marcadas e
// conversoes), no mesmo padrao de services/followup-call-score.js.

// --- Pesos (0-100 no total, com clamp) ------------------------------------------------
const PESOS = Object.freeze({
  // Situacao do site — o sinal mais forte para uma campanha de criacao de site.
  site_ausente_confirmado: 40, // a ficha do Maps foi lida e nao havia site
  site_nao_identificado: 15,   // ninguem verificou (ex.: lead social) — vale investigar
  site_presente: 0,            // nao exclui o lead; so nao prioriza nesta campanha
  // Volume de avaliacoes = negocio ativo, com movimento real.
  avaliacoes_muitas: 20, // >= 50
  avaliacoes_medias: 12, // 20..49
  avaliacoes_poucas: 5,  // 5..19
  // Reputacao no Google (ate 10).
  nota_alta: 10,    // >= 4.5
  nota_boa: 7,      // >= 4.0
  nota_regular: 4,  // >= 3.5
  // Ja investe em presenca digital, mas sem site: dor evidente.
  rede_social_sem_site: 10,
  // Esforco ja gasto no telefone.
  sem_tentativa: 10,
  uma_tentativa: 5,
  duas_ou_mais_tentativas: 0,
})

const CORTES = Object.freeze({
  avaliacoes_muitas: 50,
  avaliacoes_medias: 20,
  avaliacoes_poucas: 5,
  nota_alta: 4.5,
  nota_boa: 4.0,
  nota_regular: 3.5,
})

// Faixas da pontuacao final (mesma escala de leitura do call score do Follow-ups).
const FAIXA_ALTA_MIN = 60
const FAIXA_MEDIA_MIN = 35

const FAIXA_LABEL = Object.freeze({
  alta: 'Alta prioridade',
  media: 'Prioridade media',
  baixa: 'Baixa prioridade',
})

const SCORE_MAX = 100

function faixaDoScore(score) {
  if (score >= FAIXA_ALTA_MIN) return 'alta'
  if (score >= FAIXA_MEDIA_MIN) return 'media'
  return 'baixa'
}

// --- Telefone discavel (requisito de ENTRADA na fila) ---------------------------------
// DIVIDA TECNICA DECLARADA: a mesma regra vive em frontend/lib/ligacao-fone.js
// (`analisarFone`), que cuida da EXIBICAO/discagem. backend/ e frontend/ sao pacotes npm
// separados e nao compartilham modulo; ao mudar a regra aqui, mude la tambem.
//
// Regra: telefone BR discavel = DDD + 8/9 digitos. O '+' EXPLICITO no texto original e' o
// desempatador entre DDI 55 e DDD 55 — '+55 3220-1234' declara DDI e revela a FALTA do DDD,
// enquanto '55 9999-8888' e' DDD 55 e disca normalmente.
function telefoneDiscavel(bruto) {
  const raw = bruto == null ? '' : String(bruto)
  const digitos = raw.replace(/\D/g, '')
  if (!digitos) return false
  const temPlus = /^\s*\+/.test(raw)
  let resto = digitos
  if (digitos.startsWith('55')) {
    const semDdi = digitos.slice(2)
    if (semDdi.length === 10 || semDdi.length === 11) resto = semDdi
    else if (temPlus && (semDdi.length === 8 || semDdi.length === 9)) return false // DDI sem DDD
  }
  return resto.length === 10 || resto.length === 11
}

/** Requisito de entrada na fila. Telefone valido NAO soma pontos — so deixa entrar. */
function elegivelParaFila(lead = {}) {
  return telefoneDiscavel(lead.telefone)
}

// --- Situacao do site ------------------------------------------------------------------
// Tres estados, porque "nao tem site" e "ninguem olhou" valem coisas diferentes numa
// campanha de criacao de site. `tem_site=false` so e' CONFIRMACAO quando a ficha do Google
// Maps foi lida (place_id presente) — leads sociais nunca tiveram o site verificado.
function situacaoSite(lead = {}) {
  const site = lead.site == null ? '' : String(lead.site).trim()
  if (site || lead.tem_site === true) return 'tem_site'
  const fichaMapsLida = !!(lead.place_id && String(lead.place_id).trim())
  if (lead.tem_site === false && fichaMapsLida) return 'sem_site'
  return 'nao_identificado'
}

const SITE_LABEL = Object.freeze({
  tem_site: 'Tem site',
  sem_site: 'Sem site',
  nao_identificado: 'Site nao identificado',
})

function temRedeSocial(lead = {}) {
  const ig = lead.instagram_handle == null ? '' : String(lead.instagram_handle).trim()
  const bio = lead.link_bio == null ? '' : String(lead.link_bio).trim()
  return !!(ig || bio)
}

function numeroOuNull(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function fmtNota(nota) {
  return Number(nota).toFixed(1).replace('.', ',')
}

/**
 * Pontuacao comercial (0-100) do lead para a campanha atual.
 * @param {object} lead nome/telefone irrelevantes aqui; usa site, tem_site, place_id,
 *   avaliacoes, rating, instagram_handle, link_bio e tentativas.
 * @returns {{score:number, faixa:'alta'|'media'|'baixa', faixa_label:string,
 *   situacao_site:'tem_site'|'sem_site'|'nao_identificado', motivos:string[]}}
 */
function calcularPrioridade(lead = {}) {
  const motivos = []
  let score = 0

  // 1) Site — o criterio dominante desta campanha.
  const site = situacaoSite(lead)
  if (site === 'sem_site') { score += PESOS.site_ausente_confirmado; motivos.push('Sem site') }
  else if (site === 'nao_identificado') { score += PESOS.site_nao_identificado; motivos.push('Site nao identificado') }
  else { score += PESOS.site_presente; motivos.push('Ja tem site') }

  // 2) Avaliacoes — volume indica negocio ativo. Ausente != zero: nao pontua e nao penaliza.
  const aval = numeroOuNull(lead.avaliacoes)
  if (aval != null && aval >= CORTES.avaliacoes_muitas) { score += PESOS.avaliacoes_muitas; motivos.push(`${aval} avaliacoes`) }
  else if (aval != null && aval >= CORTES.avaliacoes_medias) { score += PESOS.avaliacoes_medias; motivos.push(`${aval} avaliacoes`) }
  else if (aval != null && aval >= CORTES.avaliacoes_poucas) { score += PESOS.avaliacoes_poucas; motivos.push(`${aval} avaliacoes`) }

  // 3) Nota do Google (ate 10). Sem nota nao e' nota baixa — apenas nao soma.
  const nota = numeroOuNull(lead.rating)
  if (nota != null && nota >= CORTES.nota_alta) { score += PESOS.nota_alta; motivos.push(`Nota ${fmtNota(nota)}`) }
  else if (nota != null && nota >= CORTES.nota_boa) { score += PESOS.nota_boa; motivos.push(`Nota ${fmtNota(nota)}`) }
  else if (nota != null && nota >= CORTES.nota_regular) { score += PESOS.nota_regular; motivos.push(`Nota ${fmtNota(nota)}`) }

  // 4) Investe em presenca digital, mas sem site pronto.
  if (site !== 'tem_site' && temRedeSocial(lead)) {
    score += PESOS.rede_social_sem_site
    motivos.push('Ativo em rede social, sem site')
  }

  // 5) Esforco telefonico ja gasto.
  const tentativas = Math.max(0, Number.parseInt(lead.tentativas, 10) || 0)
  if (tentativas === 0) { score += PESOS.sem_tentativa; motivos.push('Nenhuma tentativa ainda') }
  else if (tentativas === 1) { score += PESOS.uma_tentativa; motivos.push('1 tentativa anterior') }
  else { score += PESOS.duas_ou_mais_tentativas; motivos.push(`${tentativas} tentativas anteriores`) }

  const final = Math.max(0, Math.min(SCORE_MAX, Math.round(score)))
  const faixa = faixaDoScore(final)
  return { score: final, faixa, faixa_label: FAIXA_LABEL[faixa], situacao_site: site, motivos }
}

/**
 * Monta a fila: descarta quem nao tem telefone discavel (nao entra e nao conta), anexa
 * `prioridade` e ordena por maior prioridade. Sort ESTAVEL: dentro do mesmo score, a ordem
 * que veio do SQL (status pendente primeiro, mais antigo antes) e' preservada.
 */
function montarFilaPriorizada(leads = []) {
  return leads
    .filter((l) => elegivelParaFila(l))
    .map((l) => ({ ...l, prioridade: calcularPrioridade(l) }))
    .sort((a, b) => b.prioridade.score - a.prioridade.score)
}

module.exports = {
  PESOS, CORTES, FAIXA_ALTA_MIN, FAIXA_MEDIA_MIN, FAIXA_LABEL, SITE_LABEL, SCORE_MAX,
  telefoneDiscavel, elegivelParaFila, situacaoSite, temRedeSocial,
  faixaDoScore, calcularPrioridade, montarFilaPriorizada,
}
