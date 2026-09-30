export type ProgressoMeta = {
  alvo: number | null
  feito: number
  fracao: number
  faltam: number
  alcancado: boolean
}

export type Proximidade = {
  marco: number
  selo: string | null
  intensidade: string
  frase: string
  largura: string
} | null

export type ConfigMeta = {
  alvo_semanal: number
  dias_semana: number[]
}

export type DiaSemana = { iso: number; curto: string; longo: string }

export function proximidade(
  progresso: ProgressoMeta | null | undefined,
  opcoes?: { encerrado?: boolean; formatarValor?: (v: number) => string }
): Proximidade

export const DIAS: ReadonlyArray<DiaSemana>
export const DIAS_UTEIS_PADRAO: ReadonlyArray<number>
export function rotuloDias(dias: number[] | null | undefined): string
