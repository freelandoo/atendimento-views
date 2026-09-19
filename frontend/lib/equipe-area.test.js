'use strict'
// Área de Equipe — a tela unificada. Regras PURAS de apresentação + guardas de regressão.
// Rode com: node --test lib/equipe-area.test.js

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const E = require('./equipe-area')

const FONTE = fs.readFileSync(path.join(__dirname, 'equipe-area.js'), 'utf8')
const SEM_COMENTARIOS = FONTE
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ')

const pessoa = (over = {}) => ({
  usuario_id: 'u1', nome: 'Ana', email: 'ana@x.com', papel: 'comercial', ativo: true,
  leads: 0, leads_parados: 0, conversas: 0, follow_ups_aguardando: 0, follow_ups_vencidos: 0,
  ligacoes: 0, ...over,
})

// ─── Abas ───────────────────────────────────────────────────────────────────────────────

test('abaValida aceita as tres abas e cai no padrao no resto', () => {
  assert.equal(E.abaValida('equipes'), 'equipes')
  assert.equal(E.abaValida('pessoas'), 'pessoas')
  assert.equal(E.abaValida('visao'), 'visao')
  // URL adulterada ou storage antigo nao pode deixar a tela em branco.
  assert.equal(E.abaValida('financeiro'), 'visao')
  assert.equal(E.abaValida(null), 'visao')
  assert.equal(E.abaValida(''), 'visao')
})

// ─── Juncao das duas fontes ─────────────────────────────────────────────────────────────

test('montarPessoas junta carga, equipe e faturamento pela ESQUERDA', () => {
  const linhas = [pessoa({ usuario_id: 'u1', leads: 5 }), pessoa({ usuario_id: 'u2', nome: 'Bia' })]
  const elegiveis = [{ usuario_id: 'u1', equipe_atual: { id: 'e1', nome: 'Solar' } }]
  const ranking = [{ usuario_id: 'u1', originado: 1500 }]

  const saida = E.montarPessoas({ linhas, elegiveis, ranking })
  assert.equal(saida.length, 2)
  assert.equal(saida[0].equipe.nome, 'Solar')
  assert.equal(saida[0].originado, 1500)
  assert.equal(saida[0].leads, 5, 'a carga da rota /equipe e preservada')
  // Quem nao esta em equipe e nao tem faturamento: ausencia explicita, nao zero inventado.
  assert.equal(saida[1].equipe, null)
  assert.equal(saida[1].originado, null)
})

test('montarPessoas mantem quem esta com o acesso REVOGADO', () => {
  // `elegiveis` so lista vinculo ativo. Se a juncao fosse por ele, quem foi desativado sumiria
  // da tela junto com a carteira que continua na mao dele — e ninguem redistribuiria.
  const linhas = [pessoa({ usuario_id: 'u9', nome: 'Zeca', ativo: false, leads: 12 })]
  const saida = E.montarPessoas({ linhas, elegiveis: [], ranking: [] })
  assert.equal(saida.length, 1)
  assert.equal(saida[0].leads, 12)
  assert.equal(saida[0].ativo, false)
})

test('montarPessoas aceita entrada vazia/ausente sem quebrar', () => {
  assert.deepEqual(E.montarPessoas(), [])
  assert.deepEqual(E.montarPessoas({ linhas: null, elegiveis: null, ranking: null }), [])
})

// ─── Metricas ───────────────────────────────────────────────────────────────────────────

test('metricasDaEquipe soma a MESMA metrica entre pessoas, nunca metricas diferentes', () => {
  const membros = [
    pessoa({ leads: 10, conversas: 2, follow_ups_aguardando: 3, follow_ups_vencidos: 1, ligacoes: 4, leads_parados: 2 }),
    pessoa({ leads: 5, conversas: 1, follow_ups_aguardando: 0, follow_ups_vencidos: 0, ligacoes: 1, leads_parados: 0 }),
  ]
  const m = E.metricasDaEquipe(membros)
  assert.equal(m.leads, 15)
  assert.equal(m.conversas, 3)
  assert.equal(m.follow_ups_aguardando, 3)
  assert.equal(m.follow_ups_vencidos, 1)
  assert.equal(m.ligacoes, 5)
  assert.equal(m.leads_parados, 2)
  // Nao existe um total geral: somar carteira com compromisso daria um numero que nao se sustenta.
  assert.ok(!('total' in m) && !('score' in m) && !('carga' in m))
})

