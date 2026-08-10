'use strict'
// Vocabulário de APRESENTAÇÃO da próxima ação (a entidade `app.follow_ups`, migration 062).
//
// Regra de ouro deste projeto, repetida aqui: o front TRADUZ o veredito do backend, nunca
// recalcula a regra. Quem decide canal, prazo, prioridade, status e origem é o backend
// (`services/follow-up-modelo.js`); este módulo só sabe transformar isso em texto, ordem e
// destino de navegação.
//
// Este é o DONO do vocabulário da entidade. `lib/followups-fila.js` importa daqui e
// reexporta — o mesmo padrão de `lib/paginacao.js` e `lib/lead-identidade.js`. Duas cópias
// fariam o mesmo follow-up aparecer com um rótulo na fila e outro na tela de ligações.
//
// Sem React, sem rede, sem DOM: testável com `node --test`.

/** Por onde a ação é executada. Ícone textual porque cor nunca é a única informação. */
const CANAL_LABEL = Object.freeze({ whatsapp: 'WhatsApp', ligacao: 'Ligação' })
const CANAL_ICONE = Object.freeze({ whatsapp: '💬', ligacao: '📞' })

/**
 * QUAL TELA EXECUTA o item — a regra de roteamento do fluxo, num lugar só.
 * Espelha `telaExecutora` do backend; o teste trava os dois valores.
 */
const DESTINO_POR_CANAL = Object.freeze({
  whatsapp: 'central_mensagens',
  ligacao: 'central_ligacoes',
})

/** O que gerou a ação. É contexto do item, nunca uma aba. */
const ORIGEM_LABEL = Object.freeze({
  ligacao: 'Ligação',
  mensagem: 'Mensagem',
  automacao: 'Automação',
  manual: 'Criado manualmente',
})

const STATUS_FOLLOWUP_LABEL = Object.freeze({
  aguardando: 'Aguardando',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
  falha: 'Falha',
})

const PRIORIDADE_LABEL = Object.freeze({
  alta: 'Prioridade alta',
  media: 'Prioridade média',
  baixa: 'Prioridade baixa',
})

const PRIORIDADE_OPCOES = Object.freeze([
  { valor: 'alta', label: 'Alta' },
  { valor: 'media', label: 'Média' },
  { valor: 'baixa', label: 'Baixa' },
])

/**
 * Opções da etapa "Próxima ação" do encerramento da ligação.
 * `nenhuma` é a PRIMEIRA e é uma resposta legítima — não um default escondido. Sem ela, o
 * formulário empurraria o operador a inventar um compromisso para conseguir salvar.
 */
const CANAL_OPCOES = Object.freeze([
  { valor: 'nenhuma', label: 'Sem próxima ação', ajuda: 'A ligação é registrada e nada entra na fila de follow-ups.' },
  { valor: 'whatsapp', label: 'WhatsApp', ajuda: 'Entra na fila e é executado na Central de Mensagens.' },
  { valor: 'ligacao', label: 'Nova ligação', ajuda: 'Entra na fila e é executado na Central de Ligações.' },
])

function texto(v) {
  return typeof v === 'string' ? v.trim() : (v == null ? '' : String(v).trim())
}

function rotuloCanal(canal) {
  return CANAL_LABEL[canal] || null
}

function iconeCanal(canal) {
  return CANAL_ICONE[canal] || null
}

function destinoDoCanal(canal) {
  return DESTINO_POR_CANAL[canal] || null
}

function rotuloOrigem(origem) {
  return ORIGEM_LABEL[origem] || null
}

function rotuloStatusFollowUp(status) {
  return STATUS_FOLLOWUP_LABEL[status] || null
}

function dataValida(iso) {
  if (!iso) return null
  const d = iso instanceof Date ? iso : new Date(iso)
  return Number.isNaN(d.valueOf()) ? null : d
}

