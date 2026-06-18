'use strict'

/**
 * Detector de intenção do lead — determinístico, sem LLM.
 *
 * Retorna a intenção primária da mensagem, intenções secundárias opcionais,
 * e um flag de confusão quando o lead demonstra entendimento errado do serviço.
 *
 * Intenções primárias:
 *   greeting              → "oi", "bom dia", primeira frase curta
 *   interested            → "tenho interesse", "quero saber mais"
 *   asking_price          → "quanto custa?", "qual o valor?"
 *   asking_google         → "aparece no Google?", "posicionamento", SEO
 *   asking_how_it_works   → "como funciona?", "o que vocês fazem?"
 *   sent_business_info    → "sou dentista em SP", forneceu dados do negócio
 *   objection_price       → "tá caro", "sem budget"
 *   objection_time        → "agora não", "vou pensar"
 *   objection_trust       → "não conheço vocês", "têm portfólio?"
 *   wants_meeting         → "quero agendar", "quando posso falar?"
 *   not_interested        → "não tenho interesse", "obrigado mas não"
 *   unclear               → não se encaixa em nenhum padrão acima
 *
 * Tipos de confusão (confusionType):
 *   client_confused_site_ad_google    → pensa que vendemos anúncios/tráfego pago
 *   client_confused_site_app          → pensa que fazemos app para baixar
 *   client_confused_ai_chatbot        → pensa que IA = chatbot simples de auto-resposta
 *   client_confused_organic_paid_ads  → mistura SEO orgânico com Google Ads
 */

const VALID_INTENTS = [
  'greeting',
  'interested',
  'asking_price',
  'asking_google',
  'asking_how_it_works',
  'sent_business_info',
  'objection_price',
  'objection_time',
  'objection_trust',
  'wants_meeting',
  'not_interested',
  'unclear',
]

const CONFUSION_TYPES = {
  SITE_AD_GOOGLE: 'client_confused_site_ad_google',
  SITE_APP: 'client_confused_site_app',
  AI_CHATBOT: 'client_confused_ai_chatbot',
  ORGANIC_PAID: 'client_confused_organic_paid_ads',
}

// ─── Regras de intenção (em ordem de prioridade) ──────────────────────────────
// Cada regra é testada contra o texto normalizado (sem acentos, lowercase).
// A primeira que bater vira intenção primária; as demais viram secundárias.

