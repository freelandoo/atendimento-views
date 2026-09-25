const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  COLUNAS, CHAVES, montarColunas, aoMoverPara, seloConclusao, seloOrigemEntrada,
  horarioDoCard, resumoDoDia, avisoPendentes, rotuloDia, somarDias, diasDaSemana,
  rotuloDiaCurto, rotuloSemana, resumoDoPeriodo, opcoesNicho, opcoesCidade, opcoesRegiao,
  opcoesCategoria, opcoesPais, filtrarCarteira,
} = require('./plano-dia')

const fonte = fs.readFileSync(path.join(__dirname, 'plano-dia.js'), 'utf8')
const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// ── Anti-drift com o backend ─────────────────────────────────────────────────
test('as colunas espelham as etapas do backend, na mesma ordem', () => {
  const backend = fs.readFileSync(
    path.join(__dirname, '..', '..', 'backend', 'src', 'services', 'plano-dia.js'), 'utf8')
  const m = backend.match(/const ETAPAS = Object\.freeze\(\[([^\]]*)\]\)/)
  assert.ok(m, 'nao achei ETAPAS no backend')
  const doBackend = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
  assert.deepEqual(CHAVES, doBackend, 'coluna nova exige os dois lados no mesmo diff')
})

// ── Cada coluna DIZ o que o movimento nao faz ────────────────────────────────
test('toda coluna declara titulo, resumo e CONSEQUENCIA', () => {
  for (const c of COLUNAS) {
    assert.ok(c.titulo.trim())
    assert.ok(c.resumo.trim())
    assert.ok(c.consequencia.trim(), `${c.chave} nao diz o que o movimento (nao) faz`)
  }
})

test('"Feito hoje" nega explicitamente que seja venda fechada', () => {
  const feito = COLUNAS.find((c) => c.chave === 'feito')
  assert.ok(/venda fechada/i.test(feito.consequencia))
  assert.ok(/descarta|fecha/i.test(feito.consequencia))
})

test('"Para hoje" nega que assuma lead ou envie mensagem', () => {
  const c = COLUNAS.find((x) => x.chave === 'para_hoje')
  assert.ok(/assume/i.test(c.consequencia) && /envia/i.test(c.consequencia))
})

// ── Montagem ─────────────────────────────────────────────────────────────────
test('montarColunas distribui os cards e nao perde nenhum', () => {
  const itens = [
    { id: '1', etapa: 'para_hoje' }, { id: '2', etapa: 'feito' }, { id: '3', etapa: 'para_hoje' },
  ]
  const cols = montarColunas(itens)
  assert.equal(cols.length, 4)
  assert.equal(cols[0].cards.length, 2)
  assert.equal(cols[3].cards.length, 1)
  assert.equal(cols.reduce((s, c) => s + c.cards.length, 0), 3)
})

test('montarColunas aguenta entrada vazia ou invalida', () => {
  for (const v of [null, undefined, []]) {
    assert.equal(montarColunas(v).reduce((s, c) => s + c.cards.length, 0), 0)
  }
})

// ── O aviso ANTES do arraste ─────────────────────────────────────────────────
test('so "Feito hoje" avisa que vai cobrar evidencia', () => {
  assert.equal(aoMoverPara('feito').exigeEvidencia, true)
  for (const c of ['para_hoje', 'em_trabalho', 'aguardando_retorno']) {
    assert.equal(aoMoverPara(c).exigeEvidencia, false)
  }
})

test('coluna desconhecida nao passa', () => {
  assert.equal(aoMoverPara('arquivado').ok, false)
})

// ── Autodeclaracao nunca vira prova ──────────────────────────────────────────
test('o selo distingue evidencia de autodeclaracao, em TEXTO', () => {
  const auto = seloConclusao({ conclusao_tipo: 'autodeclarada' })
  const reg = seloConclusao({ conclusao_tipo: 'atividade_registrada' })
  assert.equal(auto.prova, false)
  assert.equal(reg.prova, true)
  assert.notEqual(auto.rotulo, reg.rotulo)
  assert.equal(seloConclusao({ conclusao_tipo: null }), null, 'card em aberto nao tem selo')
  assert.equal(seloConclusao(null), null)
})

test('escolha manual NAO vira selo — ela e o caso normal', () => {
  assert.equal(seloOrigemEntrada('escolha_manual'), null)
  assert.ok(seloOrigemEntrada('sugestao_vencidos'))
  assert.ok(seloOrigemEntrada('sugestao_agenda'))
})

