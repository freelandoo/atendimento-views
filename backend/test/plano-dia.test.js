const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const PD = require('../src/services/plano-dia')

const raiz = path.join(__dirname, '..')
const mig = fs.readFileSync(path.join(raiz, 'sql', 'migrations', '095_plano_dia.sql'), 'utf8')
const fonteDb = fs.readFileSync(path.join(raiz, 'src', 'db', 'plano-dia.js'), 'utf8')
const fonteSvc = fs.readFileSync(path.join(raiz, 'src', 'services', 'plano-dia.js'), 'utf8')
const fonteRota = fs.readFileSync(path.join(raiz, 'src', 'routes', 'api-banco-leads.js'), 'utf8')

// As guardas abaixo inspecionam o CODIGO, com os comentarios removidos: o cabecalho destes
// arquivos CITA o que eles nao fazem ("nao escreve em vendas.conversas"), e uma varredura
// ingenua acusaria a propria promessa como violacao.
const semComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const codigoDb = semComentarios(fonteDb)
const codigoSvc = semComentarios(fonteSvc)

function checkIn(sql, constraint) {
  const m = sql.match(new RegExp(constraint + '[\\s\\S]*?\\bIN\\s*\\(([^)]*)\\)'))
  if (!m) return null
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
}

// ── ANTI-DRIFT com as CHECKs da migration 095 ────────────────────────────────
test('ETAPAS bate com plano_dia_etapa_chk', () => {
  assert.deepEqual([...PD.ETAPAS].sort(), (checkIn(mig, 'plano_dia_etapa_chk') || []).sort())
})

test('ORIGENS_ENTRADA bate com plano_dia_origem_chk', () => {
  assert.deepEqual([...PD.ORIGENS_ENTRADA].sort(), (checkIn(mig, 'plano_dia_origem_chk') || []).sort())
})

test('CONCLUSOES bate com plano_dia_conclusao_tipo_chk', () => {
  assert.deepEqual([...PD.CONCLUSOES].sort(), (checkIn(mig, 'plano_dia_conclusao_tipo_chk') || []).sort())
})

// ── Dia operacional ──────────────────────────────────────────────────────────
test('o dia sai em APP_TIMEZONE, nao em UTC', () => {
  // 23:30 de 22/09 em Sao Paulo (UTC-3) e' 02:30 de 23/09 em UTC. O dia do operador e' 22.
  const instante = new Date('2026-09-23T02:30:00.000Z')
  assert.equal(PD.diaOperacional(instante, 'America/Sao_Paulo'), '2026-09-22')
  assert.equal(PD.diaOperacional(instante, 'UTC'), '2026-09-23')
})

test('data malformada devolve null — quem chama cai em hoje, nunca num dia qualquer', () => {
  for (const v of ['', null, '22/09/2026', '2026-9-2', 'hoje', '2026-02-31']) {
    assert.equal(PD.diaValido(v), null, `"${v}" deveria ser recusado`)
  }
  assert.equal(PD.diaValido('2026-09-22'), '2026-09-22')
})

// ── Movimentacao ─────────────────────────────────────────────────────────────
test('mover entre colunas que nao sao "feito" nao exige nada', () => {
  for (const destino of ['para_hoje', 'em_trabalho', 'aguardando_retorno']) {
    const r = PD.validarMovimento({ etapaDestino: destino })
    assert.equal(r.ok, true)
    assert.equal(r.conclusao, null)
  }
})

test('VOLTAR de coluna e permitido — um erro de arraste nao pode virar estado sem saida', () => {
  assert.equal(PD.validarMovimento({ etapaDestino: 'para_hoje' }).ok, true)
  assert.equal(PD.validarMovimento({ etapaDestino: 'em_trabalho' }).ok, true)
})

test('coluna desconhecida e recusada', () => {
  const r = PD.validarMovimento({ etapaDestino: 'arquivado' })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'ETAPA_INVALIDA')
})

