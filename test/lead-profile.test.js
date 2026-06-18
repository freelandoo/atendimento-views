'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  extractFromMessage,
  getMissingInfo,
  mergeProfile,
  fromDbProfile,
} = require('../src/lead-profile')

// ─── extractFromMessage ───────────────────────────────────────────────────────

test('extrai businessType e city da mensagem do caso do usuário', () => {
  const result = extractFromMessage('Sou dentista em Santo André.')
  assert.equal(result.businessType, 'dentista')
  assert.equal(result.city, 'Santo André')
})

test('extrai businessType via "trabalho com"', () => {
  const result = extractFromMessage('Trabalho com estética automotiva em Santos')
  assert.equal(result.businessType, 'estética automotiva')
  assert.equal(result.city, 'Santos')
})

test('extrai businessType via "tenho uma"', () => {
  const result = extractFromMessage('Tenho uma pizzaria aqui em São Paulo')
  assert.ok(result.businessType?.includes('pizzaria'))
})

test('extrai businessType via "minha empresa é"', () => {
  const result = extractFromMessage('Minha empresa é de construção civil')
  assert.ok(result.businessType?.includes('construção civil'))
})

test('extrai mainService: site', () => {
  const result = extractFromMessage('preciso de um site para minha loja')
  assert.equal(result.mainService, 'site')
})

test('extrai mainService: sistema', () => {
  const result = extractFromMessage('quero um sistema de agendamento')
  assert.equal(result.mainService, 'sistema')
})

test('extrai mainService: automacao', () => {
  const result = extractFromMessage('quero automatizar meu atendimento')
  assert.equal(result.mainService, 'automacao')
})

test('extrai mainService: agente de IA', () => {
  const result = extractFromMessage('preciso de um agente de IA para vendas')
  assert.equal(result.mainService, 'agente de IA')
})

test('extrai hasWebsite: true', () => {
  const result = extractFromMessage('tenho um site mas está desatualizado')
  assert.equal(result.hasWebsite, true)
})

test('extrai hasWebsite: false — "não tenho site"', () => {
  const result = extractFromMessage('não tenho site nenhum')
  assert.equal(result.hasWebsite, false)
})

test('extrai hasWebsite: false — "sem site"', () => {
  const result = extractFromMessage('to aqui sem site ainda')
  assert.equal(result.hasWebsite, false)
})

test('hasWebsite permanece null quando não mencionado', () => {
  const result = extractFromMessage('quero saber mais sobre vocês')
  assert.ok(!('hasWebsite' in result))
})

test('extrai usesInstagram: true', () => {
  const result = extractFromMessage('uso instagram pra divulgar')
  assert.equal(result.usesInstagram, true)
})

test('extrai usesInstagram: false', () => {
  const result = extractFromMessage('não uso instagram')
  assert.equal(result.usesInstagram, false)
})

test('extrai appearsOnGoogle: true', () => {
  const result = extractFromMessage('apareço no Google Meu Negócio')
  assert.equal(result.appearsOnGoogle, true)
})

test('extrai appearsOnGoogle: false', () => {
  const result = extractFromMessage('não apareço no google')
  assert.equal(result.appearsOnGoogle, false)
})

test('extrai goal: leads', () => {
  const result = extractFromMessage('quero gerar mais clientes pelo digital')
  assert.equal(result.goal, 'leads')
})

test('extrai goal: authority', () => {
  const result = extractFromMessage('quero ter autoridade no meu segmento')
  assert.equal(result.goal, 'authority')
})

test('extrai goal: google', () => {
  const result = extractFromMessage('preciso aparecer no Google')
  assert.equal(result.goal, 'google')
})

test('extrai goal: professional_presence', () => {
  const result = extractFromMessage('quero parecer mais profissional')
  assert.equal(result.goal, 'professional_presence')
})

test('extrai budgetSignal: low', () => {
  const result = extractFromMessage('não tenho muito budget')
  assert.equal(result.budgetSignal, 'low')
})

test('extrai budgetSignal: low via "sem verba"', () => {
  const result = extractFromMessage('to sem verba agora')
  assert.equal(result.budgetSignal, 'low')
})

test('extrai budgetSignal: high', () => {
  const result = extractFromMessage('quero o melhor, não me preocupo com preço')
  assert.equal(result.budgetSignal, 'high')
})

test('extrai meetingInterest: true', () => {
  const result = extractFromMessage('quero marcar uma conversa')
  assert.equal(result.meetingInterest, true)
})

test('extrai meetingInterest: false', () => {
  const result = extractFromMessage('prefiro por aqui mesmo, sem reunião')
  assert.equal(result.meetingInterest, false)
})

test('extrai múltiplos campos numa mesma mensagem', () => {
  const result = extractFromMessage(
    'Sou advogada em São Bernardo, não tenho site e quero gerar mais clientes'
  )
  assert.equal(result.businessType, 'advogada')
  assert.ok(result.city?.toLowerCase().includes('bernardo') || result.city?.toLowerCase().includes('são bernardo'))
  assert.equal(result.hasWebsite, false)
  assert.equal(result.goal, 'leads')
})

test('retorna objeto vazio para string vazia', () => {
  assert.deepEqual(extractFromMessage(''), {})
  assert.deepEqual(extractFromMessage('   '), {})
  assert.deepEqual(extractFromMessage(null), {})
})

// ─── getMissingInfo ───────────────────────────────────────────────────────────

test('perfil vazio → todos os 5 campos obrigatórios faltando', () => {
  const missing = getMissingInfo({})
  assert.deepEqual(missing, ['businessType', 'city', 'mainService', 'hasWebsite', 'goal'])
})

