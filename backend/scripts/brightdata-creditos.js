'use strict'
// Creditos da Bright Data — informar o saldo e ler o consumo.
//
// Por que um script e nao uma rota: os creditos sao de UMA conta, compartilhada por todos os
// tenants. Nao existe "saldo da empresa X", entao a operacao nao pertence a nenhuma rota de
// `/api/empresas/:id`. Enquanto nao houver tela de plataforma para isso, o lugar honesto e' aqui.
//
// Uso:
//   npm run brightdata:creditos                          # relatorio (padrao, nao grava nada)
//   npm run brightdata:creditos -- --informar=4760       # grava o saldo informado hoje
//   npm run brightdata:creditos -- --informar=4760 --obs="lido no painel"
//   npm run brightdata:creditos -- --dias=7              # janela do relatorio (padrao 30)
//
// O saldo informado e' o MARCO ZERO das contagens: o "estimado" e' esse numero menos o consumo
// registrado depois dele. Informar de novo reancora a contagem — e' append-only, nada e' perdido.

const { pool } = require('../src/db')
const consumoDb = require('../src/db/brightdata-consumo')
const ORCAMENTO = require('../src/services/brightdata-orcamento')

function lerArgs(argv) {
  const args = { informar: null, obs: null, dias: 30 }
  for (const bruto of argv.slice(2)) {
    const arg = String(bruto)
    if (arg.startsWith('--informar=')) {
      const n = Number.parseInt(arg.slice(11), 10)
      if (!Number.isFinite(n) || n < 0) throw new Error(`saldo invalido: ${arg.slice(11)}`)
      args.informar = n
    } else if (arg.startsWith('--obs=')) args.obs = arg.slice(6).trim() || null
    else if (arg.startsWith('--dias=')) {
      const n = Number.parseInt(arg.slice(7), 10)
      args.dias = Number.isFinite(n) ? Math.max(1, Math.min(365, n)) : 30
    } else throw new Error(`argumento desconhecido: ${arg}`)
  }
  return args
}

function linha(rotulo, valor, largura = 38) {
  return ` ${String(rotulo).padEnd(largura, '.')} ${String(valor).padStart(9)}`
}

async function main() {
  const args = lerArgs(process.argv)

  if (args.informar != null) {
    const r = await consumoDb.informarSaldo({ saldo: args.informar, observacao: args.obs })
    console.log(`\nSaldo informado: ${r.saldo_informado} creditos em ${new Date(r.informado_em).toLocaleString('pt-BR')}`)
    console.log('Este valor e o marco zero: o saldo estimado passa a ser ele menos o consumo daqui pra frente.\n')
  }

  const saldo = await consumoDb.saldoAtual()
  const hojeMaps = await consumoDb.consumidoHoje([ORCAMENTO.SCRAPER.MAPS_DESCOBERTA])
  const hojeTudo = await consumoDb.consumidoHoje()
  const porScraper = await consumoDb.consumoPorScraper(args.dias)
  const teto = ORCAMENTO.tetoDiarioAquisicao()
  const reserva = ORCAMENTO.reservaCreditos()

  console.log('')
  console.log('─────────────────────────────────────────────────')
  console.log(' CREDITOS BRIGHT DATA')
  console.log('─────────────────────────────────────────────────')
  if (saldo.saldo == null) {
    console.log(' Saldo ............................. NAO INFORMADO')
    console.log('')
    console.log(' Sem saldo informado a trava de RESERVA nao roda (so o teto diario).')
    console.log(' Informe com:  npm run brightdata:creditos -- --informar=<creditos>')
  } else {
    console.log(linha('Saldo informado', saldo.saldo_informado))
    console.log(`   em ${new Date(saldo.informado_em).toLocaleString('pt-BR')}`)
    console.log(linha('Consumido desde entao', saldo.consumido_desde))
    console.log(linha('Saldo ESTIMADO', saldo.saldo))
    console.log('')
    console.log(' ATENCAO: estimativa a partir do valor informado acima — a API da Bright Data')
    console.log(' nao expoe saldo. Confira no painel e reinforme quando divergir.')
  }
  console.log('')
  console.log(' Hoje:')
  console.log(linha('Aquisicao (Google Maps)', `${hojeMaps}/${teto || '∞'}`))
  console.log(linha('Total da conta', hojeTudo))
  console.log('')
  console.log(' Travas ativas:')
  console.log(linha('Teto diario da Aquisicao', teto || 'desligado'))
  console.log(linha('Reserva intocavel', reserva || 'desligada'))

  const veredito = ORCAMENTO.avaliarOrcamento({
    consumidoHoje: hojeMaps, custoEstimado: 200, saldoEstimado: saldo.saldo,
  })
  console.log('')
  console.log(` Uma coleta de 200 leads agora: ${veredito.permitido ? 'LIBERADA' : 'BLOQUEADA'}`)
  if (!veredito.permitido) console.log(`   motivo: ${veredito.mensagem}`)

  if (porScraper.length) {
    console.log('')
    console.log(` Consumo por scraper (${args.dias} dias):`)
    for (const r of porScraper) {
      console.log(linha(`  ${r.scraper_type}  (${r.requisicoes} req)`, r.creditos))
    }
  } else {
    console.log('')
    console.log(` Nenhum consumo registrado nos ultimos ${args.dias} dias.`)
    console.log(' (O ledger comeca a contar a partir da migration 081 — consumo anterior nao e retroagido.)')
  }
  console.log('─────────────────────────────────────────────────')
  console.log('')
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

module.exports = { lerArgs }
