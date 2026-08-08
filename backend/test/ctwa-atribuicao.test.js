'use strict'

const test = require('node:test')
const assert = require('node:assert')

const {
  ORIGEM_EMPRESA,
  MOTIVO,
  CAMPOS_AD_PERMITIDOS,
  empresaComprovada,
  localizarExternalAdReply,
  extrairDadosAnuncio,
  mascararCtwaClid,
  normalizarTelefone,
  avaliarAtribuicao,
  resumoDiagnostico,
  diagnosticoLigado,
} = require('../src/services/ctwa-atribuicao')

const EMPRESA = '11111111-1111-1111-1111-111111111111'
const INSTANCIA = '22222222-2222-2222-2222-222222222222'
const NUMERO = '5511988887777@s.whatsapp.net'

function msgDeAnuncio(overrides = {}) {
  return {
    key: { id: 'MSG-1', fromMe: false, remoteJid: NUMERO },
    message: {
      extendedTextMessage: {
        text: 'oi, vi o anuncio',
        contextInfo: {
          externalAdReply: {
            sourceId: 'ad-123',
            ctwaClid: 'ARBxyzCLID9999',
            title: 'Site profissional em 7 dias',
            sourceUrl: 'https://fb.me/xyz',
          },
        },
      },
    },
    ...overrides,
  }
}

function ctxBom(extra = {}) {
  return {
    empresaId: EMPRESA,
    empresaOrigem: ORIGEM_EMPRESA.INSTANCIA,
    instanciaId: INSTANCIA,
    evolutionInstance: 'inst-a',
    numero: NUMERO,
    ...extra,
  }
}

// ─── Localização do bloco no payload ──────────────────────────────────────────

test('acha externalAdReply no formato Baileys (message.<tipo>.contextInfo)', () => {
  const r = localizarExternalAdReply(msgDeAnuncio())
  assert.equal(r.encontrado, true)
  assert.equal(r.caminho, 'message.extendedTextMessage.contextInfo.externalAdReply')
  assert.deepEqual(r.campos.sort(), ['ctwaClid', 'sourceId', 'sourceUrl', 'title'])
})

test('acha externalAdReply no formato normalizado pelo Evolution (contextInfo no topo)', () => {
  const r = localizarExternalAdReply({
    key: { id: 'M', remoteJid: NUMERO },
    contextInfo: { externalAdReply: { sourceId: 'ad-9', ctwaClid: 'CLID' } },
    message: { conversation: 'oi' },
  })
  assert.equal(r.encontrado, true)
  assert.equal(r.caminho, 'contextInfo.externalAdReply')
})

test('acha externalAdReply em mensagem de imagem (o tipo do conteúdo varia)', () => {
  const r = localizarExternalAdReply({
    key: { id: 'M', remoteJid: NUMERO },
    message: { imageMessage: { contextInfo: { externalAdReply: { sourceId: 'ad-img' } } } },
  })
  assert.equal(r.encontrado, true)
  assert.equal(r.caminho, 'message.imageMessage.contextInfo.externalAdReply')
})

test('mensagem comum não tem externalAdReply', () => {
  const r = localizarExternalAdReply({ key: { id: 'M' }, message: { conversation: 'bom dia' } })
  assert.equal(r.encontrado, false)
  assert.equal(r.ad, null)
})

test('payload inválido não quebra a extração', () => {
  for (const v of [null, undefined, 'texto', 42, []]) {
    assert.equal(localizarExternalAdReply(v).encontrado, false)
  }
})

test('só nomes de campo da lista fechada são reportados', () => {
  const r = localizarExternalAdReply({
    key: { id: 'M' },
    contextInfo: {
      externalAdReply: { sourceId: 'ad', body: 'texto do criativo', campoNovoDesconhecido: 'x' },
    },
  })
  assert.deepEqual(r.campos, ['sourceId'])
  for (const c of r.campos) assert.ok(CAMPOS_AD_PERMITIDOS.includes(c))
})

test('bloco sem sourceId e sem ctwaClid não é atribuição', () => {
  const dados = extrairDadosAnuncio({
    key: { id: 'M' },
    contextInfo: { externalAdReply: { title: 'só um título' } },
  })
  assert.equal(dados, null)
})

// ─── Mascaramento ─────────────────────────────────────────────────────────────

test('mascararCtwaClid devolve só os 4 últimos', () => {
  assert.equal(mascararCtwaClid('ARBxyzCLID9999'), '…9999')
  assert.equal(mascararCtwaClid('abc'), '***')
  assert.equal(mascararCtwaClid(''), null)
  assert.equal(mascararCtwaClid(null), null)
})

