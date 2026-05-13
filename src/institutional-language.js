function sanitizarMencoesPessoaParaEquipe(texto) {
  if (typeof texto !== 'string' || !texto) return texto
  return texto
    .replace(/\breuni[aã]o\s+com\s+o\s+Victor\b/gi, 'reunião com a equipe da PJ Codeworks')
    .replace(/\bconversa\s+com\s+o\s+Victor\b/gi, 'conversa com a equipe da PJ Codeworks')
    .replace(/\bo\s+Victor\s+te\s+mostra\b/gi, 'nossa equipe te mostra')
    .replace(/\bo\s+Victor\s+te\s+apresenta\b/gi, 'a equipe da PJ Codeworks te apresenta')
    .replace(/\bo\s+Victor\s+apresenta\b/gi, 'a equipe da PJ Codeworks apresenta')
    .replace(/\bo\s+Victor\s+confirma\b/gi, 'a equipe comercial da PJ Codeworks confirma')
    .replace(/\bo\s+Victor\s+calcula\b/gi, 'a equipe da PJ Codeworks confirma')
    .replace(/\bo\s+Victor\s+ajusta\b/gi, 'a equipe da PJ Codeworks ajusta')
    .replace(/\bo\s+Victor\s+manda\b/gi, 'a equipe da PJ Codeworks envia')
    .replace(/\bcom\s+o\s+Victor\b/gi, 'com a equipe da PJ Codeworks')
    .replace(/\bao\s+Victor\b/gi, 'à equipe da PJ Codeworks')
    .replace(/\bdo\s+Victor\b/gi, 'da equipe da PJ Codeworks')
    .replace(/\bVictor\b/g, 'equipe da PJ Codeworks')
}

function textoContemPrecoParaLead(texto) {
  return /R\$\s*\d|entrada\s+de\s+R\$|entrada\s+\d|parcelas?|3x|faixa\s+de|a\s+partir\s+de|estimativa\s+inicial|fica\s+em\s+torno|modelo\s+recomendado\s+custa|pre[cç]o\s+calculado/i.test(String(texto || ''))
}

function sanitizarTermosInternosParaLead(texto) {
  return String(texto == null ? '' : texto)
    .replace(/ent[aã]o\s+eu\s+n[aã]o\s+vou\s+ficar\s+aprofundando\s+dor\s+sem\s+necessidade\.?/gi, 'Entendi. Vou direto ao ponto para te explicar como funciona.')
    .replace(/\baprofundar(?:ndo)?\s+dor\b/gi, 'entender melhor o contexto')
    .replace(/\betapa\s+do\s+funil\b/gi, 'próximo passo')
    .replace(/\bfunil\b/gi, 'processo')
    .replace(/\bscore\s+de?\s+dor\b/gi, 'contexto')
    .replace(/\bscore_dor\b/gi, 'contexto')
    .replace(/\blead\s+quente\b/gi, 'contato interessado')
    .replace(/\bgatilho\b/gi, 'sinal')
    .replace(/\bobje[cç][aã]o\b/gi, 'dúvida')
    .replace(/\bdiagn[oó]stico\s+comercial\s+interno\b/gi, 'contexto')
}

module.exports = {
  sanitizarMencoesPessoaParaEquipe,
  sanitizarTermosInternosParaLead,
  textoContemPrecoParaLead,
}
