'use strict'
// ISOLAMENTO DO COMERCIAL — o que o recorte por listagem sozinho NÃO protegia.
//
// Entrega de 2026-09-12, continuação do CRM em equipe (Etapas 1-12). As etapas anteriores
// recortaram as LISTAGENS por responsável; esta suíte cobre as três lacunas que sobraram:
//
//   1. as rotas `/:numero` e `/:instanceId` não repetiam o recorte que a listagem aplicava —
//      bastava trocar o id na URL para alcançar o trabalho de outro vendedor;
//   2. o recorte de conversa era só por `responsavel_id`, que **nada popula automaticamente**:
//      na prática toda conversa está sem dono e "minhas + não atribuídas" devolvia a empresa
//      inteira. O sinal provável (a INSTÂNCIA que recebeu a mensagem) não era usado;
//   3. os 4 routers de contexto não tinham gate de capacidade nenhum.
//
// Tudo aqui é leitura de fonte e regra pura — sem banco, sem HTTP.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const CR = require('../src/services/conversa-responsavel')
const LR = require('../src/services/lead-responsavel')

const RAIZ = path.join(__dirname, '..')
const fonte = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8')
const rota = (arq) => fonte('src', 'routes', arq)

// Toda declaração `router.<verbo>('<caminho>'` do arquivo, com a linha inteira.
function rotasDe(src, prefixoParam) {
  return src.split('\n').filter((l) => new RegExp(`router\\.(get|post|put|patch|delete)\\('/${prefixoParam}`).test(l))
}

// ─── 1. A REGRA PURA DO ALCANCE ──────────────────────────────────────────────────────────

test('sqlAlcance: quem ve todas nao recebe limite nenhum', () => {
  const r = CR.sqlAlcance({ podeVerTodas: true })
  assert.equal(r.sql, '')
  assert.equal(r.usaUsuario, false)
})

test('sqlAlcance: só entram a conversa atribuída e a da própria instância', () => {
  const { sql, usaUsuario } = CR.sqlAlcance({ podeVerTodas: false, alias: 'c', phUsuario: '$4', phEmpresa: '$1' })
  assert.equal(usaUsuario, true)
  // 1. atribuida a mim — decisao explicita vence qualquer inferencia.
  assert.match(sql, /c\.responsavel_id = \$4::uuid/)
  // 2. chegou pela MINHA instancia — o vinculo provado pelo webhook.
  assert.match(sql, /ewi_meu\.usuario_id = \$4::uuid/)
  assert.match(sql, /ewi_meu\.evolution_instance = c\.evolution_instance/)
  // Sem dono, compartilhada da empresa e órfã não entram.
  assert.doesNotMatch(sql, /responsavel_id IS NULL/)
  assert.doesNotMatch(sql, /ewi_alheia/)
  // A instancia e' sempre procurada DENTRO da empresa do request.
  assert.match(sql, /ewi_meu\.empresa_id = \$1::uuid/)
})

test('sqlAlcance: não consulta instância alheia nem compartilhada', () => {
  const { sql } = CR.sqlAlcance({ podeVerTodas: false })
  assert.ok(sql.includes('ewi_meu'))
  assert.ok(!sql.includes('ewi_alheia'))
  assert.ok(!sql.includes('usuario_id IS NULL'))
})

test('o ALCANCE nao substitui o ESCOPO — sao perguntas diferentes', () => {
  // O escopo traduz a ESCOLHA da tela; o alcance, o LIMITE de quem esta olhando. Um filtro de
  // tela nunca pode ampliar o limite, e por isso a rota aplica os dois com AND.
  assert.equal(CR.sqlEscopo('todas', { podeVerTodas: true }).sql, '')
  assert.notEqual(CR.sqlAlcance({ podeVerTodas: false }).sql, '')
})

test('rotuloAlcance descreve o recorte em texto, para a tela nao encolher em silencio', () => {
  assert.match(CR.rotuloAlcance(false), /seu número/)
  assert.match(CR.rotuloAlcance(true), /todas/)
})

// ─── 2. O DEFEITO DO BANCO DE LEADS VAZIO ────────────────────────────────────────────────

