'use strict'

// Cadencia comercial da ficha do lead (Proposta B).
//
// Este modulo nao chama IA, nao envia mensagem e nao grava banco. Ele e a regua deterministica
// que mantem a IA futura dentro de limites objetivos: estagio, teto, contagem, ritmo e motivo.

const MS_HORA = 60 * 60 * 1000
const MS_DIA = 24 * MS_HORA

const ESTAGIOS = Object.freeze({
  sem_contato: {
    rotulo: 'Sem contato / contatado frio',
    sinal: 'frio',
    tetoFollowUps: 2,
    tetoLigacoes: 3,
    ritmo: ['D0', 'D2', 'D5'],
    saida: 'Arquivar ou nutrir se nao responder.',
    modelo: 'retomar_interesse',
    canal: 'whatsapp',
    proximaAcao: 'Retomar interesse',
    prioridade: 'media',
  },
  interesse: {
    rotulo: 'Respondeu / demonstrou interesse',
    sinal: 'morno',
    tetoFollowUps: 3,
    tetoLigacoes: 3,
    ritmo: ['D0', 'D1', 'D4', 'D8'],
    saida: 'Pedir decisao ou reagendar.',
    modelo: 'reagendar_conversa',
    canal: 'whatsapp',
    proximaAcao: 'Reagendar conversa',
    prioridade: 'media',
  },
  proposta_enviada: {
    rotulo: 'Proposta enviada',
    sinal: 'quente',
    tetoFollowUps: 5,
    tetoLigacoes: 3,
    ritmo: ['D0', 'D1', 'D3', 'D7', 'D14'],
    saida: 'Enviar ultima tentativa educada ou nutrir.',
    modelo: 'confirmar_recebimento_proposta',
    canal: 'whatsapp',
    proximaAcao: 'Confirmar recebimento da proposta',
    prioridade: 'alta',
  },
  reuniao_marcada: {
    rotulo: 'Reuniao marcada',
    sinal: 'quente',
    tetoFollowUps: 5,
    tetoLigacoes: 3,
    ritmo: ['antes', 'no dia', 'depois', 'D3', 'D7'],
    saida: 'Reagendar ou marcar no-show se nao aparecer.',
    modelo: 'confirmar_presenca_reuniao',
    canal: 'whatsapp',
    proximaAcao: 'Confirmar presenca na reuniao',
    prioridade: 'alta',
  },
  reuniao_realizada: {
    rotulo: 'Reuniao realizada sem venda',
    sinal: 'quente',
    tetoFollowUps: 5,
    tetoLigacoes: 3,
    ritmo: ['D0', 'D2', 'D5', 'D10', 'D21'],
    saida: 'Nova proposta, nutricao ou descarte.',
    modelo: 'retomar_pos_reuniao',
    canal: 'whatsapp',
    proximaAcao: 'Retomar encaminhamento da reuniao',
    prioridade: 'alta',
  },
  encerrado: {
    rotulo: 'Encerrado',
    sinal: 'parado',
    tetoFollowUps: 0,
    tetoLigacoes: 0,
    ritmo: [],
    saida: 'Nao sugerir nova tentativa.',
    modelo: 'nenhuma',
    canal: 'nenhuma',
    proximaAcao: '',
    prioridade: 'media',
  },
})

const MODELOS_PRONTOS = Object.freeze({
  retomar_interesse: { label: 'Retomar interesse', canal: 'whatsapp', proxima_acao: 'Retomar interesse', prioridade: 'media' },
  confirmar_recebimento_proposta: { label: 'Confirmar proposta', canal: 'whatsapp', proxima_acao: 'Confirmar recebimento da proposta', prioridade: 'alta' },
  tirar_duvida_preco: { label: 'Tirar duvida de preco', canal: 'whatsapp', proxima_acao: 'Tirar duvida sobre preco', prioridade: 'alta' },
  confirmar_presenca_reuniao: { label: 'Confirmar reuniao', canal: 'whatsapp', proxima_acao: 'Confirmar presenca na reuniao', prioridade: 'alta' },
  reagendar_conversa: { label: 'Reagendar conversa', canal: 'whatsapp', proxima_acao: 'Reagendar conversa', prioridade: 'media' },
  retomar_pos_reuniao: { label: 'Retomar pos-reuniao', canal: 'whatsapp', proxima_acao: 'Retomar encaminhamento da reuniao', prioridade: 'alta' },
  ultima_tentativa: { label: 'Ultima tentativa', canal: 'whatsapp', proxima_acao: 'Ultima tentativa antes de arquivar', prioridade: 'baixa' },
  nova_ligacao: { label: 'Nova ligacao', canal: 'ligacao', proxima_acao: 'Ligar novamente', prioridade: 'media' },
})

