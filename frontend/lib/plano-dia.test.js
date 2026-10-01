const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  COLUNAS, CHAVES, montarColunas, aoMoverPara, seloConclusao, seloOrigemEntrada,
  horarioDoCard, resumoDoDia, avisoPendentes, rotuloDia, somarDias, diasDaSemana,
  rotuloDiaCurto, rotuloSemana, resumoDoPeriodo, opcoesNicho, opcoesCidade, opcoesRegiao,
  opcoesCategoria, opcoesPais, capacidadeDoDia, gruposPlanejamento, motivoPlanejamento,
  origemBateFiltro, sugestaoPlanoDoDia, filtrarCarteira, resumoFollowUpCard,
  totalAcoes, notaLead, resumoAcoes,
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

test('seloConclusao resume o tipo de acao registrada quando o backend manda a origem', () => {
  assert.equal(seloConclusao({ conclusao_tipo: 'atividade_registrada', conclusao_acao: 'lead_reuniao_agendada' }).rotulo, 'Reunião')
  assert.equal(seloConclusao({ conclusao_tipo: 'atividade_registrada', conclusao_acao: 'lead_ligacao_realizada' }).rotulo, 'Ligação')
  assert.equal(seloConclusao({ conclusao_tipo: 'atividade_registrada', conclusao_acao: 'lead_follow_up_criado' }).rotulo, 'Follow-up')
  assert.equal(seloConclusao({ conclusao_tipo: 'atividade_registrada', conclusao_acao: 'lead_proposta_enviada' }).rotulo, 'Proposta')
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

test('resumoFollowUpCard mostra proximo retorno sem depender de contagem', () => {
  const agora = new Date('2026-09-29T12:00:00-03:00')
  assert.equal(resumoFollowUpCard({}, agora), null)
  assert.equal(resumoFollowUpCard({ follow_up_id: 'fu1' }, agora).rotulo, 'Follow-up')
  const futuro = resumoFollowUpCard({ follow_up_id: 'fu1', follow_up_agendado_para: '2026-09-30T09:00:00-03:00' }, agora)
  assert.match(futuro.rotulo, /Follow-up: amanhã 09:00/)
  assert.equal(futuro.vencido, false)
  assert.match(futuro.classe, /text-brand/)
  const vencido = resumoFollowUpCard({ follow_up_id: 'fu2', follow_up_agendado_para: '2026-09-29T10:00:00-03:00' }, agora)
  assert.match(vencido.rotulo, /Follow-up: hoje 10:00/)
  assert.equal(vencido.vencido, true)
  assert.match(vencido.classe, /amber/)
  const atrasado = resumoFollowUpCard({ follow_up_id: 'fu3', follow_up_agendado_para: '2026-09-28T10:00:00-03:00' }, agora)
  assert.equal(atrasado.atrasado, true)
  assert.match(atrasado.classe, /estado-danger/)
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

test('capacidadeDoDia orienta foco sem bloquear o plano', () => {
  const r = capacidadeDoDia([
    { etapa: 'para_hoje' },
    { etapa: 'em_trabalho' },
    { etapa: 'em_trabalho' },
    { etapa: 'feito' },
  ], 4, 1)
  assert.equal(r.abertos, 3)
  assert.equal(r.feitos, 1)
  assert.equal(r.vagas, 1)
  assert.equal(r.passouLimiteDia, false)
  assert.equal(r.passouLimiteTrabalho, true)
  assert.match(r.alerta, /em trabalho/)
})

// ── Pendencias ───────────────────────────────────────────────────────────────
test('sem pendencia nao ha aviso; com pendencia o texto e a acao sao explicitos', () => {
  assert.equal(avisoPendentes([]), null)
  assert.equal(avisoPendentes(null), null)
  const a = avisoPendentes([{}, {}])
  assert.equal(a.total, 2)
  assert.equal(a.acaoContinuar, 'Continuar hoje')
  assert.ok(a.acaoTrazerTudo.includes('2'))
  assert.match(a.dicaContinuar, /preservando/i)
  assert.match(a.dicaTrazerTudo, /Para hoje/i)
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

test('origemBateFiltro respeita origem exata e grupos inbound/outbound', () => {
  assert.equal(origemBateFiltro({ origem: 'meta_form' }, 'meta_form'), true)
  assert.equal(origemBateFiltro({ origem: 'meta_form' }, 'inbound'), true)
  assert.equal(origemBateFiltro({ origem: 'whatsapp' }, 'inbound'), true)
  assert.equal(origemBateFiltro({ origem: 'meta_ads' }, 'outbound'), true)
  assert.equal(origemBateFiltro({ origem: 'automatico' }, 'places'), true)
  assert.equal(origemBateFiltro({ origem: 'manual' }, 'places'), true)
  assert.equal(origemBateFiltro({ origem: 'meta_ads' }, 'places'), false)
  assert.equal(origemBateFiltro({ origem: 'meta_form' }, 'outbound'), false)
  assert.equal(origemBateFiltro({ origem: 'nova_origem' }, ''), true)
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

test('filtrarCarteira recorta por origem sem deduzir por campos laterais', () => {
  const c = [
    { id: '1', nome: 'Form recebido', origem: 'meta_form', instagram_handle: '@temperfil' },
    { id: '2', nome: 'Anunciante', origem: 'meta_ads' },
    { id: '3', nome: 'Mapa', origem: 'automatico' },
    { id: '4', nome: 'Sem origem', instagram_handle: '@nao_deduzir' },
  ]
  assert.deepEqual(filtrarCarteira(c, { origem: 'meta_form' }).map((l) => l.id), ['1'])
  assert.deepEqual(filtrarCarteira(c, { origem: 'meta_ads' }).map((l) => l.id), ['2'])
  assert.deepEqual(filtrarCarteira(c, { origem: 'inbound' }).map((l) => l.id), ['1'])
  assert.deepEqual(filtrarCarteira(c, { origem: 'outbound' }).map((l) => l.id), ['2', '3'])
})

test('gruposPlanejamento cria atalhos de decisao sobre a carteira carregada', () => {
  const c = [
    { id: '1', telefone: '5562', icp_faixa: 'A' },
    { id: '2', telefone: '', icp_faixa: 'B' },
    { id: '3', telefone: null, icp_faixa: null },
  ]
  const grupos = gruposPlanejamento(c)
  const porChave = Object.fromEntries(grupos.map((g) => [g.chave, g.total]))
  assert.equal(porChave.icp_a, 1)
  assert.equal(porChave.com_telefone, 1)
  assert.equal(porChave.sem_telefone, 2)
  assert.equal(porChave.icp_pendente, 1)
})

test('filtrarCarteira aceita grupo rapido sem mexer nos demais filtros', () => {
  const c = [
    { id: '1', nome: 'Sol Forte', telefone: '5562', icp_faixa: 'A', cidade: 'Goiânia' },
    { id: '2', nome: 'Clínica Boa', telefone: '', icp_faixa: 'A', cidade: 'Goiânia' },
    { id: '3', nome: 'Luz Verde', telefone: '5561', icp_faixa: 'B', cidade: 'Anápolis' },
  ]
  assert.deepEqual(filtrarCarteira(c, { grupo: 'icp_a' }).map((l) => l.id), ['1', '2'])
  assert.deepEqual(filtrarCarteira(c, { grupo: 'com_telefone', cidade: 'Goiânia' }).map((l) => l.id), ['1'])
  assert.deepEqual(filtrarCarteira(c, { grupo: 'sem_telefone' }).map((l) => l.id), ['2'])
})

test('motivoPlanejamento prioriza motivo provado e depois sinais de decisao', () => {
  assert.equal(motivoPlanejamento({ origem_entrada: 'sugestao_vencidos' }).rotulo, 'Retorno vencido')
  assert.equal(motivoPlanejamento({ proximo_agendamento: '2026-09-28T18:00:00Z' }, () => '18:00').rotulo, 'Agenda 18:00')
  assert.equal(motivoPlanejamento({ icp_faixa: 'A', telefone: '5562' }).rotulo, 'ICP A')
  assert.equal(motivoPlanejamento({ telefone: '' }).rotulo, 'Completar cadastro')
})

test('sugestaoPlanoDoDia monta rascunho revisavel sem duplicar nem furar limite', () => {
  const r = sugestaoPlanoDoDia({
    limite: 4,
    jaNoDia: new Set(['ja']),
    sugeridos: [{ prospect_id: 's1' }, { prospect_id: 'ja' }],
    carteira: [
      { id: 'a1', telefone: '5562', icp_faixa: 'A' },
      { id: 'a2', telefone: '', icp_faixa: 'A' },
      { id: 'b1', telefone: '5561', icp_faixa: 'B' },
      { id: 'x1', telefone: '', icp_faixa: null },
    ],
  })
  assert.deepEqual(r.ids, ['s1', 'a1', 'a2', 'b1'])
  assert.equal(r.total, 4)
  assert.ok(r.texto.includes('já esperando'))
  assert.ok(r.texto.includes('ICP A'))
})

test('sugestaoPlanoDoDia com limite zero nao marca nada automaticamente', () => {
  const r = sugestaoPlanoDoDia({
    limite: 0,
    sugeridos: [{ prospect_id: 's1' }],
    carteira: [{ id: 'a1', icp_faixa: 'A', telefone: '5562' }],
  })
  assert.deepEqual(r.ids, [])
  assert.equal(r.total, 0)
})

test('filtrarCarteira preserva a ordem de trabalho e nao corta a carteira por padrao', () => {
  const c = Array.from({ length: 70 }, (_, i) => ({ id: String(i) }))
  const r = filtrarCarteira(c)
  assert.equal(r.length, 70)
  assert.equal(r[0].id, '0')
  assert.equal(filtrarCarteira(c, { limite: 5 }).length, 5)
})

// ── Atencao ja dada ao lead (desempate + aviso) ──────────────────────────────
test('resumoAcoes conta so o registrado e volta null sem acao', () => {
  assert.equal(resumoAcoes({ n_followups: 0, n_ligacoes: 0, n_disparos: 0 }), null)
  assert.equal(resumoAcoes({}), null)
  const r = resumoAcoes({ n_followups: 2, n_ligacoes: 1, n_disparos: 0 })
  assert.equal(r.total, 3)
  assert.equal(r.rotulo, '3 ações')
  assert.equal(r.detalhe, '2 follow-ups, 1 ligação')
  assert.equal(resumoAcoes({ n_followups: 1 }).rotulo, '1 ação')
})

test('notaLead usa rating e ausencia vira -1 (nunca 0)', () => {
  assert.equal(notaLead({ rating: 4.5 }), 4.5)
  assert.equal(notaLead({ rating: 0 }), 0)
  assert.equal(notaLead({}), -1)
  assert.equal(totalAcoes({ n_followups: 2, n_ligacoes: 3 }), 5)
})

// ── Guardas de regressao ─────────────────────────────────────────────────────
test('o modulo nao decide se o movimento vale — quem verifica e o servidor', () => {
  // `.ligacoes` (referencia a TABELA), nao o bare "ligacoes": a tela agora EXIBE a contagem
  // `n_ligacoes` que o servidor computou — exibir contagem nao e verificar evidencia.
  for (const proibido of ['temAtividade', 'lead_disparos', '.ligacoes', 'auditoria']) {
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
