'use client'
// Campo de formulario: rotulo + controle + ajuda/erro, com a fiacao de acessibilidade feita.
//
// Por que ele CLONA o filho: `htmlFor`/`id`, `aria-describedby` e `aria-invalid` precisam
// casar, e casar isso a mao em cada tela e' o tipo de coisa que ninguem faz — o resultado sao
// rotulos que nao clicam e erros que o leitor de tela nunca anuncia. O clone tambem injeta as
// classes padrao da entrada, para o formulario nao depender de cada tela lembrar delas.
//
// O QUE ELE NAO FAZ: nao valida nada. Quem decide se ha erro e' quem tem a regra — validar
// aqui criaria uma segunda regua, mais frouxa que a do backend.
import { cloneElement, isValidElement, useId } from 'react'
import { classesEntrada } from '@/lib/ui-primitivos'

export type CampoProps = {
  etiqueta: string
  /** Mensagem de erro. Presente = estado de erro (borda + `aria-invalid` + anuncio). */
  erro?: string
  /** Texto de apoio. Some quando ha erro, para nao competir com ele. */
  ajuda?: string
  obrigatorio?: boolean
  className?: string
  /** UM controle: input, select ou textarea. */
  children: React.ReactNode
}

export default function Campo({
  etiqueta, erro = '', ajuda = '', obrigatorio = false, className = '', children,
}: CampoProps) {
  const id = useId()
  const idAjuda = `${id}-ajuda`
  const temErro = Boolean(erro)

  const controle = isValidElement(children)
    ? cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        id: (children.props as Record<string, unknown>).id ?? id,
        'aria-invalid': temErro || undefined,
        'aria-describedby': erro || ajuda ? idAjuda : undefined,
        'aria-required': obrigatorio || undefined,
        className: classesEntrada({
          erro: temErro,
          extra: String((children.props as Record<string, unknown>).className ?? ''),
        }),
      })
    : children

  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink-2">
        {etiqueta}
        {obrigatorio && (
          <span className="ml-0.5 text-estado-danger" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {controle}
      {/* `role="alert"` so no erro: ajuda estatica nao deve interromper quem esta digitando. */}
      {temErro ? (
        <p id={idAjuda} role="alert" className="mt-1 text-xs text-estado-danger">
          {erro}
        </p>
      ) : ajuda ? (
        <p id={idAjuda} className="mt-1 text-xs text-ink-3">
          {ajuda}
        </p>
      ) : null}
    </div>
  )
}
