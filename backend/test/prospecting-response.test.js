'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { pool } = require('../src/db')
const {
  marcarProspectComoRespondeuPorNumero,
  marcarFilaProspeccaoRespondidaPorNumero,
  bloquearProspeccaoPorRespostaLead,
  buscarContextoProspeccao,
} = require('../src/prospecting')

const PROSPECT_ID = '11111111-1111-4111-8111-111111111111'
const FILA_ID = '22222222-2222-4222-8222-222222222222'

test('resposta lead: marca prospect como respondeu, fila como respondido e cria bloqueio', async () => {
  const originalQuery = pool.query
  const chamadas = []
  pool.query = async (sql, params = []) => {
    chamadas.push({ sql, params })
    if (/UPDATE prospectador\.prospects p\s+SET status = 'respondeu'/i.test(sql)) {
      assert.ok(Array.isArray(params[0]) && params[0].includes('5511999990001'))
      return {
        rows: [{
          id: PROSPECT_ID,
          nome: 'Restaurante A',
          telefone: '5511999990001',
          nicho: 'restaurantes',
          cidade: 'Salvador',
          endereco: '',
          avaliacoes: 30,
          rating: 4.5,
          tem_site: false,
          site: '',
          maps_url: '',
          place_id: 'place-a',
          origem: 'manual',
          status: 'respondeu',
          score: 88,
          motivo_score: '',
          raw_json: {},
          created_at: '2026-05-24T00:00:00Z',
          updated_at: '2026-05-24T00:00:00Z',
        }],
      }
    }
    if (/UPDATE prospectador\.prospeccao_fila_diaria f\s+SET status = 'respondido'/i.test(sql)) {
      assert.equal(params[0], '5511999990001')
      assert.equal(params[1], PROSPECT_ID)
      return { rows: [{ id: FILA_ID, status: 'respondido', prospect_id: PROSPECT_ID }] }
    }
    if (/INSERT INTO prospectador\.prospeccao_bloqueios/i.test(sql)) {
      assert.equal(params[0], '5511999990001')
      assert.equal(params[1], PROSPECT_ID)
      return { rows: [{ id: 1, motivo: 'lead_respondeu', ativo: true }] }
    }
    if (/INSERT INTO prospectador\.prospect_events/i.test(sql)) return { rows: [] }
    return { rows: [] }
  }
  try {
    const p = await marcarProspectComoRespondeuPorNumero('55 (11) 99999-0001')
    assert.equal(p.status, 'respondeu')
    assert.ok(chamadas.some((c) => /prospeccao_fila_diaria f\s+SET status = 'respondido'/i.test(c.sql)))
    assert.ok(chamadas.some((c) => /prospeccao_bloqueios/i.test(c.sql)))
  } finally {
    pool.query = originalQuery
  }
})

test('resposta lead: marca o prospect pelo prospect_id da fila quando o telefone cru nao casa (P10)', async () => {
  const originalQuery = pool.query
  const chamadas = []
  pool.query = async (sql, params = []) => {
    chamadas.push({ sql, params })
    // 1) casamento por telefone cru FALHA (formato do prospect nao bate as variacoes)
    if (/UPDATE prospectador\.prospects p\s+SET status = 'respondeu'/i.test(sql)) {
      return { rows: [] }
    }
    // 2) fila casa por telefone_normalizado e aponta o prospect_id
    if (/UPDATE prospectador\.prospeccao_fila_diaria f\s+SET status = 'respondido'/i.test(sql)) {
      return { rows: [{ id: FILA_ID, status: 'respondido', prospect_id: PROSPECT_ID }] }
    }
    // 3) fallback: marca o prospect pelo id vindo da fila
    if (/UPDATE prospectador\.prospects\s+SET status = 'respondeu',\s+updated_at = NOW\(\)\s+WHERE id = \$1::uuid/i.test(sql)) {
      assert.equal(params[0], PROSPECT_ID)
      return { rows: [{ id: PROSPECT_ID, telefone: '5511988887777', status: 'respondeu', raw_json: {} }] }
    }
    return { rows: [] }
  }
  try {
    const p = await marcarProspectComoRespondeuPorNumero('5511988887777')
    assert.ok(p, 'prospect deve ser marcado mesmo sem casar o telefone cru')
    assert.equal(p.status, 'respondeu')
    assert.ok(chamadas.some((c) => /WHERE id = \$1::uuid/i.test(c.sql)), 'deve usar o fallback por prospect_id da fila')
  } finally {
    pool.query = originalQuery
  }
})

test('resposta lead: marcador da fila funciona mesmo recebendo so telefone', async () => {
  const originalQuery = pool.query
  pool.query = async (sql, params = []) => {
    assert.match(sql, /UPDATE prospectador\.prospeccao_fila_diaria f/i)
    assert.equal(params[0], '5511999990001')
    assert.equal(params[1], null)
    return { rows: [{ id: FILA_ID, status: 'respondido' }] }
  }
  try {
    const fila = await marcarFilaProspeccaoRespondidaPorNumero('5511999990001')
    assert.equal(fila.status, 'respondido')
  } finally {
    pool.query = originalQuery
  }
})

