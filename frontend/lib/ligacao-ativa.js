'use strict'
// Apresentacao PURA da ligacao ATIVA de outra pessoa (modo Acompanhar) na Central de
// Ligacoes. Como `lib/site-rotulos.js` e `lib/pontuacao-indicador.js`, aqui so' se TRADUZ o
// veredito que a API mandou: quem decide se a ligacao existe, em que estado esta e se e' do
// usuario logado (`sou_eu`) e' o backend — o front nao compara id de usuario, nao deduz dono
// por nome e nao re-deriva `estado_sessao`.
//
// Regra de produto que este modulo encarna:
//   sem ligacao ativa                      -> "Ligar"       (comportamento de sempre)
//   ligacao ativa e ela e' MINHA           -> "Retomar"     (mesmo comportamento: POST /iniciar
//                                                            e' idempotente e devolve a minha)
//   ligacao ativa de OUTRA pessoa          -> "Acompanhar"  (visao SOMENTE LEITURA)
//
// `aguardando_resumo` (chamada encerrada, resumo pendente) tambem ocupa o lead: no banco ele
// e' o MESMO status 'em_andamento' e ainda impede uma segunda sessao.

/** @typedef {{ id: string, campanha_lead_id: string|null, prospect_id: string|null,
 *   estado_sessao: 'em_andamento'|'aguardando_resumo', iniciada_em: string|null,
 *   chamada_encerrada_em: string|null, usuario_id: string|null, usuario_nome: string|null,
 *   sou_eu: boolean, mesma_sessao: boolean|null,
 *   sessao_dispositivo: 'computador'|'celular'|null }} LigacaoAtiva */

/** @typedef {{ id: string, status: string, estado_sessao: string, viva: boolean,
 *   desfecho: 'encerrada'|'descartada'|null, sou_eu: boolean, mesma_sessao: boolean|null,
 *   usuario_nome: string|null, sessao_dispositivo: 'computador'|'celular'|null,
 *   chamada_encerrada_em: string|null, iniciada_em: string|null }} SessaoLigacao */

const ACAO = Object.freeze({ LIGAR: 'ligar', RETOMAR: 'retomar', ACOMPANHAR: 'acompanhar' })

/** Nome do aparelho em texto. Vocabulario FECHADO — nada de modelo, sistema ou versao. */
const APARELHO = Object.freeze({ computador: 'no computador', celular: 'no celular' })

/**
 * De ONDE partiu a ultima acao desta ligacao, em texto, ou '' quando nao da' para dizer.
 *
 * So' faz sentido operacional quando NAO foi nesta mesma tela: dizer "no computador" para
 * quem esta olhando o computador e' ruido. O caso que importa e' o oposto — a acao veio do
 * outro aparelho da mesma conta, que e' exatamente a surpresa que este modulo existe para
 * explicar. `mesma_sessao === null` (origem nao registrada dos dois lados) tambem devolve '':
 * na duvida nao se afirma aparelho.
 */
function rotuloAparelho(item) {
  if (!item || item.mesma_sessao !== false) return ''
  return APARELHO[item.sessao_dispositivo] || 'em outro aparelho'
}

/** Indexa a resposta de `GET /ligacoes/ativas` por lead da campanha. */
function indexarAtivasPorLead(itens) {
  const mapa = {}
  for (const it of Array.isArray(itens) ? itens : []) {
    if (it && it.campanha_lead_id) mapa[String(it.campanha_lead_id)] = it
  }
  return mapa
}

/** Quem esta na ligacao, em texto. Nome so' quando o backend mandou um. */
function rotuloOperador(ativa) {
  if (!ativa) return ''
  if (ativa.sou_eu) return 'você'
  const nome = String(ativa.usuario_nome || '').trim()
  return nome || 'outro operador'
}

/**
 * Acao que a linha oferece. `somenteLeitura` e' o que a tela usa para abrir a operacao em
 * modo Acompanhar — nunca uma comparacao de id feita aqui.
 */
