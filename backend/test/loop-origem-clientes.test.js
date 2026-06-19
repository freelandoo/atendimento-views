'use strict'

// Regressao do loop do lead +5511910606242: o lead respondia "Indicacao" /
// "Ess4" / "Essa" e o bot repetia "como seus clientes te encontram hoje?" em
// loop, ainda por cima com a frase auto-contraditoria "Vou avancar sem repetir
// essa pergunta". Causa raiz: origem_clientes nunca era persistido e o fallback
// re-perguntava o mesmo dado a cada turno.

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { fallbackContextual, validarRespostaPorAcao } = require('../src/action-response-validator')
const { decidirProximaAcao } = require('../src/next-action-orchestrator')
const { norm, canonicalizarPerfilLead } = require('../src/lead-profile-canonical')

const PERFIL_QUALIFICADO = {
  negocio: 'advocacia',
  cidade: 'Sao Paulo',
  produto_sugerido: 'site',
  dor_principal: 'site',
}
const ERROS_REPETICAO = ['mensagem_repetida:similaridade_alta_bolha']

test('fallback nao usa frase meta auto-contraditoria', () => {
  const msg = fallbackContextual(
    {
      decisao: { acao_decidida: 'conexao_valor' },
      perfil: PERFIL_QUALIFICADO,
      historico: [],
      dados_extraidos: {},
    },
    ERROS_REPETICAO
  )
  assert.doesNotMatch(norm(msg), /vou avancar|sem repetir essa pergunta|so me confirma uma coisa/)
})

test('fallback nao re-pergunta origem que o lead acabou de responder neste turno', () => {
  const msg = fallbackContextual(
    {
      decisao: { acao_decidida: 'conexao_valor' },
      perfil: PERFIL_QUALIFICADO,
      mensagemAtual: 'Indicação',
      dados_extraidos: { origem_clientes: 'Indicação' },
      historico: [],
    },
    ERROS_REPETICAO
  )
  assert.doesNotMatch(norm(msg), /clientes te encontram|clientes chegam/)
})

test('fallback nao reabre pergunta de origem ja feita (resposta ininteligivel)', () => {
  const historico = [
    { role: 'assistant', content: 'Hoje seus clientes chegam mais por indicacao, Instagram ou Google?' },
    { role: 'user', content: 'Ess4' },
  ]
  const msg = fallbackContextual(
    {
      decisao: { acao_decidida: 'conexao_valor' },
      perfil: PERFIL_QUALIFICADO,
      mensagemAtual: 'Ess4',
      dados_extraidos: {},
      historico,
    },
    ERROS_REPETICAO
  )
  assert.doesNotMatch(norm(msg), /clientes te encontram|clientes chegam/)
})

test('orquestrador avanca quando origem ja foi perguntada e segue vazia', () => {
  const historico = [
    { role: 'user', content: 'Tenho uma advocacia em Sao Paulo, quero um site' },
    { role: 'assistant', content: 'Boa! Hoje seus clientes chegam mais por indicacao, Instagram ou Google?' },
    { role: 'user', content: 'Essa' },
  ]
  const d = decidirProximaAcao({
    mensagemAtual: 'Essa',
    historico,
    perfil: PERFIL_QUALIFICADO,
    etapaAtual: 'diagnostico',
  })
  // Sem o escape, voltaria a conexao_valor (re-perguntando origem) eternamente.
  assert.notEqual(d.acao_decidida, 'conexao_valor')
})

test('orquestrador ainda conecta valor na PRIMEIRA vez que origem falta', () => {
  const historico = [
    { role: 'user', content: 'Tenho uma advocacia em Sao Paulo' },
    { role: 'assistant', content: 'Boa! Voce procura um site?' },
    { role: 'user', content: 'Sim, um site' },
  ]
  const d = decidirProximaAcao({
    mensagemAtual: 'Sim, um site',
    historico,
    perfil: PERFIL_QUALIFICADO,
    etapaAtual: 'diagnostico',
  })
  assert.equal(d.acao_decidida, 'conexao_valor')
})

