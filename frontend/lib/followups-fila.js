'use strict'
// Fila UNICA de Follow-ups — normalizacao, filtro e ordenacao de APRESENTACAO.
//
// Regra de ouro (mesma de `lib/prospeccao-listagem.js` e `lib/pendencias-instancia.js`):
// este modulo NAO decide regra de negocio. Quem decide qual e a proxima acao humana, a
// prioridade (score/temperatura) e a janela recomendada e o backend
// (`services/followup-call-score.js`); quem decide o estado de um follow-up automatico e
// o motor (`followup-auto.js`). Aqui so se junta o que as duas fontes ja disseram, numa
// lista que o operador percorre de cima para baixo.
//
// Tres decisoes de modelagem que valem a leitura:
//
// 1. UMA LINHA POR CONVERSA, nao por registro. `GET /call-list` devolve a proxima acao
//    humana de um lead e `GET /auto` devolve os agendamentos automaticos DELE — os dois
//    falam do mesmo atendimento. Mostrar as duas coisas em linhas separadas recriaria,
//    dentro da fila unica, a fragmentacao que as abas causavam. Quando ha acao humana
//    pendente, e ELA a proxima acao da linha; o automatico vira contexto do item.
//
// 2. ORIGEM E ATRIBUTO, NAO ABA. "Atendimento humano" e "Atendimento IA" sao filtros
//    sobre a mesma fila. Uma linha que tem as duas coisas aparece nos dois filtros — e
//    verdade, nao duplicidade.
//
// 3. PRIORIDADE SO EXISTE ONDE O BACKEND CALCULOU. Item que so tem follow-up automatico
//    nao tem call score; a tela mostra "prioridade nao calculada" em vez de inventar uma
//    faixa. Numero errado numa fila de trabalho custa mais caro que numero ausente.
//
// Sem React, sem rede, sem DOM: testavel com `node --test`.
//
// A PAGINACAO nao mora aqui: o dono e' `lib/paginacao.js` (o mesmo da Aquisicao e da fila
// da Central de Ligacoes). Ela e' apenas REEXPORTADA, para a tela importar de um lugar so.
//
// A IDENTIDADE do lead (o que e nome de verdade, como se formata telefone, qual e o rotulo
// visivel) tambem nao mora aqui: o dono e' `lib/lead-identidade.js`, o mesmo que o painel de
// conversa usa. Duas copias fariam a mesma conversa aparecer com um nome na fila e outro no
// painel aberto a partir dela.
//
// O VOCABULARIO da entidade follow-up (canal, origem, status, prioridade, prazo legivel) e'
// de `lib/follow-up-acao.js`, e tambem so' e' reexportado daqui.
//
// TERCEIRA FONTE (migration 062): alem da recomendacao humana e do agendamento do motor, a
// fila le agora os follow-ups PERSISTIDOS — a proxima acao que uma pessoa registrou, com
// canal, prazo, prioridade, responsavel, status e origem. Precedencia declarada:
//
//     follow-up registrado  >  recomendacao do call score  >  agendamento do motor
//
// Uma decisao tomada por uma PESSOA vence uma recomendacao CALCULADA. Quando o contato ja tem
// follow-up em aberto, a recomendacao heuristica NAO vira uma segunda linha: ela vira o
// "por que agora" daquele item. Sem essa regra o mesmo contato apareceria duas vezes — que e'
// exatamente a fragmentacao que a fila unica existe para acabar.
//
// A granularidade muda num unico caso, de proposito: havendo follow-up registrado, a linha e'
// por CONTATO **e CANAL**. "Ligar na sexta" e "mandar mensagem amanha" sao dois trabalhos,
// feitos em duas telas — junta-los esconderia um dos dois.
const {
  TAMANHOS_PAGINA, POR_PAGINA_PADRAO, normalizarPorPagina, paginar, resumoIntervalo, mostrarPaginacao,
} = require('./paginacao')
const { digitos, texto, nomeDeVerdade, formatarTelefone, rotuloLead } = require('./lead-identidade')
const {
  PRIORIDADE_LABEL,
  CANAL_LABEL, CANAL_ICONE, CANAL_OPCOES, ORIGEM_LABEL, STATUS_FOLLOWUP_LABEL, PRIORIDADE_OPCOES,
  rotuloCanal, iconeCanal, destinoDoCanal, rotuloOrigem, rotuloStatusFollowUp, rotuloEvento,
  formatarQuando, resumoProximaAcao, sugerirProximaAcao, paraInputLocal, deInputLocal,
  validarProximaAcao, montarPayloadProximaAcao, itemDeFollowUp, contextoDeOrigem,
} = require('./follow-up-acao')

