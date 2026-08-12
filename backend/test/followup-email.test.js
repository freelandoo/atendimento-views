'use strict'

// CANAL DE E-MAIL DO FOLLOW-UP (migration 067) — regras puras + guardas de regressao.
//
// O que estes testes protegem, em uma frase: o e-mail so e canal quando uma PESSOA confirmou
// PARA ONDE enviar, e o item so sai da fila quando o e-mail realmente saiu.
//
// Nenhum e-mail e enviado aqui: o transporte so e alcancado com as tres variaveis de
// ambiente do provider configuradas, e os testes que chegam perto param antes disso.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const S = require('../src/services/followup-email')

const RAIZ = path.join(__dirname, '..')
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8')
const semComentarios = (fonte) => fonte.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const MIGRATION = ler('sql/migrations/067_follow_up_canal_email.sql')

const ITEM = () => ({
  id: 'fu-1',
  canal: 'email',
  status: 'aguardando',
  telefone_digitos: '5511999990001',
  proxima_acao: 'Retomar a proposta',
  observacao: null,
})

// ─── Conteudo revisado pelo operador ──────────────────────────────────────────

test('assunto e corpo sao obrigatorios — e-mail sem assunto chega como suspeito', () => {
  assert.throws(() => S.validarConteudoEmail({ assunto: '  ', corpo: 'oi' }), /assunto e obrigatorio/)
  assert.throws(() => S.validarConteudoEmail({ assunto: 'Oi', corpo: '   ' }), /corpo do e-mail e obrigatorio/)
  assert.deepEqual(S.validarConteudoEmail({ assunto: ' Oi ', corpo: ' texto ' }), { assunto: 'Oi', corpo: 'texto' })
})

test('assunto com quebra de linha e recusado — seria injecao de cabecalho', () => {
  assert.throws(() => S.validarConteudoEmail({ assunto: 'Oi\nBcc: x@y.com', corpo: 'texto' }), /quebra de linha/)
  assert.throws(() => S.validarConteudoEmail({ assunto: 'Oi\r\nX', corpo: 'texto' }), /quebra de linha/)
})

test('limites de tamanho protegem o provider e o registro', () => {
  assert.throws(() => S.validarConteudoEmail({ assunto: 'x'.repeat(S.LIMITE_ASSUNTO + 1), corpo: 'ok' }), /limite/)
  assert.throws(() => S.validarConteudoEmail({ assunto: 'ok', corpo: 'x'.repeat(S.LIMITE_CORPO + 1) }), /limite/)
})

// ─── Rascunho: deterministico, sem IA ─────────────────────────────────────────

test('o rascunho sai do que ja foi combinado no item, sem chamar IA', () => {
  const r = S.montarRascunhoEmail({ proxima_acao: 'Retomar a proposta', observacao: 'Pediu numeros' }, { nome: 'Ana' })
  assert.equal(r.assunto, 'Retomar a proposta')
  assert.match(r.corpo, /^Ola, Ana!/)
  assert.match(r.corpo, /Retomar a proposta/)
  assert.match(r.corpo, /Pediu numeros/)
})

test('rascunho de item sem verbo ainda abre o compositor com algo utilizavel', () => {
  const r = S.montarRascunhoEmail({}, {})
  assert.equal(r.assunto, 'Retomando nosso contato')
  assert.match(r.corpo, /Ola!/)
})

test('o executor NAO chama IA para redigir', () => {
  // Um canal novo nao estreia com custo de LLM por clique. Se um dia isso mudar, sera uma
  // decisao de produto — nao um efeito colateral.
  const fonte = semComentarios(ler('src/services/followup-email.js'))
  for (const re of [/generateAIResponse/, /anthropic/i, /openai/i]) {
    assert.doesNotMatch(fonte, re, 'o rascunho e deterministico')
  }
})

// ─── HTML do corpo ────────────────────────────────────────────────────────────

