'use strict'
// Operacao Comercial — Etapa 2. Missao (desafio com recompensa). Modulo PURO e dono UNICO do
// vocabulario. Sem banco, sem HTTP, sem IA, sem rede: testavel com `node --test`.
// Mesmo padrao de services/comissao.js, programa-aceite.js e acesso-capacidades.js.
//
// ─── O QUE E' UMA MISSAO ────────────────────────────────────────────────────────────────
// Um desafio publicado pelo DONO, valido para toda a equipe comercial por uma janela de datas,
// com um ALVO e uma RECOMPENSA declarada. Cada pessoa ve o PROPRIO progresso; o dono ve quem
// alcancou (fato necessario para pagar o premio), nunca o progresso parcial de cada um.
//
// ─── AS TRES REGRAS QUE NAO SE NEGOCIAM ────────────────────────────────────────────────
//  1. **Publicada, a missao e' IMUTAVEL.** Alvo e recompensa nunca sao editados — mudar o alvo
//     em outubro reescreveria o desafio que alguem cumpriu em setembro, e "quem alcancou"
//     deixaria de ser fato para virar uma conta que depende do estado atual da tabela. Para
//     mudar: encerra e publica outra. (Mesma disciplina de `comissao_planos` e `roteiro_versoes`.)
//  2. **A metrica e' RESULTADO PAGO, nunca atividade.** Premiar "numero de reunioes" paga para
//     marcar reuniao ruim. E' a mesma razao da Decisao 3 de 2026-09-18 (ranking por resultado) e
//     da guarda que impede o painel da equipe de virar placar.
//  3. **Progresso e' PESSOAL.** Este modulo nunca compara duas pessoas. Ordenar gente por
//     progresso e' ranking, que e' outra etapa e outra decisao.
//
// ─── PROIBICOES (com guarda de regressao em test/missao.test.js) ───────────────────────
//  - Comparar `metrica` ou `status` com literal fora deste modulo.
//  - Acrescentar valor a METRICA sem implementar o medidor no MESMO diff (licao da 067).
//  - Qualquer funcao que ordene ou classifique pessoas por progresso.

// ─── Vocabulario ────────────────────────────────────────────────────────────────────────
// Espelha as CHECKs da migration 085. Ha teste anti-drift que le a migration.

// UMA metrica, de proposito. Ver o cabecalho da migration.
const METRICA = Object.freeze({ FATURAMENTO_PAGO_ORIGINADO: 'faturamento_pago_originado' })
const METRICAS = Object.freeze([METRICA.FATURAMENTO_PAGO_ORIGINADO])

const STATUS = Object.freeze({ ATIVA: 'ativa', ENCERRADA: 'encerrada' })
const STATUSES = Object.freeze([STATUS.ATIVA, STATUS.ENCERRADA])

// `prazo` e' rotina (a janela acabou e outra missao foi publicada); `decisao` e' alguem
// encerrando antes da hora. Sao coisas diferentes para quem le o historico depois.
const MOTIVO_ENCERRAMENTO = Object.freeze({ PRAZO: 'prazo', DECISAO: 'decisao' })

// Em que ponto da vida a missao esta. `prazo_vencido` NAO e' `encerrada`: a janela acabou mas
// ninguem fechou ainda — e as duas pedem frases diferentes na tela.
const SITUACAO = Object.freeze({
  AGENDADA: 'agendada',           // publicada, mas a janela ainda nao comecou
  VIGENTE: 'vigente',             // valendo agora
  PRAZO_VENCIDO: 'prazo_vencido', // ativa no banco, janela terminada
  ENCERRADA: 'encerrada',
})

const TITULO_MIN = 3
const TITULO_MAX = 120
const RECOMPENSA_MAX = 300

function metricaConhecida(v) {
  return typeof v === 'string' && METRICAS.includes(v)
}

function textoLimpo(v) {
  return String(v == null ? '' : v).trim()
}

/** Numero de dinheiro com 2 casas. `null` quando nao da' para ler — nunca 0 por engano. */
function dinheiro(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100) / 100
}

/** Data ISO (YYYY-MM-DD) -> string normalizada, ou null. Nao aceita data invalida. */
function dataISO(v) {
  const s = textoLimpo(v).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  // Rejeita 2026-02-31, que o Date normaliza em silencio para marco.
  if (d.toISOString().slice(0, 10) !== s) return null
  return s
}

