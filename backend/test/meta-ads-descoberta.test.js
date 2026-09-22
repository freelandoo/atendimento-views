'use strict'
const { test } = require('node:test')
const assert = require('node:assert')

const D = require('../src/services/meta-ads-descoberta')

// Fixture no formato REAL devolvido pelo ator Apify `facebook-ads-scraper`, confirmado pela
// sonda de 2026-09-22 contra "energia solar goiania" (ver docs/ai-task-start-log.md).
function registro(overrides = {}) {
  const base = {
    pageId: '364711310049980',
    // Veio em 8/8 na sonda — é dele que sai o permalink, o único link sempre navegável.
    adArchiveID: '1096413629561344',
    isActive: true,
    startDate: 1788332400, // 2026-09-02T07:00:00.000Z
    snapshot: {
      pageName: 'Infasolar',
      linkUrl: 'https://api.whatsapp.com/send',
      ctaType: 'LEARN_MORE',
      pageCategories: ['Business'],
      pageLikeCount: 65,
    },
    publisherPlatform: ['FACEBOOK', 'INSTAGRAM'],
    ad_details: {
      advertiser: {
        page: { about: { text: 'Especialistas em energia solar em Goiania.' } },
        ad_library_page_info: {
          page_info: {
            page_category: 'Solar Energy Company',
            page_profile_uri: 'https://www.facebook.com/61560749886771/',
            ig_username: 'infasolar',
          },
        },
      },
    },
  }
  return { ...base, ...overrides }
}

// ── categoria ────────────────────────────────────────────────────────────────

test('pareceNegocio: sem categoria nenhuma nao descarta por ruido', () => {
  assert.equal(D.pareceNegocio(registro({ snapshot: { pageCategories: [] } })), true)
})

test('pareceNegocio: categoria de politico e bloqueada, mesmo com maiuscula/minuscula diferente', () => {
  const r = registro({ snapshot: { pageCategories: ['Politician'] } })
  assert.equal(D.pareceNegocio(r), false)
})

test('pareceNegocio: categoria de negocio real passa', () => {
  assert.equal(D.pareceNegocio(registro()), true)
})

test('categoriaEspecifica: le o campo fundo em ad_details, quando presente', () => {
  assert.equal(D.categoriaEspecifica(registro()), 'Solar Energy Company')
})

test('categoriaEspecifica: vazio quando o registro nao tem os detalhes da pagina', () => {
  assert.equal(D.categoriaEspecifica({ pageId: '1' }), '')
})

// ── normalizarAnuncio ───────────────────────────────────────────────────────

test('normalizarAnuncio: extrai data de inicio a partir do epoch em segundos', () => {
  const a = D.normalizarAnuncio(registro())
  assert.equal(a.inicioEm.toISOString(), '2026-09-02T07:00:00.000Z')
})

test('normalizarAnuncio: sem startDate, inicioEm e null (nunca uma data inventada)', () => {
  const a = D.normalizarAnuncio(registro({ startDate: undefined }))
  assert.equal(a.inicioEm, null)
})

test('normalizarAnuncio: le o Instagram declarado na pagina, quando presente', () => {
  const a = D.normalizarAnuncio(registro())
  assert.equal(a.igUsernameDeclarado, 'infasolar')
})

// ── avaliarAnuncio ──────────────────────────────────────────────────────────

test('avaliarAnuncio: sem page_id nunca e aproveitavel (nao ha identidade pra deduplicar)', () => {
  const v = D.avaliarAnuncio(registro({ pageId: '' }))
  assert.equal(v.aproveitavel, false)
  assert.equal(v.motivo, D.MOTIVO.SEM_PAGE_ID)
})

test('avaliarAnuncio: categoria de ruido descarta antes de olhar o link', () => {
  const v = D.avaliarAnuncio(registro({ snapshot: { pageCategories: ['Politician'], linkUrl: 'https://algumaempresa.com.br' } }))
  assert.equal(v.aproveitavel, false)
  assert.equal(v.motivo, D.MOTIVO.CATEGORIA_NAO_NEGOCIO)
})

