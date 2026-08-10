'use strict'

// Politica de resposta da conversa: modo padrao GLOBAL da Central + EXCECAO por conversa.
//
// Alem das regras puras, este arquivo carrega as GUARDAS DE REGRESSAO do modulo: elas leem
// o fonte e falham se (a) a comparacao de modo for reimplementada fora do dono, (b) um
// caminho de resposta conversacional deixar de consultar a politica, ou (c) follow-up e
// agenda passarem a depender do modo. Sao as maneiras conhecidas de esta feature vazar
// mensagem para o cliente ou virar, sem querer, uma pausa global de automacao.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const {
  MODOS_IA,
  MODOS_IA_VALIDOS,
  MODO_GLOBAL_PADRAO,
  PREFERENCIAS,
  PREFERENCIAS_VALIDAS,
  PREFERENCIA_PADRAO,
  ORIGEM_MODO,
  CAPACIDADES,
  MOTIVO_BLOQUEIO,
  modoValido,
  preferenciaValida,
  normalizarModo,
  normalizarPreferencia,
  temExcecao,
  modoEfetivo,
  resolverModoGlobal,
  permite,
  avaliarEnvio,
  mascararNumero,
  resumoBloqueio,
} = require('../src/services/conversa-modo-ia')

const SRC = path.join(__dirname, '..', 'src')
const DONO = path.join(SRC, 'services', 'conversa-modo-ia.js')

// ─── Vocabulario ──────────────────────────────────────────────────────────────

test('modo e preferencia sao listas DIFERENTES: herdar nao e um modo', () => {
  assert.deepStrictEqual(MODOS_IA_VALIDOS, ['conversa', 'analise'])
  assert.deepStrictEqual(PREFERENCIAS_VALIDAS, ['herdar', 'conversa', 'analise'])
  assert.strictEqual(modoValido('herdar'), false, 'herdar nao pode ser aceito como modo')
  assert.ok(preferenciaValida('herdar'))
})

test('os padroes: global de fabrica e conversa, preferencia de fabrica e herdar', () => {
  assert.strictEqual(MODO_GLOBAL_PADRAO, MODOS_IA.CONVERSA)
  assert.strictEqual(PREFERENCIA_PADRAO, PREFERENCIAS.HERDAR)
})

test('normalizarModo nunca devolve herdar, nem quando recebe herdar', () => {
  // Se `herdar` escapasse como modo, a matriz de permissoes nao teria entrada para ele e o
  // sistema quebraria — ou pior, liberaria por omissao.
  assert.strictEqual(normalizarModo('herdar'), MODOS_IA.CONVERSA)
  assert.strictEqual(normalizarModo(null), MODOS_IA.CONVERSA)
  assert.strictEqual(normalizarModo('inexistente'), MODOS_IA.CONVERSA)
  assert.strictEqual(normalizarModo(' ANALISE '), MODOS_IA.ANALISE)
})

test('normalizarPreferencia cai em herdar, nunca em conversa/analise', () => {
  // "Ausencia de excecao" precisa ser herdar. Cair em `conversa` faria a conversa virar
  // excecao explicita e o modo global nunca mais a alcancaria.
  for (const lixo of [null, undefined, '', 'pausado', 7, {}]) {
    assert.strictEqual(normalizarPreferencia(lixo), PREFERENCIAS.HERDAR)
  }
  assert.strictEqual(normalizarPreferencia('  Analise '), PREFERENCIAS.ANALISE)
})

test('temExcecao distingue escolha explicita de heranca', () => {
  assert.strictEqual(temExcecao('herdar'), false)
  assert.strictEqual(temExcecao(null), false)
  assert.ok(temExcecao('conversa'))
  assert.ok(temExcecao('analise'))
})

// ─── Modo efetivo: a matriz completa ──────────────────────────────────────────

const MATRIZ = [
  // preferencia,  global,     modo efetivo, origem
  ['herdar',      'conversa', 'conversa',   ORIGEM_MODO.HERDADO],
  ['herdar',      'analise',  'analise',    ORIGEM_MODO.HERDADO],
  ['conversa',    'conversa', 'conversa',   ORIGEM_MODO.EXCECAO],
  ['conversa',    'analise',  'conversa',   ORIGEM_MODO.EXCECAO],
  ['analise',     'conversa', 'analise',    ORIGEM_MODO.EXCECAO],
  ['analise',     'analise',  'analise',    ORIGEM_MODO.EXCECAO],
]

