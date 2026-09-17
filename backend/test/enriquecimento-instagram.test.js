'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const axios = require('axios')

const A = require('../src/services/instagram-atividade')
const P = require('../src/services/enriquecimento-pipeline')
const IG = require('../src/services/instagram-perfil')
const SD = require('../src/services/social-discovery')
const etapasDb = require('../src/db/enriquecimento-etapas')
const { pool } = require('../src/db')
const { idsDaEtapa, indexarPorHandle, seguir } = require('../src/services/enriquecimento-worker')

const SRC = path.join(__dirname, '..', 'src')
const ler = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8')
const FONTE_WORKER = ler('services', 'enriquecimento-worker.js')
const FONTE_PIPELINE = ler('services', 'enriquecimento-pipeline.js')
const FONTE_ATIVIDADE = ler('services', 'instagram-atividade.js')
const FONTE_DB = ler('db', 'enriquecimento-etapas.js')
const FONTE_DISCOVERY = ler('services', 'social-discovery.js')
const FONTE_ROTA = ler('routes', 'api-banco-leads.js')
const FONTE_PROSPECTING = ler('prospecting.js')
const MIGRATION = fs.readFileSync(
  path.join(__dirname, '..', 'sql', 'migrations', '082_enriquecimento_instagram.sql'), 'utf8'
)

const AGORA = new Date('2026-09-17T12:00:00Z')

// Fixture com a FORMA CONFIRMADA pela sonda de 2026-09-17 (snapshot sd_mu4s0dte1kezq4wylo).
// Os nomes de campo aqui nao sao inventados: vieram do registro cru daquela coleta.
function perfil(extra = {}) {
  return {
    account: 'loja_do_ze',
    profile_url: 'https://instagram.com/loja_do_ze',
    profile_name: 'Loja do Ze',
    full_name: 'Loja do Ze',
    biography: 'A melhor loja de Goiania',
    followers: 1200,
    posts_count: 340,
    is_private: false,
    external_url: [],
    external_urls: [],
    posts: [{ datetime: '2026-09-15T00:00:00.000Z', caption: 'oi' }],
    input: { url: 'https://www.instagram.com/loja_do_ze/' },
    ...extra,
  }
}

// ── Classificador de atividade ───────────────────────────────────────────────

test('post recente vira ativo_recente com a data lida da fonte', () => {
  const r = A.classificarAtividade(perfil(), { agora: AGORA })
  assert.equal(r.atividade, A.ATIVIDADE.ATIVO_RECENTE)
  assert.equal(r.ultimo_post_em, '2026-09-15T00:00:00.000Z')
  assert.equal(r.dias_desde_ultimo_post, 2)
  assert.equal(r.posts_count, 340)
})

test('cortes de 30 e 90 dias separam morna de antiga', () => {
  const em = (iso) => A.classificarAtividade(
    perfil({ posts: [{ datetime: iso }] }), { agora: AGORA }).atividade
  assert.equal(em('2026-08-25T00:00:00.000Z'), A.ATIVIDADE.ATIVO_RECENTE)   // 23 dias
  assert.equal(em('2026-07-20T00:00:00.000Z'), A.ATIVIDADE.ATIVIDADE_MORNA) // 59 dias
  assert.equal(em('2026-01-10T00:00:00.000Z'), A.ATIVIDADE.ATIVIDADE_ANTIGA)
})

// Esta e' a razao de o modulo existir do jeito que existe. A sonda mostrou o array FORA DE
// ORDEM num perfil real (indice 8 = 2026-08-14, indice 9 = 2026-09-11): post fixado no topo.
test('post fixado nao engana: a data e o MAXIMO dos lidos, nunca posts[0]', () => {
  const r = A.classificarAtividade(perfil({
    posts: [
      { datetime: '2025-02-01T00:00:00.000Z' }, // fixado, antigo, no topo
      { datetime: '2026-09-16T00:00:00.000Z' }, // o de verdade mais recente
      { datetime: '2026-09-10T00:00:00.000Z' },
    ],
  }), { agora: AGORA })
  assert.equal(r.ultimo_post_em, '2026-09-16T00:00:00.000Z')
  assert.equal(r.atividade, A.ATIVIDADE.ATIVO_RECENTE)
})

