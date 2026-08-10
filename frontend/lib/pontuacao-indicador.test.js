'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
  VARIANTES, PALETAS, CLASSE_SEM_VALOR, NOTA_COMPLETUDE, O_QUE_MEDE,
  normalizarFaixa, normalizarValor, classesDaBolinha, textoValor, resumoTextual,
  fatoresDeCadastro, fatoresDeInteresse, fatoresDeMotivos, leituraCadastro,
} = require('./pontuacao-indicador')

// ─── Variante PRIORIDADE COMERCIAL ────────────────────────────────────────────

test('prioridade: emerald e a MELHOR faixa, nas duas grafias de tela', () => {
  // Ligacoes fala 'alta'; Mensagens fala 'alto'. Sao a mesma faixa — se a segunda caisse no
  // default, a Central de Mensagens pintaria interesse alto de cinza.
  const ligacoes = classesDaBolinha(VARIANTES.PRIORIDADE, 'alta', 80)
  const mensagens = classesDaBolinha(VARIANTES.PRIORIDADE, 'alto', 80)
  assert.equal(ligacoes, mensagens)
  assert.match(ligacoes, /emerald/)
  assert.match(classesDaBolinha(VARIANTES.PRIORIDADE, 'medio', 50), /amber/)
  assert.match(classesDaBolinha(VARIANTES.PRIORIDADE, 'baixo', 10), /slate/)
})

test('prioridade: a paleta da Central de Ligacoes foi preservada classe a classe', () => {
  // Guarda de regressao da extracao: a Central de Ligacoes nao podia mudar de aparencia.
  assert.equal(PALETAS[VARIANTES.PRIORIDADE].alta, 'border-emerald-500 text-emerald-700 bg-emerald-50')
  assert.equal(PALETAS[VARIANTES.PRIORIDADE].media, 'border-amber-400 text-amber-700 bg-amber-50')
  assert.equal(PALETAS[VARIANTES.PRIORIDADE].baixa, 'border-slate-300 text-slate-500 bg-slate-50')
})

test('faixa desconhecida cai na MENOR faixa, nunca na maior', () => {
  // Inventar prioridade alta por engano manda o operador trabalhar o lead errado.
  assert.equal(classesDaBolinha(VARIANTES.PRIORIDADE, 'lixo', 50), PALETAS[VARIANTES.PRIORIDADE].baixa)
  assert.equal(classesDaBolinha(VARIANTES.COMPLETUDE, 'lixo', 50), PALETAS[VARIANTES.COMPLETUDE].incompleto)
  assert.equal(normalizarFaixa(VARIANTES.PRIORIDADE, 'completo'), null)
  assert.equal(normalizarFaixa(VARIANTES.COMPLETUDE, 'alta'), null)
})

// ─── Variante COMPLETUDE DE CADASTRO ──────────────────────────────────────────

test('completude NAO reusa a paleta de prioridade comercial', () => {
  // Este e o teste que existe por causa do defeito corrigido: o melhor lead da campanha
  // (cadastro fraco) aparecia em VERMELHO, e o pior aparecia em verde.
  const classes = Object.values(PALETAS[VARIANTES.COMPLETUDE]).join(' ')
  assert.doesNotMatch(classes, /emerald|red|amber/)
  for (const faixa of ['completo', 'parcial', 'incompleto']) {
    assert.notEqual(
      classesDaBolinha(VARIANTES.COMPLETUDE, faixa, 50),
      classesDaBolinha(VARIANTES.PRIORIDADE, 'alta', 50)
    )
  }
})

test('completude: os cortes sao PROPORCIONais, entao 30/60 le igual a 50/100', () => {
  // Instagram vale ate 60. Sem proporcao, 30/60 (metade) cairia em "incompleto" e 50/100
  // (metade) em "parcial" — a mesma completude com dois nomes.
  assert.equal(leituraCadastro(50, 100).faixa, 'parcial')
  assert.equal(leituraCadastro(30, 60).faixa, 'parcial')
  assert.equal(leituraCadastro(80, 100).faixa, 'completo')
  assert.equal(leituraCadastro(48, 60).faixa, 'completo')
  assert.equal(leituraCadastro(20, 100).faixa, 'incompleto')
  assert.equal(leituraCadastro(12, 60).faixa, 'incompleto')
})