test('perfil completo → nenhum campo faltando', () => {
  const profile = {
    businessType: 'dentista',
    city: 'Santo André',
    mainService: 'site',
    hasWebsite: false,
    goal: 'leads',
  }
  assert.deepEqual(getMissingInfo(profile), [])
})

test('hasWebsite = false NÃO é campo faltante (false é dado conhecido)', () => {
  const profile = {
    businessType: 'dentista',
    city: 'SP',
    mainService: 'site',
    hasWebsite: false,  // sabemos que não tem site — não devemos perguntar de novo
    goal: 'leads',
  }
  const missing = getMissingInfo(profile)
  assert.ok(!missing.includes('hasWebsite'), 'hasWebsite=false não deveria ser missing')
  assert.deepEqual(missing, [])
})

test('hasWebsite = null É campo faltante (não perguntamos ainda)', () => {
  const profile = { businessType: 'loja', city: 'SP', mainService: 'site', hasWebsite: null, goal: 'leads' }
  assert.ok(getMissingInfo(profile).includes('hasWebsite'))
})

test('retorna apenas os campos que faltam (parcialmente preenchido)', () => {
  const missing = getMissingInfo({ businessType: 'dentista', city: 'Santo André' })
  assert.ok(missing.includes('mainService'))
  assert.ok(missing.includes('hasWebsite'))
  assert.ok(missing.includes('goal'))
  assert.ok(!missing.includes('businessType'))
  assert.ok(!missing.includes('city'))
})

// ─── O caso do usuário: IA não deve repetir perguntas respondidas ─────────────

test('caso do usuário: não pergunta negócio/cidade já respondidos', () => {
  // Lead disse: "Sou dentista em Santo André"
  const extracted = extractFromMessage('Sou dentista em Santo André.')
  const profile = mergeProfile({}, extracted)

  const missing = getMissingInfo(profile)

  // Não deve pedir businessType nem city — já foram informados
  assert.ok(!missing.includes('businessType'), 'businessType já foi coletado')
  assert.ok(!missing.includes('city'), 'city já foi coletado')

  // Deve ainda pedir os dados restantes
  assert.ok(missing.includes('mainService'))
  assert.ok(missing.includes('hasWebsite'))
  assert.ok(missing.includes('goal'))
})

// ─── mergeProfile ─────────────────────────────────────────────────────────────

test('merge adiciona campos novos ao perfil', () => {
  const existing = { businessType: 'dentista' }
  const updates = { city: 'Santo André', mainService: 'site' }
  const result = mergeProfile(existing, updates)
  assert.equal(result.businessType, 'dentista')
  assert.equal(result.city, 'Santo André')
  assert.equal(result.mainService, 'site')
})

test('merge NÃO sobrescreve campo já definido', () => {
  const existing = { businessType: 'dentista', city: 'Santo André' }
  const updates = { city: 'São Paulo' }  // tentativa de sobrescrever
  const result = mergeProfile(existing, updates)
  assert.equal(result.city, 'Santo André')  // original preservado
})

test('merge é imutável — não altera o objeto original', () => {
  const existing = { businessType: 'dentista' }
  const updates = { city: 'SP' }
  const result = mergeProfile(existing, updates)
  assert.ok(!('city' in existing), 'objeto original não deve ser alterado')
  assert.equal(result.city, 'SP')
})

test('merge aceita false em updates e não sobrescreve null existente', () => {
  const existing = { hasWebsite: null }
  const updates = { hasWebsite: false }
  const result = mergeProfile(existing, updates)
  assert.equal(result.hasWebsite, false)  // null foi substituído por false (valor real)
})

test('merge não sobrescreve false com novo valor', () => {
  const existing = { hasWebsite: false }
  const updates = { hasWebsite: true }
  const result = mergeProfile(existing, updates)
  assert.equal(result.hasWebsite, false)  // false é dado conhecido, não sobrescreve
})

// ─── fromDbProfile ────────────────────────────────────────────────────────────

test('converte schema do banco para LeadProfile', () => {
  const dbPerfil = {
    negocio: 'clínica odontológica',
    cidade: 'São Paulo',
    servico_principal: 'site',
    ticket_cliente_final: 'medio',
    reuniao_proposta: { necessaria: true },
  }
  const profile = fromDbProfile(dbPerfil)
  assert.equal(profile.businessType, 'clínica odontológica')
  assert.equal(profile.city, 'São Paulo')
  assert.equal(profile.mainService, 'site')
  assert.equal(profile.budgetSignal, 'medium')
  assert.equal(profile.meetingInterest, true)
})

test('fromDbProfile usa servico_foco como fallback para mainService', () => {
  const dbPerfil = { servico_foco: 'automacao' }
  const profile = fromDbProfile(dbPerfil)
  assert.equal(profile.mainService, 'automacao')
})

test('fromDbProfile usa necessidade como fallback para mainService', () => {
  const dbPerfil = { necessidade: 'sistema' }
  const profile = fromDbProfile(dbPerfil)
  assert.equal(profile.mainService, 'sistema')
})

test('fromDbProfile mapeia ticket alto para high', () => {
  const profile = fromDbProfile({ ticket_cliente_final: 'alto' })
  assert.equal(profile.budgetSignal, 'high')
})

test('fromDbProfile retorna null para campos novos ausentes no banco', () => {
  const profile = fromDbProfile({ negocio: 'loja' })
  assert.equal(profile.hasWebsite, null)
  assert.equal(profile.usesInstagram, null)
  assert.equal(profile.goal, null)
})

test('fromDbProfile: perfil vazio retorna todos os campos null', () => {
  const profile = fromDbProfile({})
  assert.equal(profile.businessType, null)
  assert.equal(profile.city, null)
  assert.equal(profile.mainService, null)
  assert.equal(profile.hasWebsite, null)
  assert.equal(profile.goal, null)
  assert.equal(profile.budgetSignal, null)
})
