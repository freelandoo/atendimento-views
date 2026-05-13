'use strict'
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

const envPath = path.join(__dirname, '..', '.env')
if (fs.existsSync(envPath)) {
  for (const linha of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = linha.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const key = t.slice(0, eq).trim()
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue
    let val = t.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    process.env[key] = val
  }
}

const CHAVES = [
  'system', 'empresa', 'followup', 'followup_timing', 'lead-coach',
  'system-core', 'system-primeiro-contato', 'system-diagnostico',
  'system-proposta', 'system-objecao', 'system-fechamento',
]

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://evolution:evolution@localhost:5432/evolution_api'
  })
  const dir = path.join(__dirname, '..', 'logs', 'prompts')
  fs.mkdirSync(dir, { recursive: true })

  let exportados = 0
  for (const chave of CHAVES) {
    const { rows } = await pool.query(
      `SELECT conteudo, version, autor, criado_em
       FROM vendas.prompt_overlays WHERE chave = $1 AND ativo = true LIMIT 1`,
      [chave]
    )
    if (rows.length) {
      const { conteudo, version, autor, criado_em } = rows[0]
      fs.writeFileSync(path.join(dir, `${chave}.current.md`), conteudo, 'utf8')
      const snippet = conteudo.slice(0, 120).replace(/\n/g, ' ')
      const linha = `${criado_em.toISOString()} | ${chave} | v${version} | ${autor || '—'} | dump | ${snippet}\n`
      fs.appendFileSync(path.join(dir, 'history.log'), linha, 'utf8')
      console.log(`✅ ${chave} → v${version} (${criado_em.toISOString().slice(0, 16)})`)
      exportados++
    } else {
      console.log(`📁 ${chave} → sem overlay ativo no banco (arquivo do disco em uso)`)
    }
  }

  await pool.end()
  console.log(`\nDump concluído: ${exportados} prompt(s) exportado(s) para logs/prompts/`)
}

main().catch(err => {
  console.error('❌', err.message)
  process.exit(1)
})
