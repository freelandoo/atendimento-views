export interface LimiteCadencia {
  usados: number
  teto: number
  restante: number
  atingido: boolean
}

export interface PlanoFollowUpLead {
  versao: string
  estagio: {
    chave: string
    rotulo: string
    sinal: string
    ritmo: string[]
    saida: string
  }
  limites: {
    followUps: LimiteCadencia
    ligacoes: LimiteCadencia
  }
  recomendacao: {
    acao: string
    modelo: string
    canal: string
    proxima_acao: string
    prioridade: string
    agendado_para: string | null
    motivo: string
    exige_justificativa: boolean
  }
  avisos: string[]
  fatos?: Record<string, unknown>
}

export interface ResumoCadencia {
  titulo: string
  sinal: string
  classeSinal: string
  ritmo: string
  followUps: { texto: string; detalhe: string; atingido: boolean }
  ligacoes: { texto: string; detalhe: string; atingido: boolean }
  proxima: string
  motivo: string
  aviso: string
}

export function resumoCadencia(plano: PlanoFollowUpLead | null | undefined, agora?: Date): ResumoCadencia | null
