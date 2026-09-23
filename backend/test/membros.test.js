'use strict'
// Contas da empresa (CRM em equipe, Etapa 2) + a semente da suite de AUTORIZACAO POR ROTA.
// Ver docs/plano-execucao-crm-equipe.md §4 e §6 (subetapa 6.1).
//
// Nao ha conexao com banco aqui: o que se testa e a validacao de entrada (pura), o middleware de
// capacidade (com req/res falsos) e guardas de regressao que leem o fonte.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const { requireCapacidade } = require('../src/middleware/tenant')
const { CAPACIDADES: C, PAPEIS } = require('../src/services/acesso-capacidades')
const M = require('../src/db/membros')

const SRC = path.join(__dirname, '..', 'src')
const fonteMembrosDb = fs.readFileSync(path.join(SRC, 'db', 'membros.js'), 'utf8')
const fonteMembrosRota = fs.readFileSync(path.join(SRC, 'routes', 'api-membros.js'), 'utf8')
const fonteIndex = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
const fonteLeadResp = fs.readFileSync(path.join(SRC, 'db', 'lead-responsavel.js'), 'utf8')
const fonteConversaResp = fs.readFileSync(path.join(SRC, 'db', 'conversa-responsavel.js'), 'utf8')
const fonteFollowUps = fs.readFileSync(path.join(SRC, 'db', 'follow-ups.js'), 'utf8')

// ─── Ajudas para exercitar o middleware sem HTTP ───────────────────────────────────────────

function resFalso() {
  const r = { statusCode: null, corpo: null }
  r.status = (s) => { r.statusCode = s; return r }
  r.json = (c) => { r.corpo = c; return r }
  return r
}

/** Roda o middleware e devolve { chamouNext, statusCode, code }. */
function rodar(middleware, req) {
  const res = resFalso()
  let chamouNext = false
  middleware(req, res, () => { chamouNext = true })
  return { chamouNext, statusCode: res.statusCode, code: res.corpo?.error?.code }
}

const reqDe = (papel, { permissoes = null, papelPlataforma = 'user', comEmpresa = true } = {}) => ({
  usuario: { id: 'u1', role: papelPlataforma },
  empresa: comEmpresa ? { id: 'e1' } : undefined,
  papelEmpresa: papel,
  vinculoEmpresa: papel ? { id: 'v1', role: papel, permissoes } : null,
  originalUrl: '/api/empresas/e1/membros',
})

// ─── requireCapacidade ─────────────────────────────────────────────────────────────────────

test('requireCapacidade libera quem o papel alcanca e recusa quem nao alcanca', () => {
  const mw = requireCapacidade(C.MEMBROS_GERENCIAR)
  for (const papel of ['owner', 'admin']) {
    assert.equal(rodar(mw, reqDe(papel)).chamouNext, true, `${papel} deveria passar`)
  }
  for (const papel of ['comercial', 'member']) {
    const r = rodar(mw, reqDe(papel))
    assert.equal(r.chamouNext, false, `${papel} NAO deveria passar`)
    assert.equal(r.statusCode, 403)
    assert.equal(r.code, 'FORBIDDEN')
  }
})

test('requireCapacidade libera por CONCESSAO aditiva', () => {
  const mw = requireCapacidade(C.MEMBROS_GERENCIAR)
  const req = reqDe('comercial', { permissoes: { [C.MEMBROS_GERENCIAR]: true } })
  assert.equal(rodar(mw, req).chamouNext, true)
})

test('requireCapacidade: superadmin passa mesmo sem vinculo', () => {
  const mw = requireCapacidade(C.MEMBROS_GERENCIAR)
  const req = reqDe(null, { papelPlataforma: 'superadmin' })
  assert.equal(rodar(mw, req).chamouNext, true)
})

