'use strict'
// Motor da descoberta de leads pela Biblioteca de Anuncios do Meta. ORQUESTRA — nao decide
// regra nenhuma: o veredito de cada anuncio vem de `meta-ads-descoberta.js`, o orcamento de
// `apify-orcamento.js`. Este arquivo so' tem I/O, ordem e tratamento de erro (mesmo papel que
// `enriquecimento-worker.js` tem para o Instagram).
//
// SOB DEMANDA nesta primeira rodada — sem worker de fundo nem rotina agendada ainda (ver
// docs/ai-task-start-log.md, 2026-09-21 (3), "proximos passos"). `buscarAnunciantes` e' chamada
// direta, hoje so' por `scripts/buscar-anuncios-meta.js`.

const { logger } = require('../logger')
const apify = require('./apify-client')
const ORCAMENTO = require('./apify-orcamento')
const consumoDb = require('../db/apify-consumo')
const DESCOBERTA = require('./meta-ads-descoberta')
const leadsDb = require('../db/meta-ads-leads')
const { normalizarPais, paisParaMeta } = require('./paises')

// Cross-reference com a PAGINA do anunciante (fb_paginas da Bright Data, migration 092) —
// MESMA fila generica do enriquecimento de Instagram, etapa propria.
const brightdata = require('./brightdata-client')
const BD_ORCAMENTO = require('./brightdata-orcamento')
const bdConsumoDb = require('../db/brightdata-consumo')
const PIPELINE = require('./enriquecimento-pipeline')
const etapasDb = require('../db/enriquecimento-etapas')

const LIMITE_PADRAO = 25
// Teto POR BUSCA (decisao do operador, 2026-09-22). O clamp vive aqui, e nao so' na tela: a rota
// e' publica para quem tem a capacidade, e uma chamada direta pediria mais do que o formulario
// deixa. A tela apenas reflete este numero.
const LIMITE_MAX = 100
const ETAPA_PAGINA = 'meta_ads_pagina'
const LOTE_PAGINA = 10
// Medido na sonda de 2026-09-22: fb_paginas levou ~5min (00:02:04 -> 00:06:45). 20min da folga
// real sem herdar o teto de 60min do perfil de Instagram, que e' um dataset diferente.
const SNAPSHOT_MAX_MIN_PAGINA = 20

/**
 * Monta a URL de busca da Biblioteca de Anuncios para o pais escolhido,
 * categoria "todos os anuncios".
 *
 * O `termo` e' o que se PROCURA na Biblioteca (palavra-chave do anuncio); o `nicho` e' o que o
 * lead E' (e e' ele que resolve `nicho_id` e leva o lead para a equipe certa). Os dois eram o
 * mesmo campo ate' 2026-09-22, e por isso buscar "energia solar goiania" gravava esse texto como
 * nicho — que nao casa com o catalogo, deixa `nicho_id` nulo e faz o lead nao chegar a equipe
 * nenhuma. Sem `termo`, a busca cai no nicho, que e' o comportamento util por padrao.
 */
function montarUrlBusca({ termo: termoBusca, nicho, cidade, pais = 'BR' }) {
  const termo = [String(termoBusca || '').trim() || nicho, cidade].filter(Boolean).join(' ').trim()
  const paisNormalizado = normalizarPais(pais)
  const params = new URLSearchParams({
    active_status: 'active',
    ad_type: 'all',
    country: paisParaMeta(paisNormalizado),
    q: termo,
    search_type: 'keyword_unordered',
  })
  return `https://www.facebook.com/ads/library/?${params.toString()}`
}

/**
 * Busca anunciantes por nicho+cidade, filtra ruido e site proprio, e grava os aproveitaveis.
 *
 * O orcamento e' conferido ANTES do disparo pago, com o TETO do pedido como custo estimado
 * (pior caso) — mesma disciplina de `pesquisarPlaces` e do enriquecimento de Instagram.
 */
