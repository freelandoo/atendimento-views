'use strict'
// A PORTA da operação comercial — módulo PURO e dono ÚNICO do vocabulário de qualificação.
// Sem banco, sem HTTP, sem IA, sem rede. CRM em equipe, Etapa 3.
// Ver docs/analise-qualificacao-lead-e-multiusuario.md e docs/plano-execucao-crm-equipe.md §5.
//
// ─── A REGRA, EM UMA FRASE ───────────────────────────────────────────────────────────────
// Encontrar um lead não autoriza trabalhá-lo. Ele entra na operação comercial (ligação,
// WhatsApp, e-mail, campanha) depois de triagem e aprovação — ou porque já operava antes desta
// regra existir (`legado`).
//
// ─── A PERGUNTA QUE ESTE MÓDULO RESPONDE ─────────────────────────────────────────────────
// Ele NÃO responde "qual a qualificação deste lead?", e sim **"este lead pode ser abordado?"**.
// A primeira pergunta admite resposta por heurística ("está `aguardando`, deve dar"), e foi
// heurística que produziu o defeito: `STATUS_RODAVEL` incluía `aguardando` de propósito, e
// `db/campanhas.js` nem lia o status.
//
// ─── PROIBIÇÕES (com guarda de regressão em test/lead-qualificacao.test.js) ──────────────
//  1. Comparar `qualificacao` com LITERAL fora deste módulo. Quem pergunta usa
//     `podeAbordar()` / `QUALIFICACAO.X`. Foi a comparação espalhada por 7 pontos que fez o
//     sistema inteiro chamar Instagram de site (migration 056) — o mesmo erro, outro domínio.
//  2. Um coletor inserir prospect SEM informar `qualificacao`. O `DEFAULT 'legado'` da migration
//     071 existe para a CARÊNCIA do acervo, não para leads novos: lead novo nasce `pendente`.
//     Guarda lê o fonte dos coletores.
//  3. Deduzir aprovação a partir de `status`. `status` é sobrescrito por `enviado` ao abordar —
//     deduzir dali inventaria a prova que esta porta existe para exigir.

// ─── Vocabulário ─────────────────────────────────────────────────────────────────────────
// Espelha a CHECK prospects_qualificacao_chk (migration 071).
const QUALIFICACAO = Object.freeze({
  /** Coletado e ninguém triou. NÃO pode ser abordado. */
  PENDENTE: 'pendente',
  /** Uma pessoa aprovou. Pode ser abordado. */
  APROVADO: 'aprovado',
  /** Uma pessoa recusou. NUNCA pode ser abordado. */
  DESCARTADO: 'descartado',
  /**
   * Já operava antes desta regra existir. Pode ser abordado.
   * **NÃO é "aprovado": é a ausência de prova, NOMEADA** — mesmo vocabulário de
   * `origem_vinculo = 'legado'` (migration 061). A tela mostra isso rotulado; o operador reduz o
   * acervo triando pela curadoria que já existe.
   */
  LEGADO: 'legado',
})

const VALORES = Object.freeze(Object.values(QUALIFICACAO))

/**
 * Os valores que passam pela porta.
 *
 * `legado` está aqui por DECISÃO DE CARÊNCIA (D1), medida: 77,7% dos 3.535 leads elegíveis ao
 * disparo em produção não têm prova de triagem. Sem ele, ligar a porta pararia a operação.
 * Quando o acervo for triado, remover `legado` daqui é uma linha — e o teste que cobra a decisão
 * falha, forçando a conversa antes.
 */
const ABORDAVEIS = Object.freeze([QUALIFICACAO.APROVADO, QUALIFICACAO.LEGADO])
const _ABORDAVEIS = new Set(ABORDAVEIS)

// Motivos de recusa. Vocabulário FECHADO, para log e tela explicarem sem inventar texto, e para
// o teste poder afirmar POR QUE algo foi barrado. Nunca contém PII.
const MOTIVOS = Object.freeze({
  APROVADO: 'aprovado',
  LEGADO: 'legado',
  NAO_TRIADO: 'nao_triado',
  DESCARTADO: 'descartado',
  QUALIFICACAO_DESCONHECIDA: 'qualificacao_desconhecida',
  SEM_LEAD: 'sem_lead',
})

/** O valor pertence ao vocabulário? Valor desconhecido NEGA (nunca lança). */
function qualificacaoConhecida(valor) {
  return typeof valor === 'string' && VALORES.includes(valor)
}

/**
 * A pergunta central.
 *
 * @param {object|string|null} lead  o prospect (ou só a qualificação, para conveniência).
 * @returns {{permitido: boolean, motivo: string}}
 */
function avaliarAbordagem(lead) {
  if (lead == null) return { permitido: false, motivo: MOTIVOS.SEM_LEAD }
  const q = typeof lead === 'string' ? lead : lead.qualificacao
  if (!qualificacaoConhecida(q)) {
    // Inclui `undefined` (coluna não selecionada no SELECT). NEGAR é o certo: um SELECT que
    // esqueceu a coluna não pode virar "pode abordar" — seria a porta aberta por omissão, que é
    // como este defeito nasceu na primeira vez.
    return { permitido: false, motivo: MOTIVOS.QUALIFICACAO_DESCONHECIDA }
  }
  if (q === QUALIFICACAO.DESCARTADO) return { permitido: false, motivo: MOTIVOS.DESCARTADO }
  if (q === QUALIFICACAO.PENDENTE) return { permitido: false, motivo: MOTIVOS.NAO_TRIADO }
  return { permitido: true, motivo: q === QUALIFICACAO.APROVADO ? MOTIVOS.APROVADO : MOTIVOS.LEGADO }
}

