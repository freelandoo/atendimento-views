'use strict'
// Segurança do disparo PAGO da Aquisição (Bright Data). Nenhuma chamada real acontece
// aqui: `dispararBuscaMaps` é substituído por um espião que só conta invocações.
//
// O que estes testes provam:
//   - a tentativa é persistida ANTES do disparo pago (nunca há coleta órfã);
//   - duas requisições simultâneas geram UMA coleta paga (trava por empresa);
//   - requisições idênticas são idempotentes;
//   - falha no disparo libera a trava em vez de prendê-la;
//   - cidade + UF compõem a localização enviada à coleta;
//   - duas rotinas vencendo juntas disparam UMA coleta paga.

const test = require('node:test')
const assert = require('node:assert/strict')

const { pool } = require('../src/db')
const placesBrightData = require('../src/services/places-brightdata')
const { pesquisarPlaces, executarRotinasAquisicao } = require('../src/prospecting')

const EMPRESA = '11111111-1111-4111-8111-111111111111'
const TERCA_10H = new Date('2026-06-23T10:00:00-03:00')

// Fake do Postgres que HONRA os dois índices únicos parciais criados na migration 053:
//   busca_snapshots_uma_ativa_por_empresa_uk  (uma coleta em voo por empresa)
//   busca_snapshots_idempotency_uk            (uma coleta por chave)
// `aoVerificarColeta` roda no exato ponto entre a SELEÇÃO da rotina pelo worker e a
// RESERVA do disparo — a janela em que o admin pode pausar a rotina.
function montarAmbiente({ rotinas = [], falharTrigger = null, aoVerificarColeta = null } = {}) {
  const estado = {
    snapshots: [],
    chaves: new Set(),
    rotinas: rotinas.map((r) => ({ ...r })),
    eventos: [],       // ordem real das operações (persistência x disparo)
    triggers: [],      // argumentos de cada chamada PAGA
    seq: 0,
  }

  const erroUnico = (constraint) => {
    const e = new Error('duplicate key value violates unique constraint')
    e.code = '23505'
    e.constraint = constraint
    return e
  }

  const query = async (sql, params = []) => {
    const texto = String(sql)

    if (/INSERT INTO prospectador\.busca_snapshots/i.test(texto)) {
      const [empresaId, nicho, cidade, origem, , rotinaId, quantidade, chave] = params
      if (empresaId && estado.snapshots.some((s) => s.empresa_id === empresaId && ['pendente', 'processando'].includes(s.status))) {
        throw erroUnico('busca_snapshots_uma_ativa_por_empresa_uk')
      }
      if (chave && estado.chaves.has(chave)) throw erroUnico('busca_snapshots_idempotency_uk')
      if (chave) estado.chaves.add(chave)
      const id = `snap-${++estado.seq}`
      estado.snapshots.push({
        id, empresa_id: empresaId, nicho, cidade, origem, status: 'pendente',
        snapshot_id: null, rotina_id: rotinaId, quantidade_solicitada: quantidade,
      })
      estado.eventos.push({ tipo: 'reserva_persistida', id })
      return { rows: [{ id }] }
    }

    if (/UPDATE prospectador\.busca_snapshots/i.test(texto)) {
      const alvo = estado.snapshots.find((s) => s.id === params[0])
      if (alvo && /SET snapshot_id/i.test(texto)) {
        alvo.snapshot_id = params[1]
        estado.eventos.push({ tipo: 'snapshot_vinculado', id: alvo.id })
      } else if (alvo && /status = 'falhou'/i.test(texto)) {
        alvo.status = 'falhou'
        alvo.erro = params[1]
        estado.eventos.push({ tipo: 'reserva_liberada', id: alvo.id })
      }
      return { rows: [] }
    }

    if (/SELECT 1 FROM prospectador\.busca_snapshots/i.test(texto)) {
      if (aoVerificarColeta) aoVerificarColeta(estado)
      const emVoo = estado.snapshots.some((s) => s.empresa_id === params[0] && ['pendente', 'processando'].includes(s.status))
      return { rows: emVoo ? [{ '?column?': 1 }] : [] }
    }

    if (/FROM prospectador\.aquisicao_rotinas/i.test(texto) && /ativo = true/i.test(texto)) {
      return { rows: estado.rotinas.filter((r) => r.ativo) }
    }

    if (/UPDATE prospectador\.aquisicao_rotinas/i.test(texto)) {
      const alvo = estado.rotinas.find((r) => r.id === params[0])
      if (!alvo) return { rows: [] }
      if (/SET ultima_execucao_em = COALESCE/i.test(texto)) {
        // Espelha o WHERE real do marcarDisparo: só dispara se a rotina AINDA está ativa
        // (o admin pode ter pausado depois da seleção) e não está com coleta em voo.
        if (alvo.ativo !== true) return { rows: [] }
        if (['coletando', 'importando'].includes(alvo.estado)) return { rows: [] }
        alvo.ultima_execucao_em = params[1] || new Date().toISOString()
        alvo.total_execucoes = (alvo.total_execucoes || 0) + 1
        alvo.estado = 'coletando'
        estado.eventos.push({ tipo: 'rotina_disparada', id: alvo.id })
        return { rows: [alvo] }
      }
      if (/total_execucoes = GREATEST/i.test(texto)) {
        alvo.ultima_execucao_em = params[1]
        alvo.total_execucoes = Math.max((alvo.total_execucoes || 0) - 1, 0)
        alvo.estado = 'aguardando'
        estado.eventos.push({ tipo: 'rotina_revertida', id: alvo.id })
        return { rows: [alvo] }
      }
      if (/falhas_consecutivas = falhas_consecutivas \+ 1/i.test(texto)) {
        alvo.falhas_consecutivas = (alvo.falhas_consecutivas || 0) + 1
        alvo.ultimo_erro = params[1]
        estado.eventos.push({ tipo: 'rotina_falhou', id: alvo.id })
        return { rows: [alvo] }
      }
      return { rows: [alvo] }
    }

    return { rows: [] }
  }

  const originais = {
    query: pool.query,
    disparar: placesBrightData.dispararBuscaMaps,
    configurado: placesBrightData.brightDataMapsConfigurado,
  }
  pool.query = query
  placesBrightData.brightDataMapsConfigurado = () => true
  placesBrightData.dispararBuscaMaps = async (args) => {
    estado.triggers.push(args)
    estado.eventos.push({ tipo: 'disparo_pago', cidade: args.cidade })
    if (falharTrigger) throw new Error(falharTrigger)
    return { snapshotId: `bd-${estado.triggers.length}` }
  }

  return {
    estado,
    restaurar() {
      pool.query = originais.query
      placesBrightData.dispararBuscaMaps = originais.disparar
      placesBrightData.brightDataMapsConfigurado = originais.configurado
    },
  }
}

