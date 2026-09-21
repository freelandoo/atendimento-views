'use strict'
// Distribuicao de leads por EQUIPE — acesso a dados.
// Regras PURAS em src/services/lead-distribuicao.js; aqui so' SQL, transacao e isolamento.
//
// ─── AS TRES GARANTIAS DESTE ARQUIVO ────────────────────────────────────────────────────
//  1. **A CORRIDA E' RESOLVIDA PELO BANCO.** Todo UPDATE e' condicionado ao dono ESPERADO
//     (`responsavel_id IS NULL` para o livre, `= <cedente>` para a transferencia) e devolve as
//     linhas que realmente mudaram. Se um vendedor assumir o lead no mesmo segundo, ele nao e'
//     sobrescrito: a linha nao casa e o relatorio devolve menos que o plano previa. E' o MESMO
//     padrao do claim de `db/lead-responsavel.js` (migration 072) e da curadoria (055).
//  2. **`pg_advisory_xact_lock` por (empresa, equipe)** serializa dois gestores clicando juntos.
//     Sem ele, os dois leriam o mesmo "antes", calculariam a mesma meta e cada um moveria o lote
//     inteiro — a carteira acabaria com o dobro do previsto na mao de quem estava vazio.
//  3. **Historico por LEAD, sempre**, por `registrarMudancasEmLote` — que vive em
//     `db/lead-responsavel.js`, o dono unico de `app.lead_responsavel_historico`. Uma segunda
//     gravacao daquela tabela aqui divergiria no primeiro ajuste.
//
// ⚠️ NAO EXISTE DEVOLUCAO PARA A FILA neste arquivo, e nao deve passar a existir: distribuir e'
// dar dono, nunca tirar. Devolver e' o botao que ja' existe (`definirResponsavel` com destino
// nulo), acionado por uma pessoa. Ha guarda de regressao.

const D = require('../services/lead-distribuicao')
const LP = require('../services/lead-parado')
const { registrarMudancasEmLote, assertResponsavelDaEmpresa } = require('./lead-responsavel')
const { ACOES } = require('../services/lead-responsavel')
const { logger } = require('../logger')

function erro(mensagem, statusCode = 400, code = 'BAD_REQUEST') {
  const e = new Error(mensagem)
  e.statusCode = statusCode
  e.code = code
  return e
}

/**
 * Serializa a distribuicao DESTA equipe. Ate' o fim da transacao.
 *
 * Por equipe e nao por empresa: equipes trabalham nichos diferentes e nunca disputam o mesmo
 * lead, entao travar a empresa inteira faria uma esperar a outra sem necessidade.
 */
