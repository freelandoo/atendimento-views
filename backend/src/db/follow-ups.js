'use strict'
// Acesso a banco da entidade FOLLOW-UP (migration 062). Isolado por empresa: TODA query
// filtra `empresa_id`, e as FKs de contexto (ligacao, lead da campanha, prospect) passam por
// `assertMesmaEmpresa` antes de serem gravadas — nunca referenciar dado de outro tenant.
//
// As REGRAS vivem em services/follow-up-modelo.js (modulo PURO). Aqui so' ha SQL.
const {
  validarNovoFollowUp, validarMudancaStatus, validarReagendamento,
} = require('../services/follow-up-modelo')
const { assertMesmaEmpresa } = require('./campanhas')

// Colunas devolvidas por todas as leituras de item. `telefone_digitos` e a identidade;
// `conversa_numero` e cache de conveniencia (ver cabecalho da migration 062).
const COLS = `id, empresa_id, canal, proxima_acao, agendado_para, prioridade, status, origem,
  telefone_digitos, responsavel_id, criado_por, ligacao_id, campanha_lead_id, prospect_id,
  conversa_numero, observacao, resultado_nota, concluido_em, concluido_por, criado_em, atualizado_em`

function erroEntrada(message, statusCode = 400) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

/**
 * Resolve o JID da conversa daquele telefone DENTRO da empresa, se ela ja existir.
 *
 * Escopado em `c.empresa_id = $1` de proposito, SEM o fallback para a PJ que
 * `api-conversas.js` faz: `vendas.conversas.numero` e' UNIQUE **GLOBAL**, entao o mesmo
 * telefone pode ser conversa de outro tenant — devolver esse JID aqui faria o follow-up de
 * uma empresa apontar para a conversa de outra. Sem conversa na empresa, devolve null e o
 * follow-up nasce sem cache (o que e' correto: a conversa pode ser criada depois).
 */
async function resolverConversaNumero(exec, empresaId, telefoneDigitos) {
  const { rows } = await exec.query(
    `SELECT c.numero
       FROM vendas.conversas c
      WHERE c.empresa_id = $1
        AND regexp_replace(c.numero, '[^0-9]', '', 'g') = $2
      ORDER BY c.atualizado_em DESC
      LIMIT 1`,
    [empresaId, telefoneDigitos]
  )
  return rows[0] ? rows[0].numero : null
}

/**
 * Cria a proxima acao.
 *
 * `exec` aceita pool OU client de transacao — e' o que permite `encerrarLigacao` gravar o
 * follow-up na MESMA transacao do encerramento: ou a ligacao encerra com a proxima acao
 * combinada, ou nao encerra. Um follow-up gravado fora da transacao poderia sobreviver a um
 * rollback do encerramento e mandar o operador agir sobre uma ligacao que nao existe.
 *
 * ANTIDUPLICIDADE: `ON CONFLICT` sobre o indice parcial `follow_ups_um_aberto_por_canal_uk`
 * (um item aberto por contato+canal). O conflito faz DO UPDATE, nao DO NOTHING, e a regra e'
 * EXPLICITA: **a decisao mais recente vence**. Quem acabou de falar com o cliente sabe mais
 * que o agendamento anterior; manter os dois criaria a duplicidade que o pedido proibiu, e
 * ignorar o novo faria a tela mentir sobre o que foi combinado na ligacao.
 */
