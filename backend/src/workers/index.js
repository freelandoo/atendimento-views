'use strict'

const { WORKERS } = require('./registry')
const { iniciarWorkers: iniciarWorkersRuntime } = require('./runtime')

function iniciarWorkers(params = {}) {
  return iniciarWorkersRuntime({ workers: WORKERS, ...params })
}

module.exports = { WORKERS, iniciarWorkers }
