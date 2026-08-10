'use strict'
// Modelo PURO do FOLLOW-UP como ENTIDADE. Sem banco, sem HTTP, sem IA, sem rede.
//
// Por que esta entidade existe (e por que ela nao existia):
//   Ate aqui a "fila de Follow-ups" era DERIVADA em tempo de request de duas fontes que nao
//   se conhecem — `montarCallList` (recomendacao heuristica recalculada a cada GET, nada
//   persistido) e `vendas.followup_auto_agendamentos` (a agenda do motor de IA). Nenhuma das
//   duas tem CANAL, RESPONSAVEL, ORIGEM ou STATUS que o operador possa mexer. Consequencia
//   pratica: "concluir", "reagendar" e "cancelar" nao tinham onde ser gravados, e a proxima
//   acao decidida ao encerrar uma ligacao (`app.campanha_leads.proxima_acao`, TEXTO LIVRE)
//   era invisivel para a fila — nenhuma linha da Central de Follow-ups lia aquela tabela.
//
// Esta entidade e' a PROXIMA ACAO CONCRETA de um contato. Ela nao substitui as duas fontes
// derivadas: convive com elas na fila (decisao registrada em docs/ai-decision-log.md).
//
// IDENTIDADE DO CONTATO — `empresa_id` + `telefone_digitos`, resolvido na LEITURA.
//   Os dois mundos que este fluxo liga tem chaves diferentes e incompativeis:
//   Ligacoes usa `prospectador.prospects.id`; Mensagens usa `vendas.conversas.numero` (o JID
//   `…@s.whatsapp.net`), que e' `UNIQUE` **GLOBAL** (sql/init.sql:6), nao `UNIQUE (empresa_id,
//   numero)`. Uma FK para a conversa, alem de exigir que ela ja exista, NAO provaria mesma
//   empresa. Por isso o vinculo canonico e' o par (empresa, telefone em digitos) e a conversa
//   e' resolvida na leitura — o mesmo casamento que `followup-listing.js` ja faz entre agenda
//   e conversa (`regexp_replace(…, '[^0-9]', '', 'g')`).
//
// Vocabulario fechado de proposito: a tela nao inventa estado, e as CHECK da migration 062
// espelham exatamente estes arrays (anti-drift em test/domain-enums.test.js).

/** Por onde a proxima acao vai ser executada. Decide QUAL tela executa o item. */
const FOLLOWUP_CANAL = Object.freeze(['whatsapp', 'ligacao'])

/**
 * Estado do trabalho. `falha` existe separado de `aguardando` porque falha e' DIAGNOSTICO:
 * apresenta-la como "aguardando" esconderia que ninguem vai agir sozinho ali.
 */
const FOLLOWUP_STATUS = Object.freeze(['aguardando', 'concluido', 'cancelado', 'falha'])

/** Prioridade do FOLLOW-UP — nao confundir com o call score nem com a prioridade da campanha. */
const FOLLOWUP_PRIORIDADE = Object.freeze(['alta', 'media', 'baixa'])

/** O que gerou a proxima acao. Rastreabilidade exigida: nunca criar follow-up sem origem. */
const FOLLOWUP_ORIGEM = Object.freeze(['ligacao', 'mensagem', 'automacao', 'manual'])

const CANAIS = new Set(FOLLOWUP_CANAL)
const STATUS = new Set(FOLLOWUP_STATUS)
const PRIORIDADES = new Set(FOLLOWUP_PRIORIDADE)
const ORIGENS = new Set(FOLLOWUP_ORIGEM)

/**
 * Maquina de estados. `aguardando` e o unico estado vivo; os outros tres sao TERMINAIS.
 * Reabrir um follow-up concluido nao e' transicao: e' criar a proxima acao seguinte — senao
 * o historico do contato perderia o fato de que aquela acao chegou ao fim.
 */
const TRANSICOES = Object.freeze({
  aguardando: new Set(['concluido', 'cancelado', 'falha']),
  concluido: new Set(),
  cancelado: new Set(),
  falha: new Set(),
})

function transicaoStatusValida(de, para) {
  return !!TRANSICOES[de] && TRANSICOES[de].has(para)
}

/** Estados que ainda ocupam a fila de trabalho. */
function estaAberto(status) {
  return status === 'aguardando'
}

