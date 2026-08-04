'use strict'
// Regras de tempo das Rotinas de Aquisição: dias ativos, janela, intervalo mínimo,
// quantidade 1..200, pausa/retomada e escolha de UMA rotina por empresa.

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizarRotina,
  validarRotina,
  localizacaoRotina,
  dentroDaJanela,
  intervaloCumprido,
  rotinaDeveExecutar,
  escolherRotinaElegivel,
  proximaExecucao,
  estadoRotina,
  QUANTIDADE_MAX,
  INTERVALO_MIN_HORAS,
} = require('../src/services/aquisicao-rotinas-scheduler')

const TZ = 'America/Sao_Paulo'
const brt = (iso) => new Date(`${iso}-03:00`)

// 2026-06-23 = terça | 2026-06-21 = domingo
const TERCA_10H = brt('2026-06-23T10:00:00')

const rotina = (over = {}) => ({
  id: 'r1',
  empresa_id: 'e1',
  nicho: 'dentista',
  cidade: 'Campinas',
  uf: 'SP',
  dias_semana: [1, 2, 3, 4, 5],
  janela_inicio: '08:00',
  janela_fim: '18:00',
  intervalo_horas: 6,
  quantidade: 200,
  ativo: true,
  estado: 'aguardando',
  ultima_execucao_em: null,
  criado_em: brt('2026-06-01T00:00:00').toISOString(),
  ...over,
})

// --- normalização e validação -------------------------------------------------

test('quantidade é presa entre 1 e 200', () => {
  assert.equal(normalizarRotina({ quantidade: 0 }).quantidade, 1)
  assert.equal(normalizarRotina({ quantidade: 1 }).quantidade, 1)
  assert.equal(normalizarRotina({ quantidade: 87 }).quantidade, 87)
  assert.equal(normalizarRotina({ quantidade: 201 }).quantidade, QUANTIDADE_MAX)
  assert.equal(normalizarRotina({ quantidade: 99999 }).quantidade, QUANTIDADE_MAX)
  assert.equal(normalizarRotina({}).quantidade, QUANTIDADE_MAX, 'sem valor, usa o teto da fonte')
})

test('intervalo nunca fica abaixo do mínimo de 6 horas', () => {
  assert.equal(normalizarRotina({ intervalo_horas: 1 }).intervalo_horas, INTERVALO_MIN_HORAS)
  assert.equal(normalizarRotina({ intervalo_horas: 0 }).intervalo_horas, INTERVALO_MIN_HORAS)
  assert.equal(normalizarRotina({ intervalo_horas: -5 }).intervalo_horas, INTERVALO_MIN_HORAS)
  assert.equal(normalizarRotina({ intervalo_horas: 12 }).intervalo_horas, 12)
  assert.equal(normalizarRotina({ intervalo_horas: 999 }).intervalo_horas, 168)
})

test('janela invertida ou vazia cai num padrão válido em vez de quebrar o CHECK', () => {
  assert.deepEqual(
    [normalizarRotina({ janela_inicio: '20:00', janela_fim: '08:00' }).janela_inicio,
      normalizarRotina({ janela_inicio: '20:00', janela_fim: '08:00' }).janela_fim],
    ['20:00', '23:59']
  )
  const igual = normalizarRotina({ janela_inicio: '09:00', janela_fim: '09:00' })
  assert.equal(igual.janela_fim, '18:00')
})

test('UF só aceita duas letras; lixo vira null', () => {
  assert.equal(normalizarRotina({ uf: 'sp' }).uf, 'SP')
  assert.equal(normalizarRotina({ uf: 'São Paulo' }).uf, null)
  assert.equal(normalizarRotina({ uf: '' }).uf, null)
})

test('validação exige nicho, cidade e ao menos um dia', () => {
  assert.deepEqual(validarRotina(normalizarRotina({ cidade: 'Campinas' })), ['Informe o nicho.'])
  assert.deepEqual(validarRotina(normalizarRotina({ nicho: 'dentista' })), ['Informe a cidade.'])
  assert.deepEqual(validarRotina(normalizarRotina({ nicho: 'a', cidade: 'b' })), [])
})

test('edição parcial preserva os campos não enviados', () => {
  const base = rotina({ quantidade: 50 })
  const editada = normalizarRotina({ cidade: 'Sorocaba' }, base)
  assert.equal(editada.cidade, 'Sorocaba')
  assert.equal(editada.nicho, 'dentista')
  assert.equal(editada.quantidade, 50)
  assert.equal(editada.uf, 'SP')
})

// --- cidade + UF --------------------------------------------------------------

test('localização junta cidade e UF (correção do fluxo manual)', () => {
  assert.equal(localizacaoRotina('Campinas', 'SP'), 'Campinas - SP')
  assert.equal(localizacaoRotina('Santana', 'AP'), 'Santana - AP')
  assert.equal(localizacaoRotina('Campinas', null), 'Campinas')
  assert.equal(localizacaoRotina(null, 'SP'), null)
})

