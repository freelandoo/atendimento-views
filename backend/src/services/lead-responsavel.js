'use strict'
// Ownership do lead — módulo PURO e dono do vocabulário. CRM em equipe, Etapa 4.
// Sem banco, sem HTTP, sem IA, sem rede.
// Ver docs/plano-execucao-crm-equipe.md §6 (Etapa 4).
//
// ─── A PERGUNTA ──────────────────────────────────────────────────────────────────────────
// Não "quem é o dono?" (isso é uma coluna), e sim **"esta pessoa pode fazer esta mudança de
// dono?"**. É o que distingue assumir um lead livre (qualquer vendedor) de tomar o lead de um
// colega (só admin) de devolver o próprio para a fila (o dono, sempre).
//
// ─── O ESTADO `null` ─────────────────────────────────────────────────────────────────────
// `responsavel_id = null` é a **fila de livres** — estado normal e de primeira classe, não erro.
// Todo lead nasce assim. Tratar "sem dono" como problema levaria a distribuir automaticamente,
// que é o que a decisão da v1 recusou (equipe de uma pessoa não precisa de round-robin).

// Ações que mudam o dono. Espelha a CHECK lead_resp_hist_acao_chk (migration 072).
// Vocabulário FECHADO: cada valor responde uma pergunta diferente de gestão ("quantos leads ele
// pegou sozinho?" ≠ "quantos foram distribuídos para ele?"), e texto livre aqui viraria um campo
// que ninguém consegue agrupar.
const ACOES = Object.freeze({
  /** Vendedor pegou um lead LIVRE (claim). */
  ASSUMIU: 'assumiu',
  /** Admin deu um lead livre a alguém. */
  ATRIBUIU: 'atribuiu',
  /** Admin trocou o dono de um lead que JÁ tinha dono. */
  TRANSFERIU: 'transferiu',
  /** Lead voltou para a fila de livres. */
  LIBEROU: 'liberou',
})

const ACOES_VALORES = Object.freeze(Object.values(ACOES))

const MOTIVOS = Object.freeze({
  OK: 'ok',
  JA_TEM_DONO: 'ja_tem_dono',
  NAO_E_O_DONO: 'nao_e_o_dono',
  SEM_PERMISSAO: 'sem_permissao',
  MESMO_DONO: 'mesmo_dono',
  SEM_LEAD: 'sem_lead',
})

/**
 * Qual AÇÃO uma mudança de dono representa.
 * Derivada do antes/depois, nunca declarada pelo chamador: um chamador que diga "transferiu"
 * quando o lead estava livre produziria histórico que contradiz as próprias colunas.
 */
function acaoDaMudanca(donoAnterior, donoNovo) {
  const antes = donoAnterior || null
  const depois = donoNovo || null
  if (antes === depois) return null            // nada mudou: não gera histórico
  if (!depois) return ACOES.LIBEROU
  if (!antes) return ACOES.ATRIBUIU            // de livre para alguém
  return ACOES.TRANSFERIU                      // trocou de mão
}

/**
 * O vendedor pode ASSUMIR este lead?
 *
 * Só o que está livre. A corrida entre dois vendedores NÃO é decidida aqui — é decidida pelo
 * banco, no `UPDATE ... WHERE responsavel_id IS NULL RETURNING`. Esta função é a checagem de
 * apresentação (habilitar o botão) e a recusa antecipada; o claim é a verdade.
 */
function avaliarAssumir(lead, usuarioId) {
  if (!lead) return { permitido: false, motivo: MOTIVOS.SEM_LEAD }
  if (!usuarioId) return { permitido: false, motivo: MOTIVOS.SEM_PERMISSAO }
  const dono = lead.responsavel_id || null
  if (!dono) return { permitido: true, motivo: MOTIVOS.OK }
  if (String(dono) === String(usuarioId)) return { permitido: false, motivo: MOTIVOS.MESMO_DONO }
  return { permitido: false, motivo: MOTIVOS.JA_TEM_DONO }
}

/**
 * O vendedor pode DEVOLVER este lead para a fila?
 * Só o próprio dono. Devolver o lead de um colega é transferência, e exige a capacidade.
 */
function avaliarLiberar(lead, usuarioId) {
  if (!lead) return { permitido: false, motivo: MOTIVOS.SEM_LEAD }
  const dono = lead.responsavel_id || null
  if (!dono) return { permitido: false, motivo: MOTIVOS.OK }   // já está livre: nada a fazer
  if (String(dono) !== String(usuarioId)) return { permitido: false, motivo: MOTIVOS.NAO_E_O_DONO }
  return { permitido: true, motivo: MOTIVOS.OK }
}

/**
 * Quem pode mexer no dono de um lead que NÃO é seu.
 *
 * Aqui não se decide por papel: recebe-se o veredito da capacidade
 * (`CAPACIDADES.LEAD_TRANSFERIR`, avaliado por `services/acesso-capacidades.js`). Dois módulos
 * puros, duas perguntas: um diz "esta pessoa pode transferir?", este diz "esta transferência faz
 * sentido?". Misturar os dois faria a matriz de permissão vazar para cá.
 */