test('orquestrador pergunta necessidade (site/sistema/IA) na primeira vez que falta', () => {
  const historico = [
    { role: 'user', content: 'tenho uma advocacia em sao paulo' },
    { role: 'assistant', content: 'Boa! Em qual cidade voce atende?' },
    { role: 'user', content: 'sao paulo' },
  ]
  const d = decidirProximaAcao({
    mensagemAtual: 'sao paulo',
    historico,
    perfil: { negocio: 'advocacia', cidade: 'Sao Paulo' },
    etapaAtual: 'diagnostico',
  })
  assert.equal(d.acao_decidida, 'diagnostico')
  assert.equal(d.proximo_dado, 'necessidade')
})

test('orquestrador NAO re-pergunta necessidade ja feita (resposta ininteligivel)', () => {
  const historico = [
    { role: 'user', content: 'tenho uma advocacia em sao paulo' },
    { role: 'assistant', content: 'Voce procura um site, um sistema ou um agente de IA?' },
    { role: 'user', content: 'sei la' },
  ]
  const d = decidirProximaAcao({
    mensagemAtual: 'sei la',
    historico,
    perfil: { negocio: 'advocacia', cidade: 'Sao Paulo' },
    etapaAtual: 'diagnostico',
  })
  // necessidade segue vazia, mas ja foi perguntada — nao deve voltar ao diagnostico (loop)
  assert.notEqual(d.acao_decidida, 'diagnostico')
})

test('orquestrador reconhece necessidade perguntada em redacao livre e nao repete (caso real ateliê)', () => {
  const historico = [
    { role: 'user', content: 'trabalho com ajustes de roupas' },
    { role: 'assistant', content: 'Qual seria sua necessidade atual em relação a soluções digitais?' },
    { role: 'user', content: 'nao sei informar' },
  ]
  const d = decidirProximaAcao({
    mensagemAtual: 'nao sei informar',
    historico,
    perfil: { negocio: 'ajustes de roupas', cidade: 'Rio' },
    etapaAtual: 'diagnostico',
  })
  // Antes do regex amplo, "necessidade ... solucoes digitais" nao era reconhecida
  // como ja perguntada e o bot repetia a pergunta a cada turno.
  assert.notEqual(d.acao_decidida, 'diagnostico')
})

test('orquestrador reconhece "o que voce gostaria de alcancar com a solucao digital" como necessidade ja feita', () => {
  const historico = [
    { role: 'user', content: 'tenho um negocio em sao paulo' },
    { role: 'assistant', content: 'Poderia me contar um pouco mais sobre o que você gostaria de alcançar com a solução digital?' },
    { role: 'user', content: 'sei la' },
  ]
  const d = decidirProximaAcao({
    mensagemAtual: 'sei la',
    historico,
    perfil: { negocio: 'negocio x', cidade: 'Sao Paulo' },
    etapaAtual: 'diagnostico',
  })
  assert.notEqual(d.acao_decidida, 'diagnostico')
})

test('fallback de necessidade apresenta site, sistema ou IA', () => {
  const msg = fallbackContextual(
    {
      decisao: { acao_decidida: 'diagnostico' },
      perfil: { negocio: 'advocacia', cidade: 'Sao Paulo' },
      historico: [],
      dados_extraidos: {},
    },
    ERROS_REPETICAO
  )
  assert.match(norm(msg), /um site, um sistema ou um agente de ia/)
})

// ─── Convite de reuniao: nao repetir "posso ver um horario?" em loop ─────────
const PERFIL_PRONTO_REUNIAO = {
  negocio: 'topografia',
  cidade: 'Salvador',
  produto_sugerido: 'site',
  dor_principal: 'site',
  origem_clientes: 'indicacao',
}
const CONVITE_LEVE =
  'Show, ja tenho um bom panorama do seu caso. Posso ver um horario rapido com a equipe da PJ Codeworks pra te mostrar como ficaria na pratica?'

test('fallback usa convite leve na PRIMEIRA vez (sem convite anterior)', () => {
  const msg = fallbackContextual(
    {
      decisao: { acao_decidida: 'consultar_agenda' },
      perfil: PERFIL_PRONTO_REUNIAO,
      historico: [{ role: 'user', content: 'quero ver como funciona' }],
      dados_extraidos: {},
    },
    ERROS_REPETICAO
  )
  assert.match(norm(msg), /posso ver um horario rapido/)
})

