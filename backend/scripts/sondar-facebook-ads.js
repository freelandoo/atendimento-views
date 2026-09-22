'use strict'
// SONDA dos datasets `fb_ads` (Biblioteca de Anúncios) e `fb_paginas` (Facebook Pages) —
// descobrir o CONTRATO REAL antes de escrever qualquer adaptador, classificador ou pipeline
// em cima deles.
//
// POR QUE ISTO EXISTE. Mesma lição já registrada para o Instagram (Decisão 1 de 2026-09-16,
// `docs/ai-decision-log.md`): não se escreve leitor de campo que ninguém viu. Um dataset de
// anúncios/páginas comprado às cegas pode não trazer "status ativo" nem "data de início" com
// os nomes que a documentação de marketing sugere — só o schema real, visto num registro pago,
// decide isso.
//
// As perguntas que esta sonda responde, e que decidem o desenho do funil descrito em
// docs/ai-task-start-log.md (2026-09-21 (3)):
//   fb_ads:     existe campo de status ativo/inativo? existe page_id? existe landing_page/url
//               de destino? existe data de início legível?
//   fb_paginas: existe website/site próprio direto no registro da página? telefone? categoria?
//
// Uso:
//   npm run facebook:sonda -- --dataset=fb_ads     --url=<url do anúncio ou da Ad Library>     --confirmar
//   npm run facebook:sonda -- --dataset=fb_ads     --input='{"keyword":"energia solar goiania"}' --confirmar
//   npm run facebook:sonda -- --dataset=fb_paginas --url=<url da página do Facebook>            --confirmar
//
// GASTA CRÉDITO REAL. Por isso `--confirmar` é obrigatório — não existe "simular" útil aqui.
//
// O registro CRU é gravado em arquivo (mesma lição do `fonte_bruta` do Maps: permite descobrir
// um campo novo depois, sem recoletar). O TERMINAL recebe só o MAPA DE CAMPOS (nomes, tipos, e
// valores que parecem data/URL/telefone) — nunca o conteúdo completo do anúncio/página.

const fs = require('fs')
const path = require('path')
const brightdata = require('../src/services/brightdata-client')

const POLL_MS = 10000
const DATASETS_VALIDOS = new Set(['fb_ads', 'fb_paginas'])

function lerArgs(argv) {
  const args = {
    dataset: null, url: null, input: null, discoverBy: null,
    confirmar: false, saida: null, timeoutMin: 10,
  }
  for (const bruto of argv.slice(2)) {
    const arg = String(bruto)
    if (arg.startsWith('--dataset=')) args.dataset = arg.slice(10).trim()
    else if (arg.startsWith('--url=')) args.url = arg.slice(6).trim()
    else if (arg.startsWith('--input=')) args.input = arg.slice(8)
    else if (arg.startsWith('--discover-by=')) args.discoverBy = arg.slice(14).trim()
    else if (arg === '--confirmar') args.confirmar = true
    else if (arg.startsWith('--saida=')) args.saida = arg.slice(8).trim() || null
    else if (arg.startsWith('--timeout-min=')) {
      const n = Number.parseInt(arg.slice(14), 10)
      args.timeoutMin = Number.isFinite(n) ? Math.max(1, Math.min(60, n)) : 10
    } else throw new Error(`argumento desconhecido: ${arg}`)
  }
  return args
}

// Um valor "parece data" quando uma data pode ser lida dele — ISO, epoch em segundos ou em
// milissegundos, as formas mais comuns em APIs de rede social. Reconhecer não é confiar: é
// evidência para uma pessoa ler, não regra de negócio.
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

function pareceUrl(valor) {
  if (typeof valor !== 'string') return false
  return /^https?:\/\//i.test(valor.trim())
}

function pareceBooleanoDeStatus(chave) {
  return /^(is_)?active$|status|ativ/i.test(chave)
}

function tipoDe(valor) {
  if (valor === null) return 'null'
  if (Array.isArray(valor)) return 'array[' + valor.length + ']'
  return typeof valor
}

