// @ts-check
'use strict'
// A CARTEIRA DO NICHO da equipe — modulo PURO de APRESENTACAO.
// Sem React, sem rede, sem DOM. Ele so' TRADUZ o veredito que a API ja resolveu, no mesmo
// contrato de `lib/site-rotulos.js`, `lib/capacidades.js` e `lib/lead-parado.js`.
//
// ─── POR QUE MODULO PROPRIO, E NAO MAIS UMA SECAO EM equipe-area.js ─────────────────────
// Sao DUAS carteiras com o MESMO nome, e confundi-las e' o erro facil desta tela:
//   • `GET /equipe`                      → a carteira da pessoa na EMPRESA INTEIRA;
//   • `GET /equipes-comerciais/:id/carteira` → a carteira dela NAQUELE NICHO.
// Os dois numeros sao legitimos, diferentes e aparecem na mesma tela. Por isso cada coluna
// daqui declara `oQueMede`, pelo mesmo motivo do `oQueMede` obrigatorio da `BolinhaPontuacao`:
// numeros lado a lado sugerem que sao comparaveis entre si.
//
// ─── O QUE ESTE MODULO NAO FAZ ──────────────────────────────────────────────────────────
// Nao decide o que e' "intocado", nao classifica "protegido", nao calcula meta nem quem cede.
// Tudo isso e' `backend/src/services/lead-distribuicao.js`. Regra de negocio no front quebra
// em silencio — e aqui ela quebraria movendo lead errado de dono.

// ─── As colunas da tabela ───────────────────────────────────────────────────────────────
//
// ⚠️ TODAS contam LEADS (a mesma unidade), e elas NAO se somam: `intocados` + `em_andamento`
// particionam `leads`, mas `parados`, `com_follow_up` e `com_reuniao` sao recortes que cruzam
// os dois — um lead intocado ha 30 dias e' intocado E parado. Cada rotulo diz isso.
const COLUNAS_CARTEIRA = Object.freeze([
  {
    chave: 'leads',
    rotulo: 'Leads',
    oQueMede: 'Leads deste nicho sob responsabilidade desta pessoa agora.',
  },
  {
    chave: 'intocados',
    rotulo: 'Intocados',
    oQueMede: 'Leads sem nenhuma abordagem, ligação, follow-up, conversa ou reunião. São os únicos que a distribuição pode mover.',
  },
  {
    chave: 'em_andamento',
    rotulo: 'Em andamento',
    oQueMede: 'Leads que já receberam algum trabalho. Nunca mudam de responsável automaticamente.',
  },
  {
    chave: 'parados',
    rotulo: 'Parados',
    oQueMede: 'Leads sem nenhuma ação registrada na janela. Já estão contados em "Leads" — é alerta, não carteira à parte.',
    tom: 'alerta',
  },
  {
    chave: 'com_follow_up',
    rotulo: 'Follow-ups',
    oQueMede: 'Leads deste nicho com follow-up registrado. Contados como trabalho em andamento.',
  },
  {
    chave: 'com_reuniao',
    // ⚠️ E' um recorte da CARTEIRA ("quantos leads desta pessoa tem reuniao marcada"), NAO uma
    // contagem de reunioes que a pessoa conduziu — isso nao tem fonte neste produto
    // (`agenda_eventos.responsavel_id` existe desde a migration 076 e nunca teve backfill, entao
    // viria quase tudo zero). A fonte aqui e' a mesma subconsulta por telefone do Banco de Leads.
    rotulo: 'Com reunião',
    oQueMede: 'Leads desta pessoa com reunião futura marcada. É um recorte da carteira, não quantas reuniões ela fez.',
    tom: 'ok',
  },
])

/** O valor de uma coluna. Ausencia vira 0 — membro sem linha tem carteira vazia, nao dado faltando. */
function valorDaCarteira(pessoa, coluna) {
  if (!coluna) return 0
  return Number((pessoa || {})[coluna.chave]) || 0
}

/** O tom da celula. Zero nunca e' pintado: nao ha nada a alertar num numero que nao existe. */
function tomDaCarteira(coluna, valor) {
  if (!coluna || !coluna.tom || !valor) return 'neutro'
  return coluna.tom
}

// ─── Por que um lead esta protegido ─────────────────────────────────────────────────────
//
// Traducao do vocabulario FECHADO de `services/lead-distribuicao.js`. Motivo desconhecido e'
// exibido COMO ELE MESMO, nunca escondido: um motivo novo no servidor nao pode sumir da tela.
const ROTULO_PROTEGIDO = Object.freeze({
  fora_do_nicho: 'de outro nicho',
  nao_abordavel: 'ainda não triados ou descartados',
  status_avancado: 'já abordados ou fechados',
  bloqueado: 'bloqueados por regra operacional',
  ja_trabalhado: 'com disparo, ligação ou follow-up registrado',
  follow_up_aberto: 'com follow-up registrado',
  reuniao_marcada: 'com reunião marcada',
  conversa_aberta: 'com conversa em andamento',
})

function rotuloProtegido(motivo) {
  return ROTULO_PROTEGIDO[String(motivo || '')] || String(motivo || '')
}

