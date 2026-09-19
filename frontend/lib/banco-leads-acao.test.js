'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { ACOES, acaoPrincipalDoLead } = require('./banco-leads-acao')

const BASE = { temTelefone: true, rodavel: true, travado: false }

test('lead que RESPONDEU vence tudo — inclusive trava e cooldown', () => {
  const a = acaoPrincipalDoLead({
    ...BASE, respondeu: true, travado: true, envioBloqueado: true, motivoEnvioBloqueado: 'cooldown',
  })
  assert.equal(a.chave, ACOES.RESPONDER)
  assert.equal(a.variante, 'primaria')
  assert.equal(a.motivoDesabilitado, '', 'travar o "Responder" deixa o CLIENTE sem resposta')
})

test('lead que respondeu e nao tem telefone gravado ainda abre a resposta', () => {
  // A conversa existe (ele escreveu). Cair em "+ Adicionar telefone" esconderia a resposta.
  const a = acaoPrincipalDoLead({ temTelefone: false, rodavel: false, respondeu: true })
  assert.equal(a.chave, ACOES.RESPONDER)
})

test('sem telefone, a acao e COMPLETAR o cadastro, nao abordar', () => {
  const a = acaoPrincipalDoLead({ ...BASE, temTelefone: false, rodavel: false })
  assert.equal(a.chave, ACOES.ADICIONAR_TELEFONE)
  assert.equal(a.variante, 'secundaria')
})

test('travado abre a conversa e DIZ o motivo, sem desabilitar o botao', () => {
  const a = acaoPrincipalDoLead({ ...BASE, travado: true, motivoTravado: 'sem resposta ha 5 dias' })
  assert.equal(a.chave, ACOES.TRAVADO)
  assert.equal(a.motivoDesabilitado, '', 'travar o disparo nao pode esconder o historico')
  assert.match(a.dica, /sem resposta ha 5 dias/)
})

test('nao rodavel nao oferece disparo, mas nao vira beco sem saida', () => {
  const a = acaoPrincipalDoLead({ ...BASE, rodavel: false })
  assert.equal(a.chave, ACOES.ABRIR)
  assert.equal(a.variante, 'secundaria')
})

test('mensagem pronta pede REVISAR, nunca gerar de novo', () => {
  const a = acaoPrincipalDoLead({ ...BASE, mensagemPronta: true })
  assert.equal(a.chave, ACOES.REVISAR)
  assert.match(a.rotulo, /Revisar/)
  assert.equal(acaoPrincipalDoLead(BASE).chave, ACOES.ENVIAR)
})

test('cooldown bloqueia com MOTIVO em texto, nunca so por opacidade', () => {
  const a = acaoPrincipalDoLead({ ...BASE, envioBloqueado: true, motivoEnvioBloqueado: 'Proximo envio em 12:40' })
  assert.equal(a.motivoDesabilitado, 'Proximo envio em 12:40')
  const semMotivo = acaoPrincipalDoLead({ ...BASE, envioBloqueado: true })
  assert.ok(semMotivo.motivoDesabilitado.length > 0, 'bloqueio sem motivo ainda precisa dizer algo')
})

test('sem vereditos, nao inventa disparo', () => {
  const a = acaoPrincipalDoLead()
  assert.equal(a.chave, ACOES.ADICIONAR_TELEFONE)
})

test('toda acao devolve o contrato completo', () => {
  const casos = [
    BASE,
    { ...BASE, respondeu: true },
    { ...BASE, temTelefone: false },
    { ...BASE, travado: true },
    { ...BASE, rodavel: false },
    { ...BASE, mensagemPronta: true },
  ]
  const chaves = new Set()
  for (const c of casos) {
    const a = acaoPrincipalDoLead(c)
    assert.ok(Object.values(ACOES).includes(a.chave), `chave fora do vocabulario: ${a.chave}`)
    assert.ok(a.rotulo && a.dica, 'botao sem rotulo ou sem dica')
    assert.ok(['primaria', 'secundaria'].includes(a.variante))
    assert.equal(typeof a.motivoDesabilitado, 'string')
    chaves.add(a.chave)
  }
  assert.ok(chaves.size >= 5, 'os casos cobrem menos acoes do que o vocabulario tem')
})

test('guarda: o modulo NAO recalcula elegibilidade — ele recebe o veredito', () => {
  const fonte = fs.readFileSync(require.resolve('./banco-leads-acao'), 'utf8')
  const codigo = fonte.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  // Campos crus do lead: se aparecerem aqui, nasceu uma segunda regra de elegibilidade.
  for (const cru of ['bloqueado_ate', 'tem_whatsapp', 'qualificacao', 'lead_disparos', 'rodado_em', 'status ===']) {
    assert.ok(!codigo.includes(cru), `campo cru do lead vazou para o modulo de acao: ${cru}`)
  }
})
