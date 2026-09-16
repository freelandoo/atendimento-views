const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const IG = require('./instagram-perfil')

const FONTE = fs.readFileSync(path.join(__dirname, 'instagram-perfil.js'), 'utf8')

test('os quatro estados sao distintos — "nao verificado" nao e "nao encontrado"', () => {
  assert.equal(IG.estadoInstagram({}).chave, 'nao_verificado')
  assert.equal(IG.estadoInstagram({ instagram_confianca: 'nao_encontrado' }).chave, 'nao_encontrado')
  assert.equal(
    IG.estadoInstagram({ instagram_confianca: 'candidato', instagram_candidato: 'loja' }).chave,
    'candidato'
  )
  assert.equal(
    IG.estadoInstagram({ instagram_confianca: 'confirmado', instagram_handle: 'loja' }).chave,
    'confirmado'
  )
})

test('lead da captacao social (handle sem veredito) aparece como confirmado', () => {
  assert.equal(IG.estadoInstagram({ instagram_handle: 'loja' }).chave, 'confirmado')
})

test('candidato NUNCA e exibido como o Instagram do lead', () => {
  const lead = { instagram_confianca: 'candidato', instagram_candidato: 'talvezloja' }
  const estado = IG.estadoInstagram(lead)
  assert.equal(estado.handle, '', 'candidato nao pode ocupar o campo do perfil confirmado')
  assert.equal(estado.candidato, 'talvezloja')
  assert.equal(IG.rotuloEstado(lead), 'Perfil a confirmar')
})

test('a tela diz o LIMITE: confirmado nao e ativo', () => {
  assert.ok(IG.avisoAtividade({ instagram_handle: 'loja' }).includes('ainda nao e verificada'))
  assert.equal(IG.avisoAtividade({}), '', 'sem perfil nao ha o que ressalvar')
})

test('as acoes acompanham o estado', () => {
  assert.deepEqual(IG.acoesDisponiveis({}), {
    podeProcurar: true, podeConfirmar: false, podeRecusar: false, podeTrocar: false,
  })
  assert.deepEqual(IG.acoesDisponiveis({ instagram_confianca: 'candidato', instagram_candidato: 'x' }), {
    podeProcurar: false, podeConfirmar: true, podeRecusar: true, podeTrocar: false,
  })
  assert.deepEqual(IG.acoesDisponiveis({ instagram_handle: 'x' }), {
    podeProcurar: false, podeConfirmar: false, podeRecusar: false, podeTrocar: true,
  })
})

test('procurar de novo continua possivel depois de "nao encontrado"', () => {
  assert.equal(IG.acoesDisponiveis({ instagram_confianca: 'nao_encontrado' }).podeProcurar, true)
})

test('separa o que bateu do que nao bateu, sem reavaliar nada', () => {
  const ev = IG.evidencia({
    instagram_evidencia: {
      sinais: [
        { chave: 'telefone', ok: true, rotulo: 'Telefone bate', detalhe: null },
        { chave: 'site', ok: false, rotulo: 'Site bate', detalhe: 'lead sem site' },
      ],
    },
  })
  assert.equal(ev.bateram.length, 1)
  assert.equal(ev.naoBateram.length, 1)
  assert.equal(ev.total, 2)
})

test('evidencia ausente nao quebra a tela', () => {
  assert.deepEqual(IG.evidencia({}), { bateram: [], naoBateram: [], total: 0 })
  assert.deepEqual(IG.evidencia(null), { bateram: [], naoBateram: [], total: 0 })
})

test('a origem do veredito e dita em texto', () => {
  assert.equal(IG.rotuloOrigem({ instagram_origem: 'google_meu_negocio' }), 'declarado no Google Meu Negocio')
  assert.equal(IG.rotuloOrigem({ instagram_origem: 'busca' }), 'encontrado por busca')
  assert.equal(IG.rotuloOrigem({}), '')
})

test('GUARDA: o front NAO decide se o perfil e do lead — isso e regra do backend', () => {
  for (const proibido of ['telefone', 'nicho', 'similar', 'tokens', 'hostname', 'nome']) {
    assert.ok(
      !new RegExp(`lead\\.${proibido}|l\\.${proibido}\\b`).test(FONTE),
      `lib/instagram-perfil.js nao pode ler "${proibido}" do lead: a prova de vinculo vive em ` +
      'backend/src/services/instagram-perfil.js, e duas reguas divergiriam'
    )
  }
})

test('GUARDA: o front nao busca nada — nenhuma chamada de rede neste modulo', () => {
  for (const proibido of ['fetch(', 'axios', 'instagram.com/explore', 'googleapis']) {
    assert.ok(!FONTE.includes(proibido), `lib/instagram-perfil.js nao pode conter "${proibido}"`)
  }
})
