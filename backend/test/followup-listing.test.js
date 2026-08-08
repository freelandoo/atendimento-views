'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const fs = require('node:fs')
const path = require('node:path')

const {
  montarCallList,
  listarAgendamentosAuto,
  buscarLeadsParaFollowup,
} = require('../src/services/followup-listing')

test('fila humana inclui handoff imediato e prompt externo quando ha contexto', async () => {
  let consulta = ''
  const pool = {
    async query(sql) {
      consulta = String(sql)
      return {
        rows: [
          {
            numero: '551100000001@s.whatsapp.net', nome: 'Lead handoff', estagio: 'diagnostico',
            status: 'aguardando_handoff', agente_pausado: true, pronto_handoff: true,
            negocio: null, cidade: null, score_lead: 0, dias_silencio: 0,
            respondeu_alguma_vez: true, ultimo_texto_usuario: 'Quero falar com uma pessoa',
            pediu_preco: false, recebeu_proposta: false, followups_ignorados: 0,
            reuniao_pendente: false, recebeu_preview: false,
          },
          {
            numero: '551100000002@s.whatsapp.net', nome: 'Marcenaria Horizonte', estagio: 'diagnostico',
            status: 'ativo', agente_pausado: false, pronto_handoff: false,
            negocio: 'Marcenaria Horizonte', cidade: 'Santos', score_lead: 60,
            produto_sugerido: 'site institucional', complexidade: 'landing',
            dor_principal: 'receber pedidos no WhatsApp', contexto_prospeccao: { tem_site: false },
            dias_silencio: 1, respondeu_alguma_vez: true,
            ultimo_texto_usuario: 'Como ficaria um exemplo visual?',
            pediu_preco: false, recebeu_proposta: false, followups_ignorados: 0,
            reuniao_pendente: false, recebeu_preview: false,
          },
        ],
      }
    },
  }

  const lista = await montarCallList(pool, 'empresa-1', { limit: 20 })

  assert.equal(lista.length, 2)
  assert.equal(lista[0].acao_recomendada, 'assumir_conversa')
  assert.equal(lista[1].acao_recomendada, 'copiar_prompt_preview')
  assert.match(lista[1].prompt_preview, /Marcenaria Horizonte/)
  assert.match(consulta, /c\.status IN \('ativo', 'aguardando_handoff'\)/)
  assert.match(consulta, /e\.tipo = 'recebeu_preview'/)
})

// ── O JID do Evolution nao pode voltar como "nome" do lead ─────────────────────────
// Guarda de REGRESSAO: as duas consultas usavam `COALESCE(..., c.numero)` /
// `COALESCE(..., fa.numero)`, e era isso que colocava `…@s.whatsapp.net` na coluna
// "Lead" da tela. O fallback legivel e' decidido na apresentacao (`rotuloLead`), nao no
// SQL — se alguem reintroduzir o numero no COALESCE, este teste falha.
test('nome do lead nunca cai para o numero no SQL das duas listagens', async () => {
  const fonte = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'followup-listing.js'), 'utf8'
  )
  assert.equal(/COALESCE\(NULLIF\(p\.apelido[^)]*\)[^)]*,\s*(c|fa)\.numero\s*\)\s+AS nome/.test(fonte), false)

  let sqlAuto = ''
  const pool = { async query(sql) { sqlAuto = String(sql); return { rows: [] } } }
  await listarAgendamentosAuto(pool, 'empresa-1', {})
  assert.match(sqlAuto, /COALESCE\(NULLIF\(p\.apelido, ''\), NULLIF\(p\.negocio, ''\)\) AS nome/)
  assert.equal(sqlAuto.includes("NULLIF(p.negocio, ''), fa.numero)"), false)
})

// ── Busca assistida do Follow-up manual ────────────────────────────────────────────
test('busca assistida exige 2 caracteres e nao consulta o banco a toa', async () => {
  let chamadas = 0
  const pool = { async query() { chamadas += 1; return { rows: [] } } }
  assert.deepEqual(await buscarLeadsParaFollowup(pool, 'empresa-1', { q: '' }), [])
  assert.deepEqual(await buscarLeadsParaFollowup(pool, 'empresa-1', { q: 'a' }), [])
  assert.deepEqual(await buscarLeadsParaFollowup(pool, 'empresa-1', { q: '   ' }), [])
  assert.equal(chamadas, 0)
})

test('busca assistida e escopada na empresa e casa por nome OU telefone', async () => {
  let sql = ''
  let params = []
  const pool = {
    async query(q, p) {
      sql = String(q); params = p
      return {
        rows: [
          { numero: '5511999990001@s.whatsapp.net', telefone_digitos: '5511999990001', nome: 'Padaria do Ze', cidade: 'Santos', estagio: 'diagnostico' },
          { numero: '5511999990002@s.whatsapp.net', telefone_digitos: '5511999990002', nome: null, cidade: null, estagio: null },
        ],
      }
    },
  }
  const itens = await buscarLeadsParaFollowup(pool, 'empresa-1', { q: 'Padaria' })

  assert.equal(params[0], 'empresa-1')
  assert.match(sql, /c\.empresa_id = \$1/)
  // Sem o fallback para a PJ que api-conversas.js faz: sugerir contato e' expor dado.
  assert.equal(/empresa_id IS NULL/.test(sql), false)
  assert.match(sql, /p\.apelido, ''\) ILIKE \$2/)
  assert.match(sql, /LIKE \$4/)

  // Nome ausente volta NULO — a tela decide o fallback, nunca o SQL.
  assert.equal(itens[1].nome, null)
  assert.equal(itens[0].nome, 'Padaria do Ze')
  assert.equal(itens[0].telefone_digitos, '5511999990001')
})

test('curinga do LIKE digitado pelo operador e escapado (nao vira "qualquer coisa")', async () => {
  let params = []
  const pool = { async query(_q, p) { params = p; return { rows: [] } } }
  await buscarLeadsParaFollowup(pool, 'empresa-1', { q: '100%_off' })
  // O termo vai entre % de propria conta, mas os curingas DO OPERADOR sao literais.
  assert.equal(params[1], '%100\\%\\_off%')
})

test('busca assistida limita o resultado e nao aceita limite absurdo', async () => {
  let params = []
  const pool = { async query(_q, p) { params = p; return { rows: [] } } }
  await buscarLeadsParaFollowup(pool, 'empresa-1', { q: 'padaria' })
  assert.equal(params[4], 8)
  await buscarLeadsParaFollowup(pool, 'empresa-1', { q: 'padaria', limit: 9999 })
  assert.equal(params[4], 20)
  await buscarLeadsParaFollowup(pool, 'empresa-1', { q: 'padaria', limit: 0 })
  assert.equal(params[4], 8)
})
