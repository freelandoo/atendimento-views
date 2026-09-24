'use strict'
// Operação Comercial, Etapa 1 — regra PURA do aceite + guardas de regressão.
//
// O que esta suíte protege, em uma frase: que "antes do aceite, nada da empresa responde" continue
// sendo uma afirmação verdadeira, e não uma lista que alguém precisa lembrar de manter.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const P = require('../src/services/programa-aceite')
const TERMO = require('../src/services/programa-termo')

const RAIZ = path.join(__dirname, '..')
const SRC = path.join(RAIZ, 'src')
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8')
const migration = fonte('sql/migrations/084_programa_aceite.sql')

// ─── A regra: quem entra e quem é barrado ────────────────────────────────────────────────

test('o COMERCIAL e barrado enquanto nao aceita', () => {
  const v = P.avaliarAcesso({ papel: 'comercial', aceite: null }, '1.0')
  assert.equal(v.liberado, false, 'comercial sem aceite deveria ser barrado')
  assert.equal(v.motivo, P.MOTIVOS.ACEITE_AUSENTE)
  assert.equal(v.versao_exigida, '1.0')
  assert.ok(P.barra(v.motivo))
})

test('OWNER nao e sujeito do programa — e isso nao e cortesia', () => {
  // O termo é o contrato de quem TRABALHA no programa; quem responde pela empresa é a outra
  // parte do acordo. Torná-los sujeitos trancaria o dono fora do próprio produto no primeiro
  // boot depois do deploy, e não há ninguém acima dele para destravar.
  const v = P.avaliarAcesso({ papel: 'owner', aceite: null }, '1.0')
  assert.equal(v.liberado, true, 'owner nao pode ser barrado pelo termo')
  assert.equal(v.motivo, P.MOTIVOS.NAO_SUJEITO)
  assert.ok(!P.barra(v.motivo))
})

test('o superadmin da PLATAFORMA passa sem vinculo e sem aceite', () => {
  const v = P.avaliarAcesso({ papel: null, papelPlataforma: 'superadmin', aceite: null }, '1.0')
  assert.equal(v.liberado, true)
  assert.equal(v.motivo, P.MOTIVOS.PLATAFORMA)
})

test('aceite da versao VIGENTE libera; aceite de OUTRA versao volta a barrar', () => {
  const vigente = P.avaliarAcesso({ papel: 'comercial', aceite: { versao: '1.0' } }, '1.0')
  assert.equal(vigente.liberado, true)
  assert.equal(vigente.motivo, P.MOTIVOS.ACEITE_VIGENTE)

  const velha = P.avaliarAcesso({ papel: 'comercial', aceite: { versao: '0.9' } }, '1.0')
  assert.equal(velha.liberado, false)
  assert.equal(velha.motivo, P.MOTIVOS.ACEITE_DESATUALIZADO)
  assert.equal(velha.versao_exigida, '1.0')
})

test('versao GRAVADA mais nova que a vigente (rollback de deploy) tambem volta a exigir', () => {
  // Preferir pedir de novo a supor que a pessoa concordou com um texto que não viu.
  const v = P.avaliarAcesso({ papel: 'comercial', aceite: { versao: '2.0' } }, '1.0')
  assert.equal(v.liberado, false)
  assert.equal(v.motivo, P.MOTIVOS.ACEITE_DESATUALIZADO)
})

test('aceite malformado nao passa por engano, e nada lanca', () => {
  for (const aceite of [{}, { versao: '' }, { versao: '   ' }, { versao: null }, 'sim', 0]) {
    const v = P.avaliarAcesso({ papel: 'comercial', aceite }, '1.0')
    assert.equal(v.liberado, false, `${JSON.stringify(aceite)} nao deveria liberar`)
  }
  assert.doesNotThrow(() => P.avaliarAcesso(null, '1.0'))
  assert.doesNotThrow(() => P.avaliarAcesso({ papel: 'comercial' }, null))
})

test('papel desconhecido NAO e barrado pelo termo — este modulo nao autoriza nada', () => {
  // Quem não tem papel conhecido já não alcança capacidade alguma (`capacidadesDoVinculo`
  // devolve []). Fazer o gate do TERMO barrar por papel inválido seria este módulo tomando, por
  // tabela, uma decisão de AUTORIZAÇÃO que não é dele. Uma porta, uma pergunta.
  const v = P.avaliarAcesso({ papel: 'papel_novo_do_servidor', aceite: null }, '1.0')
  assert.equal(v.liberado, true)
  assert.equal(v.motivo, P.MOTIVOS.NAO_SUJEITO)
  assert.equal(P.avaliarAcesso({ papel: 'admin', aceite: null }, '1.0').liberado, true)
  assert.equal(P.avaliarAcesso({ papel: 'member', aceite: null }, '1.0').liberado, true)
})

