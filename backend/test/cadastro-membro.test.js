'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const CM = require('../src/services/cadastro-membro')
const AC = require('../src/services/acesso-capacidades')

const SRC = path.join(__dirname, '..', 'src')
const fonte = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')
const HOJE = '2026-09-23'
const regras = { papeisConvidaveis: AC.papeisConvidaveis, papelExigeEquipe: AC.papelExigeEquipe }

// ─── Senha ────────────────────────────────────────────────────────────────────────────────

test('SENHA: 8+ caracteres, com letra e numero', () => {
  assert.equal(CM.problemaDaSenha('abc12345'), null)
  assert.equal(CM.problemaDaSenha('Ação1234'), null, 'letra acentuada conta como letra')
  assert.match(CM.problemaDaSenha('abc1234'), /8 caracteres/)
  assert.match(CM.problemaDaSenha('12345678'), /letra/)
  assert.match(CM.problemaDaSenha('abcdefgh'), /número/)
  assert.match(CM.problemaDaSenha(null), /8 caracteres/)
  assert.throws(() => CM.validarSenha('abcdefgh'), (e) => e.code === 'SENHA_FRACA' && e.statusCode === 400)
})

// ─── Data de nascimento e idade ───────────────────────────────────────────────────────────

test('NASCIMENTO: 18 anos completos passam; um dia antes do aniversario, nao', () => {
  assert.deepEqual(CM.validarDataNascimento('2008-09-23', HOJE), { data: '2008-09-23', idade: 18 })
  assert.throws(() => CM.validarDataNascimento('2008-09-24', HOJE), (e) => e.code === 'MENOR_DE_IDADE')
  assert.equal(CM.idadeEm('2000-02-29', '2026-02-28'), 25)
  assert.equal(CM.idadeEm('2000-02-29', '2026-03-01'), 26)
})

test('NASCIMENTO: data impossivel, futura, vazia ou absurda e recusada — nunca normalizada', () => {
  for (const v of ['2000-02-31', '2000-13-01', '01/02/2000', '', null, '2030-01-01', '1890-01-01']) {
    assert.throws(() => CM.validarDataNascimento(v, HOJE), (e) => e.code === 'NASCIMENTO_INVALIDO', String(v))
  }
})

test('DADOS PESSOAIS: normaliza e-mail e cobra todos os campos', () => {
  const ok = CM.validarDadosPessoais(
    { nome: '  Ana Lima ', email: ' ANA@Ex.com ', senha: 'abc12345', data_nascimento: '1990-05-10' }, HOJE)
  assert.deepEqual(ok, { nome: 'Ana Lima', email: 'ana@ex.com', senha: 'abc12345', dataNascimento: '1990-05-10' })
  assert.throws(() => CM.validarDadosPessoais({ nome: 'A', email: 'a@b.co', senha: 'abc12345', data_nascimento: '1990-05-10' }, HOJE))
  assert.throws(() => CM.validarDadosPessoais({ nome: 'Ana', email: 'x', senha: 'abc12345', data_nascimento: '1990-05-10' }, HOJE))
  assert.throws(() => CM.validarDadosPessoais({ nome: 'Ana', email: 'a@b.co', senha: 'abc12345' }, HOJE))
})

// ─── Convite ──────────────────────────────────────────────────────────────────────────────

