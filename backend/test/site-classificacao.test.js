'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  classificarUrl,
  classificarMelhorLink,
  classificarLead,
  temSiteProprio,
  situacaoSiteDoLead,
  normalizarUrl,
} = require('../src/services/site-classificacao')

// ── Normalizacao ───────────────────────────────────────────────────────────────

test('normaliza URL sem esquema, com www e com maiusculas', () => {
  assert.equal(normalizarUrl('WWW.Padaria-X.COM.BR/contato').host, 'padaria-x.com.br')
  assert.equal(normalizarUrl('instagram.com/loja').host, 'instagram.com')
  assert.equal(normalizarUrl('https://loja.com.br.').host, 'loja.com.br')
  assert.equal(normalizarUrl('  "https://loja.com.br"  ').host, 'loja.com.br')
})

test('normalizacao rejeita vazio, lixo de planilha e esquema nao-http', () => {
  for (const v of ['', '   ', null, undefined, 'N/A', 'nao', '-', 'sem site']) {
    assert.equal(normalizarUrl(v), null, `deveria rejeitar: ${JSON.stringify(v)}`)
  }
  assert.equal(normalizarUrl('mailto:contato@loja.com.br'), null)
  assert.equal(normalizarUrl('tel:+5511999998888'), null)
})

// ── Casos unitarios exigidos pela regra de negocio ─────────────────────────────

test('dominio proprio valido => site_proprio e tem_site verdadeiro', () => {
  for (const url of [
    'https://padariadobairro.com.br',
    'http://www.clinicasorriso.com',
    'https://advocacia-silva.adv.br/equipe',
    'https://loja.com.br:8443/inicio',
  ]) {
    const r = classificarUrl(url)
    assert.equal(r.classificacao, 'site_proprio', url)
    assert.equal(r.tem_site, true, url)
    assert.ok(r.site, `site proprio deve preencher o campo site: ${url}`)
  }
})

test('Instagram => rede_social e tem_site falso', () => {
  for (const url of ['https://www.instagram.com/lojax', 'instagram.com/lojax/', 'https://instagr.am/lojax']) {
    const r = classificarUrl(url)
    assert.equal(r.classificacao, 'rede_social', url)
    assert.equal(r.tem_site, false, url)
    assert.equal(r.site, null, 'nao pode preencher site proprio com rede social')
  }
})

test('Facebook => rede_social e tem_site falso', () => {
  for (const url of ['https://facebook.com/minhaloja', 'https://m.facebook.com/minhaloja', 'https://fb.me/minhaloja']) {
    assert.equal(classificarUrl(url).classificacao, 'rede_social', url)
    assert.equal(classificarUrl(url).tem_site, false, url)
  }
})

test('TikTok => rede_social e tem_site falso', () => {
  assert.equal(classificarUrl('https://www.tiktok.com/@lojax').classificacao, 'rede_social')
  assert.equal(classificarUrl('https://www.tiktok.com/@lojax').tem_site, false)
})

test('YouTube e WhatsApp => rede_social e tem_site falso', () => {
  assert.equal(classificarUrl('https://youtube.com/@canal').classificacao, 'rede_social')
  assert.equal(classificarUrl('https://youtu.be/abc123').classificacao, 'rede_social')
  assert.equal(classificarUrl('https://wa.me/5511999998888').classificacao, 'rede_social')
  assert.equal(classificarUrl('https://api.whatsapp.com/send?phone=55').classificacao, 'rede_social')
  assert.equal(classificarUrl('https://wa.me/5511999998888').tem_site, false)
})

test('Linktree e demais agregadores => agregador e tem_site falso', () => {
  for (const url of [
    'https://linktr.ee/lojax',
    'https://beacons.ai/lojax',
    'https://bio.link/lojax',
    'https://taplink.cc/lojax',
    'https://lojax.carrd.co',
  ]) {
    const r = classificarUrl(url)
    assert.ok(['agregador', 'desconhecido'].includes(r.classificacao), `${url} -> ${r.classificacao}`)
    assert.equal(r.tem_site, false, url)
    assert.equal(r.site, null, url)
  }
  assert.equal(classificarUrl('https://linktr.ee/lojax').classificacao, 'agregador')
  assert.equal(classificarUrl('https://beacons.ai/lojax').classificacao, 'agregador')
})

