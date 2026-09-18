'use strict'
// SUÍTE DE AUTORIZAÇÃO POR ROTA — CRM em equipe, Etapa 6.
//
// É o mecanismo que impede a matriz de docs/especificacao-crm-equipe.md §3 de virar ficção.
// A Etapa 6 trocou o gate de 15 mounts: de `requireRole('admin')` (papel GLOBAL, que valia dentro
// de QUALQUER empresa a que a pessoa pertencesse) para `requireCapacidade` sobre o papel do
// VÍNCULO. Errar um mount abre ou fecha um módulo inteiro — por isso cada rota é exercitada
// contra os quatro papéis, e o caso NEGATIVO é obrigatório.
//
// Nasceu como semente dentro de test/membros.test.js (Etapa 2) e virou arquivo próprio quando
// deixou de falar só de membros.
//
// **Ao migrar uma rota nova, acrescente a linha em ROTAS_POR_CAPACIDADE.** A guarda
// "TODA rota autorizada por capacidade está coberta" (test/acesso-capacidades.test.js) falha se
// você esquecer.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const { requireCapacidade } = require('../src/middleware/tenant')
const { CAPACIDADES: C, PAPEIS } = require('../src/services/acesso-capacidades')

const RAIZ = path.join(__dirname, '..')
const fonteIndex = fs.readFileSync(path.join(RAIZ, 'index.js'), 'utf8')
const linhasIndex = fonteIndex.split('\n')
const rota = (arquivo) => fs.readFileSync(path.join(RAIZ, 'src', 'routes', arquivo), 'utf8')

// ─── Exercitar o middleware sem HTTP ─────────────────────────────────────────────────────

function resFalso() {
  const r = { statusCode: null, corpo: null }
  r.status = (s) => { r.statusCode = s; return r }
  r.json = (c) => { r.corpo = c; return r }
  return r
}

function rodar(middleware, req) {
  const res = resFalso()
  let chamouNext = false
  middleware(req, res, () => { chamouNext = true })
  return { chamouNext, statusCode: res.statusCode, code: res.corpo?.error?.code }
}

const reqDe = (papel, { permissoes = null, papelPlataforma = 'user' } = {}) => ({
  usuario: { id: 'u1', role: papelPlataforma },
  empresa: { id: 'e1' },
  papelEmpresa: papel,
  vinculoEmpresa: papel ? { id: 'v1', role: papel, permissoes } : null,
  originalUrl: '/api/empresas/e1/x',
})

// ─── A TABELA ────────────────────────────────────────────────────────────────────────────
// A capacidade de cada mount é a AÇÃO que o módulo representa, nunca "quem é admin".

