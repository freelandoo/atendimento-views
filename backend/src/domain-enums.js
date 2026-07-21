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

module.exports = { AGENDA_VENDAS, AGENDA_APP, EVENTOS_COMERCIAIS_TIPOS }
