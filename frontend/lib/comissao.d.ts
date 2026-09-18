export type StatusVenda =
  | 'aguardando_pagamento'
  | 'comissao_liberada'
  | 'comissao_paga'
  | 'cancelada'

export type OrigemOriginador = 'historico_lead' | 'operador' | 'sem_originador'

export interface NivelComissao {
  acumulado: number
  percentual: number
  faixa_min: number
  faixa_max: number | null
  proximo: { percentual: number; a_partir_de: number; falta: number } | null
}

export interface FaixaComissao {
  min: number
  max: number | null
  percentual: number
}

export interface PlanoComissao {
  nome: string
  slug: string
  versao: number
  faixas: FaixaComissao[]
  gatilho: string
}

export interface VendaResumo {
  id: string
  valor: number | string
  moeda: string
  descricao: string | null
  fechada_em: string
  status: StatusVenda
  originador_id: string | null
  originador_nome: string | null
  originador_origem: OrigemOriginador
  comissao_percentual: number | string | null
  comissao_valor: number | string | null
  competencia: string | null
  total_pago: number | string
  agenda_evento_id: string | null
}

export interface PainelComissao {
  competencia: string
  plano: PlanoComissao | null
  nivel: NivelComissao | null
  originado: number
  comissao: number
  comissao_paga: number
  vendas_creditadas: number
  vendas: VendaResumo[]
}

export interface LinhaRanking {
  usuario_id: string
  nome: string | null
  originado: number
  vendas: number
  posicao: number
}

export interface AcaoVenda {
  id: 'pagamento' | 'cancelar' | 'pagar'
  rotulo: string
  tom: 'primario' | 'neutro' | 'negativo'
}

export declare const STATUS_VENDA: Record<string, { rotulo: string; ajuda: string; tom: string }>
export declare const ORIGEM_ORIGINADOR: Record<OrigemOriginador, string>

export declare function formatarDinheiro(valor: unknown, moeda?: string): string
export declare function formatarPercentual(p: unknown): string
export declare function rotuloStatus(status: string | null | undefined): { rotulo: string; ajuda: string; tom: string }
export declare function rotuloCompetencia(competencia: string | null | undefined): string
export declare function resumoDoNivel(painel: PainelComissao | null | undefined): {
  configurado: boolean
  titulo: string
  detalhe: string
  progresso: { percentual: number; falta: number; proximo: number | null } | null
}
export declare function medalhaDaPosicao(posicao: number): string | null
export declare function destacarVoce(ranking: LinhaRanking[], usuarioId: string | null | undefined): Array<LinhaRanking & { voce: boolean }>
export declare function acoesDaVenda(venda: VendaResumo | null | undefined, podeGerenciar: boolean): AcaoVenda[]
export declare function motivoNaoCancelavel(venda: VendaResumo | null | undefined): string | null
