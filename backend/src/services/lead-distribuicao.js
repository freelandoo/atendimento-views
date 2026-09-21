'use strict'
// Distribuicao de leads por EQUIPE — modulo PURO e dono UNICO do vocabulario.
// Sem banco, sem HTTP, sem IA, sem rede. So' importa outros modulos PUROS.
// Mesmo padrao de services/lead-fila-trabalho.js e services/lead-parado.js: ele nao LE nada —
// devolve as EXPRESSOES SQL e o PLANO, para a classificacao acontecer UMA vez, dentro da consulta.
//
// ─── A PERGUNTA QUE ESTE MODULO RESPONDE ────────────────────────────────────────────────
// Nao "de quem e' este lead?" (isso e' uma coluna) e nao "quem pode trocar o dono?" (isso e'
// `services/lead-responsavel.js`), e sim **"este lead pode ser MOVIDO sem atrapalhar trabalho
// que ja' comecou?"**. A primeira pergunta admite resposta por heuristica; esta exige prova de
// que ninguem encostou no lead.
//
// ─── A REGRA QUE NAO SE NEGOCIA ─────────────────────────────────────────────────────────
// **Na duvida, PROTEGIDO.** O custo de nao mover um lead intocado e' uma carteira um pouco
// desequilibrada — visivel na tela e corrigivel com um clique. O custo de mover um lead que ja'
// tem reuniao marcada, conversa aberta ou ligacao registrada e' um cliente falando com uma
// pessoa e um compromisso na agenda de outra. Os dois erros NAO custam a mesma coisa, entao o
// predicado e' deliberadamente conservador: ele exige AUSENCIA de sinal, nunca presenca de
// permissao.
//
// ─── O QUE ESTE MODULO NAO FAZ, DE PROPOSITO ────────────────────────────────────────────
//  1. **Nao devolve lead para a fila.** Distribuir e' dar dono a quem nao tinha, ou trocar o
//     dono de um lead que ninguem tocou. Devolver e' o botao que ja' existe
//     (`db/lead-responsavel.js`), acionado por uma pessoa.
//  2. **Nao roda sozinho.** Nao ha worker: os gatilhos sao a ENTRADA de alguem na equipe e o
//     comando manual do gestor. Um job que redistribui carteira sozinho e' a automacao que
//     `services/lead-parado.js` recusou no cabecalho dele, e pelo mesmo motivo.
//  3. **Nao decide permissao.** O veredito de `LEAD_TRANSFERIR` chega pronto da rota.

const LP = require('./lead-parado')
const Q = require('./lead-qualificacao')
const { sqlTelefoneNormalizado } = require('../telefone-br')

// ─── Vocabulario ────────────────────────────────────────────────────────────────────────

/**
 * Por que um lead NAO pode ser movido automaticamente. Lista FECHADA.
 *
 * Existe para a tela poder dizer "12 protegidos: 8 com conversa aberta, 4 com reuniao marcada"
 * em vez de um numero mudo, e para o teste poder afirmar QUAL regra barrou cada caso.
 * Nunca contem PII.
 */
const MOTIVO_PROTEGIDO = Object.freeze({
  FORA_DO_NICHO: 'fora_do_nicho',
  NAO_ABORDAVEL: 'nao_abordavel',          // pendente ou descartado (a porta, migration 071)
  STATUS_AVANCADO: 'status_avancado',      // respondeu / enviado / fechado / rejeitado / nao_contatar
  BLOQUEADO: 'bloqueado',                  // bloqueado_ate no futuro (a trava de 15 dias)
  JA_TRABALHADO: 'ja_trabalhado',          // disparo, ligacao ou follow-up registrado
  FOLLOW_UP_ABERTO: 'follow_up_aberto',
  REUNIAO_MARCADA: 'reuniao_marcada',
  CONVERSA_ABERTA: 'conversa_aberta',
})

/** Os status de funil que ainda sao INICIAIS — o lead nao foi abordado e nao respondeu. */
const STATUS_INICIAIS = Object.freeze(['coletado', 'contato_encontrado', 'aguardando', 'aprovado'])

/** De onde partiu a distribuicao. Vira `motivo` em `app.lead_responsavel_historico`. */
const ORIGEM = Object.freeze({
  ENTRADA_NA_EQUIPE: 'rebalanceamento_automatico_equipe',
  PUXADA_MANUAL: 'puxar_mais_leads',
})

/** Qual lead entra primeiro quando o gestor puxa uma quantidade. */
const CRITERIO = Object.freeze({
  MELHORES: 'melhores',
  MAIS_ANTIGOS: 'mais_antigos',
  SEM_CONTATO: 'sem_contato',
})

