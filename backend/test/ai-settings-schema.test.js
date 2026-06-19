'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
}

test('motor de IA: schema nao sobrescreve provider/model persistidos no banco', () => {
  const initSql = read('sql/init.sql')
  const dbJs = read('src/db.js')

  for (const source of [initSql, dbJs]) {
    assert.doesNotMatch(
      source,
      /UPDATE\s+vendas\.ai_settings[\s\S]*SET\s+provider\s*=/i,
      'init do banco nao deve trocar provider/model ja salvos pelo operador'
    )
  }
})
