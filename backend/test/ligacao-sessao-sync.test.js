const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SO = require('../src/services/sessao-origem')
const {
  DESFECHOS, CAMPOS_PUBLICOS, CAMPOS_CALCULADOS, CAMPOS_SESSAO,
  desfechoSessao, resumirSessao, resumirLigacaoAtiva,
} = require('../src/services/ligacao-acompanhamento')
const { obterSessao, marcarChamadaEncerrada, descartarLigacao } = require('../src/db/ligacoes')

const SRC = (...p) => path.join(__dirname, '..', 'src', ...p)
const fonte = (...p) => fs.readFileSync(SRC(...p), 'utf8')

// Pool falso: devolve, na ordem, as respostas programadas; registra SQL e params.
// BEGIN/COMMIT/ROLLBACK nao consomem a fila (mesmo contrato do seqTxPool de ligacoes.test.js).
function fakePool(respostas = []) {
  const calls = []
  const fila = [...respostas]
  const query = async (sql, params) => {
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] }
    calls.push({ sql, params })
    return fila.length ? fila.shift() : { rows: [] }
  }
  return { calls, query, async connect() { return { query, release() {} } } }
}

const CHAVE = 'aBcD1234efgh5678IJKL'   // formato valido (>=16, [A-Za-z0-9_-])

// ─────────────────────────── origem da sessao (modulo puro) ───────────────────────────

test('normalizarChaveSessao: aceita so o formato opaco esperado', () => {
  assert.equal(SO.normalizarChaveSessao(CHAVE), CHAVE)
  assert.equal(SO.normalizarChaveSessao(`  ${CHAVE}  `), CHAVE)
  assert.equal(SO.normalizarChaveSessao('curta'), null)                    // < 16
  assert.equal(SO.normalizarChaveSessao('a'.repeat(200)), null)            // > 128
  assert.equal(SO.normalizarChaveSessao('tem espaco no meio aqui!'), null) // charset
  assert.equal(SO.normalizarChaveSessao(null), null)
  assert.equal(SO.normalizarChaveSessao(12345678901234567890), null)       // nao e' string
})

test('impressaoSessao: deterministica, curta e NAO devolve a chave', () => {
  const imp = SO.impressaoSessao(CHAVE)
  assert.equal(imp.length, SO.TAMANHO_IMPRESSAO)
  assert.match(imp, /^[0-9a-f]+$/)
  assert.equal(imp, SO.impressaoSessao(CHAVE), 'mesma chave => mesma impressao')
  assert.notEqual(imp, SO.impressaoSessao('outraChaveValida123456'))
  // A chave nao pode ser recuperavel a partir do que se guarda.
  assert.equal(imp.includes(CHAVE), false)
  assert.equal(CHAVE.includes(imp), false)
})

test('impressaoSessao: chave ausente/invalida NAO vira impressao de vazio', () => {
  // Se virasse, TODA requisicao sem cabecalho pareceria a MESMA sessao — e o produto passaria
  // a afirmar "foi neste mesmo aparelho" para gente que nunca mandou origem nenhuma.
  assert.equal(SO.impressaoSessao(''), null)
  assert.equal(SO.impressaoSessao(null), null)
  assert.equal(SO.impressaoSessao('x'), null)
})

test('normalizarDispositivo: lista FECHADA; qualquer outra coisa e ausencia', () => {
  assert.deepEqual([...SO.DISPOSITIVOS].sort(), ['celular', 'computador'])
  assert.equal(SO.normalizarDispositivo('Celular'), 'celular')
  assert.equal(SO.normalizarDispositivo(' COMPUTADOR '), 'computador')
  assert.equal(SO.normalizarDispositivo('tablet'), null)
  assert.equal(SO.normalizarDispositivo('iPhone 15; iOS 18'), null) // nada de User-Agent
  assert.equal(SO.normalizarDispositivo(undefined), null)
})

test('lerOrigemSessao: forma estavel a partir dos cabecalhos', () => {
  const cheia = SO.lerOrigemSessao({ [SO.HEADER_CHAVE]: CHAVE, [SO.HEADER_DISPOSITIVO]: 'celular' })
  assert.equal(cheia.impressao, SO.impressaoSessao(CHAVE))
  assert.equal(cheia.dispositivo, 'celular')
  // Sem cabecalho nenhum a forma e' a mesma, so' que vazia — o chamador nunca lida com "meio informado".
  assert.deepEqual(SO.lerOrigemSessao({}), { impressao: null, dispositivo: null })
  assert.deepEqual(SO.lerOrigemSessao(undefined), { impressao: null, dispositivo: null })
})