test('Google Maps e Perfil da Empresa => perfil_ou_diretorio e tem_site falso', () => {
  for (const url of [
    'https://www.google.com/maps/place/Padaria+X',
    'https://maps.app.goo.gl/abc123',
    'https://g.page/padaria-x',
    'https://padaria-x.negocio.site',
    'https://padaria-x.business.site',
  ]) {
    const r = classificarUrl(url)
    assert.equal(r.classificacao, 'perfil_ou_diretorio', `${url} -> ${r.classificacao}`)
    assert.equal(r.tem_site, false, url)
  }
})

test('marketplace e diretorio => perfil_ou_diretorio e tem_site falso', () => {
  for (const url of [
    'https://www.ifood.com.br/delivery/sp/restaurante-x',
    'https://lista.mercadolivre.com.br/loja-x',
    'https://www.olx.com.br/perfil/loja-x',
    'https://www.tripadvisor.com.br/Restaurant_Review-x',
    'https://www.apontador.com.br/local/x',
  ]) {
    assert.equal(classificarUrl(url).classificacao, 'perfil_ou_diretorio', url)
    assert.equal(classificarUrl(url).tem_site, false, url)
  }
})

test('URL ausente => sem_link e tem_site falso', () => {
  for (const v of [null, undefined, '', '   ']) {
    const r = classificarUrl(v)
    assert.equal(r.classificacao, 'sem_link')
    assert.equal(r.tem_site, false)
    assert.equal(r.site, null)
    assert.equal(r.link_original, null)
  }
})

test('URL duvidosa => desconhecido, NUNCA promovida a site proprio', () => {
  for (const url of [
    'https://bit.ly/3xYz',            // encurtador esconde o destino
    'https://lojax.wixsite.com/site', // subdominio compartilhado de construtor
    'https://lojax.blogspot.com',
    'https://sites.google.com/view/lojax',
    'http://192.168.0.10',            // IP puro
    'http://localhost:3000',
    'https://example.com',            // dominio de exemplo
    'nao é uma url',
  ]) {
    const r = classificarUrl(url)
    assert.equal(r.classificacao, 'desconhecido', `${url} -> ${r.classificacao}`)
    assert.equal(r.tem_site, false, url)
    assert.equal(r.site, null, url)
  }
})

test('link original e sempre preservado para auditoria', () => {
  assert.equal(classificarUrl('  https://instagram.com/lojax  ').link_original, 'https://instagram.com/lojax')
  assert.equal(classificarUrl('bit.ly/3xYz').link_original, 'bit.ly/3xYz')
  assert.equal(classificarUrl('nao é uma url').link_original, 'nao é uma url')
})

test('avalia dominio e subdominio, nao texto solto', () => {
  // "instagram" no CAMINHO de um dominio proprio nao transforma o site em rede social.
  assert.equal(classificarUrl('https://padariax.com.br/instagram').classificacao, 'site_proprio')
  // Dominio que apenas CONTEM o nome nao casa a lista (evita falso positivo).
  assert.equal(classificarUrl('https://instagramdaloja.com.br').classificacao, 'site_proprio')
  // Subdominio de rede social casa.
  assert.equal(classificarUrl('https://business.facebook.com/lojax').classificacao, 'rede_social')
})

test('especificidade: maps.app.goo.gl vence goo.gl', () => {
  assert.equal(classificarUrl('https://maps.app.goo.gl/x').classificacao, 'perfil_ou_diretorio')
  assert.equal(classificarUrl('https://goo.gl/x').classificacao, 'desconhecido')
})

// ── Melhor link entre varios candidatos ────────────────────────────────────────

test('classificarMelhorLink prefere o site proprio sobre a rede social', () => {
  const r = classificarMelhorLink(['https://instagram.com/lojax', 'https://lojax.com.br'])
  assert.equal(r.classificacao, 'site_proprio')
  assert.equal(r.tem_site, true)
})

