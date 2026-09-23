'use strict'
// node --test lib/equipe-carteira.test.js

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const C = require('./equipe-carteira')

const FONTE = fs.readFileSync(path.join(__dirname, 'equipe-carteira.js'), 'utf8')
const SEM_COMENTARIOS = FONTE.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')

const pessoa = (over = {}) => ({
  usuario_id: 'u1', nome: 'Ana', leads: 10, intocados: 4, em_andamento: 6,
  parados: 2, com_follow_up: 3, com_reuniao: 1, ...over,
})

// ─── Colunas ────────────────────────────────────────────────────────────────────────────

test('toda coluna declara o que mede — numero sem regua nao se confere', () => {
  for (const c of C.COLUNAS_CARTEIRA) {
    assert.ok(c.oQueMede && c.oQueMede.length > 20, `${c.chave} precisa dizer o que mede`)
    assert.ok(c.rotulo && c.rotulo.length > 1)
  }
})

test('"Com reunião" declara que e um recorte da CARTEIRA, nao producao da pessoa', () => {
  const col = C.COLUNAS_CARTEIRA.find((c) => c.chave === 'com_reuniao')
  assert.ok(col, 'a coluna existe')
  assert.ok(/recorte da carteira/i.test(col.oQueMede))
  assert.ok(/não quantas reuniões ela fez/i.test(col.oQueMede))
})

test('valor ausente vira 0 — membro sem linha tem carteira vazia, nao dado faltando', () => {
  const col = C.COLUNAS_CARTEIRA[0]
  assert.equal(C.valorDaCarteira(null, col), 0)
  assert.equal(C.valorDaCarteira({}, col), 0)
  assert.equal(C.valorDaCarteira(pessoa(), col), 10)
})

test('zero NUNCA e pintado: nao ha nada a alertar num numero que nao existe', () => {
  const parados = C.COLUNAS_CARTEIRA.find((c) => c.chave === 'parados')
  assert.equal(C.tomDaCarteira(parados, 0), 'neutro')
  assert.equal(C.tomDaCarteira(parados, 3), 'alerta')
  assert.equal(C.tomDaCarteira(C.COLUNAS_CARTEIRA[0], 99), 'neutro', 'coluna sem tom nao pinta')
})

// ─── Protegidos ─────────────────────────────────────────────────────────────────────────

test('sem nada protegido nao se ocupa espaco dizendo que esta tudo bem', () => {
  assert.equal(C.resumoProtegidos([]), null)
  assert.equal(C.resumoProtegidos(null), null)
  assert.equal(C.resumoProtegidos([{ motivo: 'reuniao_marcada', total: 0 }]), null)
})

test('o resumo de protegidos soma e explica cada motivo', () => {
  const r = C.resumoProtegidos([
    { motivo: 'reuniao_marcada', total: 4 },
    { motivo: 'conversa_aberta', total: 8 },
  ])
  assert.equal(r.total, 12)
  assert.equal(r.titulo, '12 leads protegidos')
  assert.deepEqual(r.itens.map((i) => i.rotulo), ['com reunião marcada', 'com conversa em andamento'])
  assert.ok(/nunca move lead com trabalho começado/i.test(r.explicacao))
})

test('motivo DESCONHECIDO aparece como ele mesmo, nunca escondido', () => {
  // Um motivo novo no servidor nao pode sumir da tela — mesma disciplina de lib/capacidades.js.
  assert.equal(C.rotuloProtegido('motivo_que_ainda_nao_existe'), 'motivo_que_ainda_nao_existe')
  const r = C.resumoProtegidos([{ motivo: 'novo_motivo', total: 2 }])
  assert.equal(r.itens[0].rotulo, 'novo_motivo')
})

// ─── Avisos ─────────────────────────────────────────────────────────────────────────────

test('desequilibrio exige 2+ pessoas e alguma carteira', () => {
  assert.equal(C.avisoDesequilibrio([pessoa()]), null, 'uma pessoa so nao desequilibra')
  assert.equal(C.avisoDesequilibrio([pessoa({ leads: 0 }), pessoa({ usuario_id: 'u2', leads: 0 })]), null)
})

