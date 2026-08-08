const test = require('node:test')
const assert = require('node:assert/strict')

const {
  statusDoRoteiro, rotuloStatusRoteiro, fraseStatusRoteiro, rotuloStatusVersao,
  rotuloNicho, montarListaRoteiros, versaoInicial, acoesDoRoteiro, textoConfirmacao,
} = require('./roteiros-lista')

const r = (p) => ({ id: p.id || 'x', nome: p.nome || 'Roteiro', ativo: true, ...p })

// --- status do ROTEIRO (nao da versao) --------------------------------------------
test('statusDoRoteiro: ativo=false vence tudo — e arquivado mesmo tendo versao publicada', () => {
  assert.equal(statusDoRoteiro(r({ ativo: false, versao_publicada: 3 })), 'arquivado')
})

test('statusDoRoteiro: publicado quando ha versao publicada', () => {
  assert.equal(statusDoRoteiro(r({ versao_publicada: 1 })), 'publicado')
})

test('statusDoRoteiro: rascunho quando nunca publicou', () => {
  assert.equal(statusDoRoteiro(r({ versao_publicada: null, total_versoes: 1 })), 'rascunho')
})

// Guarda da regressao que motivou o modulo: `publicarVersao` arquiva a versao anterior
// sozinha, entao ter versao arquivada NAO pode transformar o roteiro em arquivado.
test('statusDoRoteiro: roteiro com versao antiga arquivada continua PUBLICADO', () => {
  assert.equal(statusDoRoteiro(r({ ativo: true, versao_publicada: 2, total_versoes: 2 })), 'publicado')
})

test('statusDoRoteiro: entrada nula nao quebra', () => {
  assert.equal(statusDoRoteiro(null), 'rascunho')
})

// --- rotulos e frases (acessibilidade: nunca so' cor) -----------------------------
test('cada status tem rotulo e frase de consequencia proprios', () => {
  for (const s of ['rascunho', 'publicado', 'arquivado']) {
    assert.ok(rotuloStatusRoteiro(s).length > 0)
    assert.ok(fraseStatusRoteiro(s).length > 10, `frase de ${s} deve explicar a consequencia`)
  }
  assert.notEqual(fraseStatusRoteiro('publicado'), fraseStatusRoteiro('arquivado'))
})

test('status desconhecido cai em rascunho sem quebrar', () => {
  assert.equal(rotuloStatusRoteiro('inexistente'), 'Rascunho')
  assert.equal(rotuloStatusVersao('inexistente'), 'Rascunho')
})

test('rotuloNicho: vazio/nulo vira "Sem nicho"', () => {
  assert.equal(rotuloNicho('Academias'), 'Academias')
  assert.equal(rotuloNicho('   '), 'Sem nicho')
  assert.equal(rotuloNicho(null), 'Sem nicho')
})

// --- montagem da lista lateral ----------------------------------------------------
test('montarListaRoteiros: separa arquivados e agrupa ativos por nicho', () => {
  const out = montarListaRoteiros([
    r({ id: '1', nome: 'Abordagem fria', nicho: 'Academias', versao_publicada: 1 }),
    r({ id: '2', nome: 'Retomada', nicho: 'Academias' }),
    r({ id: '3', nome: 'Primeira ligacao', nicho: 'Barbearias', versao_publicada: 1 }),
    r({ id: '4', nome: 'Antigo', nicho: 'Academias', ativo: false, versao_publicada: 2 }),
  ])
  assert.equal(out.totalAtivos, 3)
  assert.equal(out.totalArquivados, 1)
  assert.deepEqual(out.grupos.map((g) => g.rotulo), ['Academias', 'Barbearias'])
  assert.deepEqual(out.grupos[0].itens.map((i) => i.nome), ['Abordagem fria', 'Retomada'])
  assert.deepEqual(out.arquivados.map((i) => i.id), ['4'])
})

test('montarListaRoteiros: nicho com caixa/espaco diferente e o MESMO grupo', () => {
  const out = montarListaRoteiros([
    r({ id: '1', nicho: 'Academias' }),
    r({ id: '2', nicho: ' academias ' }),
  ])
  assert.equal(out.grupos.length, 1)
  assert.equal(out.grupos[0].itens.length, 2)
})

test('montarListaRoteiros: "Sem nicho" fica sempre por ultimo', () => {
  const out = montarListaRoteiros([
    r({ id: '1', nicho: null }),
    r({ id: '2', nicho: 'Zoologicos' }),
    r({ id: '3', nicho: 'Academias' }),
  ])
  assert.deepEqual(out.grupos.map((g) => g.rotulo), ['Academias', 'Zoologicos', 'Sem nicho'])
})

test('montarListaRoteiros: contagem de arquivados reflete o dado real, nao a tela', () => {
  const out = montarListaRoteiros([
    r({ id: '1', ativo: false }), r({ id: '2', ativo: false }), r({ id: '3' }),
  ])
  assert.equal(out.totalArquivados, 2)
  assert.equal(out.arquivados.length, out.totalArquivados)
  assert.equal(out.grupos.reduce((n, g) => n + g.itens.length, 0), out.totalAtivos)
})

test('montarListaRoteiros: lista vazia/invalida devolve estrutura vazia', () => {
  for (const entrada of [[], null, undefined]) {
    const out = montarListaRoteiros(entrada)
    assert.deepEqual(out.grupos, [])
    assert.equal(out.totalArquivados, 0)
    assert.equal(out.totalAtivos, 0)
  }
})

