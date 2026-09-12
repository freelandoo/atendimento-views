'use strict'
// A PORTA da operação comercial (CRM em equipe, Etapa 3). Regra PURA + guardas de regressão que
// leem o fonte das quatro portas e dos dois coletores.
//
// As guardas aqui são o coração da etapa: a regra é fácil de escrever e fácil de ser contornada
// meses depois por um `WHERE` novo que esquece a condição. Foi assim que
// `!!(lead.site || lead.tem_site)` se espalhou por 7 pontos antes da migration 056.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const Q = require('../src/services/lead-qualificacao')
const { QUALIFICACAO: QL, MOTIVOS } = Q

const RAIZ = path.join(__dirname, '..')
const SRC = path.join(RAIZ, 'src')
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8')
const semComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

function todosOsFontes(dir = SRC, saida = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) todosOsFontes(p, saida)
    else if (e.name.endsWith('.js')) saida.push(p)
  }
  return saida
}

// ─── Vocabulário ─────────────────────────────────────────────────────────────────────────

test('os 4 valores existem e batem com a CHECK da migration 071', () => {
  assert.deepEqual([...Q.VALORES].sort(), ['aprovado', 'descartado', 'legado', 'pendente'])
  const mig = fonte(path.join('sql', 'migrations', '071_lead_qualificacao.sql'))
  const m = mig.match(/prospects_qualificacao_chk[\s\S]*?IN \(([^)]*)\)/)
  assert.ok(m, 'nao achei a CHECK na migration 071')
  const doSql = m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean)
  assert.deepEqual([...Q.VALORES].sort(), doSql.sort())
})

test('so aprovado e legado passam pela porta', () => {
  assert.deepEqual([...Q.ABORDAVEIS].sort(), ['aprovado', 'legado'])
})

// ─── A pergunta central ──────────────────────────────────────────────────────────────────

test('aprovado e legado podem ser abordados; o motivo distingue os dois', () => {
  assert.equal(Q.avaliarAbordagem({ qualificacao: QL.APROVADO }).motivo, MOTIVOS.APROVADO)
  assert.equal(Q.avaliarAbordagem({ qualificacao: QL.LEGADO }).motivo, MOTIVOS.LEGADO)
  assert.ok(Q.podeAbordar({ qualificacao: QL.APROVADO }))
  assert.ok(Q.podeAbordar({ qualificacao: QL.LEGADO }))
  // Aceita a string direta, por conveniencia dos chamadores.
  assert.ok(Q.podeAbordar(QL.APROVADO))
})

test('pendente e descartado NAO podem, com motivos DIFERENTES', () => {
  // As duas recusas pedem acoes opostas: uma pede triagem, a outra e' definitiva. Um `false`
  // sozinho mandaria o operador procurar no lugar errado.
  const pend = Q.avaliarAbordagem({ qualificacao: QL.PENDENTE })
  assert.equal(pend.permitido, false)
  assert.equal(pend.motivo, MOTIVOS.NAO_TRIADO)

  const desc = Q.avaliarAbordagem({ qualificacao: QL.DESCARTADO })
  assert.equal(desc.permitido, false)
  assert.equal(desc.motivo, MOTIVOS.DESCARTADO)
  assert.notEqual(pend.motivo, desc.motivo)
})

test('coluna AUSENTE nega — a porta nunca se abre por omissao', () => {
  // Um SELECT que esqueceu `qualificacao` entrega `undefined`. Se isso virasse "pode abordar", o
  // defeito voltaria pela mesma via que nasceu: por omissao.
  assert.equal(Q.avaliarAbordagem({}).motivo, MOTIVOS.QUALIFICACAO_DESCONHECIDA)
  assert.equal(Q.avaliarAbordagem({ qualificacao: undefined }).permitido, false)
  assert.equal(Q.avaliarAbordagem({ qualificacao: null }).permitido, false)
  assert.equal(Q.avaliarAbordagem({ qualificacao: 'valor_novo' }).permitido, false)
  assert.equal(Q.avaliarAbordagem(null).motivo, MOTIVOS.SEM_LEAD)
  assert.equal(Q.avaliarAbordagem(undefined).permitido, false)
})

test('status NAO influencia a porta — sao eixos independentes', () => {
  // `status = 'enviado'` sobrescreve `aprovado` naquele eixo. Se a porta olhasse `status`, o lead
  // ja contatado sairia da operacao — justamente quem mais precisa de follow-up.
  assert.ok(Q.podeAbordar({ qualificacao: QL.APROVADO, status: 'enviado' }))
  assert.ok(Q.podeAbordar({ qualificacao: QL.LEGADO, status: 'rejeitado' }))
  assert.ok(!Q.podeAbordar({ qualificacao: QL.DESCARTADO, status: 'aprovado' }))
})

