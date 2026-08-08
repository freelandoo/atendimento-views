'use strict'

// Acesso ao ledger app.conversao_eventos + app.conversao_tentativas.
//
// Invariante deste módulo: NENHUMA função escreve ou lê o ledger sem `empresaId`.
// Não é zelo estético — é o que faz valer o critério de aceite "nenhum evento é
// enviado sem empresa_id" mesmo quando alguém, daqui a um ano, escrever um caminho
// novo sem lembrar dessa regra. Se a empresa faltar, o módulo lança.
//
// `pool` (ou um client de transação) é sempre injetado.

const { mensagemDeMotivo, minutosAteProximaTentativa, mascararTelefone } = require('../services/meta-conversao')

function erro(code, message, statusCode = 400) {
  const e = new Error(message)
  e.code = code
  e.statusCode = statusCode
  return e
}

function exigirEmpresa(empresaId) {
  if (!empresaId) throw erro('SEM_EMPRESA', 'Evento de conversão sem empresa — envio bloqueado.', 400)
  return empresaId
}

/**
 * Registra um fato de conversão. IDEMPOTENTE por (empresa_id, event_id).
 *
 * Chamar duas vezes com o mesmo fato NÃO cria segunda linha e NÃO reenvia nada:
 * o índice único resolve a corrida no banco, não na aplicação. Devolve
 * `{ criado: false }` quando a linha já existia — é assim que o reconciliador pode
 * rodar a cada tick sem gerar duplicidade.
 *
 * Eventos ignorados (sem atribuição, evento desligado, reunião cancelada) também são
 * gravados, com `status='ignorado'` e o motivo: é o que permite a tela responder
 * "por que esta reunião não virou conversão?" sem ninguém abrir o banco.
 */
async function registrarEvento(pool, empresaId, fato = {}) {
  exigirEmpresa(empresaId)
  const {
    tipo, eventId, entidadeTipo, entidadeId, telefoneNorm = null,
    ocorridoEm, valor = null, moeda = null,
    status = 'pendente', motivoIgnorado = null,
  } = fato
  if (!eventId) throw erro('SEM_EVENT_ID', 'Evento de conversão sem chave de idempotência.', 400)
  if (!ocorridoEm) throw erro('SEM_DATA', 'Evento de conversão sem data do fato.', 400)

  const { rows } = await pool.query(
    `INSERT INTO app.conversao_eventos
       (empresa_id, tipo, event_id, entidade_tipo, entidade_id, telefone_norm,
        ocorrido_em, valor, moeda, status, motivo_ignorado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (empresa_id, event_id) DO NOTHING
     RETURNING *`,
    [empresaId, tipo, eventId, entidadeTipo, String(entidadeId), telefoneNorm,
      ocorridoEm, valor, moeda, status, motivoIgnorado]
  )
  return { criado: rows.length > 0, evento: rows[0] || null }
}

// Quanto tempo um evento reservado fica invisível para outros workers. Se o processo
// morrer no meio do envio, a reserva expira sozinha e o evento é tentado de novo — a
// Meta deduplica pelo event_id, então repetir é seguro por construção.
const LEASE_MINUTOS = 10

/**
 * Reserva um lote de eventos pendentes DESTA empresa para envio.
 *
 * Faz a reserva numa transação CURTA (`FOR UPDATE SKIP LOCKED` + empurrar
 * `proxima_tentativa_em`) e devolve as linhas. O envio HTTP acontece FORA da
 * transação de propósito: segurar lock de banco durante chamada de rede é como se
 * transforma uma indisponibilidade da Meta em contenção no Postgres.
 *
 * Dois ticks concorrentes (ou duas instâncias do backend) nunca enviam o mesmo
 * evento: quem perde a corrida não enxerga a linha, e o UPDATE final ainda exige
 * `status='pendente'`.
 */
