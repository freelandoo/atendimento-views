'use strict'
// Painel da EQUIPE — APRESENTAÇÃO PURA. CRM em equipe, Etapa 12.
//
// O backend (`routes/api-equipe.js`) não tem SQL próprio: ele reusa as contagens de cada módulo,
// porque reescrevê-las criaria uma segunda definição de "quantos leads o vendedor X tem". Este
// módulo segue a mesma disciplina do outro lado: **não soma, não pondera e não cria ranking**.
// Ele ordena, rotula e diz o que cada número significa.
//
// ─── DUAS COISAS QUE ESTE PAINEL NÃO PODE VIRAR ──────────────────────────────────────────
// 1. **Placar de produtividade.** As quatro contagens medem coisas diferentes (carteira, fila,
//    compromisso, atividade) e não se somam: um "total" daria um número que não se sustenta, do
//    mesmo jeito que somar entrega confirmada com declaração do vendedor (Etapa 5).
// 2. **Métrica de auditoria.** A linha do tempo de `/equipe/:id/atividade` é RASTREABILIDADE —
//    a migration 047 declara que a auditoria não deve ser fonte de dashboard. Por isso não há
//    aqui nenhuma função que conte, agrupe ou faça média de eventos de auditoria.
//
// Sem React, sem rede, sem DOM: testável com `node --test`.

/**
 * O que cada coluna mede — e é obrigatório dizer, pelo mesmo motivo do `oQueMede` da
 * `BolinhaPontuacao`: quatro números lado a lado sugerem que são comparáveis entre si.
 */
const COLUNAS = Object.freeze([
  { chave: 'leads', rotulo: 'Leads', oQueMede: 'Leads da carteira sob responsabilidade desta pessoa agora.' },
  { chave: 'conversas', rotulo: 'Conversas', oQueMede: 'Conversas atribuídas a esta pessoa na Central de Mensagens.' },
  { chave: 'follow_ups_aguardando', rotulo: 'Follow-ups', oQueMede: 'Follow-ups em aberto atribuídos a esta pessoa.' },
  { chave: 'follow_ups_vencidos', rotulo: 'Vencidos', oQueMede: 'Follow-ups desta pessoa cujo prazo já passou.' },
  { chave: 'ligacoes', rotulo: 'Ligações', oQueMede: 'Ligações já registradas por esta pessoa. É histórico, não carga atual.' },
])

const ATIVIDADE_HOJE_COLUNAS = Object.freeze([
  { chave: 'acoes', rotulo: 'Ações', oQueMede: 'Ações registradas hoje no sistema.' },
  { chave: 'contatos_registrados', rotulo: 'Contatos', oQueMede: 'Leads marcados como contatados ou contato manual declarado hoje.' },
  { chave: 'respondidos', rotulo: 'Respondidos', oQueMede: 'Leads marcados como respondidos hoje.' },
  { chave: 'fechados', rotulo: 'Fechados', oQueMede: 'Leads marcados como fechados hoje.' },
  { chave: 'ligacoes_encerradas', rotulo: 'Ligações', oQueMede: 'Chamadas encerradas hoje.' },
  { chave: 'followups_tratados', rotulo: 'Follow-ups', oQueMede: 'Follow-ups tratados hoje por e-mail, conversa manual, conclusão ou cancelamento.' },
])

const PAPEL_ROTULO = {
  owner: 'Dono',
  admin: 'Administrador',
  comercial: 'Comercial',
  member: 'Membro',
}

/** Papel desconhecido aparece COMO ELE MESMO: um papel novo no servidor não pode sumir da tela. */
function rotuloPapel(papel) {
  const p = String(papel || '')
  return PAPEL_ROTULO[p] || p || '—'
}

/**
 * A carga de trabalho ATUAL de uma linha.
 *
 * Não é pontuação e não vira ranking: é a soma do que está NA MÃO da pessoa agora (carteira, fila
 * e compromissos), usada só para ordenar quem tem mais trabalho para o topo. `ligacoes` fica
 * FORA de propósito — é histórico acumulado, e somá-lo faria quem trabalha há mais tempo parecer
 * sobrecarregado hoje.
 */
function cargaAtual(linha) {
  const l = linha || {}
  return (Number(l.leads) || 0) + (Number(l.conversas) || 0) + (Number(l.follow_ups_aguardando) || 0)
}

/**
 * Ordena a equipe: quem tem mais trabalho primeiro; empate pelo nome.
 * **Quem está inativo vai para o fim**, mas NUNCA some — ver `avisoDeInativo`.
 */
function ordenarEquipe(linhas) {
  return [...(Array.isArray(linhas) ? linhas : [])].sort((a, b) => {
    if ((a.ativo !== false) !== (b.ativo !== false)) return a.ativo === false ? 1 : -1
    const d = cargaAtual(b) - cargaAtual(a)
    if (d !== 0) return d
    return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR')
  })
}

/**
 * O trabalho SEM DONO merece ser mostrado?
 *
 * Sempre que existir. Ele não é anomalia — a fila de livres e a de não atribuídas são estados de
 * primeira classe —, mas é exatamente o que o admin abre este painel para redistribuir. Quando
 * está zerado, esconder é honesto: não há nada a fazer.
 */
function temTrabalhoSemDono(semResponsavel) {
  return cargaAtual(semResponsavel) > 0
}

