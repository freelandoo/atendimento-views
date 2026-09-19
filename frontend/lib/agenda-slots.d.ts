export type MotivoSlot = 'bloqueio' | 'compromisso' | 'agenda_bot' | 'passado'

export type Slot = {
  horario: string
  livre: boolean
  motivo: MotivoSlot | null
  titulo: string | null
}

export type DiaDisponibilidade = {
  data: string
  data_br: string
  horarios: Slot[]
  livres: number
}

export type TipoRecorrencia = 'nenhuma' | 'diaria' | 'semanal'

export type FormBloqueio = {
  data: string
  hora_inicio: string
  hora_fim: string
  titulo?: string
  descricao?: string
  recorrencia: TipoRecorrencia
  repetir_ate?: string
  dias_semana?: number[]
}

export type RespostaBloqueio = {
  criados: number
  eventos: unknown[]
  falhas: { data: string; motivo: string }[]
  /** `false` = o bloqueio vale na tela, mas o bot do WhatsApp ainda oferece o horário. */
  vale_para_bot: boolean
  truncado: boolean
}

export const MOTIVO: Record<'BLOQUEIO' | 'COMPROMISSO' | 'AGENDA_BOT' | 'PASSADO', MotivoSlot>
export const RECORRENCIA: Record<'NENHUMA' | 'DIARIA' | 'SEMANAL', TipoRecorrencia>
export const OPCOES_RECORRENCIA: ReadonlyArray<{ valor: TipoRecorrencia; rotulo: string }>
export const DIAS_SEMANA: ReadonlyArray<{ valor: number; curto: string; nome: string }>
export const MODELOS_BLOQUEIO: ReadonlyArray<{
  id: string
  rotulo: string
  titulo: string
  hora_inicio: string
  hora_fim: string
  recorrencia: TipoRecorrencia
}>

export function aparenciaDoSlot(
  slot: Slot | null,
  selecionado?: boolean
): { classe: string; rotulo: string; descricao: string; clicavel: boolean }

export function resumoDoDia(dia: DiaDisponibilidade | null): { texto: string; vazio: boolean }
export function rotuloDoDia(dataIso: string, hojeIso?: string): { titulo: string; subtitulo: string }
export function impedimentoDoBloqueio(form: FormBloqueio | null): string
export function resumoDoBloqueio(resposta: RespostaBloqueio | null): { texto: string; alerta: string }