test('mesmaSessao: null quando NAO da para saber (nunca false por omissao)', () => {
  assert.equal(SO.mesmaSessao('abc123', 'abc123'), true)
  assert.equal(SO.mesmaSessao('abc123', 'def456'), false)
  // `false` faz a tela dizer "aconteceu em outro aparelho" e ate' avisar o operador. Afirmar
  // isso sem prova seria mentir; por isso a duvida tem valor proprio.
  assert.equal(SO.mesmaSessao(null, 'abc123'), null)
  assert.equal(SO.mesmaSessao('abc123', null), null)
  assert.equal(SO.mesmaSessao(null, null), null)
})

test('contextoAuditoria: guarda a IMPRESSAO, junta o extra e some quando nao ha nada', () => {
  const ctx = SO.contextoAuditoria({ impressao: 'ff00aa', dispositivo: 'celular' }, { motivo: 'x' })
  assert.deepEqual(ctx, { motivo: 'x', sessao_origem: 'ff00aa', sessao_dispositivo: 'celular' })
  assert.equal(SO.contextoAuditoria(null), null, 'sem origem, o contexto fica NULO (nao {})')
  assert.deepEqual(SO.contextoAuditoria(null, { motivo: 'x' }), { motivo: 'x' })
})

// ───────────────────────────── estado publicado da sessao ─────────────────────────────

const VIVA = {
  id: 'lig-1', status: 'em_andamento', estado_sessao: 'em_andamento',
  campanha_lead_id: 'cl-1', prospect_id: 'p-1',
  iniciada_em: '2026-08-17T12:00:00.000Z', chamada_encerrada_em: null,
  encerrada_em: null, descartada_em: null,
  usuario_id: 'u-1', usuario_nome: 'Maria',
  sessao_origem: 'ff00aa112233', sessao_dispositivo: 'celular',
}

test('desfechoSessao: distingue encerrada de descartada; sessao viva nao tem desfecho', () => {
  assert.deepEqual([...DESFECHOS].sort(), ['descartada', 'encerrada'])
  assert.equal(desfechoSessao(VIVA), null)
  assert.equal(desfechoSessao({ ...VIVA, estado_sessao: 'aguardando_resumo' }), null)
  assert.equal(desfechoSessao({ ...VIVA, estado_sessao: 'encerrada' }), 'encerrada')
  assert.equal(desfechoSessao({ ...VIVA, estado_sessao: 'descartada' }), 'descartada')
  assert.equal(desfechoSessao(null), null)
})

test('resumirSessao: NAO some quando a ligacao termina — e o caso que interessa', () => {
  // "Sumiu da consulta de ativa" era o unico detector; ele nao diz QUAL desfecho foi, e os
  // dois tem consequencias opostas (encerrada entra na analitica; descartada nao entra).
  const fim = resumirSessao({ ...VIVA, estado_sessao: 'descartada', status: 'descartada', descartada_em: '2026-08-17T12:09:00.000Z' }, 'u-2')
  assert.equal(fim.viva, false)
  assert.equal(fim.desfecho, 'descartada')
  assert.equal(fim.status, 'descartada')
  assert.equal(fim.descartada_em, '2026-08-17T12:09:00.000Z')
  assert.equal(fim.usuario_nome, 'Maria')
})

test('resumirSessao: publica sou_eu, mesma_sessao e o aparelho — nunca a impressao', () => {
  const meu = resumirSessao(VIVA, 'u-1', 'ff00aa112233')
  assert.equal(meu.sou_eu, true)
  assert.equal(meu.mesma_sessao, true)
  assert.equal(meu.sessao_dispositivo, 'celular')

  // Mesmo usuario, OUTRO aparelho: e' exatamente o caso que o operador vive (liga no celular,
  // olha no computador). `sou_eu` sozinho dizia "voce" e nao explicava a surpresa.
  const outroAparelho = resumirSessao(VIVA, 'u-1', '99bb88774455')
  assert.equal(outroAparelho.sou_eu, true)
  assert.equal(outroAparelho.mesma_sessao, false)

  // Sem origem do chamador, a resposta e' "nao sei" — nao "outro aparelho".
  assert.equal(resumirSessao(VIVA, 'u-1').mesma_sessao, null)

  // A impressao e' PERSISTIDA, mas nunca publicada: nem a da linha, nem a do chamador.
  for (const p of [meu, outroAparelho]) {
    assert.equal('sessao_origem' in p, false)
    assert.equal(JSON.stringify(p).includes('ff00aa112233'), false)
  }
  assert.equal(CAMPOS_PUBLICOS.includes('sessao_origem'), false)
  assert.equal(CAMPOS_SESSAO.includes('sessao_origem'), false)
  assert.equal(CAMPOS_CALCULADOS.includes('sessao_origem'), false)
})

