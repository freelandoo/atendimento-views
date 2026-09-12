'use strict'
// Ownership da CONVERSA (CRM em equipe, Etapa 7). Regra PURA + guardas.
//
// A regra que mais importa aqui é NEGATIVA e oposta à do lead: **responder nunca é bloqueado**.
// Ver o teste "responder NUNCA é bloqueado" em test/autorizacao-rotas.test.js também.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const R = require('../src/services/conversa-responsavel')
const { MOTIVOS, ESCOPO, ACOES } = R

const RAIZ = path.join(__dirname, '..')
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8')
const semComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

const conv = (responsavel) => ({ numero: '5511999998888@s.whatsapp.net', responsavel_id: responsavel || null })

// ─── Assumir / transferir ────────────────────────────────────────────────────────────────

test('assumir: so a conversa SEM responsavel', () => {
  assert.equal(R.avaliarAssumir(conv(null), 'u1').permitido, true)
  assert.equal(R.avaliarAssumir(conv('u1'), 'u1').motivo, MOTIVOS.MESMO_RESPONSAVEL)
  assert.equal(R.avaliarAssumir(conv('u2'), 'u1').motivo, MOTIVOS.JA_TEM_RESPONSAVEL)
  assert.equal(R.avaliarAssumir(null, 'u1').motivo, MOTIVOS.SEM_CONVERSA)
  assert.equal(R.avaliarAssumir(conv(null), null).motivo, MOTIVOS.SEM_PERMISSAO)
})

test('transferir exige capacidade; devolver a PROPRIA conversa nao', () => {
  assert.equal(R.avaliarTransferir(conv('u2'), { usuarioId: 'u1', podeTransferir: true, destinoId: 'u3' }).permitido, true)
  assert.equal(R.avaliarTransferir(conv('u2'), { usuarioId: 'u1', podeTransferir: false, destinoId: 'u3' }).motivo, MOTIVOS.SEM_PERMISSAO)
  // Devolver a própria para a fila é do atendente, sempre.
  assert.equal(R.avaliarTransferir(conv('u1'), { usuarioId: 'u1', podeTransferir: false, destinoId: null }).permitido, true)
  // Devolver a de OUTRO exige.
  assert.equal(R.avaliarTransferir(conv('u2'), { usuarioId: 'u1', podeTransferir: false, destinoId: null }).motivo, MOTIVOS.SEM_PERMISSAO)
  // Mesmo destino: nada a fazer.
  assert.equal(R.avaliarTransferir(conv('u2'), { usuarioId: 'u1', podeTransferir: true, destinoId: 'u2' }).motivo, MOTIVOS.MESMO_RESPONSAVEL)
})

test('o vocabulario de ACOES e o MESMO do lead, de proposito', () => {
  // Duas listas divergentes fariam o painel do admin ter duas colunas que significam a mesma coisa.
  const doLead = require('../src/services/lead-responsavel')
  assert.deepEqual([...R.ACOES_VALORES].sort(), [...doLead.ACOES_VALORES].sort())
  assert.equal(ACOES.ASSUMIU, doLead.ACOES.ASSUMIU)
  // E bate com a CHECK da migration 074.
  const mig = fonte(path.join('sql', 'migrations', '074_conversa_responsavel.sql'))
  const m = mig.match(/conversa_resp_hist_acao_chk[\s\S]*?IN \(([^)]*)\)/)
  assert.ok(m)
  assert.deepEqual(
    m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).sort(),
    [...R.ACOES_VALORES].sort()
  )
})

// ─── Responder: a regra oposta ───────────────────────────────────────────────────────────

test('RESPONDER e sempre permitido; o que muda e o AVISO', () => {
  assert.deepEqual(R.avaliarResponder(conv('u1'), 'u1'), { permitido: true, avisar: false, motivo: MOTIVOS.OK })
  assert.deepEqual(R.avaliarResponder(conv(null), 'u1'), { permitido: true, avisar: false, motivo: MOTIVOS.OK })
  const alheia = R.avaliarResponder(conv('u2'), 'u1')
  assert.equal(alheia.permitido, true)
  assert.equal(alheia.avisar, true)
  // Nem sem conversa e nem sem usuário isso vira bloqueio: a checagem de existência é da camada de
  // dados; aqui a resposta é sobre ownership, e ownership nunca bloqueia resposta.
  assert.equal(R.avaliarResponder(null, 'u1').permitido, true)
  assert.equal(R.avaliarResponder(conv('u2'), null).permitido, true)
})

