const test = require('node:test')
const assert = require('node:assert/strict')

const {
  INSTRUCAO_ANALISE,
  RESULTADOS_POSSIVEIS_LIGACAO,
  podeExportarContextoIA,
  montarContextoIA,
  serializarContextoIA,
} = require('./roteiro-contexto-ia')

const roteiro = { nome: 'Prospeccao barbearia', descricao: 'Agendar diagnostico', nicho: 'barbearia' }
const versaoPublicada = { versao: 3, status: 'publicada', publicada_em: '2026-08-01T12:00:00.000Z' }

function etapa(over = {}) {
  return {
    tipo: 'abertura',
    titulo: 'Abrir',
    objetivo: 'Quebrar o gelo',
    frase_sugerida: 'Oi, tudo bem?',
    perguntas: ['Voce e o responsavel?'],
    sinais_interesse: ['Perguntou preco'],
    sinais_resistencia: ['Disse que esta ocupado'],
    objecoes: [{ objecao: 'Ja tenho fornecedor', resposta: 'Entendo, posso te mostrar a diferenca?' }],
    ...over,
  }
}

test('podeExportarContextoIA so aceita versao publicada', () => {
  assert.equal(podeExportarContextoIA({ status: 'publicada' }), true)
  assert.equal(podeExportarContextoIA({ status: 'rascunho' }), false)
  assert.equal(podeExportarContextoIA({ status: 'arquivada' }), false)
  assert.equal(podeExportarContextoIA(null), false)
  assert.equal(podeExportarContextoIA(undefined), false)
})

test('montarContextoIA recusa versao nao publicada (fonte de verdade unica)', () => {
  assert.throws(
    () => montarContextoIA({ roteiro, versao: { versao: 4, status: 'rascunho' }, etapas: [etapa()] }),
    /publicada/i
  )
  assert.throws(() => montarContextoIA({ roteiro, versao: null }), /obrigatorios/i)
})

test('montarContextoIA usa os campos reais do roteiro publicado', () => {
  const c = montarContextoIA({ roteiro, versao: versaoPublicada, etapas: [etapa()] })
  assert.equal(c.instrucao_de_analise, INSTRUCAO_ANALISE)
  assert.equal(c.nome_do_roteiro, 'Prospeccao barbearia')
  assert.equal(c.versao, 3)
  assert.equal(c.status_publicada, true)
  assert.equal(c.publicada_em, '2026-08-01T12:00:00.000Z')
  assert.equal(c.objetivo, 'Agendar diagnostico')   // descricao do roteiro
  assert.equal(c.publico_alvo, 'barbearia')         // nicho do roteiro
  assert.deepEqual(c.resultados_possiveis_da_ligacao, [...RESULTADOS_POSSIVEIS_LIGACAO])
})

test('etapas saem na ORDEM EXIBIDA (posicao = indice do array, nao o campo ordem)', () => {
  const c = montarContextoIA({
    roteiro,
    versao: versaoPublicada,
    // `ordem` fora de sincronia de proposito: a tela e' a fonte da sequencia.
    etapas: [
      etapa({ ordem: 7, tipo: 'abertura', titulo: 'Primeira' }),
      etapa({ ordem: 2, tipo: 'descoberta', titulo: 'Segunda' }),
      etapa({ ordem: 5, tipo: 'convite_reuniao', titulo: 'Terceira' }),
    ],
  })
  assert.deepEqual(c.etapas_na_ordem, [
    { posicao: 1, tipo: 'abertura', titulo: 'Primeira' },
    { posicao: 2, tipo: 'descoberta', titulo: 'Segunda' },
    { posicao: 3, tipo: 'convite_reuniao', titulo: 'Terceira' },
  ])
  assert.deepEqual(c.falas_e_instrucoes_por_etapa.map((e) => e.posicao), [1, 2, 3])
  assert.deepEqual(c.perguntas_de_diagnostico.map((e) => e.posicao), [1, 2, 3])
  assert.deepEqual(c.regras_de_conducao.por_etapa.map((e) => e.posicao), [1, 2, 3])
})

