'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const CNPJ = require('../src/services/cnpj-provider')

test('normaliza e valida CNPJ antes de consultar fonte externa', () => {
  assert.equal(CNPJ.normalizarCnpj('11.222.333/0001-81'), '11222333000181')
  assert.equal(CNPJ.normalizarCnpj(''), null)
  assert.throws(() => CNPJ.normalizarCnpj('11.111.111/1111-11'), /CNPJ invalido/)
  assert.throws(() => CNPJ.normalizarCnpj('123'), /14 digitos/)
})

test('normaliza resposta BrasilAPI para o contrato interno', () => {
  const r = CNPJ.normalizarBrasilApi({
    cnpj: '11222333000181',
    razao_social: 'EMPRESA TESTE LTDA',
    nome_fantasia: 'EMPRESA TESTE',
    descricao_situacao_cadastral: 'ATIVA',
    cnae_fiscal: 6201501,
    cnae_fiscal_descricao: 'Desenvolvimento de programas',
    municipio: 'SAO PAULO',
    uf: 'sp',
    logradouro: 'RUA A',
    numero: '10',
    qsa: [{ nome_socio: 'SOCIO' }],
  })

  assert.equal(r.cnpj_digits, '11222333000181')
  assert.equal(r.razao_social, 'EMPRESA TESTE LTDA')
  assert.equal(r.uf, 'SP')
  assert.equal(r.cnae_principal, '6201501')
  assert.equal(r.endereco.logradouro, 'RUA A')
  assert.equal(r.fonte, 'brasilapi')
})

test('rota fiscal global continua restrita a superadmin', () => {
  const rota = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'api-admin-fiscal.js'), 'utf8')
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')

  assert.match(rota, /requireRole\('superadmin'\)/)
  assert.match(index, /\/api\/admin\/fiscal/)
  assert.doesNotMatch(index, /\/api\/empresas\/:empresaId\/fiscal/)
})
