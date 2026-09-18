/** Progresso já calculado pelo BACKEND. Este módulo não recalcula nada. */
export interface ProgressoParaMeta {
  /** `null` quando o alvo é ilegível — nesse caso não há proximidade nenhuma. */
  alvo?: number | null
  fracao?: number
  faltam?: number | null
  alcancado?: boolean
}

export interface Proximidade {
  /** 0 | 50 | 75 | 90 | 100 */
  marco: number
  /** Só a partir de 90%, e some quando a janela encerrou. `null` nos demais casos. */
  selo: string | null
  /** conquista | alta | media | baixa — vira cor, mas nunca é a única informação. */
  intensidade: string
  frase: string
  /** Largura da barra em CSS ("62%"), limitada a 0..100%. */
  largura: string
}

export interface OpcoesProximidade {
  /** Janela vencida ou missão encerrada: muda o tempo verbal e tira o incentivo. */
  encerrado?: boolean
  /** Injetado para este módulo não escolher formatação de dinheiro (dono: `lib/comissao.js`). */
  formatarValor?: (valor: number) => string
}

export interface ContagensDoDia {
  followups_vencidos?: number
  reunioes_hoje?: number
  leads_parados?: number
  followups_hoje?: number
  leads_livres?: number
}

export interface PassoOperacional {
  chave: string
  quantidade: number
  texto: string
  /** urgente | atencao | oportunidade | neutro */
  tom: string
  href: string
}

export interface PosicaoNoPlacar {
  posicao: number
  total: number
}

/** `null` quando não há meta legível — a tela então NÃO desenha barra nem frase. */
export function proximidade(
  progresso: ProgressoParaMeta | null | undefined,
  opcoes?: OpcoesProximidade
): Proximidade | null

/** Ordenados por CONSEQUÊNCIA, não por volume. Contagem zero não vira linha. */
export function proximosPassos(contagens: ContagensDoDia | null | undefined): PassoOperacional[]

/** A frase de quando não há nada pendente. É constatação, não elogio. */
export function nadaPendente(temLeadsLivres: boolean): string

/** `null` quando a pessoa não está no ranking — o que NÃO é "último lugar". */
export function minhaPosicao(
  ranking: { usuario_id: string }[] | null | undefined,
  usuarioId: string | null | undefined
): PosicaoNoPlacar | null

/**
 * Qual painel mostrar em `/dashboard`.
 * `null` enquanto a sessão carrega: não se escolhe tela no escuro.
 */
export function visaoDoPainel(
  capacidades: string[] | null | undefined
): 'administrativa' | 'minha_operacao' | null

/** As três fontes cruas da fila, como a API as devolve. */
export interface FontesDaFila {
  /** `GET /follow-ups/call-list` → `data.lista`. */
  humanos?: unknown[]
  /** `GET /follow-ups/auto` → `data.itens`. */
  automaticos?: unknown[]
  /** `GET /follow-ups/itens` → `data.itens`. A ÚNICA fonte com prazo próprio. */
  followups?: unknown[]
  agora?: Date
}

export interface ContagemFollowUp {
  vencidos: number
  hoje: number
}

/** O prazo que conta como vencido. Vocabulário de `lib/followups-fila.js`. */
export declare const PRAZO_VENCIDO: string
/** Os prazos que contam como "para hoje". */
export declare const PRAZO_DE_HOJE: readonly string[]

/**
 * `{ vencidos, hoje }` pela MESMA `montarFila` da Central de Follow-ups.
 * Não reclassifica nada: uma segunda regra faria as duas telas discordarem.
 */
export function contagensDeFollowUp(fontes: FontesDaFila | null | undefined): ContagemFollowUp
