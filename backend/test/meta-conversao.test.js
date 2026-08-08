'use strict'

// Regras PURAS da integração Meta por empresa. Sem banco, sem rede.

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  TIPOS_CONVERSAO, EVENTO_META, MAX_TENTATIVAS,
  nomeMetaDoTipo, eventoHabilitado, tiposHabilitados, montarEventId,
  normalizarTelefone, mascararTelefone, validarVenda, avaliarFato,
  minutosAteProximaTentativa, classificarFalha, mensagemDeErro, mensagemDeMotivo,
} = require('../src/services/meta-conversao')

const TUDO_LIGADO = { evento_agendada: true, evento_realizada: true, evento_venda: true }

// ─── Mapeamento ───────────────────────────────────────────────────────────────

test('mapeamento: os três eventos internos viram três nomes DISTINTOS da Meta', () => {
  const nomes = TIPOS_CONVERSAO.map(nomeMetaDoTipo)
  assert.deepEqual(nomes, ['LeadSubmitted', 'QualifiedLead', 'Purchase'])
  // Nomes repetidos fariam a Meta deduplicar eventos de fases diferentes do funil.
  assert.equal(new Set(nomes).size, 3)
})

test('mapeamento: cancelada e no_show não existem como tipo de conversão', () => {
  assert.equal(TIPOS_CONVERSAO.includes('cancelada'), false)
  assert.equal(TIPOS_CONVERSAO.includes('no_show'), false)
  assert.equal(nomeMetaDoTipo('cancelada'), null)
  assert.equal(nomeMetaDoTipo('no_show'), null)
  assert.equal(Object.keys(EVENTO_META).length, 3)
})

test('habilitação: cada evento liga de forma independente', () => {
  const so_venda = { evento_agendada: false, evento_realizada: false, evento_venda: true }
  assert.deepEqual(tiposHabilitados(so_venda), ['reuniao_realizada_com_venda'])
  assert.equal(eventoHabilitado(so_venda, 'reuniao_agendada'), false)
  assert.deepEqual(tiposHabilitados({}), [])
  assert.deepEqual(tiposHabilitados(TUDO_LIGADO), TIPOS_CONVERSAO.slice())
})

// ─── Idempotência ─────────────────────────────────────────────────────────────

test('event_id: identifica a ENTIDADE + tipo, e é determinístico', () => {
  const a = montarEventId({ tipo: 'reuniao_agendada', entidadeTipo: 'agenda_app', entidadeId: 'abc' })
  const b = montarEventId({ tipo: 'reuniao_agendada', entidadeTipo: 'agenda_app', entidadeId: 'abc' })
  assert.equal(a, b, 'mesmo fato deve gerar a mesma chave')
  assert.equal(a, 'ra:agenda_app:abc')
})

test('event_id: NÃO usa telefone — o mesmo contato pode vender em reuniões distintas', () => {
  // Este é o defeito do motor antigo (`${telefone}:Purchase`): uma venda por
  // telefone, para sempre. Duas reuniões do mesmo lead são duas entidades.
  const venda1 = montarEventId({ tipo: 'reuniao_realizada_com_venda', entidadeTipo: 'agenda_app', entidadeId: 'r1' })
  const venda2 = montarEventId({ tipo: 'reuniao_realizada_com_venda', entidadeTipo: 'agenda_app', entidadeId: 'r2' })
  assert.notEqual(venda1, venda2)
  assert.equal(venda1.includes('5511'), false)
})

test('event_id: tipos diferentes da MESMA reunião não colidem', () => {
  const chaves = TIPOS_CONVERSAO.map((tipo) => montarEventId({ tipo, entidadeTipo: 'agenda_vendas', entidadeId: '42' }))
  assert.equal(new Set(chaves).size, 3)
})

test('event_id: recusa entidade ou tipo desconhecido, em vez de inventar chave', () => {
  assert.throws(() => montarEventId({ tipo: 'inexistente', entidadeTipo: 'agenda_app', entidadeId: '1' }))
  assert.throws(() => montarEventId({ tipo: 'reuniao_agendada', entidadeTipo: 'outra_coisa', entidadeId: '1' }))
  assert.throws(() => montarEventId({ tipo: 'reuniao_agendada', entidadeTipo: 'agenda_app', entidadeId: '' }))
})

