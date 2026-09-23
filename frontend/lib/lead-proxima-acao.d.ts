export type SituacaoCompromisso = 'atrasado' | 'em_curso' | 'futuro' | 'sem_prazo'

/** Item de `compromissos` devolvido por `GET /banco-leads/leads/:id/proxima-acao`. */
export interface CompromissoLead {
  tipo: 'follow_up' | 'reuniao' | 'agenda'
  tipo_agenda?: string
  id: string
  quando: string | null
  fim?: string | null
  situacao: SituacaoCompromisso
  titulo: string
  canal: string | null
  prioridade: string | null
  origem: string | null
  observacao: string | null
  responsavel_nome: string | null
}

export interface UltimaLigacaoLead {
  id: string
  quando: string | null
  resultado: string | null
  notas: string | null
  usuario_nome: string | null
}

export interface ProximaAcaoLead {
  principal: CompromissoLead | null
  compromissos: CompromissoLead[]
  ultima_ligacao: UltimaLigacaoLead | null
}

export interface CartaoCompromisso {
  chave: string
  tipo: string
  titulo: string
  quando: string
  situacao: SituacaoCompromisso | 'hoje'
  selo: string
  classe: string
  observacao: string
  detalhe: string
}

export const ROTULO_RESULTADO: Readonly<Record<string, string>>
export function quandoEmTexto(iso: string | null | undefined, agora?: Date): string
export function cartaoCompromisso(c: CompromissoLead, agora?: Date): CartaoCompromisso
export function resumoUltimaLigacao(l: UltimaLigacaoLead | null, agora?: Date): { texto: string; notas: string } | null