/** Situacao do item na fila. Fechada de proposito — a tela nao inventa estado. */
const SITUACOES = Object.freeze({
  ABERTO: 'aberto',
  AGUARDANDO: 'aguardando',
  FALHA: 'falha',
  CONCLUIDO: 'concluido',
  CANCELADO: 'cancelado',
})

const SITUACAO_LABEL = Object.freeze({
  aberto: 'Em aberto',
  aguardando: 'Aguardando',
  falha: 'Falha',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
})

/** Proxima acao dos itens do automatico (a do humano vem pronta do backend). */
const ACAO_IA_LABEL = Object.freeze({
  aguardar_envio_ia: 'Aguardar envio automático',
  falha_envio_ia: 'Falha no envio automático',
  follow_up_enviado: 'Follow-up enviado',
  follow_up_cancelado: 'Follow-up cancelado',
  // Follow-up REGISTRADO: o rotulo da LINHA e' o texto livre que a pessoa escreveu
  // ("Retomar por WhatsApp amanha"), mas o FILTRO precisa de um rotulo estavel — texto livre
  // como opcao de seletor produziria uma lista diferente a cada carga da fila.
  followup_whatsapp: 'Follow-up por WhatsApp',
  followup_ligacao: 'Follow-up por ligação',
})

const ACAO_POR_STATUS_IA = Object.freeze({
  agendado: 'aguardar_envio_ia',
  falhou: 'falha_envio_ia',
  executado: 'follow_up_enviado',
  cancelado: 'follow_up_cancelado',
})

const SITUACAO_POR_STATUS_IA = Object.freeze({
  agendado: SITUACOES.AGUARDANDO,
  falhou: SITUACOES.FALHA,
  executado: SITUACOES.CONCLUIDO,
  cancelado: SITUACOES.CANCELADO,
})

/** Traducao do veredito de temperatura do backend em faixa de prioridade. */
const PRIORIDADE_POR_TEMPERATURA = Object.freeze({
  quente: 'alta',
  morno: 'media',
  frio: 'baixa',
})

/** Quanto um agendamento pesa na hora de escolher qual representa a conversa. */
const RELEVANCIA_STATUS_IA = Object.freeze({ agendado: 3, falhou: 2, executado: 1, cancelado: 0 })

const PRAZO_ABERTO = Object.freeze(['agora', 'atrasado', 'hoje'])

const PESO_SITUACAO = Object.freeze({ aberto: 0, aguardando: 1, falha: 2, concluido: 3, cancelado: 4 })
const PESO_PRAZO = Object.freeze({ agora: 0, atrasado: 0, hoje: 1, futuro: 2, passado: 3 })

function dataValida(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.valueOf()) ? null : d
}