test('classificarMelhorLink sem site proprio devolve o link informativo', () => {
  assert.equal(classificarMelhorLink([null, 'https://linktr.ee/x']).classificacao, 'agregador')
  assert.equal(classificarMelhorLink([]).classificacao, 'sem_link')
  assert.equal(classificarMelhorLink([null, '']).classificacao, 'sem_link')
})

// ── Visao canonica do LEAD ─────────────────────────────────────────────────────

test('lead com site proprio => tem_site', () => {
  const l = { site: 'https://lojax.com.br', place_id: 'ChIJ_x' }
  assert.equal(situacaoSiteDoLead(l), 'tem_site')
  assert.equal(temSiteProprio(l), true)
})

test('lead cujo unico link e rede social => sem site (decisao do operador)', () => {
  const l = { site: 'https://instagram.com/lojax', tem_site: true, place_id: 'ChIJ_x' }
  assert.equal(situacaoSiteDoLead(l), 'sem_site')
  assert.equal(temSiteProprio(l), false)
})

test('lead social cujo link da bio e agregador => sem site', () => {
  const l = { origem: 'instagram', site: null, link_bio: 'https://linktr.ee/lojax', tem_site: true }
  assert.equal(situacaoSiteDoLead(l), 'sem_site')
  assert.equal(temSiteProprio(l), false)
})

test('lead social sem link nenhum => nao identificado (ninguem verificou)', () => {
  const l = { origem: 'instagram', site: null, link_bio: null, place_id: null }
  assert.equal(situacaoSiteDoLead(l), 'nao_identificado')
})

test('ficha do Maps lida e sem site => sem site confirmado', () => {
  assert.equal(situacaoSiteDoLead({ place_id: 'ChIJ_x', tem_site: false, site: null }), 'sem_site')
})

test('link a verificar nao vira site proprio nem sem site', () => {
  assert.equal(situacaoSiteDoLead({ site: 'https://lojax.wixsite.com/x', place_id: 'ChIJ_x' }), 'nao_identificado')
  assert.equal(temSiteProprio({ site: 'https://lojax.wixsite.com/x' }), false)
})

test('link_original preservado ainda classifica o lead (dado historico)', () => {
  const l = { site: null, link_original: 'https://instagram.com/lojax', place_id: 'ChIJ_x' }
  const r = classificarLead(l)
  assert.equal(r.classificacao, 'rede_social')
  assert.equal(r.situacao_site, 'sem_site')
  assert.equal(r.link_original, 'https://instagram.com/lojax')
})

test('rotulos da tela de atendimento nao chamam rede social de site', () => {
  assert.equal(classificarLead({ site: 'https://lojax.com.br' }).situacao_label, 'Tem site proprio')
  assert.equal(classificarLead({ site: 'https://instagram.com/x', place_id: 'p' }).situacao_label, 'Sem site proprio')
  assert.equal(classificarLead({ site: 'https://bit.ly/x' }).situacao_label, 'Verificar link')
})

test('classificarLead e idempotente e nao lanca com entrada suja', () => {
  for (const l of [{}, { site: 123 }, { site: {} }, { link_bio: [] }, null, undefined]) {
    const r = classificarLead(l || {})
    assert.ok(['tem_site', 'sem_site', 'nao_identificado'].includes(r.situacao_site))
  }
})

// ── INTEGRACAO: todos os consumidores respondem a MESMA coisa ──────────────────
// Estes testes existem porque o defeito original nao era um bug isolado: era a MESMA
// pergunta respondida de sete jeitos diferentes pelo projeto. Se um consumidor voltar a
// decidir por conta propria (`site || tem_site`), um destes quebra.

const { situacaoSite, calcularPrioridade, PESOS } = require('../src/services/ligacao-prioridade')
const { caracteristicasDoLead } = require('../src/services/aquisicao-curadoria-ranking')
const { calcularScoreCadastroPlaces } = require('../src/services/lead-score-cadastro')
const { normalizarProspectPersistido } = require('../src/domainSchemas')

