export type Filtro3 = 'todos' | 'com' | 'sem'
export type FiltroSite = 'todos' | 'sem_site' | 'tem_site' | 'nao_identificado'
export type FiltroPrioridade = 'todas' | 'alta' | 'media' | 'baixa'
export type FiltroTentativas = 'todas' | 'nao_iniciados' | 'com_tentativa'
export type FiltroProximaAcao = 'todas' | 'com' | 'sem'
export type FiltroRedes = 'todas' | 'com' | 'sem'
export type FiltroRecencia = 'todas' | '7d' | '30d' | '90mais'

export interface FilaView {
  status: string
  tentativas: FiltroTentativas
  proximaAcao: FiltroProximaAcao
  email: Filtro3
  prioridade: FiltroPrioridade
  avalMin: string
  avalMax: string
  notaMin: string
  notaMax: string
  local: string
  nicho: string
  site: FiltroSite
  redes: FiltroRedes
  origem: string
  recencia: FiltroRecencia
}

export type CampoChip =
  | 'status' | 'tentativas' | 'proximaAcao' | 'email' | 'prioridade'
  | 'aval' | 'nota' | 'local' | 'nicho' | 'site' | 'redes' | 'origem' | 'recencia'

export interface ChipFiltro {
  campo: CampoChip
  label: string
}

export interface FilaLeadFiltravel {
  status?: string | null
  prioridade?: { faixa?: string; situacao_site?: string } | null
  situacao_site?: string | null
  tentativas?: number | null
  proxima_acao?: string | null
  email?: string | null
  avaliacoes?: number | null
  rating?: number | null
  cidade?: string | null
  endereco?: string | null
  nicho?: string | null
  instagram_handle?: string | null
  link_bio?: string | null
  origem?: string | null
  created_at?: string | null
}

export interface OpcoesDaFila {
  status: string[]
  nichos: string[]
  origens: string[]
  mostrarQualidadeDado: boolean
  temRecencia: boolean
}

export const VIEW_NEUTRA: FilaView
export const VIEW_PADRAO: FilaView
export const TENTATIVAS_OPCOES: [FiltroTentativas, string][]
export const PROXIMA_ACAO_OPCOES: [FiltroProximaAcao, string][]
export const EMAIL_OPCOES: [Filtro3, string][]
export const PRIORIDADE_OPCOES: [FiltroPrioridade, string][]
export const SITE_OPCOES: [FiltroSite, string][]
export const REDES_OPCOES: [FiltroRedes, string][]
export const RECENCIA_OPCOES: [FiltroRecencia, string][]

export function normalizarView(bruto: unknown): FilaView
export function limparFiltros(): FilaView
export function filaPadrao(): FilaView
export function limparCampo(view: Partial<FilaView>, campo: CampoChip): FilaView
export function faixaTentativas(n: unknown): 'nao_iniciados' | 'com_tentativa'
export function passaNosFiltros<T extends FilaLeadFiltravel>(lead: T, view: Partial<FilaView>, agora?: number): boolean
export function filtrarFila<T extends FilaLeadFiltravel>(lista: T[], view: Partial<FilaView>, agora?: number): T[]
export function opcoesDaFila<T extends FilaLeadFiltravel>(lista: T[]): OpcoesDaFila
export function chipsAtivos(view: Partial<FilaView>): ChipFiltro[]
export function contarFiltrosAtivos(view: Partial<FilaView>): number
export function viewsIguais(a: Partial<FilaView>, b: Partial<FilaView>): boolean

// A paginação vive em ./paginacao (compartilhada com a listagem da Aquisição) e é apenas
// reexportada aqui. `PaginaFila` continua existindo como o nome histórico desta tela.
import type { PaginaLista } from './paginacao'

export type PaginaFila<T> = PaginaLista<T>
export {
  TAMANHOS_PAGINA, POR_PAGINA_PADRAO,
  normalizarPorPagina, paginar, resumoPaginacao, mostrarPaginacao,
} from './paginacao'
