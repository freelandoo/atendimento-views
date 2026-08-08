'use strict'

// Motor da integração Meta por empresa. Duas fases, sempre nesta ordem:
//
//   1. RECONCILIAR — lê as reuniões da empresa e registra no ledger os fatos que
//      viraram (ou não) conversão. Não fala com a Meta.
//   2. DESPACHAR   — pega o que está pendente NO LEDGER DAQUELA EMPRESA, carrega a
//      credencial DAQUELA EMPRESA e envia.
//
// POR QUE RECONCILIADOR E NÃO GANCHO NOS PONTOS DE NEGÓCIO
// A alternativa era chamar `registrarConversao` dentro de handoff-alerts.js,
// agenda-multiempresa.js, ligacoes.js e agenda.js. Isso colocaria código novo dentro
// de quatro transações que hoje criam reunião em produção — um bug aqui viraria uma
// reunião não criada. O reconciliador toca ZERO caminho de negócio, é idempotente por
// construção (a chave é determinística e o índice único recusa a segunda linha) e
// enxerga também as reuniões que já existiam. Custo: o fato vira evento no próximo
// tick, não no mesmo instante — irrelevante para uma janela de atribuição de 7 dias.
//
// ISOLAMENTO: toda consulta abaixo recebe `empresaId` e filtra por ele. O laço é
// "para cada empresa com integração ativa", nunca "para todos os leads".

const {
  TIPOS_CONVERSAO,
  nomeMetaDoTipo,
  montarEventId,
  normalizarTelefone,
  avaliarFato,
  classificarFalha,
  mensagemDeErro,
  MOEDA_PADRAO,
} = require('./meta-conversao')
const { enviarEventoMetaCAPI } = require('./meta-capi')
const integracoesDb = require('../db/meta-integracoes')
const ledger = require('../db/conversao-eventos')

// A Meta só aceita evento de mensagem com até 7 dias de atraso. Fato mais velho que
// isso não é registrado: seria uma linha nascida para falhar. Isto também protege a
// PRIMEIRA ativação — sem a janela, ligar a integração despejaria meses de reuniões
// antigas de uma vez no Gerenciador de Eventos.
const JANELA_FATO_DIAS = 7
// Quanto para trás o reconciliador olha ao procurar reuniões candidatas. Maior que a
// janela do fato porque uma reunião criada há 20 dias pode ter sido concluída ontem.
const JANELA_CANDIDATOS_DIAS = 45
const LOTE_ENVIO = 25

/**
 * Válvula de pausa do ciclo inteiro (reconciliação E envio).
 *
 * Existe por causa da correção de `vendas.lead_profiles.empresa_id` (Fase A): enquanto
 * o backfill estiver sendo avaliado ou aplicado, a atribuição de um lead pode mudar de
 * empresa entre um tick e o outro. Evento enviado à Meta não se estorna — então, na
 * dúvida, não se envia. Lida a CADA ciclo (não no require) para que o efeito seja o
 * mesmo com ou sem restart do processo.
 */
function conversoesPausadas() {
  const v = String(process.env.META_CONVERSOES_PAUSADO || '').trim().toLowerCase()
  return v === 'on' || v === '1' || v === 'true' || v === 'sim'
}

function dentroDaJanela(data, agora) {
  if (!data) return false
  const t = data instanceof Date ? data.getTime() : new Date(data).getTime()
  if (!Number.isFinite(t)) return false
  const limite = agora.getTime() - JANELA_FATO_DIAS * 24 * 60 * 60 * 1000
  return t >= limite && t <= agora.getTime() + 60 * 1000
}

// ─── Fase 1: reconciliação ────────────────────────────────────────────────────

/**
 * Reuniões da AGENDA MULTIEMPRESA (app.agenda_eventos). Caminho nativo: a tabela já
 * tem empresa_id NOT NULL, então o isolamento é a própria cláusula WHERE.
 * A atribuição vem de vendas.lead_profiles da MESMA empresa, casada por telefone.
 */
