'use strict'

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
  modoValido,
  preferenciaValida,
  normalizarModo,
  normalizarPreferencia,
  descreverModo,
  descreverPreferencia,
  opcoesDeModo,
  opcoesDePreferencia,
  explicarOrigem,
  avisoDePausa,
  avisoDoCompositor,
  rotuloAcessivel,
  houveMudancaDePreferencia,
  houveMudancaDeModo,
  preverEfetivo,
  explicarPadraoGlobal,
  rotuloAcessivelPadrao,
  AVISO_EXCECOES_PADRAO,
} = require('./conversa-modo-ia.js')

// ─── Vocabulario: os TRES conceitos nao podem se confundir ───────────────────
// modo EFETIVO (conversa|analise) · PREFERENCIA da conversa (herdar|conversa|analise)
// · modo GLOBAL da Central. `herdar` e' a AUSENCIA de excecao — nao e' um modo.

test('as listas fechadas espelham o backend, e `herdar` nao e um modo', () => {
  assert.deepStrictEqual(MODOS_IA_VALIDOS, ['conversa', 'analise'])
  assert.deepStrictEqual(PREFERENCIAS_VALIDAS, ['herdar', 'conversa', 'analise'])
  // O padrao global de fabrica e' o comportamento historico do produto.
  assert.strictEqual(MODO_GLOBAL_PADRAO, MODOS_IA.CONVERSA)
  // Conversa nova nasce SEM excecao: segue a Central.
  assert.strictEqual(PREFERENCIA_PADRAO, PREFERENCIAS.HERDAR)
  assert.ok(!MODOS_IA_VALIDOS.includes(PREFERENCIAS.HERDAR))
})

test('guarda: as listas fechadas do front nao podem divergir do backend', () => {
  // Se o backend ganhar um modo e a tela nao souber traduzi-lo, o operador ve um estado
  // que o motor aplica e a interface nao explica. O modulo do backend e' PURO e sem
  // dependencias, entao da para compara-lo diretamente.
  const backend = require(
    path.join(__dirname, '..', '..', 'backend', 'src', 'services', 'conversa-modo-ia.js')
  )
  assert.deepStrictEqual([...MODOS_IA_VALIDOS], [...backend.MODOS_IA_VALIDOS])
  assert.deepStrictEqual([...PREFERENCIAS_VALIDAS], [...backend.PREFERENCIAS_VALIDAS])
  assert.strictEqual(MODO_GLOBAL_PADRAO, backend.MODO_GLOBAL_PADRAO)
  assert.strictEqual(PREFERENCIA_PADRAO, backend.PREFERENCIA_PADRAO)
  assert.deepStrictEqual({ ...ORIGEM_MODO }, { ...backend.ORIGEM_MODO })
})

test('modoValido e preferenciaValida separam modo de preferencia', () => {
  assert.ok(modoValido('analise'))
  assert.strictEqual(modoValido('pausado'), false)
  // `herdar` e' preferencia de CONVERSA; a Central nao tem de quem herdar.
  assert.strictEqual(modoValido('herdar'), false)
  assert.ok(preferenciaValida('herdar'))
  assert.strictEqual(preferenciaValida('pausado'), false)
})

test('normalizar nunca devolve "bloqueado": lixo cai no menos restritivo', () => {
  // Dado ausente jamais pode calar uma conversa que ninguem configurou.
  assert.strictEqual(normalizarModo(undefined), MODOS_IA.CONVERSA)
  assert.strictEqual(normalizarModo('herdar'), MODOS_IA.CONVERSA)
  assert.strictEqual(normalizarModo('  ANALISE '), MODOS_IA.ANALISE)
  assert.strictEqual(normalizarPreferencia(undefined), PREFERENCIAS.HERDAR)
  assert.strictEqual(normalizarPreferencia('  ANALISE '), PREFERENCIAS.ANALISE)
})

