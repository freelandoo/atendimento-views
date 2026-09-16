'use strict'
// Banco de Leads — visão UNIFICADA do funil (Google Places + Instagram/LinkedIn),
// agrupada nos 3 estágios que o operador acompanha:
//   sem_contato → ainda não conversou (coletado/contato_encontrado/aguardando/aprovado)
//   conversou   → já houve diálogo (enviado/respondeu)
//   fecharam    → negócio fechado (status 'fechado', marcado MANUALMENTE — migration 013)
// Leads descartados (rejeitado/nao_contatar) ficam fora destas abas de propósito.
//
// Reaproveita prospectador.prospects (mesma tabela das duas origens). Read-only +
// duas transições manuais de status (fechar/reabrir) e export CSV. Isolado por tenant.
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess, requireCapacidade } = require('../middleware/tenant')
const { atualizarEmailProspect } = require('../prospecting')
const { rodarLeads, gerarMensagensSemi, gerarPendentesSemi, dispararGerados, estadoEnvioInstancia, STATUS_RODAVEL } = require('../services/rodar-leads')
const { obterConfigBancoLeads, salvarConfigBancoLeads } = require('../db/banco-leads-config')
const {
  adicionarFiltroMercado,
  listarOpcoesFiltrosMercado,
  termoBuscaProspect,
} = require('../services/prospect-filters')
const {
  calcularScoreCadastroPlaces,
  montarJsonApresentacaoPlaces,
  calcularScoreCadastroInstagram,
  montarJsonApresentacaoInstagram,
} = require('../services/lead-score-cadastro')
const { classificarLead } = require('../services/site-classificacao')
// Ownership do lead (Etapa 4): a REGRA e' pura, o SQL e' proprio, a capacidade decide o recorte.
const { sqlEscopo, escopoEfetivo } = require('../services/lead-responsavel')
// A PORTA (Etapa 3). Aqui ela recorta a LEITURA do Comercial: quem nao pode ver a base bruta
// ve apenas lead APROVADO/MARCADO por alguem. Lead neutro fica fora da operacao comercial.
const { sqlAprovado } = require('../services/lead-qualificacao')
// A ORDEM DE TRABALHO (a fila do vendedor). O modulo e' PURO e devolve as expressoes SQL: a
// classificacao acontece UMA vez, dentro da consulta, e o numero vira rotulo por faixaPorOrdem.
const { sqlFaixaTrabalho, sqlDesempateTrabalho, faixaPorOrdem } = require('../services/lead-fila-trabalho')
// Telefone informado por uma PESSOA — regra pura; as consequencias (tem_whatsapp, status) sao
// aplicadas aqui, com o banco na mao.
const LT = require('../services/lead-telefone')
const LR = require('../db/lead-responsavel')
// Abordagem MANUAL (Etapa 5): o produto NAO envia — abre o wa.me e registra o que o vendedor diz.
const AM = require('../db/abordagem-manual')
const { CAPACIDADES: CAP, CAPACIDADES, podeCapacidade } = require('../services/acesso-capacidades')
const { logger } = require('../logger')
const { listarAuditoria } = require('../db/auditoria')
const { criarEvento } = require('../services/agenda-multiempresa')
const { criarFollowUp } = require('../db/follow-ups')
const { salvarAvaliacaoIcp } = require('../db/lead-icp')

const router = Router({ mergeParams: true })

// Estágios expostos como abas. A ordem aqui é a ordem do funil.
const ABAS = {
  sem_contato: ['coletado', 'contato_encontrado', 'aguardando', 'aprovado'],
  conversou: ['enviado', 'respondeu'],
  fecharam: ['fechado'],
}

function temCapacidadeReq(req, cap) {
  return podeCapacidade({
    papel: req.papelEmpresa,
    permissoes: req.vinculoEmpresa ? req.vinculoEmpresa.permissoes : null,
    papelPlataforma: req.usuario?.role,
  }, cap)
}
const ORIGENS_VALIDAS = new Set(['manual', 'automatico', 'instagram', 'linkedin'])
const STATUS_OPERACIONAL = Object.freeze({
  marcado: { status: 'aprovado', qualificacao: 'aprovado' },
  aprovado: { status: 'aprovado', qualificacao: 'aprovado' },
  contatado: { status: 'enviado' },
  enviado: { status: 'enviado' },
  respondido: { status: 'respondeu' },
  respondeu: { status: 'respondeu' },
  fechado: { status: 'fechado' },
  contratado: { status: 'fechado' },
  ligacao_realizada: { status: 'enviado', ligacao: true },
  ligação_realizada: { status: 'enviado', ligacao: true },
  ligacao: { status: 'enviado', ligacao: true },
  ligação: { status: 'enviado', ligacao: true },
  reuniao_agendada: { status: 'respondeu', agenda: true },
  reunião_agendada: { status: 'respondeu', agenda: true },
  descartado: { status: 'rejeitado', qualificacao: 'descartado', descarte: true },
  rejeitado: { status: 'rejeitado', qualificacao: 'descartado', descarte: true },
})
const ACOES_STATUS_LEAD = new Set(['lead_status_alterado', 'abordagem_manual_declarada', 'lead_reuniao_agendada', 'lead_ligacao_realizada', 'lead_follow_up_criado', 'lead_descartado'])

// Contato "agendado": tem evento FUTURO (pendente/confirmado). Le as DUAS agendas:
//  - app.agenda_eventos (migration 011): eventos criados manualmente no dashboard,
//    casados por telefone (só dígitos).
//  - vendas.agenda_eventos: reunioes marcadas pelo BOT (criarEventoAgenda). Nao tem
//    empresa_id/telefone diretos — casa via conversa/lead (mesma empresa) por telefone.
// Sem a segunda fonte, reunioes agendadas pelo bot nunca apareciam na aba "Agendados".
// normFone: so digitos, removendo o DDI 55 quando presente (length>=12) — casa o
// prospects.telefone (geralmente sem 55) com vendas.conversas.numero (JID com 55) sem
// corromper numeros de DDD 55.
const _foneDig = (col) => `regexp_replace(COALESCE(${col}, ''), '[^0-9]', '', 'g')`
const normFone = (col) => `(CASE WHEN length(${_foneDig(col)}) >= 12 AND left(${_foneDig(col)}, 2) = '55' THEN substr(${_foneDig(col)}, 3) ELSE ${_foneDig(col)} END)`
const AGENDA_VENDAS_FUTURA_EXISTS = `EXISTS (
  SELECT 1 FROM vendas.agenda_eventos ve
   WHERE ve.excluido_em IS NULL
     AND ve.tipo = 'reuniao'
     AND ve.status IN ('pendente', 'confirmado')
     AND ve.data_inicio >= NOW()
     AND NULLIF(${normFone('prospects.telefone')}, '') IS NOT NULL
     AND (
       EXISTS (SELECT 1 FROM vendas.conversas vc
                WHERE vc.id = ve.conversa_id AND vc.empresa_id = prospects.empresa_id
                  AND ${normFone('vc.numero')} = ${normFone('prospects.telefone')})
       OR EXISTS (SELECT 1 FROM vendas.lead_profiles vlp
                   WHERE vlp.id = ve.lead_id AND vlp.empresa_id = prospects.empresa_id
                     AND ${normFone('vlp.numero')} = ${normFone('prospects.telefone')})
     )
)`
const AGENDA_FUTURA_EXISTS = `(EXISTS (
  SELECT 1 FROM app.agenda_eventos ae
   WHERE ae.empresa_id = prospects.empresa_id
     AND ae.excluido_em IS NULL
     AND ae.status IN ('pendente', 'confirmado')
     AND ae.data_inicio >= NOW()
     AND NULLIF(regexp_replace(COALESCE(prospects.telefone, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
     AND regexp_replace(COALESCE(ae.lead_telefone, ''), '[^0-9]', '', 'g')
         = regexp_replace(COALESCE(prospects.telefone, ''), '[^0-9]', '', 'g')
) OR ${AGENDA_VENDAS_FUTURA_EXISTS})`
/**
 * Resolve o recorte por responsavel de UM request.
 *
 * Quem pode ver a carteira inteira e' quem tem `LEAD_VER_BRUTOS` — a mesma capacidade que da
 * acesso a base nao triada. Nao e' coincidencia: as duas respondem "voce trabalha a carteira ou
 * so' os seus leads?". Criar uma capacidade separada so' para "ver leads de outros" seria criar
 * uma terceira resposta para a mesma pergunta.
 *
 * O escopo EFETIVO e' devolvido junto do resultado: pedir `todos` sem poder nao devolve erro nem
 * silencio, devolve o recorte possivel + o rotulo, para a tela dizer "mostrando apenas os seus".
 */
function resolverEscopo(req) {
  const podeVerTodos = podeCapacidade({
    papel: req.papelEmpresa,
    permissoes: req.vinculoEmpresa ? req.vinculoEmpresa.permissoes : null,
    papelPlataforma: req.usuario?.role,
  }, CAPACIDADES.LEAD_VER_BRUTOS)
  const pedido = req.query?.escopo
  const { sql, usaUsuario } = sqlEscopo(pedido, { podeVerTodos, alias: '', placeholder: '$1' })
  return {
    sql,
    usaUsuario,
    usuarioId: req.usuario?.id || null,
    efetivo: escopoEfetivo(pedido, podeVerTodos),
    podeVerTodos,
  }
}

