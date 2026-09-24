'use strict'
const fs = require('fs')
const path = require('path')
const { logger } = require('../logger')

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'sql', 'migrations')
const { avaliarDestino, mensagemDeBloqueio } = require('../services/destino-migrations')

/**
 * @param {any} pool
 * @param {{ databaseUrl?: string, env?: Record<string, any> }} [opts] injetaveis para teste;
 *   sem eles, le o ambiente do processo.
 */
async function runMigrations(pool, opts = {}) {
  // ⚠️ A GUARDA VEM ANTES DE QUALQUER ESCRITA, inclusive do CREATE SCHEMA abaixo — que ja e'
  // DDL no banco de destino. Ver services/destino-migrations.js: o boot aplica todas as
  // migrations em DATABASE_URL, e o .env de desenvolvimento aponta para producao.
  const destino = avaliarDestino({
    databaseUrl: 'databaseUrl' in opts ? opts.databaseUrl : process.env.DATABASE_URL,
    env: opts.env || process.env,
  })
  if (!destino.permitido) {
    // Erro, nao warn: falha de migration INTERROMPE o boot (Regra 4). Seguir em frente aqui
    // seria subir a aplicacao contra um schema que ninguem sabe em que estado esta.
    throw new Error(mensagemDeBloqueio(destino))
  }

  // Garante schema app e tabela de controle antes de qualquer coisa
  await pool.query(`CREATE SCHEMA IF NOT EXISTS app`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app.schema_migrations (
      id          BIGSERIAL PRIMARY KEY,
      nome        TEXT NOT NULL UNIQUE,
      aplicada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    logger.info('Nenhum diretório de migrations encontrado, pulando.')
    return
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()

  if (files.length === 0) {
    logger.info('Nenhuma migration SQL encontrada.')
    return
  }

  const { rows: aplicadas } = await pool.query(
    'SELECT nome FROM app.schema_migrations'
  )
  const aplicadasSet = new Set(aplicadas.map(r => r.nome))

  for (const file of files) {
    if (aplicadasSet.has(file)) {
      logger.info({ migration: file }, 'Migration já aplicada, pulando.')
      continue
    }

    const sqlPath = path.join(MIGRATIONS_DIR, file)
    const sql = fs.readFileSync(sqlPath, 'utf8')

    logger.info({ migration: file }, 'Aplicando migration...')
    // A transacao exige um CLIENT dedicado, nunca `pool.query`. Cada `pool.query` pega uma
    // conexao do pool, roda e devolve — entao BEGIN, a migration e o COMMIT podiam cair em
    // conexoes DIFERENTES (o pool tem `max: 4`). Quando isso acontece a migration roda em
    // autocommit e o ROLLBACK nao desfaz nada: o schema fica pela metade, o arquivo nao entra
    // em `schema_migrations`, e o boot seguinte tenta aplica-lo do zero sobre o estado sujo.
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query(
        'INSERT INTO app.schema_migrations (nome) VALUES ($1) ON CONFLICT (nome) DO NOTHING',
        [file]
      )
      await client.query('COMMIT')
      logger.info({ migration: file }, '✅ Migration aplicada com sucesso.')
    } catch (err) {
      // O ROLLBACK pode falhar por conta propria (conexao derrubada, por exemplo). Se falhar,
      // quem tem de chegar ao operador e' o erro ORIGINAL da migration, nao o do rollback.
      try {
        await client.query('ROLLBACK')
      } catch (errRollback) {
        logger.error(
          { migration: file, err: errRollback.message },
          '⚠️ ROLLBACK tambem falhou — o estado do schema precisa ser conferido a mao.'
        )
      }
      logger.error({ migration: file, err: err.message }, '❌ Falha na migration — rollback efetuado.')
      throw err
    } finally {
      client.release()
    }
  }
}

module.exports = { runMigrations }
