const test = require('node:test')
const assert = require('node:assert/strict')

const {
  SCORE_MAXIMO,
  faixaPorScore,
  normalizarRespostas,
  calcularScoreRespostas,
} = require('../src/services/icp-modelo')
const {
  calcularSinaisAutomaticos,
  respostasSugeridas,
  calcularIcpLead,
} = require('../src/services/lead-icp-score')
const { salvarAvaliacaoIcp } = require('../src/db/lead-icp')

test('ICP geral v1.1 soma ate 13 e classifica A/B/C', () => {
  assert.equal(SCORE_MAXIMO, 13)
  assert.equal(faixaPorScore(13), 'A')
  assert.equal(faixaPorScore(10), 'A')
  assert.equal(faixaPorScore(9), 'B')
  assert.equal(faixaPorScore(6), 'B')
  assert.equal(faixaPorScore(5), 'C')
})

test('respostas desconhecidas nao entram no score', () => {
  const r = normalizarRespostas({
    operacao_validada: 'sim',
    instagram_ativo: true,
    campo_inventado: true,
  })
  assert.equal(r.operacao_validada, true)
  assert.equal(r.instagram_ativo, true)
  assert.equal(Object.prototype.hasOwnProperty.call(r, 'campo_inventado'), false)
  const score = calcularScoreRespostas(r)
  assert.equal(score.score, 2)
  assert.equal(score.faixa, 'C')
})

test('sinais automaticos sugerem ICP sem transformar cadastro em prioridade', () => {
  const lead = {
    origem: 'automatico',
    place_id: 'ChIJ_x',
    tem_site: false,
    site: null,
    instagram_handle: 'loja',
    avaliacoes: 74,
    rating: 4.7,
    score_cadastro: 20,
  }
  const sinais = calcularSinaisAutomaticos(lead)
  assert.equal(sinais.operacao_validada.sugerido, true)
  assert.equal(sinais.instagram_ativo.sugerido, true)
  assert.equal(sinais.lacuna_digital_clara.sugerido, true)
  assert.equal(respostasSugeridas(lead).lacuna_digital_clara, true)
  const icp = calcularIcpLead(lead)
  assert.equal(icp.score, 4)
  assert.equal(icp.faixa, 'C')
})

test('score final usa o checklist humano, mesmo quando o cadastro e fraco', () => {
  const icp = calcularIcpLead({ score_cadastro: 10 }, {
    operacao_validada: true,
    instagram_ativo: true,
    imagem_valor: true,
    investiu_marketing_tecnologia: true,
    crescimento: true,
    cliente_valor_relevante: true,
    lacuna_digital_clara: true,
    acesso_decisor: true,
  })
  assert.equal(icp.score, 13)
  assert.equal(icp.faixa, 'A')
  assert.ok(icp.criterios.every((c) => c.marcado))
})

