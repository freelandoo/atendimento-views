'use strict'
// SONDA do dataset `ig_perfis` — descobrir o CONTRATO REAL antes de escrever qualquer
// adaptador ou classificador em cima dele.
//
// POR QUE ISTO EXISTE. Em 2026-09-16 o adaptador do Maps chutou quatro grafias de
// `latest_review_date`, 200 coletas foram PAGAS e zero trouxeram data — e o snapshot ja' tinha
// expirado, entao nem conferir era possivel (Decisao 1, `docs/ai-decision-log.md`). A licao virou
// regra: nao se escreve leitor de campo que ninguem viu. Esta sonda paga UM credito para ver.
//
// A pergunta que ela responde, e que decide o desenho de todo o enriquecimento:
//   o perfil ja' traz data de publicacao / contagem de posts?
//     SIM  -> a etapa de posts custa ZERO e sai do plano
//     NAO  -> a etapa de posts precisa de um dataset proprio (~5 creditos por lead)
//
// Uso:
//   npm run instagram:sonda -- --handle=<perfil> --confirmar
//   npm run instagram:sonda -- --handle=<perfil> --confirmar --saida=caminho.json
//
// GASTA CREDITO REAL. Por isso `--confirmar` e' obrigatorio: nao existe "simular" util aqui
// (simular seria justamente nao descobrir nada), entao a protecao e' o gesto explicito.
//
// O registro CRU e' gravado em arquivo — mesma licao do `fonte_bruta` do Maps: guardar o bruto
// permite descobrir o nome de um campo depois, sem recoletar. O TERMINAL recebe so' o MAPA DE
// CAMPOS (nomes, tipos, e valores que parecem data); nunca o conteudo do perfil.

const fs = require('fs')
const path = require('path')
const brightdata = require('../src/services/brightdata-client')

const POLL_MS = 10000

function lerArgs(argv) {
  const args = { handle: null, confirmar: false, saida: null, timeoutMin: 10 }
  for (const bruto of argv.slice(2)) {
    const arg = String(bruto)
    if (arg.startsWith('--handle=')) args.handle = arg.slice(9).replace(/^@/, '').trim()
    else if (arg === '--confirmar') args.confirmar = true
    else if (arg.startsWith('--saida=')) args.saida = arg.slice(8).trim() || null
    else if (arg.startsWith('--timeout-min=')) {
      const n = Number.parseInt(arg.slice(14), 10)
      args.timeoutMin = Number.isFinite(n) ? Math.max(1, Math.min(60, n)) : 10
    } else throw new Error(`argumento desconhecido: ${arg}`)
  }
  return args
}

// Um valor "parece data" quando uma data pode ser lida dele. Aceita ISO, epoch em segundos e
// epoch em milissegundos — as tres formas que APIs de rede social costumam usar. Reconhecer NAO
// e' o mesmo que confiar: o resultado aqui e' evidencia para uma pessoa ler, nao regra de negocio.
function pareceData(valor) {
  if (valor == null) return null
  if (typeof valor === 'number') {
    if (valor > 1e12 && valor < 4e12) return new Date(valor).toISOString()
    if (valor > 1e9 && valor < 4e9) return new Date(valor * 1000).toISOString()
    return null
  }
  if (typeof valor !== 'string') return null
  const s = valor.trim()
  if (!/\d{4}/.test(s)) return null
  const t = Date.parse(s)
  if (!Number.isFinite(t)) return null
  const ano = new Date(t).getUTCFullYear()
  return ano >= 2005 && ano <= 2100 ? new Date(t).toISOString() : null
}

function tipoDe(valor) {
  if (valor === null) return 'null'
  if (Array.isArray(valor)) return 'array[' + valor.length + ']'
  return typeof valor
}

/** Mapa de campos: o que existe, de que tipo, e o que parece data. Sem conteudo do perfil. */
function mapearCampos(registro, prefixo, profundidade) {
  const pre = prefixo || ''
  const nivel = profundidade || 0
  const linhas = []
  for (const [chave, valor] of Object.entries(registro || {})) {
    const caminho = pre ? pre + '.' + chave : chave
    const data = pareceData(valor)
    linhas.push({
      campo: caminho,
      tipo: tipoDe(valor),
      preenchido: valor !== null && valor !== undefined && valor !== '' &&
        !(Array.isArray(valor) && valor.length === 0),
      data,
    })
    // Desce UM nivel dentro de array de objetos: e' ali que posts costumam morar, e o nome do
    // campo de data de cada post e' exatamente o que a sonda veio buscar.
    const objetoDentroDoArray = Array.isArray(valor) && valor.length > 0 && valor[0] &&
      typeof valor[0] === 'object' && !Array.isArray(valor[0])
    if (objetoDentroDoArray && nivel < 1) {
      linhas.push(...mapearCampos(valor[0], caminho + '[0]', nivel + 1))
    } else if (valor && typeof valor === 'object' && !Array.isArray(valor) && nivel < 1) {
      linhas.push(...mapearCampos(valor, caminho, nivel + 1))
    }
  }
  return linhas
}

