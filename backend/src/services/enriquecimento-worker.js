'use strict'
// Motor do enriquecimento de Instagram. Roda EM SEGUNDO PLANO, por lead.
//
// POR QUE EM SEGUNDO PLANO, e nao dentro da coleta. A busca avulsa ja' demora minutos esperando
// a Bright Data; pendurar nela ~176 consultas SERP e um segundo job pago faria o
// operador olhar para uma tela girando por muito mais tempo e, pior, um enriquecimento travado
// seguraria leads JA' PAGOS fora do Banco de Leads. Aqui os leads entram assim que o snapshot da
// coleta fica pronto, e o Instagram chega depois — o lead aparece primeiro, sempre.
//
// TRES FASES, porque as duas fontes tem naturezas diferentes:
//   1. DESCOBERTA  — Bright Data SERP, sincrono, 1 consulta por lead, teto diario proprio.
//   2. DISPARO     — Bright Data, assincrono: UM trigger para ate' N leads de uma vez.
//   3. COLHEITA    — baixa o snapshot pronto e distribui os registros pelos leads.
// Fazer o perfil lead a lead (trigger + poll + download por lead) multiplicaria por N as
// chamadas a' API sem baixar o custo em creditos, que e' por registro.
//
// NADA AQUI DECIDE REGRA: o veredito vem de `enriquecimento-pipeline.js` (o que rodar),
// `instagram-perfil.js` (de quem e' o perfil) e `instagram-atividade.js` (o que o perfil diz).
// Este arquivo so' tem I/O, ordem e tratamento de erro.

const { logger } = require('../logger')
const brightdata = require('./brightdata-client')
const etapasDb = require('../db/enriquecimento-etapas')
const consumoDb = require('../db/brightdata-consumo')
const ORCAMENTO = require('./brightdata-orcamento')
const PIPELINE = require('./enriquecimento-pipeline')
const IG = require('./instagram-perfil')
const ATIVIDADE = require('./instagram-atividade')
const { buscarPerfisDeNegocio, brightDataSerpConfigurado } = require('./social-discovery')

const { ETAPA, STATUS, MOTIVO } = PIPELINE

const LOTE_DESCOBERTA = 10        // por tique; o teto diario e' quem limita de verdade
const LOTE_PERFIL = 25            // leads por snapshot da Bright Data
const SNAPSHOT_MAX_MIN = 60       // um snapshot de perfil que passa disso e' desistido

/** Enfileira a proxima etapa da cascata, quando houver. */
function idsDaEtapa(item = {}) {
  return {
    prospectId: item.prospectId || item.prospect_id || null,
    empresaId: item.empresaId || item.empresa_id || null,
  }
}

async function seguir(etapaAtual, item = {}) {
  const proxima = PIPELINE.proximaEtapa(etapaAtual)
  if (!proxima) return
  const { prospectId, empresaId } = idsDaEtapa(item)
  if (!prospectId) return
  await etapasDb.enfileirar([prospectId], { empresaId, etapa: proxima })
}

// ── FASE 1 — DESCOBERTA (Bright Data SERP) ───────────────────────────────────────────────────

/**
 * Procura o Instagram de cada lead reservado.
 *
 * A COTA E' CONFERIDA ANTES DE RESERVAR, de proposito: reservar consome uma tentativa, e um dia
 * de cota cheia gastaria o teto de 6 tentativas de cada lead sem nunca ter consultado nada — o
 * lead morreria como `tentativas_esgotadas` sem ter sido buscado uma vez.
 */
