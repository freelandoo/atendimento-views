'use strict'
// Sinais e candidatos do Assistente de Oportunidades — lógica PURA (sem I/O), testável.
//
// Aqui é decidido O QUE sugerir, sempre por regra determinística sobre números reais.
// A IA entra depois, só para REDIGIR (services/aquisicao-assistente.js): ela não escolhe
// a ação, não muda o alvo e não inventa evidência.
//
// Três invariantes que este módulo sustenta:
//   1. toda sugestão carrega as EVIDÊNCIAS que a produziram (o admin confere a conta);
//   2. a `assinatura` discretiza a evidência em FAIXAS — enquanto o mercado não mudar
//      materialmente de faixa, uma sugestão dispensada não volta a aparecer;
//   3. dado insuficiente ou contraditório não vira recomendação (ver AMOSTRA_MINIMA_*
//      e o rebaixamento de "pausar" para "revisar" em mercado que converte).

// Amostras mínimas: abaixo disso o número é ruído, não sinal.
const AMOSTRA_MINIMA_COLETAS = 2       // execuções concluídas da rotina
const AMOSTRA_MINIMA_ENVIOS = 10       // leads efetivamente abordados no mercado
const FALHAS_PARA_REVISAR = 2

// Faixas da taxa de leads NOVOS por coleta (novos ÷ encontrados).
const TAXA_NOVOS_SATURADO = 0.10       // abaixo: a coleta traz quase só repetido
const TAXA_NOVOS_BAIXA = 0.30          // entre saturado e baixa: mercado repõe devagar
const TAXA_NOVOS_ALTA = 0.70           // acima: mercado fértil, vale importar mais

// Um mercado que está CONVERTENDO não é candidato a pausa, mesmo saturado de coleta:
// os dados se contradizem e a decisão passa a ser do humano (vira "revisar").
const RESPOSTAS_MERCADO_QUENTE = 3

const INTERVALO_MAX_HORAS = 168
const QUANTIDADE_MAX = 200

function inteiro(valor, padrao = 0) {
  const n = Number.parseInt(valor, 10)
  return Number.isFinite(n) ? n : padrao
}

function texto(valor) {
  return String(valor == null ? '' : valor).trim()
}

// "Campinas - SP" e "Campinas" são o MESMO mercado: os prospects guardam a localização
// já composta com a UF, as rotinas guardam cidade e UF separadas. Sem esta normalização
// o assistente sugeriria criar uma rotina que já existe.
function cidadeBase(valor) {
  return texto(valor).replace(/[-,/]\s*[A-Za-z]{2}\s*$/, '').trim()
}

function chaveMercado(nicho, cidade) {
  return `${texto(nicho).toLocaleLowerCase('pt-BR')}|${cidadeBase(cidade).toLocaleLowerCase('pt-BR')}`
}

// Discretiza um valor em faixas de largura `passo` — é o que dá estabilidade à
// assinatura: variação pequena não "renova" uma sugestão já dispensada.
function faixa(valor, passo) {
  const n = Number.isFinite(Number(valor)) ? Number(valor) : 0
  const base = Math.floor(n / passo) * passo
  return `${base}-${base + passo}`
}

function limitar(valor, min, max) {
  return Math.min(Math.max(valor, min), max)
}

// Desempenho de coleta de uma rotina a partir das execuções concluídas.
function desempenhoColeta(coletas) {
  const validas = (coletas || []).filter((c) => String(c.status) === 'concluido')
  const coletados = validas.reduce((soma, c) => soma + inteiro(c.coletados), 0)
  const novos = validas.reduce((soma, c) => soma + inteiro(c.novos), 0)
  return {
    execucoes: validas.length,
    coletados,
    novos,
    duplicados: Math.max(0, coletados - novos),
    // Sem nada encontrado a taxa é 0 (e não NaN): coleta que não acha nada é o pior caso.
    taxa_novos: coletados > 0 ? novos / coletados : 0,
  }
}

function pct(fracao) {
  return Math.round(fracao * 1000) / 10
}

// ── Regras ──────────────────────────────────────────────────────────────────────
// Cada regra devolve um candidato COMPLETO (inclusive o texto determinístico, que é o
// fallback quando a IA não responde) ou null.

