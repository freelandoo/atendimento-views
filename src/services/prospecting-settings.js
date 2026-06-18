'use strict'

const {
  normalizarConfigProspeccao,
  gerarSlotsEnvio,
} = require('./prospecting-scheduler')

function textoOuNull(valor, max = 160) {
  const texto = String(valor == null ? '' : valor).trim()
  return texto ? texto.slice(0, max) : null
}

function normalizarConfiguracaoProspeccao(payload = {}) {
  const cfg = normalizarConfigProspeccao({
    ativo: payload.ativo ?? payload.enabled,
    modo: payload.modo,
    horario_inicio: payload.horario_inicio,
    horario_fim: payload.horario_fim,
    intervalo_envio_minutos: payload.intervalo_envio_minutos,
    limite_diario: payload.limite_diario ?? payload.limit,
    dias_semana_ativos: payload.dias_semana_ativos,
    categoria_padrao: payload.categoria_padrao ?? payload.categoria,
    cidade_padrao: payload.cidade_padrao,
    estado_padrao: payload.estado_padrao,
    regiao_padrao: payload.regiao_padrao,
    gerar_mensagem_ia: payload.gerar_mensagem_ia,
    envio_real_habilitado: payload.envio_real_habilitado,
  })
  return {
    ...cfg,
    categoria_padrao: textoOuNull(cfg.categoria_padrao),
    cidade_padrao: textoOuNull(cfg.cidade_padrao),
    estado_padrao: textoOuNull(cfg.estado_padrao, 2),
    regiao_padrao: textoOuNull(cfg.regiao_padrao),
  }
}

function configProspeccaoPersistida(row) {
  if (!row) return null
  const cfg = normalizarConfiguracaoProspeccao({
    ativo: row.ativo,
    modo: row.modo,
    horario_inicio: String(row.horario_inicio || '08:00').slice(0, 5),
    horario_fim: String(row.horario_fim || '17:00').slice(0, 5),
    intervalo_envio_minutos: row.intervalo_envio_minutos,
    limite_diario: row.limite_diario,
    dias_semana_ativos: row.dias_semana_ativos,
    categoria_padrao: row.categoria_padrao,
    cidade_padrao: row.cidade_padrao,
    estado_padrao: row.estado_padrao,
    regiao_padrao: row.regiao_padrao,
    gerar_mensagem_ia: row.gerar_mensagem_ia,
    envio_real_habilitado: row.envio_real_habilitado,
  })
  const [hour, minute] = cfg.horario_inicio.split(':').map((p) => Number.parseInt(p, 10))
  return {
    ...cfg,
    // Aliases mantêm o painel atual simples enquanto a nova configuração entra.
    enabled: cfg.ativo,
    limit: cfg.limite_diario,
    categoria: cfg.categoria_padrao,
    hour,
    minute,
    rodada_diaria: true,
    created_at: row.criado_em || null,
    updated_at: row.atualizado_em || null,
  }
}

async function garantirLinhaConfiguracao(pool) {
  await pool.query(`
    INSERT INTO prospectador.prospeccao_configuracoes (singleton_id)
    VALUES (true)
    ON CONFLICT (singleton_id) DO NOTHING
  `)
}

async function obterConfiguracaoProspeccao(pool) {
  await garantirLinhaConfiguracao(pool)
  const { rows } = await pool.query(`
    SELECT
      singleton_id, ativo, modo, horario_inicio, horario_fim,
      intervalo_envio_minutos, limite_diario, dias_semana_ativos,
      categoria_padrao, cidade_padrao, estado_padrao, regiao_padrao,
      gerar_mensagem_ia, envio_real_habilitado, criado_em, atualizado_em
    FROM prospectador.prospeccao_configuracoes
    WHERE singleton_id = true
    LIMIT 1
  `)
  return configProspeccaoPersistida(rows[0] || null)
}

async function salvarConfiguracaoProspeccao(pool, payload = {}) {
  const cfg = normalizarConfiguracaoProspeccao(payload)
  const { rows } = await pool.query(
    `
    INSERT INTO prospectador.prospeccao_configuracoes (
      singleton_id, ativo, modo, horario_inicio, horario_fim,
      intervalo_envio_minutos, limite_diario, dias_semana_ativos,
      categoria_padrao, cidade_padrao, estado_padrao, regiao_padrao,
      gerar_mensagem_ia, envio_real_habilitado
    )
    VALUES (true, $1, $2, $3::time, $4::time, $5, $6, $7::smallint[], $8, $9, $10, $11, $12, $13)
    ON CONFLICT (singleton_id) DO UPDATE
    SET ativo = EXCLUDED.ativo,
        modo = EXCLUDED.modo,
        horario_inicio = EXCLUDED.horario_inicio,
        horario_fim = EXCLUDED.horario_fim,
        intervalo_envio_minutos = EXCLUDED.intervalo_envio_minutos,
        limite_diario = EXCLUDED.limite_diario,
        dias_semana_ativos = EXCLUDED.dias_semana_ativos,
        categoria_padrao = EXCLUDED.categoria_padrao,
        cidade_padrao = EXCLUDED.cidade_padrao,
        estado_padrao = EXCLUDED.estado_padrao,
        regiao_padrao = EXCLUDED.regiao_padrao,
        gerar_mensagem_ia = EXCLUDED.gerar_mensagem_ia,
        envio_real_habilitado = EXCLUDED.envio_real_habilitado,
        atualizado_em = NOW()
    RETURNING *
    `,
    [
      cfg.ativo,
      cfg.modo,
      cfg.horario_inicio,
      cfg.horario_fim,
      cfg.intervalo_envio_minutos,
      cfg.limite_diario,
      cfg.dias_semana_ativos,
      cfg.categoria_padrao,
      cfg.cidade_padrao,
      cfg.estado_padrao,
      cfg.regiao_padrao,
      cfg.gerar_mensagem_ia,
      cfg.envio_real_habilitado,
    ]
  )
  return configProspeccaoPersistida(rows[0] || null)
}

function montarAgendaPainelProspeccao(config, data = new Date()) {
  if (!config) return null
  const slots = gerarSlotsEnvio({ ...config, data })
  return {
    data: data instanceof Date ? data.toISOString().slice(0, 10) : String(data).slice(0, 10),
    total_slots: slots.length,
    primeiro_slot: slots[0]?.slot_local || null,
    ultimo_slot: slots[slots.length - 1]?.slot_local || null,
    slots_preview: slots.slice(0, 8),
    envio_real_habilitado: false,
    observacao: 'Configuração salva em modo seguro: não gera IA, não agenda jobs e não envia WhatsApp nesta etapa.',
  }
}

module.exports = {
  normalizarConfiguracaoProspeccao,
  configProspeccaoPersistida,
  obterConfiguracaoProspeccao,
  salvarConfiguracaoProspeccao,
  montarAgendaPainelProspeccao,
}
