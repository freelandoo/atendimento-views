'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const { garantirAncoraDaAgenda, MIN_SENHA } = require('../src/db/agenda-usuario-ancora')

// A linha ancora de `vendas.dashboard_users`. `vendas.agenda_eventos.usuario_id` e NOT NULL e
// aponta para ela (sql/init.sql:567); a agenda do bot e o espelho do bloqueio (migration 090)
// leem "o primeiro usuario ativo". Sem linha ativa, o espelho devolve `vale_para_bot: false`
// e o bloqueio de agenda para de valer no WhatsApp — em silencio.

function poolFalso({ ativos = 0 } = {}) {
  const consultas = []
  return {
    consultas,
    query: async (sql, params) => {
      consultas.push({ sql: String(sql), params })
      if (/COUNT\(\*\)/i.test(String(sql))) return { rows: [{ total: ativos }] }
      return { rows: [] }
    },
  }
}

const ENV_OK = { DASHBOARD_ADMIN_EMAIL: 'Dono@Empresa.com', DASHBOARD_ADMIN_PASSWORD: 'senha-bem-longa-123' }

test('semeia quando NAO ha linha ativa', async () => {
  const pool = poolFalso({ ativos: 0 })
  const r = await garantirAncoraDaAgenda(pool, ENV_OK)
  assert.equal(r.criada, true)
  const insert = pool.consultas.find((c) => /INSERT INTO vendas\.dashboard_users/i.test(c.sql))
  assert.ok(insert, 'precisa inserir a ancora')
  assert.equal(insert.params[0], 'dono@empresa.com', 'e-mail normalizado para minusculas')
  assert.match(String(insert.params[2]), /^scrypt\$/, 'password_hash e NOT NULL no schema')
})

test('nao faz nada quando ja existe linha ativa — idempotente', async () => {
  const pool = poolFalso({ ativos: 1 })
  const r = await garantirAncoraDaAgenda(pool, ENV_OK)
  assert.equal(r.criada, false)
  assert.ok(
    !pool.consultas.some((c) => /INSERT/i.test(c.sql)),
    'chamar de novo nao pode duplicar nem reescrever a linha existente'
  )
})

test('sem credencial, o erro DIZ a consequencia — nao e um erro generico', async () => {
  await assert.rejects(
    () => garantirAncoraDaAgenda(poolFalso(), {}),
    (e) => {
      assert.match(e.message, /DASHBOARD_ADMIN_EMAIL/)
      assert.match(e.message, /agenda do bot/, 'quem le o erro precisa saber o que quebra')
      return true
    }
  )
})

test('senha curta e recusada', async () => {
  await assert.rejects(
    () => garantirAncoraDaAgenda(poolFalso(), { ...ENV_OK, DASHBOARD_ADMIN_PASSWORD: 'curta' }),
    new RegExp(`${MIN_SENHA} caracteres`)
  )
})

// ─── Guardas de regressao ────────────────────────────────────────────────────────────────

const fonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'agenda-usuario-ancora.js'), 'utf8')
// Estes arquivos EXPLICAM em comentario o que nao podem FAZER em codigo — casar no texto cru
// daria falso positivo (aconteceu ao escrever este teste). So o codigo e inspecionado.
const semComentarios = (txt) => txt.split(String.fromCharCode(10)).filter((l) => !l.trim().startsWith('//')).join(String.fromCharCode(10))
const codigo = semComentarios(fonte)
const fonteDb = fs.readFileSync(path.join(__dirname, '..', 'src', 'db.js'), 'utf8')
const fonteDash = fs.readFileSync(path.join(__dirname, '..', 'src', 'dashboardAuth.js'), 'utf8')

test('a ancora NAO cria tabela — o schema e do sql/init.sql', () => {
  assert.ok(!/CREATE TABLE/i.test(codigo), 'DDL de dashboard_users pertence ao sql/init.sql')
})

test('o require de auth e TARDIO — no topo ele fecharia um ciclo com db.js', () => {
  // db.js -> agenda-usuario-ancora -> auth -> db.js. No topo, auth receberia os exports ainda
  // vazios de db.js (o module.exports dele e a ultima linha) e `pool` ficaria indefinido na
  // autenticacao do SaaS.
  const linhas = fonte.split('\n')
  const topo = linhas.slice(0, linhas.findIndex((l) => l.startsWith('async function'))).join('\n')
  assert.ok(!/^const .*require\('\.\.\/auth'\)/m.test(topo), "require('../auth') nao pode estar no topo")
  assert.match(fonte, /require\('\.\.\/auth'\)/, 'mas ele precisa existir, dentro da funcao')
})

test('initDB garante a ancora, e o dashboardAuth deixou de ter semente propria', () => {
  assert.match(fonteDb, /garantirAncoraDaAgenda\(pool\)/, 'initDB precisa garantir a ancora')
  assert.ok(
    !/INSERT INTO vendas\.dashboard_users/i.test(fonteDash),
    'a semente tem um dono so: dashboardAuth nao pode voltar a inserir por conta propria'
  )
  assert.match(fonteDash, /garantirAncoraDaAgenda/, 'ele delega')
})

test('a ancora nao depende de nada do dashboard legado', () => {
  // E o ponto do modulo: quando `/dashboard/*` e o dashboardAuth sairem, ele continua de pe.
  assert.ok(!/dashboardAuth/.test(codigo), 'nao pode importar o modulo legado')
})
