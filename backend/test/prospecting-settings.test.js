'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizarConfiguracaoProspeccao,
  configProspeccaoPersistida,
  salvarConfiguracaoProspeccao,
  obterConfiguracaoProspeccao,
  montarAgendaPainelProspeccao,
} = require('../src/services/prospecting-settings')

function criarPoolFake() {
  let row = null
  const queries = []
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params })
      // garantirLinhaConfiguracao: INSERT (empresa_id) VALUES ($1)
      if (/INSERT INTO prospectador\.prospeccao_configuracoes\s*\(empresa_id\)\s*VALUES/i.test(sql)) {
        if (!row) {
          row = {
            empresa_id: params[0],
            ativo: false,
            modo: 'manual',
            horario_inicio: '08:00',
            horario_fim: '17:00',
            intervalo_envio_minutos: 15,
            limite_diario: 80,
            dias_semana_ativos: [1, 2, 3, 4, 5],
            categoria_padrao: null,
            cidade_padrao: null,
            estado_padrao: null,
            regiao_padrao: null,
            gerar_mensagem_ia: false,
            envio_real_habilitado: false,
            agendamento_busca_ativo: false,
            busca_intervalo_horas: 6,
            modo_busca: 'manual',
            busca_max_diaria: 2,
            busca_estrategia: 'equilibrada',
            busca_nichos_permitidos: [],
            busca_localizacoes_permitidas: [],
            busca_permitir_nichos_relacionados: true,
            busca_estado: 'pausado',
            busca_mensagem: null,
            busca_mercado_atual: null,
            busca_zero_consecutivos: 0,
            criado_em: '2026-05-24T00:00:00.000Z',
            atualizado_em: '2026-05-24T00:00:00.000Z',
          }
        }
        return { rows: [] }
      }
      // salvarConfiguracaoProspeccao: INSERT (empresa_id, ativo, ...) — empresa_id é o $1.
      if (/INSERT INTO prospectador\.prospeccao_configuracoes\s*\(\s*empresa_id,/i.test(sql)) {
        row = {
          empresa_id: params[0],
          ativo: params[1],
          modo: params[2],
          horario_inicio: params[3],
          horario_fim: params[4],
          intervalo_envio_minutos: params[5],
          limite_diario: params[6],
          dias_semana_ativos: params[7],
          categoria_padrao: params[8],
          cidade_padrao: params[9],
          estado_padrao: params[10],
          regiao_padrao: params[11],
          gerar_mensagem_ia: params[12],
          envio_real_habilitado: params[13],
          agendamento_busca_ativo: params[14],
          busca_intervalo_horas: params[15],
          modo_busca: params[16],
          busca_max_diaria: params[17],
          busca_estrategia: params[18],
          busca_nichos_permitidos: params[19],
          busca_localizacoes_permitidas: params[20],
          busca_permitir_nichos_relacionados: params[21],
          busca_estado: params[22] ? 'aguardando' : 'pausado',
          busca_mensagem: null,
          busca_mercado_atual: null,
          busca_zero_consecutivos: 0,
          criado_em: '2026-05-24T00:00:00.000Z',
          atualizado_em: '2026-05-24T01:00:00.000Z',
        }
        return { rows: [row] }
      }
      if (/FROM prospectador\.prospeccao_configuracoes/i.test(sql)) {
        return { rows: row ? [row] : [] }
      }
      return { rows: [] }
    },
  }
}

test('prospecting settings: normaliza payload completo de configuracao', () => {
  const cfg = normalizarConfiguracaoProspeccao({
    enabled: true,
    modo: 'automatico',
    horario_inicio: '08:30',
    horario_fim: '18:00',
    intervalo_envio_minutos: 15,
    limit: 90,
    dias_semana_ativos: [1, 3, 5],
    categoria: 'restaurantes',
    cidade_padrao: 'Salvador',
    estado_padrao: 'bahia',
    regiao_padrao: 'Regiao Metropolitana',
    envio_real_habilitado: true,
    gerar_mensagem_ia: false,
  })
  assert.equal(cfg.ativo, true)
  assert.equal(cfg.modo, 'automatico')
  assert.equal(cfg.horario_inicio, '08:30')
  assert.equal(cfg.horario_fim, '18:00')
  assert.equal(cfg.limite_diario, 90)
  assert.deepEqual(cfg.dias_semana_ativos, [1, 3, 5])
  assert.equal(cfg.categoria_padrao, 'restaurantes')
  assert.equal(cfg.cidade_padrao, 'Salvador')
  assert.equal(cfg.estado_padrao, 'ba')
  assert.equal(cfg.regiao_padrao, 'Regiao Metropolitana')
  assert.equal(cfg.envio_real_habilitado, false, 'envio real fica travado sem IA nesta fase')
})

test('prospecting settings: row persistida retorna aliases usados pelo dashboard', () => {
  const cfg = configProspeccaoPersistida({
    ativo: true,
    modo: 'semi_automatico',
    horario_inicio: '09:15:00',
    horario_fim: '16:45:00',
    intervalo_envio_minutos: 30,
    limite_diario: 50,
    dias_semana_ativos: [2],
    categoria_padrao: 'barbearias',
    cidade_padrao: 'Sao Paulo',
    estado_padrao: 'SP',
    regiao_padrao: 'Zona Sul',
    gerar_mensagem_ia: false,
    envio_real_habilitado: false,
  })
  assert.equal(cfg.enabled, true)
  assert.equal(cfg.limit, 50)
  assert.equal(cfg.categoria, 'barbearias')
  assert.equal(cfg.hour, 9)
  assert.equal(cfg.minute, 15)
  assert.equal(cfg.horario_fim, '16:45')
})