test('avaliarAnuncio: link para WhatsApp (subdominio de whatsapp.com) NAO conta como site proprio', () => {
  const v = D.avaliarAnuncio(registro()) // linkUrl = api.whatsapp.com/send
  assert.equal(v.aproveitavel, true)
  assert.equal(v.motivo, D.MOTIVO.OK)
  assert.equal(v.site, null)
})

test('avaliarAnuncio: link para fb.me (encurtador do proprio Facebook) NAO conta como site proprio', () => {
  const v = D.avaliarAnuncio(registro({ snapshot: { pageCategories: ['Business'], linkUrl: 'http://fb.me/' } }))
  assert.equal(v.aproveitavel, true)
  assert.equal(v.site, null)
})

test('avaliarAnuncio: dominio independente E o CRITERIO ELIMINATORIO final — descarta mesmo sendo negocio real', () => {
  const v = D.avaliarAnuncio(registro({ snapshot: { pageCategories: ['Business'], linkUrl: 'https://www.atlantis.com/atlantis-the-royal' } }))
  assert.equal(v.aproveitavel, false)
  assert.equal(v.motivo, D.MOTIVO.TEM_SITE_PROPRIO)
  assert.equal(v.site, 'https://www.atlantis.com/atlantis-the-royal')
})

// ── montarLeadDeAnuncio ─────────────────────────────────────────────────────

test('montarLeadDeAnuncio: null quando o veredito nao e aproveitavel', () => {
  const v = D.avaliarAnuncio(registro({ pageId: '' }))
  assert.equal(D.montarLeadDeAnuncio(v, { nicho: 'Energia Solar', cidade: 'Goiania' }), null)
})

test('montarLeadDeAnuncio: nicho/cidade vem do CONTEXTO da busca, nunca da categoria da pagina', () => {
  const v = D.avaliarAnuncio(registro())
  const lead = D.montarLeadDeAnuncio(v, { nicho: 'Energia Solar', cidade: 'Goiania, GO', empresaId: 'e1' })
  assert.equal(lead.nicho, 'Energia Solar')
  assert.equal(lead.cidade, 'Goiania, GO')
  assert.notEqual(lead.nicho, v.categoriaEspecifica)
})

test('montarLeadDeAnuncio: external_ref e o page_id, e a evidencia do anuncio vai junto', () => {
  const v = D.avaliarAnuncio(registro())
  const lead = D.montarLeadDeAnuncio(v, { nicho: 'Energia Solar', cidade: 'Goiania' }, registro())
  assert.equal(lead.external_ref, '364711310049980')
  assert.equal(lead.anuncio_meta_page_id, '364711310049980')
  assert.equal(lead.anuncio_meta_ativo, true)
  assert.ok(lead.anuncio_meta_inicio_em instanceof Date)
  assert.equal(lead.raw_json.fonte, 'meta_ads')
})

test('montarLeadDeAnuncio: usa a categoria especifica como categoria_perfil quando existe', () => {
  const v = D.avaliarAnuncio(registro())
  const lead = D.montarLeadDeAnuncio(v, { nicho: 'x', cidade: 'y' })
  assert.equal(lead.categoria_perfil, 'Solar Energy Company')
})

// ── O destino do anúncio costuma ser um stub que não leva a lugar nenhum ────────────

test('destinoUtilizavel: a raiz nua do encurtador NAO e destino (fb.me/ veio em 5 de 8 na sonda)', () => {
  assert.equal(D.destinoUtilizavel('http://fb.me/'), false)
  assert.equal(D.destinoUtilizavel('http://fb.me'), false)
})

test('destinoUtilizavel: WhatsApp sem numero NAO e destino', () => {
  assert.equal(D.destinoUtilizavel('https://api.whatsapp.com/send'), false)
  assert.equal(D.destinoUtilizavel('https://api.whatsapp.com/send?phone=5562999999999'), true)
})

test('destinoUtilizavel: link com caminho e destino de verdade', () => {
  assert.equal(D.destinoUtilizavel('https://www.instagram.com/simeyzon'), true)
  assert.equal(D.destinoUtilizavel('https://minhaempresa.com.br/promo'), true)
})

