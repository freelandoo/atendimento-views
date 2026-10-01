'use strict'
// Router de PLANO / assinatura (conversão do trial em pago). Montado com `requireEmpresaAccessSemPlano`
// (index.js): o owner com plano INATIVO precisa alcançar isto pra poder pagar.
//   GET  /            → estado do plano + preços (read-only; qualquer membro)
//   POST /assinar     → cria cliente+assinatura na ASAAS, grava os ids, devolve URL de checkout
//                       (admin/owner, via capacidade MEMBROS_GERENCIAR)
const express = require('express')
const router = express.Router({ mergeParams: true })
const { logger } = require('../logger')
const { requireAuth, requireEmpresaAccessSemPlano, requireCapacidade } = require('../middleware/tenant')

// Gate do router (padrão do projeto, como api-programa.js): auth + vínculo, mas SEM barrar por
// plano inativo — o owner precisa poder pagar mesmo bloqueado. A capacidade de ASSINAR é por rota.
router.use(requireAuth, requireEmpresaAccessSemPlano)
const { CAPACIDADES } = require('../services/acesso-capacidades')
const { PRECOS, PLANOS_ASSINAVEIS, planoAssinavel, precoDoPlano } = require('../services/plano-definicao')
const { obterPlano, vincularAsaas } = require('../db/empresa-plano')
const asaas = require('../services/asaas-client')

function diasRestantesTrial(plano) {
  if (!plano || plano.status !== 'trial' || !plano.trial_fim) return null
  const ms = new Date(plano.trial_fim).getTime() - Date.now()
  return ms <= 0 ? 0 : Math.ceil(ms / 86400000)
}

// Estado do plano, pra tela "escolha um plano". Read-only.
router.get('/', async (req, res) => {
  try {
    const plano = await obterPlano(req.empresa.id)
    return res.json({
      ok: true,
      data: {
        plano: plano ? plano.plano : null,
        status: plano ? plano.status : null,
        trial_fim: plano ? plano.trial_fim : null,
        dias_restantes: diasRestantesTrial(plano),
        acesso: req.planoAcesso, // veredito já resolvido pelo middleware
        precos: PRECOS,
        assinaveis: PLANOS_ASSINAVEIS,
      },
    })
  } catch (err) {
    logger.error({ err: err.message }, '[plano] falha ao ler estado')
    return res.status(500).json({ ok: false, error: { code: 'ERRO', message: 'Falha ao ler o plano.' } })
  }
})

// Converte: cria cliente + assinatura na ASAAS e grava os ids. O status só vira 'ativo' quando o
// webhook confirmar o pagamento. CPF vai pra ASAAS e NÃO é persistido nem logado (PII).
router.post('/assinar', requireCapacidade(CAPACIDADES.MEMBROS_GERENCIAR), async (req, res) => {
  const { plano, cpf_cnpj, nome, email, telefone } = req.body || {}

  if (!planoAssinavel(plano)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'PLANO_INVALIDO', message: 'Plano indisponível para assinatura.' },
      data: { assinaveis: PLANOS_ASSINAVEIS },
    })
  }
  const cpfDigitos = String(cpf_cnpj || '').replace(/\D/g, '')
  if (cpfDigitos.length !== 11 && cpfDigitos.length !== 14) {
    return res.status(400).json({ ok: false, error: { code: 'CPF_INVALIDO', message: 'Informe um CPF ou CNPJ válido.' } })
  }

  try {
    const customer = await asaas.criarCustomer({
      nome: nome || req.empresa.nome,
      cpfCnpj: cpfDigitos,
      email,
      telefone,
    })
    const assinatura = await asaas.criarAssinatura({
      customerId: customer.id,
      valor: precoDoPlano(plano),
      descricao: `Assinatura ${plano} — ${req.empresa.nome}`,
    })
    await vincularAsaas(req.empresa.id, { customerId: customer.id, subscriptionId: assinatura.id, plano })
    const checkoutUrl = await asaas.urlCheckoutDaAssinatura(assinatura.id)

    // Sem PII no log.
    logger.info({ empresa_id: req.empresa.id, plano, tem_checkout: Boolean(checkoutUrl) }, '[plano] assinatura criada')
    return res.json({ ok: true, data: { plano, subscription_id: assinatura.id, checkout_url: checkoutUrl } })
  } catch (err) {
    if (err instanceof asaas.AsaasError) {
      // 502: o erro veio do provedor externo (CPF recusado, etc.) — não é defeito nosso.
      logger.warn({ empresa_id: req.empresa.id, code: err.code, status: err.status }, '[plano] ASAAS recusou')
      return res.status(502).json({ ok: false, error: { code: 'ASAAS_ERRO', message: err.message } })
    }
    logger.error({ err: err.message }, '[plano] falha ao assinar')
    return res.status(500).json({ ok: false, error: { code: 'ERRO', message: 'Falha ao processar a assinatura.' } })
  }
})

module.exports = router