test('completude: o titulo conta as lacunas e nunca diz "alta"/"baixa"', () => {
  const criterios = [
    { label: 'Tem telefone', ok: true, pontos_possiveis: 10 },
    { label: 'Tem site próprio', ok: false, pontos_possiveis: 20 },
    { label: 'Tem e-mail', ok: false, pontos_possiveis: 10 },
  ]
  const r = leituraCadastro(10, 100, criterios)
  assert.equal(r.lacunas, 2)
  assert.equal(r.titulo, 'Cadastro incompleto · 2 lacunas')
  assert.doesNotMatch(r.titulo, /alta|baixa|alto|baixo/i)
  assert.equal(leituraCadastro(100, 100, [{ label: 'x', ok: true }]).titulo, 'Cadastro completo')
  assert.equal(leituraCadastro(30, 100, [{ label: 'x', ok: false }]).titulo, 'Cadastro incompleto · 1 lacuna')
})

test('completude tem nota fixa que impede a bolinha de mentir', () => {
  assert.match(NOTA_COMPLETUDE, /oportunidade/i)
})

// ─── Valor, maximo e estado "nao calculada" ───────────────────────────────────

test('o MAXIMO e sempre exibido — 30/60 nunca vira 30/100', () => {
  assert.equal(textoValor(30, 60), '30/60')
  assert.equal(textoValor(40, 100), '40/100')
})

test('sem pontuacao e um estado proprio: bolinha vazada, nunca zero', () => {
  assert.equal(normalizarValor(null), null)
  assert.equal(normalizarValor(undefined), null)
  assert.equal(normalizarValor(NaN), null)
  assert.equal(textoValor(null), 'nao calculada')
  assert.equal(classesDaBolinha(VARIANTES.PRIORIDADE, 'alta', null), CLASSE_SEM_VALOR)
  assert.equal(classesDaBolinha(VARIANTES.COMPLETUDE, 'completo', null), CLASSE_SEM_VALOR)
  assert.equal(leituraCadastro(null, 100).faixa, null)
  assert.equal(leituraCadastro(null, 100).titulo, 'Cadastro não avaliado')
})

test('valor e limitado ao intervalo do proprio maximo', () => {
  assert.equal(normalizarValor(-5, 100), 0)
  assert.equal(normalizarValor(140, 100), 100)
  assert.equal(normalizarValor(99, 60), 60)
  assert.equal(normalizarValor(72.4, 100), 72)
})

// ─── Tradutores de fatores ────────────────────────────────────────────────────

test('cadastro: a lacuna aparece com quanto ela valeria', () => {
  const f = fatoresDeCadastro([
    { label: 'Tem telefone', ok: true, pontos: 10, pontos_possiveis: 10 },
    { label: 'Tem site próprio', ok: false, pontos: 0, pontos_possiveis: 20 },
  ])
  assert.deepEqual(f[0], { rotulo: 'Tem telefone', peso: '✓', sinal: 'positivo' })
  assert.deepEqual(f[1], { rotulo: 'Tem site próprio', peso: '✗ (+20)', sinal: 'ausente' })
})

test('interesse: o delta NEGATIVO sobrevive a traducao', () => {
  // E' o que separa "38 porque nunca engajou" de "38 porque engajou e depois recusou" — o
  // resumo de uma linha do badge antigo escondia exatamente isso.
  const f = fatoresDeInteresse([
    { delta: 25, titulo: 'Indicou próximo passo' },
    { delta: -45, titulo: 'Recusou', detalhe: 'não tenho interesse' },
    { delta: 0, titulo: 'Neutro' },
  ])
  assert.equal(f[0].peso, '+25')
  assert.equal(f[0].sinal, 'positivo')
  assert.equal(f[1].peso, '−45')
  assert.equal(f[1].sinal, 'negativo')
  assert.equal(f[1].detalhe, 'não tenho interesse')
  assert.equal(f[2].sinal, 'neutro')
})