const LEAD_INSTAGRAM = {
  id: 'x', nome: 'Loja X', nicho: 'moda', cidade: 'SP', origem: 'automatico',
  place_id: 'ChIJ_x', telefone: '(11) 99988-7766',
  site: 'https://instagram.com/lojax', tem_site: true,
}
const LEAD_SITE_REAL = { ...LEAD_INSTAGRAM, site: 'https://lojax.com.br' }

test('INTEGRACAO: lead com Instagram sai do filtro "Com site" em TODOS os consumidores', () => {
  assert.equal(temSiteProprio(LEAD_INSTAGRAM), false, 'classificador')
  assert.equal(situacaoSite(LEAD_INSTAGRAM), 'sem_site', 'fila de ligacoes')
  assert.equal(caracteristicasDoLead(LEAD_INSTAGRAM).site, 'sem_site', 'ranking da curadoria')
  assert.equal(calcularScoreCadastroPlaces(LEAD_INSTAGRAM).dados.tem_site, false, 'score de cadastro')
  assert.equal(normalizarProspectPersistido(LEAD_INSTAGRAM).tem_site, false, 'normalizador de persistencia')
})

test('INTEGRACAO: lead com site proprio continua "Com site" em TODOS os consumidores', () => {
  assert.equal(temSiteProprio(LEAD_SITE_REAL), true, 'classificador')
  assert.equal(situacaoSite(LEAD_SITE_REAL), 'tem_site', 'fila de ligacoes')
  assert.equal(caracteristicasDoLead(LEAD_SITE_REAL).site, 'com_site', 'ranking da curadoria')
  assert.equal(calcularScoreCadastroPlaces(LEAD_SITE_REAL).dados.tem_site, true, 'score de cadastro')
  assert.equal(normalizarProspectPersistido(LEAD_SITE_REAL).tem_site, true, 'normalizador de persistencia')
})

test('INTEGRACAO: a prioridade da fila e recalculada — Instagram ganha o bonus de "sem site"', () => {
  const comInstagram = calcularPrioridade(LEAD_INSTAGRAM)
  const comSiteReal = calcularPrioridade(LEAD_SITE_REAL)
  assert.equal(comInstagram.situacao_site, 'sem_site')
  assert.equal(comSiteReal.situacao_site, 'tem_site')
  assert.equal(
    comInstagram.score - comSiteReal.score,
    PESOS.site_ausente_confirmado,
    'o lead com so Instagram deve subir exatamente o bonus de site ausente'
  )
  assert.ok(comInstagram.motivos.includes('Sem site proprio'))
  assert.ok(comSiteReal.motivos.includes('Ja tem site proprio'))
})

test('INTEGRACAO: os 20 pontos de "Tem site proprio" nao sao dados a um Instagram', () => {
  const cadIg = calcularScoreCadastroPlaces(LEAD_INSTAGRAM)
  const cadSite = calcularScoreCadastroPlaces(LEAD_SITE_REAL)
  const criterio = (c) => c.criterios.find((x) => x.chave === 'site')
  assert.equal(criterio(cadIg).ok, false)
  assert.equal(criterio(cadSite).ok, true)
  assert.equal(cadSite.score - cadIg.score, 20)
  // O link continua no payload — some do campo "site", nao da tela.
  assert.equal(cadIg.dados.link_original, 'https://instagram.com/lojax')
})

test('INTEGRACAO: o mesmo lead da a MESMA resposta pelos dois caminhos de leitura', () => {
  // Central de Ligacoes le por `situacaoSite`; Banco de Leads/Prospeccao por
  // `classificarLead`. Divergir aqui e' exatamente o defeito que a tarefa corrigiu.
  for (const lead of [
    LEAD_INSTAGRAM,
    LEAD_SITE_REAL,
    { ...LEAD_INSTAGRAM, site: null, link_bio: 'https://linktr.ee/x', place_id: null },
    { ...LEAD_INSTAGRAM, site: null, link_original: 'https://facebook.com/x' },
    { ...LEAD_INSTAGRAM, site: 'https://bit.ly/x' },
    { ...LEAD_INSTAGRAM, site: null, tem_site: false },
  ]) {
    assert.equal(situacaoSite(lead), classificarLead(lead).situacao_site, JSON.stringify(lead))
  }
})
