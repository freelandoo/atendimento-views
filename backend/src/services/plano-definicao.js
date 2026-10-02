// @ts-check
'use strict'

// Camada de PLANO (assinatura) — modulo PURO. Dono do vocabulario (PLANOS, STATUS, MOTIVOS), do
// mapa plano->recursos e do VEREDITO de acesso por status. Nao le banco, HTTP, IA ou rede.
//
// A tabela app.empresa_plano (migration 114) diz QUAL plano/status cada empresa tem; este modulo
// responde "este status libera acesso?" e "este plano libera este recurso?". O gate em
// src/middleware/tenant.js apenas TRADUZ o veredito em HTTP — mesma divisao de programa-aceite.js
// (regra) vs requireEmpresaAccess (traducao). PROIBIDO comparar plano/status com literal fora
// daqui: um `if (plano === 'basico')` espalhado faria o mapa divergir em silencio.

const PLANOS = Object.freeze(['minimo', 'basico', 'pro', 'legado'])
const STATUS = Object.freeze(['trial', 'ativo', 'atrasado', 'cancelado', 'expirado'])

// Recursos que cada plano LIBERA. `legado` = grandfather (acesso total das empresas que ja'
// existiam). `leads_dia`/`max_usuarios` null = sem teto. ⚠️ Os numeros sao PROVISORIOS (calibrar
// com D11/D13 da proposta) — ficam aqui, e nao no banco, porque sao regra de produto, nao estado.
const RECURSOS = Object.freeze({
  minimo: Object.freeze({ captacao: true, cruzamento: false, ia_auto: false, followup_auto: false, leads_dia: 10, max_usuarios: 1 }),
  basico: Object.freeze({ captacao: true, cruzamento: false, ia_auto: true, followup_auto: true, leads_dia: 50, max_usuarios: 1 }),
  pro: Object.freeze({ captacao: true, cruzamento: true, ia_auto: true, followup_auto: true, leads_dia: 200, max_usuarios: null }),
  legado: Object.freeze({ captacao: true, cruzamento: true, ia_auto: true, followup_auto: true, leads_dia: null, max_usuarios: null }),
})

const RECURSOS_CONHECIDOS = Object.freeze(['captacao', 'cruzamento', 'ia_auto', 'followup_auto'])

// Precos em REAIS (a ASAAS usa decimal de reais no campo `value`, nao centavos). Decididos com o
// operador: Minimo R$79, Basico R$149,90. Pro R$600 e' referencia — NAO e' assinavel ainda
// (em construcao). 'legado' nao tem preco (grandfather interno).
const PRECOS = Object.freeze({ minimo: 79.0, basico: 149.9, pro: 600.0 })
// Planos que o cliente pode ASSINAR hoje. Pro = em construcao; legado = interno.
const PLANOS_ASSINAVEIS = Object.freeze(['minimo', 'basico'])

function precoDoPlano(plano) {
  return Object.prototype.hasOwnProperty.call(PRECOS, plano) ? PRECOS[plano] : null
}
function planoAssinavel(plano) {
  return PLANOS_ASSINAVEIS.includes(plano)
}

// Motivos de veredito. So' estes TRES bloqueiam; 'atrasado' libera em modo leitura (o cliente
// ainda esta' na janela de regularizar), e trial/ativo liberam normal.
const MOTIVOS = Object.freeze({
  LIBERADO: 'liberado',
  ATRASADO: 'plano_atrasado',
  CANCELADO: 'plano_cancelado',
  EXPIRADO: 'plano_expirado',
  TRIAL_EXPIRADO: 'trial_expirado',
  STATUS_DESCONHECIDO: 'status_desconhecido',
})

const _MOTIVOS_QUE_BARRAM = new Set([MOTIVOS.CANCELADO, MOTIVOS.EXPIRADO, MOTIVOS.TRIAL_EXPIRADO, MOTIVOS.STATUS_DESCONHECIDO])

// ── Níveis e gate de MÓDULO por plano (anti-burla no backend) ─────────────────────────
// Trial < Mínimo < Básico < Pro. legado = Pro (grandfather). O gate vive no requireEmpresaAccess
// (middleware/tenant.js), que já tem req.plano — assim nenhuma rota de módulo Pro é alcançável por
// quem não paga, nem via API crua (a UI é só a experiência; a autoridade é aqui).
const NIVEL = Object.freeze({ trial: 0, minimo: 1, basico: 2, pro: 3 })

