'use strict'
// Acesso a banco da entidade FOLLOW-UP (migration 062). Isolado por empresa: TODA query
// filtra `empresa_id`, e as FKs de contexto (ligacao, lead da campanha, prospect) passam por
// `assertMesmaEmpresa` antes de serem gravadas — nunca referenciar dado de outro tenant.
//
// As REGRAS vivem em services/follow-up-modelo.js (modulo PURO). Aqui so' ha SQL.
const {
  validarNovoFollowUp, validarMudancaStatus, validarReagendamento, acaoPadraoDoCanal,
  FOLLOWUP_CANAL, FOLLOWUP_STATUS,
} = require('../services/follow-up-modelo')
const {
  resolverCanalFollowUp, disponibilidadeInformada, enderecoEmailConfirmado,
} = require('../services/contato-canal-disponibilidade')
const D = require('./contato-canal-disponibilidade')
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

/** So para MENSAGEM de erro ao operador — a apresentacao da fila vive no front. */
const CANAL_ROTULO = Object.freeze({ whatsapp: 'WhatsApp', ligacao: 'ligacao', email: 'e-mail' })

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
 * Os vereditos HUMANOS sobre os canais deste contato, num formato so.
 *
 * Um lugar unico para as duas leituras porque a regra de canal precisa das duas ao mesmo
 * tempo: "sem WhatsApp -> e-mail confirmado -> ligacao" nao se decide olhando um canal de
 * cada vez. Reusa `obterDisponibilidade` (nenhuma query nova) e traduz a linha de e-mail com
 * a funcao pura — cadastro nunca entra aqui.
 */
async function vereditosDoContato(exec, empresaId, telefoneDigitos) {
  const [whats, email] = await Promise.all([
    D.obterDisponibilidade(exec, empresaId, telefoneDigitos, 'whatsapp'),
    D.obterDisponibilidade(exec, empresaId, telefoneDigitos, 'email'),
  ])
  return {
    whatsapp_disponivel: whats ? whats.disponivel : null,
    email_disponivel: email ? email.disponivel : null,
    email_confirmado: enderecoEmailConfirmado(email),
  }
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

  // DISPONIBILIDADE DE CANAL (migrations 066 e 067). Se uma PESSOA ja marcou que este
  // contato nao tem WhatsApp, um follow-up novo por WhatsApp nasce ja no canal possivel —
  // senao a proxima ligacao encerrada recriaria, sozinha, exatamente o item que o operador
  // acabou de corrigir. `null` (ninguem verificou) mantem o comportamento historico.
  // O e-mail so entra na conta quando ha endereco CONFIRMADO por pessoa; cadastro nao conta.
  const vereditos = await vereditosDoContato(exec, empresaId, p.telefone_digitos)
  const canalResolvido = resolverCanalFollowUp(
    p.canal, vereditos.whatsapp_disponivel, vereditos.email_confirmado, vereditos.email_disponivel)
  const canal = canalResolvido.canal
  // A acao padrao acompanha o canal: "Retomar por WhatsApp" num item que virou ligacao
  // mandaria o operador fazer o que acabou de ser declarado impossivel.
  const proximaAcao = canalResolvido.trocou && p.proxima_acao === acaoPadraoDoCanal(p.canal)
    ? (acaoPadraoDoCanal(canal) || p.proxima_acao)
    : p.proxima_acao

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
    [empresaId, canal, proximaAcao, p.agendado_para, p.prioridade, p.origem, p.telefone_digitos,
      p.responsavel_id, usuarioId, p.ligacao_id, p.campanha_lead_id, p.prospect_id, conversaNumero, p.observacao]
  )
  // `canal_solicitado` so' aparece quando houve troca: e o que permite a tela dizer "voce
  // pediu WhatsApp, mas este contato esta marcado como sem WhatsApp" em vez de mudar o canal
  // em silencio. Campo calculado em JS, nunca uma coluna.
  return canalResolvido.trocou
    ? { ...rows[0], canal_solicitado: p.canal, canal_ajustado_motivo: canalResolvido.motivo }
    : rows[0]
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

