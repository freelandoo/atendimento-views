'use strict'

// Atribuição Click-to-WhatsApp (CTWA) capturada NO WEBHOOK — regras PURAS.
//
// POR QUE ESTE MÓDULO EXISTE (o que ele substitui)
// A atribuição anterior minerava a tabela do Evolution (`services/meta-attribution.js`,
// `sincronizarAtribuicaoMetaAds`). Ela NUNCA funcionou, e não por falta de dado —
// medido em produção em 2026-08-08, três causas empilhadas:
//   1. o código procurava `public."Message"`; a tabela do Evolution é `evolution."Message"`
//      (mesmo banco, outro schema). `to_regclass` devolvia null e a função era um
//      NO-OP silencioso a cada tick do worker;
//   2. o SQL lia o telefone de `key->>'remoteJidAlt'`, campo que NÃO EXISTE nesta versão
//      (a coluna `key` guarda só `{fromMe, id, remoteJid}`);
//   3. das 526 mensagens com `externalAdReply`, **100%** têm `remoteJid` terminando em
//      `@lid` — identificador opaco, sem tradução para telefone em `Contact`/`Chat`
//      (251 telefones de anúncio, ZERO casando com `vendas.conversas`).
//
// ONDE O DADO EXISTE JUNTO: no WEBHOOK. `vendas.conversas.numero` é `@s.whatsapp.net`
// em 100% das conversas — o payload traz o telefone que o banco do Evolution não
// persiste. E é também o único ponto em que o telefone real, a EMPRESA resolvida pela
// instância e a INSTÂNCIA de origem coexistem no mesmo instante.
//
// ESTE MÓDULO NÃO TEM BANCO, HTTP, IA NEM REDE. Só decide o que os dados significam.
//
// PRIVACIDADE — invariantes deste arquivo:
//   - nada aqui loga; quem loga é o chamador, e só com o que `resumoDiagnostico`
//     devolve (presença/ausência e NOMES de campo de uma lista fechada);
//   - o telefone é normalizado (só dígitos) antes de sair daqui e nunca é impresso;
//   - `ctwa_clid` é identificador de clique de uma pessoa: sai daqui em `ctwaClid`
//     (para o envio à Meta) e em `ctwaClidHint` (4 últimos, para tela). O valor
//     completo NUNCA pode ser devolvido por rota nem escrito em log.

// ─── Procedência da empresa resolvida no webhook ──────────────────────────────
//
// O vocabulário de procedência VIVE EM `services/webhook-quarentena.js`, que é quem
// decide o dono do webhook — aqui ele é só consumido. Foi ele que substituiu o fallback
// para a PJ: `middleware/tenant.js` devolvia o mesmo `req.empresaId` da PJ tanto quando a
// instância batia em `app.empresa_whatsapp_instances` quanto quando não batia, e os casos
// eram indistinguíveis do caso bom.
//
// Só `instancia` comprova a empresa. Os demais viram PENDÊNCIA e, para efeito de
// atribuição, valem o mesmo que "não sei de quem é este lead".
//
// Reexportados abaixo por compatibilidade: quem já importava `ORIGEM_EMPRESA` deste
// módulo continua funcionando, sem uma segunda definição para manter em sincronia.
const { ORIGEM_EMPRESA, ORIGENS_EMPRESA, empresaComprovada } = require('./webhook-quarentena')

// ─── Motivos de descarte / não-elegibilidade (auditáveis, sem PII) ────────────
const MOTIVO = Object.freeze({
  EMPRESA_NAO_COMPROVADA: 'empresa_nao_comprovada',
  INSTANCIA_NAO_COMPROVADA: 'instancia_nao_comprovada',
  TELEFONE_NAO_RESOLVIDO: 'telefone_nao_resolvido',
  SEM_ID_MENSAGEM: 'sem_id_mensagem',
  SEM_CTWA_CLID: 'sem_ctwa_clid',
})

const MOTIVOS = Object.freeze(Object.values(MOTIVO))

// ─── Extração do externalAdReply do payload ───────────────────────────────────
//
// O bloco pode chegar em dois formatos, e o código aceita OS DOIS de propósito:
//   A. `data.contextInfo.externalAdReply` — o Evolution normaliza `contextInfo` para o
//      topo do registro da mensagem (é dessa normalização que nasce a coluna
//      `evolution."Message"."contextInfo"`);
//   B. `data.message.<tipoDaMensagem>.contextInfo.externalAdReply` — o lugar nativo do
//      Baileys, que varia com o tipo (`extendedTextMessage`, `imageMessage`, …).
// Escolher um formato só exigiria saber de antemão qual a versão do Evolution emite;
// varrer os dois custa um laço sobre meia dúzia de chaves e não pode errar.

/** Chaves do externalAdReply que este sistema conhece. Nada fora desta lista é lido. */
const CAMPOS_AD_PERMITIDOS = Object.freeze([
  'sourceId',
  'ctwaClid',
  'title',
  'sourceUrl',
  'sourceType',
  'mediaType',
])

function ehObjeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function texto(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s || null
}

/**
 * Acha o `externalAdReply` no payload da mensagem.
 * @returns {{ encontrado: boolean, caminho: string|null, campos: string[], ad: object|null }}
 *   `caminho` é o lugar onde foi achado (ex.: `contextInfo` ou
 *   `message.extendedTextMessage.contextInfo`) — serve ao diagnóstico e não contém dado.
 */
function localizarExternalAdReply(msg) {
  const vazio = { encontrado: false, caminho: null, campos: [], ad: null }
  if (!ehObjeto(msg)) return vazio

  const candidatos = []
  // A. contextInfo no topo (formato normalizado pelo Evolution).
  if (ehObjeto(msg.contextInfo)) candidatos.push(['contextInfo', msg.contextInfo])
  // B. contextInfo dentro do conteúdo, por tipo de mensagem (formato Baileys).
  if (ehObjeto(msg.message)) {
    if (ehObjeto(msg.message.contextInfo)) candidatos.push(['message.contextInfo', msg.message.contextInfo])
    for (const [tipo, conteudo] of Object.entries(msg.message)) {
      if (tipo === 'contextInfo') continue
      if (ehObjeto(conteudo) && ehObjeto(conteudo.contextInfo)) {
        candidatos.push([`message.${tipo}.contextInfo`, conteudo.contextInfo])
      }
    }
  }

  for (const [caminho, contextInfo] of candidatos) {
    const ad = contextInfo.externalAdReply
    if (!ehObjeto(ad)) continue
    // Só os nomes de uma lista fechada saem daqui — inclusive para o diagnóstico.
    const campos = CAMPOS_AD_PERMITIDOS.filter((c) => texto(ad[c]) != null)
    return { encontrado: true, caminho: `${caminho}.externalAdReply`, campos, ad }
  }
  return vazio
}

/** Os dados do anúncio, já normalizados. `null` quando a mensagem não veio de anúncio. */
function extrairDadosAnuncio(msg) {
  const { encontrado, ad, caminho } = localizarExternalAdReply(msg)
  if (!encontrado) return null
  const adId = texto(ad.sourceId)
  const ctwaClid = texto(ad.ctwaClid)
  // Bloco presente mas sem NENHUM identificador não é atribuição de coisa nenhuma.
  if (!adId && !ctwaClid) return null
  return {
    adId,
    ctwaClid,
    titulo: texto(ad.title),
    sourceUrl: texto(ad.sourceUrl),
    sourceType: texto(ad.sourceType),
    caminho,
  }
}

// ─── Mascaramento ─────────────────────────────────────────────────────────────

/**
 * Dica do ctwa_clid para leitura humana: 4 últimos caracteres. É o mesmo contrato do
 * `token_hint` da credencial da Meta — o valor completo não sai do banco.
 */
function mascararCtwaClid(valor) {
  const s = texto(valor)
  if (!s) return null
  if (s.length <= 4) return '*'.repeat(s.length)
  return `…${s.slice(-4)}`
}

/** Telefone só com dígitos. Chave de junção com a reunião; nunca é impresso em log. */
function normalizarTelefone(valor) {
  const d = String(valor == null ? '' : valor).replace(/\D/g, '')
  return d || null
}

// ─── Decisão ──────────────────────────────────────────────────────────────────

/**
 * Decide o que fazer com uma mensagem recebida no webhook.
 *
 * REGRA CENTRAL: atribuição só é ELEGÍVEL (utilizável pela Meta) quando a empresa E a
 * instância de origem estiverem COMPROVADAS. Empresa/instância NUNCA são inferidas pelo
 * telefone — é justamente o atalho que fez a integração anterior misturar tenants.
 *
 * Três desfechos possíveis:
 *   1. `capturar:false, motivo:null`  → a mensagem não veio de anúncio. Nada acontece.
 *   2. `capturar:false, motivo:'…'`   → veio de anúncio, mas não há onde gravar com
 *      segurança (empresa/instância/telefone/id ausentes). NÃO cria linha: escrever um
 *      telefone sob uma empresa que não foi comprovada é exatamente o dado sujo que esta
 *      tarefa existe para não produzir. O chamador registra o motivo em log, sem PII.
 *   3. `capturar:true`                → há empresa e instância comprovadas. Vira linha.
 *      `elegivel` diz se a Meta pode usar: sem `ctwa_clid` não há como enviar conversão,
 *      então a linha nasce como não-elegível e com motivo — visível, mas nunca enviada.
 *
 * @param {object} entrada
 * @param {object} entrada.msg              mensagem crua do webhook
 * @param {string} entrada.empresaId        req.empresaId
 * @param {string} entrada.empresaOrigem    req.empresaOrigem (ORIGEM_EMPRESA)
 * @param {string} entrada.instanciaId      uuid de app.empresa_whatsapp_instances
 * @param {string} entrada.evolutionInstance nome cru da instância (auditoria)
 * @param {string} entrada.numero           JID canônico já resolvido pelo webhook
 */
