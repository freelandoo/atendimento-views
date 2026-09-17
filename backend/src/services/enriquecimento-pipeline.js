'use strict'
// Pipeline de enriquecimento do lead — o que rodar, quando, e o que fazer quando falha.
//
// MODULO PURO: sem banco, sem HTTP, sem IA, sem rede. Ele nao executa etapa nenhuma — recebe o
// estado do lead e devolve o VEREDITO. Quem tem o banco e a rede na mao aplica
// (`services/enriquecimento-worker.js`).
//
// A PERGUNTA CENTRAL nao e' "o que falta neste lead?", e sim "esta chamada PAGA (ou esta cota)
// se justifica agora?". A primeira convida a rodar tudo para todo mundo; a segunda e' o que
// mantem 4.760 creditos de pe'.
//
// ── A REGRA QUE NAO SE NEGOCIA ──────────────────────────────────────────────────────────────
// FALHA DA FONTE NUNCA VIRA VEREDITO SOBRE O LEAD.
//
// Medido em 2026-09-17: uma fonte de descoberta invalida que vira lista vazia marcaria cada
// lead como "nao tem Instagram" sem ninguem ter olhado — um veredito falso, gravado em massa,
// que depois ninguem saberia distinguir de uma busca honesta que nao achou nada. Por isso
// `nenhum_resultado` so' pode ser escrito quando a fonte RESPONDEU; cota/teto esgotado, token
// invalido e timeout voltam para a fila e nao decidem nada.
//
// ── SAO DUAS MOEDAS ─────────────────────────────────────────────────────────────────────────
// Descoberta gasta consulta SERP da Bright Data. Perfil gasta CREDITO de dataset da Bright Data
// (conta unica, compartilhada por todos os tenants). Elas se esgotam em ritmos diferentes — por
// isso sao contadas e travadas separadas.

const { CONFIANCA, perfilConfirmado } = require('./instagram-perfil')

/** As duas etapas. Nao ha' etapa de POSTS — a sonda mostrou que o perfil ja' os traz. */
const ETAPA = Object.freeze({
  DESCOBERTA: 'instagram_descoberta',
  PERFIL: 'instagram_perfil',
})
const ETAPAS = Object.freeze([ETAPA.DESCOBERTA, ETAPA.PERFIL])

/**
 * `pulado` NAO e' `concluido`. "Nao precisei rodar" e "rodei e veio vazio" tem o mesmo efeito na
 * tela e significados opostos na conta de creditos — sem essa diferenca nao da' para auditar
 * depois quanta economia a cascata realmente produziu.
 */
const STATUS = Object.freeze({
  PENDENTE: 'pendente',
  PROCESSANDO: 'processando',
  CONCLUIDO: 'concluido',
  FALHOU: 'falhou',
  REVISAO_HUMANA: 'revisao_humana',
  PULADO: 'pulado',
})
const STATUSES = Object.freeze(Object.values(STATUS))

/** Vocabulario FECHADO — espelha o CHECK da migration 082 (ha' teste anti-drift). */
const MOTIVO = Object.freeze({
  SEM_NOME: 'sem_nome',
  JA_CONFIRMADO: 'ja_confirmado',
  CACHE_RECENTE: 'cache_recente',
  SEM_HANDLE: 'sem_handle',
  NENHUM_RESULTADO: 'nenhum_resultado',
  PROVA_INSUFICIENTE: 'prova_insuficiente',
  PERFIL_INEXISTENTE: 'perfil_inexistente',
  CONTRATO_DESCONHECIDO: 'contrato_desconhecido',
  COTA_ESGOTADA: 'cota_esgotada',
  ORCAMENTO: 'orcamento',
  FONTE_INDISPONIVEL: 'fonte_indisponivel',
  ERRO_TRANSITORIO: 'erro_transitorio',
  TENTATIVAS_ESGOTADAS: 'tentativas_esgotadas',
  DECIDIDO_POR_PESSOA: 'decidido_por_pessoa',
})
const MOTIVOS = Object.freeze(Object.values(MOTIVO))

// Backoff e lease copiados de `app.conversao_eventos` (ledger da Meta) — padrao ja' validado
// neste repositorio. Nao inventar um segundo esquema de retry foi decisao consciente.
const BACKOFF_MIN = Object.freeze([1, 5, 25, 120, 360, 720])
const MAX_TENTATIVAS = 6
const LEASE_MIN = 10

