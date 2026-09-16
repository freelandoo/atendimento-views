/** Recorte guardado: um objeto simples de campos de filtro. */
export type Recorte = Record<string, unknown>

export interface EnvelopeRecorte {
  v: number
  /** Instante (ms) em que o recorte deixa de valer. */
  expira_em: number
  valor: Recorte
}

/** 30 minutos, em ms. */
export const JANELA_MS: number
export const VERSAO: number

export function chaveFiltros(tela: string, empresaId?: string | null): string
export function empacotar(valor: Recorte, agora?: number): EnvelopeRecorte
/** `null` para ausente, inválido, de outra versão ou vencido. */
export function desempacotar(bruto: string | null | undefined, agora?: number): Recorte | null

/** Lê e RENOVA a validade por mais 30 min. `null` quando não há recorte aproveitável. */
export function lerFiltros(tela: string, empresaId?: string | null, agora?: number): Recorte | null
export function gravarFiltros(tela: string, empresaId: string | null | undefined, valor: Recorte, agora?: number): void
export function esquecerFiltros(tela: string, empresaId?: string | null): void

/**
 * Sobrepõe ao padrão da tela apenas os campos que o padrão declara e cujo tipo bate.
 * Campo desconhecido ou de outro tipo é ignorado.
 */
export function aplicarRecorte<T extends Record<string, unknown>>(padrao: T, recorte: Recorte | null | undefined): T
