'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { decidirProximaAcao, extrairDadosMensagem, mesclarDadosExtraidosIA, separarEcoDaUltimaPergunta, jaPerguntouOrigemClientes } = require('../src/next-action-orchestrator')
const { validarRespostaPorAcao } = require('../src/action-response-validator')

function decide(mensagemAtual, perfil = {}, historico = []) {
  return decidirProximaAcao({ mensagemAtual, perfil, historico, etapaAtual: perfil.etapa_atual || 'primeiro_contato' })
}

function resultado(bolhas, etapa = null) {
  return {
    mensagem_pro_lead: Array.isArray(bolhas) ? bolhas.join('\n\n') : String(bolhas || ''),
    mensagens_bolhas: Array.isArray(bolhas) ? bolhas : [String(bolhas || '')],
    atualizar_perfil: {},
    etapa_proxima: etapa,
    solicitar_calculo_preco: false,
    handoff: false,
    motivo_handoff: null,
  }
}

test('1. Lead manda "Oi"', () => {
  const d = decide('Oi')
  assert.equal(d.acao_decidida, 'primeiro_contato')
  assert.equal(d.etapa_sugerida, 'coleta_basica')
  assert.ok(d.dados_faltantes.includes('negocio'))
})

test('2. Lead diz "Trabalho em SBC com corte de cabelo"', () => {
  const d = decide('Trabalho em SBC com corte de cabelo', {}, [{ role: 'assistant', content: 'Qual seu negocio?' }])
  assert.equal(d.acao_decidida, 'diagnostico')
  assert.equal(d.dados_extraidos.cidade, 'Sao Bernardo do Campo')
  assert.equal(d.dados_extraidos.negocio, 'corte de cabelo')
})

test('3. Lead diz "Quero ter um site"', () => {
  const d = decide('Quero ter um site')
  assert.equal(d.acao_decidida, 'primeiro_contato')
  assert.equal(d.dados_extraidos.necessidade, 'site')
  assert.notEqual(d.rota_comercial, 'projeto_sob_medida')
})

test('#3 contexto livre: "atrair mais clientes" vira necessidade=site', () => {
  assert.equal(extrairDadosMensagem('quero atrair mais clientes aqui ao redor').necessidade, 'site')
  assert.equal(extrairDadosMensagem('preciso divulgar meu trabalho e aparecer mais').necessidade, 'site')
  assert.equal(extrairDadosMensagem('gostaria de impulsionar no instagram').necessidade, 'site')
})

test('#3 contexto livre: link de Instagram vira necessidade=site', () => {
  assert.equal(extrairDadosMensagem('https://www.instagram.com/atelie.giardini?igsh=abc').necessidade, 'site')
})

test('#3 sinal explicito de sistema sobrescreve presenca', () => {
  // "conseguir mais clientes" sinaliza site, mas "sistema" e mais especifico e vence.
  assert.equal(extrairDadosMensagem('quero um sistema pra conseguir mais clientes').necessidade, 'sistema')
})

test('#3 orquestrador registra necessidade do contexto e nao re-pergunta', () => {
  const d = decidirProximaAcao({
    mensagemAtual: 'quero atrair mais clientes aqui ao redor',
    historico: [
      { role: 'user', content: 'tenho um atelie de ajustes de roupas no centro do rio' },
      { role: 'assistant', content: 'Boa! Em qual cidade voce atende?' },
    ],
    perfil: { negocio: 'ajustes de roupas', cidade: 'Rio' },
    etapaAtual: 'diagnostico',
  })
  assert.equal(d.dados_extraidos.necessidade, 'site')
  assert.notEqual(d.proximo_dado, 'necessidade')
})

test('4. Lead pergunta "Quanto custa?"', () => {
  const d = decide('Quanto custa?')
  assert.equal(d.acao_decidida, 'responder_preco_sem_contexto')
  assert.equal(d.etapa_sugerida, 'diagnostico')
  assert.notEqual(d.acao_decidida, 'consultar_agenda')
  assert.equal(d.motivo_decisao, 'pergunta_preco_sem_rota_definida')
})

test('6. Lead quer sistema', () => {
  const d = decide('Quero um sistema de agendamento para minha empresa')
  assert.equal(d.rota_comercial, 'projeto_sob_medida')
  assert.equal(d.acao_decidida, 'explicar_projeto_sob_medida')
})

