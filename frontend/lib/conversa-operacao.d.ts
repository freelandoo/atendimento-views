// Tipos de `lib/conversa-operacao.js` — apresentação pura da Central de Mensagens em equipe.

export type EstadoAtendente = 'nao_atribuida' | 'meu' | 'de_outro'

export interface ConversaComDono {
  responsavel_id?: string | null
  responsavel_nome?: string | null
  responsavel_desde?: string | null
  [k: string]: unknown
}

export interface OpcaoEscopo { valor: string; rotulo: string }
export interface Atendente { estado: EstadoAtendente; rotulo: string; meu: boolean }
export interface AvisoAtendimento { podeResponder: true; avisar: boolean; texto: string }
export interface AcoesAtendente {
  assumir: boolean
  devolver: boolean
  transferir: boolean
  atribuir: boolean
  motivoSemAssumir: string
}

export declare const ESCOPO_CONVERSA: Readonly<{ MINHAS: 'minhas'; NAO_ATRIBUIDAS: 'nao_atribuidas'; TODAS: 'todas' }>
export declare const ESCOPO_ROTULO: Record<string, string>
export declare function opcoesEscopoConversa(podeVerTodas: boolean): OpcaoEscopo[]
export declare function rotuloEscopoEfetivoConversa(escopo: string | null | undefined): string
export declare function avisoDeRecorte(escopoPedido: string | null | undefined, escopoEfetivo: string | null | undefined): string
export declare function atendenteDaConversa(conversa: ConversaComDono | null | undefined, usuarioId: string | null | undefined): Atendente
export declare function avisoDeAtendimento(conversa: ConversaComDono | null | undefined, usuarioId: string | null | undefined): AvisoAtendimento
export declare function acoesDeAtendente(
  conversa: ConversaComDono | null | undefined,
  opts?: { usuarioId?: string | null; podeAtender?: boolean; podeTransferir?: boolean }
): AcoesAtendente
export declare function descreverMudancaDeAtendente(evento: Record<string, unknown> | null | undefined): { rotulo: string; tom: string }