/** Mapa de campos: o que existe, de que tipo, e pistas (data/URL/status). Sem conteúdo cru. */
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
      url: pareceUrl(valor),
      possivelStatus: pareceBooleanoDeStatus(chave),
    })
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

function montarInput(args) {
  if (args.input) {
    let parsed
    try { parsed = JSON.parse(args.input) } catch {
      throw new Error('--input precisa ser JSON válido (ex.: \'{"url":"..."}\')')
    }
    return Array.isArray(parsed) ? parsed : [parsed]
  }
  if (args.url) return [{ url: args.url }]
  throw new Error('informe --url=<url> ou --input=\'{"...json..."}\'')
}

async function main() {
  const args = lerArgs(process.argv)
  if (!args.dataset || !DATASETS_VALIDOS.has(args.dataset)) {
    throw new Error('informe --dataset=fb_ads ou --dataset=fb_paginas')
  }
  if (!brightdata.brightDataConfigurado()) throw new Error('BRIGHTDATA_API_TOKEN ausente.')
  const dsId = brightdata.datasetId(args.dataset)
  if (!dsId) {
    const env = args.dataset === 'fb_ads' ? 'BRIGHTDATA_DATASET_FB_ADS' : 'BRIGHTDATA_DATASET_FB_PAGINAS'
    throw new Error(`${env} ausente — confirme o dataset_id no painel Bright Data (Marketplace > Facebook) e preencha no .env.`)
  }

  const input = montarInput(args)

  if (!args.confirmar) {
    console.log('\n  Esta sonda GASTA CREDITO REAL da Bright Data (' + input.length + ' registro(s)).')
    console.log('  Rode de novo com --confirmar para disparar.\n')
    process.exit(2)
  }

  console.log('\n=== SONDA ' + args.dataset + ' (' + dsId + ') ===')
  console.log('   input: ' + JSON.stringify(input) + (args.discoverBy ? ' (discover_by=' + args.discoverBy + ')' : ''))

  const { snapshotId } = await brightdata.trigger(args.dataset, input,
    args.discoverBy ? { discoverBy: args.discoverBy } : {})
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
    console.log('\n  Snapshot pronto e VAZIO. Isso ja e resposta: o dataset nao devolveu nada para')
    console.log('  este input. Anote o snapshot_id antes que expire.\n')
    process.exit(1)
  }

  const saida = args.saida || path.join(process.cwd(),
    'sonda-' + args.dataset + '-' + new Date().toISOString().slice(0, 10) + '.json')
  fs.writeFileSync(saida, JSON.stringify({
    sondado_em: new Date().toISOString(),
    dataset: args.dataset,
    dataset_id: dsId,
    snapshot_id: snapshotId,
    input,
    registros,
  }, null, 2))

  const campos = mapearCampos(registros[0])
  console.log('\n--- MAPA DE CAMPOS (' + campos.length + ') ---')
  for (const c of campos) {
    const marcas = []
    if (c.data) marcas.push('DATA: ' + c.data)
    if (c.url) marcas.push('URL')
    if (c.possivelStatus) marcas.push('possivel status/ativo')
    console.log('  ' + (c.preenchido ? '*' : ' ') + ' ' + c.campo.padEnd(42) +
      String(c.tipo).padEnd(12) + (marcas.length ? '  <== ' + marcas.join(', ') : ''))
  }

  console.log('\n--- VEREDITO ---')
  console.log('  registros no snapshot: ' + registros.length)
  console.log('  campos com data reconhecivel : ' + campos.filter((c) => c.data).length)
  console.log('  campos que parecem URL        : ' + campos.filter((c) => c.url).length)
  console.log('  campos que parecem status/ativo: ' + campos.filter((c) => c.possivelStatus).length)
  console.log('\n  registro cru salvo em: ' + saida)
  console.log('  Cole o MAPA DE CAMPOS acima na conversa para decidirmos o parser real.\n')
}

main().catch((e) => { console.error('\nERRO: ' + e.message + '\n'); process.exit(1) })
