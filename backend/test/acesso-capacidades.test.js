'use strict'
// CRM em EQUIPE — Etapa 1. Regra PURA de autorização + guardas de regressão que leem o fonte.
// Ver docs/plano-execucao-crm-equipe.md (Etapa 1) e docs/especificacao-crm-equipe.md (§3).
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const A = require('../src/services/acesso-capacidades')
const { CAPACIDADES: C, MOTIVOS, PAPEIS } = A

const SRC = path.join(__dirname, '..', 'src')
const fonte = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')

// Varre src/** e devolve os caminhos dos .js (para as guardas de regressão).
function todosOsFontes(dir = SRC, saida = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) todosOsFontes(p, saida)
    else if (entry.name.endsWith('.js')) saida.push(p)
  }
  return saida
}

const vinculo = (papel, permissoes = null) => ({ papel, permissoes, papelPlataforma: 'user' })

// ─── Vocabulário ─────────────────────────────────────────────────────────────────────

test('PAPEIS tem exatamente os 2 papeis de empresa, e superadmin NAO e um deles', () => {
  assert.deepEqual([...PAPEIS], ['owner', 'comercial'])
  // superadmin e' papel de PLATAFORMA (app.usuarios.role). Se ele entrar aqui, alguem vai
  // gravá-lo em app.usuarios_empresas.role e a CHECK da migration 101 recusa.
  assert.ok(!PAPEIS.includes('superadmin'))
  assert.equal(A.PAPEL_PLATAFORMA, 'superadmin')
})

test('a matriz cobre todos os papeis e so' + ' capacidades conhecidas', () => {
  assert.deepEqual(Object.keys(A.MATRIZ).sort(), [...PAPEIS].sort())
  for (const [papel, caps] of Object.entries(A.MATRIZ)) {
    for (const c of caps) {
      assert.ok(A.capacidadeConhecida(c), `${papel}: capacidade fora do vocabulario: ${c}`)
    }
  }
})

// ─── O gating de HOJE, reproduzido ────────────────────────────────────────────────────

test('owner alcanca TODAS as capacidades de empresa', () => {
  for (const c of A.TODAS_CAPACIDADES) {
    assert.ok(A.podeCapacidade(vinculo('owner'), c), `owner deveria alcancar ${c}`)
  }
  // Owner ja tem tudo; nao ha capacidade extra para conceder.
  assert.deepEqual(A.concedeveisPara('owner'), [])
})

test('comercial: alcanca o TRABALHO e nao alcanca a COLETA nem a administracao', () => {
  const v = vinculo('comercial')
  for (const c of [
    C.LEAD_VER_APROVADOS, C.LEAD_ASSUMIR, C.LEAD_ABORDAR_MANUAL, C.CONVERSA_ATENDER,
    C.LEAD_DISPARAR_SEMI, C.LIGACAO_OPERAR, C.FOLLOWUP_OPERAR, C.ROTEIRO_LER,
    C.AGENDA_OPERAR_PROPRIA, C.INSTANCIA_GERENCIAR_PROPRIA,
  ]) assert.ok(A.podeCapacidade(v, c), `comercial deveria alcancar ${c}`)

  // O caso NEGATIVO e' o que da valor ao papel. Sem ele, este teste e um "confie em mim".
  for (const c of [
    C.AQUISICAO_GERENCIAR,   // coleta paga (Bright Data)
    C.LEAD_TRIAR,            // a porta de qualificacao
    C.LEAD_VER_BRUTOS,       // a base inteira
    C.LEAD_DISPARAR_LOTE,    // teto diario + reputacao do numero
    C.LEAD_TRANSFERIR,
    C.CONVERSA_VER_TODAS,
    C.CONVERSA_GERENCIAR_IA, // a capacidade sensivel que motivou este trabalho
    C.CONVERSA_APAGAR_HISTORICO,
    C.LIGACAO_VER_TODAS,
    C.CAMPANHA_GERENCIAR,
    C.FOLLOWUP_VER_FILA,
    C.FOLLOWUP_REATRIBUIR,
    C.FOLLOWUP_CONFIG_EMPRESA,
    C.ROTEIRO_GERENCIAR,
    C.AGENDA_VER_EQUIPE,
    C.INSTANCIA_GERENCIAR_EMPRESA,
    C.INSTANCIA_GERENCIAR_CONTEXTO,
    C.MEMBROS_GERENCIAR,
    C.INTEGRACOES_GERENCIAR,
    C.RELATORIOS_VER,
  ]) assert.ok(!A.podeCapacidade(v, c), `comercial NAO deveria alcancar ${c}`)
})

