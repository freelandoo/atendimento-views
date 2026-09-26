'use strict'

const { CAPACIDADES: CAP, podeCapacidade } = require('./acesso-capacidades')

const TIMEZONE = 'America/Sao_Paulo'
const LIMITE_ITENS = 8
const LIMITE_ARQUIVADAS = 30

const PESO_PRIORIDADE = Object.freeze({ critica: 0, alta: 1, media: 2, baixa: 3 })
const ESTADOS_OCULTOS = new Set(['arquivada', 'apagada'])

function vinculoReq(req = {}) {
  return {
    papel: req.papelEmpresa,
    permissoes: req.vinculoEmpresa ? req.vinculoEmpresa.permissoes : null,
    papelPlataforma: req.usuario?.role,
  }
}

function tem(req, capacidade) {
  return podeCapacidade(vinculoReq(req), capacidade)
}

function numero(n) {
  return Number(n || 0)
}

function plural(n, singular, pluralLabel) {
  return n === 1 ? singular : pluralLabel
}

function iso(d) {
  return d instanceof Date ? d.toISOString() : (d || null)
}

function usuarioId(req = {}) {
  return req.usuario?.id || null
}

function usuarioIdObrigatorio(req = {}) {
  const id = usuarioId(req)
  if (!id) {
    const err = new Error('Usuario autenticado e obrigatorio.')
    err.statusCode = 401
    throw err
  }
  return id
}

function validarNotificacaoId(id) {
  const v = String(id || '').trim()
  if (!v || v.length > 160 || /[\r\n\t]/.test(v)) {
    const err = new Error('notificacao_id invalido.')
    err.statusCode = 400
    throw err
  }
  return v
}

function addItem(itens, item) {
  if (!item || !item.total) return
  itens.push({
    id: item.id,
    tipo: item.tipo,
    grupo: item.grupo,
    prioridade: item.prioridade || 'media',
    titulo: item.titulo,
    descricao: item.descricao || null,
    total: numero(item.total),
    quando: iso(item.quando),
    destino_url: item.destino_url,
    acao_label: item.acao_label || 'Abrir',
  })
}

function itemDeLinhaArquivada(row) {
  return {
    id: row.notificacao_id,
    tipo: row.tipo || 'notificacao',
    grupo: row.grupo || 'Notificacoes',
    prioridade: row.prioridade || 'baixa',
    titulo: row.titulo,
    descricao: row.descricao || null,
    total: numero(row.total),
    quando: iso(row.quando || row.atualizado_em),
    destino_url: row.destino_url || '#',
    acao_label: row.acao_label || 'Abrir',
    estado: row.estado,
    arquivada_em: iso(row.atualizado_em),
  }
}

function snapshot(item, fallbackId) {
  const id = validarNotificacaoId(item?.id || item?.notificacao_id || fallbackId)
  return {
    id,
    tipo: String(item?.tipo || 'notificacao').slice(0, 80),
    grupo: String(item?.grupo || 'Notificacoes').slice(0, 80),
    prioridade: item?.prioridade || 'baixa',
    titulo: String(item?.titulo || 'Notificacao').slice(0, 220),
    descricao: item?.descricao ? String(item.descricao).slice(0, 500) : null,
    total: Math.max(0, numero(item?.total)),
    quando: item?.quando || null,
    destino_url: item?.destino_url || null,
    acao_label: item?.acao_label || null,
  }
}

async function coletarAtuais(pool, req) {
  const partes = await Promise.all([
    coletarFollowUps(pool, req),
    coletarAgenda(pool, req),
    coletarLigacoes(pool, req),
    coletarInstancias(pool, req),
  ])
  return ordenarItens(partes.flat())
}

async function estadosPorId(pool, req, ids = []) {
  const userId = usuarioId(req)
  const limpos = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))]
  if (!userId || limpos.length === 0) return new Map()
  const { rows } = await pool.query(
    `SELECT notificacao_id, estado
       FROM app.notificacao_centro_estado
      WHERE empresa_id = $1
        AND usuario_id = $2
        AND notificacao_id = ANY($3::text[])`,
    [req.empresa.id, userId, limpos]
  )
  return new Map(rows.map((r) => [r.notificacao_id, r.estado]))
}

