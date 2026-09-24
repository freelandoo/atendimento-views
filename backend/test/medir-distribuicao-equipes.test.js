'use strict'
// Medicao READ-ONLY da distribuicao por equipe (2026-09-23).
//
// O script roda contra PRODUCAO com autorizacao explicita do operador. A promessa de "somente
// leitura" precisa QUEBRAR O BUILD quando violada — por isso as guardas leem o fonte. Nenhum
// teste aqui abre conexao com banco.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const CAMINHO = path.join(__dirname, '..', 'scripts', 'medir-distribuicao-equipes.js')
const FONTE = fs.readFileSync(CAMINHO, 'utf8')
const M = require('../scripts/medir-distribuicao-equipes')
const DADOS_DIST = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'lead-distribuicao.js'), 'utf8')

function semComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
}

// ─── Guardas de seguranca ──────────────────────────────────────────────────────────────────

test('GUARDA: o script nao contem nenhuma operacao de escrita', () => {
  const codigo = semComentarios(FONTE)
  const proibidos = [
    [/\bINSERT\s+INTO\b/i, 'INSERT INTO'],
    [/\bUPDATE\s+[a-z_"]/i, 'UPDATE <tabela>'],
    [/\bDELETE\s+FROM\b/i, 'DELETE FROM'],
    [/\bALTER\s+(TABLE|SCHEMA|INDEX|SEQUENCE)\b/i, 'ALTER'],
    [/\bCREATE\s+(TABLE|INDEX|TEMP|TEMPORARY|SCHEMA|VIEW|EXTENSION)\b/i, 'CREATE'],
    [/\bDROP\s+(TABLE|INDEX|SCHEMA|VIEW|CONSTRAINT|COLUMN)\b/i, 'DROP'],
    [/\bTRUNCATE\b/i, 'TRUNCATE'],
    [/\bSELECT\b[\s\S]{0,400}?\bINTO\b/i, 'SELECT ... INTO'],
    [/\bFOR\s+UPDATE\b/i, 'FOR UPDATE'],
    [/\bCOMMIT\b/i, 'COMMIT'],
  ]
  for (const [re, nome] of proibidos) assert.ok(!re.test(codigo), `o script promete somente leitura e contem ${nome}`)
})

test('GUARDA: a sessao e READ ONLY e termina em ROLLBACK', () => {
  assert.ok(FONTE.includes("'BEGIN TRANSACTION READ ONLY'"), 'o Postgres precisa recusar escrita nesta sessao')
  assert.ok(FONTE.includes("'ROLLBACK'"), 'a sessao termina sem gravar')
})

test('GUARDA: nenhuma chamada externa e nenhuma dependencia nova', () => {
  const codigo = semComentarios(FONTE)
  for (const proibido of ['axios', 'fetch(', 'http.request', 'https.request', 'evolution', 'generateAIResponse', 'brightdata-client']) {
    assert.ok(!codigo.toLowerCase().includes(proibido.toLowerCase()), `"${proibido}" nao pertence a uma medicao`)
  }
  const requires = [...codigo.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
  assert.deepEqual(requires.filter((r) => !r.startsWith('../src/services/')), ['pg'],
    'so pg e modulos PUROS de src/services — nada que traga pool, worker ou rede')
})

test('GUARDA: o script nunca escolhe banco sozinho', () => {
  const codigo = semComentarios(FONTE)
  assert.ok(codigo.includes('process.env.DATABASE_URL'))
  assert.ok(!/postgres(ql)?:\/\//i.test(codigo), 'nenhuma URL de banco embutida')
})

test('GUARDA: nenhuma coluna de PESSOA ou de LEAD e selecionada', () => {
  const codigo = semComentarios(FONTE)
  for (const proibido of ['u.nome', 'u.email', 'p.telefone', 'p.nome', 'p.email', 'p.endereco', 'c.numero']) {
    assert.ok(!codigo.includes(proibido), `"${proibido}" sairia no relatorio`)
  }
})

test('GUARDA: os predicados sao os da PRODUCAO, importados — nao reescritos', () => {
  // Uma copia aqui mediria uma regra parecida com a de producao, e a validacao nao provaria nada.
  assert.ok(FONTE.includes('D.sqlRedistribuivel('), 'intocado segundo a regra da distribuicao')
  assert.ok(FONTE.includes('D.sqlMotivoProtegido('), 'protegido segundo a regra da distribuicao')
  assert.ok(FONTE.includes('Q.sqlAbordavel('), 'a porta da qualificacao do modulo dono')
  assert.ok(FONTE.includes('podeCapacidade('), 'visibilidade pela regra de capacidade, nunca por papel literal')
})

test('GUARDA: as acoes de auditoria medidas sao as que a distribuicao grava', () => {
  for (const acao of M.ACOES_DISTRIBUICAO) {
    assert.ok(DADOS_DIST.includes(`'${acao}'`), `${acao} nao e gravada por src/db/lead-distribuicao.js`)
  }
})

// ─── Regras puras ──────────────────────────────────────────────────────────────────────────

test('mascarar reduz o uuid ao prefixo e nomeia a ausencia', () => {
  assert.equal(M.mascarar('12345678-aaaa-bbbb'), '12345678…')
  assert.equal(M.mascarar(null), '(sem dono)')
})

const vinculo = (id, papel, extra = {}) => ({ usuario_id: id, papel, permissoes: {}, papel_plataforma: 'user', ...extra })

test('POUSADA: legado com comercial vira INVISIVEL; com owner, nao', () => {
  const r = M.resumirEquipe({
    membros: [vinculo('u1', 'comercial'), vinculo('u2', 'owner')],
    carteira: [
      { responsavel_id: 'u1', leads: 131, intocados: 131, legado: 131, sem_rastro: 0 },
      { responsavel_id: 'u2', leads: 10, intocados: 10, legado: 10, sem_rastro: 0 },
    ],
  })
  assert.equal(r.invisiveis, 131, 'so o legado de quem NAO ve a base bruta')
  const v = M.verificar(r).find((x) => x.chave === 'visibilidade')
  assert.equal(v.ok, false)
  assert.match(v.detalhe, /131/)
})

test('concessao aditiva de LEAD_VER_BRUTOS faz o legado ficar visivel', () => {
  const r = M.resumirEquipe({
    membros: [vinculo('u1', 'comercial', { permissoes: { lead_ver_brutos: true } })],
    carteira: [{ responsavel_id: 'u1', leads: 5, intocados: 5, legado: 5, sem_rastro: 0 }],
  })
  assert.equal(r.invisiveis, 0)
})

test('lead do nicho com quem nao e da equipe e contado, e a soma continua fechando', () => {
  const r = M.resumirEquipe({
    membros: [vinculo('u1', 'comercial')],
    carteira: [
      { responsavel_id: 'u1', leads: 10, intocados: 5, legado: 0 },
      { responsavel_id: null, leads: 7, intocados: 6, legado: 0 },
      { responsavel_id: 'intruso', leads: 3, intocados: 0, legado: 0 },
    ],
  })
  assert.deepEqual(r.fora_da_equipe, { leads: 3, pessoas: 1 })
  assert.equal(r.na_fila, 7)
  assert.equal(r.livres_intocados, 6)
  assert.equal(r.total_nicho, 20)
  assert.equal(r.soma_fecha, true)
})

test('desequilibrio: quem tem menos da metade da media e apontado', () => {
  const r = M.resumirEquipe({
    membros: [vinculo('u1', 'comercial'), vinculo('u2', 'comercial')],
    carteira: [{ responsavel_id: 'u1', leads: 100 }, { responsavel_id: 'u2', leads: 2 }],
  })
  assert.equal(r.abaixo_da_metade, 1)
  assert.equal(M.verificar(r).find((x) => x.chave === 'equilibrio').ok, false)
})

test('equipe saudavel passa nas seis verificacoes', () => {
  const r = M.resumirEquipe({
    membros: [vinculo('u1', 'comercial'), vinculo('u2', 'comercial')],
    carteira: [
      { responsavel_id: 'u1', leads: 10, intocados: 4, legado: 0, sem_rastro: 0 },
      { responsavel_id: 'u2', leads: 9, intocados: 3, legado: 0, sem_rastro: 0 },
    ],
  })
  const v = M.verificar(r)
  assert.equal(v.length, 6)
  assert.ok(v.every((x) => x.ok), v.filter((x) => !x.ok).map((x) => x.rotulo).join(', '))
})

test('o relatorio declara que nada foi gravado e nomeia uma equipe sem PII', () => {
  const r = M.resumirEquipe({ membros: [vinculo('u1234567890', 'comercial')], carteira: [] })
  const texto = M.relatorio({
    equipes: [{ empresa: 'abc12345…', equipe: 'Time Pousada', nicho: 'Pousada', ...r, verificacoes: M.verificar(r) }],
    sem_nicho: [],
    operacoes_30d: [],
  })
  assert.match(texto, /Time Pousada/)
  assert.match(texto, /u1234567…/, 'id de pessoa sai mascarado')
  assert.ok(!texto.includes('u1234567890'), 'id inteiro nunca sai')
  assert.match(texto, /READ ONLY e termina em ROLLBACK/)
  assert.match(texto, /a distribuicao ainda nao foi usada/, 'ausencia de uso e dita, nao escondida')
})