// ⚠️ Mapa FECHADO chave -> SQL, no padrao de `ORDEM_SQL_PROSPECTS`: o valor vem da requisicao e
// NADA do cliente e' concatenado no `ORDER BY`. Chave desconhecida cai no padrao, nunca lanca.
//
// `sem_contato` NAO e' "nunca abordado" — nesse universo TODO lead e' intocado por construcao, e
// um criterio que nao muda nada seria um controle que mente. Ele e' a faixa `falta_contato` de
// `services/lead-fila-trabalho.js`: lead sem telefone nem e-mail utilizavel, cujo trabalho e'
// COMPLETAR CADASTRO, nao vender. A tela rotula exatamente isso.
const ORDEM_CRITERIO = Object.freeze({
  [CRITERIO.MELHORES]: 'p.icp_score DESC NULLS LAST, p.rating DESC NULLS LAST, p.avaliacoes DESC NULLS LAST, p.created_at ASC',
  [CRITERIO.MAIS_ANTIGOS]: 'p.created_at ASC',
  [CRITERIO.SEM_CONTATO]: "(NULLIF(BTRIM(COALESCE(p.telefone, '')), '') IS NULL AND NULLIF(BTRIM(COALESCE(p.email, '')), '') IS NULL) DESC, p.created_at ASC",
})

/** Entre quem o gestor quer dividir o que puxou. */
const DISTRIBUIR_ENTRE = Object.freeze({
  TODOS: 'todos',
  SELECIONADOS: 'selecionados',
  MENOR_CARTEIRA: 'menor_carteira',
})

// Teto de movimentos por operacao. Nao e' arbitrario: o rebalanceamento automatico roda DENTRO da
// transacao que adiciona a pessoa a equipe, e uma transacao que move milhares de linhas seguraria
// o cadastro do participante por tempo indeterminado. O que passou do teto nao some — volta como
// `truncado: true`, e o gestor termina pelo botao manual.
const TETO_MOVIMENTOS = 500
const QUANTIDADE_MAX = 500

function ordemDoCriterio(criterio) {
  return ORDEM_CRITERIO[criterioValido(criterio)]
}

function criterioValido(criterio) {
  const c = String(criterio || '').trim().toLowerCase()
  return ORDEM_CRITERIO[c] ? c : CRITERIO.MAIS_ANTIGOS
}

function entreValido(entre) {
  const e = String(entre || '').trim().toLowerCase()
  return Object.values(DISTRIBUIR_ENTRE).includes(e) ? e : DISTRIBUIR_ENTRE.TODOS
}

/** Quantidade saneada. Fora da faixa cai no padrao/limite — nunca lanca e nunca aceita 0. */
function normalizarQuantidade(valor, padrao = 10) {
  const n = Math.trunc(Number(valor))
  if (!Number.isFinite(n) || n < 1) return padrao
  return Math.min(n, QUANTIDADE_MAX)
}

// ─── As expressoes SQL ──────────────────────────────────────────────────────────────────

/**
 * O lead ja' foi TRABALHADO por alguem?
 *
 * Reusa `LP.sqlUltimaAcao`, dono unico das tres fontes de acao (disparos — que cobrem a Evolution
 * E o wa.me manual —, ligacoes e follow-ups por `prospect_id`). Uma segunda regua aqui faria
 * "parado" e "intocado" discordarem sobre o mesmo lead, e os dois aparecem na MESMA tela.
 */
function sqlJaTrabalhado(alias = 'p') {
  // Os parenteses NAO sao estilo: sem eles, `AND NOT <isto>` vira `NOT (x IS NOT NULL)` apenas
  // por PRECEDENCIA de operador (`IS NOT NULL` liga mais forte que `NOT`). O resultado seria
  // correto hoje e frágil para sempre — a proxima pessoa que compusesse a expressao de outro
  // jeito inverteria a regra em silencio, e o efeito seria mover lead ja trabalhado.
  return `(${LP.sqlUltimaAcao(alias)} IS NOT NULL)`
}

/**
 * Existe follow-up para este lead pelo TELEFONE?
 *
 * ⚠️ Nao e' redundante com `sqlJaTrabalhado`: `app.follow_ups.prospect_id` e' NULLABLE (migration
 * 062 — a identidade la' e' `empresa_id + telefone_digitos`), e o limite esta declarado no
 * cabecalho de `services/lead-parado.js`. Para MARCAR um lead como parado, nao ver esse follow-up
 * custa um rotulo errado; para MOVER o lead de dono, custa tirar da mao de quem combinou o
 * retorno com o cliente. Aqui o predicado e' mais estrito de proposito.
 */
