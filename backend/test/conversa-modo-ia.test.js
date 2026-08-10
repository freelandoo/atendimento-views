'use strict'

// Politica de resposta da conversa (modo Conversa / Analise).
//
// Alem das regras puras, este arquivo carrega as GUARDAS DE REGRESSAO do modulo: elas leem
// o fonte e falham se (a) a comparacao de modo for reimplementada fora do dono, ou (b) um
// caminho de resposta conversacional deixar de consultar a politica. Sao as duas maneiras
// conhecidas de esta feature voltar a vazar mensagem para o cliente.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const {
  MODOS_IA,
  MODOS_IA_VALIDOS,
  MODO_IA_PADRAO,
  CAPACIDADES,
  MOTIVO_BLOQUEIO,
  modoValido,
  normalizarModo,
  permite,
  avaliarEnvio,
  mascararNumero,
  resumoBloqueio,
} = require('../src/services/conversa-modo-ia')

const SRC = path.join(__dirname, '..', 'src')
const DONO = path.join(SRC, 'services', 'conversa-modo-ia.js')

// ─── Vocabulario ──────────────────────────────────────────────────────────────

test('modo padrao e conversa: o comportamento historico e o default', () => {
  assert.strictEqual(MODO_IA_PADRAO, MODOS_IA.CONVERSA)
  assert.deepStrictEqual(MODOS_IA_VALIDOS, ['conversa', 'analise'])
})

test('modoValido aceita so a lista fechada', () => {
  assert.ok(modoValido('conversa'))
  assert.ok(modoValido('analise'))
  assert.ok(modoValido(' ANALISE '))
  for (const invalido of ['', 'pausado', 'off', 'analise_total', null, undefined, 3, {}, ['analise']]) {
    assert.strictEqual(modoValido(invalido), false, `deveria recusar: ${JSON.stringify(invalido)}`)
  }
})

test('normalizarModo cai no padrao em vez de bloquear quando o valor e desconhecido', () => {
  // Um dado ausente ou corrompido nunca pode CALAR uma conversa que ninguem configurou.
  assert.strictEqual(normalizarModo(null), MODOS_IA.CONVERSA)
  assert.strictEqual(normalizarModo(undefined), MODOS_IA.CONVERSA)
  assert.strictEqual(normalizarModo('inexistente'), MODOS_IA.CONVERSA)
  assert.strictEqual(normalizarModo('Análise'), MODOS_IA.CONVERSA) // com acento nao e o valor do banco
  assert.strictEqual(normalizarModo('  Analise  '), MODOS_IA.ANALISE)
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
  // Regra de produto explicita. Follow-up e agenda tem ativacao propria; se um dia alguem
  // "aproveitar" o modo Analise como interruptor geral de automacao, este teste cai.
  assert.ok(permite(MODOS_IA.ANALISE, CAPACIDADES.FOLLOW_UP))
  assert.ok(permite(MODOS_IA.ANALISE, CAPACIDADES.AGENDA))
})

test('capacidade desconhecida e negada, nao permitida por omissao', () => {
  assert.strictEqual(permite(MODOS_IA.CONVERSA, 'capacidade_que_nao_existe'), false)
})

// ─── Veredito de envio ────────────────────────────────────────────────────────

test('avaliarEnvio assume resposta conversacional quando a capacidade e omitida', () => {
  // O caminho governado e o default: quem esquece de declarar cai no mais restrito.
  const r = avaliarEnvio({ modo: MODOS_IA.ANALISE })
  assert.strictEqual(r.permitido, false)
  assert.strictEqual(r.capacidade, CAPACIDADES.RESPOSTA_CONVERSACIONAL)
  assert.strictEqual(r.motivo, MOTIVO_BLOQUEIO.MODO_ANALISE)
})

test('avaliarEnvio libera follow-up mesmo com a conversa em analise', () => {
  const r = avaliarEnvio({ modo: MODOS_IA.ANALISE, capacidade: CAPACIDADES.FOLLOW_UP })
  assert.strictEqual(r.permitido, true)
  assert.strictEqual(r.motivo, null)
})

test('avaliarEnvio sem argumento nenhum libera (conversa nova, sem modo gravado)', () => {
  assert.strictEqual(avaliarEnvio().permitido, true)
  assert.strictEqual(avaliarEnvio({}).permitido, true)
})

// ─── Log sem PII ──────────────────────────────────────────────────────────────