test('motivo novo nasce LIBERANDO — a lista de bloqueio e explicita', () => {
  assert.deepEqual([...P.MOTIVOS_QUE_BARRAM].sort(),
    [P.MOTIVOS.ACEITE_AUSENTE, P.MOTIVOS.ACEITE_DESATUALIZADO].sort())
  assert.equal(P.barra('motivo_que_nao_existe'), false)
})

// ─── A validação do que a pessoa enviou ──────────────────────────────────────────────────

test('as DUAS confirmacoes sao exigidas, e nenhuma vale pela outra', () => {
  const base = { termo_versao: '1.0', maioridade_confirmada: true, regras_confirmadas: true }
  const opts = { programa: P.PROGRAMA.OPERACAO_COMERCIAL, versaoVigente: '1.0' }
  assert.equal(P.validarAceite(base, opts).ok, true)

  assert.equal(P.validarAceite({ ...base, maioridade_confirmada: false }, opts).recusa,
    P.RECUSAS.MAIORIDADE_NAO_CONFIRMADA)
  assert.equal(P.validarAceite({ ...base, regras_confirmadas: false }, opts).recusa,
    P.RECUSAS.REGRAS_NAO_CONFIRMADAS)
})

test('so o booleano TRUE confirma — string, numero e vazio sao RECUSADOS', () => {
  // `Boolean('false')` é `true`: um formulário mal serializado gravaria o oposto do que a pessoa
  // marcou. Mesma recusa explícita da migration 066 e de `permissoes` (070).
  const opts = { programa: P.PROGRAMA.OPERACAO_COMERCIAL, versaoVigente: '1.0' }
  for (const valor of ['true', 'false', 1, 0, '', 'on', {}, null]) {
    const r = P.validarAceite(
      { termo_versao: '1.0', maioridade_confirmada: valor, regras_confirmadas: true }, opts)
    assert.equal(r.ok, false, `valor ${JSON.stringify(valor)} nao deveria confirmar`)
  }
})

test('versao divergente e RECUSADA: o termo pode ter mudado com a pagina aberta', () => {
  const opts = { programa: P.PROGRAMA.OPERACAO_COMERCIAL, versaoVigente: '2.0' }
  const r = P.validarAceite(
    { termo_versao: '1.0', maioridade_confirmada: true, regras_confirmadas: true }, opts)
  assert.equal(r.recusa, P.RECUSAS.VERSAO_DIVERGENTE)
})

test('a versao GRAVADA e a vigente do servidor, nunca a que veio no corpo', () => {
  const r = P.validarAceite(
    { termo_versao: '1.0', maioridade_confirmada: true, regras_confirmadas: true },
    { programa: P.PROGRAMA.OPERACAO_COMERCIAL, versaoVigente: '1.0' })
  assert.equal(r.dados.termo_versao, '1.0')
  assert.equal(r.dados.maioridade_confirmada, true)
  assert.equal(r.dados.regras_confirmadas, true)
})

test('programa desconhecido e recusado', () => {
  const r = P.validarAceite({ termo_versao: '1.0', maioridade_confirmada: true, regras_confirmadas: true },
    { programa: 'programa_inventado', versaoVigente: '1.0' })
  assert.equal(r.recusa, P.RECUSAS.PROGRAMA_DESCONHECIDO)
})

// ─── O termo ─────────────────────────────────────────────────────────────────────────────

test('o termo tem versao, texto e hash — e o hash bate com o texto', () => {
  const t = TERMO.termoVigente()
  assert.ok(t.versao && typeof t.versao === 'string')
  assert.ok(t.secoes.length >= 3)
  assert.equal(t.hash, TERMO.hashDoTexto(t.texto),
    'o hash precisa ser o do texto que a tela mostra — senao a prova nao prova nada')
  assert.equal(t.hash.length, 64)
})

test('o termo diz o que a Etapa 1 exige que ele diga', () => {
  const texto = TERMO.TEXTO.toLowerCase()
  assert.ok(texto.includes('18 anos'), 'o termo precisa tratar da maioridade')
  assert.ok(/comiss/.test(texto), 'o termo precisa explicar a remuneracao')
  assert.ok(/lead/.test(texto), 'o termo precisa tratar do uso dos dados de leads')
})

