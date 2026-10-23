'use strict'
// Ledger de SAÍDA das mensagens (migration 117) + os indicadores que ele sustenta.
//
// O que estes testes protegem:
//  1. autoria nunca é DEDUZIDA — quem não declara conta como 'desconhecida', e nunca é
//     atribuído a uma pessoa só para o total fechar;
//  2. uma linha 'ia' nunca carrega autor humano (afirmaria que alguém escreveu o que a IA
//     escreveu) — e isso é travado também no banco, pelo CHECK da migration;
//  3. contabilidade NUNCA derruba um envio que já saiu para o cliente;
//  4. "lead contatado" é DISTINCT por telefone, não contagem de mensagens;
//  5. alerta ao operador não infla o total de atendimento;
//  6. o vocabulário do código e o CHECK da migration não divergem (anti-drift).
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const {
  AUTORIA, AUTORIAS, TIPO, TIPOS, TIPOS_DE_ATENDIMENTO, DEFINICOES, normalizarAutoria,
} = require('../src/services/mensagem-autoria')
const { registrarEnvio, resumoEnvios, janela } = require('../src/db/mensagem-envios')

const MIGRATION = fs.readFileSync(
  path.join(__dirname, '..', 'sql', 'migrations', '117_mensagem_envios.sql'), 'utf8'
)

// ─── Vocabulário × schema (anti-drift) ────────────────────────────────────────────────

test('anti-drift: AUTORIAS do código são exatamente as do CHECK da migration', () => {
  const m = MIGRATION.match(/autoria\s+IN\s*\(([^)]+)\)/i)
  assert.ok(m, 'CHECK de autoria não encontrado na migration')
  const noBanco = m[1].split(',').map((x) => x.trim().replace(/'/g, '')).sort()
  assert.deepStrictEqual([...AUTORIAS].sort(), noBanco)
})

test('anti-drift: TIPOS do código são exatamente os do CHECK da migration', () => {
  const m = MIGRATION.match(/tipo\s+IN\s*\(([\s\S]*?)\)\s*\n?\s*\)/i)
  assert.ok(m, 'CHECK de tipo não encontrado na migration')
  const noBanco = m[1].split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean).sort()
  assert.deepStrictEqual([...TIPOS].sort(), noBanco)
})

test('a migration mantém direcao fechada em um único valor (só saída)', () => {
  assert.match(MIGRATION, /direcao\s+TEXT\s+NOT NULL\s+CHECK\s*\(\s*direcao\s*=\s*'enviada'\s*\)/i,
    'alargar para receber exige implementar o leitor de entrada NO MESMO diff')
})

test('a migration NÃO guarda o texto da mensagem', () => {
  assert.ok(!/\b(texto|mensagem|conteudo|content|body)\s+TEXT/i.test(MIGRATION),
    'o conteúdo já vive no histórico da conversa; duplicá-lo criaria segunda cópia de PII')
})

test('a migration não dá DEFAULT a autoria/tipo/direcao', () => {
  for (const col of ['autoria', 'tipo', 'direcao']) {
    const linha = MIGRATION.split('\n').find((l) => new RegExp('^\\s*' + col + '\\s+TEXT').test(l))
    assert.ok(linha, 'coluna não encontrada: ' + col)
    assert.ok(!/DEFAULT/i.test(linha),
      col + ' com DEFAULT autorizaria em silêncio um INSERT futuro que esquecesse a coluna')
  }
})

test('a migration trava no banco a coerência autor × autoria', () => {
  assert.match(MIGRATION, /autor_usuario_id IS NULL OR autoria = 'pessoa'/)
})

test('idempotência é por (empresa, id da mensagem) e parcial', () => {
  assert.match(MIGRATION, /UNIQUE INDEX[\s\S]*mensagem_envios_idempotencia_uk[\s\S]*empresa_id, evolution_message_id[\s\S]*WHERE evolution_message_id IS NOT NULL/)
})

// ─── Regra pura de autoria ────────────────────────────────────────────────────────────

test('quem não declara autoria entra como desconhecida, não como pessoa', () => {
  const v = normalizarAutoria({})
  assert.equal(v.autoria, AUTORIA.DESCONHECIDA)
  assert.equal(v.tipo, TIPO.OUTRO)
  assert.equal(v.autor_usuario_id, null)
})

