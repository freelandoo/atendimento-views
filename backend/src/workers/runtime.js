'use strict'

const { logger: loggerPadrao } = require('../logger')

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
function iniciarWorkers({ agent, pool, workers = [], logger = loggerPadrao } = {}) {
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

module.exports = { iniciarWorkers }
