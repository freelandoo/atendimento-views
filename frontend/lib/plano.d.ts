/** Veredito do backend sobre o plano da empresa (services/plano-definicao.js), vindo pronto de
 *  `/api/auth/me` e de `GET .../plano`. A tela NÃO recalcula nada disto. */
export interface PlanoVeredito {
  nome: string | null
  status: string | null
  trial_fim: string | null
  liberado: boolean
  somenteLeitura: boolean
  /** Vocabulário FECHADO: liberado | plano_atrasado | plano_cancelado | plano_expirado | trial_expirado | status_desconhecido */
  motivo: string
}

export declare const ROTULO_STATUS: Record<string, string>
export declare function precisaAssinar(plano?: PlanoVeredito | null): boolean
export declare function somenteLeitura(plano?: PlanoVeredito | null): boolean
export declare function diasRestantesTrial(plano?: PlanoVeredito | null): number | null
export declare function rotuloStatus(plano?: PlanoVeredito | null): string
export declare function formatarPreco(reais?: number | null): string
export declare function setPlanoAtual(empresaId: string | null, plano?: PlanoVeredito | null): void
export declare function getPlanoAtual(empresaId: string): { conhecido: boolean; plano: PlanoVeredito | null }