test('destinoUtilizavel: vazio ou ilegivel nao e destino', () => {
  assert.equal(D.destinoUtilizavel(''), false)
  assert.equal(D.destinoUtilizavel('nao é url'), false)
})

test('avaliarAnuncio: destino stub NAO vira link do lead (a tela ofereceria um link quebrado)', () => {
  const v = D.avaliarAnuncio(registro({ snapshot: { pageCategories: ['Business'], linkUrl: 'http://fb.me/' } }))
  assert.equal(v.destinoUtil, false)
  assert.equal(v.link_original, null)
  // ...mas a classificação da URL continua valendo: fb.me segue sendo rede social, não site.
  assert.equal(v.aproveitavel, true)
})

test('avaliarAnuncio: destino REAL continua virando link do lead', () => {
  const v = D.avaliarAnuncio(registro({ snapshot: { pageCategories: ['Business'], linkUrl: 'https://www.instagram.com/infasolar' } }))
  assert.equal(v.destinoUtil, true)
  assert.match(v.link_original, /instagram\.com\/infasolar/)
})

test('permalinkDoAnuncio: sempre navegavel, a partir do adArchiveID', () => {
  assert.match(D.permalinkDoAnuncio({ adArchiveID: '123' }), /ads\/library\/\?id=123$/)
  assert.equal(D.permalinkDoAnuncio({}), null)
})

// ── Uma linha por PÁGINA, com a contagem de anúncios ativos ─────────────────

test('agruparPorPagina: 3 anuncios da mesma pagina viram UMA entrada com total 3', () => {
  const lote = [
    registro({ adArchiveID: 'a1' }),
    registro({ adArchiveID: 'a2' }),
    registro({ adArchiveID: 'a3' }),
  ]
  const grupos = D.agruparPorPagina(lote)
  assert.equal(grupos.length, 1)
  assert.equal(grupos[0].totalAtivos, 3)
  assert.equal(grupos[0].anuncios, 3)
})

test('agruparPorPagina: paginas diferentes continuam separadas', () => {
  const grupos = D.agruparPorPagina([registro(), registro({ pageId: '999' })])
  assert.equal(grupos.length, 2)
})

test('agruparPorPagina: anuncio INATIVO nao entra na contagem de ativos', () => {
  const grupos = D.agruparPorPagina([registro({ isActive: false }), registro({ adArchiveID: 'x' })])
  assert.equal(grupos.length, 1)
  assert.equal(grupos[0].totalAtivos, 1)
  assert.equal(grupos[0].anuncios, 2)
})

test('agruparPorPagina: o representante preferido e o que tem destino que ABRE', () => {
  const stub = registro({ adArchiveID: 'stub', snapshot: { pageCategories: ['Business'], linkUrl: 'http://fb.me/' } })
  const bom = registro({ adArchiveID: 'bom', snapshot: { pageCategories: ['Business'], linkUrl: 'https://instagram.com/infasolar' } })
  const grupos = D.agruparPorPagina([stub, bom])
  assert.equal(grupos[0].avaliado.destinoUtil, true)
})

test('montarLeadDeAnuncio: leva a contagem e os dois links que funcionam', () => {
  const v = D.avaliarAnuncio(registro())
  const lead = D.montarLeadDeAnuncio(v, { nicho: 'x', cidade: 'y', totalAtivos: 3 }, registro())
  assert.equal(lead.anuncio_meta_total_ativos, 3)
  assert.match(lead.anuncio_meta_permalink, /ads\/library/)
  assert.match(lead.anuncio_meta_pagina_url, /facebook\.com/)
})

test('montarLeadDeAnuncio: sem contagem grava NULL, nunca 0 (0 afirmaria "sem anuncio ativo")', () => {
  const lead = D.montarLeadDeAnuncio(D.avaliarAnuncio(registro()), { nicho: 'x', cidade: 'y' })
  assert.equal(lead.anuncio_meta_total_ativos, null)
})

// ── Instagram declarado na própria página do anunciante (vem de graça no registro) ──

test('montarLeadDeAnuncio: aproveita o @ declarado na pagina, como CONFIRMADO', () => {
  const v = D.avaliarAnuncio(registro())
  const lead = D.montarLeadDeAnuncio(v, { nicho: 'Energia Solar', cidade: 'Goiania' })
  assert.equal(lead.instagram_handle, 'infasolar')
  assert.equal(lead.instagram_origem, 'pagina_facebook')
  assert.equal(lead.instagram_confianca, 'confirmado')
})

