export type ProgressoMeta = {
  alvo: number | null
  feito: number
  fracao: number
  faltam: number
  alcancado: boolean
}

export type Proximidade = {
  marco: number
  selo: string | null
  intensidade: string
  frase: string
  largura: string
} | null

export type ModoMeta = 'geral' | 'separado'
export type CanalMeta = 'contatos' | 'ligacoes' | 'mensagens'

export type ConfigMeta = {
  modo: ModoMeta
  alvo_semanal: number
  alvo_ligacoes: number | null
  alvo_mensagens: number | null
  dias_semana: number[]
}

export type MedidaMeta = { chave: CanalMeta; prog: ProgressoMeta }

export type DiaSemana = { iso: number; curto: string; longo: string }

export function proximidade(
  progresso: ProgressoMeta | null | undefined,
  opcoes?: { encerrado?: boolean; formatarValor?: (v: number) => string }
): Proximidade

export const DIAS: ReadonlyArray<DiaSemana>
export const DIAS_UTEIS_PADRAO: ReadonlyArray<number>
export function rotuloDias(dias: number[] | null | undefined): string
export const ROTULO_CANAL: Readonly<Record<CanalMeta, string>>
export function rotuloCanal(chave: string): string
