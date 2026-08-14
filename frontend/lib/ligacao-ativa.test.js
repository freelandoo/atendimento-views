const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  ACAO, indexarAtivasPorLead, rotuloOperador, acaoDoLead, seloLigacaoAtiva,
  proximoLigavel, contarOcupadosPorOutros,
} = require('./ligacao-ativa')

const minha = {
  id: 'lig-1', campanha_lead_id: 'cl-1', prospect_id: 'p-1', estado_sessao: 'em_andamento',
  iniciada_em: '2026-08-14T12:00:00.000Z', chamada_encerrada_em: null,
  usuario_id: 'u-1', usuario_nome: 'Victor', sou_eu: true,
}
const alheia = { ...minha, id: 'lig-2', campanha_lead_id: 'cl-2', usuario_id: 'u-2', usuario_nome: 'Maria', sou_eu: false }

test('indexarAtivasPorLead: chaveia por lead e ignora item sem lead', () => {
  const mapa = indexarAtivasPorLead([minha, alheia, { ...alheia, campanha_lead_id: null }, null])
  assert.deepEqual(Object.keys(mapa).sort(), ['cl-1', 'cl-2'])
  assert.equal(mapa['cl-2'].usuario_nome, 'Maria')
})

test('indexarAtivasPorLead: entrada invalida vira mapa vazio (a fila nao quebra)', () => {
  assert.deepEqual(indexarAtivasPorLead(undefined), {})
  assert.deepEqual(indexarAtivasPorLead(null), {})
})

test('rotuloOperador: "você" para a propria; nome quando ha; fallback sem inventar identidade', () => {
  assert.equal(rotuloOperador(minha), 'você')
  assert.equal(rotuloOperador(alheia), 'Maria')
  assert.equal(rotuloOperador({ ...alheia, usuario_nome: '  ' }), 'outro operador')
  assert.equal(rotuloOperador({ ...alheia, usuario_nome: null }), 'outro operador')
})

test('acaoDoLead: sem ligacao ativa continua "Ligar" e nunca e somente leitura', () => {
  const a = acaoDoLead(null)
  assert.equal(a.acao, ACAO.LIGAR)
  assert.equal(a.rotulo, 'Ligar')
  assert.equal(a.somenteLeitura, false)
})

test('acaoDoLead: ligacao PROPRIA vira "Retomar" e mantem o comportamento normal', () => {
  const a = acaoDoLead(minha)
  assert.equal(a.acao, ACAO.RETOMAR)
  assert.equal(a.rotulo, 'Retomar')
  assert.equal(a.somenteLeitura, false) // idempotencia do POST /iniciar devolve a minha sessao
})

test('acaoDoLead: ligacao de OUTRA pessoa vira "Acompanhar" em somente leitura', () => {
  const a = acaoDoLead(alheia)
  assert.equal(a.acao, ACAO.ACOMPANHAR)
  assert.equal(a.rotulo, 'Acompanhar')
  assert.equal(a.somenteLeitura, true)
  assert.match(a.titulo, /Maria/)
  assert.match(a.titulo, /somente leitura/i)
})

test('acaoDoLead: resumo pendente de OUTRA pessoa continua somente leitura', () => {
  // O lead segue ocupado: no banco 'aguardando_resumo' e o mesmo status 'em_andamento'.
  const a = acaoDoLead({ ...alheia, estado_sessao: 'aguardando_resumo', chamada_encerrada_em: '2026-08-14T12:05:00.000Z' })
  assert.equal(a.acao, ACAO.ACOMPANHAR)
  assert.equal(a.somenteLeitura, true)
})

test('acaoDoLead: resumo pendente PROPRIO abre para concluir, nao para observar', () => {
  const a = acaoDoLead({ ...minha, estado_sessao: 'aguardando_resumo' })
  assert.equal(a.acao, ACAO.RETOMAR)
  assert.equal(a.somenteLeitura, false)
  assert.match(a.titulo, /resumo pendente/i)
})

test('seloLigacaoAtiva: diz o estado E quem, sempre em texto', () => {
  assert.equal(seloLigacaoAtiva(null), null)
  const s = seloLigacaoAtiva(alheia)
  assert.equal(s.texto, 'Em ligação agora · Maria')
  assert.equal(s.proprio, false)
  const meu = seloLigacaoAtiva(minha)
  assert.equal(meu.texto, 'Em ligação agora · você')
  assert.equal(meu.proprio, true)
  const pend = seloLigacaoAtiva({ ...alheia, estado_sessao: 'aguardando_resumo' })
  assert.equal(pend.texto, 'Resumo pendente · Maria')
})

// --- "Ligar agora" (botao global do topo) -------------------------------------------
const fila = [
  { campanha_lead_id: 'cl-2', nome: 'B' }, // ocupado por Maria
  { campanha_lead_id: 'cl-1', nome: 'A' }, // minha ligacao
  { campanha_lead_id: 'cl-3', nome: 'C' }, // livre
]

test('proximoLigavel: pula o lead ocupado por OUTRA pessoa', () => {
  const mapa = indexarAtivasPorLead([alheia])
  assert.equal(proximoLigavel(fila, mapa).campanha_lead_id, 'cl-1')
})

test('proximoLigavel: NAO pula a minha propria ligacao (retomar e o esperado)', () => {
  const mapa = indexarAtivasPorLead([minha, alheia])
  assert.equal(proximoLigavel(fila, mapa).campanha_lead_id, 'cl-1')
})

test('proximoLigavel: com todos ocupados por outros, nao ha proximo (botao desabilita)', () => {
  const mapa = indexarAtivasPorLead(fila.map((f, i) => ({ ...alheia, id: `x${i}`, campanha_lead_id: f.campanha_lead_id })))
  assert.equal(proximoLigavel(fila, mapa), null)
})

test('proximoLigavel: sem mapa de ativas, comporta-se como antes (primeiro da fila)', () => {
  assert.equal(proximoLigavel(fila, null).campanha_lead_id, 'cl-2')
  assert.equal(proximoLigavel([], {}), null)
})

test('contarOcupadosPorOutros: conta so o que e de outra pessoa', () => {
  const mapa = indexarAtivasPorLead([minha, alheia])
  assert.equal(contarOcupadosPorOutros(fila, mapa), 1)
  assert.equal(contarOcupadosPorOutros(fila, {}), 0)
})

// --- guarda de regressao ------------------------------------------------------------
test('guarda: a regra de dono vem do backend (`sou_eu`), nunca de comparacao de id no front', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'ligacao-ativa.js'), 'utf8')
  assert.equal(/usuario_id\s*===|===\s*usuario_id|localStorage|apiFetch/.test(fonte), false,
    'este modulo so traduz o veredito da API')
})

test('guarda: a tela nao pode decidir a acao por conta propria', () => {
  const tela = fs.readFileSync(
    path.join(__dirname, '..', 'app', 'dashboard', 'central-ligacoes', 'page.tsx'), 'utf8')
  assert.match(tela, /acaoDoLead/, 'a Central de Ligacoes deve consumir a regra pura')
  // Ternario sobre `sou_eu` na tela = rotulo/acao decidido fora da lib pura. Comparar o
  // veredito (`r.data.sou_eu === false`, na corrida do /iniciar) continua permitido — ali nao
  // se escolhe texto, se decide trocar de MODO.
  assert.equal(/\.sou_eu\s*\?/.test(tela), false,
    'rotulo/acao a partir de sou_eu pertence a lib pura, nao a tela')
  assert.equal(/usuario_id\s*===/.test(tela), false,
    'a tela nao compara id de usuario: quem sabe quem esta logado e o servidor')
})
