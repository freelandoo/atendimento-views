'use strict'
// Motor de CAPTAÇÃO social (Instagram agora; LinkedIn no mesmo caminho).
// Reaproveita a pipeline da prospecção Google: grava em prospectador.prospects, e o
// disparo/elegibilidade/temperatura/agenda continuam sendo os mesmos do Places.
//
// Máquina de estados via prospectador.captacao_snapshots (sem job_queue — ver migration):
//   Instagram: descoberta (hashtag -> usernames) -> perfis (usernames -> bio/contato).
//   LinkedIn : perfis (URLs/keyword -> bio/contato). [descoberta se houver dataset]
//
// Orçamento: teto diário global (BRIGHTDATA_CAPTACAO_TETO_DIARIO, default 5000/30≈166)
// + teto por campanha (captacao_campanhas.teto_diario). Custo medido em registros
// retornados pela Bright Data e somado em captacao_snapshots.custo_registros.

const { pool } = require('../db')
const { logger } = require('../logger')
const brightdata = require('./brightdata-client')
const { extrairContato } = require('./social-contact-extract')
const { descobrirPerfisPorNicho, normalizarSeeds } = require('./social-discovery')
const { normalizarAgendaCampanha, campanhaDevePreencher } = require('./captacao-scheduler')

const PJ_EMPRESA_ID = '00000000-0000-0000-0000-000000000001'
const POLL_MS = Number(process.env.CAPTACAO_WORKER_POLL_MS || 60000)
// A cada quanto tempo o worker reavalia campanhas para disparo automático.
const SCHEDULER_INTERVAL_MS = Math.max(60000, Number(process.env.CAPTACAO_SCHEDULER_INTERVAL_MS || 5 * 60 * 1000))
// Profundidade máxima da bola de neve (nível 0 = sementes; 1 = relacionados; ...).
const SNOWBALL_MAX_NIVEL = Math.max(0, Number(process.env.CAPTACAO_SNOWBALL_MAX_NIVEL || 1))
let captureWorkerTimer = null
let _ultimoSchedulerMs = 0

function tetoDiarioGlobal() {
  const n = Number(process.env.BRIGHTDATA_CAPTACAO_TETO_DIARIO)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : Math.floor(5000 / 30) // ≈166
}

function txt(v, max = 500) {
  const s = String(v == null ? '' : v).trim()
  return s ? s.slice(0, max) : null
}

