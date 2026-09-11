'use strict'
// Permissão de IA (CRM em equipe, Etapa 9) — a capacidade sensível que motivou este projeto.
//
// A permissão NÃO é "a IA pode responder": essa capacidade já existia, com a granularidade certa
// (`vendas.conversas.modo_ia`, migration 063, com gate nos dois enviadores). O que esta etapa
// controla é **quem pode LIGAR a IA** — mudar o modo para `conversa` e ativar a instância.
//
// A suíte é toda de guardas porque a promessa é negativa: nenhum motor de IA foi alterado, e é
// isso que precisa continuar verdadeiro.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const { requireCapacidade } = require('../src/middleware/tenant')
const { CAPACIDADES: C } = require('../src/services/acesso-capacidades')

const RAIZ = path.join(__dirname, '..')
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8')
const semComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

const conversas = fonte(path.join('src', 'routes', 'api-conversas.js'))
const whatsapp = fonte(path.join('src', 'routes', 'api-whatsapp.js'))

function rodar(mw, req) {
  const res = { statusCode: null, corpo: null }
  res.status = (s) => { res.statusCode = s; return res }
  res.json = (c) => { res.corpo = c; return res }
  let chamouNext = false
  mw(req, res, () => { chamouNext = true })
  return { chamouNext, statusCode: res.statusCode }
}
const reqDe = (papel, permissoes = null) => ({
  usuario: { id: 'u1', role: 'user' },
  empresa: { id: 'e1' },
  papelEmpresa: papel,
  vinculoEmpresa: papel ? { id: 'v1', role: papel, permissoes } : null,
  originalUrl: '/x',
})

// ─── A capacidade ────────────────────────────────────────────────────────────────────────

test('CONVERSA_GERENCIAR_IA e bloqueada por padrao para comercial E member', () => {
  const mw = requireCapacidade(C.CONVERSA_GERENCIAR_IA)
  assert.equal(rodar(mw, reqDe('comercial')).chamouNext, false)
  assert.equal(rodar(mw, reqDe('member')).chamouNext, false)
  assert.equal(rodar(mw, reqDe('owner')).chamouNext, true)
  assert.equal(rodar(mw, reqDe('admin')).chamouNext, true)
})

test('o admin LIBERA por concessao aditiva, sem trocar o papel', () => {
  // E' o caso de uso que motivou o `permissoes JSONB` da Etapa 1.
  const mw = requireCapacidade(C.CONVERSA_GERENCIAR_IA)
  const req = reqDe('comercial', { [C.CONVERSA_GERENCIAR_IA]: true })
  assert.equal(rodar(mw, req).chamouNext, true)
  // E a concessao libera SO' essa: nao promove o vendedor a admin.
  assert.equal(rodar(requireCapacidade(C.MEMBROS_GERENCIAR), req).chamouNext, false)
  assert.equal(rodar(requireCapacidade(C.AQUISICAO_GERENCIAR), req).chamouNext, false)
})

// ─── As rotas que ligam a IA ─────────────────────────────────────────────────────────────

test('as DUAS rotas que ligam/desligam a IA exigem a capacidade', () => {
  // `modo_ia` e a pausa do agente diferem em DURACAO (decisao persistente vs pausa operacional),
  // nao em efeito sobre o cliente. Deixar uma sem gate tornaria a outra decorativa.
  for (const alvo of ['/:numero/modo-ia', '/:numero/agente']) {
    const linha = conversas.split('\n').find((l) => l.includes(`'${alvo}'`) && l.includes('router.patch'))
    assert.ok(linha, `nao achei a rota ${alvo}`)
    assert.ok(linha.includes('requireCapacidade(CAP.CONVERSA_GERENCIAR_IA)'), `${alvo} ficou sem gate de IA`)
    const iEmpresa = linha.indexOf('requireEmpresaAccess')
    const iCap = linha.indexOf('requireCapacidade')
    assert.ok(iEmpresa > 0 && iEmpresa < iCap, `${alvo}: ordem errada dos middlewares`)
  }
})

test('apagar historico exige capacidade propria (destrutivo e irreversivel)', () => {
  const linha = conversas.split('\n').find((l) => l.includes("'/:numero/historico'") && l.includes('router.delete'))
  assert.ok(linha, 'a rota de apagar historico sumiu')
  assert.ok(linha.includes('requireCapacidade(CAP.CONVERSA_APAGAR_HISTORICO)'))
})

