'use strict'
// Operação Comercial, Etapa 2 — Missão (desafio com recompensa). Regra PURA + guardas.
//
// O que esta suíte protege: que a missão continue sendo um FATO imutável medido por RESULTADO
// PAGO, e que o progresso de uma pessoa nunca vire placar entre pessoas.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const M = require('../src/services/missao')

const RAIZ = path.join(__dirname, '..')
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8')
const migration = fonte('sql/migrations/085_missao.sql')

const EM = (iso) => new Date(`${iso}T12:00:00Z`)
const MISSAO = Object.freeze({
  status: 'ativa', inicio: '2026-09-01', fim: '2026-09-30', alvo_valor: 20000,
})

// ─── Situação ────────────────────────────────────────────────────────────────────────────

test('as quatro situacoes sao distinguidas — e prazo_vencido NAO e encerrada', () => {
  // A janela acabou mas ninguém fechou: são estados diferentes e pedem frases diferentes.
  assert.equal(M.situacao(MISSAO, EM('2026-08-20')), M.SITUACAO.AGENDADA)
  assert.equal(M.situacao(MISSAO, EM('2026-09-15')), M.SITUACAO.VIGENTE)
  assert.equal(M.situacao(MISSAO, EM('2026-10-01')), M.SITUACAO.PRAZO_VENCIDO)
  assert.equal(M.situacao({ ...MISSAO, status: 'encerrada' }, EM('2026-09-15')), M.SITUACAO.ENCERRADA)
})

test('a janela e FECHADA nas duas pontas', () => {
  assert.equal(M.situacao(MISSAO, EM('2026-09-01')), M.SITUACAO.VIGENTE, 'o primeiro dia conta')
  assert.equal(M.situacao(MISSAO, EM('2026-09-30')), M.SITUACAO.VIGENTE, 'o ultimo dia conta')
})

test('ausencia de missao e estado legitimo, nunca erro nem missao vazia', () => {
  assert.equal(M.situacao(null), null)
  assert.equal(M.vigente(null), false)
  assert.doesNotThrow(() => M.situacao(undefined))
})

// ─── Progresso ───────────────────────────────────────────────────────────────────────────

test('progresso: valor, quanto falta e se alcancou', () => {
  const p = M.progresso({ valor: 12500, alvo: 20000 })
  assert.equal(p.valor, 12500)
  assert.equal(p.faltam, 7500)
  assert.equal(p.alcancado, false)
  assert.ok(Math.abs(p.fracao - 0.625) < 1e-9)
})

test('passou do alvo: alcancado, sem faltar nada e sem barra de 340%', () => {
  const p = M.progresso({ valor: 68000, alvo: 20000 })
  assert.equal(p.alcancado, true)
  assert.equal(p.faltam, 0, 'faltam nunca e negativo')
  assert.equal(p.fracao, 1, 'a fracao e limitada a 1')
})

test('bater EXATAMENTE o alvo ja e alcancar', () => {
  assert.equal(M.progresso({ valor: 20000, alvo: 20000 }).alcancado, true)
})

test('alvo ilegivel NAO comemora conquista que ninguem definiu', () => {
  for (const alvo of [null, 0, -5, 'abc', undefined]) {
    const p = M.progresso({ valor: 99999, alvo })
    assert.equal(p.alcancado, false, `alvo ${JSON.stringify(alvo)} nao pode dar conquista`)
    assert.equal(p.alvo, null)
  }
})

test('sem nenhuma venda o progresso e zero, nao quebra', () => {
  const p = M.progresso({ valor: null, alvo: 20000 })
  assert.equal(p.valor, 0)
  assert.equal(p.faltam, 20000)
  assert.equal(p.alcancado, false)
})

// ─── Publicar ────────────────────────────────────────────────────────────────────────────

test('sem missao ativa, publicar e liberado', () => {
  const v = M.avaliarPublicacao(null)
  assert.equal(v.permitido, true)
  assert.equal(v.veredito, M.VEREDITO_PUBLICACAO.LIBERADO)
})

