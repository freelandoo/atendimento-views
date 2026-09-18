'use strict'
// "Minha Operação" (Visão Geral do comercial) — apresentação PURA, sem React e sem rede.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const O = require('./minha-operacao')

const dinheiro = (v) => `R$ ${Number(v).toLocaleString('pt-BR')}`

// ─── Qual visão mostrar ──────────────────────────────────────────────────────────────────

test('quem tem relatorios_ver ve a administrativa; quem NAO tem ve Minha Operacao', () => {
  // O critério não é arbitrário: a tela administrativa DEPENDE dessa capacidade para carregar.
  // Quem não a tem não vê uma tela "menor" — vê um 403.
  assert.equal(O.visaoDoPainel(['relatorios_ver', 'lead_ver_aprovados']), 'administrativa')
  assert.equal(O.visaoDoPainel(['comissao_ver_propria', 'ligacao_operar']), 'minha_operacao')
  assert.equal(O.visaoDoPainel([]), 'minha_operacao')
})

test('sessao ainda carregando NAO escolhe tela', () => {
  // Escolher no escuro faria a pessoa ver a visão errada por um instante a cada carregamento.
  assert.equal(O.visaoDoPainel(null), null)
  assert.equal(O.visaoDoPainel(undefined), null)
})

// ─── Proximidade da meta ─────────────────────────────────────────────────────────────────

test('os marcos 50/75/90/100 acendem nos cortes certos', () => {
  const m = (fracao) => O.proximidade({ fracao, alvo: 100, faltam: 0 }, { formatarValor: dinheiro }).marco
  assert.equal(m(0.1), 0)
  assert.equal(m(0.49), 0)
  assert.equal(m(0.5), 50)
  assert.equal(m(0.74), 50)
  assert.equal(m(0.75), 75)
  assert.equal(m(0.89), 75)
  assert.equal(m(0.9), 90)
  assert.equal(m(1), 100)
})

test('o selo "perto da meta" so aparece a partir de 90%', () => {
  const selo = (fracao) => O.proximidade({ fracao, alvo: 100, faltam: 10 }, { formatarValor: dinheiro }).selo
  assert.equal(selo(0.75), null)
  assert.match(selo(0.9), /perto/i)
  assert.match(selo(1), /alcançada/i)
})

test('a frase NAO soa de deboche com progresso baixo', () => {
  // Com 8% do alvo, "falta pouco!" é piada de mau gosto. Embaixo, a frase é factual.
  const r = O.proximidade({ fracao: 0.08, alvo: 20000, faltam: 18400 }, { formatarValor: dinheiro })
  assert.match(r.frase, /Faltam/)
  assert.match(r.frase, /18\.400/)
  assert.ok(!/quase|pouco|consegue|vamos/i.test(r.frase), 'nada de empolgação falsa em 8%')
})

test('janela ENCERRADA muda o tempo verbal e tira o incentivo', () => {
  // "Você consegue" num desafio que acabou ontem é mentira.
  const r = O.proximidade({ fracao: 0.92, alvo: 20000, faltam: 1600 }, { encerrado: true, formatarValor: dinheiro })
  assert.match(r.frase, /Terminou/)
  assert.equal(r.selo, null, 'desafio encerrado nao ganha selo de "perto"')
  assert.equal(r.intensidade, 'baixa')
})

test('alcancado continua alcancado mesmo depois do prazo', () => {
  const r = O.proximidade({ fracao: 1, alvo: 20000, faltam: 0, alcancado: true }, { encerrado: true, formatarValor: dinheiro })
  assert.equal(r.marco, 100)
  assert.match(r.frase, /alcançada/i)
  assert.equal(r.intensidade, 'conquista')
})

test('SEM meta legivel nao ha barra, marco nem frase', () => {
  // Inventar um marco aqui faria a barra mentir.
  assert.equal(O.proximidade({ fracao: 0.5, alvo: null }, { formatarValor: dinheiro }), null)
  assert.equal(O.proximidade({}, { formatarValor: dinheiro }), null)
  assert.equal(O.proximidade(null, { formatarValor: dinheiro }), null)
  assert.equal(O.proximidade({ alvo: 100, fracao: 'abc' }, { formatarValor: dinheiro }), null)
})

