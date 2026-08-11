'use strict'

/**
 * Fase 2 de `docs/analise-contexto-instancia.md` — a regra UNICA de resolucao da instancia
 * de envio.
 *
 * Dois blocos:
 *  1. a regra PURA (`src/services/instancia-envio.js`) — julgamento, sem banco;
 *  2. guardas de REGRESSAO que leem o fonte. O defeito que esta fase remove nao era um bug
 *     de calculo: era um fallback que parecia razoavel. Teste de comportamento nao impede
 *     alguem de reintroduzi-lo em outro caminho — a guarda que le o fonte, sim.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const {
  MOTIVOS_BLOQUEIO,
  ORIGENS_NOME,
  ErroInstanciaEnvio,
  normalizarNomeInstancia,
  canalDaInstancia,
  nomeParaEnvio,
  validarInstanciaParaEnvio,
} = require('../src/services/instancia-envio')

const EMPRESA_A = '11111111-1111-1111-1111-111111111111'
const EMPRESA_B = '22222222-2222-2222-2222-222222222222'

function instanciaAtiva(over = {}) {
  return {
    id: 'inst-1',
    empresa_id: EMPRESA_A,
    evolution_instance: 'empresa-a-vendas',
    ativo: true,
    config_json: {},
    ...over,
  }
}

// ─── 1. A REGRA PURA ─────────────────────────────────────────────────────────────

test('normalizarNomeInstancia aceita identificador Evolution e recusa o resto', () => {
  assert.equal(normalizarNomeInstancia('  empresa-a_1  '), 'empresa-a_1')
  assert.equal(normalizarNomeInstancia(''), '')
  assert.equal(normalizarNomeInstancia(null), '')
  for (const torto of ['nome com espaco', 'nome/../etc', 'nome;drop', 'nome@x']) {
    assert.throws(() => normalizarNomeInstancia(torto), ErroInstanciaEnvio)
  }
})

test('canalDaInstancia trata config ausente como WhatsApp e le JSON em texto', () => {
  assert.equal(canalDaInstancia({ config_json: null }), 'whatsapp')
  assert.equal(canalDaInstancia({ config_json: {} }), 'whatsapp')
  assert.equal(canalDaInstancia({ config_json: '{"canal":"freelandoo"}' }), 'freelandoo')
  assert.equal(canalDaInstancia({ config_json: 'nao e json' }), 'whatsapp')
})

test('nomeParaEnvio: explicita vence a conversa, e sem nenhuma das duas BLOQUEIA', () => {
  assert.deepEqual(
    nomeParaEnvio({ nomeSolicitado: 'escolhida', nomeDaConversa: 'gravada' }),
    { ok: true, nome: 'escolhida', origem: ORIGENS_NOME.EXPLICITA }
  )
  assert.deepEqual(
    nomeParaEnvio({ nomeDaConversa: 'gravada' }),
    { ok: true, nome: 'gravada', origem: ORIGENS_NOME.CONVERSA }
  )
  // O ponto da fase inteira: nao existe terceiro passo.
  assert.deepEqual(nomeParaEnvio({}), {
    ok: false,
    motivo: MOTIVOS_BLOQUEIO.SEM_VINCULO_COMPROVADO,
  })
})

test('validarInstanciaParaEnvio libera a instancia ativa, do canal certo e da mesma empresa', () => {
  const v = validarInstanciaParaEnvio({
    nome: 'empresa-a-vendas',
    origem: ORIGENS_NOME.CONVERSA,
    instancia: instanciaAtiva(),
    empresaIdDaConversa: EMPRESA_A,
    empresaIdDeclarada: EMPRESA_A,
    nomeDaConversa: 'empresa-a-vendas',
  })
  assert.equal(v.ok, true)
  assert.equal(v.instanceName, 'empresa-a-vendas')
  assert.equal(v.empresaId, EMPRESA_A)
  assert.equal(v.instanciaId, 'inst-1')
  assert.equal(v.divergeDaConversa, false)
})

test('validarInstanciaParaEnvio bloqueia desconhecida, inativa, de outra empresa e freelandoo', () => {
  const base = {
    nome: 'empresa-a-vendas',
    origem: ORIGENS_NOME.CONVERSA,
    empresaIdDaConversa: EMPRESA_A,
  }
  assert.equal(
    validarInstanciaParaEnvio({ ...base, instancia: null }).motivo,
    MOTIVOS_BLOQUEIO.INSTANCIA_DESCONHECIDA
  )
  assert.equal(
    validarInstanciaParaEnvio({ ...base, instancia: instanciaAtiva({ ativo: false }) }).motivo,
    MOTIVOS_BLOQUEIO.INSTANCIA_INATIVA
  )
  assert.equal(
    validarInstanciaParaEnvio({
      ...base,
      instancia: instanciaAtiva({ config_json: { canal: 'freelandoo' } }),
    }).motivo,
    MOTIVOS_BLOQUEIO.CANAL_INCOMPATIVEL
  )
  assert.equal(
    validarInstanciaParaEnvio({ ...base, instancia: instanciaAtiva({ empresa_id: EMPRESA_B } ) }).motivo,
    MOTIVOS_BLOQUEIO.INSTANCIA_DE_OUTRA_EMPRESA
  )
})

test('a empresa DECLARADA pelo chamador tambem bloqueia, mesmo com a conversa orfa', () => {
  // Conversa antiga, sem `empresa_id`: a instancia gravada nela e a prova do vinculo, entao
  // o envio segue. Mas se o CHAMADOR e de outro tenant, e bloqueio — senao a conversa orfa
  // viraria porta de entrada para o numero de outra empresa.
  const orfaOk = validarInstanciaParaEnvio({
    nome: 'empresa-a-vendas',
    origem: ORIGENS_NOME.CONVERSA,
    instancia: instanciaAtiva(),
    empresaIdDaConversa: null,
  })
  assert.equal(orfaOk.ok, true)
  assert.equal(orfaOk.empresaId, EMPRESA_A, 'o dono efetivo passa a ser o da instancia')

  const orfaComOutroChamador = validarInstanciaParaEnvio({
    nome: 'empresa-a-vendas',
    origem: ORIGENS_NOME.CONVERSA,
    instancia: instanciaAtiva(),
    empresaIdDaConversa: null,
    empresaIdDeclarada: EMPRESA_B,
  })
  assert.equal(orfaComOutroChamador.motivo, MOTIVOS_BLOQUEIO.INSTANCIA_DE_OUTRA_EMPRESA)
})

test('instancia diferente da gravada na conversa e ACEITA, mas fica sinalizada', () => {
  const v = validarInstanciaParaEnvio({
    nome: 'empresa-a-suporte',
    origem: ORIGENS_NOME.EXPLICITA,
    instancia: instanciaAtiva({ id: 'inst-2', evolution_instance: 'empresa-a-suporte' }),
    empresaIdDaConversa: EMPRESA_A,
    nomeDaConversa: 'empresa-a-vendas',
  })
  assert.equal(v.ok, true)
  assert.equal(v.divergeDaConversa, true, 'a divergencia precisa ser visivel no log')
})

test('ErroInstanciaEnvio carrega motivo, code e 409 (o contrato que a rota do operador ja usa)', () => {
  const err = new ErroInstanciaEnvio(MOTIVOS_BLOQUEIO.INSTANCIA_INATIVA)
  assert.equal(err.statusCode, 409)
  assert.equal(err.code, 'INSTANCIA_NAO_COMPROVADA')
  assert.equal(err.motivo, MOTIVOS_BLOQUEIO.INSTANCIA_INATIVA)
  assert.equal(err.instanciaBloqueada, true)
  assert.match(err.message, /nao esta ativa/i)
})

// ─── 2. GUARDAS DE REGRESSAO (leem o fonte) ──────────────────────────────────────

function lerFonte(...partes) {
  return fs.readFileSync(path.join(__dirname, '..', ...partes), 'utf8')
}

test('guarda: o modulo puro nao conhece env, "PJ", data nem contagem de instancias', () => {
  const fonte = lerFonte('src', 'services', 'instancia-envio.js')
  const corpo = fonte.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '') // sem comentarios
  assert.doesNotMatch(corpo, /process\.env/, 'a regra nao pode ler variavel de ambiente')
  assert.doesNotMatch(corpo, /'PJ'|"PJ"/, 'nenhum nome de instancia literal')
  assert.doesNotMatch(corpo, /atualizado_em|criado_em|ORDER BY/i, 'nao se escolhe instancia por data')
  assert.doesNotMatch(corpo, /require\(/, 'o modulo tem de continuar PURO (sem dependencias)')
})

test('guarda: whatsapp.js nao tem mais fallback global nem escolha por data', () => {
  const fonte = lerFonte('src', 'whatsapp.js')
  const corpo = fonte.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
  assert.doesNotMatch(corpo, /EVOLUTION_INSTANCE/, 'o fallback global de envio foi removido')
  assert.doesNotMatch(corpo, /INSTANCE_NAME/, 'a constante global de instancia foi removida')
  assert.doesNotMatch(corpo, /'PJ'|"PJ"/, 'nenhum nome de instancia literal no envio')
  assert.doesNotMatch(
    corpo,
    /ORDER BY[\s\S]{0,80}atualizado_em/i,
    'escolher "a instancia mais recentemente atualizada" e o defeito que esta fase remove'
  )
})

test('guarda: conversa-manual nao reimplementa a escolha de instancia', () => {
  const fonte = lerFonte('src', 'services', 'conversa-manual.js')
  const corpo = fonte.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
  assert.match(corpo, /resolverInstanciaEnvio/, 'ele precisa CONSUMIR a regra unica')
  assert.doesNotMatch(
    corpo,
    /empresa_whatsapp_instances/,
    'a escolha de instancia saiu daqui: duas implementacoes do mesmo julgamento divergem'
  )
})

test('guarda: D-8 — o webhook nao migra mais a instancia gravada na conversa', () => {
  const fonte = lerFonte('src', 'db-crud.js')
  assert.doesNotMatch(
    fonte,
    /evolution_instance\s*=\s*COALESCE\(\s*EXCLUDED\.evolution_instance/,
    'COALESCE(EXCLUDED, existente) faz a conversa MIGRAR de numero sozinha (D-8)'
  )
  assert.match(
    fonte,
    /evolution_instance\s*=\s*COALESCE\(NULLIF\(BTRIM\(vendas\.conversas\.evolution_instance\)/,
    'os tres writers precisam preservar a instancia ja gravada'
  )
})

test('guarda: os 4 envios da §2.4 deixaram de chamar sem contexto de instancia', () => {
  // Nao basta a regra central bloquear: os chamadores precisam DECLARAR o que sabem, senao
  // a instancia nunca e conferida contra a empresa certa.
  const followup = lerFonte('src', 'followup-execution.js')
  assert.match(followup, /enviarMensagem\(numero, textoFollowup, \{ empresaId/)

  const agenda = lerFonte('src', 'agenda.js')
  assert.doesNotMatch(
    agenda,
    /enviarMensagemFn\(numero, mensagem\)/,
    'lembrete e sugestao de reagendamento precisam levar instancia/empresa'
  )

  const prospect = lerFonte('src', 'prospecting.js')
  assert.doesNotMatch(
    prospect,
    /enviarMensagemFn\(telefone, mensagem\)/,
    'o disparo de prospeccao precisa levar a empresa do prospect'
  )
})

test('guarda: as rotas legadas de QR nao leem mais a instancia do ambiente', () => {
  const fonte = lerFonte('src', 'whatsapp-routes.js')
  const corpo = fonte.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
  assert.doesNotMatch(corpo, /process\.env\.EVOLUTION_INSTANCE/)
  assert.doesNotMatch(corpo, /'PJ'/)
})
