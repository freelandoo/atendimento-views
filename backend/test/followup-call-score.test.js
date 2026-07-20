const test = require('node:test')
const assert = require('node:assert/strict')

const {
  calcularCallScore,
  temperaturaDoScore,
  fatorRecencia,
  recomendarAcaoHumana,
  recomendarJanelaAcao,
  montarPromptPreviewExterno,
  ACOES_HUMANAS,
} = require('../src/services/followup-call-score')

test('opt-out sai da lista (nunca ligar)', () => {
  const r = calcularCallScore({ opt_out: true, pediu_preco: true, estagio: 'negociacao' })
  assert.equal(r.elegivel, false)
  assert.equal(r.score, 0)
  assert.match(r.motivo, /opt-out|sem interesse/)
})

test('pediu preco e sumiu recente pontua alto e fica quente', () => {
  const r = calcularCallScore({ pediu_preco: true, dias_silencio: 2, score_lead: 70 })
  assert.ok(r.score >= 40, `score esperado alto, veio ${r.score}`)
  assert.equal(r.temperatura, r.score >= 60 ? 'quente' : 'morno')
  assert.match(r.motivo, /pediu preco/)
  assert.equal(r.elegivel, true)
})

test('estagio quente + engajou + reuniao pendente empilha e chega a quente', () => {
  const r = calcularCallScore({
    estagio: 'negociacao',
    respondeu_alguma_vez: true,
    reuniao_pendente: true,
    dias_silencio: 1,
    score_lead: 80,
  })
  assert.equal(r.temperatura, 'quente')
  assert.ok(r.score >= 60)
  assert.ok(r.motivos.length >= 2)
})

test('recencia esfria: mesmo sinal fica mais fraco com o tempo', () => {
  const recente = calcularCallScore({ pediu_preco: true, dias_silencio: 1 })
  const antigo = calcularCallScore({ pediu_preco: true, dias_silencio: 40 })
  assert.ok(recente.score > antigo.score, 'silencio recente deve pontuar mais que antigo')
})

test('lead totalmente frio sem sinais nao e elegivel', () => {
  const r = calcularCallScore({ dias_silencio: 50, score_lead: 0 })
  assert.equal(r.elegivel, false)
  assert.equal(r.score, 0)
})

test('so ignorar >= 2 follow-ups conta como canal esgotado', () => {
  const um = calcularCallScore({ followups_ignorados: 1, dias_silencio: 5 })
  const dois = calcularCallScore({ followups_ignorados: 2, dias_silencio: 5 })
  assert.ok(dois.score > um.score)
})

test('score final e limitado a 0..100', () => {
  const r = calcularCallScore({
    pediu_preco: true,
    recebeu_proposta: true,
    estagio: 'negociacao',
    respondeu_alguma_vez: true,
    reuniao_pendente: true,
    followups_ignorados: 5,
    score_lead: 100,
    dias_silencio: 1,
  })
  assert.ok(r.score <= 100 && r.score >= 0)
})

test('temperaturaDoScore respeita as faixas', () => {
  assert.equal(temperaturaDoScore(70), 'quente')
  assert.equal(temperaturaDoScore(40), 'morno')
  assert.equal(temperaturaDoScore(10), 'frio')
})

test('fatorRecencia decai mas nunca abaixo de 0.35', () => {
  assert.equal(fatorRecencia(1), 1)
  assert.ok(fatorRecencia(15) < 1 && fatorRecencia(15) > 0.35)
  assert.ok(fatorRecencia(999) >= 0.35)
})

test('handoff sempre recomenda assumir a conversa, mesmo sem call score', () => {
  const r = recomendarAcaoHumana({ aguardando_handoff: true, dias_silencio: 0 })
  assert.equal(r.acao_recomendada, ACOES_HUMANAS.ASSUMIR)
  assert.equal(r.score, 100)
  assert.equal(r.janela_recomendada, 'Agora')
})

test('canal de mensagem esgotado recomenda ligacao', () => {
  const r = recomendarAcaoHumana({
    respondeu_alguma_vez: true,
    followups_ignorados: 2,
    dias_silencio: 3,
  }, { dia: 'Tue', hora: 15 })
  assert.equal(r.acao_recomendada, ACOES_HUMANAS.LIGAR)
  assert.match(r.motivo, /canal de mensagem/)
  assert.match(r.janela_recomendada, /Agora/)
})

test('pedido visual com contexto recomenda apenas copiar prompt externo', () => {
  const r = recomendarAcaoHumana({
    respondeu_alguma_vez: true,
    ultimo_texto_usuario: 'Legal, mas como ficaria o site para a minha empresa?',
    negocio: 'Marcenaria Horizonte',
    cidade: 'Sao Bernardo do Campo',
    produto_sugerido: 'site institucional',
    dor_principal: 'mostrar os moveis e receber pedidos no WhatsApp',
    recebeu_preview: false,
    dias_silencio: 1,
  }, { dia: 'Wed', hora: 11 })
  assert.equal(r.acao_recomendada, ACOES_HUMANAS.COPIAR_PROMPT_PREVIEW)
  assert.match(r.orientacao, /gere a imagem fora do projeto/i)
  assert.match(r.prompt_preview, /Marcenaria Horizonte/)
  assert.match(r.janela_recomendada, /14h30/)
})

test('preview ja recebido nunca recomenda novo prompt', () => {
  const r = recomendarAcaoHumana({
    respondeu_alguma_vez: true,
    ultimo_texto_usuario: 'Queria ver um exemplo visual',
    negocio: 'Marcenaria Horizonte',
    cidade: 'Sao Bernardo do Campo',
    produto_sugerido: 'site institucional',
    recebeu_preview: true,
    pediu_preco: true,
    dias_silencio: 1,
  })
  assert.notEqual(r.acao_recomendada, ACOES_HUMANAS.COPIAR_PROMPT_PREVIEW)
  assert.equal(r.prompt_preview, null)
})

test('proposta enviada recomenda revisao antes de nova abordagem', () => {
  const r = recomendarAcaoHumana({
    recebeu_proposta: true,
    respondeu_alguma_vez: true,
    dias_silencio: 2,
  })
  assert.equal(r.acao_recomendada, ACOES_HUMANAS.REVISAR_PROPOSTA)
})

test('prompt externo exige contexto minimo e nao inventa campos comerciais', () => {
  assert.equal(montarPromptPreviewExterno({ negocio: 'Loja X' }), null)
  const prompt = montarPromptPreviewExterno({
    negocio: 'Loja X', cidade: 'Santos', produto_sugerido: 'landing page', dor_principal: 'captar orcamentos',
  })
  assert.match(prompt, /Não invente telefone, preço, avaliações/)
  assert.doesNotMatch(prompt, /R\$\s*\d/)
})

test('janela de preview evita noite e final de semana', () => {
  const aposJanela = recomendarJanelaAcao(ACOES_HUMANAS.COPIAR_PROMPT_PREVIEW, { dia: 'Fri', hora: 18 })
  const domingo = recomendarJanelaAcao(ACOES_HUMANAS.COPIAR_PROMPT_PREVIEW, { dia: 'Sun', hora: 10 })
  assert.match(aposJanela, /Próximo dia útil.*enviar o preview/)
  assert.match(domingo, /Próximo dia útil.*enviar o preview/)
})
