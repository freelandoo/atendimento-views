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
  assert.ok(src.includes('if (!adicionar.length) return null'),
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
