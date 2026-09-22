'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const {
  VARIANTES_BOTAO, TAMANHOS_BOTAO, VARIANTE_BOTAO_PADRAO, TAMANHO_BOTAO_PADRAO,
  normalizarVarianteBotao, normalizarTamanhoBotao,
  classesBotao, estadoBotao, rotuloBotaoAcessivel, classesEntrada, classesCard,
  TAMANHOS_FOLHA, TAMANHO_FOLHA_PADRAO, normalizarTamanhoFolha,
  classesFundoFolha, classesFolha,
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

// --- Superficie flutuante --------------------------------------------------------------

test('a folha ancora EMBAIXO no celular e vira modal centrado a partir de sm', () => {
  const fundo = classesFundoFolha()
  assert.ok(fundo.includes('items-end'), 'no celular a folha sobe de baixo')
  assert.ok(fundo.includes('sm:items-center'), 'a partir de sm volta a ser modal centrado')
  assert.ok(fundo.includes('fixed inset-0'))
})

test('o raio so e do topo enquanto e folha, e fecha quando vira modal', () => {
  const c = classesFolha()
  assert.ok(c.includes('rounded-t-lg'))
  assert.ok(c.includes('sm:rounded-lg'))
})

test('a altura usa dvh, nunca vh: com vh a barra do navegador come o rodape', () => {
  const c = classesFolha()
  assert.ok(c.includes('dvh'), 'altura deve ser em dvh')
  assert.ok(!/\[\d+vh\]/.test(c), 'vh corta o rodape da folha no celular')
})

test('tamanho desconhecido cai no padrao em vez de quebrar a tela', () => {
  assert.equal(TAMANHO_FOLHA_PADRAO, 'md')
  assert.deepEqual([...TAMANHOS_FOLHA], ['sm', 'md', 'lg', 'xl'])
  assert.equal(normalizarTamanhoFolha('gigante'), 'md')
  assert.equal(normalizarTamanhoFolha(undefined), 'md')
  assert.equal(normalizarTamanhoFolha('lg'), 'lg')
})

test('a largura maxima so vale a partir de sm: no celular a folha ocupa a tela toda', () => {
  const c = classesFolha({ tamanho: 'lg' })
  assert.ok(c.includes('w-full'))
  assert.ok(c.includes('sm:max-w-['), 'a partir de sm existe teto de largura')
  assert.ok(!/(^|\s)max-w-/.test(c), 'largura maxima sem prefixo sm: estreitaria a folha no celular')
})

// ⚠️ O MODAL NUNCA OCUPA A TELA INTEIRA. Relatado pelo operador em 2026-09-22 ("parece que a
// pagina fica ocupando a tela inteirinha"): a pessoa precisa VER que a lista continua atras.
// O teto e' duplo de proposito — o `rem` da o tamanho confortavel, o `vw`/`dvh` garante a
// moldura em qualquer janela. Um teto so em `rem` nao segura janela estreita; um so em
// viewport da a mesma proporcao gigante em todo monitor.
test('o modal tem teto em REM e em VIEWPORT, nos dois eixos', () => {
  for (const tamanho of [...TAMANHOS_FOLHA]) {
    const c = classesFolha({ tamanho })
    const largura = c.match(/sm:max-w-\[min\((\d+)rem,(\d+)vw\)\]/)
    assert.ok(largura, `${tamanho}: largura precisa de teto rem + vw`)
    assert.ok(Number(largura[2]) <= 88, `${tamanho}: ${largura[2]}vw nao deixa moldura visivel`)
    const altura = c.match(/sm:max-h-\[min\((\d+)rem,(\d+)dvh\)\]/)
    assert.ok(altura, `${tamanho}: altura precisa de teto rem + dvh`)
    assert.ok(Number(altura[2]) <= 85, `${tamanho}: ${altura[2]}dvh e' a tela inteira`)
  }
})

test('a moldura escura CRESCE com a tela — 16px fixos nao se percebe', () => {
  const fundo = classesFundoFolha()
  assert.ok(/sm:p-[6-9]|sm:p-1\d/.test(fundo), 'a partir de sm a moldura passa de 16px')
  assert.ok(/lg:p-\d+/.test(fundo), 'em tela grande a moldura cresce de novo')
})

// A ficha do lead e' painel LATERAL justamente para preservar a lista atras dela; se ela
// ocupar a largura toda, nao preserva nada — vira o modal que ela existe para nao ser.
test('a ficha lateral tem largura fixa e teto de viewport', () => {
  const c = classesFolha({ lateral: true })
  assert.ok(/sm:w-\[\d+rem\]/.test(c), 'painel lateral tem largura propria')
  const teto = c.match(/sm:max-w-\[(\d+)vw\]/)
  assert.ok(teto && Number(teto[1]) <= 90, 'no celular deitado o painel nao pode cobrir tudo')
})

// ⚠️ A GUARDA MAIS IMPORTANTE DESTE ARQUIVO, e ela nao e' sobre estilo.
//
// Defeito medido em 2026-09-22: `tailwind.config.ts` varria `./lib/**/*.{ts,tsx}` e este
// modulo e' `.js`. Resultado — `sm:max-w-4xl`, `sm:max-h-[90dvh]` e `sm:w-[560px]` NUNCA
// foram gerados no CSS, entao TODO modal do produto renderizava sem largura e sem altura
// maxima e ocupava a tela inteira. O bug nao estava na medida: estava na extensao do glob.
//
// Vale para todos os modulos PUROS que decidem classe (`lead-icp.js`, `pontuacao-indicador.js`,
// `menu-radial.js`, `plano-dia.js`...), nao so para este.
test('o Tailwind VARRE os modulos puros .js de lib/ — senao as classes deles nao existem', () => {
  const cfg = fs.readFileSync(require('node:path').join(__dirname, '..', 'tailwind.config.ts'), 'utf8')
  const globs = [...cfg.matchAll(/'(\.\/[^']+)'/g)].map((m) => m[1])
  const daLib = globs.filter((g) => g.includes('lib/'))
  assert.ok(daLib.length, 'o content do Tailwind precisa cobrir lib/')
  assert.ok(
    daLib.some((g) => /\{[^}]*\bjs\b[^}]*\}|\.js$/.test(g)),
    `o glob de lib/ nao cobre .js (${daLib.join(', ')}) — as classes de ui-primitivos.js nao ` +
      'serao geradas e todo modal volta a ocupar a tela inteira',
  )
})