/** Injeta o escopo resolvido na query, para `montarFiltro` aplicar o MESMO recorte em todo lugar. */
function comEscopo(req) {
  const escopo = resolverEscopo(req)
  return {
    query: {
      ...req.query,
      __escopoSql: escopo.sql,
      __escopoUsaUsuario: escopo.usaUsuario,
      __usuarioId: escopo.usuarioId,
      // `podeVerTodos` aqui e' LEAD_VER_BRUTOS — a mesma capacidade que da acesso a base nao
      // triada. Quem nao a tem ve apenas lead marcado/aprovado pelo operador.
      __somenteAprovados: !escopo.podeVerTodos,
    },
    escopo,
  }
}

function envelopeErro(res, err, code) {
  const status = err.statusCode || 500
  logger.error(`[api-banco-leads] ${code}:`, err.message)
  return res.status(status).json({ ok: false, error: { code, message: err.message } })
}

// Monta WHERE + params comuns à listagem e ao export (mesmos filtros).
function montarFiltro(empresaId, query) {
  const params = [empresaId]
  const where = [`empresa_id = $1`]

  const aba = String(query.aba || '').toLowerCase()
  if (aba === 'agendados') {
    // Só contatos com agendamento futuro (ordenação por proximidade é feita no GET /leads).
    where.push(AGENDA_FUTURA_EXISTS)
  } else if (aba === 'descartados') {
    // Descartados: rejeitados/não-contatar OU sem conta WhatsApp (envio não chegou).
    where.push(`(status IN ('rejeitado', 'nao_contatar') OR tem_whatsapp = false)`)
  } else if (ABAS[aba]) {
    params.push(ABAS[aba])
    where.push(`status = ANY($${params.length})`)
    // Sem WhatsApp sai do funil ativo (vai pra Descartados) — não polui "Sem contato".
    if (aba === 'sem_contato') where.push(`(tem_whatsapp IS DISTINCT FROM false)`)
  } else {
    // Sem aba válida: mostra o funil inteiro (exclui descartados).
    params.push([...ABAS.sem_contato, ...ABAS.conversou, ...ABAS.fecharam])
    where.push(`status = ANY($${params.length})`)
  }

  const origem = String(query.origem || '').toLowerCase()
  if (ORIGENS_VALIDAS.has(origem)) {
    params.push(origem)
    where.push(`origem = $${params.length}`)
  } else if (origem === 'places') {
    where.push(`origem IN ('manual','automatico')`)
  } else if (origem === 'social') {
    where.push(`origem IN ('instagram','linkedin')`)
  }

  // Recorte por RESPONSAVEL (Etapa 4). `escopo` vem da query; o que a pessoa PODE ver vem da
  // capacidade, resolvida na rota. O mesmo fragmento serve listagem, contagem e export — tres
  // `if` separados divergiriam no primeiro ajuste.
  if (query.__escopoSql) {
    if (query.__escopoUsaUsuario) params.push(query.__usuarioId)
    where.push(query.__escopoSql.replace('$1', `$${params.length}`))
  }

  // Recorte pela PORTA (Etapa 3), aplicado na listagem, na contagem e no export pelo mesmo
  // ponto. Comercial trabalha só lead marcado/aprovado; lead neutro ainda fica na triagem.
  if (query.__somenteAprovados) where.push(sqlAprovado(''))

  adicionarFiltroMercado(where, params, query)

  const busca = termoBuscaProspect(query)
  if (busca) {
    params.push(`%${busca}%`)
    const i = params.length
    where.push(`(nome ILIKE $${i} OR telefone ILIKE $${i} OR email ILIKE $${i} OR instagram_handle ILIKE $${i} OR nicho ILIKE $${i} OR categoria_perfil ILIKE $${i} OR cidade ILIKE $${i})`)
  }
  return { where: where.join(' AND '), params }
}

function montarRecorteOperacao(empresaId, query) {
  const params = [empresaId]
  const where = ['empresa_id = $1']
  if (query.__escopoSql) {
    if (query.__escopoUsaUsuario) params.push(query.__usuarioId)
    where.push(query.__escopoSql.replace('$1', `$${params.length}`))
  }
  if (query.__somenteAprovados) where.push(sqlAprovado(''))
  return { where: where.join(' AND '), params }
}

function montarRecorteLeadOperacao(req) {
  const { query } = comEscopo(req)
  return montarRecorteOperacao(req.empresa.id, query)
}

function normalizarStatusOperacional(valor) {
  const chave = String(valor || '').trim().toLowerCase()
  return STATUS_OPERACIONAL[chave] ? { chave, ...STATUS_OPERACIONAL[chave] } : null
}

function montarDataHoraLocal(data, horario) {
  const d = String(data || '').trim()
  const h = String(horario || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(h)) return null
  const out = new Date(`${d}T${h}:00-03:00`)
  return Number.isNaN(out.getTime()) ? null : out
}

function normalizarPayloadReuniao(body = {}) {
  const r = body.reuniao && typeof body.reuniao === 'object' ? body.reuniao : body
  const inicio = montarDataHoraLocal(r.data, r.horario)
  if (!inicio) {
    const e = new Error('Informe data e horário da reunião.')
    e.statusCode = 400
    throw e
  }
  const duracao = Math.min(Math.max(Number.parseInt(r.duracao_minutos, 10) || 30, 15), 240)
  const fim = new Date(inicio.getTime() + duracao * 60 * 1000)
  return {
    data: String(r.data),
    horario: String(r.horario),
    inicio,
    fim,
    duracaoMinutos: duracao,
    observacoes: String(r.observacoes || r.observacao || '').trim().slice(0, 1000) || null,
  }
}
function normalizarPayloadLigacao(body = {}) {
  const r = body.ligacao && typeof body.ligacao === 'object' ? body.ligacao : body
  const resultados = new Set(['atendeu', 'nao_atendeu', 'ocupado', 'caixa_postal', 'numero_invalido', 'reagendou'])
  const resultado = resultados.has(String(r.resultado || '').trim()) ? String(r.resultado).trim() : 'atendeu'
  const duracaoMinutos = Math.min(Math.max(Number.parseInt(r.duracao_minutos, 10) || 5, 1), 240)
  const followUp = r.follow_up === undefined ? null : r.follow_up
  return {
    resultado,
    duracaoMinutos,
    duracaoSegundos: duracaoMinutos * 60,
    observacoes: String(r.observacoes || r.observacao || r.notas || '').trim().slice(0, 4000) || null,
    followUp: followUp && typeof followUp === 'object' ? followUp : null,
  }
}

function normalizarPayloadDescarte(body = {}) {
  const r = body.descarte && typeof body.descarte === 'object' ? body.descarte : body
  const motivo = String(r.motivo || '').trim().slice(0, 500)
  if (!motivo) {
    const e = new Error('Informe o motivo do descarte.')
    e.statusCode = 400
    throw e
  }
  return {
    motivo,
    observacoes: String(r.observacoes || r.observacao || '').trim().slice(0, 1000) || null,
  }
}


async function autoAssumirLeadLivre(client, { empresaId, prospectId, usuarioId, atual }) {
  if (!usuarioId || atual.responsavel_id) return { responsavel_id: atual.responsavel_id || null, assumido: false }
  const { rows } = await client.query(
    `UPDATE prospectador.prospects
        SET responsavel_id = $3::uuid, responsavel_desde = NOW()
      WHERE empresa_id = $1 AND id = $2::uuid AND responsavel_id IS NULL
      RETURNING responsavel_id, responsavel_desde`,
    [empresaId, prospectId, usuarioId]
  )
  if (!rows[0]) return { responsavel_id: atual.responsavel_id || null, assumido: false }
  await client.query(
    `INSERT INTO app.lead_responsavel_historico
       (empresa_id, prospect_id, responsavel_anterior_id, responsavel_novo_id, usuario_id, acao, motivo)
     VALUES ($1, $2::uuid, NULL, $3::uuid, $3::uuid, 'assumiu', $4)`,
    [empresaId, prospectId, usuarioId, 'Assumido automaticamente ao alterar status do lead.']
  )
  await client.query(
    `INSERT INTO app.auditoria_eventos
       (empresa_id, usuario_id, entidade_tipo, entidade_id, acao, estado_anterior, estado_novo, contexto)
     VALUES ($1, $2::uuid, 'prospect', $3::uuid, 'lead_responsavel_assumiu', NULL, $2::text, $4::jsonb)`,
    [empresaId, usuarioId, prospectId, JSON.stringify({ acao: 'assumiu', origem: 'status_lead' })]
  )
  return { ...rows[0], assumido: true }
}