// ─── Tradução dos três vocabulários ──────────────────────────────────────────────────────

test('qualificacaoDaDecisao costura os tres vocabularios do mesmo ato', () => {
  assert.equal(Q.qualificacaoDaDecisao('aprovado'), QL.APROVADO)
  // A curadoria diz 'descartado'; `status` diz 'rejeitado'. Os dois viram `descartado` aqui.
  assert.equal(Q.qualificacaoDaDecisao('descartado'), QL.DESCARTADO)
  assert.equal(Q.qualificacaoDaDecisao('rejeitado'), QL.DESCARTADO)
  // Valor que nao e' decisao humana nao vira qualificacao nenhuma (null = "nao mexa na coluna").
  for (const v of ['enviado', 'respondeu', 'fechado', 'coletado', 'aguardando', '', null, undefined]) {
    assert.equal(Q.qualificacaoDaDecisao(v), null, `${v} nao deveria virar qualificacao`)
  }
})

test('recoleta NUNCA rebaixa: qualificacaoAoRecoletar preserva o que existe', () => {
  // E' a regra que impede "lead descartado volta por nova importacao" (R9).
  for (const v of Q.VALORES) assert.equal(Q.qualificacaoAoRecoletar(v), v)
  // Linha sem valor (impossivel pelo NOT NULL, mas defensivo) cai em pendente, nunca em abordavel.
  assert.equal(Q.qualificacaoAoRecoletar(null), QL.PENDENTE)
  assert.equal(Q.qualificacaoAoRecoletar('lixo'), QL.PENDENTE)
})

test('lead novo nasce pendente, NUNCA legado', () => {
  // `legado` e' a carencia do ACERVO. Um lead nunca visto nascendo `legado` entraria na operacao
  // sem triagem — o defeito inteiro, de volta.
  assert.equal(Q.qualificacaoInicial(), QL.PENDENTE)
  assert.notEqual(Q.qualificacaoInicial(), QL.LEGADO)
})

test('rotuloMotivo da texto ao que foi barrado, e nada ao que passou', () => {
  assert.match(Q.rotuloMotivo(MOTIVOS.NAO_TRIADO), /triad/)
  assert.match(Q.rotuloMotivo(MOTIVOS.DESCARTADO), /descartad/)
  assert.equal(Q.rotuloMotivo(MOTIVOS.APROVADO), '')
  assert.equal(Q.rotuloMotivo('inventado'), '')
})

// ─── Fragmentos SQL ──────────────────────────────────────────────────────────────────────

test('sqlAbordavel e sqlNaoDescartado sao coerentes com a regra JS', () => {
  assert.equal(Q.sqlAbordavel('p'), "p.qualificacao IN ('aprovado', 'legado')")
  assert.equal(Q.sqlAbordavel(''), "qualificacao IN ('aprovado', 'legado')")
  assert.equal(Q.sqlNaoDescartado('p'), "p.qualificacao <> 'descartado'")
  // O SQL abordavel tem de listar EXATAMENTE os valores de ABORDAVEIS — divergir faria o banco e
  // o JS discordarem sobre o mesmo lead.
  for (const v of Q.ABORDAVEIS) assert.ok(Q.sqlAbordavel('p').includes(`'${v}'`), v)
  for (const v of [QL.PENDENTE, QL.DESCARTADO]) assert.ok(!Q.sqlAbordavel('p').includes(`'${v}'`), v)
})

test('sqlNaoDescartado e MAIS FROUXO que sqlAbordavel, de proposito', () => {
  // A 2a barreira deixa passar `pendente`. Se fosse igual a porta, a fila da Central de Ligacoes
  // perderia 1.031 leads de uma vez (medicao de 2026-09-11).
  assert.ok(Q.sqlNaoDescartado('p').length < Q.sqlAbordavel('p').length)
  assert.ok(!Q.sqlNaoDescartado('p').includes('pendente'))
})

// ─── Pureza ──────────────────────────────────────────────────────────────────────────────

test('o modulo e PURO: sem banco, sem HTTP, sem IA, sem env', () => {
  const src = fonte(path.join('src', 'services', 'lead-qualificacao.js'))
  for (const proibido of ['require(', 'pool', 'fetch(', 'axios', 'process.env']) {
    assert.ok(!src.includes(proibido), `lead-qualificacao.js nao pode conter '${proibido}'`)
  }
})

// ─── GUARDAS: as quatro portas estão fechadas ────────────────────────────────────────────