test('prospecting settings: Busca IA aplica guardrails simples no backend', () => {
  const cfg = normalizarConfiguracaoProspeccao({
    modo_busca: 'ia',
    busca_intervalo_horas: 2,
    busca_max_diaria: 9,
    busca_estrategia: 'exploratoria',
    busca_nichos_permitidos: 'dentistas, clínicas, dentistas',
    busca_localizacoes_permitidas: ['SP', 'Campinas'],
    busca_permitir_nichos_relacionados: false,
  })
  assert.equal(cfg.agendamento_busca_ativo, true)
  assert.equal(cfg.busca_intervalo_horas, 6)
  assert.equal(cfg.busca_max_diaria, 2)
  assert.equal(cfg.busca_estrategia, 'exploratoria')
  assert.deepEqual(cfg.busca_nichos_permitidos, ['dentistas', 'clínicas'])
  assert.deepEqual(cfg.busca_localizacoes_permitidas, ['SP', 'Campinas'])
  assert.equal(cfg.busca_permitir_nichos_relacionados, false)
})

test('prospecting settings: salvar e recarregar preserva configuracao no pool', async () => {
  const pool = criarPoolFake()
  const salvo = await salvarConfiguracaoProspeccao(pool, {
    ativo: true,
    modo: 'automatico',
    horario_inicio: '08:00',
    horario_fim: '17:00',
    intervalo_envio_minutos: 15,
    limite_diario: 80,
    dias_semana_ativos: [1, 2, 3, 4, 5],
    categoria_padrao: 'restaurantes',
    cidade_padrao: 'Salvador',
    estado_padrao: 'BA',
    regiao_padrao: 'Centro',
  })
  const recarregado = await obterConfiguracaoProspeccao(pool)
  assert.equal(salvo.modo, 'automatico')
  assert.deepEqual(recarregado, salvo)
  assert.equal(recarregado.categoria_padrao, 'restaurantes')
  assert.equal(recarregado.cidade_padrao, 'Salvador')
  assert.equal(recarregado.estado_padrao, 'BA')
  assert.deepEqual(recarregado.dias_semana_ativos, [1, 2, 3, 4, 5])
})

test('prospecting settings: configuração é escopada por empresa (empresa_id no WHERE/params)', async () => {
  const pool = criarPoolFake()
  await salvarConfiguracaoProspeccao(pool, { ativo: true, categoria_padrao: 'dentista' }, 'empresa-xyz')
  const insert = pool.queries.find((q) => /INSERT INTO prospectador\.prospeccao_configuracoes\s*\(\s*empresa_id,/i.test(q.sql))
  assert.ok(insert, 'deve usar o INSERT com empresa_id')
  assert.equal(insert.params[0], 'empresa-xyz', 'empresa_id é o primeiro parâmetro')

  await obterConfiguracaoProspeccao(pool, 'empresa-xyz')
  const select = pool.queries.find((q) => /FROM prospectador\.prospeccao_configuracoes/i.test(q.sql))
  assert.match(select.sql, /WHERE empresa_id = \$1/)
  assert.equal(select.params[0], 'empresa-xyz')
})

test('prospecting settings: sem empresaId cai na empresa padrão PJ (compatibilidade)', async () => {
  const pool = criarPoolFake()
  await obterConfiguracaoProspeccao(pool)
  const garantir = pool.queries.find((q) => /INSERT INTO prospectador\.prospeccao_configuracoes\s*\(empresa_id\)\s*VALUES/i.test(q.sql))
  assert.equal(garantir.params[0], '00000000-0000-0000-0000-000000000001')
})

test('prospecting settings: agenda painel mostra preview sem habilitar envio real', () => {
  const agenda = montarAgendaPainelProspeccao({
    ativo: true,
    modo: 'automatico',
    horario_inicio: '08:00',
    horario_fim: '09:00',
    intervalo_envio_minutos: 30,
    limite_diario: 80,
    dias_semana_ativos: [1],
  }, '2026-05-25')
  assert.equal(agenda.total_slots, 3)
  assert.equal(agenda.primeiro_slot, '2026-05-25T08:00:00')
  assert.equal(agenda.ultimo_slot, '2026-05-25T09:00:00')
  assert.equal(agenda.envio_real_habilitado, false)
})

test('prospecting settings: agenda painel reflete o disparo real quando ligado', () => {
  const base = {
    ativo: true,
    modo: 'automatico',
    horario_inicio: '08:00',
    horario_fim: '09:00',
    intervalo_envio_minutos: 30,
    limite_diario: 80,
    dias_semana_ativos: [1],
  }
  // Disparo real exige IA: quando ambos ligados, o painel reflete ATIVO e troca a observação.
  const ligado = montarAgendaPainelProspeccao({ ...base, gerar_mensagem_ia: true, envio_real_habilitado: true }, '2026-05-25')
  assert.equal(ligado.envio_real_habilitado, true)
  assert.equal(ligado.gerar_mensagem_ia, true)
  assert.match(ligado.observacao, /Disparo real ATIVO/i)

  // IA ligada mas disparo desligado: nada é enviado, observação intermediária.
  const soIA = montarAgendaPainelProspeccao({ ...base, gerar_mensagem_ia: true, envio_real_habilitado: false }, '2026-05-25')
  assert.equal(soIA.envio_real_habilitado, false)
  assert.match(soIA.observacao, /disparo real está desligado/i)

  // Sem IA: modo seguro.
  const seguro = montarAgendaPainelProspeccao(base, '2026-05-25')
  assert.match(seguro.observacao, /Modo seguro/i)
})
