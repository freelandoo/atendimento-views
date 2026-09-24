'use strict'

const WORKERS_FREELANDOO = Object.freeze([
  {
    nome: 'freelandoo-playbook-refresh',
    essencial: false,
    descricao: 'Regera o playbook das instancias Freelandoo provisionadas.',
    cadencia: '10min apos boot; depois 24h',
    risco: 'ia_custo',
    iniciar: () => require('../../routes/freelandoo-provision').iniciarRefreshDiarioDePlaybooks(),
  },
])

module.exports = { WORKERS_FREELANDOO }