test('GUARDA: a Central de Ligacoes usa a porta ESTRITA, na entrada E na fila', () => {
  // Decisao do operador em 2026-09-12: "somente apos a aprovacao o lead pode aparecer na fila".
  // `legado` deixou de bastar AQUI (e so' aqui — os disparos de WhatsApp/e-mail continuam em
  // `sqlAbordavel`). As DUAS pontas usam a mesma condicao de proposito: entrada mais frouxa que a
  // fila deixaria o lead dentro da campanha sem nunca poder ser chamado.
  const src = fonte(path.join('src', 'db', 'campanhas.js'))
  assert.ok(src.includes("require('../services/lead-qualificacao')"), 'campanhas.js perdeu o import')
  const bloco = src.slice(src.indexOf('async function adicionarLeads'), src.indexOf('async function listarLeadsDaCampanha'))
  assert.ok(bloco.includes('sqlAprovado'), 'adicionarLeads perdeu a porta — qualquer lead entraria na campanha')
  assert.ok(!bloco.includes('sqlAbordavel'), 'a entrada da campanha voltou a aceitar lead legado sem triagem')
  // Do inicio de filaDeTrabalho ate a PROXIMA declaracao de funcao — ancorar num vizinho pelo
  // nome faria a guarda medir o codigo errado assim que alguem inserisse algo entre as duas.
  const iFila = src.indexOf('async function filaDeTrabalho')
  const fila = src.slice(iFila, src.indexOf(String.fromCharCode(10) + 'async function ', iFila + 1))
  assert.ok(fila.includes('sqlAprovado'), 'filaDeTrabalho perdeu a porta — lead nao triado voltaria a discagem')
  assert.ok(!fila.includes('sqlNaoDescartado'), 'a fila voltou a 2a barreira frouxa')
})

test('sqlAprovado e mais estrito que sqlAbordavel, e nao toca os disparos', () => {
  assert.match(Q.sqlAprovado('p'), /p\.qualificacao = 'aprovado'/)
  assert.ok(!Q.sqlAprovado('p').includes('legado'), 'legado nao passa pela porta estrita')
  // A porta dos DISPAROS nao mudou: mexer nela pararia a operacao inteira.
  assert.match(Q.sqlAbordavel('p'), /'aprovado', 'legado'/)
})

test('GUARDA: os TRES pontos de disparo de WhatsApp exigem a porta', () => {
  const src = fonte(path.join('src', 'services', 'rodar-leads.js'))
  assert.ok(src.includes("require('../services/lead-qualificacao')"))
  // 1) envio manual/lote e 2) reavaliacao no disparo dos gerados: avaliarAbordagem em 2 lugares.
  const chamadas = (src.match(/avaliarAbordagem\(/g) || []).length
  assert.ok(chamadas >= 2, `esperava >= 2 chamadas de avaliarAbordagem em rodar-leads.js, achei ${chamadas}`)
  // 3) o SQL de candidatos do Semi.
  assert.ok(src.includes('sqlAbordavel'), 'a busca de candidatos do Semi perdeu a porta')
  // A coluna precisa vir no SELECT, senao avaliarAbordagem recebe undefined e nega TUDO (a
  // operacao pararia — falha segura, mas quebrada).
  assert.ok(/COLS_PROSPECT = `[^`]*qualificacao/.test(src), 'COLS_PROSPECT precisa trazer qualificacao')
  assert.ok(/p\.status, p\.qualificacao/.test(src), 'o SELECT de dispararGerados precisa trazer qualificacao')
})

test('GUARDA: o worker AUTOMATICO exige a porta', () => {
  // E' o unico caminho que aborda sem nenhum humano no circuito.
  const src = fonte(path.join('src', 'services', 'banco-leads-auto.js'))
  assert.ok(src.includes("require('./lead-qualificacao')"), 'banco-leads-auto.js perdeu o import')
  assert.ok(src.includes('sqlAbordavel'), 'o worker automatico perdeu a porta')
})

test('GUARDA: o E-MAIL exige a porta', () => {
  const src = fonte(path.join('src', 'services', 'email-outreach.js'))
  assert.ok(src.includes('avaliarAbordagem'), 'email-outreach perdeu a porta')
  assert.ok(src.includes('LEAD_NAO_QUALIFICADO'))
  // A coluna tem de vir no SELECT do prospect.
  assert.ok(/SELECT id, email, qualificacao FROM prospectador\.prospects/.test(src))
})

// ─── GUARDAS: coletores e recoleta ───────────────────────────────────────────────────────