test('missao ativa e VALENDO: publicar outra e RECUSADO', () => {
  // Encerrar um desafio antes da hora é uma decisão — tem gente contando com a recompensa.
  // Não pode ser efeito colateral de publicar outro.
  const v = M.avaliarPublicacao(MISSAO, EM('2026-09-15'))
  assert.equal(v.permitido, false)
  assert.equal(v.veredito, M.VEREDITO_PUBLICACAO.ATIVA_EM_ANDAMENTO)
})

test('missao ativa com PRAZO VENCIDO: publicar encerra a anterior', () => {
  // Exigir dois cliques para uma consequência inevitável só produziria empresas travadas por
  // uma missão vencida que ninguém lembrou de fechar.
  const v = M.avaliarPublicacao(MISSAO, EM('2026-10-05'))
  assert.equal(v.permitido, true)
  assert.equal(v.veredito, M.VEREDITO_PUBLICACAO.ENCERRA_A_ANTERIOR)
})

test('missao AGENDADA tambem bloqueia: ela ainda vai valer', () => {
  const v = M.avaliarPublicacao(MISSAO, EM('2026-08-20'))
  assert.equal(v.permitido, false)
})

// ─── Validação ───────────────────────────────────────────────────────────────────────────

const VALIDA = Object.freeze({
  titulo: 'Desafio de setembro',
  alvo_valor: 20000,
  inicio: '2026-09-01',
  fim: '2026-09-30',
  recompensa_descricao: 'R$ 1.000 de bônus para quem bater',
})

test('missao valida passa e a metrica tem padrao (a unica que existe)', () => {
  const r = M.validarMissao(VALIDA)
  assert.equal(r.ok, true)
  assert.equal(r.dados.metrica, M.METRICA.FATURAMENTO_PAGO_ORIGINADO)
  assert.equal(r.dados.alvo_valor, 20000)
  assert.equal(r.dados.recompensa_valor, null, 'recompensa em dinheiro e opcional')
})

test('metrica DESCONHECIDA e recusada, nunca trocada pelo padrao em silencio', () => {
  // Quem mandou outra coisa achava que estava medindo outra coisa.
  const r = M.validarMissao({ ...VALIDA, metrica: 'reunioes_realizadas' })
  assert.equal(r.ok, false)
  assert.equal(r.recusa, M.RECUSAS.METRICA)
})

test('alvo precisa valer alguma coisa', () => {
  for (const alvo of [0, -1, null, '', 'abc', undefined]) {
    assert.equal(M.validarMissao({ ...VALIDA, alvo_valor: alvo }).recusa, M.RECUSAS.ALVO)
  }
})

test('janela invalida e recusada, inclusive data que nao existe', () => {
  assert.equal(M.validarMissao({ ...VALIDA, fim: '2026-08-31' }).recusa, M.RECUSAS.JANELA, 'fim antes do inicio')
  assert.equal(M.validarMissao({ ...VALIDA, inicio: '2026-02-31' }).recusa, M.RECUSAS.JANELA, '31 de fevereiro nao existe')
  assert.equal(M.validarMissao({ ...VALIDA, inicio: '01/09/2026' }).recusa, M.RECUSAS.JANELA)
  assert.equal(M.validarMissao({ ...VALIDA, fim: '' }).recusa, M.RECUSAS.JANELA)
})

test('janela de UM dia e valida', () => {
  assert.equal(M.validarMissao({ ...VALIDA, inicio: '2026-09-10', fim: '2026-09-10' }).ok, true)
})

test('desafio SEM recompensa declarada e recusado — senao e so uma meta', () => {
  assert.equal(M.validarMissao({ ...VALIDA, recompensa_descricao: '' }).recusa, M.RECUSAS.RECOMPENSA)
  assert.equal(M.validarMissao({ ...VALIDA, recompensa_descricao: '  ' }).recusa, M.RECUSAS.RECOMPENSA)
})

