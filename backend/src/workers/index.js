'use strict'

// ─── REGISTRO UNICO DOS WORKERS DE FUNDO ─────────────────────────────────────────────────
//
// Antes, os 6 workers eram iniciados em dois lugares diferentes do `index.js`: cinco dentro do
// `.then()` do `initDB` e o do Freelandoo solto no meio da MONTAGEM DE ROTAS, ~80 linhas acima.
// Ninguem conseguia responder "o que roda em segundo plano neste processo?" sem ler o arquivo
// inteiro — e a resposta e' importante: sao eles que gastam credito pago, disparam WhatsApp e
// mexem em lead sem ninguem pedir.
//
// Este modulo NAO contem logica de worker. Cada `iniciar` continua morando no seu dominio; o
// que vive aqui e' a LISTA e a politica de falha na largada.
//
// ⚠️ A politica de falha e' deliberada e reproduz o que o boot ja fazia:
//   - `essencial: true`  → falhar ao iniciar DERRUBA o boot (o `.catch` do index faz exit 1).
//     Sao o motor de turnos e o watcher de silencio: sem eles o produto nao atende, e subir
//     um processo que aceita webhook mas nunca responde e' pior que nao subir.
//   - `essencial: false` → falha e' registrada e o boot segue. Sao automacoes periodicas:
//     perder uma delas degrada a operacao, nao o atendimento.
//
// O `require` de cada worker e' LAZY (dentro do `iniciar`) de proposito: e' o que mantem este
// registro carregavel por um teste sem arrastar rotas, pool de banco e clientes HTTP junto.

const { logger: loggerPadrao } = require('../logger')

const WORKERS = Object.freeze([
  {
    nome: 'job-worker',
    essencial: true,
    descricao: 'Fila de turnos do agente (resposta ao lead).',
    iniciar: ({ agent }) => agent.iniciarJobWorker(),
  },
  {
    nome: 'silence-watcher',
    essencial: true,
    descricao: 'Detecta conversa em silencio e aciona o follow-up.',
    iniciar: ({ agent }) => agent.iniciarSilenceWatcher(),
  },
  {
    nome: 'captacao-social',
    essencial: false,
    descricao: 'Coleta social (Bright Data) e agendamento de campanhas.',
    iniciar: () => require('../services/social-capture').iniciarCaptureWorker(),
  },
  {
    nome: 'lead-lock',
    essencial: false,
    descricao: 'Trava de 15 dias para lead morto ou rejeitado.',
    iniciar: ({ pool }) => require('../services/lead-lock').iniciarLeadLockWorker(pool),
  },
  {
    nome: 'banco-leads-auto',
    essencial: false,
    descricao: 'Disparo automatico da saudacao no Banco de Leads.',
    iniciar: ({ pool }) => require('../services/banco-leads-auto').iniciarBancoLeadsAutoWorker(pool),
  },
  {
    nome: 'lead-search',
    essencial: false,
    descricao: 'Processa jobs assincronos da API de busca de leads.',
    iniciar: ({ pool }) => require('../services/lead-search-worker').iniciarLeadSearchWorker(pool),
  },
  {
    nome: 'whatsapp-verificacao',
    essencial: false,
    descricao: 'Verifica periodicamente se leads com telefone possuem conta WhatsApp, sem enviar mensagem.',
    iniciar: ({ pool }) => require('../services/whatsapp-verificacao-worker').iniciarWhatsappVerificacaoWorker(pool),
  },
  {
    nome: 'freelandoo-playbook-refresh',
    essencial: false,
    // Primeiro tick 10 min apos a largada, depois a cada 24h — por isso sair da secao de rotas
    // e vir para depois do `initDB` nao muda nada na pratica; muda onde a pessoa procura.
    descricao: 'Regera o playbook das instancias Freelandoo provisionadas.',
    iniciar: () => require('../routes/freelandoo-provision').iniciarRefreshDiarioDePlaybooks(),
  },
])

/**
 * Inicia os workers de fundo. Chamado UMA vez, depois do `initDB`.
 *
 * @param {object} p
 * @param {object} p.agent  modulo `src/agent.js` (quem e' dono do job worker e do watcher)
 * @param {object} p.pool   pool do Postgres
 * @param {Array}  [p.workers] lista alternativa (usada nos testes)
 * @param {object} [p.logger]
 * @returns {{iniciados: string[], falharam: Array<{nome: string, erro: string}>}}
 */
function iniciarWorkers({ agent, pool, workers = WORKERS, logger = loggerPadrao } = {}) {
  const iniciados = []
  const falharam = []

  for (const worker of workers) {
    try {
      worker.iniciar({ agent, pool })
      iniciados.push(worker.nome)
    } catch (err) {
      // Worker essencial nao tem rede de seguranca aqui de proposito: o erro sobe, o `.catch`
      // do boot registra e o processo sai. Engolir aqui deixaria o servico no ar sem atender.
      if (worker.essencial) throw err
      falharam.push({ nome: worker.nome, erro: err.message })
      logger.warn({ worker: worker.nome, err: err.message }, 'Worker nao iniciou — a operacao segue sem ele')
    }
  }

  logger.info({ iniciados, falharam: falharam.map((f) => f.nome) }, `Workers de fundo: ${iniciados.length}/${workers.length} ativos`)
  return { iniciados, falharam }
}

module.exports = { WORKERS, iniciarWorkers }
