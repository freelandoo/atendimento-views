'use strict'
// Assistente de Oportunidades (por lead) — REGRAS PURAS de fila e aprendizado.
//
// Este módulo não conhece banco, HTTP nem IA. Ele responde duas perguntas:
//   1. quais características descrevem um lead (sempre em FAIXAS, nunca PII);
//   2. em que ordem os leads devem ser oferecidos ao operador.
//
// A ordem tem duas parcelas somadas:
//   BASE       — oportunidade comercial por critérios fixos (quem tem dor digital e
//                movimento é candidato melhor). Não depende de histórico.
//   APRENDIZADO— desvio aprendido do que ESTA empresa aprovou e descartou antes.
//                Nasce em zero, cresce com a amostra e nunca vira o jogo sozinho.
//
// O aprendizado é deliberadamente simples e auditável: taxa de aprovação por
// característica, suavizada, comparada com a taxa geral da empresa. Sem modelo
// treinado, sem caixa-preta, sem configuração visível ao operador.

// Só considera uma característica "aprendida" com amostra mínima — abaixo disso, duas
// ou três decisões definiriam a fila inteira.
const AMOSTRA_MINIMA = 3
// Suavização de Laplace: puxa taxas extremas (0% / 100%) para o meio quando a amostra
// ainda é pequena.
const SUAVIZACAO = 2
// Teto do empurrão do aprendizado, em pontos. A base continua mandando.
const PESO_APRENDIZADO = 25
// Decisões antigas descrevem uma operação que talvez não exista mais.
const HISTORICO_MAX = 400

// Ausente é ausente: `Number(null)` é 0, e tratar "sem nota" como nota 0 (ou "cadastro
// desconhecido" como cadastro fraco) inflaria justamente os leads sobre os quais não
// sabemos nada.
function num(valor) {
  if (valor == null || valor === '') return null
  const n = Number(valor)
  return Number.isFinite(n) ? n : null
}

function texto(valor) {
  return String(valor == null ? '' : valor).trim()
}

// Chave estável de nicho: minúscula, sem acento, sem espaço duplo.
function chaveNicho(valor) {
  return texto(valor).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')
}

// ── Características ────────────────────────────────────────────────────────────
// Sempre categóricas e sempre em faixa. Um valor contínuo (nota 4.3) nunca se repete
// o bastante para virar aprendizado; a faixa ("nota_alta") se repete.
function caracteristicasDoLead(lead = {}) {
  const rating = num(lead.rating)
  const avaliacoes = num(lead.avaliacoes)
  const cadastro = num(lead.score_cadastro)
  const temSite = !!(lead.tem_site || texto(lead.site))
  const temTelefone = !!texto(lead.telefone)
  const temEmail = !!texto(lead.email)

  return {
    site: temSite ? 'com_site' : 'sem_site',
    contato: temTelefone ? 'com_telefone' : 'sem_telefone',
    email: temEmail ? 'com_email' : 'sem_email',
    nota: rating == null ? 'sem_nota' : rating >= 4 ? 'nota_alta' : 'nota_baixa',
    avaliacoes: avaliacoes == null || avaliacoes <= 0
      ? 'sem_avaliacoes'
      : avaliacoes >= 50 ? 'muitas_avaliacoes' : 'poucas_avaliacoes',
    cadastro: cadastro == null
      ? 'cadastro_desconhecido'
      : cadastro <= 40 ? 'cadastro_fraco' : cadastro <= 70 ? 'cadastro_medio' : 'cadastro_forte',
    nicho: chaveNicho(lead.nicho) || 'sem_nicho',
  }
}

// ── Base determinística ────────────────────────────────────────────────────────
// Pontos e o motivo legível de cada um. O motivo é o que o operador lê quando a IA
// não responde — por isso ele nasce aqui, não no prompt.
const REGRAS_BASE = [
  { quando: (c) => c.contato === 'com_telefone', pontos: 15, motivo: 'Tem telefone para abordagem direta.' },
  { quando: (c) => c.site === 'sem_site', pontos: 30, motivo: 'Não tem site — a dor digital é evidente.' },
  { quando: (c) => c.cadastro === 'cadastro_fraco', pontos: 25, motivo: 'Cadastro fraco no Maps: muito espaço para melhorar.' },
  { quando: (c) => c.cadastro === 'cadastro_medio', pontos: 12, motivo: 'Cadastro incompleto no Maps.' },
  { quando: (c) => c.avaliacoes === 'muitas_avaliacoes', pontos: 15, motivo: 'Muitas avaliações: é um negócio com movimento.' },
  { quando: (c) => c.avaliacoes === 'poucas_avaliacoes', pontos: 7, motivo: 'Já recebe avaliações de clientes.' },
  { quando: (c) => c.nota === 'nota_alta', pontos: 8, motivo: 'Boa nota — cliente satisfeito costuma investir.' },
  { quando: (c) => c.email === 'com_email', pontos: 5, motivo: 'Tem e-mail além do telefone.' },
]