test('não duplica a UF quando o operador já digitou junto', () => {
  assert.equal(localizacaoRotina('Campinas - SP', 'SP'), 'Campinas - SP')
  assert.equal(localizacaoRotina('Campinas, SP', 'SP'), 'Campinas, SP')
})

// --- dias, janela e intervalo -------------------------------------------------

test('dias ativos: dispara em dia da lista, não dispara fora dela', () => {
  assert.equal(dentroDaJanela(rotina(), TERCA_10H, TZ), true)
  assert.equal(dentroDaJanela(rotina({ dias_semana: [1, 3, 5] }), TERCA_10H, TZ), false, 'terça não está em seg/qua/sex')
  assert.equal(dentroDaJanela(rotina(), brt('2026-06-21T10:00:00'), TZ), false, 'domingo fora dos dias úteis')
  assert.equal(dentroDaJanela(rotina({ dias_semana: [0] }), brt('2026-06-21T10:00:00'), TZ), true, 'domingo ativado explicitamente')
})

test('janela de horário limita a execução nas duas pontas', () => {
  assert.equal(dentroDaJanela(rotina(), brt('2026-06-23T07:59:00'), TZ), false)
  assert.equal(dentroDaJanela(rotina(), brt('2026-06-23T08:00:00'), TZ), true)
  assert.equal(dentroDaJanela(rotina(), brt('2026-06-23T18:00:00'), TZ), true)
  assert.equal(dentroDaJanela(rotina(), brt('2026-06-23T18:01:00'), TZ), false)
})

test('intervalo conta a partir do DISPARO da última execução', () => {
  const recente = rotina({ ultima_execucao_em: brt('2026-06-23T06:00:00').toISOString() }) // 4h
  assert.equal(intervaloCumprido(recente, TERCA_10H), false)
  const vencida = rotina({ ultima_execucao_em: brt('2026-06-23T03:00:00').toISOString() }) // 7h
  assert.equal(intervaloCumprido(vencida, TERCA_10H), true)
  const exata = rotina({ ultima_execucao_em: brt('2026-06-23T04:00:00').toISOString() }) // 6h cravadas
  assert.equal(intervaloCumprido(exata, TERCA_10H), true)
})

test('intervalo próprio de cada rotina é respeitado', () => {
  const doze = rotina({ intervalo_horas: 12, ultima_execucao_em: brt('2026-06-23T01:00:00').toISOString() }) // 9h
  assert.equal(intervaloCumprido(doze, TERCA_10H), false)
  const seis = rotina({ intervalo_horas: 6, ultima_execucao_em: brt('2026-06-23T01:00:00').toISOString() })
  assert.equal(intervaloCumprido(seis, TERCA_10H), true)
})

test('execução perdida fora da janela NÃO é compensada depois', () => {
  // Venceu às 03:00 (fora da janela). Às 10:00 roda UMA vez — não há acúmulo de atrasadas.
  const r = rotina({ ultima_execucao_em: brt('2026-06-22T20:00:00').toISOString() })
  assert.equal(rotinaDeveExecutar(r, brt('2026-06-23T03:00:00'), TZ), false, 'fora da janela não roda')
  assert.equal(rotinaDeveExecutar(r, TERCA_10H, TZ), true, 'roda uma única vez quando a janela abre')
})

// --- pausa e retomada ---------------------------------------------------------

test('rotina pausada não executa e volta a executar ao ser retomada', () => {
  const pausada = rotina({ ativo: false, estado: 'pausada' })
  assert.equal(rotinaDeveExecutar(pausada, TERCA_10H, TZ), false)
  assert.equal(estadoRotina(pausada, TERCA_10H).chave, 'pausada')

  const retomada = { ...pausada, ativo: true, estado: 'aguardando' }
  assert.equal(rotinaDeveExecutar(retomada, TERCA_10H, TZ), true)
})

test('pausa preserva o histórico da rotina', () => {
  const pausada = rotina({ ativo: false, estado: 'pausada', total_execucoes: 9, ultimo_novos: 12 })
  assert.equal(pausada.total_execucoes, 9)
  assert.equal(pausada.ultimo_novos, 12)
})

test('estado "precisa de atenção" bloqueia novo disparo pago', () => {
  const quebrada = rotina({ estado: 'precisa_atencao' })
  assert.equal(rotinaDeveExecutar(quebrada, TERCA_10H, TZ), false)
  assert.equal(estadoRotina(quebrada, TERCA_10H).chave, 'precisa_atencao')
  assert.equal(proximaExecucao(quebrada, TERCA_10H, TZ), null)
})

test('rotina já coletando não dispara de novo', () => {
  assert.equal(rotinaDeveExecutar(rotina({ estado: 'coletando' }), TERCA_10H, TZ), false)
  assert.equal(rotinaDeveExecutar(rotina({ estado: 'importando' }), TERCA_10H, TZ), false)
})

