'use strict'
const { enviarMensagem, verificarStatusInstanciaEvolution } = require('../whatsapp')

const PJ_EMPRESA_ID = '00000000-0000-0000-0000-000000000001'
const HISTORICO_MAX = 40
const TEXTO_MAX = 4096

function erroOperacao(message, statusCode = 400, code = 'BAD_REQUEST') {
  const err = new Error(message)
  err.statusCode = statusCode
  err.code = code
  return err
}

function validarNumeroConversa(value) {
  const numero = String(value || '').trim()
  if (!numero) throw erroOperacao('numero e obrigatorio.')
  if (numero.length > 80 || /[\r\n\t]/.test(numero)) throw erroOperacao('numero invalido.')
  if (/@g\.us$|@broadcast$/i.test(numero)) throw erroOperacao('numero invalido para contato individual.')
  if (/@/.test(numero) && !/@s\.whatsapp\.net$/i.test(numero)) throw erroOperacao('numero invalido.')
  const digitos = numero.replace(/\D/g, '')
  if (digitos.length < 8 || digitos.length > 15) throw erroOperacao('numero invalido.')
  return numero
}

function validarTextoMensagem(value, max = TEXTO_MAX) {
  const texto = String(value ?? '').trim()
  if (!texto) throw erroOperacao('texto e obrigatorio.')
  if (texto.length > max) throw erroOperacao(`texto excede o limite de ${max} caracteres.`)
  return texto
}

async function buscarConversaParaEnvio(pool, empresaId, numero) {
  const { rows } = await pool.query(
    `SELECT c.numero,
            c.empresa_id,
            c.evolution_instance,
            CASE
              WHEN NULLIF(BTRIM(c.evolution_instance), '') IS NOT NULL THEN ci.evolution_instance
              ELSE fallback.evolution_instance
            END AS instance_name,
            CASE
              WHEN NULLIF(BTRIM(c.evolution_instance), '') IS NOT NULL
                   AND ci.evolution_instance IS NULL THEN true
              ELSE false
            END AS instance_conversa_indisponivel
       FROM vendas.conversas c
       LEFT JOIN app.empresa_whatsapp_instances ci
         ON ci.empresa_id = COALESCE(c.empresa_id, $1::uuid)
        AND ci.evolution_instance = c.evolution_instance
        AND ci.ativo = true
        AND COALESCE(ci.config_json->>'canal', 'whatsapp') <> 'freelandoo'
       LEFT JOIN LATERAL (
         SELECT evolution_instance
           FROM app.empresa_whatsapp_instances
          WHERE empresa_id = COALESCE(c.empresa_id, $1::uuid)
            AND ativo = true
            AND COALESCE(config_json->>'canal', 'whatsapp') <> 'freelandoo'
          ORDER BY atualizado_em DESC, criado_em DESC
          LIMIT 1
       ) fallback ON true
      WHERE (c.empresa_id = $1 OR ($1::uuid = $2::uuid AND c.empresa_id IS NULL))
        AND c.numero = $3
      LIMIT 1`,
    [empresaId, PJ_EMPRESA_ID, numero]
  )
  return rows[0] || null
}

async function enviarMensagemManualOperador({
  pool,
  empresaId,
  numero,
  texto,
  operadorId = null,
  assumir = true,
  log = null,
  _enviarMensagem = enviarMensagem,
  _verificarStatusInstanciaEvolution = verificarStatusInstanciaEvolution,
  _now = () => new Date(),
}) {
  if (!pool) throw erroOperacao('pool obrigatorio.', 500, 'INTERNAL_ERROR')
  if (!empresaId) throw erroOperacao('empresaId obrigatorio.', 500, 'INTERNAL_ERROR')

  const numeroValidado = validarNumeroConversa(numero)
  const msg = validarTextoMensagem(texto)
  const conversa = await buscarConversaParaEnvio(pool, empresaId, numeroValidado)
  if (!conversa) throw erroOperacao('Conversa nao encontrada para esta empresa.', 404, 'NOT_FOUND')
  if (conversa.instance_conversa_indisponivel) {
    throw erroOperacao('A instancia desta conversa nao esta ativa para envio.', 409, 'INSTANCE_UNAVAILABLE')
  }

  const instanceName = String(conversa.instance_name || '').trim()
  if (!instanceName) {
    throw erroOperacao('Nenhuma instancia WhatsApp ativa encontrada para esta conversa.', 409, 'INSTANCE_UNAVAILABLE')
  }

  const status = await _verificarStatusInstanciaEvolution(instanceName)
  if (status?.connected === false) {
    throw erroOperacao(status.motivo || 'Instancia WhatsApp nao conectada.', 409, 'INSTANCE_DISCONNECTED')
  }

  let respostaEnvio = null
  try {
    respostaEnvio = await _enviarMensagem(numeroValidado, msg, { instanceName })
  } catch (err) {
    const wrapped = erroOperacao(err?.message || 'Falha ao enviar WhatsApp.', 502, 'WHATSAPP_SEND_FAILED')
    wrapped.cause = err
    throw wrapped
  }

  const entrada = {
    role: 'operator',
    content: msg,
    tipo: 'mensagem_manual_operador',
    criado_em: _now().toISOString(),
    ...(operadorId ? { operador_id: operadorId } : {}),
  }

  const { rows: [atualizada] } = await pool.query(
    `UPDATE vendas.conversas
        SET historico = (
              SELECT COALESCE(jsonb_agg(item ORDER BY ord), '[]'::jsonb)
                FROM (
                  SELECT item, ord
                    FROM jsonb_array_elements(
                      (CASE WHEN jsonb_typeof(historico) = 'array' THEN historico ELSE '[]'::jsonb END)
                      || $4::jsonb
                    ) WITH ORDINALITY AS h(item, ord)
                   ORDER BY ord DESC
                   LIMIT $5
                ) ultimos
            ),
            agente_pausado = CASE WHEN $6::boolean THEN true ELSE agente_pausado END,
            empresa_id = COALESCE(empresa_id, $1::uuid),
            evolution_instance = COALESCE(NULLIF(BTRIM(evolution_instance), ''), $7::text),
            atualizado_em = NOW()
      WHERE (empresa_id = $1 OR ($1::uuid = $2::uuid AND empresa_id IS NULL))
        AND numero = $3
      RETURNING numero, historico, estagio, status, agente_pausado, evolution_instance, atualizado_em`,
    [empresaId, PJ_EMPRESA_ID, numeroValidado, JSON.stringify([entrada]), HISTORICO_MAX, assumir !== false, instanceName]
  )
  if (!atualizada) {
    if (log?.warn) log.warn({ empresa_id: empresaId }, '[conversa-manual] envio feito, mas conversa nao foi atualizada')
    throw erroOperacao('Mensagem enviada, mas nao foi possivel atualizar o historico.', 500, 'HISTORY_UPDATE_FAILED')
  }

  return {
    numero: atualizada.numero,
    enviado: true,
    assumido: !!atualizada.agente_pausado,
    historico: atualizada.historico,
    estagio: atualizada.estagio,
    status: atualizada.status,
    evolution_instance: atualizada.evolution_instance,
    atualizado_em: atualizada.atualizado_em,
    trecho: msg.slice(0, 200),
    provider_key_id: respostaEnvio?.key?.id || respostaEnvio?.message?.key?.id || respostaEnvio?.data?.key?.id || null,
  }
}

module.exports = {
  enviarMensagemManualOperador,
  validarNumeroConversa,
  validarTextoMensagem,
  _internals: { buscarConversaParaEnvio, erroOperacao },
}
