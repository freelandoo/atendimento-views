'use strict'
// Lead parado (Operação Comercial, Etapa 3) — APRESENTAÇÃO PURA.
//
// Regra de ouro, a mesma de `lib/equipe-painel.js` e `lib/missao.js`: **quem decide vive no
// BACKEND; aqui só se traduz.** Este módulo não sabe o que conta como ação, não calcula dias e
// não decide quem está parado — recebe a contagem pronta de `GET .../equipe`.
//
// ⚠️ O TEXTO É DELIBERADAMENTE "SEM AÇÃO REGISTRADA", NUNCA "NÃO TRABALHOU". A medida enxerga
// disparo, ligação e follow-up ligado ao lead; follow-up de contato avulso (sem `prospect_id`,
// migration 062) não aparece. A marca afirma o que o sistema VIU, e a tela não pode prometer
// mais que isso — do contrário o painel vira acusação sobre trabalho que talvez tenha existido.
//
// ⚠️ ISTO NÃO É PLACAR. Não há função de ordenar, pontuar ou comparar pessoas por leads parados:
// parado é um ALERTA dentro da carteira de alguém, não uma nota. Guarda de regressão no teste.

/**
 * A frase da célula. `0` devolve string vazia — a coluna fica limpa em vez de marcar com um zero
 * quem não tem problema nenhum. Ausência de contagem também é vazio, nunca "0".
 */
function rotuloParados(quantidade) {
  const n = Number(quantidade)
  if (!Number.isFinite(n) || n <= 0) return ''
  return n === 1 ? '1 parado' : `${n} parados`
}

/**
 * O tom da marca. Cor NUNCA é o único sinal — ela acompanha o rótulo em texto, e o balão explica.
 * Não há escala de gravidade por quantidade: 12 parados numa carteira de 300 e 12 numa de 15 são
 * problemas diferentes, e o painel não tem como saber qual é qual sem virar índice.
 */
function tomParados(quantidade) {
  const n = Number(quantidade)
  return Number.isFinite(n) && n > 0 ? 'alerta' : 'neutro'
}

/**
 * O que a coluna mede, dito por extenso — obrigatório, pelo mesmo motivo do `oQueMede` das outras
 * colunas do painel: números lado a lado sugerem que são comparáveis entre si, e este é
 * SUBCONJUNTO de "Leads", não uma carga a mais.
 */
function explicacao(prazoDias) {
  const n = Number(prazoDias)
  const janela = Number.isFinite(n) && n > 0 ? n : null
  return janela
    ? `Leads desta pessoa sem nenhuma ação registrada há ${janela} dias ou mais. Já estão contados em "Leads" — é um alerta dentro da carteira, não trabalho a mais.`
    : 'Leads desta pessoa sem ação registrada na janela atual. Já estão contados em "Leads".'
}

/**
 * O detalhe do lead mais antigo. Existe porque "3 parados" e "3 parados, o mais velho há 46 dias"
 * pedem conversas diferentes com a mesma pessoa. Ausente devolve vazio — nunca se inventa idade.
 */
function detalheMaisAntigo(dias) {
  const n = Number(dias)
  if (!Number.isFinite(n) || n <= 0) return ''
  return n === 1 ? 'o mais antigo há 1 dia' : `o mais antigo há ${n} dias`
}

/**
 * A linha de aviso do painel: quanto trabalho está parado na equipe inteira.
 * Soma as PESSOAS, não ordena: quem tem mais parado não é "pior", e o painel não os classifica.
 * Devolve `null` quando não há nada parado — aviso que sempre aparece deixa de ser aviso.
 */
function resumoDaEquipe(linhas, prazoDias) {
  const lista = Array.isArray(linhas) ? linhas : []
  let total = 0
  let pessoas = 0
  for (const l of lista) {
    const n = Number(l && l.leads_parados) || 0
    if (n > 0) { total += n; pessoas += 1 }
  }
  if (total === 0) return null
  const n = Number(prazoDias)
  const janela = Number.isFinite(n) && n > 0 ? n : null
  return {
    total,
    pessoas,
    frase: `${total} ${total === 1 ? 'lead está parado' : 'leads estão parados'} com ${pessoas === 1 ? '1 pessoa' : `${pessoas} pessoas`}${janela ? `, sem ação registrada há ${janela} dias ou mais` : ''}.`,
    // A saída é humana, e a tela precisa dizer isso: o sistema não devolve nada sozinho.
    acao: 'Devolver um lead para a fila continua sendo decisão de uma pessoa, no Banco de Leads.',
  }
}

module.exports = {
  rotuloParados,
  tomParados,
  explicacao,
  detalheMaisAntigo,
  resumoDaEquipe,
}
