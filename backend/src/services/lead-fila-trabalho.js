// @ts-check
'use strict'
// Ordem de TRABALHO do Banco de Leads — a fila de quem abre a tela para trabalhar.
//
// PROBLEMA QUE ESTE MODULO RESOLVE. A listagem ordenava por `updated_at DESC` e a tela
// reordenava por `pontos ASC` (cadastro MENOS completo primeiro). As duas juntas produziam o
// oposto do que o vendedor precisa:
//   - `updated_at` sobe a cada escrita — inclusive automatica (recoleta, disparo, script de
//     manutencao). O lead que voce ACABOU de trabalhar voltava para o topo e o nunca tocado
//     afundava ate sair da janela;
//   - "cadastro menos completo primeiro" e' a regua da AQUISICAO/curadoria, onde cadastro fraco
//     e' oportunidade (quem nao tem site compra site). No Banco de Leads o trabalho e' falar com
//     gente, e "sem telefone" vale -10 pontos — ou seja, o lead que NAO da' para contatar ia
//     matematicamente para a primeira linha.
//
// ESTE MODULO E' PURO: sem banco, sem HTTP, sem IA, sem rede. Ele nao le nada — devolve as
// EXPRESSOES SQL da classificacao e o vocabulario das faixas. A classificacao acontece UMA vez,
// dentro da consulta, e o numero devolvido vira rotulo por `faixaPorOrdem`. Nao existe uma
// segunda implementacao em JS de proposito: duas reguas divergiriam em silencio e a tela passaria
// a explicar uma ordem diferente da que mostrou.
//
// PROIBIDO comparar `faixa_trabalho` com literal fora daqui (e do `lib/` do front, que so'
// TRADUZ o veredito). Ha guarda de regressao em test/lead-fila-trabalho.test.js.

/** Aliases das fontes na consulta da listagem. Trocar a consulta sem trocar isto quebra o CASE. */
const ALIASES_PADRAO = Object.freeze({
  lead: 'prospects',
  ultimo: 'ultimo',      // LATERAL do ultimo disparo (inclui a abordagem manual pelo wa.me)
  rascunho: 'rascunho',  // LATERAL da mensagem gerada aguardando disparo (Semi)
  agenda: 'agenda',      // LATERAL do proximo agendamento
})

// ATENCAO — sao DOIS eixos diferentes, e confundi-los e' o erro facil deste modulo:
//   `ordem`  = a posicao na FILA (1 = primeiro a ser trabalhado).
//   a ORDEM DO ARRAY = a ordem de AVALIACAO do CASE (primeiro que casa vence).
// Elas sao diferentes de proposito: um lead `fechado` tambem satisfaz "ja foi abordado", e um
// lead com reuniao marcada tambem satisfaz "respondeu". Quem tem consequencia mais forte e'
// testado antes, mesmo estando no fim da fila.
const DEGRAUS = Object.freeze([
  {
    chave: 'fora_da_fila',
    ordem: 7,
    // Negocio fechado ou lead que uma pessoa recusou. Nao e' trabalho — e' historico.
    condicao: (a) => `${a.lead}.status IN ('fechado', 'rejeitado', 'nao_contatar')`,
  },
  {
    chave: 'em_espera',
    ordem: 6,
    // Compromisso com DATA (reuniao marcada) ou trava de 15 dias. Sai da fila e volta sozinho
    // quando a data chega — hoje um agendamento futuro era so' um selo azul no meio do trabalho.
    condicao: (a) => `(${a.agenda}.proximo_agendamento IS NOT NULL OR ${a.lead}.bloqueado_ate > NOW())`,
  },
  {
    chave: 'cliente_esperando',
    ordem: 1,
    // Unica faixa com alguem do outro lado esperando resposta. Testada DEPOIS de `em_espera`
    // porque `respondeu` e' grudento (nada o zera): sem isso, todo lead que ja respondeu na vida
    // ficaria no topo para sempre, inclusive os que ja viraram reuniao marcada.
    condicao: (a) => `${a.lead}.status = 'respondeu'`,
  },
  {
    chave: 'falta_contato',
    ordem: 5,
    // Sem telefone, ou com o veredito de que o disparo nao chega. E' trabalho de COMPLETAR
    // CADASTRO, nao de vender — por isso sai do topo. `tem_whatsapp` e' veredito sobre um NUMERO.
    condicao: (a) => `(NULLIF(BTRIM(COALESCE(${a.lead}.telefone, '')), '') IS NULL OR ${a.lead}.tem_whatsapp = false)`,
  },
  {
    chave: 'pronto_enviar',
    ordem: 2,
    // Rascunho ja gerado (Semi): trabalho preparado, falta um clique.
    condicao: (a) => `${a.rascunho}.mensagem_gerada IS NOT NULL`,
  },
  {
    chave: 'nunca_abordado',
    ordem: 3,
    // O "ainda nao tratado". `ultimo.rodado_em` cobre disparo automatico E abordagem manual pelo
    // wa.me — as duas gravam em prospectador.lead_disparos.
    condicao: (a) => `${a.ultimo}.rodado_em IS NULL`,
  },
  {
    chave: 'abordado_sem_resposta',
    ordem: 4,
    condicao: null, // ELSE — ja abordado e o lead nao respondeu: retomada.
  },
])

const FAIXAS = Object.freeze(
  [...DEGRAUS].sort((a, b) => a.ordem - b.ordem).map((d) => d.chave)
)

const POR_ORDEM = new Map(DEGRAUS.map((d) => [d.ordem, d.chave]))

/** Rotulo tecnico da faixa a partir do numero que o SQL devolveu. Fora da lista ⇒ null. */
function faixaPorOrdem(valor) {
  const n = Number(valor)
  return POR_ORDEM.has(n) ? POR_ORDEM.get(n) : null
}

function aliases(parcial) {
  return { ...ALIASES_PADRAO, ...(parcial || {}) }
}

/**
 * CASE que classifica o lead na fila. Devolve o NUMERO da faixa (1..7) — um so' CASE serve ao
 * `ORDER BY` e ao payload (`faixaPorOrdem` traduz), justamente para nao existirem duas verdades.
 */
function sqlFaixaTrabalho(parcial) {
  const a = aliases(parcial)
  const quando = DEGRAUS
    .filter((d) => typeof d.condicao === 'function')
    .map((d) => `        WHEN ${d.condicao(a)} THEN ${d.ordem}`)
    .join('\n')
  const senao = DEGRAUS.find((d) => d.condicao === null)
  return `CASE\n${quando}\n        ELSE ${senao.ordem}\n      END`
}

/**
 * Desempate DENTRO da faixa: quem espera ha' mais tempo vem primeiro.
 * Nao e' `updated_at` de proposito — era ele que fazia o lead recem-trabalhado voltar ao topo.
 */
function sqlDesempateTrabalho(parcial) {
  const a = aliases(parcial)
  return `COALESCE(${a.agenda}.proximo_agendamento, ${a.ultimo}.rodado_em, ${a.lead}.created_at) ASC`
}

module.exports = {
  ALIASES_PADRAO,
  FAIXAS,
  faixaPorOrdem,
  sqlFaixaTrabalho,
  sqlDesempateTrabalho,
}
