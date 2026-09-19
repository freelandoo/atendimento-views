'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const {
  VARIANTES_BOTAO, TAMANHOS_BOTAO, VARIANTE_BOTAO_PADRAO, TAMANHO_BOTAO_PADRAO,
  normalizarVarianteBotao, normalizarTamanhoBotao,
  classesBotao, estadoBotao, rotuloBotaoAcessivel, classesEntrada, classesCard,
} = require('./ui-primitivos')

test('as quatro variantes que o guia visual exige existem', () => {
  assert.deepEqual([...VARIANTES_BOTAO], ['primaria', 'secundaria', 'perigosa', 'neutra'])
  assert.deepEqual([...TAMANHOS_BOTAO], ['sm', 'md'])
})

test('variante e tamanho desconhecidos caem no padrao, sem quebrar a tela', () => {
  assert.equal(normalizarVarianteBotao('roxo'), VARIANTE_BOTAO_PADRAO)
  assert.equal(normalizarVarianteBotao(undefined), VARIANTE_BOTAO_PADRAO)
  assert.equal(normalizarTamanhoBotao('gigante'), TAMANHO_BOTAO_PADRAO)
  assert.ok(classesBotao({ variante: 'inexistente' }).includes('border-line-strong'))
})

test('cada variante tem tom proprio e todas herdam foco visivel e disabled', () => {
  const vistos = new Set()
  for (const v of VARIANTES_BOTAO) {
    const c = classesBotao({ variante: v })
    assert.ok(c.includes('focus-visible:ring-2'), `${v} sem anel de foco`)
    assert.ok(c.includes('disabled:opacity-50'), `${v} sem estado desabilitado`)
    assert.ok(c.includes('rounded-lg'), `${v} fora do raio do padrao`)
    vistos.add(c)
  }
  assert.equal(vistos.size, VARIANTES_BOTAO.length, 'duas variantes com as mesmas classes')
})

test('a geometria e a MEDIDA no codigo, nao uma invencao', () => {
  assert.ok(classesBotao({ tamanho: 'sm' }).includes('px-3 py-1.5'))
  assert.ok(classesBotao({ tamanho: 'sm' }).includes('text-xs'))
  assert.ok(classesBotao({ tamanho: 'md' }).includes('px-4 py-2'))
  assert.ok(classesBotao({ tamanho: 'md' }).includes('text-sm'))
})

test('larguraTotal e extra sao aditivos', () => {
  assert.ok(!classesBotao({}).includes('w-full'))
  assert.ok(classesBotao({ larguraTotal: true }).includes('w-full'))
  assert.ok(classesBotao({ extra: 'shrink-0' }).includes('shrink-0'))
})

test('carregando desabilita — o 2o clique durante um envio e' + "' o duplo disparo", () => {
  const e = estadoBotao({ carregando: true })
  assert.equal(e.desabilitado, true)
  assert.equal(e.ocupado, true)
})

test('o motivo so aparece quando o controle esta mesmo inativo', () => {
  assert.equal(estadoBotao({ motivoDesabilitado: 'sem permissao' }).titulo, undefined)
  assert.equal(
    estadoBotao({ desabilitado: true, motivoDesabilitado: 'sem permissao' }).titulo,
    'sem permissao',
  )
  assert.equal(estadoBotao({ desabilitado: true }).titulo, undefined)
})

test('o estado entra no rotulo acessivel: cor e spinner nao sao o unico sinal', () => {
  assert.equal(rotuloBotaoAcessivel({ rotulo: 'Salvar', carregando: true }), 'Salvar — em andamento')
  assert.equal(
    rotuloBotaoAcessivel({ rotulo: 'Ativar IA', motivoDesabilitado: 'sem permissao' }),
    'Ativar IA — indisponivel: sem permissao',
  )
  assert.equal(rotuloBotaoAcessivel({ rotulo: 'Salvar' }), 'Salvar')
  assert.equal(rotuloBotaoAcessivel({}), undefined)
})

test('entrada com erro muda a borda E mantem o foco visivel', () => {
  const ok = classesEntrada()
  const ruim = classesEntrada({ erro: true })
  assert.ok(ok.includes('border-line-strong'))
  assert.ok(ruim.includes('border-estado-danger'))
  assert.ok(ruim.includes('focus:ring-2'))
  assert.notEqual(ok, ruim)
})

test('card usa o raio e a sombra do padrao, e p-5 medido no produto', () => {
  const c = classesCard()
  assert.ok(c.includes('rounded-lg'))
  assert.ok(c.includes('shadow-card'))
  assert.ok(c.includes('border-line'))
  assert.ok(c.includes('p-5'))
  assert.ok(classesCard({ compacto: true }).includes('p-4'))
  assert.ok(!/\bp-[45]\b/.test(classesCard({ semPadding: true })))
})

test('guarda: o primitivo usa TOKEN, nunca literal slate-*/gray-*/blue-*', () => {
  const fonte = fs.readFileSync(require.resolve('./ui-primitivos'), 'utf8')
  const codigo = fonte.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  for (const proibido of [/\bslate-\d{2,3}\b/, /\bgray-\d{2,3}\b/, /\bblue-\d{2,3}\b/, /\bred-\d{2,3}\b/]) {
    assert.ok(!proibido.test(codigo), `literal proibido no primitivo: ${proibido}`)
  }
})

test('guarda: o primitivo nao carrega tema neon (ele e do tema claro)', () => {
  const fonte = fs.readFileSync(require.resolve('./ui-primitivos'), 'utf8')
  for (const neon of ['neon-', 'bg-panel', 'text-hi', 'text-mid', 'glass', 'shadow-glow']) {
    assert.ok(!fonte.includes(neon), `token neon vazou para o primitivo claro: ${neon}`)
  }
})