test('le no maximo 5 posts, como o operador pediu', () => {
  const posts = Array.from({ length: 12 }, (_, i) => ({ datetime: '2020-01-01T00:00:00.000Z' }))
  posts[9] = { datetime: '2026-09-16T00:00:00.000Z' } // fora da janela dos 5 primeiros
  const r = A.classificarAtividade(perfil({ posts }), { agora: AGORA })
  assert.equal(r.posts_analisados, 5)
  assert.equal(r.atividade, A.ATIVIDADE.ATIVIDADE_ANTIGA)
})

// ── Ausencia de dado NUNCA vira "inativo" ────────────────────────────────────

test('perfil privado e nao_verificado, nunca sem_posts', () => {
  const r = A.classificarAtividade(perfil({ is_private: true, posts: [] }), { agora: AGORA })
  assert.equal(r.atividade, A.ATIVIDADE.NAO_VERIFICADO)
  assert.equal(r.motivo, A.MOTIVO_NAO_VERIFICADO.PERFIL_PRIVADO)
})

test('posts_count = 0 declarado pela fonte e sem_posts (isso e resposta)', () => {
  const r = A.classificarAtividade(perfil({ posts_count: 0, posts: [] }), { agora: AGORA })
  assert.equal(r.atividade, A.ATIVIDADE.SEM_POSTS)
  assert.equal(r.motivo, null)
})

test('registro sem os campos conhecidos e contrato_desconhecido, nao sem_posts', () => {
  const r = A.classificarAtividade({ account: 'x' }, { agora: AGORA })
  assert.equal(r.atividade, A.ATIVIDADE.NAO_VERIFICADO)
  assert.equal(r.motivo, A.MOTIVO_NAO_VERIFICADO.CONTRATO_DESCONHECIDO)
})

test('posts sem data legivel viram sem_data, nunca uma faixa de atividade', () => {
  const r = A.classificarAtividade(perfil({ posts: [{ caption: 'oi' }] }), { agora: AGORA })
  assert.equal(r.atividade, A.ATIVIDADE.NAO_VERIFICADO)
  assert.equal(r.motivo, A.MOTIVO_NAO_VERIFICADO.SEM_DATA)
})

test('nada e null nunca quebram o classificador', () => {
  for (const entrada of [null, undefined, 'texto', 42]) {
    assert.equal(A.classificarAtividade(entrada, { agora: AGORA }).atividade,
      A.ATIVIDADE.NAO_VERIFICADO)
  }
})

test('perfilExiste separa perfil de registro de erro', () => {
  assert.equal(A.perfilExiste(perfil()), true)
  assert.equal(A.perfilExiste({ input: { url: 'x' }, error: 'not found' }), false)
})

// ── Candidato nao vira confirmado sem prova forte ────────────────────────────

// Nome com tokens DISTINTIVOS de proposito: "Loja do Ze" em nicho "loja" nao serve, porque
// `tokensDistintivos` remove nicho, cidade e genericos — e e' exatamente essa a regra que
// impede todo concorrente do mesmo mercado de virar "o mesmo negocio".
const LEAD = {
  nome: 'Pizzaria Bella Napoli', cidade: 'Goiania', nicho: 'pizzaria',
  telefone: '62999887766', site: 'bellanapoli.com.br',
}

test('nome e cidade sozinhos NAO confirmam: o veredito e candidato', () => {
  const v = IG.escolherMelhorCandidato(LEAD, [{
    handle: 'bellanapoli', titulo: 'Bella Napoli Goiania', resumo: 'a melhor pizza',
    url: 'https://instagram.com/bellanapoli',
  }])
  assert.equal(v.forte, false)
  assert.equal(IG.vereditoDaOrigem(IG.ORIGEM.BUSCA, { forte: v.forte }), IG.CONFIANCA.CANDIDATO)
})