test('7. Lead escolhe horario oferecido', () => {
  const d = decide('Pode ser 19:30', {
    rota_comercial: 'projeto_sob_medida',
    reuniao_proposta: { horarios_sugeridos: ['19:30', '20:15'] },
  })
  assert.equal(d.acao_decidida, 'confirmacao_reuniao')
})

test('8. Lead escolhe horario nao oferecido', () => {
  const d = decide('Pode ser 21:00', {
    rota_comercial: 'projeto_sob_medida',
    reuniao_proposta: { horarios_sugeridos: ['19:30', '20:15'] },
  })
  assert.equal(d.acao_decidida, 'consultar_agenda')
  assert.notEqual(d.acao_decidida, 'confirmacao_reuniao')
  assert.equal(d.motivo_decisao, 'horario_nao_oferecido')
})

test('9. Agenda falha: IA inventa horario vira aviso (LLM no controle)', () => {
  const decisao = {
    acao_decidida: 'convite_reuniao',
    etapa_sugerida: 'sob_medida_agenda_oferecida',
    rota_comercial: 'projeto_sob_medida',
    dados_extraidos: {},
  }
  const v = validarRespostaPorAcao(resultado('Tenho 19:30 disponivel. Qual fica melhor?'), {
    decisao,
    perfil: { rota_comercial: 'projeto_sob_medida' },
    horarios_disponiveis: [],
  })
  // Decisao do dono (2026-06-06): nao bloqueia mais — vira aviso (telemetria).
  assert.equal(v.bloqueado, false)
  assert.ok(v.avisos.some((e) => e.erro === 'ofereceu_horario_fora_da_agenda'))
})

test('10. IA tenta mandar 4 bolhas vira aviso de prompt', () => {
  const decisao = { acao_decidida: 'diagnostico', etapa_sugerida: 'coleta_basica', dados_extraidos: {} }
  const v = validarRespostaPorAcao(resultado(['a', 'b', 'c', 'd']), { decisao, perfil: {} })
  assert.equal(v.bloqueado, false)
  assert.ok(v.avisos.some((e) => e.erro === 'mais_de_2_bolhas'))
})

test('11. IA tenta citar concorrente sem dado real vira aviso de prompt', () => {
  const decisao = { acao_decidida: 'conexao_valor', etapa_sugerida: 'qualificacao_caminho', dados_extraidos: {} }
  const v = validarRespostaPorAcao(resultado('Seu concorrente ja aparece melhor no Google.'), { decisao, perfil: {} })
  assert.equal(v.bloqueado, false)
  assert.ok(v.avisos.some((e) => e.erro === 'concorrente_sem_dado_real'))
})

test('12. IA informa preco de sob medida vira aviso (LLM no controle)', () => {
  const decisao = {
    acao_decidida: 'explicar_projeto_sob_medida',
    etapa_sugerida: 'sob_medida_contexto',
    rota_comercial: 'projeto_sob_medida',
    dados_extraidos: {},
  }
  const v = validarRespostaPorAcao(resultado('Esse sistema fica em R$ 1500.'), {
    decisao,
    perfil: { rota_comercial: 'projeto_sob_medida', reuniao_proposta: { necessaria: true } },
  })
  // Decisao do dono (2026-06-06): nao bloqueia mais — vira aviso (telemetria).
  assert.equal(v.bloqueado, false)
  assert.ok(v.avisos.some((e) => e.erro === 'preco_sob_medida'))
})

test('13. IA tenta regredir etapa vira aviso de prompt', () => {
  const decisao = { acao_decidida: 'conexao_valor', etapa_sugerida: 'qualificacao_caminho', dados_extraidos: {} }
  const v = validarRespostaPorAcao(resultado('Perfeito, entendi.', 'primeiro_contato'), { decisao, perfil: {} })
  assert.equal(v.bloqueado, false)
  assert.ok(v.avisos.some((e) => e.erro === 'ia_alterou_etapa'))
})

test('14. Lead pede humano', () => {
  const d = decide('Quero falar com um humano')
  assert.equal(d.acao_decidida, 'pedido_humano')
  assert.equal(d.etapa_sugerida, 'handoff_humano')
})

test('15. JSON invalido da IA', () => {
  const decisao = { acao_decidida: 'diagnostico', etapa_sugerida: 'coleta_basica', dados_extraidos: {} }
  const v = validarRespostaPorAcao(null, { decisao, perfil: {} })
  assert.equal(v.bloqueado, true)
  assert.ok(v.erros.some((e) => e.erro === 'json_invalido'))
})

// === Fase 0 — guarda de eco (Bug D) ===

