'use strict'
// `iniciarConversaManual` — o unico caminho do Follow-up manual que ESCREVE em producao.
//
// Ele existe porque, ate aqui, o Manual so falava com quem ja tinha conversa (os tres
// caminhos de `followup-manual.js` devolvem 404 sem `vendas.conversas`). Como abrir uma
// conversa e' criar um atendimento, os testes abaixo travam as tres garantias que
// justificaram a decisao — nao sao detalhes de implementacao:
//
//   1. nasce com o agente PAUSADO (o bot nao assume sozinho um numero que nunca escreveu);
//   2. NUNCA adota nem reescreve conversa de outra empresa (`numero` e' UNIQUE GLOBAL);
//   3. a origem fica registrada em `app.auditoria_eventos`, sem PII em claro no log.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { iniciarConversaManual, normalizarJid } = require('../src/services/followup-manual')

const EMPRESA = '00000000-0000-0000-0000-0000000000aa'
const OUTRA = '00000000-0000-0000-0000-0000000000bb'
const JID = '5511999990001@s.whatsapp.net'

// Pool falso que se comporta como a tabela: o INSERT so "pega" quando o numero e novo.
function poolFalso({ existente = null } = {}) {
  const chamadas = []
  let linha = existente
  return {
    chamadas,
    async query(sql, params) {
      const texto = String(sql)
      chamadas.push({ sql: texto, params })
      if (/INSERT INTO vendas\.conversas/.test(texto)) {
        if (linha) return { rowCount: 0, rows: [] }
        linha = { numero: params[0], empresa_id: params[1], agente_pausado: true }
        return { rowCount: 1, rows: [] }
      }
      if (/SELECT numero, empresa_id, agente_pausado/.test(texto)) {
        return { rows: linha ? [linha] : [] }
      }
      if (/INSERT INTO app\.auditoria_eventos/.test(texto)) {
        return { rows: [{ id: 'aud-1', ocorrido_em: '2026-08-08T12:00:00Z' }] }
      }
      return { rows: [], rowCount: 0 }
    },
  }
}

test('numero cru vira o JID canonico de vendas.conversas', () => {
  assert.equal(normalizarJid('11999990001'), '11999990001@s.whatsapp.net')
  assert.equal(normalizarJid('(11) 99999-0001'), '11999990001@s.whatsapp.net')
  // Ja em JID, preserva (inclusive @lid, que nao e inventado aqui).
  assert.equal(normalizarJid(JID), JID)
  assert.equal(normalizarJid('5511999990001@lid'), '5511999990001@lid')
  assert.equal(normalizarJid(''), '')
  assert.equal(normalizarJid(null), '')
})

test('conversa nova nasce com o AGENTE PAUSADO', async () => {
  const pool = poolFalso()
  const out = await iniciarConversaManual({ pool, empresaId: EMPRESA, numero: '5511999990001', usuarioId: 'u-1' })

  assert.equal(out.criada, true)
  assert.equal(out.numero, JID)
  assert.equal(out.agente_pausado, true)

  const insert = pool.chamadas.find((c) => /INSERT INTO vendas\.conversas/.test(c.sql))
  assert.ok(insert, 'deveria ter tentado inserir a conversa')
  assert.match(insert.sql, /agente_pausado/)
  // O literal `true` esta na propria instrucao: nao ha caminho que crie despausado.
  assert.match(insert.sql, /'primeiro_contato', 'ativo', true/)
  assert.deepEqual(insert.params, [JID, EMPRESA])
})

test('NUNCA reescreve conversa existente: e DO NOTHING, nao DO UPDATE', async () => {
  const pool = poolFalso()
  await iniciarConversaManual({ pool, empresaId: EMPRESA, numero: '5511999990001' })
  const insert = pool.chamadas.find((c) => /INSERT INTO vendas\.conversas/.test(c.sql))
  assert.match(insert.sql, /ON CONFLICT \(numero\) DO NOTHING/)
  assert.equal(/DO UPDATE/.test(insert.sql), false)
})

test('numero de OUTRA empresa e recusado com 409 — nao adota e nao vaza', async () => {
  const pool = poolFalso({ existente: { numero: JID, empresa_id: OUTRA, agente_pausado: false } })
  await assert.rejects(
    () => iniciarConversaManual({ pool, empresaId: EMPRESA, numero: '5511999990001' }),
    (err) => {
      assert.equal(err.statusCode, 409)
      assert.match(err.message, /outra empresa/i)
      // A mensagem de recusa nao pode descrever a conversa alheia.
      assert.equal(/@s\.whatsapp\.net/.test(err.message), false)
      return true
    }
  )
  // E nao registrou auditoria de criacao para algo que nao criou.
  assert.equal(pool.chamadas.some((c) => /auditoria_eventos/.test(c.sql)), false)
})

test('conversa que ja era da MESMA empresa e reaproveitada, sem novo registro de origem', async () => {
  const pool = poolFalso({ existente: { numero: JID, empresa_id: EMPRESA, agente_pausado: false } })
  const out = await iniciarConversaManual({ pool, empresaId: EMPRESA, numero: '5511999990001' })

  assert.equal(out.criada, false)
  assert.equal(out.numero, JID)
  // Origem so e registrada na CRIACAO: repetir a acao nao infla a auditoria.
  assert.equal(pool.chamadas.some((c) => /auditoria_eventos/.test(c.sql)), false)
})

test('a origem da conversa fica registrada, com telefone so em digitos e sem JID', async () => {
  const pool = poolFalso()
  await iniciarConversaManual({ pool, empresaId: EMPRESA, numero: '5511999990001', usuarioId: 'u-42' })

  const aud = pool.chamadas.find((c) => /INSERT INTO app\.auditoria_eventos/.test(c.sql))
  assert.ok(aud, 'a criacao deveria registrar a origem')
  const [empresaId, usuarioId, entidadeTipo, , acao] = aud.params
  assert.equal(empresaId, EMPRESA)
  assert.equal(usuarioId, 'u-42')
  assert.equal(entidadeTipo, 'conversa')
  assert.equal(acao, 'followup_manual_conversa_iniciada')

  // O contexto distingue esta conversa de uma recebida/campanha/automacao, sem PII crua.
  const contexto = JSON.parse(aud.params[7])
  assert.equal(contexto.origem, 'follow_up_manual')
  assert.equal(contexto.telefone_digitos, '5511999990001')
  assert.equal(/@/.test(aud.params[7]), false)
})

test('numero invalido nao chega a tocar o banco', async () => {
  const pool = poolFalso()
  await assert.rejects(() => iniciarConversaManual({ pool, empresaId: EMPRESA, numero: '' }))
  assert.equal(pool.chamadas.length, 0)
})

// Guarda de REGRESSAO no fonte: o motivo de existir `DO NOTHING` + releitura e' que
// `vendas.conversas.numero` e UNIQUE GLOBAL. Um `ON CONFLICT DO UPDATE` aqui
// reescreveria a conversa de outro tenant — nao e' preferencia de estilo.
test('o fonte nao reintroduz upsert nem cria conversa despausada', () => {
  const fonte = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'followup-manual.js'), 'utf8'
  )
  const bloco = fonte.slice(fonte.indexOf('async function iniciarConversaManual'))
  assert.equal(/ON CONFLICT[\s\S]{0,40}DO UPDATE/.test(bloco), false)
  assert.equal(/agente_pausado\s*=\s*false/.test(bloco), false)
})
