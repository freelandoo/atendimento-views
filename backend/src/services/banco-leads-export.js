'use strict'

// Catalogo de colunas do CSV do Banco de Leads — modulo PURO (sem banco, HTTP, IA ou rede).
//
// POR QUE ELE EXISTE: a exportacao sempre devolveu as 12 colunas fixas abaixo, e a tela passou
// a oferecer a ESCOLHA das colunas. Sem um catalogo fechado, a escolha viraria decoracao (a
// tela mostraria caixas de selecao e o arquivo sairia igual) ou, pior, o nome da coluna viria
// do cliente direto para dentro do `SELECT`.
//
// A REGRA QUE NAO SE NEGOCIA: `campo` NUNCA vem da requisicao. A query manda apenas CHAVES, e
// chave desconhecida e' IGNORADA — nunca concatenada, nunca ecoada. E' o mesmo contrato do
// `ORDEM_SQL_PROSPECTS` da listagem: mapa fechado chave->SQL, decidido no servidor.
//
// Selecao vazia cai no catalogo INTEIRO, de proposito: `?colunas=` (ou so' chaves invalidas)
// e' pedido malformado, e um CSV sem coluna nenhuma seria um arquivo que nao diz nada. Quem
// impede a selecao vazia de verdade e' a tela, antes de pedir o download.

const COLUNAS_EXPORT = Object.freeze([
  { chave: 'origem', cabecalho: 'Origem', campo: 'origem' },
  { chave: 'status', cabecalho: 'Status', campo: 'status' },
  { chave: 'nome', cabecalho: 'Nome', campo: 'nome' },
  { chave: 'telefone', cabecalho: 'Telefone', campo: 'telefone' },
  { chave: 'email', cabecalho: 'Email', campo: 'email' },
  { chave: 'instagram', cabecalho: 'Instagram', campo: 'instagram_handle' },
  { chave: 'nicho', cabecalho: 'Nicho', campo: 'nicho' },
  { chave: 'cidade', cabecalho: 'Cidade', campo: 'cidade' },
  { chave: 'site', cabecalho: 'Site', campo: 'site' },
  { chave: 'seguidores', cabecalho: 'Seguidores', campo: 'seguidores' },
  { chave: 'criado_em', cabecalho: 'Criado em', campo: 'created_at', data: true },
  { chave: 'atualizado_em', cabecalho: 'Atualizado em', campo: 'updated_at', data: true },
].map((c) => Object.freeze(c)))

const POR_CHAVE = new Map(COLUNAS_EXPORT.map((c) => [c.chave, c]))

/**
 * Traduz o parametro `colunas` (lista separada por virgula, ou array) para o recorte do
 * catalogo, preservando a ORDEM do catalogo — nao a ordem em que o cliente pediu. Duas
 * exportacoes com as mesmas colunas saem com o mesmo cabecalho, em qualquer ordem de clique.
 */
function selecionarColunasExport(param) {
  const bruto = Array.isArray(param) ? param : String(param == null ? '' : param).split(',')
  const pedidas = new Set(
    bruto.map((c) => String(c || '').trim().toLowerCase()).filter(Boolean)
  )
  if (!pedidas.size) return COLUNAS_EXPORT.slice()
  const escolhidas = COLUNAS_EXPORT.filter((c) => pedidas.has(c.chave))
  return escolhidas.length ? escolhidas : COLUNAS_EXPORT.slice()
}

/** Campos para o `SELECT`. Saem SEMPRE do catalogo — nunca da requisicao. */
function camposSqlExport(colunas) {
  return [...new Set(colunas.map((c) => POR_CHAVE.get(c.chave).campo))]
}

function cabecalhoExport(colunas) {
  return colunas.map((c) => c.cabecalho)
}

/** Uma linha do CSV, ja na ordem das colunas. Data vira ISO; ausencia vira vazio. */
function linhaExport(row, colunas) {
  return colunas.map((c) => {
    const v = row[c.campo]
    if (v === null || v === undefined) return ''
    return c.data ? new Date(v).toISOString() : v
  })
}

module.exports = {
  COLUNAS_EXPORT,
  selecionarColunasExport,
  camposSqlExport,
  cabecalhoExport,
  linhaExport,
}
