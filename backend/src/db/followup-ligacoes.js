'use strict'
// Fase 2 dos Follow-ups: registro e metricas das LIGACOES do modo Semi. Acesso a banco
// isolado. Tabela criada pela migration 030. Isolado por empresa; casa por numero.
const RESULTADOS = new Set(['atendeu', 'nao_atendeu', 'agendou', 'sem_interesse', 'ligar_depois'])

function erroEntrada(message) {
  const err = new Error(message)
  err.statusCode = 400
  return err
}

function validarEnvioAposLigacao(resultado, enviarFollowup) {
  if (enviarFollowup === true && resultado !== 'nao_atendeu') {
    const err = new Error('O follow-up no WhatsApp so pode ser enviado quando o resultado for nao_atendeu.')
    err.statusCode = 400
    throw err
  }
}

// Registra o resultado de uma ligacao. Efeito colateral determinado pelo resultado:
//   sem_interesse -> pausa o agente do lead (agente_pausado=true), tirando-o do
//   auto follow-up e da call-list (que filtra agente_pausado=false). Isso e a mesma
//   semantica de opt-out ja usada pelo motor.
async function registrarLigacao(pool, { empresaId, numero, resultado, notas, usuarioId }) {
  const jid = String(numero || '').trim()
  if (!jid) throw erroEntrada('numero e obrigatorio.')
  if (!RESULTADOS.has(resultado)) throw erroEntrada('resultado invalido.')
  const notasLimpa = notas != null && String(notas).trim() ? String(notas).trim().slice(0, 2000) : null

  // INSERT + pausa formam uma unica operacao atomica: nunca grava "sem interesse"
  // deixando o agente ativo se o UPDATE falhar no meio do caminho.
  const { rows } = await pool.query(
    `WITH registro AS (
       INSERT INTO vendas.followup_ligacoes (empresa_id, numero, resultado, notas, usuario_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, empresa_id, numero, resultado, notas, usuario_id, criado_em
     ), pausa AS (
       UPDATE vendas.conversas
          SET agente_pausado = true, atualizado_em = NOW()
        WHERE $3::text = 'sem_interesse'
          AND numero = $2
          AND empresa_id = $1
          AND COALESCE(agente_pausado, false) = false
       RETURNING numero
     )
     SELECT * FROM registro`,
    [empresaId, jid, resultado, notasLimpa, usuarioId || null]
  )
  return rows[0]
}

// Historico recente de ligacoes de um lead (para mostrar no painel).
async function listarLigacoesLead(pool, empresaId, numero, limit = 10) {
  const { rows } = await pool.query(
    `SELECT id, resultado, notas, usuario_id, criado_em
       FROM vendas.followup_ligacoes
      WHERE empresa_id = $1 AND numero = $2
      ORDER BY criado_em DESC
      LIMIT $3`,
    [empresaId, String(numero || '').trim(), Math.min(Math.max(Number.parseInt(limit, 10) || 10, 1), 50)]
  )
  return rows
}

// Metricas do periodo (default 30 dias): total, quebra por resultado, taxa de
// agendamento (agendou / total) e ligacoes de hoje.
async function metricasLigacoes(pool, empresaId, dias = 30) {
  const janela = Math.min(Math.max(Number.parseInt(dias, 10) || 30, 1), 365)
  const { rows } = await pool.query(
    `SELECT resultado, COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE criado_em::date = NOW()::date)::int AS hoje
       FROM vendas.followup_ligacoes
      WHERE empresa_id = $1 AND criado_em >= NOW() - ($2::int * INTERVAL '1 day')
      GROUP BY resultado`,
    [empresaId, janela]
  )
  const porResultado = { atendeu: 0, nao_atendeu: 0, agendou: 0, sem_interesse: 0, ligar_depois: 0 }
  let total = 0
  let hoje = 0
  for (const r of rows) {
    porResultado[r.resultado] = r.total
    total += r.total
    hoje += r.hoje
  }
  const taxaAgendamento = total > 0 ? Math.round((porResultado.agendou / total) * 100) : 0
  return { dias: janela, total, hoje, por_resultado: porResultado, taxa_agendamento: taxaAgendamento }
}

module.exports = {
  registrarLigacao,
  listarLigacoesLead,
  metricasLigacoes,
  validarEnvioAposLigacao,
  RESULTADOS,
}