test('desequilibrio aponta quem esta MUITO abaixo da media', () => {
  const a = C.avisoDesequilibrio([
    pessoa({ usuario_id: 'u1', nome: 'Ana', leads: 100 }),
    pessoa({ usuario_id: 'u2', nome: 'Bia', leads: 2 }),
  ])
  assert.ok(a)
  assert.deepEqual(a.pessoas, ['Bia'])
  assert.equal(a.tom, 'alerta')
  assert.ok(/Mova leads/.test(a.descricao) && /puxe mais leads/i.test(a.descricao), 'o aviso diz o que fazer, com os dois gestos')
})

test('carteira parelha NAO gera aviso', () => {
  assert.equal(C.avisoDesequilibrio([
    pessoa({ usuario_id: 'u1', leads: 10 }),
    pessoa({ usuario_id: 'u2', leads: 9 }),
  ]), null)
})

test('sem leads livres, a tela diz o que fazer em vez de ficar vazia', () => {
  assert.equal(C.avisoSemDisponiveis(5, []), null, 'havendo livres, nao ha aviso')
  const a = C.avisoSemDisponiveis(0, [{ motivo: 'conversa_aberta', total: 7 }])
  assert.ok(/Nenhum lead livre/.test(a.titulo))
  assert.ok(/7 leads/.test(a.descricao), 'explica que os outros estao em trabalho')
  assert.ok(/Aquisição/.test(a.descricao), 'aponta a saida real')
})

// ─── O modal ────────────────────────────────────────────────────────────────────────────

test('os tres criterios sao DIFERENTES de verdade', () => {
  assert.equal(C.CRITERIOS.length, 3)
  assert.equal(new Set(C.CRITERIOS.map((c) => c.id)).size, 3)
  for (const c of C.CRITERIOS) assert.ok(c.ajuda.length > 15, `${c.id} precisa explicar o que faz`)
  // "Sem contato" nao pode ser vendido como "nunca abordado" — nesse universo TODO lead e
  // intocado, e um controle que nao muda nada seria um controle que mente.
  const sc = C.CRITERIOS.find((c) => c.id === 'sem_contato')
  assert.ok(/telefone nem e-mail/i.test(sc.ajuda))
})

test('opcao invalida cai no padrao, sem lancar', () => {
  assert.equal(C.opcaoValida(C.CRITERIOS, 'inexistente', 'mais_antigos'), 'mais_antigos')
  assert.equal(C.opcaoValida(C.MODOS_DISTRIBUICAO, null, 'todos'), 'todos')
  assert.equal(C.opcaoValida(C.CRITERIOS, 'melhores', 'mais_antigos'), 'melhores')
})

test('validar: quantidade, disponibilidade e selecao', () => {
  assert.equal(C.validarPuxada({ quantidade: 0, disponiveis: 10 }).pode, false)
  assert.equal(C.validarPuxada({ quantidade: 5, disponiveis: 0 }).pode, false)
  assert.equal(C.validarPuxada({ quantidade: 5, disponiveis: 10, entre: 'selecionados', selecionados: [] }).pode, false)
  assert.equal(C.validarPuxada({ quantidade: 5, disponiveis: 10, entre: 'selecionados', selecionados: ['u1'] }).pode, true)
  assert.equal(C.validarPuxada({ quantidade: 5, disponiveis: 10, entre: 'todos' }).pode, true)
})

test('validar SEMPRE devolve motivo quando recusa — botao mudo nao explica nada', () => {
  for (const caso of [{ quantidade: 0, disponiveis: 10 }, { quantidade: 5, disponiveis: 0 }]) {
    const v = C.validarPuxada(caso)
    assert.equal(v.pode, false)
    assert.ok(v.motivo.length > 10)
  }
})

test('a previa NUNCA promete mais do que ha disponivel', () => {
  const t = C.previaDaPuxada({ quantidade: 50, disponiveis: 7, entre: 'todos', membros: [pessoa(), pessoa({ usuario_id: 'u2' })] })
  assert.ok(t.includes('7 leads'), 'mostra o que realmente sai')
  assert.ok(t.includes('Você pediu 50'), 'e diz que o pedido era maior')
})