test('montarLeadDeAnuncio: sem @ na pagina, nao inventa vinculo de Instagram', () => {
  const r = registro()
  r.ad_details.advertiser.ad_library_page_info.page_info.ig_username = ''
  const lead = D.montarLeadDeAnuncio(D.avaliarAnuncio(r), { nicho: 'x', cidade: 'y' })
  assert.equal(lead.instagram_handle, null)
  assert.equal(lead.instagram_confianca, null)
})

// ── Dedup entre canais: o anunciante já está na carteira? ───────────────────

test('mesmoNegocio: funde quando o nome de um lado cabe dentro do outro, na mesma cidade', () => {
  const anuncio = { pageName: 'CMD SOLAR' }
  const existente = { nome: 'CMD Solar Energia Ltda', cidade: 'Goiania - GO' }
  assert.equal(D.mesmoNegocio(anuncio, existente, { nicho: 'Energia Solar', cidade: 'Goiania, GO' }), true)
})

test('mesmoNegocio: NAO funde concorrentes que so compartilham nicho e cidade', () => {
  const anuncio = { pageName: 'Energia Solar Goiania' }
  const existente = { nome: 'Solar Energia Goiania', cidade: 'Goiania' }
  // Tirando nicho e cidade nao sobra token distintivo nenhum — e' exatamente o caso que
  // casaria todo mundo do mercado.
  assert.equal(D.mesmoNegocio(anuncio, existente, { nicho: 'Energia Solar', cidade: 'Goiania' }), false)
})

test('mesmoNegocio: NAO funde por UM token generico em comum quando os dois nomes tem mais', () => {
  const anuncio = { pageName: 'Brasil Solar Pantanal' }
  const existente = { nome: 'Brasil Solar Araguaia', cidade: 'Goiania' }
  assert.equal(D.mesmoNegocio(anuncio, existente, { nicho: 'Energia Solar', cidade: 'Goiania' }), false)
})

test('mesmoNegocio: cidade diferente nunca funde, mesmo com o nome igual', () => {
  const anuncio = { pageName: 'Infasolar' }
  const existente = { nome: 'Infasolar', cidade: 'Campinas - SP' }
  assert.equal(D.mesmoNegocio(anuncio, existente, { nicho: 'Energia Solar', cidade: 'Goiania' }), false)
})

test('mesmoNegocio: cidade desconhecida de um dos lados nao autoriza fusao', () => {
  const anuncio = { pageName: 'Infasolar' }
  assert.equal(D.mesmoNegocio(anuncio, { nome: 'Infasolar', cidade: '' }, { nicho: 'Energia Solar', cidade: 'Goiania' }), false)
})

test('mesmoNegocio: o @ do Instagram e PROVA FORTE e funde SEM cidade (busca Meta pode nao ter)', () => {
  // É o caso que produzia a duplicação: sem cidade, nome+cidade não compara nada.
  const anuncio = { pageName: 'Qualquer Nome', igUsernameDeclarado: 'infasolar' }
  const existente = { nome: 'Outro Nome Totalmente Diferente', cidade: '', instagram_handle: 'infasolar' }
  assert.equal(D.mesmoNegocio(anuncio, existente, { nicho: 'Energia Solar', cidade: '' }), true)
})

test('mesmoNegocio: @ DIFERENTE nao funde (e nao cai na regra de nome por acidente)', () => {
  const anuncio = { pageName: 'Infasolar', igUsernameDeclarado: 'infasolar' }
  const existente = { nome: 'Infasolar', cidade: '', instagram_handle: 'outraempresa' }
  assert.equal(D.mesmoNegocio(anuncio, existente, { nicho: 'Energia Solar', cidade: '' }), false)
})

