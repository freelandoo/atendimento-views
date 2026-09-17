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

test('a tela diz o LIMITE: confirmado nao e ativo enquanto ninguem mediu', () => {
  assert.ok(IG.avisoAtividade({ instagram_handle: 'loja' }).includes('ainda nao foi verificada'))
  assert.equal(IG.avisoAtividade({}), '', 'sem perfil nao ha o que ressalvar')
})

// Desde a sonda de 2026-09-17 a atividade EXISTE. O aviso antigo ("nunca e verificada") passaria
// a negar um dado que o sistema tem.
test('atividade medida em perfil CONFIRMADO fala por si, sem ressalva', () => {
  const lead = { instagram_handle: 'loja', instagram_confianca: 'confirmado',
    instagram_atividade: 'ativo_recente' }
  const a = IG.estadoAtividade(lead)
  assert.equal(a.confiavel, true)
  assert.equal(a.tom, 'ok')
  assert.equal(IG.avisoAtividade(lead), '')
  assert.equal(IG.rotuloEnriquecimento(lead), 'Postou nos ultimos 30 dias')
})

// A regra do operador: atividade de CANDIDATO e sinal fraco, nunca verdade sobre o lead.
test('atividade medida em CANDIDATO carrega a ressalva em texto, nao so na cor', () => {
  const lead = { instagram_candidato: 'loja', instagram_confianca: 'candidato',
    instagram_atividade: 'ativo_recente' }
  const a = IG.estadoAtividade(lead)
  assert.equal(a.confiavel, false)
  assert.equal(a.tom, 'neutro', 'candidato nao ganha o verde de perfil provado')
  assert.match(IG.avisoAtividade(lead), /nao confirmado/)
})

test('nao_verificado nunca e apresentado como inatividade', () => {
  const lead = { instagram_handle: 'loja', instagram_confianca: 'confirmado',
    instagram_atividade: 'nao_verificado' }
  assert.match(IG.avisoAtividade(lead), /ainda nao foi verificada/)
  for (const rotulo of Object.values(IG.ROTULO_ATIVIDADE)) {
    assert.ok(!/inativ/i.test(rotulo), `"${rotulo}" afirma inatividade`)
  }
})

test('o trabalho em andamento aparece como complementar, sem virar veredito', () => {
  assert.equal(IG.rotuloEnriquecimento({ instagram_etapa_status: 'pendente' }), 'Instagram na fila')
  assert.match(IG.avisoAtividade({ instagram_etapa_status: 'processando' }), /Verificando/)
  assert.equal(IG.estadoInstagram({ instagram_etapa_status: 'pendente' }).chave, 'nao_verificado',
    'estar na fila nao e um veredito sobre o perfil')
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

test('a busca e oferecida UMA vez: depois de "nao encontrado" o botao NAO volta', () => {
  // Cada clique gasta uma query do Google CSE (100/dia no gratuito) e repetir a MESMA busca
  // sobre os MESMOS dados devolveria o mesmo nada. Decisao do operador em 2026-09-16.
  const acoes = IG.acoesDisponiveis({ instagram_confianca: 'nao_encontrado' })
  assert.equal(acoes.podeProcurar, false)
  assert.equal(acoes.podeTrocar, false)
  // Sobra o unico caminho que acrescenta informacao nova: informar a mao.
  assert.equal(acoes.podeConfirmar, false)
  assert.equal(acoes.podeRecusar, false)
})

test('"nao encontrado" NAO e rotulado como "encontrado por busca"', () => {
  const lead = { instagram_confianca: 'nao_encontrado', instagram_origem: 'busca' }
  assert.equal(IG.rotuloOrigem(lead), 'a busca nao encontrou perfil confiavel')
  assert.notEqual(IG.rotuloOrigem(lead), IG.ROTULO_ORIGEM.busca)
})

test('o ICP pede o registro quando o criterio e marcado sem perfil, e o texto muda por estado', () => {
  assert.equal(IG.avisoIcpSemPerfil({ instagram_handle: 'loja' }), '', 'com perfil nao ha o que pedir')
  assert.match(IG.avisoIcpSemPerfil({}), /Nenhum Instagram registrado/)
  assert.match(
    IG.avisoIcpSemPerfil({ instagram_confianca: 'candidato', instagram_candidato: 'x' }),
    /aguardando confirmacao/
  )
  assert.match(IG.avisoIcpSemPerfil({ instagram_confianca: 'nao_encontrado' }), /a mao/)
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