test('Fase0/D: separarEcoDaUltimaPergunta isola a resposta real apos a pergunta colada', () => {
  const historico = [{ role: 'assistant', content: 'Voce procura site, sistema, automacao, agente de IA ou uma solucao sob medida?' }]
  const eco = separarEcoDaUltimaPergunta(
    'Voce procura site, sistema, automacao, agente de IA ou uma solucao sob medida?\nPode ser',
    historico
  )
  assert.equal(eco.ehEco, true)
  assert.equal(eco.restante, 'Pode ser')
})

test('Fase0/D: eco puro (so a pergunta colada) marca ehEco com restante vazio', () => {
  const historico = [{ role: 'assistant', content: 'Hoje seus clientes chegam mais por indicacao, Instagram ou Google?' }]
  const eco = separarEcoDaUltimaPergunta(
    'Hoje seus clientes chegam mais por indicacao, Instagram ou Google?',
    historico
  )
  assert.equal(eco.ehEco, true)
  assert.equal(eco.restante, '')
})

test('Fase0/D: mensagem normal nao e tratada como eco', () => {
  const historico = [{ role: 'assistant', content: 'Em qual cidade voce atende?' }]
  const eco = separarEcoDaUltimaPergunta('Manaus', historico)
  assert.equal(eco.ehEco, false)
  assert.equal(eco.restante, 'Manaus')
})

test('Fase0/D: eco da pergunta de origem nao vira origem_clientes (sem misfire do extrator)', () => {
  // Reproduz producao: o lead colou "...indicacao, Instagram ou Google?" e o
  // extrator lia "google/instagram" como origem_clientes.
  const historico = [{ role: 'assistant', content: 'Hoje seus clientes chegam mais por indicacao, Instagram ou Google?' }]
  const d = decidirProximaAcao({
    mensagemAtual: 'Hoje seus clientes chegam mais por indicacao, Instagram ou Google?',
    historico,
    perfil: { negocio: 'forro de gesso', cidade: 'Manaus', necessidade: 'site' },
    etapaAtual: 'diagnostico',
  })
  assert.equal(d.dados_extraidos.origem_clientes, undefined)
  assert.equal(d.motivo_decisao, 'lead_ecoou_pergunta_sem_resposta')
  assert.equal(d.acao_decidida, 'responder_duvida')
})

test('Fase0/D: eco com resposta "pode ser" extrai do restante, nao da pergunta', () => {
  const historico = [{ role: 'assistant', content: 'Voce procura site, sistema, automacao, agente de IA ou uma solucao sob medida?' }]
  const d = decidirProximaAcao({
    mensagemAtual: 'Voce procura site, sistema, automacao, agente de IA ou uma solucao sob medida?\nPode ser',
    historico,
    perfil: { negocio: 'forro de gesso', cidade: 'Manaus' },
    etapaAtual: 'diagnostico',
  })
  // "site, sistema, automacao" estava na pergunta colada — nao pode virar necessidade.
  assert.equal(d.dados_extraidos.necessidade, undefined)
  assert.notEqual(d.motivo_decisao, undefined)
})

// === Fase 0 — anti-repeticao do template conexao_valor (Bug C) ===

test('Fase0/C: jaPerguntouOrigemClientes detecta a pergunta de origem ja feita', () => {
  const historico = [
    { role: 'assistant', content: 'Boa. Forro de gesso em Manaus... Hoje seus clientes chegam mais por indicacao, Instagram ou Google?' },
    { role: 'user', content: 'pelo marketplace e olx' },
  ]
  assert.equal(jaPerguntouOrigemClientes(historico), true)
})

test('Fase0/C: jaPerguntouOrigemClientes falso quando origem nunca foi perguntada', () => {
  const historico = [{ role: 'assistant', content: 'Em qual cidade voce atende?' }]
  assert.equal(jaPerguntouOrigemClientes(historico), false)
})

// === Fase 2 — classificador IA como extracao primaria, regex como fallback ===

test('Fase2: mesclarDadosExtraidosIA — IA vence e mapeia cidade_base->cidade e agente_ia', () => {
  const regex = { negocio: 'forro', cidade: 'Manaus regex' }
  const ia = { negocio: 'forro de gesso', cidade_base: 'Manaus', necessidade: 'agente_ia', origem_clientes: 'marketplace e olx' }
  const out = mesclarDadosExtraidosIA(regex, ia)
  assert.equal(out.negocio, 'forro de gesso')
  assert.equal(out.cidade, 'Manaus')
  assert.equal(out.necessidade, 'agente de IA')
  assert.equal(out.origem_clientes, 'marketplace e olx')
})

