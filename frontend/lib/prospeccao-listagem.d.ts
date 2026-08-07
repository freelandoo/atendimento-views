import type { PaginaLista } from './paginacao'

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

export const FILTROS_STATUS: readonly FiltroStatusListagem[]
/** Contagem por filtro; `null` = desconhecida (não exibir número). */
export function contagensDosFiltros(
  metricas: MetricasProspeccao | null | undefined
): Record<string, number | null>
export function taxaResposta(metricas: MetricasProspeccao | null | undefined): TaxaRespostaListagem
export interface PaginaServidor<T> extends PaginaLista<T> {
  /** `true` quando o total do filtro ainda não chegou e foi inferido do que já veio. */
  totalEstimado: boolean
}

/** Descreve a página que o servidor já recortou (itens da página + total vindo de /metricas). */
export function paginaServidor<T>(entrada: {
  itens: T[]
  pagina: unknown
  porPagina: unknown
  total: unknown
}): PaginaServidor<T>
