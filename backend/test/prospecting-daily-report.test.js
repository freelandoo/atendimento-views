'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  operadoresDoPayloadOuEnv,
  formatarRelatorioDiarioWhatsapp,
  gerarRelatorioDiarioProspeccao,
  obterRelatorioDiarioProspeccao,
  enviarRelatorioDiarioOperadores,
} = require('../src/services/prospecting-daily-report')

const PJ_EMPRESA_ID = '00000000-0000-0000-0000-000000000001'

function criarPoolRelatorioFake(opts = {}) {
  const state = {
    relatorios: new Map(), // chave `${data_referencia}|${empresa_id}`
    envioUpdate: null,
    execucoes: opts.execucoes || {
      [PJ_EMPRESA_ID]: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        data_execucao: '2026-05-24',
        modo: 'automatico',
        config_snapshot: {
          categoria_padrao: 'restaurantes',
          cidade_padrao: 'Salvador',
          estado_padrao: 'BA',
        },
      },
    },
  }

  return {
    state,
    async query(sql, params = []) {
      if (/FROM prospectador\.prospeccao_execucoes_diarias/i.test(sql)) {
        const execucao = state.execucoes[params[1]] || null
        return { rows: execucao ? [execucao] : [] }
      }

      if (/COUNT\(\*\)::int AS total_fila/i.test(sql)) {
        return { rows: [{ total_fila: 5, total_enviados: 3, total_falhas: 1, total_respostas: 1, total_agendados: 1 }] }
      }

      if (/COALESCE\(f\.categoria, p\.nicho/i.test(sql)) {
        return {
          rows: [
            { categoria: 'restaurantes', total: 4, total_enviados: 3, total_respostas: 1 },
            { categoria: 'barbearias', total: 1, total_enviados: 0, total_respostas: 0 },
          ],
        }
      }

      if (/COALESCE\(f\.cidade, p\.cidade/i.test(sql)) {
        return { rows: [{ cidade: 'Salvador', estado: 'BA', total: 5, total_enviados: 3, total_respostas: 1 }] }
      }

      if (/WITH telefones AS/i.test(sql)) {
        return { rows: [{ diagnostico: 1, proposta: 1, reunioes: 1, fechados: 0 }] }
      }

      if (/SELECT \*\s+FROM prospectador\.prospeccao_relatorios_diarios/i.test(sql)) {
        const row = state.relatorios.get(`${params[0]}|${params[1]}`)
        return { rows: row ? [row] : [] }
      }

      if (/INSERT INTO prospectador\.prospeccao_relatorios_diarios/i.test(sql)) {
        const row = {
          data_referencia: params[0],
          empresa_id: params[1],
          execucao_id: params[2],
          status: 'gerado',
          relatorio_json: JSON.parse(params[3]),
          texto_relatorio: params[4],
          metadata_json: JSON.parse(params[5]),
        }
        state.relatorios.set(`${params[0]}|${params[1]}`, row)
        return { rows: [row] }
      }

      if (/UPDATE prospectador\.prospeccao_relatorios_diarios/i.test(sql)) {
        const row = state.relatorios.get(`${params[0]}|${params[1]}`)
        state.envioUpdate = { data_referencia: params[0], empresa_id: params[1], status: params[2], resultados: JSON.parse(params[3]) }
        if (row) row.status = params[2]
        return { rows: [] }
      }

      return { rows: [] }
    },
  }
}

test('relatorio diario: gera, calcula taxa e persiste no banco', async () => {
  const pool = criarPoolRelatorioFake()
  const r = await gerarRelatorioDiarioProspeccao(pool, { data: '2026-05-24' })

  assert.equal(r.ok, true)
  assert.equal(r.relatorio_json.resumo.total_enviados, 3)
  assert.equal(r.relatorio_json.resumo.total_falhas, 1)
  assert.equal(r.relatorio_json.resumo.total_respostas, 1)
  assert.equal(r.relatorio_json.resumo.taxa_resposta, 0.3333)
  assert.equal(r.relatorio_json.categoria, 'restaurantes')
  assert.equal(r.relatorio_json.cidade, 'Salvador')
  assert.equal(r.relatorio_json.funil.diagnostico, 1)
  assert.match(r.texto_relatorio, /Enviadas: 3/)
  assert.match(pool.state.relatorios.get(`2026-05-24|${PJ_EMPRESA_ID}`).texto_relatorio, /Taxa de resposta: 33%/)
})

test('relatorio diario: busca relatorio persistido sem regenerar', async () => {
  const pool = criarPoolRelatorioFake()
  await gerarRelatorioDiarioProspeccao(pool, { data: '2026-05-24' })
  const r = await obterRelatorioDiarioProspeccao(pool, { data: '2026-05-24' })
  assert.equal(r.ok, true)
  assert.equal(r.relatorio.status, 'gerado')
  assert.equal(r.relatorio.relatorio_json.resumo.total_enviados, 3)
})

test('relatorio diario: nao conta falha como envio enviado', async () => {
  const pool = criarPoolRelatorioFake()
  const r = await gerarRelatorioDiarioProspeccao(pool, { data: '2026-05-24' })
  assert.equal(r.relatorio_json.resumo.total_enviados, 3)
  assert.equal(r.relatorio_json.resumo.total_falhas, 1)
})

test('relatorio diario: isola relatorio por empresa (nao sobrescreve nem vaza entre empresas)', async () => {
  const EMPRESA_A = PJ_EMPRESA_ID
  const EMPRESA_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const pool = criarPoolRelatorioFake({
    execucoes: {
      [EMPRESA_A]: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        data_execucao: '2026-05-24',
        modo: 'automatico',
        config_snapshot: { categoria_padrao: 'restaurantes', cidade_padrao: 'Salvador', estado_padrao: 'BA' },
      },
      [EMPRESA_B]: {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        data_execucao: '2026-05-24',
        modo: 'automatico',
        config_snapshot: { categoria_padrao: 'clinicas', cidade_padrao: 'Recife', estado_padrao: 'PE' },
      },
    },
  })

  const rA = await gerarRelatorioDiarioProspeccao(pool, { data: '2026-05-24', empresaId: EMPRESA_A })
  const rB = await gerarRelatorioDiarioProspeccao(pool, { data: '2026-05-24', empresaId: EMPRESA_B })

  assert.equal(rA.relatorio_json.categoria, 'restaurantes')
  assert.equal(rB.relatorio_json.categoria, 'clinicas')

  // Gerar o relatorio da empresa B nao pode ter sobrescrito o da empresa A (bug corrigido).
  const buscaA = await obterRelatorioDiarioProspeccao(pool, { data: '2026-05-24', empresaId: EMPRESA_A })
  const buscaB = await obterRelatorioDiarioProspeccao(pool, { data: '2026-05-24', empresaId: EMPRESA_B })
  assert.equal(buscaA.relatorio.relatorio_json.categoria, 'restaurantes')
  assert.equal(buscaB.relatorio.relatorio_json.categoria, 'clinicas')
})

