/**
 * Equipes Comerciais — apresentação PURA da tela de gestão.
 * Este módulo só TRADUZ: quem autoriza é o backend, quem garante unicidade é o banco.
 */

export interface EquipeResumo {
  id: string
  nome: string
  descricao?: string | null
  status: string
  nicho_id: string
  nicho_nome?: string | null
  total_membros?: number
}

export interface EquipeDaPessoa {
  id: string
  nome?: string | null
  nicho_nome?: string | null
}

export interface PessoaElegivel {
  usuario_id: string
  nome?: string | null
  papel?: string | null
  /** `null` = livre para entrar em qualquer equipe. */
  equipe_atual?: EquipeDaPessoa | null
}

export interface EstadoEquipe {
  rotulo: string
  descricao: string
  /** `ativo` | `neutro` — vira cor, nunca é a única informação. */
  tom: string
}

export interface EstadoPessoa {
  disponivel: boolean
  /** Já é membro da equipe sendo editada — não é conflito. */
  jaNesta: boolean
  /** O nome da equipe em que ela já está. `null` quando não há conflito. */
  aviso: string | null
}

export declare const STATUS: Record<string, EstadoEquipe>
export declare const LIMITE_NOME: number
export declare const LIMITE_DESCRICAO: number
/** Encerrar NÃO devolve lead. A tela é obrigada a dizer isso. */
export declare const AVISO_ENCERRAR: string

export declare function estadoDaEquipe(equipe: EquipeResumo | null | undefined): EstadoEquipe
/** Zero membros diz a consequência, não só o número. */
export declare function resumoDeMembros(equipe: EquipeResumo | null | undefined): string

export declare function estadoDaPessoa(
  pessoa: PessoaElegivel | null | undefined,
  equipeAtualId: string | null
): EstadoPessoa

/** O aviso de conflito da seleção inteira, nomeando quem. `null` quando não há. */
export declare function conflitosDaSelecao(
  pessoas: PessoaElegivel[] | null | undefined,
  selecionados: string[] | null | undefined,
  equipeAtualId: string | null
): string | null

export declare function validarFormulario(
  dados: { nome?: string; nicho_id?: string } | null | undefined
): { ok: boolean; motivo: string | null }

export declare function textoConfirmarEncerramento(equipe: EquipeResumo | null | undefined): string

export declare function agruparEquipes(
  equipes: EquipeResumo[] | null | undefined
): { ativas: EquipeResumo[]; encerradas: EquipeResumo[] }

/** Nichos que já têm equipe ativa — o banco recusa a segunda. */
export declare function nichosOcupados(
  equipes: EquipeResumo[] | null | undefined,
  equipeAtualId: string | null
): Set<string>
