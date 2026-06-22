'use strict'
/**
 * Validador final de respostas do agente — defesa em profundidade aplicada
 * IMEDIATAMENTE antes de `enviarMensagem`. Centraliza todas as checagens que
 * antes estavam espalhadas em `aplicarGuardrailReuniaoProposta`, `chamarClaude`,
 * `decidirProximaResposta`, etc.
 *
 * Princípio: a IA pode escrever, mas o validador DECIDE se a mensagem sai.
 *
 * Camadas:
 *  1. sanitização — corrige problemas (silenciosamente)
 *  2. validação    — bloqueia/sinaliza problemas que sobreviveram à sanitização
 *
 * Cada `validar*` retorna `{ ok: boolean, erro?: string, severidade: 'bloquear'|'avisar' }`.
 * `validarRespostaAntesDeEnviar` é o único ponto que o caller deve chamar.
 */

const fs = require('node:fs')
const path = require('node:path')
const {
  sanitizarMencoesPessoaParaEquipe,
  sanitizarTermosInternosParaLead,
  sanitizarFrasesProibidasDaResposta,
  textoContemFraseAgressivaConcorrente,
  textoContemPrecoParaLead,
} = require('./institutional-language')
const { messageLooksLikeRawJsonLeak } = require('./public-message-guard')
const { limitarBolhasPorEtapa } = require('./message-limits')
const REGEX_PROIBIDAS_TRIAGEM = /recomendo\s+entrar\s+em\s+contato\s+com\s+uma\s+empresa\s+especializada|R\$\s*(1\.?500|3\.?000|5\.?000)/i
const LIMITE_RESPOSTA_LEAD_CHARS = 450
const REGEX_CONCORRENTE_SEM_DADO = /\b(?:concorrente|concorrentes)\b/i

const REGEX_VICTOR = /\bVictor\b/
const REGEX_FRASES_PROIBIDAS = /no\s+seu\s+caso[^.\n]*?proposta\s+personalizada|quem\s+pesquisa\s+no\s+google[^.\n]*\.|voc[eê]\s+fica\s+fora\s+dessa\s+busca|servi[cç]o\s+de\s+ticket\s+(alto|m[eé]dio|baixo|premium)|vou\s+reformular/i
const REGEX_TERMOS_INTERNOS = /\b(aprofundar\s+dor|lead\s+quente|lead\s+frio|score_?dor|score\s+de\s+dor|funil|gatilho|diagn[oó]stico\s+(comercial|interno)|ICP|pipeline|estrat[eé]gia\s+interna|etapa\s+do\s+funil|n[aã]o\s+vou\s+ficar\s+aprofundando)\b/i

// Markdown indevido — WhatsApp não renderiza headers/tabelas e a formatação expõe output de IA
const REGEX_MD_BOLD = /\*{2,}[^*\n]+\*{2,}/
const REGEX_MD_HEADER = /^#{2,}\s+\S/m
const REGEX_MD_TABLE = /^\|.+\|.+\|/m
const REGEX_MD_NUMBERED_LONG = /(?:^\d+[.)]\s+.+\n?){3,}/m

function normalizarLinkGuardrail(link) {
  return String(link || '').trim().replace(/\/+$/, '')
}

function carregarLinksAutorizados() {
  const links = new Set()
  try {
    const empresaPath = path.join(__dirname, '..', 'prompts', 'empresa.md')
    const texto = fs.readFileSync(empresaPath, 'utf8')
    const encontrados = extrairLinksDoTexto(texto)
    for (const link of encontrados) links.add(normalizarLinkGuardrail(link))
  } catch (_) {}
  return links
}

const LINKS_AUTORIZADOS = carregarLinksAutorizados()

