// @ts-check
'use strict'
// STATUS OPERACIONAL do lead no Banco de Leads — "em que ponto da abordagem este lead esta'?".
//
// ══ POR QUE ESTE MODULO NASCEU ══
// A cascata vivia em `frontend/app/dashboard/banco-leads/page.tsx` (`statusOperacionalDoLead`),
// contra a regra do AGENTS.md de que **a tela so' TRADUZ o veredito que a API ja' resolveu**.
// Enquanto a listagem cabia numa janela de 300 isso passava; com paginacao de SERVIDOR (R7) o
// filtro por status precisa acontecer DENTRO da consulta, e traduzir a cascata para SQL deixando
// a copia do front no lugar criaria duas reguas para a mesma pergunta — que divergiriam no
// primeiro ajuste, com a tela explicando um status diferente do que filtrou.
//
// ESTE MODULO E' PURO: sem banco, sem HTTP, sem IA, sem rede. Ele nao le nada — devolve as
// EXPRESSOES SQL e o vocabulario. Mesmo contrato de `lead-fila-trabalho.js`.
//
// ⚠️ SAO DOIS EIXOS, e confundi-los e' o erro facil deste modulo:
//   * a ORDEM DO ARRAY e' a ordem de AVALIACAO da cascata (o primeiro que casa vence);
//   * `ordem` e' a posicao de EXIBICAO/ordenacao (o selo na coluna "Status").
// Elas sao diferentes de proposito: `descartado` e' avaliado em SEGUNDO (a consequencia mais
// forte depois de `fechado`) e aparece por ULTIMO na lista. Um lead com reuniao marcada tambem
// satisfaz "respondeu"; sem testar `reuniao` antes, ele nunca sairia de "Respondido".
//
// PROIBIDO comparar status operacional com literal fora daqui (e do `lib/` do front, que so'
// traduz). Ha guarda de regressao em test/lead-status-operacional.test.js.

// ⚠️ O modulo NAO fala em alias, e sim em EXPRESSAO. Foi uma escolha forcada pelo uso real: a
// LISTAGEM tem os LATERAL (`agenda`, `status_op`) e pode referencia-los por alias, mas a
// CONTAGEM e o EXPORT rodam `FROM prospectador.prospects` puro — sem LATERAL nenhum. Se o
// modulo emitisse alias, o mesmo filtro que funciona na lista quebraria na contagem, e a tela
// mostraria um total que nao corresponde ao que ela lista.
//
// Quem chama escolhe: alias (barato, na listagem) ou subconsulta autonoma (na contagem). As duas
// formas passam pelo MESMO CASE — ha teste de que produzem os mesmos degraus.
const EXPRESSOES_PADRAO = Object.freeze({
  status: 'prospects.status',               // coluna do proprio lead
  proximoAgendamento: 'agenda.proximo_agendamento',   // LATERAL da listagem
  ultimaAcao: 'status_op.ultimo_status_acao',         // LATERAL da listagem
})

