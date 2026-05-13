'use strict'
const fs = require('fs')
const path = require('path')
const { logger } = require('../logger')

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'sql', 'migrations')

async function runMigrations(pool) {
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
    try {
      await pool.query('BEGIN')
      await pool.query(sql)
      await pool.query(
        'INSERT INTO app.schema_migrations (nome) VALUES ($1) ON CONFLICT (nome) DO NOTHING',
        [file]
      )
      await pool.query('COMMIT')
      logger.info({ migration: file }, '✅ Migration aplicada com sucesso.')
    } catch (err) {
      await pool.query('ROLLBACK')
      logger.error({ migration: file, err: err.message }, '❌ Falha na migration — rollback efetuado.')
      throw err
    }
  }
}

module.exports = { runMigrations }