const ROTAS_POR_CAPACIDADE = [
  // Etapa 2
  { mount: '/api/empresas/:empresaId/membros', capacidade: C.MEMBROS_GERENCIAR, papeisQuePassam: ['owner', 'admin'], noRouter: true },

  // Etapa 6 — gestão da COLETA: custa dinheiro (Bright Data) e decide a carteira.
  { mount: '/api/empresas/:empresaId/prospeccao/rotinas', capacidade: C.AQUISICAO_GERENCIAR, papeisQuePassam: ['owner', 'admin'] },
  { mount: '/api/empresas/:empresaId/prospeccao/curadoria', capacidade: C.LEAD_TRIAR, papeisQuePassam: ['owner', 'admin'] },
  { mount: '/api/empresas/:empresaId/prospeccao/oportunidades', capacidade: C.AQUISICAO_GERENCIAR, papeisQuePassam: ['owner', 'admin'] },
  { mount: '/api/empresas/:empresaId/captacao', capacidade: C.AQUISICAO_GERENCIAR, papeisQuePassam: ['owner', 'admin'] },
  { mount: '/api/empresas/:empresaId/nichos', capacidade: C.ROTEIRO_GERENCIAR, papeisQuePassam: ['owner', 'admin'] },

  // Etapa 7 — a Central de Mensagens autoriza POR ROTA, não no mount: ler/responder é de todos
  // os papéis (inclusive `member`, por compatibilidade), e o que o ownership restringe é o
  // RECORTE. Ver o teste "responder NUNCA é bloqueado" no fim deste arquivo.
  { mount: '/api/empresas/:empresaId/conversas', capacidade: C.CONVERSA_ATENDER, papeisQuePassam: ['owner', 'admin', 'comercial', 'member'], noRouter: true },

  // Etapa 8 — Instâncias: também POR ROTA. Conectar o PRÓPRIO número é do comercial
  // (INSTANCIA_GERENCIAR_PROPRIA); mexer nas instâncias da empresa e no contexto padrão é gestão.
  // O mount fica limpo porque a listagem é recortada por consulta, não por acesso ao módulo.
  { mount: '/api/empresas/:empresaId/whatsapp', capacidade: C.INSTANCIA_GERENCIAR_PROPRIA, papeisQuePassam: ['owner', 'admin', 'comercial', 'member'], noRouter: true },

  // Etapa 6 — o TRABALHO: é o que o comercial alcança.
  { mount: '/api/empresas/:empresaId/banco-leads', capacidade: C.LEAD_VER_APROVADOS, papeisQuePassam: ['owner', 'admin', 'comercial'] },
  { mount: '/api/empresas/:empresaId/follow-ups', capacidade: C.FOLLOWUP_OPERAR, papeisQuePassam: ['owner', 'admin', 'comercial'] },
  { mount: '/api/empresas/:empresaId/roteiros', capacidade: C.ROTEIRO_LER, papeisQuePassam: ['owner', 'admin', 'comercial'] },
  { mount: '/api/empresas/:empresaId/campanhas', capacidade: C.LIGACAO_OPERAR, papeisQuePassam: ['owner', 'admin', 'comercial'] },
  { mount: '/api/empresas/:empresaId/ligacoes', capacidade: C.LIGACAO_OPERAR, papeisQuePassam: ['owner', 'admin', 'comercial'] },

  // Etapa 11 — Agenda: POR ROTA. Usar a própria agenda é de todos; ver a da equipe e marcar
  // compromisso para outra pessoa é gestão (AGENDA_VER_EQUIPE), checado dentro da rota.
  { mount: '/api/empresas/:empresaId/agenda', capacidade: C.AGENDA_OPERAR_PROPRIA, papeisQuePassam: ['owner', 'admin', 'comercial', 'member'], noRouter: true },

  // Etapa 12 — painel da EQUIPE: quem gerencia as contas responde pela distribuição do trabalho.
  { mount: '/api/empresas/:empresaId/equipe', capacidade: C.MEMBROS_GERENCIAR, papeisQuePassam: ['owner', 'admin'], noRouter: true },
  // 2026-09-18 — cadastro de EQUIPES COMERCIAIS por nicho. Equipe e organizacao operacional,
  // nao papel; quem gerencia membros tambem gerencia a distribuicao por equipe.
  { mount: '/api/empresas/:empresaId/equipes-comerciais', capacidade: C.MEMBROS_GERENCIAR, papeisQuePassam: ['owner', 'admin'], noRouter: true },

  // 2026-09-12 — CONHECIMENTO do atendimento. Os 4 routers de contexto estavam montados SEM
  // capacidade nenhuma: qualquer membro (inclusive o `comercial`) criava, editava e excluía
  // contexto, ativava versão e ingeria fonte. Contexto é o que o número da empresa DIZ ao
  // cliente — é decisão da administração.
  { mount: '/api/empresas/:empresaId/contextos', capacidade: C.INSTANCIA_GERENCIAR_CONTEXTO, papeisQuePassam: ['owner', 'admin'] },
  { mount: '/api/empresas/:empresaId/contextos/:contextoId', capacidade: C.INSTANCIA_GERENCIAR_CONTEXTO, papeisQuePassam: ['owner', 'admin'] },
  { mount: '/api/empresas/:empresaId/contextos/:contextoId/fontes', capacidade: C.INSTANCIA_GERENCIAR_CONTEXTO, papeisQuePassam: ['owner', 'admin'] },
  { mount: '/api/empresas/:empresaId/contextos/:contextoId/sugerir-contexto1', capacidade: C.INSTANCIA_GERENCIAR_CONTEXTO, papeisQuePassam: ['owner', 'admin'] },

  // Etapa 6 — credenciais, custo e leitura de gestão.
  { mount: '/api/empresas/:empresaId/relatorios', capacidade: C.RELATORIOS_VER, papeisQuePassam: ['owner', 'admin'] },
  { mount: '/api/empresas/:empresaId/integracoes/meta', capacidade: C.INTEGRACOES_GERENCIAR, papeisQuePassam: ['owner', 'admin'] },
  { mount: '/api/empresas/:empresaId/playbook', capacidade: C.INSTANCIA_GERENCIAR_CONTEXTO, papeisQuePassam: ['owner', 'admin'] },
  { mount: '/api/empresas/:empresaId/llm/uso', capacidade: C.INTEGRACOES_GERENCIAR, papeisQuePassam: ['owner', 'admin'] },

  // 2026-09-18 — COMISSAO. O mount libera a LEITURA (o comercial precisa conferir o proprio
  // dinheiro: programa de comissao que a pessoa nao consegue auditar e promessa sem prova), e
  // cada ESCRITA exige COMISSAO_GERENCIAR por rota — ver ESCRITAS_COM_CAPACIDADE_PROPRIA.
  { mount: '/api/empresas/:empresaId/comissao', capacidade: C.COMISSAO_VER_PROPRIA, papeisQuePassam: ['owner', 'admin', 'comercial'] },

  // 2026-09-18 — MISSAO (Operacao Comercial, Etapa 2). Mesma capacidade da comissao, de
  // proposito: missao com recompensa e' politica de REMUNERACAO, a mesma familia de decisao.
  // Uma capacidade nova sem uma decisao distinta por tras seria coluna de matriz que ninguem
  // valida. O mount libera a LEITURA; publicar e encerrar exigem COMISSAO_GERENCIAR por rota
  // (ver ESCRITAS_COM_CAPACIDADE_PROPRIA).
  { mount: '/api/empresas/:empresaId/missoes', capacidade: C.COMISSAO_VER_PROPRIA, papeisQuePassam: ['owner', 'admin', 'comercial'], noRouter: true },
]