test('a largura da barra nunca passa de 100% nem fica negativa', () => {
  assert.equal(O.proximidade({ fracao: 3.4, alvo: 10, faltam: 0 }, { formatarValor: dinheiro }).largura, '100%')
  assert.equal(O.proximidade({ fracao: -2, alvo: 10, faltam: 10 }, { formatarValor: dinheiro }).largura, '0%')
})

test('a formatacao do dinheiro e INJETADA, nao escolhida aqui', () => {
  // Quem é dono disso é lib/comissao.js — duas formatações divergiriam na mesma tela.
  const r = O.proximidade({ fracao: 0.2, alvo: 100, faltam: 80 }, { formatarValor: () => 'XX' })
  assert.match(r.frase, /XX/)
})

// ─── Fluxo operacional ───────────────────────────────────────────────────────────────────

test('a ordem e por CONSEQUENCIA, nao por volume', () => {
  // Ordenar por quantidade poria "40 leads livres" acima de "1 follow-up vencido".
  const passos = O.proximosPassos({
    leads_livres: 40, followups_vencidos: 1, reunioes_hoje: 2, leads_parados: 5,
  })
  assert.deepEqual(passos.map((p) => p.chave),
    ['followups_vencidos', 'reunioes_hoje', 'leads_parados', 'leads_livres'])
})

test('contagem ZERO nao vira linha', () => {
  // Uma lista que sempre mostra "0 vencidos" treina a pessoa a ignorar a lista inteira.
  assert.deepEqual(O.proximosPassos({ followups_vencidos: 0, leads_livres: 0 }), [])
  assert.deepEqual(O.proximosPassos({}), [])
  assert.deepEqual(O.proximosPassos(null), [])
})

test('cada passo leva a uma tela e tem singular/plural', () => {
  const um = O.proximosPassos({ followups_vencidos: 1 })[0]
  assert.match(um.texto, /1 follow-up com prazo vencido/)
  assert.ok(um.href.startsWith('/dashboard/'))
  assert.ok(um.tom)

  const varios = O.proximosPassos({ reunioes_hoje: 3 })[0]
  assert.match(varios.texto, /3 reuniões/)
})

test('nada pendente aponta o proximo lugar quando ha oportunidade', () => {
  assert.match(O.nadaPendente(true), /leads livres/i)
  assert.ok(O.nadaPendente(false).length > 0)
  assert.ok(!/parab|incr|excelente/i.test(O.nadaPendente(true)), 'e constatacao, nao elogio')
})

// ─── Placar ──────────────────────────────────────────────────────────────────────────────

test('minhaPosicao localiza a pessoa no ranking', () => {
  const ranking = [{ usuario_id: 'a' }, { usuario_id: 'b' }, { usuario_id: 'c' }]
  assert.deepEqual(O.minhaPosicao(ranking, 'b'), { posicao: 2, total: 3 })
})

test('fora do ranking e null, que NAO e "ultimo lugar"', () => {
  // Quem ainda não originou nada no mês não aparece — dizer "3º de 3" seria inventar posição.
  assert.equal(O.minhaPosicao([{ usuario_id: 'a' }], 'z'), null)
  assert.equal(O.minhaPosicao([], 'a'), null)
  assert.equal(O.minhaPosicao(null, 'a'), null)
})

// ─── Guardas de regressão ────────────────────────────────────────────────────────────────

const FONTE = fs.readFileSync(path.join(__dirname, 'minha-operacao.js'), 'utf8')
const SEM_COMENTARIOS = FONTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

test('a REGRA nao vive no front: nada de recalcular nivel, fracao ou comissao', () => {
  for (const proibido of ['faixa', 'percentualDa', 'comissao_base', 'fetch(', 'apiFetch', 'new Date(']) {
    assert.ok(!SEM_COMENTARIOS.includes(proibido), `minha-operacao.js nao pode conter '${proibido}'`)
  }
})

test('o modulo NAO compara papel com literal', () => {
  // A escolha da tela é por CAPACIDADE. Papel literal aqui repetiria o defeito que a Etapa 1 do
  // CRM em equipe corrigiu.
  for (const proibido of ["'comercial'", "'admin'", "'owner'", "'member'", "'superadmin'"]) {
    assert.ok(!SEM_COMENTARIOS.includes(proibido), `nao compare papel com literal: ${proibido}`)
  }
})

