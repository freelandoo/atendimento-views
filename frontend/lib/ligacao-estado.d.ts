export type EstadoLigacao = 'visualizando' | 'em_andamento' | 'encerrada' | 'descartada'

export function podeTransicionar(de: string, para: string): boolean
export function segDesde(iniciadaEmISO: string | null | undefined, agoraMs?: number): number
export function fmtCronometro(segundos: number): string