function mesmoDia(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * Urgencia do prazo de um item que TEM data (os do automatico).
 * `pendente` = ainda vai acontecer (agendado); so nesse caso passado vira ATRASADO —
 * um follow-up ja enviado no mes passado nao esta atrasado, esta feito.
 */
function classificarPrazoData(iso, agora, pendente) {
  const d = dataValida(iso)
  if (!d) return null
  if (mesmoDia(d, agora)) return d.getTime() < agora.getTime() && pendente ? 'atrasado' : 'hoje'
  if (d.getTime() < agora.getTime()) return pendente ? 'atrasado' : 'passado'
  return 'futuro'
}

/**
 * Urgencia do prazo de uma acao humana. A fonte e a chave fechada `janela_quando` que o
 * backend publica junto da frase — a tela NAO interpreta a frase (ver
 * `services/followup-call-score.js`). Sem a chave, o item fica sem prazo em vez de
 * receber um chute.
 */
function classificarPrazoJanela(janelaQuando) {
  if (janelaQuando === 'agora') return 'agora'
  if (janelaQuando === 'hoje') return 'hoje'
  if (janelaQuando === 'proximo_dia_util') return 'futuro'
  return null
}

function rotuloData(iso) {
  const d = dataValida(iso)
  if (!d) return null
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function contextoDoLead(fonte) {
  return [texto(fonte.negocio), texto(fonte.cidade)].filter(Boolean).join(' · ') || null
}

/**
 * Linha secundária da fila (o que a tela MOSTRA sob o rótulo): só a localização, nunca o
 * negócio/nicho — este já apareceu na linha principal (`rotulo`), que também nasce do mesmo
 * `nome`/`negocio` quando não há apelido. Repeti-lo aqui era literalmente o mesmo texto duas
 * vezes na mesma linha, com a cidade colada no fim. `contextoDoLead` continua existindo (e
 * continua usado na BUSCA, que precisa achar por negócio) — só a apresentação muda.
 * Sem coluna de UF na fonte (`lead_profiles`/`prospects` só têm `cidade` texto livre), mostra
 * a cidade como foi cadastrada — não inventa abreviação sem dado para isso.
 */
function localizacaoDoLead(fonte) {
  return texto(fonte && fonte.cidade) || null
}

/** Escolhe qual agendamento representa a conversa e resume o grupo inteiro. */
function resumirAutomaticos(lista) {
  const ordenados = [...lista].sort((a, b) => {
    const peso = (RELEVANCIA_STATUS_IA[b.status] || 0) - (RELEVANCIA_STATUS_IA[a.status] || 0)
    if (peso !== 0) return peso
    const da = dataValida(a.agendado_para || a.executado_em || a.detectado_em)
    const db = dataValida(b.agendado_para || b.executado_em || b.detectado_em)
    return (db ? db.getTime() : 0) - (da ? da.getTime() : 0)
  })
  const principal = ordenados[0]
  return {
    principal,
    total: lista.length,
    // Falha de QUALQUER agendamento da conversa continua visivel mesmo quando outro
    // agendamento (mais relevante) representa a linha — senao o filtro "Falhas" perderia
    // justamente o caso em que ja houve uma nova tentativa.
    temFalha: lista.some((a) => a.status === 'falhou'),
    motivoFalha: texto((lista.find((a) => a.status === 'falhou') || {}).motivo_decisao) || null,
    tentativas: lista.reduce((max, a) => Math.max(max, Number(a.sequencia) || 0), 0),
  }
}

function itemDoAutomatico(grupo, agora, humano) {
  const p = grupo.principal
  const pendente = p.status === 'agendado'
  const iso = p.status === 'executado'
    ? (p.executado_em || p.agendado_para)
    : p.status === 'cancelado'
      ? (p.cancelado_em || p.agendado_para)
      : p.agendado_para
  return {
    ia_id: p.id,
    ia_status: p.status,
    ia_sequencia: Number(p.sequencia) || 0,
    ia_total: grupo.total,
    ia_agendada: pendente,
    ia_data: iso || null,
    ia_data_label: rotuloData(iso),
    tem_falha: grupo.temFalha,
    falha_motivo: grupo.temFalha ? grupo.motivoFalha : null,
    tentativas: grupo.tentativas,
    situacao: SITUACAO_POR_STATUS_IA[p.status] || SITUACOES.AGUARDANDO,
    acao: ACAO_POR_STATUS_IA[p.status] || 'aguardar_envio_ia',
    acao_label: ACAO_IA_LABEL[ACAO_POR_STATUS_IA[p.status]] || 'Aguardar envio automático',
    prazo: iso || null,
    prazo_quando: classificarPrazoData(iso, agora, pendente && !humano),
  }
}

/** Campos "de fila" que todo item tem, para as linhas nao divergirem em forma. */
const CAMPOS_FOLLOWUP_VAZIOS = Object.freeze({
  followup_id: null,
  followup_status: null,
  canal: null,
  origem: null,
  responsavel_id: null,
  responsavel_nome: null,
  campanha_lead_id: null,
  campanha_id: null,
  campanha_nome: null,
  prospect_id: null,
  ligacao_id: null,
  ligacao_resultado: null,
  ligacao_em: null,
  observacao: null,
  resultado_nota: null,
  destino: null,
  localizacao: null,
})

/**
 * Junta as TRES fontes numa fila unica.
 * @param {{humanos?: any[], automaticos?: any[], followups?: any[], agora?: Date}} entrada
 * @returns {any[]} itens normalizados, ja ordenados por urgencia de trabalho.
 */
function montarFila(entrada = {}) {
  const humanos = Array.isArray(entrada.humanos) ? entrada.humanos : []
  const automaticos = Array.isArray(entrada.automaticos) ? entrada.automaticos : []
  const followups = Array.isArray(entrada.followups) ? entrada.followups : []
  const agora = entrada.agora instanceof Date ? entrada.agora : new Date()

  const porNumero = new Map()
  for (const a of automaticos) {
    const chave = texto(a && a.numero)
    if (!chave) continue
    if (!porNumero.has(chave)) porNumero.set(chave, [])
    porNumero.get(chave).push(a)
  }

  const itens = []
  const usados = new Set()

  // --- 1) Follow-ups REGISTRADOS: a decisao de uma pessoa vem primeiro -------------
  // Indexados por DIGITOS porque e essa a identidade canonica do contato (as outras duas
  // fontes chegam com o JID, que nem sempre existe para um lead que so' foi ligado).
  const followupsPorDigitos = new Map()
  const digitosComAcaoAberta = new Set()
  for (const f of followups) {
    const chave = digitos(f && (f.telefone_digitos || f.conversa_numero))
    if (!chave) continue
    if (!followupsPorDigitos.has(chave)) followupsPorDigitos.set(chave, [])
    followupsPorDigitos.get(chave).push(f)
    if (f.status === 'aguardando') digitosComAcaoAberta.add(chave)
  }

  // Contexto das outras duas fontes, para enriquecer o item registrado sem criar 2a linha.
  const humanoPorDigitos = new Map()
  for (const h of humanos) {
    const chave = digitos(h && (h.telefone_digitos || h.numero))
    if (chave && !humanoPorDigitos.has(chave)) humanoPorDigitos.set(chave, h)
  }
  const autoPorDigitos = new Map()
  for (const [numero, lista] of porNumero) {
    const chave = digitos(numero)
    if (chave && !autoPorDigitos.has(chave)) autoPorDigitos.set(chave, { numero, lista })
  }

  for (const f of followups) {
    const chave = digitos(f && (f.telefone_digitos || f.conversa_numero))
    if (!chave) continue
    const base = itemDeFollowUp(f, agora)
    const h = humanoPorDigitos.get(chave) || null
    const autoDoContato = autoPorDigitos.get(chave) || null
    const grupo = autoDoContato ? resumirAutomaticos(autoDoContato.lista) : null
    const ia = grupo ? itemDoAutomatico(grupo, agora, true) : null
    // O JID e' o que abre a conversa. Preferencia: o que o proprio follow-up guardou, depois
    // o da recomendacao humana, depois o do agendamento. Sem nenhum, a conversa ainda nao
    // existe — a tela oferece iniciar, em vez de abrir uma conversa que nao ha.
    const numero = texto(f.conversa_numero) || texto(h && h.numero) || texto(autoDoContato && autoDoContato.numero) || null
    const nome = nomeDeVerdade(f.nome) || nomeDeVerdade(h && h.nome)
    itens.push({
      ...CAMPOS_FOLLOWUP_VAZIOS,
      ...base,
      id: `fu:${f.id}`,
      numero,
      telefone_digitos: chave,
      nome,
      rotulo: rotuloLead({ nome, telefone_digitos: chave, numero }),
      contexto: contextoDoLead({ negocio: f.nome, cidade: f.cidade }) || contextoDoLead(h || {}),
      localizacao: localizacaoDoLead({ cidade: f.cidade }) || localizacaoDoLead(h || {}),
      estagio: texto(h && h.estagio) || null,
      humano: true,
      ia_agendada: !!(ia && ia.ia_agendada),
      origem_label: rotuloOrigem(f.origem) || 'Follow-up',
      acao: `followup_${f.canal}`,
      // A prioridade e a do item registrado (uma pessoa escolheu); o score do call score
      // entra so' como numero de apoio, quando existe.
      prioridade_score: h && Number.isFinite(Number(h.score)) ? Number(h.score) : null,
      // "Por que agora": a recomendacao heuristica deixa de competir e vira explicacao.
      motivo: texto(h && h.motivo) || base.observacao || null,
      orientacao: texto(h && h.orientacao) || null,
      escalado: !!(h && h.escalado === true),
      dias_silencio: Number(h && h.dias_silencio) || 0,
      prompt_preview: (h && h.prompt_preview) || null,
      tentativas: ia ? ia.tentativas : 0,
      tem_falha: f.status === 'falha' || !!(ia && ia.tem_falha),
      falha_motivo: f.status === 'falha' ? base.resultado_nota : (ia ? ia.falha_motivo : null),
      ia_status: ia ? ia.ia_status : null,
      ia_data: ia ? ia.ia_data : null,
      ia_data_label: ia ? ia.ia_data_label : null,
      ia_id: ia ? ia.ia_id : null,
    })
  }

  for (const h of humanos) {
    const numero = texto(h && h.numero)
    if (!numero) continue
    // Ja existe acao registrada para este contato: a recomendacao virou o "por que agora"
    // daquele item, la em cima. Criar a linha aqui duplicaria o contato na fila.
    if (digitosComAcaoAberta.has(digitos(h.telefone_digitos || numero))) {
      if (porNumero.has(numero)) usados.add(numero)
      continue
    }
    const grupo = porNumero.has(numero) ? resumirAutomaticos(porNumero.get(numero)) : null
    if (grupo) usados.add(numero)
    const ia = grupo ? itemDoAutomatico(grupo, agora, true) : null
    const telefoneHumano = texto(h.telefone_digitos) || digitos(numero)
    const nomeHumano = nomeDeVerdade(h.nome)
    itens.push({
      ...CAMPOS_FOLLOWUP_VAZIOS,
      id: `humano:${numero}`,
      numero,
      telefone_digitos: telefoneHumano,
      nome: nomeHumano,
      rotulo: rotuloLead({ nome: nomeHumano, telefone_digitos: telefoneHumano, numero }),
      contexto: contextoDoLead(h),
      localizacao: localizacaoDoLead(h),
      estagio: texto(h.estagio) || null,
      humano: true,
      ia_agendada: !!(ia && ia.ia_agendada),
      origem_label: ia ? 'Humano + IA' : 'Humano',
      // Ha acao humana pendente: e ELA a proxima acao da conversa. O automatico da
      // mesma conversa continua visivel como contexto (selo + data), nao como 2a linha.
      situacao: SITUACOES.ABERTO,
      acao: texto(h.acao_recomendada) || null,
      acao_label: texto(h.acao_label) || null,
      prazo: null,
      prazo_quando: classificarPrazoJanela(h.janela_quando),
      prazo_label: texto(h.janela_recomendada) || null,
      prioridade: PRIORIDADE_POR_TEMPERATURA[h.temperatura] || null,
      prioridade_score: Number.isFinite(Number(h.score)) ? Number(h.score) : null,
      motivo: texto(h.motivo) || null,
      orientacao: texto(h.orientacao) || null,
      escalado: h.escalado === true,
      dias_silencio: Number(h.dias_silencio) || 0,
      prompt_preview: h.prompt_preview || null,
      tentativas: ia ? Math.max(ia.tentativas, Number(h.followups_ignorados) || 0) : (Number(h.followups_ignorados) || 0),
      tem_falha: !!(ia && ia.tem_falha),
      falha_motivo: ia ? ia.falha_motivo : null,
      ia_status: ia ? ia.ia_status : null,
      ia_data: ia ? ia.ia_data : null,
      ia_data_label: ia ? ia.ia_data_label : null,
      ia_id: ia ? ia.ia_id : null,
    })
  }

  for (const [numero, lista] of porNumero) {
    if (usados.has(numero)) continue
    // Mesma regra do bloco humano: o agendamento do motor e' contexto do item registrado,
    // nunca uma segunda linha do mesmo contato.
    if (digitosComAcaoAberta.has(digitos(numero))) continue
    const grupo = resumirAutomaticos(lista)
    const ia = itemDoAutomatico(grupo, agora, false)
    const p = grupo.principal
    const telefoneIa = digitos(numero)
    const nomeIa = nomeDeVerdade(p.nome)
    itens.push({
      ...CAMPOS_FOLLOWUP_VAZIOS,
      id: `ia:${p.id}`,
      numero,
      telefone_digitos: telefoneIa,
      nome: nomeIa,
      rotulo: rotuloLead({ nome: nomeIa, telefone_digitos: telefoneIa, numero }),
      contexto: null,
      estagio: texto(p.estagio) || null,
      humano: false,
      ia_agendada: ia.ia_agendada,
      origem_label: 'IA',
      situacao: ia.situacao,
      acao: ia.acao,
      acao_label: ia.acao_label,
      prazo: ia.prazo,
      prazo_quando: ia.prazo_quando,
      prazo_label: ia.ia_data_label,
      // Agendamento automatico nao passa pelo call score: a tela diz isso, em vez de
      // atribuir uma faixa que ninguem calculou.
      prioridade: null,
      prioridade_score: null,
      motivo: texto(p.motivo_decisao) || null,
      orientacao: null,
      escalado: false,
      dias_silencio: 0,
      prompt_preview: null,
      tentativas: ia.tentativas,
      tem_falha: ia.tem_falha,
      falha_motivo: ia.falha_motivo,
      ia_status: ia.ia_status,
      ia_data: ia.ia_data,
      ia_data_label: ia.ia_data_label,
      ia_id: ia.ia_id,
    })
  }

  return ordenarFila(itens)
}

/** Em aberto = tem trabalho pendente (acao humana ou envio automatico agendado). */
function emAberto(item) {
  return item.situacao === SITUACOES.ABERTO || item.situacao === SITUACOES.AGUARDANDO
}

function ordenarFila(itens) {
  return [...itens].sort((a, b) => {
    const s = (PESO_SITUACAO[a.situacao] ?? 9) - (PESO_SITUACAO[b.situacao] ?? 9)
    if (s !== 0) return s
    const p = (PESO_PRAZO[a.prazo_quando] ?? 2) - (PESO_PRAZO[b.prazo_quando] ?? 2)
    if (p !== 0) return p
    const score = (b.prioridade_score ?? -1) - (a.prioridade_score ?? -1)
    if (score !== 0) return score
    // Desempate pelo rotulo VISIVEL (nome, ou telefone formatado): ordenar por um `nome`
    // que a tela nao mostra produziria uma ordem que o operador nao consegue explicar.
    return String(rotuloLead(a)).localeCompare(String(rotuloLead(b)), 'pt-BR')
  })
}

/**
 * Filtros rapidos. Substituem as abas: a origem virou atributo do item, e nao mais uma
 * fila separada. "Todos" mostra o que esta EM ABERTO — falhas e concluidos ficam nos
 * proprios filtros para nao afogarem a fila de trabalho.
 */
const FILTROS_RAPIDOS = Object.freeze([
  { valor: 'todos', label: 'Todos', descricao: 'Tudo em aberto: próxima ação registrada, ação humana recomendada ou envio automático agendado.' },
  { valor: 'aguardando', label: 'Aguardando', descricao: 'Compromisso com prazo futuro ou envio automático agendado — nada a fazer agora.' },
  { valor: 'hoje', label: 'Próxima ação hoje', descricao: 'Prazo vencido, agora ou ainda hoje.' },
  { valor: 'whatsapp', label: 'WhatsApp', descricao: 'Próxima ação executada na Central de Mensagens.' },
  { valor: 'ligacao', label: 'Ligação', descricao: 'Próxima ação executada na Central de Ligações.' },
  { valor: 'humano', label: 'Atendimento humano', descricao: 'Itens que precisam de uma pessoa.' },
  { valor: 'ia', label: 'Atendimento IA', descricao: 'Itens com follow-up automático agendado.' },
  { valor: 'falhas', label: 'Falhas', descricao: 'Follow-up que falhou. Falha nunca aparece como "aguardando".' },
  { valor: 'concluidos', label: 'Concluídos', descricao: 'Ação já registrada como finalizada.' },
])

const PREDICADO_RAPIDO = Object.freeze({
  todos: (i) => emAberto(i),
  aguardando: (i) => i.situacao === SITUACOES.AGUARDANDO,
  hoje: (i) => emAberto(i) && PRAZO_ABERTO.includes(i.prazo_quando),
  // Canal so' existe onde alguem escolheu um: item derivado (recomendacao heuristica ou
  // agendamento do motor) NAO entra nestes dois filtros, em vez de receber canal presumido.
  whatsapp: (i) => emAberto(i) && i.canal === 'whatsapp',
  ligacao: (i) => emAberto(i) && i.canal === 'ligacao',
  humano: (i) => emAberto(i) && i.humano,
  ia: (i) => emAberto(i) && i.ia_agendada,
  falhas: (i) => i.tem_falha === true,
  concluidos: (i) => i.situacao === SITUACOES.CONCLUIDO,
})

function filtroRapidoValido(valor) {
  return Object.prototype.hasOwnProperty.call(PREDICADO_RAPIDO, valor) ? valor : 'todos'
}

function aplicarFiltroRapido(itens, valor) {
  const predicado = PREDICADO_RAPIDO[filtroRapidoValido(valor)]
  return (Array.isArray(itens) ? itens : []).filter(predicado)
}

/** Estado do filtro avancado. Vazio = criterio nao aplicado. */
const VIEW_PADRAO = Object.freeze({
  busca: '',
  acao: '',
  canal: '',
  prioridade: '',
  // `origem` = ATENDIMENTO (humano | ia): quem cuida do item hoje.
  origem: '',
  // `origemAcao` = o que GEROU a proxima acao (ligacao | mensagem | automacao | manual).
  // Sao perguntas diferentes, entao sao dois campos: junta-las faria "humano" e "ligacao"
  // parecerem alternativas do mesmo eixo, e nao sao.
  origemAcao: '',
  responsavel: '',
  situacao: '',
  dataDe: '',
  dataAte: '',
  tentativasMin: '',
  falhaTexto: '',
})

function inteiroOuNulo(valor) {
  if (valor === '' || valor == null) return null
  const n = Number(valor)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function diaLocal(iso) {
  const d = dataValida(iso)
  if (!d) return null
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

/**
 * Filtro avancado. COMPOE com o filtro rapido (nunca o substitui).
 *
 * Periodo so alcanca item com data REAL — item sem data sai do resultado quando o periodo
 * esta preenchido, porque incluir "sem data" num filtro de data seria mentira. Na linha
 * mesclada a data do automatico vale mesmo quando a proxima acao e humana: a acao humana
 * tem janela recomendada, nao data, e a data agendada continua sendo um fato daquela
 * conversa.
 */
function aplicarAvancado(itens, view = {}) {
  const v = { ...VIEW_PADRAO, ...(view || {}) }
  const busca = texto(v.busca).toLowerCase()
  const buscaDigitos = digitos(v.busca)
  const falha = texto(v.falhaTexto).toLowerCase()
  const tentativasMin = inteiroOuNulo(v.tentativasMin)
  const de = texto(v.dataDe)
  const ate = texto(v.dataAte)

  return (Array.isArray(itens) ? itens : []).filter((i) => {
    if (busca) {
      const alvo = `${rotuloLead(i)} ${i.nome || ''} ${i.contexto || ''}`.toLowerCase()
      const casaTexto = alvo.includes(busca)
      const casaFone = buscaDigitos.length >= 3 && String(i.telefone_digitos || '').includes(buscaDigitos)
      if (!casaTexto && !casaFone) return false
    }
    if (v.acao && i.acao !== v.acao) return false
    if (v.canal && i.canal !== v.canal) return false
    if (v.origemAcao && i.origem !== v.origemAcao) return false
    // 'sem' = nao atribuido, estado legitimo de trabalho — e justamente o recorte que o
    // operador procura quando quer saber o que esta sem dono.
    if (v.responsavel) {
      if (v.responsavel === 'sem') { if (i.responsavel_id) return false }
      else if (i.responsavel_id !== v.responsavel) return false
    }
    if (v.prioridade) {
      if (v.prioridade === 'sem') { if (i.prioridade) return false }
      else if (i.prioridade !== v.prioridade) return false
    }
    if (v.origem === 'humano' && !i.humano) return false
    if (v.origem === 'ia' && !i.ia_status) return false
    if (v.situacao && i.situacao !== v.situacao) return false
    if (tentativasMin != null && (Number(i.tentativas) || 0) < tentativasMin) return false
    if (falha && !String(i.falha_motivo || '').toLowerCase().includes(falha)) return false
    if (de || ate) {
      const dia = diaLocal(i.prazo || i.ia_data)
      if (!dia) return false
      if (de && dia < de) return false
      if (ate && dia > ate) return false
    }
    return true
  })
}

function contarFiltrosAtivos(view = {}) {
  const v = { ...VIEW_PADRAO, ...(view || {}) }
  return Object.keys(VIEW_PADRAO).reduce((n, chave) => (texto(v[chave]) ? n + 1 : n), 0)
}

/** Resumo dos criterios avancados ativos, para os chips da pagina. */
function chipsAtivos(view = {}, rotulosDeAcao = {}, rotulosDeResponsavel = {}) {
  const v = { ...VIEW_PADRAO, ...(view || {}) }
  const chips = []
  if (texto(v.busca)) chips.push(`Busca: ${texto(v.busca)}`)
  if (texto(v.acao)) chips.push(`Ação: ${rotulosDeAcao[v.acao] || ACAO_IA_LABEL[v.acao] || v.acao}`)
  if (texto(v.prioridade)) {
    chips.push(v.prioridade === 'sem' ? 'Prioridade: não calculada' : PRIORIDADE_LABEL[v.prioridade] || `Prioridade: ${v.prioridade}`)
  }
  if (texto(v.canal)) chips.push(`Canal: ${CANAL_LABEL[v.canal] || v.canal}`)
  if (texto(v.origem)) chips.push(`Atendimento: ${v.origem === 'humano' ? 'humano' : 'IA'}`)
  if (texto(v.origemAcao)) chips.push(`Origem: ${ORIGEM_LABEL[v.origemAcao] || v.origemAcao}`)
  if (texto(v.responsavel)) {
    chips.push(v.responsavel === 'sem'
      ? 'Responsável: não atribuído'
      : `Responsável: ${rotulosDeResponsavel[v.responsavel] || v.responsavel}`)
  }
  if (texto(v.situacao)) chips.push(`Status: ${SITUACAO_LABEL[v.situacao] || v.situacao}`)
  if (texto(v.tentativasMin)) chips.push(`Tentativas ≥ ${texto(v.tentativasMin)}`)
  if (texto(v.falhaTexto)) chips.push(`Falha contém: ${texto(v.falhaTexto)}`)
  if (texto(v.dataDe)) chips.push(`Prazo de ${texto(v.dataDe)}`)
  if (texto(v.dataAte)) chips.push(`Prazo até ${texto(v.dataAte)}`)
  return chips
}

/** Contagem de cada filtro rapido sobre o conjunto JA filtrado pelo avancado. */
function contagensRapidas(itens) {
  const lista = Array.isArray(itens) ? itens : []
  const saida = {}
  for (const f of FILTROS_RAPIDOS) saida[f.valor] = lista.filter(PREDICADO_RAPIDO[f.valor]).length
  return saida
}

/**
 * Opcoes do seletor "Próxima ação" — derivadas dos itens presentes, nunca de uma lista
 * paralela. O vocabulario de acao humana e do backend; duplica-lo aqui criaria uma
 * segunda fonte de verdade que envelheceria em silencio.
 */
function opcoesDeAcao(itens) {
  const mapa = new Map()
  for (const i of Array.isArray(itens) ? itens : []) {
    if (!i.acao) continue
    // Rotulo ESTAVEL primeiro: o `acao_label` de um follow-up registrado e' texto livre.
    if (!mapa.has(i.acao)) mapa.set(i.acao, ACAO_IA_LABEL[i.acao] || texto(i.acao_label) || i.acao)
  }
  return [...mapa.entries()]
    .map(([valor, label]) => ({ valor, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
}

/** Frase do cabecalho. Sem itens em aberto nao ha fila — e isso e uma boa noticia. */
function resumoFila(contagens) {
  const abertos = Number(contagens && contagens.todos) || 0
  const hoje = Number(contagens && contagens.hoje) || 0
  if (!abertos) return 'Nada em aberto agora. Os concluídos e as falhas continuam nos filtros ao lado.'
  const plural = abertos === 1 ? 'item em aberto' : 'itens em aberto'
  return hoje
    ? `${abertos} ${plural} · ${hoje} com prazo para hoje.`
    : `${abertos} ${plural} · nenhum com prazo para hoje.`
}

/** Texto acessivel da bolinha de prioridade (title + nome acessivel). */
function descricaoPrioridade(item) {
  if (!item || !item.prioridade) return 'Prioridade não calculada — item do automático, sem call score.'
  const base = PRIORIDADE_LABEL[item.prioridade] || 'Prioridade'
  return item.prioridade_score == null ? base : `${base} (${item.prioridade_score} de 100)`
}

/** Opcoes do seletor de responsavel, derivadas dos itens presentes (nunca de lista paralela). */
function opcoesDeResponsavel(itens) {
  const mapa = new Map()
  let temSemDono = false
  for (const i of Array.isArray(itens) ? itens : []) {
    if (!i.followup_id) continue
    if (!i.responsavel_id) { temSemDono = true; continue }
    if (!mapa.has(i.responsavel_id)) mapa.set(i.responsavel_id, texto(i.responsavel_nome) || 'Sem nome')
  }
  const lista = [...mapa.entries()]
    .map(([valor, label]) => ({ valor, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
  return temSemDono ? [{ valor: 'sem', label: 'Não atribuído' }, ...lista] : lista
}

module.exports = {
  SITUACOES,
  SITUACAO_LABEL,
  ACAO_IA_LABEL,
  PRIORIDADE_LABEL,
  FILTROS_RAPIDOS,
  opcoesDeResponsavel,
  // Reexportados de ./follow-up-acao — o MESMO vocabulario que a Central de Ligacoes usa.
  CANAL_LABEL, CANAL_ICONE, CANAL_OPCOES, ORIGEM_LABEL, STATUS_FOLLOWUP_LABEL, PRIORIDADE_OPCOES,
  rotuloCanal, iconeCanal, destinoDoCanal, rotuloOrigem, rotuloStatusFollowUp, rotuloEvento,
  formatarQuando, resumoProximaAcao, sugerirProximaAcao, paraInputLocal, deInputLocal,
  validarProximaAcao, montarPayloadProximaAcao, itemDeFollowUp, contextoDeOrigem,
  VIEW_PADRAO,
  montarFila,
  ordenarFila,
  emAberto,
  filtroRapidoValido,
  aplicarFiltroRapido,
  aplicarAvancado,
  contarFiltrosAtivos,
  chipsAtivos,
  contagensRapidas,
  opcoesDeAcao,
  resumoFila,
  descricaoPrioridade,
  classificarPrazoData,
  classificarPrazoJanela,
  // Reexportados de ./lead-identidade — a MESMA identidade que o painel de conversa usa.
  nomeDeVerdade,
  formatarTelefone,
  rotuloLead,
  // Reexportados de ./paginacao — mesma aritmetica da Aquisicao e da Central de Ligacoes.
  TAMANHOS_PAGINA, POR_PAGINA_PADRAO, normalizarPorPagina, paginar, resumoIntervalo, mostrarPaginacao,
}