test('GUARDA: os DOIS coletores informam qualificacao EXPLICITAMENTE', () => {
  // O DEFAULT 'legado' do schema existe para a carencia do acervo. Um coletor que o herde por
  // esquecimento faria um lead nunca visto entrar na operacao sem triagem.
  for (const rel of [path.join('src', 'prospecting.js'), path.join('src', 'services', 'social-capture.js')]) {
    const src = fonte(rel)
    assert.ok(src.includes('qualificacaoInicial()'), `${rel} precisa chamar qualificacaoInicial()`)
    assert.ok(/INSERT INTO prospectador\.prospects[\s\S]{0,600}qualificacao/.test(src),
      `${rel}: a coluna qualificacao precisa estar na lista do INSERT`)
  }
})

test('GUARDA: nenhum ON CONFLICT rebaixa a qualificacao', () => {
  // Recoleta nao decide de novo o que uma pessoa decidiu.
  for (const rel of [path.join('src', 'prospecting.js'), path.join('src', 'services', 'social-capture.js')]) {
    const src = semComentarios(fonte(rel))
    for (const m of src.matchAll(/ON CONFLICT[\s\S]*?DO UPDATE([\s\S]*?)(?:RETURNING|`)/g)) {
      assert.ok(!/\bqualificacao\s*=/.test(m[1]),
        `${rel}: um DO UPDATE esta escrevendo qualificacao — recoleta nunca rebaixa decisao humana`)
    }
  }
})

// ─── GUARDAS: auto-aprovação e literais ──────────────────────────────────────────────────

test('GUARDA: processarFluxoCompleto NAO aprova lead sozinho', () => {
  const src = fonte(path.join('src', 'prospecting.js'))
  const i = src.indexOf('async function processarFluxoCompleto')
  assert.ok(i > 0)
  // Sem comentario: o proprio trecho DOCUMENTA a chamada removida, citando-a literalmente. Sem
  // tirar comentario, a guarda acusaria a documentacao dela mesma.
  const bloco = semComentarios(src.slice(i, i + 2500))
  assert.ok(!/atualizarStatusProspectsLote\([^)]*'aprovado'/.test(bloco),
    'a auto-aprovacao voltou: gerar diagnostico por IA nao pode virar aprovacao comercial')
  assert.ok(bloco.includes('sqlAbordavel'), 'o fluxo deve FILTRAR quem ja passou pela triagem')
})

test('GUARDA: ninguem em src/** compara qualificacao com literal fora do modulo dono', () => {
  const permitidos = new Set([
    path.join(SRC, 'services', 'lead-qualificacao.js'),
  ])
  const padroes = [
    /qualificacao\s*===?\s*['"]/,
    /['"](pendente|descartado)['"]\s*===?\s*[a-z]*\.?qualificacao/,
    /qualificacao\s*!==?\s*['"]/,
  ]
  const ofensores = []
  for (const arquivo of todosOsFontes()) {
    if (permitidos.has(arquivo)) continue
    const src = semComentarios(fs.readFileSync(arquivo, 'utf8'))
    if (padroes.some((p) => p.test(src))) ofensores.push(path.relative(SRC, arquivo))
  }
  assert.deepEqual(ofensores, [],
    'use podeAbordar()/QUALIFICACAO/sqlAbordavel de services/lead-qualificacao.js')
})

test('GUARDA: a decisao humana grava os DOIS eixos, e quem decidiu', () => {
  const prospecting = fonte(path.join('src', 'prospecting.js'))
  assert.ok(prospecting.includes('qualificado_por'), 'a rota de triagem deve registrar quem decidiu')
  const curadoria = fonte(path.join('src', 'db', 'aquisicao-curadoria.js'))
  assert.ok(curadoria.includes('qualificacaoDaDecisao'), 'a curadoria deve gravar o eixo de qualificacao')
  assert.ok(/SET status = \$3, qualificacao = \$4/.test(curadoria),
    'curadoria: os dois eixos precisam ir na MESMA instrucao (senao ha janela incoerente)')
})

test('GUARDA: a migration 071 e ADITIVA e nao muta dado', () => {
  const mig = fonte(path.join('sql', 'migrations', '071_lead_qualificacao.sql'))
  const sql = mig.replace(/^--.*$/gm, ' ')
  assert.ok(!/\bUPDATE\s+prospectador/i.test(sql), 'a 071 nao pode mutar dado existente')
  assert.ok(!/\bDROP\s+COLUMN\b/i.test(sql))
  assert.ok(/DEFAULT 'legado'/.test(sql), 'o DEFAULT de carencia e o que impede a operacao de parar no deploy')
  // `status` nao pode ser tocado: e' outro eixo, com outros consumidores.
  assert.ok(!/prospects_status_chk/.test(sql), 'a 071 nao pode mexer na CHECK de status')
})
