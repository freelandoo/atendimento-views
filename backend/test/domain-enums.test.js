const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  AGENDA_VENDAS, AGENDA_APP, EVENTOS_COMERCIAIS_TIPOS, JOB_QUEUE_TIPOS,
  ROTEIRO_VERSAO_STATUS, ROTEIRO_ETAPA_TIPO, CAMPANHA_STATUS, OPORTUNIDADE_STATUS,
  LIGACAO_RESULTADO, LIGACAO_STATUS, SINAL_TIPO, SINAL_ORIGEM, OBJECAO_ORIGEM,
  PERGUNTA_STATUS, MOTIVO_PERDA,
  FOLLOWUP_CANAL, FOLLOWUP_STATUS, FOLLOWUP_PRIORIDADE, FOLLOWUP_ORIGEM,
  DISPONIBILIDADE_CANAIS, DISPONIBILIDADE_ORIGEM,
} = require('../src/domain-enums')

const initSql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'init.sql'), 'utf8')
const mig011 = fs.readFileSync(path.join(__dirname, '..', 'sql', 'migrations', '011_agenda_multiempresa.sql'), 'utf8')
const mig032 = fs.readFileSync(path.join(__dirname, '..', 'sql', 'migrations', '032_eventos_comerciais_auto_reply.sql'), 'utf8')
const mig033 = fs.readFileSync(path.join(__dirname, '..', 'sql', 'migrations', '033_roteiros.sql'), 'utf8')
const mig039 = fs.readFileSync(path.join(__dirname, '..', 'sql', 'migrations', '039_campanhas.sql'), 'utf8')
const mig040 = fs.readFileSync(path.join(__dirname, '..', 'sql', 'migrations', '040_ligacoes.sql'), 'utf8')
const mig041 = fs.readFileSync(path.join(__dirname, '..', 'sql', 'migrations', '041_ligacoes_estado.sql'), 'utf8')
const mig044 = fs.readFileSync(path.join(__dirname, '..', 'sql', 'migrations', '044_ligacao_sinais.sql'), 'utf8')
const mig045 = fs.readFileSync(path.join(__dirname, '..', 'sql', 'migrations', '045_ligacao_objecoes.sql'), 'utf8')
const mig043 = fs.readFileSync(path.join(__dirname, '..', 'sql', 'migrations', '043_ligacao_perguntas.sql'), 'utf8')
const mig052 = fs.readFileSync(path.join(__dirname, '..', 'sql', 'migrations', '052_ligacoes_motivo_perda_v2.sql'), 'utf8')
const mig062 = fs.readFileSync(path.join(__dirname, '..', 'sql', 'migrations', '062_follow_ups.sql'), 'utf8')
const mig066 = fs.readFileSync(path.join(__dirname, '..', 'sql', 'migrations', '066_contato_canal_disponibilidade.sql'), 'utf8')

// Extrai a lista de valores da primeira CHECK (... IN (...)) que segue o nome da constraint.
function checkIn(sql, constraintName) {
  const m = sql.match(new RegExp(constraintName + '[\\s\\S]*?\\bIN\\s*\\(([^)]*)\\)'))
  if (!m) return null
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
}
function mesmoConjunto(codigo, sql, rotulo) {
  assert.ok(Array.isArray(sql), `${rotulo}: nao achei a CHECK no SQL`)
  assert.deepEqual([...codigo].sort(), [...sql].sort(),
    `${rotulo}: enum do codigo (domain-enums.js) divergiu da CHECK no SQL`)
}

test('AGENDA_VENDAS bate com a CHECK de vendas.agenda_eventos (sql/init.sql)', () => {
  mesmoConjunto(AGENDA_VENDAS.TIPOS, checkIn(initSql, 'agenda_eventos_tipo_chk'), 'vendas.tipo')
  mesmoConjunto(AGENDA_VENDAS.STATUS, checkIn(initSql, 'agenda_eventos_status_chk'), 'vendas.status')
  mesmoConjunto(AGENDA_VENDAS.PRIORIDADES, checkIn(initSql, 'agenda_eventos_prioridade_chk'), 'vendas.prioridade')
})

test('AGENDA_APP bate com a CHECK de app.agenda_eventos (migration 011)', () => {
  mesmoConjunto(AGENDA_APP.TIPOS, checkIn(mig011, 'agenda_eventos_tipo_chk'), 'app.tipo')
  mesmoConjunto(AGENDA_APP.STATUS, checkIn(mig011, 'agenda_eventos_status_chk'), 'app.status')
})

test('EVENTOS_COMERCIAIS_TIPOS bate com a CHECK eventos_comerciais_tipo_chk (init.sql + migration 032)', () => {
  mesmoConjunto(EVENTOS_COMERCIAIS_TIPOS, checkIn(initSql, 'eventos_comerciais_tipo_chk'), 'eventos_comerciais(init.sql)')
  mesmoConjunto(EVENTOS_COMERCIAIS_TIPOS, checkIn(mig032, 'eventos_comerciais_tipo_chk'), 'eventos_comerciais(migration 032)')
})

