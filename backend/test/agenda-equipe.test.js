'use strict'
// Agenda em equipe + backfill de `empresa_id` em vendas.* (CRM em equipe, Etapa 11).
// O comportamento do conflito por pessoa é testado em test/agenda-multiempresa.test.js (com o
// pool falso). Aqui ficam a migration, a rota e as guardas do backfill.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const RAIZ = path.join(__dirname, '..')
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8')
const semComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ')
const semSqlComment = (src) => src.replace(/^\s*--[^\n]*$/gm, ' ')

const mig076 = fonte(path.join('sql', 'migrations', '076_agenda_equipe.sql'))
const mig077 = fonte(path.join('sql', 'migrations', '077_vendas_empresa_id.sql'))
const rotaAgenda = fonte(path.join('src', 'routes', 'api-agenda.js'))
const servicoAgenda = fonte(path.join('src', 'services', 'agenda-multiempresa.js'))
const backfill = fonte(path.join('scripts', 'backfill-vendas-empresa.js'))

const B = require('../scripts/backfill-vendas-empresa')

// ─── Migration 076 ───────────────────────────────────────────────────────────────────────

test('a 076 e ADITIVA e NAO faz backfill de responsavel', () => {
  const sql = semSqlComment(mig076)
  assert.ok(!/\bUPDATE\s+app\.agenda_eventos/i.test(sql),
    'nao pode preencher responsavel_id retroativamente: quem criou nao e necessariamente quem conduz')
  assert.ok(/responsavel_id UUID REFERENCES app\.usuarios\(id\) ON DELETE SET NULL/.test(sql))
  assert.ok(/prospect_id\s+UUID REFERENCES prospectador\.prospects\(id\) ON DELETE SET NULL/.test(sql))
})

test('responsavel_id e criado_por sao campos DISTINTOS', () => {
  // Quem marca e quem conduz podem ser pessoas diferentes — com equipe, isso deixa de ser excecao.
  assert.ok(/criado_por/.test(fonte(path.join('sql', 'migrations', '011_agenda_multiempresa.sql'))),
    'criado_por nasceu na 011 e precisa continuar existindo')
  assert.ok(!/DROP COLUMN[\s\S]{0,40}criado_por/i.test(mig076))
})

// ─── Migration 077 ───────────────────────────────────────────────────────────────────────

test('a 077 cria coluna e indice, e NAO muta dado', () => {
  const sql = semSqlComment(mig077)
  assert.ok(!/\bUPDATE\s+vendas\./i.test(sql), 'o preenchimento e um SCRIPT separado, nao a migration')
  assert.ok(/ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES app\.empresas\(id\)/.test(sql))
})

test('a 077 NAO repete o DEFAULT = PJ das migrations 005/006', () => {
  // Aquele DEFAULT fez "todo lead de toda empresa nascer marcado como PJ" (AGENTS.md), e a
  // migration 058 teve de desfazer. Repetir seria repetir um defeito ja pago.
  const sql = semSqlComment(mig077)
  assert.ok(!/SET DEFAULT/i.test(sql), 'nenhum DEFAULT')
  assert.ok(!/00000000-0000-0000-0000-000000000001/.test(sql), 'nenhum uuid de empresa embutido')
  assert.ok(!/SET NOT NULL/i.test(sql), 'NOT NULL retroativo derrubaria o boot')
})

test('a 077 cobre as 5 tabelas que a operacao alcanca', () => {
  for (const t of ['agenda_eventos', 'eventos_comerciais', 'followup_auto_agendamentos', 'lead_contextos', 'agenda_lembretes']) {
    assert.ok(mig077.includes(`'${t}'`), `a 077 precisa cobrir vendas.${t}`)
  }
  // E NAO pode tocar as internas do motor (job_queue, locks, dedup de webhook): nao sao
  // alcancaveis por usuario e escopa-las seria trabalho sem ganho.
  for (const t of ['job_queue', 'watcher_locks', 'webhook_messages_processed']) {
    assert.ok(!mig077.includes(`'${t}'`), `vendas.${t} esta fora de escopo de proposito`)
  }
})

