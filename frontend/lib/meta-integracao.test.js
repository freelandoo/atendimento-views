'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  EVENTOS, estadoDaIntegracao, rotuloEstado, descricaoEstado, tomEstado,
  validarFormulario, algumEventoLigado, acoesDisponiveis,
  rotuloStatusEvento, rotuloTipoEvento, formatarValor, explicacaoDoEvento,
} = require('./meta-integracao')

function integracao(over = {}) {
  return {
    id: 'int-1',
    empresa_id: 'emp-1',
    dataset_id: '1572278814315441',
    page_id: null,
    waba_id: 'WABA-A',
    token_hint: '4821',
    test_event_code: null,
    status: 'em_teste',
    eventos: { reuniao_agendada: true, reuniao_realizada: false, reuniao_realizada_com_venda: false },
    ultimo_teste_em: null,
    ultimo_teste_ok: null,
    ultimo_erro: null,
    criado_em: '2026-08-07T10:00:00Z',
    atualizado_em: '2026-08-07T10:00:00Z',
    ...over,
  }
}

// ─── Estados ──────────────────────────────────────────────────────────────────

test('ausência de configuração é "não configurada", não um status salvo', () => {
  assert.equal(estadoDaIntegracao(null), 'nao_configurada')
  assert.equal(estadoDaIntegracao(undefined), 'nao_configurada')
  assert.equal(rotuloEstado(estadoDaIntegracao(null)), 'Não configurada')
})

test('os cinco estados do produto têm rótulo, descrição e tom próprios', () => {
  const estados = ['nao_configurada', 'em_teste', 'ativa', 'precisa_atencao', 'desativada']
  const rotulos = estados.map(rotuloEstado)
  assert.deepEqual(rotulos, ['Não configurada', 'Em teste', 'Ativa', 'Precisa de atenção', 'Desativada'])
  assert.equal(new Set(rotulos).size, 5)
  assert.equal(new Set(estados.map(descricaoEstado)).size, 5)
  for (const e of estados) assert.ok(tomEstado(e))
})

test('status desconhecido do backend não vira estado inventado', () => {
  assert.equal(estadoDaIntegracao(integracao({ status: 'ligadinha' })), 'nao_configurada')
})

// ─── Eventos e ajuda ──────────────────────────────────────────────────────────

test('os três eventos configuráveis aparecem na ordem do funil, com ajuda própria', () => {
  assert.deepEqual(EVENTOS.map((e) => e.chave), [
    'reuniao_agendada', 'reuniao_realizada', 'reuniao_realizada_com_venda',
  ])
  for (const e of EVENTOS) assert.ok(e.ajuda && e.ajuda.length > 20, `${e.chave} sem ajuda`)
})

test('a ajuda diz o que NÃO é enviado (cancelada/no-show) e que venda exige valor', () => {
  const realizada = EVENTOS.find((e) => e.chave === 'reuniao_realizada')
  assert.match(realizada.ajuda, /cancelada/i)
  assert.match(realizada.ajuda, /não compareceu/i)
  const venda = EVENTOS.find((e) => e.chave === 'reuniao_realizada_com_venda')
  assert.match(venda.ajuda, /valor/i)
  const agendada = EVENTOS.find((e) => e.chave === 'reuniao_agendada')
  assert.match(agendada.ajuda, /data e horário/i)
})

test('algumEventoLigado só é verdadeiro com pelo menos um ligado', () => {
  assert.equal(algumEventoLigado({}), false)
  assert.equal(algumEventoLigado({ reuniao_agendada: false }), false)
  assert.equal(algumEventoLigado({ reuniao_realizada_com_venda: true }), true)
})

// ─── Formulário ───────────────────────────────────────────────────────────────

test('formulário exige dataset numérico, um destino e o token', () => {
  const vazio = validarFormulario({})
  assert.equal(vazio.ok, false)
  assert.ok(vazio.erros.dataset_id)
  assert.ok(vazio.erros.destino)
  assert.ok(vazio.erros.access_token)

  const datasetTorto = validarFormulario({ dataset_id: 'meu-pixel', waba_id: 'w', access_token: 't' })
  assert.equal(datasetTorto.ok, false)
  assert.match(datasetTorto.erros.dataset_id, /só números/)

  const ok = validarFormulario({ dataset_id: '1572278814315441', waba_id: 'WABA-A', access_token: 'EAAG...' })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.erros, {})
})

