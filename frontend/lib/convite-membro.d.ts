/** Convite de cadastro por link — apresentação PURA. Só traduz o veredito da API. */

export type SituacaoConvite = 'pendente' | 'usado' | 'revogado' | 'expirado'

export interface ConviteMembro {
  id: string
  role: string
  equipe_id: string | null
  equipe_nome: string | null
  rotulo: string | null
  criado_em: string
  criado_por_nome: string | null
  expira_em: string
  usado_em: string | null
  usado_por_nome: string | null
  revogado_em: string | null
  situacao: SituacaoConvite | string
}

export interface OpcaoPapelEntrada {
  papel: string
  convidavel?: boolean
  exige_equipe?: boolean
}

export interface EquipeParaConvite {
  id: string
  nome: string
  status: string
  nicho_nome?: string | null
}

export declare const SITUACAO: Readonly<Record<SituacaoConvite, { rotulo: string; tom: string }>>
export declare function rotuloSituacao(situacao: string | null | undefined): { rotulo: string; tom: string }
export declare function linkDoConvite(origem: string, token: string): string
export declare function tempoRestante(expiraEm: string | null | undefined, agora?: Date): string
export declare function papeisDoConvite(opcoes: { papeis?: OpcaoPapelEntrada[] } | null | undefined): string[]
export declare function papelExigeEquipe(opcoes: { papeis?: OpcaoPapelEntrada[] } | null | undefined, papel: string): boolean
export declare function equipesQueRecebem<T extends { status?: string }>(equipes: T[] | null | undefined): T[]
export declare function contarPendentes(convites: { situacao?: string }[] | null | undefined): number
