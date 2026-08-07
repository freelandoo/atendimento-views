const test = require('node:test')
const assert = require('node:assert/strict')

const {
  PESOS, FAIXA_ALTA_MIN, SCORE_MAX,
  telefoneDiscavel, elegivelParaFila, situacaoSite, temRedeSocial,
  faixaDoScore, calcularPrioridade, montarFilaPriorizada,
} = require('../src/services/ligacao-prioridade')

// Lead do Maps com site confirmado ausente (caso mais comum da campanha de criacao de site).
const leadBase = {
  telefone: '(11) 99988-7766', place_id: 'ChIJ_x', tem_site: false, site: null,
  avaliacoes: 74, rating: 4.7, tentativas: 0,
}

// --- Telefone: requisito de ENTRADA, sem pontos ---------------------------------------
test('telefone discavel aceita DDD + 8/9 digitos, com e sem DDI', () => {
  assert.equal(telefoneDiscavel('(11) 99988-7766'), true)
  assert.equal(telefoneDiscavel('+55 11 3220-1234'), true)
  assert.equal(telefoneDiscavel('5511992223333'), true)
  assert.equal(telefoneDiscavel('55 9999-8888'), true) // DDD 55 (Santa Maria/RS), sem DDI
})

test('telefone sem DDD, vazio ou irreconhecivel nao e discavel', () => {
  assert.equal(telefoneDiscavel('+55 3220-1234'), false) // DDI declarado, DDD ausente
  assert.equal(telefoneDiscavel('3220-1234'), false)
  assert.equal(telefoneDiscavel(''), false)
  assert.equal(telefoneDiscavel(null), false)
  assert.equal(telefoneDiscavel('123'), false)
})

test('telefone valido nao soma pontos — so deixa entrar na fila', () => {
  const comFone = calcularPrioridade({ ...leadBase })
  const semFone = calcularPrioridade({ ...leadBase, telefone: null })
  assert.equal(comFone.score, semFone.score)
  assert.equal(elegivelParaFila({ ...leadBase, telefone: null }), false)
})

// --- Situacao do site ------------------------------------------------------------------
test('site presente, ausente confirmado e nao identificado sao tres estados', () => {
  assert.equal(situacaoSite({ site: 'https://x.com.br' }), 'tem_site')
  assert.equal(situacaoSite({ tem_site: true }), 'tem_site')
  assert.equal(situacaoSite({ tem_site: false, place_id: 'ChIJ_x' }), 'sem_site')
  // Lead social: ninguem verificou o site — nao e' o mesmo que "nao tem".
  assert.equal(situacaoSite({ tem_site: false, place_id: null, instagram_handle: 'loja' }), 'nao_identificado')
})

test('lead com site NAO e excluido — so perde prioridade', () => {
  const semSite = calcularPrioridade({ ...leadBase })
  const comSite = calcularPrioridade({ ...leadBase, tem_site: true, site: 'https://x.com.br' })
  assert.ok(comSite.score < semSite.score)
  assert.equal(elegivelParaFila({ ...leadBase, tem_site: true, site: 'https://x.com.br' }), true)
  assert.equal(comSite.score - 0, comSite.score) // segue pontuavel (nao vira null)
  assert.equal(semSite.score - comSite.score, PESOS.site_ausente_confirmado)
})

test('site nao identificado vale menos que sem site e mais que com site', () => {
  const naoIdent = calcularPrioridade({ ...leadBase, place_id: null })
  const semSite = calcularPrioridade({ ...leadBase })
  const comSite = calcularPrioridade({ ...leadBase, site: 'https://x.com.br' })
  assert.ok(comSite.score < naoIdent.score && naoIdent.score < semSite.score)
  assert.equal(naoIdent.situacao_site, 'nao_identificado')
})

// --- Faixas de avaliacoes / nota -------------------------------------------------------
test('faixas de avaliacoes pontuam 20 / 12 / 5 e ausente nao penaliza', () => {
  const semAval = { ...leadBase, avaliacoes: null }
  const base = calcularPrioridade(semAval).score
  assert.equal(calcularPrioridade({ ...semAval, avaliacoes: 50 }).score - base, PESOS.avaliacoes_muitas)
  assert.equal(calcularPrioridade({ ...semAval, avaliacoes: 20 }).score - base, PESOS.avaliacoes_medias)
  assert.equal(calcularPrioridade({ ...semAval, avaliacoes: 5 }).score - base, PESOS.avaliacoes_poucas)
  assert.equal(calcularPrioridade({ ...semAval, avaliacoes: 4 }).score - base, 0)
})

test('nota alta soma ate 10 e nota ausente nao e nota baixa', () => {
  const semNota = { ...leadBase, rating: null }
  const base = calcularPrioridade(semNota).score
  assert.equal(calcularPrioridade({ ...semNota, rating: 4.8 }).score - base, PESOS.nota_alta)
  assert.equal(calcularPrioridade({ ...semNota, rating: 4.1 }).score - base, PESOS.nota_boa)
  assert.equal(calcularPrioridade({ ...semNota, rating: 3.6 }).score - base, PESOS.nota_regular)
  assert.equal(calcularPrioridade({ ...semNota, rating: 2.0 }).score - base, 0)
})