async function contarArquivadas(pool, req) {
  const userId = usuarioId(req)
  if (!userId) return 0
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total
       FROM app.notificacao_centro_estado
      WHERE empresa_id = $1
        AND usuario_id = $2
        AND estado = 'arquivada'`,
    [req.empresa.id, userId]
  )
  return numero(rows[0]?.total)
}

async function listarArquivadas(pool, req) {
  const userId = usuarioIdObrigatorio(req)
  const { rows } = await pool.query(
    `SELECT notificacao_id, estado, tipo, grupo, prioridade, titulo, descricao, total,
            quando, destino_url, acao_label, atualizado_em,
            COUNT(*) OVER()::int AS total_arquivadas
       FROM app.notificacao_centro_estado
      WHERE empresa_id = $1
        AND usuario_id = $2
        AND estado = 'arquivada'
      ORDER BY atualizado_em DESC
      LIMIT $3`,
    [req.empresa.id, userId, LIMITE_ARQUIVADAS]
  )
  const itens = rows.map(itemDeLinhaArquivada)
  return montarResposta(itens, { arquivadas: numero(rows[0]?.total_arquivadas), modo: 'arquivadas' })
}

function montarResposta(itens, extra = {}) {
  const total = itens.reduce((s, item) => s + item.total, 0)
  const criticas = itens.filter((item) => item.prioridade === 'critica').reduce((s, item) => s + item.total, 0)
  const arquivadas = Number(extra.arquivadas) || 0
  const rotulo = extra.modo === 'arquivadas'
    ? (arquivadas === 1 ? '1 notificacao arquivada' : `${arquivadas} notificacoes arquivadas`)
    : (total
        ? `${total} ${plural(total, 'lembrete ativo', 'lembretes ativos')}`
        : 'Sem lembretes ativos')
  return {
    itens,
    resumo: {
      total,
      criticas,
      grupos: Object.fromEntries(
        Object.entries(itens.reduce((acc, item) => {
          acc[item.grupo] = (acc[item.grupo] || 0) + item.total
          return acc
        }, {})).sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
      ),
      rotulo,
      ...extra,
    },
  }
}

function filtroUsuarioFollowUp(req, params) {
  if (tem(req, CAP.FOLLOWUP_VER_FILA)) return ''
  const usuarioId = req.usuario?.id || null
  if (!usuarioId) return 'AND false'
  params.push(usuarioId)
  const ph = `$${params.length}`
  return `AND (f.responsavel_id = ${ph}::uuid OR (f.responsavel_id IS NULL AND f.criado_por = ${ph}::uuid))`
}

function filtroUsuarioAgenda(req, params) {
  if (tem(req, CAP.AGENDA_VER_EQUIPE)) return ''
  const usuarioId = req.usuario?.id || null
  if (!usuarioId) return 'AND false'
  params.push(usuarioId)
  const ph = `$${params.length}`
  // Eventos sem responsavel existiam antes da agenda por equipe e continuam visiveis
  // para nao sumirem do dia de quem opera a propria agenda.
  return `AND (ae.responsavel_id = ${ph}::uuid OR ae.responsavel_id IS NULL)`
}

function filtroUsuarioLigacoes(req, params) {
  if (tem(req, CAP.LIGACAO_VER_TODAS)) return ''
  const usuarioId = req.usuario?.id || null
  if (!usuarioId) return 'AND false'
  params.push(usuarioId)
  return `AND l.usuario_id = $${params.length}::uuid`
}

function filtroInstancias(req, params) {
  if (tem(req, CAP.INSTANCIA_GERENCIAR_EMPRESA)) return ''
  const usuarioId = req.usuario?.id || null
  if (!usuarioId) return 'AND false'
  params.push(usuarioId)
  return `AND ewi.usuario_id = $${params.length}::uuid`
}

async function coletarFollowUps(pool, req) {
  if (!tem(req, CAP.FOLLOWUP_OPERAR)) return []
  const params = [req.empresa.id, TIMEZONE]
  const filtro = filtroUsuarioFollowUp(req, params)
  const { rows } = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE f.agendado_para < NOW())::int AS vencidos,
        MIN(f.agendado_para) FILTER (WHERE f.agendado_para < NOW()) AS vencido_mais_antigo,
        COUNT(*) FILTER (
          WHERE f.agendado_para >= NOW()
            AND f.agendado_para >= (date_trunc('day', NOW() AT TIME ZONE $2) AT TIME ZONE $2)
            AND f.agendado_para < ((date_trunc('day', NOW() AT TIME ZONE $2) + INTERVAL '1 day') AT TIME ZONE $2)
        )::int AS hoje,
        MIN(f.agendado_para) FILTER (
          WHERE f.agendado_para >= NOW()
            AND f.agendado_para >= (date_trunc('day', NOW() AT TIME ZONE $2) AT TIME ZONE $2)
            AND f.agendado_para < ((date_trunc('day', NOW() AT TIME ZONE $2) + INTERVAL '1 day') AT TIME ZONE $2)
        ) AS proximo_hoje,
        COUNT(*) FILTER (WHERE f.canal = 'ligacao' AND f.agendado_para <= NOW())::int AS ligacoes_vencidas,
        MAX(f.criado_em) AS atualizado_em
       FROM app.follow_ups f
      WHERE f.empresa_id = $1
        AND f.status = 'aguardando'
        ${filtro}`,
    params
  )
  const r = rows[0] || {}
  const itens = []
  const vencidos = numero(r.vencidos)
  addItem(itens, {
    id: 'followups:vencidos',
    tipo: 'follow_up_vencido',
    grupo: 'Follow-ups',
    prioridade: vencidos >= 5 ? 'critica' : 'alta',
    titulo: vencidos === 1 ? '1 follow-up passou do prazo' : `${vencidos} follow-ups passaram do prazo`,
    descricao: 'Resolva, reagende ou cancele os retornos vencidos.',
    total: vencidos,
    quando: r.vencido_mais_antigo,
    destino_url: '/dashboard/follow-ups?rapido=vencidos',
    acao_label: 'Abrir Follow-ups',
  })
  const ligacoes = numero(r.ligacoes_vencidas)
  addItem(itens, {
    id: 'followups:ligacoes',
    tipo: 'ligacao_followup',
    grupo: 'Ligações',
    prioridade: 'alta',
    titulo: ligacoes === 1 ? '1 ligação de follow-up pronta' : `${ligacoes} ligações de follow-up prontas`,
    descricao: 'Leads cujo próximo passo é ligação agora.',
    total: ligacoes,
    quando: r.proximo_hoje || r.vencido_mais_antigo || r.atualizado_em,
    destino_url: '/dashboard/follow-ups?rapido=ligacao',
    acao_label: 'Abrir fila',
  })
  const hoje = numero(r.hoje)
  addItem(itens, {
    id: 'followups:hoje',
    tipo: 'follow_up_hoje',
    grupo: 'Follow-ups',
    prioridade: 'media',
    titulo: hoje === 1 ? '1 follow-up para hoje' : `${hoje} follow-ups para hoje`,
    descricao: 'Retornos ainda dentro do prazo de hoje.',
    total: hoje,
    quando: r.proximo_hoje,
    destino_url: '/dashboard/follow-ups?rapido=hoje',
    acao_label: 'Ver hoje',
  })
  return itens
}