function inteiro(v) {
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function dataIsoPorTentativa(estagio, usados, agora = new Date()) {
  if (estagio === 'reuniao_marcada') {
    const offsets = [2 * MS_HORA, 24 * MS_HORA, 2 * MS_DIA, 3 * MS_DIA, 7 * MS_DIA]
    return new Date(agora.getTime() + (offsets[Math.min(usados, offsets.length - 1)] || MS_DIA)).toISOString()
  }
  const offsetsDias = {
    sem_contato: [0, 2, 5],
    interesse: [0, 1, 4, 8],
    proposta_enviada: [0, 1, 3, 7, 14],
    reuniao_realizada: [0, 2, 5, 10, 21],
  }[estagio] || [1]
  const dias = offsetsDias[Math.min(usados, offsetsDias.length - 1)] || 1
  const atraso = dias === 0 ? 2 * MS_HORA : dias * MS_DIA
  return new Date(agora.getTime() + atraso).toISOString()
}

function escolherEstagio(lead = {}, fatos = {}) {
  const status = String(lead.status || '').toLowerCase()
  if (['fechado', 'rejeitado', 'nao_contatar'].includes(status) || fatos.descartado) return 'encerrado'
  if (fatos.numeroInvalido) return 'encerrado'
  if (inteiro(fatos.reunioesRealizadas) > 0) return 'reuniao_realizada'
  if (inteiro(fatos.reunioesFuturas) > 0 || inteiro(fatos.reunioesMarcadas) > 0) return 'reuniao_marcada'
  if (inteiro(fatos.propostas) > 0) return 'proposta_enviada'
  if (status === 'respondeu' || inteiro(fatos.respostas) > 0) return 'interesse'
  if (status === 'enviado' || inteiro(fatos.ligacoes) > 0 || inteiro(fatos.followUps) > 0) return 'sem_contato'
  return 'sem_contato'
}

function escolherModelo(estagio, usados, limites) {
  if (estagio === 'encerrado') return null
  if (limites.followUps.atingido) return MODELOS_PRONTOS.ultima_tentativa
  const cfg = ESTAGIOS[estagio] || ESTAGIOS.sem_contato
  if (estagio === 'sem_contato' && limites.ligacoes.restante > 0 && usados > 0) return MODELOS_PRONTOS.nova_ligacao
  return MODELOS_PRONTOS[cfg.modelo] || MODELOS_PRONTOS.retomar_interesse
}

function motivoDoPlano(estagio, fatos, limites) {
  if (estagio === 'encerrado') return 'Lead encerrado ou sem canal valido; nao ha nova tentativa recomendada.'
  if (limites.followUps.atingido) {
    return `Limite de ${limites.followUps.teto} follow-ups atingido para este estagio; proxima acao deve ser excecao, nutricao ou descarte.`
  }
  const cfg = ESTAGIOS[estagio] || ESTAGIOS.sem_contato
  return `${cfg.rotulo}: ${limites.followUps.usados}/${limites.followUps.teto} follow-ups usados, sinal ${cfg.sinal}.`
}

function opcoesPorEstagio(estagio, limites) {
  if (estagio === 'encerrado') return []
  const base = {
    sem_contato: ['retomar_interesse', 'nova_ligacao', 'ultima_tentativa'],
    interesse: ['reagendar_conversa', 'retomar_interesse', 'nova_ligacao'],
    proposta_enviada: ['confirmar_recebimento_proposta', 'tirar_duvida_preco', 'ultima_tentativa'],
    reuniao_marcada: ['confirmar_presenca_reuniao', 'reagendar_conversa', 'ultima_tentativa'],
    reuniao_realizada: ['retomar_pos_reuniao', 'confirmar_recebimento_proposta', 'ultima_tentativa'],
  }[estagio] || ['retomar_interesse']
  return base
    .map((id) => ({ id, ...MODELOS_PRONTOS[id] }))
    .filter((o) => o.canal !== 'ligacao' || limites.ligacoes.restante > 0)
}

function montarPlanoFollowUpLead({ lead = {}, fatos = {}, agora = new Date() } = {}) {
  const followUps = inteiro(fatos.followUps)
  const ligacoes = inteiro(fatos.ligacoes)
  const estagio = escolherEstagio(lead, fatos)
  const cfg = ESTAGIOS[estagio] || ESTAGIOS.sem_contato
  const limites = {
    followUps: {
      usados: followUps,
      teto: cfg.tetoFollowUps,
      restante: Math.max(0, cfg.tetoFollowUps - followUps),
      atingido: cfg.tetoFollowUps > 0 && followUps >= cfg.tetoFollowUps,
    },
    ligacoes: {
      usados: ligacoes,
      teto: cfg.tetoLigacoes,
      restante: Math.max(0, cfg.tetoLigacoes - ligacoes),
      atingido: cfg.tetoLigacoes > 0 && ligacoes >= cfg.tetoLigacoes,
    },
  }
  const modelo = escolherModelo(estagio, followUps, limites)
  const recomendacao = modelo
    ? {
        acao: 'follow_up',
        modelo: Object.entries(MODELOS_PRONTOS).find(([, v]) => v === modelo)?.[0] || cfg.modelo,
        canal: modelo.canal,
        proxima_acao: modelo.proxima_acao,
        prioridade: modelo.prioridade,
        agendado_para: dataIsoPorTentativa(estagio, followUps, agora),
        motivo: motivoDoPlano(estagio, fatos, limites),
        exige_justificativa: limites.followUps.atingido,
      }
    : {
        acao: 'nenhuma',
        modelo: 'nenhuma',
        canal: 'nenhuma',
        proxima_acao: '',
        prioridade: 'media',
        agendado_para: null,
        motivo: motivoDoPlano(estagio, fatos, limites),
        exige_justificativa: false,
      }
  return {
    versao: 'proposta_b',
    estagio: {
      chave: estagio,
      rotulo: cfg.rotulo,
      sinal: cfg.sinal,
      ritmo: cfg.ritmo,
      saida: cfg.saida,
    },
    limites,
    recomendacao,
    opcoes: opcoesPorEstagio(estagio, limites).map((o) => ({
      ...o,
      agendado_para: dataIsoPorTentativa(estagio, followUps, agora),
    })),
    avisos: [
      ...(fatos.followUpAberto ? ['Ja existe follow-up aberto; confira antes de criar outro.'] : []),
      ...(limites.followUps.atingido ? ['Limite do estagio atingido. Recomende nutricao, descarte ou excecao justificada.'] : []),
      ...(limites.ligacoes.atingido ? ['Limite de ligacoes atingido para este estagio.'] : []),
    ],
  }
}

module.exports = {
  ESTAGIOS,
  MODELOS_PRONTOS,
  escolherEstagio,
  montarPlanoFollowUpLead,
}
