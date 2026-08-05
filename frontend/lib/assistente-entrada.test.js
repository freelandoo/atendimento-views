'use strict'
// Fluxo guiado de entrada do Assistente de Oportunidades — regras puras.
//
// O que estes testes protegem, em ordem de importância:
//   1. contexto preservado — campo não escolhido nunca é apagado pela busca guiada;
//   2. nenhum beco sem saída — o passo de campos sempre pede o que falta para buscar;
//   3. a verdade sobre a sessão em andamento aparece no menu (não some silenciosamente);
//   4. a trava de uma coleta paga por vez é espelhada antes do clique.

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  OPCOES_AJUSTE,
  normalizarUf,
  normalizarMercado,
  camposVisiveis,
  mercadoResultante,
  validarMercado,
  mercadoMudou,
  rotuloMercado,
  opcoesDoMenu,
  proximoPasso,
} = require('./assistente-entrada')

const BASE = { nicho: 'Dentista', cidade: 'Campinas', uf: 'SP' }

test('normalizarUf aceita só duas letras e sempre em maiúscula', () => {
  assert.equal(normalizarUf('sp'), 'SP')
  assert.equal(normalizarUf(' rj '), 'RJ')
  assert.equal(normalizarUf('SAO'), '')
  assert.equal(normalizarUf(''), '')
  assert.equal(normalizarUf(null), '')
  assert.equal(normalizarUf(12), '')
})

test('normalizarMercado limpa espaços e não inventa campo', () => {
  assert.deepEqual(normalizarMercado({ nicho: '  Padaria ', cidade: ' Santos', uf: 'sp' }),
    { nicho: 'Padaria', cidade: 'Santos', uf: 'SP' })
  assert.deepEqual(normalizarMercado(), { nicho: '', cidade: '', uf: '' })
})

test('as três opções de mudança são exatamente as pedidas', () => {
  assert.deepEqual(OPCOES_AJUSTE.map((o) => o.id), ['nicho', 'localidade', 'ambos'])
})

test('camposVisiveis abre só o que a pessoa escolheu mudar', () => {
  assert.deepEqual(camposVisiveis('nicho', BASE), ['nicho'])
  assert.deepEqual(camposVisiveis('localidade', BASE), ['cidade', 'uf'])
  assert.deepEqual(camposVisiveis('ambos', BASE), ['nicho', 'cidade', 'uf'])
  assert.deepEqual(camposVisiveis('inexistente', BASE), [])
})

test('camposVisiveis também pede o que falta — sem beco sem saída', () => {
  // Quer trocar só o nicho, mas a cidade nunca foi preenchida: a cidade entra junto,
  // senão a validação barraria com um campo que a tela nem mostrou.
  assert.deepEqual(camposVisiveis('nicho', { nicho: 'Dentista', cidade: '', uf: '' }),
    ['nicho', 'cidade', 'uf'])
  assert.deepEqual(camposVisiveis('localidade', { nicho: '', cidade: 'Campinas', uf: 'SP' }),
    ['nicho', 'cidade', 'uf'])
})

test('mercadoResultante preserva o que não foi editado', () => {
  assert.deepEqual(mercadoResultante(BASE, { nicho: 'Padaria' }, 'nicho'),
    { nicho: 'Padaria', cidade: 'Campinas', uf: 'SP' })
  assert.deepEqual(mercadoResultante(BASE, { cidade: 'Santos', uf: 'SP' }, 'localidade'),
    { nicho: 'Dentista', cidade: 'Santos', uf: 'SP' })
  assert.deepEqual(mercadoResultante(BASE, { nicho: 'Padaria', cidade: 'Santos', uf: 'RJ' }, 'ambos'),
    { nicho: 'Padaria', cidade: 'Santos', uf: 'RJ' })
})

test('mercadoResultante ignora campo que a tela não mostrou', () => {
  // Só o nicho está em jogo: uma cidade que ficou pendurada no rascunho não vaza.
  assert.deepEqual(mercadoResultante(BASE, { nicho: 'Padaria', cidade: 'Lixo' }, 'nicho'),
    { nicho: 'Padaria', cidade: 'Campinas', uf: 'SP' })
})

test('validarMercado espelha a exigência do backend (nicho + cidade)', () => {
  assert.equal(validarMercado(BASE), null)
  assert.equal(validarMercado({ nicho: '', cidade: 'Campinas' }), 'Informe o nicho que você quer buscar.')
  assert.equal(validarMercado({ nicho: 'Dentista', cidade: '  ' }), 'Informe a cidade da busca.')
  // UF continua opcional: buscar sem UF é permitido.
  assert.equal(validarMercado({ nicho: 'Dentista', cidade: 'Campinas', uf: '' }), null)
})