test('avaliacao salva preserva observacao no snapshot atual do ICP', async () => {
  let updateResumo = null
  const exec = {
    async query(sql, params) {
      if (/INSERT INTO prospectador\.lead_icp_avaliacoes/i.test(sql)) {
        return { rows: [{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', avaliado_em: '2026-09-16T12:00:00.000Z' }] }
      }
      if (/UPDATE prospectador\.prospects/i.test(sql)) {
        updateResumo = JSON.parse(params[7])
        return { rows: [] }
      }
      return { rows: [] }
    },
  }

  await salvarAvaliacaoIcp(exec, {
    empresaId: '11111111-1111-1111-1111-111111111111',
    prospect: { id: '22222222-2222-2222-2222-222222222222', score_cadastro: 10 },
    respostas: { operacao_validada: true },
    observacao: 'Fit bom, mas precisa confirmar decisor.',
    usuarioId: '33333333-3333-3333-3333-333333333333',
  })

  assert.equal(updateResumo.observacao, 'Fit bom, mas precisa confirmar decisor.')
})

// ─── A ROTA que grava a avaliação (guardas que leem o fonte) ─────────────────────────────
// `PATCH /leads/:id/icp` é o único ponto onde o checklist humano vira dado. Ele encosta em três
// coisas de consequência (a porta da triagem, o status do funil e a auditoria), e nenhuma delas
// tem teste de integração aqui — por isso as guardas leem o fonte, no mesmo padrão de
// test/lead-telefone.test.js.

const fs = require('node:fs')
const path = require('node:path')

const fonteRota = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'routes', 'api-banco-leads.js'), 'utf8')
const blocoIcp = (() => {
  const i = fonteRota.indexOf("router.patch('/leads/:id/icp'")
  assert.ok(i > 0, 'a rota de avaliacao de ICP sumiu')
  const j = fonteRota.indexOf("router.post('/leads/:id/fechar'", i)
  return fonteRota.slice(i, j > i ? j : i + 4000)
})()

test('so Lead A atravessa a porta da triagem, e o status do funil so PROMOVE', () => {
  // O corte do ICP e' quem aprova — nao o clique. B e C viram avaliacao registrada e nada mais.
  assert.ok(/autoQualificado\s*=\s*icp\?\.faixa === 'A'/.test(blocoIcp),
    'a promocao precisa depender da faixa A, nunca da decisao do clique')
  assert.ok(/if \(autoQualificado\)/.test(blocoIcp),
    'o UPDATE de qualificacao precisa estar sob a faixa A')
  // Rebaixar apagaria trabalho humano: o CASE so troca status de quem ainda nao andou no funil.
  assert.ok(/WHEN status IN \('coletado', 'contato_encontrado', 'aguardando'\) THEN 'aprovado'/.test(blocoIcp),
    'o status precisa promover por lista FECHADA')
  assert.ok(/ELSE status[\s\S]{0,20}END/.test(blocoIcp), 'fora da lista, o status fica como esta')
  assert.ok(/COALESCE\(qualificado_em, NOW\(\)\)/.test(blocoIcp),
    'reavaliar nao pode reescrever quando o lead foi qualificado')
})

test('a avaliacao e a promocao vivem na MESMA transacao, e o lead passa pelo recorte', () => {
  // Fora da transacao, um lead ficaria aprovado sem a avaliacao que o aprovou (ou o contrario).
  assert.ok(blocoIcp.includes("client.query('BEGIN')"), 'faltou abrir transacao')
  assert.ok(blocoIcp.includes("client.query('COMMIT')"), 'faltou COMMIT')
  assert.ok(blocoIcp.includes("client.query('ROLLBACK')"), 'faltou ROLLBACK no erro')
  assert.ok(blocoIcp.includes('FOR UPDATE'), 'o lead precisa ser travado durante a avaliacao')
  // Mesma disciplina das outras rotas por id: 404 em vez de escrever em lead fora do recorte.
  assert.ok(blocoIcp.includes('exigirLeadNoRecorte'),
    'a rota por id precisa repetir o recorte da listagem')
})

test('a auditoria do ICP registra o veredito, sem PII do lead', () => {
  assert.ok(blocoIcp.includes("'lead_icp_avaliado'"), 'a avaliacao precisa virar linha de auditoria')
  const contexto = blocoIcp.slice(blocoIcp.indexOf('JSON.stringify({'))
  for (const proibido of ['telefone', 'numero', 'email', 'nome', 'endereco']) {
    assert.ok(!new RegExp(`${proibido}\s*:`).test(contexto.slice(0, 400)),
      `a auditoria do ICP nao pode carregar ${proibido}`)
  }
})

test('rascunho do autosave NAO atravessa a porta da triagem nem vira auditoria', () => {
  // O modal de Detalhes salva sozinho a cada marcacao. Sem separar rascunho de decisao, o score
  // cruzaria o corte de Lead A no MEIO do preenchimento, `qualificacao` viraria 'aprovado' e —
  // como nada rebaixa — o lead continuaria aprovado mesmo terminando em B. So o estado FINAL,
  // submetido no fechamento do modal com `finalizar`, pode atravessar.
  assert.ok(/const finalizar = body\.finalizar === true/.test(blocoIcp),
    'a rota precisa distinguir rascunho de decisao por um campo explicito')
  assert.ok(/autoQualificado = icp\?\.faixa === 'A' && finalizar/.test(blocoIcp),
    'a promocao precisa exigir a faixa A E o fechamento; faixa sozinha volta a aprovar rascunho')
  // Auditoria registra decisao, nao digitacao: uma linha por avaliacao salva encheria o log de
  // rascunho, e este repositorio trata auditoria como rastro de ato humano.
  const posAuditoria = blocoIcp.indexOf("'lead_icp_avaliado'")
  assert.ok(posAuditoria > 0, 'a auditoria do ICP sumiu')
  assert.ok(/if \(finalizar\) \{[\s\S]{0,200}INSERT INTO app\.auditoria_eventos/.test(blocoIcp),
    'a auditoria precisa estar sob `finalizar`')
})
