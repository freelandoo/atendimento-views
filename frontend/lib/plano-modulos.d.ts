import type { PlanoVeredito } from './plano'

export interface ModuloBloqueavel {
  chave: string
  liberaEm: 'minimo' | 'basico' | 'pro'
  titulo: string
  faz: string
}

export declare const NIVEL: Record<string, number>
export declare const MODULOS: Record<string, { liberaEm: string; titulo: string; faz: string }>
export declare const BENEFICIOS: Record<string, string[]>
export declare const NOME_COMERCIAL: Record<string, string>
export interface PlanoInfo { nome: string; preco: number; em_construcao: boolean }
export declare const PLANO_INFO: Record<string, PlanoInfo>
export declare function infoDoPlano(chave: string): PlanoInfo | null
export declare function nivelDoPlano(plano?: PlanoVeredito | null): number
export declare function moduloDaRota(pathname?: string): ModuloBloqueavel | null
export declare function planoQueLibera(modulo?: ModuloBloqueavel | null): string | null
export declare function beneficiosDoPlano(liberaEm: string): string[]
export declare function bloqueado(plano: PlanoVeredito | null | undefined, modulo?: ModuloBloqueavel | null): boolean
