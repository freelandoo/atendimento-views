export type EstadoBrasil = { uf: string; nome: string }

export const ESTADOS_BRASIL: EstadoBrasil[]
export function normalizarUfBrasil(valor: unknown): string
export function nomeEstado(uf: unknown): string
export function ibgeMunicipiosUrl(uf: unknown): string
export function extrairCidadesIbge(payload: unknown): string[]
export function cidadePertenceAoEstado(cidade: unknown, cidades: unknown): boolean