async function alterarStatusLeadOperacional(req, statusPedido) {
  const destino = normalizarStatusOperacional(statusPedido)
  if (!destino) {
    const e = new Error('Status inválido. Use marcado, contatado, ligação realizada, respondido, reunião agendada, fechado ou descartado.')
    e.statusCode = 400
    throw e
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const recorte = montarRecorteLeadOperacao(req)
    const params = [...recorte.params, req.params.id]
    const phId = `$${params.length}`
    const { rows: atuais } = await client.query(
      `SELECT id, status, qualificacao, qualificado_em, qualificado_por, responsavel_id, responsavel_desde, nome, telefone
         FROM prospectador.prospects
        WHERE ${recorte.where} AND id = ${phId}::uuid
        FOR UPDATE`,
      params
    )
    const atual = atuais[0]
    if (!atual) {
      const e = new Error('Lead não encontrado para o seu escopo.')
      e.statusCode = 404
      throw e
    }

    const usuarioId = req.usuario?.id || null
    const reuniao = destino.agenda ? normalizarPayloadReuniao(req.body || {}) : null
    const ligacao = destino.ligacao ? normalizarPayloadLigacao(req.body || {}) : null
    const descarte = destino.descarte ? normalizarPayloadDescarte(req.body || {}) : null
    const precisaQualificacao = destino.qualificacao && atual.qualificacao !== destino.qualificacao
    const ownership = await autoAssumirLeadLivre(client, {
      empresaId: req.empresa.id, prospectId: req.params.id, usuarioId, atual,
    })
    const { rows } = await client.query(
      `UPDATE prospectador.prospects
          SET status = $3,
              qualificacao = COALESCE($4, qualificacao),
              qualificado_em = CASE WHEN $4 IS NOT NULL AND qualificacao IS DISTINCT FROM $4 THEN NOW() ELSE qualificado_em END,
              qualificado_por = CASE WHEN $4 IS NOT NULL AND qualificacao IS DISTINCT FROM $4 THEN $5::uuid ELSE qualificado_por END,
              updated_at = NOW()
        WHERE empresa_id = $1 AND id = $2::uuid
        RETURNING id, status, qualificacao, qualificado_em, qualificado_por, responsavel_id, responsavel_desde`,
      [req.empresa.id, req.params.id, destino.status, destino.qualificacao || null, usuarioId]
    )

    let eventoAgenda = null
    if (reuniao) {
      eventoAgenda = await criarEvento(client, {
        empresaId: req.empresa.id,
        criadoPor: usuarioId,
        responsavelId: rows[0].responsavel_id || usuarioId || null,
        prospectId: req.params.id,
        titulo: `Reunião com ${atual.nome || 'lead'}`,
        descricao: reuniao.observacoes,
        tipo: 'reuniao',
        status: 'pendente',
        prioridade: 'media',
        data_inicio: reuniao.inicio,
        data_fim: reuniao.fim,
        lead_telefone: atual.telefone || null,
        lead_nome: atual.nome || null,
        metadata: { origem: 'banco_leads_status', lead_status_anterior: atual.status },
      })
      await client.query(
        `INSERT INTO app.auditoria_eventos
           (empresa_id, usuario_id, entidade_tipo, entidade_id, acao, estado_anterior, estado_novo, contexto)
         VALUES ($1, $2::uuid, 'prospect', $3::uuid, 'lead_reuniao_agendada', $4, $5, $6::jsonb)`,
        [req.empresa.id, usuarioId, req.params.id, atual.status, rows[0].status, JSON.stringify({
          origem: 'banco_leads',
          agenda_evento_id: eventoAgenda.id,
          data: reuniao.data,
          horario: reuniao.horario,
          duracao_minutos: reuniao.duracaoMinutos,
          observacoes: reuniao.observacoes,
          responsavel_id: rows[0].responsavel_id || usuarioId || null,
        })]
      )
    }

    let registroLigacao = null
    let followUp = null
    if (ligacao) {
      const { rows: ligacoes } = await client.query(
        `INSERT INTO app.ligacoes
           (empresa_id, prospect_id, telefone, usuario_id, status, iniciada_em, encerrada_em, duracao_seg, resultado, notas)
         VALUES ($1, $2::uuid, $3, $4::uuid, 'encerrada', NOW() - ($5::int * INTERVAL '1 second'), NOW(), $5::int, $6, $7)
         RETURNING id, resultado, duracao_seg`,
        [req.empresa.id, req.params.id, atual.telefone || null, usuarioId, ligacao.duracaoSegundos, ligacao.resultado, ligacao.observacoes]
      )
      registroLigacao = ligacoes[0] || null

      if (ligacao.followUp) {
        followUp = await criarFollowUp(client, req.empresa.id, {
          ...ligacao.followUp,
          origem: 'ligacao',
          telefone: atual.telefone,
          ligacao_id: registroLigacao?.id || null,
          prospect_id: req.params.id,
          responsavel_id: ligacao.followUp.responsavel_id || rows[0].responsavel_id || usuarioId || null,
          observacao: ligacao.followUp.observacao || ligacao.observacoes || null,
        }, { usuarioId })
        await client.query(
          `INSERT INTO app.auditoria_eventos
             (empresa_id, usuario_id, entidade_tipo, entidade_id, acao, estado_anterior, estado_novo, contexto)
           VALUES ($1, $2::uuid, 'follow_up', $3::uuid, 'follow_up_criado', NULL, 'aguardando', $4::jsonb)`,
          [req.empresa.id, usuarioId, followUp.id, JSON.stringify({
            origem: 'ligacao',
            canal: followUp.canal,
            ligacao_id: registroLigacao?.id || null,
            prospect_id: req.params.id,
            substituiu_anterior: followUp.substituiu === true,
          })]
        )
        await client.query(
          `INSERT INTO app.auditoria_eventos
             (empresa_id, usuario_id, entidade_tipo, entidade_id, acao, estado_anterior, estado_novo, contexto)
           VALUES ($1, $2::uuid, 'prospect', $3::uuid, 'lead_follow_up_criado', $4, $5, $6::jsonb)`,
          [req.empresa.id, usuarioId, req.params.id, atual.status, rows[0].status, JSON.stringify({
            origem: 'banco_leads_ligacao',
            follow_up_id: followUp.id,
            ligacao_id: registroLigacao?.id || null,
            canal: followUp.canal,
            proxima_acao: followUp.proxima_acao,
            agendado_para: followUp.agendado_para,
            responsavel_id: followUp.responsavel_id || null,
          })]
        )
      }

      await client.query(
        `INSERT INTO app.auditoria_eventos
           (empresa_id, usuario_id, entidade_tipo, entidade_id, acao, estado_anterior, estado_novo, contexto)
         VALUES ($1, $2::uuid, 'prospect', $3::uuid, 'lead_ligacao_realizada', $4, $5, $6::jsonb)`,
        [req.empresa.id, usuarioId, req.params.id, atual.status, rows[0].status, JSON.stringify({
          origem: 'banco_leads',
          ligacao_id: registroLigacao?.id || null,
          resultado: ligacao.resultado,
          duracao_minutos: ligacao.duracaoMinutos,
          observacoes: ligacao.observacoes,
          follow_up_id: followUp?.id || null,
          responsavel_id: rows[0].responsavel_id || usuarioId || null,
        })]
      )
    }

    if (descarte) {
      await client.query(
        `INSERT INTO app.auditoria_eventos
           (empresa_id, usuario_id, entidade_tipo, entidade_id, acao, estado_anterior, estado_novo, contexto)
         VALUES ($1, $2::uuid, 'prospect', $3::uuid, 'lead_descartado', $4, $5, $6::jsonb)`,
        [req.empresa.id, usuarioId, req.params.id, atual.status, rows[0].status, JSON.stringify({
          origem: 'banco_leads',
          motivo: descarte.motivo,
          observacoes: descarte.observacoes,
          responsavel_id: rows[0].responsavel_id || usuarioId || null,
        })]
      )
    }

    await client.query(
      `INSERT INTO app.auditoria_eventos
         (empresa_id, usuario_id, entidade_tipo, entidade_id, acao, estado_anterior, estado_novo, contexto)
       VALUES ($1, $2::uuid, 'prospect', $3::uuid, 'lead_status_alterado', $4, $5, $6::jsonb)`,
      [req.empresa.id, usuarioId, req.params.id, atual.status, rows[0].status, JSON.stringify({
        origem: 'banco_leads',
        status_pedido: destino.chave,
        status_anterior: atual.status,
        status_novo: rows[0].status,
        qualificacao_anterior: atual.qualificacao || null,
        qualificacao_nova: rows[0].qualificacao || null,
        qualificacao_alterada: !!precisaQualificacao,
        assumido_automaticamente: !!ownership.assumido,
        agenda_evento_id: eventoAgenda?.id || null,
        ligacao_id: registroLigacao?.id || null,
        follow_up_id: followUp?.id || null,
        motivo_descarte: descarte?.motivo || null,
      })]
    )

    await client.query('COMMIT')
    return { ...rows[0], assumido_automaticamente: !!ownership.assumido, agenda_evento: eventoAgenda, ligacao: registroLigacao, follow_up: followUp }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

async function assertInstanciaPermitida(req, res, instanciaId) {
  if (temCapacidadeReq(req, CAP.INSTANCIA_GERENCIAR_EMPRESA)) return true
  const usuarioId = req.usuario?.id || null
  if (!usuarioId) {
    res.status(403).json({ ok: false, error: { code: 'FORBIDDEN', message: 'Instância indisponível para este usuário.' } })
    return false
  }
  const { rows } = await pool.query(
    `SELECT id
       FROM app.empresa_whatsapp_instances
      WHERE id = $1 AND empresa_id = $2 AND usuario_id = $3
        AND COALESCE(config_json->>'canal', 'whatsapp') <> 'freelandoo'`,
    [instanciaId, req.empresa.id, usuarioId]
  )
  if (rows[0]) return true
  res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Instância não encontrada.' } })
  return false
}

function montarEscopoOpcoes(query) {
  const aba = String(query.aba || '').toLowerCase()
  const origem = String(query.origem || '').toLowerCase()
  const escopo = {}
  if (aba === 'descartados') escopo.statusAny = ['rejeitado', 'nao_contatar']
  else if (ABAS[aba]) escopo.statusAny = ABAS[aba]
  if (ORIGENS_VALIDAS.has(origem)) escopo.origem = origem
  else if (origem === 'places') escopo.origemIn = ['manual', 'automatico']
  else if (origem === 'social') escopo.origemIn = ['instagram', 'linkedin']
  return escopo
}

// `qualificacao` e `responsavel_id` entram aqui porque a tela precisa saber se o lead passou pela
// porta (Etapa 3) e de quem ele e' (Etapa 4). A REGRA de cada um continua no backend — o front
// so' traduz o veredito.
const COLUNAS = `id, origem, status, qualificacao, qualificado_em,
  responsavel_id, responsavel_desde, nome, telefone, email, instagram_handle,
  nicho, cidade, site, seguidores, categoria_perfil, created_at, updated_at,
  bloqueado_ate, bloqueio_motivo, endereco, rating, avaliacoes, tem_site,
  maps_url, link_bio, bio, tem_whatsapp, score, place_id,
  link_original, classificacao_url,
  icp_modelo_id, icp_score, icp_faixa, icp_avaliado_em, icp_avaliado_por, icp_resumo_json`

// Origens do Google Places (inclui cadastro manual); o resto é social (IG/LinkedIn).
const ORIGENS_PLACES = new Set(['manual', 'automatico'])

// Anexa a pontuação de cadastro + JSON de apresentação conforme a origem do lead
// (mesma régua da Aquisição: Places 0-100, Instagram 0-60). Remove o raw_json do
// payload (pesado — só serve pro cálculo de fotos/horário do Places).
// Ponto UNICO por onde todo lead do Banco de Leads sai para a tela. Aqui o veredito de
// site vira canonico (services/site-classificacao): `site` so' sobrevive quando e' site
// PROPRIO e `tem_site` deixa de significar "tem algum link". O link cru continua no
// payload em `link_original`, para o operador ver o Instagram/Linktree sem que a tela o
// chame de site. Sem isto, Banco de Leads e Central de Ligacoes mostrariam resultados
// diferentes para o MESMO lead.
function comSiteCanonico(lead) {
  const url = classificarLead(lead)
  return {
    ...lead,
    site: url.site,
    tem_site: url.tem_site,
    link_original: url.link_original,
    classificacao_url: url.classificacao,
    situacao_site: url.situacao_site,
    situacao_site_label: url.situacao_label,
  }
}

function anexarScoreCadastro(row) {
  const { raw_json: _rawJson, ...lead } = row
  if (ORIGENS_PLACES.has(row.origem)) {
    const cad = calcularScoreCadastroPlaces(row)
    return comSiteCanonico({
      ...lead,
      score_cadastro: cad.score,
      score_cadastro_max: cad.maximo,
      json_apresentacao: montarJsonApresentacaoPlaces(row, cad),
    })
  }
  const cad = calcularScoreCadastroInstagram(row)
  return comSiteCanonico({
    ...lead,
    score_cadastro: cad.score,
    score_cadastro_max: cad.maximo,
    json_apresentacao: montarJsonApresentacaoInstagram(row, cad),
  })
}

// GET /leads?aba=sem_contato|conversou|fecharam&origem=&busca=
// Inclui o último disparo (quem rodou / quando) e o estado da trava (bloqueado_ate).
router.get('/leads', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { query: queryComEscopo, escopo } = comEscopo(req)
    const { where, params } = montarFiltro(req.empresa.id, queryComEscopo)
    // Cópia dos parâmetros do WHERE, ANTES de `params` crescer com o filtro de instância (que
    // vive só no LATERAL) e com o limite. A contagem usa exatamente os que o WHERE referencia —
    // mandar parâmetro a mais é erro de bind no Postgres, não um extra ignorado.
    const paramsFiltro = [...params]
    // Aba "Agendados" ordena pelos horários mais próximos; demais pela ORDEM DE TRABALHO.
    //
    // `updated_at DESC` era o oposto do que a fila precisa: qualquer escrita — inclusive a
    // automática (recoleta, disparo, script de manutenção) — subia o lead, então o que você
    // acabou de trabalhar voltava ao topo e o nunca tocado afundava até sair da janela.
    // A regra de faixas vive em services/lead-fila-trabalho.js (ver o cabeçalho dele).
    const ordemLeads = String(req.query.aba || '').toLowerCase() === 'agendados'
      ? 'proximo_agendamento ASC NULLS LAST'
      : `faixa_trabalho_ordem ASC, ${sqlDesempateTrabalho()}`
    // Escopo da mensagem gerada (Semi): só mostra o rascunho que SERÁ disparado pela
    // instância selecionada — evita mostrar rascunho de outra instância (que ao disparar
    // pela instância atual não seria encontrado). Sem instancia_id, mostra qualquer um.
    let filtroInstMsg = ''
    const instId = String(req.query.instancia_id || '').trim()
    if (instId) {
      const { rows: ir } = await pool.query(
        `SELECT evolution_instance FROM app.empresa_whatsapp_instances WHERE id = $1 AND empresa_id = $2`,
        [instId, req.empresa.id]
      )
      if (ir[0]?.evolution_instance) {
        params.push(ir[0].evolution_instance)
        filtroInstMsg = ` AND d.evolution_instance = $${params.length}`
      }
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 300, 1), 1000)
    // Total REAL do recorte, contado no banco ANTES do teto. A listagem devolve uma janela
    // (`limit`) e a tela pagina dentro dela; sem este número o operador não tem como saber que
    // existe carteira além do que está vendo — e o teto viraria um recorte invisível.
    // O COUNT não precisa dos LATERAL: nenhum deles entra no WHERE.
    const { rows: contagem } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM prospectador.prospects WHERE ${where}`,
      paramsFiltro
    )
    params.push(limit)
    const { rows } = await pool.query(
      `SELECT ${COLUNAS}, raw_json,
          ultimo.rodado_em, ultimo.rodado_por, ultimo.ultimo_status, ultimo.ultimo_erro,
          rascunho.mensagem_gerada, rascunho.gerada_em,
          agenda.proximo_agendamento,
          ${sqlFaixaTrabalho()} AS faixa_trabalho_ordem
        FROM prospectador.prospects
        LEFT JOIN LATERAL (
          SELECT d.criado_em AS rodado_em,
                 COALESCE(u.nome, u.email) AS rodado_por,
                 d.status AS ultimo_status,
                 d.erro AS ultimo_erro
            FROM prospectador.lead_disparos d
            LEFT JOIN app.usuarios u ON u.id = d.usuario_id
           WHERE d.prospect_id = prospects.id
           ORDER BY d.criado_em DESC
           LIMIT 1
        ) ultimo ON TRUE
        LEFT JOIN LATERAL (
          SELECT d.mensagem AS mensagem_gerada, d.criado_em AS gerada_em
            FROM prospectador.lead_disparos d
           WHERE d.prospect_id = prospects.id
             AND d.status = 'aguardando_disparo'${filtroInstMsg}
           ORDER BY d.criado_em DESC
           LIMIT 1
        ) rascunho ON TRUE
        LEFT JOIN LATERAL (
          SELECT MIN(di) AS proximo_agendamento FROM (
            SELECT ae.data_inicio AS di
              FROM app.agenda_eventos ae
             WHERE ae.empresa_id = prospects.empresa_id
               AND ae.excluido_em IS NULL
               AND ae.status IN ('pendente', 'confirmado')
               AND ae.data_inicio >= NOW()
               AND NULLIF(regexp_replace(COALESCE(prospects.telefone, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
               AND regexp_replace(COALESCE(ae.lead_telefone, ''), '[^0-9]', '', 'g')
                   = regexp_replace(COALESCE(prospects.telefone, ''), '[^0-9]', '', 'g')
            UNION ALL
            SELECT ve.data_inicio AS di
              FROM vendas.agenda_eventos ve
             WHERE ve.excluido_em IS NULL
               AND ve.tipo = 'reuniao'
               AND ve.status IN ('pendente', 'confirmado')
               AND ve.data_inicio >= NOW()
               AND NULLIF(${normFone('prospects.telefone')}, '') IS NOT NULL
               AND (
                 EXISTS (SELECT 1 FROM vendas.conversas vc
                          WHERE vc.id = ve.conversa_id AND vc.empresa_id = prospects.empresa_id
                            AND ${normFone('vc.numero')} = ${normFone('prospects.telefone')})
                 OR EXISTS (SELECT 1 FROM vendas.lead_profiles vlp
                             WHERE vlp.id = ve.lead_id AND vlp.empresa_id = prospects.empresa_id
                               AND ${normFone('vlp.numero')} = ${normFone('prospects.telefone')})
               )
          ) u
        ) agenda ON TRUE
        WHERE ${where} ORDER BY ${ordemLeads} LIMIT $${params.length}`,
      params
    )
    // A faixa foi decidida pelo SQL (uma vez). Aqui ela só vira nome — a tela traduz o nome em
    // frase (frontend/lib/lead-fila-trabalho.js) e NÃO reclassifica nada.
    const data = rows.map((row) => {
      const { faixa_trabalho_ordem: ordem, ...resto } = row
      return { ...anexarScoreCadastro(resto), faixa_trabalho: faixaPorOrdem(ordem) }
    })
    // `escopo` no meta: a tela precisa poder dizer "mostrando apenas os seus" quando o pedido de
    // ver tudo foi rebaixado. Recortar em silencio faria o vendedor achar que a carteira encolheu.
    return res.json({
      ok: true,
      data,
      meta: {
        total: data.length,
        total_carteira: contagem[0] ? contagem[0].total : data.length,
        limite: limit,
        escopo: escopo.efetivo,
        pode_ver_todos: escopo.podeVerTodos,
      },
    })
  } catch (err) { return envelopeErro(res, err, 'LEADS_FAILED') }
})

// ─── Ownership do lead (CRM em equipe, Etapa 4) ─────────────────────────────────────────────
// Nenhuma destas rotas decide papel: a capacidade e' avaliada pelo modulo puro
// services/acesso-capacidades.js e chega como booleano para a camada de dados.

function capacidade(req, cap) {
  return podeCapacidade({
    papel: req.papelEmpresa,
    permissoes: req.vinculoEmpresa ? req.vinculoEmpresa.permissoes : null,
    papelPlataforma: req.usuario?.role,
  }, cap)
}

// POST /leads/:id/assumir — o vendedor pega um lead LIVRE (claim atomico).
router.post('/leads/:id/assumir', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await LR.assumirLead(pool, req.empresa.id, req.params.id, req.usuario?.id)
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'LEAD_ASSUMIR_FAILED') }
})

// PUT /leads/:id/responsavel { usuario_id | null, motivo? } — define, troca ou devolve para a fila.
// `usuario_id: null` e' a devolucao. O PROPRIO dono sempre pode devolver o que e' seu; trocar o
// dono de outra pessoa exige LEAD_TRANSFERIR.
router.put('/leads/:id/responsavel', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const b = req.body || {}
    const data = await LR.definirResponsavel(pool, req.empresa.id, req.params.id, {
      destinoId: b.usuario_id || null,
      usuarioId: req.usuario?.id,
      podeTransferir: capacidade(req, CAPACIDADES.LEAD_TRANSFERIR),
      motivo: b.motivo,
    })
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'LEAD_RESPONSAVEL_FAILED') }
})

// POST /leads/responsavel-lote { ids: [], usuario_id, motivo? } — distribuicao pelo admin.
router.post('/leads/responsavel-lote', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    if (!capacidade(req, CAPACIDADES.LEAD_TRANSFERIR)) {
      return res.status(403).json({ ok: false, error: { code: 'FORBIDDEN', message: 'Você não pode distribuir leads.' } })
    }
    const b = req.body || {}
    const data = await LR.atribuirEmLote(pool, req.empresa.id, b.ids, {
      destinoId: b.usuario_id, usuarioId: req.usuario?.id, motivo: b.motivo,
    })
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'LEAD_LOTE_FAILED') }
})

// ─── Abordagem manual pelo wa.me (CRM em equipe, Etapa 5) ───────────────────────────────────
// Tres rotas para TRES fatos distintos, e essa separacao e' a feature:
//   GET  .../abordagem-manual          -> prepara (READ-ONLY: nao envia, nao grava, nao chama IA)
//   POST .../abordagem-manual/aberta   -> registra a ABERTURA do WhatsApp (nao e' envio)
//   PATCH .../abordagem-manual         -> o vendedor DECLARA que enviou (declaracao, nao prova)

// GET /leads/:id/abordagem-manual
router.get('/leads/:id/abordagem-manual', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await AM.prepararAbordagem(pool, req.empresa.id, req.params.id, {
      usuarioId: req.usuario?.id,
      remetente: req.usuario?.nome,
    })
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'ABORDAGEM_PREPARAR_FAILED') }
})

// POST /leads/:id/abordagem-manual/aberta
router.post('/leads/:id/abordagem-manual/aberta', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await AM.registrarAbertura(pool, req.empresa.id, req.params.id, {
      usuarioId: req.usuario?.id,
      mensagem: (req.body || {}).mensagem,
    })
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'ABORDAGEM_ABERTURA_FAILED') }
})

// PATCH /leads/:id/abordagem-manual  { enviado: true, mensagem? }
// `enviado` precisa ser o booleano `true`: `Boolean('false')` e' `true`, e aceitar string aqui
// marcaria como enviada uma mensagem que o vendedor disse NAO ter enviado (mesma recusa explicita
// da migration 066).
router.patch('/leads/:id/abordagem-manual', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const b = req.body || {}
    if (b.enviado !== true) {
      return res.status(400).json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'Envie enviado: true para marcar a abordagem como enviada.' },
      })
    }
    const data = await AM.marcarEnviadoManualmente(pool, req.empresa.id, req.params.id, {
      usuarioId: req.usuario?.id,
      mensagem: b.mensagem,
    })
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'ABORDAGEM_ENVIO_FAILED') }
})

// GET /leads/:id/responsavel-historico — a linha do tempo de donos.
router.get('/leads/:id/responsavel-historico', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await LR.historicoDoLead(pool, req.empresa.id, req.params.id, { limit: req.query.limit })
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'LEAD_HISTORICO_FAILED') }
})

// GET /leads/:id/status-historico — status operacional e declarações de contato daquele lead.
router.get('/leads/:id/status-historico', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const recorte = montarRecorteLeadOperacao(req)
    const params = [...recorte.params, req.params.id]
    const phId = `$${params.length}`
    const { rows } = await pool.query(
      `SELECT 1 FROM prospectador.prospects
        WHERE ${recorte.where} AND id = ${phId}::uuid
        LIMIT 1`,
      params
    )
    if (!rows[0]) return res.status(404).json({ ok: false, error: { code: 'LEAD_NAO_ENCONTRADO', message: 'Lead não encontrado para o seu escopo.' } })

    const eventos = await listarAuditoria(pool, req.empresa.id, { entidadeTipo: 'prospect', entidadeId: req.params.id, limit: req.query.limit || 30 })
    return res.json({ ok: true, data: eventos.filter((e) => ACOES_STATUS_LEAD.has(e.acao)) })
  } catch (err) { return envelopeErro(res, err, 'LEAD_STATUS_HISTORICO_FAILED') }
})

// GET /carteira — quantos leads cada responsavel tem. Leitura de GESTAO, logo exige a capacidade.
router.get('/carteira', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    if (!capacidade(req, CAPACIDADES.LEAD_VER_BRUTOS)) {
      return res.status(403).json({ ok: false, error: { code: 'FORBIDDEN', message: 'Você não pode ver a carteira da equipe.' } })
    }
    const data = await LR.contagemPorResponsavel(pool, req.empresa.id)
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'CARTEIRA_FAILED') }
})

// POST /leads  { origem, nome, whatsapp, instagram } — cadastro manual de um lead.
// A origem do formulário (manual/google/instagram) mapeia para a coluna `origem`:
//   manual → 'manual' · google → 'automatico' (ambos aparecem como "Places")
//   instagram → 'instagram'. Exige nome + ao menos um contato (whatsapp ou @).
const ORIGEM_CADASTRO = { manual: 'manual', google: 'automatico', instagram: 'instagram' }
router.post('/leads', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const b = req.body || {}
    const origem = ORIGEM_CADASTRO[String(b.origem || '').toLowerCase()]
    if (!origem) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Origem inválida (use manual, google ou instagram).' } })
    }
    const nome = String(b.nome || '').trim().slice(0, 200)
    if (!nome) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Informe o nome do lead.' } })
    }
    const telefone = String(b.whatsapp || '').replace(/\D/g, '').slice(0, 20)
    if (telefone && telefone.length < 10) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'WhatsApp inválido — informe DDD + número.' } })
    }
    const instagram = String(b.instagram || '').trim().replace(/^@+/, '').toLowerCase().slice(0, 100)
    if (!telefone && !instagram) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Informe ao menos WhatsApp ou Instagram.' } })
    }
    // Com telefone o lead já é "rodável" (contato_encontrado); sem, fica só coletado.
    const status = telefone ? 'contato_encontrado' : 'coletado'
    const { rows } = await pool.query(
      `INSERT INTO prospectador.prospects
         (empresa_id, origem, nome, telefone, instagram_handle, status, raw_json)
       VALUES ($1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), $6, $7::jsonb)
       RETURNING ${COLUNAS}`,
      [req.empresa.id, origem, nome, telefone, instagram, status, JSON.stringify({ fonte: 'cadastro_manual' })]
    )
    return res.status(201).json({ ok: true, data: { ...rows[0], rodado_em: null, rodado_por: null } })
  } catch (err) { return envelopeErro(res, err, 'LEAD_CREATE_FAILED') }
})

// GET /meus-disparos — histórico de "quanto rodou" do usuário logado nesta empresa.
// Resumo (total/hoje/semana/enviados/falhou) + contagem por dia (14d) + últimos disparos.
router.get('/meus-disparos', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const usuarioId = req.usuario?.id
    if (!usuarioId) return res.json({ ok: true, data: { resumo: {}, por_dia: [], recentes: [] } })
    const args = [req.empresa.id, usuarioId]

    const resumoQ = pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE criado_em::date = NOW()::date)::int AS hoje,
         COUNT(*) FILTER (WHERE criado_em >= NOW() - INTERVAL '7 days')::int AS semana,
         COUNT(*) FILTER (WHERE status = 'enviado')::int AS enviados,
         COUNT(*) FILTER (WHERE status = 'falhou')::int AS falhou
         FROM prospectador.lead_disparos
        WHERE empresa_id = $1 AND usuario_id = $2`, args)

    const porDiaQ = pool.query(
      `SELECT to_char(criado_em::date, 'YYYY-MM-DD') AS dia, COUNT(*)::int AS total
         FROM prospectador.lead_disparos
        WHERE empresa_id = $1 AND usuario_id = $2 AND criado_em >= NOW() - INTERVAL '14 days'
        GROUP BY criado_em::date ORDER BY criado_em::date DESC`, args)

    const recentesQ = pool.query(
      `SELECT d.id, d.status, d.evolution_instance, d.criado_em, p.nome AS prospect_nome
         FROM prospectador.lead_disparos d
         LEFT JOIN prospectador.prospects p ON p.id = d.prospect_id
        WHERE d.empresa_id = $1 AND d.usuario_id = $2
        ORDER BY d.criado_em DESC LIMIT 50`, args)

    const [resumo, porDia, recentes] = await Promise.all([resumoQ, porDiaQ, recentesQ])
    return res.json({ ok: true, data: {
      resumo: resumo.rows[0] || { total: 0, hoje: 0, semana: 0, enviados: 0, falhou: 0 },
      por_dia: porDia.rows,
      recentes: recentes.rows,
    } })
  } catch (err) { return envelopeErro(res, err, 'MEUS_DISPAROS_FAILED') }
})