for (const [preferencia, modoGlobal, esperado, origem] of MATRIZ) {
  test(`modo efetivo: preferencia=${preferencia} + global=${modoGlobal} => ${esperado} (${origem})`, () => {
    const r = modoEfetivo({ preferencia, modoGlobal })
    assert.strictEqual(r.modo, esperado)
    assert.strictEqual(r.origem, origem)
    assert.strictEqual(r.preferencia, preferencia)
    assert.strictEqual(r.modo_global, modoGlobal)
  })
}

test('conversa em herdar ACOMPANHA a troca do modo global', () => {
  assert.strictEqual(modoEfetivo({ preferencia: 'herdar', modoGlobal: 'conversa' }).modo, 'conversa')
  assert.strictEqual(modoEfetivo({ preferencia: 'herdar', modoGlobal: 'analise' }).modo, 'analise')
})

test('excecao explicita RESISTE a troca do modo global, nos dois sentidos', () => {
  // O criterio de aceite central: quem escolheu, escolheu.
  assert.strictEqual(modoEfetivo({ preferencia: 'analise', modoGlobal: 'conversa' }).modo, 'analise')
  assert.strictEqual(modoEfetivo({ preferencia: 'conversa', modoGlobal: 'analise' }).modo, 'conversa')
})

test('modo efetivo sem argumento nenhum e o comportamento historico', () => {
  const r = modoEfetivo()
  assert.strictEqual(r.modo, MODOS_IA.CONVERSA)
  assert.strictEqual(r.origem, ORIGEM_MODO.HERDADO)
})

// ─── Fallback de leitura do global ────────────────────────────────────────────

test('fallback: leitura fresca sempre vence', () => {
  const r = resolverModoGlobal({ lido: 'analise', ultimoConhecido: 'conversa' })
  assert.deepStrictEqual(r, { modo: 'analise', fonte: 'leitura' })
})

test('fallback: falha de leitura serve o ultimo valor conhecido, mesmo vencido', () => {
  // Um erro transitorio de banco nao pode soltar o bot numa Central posta em Analise.
  const r = resolverModoGlobal({ lido: null, ultimoConhecido: 'analise' })
  assert.deepStrictEqual(r, { modo: 'analise', fonte: 'cache_vencido' })
})

test('fallback: sem leitura e sem cache, cai no padrao de fabrica', () => {
  const r = resolverModoGlobal({ lido: null, ultimoConhecido: null })
  assert.deepStrictEqual(r, { modo: MODO_GLOBAL_PADRAO, fonte: 'padrao' })
  assert.deepStrictEqual(resolverModoGlobal(), { modo: MODO_GLOBAL_PADRAO, fonte: 'padrao' })
})

test('fallback: valor invalido no cache nao contamina o resultado', () => {
  assert.deepStrictEqual(
    resolverModoGlobal({ lido: null, ultimoConhecido: 'herdar' }),
    { modo: MODO_GLOBAL_PADRAO, fonte: 'padrao' }
  )
})

// ─── Matriz de capacidades ────────────────────────────────────────────────────

test('modo conversa permite as quatro capacidades', () => {
  for (const cap of Object.values(CAPACIDADES)) {
    assert.ok(permite(MODOS_IA.CONVERSA, cap), `conversa deveria permitir ${cap}`)
  }
})

test('modo analise bloqueia SO a resposta conversacional', () => {
  assert.strictEqual(permite(MODOS_IA.ANALISE, CAPACIDADES.RESPOSTA_CONVERSACIONAL), false)
  assert.ok(permite(MODOS_IA.ANALISE, CAPACIDADES.ANALISE))
})

test('modo analise NAO e pausa global: follow-up e agenda seguem permitidos', () => {
  assert.ok(permite(MODOS_IA.ANALISE, CAPACIDADES.FOLLOW_UP))
  assert.ok(permite(MODOS_IA.ANALISE, CAPACIDADES.AGENDA))
})

test('capacidade desconhecida e negada, nao permitida por omissao', () => {
  assert.strictEqual(permite(MODOS_IA.CONVERSA, 'capacidade_que_nao_existe'), false)
})

// ─── Veredito de envio ────────────────────────────────────────────────────────

test('avaliarEnvio assume resposta conversacional quando a capacidade e omitida', () => {
  const r = avaliarEnvio({ preferencia: 'analise' })
  assert.strictEqual(r.permitido, false)
  assert.strictEqual(r.capacidade, CAPACIDADES.RESPOSTA_CONVERSACIONAL)
  assert.strictEqual(r.motivo, MOTIVO_BLOQUEIO.MODO_ANALISE)
})