// ─── A rota ──────────────────────────────────────────────────────────────────────────────

test('a agenda CONSOLIDADA exige AGENDA_VER_EQUIPE; os demais veem a propria', () => {
  const i = rotaAgenda.indexOf("router.get('/', requireAuth")
  const bloco = rotaAgenda.slice(i, i + 2000)
  assert.ok(bloco.includes('AGENDA_VER_EQUIPE'), 'o recorte precisa vir da capacidade')
  // Trocar um parametro de query nao pode virar acesso a agenda alheia.
  assert.ok(/podeVerEquipe\s*\n?\s*\?\s*\(req\.query\.responsavel_id \|\| null\)\s*\n?\s*:\s*\(req\.usuario\?\.id \|\| null\)/.test(bloco.replace(/\s+/g, ' ').replace(/ /g, ' ')) ||
    /podeVerEquipe[\s\S]{0,120}req\.query\.responsavel_id[\s\S]{0,120}req\.usuario/.test(bloco),
    '`?responsavel_id=` so pode ser respeitado por quem ve a equipe')
  assert.ok(bloco.includes('pode_ver_equipe'), 'o recorte efetivo precisa voltar no meta')
})

test('marcar PARA outra pessoa exige ver a agenda da equipe', () => {
  // Senao alguem marcaria compromisso na agenda de um colega que nem consegue enxergar.
  const i = rotaAgenda.indexOf("router.post('/', requireAuth")
  const bloco = rotaAgenda.slice(i, i + 1800)
  assert.ok(bloco.includes('podeMarcarParaOutro'))
  assert.ok(/status\(403\)/.test(bloco), 'a recusa precisa ser 403 explicito')
  // Mas marcar para SI proprio continua livre.
  assert.ok(/String\(corpo\.responsavel_id\) !== String\(req\.usuario\?\.id\)/.test(bloco),
    'marcar para si mesmo nao pode exigir capacidade de gestao')
})

// ─── O serviço ───────────────────────────────────────────────────────────────────────────

test('sem responsavel informado, o conflito continua sendo o de ANTES (empresa inteira)', () => {
  // Nenhum chamador que nao informe responsavel pode mudar de comportamento.
  const i = servicoAgenda.indexOf('async function existeConflito')
  const bloco = servicoAgenda.slice(i, i + 1600)
  assert.ok(/if \(responsavelId\)/.test(bloco), 'o escopo por pessoa precisa ser condicional')
  assert.ok(/responsavel_id = \$\$\{params\.length\}::uuid OR responsavel_id IS NULL/.test(bloco),
    'com responsavel, o evento SEM dono (bloqueio da empresa) precisa continuar conflitando')
})

test('o servico de agenda nao conhece papel nem capacidade', () => {
  // O veredito chega pronto da rota.
  const src = semComentarios(servicoAgenda)
  for (const proibido of ['acesso-capacidades', 'podeCapacidade', 'papelEmpresa']) {
    assert.ok(!src.includes(proibido), `agenda-multiempresa.js nao pode conhecer '${proibido}'`)
  }
})

test('a agenda do BOT (vendas.agenda_eventos) NAO foi alterada', () => {
  // Unificar as duas agendas e' projeto proprio e continua fora de escopo. O buffer do bot
  // (REUNIAO_BUFFER_MIN em src/agenda.js) segue exatamente como estava.
  const agendaBot = fonte(path.join('src', 'agenda.js'))
  assert.ok(agendaBot.includes('REUNIAO_BUFFER_MINUTOS'), 'o buffer do bot precisa continuar existindo')
  assert.ok(!semComentarios(agendaBot).includes('acesso-capacidades'),
    'a agenda do bot nao pode passar a conhecer capacidade')
  assert.ok(!semComentarios(agendaBot).includes('app.agenda_eventos'),
    'a agenda do bot nao pode passar a ler a agenda do painel — sao dois modelos, e unifica-los e outro projeto')
})

