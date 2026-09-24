'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const path = require('node:path')

// ─── CONTRATO DA SUPERFICIE HTTP ─────────────────────────────────────────────────────────
//
// Congela as 442 rotas MONTADAS do processo: metodo + caminho completo, ja com o prefixo de
// montagem e com os parametros (`/api/empresas/:empresaId/...`).
//
// Por que agora: 82 dos endpoints nao vivem em `src/routes/` — estao dentro de `agent.js`
// (37), `prospecting.js` (29) e `agenda.js` (16), misturados com regra de negocio e workers.
// Tirar rota de la e' o movimento mais arriscado da reorganizacao, e o que torna esse
// movimento SEGURO e' poder provar que a superficie publica nao mudou: mesmos caminhos,
// mesmos metodos, so' em outro arquivo. Sem isto, mover rota e' fe.
//
// ⚠️ Por que a captura e' em TEMPO DE EXECUCAO e nao por leitura do fonte: o caminho real de
// uma rota e' `prefixo de montagem + caminho relativo`, e o prefixo so' existe na chamada
// `app.use(...)`. Ler o fonte diria "o arquivo declara `/leads/:id`" — que e' exatamente o que
// MUDA quando a rota troca de arquivo. O que nao pode mudar e' o caminho final, e so' o app
// montado conhece esse valor.
//
// O Express 5 nao guarda o path de montagem no layer (`router/lib/layer.js` so' compila
// matchers), entao a unica forma de recompor o caminho completo e' registrar os `use` no
// momento em que acontecem. A instrumentacao abaixo vive SO neste teste — nada em producao
// sabe que ela existe.

const CONGELADO = require('./fixtures/rotas-publicas.json')
const CAMINHO_FIXTURE = path.join('test', 'fixtures', 'rotas-publicas.json')

function coletarRotasMontadas() {
  const express = require('express')
  const montagens = new Map()

  function registrar(pai, prefixo, filho) {
    // So' interessa quem tem `stack`: router ou sub-app. Middleware comum nao monta rota.
    if (!filho || typeof filho !== 'function' || !filho.stack) return
    if (!montagens.has(pai)) montagens.set(pai, [])
    montagens.get(pai).push({ prefixo: typeof prefixo === 'string' ? prefixo : '/', filho })
  }

  function instrumentar(alvo) {
    const original = alvo.use
    alvo.use = function capturandoMontagem(...args) {
      const [primeiro, ...resto] = args
      const prefixo = typeof primeiro === 'string' ? primeiro : '/'
      const candidatos = typeof primeiro === 'string' ? resto : args
      for (const c of candidatos) registrar(this, prefixo, c)
      return original.apply(this, args)
    }
    return () => { alvo.use = original }
  }

  const desfazer = [instrumentar(express.application), instrumentar(Object.getPrototypeOf(express.Router()))]
  let app
  try {
    // Depois da instrumentacao, de proposito: e' o require do index que monta tudo.
    ;({ app } = require('../index'))
  } finally {
    for (const d of desfazer) d()
  }

  const rotas = []
  const juntar = (a, b) => {
    const s = `${a}${b}`.replace(/\/{2,}/g, '/')
    return s.length > 1 && s.endsWith('/') ? s.slice(0, -1) : s
  }

  function andar(obj, prefixo) {
    const stack = obj === app ? (app.router && app.router.stack) || [] : obj.stack || []
    for (const layer of stack) {
      if (!layer.route) continue
      const caminhos = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path]
      for (const p of caminhos) {
        for (const metodo of Object.keys(layer.route.methods || {})) {
          rotas.push(`${metodo.toUpperCase()} ${juntar(prefixo, p)}`)
        }
      }
    }
    for (const { prefixo: pre, filho } of montagens.get(obj) || []) andar(filho, juntar(prefixo, pre))
  }
  andar(app, '')

  return [...new Set(rotas)].sort()
}

const ATUAIS = coletarRotasMontadas()

test('a superficie HTTP e exatamente a congelada', () => {
  const congeladas = new Set(CONGELADO.rotas)
  const atuais = new Set(ATUAIS)

  const sumiram = CONGELADO.rotas.filter((r) => !atuais.has(r))
  const surgiram = ATUAIS.filter((r) => !congeladas.has(r))

  assert.deepEqual(
    { sumiram, surgiram },
    { sumiram: [], surgiram: [] },
    [
      'A superficie HTTP mudou.',
      sumiram.length ? `SUMIRAM (${sumiram.length}): ${sumiram.join(', ')}` : '',
      surgiram.length ? `SURGIRAM (${surgiram.length}): ${surgiram.join(', ')}` : '',
      '',
      'Se a mudanca foi de PROPOSITO (rota nova, rota aposentada), atualize',
      `${CAMINHO_FIXTURE} NO MESMO commit — o diff daquele arquivo e' o registro do que a`,
      'mudanca fez com a API. Se voce estava apenas MOVENDO rota de arquivo, entao algo',
      'quebrou: o caminho montado tinha de permanecer identico.',
    ].filter(Boolean).join('\n')
  )
})

test('o inventario nao esta vazio nem colapsou', () => {
  // Rede contra o modo de falha mais traicoeiro deste teste: a instrumentacao parar de
  // funcionar (mudanca de versao do Express, por exemplo) e a coleta devolver pouca coisa —
  // o que faria o teste "passar" comparando vazio com vazio se o fixture tambem fosse
  // regenerado no escuro.
  assert.ok(ATUAIS.length > 400, `coletou so' ${ATUAIS.length} rotas — a instrumentacao provavelmente quebrou`)
  assert.equal(ATUAIS.length, CONGELADO.rotas.length)
})

test('toda rota tem metodo e caminho absoluto', () => {
  for (const r of ATUAIS) {
    assert.match(r, /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \/[^\s]*$/, `rota mal formada: ${r}`)
  }
})

test('as duas geracoes de API continuam identificaveis', () => {
  // Nao e' enfeite: e' a medida do progresso da reorganizacao. O legado single-tenant
  // (`/dashboard/*`) e' o que deve encolher; o multiempresa (`/api/empresas/:empresaId/*`) e'
  // para onde as telas migram. Se um dia `/dashboard` chegar a zero, a geracao 1 acabou.
  const legado = ATUAIS.filter((r) => / \/dashboard\//.test(r))
  const multiempresa = ATUAIS.filter((r) => / \/api\/empresas\/:empresaId\//.test(r))
  assert.ok(legado.length > 0, 'o dashboard legado ainda existe — quando zerar, atualize este teste')
  assert.ok(multiempresa.length > legado.length, 'o produto atual e o multiempresa')
})