// Rotas de PLATAFORMA: continuam com `requireRole`, de propósito. Não são de uma empresa —
// `/api/admin` é a lista global de contas e a quarentena é justamente o caso em que NÃO se sabe a
// empresa. Trocar por capacidade ali exigiria escolher um tenant, que é o fallback removido pela
// migration 060.
const ROTAS_DE_PLATAFORMA = ['/api/llm', '/api/webhook-quarentena']

// Escritas que o mount NÃO cobre: dentro destes routers há ações que a matriz separa do resto.
// Sem isto, montar `/roteiros` com ROTEIRO_LER deixaria o comercial CRIAR roteiro, e
// `/banco-leads` com LEAD_VER_APROVADOS deixaria ele disparar em lote pela Evolution.
const ESCRITAS_COM_CAPACIDADE_PROPRIA = [
  { arquivo: 'api-roteiros.js', capacidade: 'ROTEIRO_GERENCIAR', minimo: 5 },
  { arquivo: 'api-campanhas.js', capacidade: 'CAMPANHA_GERENCIAR', minimo: 5 },
  { arquivo: 'api-banco-leads.js', capacidade: 'LEAD_DISPARAR_LOTE', minimo: 5 },
  // 2026-09-16 — avaliar o ICP a partir de Detalhes ATRAVESSA A PORTA da triagem: Lead A grava
  // `qualificacao='aprovado'`. O mount so exige LEAD_VER_APROVADOS, que o comercial tem.
  { arquivo: 'api-banco-leads.js', capacidade: 'LEAD_TRIAR', minimo: 1 },
  { arquivo: 'api-follow-ups.js', capacidade: 'FOLLOWUP_CONFIG_EMPRESA', minimo: 1 },
  // 2026-09-18 — quem define quanto se paga nao pode ser quem recebe. Sem este gate por rota, o
  // proprio SDR registraria a venda dele e daria baixa no pagamento.
  { arquivo: 'api-comissao.js', capacidade: 'COMISSAO_GERENCIAR', minimo: 5 },
  // 2026-09-18 — publicar/encerrar um desafio com recompensa e' definir quanto se paga. Sem este
  // gate por rota, o mount (que e' de LEITURA) deixaria o proprio comercial publicar a missao
  // dele e encerrar a que nao lhe convem.
  // 3 desde a Etapa 4: publicar, encerrar e dar BAIXA na recompensa. A baixa e' escrita sobre
  // dinheiro que saiu — com o gate do mount (leitura), o proprio comercial marcaria o premio
  // dele como pago.
  { arquivo: 'api-missoes.js', capacidade: 'COMISSAO_GERENCIAR', minimo: 3 },
]

