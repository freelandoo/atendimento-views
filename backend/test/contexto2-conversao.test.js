'use strict'

const assert = require('node:assert')
const test = require('node:test')

require('../src/logger')

const {
  detectarIntencoesHeuristicas,
} = require('../src/services/contexto2-runtime')
const { validarContexto2Playbook } = require('../src/services/contexto-empresa')

// ─── Heurística de intenções múltiplas ───────────────────────────────────────

test('detectarIntencoesHeuristicas: cadastro+preço numa frase só', () => {
  const r = detectarIntencoesHeuristicas('como eu faço para me cadastrar? e quanto custa?')
  assert.ok(r.includes('cadastro'), `esperado "cadastro" em ${JSON.stringify(r)}`)
  assert.ok(r.includes('preco'), `esperado "preco" em ${JSON.stringify(r)}`)
})

test('detectarIntencoesHeuristicas: custo/valor/investimento tambem sao preco', () => {
  assert.ok(detectarIntencoesHeuristicas('qual o custo?').includes('preco'))
  assert.ok(detectarIntencoesHeuristicas('me passa o investimento').includes('preco'))
  assert.ok(detectarIntencoesHeuristicas('quanto e?').includes('preco'))
})

test('detectarIntencoesHeuristicas: como funciona', () => {
  assert.deepEqual(detectarIntencoesHeuristicas('Como funciona?'), ['como_funciona'])
})

test('detectarIntencoesHeuristicas: tem plano gratuito', () => {
  const r = detectarIntencoesHeuristicas('vocês têm plano gratuito?')
  assert.ok(r.includes('plano_gratuito'))
})

test('detectarIntencoesHeuristicas: pediu link', () => {
  const r = detectarIntencoesHeuristicas('me manda o link aí?')
  assert.ok(r.includes('link'))
})

test('detectarIntencoesHeuristicas: quero vender curso', () => {
  const r = detectarIntencoesHeuristicas('quero vender curso na plataforma')
  assert.ok(r.includes('interesse_maquina_curso'))
})

test('detectarIntencoesHeuristicas: quero divulgar serviços', () => {
  const r = detectarIntencoesHeuristicas('quero divulgar meus serviços de design')
  assert.ok(r.includes('interesse_maquina_servicos'))
})

test('detectarIntencoesHeuristicas: captação de clientes', () => {
  const r = detectarIntencoesHeuristicas('quero captar clientes novos')
  assert.ok(r.includes('captacao_clientes'))
})

test('detectarIntencoesHeuristicas: mensagem sem padrão retorna vazio', () => {
  assert.deepEqual(detectarIntencoesHeuristicas('oi td bem'), [])
})

// ─── Esqueleto playbook v2 ───────────────────────────────────────────────────

test('validarContexto2Playbook: garante 5 novas seções de conversão', () => {
  const r = validarContexto2Playbook({})
  assert.ok(r.regras_de_conversao, 'falta regras_de_conversao')
  assert.equal(r.regras_de_conversao.nao_pedir_nome_no_inicio, true)
  assert.ok(Array.isArray(r.regras_de_conversao.estrutura_de_resposta))
  assert.ok(r.regras_de_conversao.estrutura_de_resposta.length >= 6, 'estrutura precisa ter 6 etapas')
  assert.ok(r.cadastro_e_onboarding, 'falta cadastro_e_onboarding')
  assert.ok(Array.isArray(r.cadastro_e_onboarding.passos))
  assert.ok(Array.isArray(r.maquinas_ou_modulos))
  assert.ok(Array.isArray(r.links_uteis_estruturados))
  assert.ok(r.intencoes_de_conversao.cadastro)
  assert.ok(r.intencoes_de_conversao.preco)
  assert.ok(r.intencoes_de_conversao.como_funciona)
  assert.ok(r.intencoes_de_conversao.plano_gratuito)
  assert.ok(r.intencoes_de_conversao.link)
})

test('validarContexto2Playbook: schema_version v2', () => {
  const r = validarContexto2Playbook({})
  assert.equal(r.schema_version, 'contexto2.playbook.v2')
})

test('validarContexto2Playbook: preserva customização do usuário', () => {
  const customizado = {
    regras_de_conversao: { nao_pedir_nome_no_inicio: false, regra_principal: 'CUSTOM' },
    cadastro_e_onboarding: { link_cadastro: 'https://x.com', tem_plano_gratuito: true, passos: ['a', 'b'] },
    maquinas_ou_modulos: [{ nome: 'feed' }],
  }
  const r = validarContexto2Playbook(customizado)
  assert.equal(r.regras_de_conversao.nao_pedir_nome_no_inicio, false)
  assert.equal(r.regras_de_conversao.regra_principal, 'CUSTOM')
  assert.equal(r.cadastro_e_onboarding.link_cadastro, 'https://x.com')
  assert.deepEqual(r.cadastro_e_onboarding.passos, ['a', 'b'])
  assert.equal(r.maquinas_ou_modulos.length, 1)
  assert.equal(r.maquinas_ou_modulos[0].nome, 'feed')
})