async function processarDescobertas({ limite = LOTE_DESCOBERTA, agora = new Date() } = {}) {
  const teto = PIPELINE.tetoDiarioConsultas()
  if (teto > 0) {
    const gastas = await etapasDb.consultasHoje()
    // `null` = nao deu para contar. Nao gastar e' a escolha segura: o custo de esperar um tique
    // e' zero, o de estourar a cota e' o dia inteiro parado.
    if (gastas === null) return { ok: false, motivo: 'contagem_indisponivel', processados: 0 }
    const restante = teto - gastas
    if (restante <= 0) return { ok: true, processados: 0, motivo: MOTIVO.COTA_ESGOTADA, restante: 0 }
    limite = Math.min(limite, restante)
  }

  const reservadas = await etapasDb.reservar(ETAPA.DESCOBERTA, limite, { agora })
  if (!reservadas.length) return { ok: true, processados: 0 }

  let processados = 0
  for (const item of reservadas) {
    const lead = item.lead
    try {
      const decisao = PIPELINE.decidirDescoberta(lead)
      if (!decisao.rodar) {
        await etapasDb.finalizar(item.etapa_id, { status: decisao.status, motivo: decisao.motivo })
        await seguir(ETAPA.DESCOBERTA, item)
        continue
      }

      // A fonte precisa estar de pe'. Sem isto, "nao configurado" viraria "nao tem Instagram".
      if (!brightDataSerpConfigurado()) {
        const { proximaTentativaEm, motivo } = PIPELINE.adiar({
          motivo: MOTIVO.FONTE_INDISPONIVEL, agora, minutos: 120,
        })
        await etapasDb.reagendar(item.etapa_id, {
          proximaTentativaEm, motivo, consomeTentativa: false,
        })
        continue
      }

      const busca = await buscarPerfisDeNegocio(lead.nome, lead.cidade)

      // ── A REGRA QUE SUSTENTA O MODULO ──────────────────────────────────────────────────────
      // Busca que NAO aconteceu nao vira veredito. Cota/teto, token invalido e timeout
      // devolvem o lead para a fila; nenhum deles escreve uma linha em `prospects`. Medido em
      // 2026-09-17: uma fonte de descoberta invalida que vira lista vazia marcaria a carteira
      // inteira como "sem Instagram" sem ninguem ter olhado.
      if (!busca.ok) {
        const cota = busca.statusCode === 429
        const { proximaTentativaEm } = PIPELINE.adiar({
          agora, minutos: cota ? 12 * 60 : 60,
        })
        await etapasDb.reagendar(item.etapa_id, {
          proximaTentativaEm,
          motivo: cota ? MOTIVO.COTA_ESGOTADA : MOTIVO.FONTE_INDISPONIVEL,
          consomeTentativa: false,
          custoConsultas: busca.consultas,
        })
        continue
      }

      const melhor = IG.escolherMelhorCandidato(lead, busca.resultados)
      if (!melhor) {
        // Agora sim: a busca respondeu e nao achou perfil deste negocio. Isso e' informacao.
        await etapasDb.gravarDescoberta(lead.id, {
          handle: null, confirmado: false, confianca: IG.CONFIANCA.NAO_ENCONTRADO,
          evidencia: { fonte: 'brightdata_serp', consultados: busca.resultados.length, sinais: [] },
        })
        await etapasDb.finalizar(item.etapa_id, {
          status: STATUS.CONCLUIDO, motivo: MOTIVO.NENHUM_RESULTADO,
          custoConsultas: busca.consultas,
        })
        processados += 1
        continue
      }

      const veredito = IG.vereditoDaOrigem(IG.ORIGEM.BUSCA, { forte: melhor.forte })
      await etapasDb.gravarDescoberta(lead.id, {
        handle: melhor.handle,
        confirmado: veredito === IG.CONFIANCA.CONFIRMADO,
        confianca: veredito,
        evidencia: {
          fonte: 'brightdata_serp', url: melhor.url, sinais: melhor.sinais,
          consultados: busca.resultados.length,
        },
      })
      await etapasDb.finalizar(item.etapa_id, {
        status: STATUS.CONCLUIDO,
        motivo: veredito === IG.CONFIANCA.CONFIRMADO ? null : MOTIVO.PROVA_INSUFICIENTE,
        custoConsultas: busca.consultas,
      })
      await seguir(ETAPA.DESCOBERTA, item)
      processados += 1
    } catch (e) {
      const classe = PIPELINE.classificarErro(e)
      const plano = classe.retentar
        ? PIPELINE.agendarRetry({ tentativas: item.tentativas, agora, motivo: classe.motivo })
        : { status: STATUS.FALHOU, proximaTentativaEm: null, motivo: classe.motivo }
      if (plano.status === STATUS.PENDENTE) {
        await etapasDb.reagendar(item.etapa_id, plano).catch(() => {})
      } else {
        await etapasDb.finalizar(item.etapa_id, plano).catch(() => {})
      }
      logger.warn({ operation: 'enriquecimento', etapa: 'descoberta', erro: e.message },
        'descoberta falhou; lead reagendado')
    }
  }
  return { ok: true, processados }
}

