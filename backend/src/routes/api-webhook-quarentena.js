'use strict'

// Pendências de instância — webhooks que chegaram SEM DONO COMPROVADO.
//
// Rota GLOBAL (não vive sob `/api/empresas/:empresaId`) de propósito: uma pendência é
// exatamente o caso em que NÃO se sabe a empresa. Pendurá-la num tenant exigiria escolher
// um, que é o fallback que esta tarefa removeu.
//
// O que ela expõe é configuração do operador (nome da instância, motivo, contagem, datas),
// nunca dado de pessoa — a tabela não armazena telefone, texto, ctwa_clid nem payload.
//
// Protegida por `requireAuth` + `requireRole('admin')` no ponto de montagem (index.js),
// mesmo padrão de `/api/llm`, que também é global.

const express = require('express')
const { logger } = require('../logger')
const {
  listarPendencias,
  resumoPendencias,
  buscarPendencia,
  resolverPendencia,
} = require('../db/webhook-quarentena')
const { findEmpresaEInstanciaPorEvolution } = require('../db/empresas')
const { MOTIVO_QUARENTENA } = require('../services/webhook-quarentena')

const router = express.Router()

const ESTADOS = new Set(['abertas', 'resolvidas', 'todas'])

function falha(res, status, code, message) {
  return res.status(status).json({ ok: false, error: { code, message } })
}

// GET / — lista + resumo por motivo.
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
    logger.error({ err: err.message }, 'Falha ao listar pendências de instância')
    return falha(res, 500, 'ERRO_INTERNO', 'Não foi possível carregar as pendências.')
  }
})

/**
 * POST /:id/reprocessar — fecha a pendência SE a instância agora resolver.
 *
 * O corpo da requisição não carrega (e não pode carregar) empresa: a empresa vem da
 * reconsulta a `app.empresa_whatsapp_instances` pelo MESMO caminho que o webhook usa
 * (`findEmpresaEInstanciaPorEvolution`). Deixar o operador apontar a empresa à mão
 * reintroduziria o fallback com outro nome — só que agora com a aparência de decisão
 * humana informada.
 *
 * Não reencena a mensagem: a quarentena não guarda payload (ver migration 060). O que se
 * recupera é o VÍNCULO — a partir daqui os webhooks daquela instância passam direto.
 */
router.post('/:id/reprocessar', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return falha(res, 400, 'ID_INVALIDO', 'Identificador de pendência inválido.')
  }

  try {
    const pendencia = await buscarPendencia(null, id)
    if (!pendencia) return falha(res, 404, 'NAO_ENCONTRADA', 'Pendência não encontrada.')
    if (pendencia.resolvida_em) {
      return falha(res, 409, 'JA_RESOLVIDA', 'Esta pendência já foi resolvida.')
    }
    if (pendencia.motivo === MOTIVO_QUARENTENA.SEM_INSTANCIA) {
      // Sem nome de instância não há o que reconsultar. O caminho é corrigir o webhook na
      // Evolution para que ele volte a identificar a instância.
      return falha(
        res, 422, 'SEM_INSTANCIA',
        'Estes webhooks chegaram sem identificar a instância. Corrija o webhook na Evolution API; não há vínculo a reconsultar.'
      )
    }

    const vinculo = await findEmpresaEInstanciaPorEvolution(pendencia.evolution_instance)
    if (!vinculo) {
      return falha(
        res, 422, 'INSTANCIA_NAO_MAPEADA',
        'Esta instância ainda não está mapeada (ou está inativa). Cadastre-a na empresa correta e reprocesse.'
      )
    }

    const resolvida = await resolverPendencia(null, id, {
      empresaId: vinculo.empresa.id,
      instanciaId: vinculo.instanciaId,
    })
    if (!resolvida) return falha(res, 409, 'JA_RESOLVIDA', 'Esta pendência já foi resolvida.')

    logger.info({
      operation: 'webhook_quarentena',
      etapa: 'resolvida',
      pendencia_id: id,
      evolution_instance: pendencia.evolution_instance,
      empresa_id: vinculo.empresa.id,
      instancia_id: vinculo.instanciaId,
      usuario_id: req.usuario?.id || null,
    }, 'Pendência de instância resolvida com vínculo comprovado')

    return res.json({
      ok: true,
      data: {
        id,
        resolvida_em: resolvida.resolvida_em,
        empresa_id: vinculo.empresa.id,
        empresa: vinculo.empresa.nome || null,
        instancia_id: vinculo.instanciaId,
        // A tela precisa dizer isto sem rodeios, senão o operador espera as mensagens
        // antigas voltarem.
        mensagens_reencenadas: false,
      },
    })
  } catch (err) {
    logger.error({ err: err.message, pendencia_id: id }, 'Falha ao reprocessar pendência de instância')
    return falha(res, 500, 'ERRO_INTERNO', 'Não foi possível reprocessar a pendência.')
  }
})

module.exports = router
