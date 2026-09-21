'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const { runMigrations } = require('../src/db/migrations')

const DIR = path.join(__dirname, '..', 'sql', 'migrations')
const ARQUIVOS = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
const UUID_PJ = '00000000-0000-0000-0000-000000000001'

// ─── POR QUE ESTE ARQUIVO EXISTE ─────────────────────────────────────────────────────────
// Cada migration ja e' conferida, uma a uma, pelo teste da feature que a criou (a 073 em
// abordagem-manual.test.js, a 081 em brightdata-orcamento.test.js, e assim por diante). O que
// nao existia era guarda sobre o CONJUNTO e sobre o RUNNER — e as 91 migrations sao aplicadas
// automaticamente no boot do container: um erro aqui nao quebra uma tela, derruba o servico
// inteiro na subida.

// ─── O conjunto ──────────────────────────────────────────────────────────────────────────

test('toda migration segue o padrao NNN_nome.sql', () => {
  const foraDoPadrao = ARQUIVOS.filter((f) => !/^\d{3}_[a-z0-9_]+\.sql$/.test(f))
  assert.deepEqual(foraDoPadrao, [], 'nome fora do padrao quebra a ordenacao do runner')
})

test('a ordem alfabetica e a ordem numerica sao a MESMA', () => {
  // `runMigrations` ordena com `.sort()`, que e' alfabetico. Enquanto o prefixo tiver 3 digitos
  // as duas ordens coincidem; no dia em que alguem criar `9_x.sql` ou `1000_x.sql`, o alfabetico
  // passa a divergir do numerico e uma migration roda ANTES da que ela pressupoe aplicada.
  const numerica = [...ARQUIVOS].sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
  assert.deepEqual([...ARQUIVOS].sort(), numerica)
})

test('nenhum numero NOVO de migration e duplicado', () => {
  // 020 e 033 nasceram duplicados (banco_leads_modos/freelandoo_provision e
  // contexto_servicos/roteiros) e assim ficam: migration aplicada e' historia, renomear agora
  // faria o runner reaplicar o arquivo com o nome novo num banco que ja o tem. O que esta trava
  // impede e' o PROXIMO numero repetido — dois arquivos com o mesmo prefixo escondem, de quem
  // le a pasta, qual das duas roda primeiro.
  const DUPLICADOS_HISTORICOS = new Set([20, 33])
  const numeros = ARQUIVOS.map((f) => parseInt(f, 10))
  const repetidos = [...new Set(numeros.filter((n, i) => numeros.indexOf(n) !== i))]
  const novos = repetidos.filter((n) => !DUPLICADOS_HISTORICOS.has(n))
  assert.deepEqual(novos, [], `numero de migration repetido: ${novos.join(', ')}`)
})

test('nenhuma migration esta vazia', () => {
  const vazias = ARQUIVOS.filter((f) => fs.readFileSync(path.join(DIR, f), 'utf8').trim().length === 0)
  assert.deepEqual(vazias, [], 'migration vazia entra em schema_migrations sem ter feito nada')
})

test('migration NOVA nao pode nascer com DEFAULT = empresa PJ', () => {
  // E' o defeito mais caro e mais repetido deste repositorio: o DEFAULT autoriza EM SILENCIO
  // qualquer INSERT futuro que esqueca a coluna, e foi assim que "todo lead de toda empresa
  // nascia marcado como PJ" (migrations 005/006, corrigidas pela 058 e pela 078).
  //
  // As migrations antigas NAO sao reescritas — sao historia aplicada. A trava vale do numero da
  // limpeza (078) em diante.
  const LIMPEZA = 78
  const infratoras = ARQUIVOS
    .filter((f) => parseInt(f, 10) > LIMPEZA)
    .filter((f) => {
      const sql = fs.readFileSync(path.join(DIR, f), 'utf8')
      // Ignora linha de comentario: a 058 CITA o DEFAULT antigo para explicar o que removeu.
      const efetivo = sql.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n')
      return new RegExp(`DEFAULT\\s*'${UUID_PJ}'`, 'i').test(efetivo)
    })
  assert.deepEqual(infratoras, [], `migration com DEFAULT da PJ: ${infratoras.join(', ')}`)
})

// ─── O runner ────────────────────────────────────────────────────────────────────────────

function poolFalso({ aplicadas = [], falharEm = null } = {}) {
  const chamadas = []
  return {
    chamadas,
    async query(sql, params) {
      chamadas.push({ sql: String(sql), params })
      if (/SELECT nome FROM app\.schema_migrations/.test(sql)) {
        return { rows: aplicadas.map((nome) => ({ nome })) }
      }
      if (falharEm && String(sql).includes(falharEm)) {
        throw new Error('erro proposital na migration')
      }
      return { rows: [] }
    },
  }
}

test('runner aplica na ordem dos nomes e registra cada uma', async () => {
  const pool = poolFalso()
  await runMigrations(pool)

  const registradas = pool.chamadas
    .filter((c) => /INSERT INTO app\.schema_migrations/.test(c.sql))
    .map((c) => c.params[0])
  assert.deepEqual(registradas, ARQUIVOS, 'ordem de aplicacao tem de ser a ordem dos nomes')
})

test('runner NAO reaplica migration ja registrada', async () => {
  const jaAplicadas = ARQUIVOS.slice(0, 5)
  const pool = poolFalso({ aplicadas: jaAplicadas })
  await runMigrations(pool)

  const registradas = pool.chamadas
    .filter((c) => /INSERT INTO app\.schema_migrations/.test(c.sql))
    .map((c) => c.params[0])
  assert.deepEqual(registradas, ARQUIVOS.slice(5))
  for (const nome of jaAplicadas) {
    assert.ok(!registradas.includes(nome), `${nome} ja estava aplicada e nao pode rodar de novo`)
  }
})

test('falha em uma migration INTERROMPE o boot — nunca segue em frente', async () => {
  // Se o erro fosse engolido, o processo subiria com o schema pela metade e o defeito so
  // apareceria muito depois, numa consulta a uma coluna que nao existe.
  const alvo = ARQUIVOS[0]
  const sqlDoAlvo = fs.readFileSync(path.join(DIR, alvo), 'utf8').split(/\r?\n/)
    .find((l) => l.trim() && !/^\s*--/.test(l))
  const pool = poolFalso({ falharEm: sqlDoAlvo.trim().slice(0, 20) })

  await assert.rejects(() => runMigrations(pool), /erro proposital/)

  const registradas = pool.chamadas.filter((c) => /INSERT INTO app\.schema_migrations/.test(c.sql))
  assert.equal(registradas.length, 0, 'migration que falhou nao pode ser marcada como aplicada')
})

test('runner garante o schema app e a tabela de controle antes de tudo', async () => {
  const pool = poolFalso()
  await runMigrations(pool)
  assert.match(pool.chamadas[0].sql, /CREATE SCHEMA IF NOT EXISTS app/)
  assert.match(pool.chamadas[1].sql, /CREATE TABLE IF NOT EXISTS app\.schema_migrations/)
})