test('requireCapacidade: admin GLOBAL sem vinculo na empresa NAO passa', () => {
  // E' o defeito que a Etapa 1 corrigiu: papel global valia dentro de qualquer empresa.
  const mw = requireCapacidade(C.MEMBROS_GERENCIAR)
  const r = rodar(mw, reqDe(null, { papelPlataforma: 'admin' }))
  assert.equal(r.chamouNext, false)
  assert.equal(r.statusCode, 403)
})

test('requireCapacidade FALHA (nao libera) se rodar sem requireEmpresaAccess antes', () => {
  // Cair no papel global aqui reintroduziria o defeito. Preferimos 500 explicito a um 200 errado.
  const mw = requireCapacidade(C.MEMBROS_GERENCIAR)
  const r = rodar(mw, reqDe('owner', { comEmpresa: false }))
  assert.equal(r.chamouNext, false)
  assert.equal(r.statusCode, 500)
  assert.equal(r.code, 'ACESSO_MAL_CONFIGURADO')
})

test('requireCapacidade sem usuario responde 401, nao 403', () => {
  const r = rodar(requireCapacidade(C.MEMBROS_GERENCIAR), { originalUrl: '/x' })
  assert.equal(r.statusCode, 401)
})

test('requireCapacidade com VARIAS capacidades: qualquer uma basta', () => {
  const mw = requireCapacidade(C.MEMBROS_GERENCIAR, C.LIGACAO_OPERAR)
  assert.equal(rodar(mw, reqDe('comercial')).chamouNext, true, 'comercial tem LIGACAO_OPERAR')
  assert.equal(rodar(mw, reqDe('member')).chamouNext, false, 'member nao tem nenhuma das duas')
})

test('requireCapacidade com capacidade desconhecida recusa (nao libera por engano)', () => {
  const r = rodar(requireCapacidade('capacidade_inventada'), reqDe('owner'))
  assert.equal(r.chamouNext, false)
  assert.equal(r.statusCode, 403)
})

// ─── sanearPermissoes (validacao de entrada) ───────────────────────────────────────────────

test('sanearPermissoes aceita so concessao ADITIVA de capacidade conhecida', () => {
  const ok = M.sanearPermissoes({ [C.CONVERSA_GERENCIAR_IA]: true }, 'comercial')
  assert.deepEqual(ok, { [C.CONVERSA_GERENCIAR_IA]: true })
  assert.deepEqual(M.sanearPermissoes(null, 'comercial'), {})
  assert.deepEqual(M.sanearPermissoes({}, 'comercial'), {})
})

test('sanearPermissoes RECUSA `false` em vez de ignorar', () => {
  // `permissoes: { x: false }` e' quase sempre alguem tentando NEGAR. Negar nao existe neste
  // modelo; gravar silenciosamente criaria a expectativa de que a negacao vale.
  assert.throws(
    () => M.sanearPermissoes({ [C.CONVERSA_GERENCIAR_IA]: false }, 'comercial'),
    /somente aditiva/
  )
  for (const valor of ['true', 1, 0, '', null, {}]) {
    assert.throws(() => M.sanearPermissoes({ [C.CONVERSA_GERENCIAR_IA]: valor }, 'comercial'),
      /somente aditiva/, `valor ${JSON.stringify(valor)}`)
  }
})

test('sanearPermissoes recusa capacidade desconhecida e capacidade que o papel JA tem', () => {
  assert.throws(() => M.sanearPermissoes({ nao_existe: true }, 'comercial'), /desconhecida/)
  // Conceder o que o papel ja inclui inflaria a coluna e faria a tela mostrar concessao onde nao
  // houve decisao.
  assert.throws(() => M.sanearPermissoes({ [C.LIGACAO_OPERAR]: true }, 'comercial'), /já está incluída/)
  // owner/admin alcancam tudo: nao ha nada a conceder a eles.
  assert.throws(() => M.sanearPermissoes({ [C.LIGACAO_OPERAR]: true }, 'owner'), /já está incluída/)
})