/** "Hoje" como data ISO. Recebe a data de fora — o modulo continua puro e testavel. */
function hojeISO(agora) {
  const d = agora instanceof Date ? agora : new Date()
  return d.toISOString().slice(0, 10)
}

// ─── Situacao ───────────────────────────────────────────────────────────────────────────

/**
 * Em que ponto da vida a missao esta.
 * Missao ausente devolve `null` — ausencia de missao e' estado legitimo (o desafio nao foi
 * ligado nesta empresa), nunca um erro e nunca uma missao vazia com alvo zero.
 */
function situacao(missao, agora) {
  if (!missao) return null
  if (missao.status === STATUS.ENCERRADA) return SITUACAO.ENCERRADA
  const hoje = hojeISO(agora)
  const inicio = dataISO(missao.inicio)
  const fim = dataISO(missao.fim)
  if (inicio && hoje < inicio) return SITUACAO.AGENDADA
  if (fim && hoje > fim) return SITUACAO.PRAZO_VENCIDO
  return SITUACAO.VIGENTE
}

/** A missao esta valendo AGORA? */
function vigente(missao, agora) {
  return situacao(missao, agora) === SITUACAO.VIGENTE
}

// ─── Progresso ──────────────────────────────────────────────────────────────────────────

/**
 * O progresso de UMA pessoa contra o alvo. Nunca recebe uma lista de pessoas, de proposito.
 *
 * `fracao` e' limitada a 1: quem passou do alvo alcancou, e uma barra de 340% nao diz nada que
 * "alcancado" ja nao diga. `faltam` nunca e' negativo pela mesma razao.
 *
 * Alvo ausente ou invalido devolve `alcancado: false` com `alvo: null` — a tela precisa poder
 * dizer "missao sem alvo legivel" em vez de comemorar uma conquista que ninguem definiu.
 */
function progresso({ valor, alvo } = {}) {
  const v = dinheiro(valor) || 0
  const a = dinheiro(alvo)
  if (a === null || a <= 0) {
    return { valor: v, alvo: null, faltam: null, fracao: 0, alcancado: false }
  }
  return {
    valor: v,
    alvo: a,
    faltam: Math.max(0, Math.round((a - v) * 100) / 100),
    fracao: Math.min(1, v / a),
    alcancado: v >= a,
  }
}

// ─── Publicar uma missao nova ───────────────────────────────────────────────────────────

const VEREDITO_PUBLICACAO = Object.freeze({
  LIBERADO: 'liberado',                       // nao ha missao ativa
  ENCERRA_A_ANTERIOR: 'encerra_a_anterior',   // ha uma ativa, mas a janela dela ja acabou
  ATIVA_EM_ANDAMENTO: 'ativa_em_andamento',   // ha uma ativa e valendo — recusa
})

/**
 * Da' para publicar uma missao nova agora?
 *
 * Com uma missao ativa cuja janela JA ACABOU, publicar a proxima encerra a anterior por `prazo`
 * na mesma transacao — e' rotina, e exigir dois cliques para uma consequencia inevitavel so'
 * produziria empresas travadas por uma missao vencida que ninguem lembrou de fechar.
 *
 * Com uma missao ativa e VALENDO, recusa. Encerrar um desafio antes da hora e' uma decisao (tem
 * gente contando com a recompensa): tem de ser um ato explicito, nao efeito colateral de
 * publicar outro.
 */
function avaliarPublicacao(missaoAtiva, agora) {
  if (!missaoAtiva) return { permitido: true, veredito: VEREDITO_PUBLICACAO.LIBERADO }
  const s = situacao(missaoAtiva, agora)
  if (s === SITUACAO.PRAZO_VENCIDO) {
    return { permitido: true, veredito: VEREDITO_PUBLICACAO.ENCERRA_A_ANTERIOR }
  }
  return { permitido: false, veredito: VEREDITO_PUBLICACAO.ATIVA_EM_ANDAMENTO }
}

// ─── Validacao da entrada ───────────────────────────────────────────────────────────────

const RECUSAS = Object.freeze({
  EQUIPE: 'equipe',
  TITULO: 'titulo',
  METRICA: 'metrica',
  ALVO: 'alvo',
  JANELA: 'janela',
  RECOMPENSA: 'recompensa',
  RECOMPENSA_VALOR: 'recompensa_valor',
})