// ─── Superadmin, ausência de vínculo, capacidade desconhecida ─────────────────────────

test('superadmin passa em tudo mesmo SEM vinculo, e o motivo diz que foi por plataforma', () => {
  const sa = { papel: null, permissoes: null, papelPlataforma: 'superadmin' }
  for (const c of A.TODAS_CAPACIDADES) assert.ok(A.podeCapacidade(sa, c))
  assert.equal(A.avaliarCapacidade(sa, C.MEMBROS_GERENCIAR).motivo, MOTIVOS.PLATAFORMA)
  assert.deepEqual(A.capacidadesDoVinculo(sa), [...A.TODAS_CAPACIDADES])
})

test('sem vinculo NAO cai no papel global: papel null nega tudo', () => {
  // E' o defeito que a Etapa 1 corrige. `admin` GLOBAL sem vinculo nesta empresa nao passa.
  const adminGlobalSemVinculo = { papel: null, permissoes: null, papelPlataforma: 'admin' }
  for (const c of A.TODAS_CAPACIDADES) {
    assert.ok(!A.podeCapacidade(adminGlobalSemVinculo, c), `deveria negar ${c}`)
  }
  assert.equal(A.avaliarCapacidade(adminGlobalSemVinculo, C.LEAD_TRIAR).motivo, MOTIVOS.SEM_VINCULO)
  assert.deepEqual(A.capacidadesDoVinculo(adminGlobalSemVinculo), [])
})

test('papel desconhecido nega (enum novo escrito errado nao vira porta aberta)', () => {
  assert.ok(!A.podeCapacidade(vinculo('gerente'), C.CONVERSA_ATENDER))
  assert.ok(!A.podeCapacidade(vinculo('admin'), C.CONVERSA_ATENDER))
  assert.ok(!A.podeCapacidade(vinculo('member'), C.CONVERSA_ATENDER))
  assert.ok(!A.papelConhecido('gerente'))
  assert.ok(!A.papelConhecido('admin'))
  assert.ok(!A.papelConhecido('member'))
  assert.ok(!A.papelConhecido(null))
  assert.ok(!A.papelConhecido(42))
})

test('capacidade desconhecida nega, com motivo proprio (nao se confunde com falta de papel)', () => {
  const r = A.avaliarCapacidade(vinculo('owner'), 'inventada_agora')
  assert.equal(r.permitido, false)
  assert.equal(r.motivo, MOTIVOS.CAPACIDADE_DESCONHECIDA)
  // owner alcanca tudo que EXISTE — o que nao existe continua negado.
  assert.ok(!A.capacidadeConhecida('inventada_agora'))
})

test('avaliar sem vinculo algum (null/undefined) nao lanca', () => {
  assert.equal(A.avaliarCapacidade(null, C.CONVERSA_ATENDER).permitido, false)
  assert.equal(A.avaliarCapacidade(undefined, C.CONVERSA_ATENDER).permitido, false)
  assert.deepEqual(A.capacidadesDoVinculo(null), [])
})

// ─── Concessões: SOMENTE ADITIVAS ────────────────────────────────────────────────────

test('concessao LIBERA o que o papel nao alcanca, e o motivo distingue papel de concessao', () => {
  const v = vinculo('comercial', { [C.CONVERSA_GERENCIAR_IA]: true })
  const r = A.avaliarCapacidade(v, C.CONVERSA_GERENCIAR_IA)
  assert.equal(r.permitido, true)
  assert.equal(r.motivo, MOTIVOS.CONCESSAO)
  // O que o papel ja permitia continua vindo pelo PAPEL, nao pela concessao.
  assert.equal(A.avaliarCapacidade(v, C.LIGACAO_OPERAR).motivo, MOTIVOS.PAPEL)
})

test('concessao NUNCA NEGA o que o papel permite — a regra dura deste modulo', () => {
  // Se `false` negasse, nasceria o estado "o papel diz sim, o override diz nao", e a resposta a
  // "por que ele nao consegue?" deixaria de ser derivavel do papel. Negar = trocar o papel.
  const v = vinculo('comercial', { [C.LIGACAO_OPERAR]: false })
  assert.ok(A.podeCapacidade(v, C.LIGACAO_OPERAR))
  const owner = vinculo('owner', { [C.AQUISICAO_GERENCIAR]: false, [C.MEMBROS_GERENCIAR]: false })
  assert.ok(A.podeCapacidade(owner, C.AQUISICAO_GERENCIAR))
  assert.ok(A.podeCapacidade(owner, C.MEMBROS_GERENCIAR))
})

