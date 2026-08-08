'use strict'

// Instâncias BLOQUEADAS — webhooks que chegaram de instância sem vínculo autorizado.
//
// Esta rota é SOMENTE LEITURA, e isso é a regra de negócio, não uma limitação por fazer.
// A única origem válida de um vínculo empresa↔instância é o fluxo de criação DENTRO do
// Atendimento Views. Uma instância criada direto no Evolution não pertence a empresa
// alguma dentro do produto, e um vínculo criado DEPOIS não prova nada sobre como ela
// nasceu — por isso não existe aqui rota de adoção, de vínculo manual, de reprocessamento
// nem de "resolver".
//
// O que existia antes (`POST /:id/reprocessar`) fazia exatamente isso: reconsultava a
// instância e fechava a pendência assim que alguém a cadastrasse à mão. Era a
// regularização por tela administrativa, e foi REMOVIDA. Reintroduzi-la é reintroduzir a
// adoção com outro nome.
//
// Rota GLOBAL (não vive sob `/api/empresas/:empresaId`) de propósito: a pendência é
// exatamente o caso em que NÃO se sabe a empresa. Pendurá-la num tenant exigiria escolher
// um.
//
// O que ela expõe é configuração do operador (nome da instância, motivo, contagem, datas),
// nunca dado de pessoa — a tabela não armazena telefone, texto, ctwa_clid nem payload.
//
// Protegida por `requireAuth` + `requireRole('admin')` no ponto de montagem (index.js),
// mesmo padrão de `/api/llm`, que também é global.

const express = require('express')
const { logger } = require('../logger')
const { listarPendencias, resumoPendencias } = require('../db/webhook-quarentena')

const router = express.Router()

const ESTADOS = new Set(['abertas', 'resolvidas', 'todas'])

function falha(res, status, code, message) {
  return res.status(status).json({ ok: false, error: { code, message } })
}

// GET / — lista + resumo por motivo. É a única operação desta rota.
//
// `estado` continua aceito porque a tabela guarda linhas fechadas pelo fluxo antigo, que
// permanecem consultáveis como histórico. Nada as escreve mais: uma pendência aberta hoje
// é permanente, por decisão.
router.get('/', async (req, res) => {
  try {
    const estado = ESTADOS.has(String(req.query.estado || '')) ? String(req.query.estado) : 'abertas'
    const limite = Number(req.query.limite) || 50
    const [pendencias, resumo] = await Promise.all([
      listarPendencias(null, { estado, limite }),
      resumoPendencias(null),
    ])
    return res.json({ ok: true, data: { estado, pendencias, resumo } })
  } catch (err) {
    logger.error({ err: err.message }, 'Falha ao listar instâncias bloqueadas')
    return falha(res, 500, 'ERRO_INTERNO', 'Não foi possível carregar as instâncias bloqueadas.')
  }
})

module.exports = router