const INTENT_RULES = [
  {
    intent: 'not_interested',
    test: (s) =>
      /\bnao\s+tenho\s+interesse\b/.test(s) ||
      /\bnao\s+quero\b/.test(s) ||
      /\bnao\s+preciso\b/.test(s) ||
      /\bobrigad[ao]\s+mas\s+nao\b/.test(s) ||
      /\bvlw\s+mas\s+nao\b/.test(s) ||
      /\bvaleu\s+mas\s+nao\b/.test(s) ||
      /\bdesculp[ae]\s+mas\s+nao\b/.test(s),
  },
  {
    intent: 'asking_price',
    test: (s) =>
      /\b(quanto|preco|valor|investimento|orcamento|custa|custo|pagar|cobr[ao])\b/.test(s) ||
      /\bqual\s+(o\s+)?(preco|valor|custo|investimento)\b/.test(s) ||
      /\bquanto\s+(fica|sai|vai\s+sair|vou\s+pagar|e|custa)\b/.test(s) ||
      /\bme\s+(fala|diz|manda|passa)\s+(o\s+)?(preco|valor|custo)\b/.test(s) ||
      /\btabela\s+de\s+preco\b/.test(s) ||
      /\bplano(s)?\b/.test(s),
  },
  {
    intent: 'asking_google',
    test: (s) =>
      /\baparece\s+(no|no\s+topo\s+do)\s+google\b/.test(s) ||
      /\baparecer\s+(no|em\s+primeiro)\s+google\b/.test(s) ||
      /\branquear\b/.test(s) ||
      /\bseo\b/.test(s) ||
      /\bposicionamento\s+(no\s+)?google\b/.test(s) ||
      /\bgoogle\s+meu\s+negocio\b/.test(s) ||
      /\bgoogle\s+maps\b/.test(s) ||
      /\bprimeira\s+pagina\s+(do\s+)?google\b/.test(s) ||
      /\baparecer\s+(no\s+)?google\b/.test(s),
  },
  {
    intent: 'wants_meeting',
    test: (s) =>
      /\bquero\s+(marcar|agendar|conversar|falar)\b/.test(s) ||
      /\bpodemos\s+(conversar|falar|marcar)\b/.test(s) ||
      /\bhorario\s+disponivel\b/.test(s) ||
      /\bquando\s+(posso|voce\s+pode)\s+(falar|ligar|conversar)\b/.test(s) ||
      /\bvideo(conf|chamada|call)\b/.test(s) ||
      /\bzoom\b/.test(s) ||
      /\bgoogle\s+meet\b/.test(s) ||
      /\bme\s+liga\b/.test(s),
  },
  {
    intent: 'asking_how_it_works',
    test: (s) =>
      /\bcomo\s+funciona\b/.test(s) ||
      /\bcomo\s+e\s+o\s+processo\b/.test(s) ||
      /\bcomo\s+voces\s+trabalham\b/.test(s) ||
      /\bo\s+que\s+voces\s+(fazem|entregam|oferecem)\b/.test(s) ||
      /\bme\s+explica\b/.test(s) ||
      /\bexplica\s+melhor\b/.test(s) ||
      /\bcomo\s+seria\b/.test(s) ||
      /\bcomo\s+comeca\b/.test(s),
  },
  {
    intent: 'objection_price',
    test: (s) =>
      /\bcar[ao]\b/.test(s) ||
      /\bmuito\s+caro\b/.test(s) ||
      /\bficou\s+caro\b/.test(s) ||
      /\bachei\s+caro\b/.test(s) ||
      /\bta\s+salgado\b/.test(s) ||
      /\bsem\s+verba\b/.test(s) ||
      /\bsem\s+budget\b/.test(s) ||
      /\bsem\s+dinheiro\b/.test(s) ||
      /\bnao\s+tenho\s+(budget|verba|grana|dinheiro)\b/.test(s),
  },
  {
    intent: 'objection_time',
    test: (s) =>
      /\bagora\s+nao\b/.test(s) ||
      /\bnuma\s+proxima\b/.test(s) ||
      /\bmais\s+pra\s+frente\b/.test(s) ||
      /\bnao\s+e\s+o\s+momento\b/.test(s) ||
      /\bvou\s+(pensar|ver|avaliar|decidir\s+depois|passar)\b/.test(s) ||
      /\bdepois\s+a\s+gente\s+conversa\b/.test(s),
  },
  {
    intent: 'objection_trust',
    test: (s) =>
      /\bnao\s+conheco\s+voces\b/.test(s) ||
      /\bquem\s+sao\s+voces\b/.test(s) ||
      /\bcomo\s+sei\s+(que|se)\b/.test(s) ||
      /\balgum\s+exemplo\b/.test(s) ||
      /\bportfolio\b/.test(s) ||
      /\breferencia\b/.test(s) ||
      /\btrabalho(s)?\s+de\s+voces\b/.test(s) ||
      /\bjá\s+fizeram\b/.test(s) ||
      /\bprova\s+(disso|que)\b/.test(s) ||
      /\bsite\s+que\s+voces\s+fizeram\b/.test(s),
  },
  {
    intent: 'interested',
    test: (s) =>
      /\btenho\s+interesse\b/.test(s) ||
      /\bme\s+interessa\b/.test(s) ||
      /\bquero\s+(contratar|fazer|ter|um\s+site|um\s+sistema)\b/.test(s) ||
      /\bvou\s+querer\b/.test(s) ||
      /\bpode\s+me\s+ajudar\b/.test(s) ||
      /\bpreciso\s+de\b/.test(s) ||
      /\bprocuro\b/.test(s) ||
      /\bto\s+(precisando|querendo)\b/.test(s) ||
      /\bestou\s+(precisando|querendo|buscando)\b/.test(s) ||
      /\bgostei\b/.test(s) ||
      /\btopo\b/.test(s),
  },
  {
    intent: 'sent_business_info',
    test: (s) =>
      /\bsou\s+(dono|proprietario|gerente|responsavel|o\s+dono|dentista|medico|advogado|esteticista|cabeleireiro)\b/.test(s) ||
      /\btrabalho\s+com\b/.test(s) ||
      /\bmeu\s+negocio\s+e\b/.test(s) ||
      /\bminha\s+(empresa|loja|clinica|oficina|academia)\b/.test(s) ||
      /\batendo\s+(em|na|no)\b/.test(s) ||
      /\bfico\s+(em|na|no)\b/.test(s) ||
      /\bsou\s+de\s+[a-z]{3,}\b/.test(s),
  },
  {
    intent: 'greeting',
    test: (s) =>
      /^(oi|ola|bom\s+dia|boa\s+tarde|boa\s+noite|tudo\s+(bem|certo|bom)|e\s+ai|eai|hey|opa)[!?.,\s]*$/.test(s.trim()) ||
      /^(oi|ola)[!?,.\s]*[a-z\s]{0,20}$/.test(s.trim()),
  },
]

