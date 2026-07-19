'use strict'
// Saudação de análise por lead — gera a 1ª mensagem de prospecção personalizada pela
// IA a partir das lacunas do cadastro do lead (json de apresentação) + conhecimento
// da empresa (contexto da instância) + instruções extras da empresa. Read-only; não
// persiste nada. NUNCA lança: em qualquer falha retorna '' e o caller cai no template.
// Desenho aprovado na spec docs/superpowers/specs/2026-07-03-saudacao-analise-e-estagios-design.md
const { generateAIResponse } = require('../ai-provider')
const { getContextoComEstagios, montarConhecimentoDoContexto } = require('./contexto-estagios')

const TIMEOUT_MS = Math.max(5000, parseInt(process.env.SAUDACAO_IA_TIMEOUT_MS, 10) || 30000)
// Nº de RETENTATIVAS extras quando a IA falha/retorna vazio (garante que a geração
// funcione mesmo com falha transitória do provider). Default 1 (⇒ 2 tentativas no total).
const RETRIES = Math.max(0, Math.min(parseInt(process.env.SAUDACAO_IA_RETRIES, 10) || 1, 3))
// Pós-validação: acima disso conta como falha. A regra pede ≤400 chars; folga de 500.
const MAX_CHARS = 500

const SYSTEM_PROMPT = [
  'Você é um consultor comercial escrevendo UMA mensagem de abertura de WhatsApp em português do Brasil.',
  'Regras obrigatórias:',
  '- Tom humano e leve, como uma pessoa real (nada de "prezado", nada robótico).',
  '- Cumprimente pelo nome do lead.',
  '- Mostre que analisou o negócio citando 1 dado REAL dos DADOS DO LEAD.',
  '- Aponte 1 ou 2 lacunas do cadastro como oportunidade concreta de ganhar clientes.',
  '- Ofereça a solução e termine com UMA única pergunta.',
  '- Máximo 400 caracteres. NÃO invente dados que não estejam nos DADOS DO LEAD.',
  '- Se houver INSTRUÇÕES EXTRAS DA EMPRESA, siga-as (tom, CTA, oferta).',
  'Responda apenas com o texto final da mensagem — sem aspas, sem títulos, sem comentários.',
].join('\n')

// Remove o campo `.prompt` (instrução genérica embutida no json de apresentação) —
// aqui o system prompt já cobre a tarefa; enviamos só os dados/lacunas do lead.
function dadosSemPrompt(jsonApresentacao) {
  if (!jsonApresentacao || typeof jsonApresentacao !== 'object') return {}
  const { prompt: _p, ...resto } = jsonApresentacao
  return resto
}

/**
 * @param {object} args
 * @param {object} args.pool - pg Pool
 * @param {object} [args.log] - logger
 * @param {string} args.empresaId
 * @param {string|null} [args.contextoId] - contexto da instância (conhecimento da empresa)
 * @param {object} args.jsonApresentacao - saída de montarJsonApresentacaoPlaces/Instagram
 * @param {string} [args.instrucoes] - instruções extras da empresa (tom/CTA/oferta)
 * @param {string} [args.nomeLead]
 * @returns {Promise<string>} texto pronto ou '' em falha
 */
async function gerarSaudacaoAnalise({ pool, log, empresaId, contextoId, jsonApresentacao, instrucoes, nomeLead, _generate }) {
  const gerar = _generate || generateAIResponse
  try {
    let conhecimento = ''
    if (contextoId) {
      try {
        const ctx = await getContextoComEstagios(pool, empresaId, contextoId)
        conhecimento = montarConhecimentoDoContexto(ctx)
      } catch { conhecimento = '' }
    }

    const partes = []
    if (conhecimento && conhecimento.trim()) partes.push(`CONHECIMENTO DA EMPRESA\n${conhecimento.trim()}`)
    if (instrucoes && String(instrucoes).trim()) partes.push(`INSTRUÇÕES EXTRAS DA EMPRESA\n${String(instrucoes).trim()}`)
    partes.push(`DADOS DO LEAD${nomeLead ? ` (${nomeLead})` : ''}\n${JSON.stringify(dadosSemPrompt(jsonApresentacao), null, 2)}`)

    const input = {
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: partes.join('\n\n'),
      task: 'saudacaoAnaliseLead',
      maxTokens: 350,
      timeoutMs: TIMEOUT_MS,
      empresaId,
    }
    // Retenta em falha/vazio para maximizar a chance de gerar (garantir que funcione).
    for (let tentativa = 0; tentativa <= RETRIES; tentativa++) {
      try {
        const res = await gerar(input, pool, log)
        const texto = String(res?.text || '').trim()
        if (texto && texto.length <= MAX_CHARS) return texto
      } catch (e) {
        if (log && log.warn) log.warn({ err: e.message, tentativa }, '[saudacao-analise] tentativa falhou')
      }
    }
    return ''
  } catch (e) {
    if (log && log.warn) log.warn({ err: e.message }, '[saudacao-analise] falha geral')
    return ''
  }
}

module.exports = { gerarSaudacaoAnalise }
