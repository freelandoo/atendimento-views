export type ClassificacaoUrl =
  | 'site_proprio'
  | 'rede_social'
  | 'agregador'
  | 'perfil_ou_diretorio'
  | 'desconhecido'
  | 'sem_link'

export type SituacaoSite = 'tem_site' | 'sem_site' | 'nao_identificado'

export declare const ROTULO_LINK: Record<string, string>
export declare const ROTULO_SITUACAO: Record<SituacaoSite, string>

export declare function rotuloLink(classificacaoUrl: string | null | undefined): string
export declare function tituloLinkNaoSite(
  classificacaoUrl: string | null | undefined,
  linkOriginal: string | null | undefined
): string