// ─── Regras de confusão ───────────────────────────────────────────────────────
// Testadas independentemente da intenção — são metadados adicionais.

const CONFUSION_RULES = [
  {
    type: CONFUSION_TYPES.SITE_AD_GOOGLE,
    test: (s) =>
      /\banuncio\b/.test(s) ||
      /\btrafego\s+pago\b/.test(s) ||
      /\bimpulsionamento\b/.test(s) ||
      /\bgoogle\s+ads\b/.test(s) ||
      /\bmeta\s+ads\b/.test(s) ||
      /\bfacebook\s+ads\b/.test(s) ||
      /\binstagram\s+ads\b/.test(s),
  },
  {
    type: CONFUSION_TYPES.SITE_APP,
    test: (s) =>
      /\bbaixar\b/.test(s) ||
      /\bapp\s+store\b/.test(s) ||
      /\bplay\s+store\b/.test(s) ||
      /\baplicativo\s+(para|pra)\s+(baixar|celular|ios|android)\b/.test(s) ||
      /\bapp\s+(para|pra)\s+(baixar|celular)\b/.test(s),
  },
  {
    type: CONFUSION_TYPES.AI_CHATBOT,
    test: (s) =>
      /\bchatbot\b/.test(s) ||
      /\bbot\s+(de|para|pra)\s+(whatsapp|telegram|chat|atendimento)\b/.test(s) ||
      /\bresposta\s+automatica\s+simples\b/.test(s) ||
      /\bauto\s+resposta\b/.test(s),
  },
  {
    type: CONFUSION_TYPES.ORGANIC_PAID,
    test: (s) =>
      (/\b(seo|organico|aparecer\s+no\s+google)\b/.test(s) &&
       /\b(pagar|pago|impulsionar|boost|anuncio)\b/.test(s)),
  },
]

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Detecta a intenção do lead em uma mensagem.
 *
 * @param {string} texto  Mensagem do lead (texto livre)
 * @returns {{
 *   intent: string,
 *   secondaryIntents: string[],
 *   confusionDetected: boolean,
 *   confusionType: string|null,
 * }}
 */
function detectIntent(texto) {
  const normalized = _normalize(String(texto || ''))

  let primary = 'unclear'
  const secondary = []

  for (const rule of INTENT_RULES) {
    if (rule.test(normalized)) {
      if (primary === 'unclear') {
        primary = rule.intent
      } else if (!secondary.includes(rule.intent)) {
        secondary.push(rule.intent)
      }
    }
  }

  let confusionDetected = false
  let confusionType = null

  for (const rule of CONFUSION_RULES) {
    if (rule.test(normalized)) {
      confusionDetected = true
      confusionType = rule.type
      break
    }
  }

  return {
    intent: primary,
    secondaryIntents: secondary,
    confusionDetected,
    confusionType,
  }
}

// ─── Interno ──────────────────────────────────────────────────────────────────

function _normalize(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

module.exports = { detectIntent, VALID_INTENTS, CONFUSION_TYPES }
