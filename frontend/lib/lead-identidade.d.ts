export interface IdentidadeConversa {
  /** Nome resolvido; na falta dele, o telefone formatado. Nunca o JID do Evolution. */
  titulo: string
  /** Telefone formatado "(11) 99999-9999" (vazio quando o número não é reconhecível). */
  telefone: string
  /** `true` quando o título veio de um nome de verdade (e não do telefone). */
  temNome: boolean
}

export declare function digitos(valor: unknown): string
export declare function texto(valor: unknown): string
export declare function nomeDeVerdade(valor: unknown): string | null
export declare function formatarTelefone(valor: unknown): string
export declare function rotuloLead(item: {
  nome?: string | null
  telefone_digitos?: string | null
  numero?: string | null
} | null | undefined): string
/**
 * Nome da coluna "Lead" da Central de Mensagens: o `nome_exibicao` resolvido pelo backend,
 * ou string vazia. Nunca traço, nunca telefone.
 */
export declare function nomeColunaLead(conversa: {
  nome_exibicao?: string | null
} | null | undefined): string
export declare function identidadeConversa(conversa: {
  numero?: string | null
  nome_exibicao?: string | null
  negocio?: string | null
} | null | undefined): IdentidadeConversa