// ─── Recorte ─────────────────────────────────────────────────────────────────────────────

test('o padrao de quem NAO ve todas deixa o limite para o ALCANCE', () => {
  // O alcance é quem corta por responsável/instância. O escopo padrão não adiciona
  // "não atribuídas", para não abrir conversa solta ou compartilhada ao comercial.
  const r = R.sqlEscopo(undefined, { podeVerTodas: false, alias: 'c' })
  assert.equal(r.sql, '')
  assert.equal(r.usaUsuario, false)
  assert.equal(R.escopoEfetivo(undefined, false), 'proprias')
})

test('pedir TODAS sem poder rebaixa para proprias', () => {
  const r = R.sqlEscopo('todas', { podeVerTodas: false, alias: 'c' })
  assert.equal(r.sql, '')
  assert.equal(R.escopoEfetivo('todas', false), 'proprias')
  // E quem pode, recebe sem recorte.
  assert.equal(R.sqlEscopo('todas', { podeVerTodas: true }).sql, '')
  assert.equal(R.escopoEfetivo('todas', true), ESCOPO.TODAS)
})

test('os escopos explicitos funcionam para quem quer estreitar a propria visao', () => {
  assert.equal(R.sqlEscopo('minhas', { podeVerTodas: true, alias: 'c' }).sql, 'c.responsavel_id = $1')
  const naoAtrib = R.sqlEscopo('nao_atribuidas', { podeVerTodas: true, alias: 'c' })
  assert.equal(naoAtrib.sql, 'c.responsavel_id IS NULL')
  assert.equal(naoAtrib.usaUsuario, false)
  // Aceita o hífen que a URL costuma trazer.
  assert.equal(R.sqlEscopo('nao-atribuidas', { podeVerTodas: true, alias: 'c' }).sql, 'c.responsavel_id IS NULL')
})

test('escopo invalido cai no limite de alcance quando nao ve todas', () => {
  const r = R.sqlEscopo('lixo', { podeVerTodas: false, alias: 'c' })
  assert.equal(r.sql, '')
  assert.equal(R.escopoEfetivo('lixo', false), 'proprias')
  assert.equal(R.sqlEscopo('lixo', { podeVerTodas: true }).sql, '')
})

test('sqlEscopo respeita o placeholder informado', () => {
  assert.equal(R.sqlEscopo('minhas', { alias: 'c', placeholder: '$5' }).sql, 'c.responsavel_id = $5')
})

// ─── Pureza e guardas ────────────────────────────────────────────────────────────────────

