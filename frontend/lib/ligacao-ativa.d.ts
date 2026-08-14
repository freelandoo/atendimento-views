export type EstadoSessaoAtiva = 'em_andamento' | 'aguardando_resumo'

/** Item de `GET /api/empresas/:id/ligacoes/ativas?campanha_id=` (payload sanitizado). */
export interface LigacaoAtiva {
  id: string
  campanha_lead_id: string | null
  prospect_id: string | null
  estado_sessao: EstadoSessaoAtiva
  iniciada_em: string | null
  chamada_encerrada_em: string | null
  usuario_id: string | null
  usuario_nome: string | null
  /** Calculado no servidor: o front nunca compara id de usuario. */
  sou_eu: boolean
}

export type AcaoLead = 'ligar' | 'retomar' | 'acompanhar'

export interface AcaoDoLead {
  acao: AcaoLead
  rotulo: string
  somenteLeitura: boolean
  titulo: string
}

export interface SeloLigacaoAtiva {
  texto: string
  titulo: string
  proprio: boolean
}

export declare const ACAO: { LIGAR: 'ligar'; RETOMAR: 'retomar'; ACOMPANHAR: 'acompanhar' }

export declare function indexarAtivasPorLead(
  itens: LigacaoAtiva[] | null | undefined
): Record<string, LigacaoAtiva>
export declare function rotuloOperador(ativa: LigacaoAtiva | null | undefined): string
export declare function acaoDoLead(ativa: LigacaoAtiva | null | undefined): AcaoDoLead
export declare function seloLigacaoAtiva(ativa: LigacaoAtiva | null | undefined): SeloLigacaoAtiva | null
export declare function proximoLigavel<T extends { campanha_lead_id: string }>(
  lista: T[] | null | undefined,
  ativasPorLead: Record<string, LigacaoAtiva> | null | undefined
): T | null
export declare function contarOcupadosPorOutros(
  lista: { campanha_lead_id: string }[] | null | undefined,
  ativasPorLead: Record<string, LigacaoAtiva> | null | undefined
): number