// ── FASE 2 — DISPARO DO PERFIL (Bright Data) ─────────────────────────────────────────────────

/**
 * Dispara UM snapshot para varios leads.
 *
 * Mesma disciplina de `pesquisarPlaces`: o orcamento e' conferido ANTES do disparo pago, e o
 * custo estimado e' o pior caso (um registro por lead), porque o custo real so' se conhece
 * quando o snapshot volta — e ai' ja' foi pago.
 */
async function dispararPerfis({ limite = LOTE_PERFIL, agora = new Date() } = {}) {
  if (!brightdata.brightDataConfigurado() || !brightdata.datasetId('ig_perfis')) {
    return { ok: false, motivo: MOTIVO.FONTE_INDISPONIVEL, disparados: 0 }
  }

  const reservadas = await etapasDb.reservar(ETAPA.PERFIL, limite, { agora })
  if (!reservadas.length) return { ok: true, disparados: 0 }

  // Quem nao precisa rodar sai antes de qualquer conta de orcamento: pular e' de graca.
  const alvos = []
  for (const item of reservadas) {
    const decisao = PIPELINE.decidirPerfil(item.lead, { agora })
    if (!decisao.rodar) {
      await etapasDb.finalizar(item.etapa_id, { status: decisao.status, motivo: decisao.motivo })
      continue
    }
    alvos.push({ ...item, handle: decisao.handle })
  }
  if (!alvos.length) return { ok: true, disparados: 0 }

  const orcamento = ORCAMENTO.avaliarOrcamento({
    consumidoHoje: await consumoDb.consumidoHoje([ORCAMENTO.SCRAPER.IG_PERFIS]),
    custoEstimado: alvos.length,
    saldoEstimado: (await consumoDb.saldoAtual()).saldo,
    teto: ORCAMENTO.tetoDiarioEnriquecimento(),
    // reserva ZERO: a reserva existe para proteger ESTE canal da Aquisicao. Aplica-la aqui
    // barraria o enriquecimento justamente com os creditos guardados para ele.
    reserva: 0,
    canal: { nome: 'Enriquecimento', env: 'BRIGHTDATA_ENRIQUECIMENTO_TETO_DIARIO' },
  })
  if (!orcamento.permitido) {
    const { proximaTentativaEm } = PIPELINE.adiar({ agora, minutos: 6 * 60 })
    for (const item of alvos) {
      await etapasDb.reagendar(item.etapa_id, {
        proximaTentativaEm, motivo: MOTIVO.ORCAMENTO, consomeTentativa: false,
      }).catch(() => {})
    }
    logger.warn({ operation: 'enriquecimento', etapa: 'perfil', ...orcamento },
      'perfis adiados por orcamento')
    return { ok: true, disparados: 0, motivo: MOTIVO.ORCAMENTO }
  }

  const input = alvos.map((a) => ({ url: `https://www.instagram.com/${a.handle}/` }))
  try {
    const { snapshotId } = await brightdata.trigger('ig_perfis', input)
    await etapasDb.marcarSnapshot(alvos.map((a) => a.etapa_id), snapshotId, {
      leaseAte: new Date(agora.getTime() + SNAPSHOT_MAX_MIN * 60000),
    })
    logger.info({ operation: 'enriquecimento', etapa: 'perfil', snapshotId, leads: alvos.length },
      'perfis disparados')
    return { ok: true, disparados: alvos.length, snapshotId }
  } catch (e) {
    const classe = PIPELINE.classificarErro(e)
    for (const item of alvos) {
      const plano = classe.retentar
        ? PIPELINE.agendarRetry({ tentativas: item.tentativas, agora, motivo: classe.motivo })
        : { status: STATUS.FALHOU, proximaTentativaEm: null, motivo: classe.motivo }
      if (plano.status === STATUS.PENDENTE) {
        await etapasDb.reagendar(item.etapa_id, plano).catch(() => {})
      } else {
        await etapasDb.finalizar(item.etapa_id, plano).catch(() => {})
      }
    }
    logger.warn({ operation: 'enriquecimento', etapa: 'perfil', erro: e.message },
      'trigger de perfis falhou')
    return { ok: false, disparados: 0, erro: e.message }
  }
}

