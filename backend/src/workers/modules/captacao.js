'use strict'

const WORKERS_CAPTACAO = Object.freeze([
  {
    nome: 'captacao-social',
    essencial: false,
    descricao: 'Coleta social (Bright Data) e agendamento de campanhas.',
    cadencia: 'CAPTACAO_WORKER_POLL_MS',
    risco: 'credito_pago',
    iniciar: () => require('../../services/social-capture').iniciarCaptureWorker(),
  },
  {
    nome: 'lead-search',
    essencial: false,
    descricao: 'Processa jobs assincronos da API de busca de leads.',
    cadencia: 'LEAD_SEARCH_WORKER_INTERVAL_MS',
    risco: 'credito_pago',
    iniciar: ({ pool }) => require('../../services/lead-search-worker').iniciarLeadSearchWorker(pool),
  },
])

module.exports = { WORKERS_CAPTACAO }
