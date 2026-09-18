'use strict'
// Equipes Comerciais por Nicho — fundacao backend.
// Testa regras puras e guardas de regressao por fonte; nao abre conexao com banco.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const E = require('../src/services/equipes-comerciais')

const RAIZ = path.join(__dirname, '..')
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8')
const semComentarios = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ')

test('normalizarEquipe exige nome e nicho na criacao', () => {
  assert.throws(() => E.normalizarEquipe({ nome: 'A' }, { criar: true }), /Nome/)
  assert.throws(() => E.normalizarEquipe({ nome: 'Solar' }, { criar: true }), /nicho/)
  assert.deepEqual(
    E.normalizarEquipe({ nome: ' Solar ', nicho_id: 'n1', descricao: ' x ', usuario_ids: ['u1', 'u1', ''] }, { criar: true }),
    { nome: 'Solar', nicho_id: 'n1', descricao: 'x', usuario_ids: ['u1'] }
  )
})

test('normalizarParticipantes aceita lista vazia explicita para remover todos', () => {
  assert.deepEqual(E.normalizarParticipantes({ usuario_ids: [] }), { usuario_ids: [] })
  assert.throws(() => E.normalizarParticipantes({ usuario_ids: 'u1' }), /lista/)
})

test('migration cria equipe por nicho com isolamento por empresa', () => {
  const sql = fonte('sql/migrations/088_equipes_comerciais.sql')
  assert.match(sql, /CREATE TABLE IF NOT EXISTS app\.equipes_comerciais/)
  assert.match(sql, /nicho_id\s+UUID NOT NULL/)
  assert.match(sql, /FOREIGN KEY \(nicho_id, empresa_id\)/)
  assert.match(sql, /REFERENCES app\.nichos \(id, empresa_id\)/)
  assert.match(sql, /ON DELETE RESTRICT/)
})

test('migration impede duas equipes ativas no mesmo nicho e pessoa em duas equipes ativas', () => {
  const sql = fonte('sql/migrations/088_equipes_comerciais.sql')
  assert.match(sql, /equipes_comerciais_um_nicho_ativo_uk[\s\S]*ON app\.equipes_comerciais \(empresa_id, nicho_id\)[\s\S]*WHERE status = 'ativa'/)
  assert.match(sql, /equipe_membros_um_ativo_por_usuario_uk[\s\S]*ON app\.equipe_comercial_membros \(empresa_id, usuario_id\)[\s\S]*WHERE saiu_em IS NULL/)
})

test('migration e aditiva e nao muta dados existentes', () => {
  const sql = semComentarios(fonte('sql/migrations/088_equipes_comerciais.sql'))
  assert.ok(!/(^|;)\s*(UPDATE|DELETE|INSERT)\b/i.test(sql), 'migration nao deve fazer DML em dados existentes')
  assert.match(sql, /CREATE TABLE IF NOT EXISTS app\.equipe_comercial_membros/)
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS/)
})

test('db valida participantes pelo vinculo ativo da propria empresa', () => {
  const src = fonte('src/db/equipes-comerciais.js')
  assert.match(src, /FROM app\.usuarios_empresas ue/)
  assert.match(src, /ue\.empresa_id = \$1/)
  assert.match(src, /ue\.usuario_id = ANY\(\$2::uuid\[\]\)/)
  assert.match(src, /ue\.ativo = true/)
  assert.match(src, /u\.ativo = true/)
})

test('db bloqueia remocao de participantes ate existir devolucao de leads', () => {
  const src = fonte('src/db/equipes-comerciais.js')
  assert.match(src, /REMOCAO_EXIGE_DEVOLUCAO/)
  assert.match(src, /EQUIPE_COM_MEMBROS/)
  assert.match(src, /devolução de leads/)
})