test('normalizarTelefone deixa só dígitos', () => {
  assert.equal(normalizarTelefone('5511988887777@s.whatsapp.net'), '5511988887777')
  assert.equal(normalizarTelefone('+55 (11) 98888-7777'), '5511988887777')
  assert.equal(normalizarTelefone(''), null)
})

// ─── Procedência da empresa ───────────────────────────────────────────────────

test('só a resolução pela instância comprova a empresa', () => {
  assert.equal(empresaComprovada(ORIGEM_EMPRESA.INSTANCIA), true)
  assert.equal(empresaComprovada(ORIGEM_EMPRESA.SEM_INSTANCIA), false)
  assert.equal(empresaComprovada(ORIGEM_EMPRESA.INSTANCIA_DESCONHECIDA), false)
  assert.equal(empresaComprovada(ORIGEM_EMPRESA.ERRO_RESOLUCAO), false)
  assert.equal(empresaComprovada(undefined), false)
})

// ─── Decisão ──────────────────────────────────────────────────────────────────

test('mensagem de anúncio com empresa e instância comprovadas vira atribuição elegível', () => {
  const r = avaliarAtribuicao({ msg: msgDeAnuncio(), ...ctxBom() })
  assert.equal(r.capturar, true)
  assert.equal(r.elegivel, true)
  assert.equal(r.motivo, null)
  assert.equal(r.registro.empresaId, EMPRESA)
  assert.equal(r.registro.instanciaId, INSTANCIA)
  assert.equal(r.registro.telefoneNorm, '5511988887777')
  assert.equal(r.registro.mensagemId, 'MSG-1')
  assert.equal(r.registro.adId, 'ad-123')
  assert.equal(r.registro.ctwaClid, 'ARBxyzCLID9999')
  assert.equal(r.registro.ctwaClidHint, '…9999')
  assert.equal(r.registro.origemRegistro, 'webhook')
})

test('mensagem sem externalAdReply não vira atribuição nem motivo', () => {
  const r = avaliarAtribuicao({ msg: { key: { id: 'M' }, message: { conversation: 'oi' } }, ...ctxBom() })
  assert.equal(r.capturar, false)
  assert.equal(r.motivo, null)
  assert.equal(r.registro, null)
})

// Defesa em profundidade: hoje o webhook nem chega aqui nesses casos (a quarentena barra
// antes), mas a regra de atribuição continua recusando por conta própria. As duas camadas
// são independentes de propósito — uma falha na barreira não pode virar atribuição suja.
test('empresa sem origem comprovada não gera atribuição', () => {
  for (const origem of [
    ORIGEM_EMPRESA.SEM_INSTANCIA,
    ORIGEM_EMPRESA.INSTANCIA_DESCONHECIDA,
    ORIGEM_EMPRESA.ERRO_RESOLUCAO,
  ]) {
    const r = avaliarAtribuicao({ msg: msgDeAnuncio(), ...ctxBom({ empresaOrigem: origem }) })
    assert.equal(r.capturar, false, `origem ${origem} não pode capturar`)
    assert.equal(r.elegivel, false)
    assert.equal(r.motivo, MOTIVO.EMPRESA_NAO_COMPROVADA)
    assert.equal(r.registro, null)
  }
})

test('instância desconhecida (sem id) não gera atribuição', () => {
  const r = avaliarAtribuicao({ msg: msgDeAnuncio(), ...ctxBom({ instanciaId: null }) })
  assert.equal(r.capturar, false)
  assert.equal(r.motivo, MOTIVO.INSTANCIA_NAO_COMPROVADA)
})

test('telefone @lid não gera atribuição — não se traduz identificador opaco', () => {
  const r = avaliarAtribuicao({ msg: msgDeAnuncio(), ...ctxBom({ numero: '129384756@lid' }) })
  assert.equal(r.capturar, false)
  assert.equal(r.motivo, MOTIVO.TELEFONE_NAO_RESOLVIDO)
})

test('mensagem sem id não gera atribuição (não haveria chave de idempotência)', () => {
  const msg = msgDeAnuncio({ key: { fromMe: false, remoteJid: NUMERO } })
  const r = avaliarAtribuicao({ msg, ...ctxBom() })
  assert.equal(r.capturar, false)
  assert.equal(r.motivo, MOTIVO.SEM_ID_MENSAGEM)
})