async function lerReunioesAgendaApp(pool, empresaId) {
  const { rows } = await pool.query(
    `SELECT e.id::text            AS entidade_id,
            e.status,
            e.criado_em,
            e.data_fim,
            e.venda_valor,
            e.venda_moeda,
            e.venda_registrada_em,
            regexp_replace(COALESCE(e.lead_telefone, ''), '\\D', '', 'g') AS telefone_norm,
            lp.origem_anuncio->>'ctwa_clid' AS ctwa_clid
       FROM app.agenda_eventos e
       LEFT JOIN vendas.lead_profiles lp
              ON lp.empresa_id = e.empresa_id
             AND lp.origem = 'meta_ads'
             AND regexp_replace(lp.numero, '\\D', '', 'g')
                 = regexp_replace(COALESCE(e.lead_telefone, ''), '\\D', '', 'g')
      WHERE e.empresa_id = $1
        AND e.tipo = 'reuniao'
        AND e.excluido_em IS NULL
        AND COALESCE(e.lead_telefone, '') <> ''
        AND GREATEST(e.criado_em, e.atualizado_em) > NOW() - ($2 || ' days')::interval
      ORDER BY e.criado_em ASC`,
    [empresaId, String(JANELA_CANDIDATOS_DIAS)]
  )
  return rows.map((r) => ({
    entidadeTipo: 'agenda_app',
    entidadeId: r.entidade_id,
    status: r.status,
    agendadoEm: r.criado_em,
    realizadoEm: r.data_fim,
    telefoneNorm: r.telefone_norm || null,
    temAtribuicao: Boolean(r.ctwa_clid),
    vendaValor: r.venda_valor != null ? Number(r.venda_valor) : null,
    vendaMoeda: r.venda_moeda || MOEDA_PADRAO,
    vendaEm: r.venda_registrada_em || r.data_fim,
  }))
}

/**
 * Reuniões da AGENDA DO BOT (vendas.agenda_eventos).
 *
 * Esta tabela NÃO tem empresa_id — é chaveada por usuario_id do dashboard legado. E
 * é justamente por aqui que passa o lead de anúncio: ele chega pelo WhatsApp e o bot
 * agenda. Ignorá-la deixaria a integração quase sem eventos.
 *
 * A empresa é RESOLVIDA por vendas.conversas.empresa_id (definido no primeiro contato,
 * pela instância Evolution), casando o telefone de metadata->>'lead_numero'. O filtro
 * `c.empresa_id = $1` é o que garante o isolamento: conversa sem empresa resolvida
 * não casa com empresa nenhuma e a reunião simplesmente não vira evento.
 *
 * O valor da venda vem de vendas.conversas.venda_valor (a marcação de "vendido" do
 * painel legado), que é a MESMA linha de onde a empresa foi resolvida — não há salto
 * por telefone entre tenants. Moeda: BRL, porque a marcação legada não tem moeda.
 */
async function lerReunioesAgendaVendas(pool, empresaId) {
  const { rows } = await pool.query(
    `SELECT e.id::text AS entidade_id,
            e.status,
            e.criado_em,
            e.data_fim,
            e.concluido_em,
            regexp_replace(COALESCE(e.metadata->>'lead_numero', ''), '\\D', '', 'g') AS telefone_norm,
            c.venda_fechada,
            c.venda_valor,
            lp.origem_anuncio->>'ctwa_clid' AS ctwa_clid
       FROM vendas.agenda_eventos e
       JOIN vendas.conversas c
              ON regexp_replace(c.numero, '\\D', '', 'g')
                 = regexp_replace(COALESCE(e.metadata->>'lead_numero', ''), '\\D', '', 'g')
       LEFT JOIN vendas.lead_profiles lp
              ON lp.empresa_id = c.empresa_id
             AND lp.origem = 'meta_ads'
             AND regexp_replace(lp.numero, '\\D', '', 'g') = regexp_replace(c.numero, '\\D', '', 'g')
      WHERE c.empresa_id = $1
        AND e.tipo = 'reuniao'
        AND e.excluido_em IS NULL
        AND COALESCE(e.metadata->>'lead_numero', '') <> ''
        AND GREATEST(e.criado_em, e.atualizado_em) > NOW() - ($2 || ' days')::interval
      ORDER BY e.criado_em ASC`,
    [empresaId, String(JANELA_CANDIDATOS_DIAS)]
  )

  const lidas = rows.map((r) => ({
    entidadeTipo: 'agenda_vendas',
    entidadeId: r.entidade_id,
    status: r.status,
    agendadoEm: r.criado_em,
    realizadoEm: r.concluido_em || r.data_fim,
    telefoneNorm: r.telefone_norm || null,
    temAtribuicao: Boolean(r.ctwa_clid),
    // A venda desta agenda mora na CONVERSA, não na reunião — ou seja, é do LEAD.
    // Sem o desempate abaixo, um lead com duas reuniões concluídas geraria duas
    // vendas para a Meta a partir de um único fechamento.
    vendaValor: r.venda_fechada === true && r.venda_valor != null ? Number(r.venda_valor) : null,
    vendaMoeda: MOEDA_PADRAO,
    vendaEm: r.concluido_em || r.data_fim,
  }))

  // A venda do lead é creditada à ÚLTIMA reunião concluída dele. As demais ficam
  // apenas como "realizada".
  const donoDaVenda = new Map()
  for (const m of lidas) {
    if (m.status !== 'concluido' || !(m.vendaValor > 0) || !m.telefoneNorm) continue
    const atual = donoDaVenda.get(m.telefoneNorm)
    const quando = new Date(m.realizadoEm || 0).getTime()
    if (!atual || quando > atual.quando) donoDaVenda.set(m.telefoneNorm, { id: m.entidadeId, quando })
  }
  for (const m of lidas) {
    if (m.vendaValor > 0 && donoDaVenda.get(m.telefoneNorm)?.id !== m.entidadeId) {
      m.vendaValor = null
    }
  }
  return lidas
}

