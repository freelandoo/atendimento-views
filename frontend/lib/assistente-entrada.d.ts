export type PassoEntrada = 'escolha' | 'o_que_mudar' | 'campos' | 'iniciada'
export type AjusteBusca = 'nicho' | 'localidade' | 'ambos'
export type CampoMercado = 'nicho' | 'cidade' | 'uf'

export type Mercado = { nicho: string; cidade: string; uf: string }

export type OpcaoAjuste = {
  id: AjusteBusca
  label: string
  descricao: string
  campos: CampoMercado[]
}

export type SessaoResumo = {
  id: string
  nicho: string | null
  cidade: string | null
  uf: string | null
  escopo_ampliado: boolean
  meta: number
  aprovados: number
  descartados: number
  status: 'ativa' | 'concluida' | 'encerrada'
} | null

export type OpcoesMenu = {
  revisar: { disponivel: boolean; label: string; descricao: string; retomando: boolean }
  buscar: { disponivel: boolean; label: string; descricao: string }
}

export const PASSOS: PassoEntrada[]
export const OPCOES_AJUSTE: OpcaoAjuste[]

export function normalizarUf(valor: unknown): string
export function normalizarMercado(mercado?: Partial<Mercado>): Mercado
export function camposVisiveis(ajuste: string, base?: Partial<Mercado>): CampoMercado[]
export function mercadoResultante(
  base?: Partial<Mercado>,
  alteracoes?: Partial<Mercado>,
  ajuste?: string
): Mercado
export function validarMercado(mercado?: Partial<Mercado>): string | null
export function mercadoMudou(base?: Partial<Mercado>, destino?: Partial<Mercado>): boolean
export function rotuloMercado(mercado?: Partial<Mercado> | null, vazio?: string): string
export function opcoesDoMenu(entrada?: {
  sessao?: SessaoResumo
  coletaEmAndamento?: boolean
  mercadoAtual?: Partial<Mercado>
}): OpcoesMenu
export function proximoPasso(passo: string, acao: string): string
