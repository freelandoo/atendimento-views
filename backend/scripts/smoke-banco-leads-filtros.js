'use strict'
// SMOKE dos filtros de servidor do Banco de Leads (R7) contra um Postgres DE VERDADE.
//
// Por que existe: os testes de unidade conferem o SQL como TEXTO. O que quebra este tipo de
// mudanca e' o que so' o banco ve — alias de LATERAL que nao existe na contagem, numeracao de
// parametro desalinhada, filtro que casa com coisa diferente do que a tela mostra. Aqui os
// handlers REAIS de `GET /leads` e `GET /export.csv` rodam sobre uma carteira semeada.
//
// ⚠️ ESCREVE no banco (semeia leads). Por isso passa pela MESMA guarda de destino das
// migrations: so' roda em banco LOCAL. No CI, e' o Postgres efemero do job de migrations.
// Uso: DATABASE_URL=postgresql://...@localhost/... npm run smoke:banco-leads-filtros

const assert = require('assert')
const { avaliarDestino, mensagemDeBloqueio } = require('../src/services/destino-migrations')

// `env: {}` de proposito: aqui nem a prova de producao libera — o script SEMEIA dados.
const destino = avaliarDestino({ databaseUrl: process.env.DATABASE_URL, env: {} })
if (!destino.permitido) {
  console.error(mensagemDeBloqueio(destino))
  process.exit(1)
}

const { pool } = require('../src/db')
const router = require('../src/routes/api-banco-leads')
const { STATUS_OPERACIONAL } = require('../src/services/lead-status-operacional')
const PJ = '00000000-0000-0000-0000-000000000001'

function handler(rota) {
  const l = router.stack.find((x) => x.route && x.route.path === rota && x.route.methods.get)
  return l.route.stack[l.route.stack.length - 1].handle
}
const LEADS = handler('/leads')
const EXPORT = handler('/export.csv')

function chamar(h, query, perfil = 'super') {
  const req = {
    query,
    empresa: { id: PJ },
    usuario: { id: '11111111-1111-1111-1111-111111111111', role: perfil === 'super' ? 'superadmin' : 'user' },
    papelEmpresa: perfil === 'super' ? 'owner' : 'comercial',
    vinculoEmpresa: { permissoes: {} },
  }
  return new Promise((resolve, reject) => {
    const res = {
      code: 200,
      status(c) { this.code = c; return this },
      setHeader() {},
      json(o) { resolve({ code: this.code, body: o }) },
      send(s) { resolve({ code: this.code, body: s }) },
    }
    Promise.resolve(h(req, res)).catch(reject)
  })
}

async function total(query, perfil) {
  const r = await chamar(LEADS, { limit: '1', ...query }, perfil)
  if (r.code !== 200) throw new Error(`${JSON.stringify(query)} -> ${r.code} ${JSON.stringify(r.body.error)}`)
  return r.body.meta.total_carteira
}

async function semear() {
  // Carteira variada o bastante para cada particao ter os DOIS lados preenchidos.
  const status = ['coletado', 'aprovado', 'enviado', 'respondeu', 'fechado', 'aguardando']
  const icp = ['A', 'B', 'C', null, 'fora']
  const ids = []
  // Reexecutavel: apaga so' o que ESTE smoke semeou (nicho 'smoke-r7'), sem depender de
  // constraint de unicidade — `place_id` deixou de ser UNIQUE quando a 012 generalizou a
  // identidade do lead para `origem + external_ref`.
  await pool.query(`DELETE FROM prospectador.lead_disparos WHERE evolution_instance LIKE 'smoke-r7%'`)
  await pool.query(`DELETE FROM prospectador.prospects WHERE empresa_id = $1 AND nicho = 'smoke-r7'`, [PJ])
  await pool.query(`DELETE FROM app.empresa_whatsapp_instances WHERE evolution_instance = 'smoke-r7'`)
  for (let i = 0; i < 30; i++) {
    const { rows } = await pool.query(
      `INSERT INTO prospectador.prospects
         (empresa_id, nome, nicho, cidade, place_id, origem, status, tem_site, email, telefone,
          tem_whatsapp, rating, avaliacoes, icp_faixa, instagram_handle, pais, created_at)
       VALUES ($1, $2, 'smoke-r7', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
               NOW() - ($16 || ' days')::interval)
       RETURNING id`,
      [PJ, `Lead ${i}`, i % 2 ? 'Goiania' : 'Recife', `smoke-r7-${i}`, i % 7 === 0 ? 'instagram' : 'manual',
        status[i % status.length], i % 3 === 0, i % 4 === 0 ? `l${i}@x.test` : null,
        i % 5 === 0 ? null : `55629${10000000 + i}`, [true, false, null][i % 3],
        i % 6 === 0 ? null : (i % 5) + 0.5, i % 6 === 0 ? null : i * 3, icp[i % icp.length],
        i % 8 === 0 ? `perfil${i}` : null, i % 9 === 0 ? 'PT' : 'BR', String(i)]
    )
    ids.push(rows[0].id)
  }
  await pool.query('DELETE FROM prospectador.lead_disparos WHERE prospect_id = ANY($1)', [ids])
  // Dois rascunhos em instancias DIFERENTES: e' o que prova que `msg_gerada` respeita a
  // instancia escolhida em vez de contar rascunho de outro numero.
  for (const [i, st, inst] of [[1, 'aguardando_disparo', 'smoke-r7'], [2, 'falhou', 'smoke-r7'],
    [3, 'enviado', 'smoke-r7'], [4, 'aguardando_disparo', 'smoke-r7-outra']]) {
    await pool.query(
      `INSERT INTO prospectador.lead_disparos (empresa_id, prospect_id, evolution_instance, status, mensagem)
       VALUES ($1, $2, $3, $4, 'oi')`,
      [PJ, ids[i], inst, st]
    )
  }
  const { rows } = await pool.query(
    `INSERT INTO app.empresa_whatsapp_instances (empresa_id, evolution_instance, origem_vinculo)
     VALUES ($1, 'smoke-r7', 'atendimento_views')
     RETURNING id`,
    [PJ]
  )
  return rows[0].id
}