function avaliarTransferir(lead, { usuarioId, podeTransferir, destinoId } = {}) {
  if (!lead) return { permitido: false, motivo: MOTIVOS.SEM_LEAD }
  const dono = lead.responsavel_id || null
  const destino = destinoId || null
  if (dono && destino && String(dono) === String(destino)) {
    return { permitido: false, motivo: MOTIVOS.MESMO_DONO }
  }
  // Devolver o PRÓPRIO lead para a fila não é transferência — não exige capacidade.
  if (!destino && dono && String(dono) === String(usuarioId)) {
    return { permitido: true, motivo: MOTIVOS.OK }
  }
  if (!podeTransferir) return { permitido: false, motivo: MOTIVOS.SEM_PERMISSAO }
  return { permitido: true, motivo: MOTIVOS.OK }
}

/** Rótulo curto para log/API (sem PII). */
function rotuloMotivo(motivo) {
  switch (motivo) {
    case MOTIVOS.JA_TEM_DONO: return 'este lead ja tem responsavel'
    case MOTIVOS.NAO_E_O_DONO: return 'voce nao e o responsavel por este lead'
    case MOTIVOS.SEM_PERMISSAO: return 'voce nao pode mexer no responsavel deste lead'
    case MOTIVOS.MESMO_DONO: return 'o lead ja esta com este responsavel'
    case MOTIVOS.SEM_LEAD: return 'lead nao encontrado'
    default: return ''
  }
}

// ─── Recortes de leitura ─────────────────────────────────────────────────────────────────
// Vocabulário dos filtros da tela. `todos` NÃO é "sem filtro": é uma escolha que só quem tem a
// capacidade de ver a carteira inteira pode fazer — e é a rota que decide, não a tela.
const ESCOPO = Object.freeze({
  MEUS: 'meus',
  LIVRES: 'livres',
  TODOS: 'todos',
})

/**
 * Traduz o escopo pedido no fragmento de WHERE, respeitando o que a pessoa pode ver.
 *
 * `podeVerTodos` false força o recorte a "meus + livres" **inclusive quando a tela pede `todos`**.
 * É por isso que esta função existe em vez de um `if` na rota: o recorte precisa ser o mesmo na
 * listagem, na contagem e no export, e três `if` divergiriam no primeiro ajuste (foi assim que
 * `montarFiltrosProspects` nasceu, na paginação do Banco de Leads).
 *
 * @returns {{sql: string, usaUsuario: boolean}} `usaUsuario` diz se o chamador precisa passar o
 *          id do usuário como parâmetro — devolver o SQL sem dizer isso seria um convite a erro.
 */
function sqlEscopo(escopo, { podeVerTodos = false, alias = 'p', placeholder = '$1' } = {}) {
  const a = alias ? `${alias}.` : ''
  // ⚠️ O PADRÃO DE QUEM NÃO VÊ TODOS É "MEUS + LIVRES", NUNCA "SÓ MEUS".
  //
  // Defeito corrigido (2026-09-12): o default era `MEUS`. Como a Etapa 4 deliberadamente NÃO fez
  // backfill de responsável — todo lead nasce livre —, o Banco de Leads abria **VAZIO** para todo
  // vendedor, sempre: `responsavel_id = <ele>` não casava com nenhuma linha. A carteira inteira
  // ficava inalcançável por quem existe para trabalhá-la.
  //
  // É a MESMA regra que `services/conversa-responsavel.js` já aplicava ("minhas + não
  // atribuídas"), e pelo mesmo motivo: esconder a fila SEM DONO de quem trabalha a fila não
  // organiza nada — só faz o trabalho desaparecer. `meus` continua alcançável, mas como escolha
  // EXPLÍCITA da tela, nunca como default silencioso.
  const pedido = ESCOPO[String(escopo || '').toUpperCase()] || (podeVerTodos ? ESCOPO.TODOS : null)

  if (pedido === ESCOPO.LIVRES) return { sql: `${a}responsavel_id IS NULL`, usaUsuario: false }
  if (pedido === ESCOPO.MEUS) return { sql: `${a}responsavel_id = ${placeholder}`, usaUsuario: true }
  if (pedido === ESCOPO.TODOS && podeVerTodos) return { sql: '', usaUsuario: false }
  // Pediu tudo e não pode — ou não pediu nada e não pode ver todos: o padrão do vendedor.
  // Silenciosamente NÃO: a rota devolve o escopo efetivo junto do resultado, para a tela dizer
  // exatamente o que está mostrando.
  return { sql: `(${a}responsavel_id = ${placeholder} OR ${a}responsavel_id IS NULL)`, usaUsuario: true }
}

/** O escopo que a pessoa EFETIVAMENTE recebeu (para a tela ser honesta sobre o recorte). */
function escopoEfetivo(escopo, podeVerTodos) {
  const pedido = ESCOPO[String(escopo || '').toUpperCase()] || (podeVerTodos ? ESCOPO.TODOS : null)
  if (pedido === ESCOPO.MEUS || pedido === ESCOPO.LIVRES) return pedido
  if (pedido === ESCOPO.TODOS && podeVerTodos) return ESCOPO.TODOS
  return 'meus_e_livres'
}

module.exports = {
  ACOES,
  ACOES_VALORES,
  MOTIVOS,
  ESCOPO,
  acaoDaMudanca,
  avaliarAssumir,
  avaliarLiberar,
  avaliarTransferir,
  rotuloMotivo,
  sqlEscopo,
  escopoEfetivo,
}
