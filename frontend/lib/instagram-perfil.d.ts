export type ConfiancaInstagram = 'confirmado' | 'candidato' | 'nao_encontrado'
export type EstadoInstagram = ConfiancaInstagram | 'nao_verificado'
export type OrigemInstagram = 'google_meu_negocio' | 'busca' | 'operador'

export interface SinalInstagram {
  chave: string
  rotulo: string
  ok: boolean
  detalhe: string | null
}

export type AtividadeInstagram =
  | 'ativo_recente' | 'atividade_morna' | 'atividade_antiga' | 'sem_posts' | 'nao_verificado'
export type EtapaEnriquecimento =
  | 'pendente' | 'processando' | 'concluido' | 'falhou' | 'revisao_humana' | 'pulado'

export interface LeadInstagram {
  instagram_atividade?: string | null
  instagram_ultimo_post_em?: string | null
  instagram_seguidores?: number | null
  instagram_etapa_status?: string | null
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
export declare const ROTULO_ATIVIDADE: Record<AtividadeInstagram, string>
export declare const ROTULO_ETAPA: Partial<Record<EtapaEnriquecimento, string>>
export declare const TOM_ATIVIDADE: Record<AtividadeInstagram, string>
export declare function estadoAtividade(lead: LeadInstagram | null | undefined): {
  chave: AtividadeInstagram | ''
  rotulo: string
  tom: string
  confiavel: boolean
  ressalva: string
  ultimo_post_em?: string | null
}
export declare function rotuloEnriquecimento(lead: LeadInstagram | null | undefined): string
export declare function avisoAtividade(lead: LeadInstagram | null | undefined): string
export declare function acoesDisponiveis(lead: LeadInstagram | null | undefined): {
  podeProcurar: boolean
  podeConfirmar: boolean
  podeRecusar: boolean
  podeTrocar: boolean
}
export declare function avisoIcpSemPerfil(lead: LeadInstagram | null | undefined): string