;(async () => {
  const instanciaId = await semear()
  const base = await total({})
  assert.ok(base > 0, 'a carteira semeada nao apareceu')
  console.log('carteira:', base)

  // 1) PARTICOES: "com" + "sem" == total. E' o que prova que o filtro nao perde nem duplica lead.
  for (const [k, a, b] of [
    ['site', 'com', 'sem'], ['social', 'com', 'sem'], ['com_email', 'com', 'sem'],
    ['com_telefone', 'com', 'sem'], ['msg_gerada', 'com', 'sem'],
    ['disparo', 'disparado', 'nao_disparado'], ['agendamento', 'com', 'sem'],
  ]) {
    const ta = await total({ [k]: a })
    const tb = await total({ [k]: b })
    assert.strictEqual(ta + tb, base, `${k}: ${ta} + ${tb} != ${base}`)
    assert.ok(k === 'agendamento' || (ta > 0 && tb > 0), `${k}: a semeadura nao cobriu os dois lados`)
  }
  const soma = async (chave, valores) => {
    let n = 0
    for (const v of valores) n += await total({ [chave]: v })
    return n
  }
  assert.strictEqual(await soma('envio', ['possivel', 'impossivel', 'nao_verificado']), base, 'envio')
  assert.strictEqual(await soma('icp', ['A', 'B', 'C', 'sem_icp']), base, 'icp')

  // 2) STATUS OPERACIONAL: as faixas sao exaustivas e exclusivas, e o veredito do payload bate
  // com o filtro — a tela exibe exatamente o que o servidor filtrou.
  let somaStatus = 0
  for (const s of STATUS_OPERACIONAL) {
    const r = await chamar(LEADS, { status_lead: s, limit: '1000' })
    assert.strictEqual(r.code, 200, `status_lead=${s} -> ${r.code}`)
    assert.ok(r.body.data.every((l) => l.status_operacional === s), `payload divergiu do filtro em ${s}`)
    somaStatus += r.body.meta.total_carteira
  }
  assert.strictEqual(somaStatus, base, `status: ${somaStatus} != ${base}`)

  // 3) Filtros de faixa e texto nunca AMPLIAM a carteira, e lixo na URL e' ignorado.
  for (const q of [{ nota_min: '2' }, { aval_max: '20' }, { data_de: '2020-01-01' }, { data_ate: '2020-01-01' },
    { disparo: 'falha' }, { agendamento: 'hoje' }, { agendamento: '7dias' }]) {
    assert.ok(await total(q) <= base, JSON.stringify(q))
  }
  assert.ok(await total({ disparo: 'falha' }) > 0, 'disparo=falha precisa achar o lead semeado')
  // `pais` e' ISO-2 (migration 097); i = 0, 9, 18, 27 sao PT.
  assert.strictEqual(await total({ regiao: 'pt' }), 4, 'regiao precisa olhar o pais')
  assert.strictEqual(await total({ site: 'x', status_lead: 'x', icp: 'Z', envio: '?' }), base, 'lixo na URL filtrou')

  // 4) PAGINACAO: paginas disjuntas e na mesma ordem da janela maior.
  const ids = async (q) => (await chamar(LEADS, q)).body.data.map((l) => l.id)
  const p1 = await ids({ limit: '10', offset: '0' })
  const p2 = await ids({ limit: '10', offset: '10' })
  assert.deepStrictEqual([...p1, ...p2], await ids({ limit: '20', offset: '0' }), 'offset nao reproduz a ordem')

  // 5) Caminho de parametros mais delicado: a instancia entra como parametro DO LATERAL, e a
  // contagem precisa recebe-lo na posicao certa. Sem instancia: 2 rascunhos; com: so' 1.
  assert.strictEqual(await total({ msg_gerada: 'com' }), 2, 'rascunhos sem recorte de instancia')
  assert.strictEqual(await total({ msg_gerada: 'com', instancia_id: instanciaId }), 1, 'msg_gerada ignorou a instancia')
  const combo = await chamar(LEADS, {
    status_lead: 'contatado', msg_gerada: 'sem', agendamento: 'sem', site: 'sem',
    limit: '5', offset: '1', instancia_id: instanciaId,
  })
  assert.strictEqual(combo.code, 200, `combo LATERAL + instancia -> ${JSON.stringify(combo.body.error)}`)

  // 6) Recorte de permissao continua valendo por baixo dos filtros.
  assert.ok(await total({ status_lead: 'contatado' }, 'comercial') <= await total({}, 'comercial'))

  // 7) EXPORT com filtro derivado (antes do R7 o export nao tinha os LATERAL).
  const ex = await chamar(EXPORT, { status_lead: 'contatado', msg_gerada: 'com' })
  assert.strictEqual(ex.code, 200, `export com filtro derivado -> ${JSON.stringify(ex.body && ex.body.error)}`)

  console.log('smoke banco-leads filtros: OK')
  await pool.end()
})().catch(async (e) => {
  console.error('smoke banco-leads filtros FALHOU:', e.message)
  await pool.end()
  process.exit(1)
})