function regraFalhasRecorrentes(rotina) {
  const falhas = inteiro(rotina.falhas_consecutivas)
  const precisaAtencao = String(rotina.estado || '') === 'precisa_atencao'
  if (!precisaAtencao && falhas < FALHAS_PARA_REVISAR) return null
  const local = rotina.uf ? `${rotina.cidade}/${rotina.uf}` : rotina.cidade
  return {
    tipo: 'revisar_rotina',
    rotina_id: rotina.id,
    nicho: rotina.nicho,
    cidade: rotina.cidade,
    uf: rotina.uf || null,
    parametros: {},
    prioridade: 95,
    confianca: 90,
    evidencias: {
      falhas_consecutivas: falhas,
      estado: rotina.estado,
      ultimo_erro: rotina.ultimo_erro || null,
    },
    assinatura: `revisar_rotina|rot:${rotina.id}|falhas:${falhas >= 3 ? '3+' : String(falhas)}`,
    titulo: `Revisar a rotina de ${rotina.nicho} em ${local}`,
    motivo: precisaAtencao
      ? `A rotina parou sozinha depois de ${falhas} tentativas seguidas sem sucesso.`
      : `As últimas ${falhas} tentativas desta rotina falharam.`,
    impacto: 'Enquanto não for revisada, este mercado não recebe leads novos.',
  }
}

function regraSaturacao(rotina, desempenho, mercado) {
  if (!rotina.ativo) return null
  if (desempenho.execucoes < AMOSTRA_MINIMA_COLETAS) return null
  if (desempenho.taxa_novos >= TAXA_NOVOS_SATURADO) return null

  const respostas = inteiro(mercado?.respostas)
  const local = rotina.uf ? `${rotina.cidade}/${rotina.uf}` : rotina.cidade
  // Dados contraditórios: coleta esgotada, mas o mercado está convertendo. Não mandamos
  // pausar o que dá resultado — devolvemos a decisão ao humano.
  const converte = respostas >= RESPOSTAS_MERCADO_QUENTE
  const evidencias = {
    execucoes_avaliadas: desempenho.execucoes,
    encontrados: desempenho.coletados,
    novos: desempenho.novos,
    duplicados: desempenho.duplicados,
    taxa_novos_pct: pct(desempenho.taxa_novos),
    respostas_no_mercado: respostas,
  }
  const assinatura = `${converte ? 'revisar_rotina' : 'pausar_rotina'}|rot:${rotina.id}`
    + `|taxa:${faixa(pct(desempenho.taxa_novos), 5)}|exec:${faixa(desempenho.execucoes, 3)}`

  return {
    tipo: converte ? 'revisar_rotina' : 'pausar_rotina',
    rotina_id: rotina.id,
    nicho: rotina.nicho,
    cidade: rotina.cidade,
    uf: rotina.uf || null,
    parametros: {},
    prioridade: converte ? 75 : 85,
    confianca: limitar(60 + (desempenho.execucoes * 5), 60, 85),
    evidencias,
    assinatura,
    titulo: converte
      ? `Revisar a rotina de ${rotina.nicho} em ${local}`
      : `Pausar a rotina de ${rotina.nicho} em ${local}`,
    motivo: converte
      ? `Nas últimas ${desempenho.execucoes} execuções quase tudo já estava na sua base `
        + `(${desempenho.novos} novos em ${desempenho.coletados} encontrados), mas o mercado `
        + `já gerou ${respostas} respostas — vale decidir com calma.`
      : `Nas últimas ${desempenho.execucoes} execuções este mercado trouxe só ${desempenho.novos} `
        + `leads novos em ${desempenho.coletados} encontrados: você já tem praticamente todo mundo daqui.`,
    impacto: converte
      ? 'Continuar coletando aqui traz pouca gente nova, mas o mercado responde bem.'
      : 'Pausar evita novas coletas que trariam quase só contatos repetidos.',
  }
}

