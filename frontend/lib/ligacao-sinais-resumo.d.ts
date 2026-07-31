export type Sinal = { tipo: 'interesse' | 'resistencia'; etapa_tipo: string | null }

export function resumoSinais(sinais: Sinal[]): {
  interesse: number
  resistencia: number
  etapaMaiorInteresse: string | null
  etapaPerda: string | null
}