const MENSAGEM_RECUSA = Object.freeze({
  [RECUSAS.EQUIPE]: 'Selecione a equipe desta missão.',
  [RECUSAS.TITULO]: `O título da missão precisa ter entre ${TITULO_MIN} e ${TITULO_MAX} caracteres.`,
  [RECUSAS.METRICA]: 'Métrica desconhecida.',
  [RECUSAS.ALVO]: 'O alvo precisa ser um valor maior que zero.',
  [RECUSAS.JANELA]: 'Informe início e fim válidos, com o fim igual ou depois do início.',
  [RECUSAS.RECOMPENSA]: `Descreva a recompensa (até ${RECOMPENSA_MAX} caracteres). Um desafio sem prêmio declarado é só uma meta.`,
  [RECUSAS.RECOMPENSA_VALOR]: 'Quando a recompensa tem valor em dinheiro, ele precisa ser maior que zero.',
})

/**
 * Valida o corpo da publicacao.
 *
 * A metrica tem DEFAULT (a unica que existe) para o formulario nao precisar oferecer uma escolha
 * que ainda nao e' escolha — mas um valor DESCONHECIDO e' recusado, nunca silenciosamente
 * trocado pelo padrao: quem mandou outra coisa achava que estava medindo outra coisa.
 */
function validarMissao(body = {}) {
  const b = body || {}

  const equipeId = textoLimpo(b.equipe_id)
  if (!equipeId) {
    return { ok: false, recusa: RECUSAS.EQUIPE, mensagem: MENSAGEM_RECUSA[RECUSAS.EQUIPE] }
  }

  const titulo = textoLimpo(b.titulo)
  if (titulo.length < TITULO_MIN || titulo.length > TITULO_MAX) {
    return { ok: false, recusa: RECUSAS.TITULO, mensagem: MENSAGEM_RECUSA[RECUSAS.TITULO] }
  }

  const metrica = b.metrica === undefined ? METRICA.FATURAMENTO_PAGO_ORIGINADO : b.metrica
  if (!metricaConhecida(metrica)) {
    return { ok: false, recusa: RECUSAS.METRICA, mensagem: MENSAGEM_RECUSA[RECUSAS.METRICA] }
  }

  const alvo = dinheiro(b.alvo_valor)
  if (alvo === null || alvo <= 0) {
    return { ok: false, recusa: RECUSAS.ALVO, mensagem: MENSAGEM_RECUSA[RECUSAS.ALVO] }
  }

  const inicio = dataISO(b.inicio)
  const fim = dataISO(b.fim)
  if (!inicio || !fim || fim < inicio) {
    return { ok: false, recusa: RECUSAS.JANELA, mensagem: MENSAGEM_RECUSA[RECUSAS.JANELA] }
  }

  const recompensa = textoLimpo(b.recompensa_descricao)
  if (recompensa.length < 3 || recompensa.length > RECOMPENSA_MAX) {
    return { ok: false, recusa: RECUSAS.RECOMPENSA, mensagem: MENSAGEM_RECUSA[RECUSAS.RECOMPENSA] }
  }

  // Recompensa em dinheiro e' OPCIONAL — nem todo premio e' dinheiro. Mas se veio, tem de valer
  // alguma coisa: zero seria promessa vazia com aparencia de premio.
  let recompensaValor = null
  if (b.recompensa_valor !== undefined && b.recompensa_valor !== null && b.recompensa_valor !== '') {
    recompensaValor = dinheiro(b.recompensa_valor)
    if (recompensaValor === null || recompensaValor <= 0) {
      return { ok: false, recusa: RECUSAS.RECOMPENSA_VALOR, mensagem: MENSAGEM_RECUSA[RECUSAS.RECOMPENSA_VALOR] }
    }
  }

  return {
    ok: true,
    dados: {
      titulo,
      equipe_id: equipeId,
      descricao: textoLimpo(b.descricao) || null,
      metrica,
      alvo_valor: alvo,
      inicio,
      fim,
      recompensa_descricao: recompensa,
      recompensa_valor: recompensaValor,
    },
  }
}

// ─── A BAIXA DA RECOMPENSA (Etapa 4) ────────────────────────────────────────────────────
//
// ⚠️ A REGRA QUE NAO SE NEGOCIA: **NAO SE PAGA QUEM NAO ALCANCOU.** A conquista continua sendo
// DERIVADA das vendas pagas, e a validacao dela acontece na transacao da baixa, com o numero
// lido no ato — nunca com um "alcancou: true" vindo do cliente. Aceitar isso do payload deixaria
// qualquer requisicao pagar premio a quem quisesse.
//
// Por isso `validarBaixa` NAO recebe a conquista como parametro, de proposito: ela valida a FORMA
// do que foi enviado; quem confere o FATO e' a camada de dados, que tem a soma na mao.

