'use strict'
// Distribuicao de leads por EQUIPE (2026-09-21).
// Regra PURA + guardas de regressao que LEEM O FONTE. Nenhum banco, nenhuma rede.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const D = require('../src/services/lead-distribuicao')

const raiz = path.join(__dirname, '..')
const ler = (p) => fs.readFileSync(path.join(raiz, p), 'utf8')
const SERVICO = ler('src/services/lead-distribuicao.js')
const DADOS = ler('src/db/lead-distribuicao.js')
const EQUIPES = ler('src/db/equipes-comerciais.js')
const ROTA = ler('src/routes/api-equipes-comerciais.js')

// Remove comentarios de linha, para as guardas nao acusarem a propria explicacao.
const semComentarios = (src) => src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')

// ─── O PLANO: divisao exata, sobra e o caso de quem cede ────────────────────────────────

test('divisao EXATA: todo mundo fica com a mesma meta', () => {
  const p = D.planoRebalanceamento({
    membros: [{ usuario_id: 'a', atual: 0 }, { usuario_id: 'b', atual: 0 }],
    livres: 10,
  })
  assert.equal(p.meta_base, 5)
  assert.deepEqual(p.membros.map((m) => m.meta), [5, 5])
  assert.equal(p.usar_livres, 10)
  assert.equal(p.mover_entre_membros, 0)
})

test('SOBRA vai para quem tem MENOS carteira, nunca para quem ja tem mais', () => {
  const p = D.planoRebalanceamento({
    membros: [{ usuario_id: 'cheio', atual: 4 }, { usuario_id: 'vazio', atual: 0 }],
    livres: 3,
  })
  // pool = 7, 2 pessoas => base 3, sobra 1
  assert.equal(p.meta_base, 3)
  const porId = new Map(p.membros.map((m) => [m.usuario_id, m]))
  assert.equal(porId.get('vazio').meta, 4, 'a sobra foi para quem tinha menos')
  assert.equal(porId.get('cheio').meta, 3)
})

test('quem esta ACIMA da meta CEDE, e quem esta abaixo RECEBE', () => {
  const p = D.planoRebalanceamento({
    membros: [{ usuario_id: 'a', atual: 10 }, { usuario_id: 'b', atual: 0 }],
    livres: 0,
  })
  const porId = new Map(p.membros.map((m) => [m.usuario_id, m]))
  assert.equal(porId.get('a').ceder, 5)
  assert.equal(porId.get('b').receber, 5)
  assert.equal(p.usar_livres, 0, 'nao havia livres')
  assert.equal(p.mover_entre_membros, 5)
})

test('os LIVRES sao consumidos ANTES de tirar lead da mao de alguem', () => {
  const p = D.planoRebalanceamento({
    membros: [{ usuario_id: 'a', atual: 8 }, { usuario_id: 'b', atual: 0 }],
    livres: 2,
  })
  // pool = 10 => meta 5 cada; b precisa de 5, e 2 saem dos livres.
  assert.equal(p.usar_livres, 2)
  assert.equal(p.mover_entre_membros, 3)
})

test('carteira ja equilibrada NAO produz movimento nenhum', () => {
  const p = D.planoRebalanceamento({
    membros: [{ usuario_id: 'a', atual: 5 }, { usuario_id: 'b', atual: 5 }],
    livres: 0,
  })
  assert.equal(p.total_movimentos, 0)
  assert.ok(p.membros.every((m) => m.receber === 0 && m.ceder === 0))
})

test('equipe SEM membros nao movimenta nada (e nao lanca)', () => {
  const p = D.planoRebalanceamento({ membros: [], livres: 500 })
  assert.equal(p.total_movimentos, 0)
  assert.deepEqual(p.membros, [])
})

test('o plano e DETERMINISTICO: empate desempata pelo id', () => {
  const a = D.planoRebalanceamento({ membros: [{ usuario_id: 'z', atual: 0 }, { usuario_id: 'a', atual: 0 }], livres: 3 })
  const b = D.planoRebalanceamento({ membros: [{ usuario_id: 'a', atual: 0 }, { usuario_id: 'z', atual: 0 }], livres: 3 })
  assert.deepEqual(a.membros.map((m) => [m.usuario_id, m.meta]), b.membros.map((m) => [m.usuario_id, m.meta]))
})

