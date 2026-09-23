export type PaisAquisicao = { codigo: string; nome: string }
export const PAISES_AQUISICAO: readonly PaisAquisicao[]
export function normalizarPais(valor: unknown, padrao?: string): string
export function nomePais(codigo: unknown): string
