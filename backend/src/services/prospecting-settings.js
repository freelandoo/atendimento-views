'use strict'

const {
  normalizarConfigProspeccao,
  gerarSlotsEnvio,
} = require('./prospecting-scheduler')

function textoOuNull(valor, max = 160) {
  const texto = String(valor == null ? '' : valor).trim()
  return texto ? texto.slice(0, max) : null
}

function inteiroEntre(valor, padrao, min, max) {
  const n = Number.parseInt(valor, 10)
  if (!Number.isFinite(n)) return padrao
  return Math.min(Math.max(n, min), max)
}

function boolOuPadrao(valor, padrao = false) {
  if (valor === true || valor === 'true') return true
  if (valor === false || valor === 'false') return false
  return padrao
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
    // "Agenda" da busca recorrente do Places (a cada X horas).
    agendamento_busca_ativo: boolOuPadrao(payload.agendamento_busca_ativo, false),
    busca_intervalo_horas: inteiroEntre(payload.busca_intervalo_horas, 24, 1, 168),
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
    agendamento_busca_ativo: row.agendamento_busca_ativo,
    busca_intervalo_horas: row.busca_intervalo_horas,
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
    // Agenda da busca recorrente: o normalizador não conhece estes campos, então
    // preservamos os valores normalizados acima (não vêm em `cfg`).
    agendamento_busca_ativo: boolOuPadrao(row.agendamento_busca_ativo, false),
    busca_intervalo_horas: inteiroEntre(row.busca_intervalo_horas, 24, 1, 168),
    ultima_busca_em: row.ultima_busca_em || null,
    created_at: row.criado_em || null,
    updated_at: row.atualizado_em || null,
  }
}

// Empresa padrão ({{empresa}}): default para callers single-tenant legados
// (scheduler, daily-queue, places-queue) — preserva o comportamento atual.
const PJ_EMPRESA_ID = '00000000-0000-0000-0000-000000000001'

async function garantirLinhaConfiguracao(pool, empresaId = PJ_EMPRESA_ID) {
  await pool.query(
    `INSERT INTO prospectador.prospeccao_configuracoes (empresa_id)
     VALUES ($1)
     ON CONFLICT (empresa_id) DO NOTHING`,
    [empresaId]
  )
}

async function obterConfiguracaoProspeccao(pool, empresaId = PJ_EMPRESA_ID) {
  await garantirLinhaConfiguracao(pool, empresaId)
  const { rows } = await pool.query(
    `
    SELECT
      empresa_id, ativo, modo, horario_inicio, horario_fim,
      intervalo_envio_minutos, limite_diario, dias_semana_ativos,
      categoria_padrao, cidade_padrao, estado_padrao, regiao_padrao,
      gerar_mensagem_ia, envio_real_habilitado,
      agendamento_busca_ativo, busca_intervalo_horas, ultima_busca_em,
      criado_em, atualizado_em
    FROM prospectador.prospeccao_configuracoes
    WHERE empresa_id = $1
    LIMIT 1
    `,
    [empresaId]
  )
  return configProspeccaoPersistida(rows[0] || null)
}

async function salvarConfiguracaoProspeccao(pool, payload = {}, empresaId = PJ_EMPRESA_ID) {
  const cfg = normalizarConfiguracaoProspeccao(payload)
  const { rows } = await pool.query(
    `
    INSERT INTO prospectador.prospeccao_configuracoes (
      empresa_id, ativo, modo, horario_inicio, horario_fim,
      intervalo_envio_minutos, limite_diario, dias_semana_ativos,
      categoria_padrao, cidade_padrao, estado_padrao, regiao_padrao,
      gerar_mensagem_ia, envio_real_habilitado,
      agendamento_busca_ativo, busca_intervalo_horas
    )
    VALUES ($1, $2, $3, $4::time, $5::time, $6, $7, $8::smallint[], $9, $10, $11, $12, $13, $14, $15, $16)
    ON CONFLICT (empresa_id) DO UPDATE
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
        agendamento_busca_ativo = EXCLUDED.agendamento_busca_ativo,
        busca_intervalo_horas = EXCLUDED.busca_intervalo_horas,
        atualizado_em = NOW()
    RETURNING *
    `,
    [
      empresaId,
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
      cfg.agendamento_busca_ativo,
      cfg.busca_intervalo_horas,
    ]
  )
  return configProspeccaoPersistida(rows[0] || null)
}

function montarAgendaPainelProspeccao(config, data = new Date()) {
  if (!config) return null
  const slots = gerarSlotsEnvio({ ...config, data })
  // Reflete o estado REAL da config (não mais cravado em "modo seguro"): quando o
  // disparo real está ligado, a rodada diária agenda jobs e envia WhatsApp de verdade.
  const envioReal = config.envio_real_habilitado === true
  const geraIA = config.gerar_mensagem_ia === true
  const observacao = envioReal
    ? 'Disparo real ATIVO: a rotina gera a mensagem com IA, agenda os jobs e envia WhatsApp aos leads aprovados dentro da janela.'
    : geraIA
      ? 'IA ligada para gerar mensagens, mas o disparo real está desligado: nada é enviado nesta etapa (apenas simulação/aprovação).'
      : 'Modo seguro: não gera IA, não agenda jobs e não envia WhatsApp nesta etapa.'
  return {
    data: data instanceof Date ? data.toISOString().slice(0, 10) : String(data).slice(0, 10),
    total_slots: slots.length,
    primeiro_slot: slots[0]?.slot_local || null,
    ultimo_slot: slots[slots.length - 1]?.slot_local || null,
    slots_preview: slots.slice(0, 8),
    envio_real_habilitado: envioReal,
    gerar_mensagem_ia: geraIA,
    observacao,
  }
}

module.exports = {
  normalizarConfiguracaoProspeccao,
  configProspeccaoPersistida,
  obterConfiguracaoProspeccao,
  salvarConfiguracaoProspeccao,
  montarAgendaPainelProspeccao,
}