test('ATIVAR instancia exige a capacidade de IA; o resto do PATCH nao', () => {
  // Exigir a capacidade de IA para renomear a propria instancia tiraria do vendedor a configuracao
  // que e' legitimamente dele. Por isso o gate de `ativo` e' CONDICIONAL, dentro da rota.
  const i = whatsapp.indexOf("router.patch('/:instanceId'")
  assert.ok(i > 0)
  const bloco = whatsapp.slice(i, i + 1800)
  assert.ok(bloco.includes('requireCapacidade(CAP.INSTANCIA_GERENCIAR_PROPRIA)'), 'o PATCH precisa do gate base')
  assert.ok(/typeof req\.body\?\.ativo === 'boolean'[\s\S]{0,300}CONVERSA_GERENCIAR_IA/.test(bloco),
    'mexer em `ativo` precisa exigir a capacidade de IA')
  assert.ok(/status\(403\)/.test(bloco), 'a recusa precisa ser 403 explicito')
})

// ─── Decisão E: a instância nasce inativa ────────────────────────────────────────────────

test('instancia criada por quem NAO pode ligar a IA nasce INATIVA, com aviso', () => {
  assert.ok(whatsapp.includes('nasceAtiva'), 'a decisao E desapareceu da criacao')
  const i = whatsapp.indexOf('const nasceAtiva')
  const bloco = whatsapp.slice(i, i + 600)
  assert.ok(bloco.includes('CONVERSA_GERENCIAR_IA'), 'nasceAtiva precisa vir da capacidade de IA')
  // A coluna `ativo` tem de entrar no INSERT — sem ela o DEFAULT (true) venceria.
  const iIns = whatsapp.indexOf('INSERT INTO app.empresa_whatsapp_instances')
  const insert = whatsapp.slice(iIns, iIns + 900)
  assert.ok(/usuario_id, criado_por, ativo/.test(insert), 'ativo precisa estar no INSERT')
  assert.ok(insert.includes('nasceAtiva'), 'o valor de ativo vem de nasceAtiva')
  // Numero mudo sem explicacao seria pior que a restricao.
  assert.ok(whatsapp.includes('aviso_ativacao'), 'a tela precisa receber a explicacao')
})

// ─── A promessa negativa: nenhum motor de IA foi tocado ──────────────────────────────────

test('GUARDA: nenhum motor de IA conhece capacidade ou papel', () => {
  // O gate vive na ROTA. Os enviadores continuam decidindo pelo `modo_ia` gravado — e o AGENTS.md
  // proibe `modo_ia` reaparecer no webhook-handler.
  for (const rel of [
    path.join('src', 'core-funnel.js'),
    path.join('src', 'services', 'contexto2-responder.js'),
    path.join('src', 'webhook-handler.js'),
    path.join('src', 'followup-auto.js'),
    path.join('src', 'followup-execution.js'),
    path.join('src', 'agenda.js'),
  ]) {
    const src = semComentarios(fonte(rel))
    // A guarda nomeia o MODULO de autorizacao, nao a palavra "CAPACIDADES": `core-funnel.js` e
    // `contexto2-responder.js` importam um `CAPACIDADES` legitimo e pre-existente — o de
    // `services/conversa-modo-ia` (analise | resposta_conversacional | follow_up | agenda), que e
    // outro vocabulario, de outro dominio. Proibir a palavra acusaria a migration 063.
    for (const proibido of ['acesso-capacidades', 'requireCapacidade', 'papelEmpresa', 'vinculoEmpresa']) {
      assert.ok(!src.includes(proibido),
        `${rel} nao pode conhecer '${proibido}': autorizacao e da rota, nao do motor de atendimento`)
    }
  }
})

test('GUARDA: o gate de modo_ia nos ENVIADORES continua intacto', () => {
  // A Etapa 9 nao substitui a migration 063: ela decide quem pode MUDAR o modo; o modo continua
  // decidindo o envio, nos dois enviadores.
  for (const rel of [path.join('src', 'core-funnel.js'), path.join('src', 'services', 'contexto2-responder.js')]) {
    const src = fonte(rel)
    assert.ok(/conversa-modo-ia|modoPermite|CAPACIDADES_MODO|capacidadeLiberada/i.test(src),
      `${rel} perdeu o gate de modo_ia`)
  }
})

test('GUARDA: modo_ia continua FORA do webhook-handler', () => {
  // Regra do AGENTS.md: um `return` no webhook desligaria a inteligencia junto com a fala.
  const src = semComentarios(fonte(path.join('src', 'webhook-handler.js')))
  assert.ok(!/modo_ia/.test(src), 'modo_ia nao pode voltar ao webhook-handler')
})

test('GUARDA: a Etapa 9 nao criou variavel de ambiente nem migration', () => {
  const migrations = fs.readdirSync(path.join(RAIZ, 'sql', 'migrations'))
  assert.ok(!migrations.some((m) => /permissao.?ia|modo.?ia.?padrao/i.test(m)),
    'a Etapa 9 nao precisa de migration: usa as colunas e o vocabulario que ja existem')
})