function regraRepoeDevagar(rotina, desempenho) {
  if (!rotina.ativo) return null
  if (desempenho.execucoes < AMOSTRA_MINIMA_COLETAS) return null
  const taxa = desempenho.taxa_novos
  if (taxa < TAXA_NOVOS_SATURADO || taxa >= TAXA_NOVOS_BAIXA) return null
  const intervaloAtual = inteiro(rotina.intervalo_horas, 6)
  const proposto = Math.min(INTERVALO_MAX_HORAS, intervaloAtual * 2)
  if (proposto <= intervaloAtual) return null

  const local = rotina.uf ? `${rotina.cidade}/${rotina.uf}` : rotina.cidade
  return {
    tipo: 'ajustar_rotina',
    rotina_id: rotina.id,
    nicho: rotina.nicho,
    cidade: rotina.cidade,
    uf: rotina.uf || null,
    parametros: { intervalo_horas: proposto },
    prioridade: 60,
    confianca: limitar(50 + (desempenho.execucoes * 5), 50, 70),
    evidencias: {
      execucoes_avaliadas: desempenho.execucoes,
      encontrados: desempenho.coletados,
      novos: desempenho.novos,
      taxa_novos_pct: pct(taxa),
      intervalo_atual_horas: intervaloAtual,
      intervalo_proposto_horas: proposto,
    },
    assinatura: `ajustar_rotina|rot:${rotina.id}|intervalo|taxa:${faixa(pct(taxa), 5)}|de:${intervaloAtual}`,
    titulo: `Espaçar a rotina de ${rotina.nicho} em ${local}`,
    motivo: `Este mercado repõe devagar: só ${pct(taxa)}% do que a coleta encontra é gente nova.`,
    impacto: `Buscar a cada ${proposto}h em vez de ${intervaloAtual}h dá tempo do mercado renovar entre uma coleta e outra.`,
  }
}

function regraMercadoFertil(rotina, desempenho) {
  if (!rotina.ativo) return null
  if (desempenho.execucoes < AMOSTRA_MINIMA_COLETAS) return null
  if (desempenho.taxa_novos < TAXA_NOVOS_ALTA) return null
  const atual = inteiro(rotina.quantidade, QUANTIDADE_MAX)
  if (atual >= QUANTIDADE_MAX) return null

  const local = rotina.uf ? `${rotina.cidade}/${rotina.uf}` : rotina.cidade
  return {
    tipo: 'ajustar_rotina',
    rotina_id: rotina.id,
    nicho: rotina.nicho,
    cidade: rotina.cidade,
    uf: rotina.uf || null,
    parametros: { quantidade: QUANTIDADE_MAX },
    prioridade: 55,
    confianca: limitar(50 + (desempenho.execucoes * 5), 50, 70),
    evidencias: {
      execucoes_avaliadas: desempenho.execucoes,
      encontrados: desempenho.coletados,
      novos: desempenho.novos,
      taxa_novos_pct: pct(desempenho.taxa_novos),
      quantidade_atual: atual,
      quantidade_proposta: QUANTIDADE_MAX,
    },
    assinatura: `ajustar_rotina|rot:${rotina.id}|quantidade|taxa:${faixa(pct(desempenho.taxa_novos), 5)}|de:${atual}`,
    titulo: `Aproveitar melhor ${rotina.nicho} em ${local}`,
    motivo: `Quase tudo que a coleta encontra aqui é gente nova (${pct(desempenho.taxa_novos)}%), `
      + `e a rotina está limitada a ${atual} leads por execução.`,
    impacto: `Subir para ${QUANTIDADE_MAX} por execução aproveita um mercado que ainda não se esgotou.`,
  }
}

function regraMercadoComprovado(mercado, rotinasPorMercado) {
  const enviados = inteiro(mercado.enviados)
  const respostas = inteiro(mercado.respostas)
  if (enviados < AMOSTRA_MINIMA_ENVIOS || respostas < 1) return null
  // Já existe rotina para este mercado — não há o que criar.
  if (rotinasPorMercado.has(chaveMercado(mercado.nicho, mercado.cidade))) return null

  const taxa = enviados > 0 ? respostas / enviados : 0
  const reunioes = inteiro(mercado.reunioes)
  const cidade = cidadeBase(mercado.cidade)
  const uf = (texto(mercado.cidade).match(/[-,/]\s*([A-Za-z]{2})\s*$/) || [])[1]
  const ufNormalizada = uf ? uf.toUpperCase() : null

  return {
    tipo: 'criar_rotina',
    rotina_id: null,
    nicho: mercado.nicho,
    cidade,
    uf: ufNormalizada,
    parametros: {
      dias_semana: [1, 2, 3, 4, 5],
      janela_inicio: '08:00',
      janela_fim: '18:00',
      intervalo_horas: 24,
      quantidade: QUANTIDADE_MAX,
    },
    prioridade: 90,
    confianca: limitar(55 + (Math.floor(enviados / 10) * 5) + (reunioes * 5), 55, 90),
    evidencias: {
      leads_no_mercado: inteiro(mercado.total),
      abordados: enviados,
      respostas,
      taxa_resposta_pct: pct(taxa),
      reunioes,
    },
    assinatura: `criar_rotina|mkt:${chaveMercado(mercado.nicho, mercado.cidade)}`
      + `|resp:${faixa(pct(taxa), 5)}|env:${faixa(enviados, 25)}`,
    titulo: `Criar rotina para ${mercado.nicho} em ${uf ? `${cidade}/${ufNormalizada}` : cidade}`,
    motivo: `Você já abordou ${enviados} leads deste mercado e ${respostas} responderam `
      + `(${pct(taxa)}%)${reunioes ? `, com ${reunioes} reunião(ões) marcada(s)` : ''} — `
      + 'mas ele não tem coleta contínua.',
    impacto: 'Uma rotina mantém a entrada de leads num mercado que já se provou.',
  }
}

