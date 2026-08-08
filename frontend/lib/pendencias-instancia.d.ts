export type MotivoPendencia = 'sem_instancia' | 'instancia_desconhecida' | 'erro_resolucao'
export type AcaoPendencia = 'mapear_instancia' | 'revisar_webhook_evolution' | 'verificar_infraestrutura'
export type TomPendencia = 'ok' | 'atencao' | 'alerta' | 'neutro'

export interface PendenciaInstancia {
  id: number
  evolution_instance: string | null
  motivo: MotivoPendencia
  acao: AcaoPendencia | null
  transitorio: boolean
  ocorrencias: number
  primeira_em: string
  ultima_em: string
  resolvida_em: string | null
  resolvida_empresa_id: string | null
  resolvida_empresa: string | null
}

export interface ResumoPendencias {
  total: number
  por_motivo: Record<string, { pendencias: number; ocorrencias: number }>
}

export declare const ROTULO_MOTIVO: Record<string, string>
export declare const EXPLICACAO_MOTIVO: Record<string, string>
export declare const ACAO_MOTIVO: Record<string, string>

export declare function rotuloMotivo(motivo: string | null | undefined): string
export declare function explicacaoMotivo(motivo: string | null | undefined): string
export declare function acaoTexto(acao: string | null | undefined): string
export declare function podeReprocessar(pendencia: PendenciaInstancia | null | undefined): boolean
export declare function tomPendencia(pendencia: PendenciaInstancia | null | undefined): TomPendencia
export declare function resumoTexto(resumo: ResumoPendencias | null | undefined): string