function sqlFollowUpPorTelefone(alias = 'p') {
  const fone = sqlTelefoneNormalizado(`${alias}.telefone`)
  return `EXISTS (
    SELECT 1 FROM app.follow_ups fu2
     WHERE fu2.empresa_id = ${alias}.empresa_id
       AND NULLIF(${fone}, '') IS NOT NULL
       AND ${sqlTelefoneNormalizado('fu2.telefone_digitos')} = ${fone}
  )`
}

/** Reuniao FUTURA nas DUAS agendas (a da tela e a do BOT), casada por telefone. */
function sqlReuniaoFutura(alias = 'p') {
  const fone = sqlTelefoneNormalizado(`${alias}.telefone`)
  return `(NULLIF(${fone}, '') IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM app.agenda_eventos ae2
       WHERE ae2.empresa_id = ${alias}.empresa_id
         AND ae2.excluido_em IS NULL
         AND ae2.status IN ('pendente', 'confirmado')
         AND ae2.data_inicio >= NOW()
         AND ${sqlTelefoneNormalizado('ae2.lead_telefone')} = ${fone}
    )
    OR EXISTS (
      SELECT 1 FROM vendas.agenda_eventos ve2
       WHERE ve2.excluido_em IS NULL
         AND ve2.tipo = 'reuniao'
         AND ve2.status IN ('pendente', 'confirmado')
         AND ve2.data_inicio >= NOW()
         AND (
           EXISTS (SELECT 1 FROM vendas.conversas vc2
                    WHERE vc2.id = ve2.conversa_id AND vc2.empresa_id = ${alias}.empresa_id
                      AND ${sqlTelefoneNormalizado('vc2.numero')} = ${fone})
           OR EXISTS (SELECT 1 FROM vendas.lead_profiles vlp2
                       WHERE vlp2.id = ve2.lead_id AND vlp2.empresa_id = ${alias}.empresa_id
                         AND ${sqlTelefoneNormalizado('vlp2.numero')} = ${fone})
         )
    )
  ))`
}

/**
 * Existe CONVERSA deste lead nesta empresa?
 *
 * Deliberadamente mais largo que "em atendimento humano": qualquer conversa nao arquivada
 * protege. Distinguir "atendimento humano" de "conversa que so' o bot respondeu" exigiria ler
 * `responsavel_id`/`operador_assumiu_em`/`agente_pausado` — tres sinais que mudam por conta
 * propria durante o atendimento —, e errar para o lado de mover deixaria um cliente conversando
 * com uma pessoa enquanto o lead passa para outra. Na duvida, protegido.
 */
function sqlConversaAberta(alias = 'p') {
  const fone = sqlTelefoneNormalizado(`${alias}.telefone`)
  return `EXISTS (
    SELECT 1 FROM vendas.conversas vc3
     WHERE vc3.empresa_id = ${alias}.empresa_id
       AND COALESCE(vc3.arquivado, false) = false
       AND NULLIF(${fone}, '') IS NOT NULL
       AND ${sqlTelefoneNormalizado('vc3.numero')} = ${fone}
  )`
}

/**
 * A condicao completa de REDISTRIBUIVEL, pronta para o WHERE.
 *
 * Nao inclui `empresa_id` nem `responsavel_id`: o primeiro e' isolamento de tenant e pertence ao
 * chamador (que ja' o tem no `$1`); o segundo muda conforme a pergunta (livre x da pessoa X).
 *
 * @param {string} alias            alias de `prospectador.prospects`.
 * @param {string} placeholderNicho o `$n` que recebera o `nicho_id` da equipe.
 */
function sqlRedistribuivel(alias = 'p', placeholderNicho = '$2') {
  const a = alias
  const statusIniciais = STATUS_INICIAIS.map((s) => `'${s}'`).join(', ')
  return `(
    ${a}.nicho_id = ${placeholderNicho}::uuid
    AND ${Q.sqlAbordavel(a)}
    AND ${a}.status IN (${statusIniciais})
    AND (${a}.bloqueado_ate IS NULL OR ${a}.bloqueado_ate <= NOW())
    AND NOT ${sqlJaTrabalhado(a)}
    AND NOT ${sqlFollowUpPorTelefone(a)}
    AND NOT ${sqlReuniaoFutura(a)}
    AND NOT ${sqlConversaAberta(a)}
  )`
}