test('db-crud.registrarEventoComercial usa a fonte unica (whitelist = EVENTOS_COMERCIAIS_TIPOS)', () => {
  // Garante que o whitelist do codigo nao voltou a ser um array literal solto.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'db-crud.js'), 'utf8')
  assert.match(src, /new Set\(EVENTOS_COMERCIAIS_TIPOS\)/, 'db-crud deve construir o Set a partir da fonte unica')
})

test('JOB_QUEUE_TIPOS bate com a CHECK job_queue_tipo_chk (sql/init.sql)', () => {
  mesmoConjunto(JOB_QUEUE_TIPOS, checkIn(initSql, 'job_queue_tipo_chk'), 'job_queue')
})

// Varre src/ por INSERTs literais em vendas.job_queue e coleta o tipo. Enqueues
// parametrizados (VALUES ($1, ...)) nao casam (nao tem aspas) — sao validados no proprio
// produtor. Pega o risco concreto: um produtor enfileirar um tipo fora da CHECK.
function scanEnqueueTipos(dir, out = new Set()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { scanEnqueueTipos(full, out); continue }
    if (!entry.name.endsWith('.js')) continue
    const txt = fs.readFileSync(full, 'utf8')
    const re = /INSERT\s+INTO\s+vendas\.job_queue[\s\S]{0,200}?VALUES\s*\(\s*'([a-z_]+)'/g
    let m
    while ((m = re.exec(txt))) out.add(m[1])
  }
  return out
}

test('job_queue: todo tipo literal enfileirado em src/ esta na fonte unica (== CHECK)', () => {
  const enfileirados = scanEnqueueTipos(path.join(__dirname, '..', 'src'))
  assert.ok(enfileirados.size > 0, 'esperava achar ao menos um enqueue literal de job_queue')
  for (const tipo of enfileirados) {
    assert.ok(JOB_QUEUE_TIPOS.includes(tipo),
      `job_queue: produtor enfileira '${tipo}', que NAO esta na CHECK job_queue_tipo_chk — INSERT seria rejeitado (falha silenciosa)`)
  }
})

test('ROTEIRO_* batem com as CHECK de roteiro_versoes/roteiro_etapas (migration 033)', () => {
  mesmoConjunto(ROTEIRO_VERSAO_STATUS, checkIn(mig033, 'roteiro_versoes_status_chk'), 'roteiro_versao_status')
  mesmoConjunto(ROTEIRO_ETAPA_TIPO, checkIn(mig033, 'roteiro_etapas_tipo_chk'), 'roteiro_etapa_tipo')
})

test('CAMPANHA_STATUS / OPORTUNIDADE_STATUS batem com as CHECK (migration 039)', () => {
  mesmoConjunto(CAMPANHA_STATUS, checkIn(mig039, 'campanhas_status_chk'), 'campanha_status')
  mesmoConjunto(OPORTUNIDADE_STATUS, checkIn(mig039, 'campanha_leads_status_chk'), 'oportunidade_status')
})

test('LIGACAO_RESULTADO bate com a CHECK ligacoes_resultado_chk (migration 040)', () => {
  mesmoConjunto(LIGACAO_RESULTADO, checkIn(mig040, 'ligacoes_resultado_chk'), 'ligacao_resultado')
})

// A CHECK de motivo_perda nasceu na 040 e foi REDEFINIDA pela 052 — o anti-drift tem de
// comparar com a definicao ATUAL, senao trava o enum na versao antiga.
test('MOTIVO_PERDA bate com a CHECK ligacoes_motivo_perda_chk (migration 052, que redefine a 040)', () => {
  mesmoConjunto(MOTIVO_PERDA, checkIn(mig052, 'ligacoes_motivo_perda_chk'), 'motivo_perda')
})

// Trava a decisao da 052: estes dois valores pertencem a OUTRO dominio e nao podem voltar.
// 'numero_invalido' e' disposicao da chamada (LIGACAO_RESULTADO); 'pediu_novo_contato' e'
// adiamento (resultado='reagendou' + follow_up), nao perda.
test('MOTIVO_PERDA nao reintroduz os valores descontinuados pela 052', () => {
  for (const proibido of ['numero_invalido', 'pediu_novo_contato']) {
    assert.ok(!MOTIVO_PERDA.includes(proibido),
      `'${proibido}' saiu de MOTIVO_PERDA na migration 052 — reintroduzir volta a permitir registro contraditorio/inflacao de perdas`)
  }
  assert.ok(LIGACAO_RESULTADO.includes('numero_invalido'),
    'numero_invalido deve seguir existindo como RESULTADO (disposicao da chamada)')
})

test('LIGACAO_STATUS bate com a CHECK ligacoes_status_chk (migration 041)', () => {
  mesmoConjunto(LIGACAO_STATUS, checkIn(mig041, 'ligacoes_status_chk'), 'ligacao_status')
})

