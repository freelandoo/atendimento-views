// Tipos de `lib/equipe-painel.js` — apresentação pura do painel da equipe (Etapa 12).

export interface AtividadeHoje {
  acoes: number
  leads_assumidos: number
  leads_marcados: number
  contatos_registrados: number
  respondidos: number
  fechados: number
  ligacoes_encerradas: number
  followups_tratados: number
  primeira_acao_em?: string | null
  ultima_acao_em?: string | null
  janela_ativa_min: number
}

export interface LinhaEquipe {
  usuario_id: string | null
  nome: string
  email?: string
  papel?: string
  ativo?: boolean
  ultimo_acesso_em?: string | null
  leads: number
  /** SUBCONJUNTO de `leads` (Etapa 3). Não entra em `cargaAtual` — seria contagem dupla. */
  leads_parados?: number
  leads_parados_mais_antigo_dias?: number | null
  conversas: number
  follow_ups_aguardando: number
  follow_ups_vencidos?: number
  ligacoes?: number
  atividade_hoje?: Partial<AtividadeHoje> | null
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
export declare const ATIVIDADE_HOJE_COLUNAS: readonly ColunaEquipe[]
export declare const PAPEL_ROTULO: Record<string, string>
export declare function rotuloPapel(papel: string | null | undefined): string
export declare function cargaAtual(linha: Partial<LinhaEquipe> | null | undefined): number
export declare function ordenarEquipe(linhas: LinhaEquipe[] | null | undefined): LinhaEquipe[]
export declare function temTrabalhoSemDono(semResponsavel: Partial<LinhaEquipe> | null | undefined): boolean
export declare function avisoDeInativo(linha: Partial<LinhaEquipe> | null | undefined): string
export declare function rotuloUltimoAcesso(iso: string | null | undefined): string
export declare function atividadeHoje(linha: Partial<LinhaEquipe> | null | undefined): AtividadeHoje
export declare function janelaAtivaRotulo(minutos: number | null | undefined): string
export declare function ordenarPorAtividadeHoje(linhas: LinhaEquipe[] | null | undefined): LinhaEquipe[]
export declare function descreverAtividade(evento: EventoAuditoria | null | undefined): {
  rotulo: string
  conhecida: boolean
  entidade: string
  quando: string
}
