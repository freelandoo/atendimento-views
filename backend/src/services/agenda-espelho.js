'use strict'

// ESPELHO do bloqueio de agenda na agenda do BOT (vendas.agenda_eventos).
//
// ─── POR QUE ESTE MODULO EXISTE ────────────────────────────────────────────────────────
// Sao DUAS agendas que nao se enxergam. O bot oferece horario ao cliente lendo
// `vendas.agenda_eventos` (`eventosDoDia`/`slotEstaOcupado`, em src/agenda.js) e a tela grava em
// `app.agenda_eventos`. Sem espelho, **bloquear a agenda pela tela nao tem efeito nenhum sobre
// quem marca pelo WhatsApp**: o bot oferece o horario bloqueado, a validacao aprova, e a reuniao
// cai em cima do feriado.
//
// A decisao (operador, 2026-09-19) foi ESPELHAR, nao unificar — ver o cabecalho da migration 090.
// Espelhar deixa a leitura do bot intacta: para ele, o bloqueio simplesmente passa a existir.
//
// ─── A PERGUNTA QUE ESTE MODULO RESPONDE ───────────────────────────────────────────────
// Nao e' "qual agenda mandar?", e sim **"este evento precisa existir tambem para o bot?"**.
// A primeira pergunta admite resposta por heuristica; e' heuristica sobre qual agenda vale que
// produziria, de novo, dois calendarios discordando sobre o mesmo horario.
//
// SO' BLOQUEIO E' ESPELHADO, de proposito. Espelhar reuniao criaria a MESMA reuniao em dois
// lugares, e a linha de `vendas` carrega lembrete ao cliente, follow-up e conversao da Meta —
// duplicar isso mandaria mensagem repetida ao lead e conversao repetida a Meta, que nao se
// estorna. A reuniao da tela e' protegida por outro caminho: `existeConflito` passa a consultar
// as duas agendas antes de marcar (agenda-multiempresa.js).

const { logger } = require('../logger')

// Status da agenda do BOT que efetivamente ocupam horario. Espelha STATUS_OCUPA_HORARIO de
// src/agenda.js — o subconjunto que `eventosDoDia` usa para decidir o que esconde um slot.
const STATUS_OCUPA_BOT = Object.freeze(['pendente', 'confirmado', 'bloqueado'])

// O status com que o espelho nasce. `bloqueado` esta em STATUS_OCUPA_BOT (some da oferta de
// horario) e diz, para quem for ler a agenda do bot, que aquilo nao e' compromisso com cliente.
const STATUS_ESPELHO = 'bloqueado'

// Marca de origem: distingue o espelho de um bloqueio nascido no proprio bot. Sem ela, uma
// reconciliacao futura nao saberia qual linha pode apagar.
const ORIGEM_ESPELHO = 'espelho_app'

/**
 * REGRA PURA: este evento da tela precisa existir tambem na agenda do bot?
 *
 * Duas condicoes, e as duas importam:
 *   - `tipo === 'bloqueio'`: so' bloqueio e' espelhado (ver o cabecalho).
 *   - o status OCUPA horario: bloqueio cancelado nao esconde slot nenhum, entao espelha-lo
 *     deixaria o bot preso num horario que a tela ja liberou.
 *
 * @param {{tipo?: string, status?: string}} evento
 * @returns {boolean}
 */
function deveEspelhar(evento) {
  if (!evento || typeof evento !== 'object') return false
  if (evento.tipo !== 'bloqueio') return false
  return STATUS_OCUPA_BOT.includes(evento.status)
}

/**
 * Resolve o `usuario_id` do espelho. `vendas.agenda_eventos.usuario_id` e' NOT NULL e aponta para
 * `vendas.dashboard_users` — tabela que NAO tem traducao para `app.usuarios` (BIGINT x UUID).
 *
 * Usa o MESMO criterio de `criarEventoAgenda` (src/agenda.js): o primeiro usuario ativo. Nao e'
 * uma escolha de dono — e' o preenchimento de uma coluna obrigatoria de um mundo que nao conhece
 * o dono real. O bloqueio e' da EMPRESA e vale para todos; e as leituras do bot que decidem
 * oferta de horario (`buscarDisponibilidadeSemana`, `validarSlotReuniao`) sao chamadas SEM
 * `usuarioId` em todos os chamadores de producao (core-funnel.js), entao nao filtram por dono.
 * Alinhar com `criarEventoAgenda` garante que, se um dia passarem a filtrar, o espelho continue
 * dentro do mesmo recorte das reunioes que o proprio bot cria.
 *
 * @returns {Promise<number|null>} null = nao ha usuario ativo (nao da' para espelhar)
 */
async function resolverUsuarioEspelho(client) {
  const { rows } = await client.query(
    `SELECT id FROM vendas.dashboard_users WHERE ativo = true ORDER BY id LIMIT 1`
  )
  return rows.length ? Number(rows[0].id) : null
}

/**
 * Cria a linha espelhada na agenda do bot.
 *
 * Recebe `client` (nao `pool`) de proposito: o espelho nasce DENTRO da transacao do bloqueio.
 * Fora dela, um rollback do evento deixaria o bot bloqueado num horario que a tela nunca mostrou
 * — e ninguem teria como descobrir, porque nao restaria o `espelho_vendas_id` para segui-lo.
 *
 * @returns {Promise<number|null>} id da linha em vendas.agenda_eventos, ou null se nao deu
 */