// ─── Os quatro papéis, contra cada rota ──────────────────────────────────────────────────

test('cada rota autoriza EXATAMENTE os papeis declarados', () => {
  for (const { mount, capacidade, papeisQuePassam } of ROTAS_POR_CAPACIDADE) {
    const mw = requireCapacidade(capacidade)
    for (const papel of PAPEIS) {
      const esperado = papeisQuePassam.includes(papel)
      assert.equal(rodar(mw, reqDe(papel)).chamouNext, esperado,
        `${mount}: papel ${papel} deveria ${esperado ? 'PASSAR' : 'ser RECUSADO'}`)
    }
  }
})

test('superadmin passa em todas; admin GLOBAL sem vinculo NAO passa em nenhuma', () => {
  for (const { mount, capacidade } of ROTAS_POR_CAPACIDADE) {
    const mw = requireCapacidade(capacidade)
    assert.equal(rodar(mw, { ...reqDe(null), usuario: { id: 'u1', role: 'superadmin' } }).chamouNext, true, mount)
    // O defeito que a Etapa 1 corrigiu: papel global valendo dentro de qualquer empresa.
    assert.equal(rodar(mw, { ...reqDe(null), usuario: { id: 'u1', role: 'admin' } }).chamouNext, false, mount)
  }
})

test('o comercial e recusado em TODA capacidade de gestao', () => {
  // O caso negativo da Etapa 6 inteira, em um lugar só.
  for (const cap of [
    C.AQUISICAO_GERENCIAR, C.LEAD_TRIAR, C.LEAD_VER_BRUTOS, C.LEAD_DISPARAR_LOTE,
    C.LEAD_TRANSFERIR, C.CAMPANHA_GERENCIAR, C.ROTEIRO_GERENCIAR, C.FOLLOWUP_CONFIG_EMPRESA,
    C.FOLLOWUP_VER_FILA, C.FOLLOWUP_REATRIBUIR, C.INTEGRACOES_GERENCIAR, C.RELATORIOS_VER, C.MEMBROS_GERENCIAR,
    C.INSTANCIA_GERENCIAR_CONTEXTO, C.INSTANCIA_GERENCIAR_EMPRESA, C.CONVERSA_GERENCIAR_IA,
    C.CONVERSA_APAGAR_HISTORICO, C.CONVERSA_VER_TODAS, C.LIGACAO_VER_TODAS, C.AGENDA_VER_EQUIPE,
  ]) {
    assert.equal(rodar(requireCapacidade(cap), reqDe('comercial')).chamouNext, false, `comercial NAO pode ${cap}`)
    assert.equal(rodar(requireCapacidade(cap), reqDe('owner')).chamouNext, true, `owner precisa poder ${cap}`)
  }
})

