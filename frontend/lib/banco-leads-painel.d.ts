export type TomCartaoFunil = 'neutro' | 'info' | 'ok' | 'brand' | 'danger'

export interface AbaFunil {
  valor: string
  label: string
}

export interface ResumoFunil {
  abas: Record<string, number>
  por_status?: Record<string, number>
}

export interface CartaoFunil {
  valor: string
  label: string
  /** `null` enquanto o resumo não chegou — nunca 0, que afirmaria estágio vazio. */
  total: number | null
  /** Participação no total das abas. `null` sem resumo ou com total zero. */
  percentual: number | null
  tom: TomCartaoFunil
}

export function cartoesDeFunil(abas: AbaFunil[], resumo: ResumoFunil | null): CartaoFunil[]

export interface ItemMaisAcoes {
  chave: 'exportar' | 'limpar'
  rotulo: string
  tom: 'neutro' | 'perigo'
}

export function itensMaisAcoes(vereditos?: {
  podeExportar?: boolean
  podeLimpar?: boolean
}): ItemMaisAcoes[]

export interface ColunaCsv {
  chave: string
  rotulo: string
}

export const COLUNAS_CSV: ColunaCsv[]
export const COLUNAS_CSV_PADRAO: string[]

export interface PedidoExportacao {
  ok: boolean
  /** Vazio quando `ok`. Nunca é só um botão apagado: vira texto. */
  motivo: string
  nome: string
  colunas: string[]
}

export function validarExportacao(pedido?: {
  colunas?: string[]
  nomeArquivo?: string
  padrao?: string
}): PedidoExportacao

export const LIMPEZA: {
  readonly titulo: string
  readonly corpo: string
  readonly aviso: string
  readonly rotuloConfirmar: string
}
