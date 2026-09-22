'use strict'
const { test } = require('node:test')
const assert = require('node:assert')

const D = require('../src/services/meta-ads-descoberta')

// Fixture no formato REAL devolvido pelo ator Apify `facebook-ads-scraper`, confirmado pela
// sonda de 2026-09-22 contra "energia solar goiania" (ver docs/ai-task-start-log.md).
function registro(overrides = {}) {
  const base = {
    pageId: '364711310049980',
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