// ── FASE 3 — COLHEITA ────────────────────────────────────────────────────────────────────────

/** Indexa os registros devolvidos pelo handle, aceitando as duas formas que o dataset usa. */
function indexarPorHandle(registros) {
  const mapa = new Map()
  for (const r of Array.isArray(registros) ? registros : []) {
    // `account` e' o campo do perfil; `input.url` e' o eco do que foi pedido — e e' ele que
    // resolve o caso do perfil que nao existe, em que `account` vem vazio.
    for (const bruto of [r && r.account, r && r.input && r.input.url]) {
      const h = IG.normalizarHandle(bruto)
      if (h && !mapa.has(h)) mapa.set(h, r)
    }
  }
  return mapa
}

/** Aplica um registro de perfil a um lead: atividade, seguidores e (talvez) a prova do vinculo. */
async function aplicarPerfil(item, registro, { agora }) {
  const lead = item.lead
  const medida = ATIVIDADE.classificarAtividade(registro, { agora })

  // O credito ja' foi gasto, e o mesmo registro traz `biography` e `external_urls` — telefone e
  // site, as duas provas FORTES que a busca por texto nao tinha. Reaproveita-las aqui e' o que
  // resolve a maioria dos candidatos sem ocupar uma pessoa (§5.3 da analise).
  const prova = ATIVIDADE.textoDeProva(registro)
  const reavaliado = prova ? IG.avaliarCandidato(lead, prova) : null
  const jaConfirmado = lead.instagram_confianca === IG.CONFIANCA.CONFIRMADO
  const promove = !jaConfirmado && !!(reavaliado && reavaliado.forte)

  await etapasDb.gravarPerfil(lead.id, {
    registro,
    atividade: medida.atividade,
    ultimoPostEm: medida.ultimo_post_em,
    seguidores: ATIVIDADE.seguidoresDe(registro),
    handle: promove ? reavaliado.handle : null,
    confianca: promove ? IG.CONFIANCA.CONFIRMADO : null,
    evidencia: promove
      ? { fonte: 'perfil_instagram', url: reavaliado.url, sinais: reavaliado.sinais }
      : null,
  })

  // Candidato que o perfil tambem nao provou vira trabalho de gente — e so' agora, depois de a
  // via barata ter sido tentada.
  const status = (!jaConfirmado && !promove) ? STATUS.REVISAO_HUMANA : STATUS.CONCLUIDO
  await etapasDb.finalizar(item.etapa_id, {
    status,
    motivo: status === STATUS.REVISAO_HUMANA ? MOTIVO.PROVA_INSUFICIENTE
      : (medida.motivo === ATIVIDADE.MOTIVO_NAO_VERIFICADO.CONTRATO_DESCONHECIDO
        ? MOTIVO.CONTRATO_DESCONHECIDO : null),
    resultado: { atividade: medida.atividade, motivo: medida.motivo,
      posts_analisados: medida.posts_analisados, posts_count: medida.posts_count },
    custoCreditos: 1,
  })
}

