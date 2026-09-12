'use strict'
// Recorte por responsável em Ligações e Follow-ups (CRM em equipe, Etapa 10).
//
// **Nenhuma migration nesta etapa.** Os campos já existiam e nunca foram usados para filtrar:
//   * `app.ligacoes.usuario_id` — migration 040;
//   * `app.follow_ups.responsavel_id` — migration 062, com índice `(empresa_id, responsavel_id,
//     status)` pronto.
// Era ownership construído pela metade: o dado estava lá, nenhuma listagem o consultava.
//
// A assimetria entre os dois módulos é DELIBERADA e é o que estes testes travam:
//   * Ligação: quem não tem `LIGACAO_VER_TODAS` vê **só as suas** (é histórico pessoal);
//   * Follow-up: a fila tem **visibilidade GERAL** (decisão D) — o filtro por responsável é
//     conveniência de tela, não recorte de permissão.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const RAIZ = path.join(__dirname, '..')
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8')
const semComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ')

const dbLigacoes = fonte(path.join('src', 'db', 'ligacoes.js'))
const rotaLigacoes = fonte(path.join('src', 'routes', 'api-ligacoes.js'))
const dbFollowUps = fonte(path.join('src', 'db', 'follow-ups.js'))
const rotaFollowUps = fonte(path.join('src', 'routes', 'api-follow-ups.js'))

// ─── Nenhuma migration ───────────────────────────────────────────────────────────────────

test('a Etapa 10 NAO criou migration: os campos ja existiam', () => {
  const migrations = fs.readdirSync(path.join(RAIZ, 'sql', 'migrations'))
  assert.ok(!migrations.some((m) => /ligacao.?usuario|followup.?responsavel/i.test(m)),
    'a Etapa 10 nao precisa de migration')
  // E os campos precisam continuar existindo onde nasceram.
  assert.ok(fonte(path.join('sql', 'migrations', '040_ligacoes.sql')).includes('usuario_id'))
  assert.ok(fonte(path.join('sql', 'migrations', '062_follow_ups.sql')).includes('responsavel_id'))
})

// ─── Ligações: recorte de PERMISSÃO ──────────────────────────────────────────────────────

test('listarLigacoes filtra por usuario quando a rota manda, e traz o nome', () => {
  const i = dbLigacoes.indexOf('async function listarLigacoes')
  const bloco = dbLigacoes.slice(i, dbLigacoes.indexOf('async function contagemPorUsuario'))
  assert.ok(/usuarioId/.test(bloco), 'listarLigacoes precisa aceitar usuarioId')
  assert.ok(/l\.usuario_id = \$\$\{params\.length\}::uuid/.test(bloco) || /usuario_id = \$/.test(bloco),
    'o filtro por usuario precisa entrar no WHERE')
  assert.ok(/u\.nome AS usuario_nome/.test(bloco), 'a tela precisa do nome de quem ligou')
})

test('a CAMADA DE DADOS de ligacoes nao conhece papel nem capacidade', () => {
  // O veredito chega pronto da rota. Se o SQL decidisse, a matriz de permissao existiria em dois
  // lugares.
  const src = semComentarios(dbLigacoes)
  for (const proibido of ['acesso-capacidades', 'podeCapacidade', 'papelEmpresa', 'CAPACIDADES']) {
    assert.ok(!src.includes(proibido), `db/ligacoes.js nao pode conhecer '${proibido}'`)
  }
})

test('a ROTA de ligacoes decide o recorte por LIGACAO_VER_TODAS e diz o escopo', () => {
  const i = rotaLigacoes.indexOf("router.get('/', requireAuth")
  const bloco = rotaLigacoes.slice(i, i + 1600)
  assert.ok(bloco.includes('LIGACAO_VER_TODAS'), 'o recorte precisa vir da capacidade')
  assert.ok(/usuarioId: podeVerTodas \? null : /.test(bloco),
    'quem pode ver todas passa null; quem nao pode passa o proprio id')
  assert.ok(/escopo: podeVerTodas \? 'todas' : 'minhas'/.test(bloco),
    'recortar em silencio faria o vendedor achar que perdeu historico')
})

test('ligacao ANTIGA sem usuario_id nao entra no recorte de ninguem', () => {
  // Atribui-la a quem esta olhando seria inventar autoria.
  const i = dbLigacoes.indexOf('async function listarLigacoes')
  const bloco = dbLigacoes.slice(i, dbLigacoes.indexOf('async function contagemPorUsuario'))
  // O filtro e' por igualdade: `usuario_id = $n` nunca casa NULL. O que a guarda impede e' alguem
  // "melhorar" isso com um OR IS NULL, que passaria a mostrar ligacao de autoria desconhecida como
  // se fosse do usuario logado.
  assert.ok(!/usuario_id = \$\d+::uuid OR .*IS NULL/.test(bloco.replace(/\s+/g, ' ')),
    'nao acrescente OR usuario_id IS NULL: seria inventar autoria')
})

test('a contagem por usuario e leitura de GESTAO e exige a capacidade', () => {
  const linha = rotaLigacoes.split('\n').find((l) => l.includes("'/por-usuario'"))
  assert.ok(linha, 'a rota /por-usuario sumiu')
  assert.ok(linha.includes('requireCapacidade(CAP.LIGACAO_VER_TODAS)'))
  const iEmpresa = linha.indexOf('requireEmpresaAccess')
  const iCap = linha.indexOf('requireCapacidade')
  assert.ok(iEmpresa > 0 && iEmpresa < iCap, 'ordem errada dos middlewares')
})

