function sanitizarMencoesPessoaParaEquipe(texto) {
  if (typeof texto !== 'string' || !texto) return texto
  return texto
    .replace(/\breuni[aã]o\s+com\s+o\s+Victor\b/gi, 'reunião com a equipe da {{empresa}}')
    .replace(/\bconversa\s+com\s+o\s+Victor\b/gi, 'conversa com a equipe da {{empresa}}')
    .replace(/\bo\s+Victor\s+te\s+mostra\b/gi, 'nossa equipe te mostra')
    .replace(/\bo\s+Victor\s+te\s+apresenta\b/gi, 'a equipe da {{empresa}} te apresenta')
    .replace(/\bo\s+Victor\s+apresenta\b/gi, 'a equipe da {{empresa}} apresenta')
    .replace(/\bo\s+Victor\s+confirma\b/gi, 'a equipe comercial da {{empresa}} confirma')
    .replace(/\bo\s+Victor\s+calcula\b/gi, 'a equipe da {{empresa}} confirma')
    .replace(/\bo\s+Victor\s+ajusta\b/gi, 'a equipe da {{empresa}} ajusta')
    .replace(/\bo\s+Victor\s+manda\b/gi, 'a equipe da {{empresa}} envia')
    .replace(/\bcom\s+o\s+Victor\b/gi, 'com a equipe da {{empresa}}')
    .replace(/\bao\s+Victor\b/gi, 'à equipe da {{empresa}}')
    .replace(/\bdo\s+Victor\b/gi, 'da equipe da {{empresa}}')
    .replace(/\bVictor\b/g, 'equipe da {{empresa}}')
}

// Substitui o nome institucional legado ("PJ Codeworks") pelo nome real da empresa
// dona da conversa. Ponto ÚNICO aplicado na saída ao lead: cobre de uma vez todos os
// literais hardcoded do funil legado (mensagem_pro_lead, bolhas, e a saída de
// sanitizarMencoesPessoaParaEquipe que troca "Victor" por "equipe da PJ Codeworks").
// No-op quando a empresa é a própria PJ (ou desconhecida) — additivo e seguro.
function aplicarNomeEmpresa(texto, nomeEmp) {
  if (typeof texto !== 'string' || !texto) return texto
  const nome = (typeof nomeEmp === 'string' ? nomeEmp.trim() : '')
  const fill = nome || (process.env.EMPRESA_NOME_PADRAO || 'a empresa')
  // {{empresa}} / {{EMPRESA}}: SEMPRE preenchido — nunca pode vazar o placeholder literal.
  let out = texto.replace(/\{\{\s*empresa\s*\}\}/gi, fill)
  // "PJ Codeworks" legado remanescente: só troca quando há nome real e diferente de PJ.
  if (nome && !/^pj\s*codeworks$/i.test(nome)) out = out.replace(/PJ\s*Codeworks/gi, nome)
  return out
}

// Versão profunda (string | array | {text}) para substituir marca em prompts/mensagens
// estruturados antes de ir à IA. Mantém a estrutura, só toca em strings.
function aplicarNomeEmpresaProfundo(valor, nomeEmp) {
  if (typeof valor === 'string') return aplicarNomeEmpresa(valor, nomeEmp)
  if (Array.isArray(valor)) return valor.map((v) => aplicarNomeEmpresaProfundo(v, nomeEmp))
  if (valor && typeof valor === 'object') {
    if (typeof valor.text === 'string') return { ...valor, text: aplicarNomeEmpresa(valor.text, nomeEmp) }
    if (typeof valor.content === 'string') return { ...valor, content: aplicarNomeEmpresa(valor.content, nomeEmp) }
    if (Array.isArray(valor.content)) return { ...valor, content: aplicarNomeEmpresaProfundo(valor.content, nomeEmp) }
  }
  return valor
}

function textoContemPrecoParaLead(texto) {
  return /R\$\s*\d|entrada\s+de\s+R\$|entrada\s+\d|parcelas?|3x|faixa\s+de|a\s+partir\s+de|estimativa\s+inicial|fica\s+em\s+torno|modelo\s+recomendado\s+custa|pre[cç]o\s+calculado/i.test(String(texto || ''))
}

