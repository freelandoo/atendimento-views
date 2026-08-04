'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')

const { sugestaoParaRascunho, rascunhoParaAjustes, rotuloConfianca } = require('./aquisicao-sugestao')

test('sugestão de criar rotina vira rascunho novo, sempre pausado', () => {
  const r = sugestaoParaRascunho({
    tipo: 'criar_rotina', nicho: 'dentista', cidade: 'Campinas', uf: 'SP',
    parametros: { dias_semana: [1, 2, 3, 4, 5], janela_inicio: '08:00', janela_fim: '18:00', intervalo_horas: 24, quantidade: 200 },
  })
  assert.equal(r.id, undefined, 'criar não pode herdar id de rotina existente')
  assert.equal(r.nicho, 'dentista')
  assert.equal(r.intervalo_horas, 24)
  assert.equal(r.ativo, false)
})

// Regressão: a sugestão de ajuste só carrega o campo proposto. Sem o fallback para a
// rotina atual, aprovar um ajuste de intervalo apagaria dias, janela e volume.
test('sugestão de ajuste preserva o que a rotina já tinha', () => {
  const rotina = {
    id: 'rot-1', nicho: 'pet shop', cidade: 'Santos', uf: 'SP',
    dias_semana: [2, 4], janela_inicio: '10:00', janela_fim: '16:00',
    intervalo_horas: 12, quantidade: 50, ativo: true,
  }
  const r = sugestaoParaRascunho(
    { tipo: 'ajustar_rotina', rotina_id: 'rot-1', nicho: 'pet shop', cidade: 'Santos', uf: 'SP', parametros: { intervalo_horas: 24 } },
    rotina
  )
  assert.equal(r.id, 'rot-1')
  assert.equal(r.intervalo_horas, 24, 'aplica o que foi sugerido')
  assert.deepEqual(r.dias_semana, [2, 4], 'mantém os dias da rotina')
  assert.equal(r.janela_inicio, '10:00')
  assert.equal(r.quantidade, 50, 'não devolve o volume para o padrão')
  assert.equal(r.ativo, false)
})

test('sugestão sem parâmetros e sem rotina cai em padrões seguros', () => {
  const r = sugestaoParaRascunho({ tipo: 'criar_rotina', nicho: 'x', cidade: 'y' })
  assert.deepEqual(r.dias_semana, [1, 2, 3, 4, 5])
  assert.equal(r.intervalo_horas, 6)
  assert.equal(r.quantidade, 200)
})

test('ajustes enviados na aprovação vão limpos (UF em caixa alta, vazio vira null)', () => {
  const a = rascunhoParaAjustes({
    nicho: ' dentista ', cidade: ' Campinas ', uf: 'sp',
    dias_semana: [1], janela_inicio: '08:00', janela_fim: '18:00', intervalo_horas: 6, quantidade: 200, ativo: true,
  })
  assert.equal(a.nicho, 'dentista')
  assert.equal(a.uf, 'SP')
  assert.equal(a.ativo, undefined, 'a tela não decide ativação na aprovação')

  const semUf = rascunhoParaAjustes({
    nicho: 'a', cidade: 'b', uf: '  ', dias_semana: [1],
    janela_inicio: '08:00', janela_fim: '18:00', intervalo_horas: 6, quantidade: 200, ativo: false,
  })
  assert.equal(semUf.uf, null)
})

test('confiança é traduzida em linguagem simples', () => {
  assert.equal(rotuloConfianca(85), 'Confiança alta')
  assert.equal(rotuloConfianca(50), 'Confiança média')
  assert.equal(rotuloConfianca(20), 'Confiança baixa')
})