async function criarFollowUp(exec, empresaId, entrada = {}, { usuarioId = null, agora } = {}) {
  const p = validarNovoFollowUp(entrada, agora || new Date())

  await assertMesmaEmpresa(exec, { schema: 'app', table: 'ligacoes', id: p.ligacao_id, empresaId, rotulo: 'Ligacao' })
  await assertMesmaEmpresa(exec, { schema: 'app', table: 'campanha_leads', id: p.campanha_lead_id, empresaId, rotulo: 'Lead da campanha' })
  await assertMesmaEmpresa(exec, { schema: 'prospectador', table: 'prospects', id: p.prospect_id, empresaId, rotulo: 'Lead' })
  if (p.responsavel_id) await assertResponsavelDaEmpresa(exec, empresaId, p.responsavel_id)

  const conversaNumero = p.conversa_numero || await resolverConversaNumero(exec, empresaId, p.telefone_digitos)

  const { rows } = await exec.query(
    `INSERT INTO app.follow_ups
       (empresa_id, canal, proxima_acao, agendado_para, prioridade, origem, telefone_digitos,
        responsavel_id, criado_por, ligacao_id, campanha_lead_id, prospect_id, conversa_numero, observacao)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (empresa_id, telefone_digitos, canal) WHERE status = 'aguardando'
     DO UPDATE SET
       proxima_acao     = EXCLUDED.proxima_acao,
       agendado_para    = EXCLUDED.agendado_para,
       prioridade       = EXCLUDED.prioridade,
       origem           = EXCLUDED.origem,
       responsavel_id   = EXCLUDED.responsavel_id,
       ligacao_id       = COALESCE(EXCLUDED.ligacao_id, app.follow_ups.ligacao_id),
       campanha_lead_id = COALESCE(EXCLUDED.campanha_lead_id, app.follow_ups.campanha_lead_id),
       prospect_id      = COALESCE(EXCLUDED.prospect_id, app.follow_ups.prospect_id),
       conversa_numero  = COALESCE(EXCLUDED.conversa_numero, app.follow_ups.conversa_numero),
       observacao       = COALESCE(EXCLUDED.observacao, app.follow_ups.observacao),
       atualizado_em    = NOW()
     RETURNING ${COLS}, (xmax <> 0) AS substituiu`,
    [empresaId, p.canal, p.proxima_acao, p.agendado_para, p.prioridade, p.origem, p.telefone_digitos,
      p.responsavel_id, usuarioId, p.ligacao_id, p.campanha_lead_id, p.prospect_id, conversaNumero, p.observacao]
  )
  return rows[0]
}

/** O responsavel precisa ser um usuario ATIVO com vinculo ATIVO nesta empresa. */
async function assertResponsavelDaEmpresa(exec, empresaId, usuarioId) {
  const { rows } = await exec.query(
    `SELECT 1 FROM app.usuarios_empresas ue
       JOIN app.usuarios u ON u.id = ue.usuario_id
      WHERE ue.empresa_id = $1 AND ue.usuario_id = $2 AND ue.ativo = true AND u.ativo = true`,
    [empresaId, usuarioId]
  )
  if (!rows[0]) throw erroEntrada('Responsavel nao encontrado nesta empresa.', 400)
}

/** Usuarios que podem ser responsaveis por um follow-up desta empresa. */
async function listarResponsaveis(pool, empresaId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.nome, u.email
       FROM app.usuarios_empresas ue
       JOIN app.usuarios u ON u.id = ue.usuario_id
      WHERE ue.empresa_id = $1 AND ue.ativo = true AND u.ativo = true
      ORDER BY u.nome`,
    [empresaId]
  )
  return rows
}

async function obterFollowUp(pool, empresaId, id) {
  if (!id) throw erroEntrada('id do follow-up obrigatorio.')
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM app.follow_ups WHERE id = $1 AND empresa_id = $2`, [id, empresaId])
  if (!rows[0]) throw erroEntrada('Follow-up nao encontrado.', 404)
  return rows[0]
}

const STATUS_FILTRAVEIS = new Set(['aguardando', 'concluido', 'cancelado', 'falha'])
const CANAIS_FILTRAVEIS = new Set(['whatsapp', 'ligacao'])

/**
 * Itens da fila. Enriquecido com o que a tela precisa para identificar o contato sem uma
 * segunda requisicao: nome do lead (do cadastro OU do perfil da conversa) e nome do
 * responsavel. O nome vem NULO quando nao ha apelido/negocio — cair para o telefone e' decisao
 * de APRESENTACAO (`lib/lead-identidade.js`), como no resto da fila; devolver o JID aqui
 * colocaria o identificador tecnico do Evolution na coluna "Lead".
 */