test('escolherLeadExistente: devolve o primeiro que realmente bate, ou null', () => {
  const anuncio = { pageName: 'Infasolar' }
  const ctx = { nicho: 'Energia Solar', cidade: 'Goiania' }
  const lista = [{ id: 'a', nome: 'Outra Empresa', cidade: 'Goiania' }, { id: 'b', nome: 'Infasolar Energia', cidade: 'Goiania' }]
  assert.equal(D.escolherLeadExistente(anuncio, lista, ctx).id, 'b')
  assert.equal(D.escolherLeadExistente(anuncio, [], ctx), null)
})

// ── decidirCrossReferencePagina ─────────────────────────────────────────────

test('decidirCrossReferencePagina: sem page_id nunca roda (nao ha pagina pra buscar)', () => {
  const v = D.decidirCrossReferencePagina({ anuncio_meta_page_id: null })
  assert.equal(v.rodar, false)
})

test('decidirCrossReferencePagina: nunca verificada, roda', () => {
  const v = D.decidirCrossReferencePagina({ anuncio_meta_page_id: '123', anuncio_meta_pagina_verificada_em: null })
  assert.equal(v.rodar, true)
  assert.equal(v.pageId, '123')
})

test('decidirCrossReferencePagina: verificada ha pouco tempo, pula (cache)', () => {
  const agora = new Date('2026-09-22T00:00:00Z')
  const v = D.decidirCrossReferencePagina(
    { anuncio_meta_page_id: '123', anuncio_meta_pagina_verificada_em: new Date('2026-09-20T00:00:00Z') },
    { agora }
  )
  assert.equal(v.rodar, false)
})

test('decidirCrossReferencePagina: cache vencido (> 30 dias), roda de novo', () => {
  const agora = new Date('2026-09-22T00:00:00Z')
  const v = D.decidirCrossReferencePagina(
    { anuncio_meta_page_id: '123', anuncio_meta_pagina_verificada_em: new Date('2026-08-01T00:00:00Z') },
    { agora }
  )
  assert.equal(v.rodar, true)
})

// ── avaliarResultadoPagina ───────────────────────────────────────────────────

function registroPagina(overrides = {}) {
  const base = {
    page_transparency: { page_id: '108895518556697', is_running_ads: true },
    followers: 189,
    address: { formatted: 'Crescent Road, Palm Jumeirah, Dubai, United Arab Emirates' },
    contact_and_basic_info: {
      contact_info: {
        websites: [], phones: [], emails: ['contato@negocio.com.br'],
      },
    },
  }
  return { ...base, ...overrides }
}

test('avaliarResultadoPagina: sem website confirmado, tem_site continua false', () => {
  const a = D.avaliarResultadoPagina(registroPagina())
  assert.equal(a.temSiteProprio, false)
  assert.equal(a.site, null)
  assert.equal(a.email, 'contato@negocio.com.br')
})

test('avaliarResultadoPagina: website em dominio independente confirma site proprio', () => {
  const a = D.avaliarResultadoPagina(registroPagina({
    contact_and_basic_info: { contact_info: { websites: ['https://minhaempresa.com.br'], phones: [], emails: [] } },
  }))
  assert.equal(a.temSiteProprio, true)
  assert.match(a.site, /^https:\/\/minhaempresa\.com\.br\/?$/)
})

test('avaliarResultadoPagina: website que e so rede social NAO confirma site proprio', () => {
  const a = D.avaliarResultadoPagina(registroPagina({
    contact_and_basic_info: { contact_info: { websites: ['https://instagram.com/negocio'], phones: [], emails: [] } },
  }))
  assert.equal(a.temSiteProprio, false)
  assert.equal(a.site, null)
})

test('avaliarResultadoPagina: is_running_ads da propria pagina vem como segunda prova', () => {
  const a = D.avaliarResultadoPagina(registroPagina())
  assert.equal(a.anuncioAtivoConfirmado, true)
})

test('avaliarResultadoPagina: registro vazio/sem identidade nao e perfil existente', () => {
  const a = D.avaliarResultadoPagina({})
  assert.equal(a.perfilExiste, false)
})

test('avaliarResultadoPagina: perfilExiste true quando ha pelo menos o page_id', () => {
  const a = D.avaliarResultadoPagina(registroPagina())
  assert.equal(a.perfilExiste, true)
  assert.equal(a.pageIdConfirmado, '108895518556697')
})