test('Fase2: sem IA, mesclarDadosExtraidosIA devolve o regex intacto (fallback)', () => {
  const regex = { negocio: 'forro', necessidade: 'site' }
  assert.deepEqual(mesclarDadosExtraidosIA(regex, null), regex)
  assert.deepEqual(mesclarDadosExtraidosIA(regex, undefined), regex)
})

test('Fase2/A: dadosExtraidosIA com origem "marketplace e olx" entra em dados_extraidos (Bug A)', () => {
  // O regex nunca reconheceu marketplace/olx; a IA sim. Simula a IA injetada.
  const d = decidirProximaAcao({
    mensagemAtual: 'pelo marketplace e olx',
    historico: [{ role: 'assistant', content: 'Hoje seus clientes chegam mais por indicacao, Instagram ou Google?' }],
    perfil: { negocio: 'forro de gesso', cidade: 'Manaus', necessidade: 'site' },
    etapaAtual: 'diagnostico',
    dadosExtraidosIA: { origem_clientes: 'marketplace e olx' },
  })
  assert.equal(d.dados_extraidos.origem_clientes, 'marketplace e olx')
})

test('Fase2/B: typo de intencao vira necessidade via IA mesmo sem casar regex (Bug B)', () => {
  // "capita mais cliente" (typo de "captar") nao casa o regex de intencao,
  // mas a IA interpreta como necessidade=site. Simula a IA injetada.
  const semIA = extrairDadosMensagem('quero capita mais cliente')
  assert.equal(semIA.necessidade, undefined) // regex nao pega o typo
  const d = decidirProximaAcao({
    mensagemAtual: 'quero capita mais cliente',
    historico: [{ role: 'assistant', content: 'Voce procura um site, um sistema ou um agente de IA?' }],
    perfil: { negocio: 'forro de gesso', cidade: 'Manaus' },
    etapaAtual: 'diagnostico',
    dadosExtraidosIA: { necessidade: 'site' },
  })
  assert.equal(d.dados_extraidos.necessidade, 'site')
})

test('como funciona vira responder_duvida antes de coletar necessidade', () => {
  const d = decidirProximaAcao({
    mensagemAtual: 'Indicacao mesmo, como funciona queria saber',
    historico: [{ role: 'assistant', content: 'Hoje seus clientes chegam mais por indicacao, Instagram ou Google?' }],
    perfil: { negocio: 'restaurante', cidade: 'SP', origem_clientes: 'Indicacao mesmo' },
    etapaAtual: 'diagnostico',
  })

  assert.equal(d.acao_decidida, 'responder_duvida')
  assert.equal(d.motivo_decisao, 'lead_perguntou_como_funciona_antes_da_coleta')
  assert.ok(d.acoes_proibidas.includes('coletar_antes_de_explicar'))
  assert.notEqual(d.acao_decidida, 'diagnostico')
})

test('pergunta pendente sobre site: resposta fora do assunto explica e reformula sem agenda', () => {
  const historico = [
    { role: 'user', content: 'Oi' },
    { role: 'assistant', content: 'Pra te direcionar certo, qual é o seu negócio e em qual cidade você atende?' },
    { role: 'user', content: 'Trabalho com SP em restaurantes' },
    { role: 'assistant', content: 'Hoje seus clientes chegam mais por indicação, Instagram ou Google?' },
    { role: 'user', content: 'Indicação mesmo, como funciona' },
    { role: 'assistant', content: 'Você procura site, sistema, automação, agente de IA ou uma solução sob medida?' },
    { role: 'user', content: 'Site' },
    { role: 'assistant', content: 'Hoje você já tem algum site ou seria o primeiro?' },
  ]

  const d = decidirProximaAcao({
    mensagemAtual: 'Indicação mesmo',
    historico,
    perfil: {
      negocio: 'restaurantes',
      cidade: 'SP',
      necessidade: 'site',
      origem_clientes: 'Indicação mesmo',
    },
    etapaAtual: 'diagnostico',
  })

  assert.equal(d.acao_decidida, 'responder_duvida')
  assert.equal(d.proximo_dado, 'tem_site')
  assert.equal(d.motivo_decisao, 'lead_nao_respondeu_pergunta_tem_site_reformular_com_explicacao')
  assert.ok(d.acoes_proibidas.includes('oferecer_reuniao'))
  assert.notEqual(d.acao_decidida, 'consultar_agenda')
})