async function coletarAgenda(pool, req) {
  if (!tem(req, CAP.AGENDA_OPERAR_PROPRIA)) return []
  const params = [req.empresa.id, TIMEZONE]
  const filtro = filtroUsuarioAgenda(req, params)
  const { rows } = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE ae.data_fim < NOW())::int AS atrasadas,
        MIN(ae.data_fim) FILTER (WHERE ae.data_fim < NOW()) AS atrasada_mais_antiga,
        COUNT(*) FILTER (WHERE ae.data_inicio >= NOW() AND ae.data_inicio <= NOW() + INTERVAL '2 hours')::int AS proximas,
        MIN(ae.data_inicio) FILTER (WHERE ae.data_inicio >= NOW() AND ae.data_inicio <= NOW() + INTERVAL '2 hours') AS proxima_em,
        COUNT(*) FILTER (
          WHERE ae.data_inicio > NOW() + INTERVAL '2 hours'
            AND ae.data_inicio >= (date_trunc('day', NOW() AT TIME ZONE $2) AT TIME ZONE $2)
            AND ae.data_inicio < ((date_trunc('day', NOW() AT TIME ZONE $2) + INTERVAL '1 day') AT TIME ZONE $2)
        )::int AS hoje_restantes,
        MIN(ae.data_inicio) FILTER (
          WHERE ae.data_inicio > NOW() + INTERVAL '2 hours'
            AND ae.data_inicio >= (date_trunc('day', NOW() AT TIME ZONE $2) AT TIME ZONE $2)
            AND ae.data_inicio < ((date_trunc('day', NOW() AT TIME ZONE $2) + INTERVAL '1 day') AT TIME ZONE $2)
        ) AS primeira_hoje
       FROM app.agenda_eventos ae
      WHERE ae.empresa_id = $1
        AND ae.excluido_em IS NULL
        AND ae.tipo = 'reuniao'
        AND ae.status IN ('pendente', 'confirmado')
        ${filtro}`,
    params
  )
  const r = rows[0] || {}
  const itens = []
  const atrasadas = numero(r.atrasadas)
  addItem(itens, {
    id: 'agenda:atrasadas',
    tipo: 'reuniao_atrasada',
    grupo: 'Agenda',
    prioridade: 'critica',
    titulo: atrasadas === 1 ? '1 reunião sem desfecho' : `${atrasadas} reuniões sem desfecho`,
    descricao: 'Marque como concluída, no-show ou reagende.',
    total: atrasadas,
    quando: r.atrasada_mais_antiga,
    destino_url: '/dashboard/agenda',
    acao_label: 'Abrir Agenda',
  })
  const proximas = numero(r.proximas)
  addItem(itens, {
    id: 'agenda:proximas',
    tipo: 'reuniao_proxima',
    grupo: 'Agenda',
    prioridade: 'alta',
    titulo: proximas === 1 ? '1 reunião nas próximas 2h' : `${proximas} reuniões nas próximas 2h`,
    descricao: 'Compromissos próximos para preparar agora.',
    total: proximas,
    quando: r.proxima_em,
    destino_url: '/dashboard/agenda',
    acao_label: 'Ver agenda',
  })
  const hoje = numero(r.hoje_restantes)
  addItem(itens, {
    id: 'agenda:hoje',
    tipo: 'reuniao_hoje',
    grupo: 'Agenda',
    prioridade: 'media',
    titulo: hoje === 1 ? '1 reunião restante hoje' : `${hoje} reuniões restantes hoje`,
    descricao: 'Reuniões de hoje fora da janela imediata.',
    total: hoje,
    quando: r.primeira_hoje,
    destino_url: '/dashboard/agenda',
    acao_label: 'Abrir Agenda',
  })
  return itens
}

async function coletarLigacoes(pool, req) {
  if (!tem(req, CAP.LIGACAO_OPERAR)) return []
  const params = [req.empresa.id]
  const filtro = filtroUsuarioLigacoes(req, params)
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS ativas,
            MIN(l.iniciada_em) AS primeira
       FROM app.ligacoes l
      WHERE l.empresa_id = $1
        AND l.status = 'em_andamento'
        AND l.chamada_encerrada_em IS NULL
        ${filtro}`,
    params
  )
  const r = rows[0] || {}
  const ativas = numero(r.ativas)
  const itens = []
  addItem(itens, {
    id: 'ligacoes:ativas',
    tipo: 'ligacao_ativa',
    grupo: 'Ligações',
    prioridade: 'media',
    titulo: ativas === 1 ? '1 ligação em andamento' : `${ativas} ligações em andamento`,
    descricao: 'Há sessão de ligação aberta aguardando condução ou resumo.',
    total: ativas,
    quando: r.primeira,
    destino_url: '/dashboard/central-ligacoes',
    acao_label: 'Abrir ligações',
  })
  return itens
}

