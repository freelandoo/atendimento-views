'use strict'

/**
 * "Próxima ação" do lead — o que já foi COMBINADO com ele, na ordem em que vence.
 *
 * PURO: sem banco, HTTP, IA ou rede. Recebe o que `db/lead-proxima-acao.js` leu e devolve o
 * veredito que a ficha do Banco de Leads desenha.
 *
 * A pergunta aqui não é "em que faixa da fila este lead está?" (isso é `lead-fila-trabalho.js`),
 * e sim "o que alguém combinou fazer com este lead, e quando?". São duas respostas diferentes e a
 * ficha mostra as duas: o compromisso registrado vence a classificação calculada — uma decisão de
 * uma PESSOA vence uma recomendação (mesma precedência declarada da Central de Follow-ups).
 *
 * Ordem: por PRAZO. Um follow-up vencido é naturalmente o primeiro (o prazo dele já passou), então
 * não existe uma segunda régua de urgência aqui para divergir da fila.
 */

// `agenda` = compromisso da agenda que não é reunião (retorno, tarefa, follow-up marcado na
// agenda). Continua sendo algo combinado com hora — só não é uma reunião com o cliente.
const TIPO = Object.freeze({ FOLLOW_UP: 'follow_up', REUNIAO: 'reuniao', AGENDA: 'agenda' })

const MAX_NOTA = 280

function iso(v) {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function nota(v) {
  const s = String(v || '').replace(/\s+/g, ' ').trim()
  if (!s) return null
  return s.length > MAX_NOTA ? `${s.slice(0, MAX_NOTA - 1)}…` : s
}

function situacaoDoPrazo(quando, agora) {
  if (!quando) return 'sem_prazo'
  const t = new Date(quando).getTime()
  if (t < agora.getTime()) return 'atrasado'
  return 'futuro'
}

function doFollowUp(f, agora) {
  const quando = iso(f.agendado_para)
  return {
    tipo: TIPO.FOLLOW_UP,
    id: f.id,
    quando,
    situacao: situacaoDoPrazo(quando, agora),
    titulo: String(f.proxima_acao || '').trim() || 'Follow-up',
    canal: f.canal || null,
    prioridade: f.prioridade || null,
    origem: f.origem || null,
    observacao: nota(f.observacao),
    responsavel_nome: f.responsavel_nome || null,
  }
}

function daReuniao(r, agora) {
  const quando = iso(r.data_inicio)
  const fim = iso(r.data_fim)
  // Reunião que já começou e ainda não terminou é "agora", não atraso: ninguém deixou de fazer.
  const emCurso = quando && fim && new Date(quando) <= agora && new Date(fim) > agora
  return {
    tipo: !r.tipo || r.tipo === 'reuniao' ? TIPO.REUNIAO : TIPO.AGENDA,
    tipo_agenda: r.tipo || 'reuniao',
    id: r.id,
    quando,
    fim,
    situacao: emCurso ? 'em_curso' : situacaoDoPrazo(quando, agora),
    titulo: String(r.titulo || '').trim() || (r.tipo && r.tipo !== 'reuniao' ? 'Compromisso' : 'Reunião'),
    canal: null,
    prioridade: null,
    origem: r.origem || null,
    observacao: nota(r.descricao),
    responsavel_nome: r.responsavel_nome || null,
  }
}

function daLigacao(l) {
  if (!l) return null
  return {
    id: l.id,
    quando: iso(l.encerrada_em || l.iniciada_em),
    resultado: l.resultado || null,
    notas: nota(l.notas),
    usuario_nome: l.usuario_nome || null,
  }
}

/**
 * @param {{ followUps?: object[], reunioes?: object[], ultimaLigacao?: object|null, agora?: Date }} p
 * @returns {{ principal: object|null, compromissos: object[], ultima_ligacao: object|null }}
 */
function montarProximaAcao({ followUps = [], reunioes = [], ultimaLigacao = null, agora = new Date() } = {}) {
  const compromissos = [
    ...followUps.map((f) => doFollowUp(f, agora)),
    ...reunioes.map((r) => daReuniao(r, agora)),
  ].sort((a, b) => {
    // Sem prazo vai para o fim: não dá para dizer que vence antes de algo que tem data.
    if (!a.quando && !b.quando) return 0
    if (!a.quando) return 1
    if (!b.quando) return -1
    return new Date(a.quando) - new Date(b.quando)
  })
  return {
    principal: compromissos[0] || null,
    compromissos,
    ultima_ligacao: daLigacao(ultimaLigacao),
  }
}

module.exports = { TIPO, MAX_NOTA, montarProximaAcao }