test('so o booleano `true` concede — string, numero e objeto nao', () => {
  // `Boolean('false')` e' `true`: aceitar valor nao-booleano aqui concederia o oposto do pedido.
  // Mesma recusa explicita que a rota de disponibilidade de canal (migration 066) precisou fazer.
  for (const valor of ['true', 'false', 1, 0, '', 'sim', {}, [], null, undefined]) {
    const v = vinculo('comercial', { [C.MEMBROS_GERENCIAR]: valor })
    assert.ok(!A.podeCapacidade(v, C.MEMBROS_GERENCIAR), `valor ${JSON.stringify(valor)} nao deveria conceder`)
  }
})

test('chave desconhecida em permissoes e IGNORADA (typo nao abre porta e nao quebra)', () => {
  const v = vinculo('comercial', { capacidade_que_nao_existe: true, 'lead_triar ': true })
  assert.deepEqual(A.concessoesDe(v.permissoes), [])
  assert.ok(!A.podeCapacidade(v, C.LEAD_TRIAR))
  assert.ok(A.podeCapacidade(v, C.LIGACAO_OPERAR)) // o resto continua funcionando
})

test('permissoes malformado nao lanca', () => {
  for (const p of [null, undefined, 'x', 7, [], [C.LEAD_TRIAR]]) {
    assert.deepEqual(A.concessoesDe(p), [], `permissoes ${JSON.stringify(p)}`)
  }
})

// ─── Derivados usados pelas telas/rotas ──────────────────────────────────────────────

test('capacidadesDoVinculo soma papel + concessoes, sem duplicar, em ordem estavel', () => {
  const v = vinculo('comercial', { [C.RELATORIOS_VER]: true, [C.LIGACAO_OPERAR]: true })
  const caps = A.capacidadesDoVinculo(v)
  assert.equal(new Set(caps).size, caps.length, 'nao deve duplicar')
  assert.ok(caps.includes(C.RELATORIOS_VER))
  assert.ok(caps.includes(C.LIGACAO_OPERAR))
  // Ordem estavel = a de TODAS_CAPACIDADES (a tela lista sempre igual entre requests).
  assert.deepEqual(caps, A.TODAS_CAPACIDADES.filter((c) => caps.includes(c)))
})

test('concedeveisPara devolve o COMPLEMENTO do papel (o que a tela pode oferecer)', () => {
  const conc = A.concedeveisPara('comercial')
  assert.ok(conc.includes(C.CONVERSA_GERENCIAR_IA))
  assert.ok(conc.includes(C.AGENDA_VER_EQUIPE))
  assert.ok(!conc.includes(C.LIGACAO_OPERAR), 'nao se oferece o que o papel ja tem')
  assert.deepEqual(A.concedeveisPara('desconhecido'), [])
  assert.deepEqual(A.concedeveisPara(null), [])
  // Papel + concedeveis = o vocabulario inteiro, sempre.
  assert.equal(A.MATRIZ.comercial.length + conc.length, A.TODAS_CAPACIDADES.length)
})

// ─── Guardas de regressão (leem o fonte) ─────────────────────────────────────────────

test('o modulo e PURO: sem banco, sem HTTP, sem IA, sem rede', () => {
  const src = fonte(path.join('services', 'acesso-capacidades.js'))
  for (const proibido of ['require(', 'pool', 'fetch(', 'axios', 'process.env']) {
    assert.ok(!src.includes(proibido), `acesso-capacidades.js nao pode conter '${proibido}'`)
  }
})

