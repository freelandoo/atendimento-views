export interface FiltroStatusListagem {
  /** Valor enviado ao backend em `?status=`; string vazia = todos. */
  valor: string
  label: string
  /** Campo correspondente em GET /prospeccao/metricas. */
  chave: string
}

export interface MetricasProspeccao {
  total?: string | number | null
  aguardando?: string | number | null
  aprovados?: string | number | null
  rejeitados?: string | number | null
  enviados?: string | number | null
  responderam?: string | number | null
  taxa_resposta?: number | null
}

export interface TaxaRespostaListagem {
  /** `null` quando ninguém recebeu mensagem ainda (sem divisão por zero). */
  percentual: number | null
  texto: string
  responderam: number
  base: number
}

export interface ResumoRodapeListagem {
  texto: string
  /** Vazio quando a lista carregada já cobre todo o filtro. */
  aviso: string
}

export const FILTROS_STATUS: readonly FiltroStatusListagem[]
/** Contagem por filtro; `null` = desconhecida (não exibir número). */
export function contagensDosFiltros(
  metricas: MetricasProspeccao | null | undefined
): Record<string, number | null>
export function taxaResposta(metricas: MetricasProspeccao | null | undefined): TaxaRespostaListagem
export function resumoRodape(
  pg: { total: number; inicio: number; fim: number } | null | undefined,
  totalNoFiltro: unknown
): ResumoRodapeListagem
