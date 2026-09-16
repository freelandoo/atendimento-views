'use strict'
// Modelo ICP Tenka v1.1 — Fase 1.
//
// Este modulo e' PURO: guarda vocabulario, criterios e validacao da ficha.
// Ele nao sabe nada de SQL nem de tela. A pergunta aqui e':
// "quais criterios contam para o ICP atual e como respostas viram score?"

const MODELO_TENKA_V1 = Object.freeze({
  id: '11111111-1111-4111-8111-111111110079',
  slug: 'tenka-v1-1',
  nome: 'Tenka v1.1',
  versao: 1,
})

const CRITERIOS_TENKA_V1 = Object.freeze([
  {
    id: 'operacao_validada',
    rotulo: 'Operacao validada',
    pontos: 1,
    tipo: 'humano_auto',
    explicacao: 'Prova de negocio real: clientes, avaliacoes, portfolio, estrutura visivel, historico ou operacao recorrente.',
  },
  {
    id: 'instagram_ativo',
    rotulo: 'Instagram ativo',
    pontos: 1,
    tipo: 'automatico',
    explicacao: 'Presenca social com atividade recente e preocupacao em mostrar servicos, resultados, qualidade ou bastidores.',
  },
  {
    id: 'imagem_valor',
    rotulo: 'Preocupacao com imagem',
    pontos: 1,
    tipo: 'humano',
    explicacao: 'Sinal de que o negocio tenta transmitir qualidade, profissionalismo e valor percebido.',
  },
  {
    id: 'investiu_marketing_tecnologia',
    rotulo: 'Ja investiu em marketing/tecnologia',
    pontos: 2,
    tipo: 'humano',
    explicacao: 'Sinal de investimento anterior em trafego, conteudo, IA, site, e-commerce, CRM, automacao ou outras solucoes digitais.',
  },
  {
    id: 'crescimento',
    rotulo: 'Esta em crescimento',
    pontos: 2,
    tipo: 'humano',
    explicacao: 'Movimento de expansao, melhora de estrutura, novos servicos, contratacao, divulgacao frequente ou aumento de oferta.',
  },
  {
    id: 'cliente_valor_relevante',
    rotulo: 'Cliente/contrato de valor relevante',
    pontos: 2,
    tipo: 'humano',
    explicacao: 'Poucas vendas novas poderiam pagar a solucao digital.',
  },
  {
    id: 'lacuna_digital_clara',
    rotulo: 'Lacuna digital clara',
    pontos: 2,
    tipo: 'humano_auto',
    explicacao: 'Diferenca clara entre qualidade do negocio e presenca digital: sem site, site fraco, site amador ou baixa conversao.',
  },
  {
    id: 'acesso_decisor',
    rotulo: 'Acesso facil ao decisor',
    pontos: 2,
    tipo: 'humano',
    explicacao: 'Rota curta ate quem decide: dono/fundador identificado e contato direto por telefone ou WhatsApp.',
  },
])

const CRITERIOS_POR_ID = Object.freeze(Object.fromEntries(CRITERIOS_TENKA_V1.map((c) => [c.id, c])))
const SCORE_MAXIMO = CRITERIOS_TENKA_V1.reduce((total, c) => total + c.pontos, 0)

function faixaPorScore(score) {
  const n = Number(score)
  if (!Number.isFinite(n) || n < 0) return 'fora'
  if (n >= 10) return 'A'
  if (n >= 6) return 'B'
  return 'C'
}

function normalizarBooleano(valor) {
  if (valor === true || valor === 1 || valor === '1') return true
  if (typeof valor === 'string') {
    const v = valor.trim().toLowerCase()
    if (['true', 'sim', 's', 'yes', 'y'].includes(v)) return true
    if (['false', 'nao', 'não', 'n', 'no'].includes(v)) return false
  }
  return false
}

function normalizarRespostas(respostas = {}) {
  const origem = respostas && typeof respostas === 'object' ? respostas : {}
  const out = {}
  for (const c of CRITERIOS_TENKA_V1) {
    out[c.id] = normalizarBooleano(origem[c.id])
  }
  return out
}

function calcularScoreRespostas(respostas = {}) {
  const norm = normalizarRespostas(respostas)
  const criterios = CRITERIOS_TENKA_V1.map((c) => ({
    ...c,
    marcado: !!norm[c.id],
    pontos_obtidos: norm[c.id] ? c.pontos : 0,
  }))
  const score = criterios.reduce((total, c) => total + c.pontos_obtidos, 0)
  return {
    modelo: MODELO_TENKA_V1,
    score,
    score_maximo: SCORE_MAXIMO,
    faixa: faixaPorScore(score),
    respostas: norm,
    criterios,
  }
}

module.exports = {
  MODELO_TENKA_V1,
  CRITERIOS_TENKA_V1,
  CRITERIOS_POR_ID,
  SCORE_MAXIMO,
  faixaPorScore,
  normalizarBooleano,
  normalizarRespostas,
  calcularScoreRespostas,
}
