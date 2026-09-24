'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

// ─── A CERCA DA GERACAO LEGADA ───────────────────────────────────────────────────────────
//
// Este sistema roda DUAS geracoes de produto no mesmo processo:
//
//   geracao 1 (legada, single-tenant "PJ")   geracao 2 (atual, SaaS multiempresa)
//   -------------------------------------   ------------------------------------
//   UI:    backend/public/*.html             frontend/ (Next.js)
//   API:   /dashboard/* e /api/operador/*    /api/empresas/:empresaId/*
//   Auth:  src/dashboardAuth.js              src/auth.js + middleware/tenant.js
//          (cookie httpOnly + CSRF)          (JWT + papel do vinculo + capacidades)
//
// A geracao 1 esta viva e em uso — por isso NAO se apaga hoje. O que este arquivo impede e'
// que ela CRESCA. Sem uma cerca, "vamos aposentar o dashboard legado" e' intencao; com ela,
// e' regra executavel: toda rota legada nova quebra o build, e o numero so' anda para baixo.
//
// ⚠️ Estes numeros sao um CATRACA (ratchet), nao uma meta. Quando uma tela legada for
// aposentada de verdade, o teste falha pedindo para BAIXAR o numero — e esse diff vira o
// registro do progresso. Nunca suba nenhum deles para fazer o teste passar.

const RAIZ = path.join(__dirname, '..')
const { rotas: ROTAS } = require('./fixtures/rotas-publicas.json')

// Estado congelado em 2026-09-21. Só desce.
const TETO_ROTAS_LEGADAS = 84        // 83 em /dashboard/* + 1 em /api/operador/*
const TETO_PAGINAS_LEGADAS = 0      // HTMLs na raiz de backend/public/

// Os unicos modulos autorizados a falar com a autenticacao legada. A lista e' fechada: um
// arquivo novo aqui significa codigo NOVO nascendo na geracao que esta sendo aposentada.
const CONSUMIDORES_DASHBOARD_AUTH = [
  'index.js',
  'src/agent.js',
  'src/ai-routes.js',
  'src/prospecting.js',
  'src/whatsapp-routes.js',
]

function arquivosDoBackend() {
  const saida = []
  ;(function andar(dir) {
    for (const nome of fs.readdirSync(dir, { withFileTypes: true })) {
      if (nome.name === 'node_modules' || nome.name === '.git') continue
      const completo = path.join(dir, nome.name)
      if (nome.isDirectory()) andar(completo)
      else if (nome.name.endsWith('.js')) saida.push(path.relative(RAIZ, completo).replace(/\\/g, '/'))
    }
  })(path.join(RAIZ, 'src'))
  saida.push('index.js')
  return saida
}

const FONTES = arquivosDoBackend().map((rel) => ({
  rel,
  conteudo: fs.readFileSync(path.join(RAIZ, rel), 'utf8'),
}))

// ─── A superficie legada nao cresce ──────────────────────────────────────────────────────

