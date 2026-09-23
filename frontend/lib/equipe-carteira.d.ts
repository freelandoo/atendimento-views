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
  /** Leads com conversa aberta — o que a transferência "incluindo em andamento" leva junto. */
  com_conversa?: number
  /** Leads ainda não aprovados na triagem (subconjunto de `leads`). */
  legado?: number
  /**
   * Se esta pessoa ENXERGA lead `legado` no Banco de Leads. Resolvido pelo BACKEND, pela regra de
   * capacidade — a tela nunca deduz isso do papel.
   */
  ve_base_bruta?: boolean
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

export type TipoAcaoAviso = 'mover' | 'puxar' | 'banco_leads' | 'triagem'

export interface AvisoCarteira {
  chave: string
  tom: TomCelula
  titulo: string
  descricao: string
  pessoas?: string[]
  /** O gesto que resolve o aviso. A tela liga o tipo a um botão; nenhum deles escreve sozinho. */
  acao?: { tipo: TipoAcaoAviso; rotulo: string }
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

// ─── Pontos de atenção e transferência (2026-09-23) ─────────────────────────────────────

/** A resposta de `GET /equipes-comerciais/:id/carteira`, com os pontos de atenção. */
export interface CarteiraDoNichoResposta {
  equipe?: { nicho_nome?: string | null } | null
  membros?: LinhaCarteira[] | null
  disponiveis_para_puxar?: number
  protegidos?: MotivoProtegido[] | null
  /** Leads DESTE nicho aguardando triagem. */
  aguardando_triagem?: number
  /** Leads aprovados da EMPRESA sem nicho — número da empresa, não da equipe. */
  sem_nicho?: number
  /** Leads deste nicho na mão de quem não é da equipe. */
  fora_da_equipe?: { leads: number; pessoas: number } | null
}

export declare const ACAO_AVISO: Readonly<{ MOVER: 'mover'; PUXAR: 'puxar'; BANCO_LEADS: 'banco_leads'; TRIAGEM: 'triagem' }>

/** `null` quando ninguém tem lead que não enxerga. */
export declare function avisoLeadsInvisiveis(membros: LinhaCarteira[] | null | undefined): AvisoCarteira | null
export declare function avisoAguardandoTriagem(total: number | null | undefined, nicho?: string | null): AvisoCarteira | null
export declare function avisoForaDaEquipe(
  fora: { leads: number; pessoas: number } | null | undefined,
  nicho?: string | null
): AvisoCarteira | null
export declare function avisoSemNicho(total: number | null | undefined): AvisoCarteira | null

/** Todos os pontos de atenção, em baldes de gravidade (perigo, alerta, neutro). `[]` sem carteira. */
export declare function pontosDeAtencao(carteira: CarteiraDoNichoResposta | null | undefined): AvisoCarteira[]

/** Junta listas de avisos, tira nulos e repetições por `chave`, e agrupa por gravidade. */
export declare function juntarAvisos(
  ...listas: (ReadonlyArray<AvisoCarteira | { chave: string; tom?: string } | null | undefined> | AvisoCarteira | null | undefined)[]
): AvisoCarteira[]

export interface OpcaoPessoa { id: string; rotulo: string }
export declare function origensDaTransferencia(membros: LinhaCarteira[] | null | undefined): OpcaoPessoa[]
export declare function destinosDaTransferencia(membros: LinhaCarteira[] | null | undefined, origemId: string | null | undefined): OpcaoPessoa[]

export interface PreviaTransferencia {
  /** Quantos dá para mover com a escolha atual (intocados, ou todos com a caixa marcada). */
  maximo: number
  /** O que de fato sairia: `min(pedido, maximo)`. */
  efetiva: number
  intocados: number
  emAndamento: number
  /** Quantos dos que saem viriam dos em andamento (os intocados saem primeiro). */
  dosEmAndamento: number
  riscos: string[]
  /** Frase pronta, vazia quando nada em andamento sai. */
  aviso: string
}

export declare function previaTransferencia(dados: {
  origem?: Partial<LinhaCarteira> | null
  destinoNome?: string | null
  quantidade?: number | string
  incluirProtegidos?: boolean
}): PreviaTransferencia

/** Não é a validação de verdade — a do backend manda. Evita um POST que já se sabe que falharia. */
export declare function validarTransferenciaTela(dados: {
  origemId?: string | null
  destinoId?: string | null
  quantidade?: number | string
  maximo?: number
  incluirProtegidos?: boolean
}): { pode: boolean; motivo: string }

export interface ResultadoTransferencia {
  movidos: number
  solicitados?: number
  incluir_protegidos?: boolean
  origem_id?: string
  destino_id?: string
  com_reuniao?: number
  com_conversa?: number
  com_follow_up?: number
}

/** Usa o número REAL devolvido pelo banco; `movidos < solicitados` não é erro. */
export declare function resumoDaTransferencia(
  resultado: ResultadoTransferencia | null | undefined,
  nomePorId?: Record<string, string>
): { tom: TomCelula; texto: string }