test('sanearPermissoes recusa payload que nao e objeto', () => {
  for (const v of ['x', 7, [C.LIGACAO_OPERAR], true]) {
    assert.throws(() => M.sanearPermissoes(v, 'comercial'), /deve ser um objeto/)
  }
})

test('sanearPermissoesExistentes descarta o que o papel NOVO passou a incluir, sem lancar', () => {
  // Promover comercial -> admin torna a concessao redundante: ela deve sair, nao virar ruido.
  const r = M.sanearPermissoesExistentes({ [C.CONVERSA_GERENCIAR_IA]: true }, 'admin')
  assert.deepEqual(r, {})
  // Mantem a que continua fazendo sentido.
  assert.deepEqual(
    M.sanearPermissoesExistentes({ [C.CONVERSA_GERENCIAR_IA]: true }, 'comercial'),
    { [C.CONVERSA_GERENCIAR_IA]: true }
  )
  // Lixo gravado no passado nao impede uma troca de papel.
  assert.deepEqual(M.sanearPermissoesExistentes({ lixo: true, x: false }, 'comercial'), {})
  assert.deepEqual(M.sanearPermissoesExistentes(null, 'comercial'), {})
})

test('normalizarEmail baixa a caixa e tira espaco', () => {
  assert.equal(M.normalizarEmail('  Foo@Bar.COM '), 'foo@bar.com')
  assert.equal(M.normalizarEmail(null), '')
})

// ─── Guardas de regressao ──────────────────────────────────────────────────────────────────

test('GUARDA: a rota de membros aplica os TRES middlewares, no router (nao por rota)', () => {
  // Um `router.use` e' o que impede uma rota nova de nascer sem gate.
  assert.ok(
    /router\.use\(\s*requireAuth,\s*requireEmpresaAccess,\s*requireCapacidade\(\s*CAPACIDADES\.MEMBROS_GERENCIAR\s*\)\s*\)/.test(fonteMembrosRota),
    'api-membros.js precisa aplicar requireAuth + requireEmpresaAccess + requireCapacidade(MEMBROS_GERENCIAR) no router'
  )
})