async function buscarAnunciantes({ nicho, termo = null, cidade, pais = 'BR', empresaId = null, limite = LIMITE_PADRAO } = {}) {
  const termoNicho = String(nicho || '').trim()
  const paisNormalizado = normalizarPais(pais)
  if (!termoNicho) {
    const e = new Error('Informe um nicho para buscar na Biblioteca de Anuncios.')
    e.statusCode = 400
    throw e
  }
  const lim = Math.max(1, Math.min(LIMITE_MAX, Number.parseInt(limite, 10) || LIMITE_PADRAO))

  const orcamento = ORCAMENTO.avaliarOrcamento({
    consumidoHoje: await consumoDb.consumidoHoje(apify.atorFacebookAds()),
    custoEstimado: lim,
  })
  if (!orcamento.permitido) {
    logger.warn({ operation: 'meta_ads', ...orcamento }, 'busca de anuncios adiada por orcamento')
    return { ok: false, motivo: orcamento.motivo, mensagem: orcamento.mensagem, salvos: [] }
  }

  if (!apify.apifyConfigurado()) {
    return { ok: false, motivo: 'apify_indisponivel', mensagem: 'APIFY_API_TOKEN ausente.', salvos: [] }
  }

  const url = montarUrlBusca({ termo, nicho: termoNicho, cidade, pais: paisNormalizado })
  const input = {
    startUrls: [{ url }],
    resultsLimit: lim,
    activeStatus: 'active',
    sorting: '',
    includeAboutPage: true,
    isDetailsPerAd: true,
    enrichWithEcommerceData: false,
  }

  let registros
  try {
    registros = await apify.rodarAtorSincrono(apify.atorFacebookAds(), input)
  } catch (e) {
    logger.warn({ operation: 'meta_ads', erro: e.message }, 'busca de anuncios falhou')
    return { ok: false, motivo: 'erro_apify', mensagem: e.message, salvos: [] }
  }

  // Ledger com o numero REAL devolvido — nunca o solicitado. Sem run_id (o endpoint sincrono
  // usado aqui nao devolve um): nao ha' idempotencia por chamada ainda nesta primeira rodada.
  await consumoDb.registrarConsumo({
    empresaId, actorId: apify.atorFacebookAds(), resultados: registros.length,
    contexto: { nicho: termoNicho, cidade: cidade || null, pais: paisNormalizado },
  })

  // Dedup por page_id DENTRO do lote: a mesma pagina pode aparecer varias vezes (criativos
  // diferentes da mesma campanha) — salvar so' o primeiro visto evita upsert redundante.
  const salvos = []
  const descartados = { [DESCOBERTA.MOTIVO.SEM_PAGE_ID]: 0, [DESCOBERTA.MOTIVO.CATEGORIA_NAO_NEGOCIO]: 0, [DESCOBERTA.MOTIVO.TEM_SITE_PROPRIO]: 0 }
  let fundidos = 0
  let semTelefone = 0

  // Carteira lida UMA vez: a dedup entre canais compara em memoria (regra PURA e conservadora em
  // `mesmoNegocio`), em vez de uma consulta por anuncio.
  const existentes = await leadsDb.candidatosParaFusao(empresaId, cidade, paisNormalizado).catch(() => [])

  // UMA entrada por PAGINA, com quantos anuncios ativos ela tem. A busca devolve uma linha por
  // ANUNCIO e o mesmo negocio costuma ter varios — uma linha por anuncio faria o vendedor ligar
  // tres vezes para a mesma pessoa.
  for (const grupo of DESCOBERTA.agruparPorPagina(registros)) {
    const { avaliado, registro, totalAtivos } = grupo
    if (!avaliado.aproveitavel) {
      descartados[avaliado.motivo] = (descartados[avaliado.motivo] || 0) + 1
      continue
    }

    const lead = DESCOBERTA.montarLeadDeAnuncio(
      avaliado, { nicho: termoNicho, cidade, pais: paisNormalizado, empresaId, totalAtivos }, registro)
    try {
      // Este anunciante ja esta na carteira (veio do Maps)? Entao a evidencia do anuncio vai
      // para o lead que JA existe — e o telefone que faltava ao lead de anuncio ja esta la'.
      // Criar a segunda linha poria dois vendedores no mesmo negocio.
      const existente = DESCOBERTA.escolherLeadExistente(avaliado, existentes, { nicho: termoNicho, cidade, pais: paisNormalizado })
      if (existente) {
        const fundido = await leadsDb.absorverAnuncioEmLeadExistente(existente.id, lead)
        if (fundido) { fundidos += 1; salvos.push({ ...fundido, fundido: true }) }
        continue
      }

      const salvo = await leadsDb.salvarLeadDeAnuncio(lead, { empresaId })
      if (salvo) {
        salvos.push(salvo)
        // Lead de anuncio nasce SEM telefone (o anuncio nao traz, e a pagina so' as vezes). Sem
        // telefone ele cai em `falta_contato` na fila de trabalho — trabalho de completar
        // cadastro, nao de vender. Contar isso e' o que impede a tela de prometer venda.
        semTelefone += 1
      }
    } catch (e) {
      logger.warn({ operation: 'meta_ads', pageId: avaliado.pageId, erro: e.message }, 'falha ao salvar lead de anuncio')
    }
  }

  logger.info({ operation: 'meta_ads', nicho: termoNicho, cidade: cidade || null, pais: paisNormalizado,
    registros: registros.length, salvos: salvos.length, fundidos, descartados },
  'busca de anuncios concluida')

  return { ok: true, registros: registros.length, salvos, descartados, fundidos, sem_telefone: semTelefone }
}

