'use strict'
// Aceite do termo da Operação Comercial (Etapa 1) — apresentação PURA, sem React e sem rede.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const { precisaAceitar, situacaoDoTermo, rolouAteOFim, estadoDoBotao } = require('./programa-aceite')

// ─── O veredito vem do backend ───────────────────────────────────────────────────────────

test('precisaAceitar so e verdadeiro quando o BACKEND disse liberado:false', () => {
  assert.equal(precisaAceitar({ liberado: false, motivo: 'aceite_ausente' }), true)
  assert.equal(precisaAceitar({ liberado: false, motivo: 'aceite_desatualizado' }), true)
  assert.equal(precisaAceitar({ liberado: true, motivo: 'aceite_vigente' }), false)
  assert.equal(precisaAceitar({ liberado: true, motivo: 'nao_sujeito' }), false)
})

test('veredito AUSENTE nao redireciona ninguem', () => {
  // Payload antigo, /me que falhou ou campo que ainda nao existe nao podem trancar a tela.
  // Se o bloqueio for real, a API responde 403 e a tela reage — errar para este lado custa um
  // erro visivel; errar para o outro tranca quem podia entrar.
  for (const v of [null, undefined, {}, 'pendente', 0, []]) {
    assert.equal(precisaAceitar(v), false, `${JSON.stringify(v)} nao deveria bloquear`)
  }
})

test('primeiro acesso e termo ATUALIZADO sao textos diferentes', () => {
  const primeiro = situacaoDoTermo('aceite_ausente')
  const mudou = situacaoDoTermo('aceite_desatualizado')
  assert.notEqual(primeiro.titulo, mudou.titulo)
  assert.match(mudou.titulo + mudou.texto, /atualizad/i)
  // Motivo desconhecido nao quebra a tela nem inventa historia.
  const padrao = situacaoDoTermo('motivo_novo_do_servidor')
  assert.ok(padrao.titulo && padrao.texto)
})

// ─── A rolagem ───────────────────────────────────────────────────────────────────────────

test('rolouAteOFim: o fim do texto libera; o comeco e o meio nao', () => {
  assert.equal(rolouAteOFim({ scrollTop: 0, scrollHeight: 1000, clientHeight: 300 }), false)
  assert.equal(rolouAteOFim({ scrollTop: 400, scrollHeight: 1000, clientHeight: 300 }), false)
  assert.equal(rolouAteOFim({ scrollTop: 700, scrollHeight: 1000, clientHeight: 300 }), true)
})

test('alturas fracionadas (zoom/densidade de tela) nao trancam o botao para sempre', () => {
  // Sem a folga, `scrollTop + clientHeight` para alguns pixels abaixo de `scrollHeight` em
  // alguns aparelhos, e o botao NUNCA libera. O sintoma seria "o sistema nao deixa eu aceitar".
  assert.equal(rolouAteOFim({ scrollTop: 689.5, scrollHeight: 1000, clientHeight: 300 }), true)
  assert.equal(rolouAteOFim({ scrollTop: 600, scrollHeight: 1000, clientHeight: 300 }), false)
})

test('texto que cabe inteiro na tela conta como lido', () => {
  // Exigir rolagem de algo que nao rola tambem tranca o botao para sempre.
  assert.equal(rolouAteOFim({ scrollTop: 0, scrollHeight: 300, clientHeight: 300 }), true)
  assert.equal(rolouAteOFim({ scrollTop: 0, scrollHeight: 200, clientHeight: 300 }), true)
})

test('metrica invalida NAO libera (nunca se supoe que foi lido)', () => {
  assert.equal(rolouAteOFim(), false)
  assert.equal(rolouAteOFim({}), false)
  assert.equal(rolouAteOFim({ scrollTop: NaN, scrollHeight: 1000, clientHeight: 300 }), false)
})

// ─── O botão ─────────────────────────────────────────────────────────────────────────────

test('o botao exige os TRES sinais — nenhum vale por outro', () => {
  const completo = { rolouAteFim: true, maioridade: true, leuRegras: true }
  assert.equal(estadoDoBotao(completo).habilitado, true)
  for (const chave of ['rolouAteFim', 'maioridade', 'leuRegras']) {
    const parcial = { ...completo, [chave]: false }
    assert.equal(estadoDoBotao(parcial).habilitado, false, `sem ${chave} nao pode habilitar`)
  }
  assert.equal(estadoDoBotao().habilitado, false)
})

test('botao desabilitado NUNCA fica mudo, e a ordem do motivo segue a leitura da tela', () => {
  const semNada = estadoDoBotao({})
  assert.ok(semNada.motivo, 'precisa dizer o que falta')
  assert.match(semNada.motivo, /final/i, 'a primeira pendencia e rolar o termo')

  const soFaltaCaixa = estadoDoBotao({ rolouAteFim: true, leuRegras: true })
  assert.match(soFaltaCaixa.motivo, /18 anos/i)

  assert.equal(estadoDoBotao({ rolouAteFim: true, maioridade: true, leuRegras: true }).motivo, '')
})

test('enviando bloqueia e avisa que esta gravando', () => {
  const e = estadoDoBotao({ rolouAteFim: true, maioridade: true, leuRegras: true, enviando: true })
  assert.equal(e.habilitado, false)
  assert.ok(e.motivo)
  assert.match(e.rotulo, /registrando/i)
})

// ─── Guardas de regressão ────────────────────────────────────────────────────────────────

const FONTE = fs.readFileSync(path.join(__dirname, 'programa-aceite.js'), 'utf8')

test('a REGRA nao vive no front: o modulo nao sabe quem esta sujeito ao programa', () => {
  // Quem decide e' services/programa-aceite.js. Uma lista de papeis aqui faria a tela e o
  // servidor divergirem em silencio — e a divergencia apareceria como "a tela deixou entrar e a
  // API respondeu 403", ou pior, o contrario.
  for (const proibido of ['comercial', 'member', 'owner', 'superadmin', 'PAPEIS_SUJEITOS']) {
    assert.ok(!FONTE.includes(proibido), `programa-aceite.js (front) nao pode citar '${proibido}'`)
  }
})

test('o modulo nao compara VERSAO de termo nem chama a rede', () => {
  for (const proibido of ['fetch(', 'apiFetch', 'axios', 'localStorage', 'versao_vigente', 'VERSAO']) {
    assert.ok(!FONTE.includes(proibido), `programa-aceite.js (front) nao pode conter '${proibido}'`)
  }
})