test('montarListaRoteiros: cada item carrega o status ja resolvido', () => {
  const out = montarListaRoteiros([r({ id: '1', versao_publicada: 2 }), r({ id: '2', ativo: false })])
  assert.equal(out.grupos[0].itens[0].status, 'publicado')
  assert.equal(out.arquivados[0].status, 'arquivado')
})

// --- versao a abrir ---------------------------------------------------------------
test('versaoInicial: prefere a PUBLICADA mesmo havendo rascunho mais novo', () => {
  const v = versaoInicial([
    { id: 'b', versao: 3, status: 'rascunho' },
    { id: 'a', versao: 2, status: 'publicada' },
  ])
  assert.equal(v.id, 'a')
})

test('versaoInicial: sem publicada, pega a de maior numero', () => {
  const v = versaoInicial([
    { id: 'a', versao: 1, status: 'arquivada' },
    { id: 'b', versao: 2, status: 'rascunho' },
  ])
  assert.equal(v.id, 'b')
})

test('versaoInicial: sem versoes devolve null', () => {
  assert.equal(versaoInicial([]), null)
  assert.equal(versaoInicial(null), null)
})

// --- acoes por estado -------------------------------------------------------------
test('acoesDoRoteiro: rascunho publicavel e editavel', () => {
  const a = acoesDoRoteiro({ statusRoteiro: 'rascunho', statusVersao: 'rascunho' })
  assert.equal(a.podeEditar, true)
  assert.equal(a.podePublicar, true)
  assert.equal(a.podeCriarVersao, false)
  assert.equal(a.podeArquivar, true)
  assert.equal(a.podeDesarquivar, false)
})

test('acoesDoRoteiro: versao publicada e imutavel — so nova versao', () => {
  const a = acoesDoRoteiro({ statusRoteiro: 'publicado', statusVersao: 'publicada' })
  assert.equal(a.podeEditar, false)
  assert.equal(a.podePublicar, false)
  assert.equal(a.podeCriarVersao, true)
  assert.equal(a.podeExportar, true)
})

test('acoesDoRoteiro: arquivado e somente leitura — so desarquivar', () => {
  const a = acoesDoRoteiro({ statusRoteiro: 'arquivado', statusVersao: 'rascunho' })
  assert.equal(a.podeEditar, false)
  assert.equal(a.podePublicar, false)
  assert.equal(a.podeCriarVersao, false)
  assert.equal(a.podeExportar, false)
  assert.equal(a.podeArquivar, false)
  assert.equal(a.podeDesarquivar, true)
})

// A regra central do carregamento: agir enquanto carrega agiria sobre o roteiro ANTERIOR.
test('acoesDoRoteiro: carregando desabilita TODAS as acoes', () => {
  for (const statusRoteiro of ['rascunho', 'publicado', 'arquivado']) {
    const a = acoesDoRoteiro({ statusRoteiro, statusVersao: 'rascunho', carregando: true })
    assert.deepEqual(Object.values(a), [false, false, false, false, false, false],
      `nenhuma acao pode ficar viva carregando (${statusRoteiro})`)
  }
})

test('acoesDoRoteiro: sem versao carregada nao publica nem edita, mas ainda arquiva', () => {
  const a = acoesDoRoteiro({ statusRoteiro: 'rascunho', statusVersao: 'rascunho', temVersao: false })
  assert.equal(a.podeEditar, false)
  assert.equal(a.podePublicar, false)
  assert.equal(a.podeCriarVersao, false)
  assert.equal(a.podeArquivar, true)
})

test('acoesDoRoteiro: nunca emite acao destrutiva (exclusao nao existe no produto)', () => {
  const a = acoesDoRoteiro({ statusRoteiro: 'rascunho', statusVersao: 'rascunho' })
  for (const chave of Object.keys(a)) {
    assert.ok(!/excluir|apagar|remover|delet/i.test(chave), `acao destrutiva vazou: ${chave}`)
  }
})

// --- texto da confirmacao ---------------------------------------------------------
test('textoConfirmacao: arquivar nomeia o roteiro e promete que nada e apagado', () => {
  const t = textoConfirmacao('arquivar', { nome: 'Abordagem fria', campanhas_usando: 0 })
  assert.match(t.corpo, /Abordagem fria/)
  assert.match(t.corpo, /Nada e apagado/i)
  assert.equal(t.confirmar, 'Arquivar')
})

test('textoConfirmacao: arquivar com campanhas em uso avisa que elas continuam', () => {
  const t = textoConfirmacao('arquivar', { nome: 'X', campanhas_usando: 2 })
  assert.match(t.aviso, /2 campanha/)
  assert.match(t.aviso, /continuam funcionando/i)
})

test('textoConfirmacao: desarquivar explica a volta para a lista principal', () => {
  const t = textoConfirmacao('desarquivar', { nome: 'X' })
  assert.equal(t.confirmar, 'Desarquivar')
  assert.match(t.corpo, /lista principal/)
})

test('textoConfirmacao: sem roteiro nao quebra nem imprime undefined', () => {
  const t = textoConfirmacao('arquivar', null)
  assert.ok(!/undefined/.test(t.corpo + t.titulo + (t.aviso || '')))
})