test('resumo da puxada: zero movido nao e erro, e a tela explica', () => {
  const r = C.resumoDaPuxada({ movidos: 0, solicitados: 10 })
  assert.equal(r.tom, 'neutro')
  assert.ok(/Nenhum lead foi distribuído/.test(r.texto))
  assert.deepEqual(r.detalhes, [])
})

test('resumo da puxada mostra o numero REAL e nomeia quem recebeu', () => {
  const r = C.resumoDaPuxada(
    { movidos: 3, solicitados: 5, por_pessoa: [{ usuario_id: 'u1', recebidos: 2 }, { usuario_id: 'u2', recebidos: 1 }] },
    { u1: 'Ana', u2: 'Bia' }
  )
  assert.ok(r.texto.startsWith('3 leads distribuídos'))
  assert.ok(/os outros 2 não estavam livres/.test(r.texto))
  assert.deepEqual(r.detalhes, ['Ana: 2', 'Bia: 1'])
})

test('rebalanceamento sem movimento devolve null — nao se anuncia "0 movidos"', () => {
  assert.equal(C.resumoDoRebalanceamento(null), null)
  assert.equal(C.resumoDoRebalanceamento({ movidos: 0 }), null)
})

test('rebalanceamento separa o que veio da FILA do que foi tirado de colega', () => {
  const t = C.resumoDoRebalanceamento({ movidos: 7, de_livres: 4, entre_membros: 3 })
  assert.ok(/7 leads intocados/.test(t))
  assert.ok(/4 da fila de livres/.test(t))
  assert.ok(/3 remanejados entre a equipe/.test(t))
})

test('rebalanceamento truncado AVISA como terminar', () => {
  const t = C.resumoDoRebalanceamento({ movidos: 500, de_livres: 500, truncado: true })
  assert.ok(/limite por operação/i.test(t))
  assert.ok(/Puxar mais leads/.test(t))
})

// ─── GUARDAS DE REGRESSAO ───────────────────────────────────────────────────────────────

test('GUARDA: a tela nao reimplementa a regra de "intocado" nem de "protegido"', () => {
  // Quem decide e' backend/src/services/lead-distribuicao.js. Regra de negocio no front quebra
  // em silencio — e aqui ela quebraria movendo lead errado de dono.
  for (const proibido of ['lead_disparos', 'agenda_eventos', 'qualificacao', 'bloqueado_ate', 'responsavel_desde', 'nicho_id =']) {
    assert.ok(!SEM_COMENTARIOS.includes(proibido), `"${proibido}" e' regra do servidor, nao da tela`)
  }
})

// ─── resumoDaDevolucao (saida de equipe, 2026-09-21) ────────────────────────────────────

test('resumoDaDevolucao: null quando ninguem foi removido', () => {
  assert.equal(C.resumoDaDevolucao([]), null)
  assert.equal(C.resumoDaDevolucao(null), null)
  assert.equal(C.resumoDaDevolucao(undefined), null)
})

test('resumoDaDevolucao: pessoa removida sem carteira ainda e reportada', () => {
  const texto = C.resumoDaDevolucao([{ usuario_id: 'u1', nome: 'Ana', liberados: 0, com_reuniao_futura: 0, com_conversa_aberta: 0 }])
  assert.match(texto, /1 pessoa retirada/)
  assert.match(texto, /sem leads na carteira/)
})

test('resumoDaDevolucao: soma leads liberados de todas as pessoas da operacao', () => {
  const texto = C.resumoDaDevolucao([
    { usuario_id: 'u1', nome: 'Ana', liberados: 5, com_reuniao_futura: 0, com_conversa_aberta: 0 },
    { usuario_id: 'u2', nome: 'Bia', liberados: 3, com_reuniao_futura: 0, com_conversa_aberta: 0 },
  ])
  assert.match(texto, /2 pessoas retiradas/)
  assert.match(texto, /8 leads voltaram/)
})