// ── Horario e resumo ─────────────────────────────────────────────────────────
test('sem agendamento nao se inventa horario', () => {
  assert.equal(horarioDoCard({}, () => '10:00'), '')
  assert.equal(horarioDoCard(null), '')
  assert.equal(horarioDoCard({ proximo_agendamento: 'x' }, () => '10:00'), '10:00')
})

test('o resumo conta CARDS do dia, nao carteira', () => {
  const r = resumoDoDia([{ etapa: 'feito' }, { etapa: 'para_hoje' }, { etapa: 'para_hoje' }])
  assert.equal(r.total, 3)
  assert.equal(r.porColuna.feito, 1)
  assert.ok(r.texto.includes('1 de 3'))
})

test('dia vazio tem frase propria, nao "0 de 0"', () => {
  assert.ok(/nenhum lead/i.test(resumoDoDia([]).texto))
})

// ── Pendencias ───────────────────────────────────────────────────────────────
test('sem pendencia nao ha aviso; com pendencia o texto e a acao sao explicitos', () => {
  assert.equal(avisoPendentes([]), null)
  assert.equal(avisoPendentes(null), null)
  const a = avisoPendentes([{}, {}])
  assert.equal(a.total, 2)
  assert.ok(a.acao.includes('2'))
})

test('rotuloDia diz "Hoje" so quando e hoje', () => {
  assert.equal(rotuloDia('2026-09-22', '2026-09-22'), 'Hoje')
  assert.equal(rotuloDia('2026-09-21', '2026-09-22'), '21/09/2026')
  assert.equal(rotuloDia(null, '2026-09-22'), '')
})

test('diasDaSemana monta contexto de segunda a domingo', () => {
  assert.deepEqual(diasDaSemana('2026-09-23'), [
    '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24',
    '2026-09-25', '2026-09-26', '2026-09-27',
  ])
  assert.deepEqual(diasDaSemana('2026-09-27'), [
    '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24',
    '2026-09-25', '2026-09-26', '2026-09-27',
  ])
  assert.deepEqual(diasDaSemana('data'), [])
})

test('rotulos curtos destacam ontem, hoje e amanha', () => {
  assert.equal(somarDias('2026-09-23', -1), '2026-09-22')
  assert.equal(rotuloDiaCurto('2026-09-22', '2026-09-23'), 'Ontem')
  assert.equal(rotuloDiaCurto('2026-09-23', '2026-09-23'), 'Hoje')
  assert.equal(rotuloDiaCurto('2026-09-24', '2026-09-23'), 'Amanhã')
  assert.equal(rotuloDiaCurto('2026-09-25', '2026-09-23'), 'sex 25/09')
})

test('resumoDoPeriodo preenche dias sem linha e preserva contagens', () => {
  const dias = ['2026-09-21', '2026-09-22', '2026-09-23']
  const r = resumoDoPeriodo([
    { dia: '2026-09-22', total: '3', feitos: '1', abertos: '2', para_hoje: '2', em_trabalho: '1' },
  ], dias)
  assert.equal(r.length, 3)
  assert.equal(r[0].total, 0)
  assert.equal(r[1].feitos, 1)
  assert.equal(r[1].abertos, 2)
  assert.equal(r[2].total, 0)
})

test('rotuloSemana descreve a faixa sem virar quadro semanal', () => {
  assert.equal(rotuloSemana(['2026-09-21', '2026-09-27']), 'Semana de 21/09 a 27/09')
  assert.equal(rotuloSemana([]), '')
})

// ── Planejar meu dia: nicho + busca ──────────────────────────────────────────
test('opcoesNicho agrupa, conta e ordena por frequencia (depois alfabetica)', () => {
  const r = opcoesNicho([
    { nicho: 'Estetica' }, { nicho: 'Energia Solar' }, { nicho: 'Energia Solar' },
    { nicho: '  ' }, { nicho: null }, {},
  ])
  assert.deepEqual(r, [
    { valor: 'Energia Solar', total: 2 },
    { valor: 'Estetica', total: 1 },
  ])
  assert.deepEqual(opcoesNicho(null), [])
})

test('opcoesCidade e opcoesRegiao usam so dados carregados da carteira', () => {
  const c = [
    { cidade: 'Goiânia', regiao: 'Centro' },
    { cidade: 'Goiânia', bairro: 'Centro' },
    { cidade: 'Anápolis', uf: 'GO' },
    { cidade: '', regiao: '  ' },
  ]
  assert.deepEqual(opcoesCidade(c), [
    { valor: 'Goiânia', total: 2 },
    { valor: 'Anápolis', total: 1 },
  ])
  assert.deepEqual(opcoesRegiao(c), [
    { valor: 'Centro', total: 2 },
    { valor: 'GO', total: 1 },
  ])
})

