'use strict'
// Acesso a `app.mensagem_envios` (migration 117) — ledger de SAÍDA das mensagens de WhatsApp.
// Camada de dados isolada, como manda a arquitetura. Regras de vocabulário ficam no módulo PURO
// `services/mensagem-autoria.js`; aqui só I/O.

const { logger } = require('../logger')
const { normalizarAutoria, TIPO, TIPOS_DE_ATENDIMENTO } = require('../services/mensagem-autoria')

function digitos(valor) {
  return String(valor == null ? '' : valor).replace(/@.*$/, '').replace(/\D/g, '')
}

/**
 * Registra UM envio aceito pelo provedor.
 *
 * NUNCA LANÇA, de propósito. Este registro é alimentado no chokepoint do envio
 * (`whatsapp.js#enviarMensagem`): uma falha de contabilidade não pode derrubar uma mensagem que
 * já saiu para o cliente. O efeito de uma falha aqui é um indicador menor que a realidade —
 * preferível a um atendimento quebrado —, e ela vai para o log.
 *
 * Idempotente por (empresa, `evolution_message_id`): reentrega e retry não duplicam a linha.
 */
async function registrarEnvio(pool, {
  empresaId,
  evolutionInstance,
  numero,
  conversaNumero = null,
  autoria = null,
  autorUsuarioId = null,
  acionadorUsuarioId = null,
  tipo = null,
  evolutionMessageId = null,
} = {}) {
  try {
    if (!pool || typeof pool.query !== 'function') return { ok: false, motivo: 'sem_pool' }
    const empresa = String(empresaId || '').trim()
    const instancia = String(evolutionInstance || '').trim()
    const fone = digitos(numero)
    // Sem empresa, sem instância ou sem telefone utilizável não há fato a registrar — e as três
    // colunas são NOT NULL no schema justamente porque uma linha sem elas não diria nada.
    if (!empresa || !instancia || fone.length < 8 || fone.length > 15) {
      return { ok: false, motivo: 'dados_insuficientes' }
    }
    const v = normalizarAutoria({ autoria, autorUsuarioId, acionadorUsuarioId, tipo })
    await pool.query(
      `INSERT INTO app.mensagem_envios
         (empresa_id, evolution_instance, telefone_digitos, conversa_numero, direcao,
          autoria, autor_usuario_id, acionador_usuario_id, tipo, evolution_message_id)
       VALUES ($1, $2, $3, $4, 'enviada', $5, $6::uuid, $7::uuid, $8, $9)
       ON CONFLICT (empresa_id, evolution_message_id)
         WHERE evolution_message_id IS NOT NULL DO NOTHING`,
      [
        empresa, instancia, fone,
        conversaNumero ? String(conversaNumero) : null,
        v.autoria, v.autor_usuario_id, v.acionador_usuario_id, v.tipo,
        evolutionMessageId ? String(evolutionMessageId) : null,
      ]
    )
    return { ok: true }
  } catch (err) {
    logger.warn({ err: err.message, operation: 'mensagem_envios' }, '[mensagem-envios] registro falhou (envio nao afetado)')
    return { ok: false, motivo: 'erro', erro: err.message }
  }
}

/** Janela de datas. Default: os últimos 30 dias, fechados no instante da consulta. */
function janela({ de = null, ate = null } = {}) {
  const fim = ate ? new Date(ate) : new Date()
  const inicio = de ? new Date(de) : new Date(fim.getTime() - 30 * 24 * 60 * 60 * 1000)
  const ok = (d) => d instanceof Date && !Number.isNaN(d.getTime())
  return {
    inicio: ok(inicio) ? inicio : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    fim: ok(fim) ? fim : new Date(),
  }
}

/**
 * Indicadores de mensagens enviadas no período.
 *
 * Escopado por empresa SEMPRE. `alerta_operador` fica FORA dos totais de atendimento (é aviso
 * ao operador, não mensagem ao lead) e aparece em número próprio, para o operador não achar que
 * o total encolheu sem motivo.
 *
 * `leads_contatados` é DISTINCT por telefone — várias mensagens para o mesmo contato não viram
 * vários leads. É a distinção que o pedido cobra explicitamente.
 */
