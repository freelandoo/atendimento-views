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
const Q = require('../services/lead-qualificacao')
const { registrarMudancasEmLote, assertResponsavelDaEmpresa } = require('./lead-responsavel')
const { ACOES } = require('../services/lead-responsavel')
// So' para o PESO de desempenho do rebalanceamento automatico (D.pesoDesempenho) — nunca para
// escrever nada de comissao. Ver o cabecalho de `pesoDesempenho` em services/lead-distribuicao.js.
const { rankingDoMes } = require('./comissao')
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
            COUNT(*) FILTER (WHERE ${D.sqlReuniaoFutura('p')})::int AS com_reuniao,
            -- As duas abaixo alimentam os PONTOS DE ATENCAO e a previa da transferencia. legado
            -- e' o lead que so quem ve a base bruta enxerga (a armadilha da Pousada, 2026-09-22);
            -- com_conversa e' o que a transferencia incluindo em andamento leva junto.
            COUNT(*) FILTER (WHERE p.qualificacao = $4)::int AS legado,
            COUNT(*) FILTER (WHERE ${D.sqlConversaAberta('p')})::int AS com_conversa
       FROM prospectador.prospects p
      WHERE p.empresa_id = $1
        AND p.nicho_id = $2::uuid
        AND p.qualificacao IN ('aprovado', 'legado')
      GROUP BY p.responsavel_id`,
    [empresaId, nichoId, prazo, Q.QUALIFICACAO.LEGADO]
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
    legado: r.legado,
    com_conversa: r.com_conversa,
  }))
}

/**
 * Os PONTOS DE ATENCAO da carteira que a tabela por pessoa nao mostra — e que ja' custaram caro.
 *
 * `aguardando_triagem`: leads DESTE nicho em `pendente`. Nao podem ser distribuidos nem abordados
 * ate alguem aprovar (a porta da migration 071); contados antes sob o rotulo generico
 * "nao abordavel", que nao dizia ao gestor o que fazer.
 *
 * `sem_nicho`: leads ABORDAVEIS da empresa com `nicho_id` NULO. Nao pertencem a equipe nenhuma e
 * por isso nao aparecem em lugar nenhum desta tela — foi a causa-raiz de "leads aprovados nao
 * distribuem" (2026-09-21). E' um numero da EMPRESA, e a tela diz isso.
 *
 * Somente leitura. Os valores de qualificacao vao como PARAMETRO: comparar com literal fora de
 * `services/lead-qualificacao.js` e' proibido (guarda em test/lead-qualificacao.test.js).
 */
async function pontosDeAtencaoDoNicho(exec, empresaId, nichoId) {
  const { rows } = await exec.query(
    `SELECT
       COUNT(*) FILTER (WHERE p.nicho_id = $2::uuid AND p.qualificacao = $3)::int AS aguardando_triagem,
       COUNT(*) FILTER (WHERE p.nicho_id IS NULL AND ${Q.sqlAbordavel('p')})::int AS sem_nicho
       FROM prospectador.prospects p
      WHERE p.empresa_id = $1`,
    [empresaId, nichoId, Q.QUALIFICACAO.PENDENTE]
  )
  return {
    aguardando_triagem: rows[0]?.aguardando_triagem || 0,
    sem_nicho: rows[0]?.sem_nicho || 0,
  }
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

/**
 * As contagens que o PLANO precisa: intocados por membro (zero para quem nao tem linha) + livres.
 *
 * `leads`/`parados` viajam junto (nao so' `atual`) porque `rebalancearEquipe` usa os dois para
 * calcular o PESO de desempenho (proporcao de leads parados na carteira). `puxarLeads` tambem
 * chama esta funcao e simplesmente ignora os dois campos extras — `planoPuxada` reconstroi os
 * objetos que le, entao um campo a mais aqui nao vaza pra ele.
 */
async function contagensParaPlano(client, empresaId, nichoId, usuarioIds) {
  const carteira = await carteiraDaEquipe(client, empresaId, nichoId)
  const porUsuario = new Map(carteira.map((c) => [String(c.responsavel_id), c]))
  const membros = (usuarioIds || []).map((id) => {
    const c = porUsuario.get(String(id))
    return {
      usuario_id: id,
      atual: c?.intocados || 0,
      leads: c?.leads || 0,
      parados: c?.parados || 0,
    }
  })
  return { membros, livres: porUsuario.get('null')?.intocados || 0 }
}

/**
 * O peso de desempenho de cada membro, pronto para `D.planoRebalanceamento`.
 *
 * Falha ao ler o ranking do mes (ex.: sem plano de comissao configurado para a empresa) NAO pode
 * impedir a entrada na equipe — a pessoa cai para peso NEUTRO (1) em todo mundo, que e' o
 * comportamento de ANTES desta mudanca. `rankingDoMes` so' lista quem TEM faturamento
 * (`services/comissao.js`, `montarRanking`), entao quem nao vendeu simplesmente nao aparece — e
 * e' assim que `pesoDesempenho` reconhece "sem faturamento ainda" e mantem o peso neutro.
 */
async function pesosDeDesempenho(empresaId, membros) {
  let ranking = []
  try {
    const hoje = new Date()
    const competencia = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`
    ranking = await rankingDoMes(empresaId, competencia)
  } catch (e) {
    logger.warn(
      { empresa_id: empresaId, err: e?.message },
      '[lead-distribuicao] nao foi possivel ler o ranking do mes; peso neutro para todos'
    )
  }
  const originadoPorId = new Map((ranking || []).map((r) => [String(r.usuario_id), r.originado]))
  const mediana = D.medianaOriginado((ranking || []).map((r) => r.originado))
  return membros.map((m) => D.pesoDesempenho({
    originado: originadoPorId.get(String(m.usuario_id)),
    medianaOriginado: mediana,
    parados: m.parados,
    leads: m.leads,
  }))
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
async function moverEntreMembros(client, { empresaId, nichoId, origemId, destinoId, limite, incluirProtegidos = false }) {
  if (!(limite > 0) || String(origemId) === String(destinoId)) return []
  // Sem `incluirProtegidos` (o rebalanceamento automatico), predicado e ordem sao os de sempre —
  // ha' teste cobrando que o predicado continua IDENTICO a `sqlRedistribuivel`. Com ele (so' a
  // transferencia manual), o conjunto AMPLIA e os intocados continuam saindo primeiro.
  const universo = D.sqlTransferivel('p', '$2', { incluirProtegidos })
  const ordem = incluirProtegidos
    ? D.sqlOrdemTransferencia('p', '$2')
    : 'p.responsavel_desde DESC NULLS LAST, p.created_at DESC'
  const { rows } = await client.query(
    `WITH alvo AS (
       SELECT p.id
         FROM prospectador.prospects p
        WHERE p.empresa_id = $1
          AND p.responsavel_id = $3::uuid
          AND ${universo}
        ORDER BY ${ordem}
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
  // Ajuste MODESTO por desempenho (2026-09-21): quem fatura acima da mediana da equipe recebe um
  // pouco mais da sobra; quem tem muito lead parado recebe um pouco menos. Ver o cabecalho de
  // `pesoDesempenho` em services/lead-distribuicao.js — a base continua sendo a divisao
  // igualitaria de sempre.
  const pesos = await pesosDeDesempenho(empresaId, membros)
  const membrosComPeso = membros.map((m, i) => ({ ...m, peso: pesos[i] }))
  const plano = D.planoRebalanceamento({ membros: membrosComPeso, livres })
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

/**
 * Quantos dos leads MOVIDOS carregavam trabalho junto. Somente leitura, sobre ate' 500 ids.
 *
 * Existe porque a previa so' sabe quantos a pessoa TEM com reuniao/conversa; quais deles saem
 * depende da ordem. O resultado precisa dizer o numero REAL que mudou de mao.
 */
async function sinaisDosMovidos(client, empresaId, ids) {
  if (!ids.length) return { com_reuniao: 0, com_conversa: 0, com_follow_up: 0 }
  const { rows } = await client.query(
    `SELECT COUNT(*) FILTER (WHERE ${D.sqlReuniaoFutura('p')})::int AS com_reuniao,
            COUNT(*) FILTER (WHERE ${D.sqlConversaAberta('p')})::int AS com_conversa,
            COUNT(*) FILTER (WHERE ${D.sqlFollowUpPorTelefone('p')})::int AS com_follow_up
       FROM prospectador.prospects p
      WHERE p.empresa_id = $1 AND p.id = ANY($2::uuid[])`,
    [empresaId, ids]
  )
  return {
    com_reuniao: rows[0]?.com_reuniao || 0,
    com_conversa: rows[0]?.com_conversa || 0,
    com_follow_up: rows[0]?.com_follow_up || 0,
  }
}

/**
 * TRANSFERIR leads de UMA pessoa para OUTRA, dentro da mesma equipe (2026-09-23).
 *
 * Roda DENTRO da transacao aberta por `db/equipes-comerciais.js`, que ja' conferiu equipe ativa e
 * que origem e destino sao membros dela. Aqui ficam as tres garantias que valem para toda escrita
 * de dono deste modulo:
 *   (a) lock da equipe — dois gestores transferindo juntos leriam o mesmo "antes";
 *   (b) UPDATE CONDICIONADO ao cedente (`moverEntreMembros`) — o lead que alguem assumiu,
 *       devolveu ou recebeu entre a tela e o clique simplesmente nao entra;
 *   (c) historico por lead pelo DONO da tabela, com motivo de vocabulario FECHADO.
 *
 * `movidos < solicitados` nao e' erro: cobre "a pessoa tinha menos do que se pediu" e "alguem
 * mexeu no meio". A tela usa o numero REAL.
 */
async function transferirLeads(client, {
  empresaId, equipeId, nichoId, origemId, destinoId, quantidade, incluirProtegidos = false, autorId,
} = {}) {
  await travarEquipe(client, empresaId, equipeId)

  const ids = await moverEntreMembros(client, {
    empresaId, nichoId, origemId, destinoId, limite: quantidade, incluirProtegidos,
  })

  // So' vale a consulta de sinais quando podia haver protegido no lote: sem a caixa marcada, o
  // predicado ja' garante que nenhum dos movidos tinha reuniao, conversa ou follow-up.
  const sinais = incluirProtegidos
    ? await sinaisDosMovidos(client, empresaId, ids)
    : { com_reuniao: 0, com_conversa: 0, com_follow_up: 0 }

  if (ids.length) {
    await registrarMudancasEmLote(client, {
      empresaId, prospectIds: ids, anterior: origemId, novo: destinoId,
      usuarioId: autorId, acao: ACOES.TRANSFERIU, motivo: D.ORIGEM.TRANSFERENCIA_ENTRE_MEMBROS,
    })
    await auditarOperacao(client, {
      empresaId, usuarioId: autorId, equipeId, acao: 'equipe_comercial_leads_transferidos',
      // Sem PII: ids de pessoa sao chave, nao dado pessoal; nenhum nome, telefone ou lead.
      contexto: {
        nicho_id: nichoId,
        origem_id: String(origemId),
        destino_id: String(destinoId),
        solicitados: quantidade,
        total_movidos: ids.length,
        incluir_protegidos: incluirProtegidos === true,
        ...sinais,
      },
    })
    logger.info(
      { empresa_id: empresaId, equipe_id: equipeId, total_movidos: ids.length, incluir_protegidos: incluirProtegidos === true },
      '[lead-distribuicao] leads transferidos entre membros'
    )
  }

  return {
    movidos: ids.length,
    solicitados: quantidade,
    incluir_protegidos: incluirProtegidos === true,
    origem_id: String(origemId),
    destino_id: String(destinoId),
    ...sinais,
  }
}

module.exports = {
  carteiraDaEquipe,
  pontosDeAtencaoDoNicho,
  resumoProtegidos,
  livresRedistribuiveis,
  contagensParaPlano,
  pesosDeDesempenho,
  rebalancearEquipe,
  puxarLeads,
  transferirLeads,
  assertResponsavelDaEmpresa,
}