test('recompensa em dinheiro, quando vem, precisa ser maior que zero', () => {
  assert.equal(M.validarMissao({ ...VALIDA, recompensa_valor: 1000 }).dados.recompensa_valor, 1000)
  assert.equal(M.validarMissao({ ...VALIDA, recompensa_valor: 0 }).recusa, M.RECUSAS.RECOMPENSA_VALOR)
  assert.equal(M.validarMissao({ ...VALIDA, recompensa_valor: -5 }).recusa, M.RECUSAS.RECOMPENSA_VALOR)
  // Vazio = não informado, que é diferente de zero.
  assert.equal(M.validarMissao({ ...VALIDA, recompensa_valor: '' }).dados.recompensa_valor, null)
})

test('titulo tem limites e o corpo vazio nao lanca', () => {
  assert.equal(M.validarMissao({ ...VALIDA, titulo: 'ab' }).recusa, M.RECUSAS.TITULO)
  assert.equal(M.validarMissao({ ...VALIDA, titulo: 'x'.repeat(121) }).recusa, M.RECUSAS.TITULO)
  assert.doesNotThrow(() => M.validarMissao())
  assert.equal(M.validarMissao({}).ok, false)
})

test('toda recusa tem mensagem legivel — formulario nao pode dizer so "invalido"', () => {
  for (const recusa of Object.values(M.RECUSAS)) {
    assert.ok(M.MENSAGEM_RECUSA[recusa], `falta mensagem para ${recusa}`)
  }
})

// ─── A baixa da recompensa (Etapa 4) ─────────────────────────────────────────────────────

const migracaoBaixa = fonte('sql/migrations/086_missao_recompensa.sql')

test('a baixa exige dizer A QUEM o premio foi entregue', () => {
  assert.equal(M.validarBaixa({}).recusa, M.RECUSAS_BAIXA.USUARIO)
  assert.equal(M.validarBaixa({ usuario_id: '  ' }).recusa, M.RECUSAS_BAIXA.USUARIO)
  assert.doesNotThrow(() => M.validarBaixa())
})

test('valor e OPCIONAL (nem todo premio e dinheiro), mas ZERO e recusado', () => {
  // Ausente = "saiu, e não era dinheiro". Zero seria "paguei nada" com aparência de pagamento.
  assert.equal(M.validarBaixa({ usuario_id: 'u1' }).dados.valor_pago, null)
  assert.equal(M.validarBaixa({ usuario_id: 'u1', valor_pago: '' }).dados.valor_pago, null)
  assert.equal(M.validarBaixa({ usuario_id: 'u1', valor_pago: 0 }).recusa, M.RECUSAS_BAIXA.VALOR)
  assert.equal(M.validarBaixa({ usuario_id: 'u1', valor_pago: -10 }).recusa, M.RECUSAS_BAIXA.VALOR)
  assert.equal(M.validarBaixa({ usuario_id: 'u1', valor_pago: 1000 }).dados.valor_pago, 1000)
})

test('o valor pago PODE divergir do declarado — e a divergencia e o ponto', () => {
  // Arredondamento, prêmio entregue em parte, acordo específico. A missão é imutável, então o
  // declarado continua consultável para comparação.
  const r = M.validarBaixa({ usuario_id: 'u1', valor_pago: 850 })
  assert.equal(r.ok, true)
  assert.equal(r.dados.valor_pago, 850)
})

test('validarBaixa NAO recebe a conquista como parametro, de proposito', () => {
  // Aceitar "alcancou: true" do cliente deixaria qualquer requisição pagar prêmio a quem quisesse.
  // Quem confere o FATO é a camada de dados, que tem a soma na mão.
  const r = M.validarBaixa({ usuario_id: 'u1', alcancou: true, originado: 999999 })
  assert.equal(r.ok, true)
  assert.deepEqual(Object.keys(r.dados).sort(), ['observacao', 'referencia', 'usuario_id', 'valor_pago'])
})