// POST /rodar  { instancia_id, prospect_ids: [..] } — dispara a saudação (1ª mensagem)
// pelos números selecionados via a instância escolhida. Throttle no serviço.
router.post('/rodar', requireAuth, requireEmpresaAccess, requireCapacidade(CAP.LEAD_DISPARAR_LOTE), async (req, res) => {
  try {
    const { instancia_id, prospect_ids } = req.body || {}
    if (!instancia_id) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Escolha uma instância.' } })
    }
    const resumo = await rodarLeads(pool, {
      empresaId: req.empresa.id,
      usuarioId: req.usuario?.id || null,
      instanciaId: instancia_id,
      prospectIds: Array.isArray(prospect_ids) ? prospect_ids : [],
    })
    return res.json({ ok: true, data: resumo })
  } catch (err) {
    const status = err.statusCode || 500
    if (status >= 500) logger.error('[api-banco-leads] RODAR_FAILED:', err.message)
    return res.status(status).json({ ok: false, error: { code: 'RODAR_FAILED', message: err.message } })
  }
})

// GET /config — modo de disparo (manual/semi/auto) + geração por IA, por empresa.
router.get('/config', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await obterConfigBancoLeads(pool, req.empresa.id)
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'CONFIG_FAILED') }
})

// PUT /config — atualiza a config do Banco de Leads (upsert parcial: só os campos
// presentes no body mudam). Aceita: modo, gerar_ia, instrucoes_ia (Manual/Semi) +
// auto_ativo, janela_inicio, janela_fim, intervalo_min, intervalo_max (Automático).
router.put('/config', requireAuth, requireEmpresaAccess, requireCapacidade(CAP.LEAD_DISPARAR_SEMI, CAP.LEAD_DISPARAR_LOTE), async (req, res) => {
  try {
    const b = req.body || {}
    const podeAutomatico = temCapacidadeReq(req, CAP.LEAD_DISPARAR_LOTE)
    if (!podeAutomatico) {
      const camposAutomaticos = ['auto_ativo', 'janela_inicio', 'janela_fim', 'intervalo_min', 'intervalo_max', 'auto_proximo_disparo_em']
      const tentouAutomatico = b.modo === 'automatico' || camposAutomaticos.some((campo) => b[campo] !== undefined)
      if (tentouAutomatico) {
        return res.status(403).json({
          ok: false,
          error: { code: 'FORBIDDEN', message: 'O modo automático é restrito à administração.' },
        })
      }
    }
    const patch = {}
    for (const campo of ['modo', 'gerar_ia', 'instrucoes_ia', 'auto_ativo', 'auto_instancia_id',
      'janela_inicio', 'janela_fim', 'intervalo_min', 'intervalo_max', 'auto_proximo_disparo_em']) {
      if (b[campo] !== undefined) patch[campo] = b[campo]
    }
    const data = await salvarConfigBancoLeads(pool, req.empresa.id, patch)
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'CONFIG_UPDATE_FAILED') }
})