const FRASE_SEGURA_ESTRUTURA_DIGITAL = 'Ter uma estrutura digital clara ajuda o cliente a entender seus serviços e chamar com mais confiança.'
const FRASE_SEGURA_CAMINHO_WHATSAPP = 'Sem uma estrutura clara, alguns clientes podem não encontrar um caminho simples para conhecer seu serviço e chamar no WhatsApp.'
const FRASE_SEGURA_BUSCA_CONFIANCA = 'Quando alguém procura por um serviço, a empresa que transmite confiança e facilita o contato tende a ter mais chance de receber a conversa.'

const REGEX_FRASES_AGRESSIVAS_CONCORRENTES = [
  /quem\s+pesquisa\s+(?:no\s+)?google[^.!?\n]*fecha\s+com\s+quem\s+aparece\s+primeiro[^.!?\n]*([.!?\n]|$)/gi,
  /voc[eÃª]\s+fica\s+fora\s+dessa\s+busca[^.!?\n]*([.!?\n]|$)/gi,
  /(?:seu\s+)?concorrente[^.!?\n]*(?:aparece|est[aÃ¡]\s+aparecendo)\s+(?:antes|na\s+frente|primeiro)[^.!?\n]*([.!?\n]|$)/gi,
  /(?:voc[eÃª]\s+)?perde\s+clientes?\s+para\s+(?:o\s+)?concorrente[^.!?\n]*([.!?\n]|$)/gi,
  /(?:o\s+)?concorrente[^.!?\n]*(?:pegando|pega|roubando|tomando)\s+(?:seus\s+)?clientes[^.!?\n]*([.!?\n]|$)/gi,
  /seu\s+neg[oÃ³]cio\s+est[aÃ¡]\s+perdendo\s+dinheiro[^.!?\n]*([.!?\n]|$)/gi,
  /voc[eÃª]\s+est[aÃ¡]\s+invis[iÃ­]vel[^.!?\n]*([.!?\n]|$)/gi,
  /concorrentes?\s+j[aÃ¡]\s+est[aÃ£]o\s+vendendo[^.!?\n]*([.!?\n]|$)/gi,
  /quem\s+pesquisa\s+vai\s+direto\s+pra\s+quem\s+aparece[^.!?\n]*([.!?\n]|$)/gi,
  /(?:cai|vai)\s+no\s+concorrente\s+antes\s+de\s+chegar\s+(?:at[eÃ©]\s+)?(?:a\s+)?voc[eÃª][^.!?\n]*([.!?\n]|$)/gi,
]

function textoContemFraseAgressivaConcorrente(texto) {
  const s = String(texto || '')
  const normalizado = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (
    /quem\s+pesquisa\s+(?:no\s+)?google[^.!?\n]*fecha\s+com\s+quem\s+aparece\s+primeiro/.test(normalizado) ||
    /voce\s+fica\s+fora\s+dessa\s+busca/.test(normalizado) ||
    /concorrente[^.!?\n]*(?:aparece|esta\s+aparecendo)\s+(?:antes|na\s+frente|primeiro)/.test(normalizado) ||
    /(?:voce\s+)?perde\s+clientes?\s+para\s+(?:o\s+)?concorrente/.test(normalizado) ||
    /concorrente[^.!?\n]*(?:pegando|pega|roubando|tomando)\s+(?:seus\s+)?clientes/.test(normalizado) ||
    /seu\s+negocio\s+esta\s+perdendo\s+dinheiro/.test(normalizado) ||
    /voce\s+esta\s+invisivel/.test(normalizado) ||
    /concorrentes?\s+ja\s+estao\s+vendendo/.test(normalizado) ||
    /quem\s+pesquisa\s+vai\s+direto\s+pra\s+quem\s+aparece/.test(normalizado) ||
    /(?:cai|vai)\s+no\s+concorrente\s+antes\s+de\s+chegar\s+(?:ate\s+)?(?:a\s+)?voce/.test(normalizado)
  ) {
    return true
  }
  return REGEX_FRASES_AGRESSIVAS_CONCORRENTES.some((re) => {
    re.lastIndex = 0
    return re.test(s)
  })
}

