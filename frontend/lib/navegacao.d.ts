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
  /** Papel GLOBAL mínimo. Só `/dashboard/contas` (plataforma) ainda usa. */
  minRole?: Role
  /**
   * Capacidade exigida (CRM em equipe, Etapa 6.3) — a MESMA que o backend cobra na rota.
   * String livre de propósito: o vocabulário é do backend, e uma capacidade nova lá não pode
   * quebrar a compilação do front.
   */
  capacidade?: string
  exato?: boolean
  aliases?: string[]
}

/**
 * Quem está olhando. `capacidades` chega resolvida por `/api/auth/me`.
 * Uma STRING é aceita por compatibilidade e tratada como o papel global.
 */
export type AcessoNav = { role?: Role; capacidades?: string[] | null } | Role | undefined

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
export function itemVisivel(item: NavItem, acesso: AcessoNav): boolean
export function normalizarAcesso(acesso: AcessoNav): { role?: Role; capacidades: string[] | null }
export function navegacaoVisivel(acesso: AcessoNav, arvore?: NavNo[]): NavNo[]
export function itensVisiveis(acesso: AcessoNav, arvore?: NavNo[]): NavItem[]
export function resolverAtivo(pathname: unknown, acesso: AcessoNav, arvore?: NavNo[]): Ativo
export function normalizarGruposAbertos(valor: unknown, grupoAtivo?: string | null, ids?: string[]): string[]
export function alternarGrupo(abertos: string[] | undefined, id: string, ids?: string[]): string[]
export function lerGruposAbertos(bruto: string | null | undefined): string[]