test('juntarBaixas responde "ja recebeu?" com false, nunca null', () => {
  const juntado = M.juntarBaixas(
    [{ usuario_id: 'a', nome: 'Ana', valor: 30000 }, { usuario_id: 'b', nome: 'Bruno', valor: 25000 }],
    [{ usuario_id: 'a', valor_pago: 1000, pago_em: '2026-09-18T10:00:00Z' }]
  )
  assert.equal(juntado[0].pago, true)
  assert.equal(juntado[0].valor_pago, 1000)
  assert.equal(juntado[1].pago, false, 'quem alcancou sempre tem resposta para "ja recebi?"')
  assert.equal(juntado[1].pago_em, null)
})

test('juntarBaixas preserva a ORDEM do servidor e nao quebra com listas vazias', () => {
  assert.deepEqual(M.juntarBaixas([], []), [])
  assert.deepEqual(M.juntarBaixas(null, null), [])
  const ordem = M.juntarBaixas(
    [{ usuario_id: 'a', nome: 'Ana' }, { usuario_id: 'b', nome: 'Bruno' }], []
  ).map((x) => x.nome)
  assert.deepEqual(ordem, ['Ana', 'Bruno'])
})

test('a migration 086 e ADITIVA e nao muta dado', () => {
  assert.ok(!/UPDATE\s+app\./i.test(migracaoBaixa))
  assert.ok(!/ALTER TABLE app\.(missoes|vendas|usuarios|empresas)\b/i.test(migracaoBaixa))
})

test('UMA baixa por pessoa por missao e garantia do BANCO', () => {
  // Duplo clique, retry do navegador ou duas abas não podem pagar o mesmo prêmio duas vezes.
  assert.match(migracaoBaixa,
    /CREATE UNIQUE INDEX[\s\S]*missao_recompensas[\s\S]*\(missao_id, usuario_id\)/)
})

test('o BANCO recusa valor pago ZERO, mas aceita NULL', () => {
  assert.match(migracaoBaixa, /CHECK \(valor_pago IS NULL OR valor_pago > 0\)/)
})

test('a conquista e RECONFERIDA na transacao, nunca aceita do cliente', () => {
  const db = fonte('src/db/missao.js')
  assert.ok(db.includes('MISSAO_ALVO_NAO_ALCANCADO'), 'quem nao alcancou precisa ser recusado')
  assert.ok(/SUM\(v\.comissao_base\)[\s\S]*originador_id/.test(db),
    'a soma precisa ser lida do banco no ato da baixa')
  const rota = fonte('src/routes/api-missoes.js')
  assert.ok(!/body[\s\S]{0,60}alcancou/.test(rota), 'a conquista nao pode vir do corpo')
  assert.ok(rota.includes('DB.obterMissao'), 'o alvo tem de vir da missao real, nao do corpo')
})

