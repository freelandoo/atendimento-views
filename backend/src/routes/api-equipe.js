'use strict'
// Painel da EQUIPE — CRM em equipe, Etapa 12.
// Ver docs/plano-execucao-crm-equipe.md §6 (Etapa 12).
//
// ─── O QUE ESTA ROTA É ───────────────────────────────────────────────────────────────────
// Uma LEITURA AGREGADA de quem está com o quê agora, montada a partir das contagens que cada
// módulo já sabe fazer, mais um resumo estreito das ações registradas hoje. A carga atual continua
// vindo dos módulos donos de leads, conversas, follow-ups e ligações; a auditoria só entra para
// responder "o que esta pessoa mexeu hoje?".
//
// ─── O QUE ELA NÃO É ─────────────────────────────────────────────────────────────────────
// **Não é analítica comercial.** Aquilo vive em `/relatorios` e na view
// `app.vw_ligacoes_analiticas`. Esta responde uma pergunta de GESTÃO DE EQUIPE: quem está com
// carga demais, quem não tem nada, e o que está vencido.
//
// ─── AUDITORIA ───────────────────────────────────────────────────────────────────────────
// `app.auditoria_eventos` é consultável aqui em DOIS recortes estreitos:
//  1. linha do tempo de uma pessoa — rastreabilidade, não métrica;
//  2. resumo operacional DO DIA — contagem de ações concretas para gestão diária.
//
// O resumo diário NÃO é placar nem produtividade líquida: ele não soma ações diferentes num score e
// não chama tempo entre eventos de "horas trabalhadas". A tela rotula como janela ativa estimada,
// porque só há prova de ações registradas, não de presença contínua.

const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess, requireCapacidade } = require('../middleware/tenant')
const { CAPACIDADES: CAP } = require('../services/acesso-capacidades')
const LR = require('../db/lead-responsavel')
const PARADO = require('../db/lead-parado')
const LP = require('../services/lead-parado')
const CR = require('../db/conversa-responsavel')
const FU = require('../db/follow-ups')
const LIG = require('../db/ligacoes')
const { listarMembros } = require('../db/membros')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

function envelopeErro(res, err, code) {
  const status = err?.statusCode || 500
  logger.error({ err: err?.message, code }, '[api-equipe] falha')
  const message = status >= 500 ? 'Não foi possível carregar o painel da equipe.' : (err?.message || 'Dados inválidos.')
  return res.status(status).json({ ok: false, error: { code, message } })
}

/** Índice por id, para juntar as quatro contagens numa linha por pessoa. */
function indexarPorUsuario(linhas, chave) {
  const mapa = new Map()
  for (const l of linhas || []) {
    const id = l[chave] || null
    mapa.set(String(id), l)
  }
  return mapa
}

async function atividadeHojePorUsuario(empresaId) {
  const { rows } = await pool.query(
    `WITH eventos AS (
       SELECT usuario_id, acao, estado_novo, ocorrido_em
         FROM app.auditoria_eventos
        WHERE empresa_id = $1
          AND usuario_id IS NOT NULL
          AND ocorrido_em >= (date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')
     )
     SELECT usuario_id,
            COUNT(*)::int AS acoes,
            COUNT(*) FILTER (WHERE acao IN ('lead_responsavel_assumiu','lead_responsavel_atribuiu'))::int AS leads_assumidos,
            COUNT(*) FILTER (WHERE acao = 'lead_status_alterado' AND estado_novo = 'aprovado')::int AS leads_marcados,
            COUNT(*) FILTER (WHERE (acao = 'lead_status_alterado' AND estado_novo = 'enviado') OR acao = 'abordagem_manual_declarada')::int AS contatos_registrados,
            COUNT(*) FILTER (WHERE acao = 'lead_status_alterado' AND estado_novo = 'respondeu')::int AS respondidos,
            COUNT(*) FILTER (WHERE acao = 'lead_status_alterado' AND estado_novo = 'fechado')::int AS fechados,
            COUNT(*) FILTER (WHERE acao = 'ligacao_chamada_encerrada')::int AS ligacoes_encerradas,
            COUNT(*) FILTER (WHERE acao IN ('follow_up_concluido','follow_up_cancelado','follow_up_email_enviado','followup_manual_conversa_iniciada'))::int AS followups_tratados,
            MIN(ocorrido_em) AS primeira_acao_em,
            MAX(ocorrido_em) AS ultima_acao_em,
            GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (MAX(ocorrido_em) - MIN(ocorrido_em))) / 60))::int AS janela_ativa_min
       FROM eventos
      GROUP BY usuario_id`,
    [empresaId]
  )
  return rows
}

