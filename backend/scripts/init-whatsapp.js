'use strict'

const { pool, initDB } = require('../src/db')

async function setupWhatsappTable() {
  try {
    console.log('\n🚀 Inicializando tabela WhatsApp...\n')

    // Run full initDB which includes our new table
    await initDB()

    // Verify table was created
    const result = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'vendas'
        AND table_name = 'whatsapp_connections'
      )
    `)

    if (result.rows[0].exists) {
      console.log('✅ Tabela whatsapp_connections criada com sucesso!')
      console.log('\nEstrutura da tabela:')
      const columns = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'vendas' AND table_name = 'whatsapp_connections'
        ORDER BY ordinal_position
      `)
      console.log(columns.rows.map(c => `  - ${c.column_name}: ${c.data_type} (nullable: ${c.is_nullable})`).join('\n'))
    } else {
      console.error('❌ Erro: tabela não foi criada')
      process.exit(1)
    }

    console.log('\n✅ WhatsApp integration ready!')
    console.log('   Restart the app or test: GET /dashboard/whatsapp/status\n')

    process.exit(0)
  } catch (err) {
    console.error('\n❌ Erro ao inicializar:', err.message)
    console.error(err.stack)
    process.exit(1)
  }
}

setupWhatsappTable()