// Segmento da API (1º trecho depois de /api/empresas/:id/) → nível MÍNIMO que o libera.
// Só os módulos realmente travados entram. Os demais segmentos não são barrados por plano.
const MODULO_NIVEL = Object.freeze({
  whatsapp: NIVEL.minimo, // conectar/gerir instâncias — trial não conecta
  'central-ligacoes': NIVEL.pro,
  ligacoes: NIVEL.pro,
  campanhas: NIVEL.pro,
  roteiros: NIVEL.pro,
  equipe: NIVEL.pro,
  'equipes-comerciais': NIVEL.pro,
  comissao: NIVEL.pro,
  missoes: NIVEL.pro,
  membros: NIVEL.pro, // Contas da empresa
  relatorios: NIVEL.pro,
  'painel-comercial': NIVEL.pro,
})

// Nível efetivo do plano. null (sem linha/grandfather) e nome desconhecido = Pro (FAIL-OPEN: nunca
// trancar quem paga por ausência de dado). Trial é sempre o nível mais baixo.
function nivelDoPlano(plano) {
  if (!plano) return NIVEL.pro
  if (plano.status === 'trial') return NIVEL.trial
  const n = { minimo: NIVEL.minimo, basico: NIVEL.basico, pro: NIVEL.pro, legado: NIVEL.pro }[plano.nome]
  return n == null ? NIVEL.pro : n
}

// Este plano fica BLOQUEADO neste segmento de API? Segmento fora do mapa nunca bloqueia.
function moduloBloqueadoPorPlano(plano, segmento) {
  const necessario = MODULO_NIVEL[segmento]
  if (necessario == null) return false
  return nivelDoPlano(plano) < necessario
}

function planoValido(plano) {
  return typeof plano === 'string' && PLANOS.includes(plano)
}

function statusValido(status) {
  return typeof status === 'string' && STATUS.includes(status)
}

function recursosDoPlano(plano) {
  return RECURSOS[plano] || null
}

// "Este plano libera este recurso?" — plano ou recurso desconhecido NEGA (nunca abre porta).
function planoPermite(plano, recurso) {
  const r = RECURSOS[plano]
  if (!r) return false
  return r[recurso] === true
}

/**
 * Veredito de acesso a partir do STATUS (e do fim do trial, se houver).
 * Nao recebe empresa nem le banco: recebe os campos ja' lidos.
 * @param {{ status?: string, trialFim?: Date|string|null, agora?: Date }} args
 * @returns {{ liberado: boolean, somenteLeitura: boolean, motivo: string }}
 */
function avaliarAcesso({ status, trialFim = null, agora = new Date() } = {}) {
  if (!statusValido(status)) {
    return { liberado: false, somenteLeitura: false, motivo: MOTIVOS.STATUS_DESCONHECIDO }
  }
  if (status === 'cancelado') return { liberado: false, somenteLeitura: false, motivo: MOTIVOS.CANCELADO }
  if (status === 'expirado') return { liberado: false, somenteLeitura: false, motivo: MOTIVOS.EXPIRADO }
  if (status === 'atrasado') return { liberado: true, somenteLeitura: true, motivo: MOTIVOS.ATRASADO }
  if (status === 'trial') {
    // Trial com prazo vencido = expirado, mesmo que o job ainda nao tenha trocado o status.
    // Calcular aqui evita depender de um worker rodar pra barrar na hora certa.
    const fim = trialFim ? new Date(trialFim) : null
    if (fim && !Number.isNaN(fim.getTime()) && agora > fim) {
      return { liberado: false, somenteLeitura: false, motivo: MOTIVOS.TRIAL_EXPIRADO }
    }
    return { liberado: true, somenteLeitura: false, motivo: MOTIVOS.LIBERADO }
  }
  // 'ativo'
  return { liberado: true, somenteLeitura: false, motivo: MOTIVOS.LIBERADO }
}

// "Este motivo BARRA o acesso?" — usado pelo gate pra decidir o 403. 'atrasado' NAO barra.
function barra(motivo) {
  return _MOTIVOS_QUE_BARRAM.has(motivo)
}

module.exports = {
  PLANOS,
  STATUS,
  RECURSOS,
  RECURSOS_CONHECIDOS,
  PRECOS,
  PLANOS_ASSINAVEIS,
  MOTIVOS,
  NIVEL,
  MODULO_NIVEL,
  nivelDoPlano,
  moduloBloqueadoPorPlano,
  planoValido,
  statusValido,
  recursosDoPlano,
  planoPermite,
  precoDoPlano,
  planoAssinavel,
  avaliarAcesso,
  barra,
}