/**
 * O resumo dos leads que a distribuicao NAO pode mover.
 *
 * Sem ele, o gestor ve "movi 3 de 15" e nao tem como saber se o sistema falhou ou se os outros
 * 12 estao em negociacao. Devolve `null` quando nao ha nada protegido — nao se ocupa espaco
 * para dizer que esta tudo bem.
 */
function resumoProtegidos(protegidos) {
  const lista = (Array.isArray(protegidos) ? protegidos : [])
    .map((p) => ({ motivo: String(p.motivo || ''), total: Number(p.total) || 0 }))
    .filter((p) => p.total > 0)
  if (!lista.length) return null
  const total = lista.reduce((t, p) => t + p.total, 0)
  return {
    total,
    titulo: total === 1 ? '1 lead protegido' : `${total} leads protegidos`,
    itens: lista.map((p) => ({ ...p, rotulo: rotuloProtegido(p.motivo) })),
    explicacao: 'A distribuição nunca move lead com trabalho começado. Eles continuam com quem está cuidando.',
  }
}

// ─── Alertas da carteira ────────────────────────────────────────────────────────────────

/**
 * Quem esta com carteira MUITO abaixo da media da equipe.
 *
 * ⚠️ Nao e' placar e nao ordena gente por desempenho: mede CARGA (leads na mao), que e'
 * exatamente o que o gestor veio redistribuir. Exige pelo menos 2 pessoas e alguma carteira —
 * com uma pessoa so' nao existe desequilibrio, e com carteira zerada o alerta util e' outro.
 */
function avisoDesequilibrio(membros) {
  const lista = (Array.isArray(membros) ? membros : [])
  if (lista.length < 2) return null
  const totais = lista.map((m) => Number(m.leads) || 0)
  const soma = totais.reduce((t, n) => t + n, 0)
  if (soma <= 0) return null
  const media = soma / lista.length
  // Metade da media e' o corte: abaixo disso a diferenca deixa de ser variacao normal do dia.
  const abaixo = lista.filter((m) => (Number(m.leads) || 0) < media / 2)
  if (!abaixo.length) return null
  const nomes = abaixo.map((m) => m.nome || 'sem nome')
  return {
    chave: 'carteira_desequilibrada',
    tom: 'alerta',
    titulo: abaixo.length === 1
      ? `${nomes[0]} está com bem menos carteira que a equipe`
      : `${abaixo.length} pessoas estão com bem menos carteira que a equipe`,
    descricao: 'Puxe mais leads do nicho ou adicione alguém à equipe para redistribuir o que ninguém tocou.',
    pessoas: nomes,
  }
}

/** Nao ha nada para distribuir: dizer isso e' diferente de mostrar uma tela vazia. */
function avisoSemDisponiveis(disponiveis, protegidos) {
  if ((Number(disponiveis) || 0) > 0) return null
  const p = resumoProtegidos(protegidos)
  return {
    chave: 'sem_leads_livres',
    tom: 'neutro',
    titulo: 'Nenhum lead livre neste nicho',
    descricao: p
      ? `Há ${p.total} lead${p.total === 1 ? '' : 's'} no nicho que a distribuição não move porque já têm trabalho começado. Para aumentar o volume, rode uma busca na Aquisição.`
      : 'Para aumentar o volume da equipe, rode uma busca na Aquisição e aprove os leads na triagem.',
  }
}

// ─── O modal "Puxar mais leads" ─────────────────────────────────────────────────────────

// Os tres criterios sao DIFERENTES de verdade — um controle que nao muda nada seria um controle
// que mente. "Sem contato" e' a faixa `falta_contato` do Banco de Leads: lead sem telefone nem
// e-mail, cujo trabalho e' COMPLETAR CADASTRO, nao vender. O rotulo diz exatamente isso.
const CRITERIOS = Object.freeze([
  { id: 'melhores', rotulo: 'Melhores primeiro', ajuda: 'Maior pontuação de ICP, nota e avaliações.' },
  { id: 'mais_antigos', rotulo: 'Mais antigos primeiro', ajuda: 'Os que entraram na carteira há mais tempo.' },
  { id: 'sem_contato', rotulo: 'Sem contato primeiro', ajuda: 'Sem telefone nem e-mail no cadastro — o trabalho aqui é completar dados, não vender.' },
])

const MODOS_DISTRIBUICAO = Object.freeze([
  { id: 'todos', rotulo: 'Todos da equipe', ajuda: 'Divide em partes iguais; a sobra vai para quem tem menos.' },
  { id: 'menor_carteira', rotulo: 'Quem está com menos carteira', ajuda: 'Enche primeiro quem está mais vazio, até emparelhar.' },
  { id: 'selecionados', rotulo: 'Pessoas selecionadas', ajuda: 'Só quem você marcar recebe.' },
])

const QUANTIDADE_PADRAO = 10

function opcaoValida(lista, id, padrao) {
  return (lista.find((o) => o.id === String(id || '')) || lista.find((o) => o.id === padrao) || lista[0]).id
}

