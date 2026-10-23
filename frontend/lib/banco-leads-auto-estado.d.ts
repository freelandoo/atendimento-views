export type TomEstadoAuto = 'ok' | 'alerta' | 'info' | 'neutro'

export type EstadoAuto =
  | 'modo_manual'
  | 'pausado'
  | 'aguardando_intervalo'
  | 'pronto'
  | 'sem_instancia_pronta'
  | 'aguardando_cooldown_pool'
  | 'teto_diario_pool'
  | 'teto_diario_instancias'
  | 'sem_lead_elegivel'

export type MotivoForaDoRodizio =
  | 'desativada'
  | 'sem_saudacao'
  | 'aguardando_cooldown'
  | 'teto_da_instancia'
  | 'fora_do_pool'

export interface InstanciaNoEstadoAuto {
  id: string
  nome: string
  evolution_instance: string
  principal: boolean
  ativo: boolean
  tem_saudacao: boolean
  disparos_hoje: number
  ultimo_disparo_em: string | null
  cooldown_restante_s: number
  teto_instancia: number | null
  no_rodizio: boolean
  motivo_fora: MotivoForaDoRodizio | string | null
}

export interface RecorteAuto {
  modo: 'nicho' | 'geral'
  nicho: string | null
}

export interface EstadoAutomatico {
  modo: string
  auto_ativo: boolean
  estado: EstadoAuto | string
  janela_inicio: string
  janela_fim: string
  intervalo_min: number
  intervalo_max: number
  teto_diario: number
  timezone: string
  proximo_disparo_em: string | null
  segundos_para_proximo: number
  recorte: RecorteAuto
  leads_candidatos: number
  total_disparos_hoje: number
  instancias_no_rodizio: number
  instancias_disponiveis: number
  menor_cooldown_s: number | null
  instancias: InstanciaNoEstadoAuto[]
}

export interface LeituraEstadoAuto {
  chave: string
  titulo: string
  detalhe: string
  tom: TomEstadoAuto
}

export declare const ESTADOS: Record<string, { titulo: string; detalhe: string; tom: TomEstadoAuto }>
export declare const MOTIVOS_FORA: Record<string, string>
export declare const RESSALVA_CANDIDATOS: string
export declare function leituraEstado(estado: string | null | undefined): LeituraEstadoAuto
export declare function motivoFora(motivo: string | null | undefined): string | null
export declare function classesTom(tom: TomEstadoAuto | string): string
export declare function textoEspera(segundos: number | null | undefined): string | null
export declare function textoRecorte(recorte: RecorteAuto | null | undefined): string
export declare function textoCandidatos(total: number | null | undefined): string