test('motivos da prioridade viram fatores sem peso', () => {
  const f = fatoresDeMotivos(['Sem site próprio', '  ', null, 'Nunca foi tentado'])
  assert.equal(f.length, 2)
  assert.deepEqual(f[0], { rotulo: 'Sem site próprio', sinal: 'neutro' })
})

test('tradutores aceitam entrada ausente sem quebrar a tela', () => {
  assert.deepEqual(fatoresDeCadastro(null), [])
  assert.deepEqual(fatoresDeInteresse(undefined), [])
  assert.deepEqual(fatoresDeMotivos('nao e array'), [])
})

// ─── Resumo textual (aria-label) ──────────────────────────────────────────────

test('o resumo textual carrega TUDO o que o tooltip mostra', () => {
  // O leitor de tela nao "ve" o balao: o aria-label e' o unico caminho ate esse conteudo.
  const texto = resumoTextual({
    titulo: 'Cadastro incompleto · 2 lacunas',
    valor: 40,
    maximo: 100,
    oQueMede: O_QUE_MEDE.cadastro_places,
    fatores: fatoresDeCadastro([
      { label: 'Tem telefone', ok: true, pontos_possiveis: 10 },
      { label: 'Tem site próprio', ok: false, pontos_possiveis: 20 },
    ]),
    nota: NOTA_COMPLETUDE,
  })
  assert.match(texto, /Cadastro incompleto · 2 lacunas/)
  assert.match(texto, /40\/100/)
  assert.match(texto, /presença digital/)
  assert.match(texto, /Tem site próprio/)
  assert.match(texto, /oportunidade/)
})

test('resumo de bolinha sem pontuacao diz que nao foi calculada', () => {
  const texto = resumoTextual({ titulo: 'Prioridade', valor: null, oQueMede: O_QUE_MEDE.prioridade_ligacao })
  assert.match(texto, /nao calculada/)
})

test('cada contexto de tela tem a sua frase de "o que mede"', () => {
  // Duas telas com a mesma bolinha nao podem parecer medir a mesma coisa.
  const frases = Object.values(O_QUE_MEDE)
  assert.equal(new Set(frases).size, frases.length)
  assert.ok(frases.every((f) => f.length > 20))
})

// ─── Guarda de regressao: a regra nao pode voltar para as telas ───────────────

