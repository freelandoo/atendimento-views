'use strict'
// Classes dos PRIMITIVOS de tela (botao, entrada, card), PURAS e testadas (node:test).
//
// Mesmo contrato de lib/pontuacao-indicador.js e lib/site-rotulos.js: o modulo decide as
// CLASSES, o componente so desenha. Duas telas nunca podem escrever o mesmo botao de dois
// jeitos — foi exatamente isso que produziu 155 botoes escritos a mao, nenhum igual ao outro
// (medido em 2026-09-18), com metade deles sem nenhum tratamento de `disabled`.
//
// Os valores abaixo NAO foram inventados: sao a geometria dominante medida no proprio codigo
// (`rounded-lg` em 111 dos botoes com raio; `px-3 py-1.5` e `px-4 py-2` como os dois tamanhos
// reais; `font-medium`). Adotar o primitivo numa tela, portanto, tende a nao mudar aparencia.
//
// Cor NUNCA e' o unico sinal: quem desabilita um controle por decisao de produto passa
// `motivoDesabilitado`, e o motivo vai para o `title` e para o rotulo acessivel.

const VARIANTES_BOTAO = Object.freeze(['primaria', 'secundaria', 'perigosa', 'neutra'])
const TAMANHOS_BOTAO = Object.freeze(['sm', 'md'])
const VARIANTE_BOTAO_PADRAO = 'secundaria'
const TAMANHO_BOTAO_PADRAO = 'md'

// Base comum. O foco visivel esta AQUI, e nao em cada tela, porque era o que mais faltava:
// a maioria dos botoes escritos a mao nao tinha anel de foco nenhum.
const BASE_BOTAO =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

const TOM_BOTAO = Object.freeze({
  primaria: 'bg-brand text-white hover:bg-brand-dark focus-visible:ring-brand/40',
  secundaria:
    'border border-line-strong bg-surface text-ink-2 hover:bg-surface-3 hover:text-ink focus-visible:ring-brand/40',
  perigosa: 'bg-estado-danger text-white hover:bg-estado-danger/90 focus-visible:ring-estado-danger/40',
  neutra: 'text-ink-2 hover:bg-surface-3 hover:text-ink focus-visible:ring-brand/40',
})

const MEDIDA_BOTAO = Object.freeze({
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
})

/** Variante/tamanho desconhecido cai no padrao em vez de quebrar a tela. */
function normalizarVarianteBotao(v) {
  return VARIANTES_BOTAO.includes(v) ? v : VARIANTE_BOTAO_PADRAO
}
function normalizarTamanhoBotao(t) {
  return TAMANHOS_BOTAO.includes(t) ? t : TAMANHO_BOTAO_PADRAO
}