function sanitizarTermosInternosParaLead(texto) {
  return String(texto == null ? '' : texto)
    .replace(/ent[aã]o\s+eu\s+n[aã]o\s+vou\s+ficar\s+aprofundando\s+dor\s+sem\s+necessidade\.?/gi, 'Entendi. Vou direto ao ponto para te explicar como funciona.')
    .replace(/\bn[aã]o\s+vou\s+ficar\s+aprofundando\s+dor\b/gi, 'vou direto ao ponto')
    .replace(/\baprofundar?\s*(ndo|ando)?\s+(a\s+)?dor\b/gi, 'entender melhor o contexto')
    .replace(/\betapa\s+do\s+funil\b/gi, 'próximo passo')
    .replace(/\bfunil\b/gi, 'processo')
    .replace(/\bscore\s+de?\s+dor\b/gi, 'contexto')
    .replace(/\bscore_dor\b/gi, 'contexto')
    .replace(/\bscore\b(?!\s*\d)/gi, 'pontuação')
    .replace(/\blead\s+quente\b/gi, 'contato interessado')
    .replace(/\blead\s+frio\b/gi, 'contato')
    .replace(/\bgatilho\b/gi, 'sinal')
    .replace(/\bobje[cç][aã]o\b/gi, 'dúvida')
    .replace(/\bdiagn[oó]stico\s+comercial\s+interno\b/gi, 'contexto')
    .replace(/\bdiagn[oó]stico\s+interno\b/gi, 'contexto')
    .replace(/\bestrat[eé]gia\s+interna\b/gi, 'abordagem')
    .replace(/\bICP\b/g, 'perfil de cliente ideal')
    .replace(/\bpipeline\b/gi, 'processo')
}

/**
 * Sanitiza a resposta do bot removendo/substituindo frases bloqueadas que tenham vazado
 * da LLM, de templates antigos ou de guardrails. A sanitizacao e invisivel ao lead.
 *
 * Bloqueia:
 * - "no seu caso, isso entra como proposta personalizada..." → o bot deve confirmar
 *   reuniao quando o lead ja escolheu, nao reabrir argumentacao de venda
 * - promessas deterministas sobre Google → centralizam Google demais e fazem
 *   promessa nao garantida
 * - comparacoes agressivas com concorrentes → geram pressao sem prova
 * - "servico de ticket alto/medio/baixo" (sem contexto util) → jargao comercial
 *
 * Termos internos do funil (aprofundar dor, lead quente, score, objecao, diagnostico
 * comercial) ja sao tratados por `sanitizarTermosInternosParaLead`. Esta funcao foca
 * em frases mais especificas observadas vazando em conversas reais.
 */
function sanitizarFrasesProibidasDaResposta(texto) {
  if (typeof texto !== 'string' || !texto) return texto
  let out = texto
  // Ordem importa: remove primeiro "ticket alto/etc." (frequentemente abre paragrafo),
  // depois as outras frases, para evitar que removals deixem residuos sem terminador.
  out = out.replace(/(servi[cç]o\s+de\s+ticket\s+(alto|m[eé]dio|baixo|premium))[^.!?\n]*([.!?\n]|$)\s*/gi, '')
  // "—" inicial sobrando apos remocao do trecho ("Roteiros completos — ...")
  out = out.replace(/[—–-]\s*$/gm, '').replace(/[—–-]\s*\n/g, '\n')
  // Preambulo "No seu caso, isso entra como proposta personalizada para X."
  out = out.replace(
    /(^|\n)\s*[^.!?\n]*?no\s+seu\s+caso[^.!?\n]*?proposta\s+personalizada[^.!?\n]*([.!?\n]|$)\s*/gi,
    '$1'
  )
  out = out.replace(/proposta\s+personalizada\s+para\s+[^.!?\n]*([.!?\n]|$)\s*/gi, '')
  // Frases deterministas sobre Google/concorrentes.
  out = out.replace(/quem\s+pesquisa\s+no\s+google[^.!?\n]*([.!?\n]|$)\s*/gi, '')
  out = out.replace(/(hoje\s+)?voc[eê]\s+fica\s+fora\s+dessa\s+busca[.!?]?\s*/gi, '')
  // Trecho remanescente: ", e " no comeco apos remocao, ou virgulas duplicadas
  out = out.replace(/(^|\n)\s*,\s*e\s+/gi, '$1')
  out = out.replace(/,\s*\./g, '.').replace(/\s+,/g, ',').replace(/,\s+,/g, ',')
  // Espacos/quebras duplicadas sobrando
  out = out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '')
  return out
}

module.exports = {
  sanitizarMencoesPessoaParaEquipe,
  sanitizarTermosInternosParaLead,
  sanitizarFrasesProibidasDaResposta,
  aplicarNomeEmpresa,
  aplicarNomeEmpresaProfundo,
  textoContemFraseAgressivaConcorrente,
  textoContemPrecoParaLead,
}