async function colherPerfis({ limite = 5, agora = new Date() } = {}) {
  const lotes = await etapasDb.aguardandoSnapshot(ETAPA.PERFIL, limite)
  if (!lotes.length) return { ok: true, colhidos: 0 }

  let colhidos = 0
  for (const lote of lotes) {
    const idadeMin = (agora.getTime() - new Date(lote.desde).getTime()) / 60000
    const itens = await etapasDb.etapasDoSnapshot(lote.snapshot_id)
    if (!itens.length) continue

    try {
      const { status } = await brightdata.progress(lote.snapshot_id)

      // A desistencia e' DECIDIDA depois de perguntar o estado — a mesma correcao que a coleta
      // do Maps recebeu no commit 7c8ef97. Um snapshot ja' pronto e' dado PAGO; encerra-lo por
      // idade joga fora exatamente o que se pagou para ter.
      if (status !== 'ready') {
        const morto = status === 'failed' || status === 'error'
        if (!morto && idadeMin < SNAPSHOT_MAX_MIN) continue
        for (const item of itens) {
          const plano = PIPELINE.agendarRetry({
            tentativas: item.tentativas, agora,
            motivo: morto ? MOTIVO.ERRO_TRANSITORIO : MOTIVO.ERRO_TRANSITORIO,
          })
          if (plano.status === STATUS.PENDENTE) {
            await etapasDb.reagendar(item.etapa_id, plano).catch(() => {})
          } else {
            await etapasDb.finalizar(item.etapa_id, plano).catch(() => {})
          }
        }
        continue
      }

      const registros = await brightdata.snapshot(lote.snapshot_id)

      // Snapshot pronto e VAZIO nao e' "nenhum destes perfis existe": e' materializacao atrasada
      // ou defeito do lado de la'. Concluir com "perfil inexistente" aqui marcaria um lote
      // inteiro de leads com um veredito tirado de uma lista vazia.
      if (!registros.length) {
        if (idadeMin < SNAPSHOT_MAX_MIN) continue
        for (const item of itens) {
          const plano = PIPELINE.agendarRetry({ tentativas: item.tentativas, agora })
          if (plano.status === STATUS.PENDENTE) {
            await etapasDb.reagendar(item.etapa_id, plano).catch(() => {})
          } else {
            await etapasDb.finalizar(item.etapa_id, plano).catch(() => {})
          }
        }
        continue
      }

      // Ledger antes de qualquer interpretacao: o numero REAL de registros devolvidos. Nunca
      // existe consumo pago sem linha no ledger — e' o que torna a contabilidade confiavel
      // quando a rede falha no meio. Idempotente por (scraper, snapshot).
      await consumoDb.registrarConsumo({
        empresaId: itens[0].empresa_id,
        scraperType: ORCAMENTO.SCRAPER.IG_PERFIS,
        snapshotId: lote.snapshot_id,
        registros: registros.length,
        contexto: { etapa: ETAPA.PERFIL, leads: itens.length },
      })

      const porHandle = indexarPorHandle(registros)
      for (const item of itens) {
        const handle = IG.normalizarHandle(
          item.lead.instagram_handle || item.lead.instagram_candidato)
        const registro = handle ? porHandle.get(handle) : null

        // Veio registro para os outros e nao para este: o dataset respondeu que este perfil nao
        // existe. Isso e' RESPOSTA, nao falha — e e' informacao de negocio.
        if (!registro || !ATIVIDADE.perfilExiste(registro)) {
          await etapasDb.finalizar(item.etapa_id, {
            status: STATUS.CONCLUIDO, motivo: MOTIVO.PERFIL_INEXISTENTE,
          })
          continue
        }
        await aplicarPerfil(item, registro, { agora })
        colhidos += 1
      }
      logger.info({ operation: 'enriquecimento', etapa: 'perfil',
        snapshotId: lote.snapshot_id, registros: registros.length, leads: itens.length },
        'perfis colhidos')
    } catch (e) {
      logger.warn({ operation: 'enriquecimento', etapa: 'colheita',
        snapshotId: lote.snapshot_id, erro: e.message }, 'colheita re-tenta no proximo tique')
    }
  }
  return { ok: true, colhidos }
}

/**
 * Um tique do enriquecimento. NUNCA lanca: ele roda ao lado dos outros workers, e uma excecao
 * aqui derrubaria o tique inteiro de quem divide o mesmo intervalo.
 */
async function tickEnriquecimento(opcoes = {}) {
  const agora = opcoes.agora || new Date()
  const out = { descoberta: null, disparo: null, colheita: null }
  try { out.descoberta = await processarDescobertas({ agora }) } catch (e) { out.descoberta = { ok: false, erro: e.message } }
  try { out.colheita = await colherPerfis({ agora }) } catch (e) { out.colheita = { ok: false, erro: e.message } }
  try { out.disparo = await dispararPerfis({ agora }) } catch (e) { out.disparo = { ok: false, erro: e.message } }
  return out
}

module.exports = {
  LOTE_DESCOBERTA,
  LOTE_PERFIL,
  SNAPSHOT_MAX_MIN,
  idsDaEtapa,
  seguir,
  indexarPorHandle,
  processarDescobertas,
  dispararPerfis,
  colherPerfis,
  tickEnriquecimento,
}
