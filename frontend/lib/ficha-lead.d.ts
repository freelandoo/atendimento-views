export type SecaoFicha = 'resumo' | 'conversa' | 'qualificacao' | 'fontes'

export interface AbaFichaLead {
  chave: SecaoFicha
  rotulo: string
  dica: string
  disponivel: boolean
  /** Vazio quando disponível. Aba indisponível aparece desabilitada COM o motivo em texto. */
  motivo: string
}

export interface VereditosFicha {
  /** `!!lead.telefone` — decidido pela tela, não por este módulo. */
  temTelefone?: boolean
}

export const SECOES: SecaoFicha[]
export const ROTULOS: Record<SecaoFicha, { rotulo: string; dica: string }>

export function abasDaFicha(vereditos?: VereditosFicha): AbaFichaLead[]
/** Qual seção cada gatilho da listagem abre. Desconhecido ⇒ 'resumo'. */
export function secaoDoGatilho(gatilho?: string | null): SecaoFicha
export function normalizarSecao(secao?: string | null): SecaoFicha
/** A seção que a ficha abre de fato, com o motivo quando a pedida não estava disponível. */
export function secaoInicial(pedida?: string | null, vereditos?: VereditosFicha): { secao: SecaoFicha; motivo: string }
export function classesAba(ativa: boolean, disponivel: boolean): string
