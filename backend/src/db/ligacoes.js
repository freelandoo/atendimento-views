'use strict'
// Registro RICO de ligacoes (modulo Prospeccao & Inteligencia Comercial — Fase 3).
// Isolado por empresa. Gerencia o ciclo de vida da SESSAO de ligacao e, ao encerrar,
// atualiza o status da oportunidade (campanha_leads) — tudo atomico. Valida FKs same-tenant.
//
// Validacao Operacional: interesse/resistencia tem UMA fonte unica — app.ligacao_sinais
// (Fatia D). A tabela app.ligacao_etapa_eventos e as "marcas" 🟢/🔴 do cockpit foram
// descontinuadas: viviam so na memoria do front (sumiam no refresh) e duplicavam os sinais.
// `etapa_maior_interesse` / `etapa_perda_interesse` passam a ser DERIVADOS no servidor a
// partir dos sinais ativos (derivarEtapasDeSinais) — o cliente nao os informa mais.
const { LIGACAO_RESULTADO, MOTIVO_PERDA, ROTEIRO_ETAPA_TIPO, OPORTUNIDADE_STATUS } = require('../domain-enums')
const { assertMesmaEmpresa } = require('./campanhas')
const ligacaoEtapas = require('./ligacao-etapas')
const { criarFollowUp } = require('./follow-ups')

const RES = new Set(LIGACAO_RESULTADO)
const MOT = new Set(MOTIVO_PERDA)
const ETP = new Set(ROTEIRO_ETAPA_TIPO)
const OPS = new Set(OPORTUNIDADE_STATUS)

// Regra central: SOMENTE ligacoes encerradas alimentam metricas/dashboards/IA.
// Fatia G formaliza numa view; aqui as leituras analiticas usam esta constante.
const STATUS_ANALITICO = 'encerrada'

// Maquina de estados da SESSAO de ligacao (Fatia A). Transicoes validas — PURA/testavel.
// visualizando so existe no frontend (nada gravado). O backend so conhece os 3 status.
const TRANSICOES = Object.freeze({
  em_andamento: new Set(['encerrada', 'descartada']),
  encerrada: new Set(),   // terminal: nao volta para em_andamento sem reabertura auditada (fora do escopo)
  descartada: new Set(),  // terminal
})
function transicaoValida(de, para) {
  return !!TRANSICOES[de] && TRANSICOES[de].has(para)
}

// Estado de NEGOCIO da sessao (4 estados p/ 3 status) — logica pura em ./ligacoes-estado.js,
// modulo folha para nao criar ciclo com o guard usado pelos submodulos. Reexportado aqui
// porque este arquivo e' a porta de entrada do dominio de ligacoes.
const { estadoSessao, chamadaAberta, comEstado } = require('./ligacoes-estado')

function erroEntrada(message, statusCode = 400) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

// Validacao PURA (testavel sem banco) do resumo enviado no encerramento.
function validarRegistro(p = {}) {
  if (!RES.has(p.resultado)) throw erroEntrada('resultado invalido.')
  if (p.motivoPerda != null && !MOT.has(p.motivoPerda)) throw erroEntrada('motivo_perda invalido.')
  for (const [k, v] of [['etapa_alcancada', p.etapaAlcancada], ['etapa_maior_interesse', p.etapaMaiorInteresse], ['etapa_perda_interesse', p.etapaPerdaInteresse]]) {
    if (v != null && !ETP.has(v)) throw erroEntrada(`${k} invalido.`)
  }
  if (p.novoStatusOportunidade != null && !OPS.has(p.novoStatusOportunidade)) throw erroEntrada('status de oportunidade invalido.')
}

// Deriva as etapas de maior interesse / perda de interesse a partir dos SINAIS ATIVOS —
// fonte unica apos a unificacao das marcas. Mesma semantica das antigas marcas 🟢/🔴: a
// ULTIMA etapa em que houve sinal de cada tipo. PURA: espera a lista em ordem cronologica
// (listarSinais ja devolve ORDER BY registrado_em ASC). Sinal sem etapa_tipo e' ignorado.
function derivarEtapasDeSinais(sinais = []) {
  let etapaMaiorInteresse = null
  let etapaPerdaInteresse = null
  for (const s of sinais) {
    if (!s || !s.etapa_tipo || !ETP.has(s.etapa_tipo)) continue
    if (s.tipo === 'interesse') etapaMaiorInteresse = s.etapa_tipo
    else if (s.tipo === 'resistencia') etapaPerdaInteresse = s.etapa_tipo
  }
  return { etapaMaiorInteresse, etapaPerdaInteresse }
}