test('metricas: faturamento AUSENTE e null, nunca zero', () => {
  // Zero afirmaria "esta equipe vendeu nada". O certo e "nao ha venda registrada".
  assert.equal(E.metricasDaEquipe([pessoa(), pessoa()]).originado, null)
  assert.equal(E.metricasDaEquipe([pessoa({ originado: 0 }), pessoa({ originado: 900 })]).originado, 900)
})

test('montarEquipes liga membros e denuncia quem ficou oculto', () => {
  const pessoas = E.montarPessoas({
    linhas: [pessoa({ usuario_id: 'u1', leads: 3 }), pessoa({ usuario_id: 'u2', nome: 'Bia' })],
    elegiveis: [{ usuario_id: 'u1', equipe_atual: { id: 'e1', nome: 'Solar' } }],
  })
  // O banco diz 2 membros; `elegiveis` so devolveu 1 (o outro perdeu o acesso).
  const [eq] = E.montarEquipes({ equipes: [{ id: 'e1', nome: 'Solar', status: 'ativa', total_membros: 2 }], pessoas })
  assert.equal(eq.membros.length, 1)
  assert.equal(eq.total_membros, 2)
  assert.equal(eq.membros_ocultos, 1)
  assert.match(E.avisoMembrosOcultos(eq), /acesso revogado/)
  assert.equal(eq.metricas.leads, 3)
  // Sem divergencia, o aviso nao ocupa espaco.
  assert.equal(E.avisoMembrosOcultos({ membros_ocultos: 0 }), '')
})

// ─── Colunas da tabela de membros ───────────────────────────────────────────────────────

test('valorDaColuna busca no lugar certo: carga atual x atividade de hoje', () => {
  const p = pessoa({ leads: 7, atividade_hoje: { contatos_registrados: 4, fechados: 1 } })
  const colLeads = E.COLUNAS_MEMBRO.find((c) => c.chave === 'leads')
  const colContatos = E.COLUNAS_MEMBRO.find((c) => c.chave === 'contatos_registrados')
  assert.equal(E.valorDaColuna(p, colLeads), 7)
  assert.equal(E.valorDaColuna(p, colContatos), 4)
  assert.equal(E.valorDaColuna(p, null), 0)
})

test('toda coluna de HOJE declara isso no proprio rotulo', () => {
  // Misturar horizonte sem dizer faria a tabela mentir: "Contatos" ao lado de "Leads" pareceria
  // o acumulado da carteira, quando conta so o dia.
  for (const c of E.COLUNAS_MEMBRO) {
    if (c.hoje) assert.match(c.rotulo, /\(hoje\)/, `${c.chave} conta fatos do dia e precisa dizer`)
    assert.ok(c.oQueMede && c.oQueMede.length > 10, `${c.chave} precisa dizer o que mede`)
  }
  for (const m of E.METRICAS_EQUIPE) {
    assert.ok(m.oQueMede && m.oQueMede.length > 10, `${m.chave} precisa dizer o que mede`)
  }
})

test('tomDaColuna nao pinta zero', () => {
  const parados = E.COLUNAS_MEMBRO.find((c) => c.chave === 'leads_parados')
  const vencidos = E.COLUNAS_MEMBRO.find((c) => c.chave === 'follow_ups_vencidos')
  assert.equal(E.tomDaColuna(parados, 0), 'neutro', 'nao ha o que alertar em zero')
  assert.equal(E.tomDaColuna(parados, 3), 'alerta')
  // Prazo estourado e falta de acao sao problemas diferentes e nao usam o mesmo tom.
  assert.equal(E.tomDaColuna(vencidos, 1), 'perigo')
  assert.equal(E.tomDaColuna(null, 5), 'neutro')
})

// ─── Resumo e alertas ───────────────────────────────────────────────────────────────────

