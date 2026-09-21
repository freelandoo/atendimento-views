// @ts-check
'use strict'
// Perfil de Instagram do lead — QUEM e' o perfil, e com que FORCA isso foi provado.
//
// POR QUE ISTO EXISTE. Ate' aqui o sistema so' sabia que um lead tinha "algum link de rede
// social" (site-classificacao.js devolve `rede_social`). Isso responde "tem site proprio?" e nao
// responde "qual e' o Instagram dele?". O criterio `instagram_ativo` do ICP dependia disso e,
// para lead vindo do Maps, nunca ligava: o caminho do Maps nao grava `instagram_handle`.
//
// MODULO PURO: sem banco, sem HTTP, sem IA, sem rede. Ele nao busca nada e nao escreve nada —
// recebe o lead (e, quando houver, os resultados que outra camada ja' buscou) e devolve o
// VEREDITO mais as evidencias que o sustentam.
//
// A PERGUNTA CENTRAL nao e' "achei um perfil?", e sim "da' para PROVAR que este perfil e' deste
// negocio?". A primeira pergunta admite resposta por semelhanca, e semelhanca e' exatamente o
// que produz vinculo errado — e vinculo errado vira abordagem errada.

const { usernameDeUrlInstagram } = require('./social-discovery')

/** De onde veio o handle. A procedencia tem forca diferente — ver `vereditoDaOrigem`. */
const ORIGEM = Object.freeze({
  GOOGLE_MEU_NEGOCIO: 'google_meu_negocio',
  BUSCA: 'busca',
  OPERADOR: 'operador',
})
const ORIGENS = Object.freeze(Object.values(ORIGEM))

/**
 * Tres estados, e `candidato` NAO e' `false`.
 *
 * Mesmo padrao de `situacao_site` (tem_site/sem_site/nao_identificado) e de
 * `contato_canal_disponibilidade` (ausencia de linha != negativa): "ninguem provou" e' um estado
 * legitimo, e e' justamente ele que vira trabalho de revisao humana. Colapsar `candidato` em
 * `nao_encontrado` jogaria fora busca ja' feita; colapsar em `confirmado` inventaria vinculo.
 */
const CONFIANCA = Object.freeze({
  CONFIRMADO: 'confirmado',
  CANDIDATO: 'candidato',
  NAO_ENCONTRADO: 'nao_encontrado',
})
const CONFIANCAS = Object.freeze(Object.values(CONFIANCA))

/** Sinais de vinculo, do mais forte para o mais fraco. Lista FECHADA. */
const SINAL = Object.freeze({
  TELEFONE: 'telefone',
  SITE: 'site',
  NOME: 'nome',
  CIDADE: 'cidade',
})

// Telefone e site sao os unicos que PROVAM. Nome e cidade apenas sustentam um candidato:
// num mesmo nicho e cidade, dezenas de negocios compartilham as duas coisas.
const SINAIS_FORTES = Object.freeze([SINAL.TELEFONE, SINAL.SITE])

const ROTULO_SINAL = Object.freeze({
  [SINAL.TELEFONE]: 'Telefone do lead aparece no perfil',
  [SINAL.SITE]: 'Site do lead aparece no perfil',
  [SINAL.NOME]: 'Nome do negocio bate',
  [SINAL.CIDADE]: 'Cidade bate',
})

// Campos onde um link de Instagram pode estar guardado hoje, do mais confiavel para o menos.
// `link_original` e' o link CRU da ficha do Maps, preservado pela migration 056 — e' ali que o
// Instagram declarado no Perfil da Empresa foi parar. `site` entra por defesa: antes da 056 ele
// aceitava qualquer link, e ha' base historica.
const CAMPOS_LINK = Object.freeze(['link_original', 'site', 'link_bio'])

// Palavras que nao distinguem um negocio de outro. Forma juridica, conectivo e ruido de cadastro.
const GENERICOS = new Set([
  'ltda', 'me', 'epp', 'eireli', 'sa', 'cia', 'mei',
  'e', 'de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'a', 'o', 'as', 'os',
  'the', 'and',
])

function texto(valor) {
  return String(valor == null ? '' : valor).trim()
}