test('o comercial PASSA no que e trabalho dele', () => {
  for (const cap of [
    C.LEAD_VER_APROVADOS, C.LEAD_ASSUMIR, C.LEAD_ABORDAR_MANUAL, C.CONVERSA_ATENDER,
    C.LEAD_DISPARAR_SEMI, C.LIGACAO_OPERAR, C.FOLLOWUP_OPERAR, C.ROTEIRO_LER,
    C.AGENDA_OPERAR_PROPRIA, C.INSTANCIA_GERENCIAR_PROPRIA,
  ]) {
    assert.equal(rodar(requireCapacidade(cap), reqDe('comercial')).chamouNext, true, `comercial precisa poder ${cap}`)
  }
})

test('uma CONCESSAO aditiva libera o comercial numa capacidade de gestao', () => {
  const req = reqDe('comercial', { permissoes: { [C.CONVERSA_GERENCIAR_IA]: true } })
  assert.equal(rodar(requireCapacidade(C.CONVERSA_GERENCIAR_IA), req).chamouNext, true)
  // E libera SÓ aquela.
  assert.equal(rodar(requireCapacidade(C.MEMBROS_GERENCIAR), req).chamouNext, false)
})

// ─── O index.js ──────────────────────────────────────────────────────────────────────────

test('o mount declara a capacidade, e na ORDEM certa', () => {
  for (const { mount, capacidade, noRouter } of ROTAS_POR_CAPACIDADE) {
    if (noRouter) continue   // autoriza dentro do próprio router (router.use)
    const linha = fonteIndex.split('\n').find((l) => l.includes(`'${mount}'`) && l.includes('app.use('))
    assert.ok(linha, `nao achei o mount ${mount} no index.js`)
    assert.ok(linha.includes('requireCapacidade'), `${mount} ficou sem requireCapacidade`)
    assert.ok(!linha.includes("requireRole('admin')"), `${mount} ainda usa o papel GLOBAL`)
    // requireCapacidade DEPENDE de requireEmpresaAccess: rodar antes devolve 500
    // ACESSO_MAL_CONFIGURADO e derruba a rota para todo mundo, inclusive o admin.
    const iEmpresa = linha.indexOf('requireEmpresaAccess')
    const iCap = linha.indexOf('requireCapacidade')
    assert.ok(iEmpresa > 0 && iEmpresa < iCap,
      `${mount}: requireEmpresaAccess precisa vir ANTES de requireCapacidade`)
    assert.ok(Object.values(C).includes(capacidade), `${mount}: capacidade fora do vocabulario`)
  }
})

test('as rotas de PLATAFORMA continuam com requireRole', () => {
  for (const mount of ROTAS_DE_PLATAFORMA) {
    const linha = fonteIndex.split('\n').find((l) => l.includes(`'${mount}'`) && l.includes('app.use('))
    assert.ok(linha, `nao achei o mount ${mount}`)
    assert.ok(linha.includes('requireRole('), `${mount} perdeu o gate de plataforma`)
    assert.ok(!linha.includes('requireCapacidade'),
      `${mount} nao deve ser autorizada por capacidade — nao pertence a uma empresa`)
  }
})