test('resumoGeral responde quatro perguntas diferentes, e cada uma diz o que mede', () => {
  const cartoes = E.resumoGeral({
    pessoas: [pessoa({ leads_parados: 2, follow_ups_aguardando: 3, follow_ups_vencidos: 1 }), pessoa({ ativo: false })],
    equipes: [{ status: 'ativa' }, { status: 'encerrada' }],
    prazoParado: 7,
  })
  assert.equal(cartoes.length, 4)
  for (const c of cartoes) assert.ok(c.oQueMede, `${c.chave} precisa declarar o que mede`)
  assert.equal(cartoes[0].valor, 1)
  assert.match(cartoes[0].apoio, /1 com acesso revogado/)
  assert.equal(cartoes[1].valor, 1)
  assert.match(cartoes[1].apoio, /1 encerrada/)
  assert.equal(cartoes[2].valor, 2)
  assert.match(cartoes[2].apoio, /7 dias/, 'o numero de parados so se confere com a janela declarada')
  assert.equal(cartoes[3].valor, 3)
  assert.equal(cartoes[3].tom, 'perigo')
})

test('alertasDaEquipe so aparece quando ha o que FAZER', () => {
  const limpa = E.montarEquipes({
    equipes: [{ id: 'e1', status: 'ativa', total_membros: 1 }],
    pessoas: E.montarPessoas({
      linhas: [pessoa({ leads: 4 })],
      elegiveis: [{ usuario_id: 'u1', equipe_atual: { id: 'e1' } }],
    }),
  })[0]
  assert.deepEqual(E.alertasDaEquipe(limpa, 7), [], 'sem problema, sem alerta')

  const suja = E.montarEquipes({
    equipes: [{ id: 'e1', status: 'ativa', total_membros: 1 }],
    pessoas: E.montarPessoas({
      linhas: [pessoa({ leads: 4, leads_parados: 2, follow_ups_vencidos: 1 })],
      elegiveis: [{ usuario_id: 'u1', equipe_atual: { id: 'e1' } }],
    }),
  })[0]
  const chaves = E.alertasDaEquipe(suja, 7).map((a) => a.chave)
  assert.ok(chaves.includes('leads_parados'))
  assert.ok(chaves.includes('follow_ups_vencidos'))
})

test('equipe ativa SEM ninguem diz a consequencia', () => {
  const vazia = E.montarEquipes({ equipes: [{ id: 'e1', status: 'ativa', total_membros: 0 }], pessoas: [] })[0]
  const alerta = E.alertasDaEquipe(vazia, 7).find((a) => a.chave === 'equipe_vazia')
  assert.ok(alerta)
  assert.match(alerta.descricao, /não recorta/)
})

test('pessoa DESATIVADA com carga vira alerta da equipe', () => {
  const eq = E.montarEquipes({
    equipes: [{ id: 'e1', status: 'ativa', total_membros: 1 }],
    pessoas: E.montarPessoas({
      linhas: [pessoa({ ativo: false, leads: 9 })],
      elegiveis: [{ usuario_id: 'u1', equipe_atual: { id: 'e1' } }],
    }),
  })[0]
  const alerta = E.alertasDaEquipe(eq, 7).find((a) => a.chave === 'inativos_com_carga')
  assert.ok(alerta)
  assert.match(alerta.descricao, /NÃO redistribui/)
})

test('alertasGerais trata trabalho sem dono como FILA, nao como erro', () => {
  const alertas = E.alertasGerais({ semDono: { leads: 40, conversas: 2, follow_ups_aguardando: 0 } })
  const leads = alertas.find((a) => a.chave === 'leads_livres')
  assert.equal(leads.tom, 'neutro', 'lead livre e estado legitimo, nao problema')
  assert.match(leads.descricao, /não está parado/)
  assert.ok(alertas.find((a) => a.chave === 'conversas_sem_responsavel'))
  // Nada pendente, nada a dizer.
  assert.deepEqual(E.alertasGerais({ semDono: { leads: 0, conversas: 0, follow_ups_aguardando: 0 } }), [])
})

// ─── Filtros ────────────────────────────────────────────────────────────────────────────

