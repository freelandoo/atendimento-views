'use strict'
// Abordagem MANUAL pelo wa.me (CRM em equipe, Etapa 5).
//
// A regra central deste módulo é negativa: **abrir um wa.me não prova envio**. Boa parte dos
// testes aqui existe para travar essa distinção, porque ela é fácil de perder — basta alguém
// somar os dois num contador de "mensagens enviadas".

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const A = require('../src/services/abordagem-manual')
const { CANAL, CONFIRMACAO, STATUS_MANUAL, MOTIVOS } = A

const RAIZ = path.join(__dirname, '..')
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8')
const semComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

// ─── Telefone ────────────────────────────────────────────────────────────────────────────

test('normaliza para E.164 sem +, assumindo Brasil quando falta o DDI', () => {
  assert.equal(A.normalizarParaWaMe('5511999998888'), '5511999998888')
  assert.equal(A.normalizarParaWaMe('11999998888'), '5511999998888')
  assert.equal(A.normalizarParaWaMe('(11) 99999-8888'), '5511999998888')
  assert.equal(A.normalizarParaWaMe('+55 11 99999-8888'), '5511999998888')
  // Fixo de 10 dígitos também abre conversa (o WhatsApp resolve se existe ou não).
  assert.equal(A.normalizarParaWaMe('1133334444'), '551133334444')
})

test('NAO inventa digito: numero curto ou impossivel e recusado', () => {
  // Consertar o 9º dígito produziria abordagem para OUTRA pessoa.
  for (const v of ['', null, undefined, '123', '99998888', '1199999', 'abc', '0']) {
    assert.equal(A.normalizarParaWaMe(v), null, `${v} deveria ser recusado`)
  }
})

test('aceita outro DDI sem reescrever', () => {
  assert.equal(A.normalizarParaWaMe('+1 415 555 2671'), '14155552671')
  assert.equal(A.normalizarParaWaMe('351912345678'), '351912345678')
})

test('avaliarTelefone distingue SEM telefone de telefone INVALIDO', () => {
  // As duas recusas pedem ações diferentes: capturar o número vs corrigir o cadastro.
  assert.equal(A.avaliarTelefone('').motivo, MOTIVOS.SEM_TELEFONE)
  assert.equal(A.avaliarTelefone(null).motivo, MOTIVOS.SEM_TELEFONE)
  assert.equal(A.avaliarTelefone('123').motivo, MOTIVOS.TELEFONE_INVALIDO)
  assert.equal(A.avaliarTelefone('11999998888').permitido, true)
})

// ─── URL ─────────────────────────────────────────────────────────────────────────────────

test('montarUrlWaMe escapa a mensagem — & e # nao cortam o texto', () => {
  const url = A.montarUrlWaMe('11999998888', 'Oi & tudo bem? #padaria 100%')
  assert.ok(url.startsWith('https://wa.me/5511999998888?text='))
  assert.ok(!url.includes('&tudo'), 'o & precisa estar escapado')
  assert.ok(url.includes('%26'))
  assert.ok(url.includes('%23'))
  // O texto volta intacto ao decodificar — é isso que o vendedor vai ver no WhatsApp.
  assert.equal(decodeURIComponent(url.split('?text=')[1]), 'Oi & tudo bem? #padaria 100%')
})

test('montarUrlWaMe preserva quebra de linha', () => {
  const url = A.montarUrlWaMe('11999998888', 'Linha 1\nLinha 2')
  assert.equal(decodeURIComponent(url.split('?text=')[1]), 'Linha 1\nLinha 2')
})

test('mensagem vazia abre a conversa em branco (caso legitimo)', () => {
  assert.equal(A.montarUrlWaMe('11999998888', ''), 'https://wa.me/5511999998888')
  assert.equal(A.montarUrlWaMe('11999998888'), 'https://wa.me/5511999998888')
  assert.equal(A.montarUrlWaMe('11999998888', '   '), 'https://wa.me/5511999998888')
})

test('telefone ruim devolve null — a tela nao monta link quebrado', () => {
  assert.equal(A.montarUrlWaMe('123', 'Oi'), null)
  assert.equal(A.montarUrlWaMe(null, 'Oi'), null)
})

// ─── Rascunho determinístico ─────────────────────────────────────────────────────────────

test('a saudacao da instancia tem precedencia: e o texto que o operador ja aprovou', () => {
  const r = A.montarRascunho({ nome: 'Padaria X' }, { saudacao: 'Olá! Somos a PJ.', remetente: 'Victor' })
  assert.equal(r, 'Olá! Somos a PJ.')
})

