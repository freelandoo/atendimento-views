'use strict'
// Equipes Comerciais por Nicho — fundacao backend.
// Testa regras puras e guardas de regressao por fonte; nao abre conexao com banco.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const E = require('../src/services/equipes-comerciais')

const RAIZ = path.join(__dirname, '..')
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8')
const semComentarios = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ')

test('normalizarEquipe exige nome e nicho na criacao', () => {
  assert.throws(() => E.normalizarEquipe({ nome: 'A' }, { criar: true }), /Nome/)
  assert.throws(() => E.normalizarEquipe({ nome: 'Solar' }, { criar: true }), /nicho/)
  assert.deepEqual(
    E.normalizarEquipe({ nome: ' Solar ', nicho_id: 'n1', descricao: ' x ', usuario_ids: ['u1', 'u1', ''] }, { criar: true }),
    { nome: 'Solar', nicho_id: 'n1', descricao: 'x', usuario_ids: ['u1'] }
  )
})

test('normalizarParticipantes aceita lista vazia explicita para remover todos', () => {
  assert.deepEqual(E.normalizarParticipantes({ usuario_ids: [] }), { usuario_ids: [] })
  assert.throws(() => E.normalizarParticipantes({ usuario_ids: 'u1' }), /lista/)
})

test('migration cria equipe por nicho com isolamento por empresa', () => {
  const sql = fonte('sql/migrations/088_equipes_comerciais.sql')
  assert.match(sql, /CREATE TABLE IF NOT EXISTS app\.equipes_comerciais/)
  assert.match(sql, /nicho_id\s+UUID NOT NULL/)
  assert.match(sql, /FOREIGN KEY \(nicho_id, empresa_id\)/)
  assert.match(sql, /REFERENCES app\.nichos \(id, empresa_id\)/)
  assert.match(sql, /ON DELETE RESTRICT/)
})

test('migration impede duas equipes ativas no mesmo nicho e pessoa em duas equipes ativas', () => {
  const sql = fonte('sql/migrations/088_equipes_comerciais.sql')
  assert.match(sql, /equipes_comerciais_um_nicho_ativo_uk[\s\S]*ON app\.equipes_comerciais \(empresa_id, nicho_id\)[\s\S]*WHERE status = 'ativa'/)
  assert.match(sql, /equipe_membros_um_ativo_por_usuario_uk[\s\S]*ON app\.equipe_comercial_membros \(empresa_id, usuario_id\)[\s\S]*WHERE saiu_em IS NULL/)
})

test('migration e aditiva e nao muta dados existentes', () => {
  const sql = semComentarios(fonte('sql/migrations/088_equipes_comerciais.sql'))
  assert.ok(!/(^|;)\s*(UPDATE|DELETE|INSERT)\b/i.test(sql), 'migration nao deve fazer DML em dados existentes')
  assert.match(sql, /CREATE TABLE IF NOT EXISTS app\.equipe_comercial_membros/)
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS/)
})

test('db valida participantes pelo vinculo ativo da propria empresa', () => {
  const src = fonte('src/db/equipes-comerciais.js')
  assert.match(src, /FROM app\.usuarios_empresas ue/)
  assert.match(src, /ue\.empresa_id = \$1/)
  assert.match(src, /ue\.usuario_id = ANY\(\$2::uuid\[\]\)/)
  assert.match(src, /ue\.ativo = true/)
  assert.match(src, /u\.ativo = true/)
})

test('db bloqueia remocao de participantes ate existir devolucao de leads', () => {
  const src = fonte('src/db/equipes-comerciais.js')
  assert.match(src, /REMOCAO_EXIGE_DEVOLUCAO/)
  assert.match(src, /EQUIPE_COM_MEMBROS/)
  assert.match(src, /devolução de leads/)
})

test('db nunca decide equipe por nome de nicho nem por papel literal', () => {
  const src = semComentarios(fonte('src/db/equipes-comerciais.js'))
  assert.ok(!/lower\(.*nicho/.test(src), 'equipe precisa usar nicho_id, nao match por nome')
  assert.ok(!/role\s*===?\s*['"]/.test(src), 'equipe nao decide permissao por papel literal')
})

test('rota aplica auth + empresa + capacidade no router', () => {
  const src = fonte('src/routes/api-equipes-comerciais.js')
  assert.ok(
    /router\.use\(\s*requireAuth,\s*requireEmpresaAccess,\s*requireCapacidade\(\s*CAP\.MEMBROS_GERENCIAR\s*\)\s*\)/.test(src),
    'rota precisa ser protegida por MEMBROS_GERENCIAR no router'
  )
})

test('index monta equipes-comerciais separado do painel /equipe', () => {
  const src = fonte('index.js')
  assert.ok(src.includes("'/api/empresas/:empresaId/equipes-comerciais'"))
  assert.ok(src.includes("api-equipes-comerciais"))
})

test('package.json inclui esta suite', () => {
  const pkg = JSON.parse(fonte('package.json'))
  assert.ok(pkg.scripts.test.includes('test/equipes-comerciais.test.js'))
})
