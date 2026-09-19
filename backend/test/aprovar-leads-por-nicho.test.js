'use strict'
// Aprovacao EM LOTE de um nicho — a "liberacao de nicho" para a equipe comercial.
//
// Esta suite nao testa banco real: testa o CONTRATO dos SQLs e das mensagens. O script atravessa
// a PORTA da operacao comercial (migration 071) em centenas de leads de uma vez, entao o que
// precisa ser protegido e' o recorte — nunca alcancar quem nao deve ser alcancado.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const A = require('../scripts/aprovar-leads-por-nicho')
const { QUALIFICACAO } = require('../src/services/lead-qualificacao')

const RAIZ = path.join(__dirname, '..')
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8')
const SRC = fonte('scripts/aprovar-leads-por-nicho.js')

// Fonte sem comentarios — as guardas falam do CODIGO, e os comentarios deste script citam de
// proposito as palavras proibidas ao explicar por que sao proibidas.
const SRC_CODIGO = SRC.split('\n')
  .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
  .join('\n')

test('SO PROMOVE: o recorte alcanca pendente e legado, e mais nada', () => {
  assert.deepEqual([...A.PROMOVIVEIS].sort(), [QUALIFICACAO.LEGADO, QUALIFICACAO.PENDENTE].sort())
  assert.ok(A.SQL_PROMOVIVEL.includes(`'${QUALIFICACAO.PENDENTE}'`))
  assert.ok(A.SQL_PROMOVIVEL.includes(`'${QUALIFICACAO.LEGADO}'`))
})

test('GUARDA: lead DESCARTADO nunca e ressuscitado', () => {
  // R9 — "lead descartado volta por nova importacao". Alguem recusou aquele lead; decidir de novo
  // o que uma pessoa ja decidiu e o defeito que `qualificacaoAoRecoletar` existe para impedir.
  // Se `descartado` entrar no recorte, o script vira a porta lateral que desfaz triagem humana.
  assert.ok(!A.PROMOVIVEIS.includes(QUALIFICACAO.DESCARTADO), 'descartado fora de PROMOVIVEIS')
  assert.ok(!A.SQL_PROMOVIVEL.includes(QUALIFICACAO.DESCARTADO), 'descartado fora do WHERE')
})

