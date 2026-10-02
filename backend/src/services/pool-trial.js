// @ts-check
'use strict'

// Pool do TRIAL — regras PURAS. A "busca" do trial roda sobre a base JÁ coletada (leads sem dono
// + descartados), custo ZERO (sem Bright Data). Este módulo decide "o plano usa o pool?", o teto
// diário, e é o DONO do predicado de elegibilidade (expressão SQL única). Não lê banco.
//
// ⚠️ D21 (ISOLAMENTO): o pool CRUZA o tenant DE PROPÓSITO — é a única leitura do produto que
// ignora `empresa_id`. A expressão abaixo SÓ devolve leads SEM DONO (responsavel_id IS NULL),
// nunca um lead que um cliente pagante está trabalhando. PROIBIDO afrouxar as queries por empresa
// existentes para "ver o pool"; esta é a porta separada. Guarda de regressão lê o fonte.

const TETO_DIARIO = 10 // ponytail: constante; vira env POOL_TRIAL_TETO_DIARIO se precisar afinar.

// Só o TRIAL usa o pool. Plano pago usa captação de verdade (Bright Data); sem plano (grandfather)
// também não usa. `plano` vem do veredito publicado pelo middleware (req.plano).
function poolHabilitado(plano) {
  return Boolean(plano) && plano.status === 'trial'
}

function tetoDiario() { return TETO_DIARIO }
function podePuxar(usadasHoje) { return (Number(usadasHoje) || 0) < TETO_DIARIO }
function restantesHoje(usadasHoje) { return Math.max(0, TETO_DIARIO - (Number(usadasHoje) || 0)) }

// Expressão SQL ÚNICA de elegibilidade do pool. Lead elegível:
//   • SEM DONO (responsavel_id IS NULL) — a trava de isolamento (D21);
//   • COM telefone (o trial trabalha manual por wa.me);
//   • não bloqueado (bloqueado_ate no passado/ausente);
//   • e: não-trabalhado (status aguardando/aprovado) OU descartado (qualificacao descartado / status rejeitado).
// NÃO menciona empresa_id de propósito — é cross-tenant (D21).
function sqlElegivel(alias = 'p') {
  const a = alias
  return `${a}.responsavel_id IS NULL
    AND NULLIF(btrim(${a}.telefone), '') IS NOT NULL
    AND (${a}.bloqueado_ate IS NULL OR ${a}.bloqueado_ate <= NOW())
    AND (
      ${a}.status IN ('aguardando', 'aprovado')
      OR ${a}.qualificacao = 'descartado'
      OR ${a}.status = 'rejeitado'
    )`
}

module.exports = { TETO_DIARIO, poolHabilitado, tetoDiario, podePuxar, restantesHoje, sqlElegivel }
