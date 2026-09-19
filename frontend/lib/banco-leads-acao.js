'use strict'
// A ACAO PRINCIPAL de um lead no Banco de Leads — qual botao a tela oferece, com que rotulo,
// e por que ele esta bloqueado quando esta.
//
// POR QUE ESTE MODULO EXISTE (medido em 2026-09-19): a acao principal da tela nao era um
// botao. Era um GESTO — clicar no telefone dentro de uma celula da tabela — e a propria tela
// precisava ensina-lo por escrito ("Clique no telefone do lead para gerar e enviar a
// saudacao"). Interface que explica o proprio gesto em texto esta dizendo que o gesto nao se
// anuncia sozinho. No celular isso piora: o alvo e' um link de 12px no meio de uma tabela com
// rolagem horizontal.
//
// ⚠️ ESTE MODULO NAO DECIDE NADA DE NEGOCIO. Ele RECEBE vereditos ja resolvidos (o lead e'
// rodavel? esta travado? tem mensagem pronta?) e devolve o texto e o tom do botao. Quem
// decide "rodavel" e' `services/rodar-leads.js` no backend, e a tela ja o traduz em
// `isRodavel`/`isLocked`. Passar o lead cru aqui convidaria a uma SEGUNDA regra de
// elegibilidade, mais frouxa que a do backend — exatamente o defeito que
// `lib/lead-fila-trabalho.js` e `lib/site-rotulos.js` existem para impedir.
//
// Vocabulario FECHADO: chave desconhecida nao existe. Uma acao nova nasce aqui, com teste.

const ACOES = Object.freeze({
  RESPONDER: 'responder',
  ENVIAR: 'enviar',
  REVISAR: 'revisar',
  ADICIONAR_TELEFONE: 'adicionar_telefone',
  TRAVADO: 'travado',
  ABRIR: 'abrir',
})

/**
 * @param {object} v vereditos JA resolvidos pela tela/backend.
 * @param {boolean} v.temTelefone
 * @param {boolean} v.rodavel      `isRodavel(l)` — elegibilidade do backend.
 * @param {boolean} v.travado      `isLocked(l)` — trava de 15 dias.
 * @param {string}  [v.motivoTravado]
 * @param {boolean} [v.mensagemPronta]  ja existe rascunho gerado.
 * @param {boolean} [v.respondeu]       o lead escreveu de volta.
 * @param {boolean} [v.erroIa]
 * @param {boolean} [v.envioBloqueado]  cooldown/instancia desconectada.
 * @param {string}  [v.motivoEnvioBloqueado]
 */
function acaoPrincipalDoLead(v = {}) {
  const {
    temTelefone = false,
    rodavel = false,
    travado = false,
    motivoTravado = '',
    mensagemPronta = false,
    respondeu = false,
    erroIa = false,
    envioBloqueado = false,
    motivoEnvioBloqueado = '',
  } = v

  // Alguem do outro lado esperando vence tudo — inclusive trava e cooldown, que sao regras de
  // ABORDAGEM e nao de resposta. Travar o "Responder" deixaria o CLIENTE sem resposta porque
  // o sistema decidiu que ainda nao era hora de abordar. Mesma disciplina do painel de
  // conversa, que avisa mas nunca barra.
  if (respondeu) {
    return {
      chave: ACOES.RESPONDER,
      rotulo: 'Responder agora',
      variante: 'primaria',
      motivoDesabilitado: '',
      dica: 'O lead respondeu — abrir a conversa',
    }
  }

  // Sem numero o lead nem entra na fila de abordagem: o trabalho que cabe nele e' completar o
  // cadastro, e e' isso que o botao tem de oferecer.
  if (!temTelefone) {
    return {
      chave: ACOES.ADICIONAR_TELEFONE,
      rotulo: '+ Adicionar telefone',
      variante: 'secundaria',
      motivoDesabilitado: '',
      dica: 'Sem telefone este lead nao pode ser abordado',
    }
  }

  if (travado) {
    return {
      chave: ACOES.TRAVADO,
      rotulo: 'Abrir conversa',
      variante: 'secundaria',
      // O motivo NAO desabilita o botao: abrir a conversa continua permitido, o que esta
      // bloqueado e' o disparo. Desabilitar aqui esconderia o historico do lead.
      motivoDesabilitado: '',
      dica: motivoTravado ? `Disparo travado: ${motivoTravado}` : 'Disparo travado',
    }
  }

  if (!rodavel) {
    return {
      chave: ACOES.ABRIR,
      rotulo: 'Abrir conversa',
      variante: 'secundaria',
      motivoDesabilitado: '',
      dica: 'Este lead nao esta elegivel para disparo agora',
    }
  }

  // Rascunho pronto (Semiautomatico, ou "Gerar mensagens" em lote): a proxima acao humana e'
  // REVISAR e mandar, nao gerar de novo. Oferecer "Enviar saudacao" aqui faria a pessoa achar
  // que o texto seria reescrito.
  const base = mensagemPronta
    ? { chave: ACOES.REVISAR, rotulo: 'Revisar e enviar', dica: 'Mensagem ja gerada — revise antes de enviar' }
    : { chave: ACOES.ENVIAR, rotulo: 'Enviar saudacao', dica: 'Gera a saudacao e abre para envio' }

  return {
    ...base,
    variante: 'primaria',
    // Cooldown e instancia desconectada bloqueiam com MOTIVO em texto, nunca so por opacidade:
    // botao apagado sem explicacao faz o operador clicar de novo achando que falhou.
    motivoDesabilitado: envioBloqueado ? motivoEnvioBloqueado || 'Envio indisponivel agora' : '',
    dica: erroIa ? 'A IA falhou ao gerar a mensagem — tente de novo' : base.dica,
  }
}

module.exports = { ACOES, acaoPrincipalDoLead }
