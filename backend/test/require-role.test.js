'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { requireRole } = require('../src/middleware/tenant')

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
  }
}

test('requireRole — 401 se não houver req.usuario', () => {
  const res = mockRes()
  let next = false
  requireRole('admin')({}, res, () => { next = true })
  assert.equal(res.statusCode, 401)
  assert.equal(next, false)
})

test('requireRole — 403 para papel insuficiente', () => {
  const res = mockRes()
  let next = false
  requireRole('admin')({ usuario: { role: 'user' } }, res, () => { next = true })
  assert.equal(res.statusCode, 403)
  assert.equal(next, false)
})

test('requireRole — passa para papel permitido', () => {
  const res = mockRes()
  let next = false
  requireRole('admin')({ usuario: { role: 'admin' } }, res, () => { next = true })
  assert.equal(next, true)
})

test('requireRole — superadmin passa em qualquer rota admin', () => {
  const res = mockRes()
  let next = false
  requireRole('admin')({ usuario: { role: 'superadmin' } }, res, () => { next = true })
  assert.equal(next, true)
})
