'use strict'
// Paginacao e ordenacao NO SERVIDOR da listagem de leads da Aquisicao.
//
// A tela mostra 25 de milhares: ordenar so a pagina visivel daria uma ordem falsa ("o menor
// cadastro" seria o menor daqueles 25). Estes testes cobrem as duas pecas de risco — o
// whitelist do ORDER BY (o valor vem da URL) e o recorte da ordem CALCULADA na leitura.

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  montarFiltrosProspects,
  normalizarOrdemProspects,
  recortarIdsCalculados,
} = require('../src/prospecting')

// --- Whitelist do ORDER BY ----------------------------------------------------------------

test('ordenacao aceita as colunas da tabela e normaliza a direcao', () => {
  assert.deepEqual(normalizarOrdemProspects('nome', 'asc'), { chave: 'nome', dir: 'asc', calculada: false })
  assert.deepEqual(normalizarOrdemProspects('NOME', 'ASC'), { chave: 'nome', dir: 'asc', calculada: false })
  // Direcao desconhecida cai em desc (o default da tela), nunca vai crua para o SQL.
  assert.equal(normalizarOrdemProspects('nota', 'lixo').dir, 'desc')
  assert.equal(normalizarOrdemProspects('nota', '').dir, 'desc')
})

test('pontos e horario sao ordem CALCULADA, nao SQL', () => {
  // Os dois saem de calcularScoreCadastroPlaces; traduzi-los para SQL duplicaria a regra.
  assert.equal(normalizarOrdemProspects('pontos', 'asc').calculada, true)
  assert.equal(normalizarOrdemProspects('horario', 'desc').calculada, true)
})

test('chave desconhecida e IGNORADA — nada do cliente entra no ORDER BY', () => {
  assert.equal(normalizarOrdemProspects('id; DROP TABLE prospects', 'asc'), null)
  assert.equal(normalizarOrdemProspects('senha', 'asc'), null)
  assert.equal(normalizarOrdemProspects('p.created_at', 'asc'), null)
  // Sem ordenacao pedida = ordem de negocio padrao (comportamento historico preservado).
  assert.equal(normalizarOrdemProspects('', 'asc'), null)
  assert.equal(normalizarOrdemProspects(undefined, undefined), null)
})

// --- WHERE compartilhado com a contagem ---------------------------------------------------

test('listagem e contagem recortam o MESMO universo (menos o status)', () => {
  const filtros = { empresaId: 'e1', status: 'aguardando', mercado: 'barbearia', cidade: 'Santana', busca: 'jo' }

  const lista = montarFiltrosProspects(filtros)
  const contagem = montarFiltrosProspects(filtros, { alias: '', comStatus: false })

  // A lista filtra por status; a contagem NAO — la o status escolhe a coluna do resultado.
  assert.match(lista.whereSql, /p\.status = \$2/)
  assert.doesNotMatch(contagem.whereSql, /status =/)

  // Fora o status e o alias, o recorte e o mesmo: mesmos filtros, mesmos valores.
  assert.deepEqual(lista.params, ['e1', 'aguardando', '%barbearia%', '%Santana%', '%jo%'])
  assert.deepEqual(contagem.params, ['e1', '%barbearia%', '%Santana%', '%jo%'])
  assert.match(contagem.whereSql, /empresa_id = \$1/)
  assert.match(contagem.whereSql, /nome ILIKE \$4/)
})

test('sem filtro nenhum nao gera WHERE vazio quebrado', () => {
  assert.equal(montarFiltrosProspects({}).whereSql, '')
  assert.deepEqual(montarFiltrosProspects({}).params, [])
})

// --- Recorte da ordem calculada -----------------------------------------------------------