// ─── Anti-drift com o schema ─────────────────────────────────────────────────────────────

test('o vocabulario de PROGRAMA espelha a CHECK da migration 084', () => {
  const m = migration.match(/CHECK \(programa IN \(([^)]+)\)\)/)
  assert.ok(m, 'nao achei a CHECK de programa na migration')
  const noSql = m[1].split(',').map((s) => s.trim().replace(/'/g, '')).sort()
  assert.deepEqual(noSql, [...P.PROGRAMAS].sort(),
    'services/programa-aceite.js e a migration 084 divergiram sobre os programas validos')
})

test('o BANCO recusa aceite parcial — a garantia nao e so da rota', () => {
  // Se um caminho futuro esquecer a validação, o INSERT falha em vez de gravar consentimento que
  // não houve.
  assert.match(migration, /CHECK \(maioridade_confirmada = true AND regras_confirmadas = true\)/)
})

test('a migration e ADITIVA: nenhuma tabela existente alterada, nenhum dado mutado', () => {
  assert.ok(!/UPDATE\s+app\./i.test(migration), 'a migration nao pode mutar dado existente')
  assert.ok(!/ALTER TABLE app\.(usuarios|usuarios_empresas|empresas)\b/i.test(migration),
    'a migration nao pode alterar tabelas existentes')
  assert.ok(!/INSERT INTO app\.programa_aceites/i.test(migration),
    'NAO existe backfill de aceite: inserir um seria afirmar que alguem leu um texto que nunca viu')
})

test('a idempotencia e do BANCO, por (empresa, pessoa, programa, VERSAO)', () => {
  assert.match(migration,
    /CREATE UNIQUE INDEX[\s\S]*programa_aceites[\s\S]*\(empresa_id, usuario_id, programa, termo_versao\)/)
})

// ─── Guardas de regressão: o gate ────────────────────────────────────────────────────────

test('o gate vive em requireEmpresaAccess, que roda em TODO request com escopo de empresa', () => {
  const src = fonte('src/middleware/tenant.js')
  assert.ok(src.includes('ACEITE_PENDENTE'),
    'o bloqueio precisa ter codigo PROPRIO: a tela distingue "sem permissao" de "falta aceitar"')
  assert.ok(src.includes('avaliarAcessoPrograma'), 'quem decide e o modulo puro')
  assert.ok(src.includes('req.aceitePrograma'), 'o veredito precisa ser publicado no request')
  assert.ok(!/papel(Empresa)?\s*===\s*'(comercial|member|owner)'/.test(src),
    'o middleware nao pode comparar papel com literal — quem sabe quem e sujeito e o modulo puro')
})

test('EXISTE UMA UNICA excecao ao gate, e ela e a rota do proprio aceite', () => {
  // Um bloqueio sem maçaneta seria um lockout. Uma exceção nomeada e CONTADA não é uma porta
  // aberta — duas seriam.
  // Só CÓDIGO conta: a linha de comentário que explica a exceção no index.js cita o nome de
  // propósito, e uma guarda que a acusasse estaria medindo texto, não comportamento.
  const usosNoMount = fonte('index.js').split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .filter((l) => l.includes('app.use(') && l.includes('requireEmpresaAccessSemAceite'))
  assert.deepEqual(usosNoMount, [],
    'o mount nao deve passar a variante inline — ela vive DENTRO de src/routes/api-programa.js')

  const arquivos = fs.readdirSync(path.join(SRC, 'routes'))
    .filter((f) => f.endsWith('.js'))
    .filter((f) => fs.readFileSync(path.join(SRC, 'routes', f), 'utf8').includes('requireEmpresaAccessSemAceite'))
  assert.deepEqual(arquivos, ['api-programa.js'],
    'so o router do aceite pode dispensar o gate do aceite')
})

test('o router do aceite continua exigindo sessao e vinculo com a empresa', () => {
  const src = fonte('src/routes/api-programa.js')
  assert.ok(/router\.use\(requireAuth, requireEmpresaAccessSemAceite\)/.test(src),
    'dispensar o ACEITE nao pode dispensar a AUTENTICACAO nem o vinculo')
  assert.ok(!src.includes('requireCapacidade'),
    'ler o proprio termo nao pode depender de capacidade — seria impedir alguem de entrar no programa que veio cumprir')
  assert.ok(!/router\.(delete|put)\(/.test(src),
    'o registro e append-only: nao ha revogacao de aceite por rota')
})

test('o mount do programa existe e aponta para o router do aceite', () => {
  const index = fonte('index.js')
  assert.ok(index.includes("app.use('/api/empresas/:empresaId/programa', require('./src/routes/api-programa'))"),
    'o mount do programa sumiu ou mudou de forma')
})

// ─── Guardas de regressão: o vocabulário ─────────────────────────────────────────────────

test('NINGUEM em src/** compara `programa` com literal fora do modulo puro', () => {
  const ofensores = []
  const dono = path.join(SRC, 'services', 'programa-aceite.js')
  const varrer = (dir) => {
    for (const nome of fs.readdirSync(dir)) {
      const p = path.join(dir, nome)
      const st = fs.statSync(p)
      if (st.isDirectory()) { varrer(p); continue }
      if (!nome.endsWith('.js') || p === dono) continue
      const src = fs.readFileSync(p, 'utf8')
      // O literal só é aceitável na migration e no módulo dono. Aqui procura-se a COMPARAÇÃO.
      if (/===\s*'operacao_comercial'|'operacao_comercial'\s*===/.test(src)) {
        ofensores.push(path.relative(SRC, p))
      }
    }
  }
  varrer(SRC)
  assert.deepEqual(ofensores, [], 'use PROGRAMA.OPERACAO_COMERCIAL de services/programa-aceite.js')
})

test('o aceite NAO virou capacidade — nao existe "dispensa de termo" concedivel', () => {
  // Aceite como capacidade deixaria um admin dispensar, pela concessão aditiva de
  // `usuarios_empresas.permissoes`, justamente o consentimento que o programa existe para colher.
  const caps = fonte('src/services/acesso-capacidades.js')
  assert.ok(!/aceite|termo|programa_/i.test(caps.replace(/\/\/.*$/gm, '')),
    'acesso-capacidades.js nao pode ganhar capacidade de aceite/termo')
})

test('o modulo do programa e PURO: sem banco, sem HTTP, sem IA, sem rede', () => {
  const src = fonte('src/services/programa-aceite.js')
  for (const proibido of ['require(', 'pool', 'fetch(', 'axios', 'anthropic', 'openai']) {
    assert.ok(!src.includes(proibido), `programa-aceite.js nao pode conter '${proibido}'`)
  }
})

test('o aceite NAO custa consulta extra: vem no mesmo SELECT do vinculo', () => {
  // Este SELECT roda em TODO request com escopo de empresa. Uma segunda consulta dobraria a ida
  // ao banco de cada request autenticado para ler um dado que está a um LATERAL de distância.
  const src = fonte('src/db/empresas.js')
  assert.ok(/LEFT JOIN LATERAL[\s\S]*app\.programa_aceites/.test(src),
    'buscarVinculoUsuarioEmpresa precisa trazer o ultimo aceite junto')
  assert.ok(!src.includes("'operacao_comercial'"), 'o programa vem da constante, nao do literal')
})

test('a camada de dados e APPEND-ONLY: nao existe UPDATE nem DELETE de aceite', () => {
  const src = fonte('src/db/programa-aceite.js')
  assert.ok(!/UPDATE\s+app\.programa_aceites/i.test(src))
  assert.ok(!/DELETE\s+FROM\s+app\.programa_aceites/i.test(src))
  assert.ok(src.includes('ON CONFLICT'), 'o reenvio precisa ser idempotente, nao um segundo consentimento')
  assert.ok(src.includes('auditoria_eventos'), 'o aceite precisa deixar rastro de auditoria')
})

test('a auditoria do aceite nao carrega PII', () => {
  const src = fonte('src/db/programa-aceite.js')
  for (const proibido of ['email', 'telefone', 'nome', 'senha', 'password']) {
    assert.ok(!new RegExp(`${proibido}`, 'i').test(src.replace(/\/\/.*$/gm, '')),
      `a auditoria do aceite nao pode citar '${proibido}'`)
  }
})

test('o HASH gravado e o do servidor, nunca o que veio no corpo', () => {
  // Aceitar um hash enviado pelo cliente deixaria o registro afirmar que a pessoa concordou com
  // um texto que o sistema nunca viu — a prova viraria ficção.
  const src = fonte('src/routes/api-programa.js')
  assert.ok(src.includes('termo_hash: HASH'), 'o hash precisa vir de programa-termo.js')
  assert.ok(!/body[\s\S]{0,40}termo_hash/.test(src), 'o hash nao pode vir do corpo da requisicao')
})
