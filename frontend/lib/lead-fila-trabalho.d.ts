export type FaixaTrabalho =
  | 'cliente_esperando'
  | 'pronto_enviar'
  | 'nunca_abordado'
  | 'abordado_sem_resposta'
  | 'falta_contato'
  | 'em_espera'
  | 'fora_da_fila'

export type TomFaixa = 'urgente' | 'pronto' | 'novo' | 'neutro' | 'atencao' | 'espera'

export interface SeloFaixa {
  chave: string
  rotulo: string
  dica: string
  tom: TomFaixa
}

export interface MetaListagem {
  total?: number
  total_carteira?: number
  limite?: number
}

export interface AvisoJanela {
  total: number
  mostrando: number
  /** "300 de 1240" — cabe num selo de barra. */
  curto: string
  /** A frase inteira, com a orientação. Vai para o `title`, nunca some. */
  texto: string
}

export const ORDEM_FAIXAS: FaixaTrabalho[]
/** Traduz o veredito do backend. Faixa desconhecida ⇒ null (não inventa rótulo). */
export function seloFaixa(faixa?: string | null): SeloFaixa | null
/** Avisa quando a janela da listagem é menor que a carteira filtrada. */
export function avisoDeJanela(meta?: MetaListagem | null): AvisoJanela | null