// GET /equipe — uma linha por membro, com a carga de trabalho de cada um.
//
// Exige MEMBROS_GERENCIAR (e não uma capacidade nova): quem gerencia as contas é quem responde
// pela distribuição do trabalho. Criar uma capacidade `equipe_ver` separada produziria uma
// terceira resposta para a mesma pergunta ("você coordena a equipe?").
router.get('/', requireAuth, requireEmpresaAccess, requireCapacidade(CAP.MEMBROS_GERENCIAR), async (req, res) => {
  try {
    const empresaId = req.empresa.id
    // O prazo do "parado" vem da QUERY, não de configuração: o admin olha a carteira com 7 dias
    // e, na conversa seguinte, quer ver com 15. Criar uma coluna de config para um recorte de
    // leitura seria pedir uma decisão permanente para responder uma pergunta passageira.
    const prazoParado = LP.normalizarPrazo(req.query.parado_dias)
    const [membros, leads, conversas, followUps, ligacoes, atividadeHoje, parados] = await Promise.all([
      listarMembros(empresaId),
      LR.contagemPorResponsavel(pool, empresaId),
      CR.contagemPorResponsavel(pool, empresaId),
      FU.contagemPorResponsavel(pool, empresaId),
      LIG.contagemPorUsuario(pool, empresaId),
      atividadeHojePorUsuario(empresaId),
      PARADO.contagemPorResponsavel(pool, empresaId, prazoParado),
    ])

    const porLead = indexarPorUsuario(leads, 'responsavel_id')
    const porConversa = indexarPorUsuario(conversas, 'responsavel_id')
    const porFollowUp = indexarPorUsuario(followUps, 'responsavel_id')
    const porLigacao = indexarPorUsuario(ligacoes, 'usuario_id')
    const porAtividadeHoje = indexarPorUsuario(atividadeHoje, 'usuario_id')
    const porParado = indexarPorUsuario(parados, 'responsavel_id')

    const linhas = membros.map((m) => {
      const id = String(m.usuario_id)
      return {
        usuario_id: m.usuario_id,
        nome: m.nome,
        email: m.email,
        papel: m.role,
        // `ativo` cobre os dois níveis: o vínculo com a empresa e a conta na plataforma.
        // Mostrar "ativo" para quem tem a conta desativada mandaria o admin procurar o problema
        // no lugar errado.
        ativo: m.ativo !== false && m.usuario_ativo !== false,
        ultimo_acesso_em: m.ultimo_acesso_em || null,
        leads: porLead.get(id)?.leads || 0,
        // SUBCONJUNTO de `leads`, nunca uma carga a mais: somar os dois contaria o mesmo lead
        // duas vezes. É um ALERTA dentro da carteira, não uma carteira paralela.
        leads_parados: porParado.get(id)?.parados || 0,
        leads_parados_mais_antigo_dias: porParado.get(id)?.mais_antigo_dias ?? null,
        conversas: porConversa.get(id)?.conversas || 0,
        follow_ups_aguardando: porFollowUp.get(id)?.aguardando || 0,
        follow_ups_vencidos: porFollowUp.get(id)?.vencidos || 0,
        ligacoes: porLigacao.get(id)?.ligacoes || 0,
        atividade_hoje: porAtividadeHoje.get(id) || {
          acoes: 0, leads_assumidos: 0, leads_marcados: 0, contatos_registrados: 0, respondidos: 0,
          fechados: 0, ligacoes_encerradas: 0, followups_tratados: 0, primeira_acao_em: null,
          ultima_acao_em: null, janela_ativa_min: 0,
        },
      }
    })

    // O trabalho SEM DONO é uma linha própria, e não pode ser omitido: é justamente o que o admin
    // precisa ver para redistribuir, e sem ele a soma das linhas não fecharia com o total.
    const semDono = {
      usuario_id: null,
      nome: 'Sem responsável',
      leads: porLead.get('null')?.leads || 0,
      // Sempre 0, e o campo existe para a tela não ter de tratar ausência: lead SEM responsável
      // não está parado — ele está na FILA, que é estado legítimo (migration 072). Confundir os
      // dois juntaria problemas de donos diferentes: um é de quem assumiu, o outro de quem
      // distribui.
      leads_parados: 0,
      leads_parados_mais_antigo_dias: null,
      conversas: porConversa.get('null')?.conversas || 0,
      follow_ups_aguardando: porFollowUp.get('null')?.aguardando || 0,
      follow_ups_vencidos: porFollowUp.get('null')?.vencidos || 0,
      ligacoes: porLigacao.get('null')?.ligacoes || 0,
    }

    // Carga de quem foi DESATIVADO continua aparecendo: o trabalho não some junto com o acesso, e
    // redistribuir é ação explícita do admin (ver a política de desativação, §6.1 da especificação).
    const inativosComCarga = linhas.filter((l) => !l.ativo && (l.leads || l.conversas || l.follow_ups_aguardando))

    return res.json({
      ok: true,
      data: {
        equipe: linhas,
        sem_responsavel: semDono,
        avisos: {
          inativos_com_carga: inativosComCarga.map((l) => ({
            usuario_id: l.usuario_id, nome: l.nome,
            leads: l.leads, conversas: l.conversas, follow_ups: l.follow_ups_aguardando,
          })),
        },
      },
      // A JANELA vai no meta porque a tela é obrigada a DECLARÁ-LA: "3 parados" sem dizer
      // "há mais de 7 dias" é um número que ninguém consegue conferir nem contestar.
      meta: { parado_dias: prazoParado },
    })
  } catch (err) { return envelopeErro(res, err, 'EQUIPE_FAILED') }
})

// GET /equipe/:usuarioId/atividade — as últimas ações de uma pessoa.
//
// Rastreabilidade, NÃO métrica (ver o cabeçalho). Por isso: limite baixo, ordem cronológica
// inversa e nenhum agregado. O `contexto` sai como veio — os módulos que escrevem nele já o
// mantêm sem PII (telefone_digitos, nunca JID; nunca texto de mensagem).
router.get('/:usuarioId/atividade', requireAuth, requireEmpresaAccess, requireCapacidade(CAP.MEMBROS_GERENCIAR), async (req, res) => {
  try {
    const limite = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200)
    const { rows } = await pool.query(
      `SELECT a.id, a.acao, a.entidade_tipo, a.entidade_id,
              a.estado_anterior, a.estado_novo, a.contexto, a.ocorrido_em
         FROM app.auditoria_eventos a
        WHERE a.empresa_id = $1 AND a.usuario_id = $2::uuid
        ORDER BY a.ocorrido_em DESC
        LIMIT $3`,
      [req.empresa.id, req.params.usuarioId, limite]
    )
    return res.json({ ok: true, data: rows })
  } catch (err) { return envelopeErro(res, err, 'ATIVIDADE_FAILED') }
})

module.exports = router