function avaliarAtribuicao(entrada = {}) {
  const { msg, empresaId, empresaOrigem, instanciaId, evolutionInstance, numero } = entrada

  const anuncio = extrairDadosAnuncio(msg)
  if (!anuncio) return { capturar: false, elegivel: false, motivo: null, anuncio: null, registro: null }

  const recusar = (motivo) => ({ capturar: false, elegivel: false, motivo, anuncio, registro: null })

  // 1. Empresa comprovada pela instância — nunca por fallback, nunca pelo telefone.
  if (!empresaId || !empresaComprovada(empresaOrigem)) return recusar(MOTIVO.EMPRESA_NAO_COMPROVADA)
  // 2. Instância com identificador confiável (app.empresa_whatsapp_instances.id).
  if (!instanciaId) return recusar(MOTIVO.INSTANCIA_NAO_COMPROVADA)
  // 3. Telefone real. `@lid` não serve: é o identificador opaco que inviabilizou a
  //    mineração do banco do Evolution, e traduzi-lo por conta própria seria inventar.
  const telefoneNorm = /@s\.whatsapp\.net$/i.test(String(numero || '')) ? normalizarTelefone(numero) : null
  if (!telefoneNorm) return recusar(MOTIVO.TELEFONE_NAO_RESOLVIDO)
  // 4. Id da mensagem: é a chave de idempotência. Sem ele, capturar duas vezes o mesmo
  //    clique viraria duas linhas — e não há como saber qual é a repetida.
  const mensagemId = texto(msg?.key?.id)
  if (!mensagemId) return recusar(MOTIVO.SEM_ID_MENSAGEM)

  const elegivel = !!anuncio.ctwaClid
  return {
    capturar: true,
    elegivel,
    motivo: elegivel ? null : MOTIVO.SEM_CTWA_CLID,
    anuncio,
    registro: {
      empresaId,
      instanciaId,
      evolutionInstance: texto(evolutionInstance),
      telefoneNorm,
      mensagemId,
      adId: anuncio.adId,
      ctwaClid: anuncio.ctwaClid,
      ctwaClidHint: mascararCtwaClid(anuncio.ctwaClid),
      titulo: anuncio.titulo,
      sourceUrl: anuncio.sourceUrl,
      elegivel,
      motivo: elegivel ? null : MOTIVO.SEM_CTWA_CLID,
      origemRegistro: 'webhook',
    },
  }
}

// ─── Observabilidade TEMPORÁRIA (sem PII) ─────────────────────────────────────
//
// Existe para responder uma única pergunta em produção: `externalAdReply` chega mesmo
// no payload do webhook? Ligada por env (`CTWA_WEBHOOK_DIAGNOSTICO`), desligada por
// padrão, e some quando a resposta for obtida.
//
// O QUE ESTE RESUMO PODE CONTER: booleanos, contagens, NOMES de campo de uma lista
// fechada e o CAMINHO onde o bloco foi achado. O que ele nunca pode conter: telefone,
// texto de mensagem, `ctwa_clid`, `ad_id`, URL, título, id de mensagem ou payload cru.

/** @returns {object} resumo seguro para log. Sem um único valor de dado. */
function resumoDiagnostico(msg, contexto = {}) {
  const local = localizarExternalAdReply(msg)
  const conteudo = ehObjeto(msg?.message) ? Object.keys(msg.message) : []
  return {
    operation: 'ctwa_webhook_diag',
    tem_message: conteudo.length > 0,
    // Nomes de TIPO de mensagem (extendedTextMessage, imageMessage…). Não são dados.
    tipos_conteudo: conteudo.slice(0, 8),
    tem_context_info_topo: ehObjeto(msg?.contextInfo),
    tem_external_ad_reply: local.encontrado,
    caminho_ad: local.caminho,
    campos_ad: local.campos,
    tem_ad_id: local.encontrado && local.campos.includes('sourceId'),
    tem_ctwa_clid: local.encontrado && local.campos.includes('ctwaClid'),
    empresa_origem: contexto.empresaOrigem || null,
    tem_instancia: !!contexto.instanciaId,
    telefone_resolvido: /@s\.whatsapp\.net$/i.test(String(contexto.numero || '')),
  }
}

/** A observabilidade temporária está ligada? Lida a cada mensagem (sem restart). */
function diagnosticoLigado(env = process.env) {
  const v = String(env.CTWA_WEBHOOK_DIAGNOSTICO || '').trim().toLowerCase()
  return v === 'on' || v === '1' || v === 'true' || v === 'sim'
}

module.exports = {
  ORIGEM_EMPRESA,
  ORIGENS_EMPRESA,
  MOTIVO,
  MOTIVOS,
  CAMPOS_AD_PERMITIDOS,
  empresaComprovada,
  localizarExternalAdReply,
  extrairDadosAnuncio,
  mascararCtwaClid,
  normalizarTelefone,
  avaliarAtribuicao,
  resumoDiagnostico,
  diagnosticoLigado,
}
