'use strict'
const { enviarMensagem, verificarStatusInstanciaEvolution, resolverInstanciaEnvio } = require('../whatsapp')
const { cancelarFollowupsAutoPendentes } = require('./followup-auto-cancel')
const {
  preferenciaValida,
  normalizarPreferencia,
  PREFERENCIAS_VALIDAS,
  PREFERENCIA_PADRAO,
} = require('./conversa-modo-ia')
const { registrarAuditoria } = require('../db/auditoria')

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

// Le SO a conversa, escopada na empresa. A escolha da instancia NAO e feita aqui: este
// arquivo carregava a propria copia da regra — incluindo o mesmo fallback por
// `atualizado_em DESC` de `whatsapp.js` — e duas implementacoes do mesmo julgamento e
// exatamente o preco que este repo ja pagou com a bolinha de pontuacao e o painel de
// conversa. Quem decide e' `resolverInstanciaEnvio` (regra unica).
async function buscarConversaParaEnvio(pool, empresaId, numero) {
  const { rows } = await pool.query(
    `SELECT c.numero,
            c.empresa_id,
            c.evolution_instance
       FROM vendas.conversas c
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
  _resolverInstanciaEnvio = resolverInstanciaEnvio,
  _now = () => new Date(),
}) {
  if (!pool) throw erroOperacao('pool obrigatorio.', 500, 'INTERNAL_ERROR')
  if (!empresaId) throw erroOperacao('empresaId obrigatorio.', 500, 'INTERNAL_ERROR')

  const numeroValidado = validarNumeroConversa(numero)
  const msg = validarTextoMensagem(texto)
  const conversa = await buscarConversaParaEnvio(pool, empresaId, numeroValidado)
  if (!conversa) throw erroOperacao('Conversa nao encontrada para esta empresa.', 404, 'NOT_FOUND')

  // A regra unica devolve o nome ja provado ou LANCA. O `empresaId` vai junto para que a
  // instancia seja conferida contra a empresa do OPERADOR, e nao so contra a da conversa
  // (conversa orfa, sem `empresa_id`, nao pode virar porta para o numero de outro tenant).
  let instanceName
  try {
    ;({ instanceName } = await _resolverInstanciaEnvio(numeroValidado, { empresaId }))
  } catch (err) {
    if (err?.instanciaBloqueada) {
      throw erroOperacao(err.message, 409, 'INSTANCE_UNAVAILABLE')
    }
    throw err
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

async function alterarPausaAgenteConversa({
  pool,
  empresaId,
  numero,
  pausado,
  motivo = 'agente_pausado',
  log = null,
  _cancelarFollowupsAutoPendentes = cancelarFollowupsAutoPendentes,
}) {
  if (!pool) throw erroOperacao('pool obrigatorio.', 500, 'INTERNAL_ERROR')
  if (!empresaId) throw erroOperacao('empresaId obrigatorio.', 500, 'INTERNAL_ERROR')
  if (typeof pausado !== 'boolean') throw erroOperacao('pausado deve ser booleano.')

  const numeroValidado = validarNumeroConversa(numero)
  const { rows: [atualizada] } = await pool.query(
    `UPDATE vendas.conversas
        SET agente_pausado = $4::boolean,
            empresa_id = COALESCE(empresa_id, $1::uuid),
            atualizado_em = NOW()
      WHERE (empresa_id = $1 OR ($1::uuid = $2::uuid AND empresa_id IS NULL))
        AND numero = $3
      RETURNING numero, historico, estagio, status, agente_pausado, evolution_instance, atualizado_em`,
    [empresaId, PJ_EMPRESA_ID, numeroValidado, pausado]
  )
  if (!atualizada) throw erroOperacao('Conversa nao encontrada para esta empresa.', 404, 'NOT_FOUND')

  let followupsCancelados = 0
  if (pausado) {
    try {
      followupsCancelados = await _cancelarFollowupsAutoPendentes(pool, numeroValidado, motivo)
    } catch (err) {
      if (log?.error) log.error({ err: err.message }, '[conversa-manual] falha ao cancelar follow-ups pendentes')
      throw erroOperacao('Agente pausado, mas nao foi possivel cancelar follow-ups pendentes.', 500, 'FOLLOWUP_CANCEL_FAILED')
    }
  }

  return {
    numero: atualizada.numero,
    agente_pausado: !!atualizada.agente_pausado,
    followups_cancelados: followupsCancelados,
    historico: atualizada.historico,
    estagio: atualizada.estagio,
    status: atualizada.status,
    evolution_instance: atualizada.evolution_instance,
    atualizado_em: atualizada.atualizado_em,
  }
}

/**
 * Troca a PREFERENCIA de modo de IA da conversa (`herdar` | `conversa` | `analise`).
 *
 * `herdar` REMOVE a excecao: a conversa volta a seguir o modo padrao da Central. Nao e' um
 * terceiro modo — e' a ausencia de escolha, e precisa ser gravavel para que o operador
 * possa desfazer uma excecao sem adivinhar qual era o global.
 *
 * Vive aqui, ao lado de `alterarPausaAgenteConversa`, porque e' a MESMA familia de acao:
 * o operador mexendo no atendimento de um contato. Modulo novo so duplicaria o escopo por
 * empresa e a validacao de numero que ja existem neste arquivo.
 *
 * O `UPDATE` e' condicionado (`IS DISTINCT FROM`) para que o proprio banco diga se houve
 * mudanca REAL: e' o que impede a auditoria de inflar quando alguem clica duas vezes na
 * mesma opcao, sem precisar de um SELECT antes (que abriria corrida).
 *
 * `agente_pausado` NAO e' tocado aqui, nem lido: sao dois fatos independentes sobre a
 * conversa e o envio automatico exige os dois liberados.
 */
async function alterarModoIaConversa({
  pool,
  empresaId,
  numero,
  modo,
  usuarioId = null,
  log = null,
  _registrarAuditoria = registrarAuditoria,
}) {
  if (!pool) throw erroOperacao('pool obrigatorio.', 500, 'INTERNAL_ERROR')
  if (!empresaId) throw erroOperacao('empresaId obrigatorio.', 500, 'INTERNAL_ERROR')
  if (!preferenciaValida(modo)) {
    throw erroOperacao(`modo invalido. Use um destes: ${PREFERENCIAS_VALIDAS.join(', ')}.`, 400, 'MODO_IA_INVALIDO')
  }

  const numeroValidado = validarNumeroConversa(numero)
  const modoNovo = normalizarPreferencia(modo)

  // A CTE fotografa o valor ANTERIOR na mesma instrucao que grava o novo: a auditoria
  // registra o que realmente estava la, sem SELECT separado (que abriria corrida) e sem
  // deduzir "o outro modo" (deducao que quebraria em silencio se um terceiro modo nascer).
  const { rows: [atualizada] } = await pool.query(
    `WITH anterior AS (
       SELECT numero, COALESCE(modo_ia, $5::text) AS modo_ia
         FROM vendas.conversas
        WHERE (empresa_id = $1 OR ($1::uuid = $2::uuid AND empresa_id IS NULL))
          AND numero = $3
     )
     UPDATE vendas.conversas c
        SET modo_ia = $4::text,
            empresa_id = COALESCE(c.empresa_id, $1::uuid),
            atualizado_em = NOW()
       FROM anterior a
      WHERE c.numero = a.numero
        AND a.modo_ia IS DISTINCT FROM $4::text
      RETURNING c.numero, c.modo_ia, a.modo_ia AS modo_anterior,
                c.agente_pausado, c.estagio, c.status, c.atualizado_em`,
    [empresaId, PJ_EMPRESA_ID, numeroValidado, modoNovo, PREFERENCIA_PADRAO]
  )

  // Sem linha: ou a conversa nao e' desta empresa, ou o modo ja era esse. As duas
  // possibilidades sao distinguidas por uma leitura escopada — nunca devolvendo dado de
  // conversa de outro tenant.
  if (!atualizada) {
    const { rows: [atual] } = await pool.query(
      `SELECT numero, modo_ia, agente_pausado, estagio, status, atualizado_em
         FROM vendas.conversas
        WHERE (empresa_id = $1 OR ($1::uuid = $2::uuid AND empresa_id IS NULL))
          AND numero = $3`,
      [empresaId, PJ_EMPRESA_ID, numeroValidado]
    )
    if (!atual) throw erroOperacao('Conversa nao encontrada para esta empresa.', 404, 'NOT_FOUND')
    return {
      numero: atual.numero,
      modo_ia: normalizarPreferencia(atual.modo_ia),
      modo_anterior: normalizarPreferencia(atual.modo_ia),
      alterado: false,
      agente_pausado: !!atual.agente_pausado,
      estagio: atual.estagio,
      status: atual.status,
      atualizado_em: atual.atualizado_em,
    }
  }

  const modoAnterior = normalizarPreferencia(atualizada.modo_anterior)

  // Auditoria SO na mudanca real (best-effort, como todo `registrarAuditoria`). O contexto
  // leva os digitos do telefone, nunca o JID nem texto de mensagem.
  await _registrarAuditoria(pool, empresaId, {
    usuarioId,
    entidadeTipo: 'conversa',
    entidadeId: null,
    acao: 'conversa_modo_ia_alterado',
    estadoAnterior: modoAnterior,
    estadoNovo: modoNovo,
    contexto: {
      modo_anterior: modoAnterior,
      modo_novo: modoNovo,
      telefone_digitos: numeroValidado.replace(/\D/g, ''),
    },
  })
  if (log?.info) {
    log.info({ empresa_id: empresaId, modo_novo: modoNovo }, '[conversa-manual] modo de IA alterado')
  }

  return {
    numero: atualizada.numero,
    modo_ia: normalizarPreferencia(atualizada.modo_ia),
    modo_anterior: modoAnterior,
    alterado: true,
    agente_pausado: !!atualizada.agente_pausado,
    estagio: atualizada.estagio,
    status: atualizada.status,
    atualizado_em: atualizada.atualizado_em,
  }
}

module.exports = {
  enviarMensagemManualOperador,
  alterarPausaAgenteConversa,
  alterarModoIaConversa,
  validarNumeroConversa,
  validarTextoMensagem,
  _internals: { buscarConversaParaEnvio, erroOperacao },
}
