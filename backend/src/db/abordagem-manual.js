'use strict'
// Abordagem MANUAL pelo WhatsApp — acesso a dados. CRM em equipe, Etapa 5.
// Regras puras em services/abordagem-manual.js.
//
// ESTE MÓDULO NÃO ENVIA MENSAGEM. Ele registra três fatos distintos sobre a abordagem manual:
// a preparação (leitura), a ABERTURA do WhatsApp e a DECLARAÇÃO de envio pelo vendedor. Guarda de
// regressão em test/abordagem-manual.test.js falha se um cliente HTTP aparecer aqui.

const A = require('../services/abordagem-manual')
const { avaliarAbordagem, rotuloMotivo } = require('../services/lead-qualificacao')
const { logger } = require('../logger')

function erro(mensagem, statusCode = 400, code = 'BAD_REQUEST') {
  const e = new Error(mensagem)
  e.statusCode = statusCode
  e.code = code
  return e
}

const COLS_LEAD = `id, nome, telefone, qualificacao, responsavel_id, status`

/**
 * Prepara a abordagem: devolve a URL, o rascunho e o histórico. READ-ONLY.
 *
 * Não grava nada de propósito — abrir um modal não pode virar registro de abordagem. Quem registra
 * é `registrarAbertura`, no clique.
 */
async function prepararAbordagem(pool, empresaId, prospectId, { usuarioId, remetente } = {}) {
  const { rows } = await pool.query(
    `SELECT ${COLS_LEAD} FROM prospectador.prospects WHERE empresa_id = $1 AND id = $2::uuid`,
    [empresaId, prospectId]
  )
  const lead = rows[0]
  if (!lead) throw erro('Lead não encontrado nesta empresa.', 404, 'NOT_FOUND')

  // A porta de qualificação vale para o canal manual também: abordar à mão é abordar.
  const porta = avaliarAbordagem(lead)
  const telefone = A.avaliarTelefone(lead.telefone)

  // A saudação da instância é o texto que o operador já escreveu e aprovou. Se houver mais de uma
  // instância ativa, pega a mais recente — aqui isso é APRESENTAÇÃO (um rascunho editável), não
  // escolha de remetente: nada sai por instância nenhuma neste canal. É por isso que reusar
  // `resolverInstanciaEnvio` seria errado, não apenas desnecessário.
  const { rows: inst } = await pool.query(
    `SELECT config_json->>'saudacao' AS saudacao
       FROM app.empresa_whatsapp_instances
      WHERE empresa_id = $1 AND ativo = true AND COALESCE(config_json->>'canal', 'whatsapp') = 'whatsapp'
      ORDER BY atualizado_em DESC LIMIT 1`,
    [empresaId]
  )

  const rascunho = A.montarRascunho(lead, { saudacao: inst[0]?.saudacao || '', remetente })
  const historico = await historicoDoLead(pool, empresaId, prospectId)

  return {
    lead: { id: lead.id, nome: lead.nome, telefone: lead.telefone, responsavel_id: lead.responsavel_id },
    pode_abordar: porta.permitido && telefone.permitido,
    // Os dois motivos são distintos e pedem ações diferentes: "falta triar" vs "número inválido".
    motivo: !porta.permitido ? rotuloMotivo(porta.motivo)
      : !telefone.permitido ? (telefone.motivo === A.MOTIVOS.SEM_TELEFONE ? 'lead sem telefone' : 'telefone em formato invalido')
        : null,
    mensagem_sugerida: rascunho,
    // A URL já vem montada para a tela não precisar conhecer o formato do wa.me.
    wa_me_url: porta.permitido ? A.montarUrlWaMe(lead.telefone, rascunho) : null,
    historico,
  }
}

