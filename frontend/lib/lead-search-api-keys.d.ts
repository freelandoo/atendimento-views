export type EstadoChave = 'active' | 'expired' | 'revoked'

export type FormularioChaveLeadSearch = {
  nome?: string
  empresa_id?: string
  expires_at?: string
  max_leads_per_job?: string | number
  rate_limit_per_minute?: string | number
}

export type EmpresaLeadSearch = {
  id: string
  nome: string
  slug?: string | null
  ativo?: boolean
}

export type ChaveLeadSearch = {
  id: string
  empresa_id: string | null
  nome: string
  key_hint: string
  scopes: string[]
  status: string
  max_leads_per_job: number
  rate_limit_per_minute: number
  expires_at: string | null
  revoked_at: string | null
  created_at: string | null
  updated_at: string | null
}

export const ESCOPO_MAPS: 'lead_search:maps:create'
export const ESCOPO_JOBS: 'lead_search:jobs:read'
export const SCOPES_PADRAO: readonly ['lead_search:maps:create', 'lead_search:jobs:read']

export function estadoChave(chave: Partial<ChaveLeadSearch>, agora?: Date): EstadoChave
export function rotuloEstadoChave(estado: EstadoChave | string): string
export function tomEstadoChave(estado: EstadoChave | string): string
export function validarFormularioChave(
  form: FormularioChaveLeadSearch,
  agora?: Date
): { ok: boolean; erros: Partial<Record<keyof FormularioChaveLeadSearch, string>> }
export function montarPayloadChave(form: FormularioChaveLeadSearch): {
  nome: string
  empresa_id: string
  scopes: string[]
  expires_at: string | null
  max_leads_per_job: number
  rate_limit_per_minute: number
}
export function formatarDataCurta(iso?: string | null): string
export function nomeEmpresa(empresas: EmpresaLeadSearch[], empresaId?: string | null): string