test('descrever nunca devolve undefined, nem para lixo', () => {
  for (const valor of [null, undefined, '', 'inexistente', 7, {}]) {
    const m = descreverModo(valor)
    assert.strictEqual(m.id, MODOS_IA.CONVERSA)
    assert.ok(m.rotulo && m.estado && m.descricao && m.ajuda)

    const p = descreverPreferencia(valor)
    assert.strictEqual(p.id, PREFERENCIAS.HERDAR)
    assert.ok(p.rotulo && p.curto && p.ajuda)
  }
})

test('cada opcao tem rotulo em TEXTO — cor nunca e o unico sinal', () => {
  const modos = opcoesDeModo()
  assert.strictEqual(modos.length, 2, 'o controle GLOBAL da Central tem 2 opcoes')
  assert.deepStrictEqual(modos.map((o) => o.id), ['conversa', 'analise'])
  for (const o of modos) {
    assert.ok(o.rotulo.length > 0)
    assert.ok(o.estado.length > 0)
  }

  const prefs = opcoesDePreferencia()
  assert.strictEqual(prefs.length, 3, 'o controle DA CONVERSA tem 3 opcoes')
  assert.deepStrictEqual(prefs.map((o) => o.id), ['herdar', 'conversa', 'analise'])
  for (const o of prefs) {
    assert.ok(o.rotulo.length > 0)
    assert.ok(o.ajuda.length > 0)
  }
})

test('o estado do modo Analise diz que a IA acompanha sem responder', () => {
  const d = descreverModo(MODOS_IA.ANALISE)
  assert.match(d.estado, /acompanhando/i)
  assert.match(d.estado, /sem responder/i)
})

test('a ajuda de cada modo explica a consequencia, nao so o nome', () => {
  assert.match(descreverModo(MODOS_IA.CONVERSA).ajuda, /pode responder/i)
  const analise = descreverModo(MODOS_IA.ANALISE).ajuda
  assert.match(analise, /não responde automaticamente/i)
  assert.match(analise, /registra|acompanha/i)
})

test('a ajuda de cada PREFERENCIA diz se a Central ainda alcanca esta conversa', () => {
  // Sem isso o operador nao sabe se precisa mexer aqui ou na configuracao da Central.
  assert.match(descreverPreferencia(PREFERENCIAS.HERDAR).ajuda, /Central/i)
  assert.match(descreverPreferencia(PREFERENCIAS.CONVERSA).ajuda, /nesta conversa/i)
  assert.match(descreverPreferencia(PREFERENCIAS.ANALISE).ajuda, /nesta conversa/i)
})

// ─── Origem: de onde veio o modo que esta valendo ────────────────────────────

test('explicarOrigem distingue excecao da conversa de padrao herdado', () => {
  const excecao = explicarOrigem({
    origem: ORIGEM_MODO.EXCECAO,
    modoEfetivo: MODOS_IA.ANALISE,
    modoPadrao: MODOS_IA.CONVERSA,
  })
  assert.match(excecao, /Exceção desta conversa/i)
  assert.match(excecao, /Análise/)
  // O ponto todo da excecao: o global nao a alcanca.
  assert.match(excecao, /não altera/i)

  const herdado = explicarOrigem({
    origem: ORIGEM_MODO.HERDADO,
    modoEfetivo: MODOS_IA.ANALISE,
    modoPadrao: MODOS_IA.ANALISE,
  })
  assert.match(herdado, /Central/i)
  assert.match(herdado, /Análise/)
  assert.doesNotMatch(herdado, /Exceção/i)
})

test('explicarOrigem sem padrao informado nao inventa um modo diferente do efetivo', () => {
  const frase = explicarOrigem({ origem: ORIGEM_MODO.HERDADO, modoEfetivo: MODOS_IA.ANALISE })
  assert.match(frase, /Análise/)
})

// ─── Pausa humana: separada do modo, de proposito ────────────────────────────