test('resumoDaDevolucao: avisa quando ha reuniao marcada ou conversa aberta, nunca bloqueia', () => {
  const texto = C.resumoDaDevolucao([
    { usuario_id: 'u1', nome: 'Ana', liberados: 4, com_reuniao_futura: 2, com_conversa_aberta: 1 },
  ])
  assert.match(texto, /2 com reunião marcada/)
  assert.match(texto, /1 com conversa em andamento/)
})

test('GUARDA: o modulo e PURO — sem rede, sem DOM, sem React', () => {
  for (const proibido of ['fetch(', 'apiFetch', 'document.', 'window.', 'useState', 'require(\'react']) {
    assert.ok(!FONTE.includes(proibido), `"${proibido}" nao pertence a um modulo puro`)
  }
})

test('GUARDA: a carteira do nicho nao vira PLACAR', () => {
  // Ela mede CARGA (o que o gestor veio redistribuir), nunca desempenho. Mesma guarda de
  // lib/equipe-painel.js e lib/equipe-area.js.
  for (const proibido of ['ranking', 'produtividade', 'score', 'medalha', 'posicao', 'classificacao', 'percentual']) {
    assert.ok(!SEM_COMENTARIOS.toLowerCase().includes(proibido),
      `"${proibido}" transformaria a carteira em placar`)
  }
})