const rotina = (over = {}) => ({
  id: 'rot-1',
  empresa_id: EMPRESA,
  nicho: 'dentista',
  cidade: 'Campinas',
  uf: 'SP',
  dias_semana: [1, 2, 3, 4, 5],
  janela_inicio: '08:00',
  janela_fim: '18:00',
  intervalo_horas: 6,
  quantidade: 200,
  ativo: true,
  estado: 'aguardando',
  ultima_execucao_em: null,
  total_execucoes: 0,
  falhas_consecutivas: 0,
  criado_em: '2026-06-01T00:00:00.000Z',
  ...over,
})

// --- persistência antes do disparo pago --------------------------------------

test('a tentativa é persistida ANTES de chamar a Bright Data', async () => {
  const amb = montarAmbiente()
  try {
    await pesquisarPlaces({ nicho: 'dentista', cidade: 'Campinas', uf: 'SP', empresaId: EMPRESA })
    const tipos = amb.estado.eventos.map((e) => e.tipo)
    assert.deepEqual(tipos, ['reserva_persistida', 'disparo_pago', 'snapshot_vinculado'])
    assert.ok(
      tipos.indexOf('reserva_persistida') < tipos.indexOf('disparo_pago'),
      'nenhuma coleta paga pode acontecer sem registro local prévio'
    )
  } finally {
    amb.restaurar()
  }
})

