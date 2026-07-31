'use strict'
// Fonte ÚNICA dos enums do domínio de AGENDA. Objetivo: evitar drift entre os
// `new Set([...])` do código e as `CHECK` do banco — o mesmo tipo de bug que aconteceu
// em vendas.eventos_comerciais (código aceitava um valor que a CHECK rejeitava).
//
// Existem DOIS modelos de agenda, com enums DIFERENTES (não unificar os valores — são
// esquemas distintos):
//   - AGENDA_VENDAS → vendas.agenda_eventos  (agenda do bot/funil, src/agenda.js). Superset.
//     CHECKs em sql/init.sql.
//   - AGENDA_APP    → app.agenda_eventos     (agenda multiempresa do dashboard,
//     src/services/agenda-multiempresa.js). CHECKs em sql/migrations/011_agenda_multiempresa.sql.
//
// A ordem dos valores espelha a das CHECK correspondentes. O teste test/domain-enums.test.js
// trava qualquer divergência entre estes arrays e o SQL — se você adicionar um tipo/status
// aqui, precisa refletir na CHECK (e vice-versa), senão o teste falha.

const AGENDA_VENDAS = Object.freeze({
  TIPOS: Object.freeze(['reuniao', 'follow_up', 'retorno', 'tarefa', 'prospeccao', 'disparo', 'pessoal', 'bloqueio', 'outro']),
  STATUS: Object.freeze(['pendente', 'concluido', 'atrasado', 'cancelado', 'bloqueado', 'confirmado', 'nao_compareceu', 'reagendamento_pendente']),
  PRIORIDADES: Object.freeze(['baixa', 'normal', 'media', 'alta', 'urgente']),
})

const AGENDA_APP = Object.freeze({
  TIPOS: Object.freeze(['reuniao', 'follow_up', 'retorno', 'tarefa', 'bloqueio', 'outro']),
  STATUS: Object.freeze(['pendente', 'confirmado', 'concluido', 'cancelado', 'bloqueado', 'nao_compareceu']),
  PRIORIDADES: Object.freeze(['baixa', 'normal', 'media', 'alta', 'urgente']),
})

// Tipos de vendas.eventos_comerciais. Fonte do whitelist em db-crud.js
// (registrarEventoComercial) E da CHECK eventos_comerciais_tipo_chk (sql/init.sql,
// src/db.js e migration 032). O drift entre esses dois causou, em produção, o erro
// "violates check constraint eventos_comerciais_tipo_chk" a cada auto-reply — este é o
// domínio que motivou a fonte única. Ordem espelha a CHECK.
// Obs.: followup-auto.js filtra um SUBCONJUNTO (sinais de compra, sem auto_reply_detectado)
// numa query de leitura — isso é intencional e NÃO deriva deste array.
const EVENTOS_COMERCIAIS_TIPOS = Object.freeze([
  'pediu_preco', 'recebeu_proposta', 'respondeu_followup', 'recebeu_preview', 'auto_reply_detectado',
])

// Tipos aceitos por vendas.job_queue (CHECK job_queue_tipo_chk em sql/init.sql / src/db.js).
// Diferente dos outros domínios, o job_queue NÃO tem um Set de whitelist no código — os
// tipos são literais espalhados nos INSERTs de cada produtor. O risco real é enfileirar um
// tipo FORA desta lista: a CHECK rejeita o INSERT e o job "some" (falha silenciosa). O teste
// domain-enums.test.js trava dois lados: (1) esta lista == a CHECK; (2) todo tipo literal
// enfileirado em src/ está aqui. Ordem espelha a CHECK.
const JOB_QUEUE_TIPOS = Object.freeze([
  'webhook_resposta', 'followup_auto', 'agenda_lembrete_reuniao',
  'prospeccao_nichos_sync', 'prospeccao_places_auto', 'prospeccao_completo',
  'prospeccao_envio_agendado', 'resumo_agenda_operador',
])

// --- Modulo Prospeccao & Inteligencia Comercial (Fase 0: Roteiros versionados) ---
// Status da versao de um roteiro humano. Fonte da CHECK roteiro_versoes_status_chk
// (migration 033). Publicada = imutavel; arquivada = fora de uso; rascunho = editavel.
const ROTEIRO_VERSAO_STATUS = Object.freeze(['rascunho', 'publicada', 'arquivada'])

// Tipos de etapa de um roteiro (ordem/estrutura da conversa de venda). Fonte da CHECK
// roteiro_etapas_tipo_chk (migration 033). Ordem espelha a CHECK.
const ROTEIRO_ETAPA_TIPO = Object.freeze([
  'abertura', 'permissao', 'situacao', 'descoberta', 'problema', 'implicacao',
  'insight', 'qualificacao', 'objecoes', 'convite_reuniao', 'proxima_acao',
])

