'use strict'
// Reabre o cross-reference da PAGINA do Facebook para os leads que foram marcados como
// "pagina inexistente" por causa da URL ERRADA (defeito corrigido em 2026-09-22, migration 094).
//
// ─── O DEFEITO QUE ISTO REPARA ──────────────────────────────────────────────────────────
// Ate' a 094 o worker montava `facebook.com/<page_id>/` para consultar a pagina do anunciante.
// Medido na sonda: em 2 de 5 casos a URL navegavel e' OUTRA (`page_profile_uri` aponta para um
// identificador diferente). A consulta caia numa pagina que nao existe, o item voltava sem
// registro e a etapa fechava com `perfil_inexistente` — veredito definitivo sobre um lead que
// nunca foi realmente consultado. Como `enfileirar` e' `ON CONFLICT DO NOTHING`, a etapa fechada
// nunca mais seria tentada: aquele lead ficaria sem telefone, sem site e sem endereco para
// sempre.
//
// ─── A ORDEM IMPORTA, E E' POR ISSO QUE ESTE SCRIPT SOZINHO NAO BASTA ───────────────────
// So' faz sentido reabrir quem JA TEM `anuncio_meta_pagina_url` preenchida — a URL boa, que a
// migration 094 introduziu e que so' e' gravada por uma busca NOVA. Reabrir sem ela mandaria o
// worker montar de novo `facebook.com/<page_id>/`, repetir exatamente o mesmo erro e **gastar
// credito Bright Data** para reconfirmar uma falha. Por isso a condicao e' obrigatoria e nao
// tem flag para ignora-la.
//
// A sequencia correta e':
//   1. Refazer a busca Meta do mercado  -> preenche `anuncio_meta_pagina_url` e enfileira a
//      etapa para quem nunca teve uma (leads anteriores ao commit a6959e5).
//   2. Rodar ESTE script                -> reabre quem ficou fechado como "nao existe" e agora
//      tem URL boa.
//
// ─── GARANTIAS (mesmo padrao dos outros scripts do repo) ────────────────────────────────
//   * SIMULA por padrao. So grava com `-- --aplicar`.
//   * `DATABASE_URL` explicita — o script nunca escolhe banco sozinho.
//   * Um COMMIT por lote, nunca um UPDATE massivo em transacao unica.
//   * Idempotente: rodar de novo nao muda nada (o WHERE so' alcanca etapa fechada com aquele
//     motivo especifico).
//   * Toca UMA etapa (`meta_ads_pagina`) e UM motivo (`perfil_inexistente`). Nao mexe em
//     `revisao_humana`, nao mexe em sucesso, nao mexe em Instagram, nao mexe em `prospects`.
//   * Nenhuma chamada externa e nenhuma chamada paga: ele so' devolve o item para a fila. O
//     gasto vem depois, no worker, com teto proprio (BRIGHTDATA_META_PAGINAS_TETO_DIARIO).
//   * Relatorio sem PII (contagens; nunca nome, telefone ou endereco).
//   * SQL de rollback impresso ao final.
//
// Uso:
//   npm run meta-ads:reabrir-paginas                  # simula
//   npm run meta-ads:reabrir-paginas -- --aplicar     # grava
//   npm run meta-ads:reabrir-paginas -- --empresa=<uuid> --lote=200 --aplicar

const { Pool } = require('pg')

const ETAPA = 'meta_ads_pagina'
const MOTIVO_ALVO = 'perfil_inexistente'
const LOTE_PADRAO = 200

function lerArgs(argv) {
  const args = { aplicar: false, empresa: null, lote: LOTE_PADRAO }
  for (const bruto of argv.slice(2)) {
    const arg = String(bruto)
    if (arg === '--aplicar') args.aplicar = true
    else if (arg.startsWith('--empresa=')) args.empresa = arg.slice(10).trim() || null
    else if (arg.startsWith('--lote=')) {
      const n = Number.parseInt(arg.slice(7), 10)
      args.lote = Number.isFinite(n) ? Math.max(1, Math.min(1000, n)) : LOTE_PADRAO
    } else throw new Error(`argumento desconhecido: ${arg}`)
  }
  return args
}

// A condicao, num lugar so': o raio-x e o UPDATE precisam falar do MESMO conjunto, senao o
// script anuncia um numero e grava outro (defeito que o script irmao ja registrou em comentario).
function where(params, empresa) {
  const cond = [
    `e.etapa = $${params.push(ETAPA)}`,
    `e.status = 'concluido'`,
    `e.motivo = $${params.push(MOTIVO_ALVO)}`,
    // A URL boa e' pre-requisito: sem ela o worker repetiria o mesmo erro, pago.
    `NULLIF(BTRIM(p.anuncio_meta_pagina_url), '') IS NOT NULL`,
  ]
  if (empresa) cond.push(`p.empresa_id = $${params.push(empresa)}::uuid`)
  return cond.join(' AND ')
}

