'use strict'
// Equipes Comerciais — apresentação PURA da tela de gestão. Sem React e sem rede.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const E = require('./equipes-comerciais')

const FONTE = fs.readFileSync(path.join(__dirname, 'equipes-comerciais.js'), 'utf8')
const SEM_COMENTARIOS = FONTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

// ─── Estado da equipe ────────────────────────────────────────────────────────────────────

test('estadoDaEquipe traduz status e diz a consequencia', () => {
  assert.equal(E.estadoDaEquipe({ status: 'ativa' }).rotulo, 'Ativa')
  assert.match(E.estadoDaEquipe({ status: 'ativa' }).descricao, /trabalham a carteira/)
  assert.equal(E.estadoDaEquipe({ status: 'encerrada' }).rotulo, 'Encerrada')
  assert.match(E.estadoDaEquipe({ status: 'encerrada' }).descricao, /historico foi preservado|histórico foi preservado/)
})

test('status desconhecido nao quebra a tela nem inventa rotulo', () => {
  assert.equal(E.estadoDaEquipe({ status: 'inventado' }).rotulo, 'Status desconhecido')
  assert.equal(E.estadoDaEquipe(null).rotulo, 'Status desconhecido')
})

test('equipe sem membros diz a CONSEQUENCIA, nao so o numero', () => {
  // "0 pessoas" nao explica nada. O que importa e' que ela nao recorta a operacao de ninguem.
  assert.match(E.resumoDeMembros({ total_membros: 0 }), /não recorta a operação de ninguém/)
  assert.equal(E.resumoDeMembros({ total_membros: 1 }), '1 pessoa')
  assert.equal(E.resumoDeMembros({ total_membros: 4 }), '4 pessoas')
})

// ─── O seletor de pessoas ────────────────────────────────────────────────────────────────

const LIVRE = { usuario_id: 'u1', nome: 'Ana' }
const NA_OUTRA = { usuario_id: 'u2', nome: 'Bruno', equipe_atual: { id: 'e9', nome: 'Time Solar', nicho_nome: 'Energia Solar' } }
const NESTA = { usuario_id: 'u3', nome: 'Carla', equipe_atual: { id: 'e1', nome: 'Time Barba', nicho_nome: 'Barbearia' } }

test('pessoa livre esta disponivel', () => {
  assert.deepEqual(E.estadoDaPessoa(LIVRE, 'e1'), { disponivel: true, jaNesta: false, aviso: null })
})

test('pessoa da PROPRIA equipe aparece como membro, nao como conflito', () => {
  const r = E.estadoDaPessoa(NESTA, 'e1')
  assert.equal(r.disponivel, true)
  assert.equal(r.jaNesta, true)
  assert.equal(r.aviso, null)
})

test('pessoa de OUTRA equipe fica bloqueada COM o nome da equipe', () => {
  // E' a informacao que o 409 do backend nao da: ele diz "uma das pessoas", sem dizer qual.
  const r = E.estadoDaPessoa(NA_OUTRA, 'e1')
  assert.equal(r.disponivel, false)
  assert.match(r.aviso, /Time Solar/)
  assert.match(r.aviso, /Energia Solar/)
})

test('conflito da selecao aparece ANTES do envio, nomeando quem', () => {
  const aviso = E.conflitosDaSelecao([LIVRE, NA_OUTRA, NESTA], ['u1', 'u2', 'u3'], 'e1')
  assert.match(aviso, /Bruno/)
  assert.match(aviso, /uma equipe por vez/)
  assert.ok(!/Ana|Carla/.test(aviso), 'quem esta livre ou ja e desta equipe nao e conflito')
})

test('sem conflito NAO ocupa espaco dizendo que esta tudo bem', () => {
  assert.equal(E.conflitosDaSelecao([LIVRE, NESTA], ['u1', 'u3'], 'e1'), null)
  assert.equal(E.conflitosDaSelecao([], [], 'e1'), null)
  assert.equal(E.conflitosDaSelecao(null, null, null), null)
})

// ─── Formulário ──────────────────────────────────────────────────────────────────────────

test('formulario exige nome e nicho, com motivo em linguagem de gente', () => {
  assert.match(E.validarFormulario({ nome: 'A', nicho_id: 'n1' }).motivo, /ao menos 2 caracteres/)
  assert.match(E.validarFormulario({ nome: 'Solar', nicho_id: '' }).motivo, /Escolha o nicho/)
  assert.deepEqual(E.validarFormulario({ nome: ' Time Solar ', nicho_id: 'n1' }), { ok: true, motivo: null })
  assert.equal(E.validarFormulario({}).ok, false)
})