function acaoDoLead(ativa) {
  if (!ativa) {
    return { acao: ACAO.LIGAR, rotulo: 'Ligar', somenteLeitura: false, titulo: 'Abrir a operação e ligar para este lead.' }
  }
  if (ativa.sou_eu) {
    // "em outra aba ou aparelho" era o melhor que dava para dizer sem saber a origem. Com ela,
    // a frase passa a nomear o aparelho quando ele é OUTRO — e continua vaga quando não há
    // prova, em vez de chutar.
    const onde = rotuloAparelho(ativa)
    return {
      acao: ACAO.RETOMAR,
      rotulo: 'Retomar',
      somenteLeitura: false,
      titulo: ativa.estado_sessao === 'aguardando_resumo'
        ? `Você tem um resumo pendente desta ligação${onde ? ` (aberta ${onde})` : ''}. Abrir para concluir.`
        : `Você já está nesta ligação${onde ? ` — ${onde}` : ' (em outra aba ou aparelho)'}. Abrir para continuar.`,
    }
  }
  return {
    acao: ACAO.ACOMPANHAR,
    rotulo: 'Acompanhar',
    somenteLeitura: true,
    titulo: `${rotuloOperador(ativa)} está nesta ligação. Abrir em modo somente leitura — você não pode registrar nem encerrar.`,
  }
}

/**
 * Selo "Em ligação agora" da listagem. Texto explicito (cor nunca e' o unico sinal) e com
 * QUEM esta na ligacao, que e' a informacao que faltava para duas pessoas na mesma conta.
 */
function seloLigacaoAtiva(ativa) {
  if (!ativa) return null
  const quem = rotuloOperador(ativa)
  if (ativa.estado_sessao === 'aguardando_resumo') {
    return {
      texto: `Resumo pendente · ${quem}`,
      titulo: `A chamada terminou e ${ativa.sou_eu ? 'você ainda não salvou' : `${quem} ainda não salvou`} o resumo. O lead segue ocupado até isso acontecer.`,
      proprio: !!ativa.sou_eu,
    }
  }
  const onde = rotuloAparelho(ativa)
  return {
    texto: `Em ligação agora · ${quem}`,
    titulo: ativa.sou_eu
      ? `Você iniciou esta ligação${onde ? ` ${onde}` : ' (em outra aba ou aparelho)'}.`
      : `${quem} está falando com este lead agora${onde ? `, ${onde}` : ''}.`,
    proprio: !!ativa.sou_eu,
  }
}

/**
 * Proximo lead a quem o botao global "Ligar agora" deve levar: o primeiro da fila que NAO
 * esta em ligacao de outra pessoa. Ligacao PROPRIA nao faz pular — retomar a minha e' o
 * comportamento esperado.
 *
 * Pular (em vez de abrir em modo Acompanhar) e' deliberado: "Ligar agora" e' um comando de
 * TRABALHO, e escolher o proximo e' exatamente o que ele faz. Abrir uma tela de observacao
 * seria um efeito surpreendente; e comecar a falar com um lead que ja esta ao telefone com um
 * colega e' o unico desfecho que atinge o CLIENTE.
 */
function proximoLigavel(lista, ativasPorLead) {
  const mapa = ativasPorLead || {}
  for (const item of Array.isArray(lista) ? lista : []) {
    const ativa = item && mapa[String(item.campanha_lead_id)]
    if (!ativa || ativa.sou_eu) return item
  }
  return null
}

/** Quantos leads da fila visivel estao ocupados por OUTRA pessoa (aviso do botao global). */
function contarOcupadosPorOutros(lista, ativasPorLead) {
  const mapa = ativasPorLead || {}
  let n = 0
  for (const item of Array.isArray(lista) ? lista : []) {
    const ativa = item && mapa[String(item.campanha_lead_id)]
    if (ativa && !ativa.sou_eu) n += 1
  }
  return n
}

// ─────────────────────── Estado TERMINAL vindo de outra sessão ───────────────────────
// A mesma conta em dois aparelhos significa que a ligação pode terminar longe da tela que
// está aberta — inclusive para quem a iniciou (encerra no celular, o computador continua com
// o cronômetro correndo). O backend é a fonte: `GET /ligacoes/:id/sessao` devolve `viva` e
// `desfecho` prontos, e este módulo só TRADUZ.