// GET /cooldown?instancia_id=… — estado do cooldown/teto da instância (para o cronômetro
// do modo Semi). Só leitura; reusa o MESMO throttle do disparo (sem regra duplicada).
router.get('/cooldown', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const instId = String(req.query.instancia_id || '').trim()
    if (!instId) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'instancia_id é obrigatório.' } })
    }
    if (!(await assertInstanciaPermitida(req, res, instId))) return
    const data = await estadoEnvioInstancia(pool, { empresaId: req.empresa.id, instanciaId: instId })
    return res.json({ ok: true, data })
  } catch (err) {
    const status = err.statusCode || 500
    return res.status(status).json({ ok: false, error: { code: 'COOLDOWN_FAILED', message: err.message } })
  }
})

// GET /geracao-progresso?instancia_id= — progresso da preparação das mensagens desta
// instância. Alimenta a BARRA de progresso no painel. Independe da tela: a geração roda
// no worker de fundo (Semi) / no disparo (Auto); aqui só CONTAMOS o estado atual.
//   eligiveis = leads que ainda precisam de mensagem (rodáveis, sem disparo ativo)
//   prontas   = mensagens já geradas aguardando disparo (Semi)
//   gerando   = em geração agora
//   enviados  = já contatados (Auto/Semi)   ·   erros = falha de IA
router.get('/geracao-progresso', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const instId = String(req.query.instancia_id || '').trim()
    if (!instId) return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'instancia_id é obrigatório.' } })
    if (!(await assertInstanciaPermitida(req, res, instId))) return
    const { rows: [inst] } = await pool.query(
      `SELECT evolution_instance FROM app.empresa_whatsapp_instances WHERE id = $1 AND empresa_id = $2`,
      [instId, req.empresa.id]
    )
    if (!inst) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Instância não encontrada.' } })
    const ev = inst.evolution_instance
    const emp = req.empresa.id
    const { rows: [c] } = await pool.query(
      `WITH fila AS (
         SELECT p.id,
                (SELECT d.status
                   FROM prospectador.lead_disparos d
                  WHERE d.empresa_id = p.empresa_id
                    AND d.prospect_id = p.id
                    AND d.evolution_instance = $3
                    AND d.status IN ('gerando','aguardando_disparo','erro_ia','enviando','pendente_confirmacao','enviado')
                  ORDER BY d.criado_em DESC
                  LIMIT 1) AS status_geracao
           FROM prospectador.prospects p
          WHERE p.empresa_id = $1
            AND p.status = ANY($2)
            AND NULLIF(BTRIM(COALESCE(p.telefone, '')), '') IS NOT NULL
            AND p.tem_whatsapp IS DISTINCT FROM false
            AND (p.bloqueado_ate IS NULL OR p.bloqueado_ate <= NOW())
       )
       SELECT COUNT(*) FILTER (WHERE status_geracao IS NULL)::int AS eligiveis,
              COUNT(*) FILTER (WHERE status_geracao = 'aguardando_disparo')::int AS prontas,
              COUNT(*) FILTER (WHERE status_geracao = 'gerando')::int AS gerando,
              COUNT(*) FILTER (WHERE status_geracao IN ('enviado','enviando','pendente_confirmacao'))::int AS enviados,
              COUNT(*) FILTER (WHERE status_geracao = 'erro_ia')::int AS erros
         FROM fila`,
      [emp, [...STATUS_RODAVEL], ev]
    )
    return res.json({ ok: true, data: c })
  } catch (err) {
    return res.status(500).json({ ok: false, error: { code: 'PROGRESSO_FAILED', message: err.message } })
  }
})

