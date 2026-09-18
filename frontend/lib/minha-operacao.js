'use strict'
// "Minha Operação" — a Visão Geral do COMERCIAL. APRESENTAÇÃO PURA.
//
// ─── POR QUE ESTA TELA EXISTE ───────────────────────────────────────────────────────────
// `/dashboard` chamava `/relatorios/resumo`, que exige `RELATORIOS_VER` — capacidade que o
// `comercial` e o `member` NÃO têm. A primeira tela depois do login (e, desde o termo, depois do
// aceite) era um erro 403. Não era só "administrativa demais": estava quebrada para quem mais
// usa o produto.
//
// ─── REGRA DE OURO, a mesma de `lib/comissao.js` e `lib/missao.js` ──────────────────────
// **Nada é recalculado aqui.** Fração, nível, "alcançou", contagens e ranking chegam prontos do
// backend. Este módulo só decide COMO dizer — e a parte delicada é justamente essa: a mensagem
// de proximidade é a única coisa da tela que pode soar falsa.
//
// ─── AS TRÊS REGRAS DA MENSAGEM MOTIVADORA ──────────────────────────────────────────────
//  1. **Nunca inventar número.** Sem meta legível não há marco, não há selo e não há frase de
//     progresso — a tela diz que não há meta, e pronto.
//  2. **Nunca soar de deboche.** Com 8% do alvo, "falta pouco!" é piada de mau gosto. O tom sobe
//     junto com o progresso; embaixo, a frase é factual.
//  3. **Janela encerrada muda o tempo verbal.** "Você consegue" num desafio que acabou ontem é
//     mentira. Depois do prazo, a frase fala no passado e some o incentivo.

// ─── Marcos de proximidade ──────────────────────────────────────────────────────────────
// Os cortes são 50/75/90 porque foi o que o operador pediu. `intensidade` existe para a barra
// ficar mais viva perto da meta SEM que a cor seja a informação — o selo e a frase sempre
// acompanham (mesma disciplina da BolinhaPontuacao).

const { montarFila, emAberto } = require('./followups-fila')

const MARCOS = Object.freeze([
  { minimo: 1, marco: 100, selo: 'Meta alcançada', intensidade: 'conquista' },
  { minimo: 0.9, marco: 90, selo: 'Perto da meta', intensidade: 'alta' },
  { minimo: 0.75, marco: 75, selo: null, intensidade: 'media' },
  { minimo: 0.5, marco: 50, selo: null, intensidade: 'media' },
  { minimo: 0, marco: 0, selo: null, intensidade: 'baixa' },
])

const FRASE_EM_ANDAMENTO = {
  100: 'Meta alcançada.',
  90: 'Quase lá — falta {faltam}.',
  75: 'Três quartos do caminho. Faltam {faltam}.',
  50: 'Metade do caminho. Faltam {faltam}.',
  0: 'Faltam {faltam} para a meta.',
}

// Depois do prazo o incentivo sai e o tempo verbal muda. Nada de "você consegue" num desafio
// que já acabou.
const FRASE_ENCERRADA = {
  100: 'Meta alcançada.',
  90: 'Terminou a {faltam} da meta.',
  75: 'Terminou a {faltam} da meta.',
  50: 'Terminou a {faltam} da meta.',
  0: 'Terminou a {faltam} da meta.',
}

/**
 * O marco de proximidade de um progresso que o BACKEND já calculou.
 *
 * @param {object} progresso  `{ fracao, faltam, alcancado }` — vindo pronto da API.
 * @param {object} opcoes     `{ encerrado, formatarValor }`. `formatarValor` é injetado para este
 *                            módulo não escolher formatação de dinheiro (quem é dono disso é
 *                            `lib/comissao.js`, e duas formatações divergiriam na mesma tela).
 * @returns {{marco: number, selo: string|null, intensidade: string, frase: string, largura: string}|null}
 *          `null` quando não há meta legível — a tela então NÃO desenha barra nem frase.
 */
