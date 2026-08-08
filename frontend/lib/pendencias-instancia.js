'use strict'
// Instâncias bloqueadas — TRADUÇÃO do veredito que a API mandou.
//
// Regra de ouro (mesma de `lib/site-rotulos.js`): este módulo só traduz. Quem decide o
// motivo e a ação é o backend (`services/webhook-quarentena.js`), e é ele que a API
// devolve em `motivo`/`acao`. Reimplementar a decisão aqui faria a tela discordar do
// servidor exatamente no caso em que a discordância é mais cara: o do dono desconhecido.
//
// Aqui NÃO existe mais `podeReprocessar`. Não é omissão: nenhuma ação desta tela vincula,
// adota, reprocessa ou regulariza instância. A única origem válida de um vínculo é o fluxo
// de criação dentro do Atendimento Views, e um vínculo criado depois não prova como a
// instância nasceu. Esta tela é alerta técnico e auditoria — só isso.
//
// Sem React, sem rede, sem DOM: testável com `node --test`.

/** Rótulo curto do motivo — cabe num selo de tabela. */
const ROTULO_MOTIVO = {
  sem_instancia: 'Sem instância no payload',
  instancia_desconhecida: 'Criada fora do Atendimento Views',
  erro_resolucao: 'Falha ao resolver',
}

/** O que aconteceu, em uma frase, sem jargão de banco. */
const EXPLICACAO_MOTIVO = {
  sem_instancia:
    'Estes webhooks chegaram sem dizer de qual número vieram. Sem isso não há como saber a qual empresa pertencem.',
  instancia_desconhecida:
    'Esta instância não foi criada pelo Atendimento Views (ou o vínculo dela foi desativado). Ela não pertence a nenhuma empresa aqui dentro e foi bloqueada: nada do que ela envia é gravado.',
  erro_resolucao:
    'Houve uma falha técnica ao consultar o cadastro do número. É transitório: nada a cadastrar, só verificar o serviço.',
}

/**
 * O próximo passo do operador.
 *
 * Nenhum deles é uma ação DESTA tela — são coisas a fazer fora dela (na Evolution, na
 * infraestrutura, ou criando a instância pelo produto). É o que diferencia um alerta
 * técnico de um formulário de vínculo.
 */
const ACAO_MOTIVO = {
  auditar_origem_instancia:
    'Se este número é seu, crie a instância aqui no Atendimento Views, dentro da empresa dele — ela vai nascer com outro nome técnico e já vinculada. Instâncias criadas direto no Evolution não podem ser adotadas.',
  revisar_webhook_evolution: 'Revise a configuração do webhook na Evolution API para que ele envie o nome da instância.',
  verificar_infraestrutura: 'Verifique o banco/serviço e acompanhe. Assim que a consulta voltar a funcionar, os webhooks daquele número seguem o fluxo normal.',
}

/** Motivo desconhecido não vira texto inventado — vira o próprio código, visível. */
function rotuloMotivo(motivo) {
  return ROTULO_MOTIVO[motivo] || String(motivo || 'Desconhecido')
}

function explicacaoMotivo(motivo) {
  return EXPLICACAO_MOTIVO[motivo] || 'Origem não reconhecida por esta versão do painel.'
}

function acaoTexto(acao) {
  return ACAO_MOTIVO[acao] || 'Sem ação automática. Verifique a configuração do número.'
}

/**
 * Tom do selo. `erro_resolucao` é transitório (âmbar); os outros pedem ação de cadastro
 * (vermelho). Resolvida é verde.
 */
function tomPendencia(pendencia) {
  if (!pendencia) return 'neutro'
  if (pendencia.resolvida_em) return 'ok'
  return pendencia.transitorio ? 'atencao' : 'alerta'
}

/** Resumo de uma linha para o cabeçalho do painel. */
function resumoTexto(resumo) {
  const total = Number(resumo && resumo.total) || 0
  if (!total) return 'Nenhuma instância bloqueada. Todos os webhooks recebidos vêm de instâncias criadas aqui.'
  const plural = total === 1 ? 'número está' : 'números estão'
  return `${total} ${plural} enviando mensagens sem vínculo autorizado. Nada foi gravado para eles.`
}

module.exports = {
  ROTULO_MOTIVO,
  EXPLICACAO_MOTIVO,
  ACAO_MOTIVO,
  rotuloMotivo,
  explicacaoMotivo,
  acaoTexto,
  tomPendencia,
  resumoTexto,
}
