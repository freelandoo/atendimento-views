'use strict'

// "Testar conexão" da integração Meta de UMA empresa.
//
// O que este teste prova (e por que ele existe antes do botão Ativar):
//   1. o token/dataset/destino da empresa são aceitos pela Graph API;
//   2. CADA nome de evento habilitado é aceito na taxonomia de Click-to-WhatsApp.
//
// O item 2 não é zelo: o AGENTS.md registra `QualifiedLead` REJEITADO em produção
// (subcode 2804066) numa versão anterior da taxonomia, enquanto a documentação
// vigente o lista como suportado. Descobrir isso aqui custa um teste; descobrir
// depois de ativar custa semanas de conversão perdida em silêncio.
//
// SEGURANÇA DO TESTE: sempre em modo teste (test_event_code) e com event_id
// sintético prefixado por `teste:`. Nenhum evento real é criado, nenhuma conversão
// de verdade entra na otimização da campanha.

const { enviarEventoMetaCAPI } = require('./meta-capi')
const { tiposHabilitados, nomeMetaDoTipo, mensagemDeErro, MOEDA_PADRAO } = require('./meta-conversao')
const integracoesDb = require('../db/meta-integracoes')

// ctwa_clid sintético: a Meta exige o campo, e um valor inexistente é justamente o
// que faz o evento não ser atribuído a ninguém. É o comportamento desejado num teste.
const CLID_TESTE = 'TESTE_CONEXAO_ATENDIMENTO_VIEWS'

/**
 * Roda o teste e persiste o resultado em app.meta_integracoes.
 *
 * @returns {{ok:boolean, mensagem?:string, eventos:Array<{tipo,event_name,ok,mensagem}>}}
 */
async function testarConexaoMeta(pool, empresaId, deps = {}) {
  const enviar = deps.enviarEvento || enviarEventoMetaCAPI
  const agora = deps.agora instanceof Date ? deps.agora : new Date()

  const credencial = await integracoesDb.obterCredencial(pool, empresaId)
  if (!credencial) {
    const e = new Error('Integração da Meta não configurada para esta empresa.')
    e.statusCode = 404
    throw e
  }

  const tipos = tiposHabilitados(credencial)
  if (!tipos.length) {
    const mensagem = 'Escolha pelo menos um evento antes de testar a conexão.'
    await integracoesDb.registrarTeste(pool, empresaId, { ok: false, mensagemErro: mensagem })
    return { ok: false, mensagem, eventos: [] }
  }

  // O test_event_code do tenant é usado quando existe; senão, um código sintético
  // garante que o teste NUNCA saia como evento de produção.
  const config = {
    datasetId: credencial.datasetId,
    token: credencial.token,
    pageId: credencial.pageId,
    wabaId: credencial.wabaId,
    testEventCode: credencial.testEventCode || 'TEST_ATENDIMENTO_VIEWS',
  }

  const eventos = []
  let ok = true
  let primeiraFalha = null

  for (const tipo of tipos) {
    const eventName = nomeMetaDoTipo(tipo)
    const res = await enviar(
      config,
      {
        eventName,
        eventId: `teste:${tipo}:${agora.getTime()}`,
        ctwaClid: CLID_TESTE,
        eventTime: Math.floor(agora.getTime() / 1000),
        // Purchase exige valor; um valor simbólico prova que o formato é aceito sem
        // inventar receita (o evento é de teste e não entra na otimização).
        value: tipo === 'reuniao_realizada_com_venda' ? 1 : undefined,
        currency: tipo === 'reuniao_realizada_com_venda' ? MOEDA_PADRAO : undefined,
      },
      deps
    )
    const mensagem = res.ok
      ? null
      : (res.motivo === 'config_invalida'
        ? 'Configuração incompleta: confira o conjunto de dados, o token e o ID da Página/WhatsApp Business.'
        : mensagemDeErro({ codigo: res.erro?.codigo, subcodigo: res.erro?.subcodigo, httpStatus: res.status }))
    eventos.push({ tipo, event_name: eventName, ok: res.ok === true, mensagem })
    if (!res.ok) {
      ok = false
      if (!primeiraFalha) primeiraFalha = `${eventName}: ${mensagem}`
    }
  }

  await integracoesDb.registrarTeste(pool, empresaId, { ok, mensagemErro: primeiraFalha })
  return {
    ok,
    mensagem: ok
      ? 'Conexão com a Meta funcionando. Os eventos escolhidos foram aceitos em modo teste.'
      : primeiraFalha,
    eventos,
  }
}

module.exports = { CLID_TESTE, testarConexaoMeta }
