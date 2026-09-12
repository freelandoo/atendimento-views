/** Papel POR EMPRESA (app.usuarios_empresas.role). Espelha PAPEIS de acesso-capacidades.js. */
export type PapelEmpresa = 'owner' | 'admin' | 'comercial' | 'member'

/** Slug de capacidade. String livre de propósito: o vocabulário é do BACKEND, e uma capacidade
 *  nova no servidor não pode quebrar a compilação do front. */
export type Capacidade = string

export interface MembroEmpresa {
  /** id do VÍNCULO (app.usuarios_empresas.id), não do usuário. */
  id: string
  usuario_id: string
  nome: string
  email: string
  role: PapelEmpresa
  /** vínculo ativo nesta empresa */
  ativo: boolean
  /** conta ativa na plataforma (app.usuarios.ativo) */
  usuario_ativo?: boolean
  permissoes?: Record<string, boolean> | null
  criado_em?: string | null
  criado_por?: string | null
  ultimo_acesso_em?: string | null
  ultimo_login_em?: string | null
}

export interface ConcessaoFormulario {
  capacidade: Capacidade
  rotulo: string
  /** Consequência de conceder, ou null quando não há efeito externo. */
  aviso: string | null
  marcada: boolean
}

export interface SituacaoMembro {
  ativo: boolean
  rotulo: string
  detalhe: string
}

export interface AcoesMembro {
  podeEditar: boolean
  /** Por que não pode. Vazio quando pode. */
  motivo: string
}

export const PAPEL_ROTULO: Record<string, string>
export const CAPACIDADE_ROTULO: Record<string, string>

export function rotuloPapel(papel: string | null | undefined): string
export function descricaoPapel(papel: string | null | undefined): string
export function rotuloCapacidade(capacidade: string | null | undefined): string
export function avisoCapacidade(capacidade: string | null | undefined): string | null

/** Consulta a lista resolvida pelo SERVIDOR. Lista ausente = não tem. */
export function temCapacidade(
  capacidades: Capacidade[] | null | undefined,
  capacidade: Capacidade
): boolean

export function concessoesDoFormulario(
  concedeveis: Capacidade[] | null | undefined,
  jaConcedidas: Record<string, boolean> | null | undefined
): ConcessaoFormulario[]

/** Somente aditivo: desmarcada é omitida, nunca enviada como false. */
export function corpoPermissoes(marcadas: Capacidade[] | null | undefined): Record<string, true>

export function situacaoMembro(membro: MembroEmpresa | null | undefined): SituacaoMembro
export function ultimoAcesso(valor: string | null | undefined, agora?: Date): string
export function acoesDoMembro(
  membro: MembroEmpresa | null | undefined,
  usuarioLogadoId: string | null | undefined
): AcoesMembro

// ─── Agrupamento por área e resumo do papel ──────────────────────────────────────────────

export interface GrupoCapacidade { id: string; rotulo: string }
export interface GrupoDeConcessoes extends GrupoCapacidade { itens: ConcessaoFormulario[] }
export interface CapacidadeRotulada { capacidade: Capacidade; rotulo: string }
export interface GrupoDoPapel extends GrupoCapacidade { itens: CapacidadeRotulada[] }
export interface ExtraDoMembro extends CapacidadeRotulada { aviso: string | null }

export declare const GRUPOS: readonly GrupoCapacidade[]

/** Slug desconhecido cai em "outras" — nunca some da tela. */
export function grupoDaCapacidade(capacidade: string | null | undefined): string

/** Agrupa por área na ordem de GRUPOS. Grupo vazio é omitido; nenhum item é descartado. */
export function agruparConcessoes(itens: ConcessaoFormulario[] | null | undefined): GrupoDeConcessoes[]

/** O que o papel JÁ inclui (vem pronto do backend em `opcoes.papeis[].incluidas`). */
export function resumoDoPapel(incluidas: Capacidade[] | null | undefined): GrupoDoPapel[]

/** As liberações extras de um membro: QUAIS são, não quantas. */
export function extrasDoMembro(membro: MembroEmpresa | null | undefined): ExtraDoMembro[]