test('anúncio sem ctwa_clid é capturado, mas NÃO é elegível para a Meta', () => {
  const msg = {
    key: { id: 'MSG-2', remoteJid: NUMERO },
    contextInfo: { externalAdReply: { sourceId: 'ad-sem-clid', title: 'x' } },
  }
  const r = avaliarAtribuicao({ msg, ...ctxBom() })
  assert.equal(r.capturar, true)
  assert.equal(r.elegivel, false)
  assert.equal(r.motivo, MOTIVO.SEM_CTWA_CLID)
  assert.equal(r.registro.elegivel, false)
  assert.equal(r.registro.ctwaClid, null)
})

test('empresas/instâncias diferentes produzem registros com donos diferentes', () => {
  const a = avaliarAtribuicao({ msg: msgDeAnuncio(), ...ctxBom() })
  const b = avaliarAtribuicao({
    msg: msgDeAnuncio(),
    ...ctxBom({ instanciaId: '33333333-3333-3333-3333-333333333333', evolutionInstance: 'inst-b' }),
  })
  assert.notEqual(a.registro.instanciaId, b.registro.instanciaId)
  assert.equal(a.registro.empresaId, b.registro.empresaId)
})

// ─── Diagnóstico sem PII ──────────────────────────────────────────────────────

test('resumoDiagnostico não carrega NENHUM dado sensível', () => {
  const resumo = resumoDiagnostico(msgDeAnuncio(), ctxBom())
  const serializado = JSON.stringify(resumo)
  for (const proibido of [
    '5511988887777',        // telefone
    '988887777',
    'ARBxyzCLID9999',       // ctwa_clid
    'ad-123',               // ad_id
    'oi, vi o anuncio',     // texto da mensagem
    'Site profissional',    // título do criativo
    'fb.me',                // url
    'MSG-1',                // id da mensagem
  ]) {
    assert.ok(!serializado.includes(proibido), `diagnóstico não pode conter "${proibido}"`)
  }
  assert.equal(resumo.tem_external_ad_reply, true)
  assert.equal(resumo.tem_ctwa_clid, true)
  assert.equal(resumo.tem_ad_id, true)
  assert.equal(resumo.telefone_resolvido, true)
  assert.deepEqual(resumo.tipos_conteudo, ['extendedTextMessage'])
})

test('resumoDiagnostico registra ausência sem quebrar', () => {
  const resumo = resumoDiagnostico({ key: { id: 'M' }, message: { conversation: 'oi' } }, {})
  assert.equal(resumo.tem_external_ad_reply, false)
  assert.equal(resumo.caminho_ad, null)
  assert.deepEqual(resumo.campos_ad, [])
  assert.equal(resumo.tem_instancia, false)
})

// ─── A estratégia antiga não pode voltar ──────────────────────────────────────
//
// Guarda de regressão sobre o CÓDIGO-FONTE. Não é preciosismo: a varredura de
// `public."Message"` rodou a cada tick do worker por meses sem produzir uma única
// atribuição, e o motivo (schema errado + campo inexistente + lead chegando como @lid)
// é invisível em runtime — a função simplesmente não fazia nada e não reclamava.

test('a varredura do banco do Evolution NÃO volta a ser usada', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const arquivos = [
    'src/services/meta-attribution.js',
    'src/services/meta-dispatch.js',
    'src/db/atribuicao-anuncios.js',
    'src/services/ctwa-atribuicao.js',
  ]
  for (const rel of arquivos) {
    const fonte = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
    // Só o CÓDIGO — os comentários explicam de propósito por que a estratégia morreu.
    const codigo = fonte
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n')
    assert.doesNotMatch(codigo, /public\."Message"/, `${rel} não pode consultar public."Message"`)
    assert.doesNotMatch(codigo, /to_regclass/, `${rel} não pode checar a tabela do Evolution`)
    assert.doesNotMatch(codigo, /remoteJidAlt/, `${rel} não pode depender de key.remoteJidAlt`)
    assert.doesNotMatch(codigo, /origem_anuncio/, `${rel} não pode ler a atribuição do perfil do lead`)
  }
})

test('diagnóstico é DESLIGADO por padrão', () => {
  assert.equal(diagnosticoLigado({}), false)
  assert.equal(diagnosticoLigado({ CTWA_WEBHOOK_DIAGNOSTICO: '' }), false)
  assert.equal(diagnosticoLigado({ CTWA_WEBHOOK_DIAGNOSTICO: 'off' }), false)
  assert.equal(diagnosticoLigado({ CTWA_WEBHOOK_DIAGNOSTICO: 'on' }), true)
  assert.equal(diagnosticoLigado({ CTWA_WEBHOOK_DIAGNOSTICO: 'true' }), true)
})