test('falha no disparo libera a trava em vez de prendê-la', async () => {
  const amb = montarAmbiente({ falharTrigger: 'bright data fora do ar' })
  try {
    await assert.rejects(
      () => pesquisarPlaces({ nicho: 'dentista', cidade: 'Campinas', uf: 'SP', empresaId: EMPRESA }),
      /bright data fora do ar/
    )
    const reserva = amb.estado.snapshots[0]
    assert.equal(reserva.status, 'falhou', 'a reserva não pode ficar pendente para sempre')
    assert.match(reserva.erro, /trigger/)
    assert.ok(amb.estado.eventos.some((e) => e.tipo === 'reserva_liberada'))
  } finally {
    amb.restaurar()
  }
})

test('uma nova busca é aceita depois que a anterior falhou', async () => {
  const amb = montarAmbiente()
  try {
    amb.estado.snapshots.push({ id: 'antiga', empresa_id: EMPRESA, status: 'falhou' })
    await pesquisarPlaces({ nicho: 'dentista', cidade: 'Campinas', uf: 'SP', empresaId: EMPRESA })
    assert.equal(amb.estado.triggers.length, 1)
  } finally {
    amb.restaurar()
  }
})

// --- concorrência e idempotência ---------------------------------------------

test('duas requisições SIMULTÂNEAS geram UMA única coleta paga', async () => {
  const amb = montarAmbiente()
  try {
    const resultados = await Promise.allSettled([
      pesquisarPlaces({ nicho: 'dentista', cidade: 'Campinas', uf: 'SP', empresaId: EMPRESA }),
      pesquisarPlaces({ nicho: 'advogado', cidade: 'Sorocaba', uf: 'SP', empresaId: EMPRESA }),
    ])
    assert.equal(amb.estado.triggers.length, 1, 'só uma chamada PAGA pode acontecer')
    assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1)
    const recusada = resultados.find((r) => r.status === 'rejected')
    assert.equal(recusada.reason.statusCode, 409)
    assert.equal(recusada.reason.motivo, 'coleta_em_andamento')
  } finally {
    amb.restaurar()
  }
})

test('requisições IDÊNTICAS simultâneas são idempotentes', async () => {
  const amb = montarAmbiente()
  try {
    const args = { nicho: 'dentista', cidade: 'Campinas', uf: 'SP', empresaId: EMPRESA, agora: TERCA_10H }
    const resultados = await Promise.allSettled([pesquisarPlaces({ ...args }), pesquisarPlaces({ ...args })])
    assert.equal(amb.estado.triggers.length, 1)
    assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1)
    assert.equal(resultados.find((r) => r.status === 'rejected').reason.statusCode, 409)
    assert.equal(amb.estado.snapshots.length, 1, 'nenhuma reserva duplicada é gravada')
  } finally {
    amb.restaurar()
  }
})

test('coleta em andamento bloqueia uma nova sem chamar a Bright Data', async () => {
  const amb = montarAmbiente()
  try {
    amb.estado.snapshots.push({ id: 'em-voo', empresa_id: EMPRESA, status: 'processando' })
    await assert.rejects(
      () => pesquisarPlaces({ nicho: 'dentista', cidade: 'Campinas', uf: 'SP', empresaId: EMPRESA }),
      (err) => err.statusCode === 409
    )
    assert.equal(amb.estado.triggers.length, 0, 'nada pode ser cobrado quando a trava está ativa')
  } finally {
    amb.restaurar()
  }
})

// --- cidade + UF --------------------------------------------------------------

test('cidade e UF compõem a localização enviada à coleta (fluxo manual)', async () => {
  const amb = montarAmbiente()
  try {
    await pesquisarPlaces({ nicho: 'dentista', cidade: 'Santana', uf: 'AP', empresaId: EMPRESA })
    assert.equal(amb.estado.triggers[0].cidade, 'Santana - AP')
    assert.equal(amb.estado.snapshots[0].cidade, 'Santana - AP')
  } finally {
    amb.restaurar()
  }
})

test('sem UF, a busca ainda funciona com a cidade sozinha', async () => {
  const amb = montarAmbiente()
  try {
    await pesquisarPlaces({ nicho: 'dentista', cidade: 'Campinas', empresaId: EMPRESA })
    assert.equal(amb.estado.triggers[0].cidade, 'Campinas')
  } finally {
    amb.restaurar()
  }
})

