const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const { OPCOES_FILTRO_ORIGEM, rotuloOrigem, celulaOrigem, rotuloFiltroOrigem } = require('./lead-origem')

const fonte = fs.readFileSync(path.join(__dirname, 'lead-origem.js'), 'utf8')
const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// ── O defeito que o módulo fecha ──────────────────────────────────────────────
test('lead de anuncio da Meta nao e rotulado como Instagram', () => {
  const c = celulaOrigem({ origem: 'meta_ads' })
  assert.equal(c.chave, 'meta_ads')
  assert.equal(c.rotulo, 'Anúncios Meta')
  assert.ok(!/instagram/i.test(c.rotulo))
})

test('as duas origens do Places dividem o mesmo rotulo', () => {
  assert.equal(rotuloOrigem('manual').chave, 'places')
  assert.equal(rotuloOrigem('automatico').chave, 'places')
  assert.equal(rotuloOrigem('manual').rotulo, rotuloOrigem('automatico').rotulo)
})

test('origem desconhecida aparece como ela mesma — nunca escondida, nunca trocada', () => {
  const r = rotuloOrigem('tiktok')
  assert.equal(r.chave, 'desconhecida')
  assert.ok(r.rotulo.includes('tiktok'), 'a origem nova precisa continuar visivel para o operador')
  assert.notEqual(r.chave, 'instagram')
  assert.notEqual(r.chave, 'places')
})

test('origem ausente e um estado proprio, nao uma fonte', () => {
  const r = rotuloOrigem(null)
  assert.equal(r.chave, 'desconhecida')
  assert.equal(r.curto, '—')
})

// ── Seletor ───────────────────────────────────────────────────────────────────
test('a 1a opcao do seletor e o padrao do servidor (sem filtro)', () => {
  assert.equal(OPCOES_FILTRO_ORIGEM[0].valor, '')
})

test('o seletor oferece as tres fontes reais e nao oferece LinkedIn', () => {
  const valores = OPCOES_FILTRO_ORIGEM.map((o) => o.valor)
  assert.deepEqual(valores, ['', 'places', 'instagram', 'meta_ads'])
})

test('LinkedIn continua ROTULADO mesmo sem opcao no seletor', () => {
  assert.equal(rotuloOrigem('linkedin').rotulo, 'LinkedIn')
})

test('o filtro em vigor sempre tem nome — inclusive o alias legado', () => {
  assert.equal(rotuloFiltroOrigem(''), null)
  assert.equal(rotuloFiltroOrigem('places'), 'Google Places')
  assert.equal(rotuloFiltroOrigem('meta_ads'), 'Anúncios Meta')
  assert.equal(rotuloFiltroOrigem('social'), 'Instagram e LinkedIn')
  assert.ok(rotuloFiltroOrigem('linkedin'))
})

// ── Detalhe da célula ─────────────────────────────────────────────────────────
test('o @ aparece so no Instagram, e so quando existe', () => {
  assert.equal(celulaOrigem({ origem: 'instagram', instagram_handle: 'lojax' }).detalhe, '@lojax')
  assert.equal(celulaOrigem({ origem: 'instagram', instagram_handle: '@lojax' }).detalhe, '@lojax')
  assert.equal(celulaOrigem({ origem: 'instagram' }).detalhe, null)
  assert.equal(celulaOrigem({ origem: 'manual', instagram_handle: 'lojax' }).detalhe, null,
    'lead do Places com Instagram encontrado depois continua sendo lead do Places')
})

test('celulaOrigem aguenta lead vazio', () => {
  assert.equal(celulaOrigem(null).chave, 'desconhecida')
  assert.equal(celulaOrigem({}).chave, 'desconhecida')
})

// ── Guardas de regressão ──────────────────────────────────────────────────────
test('o modulo nao DEDUZ origem a partir de outro campo do lead', () => {
  for (const campo of ['place_id', 'link_original', 'maps_url', 'classificacao_url', 'seguidores']) {
    assert.ok(!codigo.includes(campo),
      `lead-origem.js passou a ler "${campo}" — origem e' o que o coletor gravou, nunca deducao`)
  }
  assert.ok(!/l\.site\b/.test(codigo), 'lead-origem.js passou a olhar o site para decidir origem')
})

test('a origem nao e pintada por fonte (origem nao e qualidade)', () => {
  for (const cor of ['emerald', 'rose', 'amber', 'violet', 'cyan', 'red-', 'green-']) {
    assert.ok(!codigo.includes(cor),
      `lead-origem.js ganhou cor por fonte ("${cor}"): origem nao e qualidade nem estado`)
  }
})

test('o modulo e PURO — sem React, rede ou DOM', () => {
  for (const proibido of ['react', 'fetch(', 'document.', 'window.', 'localStorage']) {
    assert.ok(!codigo.includes(proibido), `lead-origem.js passou a depender de "${proibido}"`)
  }
})
