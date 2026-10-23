export interface OfertaPrevia {
  id?: string
  nome?: string
  descricao?: string
  nicho?: string
  geral?: boolean
  site_pronto?: boolean
}

export interface PreviaAbordagem {
  nicho?: string
  gerar_ia?: boolean
  /** Vocabulário FECHADO do backend (`MOTIVO_OFERTA`). */
  motivo?: string
  oferta?: OfertaPrevia | null
}

export interface LeituraPrevia {
  titulo: string
  detalhe: string
  tom: 'ok' | 'atencao' | 'neutro'
  oferta: string
}

export const MOTIVO: Readonly<Record<string, string>>
export function leituraPrevia(previa: PreviaAbordagem | null | undefined): LeituraPrevia
export function classeTom(tom: string): string