test('quantidade pedida é registrada e presa em 1..200', async () => {
  const amb = montarAmbiente()
  try {
    await pesquisarPlaces({ nicho: 'dentista', cidade: 'Campinas', uf: 'SP', empresaId: EMPRESA, quantidade: 50 })
    assert.equal(amb.estado.snapshots[0].quantidade_solicitada, 50)
  } finally {
    amb.restaurar()
  }

  const amb2 = montarAmbiente()
  try {
    const r = await pesquisarPlaces({ nicho: 'dentista', cidade: 'Campinas', empresaId: EMPRESA, quantidade: 9999 })
    assert.equal(r.quantidade_solicitada, 200)
  } finally {
    amb2.restaurar()
  }
})

test('nicho ou cidade ausentes são recusados antes de qualquer cobrança', async () => {
  const amb = montarAmbiente()
  try {
    await assert.rejects(() => pesquisarPlaces({ nicho: '', cidade: 'Campinas', empresaId: EMPRESA }), (e) => e.statusCode === 400)
    await assert.rejects(() => pesquisarPlaces({ nicho: 'dentista', cidade: '', empresaId: EMPRESA }), (e) => e.statusCode === 400)
    assert.equal(amb.estado.triggers.length, 0)
    assert.equal(amb.estado.snapshots.length, 0)
  } finally {
    amb.restaurar()
  }
})

// --- motor das rotinas --------------------------------------------------------

test('duas rotinas vencendo ao mesmo tempo: UMA coleta paga por empresa', async () => {
  const amb = montarAmbiente({
    rotinas: [
      rotina({ id: 'rot-a', nicho: 'dentista' }),
      rotina({ id: 'rot-b', nicho: 'advogado' }),
    ],
  })
  try {
    const r = await executarRotinasAquisicao(TERCA_10H)
    assert.equal(r.disparadas, 1)
    assert.equal(amb.estado.triggers.length, 1, 'a segunda rotina entra na fila, não gera cobrança')
    const disparadas = amb.estado.rotinas.filter((x) => x.estado === 'coletando')
    assert.equal(disparadas.length, 1)
    assert.equal(amb.estado.rotinas.find((x) => x.id !== disparadas[0].id).estado, 'aguardando')
  } finally {
    amb.restaurar()
  }
})

test('a rotina disparada entra em "coletando" e conta a execução', async () => {
  const amb = montarAmbiente({ rotinas: [rotina()] })
  try {
    await executarRotinasAquisicao(TERCA_10H)
    const alvo = amb.estado.rotinas[0]
    assert.equal(alvo.estado, 'coletando')
    assert.equal(alvo.total_execucoes, 1)
    assert.ok(alvo.ultima_execucao_em, 'o intervalo passa a contar do disparo')
  } finally {
    amb.restaurar()
  }
})

test('a rotina é marcada ANTES do disparo pago', async () => {
  const amb = montarAmbiente({ rotinas: [rotina()] })
  try {
    await executarRotinasAquisicao(TERCA_10H)
    const tipos = amb.estado.eventos.map((e) => e.tipo)
    assert.ok(tipos.indexOf('rotina_disparada') < tipos.indexOf('disparo_pago'))
    assert.ok(tipos.indexOf('reserva_persistida') < tipos.indexOf('disparo_pago'))
  } finally {
    amb.restaurar()
  }
})

test('rotina fora da janela ou pausada não gera coleta', async () => {
  const amb = montarAmbiente({
    rotinas: [
      rotina({ id: 'pausada', ativo: false }),
      rotina({ id: 'fora', janela_inicio: '20:00', janela_fim: '22:00' }),
      rotina({ id: 'intervalo', ultima_execucao_em: new Date('2026-06-23T09:00:00-03:00').toISOString() }),
    ],
  })
  try {
    const r = await executarRotinasAquisicao(TERCA_10H)
    assert.equal(r.disparadas, 0)
    assert.equal(amb.estado.triggers.length, 0)
  } finally {
    amb.restaurar()
  }
})