async function withTx(pool, fn) {
  const client = await pool.connect()
  try { await client.query('BEGIN'); const r = await fn(client); await client.query('COMMIT'); return r }
  catch (e) { try { await client.query('ROLLBACK') } catch { /* */ } throw e }
  finally { client.release() }
}

// --- Ciclo de vida da SESSAO (Fatia A) ------------------------------------------------
// Colunas devolvidas ao cockpit da Operacao (o cronometro do front usa iniciada_em).
const COLS_SESSAO = `id, empresa_id, status, campanha_id, campanha_lead_id, prospect_id,
  telefone, roteiro_versao_id, usuario_id, iniciada_em, encerrada_em, descartada_em,
  chamada_encerrada_em, duracao_seg, resultado, client_event_id, notas`
// `sessao_origem` FICA DE FORA de COLS_SESSAO de proposito: este bloco e' devolvido cru por
// `GET /ativa` e por `POST /iniciar`, e a impressao da sessao nao pode sair em rota nenhuma.
// Quem precisa dela le por uma consulta propria (obterSessao / listarLigacoesAtivasDaCampanha),
// que passa pelo sanitizador de services/ligacao-acompanhamento.js.

// Origem da SESSAO que fez a transicao (migration 068). Sempre aplicada como par, e sempre
// pelo mesmo fragmento, para as quatro transicoes de ciclo de vida (inicio, fim da chamada,
// encerramento, descarte) nao divergirem no que gravam.
//
// COALESCE de propósito: cliente que nao manda a origem (ou consumidor antigo) NAO apaga a
// origem ja registrada. Perder o "de onde veio" por causa de uma requisicao sem cabecalho
// seria pior do que nao ter registrado — a tela passaria a nao saber explicar um encerramento
// que ela mesma acabou de detectar.
function setOrigemSessao(origem, params) {
  const o = origem || {}
  params.push(o.impressao || null); const iImp = params.length
  params.push(o.dispositivo || null); const iDisp = params.length
  return `sessao_origem = COALESCE($${iImp}, sessao_origem),
          sessao_dispositivo = COALESCE($${iDisp}, sessao_dispositivo)`
}

// Le a ligacao por id GARANTINDO isolamento por empresa (nunca confiar so no id da URL).
async function obterLigacao(pool, empresaId, id) {
  if (!id) throw erroEntrada('id da ligacao obrigatorio.')
  const { rows } = await pool.query(
    `SELECT ${COLS_SESSAO} FROM app.ligacoes WHERE id = $1 AND empresa_id = $2`, [id, empresaId])
  if (!rows[0]) throw erroEntrada('Ligacao nao encontrada.', 404)
  return comEstado(rows[0])
}

// Recuperacao: existe uma ligacao em_andamento deste lead/prospect? (nao cria nada)
async function obterLigacaoAtiva(pool, empresaId, { campanhaLeadId, prospectId } = {}) {
  const chave = campanhaLeadId ? ['campanha_lead_id', campanhaLeadId]
    : (prospectId ? ['prospect_id', prospectId] : null)
  if (!chave) return null
  const { rows } = await pool.query(
    `SELECT ${COLS_SESSAO} FROM app.ligacoes
      WHERE empresa_id = $1 AND ${chave[0]} = $2 AND status = 'em_andamento'
      ORDER BY iniciada_em DESC LIMIT 1`, [empresaId, chave[1]])
  // Devolve TAMBEM a sessao com resumo pendente (chamada_encerrada_em preenchido). Ela e'
  // recuperavel — o que muda e' o estado_sessao, que diz ao cockpit se abre o roteiro
  // (Retomar) ou o formulario de resumo (Continuar resumo). Nao filtrar aqui e' proposital:
  // filtrar faria o front "perder" o resumo pendente e recomecar do zero.
  return rows[0] ? comEstado(rows[0]) : null
}