test('resumirSessao: forma FECHADA do payload (nada de telefone, notas ou resultado)', () => {
  const p = resumirSessao({ ...VIVA, telefone: '5511999990000', notas: 'segredo', resultado: 'atendeu' }, 'u-1', 'ff00aa112233')
  assert.deepEqual(
    Object.keys(p).sort(),
    [...CAMPOS_CALCULADOS, ...CAMPOS_PUBLICOS, ...CAMPOS_SESSAO, 'viva', 'desfecho'].sort())
  for (const proibido of ['telefone', 'notas', 'resultado']) assert.equal(proibido in p, false)
})

test('resumirSessao: linha inexistente devolve null (nao um objeto vazio)', () => {
  assert.equal(resumirSessao(null, 'u-1'), null)
  assert.equal(resumirSessao({}, 'u-1'), null)
})

test('resumirLigacaoAtiva: a listagem tambem publica o aparelho e mesma_sessao', () => {
  const item = resumirLigacaoAtiva(VIVA, 'u-1', '99bb88774455')
  assert.equal(item.sessao_dispositivo, 'celular')
  assert.equal(item.mesma_sessao, false)
  assert.equal('sessao_origem' in item, false)
})

// ─────────────────────────────── leitura e transicoes (SQL) ───────────────────────────────

test('obterSessao: le por PK, escopada por empresa, e devolve estado derivado', async () => {
  const pool = fakePool([{ rows: [{ ...VIVA, estado_sessao: undefined, chamada_encerrada_em: '2026-08-17T12:05:00.000Z' }] }])
  const out = await obterSessao(pool, 'emp1', 'lig-1')
  assert.equal(pool.calls.length, 1, 'uma consulta so: e ela que roda em polling')
  const { sql, params } = pool.calls[0]
  assert.match(sql, /l\.id = \$1 AND l\.empresa_id = \$2/)
  assert.deepEqual(params, ['lig-1', 'emp1'])
  // Sem filtro de status: e' o que permite responder DEPOIS que a ligacao terminou.
  assert.equal(/status = 'em_andamento'/.test(sql), false)
  assert.equal(out.estado_sessao, 'aguardando_resumo')
})

test('obterSessao: id de outra empresa nao existe (404), nunca devolve a linha alheia', async () => {
  const pool = fakePool([{ rows: [] }])
  await assert.rejects(() => obterSessao(pool, 'emp1', 'lig-de-outro'), /nao encontrada/i)
})

test('obterSessao: nao le telefone, notas nem resultado', () => {
  const src = fonte('db', 'ligacoes.js')
  const bloco = src.slice(src.indexOf('async function obterSessao'))
  const sql = bloco.slice(0, bloco.indexOf('\n}'))
  assert.equal(/l\.telefone|l\.notas|l\.resultado/.test(sql), false,
    'a sincronizacao fala de ESTADO da sessao; conteudo da conversa nao entra nela')
})

test('marcarChamadaEncerrada: distingue o PRIMEIRO clique do repetido (ja_marcada)', async () => {
  // Primeiro clique: nao havia instante gravado.
  const primeiro = fakePool([
    { rows: [{ chamada_encerrada_em: null }] },
    { rows: [{ id: 'lig-1', status: 'em_andamento', chamada_encerrada_em: '2026-08-17T12:05:00.000Z' }] },
    { rows: [] },
  ])
  const r1 = await marcarChamadaEncerrada(primeiro, 'emp1', 'lig-1', { origemSessao: { impressao: 'aa11', dispositivo: 'celular' } })
  assert.equal(r1.ja_marcada, false)
  assert.match(primeiro.calls[0].sql, /FOR UPDATE/, 'trava a linha: dois cliques simultaneos nao sao ambos "o primeiro"')

  // Repetido (ou segunda sessao chegando depois): o instante ja existia.
  const repetido = fakePool([
    { rows: [{ chamada_encerrada_em: '2026-08-17T12:05:00.000Z' }] },
    { rows: [{ id: 'lig-1', status: 'em_andamento', chamada_encerrada_em: '2026-08-17T12:05:00.000Z' }] },
    { rows: [] },
  ])
  const r2 = await marcarChamadaEncerrada(repetido, 'emp1', 'lig-1', {})
  assert.equal(r2.ja_marcada, true, 'repetir a acao nao pode inflar a auditoria')
  // Idempotencia do INSTANTE preservada: continua COALESCE (vale o primeiro clique).
  assert.match(repetido.calls[1].sql, /chamada_encerrada_em = COALESCE\(chamada_encerrada_em, NOW\(\)\)/)
})