/**
 * A sessão terminou? Lê o `viva` publicado pelo servidor — a tela nunca deduz o fim a partir
 * de status + chamada_encerrada_em (essa derivação tem dono, e é no backend).
 */
function sessaoTerminou(sessao) {
  return !!sessao && sessao.viva === false
}

// NÃO existe aqui um `terminouEmOutraSessao(sessao)`, e a ausência é deliberada: `mesma_sessao`
// identifica o APARELHO (a unidade que o operador reconhece — "foi no celular"), então duas
// abas do mesmo computador têm a MESMA origem. Quem sabe se foi "esta tela" é a própria tela,
// pelo que ela mesma acabou de fazer. Uma função pura respondendo isso a partir do payload
// deixaria a segunda aba sem aviso nenhum — exatamente o defeito que esta entrega corrige.

/**
 * O que a tela diz quando descobre um desfecho remoto. `encerrada` e `descartada` NÃO podem
 * receber o mesmo texto: a primeira virou registro (entra na analítica e no histórico do
 * lead), a segunda não ficou em lugar nenhum — e quem estava preenchendo o resumo precisa
 * saber qual das duas aconteceu com o trabalho dele.
 *
 * `operando = true` acrescenta a consequência para quem estava escrevendo. Sem isso a tela
 * some com o formulário e a pessoa fica sem entender para onde foi o que digitou.
 */
function descreverDesfechoRemoto(sessao, { operando = false } = {}) {
  if (!sessaoTerminou(sessao)) return null
  const quem = rotuloOperador(sessao) || 'outro operador'
  const onde = rotuloAparelho(sessao)
  const sufixo = onde ? ` ${onde}` : ''
  const descartada = sessao.desfecho === 'descartada'
  return {
    desfecho: sessao.desfecho || 'encerrada',
    titulo: descartada ? 'Operação descartada em outra sessão' : 'Ligação encerrada em outra sessão',
    detalhe: descartada
      ? `${quem} descartou esta operação${sufixo}. Ela fica só para auditoria — não entra nas métricas nem no histórico do lead.`
      : `${quem} encerrou esta ligação${sufixo}. O registro já está no histórico do lead e nas métricas da campanha.`,
    // Dito só para quem estava operando: é a única pessoa que pode ter algo digitado na tela.
    aviso: operando
      ? 'O resumo aberto aqui não pode mais ser salvo — a ligação já foi fechada no servidor.'
      : '',
    tom: descartada ? 'atencao' : 'neutro',
  }
}

/**
 * Leads que SAÍRAM do conjunto de ligações ativas entre dois tiques do polling — ou seja,
 * ligações que terminaram enquanto a listagem estava aberta.
 *
 * Existe porque o selo sozinho não basta: encerrar uma ligação também muda o status da
 * oportunidade e as tentativas do lead, e a fila continuaria mostrando o estado velho até
 * alguém trocar de campanha. Isto diz à tela QUANDO vale a pena recarregar a fila — nunca a
 * cada tique.
 *
 * `avisar` é mais estreito que `saidas`: a reconciliação acontece sempre, mas o aviso ao
 * operador só sai quando a ligação NÃO era desta sessão. Avisar sobre a ligação que a própria
 * pessoa acabou de encerrar nesta tela seria ruído garantido a cada encerramento.
 */
function saidasDaFila(antes, depois) {
  const a = antes || {}
  const d = depois || {}
  const saidas = []
  let avisar = false
  for (const leadId of Object.keys(a)) {
    if (d[leadId]) continue
    const item = a[leadId]
    saidas.push(leadId)
    // `mesma_sessao === true` ⇒ foi aqui, e a tela já reagiu no próprio clique.
    if (item && item.mesma_sessao !== true) avisar = true
  }
  return { saidas, avisar }
}

module.exports = {
  ACAO, APARELHO,
  indexarAtivasPorLead, rotuloOperador, rotuloAparelho, acaoDoLead, seloLigacaoAtiva,
  proximoLigavel, contarOcupadosPorOutros,
  sessaoTerminou, descreverDesfechoRemoto, saidasDaFila,
}
