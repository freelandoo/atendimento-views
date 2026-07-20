'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizarNumeroProspeccao,
  canProspectLead,
} = require('../src/services/prospecting-eligibility')

function criarPoolElegibilidade(cenario = {}) {
  const queries = []
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params })
      if (/prospeccao_bloqueios/i.test(sql)) return { rows: cenario.bloqueio ? [cenario.bloqueio] : [] }
      if (/contato_politicas/i.test(sql)) return { rows: cenario.politica ? [cenario.politica] : [] }
      if (/vendas\.conversas/i.test(sql)) return { rows: cenario.conversa ? [cenario.conversa] : [] }
      if (/FROM prospectador\.prospects/i.test(sql)) return { rows: cenario.prospect ? [cenario.prospect] : [] }
      if (/FROM prospectador\.send_attempts/i.test(sql)) return { rows: cenario.sendAttempt ? [cenario.sendAttempt] : [] }
      if (/prospeccao_fila_diaria/i.test(sql)) return { rows: cenario.fila ? [cenario.fila] : [] }
      if (/vendas\.job_queue/i.test(sql)) return { rows: cenario.job ? [cenario.job] : [] }
      return { rows: [] }
    },
  }
}

test('eligibilidade: normaliza telefone brasileiro comum', () => {
  assert.equal(normalizarNumeroProspeccao('11 99999-9999'), '5511999999999')
  assert.equal(normalizarNumeroProspeccao('+55 (71) 98888-7777@s.whatsapp.net'), '5571988887777')
})

test('eligibilidade: bloqueia grupo e broadcast', async () => {
  const pool = criarPoolElegibilidade()
  assert.deepEqual(await canProspectLead(pool, '1203630@g.us'), {
    allowed: false,
    reason: 'grupo_ou_broadcast',
    normalizedPhone: '',
  })
  assert.equal((await canProspectLead(pool, 'status@broadcast')).reason, 'grupo_ou_broadcast')
  assert.equal(pool.queries.length, 0, 'nao deve consultar banco para jid de grupo/broadcast')
})

test('eligibilidade: bloqueia telefone invalido', async () => {
  const pool = criarPoolElegibilidade()
  const r = await canProspectLead(pool, '123')
  assert.equal(r.allowed, false)
  assert.equal(r.reason, 'telefone_invalido')
})

test('eligibilidade: bloqueia telefone fixo (sem WhatsApp)', async () => {
  const pool = criarPoolElegibilidade()
  const fixo = await canProspectLead(pool, '1132313396')
  assert.equal(fixo.allowed, false)
  assert.equal(fixo.reason, 'telefone_fixo')
  assert.equal(fixo.normalizedPhone, '551132313396')
  assert.equal(pool.queries.length, 0, 'nao deve consultar banco para telefone fixo')
})

test('eligibilidade: libera celular com nono digito', async () => {
  const pool = criarPoolElegibilidade()
  const r = await canProspectLead(pool, '11999999999')
  assert.equal(r.allowed, true)
  assert.equal(r.reason, 'ok')
})

test('eligibilidade: bloqueia por tabela de bloqueios', async () => {
  const pool = criarPoolElegibilidade({
    bloqueio: { id: 1, motivo: 'manual', origem: 'operador' },
  })
  const r = await canProspectLead(pool, '11999999999')
  assert.equal(r.allowed, false)
  assert.equal(r.reason, 'bloqueado:manual')
})

test('eligibilidade: bloqueia opt-out', async () => {
  const pool = criarPoolElegibilidade({
    politica: { telefone: '5511999999999', opt_out: true, updated_at: '2026-05-01T10:00:00Z' },
  })
  const r = await canProspectLead(pool, '11999999999')
  assert.equal(r.allowed, false)
  assert.equal(r.reason, 'opt_out')
  assert.equal(r.lastContactAt, '2026-05-01T10:00:00Z')
})

test('eligibilidade: bloqueia cliente fechado', async () => {
  const pool = criarPoolElegibilidade({
    conversa: { id: 42, status: 'encerrado', estagio: 'fechamento', venda_fechada: true, atualizado_em: '2026-05-10T10:00:00Z' },
  })
  const r = await canProspectLead(pool, '11999999999')
  assert.equal(r.allowed, false)
  assert.equal(r.reason, 'cliente_fechado')
  assert.equal(r.existingConversationId, 42)
})

test('eligibilidade: bloqueia conversa ativa', async () => {
  const pool = criarPoolElegibilidade({
    conversa: { id: 43, status: 'ativo', estagio: 'diagnostico', venda_fechada: false, atualizado_em: '2026-05-10T10:00:00Z' },
  })
  const r = await canProspectLead(pool, '11999999999')
  assert.equal(r.allowed, false)
  assert.equal(r.reason, 'conversa_ativa')
  assert.equal(r.currentStage, 'diagnostico')
})

