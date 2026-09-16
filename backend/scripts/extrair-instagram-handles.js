'use strict'
// ETAPA 1 — extrai o @ do Instagram que JA' ESTA' no banco.
//
// Contexto: quando o dono do negocio coloca o Instagram no Perfil da Empresa (Google Meu
// Negocio), esse link chega na coleta e e' preservado em `prospectador.prospects.link_original`
// desde a migration 056 — classificado como `rede_social` e depois ignorado por todo mundo. O
// resultado e' que o criterio `instagram_ativo` do ICP nunca ligou para lead vindo do Maps, que
// e' a origem da base inteira.
//
// Este script le' o link que ja' foi pago e o transforma em `instagram_handle` confirmado. Ele:
//   - NAO faz nenhuma chamada externa (nada de Bright Data, nada de Google CSE, nada pago);
//   - e' IDEMPOTENTE: rodar dez vezes da' o mesmo resultado da primeira;
//   - roda em LOTES por keyset, para nao segurar o banco;
//   - NUNCA sobrescreve handle existente (captacao social ou confirmacao humana vencem);
//   - so' grava com `--aplicar`. Sem a flag, e' simulacao.
//
// O QUE ELE NAO FAZ, DE PROPOSITO: nao marca `nao_encontrado` para quem nao tem link. Este
// script nao PROCURA nada — ele apenas le' o que a ficha do Maps trouxe. Gravar "nao encontrado"
// aqui afirmaria que houve uma busca que nunca aconteceu, e a tela passaria a dizer ao operador
// que o lead nao tem Instagram quando ninguem olhou. Quem procura e' a rota
// `POST /leads/:id/instagram/procurar`.
//
// Uso:
//   npm run instagram:handles                      # simulacao (padrao), nao grava nada
//   npm run instagram:handles -- --aplicar         # grava
//   npm run instagram:handles -- --lote=200        # tamanho do lote (padrao 500)
//   npm run instagram:handles -- --empresa=<uuid>  # restringe a uma empresa

const { pool } = require('../src/db')
const IG = require('../src/services/instagram-perfil')

function lerArgs(argv) {
  const args = { aplicar: false, lote: 500, empresa: null }
  for (const bruto of argv.slice(2)) {
    const arg = String(bruto)
    if (arg === '--aplicar') args.aplicar = true
    else if (arg.startsWith('--lote=')) {
      // `parseInt` de "0" e' 0 (falsy): sem o teste explicito, `--lote=0` cairia no default.
      const n = Number.parseInt(arg.slice(7), 10)
      args.lote = Number.isFinite(n) ? Math.max(1, Math.min(5000, n)) : 500
    } else if (arg.startsWith('--empresa=')) args.empresa = arg.slice(10).trim() || null
    else if (arg === '--dry-run' || arg === '--simular') args.aplicar = false
    else throw new Error(`argumento desconhecido: ${arg}`)
  }
  return args
}

function novoRelatorio() {
  return {
    analisados: 0,
    com_instagram: 0,       // link de Instagram encontrado no cadastro
    sem_link_instagram: 0,  // nao ha' link de Instagram — NAO e' "nao tem Instagram"
    por_campo: { link_original: 0, site: 0, link_bio: 0 },
  }
}

