/**
 * Área de Equipe — apresentação PURA da tela unificada (Visão geral · Equipes · Pessoas).
 *
 * Este módulo só JUNTA e TRADUZ o que `/equipe`, `/equipes-comerciais` e `/comissao/ranking`
 * já responderam. Ele não decide permissão, não valida unicidade e não recorta nada.
 */
import type { AtividadeHoje, ColunaEquipe, EventoAuditoria, LinhaEquipe } from './equipe-painel'
import type { EquipeDaPessoa, EquipeResumo, EstadoEquipe, EstadoPessoa, PessoaElegivel } from './equipes-comerciais'

export type { AtividadeHoje, ColunaEquipe, EventoAuditoria, LinhaEquipe }
export type { EquipeDaPessoa, EquipeResumo, EstadoEquipe, EstadoPessoa, PessoaElegivel }

// ─── Abas ───────────────────────────────────────────────────────────────────────────────

export type IdAba = 'visao' | 'equipes' | 'pessoas'
export interface Aba { id: IdAba; titulo: string; descricao: string }

export declare const ABAS: readonly Aba[]
export declare const ABA_PADRAO: IdAba
export declare const IDS_ABAS: readonly string[]
/** Aba desconhecida cai no padrão em vez de deixar a tela vazia. */
export declare function abaValida(id: string | null | undefined): IdAba

// ─── Pessoas e equipes, já juntas ───────────────────────────────────────────────────────

export interface PessoaArea extends LinhaEquipe {
  /** `null` = não está em equipe nenhuma. Estado legítimo: quem não está em equipe vê tudo. */
  equipe: EquipeDaPessoa | null
  /** `null` ≠ `0`: não há faturamento REGISTRADO, e não "faturou zero". */
  originado: number | null
}

export interface MetricasEquipe {
  leads: number
  leads_parados: number
  conversas: number
  follow_ups_aguardando: number
  follow_ups_vencidos: number
  ligacoes: number
  originado: number | null
}

export interface EquipeArea extends EquipeResumo {
  membros: PessoaArea[]
  total_membros: number
  /** Membros que existem no banco e não aparecem na tabela por terem o acesso revogado. */
  membros_ocultos: number
  metricas: MetricasEquipe
}

export declare function montarPessoas(entrada: {
  linhas?: LinhaEquipe[] | null
  elegiveis?: PessoaElegivel[] | null
  ranking?: { usuario_id: string; originado?: number | string }[] | null
}): PessoaArea[]

export declare function montarEquipes(entrada: {
  equipes?: EquipeResumo[] | null
  pessoas?: PessoaArea[] | null
}): EquipeArea[]

/** Soma a MESMA métrica entre pessoas — nunca métricas diferentes entre si. */
export declare function metricasDaEquipe(membros: PessoaArea[] | null | undefined): MetricasEquipe

export interface MetricaEquipeDef extends ColunaEquipe { dinheiro?: boolean }
export declare const METRICAS_EQUIPE: readonly MetricaEquipeDef[]

export interface ColunaMembro extends ColunaEquipe {
  /** A coluna conta fatos de HOJE (auditoria), não carga atual. O rótulo é obrigado a dizer. */
  hoje?: boolean
  /** `alerta` | `perigo`. Vira cor, nunca é a única informação. */
  tom?: string
}
export declare const COLUNAS_MEMBRO: readonly ColunaMembro[]

export declare function valorDaColuna(
  pessoa: PessoaArea | null | undefined,
  coluna: ColunaMembro | null | undefined
): number

/** `neutro` | `alerta` | `perigo`. Zero nunca é pintado. */
export declare function tomDaColuna(coluna: ColunaMembro | null | undefined, valor: number): string

/** Vazio quando ninguém está oculto — não se ocupa espaço para dizer que está tudo bem. */
export declare function avisoMembrosOcultos(equipe: EquipeArea | null | undefined): string

