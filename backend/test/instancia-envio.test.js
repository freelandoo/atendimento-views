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

test('guarda: o reenvio da rota de conversas declara a empresa do chamador', () => {
  // A rota e escopada por tenant, mas `conversaEmpresaScope` deixa a PJ alcancar conversa
  // ORFA (`empresa_id IS NULL`). Sem declarar `empresaId`, a unica empresa conferida seria a
  // da conversa — que ali e nula —, e o reenvio sairia pela instancia de OUTRO tenant gravada
  // nela. Mesma disciplina do envio manual do operador.
  const fonte = lerFonte('src', 'routes', 'api-conversas.js')
  const corpo = fonte.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
  assert.match(
    corpo,
    /instanceName: conversa\.evolution_instance, empresaId: req\.empresa\.id/,
    'o reenvio precisa conferir a instancia contra a empresa do chamador'
  )
  assert.match(
    corpo,
    /instanciaBloqueada[\s\S]{0,400}INSTANCE_UNAVAILABLE/,
    'bloqueio de instancia e 409 auditavel, nunca 502 de transporte'
  )
})

test('guarda: o teste de saudacao trata bloqueio de instancia como 409, nao como 502', () => {
  // O envio de teste e o unico ponto do modulo de instancias que manda mensagem REAL. Se o
  // bloqueio da regra unica virar 502, o operador le "falha ao enviar" e vai procurar problema
  // na Evolution, quando o problema esta no cadastro (instancia inativa, de outra empresa ou
  // de outro canal) e exige acao dele. Mesmo contrato do reenvio e do envio manual.
  const fonte = lerFonte('src', 'routes', 'api-whatsapp.js')
  const corpo = fonte.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
  assert.match(
    corpo,
    /instanciaBloqueada[\s\S]{0,300}INSTANCE_UNAVAILABLE/,
    'bloqueio de instancia e 409 auditavel, nunca 502 de transporte'
  )
  assert.match(
    corpo,
    /instanceName: inst\.evolution_instance,\s*empresaId: req\.empresa\.id/,
    'o envio de teste precisa conferir a instancia contra a empresa do chamador'
  )
})

test('guarda: as rotas legadas de QR nao leem mais a instancia do ambiente', () => {
  const fonte = lerFonte('src', 'whatsapp-routes.js')
  const corpo = fonte.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
  assert.doesNotMatch(corpo, /process\.env\.EVOLUTION_INSTANCE/)
  assert.doesNotMatch(corpo, /'PJ'/)
})

test('guarda: o status do painel legado resolve a instancia pelo VINCULO do usuario', () => {
  // O banner "WhatsApp desconectado" tinha ficado mudo: os dois consumidores chamam a rota sem
  // `?instancia=` e a resposta virava `connected: null`. Religar so podia ser feito por uma
  // fonte PROVADA — o vinculo do proprio usuario, o mesmo que as rotas de QR usam —, nunca
  // pelo env, por "a empresa so tem uma instancia" ou pela mais recentemente atualizada.
  const fonte = lerFonte('src', 'prospecting.js')
  const corpo = fonte.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
  assert.match(
    corpo,
    /instanciaVinculadaAoUsuario\(req\.dashboardUser\?\.id/,
    'sem `?instancia=`, o status precisa sair do vinculo do usuario logado'
  )
  assert.doesNotMatch(
    corpo,
    /verificarStatusInstanciaEvolution\(\s*\)/,
    'o diagnostico nunca volta a medir uma instancia implicita'
  )

  // A funcao e' UMA so: duas consultas ao mesmo vinculo poderiam divergir e o banner falaria de
  // um numero enquanto o botao "Reconectar" mexe em outro.
  const rotasQr = lerFonte('src', 'whatsapp-routes.js')
  assert.match(
    rotasQr,
    /module\.exports = \{[^}]*instanciaVinculadaAoUsuario/,
    'o resolvedor do vinculo legado tem dono unico e reusado, nunca copiado'
  )
})

test('guarda: o banner de desconexao nao carrega nome de instancia fixo no front', () => {
  // `dados.instance || 'pj-dashboard-1'` nomeava no aviso uma instancia que podia nao ser a
  // medida — acusar desconexao do numero errado e' pior que nao acusar.
  const fonte = lerFonte('public', 'dashboard', 'js', 'prospeccao.js')
  assert.doesNotMatch(fonte, /pj-dashboard-1/)
})
