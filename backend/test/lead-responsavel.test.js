'use strict'
// Ownership do lead (CRM em equipe, Etapa 4). Regra PURA + guardas de regressão.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const R = require('../src/services/lead-responsavel')
const { ACOES, MOTIVOS, ESCOPO } = R

const RAIZ = path.join(__dirname, '..')
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8')
const semComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

const lead = (responsavel) => ({ id: 'p1', responsavel_id: responsavel || null })

// ─── acaoDaMudanca ───────────────────────────────────────────────────────────────────────

test('a acao e DERIVADA do antes/depois, nunca declarada pelo chamador', () => {
  // Um chamador que dissesse "transferiu" com o lead livre produziria historico que contradiz as
  // proprias colunas.
  assert.equal(R.acaoDaMudanca(null, 'u1'), ACOES.ATRIBUIU)
  assert.equal(R.acaoDaMudanca('u1', 'u2'), ACOES.TRANSFERIU)
  assert.equal(R.acaoDaMudanca('u1', null), ACOES.LIBEROU)
  // Nada mudou => nada de historico. E' o que impede clicar duas vezes de inflar a linha do tempo.
  assert.equal(R.acaoDaMudanca('u1', 'u1'), null)
  assert.equal(R.acaoDaMudanca(null, null), null)
})

test('as 4 acoes batem com a CHECK da migration 072', () => {
  const mig = fonte(path.join('sql', 'migrations', '072_lead_responsavel.sql'))
  const m = mig.match(/lead_resp_hist_acao_chk[\s\S]*?IN \(([^)]*)\)/)
  assert.ok(m, 'nao achei a CHECK de acao')
  const doSql = m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean)
  assert.deepEqual([...R.ACOES_VALORES].sort(), doSql.sort())
})

// ─── Assumir ─────────────────────────────────────────────────────────────────────────────

test('assumir: so o que esta LIVRE; o resto recusa com motivos distintos', () => {
  assert.equal(R.avaliarAssumir(lead(null), 'u1').permitido, true)
  // Ja e' seu: nao e' erro de permissao, e' "nada a fazer".
  assert.equal(R.avaliarAssumir(lead('u1'), 'u1').motivo, MOTIVOS.MESMO_DONO)
  // De outra pessoa: e' a corrida perdida.
  assert.equal(R.avaliarAssumir(lead('u2'), 'u1').motivo, MOTIVOS.JA_TEM_DONO)
  assert.equal(R.avaliarAssumir(null, 'u1').motivo, MOTIVOS.SEM_LEAD)
  assert.equal(R.avaliarAssumir(lead(null), null).motivo, MOTIVOS.SEM_PERMISSAO)
})

test('assumir compara id como STRING (uuid vindo do banco vs do token)', () => {
  assert.equal(R.avaliarAssumir({ responsavel_id: 'u1' }, 'u1').motivo, MOTIVOS.MESMO_DONO)
})

// ─── Liberar ─────────────────────────────────────────────────────────────────────────────

test('liberar: so o PROPRIO dono devolve o lead para a fila', () => {
  assert.equal(R.avaliarLiberar(lead('u1'), 'u1').permitido, true)
  assert.equal(R.avaliarLiberar(lead('u2'), 'u1').motivo, MOTIVOS.NAO_E_O_DONO)
  // Ja livre: nada a fazer, e nao e' erro.
  assert.equal(R.avaliarLiberar(lead(null), 'u1').permitido, false)
  assert.equal(R.avaliarLiberar(lead(null), 'u1').motivo, MOTIVOS.OK)
})

// ─── Transferir ──────────────────────────────────────────────────────────────────────────

test('transferir exige a capacidade — e a capacidade chega PRONTA, nao e decidida aqui', () => {
  // Dois modulos puros, duas perguntas: acesso-capacidades diz "pode transferir?", este diz
  // "esta transferencia faz sentido?". Misturar faria a matriz de permissao vazar para ca.
  assert.equal(R.avaliarTransferir(lead('u2'), { usuarioId: 'u1', podeTransferir: true, destinoId: 'u3' }).permitido, true)
  assert.equal(R.avaliarTransferir(lead('u2'), { usuarioId: 'u1', podeTransferir: false, destinoId: 'u3' }).motivo, MOTIVOS.SEM_PERMISSAO)
})

