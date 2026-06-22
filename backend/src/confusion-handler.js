'use strict'

/**
 * Resolvedor de confusão entre site, anúncio e Google.
 *
 * Muitos leads chegam confusos sobre o que a {{empresa}} oferece.
 * Eles podem ter clicado num anúncio e achar que vendemos:
 *   - Google Ads / tráfego pago
 *   - Impulsionamento de post
 *   - Aparecer no Google imediatamente (SEO pago)
 *   - App para baixar
 *
 * Regra: sempre que houver confusão, a IA explica ANTES de vender.
 *
 * Integração com intent-detector.js:
 *   detectIntent(message) → { confusionDetected, confusionType }
 *   buildClarificationResponse(confusionType) → texto da explicação
 */

const { CONFUSION_TYPES } = require('./intent-detector')

// ─── Keywords exatas do spec ──────────────────────────────────────────────────

const confusionKeywords = [
  'anúncio',
  'anuncio',
  'ads',
  'google',
  'aparecer',
  'pesquisar',
  'divulgação',
  'divulgacao',
  'impulsionar',
]

// ─── Detecção por keyword (conforme spec) ─────────────────────────────────────

/**
 * Detecta confusão procurando as confusionKeywords na mensagem.
 * Mais amplo que o `intent-detector` — captura qualquer menção às palavras-chave.
 *
 * @param {string} message
 * @returns {{ isConfused: boolean, matchedKeywords: string[] }}
 */