// POST /gerar { instancia_id, prospect_ids } — SEMI: gera as mensagens (IA c/ fallback) e
// deixa 'aguardando_disparo' (não envia, não consome teto). Retorna as prévias geradas.
router.post('/gerar', requireAuth, requireEmpresaAccess, requireCapacidade(CAP.LEAD_DISPARAR_SEMI, CAP.LEAD_DISPARAR_LOTE), async (req, res) => {
  try {
    const { instancia_id, prospect_ids } = req.body || {}
    if (!instancia_id) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Escolha uma instância.' } })
    }
    if (!(await assertInstanciaPermitida(req, res, instancia_id))) return
    const data = await gerarMensagensSemi(pool, {
      empresaId: req.empresa.id,
      usuarioId: req.usuario?.id || null,
      instanciaId: instancia_id,
      prospectIds: Array.isArray(prospect_ids) ? prospect_ids : [],
    })
    return res.json({ ok: true, data })
  } catch (err) {
    const status = err.statusCode || 500
    if (status >= 500) logger.error('[api-banco-leads] GERAR_FAILED:', err.message)
    return res.status(status).json({ ok: false, error: { code: 'GERAR_FAILED', message: err.message } })
  }
})

// POST /gerar-pendentes { instancia_id, limit? } — SEMI: gera mensagens para os
// leads elegíveis que ainda não têm rascunho/erro/envio nesta instância.
router.post('/gerar-pendentes', requireAuth, requireEmpresaAccess, requireCapacidade(CAP.LEAD_DISPARAR_SEMI, CAP.LEAD_DISPARAR_LOTE), async (req, res) => {
  try {
    const { instancia_id, limit } = req.body || {}
    if (!instancia_id) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Escolha uma instância.' } })
    }
    if (!(await assertInstanciaPermitida(req, res, instancia_id))) return
    const data = await gerarPendentesSemi(pool, {
      empresaId: req.empresa.id,
      usuarioId: req.usuario?.id || null,
      instanciaId: instancia_id,
      limit: limit || 1000,
    })
    return res.json({ ok: true, data })
  } catch (err) {
    const status = err.statusCode || 500
    if (status >= 500) logger.error('[api-banco-leads] GERAR_PENDENTES_FAILED:', err.message)
    return res.status(status).json({ ok: false, error: { code: 'GERAR_PENDENTES_FAILED', message: err.message } })
  }
})

