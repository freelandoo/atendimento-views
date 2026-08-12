export type ZonaAcaoRadial = 'cima' | 'direita' | 'esquerda' | 'baixo'
export type TomAcaoRadial = 'positivo' | 'negativo' | 'neutro'

export type AcaoRadial = {
  id: string
  rotulo: string
  /** Posição preferida no leque. Sem zona (ou perdendo a colisão), a ação vai só para o centro. */
  zona?: ZonaAcaoRadial
  tom?: TomAcaoRadial
  /** Explica a consequência da ação; aparece só na lista completa (centro), não no botão de zona. */
  descricao?: string
  onSelecionar: () => void
  desabilitado?: boolean
}

export type ZonasAcaoRadial = {
  cima: AcaoRadial | null
  direita: AcaoRadial | null
  esquerda: AcaoRadial | null
  baixo: AcaoRadial | null
  extras: AcaoRadial[]
}

export declare function atribuirZonas(acoes: AcaoRadial[]): ZonasAcaoRadial
export declare function rotuloMenu(rotuloContexto?: string | null): string
export declare function classeTom(tom?: TomAcaoRadial): string
export declare const TOM_CLASSES: Record<TomAcaoRadial, string>
