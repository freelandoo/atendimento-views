export type CanalFollowUp = 'whatsapp' | 'ligacao'
export type StatusFollowUp = 'aguardando' | 'concluido' | 'cancelado' | 'falha'
export type PrioridadeFollowUp = 'alta' | 'media' | 'baixa'
export type OrigemFollowUp = 'ligacao' | 'mensagem' | 'automacao' | 'manual'
export type DestinoFollowUp = 'central_mensagens' | 'central_ligacoes'
/** Inclui `nenhuma`, que é resposta legítima do formulário — não um default escondido. */
export type EscolhaCanal = CanalFollowUp | 'nenhuma'

/** Item de `GET /follow-ups/itens` (a entidade persistida, migration 062). */
export interface FollowUpApi {
  id: string
  canal: CanalFollowUp
  proxima_acao: string
  agendado_para: string
  prioridade: PrioridadeFollowUp
  status: StatusFollowUp
  origem: OrigemFollowUp
  telefone_digitos: string
  responsavel_id: string | null
  responsavel_nome?: string | null
  ligacao_id: string | null
  ligacao_resultado?: string | null
  ligacao_em?: string | null
  campanha_lead_id: string | null
  campanha_id?: string | null
  campanha_nome?: string | null
  prospect_id: string | null
  conversa_numero: string | null
  observacao: string | null
  resultado_nota: string | null
  concluido_em: string | null
  criado_em: string
  nome?: string | null
  cidade?: string | null
}

/** Estado do formulário "Próxima ação" do encerramento da ligação. */
export interface FormProximaAcao {
  canal: EscolhaCanal
  proxima_acao: string
  /** Valor de `<input type="datetime-local">` (horário LOCAL, sem fuso). */
  agendado_para: string
  prioridade: PrioridadeFollowUp | ''
  responsavel_id: string
}

/** Bloco `follow_up` enviado em `POST /ligacoes/:id/encerrar`. */
export interface PayloadProximaAcao {
  canal: CanalFollowUp
  proxima_acao: string
  agendado_para: string | null
  prioridade: string
  responsavel_id: string | null
}

export interface ContextoOrigem {
  titulo: string
  linhas: string[]
}

export interface EventoContato {
  tipo: string
  ocorrido_em: string
  rotulo: string | null
  detalhe: string | null
  referencia_id: string | null
  duracao_seg: number | null
  canal: CanalFollowUp | null
}

export declare const CANAL_LABEL: Record<string, string>
export declare const CANAL_ICONE: Record<string, string>
export declare const CANAL_OPCOES: readonly { valor: EscolhaCanal; label: string; ajuda: string }[]
export declare const ORIGEM_LABEL: Record<string, string>
export declare const STATUS_FOLLOWUP_LABEL: Record<string, string>
export declare const PRIORIDADE_LABEL: Record<string, string>
export declare const PRIORIDADE_OPCOES: readonly { valor: PrioridadeFollowUp; label: string }[]
export declare const DESTINO_POR_CANAL: Record<string, DestinoFollowUp>
export declare const EVENTO_LABEL: Record<string, string>

export declare function rotuloCanal(canal: string | null | undefined): string | null
export declare function iconeCanal(canal: string | null | undefined): string | null
export declare function destinoDoCanal(canal: string | null | undefined): DestinoFollowUp | null
export declare function rotuloOrigem(origem: string | null | undefined): string | null
export declare function rotuloStatusFollowUp(status: string | null | undefined): string | null
export declare function rotuloEvento(tipo: string | null | undefined): string
export declare function formatarQuando(iso: string | Date | null | undefined, agora?: Date): string | null
export declare function classificarPrazoFollowUp(iso: string | null | undefined, agora?: Date, aberto?: boolean): string | null
export declare function resumoProximaAcao(followUp: Partial<FollowUpApi> | null | undefined, agora?: Date): string | null
export declare function sugerirProximaAcao(resultado: string | null | undefined, agora?: Date): FormProximaAcao
export declare function paraInputLocal(data: string | Date | null | undefined): string
export declare function deInputLocal(valor: string | null | undefined): string | null
export declare function validarProximaAcao(form?: Partial<FormProximaAcao>): { ok: boolean; erros: Record<string, string> }
export declare function montarPayloadProximaAcao(form?: Partial<FormProximaAcao>): PayloadProximaAcao | null
export declare function itemDeFollowUp(f: FollowUpApi, agora?: Date): Record<string, unknown>
/**
 * Recebe qualquer item que carregue os campos de follow-up (o `ItemFila` da fila serve).
 * Frouxo de proposito: o contexto e' APRESENTACAO — nao deve amarrar a forma exata do item.
 */
export declare function contextoDeOrigem(
  item: {
    followup_id?: string | null
    canal?: string | null
    origem?: string | null
    acao_label?: string | null
    prazo?: string | null
    prazo_label?: string | null
    ligacao_resultado?: string | null
    ligacao_em?: string | null
    campanha_nome?: string | null
    responsavel_nome?: string | null
    observacao?: string | null
  } | null | undefined,
  agora?: Date,
): ContextoOrigem | null
