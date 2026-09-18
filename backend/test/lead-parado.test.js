'use strict'
// Operação Comercial, Etapa 3 — LEAD PARADO. Regra PURA + guardas.
//
// O que esta suíte protege: que "parado" continue sendo uma MARCA sobre lead que tem dono, e que
// o sistema nunca passe a devolver atribuição sozinho.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const P = require('../src/services/lead-parado')

const RAIZ = path.join(__dirname, '..')
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8')

const AGORA = new Date('2026-09-18T12:00:00Z')
const diasAtras = (n) => new Date(AGORA.getTime() - n * 24 * 60 * 60 * 1000)

// ─── A regra ─────────────────────────────────────────────────────────────────────────────

test('lead SEM responsavel NUNCA esta parado — ele esta na fila', () => {
  // Lead livre é estado legítimo (migration 072). Chamar de "parado" juntaria dois problemas com
  // donos diferentes: um é de quem assumiu, o outro de quem distribui.
  const r = P.classificar({ responsavelId: null, ultimaAcao: diasAtras(90), agora: AGORA })
  assert.equal(r.parado, false)
  assert.equal(r.motivo, P.MOTIVO.SEM_RESPONSAVEL)
  assert.equal(r.dias_sem_acao, null)
})

test('assumido e NUNCA tocado conta desde a ATRIBUICAO', () => {
  const r = P.classificar({
    responsavelId: 'u1', ultimaAcao: null, responsavelDesde: diasAtras(10),
    prazoDias: 7, agora: AGORA,
  })
  assert.equal(r.parado, true)
  assert.equal(r.motivo, P.MOTIVO.NUNCA_TOCADO)
  assert.equal(r.dias_sem_acao, 10)
})

test('trabalho que COMECOU e parou tem motivo proprio', () => {
  // A conversa com o vendedor é diferente: um nunca começou, o outro abandonou no meio.
  const r = P.classificar({
    responsavelId: 'u1', ultimaAcao: diasAtras(20), responsavelDesde: diasAtras(60),
    prazoDias: 7, agora: AGORA,
  })
  assert.equal(r.parado, true)
  assert.equal(r.motivo, P.MOTIVO.SEM_ACAO_RECENTE)
  assert.equal(r.dias_sem_acao, 20)
})

test('a ULTIMA acao vence a atribuicao antiga', () => {
  // Lead assumido há 60 dias mas tocado ontem NÃO está parado.
  const r = P.classificar({
    responsavelId: 'u1', ultimaAcao: diasAtras(1), responsavelDesde: diasAtras(60),
    prazoDias: 7, agora: AGORA,
  })
  assert.equal(r.parado, false)
  assert.equal(r.motivo, P.MOTIVO.ATIVO)
  assert.equal(r.dias_sem_acao, 1)
})

test('o limite e >= prazo: no dia exato ja conta', () => {
  const noPrazo = P.classificar({ responsavelId: 'u1', ultimaAcao: diasAtras(7), prazoDias: 7, agora: AGORA })
  assert.equal(noPrazo.parado, true)
  const umDiaAntes = P.classificar({ responsavelId: 'u1', ultimaAcao: diasAtras(6), prazoDias: 7, agora: AGORA })
  assert.equal(umDiaAntes.parado, false)
})

test('prazo invalido cai no padrao, e 0 NUNCA e aceito', () => {
  // Prazo 0 marcaria a carteira inteira como parada no mesmo instante em que alguém assumisse.
  for (const v of [0, -5, 'abc', null, undefined, 999, 91]) {
    assert.equal(P.normalizarPrazo(v), P.PRAZO_PADRAO_DIAS, `prazo ${JSON.stringify(v)}`)
  }
  assert.equal(P.normalizarPrazo(15), 15)
  assert.equal(P.normalizarPrazo('30'), 30)
  assert.equal(P.normalizarPrazo(P.PRAZO_MIN_DIAS), P.PRAZO_MIN_DIAS)
  assert.equal(P.normalizarPrazo(P.PRAZO_MAX_DIAS), P.PRAZO_MAX_DIAS)
})

test('dado fora do contrato NAO marca ninguem', () => {
  // `responsavel_desde` é NOT NULL quando há responsável (CHECK da 072). Chegar aqui sem nenhuma
  // referência significa dado quebrado — e marcar o vendedor por um defeito do sistema seria
  // acusá-lo de algo que ele não fez.
  const r = P.classificar({ responsavelId: 'u1', ultimaAcao: null, responsavelDesde: null, agora: AGORA })
  assert.equal(r.parado, false)
  assert.equal(r.dias_sem_acao, null)
  assert.doesNotThrow(() => P.classificar())
  assert.doesNotThrow(() => P.classificar({ responsavelId: 'u1', ultimaAcao: 'data-ruim', responsavelDesde: 'ruim' }))
})

// ─── As expressões SQL ───────────────────────────────────────────────────────────────────