// POST /disparar-gerados { instancia_id, prospect_ids? } — envia as mensagens já geradas
// (aguardando_disparo). Sem prospect_ids, dispara todos os pendentes da instância.
router.post('/disparar-gerados', requireAuth, requireEmpresaAccess, requireCapacidade(CAP.LEAD_DISPARAR_SEMI, CAP.LEAD_DISPARAR_LOTE), async (req, res) => {
  try {
    const { instancia_id, prospect_ids } = req.body || {}
    if (!instancia_id) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Escolha uma instância.' } })
    }
    if (!(await assertInstanciaPermitida(req, res, instancia_id))) return
    const data = await dispararGerados(pool, {
      empresaId: req.empresa.id,
      instanciaId: instancia_id,
      prospectIds: Array.isArray(prospect_ids) ? prospect_ids : [],
    })
    return res.json({ ok: true, data })
  } catch (err) {
    const status = err.statusCode || 500
    if (status >= 500) logger.error('[api-banco-leads] DISPARAR_GERADOS_FAILED:', err.message)
    return res.status(status).json({ ok: false, error: { code: 'DISPARAR_GERADOS_FAILED', message: err.message } })
  }
})

// POST /limpar — apaga os leads SEM contato (sem email E sem telefone).
// Protege negócios fechados (status 'fechado' nunca é removido). Irreversível.
router.post('/limpar', requireAuth, requireEmpresaAccess, requireCapacidade(CAP.LEAD_DISPARAR_LOTE), async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const cond = `empresa_id = $1
      AND NULLIF(BTRIM(COALESCE(email, '')), '') IS NULL
      AND NULLIF(BTRIM(COALESCE(telefone, '')), '') IS NULL
      AND status <> 'fechado'`
    // Limpa disparos órfãos desses leads (caso existam) antes de removê-los.
    await client.query(
      `DELETE FROM prospectador.lead_disparos
        WHERE empresa_id = $1 AND prospect_id IN (
          SELECT id FROM prospectador.prospects WHERE ${cond})`,
      [req.empresa.id]
    )
    const del = await client.query(
      `DELETE FROM prospectador.prospects WHERE ${cond} RETURNING id`,
      [req.empresa.id]
    )
    await client.query('COMMIT')
    return res.json({ ok: true, data: { removidos: del.rowCount } })
  } catch (err) {
    await client.query('ROLLBACK')
    return envelopeErro(res, err, 'LIMPAR_FAILED')
  } finally {
    client.release()
  }
})

// GET /resumo — contagem por aba (para os badges das abas).
router.get('/resumo', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { query: queryComEscopo } = comEscopo(req)
    const recorte = montarRecorteOperacao(req.empresa.id, queryComEscopo)
    const paramsAbas = [...recorte.params, ABAS.sem_contato, ABAS.conversou, ABAS.fecharam]
    const phSemContato = `$${recorte.params.length + 1}`
    const phConversou = `$${recorte.params.length + 2}`
    const phFecharam = `$${recorte.params.length + 3}`
    const [{ rows }, { rows: [c] }, { rows: [ag] }] = await Promise.all([
      pool.query(
        `SELECT status, COUNT(*)::int AS total
           FROM prospectador.prospects WHERE ${recorte.where} GROUP BY status`,
        recorte.params
      ),
      // Contagem por aba consistente com os filtros (sem WhatsApp conta em Descartados,
      // não em Sem contato).
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = ANY(${phSemContato}) AND tem_whatsapp IS DISTINCT FROM false)::int AS sem_contato,
           COUNT(*) FILTER (WHERE status = ANY(${phConversou}))::int AS conversou,
           COUNT(*) FILTER (WHERE status = ANY(${phFecharam}))::int AS fecharam,
           COUNT(*) FILTER (WHERE status IN ('rejeitado', 'nao_contatar') OR tem_whatsapp = false)::int AS descartados
         FROM prospectador.prospects WHERE ${recorte.where}`,
        paramsAbas
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total FROM prospectador.prospects WHERE ${recorte.where} AND ${AGENDA_FUTURA_EXISTS}`,
        recorte.params
      ),
    ])
    const porStatus = Object.fromEntries(rows.map((r) => [r.status, r.total]))
    const abas = {
      sem_contato: c.sem_contato, conversou: c.conversou,
      fecharam: c.fecharam, descartados: c.descartados,
      agendados: ag.total,
    }
    return res.json({ ok: true, data: { abas, por_status: porStatus } })
  } catch (err) { return envelopeErro(res, err, 'RESUMO_FAILED') }
})

router.get('/filtros', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { query: queryComEscopo } = comEscopo(req)
    const data = await listarOpcoesFiltrosMercado(pool, {
      empresaId: req.empresa.id,
      ...montarEscopoOpcoes(req.query || {}),
      escopoSql: queryComEscopo.__escopoSql,
      escopoUsaUsuario: queryComEscopo.__escopoUsaUsuario,
      usuarioId: queryComEscopo.__usuarioId,
      somenteAprovados: queryComEscopo.__somenteAprovados,
    })
    return res.json({ ok: true, data })
  } catch (err) {
    return envelopeErro(res, err, 'FILTROS_FAILED')
  }
})

// PATCH /leads/:id/status — muda o status operacional e registra quem mudou/quando.
router.patch('/leads/:id/status', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await alterarStatusLeadOperacional(req, (req.body || {}).status)
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'LEAD_STATUS_FAILED') }
})

// PATCH /leads/:id/icp — salva a avaliação humana do ICP a partir de Detalhes.
//
// O cadastro continua sendo completude. Esta rota grava o eixo comercial: critérios humanos,
// sinais automáticos e faixa Lead A/B/C. Lead A entra automaticamente como marcado/aprovado,
// porque passou do corte do ICP.
//
// Gate por ROTA, não pelo mount: o mount de /banco-leads exige só LEAD_VER_APROVADOS, e esta
// rota ATRAVESSA A PORTA da triagem (grava `qualificacao='aprovado'` quando dá Lead A). Quem
// aprova lead é quem tem LEAD_TRIAR — o papel `comercial` NÃO tem, e sem isto ele aprovaria
// pelo modal de Detalhes o que a curadoria lhe recusa.
router.patch('/leads/:id/icp', requireAuth, requireEmpresaAccess, requireCapacidade(CAP.LEAD_TRIAR), async (req, res) => {
  const client = await pool.connect()
  try {
    const usuarioId = req.usuario?.id || null
    const body = req.body || {}
    await client.query('BEGIN')

    await exigirLeadNoRecorte(req, client)
    const { rows: atuais } = await client.query(
      `SELECT * FROM prospectador.prospects
        WHERE empresa_id = $1 AND id = $2::uuid
        FOR UPDATE`,
      [req.empresa.id, req.params.id]
    )
    const atual = atuais[0]
    if (!atual) {
      const e = new Error('Lead não encontrado.')
      e.statusCode = 404
      throw e
    }

    const icp = await salvarAvaliacaoIcp(client, {
      empresaId: req.empresa.id,
      prospect: atual,
      decisao: body.decisao || 'aprovado',
      respostas: body.respostas || null,
      observacao: body.observacao || null,
      usuarioId,
    })

    const autoQualificado = icp?.faixa === 'A'
    if (autoQualificado) {
      await client.query(
        `UPDATE prospectador.prospects
            SET status = CASE
                  WHEN status IN ('coletado', 'contato_encontrado', 'aguardando') THEN 'aprovado'
                  ELSE status
                END,
                qualificacao = 'aprovado',
                qualificado_em = COALESCE(qualificado_em, NOW()),
                qualificado_por = COALESCE(qualificado_por, $3::uuid),
                updated_at = NOW()
          WHERE empresa_id = $1 AND id = $2::uuid`,
        [req.empresa.id, req.params.id, usuarioId]
      )
    }

    await client.query(
      `INSERT INTO app.auditoria_eventos
         (empresa_id, usuario_id, entidade_tipo, entidade_id, acao, estado_anterior, estado_novo, contexto)
       VALUES ($1, $2::uuid, 'prospect', $3::uuid, 'lead_icp_avaliado', $4, $5, $6::jsonb)`,
      [req.empresa.id, usuarioId, req.params.id, atual.icp_faixa || null, icp?.faixa || null, JSON.stringify({
        origem: 'banco_leads_detalhes',
        score: icp?.score ?? null,
        faixa: icp?.faixa ?? null,
        auto_qualificado: autoQualificado,
      })]
    )

    const { rows } = await client.query(
      `SELECT ${COLUNAS}, raw_json
         FROM prospectador.prospects
        WHERE empresa_id = $1 AND id = $2::uuid`,
      [req.empresa.id, req.params.id]
    )
    await client.query('COMMIT')
    return res.json({ ok: true, data: anexarScoreCadastro(rows[0]) })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    return envelopeErro(res, err, 'LEAD_ICP_FAILED')
  } finally {
    client.release()
  }
})