test('GUARDA: nao existe rota de EXCLUSAO de membro', () => {
  // Desativar revoga acesso e preserva historico; um DELETE desligaria em silencio a autoria de
  // ligacoes, follow-ups e auditoria daquela pessoa.
  assert.ok(!/router\.delete\(/.test(fonteMembrosRota), 'membro nao se exclui — se desativa')
  for (const verbo of ['DELETE FROM app.usuarios_empresas', 'DELETE FROM app.usuarios']) {
    assert.ok(!fonteMembrosDb.includes(verbo), `db/membros.js nao pode conter: ${verbo}`)
  }
})

test('GUARDA: a camada de membros nunca seleciona nem devolve senha/hash', () => {
  // Checagem por LINHA, e nao por regiao entre `;`: este projeto omite ponto-e-virgula em JS,
  // entao `[^;]*` atravessaria o arquivo inteiro e acusaria um falso positivo.
  // O split aceita CRLF e o strip usa uma classe negada no lugar do ponto, de proposito:
  // com carriage return no fim da linha, um padrao ancorado em fim de string NAO casa (em
  // JS o ponto nao casa carriage return), o comentario nao e removido, e a guarda acusa a
  // propria DOCUMENTACAO de membros.js como se fosse codigo. Mesmo defeito ja corrigido em
  // test/conversa-modo-ia.test.js: volta em toda guarda nova que le fonte por linha, porque
  // este repo e checado com CRLF no Windows.
  const linhas = fonteMembrosDb.split(/\r?\n/)
  for (const [i, linha] of linhas.entries()) {
    if (!linha.includes('password_hash')) continue
    const semComentario = linha.replace(/\/\/[^\n]*$/, '')
    if (!semComentario.includes('password_hash')) continue
    // O UNICO uso legitimo e' ESCREVER o hash no INSERT de um usuario novo.
    const ehEscrita = /INSERT INTO app\.usuarios\b/.test(semComentario)
      || /const password_hash = await hashPassword/.test(semComentario)
      // A data de nascimento (migration 096) entra DEPOIS do hash — continua sendo a escrita.
      || /^\s*\[email, nome, password_hash(, \w+)*\]/.test(semComentario)
    assert.ok(ehEscrita, `linha ${i + 1}: password_hash so pode ser ESCRITO, nunca lido/retornado: ${linha.trim()}`)
    assert.ok(!/\bSELECT\b|\bRETURNING\b/i.test(semComentario),
      `linha ${i + 1}: password_hash nao pode aparecer em SELECT/RETURNING`)
  }
  // A lista de colunas devolvida ao cliente nao pode conter o campo.
  const cols = fonteMembrosDb.match(/const COLS_MEMBRO = `([\s\S]*?)`/)
  assert.ok(cols, 'nao achei COLS_MEMBRO')
  assert.ok(!cols[1].includes('password_hash'), 'COLS_MEMBRO nao pode expor password_hash')
  // A rota tampouco pode tocar no campo.
  assert.ok(!fonteMembrosRota.includes('password_hash'))
})

test('GUARDA: a auditoria de membro nao carrega e-mail, senha nem hash', () => {
  // `contexto` e' JSONB livre — e' fácil alguem jogar o payload inteiro lá dentro.
  const blocos = [...fonteMembrosDb.matchAll(/contexto:\s*\{([^}]*)\}/g)].map((m) => m[1])
  assert.ok(blocos.length >= 2, 'esperava ao menos os dois contextos de auditoria')
  for (const bloco of blocos) {
    for (const proibido of ['email', 'senha', 'password', 'hash']) {
      assert.ok(!bloco.includes(proibido), `contexto de auditoria nao pode conter '${proibido}': ${bloco.trim()}`)
    }
  }
})

test('GUARDA: o papel GLOBAL do novo membro e sempre `user`, nunca vem do payload', () => {
  // Conceder papel global aqui devolveria o defeito que a Etapa 1 corrigiu.
  assert.ok(/INSERT INTO app\.usuarios[\s\S]{0,200}'user'/.test(fonteMembrosDb),
    'o INSERT em app.usuarios deve fixar o papel global em user')
  assert.ok(!/role\s*=\s*\$\d[\s\S]{0,80}app\.usuarios\b(?!_empresas)/.test(fonteMembrosDb))
})

test('GUARDA: o owner e o proprio vinculo estao protegidos', () => {
  assert.ok(fonteMembrosDb.includes('OWNER_PROTEGIDO'), 'owner nao pode ser rebaixado/desativado aqui')
  assert.ok(fonteMembrosDb.includes('AUTO_ALTERACAO'), 'ninguem altera o proprio vinculo')
})

test('GUARDA: db/membros.js nao compara papel com literal (quem decide e o modulo puro)', () => {
  // Os unicos literais legitimos de papel aqui sao a protecao do owner (comparacao de ESTADO
  // gravado, nao decisao de acesso) e o 'user' global do INSERT.
  const ocorrencias = [...fonteMembrosDb.matchAll(/'(owner|admin|comercial|member)'/g)].map((m) => m[1])
  assert.deepEqual([...new Set(ocorrencias)], ['owner'],
    'so o owner pode ser comparado por literal (protecao); acesso se decide em acesso-capacidades.js')
})

// ─── Autorizacao por rota ───────────────────────────────────────────────────────────────────
//
// A tabela de rotas x capacidade MUDOU DE ARQUIVO na Etapa 6: nasceu aqui como semente (quando
// /membros era a unica rota autorizada por capacidade) e virou `test/autorizacao-rotas.test.js`
// quando 15 mounts passaram a depender dela. Deixar a tabela aqui faria um arquivo chamado
// "membros" ser o dono da autorizacao do produto inteiro.
//
// A guarda que cobra a existencia daquela suite vive em test/acesso-capacidades.test.js.

