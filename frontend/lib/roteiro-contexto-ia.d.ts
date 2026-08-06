export type ObjecaoRoteiro = { objecao: string; resposta: string }

export type EtapaContexto = {
  ordem?: number
  tipo: string
  titulo?: string | null
  objetivo?: string | null
  frase_sugerida?: string | null
  perguntas?: string[]
  sinais_interesse?: string[]
  sinais_resistencia?: string[]
  objecoes?: ObjecaoRoteiro[]
}

export type RoteiroContexto = { nome?: string; descricao?: string | null; nicho?: string | null }
export type VersaoContexto = { versao: number; status: string; publicada_em?: string | null }

export type EntradaContextoIA = {
  roteiro: RoteiroContexto
  versao: VersaoContexto
  etapas?: EtapaContexto[]
  tiposDeEtapaPermitidos?: string[]
}

export type ContextoIA = {
  instrucao_de_analise: string
  nome_do_roteiro: string | null
  versao: number
  status_publicada: true
  publicada_em: string | null
  objetivo: string | null
  publico_alvo: string | null
  restricoes: string[]
  resultados_possiveis_da_ligacao: string[]
  etapas_na_ordem: { posicao: number; tipo: string | null; titulo: string | null }[]
  falas_e_instrucoes_por_etapa: {
    posicao: number
    tipo: string | null
    objetivo_da_etapa: string | null
    frase_sugerida: string | null
  }[]
  perguntas_de_diagnostico: { posicao: number; tipo: string | null; perguntas: string[] }[]
  regras_de_conducao: {
    principios: string[]
    por_etapa: {
      posicao: number
      tipo: string | null
      sinais_de_interesse: string[]
      sinais_de_resistencia: string[]
      objecoes_e_respostas: { objecao: string | null; resposta: string | null }[]
    }[]
  }
}

export const INSTRUCAO_ANALISE: string
export const RESULTADOS_POSSIVEIS_LIGACAO: readonly string[]
export const PRINCIPIOS_DE_CONDUCAO: readonly string[]

export function podeExportarContextoIA(versao?: { status?: string } | null): boolean
export function montarContextoIA(entrada: EntradaContextoIA): ContextoIA
export function serializarContextoIA(entrada: EntradaContextoIA): string