async function resumoEnvios(pool, empresaId, { de = null, ate = null, instancia = null } = {}) {
  const { inicio, fim } = janela({ de, ate })
  const params = [empresaId, inicio, fim, TIPOS_DE_ATENDIMENTO]
  let filtroInstancia = ''
  if (instancia) {
    params.push(String(instancia))
    filtroInstancia = `AND m.evolution_instance = $${params.length}`
  }
  // Um unico construtor de FROM/WHERE para as tres consultas: recortes separados divergiriam e
  // a tela passaria a se contradizer (o total nao fecharia com a soma por pessoa/instancia).
  const de_onde = (join = '') => `FROM app.mensagem_envios m
      ${join}
      WHERE m.empresa_id = $1
        AND m.criado_em >= $2 AND m.criado_em < $3
        ${filtroInstancia}`
  const ATENDIMENTO = 'm.tipo = ANY($4)'

  const [totais, porPessoa, porInstancia] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE ${ATENDIMENTO})::int AS mensagens,
         COUNT(*) FILTER (WHERE ${ATENDIMENTO} AND m.autoria = 'ia')::int AS ia,
         COUNT(*) FILTER (WHERE ${ATENDIMENTO} AND m.autoria = 'pessoa')::int AS pessoa,
         COUNT(*) FILTER (WHERE ${ATENDIMENTO} AND m.autoria = 'desconhecida')::int AS desconhecida,
         COUNT(*) FILTER (WHERE m.tipo = 'alerta_operador')::int AS alerta_operador,
         COUNT(DISTINCT m.telefone_digitos) FILTER (WHERE ${ATENDIMENTO})::int AS leads_contatados
       ${de_onde()}`,
      params
    ),
    pool.query(
      `SELECT m.autor_usuario_id AS usuario_id,
              COALESCE(u.nome, 'Sem nome') AS nome,
              COUNT(*)::int AS mensagens
         ${de_onde('LEFT JOIN app.usuarios u ON u.id = m.autor_usuario_id')}
           AND ${ATENDIMENTO}
           AND m.autoria = 'pessoa'
           AND m.autor_usuario_id IS NOT NULL
         GROUP BY m.autor_usuario_id, u.nome
         ORDER BY mensagens DESC, nome ASC`,
      params
    ),
    pool.query(
      `SELECT m.evolution_instance,
              COALESCE(i.nome, m.evolution_instance) AS nome,
              COUNT(*) FILTER (WHERE ${ATENDIMENTO})::int AS mensagens,
              COUNT(DISTINCT m.telefone_digitos) FILTER (WHERE ${ATENDIMENTO})::int AS leads_contatados
         ${de_onde(`LEFT JOIN app.empresa_whatsapp_instances i
             ON i.evolution_instance = m.evolution_instance AND i.empresa_id = m.empresa_id`)}
         GROUP BY m.evolution_instance, i.nome
         HAVING COUNT(*) FILTER (WHERE ${ATENDIMENTO}) > 0
         ORDER BY mensagens DESC`,
      params
    ),
  ])

  const t = totais.rows[0] || {}
  return {
    periodo: { de: inicio.toISOString(), ate: fim.toISOString() },
    instancia: instancia ? String(instancia) : null,
    mensagens: Number(t.mensagens || 0),
    ia: Number(t.ia || 0),
    pessoa: Number(t.pessoa || 0),
    desconhecida: Number(t.desconhecida || 0),
    alerta_operador: Number(t.alerta_operador || 0),
    leads_contatados: Number(t.leads_contatados || 0),
    por_pessoa: porPessoa.rows,
    por_instancia: porInstancia.rows,
  }
}

module.exports = { registrarEnvio, resumoEnvios, janela, TIPO }
