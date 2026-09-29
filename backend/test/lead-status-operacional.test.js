'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const {
  STATUS_OPERACIONAL,
  statusPorOrdem,
  ordemDoStatus,
  sqlStatusOperacional,
  sqlFiltroStatusOperacional,
} = require('../src/services/lead-status-operacional')

const RAIZ = path.join(__dirname, '..')
const fonte = fs.readFileSync(path.join(RAIZ, 'src', 'services', 'lead-status-operacional.js'), 'utf8')
const TELA = path.join(RAIZ, '..', 'frontend', 'app', 'dashboard', 'banco-leads', 'page.tsx')

// ─── Vocabulario ────────────────────────────────────────────────────────────────────────────

test('os dez status, na ordem de EXIBICAO', () => {
  assert.deepEqual(STATUS_OPERACIONAL, [
    'sem_contato', 'marcado', 'contatado', 'ligacao_feita', 'follow_up',
    'respondido', 'reuniao', 'proposta', 'fechado', 'descartado',
  ])
})

test('traducao ida e volta', () => {
  for (const chave of STATUS_OPERACIONAL) {
    assert.equal(statusPorOrdem(ordemDoStatus(chave)), chave, chave)
  }
})

test('desconhecido devolve null — nunca um default silencioso', () => {
  assert.equal(ordemDoStatus('xpto'), null)
  assert.equal(ordemDoStatus(''), null)
  assert.equal(ordemDoStatus(null), null)
  assert.equal(statusPorOrdem(999), null)
  assert.equal(statusPorOrdem(undefined), null)
})

// ─── SQL ────────────────────────────────────────────────────────────────────────────────────

test('o CASE cobre os 9 degraus com condicao + o ELSE', () => {
  const sql = sqlStatusOperacional()
  assert.equal((sql.match(/WHEN /g) || []).length, 9, 'nove WHEN')
  assert.match(sql, /ELSE 10\b/, 'o ELSE e sem_contato (10)')
  for (const chave of STATUS_OPERACIONAL) {
    if (chave === 'sem_contato') continue
    assert.ok(sql.includes(`THEN ${ordemDoStatus(chave)}`), `${chave} ausente do CASE`)
  }
})

test('a forma AUTONOMA (subconsulta) produz os MESMOS degraus que a de alias', () => {
  // E o ponto do modulo: a listagem tem os LATERAL e pode usar alias; a CONTAGEM roda
  // `FROM prospectador.prospects` puro. Se as duas divergissem, a tela mostraria um total que
  // nao corresponde ao que ela lista.
  const porAlias = sqlStatusOperacional()
  const autonomo = sqlStatusOperacional({
    proximoAgendamento: '(SELECT MIN(x) FROM ag)',
    ultimaAcao: '(SELECT acao FROM aud LIMIT 1)',
  })
  const degraus = (sql) => [...sql.matchAll(/THEN (\d+)/g)].map((m) => m[1])
  assert.deepEqual(degraus(autonomo), degraus(porAlias), 'os degraus precisam ser os mesmos')
  assert.ok(autonomo.includes('(SELECT MIN(x) FROM ag) IS NOT NULL'), 'expressao de agenda crua')
  assert.ok(autonomo.includes("(SELECT acao FROM aud LIMIT 1) = 'lead_descartado'"), 'expressao de acao crua')
  assert.ok(!autonomo.includes('agenda.proximo_agendamento'), 'nao pode vazar a expressao padrao')
  assert.ok(!autonomo.includes('status_op.'), 'nao pode vazar a expressao padrao')
})

test('filtro por status desconhecido devolve null — a clausula NAO entra', () => {
  // Uma lista vazia viraria `= ANY('{}')` e esvaziaria a carteira em vez de ignorar o filtro.
  // Mesma disciplina de `origensDoFiltro` (services/lead-origem.js).
  assert.equal(sqlFiltroStatusOperacional('xpto'), null)
  assert.equal(sqlFiltroStatusOperacional(''), null)
  assert.match(sqlFiltroStatusOperacional('reuniao'), /= 60$/)
})

