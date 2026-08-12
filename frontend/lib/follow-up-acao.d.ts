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
  /**
   * Veredito HUMANO sobre o WhatsApp do CONTATO (migration 066). Três estados, e o terceiro
   * não é o segundo: `true` verificado e tem · `false` verificado e não tem · `null`/ausente
   * ninguém verificou. Nunca vem de falha de envio.
   */
  whatsapp_disponivel?: boolean | null
  whatsapp_motivo?: string | null
  whatsapp_marcado_em?: string | null
}

/** `true` | `false` | `null` ("ninguém verificou"). `null` NÃO é `false`. */
export type DisponibilidadeWhatsapp = boolean | null

/** Parte de disponibilidade do payload de `POST /itens/:id/reagendar`. Vazio = nada mudou. */
export interface PatchDisponibilidade {
  whatsapp_disponivel?: boolean
  disponibilidade_motivo?: string
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

// ─── Disponibilidade de canal do CONTATO (migration 066) ─────────────────────
export declare const DISPONIBILIDADE_WHATSAPP_LABEL: Record<string, string>
export declare const MARCAR_SEM_WHATSAPP_LABEL: string
export declare const MARCAR_SEM_WHATSAPP_AJUDA: string
export declare const AVISO_TROCA_PARA_LIGACAO: string
export declare const AVISO_CANAL_DESCARTADO: string
export declare function rotuloDisponibilidadeWhatsapp(valor: DisponibilidadeWhatsapp | undefined): string
export declare function canalDescartadoPeloOperador(
  item: { canal?: string | null; whatsapp_disponivel?: DisponibilidadeWhatsapp } | null | undefined,
): boolean
export declare function estadoDisponibilidadeInicial(
  item: { whatsapp_disponivel?: DisponibilidadeWhatsapp } | null | undefined,
): DisponibilidadeWhatsapp
/** Desmarcar é DESFAZER quando já havia marcação; é "não afirmar nada" quando não havia. */
export declare function alternarSemWhatsapp(
  inicial: DisponibilidadeWhatsapp,
  marcado: boolean,
): DisponibilidadeWhatsapp
/** Só devolve campo quando o operador MUDOU o veredito nesta tela. */
export declare function patchDisponibilidade(
  inicial: DisponibilidadeWhatsapp,
  escolhido: DisponibilidadeWhatsapp,
  motivo?: string | null,
): PatchDisponibilidade

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
