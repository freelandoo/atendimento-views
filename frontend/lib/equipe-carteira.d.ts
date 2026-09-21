/**
 * A carteira do NICHO de uma equipe — apresentação PURA.
 *
 * Só TRADUZ o veredito de `GET /equipes-comerciais/:id/carteira`. Não decide o que é "intocado",
 * não classifica "protegido" e não calcula meta: isso é `backend/src/services/lead-distribuicao.js`.
 *
 * ⚠️ Não confundir com a carteira de `lib/equipe-painel.js`, que conta a carteira da pessoa na
 * EMPRESA INTEIRA. Os dois números convivem na mesma tela e cada coluna declara `oQueMede`.
 */

export type TomCelula = 'neutro' | 'ok' | 'alerta' | 'perigo'

/** Uma linha da carteira: um membro da equipe, com todas as contagens do nicho. */
export interface LinhaCarteira {
  usuario_id: string
  nome: string | null
  papel?: string | null
  /** Leads do nicho sob responsabilidade desta pessoa. */
  leads: number
  /** Sem nenhum trabalho registrado — os únicos que a distribuição pode mover. */
  intocados: number
  /** `leads - intocados`. Nunca mudam de responsável automaticamente. */
  em_andamento: number
  /** Subconjunto de `leads`, não carteira à parte. */
  parados: number
  com_follow_up: number
  /** Leads COM reunião futura — não é quantas reuniões a pessoa fez. */
  com_reuniao: number
}

export interface ColunaCarteira {
  chave: keyof LinhaCarteira
  rotulo: string
  /** Obrigatório: números lado a lado sugerem que são comparáveis entre si. */
  oQueMede: string
  tom?: TomCelula
}

export interface MotivoProtegido {
  motivo: string
  total: number
}

export interface ResumoProtegidos {
  total: number
  titulo: string
  itens: (MotivoProtegido & { rotulo: string })[]
  explicacao: string
}

export interface AvisoCarteira {
  chave: string
  tom: TomCelula
  titulo: string
  descricao: string
  pessoas?: string[]
}

export interface OpcaoDistribuicao {
  id: string
  rotulo: string
  ajuda: string
}

export interface ResultadoPuxada {
  movidos: number
  solicitados?: number
  disponiveis?: number
  por_pessoa?: { usuario_id: string; recebidos: number }[]
  criterio?: string
  entre?: string
}

export interface ResultadoRebalanceamento {
  movidos: number
  de_livres?: number
  entre_membros?: number
  truncado?: boolean
  por_pessoa?: { usuario_id: string; recebidos: number }[]
}

export declare const COLUNAS_CARTEIRA: readonly ColunaCarteira[]
export declare function valorDaCarteira(pessoa: Partial<LinhaCarteira> | null | undefined, coluna: ColunaCarteira): number
/** Zero nunca é pintado: não há nada a alertar num número que não existe. */
export declare function tomDaCarteira(coluna: ColunaCarteira | null | undefined, valor: number): TomCelula

export declare const ROTULO_PROTEGIDO: Readonly<Record<string, string>>
/** Motivo desconhecido volta COMO ELE MESMO — motivo novo no servidor não pode sumir da tela. */
export declare function rotuloProtegido(motivo: string | null | undefined): string
/** `null` quando nada está protegido: não se ocupa espaço para dizer que está tudo bem. */
export declare function resumoProtegidos(protegidos: MotivoProtegido[] | null | undefined): ResumoProtegidos | null

/** Mede CARGA, não desempenho. `null` com menos de 2 pessoas ou carteira zerada. */
export declare function avisoDesequilibrio(membros: LinhaCarteira[] | null | undefined): AvisoCarteira | null
export declare function avisoSemDisponiveis(disponiveis: number, protegidos?: MotivoProtegido[] | null): AvisoCarteira | null

export declare const CRITERIOS: readonly OpcaoDistribuicao[]
export declare const MODOS_DISTRIBUICAO: readonly OpcaoDistribuicao[]
export declare const QUANTIDADE_PADRAO: number
export declare function opcaoValida(lista: readonly OpcaoDistribuicao[], id: string | null | undefined, padrao: string): string

/** Não valida quantidade contra o disponível: quem tem o banco na mão é o backend. */
export declare function validarPuxada(dados: {
  quantidade?: number | string
  entre?: string
  selecionados?: string[]
  disponiveis?: number
}): { pode: boolean; motivo: string }

export declare function previaDaPuxada(dados: {
  quantidade?: number | string
  disponiveis?: number
  entre?: string
  selecionados?: string[]
  membros?: LinhaCarteira[]
}): string

export declare function resumoDaPuxada(
  resultado: ResultadoPuxada | null | undefined,
  nomePorId?: Record<string, string>
): { tom: TomCelula; texto: string; detalhes: string[] }

/** `null` quando nada se moveu — é comum e legítimo; anunciar "0" mandaria procurar defeito. */
export declare function resumoDoRebalanceamento(d: ResultadoRebalanceamento | null | undefined): string | null

export interface ResultadoDevolucao {
  usuario_id: string
  nome?: string | null
  liberados: number
  com_reuniao_futura: number
  com_conversa_aberta: number
}

/**
 * O que aconteceu na devolução de leads ao tirar alguém da equipe. NÃO filtra por "protegido" —
 * mesmo lead com reunião marcada ou conversa aberta volta. `null` quando ninguém foi removido.
 */
export declare function resumoDaDevolucao(devolucao: ResultadoDevolucao[] | null | undefined): string | null