function proximidade(progresso, { encerrado = false, formatarValor } = {}) {
  const p = progresso || {}
  // Sem alvo não há proximidade. Inventar um marco aqui faria a barra mentir.
  if (p.alvo === null || p.alvo === undefined) return null

  const fracao = Number(p.fracao)
  if (!Number.isFinite(fracao)) return null
  const limitada = Math.min(1, Math.max(0, fracao))

  const alcancado = !!p.alcancado || limitada >= 1
  const nivel = MARCOS.find((m) => limitada >= m.minimo) || MARCOS[MARCOS.length - 1]
  const marco = alcancado ? 100 : nivel.marco

  const molde = (encerrado && !alcancado ? FRASE_ENCERRADA : FRASE_EM_ANDAMENTO)[marco]
  const faltam = typeof formatarValor === 'function'
    ? formatarValor(p.faltam || 0)
    : String(p.faltam ?? '')

  return {
    marco,
    selo: alcancado ? MARCOS[0].selo : (encerrado ? null : nivel.selo),
    intensidade: alcancado ? 'conquista' : (encerrado ? 'baixa' : nivel.intensidade),
    frase: molde.replace('{faltam}', faltam),
    largura: `${Math.round(limitada * 100)}%`,
  }
}

// ─── Fluxo operacional: o que fazer agora ───────────────────────────────────────────────
//
// A ordem é por CONSEQUÊNCIA, não por volume: prazo vencido primeiro (alguém está esperando),
// reunião depois (hora marcada), e só então o que é oportunidade. Ordenar por quantidade poria
// "40 leads livres" acima de "1 follow-up vencido", que é o oposto do certo.

const PASSOS = Object.freeze([
  {
    chave: 'followups_vencidos',
    urgencia: 1,
    tom: 'urgente',
    href: '/dashboard/follow-ups',
    texto: (n) => (n === 1 ? '1 follow-up com prazo vencido' : `${n} follow-ups com prazo vencido`),
  },
  {
    chave: 'reunioes_hoje',
    urgencia: 2,
    tom: 'atencao',
    href: '/dashboard/agenda',
    texto: (n) => (n === 1 ? '1 reunião hoje' : `${n} reuniões hoje`),
  },
  {
    chave: 'leads_parados',
    urgencia: 3,
    tom: 'atencao',
    href: '/dashboard/banco-leads',
    texto: (n) => (n === 1 ? '1 lead seu parado há dias' : `${n} leads seus parados há dias`),
  },
  {
    chave: 'followups_hoje',
    urgencia: 4,
    tom: 'neutro',
    href: '/dashboard/follow-ups',
    texto: (n) => (n === 1 ? '1 follow-up para hoje' : `${n} follow-ups para hoje`),
  },
  {
    chave: 'leads_livres',
    urgencia: 5,
    tom: 'oportunidade',
    href: '/dashboard/banco-leads',
    texto: (n) => (n === 1 ? '1 lead livre para assumir' : `${n} leads livres para assumir`),
  },
])

/**
 * Os próximos passos, já ordenados.
 *
 * Contagem zero ou ausente **não vira linha**: uma lista que sempre mostra "0 follow-ups
 * vencidos" treina a pessoa a ignorar a lista inteira. Lista vazia é resposta legítima e a tela
 * diz isso com outra frase.
 */
function proximosPassos(contagens) {
  const c = contagens || {}
  return PASSOS
    .map((p) => ({ passo: p, n: Number(c[p.chave]) || 0 }))
    .filter(({ n }) => n > 0)
    .sort((a, b) => a.passo.urgencia - b.passo.urgencia)
    .map(({ passo, n }) => ({
      chave: passo.chave,
      quantidade: n,
      texto: passo.texto(n),
      tom: passo.tom,
      href: passo.href,
    }))
}

