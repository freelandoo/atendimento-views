'use strict'
// Operacao Comercial — Etapa 3. LEAD PARADO: o lead que esta na mao de alguem e ninguem toca.
// Modulo PURO e dono UNICO do vocabulario. Sem banco, sem HTTP, sem IA, sem rede.
// Mesmo padrao de services/lead-fila-trabalho.js — ele nao LE nada: devolve as EXPRESSOES SQL e
// o julgamento, para a classificacao acontecer UMA vez, dentro da consulta.
//
// ─── A PERGUNTA QUE ESTE MODULO RESPONDE ────────────────────────────────────────────────
// **"Este lead esta parado na mao de alguem?"** — que NAO e' "este lead esta frio" nem "o cliente
// sumiu". Sao tres perguntas diferentes e o repositorio ja responde as outras duas:
//   * `services/lead-lock.js` trata do lead RODADO que nao respondeu ha `LEAD_MORTA_DIAS` — e' o
//     cliente que sumiu, e o efeito la' e' bloquear o DISPARO automatico;
//   * `services/lead-fila-trabalho.js` tem a faixa `abordado_sem_resposta`, que ordena a fila.
// Aqui a falta e' do VENDEDOR, nao do cliente. Decisao do operador (2026-09-18).
//
// ─── A REGRA QUE NAO SE NEGOCIA: O SISTEMA MARCA, NAO DEVOLVE ───────────────────────────
// Lead parado **continua com o responsavel**. Devolver para a fila e' o botao que ja existe
// (`db/lead-responsavel.js`), acionado por uma PESSOA. Escolha do operador, e ela tem custo
// declarado: um lead parado so' volta a circular quando alguem olhar. O contrario — o sistema
// desfazer sozinho uma atribuicao — tiraria trabalho da mao de alguem sem ninguem mandar, e e' o
// tipo de automatismo que este repositorio ja removeu em outros lugares (fallback da PJ,
// instancia por `atualizado_em`). **PROIBIDO** acrescentar aqui qualquer escrita, worker ou
// devolucao automatica: ha guarda de regressao.
//
// ─── LEAD SEM RESPONSAVEL NUNCA ESTA PARADO ─────────────────────────────────────────────
// Ele esta na FILA, que e' estado legitimo (migration 072: `responsavel_id = NULL` e' a fila de
// livres, nao um erro). Chamar de "parado" o lead que ninguem assumiu confundiria dois problemas
// com donos diferentes: um e' de quem assumiu, o outro e' de quem distribui.

// ─── Vocabulario ────────────────────────────────────────────────────────────────────────

// O que conta como AÇÃO. Lista FECHADA, e as tres fontes tem `prospect_id`, que e' o que torna a
// medida barata. **Nao inclui "abrir a tela"**: ver um lead nao e' trabalhar o lead, e contar
// visualizacao transformaria a marca num medidor de presenca.
const FONTES = Object.freeze({
  DISPARO: 'disparo',      // prospectador.lead_disparos — cobre o envio automatico E o wa.me manual
  LIGACAO: 'ligacao',      // app.ligacoes
  FOLLOW_UP: 'follow_up',  // app.follow_ups
})

// ⚠️ LIMITE DECLARADO: `app.follow_ups.prospect_id` e' NULLABLE (migration 062 — a identidade la'
// e' `empresa_id + telefone_digitos`; o prospect e' conveniencia). Follow-up sem `prospect_id`
// NAO e' visto por esta medida. Consequencia: alguem que so' trabalhe por follow-up de contato
// avulso pode aparecer como parado. E' por isso que o rotulo diz "sem acao REGISTRADA" e nunca
// "nao trabalhou" — a marca afirma o que o sistema viu, nao o que a pessoa fez.
const PRAZO_PADRAO_DIAS = 7
const PRAZO_MIN_DIAS = 1
const PRAZO_MAX_DIAS = 90

// `nunca_tocado` e `sem_acao_recente` sao SEPARADOS de proposito: o primeiro e' um lead que foi
// assumido e nunca recebeu nada (o pior caso, e o mais facil de resolver); o segundo e' um
// trabalho que comecou e parou. A conversa com o vendedor e' diferente em cada um.
const MOTIVO = Object.freeze({
  SEM_RESPONSAVEL: 'sem_responsavel',   // nao se aplica — esta na fila
  NUNCA_TOCADO: 'nunca_tocado',
  SEM_ACAO_RECENTE: 'sem_acao_recente',
  ATIVO: 'ativo',
})