test('NENHUM mount de empresa ficou sem gate', () => {
  // A varredura é o que impede uma rota de nascer aberta: todo `app.use` de
  // /api/empresas/:empresaId/... precisa ter gate no mount OU dentro do próprio router.
  const semGate = []
  for (const linha of fonteIndex.split('\n')) {
    const m = linha.match(/app\.use\('(\/api\/empresas\/:empresaId\/[^']*)'/)
    if (!m) continue
    if (linha.includes('requireCapacidade') || linha.includes('requireRole(')) continue
    // O router pode vir inline (`require('./src/routes/x')`) OU por VARIAVEL
    // (`app.use(..., fontesRouter)`), que e como os dois routers de fontes sao montados.
    // Resolver so o caso inline acusaria falso positivo neles.
    let mm = linha.match(/require\('\.\/src\/routes\/([^']+)'\)/)
    if (!mm) {
      const varNome = linha.match(/,\s*([A-Za-z_$][\w$]*)(?:\.[\w$]+)?\s*\)\s*$/)
      if (varNome) {
        const decl = linhasIndex.find((l) =>
          new RegExp(`const ${varNome[1]}\\s*=`).test(l) && l.includes('src/routes/'))
        if (decl) mm = decl.match(/require\('\.\/src\/routes\/([^']+)'\)/)
      }
    }
    if (!mm) { semGate.push(m[1]); continue }
    if (!/requireAuth/.test(rota(`${mm[1]}.js`))) semGate.push(m[1])
  }
  assert.deepEqual(semGate, [], 'estes mounts de empresa nao tem nenhuma autorizacao')
})

test('as ESCRITAS que a matriz separa tem capacidade propria, na ordem certa', () => {
  for (const { arquivo, capacidade, minimo } of ESCRITAS_COM_CAPACIDADE_PROPRIA) {
    const src = rota(arquivo)
    const n = src.split('\n').filter((l) => l.includes('requireCapacidade(') && l.includes(`CAP.${capacidade}`)).length
    assert.ok(n >= minimo, `${arquivo}: esperava >= ${minimo} rotas com ${capacidade}, achei ${n}`)
    for (const linha of src.split('\n')) {
      if (!linha.includes('requireCapacidade(CAP.') || !linha.includes('router.')) continue
      const iEmpresa = linha.indexOf('requireEmpresaAccess')
      const iCap = linha.indexOf('requireCapacidade')
      assert.ok(iEmpresa > 0 && iEmpresa < iCap,
        `${arquivo}: ordem errada em: ${linha.trim().slice(0, 90)}`)
    }
  }
})

test('o comercial nao consegue CRIAR roteiro nem DISPARAR em lote, mesmo alcancando o mount', () => {
  // É a diferença entre alcançar o módulo e poder tudo dentro dele.
  assert.equal(rodar(requireCapacidade(C.ROTEIRO_LER), reqDe('comercial')).chamouNext, true, 'alcanca /roteiros')
  assert.equal(rodar(requireCapacidade(C.ROTEIRO_GERENCIAR), reqDe('comercial')).chamouNext, false, 'mas nao cria')
  assert.equal(rodar(requireCapacidade(C.LEAD_VER_APROVADOS), reqDe('comercial')).chamouNext, true, 'alcanca /banco-leads')
  assert.equal(rodar(requireCapacidade(C.LEAD_DISPARAR_LOTE), reqDe('comercial')).chamouNext, false, 'mas nao dispara em lote')
  assert.equal(rodar(requireCapacidade(C.LIGACAO_OPERAR), reqDe('comercial')).chamouNext, true, 'alcanca /campanhas')
  assert.equal(rodar(requireCapacidade(C.CAMPANHA_GERENCIAR), reqDe('comercial')).chamouNext, false, 'mas nao cria campanha')
})

test('avaliar ICP em Detalhes exige LEAD_TRIAR — o mount de /banco-leads NAO basta', () => {
  // A rota grava `qualificacao='aprovado'` quando da Lead A, que e' a MESMA porta de
  // /prospeccao/curadoria (LEAD_TRIAR). Sob o gate do mount (LEAD_VER_APROVADOS) o comercial
  // aprovaria pelo modal de Detalhes o que a curadoria lhe recusa.
  const src = rota('api-banco-leads.js')
  const linha = src.split('\n').find((l) => l.includes("router.patch('/leads/:id/icp'"))
  assert.ok(linha, 'a rota de avaliacao de ICP sumiu')
  assert.ok(linha.includes('requireCapacidade(CAP.LEAD_TRIAR)'),
    'aprovar lead pelo ICP precisa de LEAD_TRIAR, nunca so do gate do mount')
  assert.equal(rodar(requireCapacidade(C.LEAD_TRIAR), reqDe('comercial')).chamouNext, false,
    'o comercial alcanca /banco-leads mas NAO atravessa a porta da triagem')
  assert.equal(rodar(requireCapacidade(C.LEAD_VER_APROVADOS), reqDe('comercial')).chamouNext, true,
    'e continua alcancando o modulo')
})

