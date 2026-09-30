export interface Razoes {
  contatos: number
  reunioes: number
  por_100_contatos: number | null
  por_ligacao: number | null
  por_mensagem: number | null
  taxa_resposta: number | null
}
export interface DiaSerie {
  dia: string
  mensagens: number
  ligacoes: number
  ligacoes_atendidas: number
  conversou: number
  reunioes_humano: number
  reunioes_bot: number
}
export interface LinhaCanal {
  canal: string
  mensagens: number
  ligacoes: number
  ligacoes_atendidas: number
  conversou: number
  reunioes: number
  por_100_contatos: number | null
  taxa_resposta: number | null
}
export interface LinhaFunil { estagio: string; rotulo: string; n: number; pct: number }
export const ROTULO_CANAL: Record<string, string>
export const ESTAGIO_ROTULO: Record<string, string>
export function rotuloCanal(c: string | null | undefined): string
export function idadeEquipe(criadoEm: string | number | Date | null | undefined, agora?: Date): string
export function ordenarFunil(rows: Array<{ estagio: string; n: number | string }> | null | undefined): LinhaFunil[]
export interface EtapaFunil { estagio: string; rotulo: string; n: number; acumulado: number; larguraPct: number; quedaPct: number | null }
export function funilComQueda(rows: Array<{ estagio: string; n: number | string }> | null | undefined): { etapas: EtapaFunil[]; outros: number }
export function destaquesRanking(ranking: LinhaCanal[] | null | undefined, minAmostra?: number): { maisReunioes: LinhaCanal | null; maiorConversao: LinhaCanal | null; maiorResposta: LinhaCanal | null }
export interface HoraBarra { hora: number; valor: number; pct: number }
export function histogramaHoras(rows: Array<{ hora: number | string; [k: string]: number | string }> | null | undefined, chave?: string): { horas: HoraBarra[]; pico: { hora: number; valor: number } | null }
export function janelaPreset(preset: string, hoje?: Date): { de: string; ate: string }
export function janelaAnterior(de: string, ate: string): { de: string; ate: string }
export interface DeltaInfo { abs: number; pct: number | null; seta: string; novo: boolean }
export function formatarDelta(atual: number | null | undefined, anterior: number | null | undefined): DeltaInfo
export function fmt(n: number | string | null | undefined): string
export function fmtTaxa(v: number | null | undefined): string
export function fraseRazao(razoes: Partial<Razoes> | null | undefined): string
export function maxSerie(serie: readonly any[] | null | undefined, chaves: string[]): number
export function larguraPct(valor: number | null | undefined, max: number): number
