'use strict'
// Dispara uma busca REAL na Biblioteca de Anuncios do Meta (via Apify) por nicho+cidade, e grava
// os anunciantes sem site proprio como leads novos. Ver docs/ai-task-start-log.md (2026-09-21
// (3)) para o desenho completo e `services/meta-ads-worker.js` para a orquestracao.
//
// GASTA CREDITO REAL do Apify (pay-per-resultado) — por isso `--confirmar` e' obrigatorio,
// mesma disciplina de `scripts/sondar-instagram-perfil.js` e `scripts/sondar-facebook-ads.js`.
//
// SEM WORKER DE FUNDO AINDA: esta e' a unica porta de entrada deste canal nesta primeira
// rodada — rotina agendada e tela na Aquisicao ficam para um proximo incremento, explicitamente
// fora de escopo por enquanto.
//
// Uso:
//   npm run meta-ads:buscar -- --nicho="Energia Solar" --cidade="Goiania, GO" --confirmar
//   npm run meta-ads:buscar -- --nicho="..." --cidade="..." --limite=50 --empresa=<uuid> --confirmar

const { buscarAnunciantes, LIMITE_PADRAO, LIMITE_MAX } = require('../src/services/meta-ads-worker')

const EMPRESA_PJ = '00000000-0000-0000-0000-000000000001'

function lerArgs(argv) {
  const args = { nicho: null, cidade: null, limite: LIMITE_PADRAO, empresa: EMPRESA_PJ, confirmar: false }
  for (const bruto of argv.slice(2)) {
    const arg = String(bruto)
    if (arg.startsWith('--nicho=')) args.nicho = arg.slice(8).trim()
    else if (arg.startsWith('--cidade=')) args.cidade = arg.slice(9).trim()
    else if (arg.startsWith('--limite=')) {
      const n = Number.parseInt(arg.slice(9), 10)
      args.limite = Number.isFinite(n) ? Math.max(1, Math.min(LIMITE_MAX, n)) : LIMITE_PADRAO
    } else if (arg.startsWith('--empresa=')) args.empresa = arg.slice(10).trim()
    else if (arg === '--confirmar') args.confirmar = true
    else throw new Error(`argumento desconhecido: ${arg}`)
  }
  return args
}

async function main() {
  const args = lerArgs(process.argv)
  if (!args.nicho) throw new Error('informe --nicho="..."')

  if (!args.confirmar) {
    console.log('\n  Esta busca GASTA CREDITO REAL do Apify (ate ' + args.limite + ' resultado(s)).')
    console.log('  Rode de novo com --confirmar para disparar.\n')
    process.exit(2)
  }

  console.log('\n=== Biblioteca de Anuncios do Meta — "' + args.nicho + '"'
    + (args.cidade ? ' em ' + args.cidade : '') + ' ===\n')

  const resultado = await buscarAnunciantes({
    nicho: args.nicho, cidade: args.cidade, empresaId: args.empresa, limite: args.limite,
  })

  if (!resultado.ok) {
    console.log('  Nao foi possivel buscar: ' + resultado.motivo + (resultado.mensagem ? ' — ' + resultado.mensagem : ''))
    process.exit(1)
  }

  console.log('  anuncios devolvidos pela busca : ' + resultado.registros)
  console.log('  leads NOVOS/atualizados salvos : ' + resultado.salvos.length)
  console.log('  descartados:')
  for (const [motivo, n] of Object.entries(resultado.descartados)) {
    if (n > 0) console.log('    - ' + motivo + ': ' + n)
  }
  console.log('')
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('\nERRO: ' + err.message + '\n'); process.exit(1) })
