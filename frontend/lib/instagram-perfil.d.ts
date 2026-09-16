export type ConfiancaInstagram = 'confirmado' | 'candidato' | 'nao_encontrado'
export type EstadoInstagram = ConfiancaInstagram | 'nao_verificado'
export type OrigemInstagram = 'google_meu_negocio' | 'busca' | 'operador'

export interface SinalInstagram {
  chave: string
  rotulo: string
  ok: boolean
  detalhe: string | null
}

export interface LeadInstagram {
  instagram_handle?: string | null
  instagram_candidato?: string | null
  instagram_origem?: string | null
  instagram_confianca?: string | null
  instagram_evidencia?: { sinais?: SinalInstagram[]; [k: string]: unknown } | null
}

export declare const ROTULO_CONFIANCA: Record<ConfiancaInstagram, string>
export declare const ROTULO_ORIGEM: Record<OrigemInstagram, string>
export declare const TOM_CONFIANCA: Record<EstadoInstagram, string>

export declare function estadoInstagram(lead: LeadInstagram | null | undefined): {
  chave: EstadoInstagram
  handle: string
  candidato: string
  tom: string
}
export declare function rotuloEstado(lead: LeadInstagram | null | undefined): string
export declare function rotuloOrigem(lead: LeadInstagram | null | undefined): string
export declare function urlPerfil(handle: string | null | undefined): string
export declare function evidencia(lead: LeadInstagram | null | undefined): {
  bateram: SinalInstagram[]
  naoBateram: SinalInstagram[]
  total: number
}
export declare function avisoAtividade(lead: LeadInstagram | null | undefined): string
export declare function acoesDisponiveis(lead: LeadInstagram | null | undefined): {
  podeProcurar: boolean
  podeConfirmar: boolean
  podeRecusar: boolean
  podeTrocar: boolean
}
export declare function avisoIcpSemPerfil(lead: LeadInstagram | null | undefined): string