// ─── O backfill ──────────────────────────────────────────────────────────────────────────

test('GUARDA: o backfill SIMULA por padrao', () => {
  assert.ok(/const aplicar = argv\.includes\('--aplicar'\)/.test(backfill))
  const i = backfill.indexOf('async function processarTabela')
  const bloco = backfill.slice(i, i + 2600)
  assert.ok(/if \(!aplicar \|\| out\.resolvidas === 0\) return out/.test(bloco),
    'sem --aplicar, nenhum UPDATE pode acontecer')
})

test('GUARDA: o backfill NAO inventa dono', () => {
  // Linha sem dono resolvivel fica NULA. E' a licao das migrations 005/006, corrigidas pela 058.
  const sql = semComentarios(backfill)
  assert.ok(!/00000000-0000-0000-0000-000000000001/.test(sql), 'nenhum uuid de empresa embutido')
  assert.ok(!/COALESCE\([^)]*,\s*'[0-9a-f-]{36}'/.test(sql), 'nenhum fallback para uma empresa fixa')
  // O UNICO UPDATE do script precisa exigir que a origem tenha resolvido. Extrair "o bloco do
  // UPDATE" por regex e' ingenuo (a propria expressao de origem tem parenteses), entao a guarda
  // olha o corpo inteiro de processarTabela, que e' onde ele vive.
  const i = backfill.indexOf('async function processarTabela')
  const corpo = semComentarios(backfill.slice(i, backfill.indexOf('function imprimir')))
  assert.ok(/UPDATE vendas\./.test(corpo), 'o UPDATE desapareceu')
  assert.ok(/WHERE t\.empresa_id IS NULL AND [\s\S]{0,200}IS NOT NULL/.test(corpo),
    'o UPDATE precisa exigir dono resolvido')
})

test('GUARDA: o backfill e idempotente e grava em LOTES', () => {
  const sql = semComentarios(backfill)
  assert.ok(/empresa_id IS NULL/.test(sql), 'so toca linhas sem dono: rodar de novo nao muda nada')
  assert.ok(/LIMIT \$1/.test(sql), 'precisa gravar em lotes')
  assert.ok(!/BEGIN[\s\S]{0,2000}COMMIT/.test(sql),
    'nao pode envolver tudo numa transacao unica — travaria a tabela em producao')
})