test('autoria inválida cai em desconhecida em vez de quebrar o envio', () => {
  assert.equal(normalizarAutoria({ autoria: 'operador' }).autoria, AUTORIA.DESCONHECIDA)
  assert.equal(normalizarAutoria({ autoria: 'IA' }).autoria, AUTORIA.DESCONHECIDA)
  assert.equal(normalizarAutoria({ tipo: 'inventado' }).tipo, TIPO.OUTRO)
})

test('autor humano só sobrevive com autoria pessoa', () => {
  assert.equal(normalizarAutoria({ autoria: 'pessoa', autorUsuarioId: 'u1' }).autor_usuario_id, 'u1')
  assert.equal(normalizarAutoria({ autoria: 'ia', autorUsuarioId: 'u1' }).autor_usuario_id, null)
  assert.equal(normalizarAutoria({ autoria: 'desconhecida', autorUsuarioId: 'u1' }).autor_usuario_id, null)
})

test('acionador é independente da autoria (IA escreve, pessoa manda enviar)', () => {
  const v = normalizarAutoria({ autoria: 'ia', acionadorUsuarioId: 'u1', tipo: 'saudacao' })
  assert.equal(v.autoria, AUTORIA.IA)
  assert.equal(v.autor_usuario_id, null, 'a IA escreveu')
  assert.equal(v.acionador_usuario_id, 'u1', 'a pessoa mandou')
})

test('alerta ao operador fica FORA dos tipos de atendimento', () => {
  assert.ok(!TIPOS_DE_ATENDIMENTO.includes(TIPO.ALERTA_OPERADOR))
  assert.ok(TIPOS_DE_ATENDIMENTO.includes(TIPO.SAUDACAO))
  assert.ok(TIPOS_DE_ATENDIMENTO.includes(TIPO.RESPOSTA_IA))
  assert.equal(TIPOS_DE_ATENDIMENTO.length, TIPOS.length - 1)
})

test('cada indicador tem a definição do que conta', () => {
  for (const chave of ['mensagens', 'ia', 'pessoa', 'desconhecida', 'leads_contatados']) {
    assert.ok(DEFINICOES[chave] && DEFINICOES[chave].length > 20, 'definição ausente: ' + chave)
  }
  assert.match(DEFINICOES.mensagens, /Não é confirmação de entrega/i)
  assert.match(DEFINICOES.leads_contatados, /distintos/i)
})

// ─── Escrita ──────────────────────────────────────────────────────────────────────────

test('registrarEnvio grava empresa, instância, telefone e autoria', async () => {
  let params = null
  const pool = { query: async (_sql, p) => { params = p; return { rows: [] } } }
  const r = await registrarEnvio(pool, {
    empresaId: 'e1',
    evolutionInstance: 'victor2',
    numero: '5511999998888@s.whatsapp.net',
    autoria: 'pessoa',
    autorUsuarioId: 'u1',
    acionadorUsuarioId: 'u1',
    tipo: 'manual_operador',
    evolutionMessageId: 'MSG1',
  })
  assert.equal(r.ok, true)
  assert.deepStrictEqual(params.slice(0, 3), ['e1', 'victor2', '5511999998888'])
  assert.equal(params[4], 'pessoa')
  assert.equal(params[5], 'u1')
  assert.equal(params[7], 'manual_operador')
  assert.equal(params[8], 'MSG1')
})

test('registrarEnvio NUNCA lança — contabilidade não derruba envio já feito', async () => {
  const pool = { query: async () => { throw new Error('banco fora do ar') } }
  const r = await registrarEnvio(pool, {
    empresaId: 'e1', evolutionInstance: 'i', numero: '5511999998888', tipo: 'saudacao',
  })
  assert.equal(r.ok, false)
  assert.equal(r.motivo, 'erro')
})