/**
 * O MOTIVO da protecao, como expressao CASE — para a tela explicar o numero que mostrou.
 *
 * A ordem do CASE e' a de AVALIACAO, nao a de gravidade: o mais definitivo e mais barato de
 * checar vem antes. Um lead pode satisfazer varios motivos; o rotulo mostra o primeiro, e isso
 * basta para a conversa ("este tem reuniao marcada").
 */
function sqlMotivoProtegido(alias = 'p', placeholderNicho = '$2') {
  const a = alias
  const statusIniciais = STATUS_INICIAIS.map((s) => `'${s}'`).join(', ')
  return `CASE
    WHEN ${a}.nicho_id IS DISTINCT FROM ${placeholderNicho}::uuid THEN '${MOTIVO_PROTEGIDO.FORA_DO_NICHO}'
    WHEN NOT (${Q.sqlAbordavel(a)}) THEN '${MOTIVO_PROTEGIDO.NAO_ABORDAVEL}'
    WHEN ${a}.status NOT IN (${statusIniciais}) THEN '${MOTIVO_PROTEGIDO.STATUS_AVANCADO}'
    WHEN ${a}.bloqueado_ate IS NOT NULL AND ${a}.bloqueado_ate > NOW() THEN '${MOTIVO_PROTEGIDO.BLOQUEADO}'
    WHEN ${sqlReuniaoFutura(a)} THEN '${MOTIVO_PROTEGIDO.REUNIAO_MARCADA}'
    WHEN ${sqlConversaAberta(a)} THEN '${MOTIVO_PROTEGIDO.CONVERSA_ABERTA}'
    WHEN ${sqlFollowUpPorTelefone(a)} THEN '${MOTIVO_PROTEGIDO.FOLLOW_UP_ABERTO}'
    WHEN ${sqlJaTrabalhado(a)} THEN '${MOTIVO_PROTEGIDO.JA_TRABALHADO}'
    ELSE NULL
  END`
}

// ─── O PLANO ────────────────────────────────────────────────────────────────────────────
//
// As duas funcoes abaixo nao leem banco: recebem as contagens ja' apuradas e devolvem QUEM recebe
// quantos. Sao a parte testavel da regra, e a mesma que o gestor ve antes de confirmar.

function chave(v) { return v == null ? '' : String(v) }

/** Menor carteira primeiro; empate pelo id, para o plano ser DETERMINISTICO. */
function porMenorCarteira(a, b) {
  const d = (Number(a.atual) || 0) - (Number(b.atual) || 0)
  return d !== 0 ? d : chave(a.usuario_id).localeCompare(chave(b.usuario_id))
}

/**
 * O plano do REBALANCEAMENTO (gatilho: alguem entrou na equipe).
 *
 * Divisao inteira da carteira REDISTRIBUIVEL total (livres + intocados que ja' tem dono) entre os
 * membros; a sobra vai para quem tem MENOS. Quem esta acima da meta cede; quem esta abaixo recebe
 * — primeiro dos livres, depois do excedente dos colegas.
 *
 * ⚠️ `atual` e' a carteira REDISTRIBUIVEL da pessoa, nunca a carteira inteira dela. Usar o total
 * faria o plano prometer mover leads que o predicado protege, e a execucao entregaria menos que o
 * previsto — a tela mentiria antes mesmo de alguem clicar.
 *
 * @param {Array<{usuario_id: string, atual: number}>} membros
 * @param {number} livres  leads redistribuiveis SEM dono no nicho.
 */
function planoRebalanceamento({ membros, livres = 0 } = {}) {
  const gente = (Array.isArray(membros) ? membros : [])
    .map((m) => ({ usuario_id: m.usuario_id, atual: Math.max(0, Number(m.atual) || 0) }))
    .sort(porMenorCarteira)

  const disponiveis = Math.max(0, Number(livres) || 0)
  if (!gente.length) {
    return { meta_base: 0, membros: [], usar_livres: 0, mover_entre_membros: 0, total_movimentos: 0, truncado: false }
  }

  const pool = gente.reduce((t, m) => t + m.atual, 0) + disponiveis
  const metaBase = Math.floor(pool / gente.length)
  let sobra = pool % gente.length

  // A sobra vai para quem tem menos (a lista ja' esta nessa ordem): dar a quem ja' tem mais
  // aumentaria justamente a diferenca que o rebalanceamento existe para fechar.
  const plano = gente.map((m) => {
    const meta = metaBase + (sobra > 0 ? 1 : 0)
    if (sobra > 0) sobra -= 1
    const diff = meta - m.atual
    return {
      usuario_id: m.usuario_id,
      atual: m.atual,
      meta,
      receber: Math.max(0, diff),
      ceder: Math.max(0, -diff),
    }
  })

  const precisa = plano.reduce((t, m) => t + m.receber, 0)
  const usarLivres = Math.min(precisa, disponiveis)
  const moverEntreMembros = Math.max(0, precisa - usarLivres)
  const total = usarLivres + moverEntreMembros

  return {
    meta_base: metaBase,
    membros: plano,
    usar_livres: usarLivres,
    mover_entre_membros: moverEntreMembros,
    total_movimentos: Math.min(total, TETO_MOVIMENTOS),
    truncado: total > TETO_MOVIMENTOS,
  }
}