// ── "Feito hoje" exige evidencia, com saida honesta ─────────────────────────
test('com atividade registrada, concluir e direto e vira `atividade_registrada`', () => {
  const r = PD.validarMovimento({ etapaDestino: 'feito', conclusao: { temAtividadeRegistrada: true } })
  assert.equal(r.ok, true)
  assert.equal(r.conclusao.tipo, 'atividade_registrada')
})

test('sem atividade e sem nota, concluir e RECUSADO — e o motivo diz o que fazer', () => {
  const r = PD.validarMovimento({ etapaDestino: 'feito', conclusao: { temAtividadeRegistrada: false } })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'CONCLUSAO_SEM_EVIDENCIA')
  assert.ok(/registre|escreva/i.test(r.motivo), 'o motivo precisa dizer a saida, nao so negar')
})

test('sem atividade mas COM nota, conclui como autodeclarada (a saida honesta)', () => {
  const r = PD.validarMovimento({
    etapaDestino: 'feito',
    conclusao: { temAtividadeRegistrada: false, nota: 'Falei por telefone pessoal.' },
  })
  assert.equal(r.ok, true)
  assert.equal(r.conclusao.tipo, 'autodeclarada')
  assert.equal(r.conclusao.nota, 'Falei por telefone pessoal.')
})

test('nota so de espacos nao conta como nota', () => {
  const r = PD.validarConclusao({ temAtividadeRegistrada: false, nota: '    ' })
  assert.equal(r.ok, false)
})

test('autodeclarada NUNCA e apresentada como prova', () => {
  assert.equal(PD.forcaDaConclusao('autodeclarada').prova, false)
  assert.equal(PD.forcaDaConclusao('atividade_registrada').prova, true)
  assert.equal(PD.forcaDaConclusao(null).prova, false)
  // O rotulo precisa DIZER a diferenca, nao so carregar um booleano.
  assert.notEqual(PD.forcaDaConclusao('autodeclarada').rotulo, PD.forcaDaConclusao('atividade_registrada').rotulo)
})

// ── Replanejamento ───────────────────────────────────────────────────────────
test('so o que ficou EM ABERTO e replanejavel — "feito" fica no dia em que aconteceu', () => {
  assert.equal(PD.replanejavel({ etapa: 'para_hoje' }), true)
  assert.equal(PD.replanejavel({ etapa: 'aguardando_retorno' }), true)
  assert.equal(PD.replanejavel({ etapa: 'feito' }), false)
  assert.equal(PD.replanejavel({ etapa: 'inexistente' }), false)
})

test('a ordem nova entra no fim da coluna, esparsa', () => {
  assert.equal(PD.proximaOrdem([]), 10)
  assert.equal(PD.proximaOrdem([10, 20, 30]), 40)
  assert.equal(PD.proximaOrdem(['x', null]), 10)
})

// ── GUARDAS: o Quadro NAO toca o ciclo comercial ─────────────────────────────
test('a camada de dados nao escreve no funil do lead', () => {
  const escritas = codigoDb.match(/\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+([a-z_.]+)/gi) || []
  for (const e of escritas) {
    assert.ok(/plano_dia_itens/i.test(e),
      `db/plano-dia.js escreve fora da sua tabela: "${e}" — planejar nao pode alterar o funil`)
  }
})

test('a camada de dados nao mexe em status, qualificacao, responsavel nem ICP', () => {
  for (const proibido of ['SET status', 'SET qualificacao', 'SET responsavel_id', 'SET icp_', 'vendas.conversas']) {
    assert.ok(!codigoDb.includes(proibido),
      `db/plano-dia.js passou a tocar "${proibido}" — o Quadro e planejamento, nao funil`)
  }
})

test('resumoPeriodo e contagem read-only, pessoal e agrupada por dia', () => {
  assert.ok(/async function resumoPeriodo/.test(fonteDb), 'faltou o resumo de navegacao por periodo')
  assert.ok(/i\.empresa_id = \$1/.test(fonteDb), 'resumo precisa escopar por empresa')
  assert.ok(/i\.usuario_id = \$2/.test(fonteDb), 'resumo precisa ser pessoal')
  assert.ok(/GROUP BY i\.dia/.test(fonteDb), 'resumo deve agregar por dia, nao listar cards')
  assert.ok(/COUNT\(\*\) FILTER \(WHERE i\.etapa = 'feito'\)/.test(fonteDb),
    'resumo precisa separar feitos de abertos')
})

