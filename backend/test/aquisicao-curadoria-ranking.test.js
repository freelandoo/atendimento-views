'use strict'
// Fila e aprendizado do Assistente de Oportunidades (por lead) — regras PURAS.
//
// O que precisa ser verdade aqui:
//   1. a característica é sempre uma FAIXA (nunca o valor cru, nunca PII);
//   2. sem histórico, o aprendizado é exatamente ZERO — a base decide sozinha;
//   3. com histórico, o aprendizado empurra, mas nunca vira o jogo sozinho;
//   4. uma decisão isolada não pode reordenar a fila inteira (amostra mínima).

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  AMOSTRA_MINIMA,
  PESO_APRENDIZADO,
  caracteristicasDoLead,
  pontuarBase,
  aprenderPesos,
  ajusteAprendido,
  pontuarLead,
  ordenarCandidatos,
} = require('../src/services/aquisicao-curadoria-ranking')

const lead = (over = {}) => ({
  id: 'p1',
  nome: 'Negócio',
  nicho: 'Dentista',
  cidade: 'Campinas - SP',
  telefone: '+55 19 99999-0000',
  email: null,
  site: null,
  tem_site: false,
  rating: 4.6,
  avaliacoes: 120,
  score_cadastro: 30,
  created_at: '2026-08-01T10:00:00Z',
  ...over,
})

test('característica é sempre faixa — nunca o valor cru do lead', () => {
  const c = caracteristicasDoLead(lead())
  assert.equal(c.site, 'sem_site')
  assert.equal(c.contato, 'com_telefone')
  assert.equal(c.email, 'sem_email')
  assert.equal(c.nota, 'nota_alta')
  assert.equal(c.avaliacoes, 'muitas_avaliacoes')
  assert.equal(c.cadastro, 'cadastro_fraco')
  assert.equal(c.nicho, 'dentista')

  // Nenhum valor cru vaza para o vetor: é ele que vai para a IA e para o banco.
  const valores = Object.values(c).join(' ')
  assert.ok(!valores.includes('99999'))
  assert.ok(!valores.includes('Negócio'))
})

test('faixas de borda não escorregam', () => {
  assert.equal(caracteristicasDoLead(lead({ rating: 4 })).nota, 'nota_alta')
  assert.equal(caracteristicasDoLead(lead({ rating: 3.9 })).nota, 'nota_baixa')
  assert.equal(caracteristicasDoLead(lead({ rating: null })).nota, 'sem_nota')
  assert.equal(caracteristicasDoLead(lead({ avaliacoes: 50 })).avaliacoes, 'muitas_avaliacoes')
  assert.equal(caracteristicasDoLead(lead({ avaliacoes: 49 })).avaliacoes, 'poucas_avaliacoes')
  assert.equal(caracteristicasDoLead(lead({ avaliacoes: 0 })).avaliacoes, 'sem_avaliacoes')
  assert.equal(caracteristicasDoLead(lead({ score_cadastro: 40 })).cadastro, 'cadastro_fraco')
  assert.equal(caracteristicasDoLead(lead({ score_cadastro: 41 })).cadastro, 'cadastro_medio')
  assert.equal(caracteristicasDoLead(lead({ score_cadastro: 71 })).cadastro, 'cadastro_forte')
  assert.equal(caracteristicasDoLead(lead({ score_cadastro: null })).cadastro, 'cadastro_desconhecido')
})

test('site preenchido conta como "com site" mesmo com tem_site falso', () => {
  const c = caracteristicasDoLead(lead({ tem_site: false, site: 'https://x.com.br' }))
  assert.equal(c.site, 'com_site')
})

test('base premia a dor digital e sempre explica o porquê', () => {
  const semSite = pontuarBase(caracteristicasDoLead(lead()))
  const comSite = pontuarBase(caracteristicasDoLead(lead({ tem_site: true, site: 'https://x.com.br', score_cadastro: 90 })))
  assert.ok(semSite.pontos > comSite.pontos)
  assert.ok(semSite.motivos.length > 0)
  assert.ok(semSite.motivos.every((m) => typeof m === 'string' && m.length > 0))
})

test('lead sem telefone pontua menos que o mesmo lead com telefone', () => {
  const com = pontuarBase(caracteristicasDoLead(lead()))
  const sem = pontuarBase(caracteristicasDoLead(lead({ telefone: null })))
  assert.ok(com.pontos > sem.pontos)
})

test('sem histórico não existe aprendizado — a fila é só a base', () => {
  const { pesos, amostra } = aprenderPesos([])
  assert.deepEqual(pesos, {})
  assert.equal(amostra, 0)
  assert.equal(ajusteAprendido(caracteristicasDoLead(lead()), pesos), 0)
  assert.equal(pontuarLead(lead(), pesos).ajuste, 0)
})

test('uma ou duas decisões não movem a fila (amostra mínima)', () => {
  const historico = [
    { decisao: 'aprovado', caracteristicas: { site: 'sem_site' } },
    { decisao: 'aprovado', caracteristicas: { site: 'sem_site' } },
  ]
  assert.ok(historico.length < AMOSTRA_MINIMA)
  const { pesos } = aprenderPesos(historico)
  assert.deepEqual(pesos, {})
})