test('o TETO limita o movimento e AVISA, em vez de mover em silencio', () => {
  const p = D.planoRebalanceamento({ membros: [{ usuario_id: 'a', atual: 0 }], livres: D.TETO_MOVIMENTOS + 50 })
  assert.equal(p.total_movimentos, D.TETO_MOVIMENTOS)
  assert.equal(p.truncado, true)
})

// ─── PESO de desempenho (ajuste sobre a base igualitaria, 2026-09-21) ───────────────────

test('pesoDesempenho: sem faturamento registrado e NEUTRO, nunca penalizado', () => {
  assert.equal(D.pesoDesempenho({ originado: undefined, medianaOriginado: 5000, parados: 0, leads: 10 }), 1)
  assert.equal(D.pesoDesempenho({ originado: 0, medianaOriginado: 5000, parados: 0, leads: 10 }), 1)
})

test('pesoDesempenho: acima da mediana ganha o fator de bonus', () => {
  const p = D.pesoDesempenho({ originado: 8000, medianaOriginado: 5000, parados: 0, leads: 10 })
  assert.equal(p, D.FATOR_ACIMA_MEDIANA)
})

test('pesoDesempenho: abaixo ou igual a mediana fica no peso base', () => {
  assert.equal(D.pesoDesempenho({ originado: 5000, medianaOriginado: 5000, parados: 0, leads: 10 }), 1)
  assert.equal(D.pesoDesempenho({ originado: 2000, medianaOriginado: 5000, parados: 0, leads: 10 }), 1)
})

test('pesoDesempenho: muitos leads parados (>=30% da carteira) reduz o peso', () => {
  const p = D.pesoDesempenho({ originado: 0, medianaOriginado: 0, parados: 3, leads: 10 })
  assert.equal(p, D.FATOR_PARADOS_ALTO)
  // Abaixo do corte, nao penaliza.
  assert.equal(D.pesoDesempenho({ originado: 0, medianaOriginado: 0, parados: 2, leads: 10 }), 1)
})

test('pesoDesempenho: os dois fatores se COMBINAM (multiplicam)', () => {
  const p = D.pesoDesempenho({ originado: 8000, medianaOriginado: 5000, parados: 5, leads: 10 })
  assert.equal(p, D.FATOR_ACIMA_MEDIANA * D.FATOR_PARADOS_ALTO)
})

test('medianaOriginado: ignora quem nao vendeu (so conta valores POSITIVOS)', () => {
  assert.equal(D.medianaOriginado([0, 0, 5000]), 5000)
  assert.equal(D.medianaOriginado([]), 0)
  assert.equal(D.medianaOriginado([1000, 3000]), 2000)
  assert.equal(D.medianaOriginado([1000, 2000, 3000]), 2000)
})

test('planoRebalanceamento: SEM peso informado, o resultado e IDENTICO ao igualitario de sempre', () => {
  // Compatibilidade: `puxarLeads` e testes antigos nunca passam `peso` — peso ausente vira 1 em
  // todo mundo, e a divisao volta a ser a igualitaria original.
  const semPeso = D.planoRebalanceamento({
    membros: [{ usuario_id: 'a', atual: 4 }, { usuario_id: 'b', atual: 0 }], livres: 3,
  })
  const pesoUm = D.planoRebalanceamento({
    membros: [{ usuario_id: 'a', atual: 4, peso: 1 }, { usuario_id: 'b', atual: 0, peso: 1 }], livres: 3,
  })
  assert.deepEqual(semPeso.membros, pesoUm.membros)
})