// Fase 2: Campanhas. Status da campanha (CHECK campanhas_status_chk, migration 039).
const CAMPANHA_STATUS = Object.freeze(['rascunho', 'ativa', 'pausada', 'encerrada'])

// Status da OPORTUNIDADE por campanha (campanha_leads). Andamento do lead DENTRO da campanha
// — separado do resultado da ligacao. CHECK campanha_leads_status_chk (migration 039).
const OPORTUNIDADE_STATUS = Object.freeze([
  'nao_iniciado', 'tentativa_contato', 'nao_atendeu', 'contato_realizado', 'em_descoberta',
  'qualificado', 'follow_up', 'reuniao_marcada', 'proposta_enviada', 'negociacao',
  'convertido', 'descartado',
])

// Fase 3: Ligacoes. Disposicao da chamada (CHECK ligacoes_resultado_chk, migration 040).
const LIGACAO_RESULTADO = Object.freeze([
  'atendeu', 'nao_atendeu', 'caixa_postal', 'ocupado', 'numero_invalido', 'reagendou',
])

// Fatia A (migration 041): ciclo de vida da SESSAO de ligacao. A ligacao nasce
// 'em_andamento' no clique explicito de Iniciar; vira 'encerrada' (alimenta analitica)
// ou 'descartada' (fica so para auditoria). CHECK ligacoes_status_chk. So 'encerrada'
// entra em dashboards/IA (ver STATUS_ANALITICO em src/db/ligacoes.js).
const LIGACAO_STATUS = Object.freeze(['em_andamento', 'encerrada', 'descartada'])

// Fatia D (migration 044): sinais registrados DURANTE a ligacao (interesse/resistencia),
// vindos do roteiro (clique no chip) ou criados na hora. CHECK ligacao_sinais_tipo_chk /
// ligacao_sinais_origem_chk. 'novo_durante_ligacao' fica so na ligacao — promover ao
// roteiro publicado e' acao separada (nao automatica).
const SINAL_TIPO = Object.freeze(['interesse', 'resistencia'])
const SINAL_ORIGEM = Object.freeze(['roteiro', 'novo_durante_ligacao'])

// Fatia E (migration 045): objecoes registradas DURANTE a ligacao. Mesma logica de origem
// dos sinais (vinda do roteiro ou criada na hora). CHECK ligacao_objecoes_origem_chk.
const OBJECAO_ORIGEM = Object.freeze(['roteiro', 'novo_durante_ligacao'])

// Fatia C (migration 043): perguntas do roteiro marcadas como feitas DURANTE a ligacao.
// So do roteiro (nao ha criacao na hora). Desmarcar nao apaga: vira 'desmarcada' (correcao
// auditavel). CHECK ligacao_perguntas_status_chk.
const PERGUNTA_STATUS = Object.freeze(['realizada', 'desmarcada'])

// Motivo de perda (separado do status/resultado). CHECK ligacoes_motivo_perda_chk — definida
// na migration 040 e REDEFINIDA pela 052, que e' a fonte atual (o anti-drift aponta para la).
// A 052 tirou dois valores, por serem de outro dominio:
//   - 'numero_invalido'    -> e' DISPOSICAO DA CHAMADA e ja vive em LIGACAO_RESULTADO. Nos dois
//                             enums, permitia gravar contradicao (resultado='atendeu' +
//                             motivo_perda='numero_invalido').
//   - 'pediu_novo_contato' -> e' ADIAMENTO, nao perda. Ja coberto por resultado='reagendou' +
//                             status 'follow_up' + proxima_acao/data_followup. Como motivo de
//                             perda, inflava a contagem de perdas com leads ainda vivos.
// Os valores antigos ficaram em app.ligacoes_motivo_perda_v1_arquivo (auditoria).
const MOTIVO_PERDA = Object.freeze([
  'nao_era_decisor', 'sem_disponibilidade', 'sem_prioridade', 'sem_orcamento',
  'ja_tem_fornecedor', 'nao_percebeu_valor', 'sem_perfil', 'sem_interesse',
])

module.exports = {
  AGENDA_VENDAS,
  AGENDA_APP,
  EVENTOS_COMERCIAIS_TIPOS,
  JOB_QUEUE_TIPOS,
  ROTEIRO_VERSAO_STATUS,
  ROTEIRO_ETAPA_TIPO,
  CAMPANHA_STATUS,
  OPORTUNIDADE_STATUS,
  LIGACAO_RESULTADO,
  LIGACAO_STATUS,
  SINAL_TIPO,
  SINAL_ORIGEM,
  OBJECAO_ORIGEM,
  PERGUNTA_STATUS,
  MOTIVO_PERDA,
}