test('transicao sem origem NAO apaga a origem ja registrada', async () => {
  const pool = fakePool([{ rows: [{ id: 'lig-1', status: 'em_andamento' }] }, { rows: [{ id: 'lig-1', status: 'descartada' }] }, { rows: [] }])
  await descartarLigacao(pool, 'emp1', 'lig-1', { motivo: 'm' })
  const upd = pool.calls.find((c) => /UPDATE app\.ligacoes/.test(c.sql))
  // COALESCE: cliente antigo (ou outro consumidor) sem cabecalho nao pode zerar o "de onde veio".
  assert.match(upd.sql, /sessao_origem = COALESCE\(\$\d+, sessao_origem\)/)
  assert.match(upd.sql, /sessao_dispositivo = COALESCE\(\$\d+, sessao_dispositivo\)/)
})

// ───────────────────────────────── guardas de regressao ─────────────────────────────────

test('guarda: as QUATRO transicoes gravam origem e sao auditadas com ela', () => {
  const rota = fonte('routes', 'api-ligacoes.js')
  const db = fonte('db', 'ligacoes.js')
  // inicio
  assert.match(db, /sessao_origem, sessao_dispositivo\)\s*\n\s*VALUES/)
  assert.match(rota, /acao: 'ligacao_iniciada'[\s\S]{0,200}contextoAuditoria\(org\)/)
  // fim da chamada — era a UNICA das quatro sem auditoria nenhuma antes desta entrega
  assert.match(rota, /acao: 'ligacao_chamada_encerrada'/)
  // encerramento e descarte
  assert.match(rota, /acao: 'ligacao_encerrada'[\s\S]{0,200}contextoAuditoria\(org,/)
  assert.match(rota, /acao: 'ligacao_descartada'[\s\S]{0,200}contextoAuditoria\(org,/)
})

test('guarda: NENHUMA rota devolve a impressao da sessao', () => {
  const db = fonte('db', 'ligacoes.js')
  // COLS_SESSAO e' devolvido CRU por GET /ativa e POST /iniciar. A impressao nao pode estar la.
  const cols = db.slice(db.indexOf('const COLS_SESSAO'), db.indexOf('// `sessao_origem` FICA DE FORA'))
  assert.equal(/sessao_origem/.test(cols), false,
    'COLS_SESSAO sai cru em rota: a impressao nao pode entrar nele')
  const rota = fonte('routes', 'api-ligacoes.js')
  // Onde a impressao aparece na rota e' so' como ARGUMENTO do sanitizador, nunca no payload.
  for (const m of rota.match(/impressao/g) || []) assert.equal(m, 'impressao')
  assert.equal(/data:\s*\{[^}]*sessao_origem/.test(rota), false)
})

test('guarda: GET /:id/sessao e autenticada, escopada no tenant e SOMENTE LEITURA', () => {
  const rota = fonte('routes', 'api-ligacoes.js')
  assert.match(rota, /router\.get\('\/:id\/sessao', requireAuth, requireEmpresaAccess/)
  const bloco = rota.slice(rota.indexOf("router.get('/:id/sessao'"))
  const corpo = bloco.slice(0, bloco.indexOf('router.post('))
  // Uma rota de sincronizacao que escrevesse viraria um caminho de escrita sem confirmacao —
  // e o modo Acompanhar a chama o tempo todo.
  assert.equal(/encerrar|descartar|iniciar|registrarAuditoria|UPDATE|INSERT/.test(corpo), false)
  assert.match(corpo, /ACOMP\.resumirSessao\(/, 'passa pelo sanitizador, nunca devolve a linha crua')
})

test('guarda: o modo Acompanhar continua sem nenhum caminho de escrita', () => {
  // A tela e a MESMA (`OperacaoLigacao` com `somenteLeitura`), entao a garantia tem de estar
  // no fonte: toda acao de escrita sai cedo, e a sincronizacao nova nao abriu excecao.
  const tela = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'app', 'dashboard', 'central-ligacoes', 'page.tsx'), 'utf8')
  // A guarda aceita a condicao ALARGADA (`somenteLeitura || desfechoRemoto`), mas exige que
  // `somenteLeitura` continue nela: a sincronizacao nova nao pode ter substituido a regra do
  // Acompanhar por "so' bloqueia depois que o servidor avisar que acabou".
  for (const acao of ['iniciar', 'encerrarChamada', 'salvar', 'salvarNotas', 'descartar']) {
    const i = tela.indexOf(`const ${acao} = useCallback(`)
    assert.notEqual(i, -1, `acao ${acao} nao encontrada na tela`)
    assert.match(tela.slice(i, i + 400), /if \(somenteLeitura[^)]*\)/,
      `${acao} precisa sair cedo no modo Acompanhar`)
  }
  // O interruptor unico de escrita continua exigindo os dois: nao basta a sessao estar viva.
  assert.match(tela, /const ativo = estado === 'em_andamento' && !somenteLeitura && !desfechoRemoto/)
})