/** Atalho booleano. Use quando o motivo não importa. */
function podeAbordar(lead) {
  return avaliarAbordagem(lead).permitido
}

/**
 * Traduz a decisão humana (o vocabulário da CURADORIA, migration 055) para esta coluna.
 *
 * A curadoria grava `aprovado|descartado` em `curadoria_decisoes.decisao`; `status` recebe
 * `aprovado|rejeitado`. São três vocabulários para o mesmo ato, e isto é o único ponto que os
 * costura — espalhar a tradução recriaria a divergência.
 */
function qualificacaoDaDecisao(decisao) {
  if (decisao === 'aprovado') return QUALIFICACAO.APROVADO
  if (decisao === 'descartado' || decisao === 'rejeitado') return QUALIFICACAO.DESCARTADO
  return null
}

/**
 * Uma recoleta pode REBAIXAR a qualificação de um lead?
 *
 * **Não.** Decidir de novo o que uma pessoa já decidiu é o defeito "lead descartado volta por nova
 * importação" (R9). A recoleta só pode PROMOVER `pendente` (e nem isso: ela não sabe nada sobre
 * adequação). Então a resposta é sempre "mantenha o que está lá".
 *
 * Existe como função, e não como comentário no SQL, para o teste poder cobrá-la.
 */
function qualificacaoAoRecoletar(atual) {
  return qualificacaoConhecida(atual) ? atual : QUALIFICACAO.PENDENTE
}

/**
 * Com que qualificação um lead RECÉM-COLETADO nasce.
 * Sempre `pendente`. O `DEFAULT 'legado'` do schema é para a carência do acervo — se um coletor
 * novo o herdar por esquecimento, um lead nunca visto entraria na operação sem triagem.
 */
function qualificacaoInicial() {
  return QUALIFICACAO.PENDENTE
}

/** Rótulo curto para log (sem PII). A tradução para a TELA vive em frontend/lib. */
function rotuloMotivo(motivo) {
  switch (motivo) {
    case MOTIVOS.NAO_TRIADO: return 'lead ainda nao triado'
    case MOTIVOS.DESCARTADO: return 'lead descartado na triagem'
    case MOTIVOS.QUALIFICACAO_DESCONHECIDA: return 'qualificacao ausente ou invalida'
    case MOTIVOS.SEM_LEAD: return 'lead nao encontrado'
    default: return ''
  }
}

// ─── Fragmentos SQL ──────────────────────────────────────────────────────────────────────
// Dono único das expressões que os consumidores colam no WHERE. Não é "SQL num módulo puro":
// é uma CONSTANTE de texto, sem banco e sem parâmetro — o que evita que 5 lugares escrevam a
// mesma condição de formas que divergem (foi assim que `!!(lead.site || lead.tem_site)` se
// espalhou por 7 pontos antes da migration 056).

/** Condição de "pode ser abordado", para colar no WHERE. `alias` é a tabela de prospects. */
function sqlAbordavel(alias = 'p') {
  const a = alias ? `${alias}.` : ''
  return `${a}qualificacao IN ('aprovado', 'legado')`
}

/**
 * Condição de "APROVADO por uma pessoa" — a porta ESTRITA da Central de Ligações.
 *
 * Mais estrita que `sqlAbordavel` de propósito: aqui `legado` **não** passa. Decisão do operador
 * (2026-09-12), tomada com a consequência declarada e medida: os 4.268 leads do acervo nascem
 * `legado` na migration 071, então a fila de ligações fica **vazia** até alguém triar. É o que
 * "somente após a aprovação o lead pode aparecer na fila" significa quando levado a sério.
 *
 * Ela vale só na Central de Ligações. Os quatro pontos de DISPARO (WhatsApp e e-mail) continuam
 * usando `sqlAbordavel` — mudar aqueles pararia a operação inteira, e não foi o que se pediu.
 */
function sqlAprovado(alias = 'p') {
  const a = alias ? `${alias}.` : ''
  return `${a}qualificacao = 'aprovado'`
}

/** Condição de "NÃO foi descartado" — a 2ª barreira, mais frouxa que `sqlAbordavel`.
 *  Usada onde o lead JÁ ENTROU na operação antes da regra (ex.: leads já vinculados a campanha):
 *  tirá-los da fila por falta de triagem esvaziaria a fila inteira, mas deixar um DESCARTADO ali
 *  é o defeito medido em produção (54 leads). */
function sqlNaoDescartado(alias = 'p') {
  const a = alias ? `${alias}.` : ''
  return `${a}qualificacao <> 'descartado'`
}

module.exports = {
  QUALIFICACAO,
  VALORES,
  ABORDAVEIS,
  MOTIVOS,
  qualificacaoConhecida,
  avaliarAbordagem,
  podeAbordar,
  qualificacaoDaDecisao,
  qualificacaoAoRecoletar,
  qualificacaoInicial,
  rotuloMotivo,
  sqlAbordavel,
  sqlAprovado,
  sqlNaoDescartado,
  _ABORDAVEIS,
}
