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
  assert.deepEqual(r, { podeResponder: true, origem: 'prospeccao' })
})

test('contato externo só responde quando a instância libera explicitamente', () => {
  const bloqueado = avaliarEscopoAtendimentoInstancia({
    contextoProspeccao: null,
    configJson: { atende_contatos_externos: false },
  })
  assert.deepEqual(bloqueado, { podeResponder: false, origem: 'contato_externo_bloqueado' })

  const liberado = avaliarEscopoAtendimentoInstancia({
    contextoProspeccao: null,
    configJson: { atende_contatos_externos: true },
  })
  assert.deepEqual(liberado, { podeResponder: true, origem: 'contato_externo_liberado' })
})
