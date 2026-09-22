'use strict'
// FICHA DO LEAD — vocabulário de APRESENTAÇÃO das quatro seções. Módulo PURO.
//
// O QUE ELE RESOLVE. Eram DOIS modais para o mesmo lead: `ConversaHistoricoModal` (conversa,
// status, ações) e `LeadDetalhesModal` (ICP, cadastro, evidências), abertos por gatilhos
// diferentes da mesma linha, cada um com o seu resumo do lead no topo. Quem estava na conversa
// e precisava do ICP fechava um e abria o outro — e perdia o que estava lendo. A ficha é UMA
// superfície com quatro seções; os dois componentes continuam existindo e viraram o conteúdo
// de duas delas (nada foi reimplementado).
//
// O QUE ELE NÃO FAZ: não decide permissão, não sabe o que é um lead, não busca nada. Recebe
// vereditos que a tela já tem e devolve rótulos e estados — mesmo contrato de
// `lib/site-rotulos.js`, `lib/capacidades.js` e `lib/lead-fila-trabalho.js`.
//
// Sem React, sem rede, sem DOM: testável com `node --test`.

/** As seções, na ordem em que aparecem. A ordem é a do trabalho: decidir → falar → qualificar → conferir. */
const SECOES = ['resumo', 'conversa', 'qualificacao', 'fontes']

const ROTULOS = {
  resumo: {
    rotulo: 'Resumo',
    dica: 'Próxima ação, contato e responsável — o que decide se vale trabalhar agora.',
  },
  conversa: {
    rotulo: 'Conversa',
    dica: 'Histórico do WhatsApp, envio da saudação e registro de reunião, ligação ou descarte.',
  },
  qualificacao: {
    rotulo: 'Qualificação',
    dica: 'ICP humano, completude do cadastro e a régua operacional — três medidas diferentes.',
  },
  fontes: {
    rotulo: 'Fontes',
    dica: 'De onde o lead veio e que evidências aquela fonte trouxe.',
  },
}

/**
 * Qual seção um gatilho da listagem abre. É aqui que "clicar no nome" deixa de significar
 * "abrir a conversa": o nome abre o RESUMO, que é a leitura de decisão; o telefone continua
 * abrindo a conversa (regra que a listagem já tinha e que continua valendo); a pontuação abre
 * a qualificação; a origem abre as fontes.
 *
 * Gatilho desconhecido cai em `resumo` — a seção que sempre existe e nunca depende de dado
 * que o lead possa não ter.
 */
const SECAO_POR_GATILHO = {
  nome: 'resumo',
  telefone: 'conversa',
  conversa: 'conversa',
  acao: 'conversa',
  pontuacao: 'qualificacao',
  icp: 'qualificacao',
  cadastro: 'qualificacao',
  detalhes: 'qualificacao',
  origem: 'fontes',
}

function normalizarSecao(secao) {
  const v = String(secao || '').trim().toLowerCase()
  return SECOES.includes(v) ? v : 'resumo'
}

function secaoDoGatilho(gatilho) {
  const v = String(gatilho || '').trim().toLowerCase()
  return SECAO_POR_GATILHO[v] || 'resumo'
}

/**
 * As abas da ficha, já com o estado de cada uma.
 *
 * ⚠️ Aba indisponível continua APARECENDO, desabilitada e **com o motivo em texto**. Escondê-la
 * faria a ficha ter três abas num lead e quatro em outro, e ninguém entenderia por quê — e o
 * guia visual é explícito: controle que a pessoa não pode usar, mas que tem decisão de produto
 * a explicar, fica visível com o motivo; some só quando não há nada a explicar.
 *
 * Hoje só a Conversa pode ficar indisponível, e por um motivo concreto: sem telefone não há
 * conversa de WhatsApp. O lead continua tendo resumo, qualificação e fontes.
 */
function abasDaFicha(vereditos = {}) {
  const { temTelefone = true } = vereditos
  return SECOES.map((chave) => {
    const base = ROTULOS[chave]
    const indisponivel = chave === 'conversa' && !temTelefone
    return {
      chave,
      rotulo: base.rotulo,
      dica: base.dica,
      disponivel: !indisponivel,
      motivo: indisponivel ? 'Este lead ainda não tem telefone — sem número não há conversa de WhatsApp.' : '',
    }
  })
}

/**
 * A seção que a ficha deve abrir de fato. Pedir a Conversa num lead sem telefone abriria uma
 * aba vazia e desabilitada; nesse caso cai no Resumo, que é onde o telefone pode ser
 * adicionado. Silenciosamente NÃO: quem chama recebe `motivo` para poder dizer o que houve.
 */
function secaoInicial(pedida, vereditos = {}) {
  const alvo = normalizarSecao(pedida)
  const abas = abasDaFicha(vereditos)
  const aba = abas.find((a) => a.chave === alvo)
  if (aba && aba.disponivel) return { secao: alvo, motivo: '' }
  return { secao: 'resumo', motivo: aba ? aba.motivo : '' }
}

/** Classes da aba. O estado ativo também vai em `aria-selected` — cor nunca é o único sinal. */
function classesAba(ativa, disponivel) {
  const base = 'inline-flex h-9 shrink-0 items-center rounded-lg px-3 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1'
  if (!disponivel) return `${base} cursor-not-allowed text-ink-3 opacity-50`
  return ativa
    ? `${base} bg-brand/10 font-semibold text-brand`
    : `${base} text-ink-2 hover:bg-surface-3`
}

module.exports = { SECOES, ROTULOS, abasDaFicha, secaoDoGatilho, normalizarSecao, secaoInicial, classesAba }