/**
 * Avalia os dados agregados de UMA empresa e devolve os candidatos a sugestão.
 * Puro: mesma entrada, mesma saída. Não chama IA, banco nem rede.
 *
 * @param {object} dados
 * @param {Array}  dados.rotinas   rotinas da empresa (ativas e pausadas)
 * @param {Array}  dados.coletas   execuções recentes (busca_snapshots concluídos)
 * @param {Array}  dados.mercados  agregado comercial por nicho/cidade
 * @returns {{ suficiente: boolean, motivo_insuficiencia: string|null, candidatos: Array }}
 */
function avaliarOportunidades({ rotinas = [], coletas = [], mercados = [] } = {}) {
  const temHistorico = rotinas.length > 0 || coletas.length > 0
    || mercados.some((m) => inteiro(m.total) > 0)
  if (!temHistorico) {
    return {
      suficiente: false,
      motivo_insuficiencia: 'Ainda não há rotinas nem leads suficientes para analisar.',
      candidatos: [],
    }
  }

  const coletasPorRotina = new Map()
  for (const coleta of coletas) {
    if (!coleta?.rotina_id) continue
    if (!coletasPorRotina.has(coleta.rotina_id)) coletasPorRotina.set(coleta.rotina_id, [])
    coletasPorRotina.get(coleta.rotina_id).push(coleta)
  }

  const mercadoPorChave = new Map()
  for (const mercado of mercados) {
    mercadoPorChave.set(chaveMercado(mercado.nicho, mercado.cidade), mercado)
  }
  const rotinasPorMercado = new Map()
  for (const rotina of rotinas) {
    rotinasPorMercado.set(chaveMercado(rotina.nicho, rotina.cidade), rotina)
  }

  const candidatos = []
  for (const rotina of rotinas) {
    const desempenho = desempenhoColeta(coletasPorRotina.get(rotina.id) || [])
    const mercado = mercadoPorChave.get(chaveMercado(rotina.nicho, rotina.cidade)) || null

    // Falha é o sinal mais forte: com a rotina quebrada, discutir intervalo ou volume
    // seria conselho sobre um motor parado.
    const falha = regraFalhasRecorrentes(rotina)
    if (falha) {
      candidatos.push(falha)
      continue
    }
    // As demais regras se excluem por faixa de taxa — no máximo uma vale por rotina.
    const candidato = regraSaturacao(rotina, desempenho, mercado)
      || regraRepoeDevagar(rotina, desempenho)
      || regraMercadoFertil(rotina, desempenho)
    if (candidato) candidatos.push(candidato)
  }

  for (const mercado of mercados) {
    const candidato = regraMercadoComprovado(mercado, rotinasPorMercado)
    if (candidato) candidatos.push(candidato)
  }

  return { suficiente: true, motivo_insuficiencia: null, candidatos: ordenar(candidatos) }
}

// Ordem estável: prioridade, depois confiança, depois assinatura (desempate previsível).
function ordenar(candidatos) {
  return [...candidatos].sort((a, b) => (
    b.prioridade - a.prioridade
    || b.confianca - a.confianca
    || String(a.assinatura).localeCompare(String(b.assinatura))
  ))
}

module.exports = {
  AMOSTRA_MINIMA_COLETAS,
  AMOSTRA_MINIMA_ENVIOS,
  FALHAS_PARA_REVISAR,
  TAXA_NOVOS_SATURADO,
  TAXA_NOVOS_BAIXA,
  TAXA_NOVOS_ALTA,
  RESPOSTAS_MERCADO_QUENTE,
  cidadeBase,
  chaveMercado,
  faixa,
  desempenhoColeta,
  avaliarOportunidades,
  ordenar,
}