// Ligacoes ATIVAS de uma campanha, em UMA consulta (modo Acompanhar). Existe para a Central
// de Ligacoes marcar, na fila inteira, quais leads estao ocupados agora — sem N+1 (uma
// chamada de /ativa por linha da fila) e sem duplicar o JOIN dentro de `filaDeTrabalho` E de
// `listarLeadsDaCampanha`, que sao queries diferentes sobre o mesmo conjunto de leads.
//
// Barata por construcao: o UNIQUE parcial `idx_ligacoes_uma_ativa_por_lead`
// (empresa_id, campanha_lead_id) WHERE status = 'em_andamento' (migration 048) cobre
// exatamente estas linhas, e elas sao poucas — no maximo uma por lead em atendimento.
// Por isso NAO foi criado indice novo.
//
// `campanhaId` e' OBRIGATORIO: sem ele a leitura viraria "todas as ligacoes ativas da
// empresa", que nenhuma tela pede e que so' cresce. LIMIT como teto de sanidade.
async function listarLigacoesAtivasDaCampanha(pool, empresaId, { campanhaId, limit = 200 } = {}) {
  if (!campanhaId) throw erroEntrada('campanha_id obrigatorio.')
  const lim = Math.min(Math.max(Number.parseInt(limit, 10) || 200, 1), 500)
  const { rows } = await pool.query(
    `SELECT l.id, l.status, l.campanha_lead_id, l.prospect_id, l.iniciada_em,
            l.chamada_encerrada_em, l.usuario_id, u.nome AS usuario_nome,
            l.sessao_origem, l.sessao_dispositivo
       FROM app.ligacoes l
       LEFT JOIN app.usuarios u ON u.id = l.usuario_id
      WHERE l.empresa_id = $1 AND l.campanha_id = $2 AND l.status = 'em_andamento'
      ORDER BY l.iniciada_em ASC
      LIMIT $3`,
    [empresaId, campanhaId, lim])
  // `estado_sessao` vem daqui (fonte unica: comEstado) e nao e' re-derivado no front nem no
  // service — `em_andamento` e `aguardando_resumo` sao o MESMO status no banco.
  return rows.map(comEstado)
}

// Estado de UMA sessao, por id — a leitura que as telas abertas repetem no tempo para
// descobrir que algo mudou em OUTRO aparelho.
//
// Por que nao serve `obterLigacaoAtiva`: aquela consulta filtra `status = 'em_andamento'`, ou
// seja, a ligacao SOME dela no instante em que termina. "Sumiu" nao diz se foi encerramento
// ou descarte, nem quem fez — e sao desfechos com consequencias diferentes (encerrada entra
// na analitica e no historico do lead; descartada nao entra em lugar nenhum). Esta leitura e'
// por PK, entao continua respondendo depois do fim.
//
// Barata de proposito: uma linha por id (PK) + o nome de quem esta na ligacao. E' o que
// permite o passo de polling ser curto sem custo relevante — o modo Acompanhar continua
// recarregando o CONTEUDO (sinais/objecoes/perguntas/etapa) no seu proprio ritmo, mais longo.
async function obterSessao(pool, empresaId, id) {
  if (!id) throw erroEntrada('id da ligacao obrigatorio.')
  const { rows } = await pool.query(
    `SELECT l.id, l.status, l.campanha_id, l.campanha_lead_id, l.prospect_id,
            l.iniciada_em, l.chamada_encerrada_em, l.encerrada_em, l.descartada_em,
            l.usuario_id, u.nome AS usuario_nome, l.sessao_origem, l.sessao_dispositivo
       FROM app.ligacoes l
       LEFT JOIN app.usuarios u ON u.id = l.usuario_id
      WHERE l.id = $1 AND l.empresa_id = $2`, [id, empresaId])
  if (!rows[0]) throw erroEntrada('Ligacao nao encontrada.', 404)
  return comEstado(rows[0])
}

// Persistencia incremental do registro rapido (notas livres). So durante a ligacao ativa;
// last-write-wins (naturalmente idempotente num campo unico). Recuperavel no refresh.
async function atualizarNotas(pool, empresaId, id, notas) {
  if (!id) throw erroEntrada('id da ligacao obrigatorio.')
  const { rows } = await pool.query(
    `UPDATE app.ligacoes SET notas = $3
      WHERE id = $1 AND empresa_id = $2 AND status = 'em_andamento'
      RETURNING id, notas`,
    [id, empresaId, notas != null ? String(notas).slice(0, 4000) : null])
  if (!rows[0]) {
    const atual = await obterLigacao(pool, empresaId, id) // 404 se nao existe / nao e' da empresa
    throw erroEntrada(`Ligacao ${atual.status} nao aceita edicao de notas.`, 409)
  }
  return rows[0]
}

