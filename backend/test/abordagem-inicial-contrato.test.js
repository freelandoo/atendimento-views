'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  montarEstrategiaAbordagem,
  montarPromptContratoAbordagem,
  normalizarContratoAbordagem,
  renderMensagemAbordagemFallback,
  avisoSiteProntoPresente,
  selecionarOfertaAbordagem,
} = require('../src/services/abordagem-inicial-contrato')

test('abordagem inicial: prioriza angulo de site em construtor', () => {
  const estrategia = montarEstrategiaAbordagem({
    nome: 'Clinica Alfa',
    site: 'https://clinica-alfa.wixsite.com/home',
    cidade: 'Santos',
  }, { nomeEmpresa: 'PJ Codeworks' })

  assert.equal(estrategia.angulo, 'site_construtor')
  assert.equal(estrategia.site.oportunidade, 'site_construtor')
  assert.ok(estrategia.sinais.some((s) => /construtor/i.test(s)))
})

test('abordagem inicial: perfil social sem site vira oportunidade de site proprio', () => {
  const estrategia = montarEstrategiaAbordagem({
    nome: 'Restaurante A',
    link_bio: 'https://instagram.com/restaurantea',
    instagram_handle: 'restaurantea',
    seguidores: 1800,
  })

  assert.equal(estrategia.angulo, 'sem_site')
  assert.equal(estrategia.site.situacao, 'sem_site')
  assert.ok(estrategia.sinais.some((s) => /Instagram/i.test(s)))
})

test('abordagem inicial: Instagram ativo vira angulo social quando nao ha lacuna de site confirmada', () => {
  const estrategia = montarEstrategiaAbordagem({
    nome: 'Studio Beta',
    site: 'https://studiobeta.com.br',
    instagram_handle: 'studiobeta',
    seguidores: 2500,
  })

  assert.equal(estrategia.angulo, 'instagram_ativo')
  assert.ok(estrategia.sinais.some((s) => /2500 seguidores/i.test(s)))
})

test('abordagem inicial: contrato JSON valido precisa trazer aviso de site pronto', () => {
  const estrategia = montarEstrategiaAbordagem({ nome: 'Padaria X', tem_site: false })
  const contrato = normalizarContratoAbordagem(JSON.stringify({
    schema_version: 'abordagem_inicial_v1',
    mensagem: 'Oi, tudo bem? Sou da PJ Codeworks. Ja deixei uma previa de site pronta aqui no atendimento para Padaria X. Vi que falta site proprio. Quer ver como isso poderia trazer mais pedidos?',
    angulo: 'sem_site',
    sinais_usados: ['sem site proprio confirmado'],
    pergunta_final: 'Quer ver como isso poderia trazer mais pedidos?',
    confianca: 0.9,
  }), estrategia)

  assert.equal(contrato.mensagem.includes('previa de site pronta'), true)
  assert.equal(contrato.aviso_site_pronto, true)
  assert.equal(avisoSiteProntoPresente(contrato.mensagem), true)
})

test('abordagem inicial: texto livre ou JSON sem aviso obrigatorio sao rejeitados', () => {
  const estrategia = montarEstrategiaAbordagem({ nome: 'Padaria X', tem_site: false })
  assert.equal(normalizarContratoAbordagem('Oi, tudo bem?', estrategia), null)
  assert.equal(normalizarContratoAbordagem(JSON.stringify({
    schema_version: 'abordagem_inicial_v1',
    mensagem: 'Oi, tudo bem? Sou da PJ Codeworks. Vi a Padaria X no Google e queria te mandar uma analise rapida. Posso?',
    angulo: 'sem_site',
    sinais_usados: ['Google'],
    pergunta_final: 'Posso?',
    confianca: 0.5,
  }), estrategia), null)
})

test('abordagem inicial: fallback tambem respeita o gancho obrigatorio', () => {
  const msg = renderMensagemAbordagemFallback({
    nome: 'Clinica Alfa',
    cidade: 'Santos',
    site: 'https://clinica-alfa.wixsite.com/home',
  }, { nomeEmpresa: 'PJ Codeworks' })

  assert.match(msg, /Sou da PJ Codeworks/)
  assert.match(msg, /previa de site pronta/i)
  assert.match(msg, /Clinica Alfa/)
  assert.equal(msg.length <= 600, true)
})

test('abordagem inicial: prompt manda adaptar idioma pela localidade do lead', () => {
  const estrategia = montarEstrategiaAbordagem({
    nome: 'Austin Dental',
    cidade: 'Austin',
    endereco: 'Austin, TX, United States',
  }, { nomeEmpresa: 'PJ Codeworks' })
  const prompt = montarPromptContratoAbordagem({
    estrategia,
    dadosLead: { cidade: 'Austin', endereco: 'Austin, TX, United States', telefone: '+1 512 555 0100' },
    nomeEmpresa: 'PJ Codeworks',
  })

  assert.match(prompt.userPrompt, /Estados Unidos/)
  assert.match(prompt.userPrompt, /ingles/)
  assert.match(prompt.userPrompt, /Portugal/)
})

test('abordagem inicial: oferta especifica do nicho vence a oferta geral', () => {
  const instrucoes = [
    '[ABORDAGEM_IA_CONFIG]',
    JSON.stringify({
      idiomaAutomatico: true,
      ofertas: [
        { id: 'geral', nome: 'Site com CRM completo', descricao: 'Oferta geral', geral: true, ativo: true },
        { id: 'solar', nome: 'Site para energia solar', descricao: 'Oferta solar', nicho: 'energia solar', geral: false, ativo: true },
      ],
    }),
    '[/ABORDAGEM_IA_CONFIG]',
  ].join('\n')

  const out = selecionarOfertaAbordagem(instrucoes, { empresa: { nicho: 'Energia Solar' } })
  assert.equal(out.oferta.nome, 'Site para energia solar')
  assert.match(out.instrucoes, /Oferta solar/)
})

test('abordagem inicial: oferta desativada nao participa da selecao', () => {
  const instrucoes = [
    '[ABORDAGEM_IA_CONFIG]',
    JSON.stringify({
      idiomaAutomatico: true,
      ofertas: [
        { id: 'geral', nome: 'Site com CRM completo', descricao: 'Oferta geral', geral: true, ativo: true },
        { id: 'solar', nome: 'Site para energia solar', descricao: 'Oferta solar', nicho: 'energia solar', ativo: false },
      ],
    }),
    '[/ABORDAGEM_IA_CONFIG]',
  ].join('\n')

  const out = selecionarOfertaAbordagem(instrucoes, { nicho: 'Energia Solar' })
  assert.equal(out.oferta.nome, 'Site com CRM completo')
  assert.doesNotMatch(out.instrucoes, /Oferta solar/)
})