function detectConfusionByKeywords(message) {
  const lower = String(message || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

  const matchedKeywords = confusionKeywords.filter((kw) => {
    const kwNorm = kw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    return lower.includes(kwNorm)
  })

  return {
    isConfused: matchedKeywords.length > 0,
    matchedKeywords,
  }
}

/**
 * Retorna true se devemos clarificar antes de prosseguir com o fluxo de vendas.
 * Aplica para qualquer resultado do intent-detector que tenha confusão detectada,
 * ou para mensagens que contenham as confusionKeywords.
 *
 * @param {object} intentResult  Saída de detectIntent(message)
 * @param {string} [message]     Mensagem original (para keyword check adicional)
 * @returns {boolean}
 */
function shouldClarifyFirst(intentResult, message) {
  if (!intentResult) return false

  // Prioridade 1: intent-detector já detectou confusão estrutural
  if (intentResult.confusionDetected) return true

  // Prioridade 2: keyword match — lead mencionou palavra de confusão + perguntou preço/interesse
  if (message) {
    const { isConfused } = detectConfusionByKeywords(message)
    if (isConfused) {
      const priceOrInterestIntents = ['asking_price', 'interested', 'asking_google', 'unclear']
      return priceOrInterestIntents.includes(intentResult.intent)
    }
  }

  return false
}

// ─── Templates de clarificação por tipo ──────────────────────────────────────

/**
 * Texto de clarificação para confusão site vs anúncio/Google.
 * Termina com pergunta de diagnóstico (coleta hasWebsite, usesInstagram, usesWhatsApp).
 */
const CLARIFICATION_SITE_AD_GOOGLE = [
  'Boa pergunta. Só para deixar claro: aqui não é apenas um anúncio.',
  'O que criamos é uma estrutura digital para sua empresa se apresentar melhor, mostrar seus serviços e levar o cliente para o WhatsApp. Depois, isso pode ajudar sua presença no Google com o tempo, mas não é promessa de aparecer imediatamente.',
  'Hoje você já tem site ou usa mais Instagram/WhatsApp?',
].join('\n\n')

/**
 * Texto de clarificação para confusão SEO orgânico vs Google Ads.
 */
const CLARIFICATION_ORGANIC_PAID = [
  'Entendo a dúvida — é bem comum confundir.',
  'Diferente de anúncios pagos (Google Ads, que cobram por clique e somem quando você para de pagar), o que fazemos é uma estrutura digital permanente: site, apresentação dos serviços e caminho direto para o WhatsApp.',
  'Isso contribui para sua presença digital com o tempo, mas de forma orgânica, não como anúncio pago.',
  'Você já investe em algum tipo de anúncio hoje ou ainda não experimentou?',
].join('\n\n')

/**
 * Texto de clarificação para confusão site vs app para baixar.
 */
const CLARIFICATION_SITE_APP = [
  'Só para alinhar: o que criamos não é um aplicativo para baixar na loja.',
  'É uma presença digital acessível pelo navegador — o cliente entra pelo celular ou computador, vê os serviços da sua empresa e já tem o caminho direto para o WhatsApp.',
  'Nenhum download necessário, funciona direto no celular.',
  'Você já tem algum site ou página hoje?',
].join('\n\n')

/**
 * Texto de clarificação para confusão IA = chatbot simples.
 */
const CLARIFICATION_AI_CHATBOT = [
  'Só para deixar claro: o agente de IA que criamos é diferente de um chatbot simples de resposta automática.',
  'Ele entende o contexto da conversa, qualifica o lead, responde perguntas sobre seu negócio e encaminha para o time de vendas no momento certo — tudo de forma personalizada.',
  'Você já usa alguma automação de atendimento hoje, como resposta automática no WhatsApp?',
].join('\n\n')

/**
 * Texto genérico quando o tipo de confusão não se encaixa nos templates acima.
 */
const CLARIFICATION_GENERIC = [
  'Deixa eu explicar melhor o que fazemos antes de continuar.',
  'A {{empresa}} cria soluções digitais em código: sites profissionais, sistemas de agendamento, automações de atendimento e agentes de IA — tudo para organizar a presença digital, atendimento e vendas da sua empresa.',
  'Não fazemos anúncios pagos, não somos agência de tráfego. Criamos estrutura permanente.',
  'Qual é o principal problema que você quer resolver hoje?',
].join('\n\n')

// Mapa de confusionType → texto de clarificação
const CLARIFICATION_TEXTS = {
  [CONFUSION_TYPES.SITE_AD_GOOGLE]: CLARIFICATION_SITE_AD_GOOGLE,
  [CONFUSION_TYPES.ORGANIC_PAID]: CLARIFICATION_ORGANIC_PAID,
  [CONFUSION_TYPES.SITE_APP]: CLARIFICATION_SITE_APP,
  [CONFUSION_TYPES.AI_CHATBOT]: CLARIFICATION_AI_CHATBOT,
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Retorna o texto de clarificação adequado para o tipo de confusão.
 * Se o tipo não for reconhecido, retorna o texto genérico.
 *
 * @param {string|null} confusionType  Valor de CONFUSION_TYPES ou null
 * @returns {string}  Texto pronto para enviar como resposta
 */
function buildClarificationResponse(confusionType) {
  return CLARIFICATION_TEXTS[confusionType] || CLARIFICATION_GENERIC
}

/**
 * Função principal: recebe a mensagem e o resultado do intent-detector,
 * decide se deve clarificar e retorna os dados necessários.
 *
 * @param {string} message      Mensagem do lead
 * @param {object} intentResult Saída de detectIntent(message)
 * @returns {{
 *   shouldClarify: boolean,
 *   confusionType: string|null,
 *   matchedKeywords: string[],
 *   clarificationText: string|null,
 * }}
 */
function handleConfusion(message, intentResult) {
  const keywordResult = detectConfusionByKeywords(message)
  const clarify = shouldClarifyFirst(intentResult, message)

  // Determina o tipo: preferência ao tipo estrutural do intent-detector
  const confusionType = intentResult?.confusionType
    || (keywordResult.isConfused ? CONFUSION_TYPES.SITE_AD_GOOGLE : null)

  return {
    shouldClarify: clarify,
    confusionType,
    matchedKeywords: keywordResult.matchedKeywords,
    clarificationText: clarify ? buildClarificationResponse(confusionType) : null,
  }
}

module.exports = {
  confusionKeywords,
  detectConfusionByKeywords,
  shouldClarifyFirst,
  buildClarificationResponse,
  handleConfusion,
  CLARIFICATION_TEXTS,
}