/**
 * Registra que o vendedor ABRIU o WhatsApp. **Não é envio.**
 *
 * `status = 'aberto'` e `confirmado_por = NULL`: o estado próprio existe justamente para que nada
 * no sistema possa confundir o clique com a mensagem. `evolution_instance` fica NULA — não houve
 * instância (a CHECK da migration 073 exige isso para o canal manual).
 *
 * Idempotente por janela: reabrir o mesmo lead em poucos minutos NÃO cria linha nova, senão a
 * linha do tempo do lead viraria uma lista de cliques.
 */
async function registrarAbertura(pool, empresaId, prospectId, { usuarioId, mensagem } = {}) {
  const { rows: leadRows } = await pool.query(
    `SELECT ${COLS_LEAD} FROM prospectador.prospects WHERE empresa_id = $1 AND id = $2::uuid`,
    [empresaId, prospectId]
  )
  const lead = leadRows[0]
  if (!lead) throw erro('Lead não encontrado nesta empresa.', 404, 'NOT_FOUND')

  const porta = avaliarAbordagem(lead)
  if (!porta.permitido) {
    throw erro(`Lead não liberado para abordagem: ${rotuloMotivo(porta.motivo)}.`, 422, 'LEAD_NAO_QUALIFICADO')
  }
  if (!A.avaliarTelefone(lead.telefone).permitido) {
    throw erro('Lead sem telefone válido para abrir o WhatsApp.', 422, 'TELEFONE_INVALIDO')
  }

  const { rows: recente } = await pool.query(
    `SELECT id FROM prospectador.lead_disparos
      WHERE empresa_id = $1 AND prospect_id = $2::uuid AND canal = $3
        AND status = $4 AND criado_em > NOW() - INTERVAL '10 minutes'
      ORDER BY criado_em DESC LIMIT 1`,
    [empresaId, prospectId, A.CANAL.MANUAL_WA_ME, A.STATUS_MANUAL.ABERTO]
  )
  if (recente[0]) return { id: recente[0].id, reaproveitado: true }

  const { rows } = await pool.query(
    `INSERT INTO prospectador.lead_disparos
       (empresa_id, prospect_id, usuario_id, evolution_instance, mensagem, status, canal)
     VALUES ($1, $2::uuid, $3::uuid, NULL, $4, $5, $6)
     RETURNING id, status, canal, criado_em`,
    [empresaId, prospectId, usuarioId || null, A.sanearMensagem(mensagem),
      A.STATUS_MANUAL.ABERTO, A.CANAL.MANUAL_WA_ME]
  )
  logger.info({ empresa_id: empresaId, canal: A.CANAL.MANUAL_WA_ME }, '[abordagem-manual] whatsapp aberto')
  return { ...rows[0], reaproveitado: false }
}

/**
 * O vendedor DECLARA que enviou.
 *
 * `confirmado_por = 'operador'` — declaração, não prova. Atualiza a linha de abertura quando ela
 * existe (é o mesmo ato: abriu e enviou) e cria uma quando não existe (o vendedor pode ter enviado
 * pelo aparelho antes de clicar).
 *
 * Também marca `prospects.status = 'enviado'` **apenas quando o lead ainda estava sem contato** —
 * a mesma condição que o envio pela Evolution usa. Sem isso, marcar manualmente rebaixaria um lead
 * que já havia respondido.
 */
