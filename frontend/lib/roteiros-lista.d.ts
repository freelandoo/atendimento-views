export type StatusRoteiro = 'rascunho' | 'publicado' | 'arquivado'
export type StatusVersao = 'rascunho' | 'publicada' | 'arquivada'

/** Linha de `GET /api/empresas/:id/roteiros`. */
export type RoteiroLista = {
  id: string
  nome: string
  descricao?: string | null
  nicho?: string | null
  ativo?: boolean
  versao_publicada?: number | null
  total_versoes?: number
}

export type RoteiroComStatus = RoteiroLista & { status: StatusRoteiro }

export type GrupoRoteiros = {
  /** Nicho normalizado (minusculo/sem espacos) ou `__sem_nicho__`. */
  chave: string
  /** Nicho como o operador ve ("Academias", "Sem nicho"). */
  rotulo: string
  itens: RoteiroComStatus[]
}

export type ListaRoteiros = {
  grupos: GrupoRoteiros[]
  arquivados: RoteiroComStatus[]
  totalAtivos: number
  totalArquivados: number
}

export type VersaoResumo = { id: string; versao: number; status: StatusVersao }

export type AcoesRoteiro = {
  podeEditar: boolean
  podePublicar: boolean
  podeCriarVersao: boolean
  podeExportar: boolean
  podeArquivar: boolean
  podeDesarquivar: boolean
}

export type TextoConfirmacao = {
  titulo: string
  confirmar: string
  corpo: string
  aviso: string | null
}

export function statusDoRoteiro(roteiro?: RoteiroLista | null): StatusRoteiro
export function rotuloStatusRoteiro(status: string): string
export function fraseStatusRoteiro(status: string): string
export function rotuloStatusVersao(status: string): string
export function fraseStatusVersao(status: string): string
export function rotuloNicho(nicho?: string | null): string
export function montarListaRoteiros(roteiros?: RoteiroLista[] | null): ListaRoteiros
export function versaoInicial<T extends VersaoResumo>(versoes?: T[] | null): T | null
export function acoesDoRoteiro(entrada?: {
  statusRoteiro?: string
  statusVersao?: string
  carregando?: boolean
  temVersao?: boolean
}): AcoesRoteiro
export function textoConfirmacao(
  acao: 'arquivar' | 'desarquivar',
  roteiro?: { nome?: string; campanhas_usando?: number | null } | null,
): TextoConfirmacao