test('sem saudacao, o rascunho e minimo e NAO afirma nada sobre o negocio', () => {
  const r = A.montarRascunho({ nome: 'Padaria do Zé' }, { remetente: 'Victor' })
  assert.equal(r, 'Olá, Padaria! Aqui é Victor.')
  // Nenhuma oferta, preço, prazo ou elogio inventado — o vendedor é quem sabe o que dizer.
  for (const proibido of ['site', 'desconto', 'R$', 'promo', 'vi que', 'notei']) {
    assert.ok(!r.toLowerCase().includes(proibido.toLowerCase()), `rascunho nao pode afirmar: ${proibido}`)
  }
})

test('rascunho aguenta lead sem nome e sem remetente', () => {
  assert.equal(A.montarRascunho({}, {}), 'Olá!')
  assert.equal(A.montarRascunho(null, {}), 'Olá!')
})

test('primeiroNome pega so o primeiro token', () => {
  assert.equal(A.primeiroNome('  José  da Silva '), 'José')
  assert.equal(A.primeiroNome(''), '')
  assert.equal(A.primeiroNome(null), '')
})

test('sanearMensagem normaliza CRLF e respeita o limite', () => {
  assert.equal(A.sanearMensagem('a\r\nb'), 'a\nb')
  assert.equal(A.sanearMensagem('  x  '), 'x')
  assert.equal(A.sanearMensagem('y'.repeat(2000)).length, A.LIMITE_MENSAGEM)
  assert.equal(A.sanearMensagem(null), '')
})

// ─── Força de prova: o coração da etapa ──────────────────────────────────────────────────

test('provider = COMPROVADO; operador = declarado; abertura = nem isso', () => {
  const provider = A.forcaDaProva({ canal: CANAL.EVOLUTION, confirmado_por: CONFIRMACAO.PROVIDER })
  assert.equal(provider.comprovado, true)

  const operador = A.forcaDaProva({ canal: CANAL.MANUAL_WA_ME, confirmado_por: CONFIRMACAO.OPERADOR })
  assert.equal(operador.comprovado, false, 'declaracao do vendedor NAO e prova')
  assert.match(operador.detalhe, /não tem confirmação/)

  const aberto = A.forcaDaProva({ canal: CANAL.MANUAL_WA_ME, status: STATUS_MANUAL.ABERTO })
  assert.equal(aberto.comprovado, false)
  assert.match(aberto.rotulo, /aberto/i)
  // Os tres rotulos precisam ser DIFERENTES: se dois colapsarem, a tela pode somá-los.
  assert.equal(new Set([provider.rotulo, operador.rotulo, aberto.rotulo]).size, 3)
})

test('disparo manual NUNCA conta para o teto anti-ban da Evolution', () => {
  // Nao ha numero do produto a proteger: quem envia e' o aparelho do vendedor.
  assert.equal(A.contaParaTetoEvolution({ canal: CANAL.MANUAL_WA_ME }), false)
  assert.equal(A.contaParaTetoEvolution({ canal: CANAL.EVOLUTION }), true)
  // Sem canal informado (linha antiga) conta como Evolution — era o unico canal que existia.
  assert.equal(A.contaParaTetoEvolution({}), true)
})

test('os enums batem com as CHECKs da migration 073', () => {
  const mig = fonte(path.join('sql', 'migrations', '073_abordagem_manual.sql'))
  const canal = mig.match(/lead_disparos_canal_chk[\s\S]*?IN \(([^)]*)\)/)
  assert.deepEqual(
    canal[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).sort(),
    Object.values(CANAL).sort()
  )
  const conf = mig.match(/lead_disparos_confirmado_por_chk[\s\S]*?IN \(([^)]*)\)/)
  assert.deepEqual(
    conf[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).sort(),
    Object.values(CONFIRMACAO).sort()
  )
})

// ─── Pureza e guardas ────────────────────────────────────────────────────────────────────

test('o service e PURO e NAO envia nada', () => {
  const src = fonte(path.join('src', 'services', 'abordagem-manual.js'))
  for (const proibido of ['require(', 'pool', 'fetch(', 'axios', 'enviarMensagem', 'generateAIResponse']) {
    assert.ok(!src.includes(proibido), `abordagem-manual.js (service) nao pode conter '${proibido}'`)
  }
})

test('GUARDA: o rascunho e DETERMINISTICO — nenhuma IA no caminho da abordagem manual', () => {
  // Um canal novo nao estreia com custo de LLM por clique. Se isso mudar, e' decisao de produto, e
  // e' este teste que a torna visivel.
  for (const rel of [path.join('src', 'services', 'abordagem-manual.js'), path.join('src', 'db', 'abordagem-manual.js')]) {
    const src = semComentarios(fonte(rel))
    for (const proibido of ['generateAIResponse', 'saudacao-analise', 'ai-provider']) {
      assert.ok(!src.includes(proibido), `${rel} nao pode chamar IA: ${proibido}`)
    }
  }
})

