/** Veredito do backend sobre a entrada no programa (services/programa-aceite.js).
 *  A tela NÃO recalcula nada disto — recebe pronto de `/api/auth/me` e de `GET .../programa/termo`. */
export interface ProgramaAceiteVeredito {
  liberado: boolean
  /** Vocabulário FECHADO: plataforma | nao_sujeito | aceite_vigente | aceite_ausente | aceite_desatualizado */
  motivo: string
  /** A versão que precisa ser aceita, quando há bloqueio. */
  versao_exigida: string | null
}

export interface SecaoTermo {
  titulo: string
  paragrafos: string[]
}

export interface TermoVigente {
  versao: string
  titulo: string
  secoes: SecaoTermo[]
  hash: string
}

export interface SituacaoTermo {
  titulo: string
  texto: string
}

export interface MetricasRolagem {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

export interface SinaisDoAceite {
  rolouAteFim?: boolean
  maioridade?: boolean
  leuRegras?: boolean
  enviando?: boolean
}

export interface EstadoBotao {
  habilitado: boolean
  /** O que falta. Vazio quando habilitado — botão inerte nunca fica mudo. */
  motivo: string
  rotulo: string
}

/** Veredito ausente devolve `false`: a tela nunca inventa um bloqueio que a API não declarou. */
export function precisaAceitar(programaAceite: ProgramaAceiteVeredito | null | undefined): boolean

export function situacaoDoTermo(motivo: string | null | undefined): SituacaoTermo

/** Texto que cabe inteiro na tela conta como lido. Folga em px para alturas fracionadas. */
export function rolouAteOFim(metricas?: Partial<MetricasRolagem>, folgaPx?: number): boolean

/** Exige os TRÊS sinais. Nenhum vale por outro. */
export function estadoDoBotao(sinais?: SinaisDoAceite): EstadoBotao