test('telefone ou site no perfil PROVAM e confirmam', () => {
  const comTelefone = IG.escolherMelhorCandidato(LEAD, [{
    handle: 'bellanapoli', titulo: 'Bella Napoli', resumo: 'fale conosco 62 99988-7766',
  }])
  assert.equal(comTelefone.forte, true)
  assert.equal(IG.vereditoDaOrigem(IG.ORIGEM.BUSCA, { forte: true }), IG.CONFIANCA.CONFIRMADO)
})

test('o perfil raspado reaproveita bio e links como prova — e e so isso que promove', () => {
  const prova = A.textoDeProva(perfil({
    biography: 'Atendimento 62 99988-7766',
    external_urls: [{ title: 'site', url: 'https://bellanapoli.com.br' }],
  }))
  const v = IG.avaliarCandidato(LEAD, prova)
  assert.equal(v.forte, true)

  const semProva = IG.avaliarCandidato(LEAD, A.textoDeProva(perfil({
    biography: 'seguimos juntos', external_urls: [],
  })))
  assert.equal(semProva.forte, false, 'sem telefone nem site no perfil, continua candidato')
})

test('atividade de candidato nao e verdade sobre o lead', () => {
  assert.equal(P.atividadeConfiavel({ instagram_confianca: IG.CONFIANCA.CONFIRMADO }), true)
  assert.equal(P.atividadeConfiavel({ instagram_confianca: IG.CONFIANCA.CANDIDATO }), false)
  assert.equal(P.atividadeConfiavel({}), false)
})

// ── Decisoes do pipeline ─────────────────────────────────────────────────────

test('descoberta e pulada quando o Instagram ja veio do Google Meu Negocio', () => {
  const d = P.decidirDescoberta({ nome: 'X', instagram_handle: 'x',
    instagram_confianca: IG.CONFIANCA.CONFIRMADO })
  assert.equal(d.rodar, false)
  assert.equal(d.motivo, P.MOTIVO.JA_CONFIRMADO)
})

test('lead sem nome nao gasta consulta', () => {
  const d = P.decidirDescoberta({ nome: '   ' })
  assert.equal(d.rodar, false)
  assert.equal(d.motivo, P.MOTIVO.SEM_NOME)
})

test('perfil RODA para candidato — e para isso que o credito serve', () => {
  const d = P.decidirPerfil({ instagram_candidato: 'loja_do_ze' }, { agora: AGORA })
  assert.equal(d.rodar, true)
  assert.equal(d.handle, 'loja_do_ze')
})

test('cache recente nao repaga o perfil', () => {
  const recente = P.decidirPerfil({
    instagram_handle: 'x', instagram_perfil_em: '2026-09-10T00:00:00Z',
  }, { agora: AGORA })
  assert.equal(recente.rodar, false)
  assert.equal(recente.motivo, P.MOTIVO.CACHE_RECENTE)

  const velho = P.decidirPerfil({
    instagram_handle: 'x', instagram_perfil_em: '2026-01-01T00:00:00Z',
  }, { agora: AGORA })
  assert.equal(velho.rodar, true)
})

test('sem handle nenhum, o perfil nem e tentado', () => {
  assert.equal(P.decidirPerfil({}, { agora: AGORA }).motivo, P.MOTIVO.SEM_HANDLE)
})

// ── Erros, retry e timeout ───────────────────────────────────────────────────

test('erro classificado: so o transitorio volta para a fila', () => {
  assert.equal(P.classificarErro({ statusCode: 503 }).retentar, true)
  assert.equal(P.classificarErro({ code: 'ETIMEDOUT' }).retentar, true)
  assert.equal(P.classificarErro({ statusCode: 429 }).retentar, false)
  assert.equal(P.classificarErro({ statusCode: 429 }).motivo, P.MOTIVO.COTA_ESGOTADA)
  assert.equal(P.classificarErro({ statusCode: 401 }).motivo, P.MOTIVO.FONTE_INDISPONIVEL)
  assert.equal(P.classificarErro({ code: 'DATASET_OFF' }).retentar, false)
  assert.equal(P.classificarErro({ statusCode: 400 }).retentar, false)
})

