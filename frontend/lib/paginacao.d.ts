export interface PaginaLista<T> {
  itens: T[]
  pagina: number
  totalPaginas: number
  porPagina: number
  total: number
  /** Índice GLOBAL (0-based) do primeiro item da página. */
  offset: number
  /** Posição 1-based do primeiro item exibido (0 quando a lista está vazia). */
  inicio: number
  /** Posição 1-based do último item exibido. */
  fim: number
  temAnterior: boolean
  temProxima: boolean
}

export interface OpcoesResumoIntervalo {
  /** Padrão: "Exibindo". */
  verbo?: string
  /** Padrão: "lead". */
  singular?: string
  /** Padrão: `${singular}s`. */
  plural?: string
  /** Texto quando não há nenhum item. Padrão: `Nenhum ${singular}`. */
  vazio?: string
}

export const TAMANHOS_PAGINA: readonly number[]
export const POR_PAGINA_PADRAO: number
export function normalizarPorPagina(valor: unknown): number
export function paginar<T>(lista: T[], pagina: unknown, porPagina: unknown): PaginaLista<T>
export function resumoIntervalo(
  pg: { total: number; inicio: number; fim: number } | null | undefined,
  opcoes?: OpcoesResumoIntervalo
): string
export function resumoPaginacao(pg: { total: number; inicio: number; fim: number } | null | undefined): string
export function mostrarPaginacao(total: unknown, porPagina: unknown): boolean
