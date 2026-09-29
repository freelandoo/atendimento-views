'use strict'

const test = require('node:test')
const assert = require('node:assert')

const {
  atendeContatosExternos,
  avaliarEscopoAtendimentoInstancia,
} = require('../src/services/instancia-atendimento-escopo')

test('contatos externos ficam desligados por padrão', () => {
  assert.equal(atendeContatosExternos(null), false)
  assert.equal(atendeContatosExternos({}), false)
  assert.equal(atendeContatosExternos({ atende_contatos_externos: false }), false)
})

test('prospectado sempre pode seguir para resposta automática', () => {
  const r = avaliarEscopoAtendimentoInstancia({
    contextoProspeccao: { prospect: { id: 'p1' } },
    configJson: { atende_contatos_externos: false },
  })
  assert.deepEqual(r, { podeResponder: true, podeCapturar: true, origem: 'prospeccao' })
})

test('conversa já existente é permissão (a operação iniciou: envio manual ou abordagem)', () => {
  const r = avaliarEscopoAtendimentoInstancia({
    contextoProspeccao: null,
    configJson: { atende_contatos_externos: false },
    conversaExiste: true,
  })
  assert.deepEqual(r, { podeResponder: true, podeCapturar: true, origem: 'conversa_iniciada' })
})

test('lead de anúncio (CTWA) é capturado mesmo sem a operação ter iniciado', () => {
  const r = avaliarEscopoAtendimentoInstancia({
    contextoProspeccao: null,
    configJson: { atende_contatos_externos: false },
    veioDeAnuncio: true,
  })
  assert.deepEqual(r, { podeResponder: true, podeCapturar: true, origem: 'anuncio' })
})

test('contato externo sem permissão é bloqueado e NÃO capturado', () => {
  const bloqueado = avaliarEscopoAtendimentoInstancia({
    contextoProspeccao: null,
    configJson: { atende_contatos_externos: false },
  })
  assert.deepEqual(bloqueado, { podeResponder: false, podeCapturar: false, origem: 'contato_externo_bloqueado' })

  const liberado = avaliarEscopoAtendimentoInstancia({
    contextoProspeccao: null,
    configJson: { atende_contatos_externos: true },
  })
  assert.deepEqual(liberado, { podeResponder: true, podeCapturar: true, origem: 'contato_externo_liberado' })
})