test('avisoDePausa so existe quando ha pausa, e diz que e temporaria', () => {
  assert.strictEqual(avisoDePausa(false), null)
  assert.strictEqual(avisoDePausa(null), null)
  assert.strictEqual(avisoDePausa(undefined), null)
  const aviso = avisoDePausa(true)
  assert.ok(aviso)
  // Pausa nao e' modo: nasce do atendimento humano e nao altera preferencia.
  assert.match(aviso.texto, /temporária/i)
  assert.match(aviso.texto, /modo Conversa/i)
})

test('avisoDoCompositor cobre modo, pausa e os dois juntos', () => {
  // Nada a avisar: a IA responde normalmente.
  assert.strictEqual(avisoDoCompositor({ modoEfetivo: MODOS_IA.CONVERSA }), null)
  assert.strictEqual(avisoDoCompositor({}), null)

  const porModo = avisoDoCompositor({ modoEfetivo: MODOS_IA.ANALISE })
  assert.ok(porModo)
  assert.match(porModo.titulo, /acompanhando/i)

  // Pausado no modo Conversa tambem nao sai resposta — e o compositor precisa dizer.
  const porPausa = avisoDoCompositor({ modoEfetivo: MODOS_IA.CONVERSA, agentePausado: true })
  assert.ok(porPausa)
  assert.match(porPausa.titulo, /pausada/i)

  // Em todos os casos, aponta o caminho que JA existe para o atendente.
  for (const aviso of [porModo, porPausa]) {
    assert.match(aviso.texto, /Orientar resposta/)
    assert.match(aviso.texto, /envie você mesmo|revise/i)
  }
})

test('rotuloAcessivel entrega estado, consequencia E origem na mesma frase', () => {
  // Um leitor de tela que anuncie so "Análise" nao diz o que muda para o cliente, nem
  // se a decisao esta nesta conversa ou na Central.
  const frase = rotuloAcessivel({
    modoEfetivo: MODOS_IA.ANALISE,
    origem: ORIGEM_MODO.EXCECAO,
    modoPadrao: MODOS_IA.CONVERSA,
  })
  assert.match(frase, /Análise/)
  assert.match(frase, /não envia|não responde/i)
  assert.match(frase, /Exceção desta conversa/i)
})

// ─── Mudanca e previsao otimista ─────────────────────────────────────────────

test('houveMudanca ignora clique na opcao ja ativa', () => {
  assert.strictEqual(houveMudancaDePreferencia('herdar', 'herdar'), false)
  // Sem valor gravado a conversa ja esta herdando: clicar em "Herdar" nao e mudanca.
  assert.strictEqual(houveMudancaDePreferencia(null, 'herdar'), false)
  assert.ok(houveMudancaDePreferencia('herdar', 'analise'))

  assert.strictEqual(houveMudancaDeModo('conversa', 'conversa'), false)
  assert.strictEqual(houveMudancaDeModo(null, 'conversa'), false)
  assert.ok(houveMudancaDeModo('conversa', 'analise'))
})

test('preverEfetivo: herdar segue o global; excecao resiste a ele', () => {
  const herdando = preverEfetivo({ preferencia: 'herdar', modoPadrao: MODOS_IA.ANALISE })
  assert.deepStrictEqual(herdando, {
    modo_ia: 'herdar',
    modo_ia_padrao: 'analise',
    modo_ia_efetivo: 'analise',
    modo_ia_origem: ORIGEM_MODO.HERDADO,
  })

  const excecao = preverEfetivo({ preferencia: 'conversa', modoPadrao: MODOS_IA.ANALISE })
  assert.deepStrictEqual(excecao, {
    modo_ia: 'conversa',
    modo_ia_padrao: 'analise',
    modo_ia_efetivo: 'conversa',
    modo_ia_origem: ORIGEM_MODO.EXCECAO,
  })
})

