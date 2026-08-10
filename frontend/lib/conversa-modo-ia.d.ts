export type ModoIa = 'conversa' | 'analise'

export type DescricaoModo = {
  id: ModoIa
  rotulo: string
  estado: string
  descricao: string
  ajuda: string
}

export type AvisoCompositor = { titulo: string; texto: string }

export declare const MODOS_IA: { CONVERSA: 'conversa'; ANALISE: 'analise' }
export declare const MODO_IA_PADRAO: ModoIa
export declare const MODOS_IA_VALIDOS: ModoIa[]

export declare function modoValido(valor: unknown): boolean
export declare function normalizarModo(valor: unknown): ModoIa
export declare function descreverModo(valor: unknown): DescricaoModo
export declare function opcoesDeModo(): DescricaoModo[]
export declare function rotuloAcessivel(valor: unknown): string
export declare function avisoDoCompositor(valor: unknown): AvisoCompositor | null
export declare function houveMudanca(atual: unknown, novo: unknown): boolean
