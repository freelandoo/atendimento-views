#!/usr/bin/env node
// @ts-check
'use strict'

// Smoke do SCHEMA contra um Postgres LIMPO — R4 do REFACTOR_REPORT.
//
// ══ O QUE ELE COBRE, E QUE NENHUM OUTRO TESTE COBRIA ══
// `test/migrations-integridade.test.js` confere NOME, ORDEM e contrato do runner lendo os
// arquivos — nunca executa SQL. Ou seja: uma migration com erro de sintaxe, que referencia uma
// tabela que ainda nao existe, ou que depende de um estado que so' a producao tem, passava por
// toda a suite e so' aparecia **no boot do deploy** — onde falha interrompe o boot (Regra 4).
//
// Aqui o caminho REAL do boot (`initDB`: sql/init.sql -> prospectador -> orquestracao ->
// migrations) roda contra um banco vazio de verdade. Se o schema nao se levanta do zero, isto
// falha no CI, nao na Railway.
//
// ══ TRES ASSERCOES, E A SEGUNDA E' A QUE MAIS IMPORTA ══
//   1. `initDB` completa contra banco vazio.
//   2. **Rodar de novo e' inofensivo.** O boot acontece a cada restart do container; uma
//      migration nao idempotente quebraria o segundo deploy, nao o primeiro.
//   3. Toda migration do diretorio ficou registrada em `app.schema_migrations` — nenhuma foi
//      pulada em silencio.
//
// ══ ELE NUNCA ESCOLHE BANCO ══
// Exige `DATABASE_URL` explicita, como `medir:isolamento-empresa` e irmaos. E o destino passa
// pela MESMA guarda do boot (`services/destino-migrations.js`): este script CRIA schema, entao
// apontar para producao seria exatamente o acidente que aquela guarda existe para impedir.

const fs = require('fs')
const path = require('path')

const { avaliarDestino, mensagemDeBloqueio } = require('../src/services/destino-migrations')

const MIGRATIONS_DIR = path.join(__dirname, '..', 'sql', 'migrations')

async function main() {
  const url = String(process.env.DATABASE_URL || '').trim()
  if (!url) {
    console.error('DATABASE_URL e obrigatoria. Este script CRIA schema — ele nunca escolhe banco.')
    console.error('Ex.: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/smoke npm run smoke:migrations')
    process.exit(2)
  }

  const destino = avaliarDestino({ databaseUrl: url, env: process.env })
  if (!destino.permitido) {
    console.error(mensagemDeBloqueio(destino))
    process.exit(2)
  }

  // require DEPOIS da guarda: db.js monta o pool a partir de DATABASE_URL no import.
  const { pool, initDB } = require('../src/db')

  const arquivos = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  console.log(`destino: ${destino.host} · migrations no diretorio: ${arquivos.length}`)

  try {
    const t0 = Date.now()
    await initDB()
    console.log(`1/3 initDB completou em banco vazio (${((Date.now() - t0) / 1000).toFixed(1)}s)`)

    // 2) O boot roda a cada restart. Nao idempotente quebra o SEGUNDO deploy.
    await initDB()
    console.log('2/3 initDB rodou de novo sem erro (idempotente)')

    const { rows } = await pool.query('SELECT nome FROM app.schema_migrations')
    const registradas = new Set(rows.map((r) => r.nome))
    const faltando = arquivos.filter((f) => !registradas.has(f))
    if (faltando.length) {
      console.error(`3/3 FALHOU — migrations nao registradas: ${faltando.join(', ')}`)
      process.exit(1)
    }
    console.log(`3/3 as ${arquivos.length} migrations ficaram registradas em app.schema_migrations`)
    console.log('✅ smoke de migrations ok')
  } finally {
    await pool.end().catch(() => {})
  }
}

main().catch((err) => {
  console.error('❌ smoke de migrations FALHOU')
  console.error(err && err.message ? err.message : err)
  process.exit(1)
})