test('NINGUEM em src/** compara papel de empresa com literal fora deste modulo', () => {
  // E' o que impede a matriz de virar ficcao: um `if (papel === 'comercial')` espalhado pelas
  // rotas divergiria da matriz no primeiro ajuste, em silencio.
  const permitidos = new Set([
    path.join(SRC, 'services', 'acesso-capacidades.js'), // o dono do vocabulario
  ])
  const padroes = [
    /papelEmpresa\s*===?\s*['"]/,
    /['"]comercial['"]\s*===?\s*/,
    /papel\s*===?\s*['"](owner|comercial)['"]/,
  ]
  const ofensores = []
  for (const arquivo of todosOsFontes()) {
    if (permitidos.has(arquivo)) continue
    const src = fs.readFileSync(arquivo, 'utf8')
    if (padroes.some((p) => p.test(src))) ofensores.push(path.relative(SRC, arquivo))
  }
  assert.deepEqual(ofensores, [],
    'compare papel via podeCapacidade()/CAPACIDADES de services/acesso-capacidades.js')
})

test('o middleware resolve o papel pelo VINCULO, nunca pelo papel global', () => {
  const src = fonte(path.join('middleware', 'tenant.js'))
  // requireEmpresaAccess precisa ler o vinculo e publicar o papel efetivo.
  assert.ok(src.includes('buscarVinculoUsuarioEmpresa'), 'deve buscar o vinculo da empresa')
  assert.ok(src.includes('req.papelEmpresa'), 'deve publicar req.papelEmpresa')
  assert.ok(src.includes('req.capacidades'), 'deve publicar req.capacidades')
  // O unico uso legitimo de req.usuario.role e' a comparacao com superadmin (plataforma) —
  // e ela passa pela constante, nao pelo literal.
  assert.ok(src.includes('PAPEL_PLATAFORMA'), 'superadmin deve vir da constante do modulo puro')
  // requireCapacidade NAO pode cair no papel global quando falta empresa resolvida: isso
  // reintroduziria o defeito (papel global valendo dentro de qualquer empresa).
  assert.ok(src.includes('ACESSO_MAL_CONFIGURADO'),
    'requireCapacidade sem requireEmpresaAccess antes deve falhar, nunca liberar')
})

test('TODA rota autorizada por capacidade esta coberta pela suite de AUTORIZACAO POR ROTA', () => {
  // SUBSTITUI a guarda original da Etapa 1 ("requireCapacidade nasce sem consumidor"), que caiu
  // quando a Etapa 2 deu a ele o primeiro chamador — exatamente o sinal que ela existia para dar.
  //
  // O que esta no lugar dela e' mais forte e serve a Etapa 6 inteira: uma rota nao pode ser
  // autorizada por capacidade sem estar declarada na tabela ROTAS_POR_CAPACIDADE de
  // test/membros.test.js, que exercita os papeis contra ela. Sem isto, a matriz de
  // docs/especificacao-crm-equipe.md §3 passaria a valer sem ninguem verificar rota por rota —
  // o risco alto declarado daquela etapa.
  //
  // Procura a CHAMADA (`requireCapacidade(`), nao a mencao: os modulos desta etapa citam o nome
  // em comentario de proposito, e um comentario nao e' um consumidor.
  const consumidores = []
  for (const arquivo of todosOsFontes()) {
    if (arquivo.endsWith(path.join('middleware', 'tenant.js'))) continue
    if (fs.readFileSync(arquivo, 'utf8').includes('requireCapacidade(')) {
      consumidores.push(path.relative(SRC, arquivo).replace(/\\/g, '/'))
    }
  }
  // O index.js tambem pode aplicar a capacidade no mount, como faz com requireRole hoje.
  const indexJs = fs.readFileSync(path.join(SRC, '..', 'index.js'), 'utf8')
  // A tabela MUDOU DE ARQUIVO na Etapa 6: nasceu em membros.test.js como semente e virou
  // autorizacao-rotas.test.js quando 15 mounts passaram a depender dela.
  const suite = fs.readFileSync(path.join(__dirname, 'autorizacao-rotas.test.js'), 'utf8')

  assert.ok(/const ROTAS_POR_CAPACIDADE = \[/.test(suite),
    'a suite de autorizacao por rota (ROTAS_POR_CAPACIDADE em test/autorizacao-rotas.test.js) desapareceu')

  for (const arquivo of consumidores) {
    // Cada router que se autoriza por capacidade precisa estar montado no index.js...
    const nomeModulo = arquivo.replace(/^routes\//, '').replace(/\.js$/, '')
    assert.ok(indexJs.includes(nomeModulo),
      `${arquivo} usa requireCapacidade mas nao esta montado no index.js`)
    // ...e o mount precisa aparecer na tabela que exercita os papeis.
    const mount = indexJs.split('\n')
      .find((l) => l.includes(nomeModulo) && l.includes('app.use('))
      ?.match(/'([^']+)'/)?.[1]
    assert.ok(mount, `nao achei o mount de ${arquivo} no index.js`)
    assert.ok(suite.includes(mount),
      `o mount ${mount} (${arquivo}) nao esta em ROTAS_POR_CAPACIDADE de test/membros.test.js — ` +
      'toda rota autorizada por capacidade precisa ser exercitada contra os papeis de empresa')
  }
})

test('usuarioPertenceAEmpresa foi SUBSTITUIDO — nao deve voltar a existir', () => {
  // Ela devolvia so um booleano e descartava o papel. Se voltar, alguem vai resolver acesso sem
  // o papel efetivo de novo.
  const ofensores = todosOsFontes()
    .filter((a) => fs.readFileSync(a, 'utf8').includes('usuarioPertenceAEmpresa('))
    .map((a) => path.relative(SRC, a))
  assert.deepEqual(ofensores, [], 'use buscarVinculoUsuarioEmpresa (devolve o papel)')
})