/**
 * Quantos dias um perfil raspado continua valendo.
 *
 * Reprocessar a carteira nao pode repagar o que ja' foi pago. 30 dias e' o default da §11.E da
 * analise; fica como PARAMETRO e nao como env porque e' regra de negocio por operacao — uma env
 * seria global para todos os tenants.
 */
const TTL_PERFIL_DIAS = 30

/**
 * Teto diario de consultas Bright Data SERP.
 *
 * Existe porque uma unica busca avulsa de 200 leads pode precisar de ~176 consultas. Sem teto,
 * a primeira busca do dia pode consumir a janela operacional da descoberta e as seguintes
 * receberiam erro — que, pela regra acima, nem sequer viraria veredito. `0` desliga a trava.
 */
function tetoDiarioConsultas() {
  const n = Number.parseInt(process.env.INSTAGRAM_SERP_TETO_DIARIO, 10)
  if (Number.isFinite(n) && n >= 0) return n
  const legado = Number.parseInt(process.env.INSTAGRAM_CSE_TETO_DIARIO, 10)
  if (Number.isFinite(legado) && legado >= 0) return legado
  return 90
}

function texto(valor) {
  return String(valor == null ? '' : valor).trim()
}

function diasDesde(data, agora) {
  if (!data) return null
  const t = data instanceof Date ? data.getTime() : Date.parse(String(data))
  if (!Number.isFinite(t)) return null
  return Math.floor((agora.getTime() - t) / 86400000)
}

/** A cascata. `null` = fim do pipeline. */
function proximaEtapa(etapa) {
  if (etapa === ETAPA.DESCOBERTA) return ETAPA.PERFIL
  return null
}

/**
 * ETAPA 1 — DESCOBERTA: vale gastar uma consulta com este lead?
 *
 * O caso mais barato ja' foi resolvido antes de chegar aqui: quando o Instagram veio no link do
 * Google Meu Negocio, a propria coleta grava o handle como CONFIRMADO (o dono escreveu aquele
 * link na ficha dele — nao ha' o que provar). Medido em 2026-09-16: 11,9% dos leads. Esses
 * saltam a etapa inteira e custam zero nas duas moedas.
 */
function decidirDescoberta(lead = {}) {
  if (perfilConfirmado(lead)) {
    return { rodar: false, status: STATUS.PULADO, motivo: MOTIVO.JA_CONFIRMADO }
  }
  // Sem nome nao ha' o que procurar, e uma busca por cidade+nicho devolveria o mercado inteiro.
  if (!texto(lead.nome)) {
    return { rodar: false, status: STATUS.PULADO, motivo: MOTIVO.SEM_NOME }
  }
  // Candidato ja' achado: a busca ja' foi feita, e refaze-la gastaria cota para reencontrar o
  // mesmo palpite. Quem resolve um candidato e' o perfil (etapa 2) ou uma pessoa.
  if (texto(lead.instagram_candidato)) {
    return { rodar: false, status: STATUS.PULADO, motivo: MOTIVO.JA_CONFIRMADO }
  }
  return { rodar: true, status: STATUS.PROCESSANDO, motivo: null }
}

/**
 * ETAPA 2 — PERFIL: vale gastar um credito com este lead?
 *
 * RODA TAMBEM PARA CANDIDATO, e isso e' contra-intuitivo de proposito (§5.3 da analise). O
 * registro do perfil traz `biography` e `external_urls` — telefone e site, que sao justamente as
 * duas provas FORTES que a busca por texto nao tinha. Um credito que converte "incerto" em
 * "confirmado" ou "descartado" sem ocupar uma pessoa e' bom negocio; a ordem ingenua (revisar
 * primeiro, raspar depois) gasta o recurso mais caro que existe, que e' atencao humana.
 */
function decidirPerfil(lead = {}, { agora = new Date(), ttlDias = TTL_PERFIL_DIAS } = {}) {
  const handle = texto(lead.instagram_handle) || texto(lead.instagram_candidato)
  if (!handle) {
    return { rodar: false, status: STATUS.PULADO, motivo: MOTIVO.SEM_HANDLE, handle: null }
  }
  const dias = diasDesde(lead.instagram_perfil_em, agora)
  if (dias !== null && dias < ttlDias) {
    return { rodar: false, status: STATUS.PULADO, motivo: MOTIVO.CACHE_RECENTE, handle }
  }
  return { rodar: true, status: STATUS.PROCESSANDO, motivo: null, handle }
}