// ─── Resumo e alertas ───────────────────────────────────────────────────────────────────

export interface CartaoResumo {
  chave: string
  rotulo: string
  valor: number
  apoio: string
  /** `neutro` | `alerta` | `perigo`. */
  tom?: string
  /** Obrigatório: quatro números lado a lado sugerem que são comparáveis entre si. */
  oQueMede: string
}

export declare function resumoGeral(entrada: {
  pessoas?: PessoaArea[] | null
  equipes?: EquipeResumo[] | null
  semDono?: Partial<LinhaEquipe> | null
  prazoParado?: number | null
}): CartaoResumo[]

export interface AlertaEquipe {
  chave: string
  /** `neutro` | `alerta` | `perigo`. */
  tom: string
  titulo: string
  descricao: string
}

export declare function alertasDaEquipe(
  equipe: EquipeArea | null | undefined,
  prazoParado?: number | null
): AlertaEquipe[]

export declare function alertasGerais(entrada: {
  semDono?: Partial<LinhaEquipe> | null
}): AlertaEquipe[]

// ─── Filtros ────────────────────────────────────────────────────────────────────────────

export declare function filtrarEquipes<T extends EquipeResumo>(
  equipes: T[] | null | undefined,
  termo: string | null | undefined
): T[]

export interface FiltroPessoas {
  busca?: string
  /** `''` = todas; `'sem_equipe'` = fora de equipe; senão, o id da equipe. */
  equipeId?: string
  papel?: string
  /** `ativos` (padrão) | `todos` | `inativos`. */
  status?: string
}

export declare function filtrarPessoas(
  pessoas: PessoaArea[] | null | undefined,
  filtro?: FiltroPessoas
): PessoaArea[]

export declare function papeisPresentes(
  pessoas: PessoaArea[] | null | undefined
): { id: string; rotulo: string }[]

export declare function resumoDoRecorte(total: number, filtradas: number): string

export declare const OPCOES_STATUS_PESSOA: readonly { id: string; rotulo: string }[]
export declare const FILTRO_EQUIPE_TODAS: string
export declare const FILTRO_SEM_EQUIPE: string

// ─── Encerrar ───────────────────────────────────────────────────────────────────────────

/** O backend recusa encerrar equipe com gente (409). A tela diz isso ANTES do clique. */
export declare function podeEncerrar(
  equipe: EquipeArea | EquipeResumo | null | undefined
): { pode: boolean; motivo: string }

// ─── Modal de membros ───────────────────────────────────────────────────────────────────

export type SituacaoModal = 'nesta_equipe' | 'sem_equipe' | 'outra_equipe'

export interface EstadoNoModal {
  situacao: SituacaoModal
  rotulo: string
  /** `ok` | `alerta` | `neutro`. */
  tom: string
  selecionavel: boolean
  marcado: boolean
  /** Por que não dá para mexer. Vazio quando dá. */
  motivo: string
}

/** Remover membro é RECUSADO pelo backend enquanto não existir devolução de leads. */
export declare const MOTIVO_REMOCAO_BLOQUEADA: string
export declare const FILTROS_MODAL: readonly { id: string; rotulo: string }[]

export declare function situacaoNoModal(
  pessoa: PessoaSelecionavel | null | undefined,
  equipeId: string | null
): EstadoNoModal

export declare function contagensDoModal(
  pessoas: PessoaSelecionavel[] | null | undefined,
  equipeId: string | null
): { todos: number; sem_equipe: number; nesta_equipe: number }

export declare function filtrarPessoasDoModal(
  pessoas: PessoaArea[] | null | undefined,
  opcoes?: { busca?: string; filtro?: string; equipeId?: string | null }
): PessoaArea[]

/** Conta só as ADIÇÕES: são as únicas que serão enviadas. */
export declare function resumoSelecaoModal(
  novos: string[] | null | undefined
): { quantidade: number; texto: string; podeSalvar: boolean; motivo: string }

