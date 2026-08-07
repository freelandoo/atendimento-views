// Rotulos de APRESENTACAO da classificacao de site. Camada de exibicao apenas — a REGRA
// vive no backend (`backend/src/services/site-classificacao.js`) e chega pronta na API em
// `tem_site`, `classificacao_url`, `link_original` e `situacao_site`.
//
// Por que existe: o Banco de Leads, a Prospeccao e a Central de Ligacoes exibem a mesma
// informacao. Sem um lugar comum, cada tela reinventaria o rotulo — e foi exatamente esse
// tipo de logica local que fez o projeto inteiro chamar Instagram de "site".
//
// DIVIDA TECNICA DECLARADA: backend/ e frontend/ sao pacotes npm separados e nao
// compartilham modulo. Este arquivo NAO reimplementa a classificacao (nao ha lista de
// dominios aqui, de proposito); ele so' traduz o veredito que o backend ja mandou.

/** Rotulo curto do que o link E', quando NAO e' site proprio. */
const ROTULO_LINK = Object.freeze({
  rede_social: 'rede social',
  agregador: 'agregador',
  perfil_ou_diretorio: 'perfil',
  desconhecido: 'verificar',
  sem_link: '',
  site_proprio: 'site',
})

/** Rotulo da situacao consolidada, do jeito que a tela de atendimento deve dizer. */
const ROTULO_SITUACAO = Object.freeze({
  tem_site: 'Tem site proprio',
  sem_site: 'Sem site proprio',
  nao_identificado: 'Verificar link',
})

/** Rotulo curto do link, ou '' quando nao ha' nada util a dizer. */
function rotuloLink(classificacaoUrl) {
  return ROTULO_LINK[classificacaoUrl] || ''
}

/**
 * Texto do `title`/tooltip do link que NAO e' site. Deixa explicito por que o lead
 * aparece como "sem site" mesmo tendo uma URL preenchida.
 */
function tituloLinkNaoSite(classificacaoUrl, linkOriginal) {
  const rotulo = rotuloLink(classificacaoUrl) || 'a verificar'
  return `Sem site proprio — este link e ${rotulo}: ${linkOriginal || ''}`.trim()
}

module.exports = { ROTULO_LINK, ROTULO_SITUACAO, rotuloLink, tituloLinkNaoSite }