test('mercadoMudou reconhece repetição (não gasta coleta à toa)', () => {
  assert.equal(mercadoMudou(BASE, { nicho: 'dentista', cidade: 'campinas', uf: 'SP' }), false)
  assert.equal(mercadoMudou(BASE, { nicho: 'Padaria', cidade: 'Campinas', uf: 'SP' }), true)
  assert.equal(mercadoMudou(BASE, { nicho: 'Dentista', cidade: 'Campinas', uf: 'RJ' }), true)
})

test('rotuloMercado fala a língua do operador', () => {
  assert.equal(rotuloMercado(BASE), 'Dentista · Campinas - SP')
  assert.equal(rotuloMercado({ nicho: 'Dentista', cidade: 'Campinas' }), 'Dentista · Campinas')
  assert.equal(rotuloMercado({ nicho: 'Dentista' }), 'Dentista')
  assert.equal(rotuloMercado({}), 'toda a sua carteira')
})

test('menu sem sessão: revisar abre uma nova, buscar liberado', () => {
  const m = opcoesDoMenu({ sessao: null, coletaEmAndamento: false, mercadoAtual: BASE })
  assert.equal(m.revisar.disponivel, true)
  assert.equal(m.revisar.retomando, false)
  assert.equal(m.revisar.label, 'Revisar oportunidades encontradas')
  assert.match(m.revisar.descricao, /Dentista · Campinas - SP/)
  assert.equal(m.buscar.disponivel, true)
})

test('menu com sessão ativa: diz o mercado e o progresso reais', () => {
  const sessao = {
    id: 's1', nicho: 'Padaria', cidade: 'Santos', uf: 'SP',
    escopo_ampliado: false, meta: 10, aprovados: 3, descartados: 1, status: 'ativa',
  }
  const m = opcoesDoMenu({ sessao, coletaEmAndamento: false, mercadoAtual: BASE })
  assert.equal(m.revisar.retomando, true)
  assert.equal(m.revisar.label, 'Retomar a revisão em andamento')
  // O mercado mostrado é o DA SESSÃO, não o que está digitado na busca: pedir outro
  // mercado não troca a sessão aberta, e a tela não pode mentir sobre isso.
  assert.match(m.revisar.descricao, /Padaria · Santos - SP/)
  assert.match(m.revisar.descricao, /3 de 10 aprovados/)
})

test('menu com sessão ampliada mostra a carteira inteira', () => {
  const sessao = {
    id: 's1', nicho: 'Padaria', cidade: 'Santos', uf: 'SP',
    escopo_ampliado: true, meta: 5, aprovados: 0, descartados: 0, status: 'ativa',
  }
  const m = opcoesDoMenu({ sessao, coletaEmAndamento: false })
  assert.match(m.revisar.descricao, /toda a sua carteira/)
})

test('sessão já encerrada não conta como em andamento', () => {
  const sessao = { id: 's1', nicho: 'X', cidade: 'Y', uf: null, escopo_ampliado: false, meta: 5, aprovados: 5, descartados: 0, status: 'concluida' }
  assert.equal(opcoesDoMenu({ sessao }).revisar.retomando, false)
})

test('coleta em andamento bloqueia a busca guiada e explica por quê', () => {
  const m = opcoesDoMenu({ sessao: null, coletaEmAndamento: true, mercadoAtual: BASE })
  assert.equal(m.buscar.disponivel, false)
  assert.match(m.buscar.descricao, /coleta em andamento/i)
  // Revisar continua livre: analisar não depende de coleta.
  assert.equal(m.revisar.disponivel, true)
})

test('proximoPasso percorre e volta pelo fluxo guiado', () => {
  assert.equal(proximoPasso('escolha', 'revisar'), 'revisar')
  assert.equal(proximoPasso('escolha', 'buscar'), 'o_que_mudar')
  assert.equal(proximoPasso('o_que_mudar', 'localidade'), 'campos')
  assert.equal(proximoPasso('o_que_mudar', 'voltar'), 'escolha')
  assert.equal(proximoPasso('campos', 'buscou'), 'iniciada')
  assert.equal(proximoPasso('campos', 'voltar'), 'o_que_mudar')
  assert.equal(proximoPasso('iniciada', 'voltar'), 'escolha')
})

test('proximoPasso nunca trava em ação ou passo desconhecido', () => {
  assert.equal(proximoPasso('escolha', 'xpto'), 'escolha')
  assert.equal(proximoPasso('o_que_mudar', 'xpto'), 'o_que_mudar')
  assert.equal(proximoPasso('passo_que_nao_existe', 'buscar'), 'escolha')
})
