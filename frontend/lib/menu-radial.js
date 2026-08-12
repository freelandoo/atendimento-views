'use strict'
// Regras PURAS do menu radial de ações secundárias — dono único da geometria de zonas
// (cima/direita/esquerda/centro). Mesmo contrato de `lib/pontuacao-indicador.js`: o
// componente (`components/ui/MenuRadialAcoes.tsx`) não decide nada, só desenha o que
// este módulo calculou. Sem banco, HTTP, IA ou rede.
//
// Anatomia (relatório de padronização visual "Padronização visual das listagens",
// seção 6 — proposta do radial):
//   • cima     = a ação mais frequente e mais reversível;
//   • direita  = a ação que avança o item (positiva);
//   • esquerda = a ação que nega/reverte (negativa);
//   • baixo    = 4ª ação, quando a linha tem 4 ações principais — usada hoje para a
//     ação de navegação/abertura (ex.: "Abrir conversa" em Follow-ups), que antes caía
//     sem zona e virava único item do painel de extras (quadrado) mesmo sendo uma ação
//     principal, não excedente;
//   • centro   = lista completa — TODAS as ações, inclusive as que já têm zona. O
//     radial é atalho, nunca superfície exclusiva: quem não descobriu o gesto, ou usa
//     teclado, sempre encontra a mesma ação na lista.
//
// Regra de colisão: a primeira ação a pedir uma zona vence; a próxima com a MESMA zona
// cai no centro (nunca substitui a que já estava lá em silêncio — perder uma ação por
// colisão seria pior do que ela aparecer só na lista).
function atribuirZonas(acoes) {
  const zonas = { cima: null, direita: null, esquerda: null, baixo: null }
  const extras = []
  for (const acao of acoes || []) {
    if (!acao) continue
    const zona = acao.zona
    if ((zona === 'cima' || zona === 'direita' || zona === 'esquerda' || zona === 'baixo') && !zonas[zona]) {
      zonas[zona] = acao
    } else {
      extras.push(acao)
    }
  }
  return { cima: zonas.cima, direita: zonas.direita, esquerda: zonas.esquerda, baixo: zonas.baixo, extras }
}

/** Nome acessível do botão-gatilho ("⋯"). Contexto (o rótulo do lead/linha) é opcional. */
function rotuloMenu(rotuloContexto) {
  const contexto = typeof rotuloContexto === 'string' ? rotuloContexto.trim() : ''
  return contexto ? `Mais ações — ${contexto}` : 'Mais ações'
}

// Cor NUNCA é a única informação: cada botão do radial carrega o rótulo em texto. O tom
// só reforça positivo/negativo/navegacao/neutro — mesma disciplina de `pontuacao-indicador.js`.
// `navegacao` (azul) é para ações que só ABREM/levam a outro lugar (ex.: "Conversa"/"Ligação"
// em Follow-ups) — distinto de `positivo` (confirma/conclui algo), para a cor não sugerir que
// abrir a conversa é o mesmo tipo de ação que concluir o follow-up.
const TOM_CLASSES = Object.freeze({
  positivo: 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
  negativo: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
  navegacao: 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100',
  neutro: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
})

function classeTom(tom) {
  return TOM_CLASSES[tom] || TOM_CLASSES.neutro
}

module.exports = {
  atribuirZonas,
  rotuloMenu,
  classeTom,
  TOM_CLASSES,
}
