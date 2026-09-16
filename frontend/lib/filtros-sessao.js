'use strict'
// Recorte de trabalho que sobrevive ao F5 — e só a ele.
//
// O problema real: o operador escolhe a aba, o mercado, a cidade e digita uma busca, atualiza a
// página e volta para o começo. As telas já guardavam PREFERÊNCIA (colunas, filtros avançados,
// itens por página) no `localStorage`, de propósito e permanentemente — isso não muda aqui.
// O que se perdia é outra coisa: onde a pessoa ESTAVA agora.
//
// Três escolhas que definem o módulo:
//
// 1. `sessionStorage`, nunca `localStorage`. O recorte morre com a aba, porque ele descreve uma
//    sessão de trabalho, não um gosto do operador. Reabrir o sistema amanhã e reencontrar a
//    busca por "energia solar" de ontem seria o defeito oposto: trabalhar dentro de um recorte
//    que ninguém escolheu hoje.
// 2. Validade de 30 minutos, RENOVADA a cada uso (leitura ou escrita). Enquanto a pessoa está
//    ali, o recorte acompanha; parada além da janela, ele some sozinho. Nada disso vai a banco.
// 3. Escopo por EMPRESA. Filtro de uma empresa reaparecendo em outra faria o operador olhar uma
//    lista recortada por um critério que ele não escolheu — e pior, achar que é a lista inteira.
//
// O módulo NUNCA lança: navegador em modo privado, storage cheio ou bloqueado se comportam como
// "não há cache". Uma tela de trabalho não pode deixar de abrir porque o cache falhou.

const JANELA_MS = 30 * 60 * 1000
const VERSAO = 1

/**
 * A chave é versionada e escopada por empresa. Trocar o formato do que se guarda é trocar a
 * VERSAO: o recorte antigo simplesmente deixa de ser lido, em vez de hidratar a tela com um
 * formato que ela já não entende.
 */
function chaveFiltros(tela, empresaId) {
  return `recorte:v${VERSAO}:${tela}:${empresaId || 'sem-empresa'}`
}

/** PURA. O envelope gravado: o valor mais a hora em que ele deixa de valer. */
function empacotar(valor, agora = Date.now()) {
  return { v: VERSAO, expira_em: agora + JANELA_MS, valor }
}

/**
 * PURA. Devolve o recorte guardado, ou `null` quando não há nada aproveitável.
 *
 * `null` cobre de propósito todos os casos ruins — ausente, JSON quebrado, versão antiga,
 * vencido, valor que não é objeto. Quem chama tem um caminho só: não havendo recorte, a tela
 * abre no padrão dela.
 */
function desempacotar(bruto, agora = Date.now()) {
  if (!bruto) return null
  let env = null
  try { env = JSON.parse(bruto) } catch { return null }
  if (!env || typeof env !== 'object') return null
  if (env.v !== VERSAO) return null
  if (typeof env.expira_em !== 'number' || agora > env.expira_em) return null
  if (!env.valor || typeof env.valor !== 'object' || Array.isArray(env.valor)) return null
  return env.valor
}

function storage() {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null
    return window.sessionStorage
  } catch { return null }
}

/**
 * Lê o recorte e RENOVA a validade. Ler é sinal de que a pessoa continua ali — é exatamente o
 * "vai atualizando enquanto ela estiver ativa".
 */
function lerFiltros(tela, empresaId, agora = Date.now()) {
  const st = storage()
  if (!st) return null
  const chave = chaveFiltros(tela, empresaId)
  let valor = null
  try { valor = desempacotar(st.getItem(chave), agora) } catch { return null }
  if (!valor) {
    try { st.removeItem(chave) } catch { /* nada a fazer */ }
    return null
  }
  try { st.setItem(chave, JSON.stringify(empacotar(valor, agora))) } catch { /* segue com o valor lido */ }
  return valor
}

function gravarFiltros(tela, empresaId, valor, agora = Date.now()) {
  const st = storage()
  if (!st) return
  try { st.setItem(chaveFiltros(tela, empresaId), JSON.stringify(empacotar(valor, agora))) } catch { /* cheio/privado */ }
}

function esquecerFiltros(tela, empresaId) {
  const st = storage()
  if (!st) return
  try { st.removeItem(chaveFiltros(tela, empresaId)) } catch { /* nada a fazer */ }
}

/**
 * PURA. Aplica sobre o padrão da tela só os campos que vieram no recorte E que a tela declara
 * conhecer. É o que impede um recorte antigo (ou adulterado à mão no storage) de injetar chave
 * que a tela não espera, e o que mantém o tipo de cada campo: string continua string, número
 * continua número, booleano continua booleano.
 */
function aplicarRecorte(padrao, recorte) {
  if (!recorte || typeof recorte !== 'object') return { ...padrao }
  const saida = { ...padrao }
  for (const chave of Object.keys(padrao)) {
    const novo = recorte[chave]
    if (novo === undefined || novo === null) continue
    if (typeof novo !== typeof padrao[chave]) continue
    saida[chave] = novo
  }
  return saida
}

module.exports = {
  JANELA_MS,
  VERSAO,
  chaveFiltros,
  empacotar,
  desempacotar,
  lerFiltros,
  gravarFiltros,
  esquecerFiltros,
  aplicarRecorte,
}
