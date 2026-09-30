export interface Razoes {
  contatos: number
  reunioes: number
  por_100_contatos: number | null
  por_ligacao: number | null
  por_mensagem: number | null
}
export interface DiaSerie {
  dia: string
  mensagens: number
  ligacoes: number
  ligacoes_atendidas: number
  reunioes_humano: number
  reunioes_bot: number
}
export interface LinhaCanal {
  canal: string
  mensagens: number
  ligacoes: number
  ligacoes_atendidas: number
  reunioes: number
  por_100_contatos: number | null
}
export const ROTULO_CANAL: Record<string, string>
export function rotuloCanal(c: string | null | undefined): string
export function idadeEquipe(criadoEm: string | number | Date | null | undefined, agora?: Date): string
export function fmt(n: number | string | null | undefined): string
export function fmtTaxa(v: number | null | undefined): string
export function fraseRazao(razoes: Partial<Razoes> | null | undefined): string
export function maxSerie(serie: readonly any[] | null | undefined, chaves: string[]): number
export function larguraPct(valor: number | null | undefined, max: number): number