test('avaliarEnvio bloqueia por HERANCA quando so a Central esta em analise', () => {
  const r = avaliarEnvio({ preferencia: 'herdar', modoGlobal: 'analise' })
  assert.strictEqual(r.permitido, false)
  assert.strictEqual(r.origem, ORIGEM_MODO.HERDADO)
})

test('avaliarEnvio LIBERA excecao "conversa" com a Central em analise', () => {
  const r = avaliarEnvio({ preferencia: 'conversa', modoGlobal: 'analise' })
  assert.strictEqual(r.permitido, true)
  assert.strictEqual(r.origem, ORIGEM_MODO.EXCECAO)
})

test('avaliarEnvio libera follow-up em qualquer combinacao de modo', () => {
  for (const [preferencia, modoGlobal] of MATRIZ.map(([p, g]) => [p, g])) {
    const r = avaliarEnvio({ preferencia, modoGlobal, capacidade: CAPACIDADES.FOLLOW_UP })
    assert.strictEqual(r.permitido, true, `follow-up barrado em ${preferencia}/${modoGlobal}`)
  }
})

test('avaliarEnvio sem argumento nenhum libera (conversa nova, Central no padrao)', () => {
  assert.strictEqual(avaliarEnvio().permitido, true)
  assert.strictEqual(avaliarEnvio({}).permitido, true)
})

// ─── Log sem PII ──────────────────────────────────────────────────────────────

test('mascararNumero devolve so os 4 ultimos digitos', () => {
  assert.strictEqual(mascararNumero('5511988887777@s.whatsapp.net'), '***7777')
  assert.strictEqual(mascararNumero(''), null)
  assert.strictEqual(mascararNumero(null), null)
})

test('resumoBloqueio nao carrega telefone, JID nem texto — e diz a ORIGEM', () => {
  // "Bloqueou porque a Central esta em Analise" e "porque esta conversa tem excecao" pedem
  // acoes diferentes de quem investiga.
  const resumo = resumoBloqueio({
    empresaId: 'e1',
    numero: '5511988887777@s.whatsapp.net',
    modo: MODOS_IA.ANALISE,
    origem: ORIGEM_MODO.HERDADO,
  })
  const serializado = JSON.stringify(resumo)
  assert.ok(!serializado.includes('5511988887777'), 'telefone em claro no log')
  assert.ok(!serializado.includes('@s.whatsapp.net'), 'JID no log')
  assert.strictEqual(resumo.numero_mascarado, '***7777')
  assert.strictEqual(resumo.origem, ORIGEM_MODO.HERDADO)
  assert.strictEqual(resumo.motivo, MOTIVO_BLOQUEIO.MODO_ANALISE)
})

// ─── Guardas de regressao (leem o fonte) ──────────────────────────────────────

function arquivosJs(dir, acc = []) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entrada.name)
    if (entrada.isDirectory()) arquivosJs(p, acc)
    else if (entrada.name.endsWith('.js')) acc.push(p)
  }
  return acc
}

