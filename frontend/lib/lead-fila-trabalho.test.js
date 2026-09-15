'use strict'
// Ordem de trabalho do Banco de Leads — apresentação pura.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const F = require('./lead-fila-trabalho')

test('a ordem das faixas comeca por quem tem alguem esperando e termina no historico', () => {
  assert.equal(F.ORDEM_FAIXAS[0], 'cliente_esperando')
  assert.equal(F.ORDEM_FAIXAS[F.ORDEM_FAIXAS.length - 1], 'fora_da_fila')
  // "nao trabalhado" vem antes de "sem telefone": era o inverso disso que punha o lead
  // incontatavel na primeira linha do vendedor.
  assert.ok(F.ORDEM_FAIXAS.indexOf('nunca_abordado') < F.ORDEM_FAIXAS.indexOf('falta_contato'))
})

test('toda faixa tem rotulo e explicacao — cor nunca e o unico sinal', () => {
  for (const chave of F.ORDEM_FAIXAS) {
    const selo = F.seloFaixa(chave)
    assert.ok(selo, `faixa sem selo: ${chave}`)
    assert.ok(selo.rotulo.length > 0)
    assert.ok(selo.dica.length > 0)
    assert.ok(selo.tom.length > 0)
  }
})

test('faixa desconhecida devolve null em vez de inventar rotulo', () => {
  assert.equal(F.seloFaixa('faixa_que_nao_existe'), null)
  assert.equal(F.seloFaixa(null), null)
  assert.equal(F.seloFaixa(''), null)
})

test('o aviso de janela so aparece quando a carteira e maior que o que veio', () => {
  assert.equal(F.avisoDeJanela({ total: 120, total_carteira: 120 }), null)
  assert.equal(F.avisoDeJanela(null), null)
  assert.equal(F.avisoDeJanela({ total: 300 }), null)
  const aviso = F.avisoDeJanela({ total: 300, total_carteira: 1240, limite: 300 })
  assert.equal(aviso.total, 1240)
  assert.equal(aviso.mostrando, 300)
  assert.match(aviso.texto, /1240/)
})

// ─── Guarda de regressao ────────────────────────────────────────────────────────────────────
// A tela NAO reclassifica. Quem decide a faixa e' o backend, dentro da consulta; aqui so' se
// traduz o nome que ele mandou. Se este modulo passar a olhar os campos da classificacao, a
// ordem da tela pode divergir da ordem (e da paginacao) do servidor sem ninguem perceber.
test('o modulo NAO reimplementa a classificacao da fila', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'lead-fila-trabalho.js'), 'utf8')
  const corpo = fonte
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')
  for (const proibido of ['rodado_em', 'mensagem_gerada', 'bloqueado_ate', 'proximo_agendamento', 'tem_whatsapp']) {
    assert.ok(!corpo.includes(proibido), `lib traduz, nao classifica: achei ${proibido}`)
  }
  // `status` e `telefone` tambem nao entram — sao exatamente os campos da regra do backend.
  assert.ok(!/\.status\b/.test(corpo), 'lib nao le status do lead')
  assert.ok(!/\btelefone\b/.test(corpo.replace(/'[^']*'/g, '')), 'lib nao le telefone do lead')
})