/** Prazo saneado. Fora da faixa cai no padrao — nunca lanca e nunca aceita 0 (0 marcaria tudo). */
function normalizarPrazo(valor) {
  const n = Math.trunc(Number(valor))
  if (!Number.isFinite(n) || n < PRAZO_MIN_DIAS || n > PRAZO_MAX_DIAS) return PRAZO_PADRAO_DIAS
  return n
}

// ─── As expressoes SQL ──────────────────────────────────────────────────────────────────

/**
 * A ULTIMA ACAO registrada no lead, como subconsulta escalar.
 *
 * Vive aqui, e nao no arquivo de SQL, pelo mesmo motivo de `lead-fila-trabalho.js`: se a regra
 * fosse escrita uma vez na contagem e outra na listagem, as duas divergiriam e a tela passaria a
 * explicar uma marca diferente da que mostrou.
 *
 * @param {string} alias  alias da tabela `prospectador.prospects` na consulta do chamador.
 */
function sqlUltimaAcao(alias = 'p') {
  return `(
    SELECT MAX(x.quando) FROM (
      SELECT MAX(ld.criado_em) AS quando
        FROM prospectador.lead_disparos ld
       WHERE ld.prospect_id = ${alias}.id
      UNION ALL
      SELECT MAX(lg.criado_em)
        FROM app.ligacoes lg
       WHERE lg.prospect_id = ${alias}.id
      UNION ALL
      SELECT MAX(fu.atualizado_em)
        FROM app.follow_ups fu
       WHERE fu.prospect_id = ${alias}.id
    ) x
  )`
}

/**
 * A condicao de "parado", pronta para o WHERE/FILTER.
 *
 * `COALESCE(ultima_acao, responsavel_desde)`: quem nunca recebeu acao nenhuma conta o tempo desde
 * que foi ASSUMIDO — senao um lead atribuido hoje e nunca tocado apareceria parado por causa de
 * uma acao que nunca existiu (ou nao apareceria nunca, com `ultima_acao` nula).
 *
 * O `responsavel_id IS NOT NULL` e' a primeira condicao de proposito: lead livre nao esta parado.
 */
function sqlEstaParado(alias = 'p', paramPrazo = '$2') {
  return `(
    ${alias}.responsavel_id IS NOT NULL
    AND COALESCE(${sqlUltimaAcao(alias)}, ${alias}.responsavel_desde)
        < NOW() - make_interval(days => ${paramPrazo}::int)
  )`
}

// ─── O julgamento (para a apresentacao e para o teste) ──────────────────────────────────

const DIA_MS = 24 * 60 * 60 * 1000

/**
 * Classifica UM lead. A consulta ja sabe contar; isto existe para a linha da tela poder dizer
 * POR QUE aquele lead esta marcado, e para o teste poder afirmar a regra sem banco.
 *
 * @returns {{parado: boolean, motivo: string, dias_sem_acao: number|null}}
 */
function classificar({ responsavelId, ultimaAcao, responsavelDesde, prazoDias, agora } = {}) {
  if (!responsavelId) {
    return { parado: false, motivo: MOTIVO.SEM_RESPONSAVEL, dias_sem_acao: null }
  }
  const prazo = normalizarPrazo(prazoDias)
  const fim = agora instanceof Date ? agora : new Date()

  const acao = ultimaAcao ? new Date(ultimaAcao) : null
  const desde = responsavelDesde ? new Date(responsavelDesde) : null
  const referencia = (acao && !Number.isNaN(acao.getTime())) ? acao
    : (desde && !Number.isNaN(desde.getTime())) ? desde
      : null

  // Sem referencia nenhuma nao se afirma nada: `responsavel_desde` e' NOT NULL quando ha
  // responsavel (CHECK da 072), entao chegar aqui significa dado fora do contrato — e inventar
  // "parado" a partir de dado quebrado marcaria o vendedor por um defeito do sistema.
  if (!referencia) return { parado: false, motivo: MOTIVO.ATIVO, dias_sem_acao: null }

  const dias = Math.floor((fim.getTime() - referencia.getTime()) / DIA_MS)
  if (dias < prazo) return { parado: false, motivo: MOTIVO.ATIVO, dias_sem_acao: dias }

  return {
    parado: true,
    motivo: acao ? MOTIVO.SEM_ACAO_RECENTE : MOTIVO.NUNCA_TOCADO,
    dias_sem_acao: dias,
  }
}

module.exports = {
  FONTES,
  MOTIVO,
  PRAZO_PADRAO_DIAS,
  PRAZO_MIN_DIAS,
  PRAZO_MAX_DIAS,
  normalizarPrazo,
  sqlUltimaAcao,
  sqlEstaParado,
  classificar,
}
