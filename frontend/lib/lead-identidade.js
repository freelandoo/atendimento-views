'use strict'
// Identidade HUMANA de um lead — dono unico das regras de "como se chama esta pessoa/negocio
// na tela". Modulo PURO: sem React, sem rede, sem DOM.
//
// Por que existe: as mesmas tres regras (o que e nome de verdade, como se formata telefone,
// qual e o rotulo visivel) eram necessarias na fila de Follow-ups, no painel de conversa e
// no cabecalho do painel. Duplicar significaria a mesma conversa aparecer com um nome na
// fila e outro no painel aberto a partir dela. `lib/followups-fila.js` REEXPORTA daqui —
// nao ha segunda copia, do mesmo jeito que `paginacao.js` e reexportado por ele.
//
// Regra de negocio de apresentacao, transversal: identificador tecnico do Evolution
// (`…@s.whatsapp.net`, `…@lid`) NUNCA e a informacao principal. Ele nao e nome de lead e
// tambem nao e telefone legivel.

function digitos(valor) {
  return String(valor || '').replace(/\D/g, '')
}

function texto(valor) {
  return String(valor == null ? '' : valor).trim()
}

/**
 * Nome de verdade, ou nada. O backend ja parou de usar o numero como fallback de nome;
 * este guarda protege as linhas antigas que ainda o carregam. Sem nome, quem decide o
 * fallback legivel e `rotuloLead`.
 */
function nomeDeVerdade(valor) {
  const t = texto(valor)
  if (!t || t.includes('@')) return null
  // "5511999999999" e telefone, nao nome — mesmo sem o sufixo do JID.
  if (/^\+?\d[\d\s()-]*$/.test(t)) return null
  return t
}

/** "(11) 99999-9999" a partir dos digitos (com ou sem o 55 do pais). */
function formatarTelefone(valor) {
  const d = digitos(valor).replace(/^55/, '')
  if (d.length < 10 || d.length > 11) return digitos(valor) || ''
  return `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`
}

/**
 * O que a coluna "Lead" (e o titulo do painel) mostram: o nome do negocio e, so na falta
 * dele, o telefone formatado. Nunca o JID. Vive aqui — e nao no `.tsx` — porque a
 * ordenacao e a busca da fila precisam enxergar exatamente o mesmo rotulo que o operador le.
 */
function rotuloLead(item) {
  if (!item) return ''
  return nomeDeVerdade(item.nome) || formatarTelefone(item.telefone_digitos) || texto(item.numero)
}

/**
 * O que a COLUNA "Lead" da Central de Mensagens mostra: o nome ja resolvido pelo backend
 * (`nome_exibicao`), ou VAZIO. Nunca um traco, nunca o telefone — o telefone tem coluna
 * propria, ao lado, e repeti-lo aqui seria o mesmo dado duas vezes na linha.
 *
 * A ORDEM DE PRIORIDADE NAO ESTA AQUI, de proposito: ela vive em
 * `backend/src/services/lead-nome-exibicao.js` (WhatsApp -> Google Maps -> vazio) e chega
 * pronta na resposta. Esta funcao so' protege contra linha antiga que ainda traga telefone ou
 * JID no campo. Mesmo padrao de `lib/site-rotulos.js`: o front traduz o veredito, nao o calcula.
 */
function nomeColunaLead(conversa) {
  return nomeDeVerdade(conversa && conversa.nome_exibicao) || ''
}

/**
 * Identidade de uma CONVERSA para o cabecalho do painel, a partir do que
 * `GET /conversas/:numero` devolve (`numero` = JID, `nome_exibicao` = nome resolvido,
 * `negocio` = nome do lead_profile).
 *
 * Diferenca DELIBERADA em relacao a `nomeColunaLead`: o painel e' um cabecalho, e um titulo
 * vazio deixaria o operador sem saber qual conversa abriu. Aqui o telefone formatado continua
 * valendo como identificacao de seguranca (decisao do operador, 2026-08-10) — a regra de
 * "campo vazio" vale especificamente para a coluna Lead.
 *
 * - `titulo`: o que o operador le em destaque. Nome do negocio; sem ele, o telefone.
 * - `telefone`: sempre o telefone formatado, para a linha secundaria.
 * - `temNome`: o titulo veio de um nome de verdade? A tela usa isso para NAO repetir o
 *   telefone duas vezes quando ele ja e o titulo.
 *
 * Conversa sem nome e sem telefone reconhecivel cai no ultimo recurso: os digitos do JID
 * (nunca o JID inteiro com `@s.whatsapp.net`).
 */
function identidadeConversa(conversa) {
  const numero = texto(conversa && conversa.numero)
  // `nome_exibicao` primeiro (o nome automatico do canal, ja resolvido pelo backend); o
  // `negocio` curado continua atras dele, para o painel nao PERDER nome que ja mostrava hoje.
  const nome = nomeDeVerdade(conversa && conversa.nome_exibicao)
    || nomeDeVerdade(conversa && conversa.negocio)
  const telefone = formatarTelefone(numero)
  return {
    titulo: nome || telefone || digitos(numero) || 'Contato sem identificação',
    telefone,
    temNome: Boolean(nome),
  }
}

module.exports = {
  digitos,
  texto,
  nomeDeVerdade,
  formatarTelefone,
  rotuloLead,
  nomeColunaLead,
  identidadeConversa,
}