async function esperarSnapshot(snapshotId, timeoutMin) {
  const limite = Date.now() + timeoutMin * 60000
  let ultimo = ''
  while (Date.now() < limite) {
    const { status } = await brightdata.progress(snapshotId)
    if (status !== ultimo) {
      console.log('   estado: ' + status + ' (' + new Date().toISOString().slice(11, 19) + ')')
      ultimo = status
    }
    if (status === 'ready') return 'ready'
    if (status === 'failed' || status === 'error') return status
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
  return 'timeout'
}

async function main() {
  const args = lerArgs(process.argv)
  if (!args.handle) throw new Error('informe --handle=<perfil> (sem @)')
  if (!/^[a-z0-9._]{1,30}$/i.test(args.handle)) throw new Error('handle invalido: ' + args.handle)
  if (!brightdata.brightDataConfigurado()) throw new Error('BRIGHTDATA_API_TOKEN ausente.')
  if (!brightdata.datasetId('ig_perfis')) throw new Error('BRIGHTDATA_DATASET_IG_PERFIS ausente.')

  if (!args.confirmar) {
    console.log('\n  Esta sonda GASTA CREDITO REAL da Bright Data (1 registro).')
    console.log('  Rode de novo com --confirmar para disparar.\n')
    process.exit(2)
  }

  const url = 'https://www.instagram.com/' + args.handle + '/'
  console.log('\n=== SONDA ig_perfis — ' + url + ' ===\n')

  const { snapshotId } = await brightdata.trigger('ig_perfis', [{ url }])
  console.log('   snapshot: ' + snapshotId)

  const estado = await esperarSnapshot(snapshotId, args.timeoutMin)
  if (estado !== 'ready') {
    console.log('\n  Snapshot nao ficou pronto (' + estado + '). O snapshot_id acima continua')
    console.log('  valido — baixe depois em vez de disparar outra coleta (isso pagaria de novo).\n')
    process.exit(1)
  }

  const registros = await brightdata.snapshot(snapshotId)
  console.log('   registros devolvidos: ' + registros.length)
  if (!registros.length) {
    console.log('\n  Snapshot pronto e VAZIO. Isso ja e resposta: o dataset nao devolveu perfil')
    console.log('  para esta URL. Anote o snapshot_id antes que expire.\n')
    process.exit(1)
  }

  const saida = args.saida || path.join(process.cwd(),
    'sonda-ig-perfil-' + args.handle + '-' + new Date().toISOString().slice(0, 10) + '.json')
  fs.writeFileSync(saida, JSON.stringify({
    sondado_em: new Date().toISOString(),
    dataset: 'ig_perfis',
    snapshot_id: snapshotId,
    url,
    registros,
  }, null, 2))

  const campos = mapearCampos(registros[0])
  console.log('\n--- MAPA DE CAMPOS (' + campos.length + ') ---')
  for (const c of campos) {
    const marca = c.data ? '  <== DATA: ' + c.data : ''
    console.log('  ' + (c.preenchido ? '*' : ' ') + ' ' + c.campo.padEnd(42) +
      String(c.tipo).padEnd(12) + marca)
  }

  const datas = campos.filter((c) => c.data)
  const posts = campos.filter((c) => /post|media|timeline|feed/i.test(c.campo))
  console.log('\n--- VEREDITO ---')
  console.log('  campos com data reconhecivel : ' + datas.length)
  console.log('  campos com cara de post      : ' + posts.length)
  console.log(datas.length
    ? '  => o perfil TRAZ data: a etapa de posts pode custar ZERO.'
    : '  => o perfil NAO traz data: medir atividade exige dataset de posts (custo proprio).')
  console.log('\n  registro cru salvo em: ' + saida)
  console.log('  ATENCAO: o consumo de 1 credito NAO foi registrado no ledger se o banco nao')
  console.log('  estiver alcancavel daqui. Reancore o saldo com: npm run brightdata:creditos\n')
}

main().catch((e) => { console.error('\nERRO: ' + e.message + '\n'); process.exit(1) })
