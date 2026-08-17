export type EstadoSessaoAtiva = 'em_andamento' | 'aguardando_resumo'
export type DispositivoSessao = 'computador' | 'celular'
export type DesfechoSessao = 'encerrada' | 'descartada'

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
  /**
   * A ultima acao desta ligacao partiu DESTA sessao? `null` = nao da para saber (origem nao
   * registrada de um dos lados) — nunca tratar como `false`.
   */
  mesma_sessao: boolean | null
  /** Classe de aparelho da ultima acao. Nunca modelo, sistema ou identificador. */
  sessao_dispositivo: DispositivoSessao | null
}

/** Resposta de `GET /api/empresas/:id/ligacoes/:ligacaoId/sessao` (payload sanitizado). */
export interface SessaoLigacao {
  id: string
  status: string
  estado_sessao: string
  /** Publicado pronto pelo servidor: a tela nao decide sozinha quando a sessao acabou. */
  viva: boolean
  desfecho: DesfechoSessao | null
  sou_eu: boolean
  mesma_sessao: boolean | null
  sessao_dispositivo: DispositivoSessao | null
  usuario_id: string | null
  usuario_nome: string | null
  campanha_lead_id: string | null
  prospect_id: string | null
  iniciada_em: string | null
  chamada_encerrada_em: string | null
  encerrada_em: string | null
  descartada_em: string | null
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

export interface DesfechoRemoto {
  desfecho: DesfechoSessao
  titulo: string
  detalhe: string
  aviso: string
  tom: 'neutro' | 'atencao'
}

export interface SaidasDaFila {
  saidas: string[]
  avisar: boolean
}

export declare const ACAO: { LIGAR: 'ligar'; RETOMAR: 'retomar'; ACOMPANHAR: 'acompanhar' }
export declare const APARELHO: Record<DispositivoSessao, string>

export declare function indexarAtivasPorLead(
  itens: LigacaoAtiva[] | null | undefined
): Record<string, LigacaoAtiva>
export declare function rotuloOperador(ativa: { sou_eu?: boolean; usuario_nome?: string | null } | null | undefined): string
export declare function rotuloAparelho(
  item: { mesma_sessao?: boolean | null; sessao_dispositivo?: DispositivoSessao | null } | null | undefined
): string
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

export declare function sessaoTerminou(sessao: SessaoLigacao | null | undefined): boolean
export declare function descreverDesfechoRemoto(
  sessao: SessaoLigacao | null | undefined,
  opcoes?: { operando?: boolean }
): DesfechoRemoto | null
export declare function saidasDaFila(
  antes: Record<string, LigacaoAtiva> | null | undefined,
  depois: Record<string, LigacaoAtiva> | null | undefined
): SaidasDaFila