// ─── Contagem de follow-ups: a MESMA fila da Central de Follow-ups ──────────────────────
//
// ⚠️ O defeito que isto corrige: a tela lia `data.itens` do `/call-list` (que devolve
// `data.lista`) e filtrava por `situacao`, campo que o BACKEND NUNCA devolve — ele nasce em
// `montarFila`. As duas contagens ficavam presas em zero e as linhas mais urgentes do dia nunca
// apareciam.
//
// A contagem vem de `montarFila`, a MESMA função que monta a Central de Follow-ups, e pelas
// MESMAS três fontes. Contar aqui por conta própria faria a home e a Central discordarem sobre
// quantos follow-ups a pessoa tem — e a home é onde ela decide se abre a Central.
//
// `atrasado` só nasce de um follow-up REGISTRADO (`/itens`), que é o único com prazo próprio;
// `call-list` é recomendação heurística e classifica no máximo como `agora`. Por isso as três
// fontes são buscadas: sem `/itens` não existe "vencido" nenhum para contar.
const PRAZO_VENCIDO = 'atrasado'
const PRAZO_DE_HOJE = Object.freeze(['agora', 'hoje'])

/**
 * `{ vencidos, hoje }` a partir das três fontes cruas da fila.
 *
 * Recebe as respostas como vieram da API e devolve só os dois números que a tela usa — a
 * classificação inteira continua sendo de `lib/followups-fila.js`.
 */
function contagensDeFollowUp(fontes) {
  const f = fontes || {}
  const fila = montarFila({
    humanos: Array.isArray(f.humanos) ? f.humanos : [],
    automaticos: Array.isArray(f.automaticos) ? f.automaticos : [],
    followups: Array.isArray(f.followups) ? f.followups : [],
    agora: f.agora,
  })
  const abertos = fila.filter((i) => emAberto(i))
  return {
    vencidos: abertos.filter((i) => i.prazo_quando === PRAZO_VENCIDO).length,
    hoje: abertos.filter((i) => PRAZO_DE_HOJE.includes(i.prazo_quando)).length,
  }
}

/** A frase de quando não há nada pendente. Não é elogio: é constatação, e aponta o próximo lugar. */
function nadaPendente(temLeadsLivres) {
  return temLeadsLivres
    ? 'Nada vencido por agora. Há leads livres esperando alguém assumir.'
    : 'Nada vencido por agora.'
}

// ─── Ranking em placar ──────────────────────────────────────────────────────────────────

/**
 * A posição de quem está olhando, para o placar dizer "você está em 3º".
 *
 * ⚠️ O ranking NUNCA carrega a comissão de ninguém — ele traz nome e faturamento originado, e é
 * assim que a API já o devolve (decisão D4). Este módulo não acrescenta nada a ele; só localiza
 * a pessoa. `null` quando ela não está na lista (ainda não originou nada no mês), que é
 * diferente de "está em último".
 */
function minhaPosicao(ranking, usuarioId) {
  const lista = Array.isArray(ranking) ? ranking : []
  const i = lista.findIndex((l) => String(l.usuario_id) === String(usuarioId))
  if (i < 0) return null
  return { posicao: i + 1, total: lista.length }
}

// ─── Qual visão mostrar em /dashboard ───────────────────────────────────────────────────

/**
 * Quem vê a Visão Geral administrativa e quem vê Minha Operação.
 *
 * A decisão é por CAPACIDADE, nunca por papel literal — e a capacidade escolhida não é arbitrária:
 * a tela administrativa **depende** de `relatorios_ver` para carregar. Quem não a tem não está
 * vendo uma tela "menos completa"; está vendo um 403. Por isso o critério é exatamente esse.
 *
 * `capacidades` `null` (sessão ainda carregando) devolve `null`: não se escolhe tela no escuro,
 * senão a pessoa vê a visão errada por um instante a cada carregamento.
 */
function visaoDoPainel(capacidades) {
  if (!Array.isArray(capacidades)) return null
  return capacidades.includes('relatorios_ver') ? 'administrativa' : 'minha_operacao'
}

module.exports = {
  MARCOS,
  PASSOS,
  PRAZO_VENCIDO,
  PRAZO_DE_HOJE,
  proximidade,
  proximosPassos,
  contagensDeFollowUp,
  nadaPendente,
  minhaPosicao,
  visaoDoPainel,
}
