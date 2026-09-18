/** Situação da missão, resolvida pelo BACKEND (services/missao.js). */
export type SituacaoMissao = 'agendada' | 'vigente' | 'prazo_vencido' | 'encerrada'

export interface Missao {
  id: string
  titulo: string
  descricao: string | null
  metrica: string
  alvo_valor: string | number
  moeda: string
  inicio: string
  fim: string
  recompensa_descricao: string
  recompensa_valor: string | number | null
  status: 'ativa' | 'encerrada'
  encerrada_em?: string | null
  encerrada_motivo?: 'prazo' | 'decisao' | null
  criado_em?: string
  /** Vem do backend em GET / e GET /historico. */
  situacao?: SituacaoMissao
}

/** Progresso de UMA pessoa — nunca de uma lista de pessoas. */
export interface ProgressoMissao {
  valor: number
  /** `null` quando o alvo é ilegível. */
  alvo: number | null
  faltam: number | null
  /** Fração 0..1, limitada a 1 pelo backend. */
  fracao: number
  alcancado: boolean
  vendas?: number
  /** Etapa 4: `false` e não `null` — quem alcançou sempre tem resposta para "já recebi?". */
  recompensa_paga?: boolean
  recompensa_paga_em?: string | null
  recompensa_valor_pago?: number | null
}

export interface EstadoMinhaRecompensa {
  pago: boolean
  frase: string
  tom: string
}

export interface QuemAlcancou {
  usuario_id: string
  nome: string | null
  valor: number
  vendas: number
  /** Etapa 4: resolvido pelo backend em `juntarBaixas`. */
  pago?: boolean
  pago_em?: string | null
  valor_pago?: number | null
}

export interface RotuloSituacao {
  rotulo: string
  /** neutro | positivo | espera | concluido — mesmos tons da tela de Comissão. */
  tom: string
  explicacao: string
}

export interface ResumoProgresso {
  alcancado: boolean
  /** O valor já feito, formatado. */
  titulo: string
  frase: string
  /** Largura da barra em CSS ("62%"). */
  larguraBarra: string
  tom: string
}

export interface ResumoAlcancaram {
  total: number
  /** Quantas pessoas ainda não receberam — o que resta FAZER. */
  pendentes: number
  frase: string
  itens: {
    usuario_id: string
    nome: string
    valor: string
    pago: boolean
    rotuloPagamento: string
  }[]
}

/** Reexportado de `lib/comissao.js` — missão e comissão falam do MESMO dinheiro. */
export function formatarDinheiro(valor: number | string | null | undefined): string

export function rotuloSituacao(situacao: string | null | undefined): RotuloSituacao
export function dataBR(iso: string | null | undefined): string
export function janelaTexto(missao: Missao | null | undefined): string
export function recompensaTexto(missao: Missao | null | undefined): string

export function resumoDoProgresso(
  progresso: ProgressoMissao | null | undefined,
  situacao?: string | null
): ResumoProgresso

/** `null` quando a lista não veio (quem não gerencia não a recebe). */
export function resumoDeQuemAlcancou(lista: QuemAlcancou[] | null | undefined): ResumoAlcancaram | null

/** `null` para quem ainda não alcançou: prometer entrega a quem não bateu o alvo seria pior que calar. */
export function minhaRecompensa(progresso: ProgressoMissao | null | undefined): EstadoMinhaRecompensa | null
