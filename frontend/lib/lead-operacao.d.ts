export type Qualificacao = 'pendente' | 'aprovado' | 'descartado' | 'legado'
export type EscopoLead = 'meus' | 'livres' | 'todos'
export type Tom = 'positivo' | 'negativo' | 'atencao' | 'neutro'

export interface LeadOperacional {
  id: string
  nome?: string | null
  telefone?: string | null
  /** Etapa 3. Ausente NEGA a abordagem — o mesmo contrato do backend. */
  qualificacao?: Qualificacao | string | null
  qualificado_em?: string | null
  /** Etapa 4. `null` = fila de livres (estado de primeira classe, não erro). */
  responsavel_id?: string | null
  responsavel_nome?: string | null
  responsavel_desde?: string | null
}

/** Veredito de força de prova, resolvido pelo BACKEND (forcaDaProva). */
export interface ProvaAbordagem {
  comprovado: boolean
  rotulo: string
  detalhe: string
}

export interface DisparoLead {
  id?: string
  canal?: 'evolution' | 'manual_wa_me' | string
  status?: string
  confirmado_por?: 'provider' | 'operador' | null
  confirmado_em?: string | null
  criado_em?: string
  prova?: ProvaAbordagem
}

export interface SeloQualificacao {
  rotulo: string
  detalhe: string
  tom: Tom
  /** `false` para valor fora do vocabulário — a tela mostra o slug, nunca esconde. */
  conhecido: boolean
}

export interface DonoDoLead {
  estado: 'livre' | 'meu' | 'de_outro'
  rotulo: string
  meu: boolean
}

export interface AcoesDeResponsavel {
  assumir: boolean
  devolver: boolean
  transferir: boolean
  atribuir: boolean
  /** Por que "Assumir" não aparece. Vazio quando aparece. */
  motivoSemAssumir: string
}

export interface DescricaoAbordagem {
  rotulo: string
  detalhe: string
  comprovado: boolean
  /** Texto obrigatório quando não há confirmação — nunca só cor. */
  aviso: string
  tom: Tom
  manual: boolean
}

export const QUALIFICACAO_ROTULO: Record<string, string>
export const ESCOPO_LEAD: { MEUS: 'meus'; LIVRES: 'livres'; TODOS: 'todos' }
export const LIMITE_MENSAGEM: number

export function seloQualificacao(qualificacao: string | null | undefined): SeloQualificacao
export function podeAbordar(lead: LeadOperacional | null | undefined): boolean
/** A primeira opcao e sempre o PADRAO do servidor, com valor `''`. */
export function opcoesEscopo(podeVerTodos: boolean): { valor: EscopoLead | ''; rotulo: string }[]
export function rotuloEscopoEfetivo(escopo: string | null | undefined): string
export function donoDoLead(
  lead: LeadOperacional | null | undefined,
  usuarioId: string | null | undefined
): DonoDoLead
export function acoesDeResponsavel(
  lead: LeadOperacional | null | undefined,
  opcoes?: { usuarioId?: string | null; podeAssumir?: boolean; podeTransferir?: boolean }
): AcoesDeResponsavel
export function descreverAbordagem(disparo: DisparoLead | null | undefined): DescricaoAbordagem
export function rotuloAcaoManual(
  ultimoDisparo: DisparoLead | null | undefined
): { abrir: string; confirmar: string; pendente: boolean }
export function contagemMensagem(texto: string | null | undefined): {
  usados: number
  limite: number
  excedeu: boolean
  restantes: number
}
