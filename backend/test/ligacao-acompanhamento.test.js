const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  ESTADOS_OCUPADO, CAMPOS_PUBLICOS, CAMPOS_CALCULADOS,
  ocupaLead, ehDono, resumirLigacaoAtiva, resumirLigacoesAtivas,
} = require('../src/services/ligacao-acompanhamento')
const { listarLigacoesAtivasDaCampanha } = require('../src/db/ligacoes')

function fakePool(rows = []) {
  const calls = []
  return { calls, async query(sql, params) { calls.push({ sql, params }); return { rows } } }
}

const ATIVA = {
  id: 'lig-1', status: 'em_andamento', estado_sessao: 'em_andamento',
  campanha_lead_id: 'cl-1', prospect_id: 'p-1',
  iniciada_em: '2026-08-14T12:00:00.000Z', chamada_encerrada_em: null,
  usuario_id: 'u-1', usuario_nome: 'Maria',
}

// --- vocabulario puro ---------------------------------------------------------------
test('ocupaLead: em_andamento E aguardando_resumo ocupam o lead', () => {
  assert.equal(ocupaLead({ estado_sessao: 'em_andamento' }), true)
  // No banco os dois sao o MESMO status (migration 048): tratar so o primeiro deixaria o lead
  // "livre" enquanto outra pessoa ainda grava o resumo dele.
  assert.equal(ocupaLead({ estado_sessao: 'aguardando_resumo' }), true)
  assert.deepEqual([...ESTADOS_OCUPADO].sort(), ['aguardando_resumo', 'em_andamento'])
})

test('ocupaLead: sessao terminada ou ausente nao ocupa', () => {
  assert.equal(ocupaLead({ estado_sessao: 'encerrada' }), false)
  assert.equal(ocupaLead({ estado_sessao: 'descartada' }), false)
  assert.equal(ocupaLead(null), false)
  assert.equal(ocupaLead({}), false)
})

test('ehDono: so o mesmo usuario; ausencia de usuario nunca vira dono', () => {
  assert.equal(ehDono(ATIVA, 'u-1'), true)
  assert.equal(ehDono(ATIVA, 'u-2'), false)
  assert.equal(ehDono({ ...ATIVA, usuario_id: null }, 'u-1'), false)
  assert.equal(ehDono(ATIVA, null), false)
  assert.equal(ehDono(ATIVA, undefined), false)
})

test('resumirLigacaoAtiva: marca sou_eu e nao vaza dado da conversa', () => {
  const meu = resumirLigacaoAtiva({ ...ATIVA, telefone: '5511999990000', notas: 'segredo', resultado: 'atendeu' }, 'u-1')
  assert.equal(meu.sou_eu, true)
  assert.equal(meu.usuario_nome, 'Maria')
  assert.equal(meu.estado_sessao, 'em_andamento')
  // Lista FECHADA de campos: nada de telefone/notas/resultado no payload da listagem.
  assert.deepEqual(Object.keys(meu).sort(), [...CAMPOS_CALCULADOS, ...CAMPOS_PUBLICOS].sort())
  assert.equal('telefone' in meu, false)
  assert.equal('notas' in meu, false)
  assert.equal('resultado' in meu, false)

  const alheia = resumirLigacaoAtiva(ATIVA, 'u-2')
  assert.equal(alheia.sou_eu, false)
})

test('resumirLigacaoAtiva: sessao terminada devolve null', () => {
  assert.equal(resumirLigacaoAtiva({ ...ATIVA, estado_sessao: 'encerrada' }, 'u-1'), null)
})

test('resumirLigacoesAtivas: descarta ad-hoc (sem campanha_lead_id) e sessao terminada', () => {
  const out = resumirLigacoesAtivas([
    ATIVA,
    { ...ATIVA, id: 'lig-2', campanha_lead_id: null },          // ad-hoc: nao e linha da fila
    { ...ATIVA, id: 'lig-3', campanha_lead_id: 'cl-3', estado_sessao: 'encerrada' },
    null,
  ], 'u-9')
  assert.equal(out.length, 1)
  assert.equal(out[0].id, 'lig-1')
  assert.equal(out[0].sou_eu, false)
})

test('resumirLigacoesAtivas: sem usuario autenticado, nada vira "meu"', () => {
  const out = resumirLigacoesAtivas([ATIVA], null)
  assert.equal(out[0].sou_eu, false)
})