test('o que a empresa aprova sobe; o que ela descarta desce', () => {
  const historico = []
  for (let i = 0; i < 6; i += 1) {
    historico.push({ decisao: 'aprovado', caracteristicas: { site: 'sem_site', nicho: 'dentista' } })
    historico.push({ decisao: 'descartado', caracteristicas: { site: 'com_site', nicho: 'padaria' } })
  }
  const { pesos } = aprenderPesos(historico)
  assert.ok(pesos['site:sem_site'] > 0, 'sem_site deveria puxar para cima')
  assert.ok(pesos['site:com_site'] < 0, 'com_site deveria puxar para baixo')
  assert.ok(pesos['nicho:dentista'] > pesos['nicho:padaria'])
})

test('o aprendizado empurra, mas respeita o teto', () => {
  const historico = []
  for (let i = 0; i < 30; i += 1) {
    historico.push({ decisao: 'aprovado', caracteristicas: { site: 'sem_site', nicho: 'dentista' } })
    historico.push({ decisao: 'descartado', caracteristicas: { site: 'com_site', nicho: 'padaria' } })
  }
  const { pesos } = aprenderPesos(historico)
  const bom = pontuarLead(lead(), pesos)
  const ruim = pontuarLead(lead({ tem_site: true, site: 'https://x', nicho: 'Padaria' }), pesos)
  assert.ok(Math.abs(bom.ajuste) <= PESO_APRENDIZADO)
  assert.ok(Math.abs(ruim.ajuste) <= PESO_APRENDIZADO)
  assert.ok(bom.pontos > ruim.pontos)
})

test('decisão registrada sem características não corrompe o aprendizado', () => {
  const historico = [
    { decisao: 'aprovado', caracteristicas: null },
    { decisao: 'aprovado' },
    ...Array.from({ length: 4 }, () => ({ decisao: 'aprovado', caracteristicas: { site: 'sem_site' } })),
  ]
  const { pesos, amostra } = aprenderPesos(historico)
  assert.equal(amostra, 4, 'linha sem características é ignorada, não contada')
  assert.ok('site:sem_site' in pesos)
})

test('a fila vem do melhor para o pior e desempata pelo lead mais recente', () => {
  const antigo = lead({ id: 'antigo', created_at: '2026-07-01T10:00:00Z' })
  const novo = lead({ id: 'novo', created_at: '2026-08-01T10:00:00Z' })
  const fraco = lead({ id: 'fraco', tem_site: true, site: 'https://x', score_cadastro: 95, avaliacoes: 0, rating: null })

  const ordem = ordenarCandidatos([fraco, antigo, novo]).map((i) => i.lead.id)
  assert.deepEqual(ordem, ['novo', 'antigo', 'fraco'])
})

test('pontuação nunca fica negativa', () => {
  const historico = Array.from({ length: 20 }, () => ({
    decisao: 'descartado',
    caracteristicas: { site: 'com_site', contato: 'sem_telefone', nicho: 'padaria' },
  }))
  const { pesos } = aprenderPesos(historico)
  const p = pontuarLead(
    lead({ tem_site: true, site: 'https://x', telefone: null, nicho: 'Padaria', score_cadastro: 100, avaliacoes: 0, rating: null }),
    pesos
  )
  assert.ok(p.pontos >= 0)
})

test('histórico só de aprovações não ensina nada — e isso é o correto', () => {
  // Se TUDO foi aprovado, nenhuma característica distingue um lead do outro. O
  // aprendizado tem que ficar em zero em vez de inventar preferência.
  const historico = Array.from({ length: 20 }, () => ({
    decisao: 'aprovado',
    caracteristicas: { site: 'sem_site', nicho: 'dentista' },
  }))
  const { pesos, taxa_geral } = aprenderPesos(historico)
  assert.equal(taxa_geral, 1)
  assert.equal(pesos['site:sem_site'], 0)
  assert.equal(pontuarLead(lead(), pesos).ajuste, 0)
})

test('o motivo de reserva menciona o aprendizado quando ele é relevante', () => {
  const historico = []
  for (let i = 0; i < 15; i += 1) {
    historico.push({ decisao: 'aprovado', caracteristicas: { site: 'sem_site', nicho: 'dentista', cadastro: 'cadastro_fraco' } })
    historico.push({ decisao: 'descartado', caracteristicas: { site: 'com_site', nicho: 'padaria', cadastro: 'cadastro_forte' } })
  }
  const { pesos } = aprenderPesos(historico)
  const bom = pontuarLead(lead(), pesos)
  const ruim = pontuarLead(
    lead({ tem_site: true, site: 'https://x', nicho: 'Padaria', score_cadastro: 95 }),
    pesos
  )
  assert.ok(bom.motivos.some((m) => /costuma aprovar/i.test(m)))
  assert.ok(ruim.motivos.some((m) => /costuma descartar/i.test(m)))
})