test('GUARDA: lead ja APROVADO nao e tocado (a data e o autor da 1a triagem sao prova)', () => {
  assert.ok(!A.PROMOVIVEIS.includes(QUALIFICACAO.APROVADO))
  // COALESCE nos dois campos: reescreve-los apagaria QUEM triou primeiro e QUANDO.
  assert.match(SRC_CODIGO, /qualificado_em\s*=\s*COALESCE\(qualificado_em/, 'qualificado_em preservado')
  assert.match(SRC_CODIGO, /qualificado_por\s*=\s*COALESCE\(qualificado_por/, 'qualificado_por preservado')
})

test('GUARDA: o UPDATE e sempre escopado por empresa E por nicho', () => {
  // Sem os dois, "aprovar um nicho" viraria "aprovar a base". O isolamento por empresa e
  // invariante deste repositorio (058/060/061) e tem de valer tambem fora das rotas.
  const update = SRC_CODIGO.slice(SRC_CODIGO.indexOf('UPDATE prospectador.prospects AS alvo'))
  assert.match(update, /p\.empresa_id\s*=\s*\$1::uuid/, 'escopo de empresa')
  assert.match(update, /p\.nicho_id\s*=\s*\$2::uuid/, 'escopo de nicho')
})

test('GUARDA: o script NUNCA escreve nicho_id — isso e trabalho do backfill', () => {
  // Sao dois cadeados distintos. Se este script passasse a vincular nicho, existiriam duas
  // reguas de "de que nicho e este lead", e elas divergiriam (decisao D1, 2026-09-18).
  //
  // ⚠️ O recorte e' entre `SET` e `FROM (`, NUNCA um `[^;]*` a partir de `SET`: este projeto
  // omite ponto-e-virgula em JS, entao aquela classe atravessa o arquivo inteiro e a guarda
  // acusa qualquer mencao a `nicho_id` no script — inclusive o WHERE legitimo. E' o mesmo falso
  // positivo ja registrado no AGENTS.md sobre `password_hash` em `db/membros.js`.
  const i = SRC_CODIGO.indexOf('SET status =')
  const setClause = SRC_CODIGO.slice(i, SRC_CODIGO.indexOf('FROM (', i))
  assert.ok(i > 0 && setClause.length > 0, 'o UPDATE mudou de forma — reavalie esta guarda')
  assert.ok(!/nicho_id\s*=/.test(setClause), 'nao pode gravar nicho_id')
  assert.ok(!SRC_CODIGO.includes('INSERT INTO prospectador.prospects'), 'nao cria lead')
})

test('GUARDA: status so PROMOVE, pela mesma lista fechada da rota de ICP', () => {
  for (const s of ['coletado', 'contato_encontrado', 'aguardando']) {
    assert.ok(A.SQL_STATUS_PROMOVIDO.includes(`'${s}'`), `${s} promove`)
  }
  assert.ok(A.SQL_STATUS_PROMOVIDO.includes('ELSE status'), 'qualquer outro status fica como esta')
  // A rota e' o dono do contrato; divergir dela faria a aprovacao em lote e a 1 a 1 deixarem o
  // lead em estados diferentes.
  const rota = fonte('src/routes/api-banco-leads.js')
  assert.ok(rota.includes("WHEN status IN ('coletado', 'contato_encontrado', 'aguardando') THEN 'aprovado'"),
    'a lista fechada mudou na rota — alinhe SQL_STATUS_PROMOVIDO')
})

test('GUARDA: aprovar exige uma PESSOA, e ela precisa poder triar', () => {
  // `qualificado_por` responde "quem triou". Um script nao tria: ele executa a decisao de alguem.
  assert.match(SRC_CODIGO, /aplicar\s*&&\s*!usuarioArg/, 'recusa --aplicar sem --usuario')
  assert.ok(SRC_CODIGO.includes('CAPACIDADES.LEAD_TRIAR'), 'confere a mesma capacidade da rota')
  assert.ok(SRC_CODIGO.includes('avaliarCapacidade'), 'usa o julgamento central, nao papel literal')
  assert.ok(!/papel\s*===\s*'admin'/.test(SRC_CODIGO), 'proibido comparar papel com literal')
})

test('GUARDA: simula por padrao, e DATABASE_URL e sempre explicita', () => {
  assert.match(SRC_CODIGO, /argv\.includes\('--aplicar'\)/)
  assert.ok(SRC_CODIGO.includes('DATABASE_URL nao definida'), 'recusa sem DATABASE_URL')
  assert.ok(!/postgres(ql)?:\/\//.test(SRC_CODIGO), 'nenhuma URL de banco embutida no fonte')
  // As duas funcoes de escrita saem cedo em simulacao.
  assert.match(SRC_CODIGO, /if \(!aplicar\) return out/, 'aprovar() nao grava em simulacao')
})

test('GUARDA: um COMMIT por lote, nunca um UPDATE massivo', () => {
  assert.ok(SRC_CODIGO.includes("'BEGIN'") && SRC_CODIGO.includes("'COMMIT'"), 'transacao explicita')
  assert.ok(SRC_CODIGO.includes("'ROLLBACK'"), 'desfaz o lote em caso de falha')
  assert.match(SRC_CODIGO, /LIMIT \$4/, 'o lote e limitado')
})

test('GUARDA: a auditoria e gravada DENTRO da transacao do lote', () => {
  // Aqui a linha nao e telemetria: e a prova de quem aprovou e de qual era o estado anterior, e e
  // dela que sai o rollback exato. Fora da transacao, um lead poderia ficar aprovado sem registro.
  const lote = SRC_CODIGO.slice(SRC_CODIGO.indexOf("await client.query('BEGIN')"), SRC_CODIGO.indexOf("await client.query('COMMIT')"))
  assert.ok(lote.includes('app.auditoria_eventos'), 'auditoria dentro do BEGIN/COMMIT')
  assert.ok(lote.includes('x.anterior'), 'guarda o estado anterior REAL de cada lead')
})

test('GUARDA: nenhuma PII e nenhuma chamada externa', () => {
  for (const proibido of ['telefone', 'p.nome', 'endereco', 'email_lead', 'raw_json']) {
    assert.ok(!SRC_CODIGO.includes(proibido), `nao pode ler/imprimir ${proibido}`)
  }
  for (const proibido of ['fetch(', 'axios', 'https.request', 'generateAIResponse', 'enviarMensagem']) {
    assert.ok(!SRC_CODIGO.includes(proibido), `nao pode usar ${proibido}`)
  }
})

test('o casamento do nome do nicho limpa QUEBRA DE LINHA, nao so espaco', () => {
  // Mesmo caractere invisivel que fez um nicho aparecer duas vezes no raio-x do backfill.
  for (const chr of ['chr(32)', 'chr(9)', 'chr(10)', 'chr(13)']) {
    assert.ok(SRC_CODIGO.includes(chr), `precisa limpar ${chr}`)
  }
  assert.ok(!/ILIKE|similarity|levenshtein/i.test(SRC_CODIGO), 'nome de nicho nao casa por aproximacao')
})

test('montarAchados declara a simulacao e conta os descartados preservados', () => {
  const achados = A.montarAchados(
    { total: 412, promoviveis: 380, jaAprovados: 29, descartados: 3, aprovados: 0 },
    { aplicar: false, nichoNome: 'Energia Solar' }
  )
  assert.ok(achados.some((a) => a.includes('412 lead(s) no nicho "Energia Solar"')))
  assert.ok(achados.some((a) => a.includes('SIMULACAO')))
  assert.ok(achados.some((a) => a.includes('3 lead(s) descartado(s) NAO sao tocados')))
})

test('montarAchados nao trata nicho vazio como defeito, e aponta o backfill', () => {
  const achados = A.montarAchados(
    { total: 0, promoviveis: 0, jaAprovados: 0, descartados: 0, aprovados: 0 },
    { aplicar: false, nichoNome: 'Energia Solar' }
  )
  // Lead sem `nicho_id` fica fora do recorte por equipe E deste script. Sem esta frase, o operador
  // concluiria que nao ha leads do nicho quando o que falta e' o vinculo.
  assert.ok(achados.some((a) => a.includes('backfill:prospects-nicho')))
})

test('o aviso de que a aprovacao PULA A TRIAGEM aparece tambem em simulacao', () => {
  // E' o unico ponto que diz, em texto, a consequencia de negocio da acao. Ele nao pode depender
  // de `--aplicar`: quem simula esta justamente decidindo se vai aplicar.
  assert.ok(A.avisoDeTriagem(380).includes('sem passar pela triagem'))
  assert.equal(A.avisoDeTriagem(0), null, 'sem leads a aprovar, nao ha o que avisar')
})

test('a acao de auditoria nomeia o LOTE, distinguindo-a da triagem 1 a 1', () => {
  // `lead_icp_avaliado` e uma pessoa decidindo um lead; esta e uma decisao de nicho inteiro.
  // Um nome so faria as duas virarem a mesma coisa no historico.
  assert.equal(A.ACAO_AUDITORIA, 'lead_qualificacao_aprovada_em_lote')
  assert.ok(!A.ACAO_AUDITORIA.includes('icp'))
})