test('preverEfetivo concorda com o backend, que e a autoridade', () => {
  // A previsao local so cobre o intervalo do PATCH. Se ela divergisse do calculo real, a
  // tela afirmaria um modo que o motor nao aplica — justamente onde o cliente sente.
  const backend = require(
    path.join(__dirname, '..', '..', 'backend', 'src', 'services', 'conversa-modo-ia.js')
  )
  for (const preferencia of PREFERENCIAS_VALIDAS) {
    for (const modoPadrao of MODOS_IA_VALIDOS) {
      const local = preverEfetivo({ preferencia, modoPadrao })
      const real = backend.modoEfetivo({ preferencia, modoGlobal: modoPadrao })
      assert.strictEqual(local.modo_ia_efetivo, real.modo, `${preferencia} sobre ${modoPadrao}`)
      assert.strictEqual(local.modo_ia_origem, real.origem, `${preferencia} sobre ${modoPadrao}`)
    }
  }
})

// ─── Controle GLOBAL: o escopo e outro, e a frase precisa dizer isso ─────────

test('explicarPadraoGlobal fala do escopo GLOBAL, nao "desta conversa"', () => {
  // O erro facil aqui e' reusar a descricao do modo, que e' escrita para UMA conversa: o
  // operador acreditaria estar mexendo so na conversa aberta.
  for (const modo of MODOS_IA_VALIDOS) {
    const frase = explicarPadraoGlobal(modo)
    assert.ok(frase)
    assert.match(frase, /sem exceção própria/i)
    assert.doesNotMatch(frase, /desta conversa/i)
  }
  assert.match(explicarPadraoGlobal(MODOS_IA.CONVERSA), /pode responder/i)
  assert.match(explicarPadraoGlobal(MODOS_IA.ANALISE), /não responde/i)
  // Lixo nunca deixa a tela sem texto.
  assert.ok(explicarPadraoGlobal(undefined))
  assert.strictEqual(explicarPadraoGlobal('herdar'), explicarPadraoGlobal(MODOS_IA.CONVERSA))
})

test('o aviso de excecoes existe e diz que elas NAO sao alteradas', () => {
  // Sem esta frase, mudar o padrao e ver uma conversa seguir igual parece defeito.
  assert.match(AVISO_EXCECOES_PADRAO, /exceção própria/i)
  assert.match(AVISO_EXCECOES_PADRAO, /não são alteradas/i)
})

test('rotuloAcessivelPadrao entrega modo, consequencia e limite numa frase', () => {
  const frase = rotuloAcessivelPadrao(MODOS_IA.ANALISE)
  assert.match(frase, /Central de Mensagens/i)
  assert.match(frase, /Análise/)
  assert.match(frase, /não responde/i)
  assert.ok(frase.includes(AVISO_EXCECOES_PADRAO), 'o limite do controle vai junto no leitor de tela')
  // Nao pode se passar pelo controle DA CONVERSA.
  assert.doesNotMatch(frase, /nesta conversa/i)
})

test('guarda: a tela nao reimplementa a decisao de enviar', () => {
  // A permissao de enviar e' do backend. O componente e o painel podem LER o modo para
  // desenhar; se aparecer ali uma comparacao decidindo envio, a regra passou a existir em
  // dois lugares — e a tela nunca e a autoridade.
  const alvos = [
    path.join(__dirname, '..', 'components', 'ui', 'AlternadorModoIa.tsx'),
    path.join(__dirname, '..', 'components', 'ConversaPainel.tsx'),
    // A Central passou a LER o modo tambem (controle do padrao global) — entra na guarda
    // pelo mesmo motivo que as outras duas.
    path.join(__dirname, '..', 'app', 'dashboard', 'conversas', 'page.tsx'),
  ]
  for (const alvo of alvos) {
    const fonte = fs.readFileSync(alvo, 'utf8')
    const linhas = fonte
      .split('\n')
      .filter((l) => /===\s*['"](analise|conversa|herdar)['"]|['"](analise|conversa|herdar)['"]\s*===/.test(l))
    assert.deepStrictEqual(linhas, [], `${path.basename(alvo)} comparou modo com literal; use lib/conversa-modo-ia.js`)
  }
})
