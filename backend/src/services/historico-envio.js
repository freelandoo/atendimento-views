'use strict'
// Registra em vendas.conversas.historico as mensagens que a instância envia
// FORA do fluxo de resposta do agente (1ª mensagem da fila de prospecção e
// saudação do "Rodar leads"). Sem este registro, o painel Conversas só mostra
// o que passa pelo motor de resposta — esses envios ficavam invisíveis até
// (e a menos que) o lead respondesse.
//
// Regras:
//  - o `numero` da conversa é o MESMO JID que o webhook usa ao receber a
//    resposta (key.remoteJid do retorno da Evolution, sem sufixo de device);
//    assim a resposta do lead cai na mesma linha, sem conversa duplicada.
//  - upsert: cria a conversa se não existe (estagio 'primeiro_contato') ou faz
//    APPEND no historico — nunca sobrescreve estagio/status/empresa/instância.
//  - best-effort: falha aqui não pode derrubar o envio; o caller trata o erro
//    como warning. O seeding no webhook (mensagem_enviada da prospecção) segue
//    como fallback quando a conversa ainda não existe.

const PJ_EMPRESA_ID = '00000000-0000-0000-0000-000000000001'

// Extrai o JID canônico (55…@s.whatsapp.net) da resposta da Evolution ao
// sendText. Fallback: monta a partir dos dígitos do número de destino
// (heurística BR: acrescenta 55 em números de 10-11 dígitos).
function jidConversaDoEnvio(respostaEnvio, numeroDestino) {
  const key = respostaEnvio?.key || respostaEnvio?.message?.key || respostaEnvio?.data?.key || null
  const jid = typeof key?.remoteJid === 'string' ? key.remoteJid.trim() : ''
  if (/@s\.whatsapp\.net$/i.test(jid)) {
    // remove sufixo de device (ex.: 5511999999999:12@s.whatsapp.net)
    return jid.replace(/:\d+(?=@s\.whatsapp\.net$)/i, '')
  }
  let digits = String(numeroDestino || '').replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
  if (!digits) return null
  if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith('55')) digits = `55${digits}`
  return `${digits}@s.whatsapp.net`
}

/**
 * Upsert append-only: garante a linha da conversa e anexa a mensagem enviada
 * ao historico como { role: 'assistant', content, tipo, criado_em, ...meta }.
 */
async function registrarEnvioNoHistorico(pool, {
  respostaEnvio = null,
  numero,
  texto,
  tipo,
  empresaId = null,
  evolutionInstance = null,
  meta = null,
} = {}) {
  const jid = jidConversaDoEnvio(respostaEnvio, numero)
  const content = String(texto || '').trim()
  if (!jid || !content) return { ok: false, motivo: 'jid_ou_texto_invalido' }
  const entrada = {
    role: 'assistant',
    content,
    tipo: tipo || 'envio_instancia',
    criado_em: new Date().toISOString(),
    ...(meta && typeof meta === 'object' ? meta : {}),
  }
  const instance = typeof evolutionInstance === 'string' && evolutionInstance.trim()
    ? evolutionInstance.trim()
    : null
  await pool.query(
    `INSERT INTO vendas.conversas (numero, historico, estagio, status, empresa_id, evolution_instance)
     VALUES ($1, $2::jsonb, 'primeiro_contato', 'ativo', COALESCE($3::uuid, $4::uuid), $5)
     ON CONFLICT (numero) DO UPDATE
     SET historico = (
           CASE WHEN jsonb_typeof(vendas.conversas.historico) = 'array'
                THEN vendas.conversas.historico ELSE '[]'::jsonb END
         ) || $2::jsonb,
         empresa_id = COALESCE(vendas.conversas.empresa_id, EXCLUDED.empresa_id),
         evolution_instance = COALESCE(vendas.conversas.evolution_instance, EXCLUDED.evolution_instance),
         atualizado_em = NOW()`,
    [jid, JSON.stringify([entrada]), empresaId, PJ_EMPRESA_ID, instance]
  )
  return { ok: true, jid }
}

module.exports = { jidConversaDoEnvio, registrarEnvioNoHistorico }