test('devolver o PROPRIO lead para a fila NAO exige capacidade de transferir', () => {
  const r = R.avaliarTransferir(lead('u1'), { usuarioId: 'u1', podeTransferir: false, destinoId: null })
  assert.equal(r.permitido, true)
  // Mas devolver o de OUTRO exige.
  assert.equal(R.avaliarTransferir(lead('u2'), { usuarioId: 'u1', podeTransferir: false, destinoId: null }).motivo, MOTIVOS.SEM_PERMISSAO)
})

test('transferir para o MESMO dono e recusado (nao infla historico)', () => {
  assert.equal(R.avaliarTransferir(lead('u2'), { usuarioId: 'u1', podeTransferir: true, destinoId: 'u2' }).motivo, MOTIVOS.MESMO_DONO)
})

// ─── Escopo de leitura ───────────────────────────────────────────────────────────────────

test('sqlEscopo: quem NAO pode ver todos recebe "meus" por padrao', () => {
  const r = R.sqlEscopo(undefined, { podeVerTodos: false, alias: 'p' })
  assert.equal(r.sql, 'p.responsavel_id = $1')
  assert.equal(r.usaUsuario, true)
})

test('sqlEscopo: quem PODE ver todos recebe sem recorte por padrao', () => {
  const r = R.sqlEscopo(undefined, { podeVerTodos: true })
  assert.equal(r.sql, '')
  assert.equal(r.usaUsuario, false)
})

test('sqlEscopo: pedir TODOS sem poder REBAIXA para meus+livres, nao devolve tudo', () => {
  // E' a regra que impede a tela de contornar o recorte trocando um parametro de query.
  const r = R.sqlEscopo('todos', { podeVerTodos: false, alias: 'p' })
  assert.match(r.sql, /responsavel_id = \$1/)
  assert.match(r.sql, /responsavel_id IS NULL/)
  assert.equal(r.usaUsuario, true)
  assert.equal(R.escopoEfetivo('todos', false), 'meus_e_livres')
  // E o escopo efetivo e' devolvido para a tela poder dizer o que esta mostrando.
  assert.equal(R.escopoEfetivo('todos', true), ESCOPO.TODOS)
})

test('sqlEscopo: livres nao precisa do id do usuario', () => {
  const r = R.sqlEscopo('livres', { podeVerTodos: false, alias: 'p' })
  assert.equal(r.sql, 'p.responsavel_id IS NULL')
  assert.equal(r.usaUsuario, false)
})

test('sqlEscopo respeita o placeholder e o alias informados', () => {
  assert.equal(R.sqlEscopo('meus', { alias: '', placeholder: '$7' }).sql, 'responsavel_id = $7')
})

test('sqlEscopo: valor invalido cai no padrao do papel, nunca em "sem recorte"', () => {
  assert.equal(R.sqlEscopo('lixo', { podeVerTodos: false, alias: 'p' }).sql, 'p.responsavel_id = $1')
  assert.equal(R.sqlEscopo(null, { podeVerTodos: false, alias: 'p' }).sql, 'p.responsavel_id = $1')
})

// ─── Pureza e guardas ────────────────────────────────────────────────────────────────────

test('o modulo de regra e PURO', () => {
  const src = fonte(path.join('src', 'services', 'lead-responsavel.js'))
  for (const proibido of ['require(', 'pool', 'fetch(', 'axios', 'process.env']) {
    assert.ok(!src.includes(proibido), `lead-responsavel.js (service) nao pode conter '${proibido}'`)
  }
})

test('GUARDA: assumir e um CLAIM ATOMICO, nao SELECT seguido de UPDATE', () => {
  // Um SELECT antes do UPDATE tem janela: dois vendedores leriam "livre" e os dois gravariam.
  const src = fonte(path.join('src', 'db', 'lead-responsavel.js'))
  const bloco = src.slice(src.indexOf('async function assumirLead'), src.indexOf('async function definirResponsavel'))
  assert.ok(/UPDATE prospectador\.prospects[\s\S]*?responsavel_id IS NULL[\s\S]*?RETURNING/.test(bloco),
    'assumirLead precisa ser UPDATE ... WHERE responsavel_id IS NULL RETURNING')
})

