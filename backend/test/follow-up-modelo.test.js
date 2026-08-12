'use strict'

// Modelo PURO do follow-up + guardas de regressão sobre o fluxo integrado
// (Central de Ligações ↔ Follow-ups ↔ Central de Mensagens).
//
// O que estes testes protegem, em uma frase: a próxima ação de um contato é uma ENTIDADE com
// canal, prazo, prioridade, responsável, status e origem — e um contato nunca acumula duas
// ações abertas do mesmo canal.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const M = require('../src/services/follow-up-modelo')

const RAIZ = path.join(__dirname, '..')
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8')

const DAQUI_A_UM_DIA = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
const BASE = () => ({
  canal: 'whatsapp',
  origem: 'ligacao',
  proxima_acao: 'Retomar por WhatsApp',
  agendado_para: DAQUI_A_UM_DIA(),
  telefone: '11999990001',
})

// ─── Vocabulário fechado ──────────────────────────────────────────────────────

test('os quatro vocabulários são fechados — a tela não inventa estado', () => {
  assert.deepEqual([...M.FOLLOWUP_CANAL], ['whatsapp', 'ligacao'])
  assert.deepEqual([...M.FOLLOWUP_STATUS], ['aguardando', 'concluido', 'cancelado', 'falha'])
  assert.deepEqual([...M.FOLLOWUP_PRIORIDADE], ['alta', 'media', 'baixa'])
  assert.deepEqual([...M.FOLLOWUP_ORIGEM], ['ligacao', 'mensagem', 'automacao', 'manual'])
})

test('canal decide QUAL tela executa — é a regra de roteamento, num lugar só', () => {
  assert.equal(M.telaExecutora('whatsapp'), 'central_mensagens')
  assert.equal(M.telaExecutora('ligacao'), 'central_ligacoes')
  assert.equal(M.telaExecutora('email'), null)
})

// ─── Identidade do contato ────────────────────────────────────────────────────

test('a identidade é o telefone em dígitos, venha ele de onde vier', () => {
  // O mesmo contato chega como JID (Mensagens), formatado (Ligações) ou cru — e vira o mesmo
  // valor. É isso que liga os dois mundos, que têm chaves incompatíveis entre si.
  const esperado = '5511999990001'
  for (const entrada of ['5511999990001@s.whatsapp.net', '+55 (11) 99999-0001', '5511999990001', '55 11 99999 0001']) {
    assert.equal(M.normalizarTelefoneDigitos(entrada), esperado, `falhou para "${entrada}"`)
  }
})

test('telefone fora de 8..15 dígitos é recusado — item órfão nunca casaria com conversa nenhuma', () => {
  for (const invalido of ['', null, undefined, '1234567', '1'.repeat(16), 'sem numero']) {
    assert.throws(() => M.normalizarTelefoneDigitos(invalido), /telefone invalido/)
  }
  assert.equal(M.telefoneDigitosOuNulo('abc'), null, 'a variante tolerante devolve null, não lança')
  assert.equal(M.telefoneDigitosOuNulo('11999990001'), '11999990001')
})

// ─── Criação ──────────────────────────────────────────────────────────────────

test('criação exige contato, origem e um verbo — rastreabilidade não é opcional', () => {
  assert.throws(() => M.validarNovoFollowUp({ ...BASE(), origem: undefined }), /origem invalida/)
  assert.throws(() => M.validarNovoFollowUp({ ...BASE(), telefone: '' }), /telefone invalido/)
  assert.throws(() => M.validarNovoFollowUp({ ...BASE(), proxima_acao: '   ' }), /proxima_acao e obrigatoria/)
  assert.throws(() => M.validarNovoFollowUp({ ...BASE(), canal: 'email' }), /canal invalido/)
})

test('a empresa NÃO é campo do payload — o tenant vem do chamador autenticado', () => {
  const out = M.validarNovoFollowUp({ ...BASE(), empresa_id: 'outra-empresa' })
  assert.equal('empresa_id' in out, false,
    'aceitar empresa_id do payload deixaria um cliente escolher o tenant')
})

test('prioridade tem default e o vocabulário é respeitado', () => {
  assert.equal(M.validarNovoFollowUp(BASE()).prioridade, 'media')
  assert.equal(M.validarNovoFollowUp({ ...BASE(), prioridade: 'alta' }).prioridade, 'alta')
  assert.throws(() => M.validarNovoFollowUp({ ...BASE(), prioridade: 'urgente' }), /prioridade invalida/)
})