async function listarFollowUps(pool, empresaId, opts = {}) {
  const params = [empresaId]
  const conds = ['f.empresa_id = $1']
  if (opts.status && STATUS_FILTRAVEIS.has(opts.status)) {
    params.push(opts.status); conds.push(`f.status = $${params.length}`)
  }
  if (opts.canal && CANAIS_FILTRAVEIS.has(opts.canal)) {
    params.push(opts.canal); conds.push(`f.canal = $${params.length}`)
  }
  params.push(Math.min(Math.max(Number.parseInt(opts.limit, 10) || 300, 1), 500))
  const { rows } = await pool.query(
    `SELECT ${COLS.split(',').map((c) => `f.${c.trim()}`).join(', ')},
            COALESCE(NULLIF(pr.nome, ''), NULLIF(lp.apelido, ''), NULLIF(lp.negocio, '')) AS nome,
            COALESCE(NULLIF(pr.cidade, ''), NULLIF(lp.cidade, '')) AS cidade,
            u.nome AS responsavel_nome,
            l.resultado AS ligacao_resultado,
            l.encerrada_em AS ligacao_em,
            cl.campanha_id AS campanha_id,
            cam.nome AS campanha_nome
       FROM app.follow_ups f
       LEFT JOIN prospectador.prospects pr ON pr.id = f.prospect_id
       LEFT JOIN vendas.conversas c ON c.numero = f.conversa_numero AND c.empresa_id = f.empresa_id
       LEFT JOIN vendas.lead_profiles lp ON lp.numero = c.numero
       LEFT JOIN app.usuarios u ON u.id = f.responsavel_id
       LEFT JOIN app.ligacoes l ON l.id = f.ligacao_id AND l.empresa_id = f.empresa_id
       LEFT JOIN app.campanha_leads cl ON cl.id = f.campanha_lead_id AND cl.empresa_id = f.empresa_id
       LEFT JOIN app.campanhas cam ON cam.id = cl.campanha_id AND cam.empresa_id = f.empresa_id
      WHERE ${conds.join(' AND ')}
      -- Em aberto primeiro, na ordem do prazo; depois o historico, do mais recente para o
      -- mais antigo. Sem isso, um teto de leitura cortaria justamente o trabalho pendente
      -- para caber follow-ups concluidos ha meses.
      ORDER BY (f.status <> 'aguardando'),
               CASE WHEN f.status = 'aguardando' THEN f.agendado_para END ASC,
               f.concluido_em DESC NULLS LAST
      LIMIT $${params.length}`,
    params
  )
  return rows
}

/**
 * Conclui / cancela / marca falha. Idempotente: repetir a mesma transicao devolve o item sem
 * reescrever `concluido_em` — senao um duplo clique moveria a hora em que o trabalho terminou.
 *
 * `concluido_em` marca o FIM do item em qualquer estado terminal (concluido, cancelado ou
 * falha): e o instante que a linha do tempo do contato precisa, e a CHECK da migration so'
 * o exige para 'concluido'.
 */
async function mudarStatusFollowUp(pool, empresaId, id, entrada = {}, { usuarioId = null } = {}) {
  const atual = await obterFollowUp(pool, empresaId, id)
  const p = validarMudancaStatus(atual.status, entrada)
  if (p.idempotente) return { ...atual, ja_estava: true }
  const { rows } = await pool.query(
    `UPDATE app.follow_ups
        SET status = $3,
            resultado_nota = COALESCE($4, resultado_nota),
            concluido_em = NOW(),
            concluido_por = $5,
            atualizado_em = NOW()
      WHERE id = $1 AND empresa_id = $2 AND status = 'aguardando'
      RETURNING ${COLS}`,
    [id, empresaId, p.status, p.nota, usuarioId]
  )
  // Corrida: outro operador fechou o item primeiro. Devolve o estado real em vez de erro —
  // o trabalho ja foi feito, e a fila do segundo operador so' precisa se atualizar.
  if (!rows[0]) return { ...(await obterFollowUp(pool, empresaId, id)), ja_estava: true }
  return rows[0]
}

/**
 * Reagenda (move prazo/prioridade/texto/responsavel) mantendo o MESMO item — mesma origem,
 * mesmo contexto, mesma rastreabilidade. Nao e' "cancelar e criar outro": o historico do
 * contato ficaria com um cancelamento que nunca aconteceu.
 */
