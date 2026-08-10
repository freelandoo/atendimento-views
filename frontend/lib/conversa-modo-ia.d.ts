export type ModoIa = 'conversa' | 'analise'
export type PreferenciaModoIa = 'herdar' | 'conversa' | 'analise'
export type OrigemModo = 'excecao' | 'herdado'

export type DescricaoModo = {
  id: ModoIa
  rotulo: string
  estado: string
  descricao: string
  ajuda: string
}

export type DescricaoPreferencia = {
  id: PreferenciaModoIa
  rotulo: string
  curto: string
  ajuda: string
}

export type Aviso = { titulo: string; texto: string }

export type EfetivoPrevisto = {
  modo_ia: PreferenciaModoIa
  modo_ia_padrao: ModoIa
  modo_ia_efetivo: ModoIa
  modo_ia_origem: OrigemModo
}

export declare const MODOS_IA: { CONVERSA: 'conversa'; ANALISE: 'analise' }
export declare const PREFERENCIAS: { HERDAR: 'herdar'; CONVERSA: 'conversa'; ANALISE: 'analise' }
export declare const MODOS_IA_VALIDOS: ModoIa[]
export declare const PREFERENCIAS_VALIDAS: PreferenciaModoIa[]
export declare const MODO_GLOBAL_PADRAO: ModoIa
export declare const PREFERENCIA_PADRAO: PreferenciaModoIa
export declare const ORIGEM_MODO: { EXCECAO: 'excecao'; HERDADO: 'herdado' }

export declare function modoValido(valor: unknown): boolean
export declare function preferenciaValida(valor: unknown): boolean
export declare function normalizarModo(valor: unknown): ModoIa
export declare function normalizarPreferencia(valor: unknown): PreferenciaModoIa
export declare function descreverModo(valor: unknown): DescricaoModo
export declare function descreverPreferencia(valor: unknown): DescricaoPreferencia
export declare function opcoesDeModo(): DescricaoModo[]
export declare function opcoesDePreferencia(): DescricaoPreferencia[]
export declare function explicarOrigem(entrada: {
  origem?: unknown
  modoEfetivo?: unknown
  modoPadrao?: unknown
}): string
export declare function avisoDePausa(agentePausado: unknown): Aviso | null
export declare function avisoDoCompositor(entrada: {
  modoEfetivo?: unknown
  agentePausado?: unknown
}): Aviso | null
export declare const AVISO_EXCECOES_PADRAO: string
export declare function explicarPadraoGlobal(modo: unknown): string
export declare function rotuloAcessivelPadrao(modo: unknown): string
export declare function rotuloAcessivel(entrada: {
  modoEfetivo?: unknown
  origem?: unknown
  modoPadrao?: unknown
}): string
export declare function houveMudancaDePreferencia(atual: unknown, nova: unknown): boolean
export declare function houveMudancaDeModo(atual: unknown, novo: unknown): boolean
export declare function preverEfetivo(entrada: {
  preferencia?: unknown
  modoPadrao?: unknown
}): EfetivoPrevisto