function pontuarBase(caracteristicas) {
  let pontos = 0
  const motivos = []
  for (const regra of REGRAS_BASE) {
    if (!regra.quando(caracteristicas)) continue
    pontos += regra.pontos
    motivos.push(regra.motivo)
  }
  return { pontos, motivos }
}

// ── Aprendizado ────────────────────────────────────────────────────────────────
/**
 * Lê o histórico de decisões da empresa e devolve, por característica, o quanto ela
 * puxa para cima ou para baixo. Faixa de cada peso: -1 (sempre descartado) a +1
 * (sempre aprovado), já suavizado pela amostra.
 *
 * @param {{decisao: string, caracteristicas: object}[]} decisoes
 */
function aprenderPesos(decisoes = []) {
  const recentes = (Array.isArray(decisoes) ? decisoes : []).slice(0, HISTORICO_MAX)
  const contagem = new Map()
  let aprovadosTotal = 0
  let total = 0

  for (const d of recentes) {
    const aprovado = d?.decisao === 'aprovado'
    const carac = d?.caracteristicas && typeof d.caracteristicas === 'object' ? d.caracteristicas : null
    if (!carac) continue
    total += 1
    if (aprovado) aprovadosTotal += 1
    for (const [campo, valor] of Object.entries(carac)) {
      if (!valor) continue
      const chave = `${campo}:${valor}`
      const atual = contagem.get(chave) || { aprovados: 0, total: 0 }
      atual.total += 1
      if (aprovado) atual.aprovados += 1
      contagem.set(chave, atual)
    }
  }

  // Sem histórico não há aprendizado — e isso é o estado correto no primeiro uso.
  if (total < AMOSTRA_MINIMA) return { pesos: {}, amostra: total, taxa_geral: 0 }

  const taxaGeral = aprovadosTotal / total
  const pesos = {}
  for (const [chave, { aprovados, total: n }] of contagem) {
    if (n < AMOSTRA_MINIMA) continue
    // Laplace: (a + α·taxaGeral) / (n + α). Com n pequeno, o valor cola na taxa geral.
    const taxa = (aprovados + (SUAVIZACAO * taxaGeral)) / (n + SUAVIZACAO)
    const desvio = taxa - taxaGeral
    // Normaliza para [-1, 1]: o desvio máximo possível é a distância até 0 ou 1.
    const alcance = desvio >= 0 ? Math.max(1 - taxaGeral, 0.001) : Math.max(taxaGeral, 0.001)
    pesos[chave] = Math.max(-1, Math.min(1, desvio / alcance))
  }
  return { pesos, amostra: total, taxa_geral: taxaGeral }
}

// Média dos pesos das características presentes (média, não soma: assim acrescentar
// características novas ao vetor não infla o aprendizado por acidente).
function ajusteAprendido(caracteristicas, pesos = {}) {
  const valores = []
  for (const [campo, valor] of Object.entries(caracteristicas || {})) {
    const peso = pesos[`${campo}:${valor}`]
    if (typeof peso === 'number') valores.push(peso)
  }
  if (!valores.length) return 0
  const media = valores.reduce((a, b) => a + b, 0) / valores.length
  return Math.round(media * PESO_APRENDIZADO)
}

/**
 * Pontua um lead. `pontos` é o que ordena a fila; `motivos` é a explicação de reserva
 * (usada tal e qual quando a IA não responde).
 */
function pontuarLead(lead, pesos = {}) {
  const caracteristicas = caracteristicasDoLead(lead)
  const base = pontuarBase(caracteristicas)
  const ajuste = ajusteAprendido(caracteristicas, pesos)
  const motivos = base.motivos.slice(0, 3)
  if (ajuste >= 8) motivos.push('Parecido com os leads que você costuma aprovar.')
  else if (ajuste <= -8) motivos.push('Parecido com os que você costuma descartar.')
  return {
    caracteristicas,
    base: base.pontos,
    ajuste,
    pontos: Math.max(0, base.pontos + ajuste),
    motivos,
  }
}

/**
 * Ordena os candidatos do melhor para o pior. Empate desfeito pelo lead mais recente
 * (o operador acabou de buscar; ver o que chegou agora é o comportamento esperado).
 */
function ordenarCandidatos(leads = [], pesos = {}) {
  return (Array.isArray(leads) ? leads : [])
    .map((lead) => ({ lead, avaliacao: pontuarLead(lead, pesos) }))
    .sort((a, b) => {
      if (b.avaliacao.pontos !== a.avaliacao.pontos) return b.avaliacao.pontos - a.avaliacao.pontos
      const da = new Date(a.lead?.created_at || 0).getTime() || 0
      const db = new Date(b.lead?.created_at || 0).getTime() || 0
      return db - da
    })
}

module.exports = {
  AMOSTRA_MINIMA,
  PESO_APRENDIZADO,
  HISTORICO_MAX,
  chaveNicho,
  caracteristicasDoLead,
  pontuarBase,
  aprenderPesos,
  ajusteAprendido,
  pontuarLead,
  ordenarCandidatos,
}