test('guarda: a comparacao de modo nao e duplicada fora do modulo dono', () => {
  // O defeito que esta guarda previne: alguem escrever `if (conversa.modo_ia === 'analise')`
  // num fluxo novo. A regra passaria a existir em dois lugares e sairia de sincronia com a
  // precedencia (excecao > global) e com a matriz de capacidades.
  const suspeitos = []
  for (const arquivo of arquivosJs(SRC)) {
    if (arquivo === DONO) continue
    fs.readFileSync(arquivo, 'utf8').split('\n').forEach((linha, i) => {
      const comparaComLiteral = /modo_ia[^\n]{0,40}['"](herdar|analise|conversa)['"]/.test(linha)
        || /['"](herdar|analise|conversa)['"][^\n]{0,40}modo_ia/.test(linha)
      if (comparaComLiteral) suspeitos.push(`${path.relative(SRC, arquivo)}:${i + 1}`)
    })
  }
  assert.deepStrictEqual(
    suspeitos, [],
    `Comparacao de modo duplicada. Use o modulo services/conversa-modo-ia.js em: ${suspeitos.join(', ')}`
  )
})

test('guarda: os dois caminhos de resposta conversacional consultam a politica', () => {
  // Se um enviador parar de consultar, a conversa em modo Analise volta a falar com o
  // cliente. Sao os DOIS motores: o funil legado e o playbook multiempresa.
  for (const arquivo of [path.join(SRC, 'core-funnel.js'), path.join(SRC, 'services', 'contexto2-responder.js')]) {
    const fonte = fs.readFileSync(arquivo, 'utf8')
    assert.match(fonte, /require\((['"]).{0,20}conversa-modo-ia\1\)/,
      `${path.basename(arquivo)} deixou de importar a politica de resposta`)
    assert.match(fonte, /avaliarEnvio\(/,
      `${path.basename(arquivo)} deixou de consultar avaliarEnvio() antes do envio`)
  }
})

test('guarda: o veredito considera preferencia E modo global nos dois enviadores', () => {
  // Consultar so a preferencia faria a conversa em `herdar` ignorar a Central — o modo
  // global viraria enfeite.
  for (const arquivo of [path.join(SRC, 'core-funnel.js'), path.join(SRC, 'services', 'contexto2-responder.js')]) {
    const fonte = fs.readFileSync(arquivo, 'utf8')
    assert.match(fonte, /avaliarEnvio\(\{[^}]*preferencia:/s, `${path.basename(arquivo)}: sem preferencia no veredito`)
    assert.match(fonte, /avaliarEnvio\(\{[^}]*modoGlobal/s, `${path.basename(arquivo)}: sem modo global no veredito`)
  }
})

test('guarda: o modo global e lido UMA vez por turno, no funil', () => {
  // O enviador do playbook recebe o valor ja resolvido. Se ele voltar a ler sozinho, sao
  // duas leituras por turno e duas chances de divergir dentro do mesmo turno.
  const responder = fs.readFileSync(path.join(SRC, 'services', 'contexto2-responder.js'), 'utf8')
  assert.ok(!/modoIaPadraoEmpresa/.test(responder),
    'contexto2-responder.js deve RECEBER o modo global do funil, nao le-lo')
  assert.match(fs.readFileSync(path.join(SRC, 'core-funnel.js'), 'utf8'), /modoIaPadraoEmpresa/)
})

test('guarda: o gate do funil legado fica DEPOIS da geracao, nao antes da analise', () => {
  const fonte = fs.readFileSync(path.join(SRC, 'core-funnel.js'), 'utf8')
  const posGate = fonte.indexOf('const reterMensagem = !entregaPermitida')
  const posEnvio = fonte.indexOf('respostaEnviadaAoLead = true')
  assert.ok(posGate > 0, 'o gate de entrega sumiu de core-funnel.js')
  assert.ok(posEnvio > posGate, 'o envio deveria acontecer depois da decisao de entrega')
})

test('guarda: follow-up declara a propria capacidade e nao e barrado pelo toggle', () => {
  const fonte = fs.readFileSync(path.join(SRC, 'followup-execution.js'), 'utf8')
  assert.match(fonte, /capacidade:\s*CAPACIDADES\.FOLLOW_UP/)
})

test('guarda: follow-up automatico e agenda nao consultam modo nem preferencia', () => {
  // Regra de produto: as duas automacoes tem ativacao propria. Se qualquer um destes
  // arquivos passar a olhar o modo, o toggle vira pausa global sem ninguem decidir isso.
  for (const arquivo of ['followup-auto.js', 'agenda.js']) {
    const fonte = fs.readFileSync(path.join(SRC, arquivo), 'utf8')
    assert.ok(!/modo_ia/.test(fonte), `${arquivo} passou a depender do modo da conversa`)
    assert.ok(!/conversa-modo-ia/.test(fonte), `${arquivo} passou a importar a politica de modo`)
  }
})

test('guarda: a pausa humana nao escreve preferencia', () => {
  // `enviarMensagemManualOperador` liga `agente_pausado`. Se ele passar a mexer em
  // `modo_ia`, uma unica mensagem do atendente viraria excecao permanente da conversa.
  const fonte = fs.readFileSync(path.join(SRC, 'services', 'conversa-manual.js'), 'utf8')
  const trecho = fonte.slice(
    fonte.indexOf('async function enviarMensagemManualOperador'),
    fonte.indexOf('async function alterarPausaAgenteConversa')
  )
  assert.ok(trecho.length > 0, 'nao encontrei o envio manual do operador')
  assert.ok(!/modo_ia/.test(trecho), 'o envio manual do operador passou a escrever modo_ia')

  const trechoPausa = fonte.slice(
    fonte.indexOf('async function alterarPausaAgenteConversa'),
    fonte.indexOf('async function alterarModoIaConversa')
  )
  assert.ok(!/modo_ia/.test(trechoPausa), 'pausar/retomar o agente passou a escrever modo_ia')
})
