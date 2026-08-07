'use strict'
// CORRECAO HISTORICA — reclassifica `tem_site` / `site` dos leads ja gravados.
//
// Contexto: ate' a migration 056, `prospectador.prospects.site` guardava QUALQUER link e
// `tem_site` era literalmente "tem algum link". Todo lead cujo unico link e' Instagram,
// Facebook, Linktree, wa.me, Google Maps ou perfil de marketplace ficou marcado como "ja
// tem site" — justamente o lead ALVO de uma campanha de criacao de site.
//
// Este script passa o classificador canonico (src/services/site-classificacao.js) sobre
// os links JA ARMAZENADOS e corrige o cache. Ele:
//   - NAO faz nenhuma chamada externa (nada de Bright Data, nada pago, nada de rede);
//   - e' IDEMPOTENTE: rodar dez vezes da' o mesmo resultado da primeira;
//   - roda em LOTES, para nao segurar o banco;
//   - NUNCA apaga o link historico: antes de limpar `site`, copia o valor para
//     `link_original` na MESMA instrucao UPDATE;
//   - so' grava com `--aplicar`. Sem a flag, e' simulacao.
//
// Uso:
//   npm run reclassificar:sites                      # simulacao (padrao), nao grava nada
//   npm run reclassificar:sites -- --aplicar         # grava
//   npm run reclassificar:sites -- --lote=200        # tamanho do lote (padrao 500)
//   npm run reclassificar:sites -- --empresa=<uuid>  # restringe a uma empresa
//   npm run reclassificar:sites -- --tudo            # reprocessa inclusive ja classificados
//
// Por padrao processa os leads AINDA NAO CLASSIFICADOS (`classificacao_url IS NULL`) —
// e' o que torna o script barato de repetir. `--tudo` reprocessa a base inteira, util
// depois de ampliar as listas de dominios do classificador.

const { pool } = require('../src/db')
const { classificarLead, CLASSIFICACOES } = require('../src/services/site-classificacao')

function lerArgs(argv) {
  const args = { aplicar: false, lote: 500, empresa: null, tudo: false }
  for (const bruto of argv.slice(2)) {
    const arg = String(bruto)
    if (arg === '--aplicar') args.aplicar = true
    else if (arg === '--tudo') args.tudo = true
    else if (arg.startsWith('--lote=')) {
      // `parseInt` de "0" e' 0 (falsy): sem o teste explicito, `--lote=0` cairia no
      // default 500 em vez de ser limitado a 1.
      const n = Number.parseInt(arg.slice(7), 10)
      args.lote = Number.isFinite(n) ? Math.max(1, Math.min(5000, n)) : 500
    }
    else if (arg.startsWith('--empresa=')) args.empresa = arg.slice(10).trim() || null
    else if (arg === '--dry-run' || arg === '--simular') args.aplicar = false
    else throw new Error(`argumento desconhecido: ${arg}`)
  }
  return args
}

function novoRelatorio() {
  const porClassificacao = {}
  for (const c of CLASSIFICACOES) porClassificacao[c] = 0
  return {
    analisados: 0,
    alterados: 0,
    mantidos: 0,
    desconhecidos: 0,
    perderam_tem_site: 0,   // estavam como "tem site" e nao tinham
    ganharam_tem_site: 0,   // estavam como "sem site" e tinham site proprio
    links_preservados: 0,   // `site` limpo, valor copiado para `link_original`
    por_classificacao: porClassificacao,
  }
}

// Decide o estado CORRETO de uma linha. Funcao pura: o mesmo input sempre devolve o mesmo
// alvo — e' o que garante a idempotencia do script.
function alvoDaLinha(row) {
  const url = classificarLead(row)
  // O link cru NUNCA se perde: o que ja estava em link_original tem precedencia (pode ter
  // vindo da migration 056); na falta dele, guarda o que estiver em `site`.
  const linkOriginal = row.link_original || row.site || url.link_original || null
  return {
    tem_site: url.tem_site,
    // A coluna `site` guarda SO' site proprio confirmado — a chave e' a CLASSIFICACAO, nao
    // `tem_site`. Desde que link duvidoso ('desconhecido') passou a contar como COM site,
    // os dois deixaram de andar juntos: usar `tem_site` aqui gravaria um bit.ly em `site` e
    // quebraria o contrato. O link duvidoso vive em `link_original`.
    site: url.classificacao === 'site_proprio' ? (row.site || url.site || null) : null,
    link_original: linkOriginal,
    classificacao_url: url.classificacao,
  }
}

function precisaAtualizar(row, alvo) {
  return row.tem_site !== alvo.tem_site
    || (row.site || null) !== (alvo.site || null)
    || (row.link_original || null) !== (alvo.link_original || null)
    || (row.classificacao_url || null) !== (alvo.classificacao_url || null)
}