test('planoRebalanceamento: quem tem PESO maior recebe mais da sobra e do pool', () => {
  const p = D.planoRebalanceamento({
    membros: [
      { usuario_id: 'top', atual: 0, peso: D.FATOR_ACIMA_MEDIANA },
      { usuario_id: 'base', atual: 0, peso: 1 },
    ],
    livres: 9,
  })
  const porId = new Map(p.membros.map((m) => [m.usuario_id, m.meta]))
  assert.ok(porId.get('top') > porId.get('base'), 'quem tem peso maior deve receber meta maior')
  // O total continua batendo com o pool — o peso AJUSTA a divisao, nunca inventa lead.
  assert.equal(porId.get('top') + porId.get('base'), 9)
})

test('planoRebalanceamento: peso invalido (0, negativo, NaN) cai no NEUTRO — nunca lanca', () => {
  const p = D.planoRebalanceamento({
    membros: [
      { usuario_id: 'a', atual: 0, peso: 0 },
      { usuario_id: 'b', atual: 0, peso: -5 },
      { usuario_id: 'c', atual: 0, peso: NaN },
    ],
    livres: 9,
  })
  // Os tres viram peso 1 -> divisao igualitaria, 3 cada.
  assert.deepEqual(p.membros.map((m) => m.meta).sort(), [3, 3, 3])
})

test('planoRebalanceamento: o metodo dos RESTOS MAIORES conserva o total exatamente', () => {
  // 3 pessoas com pesos desiguais, pool que nao divide exato — a soma das metas TEM que bater
  // com o pool, sempre (e' a garantia do apportionment, nao um acidente de arredondamento).
  const p = D.planoRebalanceamento({
    membros: [
      { usuario_id: 'a', atual: 0, peso: 2 },
      { usuario_id: 'b', atual: 0, peso: 1 },
      { usuario_id: 'c', atual: 0, peso: 1 },
    ],
    livres: 10,
  })
  const soma = p.membros.reduce((t, m) => t + m.meta, 0)
  assert.equal(soma, 10)
})

// ─── A PUXADA MANUAL ────────────────────────────────────────────────────────────────────

test('puxada "todos" divide em partes iguais, a sobra para quem tem menos', () => {
  const p = D.planoPuxada({
    membros: [{ usuario_id: 'cheio', atual: 100 }, { usuario_id: 'vazio', atual: 0 }],
    disponiveis: 50, quantidade: 5, entre: 'todos',
  })
  const porId = new Map(p.membros.map((m) => [m.usuario_id, m.receber]))
  assert.equal(porId.get('vazio'), 3)
  assert.equal(porId.get('cheio'), 2)
  assert.equal(p.total_movimentos, 5)
})

test('puxada "menor_carteira" enche o mais vazio primeiro', () => {
  const p = D.planoPuxada({
    membros: [{ usuario_id: 'cheio', atual: 100 }, { usuario_id: 'vazio', atual: 0 }],
    disponiveis: 50, quantidade: 10, entre: 'menor_carteira',
  })
  const porId = new Map(p.membros.map((m) => [m.usuario_id, m.receber]))
  assert.equal(porId.get('vazio'), 10)
  assert.equal(porId.get('cheio'), 0)
})

test('a puxada NUNCA promete mais do que ha disponivel', () => {
  const p = D.planoPuxada({
    membros: [{ usuario_id: 'a', atual: 0 }], disponiveis: 3, quantidade: 100, entre: 'todos',
  })
  assert.equal(p.total_movimentos, 3)
})

test('quantidade e criterio invalidos caem no padrao, sem lancar', () => {
  assert.equal(D.normalizarQuantidade(0), 10)
  assert.equal(D.normalizarQuantidade(-5), 10)
  assert.equal(D.normalizarQuantidade('abc'), 10)
  assert.equal(D.normalizarQuantidade(99999), D.QUANTIDADE_MAX)
  assert.equal(D.criterioValido('sql injection'), D.CRITERIO.MAIS_ANTIGOS)
  assert.equal(D.entreValido('qualquer coisa'), D.DISTRIBUIR_ENTRE.TODOS)
})

test('o ORDER BY sai de um mapa FECHADO — nada do cliente entra no SQL', () => {
  const ordens = Object.values(D.CRITERIO).map((c) => D.ordemDoCriterio(c))
  assert.equal(new Set(ordens).size, 3, 'os tres criterios produzem ordens DIFERENTES')
  // O controle que nao muda nada seria um controle que mente.
  assert.equal(D.ordemDoCriterio("'; DROP TABLE prospects; --"), D.ordemDoCriterio(D.CRITERIO.MAIS_ANTIGOS))
})

