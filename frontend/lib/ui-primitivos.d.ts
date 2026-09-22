export type VarianteBotao = 'primaria' | 'secundaria' | 'perigosa' | 'neutra'
export type TamanhoBotao = 'sm' | 'md'

export const VARIANTES_BOTAO: readonly VarianteBotao[]
export const TAMANHOS_BOTAO: readonly TamanhoBotao[]
export const VARIANTE_BOTAO_PADRAO: VarianteBotao
export const TAMANHO_BOTAO_PADRAO: TamanhoBotao

export function normalizarVarianteBotao(v: unknown): VarianteBotao
export function normalizarTamanhoBotao(t: unknown): TamanhoBotao

export interface OpcoesClassesBotao {
  variante?: VarianteBotao
  tamanho?: TamanhoBotao
  /** Ocupa a largura do container (formulário em coluna, ação de card). */
  larguraTotal?: boolean
  /** Classes de layout do chamador (margem, `shrink-0`…), nunca cor nem raio. */
  extra?: string
}
export function classesBotao(opcoes?: OpcoesClassesBotao): string

export interface OpcoesEstadoBotao {
  desabilitado?: boolean
  carregando?: boolean
  /** Explica por que está bloqueado. Só é anunciado quando o botão está mesmo inativo. */
  motivoDesabilitado?: string
}
export interface EstadoBotao {
  desabilitado: boolean
  ocupado: boolean
  titulo?: string
}
export function estadoBotao(opcoes?: OpcoesEstadoBotao): EstadoBotao

export function rotuloBotaoAcessivel(opcoes?: {
  rotulo?: string
  carregando?: boolean
  motivoDesabilitado?: string
}): string | undefined

export function classesEntrada(opcoes?: { erro?: boolean; extra?: string }): string

export function classesCard(opcoes?: {
  compacto?: boolean
  /** Card que controla o próprio padding (tabela colada na borda, por exemplo). */
  semPadding?: boolean
  extra?: string
}): string

export type TamanhoFolha = 'sm' | 'md' | 'lg' | 'xl'

export const TAMANHOS_FOLHA: readonly TamanhoFolha[]
export const TAMANHO_FOLHA_PADRAO: TamanhoFolha
export function normalizarTamanhoFolha(t: unknown): TamanhoFolha

/** Fundo escurecido: folha ancorada embaixo no celular, modal centrado a partir de `sm`. */
export function classesFundoFolha(opcoes?: { extra?: string; lateral?: boolean }): string

/** Superfície flutuante: folha inferior no celular, modal centrado a partir de `sm`. */
export function classesFolha(opcoes?: { tamanho?: TamanhoFolha; extra?: string; lateral?: boolean }): string