test('GUARDA: a porta de qualificacao e conferida no WHERE do claim, nao antes', () => {
  // Um lead pode ser descartado entre a leitura da tela e o clique.
  const src = fonte(path.join('src', 'db', 'lead-responsavel.js'))
  const bloco = src.slice(src.indexOf('async function assumirLead'), src.indexOf('async function definirResponsavel'))
  assert.ok(/qualificacao IN \('aprovado', 'legado'\)/.test(bloco),
    'o claim precisa exigir a porta no proprio UPDATE')
})

test('GUARDA: toda mudanca de dono grava histórico E auditoria', () => {
  const src = fonte(path.join('src', 'db', 'lead-responsavel.js'))
  const bloco = src.slice(src.indexOf('async function registrarMudanca'), src.indexOf('async function assumirLead'))
  assert.ok(bloco.includes('app.lead_responsavel_historico'), 'falta o historico (metrica de gestao)')
  assert.ok(bloco.includes('app.auditoria_eventos'), 'falta a auditoria (quem fez)')
  // Sem PII no contexto da auditoria.
  for (const proibido of ['nome', 'telefone', 'email']) {
    assert.ok(!/JSON\.stringify\(\{[^}]*(nome|telefone|email)/.test(bloco), `contexto nao pode ter ${proibido}`)
  }
})

test('GUARDA: o responsavel e validado contra usuarios_empresas da PROPRIA empresa', () => {
  // Atribuir lead a alguem de outro tenant seria vazamento por atribuicao.
  const src = fonte(path.join('src', 'db', 'lead-responsavel.js'))
  assert.ok(/app\.usuarios_empresas[\s\S]{0,200}ue\.empresa_id = \$1/.test(src))
  assert.ok(src.includes('RESPONSAVEL_INVALIDO'))
})

test('GUARDA: o lote NAO sobrescreve lead que ja tem dono', () => {
  // Tomar o lead de um colega precisa ser ato por lead, com historico de quem para quem.
  const src = fonte(path.join('src', 'db', 'lead-responsavel.js'))
  const bloco = src.slice(src.indexOf('async function atribuirEmLote'), src.indexOf('async function historicoDoLead'))
  assert.ok(/responsavel_id IS NULL/.test(bloco), 'o lote so pode pegar leads livres')
  assert.ok(bloco.includes('nao_atribuidos'), 'a diferenca precisa ser informada, nao engolida')
})

test('GUARDA: a rota do Banco de Leads aplica o MESMO recorte na listagem', () => {
  const src = fonte(path.join('src', 'routes', 'api-banco-leads.js'))
  assert.ok(src.includes('sqlEscopo'), 'a listagem perdeu o recorte por responsavel')
  assert.ok(src.includes('escopo.efetivo'), 'o escopo efetivo precisa voltar no meta — recortar em silencio engana o vendedor')
  assert.ok(/qualificacao/.test(src.match(/const COLUNAS = `[\s\S]*?`/)[0]), 'COLUNAS precisa trazer qualificacao')
  assert.ok(/responsavel_id/.test(src.match(/const COLUNAS = `[\s\S]*?`/)[0]), 'COLUNAS precisa trazer responsavel_id')
})

test('GUARDA: nenhuma rota de ownership decide papel por literal', () => {
  const src = semComentarios(fonte(path.join('src', 'routes', 'api-banco-leads.js')))
  assert.ok(!/papelEmpresa\s*===?\s*['"]/.test(src), 'use podeCapacidade(), nao comparacao de papel')
  assert.ok(src.includes('podeCapacidade'), 'a capacidade precisa ser avaliada pelo modulo puro')
})

test('GUARDA: a migration 072 e ADITIVA, 1:1, e nao faz backfill de dono', () => {
  const mig = fonte(path.join('sql', 'migrations', '072_lead_responsavel.sql'))
  const sql = mig.replace(/^--.*$/gm, ' ')
  assert.ok(!/\bUPDATE\s+prospectador/i.test(sql), 'nao pode mutar prospects')
  assert.ok(!/\bUPDATE\s+app\./i.test(sql))
  // 1:1: a coluna vive na linha do prospect, nao numa tabela de atribuicao N:N.
  assert.ok(/ALTER TABLE prospectador\.prospects[\s\S]*?responsavel_id\s+UUID/.test(sql))
  assert.ok(!/CREATE TABLE[^;]*lead_assignments/i.test(sql), 'lead_assignments foi recusada de proposito (§4.3)')
})