/** Os três fatos candidatos de UMA reunião, com o momento real de cada um. */
function fatosDaReuniao(reuniao) {
  const realizada = reuniao.status === 'concluido'
  return [
    {
      tipo: 'reuniao_agendada',
      ocorridoEm: reuniao.agendadoEm,
      elegivel: true,
    },
    {
      tipo: 'reuniao_realizada',
      ocorridoEm: reuniao.realizadoEm,
      elegivel: realizada,
    },
    {
      // Uma reunião que gerou venda também FOI realizada: os dois eventos existem e
      // são ligados de forma independente na configuração (critério de aceite).
      tipo: 'reuniao_realizada_com_venda',
      ocorridoEm: reuniao.vendaEm || reuniao.realizadoEm,
      elegivel: realizada && reuniao.vendaValor > 0,
      valor: reuniao.vendaValor,
      moeda: reuniao.vendaMoeda,
    },
  ]
}

/**
 * Registra no ledger os fatos de conversão desta empresa. Idempotente: rodar a cada
 * tick não cria linha repetida nem reenvia nada.
 */
async function reconciliarEmpresa(pool, empresaId, integracao, deps = {}) {
  const agora = deps.agora instanceof Date ? deps.agora : new Date()
  const reunioes = [
    ...(await lerReunioesAgendaApp(pool, empresaId)),
    ...(await lerReunioesAgendaVendas(pool, empresaId)),
  ]

  let registrados = 0
  let ignorados = 0
  let corrigidos = 0

  for (const reuniao of reunioes) {
    for (const fato of fatosDaReuniao(reuniao)) {
      if (!TIPOS_CONVERSAO.includes(fato.tipo)) continue
      // O fato ainda não aconteceu (reunião futura, venda não registrada).
      if (!fato.elegivel) continue
      if (!dentroDaJanela(fato.ocorridoEm, agora)) continue

      const eventId = montarEventId({
        tipo: fato.tipo,
        entidadeTipo: reuniao.entidadeTipo,
        entidadeId: reuniao.entidadeId,
      })

      const veredito = avaliarFato(
        {
          tipo: fato.tipo,
          statusReuniao: reuniao.status,
          temAtribuicao: reuniao.temAtribuicao,
          valor: fato.valor,
          moeda: fato.moeda,
        },
        integracao
      )

      // Sem atribuição de anúncio o fato não é conversão da Meta e não interessa ao
      // histórico: seria a maioria absoluta dos leads (prospecção ativa) inundando a
      // tela com "não veio de anúncio". Os demais motivos VIRAM linha, porque aí o
      // operador precisa entender por que a reunião dele não contou.
      if (!veredito.ok && veredito.motivo === 'sem_atribuicao') continue

      const { criado } = await ledger.registrarEvento(pool, empresaId, {
        tipo: fato.tipo,
        eventId,
        entidadeTipo: reuniao.entidadeTipo,
        entidadeId: reuniao.entidadeId,
        telefoneNorm: reuniao.telefoneNorm,
        ocorridoEm: fato.ocorridoEm,
        valor: veredito.ok ? (veredito.valor ?? null) : (fato.valor ?? null),
        moeda: veredito.ok ? (veredito.moeda ?? null) : (fato.valor != null ? fato.moeda : null),
        status: veredito.ok ? 'pendente' : 'ignorado',
        motivoIgnorado: veredito.ok ? null : veredito.motivo,
      })

      if (criado) {
        if (veredito.ok) registrados += 1
        else ignorados += 1
      } else if (fato.tipo === 'reuniao_realizada_com_venda' && veredito.ok) {
        // O fato já estava registrado: o valor da venda pode ter sido corrigido depois.
        const r = await ledger.sincronizarValorVenda(pool, empresaId, eventId, veredito.valor)
        if (r) corrigidos += 1
      }
    }
  }

  return { registrados, ignorados, corrigidos }
}

