'use strict'

const WORKERS_BANCO_LEADS = Object.freeze([
  {
    nome: 'lead-lock',
    essencial: false,
    descricao: 'Trava de 15 dias para lead morto ou rejeitado.',
    cadencia: 'LEAD_LOCK_WORKER_MS',
    risco: 'muta_lead',
    iniciar: ({ pool }) => require('../../services/lead-lock').iniciarLeadLockWorker(pool),
  },
  {
    nome: 'banco-leads-auto',
    essencial: false,
    descricao: 'Disparo automatico da saudacao no Banco de Leads.',
    cadencia: 'BANCO_LEADS_AUTO_WORKER_MS',
    risco: 'envia_whatsapp',
    iniciar: ({ pool }) => require('../../services/banco-leads-auto').iniciarBancoLeadsAutoWorker(pool),
  },
  {
    nome: 'whatsapp-verificacao',
    essencial: false,
    descricao: 'Verifica periodicamente se leads com telefone possuem conta WhatsApp, sem enviar mensagem.',
    cadencia: 'WHATSAPP_VERIFICACAO_WORKER_MS',
    risco: 'consulta_whatsapp',
    iniciar: ({ pool }) => require('../../services/whatsapp-verificacao-worker').iniciarWhatsappVerificacaoWorker(pool),
  },
])

module.exports = { WORKERS_BANCO_LEADS }