/** minusculas, sem acento, sem pontuacao. Base de toda comparacao textual deste modulo. */
function normalizar(valor) {
  return texto(valor)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function palavras(valor) {
  const n = normalizar(valor)
  return n ? n.split(' ').filter(Boolean) : []
}

function digitos(valor) {
  return texto(valor).replace(/\D/g, '')
}

/** Aceita "@loja", "loja", "instagram.com/loja" ou a URL inteira. null se nao for perfil. */
function normalizarHandle(valor) {
  const bruto = texto(valor)
  if (!bruto) return null
  if (/instagram\.com/i.test(bruto)) {
    return usernameDeUrlInstagram(/^https?:/i.test(bruto) ? bruto : `https://${bruto}`)
  }
  const handle = bruto.replace(/^@/, '').toLowerCase()
  return /^[a-z0-9._]{1,30}$/.test(handle) ? handle : null
}

/**
 * ETAPA 1 — o Instagram que o proprio dono declarou no Perfil da Empresa.
 *
 * Custo zero: o link ja' esta' no banco desde a coleta. Nao ha' o que provar aqui — quem
 * escreveu aquele link na ficha foi o dono do negocio, e essa e' a evidencia mais forte que este
 * modulo pode receber. Por isso a origem `google_meu_negocio` nasce CONFIRMADA (ver
 * `vereditoDaOrigem`), enquanto a busca nasce candidata.
 */
function handleDeLinkConhecido(lead = {}) {
  for (const campo of CAMPOS_LINK) {
    const valor = texto(lead[campo])
    // Exige URL do Instagram, e nao aceita handle solto: estes campos guardam LINK. Uma palavra
    // solta em `site` (cadastro mal preenchido, nome de fantasia) viraria um @ inventado, e o
    // lead ganharia um "Instagram confirmado" que nunca existiu. Handle digitado a mao e' outra
    // porta — `normalizarHandle`, usada pela revisao humana, onde ha' uma pessoa respondendo.
    if (!/instagram\.com/i.test(valor)) continue
    const handle = normalizarHandle(valor)
    if (handle) return { handle, origem: ORIGEM.GOOGLE_MEU_NEGOCIO, link: valor }
  }
  return null
}

/**
 * As palavras que realmente identificam ESTE negocio.
 *
 * Nicho e cidade sao removidos de proposito, e e' a regra mais importante do modulo. "Energia
 * Solar Goiania" tem tres tokens e nenhum deles distingue um lead do outro dentro de uma busca
 * por energia solar em Goiania — casar por eles faria todo concorrente virar "o mesmo negocio".
 * Sobrando zero tokens distintivos, o nome perde o direito de sustentar candidato.
 */
function tokensDistintivos(lead = {}) {
  const fora = new Set([...palavras(lead.nicho), ...palavras(lead.cidade), ...GENERICOS])
  const out = []
  for (const p of palavras(lead.nome)) {
    if (p.length < 3 || fora.has(p) || out.includes(p)) continue
    out.push(p)
  }
  return out
}

/** Os ultimos 8 digitos — o que sobrevive a DDI, DDD e ao nono digito. */
function miolo(telefone) {
  const d = digitos(telefone)
  return d.length >= 8 ? d.slice(-8) : ''
}

/** Host sem `www.`; '' quando nao ha' URL utilizavel. */
function host(url) {
  const bruto = texto(url)
  if (!bruto) return ''
  try {
    const u = new URL(/^https?:/i.test(bruto) ? bruto : `https://${bruto}`)
    return u.hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

function sinal(chave, ok, detalhe) {
  return { chave, rotulo: ROTULO_SINAL[chave], ok: !!ok, detalhe: detalhe || null }
}

/**
 * ETAPA 2 — o que um resultado de busca prova sobre este lead.
 *
 * `candidato` e' o que a camada de busca ja' colheu: { handle, titulo, resumo, url }. Neste
 * momento do projeto o perfil NAO foi raspado (coleta paga), entao a unica materia-prima e' o
 * texto que a busca devolveu. O modulo e' explicito sobre isso: sem sinal forte, o maximo que
 * ele concede e' `candidato`.
 */
function avaliarCandidato(lead = {}, candidato = {}) {
  const handle = normalizarHandle(candidato.handle || candidato.url)
  if (!handle) return null

  const alvo = normalizar([candidato.titulo, candidato.resumo, handle].filter(Boolean).join(' '))
  const alvoDigitos = digitos([candidato.titulo, candidato.resumo].filter(Boolean).join(' '))

  const fone = miolo(lead.telefone)
  const siteHost = host(lead.site) || host(lead.link_original)
  const distintivos = tokensDistintivos(lead)
  const achados = distintivos.filter((t) => alvo.includes(t))
  const cidade = palavras(lead.cidade).filter((c) => c.length >= 3)

  const sinais = [
    sinal(SINAL.TELEFONE, !!fone && alvoDigitos.includes(fone), fone ? null : 'lead sem telefone'),
    sinal(SINAL.SITE, !!siteHost && alvo.includes(normalizar(siteHost)), siteHost || 'lead sem site'),
    sinal(
      SINAL.NOME,
      distintivos.length > 0 && achados.length / distintivos.length >= 0.6,
      distintivos.length
        ? (achados.join(', ') || 'nenhuma palavra do nome bate')
        : 'nome so tem palavras do nicho/cidade'
    ),
    sinal(SINAL.CIDADE, cidade.length > 0 && cidade.some((c) => alvo.includes(c)), null),
  ]

  const forte = sinais.some((s) => s.ok && SINAIS_FORTES.includes(s.chave))
  const nomeOk = sinais.find((s) => s.chave === SINAL.NOME).ok
  return {
    handle,
    url: texto(candidato.url) || `https://www.instagram.com/${handle}/`,
    origem: ORIGEM.BUSCA,
    sinais,
    forte,
    // Resultado que nao bate nem o nome e' ruido da busca, nao candidato: guarda-lo encheria a
    // fila de revisao humana com perfis que nada liga ao lead.
    aproveitavel: forte || nomeOk,
  }
}

/** O melhor resultado da busca, ou null quando nenhum e' aproveitavel. */
function escolherMelhorCandidato(lead = {}, candidatos = []) {
  let melhor = null
  for (const bruto of Array.isArray(candidatos) ? candidatos : []) {
    const aval = avaliarCandidato(lead, bruto)
    if (!aval || !aval.aproveitavel) continue
    const peso = (aval.forte ? 10 : 0) + aval.sinais.filter((s) => s.ok).length
    if (!melhor || peso > melhor.peso) melhor = { ...aval, peso }
  }
  return melhor
}

/**
 * A regra de confianca, num lugar so'.
 *
 * `google_meu_negocio` e `operador` sao declaracoes de gente (o dono, na propria ficha; o
 * vendedor, na tela) e nascem confirmadas. `busca` e' inferencia da maquina: so' vira confirmada
 * com sinal FORTE, e forte e' telefone ou site — nunca nome e cidade, que o nicho inteiro
 * compartilha.
 */
function vereditoDaOrigem(origem, { forte = false } = {}) {
  if (origem === ORIGEM.GOOGLE_MEU_NEGOCIO || origem === ORIGEM.OPERADOR) return CONFIANCA.CONFIRMADO
  if (origem === ORIGEM.BUSCA) return forte ? CONFIANCA.CONFIRMADO : CONFIANCA.CANDIDATO
  return CONFIANCA.NAO_ENCONTRADO
}

/**
 * O lead tem perfil de Instagram PROVADO?
 *
 * Consumido pelo sinal automatico do ICP. `instagram_handle` sozinho ja' conta porque essa
 * coluna so' recebe perfil confirmado: ou veio da captacao social (onde o perfil E' o lead) ou
 * passou por este modulo. O candidato nao confirmado mora em coluna separada, de proposito —
 * mesmo contrato de `site` vs `link_original` da migration 056.
 */
function perfilConfirmado(lead = {}) {
  if (lead.instagram_confianca === CONFIANCA.CONFIRMADO) return true
  if (lead.instagram_confianca === CONFIANCA.CANDIDATO) return false
  return !!texto(lead.instagram_handle)
}

/**
 * ATENCAO: perfil confirmado NAO significa perfil ATIVO.
 *
 * Saber se ha' postagem recente exige raspar o perfil (coleta paga) e um contrato de dados que
 * este repositorio ainda nao confirmou — a mesma licao de `latest_review_date` (Decisao 1 de
 * 2026-09-16: quatro grafias chutadas, 200 coletas pagas, zero datas). Enquanto isso, o sistema
 * afirma apenas o que provou.
 */
function situacaoAtividade(lead = {}) {
  if (!perfilConfirmado(lead)) return 'sem_perfil'
  return 'atividade_nao_verificada'
}

module.exports = {
  ORIGEM,
  ORIGENS,
  CONFIANCA,
  CONFIANCAS,
  SINAL,
  SINAIS_FORTES,
  ROTULO_SINAL,
  CAMPOS_LINK,
  normalizar,
  normalizarHandle,
  handleDeLinkConhecido,
  tokensDistintivos,
  avaliarCandidato,
  escolherMelhorCandidato,
  vereditoDaOrigem,
  perfilConfirmado,
  situacaoAtividade,
}