// ─── Fase 2: despacho ─────────────────────────────────────────────────────────

/**
 * ctwa_clid dos telefones do lote, lido da MESMA empresa. Fica fora do ledger de
 * propósito: é identificador de clique de uma pessoa, e o ledger é lido pela tela.
 */
async function carregarAtribuicoes(pool, empresaId, telefones = []) {
  const lista = [...new Set(telefones.filter(Boolean))]
  if (!lista.length) return new Map()
  const { rows } = await pool.query(
    `SELECT regexp_replace(numero, '\\D', '', 'g') AS telefone_norm,
            origem_anuncio->>'ctwa_clid' AS ctwa_clid
       FROM vendas.lead_profiles
      WHERE empresa_id = $1
        AND origem = 'meta_ads'
        AND origem_anuncio->>'ctwa_clid' IS NOT NULL
        AND regexp_replace(numero, '\\D', '', 'g') = ANY($2::text[])`,
    [empresaId, lista]
  )
  return new Map(rows.map((r) => [r.telefone_norm, r.ctwa_clid]))
}

/** Envia os eventos pendentes de UMA empresa. */
async function despacharEmpresa(pool, empresaId, deps = {}) {
  const logger = deps.logger || console
  const enviar = deps.enviarEvento || enviarEventoMetaCAPI

  const credencial = await integracoesDb.obterCredencial(pool, empresaId)
  const pendentes = await ledger.reservarPendentes(pool, empresaId, { limite: LOTE_ENVIO })
  if (!pendentes.length) return { enviados: 0, falhas: 0, ignorados: 0 }

  // A integração pode ter sido desativada entre o registro e o envio. Nada é enviado
  // "por inércia": sem integração ativa, os eventos são encerrados como ignorados.
  if (!credencial || credencial.status !== 'ativa') {
    for (const ev of pendentes) {
      await ledger.marcarIgnorado(pool, empresaId, ev.id, 'integracao_inativa')
    }
    return { enviados: 0, falhas: 0, ignorados: pendentes.length }
  }

  const atribuicoes = await carregarAtribuicoes(pool, empresaId, pendentes.map((e) => e.telefone_norm))
  let enviados = 0
  let falhas = 0
  let ignorados = 0

  for (const ev of pendentes) {
    // Cinto e suspensório do critério "nenhum evento é enviado sem empresa_id": a
    // coluna é NOT NULL, mas se algum dia uma linha chegar aqui divergente da empresa
    // do laço, ela não é enviada e o erro fica auditável.
    if (!ev.empresa_id || ev.empresa_id !== empresaId) {
      logger.error?.({
        operation: 'meta_capi', etapa: 'empresa_inconsistente',
        evento_id: ev.id, empresa_esperada: empresaId, empresa_evento: ev.empresa_id || null,
      })
      await ledger.marcarIgnorado(pool, empresaId, ev.id, 'empresa_nao_resolvida')
      ignorados += 1
      continue
    }

    // O evento pode ter sido desligado na configuração depois de o fato ser registrado.
    const habilitado = {
      reuniao_agendada: credencial.evento_agendada,
      reuniao_realizada: credencial.evento_realizada,
      reuniao_realizada_com_venda: credencial.evento_venda,
    }[ev.tipo]
    if (!habilitado) {
      await ledger.marcarIgnorado(pool, empresaId, ev.id, 'evento_desabilitado')
      ignorados += 1
      continue
    }

    const ctwaClid = atribuicoes.get(ev.telefone_norm)
    if (!ctwaClid) {
      await ledger.marcarIgnorado(pool, empresaId, ev.id, 'sem_atribuicao')
      ignorados += 1
      continue
    }

    const eventName = nomeMetaDoTipo(ev.tipo)
    await ledger.definirEventName(pool, empresaId, ev.id, eventName)

    const res = await enviar(
      {
        datasetId: credencial.datasetId,
        token: credencial.token,
        pageId: credencial.pageId,
        wabaId: credencial.wabaId,
        testEventCode: credencial.testEventCode,
      },
      {
        eventName,
        eventId: ev.event_id,
        ctwaClid,
        // Momento do FATO, não do envio: é assim que a Meta atribui ao clique certo.
        eventTime: Math.floor(new Date(ev.ocorrido_em).getTime() / 1000),
        value: ev.valor != null ? Number(ev.valor) : undefined,
        currency: ev.moeda || undefined,
      },
      deps
    )

    const tentativaN = (Number(ev.tentativas) || 0) + 1
    await ledger.registrarTentativa(pool, empresaId, ev.id, {
      numeroTentativa: tentativaN,
      ok: res.ok === true,
      httpStatus: res.status ?? null,
      codigo: res.erro?.codigo ?? null,
      subcodigo: res.erro?.subcodigo ?? null,
      mensagem: res.ok ? null : mensagemDeErro({
        codigo: res.erro?.codigo, subcodigo: res.erro?.subcodigo, httpStatus: res.status,
      }),
      fbtraceId: res.erro?.fbtraceId || null,
      duracaoMs: res.duracaoMs ?? null,
    })

    if (res.ok) {
      await ledger.marcarEnviado(pool, empresaId, ev.id)
      enviados += 1
      continue
    }

    const mensagem = mensagemDeErro({
      codigo: res.erro?.codigo, subcodigo: res.erro?.subcodigo, httpStatus: res.status,
    })
    const veredito = classificarFalha({
      httpStatus: res.status, codigo: res.erro?.codigo, subcodigo: res.erro?.subcodigo,
      tentativas: tentativaN,
    })
    await ledger.marcarFalha(pool, empresaId, ev.id, {
      definitiva: veredito.esgotou, mensagem, tentativas: tentativaN,
    })
    if (veredito.desativarIntegracao) {
      // Credencial/configuração ruim afeta a empresa inteira: para de queimar
      // tentativa em todos os eventos e a tela passa a pedir "reconecte".
      await integracoesDb.marcarAtencao(pool, empresaId, mensagem)
      logger.warn?.({ operation: 'meta_capi', etapa: 'integracao_precisa_atencao', empresa_id: empresaId })
      falhas += 1
      break
    }
    falhas += 1
  }

  return { enviados, falhas, ignorados }
}