test('DEFEITO CORRIGIDO: o padrao do vendedor no Banco de Leads inclui os LIVRES', () => {
  // A Etapa 4 nao faz backfill de responsavel (todo lead nasce livre). Com o padrao antigo
  // (`meus`), a listagem devolvia ZERO linha para todo comercial, sempre.
  const r = LR.sqlEscopo(undefined, { podeVerTodos: false, alias: 'p' })
  assert.match(r.sql, /responsavel_id IS NULL/)
  assert.equal(LR.escopoEfetivo(undefined, false), 'meus_e_livres')
})

test('GUARDA: o Banco de Leads mostra só lead aprovado para quem nao ve a base bruta', () => {
  const src = rota('api-banco-leads.js')
  assert.ok(src.includes("require('../services/lead-qualificacao')"), 'perdeu o import da porta')
  assert.ok(src.includes('__somenteAprovados'), 'o recorte pela porta sumiu do Banco de Leads')
  // O MESMO ponto serve listagem, contagem e export — tres condicoes separadas divergiriam.
  assert.ok(/if \(query\.__somenteAprovados\) where\.push\(sqlAprovado/.test(src),
    'o recorte precisa entrar em montarFiltro, que e o ponto unico')
})

test('GUARDA: Banco de Leads semi usa somente instancia propria do Comercial', () => {
  const src = rota('api-banco-leads.js')
  assert.ok(src.includes('async function assertInstanciaPermitida'), 'faltou a guarda de instancia no Banco de Leads')
  assert.ok(src.includes('usuario_id = $3'), 'a guarda precisa exigir instancia vinculada ao usuario')
  for (const trecho of [
    "router.get('/cooldown'",
    "router.get('/geracao-progresso'",
    "router.post('/gerar'",
    "router.post('/gerar-pendentes'",
    "router.post('/disparar-gerados'",
  ]) {
    const ini = src.indexOf(trecho)
    assert.ok(ini >= 0, `rota nao encontrada: ${trecho}`)
    const bloco = src.slice(ini, ini + 900)
    assert.ok(bloco.includes('assertInstanciaPermitida'), `${trecho} nao valida instancia do usuario`)
  }
})

// ─── 3. AS ROTAS POR ID REPETEM O RECORTE DA LISTAGEM ────────────────────────────────────

test('GUARDA: TODA rota /:numero de conversas passa pelo alcance', () => {
  const src = rota('api-conversas.js')
  const rotas = rotasDe(src, ':numero')
  assert.ok(rotas.length >= 14, `esperava >= 14 rotas /:numero, achei ${rotas.length}`)
  const sem = rotas.filter((l) => !l.includes('alcancaConversa'))
  assert.deepEqual(sem, [], 'estas rotas alcancam a conversa de outro vendedor pelo id')
  // A ordem importa: o alcance depende de req.empresa, publicado por requireEmpresaAccess.
  for (const l of rotas) {
    assert.ok(l.indexOf('requireEmpresaAccess') < l.indexOf('alcancaConversa'), `ordem errada: ${l.trim().slice(0, 80)}`)
  }
})

test('GUARDA: o alcance da conversa vem do modulo PURO, e responde 404 (nao 403)', () => {
  const src = rota('api-conversas.js')
  assert.ok(src.includes('sqlAlcance: sqlAlcanceConversa'), 'a rota parou de usar a regra pura')
  const bloco = src.slice(src.indexOf('async function alcancaConversa'), src.indexOf('function erroConversas'))
  assert.ok(bloco.includes('status(404)'), 'dizer 403 revelaria que aquele contato fala com a empresa')
  assert.ok(!bloco.includes('403'), 'a existencia de conversa alheia nao e informacao desta pessoa')
})

test('GUARDA: a listagem de conversas aplica ALCANCE e ESCOPO nas MESMAS condicoes', () => {
  const src = rota('api-conversas.js')
  // `conds` serve a listagem E o COUNT: dois WHERE fariam o rodape contradizer a lista.
  assert.ok(/conds\.push\(alcance\.sql\)/.test(src), 'o alcance nao entrou nas condicoes compartilhadas')
  assert.ok(/conds\.push\(recorte\.sql\)/.test(src), 'o recorte saiu das condicoes compartilhadas')
  assert.ok(src.includes('alcance: rotuloAlcance('), 'a tela precisa poder declarar o recorte')
})

test('GUARDA: TODA rota /:instanceId de WhatsApp passa pelo alcance', () => {
  const src = rota('api-whatsapp.js')
  const rotas = rotasDe(src, ':instanceId')
  assert.ok(rotas.length >= 14, `esperava >= 14 rotas /:instanceId, achei ${rotas.length}`)
  const sem = rotas.filter((l) => !l.includes('alcancaInstancia'))
  assert.deepEqual(sem, [], 'estas rotas alcancam a instancia de outro vendedor pelo id')
  for (const l of rotas) {
    assert.ok(l.indexOf('requireEmpresaAccess') < l.indexOf('alcancaInstancia'), `ordem errada: ${l.trim().slice(0, 80)}`)
  }
})

test('GUARDA: o DESTRUTIVO de instancia e mais estrito que o alcance', () => {
  // Remover ou substituir um numero derruba o atendimento de quem estiver nele. Sobre o numero
  // COMPARTILHADO da empresa isso e decisao de quem responde pela empresa.
  const src = rota('api-whatsapp.js')
  for (const alvo of ["router.delete('/:instanceId'", "router.post('/:instanceId/substituir'"]) {
    const linha = src.split('\n').find((l) => l.includes(alvo))
    assert.ok(linha, `nao achei ${alvo}`)
    assert.ok(linha.includes('soDonoOuGestor'), `${alvo} aceita o numero da empresa nas maos do comercial`)
  }
})

test('GUARDA: o alcance da instancia nao aceita a COMPARTILHADA (usuario_id NULL)', () => {
  const src = rota('api-whatsapp.js')
  const bloco = src.slice(src.indexOf('async function alcancaInstancia'), src.indexOf('function soDonoOuGestor'))
  assert.ok(!bloco.includes('const daEmpresa = !inst.usuario_id'), 'a instancia da empresa voltou para o comercial')
  assert.ok(bloco.includes('status(404)'), 'a existencia do numero de outro vendedor nao e informacao desta pessoa')
})

// ─── 4. O CONHECIMENTO DA EMPRESA NAO E DO OPERADOR ──────────────────────────────────────

test('GUARDA: os 4 routers de CONTEXTO exigem INSTANCIA_GERENCIAR_CONTEXTO', () => {
  const idx = fonte('index.js').split('\n')
  const mounts = [
    "'/api/empresas/:empresaId/contextos'",
    "'/api/empresas/:empresaId/contextos/:contextoId'",
    "'/api/empresas/:empresaId/contextos/:contextoId/fontes'",
    "'/api/empresas/:empresaId/contextos/:contextoId/sugerir-contexto1'",
  ]
  for (const m of mounts) {
    const linha = idx.find((l) => l.includes(`app.use(${m}`))
    assert.ok(linha, `nao achei o mount ${m}`)
    assert.ok(linha.includes('requireCapacidade(CAP.INSTANCIA_GERENCIAR_CONTEXTO)'),
      `${m} voltou a ficar sem gate — qualquer membro criaria e editaria contexto`)
    assert.ok(linha.indexOf('requireEmpresaAccess') < linha.indexOf('requireCapacidade'),
      `${m}: requireCapacidade antes de requireEmpresaAccess derruba a rota para todo mundo`)
  }
})

test('GUARDA: trocar o CONTEXTO de um numero exige a capacidade de conhecimento', () => {
  // Renomear a propria instancia continua sendo do vendedor; trocar o que ela DIZ ao cliente nao.
  const src = rota('api-whatsapp.js')
  assert.ok(/contexto_id !== undefined && !capacidade\(req, CAP\.INSTANCIA_GERENCIAR_CONTEXTO\)/.test(src),
    'o PATCH voltou a deixar o operador trocar o contexto do numero')
})

test('GUARDA: o contexto PADRAO continua COPIADO na criacao, nunca resolvido na resposta', () => {
  // Invariante 4 do projeto: atendimento e 100% por instancia.
  const src = rota('api-whatsapp.js')
  assert.ok(src.includes('duplicarContexto(client, req.empresa.id, emp.contexto_padrao_id)'),
    'a copia do contexto padrao na criacao da instancia sumiu')
  assert.ok(!fonte('src', 'services', 'contexto-empresa.js').includes('contexto_padrao_id'),
    'buscarContexto2Ativo passou a resolver o padrao em tempo de RESPOSTA')
})

// ─── 5. VER O AUTOMATICO ≠ CONFIGURAR O AUTOMATICO ───────────────────────────────────────

test('GUARDA: o historico do contato mostra o follow-up AUTOMATICO', () => {
  const src = fonte('src', 'db', 'follow-ups.js')
  const bloco = src.slice(src.indexOf('async function historicoDoContato'), src.indexOf('/** Resumo da proxima acao'))
  assert.ok(bloco.includes('vendas.followup_auto_agendamentos'),
    'quem atende precisa saber que uma mensagem automatica ja saiu antes de escrever a proxima')
  assert.ok(bloco.includes("fa.status <> 'agendado'"), 'a linha do tempo responde o que JA houve')
  // A empresa vem da CONVERSA, dentro do SQL (padrao da migration 058) — fa.empresa_id e
  // nullable ate o backfill e filtrar por ela esconderia todo o historico.
  assert.ok(bloco.includes('JOIN vendas.conversas c ON c.numero = fa.numero'))
  assert.ok(bloco.includes('c.empresa_id = $1'))
})

test('GUARDA: o historico NAO devolve texto gerado pela IA nem corpo de mensagem', () => {
  const src = fonte('src', 'db', 'follow-ups.js')
  const bloco = src.slice(src.indexOf('async function historicoDoContato'), src.indexOf('/** Resumo da proxima acao'))
  // So o SQL: comentario que NOMEIA a coluna proibida para explicar por que ela fica de fora
  // nao e vazamento — e a documentacao da regra.
  const sql = bloco.split(String.fromCharCode(10)).filter((l) => !/^\s*(--|\/\/|\*)/.test(l)).join(' ')
  for (const campo of ['motivo_decisao', 'instrucao_ia', 'fe.corpo', 'c.historico']) {
    assert.ok(!sql.includes(campo), `${campo} vazou para a linha do tempo do contato`)
  }
})

test('GUARDA: cancelar o automatico exige a capacidade de configura-lo', () => {
  const src = rota('api-follow-ups.js')
  const linha = src.split('\n').find((l) => l.includes("router.post('/auto/cancelar'"))
  assert.ok(linha && linha.includes('requireCapacidade(CAP.FOLLOWUP_CONFIG_EMPRESA)'),
    'desligar a automacao de um lead e exercer controle sobre a automacao')
  // Mas VER continua aberto: o comercial precisa saber o que esta agendado e o que ja saiu.
  for (const aberta of ["router.get('/config'", "router.get('/auto'"]) {
    const l = src.split('\n').find((x) => x.includes(aberta))
    assert.ok(l && !l.includes('requireCapacidade'), `${aberta} passou a esconder o automatico de quem atende`)
  }
})

// ─── 6. O QUE NAO PODE TER MUDADO ────────────────────────────────────────────────────────

test('GUARDA: responder conversa continua NUNCA sendo bloqueado', () => {
  const alheia = CR.avaliarResponder({ responsavel_id: 'u2' }, 'u1')
  assert.equal(alheia.permitido, true)
  assert.equal(alheia.avisar, true)
})

test('GUARDA: o alcance por instancia NAO vazou para a resolucao de instancia de ENVIO', () => {
  // Invariante 2: so sai mensagem por instancia nomeada por vinculo provado — nunca pelo usuario.
  for (const arq of [['src', 'services', 'instancia-envio.js'], ['src', 'whatsapp.js'], ['src', 'middleware', 'tenant.js']]) {
    const src = fonte(...arq)
    assert.ok(!src.includes('sqlAlcance'), `${arq.join('/')} passou a escolher instancia por usuario`)
  }
})
