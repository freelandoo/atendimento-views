import type { PlanoVeredito } from './plano'

export interface ModuloBloqueavel {
  chave: string
  liberaEm: 'minimo' | 'basico' | 'pro'
  titulo: string
  faz: string
}

export declare const NIVEL: Record<string, number>
export declare const MODULOS: Record<string, { liberaEm: string; titulo: string; faz: string }>
export declare function nivelDoPlano(plano?: PlanoVeredito | null): number
export declare function moduloDaRota(pathname?: string): ModuloBloqueavel | null
export declare function planoQueLibera(modulo?: ModuloBloqueavel | null): string | null
export declare function bloqueado(plano: PlanoVeredito | null | undefined, modulo?: ModuloBloqueavel | null): boolean
