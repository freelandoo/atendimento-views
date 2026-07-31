export interface FoneInfo {
  ddd: string | null
  numero: string | null
  e164: string | null
  completo: boolean
  motivo: 'vazio' | 'sem_ddd' | 'formato_desconhecido' | null
}

export function analisarFone(bruto: string | null | undefined): FoneInfo
export function fmtFone(bruto: string | null | undefined): string
export function telHref(bruto: string | null | undefined): string | null
export function avisoFone(bruto: string | null | undefined): string | null