// ─── Dado pessoal ─────────────────────────────────────────────────────────────

test('telefone: normaliza para dígitos e mascara preservando início e fim', () => {
  assert.equal(normalizarTelefone('+55 (71) 99999-4821'), '5571999994821')
  assert.equal(normalizarTelefone(''), null)
  const m = mascararTelefone('+55 71 99999-4821')
  assert.equal(m.endsWith('4821'), true)
  assert.equal(m.startsWith('5571'), true)
  assert.equal(m.includes('99999'), false, 'o miolo do telefone não pode aparecer')
  assert.equal(mascararTelefone(null), null)
})

// ─── Venda ────────────────────────────────────────────────────────────────────

test('venda: sem valor, valor zero ou negativo NÃO é venda válida', () => {
  assert.equal(validarVenda({ valor: null }).ok, false)
  assert.equal(validarVenda({ valor: 0 }).ok, false)
  assert.equal(validarVenda({ valor: -10 }).ok, false)
  assert.equal(validarVenda({ valor: 'abc' }).ok, false)
  assert.equal(validarVenda({ valor: null }).motivo, 'venda_sem_valor')
})

test('venda: moeda padrão BRL, normalizada em maiúsculas, 3 letras obrigatórias', () => {
  assert.deepEqual(validarVenda({ valor: 1500 }), { ok: true, valor: 1500, moeda: 'BRL' })
  assert.equal(validarVenda({ valor: 10, moeda: 'usd' }).moeda, 'USD')
  assert.equal(validarVenda({ valor: 10, moeda: 'REAIS' }).ok, false)
  // Arredonda para centavos: valor com mais casas viraria ruído de receita.
  assert.equal(validarVenda({ valor: 1234.5678 }).valor, 1234.57)
})

// ─── Elegibilidade do fato ────────────────────────────────────────────────────

test('fato: reunião CANCELADA e NO-SHOW nunca viram conversão — nem o agendamento', () => {
  for (const status of ['cancelado', 'nao_compareceu']) {
    for (const tipo of TIPOS_CONVERSAO) {
      const r = avaliarFato({ tipo, statusReuniao: status, temAtribuicao: true, valor: 500 }, TUDO_LIGADO)
      assert.equal(r.ok, false, `${tipo} com status ${status} não pode ir à Meta`)
      assert.equal(r.motivo, 'reuniao_cancelada_ou_no_show')
    }
  }
})

test('fato: evento desligado na empresa não vira conversão', () => {
  const so_agendada = { evento_agendada: true, evento_realizada: false, evento_venda: false }
  assert.equal(avaliarFato({ tipo: 'reuniao_agendada', statusReuniao: 'concluido', temAtribuicao: true }, so_agendada).ok, true)
  const r = avaliarFato({ tipo: 'reuniao_realizada', statusReuniao: 'concluido', temAtribuicao: true }, so_agendada)
  assert.equal(r.ok, false)
  assert.equal(r.motivo, 'evento_desabilitado')
})

test('fato: sem atribuição de anúncio não há conversão (é o caso normal do outbound)', () => {
  const r = avaliarFato({ tipo: 'reuniao_agendada', statusReuniao: 'pendente', temAtribuicao: false }, TUDO_LIGADO)
  assert.equal(r.ok, false)
  assert.equal(r.motivo, 'sem_atribuicao')
})

test('fato: venda SEM valor não gera evento de venda (critério de aceite)', () => {
  const r = avaliarFato({ tipo: 'reuniao_realizada_com_venda', statusReuniao: 'concluido', temAtribuicao: true, valor: null }, TUDO_LIGADO)
  assert.equal(r.ok, false)
  assert.equal(r.motivo, 'venda_sem_valor')
})