test('o corpo e escapado antes de virar HTML', () => {
  assert.equal(S.corpoParaHtml('a < b & c > d'), 'a &lt; b &amp; c &gt; d')
  assert.equal(S.corpoParaHtml('linha1\nlinha2'), 'linha1<br>linha2')
  assert.equal(S.corpoParaHtml('linha1\r\nlinha2'), 'linha1<br>linha2')
  assert.equal(S.corpoParaHtml('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;')
})

// ─── Quando o item pode ser executado ─────────────────────────────────────────

test('so item de e-mail EM ABERTO pode ser enviado', () => {
  assert.equal(S.bloqueioDoItem(ITEM()), null)
  assert.equal(S.bloqueioDoItem({ ...ITEM(), canal: 'whatsapp' }), S.MOTIVO_BLOQUEIO.CANAL_ERRADO)
  assert.equal(S.bloqueioDoItem({ ...ITEM(), status: 'concluido' }), S.MOTIVO_BLOQUEIO.ITEM_FECHADO)
  assert.equal(S.bloqueioDoItem(null), S.MOTIVO_BLOQUEIO.CANAL_ERRADO)
})

test('todo motivo de bloqueio tem uma mensagem que diz O QUE FAZER', () => {
  for (const motivo of Object.values(S.MOTIVO_BLOQUEIO)) {
    assert.ok(S.MENSAGEM_BLOQUEIO[motivo], `motivo ${motivo} sem mensagem`)
  }
})

// ─── O destino nunca e adivinhado ─────────────────────────────────────────────

/**
 * Pool falso: responde por trecho de SQL. Registra tudo o que foi perguntado, para os testes
 * afirmarem tambem o que NAO foi executado (nenhum INSERT, por exemplo).
 */
function poolFalso({ item = ITEM(), disponibilidade = [], candidatos = [] } = {}) {
  const consultas = []
  return {
    consultas,
    async query(sql, params) {
      consultas.push({ sql: String(sql), params })
      const q = String(sql)
      if (q.includes('FROM app.follow_ups')) return { rows: item ? [item] : [] }
      if (q.includes('app.contato_canal_disponibilidade')) return { rows: disponibilidade }
      if (q.includes('FROM prospectador.prospects')) return { rows: candidatos }
      return { rows: [] }
    },
  }
}

test('sem e-mail CONFIRMADO o envio e recusado — e nada e gravado', async () => {
  const pool = poolFalso({ disponibilidade: [] })
  await assert.rejects(
    () => S.enviarEmailFollowUp({ pool, empresaId: 'e1', followUpId: 'fu-1', assunto: 'Oi', corpo: 'texto' }),
    (err) => err.code === S.MOTIVO_BLOQUEIO.SEM_EMAIL_CONFIRMADO && err.statusCode === 409
  )
  assert.equal(pool.consultas.filter((c) => /INSERT INTO/.test(c.sql)).length, 0,
    'recusa nao pode deixar registro de envio: nada saiu')
})

test('e-mail marcado como INDISPONIVEL nao vira destino, mesmo com endereco na linha', async () => {
  const pool = poolFalso({
    disponibilidade: [{ canal: 'email', disponivel: false, endereco: 'x@y.com' }],
  })
  await assert.rejects(
    () => S.enviarEmailFollowUp({ pool, empresaId: 'e1', followUpId: 'fu-1', assunto: 'Oi', corpo: 'texto' }),
    (err) => err.code === S.MOTIVO_BLOQUEIO.SEM_EMAIL_CONFIRMADO
  )
})

test('canal nao configurado no ambiente RECUSA antes de compor, sem gravar envio', async () => {
  // Sem EMAIL_PROVIDER_API_URL/_KEY/EMAIL_FROM o canal esta desligado. Diferente de
  // prospectador.email_outreach, aqui NAO se grava uma linha 'desativado': registrar um
  // "envio" que nunca saiu faria a linha do tempo do contato mentir.
  const antes = { ...process.env }
  delete process.env.EMAIL_PROVIDER_API_URL
  delete process.env.EMAIL_PROVIDER_API_KEY
  delete process.env.EMAIL_FROM
  try {
    const pool = poolFalso({ disponibilidade: [{ canal: 'email', disponivel: true, endereco: 'x@y.com' }] })
    await assert.rejects(
      () => S.enviarEmailFollowUp({ pool, empresaId: 'e1', followUpId: 'fu-1', assunto: 'Oi', corpo: 'texto' }),
      (err) => err.code === S.MOTIVO_BLOQUEIO.CANAL_DESATIVADO && err.statusCode === 409
    )
    assert.equal(pool.consultas.filter((c) => /INSERT INTO/.test(c.sql)).length, 0)
  } finally {
    process.env = antes
  }
})

test('prepararEnvioEmail nao envia e nao grava — e diz por que nao da para enviar', async () => {
  const pool = poolFalso({ disponibilidade: [], candidatos: [{ endereco: 'do-cadastro@x.com', nome: 'Loja' }] })
  const out = await S.prepararEnvioEmail({ pool, empresaId: 'e1', followUpId: 'fu-1' })
  assert.equal(out.destinatario, null)
  assert.equal(out.bloqueio, S.MOTIVO_BLOQUEIO.SEM_EMAIL_CONFIRMADO)
  assert.ok(out.rascunho.assunto)
  assert.equal(pool.consultas.filter((c) => /INSERT INTO|UPDATE /.test(c.sql)).length, 0)
})

// ─── Guardas de regressao ─────────────────────────────────────────────────────

test('o destinatario NUNCA vem do corpo da requisicao', () => {
  // Aceitar um endereco na rota permitiria enviar para um destino que ninguem verificou — o
  // oposto da regra deste modulo (e do modulo de disponibilidade).
  const rotas = semComentarios(ler('src/routes/api-follow-ups.js'))
  const trecho = rotas.slice(rotas.indexOf("router.post('/itens/:id/email/enviar'"))
    .slice(0, rotas.indexOf('// GET /contatos/:telefone/emails') > 0 ? 2000 : 2000)
  assert.doesNotMatch(trecho, /destinatario|b\.email|para:/,
    'a rota de envio nao pode aceitar destinatario')
})

test('nenhum worker envia e-mail de follow-up sozinho', () => {
  // O canal nasceu de uma decisao humana e continua executado por uma pessoa. Automatizar o
  // disparo seria outra decisao de produto — e este teste e o lugar onde ela apareceria.
  const dir = path.join(RAIZ, 'src')
  const chamadores = []
  const varrer = (pasta) => {
    for (const entry of fs.readdirSync(pasta, { withFileTypes: true })) {
      const full = path.join(pasta, entry.name)
      if (entry.isDirectory()) { varrer(full); continue }
      if (!entry.name.endsWith('.js')) continue
      if (full.endsWith(path.join('services', 'followup-email.js'))) continue
      if (/enviarEmailFollowUp/.test(fs.readFileSync(full, 'utf8'))) chamadores.push(path.relative(RAIZ, full))
    }
  }
  varrer(dir)
  assert.deepEqual(chamadores, [path.join('src', 'routes', 'api-follow-ups.js')],
    `so a rota (acao humana) pode enviar; achei ${chamadores.join(', ')}`)
})

test('o ledger de envio e proprio, e nao o de prospeccao', () => {
  // `prospectador.email_outreach` e chaveado por prospect_id (que o follow-up nao tem) e mede
  // a PRIMEIRA abordagem. Misturar os dois faria abordagem e acompanhamento medirem o mesmo.
  const db = semComentarios(ler('src/db/follow-up-emails.js'))
  assert.match(db, /INSERT INTO\s+app\.follow_up_emails/)
  assert.doesNotMatch(db, /email_outreach/)
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS app\.follow_up_emails/)
})

test('o transporte e REUSADO de email-outreach, nao duplicado', () => {
  const fonte = semComentarios(ler('src/services/followup-email.js'))
  assert.match(fonte, /require\('\.\/email-outreach'\)/)
  assert.doesNotMatch(fonte, /\bfetch\(/, 'duplicar o cliente HTTP criaria dois provedores possiveis')
})

test('a tabela de envio guarda o corpo, mas nenhuma LEITURA o devolve', () => {
  // A fila e a linha do tempo precisam saber que houve e-mail e qual o assunto; reproduzir o
  // texto em toda leitura seria espalhar conteudo de mensagem por telas que nao o pedem.
  const db = ler('src/db/follow-up-emails.js')
  const cols = db.slice(db.indexOf('const COLS')).match(/`([^`]*)`/)[1]
  assert.match(cols, /assunto/)
  assert.ok(!/\bcorpo\b/.test(cols),
    'o corpo e gravado (foi o que o cliente recebeu), mas nao volta nas leituras')
})
