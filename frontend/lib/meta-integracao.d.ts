export type EstadoIntegracao =
  | 'nao_configurada'
  | 'em_teste'
  | 'ativa'
  | 'precisa_atencao'
  | 'desativada'

export type ChaveEvento =
  | 'reuniao_agendada'
  | 'reuniao_realizada'
  | 'reuniao_realizada_com_venda'

export type StatusEvento = 'pendente' | 'enviado' | 'falhou' | 'ignorado' | 'corrigido'

export type EventoConfiguravel = {
  chave: ChaveEvento
  nome: string
  resumo: string
  ajuda: string
}

export type EventosLigados = Partial<Record<ChaveEvento, boolean>>

/** Configuração devolvida pela API. O token NUNCA vem — só `token_hint`. */
export type Integracao = {
  id: string
  empresa_id: string
  dataset_id: string
  page_id: string | null
  waba_id: string | null
  token_hint: string | null
  test_event_code: string | null
  status: Exclude<EstadoIntegracao, 'nao_configurada'>
  eventos: Record<ChaveEvento, boolean>
  ultimo_teste_em: string | null
  ultimo_teste_ok: boolean | null
  ultimo_erro: string | null
  criado_em: string
  atualizado_em: string
} | null

export type EventoHistorico = {
  id: string
  tipo: ChaveEvento
  event_name: string | null
  origem: string
  telefone: string | null
  ocorrido_em: string
  valor: number | null
  moeda: string | null
  valor_corrigido: number | null
  corrigido_em: string | null
  status: StatusEvento
  motivo: string | null
  erro: string | null
  tentativas: number
  enviado_em: string | null
  pode_reenviar: boolean
}

export type ResumoStatus = Record<StatusEvento, number>

export type FormularioMeta = {
  dataset_id?: string
  page_id?: string
  waba_id?: string
  access_token?: string
  test_event_code?: string
}

export type ResultadoValidacao = {
  ok: boolean
  erros: Partial<Record<'dataset_id' | 'destino' | 'access_token', string>>
}

export type Acoes = {
  podeTestar: boolean
  podeAtivar: boolean
  podeDesativar: boolean
  podeRemover: boolean
  motivoAtivarBloqueado: string | null
}

export const ESTADOS: EstadoIntegracao[]
export const EVENTOS: EventoConfiguravel[]
export const AJUDA_CAMPO: Record<string, string>

export function estadoDaIntegracao(integracao: Integracao): EstadoIntegracao
export function rotuloEstado(estado: EstadoIntegracao): string
export function descricaoEstado(estado: EstadoIntegracao): string
export function tomEstado(estado: EstadoIntegracao): string
export function validarFormulario(
  form: FormularioMeta,
  opcoes?: { jaConfigurada?: boolean }
): ResultadoValidacao
export function algumEventoLigado(eventos: EventosLigados): boolean
export function acoesDisponiveis(integracao: Integracao): Acoes
export function rotuloStatusEvento(status: StatusEvento | string): string
export function tomStatusEvento(status: StatusEvento | string): string
export function rotuloTipoEvento(tipo: ChaveEvento | string): string
export function formatarValor(valor: number | null | undefined, moeda?: string | null): string
export function explicacaoDoEvento(ev: Partial<EventoHistorico>): string | null