test('falas, perguntas, sinais e objecoes vao para os campos correspondentes', () => {
  const c = montarContextoIA({ roteiro, versao: versaoPublicada, etapas: [etapa()] })
  assert.deepEqual(c.falas_e_instrucoes_por_etapa[0], {
    posicao: 1, tipo: 'abertura', objetivo_da_etapa: 'Quebrar o gelo', frase_sugerida: 'Oi, tudo bem?',
  })
  assert.deepEqual(c.perguntas_de_diagnostico[0].perguntas, ['Voce e o responsavel?'])
  const cond = c.regras_de_conducao.por_etapa[0]
  assert.deepEqual(cond.sinais_de_interesse, ['Perguntou preco'])
  assert.deepEqual(cond.sinais_de_resistencia, ['Disse que esta ocupado'])
  assert.deepEqual(cond.objecoes_e_respostas, [
    { objecao: 'Ja tenho fornecedor', resposta: 'Entendo, posso te mostrar a diferenca?' },
  ])
  assert.ok(c.regras_de_conducao.principios.length > 0)
})

test('campo ausente vira null/[] — nada e inventado', () => {
  const c = montarContextoIA({
    roteiro: { nome: 'Sem detalhes' },
    versao: { versao: 1, status: 'publicada' },
    etapas: [{ tipo: 'abertura' }],
  })
  assert.equal(c.objetivo, null)
  assert.equal(c.publico_alvo, null)
  assert.equal(c.publicada_em, null)
  assert.equal(c.etapas_na_ordem[0].titulo, null)
  assert.equal(c.falas_e_instrucoes_por_etapa[0].frase_sugerida, null)
  assert.deepEqual(c.perguntas_de_diagnostico[0].perguntas, [])
  assert.deepEqual(c.regras_de_conducao.por_etapa[0].objecoes_e_respostas, [])
})

test('itens vazios/nulos das listas sao descartados', () => {
  const c = montarContextoIA({
    roteiro,
    versao: versaoPublicada,
    etapas: [etapa({ perguntas: ['  ', 'Vale?', null], objecoes: [{ objecao: '', resposta: '' }] })],
  })
  assert.deepEqual(c.perguntas_de_diagnostico[0].perguntas, ['Vale?'])
  assert.deepEqual(c.regras_de_conducao.por_etapa[0].objecoes_e_respostas, [])
})

test('restricoes citam os tipos de etapa quando a tela informa a lista', () => {
  const semTipos = montarContextoIA({ roteiro, versao: versaoPublicada, etapas: [etapa()] })
  assert.equal(semTipos.restricoes.some((r) => r.includes('tipos de etapa')), false)
  const comTipos = montarContextoIA({
    roteiro, versao: versaoPublicada, etapas: [etapa()], tiposDeEtapaPermitidos: ['abertura', 'descoberta'],
  })
  assert.ok(comTipos.restricoes.some((r) => r.includes('abertura, descoberta')))
})

test('nao exporta identificador interno (empresa/roteiro/versao) nem chave desconhecida', () => {
  const json = serializarContextoIA({
    roteiro: { ...roteiro, id: 'rot-1', empresa_id: 'emp-1' },
    versao: { ...versaoPublicada, id: 'ver-1', roteiro_id: 'rot-1', empresa_id: 'emp-1' },
    etapas: [{ ...etapa(), id: 'et-1', versao_id: 'ver-1', empresa_id: 'emp-1' }],
  })
  assert.equal(json.includes('empresa_id'), false)
  assert.equal(json.includes('roteiro_id'), false)
  assert.equal(json.includes('versao_id'), false)
  assert.equal(json.includes('emp-1'), false)
  assert.equal(json.includes('et-1'), false)
})

test('serializarContextoIA devolve JSON indentado e reversivel', () => {
  const entrada = { roteiro, versao: versaoPublicada, etapas: [etapa()] }
  const json = serializarContextoIA(entrada)
  assert.ok(json.includes('\n  "nome_do_roteiro"'))
  assert.deepEqual(JSON.parse(json), montarContextoIA(entrada))
})

test('roteiro sem etapas ainda gera um contexto valido (listas vazias)', () => {
  const c = montarContextoIA({ roteiro, versao: versaoPublicada, etapas: [] })
  assert.deepEqual(c.etapas_na_ordem, [])
  assert.deepEqual(c.regras_de_conducao.por_etapa, [])
  assert.equal(c.nome_do_roteiro, 'Prospeccao barbearia')
})
