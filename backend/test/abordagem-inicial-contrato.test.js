'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  montarEstrategiaAbordagem,
  montarPromptContratoAbordagem,
  normalizarContratoAbordagem,
  renderMensagemAbordagemFallback,
  avisoSiteProntoPresente,
  terminaComPergunta,
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
  assert.equal(contrato.objetivo_resposta, 'capturar_interesse')
  assert.match(contrato.respostas_esperadas.desinteresse, /nao quer/)
  assert.equal(avisoSiteProntoPresente(contrato.mensagem), true)
})

test('abordagem inicial: texto livre, sem aviso obrigatorio ou sem pergunta final sao rejeitados', () => {
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
  assert.equal(normalizarContratoAbordagem(JSON.stringify({
    schema_version: 'abordagem_inicial_v1',
    mensagem: 'Oi, tudo bem? Sou da PJ Codeworks. Ja deixei uma previa de site pronta aqui no atendimento para Padaria X. Vi uma oportunidade de receber mais contatos pelo WhatsApp.',
    angulo: 'sem_site',
    sinais_usados: ['Google'],
    pergunta_final: 'Posso?',
    confianca: 0.5,
  }), estrategia), null)
})

test('abordagem inicial: oferta sem site pronto rejeita promessa de previa pronta', () => {
  const estrategia = montarEstrategiaAbordagem({ nome: 'Padaria X', tem_site: false })
  const contratoConsultivo = normalizarContratoAbordagem(JSON.stringify({
    schema_version: 'abordagem_inicial_v1',
    mensagem: 'Oi, tudo bem? Sou da PJ Codeworks. Vi a Padaria X no Google e notei uma oportunidade de melhorar os contatos pelo WhatsApp. Posso te mandar uma analise rapida?',
    angulo: 'sem_site',
    sinais_usados: ['Google'],
    pergunta_final: 'Posso te mandar uma analise rapida?',
    confianca: 0.7,
  }), estrategia, { avisoSitePronto: false })

  assert.equal(contratoConsultivo.aviso_site_pronto, false)
  assert.equal(normalizarContratoAbordagem(JSON.stringify({
    schema_version: 'abordagem_inicial_v1',
    mensagem: 'Oi, tudo bem? Sou da PJ Codeworks. Ja deixei uma previa de site pronta aqui no atendimento para Padaria X. Posso te mandar?',
    angulo: 'sem_site',
    sinais_usados: ['Google'],
    pergunta_final: 'Posso te mandar?',
    confianca: 0.7,
  }), estrategia, { avisoSitePronto: false }), null)
})

test('abordagem inicial: fallback tambem respeita o gancho obrigatorio', () => {
  const msg = renderMensagemAbordagemFallback({
    nome: 'Clinica Alfa',
    cidade: 'Santos',
    site: 'https://clinica-alfa.wixsite.com/home',
  }, { nomeEmpresa: 'PJ Codeworks' })

  assert.doesNotMatch(msg, /Sou da|PJ Codeworks/)
  assert.match(msg, /estrutura pronta/i)
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

test('abordagem inicial: identificacao configurada vira instrucao, nao prefixo programatico', () => {
  const instrucoes = [
    '[ABORDAGEM_IA_CONFIG]',
    JSON.stringify({
      identificacao: 'Sou Victor, da PJ Codeworks',
      ofertas: [
        { id: 'geral', nome: 'CRM comercial', descricao: 'CRM com controle de leads e propostas', geral: true, ativo: true },
      ],
    }),
    '[/ABORDAGEM_IA_CONFIG]',
  ].join('\n')
  const estrategia = montarEstrategiaAbordagem({ nome: 'Padaria X', tem_site: false }, { nomeEmpresa: 'PJ Codeworks' })
  const prompt = montarPromptContratoAbordagem({
    estrategia,
    dadosLead: { nome: 'Padaria X', nicho: 'padaria' },
    instrucoes,
    nomeEmpresa: 'PJ Codeworks',
  })
  const msg = renderMensagemAbordagemFallback({ nome: 'Padaria X', tem_site: false }, {
    estrategia,
    nomeEmpresa: 'PJ Codeworks',
    identificacao: prompt.identificacao,
    ofertaAbordagem: prompt.oferta_abordagem,
  })

  assert.match(prompt.userPrompt, /Identificacao opcional configurada pelo operador: "Sou Victor, da PJ Codeworks"/)
  assert.match(prompt.userPrompt, /nao encaixe mecanicamente no comeco/)
  assert.match(prompt.userPrompt, /controlar leads, acompanhar o funil e organizar propostas/)
  assert.doesNotMatch(msg, /Sou Victor|PJ Codeworks|nossa empresa/)
  assert.doesNotMatch(msg, /nossa empresa/)
  assert.match(msg, /controlar leads/)
})

test('abordagem inicial: sem oferta configurada nao assume carro-chefe nem oferta pronta', () => {
  const estrategia = montarEstrategiaAbordagem({ nome: 'Padaria X', tem_site: false }, { nomeEmpresa: 'PJ Codeworks' })
  const prompt = montarPromptContratoAbordagem({
    estrategia,
    dadosLead: { nome: 'Padaria X', nicho: 'padaria' },
    instrucoes: '',
    nomeEmpresa: 'PJ Codeworks',
  })

  assert.equal(prompt.oferta_abordagem, null)
  assert.equal(prompt.aviso_site_pronto, false)
  assert.equal(prompt.identificacao, '')
  assert.match(prompt.userPrompt, /Nenhuma oferta principal foi configurada/)
  assert.match(prompt.userPrompt, /Nao comece se identificando por padrao/)
  assert.match(prompt.userPrompt, /Nao diga que existe oferta/)
})

test('abordagem inicial: detector de pergunta final aceita somente pergunta direta no fim', () => {
  assert.equal(terminaComPergunta('Posso te mandar?'), true)
  assert.equal(terminaComPergunta('Can I send it?   '), true)
  assert.equal(terminaComPergunta('Posso te mandar? Depois explico.'), false)
  assert.equal(terminaComPergunta('Vou te mandar.'), false)
})

test('abordagem inicial: oferta especifica do nicho vence a oferta geral', () => {
  const instrucoes = [
    '[ABORDAGEM_IA_CONFIG]',
    JSON.stringify({
      idiomaAutomatico: true,
      ofertas: [
        { id: 'geral', nome: 'Site com CRM completo', descricao: 'Oferta geral', geral: true, ativo: true },
        { id: 'solar', nome: 'Site para energia solar', descricao: 'Oferta solar', nicho: 'energia solar', geral: false, ativo: true, sitePronto: false },
      ],
    }),
    '[/ABORDAGEM_IA_CONFIG]',
  ].join('\n')

  const out = selecionarOfertaAbordagem(instrucoes, { empresa: { nicho: 'Energia Solar' } })
  assert.equal(out.oferta.nome, 'Site para energia solar')
  assert.equal(out.oferta.site_pronto, false)
  assert.match(out.instrucoes, /Oferta solar/)
  assert.doesNotMatch(out.instrucoes, /Oferta geral/)
  assert.match(out.instrucoes, /Resultado esperado/)
  assert.match(out.instrucoes, /nao dizer que ja existe oferta, site/)
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