const LIMITE_PROXIMA_ACAO = 300
const LIMITE_NOTA = 2000
// Guardas contra erro de digitacao na data, nao regra de negocio: um follow-up para 2 anos
// a frente ou 30 dias atras quase sempre e' dedo trocado no seletor.
const MAX_DIAS_FUTURO = 730
const MAX_DIAS_PASSADO = 30
const DIA_MS = 24 * 60 * 60 * 1000

function erroEntrada(message) {
  const err = new Error(message)
  err.statusCode = 400
  return err
}

/**
 * Telefone em DIGITOS — a identidade canonica do contato dentro deste modulo.
 * Aceita JID (`5511…@s.whatsapp.net`), telefone formatado ou digitos crus, sempre devolvendo
 * a mesma coisa: so os digitos. E o que permite o follow-up nascer de uma ligacao (onde o
 * telefone vem de `prospectador.prospects.telefone`, em formato livre) e ser executado no
 * WhatsApp (onde a chave e' o JID).
 */
function normalizarTelefoneDigitos(valor) {
  const digitos = String(valor == null ? '' : valor).replace(/\D/g, '')
  if (digitos.length < 8 || digitos.length > 15) {
    throw erroEntrada('telefone invalido para follow-up (esperado de 8 a 15 digitos).')
  }
  return digitos
}

/** Igual a normalizarTelefoneDigitos, mas devolve null em vez de lancar. */
function telefoneDigitosOuNulo(valor) {
  try { return normalizarTelefoneDigitos(valor) } catch { return null }
}

function textoOpcional(valor, campo, max) {
  if (valor == null) return null
  const t = String(valor).trim()
  if (!t) return null
  if (t.length > max) throw erroEntrada(`${campo} excede o limite de ${max} caracteres.`)
  return t
}

/**
 * Data/hora do compromisso. O pedido exige DATA **E HORA** ("retomar amanha as 10h"): um
 * `DATE` nao consegue dizer isso, e era so isso que `campanha_leads.data_followup` guardava
 * na pratica (a tela mandava `<input type="date">`).
 */
function normalizarAgendadoPara(valor, agora = new Date()) {
  if (valor == null || valor === '') throw erroEntrada('data e hora da proxima acao sao obrigatorias.')
  const d = valor instanceof Date ? valor : new Date(valor)
  if (Number.isNaN(d.valueOf())) throw erroEntrada('data e hora da proxima acao invalidas.')
  const delta = d.getTime() - agora.getTime()
  if (delta > MAX_DIAS_FUTURO * DIA_MS) throw erroEntrada('data da proxima acao muito distante (limite de 2 anos).')
  if (delta < -MAX_DIAS_PASSADO * DIA_MS) throw erroEntrada('data da proxima acao muito no passado (limite de 30 dias).')
  return d
}

/**
 * Valida e normaliza a criacao de um follow-up.
 *
 * Regra de integridade do pedido — "nunca criar Follow-up sem contato, empresa e origem ou
 * contexto minimamente rastreavel": aqui isso vira obrigatoriedade de `telefone`, `origem` e
 * `proxima_acao`. A empresa nao entra neste modulo de proposito: ela e' do CHAMADOR (a rota,
 * que ja passou por `requireEmpresaAccess`), nunca do payload — aceita-la aqui abriria a
 * porta para um cliente escolher o tenant.
 */
function validarNovoFollowUp(p = {}, agora = new Date()) {
  if (!CANAIS.has(p.canal)) throw erroEntrada('canal invalido (use whatsapp ou ligacao).')
  if (!ORIGENS.has(p.origem)) throw erroEntrada('origem invalida.')
  const prioridade = p.prioridade == null || p.prioridade === '' ? 'media' : p.prioridade
  if (!PRIORIDADES.has(prioridade)) throw erroEntrada('prioridade invalida.')

  const proximaAcao = String(p.proxima_acao == null ? '' : p.proxima_acao).trim()
  if (!proximaAcao) throw erroEntrada('proxima_acao e obrigatoria.')
  if (proximaAcao.length > LIMITE_PROXIMA_ACAO) {
    throw erroEntrada(`proxima_acao excede o limite de ${LIMITE_PROXIMA_ACAO} caracteres.`)
  }

  return {
    canal: p.canal,
    origem: p.origem,
    prioridade,
    proxima_acao: proximaAcao,
    agendado_para: normalizarAgendadoPara(p.agendado_para, agora),
    telefone_digitos: normalizarTelefoneDigitos(p.telefone),
    // Referencias de contexto: todas OPCIONAIS e todas verificadas same-tenant pela camada de
    // dados. Guardar as tres quando existem e' o que torna o item auditavel ("por que esta
    // acao foi criada") sem precisar reconstruir nada depois.
    ligacao_id: p.ligacao_id || null,
    campanha_lead_id: p.campanha_lead_id || null,
    prospect_id: p.prospect_id || null,
    conversa_numero: textoOpcional(p.conversa_numero, 'conversa_numero', 120),
    responsavel_id: p.responsavel_id || null,
    observacao: textoOpcional(p.observacao, 'observacao', LIMITE_NOTA),
  }
}