// --- Rede social + tentativas ----------------------------------------------------------
test('rede social so pontua quando NAO ha site', () => {
  assert.equal(temRedeSocial({ instagram_handle: 'loja' }), true)
  assert.equal(temRedeSocial({ link_bio: 'https://linktr.ee/x' }), true)
  assert.equal(temRedeSocial({}), false)
  const semSiteComRede = calcularPrioridade({ ...leadBase, instagram_handle: 'loja' })
  const semSiteSemRede = calcularPrioridade({ ...leadBase })
  assert.equal(semSiteComRede.score - semSiteSemRede.score, PESOS.rede_social_sem_site)
  const comSiteComRede = calcularPrioridade({ ...leadBase, site: 'https://x.com.br', instagram_handle: 'loja' })
  const comSiteSemRede = calcularPrioridade({ ...leadBase, site: 'https://x.com.br' })
  assert.equal(comSiteComRede.score, comSiteSemRede.score)
})

test('so o lead INEDITO pontua: 1+ tentativas nao ganha bonus algum', () => {
  const zero = calcularPrioridade({ ...leadBase, tentativas: 0 }).score
  const uma = calcularPrioridade({ ...leadBase, tentativas: 1 }).score
  const duas = calcularPrioridade({ ...leadBase, tentativas: 2 }).score
  const cinco = calcularPrioridade({ ...leadBase, tentativas: 5 }).score
  assert.equal(PESOS.com_tentativa, 0)
  assert.equal(zero - uma, PESOS.sem_tentativa)
  assert.equal(uma, duas)
  assert.equal(duas, cinco)
})

test('tentativa anterior continua explicada no tooltip, mesmo valendo 0 ponto', () => {
  const uma = calcularPrioridade({ ...leadBase, tentativas: 1 })
  const tres = calcularPrioridade({ ...leadBase, tentativas: 3 })
  assert.ok(uma.motivos.some((m) => /^1 tentativa anterior$/.test(m)))
  assert.ok(tres.motivos.some((m) => /^3 tentativas anteriores$/.test(m)))
})

// --- Score final / faixa / explicacao --------------------------------------------------
test('score fica entre 0 e 100 e a faixa acompanha', () => {
  const alto = calcularPrioridade({ ...leadBase, instagram_handle: 'loja' })
  assert.ok(alto.score > 0 && alto.score <= SCORE_MAX)
  assert.ok(alto.score >= FAIXA_ALTA_MIN)
  assert.equal(alto.faixa, 'alta')
  assert.equal(faixaDoScore(0), 'baixa')
  assert.equal(faixaDoScore(SCORE_MAX), 'alta')
  const pior = calcularPrioridade({ telefone: '11999887766', site: 'https://x.com.br', tentativas: 9 })
  assert.equal(pior.score, 0)
  assert.equal(pior.faixa, 'baixa')
})

test('a composicao da pontuacao fica disponivel para a interface', () => {
  const r = calcularPrioridade({ ...leadBase })
  assert.ok(Array.isArray(r.motivos) && r.motivos.length >= 3)
  assert.ok(r.motivos.some((m) => /Sem site/i.test(m)))
  assert.ok(r.motivos.some((m) => /74 avaliacoes/i.test(m)))
  assert.ok(r.motivos.some((m) => /Nota 4,7/.test(m)))
  assert.ok(r.motivos.some((m) => /Nenhuma tentativa/i.test(m)))
  // Nada de PII na explicacao (nome/telefone/e-mail/endereco nunca entram).
  const comPii = calcularPrioridade({ ...leadBase, nome: 'Padaria Central', email: 'a@b.com', endereco: 'Rua X, 10' })
  for (const m of comPii.motivos) {
    assert.doesNotMatch(m, /Padaria Central|a@b\.com|Rua X|99988/)
  }
})

// --- Montagem da fila ------------------------------------------------------------------
test('fila exclui quem nao tem telefone discavel e ordena por prioridade', () => {
  const fila = montarFilaPriorizada([
    { campanha_lead_id: 'a', telefone: '11999887766', place_id: 'p1', tem_site: true, site: 'https://x', tentativas: 3 },
    { campanha_lead_id: 'b', telefone: null, place_id: 'p2', tem_site: false, avaliacoes: 90, rating: 4.9, tentativas: 0 },
    { campanha_lead_id: 'c', telefone: '(11) 3333-4444', place_id: 'p3', tem_site: false, avaliacoes: 74, rating: 4.7, tentativas: 0 },
  ])
  assert.deepEqual(fila.map((l) => l.campanha_lead_id), ['c', 'a'])
  assert.equal(fila.length, 2) // 'b' nao entra e nao conta no total
  assert.ok(fila[0].prioridade.score > fila[1].prioridade.score)
})

test('empate preserva a ordem que veio do banco (sort estavel)', () => {
  const igual = { telefone: '11999887766', place_id: 'p', tem_site: false, avaliacoes: 10, rating: 4.2, tentativas: 1 }
  const fila = montarFilaPriorizada([
    { ...igual, campanha_lead_id: 'primeiro' },
    { ...igual, campanha_lead_id: 'segundo' },
    { ...igual, campanha_lead_id: 'terceiro' },
  ])
  assert.deepEqual(fila.map((l) => l.campanha_lead_id), ['primeiro', 'segundo', 'terceiro'])
})

test('montarFilaPriorizada nao muta a lista recebida', () => {
  const original = [{ campanha_lead_id: 'a', telefone: '11999887766', tem_site: false, place_id: 'p' }]
  const copia = JSON.parse(JSON.stringify(original))
  montarFilaPriorizada(original)
  assert.deepEqual(original, copia)
})
