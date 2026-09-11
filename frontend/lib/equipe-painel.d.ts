// Tipos de `lib/equipe-painel.js` — apresentação pura do painel da equipe (Etapa 12).

export interface LinhaEquipe {
  usuario_id: string | null
  nome: string
  email?: string
  papel?: string
  ativo?: boolean
  ultimo_acesso_em?: string | null
  leads: number
  conversas: number
  follow_ups_aguardando: number
  follow_ups_vencidos?: number
  ligacoes?: number
}

export interface ColunaEquipe { chave: string; rotulo: string; oQueMede: string }

export interface EventoAuditoria {
  id?: string
  acao?: string
  entidade_tipo?: string
  entidade_id?: string | null
  contexto?: Record<string, unknown> | null
  ocorrido_em?: string | null
}

export declare const COLUNAS: readonly ColunaEquipe[]
export declare const PAPEL_ROTULO: Record<string, string>
export declare function rotuloPapel(papel: string | null | undefined): string
export declare function cargaAtual(linha: Partial<LinhaEquipe> | null | undefined): number
export declare function ordenarEquipe(linhas: LinhaEquipe[] | null | undefined): LinhaEquipe[]
export declare function temTrabalhoSemDono(semResponsavel: Partial<LinhaEquipe> | null | undefined): boolean
export declare function avisoDeInativo(linha: Partial<LinhaEquipe> | null | undefined): string
export declare function rotuloUltimoAcesso(iso: string | null | undefined): string
export declare function descreverAtividade(evento: EventoAuditoria | null | undefined): {
  rotulo: string
  conhecida: boolean
  entidade: string
  quando: string
}