test('GUARDA: o backfill nunca escolhe banco sozinho e nao fala com o mundo', () => {
  assert.ok(backfill.includes('process.env.DATABASE_URL'))
  const sql = semComentarios(backfill)
  assert.ok(!/postgres(ql)?:\/\//.test(sql), 'nenhuma URL embutida')
  for (const proibido of ['axios', 'fetch(', 'enviarMensagem', 'generateAIResponse']) {
    assert.ok(!sql.includes(proibido), `o backfill nao pode conter '${proibido}'`)
  }
  const requires = [...sql.matchAll(/require\(['"]([^'".][^'"]*)['"]\)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(requires)], ['pg'], 'nenhuma dependencia nova')
})

test('as 5 tabelas do backfill batem com as da migration 077', () => {
  const nomes = B.TABELAS.map((t) => t.nome).sort()
  assert.deepEqual(nomes, ['agenda_eventos', 'agenda_lembretes', 'eventos_comerciais', 'followup_auto_agendamentos', 'lead_contextos'])
  for (const n of nomes) assert.ok(mig077.includes(`'${n}'`), `${n} precisa estar na 077`)
})

test('cada tabela resolve o dono a partir de uma linha que JA tem dono provado', () => {
  for (const t of B.TABELAS) {
    assert.ok(/vendas\.(conversas|lead_profiles|agenda_eventos)/.test(t.origem),
      `${t.nome}: a origem precisa ser conversa, lead_profile ou o evento pai — nunca heuristica`)
    assert.ok(!/telefone|LIKE|regexp/i.test(t.origem),
      `${t.nome}: casar por telefone solto seria adivinhar o dono`)
  }
})

test('montarAchados diz a verdade sobre orfas e sobre a simulacao', () => {
  const r = [{ nome: 'agenda_eventos', candidatas: 100, resolvidas: 80, lotes: 0, erro: null }]
  const simulou = B.montarAchados(r, false).join(' | ')
  assert.match(simulou, /SIMULACAO/)
  assert.match(simulou, /20 orfa/)
  assert.match(simulou, /inventar dono/)

  const aplicou = B.montarAchados([{ nome: 'x', candidatas: 10, resolvidas: 10, lotes: 1, erro: null }], true).join(' | ')
  assert.ok(!/SIMULACAO/.test(aplicou))
  // A linha-resumo sempre informa a contagem (inclusive "0 orfa(s)") — isso e' informacao util.
  // O que NAO deve aparecer sem orfas e' a EXPLICACAO sobre deixar linha nula.
  assert.match(aplicou, /0 orfa/)
  assert.ok(!/inventar dono/.test(aplicou), 'sem orfas, a explicacao sobre linha nula e ruido')
})

test('montarAchados denuncia falha por tabela', () => {
  const r = [{ nome: 'lead_contextos', candidatas: 0, resolvidas: 0, lotes: 0, erro: 'coluna empresa_id ausente' }]
  assert.match(B.montarAchados(r, true).join(' | '), /FALHOU em vendas\.lead_contextos/)
})

test('mascarar nao vaza uuid inteiro', () => {
  assert.equal(B.mascarar('00000000-0000-0000-0000-000000000001'), '00000000…')
  assert.equal(B.mascarar(null), '(sem empresa)')
})

// ─── A lista de responsáveis da agenda (Etapa 11, frontend) ──────────────────────────────

test('GET /agenda/responsaveis exige AGENDA_VER_EQUIPE, na ordem certa, e vem ANTES de /:id', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'api-agenda.js'), 'utf8')
  const linha = src.split('\n').find((l) => l.includes("router.get('/responsaveis'"))
  assert.ok(linha, 'a rota de responsaveis da agenda sumiu')
  assert.ok(linha.includes('requireCapacidade(CAP.AGENDA_VER_EQUIPE)'),
    'quem nao ve a agenda da equipe nao pode listar os colegas: o seletor prometeria uma marcacao que o POST recusa')
  // requireCapacidade DEPENDE de requireEmpresaAccess: antes dele, e' 500 e a rota cai para todos.
  const iEmpresa = linha.indexOf('requireEmpresaAccess')
  const iCap = linha.indexOf('requireCapacidade')
  assert.ok(iEmpresa > 0 && iEmpresa < iCap, 'requireEmpresaAccess precisa vir ANTES de requireCapacidade')
  // Depois de `/:id`, "responsaveis" seria lido como um id de evento e a rota nunca responderia.
  assert.ok(src.indexOf("router.get('/responsaveis'") < src.indexOf("router.get('/:id'"),
    'a rota de responsaveis precisa ser declarada antes de /:id')
})

test('a lista de responsaveis da agenda REUSA a de follow-ups — nao ha SQL novo', () => {
  // Duas consultas divergentes fariam o mesmo vendedor aparecer num seletor e sumir do outro.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'api-agenda.js'), 'utf8')
  assert.ok(/require\('\.\.\/db\/follow-ups'\)/.test(src), 'a rota deve reusar listarResponsaveis')
  assert.ok(!/SELECT[\s\S]{0,200}app\.usuarios_empresas/i.test(src),
    'api-agenda.js nao pode ter consulta propria de membros')
})