// ── Adaptadores por fonte ─────────────────────────────────────────────────────
// Cada fonte descreve como descobrir e como coletar perfis. Os dataset_id vêm por env
// (brightdata-client). O formato de input deve bater com o dataset da SUA conta —
// pontos marcados com VERIFICAR.
const ADAPTERS = {
  instagram: {
    descobertaKey: 'ig_descoberta',
    perfisKey: 'ig_perfis',
    discoverBy: 'hashtag',
    // VERIFICAR no painel: chave do termo e do limite no dataset de descoberta.
    buildDescobertaInput: (termo, limite) => [{ hashtag: String(termo).replace(/^#/, ''), num_of_posts: limite }],
    extrairUsernames: (registros) => {
      const out = []
      for (const r of registros || []) {
        const u = r?.user_name || r?.username || r?.owner_username || r?.account || r?.ownerUsername
        if (u) out.push(String(u).replace(/^@/, '').trim())
      }
      return out
    },
    buildPerfisInput: (usernames) => usernames.map((u) => ({ url: `https://www.instagram.com/${u}/` })),
    externalRef: (perfil) =>
      txt(perfil?.account || perfil?.user_name || perfil?.username || perfil?.id, 240),
    perfilUrl: (perfil) => txt(perfil?.profile_url || perfil?.url, 500),
    // Bola de neve: related_accounts vem com user_name em cada perfil raspado.
    extrairRelacionados: (perfil) => {
      const ra = Array.isArray(perfil?.related_accounts) ? perfil.related_accounts : []
      return ra.map((r) => String(r?.user_name || r?.username || '').replace(/^@/, '').trim()).filter(Boolean)
    },
  },
  linkedin: {
    descobertaKey: 'li_descoberta',
    perfisKey: 'li_perfis',
    discoverBy: 'keyword',
    buildDescobertaInput: (termo, limite) => [{ keyword: String(termo), limit: limite }],
    extrairUsernames: (registros) => {
      const out = []
      for (const r of registros || []) {
        const u = r?.url || r?.profile_url || r?.input_url
        if (u) out.push(String(u).trim())
      }
      return out
    },
    buildPerfisInput: (urls) => urls.map((u) => ({ url: /^https?:/i.test(u) ? u : `https://www.linkedin.com/in/${u}` })),
    externalRef: (perfil) => txt(perfil?.url || perfil?.profile_url || perfil?.id, 240),
    perfilUrl: (perfil) => txt(perfil?.url || perfil?.profile_url, 500),
    extrairRelacionados: () => [],
  },
}

function adapter(fonte) {
  const a = ADAPTERS[fonte]
  if (!a) {
    const err = new Error(`Fonte de captação não suportada: ${fonte}`)
    err.statusCode = 400
    throw err
  }
  return a
}

// ── Orçamento ─────────────────────────────────────────────────────────────────
async function consumidoHoje(empresaId, { campanhaId = null } = {}) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(custo_registros),0) AS total
       FROM prospectador.captacao_snapshots
      WHERE empresa_id = $1
        AND created_at >= date_trunc('day', NOW())
        AND ($2::uuid IS NULL OR campanha_id = $2::uuid)`,
    [empresaId, campanhaId]
  )
  return Number(rows[0]?.total || 0)
}

async function orcamentoRestante(empresaId, campanha = null) {
  const globalRestante = Math.max(tetoDiarioGlobal() - (await consumidoHoje(empresaId)), 0)
  if (!campanha) return globalRestante
  const campRestante = Math.max(Number(campanha.teto_diario || 0) - (await consumidoHoje(empresaId, { campanhaId: campanha.id })), 0)
  return Math.min(globalRestante, campRestante)
}

async function resumoOrcamento(empresaId) {
  return {
    teto_diario_global: tetoDiarioGlobal(),
    consumido_hoje: await consumidoHoje(empresaId),
    restante_hoje: await orcamentoRestante(empresaId),
    brightdata_configurado: brightdata.brightDataConfigurado(),
  }
}

// ── Campanhas (hashtags/termos) ───────────────────────────────────────────────
async function listarCampanhas(empresaId) {
  const { rows } = await pool.query(
    `SELECT * FROM prospectador.captacao_campanhas WHERE empresa_id = $1 ORDER BY created_at DESC`,
    [empresaId]
  )
  return rows
}

// Monta o bloco de metadados da campanha (sementes + opções de descoberta).
function montarMetadata(input = {}, base = {}) {
  const perfis = normalizarSeeds(input.perfis_semente ?? input.perfis ?? base.perfis_semente ?? [])
  return {
    perfis_semente: perfis,
    usar_cse: input.usar_cse != null ? Boolean(input.usar_cse) : (base.usar_cse ?? true),
    usar_snowball: input.usar_snowball != null ? Boolean(input.usar_snowball) : (base.usar_snowball ?? true),
    seguir_link_bio: input.seguir_link_bio != null ? Boolean(input.seguir_link_bio) : (base.seguir_link_bio ?? true),
    // Agenda de disparo automático (a cada X horas dentro de janela/dias).
    ...normalizarAgendaCampanha(input, base),
  }
}

async function criarCampanha(empresaId, input = {}) {
  const fonte = ['instagram', 'linkedin'].includes(input.fonte) ? input.fonte : 'instagram'
  const nicho = txt(input.nicho, 160)
  const cidade = txt(input.cidade, 160)
  const meta = montarMetadata(input)
  // Identidade da campanha: o nicho (ou, se vazio, a 1ª semente). Sem hashtag.
  const termo = nicho || (meta.perfis_semente[0] ? '@' + meta.perfis_semente[0] : null)
  if (!termo) {
    const err = new Error('Informe um nicho ou ao menos um perfil semente.')
    err.statusCode = 400
    throw err
  }
  const teto = Math.min(Math.max(parseInt(input.teto_diario, 10) || 50, 1), 5000)
  const { rows } = await pool.query(
    `INSERT INTO prospectador.captacao_campanhas (empresa_id, fonte, termo, nicho, cidade, teto_diario, ativo, metadata_json)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,true),$8::jsonb)
     ON CONFLICT (empresa_id, fonte, lower(termo)) DO UPDATE
       SET nicho = EXCLUDED.nicho, cidade = EXCLUDED.cidade,
           teto_diario = EXCLUDED.teto_diario, ativo = EXCLUDED.ativo,
           metadata_json = EXCLUDED.metadata_json, updated_at = NOW()
     RETURNING *`,
    [empresaId, fonte, termo, nicho, cidade, teto, input.ativo, JSON.stringify(meta)]
  )
  return rows[0]
}

async function atualizarCampanha(empresaId, campanhaId, input = {}) {
  const { rows: atual } = await pool.query(
    `SELECT metadata_json FROM prospectador.captacao_campanhas WHERE empresa_id = $1 AND id = $2::uuid`,
    [empresaId, campanhaId]
  )
  if (!atual[0]) { const e = new Error('Campanha não encontrada.'); e.statusCode = 404; throw e }
  const meta = montarMetadata(input, atual[0].metadata_json || {})
  const { rows } = await pool.query(
    `UPDATE prospectador.captacao_campanhas
        SET nicho = COALESCE($3, nicho),
            cidade = COALESCE($4, cidade),
            teto_diario = COALESCE($5, teto_diario),
            ativo = COALESCE($6, ativo),
            metadata_json = $7::jsonb,
            updated_at = NOW()
      WHERE empresa_id = $1 AND id = $2::uuid
      RETURNING *`,
    [empresaId, campanhaId, txt(input.nicho, 160), txt(input.cidade, 160),
     input.teto_diario != null ? Math.min(Math.max(parseInt(input.teto_diario, 10) || 1, 1), 5000) : null,
     typeof input.ativo === 'boolean' ? input.ativo : null, JSON.stringify(meta)]
  )
  return rows[0]
}

async function removerCampanha(empresaId, campanhaId) {
  await pool.query(`DELETE FROM prospectador.captacao_campanhas WHERE empresa_id = $1 AND id = $2::uuid`, [empresaId, campanhaId])
  return { ok: true }
}

// ── Disparo de coleta ─────────────────────────────────────────────────────────
// Modelo real (sem hashtag): monta a lista de @perfis a partir de
//   (a) sementes informadas/da campanha, e (b) Google CSE por nicho+cidade,
// e dispara o scraper de PERFIS. A bola de neve (related_accounts) acontece depois,
// no worker. Tudo limitado pelo orçamento diário.
async function iniciarColeta(empresaId, input = {}) {
  if (!brightdata.brightDataConfigurado()) {
    const e = new Error('BRIGHTDATA_API_TOKEN ausente — configure para coletar.'); e.statusCode = 503; throw e
  }
  let campanha = null
  let fonte = input.fonte || 'instagram'
  if (input.campanhaId || input.campanha_id) {
    const { rows } = await pool.query(
      `SELECT * FROM prospectador.captacao_campanhas WHERE empresa_id = $1 AND id = $2::uuid`,
      [empresaId, input.campanhaId || input.campanha_id]
    )
    campanha = rows[0]
    if (!campanha) { const e = new Error('Campanha não encontrada.'); e.statusCode = 404; throw e }
    fonte = campanha.fonte
  }
  const a = adapter(fonte)
  const meta = (campanha && campanha.metadata_json) || {}
  const nicho = txt(input.nicho, 160) || (campanha && campanha.nicho) || null
  const cidade = txt(input.cidade, 160) || (campanha && campanha.cidade) || null
  const usarCse = input.usar_cse != null ? Boolean(input.usar_cse) : (meta.usar_cse ?? true)
  const usarSnowball = input.usar_snowball != null ? Boolean(input.usar_snowball) : (meta.usar_snowball ?? true)
  const seguirLinkBio = input.seguir_link_bio != null ? Boolean(input.seguir_link_bio) : (meta.seguir_link_bio ?? true)

  const restante = await orcamentoRestante(empresaId, campanha)
  if (restante <= 0) { const e = new Error('Orçamento diário de captação esgotado.'); e.statusCode = 429; throw e }
  const qtd = Math.min(parseInt(input.limite ?? input.limit, 10) || restante, restante)

  // Sementes = lista informada agora ∪ sementes da campanha.
  const seeds = new Set(normalizarSeeds(input.perfis ?? input.perfis_semente ?? []))
  for (const u of normalizarSeeds(meta.perfis_semente || [])) seeds.add(u)
  // Descoberta por nicho via Google CSE (grátis, sem tocar o Instagram).
  if (usarCse && fonte === 'instagram' && nicho && seeds.size < qtd) {
    const achados = await descobrirPerfisPorNicho(nicho, cidade, qtd - seeds.size)
    for (const u of achados) seeds.add(u)
  }
  const alvos = Array.from(seeds).slice(0, qtd)
  if (alvos.length === 0) {
    const e = new Error('Nenhum perfil para coletar. Informe perfis semente ou um nicho (com Google CSE configurado).')
    e.statusCode = 400; throw e
  }

  const { snapshotId } = await brightdata.trigger(a.perfisKey, a.buildPerfisInput(alvos))
  const termo = nicho || ('@' + alvos[0])
  const { rows } = await pool.query(
    `INSERT INTO prospectador.captacao_snapshots
       (empresa_id, campanha_id, fonte, etapa, snapshot_id, termo, status, payload_json)
     VALUES ($1,$2,$3,'perfis',$4,$5,'pendente',$6::jsonb)
     RETURNING *`,
    [empresaId, campanha?.id || null, fonte, snapshotId, termo,
     JSON.stringify({ nivel: 0, usar_snowball: usarSnowball, seguir_link_bio: seguirLinkBio, alvos: alvos.length, nicho, cidade })]
  )
  if (campanha) {
    await pool.query(`UPDATE prospectador.captacao_campanhas SET ultima_coleta_em = NOW(), updated_at = NOW() WHERE id = $1`, [campanha.id])
  }
  logger.info({ empresaId, fonte, snapshotId, alvos: alvos.length, usarCse, usarSnowball }, '[captacao] coleta de perfis iniciada')
  return rows[0]
}

// ── Upsert de prospect social ─────────────────────────────────────────────────
async function upsertProspectSocial(empresaId, fonte, perfil, campanha = null, opcoes = {}) {
  const a = adapter(fonte)
  const externalRef = a.externalRef(perfil)
  if (!externalRef) return null

  const contato = await extrairContato(perfil, { seguirLink: opcoes.seguirLinkBio })
  const nome = txt(perfil.full_name || perfil.fullName || perfil.name || perfil.account || perfil.user_name || externalRef, 240)
  const handle = txt(perfil.account || perfil.user_name || perfil.username || externalRef, 120)
  const categoria = txt(perfil.business_category_name || perfil.category || perfil.category_name || perfil.account_type, 160)
  const cidade = txt((campanha && campanha.cidade) || perfil.city || perfil.location || perfil.city_name, 160)
  const nicho = txt((campanha && campanha.nicho) || perfil.business_category_name || perfil.category, 160) || fonte
  const seguidores = (() => {
    const n = parseInt(perfil.followers || perfil.followers_count || perfil.edge_followed_by, 10)
    return Number.isFinite(n) ? n : null
  })()
  const site = contato.link_bio || txt(perfil.website, 500) || null
  const temContato = Boolean(contato.email || contato.telefone)
  const status = temContato ? 'contato_encontrado' : 'coletado'

  const raw = { fonte, perfil_url: a.perfilUrl(perfil), sinais_contato: contato.sinais, perfil }

  const { rows } = await pool.query(
    `INSERT INTO prospectador.prospects
       (empresa_id, origem, external_ref, nome, telefone, email, instagram_handle,
        nicho, cidade, bio, link_bio, categoria_perfil, seguidores, tem_site, site,
        status, raw_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)
     ON CONFLICT (empresa_id, origem, external_ref) WHERE external_ref IS NOT NULL
     DO UPDATE SET
        telefone = COALESCE(prospectador.prospects.telefone, EXCLUDED.telefone),
        email = COALESCE(prospectador.prospects.email, EXCLUDED.email),
        bio = COALESCE(EXCLUDED.bio, prospectador.prospects.bio),
        link_bio = COALESCE(EXCLUDED.link_bio, prospectador.prospects.link_bio),
        categoria_perfil = COALESCE(EXCLUDED.categoria_perfil, prospectador.prospects.categoria_perfil),
        seguidores = COALESCE(EXCLUDED.seguidores, prospectador.prospects.seguidores),
        site = COALESCE(prospectador.prospects.site, EXCLUDED.site),
        nome = EXCLUDED.nome,
        -- só promove para contato_encontrado; nunca rebaixa um lead já trabalhado.
        status = CASE
          WHEN prospectador.prospects.status IN ('aprovado','enviado','respondeu','rejeitado','nao_contatar')
            THEN prospectador.prospects.status
          WHEN (COALESCE(prospectador.prospects.telefone, EXCLUDED.telefone) IS NOT NULL
                OR COALESCE(prospectador.prospects.email, EXCLUDED.email) IS NOT NULL)
            THEN 'contato_encontrado'
          ELSE prospectador.prospects.status
        END,
        raw_json = EXCLUDED.raw_json,
        updated_at = NOW()
     RETURNING id, (xmax = 0) AS inserido`,
    [
      empresaId, fonte, externalRef, nome, contato.telefone, contato.email, handle,
      nicho, cidade, contato.bio, contato.link_bio, categoria, seguidores,
      Boolean(site), site, status, JSON.stringify(raw),
    ]
  )
  return rows[0] || null
}

// ── Worker: processa snapshots pendentes ──────────────────────────────────────
async function buscarSnapshotsPendentes(limit = 10) {
  const { rows } = await pool.query(
    `SELECT * FROM prospectador.captacao_snapshots
      WHERE status IN ('pendente','processando') AND snapshot_id IS NOT NULL
      ORDER BY created_at ASC LIMIT $1`,
    [limit]
  )
  return rows
}

async function marcarSnapshot(id, patch = {}) {
  await pool.query(
    `UPDATE prospectador.captacao_snapshots
        SET status = COALESCE($2, status),
            custo_registros = COALESCE($3, custo_registros),
            total_prospects = COALESCE($4, total_prospects),
            erro = $5,
            updated_at = NOW()
      WHERE id = $1::uuid`,
    [id, patch.status || null, patch.custo_registros ?? null, patch.total_prospects ?? null, patch.erro || null]
  )
}

async function processarUmSnapshot(snap) {
  const a = adapter(snap.fonte)
  let estado
  try {
    estado = await brightdata.progress(snap.snapshot_id)
  } catch (err) {
    logger.warn({ snapshot: snap.snapshot_id, err: err.message }, '[captacao] progress falhou (re-tenta depois)')
    return
  }
  if (estado.status === 'running' || estado.status === 'building' || estado.status === 'collecting') {
    if (snap.status !== 'processando') await marcarSnapshot(snap.id, { status: 'processando' })
    return
  }
  if (estado.status === 'failed' || estado.status === 'error') {
    await marcarSnapshot(snap.id, { status: 'falhou', erro: `bright_data:${estado.status}` })
    return
  }
  if (estado.status !== 'ready') return // estado desconhecido — espera próximo tick

  // Pronto: baixa os registros.
  const registros = await brightdata.snapshot(snap.snapshot_id)
  const custo = registros.length

  // Consistência eventual da Bright Data: às vezes o progress reporta 'ready' ANTES de
  // os dados materializarem, e o download volta vazio. Se o progress diz que há registros
  // mas baixamos 0, NÃO finaliza com 0 (senão o snapshot fica preso, nunca reprocessa):
  // mantém 'processando' p/ tentar de novo no próximo tick. Guarda de idade evita loop
  // infinito se os dados de fato nunca vierem.
  const registrosEsperados = Number(estado.raw && estado.raw.records)
  const idadeMin = (Date.now() - new Date(snap.created_at).getTime()) / 60000
  if (custo === 0 && Number.isFinite(registrosEsperados) && registrosEsperados > 0 && idadeMin < 30) {
    if (snap.status !== 'processando') await marcarSnapshot(snap.id, { status: 'processando' })
    logger.warn(
      { snapshot: snap.snapshot_id, esperados: registrosEsperados, idadeMin: Math.round(idadeMin) },
      '[captacao] ready mas download vazio — re-tenta no próximo tick (consistência eventual)'
    )
    return
  }

  if (snap.etapa === 'descoberta') {
    // Extrai usernames/URLs e dispara a etapa de perfis, respeitando orçamento.
    const usernames = Array.from(new Set(a.extrairUsernames(registros))).filter(Boolean)
    let restante = await orcamentoRestante(snap.empresa_id,
      snap.campanha_id ? { id: snap.campanha_id, teto_diario: 999999 } : null)
    restante = Math.max(restante - custo, 0)
    const alvos = usernames.slice(0, Math.max(restante, 0))
    await marcarSnapshot(snap.id, { status: 'concluido', custo_registros: custo, total_prospects: 0 })

    if (alvos.length === 0) {
      logger.info({ snapshot: snap.snapshot_id }, '[captacao] descoberta sem alvos (ou orçamento esgotado)')
      return
    }
    const { snapshotId } = await brightdata.trigger(a.perfisKey, a.buildPerfisInput(alvos))
    await pool.query(
      `INSERT INTO prospectador.captacao_snapshots
         (empresa_id, campanha_id, fonte, etapa, snapshot_id, termo, status, payload_json)
       VALUES ($1,$2,$3,'perfis',$4,$5,'pendente',$6::jsonb)`,
      [snap.empresa_id, snap.campanha_id, snap.fonte, snapshotId, snap.termo, JSON.stringify({ alvos: alvos.length })]
    )
    logger.info({ origem: snap.snapshot_id, perfis: snapshotId, alvos: alvos.length }, '[captacao] etapa perfis disparada')
    return
  }

  // etapa === 'perfis': extrai contato, grava prospects e faz BOLA DE NEVE.
  let campanha = null
  if (snap.campanha_id) {
    const { rows } = await pool.query(`SELECT * FROM prospectador.captacao_campanhas WHERE id = $1`, [snap.campanha_id])
    campanha = rows[0] || null
  }
  const payload = snap.payload_json || {}
  const seguirLinkBio = payload.seguir_link_bio
  let total = 0
  const relacionados = new Set()
  for (const perfil of registros) {
    try {
      const r = await upsertProspectSocial(snap.empresa_id, snap.fonte, perfil, campanha, { seguirLinkBio })
      if (r) total += 1
      if (typeof a.extrairRelacionados === 'function') {
        for (const u of a.extrairRelacionados(perfil)) relacionados.add(u)
      }
    } catch (err) {
      logger.warn({ err: err.message }, '[captacao] falha ao gravar prospect social')
    }
  }
  await marcarSnapshot(snap.id, { status: 'concluido', custo_registros: custo, total_prospects: total })
  logger.info({ snapshot: snap.snapshot_id, prospects: total, relacionados: relacionados.size }, '[captacao] perfis processados')

  // BOLA DE NEVE: expande para related_accounts (mesmo nicho), respeitando nível e orçamento.
  const nivel = Number(payload.nivel || 0)
  if (payload.usar_snowball && nivel < SNOWBALL_MAX_NIVEL && relacionados.size > 0) {
    const candidatos = Array.from(relacionados)
    // Remove quem já existe como prospect desta empresa/fonte (não re-raspar).
    const { rows: jaTem } = await pool.query(
      `SELECT external_ref FROM prospectador.prospects
        WHERE empresa_id = $1 AND origem = $2 AND external_ref = ANY($3::text[])`,
      [snap.empresa_id, snap.fonte, candidatos]
    )
    const conhecidos = new Set(jaTem.map((r) => String(r.external_ref).toLowerCase()))
    let restante = Math.max((await orcamentoRestante(snap.empresa_id, campanha)), 0)
    const novos = candidatos.filter((u) => !conhecidos.has(u.toLowerCase())).slice(0, restante)
    if (novos.length > 0) {
      const { snapshotId } = await brightdata.trigger(a.perfisKey, a.buildPerfisInput(novos))
      await pool.query(
        `INSERT INTO prospectador.captacao_snapshots
           (empresa_id, campanha_id, fonte, etapa, snapshot_id, termo, status, payload_json)
         VALUES ($1,$2,$3,'perfis',$4,$5,'pendente',$6::jsonb)`,
        [snap.empresa_id, snap.campanha_id, snap.fonte, snapshotId, snap.termo,
         JSON.stringify({ nivel: nivel + 1, usar_snowball: true, seguir_link_bio: seguirLinkBio, alvos: novos.length, origem_snowball: true })]
      )
      logger.info({ de: snap.snapshot_id, novo: snapshotId, novos: novos.length, nivel: nivel + 1 }, '[captacao] bola de neve disparada')
    }
  }
}

async function processarSnapshotsPendentes() {
  if (!brightdata.brightDataConfigurado()) return { processados: 0 }
  const pendentes = await buscarSnapshotsPendentes()
  let n = 0
  for (const snap of pendentes) {
    try { await processarUmSnapshot(snap); n += 1 } catch (err) {
      logger.error({ snapshot: snap.snapshot_id, err: err.message }, '[captacao] erro ao processar snapshot')
      await marcarSnapshot(snap.id, { status: 'falhou', erro: String(err.message).slice(0, 500) }).catch(() => {})
    }
  }
  return { processados: n }
}

// Varre campanhas ativas com agendamento ligado e dispara uma nova coleta nas que
// estão "vencidas" (intervalo + janela + dias). Reusa iniciarColeta, que já respeita
// o orçamento diário (lança 429 quando esgota) — erro por campanha não derruba o loop.
async function dispararCampanhasAgendadas(agora = new Date()) {
  if (!brightdata.brightDataConfigurado()) return { disparadas: 0 }
  const { rows } = await pool.query(
    `SELECT id, empresa_id, fonte, nicho, cidade, teto_diario, ativo, ultima_coleta_em, metadata_json
       FROM prospectador.captacao_campanhas
      WHERE ativo = true
        AND COALESCE((metadata_json->>'agendamento_ativo')::boolean, false) = true`
  )
  let disparadas = 0
  for (const camp of rows) {
    try {
      if (!campanhaDevePreencher(camp, agora)) continue
      await iniciarColeta(camp.empresa_id, { campanhaId: camp.id })
      disparadas += 1
    } catch (err) {
      logger.warn({ campanha: camp.id, err: err.message }, '[captacao] agendamento: campanha pulada')
    }
  }
  if (disparadas) logger.info({ disparadas }, '[captacao] campanhas agendadas disparadas')
  return { disparadas }
}

async function captureWorkerTick() {
  await processarSnapshotsPendentes().catch((e) => logger.error('[captacao] tick erro:', e.message))
  if (Date.now() - _ultimoSchedulerMs > SCHEDULER_INTERVAL_MS) {
    _ultimoSchedulerMs = Date.now()
    await dispararCampanhasAgendadas().catch((e) => logger.error('[captacao] scheduler erro:', e.message))
  }
}

function iniciarCaptureWorker() {
  if (captureWorkerTimer) return
  if (!brightdata.brightDataConfigurado()) {
    logger.info('[captacao] worker desligado (BRIGHTDATA_API_TOKEN ausente).')
    return
  }
  captureWorkerTimer = setInterval(() => {
    captureWorkerTick().catch((e) => logger.error('[captacao] tick erro:', e.message))
  }, POLL_MS)
  captureWorkerTick().catch((e) => logger.error('[captacao] primeiro tick erro:', e.message))
  logger.info({ pollMs: POLL_MS, schedulerMs: SCHEDULER_INTERVAL_MS }, '[captacao] worker iniciado')
}

module.exports = {
  tetoDiarioGlobal,
  resumoOrcamento,
  listarCampanhas,
  criarCampanha,
  atualizarCampanha,
  removerCampanha,
  iniciarColeta,
  processarSnapshotsPendentes,
  dispararCampanhasAgendadas,
  iniciarCaptureWorker,
  upsertProspectSocial,
}