test('/conversas autoriza POR ROTA, nao no mount — e o mount continua sem capacidade', () => {
  // A Etapa 6 deliberadamente NÃO migrou `/conversas`: sem o ownership da Etapa 7 o recorte não
  // existiria e o comercial veria a empresa inteira. Na Etapa 7 a rota ganhou capacidade POR ROTA
  // (o mount segue limpo, porque o recorte é por consulta, não por acesso ao módulo).
  const linha = fonteIndex.split('\n').find((l) => l.includes("'/api/empresas/:empresaId/conversas'"))
  assert.ok(linha, 'o mount de /conversas sumiu')
  assert.ok(!linha.includes('requireCapacidade'),
    'o mount de /conversas nao deve gatear por capacidade: quem le e responde e todo membro, e o recorte e por consulta')
  const src = rota('api-conversas.js')
  assert.ok(/requireAuth/.test(src), '/conversas precisa continuar exigindo sessao')
  assert.ok(src.includes('requireCapacidade(CAP.CONVERSA_ATENDER)'), 'assumir/transferir precisam de capacidade')
  assert.ok(src.includes('requireCapacidade(CAP.CONVERSA_VER_TODAS)'), 'a leitura de gestao precisa de capacidade')
})

test('a Central de Mensagens RECORTA a listagem por atendente, na lista E na contagem', () => {
  const src = rota('api-conversas.js')
  assert.ok(src.includes('recorteAtendente'), 'a listagem perdeu o recorte por atendente')
  // O recorte precisa entrar em `conds`, que serve a listagem E o COUNT — dois WHERE separados
  // fariam o rodape contradizer a lista.
  assert.ok(/conds\.push\(recorte\.sql\)/.test(src), 'o recorte precisa ir para as condicoes compartilhadas')
  assert.ok(src.includes('escopo: recorte.efetivo'), 'o escopo efetivo precisa voltar no meta')
})

test('RESPONDER conversa NUNCA e bloqueado por ownership — so avisado', () => {
  // É a regra oposta à do lead, e a mais importante da Etapa 7: travar a resposta no meio de um
  // atendimento deixa o CLIENTE sem resposta porque o sistema decidiu que a pessoa errada estava
  // na tela. Ownership de conversa organiza e dá visibilidade; não bloqueia atendimento.
  const { avaliarResponder } = require('../src/services/conversa-responsavel')
  const minha = avaliarResponder({ responsavel_id: 'u1' }, 'u1')
  assert.equal(minha.permitido, true)
  assert.equal(minha.avisar, false)

  const alheia = avaliarResponder({ responsavel_id: 'u2' }, 'u1')
  assert.equal(alheia.permitido, true, 'responder conversa de outro NAO pode ser bloqueado')
  assert.equal(alheia.avisar, true, 'mas a tela precisa avisar de quem e')

  const semDono = avaliarResponder({ responsavel_id: null }, 'u1')
  assert.equal(semDono.permitido, true)
  assert.equal(semDono.avisar, false)

  // E o envio manual do operador NÃO ganhou gate de ownership.
  const manual = rota('api-conversas.js')
  const i = manual.indexOf("router.post('/:numero/mensagem'")
  assert.ok(i > 0, 'a rota de envio manual sumiu')
  const linha = manual.slice(i, manual.indexOf('\n', i))
  assert.ok(!linha.includes('requireCapacidade'),
    'a rota de envio manual nao pode exigir capacidade de ownership — responder e de quem atende')
})
