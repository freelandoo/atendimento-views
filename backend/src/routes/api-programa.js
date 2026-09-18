'use strict'
// Operacao Comercial — Etapa 1. A porta de entrada do programa.
//
// AUTORIZACAO: `requireAuth` + `requireEmpresaAccessSemAceite`. **Nenhuma capacidade**, e isso e'
// deliberado: ler o proprio termo e declarar o proprio aceite sao atos da PESSOA sobre ela mesma,
// nao acoes sobre a operacao da empresa. Exigir capacidade aqui criaria o absurdo de um comercial
// sem permissao para entrar no programa que ele foi contratado para cumprir.
//
// ⚠️ ESTE E' O UNICO ROUTER QUE PODE USAR `requireEmpresaAccessSemAceite`. Ele existe porque a
// tela de aceite precisa ser alcancavel enquanto todo o resto esta barrado — um bloqueio sem
// maçaneta seria um lockout, nao um gate. Guarda de regressao em test/programa-aceite.test.js
// falha se um segundo mount usar essa variante.
//
// O que ele NAO faz, de proposito:
//   * nao cria usuario nem vinculo (isso e' `/membros`, Etapa 2 do CRM em equipe);
//   * nao concede capacidade nenhuma — aceitar o termo abre a PORTA DO PROGRAMA, nao amplia o
//     que o papel alcanca. As duas portas sao independentes (ver services/programa-aceite.js);
//   * nao tem rota de REVOGACAO. O registro e' append-only; tirar alguem do programa e' desativar
//     o vinculo em "Contas da empresa", que ja existe. Mesma disciplina de "arquivar em vez de
//     excluir" de Roteiros e Membros.

const { Router } = require('express')
const { requireAuth, requireEmpresaAccessSemAceite } = require('../middleware/tenant')
const { PROGRAMA, RECUSAS, validarAceite } = require('../services/programa-aceite')
const { termoVigente, VERSAO, HASH } = require('../services/programa-termo')
const { obterAceiteVigente, registrarAceite } = require('../db/programa-aceite')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

router.use(requireAuth, requireEmpresaAccessSemAceite)

// Mensagem por RECUSA: vocabulario fechado virando texto de gente. A tela precisa dizer o que
// faltou — "dados invalidos" mandaria a pessoa adivinhar qual das duas caixas ela esqueceu.
const MENSAGEM_RECUSA = {
  [RECUSAS.PROGRAMA_DESCONHECIDO]: 'Programa desconhecido.',
  [RECUSAS.VERSAO_DIVERGENTE]: 'O termo foi atualizado enquanto esta página estava aberta. Recarregue e leia a versão nova antes de aceitar.',
  [RECUSAS.MAIORIDADE_NAO_CONFIRMADA]: 'É preciso confirmar que você tem 18 anos ou mais.',
  [RECUSAS.REGRAS_NAO_CONFIRMADAS]: 'É preciso confirmar que leu e aceita as regras do programa.',
}

/**
 * GET /termo — o texto vigente + a situação de quem está pedindo.
 *
 * READ-ONLY: não grava, não registra aceite e não chama IA. `situacao` vem do veredito que o
 * middleware já calculou (`req.aceitePrograma`), então abrir a tela não custa consulta extra.
 */
router.get('/termo', async (req, res) => {
  try {
    const termo = termoVigente()
    const aceite = await obterAceiteVigente(req.empresa.id, req.usuario.id, PROGRAMA.OPERACAO_COMERCIAL)
    return res.json({
      ok: true,
      data: {
        programa: PROGRAMA.OPERACAO_COMERCIAL,
        termo: { versao: termo.versao, titulo: termo.titulo, secoes: termo.secoes, hash: termo.hash },
        // O veredito inteiro, incluindo o motivo: é o que permite a tela distinguir
        // "primeiro acesso" de "o termo mudou" sem reimplementar a regra.
        situacao: req.aceitePrograma,
        aceite: aceite ? { versao: aceite.versao, em: aceite.em } : null,
      },
    })
  } catch (err) {
    logger.error({ err: err.message }, '[api-programa] falha ao carregar o termo')
    return res.status(500).json({ ok: false, error: { code: 'TERMO_LOAD_FAILED', message: 'Não foi possível carregar o termo.' } })
  }
})

/**
 * POST /aceite — registra o aceite desta pessoa nesta empresa.
 *
 * O HASH não vem do corpo: é o do texto que ESTE servidor tem no fonte. Aceitar um hash enviado
 * pelo cliente deixaria o registro afirmar que a pessoa concordou com um texto que o sistema
 * nunca viu — a prova viraria ficção. A VERSÃO vem do corpo só para ser CONFERIDA (detecta o
 * termo ter mudado com a página aberta), nunca para ser gravada como veio.
 */
router.post('/aceite', async (req, res) => {
  const v = validarAceite(req.body || {}, {
    programa: PROGRAMA.OPERACAO_COMERCIAL,
    versaoVigente: VERSAO,
  })
  if (!v.ok) {
    return res.status(400).json({
      ok: false,
      error: { code: v.recusa.toUpperCase(), message: MENSAGEM_RECUSA[v.recusa] || 'Dados inválidos.' },
      data: { recusa: v.recusa, versao_vigente: VERSAO },
    })
  }

  try {
    const { criado, aceite } = await registrarAceite(
      { empresaId: req.empresa.id, usuarioId: req.usuario.id },
      { ...v.dados, termo_hash: HASH }
    )
    // 200 nos dois casos: reenviar o formulário não é erro, e o estado final é o mesmo. O campo
    // `criado` diz qual foi — a tela não precisa dele para seguir, mas o operador precisa dele
    // no log para entender um registro que não apareceu duas vezes.
    return res.json({
      ok: true,
      data: {
        criado,
        programa: PROGRAMA.OPERACAO_COMERCIAL,
        aceite: aceite ? { versao: aceite.versao, em: aceite.em } : null,
      },
    })
  } catch (err) {
    logger.error({ err: err.message }, '[api-programa] falha ao registrar o aceite')
    return res.status(500).json({ ok: false, error: { code: 'ACEITE_FAILED', message: 'Não foi possível registrar o aceite.' } })
  }
})

module.exports = router
