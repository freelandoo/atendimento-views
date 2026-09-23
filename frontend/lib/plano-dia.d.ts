export type EtapaDia = 'para_hoje' | 'em_trabalho' | 'aguardando_retorno' | 'feito'

export interface ColunaQuadro {
  chave: EtapaDia
  titulo: string
  resumo: string
  /** O que o movimento NÃO faz. Existe para ninguém ler o quadro como se fosse o funil. */
  consequencia: string
  tom: 'neutro' | 'info' | 'warn' | 'ok'
}

export interface CardDia {
  id: string
  etapa: EtapaDia
  ordem: number
  objetivo: string | null
  origem_entrada: string
  conclusao_tipo: string | null
  conclusao_nota: string | null
  concluido_em: string | null
  prospect_id: string
  nome: string | null
  telefone: string | null
  origem: string | null
  instagram_handle?: string | null
  cidade?: string | null
  nicho?: string | null
  status?: string | null
  icp_faixa?: string | null
  icp_score?: number | null
  bloqueado_ate?: string | null
  proximo_agendamento?: string | null
}

export const COLUNAS: ColunaQuadro[]
export const CHAVES: EtapaDia[]
export function coluna(chave: string): ColunaQuadro | null
export function montarColunas(itens: CardDia[] | null | undefined): (ColunaQuadro & { cards: CardDia[] })[]
/** O que a coluna de destino vai cobrar. Quem VERIFICA é o servidor. */
export function aoMoverPara(chave: string): {
  ok: boolean
  motivo: string
  titulo?: string
  consequencia?: string
  exigeEvidencia: boolean
}
export function seloConclusao(item: CardDia | null | undefined): { rotulo: string; dica: string; prova: boolean; classe: string } | null
export function seloOrigemEntrada(origem: string | null | undefined): { rotulo: string; dica: string } | null
export function horarioDoCard(item: CardDia | null | undefined, formatar?: (iso: string) => string): string
/** Só lê `etapa` — por isso aceita qualquer objeto que a tenha (a home passa o payload cru). */
export function resumoDoDia(itens: { etapa?: string | null }[] | null | undefined): {
  total: number
  porColuna: Record<string, number>
  texto: string
}
/** A prévia das pendências. Nunca move nada. */
export function avisoPendentes(pendentes: unknown[] | null | undefined): { total: number; texto: string; acao: string } | null
export function rotuloDia(dia: string | null | undefined, hoje: string | null | undefined): string
export function somarDias(dia: string | null | undefined, quantidade: number): string
export function diasDaSemana(dia: string | null | undefined): string[]
export function rotuloDiaCurto(dia: string | null | undefined, hoje: string | null | undefined): string
export function rotuloSemana(dias: string[] | null | undefined): string
export function resumoDoPeriodo(
  linhas: {
    dia?: string | null
    total?: number | string | null
    feitos?: number | string | null
    abertos?: number | string | null
    para_hoje?: number | string | null
    em_trabalho?: number | string | null
    aguardando_retorno?: number | string | null
  }[] | null | undefined,
  dias: string[] | null | undefined,
): {
  dia: string
  total: number
  feitos: number
  abertos: number
  para_hoje: number
  em_trabalho: number
  aguardando_retorno: number
}[]
