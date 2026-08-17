export type DispositivoSessao = 'computador' | 'celular'

export declare const CHAVE_STORAGE: string
export declare const DISPOSITIVOS: readonly DispositivoSessao[]
export declare const HEADER_CHAVE: string
export declare const HEADER_DISPOSITIVO: string

export declare function novaChaveSessao(aleatorio?: (n: number) => ArrayLike<number>): string
export declare function classificarDispositivo(pontoDeToque: boolean): DispositivoSessao
export declare function chaveDaSessao(): string | null
export declare function cabecalhosOrigem(): Record<string, string>