async function raioX(pool, empresa) {
  const params = []
  const cond = where(params, empresa)
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS alvo
       FROM prospectador.enriquecimento_etapas e
       JOIN prospectador.prospects p ON p.id = e.prospect_id
      WHERE ${cond}`,
    params
  )
  // O contraponto: fechados pelo mesmo motivo que NAO tem URL boa. Esses o script deixa de fora
  // de proposito, e o operador precisa ver o numero para saber que falta refazer a busca.
  const params2 = [ETAPA, MOTIVO_ALVO]
  let cond2 = `e.etapa = $1 AND e.status = 'concluido' AND e.motivo = $2
               AND NULLIF(BTRIM(p.anuncio_meta_pagina_url), '') IS NULL`
  if (empresa) { params2.push(empresa); cond2 += ` AND p.empresa_id = $3::uuid` }
  const { rows: semUrl } = await pool.query(
    `SELECT COUNT(*)::int AS total
       FROM prospectador.enriquecimento_etapas e
       JOIN prospectador.prospects p ON p.id = e.prospect_id
      WHERE ${cond2}`,
    params2
  )
  return { alvo: rows[0].alvo, sem_url: semUrl[0].total }
}

async function reabrirLote(pool, empresa, lote) {
  const params = []
  const cond = where(params, empresa)
  params.push(lote)
  // `tentativas` volta a ZERO: a falha anterior nao foi do lead nem da fonte — foi o endereco
  // errado que este repositorio mandou consultar. Manter o contador puniria o lead por um
  // defeito nosso e o mataria como `tentativas_esgotadas` antes da primeira chance real.
  const { rows } = await pool.query(
    `WITH alvo AS (
       SELECT e.id
         FROM prospectador.enriquecimento_etapas e
         JOIN prospectador.prospects p ON p.id = e.prospect_id
        WHERE ${cond}
        ORDER BY e.atualizado_em
        LIMIT $${params.length}
     )
     UPDATE prospectador.enriquecimento_etapas e
        SET status = 'pendente',
            motivo = NULL,
            tentativas = 0,
            proxima_tentativa_em = NOW(),
            lease_ate = NULL,
            snapshot_id = NULL,
            atualizado_em = NOW()
       FROM alvo
      WHERE e.id = alvo.id
      RETURNING e.id`,
    params
  )
  return rows.length
}

async function main() {
  const args = lerArgs(process.argv)
  const url = String(process.env.DATABASE_URL || '').trim()
  if (!url) throw new Error('DATABASE_URL ausente — informe o banco explicitamente.')

  // ⚠️ DIVIDA DECLARADA (pre-existente, nao criada aqui): `rejectUnauthorized: false` e' o que os
  // scripts irmaos deste repositorio ja fazem (backfill-*, medir-*, aprovar-*). Divergir em um
  // script so' criaria dois jeitos de conectar no mesmo banco; corrigir e' mudanca de
  // infraestrutura, para todos de uma vez, com a CA no trust store.
  const pool = new Pool({
    connectionString: url,
    ssl: /railway|amazonaws|supabase|neon|render/i.test(url) ? { rejectUnauthorized: false } : undefined,
    max: 2,
  })

  console.log('\n=== Reabrir cross-reference da pagina (Meta Ads) ===')
  console.log('   modo:', args.aplicar ? 'APLICAR (grava)' : 'SIMULACAO (nao grava)')
  if (args.empresa) console.log('   empresa:', args.empresa)

  const antes = await raioX(pool, args.empresa)
  console.log('\n--- RAIO-X ---')
  console.log('  fechados como "pagina inexistente" COM url boa (serao reabertos):', antes.alvo)
  console.log('  fechados pelo mesmo motivo SEM url boa (ficam de fora):          ', antes.sem_url)
  if (antes.sem_url > 0) {
    console.log('\n  Os "sem url boa" nao sao reabertos de proposito: sem a URL navegavel o worker')
    console.log('  repetiria a consulta errada e gastaria credito para reconfirmar a falha.')
    console.log('  Para eles, refaca a busca Meta do mercado — o upsert grava a URL e enfileira.')
  }

  if (antes.alvo === 0) {
    console.log('\n  Nada a reabrir.\n')
    await pool.end()
    return
  }

  if (!args.aplicar) {
    console.log('\n  SIMULACAO: nada foi gravado. Rode com -- --aplicar para reabrir.\n')
    await pool.end()
    return
  }

  let total = 0
  for (;;) {
    const n = await reabrirLote(pool, args.empresa, args.lote)
    if (!n) break
    total += n
    console.log(`  reabertos: ${total}`)
  }

  console.log('\n--- RESULTADO ---')
  console.log('  etapas reabertas:', total)
  console.log('\n  Elas voltam para a fila e o worker as processa no proximo tique, respeitando')
  console.log('  BRIGHTDATA_META_PAGINAS_TETO_DIARIO. Cada lead custa 1 credito Bright Data.')
  console.log('\n--- ROLLBACK (se precisar desfazer) ---')
  console.log(`  UPDATE prospectador.enriquecimento_etapas
     SET status = 'concluido', motivo = '${MOTIVO_ALVO}', proxima_tentativa_em = NULL
   WHERE etapa = '${ETAPA}' AND status = 'pendente' AND motivo IS NULL
     AND atualizado_em >= NOW() - INTERVAL '1 hour';\n`)

  await pool.end()
}

main().catch((e) => { console.error('\nERRO: ' + e.message + '\n'); process.exit(1) })