/**
 * O formulario esta pronto para enviar?
 *
 * ⚠️ NAO valida quantidade contra o disponivel: quem tem o banco na mao e' o backend, e uma
 * segunda regua aqui seria mais frouxa (o numero muda entre abrir o modal e clicar). A tela
 * INFORMA o disponivel; quem recusa e' o servidor, que devolve o total REAL movido.
 */
function validarPuxada({ quantidade, entre, selecionados, disponiveis } = {}) {
  const n = Math.trunc(Number(quantidade))
  if (!Number.isFinite(n) || n < 1) {
    return { pode: false, motivo: 'Informe quantos leads quer puxar.' }
  }
  if ((Number(disponiveis) || 0) <= 0) {
    return { pode: false, motivo: 'Não há lead livre neste nicho para distribuir.' }
  }
  if (String(entre) === 'selecionados' && !(Array.isArray(selecionados) && selecionados.length)) {
    return { pode: false, motivo: 'Marque quem vai receber os leads.' }
  }
  return { pode: true, motivo: '' }
}

/** O que o gestor le ANTES de confirmar. Nunca promete mais do que ha disponivel. */
function previaDaPuxada({ quantidade, disponiveis, entre, selecionados, membros } = {}) {
  const pedido = Math.max(0, Math.trunc(Number(quantidade)) || 0)
  const livres = Math.max(0, Number(disponiveis) || 0)
  const vaiMover = Math.min(pedido, livres)
  const modo = String(entre || 'todos')
  const quantos = modo === 'selecionados'
    ? (Array.isArray(selecionados) ? selecionados.length : 0)
    : (Array.isArray(membros) ? membros.length : 0)

  if (vaiMover <= 0) return 'Nenhum lead será distribuído.'
  const alvo = quantos === 1 ? '1 pessoa' : `${quantos} pessoas`
  const base = `${vaiMover} lead${vaiMover === 1 ? '' : 's'} livre${vaiMover === 1 ? '' : 's'} para ${alvo}.`
  return pedido > livres
    ? `${base} Você pediu ${pedido}, mas só há ${livres} livre${livres === 1 ? '' : 's'} neste nicho.`
    : base
}

/**
 * O que aconteceu DEPOIS da puxada.
 *
 * `movidos < solicitados` nao e' erro: o lead pode ter sido assumido por alguem entre a leitura
 * e a escrita, ou os livres podem ter acabado. Dizer o numero REAL e' o unico jeito de a tela
 * nao prometer o que o banco nao entregou.
 */
function resumoDaPuxada(resultado, nomePorId) {
  const r = resultado || {}
  const movidos = Number(r.movidos) || 0
  if (!movidos) {
    return {
      tom: 'neutro',
      texto: 'Nenhum lead foi distribuído — não havia lead livre e intocado neste nicho no momento do envio.',
      detalhes: [],
    }
  }
  const nome = (id) => (nomePorId && nomePorId[String(id)]) || 'sem nome'
  const detalhes = (Array.isArray(r.por_pessoa) ? r.por_pessoa : [])
    .map((p) => `${nome(p.usuario_id)}: ${p.recebidos}`)
  const pedido = Number(r.solicitados) || 0
  const faltou = pedido > movidos
    ? ` Você pediu ${pedido}; os outros ${pedido - movidos} não estavam livres neste momento.`
    : ''
  return {
    tom: 'ok',
    texto: `${movidos} lead${movidos === 1 ? '' : 's'} distribuído${movidos === 1 ? '' : 's'}.${faltou}`,
    detalhes,
  }
}

/**
 * O que aconteceu no REBALANCEAMENTO automatico (ao adicionar alguem a equipe).
 *
 * Devolve `null` quando nada se moveu — e isso e' comum e legitimo (carteira ja equilibrada, ou
 * tudo protegido). Anunciar "0 leads movidos" faria o gestor procurar defeito onde nao ha.
 */
function resumoDoRebalanceamento(distribuicao) {
  const d = distribuicao || {}
  const movidos = Number(d.movidos) || 0
  if (!movidos) return null
  const partes = []
  if (d.de_livres) partes.push(`${d.de_livres} da fila de livres`)
  if (d.entre_membros) partes.push(`${d.entre_membros} remanejado${d.entre_membros === 1 ? '' : 's'} entre a equipe`)
  const detalhe = partes.length ? ` (${partes.join(', ')})` : ''
  const corte = d.truncado
    ? ' O limite por operação foi atingido — use "Puxar mais leads" para terminar.'
    : ''
  return `${movidos} lead${movidos === 1 ? '' : 's'} intocado${movidos === 1 ? '' : 's'} redistribuído${movidos === 1 ? '' : 's'}${detalhe}.${corte}`
}

module.exports = {
  COLUNAS_CARTEIRA,
  valorDaCarteira,
  tomDaCarteira,
  ROTULO_PROTEGIDO,
  rotuloProtegido,
  resumoProtegidos,
  avisoDesequilibrio,
  avisoSemDisponiveis,
  CRITERIOS,
  MODOS_DISTRIBUICAO,
  QUANTIDADE_PADRAO,
  opcaoValida,
  validarPuxada,
  previaDaPuxada,
  resumoDaPuxada,
  resumoDoRebalanceamento,
}