function normalizarGuardrail(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function extrairLinksDoTexto(texto) {
  return [...String(texto || '').matchAll(/https?:\/\/\S+/g)]
    .map((m) => m[0].replace(/^[("'[]+/, '').replace(/[\])"',.;]+$/, ''))
    .map(normalizarLinkGuardrail)
    .filter(Boolean)
}

/**
 * @param {string} texto
 * @returns {{ ok: boolean, erro?: string, severidade: 'bloquear'|'avisar' }}
 */
function validarSemFrasesProibidas(texto) {
  if (typeof texto !== 'string' || !texto) return { ok: true, severidade: 'avisar' }
  if (REGEX_FRASES_PROIBIDAS.test(texto) || REGEX_PROIBIDAS_TRIAGEM.test(texto) || textoContemFraseAgressivaConcorrente(texto)) {
    return {
      ok: false,
      erro: 'Mensagem contem frase proibida (proposta personalizada, Google-centrismo, concorrente agressivo, ticket alto, reformular)',
      severidade: 'avisar',
    }
  }
  return { ok: true, severidade: 'avisar' }
}

function validarSemConcorrenteSemDado(texto, perfil = {}) {
  if (typeof texto !== 'string' || !texto) return { ok: true, severidade: 'avisar' }
  if (!REGEX_CONCORRENTE_SEM_DADO.test(texto)) return { ok: true, severidade: 'avisar' }
  const concorrentesReais = Array.isArray(perfil?.concorrentes) ? perfil.concorrentes.filter(Boolean) : []
  if (concorrentesReais.length > 0 && !textoContemFraseAgressivaConcorrente(texto)) {
    return { ok: true, severidade: 'avisar' }
  }
  return {
    ok: false,
    erro: 'Mensagem menciona concorrente sem dado real validado ou usa comparacao agressiva',
    severidade: 'avisar',
  }
}

function validarSemTermosInternos(texto) {
  if (typeof texto !== 'string' || !texto) return { ok: true, severidade: 'avisar' }
  if (REGEX_TERMOS_INTERNOS.test(texto)) {
    return {
      ok: false,
      erro: 'Mensagem contem termos internos do funil (aprofundar dor, lead quente, score, funil, gatilho)',
      severidade: 'avisar',
    }
  }
  return { ok: true, severidade: 'avisar' }
}

function validarSemMencaoVictor(texto) {
  if (typeof texto !== 'string' || !texto) return { ok: true, severidade: 'avisar' }
  if (REGEX_VICTOR.test(texto)) {
    return {
      ok: false,
      erro: 'Mensagem menciona "Victor" — sempre direcionar para a equipe da {{empresa}}',
      severidade: 'avisar',
    }
  }
  return { ok: true, severidade: 'avisar' }
}

/**
 * Se o lead esta em contexto de projeto sob medida (sob_medida=true OU
 * reuniao_proposta.necessaria=true OU plano personalizado), a mensagem
 * NAO pode conter R$, faixa, parcela, entrada, etc.
 */
function validarSemPrecoSobMedida(texto, perfil = {}) {
  if (typeof texto !== 'string' || !texto) return { ok: true, severidade: 'avisar' }
  const ehSobMedida = Boolean(
    perfil?.projeto_sob_medida ||
    perfil?.sob_medida ||
    (perfil?.reuniao_proposta && perfil.reuniao_proposta.necessaria === true) ||
    /personalizado|sob[\s_]?medida/i.test(String(perfil?.plano_sugerido || perfil?.produto_sugerido || ''))
  )
  if (!ehSobMedida) return { ok: true, severidade: 'avisar' }
  if (textoContemPrecoParaLead(texto)) {
    return {
      ok: false,
      erro: 'Mensagem cita preco (R$, faixa, parcela) em contexto de projeto sob medida',
      // Decisao do dono (2026-06-06): LLM no controle do preco. Vira AVISO
      // (telemetria) — nao substitui mais a resposta da IA.
      severidade: 'avisar',
      codigo: 'preco_sob_medida',
    }
  }
  return { ok: true, severidade: 'avisar' }
}

function validarSemMarkdown(texto) {
  if (typeof texto !== 'string' || !texto) return { ok: true, severidade: 'avisar' }
  if (REGEX_MD_BOLD.test(texto)) {
    return { ok: false, erro: 'Mensagem contém formatação markdown (**bold**) — parece saída de ChatGPT', severidade: 'avisar' }
  }
  if (REGEX_MD_HEADER.test(texto)) {
    return { ok: false, erro: 'Mensagem contém cabeçalho markdown (## ou ###)', severidade: 'avisar' }
  }
  if (REGEX_MD_TABLE.test(texto)) {
    return { ok: false, erro: 'Mensagem contém tabela markdown (|col|col|)', severidade: 'avisar' }
  }
  if (REGEX_MD_NUMBERED_LONG.test(texto)) {
    return { ok: false, erro: 'Mensagem contém lista numerada com 3+ itens (1. 2. 3.)', severidade: 'avisar' }
  }
  return { ok: true, severidade: 'avisar' }
}

function validarSemJsonBruto(texto) {
  if (typeof texto !== 'string' || !texto) return { ok: true, severidade: 'avisar' }
  if (messageLooksLikeRawJsonLeak(texto)) {
    return {
      ok: false,
      erro: 'Mensagem parece JSON bruto, markdown de JSON ou schema interno da IA',
      severidade: 'bloquear',
      codigo: 'json_bruto_ou_schema_interno',
      alertaOperador: true,
    }
  }
  return { ok: true, severidade: 'avisar' }
}

function validarSemDadosSensiveisOuPagamento(texto) {
  if (typeof texto !== 'string' || !texto) return { ok: true, severidade: 'avisar' }
  const s = normalizarGuardrail(texto)
  const mencionaRestrito = /\b(cpf|cnpj|endereco|pix|cartao|dados?\s+de\s+pagamento|pagamento\s+por\s+aqui|pagamento\s+no\s+whatsapp|chave\s+pix)\b/.test(s)
  if (!mencionaRestrito) return { ok: true, severidade: 'avisar' }
  const contextoNegacao = /\b(nao|nunca)\s+(?:precisa|vou|vamos|peco|pedimos|envie|mande|passar|pedir|coletar)[^.?!\n]{0,90}\b(cpf|cnpj|endereco|pix|cartao|pagamento)\b/.test(s)
  if (contextoNegacao) return { ok: true, severidade: 'avisar' }
  return {
    ok: false,
    erro: 'Mensagem pede ou envia dado sensivel/pagamento proibido no WhatsApp (CPF, CNPJ, endereco, Pix, cartao ou pagamento)',
    // Decisao do dono (2026-06-06): LLM no controle. Vira AVISO (telemetria) —
    // nao bloqueia mais nem alerta o operador.
    severidade: 'avisar',
    codigo: 'dados_pagamento_proibidos',
  }
}

function validarLinksAutorizados(texto) {
  if (typeof texto !== 'string' || !texto) return { ok: true, severidade: 'avisar' }
  const links = extrairLinksDoTexto(texto)
  if (!links.length) return { ok: true, severidade: 'avisar' }
  const naoAutorizados = links.filter((link) => !LINKS_AUTORIZADOS.has(link))
  if (!naoAutorizados.length) return { ok: true, severidade: 'avisar' }
  return {
    ok: false,
    erro: `Mensagem contem link nao autorizado: ${naoAutorizados.slice(0, 2).join(', ')}`,
    // Decisao do dono (2026-06-06): LLM no controle. Vira AVISO (telemetria).
    severidade: 'avisar',
    codigo: 'link_nao_autorizado',
  }
}

function extrairValoresReaisDoTextoLocal(texto) {
  const re = /R\$\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{0,2})?|\d+)/g
  const vals = []
  let m
  while ((m = re.exec(texto)) !== null) {
    const raw = m[1].replace(/\./g, '').replace(',', '.')
    const v = parseFloat(raw)
    if (!isNaN(v) && v >= 50) vals.push(v)
  }
  return vals
}

function validarPrecoNaoInventado(texto, perfil = {}) {
  if (typeof texto !== 'string' || !texto) return { ok: true, severidade: 'avisar' }
  // sob medida já tratado por validarSemPrecoSobMedida
  if (perfil?.projeto_sob_medida || perfil?.sob_medida || perfil?.reuniao_proposta?.necessaria === true) {
    return { ok: true, severidade: 'avisar' }
  }
  const precoCalculado = Number(perfil?.preco_calculado) || 0
  if (!precoCalculado) return { ok: true, severidade: 'avisar' }
  const valores = extrairValoresReaisDoTextoLocal(texto)
  if (!valores.length) return { ok: true, severidade: 'avisar' }
  const entrada = Number(perfil?.entrada) || 0
  const parcela = Number(perfil?.parcela) || 0
  const permitidos = [precoCalculado, entrada, parcela].filter((p) => p > 0)
  for (const v of valores) {
    if (v < 500) continue
    const coincide = permitidos.some((p) => Math.abs(v - p) <= Math.max(20, p * 0.25))
    if (!coincide) {
      return {
        ok: false,
        erro: 'Mensagem contém valor monetário que não corresponde ao preço calculado pelo catálogo',
        severidade: 'avisar',
      }
    }
  }
  return { ok: true, severidade: 'avisar' }
}

function validarNaoVazio(texto) {
  if (typeof texto !== 'string' || !texto.trim()) {
    return { ok: false, erro: 'Mensagem vazia', severidade: 'bloquear' }
  }
  return { ok: true, severidade: 'avisar' }
}

/**
 * Garante que mensagem_pro_lead nao contem texto que parece resumo_handoff
 * (etiquetas internas tipo "Lead confirmou reuniao para X. Estagio: Y. Intencao: Z").
 */
function validarSemResumoHandoffNoLead(texto) {
  if (typeof texto !== 'string' || !texto) return { ok: true, severidade: 'avisar' }
  if (/Lead\s+confirmou\s+reuni[aã]o.*Est[aá]gio:|Intenc[aã]o:\s*[a-z_]+|Valor\s+interno\s+para\s+refer[eê]ncia/i.test(texto)) {
    return {
      ok: false,
      erro: 'Mensagem para o lead contem trecho de handoff interno (etiquetas Estágio:, Intenção:, valor interno)',
      severidade: 'bloquear',
      codigo: 'handoff_interno_vazado',
      alertaOperador: true,
    }
  }
  return { ok: true, severidade: 'avisar' }
}

function validarCurta(texto) {
  if (typeof texto !== 'string' || !texto) return { ok: true, severidade: 'avisar' }
  if (texto.length > LIMITE_RESPOSTA_LEAD_CHARS) {
    return {
      ok: false,
      erro: `Mensagem passa de ${LIMITE_RESPOSTA_LEAD_CHARS} caracteres`,
      severidade: 'avisar',
    }
  }
  return { ok: true, severidade: 'avisar' }
}

function validarUmaPerguntaPrincipal(texto) {
  if (typeof texto !== 'string' || !texto) return { ok: true, severidade: 'avisar' }
  const perguntas = (texto.match(/\?+/g) || []).length
  if (perguntas > 1) {
    return {
      ok: false,
      erro: `Mensagem tem perguntas demais (${perguntas})`,
      severidade: 'avisar',
    }
  }
  return { ok: true, severidade: 'avisar' }
}

function validarSemConsultoriaLonga(texto) {
  if (typeof texto !== 'string' || !texto) return { ok: true, severidade: 'avisar' }
  const linhasLista = texto.split('\n').filter((l) => /^\s*(-|\d+[.)]|[•*])\s+/.test(l)).length
  const pareceConsultoria =
    linhasLista > 3 ||
    /\b(portf[oó]lio|agenda\s+de\s+shows|loja\s+online|blog)\b/i.test(texto) ||
    /\b(funcionalidades?\s+como|voce\s+pode\s+considerar|pode\s+incluir)\b/i.test(texto)
  if (pareceConsultoria) {
    return {
      ok: false,
      erro: 'Mensagem parece consultoria completa ou lista longa',
      severidade: 'avisar',
    }
  }
  return { ok: true, severidade: 'avisar' }
}

/**
 * Sanitiza a mensagem antes da validacao — corrige problemas silenciosamente.
 * Aplica em ordem para evitar reaparecer apos limpeza:
 *  1. menções a Victor → equipe
 *  2. termos internos → linguagem comum
 *  3. frases proibidas → removidas
 */
function sanitizarMensagemFinal(texto) {
  if (typeof texto !== 'string' || !texto) return texto
  let out = texto
  out = sanitizarMencoesPessoaParaEquipe(out)
  out = sanitizarTermosInternosParaLead(out)
  out = sanitizarFrasesProibidasDaResposta(out)
  return out
}

/**
 * Valida UMA mensagem (string) com perfil de contexto.
 * @returns {{ ok: boolean, erros: Array<{erro:string, severidade:string}>, textoSanitizado: string }}
 */
function validarMensagemString(texto, perfil = {}) {
  const preChecks = [
    validarSemFrasesProibidas(texto),
    validarSemConcorrenteSemDado(texto, perfil),
  ]
  const textoSanitizado = sanitizarMensagemFinal(texto)
  const checks = [
    ...preChecks,
    validarNaoVazio(textoSanitizado),
    validarSemJsonBruto(textoSanitizado),
    validarSemDadosSensiveisOuPagamento(textoSanitizado),
    validarLinksAutorizados(textoSanitizado),
    validarSemMarkdown(textoSanitizado),
    validarCurta(textoSanitizado),
    validarUmaPerguntaPrincipal(textoSanitizado),
    validarSemConsultoriaLonga(textoSanitizado),
    validarSemFrasesProibidas(textoSanitizado),
    validarSemConcorrenteSemDado(textoSanitizado, perfil),
    validarSemTermosInternos(textoSanitizado),
    validarSemMencaoVictor(textoSanitizado),
    validarSemPrecoSobMedida(textoSanitizado, perfil),
    validarPrecoNaoInventado(textoSanitizado, perfil),
    validarSemResumoHandoffNoLead(textoSanitizado),
  ]
  const erros = checks
    .filter((c) => !c.ok)
    .map((c) => ({
      erro: c.erro,
      severidade: c.severidade,
      ...(c.codigo ? { codigo: c.codigo } : {}),
      ...(c.alertaOperador ? { alertaOperador: true } : {}),
    }))
  const bloqueado = erros.some((e) => e.severidade === 'bloquear')
  return {
    ok: !bloqueado,
    erros,
    textoSanitizado,
    motivosAlertaOperador: erros
      .filter((e) => e.alertaOperador === true)
      .map((e) => e.codigo || e.erro),
  }
}

/**
 * Ponto de entrada UNICO. Recebe um `resultado` (no formato esperado pelo agente:
 * `{ mensagem_pro_lead, mensagens_bolhas, atualizar_perfil, ... }`) e devolve
 * uma versao sanitizada + relatorio de validacao.
 *
 * Se houver erro de severidade=bloquear, a mensagem é substituida por
 * `mensagemFallbackSegura(perfil, estagio)` para que o lead nao receba nada problematico.
 *
 * @param {object} resultado - { mensagem_pro_lead, mensagens_bolhas, ... }
 * @param {object} perfil    - perfil do lead (usado para contexto sob_medida)
 * @param {object} [opcoes]  - { contexto: { estagio, numero }, onErro: fn }
 * @returns {{ resultado: object, bloqueado: boolean, erros: Array, mensagemFallback?: string, shouldRegenerate: boolean }}
 */
function validarRespostaAntesDeEnviar(resultado, perfil = {}, opcoes = {}) {
  if (!resultado || typeof resultado !== 'object') {
    return { resultado, bloqueado: false, erros: [], shouldRegenerate: false }
  }

  const estagio = opcoes?.contexto?.estagio || null
  const etapaLimite = estagio === 'primeiro_contato'
    ? 'primeiro_contato'
    : (resultado.etapa_proxima || estagio)
  const errosTotais = []
  let bloqueado = false
  // Captura trecho antes de sanitizar (para log)
  const trechoOriginal = String(resultado.mensagem_pro_lead || '').slice(0, 150)

  // 1. Sanitiza e valida mensagem_pro_lead
  if (typeof resultado.mensagem_pro_lead === 'string') {
    const r = validarMensagemString(resultado.mensagem_pro_lead, perfil)
    resultado.mensagem_pro_lead = r.textoSanitizado
    if (r.erros.length) {
      errosTotais.push(...r.erros.map((e) => ({ ...e, campo: 'mensagem_pro_lead' })))
    }
    if (!r.ok) {
      bloqueado = true
    }
  }

  // 2. Sanitiza e valida cada bolha
  if (Array.isArray(resultado.mensagens_bolhas)) {
    const totalOriginalBolhas = resultado.mensagens_bolhas.length
    resultado.mensagens_bolhas = limitarBolhasPorEtapa({
      etapa: etapaLimite,
      mensagens: resultado.mensagens_bolhas,
    })
    if (totalOriginalBolhas > resultado.mensagens_bolhas.length) {
      errosTotais.push({
        erro: `Mensagens em bolhas compactadas (${totalOriginalBolhas} > ${resultado.mensagens_bolhas.length})`,
        severidade: 'avisar',
        campo: 'mensagens_bolhas',
      })
    }
    const bolhasOk = []
    for (let i = 0; i < resultado.mensagens_bolhas.length; i++) {
      const b = resultado.mensagens_bolhas[i]
      if (typeof b !== 'string') {
        bolhasOk.push(b)
        continue
      }
      const r = validarMensagemString(b, perfil)
      if (r.erros.length) {
        errosTotais.push(...r.erros.map((e) => ({ ...e, campo: `mensagens_bolhas[${i}]` })))
      }
      if (r.ok && r.textoSanitizado.trim()) {
        bolhasOk.push(r.textoSanitizado)
      } else if (!r.ok) {
        bloqueado = true
      }
    }
    resultado.mensagens_bolhas = bolhasOk
  }

  // 3. Se bloqueado, substitui por fallback seguro e dispara onErro com trecho
  let mensagemFallback
  if (bloqueado) {
    mensagemFallback = mensagemFallbackSegura(perfil, estagio)
    resultado.mensagem_pro_lead = mensagemFallback
    resultado.mensagens_bolhas = []
    if (typeof opcoes.onErro === 'function') {
      try {
        opcoes.onErro({ erros: errosTotais, perfil, trechoOriginal, contexto: opcoes.contexto })
      } catch (_) {}
    }
  }

  const shouldRegenerate = bloqueado && errosTotais.some((e) => e.severidade === 'bloquear')
  const motivosAlertaOperador = errosTotais
    .filter((e) => e.alertaOperador === true)
    .map((e) => e.codigo || e.erro)
  return {
    resultado,
    bloqueado,
    erros: errosTotais,
    mensagemFallback,
    shouldRegenerate,
    alertarOperador: motivosAlertaOperador.length > 0,
    motivosAlertaOperador,
  }
}

/**
 * Mensagem de seguranca usada quando uma resposta foi bloqueada pelo validador.
 * Nao expoe falha ao lead. Considera estagio e dados do perfil para ser contextual.
 * @param {object} perfil
 * @param {string|null} estagio
 */
function mensagemFallbackSegura(perfil = {}, estagio = null) {
  if (estagio === 'proposta' || estagio === 'fechamento') {
    return 'Para garantir que te passo as informações certas, deixa eu verificar aqui e já te retorno.'
  }
  if (estagio === 'objecao') {
    return 'Entendo sua dúvida. Me dá um instante para verificar a melhor forma de te explicar isso.'
  }
  const temNegocio = Boolean(perfil?.negocio)
  const temCidade = Boolean(perfil?.cidade || perfil?.regiao_atendimento)
  if (temNegocio && temCidade) {
    return 'Deixa eu chamar a equipe da {{empresa}} pra falar com você diretamente. Já tenho as informações principais do seu negócio aqui.'
  }
  return 'Perfeito. Para eu te orientar do jeito certo, me confirma só uma coisa: você procura site, sistema, automação ou uma solução sob medida?'
}

module.exports = {
  validarRespostaAntesDeEnviar,
  validarMensagemString,
  sanitizarMensagemFinal,
  mensagemFallbackSegura,
  // exports granulares para testes
  validarSemMarkdown,
  validarSemJsonBruto,
  validarPrecoNaoInventado,
  validarSemFrasesProibidas,
  validarSemConcorrenteSemDado,
  validarSemTermosInternos,
  validarSemMencaoVictor,
  validarSemPrecoSobMedida,
  validarSemDadosSensiveisOuPagamento,
  validarLinksAutorizados,
  validarNaoVazio,
  validarSemResumoHandoffNoLead,
  validarCurta,
  validarUmaPerguntaPrincipal,
  validarSemConsultoriaLonga,
}
