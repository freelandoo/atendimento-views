'use client'
// Lista vazia. Deliberadamente NAO e' `role="status"`: vazio e' o conteudo da tela, nao um
// aviso que deva interromper a navegacao.
//
// Regra de conteudo (a razao de existir deste componente): vazio por FILTRO e vazio por
// AUSENCIA pedem saidas diferentes. "Nenhum lead" manda o operador procurar defeito; "nenhum
// lead com estes filtros" manda ele limpar o filtro. Quem chama e' obrigado a dizer qual e'.
export type EstadoVazioProps = {
  /** O que nao existe, na linguagem do operador. */
  titulo: string
  /** Por que esta vazio e qual o proximo passo. */
  descricao?: string
  /** Acao que resolve ("Limpar filtros", "Nova campanha"). Opcional de proposito. */
  acao?: React.ReactNode
  /** Decorativo. Sem icone tambem funciona. */
  icone?: React.ReactNode
  className?: string
}

export default function EstadoVazio({
  titulo, descricao, acao, icone, className = '',
}: EstadoVazioProps) {
  return (
    <div className={`flex flex-col items-center justify-center px-6 py-10 text-center ${className}`}>
      {icone && (
        <div className="mb-3 text-ink-3" aria-hidden="true">
          {icone}
        </div>
      )}
      <p className="text-sm font-medium text-ink">{titulo}</p>
      {descricao && <p className="mt-1 max-w-md text-xs text-ink-3">{descricao}</p>}
      {acao && <div className="mt-4">{acao}</div>}
    </div>
  )
}