// ─── Os DOIS EIXOS ──────────────────────────────────────────────────────────────────────────

test('a ordem de AVALIACAO nao e a de EXIBICAO, e e de proposito', () => {
  const sql = sqlStatusOperacional()
  const avaliacao = [...sql.matchAll(/THEN (\d+)/g)].map((m) => Number(m[1]))
  const exibicao = STATUS_OPERACIONAL.filter((c) => c !== 'sem_contato').map(ordemDoStatus)
  assert.notDeepEqual(avaliacao, exibicao, 'se coincidirem, o teste virou decoracao')
  // `descartado` (80, o ULTIMO a aparecer) e testado em SEGUNDO: recusa de uma pessoa vence
  // qualquer sinal de atividade. Sem isso, lead recusado que ja respondeu ficaria "Respondido".
  assert.equal(avaliacao[1], 80, 'descartado precisa ser o 2o avaliado')
  assert.ok(avaliacao.indexOf(60) < avaliacao.indexOf(50), 'reuniao antes de respondido')
  assert.ok(avaliacao.indexOf(65) < avaliacao.indexOf(60), 'proposta antes de reuniao')
})

// ─── Guardas de regressao ───────────────────────────────────────────────────────────────────

test('PURO: sem banco, HTTP, IA ou rede', () => {
  const proibidos = [/require\('\.\.\/db/, /require\('axios/, /require\('node-fetch/, /generateAIResponse/, /pool\./]
  for (const re of proibidos) assert.ok(!re.test(fonte), `modulo puro nao pode casar ${re}`)
})

test('ANTI-DRIFT: a cascata daqui e a mesma que a tela ainda aplica', () => {
  // Enquanto a Fase B nao roda, `statusOperacionalDoLead` continua em page.tsx. Duas copias da
  // MESMA regra divergem no primeiro ajuste — e a tela passaria a explicar um status diferente
  // do que o servidor filtrou. Esta guarda compara a ORDEM DE AVALIACAO das duas.
  if (!fs.existsSync(TELA)) return // backend sozinho (ex.: imagem de producao) nao tem o front
  const tsx = fs.readFileSync(TELA, 'utf8')
  const i = tsx.indexOf('function statusOperacionalDoLead')
  if (i < 0) return // ja migrada na Fase B: a copia da tela deixou de existir
  const bloco = tsx.slice(i, tsx.indexOf('\n}', i))
  const naTela = [...bloco.matchAll(/chave = '(\w+)'/g)].map((m) => m[1])
  const aqui = [...sqlStatusOperacional().matchAll(/THEN (\d+)/g)].map((m) => statusPorOrdem(Number(m[1])))
  // A tela declara `sem_contato` como valor inicial (o ELSE); aqui ele e o ELSE do CASE.
  assert.deepEqual(
    naTela.slice(1), aqui,
    'A cascata do backend e a da tela divergiram.\n' +
    'Se a mudanca foi de proposito, mude os DOIS no mesmo commit — ou conclua a Fase B do R7 e\n' +
    'apague a copia de page.tsx, que e o destino certo.'
  )
})

test('ANTI-DRIFT: os numeros de exibicao sao os mesmos de STATUS_LEAD_VISUAL', () => {
  if (!fs.existsSync(TELA)) return
  const tsx = fs.readFileSync(TELA, 'utf8')
  const i = tsx.indexOf('const STATUS_LEAD_VISUAL')
  if (i < 0) return
  const bloco = tsx.slice(i, tsx.indexOf('\n}\n', i))
  const L = bloco.split(/\r?\n/)
  const naTela = {}
  let chave = null
  for (const l of L) {
    const mc = l.match(/^  (\w+): \{/)
    if (mc) chave = mc[1]
    const mo = l.match(/ordem: (\d+)/)
    if (mo && chave) naTela[chave] = Number(mo[1])
  }
  for (const c of STATUS_OPERACIONAL) {
    assert.equal(naTela[c], ordemDoStatus(c), `ordem de "${c}" divergiu entre backend e tela`)
  }
})