async function coletarInstancias(pool, req) {
  if (!tem(req, CAP.INSTANCIA_GERENCIAR_PROPRIA)) return []
  const params = [req.empresa.id]
  const filtro = filtroInstancias(req, params)
  const { rows } = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE ativo = false)::int AS inativas,
            MAX(atualizado_em) AS atualizado_em
       FROM app.empresa_whatsapp_instances ewi
      WHERE ewi.empresa_id = $1
        ${filtro}`,
    params
  )
  const r = rows[0] || {}
  const itens = []
  const inativas = numero(r.inativas)
  addItem(itens, {
    id: 'instancias:inativas',
    tipo: 'instancia_inativa',
    grupo: 'Instâncias',
    prioridade: 'alta',
    titulo: inativas === 1 ? '1 instância desativada' : `${inativas} instâncias desativadas`,
    descricao: 'Revise antes de depender dela para avisos ou atendimento.',
    total: inativas,
    quando: r.atualizado_em,
    destino_url: '/dashboard/contextos',
    acao_label: 'Ver instâncias',
  })
  return itens
}

function ordenarItens(itens) {
  return [...itens].sort((a, b) => {
    const p = (PESO_PRIORIDADE[a.prioridade] ?? 9) - (PESO_PRIORIDADE[b.prioridade] ?? 9)
    if (p !== 0) return p
    return new Date(b.quando || 0).getTime() - new Date(a.quando || 0).getTime()
  })
}

async function listarNotificacoes(pool, req, opts = {}) {
  if (opts.estado === 'arquivadas') return listarArquivadas(pool, req)
  const atuais = await coletarAtuais(pool, req)
  const estados = await estadosPorId(pool, req, atuais.map((item) => item.id))
  const itens = atuais
    .filter((item) => !ESTADOS_OCULTOS.has(estados.get(item.id)))
    .slice(0, LIMITE_ITENS)
  return montarResposta(itens, {
    arquivadas: await contarArquivadas(pool, req),
    modo: 'ativas',
  })
}

async function definirEstadoNotificacao(pool, req, notificacaoId, estado) {
  if (!ESTADOS_OCULTOS.has(estado)) {
    const err = new Error('estado invalido.')
    err.statusCode = 400
    throw err
  }
  const id = validarNotificacaoId(notificacaoId)
  const userId = usuarioIdObrigatorio(req)
  const atuais = await coletarAtuais(pool, req)
  const itemAtual = atuais.find((item) => item.id === id)
  let item = itemAtual
  if (!item) {
    const { rows } = await pool.query(
      `SELECT notificacao_id, estado, tipo, grupo, prioridade, titulo, descricao, total,
              quando, destino_url, acao_label, atualizado_em
         FROM app.notificacao_centro_estado
        WHERE empresa_id = $1
          AND usuario_id = $2
          AND notificacao_id = $3`,
      [req.empresa.id, userId, id]
    )
    item = rows[0] ? itemDeLinhaArquivada(rows[0]) : null
  }
  const s = snapshot(item, id)
  const { rows } = await pool.query(
    `INSERT INTO app.notificacao_centro_estado
       (empresa_id, usuario_id, notificacao_id, estado, tipo, grupo, prioridade, titulo,
        descricao, total, quando, destino_url, acao_label)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, $12, $13)
     ON CONFLICT (empresa_id, usuario_id, notificacao_id)
     DO UPDATE SET estado = EXCLUDED.estado,
                   tipo = EXCLUDED.tipo,
                   grupo = EXCLUDED.grupo,
                   prioridade = EXCLUDED.prioridade,
                   titulo = EXCLUDED.titulo,
                   descricao = EXCLUDED.descricao,
                   total = EXCLUDED.total,
                   quando = EXCLUDED.quando,
                   destino_url = EXCLUDED.destino_url,
                   acao_label = EXCLUDED.acao_label,
                   atualizado_em = NOW()
     RETURNING notificacao_id, estado, tipo, grupo, prioridade, titulo, descricao, total,
               quando, destino_url, acao_label, atualizado_em`,
    [
      req.empresa.id, userId, s.id, estado, s.tipo, s.grupo, s.prioridade, s.titulo,
      s.descricao, s.total, s.quando, s.destino_url, s.acao_label,
    ]
  )
  return itemDeLinhaArquivada(rows[0])
}

async function restaurarNotificacao(pool, req, notificacaoId) {
  const id = validarNotificacaoId(notificacaoId)
  const userId = usuarioIdObrigatorio(req)
  await pool.query(
    `DELETE FROM app.notificacao_centro_estado
      WHERE empresa_id = $1
        AND usuario_id = $2
        AND notificacao_id = $3`,
    [req.empresa.id, userId, id]
  )
  return { id, restaurada: true }
}

module.exports = {
  listarNotificacoes,
  definirEstadoNotificacao,
  restaurarNotificacao,
  _internals: {
    addItem,
    montarResposta,
    ordenarItens,
    plural,
    snapshot,
  },
}