test('o Quadro nao dispara abordagem', () => {
  for (const proibido of ['rodarLeads', 'enviarMensagem', 'whatsapp', 'gerarMensagens']) {
    assert.ok(!codigoDb.includes(proibido) && !codigoSvc.includes(proibido),
      `o Quadro passou a chamar "${proibido}" — mover um card nao envia nada`)
  }
})

test('o modulo de regras e PURO', () => {
  assert.ok(!/require\(/.test(codigoSvc), 'services/plano-dia.js passou a ter dependencia')
})

test('NENHUM worker replaneja sozinho', () => {
  // Pendencia que se move a meia-noite some do dia em que foi planejada sem ninguem decidir.
  const SRC = path.join(raiz, 'src')
  const ofensores = []
  const varrer = (dir) => {
    for (const nome of fs.readdirSync(dir)) {
      const p = path.join(dir, nome)
      if (fs.statSync(p).isDirectory()) { varrer(p); continue }
      if (!nome.endsWith('.js') || nome === 'plano-dia.js') continue
      const src = fs.readFileSync(p, 'utf8')
      if (/require\(['"].*(db|services)\/plano-dia['"]\)/.test(src) && /setInterval/.test(src)) {
        ofensores.push(path.relative(SRC, p))
      }
    }
  }
  varrer(SRC)
  assert.deepEqual(ofensores, [], 'replanejar e ato do operador, nunca de um tique')
})

// ── GUARDAS na rota: o plano e PESSOAL ───────────────────────────────────────
test('as rotas do Quadro nao aceitam usuario_id de fora', () => {
  const bloco = fonteRota.slice(fonteRota.indexOf('QUADRO DO DIA'), fonteRota.indexOf("router.get('/leads'"))
  assert.ok(bloco.length > 500, 'nao achei o bloco do Quadro na rota')
  assert.ok(!/query\.usuario_id|body\.usuario_id|b\.usuario_id/.test(bloco),
    'o quadro de outra pessoa nao e recorte de ninguem — isso e o painel da equipe, admin-only')
  const usos = bloco.match(/usuarioId:\s*[^,\n]+/g) || []
  for (const u of usos) {
    assert.ok(/req\.usuario\.id/.test(u), `usuarioId veio de outro lugar: ${u}`)
  }
})

test('o GET do Quadro e READ-ONLY', () => {
  const ini = fonteRota.indexOf("router.get('/plano-dia'")
  const fim = fonteRota.indexOf("router.post('/plano-dia'")
  const bloco = fonteRota.slice(ini, fim)
  for (const proibido of ['adicionarItens', 'moverItem', 'removerItem', 'replanejarPendentes', 'generateAIResponse']) {
    assert.ok(!bloco.includes(proibido), `abrir o quadro nao pode ${proibido}`)
  }
})

test('o resumo do Quadro nao aceita usuario_id externo', () => {
  const ini = fonteRota.indexOf("router.get('/plano-dia/resumo'")
  const fim = fonteRota.indexOf("router.get('/plano-dia'", ini + 1)
  const bloco = fonteRota.slice(ini, fim)
  assert.ok(bloco.includes('PLANO.resumoPeriodo'), 'rota de resumo deve usar a consulta agregada')
  assert.ok(!/query\.usuario_id|body\.usuario_id|b\.usuario_id/.test(bloco),
    'resumo do quadro tambem e pessoal; usuario_id externo viraria relatorio de equipe')
  assert.ok(/usuarioId:\s*req\.usuario\.id/.test(bloco), 'resumo precisa usar o usuario logado')
})

test('nenhuma capacidade nova foi criada para o Quadro', () => {
  const bloco = fonteRota.slice(fonteRota.indexOf('QUADRO DO DIA'), fonteRota.indexOf("router.get('/leads'"))
  assert.ok(!/requireCapacidade/.test(bloco),
    'por um lead no PROPRIO dia nao e decisao nova: o mount e o recorte ja sao a porta')
})
