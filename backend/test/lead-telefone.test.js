'use strict'
// Telefone do lead informado por uma PESSOA ("+ telefone" no Banco de Leads) — regra pura +
// guardas de regressão sobre as consequências que ela não pode perder de vista.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const LT = require('../src/services/lead-telefone')

const SRC = (p) => fs.readFileSync(path.join(__dirname, '..', 'src', p), 'utf8')

test('normaliza para digitos e aceita DDD + numero', () => {
  assert.equal(LT.normalizarTelefoneLead('(11) 98888-7777'), '11988887777')
  assert.equal(LT.normalizarTelefoneLead('+55 11 98888 7777'), '5511988887777')
  assert.equal(LT.normalizarTelefoneLead(null), '')
  assert.equal(LT.validarTelefoneLead('(11) 98888-7777').telefone, '11988887777')
})

test('recusa numero curto e numero longo demais, com motivo proprio', () => {
  assert.equal(LT.validarTelefoneLead('11988').motivo, LT.MOTIVOS.CURTO)
  assert.equal(LT.validarTelefoneLead('1'.repeat(16)).motivo, LT.MOTIVOS.LONGO)
  // Os limites sao os mesmos do cadastro manual (POST /leads): uma porta mais frouxa que a
  // outra deixaria entrar pelo lado o que a primeira recusa.
  assert.ok(SRC('routes/api-banco-leads.js').includes('WhatsApp inválido — informe DDD + número.'))
})

test('limpar o telefone e permitido, MENOS depois de o lead ja ter sido abordado', () => {
  assert.equal(LT.validarTelefoneLead('', { jaAbordado: false }).ok, true)
  assert.equal(LT.validarTelefoneLead('', { jaAbordado: false }).telefone, null)
  const recusa = LT.validarTelefoneLead('', { jaAbordado: true })
  assert.equal(recusa.ok, false)
  assert.equal(recusa.motivo, LT.MOTIVOS.JA_ABORDADO)
  // Apagar o numero de um lead ja abordado orfaria a conversa, o follow-up e a reuniao criados
  // COM aquele numero — todos chaveados por telefone.
  assert.match(recusa.mensagem, /corrija/i)
})

test('numero novo ZERA tem_whatsapp — o veredito era sobre o numero ANTIGO', () => {
  const e = LT.efeitosDaTrocaDeTelefone({ telefoneAtual: '11988887777', telefoneNovo: '11999996666', status: 'aprovado' })
  assert.equal(e.mudou, true)
  assert.equal(e.resetarTemWhatsapp, true)
})

test('mesmo numero em outra formatacao NAO conta como troca', () => {
  const e = LT.efeitosDaTrocaDeTelefone({ telefoneAtual: '(11) 98888-7777', telefoneNovo: '11988887777', status: 'aprovado' })
  assert.equal(e.mudou, false)
  assert.equal(e.resetarTemWhatsapp, false)
  assert.equal(e.statusNovo, null)
})

test('o status so PROMOVE coletado → contato_encontrado, nunca rebaixa', () => {
  assert.equal(LT.efeitosDaTrocaDeTelefone({ telefoneAtual: null, telefoneNovo: '11988887777', status: 'coletado' }).statusNovo, 'contato_encontrado')
  assert.equal(LT.efeitosDaTrocaDeTelefone({ telefoneAtual: null, telefoneNovo: '11988887777', status: 'respondeu' }).statusNovo, null)
  // Apagar o telefone nao rebaixa o status: isso apagaria trabalho humano.
  assert.equal(LT.efeitosDaTrocaDeTelefone({ telefoneAtual: '11988887777', telefoneNovo: '', status: 'enviado' }).statusNovo, null)
})

test('o modulo e PURO — sem banco, sem HTTP, sem rede', () => {
  const fonte = SRC('services/lead-telefone.js')
  for (const proibido of ['require(', 'pool', 'fetch(', 'axios']) {
    assert.ok(!fonte.includes(proibido), `modulo puro nao pode conter ${proibido}`)
  }
})

// ─── Guardas de regressao na rota ───────────────────────────────────────────────────────────

test('a rota RECUSA numero que ja e de outro lead da empresa', () => {
  const fonte = SRC('routes/api-banco-leads.js')
  const rota = fonte.slice(fonte.indexOf("router.patch('/leads/:id/telefone'"))
  assert.ok(rota.includes('EM_USO'), 'dois leads no mesmo numero apontam para a MESMA conversa')
  assert.ok(rota.includes('e.statusCode = 409'))
  // A comparacao passa pelo MESMO normalizador do resto do arquivo (tira o DDI 55): comparar
  // digito cru faria 5511... e 11... parecerem numeros diferentes.
  assert.ok(/normFone\('telefone'\)\} = \$\{normFone\('\$3'\)/.test(rota))
})

test('a rota ZERA tem_whatsapp quando o numero muda', () => {
  const fonte = SRC('routes/api-banco-leads.js')
  const rota = fonte.slice(fonte.indexOf("router.patch('/leads/:id/telefone'"))
  assert.ok(/tem_whatsapp = CASE WHEN \$5(::boolean)? THEN NULL/.test(rota), 'sem isto o lead corrigido continua morto em Descartados')
})

test('a rota repete o RECORTE da listagem (404, nunca 403)', () => {
  const fonte = SRC('routes/api-banco-leads.js')
  for (const alvo of ["router.patch('/leads/:id/telefone'", "router.patch('/leads/:id/email'"]) {
    const rota = fonte.slice(fonte.indexOf(alvo), fonte.indexOf(alvo) + 1200)
    assert.ok(rota.includes('exigirLeadNoRecorte'), `${alvo} escreveria em lead fora do escopo`)
  }
  assert.ok(SRC('routes/api-banco-leads.js').includes("e.statusCode = 404"))
})

test('a recoleta PRESERVA o telefone digitado a mao, e a marca sobrevive a ela', () => {
  const fonte = SRC('prospecting.js')
  const inicio = fonte.indexOf('ON CONFLICT (empresa_id, place_id)')
  const upsert = fonte.slice(inicio, fonte.indexOf('RETURNING *', inicio))
  assert.ok(upsert.includes("raw_json->>'telefone_origem'"), 'recoleta voltaria a sobrescrever o numero corrigido')
  assert.ok(!/telefone = COALESCE\(EXCLUDED\.telefone/.test(upsert), 'era isto que fazia o Maps vencer a pessoa')
  // Sem preservar a MARCA junto do raw_json, a coleta seguinte sobrescreveria de novo.
  assert.ok(/raw_json = CASE[\s\S]*jsonb_set\(EXCLUDED\.raw_json/.test(upsert))
})

test('a escrita do telefone vira linha de auditoria, sem PII alem dos digitos', () => {
  const fonte = SRC('routes/api-banco-leads.js')
  const rota = fonte.slice(fonte.indexOf("router.patch('/leads/:id/telefone'"))
  assert.ok(rota.includes("'lead_telefone_alterado'"))
  assert.ok(rota.includes('telefone_digitos'))
  assert.ok(!rota.includes('nome_lead'), 'auditoria de contato nao carrega nome nem texto')
})