// Derivados do vocabulario, nao copiados: um canal novo (o `email` da 067 foi o primeiro)
// precisa aparecer no filtro sem ninguem lembrar de editar dois lugares.
const STATUS_FILTRAVEIS = new Set(FOLLOWUP_STATUS)
const CANAIS_FILTRAVEIS = new Set(FOLLOWUP_CANAL)

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
            cam.nome AS campanha_nome,
            -- Veredito HUMANO sobre o WhatsApp deste contato (migration 066).
            -- NULL = ninguem verificou; nao e' false. O JOIN e' por (empresa, telefone),
            -- exatamente o par do indice unico contato_canal_disp_uk.
            d.disponivel AS whatsapp_disponivel,
            d.marcado_em AS whatsapp_marcado_em,
            d.motivo     AS whatsapp_motivo,
            -- Mesmo veredito HUMANO, para o canal de e-mail (migration 067). O ENDERECO so
            -- sai quando ele foi confirmado: veredito falso nao tem destino, e mandar um
            -- endereco junto de "nao recebe e-mail" faria a tela oferecer um caminho que o
            -- operador acabou de descartar.
            e.disponivel AS email_disponivel,
            e.marcado_em AS email_marcado_em,
            e.motivo     AS email_motivo,
            CASE WHEN e.disponivel THEN e.endereco END AS email_endereco
       FROM app.follow_ups f
       LEFT JOIN app.contato_canal_disponibilidade d
              ON d.empresa_id = f.empresa_id
             AND d.telefone_digitos = f.telefone_digitos
             AND d.canal = 'whatsapp'
       LEFT JOIN app.contato_canal_disponibilidade e
              ON e.empresa_id = f.empresa_id
             AND e.telefone_digitos = f.telefone_digitos
             AND e.canal = 'email'
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

/** BEGIN/COMMIT/ROLLBACK local — o mesmo molde de db/ligacoes.js. */
async function comTransacao(pool, fn) {
  const client = await pool.connect()
  try { await client.query('BEGIN'); const r = await fn(client); await client.query('COMMIT'); return r }
  catch (e) { try { await client.query('ROLLBACK') } catch { /* ignora */ } throw e }
  finally { client.release() }
}

/**
 * Reagenda (move prazo/prioridade/texto/responsavel) mantendo o MESMO item — mesma origem,
 * mesmo contexto, mesma rastreabilidade. Nao e' "cancelar e criar outro": o historico do
 * contato ficaria com um cancelamento que nunca aconteceu.
 *
 * DISPONIBILIDADE DE CANAL (migrations 066 e 067). `entrada.whatsapp_disponivel` e'
 * TRI-ESTADO:
 *   ausente -> o operador nao se pronunciou; nada e' gravado e o canal nao muda;
 *   false   -> "este contato nao tem WhatsApp": grava o veredito e o item sai do WhatsApp;
 *   true    -> DESFAZ a marcacao; o item volta a poder usar WhatsApp.
 *
 * `entrada.email_disponivel` (+ `email_endereco`, `email_motivo`) e' o mesmo tri-estado para
 * o canal de e-mail. Confirmar EXIGE endereco — sem destino nao ha canal, e um item de
 * e-mail sem para onde enviar entraria na fila e nunca sairia dela. Com e-mail confirmado, o
 * item que sai do WhatsApp vai para o E-MAIL; sem ele, vai para ligacao (que sempre existe,
 * porque o telefone e' a identidade do contato).
 *
 * A marcacao e a troca de canal acontecem na MESMA transacao de proposito. O canal continua
 * nao sendo um campo livre do formulario — trocar de canal a mao segue sendo "outra decisao";
 * o que existe agora e uma CONSEQUENCIA de um fato declarado sobre o contato.
 *
 * Desfazer NAO devolve o item para WhatsApp sozinho: ele volta a ser POSSIVEL, mas quem
 * moveu o trabalho para ligacao foi uma decisao registrada, e revoga-la automaticamente
 * mandaria de volta para um canal que talvez ninguem queira mais usar naquele contato.
 */
