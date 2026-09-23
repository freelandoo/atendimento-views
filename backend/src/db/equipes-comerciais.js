'use strict'
// Equipes Comerciais — acesso a dados.
// A equipe organiza a operacao por nicho; ela NAO substitui o papel/capacidade do membro.

const { pool } = require('../db')
const E = require('../services/equipes-comerciais')
const DIST = require('./lead-distribuicao')
const D = require('../services/lead-distribuicao')
const LR = require('./lead-responsavel')
const { podeCapacidade, CAPACIDADES: CAP } = require('../services/acesso-capacidades')
const { logger } = require('../logger')

function erro(mensagem, statusCode = 400, code = 'BAD_REQUEST') {
  const e = new Error(mensagem)
  e.statusCode = statusCode
  e.code = code
  return e
}

async function withTx(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const r = await fn(client)
    await client.query('COMMIT')
    return r
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

async function auditar(client, { empresaId, usuarioId, acao, entidadeId, estadoAnterior, estadoNovo, contexto }) {
  await client.query(
    `INSERT INTO app.auditoria_eventos
       (empresa_id, usuario_id, entidade_tipo, entidade_id, acao, estado_anterior, estado_novo, contexto)
     VALUES ($1, $2::uuid, 'equipe_comercial', $3::uuid, $4, $5, $6, $7::jsonb)`,
    [empresaId, usuarioId || null, entidadeId || null, acao,
      estadoAnterior || null, estadoNovo || null, JSON.stringify(contexto || {})]
  )
}

async function assertNichoAtivo(client, empresaId, nichoId) {
  const { rows } = await client.query(
    `SELECT id, nome FROM app.nichos
      WHERE empresa_id = $1 AND id = $2::uuid AND ativo = true
      LIMIT 1`,
    [empresaId, nichoId]
  )
  if (!rows[0]) throw erro('Nicho não encontrado ou inativo nesta empresa.', 400, 'NICHO_INVALIDO')
  return rows[0]
}

async function vinculosAtivos(client, empresaId, usuarioIds) {
  const ids = [...new Set((usuarioIds || []).map(String).filter(Boolean))]
  if (!ids.length) return []
  const { rows } = await client.query(
    `SELECT ue.id AS usuario_empresa_id, ue.usuario_id, u.nome, u.email
       FROM app.usuarios_empresas ue
       JOIN app.usuarios u ON u.id = ue.usuario_id
      WHERE ue.empresa_id = $1
        AND ue.usuario_id = ANY($2::uuid[])
        AND ue.ativo = true
        AND u.ativo = true`,
    [empresaId, ids]
  )
  if (rows.length !== ids.length) {
    throw erro('Todos os participantes precisam ser membros ativos desta empresa.', 400, 'PARTICIPANTE_INVALIDO')
  }
  return rows
}

async function obterEquipe(client, empresaId, equipeId, { forUpdate = false } = {}) {
  const { rows } = await client.query(
    `SELECT e.id, e.empresa_id, e.nicho_id, n.nome AS nicho_nome,
            e.nome, e.descricao, e.status, e.criado_por, e.criado_em,
            e.encerrada_em, e.encerrada_por
       FROM app.equipes_comerciais e
       JOIN app.nichos n ON n.id = e.nicho_id AND n.empresa_id = e.empresa_id
      WHERE e.empresa_id = $1 AND e.id = $2::uuid
      LIMIT 1
      ${forUpdate ? 'FOR UPDATE OF e' : ''}`,
    [empresaId, equipeId]
  )
  return rows[0] || null
}

async function membrosDaEquipe(exec, empresaId, equipeId) {
  const { rows } = await exec.query(
    `SELECT em.id, em.equipe_id, em.usuario_empresa_id, em.usuario_id,
            u.nome, u.email, ue.role, em.entrou_em
       FROM app.equipe_comercial_membros em
       JOIN app.usuarios u ON u.id = em.usuario_id
       JOIN app.usuarios_empresas ue ON ue.id = em.usuario_empresa_id
      WHERE em.empresa_id = $1
        AND em.equipe_id = $2::uuid
        AND em.saiu_em IS NULL
      ORDER BY u.nome ASC`,
    [empresaId, equipeId]
  )
  return rows
}

async function listarEquipes(empresaId) {
  const { rows } = await pool.query(
    `SELECT e.id, e.nicho_id, n.nome AS nicho_nome, e.nome, e.descricao, e.status,
            e.criado_por, e.criado_em, e.encerrada_em, e.encerrada_por,
            COUNT(em.id)::int AS total_membros
       FROM app.equipes_comerciais e
       JOIN app.nichos n ON n.id = e.nicho_id AND n.empresa_id = e.empresa_id
       LEFT JOIN app.equipe_comercial_membros em
         ON em.empresa_id = e.empresa_id AND em.equipe_id = e.id AND em.saiu_em IS NULL
      WHERE e.empresa_id = $1
      GROUP BY e.id, n.nome
      ORDER BY e.status ASC, e.criado_em DESC`,
    [empresaId]
  )
  return rows
}

async function equipeComMembros(empresaId, equipeId) {
  const equipe = await obterEquipe(pool, empresaId, equipeId)
  if (!equipe) return null
  return { ...equipe, membros: await membrosDaEquipe(pool, empresaId, equipeId) }
}

async function substituirParticipantes(client, empresaId, equipe, usuarioIds, autorId, { motivo = 'Atualização de participantes da equipe.' } = {}) {
  const participantes = await vinculosAtivos(client, empresaId, usuarioIds)
  const desejados = new Set(participantes.map((p) => String(p.usuario_id)))
  const atuais = await membrosDaEquipe(client, empresaId, equipe.id)
  const atuaisSet = new Set(atuais.map((p) => String(p.usuario_id)))

  const remover = atuais.filter((p) => !desejados.has(String(p.usuario_id)))
  const adicionar = participantes.filter((p) => !atuaisSet.has(String(p.usuario_id)))

  // ─── SAIDA: fecha o vinculo e devolve TODOS os leads da pessoa para a fila ─────────────
  //
  // Decisao do operador (2026-09-21): a devolucao NAO filtra por "protegido" — mesmo lead com
  // reuniao marcada ou conversa aberta volta, porque a pessoa deixou de fazer parte da equipe
  // que responde por aquele nicho. `liberarLeadsDoMembro` (db/lead-responsavel.js, dono unico
  // de `app.lead_responsavel_historico`) grava uma linha por lead e devolve os dois contadores
  // de RISCO (reuniao futura / conversa aberta) — informacao para a tela avisar, nunca bloqueio.
  const devolucao = []
  if (remover.length) {
    await client.query(
      `UPDATE app.equipe_comercial_membros
          SET saiu_em = NOW(), removido_por = $3::uuid, motivo_saida = $4
        WHERE empresa_id = $1 AND equipe_id = $2::uuid
          AND usuario_id = ANY($5::uuid[]) AND saiu_em IS NULL`,
      [empresaId, equipe.id, autorId || null, motivo, remover.map((p) => p.usuario_id)]
    )
    for (const p of remover) {
      const resultado = await LR.liberarLeadsDoMembro(client, {
        empresaId, nichoId: equipe.nicho_id, origemId: p.usuario_id, usuarioId: autorId, motivo,
      })
      devolucao.push({ usuario_id: p.usuario_id, nome: p.nome, ...resultado })
    }
  }

  for (const p of adicionar) {
    try {
      await client.query(
        `INSERT INTO app.equipe_comercial_membros
           (empresa_id, equipe_id, usuario_empresa_id, usuario_id, criado_por)
         VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5::uuid)`,
        [empresaId, equipe.id, p.usuario_empresa_id, p.usuario_id, autorId || null]
      )
    } catch (err) {
      if (err?.code === '23505') {
        throw erro('Uma das pessoas selecionadas já está em outra equipe ativa.', 409, 'PARTICIPANTE_JA_TEM_EQUIPE')
      }
      throw err
    }
  }

  if (remover.length || adicionar.length) {
    await auditar(client, {
      empresaId,
      usuarioId: autorId,
      acao: 'equipe_comercial_participantes_atualizados',
      entidadeId: equipe.id,
      contexto: {
        adicionados: adicionar.map((p) => p.usuario_id),
        removidos: remover.map((p) => p.usuario_id),
        leads_devolvidos: devolucao.reduce((t, d) => t + (d.liberados || 0), 0),
      },
    })
  }

  // ─── O GATILHO DO REBALANCEAMENTO ──────────────────────────────────────────────────────
  //
  // Entrou gente na equipe: a carteira INTOCADA do nicho e' redividida entre os membros. Roda na
  // MESMA transacao de proposito — "entrou na equipe e recebeu carteira" e' um fato so', e uma
  // entrada que promete carteira e nao entrega deixaria a pessoa olhando uma tela vazia sem
  // ninguem saber por que.
  //
  // ⚠️ SO' QUANDO ALGUEM ENTRA. Salvar a mesma lista de participantes de novo nao redistribui
  // nada: repetir a acao nao pode remexer carteira, e reequilibrar por vontade propria e' o
  // botao "Puxar mais leads" / o rebalanceamento pedido, nunca um efeito colateral de salvar.
  // Lead PROTEGIDO (reuniao, conversa, follow-up, ligacao, disparo) nunca entra nesta conta —
  // ver o cabecalho de `services/lead-distribuicao.js`.
  if (!adicionar.length) return { distribuicao: null, devolucao }
  const membrosFinais = await membrosDaEquipe(client, empresaId, equipe.id)
  const distribuicao = await DIST.rebalancearEquipe(client, {
    empresaId,
    equipeId: equipe.id,
    nichoId: equipe.nicho_id,
    usuarioIds: membrosFinais.map((m) => m.usuario_id),
    autorId,
  })
  return { distribuicao, devolucao }
}

async function criarEquipe(empresaId, dados = {}, autorId = null) {
  const v = E.normalizarEquipe(dados, { criar: true })
  return withTx(async (client) => {
    const nicho = await assertNichoAtivo(client, empresaId, v.nicho_id)
    let equipe
    try {
      const { rows } = await client.query(
        `INSERT INTO app.equipes_comerciais (empresa_id, nicho_id, nome, descricao, criado_por)
         VALUES ($1, $2::uuid, $3, $4, $5::uuid)
         RETURNING id, empresa_id, nicho_id, nome, descricao, status, criado_por, criado_em`,
        [empresaId, v.nicho_id, v.nome, v.descricao || null, autorId || null]
      )
      equipe = rows[0]
    } catch (err) {
      if (err?.code === '23505') {
        throw erro('Já existe uma equipe ativa com esse nome ou nicho.', 409, 'EQUIPE_DUPLICADA')
      }
      throw err
    }
    await auditar(client, {
      empresaId,
      usuarioId: autorId,
      acao: 'equipe_comercial_criada',
      entidadeId: equipe.id,
      estadoNovo: equipe.nome,
      contexto: { nicho_id: equipe.nicho_id },
    })
    // Equipe recem-criada nunca tem quem remover: `devolucao` sai sempre vazia aqui.
    const resultado = v.usuario_ids
      ? await substituirParticipantes(client, empresaId, equipe, v.usuario_ids, autorId)
      : { distribuicao: null, devolucao: [] }
    logger.info({ empresa_id: empresaId, equipe_id: equipe.id }, '[equipes-comerciais] equipe criada')
    return {
      ...equipe,
      nicho_nome: nicho.nome,
      membros: await membrosDaEquipe(client, empresaId, equipe.id),
      distribuicao: resultado.distribuicao,
    }
  })
}

/**
 * Renomear a equipe (nome e descricao). NADA MAIS, de proposito.
 *
 * ⚠️ O NICHO fica de fora, e nao e' esquecimento: e' ele que RECORTA o Banco de Leads de todo
 * mundo da equipe (`sqlNichoDaEquipe`). Trocar o nicho por um PATCH mudaria a carteira de
 * varias pessoas de uma vez, em silencio e sem devolver nada — a mesma classe de problema que
 * fez a remocao de participante exigir a etapa de devolucao de leads. Para mudar de nicho,
 * encerra-se a equipe e cria-se outra, que e' o caminho que deixa rastro.
 *
 * ⚠️ Equipe ENCERRADA nao se renomeia: ela e' historico, e as decisoes tomadas sob aquele nome
 * continuam registradas na auditoria. Renomear reescreveria o que as pessoas viram.
 *
 * O UPDATE e' condicionado (`IS DISTINCT FROM`) e a auditoria so' e' gravada quando algo mudou
 * de verdade — repetir a acao nao infla `app.auditoria_eventos` (mesmo contrato de
 * `PATCH /conversas/:numero/modo-ia`).
 */
async function atualizarEquipe(empresaId, equipeId, dados = {}, autorId = null) {
  const v = E.normalizarEquipe(dados, { criar: false })
  const nome = v.nome === undefined ? null : v.nome
  const descricao = dados.descricao === undefined ? undefined : (v.descricao || null)
  if (nome == null && descricao === undefined) {
    throw erro('Nada para alterar: informe o nome ou a descricao.', 400, 'NADA_A_ALTERAR')
  }

  return withTx(async (client) => {
    const equipe = await obterEquipe(client, empresaId, equipeId, { forUpdate: true })
    if (!equipe) throw erro('Equipe não encontrada nesta empresa.', 404, 'NOT_FOUND')
    if (equipe.status !== 'ativa') {
      throw erro('Equipe encerrada não pode ser renomeada — ela é histórico.', 409, 'EQUIPE_ENCERRADA')
    }

    let linha
    try {
      const { rows } = await client.query(
        `UPDATE app.equipes_comerciais
            SET nome = COALESCE($3, nome),
                descricao = CASE WHEN $5::boolean THEN $4 ELSE descricao END
          WHERE empresa_id = $1 AND id = $2::uuid
            AND (nome IS DISTINCT FROM COALESCE($3, nome)
                 OR ($5::boolean AND descricao IS DISTINCT FROM $4))
          RETURNING id, empresa_id, nicho_id, nome, descricao, status, criado_por, criado_em`,
        [empresaId, equipeId, nome, descricao === undefined ? null : descricao, descricao !== undefined]
      )
      linha = rows[0] || null
    } catch (err) {
      if (err?.code === '23505') {
        throw erro('Já existe uma equipe ativa com esse nome.', 409, 'EQUIPE_DUPLICADA')
      }
      throw err
    }

    // Nada mudou: devolve o estado atual sem auditar. Repetir o clique nao e' um fato novo.
    if (!linha) {
      return { ...equipe, alterado: false, membros: await membrosDaEquipe(client, empresaId, equipeId) }
    }

    await auditar(client, {
      empresaId,
      usuarioId: autorId,
      acao: 'equipe_comercial_atualizada',
      entidadeId: equipeId,
      estadoAnterior: equipe.nome,
      estadoNovo: linha.nome,
      // Sem PII: nome de EQUIPE e' rotulo de organizacao, nao dado de pessoa.
      contexto: { campos: [nome != null ? 'nome' : null, descricao !== undefined ? 'descricao' : null].filter(Boolean) },
    })
    logger.info({ empresa_id: empresaId, equipe_id: equipeId }, '[equipes-comerciais] equipe atualizada')
    return {
      ...linha,
      nicho_nome: equipe.nicho_nome,
      alterado: true,
      membros: await membrosDaEquipe(client, empresaId, equipeId),
    }
  })
}

async function definirParticipantes(empresaId, equipeId, dados = {}, autorId = null) {
  const v = E.normalizarParticipantes(dados)
  return withTx(async (client) => {
    const equipe = await obterEquipe(client, empresaId, equipeId, { forUpdate: true })
    if (!equipe) throw erro('Equipe não encontrada nesta empresa.', 404, 'NOT_FOUND')
    if (equipe.status !== 'ativa') throw erro('Equipe encerrada não recebe participantes.', 409, 'EQUIPE_ENCERRADA')
    const resultado = await substituirParticipantes(client, empresaId, equipe, v.usuario_ids, autorId)
    return {
      ...equipe,
      membros: await membrosDaEquipe(client, empresaId, equipe.id),
      distribuicao: resultado.distribuicao,
      devolucao: resultado.devolucao,
    }
  })
}

/**
 * Põe UMA pessoa numa equipe, DENTRO da transação do chamador — o cadastro de membro (direto ou
 * por convite). "Entrou na empresa e entrou na equipe" é um fato só: se a equipe recusar, a conta
 * também não nasce, e ninguém fica com acesso e sem equipe.
 *
 * Não reimplementa nada: soma a pessoa à lista atual e passa por `substituirParticipantes`, o
 * MESMO caminho do modal — mesma checagem de "já está em outra equipe" (409), mesma auditoria e
 * o MESMO rebalanceamento automático da carteira intocada do nicho.
 */
async function adicionarParticipanteEmTx(client, empresaId, equipeId, usuarioId, autorId = null) {
  const equipe = await obterEquipe(client, empresaId, equipeId, { forUpdate: true })
  if (!equipe) throw erro('Equipe não encontrada nesta empresa.', 404, 'EQUIPE_NAO_ENCONTRADA')
  if (equipe.status !== 'ativa') throw erro('Esta equipe foi encerrada e não recebe participantes.', 409, 'EQUIPE_ENCERRADA')
  const atuais = await membrosDaEquipe(client, empresaId, equipe.id)
  const ids = [...new Set([...atuais.map((m) => String(m.usuario_id)), String(usuarioId)])]
  const resultado = await substituirParticipantes(client, empresaId, equipe, ids, autorId, {
    motivo: 'Entrada na empresa já dentro da equipe.',
  })
  return { equipe_id: equipe.id, equipe_nome: equipe.nome, distribuicao: resultado.distribuicao }
}

async function encerrarEquipe(empresaId, equipeId, dados = {}, autorId = null) {
  const v = E.normalizarEncerramento(dados)
  return withTx(async (client) => {
    const equipe = await obterEquipe(client, empresaId, equipeId, { forUpdate: true })
    if (!equipe) throw erro('Equipe não encontrada nesta empresa.', 404, 'NOT_FOUND')
    if (equipe.status !== 'ativa') return { ...equipe, alterado: false, membros: await membrosDaEquipe(client, empresaId, equipe.id) }
    const membrosAtivos = await membrosDaEquipe(client, empresaId, equipe.id)
    if (membrosAtivos.length) {
      throw erro('Encerre a equipe só depois da etapa de devolução de leads dos participantes.', 409, 'EQUIPE_COM_MEMBROS')
    }

    await client.query(
      `UPDATE app.equipe_comercial_membros
          SET saiu_em = NOW(), removido_por = $3::uuid, motivo_saida = $4
        WHERE empresa_id = $1 AND equipe_id = $2::uuid AND saiu_em IS NULL`,
      [empresaId, equipeId, autorId || null, v.motivo]
    )
    const { rows } = await client.query(
      `UPDATE app.equipes_comerciais
          SET status = 'encerrada', encerrada_em = NOW(), encerrada_por = $3::uuid
        WHERE empresa_id = $1 AND id = $2::uuid
        RETURNING id, empresa_id, nicho_id, nome, descricao, status, criado_por, criado_em, encerrada_em, encerrada_por`,
      [empresaId, equipeId, autorId || null]
    )
    await auditar(client, {
      empresaId,
      usuarioId: autorId,
      acao: 'equipe_comercial_encerrada',
      entidadeId: equipeId,
      estadoAnterior: 'ativa',
      estadoNovo: 'encerrada',
      contexto: { motivo: v.motivo },
    })
    return { ...rows[0], alterado: true, membros: [] }
  })
}

/**
 * A equipe ATIVA desta pessoa nesta empresa — a fonte do recorte por nicho.
 *
 * ⚠️ Devolve `null` quando a pessoa nao esta em equipe nenhuma, e isso NAO e' erro: e' a
 * decisao D2 (2026-09-18). Quem nao esta em equipe **nao e' recortado** e mantem o
 * comportamento de sempre. Recortar quem nao tem equipe transformaria a ausencia de cadastro
 * num bloqueio — o mesmo lockout que o aceite do termo (084) ja custou caro.
 *
 * Uma linha no maximo, garantido pelo BANCO (`equipe_membros_um_ativo_por_usuario_uk`,
 * migration 088): nao ha desempate a fazer aqui, e nao deve haver. Se um dia esse indice cair,
 * este LIMIT 1 estaria escolhendo equipe por acaso — por isso ele nao tem ORDER BY.
 *
 * O nome do nicho vem junto porque a tela precisa DIZER o recorte ("sua equipe trabalha Energia
 * Solar"). Recortar em silencio faria o vendedor achar que perdeu carteira.
 */
async function equipeAtivaDoUsuario(empresaId, usuarioId) {
  if (!empresaId || !usuarioId) return null
  const { rows } = await pool.query(
    `SELECT e.id            AS equipe_id,
            e.nome          AS equipe_nome,
            e.nicho_id      AS nicho_id,
            n.nome          AS nicho_nome
       FROM app.equipe_comercial_membros m
       JOIN app.equipes_comerciais e
         ON e.id = m.equipe_id AND e.empresa_id = m.empresa_id
       LEFT JOIN app.nichos n
         ON n.id = e.nicho_id AND n.empresa_id = e.empresa_id
      WHERE m.empresa_id = $1::uuid
        AND m.usuario_id = $2::uuid
        AND m.saiu_em IS NULL
        AND e.status = 'ativa'
      LIMIT 1`,
    [empresaId, usuarioId]
  )
  return rows[0] || null
}

/**
 * Quem pode entrar numa equipe, JA' com a equipe atual de cada pessoa.
 *
 * Existe para o seletor poder avisar "esta pessoa ja' esta no Time Solar" ANTES de submeter. O
 * banco recusa o segundo vinculo (`equipe_membros_um_ativo_por_usuario_uk` -> 409), mas descobrir
 * isso no POST obriga o gestor a montar a selecao duas vezes sem saber qual das pessoas causou o
 * conflito — a mensagem de erro fala de "uma das pessoas".
 *
 * Nao inclui quem tem vinculo INATIVO na empresa: quem perdeu acesso nao entra em equipe.
 * `equipe_atual` nulo = livre.
 */
async function membrosElegiveis(empresaId) {
  const { rows } = await pool.query(
    `SELECT u.id            AS usuario_id,
            u.nome          AS nome,
            ue.role         AS papel,
            eq.id           AS equipe_id,
            eq.nome         AS equipe_nome,
            n.nome          AS nicho_nome
       FROM app.usuarios_empresas ue
       JOIN app.usuarios u ON u.id = ue.usuario_id
       LEFT JOIN app.equipe_comercial_membros m
         ON m.empresa_id = ue.empresa_id AND m.usuario_id = ue.usuario_id AND m.saiu_em IS NULL
       LEFT JOIN app.equipes_comerciais eq
         ON eq.id = m.equipe_id AND eq.empresa_id = m.empresa_id AND eq.status = 'ativa'
       LEFT JOIN app.nichos n
         ON n.id = eq.nicho_id AND n.empresa_id = eq.empresa_id
      WHERE ue.empresa_id = $1::uuid
        AND ue.ativo = true
      ORDER BY u.nome ASC`,
    [empresaId]
  )
  return rows.map((r) => ({
    usuario_id: r.usuario_id,
    nome: r.nome,
    papel: r.papel,
    // Um objeto so' quando ha' equipe DE VERDADE: o LEFT JOIN devolve as tres colunas nulas para
    // quem esta livre, e montar `{id: null}` faria a tela precisar conferir campo por campo.
    equipe_atual: r.equipe_id
      ? { id: r.equipe_id, nome: r.equipe_nome, nicho_nome: r.nicho_nome }
      : null,
  }))
}

// ─── A CARTEIRA DA EQUIPE (leitura) ─────────────────────────────────────────────────────

/**
 * A carteira do nicho da equipe, ja' com o nome de cada pessoa.
 *
 * SOMENTE LEITURA: nao move lead, nao grava e nao chama IA. O gestor precisa poder abrir o
 * painel sem que nada mude — distribuir e' sempre um clique explicito.
 *
 * ⚠️ Os numeros aqui sao do NICHO desta equipe, nao da empresa inteira. O painel geral
 * (`GET /equipe`) continua contando a carteira total de cada pessoa, e os dois convivem porque
 * respondem perguntas diferentes. Quem exibe e' obrigado a dizer qual esta mostrando.
 */
async function carteiraDaEquipe(empresaId, equipeId, { prazoParado } = {}) {
  const equipe = await obterEquipe(pool, empresaId, equipeId)
  if (!equipe) return null
  const membros = await membrosDaEquipe(pool, empresaId, equipeId)
  const [carteira, protegidos, disponiveis, atencao, veBaseBruta] = await Promise.all([
    DIST.carteiraDaEquipe(pool, empresaId, equipe.nicho_id, { prazoParado }),
    DIST.resumoProtegidos(pool, empresaId, equipe.nicho_id),
    DIST.livresRedistribuiveis(pool, empresaId, equipe.nicho_id),
    DIST.pontosDeAtencaoDoNicho(pool, empresaId, equipe.nicho_id),
    quemVeBaseBruta(pool, empresaId, membros.map((m) => m.usuario_id)),
  ])
  const porUsuario = new Map(carteira.map((c) => [String(c.responsavel_id), c]))
  const zero = {
    leads: 0, intocados: 0, em_andamento: 0, parados: 0, com_follow_up: 0, com_reuniao: 0,
    legado: 0, com_conversa: 0,
  }

  // Lead DESTE nicho na mao de quem NAO e' da equipe. A tabela so' lista membros e a fila, entao
  // sem este numero a soma das linhas nao fecharia com a carteira do nicho — e esses leads
  // ficariam invisiveis justamente para quem veio redistribuir.
  const idsMembros = new Set(membros.map((m) => String(m.usuario_id)))
  const deFora = carteira.filter((c) => c.responsavel_id != null && !idsMembros.has(String(c.responsavel_id)))
  const foraDaEquipe = {
    leads: deFora.reduce((t, c) => t + (Number(c.leads) || 0), 0),
    pessoas: deFora.length,
  }

  return {
    equipe: {
      id: equipe.id, nome: equipe.nome, status: equipe.status,
      nicho_id: equipe.nicho_id, nicho_nome: equipe.nicho_nome,
    },
    membros: membros.map((m) => ({
      usuario_id: m.usuario_id,
      nome: m.nome,
      papel: m.role,
      // Membro sem linha na carteira NAO e' ausencia de dado: e' carteira vazia neste nicho, que
      // e' exatamente quem o rebalanceamento existe para atender.
      ...zero,
      ...(porUsuario.get(String(m.usuario_id)) || {}),
      // Decidido AQUI, pela regra de capacidade, e nunca na tela: comparar papel com literal no
      // front faria a matriz divergir em silencio. So' o booleano sai — as concessoes da pessoa
      // (`permissoes`) nao vao para a resposta.
      ve_base_bruta: veBaseBruta.get(String(m.usuario_id)) === true,
    })),
    livres: { ...zero, ...(porUsuario.get('null') || {}) },
    disponiveis_para_puxar: disponiveis,
    protegidos,
    // Pontos de atencao que a tabela por pessoa nao mostra. Todos sao CONTAGENS; a tela so'
    // traduz (`frontend/lib/equipe-carteira.js` -> `pontosDeAtencao`).
    aguardando_triagem: atencao.aguardando_triagem,
    sem_nicho: atencao.sem_nicho,
    fora_da_equipe: foraDaEquipe,
  }
}

/**
 * Quem, entre estes usuarios, enxerga lead `legado` no Banco de Leads (`LEAD_VER_BRUTOS`).
 *
 * ⚠️ Consulta PROPRIA, e nao mais colunas em `membrosDaEquipe`: aquela funcao alimenta respostas
 * de API (`equipeComMembros`, `criarEquipe`) e acrescentar `permissoes` ali vazaria as concessoes
 * de cada pessoa. Daqui so' sai um Map usuario -> booleano.
 */
async function quemVeBaseBruta(exec, empresaId, usuarioIds) {
  const ids = [...new Set((usuarioIds || []).map(String).filter(Boolean))]
  const saida = new Map()
  if (!ids.length) return saida
  const { rows } = await exec.query(
    `SELECT ue.usuario_id, ue.role, ue.permissoes, u.role AS papel_plataforma
       FROM app.usuarios_empresas ue
       JOIN app.usuarios u ON u.id = ue.usuario_id
      WHERE ue.empresa_id = $1 AND ue.usuario_id = ANY($2::uuid[]) AND ue.ativo = true`,
    [empresaId, ids]
  )
  for (const r of rows) {
    saida.set(String(r.usuario_id), podeCapacidade(
      { papel: r.role, permissoes: r.permissoes, papelPlataforma: r.papel_plataforma },
      CAP.LEAD_VER_BRUTOS
    ))
  }
  return saida
}

/**
 * PUXAR MAIS LEADS para a equipe. Transacao propria, equipe conferida antes.
 *
 * `usuario_ids` so' e' aceito com `entre = 'selecionados'`, e cada um precisa ser membro ATIVO
 * DESTA equipe: aceitar um id de fora transformaria a acao numa porta lateral para dar carteira
 * a quem o recorte por nicho nem alcanca.
 */
async function puxarLeadsParaEquipe(empresaId, equipeId, dados = {}, autorId = null) {
  return withTx(async (client) => {
    const equipe = await obterEquipe(client, empresaId, equipeId, { forUpdate: true })
    if (!equipe) throw erro('Equipe não encontrada nesta empresa.', 404, 'NOT_FOUND')
    if (equipe.status !== 'ativa') throw erro('Equipe encerrada não recebe leads.', 409, 'EQUIPE_ENCERRADA')

    const membros = await membrosDaEquipe(client, empresaId, equipeId)
    if (!membros.length) throw erro('Esta equipe ainda não tem participantes.', 409, 'EQUIPE_SEM_MEMBROS')

    const entre = D.entreValido(dados.entre)
    const todos = membros.map((m) => String(m.usuario_id))
    let destinos = todos
    if (entre === D.DISTRIBUIR_ENTRE.SELECIONADOS) {
      const pedidos = E.normalizarUsuarioIds(dados.usuario_ids)
      if (!pedidos.length) throw erro('Selecione as pessoas que vão receber os leads.', 400, 'SEM_DESTINO')
      const fora = pedidos.filter((id) => !todos.includes(String(id)))
      if (fora.length) {
        throw erro('Só é possível distribuir entre participantes desta equipe.', 400, 'DESTINO_FORA_DA_EQUIPE')
      }
      destinos = pedidos
    }

    const resultado = await DIST.puxarLeads(client, {
      empresaId,
      equipeId,
      nichoId: equipe.nicho_id,
      usuarioIds: destinos,
      quantidade: dados.quantidade,
      criterio: dados.criterio,
      entre,
      autorId,
    })
    return { ...resultado, equipe: { id: equipe.id, nome: equipe.nome, nicho_nome: equipe.nicho_nome } }
  })
}

/**
 * TRANSFERIR leads entre duas pessoas DA MESMA EQUIPE. Transacao propria, equipe conferida antes.
 *
 * ⚠️ Origem E destino precisam ser membros ATIVOS desta equipe, pelo mesmo motivo de
 * `puxarLeadsParaEquipe`: aceitar um id de fora faria da acao uma porta lateral para dar carteira
 * a quem o recorte por nicho nem alcanca — ou tirar de quem a equipe nao gerencia.
 *
 * A validacao do pedido vive na regra pura (`D.validarTransferencia`); aqui so' se confere o que
 * depende do banco. So' o booleano `true` inclui os leads em andamento.
 */
async function transferirLeadsNaEquipe(empresaId, equipeId, dados = {}, autorId = null) {
  const v = D.validarTransferencia({
    origemId: dados.origem_id,
    destinoId: dados.destino_id,
    quantidade: dados.quantidade,
    incluirProtegidos: dados.incluir_protegidos,
  })
  if (!v.ok) throw erro(v.motivo, 400, v.code)

  return withTx(async (client) => {
    const equipe = await obterEquipe(client, empresaId, equipeId, { forUpdate: true })
    if (!equipe) throw erro('Equipe não encontrada nesta empresa.', 404, 'NOT_FOUND')
    if (equipe.status !== 'ativa') throw erro('Equipe encerrada não movimenta leads.', 409, 'EQUIPE_ENCERRADA')

    const membros = await membrosDaEquipe(client, empresaId, equipeId)
    const ids = new Set(membros.map((m) => String(m.usuario_id)))
    if (!ids.has(v.origemId) || !ids.has(v.destinoId)) {
      throw erro('Só é possível mover leads entre participantes desta equipe.', 400, 'FORA_DA_EQUIPE')
    }

    return DIST.transferirLeads(client, {
      empresaId,
      equipeId,
      nichoId: equipe.nicho_id,
      origemId: v.origemId,
      destinoId: v.destinoId,
      quantidade: v.quantidade,
      incluirProtegidos: v.incluirProtegidos,
      autorId,
    })
  })
}

module.exports = {
  carteiraDaEquipe,
  puxarLeadsParaEquipe,
  transferirLeadsNaEquipe,
  equipeAtivaDoUsuario,
  membrosElegiveis,
  listarEquipes,
  equipeComMembros,
  criarEquipe,
  atualizarEquipe,
  definirParticipantes,
  adicionarParticipanteEmTx,
  encerrarEquipe,
}
