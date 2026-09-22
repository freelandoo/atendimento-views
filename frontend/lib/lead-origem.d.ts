export interface OpcaoFiltroOrigem {
  valor: string
  label: string
}

export interface RotuloOrigem {
  /** Grupo de apresentação: places | instagram | linkedin | meta_ads | desconhecida. */
  chave: string
  rotulo: string
  curto: string
  dica: string
}

export interface CelulaOrigem extends RotuloOrigem {
  /** Evidência mais identificadora da fonte (hoje só o @ do Instagram). */
  detalhe: string | null
  classe: string
}

export const OPCOES_FILTRO_ORIGEM: OpcaoFiltroOrigem[]
export const CLASSE_PILULA: string
/** Traduz a origem gravada pelo backend. Desconhecida volta como ela mesma. */
export function rotuloOrigem(origem?: string | null): RotuloOrigem
/** O que a coluna Origem mostra na linha. */
export function celulaOrigem(lead?: { origem?: string | null; instagram_handle?: string | null } | null): CelulaOrigem
/** Nome do filtro em vigor, para a tela declarar o recorte. `null` = sem filtro. */
export function rotuloFiltroOrigem(valor?: string | null): string | null