// ─── Entrada do worker ────────────────────────────────────────────────────────

/**
 * Um ciclo completo: para cada empresa com integração ATIVA, reconcilia e despacha.
 * Uma empresa que falhe não derruba as outras. Chamado pelo tick de src/agent.js.
 */
async function processarConversoesMeta(pool, deps = {}) {
  const logger = deps.logger || console
  // Pausa administrativa: nada é reconciliado e nada é enviado. O que já está no
  // ledger continua pendente e sai no primeiro ciclo depois de despausar.
  if (conversoesPausadas()) {
    logger.info?.({ operation: 'meta_capi', etapa: 'ciclo_pausado', motivo: 'META_CONVERSOES_PAUSADO' })
    return { empresas: 0, enviados: 0, pausado: true }
  }
  let empresas = []
  try {
    empresas = await integracoesDb.listarAtivas(pool)
  } catch (e) {
    logger.warn?.({ operation: 'meta_capi', etapa: 'listar_ativas_erro', erro: e.message })
    return { empresas: 0, enviados: 0 }
  }
  if (!empresas.length) return { empresas: 0, enviados: 0 }

  let enviados = 0
  for (const emp of empresas) {
    try {
      await reconciliarEmpresa(pool, emp.empresaId, emp, deps)
      const r = await despacharEmpresa(pool, emp.empresaId, deps)
      enviados += r.enviados
      if (r.enviados || r.falhas) {
        logger.info?.({
          operation: 'meta_capi', etapa: 'ciclo', empresa_id: emp.empresaId,
          enviados: r.enviados, falhas: r.falhas, ignorados: r.ignorados,
        })
      }
    } catch (e) {
      // Erro de uma empresa não pode interromper o ciclo das demais.
      logger.warn?.({
        operation: 'meta_capi', etapa: 'ciclo_erro', empresa_id: emp.empresaId, erro: e.message,
      })
    }
  }
  return { empresas: empresas.length, enviados }
}

module.exports = {
  JANELA_FATO_DIAS,
  JANELA_CANDIDATOS_DIAS,
  conversoesPausadas,
  dentroDaJanela,
  fatosDaReuniao,
  lerReunioesAgendaApp,
  lerReunioesAgendaVendas,
  carregarAtribuicoes,
  reconciliarEmpresa,
  despacharEmpresa,
  processarConversoesMeta,
}
