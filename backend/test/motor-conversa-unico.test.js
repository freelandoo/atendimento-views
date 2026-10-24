'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createCoreFunnel } = require('../src/core-funnel')

test('conversa multiempresa sempre delega ao motor único, mesmo com estágios ativos', async () => {
  const conversa = {
    id: 'c1',
    numero: '5511999990000@s.whatsapp.net',
    empresa_id: 'empresa-1',
    evolution_instance: 'instancia-1',
    historico: [{ role: 'user', content: 'Quero entender como funciona.' }],
    estagio: 'diagnostico',
    status: 'ativo',
  }
  const chamadas = []
  const core = createCoreFunnel({
    logger: { info() {}, warn() {}, error() {} },
    pool: { query: async () => ({ rows: [] }) },
    normalizarHistoricoMensagens: (historico) => historico,
    buscarConversa: async () => conversa,
    responderContexto2: async (entrada) => {
      chamadas.push(entrada)
      return { skipped: true, reason: 'motor_conversa_nao_configurado' }
    },
    // A regressão era consultar este motor e seguir pelo fluxo antigo. Ele não
    // pode ser chamado quando a conversa já tem empresa e instância comprovadas.
    getContextoAtivoComEstagios: async () => { throw new Error('não deve consultar o motor antigo') },
    getContextoAtivoEmpresa: async () => { throw new Error('não deve consultar fallback de playbook') },
    chamarClaude: async () => { throw new Error('não deve chamar o agente antigo') },
  })

  const resultado = await core.gerarEEnviarRespostaWhatsapp(conversa.numero, conversa.historico)
  assert.deepStrictEqual(resultado, { skipped: true, reason: 'motor_conversa_nao_configurado' })
  assert.strictEqual(chamadas.length, 1)
  assert.strictEqual(chamadas[0].empresaId, 'empresa-1')
  assert.strictEqual(chamadas[0].estagioLive, 'diagnostico')
})