/** `PUT /participantes` é SUBSTITUIÇÃO: os membros atuais entram sempre. */
export declare function corpoDeParticipantes(
  pessoas: PessoaSelecionavel[] | null | undefined,
  equipeId: string | null,
  novos: string[] | null | undefined
): string[]

// ─── Reexports (nunca reimplementados) ──────────────────────────────────────────────────

export declare const COLUNAS: readonly ColunaEquipe[]
export declare const ATIVIDADE_HOJE_COLUNAS: readonly ColunaEquipe[]
export declare const STATUS: Record<string, EstadoEquipe>
export declare const LIMITE_NOME: number
export declare const AVISO_ENCERRAR: string

export declare function rotuloPapel(papel: string | null | undefined): string
export declare function rotuloUltimoAcesso(iso: string | null | undefined): string
export declare function avisoDeInativo(linha: Partial<LinhaEquipe> | null | undefined): string
export declare function atividadeHoje(linha: Partial<LinhaEquipe> | null | undefined): AtividadeHoje
export declare function ordenarEquipe<T extends Partial<LinhaEquipe>>(linhas: T[] | null | undefined): T[]
export declare function ordenarPorAtividadeHoje<T extends Partial<LinhaEquipe>>(linhas: T[] | null | undefined): T[]
export declare function descreverAtividade(evento: EventoAuditoria | null | undefined): {
  rotulo: string
  conhecida: boolean
  entidade: string
  quando: string
}
export declare function cargaAtual(linha: Partial<LinhaEquipe> | null | undefined): number
export declare function temTrabalhoSemDono(semResponsavel: Partial<LinhaEquipe> | null | undefined): boolean
export declare function estadoDaEquipe(equipe: EquipeResumo | null | undefined): EstadoEquipe
export declare function resumoDeMembros(equipe: EquipeResumo | null | undefined): string
/**
 * Forma MINIMA que as regras de seleção leem de fato.
 *
 * Existe porque as duas fontes descrevem a mesma pessoa com tipos diferentes: `/elegiveis`
 * garante `usuario_id: string`, e a linha juntada (`PessoaArea`) herda de `/equipe`, onde o id
 * pode ser nulo (a linha "Sem responsável"). As funções puras só olham `equipe_atual`, então
 * exigir o tipo mais estrito obrigaria a tela a converter — e converter tipo para calar o
 * compilador é como um erro de dado entra sem ninguém ver.
 */
export interface PessoaSelecionavel {
  usuario_id?: string | null
  nome?: string | null
  papel?: string | null
  equipe_atual?: EquipeDaPessoa | null
}

export declare function estadoDaPessoa(
  pessoa: PessoaSelecionavel | null | undefined,
  equipeAtualId: string | null
): EstadoPessoa
export declare function conflitosDaSelecao(
  pessoas: PessoaSelecionavel[] | null | undefined,
  selecionados: string[] | null | undefined,
  equipeAtualId: string | null
): string | null
export declare function validarFormulario(
  dados: { nome?: string; nicho_id?: string } | null | undefined
): { ok: boolean; motivo: string | null }
export declare function textoConfirmarEncerramento(equipe: EquipeResumo | null | undefined): string
export declare function agruparEquipes<T extends EquipeResumo>(
  equipes: T[] | null | undefined
): { ativas: T[]; encerradas: T[] }
export declare function nichosOcupados(
  equipes: EquipeResumo[] | null | undefined,
  equipeAtualId: string | null
): Set<string>
export declare function formatarDinheiro(valor: number | string | null | undefined): string
export declare function detalheMaisAntigo(dias: number | null | undefined): string
export declare function resumoDaEquipe(
  linhas: Partial<LinhaEquipe>[] | null | undefined,
  prazoDias?: number | null
): { total: number; pessoas: number; frase: string; acao: string } | null