// Rows minimos: `calcularScoreCadastroPlaces` pontua a completude do cadastro. Aqui o que
// importa e a ORDEM relativa, entao cada lead recebe uma quantidade diferente de dados.
const vazio = { id: 'vazio', updated_at: '2026-01-01' }
const meio = { id: 'meio', updated_at: '2026-01-02', telefone: '1199', endereco: 'Rua A' }
const cheio = {
  id: 'cheio', updated_at: '2026-01-03', telefone: '1199', endereco: 'Rua A',
  email: 'a@b.com', site: 'https://exemplo.com.br', tem_site: true, avaliacoes: 10, rating: 4.8,
}

test('pontos ASC coloca o cadastro mais fraco primeiro (mais oportunidade)', () => {
  const ids = recortarIdsCalculados([cheio, vazio, meio], { chave: 'pontos', dir: 'asc' }, 10, 0)
  assert.deepEqual(ids, ['vazio', 'meio', 'cheio'])
})

test('pontos DESC inverte', () => {
  const ids = recortarIdsCalculados([vazio, cheio, meio], { chave: 'pontos', dir: 'desc' }, 10, 0)
  assert.deepEqual(ids, ['cheio', 'meio', 'vazio'])
})

test('o recorte anda pela lista inteira: offset alcanca o final', () => {
  const muitos = Array.from({ length: 100 }, (_, i) => ({
    id: `l${i}`, updated_at: '2026-01-01',
    // Quanto maior o i, mais completo o cadastro — ordem previsivel.
    telefone: i > 20 ? '1199' : null, email: i > 50 ? 'a@b.com' : null, endereco: i > 70 ? 'Rua A' : null,
  }))
  const pagina1 = recortarIdsCalculados(muitos, { chave: 'pontos', dir: 'asc' }, 25, 0)
  const pagina4 = recortarIdsCalculados(muitos, { chave: 'pontos', dir: 'asc' }, 25, 75)
  assert.equal(pagina1.length, 25)
  assert.equal(pagina4.length, 25)
  // Nenhum lead aparece em duas paginas.
  assert.equal(new Set([...pagina1, ...pagina4]).size, 50)
  // A ultima pagina tem os cadastros mais completos.
  assert.ok(pagina4.every((id) => !pagina1.includes(id)))
})

test('offset alem do fim devolve pagina vazia, nao erro', () => {
  assert.deepEqual(recortarIdsCalculados([vazio, meio], { chave: 'pontos', dir: 'asc' }, 25, 500), [])
  assert.deepEqual(recortarIdsCalculados([], { chave: 'pontos', dir: 'asc' }, 25, 0), [])
  assert.deepEqual(recortarIdsCalculados(null, { chave: 'pontos', dir: 'asc' }, 25, 0), [])
})

test('empate e desempatado pelo mais recente (o mesmo lead nao pula de pagina)', () => {
  const a = { id: 'a', updated_at: '2026-01-01' }
  const b = { id: 'b', updated_at: '2026-03-01' }
  const c = { id: 'c', updated_at: '2026-02-01' }
  // Os tres pontuam igual (cadastro vazio): a ordem tem de ser estavel e previsivel.
  assert.deepEqual(recortarIdsCalculados([a, b, c], { chave: 'pontos', dir: 'asc' }, 10, 0), ['b', 'c', 'a'])
  assert.deepEqual(recortarIdsCalculados([c, a, b], { chave: 'pontos', dir: 'asc' }, 10, 0), ['b', 'c', 'a'])
})

test('horario ordena por ter ou nao horario de funcionamento', () => {
  const com = { id: 'com', updated_at: '2026-01-01', raw_json: { regularOpeningHours: { x: 1 } } }
  const sem = { id: 'sem', updated_at: '2026-01-01' }
  assert.deepEqual(recortarIdsCalculados([com, sem], { chave: 'horario', dir: 'asc' }, 10, 0), ['sem', 'com'])
  assert.deepEqual(recortarIdsCalculados([sem, com], { chave: 'horario', dir: 'desc' }, 10, 0), ['com', 'sem'])
})
