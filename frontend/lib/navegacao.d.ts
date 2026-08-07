export type Role = 'user' | 'admin' | 'superadmin'

export type NavIcon =
  | 'overview' | 'chat' | 'leads' | 'prospect' | 'agenda' | 'context' | 'company'
  | 'model' | 'usage' | 'report' | 'accounts' | 'profile' | 'prompts' | 'playbook'
  | 'followup' | 'roteiro' | 'central' | 'operacao' | 'settings' | 'integracoes'

export type NavItem = {
  tipo: 'item'
  href: string
  label: string
  icon: NavIcon
  minRole?: Role
  exato?: boolean
  aliases?: string[]
}

export type NavGrupo = {
  tipo: 'grupo'
  id: string
  label: string
  icon: NavIcon
  itens: NavItem[]
}

export type NavNo = NavItem | NavGrupo

export type Ativo = { href: string | null; grupoId: string | null }

export const NAV: NavNo[]
export const IDS_GRUPOS: string[]
export const NIVEL_ROLE: Record<Role, number>

export function podePapel(role: Role | undefined, minimo?: Role | null): boolean
export function normalizarRota(valor: unknown): string
export function mesmaRota(pathname: unknown, destino: unknown, exato?: boolean): boolean
export function rotasDoItem(item: NavItem): string[]
export function itemAtivo(pathname: unknown, item: NavItem): boolean
export function itemVisivel(item: NavItem, role: Role | undefined): boolean
export function navegacaoVisivel(role: Role | undefined, arvore?: NavNo[]): NavNo[]
export function itensVisiveis(role: Role | undefined, arvore?: NavNo[]): NavItem[]
export function resolverAtivo(pathname: unknown, role: Role | undefined, arvore?: NavNo[]): Ativo
export function normalizarGruposAbertos(valor: unknown, grupoAtivo?: string | null, ids?: string[]): string[]
export function alternarGrupo(abertos: string[] | undefined, id: string, ids?: string[]): string[]
export function lerGruposAbertos(bruto: string | null | undefined): string[]
