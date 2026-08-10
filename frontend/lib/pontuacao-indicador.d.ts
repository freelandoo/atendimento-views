export type VarianteIndicador = 'prioridade_comercial' | 'completude_cadastro'

export type SinalFator = 'positivo' | 'negativo' | 'ausente' | 'neutro'

/** Item auditavel exibido no tooltip. `peso` ja vem formatado ('+25', '−25', '✓', '✗ (+20)'). */
export type FatorPontuacao = {
  rotulo: string
  peso?: string
  sinal?: SinalFator
  detalhe?: string
}

export type CriterioCadastro = {
  chave?: string
  label: string
  ok: boolean
  pontos?: number
  pontos_possiveis?: number
}

export type CriterioInteresse = {
  delta: number
  titulo: string
  detalhe?: string
  tipo?: string
}

export type LeituraCadastro = {
  faixa: 'completo' | 'parcial' | 'incompleto' | null
  titulo: string
  lacunas: number
  maximo: number
}

export declare const VARIANTES: {
  PRIORIDADE: 'prioridade_comercial'
  COMPLETUDE: 'completude_cadastro'
}
export declare const PALETAS: Record<VarianteIndicador, Record<string, string>>
export declare const CLASSE_SEM_VALOR: string
export declare const NOTA_COMPLETUDE: string
export declare const O_QUE_MEDE: Record<
  'prioridade_ligacao' | 'interesse_conversa' | 'cadastro_places' | 'cadastro_instagram',
  string
>

export declare function normalizarFaixa(
  variante: VarianteIndicador,
  faixa: string | null | undefined
): string | null
export declare function normalizarValor(
  valor: number | null | undefined,
  maximo?: number
): number | null
export declare function classesDaBolinha(
  variante: VarianteIndicador,
  faixa: string | null | undefined,
  valor: number | null | undefined
): string
export declare function textoValor(valor: number | null | undefined, maximo?: number): string
export declare function resumoTextual(dados: {
  titulo?: string
  valor?: number | null
  maximo?: number
  oQueMede?: string
  fatores?: FatorPontuacao[]
  nota?: string
}): string
/** Contexto opcional do SITE: faz o critério booleano do backend dizer as três situações. */
export interface ContextoSiteCadastro {
  situacaoSite?: 'tem_site' | 'sem_site' | 'nao_identificado' | null
  rotuloLink?: string | null
}
export declare const ROTULO_SITE_POR_SITUACAO: Record<string, string>
export declare function fatoresDeCadastro(
  criterios: CriterioCadastro[] | null | undefined,
  contexto?: ContextoSiteCadastro | null,
): FatorPontuacao[]
export declare function fatoresDeInteresse(
  criterios: CriterioInteresse[] | null | undefined
): FatorPontuacao[]
export declare function fatoresDeMotivos(
  motivos: string[] | null | undefined
): FatorPontuacao[]
export declare function leituraCadastro(
  valor: number | null | undefined,
  maximo?: number,
  criterios?: CriterioCadastro[] | null
): LeituraCadastro
