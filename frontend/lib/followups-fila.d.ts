export type SituacaoFila = 'aberto' | 'aguardando' | 'falha' | 'concluido' | 'cancelado'
export type PrioridadeFila = 'alta' | 'media' | 'baixa'
export type PrazoQuando = 'agora' | 'atrasado' | 'hoje' | 'futuro' | 'passado'
export type FiltroRapido =
  | 'todos' | 'aguardando' | 'hoje'
  | 'whatsapp' | 'ligacao'
  | 'humano' | 'ia' | 'falhas' | 'concluidos'

import type {
  CanalFollowUp, StatusFollowUp, OrigemFollowUp, DestinoFollowUp, FollowUpApi,
  DisponibilidadeWhatsapp,
} from './follow-up-acao'

/** Item de `GET /follow-ups/call-list` (fila de atendimento humano). */
export interface AtendimentoHumano {
  numero: string
  telefone_digitos: string
  /** Apelido ou negócio. NULO quando o lead não tem nome — nunca o JID do Evolution. */
  nome: string | null
  negocio: string | null
  cidade: string | null
  estagio: string
  dias_silencio: number
  score: number
  temperatura: 'quente' | 'morno' | 'frio'
  motivo: string
  motivos: string[]
  followups_ignorados: number
  escalado: boolean
  acao_recomendada: string
  acao_label: string
  janela_recomendada: string
  /** Chave fechada da mesma janela, publicada por `services/followup-call-score.js`. */
  janela_quando: 'agora' | 'hoje' | 'proximo_dia_util' | null
  orientacao: string
  prompt_preview: string | null
}

/** Item de `GET /follow-ups/auto` (agendamento do motor automático). */
export interface AgendamentoAuto {
  id: number
  numero: string
  sequencia: number
  status: 'agendado' | 'executado' | 'cancelado' | 'falhou'
  agendado_para: string | null
  executado_em: string | null
  cancelado_em: string | null
  motivo_decisao: string | null
  detectado_em: string | null
  estagio: string | null
  nome: string | null
}

/** Sugestão da busca assistida do Follow-up manual (`GET /follow-ups/manual/leads`). */
export interface SugestaoLead {
  numero: string
  telefone_digitos: string
  nome: string | null
  cidade: string | null
  estagio: string | null
}

/** Uma linha da fila = uma conversa, com a próxima ação já decidida. */
export interface ItemFila {
  id: string
  numero: string
  telefone_digitos: string
  /** Nome real do negócio, ou `null`. Identificador do Evolution nunca chega aqui. */
  nome: string | null
  /** O que a tela mostra: o nome, ou o telefone formatado na falta dele. */
  rotulo: string
  contexto: string | null
  /** Linha secundária da fila: só a cidade (localização), nunca negócio/nicho — evita repetir o
   *  que o `rotulo` já mostra. `null` quando não há cidade conhecida. */
  localizacao: string | null
  estagio: string | null
  humano: boolean
  ia_agendada: boolean
  origem_label: string
  situacao: SituacaoFila
  acao: string | null
  acao_label: string | null
  prazo: string | null
  prazo_quando: PrazoQuando | null
  prazo_label: string | null
  prioridade: PrioridadeFila | null
  prioridade_score: number | null
  motivo: string | null
  orientacao: string | null
  escalado: boolean
  dias_silencio: number
  prompt_preview: string | null
  tentativas: number
  tem_falha: boolean
  falha_motivo: string | null
  ia_status: AgendamentoAuto['status'] | null
  ia_data: string | null
  ia_data_label: string | null
  ia_id: number | null

  // --- Follow-up REGISTRADO (migration 062). Todos `null` num item derivado: canal,
  // responsável e origem só existem onde uma pessoa escolheu — a fila não os presume.
  followup_id: string | null
  followup_status: StatusFollowUp | null
  canal: CanalFollowUp | null
  origem: OrigemFollowUp | null
  responsavel_id: string | null
  responsavel_nome: string | null
  campanha_lead_id: string | null
  campanha_id: string | null
  campanha_nome: string | null
  prospect_id: string | null
  ligacao_id: string | null
  ligacao_resultado: string | null
  ligacao_em: string | null
  observacao: string | null
  resultado_nota: string | null
  destino: DestinoFollowUp | null

  // --- Disponibilidade de canal do CONTATO (migration 066). `null` = ninguém verificou, e é
  // também o que um item derivado carrega: o veredito acompanha o follow-up registrado.
  whatsapp_disponivel: DisponibilidadeWhatsapp
  whatsapp_motivo: string | null
}