/**
 * Este erro merece nova tentativa?
 *
 * Erro PERMANENTE nao volta para a fila: seria pagar de novo pela mesma recusa. Erro da FONTE
 * (token invalido, dataset desligado) tambem nao e' retry util no mesmo minuto, mas continua
 * pendente — a correcao e' humana (trocar a chave), e o trabalho precisa estar esperando quando
 * ela chegar, nunca marcado como decidido.
 */
function classificarErro(erro = {}) {
  const status = Number(erro.statusCode || erro.status || 0)
  const codigo = texto(erro.code)
  if (codigo === 'BRIGHTDATA_OFF' || codigo === 'DATASET_OFF' || status === 401 || status === 403) {
    return { tipo: 'fonte', motivo: MOTIVO.FONTE_INDISPONIVEL, retentar: false }
  }
  if (status === 429) return { tipo: 'cota', motivo: MOTIVO.COTA_ESGOTADA, retentar: false }
  if (status >= 500 || status === 408 || codigo === 'ETIMEDOUT' || codigo === 'ECONNRESET'
      || codigo === 'ENOTFOUND' || codigo === 'ABORT_ERR' || !status) {
    return { tipo: 'transitorio', motivo: MOTIVO.ERRO_TRANSITORIO, retentar: true }
  }
  // 4xx que nao e' cota nem autorizacao: o pedido esta' errado. Insistir queima recurso.
  return { tipo: 'permanente', motivo: MOTIVO.FONTE_INDISPONIVEL, retentar: false }
}

/**
 * Quando tentar de novo.
 *
 * `tentativas` e' o numero de tentativas JA' feitas (incluindo a que acabou de falhar). Passado o
 * teto, a etapa vira `falhou` com motivo — para de tentar, mas fica auditavel.
 */
function agendarRetry({ tentativas = 0, agora = new Date(), motivo = MOTIVO.ERRO_TRANSITORIO } = {}) {
  const feitas = Math.max(0, Number(tentativas) || 0)
  if (feitas >= MAX_TENTATIVAS) {
    return { status: STATUS.FALHOU, proximaTentativaEm: null, motivo: MOTIVO.TENTATIVAS_ESGOTADAS }
  }
  const minutos = BACKOFF_MIN[Math.min(feitas, BACKOFF_MIN.length - 1)]
  return {
    status: STATUS.PENDENTE,
    proximaTentativaEm: new Date(agora.getTime() + minutos * 60000),
    motivo,
  }
}

/**
 * Adiar sem consumir tentativa.
 *
 * Cota do dia esgotada e orcamento barrado NAO sao falhas do lead: ele nem chegou a ser
 * consultado. Contar tentativa aqui gastaria o teto de 6 em dias de cota cheia e o lead morreria
 * como `tentativas_esgotadas` sem nunca ter sido buscado.
 */
function adiar({ motivo, agora = new Date(), minutos = 60 } = {}) {
  return {
    status: STATUS.PENDENTE,
    proximaTentativaEm: new Date(agora.getTime() + Math.max(1, minutos) * 60000),
    motivo: motivo || MOTIVO.COTA_ESGOTADA,
    consomeTentativa: false,
  }
}

function leaseAte(agora = new Date()) {
  return new Date(agora.getTime() + LEASE_MIN * 60000)
}

/**
 * A atividade medida deste lead pode ser tratada como verdade sobre o NEGOCIO?
 *
 * So' quando o perfil foi PROVADO. Num candidato, a atividade e' verdade sobre um perfil que
 * talvez nem seja dele — serve para priorizar a revisao humana (vale a pena olhar um perfil
 * ativo antes de um abandonado), nunca para pontuar o lead. E' a regra que o operador declarou
 * em 2026-09-16: "atividade de candidato apenas como sinal fraco, nunca como verdade definitiva".
 */
function atividadeConfiavel(lead = {}) {
  return lead.instagram_confianca === CONFIANCA.CONFIRMADO
}

module.exports = {
  ETAPA,
  ETAPAS,
  STATUS,
  STATUSES,
  MOTIVO,
  MOTIVOS,
  BACKOFF_MIN,
  MAX_TENTATIVAS,
  LEASE_MIN,
  TTL_PERFIL_DIAS,
  tetoDiarioConsultas,
  proximaEtapa,
  decidirDescoberta,
  decidirPerfil,
  classificarErro,
  agendarRetry,
  adiar,
  leaseAte,
  atividadeConfiavel,
}