test('resposta lead: bloqueio lead_respondeu impede nova prospeccao futura', async () => {
  const originalQuery = pool.query
  pool.query = async (sql, params = []) => {
    assert.match(sql, /INSERT INTO prospectador\.prospeccao_bloqueios/)
    assert.equal(params[0], '5511999990001')
    assert.equal(params[1], PROSPECT_ID)
    return { rows: [{ id: 7, telefone_normalizado: params[0], prospect_id: params[1], motivo: 'lead_respondeu' }] }
  }
  try {
    const bloqueio = await bloquearProspeccaoPorRespostaLead('5511999990001', PROSPECT_ID)
    assert.equal(bloqueio.motivo, 'lead_respondeu')
  } finally {
    pool.query = originalQuery
  }
})

test('resposta lead: contexto transferido para vendas prefere mensagem da fila diaria', async () => {
  const originalQuery = pool.query
  pool.query = async (sql, params = []) => {
    assert.match(sql, /row_to_json\(f\.\*\)/)
    assert.ok(Array.isArray(params[0]) && params[0].includes('5511999990001'))
    return {
      rows: [{
        id: PROSPECT_ID,
        nome: 'Restaurante A',
        telefone: '5511999990001',
        nicho: 'restaurantes',
        cidade: 'Salvador',
        endereco: 'Av. Sete de Setembro, 1000 - Salvador, BA',
        avaliacoes: 30,
        rating: 4.5,
        tem_site: false,
        site: '',
        maps_url: 'https://maps.google.com/?cid=place-a',
        place_id: 'place-a',
        origem: 'manual',
        status: 'respondeu',
        score: 88,
        motivo_score: '',
        raw_json: {},
        created_at: '2026-05-24T00:00:00Z',
        updated_at: '2026-05-24T00:00:00Z',
        diagnostico: {
          prospect_id: PROSPECT_ID,
          dor_principal: 'sem presenca digital clara',
          perda_estimada: null,
          mensagem_gerada: 'Mensagem antiga do diagnostico',
          mensagem_editada: null,
          metadata_json: {},
        },
        fila: {
          id: FILA_ID,
          prospect_id: PROSPECT_ID,
          status: 'respondido',
          slot_envio: '2026-05-25T08:00:00Z',
          mensagem_gerada: 'Mensagem real enviada pela fila',
          mensagem_editada: null,
          categoria: 'restaurante',
          cidade: 'Salvador',
          estado: 'BA',
          metadata_json: {
            regiao_padrao: 'Regiao Metropolitana de Salvador',
            candidato: {
              bairro: 'Barra',
            },
          },
        },
      }],
    }
  }
  try {
    const ctx = await buscarContextoProspeccao('5511999990001@s.whatsapp.net')
    assert.equal(ctx.prospect.id, PROSPECT_ID)
    assert.equal(ctx.fila.id, FILA_ID)
    assert.equal(ctx.mensagem_enviada, 'Mensagem real enviada pela fila')
    assert.equal(ctx.diagnostico.dor_principal, 'sem presenca digital clara')
    assert.equal(ctx.contexto_vendas.origem, 'prospeccao')
    assert.equal(ctx.contexto_vendas.nome, 'Restaurante A')
    assert.equal(ctx.contexto_vendas.nicho, 'restaurante')
    assert.equal(ctx.contexto_vendas.cidade, 'Salvador')
    assert.equal(ctx.contexto_vendas.estado, 'BA')
    assert.equal(ctx.contexto_vendas.endereco, 'Av. Sete de Setembro, 1000 - Salvador, BA')
    assert.equal(ctx.contexto_vendas.regiao_atendimento, 'Regiao Metropolitana de Salvador')
    assert.equal(ctx.contexto_vendas.maps_url, 'https://maps.google.com/?cid=place-a')
    assert.equal(ctx.contexto_vendas.place_id, 'place-a')
    assert.equal(ctx.contexto_vendas.dor_principal, 'sem presenca digital clara')
  } finally {
    pool.query = originalQuery
  }
})

test('resposta lead: webhook sempre deve gravar contexto de prospeccao no perfil, mesmo com conversa existente', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'webhook-handler.js'), 'utf8')

  assert.match(fonte, /if \(contextoProspeccao\?\.prospect\)/,
    'webhook deve enriquecer o perfil sempre que houver prospect respondido')
  assert.doesNotMatch(fonte, /if \(!conversa && contextoProspeccao\?\.prospect\)/,
    'contexto de prospeccao nao pode depender de conversa nova')
  assert.match(fonte, /contextoProspeccao\.contexto_vendas/,
    'webhook deve usar o contexto de vendas montado pela prospeccao')
  assert.match(fonte, /produto_sugerido:\s*'site'/,
    'perfil transferido da prospeccao deve sinalizar site para o agente comercial')
  const posSalvar = fonte.indexOf('await salvarConversa(numero, historico, estagio')
  const posPerfil = fonte.indexOf('await atualizarPerfil(numero, perfilProspeccaoPatch)')
  const posNome = fonte.indexOf('await capturarNomeContato(numero, { pushName: msg.pushName, texto: textoHistorico }')
  assert.ok(posSalvar >= 0 && posPerfil > posSalvar,
    'webhook deve salvar a conversa antes de inserir lead_profiles por causa da FK numero -> conversas(numero)')
  assert.ok(posNome > posPerfil,
    'webhook deve capturar apelido depois de salvar a conversa e aplicar o patch de perfil')
  assert.match(fonte, /capturarNomeContato,\s*\n\s*\} = deps/,
    'webhook deve receber capturarNomeContato por dependency injection')
  assert.match(fonte, /pushName: msg\.pushName/,
    'webhook deve repassar pushName do WhatsApp para captura de apelido')
})