test('NAO existe desfazer a baixa: append-only', () => {
  const db = fonte('src/db/missao.js')
  assert.ok(!/UPDATE app\.missao_recompensas/i.test(db))
  assert.ok(!/DELETE\s+FROM\s+app\.missao_recompensas/i.test(db))
  const rota = fonte('src/routes/api-missoes.js')
  assert.ok(!/router\.(delete|put|patch)\(/.test(rota))
})

test('a PROPRIA pessoa ve que o premio dela foi registrado', () => {
  // Programa de recompensa que o beneficiário não consegue conferir é promessa sem prova.
  const rota = fonte('src/routes/api-missoes.js')
  assert.ok(rota.includes('recompensa_paga'), 'o proprio progresso precisa dizer se ja recebeu')
  assert.ok(rota.includes('minhaRecompensa'), 'a baixa da propria pessoa e lida sempre')
  // E a leitura das baixas NÃO pode ficar atrás do gate de gestão.
  assert.ok(!/podeGerenciar\(req\)[\s\S]{0,40}recompensasDaMissao/.test(rota),
    'a pessoa precisa ver a PROPRIA baixa mesmo sem gerenciar')
})

test('a auditoria da baixa nao carrega PII', () => {
  const db = fonte('src/db/missao.js')
  const contexto = db.slice(db.indexOf('missao_recompensa_paga'))
  for (const proibido of ['email', 'telefone', 'nome']) {
    assert.ok(!new RegExp(`${proibido}`, 'i').test(contexto.slice(0, 600).replace(/\/\/.*$/gm, '')),
      `a auditoria da baixa nao pode citar '${proibido}'`)
  }
})

// ─── Anti-drift com o schema ─────────────────────────────────────────────────────────────

test('METRICA espelha a CHECK da migration 085', () => {
  const m = migration.match(/CHECK \(metrica IN \(([^)]+)\)\)/)
  assert.ok(m, 'nao achei a CHECK de metrica')
  const noSql = m[1].split(',').map((s) => s.trim().replace(/'/g, '')).sort()
  assert.deepEqual(noSql, [...M.METRICAS].sort(),
    'services/missao.js e a migration 085 divergiram sobre as metricas validas')
})

test('STATUS e MOTIVO_ENCERRAMENTO espelham as CHECKs da migration', () => {
  const s = migration.match(/CHECK \(status IN \(([^)]+)\)\)/)
  assert.deepEqual(s[1].split(',').map((x) => x.trim().replace(/'/g, '')).sort(), [...M.STATUSES].sort())
  assert.ok(migration.includes("encerrada_motivo IN ('prazo', 'decisao')"))
  assert.deepEqual(Object.values(M.MOTIVO_ENCERRAMENTO).sort(), ['decisao', 'prazo'])
})

test('a migration e ADITIVA e nao muta dado', () => {
  assert.ok(!/UPDATE\s+app\./i.test(migration))
  assert.ok(!/ALTER TABLE app\.(vendas|comissao_planos|usuarios|empresas)\b/i.test(migration))
})

test('UMA missao ativa por empresa e garantia do BANCO', () => {
  assert.match(migration, /CREATE UNIQUE INDEX[\s\S]*missoes[\s\S]*\(empresa_id\)[\s\S]*WHERE status = 'ativa'/)
})

test('o BANCO recusa encerramento sem data e sem motivo', () => {
  assert.match(migration, /status <> 'encerrada'[\s\S]*encerrada_em IS NOT NULL/)
})

test('NAO existe tabela de conquista — ela e derivada', () => {
  // Persistir a conquista criaria uma SEGUNDA definição de "resultado", que passaria a divergir
  // da primeira no dia em que uma venda fosse cancelada.
  assert.ok(!/CREATE TABLE[^;]*conquista/i.test(migration),
    'quem alcancou o alvo e derivado de app.vendas, nao uma tabela propria')
})

// ─── Guardas de regressão ────────────────────────────────────────────────────────────────

test('o modulo e PURO: sem banco, sem HTTP, sem IA, sem rede', () => {
  const src = fonte('src/services/missao.js')
  for (const proibido of ['require(', 'pool', 'fetch(', 'axios', 'anthropic', 'openai']) {
    assert.ok(!src.includes(proibido), `missao.js nao pode conter '${proibido}'`)
  }
})

test('a missao NUNCA ordena nem classifica pessoas — isso e ranking, outra etapa', () => {
  const src = fonte('src/services/missao.js').replace(/\/\/[^\n]*$/gm, '')
  for (const proibido of ['ranking', 'classificar', 'posicao', 'sort(']) {
    assert.ok(!src.toLowerCase().includes(proibido),
      `"${proibido}" transformaria o progresso pessoal em placar`)
  }
})

test('a MEDIDA e emprestada da comissao, nunca reescrita', () => {
  // Uma consulta própria de "resultado" criaria uma segunda definição da mesma coisa — e no dia
  // em que uma venda fosse cancelada os dois painéis passariam a discordar.
  const src = fonte('src/db/missao.js')
  assert.ok(src.includes("require('../services/comissao')"), 'o status da venda vem do dono do vocabulario')
  assert.ok(src.includes('VENDA_STATUS'), 'nao se escreve o literal do status aqui')
  assert.ok(!src.includes("'comissao_liberada'"), 'literal de status nao pode aparecer nesta camada')
  assert.ok(src.includes('comissao_base'), 'a soma e a mesma base que a comissao credita')
})

test('a missao publicada e IMUTAVEL: nada edita alvo, recompensa ou janela', () => {
  const src = fonte('src/db/missao.js')
  const updates = src.split('\n').filter((l) => /UPDATE app\.missoes/i.test(l))
  assert.ok(updates.length > 0, 'deve existir o UPDATE de encerramento')
  for (const proibido of ['SET titulo', 'SET alvo_valor', 'SET recompensa', 'SET inicio', 'SET fim', 'SET metrica']) {
    assert.ok(!src.includes(proibido), `${proibido} quebraria a imutabilidade da missao publicada`)
  }
  assert.ok(!/DELETE\s+FROM\s+app\.missoes/i.test(src), 'missao nao se apaga: encerra e vira historico')
})

test('NAO existe rota que devolva o progresso PARCIAL de outra pessoa', () => {
  // Nem para o dono. O que ele recebe é quem JÁ ALCANÇOU — fato consumado, sem o qual não há
  // como pagar a recompensa.
  const rota = fonte('src/routes/api-missoes.js')
  assert.ok(rota.includes('alcancaramOAlvo'), 'o dono precisa ver quem alcancou para poder pagar')
  assert.ok(!/progressoDaPessoa\([^)]*req\.query/.test(rota),
    'o progresso e sempre do usuario da sessao, nunca de um id vindo da URL')
  assert.ok(rota.includes('req.usuario.id'), 'o progresso sai da sessao')

  const db = fonte('src/db/missao.js')
  assert.ok(/HAVING SUM\(v\.comissao_base\) >= /.test(db),
    'a lista do dono e filtrada por quem bateu o alvo, nao um extrato de todo mundo')
  assert.ok(/ORDER BY u\.nome ASC/.test(db),
    'ordenar por VALOR seria ranking; a ordem e alfabetica de proposito')
})

test('as ESCRITAS exigem COMISSAO_GERENCIAR; o mount libera so a LEITURA', () => {
  const rota = fonte('src/routes/api-missoes.js')
  assert.ok(/router\.use\(requireAuth, requireEmpresaAccess, requireCapacidade\(CAP\.COMISSAO_VER_PROPRIA\)\)/.test(rota))
  const escritas = rota.split('\n').filter((l) => /router\.post\(/.test(l))
  assert.equal(escritas.length, 3, 'publicar, encerrar e dar baixa na recompensa — nem mais, nem menos')
  for (const l of escritas) {
    assert.ok(l.includes('CAP.COMISSAO_GERENCIAR'), `escrita sem gate proprio: ${l.trim().slice(0, 80)}`)
  }
  assert.ok(!/router\.(put|patch|delete)\(/.test(rota),
    'missao publicada nao se edita e nao se apaga')
})

test('nenhuma capacidade nova foi criada para a missao', () => {
  // Missão com recompensa é política de REMUNERAÇÃO, a mesma família da comissão. Capacidade
  // nova sem decisão distinta por trás é coluna de matriz que ninguém valida.
  const caps = fonte('src/services/acesso-capacidades.js')
  // Fronteira de palavra: sem ela, `COMISSAO_VER_PROPRIA` casaria com "MISSAO_" e a guarda
  // acusaria justamente a capacidade que a missão REUSA.
  assert.ok(!/\bMISSAO_|\bmissao_/.test(caps), 'a missao reusa COMISSAO_VER_PROPRIA/COMISSAO_GERENCIAR')
})

test('o mount da missao existe no index.js', () => {
  assert.ok(fonte('index.js').includes("app.use('/api/empresas/:empresaId/missoes', require('./src/routes/api-missoes'))"))
})
