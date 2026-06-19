'use strict'

/**
 * Memória objetiva do lead — perfil estruturado tipado.
 *
 * Regra fundamental: null = desconhecido, false = sabemos que não tem.
 * A IA só pode perguntar sobre campos com valor null.
 * false é informação valiosa — NÃO é campo faltante.
 *
 * Campos obrigatórios para avançar ao diagnóstico (getMissingInfo):
 *   businessType  → tipo do negócio
 *   city          → cidade/região
 *   mainService   → o que o lead procura
 *   hasWebsite    → já tem site ou não
 *   goal          → objetivo principal com a solução
 *
 * Atualização é imutável: mergeProfile sempre retorna novo objeto.
 * Campos já definidos nunca são sobrescritos (o primeiro dado coletado prevalece).
 */

// ─── Normalização ─────────────────────────────────────────────────────────────

function _norm(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

// ─── Extração: negócio / businessType ─────────────────────────────────────────

const PROFESSION_LIST = [
  'dentista', 'medico', 'medica', 'advogado', 'advogada', 'esteticista',
  'cabeleireiro', 'cabeleireira', 'nutricionista', 'engenheiro', 'arquiteto',
  'arquiteta', 'professor', 'professora', 'personal', 'fotografo', 'fotografa',
  'designer', 'veterinario', 'contador', 'contadora', 'psicólogo', 'psicologo',
  'fisioterapeuta', 'corretor', 'corretora',
]

function _extractBusinessType(original) {
  const patterns = [
    /\btrabalho\s+com\s+([^.\n,;]{2,60})/i,
    /\b(?:minha\s+empresa|meu\s+neg[oó]cio|meu\s+ramo|nosso\s+(?:neg[oó]cio|ramo))\s+(?:[eé]\s+|de\s+|com\s+|:\s*)?([^.\n,;]{2,60})/i,
    /\btenho\s+(?:uma|um)\s+([^.\n,;]{2,60})/i,
    /\bsou\s+(?:dono\s+de\s+(?:uma|um)\s+|um\s+|uma\s+)([^.\n,;]{2,60})/i,
  ]

  for (const re of patterns) {
    const m = original.match(re)
    if (m && m[1]) {
      let v = m[1].trim()
        .replace(/\s+e\s+atendo.*$/i, '')
        .replace(/\s+atendo.*$/i, '')
        .replace(/\s+em\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ].*$/, '')
        .replace(/\s+procuro.*$/i, '')
        .trim()
      if (v.length >= 2 && v.length <= 60 && !/^(de|em|na|no|um|uma)$/i.test(v)) {
        return v
      }
    }
  }

  // Profissão explícita: "sou dentista", "sou médica"
  const normOrig = _norm(original)
  const profMatch = normOrig.match(/\bsou\s+([\w]+)/)
  if (profMatch && PROFESSION_LIST.includes(profMatch[1])) {
    return profMatch[1]
  }

  return null
}

// ─── Extração: cidade / city ──────────────────────────────────────────────────