test('CONVITE: token aleatorio, e so o hash e deterministico', () => {
  const a = CM.gerarTokenConvite()
  const b = CM.gerarTokenConvite()
  assert.notEqual(a, b)
  assert.match(a, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(CM.hashTokenConvite(a), CM.hashTokenConvite(a))
  assert.match(CM.hashTokenConvite(a), /^[0-9a-f]{64}$/)
  // Token malformado nao vira consulta.
  for (const ruim of ['', 'curto', "x' OR 1=1 --", null, 'a'.repeat(200)]) {
    assert.equal(CM.hashTokenConvite(ruim), null, String(ruim))
  }
})

test('CONVITE: vale 24h; usado e revogado vencem o relogio', () => {
  const agora = new Date('2026-09-23T12:00:00Z')
  const expira = CM.expiracaoConvite(agora)
  assert.equal(expira.getTime() - agora.getTime(), 24 * 3600 * 1000)
  const base = { expira_em: expira.toISOString() }
  assert.equal(CM.situacaoConvite(base, agora), 'pendente')
  assert.equal(CM.situacaoConvite(base, new Date(expira.getTime())), 'expirado', 'no instante exato ja venceu')
  assert.equal(CM.situacaoConvite({ ...base, usado_em: agora }, new Date('2030-01-01')), 'usado')
  assert.equal(CM.situacaoConvite({ ...base, revogado_em: agora }, new Date('2030-01-01')), 'revogado')
  assert.equal(CM.situacaoConvite({}, agora), 'expirado', 'sem validade nao e pendente')
})

test('CONVITE: owner nunca e convidavel e o comercial exige equipe', () => {
  assert.ok(!AC.papeisConvidaveis().includes('owner'))
  assert.deepEqual([...AC.papeisConvidaveis()].sort(), ['comercial'])
  const eq = '11111111-1111-1111-1111-111111111111'
  assert.throws(() => CM.validarNovoConvite({ role: 'owner' }, regras))
  assert.throws(() => CM.validarNovoConvite({ role: 'admin' }, regras))
  assert.throws(() => CM.validarNovoConvite({ role: 'member' }, regras))
  assert.throws(() => CM.validarNovoConvite({ role: 'comercial' }, regras), (e) => e.code === 'EQUIPE_OBRIGATORIA')
  assert.deepEqual(CM.validarNovoConvite({ role: 'comercial', equipe_id: eq, rotulo: ' Ana ' }, regras),
    { role: 'comercial', equipeId: eq, rotulo: 'Ana' })
  assert.throws(() => CM.validarNovoConvite({ role: 'comercial', equipe_id: 'nao-uuid' }, regras))
})

test('ANTI-DRIFT: a CHECK atual de papel de convite e o vocabulario convidavel sao o mesmo', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'migrations', '101_simplificar_papeis_empresa.sql'), 'utf8')
  const m = sql.match(/membro_convites_role_chk[\s\S]*?CHECK \(role IN \(([^)]*)\)\)/)
  assert.ok(m, 'nao achei a CHECK de papel')
  const naCheck = m[1].split(',').map((x) => x.trim().replace(/'/g, '')).sort()
  assert.deepEqual(naCheck, [...AC.papeisConvidaveis()].sort())
})

// ─── Guardas que leem o fonte ─────────────────────────────────────────────────────────────

test('GUARDA: nenhuma leitura de convite devolve o token nem o hash', () => {
  const src = fonte(path.join('db', 'membro-convites.js'))
  const cols = src.match(/const COLS_CONVITE = `([\s\S]*?)`/)
  assert.ok(cols && !cols[1].includes('token_hash'), 'COLS_CONVITE nao pode expor token_hash')
  for (const linha of src.split(/\r?\n/)) {
    if (/RETURNING[^\n]*token_hash/.test(linha)) assert.fail(`RETURNING com token_hash: ${linha.trim()}`)
  }
  assert.ok(!fonte(path.join('routes', 'api-membros.js')).includes('token_hash'))
  assert.ok(!fonte(path.join('routes', 'api-convites.js')).includes('token_hash'))
})

test('GUARDA: a rota publica nao aceita papel, equipe nem empresa vindos do corpo', () => {
  const src = fonte(path.join('routes', 'api-convites.js'))
  for (const campo of ['b.role', 'b.equipe_id', 'b.empresa_id', 'b.permissoes', 'req.body.role']) {
    assert.ok(!src.includes(campo), `api-convites.js nao pode ler ${campo}`)
  }
  assert.ok(src.includes('aceiteLimiter') && src.includes('leituraLimiter'), 'as rotas publicas precisam de limite por IP')
})

test('GUARDA: o convite nunca reaproveita conta existente e cria usuario com papel global user', () => {
  const src = fonte(path.join('db', 'membro-convites.js'))
  assert.ok(src.includes("'EMAIL_EXISTS'"), 'e-mail existente deve ser recusado')
  assert.ok(/INSERT INTO app\.usuarios[\s\S]*?'user'/.test(src), 'papel global do convidado e sempre user')
  assert.ok(/FOR UPDATE/.test(src), 'a aceitacao precisa travar o convite')
})

test('GUARDA: cadastro direto e convite usam a MESMA regra de senha e idade', () => {
  const membros = fonte(path.join('db', 'membros.js'))
  assert.ok(membros.includes('CM.problemaDaSenha') && membros.includes('CM.validarDataNascimento'))
  assert.ok(!/SENHA_MIN = 12/.test(membros), 'o piso antigo de 12 nao pode voltar')
  assert.ok(membros.includes('EQ.adicionarParticipanteEmTx'), 'comercial entra na equipe no cadastro')
})

test('GUARDA: o convite carrega as liberacoes alem do papel, saneadas na criacao e no aceite', () => {
  const src = fonte(path.join('db', 'membro-convites.js'))
  assert.ok(src.includes('M.sanearPermissoes((dados || {}).permissoes, v.role)'), 'criacao saneia contra o papel')
  assert.ok(src.includes('M.sanearPermissoesExistentes(convite.permissoes, convite.role)'), 'aceite revalida contra o papel')
  assert.ok(fonte(path.join('routes', 'api-membros.js')).includes('permissoes: b.permissoes'))
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'migrations', '098_convite_permissoes.sql'), 'utf8')
  assert.ok(/jsonb_typeof\(permissoes\) = 'object'/.test(sql))
})