async function reagendarFollowUp(pool, empresaId, id, entrada = {}, { agora, usuarioId = null } = {}) {
  const atual = await obterFollowUp(pool, empresaId, id)
  const disponivel = disponibilidadeInformada(entrada.whatsapp_disponivel)
  const emailDisponivelPedido = disponibilidadeInformada(entrada.email_disponivel, 'email_disponivel')
  // `validarReagendamento` exige pelo menos um campo. Marcar disponibilidade tambem e' uma
  // mudanca legitima, entao ela conta como conteudo — senao "so marquei sem WhatsApp"
  // devolveria "Nada para reagendar".
  const patch = validarReagendamento(atual.status, entrada, agora || new Date(), {
    permitirPatchVazio: disponivel !== undefined || emailDisponivelPedido !== undefined,
  })
  if (patch.responsavel_id) await assertResponsavelDaEmpresa(pool, empresaId, patch.responsavel_id)

  return comTransacao(pool, async (client) => {
    let disponibilidade = null
    if (disponivel !== undefined) {
      disponibilidade = await D.marcarDisponibilidade(client, empresaId, {
        telefone: atual.telefone_digitos, canal: 'whatsapp', disponivel,
        motivo: entrada.disponibilidade_motivo,
      }, { usuarioId })
    }
    // E-MAIL (migration 067). Confirmar exige dizer PARA ONDE (`email_endereco`) — a mesma
    // condicao que a CHECK impoe no banco. Negar nao exige endereco: e uma afirmacao sobre o
    // contato nao receber e-mail, nao sobre um endereco especifico.
    let disponibilidadeEmail = null
    if (emailDisponivelPedido !== undefined) {
      disponibilidadeEmail = await D.marcarDisponibilidade(client, empresaId, {
        telefone: atual.telefone_digitos, canal: 'email', disponivel: emailDisponivelPedido,
        motivo: entrada.email_motivo, endereco: entrada.email_endereco,
      }, { usuarioId })
    }

    // Os vereditos que valem sao os do banco DEPOIS das marcacoes desta transacao (ou os que
    // ja estavam la, quando o operador nao se pronunciou agora).
    const doBanco = await vereditosDoContato(client, empresaId, atual.telefone_digitos)
    const canalResolvido = resolverCanalFollowUp(
      atual.canal, doBanco.whatsapp_disponivel, doBanco.email_confirmado, doBanco.email_disponivel)

    const campos = []
    const params = [id, empresaId]
    const set = (col, val) => { params.push(val); campos.push(`${col} = $${params.length}`) }
    if (patch.agendado_para !== undefined) set('agendado_para', patch.agendado_para)
    if (patch.prioridade !== undefined) set('prioridade', patch.prioridade)
    if (patch.responsavel_id !== undefined) set('responsavel_id', patch.responsavel_id)
    if (canalResolvido.trocou) set('canal', canalResolvido.canal)
    // O texto do operador vence o padrao; so' quando ele nao reescreveu e o canal mudou e
    // que a acao padrao acompanha o canal novo.
    const acaoPedida = patch.proxima_acao !== undefined ? patch.proxima_acao : atual.proxima_acao
    const acaoFinal = canalResolvido.trocou && acaoPedida === acaoPadraoDoCanal(atual.canal)
      ? (acaoPadraoDoCanal(canalResolvido.canal) || acaoPedida)
      : acaoPedida
    if (acaoFinal !== atual.proxima_acao) set('proxima_acao', acaoFinal)

    if (!campos.length) return { ...atual, disponibilidade, disponibilidade_email: disponibilidadeEmail, canal_trocado: false }

    let rows
    try {
      ({ rows } = await client.query(
        `UPDATE app.follow_ups SET ${campos.join(', ')}, atualizado_em = NOW()
          WHERE id = $1 AND empresa_id = $2 AND status = 'aguardando'
          RETURNING ${COLS}`,
        params
      ))
    } catch (e) {
      // Colisao com `follow_ups_um_aberto_por_canal_uk`: ja existe uma acao ABERTA no canal
      // de destino para este contato. Nao se funde nem se sobrescreve — cada item carrega
      // origem e contexto proprios, e escolher um deles aqui apagaria o trabalho do outro.
      // A transacao inteira volta atras: nunca fica o contato marcado com o item no canal
      // errado. O operador fecha o item existente e repete a acao.
      if (e && e.code === '23505') {
        throw erroEntrada(
          `Este contato ja tem um follow-up de ${CANAL_ROTULO[canalResolvido.canal] || canalResolvido.canal} em aberto. `
          + 'Conclua ou cancele aquele item antes de mover este.', 409)
      }
      throw e
    }
    if (!rows[0]) throw erroEntrada('Follow-up nao esta mais em aberto.', 409)
    return {
      ...rows[0],
      disponibilidade,
      disponibilidade_email: disponibilidadeEmail,
      canal_trocado: canalResolvido.trocou,
      canal_anterior: canalResolvido.trocou ? atual.canal : null,
      canal_ajustado_motivo: canalResolvido.trocou ? canalResolvido.motivo : null,
    }
  })
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

       -- E-mails do follow-up (migration 067). Entram porque, ao contrario das mensagens de
       -- WhatsApp, NAO existe outra tela que os mostre — omiti-los deixaria o operador sem
       -- saber que o contato ja recebeu um e-mail. Sai o ASSUNTO (o titulo do que foi
       -- combinado), nunca o corpo: a linha do tempo responde "o que aconteceu", nao
       -- reproduz conteudo.
       UNION ALL
       SELECT 'email_' || fe.status, COALESCE(fe.enviado_em, fe.criado_em), fe.assunto, fe.erro, fe.follow_up_id, NULL::int, 'email'
         FROM app.follow_up_emails fe
        WHERE fe.empresa_id = $1 AND fe.telefone_digitos = $2
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
  vereditosDoContato,
}
