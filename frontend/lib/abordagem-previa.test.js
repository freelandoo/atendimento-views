import test from 'node:test'
import assert from 'node:assert'
import { leituraPrevia, MOTIVO } from './abordagem-previa.js'
import fs from 'node:fs'

test('previa: oferta do nicho vence a padrao e o texto diz isso', () => {
  const r = leituraPrevia({ nicho: 'energia solar', gerar_ia: true, motivo: MOTIVO.ESPECIFICA, oferta: { nome: 'CRM', nicho: 'energia solar', site_pronto: false } })
  assert.equal(r.tom, 'ok')
  assert.match(r.titulo, /energia solar/)
  assert.match(r.detalhe, /vence a oferta padrão/)
  assert.match(r.detalhe, /sem prometer material pronto/)
  assert.equal(r.oferta, 'CRM')
})

test('previa: sem correspondencia avisa que NAO usa oferta de outro nicho', () => {
  const r = leituraPrevia({ nicho: 'barbearia', gerar_ia: true, motivo: MOTIVO.SEM_CORRESPONDENCIA, oferta: null })
  assert.equal(r.tom, 'atencao')
  assert.match(r.detalhe, /nunca usa a oferta de outro nicho/)
  assert.equal(r.oferta, '')
})

test('previa: oferta geral quando nao ha secao do nicho', () => {
  const r = leituraPrevia({ nicho: 'barbearia', gerar_ia: true, motivo: MOTIVO.GERAL, oferta: { nome: 'Padrao', geral: true, site_pronto: true } })
  assert.equal(r.tom, 'ok')
  assert.match(r.detalhe, /vale a oferta padrão/)
  assert.match(r.detalhe, /já existe algo pronto/)
})

test('previa: IA desligada nao promete selecao de oferta', () => {
  const r = leituraPrevia({ nicho: 'x', gerar_ia: false, motivo: MOTIVO.ESPECIFICA, oferta: { nome: 'CRM' } })
  assert.match(r.titulo, /não escreve a primeira mensagem/)
  assert.equal(r.oferta, '')
})

test('previa: motivo desconhecido aparece como ele mesmo, nunca escondido', () => {
  const r = leituraPrevia({ motivo: 'motivo_novo_do_servidor', oferta: null })
  assert.equal(r.titulo, 'motivo_novo_do_servidor')
})

test('previa: payload ausente nao quebra', () => {
  assert.equal(leituraPrevia(null).tom, 'neutro')
  assert.equal(leituraPrevia(undefined).tom, 'neutro')
})

test('guarda: o modulo NAO reimplementa a regra de precedencia', () => {
  const fonte = fs.readFileSync(new URL('./abordagem-previa.js', import.meta.url), 'utf8')
  // nada de ESCOLHER oferta no front: sem varrer lista, sem ler `ativo`, sem comparar nichos
  assert.doesNotMatch(fonte, /\.filter\(|\.find\(|\.sort\(/)
  assert.doesNotMatch(fonte, /\bativo\b|normalizarBusca|includes\(/)
})