// ─── O PREDICADO DE PROTECAO ────────────────────────────────────────────────────────────

test('redistribuivel exige AUSENCIA dos cinco sinais de trabalho', () => {
  const sql = D.sqlRedistribuivel('p', '$2')
  for (const fonte of ['lead_disparos', 'app.ligacoes', 'app.follow_ups', 'agenda_eventos', 'vendas.conversas']) {
    assert.ok(sql.includes(fonte), `o predicado precisa olhar ${fonte}`)
  }
  // Cada sinal entra NEGADO: a regra e "nenhum sinal", nunca "algum sinal permite".
  assert.equal((sql.match(/AND NOT /g) || []).length, 4)
})

test('a porta da qualificacao e o status inicial estao no predicado', () => {
  const sql = D.sqlRedistribuivel('p', '$2')
  assert.ok(sql.includes("qualificacao IN ('aprovado', 'legado')"), 'lead pendente/descartado nao e movido')
  assert.ok(sql.includes('bloqueado_ate'), 'lead bloqueado nao e movido')
  for (const s of ['coletado', 'contato_encontrado', 'aguardando', 'aprovado']) {
    assert.ok(sql.includes(`'${s}'`), `status inicial ${s} deve entrar`)
  }
  // Os status que provam abordagem ou desfecho NAO podem estar na lista de iniciais.
  for (const s of ['respondeu', 'enviado', 'fechado', 'rejeitado', 'nao_contatar']) {
    assert.ok(!D.STATUS_INICIAIS.includes(s), `${s} nunca e lead intocado`)
  }
})

test('o predicado casa o NICHO por id, nunca pelo texto livre', () => {
  const sql = D.sqlRedistribuivel('p', '$2')
  assert.ok(sql.includes('nicho_id = $2::uuid'))
  assert.ok(!/p\.nicho\b(?!_id)/.test(sql), 'casar por nome tiraria leads do recorte em silencio')
})

test('todo motivo de protecao tem rotulo, e nenhum rotulo tem PII', () => {
  for (const motivo of Object.values(D.MOTIVO_PROTEGIDO)) {
    const r = D.rotuloMotivoProtegido(motivo)
    assert.ok(r.length > 3, `${motivo} precisa de rotulo`)
    assert.ok(!/telefone|email|@|\d{4}/.test(r), `${motivo}: rotulo nao carrega PII`)
  }
  assert.equal(D.rotuloMotivoProtegido('inexistente'), '')
})

test('o CASE de motivo cobre TODOS os valores do vocabulario', () => {
  const sql = D.sqlMotivoProtegido('p', '$2')
  for (const motivo of Object.values(D.MOTIVO_PROTEGIDO)) {
    assert.ok(sql.includes(`'${motivo}'`), `o CASE precisa poder devolver ${motivo}`)
  }
})

// ─── GUARDAS DE REGRESSAO (leem o fonte) ────────────────────────────────────────────────

test('GUARDA: o modulo de regra e PURO — sem banco, sem HTTP, sem IA', () => {
  for (const proibido of ["require('../db", "require('./db", 'pool.query', 'fetch(', 'axios', 'generateAIResponse']) {
    assert.ok(!SERVICO.includes(proibido), `"${proibido}" quebra a pureza de lead-distribuicao.js`)
  }
})

test('GUARDA: a distribuicao NAO devolve lead para a fila', () => {
  // Distribuir e' dar dono. Devolver e' o botao de `db/lead-responsavel.js`, acionado por uma
  // pessoa — um `responsavel_id = NULL` aqui seria o sistema esvaziando carteira sozinho.
  assert.ok(!/responsavel_id\s*=\s*NULL/i.test(semComentarios(DADOS)),
    'devolver para a fila e ato humano, nao efeito de distribuicao')
  for (const proibido of ['liberar', 'devolver']) {
    assert.ok(!new RegExp(`function ${proibido}`, 'i').test(DADOS), `${proibido} nao pertence a este modulo`)
  }
})

