'use strict'

const { obterConfiguracaoProspeccao } = require('./prospecting-settings')
const { criarFilaDiariaSimulada, buscarCandidatosProspeccao } = require('./prospecting-daily-queue')
const { normalizarNumeroProspeccao } = require('./prospecting-eligibility')

const PJ_EMPRESA_ID = '00000000-0000-0000-0000-000000000001'

function textoOuNull(valor, max = 180) {
  const texto = String(valor == null ? '' : valor).trim()
  return texto ? texto.slice(0, max) : null
}

function resolverBuscaPlaces(input = {}, config = {}) {
  const nicho = textoOuNull(input.nicho || input.categoria || config.categoria_padrao || config.categoria)
  const local = textoOuNull(input.local || input.cidade || config.cidade_padrao || config.regiao_padrao)
  const quantidade = Math.min(Math.max(Number.parseInt(input.quantidade || input.limit || config.limite_diario || 10, 10) || 10, 1), 60)
  return { nicho, local, quantidade }
}

function prospectParaCandidato(p = {}, fallback = {}) {
  return {
    prospect_id: p.id || p.prospect_id || null,
    telefone: p.telefone || p.phone || '',
    nome: p.nome || p.name || 'Lead',
    categoria: p.nicho || p.categoria || fallback.categoria || null,
    cidade: p.cidade || fallback.cidade || null,
    estado: p.estado || fallback.estado || null,
    metadata_json: {
      origem_places: true,
      score: p.score ?? null,
      score_v2: p.score_v2 ?? null,
      place_id: p.place_id || null,
      maps_url: p.maps_url || null,
      tem_site: p.tem_site ?? null,
    },
  }
}

async function simularFilaDiariaComPlaces(pool, input = {}, deps = {}) {
  const pesquisarPlacesFn = deps.pesquisarPlacesFn
  if (typeof pesquisarPlacesFn !== 'function') {
    throw new Error('pesquisarPlacesFn e obrigatorio para simular fila com Places')
  }

  const empresaId = input.empresaId || PJ_EMPRESA_ID
  const config = input.config || await obterConfiguracaoProspeccao(pool, empresaId)
  const busca = resolverBuscaPlaces(input, config)
  if (!busca.nicho || !busca.local) {
    const err = new Error('Informe categoria/nicho e cidade/regiao para buscar no Google Places.')
    err.statusCode = 400
    throw err
  }

  const origem = input.origem || (config?.modo === 'automatico' ? 'automatico' : 'manual')
  // Com backlog ligado (rodada automática), uma falha do Places NÃO derruba a rodada —
  // ainda drenamos o backlog. Sem backlog (manual), o erro do Places propaga como antes.
  let resultadoPlaces = null
  try {
    resultadoPlaces = await pesquisarPlacesFn({
      nicho: busca.nicho,
      local: busca.local,
      quantidade: busca.quantidade,
      origem,
      empresaId,
    })
  } catch (e) {
    if (!input.incluirBacklog) throw e
    resultadoPlaces = { prospects: [], consulta: `${busca.nicho} em ${busca.local}`, erro: e.message }
  }
  const prospects = Array.isArray(resultadoPlaces?.prospects) ? resultadoPlaces.prospects : []
  const candidatos = prospects.map((p) => prospectParaCandidato(p, {
    categoria: busca.nicho,
    cidade: busca.local,
    estado: config?.estado_padrao || null,
  }))

  // BACKLOG: drena prospects já descobertos e ainda não enviados (status aguardando/
  // aprovado, com telefone), além do que o Places trouxe fresco. Dedup por telefone.
  // A elegibilidade (canProspectLead) + slots já limitam volume e anti-recontato.
  let candidatosFinais = candidatos
  let totalBacklogAdicionado = 0
  if (input.incluirBacklog) {
    const limiteBacklog = Math.max((Number(config?.limite_diario) || 80) * 2, 80)
    const backlog = await buscarCandidatosProspeccao(pool, { empresaId, limit: limiteBacklog })
    const vistos = new Set(candidatos.map((c) => normalizarNumeroProspeccao(c.telefone)).filter(Boolean))
    const extras = backlog.filter((b) => {
      const n = b.telefone_normalizado || normalizarNumeroProspeccao(b.telefone)
      if (!n || vistos.has(n)) return false
      vistos.add(n)
      return true
    })
    totalBacklogAdicionado = extras.length
    candidatosFinais = candidatos.concat(extras)
  }

  const fila = await criarFilaDiariaSimulada(pool, {
    ...input,
    empresaId,
    config,
    candidatos: candidatosFinais,
    categoria: busca.nicho,
    cidade: busca.local,
  })

  return {
    ...fila,
    consulta_places: resultadoPlaces?.consulta || `${busca.nicho} em ${busca.local}`,
    total_places_salvos: prospects.length,
    total_backlog_adicionado: totalBacklogAdicionado,
    origem_places: origem,
  }
}

module.exports = {
  resolverBuscaPlaces,
  prospectParaCandidato,
  simularFilaDiariaComPlaces,
}