// ── Cross-reference com fb_paginas (Bright Data) ────────────────────────────────────────────
// FASE 1 — dispara UM snapshot para varios leads. Mesma disciplina de `dispararPerfis` do
// enriquecimento de Instagram: orcamento conferido ANTES do disparo pago, custo estimado e' o
// pior caso (1 credito por lead).
async function dispararPaginasFacebook({ limite = LOTE_PAGINA, agora = new Date() } = {}) {
  if (!brightdata.brightDataConfigurado() || !brightdata.datasetId('fb_paginas')) {
    return { ok: false, motivo: PIPELINE.MOTIVO.FONTE_INDISPONIVEL, disparados: 0 }
  }

  const reservadas = await etapasDb.reservar(ETAPA_PAGINA, limite, { agora })
  if (!reservadas.length) return { ok: true, disparados: 0 }

  const alvos = []
  for (const item of reservadas) {
    const decisao = DESCOBERTA.decidirCrossReferencePagina(item.lead, { agora })
    if (!decisao.rodar) {
      await etapasDb.finalizar(item.etapa_id, { status: decisao.status, motivo: decisao.motivo })
      continue
    }
    alvos.push({ ...item, pageId: decisao.pageId })
  }
  if (!alvos.length) return { ok: true, disparados: 0 }

  const orcamento = BD_ORCAMENTO.avaliarOrcamento({
    consumidoHoje: await bdConsumoDb.consumidoHoje([BD_ORCAMENTO.SCRAPER.FB_PAGINAS]),
    custoEstimado: alvos.length,
    saldoEstimado: (await bdConsumoDb.saldoAtual()).saldo,
    // Teto PROPRIO, nao o do enriquecimento de Instagram: dividindo o mesmo balde, uma
    // varredura grande na Biblioteca de Anuncios atrasaria em silencio o enriquecimento dos
    // leads do Maps.
    teto: ORCAMENTO.tetoDiarioPaginasFacebook(),
    // reserva ZERO: mesmo motivo do perfil de Instagram — a reserva existe pra proteger o
    // ENRIQUECIMENTO da Aquisicao, e este cross-reference JA e' enriquecimento.
    reserva: 0,
    canal: { nome: 'Paginas do Facebook (Meta Ads)', env: 'BRIGHTDATA_META_PAGINAS_TETO_DIARIO' },
  })
  if (!orcamento.permitido) {
    const { proximaTentativaEm } = PIPELINE.adiar({ agora, minutos: 6 * 60 })
    for (const item of alvos) {
      await etapasDb.reagendar(item.etapa_id, {
        proximaTentativaEm, motivo: PIPELINE.MOTIVO.ORCAMENTO, consomeTentativa: false,
      }).catch(() => {})
    }
    logger.warn({ operation: 'meta_ads_pagina', ...orcamento }, 'cross-reference de paginas adiado por orcamento')
    return { ok: true, disparados: 0, motivo: PIPELINE.MOTIVO.ORCAMENTO }
  }

  // A URL NAVEGAVEL da pagina, quando a Biblioteca a declarou — e' o que a Bright Data consegue
  // abrir. Medido na sonda de 2026-09-22: em 2 de 5 casos `page_profile_uri` aponta para um
  // identificador DIFERENTE do `page_id`, entao montar `facebook.com/<pageId>/` consultava uma
  // pagina que nao existe — e o lead ficava sem telefone, sem site e sem endereco para sempre.
  const input = alvos.map((a) => ({
    url: String(a.lead.anuncio_meta_pagina_url || '').trim() || `https://www.facebook.com/${a.pageId}/`,
  }))
  try {
    const { snapshotId } = await brightdata.trigger('fb_paginas', input)
    await etapasDb.marcarSnapshot(alvos.map((a) => a.etapa_id), snapshotId, {
      leaseAte: new Date(agora.getTime() + SNAPSHOT_MAX_MIN_PAGINA * 60000),
    })
    logger.info({ operation: 'meta_ads_pagina', snapshotId, leads: alvos.length }, 'paginas disparadas')
    return { ok: true, disparados: alvos.length, snapshotId }
  } catch (e) {
    const classe = PIPELINE.classificarErro(e)
    for (const item of alvos) {
      const plano = classe.retentar
        ? PIPELINE.agendarRetry({ tentativas: item.tentativas, agora, motivo: classe.motivo })
        : { status: PIPELINE.STATUS.FALHOU, proximaTentativaEm: null, motivo: classe.motivo }
      if (plano.status === PIPELINE.STATUS.PENDENTE) {
        await etapasDb.reagendar(item.etapa_id, plano).catch(() => {})
      } else {
        await etapasDb.finalizar(item.etapa_id, plano).catch(() => {})
      }
    }
    logger.warn({ operation: 'meta_ads_pagina', erro: e.message }, 'trigger de paginas falhou')
    return { ok: false, disparados: 0, erro: e.message }
  }
}