test('GUARDA: o modulo nao ordena gente por numero de leads', () => {
  // Ordenar por carteira seria classificar pessoas. A tabela segue a ordem que a API mandou.
  assert.ok(!/\.sort\(/.test(SEM_COMENTARIOS), 'a ordem das pessoas nao se decide aqui')
})

// ─── PONTOS DE ATENCAO (2026-09-23) ─────────────────────────────────────────────────────

const carteiraPousada = (over = {}) => ({
  equipe: { nicho_nome: 'Pousada' },
  membros: [
    pessoa({ usuario_id: 'u1', nome: 'Ana', leads: 131, intocados: 100, em_andamento: 31, legado: 131, ve_base_bruta: false }),
    pessoa({ usuario_id: 'u2', nome: 'Bia', leads: 120, intocados: 90, em_andamento: 30, legado: 0, ve_base_bruta: true }),
  ],
  disponiveis_para_puxar: 20,
  protegidos: [],
  aguardando_triagem: 0,
  sem_nicho: 0,
  fora_da_equipe: { leads: 0, pessoas: 0 },
  ...over,
})

test('POUSADA: lead atribuido que a pessoa NAO enxerga vira aviso de PERIGO, com o nome', () => {
  // O caso real de 2026-09-22: 131 leads na mao de alguem e o Banco de Leads dela vazio.
  const avisos = C.pontosDeAtencao(carteiraPousada())
  assert.equal(avisos[0].chave, 'leads_invisiveis', 'e o primeiro da lista: e o que mais custa')
  assert.equal(avisos[0].tom, 'perigo')
  assert.match(avisos[0].titulo, /Ana/)
  assert.match(avisos[0].titulo, /131/)
  assert.deepEqual(avisos[0].pessoas, ['Ana'])
  assert.equal(avisos[0].acao.tipo, 'banco_leads')
})

test('lead legado de quem ENXERGA a base bruta nao e aviso', () => {
  // Dono e admin veem legado: para eles, atribuido e visivel sao a mesma coisa.
  const car = carteiraPousada({
    membros: [pessoa({ usuario_id: 'u1', nome: 'Ana', legado: 50, ve_base_bruta: true })],
  })
  assert.equal(C.avisoLeadsInvisiveis(car.membros), null)
})

test('visibilidade DESCONHECIDA nao dispara o aviso (a tela nunca deduz pelo papel)', () => {
  // Sem `ve_base_bruta` a API nao disse; afirmar "nao enxerga" seria inventar.
  assert.equal(C.avisoLeadsInvisiveis([pessoa({ legado: 9 })]), null)
})

test('aguardando triagem, fora da equipe e sem nicho: cada um diz o numero e o que fazer', () => {
  const avisos = C.pontosDeAtencao(carteiraPousada({
    membros: [pessoa({ usuario_id: 'u1', nome: 'Ana', legado: 0, ve_base_bruta: false })],
    aguardando_triagem: 12,
    fora_da_equipe: { leads: 5, pessoas: 2 },
    sem_nicho: 40,
  }))
  const porChave = Object.fromEntries(avisos.map((a) => [a.chave, a]))
  assert.match(porChave.aguardando_triagem.titulo, /12 leads de Pousada aguardam triagem/)
  assert.equal(porChave.aguardando_triagem.acao.tipo, 'triagem')
  assert.match(porChave.fora_da_equipe.titulo, /5 leads de Pousada estão com 2 pessoas de fora/)
  assert.match(porChave.sem_nicho.titulo, /40 leads aprovados/)
  assert.match(porChave.sem_nicho.descricao, /empresa inteira/, 'numero da empresa precisa dizer que e da empresa')
})

test('singular e plural sem erro de concordancia', () => {
  assert.match(C.avisoAguardandoTriagem(1, 'Pousada').titulo, /^1 lead de Pousada aguarda triagem$/)
  assert.match(C.avisoForaDaEquipe({ leads: 1, pessoas: 1 }, 'Pousada').titulo, /1 lead de Pousada está com 1 pessoa/)
  assert.match(C.avisoSemNicho(1).titulo, /^1 lead aprovado está sem nicho/)
})

test('zero nao vira aviso — lista limpa quando nada precisa de acao', () => {
  assert.equal(C.avisoAguardandoTriagem(0), null)
  assert.equal(C.avisoForaDaEquipe({ leads: 0, pessoas: 0 }), null)
  assert.equal(C.avisoSemNicho(0), null)
  assert.deepEqual(C.pontosDeAtencao(carteiraPousada({
    membros: [pessoa({ usuario_id: 'u1', leads: 10, legado: 0 }), pessoa({ usuario_id: 'u2', leads: 9, legado: 0 })],
  })), [])
  assert.deepEqual(C.pontosDeAtencao(null), [], 'sem carteira nao ha o que avisar')
})

test('o desequilibrio no topo oferece MOVER leads', () => {
  const avisos = C.pontosDeAtencao(carteiraPousada({
    membros: [pessoa({ usuario_id: 'u1', nome: 'Ana', leads: 100 }), pessoa({ usuario_id: 'u2', nome: 'Bia', leads: 2 })],
  }))
  const d = avisos.find((a) => a.chave === 'carteira_desequilibrada')
  assert.ok(d)
  assert.equal(d.acao.tipo, 'mover')
})

test('juntarAvisos: perigo antes de alerta antes de neutro, estavel, sem repetir chave', () => {
  const lista = C.juntarAvisos(
    [{ chave: 'a', tom: 'neutro' }, { chave: 'b', tom: 'alerta' }, null],
    [{ chave: 'c', tom: 'perigo' }, { chave: 'b', tom: 'perigo' }, { chave: 'd', tom: 'alerta' }],
  )
  assert.deepEqual(lista.map((a) => a.chave), ['c', 'b', 'd', 'a'])
  assert.equal(lista.find((a) => a.chave === 'b').tom, 'alerta', 'a primeira ocorrencia de uma chave vence')
})

// ─── TRANSFERENCIA ENTRE MEMBROS (2026-09-23) ───────────────────────────────────────────

test('origens: so quem tem lead no nicho pode ceder; destinos: todos menos a origem', () => {
  const membros = [
    pessoa({ usuario_id: 'u1', nome: 'Ana', leads: 42, intocados: 29 }),
    pessoa({ usuario_id: 'u2', nome: 'Bia', leads: 0, intocados: 0 }),
    pessoa({ usuario_id: 'u3', nome: 'Caio', leads: 5, intocados: 5 }),
  ]
  assert.deepEqual(C.origensDaTransferencia(membros).map((o) => o.id), ['u1', 'u3'])
  assert.match(C.origensDaTransferencia(membros)[0].rotulo, /Ana — 42 leads \(29 intocados\)/)
  assert.deepEqual(C.destinosDaTransferencia(membros, 'u1').map((o) => o.id), ['u2', 'u3'])
})

test('previa SEM a caixa: o maximo sao os intocados, e nenhum risco e citado', () => {
  const origem = pessoa({ nome: 'Ana', intocados: 29, em_andamento: 13, com_reuniao: 3, com_conversa: 5 })
  const p = C.previaTransferencia({ origem, destinoNome: 'Bia', quantidade: 40, incluirProtegidos: false })
  assert.equal(p.maximo, 29)
  assert.equal(p.efetiva, 29)
  assert.equal(p.dosEmAndamento, 0)
  assert.deepEqual(p.riscos, [])
  assert.equal(p.aviso, '')
})

test('previa COM a caixa: os intocados saem PRIMEIRO; so o excedente vem dos em andamento', () => {
  const origem = pessoa({ nome: 'Ana', intocados: 29, em_andamento: 13, com_reuniao: 3, com_conversa: 5, com_follow_up: 0 })
  const pouco = C.previaTransferencia({ origem, destinoNome: 'Bia', quantidade: 10, incluirProtegidos: true })
  assert.equal(pouco.dosEmAndamento, 0, 'pedido que cabe nos intocados nao mexe em negociacao')
  assert.equal(pouco.aviso, '', 'e por isso nao ha risco a anunciar')

  const muito = C.previaTransferencia({ origem, destinoNome: 'Bia', quantidade: 35, incluirProtegidos: true })
  assert.equal(muito.maximo, 42)
  assert.equal(muito.dosEmAndamento, 6)
  assert.match(muito.aviso, /3 com reunião marcada/)
  assert.match(muito.aviso, /5 com conversa aberta/)
  assert.match(muito.aviso, /passam para Bia/)
})

test('a caixa so conta com o BOOLEANO true (mesma regra do backend)', () => {
  const origem = pessoa({ intocados: 1, em_andamento: 9 })
  assert.equal(C.previaTransferencia({ origem, quantidade: 5, incluirProtegidos: 'true' }).maximo, 1)
})

test('validarTransferenciaTela: cada bloqueio diz o motivo', () => {
  assert.match(C.validarTransferenciaTela({}).motivo, /de quem/)
  assert.match(C.validarTransferenciaTela({ origemId: 'a' }).motivo, /para quem/)
  assert.match(C.validarTransferenciaTela({ origemId: 'a', destinoId: 'a', quantidade: 1, maximo: 5 }).motivo, /mesma pessoa/)
  assert.match(C.validarTransferenciaTela({ origemId: 'a', destinoId: 'b', quantidade: 0, maximo: 5 }).motivo, /quantos/)
  assert.match(C.validarTransferenciaTela({ origemId: 'a', destinoId: 'b', quantidade: 1, maximo: 0 }).motivo, /incluir os em andamento/,
    'sem intocado, a tela aponta a caixa que resolve')
  assert.match(C.validarTransferenciaTela({ origemId: 'a', destinoId: 'b', quantidade: 9, maximo: 5 }).motivo, /só 5/)
  assert.deepEqual(C.validarTransferenciaTela({ origemId: 'a', destinoId: 'b', quantidade: 5, maximo: 5 }), { pode: true, motivo: '' })
})

test('resumoDaTransferencia usa o numero REAL e avisa quem recebeu compromisso', () => {
  const nomes = { u1: 'Ana', u2: 'Bia' }
  const r = C.resumoDaTransferencia({
    movidos: 7, solicitados: 10, origem_id: 'u1', destino_id: 'u2', incluir_protegidos: true, com_reuniao: 2,
  }, nomes)
  assert.equal(r.tom, 'ok')
  assert.match(r.texto, /^7 leads passaram de Ana para Bia\./)
  assert.match(r.texto, /pediu 10; só 7/)
  assert.match(r.texto, /2 com reunião marcada — avise Bia/)

  const nada = C.resumoDaTransferencia({ movidos: 0, origem_id: 'u1', destino_id: 'u2' }, nomes)
  assert.equal(nada.tom, 'neutro')
  assert.match(nada.texto, /Ana não tinha lead intocado/)
})
