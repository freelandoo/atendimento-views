'use strict'
// Painel da equipe — apresentação pura (Etapa 12).
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const E = require('./equipe-painel')

test('cada coluna DIZ o que mede — quatro numeros lado a lado nao sao comparaveis', () => {
  for (const c of E.COLUNAS) {
    assert.ok(c.oQueMede && c.oQueMede.length > 20, `${c.chave} precisa dizer o que mede`)
  }
  // "Ligacoes" e' historico, e a coluna precisa avisar — senao vira carga atual na leitura.
  const lig = E.COLUNAS.find((c) => c.chave === 'ligacoes')
  assert.match(lig.oQueMede, /hist[óo]rico/i)
})

test('a carga atual NAO inclui ligacoes', () => {
  // Ligacao e' acumulado: soma-la faria quem trabalha ha mais tempo parecer sobrecarregado hoje.
  const l = { leads: 3, conversas: 2, follow_ups_aguardando: 1, ligacoes: 500 }
  assert.equal(E.cargaAtual(l), 6)
  assert.equal(E.cargaAtual(null), 0)
  assert.equal(E.cargaAtual({}), 0)
})

test('quem tem mais trabalho vem primeiro; INATIVO vai para o fim mas nunca some', () => {
  const linhas = [
    { nome: 'Ana', leads: 1, conversas: 0, follow_ups_aguardando: 0, ativo: true },
    { nome: 'Bia', leads: 9, conversas: 0, follow_ups_aguardando: 0, ativo: true },
    { nome: 'Caio', leads: 50, conversas: 0, follow_ups_aguardando: 0, ativo: false },
  ]
  const ordenada = E.ordenarEquipe(linhas).map((l) => l.nome)
  assert.deepEqual(ordenada, ['Bia', 'Ana', 'Caio'])
  assert.equal(E.ordenarEquipe(linhas).length, 3, 'ninguem pode sumir da lista')
  // Nao muta a entrada.
  assert.equal(linhas[0].nome, 'Ana')
})

test('empate e resolvido pelo nome, nao pela ordem que o servidor mandou', () => {
  const l = [{ nome: 'Zeca', leads: 1 }, { nome: 'Ana', leads: 1 }]
  assert.deepEqual(E.ordenarEquipe(l).map((x) => x.nome), ['Ana', 'Zeca'])
})

test('o trabalho SEM DONO so aparece quando existe', () => {
  // Nao e' anomalia (a fila de livres e' estado de primeira classe), mas e' o que o admin veio
  // redistribuir. Zerado, esconder e' honesto: nao ha nada a fazer.
  assert.equal(E.temTrabalhoSemDono({ leads: 0, conversas: 0, follow_ups_aguardando: 0 }), false)
  assert.equal(E.temTrabalhoSemDono({ leads: 0, conversas: 4, follow_ups_aguardando: 0 }), true)
  assert.equal(E.temTrabalhoSemDono(null), false)
})

test('desativar NAO redistribui — e o aviso diz exatamente o que ficou parado', () => {
  const aviso = E.avisoDeInativo({ ativo: false, leads: 2, conversas: 1, follow_ups_aguardando: 0 })
  assert.match(aviso, /2 leads/)
  assert.match(aviso, /1 conversa\b/)
  assert.ok(!/follow-up/.test(aviso), 'nao lista o que esta zerado')
  assert.match(aviso, /Redistribua manualmente/)

  assert.match(E.avisoDeInativo({ ativo: false, leads: 0, conversas: 0, follow_ups_aguardando: 0 }),
    /Nada pendente/)
  // Quem esta ativo nao recebe aviso nenhum.
  assert.equal(E.avisoDeInativo({ ativo: true, leads: 99 }), '')
  assert.equal(E.avisoDeInativo({ leads: 99 }), '', 'ausencia de `ativo` nao e desativacao')
})

test('singular e plural sao respeitados', () => {
  assert.match(E.avisoDeInativo({ ativo: false, leads: 1 }), /1 lead\b/)
  assert.match(E.avisoDeInativo({ ativo: false, leads: 2 }), /2 leads\b/)
})

test('papel desconhecido aparece como ele mesmo', () => {
  assert.equal(E.rotuloPapel('comercial'), 'Comercial')
  assert.equal(E.rotuloPapel('papel_novo'), 'papel_novo')
  assert.equal(E.rotuloPapel(null), '—')
})

test('"nunca acessou" e informacao; um traco nao e', () => {
  assert.match(E.rotuloUltimoAcesso(null), /Nunca acessou/)
  assert.match(E.rotuloUltimoAcesso('lixo'), /Nunca acessou/)
  assert.ok(E.rotuloUltimoAcesso('2026-09-11T12:00:00Z').length > 0)
})

test('acao de auditoria desconhecida aparece como o slug, nunca como "—"', () => {
  const conhecida = E.descreverAtividade({ acao: 'lead_responsavel_assumiu', entidade_tipo: 'lead' })
  assert.equal(conhecida.rotulo, 'assumiu um lead')
  assert.equal(E.descreverAtividade({ acao: 'lead_status_alterado' }).rotulo, 'mudou o status de um lead')
  assert.equal(conhecida.conhecida, true)

  const nova = E.descreverAtividade({ acao: 'acao_que_o_servidor_acabou_de_criar' })
  assert.equal(nova.rotulo, 'acao_que_o_servidor_acabou_de_criar')
  assert.equal(nova.conhecida, false)
  assert.equal(E.descreverAtividade(null).rotulo, '—')
})

test('guarda: o painel NAO agrega auditoria e NAO cria placar', () => {
  // A migration 047 declara que a auditoria nao e fonte de dashboard, e as quatro contagens
  // medem coisas diferentes: um "total" daria um numero que nao se sustenta.
  const fonte = fs.readFileSync(path.join(__dirname, 'equipe-painel.js'), 'utf8')
  const semComentarios = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*$/gm, '')
  for (const proibido of ['ranking', 'produtividade', 'media(', 'percentual', 'score']) {
    assert.ok(!semComentarios.toLowerCase().includes(proibido),
      `"${proibido}" transformaria o painel em placar — leia o cabecalho do modulo`)
  }
  assert.ok(!/ligacoes.*\+|\+.*ligacoes/.test(semComentarios.replace(/cargaAtual[\s\S]*?\n}/, '')),
    'ligacoes nao entra em soma alguma')
})