/** Valida o fechamento/cancelamento/falha de um follow-up. */
function validarMudancaStatus(statusAtual, p = {}) {
  if (!STATUS.has(p.status)) throw erroEntrada('status invalido.')
  if (statusAtual === p.status) return { status: p.status, idempotente: true, nota: null }
  if (!transicaoStatusValida(statusAtual, p.status)) {
    throw erroEntrada(`Follow-up ${statusAtual} nao pode mudar para ${p.status}.`)
  }
  return {
    status: p.status,
    idempotente: false,
    nota: textoOpcional(p.nota, 'nota', LIMITE_NOTA),
  }
}

/**
 * Valida o REAGENDAMENTO. Reagendar mantem o mesmo item (mesma origem, mesmo contato, mesma
 * rastreabilidade) e so move a data/prioridade/responsavel — por isso nao e' "cancelar e
 * criar outro": o historico do contato ficaria com um cancelamento que nunca aconteceu.
 */
function validarReagendamento(statusAtual, p = {}, agora = new Date()) {
  if (!estaAberto(statusAtual)) throw erroEntrada(`Follow-up ${statusAtual} nao pode ser reagendado.`)
  const patch = {}
  if (p.agendado_para !== undefined) patch.agendado_para = normalizarAgendadoPara(p.agendado_para, agora)
  if (p.prioridade !== undefined) {
    if (!PRIORIDADES.has(p.prioridade)) throw erroEntrada('prioridade invalida.')
    patch.prioridade = p.prioridade
  }
  if (p.proxima_acao !== undefined) {
    const t = String(p.proxima_acao || '').trim()
    if (!t) throw erroEntrada('proxima_acao e obrigatoria.')
    if (t.length > LIMITE_PROXIMA_ACAO) throw erroEntrada(`proxima_acao excede o limite de ${LIMITE_PROXIMA_ACAO} caracteres.`)
    patch.proxima_acao = t
  }
  // `null` explicito = tirar o dono (voltar para "nao atribuido"), diferente de nao informar.
  if (p.responsavel_id !== undefined) patch.responsavel_id = p.responsavel_id || null
  if (!Object.keys(patch).length) throw erroEntrada('Nada para reagendar.')
  return patch
}

/**
 * Texto padrao da proxima acao, quando o operador nao escreve um. Existe para o item nunca
 * chegar a fila com a coluna "Proxima acao" vazia — uma fila de trabalho sem verbo nao diz
 * o que fazer.
 */
const ACAO_PADRAO = Object.freeze({
  whatsapp: 'Retomar por WhatsApp',
  ligacao: 'Ligar novamente',
})

function acaoPadraoDoCanal(canal) {
  return ACAO_PADRAO[canal] || null
}

/**
 * Qual tela EXECUTA o item. E a "regra_de_roteamento" do pedido, num lugar so: a fila opera,
 * mas quem executa depende do canal.
 */
const TELA_EXECUTORA = Object.freeze({
  whatsapp: 'central_mensagens',
  ligacao: 'central_ligacoes',
})

function telaExecutora(canal) {
  return TELA_EXECUTORA[canal] || null
}

module.exports = {
  FOLLOWUP_CANAL,
  FOLLOWUP_STATUS,
  FOLLOWUP_PRIORIDADE,
  FOLLOWUP_ORIGEM,
  TRANSICOES,
  LIMITE_PROXIMA_ACAO,
  transicaoStatusValida,
  estaAberto,
  normalizarTelefoneDigitos,
  telefoneDigitosOuNulo,
  normalizarAgendadoPara,
  validarNovoFollowUp,
  validarMudancaStatus,
  validarReagendamento,
  acaoPadraoDoCanal,
  telaExecutora,
}