export interface ViewFollowups {
  busca: string
  acao: string
  canal: string
  prioridade: string
  /** Atendimento: `humano` | `ia` — quem cuida do item hoje. */
  origem: string
  /** O que GEROU a próxima ação: `ligacao` | `mensagem` | `automacao` | `manual`. */
  origemAcao: string
  /** Id do usuário, ou `sem` para "não atribuído". */
  responsavel: string
  situacao: string
  dataDe: string
  dataAte: string
  tentativasMin: string
  falhaTexto: string
}

export interface FiltroRapidoDef {
  valor: FiltroRapido
  label: string
  descricao: string
}

export declare const SITUACOES: Record<string, SituacaoFila>
export declare const SITUACAO_LABEL: Record<string, string>
export declare const ACAO_IA_LABEL: Record<string, string>
export declare const PRIORIDADE_LABEL: Record<string, string>
export declare const FILTROS_RAPIDOS: readonly FiltroRapidoDef[]
export declare const VIEW_PADRAO: ViewFollowups

export declare function montarFila(entrada: {
  humanos?: AtendimentoHumano[]
  automaticos?: AgendamentoAuto[]
  /** Follow-ups persistidos. Precedem as outras duas fontes: pessoa vence heurística. */
  followups?: FollowUpApi[]
  agora?: Date
}): ItemFila[]
export declare function ordenarFila(itens: ItemFila[]): ItemFila[]
export declare function emAberto(item: ItemFila): boolean
export declare function filtroRapidoValido(valor: string | null | undefined): FiltroRapido
export declare function aplicarFiltroRapido(itens: ItemFila[], valor: string | null | undefined): ItemFila[]
export declare function aplicarAvancado(itens: ItemFila[], view?: Partial<ViewFollowups>): ItemFila[]
export declare function contarFiltrosAtivos(view?: Partial<ViewFollowups>): number
export declare function chipsAtivos(
  view?: Partial<ViewFollowups>,
  rotulosDeAcao?: Record<string, string>,
  rotulosDeResponsavel?: Record<string, string>,
): string[]
export declare function opcoesDeResponsavel(itens: ItemFila[]): { valor: string; label: string }[]
export declare function contagensRapidas(itens: ItemFila[]): Record<FiltroRapido, number>
export declare function opcoesDeAcao(itens: ItemFila[]): { valor: string; label: string }[]
export declare function resumoFila(contagens: Record<string, number> | null | undefined): string
export declare function descricaoPrioridade(item: ItemFila | null | undefined): string
export declare function classificarPrazoData(iso: string | null, agora: Date, pendente: boolean): PrazoQuando | null
export declare function classificarPrazoJanela(janelaQuando: string | null | undefined): PrazoQuando | null

/** `null` para vazio, telefone ou identificador do Evolution (`…@s.whatsapp.net`). */
export declare function nomeDeVerdade(valor: unknown): string | null
export declare function formatarTelefone(valor: unknown): string
export declare function rotuloLead(item: { nome?: string | null; telefone_digitos?: string; numero?: string } | null | undefined): string

// Vocabulário da entidade follow-up — o MESMO que a Central de Ligações usa.
export type {
  CanalFollowUp, StatusFollowUp, PrioridadeFollowUp, OrigemFollowUp, DestinoFollowUp,
  EscolhaCanal, FollowUpApi, FormProximaAcao, PayloadProximaAcao, ContextoOrigem, EventoContato,
  DisponibilidadeWhatsapp, PatchDisponibilidade,
} from './follow-up-acao'
export {
  CANAL_LABEL, CANAL_ICONE, CANAL_OPCOES, ORIGEM_LABEL, STATUS_FOLLOWUP_LABEL, PRIORIDADE_OPCOES,
  rotuloCanal, iconeCanal, destinoDoCanal, rotuloOrigem, rotuloStatusFollowUp, rotuloEvento,
  formatarQuando, resumoProximaAcao, sugerirProximaAcao, paraInputLocal, deInputLocal,
  validarProximaAcao, montarPayloadProximaAcao, itemDeFollowUp, contextoDeOrigem,
  // Disponibilidade de canal do contato (migration 066).
  MARCAR_SEM_WHATSAPP_LABEL, MARCAR_SEM_WHATSAPP_AJUDA, AVISO_TROCA_PARA_LIGACAO,
  AVISO_CANAL_DESCARTADO, rotuloDisponibilidadeWhatsapp, canalDescartadoPeloOperador,
  estadoDisponibilidadeInicial, alternarSemWhatsapp, patchDisponibilidade,
} from './follow-up-acao'

// Paginação — mesma aritmética da Aquisição e da Central de Ligações.
export type { PaginaLista } from './paginacao'
export {
  TAMANHOS_PAGINA, POR_PAGINA_PADRAO,
  normalizarPorPagina, paginar, resumoIntervalo, mostrarPaginacao,
} from './paginacao'