test('o MENU acompanha a tela: o item /dashboard muda de rotulo junto', () => {
  // Sem isto o menu diria "Visão Geral" e a tela diria "Minha Operação" — o menu mentiria sobre o
  // próprio destino. A regra é a MESMA capacidade que decide a tela.
  const N = require('./navegacao')
  const rotulo = (caps) => N.navegacaoVisivel({ role: 'user', capacidades: caps })
    .find((n) => n.href === '/dashboard').label

  assert.equal(rotulo(['relatorios_ver']), 'Visão Geral')
  assert.equal(rotulo(['comissao_ver_propria']), 'Minha Operação')
  // Carregando: mantém o padrão. Trocar o texto duas vezes por carregamento é pior.
  assert.equal(rotulo(null), 'Visão Geral')
})

// ─── Contagem de follow-ups ──────────────────────────────────────────────────────────────

const iso = (s) => new Date(s).toISOString()
const AGORA = new Date('2026-09-18T15:00:00-03:00')

test('conta vencidos e de hoje pela MESMA regra da Central de Follow-ups', () => {
  // Um follow-up marcado para as 09h ja' passou das 15h: e' ATRASADO, nao "de hoje". Quem
  // classifica isso e' `lib/followups-fila.js` — este modulo so' conta o que ela decidiu.
  const r = O.contagensDeFollowUp({
    followups: [
      { id: 'a', telefone_digitos: '5511900000001', status: 'aguardando', agendado_para: iso('2026-09-17T10:00:00-03:00') },
      { id: 'b', telefone_digitos: '5511900000002', status: 'aguardando', agendado_para: iso('2026-09-18T09:00:00-03:00') },
      { id: 'c', telefone_digitos: '5511900000003', status: 'aguardando', agendado_para: iso('2026-09-19T10:00:00-03:00') },
    ],
    humanos: [{ numero: '5511900000009@s.whatsapp.net', janela_quando: 'agora' }],
    agora: AGORA,
  })
  assert.deepEqual(r, { vencidos: 2, hoje: 1 })
})

test('follow-up resolvido nao entra em contagem nenhuma', () => {
  // Concluido e cancelado saem da fila de trabalho: contar o que ja' foi feito faria a home
  // mandar a pessoa para uma Central que nao tem nada esperando por ela.
  const r = O.contagensDeFollowUp({
    followups: [
      { id: 'd', telefone_digitos: '5511900000004', status: 'concluido', agendado_para: iso('2026-09-17T10:00:00-03:00') },
      { id: 'e', telefone_digitos: '5511900000005', status: 'cancelado', agendado_para: iso('2026-09-17T10:00:00-03:00') },
    ],
    agora: AGORA,
  })
  assert.deepEqual(r, { vencidos: 0, hoje: 0 })
})

test('sem fonte nenhuma devolve zero, nunca NaN', () => {
  assert.deepEqual(O.contagensDeFollowUp({}), { vencidos: 0, hoje: 0 })
  assert.deepEqual(O.contagensDeFollowUp(null), { vencidos: 0, hoje: 0 })
  assert.deepEqual(O.contagensDeFollowUp({ followups: 'nao e array' }), { vencidos: 0, hoje: 0 })
})

test('GUARDA: o vocabulario de prazo ainda existe em followups-fila', () => {
  // Este modulo cita 'atrasado'/'agora'/'hoje'. Se aquele vocabulario mudar, a contagem
  // silenciosamente zera — foi exatamente assim que a versao anterior desta tela quebrou.
  const fonteFila = fs.readFileSync(path.join(__dirname, 'followups-fila.js'), 'utf8')
  for (const termo of [O.PRAZO_VENCIDO, ...O.PRAZO_DE_HOJE]) {
    assert.ok(fonteFila.includes(`'${termo}'`), `followups-fila.js nao conhece mais o prazo '${termo}'`)
  }
})

test('GUARDA: a contagem NAO reimplementa a classificacao', () => {
  // A regra e' de followups-fila.js. Uma segunda implementacao faria a home e a Central
  // discordarem sobre quantos follow-ups a pessoa tem.
  assert.ok(SEM_COMENTARIOS.includes('montarFila'), 'deve reusar montarFila')
  assert.ok(!/classificarPrazo|mesmoDia|getTime\(\)/.test(SEM_COMENTARIOS), 'nao reclassifique prazo aqui')
})

test('o modulo NAO conhece a comissao de ninguem', () => {
  // O ranking traz nome e faturamento originado; quanto cada um ganha é assunto dele com a
  // empresa (decisão D4).
  assert.ok(!/comissao_valor|comissao_paga|ganho/i.test(SEM_COMENTARIOS))
})