async function criarEspelho(client, { empresaId, titulo, descricao, dataInicio, dataFim, timezone }) {
  const usuarioId = await resolverUsuarioEspelho(client)
  if (!usuarioId) {
    // Sem usuario ativo na agenda legada nao ha onde pendurar o espelho. Nao e' erro fatal: o
    // bloqueio da tela continua valendo para a tela. Quem decide o que fazer com isso e' o
    // chamador — que avisa a pessoa, em vez de deixa-la achar que o bot foi bloqueado.
    return null
  }
  const { rows } = await client.query(
    `INSERT INTO vendas.agenda_eventos
       (usuario_id, empresa_id, titulo, descricao, tipo, status, prioridade,
        data_inicio, data_fim, timezone, recorrente, origem, metadata)
     VALUES ($1,$2,$3,$4,'bloqueio',$5,'alta',$6,$7,$8,false,$9,$10::jsonb)
     RETURNING id`,
    [
      usuarioId,
      empresaId || null,
      String(titulo || 'Bloqueio').slice(0, 160),
      String(descricao || '').slice(0, 2000),
      STATUS_ESPELHO,
      dataInicio,
      dataFim,
      timezone || 'America/Sao_Paulo',
      ORIGEM_ESPELHO,
      JSON.stringify({ origem: ORIGEM_ESPELHO }),
    ]
  )
  return rows.length ? Number(rows[0].id) : null
}

/**
 * Propaga horario/titulo do bloqueio da tela para o espelho.
 * Escopado por `origem` para nunca alterar um evento que o proprio bot criou.
 */
async function atualizarEspelho(client, espelhoId, { titulo, descricao, dataInicio, dataFim }) {
  if (!espelhoId) return false
  const { rowCount } = await client.query(
    `UPDATE vendas.agenda_eventos
        SET titulo = COALESCE($2, titulo),
            descricao = COALESCE($3, descricao),
            data_inicio = COALESCE($4, data_inicio),
            data_fim = COALESCE($5, data_fim),
            atualizado_em = NOW()
      WHERE id = $1 AND origem = $6 AND excluido_em IS NULL`,
    [espelhoId, titulo || null, descricao || null, dataInicio || null, dataFim || null, ORIGEM_ESPELHO]
  )
  return rowCount > 0
}

/**
 * Remove o espelho (soft delete, como o resto da agenda do bot).
 *
 * Isto NAO e' opcional: sem a remocao, apagar o bloqueio na tela deixaria o bot recusando um
 * horario que ninguem mais ve em lugar nenhum — um bloqueio fantasma, permanente e invisivel.
 */
async function removerEspelho(client, espelhoId) {
  if (!espelhoId) return false
  const { rowCount } = await client.query(
    `UPDATE vendas.agenda_eventos
        SET excluido_em = NOW(), atualizado_em = NOW()
      WHERE id = $1 AND origem = $2 AND excluido_em IS NULL`,
    [espelhoId, ORIGEM_ESPELHO]
  )
  return rowCount > 0
}

/**
 * Eventos da agenda do BOT que ocupam horario numa janela.
 *
 * Existe para a DIRECAO INVERSA do espelho: a reuniao que o bot marcou com um cliente vive so' em
 * `vendas.agenda_eventos`, e sem esta consulta a tela deixaria o operador marcar em cima dela.
 *
 * O espelho e' EXCLUIDO do resultado (`origem <> ORIGEM_ESPELHO`) de proposito: ele e' o reflexo
 * de um evento que a tela ja contou; inclui-lo faria todo bloqueio conflitar consigo mesmo e
 * tornaria impossivel editar o proprio bloqueio.
 *
 * `empresa_id` e' NULLABLE em `vendas.agenda_eventos` (migration 077 nao fez backfill), entao a
 * consulta aceita a linha da empresa **ou sem empresa**: ignorar as sem empresa esconderia
 * justamente as reunioes antigas do bot, que sao a maioria.
 */
async function ocupacaoDoBot(pool, { empresaId, dataInicio, dataFim }) {
  try {
    const { rows } = await pool.query(
      `SELECT id, titulo, data_inicio, data_fim
         FROM vendas.agenda_eventos
        WHERE excluido_em IS NULL
          AND status = ANY($1::text[])
          AND origem IS DISTINCT FROM $2
          AND (empresa_id = $3::uuid OR empresa_id IS NULL)
          AND data_inicio < $5
          AND data_fim > $4`,
      [STATUS_OCUPA_BOT, ORIGEM_ESPELHO, empresaId || null, dataInicio, dataFim]
    )
    return rows
  } catch (err) {
    // A agenda do bot e' uma fonte AUXILIAR para a tela. Se ela falhar, a checagem de conflito
    // da propria tela (app.agenda_eventos) continua valendo — degradar e' melhor que derrubar a
    // marcacao. O silencio, porem, seria pior: fica no log.
    logger.warn('[agenda-espelho] falha ao consultar a agenda do bot:', err.message)
    return []
  }
}

module.exports = {
  STATUS_OCUPA_BOT,
  STATUS_ESPELHO,
  ORIGEM_ESPELHO,
  deveEspelhar,
  criarEspelho,
  atualizarEspelho,
  removerEspelho,
  ocupacaoDoBot,
}