test('backoff cresce e o teto de tentativas encerra com motivo', () => {
  const t1 = P.agendarRetry({ tentativas: 1, agora: AGORA })
  assert.equal(t1.status, P.STATUS.PENDENTE)
  assert.equal((t1.proximaTentativaEm - AGORA) / 60000, 5)

  const t3 = P.agendarRetry({ tentativas: 3, agora: AGORA })
  assert.equal((t3.proximaTentativaEm - AGORA) / 60000, 120)

  const fim = P.agendarRetry({ tentativas: P.MAX_TENTATIVAS, agora: AGORA })
  assert.equal(fim.status, P.STATUS.FALHOU)
  assert.equal(fim.motivo, P.MOTIVO.TENTATIVAS_ESGOTADAS)
  assert.equal(fim.proximaTentativaEm, null)
})

test('adiar por cota NAO consome tentativa', () => {
  const a = P.adiar({ motivo: P.MOTIVO.COTA_ESGOTADA, agora: AGORA, minutos: 720 })
  assert.equal(a.consomeTentativa, false)
  assert.equal(a.status, P.STATUS.PENDENTE)
})

test('snapshot preso tem teto de idade declarado', () => {
  const W = require('../src/services/enriquecimento-worker')
  assert.ok(W.SNAPSHOT_MAX_MIN > 0 && W.SNAPSHOT_MAX_MIN <= 180)
  assert.match(FONTE_WORKER, /idadeMin\s*<\s*SNAPSHOT_MAX_MIN/,
    'a colheita precisa desistir de snapshot preso por IDADE')
})

test('snapshot pronto nunca e descartado por idade (licao do commit 7c8ef97)', () => {
  const pos = FONTE_WORKER.indexOf("status !== 'ready'")
  const posProgress = FONTE_WORKER.indexOf('brightdata.progress(lote.snapshot_id)')
  assert.ok(posProgress > 0 && pos > posProgress,
    'a desistencia tem de ser decidida DEPOIS de perguntar o estado do job')
})

test('registros vazios em snapshot pronto nao viram perfil_inexistente em massa', () => {
  const trecho = FONTE_WORKER.slice(FONTE_WORKER.indexOf('if (!registros.length)'),
    FONTE_WORKER.indexOf('const porHandle'))
  assert.ok(!/PERFIL_INEXISTENTE/.test(trecho),
    'lote inteiro vazio e falha da fonte, nao veredito sobre os leads')
})

test('indexarPorHandle casa pelo account e pelo eco do input', () => {
  const mapa = indexarPorHandle([
    perfil(),
    { input: { url: 'https://www.instagram.com/outro.perfil/' } },
  ])
  assert.ok(mapa.has('loja_do_ze'))
  assert.ok(mapa.has('outro.perfil'))
})

test('worker aceita o shape snake_case vindo do banco ao seguir para instagram_perfil', () => {
  const ids = idsDaEtapa({
    prospect_id: 'prospect-db',
    empresa_id: 'empresa-db',
  })
  assert.deepEqual(ids, {
    prospectId: 'prospect-db',
    empresaId: 'empresa-db',
  })
})

test('descoberta concluida enfileira instagram_perfil mesmo com item vindo do banco', async (t) => {
  let chamada = null
  t.mock.method(etapasDb, 'enfileirar', async (...args) => {
    chamada = args
    return { enfileirados: 1 }
  })

  await seguir(P.ETAPA.DESCOBERTA, {
    prospect_id: 'prospect-db',
    empresa_id: 'empresa-db',
  })

  assert.deepEqual(chamada, [
    ['prospect-db'],
    { empresaId: 'empresa-db', etapa: P.ETAPA.PERFIL },
  ])
})

test('lead reencontrado com Instagram conhecido reabre perfil quando cache venceu', async (t) => {
  let chamada = null
  t.mock.method(pool, 'query', async (...args) => {
    chamada = args
    return { rowCount: 2 }
  })

  const r = await etapasDb.enfileirarPerfisComCacheVencido(['p1', 'p1', 'p2'], {
    empresaId: 'empresa-1',
    ttlDias: 45,
  })

  assert.equal(r.enfileirados, 2)
  assert.match(chamada[0], /instagram_perfil/)
  assert.match(chamada[0], /instagram_perfil_em IS NULL/)
  assert.match(chamada[0], /ON CONFLICT \(prospect_id, etapa\) DO UPDATE/)
  assert.match(chamada[0], /status NOT IN/)
  assert.deepEqual(chamada[1], ['empresa-1', ['p1', 'p2'], P.ETAPA.PERFIL,
    P.STATUS.PENDENTE, 45, P.STATUS.PENDENTE, P.STATUS.PROCESSANDO])
})