// ─── Encerrar ────────────────────────────────────────────────────────────────────────────

test('o aviso de encerrar DIZ que os leads continuam com as pessoas', () => {
  // Decisao D4 (2026-09-18): devolver leads e' acao separada e ainda nao existe. Deixar a tela
  // sugerir que encerrar resolve a carteira criaria a expectativa errada.
  assert.match(E.AVISO_ENCERRAR, /CONTINUAM com ela/)
  assert.match(E.AVISO_ENCERRAR, /ação separada|acao separada/)
  assert.match(E.AVISO_ENCERRAR, /ainda não disponível|ainda nao disponivel/)
})

test('a confirmacao conta quantas pessoas perdem o recorte', () => {
  assert.match(E.textoConfirmarEncerramento({ nome: 'Time Solar', total_membros: 3 }), /3 pessoas deixam/)
  assert.match(E.textoConfirmarEncerramento({ nome: 'Time Solar', total_membros: 1 }), /1 pessoa deixa/)
  assert.match(E.textoConfirmarEncerramento({ nome: 'Time Solar', total_membros: 0 }), /não tem membros/)
  assert.match(E.textoConfirmarEncerramento({ total_membros: 0 }), /esta equipe/)
})

// ─── Lista ───────────────────────────────────────────────────────────────────────────────

test('ativas e encerradas ficam separadas', () => {
  const g = E.agruparEquipes([
    { id: 'a', status: 'ativa' }, { id: 'b', status: 'encerrada' }, { id: 'c', status: 'ativa' },
  ])
  assert.deepEqual(g.ativas.map((e) => e.id), ['a', 'c'])
  assert.deepEqual(g.encerradas.map((e) => e.id), ['b'])
  assert.deepEqual(E.agruparEquipes(null), { ativas: [], encerradas: [] })
})

test('nicho que ja tem equipe ativa fica marcado como ocupado', () => {
  // O banco recusa a segunda equipe ativa no mesmo nicho
  // (`equipes_comerciais_um_nicho_ativo_uk`). A tela avisa antes de tentar.
  const equipes = [
    { id: 'e1', status: 'ativa', nicho_id: 'n1' },
    { id: 'e2', status: 'encerrada', nicho_id: 'n2' },
    { id: 'e3', status: 'ativa', nicho_id: 'n3' },
  ]
  const ocupados = E.nichosOcupados(equipes, null)
  assert.ok(ocupados.has('n1') && ocupados.has('n3'))
  assert.ok(!ocupados.has('n2'), 'nicho de equipe encerrada esta livre de novo')
  // Editando a propria equipe, o nicho dela nao conta como ocupado.
  assert.ok(!E.nichosOcupados(equipes, 'e1').has('n1'))
})

// ─── Guardas ─────────────────────────────────────────────────────────────────────────────

test('GUARDA: o modulo nao decide permissao nem compara papel', () => {
  // Quem autoriza e' o backend (requireCapacidade(MEMBROS_GERENCIAR)). Uma segunda regra aqui
  // faria a tela oferecer o que a API recusa, ou esconder o que ela permite.
  for (const proibido of ['membros_gerenciar', 'papelEmpresa', 'capacidades.includes', "=== 'admin'", "=== 'owner'", "=== 'comercial'"]) {
    assert.ok(!SEM_COMENTARIOS.includes(proibido), `equipes-comerciais.js nao pode conter '${proibido}'`)
  }
})

test('GUARDA: o modulo nao faz rede nem conhece rota', () => {
  for (const proibido of ['fetch(', 'apiFetch', '/api/', 'axios']) {
    assert.ok(!SEM_COMENTARIOS.includes(proibido), `nao pode conter '${proibido}'`)
  }
})

test('GUARDA: nao promete devolucao de leads que ainda nao existe', () => {
  // Se um dia a devolucao for implementada, este teste falha e obriga a revisar o texto —
  // que e' exatamente o momento em que ele DEVE mudar.
  assert.ok(!/devolv[ei].*autom/i.test(FONTE), 'nao sugerir devolucao automatica')
  assert.match(E.AVISO_ENCERRAR, /ainda não disponível|ainda nao disponivel/)
})