test('a rota de membros esta declarada na suite de autorizacao por rota', () => {
  const suite = fs.readFileSync(path.join(__dirname, 'autorizacao-rotas.test.js'), 'utf8')
  assert.ok(suite.includes('/api/empresas/:empresaId/membros'),
    'o mount de membros saiu de ROTAS_POR_CAPACIDADE — ele precisa continuar exercitado contra os 4 papeis')
})

// ─── DESATIVAR UM MEMBRO DEVOLVE O TRABALHO DELE (2026-09-22) ──────────────────────────────
//
// O defeito medido em producao: desativar o vinculo revogava o acesso e deixava TUDO na mao da
// pessoa. Uma conta desativada segurava 184 leads trabalhaveis; outras duas, 7 follow-ups em
// aberto. Esse trabalho fica invisivel (o recorte do comercial e "meus + livres", e lead de um
// desativado nao e nem um nem outro) e continua contando na carteira dela.

/** Client falso: grava as queries e devolve o que o teste mandar, na ordem. */
function clientFalso(respostas = []) {
  const chamadas = []
  let i = 0
  return {
    chamadas,
    query: async (sql, params) => {
      chamadas.push({ sql: String(sql), params })
      const r = respostas[i]
      i += 1
      return r || { rows: [] }
    },
  }
}

test('desativar devolve leads, conversas, follow-ups e fecha as equipes', async () => {
  const c = clientFalso([
    { rows: [{ equipe_id: 'e9' }] },                                     // fecha equipe
    { rows: [{ id: 'l1', tem_reuniao_futura: true, tem_conversa_aberta: false }, { id: 'l2' }] }, // candidatos
    { rows: [] }, { rows: [] }, { rows: [] },                            // update + 2 historicos
    { rows: [{ numero: '5511999990001@s.whatsapp.net' }] },              // conversas liberadas
    { rows: [] }, { rows: [] },                                          // historico + auditoria conversa
    { rows: [{ id: 'f1' }, { id: 'f2' }] },                              // follow-ups liberados
    { rows: [] },                                                        // auditoria follow-up
  ])

  const r = await M.__devolverTrabalhoDoMembro(c, { empresaId: 'emp1', usuarioId: 'u9', autorId: 'admin1' })

  assert.equal(r.equipes_encerradas, 1)
  assert.equal(r.leads_liberados, 2)
  assert.equal(r.leads_com_reuniao_futura, 1, 'o risco e informado, nunca bloqueia')
  assert.equal(r.conversas_liberadas, 1)
  assert.equal(r.follow_ups_liberados, 2)
})

test('a pessoa sai das equipes ANTES de a carteira ser devolvida', async () => {
  const c = clientFalso([{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }])
  await M.__devolverTrabalhoDoMembro(c, { empresaId: 'emp1', usuarioId: 'u9', autorId: 'a1' })
  // Enquanto o vinculo de equipe estiver aberto, um rebalanceamento concorrente devolveria para
  // ela o que acabamos de tirar.
  assert.match(c.chamadas[0].sql, /equipe_comercial_membros[\s\S]*saiu_em/)
})

test('a devolucao NAO escolhe um substituto — tudo vai para a FILA', async () => {
  const c = clientFalso([
    { rows: [] },
    { rows: [{ id: 'l1' }] }, { rows: [] }, { rows: [] }, { rows: [] },
    { rows: [] }, { rows: [] },
  ])
  await M.__devolverTrabalhoDoMembro(c, { empresaId: 'emp1', usuarioId: 'u9', autorId: 'a1' })
  const updates = c.chamadas.filter((x) => /UPDATE/i.test(x.sql) && /responsavel_id/.test(x.sql))
  assert.ok(updates.length > 0)
  for (const u of updates) {
    assert.match(u.sql, /responsavel_id\s*=\s*NULL/,
      'escolher um substituto aqui seria inventar dono — quem decide e a equipe ou uma pessoa')
  }
})