test('rotina não dispara quando a empresa já tem coleta em voo', async () => {
  const amb = montarAmbiente({ rotinas: [rotina()] })
  try {
    amb.estado.snapshots.push({ id: 'em-voo', empresa_id: EMPRESA, status: 'processando' })
    const r = await executarRotinasAquisicao(TERCA_10H)
    assert.equal(r.disparadas, 0)
    assert.equal(r.na_fila, 1)
    assert.equal(amb.estado.triggers.length, 0)
    assert.equal(amb.estado.rotinas[0].estado, 'aguardando', 'a rotina mantém a vez para o próximo tick')
  } finally {
    amb.restaurar()
  }
})

// Corrida real: o worker seleciona a rotina, verifica a coleta em voo e só então reserva
// o disparo. Se o admin pausar nessa janela, a pausa TEM de valer — senão o clique em
// "Pausar" ainda deixaria escapar uma coleta paga.
test('pausar a rotina entre a seleção e a reserva impede a coleta paga', async () => {
  const amb = montarAmbiente({
    rotinas: [rotina()],
    aoVerificarColeta: (estado) => {
      // O admin clicou em "Pausar" exatamente agora.
      estado.rotinas[0].ativo = false
      estado.rotinas[0].estado = 'pausada'
    },
  })
  try {
    const r = await executarRotinasAquisicao(TERCA_10H)
    assert.equal(amb.estado.triggers.length, 0, 'nenhuma chamada paga pode acontecer após a pausa')
    assert.equal(amb.estado.snapshots.length, 0, 'nem sequer uma reserva é gravada')
    assert.equal(r.disparadas, 0)

    const alvo = amb.estado.rotinas[0]
    assert.equal(alvo.total_execucoes, 0, 'a execução não pode ser contabilizada')
    assert.equal(alvo.ultima_execucao_em, null, 'o intervalo não pode ser consumido')
    assert.equal(alvo.estado, 'pausada', 'a rotina permanece pausada')
  } finally {
    amb.restaurar()
  }
})

test('rotina pausada durante a corrida não é marcada como falha', async () => {
  const amb = montarAmbiente({
    rotinas: [rotina()],
    aoVerificarColeta: (estado) => { estado.rotinas[0].ativo = false },
  })
  try {
    await executarRotinasAquisicao(TERCA_10H)
    assert.equal(amb.estado.rotinas[0].falhas_consecutivas || 0, 0, 'pausar não é erro do sistema')
    assert.ok(!amb.estado.eventos.some((e) => e.tipo === 'rotina_falhou'))
  } finally {
    amb.restaurar()
  }
})

test('falha no disparo da rotina conta como falha da rotina', async () => {
  const amb = montarAmbiente({ rotinas: [rotina()], falharTrigger: 'timeout' })
  try {
    await executarRotinasAquisicao(TERCA_10H)
    assert.equal(amb.estado.rotinas[0].falhas_consecutivas, 1)
    assert.match(amb.estado.rotinas[0].ultimo_erro, /timeout/)
  } finally {
    amb.restaurar()
  }
})

test('a rotina usa cidade + UF na coleta', async () => {
  const amb = montarAmbiente({ rotinas: [rotina({ cidade: 'Santana', uf: 'AP' })] })
  try {
    await executarRotinasAquisicao(TERCA_10H)
    assert.equal(amb.estado.triggers[0].cidade, 'Santana - AP')
  } finally {
    amb.restaurar()
  }
})

test('duas empresas com rotinas vencidas coletam em paralelo (a trava é por empresa)', async () => {
  const OUTRA = '22222222-2222-4222-8222-222222222222'
  const amb = montarAmbiente({
    rotinas: [rotina({ id: 'a', empresa_id: EMPRESA }), rotina({ id: 'b', empresa_id: OUTRA })],
  })
  try {
    const r = await executarRotinasAquisicao(TERCA_10H)
    assert.equal(r.disparadas, 2)
    assert.equal(amb.estado.triggers.length, 2)
  } finally {
    amb.restaurar()
  }
})

test('sem rotinas ativas o motor não faz nada', async () => {
  const amb = montarAmbiente({ rotinas: [] })
  try {
    const r = await executarRotinasAquisicao(TERCA_10H)
    assert.equal(r.ok, true)
    assert.equal(r.disparadas, 0)
    assert.equal(amb.estado.triggers.length, 0)
  } finally {
    amb.restaurar()
  }
})