test('agendamento guarda DATA e HORA — não era isso que campanha_leads.data_followup fazia', () => {
  const quando = new Date(Date.now() + 3 * 60 * 60 * 1000)
  const out = M.validarNovoFollowUp({ ...BASE(), agendado_para: quando.toISOString() })
  assert.ok(out.agendado_para instanceof Date)
  assert.equal(out.agendado_para.getTime(), quando.getTime(), 'a hora não pode ser truncada')
})

test('data ausente ou absurda é recusada (guarda contra dedo trocado no seletor)', () => {
  assert.throws(() => M.validarNovoFollowUp({ ...BASE(), agendado_para: '' }), /data e hora .* obrigatorias/)
  assert.throws(() => M.validarNovoFollowUp({ ...BASE(), agendado_para: 'amanhã' }), /invalidas/)
  const daquiA3Anos = new Date(Date.now() + 3 * 365 * 24 * 3600 * 1000).toISOString()
  assert.throws(() => M.validarNovoFollowUp({ ...BASE(), agendado_para: daquiA3Anos }), /muito distante/)
  const haUmAno = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString()
  assert.throws(() => M.validarNovoFollowUp({ ...BASE(), agendado_para: haUmAno }), /muito no passado/)
})

// ─── Ciclo de vida ────────────────────────────────────────────────────────────

test('só `aguardando` é estado vivo; os outros três são terminais', () => {
  for (const destino of ['concluido', 'cancelado', 'falha']) {
    assert.equal(M.transicaoStatusValida('aguardando', destino), true)
  }
  for (const terminal of ['concluido', 'cancelado', 'falha']) {
    for (const destino of M.FOLLOWUP_STATUS) {
      assert.equal(M.transicaoStatusValida(terminal, destino), false,
        `${terminal} não pode virar ${destino}: reabrir apagaria o fato de que a ação terminou`)
    }
  }
  assert.equal(M.estaAberto('aguardando'), true)
  assert.equal(M.estaAberto('concluido'), false)
})

test('repetir a mesma transição é idempotente, não erro', () => {
  const out = M.validarMudancaStatus('concluido', { status: 'concluido' })
  assert.equal(out.idempotente, true, 'duplo clique não pode virar 400 nem mover a hora do fim')
})

test('falha NUNCA pode ser apresentada como aguardando', () => {
  // A separação existe porque falha é diagnóstico: dizer "aguardando" esconderia que
  // ninguém vai agir sozinho ali. É a mesma regra que `lib/followups-fila.js` já aplica.
  assert.notEqual('falha', 'aguardando')
  assert.equal(M.estaAberto('falha'), false)
})

// ─── Reagendamento ────────────────────────────────────────────────────────────

test('reagendar move o MESMO item — não é cancelar e criar outro', () => {
  const patch = M.validarReagendamento('aguardando', { agendado_para: DAQUI_A_UM_DIA(), prioridade: 'alta' })
  assert.ok(patch.agendado_para instanceof Date)
  assert.equal(patch.prioridade, 'alta')
  assert.equal('origem' in patch, false, 'reagendar não reescreve a origem: a rastreabilidade é preservada')
  assert.equal('canal' in patch, false, 'trocar de canal é outra decisão, não um reagendamento')
})

test('item terminal não reagenda, e patch vazio é recusado', () => {
  assert.throws(() => M.validarReagendamento('concluido', { prioridade: 'alta' }), /nao pode ser reagendado/)
  assert.throws(() => M.validarReagendamento('aguardando', {}), /Nada para reagendar/)
})

test('responsável nulo explícito devolve o item para "não atribuído"', () => {
  const patch = M.validarReagendamento('aguardando', { responsavel_id: null })
  assert.equal(patch.responsavel_id, null)
  assert.equal('responsavel_id' in patch, true, 'null explícito é uma escolha, não "não informado"')
})

test('patch vazio é ACEITO quando a mudança é a disponibilidade do contato', () => {
  // Marcar "este contato não tem WhatsApp" é mudança legítima e não mexe em prazo nem
  // prioridade. Recusá-la com "Nada para reagendar" obrigaria o operador a inventar uma
  // alteração para conseguir salvar o que ele sabe. Quem grava o fato é a camada de dados
  // (migration 066); aqui só se autoriza o patch a ficar vazio.
  assert.deepEqual(M.validarReagendamento('aguardando', {}, new Date(), { permitirPatchVazio: true }), {})
  assert.throws(() => M.validarReagendamento('concluido', {}, new Date(), { permitirPatchVazio: true }),
    /nao pode ser reagendado/, 'item terminal continua recusado — disponibilidade não reabre item fechado')
})

