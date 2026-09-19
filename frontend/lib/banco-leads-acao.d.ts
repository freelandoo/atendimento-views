export type ChaveAcaoLead =
  | 'responder'
  | 'enviar'
  | 'revisar'
  | 'adicionar_telefone'
  | 'travado'
  | 'abrir'

export const ACOES: {
  readonly RESPONDER: 'responder'
  readonly ENVIAR: 'enviar'
  readonly REVISAR: 'revisar'
  readonly ADICIONAR_TELEFONE: 'adicionar_telefone'
  readonly TRAVADO: 'travado'
  readonly ABRIR: 'abrir'
}

/** Vereditos JÁ resolvidos pela tela/backend. Este módulo não os calcula. */
export interface VereditosDoLead {
  temTelefone?: boolean
  /** `isRodavel(l)` — elegibilidade decidida pelo backend. */
  rodavel?: boolean
  /** `isLocked(l)` — trava de 15 dias. */
  travado?: boolean
  motivoTravado?: string
  mensagemPronta?: boolean
  respondeu?: boolean
  erroIa?: boolean
  /** Cooldown ou instância desconectada. */
  envioBloqueado?: boolean
  motivoEnvioBloqueado?: string
}

export interface AcaoPrincipalLead {
  chave: ChaveAcaoLead
  rotulo: string
  variante: 'primaria' | 'secundaria'
  /** Vazio quando o botão está liberado. Nunca é só opacidade: vira texto. */
  motivoDesabilitado: string
  dica: string
}

export function acaoPrincipalDoLead(vereditos?: VereditosDoLead): AcaoPrincipalLead