// ── Guardas de regressao: falha da fonte nunca vira veredito ─────────────────

test('o worker so grava descoberta DEPOIS de conferir que a busca aconteceu', () => {
  const guarda = FONTE_WORKER.indexOf('if (!busca.ok)')
  const grava = FONTE_WORKER.indexOf('gravarDescoberta')
  assert.ok(guarda > 0, 'falta a guarda de busca que nao aconteceu')
  assert.ok(grava > guarda, 'gravar veredito antes de conferir a fonte reintroduz o defeito')
})

test('buscarPerfisDeNegocio devolve veredito detalhado, nunca uma lista solta', () => {
  assert.match(FONTE_DISCOVERY, /consultarSerpInstagramDetalhado\(`\$\{negocio\}/,
    'a busca por lead precisa distinguir "nao achei" de "nao perguntei"')
  assert.match(FONTE_DISCOVERY, /BRIGHTDATA_SERP_ENDPOINT\s*=\s*'https:\/\/api\.brightdata\.com\/request'/,
    'a descoberta de Instagram precisa usar Bright Data SERP, nao Google CSE direto')
  assert.ok(!/customsearch\/v1/.test(FONTE_DISCOVERY),
    'social-discovery nao pode voltar a chamar Google Custom Search direto')
  assert.match(FONTE_DISCOVERY, /const consultas = 1/,
    'custo por lead tem de ser previsivel em 1 consulta')
})

test('descoberta de Instagram usa Bright Data SERP mesmo sem Google CSE configurado', async () => {
  const env = { ...process.env }
  const postOriginal = axios.post
  let chamada = null
  try {
    process.env.BRIGHTDATA_API_TOKEN = 'bd-token'
    process.env.BRIGHTDATA_SERP_ZONE = 'serp-zone'
    delete process.env.GOOGLE_CSE_KEY
    delete process.env.GOOGLE_CSE_ID
    axios.post = async (url, body, options) => {
      chamada = { url, body, options }
      return { data: { organic: [
        { link: 'https://www.instagram.com/bellanapoli.goiania/', title: 'Bella Napoli', description: 'Pizzaria em Goiania' },
        { link: 'https://www.instagram.com/p/abc123/', title: 'post ignorado' },
      ] } }
    }

    const r = await SD.buscarPerfisDeNegocio('Pizzaria Bella Napoli', 'Goiania', 5)

    assert.equal(r.ok, true)
    assert.equal(r.consultas, 1)
    assert.deepEqual(r.resultados.map((x) => x.handle), ['bellanapoli.goiania'])
    assert.equal(chamada.url, SD.BRIGHTDATA_SERP_ENDPOINT)
    assert.equal(chamada.body.zone, 'serp-zone')
    assert.equal(chamada.body.format, 'raw')
    assert.equal(chamada.body.data_format, 'parsed_light')
    assert.match(new URL(chamada.body.url).searchParams.get('q'), /site:instagram\.com/)
    assert.equal(chamada.options.headers.Authorization, 'Bearer bd-token')
  } finally {
    axios.post = postOriginal
    process.env = env
  }
})

test('falha da Bright Data SERP devolve ok=false e nao lista vazia como veredito', async () => {
  const env = { ...process.env }
  const postOriginal = axios.post
  try {
    process.env.BRIGHTDATA_API_TOKEN = 'bd-token'
    process.env.BRIGHTDATA_SERP_ZONE = 'serp-zone'
    axios.post = async () => {
      const e = new Error('indisponivel')
      e.response = { status: 503, data: { error: 'temporarily_unavailable' } }
      throw e
    }

    const r = await SD.buscarPerfisDeNegocio('Pizzaria Bella Napoli', 'Goiania')

    assert.equal(r.ok, false)
    assert.equal(r.statusCode, 503)
    assert.equal(r.erro, 'temporarily_unavailable')
    assert.equal(r.consultas, 1)
  } finally {
    axios.post = postOriginal
    process.env = env
  }
})

test('a rota manual tambem nao grava nao_encontrado quando a busca falhou', () => {
  const guarda = FONTE_ROTA.indexOf('if (!busca.ok)')
  const grava = FONTE_ROTA.indexOf('IG.CONFIANCA.NAO_ENCONTRADO')
  assert.ok(guarda > 0 && grava > guarda)
})

test('decisao humana nunca e sobrescrita pelo worker', () => {
  const escritas = FONTE_DB.split('async function').filter((b) =>
    b.startsWith(' gravarPerfil') || b.startsWith(' gravarDescoberta'))
  assert.equal(escritas.length, 2)
  for (const bloco of escritas) {
    assert.match(bloco, /instagram_verificado_por IS NOT NULL/,
      'as escritas do worker precisam preservar o que uma pessoa decidiu')
  }
})

test('nenhum comparador de confianca com literal fora do modulo dono', () => {
  for (const fonte of [FONTE_WORKER, FONTE_PIPELINE]) {
    assert.ok(!/===\s*'confirmado'/.test(fonte),
      'compare com IG.CONFIANCA, nunca com o literal')
  }
})

// ── Os leads aparecem ANTES do enriquecimento ────────────────────────────────

test('a importacao so ENFILEIRA: nenhuma busca roda dentro de salvarProspects', () => {
  const ini = FONTE_PROSPECTING.indexOf('async function salvarProspects')
  const fim = FONTE_PROSPECTING.indexOf('function extrairEmailSiteAtivo')
  const bloco = FONTE_PROSPECTING.slice(ini, fim)
  assert.match(bloco, /enriquecimentoDb\.enfileirar/)
  assert.match(bloco, /enriquecimentoDb\.enfileirarPerfisComCacheVencido/)
  for (const proibido of ['tickEnriquecimento', 'buscarPerfisDeNegocio', 'dispararPerfis',
    'processarDescobertas', 'brightdata.trigger']) {
    assert.ok(!bloco.includes(proibido),
      `${proibido} dentro da importacao seguraria leads ja pagos fora do Banco de Leads`)
  }
})

test('o enfileiramento nunca derruba a importacao', () => {
  assert.match(FONTE_PROSPECTING, /enriquecimentoDb\.enfileirar\([\s\S]{0,200}?\}\)\.catch\(/)
  assert.match(FONTE_PROSPECTING,
    /enriquecimentoDb\.enfileirarPerfisComCacheVencido\([\s\S]{0,240}?\}\)\.catch\(/)
  assert.match(FONTE_DB, /async function enfileirar[\s\S]*?catch \(e\) \{[\s\S]*?return \{ enfileirados: 0/)
  assert.match(FONTE_DB,
    /async function enfileirarPerfisComCacheVencido[\s\S]*?catch \(e\) \{[\s\S]*?return \{ enfileirados: 0/)
})

// ── Anti-drift: modulo x migration ───────────────────────────────────────────

test('as etapas do modulo sao exatamente as do CHECK da migration', () => {
  const m = MIGRATION.match(/enriquecimento_etapas_etapa_chk[\s\S]*?CHECK \(etapa IN \(([^)]*)\)\)/)
  const naMigration = m[1].match(/'([a-z_]+)'/g).map((s) => s.replace(/'/g, '')).sort()
  assert.deepEqual(naMigration, [...P.ETAPAS].sort())
})

test('os status do modulo sao exatamente os do CHECK da migration', () => {
  const m = MIGRATION.match(/status_chk[\s\S]*?CHECK \(status IN \(([^)]*)\)\)/)
  const naMigration = m[1].match(/'([a-z_]+)'/g).map((s) => s.replace(/'/g, '')).sort()
  assert.deepEqual(naMigration, [...P.STATUSES].sort())
})

test('os motivos do modulo sao exatamente os do CHECK da migration', () => {
  const m = MIGRATION.match(/motivo IS NULL OR motivo IN \(([\s\S]*?)\)\)/)
  const naMigration = m[1].match(/'([a-z_]+)'/g).map((s) => s.replace(/'/g, '')).sort()
  assert.deepEqual(naMigration, [...P.MOTIVOS].sort())
})

test('as faixas de atividade sao exatamente as do CHECK da migration', () => {
  const m = MIGRATION.match(/instagram_atividade IN \(([\s\S]*?)\)\)/)
  const naMigration = m[1].match(/'([a-z_]+)'/g).map((s) => s.replace(/'/g, '')).sort()
  assert.deepEqual(naMigration, [...A.ATIVIDADES].sort())
})

test('a migration e ADITIVA: nao muta nem apaga dado existente', () => {
  const sql = MIGRATION.replace(/--[^\n]*/g, '')
  for (const verbo of [/\bUPDATE\s+prospectador\./i, /\bDELETE\s+FROM/i, /\bTRUNCATE\b/i,
    /\bDROP\s+TABLE\b/i, /\bDROP\s+COLUMN\b/i]) {
    assert.ok(!verbo.test(sql), `migration nao pode conter ${verbo}`)
  }
})

test('nenhuma coluna nova em prospects nasce com DEFAULT', () => {
  const bloco = MIGRATION.slice(MIGRATION.indexOf('ALTER TABLE prospectador.prospects'))
  const adds = bloco.match(/ADD COLUMN IF NOT EXISTS[^\n,]*/g) || []
  assert.ok(adds.length >= 5)
  for (const add of adds) {
    assert.ok(!/DEFAULT/i.test(add),
      `DEFAULT autoriza em silencio um INSERT futuro que esqueca a coluna: ${add}`)
  }
})

test('nao existe etapa de posts: a sonda mostrou que o perfil ja os traz', () => {
  // Sem comentario: a migration EXPLICA por que a coluna nao existe, e a explicacao cita o nome.
  const sql = MIGRATION.replace(/--[^\n]*/g, '')
  assert.ok(!P.ETAPAS.includes('instagram_posts'))
  assert.ok(!/instagram_posts_json/.test(sql),
    'os posts vivem dentro de instagram_perfil_json; uma coluna propria duplicaria o dado')
  assert.ok(!/ig_posts/.test(FONTE_WORKER),
    'nenhuma chamada paga a um dataset de posts deve existir')
})

test('os nomes de campo do Instagram vem da sonda, e o modulo diz de onde', () => {
  assert.match(FONTE_ATIVIDADE, /sonda/i)
  assert.match(FONTE_ATIVIDADE, /sd_mu4s0dte1kezq4wylo/,
    'o snapshot que provou o contrato precisa estar citado no fonte')
})

// ── O sinal do ICP usa a atividade MEDIDA, e so ela ──────────────────────────

const ICP = require('../src/services/lead-icp-score')
const sinalIg = (lead) => ICP.calcularSinaisAutomaticos(lead).instagram_ativo
const CONFIRMADO = { instagram_handle: 'x', instagram_confianca: 'confirmado' }

test('atividade NAO MEDIDA continua sugerindo: ausencia nao vira negativa', () => {
  const s = sinalIg(CONFIRMADO)
  assert.equal(s.sugerido, true)
  assert.match(s.motivo, /ainda nao verificada/)
})

test('atividade medida e PARADA deixa de sugerir — o sistema nao contraria o que mediu', () => {
  assert.equal(sinalIg({ ...CONFIRMADO, instagram_atividade: 'atividade_antiga' }).sugerido, false)
  assert.equal(sinalIg({ ...CONFIRMADO, instagram_atividade: 'sem_posts' }).sugerido, false)
})

test('perfil privado nao tira a pre-marcacao (nao foi medido, foi impedido)', () => {
  assert.equal(sinalIg({ ...CONFIRMADO, instagram_atividade: 'nao_verificado' }).sugerido, true)
})

test('atividade de CANDIDATO nunca pontua no ICP', () => {
  const s = sinalIg({ instagram_candidato: 'x', instagram_confianca: 'candidato',
    instagram_atividade: 'ativo_recente' })
  assert.equal(s.sugerido, false)
})
