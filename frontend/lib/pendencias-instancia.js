'use strict'
// Pendências de instância — TRADUÇÃO do veredito que a API mandou.
//
// Regra de ouro (mesma de `lib/site-rotulos.js`): este módulo só traduz. Quem decide o
// motivo e a ação é o backend (`services/webhook-quarentena.js`), e é ele que a API
// devolve em `motivo`/`acao`. Reimplementar a decisão aqui faria a tela discordar do
// servidor exatamente no caso em que a discordância é mais cara: o do dono desconhecido.
//
// Sem React, sem rede, sem DOM: testável com `node --test`.

/** Rótulo curto do motivo — cabe num selo de tabela. */
const ROTULO_MOTIVO = {
  sem_instancia: 'Sem instância no payload',
  instancia_desconhecida: 'Instância não mapeada',
  erro_resolucao: 'Falha ao resolver',
}

/** O que aconteceu, em uma frase, sem jargão de banco. */
const EXPLICACAO_MOTIVO = {
  sem_instancia:
    'Estes webhooks chegaram sem dizer de qual número vieram. Sem isso não há como saber a qual empresa pertencem.',
  instancia_desconhecida:
    'Este número está enviando mensagens, mas não está cadastrado em nenhuma empresa (ou está inativo).',
  erro_resolucao:
    'Houve uma falha técnica ao consultar o cadastro do número. É transitório: nada a cadastrar, só verificar o serviço.',
}

/** O próximo passo do operador. */
const ACAO_MOTIVO = {
  mapear_instancia: 'Cadastre este número na empresa correta e depois clique em Reprocessar.',
  revisar_webhook_evolution: 'Revise a configuração do webhook na Evolution API para que ele envie o nome da instância.',
  verificar_infraestrutura: 'Verifique o banco/serviço e acompanhe. A pendência se fecha ao reprocessar, se o vínculo existir.',
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
 * O botão "Reprocessar" faz sentido para esta pendência?
 * `sem_instancia` não tem o que reconsultar (não há nome de instância), e a rota recusa —
 * mostrar o botão ali só produziria um erro previsível.
 */
function podeReprocessar(pendencia) {
  if (!pendencia || pendencia.resolvida_em) return false
  return pendencia.motivo !== 'sem_instancia'
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
  if (!total) return 'Nenhuma pendência aberta. Todos os webhooks recebidos têm dono comprovado.'
  const plural = total === 1 ? 'número está' : 'números estão'
  return `${total} ${plural} enviando mensagens sem dono comprovado. Nada foi gravado para eles.`
}

module.exports = {
  ROTULO_MOTIVO,
  EXPLICACAO_MOTIVO,
  ACAO_MOTIVO,
  rotuloMotivo,
  explicacaoMotivo,
  acaoTexto,
  podeReprocessar,
  tomPendencia,
  resumoTexto,
}
