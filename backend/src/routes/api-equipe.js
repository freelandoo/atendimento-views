'use strict'
// Painel da EQUIPE — CRM em equipe, Etapa 12.
// Ver docs/plano-execucao-crm-equipe.md §6 (Etapa 12).
//
// ─── O QUE ESTA ROTA É ───────────────────────────────────────────────────────────────────
// Uma LEITURA AGREGADA de quem está com o quê, montada a partir das contagens que cada módulo já
// sabe fazer. Ela **não tem SQL próprio**: chama `contagemPorResponsavel` de leads, conversas,
// follow-ups e `contagemPorUsuario` de ligações. Reescrever essas consultas aqui criaria uma
// segunda definição de "quantos leads o vendedor X tem" — e as duas divergiriam no primeiro
// ajuste.
//
// ─── O QUE ELA NÃO É ─────────────────────────────────────────────────────────────────────
// **Não é analítica comercial.** Aquilo vive em `/relatorios` e na view
// `app.vw_ligacoes_analiticas`. Esta responde uma pergunta de GESTÃO DE EQUIPE: quem está com
// carga demais, quem não tem nada, e o que está vencido.
//
// ─── AUDITORIA ───────────────────────────────────────────────────────────────────────────
// `app.auditoria_eventos` é consultável aqui **por pessoa**, mas com um recorte estreito de
// propósito: a migration 047 declara que a auditoria *"NÃO deve ser fonte de dashboards"*. O que
// esta rota devolve é a lista das últimas ações de uma pessoa — rastreabilidade, não métrica.
// As métricas vêm das tabelas de histórico (migrations 072 e 074), que existem justamente para
// isso.

const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess, requireCapacidade } = require('../middleware/tenant')
const { CAPACIDADES: CAP } = require('../services/acesso-capacidades')
const LR = require('../db/lead-responsavel')
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

// GET /equipe — uma linha por membro, com a carga de trabalho de cada um.
//
// Exige MEMBROS_GERENCIAR (e não uma capacidade nova): quem gerencia as contas é quem responde
// pela distribuição do trabalho. Criar uma capacidade `equipe_ver` separada produziria uma
// terceira resposta para a mesma pergunta ("você coordena a equipe?").
router.get('/', requireAuth, requireEmpresaAccess, requireCapacidade(CAP.MEMBROS_GERENCIAR), async (req, res) => {
  try {
    const empresaId = req.empresa.id
    const [membros, leads, conversas, followUps, ligacoes] = await Promise.all([
      listarMembros(empresaId),
      LR.contagemPorResponsavel(pool, empresaId),
      CR.contagemPorResponsavel(pool, empresaId),
      FU.contagemPorResponsavel(pool, empresaId),
      LIG.contagemPorUsuario(pool, empresaId),
    ])

    const porLead = indexarPorUsuario(leads, 'responsavel_id')
    const porConversa = indexarPorUsuario(conversas, 'responsavel_id')
    const porFollowUp = indexarPorUsuario(followUps, 'responsavel_id')
    const porLigacao = indexarPorUsuario(ligacoes, 'usuario_id')

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
        conversas: porConversa.get(id)?.conversas || 0,
        follow_ups_aguardando: porFollowUp.get(id)?.aguardando || 0,
        follow_ups_vencidos: porFollowUp.get(id)?.vencidos || 0,
        ligacoes: porLigacao.get(id)?.ligacoes || 0,
      }
    })

    // O trabalho SEM DONO é uma linha própria, e não pode ser omitido: é justamente o que o admin
    // precisa ver para redistribuir, e sem ele a soma das linhas não fecharia com o total.
    const semDono = {
      usuario_id: null,
      nome: 'Sem responsável',
      leads: porLead.get('null')?.leads || 0,
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