// Inicia a ligacao no clique explicito. Idempotente por client_event_id e por ligacao
// ativa existente (recuperacao): nunca cria uma segunda ligacao ativa para o mesmo lead.
async function iniciarLigacao(pool, empresaId, p = {}) {
  await assertMesmaEmpresa(pool, { schema: 'app', table: 'campanhas', id: p.campanhaId, empresaId, rotulo: 'Campanha' })
  await assertMesmaEmpresa(pool, { schema: 'app', table: 'campanha_leads', id: p.campanhaLeadId, empresaId, rotulo: 'Lead da campanha' })
  await assertMesmaEmpresa(pool, { schema: 'app', table: 'roteiro_versoes', id: p.roteiroVersaoId, empresaId, rotulo: 'Versao do roteiro' })
  await assertMesmaEmpresa(pool, { schema: 'prospectador', table: 'prospects', id: p.prospectId, empresaId, rotulo: 'Lead' })

  // 1) Idempotencia: mesmo client_event_id ja gravado => devolve a mesma ligacao (+ etapa ativa).
  if (p.clientEventId) {
    const { rows } = await pool.query(
      `SELECT ${COLS_SESSAO} FROM app.ligacoes WHERE empresa_id = $1 AND client_event_id = $2`,
      [empresaId, p.clientEventId])
    if (rows[0]) return { ...comEstado(rows[0]), retomada: true, etapa_ativa: await ligacaoEtapas.obterEtapaAtiva(pool, empresaId, rows[0].id) }
  }
  // 2) Recuperacao: ja existe ligacao ativa deste lead => retoma (nao duplica).
  const ativa = await obterLigacaoAtiva(pool, empresaId, { campanhaLeadId: p.campanhaLeadId, prospectId: p.prospectId })
  if (ativa) return { ...ativa, retomada: true, etapa_ativa: await ligacaoEtapas.obterEtapaAtiva(pool, empresaId, ativa.id) }

  // 3) Cria em_andamento (iniciada_em = agora) E abre a primeira etapa na MESMA transacao
  //    (invariante: toda ligacao iniciada tem uma etapa ativa quando ha roteiro com etapas).
  try {
    return await withTx(pool, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO app.ligacoes
           (empresa_id, campanha_id, campanha_lead_id, prospect_id, telefone, roteiro_versao_id,
            usuario_id, status, iniciada_em, client_event_id, sessao_origem, sessao_dispositivo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'em_andamento',NOW(),$8,$9,$10)
         RETURNING ${COLS_SESSAO}`,
        [empresaId, p.campanhaId || null, p.campanhaLeadId || null, p.prospectId || null,
          p.telefone || null, p.roteiroVersaoId || null, p.usuarioId || null, p.clientEventId || null,
          (p.origemSessao && p.origemSessao.impressao) || null,
          (p.origemSessao && p.origemSessao.dispositivo) || null])
      const lig = rows[0]
      const etapa_ativa = await ligacaoEtapas.abrirPrimeiraEtapaTx(client, empresaId, lig.id, p.roteiroVersaoId, p.usuarioId)
      return { ...comEstado(lig), retomada: false, etapa_ativa }
    })
  } catch (e) {
    // Corrida (UNIQUE parcial): outro request ganhou. Pode ser o MESMO client_event_id OU
    // outra ligacao ativa do mesmo lead (idx_ligacoes_uma_ativa_por_lead). Em ambos, recupera
    // a ligacao vencedora e devolve como retomada — nunca duas ativas para o mesmo lead.
    if (e && e.code === '23505') {
      if (p.clientEventId) {
        const { rows } = await pool.query(
          `SELECT ${COLS_SESSAO} FROM app.ligacoes WHERE empresa_id = $1 AND client_event_id = $2`,
          [empresaId, p.clientEventId])
        if (rows[0]) return { ...comEstado(rows[0]), retomada: true, etapa_ativa: await ligacaoEtapas.obterEtapaAtiva(pool, empresaId, rows[0].id) }
      }
      const jaAtiva = await obterLigacaoAtiva(pool, empresaId, { campanhaLeadId: p.campanhaLeadId, prospectId: p.prospectId })
      if (jaAtiva) return { ...jaAtiva, retomada: true, etapa_ativa: await ligacaoEtapas.obterEtapaAtiva(pool, empresaId, jaAtiva.id) }
    }
    throw e
  }
}

// Marca o instante em que a CHAMADA terminou (clique em "Encerrar ligacao"), separado do
// instante em que o resumo e' salvo. Ver migration 049. Faz a transicao de negocio
// em_andamento -> aguardando_resumo. Duas garantias que ANTES nao existiam:
//
//   1) IDEMPOTENTE (COALESCE): vale o PRIMEIRO clique. Antes era last-write-wins, entao um
//      segundo clique empurrava o fim da chamada para frente e inflava duracao_seg com o
//      tempo de preenchimento do resumo.
//   2) FECHA A ETAPA ATIVA no MESMO instante e na MESMA transacao. Antes a etapa so era
//      fechada em encerrarLigacao; enquanto o resumo estava aberto ela seguia acumulando, e
//      uma troca de etapa nesse meio-tempo a fechava com NOW() (trocarEtapa nao passa
//      `momento`), jogando o tempo do resumo dentro da duracao daquela etapa.
async function marcarChamadaEncerrada(pool, empresaId, id, { origemSessao } = {}) {
  if (!id) throw erroEntrada('id da ligacao obrigatorio.')
  return withTx(pool, async (client) => {
    // Le o valor ANTERIOR (travando a linha) so' para saber se este clique foi o que de fato
    // marcou o fim. Sem isto o chamador nao consegue distinguir o primeiro clique do segundo:
    // o COALESCE torna os dois bem-sucedidos e devolve a mesma linha, e a auditoria passaria a
    // registrar uma transicao por clique. O FOR UPDATE tambem serializa dois cliques
    // simultaneos (duas sessoes da mesma conta), garantindo que apenas um seja "o primeiro".
    const { rows: antes } = await client.query(
      `SELECT chamada_encerrada_em FROM app.ligacoes
        WHERE id = $1 AND empresa_id = $2 FOR UPDATE`, [id, empresaId])
    const jaMarcada = !!(antes[0] && antes[0].chamada_encerrada_em)
    const params = [id, empresaId]
    const { rows } = await client.query(
      `UPDATE app.ligacoes SET chamada_encerrada_em = COALESCE(chamada_encerrada_em, NOW()),
              ${setOrigemSessao(origemSessao, params)}
        WHERE id = $1 AND empresa_id = $2 AND status = 'em_andamento'
        RETURNING ${COLS_SESSAO}`, params)
    if (!rows[0]) {
      const atual = await obterLigacao(pool, empresaId, id) // 404 se nao existe / nao e' da empresa
      throw erroEntrada(`Ligacao ${atual.status} nao aceita marcar fim de chamada.`, 409)
    }
    // Idempotente: no 2o clique nao ha ocorrencia aberta e isto devolve null, sem efeito.
    await ligacaoEtapas.fecharEtapaAtiva(client, empresaId, id, rows[0].chamada_encerrada_em)
    return { ...comEstado(rows[0]), ja_marcada: jaMarcada }
  })
}

// Encerra a ligacao (idempotente). Fecha a sessao, calcula duracao no servidor a partir do
// FIM DA CHAMADA (nao do momento do save), deriva as etapas de interesse/perda dos sinais
// ativos e atualiza o status da oportunidade — tudo atomico.
async function encerrarLigacao(pool, empresaId, id, p = {}) {
  const atual = await obterLigacao(pool, empresaId, id)
  if (atual.status === 'encerrada') return { ...atual, ja_encerrada: true } // idempotente
  if (!transicaoValida(atual.status, 'encerrada')) {
    throw erroEntrada(`Ligacao ${atual.status} nao pode ser encerrada.`, 409)
  }
  validarRegistro(p)

  return withTx(pool, async (client) => {
    // Fonte unica de interesse/resistencia: os sinais ATIVOS, em ordem cronologica.
    const { rows: sinais } = await client.query(
      `SELECT tipo, etapa_tipo FROM app.ligacao_sinais
        WHERE ligacao_id = $1 AND empresa_id = $2 AND removido_em IS NULL
        ORDER BY registrado_em ASC`, [id, empresaId])
    const { etapaMaiorInteresse, etapaPerdaInteresse } = derivarEtapasDeSinais(sinais)

    // Guard idempotente tambem no UPDATE: so encerra se ainda estiver em_andamento.
    // duracao_seg mede ate o FIM DA CHAMADA; sem ele (cliente antigo), cai para NOW().
    const params = [id, empresaId, p.resultado,
      p.etapaAlcancada || null, etapaMaiorInteresse, etapaPerdaInteresse,
      p.objecaoPrincipal != null ? String(p.objecaoPrincipal).slice(0, 500) : null,
      p.motivoPerda || null, p.notas != null ? String(p.notas).slice(0, 4000) : null]
    const { rows } = await client.query(
      `UPDATE app.ligacoes
          SET status = 'encerrada', encerrada_em = NOW(),
              duracao_seg = GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(chamada_encerrada_em, NOW()) - iniciada_em)))::int,
              resultado = $3, etapa_alcancada = $4, etapa_maior_interesse = $5,
              etapa_perda_interesse = $6, objecao_principal = $7, motivo_perda = $8, notas = $9,
              ${setOrigemSessao(p.origemSessao, params)}
        WHERE id = $1 AND empresa_id = $2 AND status = 'em_andamento'
        RETURNING ${COLS_SESSAO}`,
      params)
    if (!rows[0]) { // corrida: outro request encerrou/descartou primeiro => devolve o estado atual
      const cur = await obterLigacao(pool, empresaId, id)
      return { ...cur, ja_encerrada: cur.status === 'encerrada' }
    }
    const ligacao = rows[0]
    // Fecha a etapa temporal ativa na MESMA transacao (Fatia B), no MESMO instante usado na
    // duracao da ligacao — senao a ultima etapa reabsorve o tempo de preenchimento.
    // Normalmente ela JA foi fechada por marcarChamadaEncerrada; ai isto devolve null e a
    // etapa final vem da ultima ocorrencia (o contrato `etapa_final` nao pode regredir a null).
    const etapaFinal = (await ligacaoEtapas.fecharEtapaAtiva(client, empresaId, id, ligacao.chamada_encerrada_em || null))
      || (await ligacaoEtapas.obterEtapaFinal(client, empresaId, id))

    // PROXIMA ACAO como entidade (migration 062). Criada na MESMA transacao do encerramento:
    // ou a ligacao encerra COM a acao combinada, ou nao encerra. Gravar o follow-up fora da
    // transacao permitiria que ele sobrevivesse a um rollback e mandasse o operador agir sobre
    // uma ligacao que nao existe.
    //
    // `followUp` ausente (ou canal vazio) = "sem proxima acao", que e' uma resposta valida do
    // formulario — nao um erro e nao um default. Nada e' criado nesse caso.
    let followUp = null
    if (p.followUp && p.followUp.canal) {
      const telefone = p.followUp.telefone || ligacao.telefone || await telefoneDoLead(client, empresaId, ligacao)
      followUp = await criarFollowUp(client, empresaId, {
        ...p.followUp,
        telefone,
        origem: 'ligacao',
        ligacao_id: ligacao.id,
        campanha_lead_id: ligacao.campanha_lead_id || null,
        prospect_id: ligacao.prospect_id || null,
      }, { usuarioId: p.usuarioId || ligacao.usuario_id || null })
    }

    // `app.campanha_leads` continua sendo escrita: e ela que alimenta a aba Acompanhamento da
    // campanha e o filtro "com/sem proxima acao" da fila de ligacoes. O follow-up nao a
    // substitui — quando existe, ele e a FONTE do resumo gravado aqui, para as duas telas nao
    // divergirem sobre o que foi combinado.
    const proximaAcaoResumo = followUp ? followUp.proxima_acao : p.proximaAcao
    const dataFollowupResumo = followUp ? followUp.agendado_para : p.dataFollowup
    if (ligacao.campanha_lead_id && (p.novoStatusOportunidade || proximaAcaoResumo !== undefined || dataFollowupResumo !== undefined)) {
      const campos = []
      const params = [ligacao.campanha_lead_id, empresaId]
      const set = (col, val) => { params.push(val); campos.push(`${col} = $${params.length}`) }
      if (p.novoStatusOportunidade) {
        if (!OPS.has(p.novoStatusOportunidade)) throw erroEntrada('status de oportunidade invalido.')
        set('status', p.novoStatusOportunidade)
      }
      if (proximaAcaoResumo !== undefined) set('proxima_acao', proximaAcaoResumo === '' ? null : proximaAcaoResumo)
      if (dataFollowupResumo !== undefined) set('data_followup', dataFollowupResumo || null)
      if (campos.length) {
        await client.query(
          `UPDATE app.campanha_leads SET ${campos.join(', ')}, atualizado_em = NOW() WHERE id = $1 AND empresa_id = $2`,
          params)
      }
    }
    return { ...comEstado(ligacao), etapa_final: etapaFinal ? etapaFinal.tipo_etapa : null, follow_up: followUp }
  })
}

// Telefone do lead quando a propria ligacao nao guardou um (ligacoes antigas, ou iniciadas
// sem telefone). Sem telefone nao existe identidade de contato, e o follow-up nao pode nascer.
async function telefoneDoLead(client, empresaId, ligacao) {
  const chave = ligacao.prospect_id
    ? ['p.id = $2', ligacao.prospect_id]
    : (ligacao.campanha_lead_id ? ['cl.id = $2', ligacao.campanha_lead_id] : null)
  if (!chave) return null
  const { rows } = await client.query(
    `SELECT p.telefone
       FROM prospectador.prospects p
       LEFT JOIN app.campanha_leads cl ON cl.prospect_id = p.id AND cl.empresa_id = $1
      WHERE p.empresa_id = $1 AND ${chave[0]}
      LIMIT 1`,
    [empresaId, chave[1]]
  )
  return rows[0] ? rows[0].telefone : null
}

// Descarta a operacao (idempotente). Fecha a etapa ativa na MESMA transacao (preserva as
// ocorrencias para auditoria; fora da analitica por causa do status). Fica so para auditoria.
async function descartarLigacao(pool, empresaId, id, { motivo, origemSessao } = {}) {
  const atual = await obterLigacao(pool, empresaId, id)
  if (atual.status === 'descartada') return { ...atual, ja_descartada: true } // idempotente
  if (!transicaoValida(atual.status, 'descartada')) {
    throw erroEntrada(`Ligacao ${atual.status} nao pode ser descartada.`, 409)
  }
  return withTx(pool, async (client) => {
    const params = [id, empresaId, motivo != null ? String(motivo).slice(0, 500) : null]
    const { rows } = await client.query(
      `UPDATE app.ligacoes
          SET status = 'descartada', descartada_em = NOW(),
              motivo_descarte = $3,
              ${setOrigemSessao(origemSessao, params)}
        WHERE id = $1 AND empresa_id = $2 AND status = 'em_andamento'
        RETURNING ${COLS_SESSAO}`,
      params)
    if (!rows[0]) { // corrida: outro request ja encerrou/descartou
      const cur = await obterLigacao(pool, empresaId, id)
      return { ...cur, ja_descartada: cur.status === 'descartada' }
    }
    // Descarte apos o fim da chamada: a etapa ja foi fechada (no instante correto) por
    // marcarChamadaEncerrada, entao isto e' no-op. Se a chamada ainda estava aberta, fecha agora.
    await ligacaoEtapas.fecharEtapaAtiva(client, empresaId, id, rows[0].chamada_encerrada_em || null)
    return comEstado(rows[0])
  })
}

// Historico de ligacoes de um lead da campanha (ou por prospect). So ligacoes REAIS
// (encerradas): em_andamento/descartada nao aparecem como "ligacao anterior".
async function listarLigacoes(pool, empresaId, { campanhaLeadId, prospectId, campanhaId, limit = 50 } = {}) {
  const params = [empresaId]
  const conds = ['l.empresa_id = $1', `l.status = '${STATUS_ANALITICO}'`]
  if (campanhaLeadId) { params.push(campanhaLeadId); conds.push(`l.campanha_lead_id = $${params.length}`) }
  if (prospectId) { params.push(prospectId); conds.push(`l.prospect_id = $${params.length}`) }
  if (campanhaId) { params.push(campanhaId); conds.push(`l.campanha_id = $${params.length}`) }
  params.push(Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 500))
  const { rows } = await pool.query(
    `SELECT l.id, l.resultado, l.etapa_alcancada, l.objecao_principal, l.motivo_perda,
            l.duracao_seg, l.notas, l.usuario_id, l.criado_em
       FROM app.ligacoes l
      WHERE ${conds.join(' AND ')}
      ORDER BY l.criado_em DESC
      LIMIT $${params.length}`,
    params
  )
  return rows
}

module.exports = {
  validarRegistro, derivarEtapasDeSinais, transicaoValida, STATUS_ANALITICO,
  estadoSessao, chamadaAberta,
  listarLigacoes, obterLigacao, obterLigacaoAtiva, listarLigacoesAtivasDaCampanha, obterSessao,
  iniciarLigacao, marcarChamadaEncerrada, encerrarLigacao, descartarLigacao, atualizarNotas,
}