const RECUSAS_BAIXA = Object.freeze({
  USUARIO: 'usuario',
  VALOR: 'valor',
  REFERENCIA: 'referencia',
})

const MENSAGEM_RECUSA_BAIXA = Object.freeze({
  [RECUSAS_BAIXA.USUARIO]: 'Informe a quem o prêmio foi entregue.',
  [RECUSAS_BAIXA.VALOR]: 'Quando a recompensa é em dinheiro, o valor pago precisa ser maior que zero.',
  [RECUSAS_BAIXA.REFERENCIA]: 'A referência do pagamento é longa demais (máx. 120 caracteres).',
})

const REFERENCIA_MAX = 120

/**
 * Valida o corpo da baixa.
 *
 * `valor_pago` e' OPCIONAL: nem toda recompensa e' dinheiro (a missao aceita premio so' descrito).
 * Ausente vira `null`, que diz "saiu, e nao era dinheiro" — diferente de `0`, que seria "paguei
 * nada" com aparencia de pagamento e por isso e' RECUSADO.
 *
 * O valor pago pode DIVERGIR do declarado na missao (arredondamento, premio entregue em parte) e
 * isso nao e' erro: a divergencia fica auditavel na linha, em vez de desaparecer atras do numero
 * da missao — que continua consultavel porque a missao e' imutavel.
 */
function validarBaixa(body = {}) {
  const b = body || {}

  const usuarioId = textoLimpo(b.usuario_id)
  if (!usuarioId) {
    return { ok: false, recusa: RECUSAS_BAIXA.USUARIO, mensagem: MENSAGEM_RECUSA_BAIXA[RECUSAS_BAIXA.USUARIO] }
  }

  let valor = null
  if (b.valor_pago !== undefined && b.valor_pago !== null && b.valor_pago !== '') {
    valor = dinheiro(b.valor_pago)
    if (valor === null || valor <= 0) {
      return { ok: false, recusa: RECUSAS_BAIXA.VALOR, mensagem: MENSAGEM_RECUSA_BAIXA[RECUSAS_BAIXA.VALOR] }
    }
  }

  const referencia = textoLimpo(b.referencia)
  if (referencia.length > REFERENCIA_MAX) {
    return { ok: false, recusa: RECUSAS_BAIXA.REFERENCIA, mensagem: MENSAGEM_RECUSA_BAIXA[RECUSAS_BAIXA.REFERENCIA] }
  }

  return {
    ok: true,
    dados: {
      usuario_id: usuarioId,
      valor_pago: valor,
      referencia: referencia || null,
      observacao: textoLimpo(b.observacao) || null,
    },
  }
}

/**
 * Junta a lista de quem ALCANCOU com as baixas ja registradas.
 *
 * Existe aqui, e nao na consulta, porque sao dois fatos de naturezas diferentes (um derivado, um
 * persistido) e a juncao e' apresentacao. `pago` ausente e' `false`, nunca `null`: a pergunta
 * "ja recebeu?" sempre tem resposta quando a pessoa alcancou.
 */
function juntarBaixas(alcancaram, recompensas) {
  const pagos = new Map()
  for (const r of Array.isArray(recompensas) ? recompensas : []) {
    pagos.set(String(r.usuario_id), r)
  }
  return (Array.isArray(alcancaram) ? alcancaram : []).map((a) => {
    const r = pagos.get(String(a.usuario_id)) || null
    return {
      ...a,
      pago: !!r,
      pago_em: r ? r.pago_em : null,
      valor_pago: r ? r.valor_pago : null,
    }
  })
}

module.exports = {
  RECUSAS_BAIXA,
  MENSAGEM_RECUSA_BAIXA,
  REFERENCIA_MAX,
  validarBaixa,
  juntarBaixas,
  METRICA,
  METRICAS,
  STATUS,
  STATUSES,
  MOTIVO_ENCERRAMENTO,
  SITUACAO,
  VEREDITO_PUBLICACAO,
  RECUSAS,
  MENSAGEM_RECUSA,
  TITULO_MIN,
  TITULO_MAX,
  RECOMPENSA_MAX,
  metricaConhecida,
  dinheiro,
  dataISO,
  hojeISO,
  situacao,
  vigente,
  progresso,
  avaliarPublicacao,
  validarMissao,
}