test('fallback NAO repete convite de reuniao — escala pra equipe quando ja convidou (caso real topografia)', () => {
  const historico = [
    { role: 'assistant', content: CONVITE_LEVE },
    { role: 'user', content: 'Pode sim.' },
  ]
  const msg = fallbackContextual(
    {
      decisao: { acao_decidida: 'consultar_agenda' },
      perfil: PERFIL_PRONTO_REUNIAO,
      historico,
      dados_extraidos: {},
    },
    ERROS_REPETICAO
  )
  assert.doesNotMatch(norm(msg), /posso ver um horario rapido/)
  assert.match(norm(msg), /equipe da pj codeworks confirmar o melhor horario|te chamam em instantes/)
})

test('validador sinaliza repeticao de convite ja feito sem acionar handoff programado', () => {
  const historico = [
    { role: 'assistant', content: CONVITE_LEVE },
    { role: 'user', content: 'Pode sim.' },
  ]
  const v = validarRespostaPorAcao(
    {
      mensagem_pro_lead: CONVITE_LEVE,
      mensagens_bolhas: [CONVITE_LEVE],
      etapa_proxima: 'qualificacao_caminho',
    },
    {
      decisao: { acao_decidida: 'consultar_agenda', etapa_sugerida: 'sob_medida_agenda_oferecida' },
      perfil: PERFIL_PRONTO_REUNIAO,
      historico,
    }
  )
  assert.equal(v.bloqueado, false)
  assert.ok(v.avisos.some((e) => /mensagem_repetida/.test(e.erro)))
  assert.notEqual(v.resultado.handoff, true)
})

test('dado extraido de origem_clientes esta presente em dados_extraidos', () => {
  // Garante que o extrator reconhece "Indicacao" como origem — pre-condicao
  // para o patch persistir o dado em eventos_conversa.
  const d = decidirProximaAcao({
    mensagemAtual: 'Indicação',
    historico: [
      { role: 'assistant', content: 'Hoje seus clientes chegam mais por indicacao, Instagram ou Google?' },
    ],
    perfil: PERFIL_QUALIFICADO,
    etapaAtual: 'diagnostico',
  })
  assert.equal(d.dados_extraidos.origem_clientes, 'Indicação')
})

// === Fase 1 — origem persistida em eventos_conversa e lida de volta (round-trip) ===
// O merge JSONB aditivo (db-crud) ja grava origem dentro de eventos_conversa sem
// clobber. Estes casos travam o CONTRATO de leitura: o local onde a Fase 2 (LLM)
// vai gravar origem precisa ser consumido pelo canonicalizador e pelo orquestrador,
// senao o funil voltaria a re-perguntar a origem em loop.

test('Fase1: canonicalizador surfaceia origem_clientes de dentro de eventos_conversa', () => {
  const canonico = canonicalizarPerfilLead({
    negocio: 'forro de gesso',
    cidade: 'Manaus',
    produto_sugerido: 'site',
    eventos_conversa: { origem_clientes: 'marketplace e olx' },
  }, 'diagnostico')
  assert.equal(canonico.origem_clientes, 'marketplace e olx')
})

test('Fase1: com origem ja em eventos_conversa, orquestrador NAO reabre conexao_valor por origem', () => {
  const d = decidirProximaAcao({
    mensagemAtual: 'beleza',
    historico: [
      { role: 'user', content: 'tenho forro de gesso em manaus, quero um site' },
      { role: 'assistant', content: 'Boa! Forro de gesso em Manaus faz sentido para uma estrutura direta.' },
    ],
    perfil: {
      negocio: 'forro de gesso',
      cidade: 'Manaus',
      produto_sugerido: 'site',
      eventos_conversa: { origem_clientes: 'marketplace e olx' },
    },
    etapaAtual: 'diagnostico',
  })
  assert.notEqual(d.acao_decidida, 'conexao_valor')
  assert.notEqual(d.motivo_decisao, 'dados_basicos_coletados_conectar_valor')
})