test('a geracao legada tem exatamente as rotas congeladas — e so pode encolher', () => {
  const legadas = ROTAS.filter((r) => / \/dashboard\//.test(r) || / \/api\/operador\//.test(r))

  assert.ok(
    legadas.length <= TETO_ROTAS_LEGADAS,
    `A geracao legada CRESCEU: ${legadas.length} rotas contra o teto de ${TETO_ROTAS_LEGADAS}.\n` +
    'Rota nova pertence a geracao atual: `/api/empresas/:empresaId/*`, em src/routes/, com\n' +
    'requireAuth + requireEmpresaAccess + requireCapacidade.'
  )

  assert.equal(
    legadas.length, TETO_ROTAS_LEGADAS,
    `A geracao legada encolheu para ${legadas.length} rotas — otima noticia.\n` +
    'Baixe TETO_ROTAS_LEGADAS neste arquivo para travar o novo patamar.'
  )
})

test('o dashboard estatico legado nao volta a existir', () => {
  // A pasta foi REMOVIDA em 2026-09-24. Ausencia conta como zero — e o teste continua valendo
  // como catraca: se `public/` reaparecer com uma pagina, TETO_PAGINAS_LEGADAS = 0 quebra.
  const dir = path.join(RAIZ, 'public')
  const paginas = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.html'))
    : []
  assert.ok(
    paginas.length <= TETO_PAGINAS_LEGADAS,
    `Pagina nova em backend/public/: ${paginas.length} contra o teto de ${TETO_PAGINAS_LEGADAS}.\n` +
    'Tela nova vive em frontend/ (Next.js). O AGENTS.md ja diz que o dashboard legado "nao e\n' +
    'referencia para tela nova" — aqui isso deixa de ser recomendacao.'
  )
  assert.equal(
    paginas.length, TETO_PAGINAS_LEGADAS,
    `Sobraram ${paginas.length} paginas legadas. Baixe TETO_PAGINAS_LEGADAS para travar o patamar.`
  )
})

// ─── A autenticacao legada nao ganha consumidor novo ─────────────────────────────────────

// Um arquivo pode EXPLICAR o legado em comentario sem USAR o legado — e explicar por que algo
// nao depende mais dele e' justamente o que se quer que esteja escrito. Casar no texto cru
// transformava cada explicacao num falso positivo (aconteceu em 2026-09-24, com
// db/agenda-usuario-ancora.js). Inspeciona-se o CODIGO.
const semComentarios = (txt) => txt
  .split(String.fromCharCode(10))
  .filter((l) => !l.trim().startsWith('//'))
  .join(String.fromCharCode(10))

test('so os modulos ja existentes falam com a autenticacao legada', () => {
  const usam = FONTES.filter((f) => /require\(.*dashboardAuth.*\)|dashboardAuth\./.test(semComentarios(f.conteudo)))
    .map((f) => f.rel)
    .sort()

  const novos = usam.filter((f) => !CONSUMIDORES_DASHBOARD_AUTH.includes(f))
  assert.deepEqual(
    novos, [],
    `Modulo novo usando a autenticacao legada (cookie + CSRF): ${novos.join(', ')}.\n` +
    'Codigo novo autentica por JWT: requireAuth + requireEmpresaAccess + requireCapacidade\n' +
    '(src/middleware/tenant.js). Sao dois sistemas de auth convivendo; um deles esta saindo.'
  )

  const sumiram = CONSUMIDORES_DASHBOARD_AUTH.filter((f) => !usam.includes(f))
  assert.deepEqual(
    sumiram, [],
    `Estes modulos pararam de usar a auth legada: ${sumiram.join(', ')}.\n` +
    'Remova-os de CONSUMIDORES_DASHBOARD_AUTH para travar o avanco.'
  )
})

test('a camada de rotas ATUAL nunca usa a autenticacao legada', () => {
  // Nao e' redundante com o teste acima: aquele congela uma lista, este protege um LUGAR.
  // `src/routes/` e' onde nasce toda rota nova — se a auth legada entrar ali, a fronteira
  // entre as duas geracoes deixa de existir mesmo com a lista intacta.
  const infratores = FONTES
    .filter((f) => f.rel.startsWith('src/routes/'))
    .filter((f) => /dashboardAuth/.test(f.conteudo))
    .map((f) => f.rel)
  assert.deepEqual(infratores, [], 'rota em src/routes/ autentica por capacidade, nunca por cookie do dashboard')
})

// ─── O que a cerca NAO faz ───────────────────────────────────────────────────────────────

test('a geracao atual continua sendo a maioria esmagadora da API', () => {
  // Ancora de sanidade: se um dia este teste falhar porque o multiempresa encolheu, o problema
  // nao e' a cerca — e' alguem apagando o produto.
  const multiempresa = ROTAS.filter((r) => / \/api\/empresas\/:empresaId\//.test(r))
  assert.ok(multiempresa.length > 250, `so ${multiempresa.length} rotas multiempresa`)
  assert.ok(multiempresa.length > TETO_ROTAS_LEGADAS * 2, 'a geracao atual tem de dominar a superficie')
})