// POST /leads/:id/fechar — compatibilidade com o botão antigo.
router.post('/leads/:id/fechar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await alterarStatusLeadOperacional(req, 'fechado')
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'FECHAR_FAILED') }
})

// POST /leads/:id/reabrir — compatibilidade: fechado volta para respondido.
router.post('/leads/:id/reabrir', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await alterarStatusLeadOperacional(req, 'respondido')
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'REABRIR_FAILED') }
})

// PATCH /leads/:id/email  { email } — define/edita/limpa o e-mail do lead.
// O recorte da LISTAGEM é repetido aqui: sem ele bastaria trocar o id na URL para escrever num
// lead que a tela não mostra. É a mesma disciplina que as rotas por id de conversas e instâncias
// já aplicam (404, nunca 403 — dizer "existe, mas não é seu" já entrega o lead).
router.patch('/leads/:id/email', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    await exigirLeadNoRecorte(req)
    const data = await atualizarEmailProspect(req.empresa.id, req.params.id, (req.body || {}).email)
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'EMAIL_UPDATE_FAILED') }
})

/** O lead está dentro do recorte de quem pediu? Devolve a linha (com o que a escrita precisa). */
async function exigirLeadNoRecorte(req, client) {
  const exec = client || pool
  const recorte = montarRecorteLeadOperacao(req)
  const params = [...recorte.params, req.params.id]
  const { rows } = await exec.query(
    `SELECT id, nome, status, telefone, tem_whatsapp
       FROM prospectador.prospects
      WHERE ${recorte.where} AND id = $${params.length}::uuid`,
    params
  )
  if (!rows[0]) {
    const e = new Error('Lead não encontrado para o seu escopo.')
    e.statusCode = 404
    throw e
  }
  return rows[0]
}

// PATCH /leads/:id/telefone  { telefone } — o "+ telefone" da listagem.
//
// Por que NÃO é o `/email` com outro campo: telefone é a IDENTIDADE do contato (follow-up e
// disponibilidade de canal são chaveados por telefone, a agenda casa reunião por telefone, o
// wa.me e o disparo saem dele). Trocar o número não é corrigir um campo — é dizer que o contato
// é outro. Daí as três coisas que esta rota faz além do UPDATE:
//   1. RECUSA número que já é de outro lead desta empresa (409). Dois leads no mesmo número
//      apontariam para a MESMA conversa — `vendas.conversas.numero` é UNIQUE global.
//   2. ZERA `tem_whatsapp`. Ele é veredito sobre um NÚMERO (nasce `false` quando o Evolution
//      respondeu `exists:false` para o número ANTIGO). Carregá-lo manteria o lead em
//      "Descartados" e fora da elegibilidade: o operador corrigiria o telefone e o lead
//      continuaria morto, sem nada na tela explicando por quê.
//   3. Marca a origem como `operador` no `raw_json`, e é essa marca que faz a recoleta da
//      Bright Data PRESERVAR o número digitado à mão (ver salvarProspect em prospecting.js).
router.patch('/leads/:id/telefone', requireAuth, requireEmpresaAccess, async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const atual = await exigirLeadNoRecorte(req, client)

    const { rows: hist } = await client.query(
      `SELECT 1 FROM prospectador.lead_disparos WHERE prospect_id = $1::uuid LIMIT 1`,
      [req.params.id]
    )
    const veredito = LT.validarTelefoneLead((req.body || {}).telefone, { jaAbordado: !!hist[0] })
    if (!veredito.ok) {
      const e = new Error(veredito.mensagem)
      e.statusCode = 400
      throw e
    }

    if (veredito.telefone) {
      const { rows: donos } = await client.query(
        `SELECT nome FROM prospectador.prospects
          WHERE empresa_id = $1 AND id <> $2::uuid
            AND ${normFone('telefone')} = ${normFone('$3')}
          LIMIT 1`,
        [req.empresa.id, req.params.id, veredito.telefone]
      )
      if (donos[0]) {
        const e = new Error(`${LT.MENSAGEM[LT.MOTIVOS.EM_USO]} (${donos[0].nome}).`)
        e.statusCode = 409
        throw e
      }
    }

    const efeitos = LT.efeitosDaTrocaDeTelefone({
      telefoneAtual: atual.telefone, telefoneNovo: veredito.telefone, status: atual.status,
    })
    const usuarioId = req.usuario?.id || null
    const { rows } = await client.query(
      `UPDATE prospectador.prospects
          SET telefone = $3::text,
              status = COALESCE($4::text, status),
              tem_whatsapp = CASE WHEN $5::boolean THEN NULL ELSE tem_whatsapp END,
              raw_json = CASE
                WHEN $3::text IS NULL THEN COALESCE(raw_json, '{}'::jsonb) - 'telefone_origem'
                ELSE jsonb_set(COALESCE(raw_json, '{}'::jsonb), '{telefone_origem}', '"operador"'::jsonb, true)
              END,
              updated_at = NOW()
        WHERE empresa_id = $1 AND id = $2::uuid
        RETURNING id, telefone, status, tem_whatsapp`,
      [req.empresa.id, req.params.id, veredito.telefone, efeitos.statusNovo, efeitos.resetarTemWhatsapp]
    )

    if (efeitos.mudou) {
      // Fato sobre o CONTATO — precisa continuar rastreável. Só dígitos e o que mudou: nada de
      // JID, nome de conversa ou texto de mensagem.
      await client.query(
        `INSERT INTO app.auditoria_eventos
           (empresa_id, usuario_id, entidade_tipo, entidade_id, acao, estado_anterior, estado_novo, contexto)
         VALUES ($1, $2::uuid, 'prospect', $3::uuid, 'lead_telefone_alterado', $4, $5, $6::jsonb)`,
        [req.empresa.id, usuarioId, req.params.id,
          atual.telefone ? 'com_telefone' : 'sem_telefone',
          rows[0].telefone ? 'com_telefone' : 'sem_telefone',
          JSON.stringify({
            origem: 'banco_leads',
            telefone_digitos: rows[0].telefone || null,
            tinha_telefone: !!atual.telefone,
            tem_whatsapp_resetado: !!efeitos.resetarTemWhatsapp && atual.tem_whatsapp !== null,
            status_promovido: efeitos.statusNovo || null,
          })]
      )
    }

    await client.query('COMMIT')
    return res.json({ ok: true, data: rows[0] })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    return envelopeErro(res, err, 'TELEFONE_UPDATE_FAILED')
  } finally {
    client.release()
  }
})

// Escapa um campo para CSV pt-BR (separador ';'). Aspas duplicadas; quebra protegida.
function csvCampo(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// GET /export.csv?aba=&origem=&busca= — baixa a aba atual em CSV (Excel pt-BR).
router.get('/export.csv', requireAuth, requireEmpresaAccess, requireCapacidade(CAP.LEAD_VER_BRUTOS), async (req, res) => {
  try {
    const { where, params } = montarFiltro(req.empresa.id, req.query)
    const { rows } = await pool.query(
      `SELECT origem, status, nome, telefone, email, instagram_handle,
              nicho, cidade, site, seguidores, created_at, updated_at
         FROM prospectador.prospects
        WHERE ${where} ORDER BY updated_at DESC LIMIT 5000`,
      params
    )
    const cabecalho = ['Origem', 'Status', 'Nome', 'Telefone', 'Email', 'Instagram',
      'Nicho', 'Cidade', 'Site', 'Seguidores', 'Criado em', 'Atualizado em']
    const linhas = rows.map((r) => [
      r.origem, r.status, r.nome, r.telefone, r.email, r.instagram_handle,
      r.nicho, r.cidade, r.site, r.seguidores,
      r.created_at && new Date(r.created_at).toISOString(),
      r.updated_at && new Date(r.updated_at).toISOString(),
    ].map(csvCampo).join(';'))
    // BOM (﻿) faz o Excel reconhecer UTF-8 e mostrar acentos corretamente.
    const csv = '﻿' + [cabecalho.join(';'), ...linhas].join('\r\n')
    const aba = ABAS[String(req.query.aba || '').toLowerCase()] ? String(req.query.aba).toLowerCase() : 'leads'
    const nomeArquivo = `banco-leads-${aba}-${new Date().toISOString().slice(0, 10)}.csv`
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`)
    return res.send(csv)
  } catch (err) { return envelopeErro(res, err, 'EXPORT_FAILED') }
})

module.exports = router