test('Página do Facebook OU conta WhatsApp Business satisfazem o destino', () => {
  const comPage = validarFormulario({ dataset_id: '1572278814315441', page_id: 'PAGE1', access_token: 't' })
  assert.equal(comPage.ok, true)
  const comWaba = validarFormulario({ dataset_id: '1572278814315441', waba_id: 'W1', access_token: 't' })
  assert.equal(comWaba.ok, true)
})

test('numa integração já salva, o token precisa ser colado de novo — e a tela explica', () => {
  const r = validarFormulario(
    { dataset_id: '1572278814315441', waba_id: 'W1', access_token: '' },
    { jaConfigurada: true }
  )
  assert.equal(r.ok, false)
  assert.match(r.erros.access_token, /novamente/)
})

// ─── Ações ────────────────────────────────────────────────────────────────────

test('sem configuração, nada além de salvar é oferecido', () => {
  const a = acoesDisponiveis(null)
  assert.deepEqual(
    { t: a.podeTestar, at: a.podeAtivar, d: a.podeDesativar, r: a.podeRemover },
    { t: false, at: false, d: false, r: false }
  )
  assert.match(a.motivoAtivarBloqueado, /Salve a configuração/)
})

test('ativar exige teste bem-sucedido — e o motivo do bloqueio é explícito', () => {
  const semTeste = acoesDisponiveis(integracao({ ultimo_teste_ok: null }))
  assert.equal(semTeste.podeAtivar, false)
  assert.match(semTeste.motivoAtivarBloqueado, /Teste a conexão/)

  const testeFalhou = acoesDisponiveis(integracao({ ultimo_teste_ok: false, status: 'precisa_atencao' }))
  assert.equal(testeFalhou.podeAtivar, false)

  const pronta = acoesDisponiveis(integracao({ ultimo_teste_ok: true }))
  assert.equal(pronta.podeAtivar, true)
  assert.equal(pronta.motivoAtivarBloqueado, null)
})

test('sem nenhum evento ligado não dá para testar nem ativar', () => {
  const semEventos = acoesDisponiveis(integracao({
    ultimo_teste_ok: true,
    eventos: { reuniao_agendada: false, reuniao_realizada: false, reuniao_realizada_com_venda: false },
  }))
  assert.equal(semEventos.podeTestar, false)
  assert.equal(semEventos.podeAtivar, false)
  assert.match(semEventos.motivoAtivarBloqueado, /pelo menos um evento/)
})

test('integração ativa oferece desativar, e não oferece ativar de novo', () => {
  const ativa = acoesDisponiveis(integracao({ status: 'ativa', ultimo_teste_ok: true }))
  assert.equal(ativa.podeDesativar, true)
  assert.equal(ativa.podeAtivar, false)
})

// ─── Histórico ────────────────────────────────────────────────────────────────

test('cada status de evento tem rótulo em português para o operador', () => {
  assert.equal(rotuloStatusEvento('pendente'), 'Aguardando envio')
  assert.equal(rotuloStatusEvento('enviado'), 'Enviado')
  assert.equal(rotuloStatusEvento('falhou'), 'Falhou')
  assert.equal(rotuloStatusEvento('ignorado'), 'Não enviado')
  assert.equal(rotuloStatusEvento('corrigido'), 'Corrigido depois do envio')
})

test('tipo do evento aparece com o nome de negócio, não com a chave técnica', () => {
  assert.equal(rotuloTipoEvento('reuniao_realizada_com_venda'), 'Reunião realizada com venda')
  assert.equal(rotuloTipoEvento('reuniao_agendada'), 'Reunião agendada')
})

test('valor sem venda vira traço, nunca R$ 0,00', () => {
  assert.equal(formatarValor(null), '—')
  assert.equal(formatarValor(undefined, 'BRL'), '—')
  const fmt = formatarValor(2500, 'BRL')
  assert.match(fmt, /2\.500/)
  assert.equal(fmt.includes('R$'), true)
})

test('explicação: erro no que falhou, motivo no que não foi enviado, aviso no corrigido', () => {
  assert.equal(explicacaoDoEvento({ status: 'falhou', erro: 'Token inválido ou expirado.' }), 'Token inválido ou expirado.')
  assert.equal(
    explicacaoDoEvento({ status: 'ignorado', motivo: 'A reunião foi cancelada…' }),
    'A reunião foi cancelada…'
  )
  assert.match(explicacaoDoEvento({ status: 'corrigido' }), /não aceita correção/)
  // Evento enviado com sucesso não precisa de explicação nenhuma.
  assert.equal(explicacaoDoEvento({ status: 'enviado' }), null)
})