test('db nunca decide equipe por nome de nicho nem por papel literal', () => {
  const src = semComentarios(fonte('src/db/equipes-comerciais.js'))
  assert.ok(!/lower\(.*nicho/.test(src), 'equipe precisa usar nicho_id, nao match por nome')
  assert.ok(!/role\s*===?\s*['"]/.test(src), 'equipe nao decide permissao por papel literal')
})

test('rota aplica auth + empresa + capacidade no router', () => {
  const src = fonte('src/routes/api-equipes-comerciais.js')
  assert.ok(
    /router\.use\(\s*requireAuth,\s*requireEmpresaAccess,\s*requireCapacidade\(\s*CAP\.MEMBROS_GERENCIAR\s*\)\s*\)/.test(src),
    'rota precisa ser protegida por MEMBROS_GERENCIAR no router'
  )
})

test('index monta equipes-comerciais separado do painel /equipe', () => {
  const src = fonte('index.js')
  assert.ok(src.includes("'/api/empresas/:empresaId/equipes-comerciais'"))
  assert.ok(src.includes("api-equipes-comerciais"))
})

test('package.json inclui esta suite', () => {
  const pkg = JSON.parse(fonte('package.json'))
  assert.ok(pkg.scripts.test.includes('test/equipes-comerciais.test.js'))
})

// ─── Etapa 3: o recorte por nicho ────────────────────────────────────────────────────────

test('sqlNichoDaEquipe casa por nicho_id, nunca pelo texto do nicho', () => {
  // E' a decisao D1 inteira: "Energia Solar" e "energia solar residencial" sao o mesmo negocio
  // para a pessoa e dois valores para o banco. Casar por nome tiraria leads do recorte EM
  // SILENCIO — e o vendedor veria menos carteira do que tem, sem nada explicando por que.
  const sql = E.sqlNichoDaEquipe({ placeholder: '$4' })
  assert.equal(sql, 'nicho_id = $4::uuid')
  assert.ok(!/\bnicho\s*=/.test(sql), 'nao pode comparar a coluna de TEXTO `nicho`')
  assert.ok(!/lower\(|ILIKE|LIKE/i.test(sql), 'nao pode casar por texto nem por aproximacao')
})

test('sqlNichoDaEquipe aceita alias, como os modulos irmaos', () => {
  assert.equal(E.sqlNichoDaEquipe({ alias: 'p', placeholder: '$2' }), 'p.nicho_id = $2::uuid')
  assert.equal(E.sqlNichoDaEquipe({ alias: 'p.', placeholder: '$2' }), 'p.nicho_id = $2::uuid')
})

test('quem NAO esta em equipe nao e recortado (decisao D2)', () => {
  // Recortar quem nao tem equipe transformaria ausencia de cadastro em bloqueio — o mesmo
  // lockout que o aceite do termo (084) ja custou caro.
  assert.equal(E.recorteDeNicho(null), null)
  assert.equal(E.recorteDeNicho(undefined), null)
})

test('equipe SEM nicho legivel tambem nao recorta', () => {
  // Recortar por um nicho que a tela nao consegue nomear produziria carteira vazia que ninguem
  // sabe explicar — o pior desfecho possivel para um recorte obrigatorio.
  assert.equal(E.recorteDeNicho({ equipe_id: 'e1', equipe_nome: 'Solar', nicho_id: null }), null)
})

test('recorteDeNicho carrega o NOME, para a tela poder declarar o recorte', () => {
  const r = E.recorteDeNicho({ equipe_id: 'e1', equipe_nome: 'Time Solar', nicho_id: 'n1', nicho_nome: 'Energia Solar' })
  assert.deepEqual(r, { nicho_id: 'n1', nicho_nome: 'Energia Solar', equipe_id: 'e1', equipe_nome: 'Time Solar' })
})

test('GUARDA: o modulo do recorte nao le banco nem conhece telas', () => {
  const src = semComentarios(fonte('src/services/equipes-comerciais.js'))
  for (const proibido of ['require(\'pg\')', 'pool.query', 'axios', 'fetch(']) {
    assert.ok(!src.includes(proibido), `services/equipes-comerciais.js nao pode conter '${proibido}'`)
  }
})

test('GUARDA: o recorte por nicho e aplicado nos DOIS montadores do Banco de Leads', () => {
  // Listagem, contagem, export e as rotas por id passam por um destes dois. Aplicar em um so'
  // faria a lista recortar e o export vazar — exatamente o buraco que `exigirLeadNoRecorte`
  // existe para fechar.
  const src = fonte('src/routes/api-banco-leads.js')
  const ocorrencias = (src.match(/sqlNichoDaEquipe\(/g) || []).length
  assert.ok(ocorrencias >= 3, `esperava o recorte em montarFiltro, montarRecorteOperacao e meu-resumo; achei ${ocorrencias}`)
  assert.ok(src.includes('__nichoEquipeId'), 'o recorte precisa viajar pela query, como __escopoSql')
})

test('GUARDA: a equipe do usuario e resolvida no Banco de Leads, nao em requireEmpresaAccess', () => {
  // `requireEmpresaAccess` roda em TODO request do produto; pendurar esta leitura la' cobraria
  // uma consulta de rotas que nao tem nada com nicho.
  const tenant = semComentarios(fonte('src/middleware/tenant.js'))
  assert.ok(!tenant.includes('equipeAtivaDoUsuario'), 'o middleware global nao deve resolver equipe')
  assert.ok(fonte('src/routes/api-banco-leads.js').includes('equipeAtivaDoUsuario'), 'a rota deve resolver')
})

test('GUARDA: meu-resumo e a listagem declaram a equipe no meta', () => {
  // Numeros diferentes para a mesma pergunta em duas telas seriam pior que nao ter a tela; e
  // recortar em silencio faria o vendedor achar que perdeu carteira.
  const src = fonte('src/routes/api-banco-leads.js')
  assert.ok((src.match(/equipe: nicho/g) || []).length >= 2, 'meta.equipe deve sair na listagem E no meu-resumo')
})