test('as telas nao reimplementam a paleta da bolinha', () => {
  // Foi a duplicacao em 3 telas que produziu paleta divergente e acessibilidade desigual.
  // Se alguem recriar o circulo inline, este teste falha e diz por que.
  const raiz = path.join(__dirname, '..')
  const alvos = [
    'app/dashboard/central-ligacoes/page.tsx',
    'app/dashboard/conversas/page.tsx',
    'app/dashboard/prospeccao/page.tsx',
    'app/dashboard/banco-leads/page.tsx',
    'components/ConversaPainel.tsx',
  ]
  for (const alvo of alvos) {
    const fonte = fs.readFileSync(path.join(raiz, alvo), 'utf8')
    assert.doesNotMatch(
      fonte,
      /h-9 w-9[^`'"]*rounded-full border-2/,
      `${alvo} voltou a desenhar a bolinha inline — use components/ui/BolinhaPontuacao.tsx`
    )
  }
})

test('a completude nao e pintada com a paleta de prioridade nas telas de lead', () => {
  // O defeito original: `score_cadastro <= 40 ? text-red-600 : ... text-emerald-600`, ou seja,
  // vermelho no melhor lead da campanha.
  const raiz = path.join(__dirname, '..')
  for (const alvo of ['app/dashboard/prospeccao/page.tsx', 'app/dashboard/banco-leads/page.tsx']) {
    const fonte = fs.readFileSync(path.join(raiz, alvo), 'utf8')
    assert.doesNotMatch(
      fonte,
      /score_cadastro[^\n]*text-(red|emerald)-/,
      `${alvo} voltou a usar cor de prioridade comercial para completude de cadastro`
    )
  }
})

// ─── O site DENTRO da pontuação de cadastro ──────────────────────────────────
// A coluna "Site" saiu da Aquisição e do Banco de Leads (decisão do operador em 2026-08-10).
// A partir daí, este balão é o único lugar da tabela onde a tese comercial da operação é
// lida — então ele precisa carregar as TRÊS situações, não o booleano do critério.

const CRIT_SITE_AUSENTE = [
  { chave: 'site', label: 'Tem site próprio', ok: false, pontos: 0, pontos_possiveis: 20 },
]

test('sem contexto, o critério de site continua exatamente como era', () => {
  // Compatibilidade: quem não passa o 2º argumento não muda de comportamento.
  assert.equal(fatoresDeCadastro(CRIT_SITE_AUSENTE)[0].rotulo, 'Tem site próprio')
})

test('"não tem site" e "ninguém verificou" deixam de ser a mesma frase', () => {
  // É a distinção que o critério booleano do backend não carrega, e que a coluna removida
  // mostrava. Confundir as duas é um defeito com história neste projeto.
  const semSite = fatoresDeCadastro(CRIT_SITE_AUSENTE, { situacaoSite: 'sem_site' })[0]
  const naoVerificado = fatoresDeCadastro(CRIT_SITE_AUSENTE, { situacaoSite: 'nao_identificado' })[0]
  assert.equal(semSite.rotulo, 'Sem site próprio')
  assert.equal(naoVerificado.rotulo, 'Site não verificado')
  assert.notEqual(semSite.rotulo, naoVerificado.rotulo)
})

test('o balão diz o que existe NO LUGAR do site', () => {
  const f = fatoresDeCadastro(CRIT_SITE_AUSENTE, { situacaoSite: 'sem_site', rotuloLink: 'rede social' })[0]
  assert.equal(f.rotulo, 'Sem site próprio — só rede social',
    'é o que explica por que um lead COM link aparece como sem site')
})

test('"não verificado" não repete o rótulo do link', () => {
  // `rotuloLink('desconhecido')` é literalmente "verificar" — anexá-lo diria a mesma coisa duas vezes.
  const f = fatoresDeCadastro(CRIT_SITE_AUSENTE, { situacaoSite: 'nao_identificado', rotuloLink: 'verificar' })[0]
  assert.equal(f.rotulo, 'Site não verificado')
})

test('o peso e o sinal do critério não mudam — só o rótulo ficou mais preciso', () => {
  const f = fatoresDeCadastro(CRIT_SITE_AUSENTE, { situacaoSite: 'sem_site' })[0]
  assert.equal(f.peso, '✗ (+20)')
  assert.equal(f.sinal, 'ausente')
})

test('o contexto de site NÃO vaza para os outros critérios', () => {
  const f = fatoresDeCadastro(
    [{ chave: 'email', label: 'Tem e-mail', ok: false, pontos_possiveis: 10 }],
    { situacaoSite: 'sem_site', rotuloLink: 'rede social' },
  )[0]
  assert.equal(f.rotulo, 'Tem e-mail')
})

test('a coluna "Site" não voltou para a Aquisição nem para o Banco de Leads', () => {
  // Guarda de regressão: a informação agora vive na pontuação de cadastro (balão) e em
  // "Detalhes". Reintroduzir a coluna duplicaria o mesmo dado em dois lugares da mesma linha.
  for (const alvo of ['app/dashboard/prospeccao/page.tsx', 'app/dashboard/banco-leads/page.tsx']) {
    const src = fs.readFileSync(path.join(__dirname, '..', alvo), 'utf8')
    assert.doesNotMatch(src, /label="Site"\s+chave="site"/,
      `${alvo} voltou a ter a coluna Site — ela agora é um fator da pontuação de cadastro`)
  }
})