// A cascata, NA ORDEM DE AVALIACAO. `condicao: null` e' o ELSE.
const DEGRAUS = Object.freeze([
  {
    chave: 'fechado',
    ordem: 70,
    condicao: (e) => `${e.status} = 'fechado'`,
  },
  {
    // Recusa de uma PESSOA vence qualquer sinal de atividade: nao se trabalha quem foi recusado.
    chave: 'descartado',
    ordem: 80,
    condicao: (e) =>
      `(${e.status} IN ('rejeitado', 'nao_contatar') OR ${e.ultimaAcao} = 'lead_descartado')`,
  },
  {
    // Proposta e' a ultima acao registrada e vem ANTES da reuniao: a proposta costuma sair depois
    // da reuniao, e a reuniao marcada continua visivel na coluna de agenda.
    chave: 'proposta',
    ordem: 65,
    condicao: (e) => `${e.ultimaAcao} = 'lead_proposta_enviada'`,
  },
  {
    // Follow-up registrado vem depois da proposta e antes da reuniao — mesma ordem da tela.
    chave: 'follow_up',
    ordem: 45,
    condicao: (e) => `${e.ultimaAcao} = 'lead_follow_up_criado'`,
  },
  {
    chave: 'reuniao',
    ordem: 60,
    condicao: (e) =>
      `(${e.proximoAgendamento} IS NOT NULL OR ${e.ultimaAcao} = 'lead_reuniao_agendada')`,
  },
  {
    chave: 'ligacao_feita',
    ordem: 40,
    condicao: (e) => `${e.ultimaAcao} = 'lead_ligacao_realizada'`,
  },
  {
    chave: 'respondido',
    ordem: 50,
    condicao: (e) => `${e.status} = 'respondeu'`,
  },
  {
    // `abordagem_manual_declarada` e' AUTODECLARADA (migration 073) — conta como contato, e a
    // tela e' obrigada a rotula-la como tal. Aqui as duas origens levam ao mesmo degrau.
    chave: 'contatado',
    ordem: 30,
    condicao: (e) =>
      `(${e.status} = 'enviado' OR ${e.ultimaAcao} = 'abordagem_manual_declarada')`,
  },
  {
    chave: 'marcado',
    ordem: 20,
    condicao: (e) => `${e.status} = 'aprovado'`,
  },
  {
    chave: 'sem_contato',
    ordem: 10,
    condicao: null, // ELSE — nenhuma abordagem registrada.
  },
])

/** Vocabulario, na ordem de EXIBICAO (nao na de avaliacao). */
const STATUS_OPERACIONAL = Object.freeze(
  [...DEGRAUS].sort((a, b) => a.ordem - b.ordem).map((d) => d.chave)
)

const POR_ORDEM = new Map(DEGRAUS.map((d) => [d.ordem, d.chave]))
const POR_CHAVE = new Map(DEGRAUS.map((d) => [d.chave, d.ordem]))

/** Rotulo tecnico a partir do numero que o SQL devolveu. Fora da lista ⇒ null. */
function statusPorOrdem(valor) {
  const n = Number(valor)
  return POR_ORDEM.has(n) ? POR_ORDEM.get(n) : null
}

/** Numero de um status conhecido. Desconhecido ⇒ null (nunca um default silencioso). */
function ordemDoStatus(chave) {
  const c = String(chave || '')
  return POR_CHAVE.has(c) ? POR_CHAVE.get(c) : null
}

function expressoes(parcial) {
  return { ...EXPRESSOES_PADRAO, ...(parcial || {}) }
}

/**
 * CASE que classifica o lead. Devolve o NUMERO de exibicao — um so' CASE serve ao `ORDER BY`,
 * ao filtro e ao payload (`statusPorOrdem` traduz), para nao existirem duas verdades.
 * @param {Record<string,string>} [parcial] expressoes SQL (ver EXPRESSOES_PADRAO)
 */
function sqlStatusOperacional(parcial) {
  const e = expressoes(parcial)
  const quando = DEGRAUS
    .filter((d) => typeof d.condicao === 'function')
    .map((d) => `        WHEN ${d.condicao(e)} THEN ${d.ordem}`)
    .join('\n')
  const senao = DEGRAUS.find((d) => d.condicao === null)
  return `CASE\n${quando}\n        ELSE ${senao.ordem}\n      END`
}

/**
 * Predicado do FILTRO por status. Status desconhecido devolve `null` e a clausula NAO entra —
 * nunca uma lista vazia, que esvaziaria a carteira em vez de ignorar o filtro (mesma disciplina
 * de `origensDoFiltro`, em services/lead-origem.js).
 * @param {string} chave
 * @param {Record<string,string>} [parcial] expressoes SQL (ver EXPRESSOES_PADRAO)
 */
function sqlFiltroStatusOperacional(chave, parcial) {
  const ordem = ordemDoStatus(chave)
  if (ordem === null) return null
  return `(${sqlStatusOperacional(parcial)}) = ${ordem}`
}

module.exports = {
  EXPRESSOES_PADRAO,
  STATUS_OPERACIONAL,
  statusPorOrdem,
  ordemDoStatus,
  sqlStatusOperacional,
  sqlFiltroStatusOperacional,
}