// --- leitura em lote ----------------------------------------------------------------
test('listarLigacoesAtivasDaCampanha: exige campanha_id (nao vira leitura da empresa inteira)', async () => {
  const pool = fakePool([])
  await assert.rejects(() => listarLigacoesAtivasDaCampanha(pool, 'emp1', {}), /campanha_id obrigatorio/)
  assert.equal(pool.calls.length, 0)
})

test('listarLigacoesAtivasDaCampanha: UMA consulta, escopada por empresa+campanha+status', async () => {
  const pool = fakePool([{ ...ATIVA, estado_sessao: undefined }])
  const out = await listarLigacoesAtivasDaCampanha(pool, 'emp1', { campanhaId: 'camp-1' })
  assert.equal(pool.calls.length, 1) // sem N+1
  const { sql, params } = pool.calls[0]
  assert.match(sql, /l\.empresa_id = \$1/)
  assert.match(sql, /l\.campanha_id = \$2/)
  assert.match(sql, /l\.status = 'em_andamento'/)
  assert.deepEqual(params.slice(0, 2), ['emp1', 'camp-1'])
  // estado_sessao vem do banco (comEstado), nao do front nem do service.
  assert.equal(out[0].estado_sessao, 'em_andamento')
})

test('listarLigacoesAtivasDaCampanha: resumo pendente sai como aguardando_resumo', async () => {
  const pool = fakePool([{ ...ATIVA, estado_sessao: undefined, chamada_encerrada_em: '2026-08-14T12:05:00.000Z' }])
  const [row] = await listarLigacoesAtivasDaCampanha(pool, 'emp1', { campanhaId: 'camp-1' })
  assert.equal(row.estado_sessao, 'aguardando_resumo')
  assert.equal(ocupaLead(row), true)
})

// --- guardas de regressao -----------------------------------------------------------
test('guarda: o modulo de acompanhamento e PURO (sem banco, HTTP, IA ou rede)', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'ligacao-acompanhamento.js'), 'utf8')
  assert.equal(/\bpool\b|axios|fetch\(/.test(fonte), false, 'modulo puro nao fala com banco nem rede')
  // A guarda original era "nao importa NADA". Ela ficou estreita demais quando a comparacao
  // "veio desta mesma sessao?" ganhou dono proprio (`sessao-origem.js`, tambem puro):
  // reimplementa-la aqui criaria uma segunda fonte para a mesma regra. A guarda passou a
  // cobrar a LISTA de imports permitidos — mais forte que a contagem, porque um `require` de
  // banco/rede continua quebrando o teste, com nome.
  const imports = [...fonte.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1])
  assert.deepEqual(imports, ['./sessao-origem'],
    'o acompanhamento so pode depender de outro modulo PURO de servico')
})

test('guarda: /ativas passa pelo sanitizador e /iniciar publica sou_eu', () => {
  const rota = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'api-ligacoes.js'), 'utf8')
  // A listagem NUNCA devolve a linha crua do banco: quem decide o que sai e o modulo puro.
  assert.match(rota, /ACOMP\.resumirLigacoesAtivas\(rows, req\.usuario\?\.id, origem\(req\)\.impressao\)/)
  // `sou_eu` no /iniciar e o que fecha a corrida de dois cliques quase simultaneos: sem ele o
  // segundo operador passaria a OPERAR a sessao que o primeiro acabou de abrir.
  assert.match(rota, /sou_eu: ACOMP\.ehDono\(data, req\.usuario\?\.id\)/)
  // A leitura em lote e' autenticada e escopada no tenant, como todas as outras.
  assert.match(rota, /router\.get\('\/ativas', requireAuth, requireEmpresaAccess/)
})

test('guarda: a rota /ativas nao devolve telefone, notas nem conteudo da conversa', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'ligacoes.js'), 'utf8')
  const sql = fonte.slice(fonte.indexOf('async function listarLigacoesAtivasDaCampanha'))
    .slice(0, fonte.slice(fonte.indexOf('async function listarLigacoesAtivasDaCampanha')).indexOf('\n}'))
  assert.equal(/l\.telefone|l\.notas|l\.resultado/.test(sql), false,
    'a leitura em lote alimenta uma LISTAGEM: conteudo da ligacao nao entra nela')
})