async function reagendarFollowUp(pool, empresaId, id, entrada = {}, { agora } = {}) {
  const atual = await obterFollowUp(pool, empresaId, id)
  const patch = validarReagendamento(atual.status, entrada, agora || new Date())
  if (patch.responsavel_id) await assertResponsavelDaEmpresa(pool, empresaId, patch.responsavel_id)

  const campos = []
  const params = [id, empresaId]
  const set = (col, val) => { params.push(val); campos.push(`${col} = $${params.length}`) }
  if (patch.agendado_para !== undefined) set('agendado_para', patch.agendado_para)
  if (patch.prioridade !== undefined) set('prioridade', patch.prioridade)
  if (patch.proxima_acao !== undefined) set('proxima_acao', patch.proxima_acao)
  if (patch.responsavel_id !== undefined) set('responsavel_id', patch.responsavel_id)

  const { rows } = await pool.query(
    `UPDATE app.follow_ups SET ${campos.join(', ')}, atualizado_em = NOW()
      WHERE id = $1 AND empresa_id = $2 AND status = 'aguardando'
      RETURNING ${COLS}`,
    params
  )
  if (!rows[0]) throw erroEntrada('Follow-up nao esta mais em aberto.', 409)
  return rows[0]
}

/**
 * LINHA DO TEMPO do contato — por que uma acao foi criada, sem duplicar dado e sem expor
 * detalhe tecnico.
 *
 * O que entra: ligacoes encerradas (`app.ligacoes`), ligacoes registradas pela fila de
 * follow-up (`vendas.followup_ligacoes`) e o ciclo de vida dos proprios follow-ups.
 * O que NAO entra, de proposito: o texto das MENSAGENS. Elas ja sao mostradas por inteiro
 * pelo painel de conversa (`components/ConversaPainel.tsx`), que e' o mesmo nas duas portas
 * de entrada — repeti-las aqui seria a mesma informacao em dois lugares, com o risco de
 * divergirem. Tambem nao sai `ctwa_clid`, JID cru nem id tecnico do Evolution.
 *
 * Casamento por telefone em DIGITOS, sempre dentro da empresa (ver migration 062).
 */
async function historicoDoContato(pool, empresaId, telefoneDigitos, { limit = 100 } = {}) {
  const lim = Math.min(Math.max(Number.parseInt(limit, 10) || 100, 1), 300)
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT 'ligacao_encerrada' AS tipo,
              l.encerrada_em AS ocorrido_em,
              l.resultado    AS rotulo,
              l.motivo_perda AS detalhe,
              l.id           AS referencia_id,
              l.duracao_seg  AS duracao_seg,
              NULL::text     AS canal
         FROM app.ligacoes l
        WHERE l.empresa_id = $1
          AND l.status = 'encerrada'
          AND regexp_replace(COALESCE(l.telefone, ''), '[^0-9]', '', 'g') = $2

       UNION ALL
       SELECT 'ligacao_registrada', fl.criado_em, fl.resultado, NULL, NULL::uuid, NULL::int, NULL
         FROM vendas.followup_ligacoes fl
        WHERE fl.empresa_id = $1
          AND regexp_replace(fl.numero, '[^0-9]', '', 'g') = $2

       UNION ALL
       SELECT 'followup_criado', f.criado_em, f.proxima_acao, f.origem, f.id, NULL::int, f.canal
         FROM app.follow_ups f
        WHERE f.empresa_id = $1 AND f.telefone_digitos = $2

       UNION ALL
       SELECT 'followup_' || f.status, f.concluido_em, f.proxima_acao, f.resultado_nota, f.id, NULL::int, f.canal
         FROM app.follow_ups f
        WHERE f.empresa_id = $1 AND f.telefone_digitos = $2
          AND f.status <> 'aguardando' AND f.concluido_em IS NOT NULL
     ) t
     WHERE t.ocorrido_em IS NOT NULL
     ORDER BY t.ocorrido_em DESC
     LIMIT $3`,
    [empresaId, telefoneDigitos, lim]
  )
  return rows
}

/** Resumo da proxima acao de uma ligacao — e' o unico que a Central de Ligacoes exibe. */
async function followUpDaLigacao(pool, empresaId, ligacaoId) {
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM app.follow_ups
      WHERE empresa_id = $1 AND ligacao_id = $2
      ORDER BY criado_em DESC LIMIT 1`,
    [empresaId, ligacaoId]
  )
  return rows[0] || null
}

module.exports = {
  criarFollowUp,
  obterFollowUp,
  listarFollowUps,
  mudarStatusFollowUp,
  reagendarFollowUp,
  listarResponsaveis,
  historicoDoContato,
  followUpDaLigacao,
  resolverConversaNumero,
}