test('eligibilidade: bloqueia lead que ja respondeu', async () => {
  const pool = criarPoolElegibilidade({
    prospect: { id: '11111111-1111-4111-8111-111111111111', telefone: '5511999999999', status: 'respondeu', updated_at: '2026-05-09T00:00:00Z' },
  })
  const r = await canProspectLead(pool, '11999999999')
  assert.equal(r.allowed, false)
  assert.equal(r.reason, 'lead_ja_respondeu')
  assert.equal(r.existingProspectId, '11111111-1111-4111-8111-111111111111')
})

test('eligibilidade: bloqueia prospeccao recente por envio sent', async () => {
  const pool = criarPoolElegibilidade({
    prospect: { id: '22222222-2222-4222-8222-222222222222', telefone: '5511999999999', status: 'enviado' },
    sendAttempt: { id: 9, prospect_id: '22222222-2222-4222-8222-222222222222', status: 'sent', enviado_em: '2026-05-20T12:00:00Z' },
  })
  const r = await canProspectLead(pool, '11999999999', { desde: new Date('2026-04-01T00:00:00Z') })
  assert.equal(r.allowed, false)
  assert.equal(r.reason, 'prospectado_recentemente')
})

test('eligibilidade: bloqueia envio reservado em send_attempts', async () => {
  const pool = criarPoolElegibilidade({
    sendAttempt: { id: 10, prospect_id: '33333333-3333-4333-8333-333333333333', status: 'scheduled', created_at: '2026-05-20T12:00:00Z' },
  })
  const r = await canProspectLead(pool, '11999999999')
  assert.equal(r.allowed, false)
  assert.equal(r.reason, 'envio_ja_reservado')
})

test('eligibilidade: bloqueia fila diaria ativa duplicada', async () => {
  const pool = criarPoolElegibilidade({
    fila: { id: 'fila-1', prospect_id: '44444444-4444-4444-8444-444444444444', status: 'agendado', slot_envio: '2026-05-25T11:00:00Z' },
  })
  const r = await canProspectLead(pool, '11999999999')
  assert.equal(r.allowed, false)
  assert.equal(r.reason, 'envio_agendado_duplicado')
})

test('eligibilidade: bloqueia job pendente de prospeccao', async () => {
  const pool = criarPoolElegibilidade({
    job: { id: 77, tipo: 'prospeccao_envio_agendado', status: 'pending', available_at: '2026-05-25T11:00:00Z' },
  })
  const r = await canProspectLead(pool, '11999999999')
  assert.equal(r.allowed, false)
  assert.equal(r.reason, 'job_prospeccao_pendente')
})

test('eligibilidade (complianceOnly): bloqueia telefone ja contatado por OUTRO prospect', async () => {
  const pool = criarPoolElegibilidade({
    prospect: { id: '66666666-6666-4666-8666-666666666666', telefone: '5511999999999', status: 'enviado', updated_at: '2026-05-11T00:00:00Z' },
  })
  const r = await canProspectLead(pool, '11999999999', {
    prospectId: '77777777-7777-4777-8777-777777777777',
    complianceOnly: true,
  })
  assert.equal(r.allowed, false)
  assert.equal(r.reason, 'telefone_ja_contatado')
  assert.equal(r.existingProspectId, '66666666-6666-4666-8666-666666666666')
})

test('eligibilidade (complianceOnly): permite reprocessar o PROPRIO prospect ja enviado', async () => {
  const pool = criarPoolElegibilidade({
    prospect: { id: '66666666-6666-4666-8666-666666666666', telefone: '5511999999999', status: 'enviado', updated_at: '2026-05-11T00:00:00Z' },
  })
  const r = await canProspectLead(pool, '11999999999', {
    prospectId: '66666666-6666-4666-8666-666666666666',
    complianceOnly: true,
  })
  assert.equal(r.allowed, true)
})

test('eligibilidade: permite lead limpo e retorna contexto normalizado', async () => {
  const pool = criarPoolElegibilidade({
    prospect: { id: '55555555-5555-4555-8555-555555555555', telefone: '5511999999999', status: 'aguardando', updated_at: '2026-05-01T00:00:00Z' },
  })
  const r = await canProspectLead(pool, '11 99999-9999')
  assert.equal(r.allowed, true)
  assert.equal(r.reason, 'ok')
  assert.equal(r.normalizedPhone, '5511999999999')
  assert.equal(r.existingProspectId, '55555555-5555-4555-8555-555555555555')
})