/**
 * O plano da PUXADA MANUAL (gatilho: o gestor pediu N leads do nicho).
 *
 * ⚠️ So' mexe em leads LIVRES. Puxar mais leads e' AUMENTAR o volume da equipe, nao remexer o que
 * ja' esta distribuido. Quem quer reequilibrar o que ja' tem dono usa o rebalanceamento.
 *
 * `todos`/`selecionados` dividem em partes iguais (a sobra para quem tem menos carteira);
 * `menor_carteira` enche do mais vazio para cima, e so' passa adiante quando empata.
 */
function planoPuxada({ membros, disponiveis = 0, quantidade = 0, entre = DISTRIBUIR_ENTRE.TODOS } = {}) {
  const modo = entreValido(entre)
  const gente = (Array.isArray(membros) ? membros : [])
    .map((m) => ({ usuario_id: m.usuario_id, atual: Math.max(0, Number(m.atual) || 0), receber: 0 }))
    .sort(porMenorCarteira)

  const total = Math.min(
    Math.max(0, Number(quantidade) || 0),
    Math.max(0, Number(disponiveis) || 0),
    TETO_MOVIMENTOS
  )
  if (!gente.length || total <= 0) {
    return { membros: gente, total_movimentos: 0, modo }
  }

  if (modo === DISTRIBUIR_ENTRE.MENOR_CARTEIRA) {
    // Enchimento por nivel: sempre entrega a quem estiver mais vazio NAQUELE momento.
    for (let i = 0; i < total; i += 1) {
      gente.sort((a, b) => porMenorCarteira(
        { usuario_id: a.usuario_id, atual: a.atual + a.receber },
        { usuario_id: b.usuario_id, atual: b.atual + b.receber }
      ))
      gente[0].receber += 1
    }
  } else {
    const base = Math.floor(total / gente.length)
    let sobra = total % gente.length
    for (const m of gente) {
      m.receber = base + (sobra > 0 ? 1 : 0)
      if (sobra > 0) sobra -= 1
    }
  }

  gente.sort(porMenorCarteira)
  return {
    membros: gente,
    total_movimentos: gente.reduce((t, m) => t + m.receber, 0),
    modo,
  }
}

/** Rotulo curto para log (sem PII). A traducao para a TELA vive em frontend/lib. */
function rotuloMotivoProtegido(motivo) {
  switch (motivo) {
    case MOTIVO_PROTEGIDO.FORA_DO_NICHO: return 'lead de outro nicho'
    case MOTIVO_PROTEGIDO.NAO_ABORDAVEL: return 'lead ainda nao triado ou descartado'
    case MOTIVO_PROTEGIDO.STATUS_AVANCADO: return 'lead ja abordado ou fechado'
    case MOTIVO_PROTEGIDO.BLOQUEADO: return 'lead bloqueado por regra operacional'
    case MOTIVO_PROTEGIDO.JA_TRABALHADO: return 'lead com disparo, ligacao ou follow-up registrado'
    case MOTIVO_PROTEGIDO.FOLLOW_UP_ABERTO: return 'lead com follow-up registrado'
    case MOTIVO_PROTEGIDO.REUNIAO_MARCADA: return 'lead com reuniao marcada'
    case MOTIVO_PROTEGIDO.CONVERSA_ABERTA: return 'lead com conversa em andamento'
    default: return ''
  }
}

module.exports = {
  MOTIVO_PROTEGIDO,
  STATUS_INICIAIS,
  ORIGEM,
  CRITERIO,
  DISTRIBUIR_ENTRE,
  TETO_MOVIMENTOS,
  QUANTIDADE_MAX,
  criterioValido,
  entreValido,
  normalizarQuantidade,
  ordemDoCriterio,
  sqlJaTrabalhado,
  sqlFollowUpPorTelefone,
  sqlReuniaoFutura,
  sqlConversaAberta,
  sqlRedistribuivel,
  sqlMotivoProtegido,
  planoRebalanceamento,
  planoPuxada,
  rotuloMotivoProtegido,
}
