'use strict'

// ─── REGISTRO UNICO DOS WORKERS DE FUNDO ─────────────────────────────────────────────────
//
// Este modulo e' o mapa do que roda em segundo plano neste processo. Ele NAO contem logica de
// worker: cada `iniciar` continua morando no dominio do produto. Aqui ficam so' catalogo,
// agrupamento e a ordem de largada.
//
// O `require` dos services continua LAZY dentro de cada `iniciar`. Isso permite importar o
// catalogo em testes e scripts sem arrastar rotas, pool de banco e clientes HTTP junto.
//
// Politica de falha, aplicada em `runtime.js`:
//   - `essencial: true`  -> falhar ao iniciar DERRUBA o boot.
//   - `essencial: false` -> falha e' registrada e o boot segue.

const { WORKERS_ATENDIMENTO } = require('./modules/atendimento')
const { WORKERS_CAPTACAO } = require('./modules/captacao')
const { WORKERS_BANCO_LEADS } = require('./modules/banco-leads')
const { WORKERS_FREELANDOO } = require('./modules/freelandoo')

const WORKER_MODULES = Object.freeze([
  {
    grupo: 'atendimento',
    descricao: 'Motor principal de resposta e silencio de conversas.',
    workers: WORKERS_ATENDIMENTO,
  },
  {
    grupo: 'captacao',
    descricao: 'Coletas, buscas externas e enriquecimentos assincronos.',
    workers: WORKERS_CAPTACAO,
  },
  {
    grupo: 'banco-leads',
    descricao: 'Automacoes operacionais sobre leads comerciais.',
    workers: WORKERS_BANCO_LEADS,
  },
  {
    grupo: 'freelandoo',
    descricao: 'Rotinas de manutencao das instancias provisionadas.',
    workers: WORKERS_FREELANDOO,
  },
])

const WORKERS = Object.freeze(
  WORKER_MODULES.flatMap((modulo) =>
    modulo.workers.map((worker) => Object.freeze({
      grupo: modulo.grupo,
      ...worker,
    }))
  )
)

module.exports = { WORKERS, WORKER_MODULES }