test('SINAL_TIPO / SINAL_ORIGEM batem com as CHECK ligacao_sinais_* (migration 044)', () => {
  mesmoConjunto(SINAL_TIPO, checkIn(mig044, 'ligacao_sinais_tipo_chk'), 'sinal_tipo')
  mesmoConjunto(SINAL_ORIGEM, checkIn(mig044, 'ligacao_sinais_origem_chk'), 'sinal_origem')
})

test('OBJECAO_ORIGEM bate com a CHECK ligacao_objecoes_origem_chk (migration 045)', () => {
  mesmoConjunto(OBJECAO_ORIGEM, checkIn(mig045, 'ligacao_objecoes_origem_chk'), 'objecao_origem')
})

test('PERGUNTA_STATUS bate com a CHECK ligacao_perguntas_status_chk (migration 043)', () => {
  mesmoConjunto(PERGUNTA_STATUS, checkIn(mig043, 'ligacao_perguntas_status_chk'), 'pergunta_status')
})

test('FOLLOWUP_* batem com as CHECK de app.follow_ups (migration 062)', () => {
  mesmoConjunto(FOLLOWUP_CANAL, checkIn(mig062, 'follow_ups_canal_chk'), 'follow_up.canal')
  mesmoConjunto(FOLLOWUP_STATUS, checkIn(mig062, 'follow_ups_status_chk'), 'follow_up.status')
  mesmoConjunto(FOLLOWUP_PRIORIDADE, checkIn(mig062, 'follow_ups_prioridade_chk'), 'follow_up.prioridade')
  mesmoConjunto(FOLLOWUP_ORIGEM, checkIn(mig062, 'follow_ups_origem_chk'), 'follow_up.origem')
})

test('DISPONIBILIDADE_* batem com as CHECK de app.contato_canal_disponibilidade (migration 066)', () => {
  mesmoConjunto(DISPONIBILIDADE_CANAIS, checkIn(mig066, 'contato_canal_disp_canal_chk'), 'disponibilidade.canal')
  mesmoConjunto(DISPONIBILIDADE_ORIGEM, checkIn(mig066, 'contato_canal_disp_origem_chk'), 'disponibilidade.origem')
})

test('a origem da marcacao de disponibilidade tem UM valor, e ele e humano', () => {
  // Nao e' redundancia com o anti-drift: e a regra de negocio. Acrescentar aqui (ou na CHECK)
  // um valor como 'automatico' seria autorizar falha de envio a decidir que um contato nao
  // tem WhatsApp — o defeito que a migration 066 existe para impedir.
  assert.deepEqual([...DISPONIBILIDADE_ORIGEM], ['operador'])
  assert.doesNotMatch(mig066, /DEFAULT\s+'operador'/i,
    'origem NAO pode ter DEFAULT: autorizaria em silencio um INSERT que esquecesse a coluna')
})

test('os enums de follow-up sao REEXPORTADOS do modulo puro, nao copiados', () => {
  // Duplicar os arrays aqui criaria exatamente o drift que este arquivo existe para impedir.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'domain-enums.js'), 'utf8')
  assert.match(src, /require\('\.\/services\/follow-up-modelo'\)/,
    'domain-enums deve importar o vocabulario de follow-up da fonte unica')
  const modelo = require('../src/services/follow-up-modelo')
  assert.equal(FOLLOWUP_CANAL, modelo.FOLLOWUP_CANAL, 'tem de ser a MESMA referencia, nao uma copia')
  assert.equal(FOLLOWUP_STATUS, modelo.FOLLOWUP_STATUS)
})

test('arrays da fonte unica sem duplicatas e nao vazios', () => {
  for (const arr of [AGENDA_VENDAS.TIPOS, AGENDA_VENDAS.STATUS, AGENDA_VENDAS.PRIORIDADES,
    AGENDA_APP.TIPOS, AGENDA_APP.STATUS, AGENDA_APP.PRIORIDADES, EVENTOS_COMERCIAIS_TIPOS,
    ROTEIRO_VERSAO_STATUS, ROTEIRO_ETAPA_TIPO, CAMPANHA_STATUS, OPORTUNIDADE_STATUS,
    LIGACAO_RESULTADO, LIGACAO_STATUS, SINAL_TIPO, SINAL_ORIGEM, OBJECAO_ORIGEM,
    PERGUNTA_STATUS, MOTIVO_PERDA,
    FOLLOWUP_CANAL, FOLLOWUP_STATUS, FOLLOWUP_PRIORIDADE, FOLLOWUP_ORIGEM]) {
    assert.ok(arr.length > 0)
    assert.equal(new Set(arr).size, arr.length, 'ha valor duplicado no enum')
  }
})

test('agenda.js e agenda-multiempresa.js carregam consumindo a fonte unica', () => {
  // Regressao de import: garante que os modulos resolvem './domain-enums' / '../domain-enums'.
  const agenda = require('../src/agenda')
  const multi = require('../src/services/agenda-multiempresa')
  assert.equal(typeof agenda.criarEventoAgenda, 'function')
  assert.equal(typeof multi.criarEvento, 'function')
})
