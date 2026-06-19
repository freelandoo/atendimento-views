'use strict'

// Script avulso para trocar o modelo primario em vendas.ai_settings.
// Uso: node scripts/update-ai-model.js <novo_modelo>
// Ex.:  node scripts/update-ai-model.js gpt-4o

const { pool } = require('../src/db')

const novoModelo = process.argv[2]
if (!novoModelo) {
  console.error('uso: node scripts/update-ai-model.js <modelo>')
  process.exit(1)
}

;(async () => {
  try {
    const before = await pool.query(
      'SELECT id, provider, model, fallback_provider, fallback_model, updated_at FROM vendas.ai_settings ORDER BY id LIMIT 1'
    )
    if (!before.rows.length) {
      console.error('nenhuma linha em vendas.ai_settings')
      process.exit(1)
    }
    console.log('ANTES:', JSON.stringify(before.rows[0], null, 2))

    const upd = await pool.query(
      "UPDATE vendas.ai_settings SET model = $1, updated_at = NOW() WHERE id = $2 RETURNING id, provider, model, fallback_provider, fallback_model, updated_at",
      [novoModelo, before.rows[0].id]
    )
    console.log('DEPOIS:', JSON.stringify(upd.rows[0], null, 2))
    await pool.end()
    process.exit(0)
  } catch (err) {
    console.error('ERRO:', err.message)
    process.exit(1)
  }
})()