test('filtrarEquipes procura por nome OU nicho', () => {
  const equipes = [
    { id: 'a', nome: 'Time 1', nicho_nome: 'Energia Solar' },
    { id: 'b', nome: 'Advocacia', nicho_nome: 'Juridico' },
  ]
  assert.deepEqual(E.filtrarEquipes(equipes, 'solar').map((e) => e.id), ['a'])
  assert.deepEqual(E.filtrarEquipes(equipes, 'advo').map((e) => e.id), ['b'])
  assert.equal(E.filtrarEquipes(equipes, '   ').length, 2, 'busca vazia nao filtra')
})

test('filtrarPessoas: busca, equipe, papel e status de acesso', () => {
  const pessoas = E.montarPessoas({
    linhas: [
      pessoa({ usuario_id: 'u1', nome: 'Ana', email: 'ana@x.com', papel: 'comercial' }),
      pessoa({ usuario_id: 'u2', nome: 'Bia', email: 'bia@y.com', papel: 'admin' }),
      pessoa({ usuario_id: 'u3', nome: 'Caio', email: 'caio@z.com', papel: 'comercial', ativo: false }),
    ],
    elegiveis: [{ usuario_id: 'u1', equipe_atual: { id: 'e1' } }],
  })
  const ids = (f) => E.filtrarPessoas(pessoas, f).map((p) => p.usuario_id)

  assert.deepEqual(ids({}), ['u1', 'u2'], 'o padrao esconde acesso revogado, nao gente')
  assert.deepEqual(ids({ status: 'todos' }), ['u1', 'u2', 'u3'])
  assert.deepEqual(ids({ status: 'inativos' }), ['u3'])
  assert.deepEqual(ids({ busca: 'bia@' }), ['u2'], 'busca tambem por e-mail')
  assert.deepEqual(ids({ equipeId: 'e1' }), ['u1'])
  assert.deepEqual(ids({ equipeId: 'sem_equipe' }), ['u2'])
  assert.deepEqual(ids({ papel: 'admin' }), ['u2'])
})

test('papeisPresentes lista so o que existe na empresa', () => {
  // Oferecer a matriz inteira daria filtro que nunca devolve nada.
  const pessoas = [pessoa({ papel: 'comercial' }), pessoa({ papel: 'owner' }), pessoa({ papel: 'comercial' })]
  assert.deepEqual(E.papeisPresentes(pessoas).map((p) => p.id).sort(), ['comercial', 'owner'])
})

test('resumoDoRecorte distingue vazio por AUSENCIA de vazio por FILTRO', () => {
  assert.match(E.resumoDoRecorte(0, 0), /Nenhuma pessoa nesta empresa/)
  assert.equal(E.resumoDoRecorte(3, 3), '3 pessoas')
  assert.equal(E.resumoDoRecorte(1, 1), '1 pessoa')
  assert.equal(E.resumoDoRecorte(9, 2), '2 de 9 pessoas')
})

// ─── Encerrar ───────────────────────────────────────────────────────────────────────────

test('podeEncerrar antecipa o 409 do backend em vez de deixar o gestor descobrir no erro', () => {
  // `encerrarEquipe` recusa com EQUIPE_COM_MEMBROS enquanto a devolucao de leads nao existir.
  const comGente = E.podeEncerrar({ status: 'ativa', total_membros: 3 })
  assert.equal(comGente.pode, false)
  assert.match(comGente.motivo, /devolução de leads/)
  assert.equal(E.podeEncerrar({ status: 'ativa', total_membros: 0 }).pode, true)
  assert.equal(E.podeEncerrar({ status: 'encerrada', total_membros: 0 }).pode, false)
})

// ─── Modal de membros ───────────────────────────────────────────────────────────────────

test('MODAL: quem ja e membro fica MARCADO e BLOQUEADO, com o motivo em texto', () => {
  // Desmarcar para remover e' justamente o que o backend recusa (409 REMOCAO_EXIGE_DEVOLUCAO).
  const st = E.situacaoNoModal({ usuario_id: 'u1', equipe_atual: { id: 'e1', nome: 'Solar' } }, 'e1')
  assert.equal(st.situacao, 'nesta_equipe')
  assert.equal(st.marcado, true)
  assert.equal(st.selecionavel, false)
  assert.equal(st.motivo, E.MOTIVO_REMOCAO_BLOQUEADA)
  assert.ok(st.rotulo, 'o estado tem rotulo em texto — cor nunca e o unico sinal')
})