async function marcarEnviadoManualmente(pool, empresaId, prospectId, { usuarioId, mensagem } = {}) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: leadRows } = await client.query(
      `SELECT ${COLS_LEAD} FROM prospectador.prospects
        WHERE empresa_id = $1 AND id = $2::uuid FOR UPDATE`,
      [empresaId, prospectId]
    )
    const lead = leadRows[0]
    if (!lead) throw erro('Lead não encontrado nesta empresa.', 404, 'NOT_FOUND')

    const porta = avaliarAbordagem(lead)
    if (!porta.permitido) {
      throw erro(`Lead não liberado para abordagem: ${rotuloMotivo(porta.motivo)}.`, 422, 'LEAD_NAO_QUALIFICADO')
    }

    const texto = A.sanearMensagem(mensagem)
    const { rows: aberta } = await client.query(
      `UPDATE prospectador.lead_disparos
          SET status = $4, confirmado_por = $5, confirmado_em = NOW(),
              mensagem = COALESCE(NULLIF($6, ''), mensagem)
        WHERE id = (
          SELECT id FROM prospectador.lead_disparos
           WHERE empresa_id = $1 AND prospect_id = $2::uuid AND canal = $3
             AND status = $7 AND criado_em > NOW() - INTERVAL '24 hours'
           ORDER BY criado_em DESC LIMIT 1
        )
        RETURNING id, status, canal, confirmado_por, confirmado_em`,
      [empresaId, prospectId, A.CANAL.MANUAL_WA_ME, A.STATUS_MANUAL.ENVIADO,
        A.CONFIRMACAO.OPERADOR, texto, A.STATUS_MANUAL.ABERTO]
    )

    let disparo = aberta[0]
    if (!disparo) {
      const { rows } = await client.query(
        `INSERT INTO prospectador.lead_disparos
           (empresa_id, prospect_id, usuario_id, evolution_instance, mensagem, status, canal,
            confirmado_por, confirmado_em)
         VALUES ($1, $2::uuid, $3::uuid, NULL, $4, $5, $6, $7, NOW())
         RETURNING id, status, canal, confirmado_por, confirmado_em`,
        [empresaId, prospectId, usuarioId || null, texto, A.STATUS_MANUAL.ENVIADO,
          A.CANAL.MANUAL_WA_ME, A.CONFIRMACAO.OPERADOR]
      )
      disparo = rows[0]
    }

    // Mesma condição do envio pela Evolution: só promove quem ainda não conversou.
    await client.query(
      `UPDATE prospectador.prospects
          SET status = 'enviado', updated_at = NOW()
        WHERE empresa_id = $1 AND id = $2::uuid
          AND status IN ('coletado', 'contato_encontrado', 'aguardando', 'aprovado')`,
      [empresaId, prospectId]
    )

    // Auditoria: é um fato DECLARADO, e o registro precisa deixar isso explícito para quem ler
    // depois. Sem telefone e sem o texto da mensagem.
    await client.query(
      `INSERT INTO app.auditoria_eventos
         (empresa_id, usuario_id, entidade_tipo, entidade_id, acao, estado_novo, contexto)
       VALUES ($1, $2::uuid, 'prospect', $3::uuid, 'abordagem_manual_declarada', 'enviado', $4::jsonb)`,
      [empresaId, usuarioId || null, prospectId,
        JSON.stringify({ canal: A.CANAL.MANUAL_WA_ME, confirmado_por: A.CONFIRMACAO.OPERADOR })]
    )

    await client.query('COMMIT')
    return { ...disparo, prova: A.forcaDaProva(disparo) }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/** Histórico de abordagens de um lead, com a força de prova de cada uma já resolvida. */
async function historicoDoLead(pool, empresaId, prospectId, { limit = 20 } = {}) {
  const { rows } = await pool.query(
    `SELECT d.id, d.canal, d.status, d.confirmado_por, d.confirmado_em, d.criado_em,
            d.evolution_instance, u.nome AS usuario_nome
       FROM prospectador.lead_disparos d
       LEFT JOIN app.usuarios u ON u.id = d.usuario_id
      WHERE d.empresa_id = $1 AND d.prospect_id = $2::uuid
      ORDER BY d.criado_em DESC
      LIMIT $3`,
    [empresaId, prospectId, Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 100)]
  )
  // `mensagem` NÃO é devolvida: é o texto que foi (ou não) para o cliente, e o histórico responde
  // "quando e com que força de prova", não "o que foi dito".
  return rows.map((r) => ({ ...r, prova: A.forcaDaProva(r) }))
}

module.exports = {
  prepararAbordagem,
  registrarAbertura,
  marcarEnviadoManualmente,
  historicoDoLead,
}