function mesmoDia(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * "hoje às 10:00" / "amanhã às 10:00" / "12/08 às 10:00".
 * O prazo é o que o operador lê primeiro; uma data absoluta para "amanhã" obriga a fazer
 * conta de cabeça a cada linha da fila.
 */
function formatarQuando(iso, agora = new Date()) {
  const d = dataValida(iso)
  if (!d) return null
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const amanha = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1)
  const ontem = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - 1)
  if (mesmoDia(d, agora)) return `hoje às ${hora}`
  if (mesmoDia(d, amanha)) return `amanhã às ${hora}`
  if (mesmoDia(d, ontem)) return `ontem às ${hora}`
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${hora}`
}

/** Urgência do prazo de um item PERSISTIDO. Só é "atrasado" o que ainda está em aberto. */
function classificarPrazoFollowUp(iso, agora = new Date(), aberto = true) {
  const d = dataValida(iso)
  if (!d) return null
  if (mesmoDia(d, agora)) return d.getTime() < agora.getTime() && aberto ? 'atrasado' : 'hoje'
  if (d.getTime() < agora.getTime()) return aberto ? 'atrasado' : 'passado'
  return 'futuro'
}

/**
 * Resumo curto da próxima ação — é TUDO o que a Central de Ligações mostra sobre ela.
 * A Central de Ligações não vira fila de mensagens: ela diz o que foi combinado e oferece o
 * caminho para o item; quem gerencia a fila é a tela de Follow-ups.
 */
function resumoProximaAcao(followUp, agora = new Date()) {
  if (!followUp || !followUp.canal) return null
  const canal = rotuloCanal(followUp.canal)
  const quando = formatarQuando(followUp.agendado_para, agora)
  const acao = texto(followUp.proxima_acao)
  const partes = [canal, quando].filter(Boolean).join(' ')
  return acao ? `${acao} — ${partes}` : `Próxima ação: ${partes}`
}

/**
 * Sugestão de próxima ação a partir do RESULTADO da chamada. É sugestão, não decisão: todos
 * os campos continuam editáveis, e "Sem próxima ação" continua a um clique. Existe para o
 * caso comum não exigir digitação — não para escolher pelo operador.
 */
const SUGESTAO_POR_RESULTADO = Object.freeze({
  atendeu: { canal: 'whatsapp', proxima_acao: 'Retomar por WhatsApp', prioridade: 'media', horas: 24 },
  nao_atendeu: { canal: 'ligacao', proxima_acao: 'Ligar novamente', prioridade: 'media', horas: 24 },
  caixa_postal: { canal: 'ligacao', proxima_acao: 'Ligar novamente', prioridade: 'media', horas: 24 },
  ocupado: { canal: 'ligacao', proxima_acao: 'Ligar novamente', prioridade: 'alta', horas: 4 },
  reagendou: { canal: 'ligacao', proxima_acao: 'Ligar no horário combinado', prioridade: 'alta', horas: 24 },
  // Número inválido não gera próxima ação: não há para onde ligar nem para onde escrever.
  numero_invalido: { canal: 'nenhuma', proxima_acao: '', prioridade: 'media', horas: 0 },
})

function sugerirProximaAcao(resultado, agora = new Date()) {
  const s = SUGESTAO_POR_RESULTADO[resultado] || { canal: 'nenhuma', proxima_acao: '', prioridade: 'media', horas: 24 }
  return {
    canal: s.canal,
    proxima_acao: s.proxima_acao,
    prioridade: s.prioridade,
    agendado_para: s.canal === 'nenhuma' ? '' : paraInputLocal(new Date(agora.getTime() + s.horas * 3600 * 1000)),
    responsavel_id: '',
  }
}

/**
 * `<input type="datetime-local">` fala horário LOCAL sem fuso, e `toISOString()` devolve UTC.
 * Converter errado aqui desloca todo compromisso em 3 horas — em produção isso vira ligação
 * na hora errada, não bug de tela.
 */
function paraInputLocal(data) {
  const d = dataValida(data)
  if (!d) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Caminho inverso: o valor do input local vira instante absoluto (ISO com fuso). */
function deInputLocal(valor) {
  const t = texto(valor)
  if (!t) return null
  const d = new Date(t)
  return Number.isNaN(d.valueOf()) ? null : d.toISOString()
}

/**
 * Valida a etapa "Próxima ação" ANTES de enviar. A validação de verdade é a do backend
 * (fonte única); esta existe só para o operador não perder o resumo inteiro num 400.
 */
function validarProximaAcao(form = {}) {
  const erros = {}
  const canal = texto(form.canal) || 'nenhuma'
  if (canal === 'nenhuma') return { ok: true, erros }
  if (!CANAL_LABEL[canal]) erros.canal = 'Escolha WhatsApp, nova ligação ou "sem próxima ação".'
  if (!texto(form.proxima_acao)) erros.proxima_acao = 'Descreva o que precisa ser feito.'
  const quando = deInputLocal(form.agendado_para)
  if (!quando) erros.agendado_para = 'Informe a data e a hora.'
  if (form.prioridade && !PRIORIDADE_LABEL[form.prioridade]) erros.prioridade = 'Prioridade inválida.'
  return { ok: Object.keys(erros).length === 0, erros }
}

/**
 * Monta o bloco `follow_up` do encerramento. Devolve `null` para "sem próxima ação" — e é
 * `null` mesmo, não um objeto vazio: o backend trata ausência como "nada a criar".
 */
function montarPayloadProximaAcao(form = {}) {
  const canal = texto(form.canal) || 'nenhuma'
  if (canal === 'nenhuma') return null
  return {
    canal,
    proxima_acao: texto(form.proxima_acao),
    agendado_para: deInputLocal(form.agendado_para),
    prioridade: texto(form.prioridade) || 'media',
    responsavel_id: texto(form.responsavel_id) || null,
  }
}

/**
 * Normaliza um follow-up PERSISTIDO no formato de item da fila.
 *
 * Duas decisões que valem a leitura:
 *
 * 1. `aguardando` com prazo no FUTURO fica na situação "aguardando"; com prazo vencido, hoje
 *    ou agora, vira "aberto". É a diferença entre "tem um compromisso marcado" e "precisa ser
 *    feito" — sem ela, um follow-up para o mês que vem disputaria espaço com o trabalho de
 *    hoje no topo da fila.
 * 2. A prioridade vem gravada no item (uma pessoa escolheu), então ela SEMPRE existe aqui —
 *    ao contrário do item do automático, que nunca passou pelo call score.
 */
function itemDeFollowUp(f, agora = new Date()) {
  const aberto = f.status === 'aguardando'
  const prazoQuando = classificarPrazoFollowUp(f.agendado_para, agora, aberto)
  const situacao = !aberto
    ? (f.status === 'concluido' ? 'concluido' : f.status === 'cancelado' ? 'cancelado' : 'falha')
    : (prazoQuando === 'futuro' ? 'aguardando' : 'aberto')
  return {
    followup_id: f.id,
    followup_status: f.status,
    canal: f.canal,
    origem: f.origem,
    responsavel_id: f.responsavel_id || null,
    responsavel_nome: texto(f.responsavel_nome) || null,
    campanha_lead_id: f.campanha_lead_id || null,
    // O id da CAMPANHA acompanha o do lead: sem ele o botao "Ir para a ligacao" nao
    // conseguiria abrir a fila certa, e a Central de Ligacoes so' trabalha por campanha.
    campanha_id: f.campanha_id || null,
    campanha_nome: texto(f.campanha_nome) || null,
    prospect_id: f.prospect_id || null,
    ligacao_id: f.ligacao_id || null,
    ligacao_resultado: texto(f.ligacao_resultado) || null,
    ligacao_em: f.ligacao_em || null,
    conversa_numero: texto(f.conversa_numero) || null,
    observacao: texto(f.observacao) || null,
    resultado_nota: texto(f.resultado_nota) || null,
    situacao,
    prazo: f.agendado_para || null,
    prazo_quando: prazoQuando,
    prazo_label: formatarQuando(f.agendado_para, agora),
    prioridade: PRIORIDADE_LABEL[f.prioridade] ? f.prioridade : null,
    acao_label: texto(f.proxima_acao) || null,
    destino: destinoDoCanal(f.canal),
  }
}

/**
 * Contexto de origem passado ao painel de conversa quando o item é aberto pela fila.
 * São DADOS, não uma requisição: o painel é o mesmo nas duas portas de entrada e não pode
 * depender de uma rota admin-only que a Central de Mensagens não tem permissão de chamar.
 */
function contextoDeOrigem(item, agora = new Date()) {
  if (!item || !item.followup_id) return null
  const linhas = []
  if (item.acao_label) linhas.push(item.acao_label)
  const quando = item.prazo_label || formatarQuando(item.prazo, agora)
  if (quando) linhas.push(`Prazo: ${quando}`)
  if (item.ligacao_resultado) {
    const data = item.ligacao_em ? formatarQuando(item.ligacao_em, agora) : null
    linhas.push(`Veio da ligação${data ? ` de ${data}` : ''} — resultado: ${item.ligacao_resultado}`)
  } else if (item.origem) {
    linhas.push(`Origem: ${rotuloOrigem(item.origem)}`)
  }
  if (item.campanha_nome) linhas.push(`Campanha: ${item.campanha_nome}`)
  if (item.responsavel_nome) linhas.push(`Responsável: ${item.responsavel_nome}`)
  if (item.observacao) linhas.push(item.observacao)
  return { titulo: `Follow-up por ${rotuloCanal(item.canal) || 'WhatsApp'}`, linhas }
}

/** Rótulos dos eventos da linha do tempo do contato (`GET /contatos/:telefone/historico`). */
const EVENTO_LABEL = Object.freeze({
  ligacao_encerrada: 'Ligação encerrada',
  ligacao_registrada: 'Ligação registrada',
  followup_criado: 'Follow-up criado',
  followup_concluido: 'Follow-up concluído',
  followup_cancelado: 'Follow-up cancelado',
  followup_falha: 'Follow-up com falha',
})

function rotuloEvento(tipo) {
  return EVENTO_LABEL[tipo] || 'Evento'
}

module.exports = {
  CANAL_LABEL,
  CANAL_ICONE,
  CANAL_OPCOES,
  ORIGEM_LABEL,
  STATUS_FOLLOWUP_LABEL,
  PRIORIDADE_LABEL,
  PRIORIDADE_OPCOES,
  DESTINO_POR_CANAL,
  EVENTO_LABEL,
  rotuloCanal,
  iconeCanal,
  destinoDoCanal,
  rotuloOrigem,
  rotuloStatusFollowUp,
  rotuloEvento,
  formatarQuando,
  classificarPrazoFollowUp,
  resumoProximaAcao,
  sugerirProximaAcao,
  paraInputLocal,
  deInputLocal,
  validarProximaAcao,
  montarPayloadProximaAcao,
  itemDeFollowUp,
  contextoDeOrigem,
}
