export type ModoFila = 'simplificada' | 'detalhada'
export type FiltroSite = 'todos' | 'sem_site' | 'tem_site' | 'nao_identificado'
export type FiltroPrioridade = 'todas' | 'alta' | 'media' | 'baixa'
export type FiltroTentativas = 'todas' | 'nenhuma' | 'uma' | 'duas_mais'

export interface FilaView {
  modo: ModoFila
  site: FiltroSite
  prioridade: FiltroPrioridade
  tentativas: FiltroTentativas
  avalMin: string
  avalMax: string
  notaMin: string
  notaMax: string
  local: string
}

export interface ChipFiltro {
  campo: 'site' | 'prioridade' | 'tentativas' | 'aval' | 'nota' | 'local'
  label: string
}

export interface FilaLeadFiltravel {
  prioridade?: { faixa?: string; situacao_site?: string } | null
  tentativas?: number | null
  avaliacoes?: number | null
  rating?: number | null
  cidade?: string | null
  endereco?: string | null
}

export const VIEW_PADRAO: FilaView
export const VIEW_RECOMENDADA: FilaView
export const SITE_OPCOES: [FiltroSite, string][]
export const PRIORIDADE_OPCOES: [FiltroPrioridade, string][]
export const TENTATIVAS_OPCOES: [FiltroTentativas, string][]

export function normalizarView(bruto: unknown): FilaView
export function limparFiltros(view: Partial<FilaView>): FilaView
export function limparCampo(view: Partial<FilaView>, campo: ChipFiltro['campo']): FilaView
export function faixaTentativas(n: unknown): 'nenhuma' | 'uma' | 'duas_mais'
export function passaNosFiltros<T extends FilaLeadFiltravel>(lead: T, view: Partial<FilaView>): boolean
export function filtrarFila<T extends FilaLeadFiltravel>(lista: T[], view: Partial<FilaView>): T[]
export function chipsAtivos(view: Partial<FilaView>): ChipFiltro[]
export function contarFiltrosAtivos(view: Partial<FilaView>): number