test('a condicao exige responsavel ANTES de olhar a data', () => {
  const sql = P.sqlEstaParado('p', '$2')
  const iResp = sql.indexOf('responsavel_id IS NOT NULL')
  assert.ok(iResp >= 0, 'a condicao precisa exigir responsavel')
  assert.ok(iResp < sql.indexOf('NOW()'), 'lead livre nao pode nem chegar na conta de dias')
})

test('sem acao nenhuma, o SQL conta desde a ATRIBUICAO', () => {
  const sql = P.sqlEstaParado('p', '$2')
  assert.match(sql, /COALESCE\([\s\S]*p\.responsavel_desde\)/,
    'sem COALESCE, o lead nunca tocado ou some da conta ou entra por uma acao que nao existe')
})

test('as TRES fontes de acao estao no SQL, e o alias e respeitado', () => {
  const sql = P.sqlUltimaAcao('x')
  assert.match(sql, /prospectador\.lead_disparos/)
  assert.match(sql, /app\.ligacoes/)
  assert.match(sql, /app\.follow_ups/)
  assert.ok(sql.includes('x.id') && !sql.includes('p.id'), 'o alias do chamador precisa ser usado')
})

test('ver o lead NAO conta como acao', () => {
  // Contar visualização transformaria a marca num medidor de presença.
  const sql = P.sqlUltimaAcao('p')
  for (const proibido of ['auditoria_eventos', 'visualiz', 'acesso', 'login']) {
    assert.ok(!sql.includes(proibido), `"${proibido}" nao e trabalho no lead`)
  }
})

// ─── Guardas de regressão ────────────────────────────────────────────────────────────────

test('o modulo e PURO: sem banco, sem HTTP, sem IA, sem rede', () => {
  const src = fonte('src/services/lead-parado.js')
  for (const proibido of ['require(', 'pool', 'fetch(', 'axios', 'anthropic', 'openai']) {
    assert.ok(!src.includes(proibido), `lead-parado.js nao pode conter '${proibido}'`)
  }
})

test('O SISTEMA MARCA E AVISA — nao existe devolucao automatica', () => {
  // Decisão do operador (2026-09-18). O contrário tiraria trabalho da mão de alguém sem ninguém
  // mandar — a classe de automatismo que este repositório já removeu (fallback da PJ, instância
  // por `atualizado_em`).
  for (const arquivo of ['src/services/lead-parado.js', 'src/db/lead-parado.js']) {
    // Só CÓDIGO conta: os dois módulos EXPLICAM em comentário por que não devolvem, e uma
    // guarda que acusasse isso estaria medindo texto, não comportamento.
    const src = fonte(arquivo)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
    for (const proibido of ['INSERT', 'UPDATE ', 'DELETE', 'responsavel_id = NULL', 'responsavel_id=NULL']) {
      assert.ok(!src.toUpperCase().includes(proibido.toUpperCase()),
        `${arquivo} nao pode conter '${proibido}': marcar nao e devolver`)
    }
  }
})

test('nenhum WORKER passou a mexer em lead parado', () => {
  // Um tique que devolvesse lead seria a devolução automática entrando pela porta dos fundos.
  const SRC = path.join(RAIZ, 'src')
  const ofensores = []
  const varrer = (dir) => {
    for (const nome of fs.readdirSync(dir)) {
      const p = path.join(dir, nome)
      if (fs.statSync(p).isDirectory()) { varrer(p); continue }
      if (!nome.endsWith('.js')) continue
      if (nome === 'lead-parado.js') continue
      const src = fs.readFileSync(p, 'utf8')
      if (/require\(['"].*(db|services)\/lead-parado['"]\)/.test(src) && /setInterval|setTimeout/.test(src)) {
        ofensores.push(path.relative(SRC, p))
      }
    }
  }
  varrer(SRC)
  assert.deepEqual(ofensores, [], 'lead parado e LEITURA sob demanda, nunca um worker')
})

test('o recorte de leads e o MESMO da contagem de carteira', () => {
  // Universo diferente faria a coluna "parados" não fechar com a coluna "leads" da mesma linha —
  // e o admin veria 12 parados numa carteira de 8.
  const parado = fonte('src/db/lead-parado.js')
  const responsavel = fonte('src/db/lead-responsavel.js')
  const recorte = "qualificacao IN ('aprovado', 'legado')"
  assert.ok(parado.includes(recorte), 'db/lead-parado.js mudou de recorte')
  assert.ok(responsavel.includes(recorte), 'db/lead-responsavel.js mudou de recorte')
})

test('a rota da equipe declara a JANELA e nao soma parados na carga', () => {
  const src = fonte('src/routes/api-equipe.js')
  assert.ok(src.includes('parado_dias'), 'a tela precisa poder dizer "ha mais de N dias"')
  assert.ok(src.includes('leads_parados'), 'a contagem precisa chegar na linha da pessoa')
  assert.ok(/leads_parados: 0/.test(src), 'a linha SEM RESPONSAVEL precisa ser explicitamente 0')
})
