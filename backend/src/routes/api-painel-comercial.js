// @ts-check
'use strict'
// Painel comercial da Visão Geral (Fase 1). Um endpoint agregador; a tela lê tudo daqui.
// Regras puras em services/painel-comercial.js; leitura em db/painel-comercial.js (reusa a view
// app.vw_ligacoes_analiticas). Gate no mount: RELATORIOS_VER (é analítica de gestão).
// Ver docs/propostas/2026-09-29-dashboard-inteligente-visao-geral.md.
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const PC = require('../db/painel-comercial')
const S = require('../services/painel-comercial')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

// GET /api/empresas/:empresaId/painel-comercial?periodo=7d|30d | de=&ate= & nicho_id= & cidade= & canal= & pessoa=
router.get('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const q = req.query || {}
    const periodo = S.resolverPeriodo({ periodo: q.periodo, de: q.de, ate: q.ate })
    const filtros = {
      empresaId: req.empresa.id,
      de: periodo.de,
      ate: periodo.ate,
      nichoId: q.nicho_id || null,
      cidade: q.cidade || null,
      canal: q.canal || null,
      pais: q.pais || null,
      estado: q.estado || null,
      direcao: (q.direcao === 'inbound' || q.direcao === 'outbound') ? q.direcao : null,
      pessoa: q.pessoa || null,
    }
    const [dados, funil] = await Promise.all([PC.coletar(pool, filtros), PC.porEstagio(pool, filtros)])
    const serie = S.montarSerie(dados)
    const totais = S.totalizar(serie)
    const razoes = S.calcularRazoes(totais)
    const porCanal = S.montarPorCanal({
      mensagens: dados.mensagens,
      ligacoes: dados.ligacoes,
      reunioes: dados.reunioesHumano, // bot não tem canal — fica fora do recorte por canal
      conversou: dados.conversou,
    })
    return res.json({
      ok: true,
      data: {
        serie, totais, razoes, por_canal: porCanal, funil,
        followup_tentativa: dados.followupTentativa, respostas_hora: dados.respostasHora,
        bot_atribuivel: dados.bot_atribuivel,
      },
      meta: {
        periodo: { de: periodo.de, ate: periodo.ate, rotulo: periodo.rotulo },
        filtros: { nicho_id: filtros.nichoId, cidade: filtros.cidade, canal: filtros.canal, pais: filtros.pais, estado: filtros.estado, direcao: filtros.direcao, pessoa: filtros.pessoa },
        // Fase 1: "contato" = mensagem enviada + ligação atendida; "conversou" (lead respondeu) é Fase 2.
        base_contato: 'enviado',
      },
    })
  } catch (err) {
    logger.error({ err: err?.message }, '[api-painel-comercial] falha')
    return res.status(500).json({ ok: false, error: { code: 'PAINEL_COMERCIAL_FAILED', message: 'Não foi possível carregar o painel.' } })
  }
})

// GET /locais — cidades distintas p/ o seletor de cidade (read-only, sem chamada paga).
router.get('/locais', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const [cidades, estados] = await Promise.all([
      PC.cidadesDaEmpresa(pool, req.empresa.id),
      PC.estadosDaEmpresa(pool, req.empresa.id),
    ])
    return res.json({ ok: true, data: { cidades, estados } })
  } catch (err) {
    logger.error({ err: err?.message }, '[api-painel-comercial] locais falhou')
    return res.status(500).json({ ok: false, error: { code: 'PAINEL_LOCAIS_FAILED', message: 'Não foi possível carregar as cidades.' } })
  }
})

module.exports = router