test('o service e PURO (o require do vocabulario de acoes e a unica dependencia)', () => {
  const src = fonte(path.join('src', 'services', 'conversa-responsavel.js'))
  for (const proibido of ['pool', 'fetch(', 'axios', 'process.env']) {
    assert.ok(!src.includes(proibido), `conversa-responsavel.js (service) nao pode conter '${proibido}'`)
  }
  // O único require permitido é o do módulo puro irmão, para NÃO duplicar o vocabulário de ações.
  const requires = [...semComentarios(src).matchAll(/require\('([^']+)'\)/g)].map((m) => m[1])
  assert.deepEqual(requires, ['./lead-responsavel'])
})

test('GUARDA: assumir conversa e um CLAIM ATOMICO', () => {
  const src = fonte(path.join('src', 'db', 'conversa-responsavel.js'))
  const bloco = src.slice(src.indexOf('async function assumirConversa'), src.indexOf('async function definirResponsavel'))
  assert.ok(/UPDATE vendas\.conversas[\s\S]*?responsavel_id IS NULL[\s\S]*?RETURNING/.test(bloco),
    'assumirConversa precisa ser UPDATE ... WHERE responsavel_id IS NULL RETURNING')
})

test('GUARDA: a camada NAO toca atualizado_em, modo_ia nem agente_pausado', () => {
  const src = semComentarios(fonte(path.join('src', 'db', 'conversa-responsavel.js')))
  // `atualizado_em` ordena a Central: assumir nao e' mensagem nova (mesmo cuidado da migration 065).
  assert.ok(!/atualizado_em\s*=/.test(src), 'nao pode escrever atualizado_em — reordenaria a Central')
  // Trocar de atendente e ligar a IA sao decisoes independentes (AGENTS.md).
  assert.ok(!/modo_ia\s*=/.test(src), 'transferencia nao pode mexer em modo_ia')
  assert.ok(!/agente_pausado\s*=/.test(src), 'transferencia nao pode mexer em agente_pausado')
})

test('GUARDA: operador_assumiu_em e PRESERVADO (COALESCE), nao sobrescrito', () => {
  // A coluna existia e registrava so' o "quando". Sobrescrever apagaria o instante original de um
  // handoff antigo, feito pelo fluxo que nao tinha "quem".
  const src = fonte(path.join('src', 'db', 'conversa-responsavel.js'))
  assert.ok(/operador_assumiu_em = COALESCE\(operador_assumiu_em, NOW\(\)\)/.test(src))
})

test('GUARDA: toda consulta leva empresa_id — o numero e UNIQUE GLOBAL', () => {
  const src = semComentarios(fonte(path.join('src', 'db', 'conversa-responsavel.js')))
  for (const m of src.matchAll(/(?:FROM|UPDATE)\s+vendas\.conversas([\s\S]{0,400}?)(?:RETURNING|`)/g)) {
    assert.ok(/empresa_id = \$1/.test(m[1]),
      'consulta em vendas.conversas sem empresa_id: o numero e UNIQUE GLOBAL e alcancaria outro tenant')
  }
})

test('GUARDA: a auditoria NAO leva JID nem texto de mensagem', () => {
  const src = fonte(path.join('src', 'db', 'conversa-responsavel.js'))
  const bloco = src.slice(src.indexOf('async function registrarMudanca'), src.indexOf('async function assumirConversa'))
  assert.ok(bloco.includes('telefone_digitos'), 'o padrao do projeto e telefone_digitos, nunca o JID')
  // O proibido e a COLUNA `historico` (o log de mensagens), nao a palavra: o nome da tabela de
  // historico de responsaveis a contem legitimamente.
  assert.ok(!/\bc?\.?historico\b(?!_)/.test(bloco.replace(/conversa_responsavel_historico/g, '')),
    'a auditoria nao pode carregar a coluna historico (o log de mensagens da conversa)')
  // E nao pode gravar o JID como CAMPO do contexto. `String(numero).replace(/\D/g,'')` e' o
  // caminho legitimo (extrai os digitos DO numero), entao a guarda olha a CHAVE, nao a mencao.
  const contexto = bloco.match(/JSON\.stringify\(\{([\s\S]*?)\}\)/)
  assert.ok(contexto, 'nao achei o contexto da auditoria')
  assert.ok(!/(^|[\s,{])numero\s*[:,}]/.test(contexto[1]),
    'o contexto nao pode ter um campo `numero` (JID) — use telefone_digitos')
})

test('GUARDA: o historico da conversa NAO tem FK para vendas.conversas', () => {
  // `vendas.conversas.numero` e UNIQUE GLOBAL: uma FK nao provaria mesma empresa, e o historico de
  // um tenant poderia apontar para a conversa de outro (migrations 062 e 066).
  const mig = fonte(path.join('sql', 'migrations', '074_conversa_responsavel.sql'))
  const sql = mig.replace(/^--.*$/gm, ' ')
  assert.ok(!/REFERENCES\s+vendas\.conversas/i.test(sql), 'nao pode haver FK para vendas.conversas')
  assert.ok(/conversa_numero\s+TEXT NOT NULL/.test(sql))
  assert.ok(!/\bUPDATE\s+vendas\.conversas\b/i.test(sql), 'a migration nao pode mutar dado')
})