async function processar(args, rel) {
  const filtros = ['instagram_handle IS NULL']
  const params = []
  if (args.empresa) { params.push(args.empresa); filtros.push(`empresa_id = $${params.length}`) }

  // Paginacao por id (keyset): estavel mesmo com o UPDATE mudando as linhas sob o cursor.
  let ultimoId = '00000000-0000-0000-0000-000000000000'
  let lote = 0

  for (;;) {
    const paramsLote = [...params, ultimoId, args.lote]
    const { rows } = await pool.query(
      `SELECT id, link_original, site, link_bio
         FROM prospectador.prospects
        WHERE ${filtros.join(' AND ')} AND id > $${paramsLote.length - 1}
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
      const achado = IG.handleDeLinkConhecido(row)
      if (!achado) { rel.sem_link_instagram += 1; continue }
      rel.com_instagram += 1
      for (const campo of IG.CAMPOS_LINK) {
        if (IG.normalizarHandle(row[campo]) === achado.handle) { rel.por_campo[campo] += 1; break }
      }
      paraGravar.push({ id: row.id, handle: achado.handle, link: achado.link })
    }

    if (args.aplicar && paraGravar.length) {
      // Um UPDATE por lote, via unnest. O `instagram_handle IS NULL` no WHERE repete a guarda do
      // SELECT de proposito: entre a leitura e a escrita alguem pode ter confirmado o perfil pela
      // tela, e a decisao humana nao pode ser sobreposta por manutencao em lote.
      await pool.query(
        `UPDATE prospectador.prospects p
            SET instagram_handle     = d.handle,
                instagram_origem     = $4,
                instagram_confianca  = $5,
                instagram_evidencia  = jsonb_build_object('link', d.link, 'fonte', 'cadastro_maps'),
                instagram_verificado_em = NOW(),
                updated_at           = NOW()
           FROM unnest($1::uuid[], $2::text[], $3::text[]) AS d(id, handle, link)
          WHERE p.id = d.id AND p.instagram_handle IS NULL`,
        [
          paraGravar.map((r) => r.id),
          paraGravar.map((r) => r.handle),
          paraGravar.map((r) => r.link),
          IG.ORIGEM.GOOGLE_MEU_NEGOCIO,
          IG.CONFIANCA.CONFIRMADO,
        ]
      )
    }

    process.stdout.write(
      `${args.aplicar ? '[aplicando]' : '[simulacao]'} lote ${lote} · ` +
      `${rel.analisados} analisados · ${rel.com_instagram} com Instagram\n`
    )
    if (rows.length < args.lote) break
  }
}

function imprimirRelatorio(args, rel) {
  const n = (v) => String(v).padStart(7)
  const pct = rel.analisados ? ((rel.com_instagram / rel.analisados) * 100).toFixed(1) : '0.0'
  console.log('')
  console.log('─────────────────────────────────────────────────')
  console.log(` INSTAGRAM NO CADASTRO ${args.aplicar ? '(APLICADO)' : '(SIMULACAO — nada gravado)'}`)
  console.log('─────────────────────────────────────────────────')
  console.log(` Analisados (sem handle ainda) ....... ${n(rel.analisados)}`)
  console.log(` ${args.aplicar ? 'Confirmados' : 'Seriam confirmados'} ${'.'.repeat(args.aplicar ? 24 : 17)} ${n(rel.com_instagram)}  (${pct}%)`)
  for (const [campo, valor] of Object.entries(rel.por_campo)) {
    if (valor) console.log(`   via ${campo.padEnd(30, '.')} ${n(valor)}`)
  }
  console.log(` Sem link de Instagram no cadastro ... ${n(rel.sem_link_instagram)}`)
  console.log('─────────────────────────────────────────────────')
  console.log(' "Sem link" NAO significa "nao tem Instagram": este script nao procura nada,')
  console.log(' so le o link que a ficha do Maps ja trouxe. Esses leads ficam sem veredito')
  console.log(' (NULL) e sao o publico do botao "Procurar Instagram" na tela do lead.')
  if (!args.aplicar) {
    console.log('')
    console.log(' Nenhum registro foi gravado.')
    console.log(' Para aplicar:  npm run instagram:handles -- --aplicar')
  }
  console.log('')
}

async function main() {
  const args = lerArgs(process.argv)
  const rel = novoRelatorio()
  console.log(
    `Extraindo Instagram do cadastro · modo=${args.aplicar ? 'APLICAR' : 'SIMULACAO'} · lote=${args.lote}` +
    `${args.empresa ? ` · empresa=${args.empresa}` : ' · todas as empresas'}`
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
      try { await pool.end() } catch { /* nada a fazer */ }
      process.exit(1)
    })
}

module.exports = { lerArgs, novoRelatorio }