async function processar(args, rel) {
  const filtros = []
  const params = []
  if (args.empresa) { params.push(args.empresa); filtros.push(`empresa_id = $${params.length}`) }
  if (!args.tudo) filtros.push('classificacao_url IS NULL')
  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''

  // Paginacao por id (keyset): estavel mesmo com o UPDATE mudando as linhas sob o cursor.
  let ultimoId = '00000000-0000-0000-0000-000000000000'
  let lote = 0

  for (;;) {
    const paramsLote = [...params, ultimoId, args.lote]
    const filtroCursor = where ? `${where} AND id > $${paramsLote.length - 1}` : `WHERE id > $${paramsLote.length - 1}`
    const { rows } = await pool.query(
      `SELECT id, empresa_id, site, link_original, classificacao_url, tem_site, link_bio, place_id
         FROM prospectador.prospects
         ${filtroCursor}
        ORDER BY id
        LIMIT $${paramsLote.length}`,
      paramsLote
    )
    if (!rows.length) break
    lote += 1
    ultimoId = rows[rows.length - 1].id

    const paraGravar = []
    for (const row of rows) {
      rel.analisados += 1
      const alvo = alvoDaLinha(row)
      rel.por_classificacao[alvo.classificacao_url] += 1
      if (alvo.classificacao_url === 'desconhecido') rel.desconhecidos += 1

      if (!precisaAtualizar(row, alvo)) { rel.mantidos += 1; continue }

      rel.alterados += 1
      if (row.tem_site && !alvo.tem_site) rel.perderam_tem_site += 1
      if (!row.tem_site && alvo.tem_site) rel.ganharam_tem_site += 1
      if (row.site && !alvo.site) rel.links_preservados += 1
      paraGravar.push({ id: row.id, ...alvo })
    }

    if (args.aplicar && paraGravar.length) {
      // Um UPDATE por lote, via unnest: link preservado e cache corrigido atomicamente.
      await pool.query(
        `UPDATE prospectador.prospects p
            SET tem_site          = d.tem_site,
                site              = d.site,
                link_original     = d.link_original,
                classificacao_url = d.classificacao_url,
                updated_at        = NOW()
           FROM unnest($1::uuid[], $2::boolean[], $3::text[], $4::text[], $5::text[])
                AS d(id, tem_site, site, link_original, classificacao_url)
          WHERE p.id = d.id`,
        [
          paraGravar.map((r) => r.id),
          paraGravar.map((r) => r.tem_site),
          paraGravar.map((r) => r.site),
          paraGravar.map((r) => r.link_original),
          paraGravar.map((r) => r.classificacao_url),
        ]
      )
    }

    process.stdout.write(
      `${args.aplicar ? '[aplicando]' : '[simulacao]'} lote ${lote} · ` +
      `${rel.analisados} analisados · ${rel.alterados} a corrigir\n`
    )
    if (rows.length < args.lote) break
  }
}

function imprimirRelatorio(args, rel) {
  const n = (v) => String(v).padStart(7)
  console.log('')
  console.log('─────────────────────────────────────────────────')
  console.log(` RECLASSIFICACAO DE SITE ${args.aplicar ? '(APLICADA)' : '(SIMULACAO — nada gravado)'}`)
  console.log('─────────────────────────────────────────────────')
  console.log(` Analisados .......................... ${n(rel.analisados)}`)
  console.log(` ${args.aplicar ? 'Alterados' : 'Seriam alterados'} ${'.'.repeat(args.aplicar ? 26 : 19)} ${n(rel.alterados)}`)
  console.log(`   deixaram de contar como "tem site" ${n(rel.perderam_tem_site)}`)
  console.log(`   passaram a contar como "tem site"  ${n(rel.ganharam_tem_site)}`)
  console.log(`   links movidos p/ link_original ....${n(rel.links_preservados)}`)
  console.log(` Mantidos (ja corretos) .............. ${n(rel.mantidos)}`)
  console.log(` Desconhecidos (revisar) ............. ${n(rel.desconhecidos)}`)
  console.log('')
  console.log(' Por classificacao:')
  for (const [chave, valor] of Object.entries(rel.por_classificacao)) {
    console.log(`   ${chave.padEnd(22, '.')} ${n(valor)}`)
  }
  console.log('─────────────────────────────────────────────────')
  if (!args.aplicar) {
    console.log(' Nenhum registro foi gravado.')
    console.log(' Para aplicar:  npm run reclassificar:sites -- --aplicar')
  } else {
    console.log(' Nenhum link foi apagado: todo valor removido de `site` esta em `link_original`.')
    console.log(' Prioridade, filas e filtros sao recalculados na proxima leitura (nao ha cache persistido).')
  }
  console.log('')
}

async function main() {
  const args = lerArgs(process.argv)
  const rel = novoRelatorio()
  console.log(
    `Reclassificando sites · modo=${args.aplicar ? 'APLICAR' : 'SIMULACAO'} · lote=${args.lote}` +
    `${args.empresa ? ` · empresa=${args.empresa}` : ' · todas as empresas'}` +
    `${args.tudo ? ' · reprocessando TUDO' : ' · so nao classificados'}`
  )
  await processar(args, rel)
  imprimirRelatorio(args, rel)
}

if (require.main === module) {
  main()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error('\nFalhou:', err && err.message ? err.message : err)
      await pool.end().catch(() => {})
      process.exit(1)
    })
}

module.exports = { lerArgs, alvoDaLinha, precisaAtualizar, novoRelatorio }