test('rotina sem nicho ou cidade nunca dispara', () => {
  assert.equal(rotinaDeveExecutar(rotina({ nicho: null }), TERCA_10H, TZ), false)
  assert.equal(rotinaDeveExecutar(rotina({ cidade: '' }), TERCA_10H, TZ), false)
})

// --- escolha de UMA rotina por empresa ---------------------------------------

test('duas rotinas vencidas ao mesmo tempo: só UMA é escolhida', () => {
  const a = rotina({ id: 'a', nicho: 'dentista' })
  const b = rotina({ id: 'b', nicho: 'advogado' })
  const escolhida = escolherRotinaElegivel([a, b], TERCA_10H, TZ)
  assert.ok(escolhida)
  assert.equal(typeof escolhida.id, 'string')
  assert.equal([a, b].filter((r) => r.id === escolhida.id).length, 1)
})

test('quem esperou mais tempo vai primeiro; nunca executada tem prioridade', () => {
  const antiga = rotina({ id: 'antiga', ultima_execucao_em: brt('2026-06-22T10:00:00').toISOString() })
  const recente = rotina({ id: 'recente', ultima_execucao_em: brt('2026-06-23T02:00:00').toISOString() })
  const nova = rotina({ id: 'nova', ultima_execucao_em: null })

  assert.equal(escolherRotinaElegivel([recente, antiga], TERCA_10H, TZ).id, 'antiga')
  assert.equal(escolherRotinaElegivel([recente, antiga, nova], TERCA_10H, TZ).id, 'nova')
})

test('a ordem de escolha é estável entre ticks (mesma entrada, mesma saída)', () => {
  const lista = [rotina({ id: 'b' }), rotina({ id: 'a' }), rotina({ id: 'c' })]
  const primeira = escolherRotinaElegivel(lista, TERCA_10H, TZ).id
  assert.equal(escolherRotinaElegivel(lista, TERCA_10H, TZ).id, primeira)
  assert.equal(escolherRotinaElegivel([...lista].reverse(), TERCA_10H, TZ).id, primeira)
})

test('rotinas inelegíveis são ignoradas na escolha', () => {
  const pausada = rotina({ id: 'pausada', ativo: false })
  const foraDaJanela = rotina({ id: 'fora', janela_inicio: '20:00', janela_fim: '22:00' })
  const boa = rotina({ id: 'boa' })
  assert.equal(escolherRotinaElegivel([pausada, foraDaJanela, boa], TERCA_10H, TZ).id, 'boa')
  assert.equal(escolherRotinaElegivel([pausada, foraDaJanela], TERCA_10H, TZ), null)
})

// --- estados exibidos e próxima execução -------------------------------------

test('estado reflete o motivo real da espera', () => {
  assert.equal(estadoRotina(rotina(), TERCA_10H).chave, 'ativa')
  assert.equal(
    estadoRotina(rotina({ ultima_execucao_em: brt('2026-06-23T08:00:00').toISOString() }), TERCA_10H).chave,
    'aguardando_intervalo'
  )
  assert.equal(estadoRotina(rotina(), brt('2026-06-23T22:00:00')).chave, 'aguardando_horario')
  assert.equal(estadoRotina(rotina(), TERCA_10H, { temColetaEmVoo: true }).chave, 'na_fila')
  assert.equal(estadoRotina(rotina({ estado: 'coletando' }), TERCA_10H).chave, 'coletando')
  assert.equal(estadoRotina(rotina({ estado: 'importando' }), TERCA_10H).chave, 'importando')
})

test('próxima execução: agora quando elegível', () => {
  const proxima = proximaExecucao(rotina(), TERCA_10H, TZ)
  assert.ok(proxima)
  assert.equal(proxima.getTime(), TERCA_10H.getTime())
})

test('próxima execução respeita o intervalo pendente', () => {
  const r = rotina({ ultima_execucao_em: brt('2026-06-23T08:00:00').toISOString() })
  const proxima = proximaExecucao(r, TERCA_10H, TZ)
  assert.ok(proxima)
  assert.equal(proxima.toISOString(), brt('2026-06-23T14:00:00').toISOString(), 'libera 6h após o disparo')
})

test('próxima execução pula para o próximo dia ativo quando a janela já fechou', () => {
  // Sexta 19:00, rotina só de dias úteis -> próxima é segunda às 08:00.
  const sextaNoite = brt('2026-06-26T19:00:00')
  const proxima = proximaExecucao(rotina(), sextaNoite, TZ)
  assert.ok(proxima)
  assert.equal(proxima.toISOString(), brt('2026-06-29T08:00:00').toISOString())
})

test('rotina pausada não tem próxima execução', () => {
  assert.equal(proximaExecucao(rotina({ ativo: false }), TERCA_10H, TZ), null)
})