test('GUARDA: o peso de desempenho so LE o ranking, nunca escreve em comissao', () => {
  const src = semComentarios(DADOS)
  assert.match(src, /require\('\.\/comissao'\)/, 'precisa reusar rankingDoMes, nao duplicar a leitura')
  for (const proibido of ['registrarVenda', 'registrarPagamento', 'marcarComissaoPaga', 'cancelarVenda', 'publicarPlano']) {
    assert.ok(!src.includes(proibido), `distribuicao de lead nao pode escrever em comissao ('${proibido}')`)
  }
})

test('GUARDA: falha ao ler o ranking do mes NAO impede a entrada na equipe (fica neutro)', () => {
  const bloco = DADOS.slice(DADOS.indexOf('async function pesosDeDesempenho'), DADOS.indexOf('async function rebalancearEquipe'))
  assert.match(bloco, /try\s*{/, 'a leitura do ranking precisa estar protegida')
  assert.match(bloco, /catch/, 'falha no ranking cai para peso neutro, nunca lanca')
})

test('GUARDA: a puxada manual (planoPuxada) continua SEM peso de desempenho, de proposito', () => {
  // Escopo desta rodada (2026-09-21): so o rebalanceamento AUTOMATICO (entrada na equipe) usa
  // peso. "Puxar mais leads" e a distribuicao em lote da Aquisicao continuam com os criterios
  // explicitos que ja tinham (todos/menor_carteira/selecionados, melhores/mais_antigos/sem_contato).
  const bloco = SERVICO.slice(SERVICO.indexOf('function planoPuxada'), SERVICO.indexOf('/** Rotulo curto'))
  assert.ok(!/\.peso\b/.test(bloco), 'planoPuxada nao deve ler peso de desempenho nesta etapa')
})

test('GUARDA: nenhum WORKER importa a distribuicao', () => {
  // Os gatilhos sao a ENTRADA na equipe e o comando do gestor. Um job que redistribui carteira
  // sozinho e' a automacao que services/lead-parado.js recusou no cabecalho dele.
  const dir = path.join(raiz, 'src', 'services')
  const suspeitos = fs.readdirSync(dir)
    .filter((f) => /worker|auto|scheduler/i.test(f) && f.endsWith('.js'))
    .filter((f) => ler(`src/services/${f}`).includes('lead-distribuicao'))
  assert.deepEqual(suspeitos, [], 'distribuicao de carteira nao roda sozinha')
})

test('GUARDA: toda escrita de dono passa por UPDATE CONDICIONADO ao dono esperado', () => {
  // A corrida e resolvida pelo banco, nunca por SELECT seguido de UPDATE.
  const src = semComentarios(DADOS)
  assert.ok(src.includes('AND t.responsavel_id IS NULL'), 'o livre so e tomado se continuar livre')
  assert.ok(src.includes('AND t.responsavel_id = $3::uuid'), 'a transferencia so ocorre se o cedente ainda for o dono')
  assert.ok(src.includes('pg_advisory_xact_lock'), 'dois gestores simultaneos precisam ser serializados')
})

test('GUARDA: o historico por lead e gravado pelo DONO da tabela, sem segunda copia', () => {
  assert.ok(DADOS.includes('registrarMudancasEmLote'), 'reusa o gravador de db/lead-responsavel.js')
  assert.ok(!DADOS.includes('INSERT INTO app.lead_responsavel_historico'),
    'app.lead_responsavel_historico tem um dono so')
})

test('GUARDA: o rebalanceamento automatico so dispara quando alguem ENTRA', () => {
  const src = semComentarios(EQUIPES)
  assert.ok(src.includes("if (!adicionar.length) return { distribuicao: null, devolucao }"),
    'salvar a mesma lista de participantes nao pode remexer carteira')
  assert.ok(src.includes('DIST.rebalancearEquipe'), 'o gatilho vive na transacao dos participantes')
})

test('GUARDA: a rota de distribuicao exige LEAD_TRANSFERIR, e a de carteira NAO escreve', () => {
  const linhaPost = ROTA.split('\n').find((l) => l.includes("router.post('/:equipeId/distribuicao'"))
  assert.ok(linhaPost && linhaPost.includes('CAP.LEAD_TRANSFERIR'),
    'mexer em dono de lead e outra decisao que administrar contas')
  assert.ok(linhaPost.indexOf('requireEmpresaAccess') < linhaPost.indexOf('requireCapacidade'),
    'capacidade depois do tenant, senao cai para todo mundo')
  const linhaGet = ROTA.split('\n').find((l) => l.includes("router.get('/:equipeId/carteira'"))
  assert.ok(linhaGet && !linhaGet.includes('requireCapacidade'), 'ler a propria carteira e parte de gerir a equipe')
})

test('GUARDA: a leitura da carteira nao escreve nada', () => {
  const leitura = DADOS.slice(DADOS.indexOf('async function carteiraDaEquipe'), DADOS.indexOf('async function contagensParaPlano'))
  for (const verbo of ['INSERT', 'UPDATE', 'DELETE']) {
    assert.ok(!leitura.includes(verbo), `abrir o painel nao pode ${verbo}`)
  }
})

test('GUARDA: o motivo gravado no historico e de vocabulario FECHADO', () => {
  for (const origem of Object.values(D.ORIGEM)) {
    assert.ok(DADOS.includes(origem) || EQUIPES.includes(origem) || SERVICO.includes(origem),
      `${origem} precisa ser usado para nao virar vocabulario morto`)
    assert.ok(/^[a-z_]+$/.test(origem), 'motivo agrupavel: sem texto livre e sem PII')
  }
})

test('GUARDA: a expressao de telefone tem UM dono (src/telefone-br.js)', () => {
  assert.ok(SERVICO.includes("require('../telefone-br')"))
  // Uma segunda copia protegeria o lead errado enquanto a listagem continuaria certa.
  assert.ok(!/CASE WHEN length\(regexp_replace/.test(SERVICO),
    'a normalizacao de telefone nao se copia, se importa')
})

// ─── TRANSFERENCIA ENTRE MEMBROS (2026-09-23) ───────────────────────────────────────────
//
// O gestor escolhe de quem sai, para quem vai e quantos. Decisoes do operador: o padrao e' so'
// INTOCADO, e "incluir os em andamento" amplia o conjunto sem fazer os protegidos sairem primeiro.

test('validarTransferencia: pedido valido devolve os campos normalizados', () => {
  const v = D.validarTransferencia({ origemId: 'a', destinoId: 'b', quantidade: '7', incluirProtegidos: true })
  assert.equal(v.ok, true)
  assert.equal(v.quantidade, 7)
  assert.equal(v.incluirProtegidos, true)
  assert.equal(v.origemId, 'a')
  assert.equal(v.destinoId, 'b')
})

test('validarTransferencia: recusa origem, destino ou quantidade ausentes, e a mesma pessoa', () => {
  assert.equal(D.validarTransferencia({ destinoId: 'b', quantidade: 1 }).code, 'SEM_ORIGEM')
  assert.equal(D.validarTransferencia({ origemId: 'a', quantidade: 1 }).code, 'SEM_DESTINO')
  assert.equal(D.validarTransferencia({ origemId: 'a', destinoId: 'a', quantidade: 1 }).code, 'MESMA_PESSOA')
  assert.equal(D.validarTransferencia({ origemId: 'a', destinoId: 'b', quantidade: 0 }).code, 'QUANTIDADE_INVALIDA')
  assert.equal(D.validarTransferencia({ origemId: 'a', destinoId: 'b', quantidade: 'dez' }).code, 'QUANTIDADE_INVALIDA')
  for (const r of [
    D.validarTransferencia({ destinoId: 'b', quantidade: 1 }),
    D.validarTransferencia({ origemId: 'a', destinoId: 'a', quantidade: 1 }),
  ]) assert.ok(r.motivo && r.motivo.length > 10, 'recusa nunca fica muda')
})

test('validarTransferencia: acima do TETO e recusado, nunca truncado em silencio', () => {
  const v = D.validarTransferencia({ origemId: 'a', destinoId: 'b', quantidade: D.TETO_MOVIMENTOS + 1 })
  assert.equal(v.ok, false)
  assert.equal(v.code, 'QUANTIDADE_ACIMA_DO_TETO')
  assert.equal(D.validarTransferencia({ origemId: 'a', destinoId: 'b', quantidade: D.TETO_MOVIMENTOS }).ok, true)
})

test('validarTransferencia: SO o booleano true inclui os em andamento (a string cai no lado seguro)', () => {
  // Boolean('false') e' true: aceitar texto moveria negociacao sem ninguem ter pedido.
  for (const valor of ['true', 'false', 1, 'on', '', null, undefined, {}]) {
    const v = D.validarTransferencia({ origemId: 'a', destinoId: 'b', quantidade: 1, incluirProtegidos: valor })
    assert.equal(v.incluirProtegidos, false, `${JSON.stringify(valor)} nao pode incluir protegidos`)
  }
})

test('sqlTransferivel SEM a caixa e IDENTICO ao predicado do rebalanceamento', () => {
  // Se divergirem, a transferencia padrao moveria lead que o rebalanceamento protege.
  assert.equal(D.sqlTransferivel('p', '$2'), D.sqlRedistribuivel('p', '$2'))
  assert.equal(D.sqlTransferivel('p', '$2', { incluirProtegidos: false }), D.sqlRedistribuivel('p', '$2'))
})

test('sqlTransferivel COM a caixa: nicho por id + porta de qualificacao, sem exigir ausencia de trabalho', () => {
  const sql = D.sqlTransferivel('p', '$2', { incluirProtegidos: true })
  assert.match(sql, /p\.nicho_id = \$2::uuid/, 'continua preso ao nicho da equipe')
  assert.ok(!/p\.nicho\b(?!_id)/.test(sql), 'nunca pelo texto livre do nicho')
  assert.ok(sql.includes('qualificacao'), 'descartado e pendente continuam fora (porta da 071)')
  // O que ele deixa de exigir e' justamente a ausencia dos sinais de trabalho.
  assert.ok(!sql.includes('agenda_eventos'), 'com a caixa marcada, reuniao marcada deixa de proteger')
})

test('sqlOrdemTransferencia: os INTOCADOS saem primeiro, sempre', () => {
  // Marcar a caixa amplia o conjunto; nao faz a negociacao em andamento ser a primeira a sair.
  const ordem = D.sqlOrdemTransferencia('p', '$2')
  assert.match(ordem, /^CASE WHEN/, 'o primeiro criterio da ordem e o intocado')
  assert.ok(ordem.includes(D.sqlRedistribuivel('p', '$2')), 'intocado segundo a MESMA regra do rebalanceamento')
  assert.match(ordem, /THEN 0 ELSE 1 END/)
})

test('o motivo da transferencia e de vocabulario fechado e diferente do da puxada', () => {
  assert.equal(D.ORIGEM.TRANSFERENCIA_ENTRE_MEMBROS, 'transferencia_entre_membros')
  assert.notEqual(D.ORIGEM.TRANSFERENCIA_ENTRE_MEMBROS, D.ORIGEM.PUXADA_MANUAL,
    'puxar tira da FILA; transferir tira da MAO de alguem — o historico precisa distinguir')
})

test('GUARDA: a rota de transferencia exige LEAD_TRANSFERIR, depois do tenant', () => {
  const linha = ROTA.split('\n').find((l) => l.includes("router.post('/:equipeId/transferencia'"))
  assert.ok(linha, 'a rota precisa existir')
  assert.ok(linha.includes('CAP.LEAD_TRANSFERIR'), 'tirar lead da mao de alguem e decisao sobre carteira')
  assert.ok(linha.indexOf('requireEmpresaAccess') < linha.indexOf('requireCapacidade'),
    'capacidade depois do tenant, senao cai para todo mundo')
})

test('GUARDA: origem E destino precisam ser membros DESTA equipe', () => {
  const corpo = EQUIPES.slice(
    EQUIPES.indexOf('async function transferirLeadsNaEquipe'),
    EQUIPES.indexOf('module.exports')
  )
  assert.ok(corpo.length > 200, 'transferirLeadsNaEquipe precisa existir')
  assert.match(corpo, /FORA_DA_EQUIPE/, 'id de fora nao vira porta lateral')
  assert.match(corpo, /v\.origemId/)
  assert.match(corpo, /v\.destinoId/)
  assert.match(corpo, /EQUIPE_ENCERRADA/, 'equipe encerrada e historico, nao movimenta')
  assert.match(corpo, /D\.validarTransferencia/, 'a validacao do pedido e a da regra pura, nao uma segunda')
})

test('GUARDA: o rebalanceamento AUTOMATICO continua movendo so intocado', () => {
  // A caixa de "incluir em andamento" e' da transferencia MANUAL. Se o rebalanceamento passasse
  // a usa-la, quem ENTRA numa equipe tiraria negociacao da mao dos colegas sem ninguem pedir.
  const rebal = DADOS.slice(DADOS.indexOf('async function rebalancearEquipe'), DADOS.indexOf('async function puxarLeads'))
  assert.ok(rebal.includes('moverEntreMembros'), 'o rebalanceamento ainda cede entre membros')
  assert.ok(!rebal.includes('incluirProtegidos'), 'o rebalanceamento nunca inclui protegidos')
})

test('GUARDA: a transferencia grava historico por lead com TRANSFERIU e motivo fechado', () => {
  const corpo = DADOS.slice(DADOS.indexOf('async function transferirLeads'), DADOS.indexOf('module.exports'))
  assert.ok(corpo.includes('registrarMudancasEmLote'), 'historico pelo dono da tabela')
  assert.ok(corpo.includes('ACOES.TRANSFERIU'), 'o lead JA tinha dono: e transferencia, nao atribuicao')
  assert.ok(corpo.includes('D.ORIGEM.TRANSFERENCIA_ENTRE_MEMBROS'), 'motivo de vocabulario fechado')
  assert.ok(corpo.includes('travarEquipe'), 'dois gestores simultaneos precisam ser serializados')
  assert.ok(corpo.includes("'equipe_comercial_leads_transferidos'"), 'linha agregada na auditoria')
})

test('GUARDA: a visibilidade da base bruta sai como BOOLEANO, e as concessoes nao vazam', () => {
  // membrosDaEquipe alimenta respostas de API; acrescentar permissoes ali vazaria as concessoes
  // de cada pessoa em /equipes-comerciais/:id.
  const membros = EQUIPES.slice(EQUIPES.indexOf('async function membrosDaEquipe'), EQUIPES.indexOf('async function listarEquipes'))
  assert.ok(!membros.includes('permissoes'), 'membrosDaEquipe nao seleciona permissoes')
  const carteira = EQUIPES.slice(EQUIPES.indexOf('async function carteiraDaEquipe'), EQUIPES.indexOf('async function quemVeBaseBruta'))
  assert.ok(carteira.includes('ve_base_bruta'), 'a carteira devolve a visibilidade de cada pessoa')
  assert.ok(!/permissoes\s*:/.test(carteira), 'a resposta da carteira nao carrega permissoes')
  assert.ok(EQUIPES.includes('podeCapacidade('), 'decidido pela regra de capacidade, nunca por papel literal')
})

test('GUARDA: os pontos de atencao sao LEITURA e nao comparam qualificacao com literal', () => {
  const corpo = DADOS.slice(DADOS.indexOf('async function pontosDeAtencaoDoNicho'), DADOS.indexOf('async function resumoProtegidos'))
  assert.ok(corpo.length > 100, 'pontosDeAtencaoDoNicho precisa existir')
  for (const verbo of ['INSERT', 'UPDATE', 'DELETE']) assert.ok(!corpo.includes(verbo), `abrir o painel nao pode ${verbo}`)
  assert.ok(corpo.includes('Q.QUALIFICACAO.PENDENTE'), 'o valor vem do modulo dono, como parametro')
  assert.ok(!/qualificacao\s*=\s*'/.test(corpo), 'nada de literal de qualificacao')
})
