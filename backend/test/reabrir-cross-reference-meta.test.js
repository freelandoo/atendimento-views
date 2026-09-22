'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const FONTE = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'reabrir-cross-reference-meta.js'), 'utf8'
)

// O CODIGO, sem comentario nenhum. Guarda que le comentario acusa o proprio texto que explica
// a regra — foi o que aconteceu aqui: o comentario "nao mexe em revisao_humana" fazia a guarda
// de "nao mexe em revisao_humana" falhar. Mesma licao do `password_hash` linha a linha.
const CODIGO = FONTE
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !/^\s*\/\//.test(l))
  .join('\n')

// ─── As garantias que fazem este script seguro, lidas no fonte ──────────────

test('GUARDA: simula por padrao — so grava com --aplicar', () => {
  assert.match(FONTE, /aplicar:\s*false/, 'o padrao precisa ser simular')
  assert.match(FONTE, /if \(!args\.aplicar\)/, 'precisa haver a saida antes de gravar')
})

test('GUARDA: exige a URL boa — sem ela o worker repetiria a consulta errada, paga', () => {
  assert.match(
    FONTE,
    /NULLIF\(BTRIM\(p\.anuncio_meta_pagina_url\), ''\) IS NOT NULL/,
    'reabrir sem `anuncio_meta_pagina_url` gastaria credito para reconfirmar a falha'
  )
  // E não pode existir uma flag que contorne isso.
  assert.ok(!/--ignorar-url|--forcar|forcarSemUrl/i.test(FONTE),
    'nao pode haver flag que dispense a URL boa')
})

test('GUARDA: toca UMA etapa e UM motivo — nao mexe em sucesso nem em revisao humana', () => {
  assert.match(FONTE, /const ETAPA = 'meta_ads_pagina'/)
  assert.match(FONTE, /const MOTIVO_ALVO = 'perfil_inexistente'/)
  assert.ok(!/revisao_humana/.test(CODIGO), 'revisao humana e decisao de gente — nao se reabre')
  assert.ok(!/tentativas_esgotadas/.test(CODIGO), 'falha por tentativas tem outra causa')
})

test('GUARDA: nao escreve em prospects nem em Instagram — so devolve a etapa para a fila', () => {
  const updates = FONTE.match(/UPDATE\s+prospectador\.\w+/gi) || []
  for (const u of updates) {
    assert.match(u, /enriquecimento_etapas/,
      `este script so pode atualizar a fila de etapas, e tentou: ${u}`)
  }
  assert.ok(!/instagram_/.test(FONTE), 'Instagram nao e assunto deste script')
})

test('GUARDA: nenhuma chamada externa e nenhuma chamada paga', () => {
  assert.ok(!/require\(|axios|fetch\(|generateAIResponse/i.test(
    CODIGO.replace(/require\('pg'\)/, '')),
  'o script so devolve o item para a fila; o gasto vem depois, no worker, com teto proprio')
})

test('GUARDA: DATABASE_URL explicita — o script nunca escolhe banco sozinho', () => {
  assert.match(FONTE, /process\.env\.DATABASE_URL/)
  assert.match(FONTE, /DATABASE_URL ausente/)
  assert.ok(!/postgres(ql)?:\/\/[^\s'"]+/.test(FONTE.replace(/\/\/.*$/gm, '')),
    'nenhuma URL de banco pode estar embutida no fonte')
})

test('GUARDA: relatorio sem PII', () => {
  assert.ok(!/p\.nome|p\.telefone|p\.endereco|p\.email/.test(FONTE),
    'o relatorio conta linhas; nunca mostra nome, telefone, endereco ou e-mail')
})

test('GUARDA: um COMMIT por lote, nunca um UPDATE massivo', () => {
  assert.match(FONTE, /LIMIT \$\$\{params\.length\}|LIMIT \$/,
    'o UPDATE precisa ser limitado por lote')
  assert.match(FONTE, /for \(;;\)/, 'precisa iterar em lotes ate esgotar')
})

test('GUARDA: imprime o SQL de rollback', () => {
  assert.match(FONTE, /ROLLBACK \(se precisar desfazer\)/)
})

test('GUARDA: zera tentativas, e o motivo esta escrito', () => {
  // A falha anterior foi de endereço errado, não do lead: manter o contador o mataria como
  // `tentativas_esgotadas` antes da primeira consulta real.
  assert.match(FONTE, /tentativas = 0/)
  assert.match(FONTE, /nao foi do lead nem da fonte/i)
})