test('o canal continua FORA do patch de reagendamento, mesmo com disponibilidade', () => {
  // A troca de canal é CONSEQUÊNCIA de um fato declarado sobre o contato, resolvida em
  // services/contato-canal-disponibilidade.js — nunca um campo do formulário.
  const patch = M.validarReagendamento('aguardando', { canal: 'ligacao', prioridade: 'alta' })
  assert.equal('canal' in patch, false)
})

// ─── Guardas de regressão sobre o fonte ───────────────────────────────────────

test('o banco — não a aplicação — garante uma ação aberta por contato e canal', () => {
  const mig = ler('sql/migrations/062_follow_ups.sql')
  assert.match(mig, /CREATE UNIQUE INDEX[\s\S]*follow_ups_um_aberto_por_canal_uk/,
    'a antiduplicidade precisa ser um índice único, não um IF na aplicação')
  assert.match(mig, /follow_ups_um_aberto_por_canal_uk[\s\S]*?WHERE status = 'aguardando'/,
    'o índice tem de ser PARCIAL: o histórico de ações concluídas cresce sem limite, como deve')
})

test('a conversa NÃO é chave estrangeira do follow-up', () => {
  const mig = ler('sql/migrations/062_follow_ups.sql')
  assert.doesNotMatch(mig, /REFERENCES\s+vendas\.conversas/,
    'vendas.conversas.numero é UNIQUE GLOBAL: uma FK ali não provaria mesma empresa')
  assert.match(mig, /telefone_digitos\s+TEXT NOT NULL/,
    'a identidade canônica do contato é o telefone em dígitos')
})

test('a migration 062 é ADITIVA: não muta nem apaga dado existente', () => {
  const mig = ler('sql/migrations/062_follow_ups.sql')
  for (const destrutivo of [/\bDROP\s+TABLE\b/i, /\bDROP\s+COLUMN\b/i, /\bDELETE\s+FROM\b/i, /\bUPDATE\s+app\./i, /\bTRUNCATE\b/i]) {
    assert.doesNotMatch(mig, destrutivo, 'esta migration não pode tocar em dado existente')
  }
})

test('o follow-up da ligação nasce DENTRO da transação do encerramento', () => {
  const src = ler('src/db/ligacoes.js')
  // Se ele nascesse fora, sobreviveria a um rollback do encerramento e mandaria o operador
  // agir sobre uma ligação que não existe.
  assert.match(src, /criarFollowUp\(client,/,
    'criarFollowUp precisa receber o CLIENT da transação, nunca o pool')
})

test('`app.campanha_leads` continua sendo escrita — o follow-up não a substitui', () => {
  const src = ler('src/db/ligacoes.js')
  assert.match(src, /UPDATE app\.campanha_leads SET/,
    'a aba Acompanhamento da campanha e o filtro "com/sem próxima ação" dependem dela')
})

test('a rota de criação não aceita origem "ligacao" — essa nasce só na transação', () => {
  const src = ler('src/routes/api-follow-ups.js')
  assert.match(src, /ORIGENS_DA_ROTA = new Set\(\['manual', 'mensagem'\]\)/,
    'aceitar origem=ligacao por HTTP permitiria follow-up de uma ligação que deu rollback')
})

test('o histórico do contato não devolve texto de mensagem', () => {
  const src = ler('src/db/follow-ups.js')
  const historico = src.slice(src.indexOf('async function historicoDoContato'))
  assert.doesNotMatch(historico, /c\.historico|jsonb_array_elements/,
    'as mensagens são do painel de conversa; repeti-las aqui criaria duas fontes divergentes')
})

test('toda consulta a app.follow_ups é escopada por empresa', () => {
  const src = ler('src/db/follow-ups.js')
  // Cada template literal do módulo é uma consulta. A que toca a tabela precisa citar
  // empresa_id — sem isso, um id de outro tenant na URL leria/escreveria dado alheio.
  const consultas = (src.match(/`[^`]*`/g) || []).filter((q) => q.includes('app.follow_ups'))
  assert.ok(consultas.length >= 5, `esperava várias consultas; achei ${consultas.length}`)
  for (const q of consultas) {
    assert.ok(/empresa_id/.test(q),
      `consulta sem filtro de empresa vazaria dado entre tenants:\n${q.slice(0, 160)}`)
  }
})

test('a resolução da conversa não tem o fallback para a PJ', () => {
  const src = ler('src/db/follow-ups.js')
  const fn = src.slice(src.indexOf('async function resolverConversaNumero'), src.indexOf('async function criarFollowUp'))
  assert.match(fn, /c\.empresa_id = \$1/)
  assert.doesNotMatch(fn, /IS NULL/,
    'o fallback da PJ faria o follow-up de uma empresa apontar para a conversa de outra')
})