test('MODAL: quem esta em OUTRA equipe e bloqueado dizendo QUAL', () => {
  // O 409 do backend fala de "uma das pessoas" sem dizer qual; a tela nomeia antes de tentar.
  const st = E.situacaoNoModal({ usuario_id: 'u2', equipe_atual: { id: 'e2', nome: 'Advocacia', nicho_nome: 'Juridico' } }, 'e1')
  assert.equal(st.situacao, 'outra_equipe')
  assert.equal(st.selecionavel, false)
  assert.match(st.motivo, /Advocacia/)
  assert.match(st.motivo, /uma equipe ativa por vez/)
})

test('MODAL: quem esta livre e selecionavel', () => {
  const st = E.situacaoNoModal({ usuario_id: 'u3', equipe_atual: null }, 'e1')
  assert.equal(st.situacao, 'sem_equipe')
  assert.equal(st.selecionavel, true)
  assert.equal(st.motivo, '')
})

test('MODAL: contagens e filtros batem com as tres situacoes', () => {
  const pessoas = [
    { usuario_id: 'u1', nome: 'Ana', email: 'ana@x.com', equipe_atual: { id: 'e1' } },
    { usuario_id: 'u2', nome: 'Bia', email: 'bia@y.com', equipe_atual: { id: 'e2', nome: 'Outra' } },
    { usuario_id: 'u3', nome: 'Caio', email: 'caio@z.com', equipe_atual: null },
  ]
  assert.deepEqual(E.contagensDoModal(pessoas, 'e1'), { todos: 3, sem_equipe: 1, nesta_equipe: 1 })
  assert.deepEqual(
    E.filtrarPessoasDoModal(pessoas, { filtro: 'nesta_equipe', equipeId: 'e1' }).map((p) => p.usuario_id),
    ['u1']
  )
  assert.deepEqual(
    E.filtrarPessoasDoModal(pessoas, { busca: 'caio@', filtro: 'todos', equipeId: 'e1' }).map((p) => p.usuario_id),
    ['u3']
  )
})

test('MODAL: o rodape conta ADICOES, nao selecionados', () => {
  // Dizer "4 selecionadas" quando 4 ja eram membros faria o botao prometer o que nao vai mudar.
  const vazio = E.resumoSelecaoModal([])
  assert.equal(vazio.podeSalvar, false)
  assert.ok(vazio.motivo, 'botao desabilitado nunca fica mudo')
  const um = E.resumoSelecaoModal(['u3'])
  assert.equal(um.texto, '1 pessoa será adicionada')
  assert.equal(um.podeSalvar, true)
  assert.equal(E.resumoSelecaoModal(['u3', 'u4']).texto, '2 pessoas serão adicionadas')
})

test('corpoDeParticipantes INCLUI os membros atuais — o PUT e substituicao', () => {
  // Mandar so os novos removeria todo mundo, e o backend recusaria a operacao inteira.
  const pessoas = [
    { usuario_id: 'u1', equipe_atual: { id: 'e1' } },
    { usuario_id: 'u2', equipe_atual: { id: 'e2' } },
    { usuario_id: 'u3', equipe_atual: null },
  ]
  assert.deepEqual(E.corpoDeParticipantes(pessoas, 'e1', ['u3']).sort(), ['u1', 'u3'])
  // Sem escolher ninguem, o corpo preserva quem ja esta.
  assert.deepEqual(E.corpoDeParticipantes(pessoas, 'e1', []), ['u1'])
  // Repetir um id nao duplica.
  assert.deepEqual(E.corpoDeParticipantes(pessoas, 'e1', ['u3', 'u3']).sort(), ['u1', 'u3'])
})

// ─── Guardas de regressao ───────────────────────────────────────────────────────────────

