// @ts-check

// Esta camada so' TRADUZ o veredito que veio da API. A qualificacao e' decidida no
// backend (services/qualificacao-bant.js); duplicar essa regra no front faria a tela
// divergir silenciosamente do que controla o handoff e a automacao.

const DIMENSOES_BANT = [
  { chave: 'necessidade', letra: 'N', rotulo: 'Necessidade' },
  { chave: 'timing', letra: 'T', rotulo: 'Timing' },
  { chave: 'autoridade', letra: 'A', rotulo: 'Autoridade' },
  { chave: 'budget', letra: 'B', rotulo: 'Budget' },
]

/** @type {Record<string, Record<string, string>>} */
const ROTULOS = {
  necessidade: {
    confirmada: 'Confirmada',
    sem_necessidade: 'Sem necessidade',
  },
  timing: {
    agora: 'Agora',
    curto_prazo: 'Curto prazo',
    futuro: 'Futuro',
    sem_prioridade: 'Sem prioridade',
  },
  autoridade: {
    decisor: 'Decisor',
    influenciador: 'Influenciador',
    precisa_aprovacao: 'Precisa de aprovação',
    nao_decisor: 'Não é decisor',
  },
  budget: {
    aberto_a_avaliar: 'Aberto a avaliar',
    faixa_compativel: 'Faixa compatível',
    sem_caixa_agora: 'Sem caixa agora',
    sem_prioridade: 'Sem prioridade',
    sem_urgencia: 'Sem urgência',
    precisa_aprovacao: 'Precisa de aprovação',
    nao_tem_orcamento: 'Sem orçamento',
  },
}

/** @param {string} dimensao @param {Record<string, unknown>} dado */
function estadoVisual(dimensao, dado) {
  const status = String(dado?.status || '')
  if (['sem_necessidade', 'sem_prioridade', 'nao_tem_orcamento'].includes(status)) return 'negativo'
  if (status === 'confirmada' || ['agora', 'curto_prazo', 'futuro', 'decisor', 'influenciador', 'aberto_a_avaliar', 'faixa_compativel'].includes(status)) return 'confirmado'
  // Falta de caixa, aprovação ou uma resposta ambígua pede esclarecimento; não é descarte.
  return 'pendente'
}

/** @param {string} dimensao @param {Record<string, unknown>} dado */
function rotuloDimensao(dimensao, dado) {
  const status = String(dado?.status || '')
  if (!status || status === 'desconhecida' || status === 'desconhecido') return 'Pendente'
  if (dado?.precisa_esclarecer) return 'Precisa esclarecer'
  return ROTULOS[dimensao]?.[status] || 'Pendente'
}

/** @param {Record<string, unknown> | null | undefined} qualificacao */
function traduzirQualificacaoBant(qualificacao) {
  const dados = qualificacao && typeof qualificacao === 'object' ? qualificacao : {}
  return {
    status: dados.status || 'sem_sinais',
    prontoParaAssuncao: dados.pronto_para_assuncao === true,
    naoQualificado: dados.nao_qualificado === true,
    dimensoes: DIMENSOES_BANT.map((dimensao) => {
      const valorBruto = dados[dimensao.chave]
      /** @type {Record<string, unknown>} */
      const dado = valorBruto && typeof valorBruto === 'object'
        ? /** @type {Record<string, unknown>} */ (valorBruto)
        : {}
      return {
        ...dimensao,
        estado: estadoVisual(dimensao.chave, dado),
        valor: rotuloDimensao(dimensao.chave, dado),
        evidencia: typeof dado.evidencia === 'string' ? dado.evidencia.trim() : '',
      }
    }),
  }
}

module.exports = { DIMENSOES_BANT, traduzirQualificacaoBant }