async function reservarPendentes(pool, empresaId, { limite = 25 } = {}) {
  exigirEmpresa(empresaId)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT * FROM app.conversao_eventos
        WHERE empresa_id = $1
          AND status = 'pendente'
          AND proxima_tentativa_em <= NOW()
        ORDER BY ocorrido_em ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED`,
      [empresaId, Math.min(Math.max(Number(limite) || 25, 1), 200)]
    )
    if (rows.length) {
      await client.query(
        `UPDATE app.conversao_eventos
            SET proxima_tentativa_em = NOW() + ($2 || ' minutes')::interval
          WHERE id = ANY($1::uuid[])`,
        [rows.map((r) => r.id), String(LEASE_MINUTOS)]
      )
    }
    await client.query('COMMIT')
    return rows
  } catch (e) {
    try { await client.query('ROLLBACK') } catch (_) { /* conexão já perdida */ }
    throw e
  } finally {
    client.release()
  }
}

async function marcarEnviado(pool, empresaId, eventoId) {
  exigirEmpresa(empresaId)
  const { rows } = await pool.query(
    `UPDATE app.conversao_eventos
        SET status = 'enviado', enviado_em = NOW(), ultimo_erro = NULL,
            tentativas = tentativas + 1, atualizado_em = NOW()
      WHERE id = $1 AND empresa_id = $2 AND status = 'pendente'
      RETURNING id`,
    [eventoId, empresaId]
  )
  return rows.length > 0
}

/**
 * Registra a falha. `definitiva=true` encerra o evento em 'falhou' (reenviável pela
 * tela); senão ele volta para 'pendente' com backoff.
 */
async function marcarFalha(pool, empresaId, eventoId, { definitiva, mensagem, tentativas }) {
  exigirEmpresa(empresaId)
  const minutos = minutosAteProximaTentativa((Number(tentativas) || 0) + 1)
  const { rows } = await pool.query(
    `UPDATE app.conversao_eventos
        SET status = $3,
            tentativas = tentativas + 1,
            ultimo_erro = $4,
            proxima_tentativa_em = CASE
              WHEN $3 = 'pendente' THEN NOW() + ($5 || ' minutes')::interval
              ELSE proxima_tentativa_em
            END,
            atualizado_em = NOW()
      WHERE id = $1 AND empresa_id = $2 AND status = 'pendente'
      RETURNING id`,
    [eventoId, empresaId, definitiva ? 'falhou' : 'pendente',
      mensagem ? String(mensagem).slice(0, 500) : null, String(minutos)]
  )
  return rows.length > 0
}

/** Encerra um evento sem envio (integração desligada, evento desabilitado...). */
async function marcarIgnorado(pool, empresaId, eventoId, motivo) {
  exigirEmpresa(empresaId)
  await pool.query(
    `UPDATE app.conversao_eventos
        SET status = 'ignorado', motivo_ignorado = $3, atualizado_em = NOW()
      WHERE id = $1 AND empresa_id = $2 AND status = 'pendente'`,
    [eventoId, empresaId, String(motivo || '').slice(0, 100)]
  )
}

/**
 * O valor da venda mudou depois de o fato já ter sido registrado. Dois casos, e a
 * diferença entre eles é o que separa correção de inflação de receita:
 *
 *  - ainda 'pendente' (nada foi para a Meta): CORRIGE o valor e envia o certo.
 *  - já 'enviado': NÃO reenvia. O primeiro envio aceito é o registro externo válido
 *    e a Meta não estorna; a correção fica auditada em `valor_corrigido` e o evento
 *    passa a 'corrigido', visível na tela. Reenviar valor novo com event_id novo é
 *    exatamente como se infla ROAS sem ninguém perceber.
 *
 * Chave por (empresa_id, event_id): não existe caminho aqui que corrija evento de
 * outra empresa.
 */
async function sincronizarValorVenda(pool, empresaId, eventId, novoValor) {
  exigirEmpresa(empresaId)
  const valor = novoValor == null ? null : Number(novoValor)
  const { rows } = await pool.query(
    `UPDATE app.conversao_eventos
        SET valor           = CASE WHEN status = 'pendente' THEN $3 ELSE valor END,
            valor_corrigido = CASE WHEN status = 'enviado'  THEN $3 ELSE valor_corrigido END,
            corrigido_em    = CASE WHEN status = 'enviado'  THEN NOW() ELSE corrigido_em END,
            status          = CASE WHEN status = 'enviado'  THEN 'corrigido' ELSE status END,
            atualizado_em   = NOW()
      WHERE empresa_id = $1 AND event_id = $2
        AND status IN ('pendente', 'enviado')
        AND valor IS DISTINCT FROM $3
      RETURNING id, status`,
    [empresaId, eventId, valor]
  )
  return rows[0] || null
}

/** Uma linha por tentativa. Guarda diagnóstico estruturado, nunca o corpo cru. */
async function registrarTentativa(pool, empresaId, eventoId, t = {}) {
  exigirEmpresa(empresaId)
  await pool.query(
    `INSERT INTO app.conversao_tentativas
       (evento_id, empresa_id, numero_tentativa, ok, http_status, erro_codigo,
        erro_subcodigo, erro_mensagem, fbtrace_id, duracao_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [eventoId, empresaId, Number(t.numeroTentativa) || 1, t.ok === true,
      t.httpStatus ?? null, t.codigo ?? null, t.subcodigo ?? null,
      t.mensagem ? String(t.mensagem).slice(0, 500) : null,
      t.fbtraceId || null, t.duracaoMs ?? null]
  )
}