test('GUARDA: a area NAO vira placar de produtividade', () => {
  // Mesma disciplina de `equipe-painel.js`: as contagens medem coisas diferentes e nao se somam
  // num indice, e ninguem e' classificado por esforco.
  //
  // ⚠️ A palavra "ranking" NAO esta na lista de proibidos, e isso e' deliberado: ela e' o nome do
  // payload de `/comissao/ranking`, um endpoint que ja existe e mede FATURAMENTO PAGO ORIGINADO
  // (resultado de negocio verificavel, decisao de 2026-09-18). Receber esse dado nao e' criar um
  // placar; criar seria classificar, pontuar ou ordenar gente por ele — e e' isso que se proibe
  // abaixo, com as duas assercoes seguintes.
  for (const proibido of ['produtividade', 'score', 'media(', 'percentual', 'horas trabalhadas', 'medalha', 'posicao', 'classificacao']) {
    assert.ok(
      !SEM_COMENTARIOS.toLowerCase().includes(proibido),
      `"${proibido}" transformaria a area em placar — leia o cabecalho do modulo`
    )
  }
  // Nao se ordena gente por resultado: a ordem das pessoas e' a carga de trabalho
  // (`ordenarEquipe`, reexportada), para o gestor achar quem redistribuir.
  assert.ok(!/sort\([^)]*originado/.test(SEM_COMENTARIOS), 'ordenar por faturamento seria classificar gente')
  // E nenhuma metrica diferente entra na soma de outra.
  assert.ok(!/originado[^\n]*\+[^\n]*(leads|conversas|ligacoes)/.test(SEM_COMENTARIOS),
    'metricas de natureza diferente nao se somam')
})

test('GUARDA: o modulo nao decide permissao nem compara papel com literal', () => {
  // Quem autoriza e' o backend (requireCapacidade(MEMBROS_GERENCIAR)). Uma segunda regra aqui
  // faria a tela oferecer o que a API recusa, ou esconder o que ela permite.
  for (const proibido of ['membros_gerenciar', 'capacidades', "=== 'admin'", "=== 'owner'", "=== 'comercial'", "=== 'member'"]) {
    assert.ok(!SEM_COMENTARIOS.includes(proibido), `equipe-area.js nao pode conter '${proibido}'`)
  }
})

test('GUARDA: o modulo nao faz rede e nao conhece rota', () => {
  for (const proibido of ['fetch(', 'apiFetch', '/api/', 'axios', 'localStorage']) {
    assert.ok(!SEM_COMENTARIOS.includes(proibido), `nao pode conter '${proibido}'`)
  }
})

test('GUARDA: as regras herdadas sao REEXPORTADAS, nunca reimplementadas', () => {
  // Duas copias da mesma regra fariam a equipe aparecer de um jeito na lista e de outro no
  // detalhe aberto a partir dela (padrao de `paginacao.js` e `lead-identidade.js`).
  const painel = require('./equipe-painel')
  const comerciais = require('./equipes-comerciais')
  const comissao = require('./comissao')
  assert.strictEqual(E.rotuloPapel, painel.rotuloPapel)
  assert.strictEqual(E.ordenarEquipe, painel.ordenarEquipe)
  assert.strictEqual(E.cargaAtual, painel.cargaAtual)
  assert.strictEqual(E.estadoDaPessoa, comerciais.estadoDaPessoa)
  assert.strictEqual(E.validarFormulario, comerciais.validarFormulario)
  assert.strictEqual(E.nichosOcupados, comerciais.nichosOcupados)
  assert.strictEqual(E.formatarDinheiro, comissao.formatarDinheiro)
  // E o fonte nao pode redefinir nenhuma delas.
  for (const nome of ['function rotuloPapel', 'function cargaAtual', 'function estadoDaPessoa', 'function formatarDinheiro']) {
    assert.ok(!SEM_COMENTARIOS.includes(nome), `'${nome}' seria uma segunda regua`)
  }
})

test('GUARDA: a metrica de REUNIOES nao e inventada', () => {
  // Nao existe contagem de reunioes por pessoa em rota alguma deste produto. A referencia
  // visual pedia a coluna; inventa-la produziria um numero que ninguem consegue conferir.
  assert.ok(!SEM_COMENTARIOS.includes('reunio'), 'nenhuma metrica de reuniao tem fonte real hoje')
  const chaves = E.METRICAS_EQUIPE.map((m) => m.chave).concat(E.COLUNAS_MEMBRO.map((c) => c.chave))
  for (const c of chaves) assert.ok(!/reuni/i.test(c))
})