test('fato: venda COM valor devolve valor e moeda já normalizados', () => {
  const r = avaliarFato(
    { tipo: 'reuniao_realizada_com_venda', statusReuniao: 'concluido', temAtribuicao: true, valor: '2500.5', moeda: 'brl' },
    TUDO_LIGADO
  )
  assert.equal(r.ok, true)
  assert.equal(r.valor, 2500.5)
  assert.equal(r.moeda, 'BRL')
})

// ─── Retentativa ──────────────────────────────────────────────────────────────

test('backoff: cresce e satura, sem passar da janela de 7 dias da Meta', () => {
  const seq = [1, 2, 3, 4, 5, 6, 7, 20].map(minutosAteProximaTentativa)
  assert.deepEqual(seq.slice(0, 6), [1, 5, 25, 120, 360, 720])
  assert.equal(seq[6], 720, 'satura no último degrau')
  assert.equal(seq[7], 720)
  const totalMin = [1, 5, 25, 120, 360, 720].reduce((a, b) => a + b, 0)
  assert.ok(totalMin < 7 * 24 * 60, 'o backoff inteiro cabe na janela de atribuição')
})

test('falha: 5xx e 429 são transitórios (tenta de novo, não derruba a integração)', () => {
  const r500 = classificarFalha({ httpStatus: 503, tentativas: 1 })
  assert.equal(r500.permanente, false)
  assert.equal(r500.esgotou, false)
  assert.equal(r500.desativarIntegracao, false)
  const r429 = classificarFalha({ httpStatus: 429, tentativas: 2 })
  assert.equal(r429.permanente, false)
  assert.equal(r429.desativarIntegracao, false)
})

test('falha: token inválido (190) é permanente e joga a integração para "precisa de atenção"', () => {
  const r = classificarFalha({ httpStatus: 400, codigo: 190, tentativas: 1 })
  assert.equal(r.permanente, true)
  assert.equal(r.esgotou, true)
  assert.equal(r.desativarIntegracao, true)
})

test('falha: nome de evento recusado (2804066) e destino ausente (2804116) são permanentes', () => {
  for (const subcodigo of [2804066, 2804116]) {
    const r = classificarFalha({ httpStatus: 400, subcodigo, tentativas: 1 })
    assert.equal(r.permanente, true)
    assert.equal(r.desativarIntegracao, true)
  }
})

test('falha: transitório esgota depois do teto de tentativas', () => {
  assert.equal(classificarFalha({ httpStatus: 503, tentativas: MAX_TENTATIVAS - 1 }).esgotou, false)
  assert.equal(classificarFalha({ httpStatus: 503, tentativas: MAX_TENTATIVAS }).esgotou, true)
})

// ─── Mensagens ────────────────────────────────────────────────────────────────

test('mensagem de erro: traduz por subcódigo/código e NUNCA ecoa texto da Meta', () => {
  assert.match(mensagemDeErro({ subcodigo: 2804116 }), /Página ou da conta WhatsApp Business/)
  assert.match(mensagemDeErro({ codigo: 190 }), /Token inválido ou expirado/)
  assert.match(mensagemDeErro({ httpStatus: 429 }), /limitando o volume/)
  assert.match(mensagemDeErro({ httpStatus: 500 }), /indisponível/)
  // Erro desconhecido não vaza nada: frase genérica, sem detalhe da resposta.
  const generico = mensagemDeErro({ httpStatus: 418 })
  assert.match(generico, /recusou o envio/)
  assert.equal(generico.includes('undefined'), false)
})

test('mensagem de motivo: todo motivo emitido pelas regras tem tradução própria', () => {
  const motivos = [
    'evento_desabilitado', 'reuniao_cancelada_ou_no_show', 'sem_atribuicao',
    'venda_sem_valor', 'moeda_invalida', 'integracao_inativa', 'empresa_nao_resolvida',
  ]
  const generica = mensagemDeMotivo('__inexistente__')
  for (const m of motivos) {
    assert.notEqual(mensagemDeMotivo(m), generica, `motivo ${m} caiu na mensagem genérica`)
  }
})