test('GUARDA: a devolucao roda so na TRANSICAO de ativo para inativo', () => {
  // Repetir o PATCH numa pessoa ja desativada nao pode liberar de novo: a carteira ja voltou para
  // a fila e pode ter sido assumida por outra pessoa nesse meio tempo.
  assert.match(fonteMembrosDb, /desativouAgora\s*=\s*temAtivo\s*&&\s*patch\.ativo === false\s*&&\s*vinculo\.ativo === true/)
})

test('GUARDA: a devolucao roda DENTRO da transacao do vinculo', () => {
  const i = fonteMembrosDb.indexOf('return withTx(async (client) => {')
  const j = fonteMembrosDb.indexOf('devolverTrabalhoDoMembro(client', i)
  assert.ok(i >= 0 && j > i, 'metade feito seria pessoa com acesso e sem carteira, ou o inverso')
})

test('GUARDA: membros.js nao escreve direto em prospects, conversas ou follow_ups', () => {
  // Cada um desses e dono do proprio historico (migrations 072, 074, 062). Um UPDATE solto aqui
  // apagaria a autoria sem deixar rastro.
  for (const tabela of ['prospectador.prospects', 'vendas.conversas', 'app.follow_ups']) {
    assert.ok(!new RegExp(`(UPDATE|INSERT INTO|DELETE FROM)\s+${tabela.replace('.', '\.')}`, 'i').test(fonteMembrosDb),
      `membros.js nao pode escrever direto em ${tabela} — use o dono do modulo`)
  }
})

test('GUARDA: liberarLeadsDoMembro nao filtra por qualificacao', () => {
  // Ate 2026-09-22 filtrava por IN ('aprovado','legado') e deixava lead DESCARTADO grudado para
  // sempre em quem saiu (43 leads medidos em producao). Descartado nao aparece na tela de
  // ninguem, entao o dono errado nunca e visto — mas continua inflando a carteira dela.
  const i = fonteLeadResp.indexOf('async function liberarLeadsDoMembro')
  const trecho = fonteLeadResp.slice(i, i + 1600)
  assert.ok(!/qualificacao\s+IN/i.test(trecho), 'liberar deve devolver TODOS os leads da pessoa')
})

test('GUARDA: liberarLeadsDoMembro aceita nichoId ausente (a pessoa perdeu a EMPRESA)', () => {
  const i = fonteLeadResp.indexOf('async function liberarLeadsDoMembro')
  const trecho = fonteLeadResp.slice(i, i + 700)
  assert.match(trecho, /nichoId\s*=\s*null/)
  assert.ok(!/if\s*\(!empresaId\s*\|\|\s*!nichoId/.test(trecho),
    'exigir nicho aqui devolveria menos do que deveria, em silencio')
})

test('GUARDA: follow-up so e liberado quando esta EM ABERTO', () => {
  const i = fonteFollowUps.indexOf('async function liberarFollowUpsDoMembro')
  const trecho = fonteFollowUps.slice(i, i + 900)
  assert.match(trecho, /status\s*=\s*'aguardando'/,
    'follow-up concluido e HISTORICO: reescrever o responsavel apagaria a autoria de um trabalho real')
})

test('GUARDA: liberar conversa nao mexe em atualizado_em, modo_ia nem agente_pausado', () => {
  const i = fonteConversaResp.indexOf('async function liberarConversasDoMembro')
  const trecho = fonteConversaResp.slice(i, i + 900)
  const update = trecho.slice(trecho.indexOf('UPDATE vendas.conversas'), trecho.indexOf('RETURNING'))
  for (const proibido of ['atualizado_em', 'modo_ia', 'agente_pausado']) {
    assert.ok(!update.includes(proibido),
      `liberar o dono nao e mensagem nova nem decisao sobre a IA (${proibido})`)
  }
})