/**
 * Devolve um evento 'falhou' para a fila. Preserva o `event_id`, então a Meta
 * deduplica e o reenvio nunca cria conversão dobrada. Zera o orçamento de
 * tentativas porque a decisão de tentar de novo foi humana e deliberada.
 */
async function reenviar(pool, empresaId, eventoId) {
  exigirEmpresa(empresaId)
  const { rows } = await pool.query(
    `UPDATE app.conversao_eventos
        SET status = 'pendente', tentativas = 0, proxima_tentativa_em = NOW(),
            ultimo_erro = NULL, atualizado_em = NOW()
      WHERE id = $1 AND empresa_id = $2 AND status = 'falhou'
      RETURNING *`,
    [eventoId, empresaId]
  )
  if (!rows[0]) {
    throw erro('NAO_REENVIAVEL', 'Só é possível reenviar um evento que falhou.', 409)
  }
  return paraApi(rows[0])
}

/** Devolve TODOS os eventos falhos da empresa para a fila. Retorna a quantidade. */
async function reenviarFalhas(pool, empresaId) {
  exigirEmpresa(empresaId)
  const { rowCount } = await pool.query(
    `UPDATE app.conversao_eventos
        SET status = 'pendente', tentativas = 0, proxima_tentativa_em = NOW(),
            ultimo_erro = NULL, atualizado_em = NOW()
      WHERE empresa_id = $1 AND status = 'falhou'`,
    [empresaId]
  )
  return { reenfileirados: rowCount || 0 }
}

/**
 * Forma para a tela. Telefone MASCARADO e sem `event_id` cru — a chave contém o id
 * interno da entidade e não acrescenta nada ao operador.
 */
function paraApi(row) {
  if (!row) return null
  return {
    id: row.id,
    tipo: row.tipo,
    event_name: row.event_name || null,
    origem: row.entidade_tipo === 'agenda_vendas' ? 'Reunião do atendimento' : 'Reunião da agenda',
    telefone: mascararTelefone(row.telefone_norm),
    ocorrido_em: row.ocorrido_em,
    valor: row.valor != null ? Number(row.valor) : null,
    moeda: row.moeda || null,
    valor_corrigido: row.valor_corrigido != null ? Number(row.valor_corrigido) : null,
    corrigido_em: row.corrigido_em || null,
    status: row.status,
    motivo: row.motivo_ignorado ? mensagemDeMotivo(row.motivo_ignorado) : null,
    erro: row.ultimo_erro || null,
    tentativas: Number(row.tentativas) || 0,
    enviado_em: row.enviado_em || null,
    // A tela só oferece "Reenviar" no que de fato pode ser reenviado.
    pode_reenviar: row.status === 'falhou',
  }
}

/** Histórico recente da empresa, com filtro opcional por status. */
async function listarHistorico(pool, empresaId, { status = null, limite = 50 } = {}) {
  exigirEmpresa(empresaId)
  const { rows } = await pool.query(
    `SELECT * FROM app.conversao_eventos
      WHERE empresa_id = $1
        AND ($2::text IS NULL OR status = $2::text)
      ORDER BY ocorrido_em DESC, criado_em DESC
      LIMIT $3`,
    [empresaId, status, Math.min(Math.max(Number(limite) || 50, 1), 200)]
  )
  return rows.map(paraApi)
}

/** Contadores do topo da tela. Sem isto, integração quebrada fica invisível. */
async function resumoPorStatus(pool, empresaId) {
  exigirEmpresa(empresaId)
  const { rows } = await pool.query(
    `SELECT status, COUNT(*)::int AS n
       FROM app.conversao_eventos
      WHERE empresa_id = $1
      GROUP BY status`,
    [empresaId]
  )
  const base = { pendente: 0, enviado: 0, falhou: 0, ignorado: 0, corrigido: 0 }
  for (const r of rows) base[r.status] = Number(r.n) || 0
  return base
}

/** Grava o nome enviado à Meta (resolvido no envio, não no registro do fato). */
async function definirEventName(pool, empresaId, eventoId, eventName) {
  exigirEmpresa(empresaId)
  await pool.query(
    `UPDATE app.conversao_eventos SET event_name = $3, atualizado_em = NOW()
      WHERE id = $1 AND empresa_id = $2`,
    [eventoId, empresaId, eventName]
  )
}

module.exports = {
  registrarEvento,
  reservarPendentes,
  marcarEnviado,
  marcarFalha,
  marcarIgnorado,
  sincronizarValorVenda,
  registrarTentativa,
  reenviar,
  reenviarFalhas,
  listarHistorico,
  resumoPorStatus,
  definirEventName,
  paraApi,
}