function juntar(...partes) {
  return partes.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

function classesBotao(opcoes = {}) {
  const { variante, tamanho, larguraTotal = false, extra = '' } = opcoes
  return juntar(
    BASE_BOTAO,
    TOM_BOTAO[normalizarVarianteBotao(variante)],
    MEDIDA_BOTAO[normalizarTamanhoBotao(tamanho)],
    larguraTotal ? 'w-full' : '',
    extra,
  )
}

/**
 * Estado do botao. `carregando` DESABILITA de proposito: o segundo clique durante um envio e'
 * a origem classica do disparo/registro em duplicidade. `aria-busy` avisa o leitor de tela.
 */
function estadoBotao(opcoes = {}) {
  const { desabilitado = false, carregando = false, motivoDesabilitado = '' } = opcoes
  const inativo = Boolean(desabilitado || carregando)
  const motivo = typeof motivoDesabilitado === 'string' ? motivoDesabilitado.trim() : ''
  return {
    desabilitado: inativo,
    ocupado: Boolean(carregando),
    // O motivo so e' anunciado quando o controle esta realmente inativo — senao viraria um
    // tooltip permanente explicando uma restricao que nao esta valendo.
    titulo: inativo && motivo ? motivo : undefined,
  }
}

/**
 * Rotulo acessivel. Quando o botao esta carregando ou bloqueado, o estado entra no NOME
 * acessivel: quem nao ve o spinner nem a opacidade precisa receber isso em texto.
 */
function rotuloBotaoAcessivel(opcoes = {}) {
  const { rotulo = '', carregando = false, motivoDesabilitado = '' } = opcoes
  const base = String(rotulo || '').trim()
  const motivo = String(motivoDesabilitado || '').trim()
  if (carregando) return juntar(base, base ? '— em andamento' : 'Em andamento')
  if (motivo) return juntar(base, `— indisponivel: ${motivo}`)
  return base || undefined
}

// --- Entrada (input, select, textarea) -------------------------------------------------
const BASE_ENTRADA =
  'w-full rounded-lg border bg-surface px-3 py-2 text-sm text-ink outline-none transition ' +
  'placeholder:text-ink-3 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-3'

function classesEntrada(opcoes = {}) {
  const { erro = false, extra = '' } = opcoes
  return juntar(
    BASE_ENTRADA,
    erro
      ? 'border-estado-danger focus:border-estado-danger focus:ring-2 focus:ring-estado-danger/20'
      : 'border-line-strong focus:border-brand focus:ring-2 focus:ring-brand/20',
    extra,
  )
}

// --- Card ------------------------------------------------------------------------------
// `p-5` e' a medida real dos cards do produto (medida, nao arbitrada). `compacto` existe para
// card dentro de listagem densa, onde 20px de respiro come' linha util.
function classesCard(opcoes = {}) {
  const { compacto = false, semPadding = false, extra = '' } = opcoes
  return juntar(
    'rounded-lg border border-line bg-surface shadow-card',
    semPadding ? '' : compacto ? 'p-4' : 'p-5',
    extra,
  )
}

// --- Superficie flutuante (modal no computador, folha inferior no celular) --------------
// UMA superficie para os dois tamanhos de tela, de proposito. Medicao de 2026-09-19: os tres
// modais do Banco de Leads eram `fixed inset-0 flex items-center justify-center p-4` com
// `max-h-[85vh]`/`[92vh]` — ou seja, um retangulo centrado com o botao de fechar no canto
// superior DIREITO, que no telefone fica fora do alcance do polegar. No celular a folha sobe
// de baixo (onde a mao ja esta) e a acao primaria fica presa no rodape; a partir de `sm` ela
// volta a ser o modal centrado de sempre.
//
// `dvh` e nao `vh`: com `vh` a barra do navegador do celular corta o rodape da folha, que e'
// exatamente onde mora a acao principal.
const TAMANHOS_FOLHA = Object.freeze(['sm', 'md', 'lg', 'xl'])
const TAMANHO_FOLHA_PADRAO = 'md'

const LARGURA_FOLHA = Object.freeze({
  sm: 'sm:max-w-md',
  md: 'sm:max-w-2xl',
  lg: 'sm:max-w-4xl',
  xl: 'sm:max-w-5xl',
})

function normalizarTamanhoFolha(t) {
  return TAMANHOS_FOLHA.includes(t) ? t : TAMANHO_FOLHA_PADRAO
}

/**
 * Fundo escurecido. `items-end` no celular e `items-center` a partir de `sm` e' a chave.
 *
 * `lateral: true` ancora a superficie na DIREITA e a deixa da altura inteira — e' a ficha do
 * lead, que precisa preservar o contexto da lista atras dela. No CELULAR nada muda: continua
 * sendo folha inferior, porque la nao existe "ao lado".
 */
function classesFundoFolha(opcoes = {}) {
  const { extra = '', lateral = false } = opcoes
  return juntar(
    'fixed inset-0 z-50 flex items-end justify-center bg-ink/50',
    lateral ? 'sm:items-stretch sm:justify-end sm:p-0' : 'sm:items-center sm:p-4',
    extra,
  )
}

/**
 * A superficie em si. Raio so no topo enquanto e' folha; raio inteiro quando vira modal.
 *
 * `lateral: true` = painel colado na borda direita, altura inteira e SEM raio (ele encosta em
 * tres bordas da janela; arredondar ali deixa cantos de fundo escuro que parecem defeito).
 * `tamanho` e' ignorado no modo lateral: a largura de um painel lateral e' a mesma sempre —
 * variar de 448px a 1024px conforme a tela faria a ficha cobrir a lista que ela existe para
 * preservar.
 */
function classesFolha(opcoes = {}) {
  const { tamanho, extra = '', lateral = false } = opcoes
  if (lateral) {
    return juntar(
      'flex w-full min-h-0 flex-col overflow-hidden bg-surface shadow-xl',
      'max-h-[92dvh] rounded-t-lg',
      'sm:h-full sm:max-h-none sm:w-[560px] sm:max-w-[92vw] sm:rounded-none sm:border-l sm:border-line',
      extra,
    )
  }
  return juntar(
    'flex w-full min-h-0 flex-col overflow-hidden bg-surface shadow-xl',
    'max-h-[92dvh] rounded-t-lg',
    'sm:max-h-[90dvh] sm:rounded-lg',
    LARGURA_FOLHA[normalizarTamanhoFolha(tamanho)],
    extra,
  )
}

module.exports = {
  VARIANTES_BOTAO,
  TAMANHOS_BOTAO,
  VARIANTE_BOTAO_PADRAO,
  TAMANHO_BOTAO_PADRAO,
  normalizarVarianteBotao,
  normalizarTamanhoBotao,
  classesBotao,
  estadoBotao,
  rotuloBotaoAcessivel,
  classesEntrada,
  classesCard,
  TAMANHOS_FOLHA,
  TAMANHO_FOLHA_PADRAO,
  normalizarTamanhoFolha,
  classesFundoFolha,
  classesFolha,
}