async function travarEquipe(client, empresaId, equipeId) {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))`,
    [String(empresaId), String(equipeId)]
  )
}

// ─── LEITURA: a carteira da equipe, por pessoa ──────────────────────────────────────────

/**
 * A carteira do NICHO da equipe, uma linha por responsavel (+ a linha dos LIVRES).
 *
 * ⚠️ Recortada pelo nicho, e isso e' o ponto: `contagemPorResponsavel` (db/lead-responsavel.js)
 * conta a carteira da pessoa na EMPRESA INTEIRA e alimenta o painel geral. Os dois numeros
 * convivem porque respondem perguntas diferentes — e a tela e' obrigada a dizer qual esta
 * mostrando, senao a mesma linha exibiria dois valores chamados "Leads".
 *
 * Todas as colunas contam LEADS (a mesma unidade), e elas NAO se somam: `intocados` e
 * `em_andamento` particionam `leads`, mas `parados`, `com_follow_up` e `com_reuniao` sao
 * recortes que se cruzam com os dois. Cada uma declara o que mede na tela.
 */
async function carteiraDaEquipe(exec, empresaId, nichoId, { prazoParado } = {}) {
  const prazo = LP.normalizarPrazo(prazoParado)
  const { rows } = await exec.query(
    `SELECT p.responsavel_id,
            COUNT(*)::int AS leads,
            COUNT(*) FILTER (WHERE ${D.sqlRedistribuivel('p', '$2')})::int AS intocados,
            COUNT(*) FILTER (WHERE p.responsavel_id IS NOT NULL AND ${LP.sqlEstaParado('p', '$3')})::int AS parados,
            COUNT(*) FILTER (WHERE ${D.sqlFollowUpPorTelefone('p')})::int AS com_follow_up,
            COUNT(*) FILTER (WHERE ${D.sqlReuniaoFutura('p')})::int AS com_reuniao
       FROM prospectador.prospects p
      WHERE p.empresa_id = $1
        AND p.nicho_id = $2::uuid
        AND p.qualificacao IN ('aprovado', 'legado')
      GROUP BY p.responsavel_id`,
    [empresaId, nichoId, prazo]
  )
  return rows.map((r) => ({
    responsavel_id: r.responsavel_id,
    leads: r.leads,
    intocados: r.intocados,
    // Derivado aqui, e nao no SQL, porque e' subtracao de dois numeros que a mesma linha ja tem —
    // um terceiro FILTER so' daria ao banco a chance de discordar de si mesmo.
    em_andamento: Math.max(0, r.leads - r.intocados),
    parados: r.parados,
    com_follow_up: r.com_follow_up,
    com_reuniao: r.com_reuniao,
  }))
}

/**
 * Por que os leads do nicho que NAO podem ser movidos estao protegidos.
 *
 * Alimenta o resumo do modal ("12 protegidos: 8 com conversa aberta..."). Sem ele, o gestor ve
 * "movi 3 de 15" e nao tem como saber se o sistema falhou ou se os outros 12 estao em negociacao.
 */
async function resumoProtegidos(exec, empresaId, nichoId) {
  const { rows } = await exec.query(
    `SELECT motivo, COUNT(*)::int AS total FROM (
       SELECT ${D.sqlMotivoProtegido('p', '$2')} AS motivo
         FROM prospectador.prospects p
        WHERE p.empresa_id = $1 AND p.nicho_id = $2::uuid
     ) x
      WHERE x.motivo IS NOT NULL
      GROUP BY motivo
      ORDER BY total DESC`,
    [empresaId, nichoId]
  )
  return rows
}

/** Quantos leads redistribuiveis estao SEM dono no nicho — o que a puxada manual pode consumir. */
async function livresRedistribuiveis(exec, empresaId, nichoId) {
  const { rows } = await exec.query(
    `SELECT COUNT(*)::int AS total
       FROM prospectador.prospects p
      WHERE p.empresa_id = $1
        AND p.responsavel_id IS NULL
        AND ${D.sqlRedistribuivel('p', '$2')}`,
    [empresaId, nichoId]
  )
  return rows[0]?.total || 0
}

/** As contagens que o PLANO precisa: intocados por membro (zero para quem nao tem linha) + livres. */
async function contagensParaPlano(client, empresaId, nichoId, usuarioIds) {
  const carteira = await carteiraDaEquipe(client, empresaId, nichoId)
  const porUsuario = new Map(carteira.map((c) => [String(c.responsavel_id), c]))
  const membros = (usuarioIds || []).map((id) => ({
    usuario_id: id,
    atual: porUsuario.get(String(id))?.intocados || 0,
  }))
  return { membros, livres: porUsuario.get('null')?.intocados || 0 }
}

// ─── ESCRITA: os dois movimentos possiveis ──────────────────────────────────────────────

/**
 * Da' ate' `limite` leads LIVRES do nicho para `destinoId`.
 *
 * O `AND t.responsavel_id IS NULL` do UPDATE e' a garantia, nao o `WHERE` do SELECT: entre ler e
 * escrever, um vendedor pode ter assumido o lead pelo botao de sempre. A linha simplesmente nao
 * casa, e o relatorio devolve o numero REAL — nunca o planejado.
 */
async function atribuirLivres(client, { empresaId, nichoId, destinoId, limite, criterio }) {
  if (!(limite > 0)) return []
  const { rows } = await client.query(
    `WITH alvo AS (
       SELECT p.id
         FROM prospectador.prospects p
        WHERE p.empresa_id = $1
          AND p.responsavel_id IS NULL
          AND ${D.sqlRedistribuivel('p', '$2')}
        ORDER BY ${D.ordemDoCriterio(criterio)}
        LIMIT $4
     )
     UPDATE prospectador.prospects t
        SET responsavel_id = $3::uuid, responsavel_desde = NOW()
       FROM alvo
      WHERE t.id = alvo.id AND t.responsavel_id IS NULL
      RETURNING t.id`,
    [empresaId, nichoId, destinoId, limite]
  )
  return rows.map((r) => r.id)
}

/**
 * Move ate' `limite` leads INTOCADOS de `origemId` para `destinoId`.
 *
 * ⚠️ E' a unica escrita do sistema que tira um lead da mao de alguem sem essa pessoa pedir, e ela
 * so' existe porque o operador a autorizou explicitamente (2026-09-21) para leads que ninguem
 * tocou. O predicado de `sqlRedistribuivel` e' o que a torna aceitavel: reuniao marcada, conversa
 * aberta, follow-up, ligacao ou disparo tiram o lead daqui.
 *
 * Cede primeiro o que a pessoa recebeu MAIS RECENTEMENTE: e' o lead com menos chance de ja' estar
 * no plano de trabalho dela. `responsavel_desde` e' NOT NULL sempre que ha responsavel (CHECK da
 * migration 072), entao o `NULLS LAST` cobre so' dado fora do contrato.
 */
async function moverEntreMembros(client, { empresaId, nichoId, origemId, destinoId, limite }) {
  if (!(limite > 0) || String(origemId) === String(destinoId)) return []
  const { rows } = await client.query(
    `WITH alvo AS (
       SELECT p.id
         FROM prospectador.prospects p
        WHERE p.empresa_id = $1
          AND p.responsavel_id = $3::uuid
          AND ${D.sqlRedistribuivel('p', '$2')}
        ORDER BY p.responsavel_desde DESC NULLS LAST, p.created_at DESC
        LIMIT $5
     )
     UPDATE prospectador.prospects t
        SET responsavel_id = $4::uuid, responsavel_desde = NOW()
       FROM alvo
      WHERE t.id = alvo.id AND t.responsavel_id = $3::uuid
      RETURNING t.id`,
    [empresaId, nichoId, origemId, destinoId, limite]
  )
  return rows.map((r) => r.id)
}

/** A linha AGREGADA da operacao, ao lado das linhas por lead. Sem PII: so' ids e contagens. */
async function auditarOperacao(client, { empresaId, usuarioId, equipeId, acao, contexto }) {
  await client.query(
    `INSERT INTO app.auditoria_eventos
       (empresa_id, usuario_id, entidade_tipo, entidade_id, acao, contexto)
     VALUES ($1, $2::uuid, 'equipe_comercial', $3::uuid, $4, $5::jsonb)`,
    [empresaId, usuarioId || null, equipeId || null, acao, JSON.stringify(contexto || {})]
  )
}

// ─── OS DOIS GATILHOS ───────────────────────────────────────────────────────────────────

/**
 * REBALANCEAR: iguala a carteira INTOCADA entre os membros da equipe.
 *
 * Roda DENTRO da transacao de quem chama (a mesma que adiciona o participante), de proposito:
 * "entrou na equipe e recebeu carteira" e' um fato so'. Se a distribuicao falhar, a entrada volta
 * atras — prometer as duas coisas e entregar uma seria pior que falhar inteiro.
 */
async function rebalancearEquipe(client, { empresaId, equipeId, nichoId, usuarioIds, autorId, origem } = {}) {
  const ids = [...new Set((usuarioIds || []).map(String).filter(Boolean))]
  const vazio = { movidos: 0, de_livres: 0, entre_membros: 0, por_pessoa: [], truncado: false }
  if (!nichoId || ids.length < 1) return vazio

  await travarEquipe(client, empresaId, equipeId)
  const { membros, livres } = await contagensParaPlano(client, empresaId, nichoId, ids)
  const plano = D.planoRebalanceamento({ membros, livres })
  if (!plano.total_movimentos) return { ...vazio, truncado: plano.truncado }

  const motivo = origem || D.ORIGEM.ENTRADA_NA_EQUIPE
  // Quem cede, com o saldo ainda a ceder. Consumido na ordem: o maior excedente primeiro, para
  // um unico cedente nao ser esvaziado enquanto outro acima da meta nao contribui com nada.
  const cedentes = plano.membros
    .filter((m) => m.ceder > 0)
    .map((m) => ({ usuario_id: m.usuario_id, restante: m.ceder }))
    .sort((a, b) => b.restante - a.restante)

  let restanteGlobal = plano.total_movimentos
  const porPessoa = []
  let deLivres = 0
  let entreMembros = 0

  for (const alvo of plano.membros) {
    if (restanteGlobal <= 0) break
    let falta = Math.min(alvo.receber, restanteGlobal)
    if (falta <= 0) continue
    let recebidosLivres = 0
    let recebidosMembros = 0

    const dosLivres = await atribuirLivres(client, {
      empresaId, nichoId, destinoId: alvo.usuario_id, limite: falta, criterio: D.CRITERIO.MAIS_ANTIGOS,
    })
    if (dosLivres.length) {
      await registrarMudancasEmLote(client, {
        empresaId, prospectIds: dosLivres, anterior: null, novo: alvo.usuario_id,
        usuarioId: autorId, acao: ACOES.ATRIBUIU, motivo,
      })
      recebidosLivres = dosLivres.length
      falta -= dosLivres.length
      deLivres += dosLivres.length
      restanteGlobal -= dosLivres.length
    }

    for (const cedente of cedentes) {
      if (falta <= 0 || restanteGlobal <= 0) break
      if (cedente.restante <= 0 || String(cedente.usuario_id) === String(alvo.usuario_id)) continue
      const movidos = await moverEntreMembros(client, {
        empresaId, nichoId, origemId: cedente.usuario_id, destinoId: alvo.usuario_id,
        limite: Math.min(falta, cedente.restante, restanteGlobal),
      })
      if (!movidos.length) { cedente.restante = 0; continue }
      await registrarMudancasEmLote(client, {
        empresaId, prospectIds: movidos, anterior: cedente.usuario_id, novo: alvo.usuario_id,
        usuarioId: autorId, acao: ACOES.TRANSFERIU, motivo,
      })
      cedente.restante -= movidos.length
      recebidosMembros += movidos.length
      falta -= movidos.length
      entreMembros += movidos.length
      restanteGlobal -= movidos.length
    }

    if (recebidosLivres || recebidosMembros) {
      porPessoa.push({
        usuario_id: alvo.usuario_id,
        recebidos: recebidosLivres + recebidosMembros,
        de_livres: recebidosLivres,
        de_membros: recebidosMembros,
      })
    }
  }

  const total = deLivres + entreMembros
  if (total) {
    await auditarOperacao(client, {
      empresaId, usuarioId: autorId, equipeId, acao: 'equipe_comercial_leads_rebalanceados',
      contexto: {
        nicho_id: nichoId, origem: motivo, total_movidos: total,
        de_livres: deLivres, entre_membros: entreMembros,
        participantes: porPessoa.map((p) => p.usuario_id),
      },
    })
    logger.info(
      { empresa_id: empresaId, equipe_id: equipeId, total_movidos: total },
      '[lead-distribuicao] carteira rebalanceada'
    )
  }
  return {
    movidos: total, de_livres: deLivres, entre_membros: entreMembros,
    por_pessoa: porPessoa, truncado: plano.truncado, meta_base: plano.meta_base,
  }
}

/**
 * PUXAR MAIS LEADS: entrega N leads LIVRES do nicho aos membros escolhidos.
 *
 * ⚠️ NAO move lead que ja tem dono, nem quando a distribuicao fica desigual. Puxar e' aumentar o
 * volume da equipe; remexer o que ja' foi distribuido e' o rebalanceamento, que tem outro gatilho
 * e outra explicacao na tela.
 */
async function puxarLeads(client, { empresaId, equipeId, nichoId, usuarioIds, quantidade, criterio, entre, autorId } = {}) {
  const ids = [...new Set((usuarioIds || []).map(String).filter(Boolean))]
  if (!ids.length) throw erro('Selecione ao menos uma pessoa para receber os leads.', 400, 'SEM_DESTINO')
  if (!nichoId) throw erro('Equipe sem nicho definido.', 400, 'EQUIPE_SEM_NICHO')

  await travarEquipe(client, empresaId, equipeId)
  const { membros } = await contagensParaPlano(client, empresaId, nichoId, ids)
  const disponiveis = await livresRedistribuiveis(client, empresaId, nichoId)
  const plano = D.planoPuxada({
    membros,
    disponiveis,
    quantidade: D.normalizarQuantidade(quantidade),
    entre,
  })

  const escolhido = D.criterioValido(criterio)
  const porPessoa = []
  let total = 0
  for (const alvo of plano.membros) {
    if (alvo.receber <= 0) continue
    const recebidos = await atribuirLivres(client, {
      empresaId, nichoId, destinoId: alvo.usuario_id, limite: alvo.receber, criterio: escolhido,
    })
    if (!recebidos.length) continue
    await registrarMudancasEmLote(client, {
      empresaId, prospectIds: recebidos, anterior: null, novo: alvo.usuario_id,
      usuarioId: autorId, acao: ACOES.ATRIBUIU, motivo: D.ORIGEM.PUXADA_MANUAL,
    })
    porPessoa.push({ usuario_id: alvo.usuario_id, recebidos: recebidos.length })
    total += recebidos.length
  }

  if (total) {
    await auditarOperacao(client, {
      empresaId, usuarioId: autorId, equipeId, acao: 'equipe_comercial_leads_puxados',
      contexto: {
        nicho_id: nichoId, criterio: escolhido, entre: plano.modo, total_movidos: total,
        participantes: porPessoa.map((p) => p.usuario_id),
      },
    })
    logger.info(
      { empresa_id: empresaId, equipe_id: equipeId, total_movidos: total },
      '[lead-distribuicao] leads puxados para a equipe'
    )
  }
  return {
    movidos: total,
    // A diferenca e' informacao, nao erro: cobre "acabaram os livres" e "alguem assumiu no meio".
    solicitados: D.normalizarQuantidade(quantidade),
    disponiveis,
    por_pessoa: porPessoa,
    criterio: escolhido,
    entre: plano.modo,
  }
}

module.exports = {
  carteiraDaEquipe,
  resumoProtegidos,
  livresRedistribuiveis,
  contagensParaPlano,
  rebalancearEquipe,
  puxarLeads,
  assertResponsavelDaEmpresa,
}