// FASE 2 — colhe snapshots prontos e grava o resultado no lead (colunas genericas, nunca
// proprias deste canal — ver `db/meta-ads-leads.js#gravarResultadoPagina`).
async function colherPaginasFacebook({ limite = 5, agora = new Date() } = {}) {
  const lotes = await etapasDb.aguardandoSnapshot(ETAPA_PAGINA, limite)
  if (!lotes.length) return { ok: true, colhidos: 0 }

  let colhidos = 0
  for (const lote of lotes) {
    const idadeMin = (agora.getTime() - new Date(lote.desde).getTime()) / 60000
    const itens = await etapasDb.etapasDoSnapshot(lote.snapshot_id)
    if (!itens.length) continue

    try {
      const { status } = await brightdata.progress(lote.snapshot_id)

      // Desistencia DECIDIDA depois de perguntar o estado — nao por idade sozinha (mesma
      // correcao que a coleta do Maps e o perfil de Instagram ja receberam).
      if (status !== 'ready') {
        const morto = status === 'failed' || status === 'error'
        if (!morto && idadeMin < SNAPSHOT_MAX_MIN_PAGINA) continue
        for (const item of itens) {
          const plano = PIPELINE.agendarRetry({ tentativas: item.tentativas, agora })
          if (plano.status === PIPELINE.STATUS.PENDENTE) {
            await etapasDb.reagendar(item.etapa_id, plano).catch(() => {})
          } else {
            await etapasDb.finalizar(item.etapa_id, plano).catch(() => {})
          }
        }
        continue
      }

      const registros = await brightdata.snapshot(lote.snapshot_id)

      // Snapshot pronto e VAZIO nao e' "nenhuma destas paginas existe" — e' materializacao
      // atrasada ou defeito do lado de la' (mesma licao do perfil de Instagram).
      if (!registros.length) {
        if (idadeMin < SNAPSHOT_MAX_MIN_PAGINA) continue
        for (const item of itens) {
          const plano = PIPELINE.agendarRetry({ tentativas: item.tentativas, agora })
          if (plano.status === PIPELINE.STATUS.PENDENTE) {
            await etapasDb.reagendar(item.etapa_id, plano).catch(() => {})
          } else {
            await etapasDb.finalizar(item.etapa_id, plano).catch(() => {})
          }
        }
        continue
      }

      // Ledger com o numero REAL devolvido, antes de qualquer interpretacao — idempotente por
      // (scraper, snapshot).
      await bdConsumoDb.registrarConsumo({
        empresaId: itens[0].empresa_id,
        scraperType: BD_ORCAMENTO.SCRAPER.FB_PAGINAS,
        snapshotId: lote.snapshot_id,
        registros: registros.length,
        contexto: { etapa: ETAPA_PAGINA, leads: itens.length },
      })

      const porPageId = new Map()
      for (const r of registros) {
        const pid = String((r && r.page_transparency && r.page_transparency.page_id) || (r && r.id) || '')
        if (pid && !porPageId.has(pid)) porPageId.set(pid, r)
      }

      for (const item of itens) {
        const pageId = String(item.lead.anuncio_meta_page_id || '')
        const registro = pageId ? porPageId.get(pageId) : null
        const avaliado = registro ? DESCOBERTA.avaliarResultadoPagina(registro) : null

        // Veio registro pra outros e nao pra este: a Bright Data respondeu que esta pagina nao
        // existe (mais). Isso e' RESPOSTA, nao falha.
        if (!avaliado || !avaliado.perfilExiste) {
          await etapasDb.finalizar(item.etapa_id, {
            status: PIPELINE.STATUS.CONCLUIDO, motivo: PIPELINE.MOTIVO.PERFIL_INEXISTENTE,
          })
          continue
        }

        await leadsDb.gravarResultadoPagina(item.prospect_id, avaliado).catch(() => {})
        await etapasDb.finalizar(item.etapa_id, { status: PIPELINE.STATUS.CONCLUIDO, custoCreditos: 1 })
        colhidos += 1
      }
      logger.info({ operation: 'meta_ads_pagina', snapshotId: lote.snapshot_id,
        registros: registros.length, leads: itens.length }, 'paginas colhidas')
    } catch (e) {
      logger.warn({ operation: 'meta_ads_pagina', snapshotId: lote.snapshot_id, erro: e.message },
        'colheita de paginas re-tenta no proximo tique')
    }
  }
  return { ok: true, colhidos }
}

/** Um tique do cross-reference. NUNCA lanca — roda ao lado de outros workers no mesmo tique. */
async function tickMetaAdsPagina(opcoes = {}) {
  const agora = opcoes.agora || new Date()
  const out = { disparo: null, colheita: null }
  try { out.colheita = await colherPaginasFacebook({ agora }) } catch (e) { out.colheita = { ok: false, erro: e.message } }
  try { out.disparo = await dispararPaginasFacebook({ agora }) } catch (e) { out.disparo = { ok: false, erro: e.message } }
  return out
}

module.exports = {
  LIMITE_PADRAO,
  LIMITE_MAX,
  montarUrlBusca,
  buscarAnunciantes,
  dispararPaginasFacebook,
  colherPaginasFacebook,
  tickMetaAdsPagina,
}
