'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function fonte(...partes) {
  return fs.readFileSync(path.join(__dirname, '..', 'src', ...partes), 'utf8')
}

test('central entrega o BANT do runtime somente para a conversa do mesmo tenant', () => {
  const src = fonte('routes', 'api-conversas.js')
  assert.match(src, /li\.empresa_id = c\.empresa_id/)
  assert.match(src, /li\.numero = c\.numero/)
  assert.match(src, /li\.tipo = 'playbook_runtime'/)
  assert.match(src, /q_bant\.qualificacao_bant/)
})

test('banco consulta BANT sob demanda pelo prospect e pelo tenant', () => {
  const src = fonte('routes', 'api-prospeccao.js')
  assert.match(src, /router\.get\('\/prospects\/:id\/qualificacao-bant'/)
  assert.match(src, /WHERE id = \$1::uuid AND empresa_id = \$2/)
  assert.match(src, /candidatosTelefoneBR\(prospect\.telefone\)/)
  assert.match(src, /WHERE empresa_id = \$1[\s\S]*tipo = 'playbook_runtime'/)
  assert.match(src, /numero = ANY\(\$2::text\[\]\)/)
})