/**
 * Aviso para quem foi DESATIVADO e continua com trabalho na mão.
 *
 * A desativação revoga o acesso e **não** redistribui nada: o trabalho não some junto com a
 * conta, e redistribuir é ação explícita de uma pessoa. Sem este aviso, a carteira ficaria
 * parada sem ninguém notar.
 */
function avisoDeInativo(linha) {
  const l = linha || {}
  if (l.ativo !== false) return ''
  const partes = []
  if (l.leads) partes.push(`${l.leads} lead${l.leads === 1 ? '' : 's'}`)
  if (l.conversas) partes.push(`${l.conversas} conversa${l.conversas === 1 ? '' : 's'}`)
  if (l.follow_ups_aguardando) partes.push(`${l.follow_ups_aguardando} follow-up${l.follow_ups_aguardando === 1 ? '' : 's'}`)
  if (partes.length === 0) return 'Acesso revogado. Nada pendente na mão desta pessoa.'
  return `Acesso revogado, mas ainda com ${partes.join(', ')} na mão. Redistribua manualmente.`
}

/** "Nunca acessou" é informação; um traço não é. */
function rotuloUltimoAcesso(iso) {
  if (!iso) return 'Nunca acessou esta empresa'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Nunca acessou esta empresa'
  return d.toLocaleString('pt-BR')
}

function atividadeHoje(linha) {
  const a = (linha || {}).atividade_hoje || {}
  return {
    acoes: Number(a.acoes) || 0,
    leads_assumidos: Number(a.leads_assumidos) || 0,
    leads_marcados: Number(a.leads_marcados) || 0,
    contatos_registrados: Number(a.contatos_registrados) || 0,
    respondidos: Number(a.respondidos) || 0,
    fechados: Number(a.fechados) || 0,
    ligacoes_encerradas: Number(a.ligacoes_encerradas) || 0,
    followups_tratados: Number(a.followups_tratados) || 0,
    primeira_acao_em: a.primeira_acao_em || null,
    ultima_acao_em: a.ultima_acao_em || null,
    janela_ativa_min: Number(a.janela_ativa_min) || 0,
  }
}

function janelaAtivaRotulo(minutos) {
  const n = Number(minutos) || 0
  if (n <= 0) return 'sem janela'
  if (n < 60) return `${n} min`
  const h = Math.floor(n / 60)
  const m = n % 60
  return m ? `${h}h ${m}min` : `${h}h`
}

function ordenarPorAtividadeHoje(linhas) {
  return [...(Array.isArray(linhas) ? linhas : [])].sort((a, b) => {
    const ah = atividadeHoje(a)
    const bh = atividadeHoje(b)
    const d = bh.acoes - ah.acoes
    if (d !== 0) return d
    return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR')
  })
}

/**
 * Uma linha da linha do tempo de auditoria, pronta para a tela.
 *
 * Ela mostra o que o backend gravou, **sem reinterpretar**: a ação sai como o slug que ela é
 * quando não há tradução, porque uma ação nova no servidor não pode aparecer como "—".
 */
const ACAO_ROTULO = {
  conversa_responsavel_assumiu: 'assumiu uma conversa',
  conversa_responsavel_liberou: 'devolveu uma conversa para a fila',
  conversa_responsavel_transferiu: 'transferiu uma conversa',
  conversa_responsavel_atribuiu: 'atribuiu uma conversa',
  conversa_modo_ia_alterado: 'mudou o modo da IA de uma conversa',
  lead_responsavel_assumiu: 'assumiu um lead',
  lead_responsavel_liberou: 'devolveu um lead para a fila',
  lead_responsavel_transferiu: 'transferiu um lead',
  lead_responsavel_atribuiu: 'atribuiu um lead',
  lead_status_alterado: 'mudou o status de um lead',
  abordagem_manual_declarada: 'declarou contato manual com um lead',
  membro_empresa_adicionado: 'adicionou alguém à empresa',
  membro_empresa_alterado: 'alterou o vínculo de alguém',
  follow_up_email_enviado: 'enviou um e-mail de follow-up',
  contato_canal_disponibilidade_alterada: 'registrou a disponibilidade de canal de um contato',
  instancia_responsavel_definido: 'trocou o responsável de uma instância',
  contexto_padrao_definido: 'definiu o contexto padrão da empresa',
  followup_manual_conversa_iniciada: 'iniciou uma conversa manualmente',
  ligacao_chamada_encerrada: 'encerrou uma chamada',
}

function descreverAtividade(evento) {
  const e = evento || {}
  const acao = String(e.acao || '')
  return {
    rotulo: ACAO_ROTULO[acao] || acao || '—',
    conhecida: Object.prototype.hasOwnProperty.call(ACAO_ROTULO, acao),
    entidade: String(e.entidade_tipo || ''),
    quando: e.ocorrido_em ? new Date(e.ocorrido_em).toLocaleString('pt-BR') : '',
  }
}

module.exports = {
  COLUNAS,
  ATIVIDADE_HOJE_COLUNAS,
  PAPEL_ROTULO,
  rotuloPapel,
  cargaAtual,
  ordenarEquipe,
  temTrabalhoSemDono,
  avisoDeInativo,
  rotuloUltimoAcesso,
  atividadeHoje,
  janelaAtivaRotulo,
  ordenarPorAtividadeHoje,
  descreverAtividade,
}
