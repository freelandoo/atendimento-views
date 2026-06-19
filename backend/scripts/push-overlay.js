'use strict'
/**
 * Publica prompt(s) do disco (prompts/<chave>.md) para o overlay ativo de producao
 * (vendas.prompt_overlays), usando o setOverlay oficial — versionamento + log + a
 * mesma validacao da tela de Prompts do dashboard. Sentido inverso do dump-prompts.js
 * (que exporta banco -> disco).
 *
 * Uso:
 *   node scripts/push-overlay.js system-core [outra-chave ...]
 *
 * Importante: o servidor em execucao so passa a usar o overlay novo apos REINICIAR
 * (os overlays sao carregados no boot por loadOverlaysFromDb). Rode e depois reinicie
 * o servico no Railway (ou faca um redeploy).
 */
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

const ROOT = path.join(__dirname, '..')

// Carrega .env local sem sobrescrever variaveis ja definidas (mesmo padrao do dump-prompts.js).
const envPath = path.join(ROOT, '.env')
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

const { setOverlay, normalizarChavePrompt } = require('../src/prompts')

async function main() {
  const chavesArg = process.argv.slice(2).filter(Boolean)
  if (!chavesArg.length) {
    console.error('Uso: node scripts/push-overlay.js <chave> [outra-chave ...]')
    console.error('Ex.: node scripts/push-overlay.js system-core')
    process.exit(1)
  }

  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL || 'postgresql://evolution:evolution@localhost:5432/evolution_api',
  })

  let publicados = 0
  try {
    for (const chaveRaw of chavesArg) {
      const chave = normalizarChavePrompt(chaveRaw)
      if (!chave) {
        console.error(`❌ chave invalida: ${chaveRaw} (ignorada)`)
        continue
      }
      const arquivo = path.join(ROOT, 'prompts', `${chave}.md`)
      if (!fs.existsSync(arquivo)) {
        console.error(`❌ arquivo nao encontrado: prompts/${chave}.md (ignorado)`)
        continue
      }
      const conteudo = fs.readFileSync(arquivo, 'utf8')
      const atual = await setOverlay(pool, chave, conteudo, 'push-overlay-script')
      console.log(`✅ ${chave} publicado como overlay ativo v${atual.version} (origem: ${atual.origem})`)
      publicados++
    }
  } finally {
    await pool.end()
  }

  console.log(`\nConcluido: ${publicados} overlay(s) publicado(s).`)
  if (publicados > 0) {
    console.log('⚠️  Reinicie o servico no Railway (ou redeploy) para o servidor carregar o overlay novo.')
  }
}

main().catch((err) => {
  console.error('❌', err.message)
  process.exit(1)
})