test('/por-usuario vem ANTES de qualquer rota /:id de um segmento', () => {
  // Colisao de rota faria `/por-usuario` cair num handler de id.
  const bare = rotaLigacoes.split('\n').filter((l) => /router\.get\('\/:[a-zA-Z]+'\s*,/.test(l))
  assert.deepEqual(bare, [], 'nao deve existir GET /:id de um segmento (colidiria com /por-usuario e /analiticas)')
})

// ─── Follow-ups: gestor vê fila; comercial vê os próprios ────────────────────────────────

test('o filtro de follow-up por responsavel e OPCIONAL, e "sem responsavel" e um recorte proprio', () => {
  const i = dbFollowUps.indexOf('async function listarFollowUps')
  const bloco = dbFollowUps.slice(i, i + 2600)
  assert.ok(/if \(opts\.responsavelId\)/.test(bloco), 'o filtro precisa ser opcional')
  assert.ok(/opts\.semResponsavel === true/.test(bloco),
    '"sem responsavel" e trabalho que ninguem pegou — precisa ser filtravel')
  // `=== true` e nao truthy: `Boolean('false')` e' `true`, e a query string traz string.
  assert.ok(!/if \(opts\.semResponsavel\)\s*conds/.test(bloco),
    'semResponsavel precisa ser comparado com === true (a query string traz string)')
})

test('a fila de Follow-ups recorta por permissao para o comercial', () => {
  const linha = rotaFollowUps.split('\n').find((l) => l.includes("router.get('/itens'"))
  assert.ok(linha, 'a rota da fila sumiu')
  assert.ok(!linha.includes('requireCapacidade'),
    'o mount ja exige FOLLOWUP_OPERAR; a rota decide o recorte pelo papel')
  const i = rotaFollowUps.indexOf("router.get('/itens'")
  const bloco = rotaFollowUps.slice(i, i + 1200)
  assert.ok(/propriosUsuarioId: recorte\.podeVerFila \? null : recorte\.usuarioId/.test(bloco),
    'quem nao ve a fila da equipe precisa receber so os proprios follow-ups')
  assert.ok(/responsavelId: recorte\.podeVerFila \? \(req\.query\.responsavel_id \|\| null\) : null/.test(bloco),
    'o filtro de responsavel fica disponivel so para quem ve a fila da equipe')
})

test('a contagem de follow-ups inclui "sem responsavel" como linha propria', () => {
  const i = dbFollowUps.indexOf('async function contagemPorResponsavel')
  assert.ok(i > 0, 'contagemPorResponsavel nao existe')
  const bloco = dbFollowUps.slice(i, i + 1200)
  // Sem `LEFT JOIN` e sem filtrar NULL, a soma das colunas nao fecharia com o total da fila.
  assert.ok(/LEFT JOIN app\.usuarios/.test(bloco))
  assert.ok(!/WHERE[\s\S]{0,200}responsavel_id IS NOT NULL/.test(bloco),
    'nao filtre os sem responsavel: e trabalho real e a soma precisa fechar')
  assert.ok(/GROUP BY f\.responsavel_id/.test(bloco))
  assert.ok(/vencidos/.test(bloco), 'o que ja venceu e a informacao que decide o dia')
})

test('a rota de contagem de follow-ups NAO exige capacidade de gestao', () => {
  // Saber quem esta com o que e' parte de trabalhar numa fila compartilhada.
  const linha = rotaFollowUps.split('\n').find((l) => l.includes("'/por-responsavel'"))
  assert.ok(linha, 'a rota /por-responsavel sumiu')
  assert.ok(!linha.includes('requireCapacidade'), 'coerente com a visibilidade geral da fila')
  assert.ok(linha.includes('requireEmpresaAccess'), 'mas continua escopada por empresa')
})

// ─── O que a Etapa 10 NÃO fez ────────────────────────────────────────────────────────────

test('transferencia de LIGACAO continua fora de escopo', () => {
  // Declarado no AGENTS.md desde a entrega de sincronizacao entre sessoes.
  const src = semComentarios(dbLigacoes)
  for (const proibido of ['transferirLigacao', 'assumirLigacao']) {
    assert.ok(!src.includes(proibido), `${proibido} esta fora de escopo`)
  }
})

test('o modo Acompanhar continua SOMENTE LEITURA e `sou_eu` continua vindo do servidor', () => {
  // O item 10.2 do plano ja estava entregue: `POST /iniciar` devolve `sou_eu`, e a tela abre em
  // modo Acompanhar quando retoma sessao alheia.
  const i = rotaLigacoes.indexOf("router.post('/iniciar'")
  const bloco = rotaLigacoes.slice(i, i + 1800)
  assert.ok(/sou_eu: ACOMP\.ehDono\(/.test(bloco), '`sou_eu` precisa continuar sendo calculado no SERVIDOR')
  const front = fs.readFileSync(
    path.join(RAIZ, '..', 'frontend', 'app', 'dashboard', 'central-ligacoes', 'page.tsx'), 'utf8'
  )
  assert.ok(/r\.data\.retomada && r\.data\.sou_eu === false/.test(front),
    'a tela precisa abrir em modo Acompanhar ao retomar sessao alheia')
})
