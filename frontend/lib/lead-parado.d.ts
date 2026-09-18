/** Linha do painel da equipe com a contagem de parados (campos aditivos de `GET .../equipe`). */
export interface LinhaComParados {
  usuario_id: string | null
  nome?: string | null
  /** SUBCONJUNTO de `leads`, nunca uma carga a mais. */
  leads_parados?: number
  leads_parados_mais_antigo_dias?: number | null
}

export interface ResumoParados {
  total: number
  pessoas: number
  frase: string
  /** Lembrete de que devolver é ato humano — o sistema marca e avisa, não devolve. */
  acao: string
}

/** Vazio quando não há parados: a coluna fica limpa em vez de marcar quem não tem problema. */
export function rotuloParados(quantidade: number | null | undefined): string

/** 'alerta' | 'neutro'. Cor nunca é o único sinal. */
export function tomParados(quantidade: number | null | undefined): string

export function explicacao(prazoDias: number | null | undefined): string

/** Vazio quando não há idade conhecida — nunca se inventa. */
export function detalheMaisAntigo(dias: number | null | undefined): string

/** `null` quando não há nada parado: aviso que sempre aparece deixa de ser aviso. */
export function resumoDaEquipe(
  linhas: LinhaComParados[] | null | undefined,
  prazoDias?: number | null
): ResumoParados | null