test('opcoesCategoria e opcoesPais agrupam a carteira carregada', () => {
  const c = [
    { categoria_perfil: 'Solar Energy Company', pais: 'br' },
    { categoria: 'Solar Energy Company', pais: 'BR' },
    { classificacao_url: 'Clínica', country: 'PT' },
    { categoria_perfil: '  ', pais: '' },
  ]
  assert.deepEqual(opcoesCategoria(c), [
    { valor: 'Solar Energy Company', total: 2 },
    { valor: 'Clínica', total: 1 },
  ])
  assert.deepEqual(opcoesPais(c), [
    { valor: 'BR', total: 2 },
    { valor: 'PT', total: 1 },
  ])
})

test('filtrarCarteira exclui quem ja esta no dia', () => {
  const r = filtrarCarteira([{ id: '1' }, { id: '2' }], { jaNoDia: new Set(['1']) })
  assert.deepEqual(r.map((c) => c.id), ['2'])
})

test('filtrarCarteira recorta por nicho, categoria, pais e combina com a busca', () => {
  const c = [
    { id: '1', nome: 'Sol Forte', nicho: 'Energia Solar', categoria_perfil: 'Solar Energy Company', pais: 'BR', cidade: 'Goiânia', regiao: 'Sul' },
    { id: '2', nome: 'Sol Nascente', nicho: 'Estetica', categoria_perfil: 'Clinic', pais: 'BR', cidade: 'Goiânia', bairro: 'Centro' },
    { id: '3', nome: 'Luz Verde', nicho: 'Energia Solar', categoria_perfil: 'Instalador', pais: 'PT', telefone: '5562999990000', cidade: 'Anápolis', uf: 'GO' },
  ]
  assert.deepEqual(filtrarCarteira(c, { nicho: 'Energia Solar' }).map((l) => l.id), ['1', '3'])
  assert.deepEqual(filtrarCarteira(c, { nicho: 'Energia Solar', busca: 'sol' }).map((l) => l.id), ['1', '3'])
  assert.deepEqual(filtrarCarteira(c, { nicho: 'Energia Solar', busca: 'forte' }).map((l) => l.id), ['1'])
  assert.deepEqual(filtrarCarteira(c, { busca: '99999' }).map((l) => l.id), ['3'])
  assert.deepEqual(filtrarCarteira(c, { busca: 'clinic' }).map((l) => l.id), ['2'])
  assert.deepEqual(filtrarCarteira(c, { categoria: 'Solar Energy Company' }).map((l) => l.id), ['1'])
  assert.deepEqual(filtrarCarteira(c, { nicho: 'Energia Solar', pais: 'PT' }).map((l) => l.id), ['3'])
  assert.deepEqual(filtrarCarteira(c, { cidade: 'Goiânia' }).map((l) => l.id), ['1', '2'])
  assert.deepEqual(filtrarCarteira(c, { cidade: 'Goiânia', regiao: 'Centro' }).map((l) => l.id), ['2'])
  assert.deepEqual(filtrarCarteira(c, { regiao: 'GO' }).map((l) => l.id), ['3'])
})

test('filtrarCarteira preserva a ordem de trabalho e nao corta a carteira por padrao', () => {
  const c = Array.from({ length: 70 }, (_, i) => ({ id: String(i) }))
  const r = filtrarCarteira(c)
  assert.equal(r.length, 70)
  assert.equal(r[0].id, '0')
  assert.equal(filtrarCarteira(c, { limite: 5 }).length, 5)
})

// ── Guardas de regressao ─────────────────────────────────────────────────────
test('o modulo nao decide se o movimento vale — quem verifica e o servidor', () => {
  for (const proibido of ['temAtividade', 'lead_disparos', 'ligacoes', 'auditoria']) {
    assert.ok(!codigo.includes(proibido),
      `plano-dia.js (front) passou a verificar evidencia: "${proibido}" — isso e regra de negocio`)
  }
})

test('o modulo nao confunde etapa do dia com funil', () => {
  for (const proibido of ['qualificacao', 'responsavel_id', 'rejeitado', 'nao_contatar']) {
    assert.ok(!codigo.includes(proibido),
      `plano-dia.js (front) passou a ler "${proibido}" — etapa do dia nao e ciclo comercial`)
  }
})

test('o modulo e PURO — sem React, rede ou DOM', () => {
  for (const proibido of ['react', 'fetch(', 'document.', 'window.', 'localStorage']) {
    assert.ok(!codigo.includes(proibido), `plano-dia.js passou a depender de "${proibido}"`)
  }
})