test('mascararNumero devolve so os 4 ultimos digitos', () => {
  assert.strictEqual(mascararNumero('5511988887777@s.whatsapp.net'), '***7777')
  assert.strictEqual(mascararNumero(''), null)
  assert.strictEqual(mascararNumero(null), null)
})

test('resumoBloqueio nao carrega telefone, JID nem texto de mensagem', () => {
  const numero = '5511988887777@s.whatsapp.net'
  const resumo = resumoBloqueio({ empresaId: 'e1', numero, modo: MODOS_IA.ANALISE })
  const serializado = JSON.stringify(resumo)
  assert.ok(!serializado.includes('5511988887777'), 'telefone em claro no log')
  assert.ok(!serializado.includes('@s.whatsapp.net'), 'JID no log')
  assert.strictEqual(resumo.numero_mascarado, '***7777')
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
  // matriz de capacidades — que e o que decide follow-up e agenda.
  const suspeitos = []
  for (const arquivo of arquivosJs(SRC)) {
    if (arquivo === DONO) continue
    const fonte = fs.readFileSync(arquivo, 'utf8')
    const linhas = fonte.split('\n')
    linhas.forEach((linha, i) => {
      const comparaComLiteral = /modo_ia[^\n]{0,40}['"](analise|conversa)['"]/.test(linha)
        || /['"](analise|conversa)['"][^\n]{0,40}modo_ia/.test(linha)
      if (comparaComLiteral) suspeitos.push(`${path.relative(SRC, arquivo)}:${i + 1}`)
    })
  }
  assert.deepStrictEqual(
    suspeitos, [],
    `Comparacao de modo duplicada. Use avaliarEnvio()/permite() de services/conversa-modo-ia.js em: ${suspeitos.join(', ')}`
  )
})

test('guarda: os dois caminhos de resposta conversacional consultam a politica', () => {
  // Se um enviador parar de consultar, a conversa em modo Analise volta a falar com o
  // cliente. Sao os DOIS motores: o funil legado e o playbook multiempresa.
  const enviadores = [
    path.join(SRC, 'core-funnel.js'),
    path.join(SRC, 'services', 'contexto2-responder.js'),
  ]
  for (const arquivo of enviadores) {
    const fonte = fs.readFileSync(arquivo, 'utf8')
    assert.match(
      fonte, /require\((['"]).{0,20}conversa-modo-ia\1\)/,
      `${path.basename(arquivo)} deixou de importar a politica de resposta`
    )
    assert.match(
      fonte, /avaliarEnvio\(/,
      `${path.basename(arquivo)} deixou de consultar avaliarEnvio() antes do envio`
    )
  }
})

test('guarda: o gate do funil legado fica DEPOIS da geracao, nao antes da analise', () => {
  // O requisito central: bloquear cedo mataria a analise junto com a fala. A prova
  // estrutural e a ordem no fonte — a chamada ao LLM do turno vem ANTES do bloco que
  // decide a entrega.
  const fonte = fs.readFileSync(path.join(SRC, 'core-funnel.js'), 'utf8')
  const posGate = fonte.indexOf('const reterMensagem = !entregaPermitida')
  const posEnvio = fonte.indexOf('respostaEnviadaAoLead = true')
  assert.ok(posGate > 0, 'o gate de entrega sumiu de core-funnel.js')
  assert.ok(posEnvio > posGate, 'o envio deveria acontecer depois da decisao de entrega')
})

test('guarda: follow-up declara a propria capacidade e nao e barrado pelo toggle', () => {
  // Regra de produto: follow-up depende SO da configuracao dele. Se este arquivo parar de
  // declarar CAPACIDADES.FOLLOW_UP, ele passa a cair no gate da resposta conversacional e o
  // modo Analise vira, sem ninguem perceber, uma pausa de follow-up.
  const fonte = fs.readFileSync(path.join(SRC, 'followup-execution.js'), 'utf8')
  assert.match(fonte, /capacidade:\s*CAPACIDADES\.FOLLOW_UP/)
})

test('guarda: a agenda nao consulta o modo da conversa', () => {
  // Lembretes tem regras proprias (incluindo o pause por empresa, que ja existia). O modo
  // da conversa nao pode virar mais uma condicao ali.
  const fonte = fs.readFileSync(path.join(SRC, 'agenda.js'), 'utf8')
  assert.ok(!/modo_ia/.test(fonte), 'agenda.js passou a depender do modo da conversa')
})
