'use strict'

const WORKERS_ATENDIMENTO = Object.freeze([
  {
    nome: 'job-worker',
    essencial: true,
    descricao: 'Fila de turnos do agente (resposta ao lead).',
    cadencia: 'JOB_WORKER_POLL_MS',
    risco: 'atendimento',
    iniciar: ({ agent }) => agent.iniciarJobWorker(),
  },
  {
    nome: 'silence-watcher',
    essencial: true,
    descricao: 'Detecta conversa em silencio e aciona o follow-up.',
    cadencia: 'SILENCE_WATCHER_INTERVAL_MS',
    risco: 'atendimento',
    iniciar: ({ agent }) => agent.iniciarSilenceWatcher(),
  },
])

module.exports = { WORKERS_ATENDIMENTO }