// ─── Validador de "resposta genérica" usado no simulador frontend ────────────
// Replica a lógica do avaliarGenerico (em frontend/) para garantir contrato.
function avaliarGenerico(resposta, ctx, mensagemLead) {
  const r = (resposta || '').toLowerCase()
  const lead = (mensagemLead || '').toLowerCase()
  if (!r) return null
  const falhas = []
  const fraseGenerica = ['depende da sua necessidade', 'preciso entender melhor', 'nossos serviços variam', 'pra te ajudar melhor', 'qual é o seu nome', 'qual seu nome']
  if (fraseGenerica.some((f) => r.includes(f))) falhas.push('contém frase genérica de fuga')
  const pediuNome = /(qual\s+(é\s+)?(o\s+)?seu\s+nome|me\s+(diz|fala)\s+seu\s+nome|seu\s+nome\?)/i.test(resposta)
  if (pediuNome) falhas.push('pediu nome no início')
  const pediuLink = /(tem\s+link|qual\s+(o\s+)?site|me\s+manda)/i.test(lead)
  const respostaTemUrl = /https?:\/\//i.test(resposta)
  if (pediuLink && !respostaTemUrl && /https?:\/\//i.test((ctx.links_uteis || ''))) falhas.push('lead pediu link mas resposta não tem URL')
  const pediuPreco = /(quanto\s+custa|qual\s+(o\s+)?valor|qual\s+(o\s+)?pre[çc]o|preço)/i.test(lead)
  const respostaTemPreco = /(r\$\s?\d|\d+\s*(reais|por\s+m[êe]s|por\s+ano|\/m[êe]s|\/ano))/i.test(resposta)
  if (pediuPreco && !respostaTemPreco && (ctx.precos_planos || '').trim()) falhas.push('lead pediu preço mas resposta não cita valor')
  return falhas.length ? { falhas } : null
}

const CTX_FREELANDOO = {
  nome_empresa: 'Freelandoo',
  nicho: 'rede social para freelancers',
  servicos_produtos: 'plataforma de freelancers',
  precos_planos: 'R$60/mês ou R$300/ano, com plano gratuito',
  links_uteis: 'https://www.freelandoo.com.br/',
}

test('avaliar: resposta genérica clássica é flagada (Freelandoo)', () => {
  const r = avaliarGenerico(
    'Para te ajudar com o cadastro, preciso entender melhor suas necessidades. Qual é o seu nome?',
    CTX_FREELANDOO,
    'como eu faço para me cadastrar? e quanto custa?'
  )
  assert.ok(r && r.falhas.length >= 2, 'esperava múltiplas falhas')
  assert.ok(r.falhas.some((f) => f.includes('genérica')), 'esperava falha "genérica"')
  assert.ok(r.falhas.some((f) => f.includes('nome')), 'esperava falha "nome"')
})

test('avaliar: resposta ideal Freelandoo passa', () => {
  const ideal = 'Claro. Para se cadastrar no Freelandoo, acesse https://www.freelandoo.com.br/ e crie sua conta. Você pode começar pelo gratuito; os pagos são R$60 por mês ou R$300 por ano. Quer vender serviços, criar curso ou captar clientes?'
  const r = avaliarGenerico(ideal, CTX_FREELANDOO, 'como eu faço para me cadastrar? e quanto custa?')
  assert.equal(r, null, `esperava sem falhas, recebeu ${JSON.stringify(r)}`)
})

test('avaliar: lead pede preço, resposta sem valor é flagada', () => {
  const r = avaliarGenerico(
    'Pra preço, me passa o que você precisa.',
    CTX_FREELANDOO,
    'quanto custa?'
  )
  assert.ok(r && r.falhas.some((f) => f.includes('preço')), 'esperava falha de preço')
})

test('avaliar: lead pede link, resposta sem URL é flagada', () => {
  const r = avaliarGenerico(
    'Você se cadastra direto pela nossa plataforma.',
    CTX_FREELANDOO,
    'tem link?'
  )
  assert.ok(r && r.falhas.some((f) => f.includes('URL')), 'esperava falha de link')
})

test('avaliar: sem dados no contexto, não cobra preço/link', () => {
  const ctxVazio = { nome_empresa: 'X', nicho: 'y', servicos_produtos: 'z' }
  const r = avaliarGenerico('Pra responder direito, posso te perguntar mais.', ctxVazio, 'quanto custa?')
  assert.ok(!r || !r.falhas.some((f) => f.includes('preço')), 'não pode cobrar preço quando contexto não tem')
})