test('relatorio diario: formata texto para envio aos operadores', () => {
  const texto = formatarRelatorioDiarioWhatsapp({
    data_referencia: '2026-05-24',
    modo: 'manual',
    categoria: 'restaurantes',
    cidade: 'Salvador',
    estado: 'BA',
    resumo: { total_enviados: 3, total_falhas: 1, total_respostas: 1, taxa_resposta: 0.3333 },
    funil: { diagnostico: 1, proposta: 1, reunioes: 1, fechados: 0 },
    aprendizados: ['Bom sinal em restaurantes.'],
    sugestao_proximo_dia: 'Repetir Salvador.',
  })
  assert.match(texto, /Relatorio diario de prospeccao/)
  assert.match(texto, /Falhas: 1/)
  assert.match(texto, /Sugestao para o proximo dia: Repetir Salvador/)
})

test('relatorio diario: envia para operadores informados e atualiza status', async () => {
  const pool = criarPoolRelatorioFake()
  const enviados = []
  const r = await enviarRelatorioDiarioOperadores(pool, {
    data: '2026-05-24',
    operadores: [{ numero: '55 71 99999-0001', nome: 'Operador' }],
  }, {
    enviarMensagemFn: async (numero, texto) => {
      enviados.push({ numero, texto })
    },
  })
  assert.equal(r.ok, true)
  assert.equal(r.enviado, true)
  assert.equal(r.enviados, 1)
  assert.equal(enviados[0].numero, '5571999990001')
  assert.match(enviados[0].texto, /Enviadas: 3/)
  assert.equal(pool.state.envioUpdate.status, 'enviado')
})

test('relatorio diario: sem operadores configurados apenas prepara texto', async () => {
  const prevOp = process.env.OPERATOR_WHATSAPP
  const prevVictor = process.env.VICTOR_WHATSAPP
  delete process.env.OPERATOR_WHATSAPP
  delete process.env.VICTOR_WHATSAPP
  try {
    const pool = criarPoolRelatorioFake()
    const r = await enviarRelatorioDiarioOperadores(pool, { data: '2026-05-24' }, { enviarMensagemFn: async () => {} })
    assert.equal(r.ok, true)
    assert.equal(r.enviado, false)
    assert.equal(r.motivo, 'sem_operadores_configurados')
    assert.match(r.texto_relatorio, /Relatorio diario/)
  } finally {
    if (prevOp == null) delete process.env.OPERATOR_WHATSAPP
    else process.env.OPERATOR_WHATSAPP = prevOp
    if (prevVictor == null) delete process.env.VICTOR_WHATSAPP
    else process.env.VICTOR_WHATSAPP = prevVictor
  }
})

test('relatorio diario: normaliza operadores por payload ou env', () => {
  const opsPayload = operadoresDoPayloadOuEnv({ operadores: ['(71) 99999-0001', { numero: '5571999990002', nome: 'B' }] })
  assert.deepEqual(opsPayload.map((o) => o.numero), ['71999990001', '5571999990002'])

  const prev = process.env.OPERATOR_WHATSAPP
  process.env.OPERATOR_WHATSAPP = '5571999990003:Ana,5571999990003:Duplicado,5571999990004'
  try {
    const opsEnv = operadoresDoPayloadOuEnv({})
    assert.deepEqual(opsEnv.map((o) => o.numero), ['5571999990003', '5571999990004'])
  } finally {
    if (prev == null) delete process.env.OPERATOR_WHATSAPP
    else process.env.OPERATOR_WHATSAPP = prev
  }
})
