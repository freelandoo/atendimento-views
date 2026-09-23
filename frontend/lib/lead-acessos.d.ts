export type TipoAcesso = 'whatsapp' | 'instagram' | 'facebook' | 'site' | 'maps' | 'link'

export type AcessoRapido = {
  tipo: TipoAcesso
  rotulo: string
  href: string
  dica: string
}

export type LeadComLinks = {
  telefone?: string | null
  instagram_handle?: string | null
  site?: string | null
  tem_site?: boolean | null
  link_bio?: string | null
  link_original?: string | null
  classificacao_url?: string | null
  maps_url?: string | null
}

export declare const TIPO_ACESSO: Record<string, TipoAcesso>
export declare const ROTULO_MARCA: Record<string, string>

export declare function normalizarLink(bruta: unknown): { href: string; host: string } | null
export declare function marcaDoLink(bruta: unknown): TipoAcesso | null
export declare function rotuloGenerico(classificacaoUrl: string | null | undefined): string
export declare function telefoneWhatsapp(telefone: unknown): string | null
export declare function acessosDoLead(lead: LeadComLinks | null | undefined): AcessoRapido[]