test('registrarEnvio recusa linha sem empresa, sem instância ou sem telefone utilizável', async () => {
  let chamou = false
  const pool = { query: async () => { chamou = true; return { rows: [] } } }
  for (const caso of [
    { empresaId: '', evolutionInstance: 'i', numero: '5511999998888' },
    { empresaId: 'e1', evolutionInstance: '', numero: '5511999998888' },
    { empresaId: 'e1', evolutionInstance: 'i', numero: '123' },
    { empresaId: 'e1', evolutionInstance: 'i', numero: '' },
  ]) {
    const r = await registrarEnvio(pool, caso)
    assert.equal(r.ok, false, JSON.stringify(caso))
    assert.equal(r.motivo, 'dados_insuficientes')
  }
  assert.equal(chamou, false, 'nem chega ao banco')
})

test('registrarEnvio usa ON CONFLICT para reentrega do mesmo webhook/retry', async () => {
  let sql = ''
  const pool = { query: async (s) => { sql = s; return { rows: [] } } }
  await registrarEnvio(pool, {
    empresaId: 'e1', evolutionInstance: 'i', numero: '5511999998888', evolutionMessageId: 'M',
  })
  assert.match(sql, /ON CONFLICT \(empresa_id, evolution_message_id\)/)
  assert.match(sql, /DO NOTHING/)
})

// ─── Leitura (indicadores) ────────────────────────────────────────────────────────────

function poolDeLeitura(captura) {
  return {
    query: async (sql, params) => {
      captura.push({ sql, params })
      if (sql.includes('AS mensagens,')) {
        return { rows: [{ mensagens: 70, ia: 20, pessoa: 50, desconhecida: 0, alerta_operador: 4, leads_contatados: 31 }] }
      }
      if (sql.includes('AS usuario_id')) return { rows: [{ usuario_id: 'u1', nome: 'Victor', mensagens: 50 }] }
      return { rows: [{ evolution_instance: 'victor2', nome: 'Victor 2', mensagens: 70, leads_contatados: 31 }] }
    },
  }
}

test('resumoEnvios separa IA, pessoa e desconhecida, e isola o alerta', async () => {
  const captura = []
  const d = await resumoEnvios(poolDeLeitura(captura), 'e1', {})
  assert.equal(d.ia, 20)
  assert.equal(d.pessoa, 50)
  assert.equal(d.mensagens, 70)
  assert.equal(d.alerta_operador, 4, 'fora do total de atendimento, mas visível')
  assert.equal(d.leads_contatados, 31)
  assert.deepStrictEqual(d.por_pessoa, [{ usuario_id: 'u1', nome: 'Victor', mensagens: 50 }])
})

test('resumoEnvios é sempre escopado na empresa e no período', async () => {
  const captura = []
  await resumoEnvios(poolDeLeitura(captura), 'e1', { de: '2026-10-01', ate: '2026-10-22' })
  assert.ok(captura.length >= 3)
  for (const { sql, params } of captura) {
    assert.match(sql, /m\.empresa_id = \$1/)
    assert.match(sql, /m\.criado_em >= \$2 AND m\.criado_em < \$3/)
    assert.equal(params[0], 'e1')
  }
})

test('leads_contatados conta telefones DISTINTOS, nunca mensagens', async () => {
  const captura = []
  await resumoEnvios(poolDeLeitura(captura), 'e1', {})
  const totais = captura.find((c) => c.sql.includes('AS leads_contatados'))
  assert.match(totais.sql, /COUNT\(DISTINCT m\.telefone_digitos\)/)
})

test('o filtro por instância entra como parâmetro, nunca concatenado', async () => {
  const captura = []
  const d = await resumoEnvios(poolDeLeitura(captura), 'e1', { instancia: "x' OR 1=1 --" })
  assert.equal(d.instancia, "x' OR 1=1 --")
  for (const { sql, params } of captura) {
    assert.ok(!sql.includes('OR 1=1'), 'nada do cliente entra no SQL')
    assert.equal(params[4], "x' OR 1=1 --")
  }
})

test('janela default é de 30 dias e data inválida não vira NaN', () => {
  const j = janela({})
  const dias = (j.fim - j.inicio) / (24 * 60 * 60 * 1000)
  assert.ok(dias > 29.9 && dias < 30.1, String(dias))
  const ruim = janela({ de: 'não é data', ate: 'nem isso' })
  assert.ok(!Number.isNaN(ruim.inicio.getTime()))
  assert.ok(!Number.isNaN(ruim.fim.getTime()))
})