function _extractCity(original) {
  const patterns = [
    // "moro em X", "estou em X", "sou de X" (sem profissão no meio)
    /\b(?:sou|moro|estou|estamos|vivo)\s+(?:em|de|na|no)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ' ]{1,40}?)(?=[,.;]|\s+e\s+atend|\s+atend|\s+procur|\s*$|\n)/i,
    /\bcidade\s+(?:de\s+|é\s+|:\s*)?([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ' ]{1,40}?)(?=[,.;]|\s*$|\n)/i,
    /\batendo\s+(?:em\s+|na\s+|no\s+)?([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ' ]{1,40}?)(?=[,.;]|\s*$|\n|\s+e\s+|\s+procur)/i,
    // Fallback geral: "em [Cidade]" — captura "sou dentista em SP", "trabalho em Santos"
    /\bem\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ' ]{1,40}?)(?=[,;.]|\s+e\s+(?:n[aã]o|tenho|quero|vou|atend|procur)|\s*$|\n)/i,
  ]
  for (const re of patterns) {
    const m = original.match(re)
    if (m && m[1]) {
      const v = m[1].trim()
      if (v.length >= 2 && v.length <= 50) return v
    }
  }
  return null
}

// ─── Extração: serviço principal / mainService ────────────────────────────────

function _extractMainService(s) {
  if (/\bagente\s+de\s+ia\b/.test(s)) return 'agente de IA'
  if (/\bautoma[cç][aã]o\b|\bautomatiz/.test(s)) return 'automacao'
  if (/\bsistema\b|\berp\b|\bcrm\b|\bdashboard\b|\bpainel\b/.test(s)) return 'sistema'
  if (/\bsite\b|\blanding\b|\bwebsite\b|\bpagina\b/.test(s)) return 'site'
  if (/\bsolu[cç][aã]o\s+(?:personalizada|sob\s+medida|customizada)\b|\bsob\s+medida\b/.test(s)) return 'solucao sob medida'
  return null
}

// ─── Extração: presença digital ──────────────────────────────────────────────
// null = desconhecido, true = tem/usa, false = não tem/não usa

function _extractHasWebsite(s) {
  if (/\bnao\s+(tenho|possuo)\s+(um\s+)?site\b/.test(s)) return false
  if (/\bsem\s+site\b/.test(s)) return false
  if (/\bnunca\s+tive\s+site\b/.test(s)) return false
  if (/\b(tenho|possuo|meu)\s+(um\s+)?(site|website)\b/.test(s)) return true
  if (/\bja\s+tenho\s+(um\s+)?site\b/.test(s)) return true
  return null
}

function _extractUsesInstagram(s) {
  if (/\bnao\s+(uso|tenho)\s+instagram\b/.test(s)) return false
  if (/\bsem\s+instagram\b/.test(s)) return false
  if (/\b(uso|tenho|meu\s+(insta|instagram))\b/.test(s) && /instagram|insta\b/.test(s)) return true
  if (/\bsou\s+ativo\s+no\s+instagram\b/.test(s)) return true
  return null
}

function _extractUsesWhatsApp(s) {
  if (/\bnao\s+(uso|atendo\s+pelo)\s+whatsapp\b/.test(s)) return false
  if (/\b(uso|atendo\s+pelo|meu)\s+whatsapp\b/.test(s)) return true
  return null
}

function _extractAppearsOnGoogle(s) {
  if (/\bnao\s+(apareco|estou)\s+(no|no\s+topo\s+do)\s+google\b/.test(s)) return false
  if (/\bnao\s+apareco\s+no\s+google\b/.test(s)) return false
  if (/\binvisivel\s+no\s+google\b/.test(s)) return false
  if (/\b(apareco|estou)\s+no\s+google\b/.test(s)) return true
  if (/\bgoogle\s+meu\s+negocio\b/.test(s)) return true
  if (/\bestou\s+no\s+google\s+maps\b/.test(s)) return true
  return null
}

// ─── Extração: objetivo / goal ────────────────────────────────────────────────

function _extractGoal(s) {
  if (/\bautoridade\b|\bser\s+referencia\b|\bcredibilidade\b|\bser\s+reconhecido\b/.test(s)) {
    return 'authority'
  }
  if (/\bgerar\s+(clientes|leads|vendas)\b|\bcaptar\s+clientes\b|\batrair\s+clientes\b|\bmais\s+clientes\b/.test(s)) {
    return 'leads'
  }
  if (/\baparec[ea]r\s+(no\s+)?google\b|\branquear\b|\bseo\b|\bprimeira\s+pagina\b/.test(s)) {
    return 'google'
  }
  if (/\bpresenca\s+profissional\b|\bsite\s+profissional\b|\bparecer\s+(mais\s+)?profissional\b|\bimagem\s+profissional\b/.test(s)) {
    return 'professional_presence'
  }
  return null
}

// ─── Extração: sinal de budget ────────────────────────────────────────────────

function _extractBudgetSignal(s) {
  if (/\bnao\s+tenho\s+(muito|budget|verba|grana)\b|\bsem\s+(verba|budget|dinheiro)\b|\beconomic[ao]\b/.test(s)) {
    return 'low'
  }
  if (/\bnao\s+me\s+preocupo\s+com\s+preco\b|\bquero\s+o\s+melhor\b|\bqualidade\s+primeiro\b/.test(s)) {
    return 'high'
  }
  return null
}

// ─── Extração: interesse em reunião ──────────────────────────────────────────

function _extractMeetingInterest(s) {
  if (/\bnao\s+quero\s+reuniao\b|\bprefiro\s+por\s+aqui\b|\bsem\s+reuniao\b/.test(s)) return false
  if (/\bquero\s+(marcar|agendar|conversar)\b|\bdisponivel\s+para\s+conversar\b/.test(s)) return true
  if (/\bpode\s+ser\s+(amanha|segunda|terca|quarta|quinta|sexta|sabado)\b/.test(s)) return true
  return null
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Extrai dados do lead de uma mensagem de texto.
 * Retorna apenas os campos detectados (campos sem match são omitidos).
 *
 * @param {string} texto  Mensagem do lead (texto livre)
 * @returns {object}  Partial<LeadProfile>
 */
function extractFromMessage(texto) {
  if (!texto || typeof texto !== 'string') return {}
  const original = String(texto).trim()
  if (!original) return {}
  const s = _norm(original)
  const patch = {}

  const businessType = _extractBusinessType(original)
  if (businessType !== null) patch.businessType = businessType

  const city = _extractCity(original)
  if (city !== null) patch.city = city

  const mainService = _extractMainService(s)
  if (mainService !== null) patch.mainService = mainService

  const hasWebsite = _extractHasWebsite(s)
  if (hasWebsite !== null) patch.hasWebsite = hasWebsite

  const usesInstagram = _extractUsesInstagram(s)
  if (usesInstagram !== null) patch.usesInstagram = usesInstagram

  const usesWhatsApp = _extractUsesWhatsApp(s)
  if (usesWhatsApp !== null) patch.usesWhatsApp = usesWhatsApp

  const appearsOnGoogle = _extractAppearsOnGoogle(s)
  if (appearsOnGoogle !== null) patch.appearsOnGoogle = appearsOnGoogle

  const goal = _extractGoal(s)
  if (goal !== null) patch.goal = goal

  const budgetSignal = _extractBudgetSignal(s)
  if (budgetSignal !== null) patch.budgetSignal = budgetSignal

  const meetingInterest = _extractMeetingInterest(s)
  if (meetingInterest !== null) patch.meetingInterest = meetingInterest

  return patch
}

/**
 * Retorna os campos ainda desconhecidos (null ou undefined).
 *
 * IMPORTANTE: false é valor conhecido — significa "não tem/não quer".
 * A IA NÃO deve perguntar sobre campo com valor false.
 *
 * @param {object} profile
 * @returns {string[]}  Nomes dos campos que precisam ser coletados
 */
function getMissingInfo(profile = {}) {
  const missing = []
  if (profile.businessType == null) missing.push('businessType')
  if (profile.city == null) missing.push('city')
  if (profile.mainService == null) missing.push('mainService')
  if (profile.hasWebsite == null) missing.push('hasWebsite')
  if (profile.goal == null) missing.push('goal')
  return missing
}

/**
 * Mescla atualizações no perfil existente sem sobrescrever campos já definidos.
 * Retorna novo objeto (imutável). O primeiro dado coletado sempre prevalece.
 *
 * @param {object} existing  Perfil atual
 * @param {object} updates   Campos extraídos da mensagem mais recente
 * @returns {object}  Novo perfil mesclado
 */
function mergeProfile(existing = {}, updates = {}) {
  const merged = { ...existing }
  for (const [key, value] of Object.entries(updates)) {
    if (merged[key] == null && value != null) {
      merged[key] = value
    }
  }
  return merged
}

/**
 * Converte o schema do banco (vendas.perfil_lead) para LeadProfile.
 * Campos novos (tem_site, usa_instagram, etc.) retornam null se ainda não existirem no banco.
 *
 * @param {object} dbPerfil  Linha de vendas.perfil_lead
 * @returns {object}  LeadProfile
 */
function fromDbProfile(dbPerfil = {}) {
  const rp = typeof dbPerfil.reuniao_proposta === 'object' && dbPerfil.reuniao_proposta !== null
    ? dbPerfil.reuniao_proposta
    : {}

  return {
    businessType: dbPerfil.negocio || dbPerfil.tipo_negocio || null,
    city: dbPerfil.cidade || dbPerfil.cidade_base || dbPerfil.regiao_atendimento || null,
    mainService: dbPerfil.servico_principal || dbPerfil.servico_foco || dbPerfil.necessidade || null,
    hasWebsite: dbPerfil.tem_site ?? null,
    usesInstagram: dbPerfil.usa_instagram ?? null,
    usesWhatsApp: dbPerfil.usa_whatsapp ?? null,
    appearsOnGoogle: dbPerfil.aparece_google ?? null,
    goal: dbPerfil.objetivo || null,
    budgetSignal: _budgetFromDb(dbPerfil),
    meetingInterest: rp.necessaria ?? null,
  }
}

function _budgetFromDb(dbPerfil) {
  const ticket = dbPerfil.ticket_cliente_final || dbPerfil.ticket_medio
  if (ticket === 'baixo') return 'low'
  if (ticket === 'medio') return 'medium'
  if (ticket === 'alto' || ticket === 'premium') return 'high'
  if (dbPerfil.temperatura_lead === 'frio') return 'low'
  return null
}

module.exports = { extractFromMessage, getMissingInfo, mergeProfile, fromDbProfile }