test('GUARDA: a camada de dados NAO envia mensagem por canal algum', () => {
  // A palavra "evolution" aparece legitimamente como NOME DE COLUNA (`evolution_instance`, que esta
  // rota grava como NULL) e como valor do enum de canal. O que a guarda proibe e' ENVIAR.
  const src = semComentarios(fonte(path.join('src', 'db', 'abordagem-manual.js')))
  for (const proibido of ['enviarMensagem', 'axios', 'fetch(', 'resolverInstanciaEnvio', 'evolutionEnviar']) {
    assert.ok(!src.includes(proibido), `db/abordagem-manual.js nao pode conter '${proibido}'`)
  }
})

test('GUARDA: abrir o WhatsApp grava status proprio, e NUNCA confirmado_por', () => {
  const src = fonte(path.join('src', 'db', 'abordagem-manual.js'))
  const bloco = src.slice(src.indexOf('async function registrarAbertura'), src.indexOf('async function marcarEnviadoManualmente'))
  assert.ok(bloco.includes('STATUS_MANUAL.ABERTO'), 'a abertura precisa de status proprio')
  // `semComentarios` tira TAMBEM o bloco JSDoc: ele cita `confirmado_por = NULL` justamente ao
  // documentar que nao grava a coluna, e sem isso a guarda acusaria a propria documentacao.
  assert.ok(!/confirmado_por/.test(semComentarios(bloco)),
    'a abertura NAO pode gravar confirmado_por — clique nao e envio')
})

test('GUARDA: so a DECLARACAO humana grava confirmado_por = operador', () => {
  const src = fonte(path.join('src', 'db', 'abordagem-manual.js'))
  const bloco = src.slice(src.indexOf('async function marcarEnviadoManualmente'), src.indexOf('async function historicoDoLead'))
  assert.ok(bloco.includes('CONFIRMACAO.OPERADOR'))
  assert.ok(bloco.includes('abordagem_manual_declarada'), 'a auditoria precisa dizer que o fato e DECLARADO')
})

test('GUARDA: nenhum job/worker grava confirmado_por = operador', () => {
  // Mesma disciplina da migration 066: um caminho automatico nao pode fabricar veredito humano.
  const dir = path.join(RAIZ, 'src')
  const ofensores = []
  const varrer = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) varrer(p)
      else if (e.name.endsWith('.js')) {
        // O unico lugar legitimo e' a camada de dados desta feature, chamada pela rota.
        if (p.endsWith(path.join('db', 'abordagem-manual.js'))) continue
        if (p.endsWith(path.join('services', 'abordagem-manual.js'))) continue
        const src = semComentarios(fs.readFileSync(p, 'utf8'))
        if (/confirmado_por\s*=\s*'operador'/.test(src) || /'operador'[^)]*confirmado_por/.test(src)) {
          ofensores.push(path.relative(dir, p))
        }
      }
    }
  }
  varrer(dir)
  assert.deepEqual(ofensores, [], 'somente a rota de declaracao humana pode gravar confirmado_por=operador')
})

test('GUARDA: o historico NAO devolve o texto da mensagem', () => {
  // O historico responde "quando e com que forca de prova", nao "o que foi dito" — o conteudo do
  // que foi (ou nao) para o cliente nao precisa circular na API.
  const src = fonte(path.join('src', 'db', 'abordagem-manual.js'))
  const bloco = src.slice(src.indexOf('async function historicoDoLead'))
  assert.ok(!/SELECT[\s\S]*?d\.mensagem/.test(bloco), 'o historico nao pode selecionar d.mensagem')
})

test('GUARDA: a porta de qualificacao vale para o canal manual tambem', () => {
  // Abordar a mao e' abordar.
  const src = fonte(path.join('src', 'db', 'abordagem-manual.js'))
  assert.ok(src.includes('avaliarAbordagem'), 'a abordagem manual precisa passar pela porta')
  assert.equal((src.match(/avaliarAbordagem\(/g) || []).length, 3,
    'preparar, abrir e declarar — os tres precisam conferir a porta')
})

test('GUARDA: a migration 073 nao muta dado e amarra instancia ao canal', () => {
  const mig = fonte(path.join('sql', 'migrations', '073_abordagem_manual.sql'))
  const sql = mig.replace(/^--.*$/gm, ' ')
  assert.ok(!/\bUPDATE\s+prospectador/i.test(sql), 'nao pode mutar dado')
  // O DROP NOT NULL so' alarga, e a CHECK garante que o canal Evolution CONTINUA exigindo instancia.
  assert.ok(/ALTER COLUMN evolution_instance DROP NOT NULL/.test(sql))
  assert.ok(/canal = 'evolution'\s+AND evolution_instance IS NOT NULL/.test(sql),
    'a CHECK precisa manter a instancia obrigatoria no canal Evolution')
  assert.ok(/canal = 'manual_wa_me' AND evolution_instance IS NULL/.test(sql))
})
