'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const raiz = path.join(__dirname, '..')
const ler = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8')

const DB = require('../src/db/prospeccao-distribuicao')

const FONTE_DB = ler('src/db/prospeccao-distribuicao.js')
const ROTA = ler('src/routes/api-prospeccao.js')

function semComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

test('normalizarIds remove duplicados, vazios e respeita o teto operacional', () => {
  const ids = ['a', 'b', 'a', '', null, ...Array.from({ length: 600 }, (_, i) => `x-${i}`)]
  const out = DB.normalizarIds(ids)
  assert.equal(out[0], 'a')
  assert.equal(out[1], 'b')
  assert.equal(new Set(out).size, out.length)
  assert.equal(out.length, 500)
})

test('GUARDA: rota de aprovar e distribuir exige triagem e transferencia', () => {
  const bloco = ROTA.slice(
    ROTA.indexOf("'/prospects/lote/distribuicao'"),
    ROTA.indexOf('module.exports = router')
  )
  assert.match(bloco, /requireCapacidade\(CAP\.LEAD_TRIAR\)/)
  assert.match(bloco, /requireCapacidade\(CAP\.LEAD_TRANSFERIR\)/)
})

test('GUARDA: distribuicao de aquisicao nao casa por texto livre de nicho', () => {
  const src = semComentarios(FONTE_DB)
  assert.doesNotMatch(src, /p\.nicho\s*(=|ILIKE|LIKE)/)
  assert.match(src, /p\.nicho_id IS DISTINCT FROM \$4::uuid/)
  assert.match(src, /D\.sqlRedistribuivel\('p', '\$3'\)/)
})

test('GUARDA: execucao so aprova status iniciais, sem rebaixar enviado/respondido', () => {
  assert.match(FONTE_DB, /STATUS_APROVAVEIS = Object\.freeze\(\['coletado', 'contato_encontrado', 'aguardando', 'rejeitado'\]\)/)
  assert.match(FONTE_DB, /AND status = ANY\(\$4::text\[\]\)/)
  assert.doesNotMatch(FONTE_DB, /STATUS_APROVAVEIS = Object\.freeze\([^)]*'enviado'/)
  assert.doesNotMatch(FONTE_DB, /STATUS_APROVAVEIS = Object\.freeze\([^)]*'respondido'/)
})

test('GUARDA: previa usa a mesma porta de abordagem depois da aprovacao', () => {
  assert.match(FONTE_DB, /require\('\.\.\/services\/lead-qualificacao'\)/)
  assert.match(FONTE_DB, /Q\.sqlAbordavel\('p'\)/)
})

test('GUARDA: escrita de dono usa lock, UPDATE condicionado e historico em lote', () => {
  assert.match(FONTE_DB, /pg_advisory_xact_lock/)
  assert.match(FONTE_DB, /AND t\.responsavel_id IS NULL/)
  assert.match(FONTE_DB, /registrarMudancasEmLote/)
  assert.doesNotMatch(FONTE_DB, /INSERT INTO app\.lead_responsavel_historico/)
})

test('GUARDA: busca e workers nao importam a distribuicao da aquisicao', () => {
  const servicos = fs.readdirSync(path.join(raiz, 'src', 'services'))
    .filter((f) => /worker|auto|scheduler/i.test(f) && f.endsWith('.js'))
    .filter((f) => ler(`src/services/${f}`).includes('prospeccao-distribuicao'))
  assert.deepEqual(servicos, [])
  assert.doesNotMatch(ler('src/prospecting.js'), /prospeccao-distribuicao/)
})
